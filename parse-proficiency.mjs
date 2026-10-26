/**
 * Training and proficiencies written in a text ("You gain training in Arcana.", "You gain proficiency with scale armor.", "You also
 * gain proficiency with rods and wands."), as the `changes` of an effect the dnd4e system applies to the owner:
 *   a skill      system.skills.<skill>.training  upgrade 5 (trained; an expert stays expert)
 *   armour       system.details.armourProf.value      add <armour type or shield>
 *   a weapon     system.details.weaponProf.value      add <weapon base type>
 *   an implement system.details.implementProf.value   add <implement>
 *
 * Only what is fixed becomes a change: a skill or a weapon the text names. A choice ("one skill from the fighter's class skill list",
 * "Arcana or Religion", "one military weapon of your choice") and a group of weapons ("all military heavy blades") are left out and
 * reported, as are armours the system has no type for (banded mail, ring mail...). Pure: the names the system knows come in `names`.
 */

/** Armour as the texts say it -> the system's armour proficiency keys (shields: light, heavy). */
const ARMOUR = new Map([
	["cloth armor", ["cloth"]], ["cloth armour", ["cloth"]], ["leather armor", ["leather"]], ["leather armour", ["leather"]],
	["hide armor", ["hide"]], ["hide armour", ["hide"]], ["chainmail", ["chain"]], ["chain mail", ["chain"]], ["scale armor", ["scale"]],
	["scale armour", ["scale"]], ["plate armor", ["plate"]], ["plate armour", ["plate"]], ["light shield", ["light"]], ["heavy shield", ["heavy"]],
	["shield", ["light", "heavy"]], ["all shield", ["light", "heavy"]],
]);

/** Implements as the texts say it -> the system's implement proficiency keys. */
const IMPLEMENT = new Map([
	["holy symbol", "holyS"], ["ki focus", "ki"], ["ki focuse", "ki"], ["orb", "orb"], ["rod", "rod"], ["staff", "staff"], ["staffe", "staff"],
	["stave", "staff"], ["tome", "tome"], ["totem", "totem"], ["wand", "wand"],
]);

/**
 * @typedef {object} Names
 * @property {Map<string, string>} skills   lower-case skill name -> key ("arcana" -> "arc")
 * @property {Map<string, string>} weapons  lower-case weapon name -> base type key ("shortbow" -> "shortbow")
 */

/** A phrase of a list as a singular, lower-case name: "the Halberd" -> "halberd", "light shields" -> "light shield". */
function singular(phrase) {
	let s = String(phrase).toLowerCase().replace(/\b(?:the|all|also|a|an)\b/g, " ").replace(/\s+/g, " ").trim();
	if (s.endsWith("ies")) s = `${s.slice(0, -3)}y`;
	else if (s.endsWith("s") && !s.endsWith("ss")) s = s.slice(0, -1);
	return s;
}

const list = text => String(text).split(/\s*,\s*(?:and\s+)?|\s+and\s+/).map(s => s.trim()).filter(Boolean);

/**
 * @param {string} text   the text of a feat's benefit, a feature...
 * @param {Names} names
 * @returns {{changes: {key: string, type: string, value: string}[], names: string[], unresolved: {what: string, why: string}[]}}
 *   `names` are the skills and proficiencies given, for the effect's name
 */
export function parseProficiencies(text, names) {
	const changes = [], given = [], unresolved = [];
	const seen = new Set();
	const give = (key, type, value, name) => {
		const id = `${key}|${value}`;
		if (seen.has(id)) return;
		seen.add(id);
		changes.push({ key, type, value: String(value), priority: null });
		given.push(name);
	};
	const flat = String(text ?? "").replace(/\s+/g, " ");

	// Training: "gain training in Arcana." / "in the Stealth skill." / "in Arcana and Religion."
	for (const m of flat.matchAll(/\bgain training in ([^.]*)\./gi)) {
		const phrase = m[1].replace(/\bskills?\b/gi, " ").replace(/\s+/g, " ").trim();
		if (/\bor\b|\bone\b|\bchoice\b|\bclass\b|\blist\b|\bof\b|\bany\b|\bcho[o]se\b|\ba skill\b/i.test(phrase)) { unresolved.push({ what: "training", why: "choice" }); continue; }
		for (const raw of list(phrase)) {
			const key = names.skills.get(raw.toLowerCase().replace(/^the\s+/, ""));
			if (key) give(`system.skills.${key}.training`, "upgrade", 5, `Training in ${raw.replace(/^the\s+/i, "")}`);
			else unresolved.push({ what: raw, why: "skill" });
		}
	}

	// Proficiency: "gain proficiency with X, Y and Z" up to the end of the sentence or the next thing the sentence gives.
	for (const m of flat.matchAll(/\bgain proficiency (?:with|in)\s+([^.]*?)(?=\.|,?\s+(?:plus|as well as|but|and\s+(?:you|a\s*\+|your))\b|$)/gi)) {
		for (const raw of list(m[1])) {
			const name = singular(raw);
			if (/\b(?:one|two|choice|military|simple|superior|blade|axe|hammer|pick|spear|flail|bow|weapon)s?\b/.test(name) && !names.weapons.has(name)) { unresolved.push({ what: raw, why: "choice" }); continue; }
			if (ARMOUR.has(name)) { for (const key of ARMOUR.get(name)) give("system.details.armourProf.value", "add", key, `Proficiency with ${key}`); continue; }
			if (IMPLEMENT.has(name)) { give("system.details.implementProf.value", "add", IMPLEMENT.get(name), `Proficiency with ${raw}`); continue; }
			const weapon = names.weapons.get(name);
			if (weapon) { give("system.details.weaponProf.value", "add", weapon, `Proficiency with ${raw.replace(/^(?:the|all)\s+/i, "")}`); continue; }
			unresolved.push({ what: raw, why: "unknown" });
		}
	}
	return { changes, names: given, unresolved };
}
