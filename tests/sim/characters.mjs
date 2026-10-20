/**
 * Fictional characters for the sheet simulator. Every ability modifier and every weapon number is different on purpose,
 * so a formula that picks the wrong ability, the wrong weapon or the wrong field produces a different total.
 *
 * Ability modifier = floor((score - 10) / 2) (Rules Compendium).
 *  - physical-strong characters: Str 20/Con 16/Dex 14/Int 12/Wis 18/Cha 8 -> +5/+3/+2/+1/+4/-1 (highest overall = physical)
 *  - mental-strong character:    Str 10/Con 12/Dex 14/Int 20/Wis 18/Cha 16 -> 0/+1/+2/+5/+4/+3 (highest overall = mental)
 * Having both lets "highest ability", "highest mental ability" and "highest physical ability" give three different answers.
 */
export const abilityMod = score => Math.floor((score - 10) / 2);

const PHYSICAL_STRONG = { str: 20, con: 16, dex: 14, int: 12, wis: 18, cha: 8 };
const MENTAL_STRONG = { str: 10, con: 12, dex: 14, int: 20, wis: 18, cha: 16 };

const character = (name, level, scores, weapons) => ({
	name,
	level,
	lvhalf: Math.floor(level / 2),
	scores,
	mods: Object.fromEntries(Object.entries(scores).map(([k, v]) => [k, abilityMod(v)])),
	weapons,
});

const weapon = (kind, { dice = [], profBonus = 0, profImpBonus = 0, enhance = 0, proficient = true }) => ({ kind, dice, profBonus, profImpBonus, enhance, proficient });

export const CHARACTERS = [
	character("Level 1 novice", 1, PHYSICAL_STRONG, {
		melee: weapon("weapon", { dice: [{ numDice: 1, numFaces: 8 }], profBonus: 3, enhance: 1 }),
		ranged: weapon("weapon", { dice: [{ numDice: 1, numFaces: 10 }], profBonus: 2, enhance: 2 }),
		implement: weapon("implement", { profImpBonus: 1, enhance: 3 }),
	}),
	character("Level 11 caster", 11, MENTAL_STRONG, {
		melee: weapon("weapon", { dice: [{ numDice: 1, numFaces: 4 }], profBonus: 2, enhance: 3 }),
		ranged: weapon("weapon", { dice: [{ numDice: 1, numFaces: 8 }], profBonus: 3, enhance: 1 }),
		implement: weapon("implement", { profImpBonus: 2, enhance: 4 }),
	}),
	character("Level 21 veteran", 21, PHYSICAL_STRONG, {
		melee: weapon("weapon", { dice: [{ numDice: 1, numFaces: 12 }], profBonus: 3, enhance: 5 }),
		ranged: weapon("weapon", { dice: [{ numDice: 1, numFaces: 6 }], profBonus: 2, enhance: 4 }),
		implement: weapon("implement", { profImpBonus: 2, enhance: 6 }),
	}),
];
