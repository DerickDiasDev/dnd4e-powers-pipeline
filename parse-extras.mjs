/**
 * Parses the deities, diseases and companions (out/deity.json, disease.json, companion.json) into one clean schema
 * (out/parsed/extras.json). They share a shape because the importer lists them in the same window as the character options.
 *
 *   deity      type, alignment, domains and the other labelled facts of the header, then the text
 *   disease    level (or variable), then the text: the stages and the check that moves between them
 *   companion  animal companions, elemental companions, familiars, mounts and summoned creatures: the stat block as text
 *              (their numbers depend on the master's level, so they cannot be a fixed actor)
 *
 * Nothing is invented: the page's lines are kept in order, tables as "a | b" lines.
 *
 * Usage: node parse-extras.mjs [--in out] [--out out/parsed]
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { txt } from "./parse-powers.mjs";

/** The lines of a page's text, table cells joined with " | ". */
export function bodyLines(html) {
	return txt(String(html).replace(/<\/?span[^>]*>/gi, "\n").replace(/<tr[^>]*>/gi, "\n").replace(/<t[dh][^>]*>/gi, " | ").replace(/<\/(?:tr|table)>/gi, "\n")).split("\n").map(l => l.replace(/^\s*\|\s*/, "").replace(/\s*\|\s*$/, "")).filter(Boolean);
}

const sourcesOf = listing => String(listing.SourceBook ?? "").split(",").map(s => s.trim()).filter(Boolean);
const withoutPublished = html => html.replace(/<p class=publishedIn>[\s\S]*$/i, "");
const published = html => txt(html.match(/<p class=publishedIn>([\s\S]*?)<\/p>/i)?.[1] ?? "");

/** Header facts of a deity: <b>Label:</b> value pairs of the first paragraph. */
export function parseDeityFacts(html) {
	const facts = [];
	const header = html.match(/<p class=flavor>([\s\S]*?)<\/p>/i)?.[1] ?? "";
	for (const part of header.split(/<br\s*\/?>/i)) {
		const m = part.match(/^\s*<b>\s*([^<:]*?)\s*:?\s*<\/b>\s*:?\s*([\s\S]*)$/i);
		if (m && m[1]) facts.push({ label: m[1].trim(), value: txt(m[2]).trim() });
	}
	return facts;
}

export function parseDeity(entry) {
	const html = withoutPublished(entry.html);
	const facts = parseDeityFacts(html);
	const get = label => facts.find(f => f.label.toLowerCase() === label)?.value ?? null;
	const title = txt(html.match(/<h1[^>]*>[\s\S]*?<b>,?\s*([^<]*)<\/b>[\s\S]*?<\/h1>/i)?.[1] ?? "");
	const prose = bodyLines(html.replace(/^[\s\S]*?<\/p>/i, ""));
	const sources = sourcesOf(entry.listing);
	return {
		id: entry.id, kind: "deity", name: txt(entry.listing.Name), title,
		category: get("alignment"), godType: get("type"), domains: get("domain"),
		facts: facts.filter(f => f.label.toLowerCase() !== "domain" || true),
		body: prose, sources, sourceCode: sources[0] ?? null, published: published(entry.html), notes: [],
	};
}

export function parseDisease(entry) {
	const html = withoutPublished(entry.html);
	const level = html.match(/<span class=level>\s*Level\s*(\d+)/i)?.[1];
	const flavor = txt(html.match(/<p class=flavor>([\s\S]*?)<\/p>/i)?.[1] ?? "");
	const sources = sourcesOf(entry.listing);
	return {
		id: entry.id, kind: "disease", name: txt(entry.listing.Name), level: level ? Number(level) : null,
		category: level ? null : "Variable level", flavor,
		// Everything but the title and the flavour paragraph (some pages have no flavour: the first paragraph is the stages).
		body: bodyLines(html.replace(/<h1[^>]*>[\s\S]*?<\/h1>/i, "").replace(/<p class=flavor>[\s\S]*?<\/p>/i, "")),
		sources, sourceCode: sources[0] ?? null, published: published(entry.html), notes: [],
	};
}

export function parseCompanion(entry) {
	const html = withoutPublished(entry.html);
	const name = txt(entry.listing.Name);
	let lines = bodyLines(html.replace(/<h1[^>]*>[\s\S]*?<\/h1>/i, ""));
	// Some pages print the name and the type again as the first line of the text.
	while (lines.length && (lines[0].startsWith(name) || /^(?:Familiar|Mount|Summoned Creature|Animal Companion)$/i.test(lines[0]))) lines.shift();
	const sources = sourcesOf(entry.listing);
	return {
		id: entry.id, kind: "companion", name, category: txt(entry.listing.Type) || "Companion",
		size: txt(entry.listing.Size ?? ""), creatureType: txt(entry.listing.CreatureType ?? ""),
		body: lines, sources, sourceCode: sources[0] ?? null, published: published(entry.html), notes: [],
	};
}

async function main() {
	const argv = process.argv.slice(2);
	const flag = (name, fallback) => (argv.includes(`--${name}`) ? argv[argv.indexOf(`--${name}`) + 1] : fallback);
	const here = path.dirname(fileURLToPath(import.meta.url));
	const inDir = path.resolve(here, flag("in", "out"));
	const outDir = path.resolve(here, flag("out", "out/parsed"));
	const load = async name => JSON.parse(await readFile(path.join(inDir, `${name}.json`), "utf8"));
	const parsed = [
		...(await load("deity")).map(parseDeity),
		...(await load("disease")).map(parseDisease),
		...(await load("companion")).map(parseCompanion),
	];
	await mkdir(outDir, { recursive: true });
	await writeFile(path.join(outDir, "extras.json"), JSON.stringify(parsed));
	const byKind = {};
	for (const p of parsed) byKind[p.kind] = (byKind[p.kind] ?? 0) + 1;
	console.log("Extras:", byKind);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
