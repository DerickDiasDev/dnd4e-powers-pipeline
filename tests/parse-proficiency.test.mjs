/**
 * The training and proficiencies a feat gives, as the changes of an effect. Run: npm test
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { parseProficiencies } from "../parse-proficiency.mjs";
import { proficiencyEffects } from "../build-effects.mjs";

const names = {
	skills: new Map([["arcana", "arc"], ["stealth", "stl"], ["religion", "rel"], ["acrobatics", "acr"]]),
	weapons: new Map([["glaive", "glaive"], ["halberd", "halberd"], ["short bow", "shortbow"], ["shortbow", "shortbow"], ["handaxe", "handaxe"]]),
};
const read = text => parseProficiencies(text, names);
const flat = r => r.changes.map(c => `${/.training$/.test(c.key) ? c.key.split(".").slice(-2).join(".") : "value"} ${c.type} ${c.value}`);

describe("training", () => {
	test("a skill the text names is trained: a floor of 5, so an expert stays one", () => {
		assert.deepEqual(flat(read("You gain training in Arcana.")), ["arc.training upgrade 5"]);
		assert.deepEqual(flat(read("You gain training in the Stealth skill.")), ["stl.training upgrade 5"]);
		assert.deepEqual(flat(read("You gain training in Arcana and Religion.")), ["arc.training upgrade 5", "rel.training upgrade 5"]);
	});
	test("a choice is left to the player and reported", () => {
		for (const text of ["You gain training in the Acrobatics or Stealth skill.", "You gain training in one skill from the fighter's class skill list.", "You gain training in a skill of your choice from the bard's list of class skills."]) {
			const r = read(text);
			assert.deepEqual([r.changes.length, r.unresolved[0].why], [0, "choice"], text);
		}
	});
});

describe("proficiency", () => {
	test("armour and shields", () => {
		assert.deepEqual(flat(read("You gain proficiency with scale armor, and you increase your number of healing surges by one.")), ["value add scale"]);
		assert.deepEqual(flat(read("You gain proficiency with light shields.")), ["value add light"]);
		assert.deepEqual(flat(read("You gain proficiency with all shields.")), ["value add light", "value add heavy"]);
		assert.deepEqual(read("You gain proficiency with banded mail.").unresolved, [{ what: "banded mail", why: "unknown" }], "no type for it in the system");
	});
	test("implements", () => {
		assert.deepEqual(flat(read("You also gain proficiency with rods and wands.")), ["value add rod", "value add wand"]);
		assert.deepEqual(flat(read("You gain proficiency with holy symbols.")), ["value add holyS"]);
		assert.deepEqual(flat(read("gain proficiency with ki focuses.")), ["value add ki"]);
	});
	test("weapons by name, and not groups or choices; what follows the list is not part of it", () => {
		assert.deepEqual(flat(read("You gain proficiency with the glaive and the halberd.")), ["value add glaive", "value add halberd"]);
		assert.deepEqual(flat(read("You gain proficiency with the shortbow, plus you can use a shortbow as an implement.")), ["value add shortbow"]);
		const r = read("You gain proficiency with light shields and with one military weapon of your choice.");
		assert.deepEqual([flat(r), r.unresolved.map(u => u.why)], [["value add light"], ["choice"]]);
		assert.equal(read("You gain proficiency with all military heavy blades.").changes.length, 0);
	});
	test("a text that gives nothing gives nothing", () => {
		assert.deepEqual(read("Prerequisite: proficiency with a longbow. You gain a +2 feat bonus to Perception checks.").changes, []);
		assert.deepEqual(read("").changes, []);
	});
});

describe("the effect", () => {
	test("one effect that transfers to the owner, named for what it gives", () => {
		const [effect] = proficiencyEffects("You gain training in Arcana. You also gain proficiency with rods and wands.", { itemId: "feat1" });
		assert.equal(effect.transfer, true);
		assert.equal(effect.system.changes.length, 3);
		assert.match(effect.name, /Training in Arcana/);
		assert.equal(effect._id, proficiencyEffects("You gain training in Arcana.", { itemId: "feat1" })[0]._id, "a stable id");
		assert.deepEqual(proficiencyEffects("You gain a +2 feat bonus to Will.", { itemId: "feat1" }), []);
	});
});
