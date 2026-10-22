/**
 * Companion creatures: the stat blocks of the extras -> structured -> NPC templates. The fixtures are invented (no book text).
 * The last block checks the real database when out/ exists.
 * Run: npm test
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseBlockHeading, parseCreature, parseCreatureType, parseDamage, parseDefences, parseHp, parseSpeed } from "../parse-companions.mjs";
import { buildCompanion, indexRow } from "../build-companions.mjs";
import { validateCompanions } from "../validate-companions.mjs";

const page = (body, extra = {}) => ({ id: "associate900", kind: "companion", name: "Zorb Hound", category: "Animal Companion", size: "Medium", creatureType: "Beast, Natural", body, sources: ["TST"], sourceCode: "TST", published: "", notes: [], ...extra });
const hound = () => page([
	"HP your bloodied value",
	"Initiative equal to yours",
	"AC 13, Fortitude 15, Reflex 11, Will 15 (add your level to each defense) | Perception equal to yours + 2",
	"Speed 6 | low-light vision",
	"☼ Zorb Aura ✦ Aura 1",
	"Allies gain a +2 power bonus to all defenses while in the aura.",
	"(⚔) Zorb Bite ✦ At-Will",
	"Attack: Melee 1 (one creature); your level + 5 vs. AC",
	"Hit: 1d12 + your Wisdom modifier + your Constitution modifier damage.",
	"Level 13: 1d12 + 3 + your Wisdom modifier + your Constitution modifier damage.",
	"Minor Action ✦ At-Will 1/round",
	"Effect: The hound walks, shifts, runs, stands up, squeezes, or crawls.",
	"Str 20 Dex 12 Wis 16",
	"Con 17 Int 2 Cha 6",
]);

describe("the pieces of a stat block", () => {
	test("creature type: origin, type and what is left", () => {
		assert.deepEqual(parseCreatureType("Cold, Elemental, Humanoid"), { origin: "elemental", type: "humanoid", other: ["Cold"] });
		assert.deepEqual(parseCreatureType(""), { origin: null, type: null, other: [] });
	});

	test("hit points: the master's bloodied value or surge value, or a number", () => {
		assert.deepEqual(parseHp("your bloodied value; Healing Surges none"), { mode: "bloodied" });
		assert.deepEqual(parseHp("your healing surge value; Healing Surges none"), { mode: "surge" });
		assert.deepEqual(parseHp("1; a missed attack never damages the companion"), { mode: "fixed", value: 1 });
		assert.equal(parseHp("infinite"), null);
	});

	test("defences: the master's with a bonus, the printed ones plus the master's level, or printed", () => {
		assert.deepEqual(parseDefences("Defenses your defenses + 2, not including any temporary bonuses"), { mode: "master", bonus: 2 });
		assert.deepEqual(parseDefences("Defenses your defenses -1, not including"), { mode: "master", bonus: -1 });
		assert.deepEqual(parseDefences("AC 13, Fortitude 15, Reflex 11, Will 15 (add your level to each defense)"), { mode: "levelPlus", ac: 13, fort: 15, ref: 11, wil: 15 });
		assert.equal(parseDefences("AC 28, Fortitude 24, Reflex 26, Will 22").mode, "fixed");
	});

	test("speed: land, the other modes and the notes", () => {
		assert.deepEqual(parseSpeed("land 8 , fly 10 ; phasing"), { walk: 8, modes: { fly: 10 }, notes: ["phasing"] });
		assert.deepEqual(parseSpeed("land 0 , fly 6 (hover; altitude limit 2)"), { walk: 0, modes: { fly: 6 }, notes: ["hover; altitude limit 2"] });
		assert.deepEqual(parseSpeed("6"), { walk: 6, modes: {}, notes: [] });
	});

	test("damage: dice, a number, the master's modifiers and half of the master's level", () => {
		assert.deepEqual(parseDamage("1d12 + your Wisdom modifier + your Constitution modifier damage."), { dice: "1d12", flat: 0, mods: ["wis", "con"], half: false });
		assert.deepEqual(parseDamage("2d12 + 5 + your Wisdom modifier cold damage, and the target is dazed."), { dice: "2d12", flat: 5, mods: ["wis"], half: false });
		assert.deepEqual(parseDamage("1d8 + one-half your level damage, and the dog teleports."), { dice: "1d8", flat: 0, mods: [], half: true });
		assert.deepEqual(parseDamage("15 psychic damage, and the target is dazed (save ends)."), { dice: null, flat: 15, mods: [], half: false });
		assert.equal(parseDamage("The target is dazed."), null);
	});

	test("a heading: the icon, the name when it has one, the action and usage, the limit", () => {
		assert.equal(parseBlockHeading("(⚔) Animal Attack ✦ At-Will").name, "Animal Attack");
		assert.equal(parseBlockHeading("⚔ Standard Action (necrotic, psychic) ✦ At-Will").name, null);
		const minor = parseBlockHeading("Minor Action ✦ At-Will 1/round");
		assert.deepEqual([minor.action, minor.usage, minor.limit], ["minor", "atwill", "1/round"]);
		assert.equal(parseBlockHeading("☼ Guardian Companion ✦ Aura 1").aura, 1);
	});
});

describe("a creature", () => {
	test("the numbers say how they are made; the blocks are a power, a move and an aura", () => {
		const c = parseCreature(hound());
		assert.deepEqual([c.hp, c.initiative, c.perception, c.senses, c.size, c.origin, c.type], [{ mode: "bloodied" }, { mode: "master" }, { mode: "master", bonus: 2 }, "low-light vision", "med", "natural", "beast"]);
		assert.deepEqual(c.abilities, { str: 20, dex: 12, wis: 16, con: 17, int: 2, cha: 6 });
		assert.deepEqual(c.powers.map(p => [p.name, p.action, p.limit]), [["Zorb Bite", "standard", null], ["Move", "minor", "1/round"]]);
		assert.deepEqual(c.traits.map(t => [t.name, t.aura]), [["Zorb Aura", 1]]);
		assert.deepEqual(c.powers[0].damage.map(d => [d.from, d.dice, d.flat, d.mods]), [[1, "1d12", 0, ["wis", "con"]], [13, "1d12", 3, ["wis", "con"]]]);
		assert.deepEqual(c.powers[0].levelAttack, { offset: 5, def: "ac" });
	});
});

describe("the NPC", () => {
	test("a template: how the numbers are made is in the flags, the attack follows the master's level, the damage has its levels", () => {
		const a = buildCompanion(parseCreature(hound()));
		assert.deepEqual([a.type, a.system.details.level, a.system.attributes.hp.max, a.system.details.role.secondary, a.system.movement.base.base, a.system.abilities.str.value], ["NPC", 0, 1, "companion", 6, 20]);
		const f = a.flags.dnd4e.import;
		assert.deepEqual([f.kind, f.companion.hp, f.companion.defences.mode, f.review.includes("master-numbers")], ["companion", { mode: "bloodied" }, "levelPlus", true]);
		const [bite, move, aura] = a.items;
		assert.deepEqual([bite.type, bite.system.attack.isAttack, bite.system.attack.def, bite.flags.dnd4e.import.attackLevelOffset, bite.system.rangeType, bite.system.hit.isDamage], ["power", true, "ac", 5, "melee", true]);
		assert.equal(bite.flags.dnd4e.import.companionDamage.length, 2);
		assert.deepEqual([move.system.actionType, aura.type, aura.system.auraSize], ["minor", "feature", "1"]);
		assert.ok(!f.review.includes("attack-unparsed"));
	});

	test("ids are deterministic, the index row has the monsters' shape, and what is built validates", () => {
		const c = parseCreature(hound());
		const a = buildCompanion(c), b = buildCompanion(c);
		assert.equal(a._id, b._id);
		const row = indexRow(a, c, "tst.json");
		assert.deepEqual([row.group, row.file, row.powers, row.traits, row.category], ["companion", "tst.json", 2, 1, "Animal Companion"]);
		assert.equal(validateCompanions([a], [row]).size, 0);
		a.flags.dnd4e.import.companion.hp = { mode: "nonsense" };
		assert.match([...validateCompanions([a], [row]).keys()].join(), /hit points/);
	});
});

describe("the real database", () => {
	const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "out", "db", "companion");
	const skip = existsSync(path.join(dir, "_index.json")) ? false : "out/db/companion not built";

	test("every companion validates and the well-known ones have the book's numbers", { skip }, async () => {
		const index = JSON.parse(await readFile(path.join(dir, "_index.json"), "utf8"));
		const actors = [];
		for (const f of (await readdir(dir)).filter(f => f !== "_index.json")) actors.push(...JSON.parse(await readFile(path.join(dir, f), "utf8")));
		assert.equal(validateCompanions(actors, index).size, 0);
		assert.equal(index.length, actors.length);
		assert.ok(actors.length >= 85);
		const bear = actors.find(a => a.name === "Bear Animal Companion");
		const f = bear.flags.dnd4e.import;
		assert.deepEqual([f.companion.hp, f.companion.defences, f.companion.perception], [{ mode: "bloodied" }, { mode: "levelPlus", ac: 13, fort: 15, ref: 11, wil: 15 }, { mode: "master", bonus: 2 }]);
		assert.deepEqual(bear.items[0].flags.dnd4e.import.companionDamage.map(d => [d.from, d.dice, d.flat]), [[1, "1d12", 0], [13, "1d12", 3], [23, "2d12", 5]]);
	});
});
