/**
 * Parses the raw class HTML (out/class.json) into a clean intermediate schema (out/parsed/class.json).
 *
 * Recognised: the "class traits" block (role, power source, key abilities, proficiencies, defence bonuses, hit points,
 * healing surges, trained and class skills, implements), the prose, and the class features by level. A class feature
 * is a name, the level it comes at and its text; powers printed inside it are NOT parsed here (they are in the power
 * database), only named, so the importer can offer them.
 *
 * Hybrid classes are kept like the others but flagged: their hit points and surges are halves, meant to be combined with
 * another class, so the importer does not write them to a sheet.
 *
 * Usage: node parse-classes.mjs [--in out/class.json] [--out out/parsed]
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { txt } from "./parse-powers.mjs";

const ABILITIES = { strength: "str", constitution: "con", dexterity: "dex", intelligence: "int", wisdom: "wis", charisma: "cha" };
const DEFENCES = { ac: "ac", fortitude: "fort", reflex: "ref", will: "wil" };
const SKILLS = {
	acrobatics: "acr", arcana: "arc", athletics: "ath", bluff: "blu", diplomacy: "dip", dungeoneering: "dun", endurance: "end", heal: "hea",
	history: "his", insight: "ins", intimidate: "itm", nature: "nat", perception: "prc", religion: "rel", stealth: "stl", streetwise: "stw", thievery: "thi",
};
const ARMOUR = { cloth: "cloth", leather: "leather", hide: "hide", chainmail: "chain", chain: "chain", scale: "scale", plate: "plate", "light shields": "light", "heavy shields": "heavy", "light shield": "light", "heavy shield": "heavy" };
const WEAPON_CATEGORIES = {
	"simple melee": "simpleM", "simple ranged": "simpleR", "military melee": "militaryM", "military ranged": "militaryR",
	"superior melee": "superiorM", "superior ranged": "superiorR", "improvised melee": "improvisedM", "improvised ranged": "improvisedR",
};

const abilityList = text => [...text.matchAll(/Strength|Constitution|Dexterity|Intelligence|Wisdom|Charisma/gi)].map(m => ABILITIES[m[0].toLowerCase()]);
const numberOf = s => { const n = Number(String(s).replace(/[^0-9.]/g, "")); return Number.isFinite(n) && s !== "" ? n : null; };

/** The `<b>Label</b>: text` lines of the traits block. */
function traitLines(block) {
	const lines = new Map();
	for (const part of block.split(/<br\s*\/?>/i)) {
		const m = part.match(/^\s*<b>\s*([^<]*?)\s*:?\s*<\/b>\s*:?\s*([\s\S]*)$/i);
		if (m && m[1]) lines.set(m[1].trim().toLowerCase(), txt(m[2]));
	}
	return lines;
}

function parseArmour(text) {
	const keys = [], other = [];
	for (const part of text.replace(/\.$/, "").split(/[,;]\s*|\s+and\s+/i)) {
		const word = part.trim().toLowerCase().replace(/\s+armou?r$/, "");
		if (!word) continue;
		if (ARMOUR[word]) keys.push(ARMOUR[word]);
		else other.push(part.trim());
	}
	return { keys: [...new Set(keys)], other };
}

function parseWeapons(text) {
	const keys = [], other = [];
	for (const part of text.replace(/\.$/, "").split(/[,;]\s*|\s+and\s+/i)) {
		const word = part.trim().toLowerCase();
		if (!word) continue;
		if (WEAPON_CATEGORIES[word]) keys.push(WEAPON_CATEGORIES[word]);
		else other.push(part.trim());
	}
	return { keys: [...new Set(keys)], other };
}

function parseDefences(text) {
	const out = {};
	for (const m of text.matchAll(/\+(\d+)\s+(AC|Fortitude|Reflex|Will)/gi)) out[DEFENCES[m[2].toLowerCase()]] = Number(m[1]);
	return out;
}

/** "Stealth, Thievery. From the class skills list below, choose 3 trained skills at 1st level." */
function parseTrainedSkills(text) {
	const fixedText = text.split(/\bFrom the class skills? list/i)[0];
	const fixed = [...fixedText.matchAll(/[A-Za-z]+/g)].map(m => SKILLS[m[0].toLowerCase()]).filter(Boolean);
	const choose = text.match(/choose (\w+)(?: additional)? trained skills?/i)?.[1];
	const words = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };
	return { text, fixed: [...new Set(fixed)], choose: choose ? (words[choose.toLowerCase()] ?? numberOf(choose)) : 0 };
}

const parseClassSkills = text => [...new Set([...text.matchAll(/([A-Za-z]+)\s*\((?:Str|Con|Dex|Int|Wis|Cha)\)/g)].map(m => SKILLS[m[1].toLowerCase()]).filter(Boolean))];
const nameList = text => text.replace(/\.$/, "").split(/,\s*(?:or\s+)?|\s+or\s+/i).map(s => s.trim()).filter(Boolean);

/* -------------------------------------------- */
/*  Class features                              */
/* -------------------------------------------- */

const POWER_CARD = /<h1 class=\w*power>([^<]*)(?:<span class=level>|<\/h1>)/gi;

/**
 * The features section: `<h3>Level N:</h3>` blocks, each with `<b>NAME</b><br>text` features. Everything from a power card
 * (`<h1 class=...power>`) up to the next feature name is the power's own card: the card names the power, the text is dropped.
 * @returns {{name: string, level: number|null, text: string, powers: string[], powerChoice: boolean}[]}
 */
export function parseFeatures(html) {
	const start = html.search(/<h3>[^<]*CLASS FEATURES[^<]*<\/h3>/i);
	if (start < 0) return [];
	const body = html.slice(start).replace(/^<h3>[^<]*<\/h3>/i, "").replace(/<p class=publishedIn>[\s\S]*$/i, "");
	const features = [];
	let level = null;
	for (const chunk of body.split(/(<h3>[\s\S]*?<\/h3>)/i)) {
		const heading = chunk.match(/^<h3>([\s\S]*?)<\/h3>$/i);
		if (heading) {
			const m = txt(heading[1]).match(/^Level\s+(\d+)/i);
			level = m ? Number(m[1]) : level;
			continue;
		}
		// A feature starts at a bold ALL-CAPS name; the bold words inside power cards (At-Will, Martial, ...) are not.
		const parts = chunk.split(/<b>([^<a-z]*[A-Z][^<a-z]*)<\/b><br>/);
		// parts: [before, name1, text1, name2, text2, ...]
		for (let i = 1; i < parts.length; i += 2) {
			const raw = parts[i + 1] ?? "";
			// "X Secondary Power" cards are parts of the power X, which the power database holds as one bundle
			const cards = [...raw.matchAll(POWER_CARD)].map(m => txt(m[1])).filter(n => n && !/ Secondary Power$/i.test(n));
			const cut = raw.search(/<h1 class=\w*power>/i);
			const text = txt(cut >= 0 ? raw.slice(0, cut) : raw);
			features.push({ name: txt(parts[i]), level, text, powers: cards, powerChoice: cards.length > 1 });
		}
	}
	return features;
}

/* -------------------------------------------- */
/*  Class                                       */
/* -------------------------------------------- */

export function parseClass(entry) {
	const listing = entry.listing ?? {};
	const html = entry.html ?? "";
	const name = listing.Name ?? "";
	const base = name.replace(/\s*\(.*\)\s*$/, "").replace(/^Hybrid\s+/i, "");
	const sources = String(listing.SourceBook ?? "").split(",").map(s => s.trim()).filter(Boolean);
	const cls = {
		id: entry.id, name, baseName: base, build: name.match(/\(([^)]*)\)\s*$/)?.[1] ?? null, hybrid: /^Hybrid\s/i.test(name),
		sources, sourceCode: sources[0] ?? null,
		role: null, powerSource: null, keyAbilities: [], keyAbilitiesText: null,
		armour: { keys: [], other: [], text: "" }, weapons: { keys: [], other: [], text: "" }, defenceBonuses: {},
		hpStart: null, hpPerLevel: null, surges: null,
		trainedSkills: { text: "", fixed: [], choose: 0 }, classSkills: [], implements: [],
		buildOptions: [], hybridTalentOptions: [], featureNames: [], notes: [], description: [], features: [], quality: "complete",
	};

	const block = html.match(/<blockquote>([\s\S]*?)<\/blockquote>/i)?.[1];
	if (!block) { cls.quality = "description-only"; cls.notes.push("no-traits-block"); cls.description = prose(html); return cls; }
	const lines = traitLines(block);
	const get = key => lines.get(key) ?? null;

	// The role and power source lines go on with a sentence of flavour: "Leader. You fill your allies with..."
	const firstSentence = text => text?.split(/\.(?:\s|$)/)[0].trim() || null;
	cls.role = listing.RoleName ?? firstSentence(get("role"));
	cls.powerSource = listing.PowerSourceText ?? firstSentence(get("power source"));
	if (get("key abilities")) { cls.keyAbilitiesText = get("key abilities"); cls.keyAbilities = abilityList(get("key abilities")); }
	if (get("armor proficiencies")) cls.armour = { ...parseArmour(get("armor proficiencies")), text: get("armor proficiencies") };
	if (get("weapon proficiencies")) cls.weapons = { ...parseWeapons(get("weapon proficiencies")), text: get("weapon proficiencies") };
	if (get("bonus to defense")) cls.defenceBonuses = parseDefences(get("bonus to defense"));
	if (get("hit points at 1st level")) cls.hpStart = numberOf(get("hit points at 1st level").match(/^[\d.]+/)?.[0] ?? "");
	if (get("hit points per level gained")) cls.hpPerLevel = numberOf(get("hit points per level gained").match(/^[\d.]+/)?.[0] ?? "");
	if (get("healing surges per day")) cls.surges = numberOf(get("healing surges per day").match(/^[\d.]+/)?.[0] ?? "");
	if (get("trained skills")) cls.trainedSkills = parseTrainedSkills(get("trained skills"));
	// "Class Skills" is italic, not bold, in most pages, so it is not among the lines above.
	const skillsText = get("class skills") ?? txt(block.match(/Class Skills<\/i>\s*:?\s*([\s\S]*?)(?:<br>|$)/i)?.[1] ?? "");
	if (skillsText) cls.classSkills = parseClassSkills(skillsText);
	if (get("implement")) cls.implements = nameList(get("implement"));
	if (get("build options")) cls.buildOptions = nameList(get("build options"));
	if (get("hybrid talent options")) cls.hybridTalentOptions = nameList(get("hybrid talent options"));
	if (get("class features")) cls.featureNames = nameList(get("class features"));
	for (const key of ["extra trained skill", "extra trained skills", "prerequisite"]) if (get(key)) cls.notes.push(`${key}: ${get(key)}`);

	cls.description = prose(html);
	cls.features = parseFeatures(html);
	for (const [field, value] of [["role", cls.role], ["key abilities", cls.keyAbilities.length], ["hit points", cls.hpStart], ["healing surges", cls.surges]]) {
		if (!value && value !== 0) { cls.quality = "partial"; cls.notes.push(`missing: ${field}`); }
	}
	if (!cls.features.length) { cls.quality = "partial"; cls.notes.push("no-features"); }
	return cls;
}

/** The flavour text between the traits block and the features: one section. */
function prose(html) {
	const after = html.replace(/^[\s\S]*?<\/blockquote>/i, "");
	const end = after.search(/<h3>[^<]*CLASS FEATURES/i);
	const text = txt(end >= 0 ? after.slice(0, end) : after.replace(/<p class=publishedIn>[\s\S]*$/i, ""));
	return text ? [{ heading: "", text }] : [];
}

async function main() {
	const argv = process.argv.slice(2);
	const flag = (name, fallback) => (argv.includes(`--${name}`) ? argv[argv.indexOf(`--${name}`) + 1] : fallback);
	const here = path.dirname(fileURLToPath(import.meta.url));
	const input = path.resolve(here, flag("in", "out/class.json"));
	const outDir = path.resolve(here, flag("out", "out/parsed"));
	const classes = JSON.parse(await readFile(input, "utf8")).map(parseClass);
	await mkdir(outDir, { recursive: true });
	await writeFile(path.join(outDir, "class.json"), JSON.stringify(classes, null, 1));
	const q = {};
	for (const c of classes) q[c.quality] = (q[c.quality] ?? 0) + 1;
	console.log(`Parsed ${classes.length} classes:`, q);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
