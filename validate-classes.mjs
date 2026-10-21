/**
 * Static validation of out/db/class against the installed dnd4e system's enumerations (see system-enums.mjs):
 * every value the importer would write into an actor or a feature item must be one the system knows.
 *
 * Usage: node validate-classes.mjs [--db out/db]
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ENUMS } from "./system-enums.mjs";

/** @returns {Map<string, {count: number, examples: string[]}>} problems found, keyed by message */
export function validateClasses(entries, index, powerIds) {
	const errors = new Map();
	const fail = (name, msg) => {
		const e = errors.get(msg) ?? { count: 0, examples: [] };
		e.count++;
		if (e.examples.length < 3) e.examples.push(name);
		errors.set(msg, e);
	};
	const inList = (name, field, value, list) => { if (!list.includes(value)) fail(name, `${field}: "${value}" not in [${list.join(",")}]`); };
	const number = (name, field, value, { min = 0, max = 100 } = {}) => {
		if (value === null) return;
		if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) fail(name, `${field} is not a sensible number (${value})`);
	};

	const seen = new Set();
	for (const e of entries) {
		const n = e.name;
		const a = e.apply;
		if (seen.has(e._id)) fail(n, "duplicate class _id");
		seen.add(e._id);
		if (a.primaryAbility !== null) inList(n, "primaryAbility", a.primaryAbility, ENUMS.abilities);
		for (const key of e.keyAbilities) inList(n, "key ability", key, ENUMS.abilities);
		for (const [k, v] of Object.entries(a.defences)) { inList(n, "defence", k, ENUMS.defences); if (!Number.isInteger(v)) fail(n, "defence bonus is not an integer"); }
		for (const k of a.trained) inList(n, "trained skill", k, ENUMS.skills);
		for (const k of e.skillChoice.from) inList(n, "class skill", k, ENUMS.skills);
		for (const k of a.armour) inList(n, "armour proficiency", k, ENUMS.armourProf);
		for (const k of a.weapons) inList(n, "weapon proficiency", k, ENUMS.weaponProf);
		number(n, "hpStart", a.hpStart, { min: 1, max: 30 });
		number(n, "hpPerLevel", a.hpPerLevel, { min: 1, max: 12 });
		number(n, "surges", a.surges, { min: 1, max: 15 });
		if (!e.hybrid) {
			if (e.quality === "complete") for (const f of ["primaryAbility", "hpStart", "hpPerLevel", "surges"]) if (a[f] === null) fail(n, `complete class without ${f}`);
		} else if (a.hpStart !== null || a.surges !== null) fail(n, "a hybrid class must not write hit points or surges");
		if (!e.items.length || e.items[0]._id !== e._id) fail(n, "the first item must be the class itself");
		for (const item of e.items) {
			if (item.type !== "feature") fail(n, `item "${item.name}" is not a feature`);
			if (item.system.featureType !== "class") fail(n, `item "${item.name}" has featureType "${item.system.featureType}"`);
			if (!/^[A-Za-z0-9]{16}$/.test(item._id)) fail(n, "item _id is not a 16-char id");
			if (seen.has(item._id) && item._id !== e._id) fail(n, "duplicate item _id");
			seen.add(item._id);
			if (!item.name) fail(n, "item without a name");
			if (item.system.level !== null && !(Number.isInteger(item.system.level) && item.system.level >= 1 && item.system.level <= 30)) fail(n, `item "${item.name}" has level ${item.system.level}`);
			if (item.flags.dnd4e.import.bundle !== e._id) fail(n, "item bundle does not point at the class");
		}
		for (const p of e.powers) {
			if (powerIds && !powerIds.has(p.id)) fail(n, `power "${p.name}" is not in the power database`);
			if (!["granted", "option"].includes(p.kind)) fail(n, `power kind "${p.kind}"`);
		}
		const row = index.find(r => r.id === e.id);
		if (!row) fail(n, "class is not in the index");
		else if (JSON.stringify(row.items) !== JSON.stringify(e.items.map(i => i._id))) fail(n, "index items differ from the class's items");
	}
	return errors;
}

async function main() {
	const here = path.dirname(fileURLToPath(import.meta.url));
	const argv = process.argv.slice(2);
	const dbDir = path.resolve(argv.includes("--db") ? argv[argv.indexOf("--db") + 1] : path.join(here, "out", "db"));
	const entries = JSON.parse(await readFile(path.join(dbDir, "class", "classes.json"), "utf8"));
	const index = JSON.parse(await readFile(path.join(dbDir, "class", "_index.json"), "utf8"));
	const powerIds = new Set(JSON.parse(await readFile(path.join(dbDir, "power", "_index.json"), "utf8")).map(p => p.id));
	const errors = validateClasses(entries, index, powerIds);
	if (!errors.size) { console.log(`Classes: ${entries.length} entries, no problems.`); return; }
	for (const [msg, e] of errors) console.log(`${e.count}x ${msg}  e.g. ${e.examples.join(", ")}`);
	process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
