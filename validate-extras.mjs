/**
 * Static validation of the deities, diseases and companions in out/db/option/<kind>: ids, the item shape, and that the index
 * agrees with the entries.
 *
 * Usage: node validate-extras.mjs [--db out/db]
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ENUMS } from "./system-enums.mjs";
import { EXTRA_KINDS } from "./build-extras.mjs";

/** @returns {Map<string, {count: number, examples: string[]}>} problems found, keyed by message */
export function validateExtras(kind, entries, index) {
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
		if (e.kind !== kind) fail(n, `kind "${e.kind}" in the ${kind} file`);
		if (seen.has(e._id)) fail(n, "duplicate _id");
		seen.add(e._id);
		if (e.items.length !== 1 || e.items[0]._id !== e._id) fail(n, "exactly one item, the entry itself");
		const item = e.items[0];
		if (item.type !== "feature") fail(n, `item type "${item.type}" is not feature`);
		if (!ENUMS.featureTypes.includes(item.system.featureType)) fail(n, `featureType "${item.system.featureType}" not in the system's`);
		if (!/^[A-Za-z0-9]{16}$/.test(item._id)) fail(n, "item _id is not a 16-char id");
		if (!item.system.description.value) fail(n, "empty description");
		if (item.flags.dnd4e.import.kind !== kind) fail(n, "import kind differs from the file's");
		if (kind === "deity" && e.apply.deity !== e.name) fail(n, "a deity must apply its own name");
		if (kind === "disease" && e.level !== null && !(e.level >= 1 && e.level <= 40)) fail(n, `disease level ${e.level} is not plausible`);
		const row = index.find(r => r.id === e.id);
		if (!row) fail(n, "entry is not in the index");
		else if (JSON.stringify(row.items) !== JSON.stringify([item._id])) fail(n, "index items differ from the entry's items");
	}
	return errors;
}

async function main() {
	const here = path.dirname(fileURLToPath(import.meta.url));
	const argv = process.argv.slice(2);
	const dbDir = path.resolve(argv.includes("--db") ? argv[argv.indexOf("--db") + 1] : path.join(here, "out", "db"));
	let bad = false;
	for (const kind of EXTRA_KINDS) {
		const entries = JSON.parse(await readFile(path.join(dbDir, "option", kind, "entries.json"), "utf8"));
		const index = JSON.parse(await readFile(path.join(dbDir, "option", kind, "_index.json"), "utf8"));
		const errors = validateExtras(kind, entries, index);
		if (!errors.size) { console.log(`${kind}: ${entries.length} entries, no problems.`); continue; }
		bad = true;
		for (const [msg, e] of errors) console.log(`${kind}: ${e.count}x ${msg}  e.g. ${e.examples.join(", ")}`);
	}
	if (bad) process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
