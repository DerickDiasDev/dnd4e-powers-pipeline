/**
 * A better token for a monster than the one its name gives. The same creature has other names in 4e and 5e (a goblin mage is a
 * Booyahg Caster), so the match is made inside a family: the 5etools creatures whose name has the monster's creature word, or whose
 * type tag begins with it ("goblin" and "goblinoid"). Among them the one that is most like the monster wins: a caster for a caster,
 * an archer for an archer, a boss for a leader, then the nearest in level (the challenge rating of 5e against the level of 4e) and in size.
 *
 * The 5etools data is the bestiary of the 5etools source repository (see fetch-tokens.mjs --bestiary). Nothing here downloads anything.
 */
import { BOOK_ORDER, GENERIC, MODIFIERS, nameVariants, normalize, words } from "./tokens.mjs";

const CASTER = /\b(caster|mage|wizard|sorcerer|warlock|witch|hexer|shaman|priest|cleric|druid|mystic|seer|oracle|magus|necromancer|enchanter|cultist|acolyte|conjurer|illusionist|diviner|psion|mind|whisperer|spellcaster|adept|warden)\b/i;
const RANGED = /\b(archer|ranger|hunter|bowman|slinger|sniper|marksman|crossbow|gunner|thrower|skirmisher|spitter|spewer|scout)\b/i;
const BOSS = /\b(boss|chief|captain|lord|king|queen|warlord|leader|commander|general|marshal|champion|overlord|patriarch|matriarch|baron|duke|prince|princess|master|sergeant|lieutenant)\b/i;
const SIZE = { T: 0, S: 1, M: 2, L: 3, H: 4, G: 5 };
const SIZE_4E = { tiny: 0, sm: 1, small: 1, med: 2, medium: 2, lg: 3, large: 3, huge: 4, grg: 5, gargantuan: 5 };

const crNumber = cr => {
	const v = typeof cr === "object" && cr ? cr.cr : cr;
	if (typeof v === "number") return v;
	if (typeof v === "string") { const [a, b] = v.split("/"); return b ? Number(a) / Number(b) : Number(a); }
	return 0;
};

/** The words of a creature's type tags: "goblinoid", "yuan-ti"... */
const tagsOf = type => (typeof type === "object" && type ? (type.tags ?? []) : []).map(t => normalize(typeof t === "string" ? t : t.tag ?? ""));

/**
 * The 5etools creatures that have a token, from the files of the bestiary ({ monster: [...] } by source) and the list of token files.
 * A creature that copies another (`_copy`) takes the type, size, challenge rating and spellcasting it does not give itself.
 * @param {Record<string, object[]>} monstersBySource
 * @param {string[]} tokenFiles   "MM/Goblin.webp"
 */
export function candidatesFrom(monstersBySource, tokenFiles) {
	const files = new Set(tokenFiles);
	const all = Object.entries(monstersBySource).flatMap(([source, list]) => list.map(m => ({ ...m, source: m.source ?? source })));
	const byKey = new Map(all.map(m => [`${m.source}|${m.name}`, m]));
	const out = [];
	for (const m of all) {
		const base = m._copy ? byKey.get(`${m._copy.source}|${m._copy.name}`) : null;
		const get = key => m[key] ?? base?.[key];
		const file = [`${m.source}/${m.name}.webp`, `${m.source}/${m.name}.png`].find(f => files.has(f));
		if (!file || !get("type")) continue;
		const nameWords = words(m.name);
		out.push({
			file, name: m.name, source: m.source, words: nameWords,
			tags: tagsOf(get("type")), cr: crNumber(get("cr")), size: SIZE[(get("size") ?? ["M"])[0]] ?? 2,
			caster: Boolean(get("spellcasting")) || CASTER.test(m.name), ranged: RANGED.test(m.name), boss: BOSS.test(m.name),
		});
	}
	return out;
}

/** What a 4e monster is like, for the comparison: its level, size and whether it casts, shoots, leads or is an elite or a solo. */
export function profileOf(actor) {
	const d = actor.system?.details ?? {};
	const role = d.role ?? {};
	const name = actor.name ?? "";
	return {
		level: Number(d.level) || 1,
		size: SIZE_4E[String(d.size ?? "med").toLowerCase()] ?? 2,
		caster: CASTER.test(name) || role.primary === "controller",
		ranged: RANGED.test(name) || role.primary === "artillery",
		boss: BOSS.test(name) || Boolean(role.leader),
		big: ["elite", "solo"].includes(role.secondary),
		minion: role.secondary === "minion",
	};
}

const rank = source => { const i = BOOK_ORDER.indexOf(source); return i < 0 ? BOOK_ORDER.length : i; };
const contains = (words, phrase) => { for (let i = 0; i + phrase.length <= words.length; i++) if (phrase.every((w, k) => words[i + k] === w)) return true; return false; };

/** Elements, materials and colours: they describe a creature, they are not one. */
const DESCRIBES = ["fire", "flame", "ice", "frost", "cold", "storm", "stone", "iron", "bone", "blood", "dark", "shadow", "death", "night", "blue", "red", "green", "black", "white", "gold", "golden", "silver", "steel", "wind", "water", "earth", "ash", "dust", "grave", "crystal", "thunder", "lightning", "venom", "poison", "acid", "sea", "sky", "sun", "moon", "star", "gloom", "doom", "wild", "feral", "savage", "mad", "vile", "tainted", "cursed", "undead", "skeletal", "zombie"];
const NOT_A_NAME = new Set([...GENERIC, ...MODIFIERS]);
const DESCRIBES_SET = new Set(DESCRIBES);
const creatureWordsCache = new WeakMap();
/**
 * The single words that are a creature: `whole` the ones that are a whole name of 5etools ("goblin"), `last` the ones that end a name
 * ("slaad" of "Blue Slaad"). A name begins with its creature ("Slaad Spawn"), but ends with a role ("Ice Gargoyle Reaver").
 */
function creatureWords(candidates) {
	if (!creatureWordsCache.has(candidates)) {
		const whole = new Set(), last = new Set();
		for (const c of candidates) { last.add(c.words[c.words.length - 1]); if (c.words.length === 1) whole.add(c.words[0]); }
		creatureWordsCache.set(candidates, { whole, last });
	}
	return creatureWordsCache.get(candidates);
}

/**
 * The creature words of a monster's name to look for a family by, the longest first: the beginnings and endings of the name that do not
 * begin with a role, a size or a kind ("giant sea" of "Giant Sea Snake" is not a creature), and a single word only if it names a creature.
 */
function phrasesOf(name, candidates) {
	const seen = new Set(), out = [];
	for (const w of nameVariants(name)) {
		for (let length = w.length; length >= 1; length--) {
			for (const [side, phrase] of [["start", w.slice(0, length)], ["end", w.slice(w.length - length)]]) {
				if (NOT_A_NAME.has(phrase[0]) && length < w.length) continue;
				if (length === 1 && (DESCRIBES_SET.has(phrase[0]) || phrase[0].length < 4 || !(side === "start" ? creatureWords(candidates).last : creatureWords(candidates).whole).has(phrase[0]))) continue;
				const key = `${side}:${phrase.join(" ")}`;
				if (!seen.has(key)) { seen.add(key); out.push({ phrase, side, whole: length === w.length }); }
			}
		}
	}
	return out;
}

/** How like the monster a creature of the family is: higher is better. */
export function score(profile, c, phrase, nameWords) {
	let s = -Math.min(6, Math.abs(c.cr - profile.level * 0.75)) * 0.5;
	if (profile.caster) s += c.caster ? 3 : -1.5; else if (c.caster) s -= 1.5;
	if (profile.ranged && !profile.caster) s += c.ranged ? 2 : 0; else if (c.ranged && !profile.ranged) s -= 1;
	if (profile.boss) s += c.boss ? 3 : -1; else if (c.boss) s -= 2;
	if (profile.big && c.boss) s += 1;
	if (c.size === profile.size) s += 1;
	if (c.words.join(" ") === phrase.join(" ") && !profile.caster && !profile.boss) s += 1.5;
	s += 2 * c.words.filter(w => nameWords.includes(w) && !phrase.includes(w)).length;
	if (!contains(c.words, phrase)) s -= 2; // of the family by its type tag only (a Booyahg for "goblin")
	return s;
}

/** A type tag family is a family of a creature word only when it is small: "goblinoid" for "goblin", not "human" or "demon". */
const TAG_FAMILY_MAX = 80;

/**
 * The token for a monster from its family: `{ file, how, like }` or null (`like` is the name of the creature chosen). The same name
 * as a creature of 5etools comes first ("exact"); then the creatures whose name has the monster's creature word, and, for a word the
 * name begins with, the ones whose type tag begins with it ("family").
 */
export function matchFamily(actor, candidates) {
	const profile = profileOf(actor);
	const variants = nameVariants(actor.name);
	const best = (family, phrase, nameWords) => family.map(c => ({ c, s: score(profile, c, phrase, nameWords) }))
		.sort((a, b) => b.s - a.s || rank(a.c.source) - rank(b.c.source) || a.c.name.localeCompare(b.c.name))[0].c;
	for (const w of variants) {
		const exact = candidates.filter(c => c.words.join(" ") === w.join(" "));
		if (exact.length) return { file: best(exact, w, w).file, how: "exact", like: exact[0].name };
	}
	for (const { phrase, side, whole } of phrasesOf(actor.name, candidates)) {
		const nameWords = variants.find(w => contains(w, phrase)) ?? phrase;
		let family = candidates.filter(c => contains(c.words, phrase));
		if (!family.length && !whole && phrase.length === 1 && side === "start") {
			const tagged = candidates.filter(c => c.tags.some(t => t.startsWith(phrase[0])));
			if (tagged.length <= TAG_FAMILY_MAX) family = tagged;
		}
		if (!family.length) continue;
		const chosen = best(family, phrase, nameWords);
		return { file: chosen.file, how: "family", like: chosen.name };
	}
	return null;
}
