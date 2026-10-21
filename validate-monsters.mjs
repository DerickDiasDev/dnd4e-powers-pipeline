/**
 * Static validation of out/db/monster against the installed dnd4e system's enumerations (see system-enums.mjs): every value
 * the importer would write into an NPC actor or one of its items must be one the system knows.
 *
 * Usage: node validate-monsters.mjs [--db out/db]
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ENUMS } from "./system-enums.mjs";
import { effectProblems } from "./validate-effects.mjs";

const ROLES = ["", "artillery", "brute", "controller", "lurker", "skirmisher", "soldier", "defender", "leader", "striker"];
const SECONDARY = ["standard", "elite", "solo", "minion", "companion", "other"];
const TYPES = ["animate", "beast", "humanoid", "magical"];
const SENSES = ["nv", "lv", "bs", "dv", "ts", "tr"];
const SPECIAL_SENSES = ["bs", "ts", "tr"];
const SPEEDS = ["base", "fly", "climb", "swim", "burrow", "teleport"];
const DAMAGE_FORMULA = /^\d+(?:d\d+)?(?: [+-] \d+)?$/;
const int = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;

/** @returns {Map<string, {count: number, examples: string[]}>} problems found, keyed by message */
export function validateMonsters(actors, index, effectIds = new Set()) {
	const errors = new Map();
	const fail = (name, msg) => {
		const e = errors.get(msg) ?? { count: 0, examples: [] };
		e.count++;
		if (e.examples.length < 3) e.examples.push(name);
		errors.set(msg, e);
	};
	const inList = (name, field, value, list) => { if (!list.includes(value)) fail(name, `${field}: "${value}" not in [${list.join(",")}]`); };
	const seen = new Set();
	const rowById = new Map(index.map(r => [r._id, r]));

	for (const a of actors) {
		const n = a.name;
		const s = a.system;
		if (a.type !== "NPC") fail(n, `type "${a.type}" is not NPC`);
		if (!/^[A-Za-z0-9]{16}$/.test(a._id)) fail(n, "_id is not a 16-char id");
		if (seen.has(a._id)) fail(n, "duplicate actor _id");
		seen.add(a._id);
		if (!n) fail(a._id, "actor without a name");
		if (!/^[a-z0-9_-]+$/i.test(s.identifier)) fail(n, "identifier has characters the IdentifierField rejects");
		if (s.advancedCals !== false) fail(n, "advancedCals must be false: the printed numbers are the values");

		const d = s.details;
		if (!int(d.level, 0, 40)) fail(n, `level ${d.level}`);
		if (!int(d.exp, 0, 1e7)) fail(n, `xp ${d.exp}`);
		inList(n, "size", d.size, ENUMS.sizes);
		inList(n, "origin", d.origin, ENUMS.origins);
		inList(n, "type", d.type, TYPES);
		inList(n, "role.primary", d.role.primary, ROLES);
		inList(n, "role.secondary", d.role.secondary, SECONDARY);
		if (typeof d.role.leader !== "boolean") fail(n, "role.leader is not a boolean");

		for (const k of ENUMS.abilities) if (!int(s.abilities[k]?.value, 1, 60)) fail(n, `ability ${k} is not a sensible score`);
		if (!int(s.attributes.hp.max, 1, 5000) || s.attributes.hp.value !== s.attributes.hp.max) fail(n, "hit points are not a positive whole number, full");
		if (!int(s.attributes.init.base, -10, 60)) fail(n, `initiative ${s.attributes.init.base}`);
		for (const k of ENUMS.defences) if (!int(s.defences[k]?.base, 0, 80)) fail(n, `defence ${k} ${s.defences[k]?.base}`);
		for (const k of ENUMS.skills) if (!int(s.skills[k]?.base, -10, 80)) fail(n, `skill ${k} ${s.skills[k]?.base}`);
		for (const [k, v] of Object.entries(s.movement)) {
			inList(n, "movement mode", k, SPEEDS);
			if (k === "base" ? !int(v.base, 0, 30) : !/^\d+$/.test(v.formula ?? "")) fail(n, `movement ${k} is not a plain number`);
		}
		inList(n, "senses.basic", s.senses.basic, SENSES);
		for (const [k, v] of Object.entries(s.senses.special)) { inList(n, "special sense", k, SPECIAL_SENSES); if (v.value !== true) fail(n, "special sense without value true"); }
		for (const l of s.languages.spoken.value) inList(n, "spoken language", l, ENUMS.spoken);
		for (const [k, v] of Object.entries(s.resistances)) {
			inList(n, "resistance type", k, ENUMS.damageTypes);
			if (v.res !== undefined && !int(v.res, 1, 200)) fail(n, "resistance is not a positive number");
			if (v.vuln !== undefined && !int(v.vuln, -200, -1)) fail(n, "vulnerability must be negative");
		}
		if (s.actionpoints && !int(s.actionpoints.value, 0, 10)) fail(n, "action points");

		if (a.prototypeToken.width !== a.prototypeToken.height || !int(a.prototypeToken.width, 1, 4)) fail(n, "token size");

		for (const item of a.items) {
			if (!/^[A-Za-z0-9]{16}$/.test(item._id)) fail(n, "item _id is not a 16-char id");
			if (seen.has(item._id)) fail(n, "duplicate item _id");
			seen.add(item._id);
			if (!item.name) fail(n, "item without a name");
			for (const p of effectProblems(item, effectIds)) fail(n, `effect: ${p}`);
			if (item.type === "power") {
				const p = item.system;
				inList(n, "useType", p.useType, ENUMS.useType);
				inList(n, "actionType", p.actionType, ENUMS.actionType);
				inList(n, "rangeType", p.rangeType, ENUMS.rangeType);
				inList(n, "powerType", p.powerType, ENUMS.powerType);
				inList(n, "powerSubtype", p.powerSubtype, ENUMS.powerSubtype);
				inList(n, "attack.def", p.attack.def, ENUMS.defences);
				if (p.weaponType !== "none") fail(n, "a monster power must not ask for a weapon");
				if (p.attack.isAttack && !/^-?\d+$/.test(p.attack.formula ?? "")) fail(n, "attack without a printed bonus");
				if (p.hit.isDamage && !DAMAGE_FORMULA.test(p.hit.formula ?? "")) fail(n, `damage formula "${p.hit.formula}"`);
				if (p.hit.isDamage && !/^\d+(?: [+-] \d+)?$/.test(p.hit.critFormula ?? "")) fail(n, `crit formula "${p.hit.critFormula}"`);
				if (JSON.stringify(Object.keys(p.damageType)) !== JSON.stringify(ENUMS.damageTypes)) fail(n, "damageType map keys differ from the system's");
				if (JSON.stringify(Object.keys(p.effectType)) !== JSON.stringify(ENUMS.effectTypes)) fail(n, "effectType map keys differ from the system's");
			} else if (item.type === "feature") {
				if (item.system.featureType !== "trait") fail(n, `feature of type "${item.system.featureType}"`);
			} else fail(n, `item type "${item.type}"`);
		}

		const row = rowById.get(a._id);
		if (!row) fail(n, "monster is not in the index");
		else if (row.powers !== a.items.filter(i => i.type === "power").length || row.traits !== a.items.filter(i => i.type === "feature").length) fail(n, "index counts differ from the actor's items");
	}
	return errors;
}

async function main() {
	const here = path.dirname(fileURLToPath(import.meta.url));
	const argv = process.argv.slice(2);
	const dbDir = path.resolve(argv.includes("--db") ? argv[argv.indexOf("--db") + 1] : path.join(here, "out", "db"));
	const index = JSON.parse(await readFile(path.join(dbDir, "monster", "_index.json"), "utf8"));
	const actors = [];
	for (const file of new Set(index.map(r => r.file))) actors.push(...JSON.parse(await readFile(path.join(dbDir, "monster", file), "utf8")));
	const errors = validateMonsters(actors, index);
	if (!errors.size) { console.log(`Monsters: ${actors.length} actors, no problems.`); return; }
	for (const [msg, e] of [...errors].sort((a, b) => b[1].count - a[1].count)) console.log(`${e.count}x ${msg}  e.g. ${e.examples.join(", ")}`);
	process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
