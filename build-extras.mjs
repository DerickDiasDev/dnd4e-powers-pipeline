/**
 * Builds the deities, diseases and companions part of the database from out/parsed/extras.json. They go where the character
 * options go (out/db/option/<kind>/), with the same shape, so the importer lists them in the options window.
 *
 * Each is one `feature` item (featureType "other"; `featureGroup` says what it is) whose description is the page:
 *   deity      the facts of its header (type, alignment, domains, sphere...) and its text; `apply.deity` lets the importer write the
 *              deity's name into the sheet's own field
 *   disease    its stages and the check that moves between them
 *   companion  the stat block as text: the numbers depend on the master's level, so it cannot be a fixed actor
 *
 * Run after build-options.mjs, which starts the manifest's `options` afresh.
 *
 * Usage: node build-extras.mjs [--in out/parsed/extras.json] [--db out/db]
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const EXTRAS_SCHEMA_VERSION = 1;
export const EXTRA_KINDS = ["deity", "disease", "companion"];

const esc = s => String(s ?? "").replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
const stableId = seed => createHash("sha1").update(`dnd4e:extra:${seed}`).digest("base64").replace(/[^A-Za-z0-9]/g, "").slice(0, 16);
const GROUP = { deity: "Deity", disease: "Disease", companion: "Companion" };

/** The page as HTML. */
export function describeHtml(e) {
	const out = [];
	if (e.kind === "deity") {
		if (e.title) out.push(`<p><em>${esc(e.title)}</em></p>`);
		for (const f of e.facts) out.push(`<p><strong>${esc(f.label)}:</strong> ${esc(f.value)}</p>`);
	}
	if (e.kind === "disease" && e.flavor) out.push(`<p><em>${esc(e.flavor)}</em></p>`);
	for (const line of e.body) out.push(`<p>${esc(line)}</p>`);
	return out.join("");
}

/** @param {object} e a parsed deity, disease or companion */
export function buildExtra(e) {
	const item = {
		_id: stableId(`${e.kind}:${e.id}:main`),
		name: e.name,
		type: "feature",
		system: {
			description: { value: describeHtml(e) },
			featureType: "other",
			level: e.level ?? null,
			requirements: "",
			featureSource: "",
			featureGroup: e.kind === "companion" ? e.category : GROUP[e.kind],
			source: { book: e.sourceCode ?? "", page: "", custom: "", revision: 1 },
		},
		flags: { dnd4e: { import: { origin: "iws-4e-compendium", kind: e.kind, id: e.id, sourceCode: e.sourceCode, schema: EXTRAS_SCHEMA_VERSION, role: "main", bundle: null } } },
		effects: [],
	};
	item.flags.dnd4e.import.bundle = item._id;
	return {
		id: e.id, _id: item._id, kind: e.kind, name: e.name, tier: null, level: e.level ?? null,
		category: e.kind === "disease" ? e.category : e.category ?? null,
		prerequisite: "",
		// What the window's search also reads: a deity's domains, a companion's size and type.
		extra: e.kind === "deity" ? [e.domains, e.godType, e.title].filter(Boolean).join(" ") : [e.size, e.creatureType].filter(Boolean).join(" "),
		sources: e.sources, source: e.sourceCode, quality: "complete", notes: [...e.notes],
		apply: { paragon: null, epic: null, deity: e.kind === "deity" ? e.name : null },
		powers: [], items: [item],
	};
}

/** A light row for the importer's list: the same shape as the options'. */
export const indexRow = entry => ({
	id: entry.id, _id: entry._id, kind: entry.kind, name: entry.name, tier: entry.tier, level: entry.level, category: entry.category, prerequisite: entry.prerequisite, extra: entry.extra,
	source: entry.source, sources: entry.sources, quality: entry.quality, notes: entry.notes, items: entry.items.map(i => i._id), powers: entry.powers,
});

async function main() {
	const argv = process.argv.slice(2);
	const flag = (name, fallback) => (argv.includes(`--${name}`) ? argv[argv.indexOf(`--${name}`) + 1] : fallback);
	const here = path.dirname(fileURLToPath(import.meta.url));
	const input = path.resolve(here, flag("in", "out/parsed/extras.json"));
	const dbDir = path.resolve(here, flag("db", "out/db"));
	const parsed = JSON.parse(await readFile(input, "utf8"));
	const manifestFile = path.join(dbDir, "manifest.json");
	const manifest = JSON.parse(await readFile(manifestFile, "utf8"));
	manifest.options ??= {};
	for (const kind of EXTRA_KINDS) {
		const entries = parsed.filter(p => p.kind === kind).map(buildExtra);
		await mkdir(path.join(dbDir, "option", kind), { recursive: true });
		await writeFile(path.join(dbDir, "option", kind, "entries.json"), JSON.stringify(entries));
		await writeFile(path.join(dbDir, "option", kind, "_index.json"), JSON.stringify(entries.map(indexRow)));
		manifest.options[kind] = { count: entries.length, items: entries.length, schema: EXTRAS_SCHEMA_VERSION };
		console.log(`${kind}: ${entries.length}`);
	}
	await writeFile(manifestFile, JSON.stringify(manifest, null, 1));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
