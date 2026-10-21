/**
 * Parses the raw race HTML (out/race.json) into a clean intermediate schema (out/parsed/race.json).
 *
 * What it recognises (the "racial traits" block): average height and weight, ability scores (fixed + choice), size, speed,
 * vision, languages, skill bonuses, and every other named trait. Unconditional defence bonuses ("+1 racial bonus to Will")
 * are pulled out of the traits because the sheet has a slot for them. Racial powers are NOT parsed here: they are
 * already in the power database, and the race only names them.
 *
 * A few entries (sub-races such as "Wood Elf") have no traits block, only prose: they are kept as `description-only`.
 *
 * Usage: node parse-races.mjs [--in out/race.json] [--out out/parsed]
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { txt } from "./parse-powers.mjs";

const ABILITIES = { strength: "str", constitution: "con", dexterity: "dex", intelligence: "int", wisdom: "wis", charisma: "cha" };
const SKILLS = {
	acrobatics: "acr", arcana: "arc", athletics: "ath", bluff: "blu", diplomacy: "dip", dungeoneering: "dun", endurance: "end", heal: "hea",
	history: "his", insight: "ins", intimidate: "itm", nature: "nat", perception: "prc", religion: "rel", stealth: "stl", streetwise: "stw", thievery: "thi",
};
const DEFENCES = { ac: "ac", fortitude: "fort", reflex: "ref", will: "wil" };
const SIZES = { tiny: "tiny", small: "sm", medium: "med", large: "lg", huge: "huge", gargantuan: "grg" };
const VISION = { normal: "nv", "low-light": "lv", "low-light vision": "lv", darkvision: "dv" };
/** Languages the system has a checkbox for (spoken). Anything else goes to the free-text field. */
const SPOKEN = { common: "Common", abyssal: "Abyssal", "deep speech": "DeepSpeech", draconic: "Draconic", dwarven: "Dwarven", elven: "Elven", giant: "Giant", goblin: "Goblin", primordial: "Primordial", supernal: "Supernal" };

const FIXED_LABELS = new Set(["average height", "average weight", "ability scores", "size", "speed", "vision", "languages", "skill bonuses"]);
const words = n => ({ one: 1, two: 2, three: 3, four: 4, five: 5 }[String(n).toLowerCase()] ?? Number(n));

/** The `<b>Label</b>: text` lines of the traits block. */
function traitLines(block) {
	const lines = [];
	for (const part of block.split(/<br\s*\/?>/i)) {
		const m = part.match(/^\s*<b>\s*([^<]*?)\s*:?\s*<\/b>\s*:?\s*([\s\S]*)$/i);
		if (!m || !m[1]) continue;
		lines.push({ label: m[1].trim(), text: txt(m[2]) });
	}
	return lines;
}

function parseAbilityScores(text) {
	const bonuses = [...text.matchAll(/\+(\d)\s+(?:to\s+)?(Strength|Constitution|Dexterity|Intelligence|Wisdom|Charisma)/gi)].map(m => ({ ability: ABILITIES[m[2].toLowerCase()], bonus: Number(m[1]) }));
	if (/one ability score of your choice/i.test(text)) return { text, fixed: [], choose: [], any: true };
	// "+2 Wisdom, +2 Dexterity or +2 Strength": the first is always given, the last two are alternatives for the second +2
	const orMatch = text.match(/,\s*(\+\d\s+\w+)\s+or\s+(\+\d\s+\w+)\s*$/i);
	if (!orMatch || bonuses.length < 3) return { text, fixed: bonuses, choose: [], any: false };
	return { text, fixed: bonuses.slice(0, bonuses.length - 2), choose: bonuses.slice(-2), any: false };
}

function parseSpeed(text) {
	const m = text.match(/(\d+)\s+squares?/i);
	const extra = text.replace(/^\s*\d+\s+squares?\.?\s*/i, "").trim();
	return { squares: m ? Number(m[1]) : null, extra };
}

function parseLanguages(text) {
	const spoken = [], custom = [], choices = [];
	for (let part of text.split(/,\s*|\s+and\s+/i)) {
		part = part.trim().replace(/\.$/, "");
		if (!part) continue;
		const known = SPOKEN[part.toLowerCase()];
		const choice = part.match(/^(?:choice of|either)\s+(.*)$/i);
		if (known) spoken.push(known);
		else if (choice) choices.push(part);
		else custom.push(part);
	}
	return { text, spoken, custom, choices };
}

function parseSkillBonuses(text) {
	const bonuses = {};
	for (const m of text.matchAll(/\+(\d+)\s+([A-Za-z]+)/g)) {
		const key = SKILLS[m[2].toLowerCase()];
		if (key) bonuses[key] = Number(m[1]);
	}
	return bonuses;
}

/**
 * Unconditional defence bonuses: a sentence that is only "You gain a +N racial bonus to Fortitude, Reflex, and Will."
 * Sentences with a condition ("against", "while", "when", "if") are not taken; they stay in the trait text only.
 * @returns {object} defence key -> bonus
 */
function defenceBonusesOf(text) {
	const bonuses = {};
	for (const sentence of text.split(/(?<=\.)\s+/)) {
		const m = sentence.match(/^You (?:gain|have) a \+(\d+) (?:racial )?bonus to (AC|Fortitude|Reflex|Will)((?:,? (?:and )?(?:AC|Fortitude|Reflex|Will))*)\.$/i);
		if (!m) continue;
		for (const name of [m[2], ...m[3].match(/AC|Fortitude|Reflex|Will/gi) ?? []]) bonuses[DEFENCES[name.toLowerCase()]] = Number(m[1]);
	}
	return bonuses;
}

/** "You have the elven accuracy power." -> "elven accuracy" */
const powerReference = text => (text.match(/^You have the (.+?) power\.?$/i) ?? text.match(/^You can use (.+?) as an? (?:at-will|encounter|daily) power\.?$/i))?.[1] ?? null;

export function parseRace(entry) {
	const listing = entry.listing ?? {};
	const html = entry.html ?? "";
	const name = listing.Name ?? txt(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? "");
	const sources = String(listing.SourceBook ?? "").split(",").map(s => s.trim()).filter(Boolean);
	const race = {
		id: entry.id, name, sources, sourceCode: sources[0] ?? null,
		origin: listing.Origin ?? null,
		tagline: txt(html.match(/<\/h1>\s*<i>([\s\S]*?)<\/i>/i)?.[1] ?? ""),
		size: null, speed: null, vision: null, languages: null, skillBonuses: {}, defenceBonuses: {}, abilityScores: null,
		height: null, weight: null, traits: [], powerNames: [], description: [], quality: "complete", notes: [],
	};

	const block = html.match(/<blockquote>([\s\S]*?)<\/blockquote>/i)?.[1];
	if (!block) {
		race.quality = "description-only";
		race.size = SIZES[String(listing.Size ?? "").toLowerCase()] ?? null;
		race.description = prose(html);
		race.notes.push("no-traits-block");
		return race;
	}

	for (const { label, text } of traitLines(block)) {
		const key = label.toLowerCase();
		if (key === "average height") race.height = text;
		else if (key === "average weight") race.weight = text;
		else if (key === "ability scores") race.abilityScores = parseAbilityScores(text);
		else if (key === "size") race.size = SIZES[text.toLowerCase()] ?? null;
		else if (key === "speed") race.speed = parseSpeed(text);
		else if (key === "vision") race.vision = VISION[text.toLowerCase().replace(/\.$/, "")] ?? null;
		else if (key === "languages") race.languages = parseLanguages(text);
		else if (key === "skill bonuses") { race.skillBonuses = parseSkillBonuses(text); race.skillBonusesText = text.replace(/\.$/, ""); }
		else if (!FIXED_LABELS.has(key)) {
			const power = powerReference(text);
			if (power) { race.powerNames.push(power); continue; }
			const bonuses = defenceBonusesOf(text);
			Object.assign(race.defenceBonuses, bonuses);
			// The text stays whole: the sheet slot only holds the number, the sentence may carry conditions
			race.traits.push({ name: label, text, appliesDefences: Object.keys(bonuses) });
		}
	}
	race.description = prose(html);
	for (const [field, value] of [["size", race.size], ["speed", race.speed?.squares], ["vision", race.vision]]) {
		if (value === null || value === undefined) { race.quality = "partial"; race.notes.push(`missing-${field}`); }
	}
	return race;
}

/** The flavour text after the traits and powers: headed paragraphs ("Physical qualities", "Playing a ..."). */
function prose(html) {
	const start = html.search(/<\/span>\s*(?=<h3>)|<h3>/i);
	// Without headed sections the text is whatever is left once the title, tagline and traits block (already parsed) are removed.
	const body = start >= 0 ? html.slice(start) : html
		.replace(/<blockquote>[\s\S]*?<\/blockquote>/i, "")
		.replace(/<span class=power>[\s\S]*?<br><\/span>/gi, "") // the racial powers are in the power database
		.replace(/<p class=flavor><b>RACIAL TRAITS<\/b><\/p>/i, "")
		.replace(/^[\s\S]*?<\/h1>/i, "")
		.replace(/^\s*<i>[\s\S]*?<\/i>/i, "");
	const out = [];
	for (const section of body.split(/<h3>/i)) {
		const m = section.match(/^([\s\S]*?)<\/h3>([\s\S]*)$/i);
		const heading = m ? txt(m[1]) : "";
		const text = txt(m ? m[2] : section.replace(/^\s*<\/span>/i, ""));
		if (text) out.push({ heading, text });
	}
	return out;
}

async function main() {
	const argv = process.argv.slice(2);
	const flag = (name, fallback) => (argv.includes(`--${name}`) ? argv[argv.indexOf(`--${name}`) + 1] : fallback);
	const here = path.dirname(fileURLToPath(import.meta.url));
	const input = path.resolve(here, flag("in", "out/race.json"));
	const outDir = path.resolve(here, flag("out", "out/parsed"));
	const entries = JSON.parse(await readFile(input, "utf8"));
	const races = entries.map(parseRace);
	await mkdir(outDir, { recursive: true });
	await writeFile(path.join(outDir, "race.json"), JSON.stringify(races, null, 1));
	const q = {};
	for (const r of races) q[r.quality] = (q[r.quality] ?? 0) + 1;
	console.log(`Parsed ${races.length} races:`, q);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
