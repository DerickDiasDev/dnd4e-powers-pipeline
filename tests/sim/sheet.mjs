/**
 * Sheet simulator: evaluates the formulas stored in a DB item the way the dnd4e system does, for a fictional character.
 *
 * It mirrors, from the system source (module/documents/item.mjs, module/data/item/weapon.mjs, module/documents/actor.mjs):
 *   Item#getPowBase / getPowMax   -> @powBase / @powMax
 *   Item#getRollData              -> @powerMod, @wepAttack, @wepDamage, @wepCritBonus, @lvhalf, @abilities.<k>.mod
 *   weapon defaults               -> attackForm "@profBonus + @enhance", damageForm "@enhance", critDamageForm "(@enhance)d6"
 *   power defaults                -> attack.formula "@wepAttack + @powerMod + @lvhalf"
 *
 * LIMIT: this is a copy of the system's *rules*, not the system's code. If the system changes, this file can drift.
 * That is why a few cases must also be confirmed inside Foundry (see the conformance check in the test plan).
 * Known simplifications: the weapon in use is chosen from the item's weaponType only (no equipped/proficiency lookup),
 * brutal weapons and the "inherent enhancement" setting are ignored.
 */

export const DEFAULT_ATTACK_FORMULA = "@wepAttack + @powerMod + @lvhalf";
const ABILITY_KEYS = ["str", "con", "dex", "int", "wis", "cha"];

/** The weapon the item would use: melee/ranged/implement by weaponType; meleeRanged and any default to the melee weapon. */
export function weaponFor(weaponType, character) {
	switch (weaponType) {
		case "melee": case "meleeRanged": case "any": return character.weapons.melee;
		case "ranged": return character.weapons.ranged;
		case "implement": return character.weapons.implement;
		default: return null;
	}
}

/** Weapon-derived numbers, as Item#getRollData computes them. */
export function weaponValues(weapon) {
	if (!weapon) return { wepAttack: 0, wepDamage: 0, enhance: 0, wepCritDice: 0 };
	const implement = weapon.kind === "implement";
	const profBonus = implement ? (weapon.proficient ? weapon.profImpBonus : 0) : (weapon.proficient ? weapon.profBonus : 0);
	return {
		wepAttack: profBonus + weapon.enhance, // attackForm / attackFormImp
		wepDamage: weapon.enhance, // damageForm / damageFormImp
		enhance: weapon.enhance,
		wepCritDice: weapon.enhance, // critDamageForm "(@enhance)d6": this many d6
	};
}

/** Item#getPowBase: the dice expression for hit.baseQuantity + hit.baseDiceType, as a string like "2d8". */
export function powBase(hit, weapon) {
	if (hit.baseQuantity === undefined || hit.baseQuantity === "") return undefined;
	const quantity = Number(hit.baseQuantity);
	const type = String(hit.baseDiceType).toLowerCase();
	if (type.includes("weapon")) {
		if (!weapon) return "0";
		return weapon.dice.map(p => `${quantity * Number(p.numDice)}d${p.numFaces}${p.modifier ?? ""}`).join(" + ");
	}
	if (type.includes("flat")) return `${quantity}`;
	return `${quantity}${type}`;
}

/** Item#getPowMax: the maximum of the base damage, as a number. */
export function powMax(hit, weapon) {
	if (hit.baseQuantity === undefined || hit.baseQuantity === "") return undefined;
	const quantity = Number(hit.baseQuantity);
	const type = String(hit.baseDiceType).toLowerCase();
	if (type.includes("weapon")) return weapon ? weapon.dice.reduce((sum, p) => sum + quantity * Number(p.numDice) * Number(p.numFaces), 0) : 0;
	if (type.includes("flat")) return quantity;
	return quantity * Number(type.match(/\d+/g).join(""));
}

/**
 * Evaluates a roll formula made of '+'-joined terms: numbers, NdM dice and "(N)dM". Dice are fixed to their
 * maximum, minimum or average, so the result is exact. Any token left over is an error, never a silent 0.
 */
export function evaluate(formula, mode) {
	// max(a, b, ...) over already-substituted numbers: the system's way to write "your highest ability modifier".
	const withMax = String(formula).replace(/max\(([^()]*)\)/g, (_, args) => String(Math.max(...args.split(",").map(Number))));
	const flat = withMax.replace(/\((\d+)\)d(\d+)/g, "$1d$2").replace(/[()]/g, "");
	let total = 0;
	for (const raw of flat.split("+")) {
		const term = raw.trim();
		if (term === "") continue;
		const dice = term.match(/^(\d+)d(\d+)$/);
		if (dice) total += Number(dice[1]) * (mode === "max" ? Number(dice[2]) : mode === "min" ? 1 : (Number(dice[2]) + 1) / 2);
		else if (/^-?\d+$/.test(term)) total += Number(term);
		else throw new Error(`cannot evaluate term "${term}" in "${formula}"`);
	}
	return total;
}

/** Replaces every @token with its value. Unknown tokens throw: a formula must only use variables the system defines. */
function substitute(formula, vars) {
	return formula.replace(/@([A-Za-z]+(?:\.[A-Za-z]+)*)/g, (_, token) => {
		if (token in vars) return String(vars[token]);
		throw new Error(`unknown formula variable @${token} in "${formula}"`);
	});
}

/**
 * Rolls a DB item for a character with all dice at their minimum and maximum.
 * @returns {{attack: {min,max}|null, damage: {min,max}|null, crit: {min,max}|null, weaponType: string}}
 */
export function simulate(item, character) {
	const s = item.system;
	const weapon = weaponFor(s.weaponType, character);
	const w = weaponValues(weapon);

	const vars = {
		lvhalf: character.lvhalf,
		powerMod: ABILITY_KEYS.includes(s.attack.ability) ? character.mods[s.attack.ability] : 0,
		wepAttack: w.wepAttack,
		wepDamage: w.wepDamage,
		// Actor#getRollData: <ability>Mod, maxMod (the largest of the six) and primaryMod (the ability picked on the Details tab, 0 when unset)
		maxMod: Math.max(...ABILITY_KEYS.map(k => character.mods[k])),
		primaryMod: character.primary ? character.mods[character.primary] : 0,
		...Object.fromEntries(ABILITY_KEYS.map(k => [`${k}Mod`, character.mods[k]])),
		...Object.fromEntries(ABILITY_KEYS.map(k => [`abilities.${k}.mod`, character.mods[k]])),
	};

	const out = { weaponType: s.weaponType, attack: null, damage: null, crit: null };

	if (s.attack.isAttack) {
		const formula = substitute(s.attack.formula ?? DEFAULT_ATTACK_FORMULA, vars);
		out.attack = { min: evaluate(formula, "min"), max: evaluate(formula, "max") };
	}

	if (s.hit.isDamage) {
		const base = powBase(s.hit, weapon);
		const maxBase = powMax(s.hit, weapon);
		const common = { ...vars, powBase: base, powMax: maxBase, wepCritBonus: `(${w.wepCritDice})d6` };
		const dmg = substitute(s.hit.formula, common);
		out.damage = { min: evaluate(dmg, "min"), max: evaluate(dmg, "max") };
		// On a critical hit the base is maximised (@powMax) and the weapon's extra (@enhance)d6 is still rolled.
		const crit = substitute(s.hit.critFormula, common);
		out.crit = { min: evaluate(crit, "min"), max: evaluate(crit, "max") };
	}
	return out;
}
