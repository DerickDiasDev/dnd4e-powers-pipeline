/**
 * Static validation of out/db/ritual against the installed dnd4e system's enumerations (see system-enums.mjs).
 *
 * Usage: node validate-rituals.mjs [--db out/db]
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ENUMS } from "./system-enums.mjs";

/** @returns {Map<string, {count: number, examples: string[]}>} problems found, keyed by message */
export function validateRituals(entries, index) {
	const errors = new Map();
	const fail = (name, msg) => {
		const e = errors.get(msg) ?? { count: 0, examples: [] };
		e.count++;
		if (e.examples.length < 3) e.examples.push(name);
		errors.set(msg, e);
	};
	const inList = (name, field, value, list) => { if (!list.includes(value)) fail(name, `${field}: "${value}" not in [${list.join(",")}]`); };

	const seen = new Set();
	for (const e of entries) {
		const n = e.name;
		if (seen.has(e._id)) fail(n, "duplicate _id");
		seen.add(e._id);
		if (e.items.length !== 1 || e.items[0]._id !== e._id) fail(n, "a ritual has exactly one item, the entry itself");
		const item = e.items[0];
		const s = item.system;
		if (item.type !== "ritual") fail(n, `item type "${item.type}" is not ritual`);
		if (!/^[A-Za-z0-9]{16}$/.test(item._id)) fail(n, "item _id is not a 16-char id");
		inList(n, "category", s.category, ENUMS.ritualTypes);
		inList(n, "cast time units", s.castTime.units, ["", ...ENUMS.timePeriods]);
		inList(n, "duration units", s.duration.units, ["", ...ENUMS.timePeriods]);
		if (s.castTime.value !== null && !/^\d+$/.test(s.castTime.value)) fail(n, "cast time value is not a whole number");
		if (s.duration.value !== null && !/^\d+$/.test(s.duration.value)) fail(n, "duration value is not a whole number");
		const skill = s.attribute.match(/^skills\.([a-z]{3})\.total$/)?.[1];
		if (!skill || !ENUMS.skills.includes(skill)) fail(n, `attribute "${s.attribute}" is not a skill total`);
		if (!(Number.isInteger(s.level) && s.level >= 1 && s.level <= 30)) fail(n, `level ${s.level} is not 1-30`);
		if (!s.description.value) fail(n, "empty description");
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
	const entries = JSON.parse(await readFile(path.join(dbDir, "ritual", "rituals.json"), "utf8"));
	const index = JSON.parse(await readFile(path.join(dbDir, "ritual", "_index.json"), "utf8"));
	const errors = validateRituals(entries, index);
	if (!errors.size) { console.log(`Rituals: ${entries.length} entries, no problems.`); return; }
	for (const [msg, e] of errors) console.log(`${e.count}x ${msg}  e.g. ${e.examples.join(", ")}`);
	process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
