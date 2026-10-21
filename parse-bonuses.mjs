/**
 * Bonuses, penalties and resistances written in the text ("You gain a +2 power bonus to attack rolls until the end of your next
 * turn", "+1 feat bonus to Will", "you gain resist 5 to all damage"), as structured data and as the `changes` the dnd4e
 * system's ActiveEffects use.
 *
 * Only what is certain is built. A sentence is skipped when it carries a condition the effect model cannot hold ("against",
 * "while", "if", "your next attack roll", an amount that depends on a modifier or the level...); skipped sentences are reported so
 * the builder can count them.
 *
 * Where the numbers go (checked against the installed system's code):
 *   defences, speed, saves, initiative, skills   a bonus slot of the sheet: system.<path>.<feat|item|power|race|untyped> (+ shield, enhance, class on defences)
 *   attack and damage rolls                      the system's keyed keys: power.<attack|damage>.<keyword>.<type>, matched against the power's keywords
 *   resistances                                  system.resistances.<damage type>.res (resist) or .vuln (vulnerable)
 * Bonuses of different types stack and the same type does not: typed slots use "upgrade" (the highest wins), untyped use "add".
 */
import { parseDuration, subjectOf } from "./parse-powers.mjs";

export const SKILL_KEYS = Object.freeze({
	acrobatics: "acr", arcana: "arc", athletics: "ath", bluff: "blu", diplomacy: "dip", dungeoneering: "dun", endurance: "end", heal: "hea",
	history: "his", insight: "ins", intimidate: "itm", nature: "nat", perception: "prc", religion: "rel", stealth: "stl", streetwise: "stw", thievery: "thi",
});
const DEFENCE_KEYS = Object.freeze({ ac: "ac", "armor class": "ac", "armour class": "ac", fortitude: "fort", fort: "fort", reflex: "ref", ref: "ref", will: "wil" });
const ALL_DEFENCES = ["ac", "fort", "ref", "wil"];
export const DAMAGE_TYPE_KEYS = ["acid", "cold", "fire", "force", "lightning", "necrotic", "poison", "psychic", "radiant", "thunder"];

/** The sheet slot for each bonus type of the text. Attack and damage rolls only know the first five. */
const SLOT = Object.freeze({ feat: "feat", item: "item", power: "power", racial: "race", untyped: "untyped", shield: "shield", enhancement: "enhance", class: "class" });
const ROLL_TYPES = new Set(["feat", "item", "power", "race", "untyped"]);
const DEFENCE_SLOTS = new Set(["feat", "item", "power", "race", "untyped", "shield", "enhance", "class"]);
const PLAIN_SLOTS = new Set(["feat", "item", "power", "race", "untyped"]);

/** The keyword the system matches a power against ("melee", "ranged", "usesImplement", ...) for each kind of roll in the text. */
const ROLL_KEYWORD = Object.freeze({ "": "global", melee: "melee", ranged: "ranged", weapon: "weapon", implement: "usesImplement", opportunity: "opp", charge: "charge", basic: "basic", "melee basic": "mBasic", "ranged basic": "rBasic" });

/** What makes a sentence too conditional for a plain effect. */
const CONDITIONAL = /\b(?:if|while|whenever|unless|instead|when|once per|each time|for each|as long as|during|against|next|first|each of|per |at the (?:start|end)|that (?:target|enemy|creature)|equal(?:s)? to|plus|bloodied|adjacent|within|aura|zone|stance|form|rage|either|or gain|choose|has|any (?:creature|enemy|ally|allies)|that includes|for any)\b/i;

const BONUS_RE = /([+−–-])\s?(\d+)\s+(?:(feat|item|power|racial|shield|enhancement|class|untyped)\s+)?(bonus|penalty)\s+to\s+/gi;
/** Words after a target that narrow the bonus ("made to perform the ritual", "for any attack that..."): the bonus is not general. */
const QUALIFIER = /\s+(?:made|on|for|that|which|against|while|when|if|equal|instead|with|of|from|per)\b/i;
/** Words after a target that only start the next clause. */
const CLAUSE = /\s+(?:and\s+(?:the|you|it|your|can|cannot|is|are|resist|gain|gains|have|has|take|takes)\b|plus\b|in addition|until\b|\()|,\s+(?:and\s+)?(?:the|you|it|your|can|cannot|is|are|resist|gain|gains)\b/i;

const clean = s => String(s).toLowerCase().replace(/\s+/g, " ").replace(/^(?:your|the|all|any)\s+/, "").trim();

/**
 * The sheet or keyed target(s) a target phrase stands for.
 * @returns {{kind: "defence"|"speed"|"saves"|"deathsaves"|"initiative"|"skill"|"skills"|"abilityChecks"|"attack"|"damage", key?: string, keyword?: string}[]|null} null when the phrase is not one we know
 */
export function targetsOf(phrase) {
	const list = String(phrase).replace(/\s*\([^)]*\)/g, "").split(/\s*,\s*(?:and\s+|or\s+)?|\s+(?:and|or)\s+/i).map(clean).filter(Boolean);
	if (!list.length) return null;
	// "Athletics and Endurance checks": the suffix is written once, at the end of the list.
	const suffix = list.at(-1).match(/\s(checks)$/)?.[1];
	const items = suffix ? list.map((item, i) => (i < list.length - 1 && SKILL_KEYS[item] ? `${item} ${suffix}` : item)) : list;
	const out = [];
	for (const raw of items) {
		const t = raw.replace(/\s+defen[sc]es?$/, "").replace(/\s+defen[sc]e$/, "");
		let m;
		if (/^(?:defen[sc]es?|all defen[sc]es?)$/.test(raw) || raw === "all defenses" || raw === "all defences") { for (const d of ALL_DEFENCES) out.push({ kind: "defence", key: d }); continue; }
		if (DEFENCE_KEYS[t]) { out.push({ kind: "defence", key: DEFENCE_KEYS[t] }); continue; }
		if (/^speed$/.test(raw)) { out.push({ kind: "speed" }); continue; }
		if (/^death saving throws$/.test(raw)) { out.push({ kind: "deathsaves" }); continue; }
		if (/^saving throws$/.test(raw)) { out.push({ kind: "saves" }); continue; }
		if (/^initiative(?: checks| rolls)?$/.test(raw)) { out.push({ kind: "initiative" }); continue; }
		if (/^skill checks$/.test(raw)) { out.push({ kind: "skills" }); continue; }
		if (/^ability checks$/.test(raw)) { out.push({ kind: "abilityChecks" }); continue; }
		if ((m = raw.match(/^([a-z]+) checks$/)) && SKILL_KEYS[m[1]]) { out.push({ kind: "skill", key: SKILL_KEYS[m[1]] }); continue; }
		if ((m = raw.match(/^(?:(melee basic|ranged basic|melee|ranged|weapon|implement|opportunity|charge|basic) )?(attack|damage) rolls$/))) {
			out.push({ kind: m[2], keyword: ROLL_KEYWORD[m[1] ?? ""] });
			continue;
		}
		return null; // one unknown target makes the whole bonus unsafe to build
	}
	return out;
}

/**
 * The `changes` (system.changes of an ActiveEffect4e) for one bonus.
 * @param {number} amount   signed
 * @param {string} type     the bonus type as written: feat, item, power, racial, shield, enhancement, class, untyped
 * @returns {{key: string, type: string, value: string, priority: null}[]|null} null when a target cannot take that type of bonus
 */
export function changesOf(amount, type, targets) {
	const slot = SLOT[type] ?? "untyped";
	const change = (key, slotName) => ({ key, type: slotName === "untyped" ? "add" : "upgrade", value: String(amount), priority: null });
	const out = [];
	for (const t of targets) {
		if (t.kind === "defence") { if (!DEFENCE_SLOTS.has(slot)) return null; out.push(change(`system.defences.${t.key}.${slot}`, slot)); continue; }
		if (!PLAIN_SLOTS.has(slot)) return null;
		switch (t.kind) {
			case "speed": out.push(change(`system.movement.base.${slot}`, slot)); break;
			case "saves": out.push(change(`system.details.saves.${slot}`, slot)); break;
			case "deathsaves": out.push(change(`system.details.deathsavebon.${slot}`, slot)); break;
			case "initiative": out.push(change(`system.attributes.init.${slot}`, slot)); break;
			case "skill": out.push(change(`system.skills.${t.key}.${slot}`, slot)); break;
			case "skills": out.push(change(`system.modifiers.skills.${slot}`, slot)); break;
			case "abilityChecks": out.push(change(`system.modifiers.abilities.${slot}`, slot)); break;
			case "attack":
			case "damage":
				// The system's own keyed bonuses: owner.effectType.keyword.bonusType; "add" because the key is not an actor field.
				if (!ROLL_TYPES.has(slot)) return null;
				out.push({ key: `power.${t.kind}.${t.keyword}.${slot}`, type: "add", value: String(amount), priority: null });
				break;
			default: return null;
		}
	}
	return out;
}

/** Who a bonus lands on, from the words before it: "you gain" -> self, "each ally gains" -> allies, "the target takes" -> target. */
export function bonusSubject(before) {
	let you = -1, ally = -1, target = -1;
	for (const m of before.matchAll(/\b(?:you|yourself)\b/gi)) you = m.index;
	for (const m of before.matchAll(/\b(?:allies|ally)\b/gi)) ally = m.index;
	for (const m of before.matchAll(/\b(?:targets?|enem(?:y|ies)|creatures?|it|him|her|them|each|one|that|those)\b/gi)) target = m.index;
	const nearest = Math.max(you, ally, target);
	if (nearest < 0) return "unknown";
	if (nearest === ally) return "allies";
	return nearest === you ? "self" : "target";
}

const SENTENCES = /(?<=[.;])\s+|\n/;

/**
 * @param {string} text  A section of a power (or a feature, a feat benefit...).
 * @returns {{bonuses: object[], skipped: {sentence: string, why: string}[]}}
 *   bonuses: {amount, type, phrase, subject, duration, changes}
 */
export function parseBonuses(text) {
	const bonuses = [], skipped = [];
	for (const sentence of String(text ?? "").split(SENTENCES)) {
		if (!/[+−–-]\s?\d+\s+(?:\w+\s+)?(?:bonus|penalty)\s+to\b/i.test(sentence)) continue;
		const duration = parseDuration(sentence);
		// The duration clause is read, then taken out: "until the end of your next turn" has "next" in it, which would look conditional.
		const rest = sentence.replace(/\(save ends[^)]*\)/gi, "").replace(/until the (?:start|end) of [^,.;]{1,30}?next turn/gi, "").replace(/until the end of the encounter/gi, "");
		if (CONDITIONAL.test(rest.replace(BONUS_RE, m => m.replace(/\bnext\b/gi, "")))) { skipped.push({ sentence: sentence.slice(0, 140), why: "conditional" }); continue; }
		const heads = [...rest.matchAll(BONUS_RE)];
		for (const [i, m] of heads.entries()) {
			const amount = (m[1] === "+" ? 1 : -1) * Number(m[2]);
			const type = (m[3] ?? "untyped").toLowerCase();
			// Everything up to the next bonus ("... and a +2 bonus to ...") or the end of the sentence; minus the joining "and a".
			let tail = rest.slice(m.index + m[0].length, i + 1 < heads.length ? heads[i + 1].index : rest.length).replace(/(?:,\s*)?(?:and|plus)\s+(?:an?\s*)?$/i, "");
			const qualifier = tail.search(QUALIFIER), clause = tail.search(CLAUSE);
			if (qualifier >= 0 && (clause < 0 || qualifier < clause)) { skipped.push({ sentence: sentence.slice(0, 140), why: "qualified" }); continue; }
			if (clause >= 0) tail = tail.slice(0, clause);
			const phrase = tail.replace(/[\s,;:.]+$/, "").trim();
			const targets = targetsOf(phrase);
			if (!targets) { skipped.push({ sentence: sentence.slice(0, 140), why: `target:${phrase.slice(0, 40)}` }); continue; }
			const changes = changesOf(amount, type, targets);
			if (!changes) { skipped.push({ sentence: sentence.slice(0, 140), why: `type:${type}` }); continue; }
			bonuses.push({ amount, type, phrase, sentence: sentence.slice(0, 200), subject: bonusSubject(rest.slice(0, m.index)), duration, changes });
		}
	}
	return { bonuses, skipped };
}

const RESIST_RE = new RegExp(`\\b(resist(?:ance)?|vulnerab(?:le|ility))\\s+(\\d+)\\s+(?:to\\s+)?(all\\s+damage|(?:(?:${DAMAGE_TYPE_KEYS.join("|")})(?:\\s*,\\s*(?:and\\s+|or\\s+)?|\\s+(?:and|or)\\s+|\\s+))+damage)(?!\\s+equal)`, "gi");

/**
 * Resist and vulnerable with a plain number ("resist 5 to all damage"). Amounts that depend on a modifier or a level, and
 * "the chosen damage type", are not built.
 * @param {string[]} allTypes  every damage type of the system's `resistances` map (an "all" covers each of them)
 * @returns {{bonuses: object[], skipped: object[]}} each with `resist: true`
 */
export function parseResistances(text, allTypes = DAMAGE_TYPE_KEYS) {
	const bonuses = [], skipped = [];
	for (const sentence of String(text ?? "").split(SENTENCES)) {
		if (!/\b(?:resist|vulnerab)/i.test(sentence)) continue;
		const duration = parseDuration(sentence);
		const rest = sentence.replace(/\(save ends[^)]*\)/gi, "").replace(/until the (?:start|end) of [^,.;]{1,30}?next turn/gi, "").replace(/until the end of the encounter/gi, "");
		if (CONDITIONAL.test(rest.replace(RESIST_RE, ""))) { skipped.push({ sentence: sentence.slice(0, 140), why: "conditional" }); continue; }
		let found = false;
		for (const m of rest.matchAll(RESIST_RE)) {
			found = true;
			const vuln = /^vulnerab/i.test(m[1]);
			const amount = Number(m[2]);
			const types = /^all/i.test(m[3]) ? allTypes : DAMAGE_TYPE_KEYS.filter(t => new RegExp(`\\b${t}\\b`, "i").test(m[3]));
			const changes = types.map(t => ({ key: `system.resistances.${t}.${vuln ? "vuln" : "res"}`, type: vuln ? "downgrade" : "upgrade", value: String(vuln ? -amount : amount), priority: null }));
			bonuses.push({ amount: vuln ? -amount : amount, type: "resist", phrase: m[0].trim(), sentence: sentence.slice(0, 200), subject: bonusSubject(rest.slice(0, m.index)), duration, changes, resist: true });
		}
		if (!found) skipped.push({ sentence: sentence.slice(0, 140), why: "amount" });
	}
	return { bonuses, skipped };
}
