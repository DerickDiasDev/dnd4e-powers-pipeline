/**
 * Builds the ritual part of the database (out/db/ritual/) from out/parsed/ritual.json.
 *
 * A ritual becomes one `ritual` item: category, level, cast time and duration in the sheet's time units, the market price, the
 * skill of its check (`attribute`, the first of the key skills; the others are named in the text) and the check formula. The
 * description keeps everything the page says: the stats as printed (component cost, key skill, time, duration), the text, the
 * result tables and, for the alchemical rituals, the pages of the item they make.
 *
 * Output: out/db/ritual/_index.json (light rows) and out/db/ritual/rituals.json (entries with the item).
 * Run after build-db.mjs, which resets manifest.json.
 *
 * Usage: node build-rituals.mjs [--in out/parsed/ritual.json] [--db out/db]
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const RITUAL_SCHEMA_VERSION = 1;

const esc = s => String(s ?? "").replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
const stableId = seed => createHash("sha1").update(`dnd4e:ritual:${seed}`).digest("base64").replace(/[^A-Za-z0-9]/g, "").slice(0, 16);

/** The page as HTML: stats, text, tables (consecutive table lines make one table, the first row its header). */
export function describeHtml(r) {
	const out = [];
	if (r.flavor) out.push(`<p><em>${esc(r.flavor)}</em></p>`);
	const stats = [["Component Cost", r.componentCost], ["Market Price", r.marketText], ["Key Skill", r.keySkill], ["Time", r.time.text], ["Duration", r.duration.text]];
	for (const [label, value] of stats) if (value) out.push(`<p><strong>${label}:</strong> ${esc(value)}</p>`);
	let table = null;
	const flush = () => { if (table) { out.push(`<table>${table.map((cells, i) => `<tr>${cells.map(c => `<${i ? "td" : "th"}>${esc(c)}</${i ? "td" : "th"}>`).join("")}</tr>`).join("")}</table>`); table = null; } };
	for (const line of r.body) {
		if (line.table) { (table ??= []).push(line.text.split(" | ")); continue; }
		flush();
		out.push(line.heading ? `<h3>${esc(line.text)}</h3>` : `<p>${esc(line.text)}</p>`);
	}
	flush();
	return out.join("");
}

/** @param {object} r a parsed ritual */
export function buildRitual(r) {
	const notes = [...r.notes];
	if (r.skills.length > 1) notes.push("skill-choice");
	const skill = r.skills[0] ?? "arc";
	const item = {
		_id: stableId(`${r.id}:main`),
		name: r.name,
		type: "ritual",
		system: {
			description: { value: describeHtml(r) },
			source: { book: r.sourceCode ?? "", page: "", custom: "", revision: 1 },
			level: r.level,
			category: r.category,
			market: r.marketText ?? "",
			castTime: { value: r.time.value, units: r.time.units },
			duration: { value: r.duration.value, units: r.duration.units },
			attribute: `skills.${skill}.total`,
			formula: "@attribute",
			requirements: "",
		},
		flags: { dnd4e: { import: { origin: "iws-4e-compendium", kind: "ritual", id: r.id, sourceCode: r.sourceCode, schema: RITUAL_SCHEMA_VERSION, role: "main", bundle: null } } },
		effects: [],
	};
	item.flags.dnd4e.import.bundle = item._id;
	return {
		id: r.id, _id: item._id, name: r.name, level: r.level, category: r.category, skills: r.skills, noCheck: r.noCheck,
		time: r.time.text, duration: r.duration.text, componentCost: r.componentCost, price: r.marketPrice,
		source: r.sourceCode, sources: r.sources, notes, items: [item],
	};
}

/** A light row for the importer's list. */
export const indexRow = entry => ({
	id: entry.id, _id: entry._id, name: entry.name, level: entry.level, category: entry.category, skills: entry.skills, noCheck: entry.noCheck,
	time: entry.time, duration: entry.duration, componentCost: entry.componentCost, price: entry.price,
	source: entry.source, sources: entry.sources, notes: entry.notes, items: entry.items.map(i => i._id),
});

async function main() {
	const argv = process.argv.slice(2);
	const flag = (name, fallback) => (argv.includes(`--${name}`) ? argv[argv.indexOf(`--${name}`) + 1] : fallback);
	const here = path.dirname(fileURLToPath(import.meta.url));
	const input = path.resolve(here, flag("in", "out/parsed/ritual.json"));
	const dbDir = path.resolve(here, flag("db", "out/db"));
	const entries = JSON.parse(await readFile(input, "utf8")).map(buildRitual);
	await mkdir(path.join(dbDir, "ritual"), { recursive: true });
	await writeFile(path.join(dbDir, "ritual", "rituals.json"), JSON.stringify(entries));
	await writeFile(path.join(dbDir, "ritual", "_index.json"), JSON.stringify(entries.map(indexRow)));
	const manifestFile = path.join(dbDir, "manifest.json");
	const manifest = JSON.parse(await readFile(manifestFile, "utf8"));
	manifest.rituals = { count: entries.length, schema: RITUAL_SCHEMA_VERSION };
	await writeFile(manifestFile, JSON.stringify(manifest, null, 1));
	const notes = {};
	for (const e of entries) for (const n of e.notes) notes[n] = (notes[n] ?? 0) + 1;
	console.log(`Rituals: ${entries.length}; notes:`, notes);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
