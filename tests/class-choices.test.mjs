/**
 * Class features that make you choose: the options read out of the feature's text.
 * Run: npm test
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { parseChoice } from "../class-choices.mjs";

const FIGHTING_STYLE = [
	"Choose one of the following fighting styles and gain its benefit: Archer Fighting Style, Beast Mastery, Two-Blade Fighting Style.",
	"Archer Fighting Style",
	"Because of your focus on ranged attacks, you gain Defensive Mobility as a bonus feat.",
	"Beast Mastery",
	"You gain a beast companion. You give up Prime Shot.",
	"The link is a friendship.",
	"Two-Blade Fighting Style",
	"You gain Two-Weapon Defense as a bonus feat.",
].join("\n");

describe("reading a choice", () => {
	test("the options a sentence lists, with the text under each", () => {
		const choice = parseChoice(FIGHTING_STYLE);
		assert.equal(choice.pick, 1);
		assert.deepEqual(choice.options.map(o => o.name), ["Archer Fighting Style", "Beast Mastery", "Two-Blade Fighting Style"]);
		assert.equal(choice.options[1].text, "You gain a beast companion. You give up Prime Shot.\nThe link is a friendship.");
	});

	test("options that are only short lines with text after them, when the sentence lists none", () => {
		const choice = parseChoice(["You choose one of the following terrain types and gain its benefit.", "Arid Desert", "You gain a bonus while wearing cloth.", "Frozen Land", "You gain resist cold."].join("\n"));
		assert.deepEqual(choice.options.map(o => o.name), ["Arid Desert", "Frozen Land"]);
	});

	test("how many to take", () => {
		assert.equal(parseChoice(["Choose two of the following talents.", "A Talent", "Does a thing.", "B Talent", "Does another."].join("\n")).pick, 2);
		assert.equal(parseChoice(["Choose either Centered Breath or Stone Fist as your tradition.", "Centered Breath", "Mind.", "Stone Fist", "Body."].join("\n")).pick, 1);
	});

	test("not a choice: no sentence that says to choose, powers of your choice, one option, a lone line", () => {
		assert.equal(parseChoice("Once per turn, you can use your Hunter's Quarry power."), null);
		assert.equal(parseChoice(["You gain one of the following powers of your choice.", "Power A", "Text.", "Power B", "Text."].join("\n")), null);
		assert.equal(parseChoice(["Choose one of the following talents.", "Only One", "Does a thing."].join("\n")), null);
		assert.equal(parseChoice(""), null);
		assert.equal(parseChoice(undefined), null);
	});
});
