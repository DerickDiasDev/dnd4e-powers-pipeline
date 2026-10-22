/**
 * Static validation of out/db/magic against the installed dnd4e system's enumerations (see system-enums.mjs): every value an
 * item would carry must be one the system knows, the tiers must be usable, and the index must agree with the files.
 *
 * Usage: node validate-magic.mjs [--db out/db]
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ENUMS } from "./system-enums.mjs";
import { effectProblems } from "./validate-effects.mjs";

/** @returns {Map<string, {count: number, examples: string[]}>} problems found, keyed by message */
export function validateMagic(entries, index) {
	const errors = new Map();
	const fail = (name, msg) => {
		const e = errors.get(msg) ?? { count: 0, examples: [] };
		e.count++;
		if (e.examples.length < 3) e.examples.push(name);
		errors.set(msg, e);
	};
	const inList = (name, field, value, list) => { if (!list.includes(value)) fail(name, `${field}: "${value}" not in [${list.join(",")}]`); };

	const seen = new Set();
	const effectIds = new Set();
	const rows = new Map(index.map(r => [r._id, r]));
	for (const e of entries) {
		const n = e.name;
		if (seen.has(e._id)) fail(n, "duplicate _id");
		seen.add(e._id);
		if (e.items.length !== 1 || e.items[0]._id !== e._id) fail(n, "a magic item has exactly one item, the entry itself");
		const item = e.items[0];
		const s = item.system;
		if (!/^[A-Za-z0-9]{16}$/.test(item._id)) fail(n, "item _id is not a 16-char id");
		if (!e.tiers.length) fail(n, "no tiers");
		for (let i = 1; i < e.tiers.length; i++) if (!(e.tiers[i].level > e.tiers[i - 1].level)) fail(n, "tiers are not in increasing level order");
		for (const t of e.tiers) {
			if (t.level !== null && !(Number.isInteger(t.level) && t.level >= 1 && t.level <= 40)) fail(n, `tier level ${t.level} is not 1-40`);
			if (t.enhancement !== null && !(t.enhancement >= 1 && t.enhancement <= 6)) fail(n, `enhancement ${t.enhancement} is not +1..+6`);
			if (t.price !== null && !(t.price >= 0)) fail(n, "tier price is not a number");
		}
		if (e.tiers.length > 1 && e.tiers.some(t => t.level === null || t.price === null)) fail(n, "a multi-level item must have a level and a price at every tier");
		if (item.flags.dnd4e.import.enhancePath && e.tiers.some(t => t.enhancement === null)) fail(n, "an item that takes an enhancement bonus has a tier without one");
		if (item.type === "weapon") {
			inList(n, "weaponType", s.weaponType, ENUMS.weaponTypes);
			for (const k of Object.keys(s.weaponGroup ?? {})) inList(n, "weapon group", k, ENUMS.weaponGroups);
			for (const k of Object.keys(s.implement ?? {})) inList(n, "implement", k, ENUMS.implements);
		} else if (item.type === "equipment") {
			inList(n, "armour type", s.armour.type, ENUMS.equipmentTypes);
			if (s.armour.type === "alternative") inList(n, "alternative subtype", s.armour.subtype, ENUMS.equipmentTypesAlt);
			if (s.armour.type === "armour") inList(n, "armour subtype", s.armour.subtype, ["", ...ENUMS.equipmentTypesArmour]);
		} else if (item.type === "consumable") inList(n, "consumableType", s.consumableType, ENUMS.consumableTypes);
		else if (item.type !== "loot") fail(n, `unexpected item type "${item.type}"`);
		for (const p of effectProblems(item, effectIds)) fail(n, `effect: ${p}`);
		if (item.effects.length && !["equipment", "weapon"].includes(item.type)) fail(n, "effects only on items that can be equipped");
		if (item.effects.some(f => f.system.equippedRec !== true)) fail(n, "an item's effect must be suppressed while the item is not equipped");
		const row = rows.get(e._id);
		if (!row) fail(n, "entry is not in the index");
		else if (JSON.stringify(row.items) !== JSON.stringify([item._id])) fail(n, "index items differ from the entry's items");
		else if (row.powerItems !== (e.powers ?? []).length) fail(n, "the index's power count differs from the entry's powers");

		// The powers the system copies to the actor while the item is equipped.
		if ((e.powers ?? []).length && !["equipment", "weapon"].includes(item.type)) fail(n, "powers only on items that can be equipped");
		for (const p of e.powers ?? []) {
			const s = p.system;
			if (p.type !== "power") fail(n, `a power of the item has type "${p.type}"`);
			if (!/^[A-Za-z0-9]{16}$/.test(p._id) || seen.has(p._id)) fail(n, "a power's _id is not a unique 16-char id");
			seen.add(p._id);
			inList(n, "power useType", s.useType, ENUMS.useType);
			inList(n, "power actionType", s.actionType, ENUMS.actionType);
			inList(n, "power rangeType", s.rangeType, ENUMS.rangeType);
			inList(n, "power powerSubtype", s.powerSubtype, ENUMS.powerSubtype);
			inList(n, "power attack.def", s.attack.def, ENUMS.defences);
			if (s.attack.isAttack && !/^-?\d+$/.test(s.attack.formula ?? "")) fail(n, "a power's attack without a number");
			if (s.hit.isDamage && !/^(?:\d+d\d+(?: [+-] \d+)?|\d+)$/.test(s.hit.formula ?? "")) fail(n, `a power's damage formula "${s.hit.formula}"`);
			const f = p.flags.dnd4e.import;
			if (f.kind !== "magic-power" || f.id !== e.id || f.role !== "power") fail(n, "a power's import flags");
			for (const sc of f.scaling ?? []) if (!sc.levels.length || !sc.levels.every(Number.isInteger) || !sc.text) fail(n, "a power's scaling entry");
			for (const problem of effectProblems(p, effectIds)) fail(n, `power effect: ${problem}`);
		}
	}
	return errors;
}

async function main() {
	const here = path.dirname(fileURLToPath(import.meta.url));
	const argv = process.argv.slice(2);
	const dbDir = path.resolve(argv.includes("--db") ? argv[argv.indexOf("--db") + 1] : path.join(here, "out", "db"));
	const dir = path.join(dbDir, "magic");
	const index = JSON.parse(await readFile(path.join(dir, "_index.json"), "utf8"));
	const entries = [];
	for (const file of (await readdir(dir)).filter(f => f !== "_index.json")) entries.push(...JSON.parse(await readFile(path.join(dir, file), "utf8")));
	const errors = validateMagic(entries, index);
	for (const r of index) if (!entries.some(e => e._id === r._id)) errors.set(`index row without an entry: ${r.name}`, { count: 1, examples: [r.name] });
	if (!errors.size) { console.log(`Magic items: ${entries.length} entries, no problems.`); return; }
	for (const [msg, e] of errors) console.log(`${e.count}x ${msg}  e.g. ${e.examples.join(", ")}`);
	process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
