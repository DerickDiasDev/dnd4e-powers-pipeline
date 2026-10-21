/**
 * Static validation of out/db against the installed dnd4e system's enumerations (see system-enums.mjs).
 * It catches wrong keys, bad formulas and broken parent links. It cannot replace validating inside Foundry:
 * run macros/validate-powers.js there too, which checks the items against the real PowerData model.
 *
 * Usage: node validate-db.mjs [--db out/db]
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ENUMS } from "./system-enums.mjs";
import { effectProblems } from "./validate-effects.mjs";

const root = path.dirname(fileURLToPath(import.meta.url));
const dbDir = path.resolve(process.argv.includes("--db") ? process.argv[process.argv.indexOf("--db") + 1] : path.join(root, "out", "db"));

const index = JSON.parse(await readFile(path.join(dbDir, "power", "_index.json"), "utf8"));
const items = [];
for (const file of new Set(index.map(e => e.file))) items.push(...JSON.parse(await readFile(path.join(dbDir, "power", file), "utf8")));

const errors = new Map();
const fail = (item, msg) => {
	const e = errors.get(msg) ?? { count: 0, examples: [] };
	e.count++;
	if (e.examples.length < 3) e.examples.push(item.name);
	errors.set(msg, e);
};

const inEnum = (item, field, value, list, allowEmpty = false) => {
	if (allowEmpty && value === "") return;
	if (!list.includes(value)) fail(item, `${field}: "${value}" not in [${list.join(",")}]`);
};

// Formula tokens the system defines in Item#getRollData / the actor roll data
const FORMULA_OK = /^(?:\s|\d+(?:d\d+)?|\+|-|\*|\/|\(|\)|,|max|@(?:powBase|powMax|powerMod|wepDamage|wepCritBonus|wepAttack|lvhalf|maxMod|primaryMod|(?:str|con|dex|int|wis|cha)Mod|abilities\.(?:str|con|dex|int|wis|cha)\.mod))+$/;

const ids = new Set();
const effectIds = new Set();
const idSet = new Set(items.map(i => i._id));
for (const item of items) {
	const s = item.system;
	for (const problem of effectProblems(item, effectIds)) fail(item, `effect: ${problem}`);
	if (item.type !== "power") fail(item, `type "${item.type}" is not power`);
	if (!/^[A-Za-z0-9]{16}$/.test(item._id)) fail(item, "_id is not a 16-char alphanumeric id");
	if (ids.has(item._id)) fail(item, "duplicate _id");
	ids.add(item._id);
	if (!item.name) fail(item, "empty name");

	inEnum(item, "powerType", s.powerType, ENUMS.powerType);
	inEnum(item, "powerSubtype", s.powerSubtype, ENUMS.powerSubtype);
	inEnum(item, "useType", s.useType, ENUMS.useType);
	inEnum(item, "actionType", s.actionType, ENUMS.actionType);
	inEnum(item, "weaponType", s.weaponType, ENUMS.weaponType);
	inEnum(item, "rangeType", s.rangeType, ENUMS.rangeType);
	inEnum(item, "powersource", s.powersource, ENUMS.powerSource, true);
	inEnum(item, "secondPowersource", s.secondPowersource, ENUMS.powerSource, true);
	inEnum(item, "autoTarget.mode", s.autoTarget.mode, ENUMS.autoTarget);
	inEnum(item, "attack.ability", s.attack.ability, ENUMS.abilities, true);
	inEnum(item, "attack.def", s.attack.def, ENUMS.defences);
	inEnum(item, "sustain.actionType", s.sustain.actionType, ENUMS.actionType, true);
	if (s.hit.baseDiceType !== undefined) inEnum(item, "hit.baseDiceType", s.hit.baseDiceType, ENUMS.diceTypes);

	if (s.level !== null && !Number.isInteger(s.level)) fail(item, "level is not an integer or null");
	if (JSON.stringify(Object.keys(s.damageType)) !== JSON.stringify(ENUMS.damageTypes)) fail(item, "damageType map keys differ from the system's damageTypes");
	if (JSON.stringify(Object.keys(s.effectType)) !== JSON.stringify(ENUMS.effectTypes)) fail(item, "effectType map keys differ from the system's effectTypes");

	for (const f of ["formula", "critFormula"]) {
		const v = s.hit[f];
		if (v !== undefined && !FORMULA_OK.test(v)) fail(item, `hit.${f} has an unknown token`);
	}
	if (s.attack.formula !== undefined && !FORMULA_OK.test(s.attack.formula)) fail(item, "attack.formula has an unknown token");
	if (s.hit.isDamage && s.hit.formula === undefined) fail(item, "hit.isDamage without a hit.formula");
	if (!s.hit.isDamage && s.hit.formula !== undefined) fail(item, "hit.formula without hit.isDamage");
	if (s.attack.isAttack && !s.attack.ability) { /* symbolic attack ability: allowed, flagged in review */ }
	if (!/^[a-z0-9_-]+$/i.test(s.identifier)) fail(item, "identifier has characters the IdentifierField rejects");
	if (typeof s.area !== "string" || typeof s.rangePower !== "string") fail(item, "area/rangePower must be strings");
	if (s.rangeType === "closeBurst" && !(Number(s.area) > 0)) fail(item, "closeBurst without an area size");
	const reviewed = (item.flags?.dnd4e?.import?.review ?? []).some(r => r.startsWith("range-origin"));
	if (s.rangeType === "rangeBurst" && !(Number(s.area) > 0 && Number(s.rangePower) > 0) && !reviewed) fail(item, "rangeBurst without area size or range, and not flagged");

	const imp = item.flags?.dnd4e?.import ?? {};
	if (!["main", "variant", "child"].includes(imp.role)) fail(item, `import.role "${imp.role}" is not main/variant/child`);
	if (!idSet.has(imp.bundle)) fail(item, "import.bundle id does not exist in the DB");
	if (imp.role === "main" && imp.bundle !== item._id) fail(item, "main item must be its own bundle");
	if (imp.role === "variant" && !["melee", "ranged"].includes(imp.variant) && !ENUMS.abilities.includes(imp.ability)) fail(item, "variant item with neither melee/ranged nor an ability");
	if (imp.variant !== undefined && !["melee", "ranged"].includes(imp.variant)) fail(item, "variant is not melee/ranged");
	if (imp.ability !== undefined && !ENUMS.abilities.includes(imp.ability)) fail(item, "ability is not one of the six");
}

const quality = {};
for (const e of index) quality[e.quality] = (quality[e.quality] ?? 0) + 1;
console.log(`Checked ${items.length} items from ${index.length} powers (${[...new Set(index.map(e => e.file))].length} files).`);
if (!errors.size) console.log("OK: no static errors.");
else {
	console.log(`${[...errors.values()].reduce((a, b) => a + b.count, 0)} problems:`);
	for (const [msg, e] of [...errors.entries()].sort((a, b) => b[1].count - a[1].count)) console.log(`  ${String(e.count).padStart(5)}  ${msg}  (${e.examples.join(", ")})`);
	process.exitCode = 1;
}

// Index consistency: every id in `items` exists, starts with the main item, and variants match the items' own flags.
{
	const byId = new Map(items.map(i => [i._id, i]));
	let bad = 0;
	for (const row of index) {
		const list = row.items.map(id => byId.get(id));
		const ok = list.every(Boolean) && list[0]?._id === row._id
			&& list.every(i => i.flags.dnd4e.import.bundle === row._id)
			&& JSON.stringify(row.variants) === JSON.stringify([...new Set(list.filter(i => i.flags.dnd4e.import.variant).map(i => i.flags.dnd4e.import.variant))])
			&& JSON.stringify(row.abilities) === JSON.stringify([...new Set(list.filter(i => i.flags.dnd4e.import.ability).map(i => i.flags.dnd4e.import.ability))]);
		if (!ok) { bad++; if (bad <= 3) console.log(`  index row inconsistent: ${row.name}`); }
	}
	if (bad) { console.log(`${bad} index rows inconsistent`); process.exitCode = 1; }
	else console.log(`Index OK: ${index.length} rows, ${index.filter(r => r.variants.length).length} with melee/ranged variants, ${index.filter(r => r.children).length} with children.`);
}
