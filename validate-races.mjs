/**
 * Static validation of out/db/race against the installed dnd4e system's enumerations (see system-enums.mjs):
 * every value the importer would write into an actor or a feature item must be one the system knows.
 *
 * Usage: node validate-races.mjs [--db out/db]
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ENUMS } from "./system-enums.mjs";
import { effectProblems } from "./validate-effects.mjs";

const VISIONS = ["nv", "lv", "dv"];

/** @returns {Map<string, {count: number, examples: string[]}>} problems found, keyed by message */
export function validateRaces(entries, index, powerIds) {
	const errors = new Map();
	const fail = (name, msg) => {
		const e = errors.get(msg) ?? { count: 0, examples: [] };
		e.count++;
		if (e.examples.length < 3) e.examples.push(name);
		errors.set(msg, e);
	};
	const inList = (name, field, value, list, nullable = true) => {
		if (value === null || value === undefined) { if (!nullable) fail(name, `${field} is missing`); return; }
		if (!list.includes(value)) fail(name, `${field}: "${value}" not in [${list.join(",")}]`);
	};

	const seen = new Set();
	const effectIds = new Set();
	for (const e of entries) {
		const n = e.name;
		if (seen.has(e._id)) fail(n, "duplicate race _id");
		seen.add(e._id);
		inList(n, "size", e.apply.size, ENUMS.sizes);
		inList(n, "origin", e.apply.origin, ENUMS.origins);
		inList(n, "vision", e.apply.vision, VISIONS);
		if (e.apply.speed !== null && !(Number.isInteger(e.apply.speed) && e.apply.speed >= 1 && e.apply.speed <= 12)) fail(n, `speed ${e.apply.speed} is not a sensible number of squares`);
		for (const l of e.apply.spoken) inList(n, "spoken language", l, ENUMS.spoken);
		for (const [k, v] of Object.entries(e.apply.skills)) { inList(n, "skill", k, ENUMS.skills); if (!Number.isInteger(v)) fail(n, "skill bonus is not an integer"); }
		for (const [k, v] of Object.entries(e.apply.defences)) { inList(n, "defence", k, ENUMS.defences); if (!Number.isInteger(v)) fail(n, "defence bonus is not an integer"); }
		if (e.quality === "complete") for (const f of ["size", "speed", "vision"]) if (e.apply[f] === null) fail(n, `complete race without ${f}`);
		if (!e.items.length || e.items[0]._id !== e._id) fail(n, "the first item must be the race itself");
		for (const item of e.items) {
			for (const p of effectProblems(item, effectIds)) fail(n, `effect: ${p}`);
			if (item.type !== "feature") fail(n, `item "${item.name}" is not a feature`);
			if (item.system.featureType !== "race") fail(n, `item "${item.name}" has featureType "${item.system.featureType}"`);
			if (!/^[A-Za-z0-9]{16}$/.test(item._id)) fail(n, "item _id is not a 16-char id");
			if (seen.has(item._id) && item._id !== e._id) fail(n, "duplicate item _id");
			seen.add(item._id);
			if (!item.name) fail(n, "item without a name");
			if (item.flags.dnd4e.import.bundle !== e._id) fail(n, "item bundle does not point at the race");
		}
		for (const p of e.powers) if (powerIds && !powerIds.has(p.id)) fail(n, `power "${p.name}" is not in the power database`);
		const row = index.find(r => r.id === e.id);
		if (!row) fail(n, "race is not in the index");
		else if (JSON.stringify(row.items) !== JSON.stringify(e.items.map(i => i._id))) fail(n, "index items differ from the race's items");
	}
	return errors;
}

async function main() {
	const here = path.dirname(fileURLToPath(import.meta.url));
	const argv = process.argv.slice(2);
	const dbDir = path.resolve(argv.includes("--db") ? argv[argv.indexOf("--db") + 1] : path.join(here, "out", "db"));
	const entries = JSON.parse(await readFile(path.join(dbDir, "race", "races.json"), "utf8"));
	const index = JSON.parse(await readFile(path.join(dbDir, "race", "_index.json"), "utf8"));
	const powerIds = new Set(JSON.parse(await readFile(path.join(dbDir, "power", "_index.json"), "utf8")).map(p => p.id));
	const errors = validateRaces(entries, index, powerIds);
	if (!errors.size) { console.log(`Races: ${entries.length} entries, no problems.`); return; }
	for (const [msg, e] of errors) console.log(`${e.count}x ${msg}  e.g. ${e.examples.join(", ")}`);
	process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
