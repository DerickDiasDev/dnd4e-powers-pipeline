/**
 * Builds the traps part of the database (out/db/trap/) from out/parsed/trap.json: traps, hazards, terrain and obstacles as the
 * system's `Hazard` actors, with the same index rows as the monsters, so the importer lists them in the monster window.
 *
 * A trap is a Hazard actor with the printed numbers as values (`advancedCals: false`): level, XP, and the hit points, defences and
 * initiative the page prints; what it does not print is switched off with the sheet's own `none` flag (a trap without hit points
 * cannot be killed). The sheet has fields for how to notice it (`detection`) and how to deal with it (`countermeasures`); the rest
 * of the text, with the triggers, is the description. Its attacks are `power` items on the actor (the hazard sheet has a powers
 * tab), made by the same converter as the monsters' powers (trap-powers.mjs finds them in the text).
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
import { convertPowerItem } from "./build-monsters.mjs";

export const TRAP_SCHEMA_VERSION = 3;

const esc = s => String(s ?? "").replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
const slug = s => String(s).toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const stableId = seed => createHash("sha1").update(`dnd4e:trap:${seed}`).digest("base64").replace(/[^A-Za-z0-9]/g, "").slice(0, 16);
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

/** The text as HTML: a line that is a title of the page (Trigger, Attack, Countermeasures...) in bold. */
export function describeHtml(t) {
	const title = /^(?:Perception|Trigger|Attack|Countermeasures|Triggered Actions|Standard Actions|Immediate Reaction|Immediate Interrupt|Effect|Special|Detect|Initiative|HP|AC|Immune|Resist|Vulnerable|Requirement|Target|Hit|Miss|Usage|Aftereffect|Trap|Hazard|Terrain|Obstacle)\b[^:]{0,40}:?$/;
	return t.body.map(line => (title.test(line) && line.length < 40 ? `<p><strong>${esc(line)}</strong></p>` : `<p>${esc(line)}</p>`)).join("");
}

/** The sheet's own roles: primary trap/hazard/other, tertiary blaster/lurker/obstacle/warder/other. */
const PRIMARY = { trap: "trap", hazard: "hazard" };
const TERTIARY = new Set(["blaster", "lurker", "obstacle", "warder"]);

/** @param {object} t a parsed trap */
export function buildTrap(t) {
	const d = t.defences;
	const defence = key => ({ base: d?.[key] ?? 10, none: d?.[key] === null || d?.[key] === undefined });
	const hp = t.hp ?? 0;
	const host = { id: t.id, level: t.level ?? 0, name: t.name, sourceCode: t.sourceCode, traits: [] };
	const items = (t.powers ?? []).map((p, i) => {
		// "Level + 3 vs. Reflex": the trap's level plus a number.
		if (p.levelAttack) p = { ...p, attack: { ...p.attack, bonus: (t.level ?? 0) + p.levelAttack.offset, defence: p.levelAttack.def } };
		const power = convertPowerItem(host, p, i);
		Object.assign(power.flags.dnd4e.import, { kind: "trap-power", id: t.id, role: "power", ...(p.levelAttack ? { attackLevelOffset: p.levelAttack.offset } : {}) });
		return power;
	});
	const review = [...t.notes];
	if (items.some(p => (p.flags.dnd4e.import.review ?? []).some(r => r.startsWith("attack-unparsed")))) review.push("power-attack-text");
	return {
		_id: stableId(t.id),
		name: t.name,
		type: "Hazard",
		system: {
			advancedCals: false,
			description: describeHtml(t),
			details: {
				level: t.level ?? 0, exp: t.xp ?? 0, size: "med",
				detection: t.detection ?? "", countermeasures: t.countermeasures ?? "",
				role: { primary: PRIMARY[t.kind] ?? "other", secondary: t.group, tertiary: TERTIARY.has(t.role) ? t.role : (t.kind === "obstacle" ? "obstacle" : "other") },
				bloodied: Math.floor(hp / 2),
			},
			attributes: { hp: { value: hp, max: hp, none: !t.hp }, init: { base: t.initiative ?? 0, none: t.initiative === null } },
			defences: { ac: defence("ac"), fort: defence("fort"), ref: defence("ref"), wil: defence("wil") },
			identifier: slug(t.name),
			source: { book: t.sourceCode ?? "", page: "", custom: "", revision: 1 },
		},
		prototypeToken: { name: t.name, width: 1, height: 1 },
		items,
		flags: { dnd4e: { import: { origin: "iws-4e-compendium", kind: "trap", id: t.id, sourceCode: t.sourceCode, schema: TRAP_SCHEMA_VERSION, review, keywords: [cap(t.kind), ...(t.extraKind ? [t.extraKind] : [])] } } },
	};
}

/** A light row for the importer's list: the monsters' shape. */
export function indexRow(actor, t, file) {
	return {
		id: t.id, _id: actor._id, name: t.name, level: t.level, role: t.role, group: t.group, leader: false, size: "med", origin: "natural", creatureType: "animate",
		keywords: actor.flags.dnd4e.import.keywords, xp: t.xp, hp: t.hp,
		source: t.sourceCode, sources: t.sources, file, quality: "complete", notes: actor.flags.dnd4e.import.review, powers: actor.items.length, traits: 0,
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
