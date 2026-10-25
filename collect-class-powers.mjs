/**
 * The powers a class page spells out but the power catalog does not list: Hunter's Quarry (ranger), Warlock's Curse, the implement powers
 * of the arcanist wizard, the paladin's celestial steed... They are in the class page (out/class.json) as power blocks
 * (`<h1 class=atwillpower>Hunter's Quarry<span class=level>Hunter's Quarry Power</span></h1>...`), so the class features that say "you can
 * use your Hunter's Quarry power" have no power to hand out. This adds those blocks to out/power.json as entries of the class, in the shape of
 * the catalog's own, so the powers are parsed and built like any other (run it before parse-powers.mjs; running it again changes nothing).
 *
 * A block is added when no power of that name is in the catalog. "... Secondary Power" blocks are parts of another power, not powers.
 * Hybrid classes repeat the blocks of their class, so only the others are read.
 *
 * Usage: node collect-class-powers.mjs
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const SOURCE_BOOK = "ClassFeature";

const text = html => String(html).replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").trim();
const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** The blocks of a class page: `{ name, level, kind, html }` for each power block, its html from its heading to the next heading or note. */
export function powerBlocks(html) {
	const out = [];
	const headings = [...html.matchAll(/<h1 class=(\w*power)>([\s\S]*?)<\/h1>/gi)];
	headings.forEach((h, i) => {
		const start = h.index;
		let end = i + 1 < headings.length ? headings[i + 1].index : html.length;
		const rest = html.slice(start, end);
		// The block ends where the page goes on to a note, a heading or another section.
		const stop = rest.search(/<br>(?:Addition|Revision|Update)\b|<br><br><b>|<h[23]\b/i);
		const block = stop > 0 ? rest.slice(0, stop) : rest;
		const level = h[2].match(/<span class=level>([\s\S]*?)<\/span>/)?.[1] ?? "";
		const kind = level.match(/(Attack|Utility|Feature)\s*(\d+)?\s*$/i);
		out.push({ name: text(h[2].replace(/<span[\s\S]*$/i, "")), levelText: text(level), kind: kind ? kind[1] : "Feature", level: kind?.[2] ?? "1", html: block });
	});
	return out;
}

/** The base name of a class ("Wizard (Arcanist)" -> "Wizard"), or null for a hybrid class. */
export const baseClassName = name => (/^hybrid\b/i.test(name) ? null : name.replace(/\s*\(.*\)\s*$/, "").trim());

/** The entries to add to the catalog, given the classes (out/class.json) and the powers already there. */
export function classPowerEntries(classes, powers) {
	const known = new Set(powers.map(p => (p.listing?.Name ?? "").toLowerCase().trim()));
	const have = new Set(powers.map(p => p.id));
	const added = new Map();
	for (const cls of classes) {
		const base = baseClassName(cls.listing?.Name ?? "");
		if (!base) continue;
		for (const block of powerBlocks(cls.html)) {
			if (/secondary power$/i.test(block.name) || known.has(block.name.toLowerCase())) continue;
			const id = `classpower-${slug(base)}-${slug(block.name)}`;
			if (have.has(id) || added.has(id)) continue;
			const action = block.html.match(/<b>(Standard|Move|Minor|Free)\s+Action<\/b>/i)?.[1] ?? "";
			added.set(id, {
				id,
				listing: { ID: id, Name: block.name, ClassName: base, Level: block.level, Type: `${base} ${block.kind}`, Action: action, Keywords: "", SourceBook: SOURCE_BOOK },
				html: block.html,
			});
		}
	}
	return [...added.values()];
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const classes = JSON.parse(await readFile(path.join(root, "out", "class.json"), "utf8"));
	const powers = JSON.parse(await readFile(path.join(root, "out", "power.json"), "utf8"));
	const entries = classPowerEntries(classes, powers);
	if (entries.length) await writeFile(path.join(root, "out", "power.json"), JSON.stringify([...powers, ...entries]));
	console.log(`${entries.length} class powers added to the catalog${entries.length ? `: ${entries.map(e => `${e.listing.ClassName}: ${e.listing.Name}`).join("; ")}` : ""}`);
}
