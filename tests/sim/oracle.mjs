/**
 * Oracle: the numbers a power SHOULD produce for a fictional character, computed from the parsed book text
 * and the rules in the Rules Compendium (p. 80, "Base Attack Roll Modifiers" / "Base Damage Roll Modifiers"):
 *
 *   attack bonus = one-half level + ability modifier + enhancement (+ proficiency bonus, for a weapon power) + fixed bonus
 *   damage       = [W] / dice + ability modifier + enhancement (when a weapon or implement is used)
 *   critical     = the base dice at their maximum, plus the enhancement bonus dice (enhancement d6)
 *
 * It reads the *parsed* power, never the DB item's formulas, so a mistake in the conversion shows up as a mismatch.
 */
import { weaponFor } from "./sheet.mjs";

const ABILITIES = ["str", "con", "dex", "int", "wis", "cha"];
const EQUIPMENT_KEYWORDS = ["weapon", "implement"];

/** "Highest ability": the largest modifier of the character, over all six, only the mental three, or only the physical three. */
const HIGHEST = { highest: ABILITIES, "highest-mental": ["int", "wis", "cha"], "highest-physical": ["str", "dex", "con"] };
const highestOf = (token, character) => Math.max(...HIGHEST[token].map(a => character.mods[a]));

/** The parsed section an item was converted from. */
export function sectionOf(parsed, flags) {
	return flags.role === "child" ? parsed.children[flags.section] : parsed;
}

/** First damage entry that belongs to the power's own damage roll, searching hit -> hit variants -> effect. */
export function primaryDamage(section, variant) {
	const sources = [section.hit, ...(section.hitVariants ?? []), section.effect];
	for (const block of sources) {
		const candidates = (block?.damage ?? []).filter(d => !d.extra && !d.equalTo && !d.self);
		if (!candidates.length) continue;
		return (variant ? (candidates.find(d => d.when === variant) ?? candidates.find(d => !d.when)) : candidates.find(d => !d.when || d.when === "melee")) ?? null;
	}
	return null;
}

const sum = (list, f) => list.reduce((total, x) => total + f(x), 0);

/**
 * @returns {{skip: string}|{attack: {min,max}|null, damage: object|null, crit: object|null, weaponDiceWithoutWeapon: boolean}}
 */
export function expected(parsed, flags, weaponType, character) {
	const section = sectionOf(parsed, flags);
	const variant = flags.variant ?? null;
	const keywords = (section.keywords?.length ? section.keywords : parsed.keywords).map(k => k.toLowerCase());
	const d = primaryDamage(section, variant);
	// Rules: [W] is the damage die of the weapon in use, so a power that rolls [W] needs a weapon whatever its keywords say.
	const usesEquipment = keywords.some(k => EQUIPMENT_KEYWORDS.includes(k)) || (d?.weapon ?? 0) > 0;
	const weapon = weaponFor(weaponType, character);

	// Attack
	const side = variant && section.attack?.alternatives ? section.attack.alternatives.find(a => a.when === variant) : section.attack;
	// A melee/ranged side has abilities and defences but no `parsed` flag of its own.
	const attack = side?.parsed || side?.abilities?.length ? side : null;
	const attackAbility = attack ? attack.abilities[0] : null;
	if (attack && !ABILITIES.includes(attackAbility) && !(attackAbility in HIGHEST) && attackAbility !== "primary") return { skip: `symbolic attack ability "${attackAbility}"` };

	let attackResult = null;
	if (attack) {
		const equipment = usesEquipment && weapon ? ((weapon.kind === "implement" ? weapon.profImpBonus : weapon.profBonus) * (weapon.proficient ? 1 : 0)) + weapon.enhance : 0;
		const abilityMod = attackAbility === "primary" ? character.mods[character.primary]
			: attackAbility in HIGHEST ? highestOf(attackAbility, character) : character.mods[attackAbility];
		const value = character.lvhalf + abilityMod + equipment + (attack.bonus ?? 0);
		attackResult = { min: value, max: value };
	}

	// Damage
	if (!d) return { attack: attackResult, damage: null, crit: null, weaponDiceWithoutWeapon: false };

	let modTotal = 0;
	for (const mod of d.mods) {
		if (mod in HIGHEST) { modTotal += highestOf(mod, character); continue; }
		// "Primary ability modifier", and a bare "ability modifier" in a power whose attack is "Primary ability" (the same ability).
		if (mod === "primary" || (mod === "ability" && attackAbility === "primary")) { modTotal += character.mods[character.primary]; continue; }
		const options = mod.split("|");
		if (!options.every(o => ABILITIES.includes(o))) return { skip: `symbolic damage modifier "${mod}"` };
		modTotal += character.mods[options.includes(attackAbility) ? attackAbility : options[0]];
	}

	const enhance = usesEquipment && weapon ? weapon.enhance : 0;
	const weaponMax = weapon ? d.weapon * sum(weapon.dice, p => p.numDice * p.numFaces) : 0;
	const weaponMin = weapon ? d.weapon * sum(weapon.dice, p => p.numDice) : 0;
	const diceMax = sum(d.dice, x => x.count * x.faces);
	const diceMin = sum(d.dice, x => x.count);

	const common = d.flat + modTotal + enhance;
	const critBase = weaponMax + diceMax + common;
	return {
		attack: attackResult,
		damage: { min: weaponMin + diceMin + common, max: weaponMax + diceMax + common },
		crit: { min: critBase + enhance * 1, max: critBase + enhance * 6 },
		weaponDiceWithoutWeapon: d.weapon > 0 && !weapon,
	};
}
