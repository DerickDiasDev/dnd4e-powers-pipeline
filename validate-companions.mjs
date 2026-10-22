/**
 * Static validation of out/db/companion: the NPCs the companion creatures become, how their numbers are made, and that the index
 * agrees with the files.
 *
 * Usage: node validate-companions.mjs [--db out/db]
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ENUMS } from "./system-enums.mjs";

const HP_MODES = ["bloodied", "surge", "fixed"];
const DEFENCE_MODES = ["master", "levelPlus", "fixed"];
const ABILITIES = ["str", "con", "dex", "int", "wis", "cha"];

/** @returns {Map<string, {count: number, examples: string[]}>} problems found, keyed by message */
export function validateCompanions(actors, index) {
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
		if (!ENUMS.sizes.includes(s.details.size)) fail(n, `size "${s.details.size}"`);
		if (!ENUMS.origins.includes(s.details.origin)) fail(n, `origin "${s.details.origin}"`);
		for (const k of ABILITIES) if (!Number.isInteger(s.abilities[k]?.value)) fail(n, `ability ${k} is not a number`);
		const c = a.flags.dnd4e.import.companion;
		if (a.flags.dnd4e.import.kind !== "companion") fail(n, "import kind is not companion");
		if (!c) { fail(n, "no companion flags"); continue; }
		if (!c.hp || !HP_MODES.includes(c.hp.mode)) fail(n, "hit points have no known mode");
		if (c.hp?.mode === "fixed" && !(c.hp.value >= 1)) fail(n, "fixed hit points under 1");
		if (!c.defences || !DEFENCE_MODES.includes(c.defences.mode)) fail(n, "defences have no known mode");
		if (c.defences && c.defences.mode !== "master") for (const k of ["ac", "fort", "ref", "wil"]) if (!Number.isInteger(c.defences[k])) fail(n, `defence ${k} is not a number`);
		for (const p of a.items) {
			if (!/^[A-Za-z0-9]{16}$/.test(p._id) || seen.has(p._id)) fail(n, "an item's _id is not a unique 16-char id");
			seen.add(p._id);
			if (p.type === "power") {
				if (!ENUMS.useType.includes(p.system.useType)) fail(n, `power useType "${p.system.useType}"`);
				if (!ENUMS.actionType.includes(p.system.actionType)) fail(n, `power actionType "${p.system.actionType}"`);
				const f = p.flags.dnd4e.import;
				if (p.system.attack.isAttack && !((f.attackLevelOffset >= 0 || /^-?\d+$/.test(p.system.attack.formula)) && ["ac", "fort", "ref", "wil"].includes(p.system.attack.def))) fail(n, "an attack is the master's level plus a number, or a number, against a defence");
				for (const d of f.companionDamage ?? []) {
					if (!(d.from >= 1) || (!d.dice && !(d.flat >= 0))) fail(n, "a damage entry needs a level and dice or a number");
					for (const m of d.mods) if (!ABILITIES.includes(m)) fail(n, `damage modifier "${m}"`);
				}
			} else if (p.type !== "feature") fail(n, `an item of a companion has type "${p.type}"`);
		}
		const row = rows.get(a._id);
		if (!row) fail(n, "actor is not in the index");
		else if (row.powers !== a.items.filter(i => i.type === "power").length) fail(n, "index power count differs");
	}
	return errors;
}

async function main() {
	const here = path.dirname(fileURLToPath(import.meta.url));
	const argv = process.argv.slice(2);
	const dbDir = path.resolve(argv.includes("--db") ? argv[argv.indexOf("--db") + 1] : path.join(here, "out", "db"));
	const dir = path.join(dbDir, "companion");
	const index = JSON.parse(await readFile(path.join(dir, "_index.json"), "utf8"));
	const actors = [];
	for (const file of (await readdir(dir)).filter(f => f !== "_index.json")) actors.push(...JSON.parse(await readFile(path.join(dir, file), "utf8")));
	const errors = validateCompanions(actors, index);
	if (index.length !== actors.length) errors.set(`index has ${index.length} rows, the files ${actors.length} actors`, { count: 1, examples: [] });
	if (!errors.size) { console.log(`Companions: ${actors.length} actors, no problems.`); return; }
	for (const [msg, e] of errors) console.log(`${e.count}x ${msg}  e.g. ${e.examples.join(", ")}`);
	process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
