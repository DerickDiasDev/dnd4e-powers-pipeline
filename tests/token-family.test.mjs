/**
 * Token families: a 4e monster takes the 5etools creature of its family that is most like it (caster, archer, boss, level, size).
 * Run: npm test
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { candidatesFrom, matchFamily, profileOf } from "../token-family.mjs";

const m = (name, cr, extra = {}) => ({ name, cr, size: ["S"], type: { type: "humanoid", tags: ["goblinoid"] }, ...extra });
const bestiary = {
	MM: [m("Goblin", "1/4"), m("Goblin Boss", 1), { ...m("Hobgoblin", "1/2"), size: ["M"] }, { name: "Young White Dragon", cr: 6, size: ["L"], type: "dragon" }, { name: "Adult White Dragon", cr: 13, size: ["H"], type: "dragon" }, { name: "Ancient White Dragon", cr: 20, size: ["G"], type: "dragon" }, { name: "Blue Slaad", cr: 7, size: ["L"], type: "aberration" }, { name: "Lich", cr: 21, size: ["M"], type: "undead", spellcasting: [{}] }, { name: "Giant Fly", cr: 0, size: ["L"], type: "beast" }],
	VGM: [m("Booyahg Caster", 3), m("Booyahg Whip", 2)],
	XMM: [m("Goblin Hexer", 1, { spellcasting: [{}] })],
	ZZZ: [{ name: "No Token Thing", cr: 1, size: ["M"], type: "beast" }, { name: "Goblin Copy", _copy: { name: "Goblin", source: "MM" }, cr: 2 }],
};
const tokens = ["MM/Goblin.webp", "MM/Goblin Boss.webp", "MM/Hobgoblin.webp", "MM/Young White Dragon.webp", "MM/Adult White Dragon.webp", "MM/Ancient White Dragon.webp", "MM/Blue Slaad.webp", "MM/Lich.webp", "MM/Giant Fly.webp", "VGM/Booyahg Caster.webp", "VGM/Booyahg Whip.webp", "XMM/Goblin Hexer.webp", "ZZZ/Goblin Copy.webp"];
const candidates = candidatesFrom(bestiary, tokens);
const actor = (name, level, role = {}, size = "sm") => ({ name, system: { details: { level, size, role: { primary: "soldier", secondary: "standard", leader: false, ...role } } } });
const pick = (...args) => matchFamily(actor(...args), candidates);

describe("the candidates", () => {
	test("are the creatures that have a token; a copy takes what it does not give", () => {
		assert.ok(!candidates.some(c => c.name === "No Token Thing"));
		const copy = candidates.find(c => c.name === "Goblin Copy");
		assert.deepEqual([copy.tags, copy.cr], [["goblinoid"], 2]);
		assert.equal(candidates.find(c => c.name === "Lich").caster, true);
	});
});

describe("a monster's profile", () => {
	test("by role and name", () => {
		assert.deepEqual(Object.entries(profileOf(actor("Goblin Hexer", 3, { primary: "controller", leader: true }))).filter(([, v]) => v === true).map(([k]) => k), ["caster", "boss"]);
		assert.equal(profileOf(actor("Goblin Sharpshooter", 2, { primary: "artillery" })).ranged, true);
		assert.equal(profileOf(actor("Goblin Grunt", 1, { secondary: "minion" })).minion, true);
	});
});

describe("the most like creature of the family", () => {
	test("the same name wins", () => {
		assert.deepEqual(pick("Goblin Hexer", 3, { primary: "controller" }), { file: "XMM/Goblin Hexer.webp", how: "exact", like: "Goblin Hexer" });
		assert.equal(pick("Lich (Eladrin Wizard)", 24).file, "MM/Lich.webp");
	});
	test("a plain goblin takes the Goblin, a goblin leader the Goblin Boss", () => {
		assert.equal(pick("Goblin Cutter", 1).file, "MM/Goblin.webp");
		assert.equal(pick("Goblin Beast Marshal", 1, { leader: true }).file, "MM/Goblin Boss.webp");
	});
	test("a caster takes a caster, even of another name (a Booyahg is a goblin)", () => {
		assert.equal(pick("Goblin Mage", 3, { primary: "controller" }).file, "XMM/Goblin Hexer.webp");
		assert.ok(["VGM/Booyahg Caster.webp", "XMM/Goblin Hexer.webp"].includes(pick("Goblin Shaman", 3, { primary: "controller" }).file));
	});
	test("the level picks among the sizes of a creature", () => {
		assert.equal(pick("Elder White Dragon", 4, {}, "lg").like, "Young White Dragon");
		assert.equal(pick("Fledgling White Dragon", 16, {}, "huge").like, "Adult White Dragon");
		assert.equal(pick("Elder White Dragon", 30, {}, "grg").like, "Ancient White Dragon");
	});
	test("a name ending with a role, a kind or a description is not a creature", () => {
		assert.equal(pick("Fire Drake", 20), null);
		assert.equal(pick("Giant Sea Snake", 10), null);
		assert.equal(pick("Bone Construct", 2), null);
		assert.equal(pick("Slaad Spawn", 17).like, "Blue Slaad");
	});
	test("a creature by its type tag only is a family of the word the name begins with, not ends with", () => {
		assert.equal(pick("Goblin Underboss", 4, { primary: "controller", secondary: "elite", leader: true }) !== null, true);
		assert.equal(pick("Cave Goblin", 2)?.like, "Goblin");
	});
});
