/**
 * Parses the raw monster HTML (out/monster.json) into a clean intermediate schema (out/parsed/monster.json).
 *
 * Two page layouts exist in the compendium: a table of stats under a heading per action type (Monster Manual 3 and later), and
 * a stats paragraph followed by compact power lines (the older books). Both give the same facts: level, role, size and type,
 * XP, hit points, initiative, defences, speed, resistances, saves, action points, ability scores, skills, languages, and a
 * list of traits and powers. Every trait and power keeps its text; what the parser can read (range, attack bonus and defence,
 * damage) is added next to it, and what it cannot read stays in the text.
 *
 * Usage: node parse-monsters.mjs [--in out/monster.json] [--out out/parsed]
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { txt } from "./parse-powers.mjs";

const ABILITIES = ["str", "dex", "wis", "con", "int", "cha"];
const SIZES = { tiny: "tiny", small: "sm", medium: "med", large: "lg", huge: "huge", gargantuan: "grg" };
const ORIGINS = ["aberrant", "elemental", "fey", "immortal", "natural", "shadow"];
const TYPES = { animate: "animate", beast: "beast", humanoid: "humanoid", "magical beast": "magical" };
const SKILLS = {
	acrobatics: "acr", arcana: "arc", athletics: "ath", bluff: "blu", diplomacy: "dip", dungeoneering: "dun", endurance: "end", heal: "hea",
	history: "his", insight: "ins", intimidate: "itm", nature: "nat", perception: "prc", religion: "rel", stealth: "stl", streetwise: "stw", thievery: "thi",
};
const ACTION_OF = text => {
	const t = String(text ?? "").toLowerCase().replace(/\s+action$/, "").trim();
	return ACTIONS[t] ?? ACTIONS[String(text ?? "").toLowerCase().trim()] ?? null;
};
const ACTIONS = { standard: "standard", move: "move", minor: "minor", free: "free", "immediate reaction": "reaction", "immediate interrupt": "interrupt", reaction: "reaction", interrupt: "interrupt", opportunity: "opportunity", "opportunity action": "opportunity", "no action": "none" };
const SECTION_ACTION = { "standard actions": "standard", "move actions": "move", "minor actions": "minor", "free actions": "free", "triggered actions": "triggered" };
const num = s => (s === undefined || s === null || s === "" ? null : Number(String(s).replace(/[^\d.-]/g, "")));

/** Plain text with the line breaks the table cells and rows stand for. */
const plain = html => txt(String(html).replace(/<\/?(?:td|tr|table)[^>]*>/gi, "\n"));

/* -------------------------------------------- */
/*  The stat block                              */
/* -------------------------------------------- */

function parseHeader(html, listing) {
	const type = txt(html.match(/<span class=type>([\s\S]*?)<\/span>/i)?.[1] ?? "");
	const levelText = txt(html.match(/<span class=level>([\s\S]*?)<span class=xp>/i)?.[1] ?? "");
	const xp = num(html.match(/<span class=xp>\s*XP\s*([\d,]+)/i)?.[1]?.replace(/,/g, ""));
	const words = type.toLowerCase().replace(/\([^)]*\)/g, " ").split(/\s+/).filter(Boolean);
	const sizeWords = words.filter(w => SIZES[w]);
	const origin = words.find(w => ORIGINS.includes(w)) ?? null;
	const kind = Object.keys(TYPES).find(k => type.toLowerCase().replace(/\([^)]*\)/g, " ").includes(k)) ?? null;
	const extra = txt(type.match(/\(([^)]*)\)/)?.[1] ?? "");
	return {
		typeLine: type, size: SIZES[sizeWords[0]] ?? SIZES[String(listing.Size ?? "").split(/,|\s+or\s+/i)[0].trim().toLowerCase()] ?? null,
		sizes: sizeWords.map(w => SIZES[w]), origin, creatureType: kind ? TYPES[kind] : null, extraKeywords: extra ? extra.split(/\s*,\s*/) : [],
		levelText, xp,
	};
}

/** The region that holds the numbers: the table, or the first paragraph that starts with Initiative. */
function statRegion(html) {
	return html.match(/<table class=bodytable[\s\S]*?<\/table>/i)?.[0] ?? html.match(/<p class=flavor><b>Initiative[\s\S]*?<\/p>/i)?.[0] ?? "";
}

function parseSpeed(text) {
	const m = text.match(/Speed\s*([^\n]*)/i);
	if (!m) return null;
	const modes = {};
	for (const [, mode, n] of m[1].matchAll(/\b(fly|climb|swim|burrow|teleport)\s*(\d+)/gi)) modes[mode.toLowerCase()] = Number(n);
	const walk = m[1].match(/^\s*(\d+)/)?.[1];
	if (walk === undefined && !Object.keys(modes).length) return null;
	// "fly 6 (hover)" alone: the creature does not walk
	return { walk: walk === undefined ? 0 : Number(walk), modes, text: m[1].trim() };
}

/** "Resist 5 cold, 10 fire" -> [{amount: 5, types: ["cold"]}, ...]; "Immune disease, poison" -> ["disease", "poison"]. */
function parseResistList(label, text) {
	// Several lists can share a line ("Immune disease, poison; Resist 10 fire; Vulnerable 5 radiant"): each stops at the next label.
	const m = text.match(new RegExp(`\\b${label}\\s+([^\\n]+?)(?=\\s*;\\s*(?:Resist|Vulnerable|Immune)\\b|\\n|$)`, "i"));
	return m ? m[1].trim().replace(/[;,]$/, "") : null;
}

export function parseStats(region) {
	const text = plain(region);
	const grab = re => text.match(re)?.[1];
	const stats = {
		initiative: num(grab(/Initiative\s*([+-]?\s*\d+)/i)),
		perception: num(grab(/Perception\s*([+-]?\s*\d+)/i)),
		hp: num(grab(/\bHP\s*(\d+)/i)),
		bloodied: num(grab(/Bloodied\s*(\d+)/i)),
		defences: { ac: num(grab(/\bAC\s*(\d+)/i)), fort: num(grab(/Fortitude\s*(\d+)/i)), ref: num(grab(/Reflex\s*(\d+)/i)), wil: num(grab(/\bWill\s*(\d+)/i)) },
		saves: num(grab(/Saving Throws?\s*\+?\s*(\d+)/i)),
		actionPoints: num(grab(/Action Points?\s*(\d+)/i)),
		speed: parseSpeed(text),
		resist: parseResistList("Resist", text),
		vulnerable: parseResistList("Vulnerable", text),
		immune: parseResistList("Immune", text),
		minionNote: /missed attack never damages a minion/i.test(text),
	};
	// Senses: "Senses Perception +0; Darkvision" (old layout) or the cell after Speed (table layout).
	const senses = text.match(/Senses\s+[^;\n]*?(?:;\s*([^\n]+))?(?:\n|$)/i)?.[1]
		?? text.match(/Speed[^\n]*\n([^\n]*(?:vision|sense|blindsight|tremorsense|truesight)[^\n]*)/i)?.[1] ?? null;
	stats.senses = senses ? senses.trim() : null;
	return stats;
}

const STAT_LABELS = new Set(["initiative", "senses", "hp", "bloodied", "ac", "fortitude", "reflex", "will", "saving throws", "saving throw", "speed", "action points", "action point", "resist", "vulnerable", "immune", "perception"]);

/** Traits written as lines of the stat paragraph itself ("Fiery Breach aura 1; each enemy..."). */
export function inlineTraits(region) {
	if (/<table/i.test(region)) return [];
	const traits = [];
	for (const line of region.replace(/^<p[^>]*>|<\/p>$/gi, "").split(/<br\s*\/?>/i)) {
		const m = line.match(/^\s*<b>([^<]+)<\/b>\s*([\s\S]*)$/i);
		if (!m || STAT_LABELS.has(txt(m[1]).toLowerCase())) continue;
		const text = txt(m[2]);
		// Another label of the same line ("Initiative +4  Senses ...") is part of the stats, not a trait.
		if (text) traits.push({ name: txt(m[1]), keywords: [], aura: /\baura\b/i.test(text.slice(0, 20)), usage: null, text });
	}
	return traits;
}

/** The ability scores, skills, languages, alignment and equipment at the foot of the stat block. */
export function parseFooter(html) {
	const abilities = {};
	for (const m of html.matchAll(/<b>(Str|Dex|Wis|Con|Int|Cha)<\/b>\s*(\d+)\s*\(([+-]?\d+)\)/g)) abilities[m[1].toLowerCase()] = { score: Number(m[2]), mod: Number(m[3]) };
	const skills = {};
	const skillText = txt(html.match(/<b>Skills<\/b>\s*([^<]*)/i)?.[1] ?? "");
	for (const m of skillText.matchAll(/([A-Za-z]+)\s*([+-]\d+)/g)) if (SKILLS[m[1].toLowerCase()]) skills[SKILLS[m[1].toLowerCase()]] = Number(m[2]);
	return {
		abilities, skills,
		alignment: txt(html.match(/<b>Alignment<\/b>\s*([^<]*)/i)?.[1] ?? "") || null,
		languages: txt(html.match(/<b>\s*Languages<\/b>\s*([^<]*)/i)?.[1] ?? "") || null,
		equipment: txt(html.match(/<b>Equipment<\/b>:?\s*([^<]*)/i)?.[1] ?? "").replace(/\s+,/g, ",").replace(/\s+\.$/, ".") || null,
	};
}

/* -------------------------------------------- */
/*  Traits and powers                           */
/* -------------------------------------------- */

const ICON_RANGE = { "⚔": "melee", "➶": "ranged", "ᗕ": "close", "✺": "area", "ᘖ": "close" };
const FOOTER_LABEL = /<b>\s*(?:Str|Skills|Alignment|Equipment|Languages)\b/i;

/** "(standard, at-will)", "(minor; at-will, 1/round)", "(free; at-will)", "(move; encounter)", "(weapon)", "(cold)". */
function parseParens(groups) {
	const out = { keywords: [], action: null, usage: null, limit: null };
	for (const g of groups) {
		const parts = g.split(/[;,]\s*/).map(s => s.trim().toLowerCase()).filter(Boolean);
		const isUsage = parts.some(p => /^(?:at-?will|encounter|daily|recharge)\b/.test(p) || ACTION_OF(p));
		if (!isUsage) { out.keywords.push(...g.split(/\s*,\s*/).map(s => s.trim()).filter(Boolean)); continue; }
		for (const p of parts) {
			if (ACTION_OF(p)) out.action = ACTION_OF(p);
			else if (/^at-?will$/.test(p)) out.usage = "atwill";
			else if (p === "encounter") out.usage = "encounter";
			else if (p === "daily") out.usage = "daily";
			else if (/^recharge/.test(p)) out.usage = "recharge";
			else out.limit = p;
		}
	}
	return out;
}

/** The dice a recharge shows: "Recharge ⚄ ⚅" -> [5, 6]; "Recharge if..." -> null. */
const DIE = { "⚀": 1, "⚁": 2, "⚂": 3, "⚃": 4, "⚄": 5, "⚅": 6 };

function parseHeading(headingHtml) {
	const text = txt(headingHtml);
	const icon = Object.keys(ICON_RANGE).find(k => text.includes(k)) ?? null;
	const name = txt(headingHtml.match(/<b>([\s\S]*?)<\/b>/i)?.[1] ?? "");
	const beforeStar = headingHtml.split("✦")[0];
	const afterStar = headingHtml.includes("✦") ? headingHtml.split("✦").slice(1).join("✦") : "";
	const afterName = beforeStar.replace(/^[\s\S]*?<\/b>/i, "");
	const parens = [...txt(afterName).matchAll(/\(([^)]*)\)/g)].map(m => m[1]);
	const info = parseParens(parens);
	const usageBold = txt(afterStar.match(/<b>(At-Will|Encounter|Daily)<\/b>/i)?.[1] ?? "").toLowerCase();
	if (usageBold) info.usage = usageBold.replace("-", "");
	if (/Recharge/i.test(afterStar)) info.usage = "recharge";
	const recharge = [...afterStar.matchAll(/[⚀-⚅]/g)].map(m => DIE[m[0]]).filter(Boolean);
	// Keywords after the star: the bold words other than the usage
	const bold = [...afterStar.matchAll(/<b>([^<]+)<\/b>/gi)].map(m => txt(m[1])).filter(w => !/^(?:At-Will|Encounter|Daily)$/i.test(w));
	info.keywords.push(...bold.flatMap(w => w.split(/\s*,\s*/)));
	return { name, icon, ...info, ...(recharge.length ? { recharge } : {}), headingText: text };
}

function parseLines(html) {
	const lines = [];
	for (const m of html.matchAll(/<p class=flavorIndent>([\s\S]*?)<\/p>/gi)) {
		const raw = m[1];
		const label = raw.match(/^\s*<i>\s*([^<]*?)\s*(?:\(([^)]*)\))?\s*:?\s*<\/i>\s*:?\s*([\s\S]*)$/i);
		if (label) lines.push({ label: label[1].replace(/:$/, "").trim(), ...(label[2] ? { action: ACTION_OF(label[2]) } : {}), text: txt(label[3]) });
		else lines.push({ label: "", text: txt(raw) });
	}
	return lines;
}

const DAMAGE_TYPES = "acid|cold|fire|force|lightning|necrotic|poison|psychic|radiant|thunder|physical|untyped";
const DAMAGE_RE = new RegExp(String.raw`(?:^|[\s;,])(\d+d\d+(?:\s*[+-]\s*\d+)?|\d+)\s+(?:(?:${DAMAGE_TYPES})(?:\s*,\s*(?:and\s+|or\s+)?|\s+(?:and|or)\s+|\s+))*damage\b`, "i");

/** The range, the attack bonus and defence, and the damage a power line says, when it says them plainly. */
export function readAttack(lines) {
	const text = lines.map(l => `${l.label ? `${l.label}: ` : ""}${l.text}`).join("\n");
	const attack = text.match(/(?:^|[\n;:]\s*)((?:Melee|Ranged|Close|Area|Personal|Touch|Reach)[^;\n(]*?)(?:\s*\(([^)]*)\))?\s*(?:;|\n|$)/i);
	const bonus = text.match(/([+-]\d+)\s+vs\.?\s+(AC|Fortitude|Reflex|Will)\b/i);
	const hit = lines.find(l => /^hit$/i.test(l.label))?.text ?? (bonus ? text.split(/vs\.?\s+(?:AC|Fortitude|Reflex|Will)\s*;?/i)[1] : "") ?? "";
	// Notes in parentheses ("(+21 while bloodied)", "(crit 2d12+22)", "(the triggering enemy)") are not the damage.
	const damage = String(hit).replace(/\([^)]*\)/g, " ").match(DAMAGE_RE);
	return {
		range: attack?.[1]?.trim() ?? null,
		target: attack?.[2] ?? null,
		bonus: bonus ? Number(bonus[1]) : null,
		defence: bonus ? ({ ac: "ac", fortitude: "fort", reflex: "ref", will: "wil" })[bonus[2].toLowerCase()] : null,
		damage: damage?.[1]?.replace(/\s+/g, "").replace(/^[+-]?(?=\d)/, "") || null,
	};
}

function sectionsOf(html) {
	const body = html.replace(/^[\s\S]*?<\/h1>/i, "");
	const out = [];
	// Table layout: the h2 headings mark the section; old layout: none (the action is in the heading's parentheses).
	let section = null;
	const tokens = body.split(/(<h2>[\s\S]*?<\/h2>|<p class='flavor alt'>[\s\S]*?<\/p>)/i);
	for (let i = 0; i < tokens.length; i++) {
		const t = tokens[i];
		const h2 = t.match(/^<h2>([\s\S]*?)<\/h2>$/i);
		if (h2) { section = txt(h2[1]).toLowerCase(); continue; }
		const head = t.match(/^<p class='flavor alt'>([\s\S]*?)<\/p>$/i);
		if (!head || FOOTER_LABEL.test(head[1])) continue;
		// The lines that follow belong to this heading: everything up to the next heading, h2 or paragraph of another kind.
		let following = "";
		for (let j = i + 1; j < tokens.length && !/^<h2>|^<p class='flavor alt'>/.test(tokens[j]); j++) following += tokens[j];
		out.push({ section, headingHtml: head[1], linesHtml: following });
	}
	return out;
}

/* -------------------------------------------- */
/*  Monster                                     */
/* -------------------------------------------- */

export function parseMonster(entry) {
	const listing = entry.listing ?? {};
	const html = entry.html ?? "";
	const sources = String(listing.SourceBook ?? "").split(",").map(s => s.trim()).filter(Boolean);
	const header = parseHeader(html, listing);
	const stats = parseStats(statRegion(html));
	const footer = parseFooter(html);
	const description = txt(html.match(/<b>Description<\/b>\s*:?\s*([^<]*)/i)?.[1] ?? "") || null;

	const roleParts = String(listing.CombatRole ?? "").split(/\s*,\s*/).map(s => s.trim().toLowerCase()).filter(Boolean);
	const primary = roleParts.find(r => !["leader", "no role"].includes(r)) ?? null;
	const monster = {
		id: entry.id, name: listing.Name ?? "", sources, sourceCode: sources[0] ?? null,
		level: num(listing.Level), group: String(listing.GroupRole ?? "").toLowerCase() || null, role: primary, leader: roleParts.includes("leader"),
		...header, stats, ...footer, listingKeywords: String(listing.CreatureType ?? "").split(/\s*,\s*/).filter(Boolean),
		description, traits: inlineTraits(statRegion(html)), powers: [], notes: [], quality: "complete",
	};

	for (const s of sectionsOf(html)) {
		const heading = parseHeading(s.headingHtml);
		const lines = parseLines(s.linesHtml);
		// A heading with no name and nothing under it is a glitch of the source ("(standard; encounter)" alone).
		if (!heading.name && !lines.length) { monster.notes.push("empty-power"); continue; }
		const isTrait = s.section === "traits" || (!heading.usage && !heading.action && !heading.icon);
		const item = { ...heading, section: s.section, lines, text: lines.map(l => `${l.label ? `${l.label}: ` : ""}${l.text}`).join("\n") };
		if (isTrait) monster.traits.push({ name: heading.name, keywords: heading.keywords, aura: /\baura\b/i.test(heading.headingText) || /\baura\b/i.test(item.text.slice(0, 40)), usage: heading.usage, text: item.text });
		else {
			if (!item.action) item.action = SECTION_ACTION[s.section] && SECTION_ACTION[s.section] !== "triggered" ? SECTION_ACTION[s.section] : (lines.find(l => l.action)?.action ?? null);
			monster.powers.push({ ...item, attack: readAttack(lines) });
		}
	}

	for (const [field, value] of [["level", monster.level], ["hp", stats.hp], ["initiative", stats.initiative], ["ac", stats.defences.ac], ["fort", stats.defences.fort], ["ref", stats.defences.ref], ["will", stats.defences.wil], ["speed", stats.speed?.walk], ["size", monster.size]]) {
		if (value === null || value === undefined) { monster.quality = "partial"; monster.notes.push(`missing-${field}`); }
	}
	if (Object.keys(monster.abilities).length < 6) { monster.quality = "partial"; monster.notes.push("missing-abilities"); }
	return monster;
}

async function main() {
	const argv = process.argv.slice(2);
	const flag = (name, fallback) => (argv.includes(`--${name}`) ? argv[argv.indexOf(`--${name}`) + 1] : fallback);
	const here = path.dirname(fileURLToPath(import.meta.url));
	const input = path.resolve(here, flag("in", "out/monster.json"));
	const outDir = path.resolve(here, flag("out", "out/parsed"));
	const monsters = JSON.parse(await readFile(input, "utf8")).map(parseMonster);
	await mkdir(outDir, { recursive: true });
	await writeFile(path.join(outDir, "monster.json"), JSON.stringify(monsters));
	const q = {}, n = {};
	for (const m of monsters) { q[m.quality] = (q[m.quality] ?? 0) + 1; for (const note of m.notes) n[note] = (n[note] ?? 0) + 1; }
	console.log(`Parsed ${monsters.length} monsters:`, q, n);
	console.log(`powers ${monsters.reduce((s, m) => s + m.powers.length, 0)}, traits ${monsters.reduce((s, m) => s + m.traits.length, 0)}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
