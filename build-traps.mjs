/**
 * Builds the traps part of the database (out/db/trap/) from out/parsed/trap.json: traps, hazards, terrain and obstacles as NPC
 * actors, in the same shape (and the same index rows) as the monsters, so the importer lists them in the monster window.
 *
 * A trap is an NPC with the printed numbers as values (`advancedCals: false`): level, XP, hit points, defences and initiative when
 * the page prints them (a trap without hit points has 1: the actor needs at least that), and its whole text as the biography,
 * where the triggers, attacks and countermeasures are. Its attacks are not powers: the DM reads them.
 *
 * Output: out/db/trap/_index.json and out/db/trap/<BOOK>.json.
 * Run after build-monsters.mjs (it does not touch out/db/trap).
 *
 * Usage: node build-traps.mjs [--in out/parsed/trap.json] [--db out/db]
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const TRAP_SCHEMA_VERSION = 1;

const esc = s => String(s ?? "").replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
const slug = s => String(s).toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const stableId = seed => createHash("sha1").update(`dnd4e:trap:${seed}`).digest("base64").replace(/[^A-Za-z0-9]/g, "").slice(0, 16);
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

/** The text as HTML: a line that is a title of the page (Trigger, Attack, Countermeasures...) in bold. */
export function describeHtml(t) {
	const title = /^(?:Perception|Trigger|Attack|Countermeasures|Triggered Actions|Standard Actions|Immediate Reaction|Immediate Interrupt|Effect|Special|Detect|Initiative|HP|AC|Immune|Resist|Vulnerable|Requirement|Target|Hit|Miss|Usage|Aftereffect|Trap|Hazard|Terrain|Obstacle)\b[^:]{0,40}:?$/;
	return t.body.map(line => (title.test(line) && line.length < 40 ? `<p><strong>${esc(line)}</strong></p>` : `<p>${esc(line)}</p>`)).join("");
}

/** @param {object} t a parsed trap */
export function buildTrap(t) {
	const hp = Math.max(1, t.hp ?? 1);
	const d = t.defences ?? {};
	const actor = {
		_id: stableId(t.id),
		name: t.name,
		type: "NPC",
		system: {
			advancedCals: false,
			details: {
				level: t.level ?? 0, exp: t.xp ?? 0, size: "med", origin: "natural", type: "animate", other: "",
				role: { primary: t.role, secondary: t.group, leader: false }, alignment: "",
			},
			attributes: { hp: { value: hp, max: hp }, init: { base: t.initiative ?? 0 } },
			defences: { ac: { base: d.ac ?? 10 }, fort: { base: d.fort ?? 10 }, ref: { base: d.ref ?? 10 }, wil: { base: d.wil ?? 10 } },
			biography: describeHtml(t),
			identifier: slug(t.name),
			source: { book: t.sourceCode ?? "", page: "", custom: "", revision: 1 },
		},
		prototypeToken: { name: t.name, width: 1, height: 1 },
		items: [],
		flags: { dnd4e: { import: { origin: "iws-4e-compendium", kind: "trap", id: t.id, sourceCode: t.sourceCode, schema: TRAP_SCHEMA_VERSION, review: [...t.notes], keywords: [cap(t.kind), ...(t.extraKind ? [t.extraKind] : [])] } } },
	};
	return actor;
}

/** A light row for the importer's list: the monsters' shape. */
export function indexRow(actor, t, file) {
	return {
		id: t.id, _id: actor._id, name: t.name, level: t.level, role: t.role, group: t.group, leader: false, size: "med", origin: "natural", creatureType: "animate",
		keywords: actor.flags.dnd4e.import.keywords, xp: t.xp, hp: t.hp,
		source: t.sourceCode, sources: t.sources, file, quality: "complete", notes: actor.flags.dnd4e.import.review, powers: 0, traits: 0,
	};
}

async function main() {
	const argv = process.argv.slice(2);
	const flag = (name, fallback) => (argv.includes(`--${name}`) ? argv[argv.indexOf(`--${name}`) + 1] : fallback);
	const here = path.dirname(fileURLToPath(import.meta.url));
	const input = path.resolve(here, flag("in", "out/parsed/trap.json"));
	const dbDir = path.resolve(here, flag("db", "out/db"));
	const traps = JSON.parse(await readFile(input, "utf8"));
	const shards = new Map(), index = [];
	for (const t of traps) {
		const actor = buildTrap(t);
		const file = `${slug(t.sourceCode ?? "unknown") || "unknown"}.json`;
		if (!shards.has(file)) shards.set(file, []);
		shards.get(file).push(actor);
		index.push(indexRow(actor, t, file));
	}
	await rm(path.join(dbDir, "trap"), { recursive: true, force: true });
	await mkdir(path.join(dbDir, "trap"), { recursive: true });
	for (const [file, actors] of shards) await writeFile(path.join(dbDir, "trap", file), JSON.stringify(actors));
	await writeFile(path.join(dbDir, "trap", "_index.json"), JSON.stringify(index));
	const manifestFile = path.join(dbDir, "manifest.json");
	const manifest = JSON.parse(await readFile(manifestFile, "utf8"));
	manifest.traps = { count: index.length, files: shards.size, schema: TRAP_SCHEMA_VERSION };
	await writeFile(manifestFile, JSON.stringify(manifest, null, 1));
	console.log(`Traps: ${index.length} actors in ${shards.size} files`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
