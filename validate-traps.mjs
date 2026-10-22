/**
 * Static validation of out/db/trap: the Hazard actors a trap becomes, and that the index agrees with the files.
 *
 * Usage: node validate-traps.mjs [--db out/db]
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ENUMS } from "./system-enums.mjs";

const GROUPS = ["standard", "elite", "solo", "minion"];
const PRIMARY = ["trap", "hazard", "other"];
const TERTIARY = ["blaster", "lurker", "obstacle", "warder", "other"];

/** @returns {Map<string, {count: number, examples: string[]}>} problems found, keyed by message */
export function validateTraps(actors, index) {
	const errors = new Map();
	const fail = (name, msg) => {
		const e = errors.get(msg) ?? { count: 0, examples: [] };
		e.count++;
		if (e.examples.length < 3) e.examples.push(name);
		errors.set(msg, e);
	};
	const seen = new Set();
	const rows = new Map(index.map(r => [r._id, r]));
	for (const a of actors) {
		const n = a.name;
		if (seen.has(a._id)) fail(n, "duplicate _id");
		seen.add(a._id);
		if (!/^[A-Za-z0-9]{16}$/.test(a._id)) fail(n, "_id is not a 16-char id");
		if (a.type !== "Hazard") fail(n, `actor type "${a.type}" is not Hazard`);
		const s = a.system;
		if (s.advancedCals !== false) fail(n, "a trap uses the printed numbers (advancedCals false)");
		const hp = s.attributes.hp;
		if (hp.none ? hp.max !== 0 : !(hp.max >= 1 && hp.value === hp.max)) fail(n, "hit points: none and 0, or at least 1 and full");
		if (!(Number.isInteger(s.details.level) && s.details.level >= 0 && s.details.level <= 40)) fail(n, `level ${s.details.level} is not plausible`);
		if (!GROUPS.includes(s.details.role.secondary)) fail(n, `group "${s.details.role.secondary}" is not one of ${GROUPS.join("/")}`);
		if (!PRIMARY.includes(s.details.role.primary)) fail(n, `primary role "${s.details.role.primary}" is not one of ${PRIMARY.join("/")}`);
		if (!TERTIARY.includes(s.details.role.tertiary)) fail(n, `role "${s.details.role.tertiary}" is not one of ${TERTIARY.join("/")}`);
		if (typeof s.details.detection !== "string" || typeof s.details.countermeasures !== "string") fail(n, "detection and countermeasures are text");
		for (const k of ["ac", "fort", "ref", "wil"]) if (!Number.isInteger(s.defences[k].base)) fail(n, `defence ${k} is not a number`);
		if (!s.description && !s.details.detection && !s.details.countermeasures && !a.items.length) fail(n, "empty text");
		for (const p of a.items) {
			if (p.type !== "power") fail(n, `an item of a trap has type "${p.type}"`);
			if (!/^[A-Za-z0-9]{16}$/.test(p._id) || seen.has(p._id)) fail(n, "a power's _id is not a unique 16-char id");
			seen.add(p._id);
			if (!ENUMS.useType.includes(p.system.useType)) fail(n, `power useType "${p.system.useType}"`);
			if (!ENUMS.actionType.includes(p.system.actionType)) fail(n, `power actionType "${p.system.actionType}"`);
			if (p.system.attack.isAttack && !(/^-?\d+$/.test(p.system.attack.formula) && ["ac", "fort", "ref", "wil"].includes(p.system.attack.def))) fail(n, "an attack needs a number and a defence");
		}
		if (a.flags.dnd4e.import.kind !== "trap") fail(n, "import kind is not trap");
		const row = rows.get(a._id);
		if (!row) fail(n, "actor is not in the index");
		else if (row.level !== (s.details.level || row.level) && row.level !== null) fail(n, "index level differs from the actor's");
	}
	return errors;
}

async function main() {
	const here = path.dirname(fileURLToPath(import.meta.url));
	const argv = process.argv.slice(2);
	const dbDir = path.resolve(argv.includes("--db") ? argv[argv.indexOf("--db") + 1] : path.join(here, "out", "db"));
	const dir = path.join(dbDir, "trap");
	const index = JSON.parse(await readFile(path.join(dir, "_index.json"), "utf8"));
	const actors = [];
	for (const file of (await readdir(dir)).filter(f => f !== "_index.json")) actors.push(...JSON.parse(await readFile(path.join(dir, file), "utf8")));
	const errors = validateTraps(actors, index);
	if (index.length !== actors.length) errors.set(`index has ${index.length} rows, the files ${actors.length} actors`, { count: 1, examples: [] });
	if (!errors.size) { console.log(`Traps: ${actors.length} actors, no problems.`); return; }
	for (const [msg, e] of errors) console.log(`${e.count}x ${msg}  e.g. ${e.examples.join(", ")}`);
	process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
