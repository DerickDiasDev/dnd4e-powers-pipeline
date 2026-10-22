/**
 * Builds the companions that are creatures (out/db/companion/) from out/parsed/companion.json: an NPC for each animal, fey beast
 * and elemental companion, summoned creature and mount, with its powers and traits as items, and the same index rows as the
 * monsters, so the importer lists them in a window like the monsters'.
 *
 * Their numbers are their master's, so the actor is a template: level 0, one hit point, defences of 10. What the numbers are made of
 * is in `flags.dnd4e.import.companion` (`hp`, `defences`, `initiative`, `perception`) and in each power ("your level + 5 vs. AC" is
 * `attackLevelOffset`; "1d12 + your Wisdom modifier damage" is `companionDamage`, one entry for each level the damage changes at).
 * The importer fills them in from the master's level, or from the master's sheet.
 *
 * Output: out/db/companion/_index.json and out/db/companion/<BOOK>.json. Run after build-extras.mjs.
 *
 * Usage: node build-companions.mjs [--in out/parsed/companion.json] [--db out/db]
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { convertPowerItem, convertTraitItem, sensesOf } from "./build-monsters.mjs";

export const COMPANION_SCHEMA_VERSION = 1;

const esc = s => String(s ?? "").replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
const slug = s => String(s).toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const stableId = seed => createHash("sha1").update(`dnd4e:companion:${seed}`).digest("base64").replace(/[^A-Za-z0-9]/g, "").slice(0, 16);
const TOKEN_SIZE = Object.freeze({ tiny: 1, sm: 1, med: 1, lg: 2, huge: 3, grg: 4 });
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

/** The first damage of a power as numbers, for the formula it has before the importer knows the master. */
const plainDamage = d => (d.dice ? { formula: d.flat ? `${d.dice} + ${d.flat}` : d.dice, crit: (() => { const [q, f] = d.dice.split("d").map(Number); return String(q * f + d.flat); })() } : { formula: String(d.flat), crit: String(d.flat) });

/** @param {object} c a parsed companion creature */
export function buildCompanion(c) {
	const host = { id: c.id, level: 0, name: c.name, sourceCode: c.sourceCode, traits: [] };
	const items = [];
	c.powers.forEach((p, i) => {
		const power = convertPowerItem(host, p, i);
		const flags = power.flags.dnd4e.import;
		flags.kind = "companion-power";
		flags.review = (flags.review ?? []).filter(r => !(p.levelAttack && r === "attack-unparsed"));
		if (p.levelAttack) {
			Object.assign(power.system.attack, { isAttack: true, def: p.levelAttack.def, formula: String(p.levelAttack.offset) });
			flags.attackLevelOffset = p.levelAttack.offset;
		}
		if (p.damage?.length) {
			const first = plainDamage(p.damage[0]);
			Object.assign(power.system.hit, { isDamage: true, formula: first.formula, critFormula: first.crit });
			flags.companionDamage = p.damage;
		}
		// The lines that grow with the master's level and are not the damage stay with the effect.
		for (const s of (p.scaling ?? []).filter(x => x.line !== "hit")) power.system.effect.detail = [power.system.effect.detail, `Level ${s.levels.join(" or ")}: ${s.text}`].filter(Boolean).join("\n");
		items.push(power);
	});
	c.traits.forEach((t, i) => {
		const trait = convertTraitItem(host, t, c.powers.length + i);
		if (t.aura) trait.system.auraSize = String(t.aura);
		items.push(trait);
	});

	const senses = sensesOf(c.senses);
	const movement = { base: { base: c.speed.walk } };
	for (const [mode, n] of Object.entries(c.speed.modes)) movement[mode] = { formula: String(n) };
	const abilities = Object.fromEntries(["str", "con", "dex", "int", "wis", "cha"].map(k => [k, { value: c.abilities[k] ?? 10 }]));
	const bio = [...c.description, ...(c.speed.notes.length ? [`Speed: ${c.speed.notes.join("; ")}`] : [])].map(l => `<p>${esc(l)}</p>`).join("");
	const tokenSize = TOKEN_SIZE[c.size] ?? 1;
	const hp = c.hp?.mode === "fixed" ? Math.max(1, c.hp.value) : 1;
	const defence = key => ({ base: c.defences?.mode === "fixed" ? c.defences[key] : 10 });
	const review = [...new Set(["master-numbers", ...c.notes, ...items.flatMap(i => (i.flags.dnd4e.import.review ?? []).map(r => r.split(":")[0]))])];
	return {
		_id: stableId(c.id),
		name: c.name,
		type: "NPC",
		system: {
			advancedCals: false,
			details: { level: 0, exp: 0, size: c.size, origin: c.origin ?? "natural", type: c.type ?? "animate", other: c.other.join(", "), role: { primary: "", secondary: "companion", leader: false }, alignment: "" },
			abilities,
			attributes: { hp: { value: hp, max: hp }, init: { base: c.initiative.mode === "fixed" ? c.initiative.value : 0 } },
			defences: { ac: defence("ac"), fort: defence("fort"), ref: defence("ref"), wil: defence("wil") },
			movement,
			senses: { basic: senses.basic, special: senses.special, custom: senses.custom.join("; "), notes: "" },
			biography: bio,
			identifier: slug(c.name),
			source: { book: c.sourceCode ?? "", page: "", custom: "", revision: 1 },
		},
		prototypeToken: { name: c.name, width: tokenSize, height: tokenSize },
		items,
		flags: {
			dnd4e: {
				import: {
					origin: "iws-4e-compendium", kind: "companion", id: c.id, sourceCode: c.sourceCode, schema: COMPANION_SCHEMA_VERSION, quality: "complete", review,
					keywords: [c.category, ...(c.origin ? [cap(c.origin)] : []), ...(c.type ? [cap(c.type)] : []), ...c.other],
					companion: { hp: c.hp, defences: c.defences, initiative: c.initiative, perception: c.perception, category: c.category },
				},
			},
		},
	};
}

/** A light row for the importer's list: the monsters' shape. */
export function indexRow(actor, c, file) {
	const d = actor.system.details;
	return {
		id: c.id, _id: actor._id, name: c.name, level: null, role: "", group: "companion", leader: false, size: d.size, origin: d.origin, creatureType: d.type,
		keywords: actor.flags.dnd4e.import.keywords, xp: 0, hp: null, category: c.category,
		source: c.sourceCode, sources: c.sources, file, quality: "complete", notes: actor.flags.dnd4e.import.review, powers: c.powers.length, traits: c.traits.length,
	};
}

async function main() {
	const argv = process.argv.slice(2);
	const flag = (name, fallback) => (argv.includes(`--${name}`) ? argv[argv.indexOf(`--${name}`) + 1] : fallback);
	const here = path.dirname(fileURLToPath(import.meta.url));
	const input = path.resolve(here, flag("in", "out/parsed/companion.json"));
	const dbDir = path.resolve(here, flag("db", "out/db"));
	const parsed = JSON.parse(await readFile(input, "utf8"));
	const shards = new Map(), index = [];
	for (const c of parsed) {
		const actor = buildCompanion(c);
		const file = `${slug(c.sourceCode ?? "unknown") || "unknown"}.json`;
		if (!shards.has(file)) shards.set(file, []);
		shards.get(file).push(actor);
		index.push(indexRow(actor, c, file));
	}
	await rm(path.join(dbDir, "companion"), { recursive: true, force: true });
	await mkdir(path.join(dbDir, "companion"), { recursive: true });
	for (const [file, actors] of shards) await writeFile(path.join(dbDir, "companion", file), JSON.stringify(actors));
	await writeFile(path.join(dbDir, "companion", "_index.json"), JSON.stringify(index));
	const manifestFile = path.join(dbDir, "manifest.json");
	const manifest = JSON.parse(await readFile(manifestFile, "utf8"));
	manifest.companions = { count: index.length, files: shards.size, schema: COMPANION_SCHEMA_VERSION };
	await writeFile(manifestFile, JSON.stringify(manifest, null, 1));
	console.log(`Companions: ${index.length} actors in ${shards.size} files`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
