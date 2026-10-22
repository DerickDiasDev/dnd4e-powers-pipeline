/**
 * Static validation of out/db/glossary: ids, one text page per journal entry, only the tags a page may have, and that the index
 * agrees with the entries.
 *
 * Usage: node validate-glossary.mjs [--db out/db]
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ALLOWED = new Set(["p", "br", "b", "i", "h3", "h4", "table", "thead", "tbody", "tr", "th", "td", "ul", "li"]);

/** @returns {Map<string, {count: number, examples: string[]}>} problems found, keyed by message */
export function validateGlossary(entries, index) {
	const errors = new Map();
	const fail = (name, msg) => {
		const e = errors.get(msg) ?? { count: 0, examples: [] };
		e.count++;
		if (e.examples.length < 3) e.examples.push(name);
		errors.set(msg, e);
	};
	const seen = new Set();
	for (const e of entries) {
		const n = e.name;
		if (seen.has(e._id)) fail(n, "duplicate _id");
		seen.add(e._id);
		const j = e.journal;
		if (j._id !== e._id) fail(n, "the journal's _id is not the entry's");
		if (!/^[A-Za-z0-9]{16}$/.test(j._id)) fail(n, "_id is not a 16-char id");
		if (j.pages.length !== 1 || j.pages[0].type !== "text") fail(n, "a glossary entry has one text page");
		const content = j.pages[0].text.content;
		if (!content) fail(n, "empty page");
		for (const m of content.matchAll(/<\/?([a-z0-9]+)/gi)) if (!ALLOWED.has(m[1].toLowerCase())) fail(n, `tag <${m[1]}> is not allowed`);
		if (/<[a-z0-9]+\s[^>]*>/i.test(content)) fail(n, "a tag with attributes");
		if (/<script|javascript:/i.test(content)) fail(n, "script in a page");
		if (j.flags.dnd4e.import.kind !== "glossary") fail(n, "import kind is not glossary");
		if (!index.some(r => r.id === e.id)) fail(n, "entry is not in the index");
	}
	return errors;
}

async function main() {
	const here = path.dirname(fileURLToPath(import.meta.url));
	const argv = process.argv.slice(2);
	const dbDir = path.resolve(argv.includes("--db") ? argv[argv.indexOf("--db") + 1] : path.join(here, "out", "db"));
	const entries = JSON.parse(await readFile(path.join(dbDir, "glossary", "entries.json"), "utf8"));
	const index = JSON.parse(await readFile(path.join(dbDir, "glossary", "_index.json"), "utf8"));
	const errors = validateGlossary(entries, index);
	if (index.length !== entries.length) errors.set(`index has ${index.length} rows, the file ${entries.length} entries`, { count: 1, examples: [] });
	if (!errors.size) { console.log(`Glossary: ${entries.length} entries, no problems.`); return; }
	for (const [msg, e] of errors) console.log(`${e.count}x ${msg}  e.g. ${e.examples.join(", ")}`);
	process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
