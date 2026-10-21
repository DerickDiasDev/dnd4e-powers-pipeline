/**
 * Builds the race part of the database (out/db/race/) from out/parsed/race.json.
 *
 * A race becomes:
 *   - `items`: Foundry `feature` items (featureType "race"): one for the race itself (its basic traits and description) and
 *     one per named racial trait. Importing a race puts these on the actor.
 *   - `apply`: what the importer writes into the actor's own fields (race name, size, origin, vision, speed, spoken
 *     languages, skill bonuses and defence bonuses). Declarative on purpose: the importer maps it to the system's fields.
 *   - `powers`: the race's racial powers, found in the power database. `granted` is true when the traits name the power
 *     ("You have the elven accuracy power"); the others are options (the dragonborn picks one) and are left to the power importer.
 *
 * Output: out/db/race/_index.json (light rows) and out/db/race/races.json (full entries with items).
 * Run after build-db.mjs, which resets manifest.json.
 *
 * Usage: node build-races.mjs [--in out/parsed/race.json] [--db out/db]
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const RACE_SCHEMA_VERSION = 1;

const esc = s => String(s ?? "").replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
const slug = s => String(s).toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const stableId = seed => createHash("sha1").update(`dnd4e:race:${seed}`).digest("base64").replace(/[^A-Za-z0-9]/g, "").slice(0, 16);
const paragraphs = text => String(text).split("\n").filter(Boolean).map(l => `<p>${esc(l)}</p>`).join("");

const ABILITY_NAMES = { str: "Strength", con: "Constitution", dex: "Dexterity", int: "Intelligence", wis: "Wisdom", cha: "Charisma" };
const SIZE_NAMES = { tiny: "Tiny", sm: "Small", med: "Medium", lg: "Large", huge: "Huge", grg: "Gargantuan" };
const VISION_NAMES = { nv: "Normal", lv: "Low-light", dv: "Darkvision" };
/** The sheet's creature origins (CONFIG.DND4E.creatureOrigin). The compendium also prints keywords such as "Reptile" next to it. */
const ORIGINS = new Set(["aberrant", "elemental", "fey", "immortal", "natural", "shadow"]);

export const originKey = text => {
	const first = String(text ?? "").trim().split(/\s+/)[0]?.toLowerCase();
	return ORIGINS.has(first) ? first : null;
};

/** Plain-language summary of the basic traits, for the description of the race item. */
function summary(race) {
	const lines = [];
	if (race.tagline) lines.push(`<p><em>${esc(race.tagline)}</em></p>`);
	const row = (label, value) => value ? lines.push(`<p><strong>${label}:</strong> ${esc(value)}</p>`) : null;
	row("Average height", race.height);
	row("Average weight", race.weight);
	row("Ability scores", race.abilityScores?.text);
	row("Size", SIZE_NAMES[race.size]);
	if (race.speed?.squares !== null && race.speed?.squares !== undefined) row("Speed", `${race.speed.squares} squares${race.speed.extra ? `. ${race.speed.extra}` : ""}`);
	row("Vision", VISION_NAMES[race.vision]);
	row("Languages", race.languages?.text);
	row("Skill bonuses", race.skillBonusesText);
	for (const section of race.description) lines.push(`<h3>${esc(section.heading || race.name)}</h3>${paragraphs(section.text)}`);
	return lines.join("");
}

const featureItem = (race, { key, name, html, role, section, extra = {} }) => ({
	_id: stableId(`${race.id}:${key}`),
	name,
	type: "feature",
	system: {
		description: { value: html },
		featureType: "race",
		level: null,
		requirements: "",
		featureSource: race.name,
		featureGroup: "",
		source: { book: race.sourceCode ?? "", page: "", custom: "", revision: 1 },
		...extra,
	},
	flags: {
		dnd4e: {
			import: { origin: "iws-4e-compendium", kind: "race", id: race.id, sourceCode: race.sourceCode, schema: RACE_SCHEMA_VERSION, quality: race.quality, role, ...(section !== undefined ? { section } : {}), race: race.name },
		},
	},
});

/** @param {object} race a parsed race  @param {{id: string, name: string, class: string, powerType: string}[]} powerRows the power index */
export function buildRace(race, powerRows = []) {
	const named = new Set(race.powerNames.map(n => n.toLowerCase()));
	const powers = powerRows
		.filter(p => p.powerType === "race" && p.class?.toLowerCase().replace(/\s*\(.*\)\s*$/, "") === race.name.toLowerCase().replace(/\s*\(.*\)\s*$/, ""))
		.map(p => ({ id: p.id, name: p.name, granted: named.has(p.name.toLowerCase()) }));

	const main = featureItem(race, { key: "main", name: race.name, role: "main", html: summary(race) });
	const items = [main];
	race.traits.forEach((trait, i) => items.push(featureItem(race, { key: `trait:${i}`, name: trait.name, role: "trait", section: i, html: paragraphs(trait.text) })));
	main.flags.dnd4e.import.bundle = main._id;
	for (const item of items) item.flags.dnd4e.import.bundle = main._id;

	const apply = {
		race: race.name,
		size: race.size,
		origin: originKey(race.origin),
		vision: race.vision,
		speed: race.speed?.squares ?? null,
		spoken: race.languages?.spoken ?? [],
		customLanguages: race.languages?.custom ?? [],
		skills: race.skillBonuses,
		defences: race.defenceBonuses,
	};

	const notes = [...race.notes];
	if (race.abilityScores) notes.push("ability-scores-manual");
	if (race.languages?.choices?.length) notes.push("language-choice");
	if (race.speed?.extra) notes.push("speed-extra");
	if (race.quality !== "description-only" && powers.length && !powers.some(p => p.granted)) notes.push("power-choice");
	if (!powers.length && race.quality !== "description-only") notes.push("no-powers-found");
	return { id: race.id, _id: main._id, name: race.name, sources: race.sources, source: race.sourceCode, origin: race.origin, quality: race.quality, notes, apply, abilityScores: race.abilityScores, powers, items };
}

/** A light row for the importer's list. */
export const indexRow = entry => ({
	id: entry.id, _id: entry._id, name: entry.name, source: entry.source, sources: entry.sources, origin: entry.origin, size: entry.apply.size,
	speed: entry.apply.speed, vision: entry.apply.vision, quality: entry.quality, notes: entry.notes,
	abilityScores: entry.abilityScores?.text ?? "",
	items: entry.items.map(i => i._id), powers: entry.powers,
});

async function main() {
	const argv = process.argv.slice(2);
	const flag = (name, fallback) => (argv.includes(`--${name}`) ? argv[argv.indexOf(`--${name}`) + 1] : fallback);
	const here = path.dirname(fileURLToPath(import.meta.url));
	const input = path.resolve(here, flag("in", "out/parsed/race.json"));
	const dbDir = path.resolve(here, flag("db", "out/db"));
	const races = JSON.parse(await readFile(input, "utf8"));
	const powerRows = JSON.parse(await readFile(path.join(dbDir, "power", "_index.json"), "utf8"));
	const entries = races.map(r => buildRace(r, powerRows));
	await mkdir(path.join(dbDir, "race"), { recursive: true });
	await writeFile(path.join(dbDir, "race", "races.json"), JSON.stringify(entries));
	await writeFile(path.join(dbDir, "race", "_index.json"), JSON.stringify(entries.map(indexRow)));
	const manifestFile = path.join(dbDir, "manifest.json");
	const manifest = JSON.parse(await readFile(manifestFile, "utf8"));
	manifest.races = { count: entries.length, items: entries.reduce((n, e) => n + e.items.length, 0), schema: RACE_SCHEMA_VERSION };
	await writeFile(manifestFile, JSON.stringify(manifest, null, 1));
	const notes = {};
	for (const e of entries) for (const n of e.notes) notes[n] = (notes[n] ?? 0) + 1;
	console.log(`Races: ${entries.length} -> ${manifest.races.items} feature items; notes:`, notes);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
