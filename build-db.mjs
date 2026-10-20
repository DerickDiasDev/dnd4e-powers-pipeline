/**
 * Builds the PowerData database: Foundry-ready `power` Items converted from out/parsed/power.json.
 *
 * Output (all under out/db/):
 *   manifest.json            schema version, counts, quality totals
 *   power/_index.json        light listing for search (id, name, class, level, usage, action, source, file, quality)
 *   power/<SOURCE>.json      arrays of Item data, grouped by source book code (PHB, Dra385, ...)
 *
 * Each item is plain Item data: { _id, name, type: "power", system: {...PowerData...}, flags }.
 * `system` only carries the fields the converter sets; Foundry fills every other field from the PowerData defaults.
 * `flags.dnd4e.import` keeps what the system cannot express yet (alternatives, candidate effects, review notes),
 * so a later pass (ActiveEffects, second attack, ...) does not need to parse the book text again.
 *
 * Usage: node build-db.mjs [--in out/parsed/power.json] [--out out/db] [--only power1200,power12558] [--print]
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ENUMS, EFFECT_BY_LABEL, POWER_SOURCE_BY_LOWER } from "./system-enums.mjs";

export const DB_SCHEMA_VERSION = 1;

const root = path.dirname(fileURLToPath(import.meta.url));
const ABILS = new Set(ENUMS.abilities);
const SUPPORTED_DICE = new Set(["d4", "d6", "d8", "d10", "d12", "d20"]);
const DAMAGE_KEYS = new Set(ENUMS.damageTypes);

/* -------------------------------------------- */
/*  Helpers                                     */
/* -------------------------------------------- */

const esc = s => String(s ?? "").replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

/** Deterministic 16-char Foundry document id, so re-running the build keeps ids stable. */
function stableId(seed) {
	return createHash("sha1").update(`dnd4e:power:${seed}`).digest("base64").replace(/[^A-Za-z0-9]/g, "").slice(0, 16);
}

const slug = s => String(s).toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

function fullMap(keys, trueKeys) {
	const set = new Set(trueKeys);
	return Object.fromEntries(keys.map(k => [k, set.has(k)]));
}

/* -------------------------------------------- */
/*  Class categories (power type)               */
/* -------------------------------------------- */

export async function loadClassCategories(outDir) {
	const cats = { class: "class", race: "race", paragonpath: "paragon", epicdestiny: "epic", theme: "theme" };
	const byName = new Map();
	for (const [file, powerType] of Object.entries(cats)) {
		const entries = JSON.parse(await readFile(path.join(outDir, `${file}.json`), "utf8"));
		for (const e of entries) {
			// "Cleric (Templar)" is a build of Cleric: powers are listed under the base class name.
			const name = e.listing?.Name?.replace(/\s*\(.*\)\s*$/, "").toLowerCase();
			if (name && !byName.has(name)) byName.set(name, powerType);
		}
	}
	return byName;
}

/* -------------------------------------------- */
/*  Keywords                                    */
/* -------------------------------------------- */

function convertKeywords(keywords) {
	const damage = new Set();
	const effect = new Set();
	const custom = [];
	const sources = [];
	for (const raw of keywords) {
		const k = raw.toLowerCase();
		if (POWER_SOURCE_BY_LOWER.has(k) && !sources.includes(POWER_SOURCE_BY_LOWER.get(k))) sources.push(POWER_SOURCE_BY_LOWER.get(k));
		else if (DAMAGE_KEYS.has(k) && !["damage", "ongoing", "physical"].includes(k)) {
			damage.add(k);
			if (k === "poison") effect.add("poison");
		} else if (EFFECT_BY_LABEL.has(k)) effect.add(EFFECT_BY_LABEL.get(k));
		else custom.push(raw);
	}
	return { damage, effect, custom, sources };
}

/* -------------------------------------------- */
/*  Range                                       */
/* -------------------------------------------- */

function convertRange(range, keywords, { needsWeapon = false } = {}) {
	const review = [];
	const out = { rangeType: "special", rangePower: "", area: "0", weaponType: "none", rangeText: "" };
	if (!range) review.push("range-missing");
	else {
		out.rangeText = range.raw ?? "";
		const size = range.size != null ? String(range.size) : "";
		const within = range.within != null && range.within !== "sight" ? String(range.within) : "";
		switch (range.type) {
			case "weapon": out.rangeType = "weapon"; break;
			case "melee": out.rangeType = (range.size ?? 1) > 1 ? "reach" : "melee"; out.rangePower = size; break;
			case "reach": out.rangeType = "reach"; out.rangePower = size; break;
			case "touch": out.rangeType = "touch"; break;
			case "range": out.rangeType = "range"; out.rangePower = size; break;
			case "closeBurst": out.rangeType = "closeBurst"; out.area = size; break;
			case "closeBlast": out.rangeType = "closeBlast"; out.area = size; break;
			case "rangeBurst":
				out.rangeType = "rangeBurst"; out.area = size; out.rangePower = within;
				// "within weapon range", "centered on the primary target", ...: the origin rule has no field, so the text stays in rangeText.
				if (!within) review.push(`range-origin:${range.raw}`);
				break;
			case "areaWall": out.rangeType = "wall"; out.area = size; out.rangePower = within; break;
			case "aura": out.rangeType = "closeBurst"; out.area = size; break;
			case "personal": out.rangeType = "personal"; break;
			default: review.push(`range:${range.raw}`);
		}
		if (range.within === "sight") review.push("range-sight");
	}
	const hasWeapon = keywords.some(k => k.toLowerCase() === "weapon");
	const hasImplement = keywords.some(k => k.toLowerCase() === "implement");
	// needsWeapon: the damage uses [W], which only a weapon can provide, even if the header lacks the Weapon keyword.
	if (hasWeapon || hasImplement || needsWeapon) {
		const melee = ["weapon", "melee", "reach", "touch"].includes(out.rangeType) ? "melee" : "ranged";
		if (hasImplement && !hasWeapon && !needsWeapon) out.weaponType = "implement"; // the range line ("Melee or Ranged 10") does not make an implement a weapon
		else if (range?.weaponType) out.weaponType = range.weaponType === "meleeRanged" ? "meleeRanged" : range.weaponType;
		else if (hasWeapon && hasImplement) out.weaponType = "any";
		else out.weaponType = out.rangeType === "closeBurst" || out.rangeType === "closeBlast" ? "melee" : melee;
	}
	return { out, review };
}

/* -------------------------------------------- */
/*  Damage                                      */
/* -------------------------------------------- */

/**
 * Symbolic abilities in the book text, written with the dnd4e system's own roll variables (Actor#getRollData):
 *  - "highest ability modifier"          -> @maxMod, the largest of the six (already defined by the system)
 *  - "highest mental/physical ability"   -> max() over those three modifiers (@intMod, @wisMod, @chaMod / @strMod, @dexMod, @conMod)
 *  - "primary ability"                   -> @primaryMod, the ability the player picks on the Details tab
 * The mental set is Intelligence, Wisdom and Charisma; the physical set is Strength, Dexterity and Constitution.
 */
const HIGHEST_SETS = { highest: ["str", "con", "dex", "int", "wis", "cha"], "highest-mental": ["int", "wis", "cha"], "highest-physical": ["str", "dex", "con"] };
export const highestTerm = token => (token === "highest" ? "@maxMod" : `max(${HIGHEST_SETS[token].map(k => `@${k}Mod`).join(", ")})`);
export const PRIMARY_TERM = "@primaryMod";

/**
 * One mod term (e.g. "wis" or "str|dex") as a roll-data reference.
 * @param {string} mod              A modifier token from the parser.
 * @param {string} attackAbility    The attack's ability key, or "" when the attack has none.
 * @param {string[]} review         Review notes, appended to.
 * @param {string|null} attackSymbol  The attack's first ability token ("primary", "highest", "str", ...).
 */
function modTerm(mod, attackAbility, review, attackSymbol = null) {
	if (mod in HIGHEST_SETS) return highestTerm(mod);
	if (mod === "primary") return PRIMARY_TERM;
	// A bare "ability modifier" in a power whose attack is "Primary ability" means that same ability (true of all 82 such powers).
	if (mod === "ability" && attackSymbol === "primary") return PRIMARY_TERM;
	const opts = mod.split("|");
	if (!opts.every(o => ABILS.has(o))) { review.push(`damage-mod:${mod}`); return "@powerMod"; }
	const pick = opts.includes(attackAbility) ? attackAbility : opts[0];
	if (opts.length > 1) review.push(`damage-ability-choice:${mod}`);
	return pick === attackAbility ? "@powerMod" : `@abilities.${pick}.mod`;
}

function convertDamage(d, attackAbility, usesEquipment, review, attackSymbol = null) {
	const terms = [];
	const critTerms = [];
	let baseQuantity = "0";
	let baseDiceType = "flat";
	const dice = [...d.dice];
	if (d.weapon > 0) { baseQuantity = String(d.weapon); baseDiceType = "weapon"; }
	else if (dice.length && SUPPORTED_DICE.has(`d${dice[0].faces}`)) {
		const first = dice.shift();
		baseQuantity = String(first.count); baseDiceType = `d${first.faces}`;
	} else if (!dice.length && d.flat > 0) { baseQuantity = String(d.flat); baseDiceType = "flat"; }
	const usedFlatAsBase = baseDiceType === "flat" && baseQuantity !== "0";
	for (const x of dice) { terms.push(`${x.count}d${x.faces}`); critTerms.push(String(x.count * x.faces)); }
	if (d.flat > 0 && !usedFlatAsBase) { terms.push(String(d.flat)); critTerms.push(String(d.flat)); }
	const mods = d.mods.map(m => modTerm(m, attackAbility, review, attackSymbol));
	const wep = usesEquipment ? ["@wepDamage"] : [];
	const formula = ["@powBase", ...terms, ...mods, ...wep].join(" + ");
	const critFormula = ["@powMax", ...critTerms, ...mods, ...wep, ...(usesEquipment ? ["@wepCritBonus"] : [])].join(" + ");
	return { baseQuantity, baseDiceType, formula, critFormula };
}

/* -------------------------------------------- */
/*  Item conversion                             */
/* -------------------------------------------- */

const REQUIRED_TEXT = (label, t) => (t ? `${label}: ${t}` : null);

/**
 * Converts one parsed power (or one of its children) to Item data.
 * @param {object} p            Parsed section (the power itself or a child section).
 * @param {object} base         The top-level parsed power (class, level, source, id).
 * @param {object} ctx          { categories, importId, parentId, index }
 */
export function convertSection(p, base, ctx) {
	const review = [];
	const kw = convertKeywords(p.keywords?.length ? p.keywords : base.keywords);
	const keywordList = p.keywords?.length ? p.keywords : base.keywords;
	let usesEquipment = keywordList.some(k => ["weapon", "implement"].includes(k.toLowerCase()));

	// Attack
	const variant = ctx.variant ?? null;
	const attackSource = variant && p.attack?.alternatives ? { ...p.attack, ...p.attack.alternatives.find(a => a.when === variant) } : p.attack;
	const atk = attackSource?.parsed ? attackSource : null;
	const attackAbility = atk && ABILS.has(atk.abilities[0]) ? atk.abilities[0] : "";
	// "Highest ability" and "primary ability": no single fixed ability fits attack.ability, so the attack formula carries the term itself.
	const attackSymbol = atk?.abilities[0] ?? null;
	const attackHighest = atk && attackSymbol in HIGHEST_SETS ? attackSymbol : null;
	const attackPrimary = attackSymbol === "primary";
	if (atk && !attackAbility && !attackHighest && !attackPrimary) review.push(`attack-ability:${atk.abilities.join("|")}`);
	if (atk && atk.abilities.length > 1) review.push(`attack-ability-choice:${atk.abilities.join("|")}`);
	if (atk && atk.defences.length > 1) review.push("attack-multiple-defences");

	// Damage: first plain entry of the hit (melee side when the power has a melee/ranged choice)
	// Where the damage lives varies: usually "Hit", sometimes only in "Hit (Defence)" variants or in "Effect".
	const damageSources = [["hit", p.hit], ...(p.hitVariants ?? []).map(v => [`hit-variant:${v.label}`, v]), ["effect", p.effect]];
	const [damageFrom, damageBlock] = damageSources.find(([, b]) => b?.damage?.some(d => !d.extra && !d.equalTo && !d.self)) ?? ["hit", p.hit];
	if (damageFrom !== "hit") review.push(`damage-from:${damageFrom}`);
	const damages = damageBlock?.damage ?? [];
	const candidates = damages.filter(d => !d.extra && !d.equalTo && !d.self);
	const primary = (variant
		? (candidates.find(d => d.when === variant) ?? candidates.find(d => !d.when))
		: candidates.find(d => !d.when || d.when === "melee")) ?? null;
	// When the power is split into melee/ranged items, the other side is its own item, not an alternative.
	const alternatives = variant ? [] : damages.filter(d => d !== primary && d.when === "ranged");
	const extraDamage = damages.filter(d => d !== primary && (variant ? !d.when : d.when !== "ranged"));
	let dmg = null;
	let damageKeys = [];
	// [W] needs a weapon whatever the keywords say (e.g. a stance's attack power without the Weapon keyword).
	const needsWeapon = (primary?.weapon ?? 0) > 0;
	if (needsWeapon) usesEquipment = true;
	if (primary) {
		dmg = convertDamage(primary, attackAbility, usesEquipment, review, attackSymbol);
		const explicit = primary.types ?? [];
		const inferred = primary.typesFromKeywords ?? [];
		damageKeys = (explicit.length ? explicit : inferred).filter(t => DAMAGE_KEYS.has(t));
		if (primary.typesAmbiguous && !explicit.length) review.push("damage-type-poison-ambiguous");
	}
	if (p.unparsed?.some(u => u === "damage:unparsed" || u.endsWith(":damage:unparsed"))) review.push("damage-unparsed");

	// Range / target
	const { out: range, review: rangeReview } = convertRange(p.range, keywordList, { needsWeapon });
	review.push(...rangeReview);
	if (variant && ["meleeRanged", "melee", "ranged"].includes(range.weaponType)) {
		range.weaponType = variant;
		range.rangeText = `${variant === "melee" ? "Melee" : "Ranged"} weapon`;
	}
	const areaPower = ["closeBurst", "closeBlast", "rangeBurst", "rangeBlast", "wall"].includes(range.rangeType);
	let autoMode = "none";
	if (areaPower && p.target) {
		const t = p.target.toLowerCase();
		autoMode = /\benem(?:y|ies)\b/.test(t) ? "enemies" : /\ball(?:y|ies)\b/.test(t) && !/\bcreature/.test(t) ? "allies" : /\bcreatures?\b/.test(t) ? "all" : "none";
	}

	// Class category -> powerType
	const className = base.class ?? "";
	let powerType = base.racial ? "race" : (ctx.categories.get(className.toLowerCase()) ?? null);
	if (!powerType && /^feat power$/i.test(className)) powerType = "feat";
	if (!powerType && /^skill power\b/i.test(className)) powerType = "skill";
	if (!powerType) { powerType = "other"; if (className) review.push(`power-type-unknown:${className}`); }
	if (base.kind === "feature" && powerType === "other") powerType = "class";

	// Free text blocks that have no structured home yet
	const specialParts = [];
	if (p.secondary) {
		const s = p.secondary;
		specialParts.push(...[
			REQUIRED_TEXT("Secondary Target", s.target), REQUIRED_TEXT("Secondary Attack", s.attack?.text),
			REQUIRED_TEXT("Secondary Hit", s.hit?.text), REQUIRED_TEXT("Secondary Miss", s.miss?.text), REQUIRED_TEXT("Secondary Effect", s.effect?.text),
		].filter(Boolean));
	}
	for (const v of p.hitVariants ?? []) specialParts.push(`Hit (${v.label}): ${v.text}`);
	if (p.aftereffect) specialParts.push(`Aftereffect: ${p.aftereffect.text}`);
	for (const e of p.extra ?? []) specialParts.push(`${e.label}: ${e.text}`);

	const hitDetail = [p.hit?.text, ...(p.scaling ?? []).filter(s => s.field === "hit").map(s => `Level ${s.levels.join("/")}: ${s.text}`)].filter(Boolean).join("\n");

	const system = {
		level: base.level ?? null,
		powersource: kw.sources[0] ?? "",
		secondPowersource: kw.sources[1] ?? "",
		powersourceName: className,
		powerType,
		powerSubtype: ENUMS.powerSubtype.includes(p.kind ?? base.kind) ? (p.kind ?? base.kind) : "other",
		useType: ENUMS.useType.includes(p.usage) ? p.usage : "other",
		actionType: ENUMS.actionType.includes(p.action) ? p.action : "none",
		weaponType: range.weaponType,
		weaponUse: "default",
		rangeType: range.rangeType,
		rangePower: range.rangePower,
		area: range.area,
		rangeText: range.rangeText,
		autoTarget: { mode: autoMode, includeSelf: /\byou\b/i.test(p.target ?? "") },
		target: p.target ?? "",
		trigger: p.trigger ?? "",
		requirement: p.requirement ?? "",
		requirements: p.prerequisite ?? "",
		special: p.special_text ?? "",
		specialAdd: { parts: specialParts },
		keywordsCustom: kw.custom.join(";"),
		damageType: fullMap(ENUMS.damageTypes, [...kw.damage, ...damageKeys]),
		effectType: fullMap(ENUMS.effectTypes, [...kw.effect, ...(p.range?.type === "aura" ? ["aura"] : [])]),
		sustain: { actionType: ENUMS.actionType.includes(p.sustain?.action) ? p.sustain.action : "", detail: p.sustain?.text ?? "" },
		attack: {
			isAttack: Boolean(atk),
			ability: attackAbility,
			def: atk ? atk.defences[0] : "ac",
			detail: atk?.text ?? "",
			// attack.abilityBonus exists in the schema but nothing reads it; the roll uses attack.formula only.
			...(atk && (atk.bonus || attackHighest || attackPrimary)
				? { formula: `@wepAttack + ${attackHighest ? highestTerm(attackHighest) : attackPrimary ? PRIMARY_TERM : "@powerMod"} + @lvhalf${atk.bonus ? ` + ${atk.bonus}` : ""}` }
				: {}),
		},
		hit: {
			isDamage: Boolean(primary),
			detail: hitDetail,
			...(dmg ? { baseQuantity: dmg.baseQuantity, baseDiceType: dmg.baseDiceType, formula: dmg.formula, critFormula: dmg.critFormula } : {}),
			// Close/area powers roll damage once for every target (Rules Compendium, p. 103-104).
			shareDamageRoll: areaPower,
		},
		miss: { halfDamage: Boolean(p.miss?.half), detail: p.miss?.text ?? "" },
		effect: { detail: p.effect?.text ?? "" },
		description: { value: base.flavor ? `<p><em>${esc(base.flavor)}</em></p>` : "" },
		source: { book: base.published?.book ?? "", page: base.published?.pages ?? "", custom: "", revision: 1 },
		identifier: slug(`${p.name ?? base.name}${variant ? `-${variant}` : ""}`),
	};

	const flags = {
		dnd4e: {
			import: {
				origin: "iws-4e-compendium",
				id: base.id,
				sourceCode: base.sourceCode ?? null,
				schema: DB_SCHEMA_VERSION,
				quality: base.quality,
				review: [...new Set(review)],
				unparsed: p.unparsed ?? [],
				role: ctx.role,
				bundle: ctx.bundle,
				// Which parsed section this item came from: null = the power itself, n = parsed.children[n].
				section: ctx.role === "child" ? ctx.index - 1 : null,
				...(variant ? { variant } : {}),
				...(alternatives.length ? { alternatives } : {}),
				...(extraDamage.length ? { extraDamage } : {}),
				...(p.hit?.ongoing?.length || p.effect?.ongoing?.length ? { ongoing: [...(p.hit?.ongoing ?? []), ...(p.effect?.ongoing ?? [])] } : {}),
				// Candidate effects for the ActiveEffect pass; not applied automatically.
				candidates: {
					conditions: ["hit", "miss", "effect", "aftereffect"].flatMap(k => p[k]?.conditions ?? []),
					resistances: ["hit", "miss", "effect", "aftereffect"].flatMap(k => p[k]?.resistances ?? []),
					movement: ["hit", "miss", "effect", "aftereffect"].flatMap(k => p[k]?.movement ?? []),
				},
				...(p.scaling?.length ? { scaling: p.scaling } : {}),
			},
		},
	};

	return {
		_id: stableId(ctx.role === "main" ? base.id : `${base.id}:${ctx.index}`),
		name: `${p.name ?? base.name}${variant ? ` (${variant === "melee" ? "Melee" : "Ranged"})` : ""}`,
		type: "power",
		system,
		flags,
	};
}

/** A power needs a melee and a ranged version when the attack or the damage differs between them. */
export function needsVariantSplit(parsed) {
	if (parsed.attack?.alternatives) return true;
	return [parsed.hit, parsed.miss, parsed.effect, parsed.aftereffect, ...(parsed.hitVariants ?? [])].some(b => b?.damage?.some(d => d.when));
}

/**
 * One parsed power -> the items to import together (a "bundle"):
 *   main      the power itself (the melee version when it is split)
 *   variant   the ranged version of a split melee/ranged power
 *   child     extra parts of the power (secondary attack, second technique, ...)
 */
export function convertPower(parsed, ctx) {
	if (!parsed.usage && parsed.quality === "text") return [];
	const split = needsVariantSplit(parsed);
	const main = convertSection(parsed, parsed, { ...ctx, role: "main", variant: split ? "melee" : null, bundle: null, index: 0 });
	main.flags.dnd4e.import.bundle = main._id;
	const items = [main];
	if (split) items.push(convertSection(parsed, parsed, { ...ctx, role: "variant", variant: "ranged", bundle: main._id, index: "ranged" }));
	(parsed.children ?? []).forEach((child, i) => {
		items.push(convertSection(child, parsed, { ...ctx, role: "child", variant: null, bundle: main._id, index: i + 1 }));
	});
	return items;
}

/* -------------------------------------------- */
/*  CLI                                         */
/* -------------------------------------------- */

async function main() {
	const argv = process.argv.slice(2);
	const get = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
	const inFile = path.resolve(get("in", path.join(root, "out", "parsed", "power.json")));
	const outDir = path.resolve(get("out", path.join(root, "out", "db")));
	const only = get("only") ? new Set(get("only").split(",")) : null;

	const parsed = JSON.parse(await readFile(inFile, "utf8")).filter(p => !only || only.has(p.id));
	const categories = await loadClassCategories(path.join(root, "out"));

	const bySource = new Map();
	const index = [];
	const stats = { powers: 0, items: 0, children: 0, variants: 0, review: {}, quality: {}, powerType: {} };
	for (const p of parsed) {
		const items = convertPower(p, { categories });
		if (!items.length) continue;
		stats.powers++;
		stats.quality[p.quality] = (stats.quality[p.quality] ?? 0) + 1;
		const sourceFile = slug(p.sourceCode ?? "unknown") || "unknown";
		if (!bySource.has(sourceFile)) bySource.set(sourceFile, []);
		for (const item of items) {
			bySource.get(sourceFile).push(item);
			stats.items++;
			if (item.flags.dnd4e.import.role === "child") stats.children++;
			if (item.flags.dnd4e.import.role === "variant") stats.variants++;
			stats.powerType[item.system.powerType] = (stats.powerType[item.system.powerType] ?? 0) + 1;
			for (const r of item.flags.dnd4e.import.review) { const k = r.split(":")[0]; stats.review[k] = (stats.review[k] ?? 0) + 1; }
		}
		const m = items[0];
		index.push({
			id: p.id, _id: m._id, name: p.name, class: p.class, powerType: m.system.powerType, level: m.system.level, kind: m.system.powerSubtype,
			usage: m.system.useType, action: m.system.actionType, source: p.sourceCode, file: `${sourceFile}.json`, quality: p.quality,
			review: m.flags.dnd4e.import.review.length,
			// Importing a power imports every item in `items` (main + melee/ranged variant + children), in this order.
			items: items.map(i => i._id),
			variants: items.filter(i => i.flags.dnd4e.import.variant).map(i => i.flags.dnd4e.import.variant),
			children: items.filter(i => i.flags.dnd4e.import.role === "child").length,
		});
	}

	if (argv.includes("--print")) { console.log(JSON.stringify([...bySource.values()].flat(), null, 1)); return; }

	await rm(path.join(outDir, "power"), { recursive: true, force: true });
	await mkdir(path.join(outDir, "power"), { recursive: true });
	for (const [file, items] of bySource) await writeFile(path.join(outDir, "power", `${file}.json`), JSON.stringify(items));
	await writeFile(path.join(outDir, "power", "_index.json"), JSON.stringify(index));
	await writeFile(path.join(outDir, "manifest.json"), JSON.stringify({
		schema: DB_SCHEMA_VERSION, builtAt: new Date().toISOString(), type: "power", files: [...bySource.keys()].length, ...stats,
	}, null, 1));

	console.log(`DB: ${stats.powers} powers -> ${stats.items} items (${stats.children} children) in ${bySource.size} files -> ${outDir}`);
	console.log("powerType:", stats.powerType);
	console.log("review flags:", Object.fromEntries(Object.entries(stats.review).sort((a, b) => b[1] - a[1])));
}

if (import.meta.url === new URL(`file:///${process.argv[1]?.replace(/\\/g, "/")}`).href) main().catch(e => { console.error(e); process.exit(1); });
