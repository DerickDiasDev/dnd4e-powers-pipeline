/**
 * The powers of magic items as power items: headings, lines, scaling, and what the converter makes of them. The fixtures are
 * invented (no book text). The last block checks the real database when out/ exists.
 * Run: npm test
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildItemPowers, parseHeading, parseLines } from "../item-powers.mjs";
import { buildMagic } from "../build-magic.mjs";
import { parseMagic } from "../parse-magic.mjs";
import { validateMagic } from "../validate-magic.mjs";

const para = (text, indent) => ({ text, ...(indent ? { indent } : {}) });
const item = (sections, extra = {}) => ({
	id: "weapon900", name: "Zorb Blade", category: "Weapon", type: "Longsword", rarity: "Uncommon", flavor: "", sources: ["TST"], sourceCode: "TST", published: "",
	tiers: [{ level: 4, enhancement: 1, price: 840 }, { level: 9, enhancement: 2, price: 4200 }], scales: true, stats: {}, intro: [], sections, notes: [], ...extra,
});

describe("headings", () => {
	test("kind, keywords, usage and action", () => {
		assert.deepEqual(parseHeading("⚔ Attack Power (Lightning) ✦ Daily (Minor Action)"), { icon: "⚔", kind: "attack", keywords: ["Lightning"], usage: "daily", action: "minor" });
		assert.deepEqual(parseHeading("Utility Power (Healing, Radiant) ✦ Encounter (Move Action)"), { icon: null, kind: "utility", keywords: ["Healing", "Radiant"], usage: "encounter", action: "move" });
		assert.deepEqual(parseHeading("Power ✦ At-Will (Standard Action)"), { icon: null, kind: null, keywords: [], usage: "atwill", action: "standard" });
		assert.deepEqual(parseHeading("Power ✦ Encounter Utility (Free Action)").kind, "utility");
		assert.deepEqual([parseHeading("Power ✦ Consumable (Minor Action)").usage, parseHeading("Power ✦ Daily").action], ["item", null]);
		assert.equal(parseHeading("Power (Free Action) ✦ Daily").action, "free", "an action written before the star");
		assert.equal(parseHeading("Power ✦ Daily (Immediate Interrupt)").action, "interrupt");
	});
});

describe("lines and scaling", () => {
	test("labelled lines, and the lines that follow a level with their numbers", () => {
		const { lines, scaling } = parseLines([para("Trigger: You hit.", 1), para("Effect: You deal 2 extra damage.", 1), para("Level 7: 4 extra damage.", 2), para("Level 12 or 17: 6 extra damage.", 2), para("Levels 22, 27: 8 extra damage.", 2)]);
		assert.deepEqual(lines, [{ label: "Trigger", text: "You hit." }, { label: "Effect", text: "You deal 2 extra damage." }]);
		assert.deepEqual(scaling, [{ line: "effect", levels: [7], text: "4 extra damage." }, { line: "effect", levels: [12, 17], text: "6 extra damage." }, { line: "effect", levels: [22, 27], text: "8 extra damage." }]);
	});

	test("an unlabelled line is plain text; a scaling line belongs to the line before it", () => {
		const { lines, scaling } = parseLines([para("Regain hit points."), para("Level 5: Regain more.")]);
		assert.deepEqual([lines.length, scaling[0].line], [1, ""]);
	});
});

describe("building", () => {
	test("a daily free-action power: usage, action, trigger and effect, with its scaling in the flags", () => {
		const m = item([{ heading: "Power ✦ Daily (Free Action)", paragraphs: [para("Trigger: You hit a Large creature.", 1), para("Effect: You deal 2 extra damage.", 1), para("Level 9: 4 extra damage.", 2)] }]);
		const [p] = buildItemPowers(m);
		assert.deepEqual([p.type, p.name, p.system.useType, p.system.actionType, p.system.trigger, p.system.effect.detail], ["power", "Zorb Blade", "daily", "free", "You hit a Large creature.", "You deal 2 extra damage."]);
		assert.deepEqual(p.flags.dnd4e.import.scaling, [{ line: "effect", levels: [9], text: "4 extra damage." }]);
		assert.deepEqual([p.flags.dnd4e.import.kind, p.flags.dnd4e.import.id, p.flags.dnd4e.import.role, p.flags.dnd4e.import.section], ["magic-power", "weapon900", "power", 0]);
		assert.equal(p.system.level, 4);
	});

	test("an attack that is the item's level plus a number follows the level; a plain +N is the number", () => {
		const level = item([{ heading: "⚔ Attack Power (Lightning) ✦ Daily (Minor Action)", paragraphs: [para("Attack: Close blast 5 (one enemy); the weapon's level + 3 vs. Reflex", 1), para("Hit: 1d8 lightning damage.", 1), para("Level 9: 2d8 lightning damage.", 2)] }]);
		const [p] = buildItemPowers(level);
		assert.deepEqual([p.system.attack.isAttack, p.system.attack.def, p.system.attack.formula, p.flags.dnd4e.import.attackLevelOffset], [true, "ref", "7", 3]);
		assert.deepEqual([p.system.powerSubtype, p.system.hit.isDamage, p.system.hit.formula, p.system.damageType.lightning], ["attack", true, "1d8", true]);
		assert.ok(!(p.flags.dnd4e.import.review ?? []).includes("attack-unparsed"));
		const plain = item([{ heading: "Attack Power ✦ Encounter (Standard Action)", paragraphs: [para("Attack: Ranged 10 (one creature); +8 vs. Will", 1), para("Hit: 2d6 + 3 psychic damage.", 1)] }]);
		const [q] = buildItemPowers(plain);
		assert.deepEqual([q.system.attack.formula, q.system.attack.def, q.system.hit.formula, q.flags.dnd4e.import.attackLevelOffset], ["8", "wil", "2d6 + 3", undefined]);
	});

	test("a condition the power applies is an effect", () => {
		const m = item([{ heading: "Power ✦ Encounter (No Action)", paragraphs: [para("Trigger: You hit an undead creature.", 1), para("Effect: The creature is immobilized (save ends).", 1)] }]);
		const [p] = buildItemPowers(m);
		assert.deepEqual(p.effects.map(e => e.statuses), [["immobilized"]]);
		assert.equal(p.effects[0].transfer, false);
	});

	test("several powers get names that tell them apart; an item without powers has none", () => {
		const m = item([
			{ heading: "Power ✦ Daily (Free Action)", paragraphs: [para("Effect: One.", 1)] },
			{ heading: "Power ✦ Encounter (Minor Action)", paragraphs: [para("Effect: Two.", 1)] },
			{ heading: "Properties", paragraphs: [para("Not a power.")] },
		]);
		assert.deepEqual(buildItemPowers(m).map(p => p.name), ["Zorb Blade (Daily)", "Zorb Blade (Encounter)"]);
		assert.deepEqual(buildItemPowers(item([{ heading: "Properties", paragraphs: [para("x")] }])), []);
		assert.equal(new Set(buildItemPowers(m).map(p => p._id)).size, 2);
	});
});

describe("in the entry", () => {
	const page = `<h1 class=mihead>Zorb Blade<span class=milevel>Level 4+ Uncommon</span></h1><p class=miflavor>f</p><table class=magicitem><tr><td class=mic1>Lvl 4<td class=mic2>+1<td class=mic3>840 gp<tr><td class=mic1>Lvl 9<td class=mic2>+2<td class=mic3>4,200 gp</table><p class=mistat><b>Weapon: </b>Longsword</p><h2 class=mihead>Power ✦ Daily (Free Action)</h2><p class='mistat indent'><i>Trigger:</i> You hit.</p><p class='mistat indent'><i>Effect:</i> Two extra damage.</p><p class='mistat indent1'><i>Level 9:</i> Four extra damage.</p>`;
	const consumable = `<h1 class=mihead>Zorb Oil<span class=milevel>Level 3 Uncommon</span></h1><p class=miflavor>f</p><p class=mistat><b>Consumable: </b>Oil        30 gp</p><h2 class=mihead>Power ✦ Consumable (Standard Action)</h2><p class='mistat indent'>Apply it.</p>`;
	const entry = html => buildMagic(parseMagic({ id: "weapon901", listing: { Name: "Zorb Blade", Type: "Longsword", Rarity: "Uncommon", SourceBook: "TST", Cost: "" }, html }));

	test("an item that can be equipped has its powers in the entry and a note; a consumable keeps them in the text", () => {
		const e = entry(page);
		assert.deepEqual([e.powers.length, e.notes.includes("powers-linked"), e.notes.includes("powers-in-text")], [1, true, false]);
		assert.equal(e.powers[0].flags.dnd4e.import.scaling[0].levels[0], 9);
		const c = buildMagic(parseMagic({ id: "item901", listing: { Name: "Zorb Oil", Category: "Consumable", Type: "Alchemical Item", Rarity: "Uncommon", SourceBook: "TST", Cost: "30 gp" }, html: consumable }));
		assert.deepEqual([c.powers.length, c.notes.includes("powers-in-text")], [0, true]);
	});

	test("what is built validates; the validator rejects a power with a bad action", () => {
		const e = entry(page);
		const row = { _id: e._id, items: [e._id], powerItems: 1 };
		assert.equal(validateMagic([e], [row]).size, 0);
		e.powers[0].system.actionType = "nonsense";
		assert.match([...validateMagic([e], [row]).keys()].join(), /actionType/);
	});
});

describe("the real database", () => {
	const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "out", "db", "magic");
	const skip = existsSync(path.join(dir, "_index.json")) ? false : "out/db/magic not built";

	test("the powers of well-known items", { skip }, async () => {
		const index = JSON.parse(await readFile(path.join(dir, "_index.json"), "utf8"));
		const entries = [];
		for (const f of (await readdir(dir)).filter(f => f !== "_index.json")) entries.push(...JSON.parse(await readFile(path.join(dir, f), "utf8")));
		assert.equal(validateMagic(entries, index).size, 0);
		const find = n => entries.find(e => e.name === n);
		const thrower = find("Dwarven Thrower").powers[0];
		assert.deepEqual([thrower.system.useType, thrower.system.actionType], ["daily", "free"]);
		assert.equal(thrower.flags.dnd4e.import.scaling.length, 5);
		const shock = find("Shock Weapon").powers[0];
		assert.deepEqual([shock.system.attack.isAttack, shock.system.attack.def, shock.flags.dnd4e.import.attackLevelOffset], [true, "ref", 3]);
		assert.ok(entries.filter(e => e.powers.length).length > 2000);
	});
});
