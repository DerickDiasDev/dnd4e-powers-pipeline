/**
 * The class features that make you choose: "Choose one of the following fighting styles and gain its benefit: Archer Fighting Style, Beast
 * Mastery, ..." followed by each option under a heading of its own. A feature like that is read into its options ({name, text}) so the
 * builder can offer them and the import can give the one chosen instead of the whole list.
 *
 * Only a feature whose first sentence says to choose, and whose text then holds at least two options under headings, is a choice; a
 * feature that hands out powers "of your choice" is not (those are the class's power options).
 */

const CHOOSES = /\b(?:one|two|three) of (?:the following|these)\b|\bchoose (?:either|one|two|three)\b|\byou (?:can )?(?:choose|select) (?:one|either)\b/i;
const POWERS_OF_CHOICE = /\bpowers? of your choice\b/i;
const NUMBERS = { one: 1, either: 1, two: 2, three: 3 };

const words = line => line.split(/\s+/).filter(Boolean).length;
/** A heading is a short line that is not a sentence: no full stop at its end, starting with a capital. */
const isHeading = line => line.length <= 60 && words(line) <= 7 && !/[.:;,]$/.test(line) && /^[A-Z0-9"“']/.test(line);

/** The names a first sentence lists ("...gain its benefit: A, B, C or D."), or []. */
function listedNames(intro) {
	const either = intro.match(/(?:either|one of)\s+([^.:]+?)\s+or\s+([^.:,]+?)(?:\s+as|\.|$)/i);
	if (either && !/the following|these/i.test(either[0])) return [either[1], either[2]].map(s => s.trim());
	const at = intro.indexOf(":");
	if (at < 0) return [];
	return intro.slice(at + 1).replace(/\.$/, "").split(/,\s*(?:or\s+)?|\s+or\s+|\s+and\s+/).map(s => s.trim()).filter(Boolean);
}

/**
 * @param {string} text  the text of a class feature, its lines separated by newlines
 * @returns {{pick: number, options: {name: string, text: string}[]}|null}
 */
export function parseChoice(text) {
	const lines = String(text ?? "").split("\n").map(l => l.trim()).filter(Boolean);
	if (lines.length < 3) return null;
	const [intro, ...body] = lines;
	if (!CHOOSES.test(intro) || POWERS_OF_CHOICE.test(intro)) return null;
	const pick = NUMBERS[intro.match(/\b(one|two|three|either)\b/i)?.[1].toLowerCase()] ?? 1;

	// The headings: the names the sentence lists, when the text has them as lines; else the short lines that are not sentences.
	const listed = new Set(listedNames(intro).map(n => n.toLowerCase()));
	const named = listed.size >= 2 && [...listed].filter(n => body.some(l => l.toLowerCase() === n)).length >= 2;
	const heading = line => (named ? listed.has(line.toLowerCase()) : isHeading(line));

	const options = [];
	for (const line of body) {
		if (heading(line) && (!options.length || options.at(-1).lines.length)) options.push({ name: line, lines: [] });
		else if (options.length) options.at(-1).lines.push(line);
	}
	const real = options.filter(o => o.lines.length);
	if (real.length < 2) return null;
	return { pick, options: real.map(o => ({ name: o.name, text: o.lines.join("\n") })) };
}
