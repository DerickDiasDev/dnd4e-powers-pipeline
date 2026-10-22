/**
 * Parses the companions that are creatures (animal, fey beast and elemental companions, summoned creatures and mounts) out of the
 * extras (out/parsed/extras.json) into a structured stat block (out/parsed/companion.json). Familiars and the old beast
 * companions are benefits and formulas, not stat blocks: they stay features (parse-extras.mjs / build-extras.mjs).
 *
 * The numbers of these creatures are their master's: "HP your bloodied value", "Defenses your defenses + 2", "your level + 5 vs.
 * AC", "1d12 + your Wisdom modifier damage", "Initiative equal to yours". The block says how each number is made (`hp.mode`,
 * `defences.mode`...) and the importer fills it in from the master's level, or from the master's sheet.
 *
 * Usage: node parse-companions.mjs [--in out/parsed/extras.json] [--out out/parsed]
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseHeading, parseLines } from "./item-powers.mjs";
import { readAttack } from "./parse-monsters.mjs";

export const CREATURE_CATEGORIES = ["Animal Companion", "Fey Beast Companion", "Elemental Companion", "Summoned Creature", "Mount"];

const SIZES = { tiny: "tiny", small: "sm", medium: "med", large: "lg", huge: "huge", gargantuan: "grg" };
const ORIGINS = ["aberrant", "elemental", "fey", "immortal", "natural", "shadow"];
const TYPES = { animate: "animate", beast: "beast", humanoid: "humanoid", magical: "magical" };
const ABILITY_KEYS = { str: "str", dex: "dex", con: "con", int: "int", wis: "wis", cha: "cha" };
const ABILITY_WORDS = { strength: "str", dexterity: "dex", constitution: "con", intelligence: "int", wisdom: "wis", charisma: "cha" };
const MODES = ["fly", "swim", "burrow", "climb"];
const ACTION_WORDS = { standard: "standard", minor: "minor", move: "move", free: "free", opportunity: "opportunity", "immediate reaction": "reaction", "immediate interrupt": "interrupt", no: "none" };
const ICONS = "⚔➶ᗕ✺ᘖ☼";

/** "Beast, Natural" -> { origin: "natural", type: "beast", other: [] }; what is neither goes in `other`. */
export function parseCreatureType(text) {
	const words = String(text ?? "").split(/\s*,\s*/).map(w => w.trim()).filter(Boolean);
	const origin = words.find(w => ORIGINS.includes(w.toLowerCase()))?.toLowerCase() ?? null;
	const type = words.map(w => TYPES[w.toLowerCase()]).find(Boolean) ?? null;
	const other = words.filter(w => !ORIGINS.includes(w.toLowerCase()) && !TYPES[w.toLowerCase()]);
	return { origin, type, other };
}

/** How the creature's hit points are made: "your bloodied value", "your healing surge value", or a number. */
export function parseHp(text) {
	const t = String(text ?? "");
	if (/bloodied value/i.test(t)) return { mode: "bloodied" };
	if (/healing surge value/i.test(t)) return { mode: "surge" };
	const n = t.match(/^(\d+)/);
	return n ? { mode: "fixed", value: Number(n[1]) } : null;
}

const signed = s => (s ? Number(String(s).replace(/\s+/g, "")) : 0);

/** "your defenses + 2, not including..." -> { mode: "master", bonus: 2 }; "AC 13, Fortitude 15, Reflex 11, Will 15 (add your level to each defense)" -> levelPlus. */
export function parseDefences(line) {
	const master = line.match(/^Defenses\s+your defenses\s*([+-]\s*\d+)?/i);
	if (master) return { mode: "master", bonus: signed(master[1]) };
	const fixed = line.match(/^AC\s+(\d+),\s*Fortitude\s+(\d+),\s*Reflex\s+(\d+),\s*Will\s+(\d+)(.*)$/i);
	if (fixed) return { mode: /add your level/i.test(fixed[5]) ? "levelPlus" : "fixed", ac: Number(fixed[1]), fort: Number(fixed[2]), ref: Number(fixed[3]), wil: Number(fixed[4]) };
	return null;
}

/** "land 6 , fly 6 (hover; altitude limit 2)" / "6" -> { walk: 6, modes: { fly: 6 }, notes: ["hover; altitude limit 2"] }. */
export function parseSpeed(text) {
	const out = { walk: 0, modes: {}, notes: [] };
	for (const part of String(text ?? "").split(/\s*[,;]\s*(?![^(]*\))/).map(s => s.trim()).filter(Boolean)) {
		const m = part.match(/^(?:(land|walk|fly|swim|burrow|climb)\s+)?(\d+)\s*(?:\(([^)]*)\))?$/i);
		if (!m) { out.notes.push(part); continue; }
		const mode = (m[1] ?? "land").toLowerCase();
		if (MODES.includes(mode)) out.modes[mode] = Number(m[2]);
		else out.walk = Number(m[2]);
		if (m[3]) out.notes.push(m[3]);
	}
	return out;
}

/** What the damage of a hit line is made of: dice, a flat number, ability modifiers of the master and half of the master's level. */
export function parseDamage(text) {
	const head = String(text ?? "").match(/^(\d+d\d+|\d+)((?:\s*\+\s*(?:\d+|one-half your level|your (?:Strength|Constitution|Dexterity|Intelligence|Wisdom|Charisma) modifier))*)(?=[^.;]{0,60}\bdamage\b)/i);
	if (!head) return null;
	const out = { dice: /d/.test(head[1]) ? head[1] : null, flat: /d/.test(head[1]) ? 0 : Number(head[1]), mods: [], half: false };
	for (const term of head[2].split("+").map(s => s.trim()).filter(Boolean)) {
		if (/^\d+$/.test(term)) out.flat += Number(term);
		else if (/one-half/i.test(term)) out.half = true;
		else out.mods.push(ABILITY_WORDS[term.match(/your (\w+) modifier/i)[1].toLowerCase()]);
	}
	return out;
}

const iconOf = text => [...ICONS].find(i => text.includes(i)) ?? null;
const actionIn = text => {
	const m = String(text).match(/\b(?:(Standard|Minor|Move|Free|Opportunity|No)\s+Actions?|(Immediate Reaction|Immediate Interrupt))\b/i);
	return m ? ACTION_WORDS[(m[1] ?? m[2]).toLowerCase()] ?? null : null;
};

/** A block's heading: its name (when it has one), keywords, icon, usage, action and the limit ("1/round"). */
export function parseBlockHeading(line) {
	const icon = iconOf(line);
	const cleaned = line.replace(new RegExp(`\\(\\s*[${ICONS}\\s]+\\)`, "g"), " ");
	const head = parseHeading(cleaned);
	const [before, ...rest] = cleaned.split("✦");
	const after = rest.join("✦").trim();
	const aura = after.match(/^Aura\s*(\d+)/i);
	const phrase = before.replace(new RegExp(`[${ICONS}]`, "g"), "").replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
	const generic = /^(?:(?:Standard|Minor|Move|Free|Opportunity|No) Action|Immediate Reaction|Immediate Interrupt)$/i.test(phrase);
	return {
		icon, aura: aura ? Number(aura[1]) : null, name: generic ? null : phrase, phrase,
		keywords: head.keywords.filter(k => !actionIn(k) && !new RegExp(`^[${ICONS}\\s]*$`).test(k)),
		usage: head.usage, action: head.action ?? actionIn(before), limit: after.match(/\b(\d+\/(?:round|encounter|day|turn))\b/i)?.[1] ?? null,
	};
}

/** The paragraphs of a block: "Attack (Immediate Reaction): ..." keeps the action apart; a "Level N:" inside a line is a line of its own. */
function blockParagraphs(lines) {
	const out = [];
	let action = null;
	for (const raw of lines) {
		let text = raw;
		const a = text.match(/^Attack\s*\(([^)]*)\):\s*(.*)$/i);
		if (a) { action = actionIn(a[1]) ?? action; text = `Attack: ${a[2]}`; }
		const inline = text.match(/^(.*?[.;])\s+(Levels? \d+(?:\s*(?:,|or|and)\s*\d+)*:.*)$/i);
		if (inline) { out.push({ text: inline[1] }, { text: inline[2] }); } else out.push({ text });
	}
	return { paragraphs: out, action };
}

const HEADER = /^(?:HP|Initiative|Defenses|AC|Speed)\b/;
const ABILITY_LINE = /^(?:Str|Dex|Con|Int|Wis|Cha)\s+\d+/;

/** @param {object} e a parsed companion of the extras (kind "companion") */
export function parseCreature(e) {
	const lines = [...e.body];
	const out = {
		id: e.id, name: e.name, category: e.category, size: SIZES[String(e.size).split(/,|\s+or\s+/i)[0].trim().toLowerCase()] ?? "med",
		...parseCreatureType(e.creatureType), hp: null, defences: null, initiative: { mode: "master" }, perception: null, speed: { walk: 0, modes: {}, notes: [] },
		senses: "", abilities: {}, description: [], powers: [], traits: [],
		sources: e.sources, sourceCode: e.sourceCode, published: e.published, notes: [],
	};
	const rest = [];
	for (const line of lines) {
		if (ABILITY_LINE.test(line)) {
			for (const m of line.matchAll(/\b(Str|Dex|Con|Int|Wis|Cha)\s+(\d+)/g)) out.abilities[ABILITY_KEYS[m[1].toLowerCase()]] = Number(m[2]);
		} else rest.push(line);
	}
	let i = 0;
	for (; i < rest.length && !rest[i].includes("✦"); i++) {
		const line = rest[i];
		if (/^HP\b/.test(line)) out.hp = parseHp(line.replace(/^HP\s+/, ""));
		else if (/^Initiative\b/.test(line)) out.initiative = /equal to yours/i.test(line) ? { mode: "master" } : { mode: "fixed", value: Number(line.match(/([+-]?\d+)/)?.[1] ?? 0) };
		else if (/^(?:Defenses|AC)\b/.test(line)) {
			out.defences = parseDefences(line);
			const prc = line.match(/Perception equal to yours\s*([+-]\s*\d+)?/i);
			if (prc) out.perception = { mode: "master", bonus: signed(prc[1]) };
		} else if (/^Speed\b/.test(line)) {
			const [speed, ...senses] = line.replace(/^Speed\s+/, "").split("|");
			out.speed = parseSpeed(speed);
			out.senses = senses.map(s => s.trim()).filter(Boolean).join("; ");
		} else out.description.push(line);
	}
	// "HP 1; a missed attack never damages the companionDefenses your defenses...": two lines the page ran together.
	if (!out.defences) {
		const run = rest.slice(0, i).find(l => /Defenses your defenses/i.test(l));
		if (run) out.defences = parseDefences(run.slice(run.search(/Defenses your defenses/i)));
	}

	let current = null;
	const blocks = [];
	for (; i < rest.length; i++) {
		if (rest[i].includes("✦")) { current = { heading: rest[i], lines: [] }; blocks.push(current); } else current?.lines.push(rest[i]);
	}
	blocks.forEach(block => {
		const head = parseBlockHeading(block.heading);
		const { paragraphs, action } = blockParagraphs(block.lines);
		if (head.aura !== null || (!head.usage && !head.action)) {
			out.traits.push({ name: head.name ?? head.phrase, keywords: head.keywords, text: block.lines.join("\n"), aura: head.aura });
			return;
		}
		const { lines: plain, scaling } = parseLines(paragraphs);
		const attack = readAttack(plain);
		const text = plain.map(l => l.text).join(" ");
		const level = text.match(/your level\s*\+\s*(\d+)\s+vs\.?\s+(AC|Fortitude|Reflex|Will)\b/i);
		const hit = plain.find(l => /^hit$/i.test(l.label))?.text ?? "";
		const damage = [];
		const base = parseDamage(hit);
		if (base) damage.push({ from: 1, ...base });
		for (const s of scaling.filter(x => x.line === "hit")) {
			const d = parseDamage(s.text);
			if (d) damage.push({ from: Math.min(...s.levels), ...d });
		}
		const effects = plain.find(l => /^effect$/i.test(l.label))?.text ?? "";
		const name = head.name ?? (/walks, shifts|crawls/i.test(effects) ? "Move" : level || attack.bonus !== null ? "Attack" : head.phrase);
		out.powers.push({
			name, keywords: head.keywords, usage: head.usage ?? "atwill", action: action ?? head.action ?? (level || attack.bonus !== null ? "standard" : "none"), icon: head.icon, limit: head.limit, recharge: null,
			lines: plain, text: plain.map(l => `${l.label ? `${l.label}: ` : ""}${l.text}`).join("\n"), attack,
			...(level ? { levelAttack: { offset: Number(level[1]), def: { ac: "ac", fortitude: "fort", reflex: "ref", will: "wil" }[level[2].toLowerCase()] } } : {}),
			...(damage.length ? { damage } : {}),
			...(scaling.length ? { scaling } : {}),
		});
	});
	if (!out.hp) out.notes.push("hp-unparsed");
	if (!out.defences) out.notes.push("defences-unparsed");
	return out;
}

async function main() {
	const argv = process.argv.slice(2);
	const flag = (name, fallback) => (argv.includes(`--${name}`) ? argv[argv.indexOf(`--${name}`) + 1] : fallback);
	const here = path.dirname(fileURLToPath(import.meta.url));
	const input = path.resolve(here, flag("in", "out/parsed/extras.json"));
	const outDir = path.resolve(here, flag("out", "out/parsed"));
	const parsed = JSON.parse(await readFile(input, "utf8")).filter(e => e.kind === "companion" && CREATURE_CATEGORIES.includes(e.category)).map(parseCreature);
	await mkdir(outDir, { recursive: true });
	await writeFile(path.join(outDir, "companion.json"), JSON.stringify(parsed));
	const notes = {};
	for (const p of parsed) for (const n of p.notes) notes[n] = (notes[n] ?? 0) + 1;
	console.log(`Companions (creatures): ${parsed.length}, powers ${parsed.reduce((n, p) => n + p.powers.length, 0)}, traits ${parsed.reduce((n, p) => n + p.traits.length, 0)}`, notes);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
