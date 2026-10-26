/**
 * ActiveEffects for powers: the conditions and ongoing damage a power puts on its targets (or on its user), as the embedded
 * effects the dnd4e system applies when the power is used (`ActiveEffect4e`: `statuses`, `system.durationType`,
 * `system.powerEffectType`, `system.dots`).
 *
 * Only what the parser is sure about becomes an effect: a condition the text *applies* (not one it mentions), on a subject the
 * text names (the target or the user), with a duration the system has. Everything else stays in `flags.dnd4e.import.candidates`
 * and is counted as unresolved, so a power's review note says how much is left.
 *
 * Pure functions: the item builder (build-db.mjs) calls `buildEffects` per converted section.
 */
import { createHash } from "node:crypto";
import { parseBonuses, parseResistances } from "./parse-bonuses.mjs";
import { parseProficiencies } from "./parse-proficiency.mjs";
import { SKILL_BY_NAME, labelMap } from "./system-enums.mjs";

export const EFFECT_SCHEMA = 2;

/** The parser's condition names -> the system's status ids (CONFIG.DND4E.statusEffect). */
export const STATUS_OF = Object.freeze({ marked: "mark", combatAdvantage: "grantingCA" });
export const statusId = name => STATUS_OF[name] ?? name;

const LABEL_OF = Object.freeze({ marked: "Marked", combatAdvantage: "Grants combat advantage" });
const label = name => LABEL_OF[name] ?? name[0].toUpperCase() + name.slice(1);

/** The system's duration types (CONFIG.DND4E.durationType) for the parser's durations. */
const DURATION = Object.freeze({
	endOfTurn: { source: "endOfUserTurn", target: "endOfTargetTurn", other: "custom" },
	startOfTurn: { source: "startOfUserTurn", target: "startOfTargetTurn", other: "custom" },
});
export function durationTypeOf(duration) {
	if (!duration) return "";
	if (duration.type === "saveEnds") return "saveEnd";
	if (duration.type === "endOfEncounter") return "endOfEncounter";
	return DURATION[duration.type]?.[duration.owner] ?? "custom";
}

/** The system's `powerEffectType` (when the effect is applied) for the section a condition is in and who it lands on. */
const WHEN = Object.freeze({
	target: { hit: "hit", miss: "miss", effect: "all" },
	self: { hit: "selfHit", miss: "selfMiss", effect: "self" },
	allies: { hit: "allies", miss: "allies", effect: "allies" },
});

/** "+2 power bonus to all defenses", "-2 penalty to attack rolls", "Resist 5 to all damage". */
export function bonusName(b) {
	if (b.resist) return b.phrase[0].toUpperCase() + b.phrase.slice(1);
	const signed = `${b.amount > 0 ? "+" : "-"}${Math.abs(b.amount)}`;
	return `${signed} ${b.type === "untyped" ? "" : `${b.type} `}${b.amount > 0 ? "bonus" : "penalty"} to ${b.phrase}`;
}

/**
 * The bonuses, penalties and resistances written in a text, as effects. Sentences that are conditional or whose amount depends
 * on something else are not built (parse-bonuses.mjs); a subject the text does not name is reported.
 * @returns {{effects: object[], unresolved: {what: string, why: string}[]}} effects without ids yet: { subject, durationType, changes, name }
 */
export function bonusEffects(text, { damageTypes } = {}) {
	const effects = [], unresolved = [];
	for (const b of [...parseBonuses(text).bonuses, ...parseResistances(text, damageTypes).bonuses]) {
		if (!["self", "target", "allies"].includes(b.subject)) { unresolved.push({ what: b.resist ? "resist" : "bonus", why: "subject" }); continue; }
		effects.push({ subject: b.subject, durationType: durationTypeOf(b.duration), changes: b.changes, name: bonusName(b) });
	}
	return { effects, unresolved };
}

const stableId = seed => createHash("sha1").update(`dnd4e:effect:${seed}`).digest("base64").replace(/[^A-Za-z0-9]/g, "").slice(0, 16);

/**
 * @param {object} section  A parsed power section (hit / miss / effect / aftereffect, each with conditions and ongoing).
 * @param {{itemId: string, img?: (status: string) => string|undefined}} ctx
 * @returns {{effects: object[], unresolved: {what: string, why: string}[]}}
 */
export function buildEffects(section, { itemId, img = () => undefined, damageTypes }) {
	const effects = [];
	const unresolved = [];
	const groups = new Map(); // "section|subject|durationType" -> { names, ... }

	for (const part of ["hit", "miss", "effect"]) {
		for (const c of section[part]?.conditions ?? []) {
			if (!c.applied) { unresolved.push({ what: c.name, why: "not-applied" }); continue; }
			if (c.subject !== "target" && c.subject !== "self") { unresolved.push({ what: c.name, why: "subject" }); continue; }
			const durationType = durationTypeOf(c.duration);
			const key = `${part}|${c.subject}|${durationType}`;
			const group = groups.get(key) ?? { part, subject: c.subject, durationType, names: [], duration: c.duration };
			if (!group.names.includes(c.name)) group.names.push(c.name);
			groups.set(key, group);
		}
		for (const o of section[part]?.ongoing ?? []) {
			const subject = o.subject === "self" ? "self" : "target";
			if (typeof o.amount !== "number") { unresolved.push({ what: "ongoing", why: "formula" }); continue; }
			if (o.subject === "unknown" && part === "effect") { unresolved.push({ what: "ongoing", why: "subject" }); continue; }
			effects.push({
				part, subject, durationType: o.saveEnds ? "saveEnd" : "", statuses: [], dots: [{ amount: String(o.amount), types: [...o.types] }],
				name: `Ongoing ${o.amount}${o.types.length ? ` ${o.types.join(", ")}` : ""}`,
			});
		}
		const bonus = bonusEffects(section[part]?.text, { damageTypes });
		unresolved.push(...bonus.unresolved);
		// "Level 11: +3 power bonus" lines change the number as the character levels: a fixed value would be wrong later, so not built.
		const scales = (section.scaling ?? []).some(s => s.field === part);
		if (scales && bonus.effects.length) { unresolved.push(...bonus.effects.map(() => ({ what: "bonus", why: "scales" }))); continue; }
		for (const b of bonus.effects) effects.push({ part, subject: b.subject, durationType: b.durationType, statuses: [], dots: [], changes: b.changes, name: b.name });
	}
	for (const g of groups.values()) {
		effects.push({ part: g.part, subject: g.subject, durationType: g.durationType, statuses: g.names.map(statusId), dots: [], name: g.names.map(label).join(" and ") });
	}
	for (const a of section.aftereffect?.conditions ?? []) unresolved.push({ what: a.name, why: "aftereffect" });

	const built = effects.map((e, i) => ({
		_id: stableId(`${itemId}:${i}`),
		name: e.name,
		...(e.statuses[0] ? { img: img(e.statuses[0]) } : {}),
		transfer: false,
		statuses: e.statuses,
		system: {
			changes: e.changes ?? [],
			durationType: e.durationType,
			powerEffectType: WHEN[e.subject][e.part],
			dots: e.dots,
			keywords: [],
		},
		flags: { dnd4e: { import: { generated: EFFECT_SCHEMA } } },
	}));
	return { effects: built, unresolved };
}

const CHOICE_OR_SCALING = /\b(?:choose|one of the following|of your choice|select)\b|\bincreases? (?:to|by)\b|\b\d+(?:st|nd|rd|th) level\b|\blevel \d+\b/i;

/**
 * The standing bonuses of a feature, feat, trait or class feature: "You gain a +1 feat bonus to Will." becomes an effect that
 * transfers to the owner while the item is on the actor. Only what holds all the time is built: the subject is the character and
 * there is no duration (a bonus "until the end of the encounter" is a power's, not a feature's).
 * @returns {object[]} effects for the item's `effects`
 */
export function featureEffects(text, { itemId, damageTypes }) {
	// A feature that offers a choice, or whose numbers change with the level, cannot be a fixed effect.
	if (CHOICE_OR_SCALING.test(String(text ?? ""))) return [];
	return bonusEffects(text, { damageTypes }).effects
		.filter(e => e.subject === "self" && e.durationType === "")
		.map((e, i) => ({
			_id: stableId(`${itemId}:${i}`),
			name: e.name,
			transfer: true,
			statuses: [],
			system: { changes: e.changes, durationType: "", powerEffectType: "misc", dots: [], keywords: [] },
			flags: { dnd4e: { import: { generated: EFFECT_SCHEMA } } },
		}));
}

let proficiencyNames = null;
/** The skills and weapons the system has, by lower-case name (the plural of a weapon's name too is found: see parse-proficiency.mjs). */
function proficiencyLookups() {
	if (proficiencyNames) return proficiencyNames;
	const weapons = new Map();
	for (const category of ["simpleM", "simpleR", "militaryM", "militaryR", "superiorM", "superiorR"]) {
		for (const [name, key] of labelMap(category)) {
			weapons.set(name, key);
			weapons.set(name.replace(/ /g, ""), key);
			weapons.set(name.replace(/ies$/, "y").replace(/(?<!s)s$/, ""), key);
		}
	}
	return (proficiencyNames = { skills: SKILL_BY_NAME, weapons });
}

/**
 * The training and proficiencies a feature gives ("You gain training in Arcana.") as one effect that transfers to the owner. The ones the
 * text leaves to a choice are not built (parse-proficiency.mjs).
 * @returns {object[]} zero or one effect
 */
export function proficiencyEffects(text, { itemId }) {
	const { changes, names } = parseProficiencies(text, proficiencyLookups());
	if (!changes.length) return [];
	return [{
		_id: stableId(`${itemId}:proficiency`),
		name: names.join(", "),
		transfer: true,
		statuses: [],
		system: { changes, durationType: "", powerEffectType: "misc", dots: [], keywords: [] },
		flags: { dnd4e: { import: { generated: EFFECT_SCHEMA } } },
	}];
}

/** Sets `effects` on a feature item from its text, and counts them in the import flags. */
export function attachFeatureEffects(item, text, damageTypes) {
	item.effects = [...featureEffects(text, { itemId: item._id, damageTypes }), ...proficiencyEffects(text, { itemId: item._id })];
	if (item.effects.length) item.flags.dnd4e.import.effects = item.effects.length;
	return item;
}
