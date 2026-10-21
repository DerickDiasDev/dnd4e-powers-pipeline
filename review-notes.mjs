/**
 * Review notes: what the conversion could not (fully) automate for a power, as structured data for the importer to explain.
 *
 * The converter leaves raw strings in each item's `flags.dnd4e.import.review` ("code" or "code:detail"). This module turns the
 * strings of a whole bundle into notes `{ code, level, detail? }` for the index, so the importer can show *why* a power has a
 * badge, in the user's language (the database holds codes and parameters, never sentences).
 *
 * Levels:
 *   info  the power works as imported; the note records a choice the converter made (e.g. the damage was found in "Effect")
 *   warn  something is not automated, or a choice was made for the player (e.g. "Strength or Wisdom": the first was used)
 */

export const REVIEW_LEVELS = Object.freeze({
	// info: works as is
	"damage-from": "info", // the damage roll was found in "Effect" or in a "Hit (Defence)" variant instead of "Hit"
	"damage-type-poison-ambiguous": "info", // the Poison keyword may mean poison damage or a non-damaging effect
	"range-origin": "info", // an area with another origin ("centered on the target", "within weapon range"); the text is kept
	"range-sight": "info", // "ranged sight"
	"power-type-unknown": "info", // the class could not be classified as class / theme / path (the importer folders by name anyway)
	"ability-versions": "info", // the player chooses the ability: one version per ability was created
	"effect-unresolved": "info", // some conditions or ongoing damage could not become effects (no known subject, an aftereffect, a formula): see the text
	// warn: not (fully) automated
	"attack-ability": "warn", // an attack ability that is not one of the six: beast, chosen, level
	"attack-ability-choice": "warn", // the player chooses the attack ability; the first was used
	"attack-multiple-defences": "warn", // one roll against several defences; only the first is automated
	"damage-ability-choice": "warn", // the player chooses the damage ability; the first was used
	"damage-mod": "warn", // a damage modifier that was not recognised
	"damage-unparsed": "warn", // the text mentions damage that could not be structured
	"range": "warn", // a range that was not recognised (the text is kept)
	"range-missing": "warn", // the power has no range line
	"partial": "warn", // the parser flagged the entry as only partly understood
});

/** @returns {"info"|"warn"} unknown codes count as warn, so a new kind of note is never silently demoted */
export const levelOf = code => REVIEW_LEVELS[code] ?? "warn";

const MAX_DETAIL = 80;

function parse(raw) {
	const at = raw.indexOf(":");
	return at < 0 ? { code: raw } : { code: raw.slice(0, at), detail: raw.slice(at + 1).trim().slice(0, MAX_DETAIL) };
}

/**
 * @param {object[]} items       The items of one power's bundle (main, ranged variant, children).
 * @param {string} quality       The parser's verdict for the power ("full" or "partial").
 * @param {string[]} [unparsed]  The parser's own problem list for the power.
 * @returns {{code: string, level: "info"|"warn", detail?: string}[]} unique notes, warnings first
 */
export function reviewNotes(items, quality = "full", unparsed = []) {
	const seen = new Map();
	const add = ({ code, detail }) => {
		const key = `${code}\u0000${detail ?? ""}`;
		if (!seen.has(key)) seen.set(key, { code, level: levelOf(code), ...(detail ? { detail } : {}) });
	};
	for (const item of items) for (const raw of item.flags?.dnd4e?.import?.review ?? []) add(parse(raw));

	if (quality !== "full") {
		// A partial entry whose only problem is unstructured damage is already covered by "damage-unparsed".
		const other = unparsed.filter(u => u !== "damage:unparsed" && !u.endsWith(":damage:unparsed"));
		if (other.length || ![...seen.values()].some(n => n.code === "damage-unparsed")) add({ code: "partial", detail: other[0]?.slice(0, MAX_DETAIL) });
	}
	return [...seen.values()].sort((a, b) => (a.level === b.level ? a.code.localeCompare(b.code) : a.level === "warn" ? -1 : 1));
}

/** "none" when there are no notes, "warn" when any note warns, otherwise "info". */
export function reviewLevel(notes) {
	if (!notes.length) return "none";
	return notes.some(n => n.level === "warn") ? "warn" : "info";
}
