/**
 * Which 5etools token goes with a 4e monster. The names are not the same (4e has its own monsters), so besides the exact name a
 * monster takes the token of a creature its name begins or ends with: "Goblin Cutter" the Goblin, "Fledgling White Dragon" the
 * White Dragon (5etools has "Young White Dragon" and so on: a modifier before the name is allowed).
 *
 * The token list is the file names of the 5etools image repository (`bestiary/tokens/<book>/<name>.webp`); see fetch-tokens.mjs.
 * Nothing here downloads anything.
 */

/** Words that name a role or a trade, not a creature: alone, they are not enough to take a token. */
export const GENERIC = new Set([
	"warrior", "guard", "soldier", "archer", "mage", "priest", "scout", "brute", "hunter", "knight", "assassin", "thug", "cultist", "acolyte",
	"fighter", "wizard", "sorcerer", "rogue", "ranger", "cleric", "captain", "chief", "boss", "leader", "champion", "lord", "king", "queen",
	"elder", "ancient", "young", "adult", "greater", "lesser", "minion", "elite", "solo", "swarm", "spirit", "servant", "guardian", "stalker",
	"slayer", "lurker", "skirmisher", "blackguard", "berserker", "shaman", "witch", "druid", "bard", "monk", "noble", "commoner", "veteran",
	// kinds, not creatures
	"dragon", "demon", "devil", "giant", "fiend", "beast", "elemental", "golem", "undead", "apprentice", "devourer",
]);
/** Words that make what follows a name ("Adept of Orcus"). */
const LINKS = new Set(["of", "the", "in", "from"]);
/** Modifiers 5etools puts before a creature's name. */
export const MODIFIERS = ["young", "adult", "ancient", "elder", "greater", "lesser", "giant", "dire", "wild"];
/** Books to prefer when several have a token of the name: the core ones first. */
export const BOOK_ORDER = ["MM", "MPMM", "XMM", "VGM", "MTF", "FTD", "MToF", "VRGR"];

export const words = text => String(text).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean)
	.map(w => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w));
export const normalize = text => words(text).join(" ");

/**
 * Indexes the token files ("MM/Goblin.webp") by the normalised creature name, the preferred book first.
 * @param {string[]} files
 * @returns {Map<string, string>}
 */
export function indexTokens(files) {
	const rank = book => { const i = BOOK_ORDER.indexOf(book); return i < 0 ? BOOK_ORDER.length : i; };
	const index = new Map();
	for (const file of [...files].sort((a, b) => rank(a.split("/")[0]) - rank(b.split("/")[0]) || a.localeCompare(b))) {
		const name = normalize(file.split("/").pop().replace(/\.(webp|png|jpg)$/i, ""));
		if (name && !index.has(name)) index.set(name, file);
	}
	return index;
}

/** The names of a monster to try: the whole, without a bracket, and each part of "Name, Trade" and "Name (Kind)". */
export function nameVariants(name) {
	const variants = new Set([name, name.replace(/\([^)]*\)/g, "")]);
	for (const part of name.split(/[,(]/)) variants.add(part.replace(/[)]/g, ""));
	return [...variants].map(v => words(v)).filter(w => w.length);
}

/**
 * The token for a monster: `{ file, how }` or null. `how` says how sure the match is: "exact" (the same name), "edge" (the name of
 * a creature the monster's name begins or ends with) or "modifier" (the same with Young, Adult... before it).
 */
export function matchToken(name, index) {
	const variants = nameVariants(name);
	for (const w of variants) { const file = index.get(w.join(" ")); if (file) return { file, how: "exact" }; }
	for (const w of variants) {
		// The longest beginning or ending of the name first; a single generic word is not a creature.
		for (let length = w.length - 1; length >= 1; length--) {
			for (const [side, phrase] of [["start", w.slice(0, length)], ["end", w.slice(w.length - length)]]) {
				// A single word must name a creature: not a role, a size or a short word; and what follows "of" or "the" is a name, not a kind.
				if (length === 1 && (GENERIC.has(phrase[0]) || MODIFIERS.includes(phrase[0]) || phrase[0].length < 4)) continue;
				if (side === "end" && length < w.length && LINKS.has(w[w.length - length - 1])) continue;
				const key = phrase.join(" ");
				const file = index.get(key);
				if (file) return { file, how: "edge" };
				if (length < 2) continue;
				for (const modifier of MODIFIERS) { const found = index.get(`${modifier} ${key}`); if (found) return { file: found, how: "modifier" }; }
			}
		}
	}
	return null;
}

/** Where a token is kept on disk, under the folder it is downloaded to: "MM/Goblin Cutter's.webp" -> "MM/goblin-cutter-s.webp". */
export function localPath(file) {
	const [book, ...rest] = file.split("/");
	const name = rest.join("-").replace(/\.(webp|png|jpg)$/i, "");
	return `${book}/${name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}${file.slice(file.lastIndexOf("."))}`;
}
