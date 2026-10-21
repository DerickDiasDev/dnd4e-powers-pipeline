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

export const EFFECT_SCHEMA = 1;

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
});

const stableId = seed => createHash("sha1").update(`dnd4e:effect:${seed}`).digest("base64").replace(/[^A-Za-z0-9]/g, "").slice(0, 16);

/**
 * @param {object} section  A parsed power section (hit / miss / effect / aftereffect, each with conditions and ongoing).
 * @param {{itemId: string, img?: (status: string) => string|undefined}} ctx
 * @returns {{effects: object[], unresolved: {what: string, why: string}[]}}
 */
export function buildEffects(section, { itemId, img = () => undefined }) {
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
			changes: [],
			durationType: e.durationType,
			powerEffectType: WHEN[e.subject][e.part],
			dots: e.dots,
			keywords: [],
		},
		flags: { dnd4e: { import: { generated: EFFECT_SCHEMA } } },
	}));
	return { effects: built, unresolved };
}
