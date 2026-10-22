/**
 * Builds the rules glossary part of the database (out/db/glossary/) from out/glossary.json: one journal entry per page (the rules
 * on combat, conditions, skills, the keywords, the weapon groups and properties, the monster origins and races...), each with one
 * text page. The page is the compendium's HTML with the attributes and the links removed, and without its title (the entry has it).
 *
 * Output: out/db/glossary/_index.json (light rows) and out/db/glossary/entries.json (the journal entries).
 *
 * Usage: node build-glossary.mjs [--in out/glossary.json] [--db out/db]
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { txt } from "./parse-powers.mjs";

export const GLOSSARY_SCHEMA_VERSION = 1;

const stableId = seed => createHash("sha1").update(`dnd4e:glossary:${seed}`).digest("base64").replace(/[^A-Za-z0-9]/g, "").slice(0, 16);
const ALLOWED = new Set(["p", "br", "b", "i", "h3", "h4", "table", "thead", "tbody", "tr", "th", "td", "ul", "li"]);

/** The page's HTML, safe to show in a journal: no title, no attributes, no links, only the tags a page needs. */
export function cleanHtml(html) {
	return String(html)
		.replace(/<p class=publishedIn>[\s\S]*$/i, "")
		.replace(/<h1[^>]*>[\s\S]*?<\/h1>/i, "")
		.replace(/<\/?a\b[^>]*>/gi, "")
		.replace(/<(\/?)([a-z0-9]+)[^>]*>/gi, (all, slash, tag) => (ALLOWED.has(tag.toLowerCase()) ? `<${slash}${tag.toLowerCase()}>` : ""))
		.replace(/(<br>\s*){3,}/gi, "<br><br>")
		.trim();
}

/** @param {{id: string, listing: object, html: string}} entry a glossary page of the compendium */
export function buildGlossary(entry) {
	const listing = entry.listing;
	const sources = String(listing.SourceBook ?? "").split(",").map(s => s.trim()).filter(Boolean);
	const name = txt(listing.Name);
	const _id = stableId(entry.id);
	const content = cleanHtml(entry.html);
	const journal = {
		_id, name,
		pages: [{ _id: stableId(`${entry.id}:page`), name, type: "text", text: { format: 1, content }, sort: 0 }],
		flags: { dnd4e: { import: { origin: "iws-4e-compendium", kind: "glossary", id: entry.id, sourceCode: sources[0] ?? null, schema: GLOSSARY_SCHEMA_VERSION, category: listing.Category ?? "", type: listing.Type ?? "" } } },
	};
	return {
		id: entry.id, _id, name, category: txt(listing.Category ?? ""), type: txt(listing.Type ?? ""), source: sources[0] ?? null, sources,
		size: txt(content).length, notes: content ? [] : ["empty"], journal,
	};
}

/** A light row for the importer's list. */
export const indexRow = e => ({ id: e.id, _id: e._id, name: e.name, category: e.category, type: e.type, source: e.source, sources: e.sources, size: e.size, notes: e.notes });

async function main() {
	const argv = process.argv.slice(2);
	const flag = (name, fallback) => (argv.includes(`--${name}`) ? argv[argv.indexOf(`--${name}`) + 1] : fallback);
	const here = path.dirname(fileURLToPath(import.meta.url));
	const input = path.resolve(here, flag("in", "out/glossary.json"));
	const dbDir = path.resolve(here, flag("db", "out/db"));
	const entries = JSON.parse(await readFile(input, "utf8")).map(buildGlossary);
	await mkdir(path.join(dbDir, "glossary"), { recursive: true });
	await writeFile(path.join(dbDir, "glossary", "entries.json"), JSON.stringify(entries));
	await writeFile(path.join(dbDir, "glossary", "_index.json"), JSON.stringify(entries.map(indexRow)));
	const manifestFile = path.join(dbDir, "manifest.json");
	const manifest = JSON.parse(await readFile(manifestFile, "utf8"));
	manifest.glossary = { count: entries.length, schema: GLOSSARY_SCHEMA_VERSION };
	await writeFile(manifestFile, JSON.stringify(manifest, null, 1));
	const empty = entries.filter(e => e.notes.length).map(e => e.name);
	console.log(`Glossary: ${entries.length} entries${empty.length ? `; empty: ${empty.join(", ")}` : ""}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
