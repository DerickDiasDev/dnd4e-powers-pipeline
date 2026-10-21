/**
 * Builds the monster part of the database (out/db/monster/) from out/parsed/monster.json.
 *
 * A monster is a Foundry NPC Actor with its powers and traits as embedded items:
 *   - the stat block goes into the fields the NPC sheet shows when "advanced calculations" are off, where every number is the
 *     printed number: defences.<d>.base, attributes.init.base, skills.<k>.base, attributes.hp.max, movement
 *   - each power is a \`power\` item with the attack bonus and the damage written as fixed numbers (attack.formula "6",
 *     hit.formula "1d12 + 11"), the text kept in detail fields; conditions and ongoing damage become effects like the player powers
 *   - each trait is a \`feature\` item of type trait (an aura keeps its size)
 *
 * Output: out/db/monster/_index.json (light rows) and out/db/monster/<SOURCE>.json (actors). Run after build-db.mjs.
 *
 * Usage: node build-monsters.mjs [--in out/parsed/monster.json] [--db out/db]
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { convertKeywords, convertRange } from "./build-db.mjs";
import { analyze, parseRange } from "./parse-powers.mjs";
import { buildEffects } from "./build-effects.mjs";
import { ENUMS, STATUS_IMG } from "./system-enums.mjs";

export const MONSTER_SCHEMA_VERSION = 1;

const esc = s => String(s ?? "").replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
const slug = s => String(s).toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const stableId = seed => createHash("sha1").update(`dnd4e:monster:${seed}`).digest("base64").replace(/[^A-Za-z0-9]/g, "").slice(0, 16);
const paragraphs = text => String(text).split("\n").filter(Boolean).map(l => `<p>${esc(l)}</p>`).join("");
const fullMap = (keys, on) => Object.fromEntries(keys.map(k => [k, on.has(k)]));

/** The ability each skill uses (CONFIG.DND4E.skills). Skills the stat block does not list are half the level plus that modifier. */
const SKILL_ABILITY = Object.freeze({ acr: "dex", arc: "int", ath: "str", blu: "cha", dip: "cha", dun: "wis", end: "con", hea: "wis", his: "int", ins: "wis", itm: "cha", nat: "wis", prc: "wis", rel: "int", stl: "dex", stw: "cha", thi: "dex" });
const GROUP = Object.freeze({ standard: "standard", elite: "elite", solo: "solo", minion: "minion", conjured: "companion" });
const TOKEN_SIZE = Object.freeze({ tiny: 1, sm: 1, med: 1, lg: 2, huge: 3, grg: 4 });
const abilityMod = score => Math.floor((score - 10) / 2);

/** The sense and its range from the senses text: "Darkvision", "low-light vision", "blindsight 10", "tremorsense 5". */
export function sensesOf(text) {
	const t = String(text ?? "").toLowerCase();
	const out = { basic: "nv", special: {}, custom: [] };
	if (/darkvision/.test(t)) out.basic = "dv";
	else if (/low-?light/.test(t)) out.basic = "lv";
	for (const [word, key] of [["blindsight", "bs"], ["tremorsense", "ts"], ["truesight", "tr"]]) {
		const m = t.match(new RegExp(`${word}\\s*(\\d+)?`));
		if (m) out.special[key] = { value: true, range: m[1] ? Number(m[1]) : null };
	}
	for (const part of String(text ?? "").split(/\s*[;,]\s*/)) {
		const w = part.trim();
		if (w && !/^(?:darkvision|low-?light(?: vision)?|blindsight|tremorsense|truesight)\b/i.test(w) && !/^perception\b/i.test(w)) out.custom.push(w);
	}
	return out;
}

/** "5 cold, 10 fire" -> { cold: 5, fire: 10 }; "5 cold, insubstantial" -> the typed part and the rest as text. */
export function resistancesOf(text) {
	const typed = {}, other = [];
	for (const part of String(text ?? "").split(/\s*[;,]\s*/).map(s => s.trim()).filter(Boolean)) {
		const m = part.match(/^(\d+)\s+(all|[a-z]+)(?:\s+damage)?$/i);
		if (m && (m[2].toLowerCase() === "all" || ENUMS.damageTypes.includes(m[2].toLowerCase()))) {
			for (const t of m[2].toLowerCase() === "all" ? ENUMS.damageTypes : [m[2].toLowerCase()]) typed[t] = Math.max(typed[t] ?? 0, Number(m[1]));
		} else other.push(part);
	}
	return { typed, other };
}

/** Immunities: damage types ("poison") become the immune flag of that type, the rest ("disease") stay as text. */
export function immunitiesOf(text) {
	const types = [], other = [];
	for (const part of String(text ?? "").split(/\s*[;,]\s*/).map(s => s.trim().replace(/\.$/, "")).filter(Boolean)) {
		const w = part.toLowerCase().replace(/\s+damage$/, "");
		if (ENUMS.damageTypes.includes(w) && !["damage", "ongoing"].includes(w)) types.push(w);
		else other.push(part);
	}
	return { types, other };
}

const SPOKEN = Object.freeze({ common: "Common", abyssal: "Abyssal", "deep speech": "DeepSpeech", draconic: "Draconic", dwarven: "Dwarven", elven: "Elven", giant: "Giant", goblin: "Goblin", primordial: "Primordial", supernal: "Supernal" });
export function languagesOf(text) {
	const spoken = [], custom = [];
	for (const part of String(text ?? "").split(/\s*[,;]\s*/).map(s => s.trim()).filter(s => s && s !== "-")) (SPOKEN[part.toLowerCase()] ? spoken : custom).push(SPOKEN[part.toLowerCase()] ?? part);
	return { spoken, custom };
}

/* -------------------------------------------- */
/*  Powers                                      */
/* -------------------------------------------- */

/** "1d12+11" -> { formula: "1d12 + 11", crit: "12 + 11", dice: {quantity, die}|null }; "4" -> { formula: "4", crit: "4" }. */
export function damageOf(expr) {
	if (!expr) return null;
	const m = String(expr).replace(/\s+/g, "").match(/^(?:(\d+)d(\d+))?([+-]\d+)?$|^(\d+)$/);
	if (!m) return null;
	if (m[4] !== undefined) return { formula: m[4], crit: m[4], dice: null };
	const flat = m[3] ? Number(m[3]) : 0;
	if (!m[1]) return flat ? { formula: String(flat), crit: String(flat), dice: null } : null;
	const q = Number(m[1]), d = Number(m[2]);
	const tail = flat ? ` ${flat < 0 ? "-" : "+"} ${Math.abs(flat)}` : "";
	return { formula: `${q}d${d}${tail}`, crit: `${q * d}${tail}`, dice: { quantity: q, die: d } };
}

function damageTypesIn(text) {
	return ENUMS.damageTypes.filter(t => !["damage", "ongoing", "physical"].includes(t) && new RegExp(`\\b${t}\\b`, "i").test(text));
}

/**
 * The monster's own name in its text ("until the end of the brute's next turn") is its user, "you", for the reader of effects:
 * the duration and who is affected depend on it.
 */
export function selfify(text, name) {
	const words = String(name).toLowerCase().replace(/,.*$/, "").split(/\s+/).filter(w => w.length > 2);
	const names = [...new Set([words.join(" "), words.at(-1)].filter(Boolean))].sort((a, b) => b.length - a.length);
	let out = String(text);
	for (const n of names) out = out.replace(new RegExp(`\\bthe ${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:'s)?\\b`, "gi"), (m) => (m.endsWith("'s") ? "your" : "you"));
	return out;
}

/** The section shape buildEffects reads, made from the text of a power's lines. */
function effectSection(lines) {
	const of = labels => lines.filter(l => labels.test(l.label)).map(l => l.text).join("\n");
	const make = text => ({ text, ...analyze(text) });
	const attackLine = lines.find(l => !l.label)?.text ?? "";
	// The old layout puts attack and hit in one line: "+6 vs AC; 1d8 damage, and the target is dazed (save ends)."
	const hit = of(/^hit$/i) || attackLine.split(/vs\.?\s+(?:AC|Fortitude|Reflex|Will)\s*;?/i)[1] || "";
	return { hit: make(hit), miss: make(of(/^miss$/i)), effect: make(of(/^effect$/i) || (lines.some(l => /^hit$/i.test(l.label)) || attackLine ? "" : attackLine)) };
}

export function convertPowerItem(m, p, index) {
	const itemId = stableId(`${m.id}:power:${index}`);
	const kw = convertKeywords(p.keywords.filter(k => !/^(?:weapon|implement)$/i.test(k)));
	// The old pages leave the range out of a plain melee attack; its symbol says it is one (a melee attack reaches 1 square).
	const rangeText = p.attack.range ?? (p.icon === "⚔" && p.attack.bonus !== null ? "Melee 1" : "");
	const rangeParsed = rangeText ? parseRange(rangeText) : null;
	const { out: range } = convertRange(rangeParsed, [], {});
	const dmg = damageOf(p.attack.damage);
	const lines = p.lines;
	const byLabel = re => lines.filter(l => re.test(l.label)).map(l => l.text).join("\n");
	const textOf = l => `${l.label ? `${l.label}: ` : ""}${l.text}`;
	const damageKeys = new Set([...kw.damage, ...damageTypesIn(byLabel(/^hit$/i) || lines.map(l => l.text).join(" "))]);
	const isAttack = p.attack.bonus !== null && p.attack.defence !== null;
	const used = new Set(["attack", "hit", "miss", "effect", "trigger", "requirement", "target"]);
	const extra = lines.filter(l => l.label && !used.has(l.label.toLowerCase()));
	const hitText = byLabel(/^hit$/i) || (isAttack ? (lines.find(l => !l.label)?.text.split(/vs\.?\s+(?:AC|Fortitude|Reflex|Will)\s*;?/i)[1] ?? "").trim() : "");
	const plain = lines.find(l => !l.label)?.text ?? "";

	const system = {
		level: m.level,
		powersource: kw.sources[0] ?? "",
		secondPowersource: kw.sources[1] ?? "",
		powersourceName: m.name,
		powerType: "other",
		powerSubtype: isAttack ? "attack" : "utility",
		useType: ENUMS.useType.includes(p.usage) ? p.usage : "other",
		actionType: ENUMS.actionType.includes(p.action) ? p.action : "none",
		weaponType: "none", // a monster's attack is a printed number: no weapon or implement to ask for
		weaponUse: "default",
		rangeType: range.rangeType,
		rangePower: range.rangePower,
		area: range.area,
		rangeText,
		autoTarget: { mode: "none", includeSelf: false },
		target: p.attack.target ?? byLabel(/^target$/i),
		trigger: byLabel(/^trigger$/i),
		requirement: byLabel(/^requirement$/i),
		special: p.limit ? p.limit : "",
		specialAdd: { parts: extra.map(textOf) },
		keywordsCustom: kw.custom.join(";"),
		damageType: fullMap(ENUMS.damageTypes, damageKeys),
		effectType: fullMap(ENUMS.effectTypes, new Set([...kw.effect, ...(m.traits.some(() => false) ? [] : [])])),
		sustain: { actionType: "", detail: "" },
		attack: {
			isAttack,
			ability: "",
			def: p.attack.defence ?? "ac",
			detail: byLabel(/^attack$/i) || (isAttack ? plain.split(/;/)[0] : ""),
			...(isAttack ? { formula: String(p.attack.bonus) } : {}),
		},
		hit: {
			isDamage: Boolean(dmg),
			detail: hitText,
			...(dmg ? { formula: dmg.formula, critFormula: dmg.crit } : {}),
			shareDamageRoll: ["closeBurst", "closeBlast", "rangeBurst", "rangeBlast", "wall"].includes(range.rangeType),
		},
		miss: { halfDamage: /half damage/i.test(byLabel(/^miss$/i)), detail: byLabel(/^miss$/i) },
		effect: { detail: byLabel(/^effect$/i) || (isAttack || lines.some(l => /^hit$/i.test(l.label)) ? "" : plain) },
		description: { value: p.recharge ? `<p><em>Recharge ${p.recharge.join(", ")}</em></p>` : "" },
		source: { book: m.sourceCode ?? "", page: "", custom: "", revision: 1 },
		identifier: slug(`${p.name}-${index}`),
	};

	const { effects, unresolved } = buildEffects(effectSection(lines.map(l => ({ ...l, text: selfify(l.text, m.name) }))), { itemId, img: id => STATUS_IMG[id], damageTypes: ENUMS.damageTypes });
	const gaps = unresolved.filter(g => g.why !== "not-applied");
	const review = [];
	if (!isAttack && /\bvs\.?\s+(?:AC|Fortitude|Reflex|Will)\b/i.test(lines.map(l => l.text).join(" "))) review.push("attack-unparsed");
	if (p.attack.damage && !dmg) review.push("damage-unparsed");
	if (gaps.length) review.push(`effect-unresolved:${gaps.length}`);
	return {
		_id: itemId,
		name: p.name,
		type: "power",
		system,
		flags: { dnd4e: { import: { origin: "iws-4e-compendium", kind: "monster-power", id: m.id, schema: MONSTER_SCHEMA_VERSION, section: index, review, ...(p.recharge ? { recharge: p.recharge } : {}) } } },
		effects,
	};
}

export function convertTraitItem(m, t, index) {
	const itemId = stableId(`${m.id}:trait:${index}`);
	const aura = t.text.match(/\baura\s*(\d+)/i)?.[1] ?? null;
	return {
		_id: itemId,
		name: t.name,
		type: "feature",
		system: {
			description: { value: paragraphs(t.text) },
			featureType: "trait",
			level: null,
			requirements: "",
			featureSource: m.name,
			featureGroup: "",
			auraSize: aura ?? "",
			keywordsCustom: (t.keywords ?? []).join(";"),
			source: { book: m.sourceCode ?? "", page: "", custom: "", revision: 1 },
		},
		flags: { dnd4e: { import: { origin: "iws-4e-compendium", kind: "monster-trait", id: m.id, schema: MONSTER_SCHEMA_VERSION, section: index } } },
		effects: [],
	};
}

/* -------------------------------------------- */
/*  The actor                                   */
/* -------------------------------------------- */

export function buildMonster(m) {
	const review = [...m.notes];
	const level = m.level ?? 0;
	const halfLevel = Math.floor(level / 2);
	const senses = sensesOf(m.stats.senses);
	const resist = resistancesOf(m.stats.resist);
	const vuln = resistancesOf(m.stats.vulnerable);
	const immune = immunitiesOf(m.stats.immune);
	const languages = languagesOf(m.languages);

	const abilities = {};
	// A printed score of 0 (a mindless creature's) is not a score: take it from the printed modifier.
	for (const k of ["str", "con", "dex", "int", "wis", "cha"]) {
		const printed = m.abilities[k];
		abilities[k] = { value: printed ? (printed.score >= 1 ? printed.score : Math.max(1, 10 + 2 * printed.mod)) : 10 };
	}
	const skills = {};
	for (const [k, ability] of Object.entries(SKILL_ABILITY)) {
		const printed = k === "prc" && m.stats.perception !== null ? m.stats.perception : m.skills[k];
		skills[k] = { base: printed ?? abilityMod(abilities[ability].value) + halfLevel };
	}

	const resistances = {};
	for (const [t, n] of Object.entries(resist.typed)) resistances[t] = { ...(resistances[t] ?? {}), res: n };
	for (const [t, n] of Object.entries(vuln.typed)) resistances[t] = { ...(resistances[t] ?? {}), vuln: -n };
	for (const t of immune.types) resistances[t] = { ...(resistances[t] ?? {}), immune: true };

	const movement = { base: { base: m.stats.speed?.walk ?? 0 } };
	for (const [mode, n] of Object.entries(m.stats.speed?.modes ?? {})) movement[mode] = { formula: String(n) };

	const system = {
		advancedCals: false,
		details: {
			level,
			exp: m.xp ?? 0,
			size: m.size ?? "med",
			origin: m.origin ?? "natural",
			type: m.creatureType ?? "humanoid",
			other: m.extraKeywords.join(", "),
			role: { primary: m.role ?? "", secondary: GROUP[m.group] ?? "standard", leader: m.leader },
			alignment: m.alignment ?? "",
			...(m.stats.saves ? { saves: { untyped: m.stats.saves } } : {}),
		},
		abilities,
		attributes: { hp: { value: Math.max(1, m.stats.hp ?? 1), max: Math.max(1, m.stats.hp ?? 1) }, init: { base: m.stats.initiative ?? 0 } },
		defences: Object.fromEntries(Object.entries(m.stats.defences).map(([k, v]) => [k, { base: v ?? 10 }])),
		skills,
		movement,
		senses: { basic: senses.basic, special: senses.special, custom: senses.custom.join("; "), notes: m.stats.perception !== null ? `Perception ${m.stats.perception >= 0 ? "+" : ""}${m.stats.perception}` : "" },
		languages: { spoken: { value: languages.spoken, custom: languages.custom.join("; ") } },
		resistances,
		untypedResistances: { resistances: resist.other, vulnerabilities: vuln.other, immunities: immune.other },
		...(m.stats.actionPoints ? { actionpoints: { value: m.stats.actionPoints } } : {}),
		biography: m.description ? `<p>${esc(m.description)}</p>` : "",
		identifier: slug(m.name),
		source: { book: m.sourceCode ?? "", page: "", custom: "", revision: 1 },
	};

	const items = [];
	m.powers.forEach((p, i) => items.push(convertPowerItem(m, p, i)));
	m.traits.forEach((t, i) => items.push(convertTraitItem(m, t, i)));
	for (const item of items) for (const r of item.flags.dnd4e.import.review ?? []) if (!review.includes(r.split(":")[0])) review.push(r.split(":")[0]);
	if (m.group === "conjured") review.push("conjured");
	// "HP 0": the stat block says something else ("infinite hit points", "your bloodied value"); the actor needs at least 1.
	if (!m.stats.hp) review.push("hp-special");
	if (m.stats.minionNote) review.push("minion");
	if (m.stats.initiative === null && /as conjurer/i.test(m.typeLine)) review.push("initiative-conjurer");

	const tokenSize = TOKEN_SIZE[system.details.size] ?? 1;
	return {
		_id: stableId(m.id),
		name: m.name,
		type: "NPC",
		system,
		prototypeToken: { name: m.name, width: tokenSize, height: tokenSize },
		items,
		flags: { dnd4e: { import: { origin: "iws-4e-compendium", kind: "monster", id: m.id, sourceCode: m.sourceCode, schema: MONSTER_SCHEMA_VERSION, quality: m.quality, review: [...new Set(review)], keywords: m.listingKeywords } } },
	};
}

/** A light row for the importer's list. */
export function indexRow(actor, m, file) {
	const d = actor.system.details;
	return {
		id: m.id, _id: actor._id, name: m.name, level: m.level, role: m.role, group: m.group, leader: m.leader, size: d.size, origin: m.origin, creatureType: m.creatureType,
		keywords: [...new Set([...(m.listingKeywords ?? []), ...m.extraKeywords.map(k => k[0].toUpperCase() + k.slice(1))])], xp: m.xp, hp: m.stats.hp,
		source: m.sourceCode, sources: m.sources, file, quality: m.quality, notes: actor.flags.dnd4e.import.review, powers: m.powers.length, traits: m.traits.length,
	};
}

async function main() {
	const argv = process.argv.slice(2);
	const flag = (name, fallback) => (argv.includes(`--${name}`) ? argv[argv.indexOf(`--${name}`) + 1] : fallback);
	const here = path.dirname(fileURLToPath(import.meta.url));
	const input = path.resolve(here, flag("in", "out/parsed/monster.json"));
	const dbDir = path.resolve(here, flag("db", "out/db"));
	const monsters = JSON.parse(await readFile(input, "utf8"));
	const shards = new Map(), index = [];
	for (const m of monsters) {
		const actor = buildMonster(m);
		const file = `${slug(m.sourceCode ?? "unknown") || "unknown"}.json`;
		if (!shards.has(file)) shards.set(file, []);
		shards.get(file).push(actor);
		index.push(indexRow(actor, m, file));
	}
	await rm(path.join(dbDir, "monster"), { recursive: true, force: true });
	await mkdir(path.join(dbDir, "monster"), { recursive: true });
	for (const [file, actors] of shards) await writeFile(path.join(dbDir, "monster", file), JSON.stringify(actors));
	await writeFile(path.join(dbDir, "monster", "_index.json"), JSON.stringify(index));
	const manifestFile = path.join(dbDir, "manifest.json");
	const manifest = JSON.parse(await readFile(manifestFile, "utf8"));
	manifest.monsters = { count: index.length, files: shards.size, schema: MONSTER_SCHEMA_VERSION };
	await writeFile(manifestFile, JSON.stringify(manifest, null, 1));
	const notes = {};
	for (const r of index) for (const n of r.notes) notes[n] = (notes[n] ?? 0) + 1;
	console.log(`Monsters: ${index.length} actors in ${shards.size} files; notes:`, notes);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
