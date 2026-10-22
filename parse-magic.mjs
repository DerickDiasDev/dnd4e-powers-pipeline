/**
 * Parses the magic items (the `mihead` pages of out/weapon.json, armor.json, implement.json and item.json) into a clean
 * intermediate schema (out/parsed/magic.json).
 *
 * A magic item page has: a title with level and rarity, a flavour line, an optional table of levels (one row per level the item
 * exists at, with its enhancement bonus and price), stat lines (the weapon, armour or implement it enchants, what the
 * enhancement bonus applies to, the critical, the slot and price), and sections: Property/Properties, and Powers (a heading
 * such as "Power ✦ Daily (Free Action)" followed by its lines).
 *
 * Nothing is invented: the tiers come from the table; a page without one has a single tier (its own level and price).
 *
 * Usage: node parse-magic.mjs [--in out] [--out out/parsed]
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { txt } from "./parse-powers.mjs";
import { parsePrice } from "./parse-gear.mjs";

const toNumber = raw => {
	const m = String(raw ?? "").match(/[\d,]+/);
	return m ? Number(m[0].replace(/,/g, "")) : null;
};

/** The levels table: [{level, enhancement, price}] sorted by level. Empty when the page has none. */
export function parseTiers(html) {
	const table = html.match(/<table class=magicitem>([\s\S]*?)<\/table>/i)?.[1];
	if (!table) return [];
	const tiers = [];
	for (const m of table.matchAll(/<td class=mic1>\s*Lvl\s*(\d+)\s*<td class=mic2>\s*([^<]*)<td class=mic3>\s*([^<]*)/gi)) {
		const enhancement = m[2].match(/\+\s*(\d+)/);
		tiers.push({ level: Number(m[1]), enhancement: enhancement ? Number(enhancement[1]) : null, price: parsePrice(m[3]) });
	}
	return tiers.sort((a, b) => a.level - b.level);
}

/** "Level 8 Uncommon" / "Level 4+ Uncommon" from the title span. */
export function parseLevelLine(html) {
	// The older poison pages print "Level 5 Poison" in a span of class `level`: the word is the kind of item, not a rarity.
	const m = html.match(/<span class=(?:milevel|level)[^>]*>\s*Level\s*(\d+)(\+?)\s*([^<]*)<\/span>/i);
	return m ? { level: Number(m[1]), scales: Boolean(m[2]), rarity: /^poison$/i.test(m[3].trim()) ? "" : m[3].trim() } : null;
}

/**
 * The stat lines and the sections that follow the table. A paragraph is {text, indent}; a list is flattened into one
 * paragraph per bullet, marked `bullet`.
 */
export function parseBody(html) {
	const start = html.search(/<\/table>|<\/p>/i);
	const rest = html.slice(start < 0 ? 0 : start);
	const stats = {};
	const intro = [];
	const sections = [];
	let current = null;
	const tokens = /<h2 class=mihead>([\s\S]*?)<\/h2>|<ul class=mistat>([\s\S]*?)<\/ul>|<p class='?(mistat[A-Za-z]*)(?: (indent\d?))?'?>([\s\S]*?)<\/p>/gi;
	for (const m of rest.matchAll(tokens)) {
		if (m[1] !== undefined) {
			current = { heading: txt(m[1]), paragraphs: [] };
			sections.push(current);
		} else if (m[2] !== undefined) {
			const target = current ?? (current = { heading: "", paragraphs: [] }, sections.push(current), current);
			for (const li of m[2].matchAll(/<li>([\s\S]*?)<\/li>/gi)) target.paragraphs.push({ text: txt(li[1]), bullet: true });
		} else {
			const cls = m[3], indent = m[4] ? Number(m[4].replace("indent", "") || 0) + 1 : 0;
			if (!current) {
				// Stat lines before the first section: "<b>Weapon: </b>Maces", "<b>Hands Slot</b>   360 gp", the alchemical line with <br>.
				if (!/<b>/i.test(m[5])) { const text = txt(m[5]); if (text) intro.push(text); continue; }
				for (const part of m[5].split(/<br\s*\/?>/i)) {
					for (const s of part.matchAll(/<b>\s*([^<:]*?)\s*:?\s*<\/b>\s*:?\s*([^<]*)/gi)) stats[s[1].trim()] = txt(s[2]).trim();
				}
				continue;
			}
			const text = txt(m[5]);
			if (text) current.paragraphs.push({ text, ...(indent ? { indent } : {}) });
		}
	}
	return { stats, intro, sections: sections.filter(s => s.paragraphs.length || s.heading) };
}

const sourcesOf = listing => String(listing.SourceBook ?? "").split(",").map(s => s.trim()).filter(Boolean);

export function parseMagic(entry) {
	const html = entry.html.replace(/<p class=publishedIn>[\s\S]*$/i, "");
	const level = parseLevelLine(html);
	const tiers = parseTiers(html);
	const { stats, intro, sections } = parseBody(html);
	// The older poison pages have no sections: one paragraph of lines, the attack and what follows each failed save.
	const legacy = !sections.length ? html.match(/<p>([\s\S]*?)<\/p>/i)?.[1] : null;
	if (legacy) sections.push({ heading: "Poison", paragraphs: txt(legacy).split("\n").filter(Boolean).map(text => ({ text })) });
	const published = txt(entry.html.match(/<p class=publishedIn>([\s\S]*?)<\/p>/i)?.[1] ?? "");
	const slotLine = Object.entries(stats).find(([k]) => / Slot$/i.test(k) || /^(?:Wondrous Item|Alternative Reward|Mount|Familiar|Companion|Lair|Consumable)$/i.test(k));
	const listing = entry.listing;
	const sources = sourcesOf(listing);
	const notes = [];
	if (!level) notes.push("level-unparsed");
	const single = !tiers.length;
	const price = single ? parsePrice(listing.Cost) ?? parsePrice(slotLine?.[1]) : null;
	return {
		id: entry.id,
		name: txt(listing.Name),
		category: listing.Category ?? (entry.id.startsWith("weapon") ? "Weapon" : entry.id.startsWith("armor") ? "Armor" : entry.id.startsWith("poison") ? "Poison" : "Implement"),
		type: String(listing.Type ?? "").trim(),
		rarity: level?.rarity ?? listing.Rarity ?? "",
		flavor: txt(html.match(/<p class=(?:miflavor|flavor)>([\s\S]*?)<\/p>/i)?.[1] ?? ""),
		sources, sourceCode: sources[0] ?? null, published,
		// A page without a table has one tier; a printed "+4" in the enhancement line (an artifact or unique item) is its bonus.
		tiers: single ? [{ level: level?.level ?? null, enhancement: toNumber(String(stats["Enhancement Bonus"] ?? stats.Enhancement ?? "").match(/\+\s*\d+/)?.[0]), price }] : tiers,
		scales: !single,
		stats,
		intro,
		sections,
		notes,
	};
}

/** True for the pages of magic items (the mundane ones use another layout, see parse-gear.mjs). */
export const isMagicPage = entry => /<h1 class=(?:mihead|poison)/i.test(entry.html);

async function main() {
	const argv = process.argv.slice(2);
	const flag = (name, fallback) => (argv.includes(`--${name}`) ? argv[argv.indexOf(`--${name}`) + 1] : fallback);
	const here = path.dirname(fileURLToPath(import.meta.url));
	const inDir = path.resolve(here, flag("in", "out"));
	const outDir = path.resolve(here, flag("out", "out/parsed"));
	const parsed = [];
	for (const name of ["weapon", "armor", "implement", "item", "poison"]) {
		const rows = JSON.parse(await readFile(path.join(inDir, `${name}.json`), "utf8")).filter(isMagicPage);
		parsed.push(...rows.map(parseMagic));
	}
	await mkdir(outDir, { recursive: true });
	await writeFile(path.join(outDir, "magic.json"), JSON.stringify(parsed));
	const byCategory = {};
	for (const m of parsed) byCategory[m.category] = (byCategory[m.category] ?? 0) + 1;
	const notes = {};
	for (const m of parsed) for (const n of m.notes) notes[n] = (notes[n] ?? 0) + 1;
	console.log(`Magic items: ${parsed.length}`, byCategory, "notes:", notes);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
