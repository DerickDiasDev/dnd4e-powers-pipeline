/**
 * Conformance: numbers observed in the real dnd4e system inside Foundry, reproduced by the sheet simulator.
 * The simulator is a copy of the system's rules (see tests/sim/sheet.mjs); each observation here ties it to the real thing.
 * Add a case whenever you roll something in Foundry and read the numbers off the chat card.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { parsePower } from "../parse-powers.mjs";
import { convertPower } from "../build-db.mjs";
import { CATEGORIES, entry } from "./fixtures.mjs";
import { simulate } from "./sim/sheet.mjs";

const itemFrom = e => convertPower(parsePower(e), { categories: CATEGORIES })[0];

describe("observed in Foundry", () => {
	/**
	 * Fighter, level 7, Str 18 (+4), longsword 1d8 (proficiency +3, enhancement +1), Details tab > Primary Ability = Strength.
	 * Power: melee weapon, "Primary ability vs. AC", "4[W] + ability modifier damage" (the structure of a Dark Sun theme power).
	 * Chat card of the critical damage roll:
	 *   (32 + 4 + ((1)) + (((1))d6))[physical] + 0       from  @powMax + @primaryMod + @wepDamage + @wepCritBonus + @bonus
	 *   the extra d6 rolled a 6  ->  total 43
	 */
	const fighter = {
		name: "Fighter (observed)", level: 7, lvhalf: 3, primary: "str",
		scores: { str: 18, con: 10, dex: 10, int: 10, wis: 10, cha: 10 },
		mods: { str: 4, con: 0, dex: 0, int: 0, wis: 0, cha: 0 },
		weapons: { melee: { kind: "weapon", dice: [{ numDice: 1, numFaces: 8 }], profBonus: 3, profImpBonus: 0, enhance: 1, proficient: true } },
	};
	const power = itemFrom(entry("c-primary", {
		name: "Conformance Primal Strike", usage: "Encounter", level: 7,
		blocks: [["Target", "One creature"], ["Attack", "Primary ability vs. AC"], ["Hit", "4[W] + ability modifier damage."]],
	}));

	test("critical damage: 32 + 4 + 1 + the extra d6 (observed 43 with a 6)", () => {
		const { crit } = simulate(power, fighter);
		assert.equal(crit.max, 43, "extra d6 at 6");
		assert.equal(crit.min, 38, "extra d6 at 1");
		assert.ok(crit.min <= 43 && 43 <= crit.max, "the observed total is inside the simulated range");
	});

	test("the item's critical formula is the one the card printed", () => {
		assert.equal(power.system.hit.critFormula, "@powMax + @primaryMod + @wepDamage + @wepCritBonus");
	});

	test("normal damage and the attack bonus follow from the same terms", () => {
		const { damage, attack } = simulate(power, fighter);
		assert.deepEqual([damage.min, damage.max], [9, 37]); // 4d8 + 4 + 1
		assert.equal(attack.max, 11); // half level 3 + Str 4 + proficiency 3 + enhancement 1
	});
});
