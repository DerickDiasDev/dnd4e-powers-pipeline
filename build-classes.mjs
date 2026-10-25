/**
 * Builds the class part of the database (out/db/class/) from out/parsed/class.json.
 *
 * A class becomes:
 *   - `items`: Foundry `feature` items (featureType "class"): one for the class itself (its traits and description) and one per
 *     class feature, with the level it comes at. Importing a class puts these on the actor.
 *   - `apply`: what the importer writes into the actor's fields (class name, primary ability, hit points, healing surges, defence
 *     bonuses, fixed trained skills, armour and weapon proficiencies). Declarative: the importer maps it to the system's fields.
 *     Hybrid classes have no numbers (their hit points and surges are halves meant to be combined), only the name.
 *   - `powers`: the powers named by the class features, found in the power database. `kind` is "granted" for a feature that says
 *     "You gain the X power" and "option" when the feature lets the player pick among several.
 *
 * Output: out/db/class/_index.json (light rows) and out/db/class/classes.json (full entries with items).
 * Run after build-db.mjs and build-races.mjs (both rewrite manifest.json / read the power index).
 *
 * Usage: node build-classes.mjs [--in out/parsed/class.json] [--db out/db]
 */
import { createHash } from "node:crypto";
import { attachFeatureEffects } from "./build-effects.mjs";
import { ENUMS } from "./system-enums.mjs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseChoice } from "./class-choices.mjs";

export const CLASS_SCHEMA_VERSION = 1;

const esc = s => String(s ?? "").replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
const stableId = seed => createHash("sha1").update(`dnd4e:class:${seed}`).digest("base64").replace(/[^A-Za-z0-9]/g, "").slice(0, 16);
const paragraphs = text => String(text).split("\n").filter(Boolean).map(l => `<p>${esc(l)}</p>`).join("");
const SMALL_WORDS = new Set(["a", "an", "and", "as", "at", "by", "for", "from", "in", "of", "on", "or", "the", "to", "with"]);

const ABILITY_NAMES = { str: "Strength", con: "Constitution", dex: "Dexterity", int: "Intelligence", wis: "Wisdom", cha: "Charisma" };
const DEFENCE_NAMES = { ac: "AC", fort: "Fortitude", ref: "Reflex", wil: "Will" };
const SKILL_NAMES = {
	acr: "Acrobatics", arc: "Arcana", ath: "Athletics", blu: "Bluff", dip: "Diplomacy", dun: "Dungeoneering", end: "Endurance", hea: "Heal",
	his: "History", ins: "Insight", itm: "Intimidate", nat: "Nature", prc: "Perception", rel: "Religion", stl: "Stealth", stw: "Streetwise", thi: "Thievery",
};

/** "KNIGHT'S VALOR" -> "Knight's Valor"; a leading "LEVEL 7 " is dropped when the item already carries the level. */
export function featureTitle(name, level) {
	const stripped = level !== null && level !== undefined ? name.replace(new RegExp(`^LEVEL\\s+${level}\\s+`, "i"), "") : name;
	return stripped.toLowerCase().replace(/[\p{L}\p{N}'’]+/gu, (word, offset) => {
		if (offset > 0 && SMALL_WORDS.has(word)) return word;
		return word[0].toUpperCase() + word.slice(1);
	}).replace(/\(hybrid\)/i, "(Hybrid)");
}

/** Plain-language summary of the class traits, for the description of the class item. */
function summary(cls) {
	const rows = [];
	const row = (label, value) => value ? rows.push(`<p><strong>${label}:</strong> ${esc(value)}</p>`) : null;
	row("Role", cls.role);
	row("Power source", cls.powerSource);
	row("Key abilities", cls.keyAbilitiesText);
	row("Armor proficiencies", cls.armour.text);
	row("Weapon proficiencies", cls.weapons.text);
	row("Bonus to defense", Object.entries(cls.defenceBonuses).map(([k, v]) => `+${v} ${DEFENCE_NAMES[k]}`).join(", "));
	row("Hit points at 1st level", cls.hpStart !== null ? `${cls.hpStart} + Constitution score` : "");
	row("Hit points per level gained", cls.hpPerLevel);
	row("Healing surges per day", cls.surges !== null ? `${cls.surges}${cls.hybrid ? "" : " + Constitution modifier"}` : "");
	row("Trained skills", cls.trainedSkills.text);
	row("Class skills", cls.classSkills.map(k => SKILL_NAMES[k]).join(", "));
	row("Implements", cls.implements.join(", "));
	row("Build options", cls.buildOptions.join(", "));
	row("Hybrid talent options", cls.hybridTalentOptions.join(", "));
	for (const note of cls.notes) rows.push(`<p>${esc(note)}</p>`);
	for (const section of cls.description) rows.push(`${section.heading ? `<h3>${esc(section.heading)}</h3>` : ""}${paragraphs(section.text)}`);
	return rows.join("");
}

const featureItem = (cls, { key, name, html, role, level, section }) => ({
	_id: stableId(`${cls.id}:${key}`),
	name,
	type: "feature",
	system: {
		description: { value: html },
		featureType: "class",
		level: level ?? null,
		requirements: "",
		featureSource: cls.name,
		featureGroup: "",
		source: { book: cls.sourceCode ?? "", page: "", custom: "", revision: 1 },
	},
	flags: {
		dnd4e: {
			import: { origin: "iws-4e-compendium", kind: "class", id: cls.id, sourceCode: cls.sourceCode, schema: CLASS_SCHEMA_VERSION, quality: cls.quality, role, ...(section !== undefined ? { section } : {}), class: cls.name },
		},
	},
});

/**
 * Finds the power database row for a power named by a class feature.
 * @returns {object|null} the row, preferring a class power of this class (builds count as their base class)
 */
function findPower(name, cls, powerRows) {
	const wanted = name.toLowerCase();
	const base = `${cls.hybrid ? "hybrid " : ""}${cls.baseName}`.toLowerCase();
	const classOf = p => p.class?.toLowerCase().replace(/\s*\(.*\)\s*$/, "");
	const same = powerRows.filter(p => p.name.toLowerCase() === wanted && p.powerType === "class");
	const own = same.find(p => classOf(p) === base);
	if (own) return own;
	// A feature may hand out a power of another class (a berserker's Defender Aura): fine when the name says only one.
	return same.length === 1 ? same[0] : null;
}

/** @param {object} cls a parsed class  @param {{id: string, name: string, class: string, powerType: string}[]} powerRows the power index */
export function buildClass(cls, powerRows = []) {
	const main = featureItem(cls, { key: "main", name: cls.name, role: "main", html: summary(cls) });
	const items = [main];
	cls.features.forEach((feature, i) => items.push(featureItem(cls, {
		key: `feature:${i}`, name: featureTitle(feature.name, feature.level), role: "feature", level: feature.level, section: i,
		html: paragraphs(feature.text) || "<p></p>",
	})));
	for (const item of items) item.flags.dnd4e.import.bundle = main._id;
	// Standing bonuses written in a class feature ("+2 bonus to initiative") become effects that transfer to the owner.
	items.forEach((item, i) => attachFeatureEffects(item, i === 0 ? "" : cls.features[i - 1].text, ENUMS.damageTypes));

	// Powers named by the features, once each (the same stance list is repeated at several levels)
	const powers = [];
	const unresolved = [];
	const seen = new Set();
	for (const feature of cls.features) {
		for (const powerName of feature.powers) {
			const row = findPower(powerName, cls, powerRows);
			if (!row) { if (!unresolved.includes(powerName)) unresolved.push(powerName); continue; }
			const kind = feature.powerChoice ? "option" : "granted";
			const key = `${row.id}|${kind}|${feature.level}`;
			if (seen.has(key)) continue;
			seen.add(key);
			powers.push({ id: row.id, name: row.name, kind, level: feature.level, feature: featureTitle(feature.name, feature.level) });
		}
	}

	// The features that make you choose (a fighting style, a heartland...): each option, to pick one in the builder and to import the one picked.
	const choices = [];
	cls.features.forEach((feature, i) => {
		const choice = parseChoice(feature.text);
		if (choice) choices.push({ section: i, feature: featureTitle(feature.name, feature.level), level: feature.level, pick: choice.pick, options: choice.options });
	});

	const apply = {
		class: cls.baseName === cls.name || !cls.build ? cls.name : cls.name,
		primaryAbility: cls.hybrid ? null : (cls.keyAbilities[0] ?? null),
		hpStart: cls.hybrid ? null : cls.hpStart,
		hpPerLevel: cls.hybrid ? null : cls.hpPerLevel,
		surges: cls.hybrid ? null : cls.surges,
		defences: cls.hybrid ? {} : cls.defenceBonuses,
		trained: cls.hybrid ? [] : cls.trainedSkills.fixed,
		armour: cls.hybrid ? [] : cls.armour.keys,
		weapons: cls.hybrid ? [] : cls.weapons.keys,
		weaponsCustom: cls.hybrid ? [] : cls.weapons.other,
	};

	const notes = [...(cls.quality === "description-only" ? ["no-traits-block"] : [])];
	if (cls.hybrid) notes.push("hybrid");
	if (cls.keyAbilities.length > 1) notes.push("primary-ability-first");
	if (cls.trainedSkills.choose) notes.push("skill-choice");
	if (cls.weapons.other.length) notes.push("weapons-custom");
	if (powers.some(p => p.kind === "option")) notes.push("power-choice");
	if (choices.length) notes.push("feature-choice");
	if (unresolved.length) notes.push("powers-unresolved");
	return {
		id: cls.id, _id: main._id, name: cls.name, baseName: cls.baseName, build: cls.build, hybrid: cls.hybrid, sources: cls.sources, source: cls.sourceCode,
		role: cls.role, powerSource: cls.powerSource, keyAbilities: cls.keyAbilities, quality: cls.quality, notes,
		skillChoice: { choose: cls.trainedSkills.choose, from: cls.classSkills }, apply, powers, unresolved, choices, items,
	};
}

/** A light row for the importer's list. */
export const indexRow = entry => ({
	id: entry.id, _id: entry._id, name: entry.name, baseName: entry.baseName, build: entry.build, hybrid: entry.hybrid, source: entry.source, sources: entry.sources,
	role: entry.role, powerSource: entry.powerSource, keyAbilities: entry.keyAbilities, hp: entry.apply.hpStart, surges: entry.apply.surges,
	quality: entry.quality, notes: entry.notes, items: entry.items.map(i => i._id), powers: entry.powers,
});

async function main() {
	const argv = process.argv.slice(2);
	const flag = (name, fallback) => (argv.includes(`--${name}`) ? argv[argv.indexOf(`--${name}`) + 1] : fallback);
	const here = path.dirname(fileURLToPath(import.meta.url));
	const input = path.resolve(here, flag("in", "out/parsed/class.json"));
	const dbDir = path.resolve(here, flag("db", "out/db"));
	const classes = JSON.parse(await readFile(input, "utf8"));
	const powerRows = JSON.parse(await readFile(path.join(dbDir, "power", "_index.json"), "utf8"));
	const entries = classes.map(c => buildClass(c, powerRows));
	await mkdir(path.join(dbDir, "class"), { recursive: true });
	await writeFile(path.join(dbDir, "class", "classes.json"), JSON.stringify(entries));
	await writeFile(path.join(dbDir, "class", "_index.json"), JSON.stringify(entries.map(indexRow)));
	const manifestFile = path.join(dbDir, "manifest.json");
	const manifest = JSON.parse(await readFile(manifestFile, "utf8"));
	manifest.classes = { count: entries.length, items: entries.reduce((n, e) => n + e.items.length, 0), schema: CLASS_SCHEMA_VERSION };
	await writeFile(manifestFile, JSON.stringify(manifest, null, 1));
	const notes = {};
	for (const e of entries) for (const n of e.notes) notes[n] = (notes[n] ?? 0) + 1;
	console.log(`Classes: ${entries.length} -> ${manifest.classes.items} feature items; notes:`, notes);
	const lost = entries.flatMap(e => e.unresolved.map(p => `${e.name}: ${p}`));
	if (lost.length) console.log(`${lost.length} powers named by features are not in the power DB, e.g.`, lost.slice(0, 8));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
