/**
 * Builds the character-option part of the database (out/db/option/<kind>/) from out/parsed/option-<kind>.json.
 * Kinds: feat, path (paragon path), destiny (epic destiny), theme, background.
 *
 * An option becomes:
 *   - `items`: Foundry `feature` items (featureType feat | path | destiny | theme | background). The first is the option itself;
 *     paths and destinies add one per feature, with the level it comes at.
 *   - `apply`: what the importer writes into the actor (the paragon path and epic destiny names go to the sheet's own fields).
 *   - `powers`: the powers the option gives, found in the power database. Paths and destinies give theirs outright (`granted`),
 *     except where two powers share a level (`option`: the player picks). A theme gives its feature power; the others are options.
 *
 * Output: out/db/option/<kind>/_index.json (light rows, same shape for every kind) and entries.json (full entries).
 * Run after build-db.mjs (it reads the power index).
 *
 * Usage: node build-options.mjs [--db out/db]
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { KINDS } from "./parse-options.mjs";

export const OPTION_SCHEMA_VERSION = 1;

const esc = s => String(s ?? "").replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
const stableId = seed => createHash("sha1").update(`dnd4e:option:${seed}`).digest("base64").replace(/[^A-Za-z0-9]/g, "").slice(0, 16);
const paragraphs = text => String(text).split("\n").filter(Boolean).map(l => `<p>${esc(l)}</p>`).join("");

const FEATURE_TYPE = { feat: "feat", path: "path", destiny: "destiny", theme: "theme", background: "background" };
const POWER_TYPE = { feat: "feat", path: "paragon", destiny: "epic", theme: "theme" };
const TIER_LEVEL = { Heroic: 1, Paragon: 11, Epic: 21 };
/** The level an option starts at: paths at 11, destinies at 21, themes at 1; feats by tier; backgrounds have none. */
const startLevel = (kind, option) => ({ path: 11, destiny: 21, theme: 1 }[kind] ?? (kind === "feat" ? TIER_LEVEL[option.tier] ?? null : null));
const tierOf = (kind, option) => ({ path: "Paragon", destiny: "Epic", theme: "Heroic", background: null }[kind] ?? option.tier ?? null);

function description(kind, option) {
	const parts = [];
	if (option.quote) parts.push(`<p><em>${esc(option.quote)}</em></p>`);
	if (option.intro) parts.push(`<p><em>${esc(option.intro)}</em></p>`);
	if (option.type) parts.push(`<p><strong>Type:</strong> ${esc(option.type)}${option.campaign ? ` (${esc(option.campaign)})` : ""}</p>`);
	if (option.prerequisite) parts.push(`<p><strong>Prerequisite:</strong> ${esc(option.prerequisite)}</p>`);
	for (const s of option.sections ?? []) parts.push(`<p><strong>${esc(s.label)}:</strong> ${esc(s.text)}</p>`);
	for (const s of option.prose ?? []) parts.push(`${s.heading ? `<h3>${esc(s.heading)}</h3>` : ""}${paragraphs(s.text)}`);
	if (option.benefit) parts.push(`<p><strong>Benefit:</strong> ${esc(option.benefit)}</p>`);
	return parts.join("");
}

const featureItem = (option, { key, name, html, role, level, section }) => ({
	_id: stableId(`${option.kind}:${option.id}:${key}`),
	name,
	type: "feature",
	system: {
		description: { value: html },
		featureType: FEATURE_TYPE[option.kind],
		level: level ?? null,
		requirements: option.prerequisite ?? "",
		featureSource: option.kind === "feat" || option.kind === "background" ? "" : option.name,
		featureGroup: option.category ?? option.type ?? "",
		source: { book: option.sourceCode ?? "", page: "", custom: "", revision: 1 },
	},
	flags: {
		dnd4e: {
			import: { origin: "iws-4e-compendium", kind: option.kind, id: option.id, sourceCode: option.sourceCode, schema: OPTION_SCHEMA_VERSION, quality: option.quality, role, ...(section !== undefined ? { section } : {}), option: option.name },
		},
	},
});

/**
 * The power database rows that belong to an option: powers whose "class" is the option's name and whose type fits the kind.
 * Feats name their powers on the page, so a feat looks them up by that name.
 */
function powersOf(kind, option, powerRows) {
	const type = POWER_TYPE[kind];
	if (!type) return [];
	const clean = s => String(s ?? "").toLowerCase().replace(/\s*\(.*\)\s*$/, "");
	if (kind === "feat") {
		const wanted = new Set(option.powerNames.map(n => n.toLowerCase()));
		return powerRows.filter(p => p.powerType === "feat" && wanted.has(p.name.toLowerCase()));
	}
	return powerRows.filter(p => p.powerType === type && clean(p.class) === clean(option.name));
}

/** @param {string} kind  @param {object} option a parsed option  @param {object[]} powerRows the power index */
export function buildOption(kind, option, powerRows = []) {
	const level = startLevel(kind, option);
	const main = featureItem(option, { key: "main", name: option.name, role: "main", html: description(kind, option), level });
	const items = [main];
	(option.features ?? []).forEach((f, i) => items.push(featureItem(option, { key: `feature:${i}`, name: f.name, role: "feature", level: f.level, section: i, html: paragraphs(f.text) || "<p></p>" })));
	for (const item of items) item.flags.dnd4e.import.bundle = main._id;

	const found = powersOf(kind, option, powerRows);
	// Several powers on the same level are a choice; a lone power is given. A theme gives only its "feature" power.
	const perLevel = new Map();
	for (const p of found) perLevel.set(p.level, (perLevel.get(p.level) ?? 0) + 1);
	const powers = found.map(p => {
		const granted = kind === "theme" ? p.kind === "feature" : kind === "feat" ? true : (perLevel.get(p.level) ?? 0) === 1;
		return { id: p.id, name: p.name, kind: granted ? "granted" : "option", level: p.level ?? startLevel(kind, option) };
	});

	const apply = { paragon: kind === "path" ? option.name : null, epic: kind === "destiny" ? option.name : null };
	const notes = [...option.notes];
	if (powers.some(p => p.kind === "option")) notes.push("power-choice");
	if (option.powerNames?.length && kind !== "feat" && !found.length) notes.push("powers-missing");
	return {
		id: option.id, _id: main._id, kind, name: option.name, tier: tierOf(kind, option), level, category: option.category ?? option.type ?? null,
		prerequisite: option.prerequisite ?? "", sources: option.sources, source: option.sourceCode, quality: option.quality, notes, apply, powers, items,
	};
}

/** A light row for the importer's list: the same shape for every kind. */
export const indexRow = entry => ({
	id: entry.id, _id: entry._id, kind: entry.kind, name: entry.name, tier: entry.tier, level: entry.level, category: entry.category, prerequisite: entry.prerequisite,
	source: entry.source, sources: entry.sources, quality: entry.quality, notes: entry.notes, items: entry.items.map(i => i._id), powers: entry.powers,
});

async function main() {
	const argv = process.argv.slice(2);
	const flag = (name, fallback) => (argv.includes(`--${name}`) ? argv[argv.indexOf(`--${name}`) + 1] : fallback);
	const here = path.dirname(fileURLToPath(import.meta.url));
	const dbDir = path.resolve(here, flag("db", "out/db"));
	const powerRows = JSON.parse(await readFile(path.join(dbDir, "power", "_index.json"), "utf8"));
	const manifestFile = path.join(dbDir, "manifest.json");
	const manifest = JSON.parse(await readFile(manifestFile, "utf8"));
	manifest.options = {};
	for (const kind of Object.keys(KINDS)) {
		const parsed = JSON.parse(await readFile(path.join(here, "out", "parsed", `option-${kind}.json`), "utf8"));
		const entries = parsed.map(o => buildOption(kind, o, powerRows));
		await mkdir(path.join(dbDir, "option", kind), { recursive: true });
		await writeFile(path.join(dbDir, "option", kind, "entries.json"), JSON.stringify(entries));
		await writeFile(path.join(dbDir, "option", kind, "_index.json"), JSON.stringify(entries.map(indexRow)));
		manifest.options[kind] = { count: entries.length, items: entries.reduce((n, e) => n + e.items.length, 0), schema: OPTION_SCHEMA_VERSION };
		const notes = {};
		for (const e of entries) for (const n of e.notes) notes[n] = (notes[n] ?? 0) + 1;
		console.log(`${kind}: ${entries.length} -> ${manifest.options[kind].items} items; powers linked: ${entries.reduce((n, e) => n + e.powers.length, 0)}; notes:`, notes);
	}
	await writeFile(manifestFile, JSON.stringify(manifest, null, 1));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
