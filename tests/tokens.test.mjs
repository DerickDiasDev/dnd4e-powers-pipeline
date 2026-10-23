/**
 * Tokens: a 4e monster takes the 5etools token of the same name or of the creature its name begins or ends with.
 * Run: npm test
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { indexTokens, localPath, matchToken, nameVariants, normalize } from "../tokens.mjs";
import { clearIcon, setToken } from "../apply-tokens.mjs";

const index = indexTokens([
	"MM/Goblin.webp", "VGM/Goblin.webp", "MM/Young White Dragon.webp", "MM/Owlbear.webp", "MM/Lich.webp", "PSK/Dragon.webp",
	"MM/Fire Giant.webp", "PSK/Giant.webp", "MM/Gnoll.webp", "MPMM/Orcus.webp", "MM/Zombie.webp", "XMM/Giant Slug.webp", "MM/Wolf.webp",
]);

describe("names", () => {
	test("are compared without case, accents, punctuation or a plural s", () => {
		assert.equal(normalize("Goblin's  Cutters"), "goblin cutter");
		assert.equal(normalize("Séance"), "seance");
	});
	test("a monster's name has variants: without the bracket, and each part of 'Name, Trade'", () => {
		assert.deepEqual(nameVariants("Lich (Eladrin Wizard)").map(w => w.join(" ")), ["lich eladrin wizard", "lich", "eladrin wizard"]);
		assert.ok(nameVariants("Scalpel, Human Torturer").some(w => w.join(" ") === "human torturer"));
	});
});

describe("matching a token", () => {
	test("the same name, from the core book when several have it", () => {
		assert.deepEqual(matchToken("Goblin", index), { file: "MM/Goblin.webp", how: "exact" });
		assert.deepEqual(matchToken("Lich (Eladrin Wizard)", index), { file: "MM/Lich.webp", how: "exact" });
	});
	test("the creature the name begins or ends with", () => {
		assert.deepEqual(matchToken("Goblin Cutter", index), { file: "MM/Goblin.webp", how: "edge" });
		assert.deepEqual(matchToken("Tainted Zombie", index), { file: "MM/Zombie.webp", how: "edge" });
		assert.deepEqual(matchToken("Fire Giant Torturer", index), { file: "MM/Fire Giant.webp", how: "edge" });
	});
	test("a modifier of 5etools may come before the name", () => {
		assert.deepEqual(matchToken("Elder White Dragon", index), { file: "MM/Young White Dragon.webp", how: "modifier" });
	});
	test("a kind, a role or a short word alone is not a creature, and what follows 'of' is a name", () => {
		assert.equal(matchToken("Giant Ant", index), null);
		assert.equal(matchToken("Young Orium Dragon", index), null);
		assert.equal(matchToken("Adept of Orcus", index), null);
		assert.equal(matchToken("Slug Rabbit", index), null);
		assert.equal(matchToken("Unknown Thing", index), null);
	});
});

describe("the files", () => {
	test("a token is kept under a plain name", () => {
		assert.equal(localPath("MM/Goblin Cutter's.webp"), "MM/goblin-cutter-s.webp");
		assert.equal(localPath("PSK/Giant Crab.webp"), "PSK/giant-crab.webp");
	});
	test("an actor's portrait and token image are set, the rest of its token kept", () => {
		const actor = { name: "Goblin Cutter", prototypeToken: { name: "Goblin Cutter", width: 1 } };
		setToken(actor, "MM/Goblin.webp");
		assert.equal(actor.img, "dnd4e-tokens/MM/goblin.webp");
		assert.deepEqual(actor.prototypeToken, { name: "Goblin Cutter", width: 1, texture: { src: "dnd4e-tokens/MM/goblin.webp" } });
	});
	test("an image an earlier run gave an actor (an icon, or a token no longer picked) is taken away; any other is kept", () => {
		const icon = { name: "Fire Drake", img: "icons/creatures/reptiles/dragon-winged-blue.webp", prototypeToken: { name: "Fire Drake", texture: { src: "icons/creatures/reptiles/dragon-winged-blue.webp" } } };
		assert.equal(clearIcon(icon), true);
		assert.deepEqual(icon, { name: "Fire Drake", prototypeToken: { name: "Fire Drake" } });
		const token = { name: "Goblin", img: "dnd4e-tokens/MM/goblin.webp", prototypeToken: { texture: { src: "dnd4e-tokens/MM/goblin.webp" } } };
		assert.equal(clearIcon(token), true);
		assert.deepEqual(token, { name: "Goblin", prototypeToken: {} });
		const own = { name: "Mine", img: "worlds/mine/portrait.webp" };
		assert.equal(clearIcon(own), false);
		assert.equal(own.img, "worlds/mine/portrait.webp");
	});
});
