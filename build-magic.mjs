/**
 * Builds the magic item part of the database (out/db/magic/) from out/parsed/magic.json.
 *
 * What each parsed item becomes in Foundry:
 *   - Weapon      -> `weapon` item, enhancement bonus on `enhance`. The page only names a group ("Maces", "Any melee"), not a
 *                    weapon, so the item has no damage dice; the importer lets the player pick the weapon it is based on
 *                    (`base` in the index row says which weapons fit).
 *   - Armor       -> `equipment` (armour or shield) with the enhancement bonus; when the page names one kind of armour, the
 *                    base bonus and penalties of that armour are filled in.
 *   - Implement   -> `weapon` of type implement, enhancement bonus on `enhance`.
 *   - Neck, Head, Feet, Hands, Waist, Ring, Arms -> `equipment` of that slot. Wondrous items -> `equipment` of type other
 *                    (so they can be equipped). Alternative rewards -> `equipment` of type alternative.
 *   - Consumable  -> `consumable`. Familiar, mount, companion, lair, item set -> `loot`.
 *
 * An item that exists at several levels is one entry with `tiers` ({level, enhancement, price}); the item data is built at the
 * first tier and the importer patches level, enhancement and price for the tier the player picks.
 * Standing bonuses written in a Property section become effects that transfer, and are suppressed while the item is not
 * equipped. Powers stay in the description (their numbers change with the level).
 *
 * Output: out/db/magic/_index.json (light rows) and out/db/magic/<BOOK>.json (entries with items).
 * Run after build-gear.mjs, which resets nothing but needs manifest.json.
 *
 * Usage: node build-magic.mjs [--in out/parsed/magic.json] [--gear out/parsed/gear.json] [--db out/db]
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { attachFeatureEffects } from "./build-effects.mjs";
import { findBase, GROUP_KEYS, IMPLEMENT_KEYS } from "./build-gear.mjs";
import { ENUMS } from "./system-enums.mjs";

export const MAGIC_SCHEMA_VERSION = 1;

const esc = s => String(s ?? "").replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
const stableId = seed => createHash("sha1").update(`dnd4e:magic:${seed}`).digest("base64").replace(/[^A-Za-z0-9]/g, "").slice(0, 16);
const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "other";

/** The slot items: category -> the equipment type of the sheet. */
const SLOT_TYPES = { Arms: "arms", Feet: "feet", Hands: "hands", Head: "head", "Head and Neck": "head", Neck: "neck", Ring: "ring", Waist: "waist", Wondrous: "other" };
const LOOT_CATEGORIES = new Set(["Familiar", "Mount", "Companion", "Lair", "Item Set"]);
const ALT_WORDS = ["blessing", "boon", "brand", "echo", "gift", "rune", "scar", "secret", "talent", "training"];
const CONSUMABLE_TYPES = { "alchemical item": "alchemical", potion: "potion", poison: "poison", food: "food", scroll: "scroll", "ritual scroll": "scroll" };

/** Armour kinds: the page's name -> the mundane PHB entry that gives its numbers, and the sheet's subtype/base type. */
const ARMOUR_KINDS = {
	cloth: { entry: "Cloth Armor (Basic Clothing)", subtype: "light", base: "cloth" },
	leather: { entry: "Leather Armor", subtype: "light", base: "leather" },
	hide: { entry: "Hide Armor", subtype: "light", base: "hide" },
	chain: { entry: "Chainmail", subtype: "heavy", base: "chain" },
	scale: { entry: "Scale Armor", subtype: "heavy", base: "scale" },
	plate: { entry: "Plate Armor", subtype: "heavy", base: "plate" },
	"light shield": { entry: "Light Shield", shield: "light" },
	"heavy shield": { entry: "Heavy Shield", shield: "heavy" },
};

const splitChoices = text => String(text ?? "").toLowerCase().split(/\s*(?:,|\bor\b)\s*/).map(s => s.trim()).filter(Boolean);

/** What the page says the item enchants: { kind, groups[], any, name } for the importer's "based on" picker, or null. */
export function baseOf(m) {
	const type = m.type;
	if (m.category === "Weapon") {
		const parts = splitChoices(type);
		const named = parts.length === 1 ? findBase(type) : null;
		const groups = parts.map(p => GROUP_KEYS[p] ?? GROUP_KEYS[p.replace(/s$/, "")]).filter(Boolean);
		const any = /^any (melee|ranged|thrown|one)/i.test(type) ? (/ranged|thrown/i.test(type) ? "ranged" : "melee") : /^any$/i.test(type) ? "any" : null;
		return { kind: "weapon", groups, any, name: named ? type : null, ranged: /ranged|bow|crossbow|sling|thrown/i.test(type) };
	}
	if (m.category === "Armor") {
		const kinds = splitChoices(type).map(p => (p === "any shield" ? "shield" : ARMOUR_KINDS[p] ? p : null));
		return { kind: "armor", kinds: splitChoices(type).filter(p => ARMOUR_KINDS[p]), any: /^any/i.test(type) ? (/shield/i.test(type) ? "shield" : "any") : null, single: kinds.length === 1 && ARMOUR_KINDS[splitChoices(type)[0]] ? splitChoices(type)[0] : null };
	}
	if (m.category === "Implement") return { kind: "implement", groups: splitChoices(type).map(p => IMPLEMENT_KEYS[p]).filter(Boolean), any: /^any/i.test(type) ? "any" : null };
	return null;
}

const para = p => (p.bullet ? `<li>${esc(p.text)}</li>` : `<p>${esc(p.text)}</p>`);
/** Description HTML: flavour, the intro of artifacts, the enhancement and critical lines, then each section. */
export function describeHtml(m) {
	const out = [];
	if (m.flavor) out.push(`<p><em>${esc(m.flavor)}</em></p>`);
	for (const text of m.intro ?? []) out.push(`<p>${esc(text)}</p>`);
	const lines = [];
	for (const key of ["Weapon", "Armor", "Implement", "Enhancement Bonus", "Enhancement", "Critical", "Requirement", "Alchemical Item", "Key Skill", "Formula Cost", "Time", "Ammunition", "Special"]) {
		if (m.stats[key]) lines.push(`<p><strong>${esc(key)}:</strong> ${esc(m.stats[key])}</p>`);
	}
	out.push(...lines);
	for (const s of m.sections) {
		if (s.heading) out.push(`<h3>${esc(s.heading)}</h3>`);
		let list = false;
		for (const p of s.paragraphs) {
			if (p.bullet && !list) { out.push("<ul>"); list = true; }
			if (!p.bullet && list) { out.push("</ul>"); list = false; }
			out.push(para(p));
		}
		if (list) out.push("</ul>");
	}
	return out.join("");
}

const isPower = heading => /power|✦/i.test(heading);
/** Names of the powers the item has, "Power ✦ Daily (Free Action)" and the like, so the importer's list can show them. */
const powerHeadings = m => m.sections.filter(s => isPower(s.heading)).map(s => s.heading);

const importFlags = (m, extra = {}) => ({
	dnd4e: { import: { origin: "iws-4e-compendium", kind: "magic", id: m.id, sourceCode: m.sourceCode, schema: MAGIC_SCHEMA_VERSION, role: "main", bundle: null, magicCategory: m.category, ...extra } },
});

/** @returns {{type: string, system: object, enhancePath: string|null, notes: string[]}} */
function itemFor(m, mundane) {
	const tier = m.tiers[0];
	const notes = [];
	const common = {
		description: { value: describeHtml(m) },
		source: { book: m.sourceCode ?? "", page: "", custom: "", revision: 1 },
		price: tier.price ?? 0, weight: 0, rarity: m.rarity, level: tier.level ?? null,
	};
	const base = baseOf(m);

	if (m.category === "Weapon") {
		const named = base.name ? findBase(m.type) : null;
		const groups = {};
		for (const g of base.groups) groups[g] = true;
		if (!named && !base.groups.length && !base.any) notes.push("base-unknown");
		return {
			type: "weapon", enhancePath: "system.enhance", notes,
			system: {
				...common, weaponType: named?.type ?? "other", weaponHand: "hMain", weaponBaseType: named?.key ?? "", weaponGroup: groups,
				isRanged: Boolean(base.ranged), enhance: tier.enhancement ?? 0,
			},
		};
	}
	if (m.category === "Implement") {
		const key = base.groups.length === 1 ? base.groups[0] : "";
		if (!key) notes.push("base-unknown");
		return {
			type: "weapon", enhancePath: "system.enhance", notes,
			system: { ...common, weaponType: "implement", weaponHand: "hMain", weaponBaseType: key, properties: { imp: true }, implement: key ? { [key]: true } : {}, enhance: tier.enhancement ?? 0 },
		};
	}
	if (m.category === "Armor") {
		const kind = base.single ? ARMOUR_KINDS[base.single] : null;
		const stats = kind ? mundane.get(kind.entry) : null;
		if (!kind) notes.push("base-unknown");
		const penalties = stats ? { movePen: stats.speed !== null, movePenValue: stats.speed ?? 0, skillCheck: stats.check !== null, skillCheckValue: stats.check ?? 0 } : {};
		if (kind?.shield) {
			return { type: "equipment", enhancePath: null, notes, system: { ...common, armour: { type: "arms", subtype: kind.shield, enhance: 0, ac: stats?.bonus ?? 0, ref: stats?.bonus ?? 0, ...penalties }, shieldBaseType: kind.shield } };
		}
		if (/shield/i.test(m.type) && !base.kinds.length) {
			return { type: "equipment", enhancePath: null, notes, system: { ...common, armour: { type: "arms", subtype: "", enhance: 0, ac: 0, ref: 0 }, shieldBaseType: "" } };
		}
		const subtypes = new Set(base.kinds.map(k => ARMOUR_KINDS[k].subtype));
		return {
			type: "equipment", enhancePath: "system.armour.enhance", notes,
			system: { ...common, armour: { type: "armour", subtype: subtypes.size === 1 ? [...subtypes][0] : "", enhance: tier.enhancement ?? 0, ac: stats?.bonus ?? 0, ...penalties }, armourBaseType: kind?.base ?? "" },
		};
	}
	if (m.category === "Alternative Reward") {
		const word = ALT_WORDS.find(w => m.type.toLowerCase().includes(w)) ?? "other";
		return { type: "equipment", enhancePath: null, notes, system: { ...common, armour: { type: "alternative", subtype: word, enhance: 0 } } };
	}
	if (SLOT_TYPES[m.category]) {
		const enhances = m.category === "Neck" && /fortitude|reflex|will/i.test(m.stats["Enhancement Bonus"] ?? "");
		return { type: "equipment", enhancePath: enhances ? "system.armour.enhance" : null, notes, system: { ...common, armour: { type: SLOT_TYPES[m.category], subtype: "", enhance: enhances ? tier.enhancement ?? 0 : 0 } } };
	}
	if (m.category === "Consumable" || m.category === "Poison") {
		return { type: "consumable", enhancePath: null, notes, system: { ...common, consumableType: m.category === "Poison" ? "poison" : CONSUMABLE_TYPES[m.type.toLowerCase()] ?? "other", uses: { autoDestroy: false, max: "1", value: 1, per: "" } } };
	}
	return { type: "loot", enhancePath: null, notes, system: common };
}

/** @param {object} m a parsed magic item  @param {Map<string, object>} mundane parsed mundane armour by name */
export function buildMagic(m, mundane = new Map()) {
	const built = itemFor(m, mundane);
	const base = baseOf(m);
	// No enhancement bonus on the page (a shard, ammunition, an artifact): nothing for the importer to patch by tier.
	if (m.tiers.some(t => t.enhancement === null)) built.enhancePath = null;
	const item = {
		_id: stableId(`${m.id}:main`), name: m.name, type: built.type, system: built.system,
		flags: importFlags(m, { powers: powerHeadings(m), enhancePath: built.enhancePath }), effects: [],
	};
	item.flags.dnd4e.import.bundle = item._id;

	// Standing bonuses: only from the Property sections, and only on items that can be equipped (so they can be suppressed).
	if (["equipment", "weapon"].includes(item.type)) {
		const text = m.sections.filter(s => /^propert/i.test(s.heading)).flatMap(s => s.paragraphs.map(p => p.text)).join("\n");
		attachFeatureEffects(item, text, ENUMS.damageTypes);
		for (const e of item.effects) e.system.equippedRec = true;
	}

	const notes = [...m.notes, ...built.notes];
	if (powerHeadings(m).length) notes.push("powers-in-text");
	return {
		id: m.id, _id: item._id, name: m.name, category: m.category, type: m.type, rarity: m.rarity, source: m.sourceCode, sources: m.sources,
		tiers: m.tiers, scales: m.scales, base, notes, items: [item],
	};
}

/** A light row for the importer's list. */
export const indexRow = (entry, file) => ({
	id: entry.id, _id: entry._id, name: entry.name, category: entry.category, type: entry.type, rarity: entry.rarity,
	source: entry.source, sources: entry.sources, tiers: entry.tiers, base: entry.base, notes: entry.notes,
	itemType: entry.items[0].type, effects: entry.items[0].effects.length, powers: entry.items[0].flags.dnd4e.import.powers.length,
	file, items: entry.items.map(i => i._id),
});

async function main() {
	const argv = process.argv.slice(2);
	const flag = (name, fallback) => (argv.includes(`--${name}`) ? argv[argv.indexOf(`--${name}`) + 1] : fallback);
	const here = path.dirname(fileURLToPath(import.meta.url));
	const input = path.resolve(here, flag("in", "out/parsed/magic.json"));
	const gearFile = path.resolve(here, flag("gear", "out/parsed/gear.json"));
	const dbDir = path.resolve(here, flag("db", "out/db"));
	const parsed = JSON.parse(await readFile(input, "utf8"));
	const mundane = new Map(JSON.parse(await readFile(gearFile, "utf8")).filter(g => g.kind === "armor").map(g => [g.name, g]));
	const entries = parsed.map(m => buildMagic(m, mundane));

	const outDir = path.join(dbDir, "magic");
	await rm(outDir, { recursive: true, force: true });
	await mkdir(outDir, { recursive: true });
	const byFile = new Map();
	const rows = [];
	for (const entry of entries) {
		const file = `${slug(entry.source ?? "other")}.json`;
		if (!byFile.has(file)) byFile.set(file, []);
		byFile.get(file).push(entry);
		rows.push(indexRow(entry, file));
	}
	for (const [file, list] of byFile) await writeFile(path.join(outDir, file), JSON.stringify(list));
	await writeFile(path.join(outDir, "_index.json"), JSON.stringify(rows));

	const manifestFile = path.join(dbDir, "manifest.json");
	const manifest = JSON.parse(await readFile(manifestFile, "utf8"));
	manifest.magic = { count: entries.length, files: byFile.size, effects: entries.reduce((n, e) => n + e.items[0].effects.length, 0), schema: MAGIC_SCHEMA_VERSION };
	await writeFile(manifestFile, JSON.stringify(manifest, null, 1));
	const notes = {};
	for (const e of entries) for (const n of e.notes) notes[n] = (notes[n] ?? 0) + 1;
	console.log(`Magic items: ${entries.length} in ${byFile.size} files, ${manifest.magic.effects} with effects; notes:`, notes);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
