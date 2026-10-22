/**
 * Static validation of out/db/trap: the NPC actors a trap becomes, and that the index agrees with the files.
 *
 * Usage: node validate-traps.mjs [--db out/db]
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const GROUPS = ["standard", "elite", "solo", "minion"];

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
		if (a.type !== "NPC") fail(n, `actor type "${a.type}" is not NPC`);
		const s = a.system;
		if (s.advancedCals !== false) fail(n, "a trap uses the printed numbers (advancedCals false)");
		if (!(s.attributes.hp.max >= 1 && s.attributes.hp.value === s.attributes.hp.max)) fail(n, "hit points must be at least 1 and full");
		if (!(Number.isInteger(s.details.level) && s.details.level >= 0 && s.details.level <= 40)) fail(n, `level ${s.details.level} is not plausible`);
		if (!GROUPS.includes(s.details.role.secondary)) fail(n, `group "${s.details.role.secondary}" is not one of ${GROUPS.join("/")}`);
		for (const k of ["ac", "fort", "ref", "wil"]) if (!Number.isInteger(s.defences[k].base)) fail(n, `defence ${k} is not a number`);
		if (!s.biography) fail(n, "empty text");
		if (a.items.length) fail(n, "a trap has no powers as items");
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
