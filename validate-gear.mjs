/**
 * Static validation of out/db/gear against the installed dnd4e system's enumerations (see system-enums.mjs): every value an
 * item would carry must be one the system knows, so a weapon type or a property the system does not have fails here and
 * not as a silently ignored field in Foundry.
 *
 * Usage: node validate-gear.mjs [--db out/db]
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ENUMS, labelMap } from "./system-enums.mjs";

const BASE_TABLES = ["simpleM", "simpleR", "militaryM", "militaryR", "superiorM", "superiorR"];
const ARMOUR_BASES = { light: ["cloth", "leather", "hide"], heavy: ["chain", "scale", "plate"] };

/** @returns {Map<string, {count: number, examples: string[]}>} problems found, keyed by message */
export function validateGear(entries, index) {
	const errors = new Map();
	const fail = (name, msg) => {
		const e = errors.get(msg) ?? { count: 0, examples: [] };
		e.count++;
		if (e.examples.length < 3) e.examples.push(name);
		errors.set(msg, e);
	};
	const inList = (name, field, value, list) => { if (!list.includes(value)) fail(name, `${field}: "${value}" not in [${list.join(",")}]`); };
	const baseKeys = Object.fromEntries(BASE_TABLES.map(t => [t, [...labelMap(t).values()]]));

	const seen = new Set();
	for (const e of entries) {
		const n = e.name;
		if (!e.items.length || e.items[0]._id !== e._id) fail(n, "the first item must be the entry itself");
		for (const item of e.items) {
			const s = item.system;
			if (!/^[A-Za-z0-9]{16}$/.test(item._id)) fail(n, "item _id is not a 16-char id");
			if (seen.has(item._id)) fail(n, "duplicate item _id");
			seen.add(item._id);
			if (item.flags.dnd4e.import.bundle !== e._id) fail(n, "item bundle does not point at the entry");
			if (!(s.price >= 0) || !(s.weight >= 0)) fail(n, "price or weight is not a non-negative number");
			if (item.type === "weapon") {
				inList(n, "weaponType", s.weaponType, ENUMS.weaponTypes);
				inList(n, "weaponHand", s.weaponHand, ENUMS.weaponHands);
				for (const k of Object.keys(s.properties)) inList(n, "property", k, ENUMS.weaponProperties);
				for (const k of Object.keys(s.weaponGroup)) inList(n, "weapon group", k, ENUMS.weaponGroups);
				for (const k of Object.keys(s.implement ?? {})) inList(n, "implement", k, ENUMS.implements);
				if (s.weaponType === "implement") inList(n, "implement base type", s.weaponBaseType, ["", ...ENUMS.implements]);
				else if (s.weaponBaseType) inList(n, "weapon base type", s.weaponBaseType, baseKeys[s.weaponType] ?? []);
				for (const part of s.damageDice?.parts ?? []) {
					if (!/^\d+$/.test(part.numDice) || !/^\d+$/.test(part.numFaces)) fail(n, "damage dice are not NdM");
				}
				if (s.weaponType !== "implement" && !s.damageDice.parts.length) fail(n, "weapon without damage dice");
				if (s.isRanged && !s.range) fail(n, "ranged weapon without a range");
				if (s.range && !(s.range.value > 0 && s.range.long >= s.range.value)) fail(n, "range is not short <= long");
			} else if (item.type === "equipment") {
				const a = s.armour;
				inList(n, "armour type", a.type, ENUMS.equipmentTypes);
				if (a.type === "armour") {
					inList(n, "armour subtype", a.subtype, ENUMS.equipmentTypesArmour);
					inList(n, "armour base type", s.armourBaseType, ["", ...(ARMOUR_BASES[a.subtype] ?? [])]);
					if (!(a.ac >= 0 && a.ac <= 16)) fail(n, "armour bonus is not plausible");
				} else if (a.type === "arms") {
					inList(n, "shield subtype", a.subtype, ["light", "heavy"]);
					inList(n, "shield base type", s.shieldBaseType, ["light", "heavy"]);
					if (a.ac !== a.ref) fail(n, "a shield must give the same bonus to AC and Reflex");
				}
				if (a.movePen && !(a.movePenValue < 0)) fail(n, "speed penalty must be negative");
				if (a.skillCheck && !(a.skillCheckValue < 0)) fail(n, "check penalty must be negative");
			} else if (item.type === "consumable") {
				inList(n, "consumableType", s.consumableType, ENUMS.consumableTypes);
				if (!(Number.isInteger(s.quantity) && s.quantity >= 1)) fail(n, "ammunition quantity is not a positive integer");
			} else if (item.type !== "loot") fail(n, `unexpected item type "${item.type}"`);
		}
		const row = index.find(r => r.id === e.id);
		if (!row) fail(n, "entry is not in the index");
		else if (JSON.stringify(row.items) !== JSON.stringify(e.items.map(i => i._id))) fail(n, "index items differ from the entry's items");
	}
	return errors;
}

async function main() {
	const here = path.dirname(fileURLToPath(import.meta.url));
	const argv = process.argv.slice(2);
	const dbDir = path.resolve(argv.includes("--db") ? argv[argv.indexOf("--db") + 1] : path.join(here, "out", "db"));
	const entries = JSON.parse(await readFile(path.join(dbDir, "gear", "gear.json"), "utf8"));
	const index = JSON.parse(await readFile(path.join(dbDir, "gear", "_index.json"), "utf8"));
	const errors = validateGear(entries, index);
	if (!errors.size) { console.log(`Gear: ${entries.length} entries, no problems.`); return; }
	for (const [msg, e] of errors) console.log(`${e.count}x ${msg}  e.g. ${e.examples.join(", ")}`);
	process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
