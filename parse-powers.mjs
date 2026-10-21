/**
 * Parses the raw power HTML (out/power.json) into a clean, Foundry-independent intermediate schema.
 *
 * Output:
 *   out/parsed/power.json          array of parsed powers
 *   out/parsed/power-report.json   quality stats + everything the parser did not recognise
 *
 * Every field has three outcomes: structured (pattern recognised), text (kept as a string),
 * or absent. Nothing is dropped: unknown blocks go to `extra`, and the original HTML is kept in `raw`.
 *
 * Usage: node parse-powers.mjs [--in out/power.json] [--out out/parsed] [--ids power1,power2] [--print]
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/* -------------------------------------------- */
/*  Vocabulary                                  */
/* -------------------------------------------- */

const ABILITIES = { strength: "str", constitution: "con", dexterity: "dex", intelligence: "int", wisdom: "wis", charisma: "cha" };
const DEFENCES = { ac: "ac", fortitude: "fort", reflex: "ref", will: "wil" };
const DAMAGE_TYPES = ["acid", "cold", "fire", "force", "lightning", "necrotic", "poison", "psychic", "radiant", "thunder"];
const CONDITIONS = [
	"blinded", "dazed", "deafened", "dominated", "grabbed", "helpless", "immobilized", "marked", "petrified",
	"prone", "restrained", "slowed", "stunned", "unconscious", "weakened",
];
// Rules Compendium, "Conditions" (p. 229-232). "marked" and "grabbed" are combat effects, not conditions.
const BOOK_CONDITIONS = new Set(["blinded", "dazed", "deafened", "dominated", "helpless", "immobilized", "petrified", "prone", "restrained", "slowed", "stunned", "unconscious", "weakened"]);

/**
 * Conditional durations from the Rules Compendium (p. 226-228): save ends (alone, "both" or "all"),
 * until the start/end of someone's next turn, and until the end of the encounter.
 * Whose turn matters, so the owner is kept: the power's user ("source"), the affected creature ("target"), or someone else.
 */
function parseDuration(sentence) {
	let m;
	if ((m = sentence.match(/save ends(?:\s+(both|all))?/i))) return { type: "saveEnds", group: m[1]?.toLowerCase() ?? null };
	if ((m = sentence.match(/until the (start|end) of (.{1,30}?)(?:'s)? next turn/i))) {
		const who = m[2].toLowerCase().replace(/\s+/g, " ").replace(/^(?:\w+ )*?(?=your$|you$|its$|his or her$|their$)/, "");
		const owner = /^(?:your|you)$/.test(who) ? "source"
			: /^(?:the target|the secondary target|the primary target|its|his or her|their|that creature|the creature)$/.test(who) ? "target"
				: "other";
		return { type: m[1].toLowerCase() === "start" ? "startOfTurn" : "endOfTurn", owner, ...(owner === "other" ? { who } : {}) };
	}
	if (/until the end of the encounter/i.test(sentence)) return { type: "endOfEncounter" };
	return null;
}

const POWER_SOURCES =["Arcane", "Divine", "Martial", "Primal", "Psionic", "Shadow", "Elemental", "Ki"];

const ABIL_RE = Object.keys(ABILITIES).join("|");
const TYPE_RE = DAMAGE_TYPES.join("|");
const DEF_RE = "AC|Fortitude|Reflex|Will";

const ACTION_LABELS = {
	"standard action": "standard",
	"move action": "move",
	"minor action": "minor",
	"free action": "free",
	"no action": "none",
	"opportunity action": "opportunity",
	"immediate interrupt": "interrupt",
	"immediate reaction": "reaction",
};
const ACTION_HEAD_RE = /^(?:(?:Standard|Move|Minor|Free|No|Opportunity)\s+Action|Immediate\s+(?:Interrupt|Reaction))$/i;

/* -------------------------------------------- */
/*  Text helpers                                */
/* -------------------------------------------- */

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " ", ndash: "–", mdash: "—", rsquo: "’", lsquo: "‘" };

function decode(str) {
	return str.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => {
		if (e[0] === "#") {
			const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
			return Number.isFinite(code) ? String.fromCodePoint(code) : m;
		}
		return ENTITIES[e.toLowerCase()] ?? m;
	});
}

/** HTML fragment to plain text. Keeps line breaks, collapses other whitespace. */
export function txt(html) {
	return decode(html.replace(/<br\s*\/?>/gi, "\n").replace(/<\/?(?:p|div|li|ul)[^>]*>/gi, "\n").replace(/<[^>]+>/g, ""))
		.split("\n")
		.map(l => l.replace(/[ \t ]+/g, " ").trim())
		.filter(Boolean)
		.join("\n");
}

const num = s => (s === undefined || s === null || s === "" || Number.isNaN(Number(s))) ? null : Number(s);
const abbr = name => ABILITIES[name.toLowerCase()];
const def = name => DEFENCES[name.toLowerCase()];

/* -------------------------------------------- */
/*  Header: usage / keywords / action / range   */
/* -------------------------------------------- */

function parseUsage(raw) {
	const r = raw.toLowerCase();
	if (r.startsWith("at-will")) return "atwill";
	if (r.startsWith("encounter")) return "encounter";
	if (r.startsWith("daily")) return "daily";
	if (r.startsWith("recharge")) return "recharge";
	return null;
}

// Typos found in the source text. Applied only when parsing; the original text is kept in `raw` / `text`.
const TYPOS = [[/\bRelfex\b/g, "Reflex"], [/\bWIll\b/g, "Will"], [/\bweapoon\b/gi, "weapon"]];
const fixTypos = s => TYPOS.reduce((acc, [re, rep]) => acc.replace(re, rep), s);

export function parseRange(raw) {
	const original = raw.replace(/\s+/g, " ").trim();
	const fixed = fixTypos(original);
	const range = parseRangeText(fixed);
	if (range && fixed !== original) { range.raw = original; range.corrected = true; }
	return range;
}

function parseRangeText(raw) {
	const t = raw.replace(/\s+/g, " ").trim();
	if (!t) return null;
	let m;
	if ((m = t.match(/^Melee\s+reach\s+(\d+)/i))) return { type: "reach", size: num(m[1]), within: null, weaponType: null, raw: t };
	if ((m = t.match(/^Area\s+(\d+)\s+squares?\s+within\s+(\d+)/i))) return { type: "areaSquares", size: num(m[1]), within: num(m[2]), weaponType: null, raw: t };
	if (/^(?:area\s+)?special$/i.test(t)) return { type: "special", size: null, within: null, weaponType: null, raw: t };
	if ((m = t.match(/^(Melee|Ranged|Close\s+burst|Close\s+blast)\s+(spirit|beast)\s+(\d+)/i))) {
		return { ...parseRange(`${m[1]} ${m[3]}`), origin: m[2].toLowerCase(), raw: t };
	}
	if ((m = t.match(/^Aura\s+burst\s+(\d+)(?:\s+within\s+(\d+))?/i))) return { type: "aura", size: num(m[1]), within: num(m[2]), weaponType: null, raw: t };
	if (/^Melee$/i.test(t)) return { type: "melee", size: null, within: null, weaponType: null, raw: t };
	if (/^Ranged$/i.test(t)) return { type: "range", size: null, within: null, weaponType: null, raw: t };
	if (/^personal\b/i.test(t)) return { type: "personal", size: null, within: null, weaponType: null, raw: t };
	if ((m = t.match(/^(Close|Area)\s+(burst|blast|wall)\s+(\d+)(?:\s+within\s+(\d+|sight))?/i))) {
		const shape = m[2].toLowerCase();
		let type = null;
		if (m[1].toLowerCase() === "close") type = shape === "burst" ? "closeBurst" : shape === "blast" ? "closeBlast" : null;
		else type = shape === "burst" ? "rangeBurst" : null;
		return { type: type ?? `${m[1].toLowerCase()}${shape[0].toUpperCase()}${shape.slice(1)}`, size: num(m[3]), within: num(m[4]) ?? (m[4] ?? null), weaponType: null, raw: t };
	}
	if ((m = t.match(/^Melee or Ranged\s+(weapon|weaopn|\d+)/i))) {
		return { type: /^wea/i.test(m[1]) ? "weapon" : "range", size: num(m[1]), within: null, weaponType: "meleeRanged", raw: t };
	}
	if ((m = t.match(/^(Melee|Ranged)\s+(?:weapon|weaopn)/i))) return { type: "weapon", size: null, within: null, weaponType: m[1].toLowerCase(), raw: t };
	if (/^Melee\s+touch/i.test(t)) return { type: "touch", size: null, within: null, weaponType: null, raw: t };
	if ((m = t.match(/^Melee\s+(\d+)/i))) return { type: "melee", size: num(m[1]), within: null, weaponType: null, raw: t };
	if ((m = t.match(/^Ranged\s+(\d+)/i))) return { type: "range", size: num(m[1]), within: null, weaponType: null, raw: t };
	if (/^Ranged\s+sight/i.test(t)) return { type: "range", size: null, within: "sight", weaponType: null, raw: t };
	return { type: null, size: null, within: null, weaponType: null, raw: t, unrecognised: true };
}

/** @returns {{header: object, problems: string[]}} */
function parseHeader(html) {
	const problems = [];
	const lines = html.split(/<br\s*\/?>/i).map(l => l.trim()).filter(l => txt(l));
	const header = { usage: null, usageRaw: null, special: false, keywords: [], action: null, actionRaw: null, range: null };
	let usageLine = null;
	let actionLine = null;
	for (const line of lines) {
		const first = (line.match(/<b>([^<]*)<\/b>/i)?.[1] ?? "").trim();
		if (ACTION_HEAD_RE.test(first) || (actionLine === null && /^(Free|Minor|Standard|Move|Opportunity)$/i.test(first))) actionLine ??= line;
		else usageLine ??= line;
	}
	if (usageLine) {
		const bolds = [...usageLine.matchAll(/<b>([^<]*)<\/b>/gi)].map(m => decode(m[1]).trim());
		header.usageRaw = bolds[0] ?? null;
		header.usage = header.usageRaw ? parseUsage(header.usageRaw) : null;
		header.special = /\(special\)/i.test(header.usageRaw ?? "");
		// Some entries bold several keywords together ("Arcane, Weapon"): split them.
		header.keywords = bolds.slice(1).flatMap(k => k.split(",")).map(k => k.trim()).filter(Boolean);
		if (!header.usage) problems.push(`usage:${header.usageRaw}`);
	} else problems.push("usage:missing");
	if (actionLine) {
		const m = actionLine.match(/^\s*<b>([^<]*)<\/b>([\s\S]*)$/i);
		header.actionRaw = decode(m[1]).trim();
		header.action = ACTION_LABELS[header.actionRaw.toLowerCase()] ?? header.actionRaw.toLowerCase();
		const rangeText = txt(m[2]);
		if (rangeText) {
			header.range = parseRange(rangeText);
			if (header.range?.unrecognised) problems.push(`range:${rangeText}`);
		}
	} else problems.push("action:missing");
	// An entry can put the range ("Personal") where the keywords go and leave the range line out.
	if (!header.range && header.keywords.some(k => /^personal$/i.test(k))) {
		header.range = parseRange("Personal");
		header.keywords = header.keywords.filter(k => !/^personal$/i.test(k));
	}
	return { header, problems };
}

/* -------------------------------------------- */
/*  Attack / damage / effect analysis           */
/* -------------------------------------------- */

/**
 * "Highest ability modifier" is the largest of the six; "highest mental ability" only of Int, Wis and Cha;
 * "highest physical ability" only of Str, Dex and Con. The token names the set; the converter turns it into max(...).
 */
function highestToken(text) {
	const scope = text.match(/\b(mental|physical)\b/i)?.[1].toLowerCase();
	return scope ? `highest-${scope}` : "highest";
}

/** One attack side from its ability part ("Strength + 2", "Primary ability") and its defence part ("AC"). */
function attackSide(left, defText) {
	const abilities = [...left.matchAll(new RegExp(`\\b(${ABIL_RE})\\b`, "gi"))].map(m => abbr(m[1]));
	if (!abilities.length) {
		if (/\bprimary\b/i.test(left)) abilities.push("primary");
		else if (/\bhighest\b/i.test(left)) abilities.push(highestToken(left));
		else if (/\bchosen\b/i.test(left)) abilities.push("chosen");
		else if (/^level\b/i.test(left)) abilities.push("level");
	}
	const defences = [...defText.matchAll(new RegExp(`\\b(${DEF_RE})\\b`, "gi"))].map(m => def(m[1]));
	return abilities.length && defences.length ? { abilities, bonus: num(left.match(/\+\s*(\d+)/)?.[1]), defences } : null;
}

/**
 * Melee/ranged attack lines: "Strength vs. AC (melee) or Dexterity vs. AC (ranged)" and "Strength (melee) or Dexterity (ranged) vs. AC".
 * @returns {{melee: object, ranged: object, rest: string}|null}
 */
function parseAttackAlternatives(first) {
	const dRe = "(AC|Fortitude|Reflex|Will)";
	let m = first.match(new RegExp(`^(.*?)\\s+vs\\.?\\s+${dRe}\\s*\\(melee[^)]*\\)\\s+or\\s+(.*?)\\s+vs\\.?\\s+${dRe}\\s*\\(ranged[^)]*\\)(.*)$`, "i"));
	if (m) {
		const melee = attackSide(m[1], m[2]);
		const ranged = attackSide(m[3], m[4]);
		return melee && ranged ? { melee, ranged, rest: m[5] } : null;
	}
	m = first.match(new RegExp(`^(.*?)\\s*\\(melee\\)\\s+or\\s+(.*?)\\s*\\(ranged\\)\\s+vs\\.?\\s+${dRe}(.*)$`, "i"));
	if (m) {
		const melee = attackSide(m[1], m[3]);
		const ranged = attackSide(m[2], m[3]);
		return melee && ranged ? { melee, ranged, rest: m[4] } : null;
	}
	return null;
}

function parseAttack(text) {
	const firstRaw = text.split("\n")[0];
	const first = fixTypos(firstRaw);
	const alt = parseAttackAlternatives(first);
	if (alt) {
		return {
			...alt.melee,
			multipleDefences: false,
			alternatives: [{ when: "melee", ...alt.melee }, { when: "ranged", ...alt.ranged }],
			note: (alt.rest.replace(/^[\s,.]+/, "") + "\n" + text.split("\n").slice(1).join("\n")).trim() || null,
			corrected: first !== firstRaw,
			text, parsed: true,
		};
	}
	const vs = first.match(/^(.*?)\s+vs\.?\s+(.*)$/i);
	if (!vs) return { text, parsed: false };
	const left = vs[1];
	const abilities = [...left.matchAll(new RegExp(`\\b(${ABIL_RE})\\b`, "gi"))].map(m => abbr(m[1]));
	if (!abilities.length) {
		if (/\bprimary\b/i.test(left)) abilities.push("primary");
		else if (/\bhighest\b/i.test(left)) abilities.push(highestToken(left));
		else if (/\bchosen\b/i.test(left)) abilities.push("chosen");
		else if (/^level\b/i.test(left)) abilities.push("level");
		else if (/beast's attack bonus/i.test(left)) abilities.push("beast");
	}
	const bonus = num(left.match(/\+\s*(\d+)/)?.[1]);
	const defText = vs[2].split(/\.\s|\.$/)[0];
	const defences = [...defText.matchAll(new RegExp(`\\b(${DEF_RE})\\b`, "g"))].map(m => def(m[1]));
	if (!abilities.length || !defences.length) return { text, parsed: false };
	return {
		abilities, bonus, defences,
		multipleDefences: defences.length > 1,
		note: (vs[2].slice(defText.length).replace(/^\.\s*/, "") + text.split("\n").slice(1).join("\n")).trim() || null,
		corrected: first !== firstRaw,
		text, parsed: true,
	};
}

const TERM = `(?:\\d+d\\d+|\\d+\\[W\\]|\\d+|(?:your\\s+)?(?:(?:${ABIL_RE})(?:(?:\\s*,\\s*(?:or\\s+)?|\\s+or\\s+)(?:${ABIL_RE}))*|(?:(?:highest|chosen|primary)\\s+(?:(?:mental|physical)\\s+)?)?ability(?:\\s+score)?)\\s+modi\\w+)`;
const TYPES_PART = `(?:(?:${TYPE_RE})(?:\\s*,\\s*(?:and\\s+|or\\s+)?|\\s+(?:and|or)\\s+|\\s+))*`;
// After a "+", a bare ability name counts as a modifier too ("5[W] + Strength damage", "+ Strength, Dexterity, or Constitution damage").
const BARE_ABILITY = `(?:${ABIL_RE})(?:\\s*,\\s*(?:or\\s+)?(?:${ABIL_RE})|\\s+or\\s+(?:${ABIL_RE}))*`;
const DAMAGE_RE = new RegExp(`(?<![\\w\\[])(${TERM}(?:\\s*\\+\\s*(?:${TERM}|${BARE_ABILITY}))*)\\s+((?:(?:extra|additional)\\s+)?${TYPES_PART})damage`, "gi");
const ONGOING_RE = new RegExp(`ongoing\\s+(\\d+)\\s+((?:(?:${TYPE_RE})(?:\\s*,\\s*(?:and\\s+|or\\s+)?|\\s+(?:and|or)\\s+|\\s+))*)damage(?:\\s*\\(([^)]*)\\))?`, "gi");

// "resist 10 to all damage", "vulnerable 5 to all damage", "resistance to all damage equal to one-half your level + your Constitution modifier"
const RESIST_RE = new RegExp(`\\b(resist(?:ance)?|vulnerab(?:le|ility))\\s+(?:(\\d+)\\s+)?(?:to\\s+)?(all\\s+damage|(?:the\\s+chosen|that|each|every)\\s+damage\\s+types?|(?:(?:${TYPE_RE})(?:\\s*,\\s*(?:and\\s+|or\\s+)?|\\s+(?:and|or)\\s+|\\s+))+damage)(?:\\s+equal\\s+to\\s+((?:[^.;(\\n]|\\.\\d)+))?`, "gi");
// Melee/ranged choices: "2[W] + Str damage (melee) or 2[W] + Dex damage (ranged)", "3[W] + Str modifier (melee) or 3[W] + Dex modifier (ranged) damage",
// and the shorthand "3[W] + Strength (melee) or Dexterity (ranged) modifier damage". Each side becomes a damage entry tagged with `when`.
const EXPR = `${TERM}(?:\\s*\\+\\s*(?:${TERM}|${BARE_ABILITY}))*`;
const ALT_AFTER_RE = new RegExp(`(?<![\\w\\[])(${EXPR})\\s+(${TYPES_PART})damage\\s*\\(melee\\)\\s+or\\s+(${EXPR})\\s+(?:(${TYPES_PART})damage\\s*)?\\(ranged\\)`, "gi");
const ALT_BEFORE_RE = new RegExp(`(?<![\\w\\[])(${EXPR})\\s*\\(melee\\)\\s+or\\s+(${EXPR})\\s*\\(ranged\\)\\s+(${TYPES_PART})damage`, "gi");
const ALT_SHORT_RE = new RegExp(`(?<![\\w\\[])(\\d+\\[W\\]|\\d+d\\d+)\\s*\\+\\s*(${ABIL_RE})\\s*\\(melee\\)\\s+or\\s+(${ABIL_RE})\\s*\\(ranged\\)\\s+modifier\\s+(${TYPES_PART})damage`, "gi");

function altDamage(expr, when, types, base = null) {
	const e = expr.replace(/\s+/g, " ").trim();
	const d = { expr: e, ...parseDamageExpr(e), types, extra: false, when };
	// "… or Dexterity modifier damage (ranged)": the dice are implied by the first half.
	if (base && !d.dice.length && !d.weapon && !d.flat) { d.dice = base.dice; d.weapon = base.weapon; d.flat = base.flat; d.inferred = true; }
	return d;
}

const EQUAL_RE = new RegExp(`(${TYPES_PART})damage\\s+equal\\s+to\\s+(${TERM}(?:\\s*\\+\\s*${TERM})*)`, "gi");
const ONGOING_EQUAL_RE = new RegExp(`ongoing\\s+(${TYPES_PART})damage\\s+equal\\s+to\\s+(${TERM}(?:\\s*\\+\\s*${TERM})*)(?:\\s*\\(([^)]*)\\))?`, "gi");

function parseDamageExpr(expr) {
	const out = { dice: [], weapon: 0, flat: 0, mods: [] };
	for (const term of expr.split(/\s*\+\s*/)) {
		let m;
		if ((m = term.match(/^(\d+)d(\d+)$/i))) out.dice.push({ count: Number(m[1]), faces: Number(m[2]) });
		else if ((m = term.match(/^(\d+)\[W\]$/))) out.weapon += Number(m[1]);
		else if (/^\d+$/.test(term)) out.flat += Number(term);
		else if (/\bhighest\b/i.test(term)) out.mods.push(highestToken(term));
		else out.mods.push([...term.matchAll(new RegExp(`\\b(${ABIL_RE}|highest|chosen|primary)\\b`, "gi"))].map(x => abbr(x[1]) ?? x[1].toLowerCase()).join("|") || "ability");
	}
	return out;
}

const typesOf = s => [...s.matchAll(new RegExp(`\\b(${TYPE_RE})\\b`, "gi"))].map(m => m[1].toLowerCase());

function analyze(text) {
	const res = { damage: [], ongoing: [], conditions: [], movement: [], resistances: [] };
	if (!text) return res;
	const found = [];
	const consumed = [];
	const take = (m, melee, ranged) => { consumed.push([m.index, m.index + m[0].length]); found.push([m.index, melee], [m.index + 1, ranged]); };
	for (const m of text.matchAll(ALT_AFTER_RE)) {
		const melee = altDamage(m[1], "melee", typesOf(m[2]));
		take(m, melee, altDamage(m[3], "ranged", m[4] ? typesOf(m[4]) : melee.types, melee));
	}
	for (const m of text.matchAll(ALT_BEFORE_RE)) {
		const types = typesOf(m[3]);
		const melee = altDamage(m[1], "melee", types);
		take(m, melee, altDamage(m[2], "ranged", types, melee));
	}
	for (const m of text.matchAll(ALT_SHORT_RE)) {
		const types = typesOf(m[4]);
		take(m, altDamage(`${m[1]} + ${m[2]} modifier`, "melee", types), altDamage(`${m[1]} + ${m[3]} modifier`, "ranged", types));
	}
	for (const m of text.matchAll(DAMAGE_RE)) {
		const before = text.slice(Math.max(0, m.index - 10), m.index);
		if (/ongoing\s*$/i.test(before)) continue;
		if (consumed.some(([a, b]) => m.index < b && m.index + m[0].length > a)) continue;
		const expr = m[1].replace(/\s+/g, " ");
		// `self` marks damage the power's user takes ("You take 10 damage, and the target takes ..."), which is not the power's damage roll.
		const self = /\byou\s+(?:take|lose|suffer)s?\s*$/i.test(text.slice(Math.max(0, m.index - 20), m.index));
		found.push([m.index, { expr, ...parseDamageExpr(expr), types: typesOf(m[2]), extra: /\b(?:extra|additional)\s*$/i.test(before) || /^(?:extra|additional)\b/i.test(m[2]), ...(self ? { self: true } : {}) }]);
	}
	res.damage.push(...found.sort((a, b) => a[0] - b[0]).map(f => f[1]));
	for (const m of text.matchAll(RESIST_RE)) {
		const scope = /^all/i.test(m[3]) ? ["all"] : typesOf(m[3]);
		res.resistances.push({
			kind: /^resist/i.test(m[1]) ? "resist" : "vulnerable",
			amount: num(m[2]) ?? (m[4] ? m[4].replace(/\s+(?:until|for|and|against|while)\b.*$/i, "").trim() : null),
			types: scope.length ? scope : ["chosen"],
		});
	}
	for (const m of text.matchAll(ONGOING_EQUAL_RE)) {
		res.ongoing.push({ expr: m[2], ...parseDamageExpr(m[2]), types: typesOf(m[1]), saveEnds: /save ends/i.test(m[3] ?? "") });
	}
	for (const m of text.matchAll(EQUAL_RE)) {
		if (/ongoing\s*$/i.test(text.slice(Math.max(0, m.index - 10), m.index))) continue;
		res.damage.push({ expr: m[2], ...parseDamageExpr(m[2]), types: typesOf(m[1]), extra: false, equalTo: true });
	}
	for (const m of text.matchAll(ONGOING_RE)) {
		res.ongoing.push({ amount: Number(m[1]), types: typesOf(m[2]), saveEnds: /save ends/i.test(m[3] ?? "") });
	}
	for (const sentence of text.split(/(?<=[.;])\s+|\n/)) {
		if (/\b(?:if|while|whenever|unless|instead)\b/i.test(sentence)) continue;
		const duration = parseDuration(sentence);
		const inSentence = new Set();
		for (const c of sentence.matchAll(new RegExp(`\\b(${CONDITIONS.join("|")})\\b`, "gi"))) {
			const name = c[1].toLowerCase();
			if (inSentence.has(name)) continue;
			inSentence.add(name);
			res.conditions.push({ name, kind: BOOK_CONDITIONS.has(name) ? "condition" : "effect", duration });
		}
		// Verb forms: "you mark the target until...", "you grab the target" (the participle forms are matched above).
		for (const [name, verb] of [["marked", /\bmarks?\s+(?:the|each|one|all|any|that|it|them|him|her)\b/i], ["grabbed", /\bgrabs?\s+(?:the|each|one|all|any|that|it|them)\b/i]]) {
			if (verb.test(sentence) && !inSentence.has(name)) {
				inSentence.add(name);
				res.conditions.push({ name, kind: BOOK_CONDITIONS.has(name) ? "condition" : "effect", duration });
			}
		}
		if (/grants? combat advantage/i.test(sentence)) res.conditions.push({ name: "combatAdvantage", kind: "effect", duration });
	}
	for (const m of text.matchAll(/\b(push|pull|slide)(?:s|ed)?\s+(?:the\s+\w+\s+|it\s+|him\s+|her\s+|them\s+)?(?:up to\s+)?(\d+)\s+squares?/gi)) {
		res.movement.push({ type: m[1].toLowerCase(), squares: Number(m[2]) });
	}
	return res;
}

/* -------------------------------------------- */
/*  Section parsing                             */
/* -------------------------------------------- */

/** Pulls "Level N: ..." lines out of a text block. */
function extractScaling(text, field, scaling) {
	const keep = [];
	for (const line of text.split("\n")) {
		const m = line.match(/^Levels?\s+(\d+(?:\s*(?:,|and)\s*\d+)*)\s*:\s*(.*)$/i);
		if (m) scaling.push({ levels: m[1].split(/\s*(?:,|and)\s*/).map(Number), field, text: m[2] });
		else keep.push(line);
	}
	return keep.join("\n");
}

function blockOf(text) {
	return { text, ...analyze(text) };
}

function parseSection(contentHtml, isMain) {
	const problems = [];
	const power = {
		usage: null, usageRaw: null, special: false, keywords: [], action: null, actionRaw: null, range: null,
		flavor: null, target: null, attack: null, hit: null, miss: null, effect: null,
		trigger: null, requirement: null, prerequisite: null, special_text: null, sustain: null, aftereffect: null,
		secondary: null, hitVariants: [], scaling: [], extra: [],
	};
	const chunks = contentHtml.split(/<p class=\w+>/i);
	let headerDone = false;
	let phase = "primary";
	let ctx = null;

	const target = () => (phase === "secondary" ? (power.secondary ??= { target: null, attack: null, hit: null, miss: null, effect: null }) : power);

	chunks.forEach((raw, index) => {
		let chunk = raw;
		let nextCtx = null;
		const marker = chunk.match(/(?:<\/p>|<br\s*\/?>|\n)\s*<b>([^<:]+)<\/b>\s*(?:<br\s*\/?>\s*)*$/i);
		if (marker) { nextCtx = decode(marker[1]).trim(); chunk = chunk.slice(0, marker.index); }
		if (!txt(chunk)) { ctx = nextCtx ?? ctx; return; }

		if (/^\s*<i>/i.test(chunk)) { power.flavor = txt(chunk); ctx = nextCtx ?? ctx; return; }

		const lab = chunk.match(/^\s*<b>([^<]+)<\/b>\s*(:)?\s*([\s\S]*)$/i);
		if (!lab) {
			if (index > 0 || txt(chunk)) problems.push(`unlabelled:${txt(chunk).slice(0, 60)}`);
			ctx = nextCtx ?? ctx;
			return;
		}
		// Some blocks put the colon inside the bold tag (<b>Trigger:</b>).
		const hasColon = Boolean(lab[2]) || /:\s*$/.test(lab[1]);
		if (!hasColon && !headerDone) {
			const { header, problems: hp } = parseHeader(chunk);
			Object.assign(power, header);
			problems.push(...hp);
			headerDone = true;
			ctx = nextCtx ?? ctx;
			return;
		}
		if (!hasColon) { problems.push(`no-colon:${decode(lab[1]).trim()}`); ctx = nextCtx ?? ctx; return; }

		const label = decode(lab[1]).replace(/:\s*$/, "").trim();
		let body = txt(lab[3]);
		const key = label.toLowerCase();
		const scaled = (field) => extractScaling(body, field, power.scaling);

		if (ctx) {
			power.extra.push({ label: `${ctx}: ${label}`, text: body });
		} else if (key === "target" || key === "targets" || key === "primary target") {
			phase = "primary"; power.target = body;
		} else if (key === "secondary target") {
			phase = "secondary"; target().target = body;
		} else if (key === "attack" || key === "primary attack") {
			phase = "primary"; body = scaled("attack");
			// Some powers put prose under "Attack" with no roll ("vs." missing): keep it as text instead of an attack line.
			if (/\bvs\.?\s/i.test(body)) power.attack = parseAttack(body);
			else power.extra.push({ label: "Attack", text: body });
		} else if (key === "secondary attack") {
			phase = "secondary"; body = scaled("secondary.attack"); target().attack = parseAttack(body);
		} else if (key === "hit" || key === "secondary hit") {
			body = scaled(phase === "secondary" ? "secondary.hit" : "hit");
			(key.startsWith("secondary") ? (phase = "secondary", target()) : target()).hit = blockOf(body);
		} else if (/^hit\s*\(.+\)$/.test(key)) {
			power.hitVariants.push({ label: label.replace(/^hit\s*\(|\)$/gi, ""), ...blockOf(body) });
		} else if (key === "miss" || key === "secondary miss") {
			const blk = blockOf(body);
			blk.half = /^half damage\b/i.test(body);
			(key.startsWith("secondary") ? (phase = "secondary", target()) : target()).miss = blk;
		} else if (key === "effect" || key === "secondary effect") {
			body = scaled(phase === "secondary" ? "secondary.effect" : "effect");
			(key.startsWith("secondary") ? (phase = "secondary", target()) : target()).effect = blockOf(body);
		} else if (key === "prerequisite") { power.prerequisite = body;
		} else if (key === "trigger") { power.trigger = body; phase = "primary"; }
		else if (key === "requirement") { power.requirement = body; phase = "primary"; }
		else if (key === "special") { power.special_text = body; phase = "primary"; }
		else if (key.startsWith("sustain")) {
			phase = "primary";
			power.sustain = { action: key.replace(/^sustain\s*/, "") || null, text: body };
		} else if (key === "aftereffect") { power.aftereffect = blockOf(body); phase = "primary"; }
		else {
			power.extra.push({ label, text: body });
		}
		ctx = nextCtx ?? ctx;
	});

	if (!headerDone) problems.push("header:missing");
	return { power, problems };
}

/* -------------------------------------------- */
/*  Entry parsing                               */
/* -------------------------------------------- */

function parsePublished(raw) {
	const text = raw.replace(/^Published in\s*/i, "");
	const m = text.match(/^(.*?)(?:,\s*page\(s\)\s*([\d\-–]+))?(?:,\s*(.+?))?\.?$/);
	return { raw: text, book: m?.[1]?.trim() || null, pages: m?.[2] ?? null, reprints: m?.[3] ?? null };
}

/**
 * Rules Compendium, "damage type" (glossary) and "Extra Damage" (p. 223): a damage-type keyword on the power
 * means the power deals that type when the text only says "damage"; extra damage takes the type of the damage it adds to.
 * The explicit `types` are never overwritten; the inference goes in `typesFromKeywords` / `typesFromBase`.
 * Poison is flagged because its keyword may refer to a non-damaging effect instead of damage.
 */
function inferDamageTypes(power) {
	for (const section of [power, ...power.children]) {
		const own = section.keywords?.length ? section.keywords : power.keywords;
		const kw = own.map(k => k.toLowerCase()).filter(k => DAMAGE_TYPES.includes(k));
		const blocks = [section.hit, section.miss, section.aftereffect, section.effect, section.secondary?.hit, section.secondary?.effect, ...section.hitVariants];
		const entries = blocks.filter(Boolean).flatMap(b => [...(b.damage ?? []), ...(b.ongoing ?? [])]);
		const base = entries.find(e => e.types.length && !e.extra);
		for (const e of entries) {
			if (e.types.length) continue;
			if (e.extra && base) e.typesFromBase = base.types;
			else if (kw.length) { e.typesFromKeywords = kw; if (kw.includes("poison")) e.typesAmbiguous = true; }
		}
	}
}

export function parsePower(entry) {
	const html = entry.html;
	const problems = [];
	const listing = entry.listing;

	const pubIdx = html.search(/<p class=publishedIn>/i);
	const published = pubIdx >= 0 ? parsePublished(txt(html.slice(pubIdx))) : null;
	let body = pubIdx >= 0 ? html.slice(0, pubIdx) : html;

	const notes = [];
	body = body.replace(/Update \((\d{1,2}\/\d{1,2}\/\d{4})\)(?:\s*<br\s*\/?>)*\s*([^<]*)/g, (m, date, note) => { notes.push({ date, text: txt(note) }); return ""; });

	const headings = [...body.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/gi)];
	if (!headings.length) {
		return { id: entry.id, name: listing?.Name ?? entry.id, quality: "text", unparsed: ["no-h1"], raw: html };
	}
	const sections = headings.map((h, i) => {
		const start = h.index + h[0].length;
		const end = i + 1 < headings.length ? headings[i + 1].index : body.length;
		return { h1: h[1], content: body.slice(start, end) };
	});

	const [main, ...rest] = sections;
	const nameMatch = main.h1.match(/^([\s\S]*?)(?:<span class=level>([\s\S]*?)<\/span>)?$/i);
	const name = txt(nameMatch[1]);
	const levelText = txt(nameMatch[2] ?? "");
	const kindMatch = levelText.match(/(Racial\s+)?(Attack|Utility|Feature)\s*(\d+)?\s*$/i);
	const level = num(listing?.Level) ?? num(kindMatch?.[3]);
	const parsed = parseSection(main.content, true);
	problems.push(...parsed.problems);

	const power = {
		id: entry.id,
		name,
		class: listing?.ClassName ?? (kindMatch ? levelText.slice(0, kindMatch.index).trim() : null),
		level,
		tier: level === null ? null : level <= 10 ? "heroic" : level <= 20 ? "paragon" : "epic",
		kind: kindMatch ? kindMatch[2].toLowerCase() : null,
		racial: Boolean(kindMatch?.[1]),
		listingType: listing?.Type ?? null,
		sourceCode: listing?.SourceBook ?? null,
		published,
		...parsed.power,
		notes,
		children: [],
	};
	power.kind ??= listing?.Type?.match(/(Attack|Utility|Feature)$/i)?.[1].toLowerCase() ?? null;
	if (!power.kind) problems.push(`kind:${levelText}`);

	for (const sec of rest) {
		const child = parseSection(sec.content, false);
		child.power.name = txt(sec.h1.replace(/<span[\s\S]*$/i, ""));
		problems.push(...child.problems.map(p => `child(${child.power.name}):${p}`));
		power.children.push(child.power);
	}

	// Listing cross-checks (the HTML is the source of truth)
	if (listing) {
		const listed = new Set(listing.Keywords.split(",").map(s => s.trim().toLowerCase()).filter(Boolean));
		const parsedKw = new Set(power.keywords.map(s => s.toLowerCase()));
		power.keywordsListing = listing.Keywords.split(",").map(s => s.trim()).filter(Boolean);
		power.keywordsDiffer = listed.size !== parsedKw.size || [...listed].some(k => !parsedKw.has(k));
	}

	// Heuristics: text mentions damage/attack but we found nothing structured
	// Hit/miss blocks are where attack damage lives, so they get the strict check ("modifier" counts as a signal).
	// Effect blocks mostly mention damage without dealing it (rerolls, resistances, "whenever the target takes damage"),
	// so they only count when they hold dice, [W] or "N damage".
	const allBlocks = [power.hit, power.miss, power.aftereffect, power.secondary?.hit, power.effect, power.secondary?.effect].filter(Boolean);
	for (const blk of allBlocks) {
		const strict = blk === power.hit || blk === power.miss || blk === power.aftereffect || blk === power.secondary?.hit;
		const probe = blk.text
			.replace(RESIST_RE, "")
			.replace(/\bhalf damage\b/gi, "")
			.replace(/\bdamage\s+(?:rolls?|types?|bonus(?:es)?|dice)\b/gi, "")
			.replace(/\b(?:extra|additional)\s+damage\b/gi, "");
		const signal = strict ? /(?:\d+d\d+|\[W\]|\bmodifier\b|\b\d+\s+(?:[a-z]+\s+)*damage\b)/i : /(?:\d+d\d+|\[W\]|\b\d+\s+(?:[a-z]+\s+)*damage\b)/i;
		if (signal.test(probe) && /\bdamage\b/i.test(probe) && !blk.damage.length && !blk.ongoing.length) {
			problems.push("damage:unparsed");
			break;
		}
	}
	if (power.attack && !power.attack.parsed) problems.push(`attack:${power.attack.text.slice(0, 60)}`);
	power.hasAttackRoll = Boolean(power.attack);
	inferDamageTypes(power);

	const hard = problems.filter(p => /^(usage|action|header|range|kind|attack:)/.test(p));
	power.unparsed = problems;
	power.quality = !power.usage || !power.action ? "text" : problems.length === 0 ? "full" : "partial";
	power.raw = html;
	return power;
}

/* -------------------------------------------- */
/*  Report + CLI                                */
/* -------------------------------------------- */

function buildReport(parsed) {
	const quality = {};
	const reasons = new Map();
	const add = (key, id) => {
		const r = reasons.get(key) ?? { count: 0, examples: [] };
		r.count++;
		if (r.examples.length < 3) r.examples.push(id);
		reasons.set(key, r);
	};
	let withDamageWord = 0;
	let withDamageParsed = 0;
	let withAttack = 0;
	let attackParsed = 0;
	for (const p of parsed) {
		quality[p.quality] = (quality[p.quality] ?? 0) + 1;
		for (const reason of p.unparsed ?? []) add(reason.replace(/^child\([^)]*\):/, "child:").slice(0, 90), p.id);
		for (const x of p.extra ?? []) add(`extra-label:${x.label.replace(/^.*?: /, "")}`, p.id);
		const blocks = [p.hit, p.miss, p.effect, p.secondary?.hit].filter(Boolean);
		if (blocks.some(b => /\bdamage\b/i.test(b.text) && !/^half damage/i.test(b.text))) {
			withDamageWord++;
			if (blocks.some(b => b.damage?.length || b.ongoing?.length)) withDamageParsed++;
		}
		if (p.attack) { withAttack++; if (p.attack.parsed) attackParsed++; }
	}
	const top = [...reasons.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, 80).map(([reason, v]) => ({ reason, ...v }));
	return {
		total: parsed.length,
		quality,
		attack: { withAttack, attackParsed },
		damage: { withDamageWord, withDamageParsed },
		topUnparsed: top,
	};
}

async function main() {
	const argv = process.argv.slice(2);
	const get = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
	const root = path.dirname(fileURLToPath(import.meta.url));
	const inFile = path.resolve(get("in", path.join(root, "out", "power.json")));
	const outDir = path.resolve(get("out", path.join(root, "out", "parsed")));
	const ids = get("ids") ? new Set(get("ids").split(",")) : null;

	const entries = JSON.parse(await readFile(inFile, "utf8")).filter(e => e.html && (!ids || ids.has(e.id)));
	const parsed = entries.map(e => {
		try { return parsePower(e); } catch (err) { return { id: e.id, name: e.listing?.Name ?? e.id, quality: "text", unparsed: [`exception:${err.message}`], raw: e.html }; }
	});

	if (argv.includes("--print")) {
		for (const p of parsed) { const { raw, ...rest } = p; console.log(JSON.stringify(rest, null, 1)); }
		return;
	}
	await mkdir(outDir, { recursive: true });
	await writeFile(path.join(outDir, "power.json"), JSON.stringify(parsed));
	const report = buildReport(parsed);
	await writeFile(path.join(outDir, "power-report.json"), JSON.stringify(report, null, 1));

	console.log(`Parsed ${report.total} powers -> ${outDir}`);
	console.log("Quality:", report.quality);
	console.log(`Attack lines parsed: ${report.attack.attackParsed}/${report.attack.withAttack}`);
	console.log(`Damage text parsed:  ${report.damage.withDamageParsed}/${report.damage.withDamageWord}`);
	console.log("Top unparsed reasons:");
	for (const r of report.topUnparsed.slice(0, 25)) console.log(`  ${String(r.count).padStart(5)}  ${r.reason}  (${r.examples.join(", ")})`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
	main().catch(err => { console.error(err); process.exit(1); });
}
