/**
 * Builds the mundane equipment part of the database (out/db/gear/) from out/parsed/gear.json.
 *
 * What each parsed entry becomes in Foundry:
 *   - weapon     -> `weapon` item (weaponType simpleM/militaryM/superiorM/... + base type, hand, group, properties, damage dice,
 *                   proficiency bonus, range). Double weapons import both ends: the secondary end is a second item of the bundle.
 *   - armor      -> `equipment` item: armour (type "armour", light or heavy and its base type), shield (type "arms", the
 *                   bonus on AC and Reflex as the rules say) or barding (type "other").
 *   - implement  -> `weapon` item with weaponType "implement" and the implement group as its base type.
 *   - ammo       -> `consumable` item of type "ammo".
 *   - item       -> `loot` item: adventuring gear, mounts, vehicles, instruments, services, buildings.
 *
 * Masterwork armour, pact weapons and improvised weapons come with the rest (their `rarity` says what they are).
 *
 * Output: out/db/gear/_index.json (light rows for the importer's list) and out/db/gear/gear.json (full entries with items).
 * Run after build-db.mjs, which resets manifest.json.
 *
 * Usage: node build-gear.mjs [--in out/parsed/gear.json] [--db out/db]
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ENUMS, labelMap } from "./system-enums.mjs";

export const GEAR_SCHEMA_VERSION = 1;

const esc = s => String(s ?? "").replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
const stableId = seed => createHash("sha1").update(`dnd4e:gear:${seed}`).digest("base64").replace(/[^A-Za-z0-9]/g, "").slice(0, 16);
const paragraphs = text => String(text ?? "").split("\n").filter(Boolean).map(l => `<p>${esc(l)}</p>`).join("");
const letters = s => String(s).toLowerCase().replace(/[^a-z0-9]/g, "");

/** Weapon property printed in the compendium -> the system's switch. */
export const PROPERTY_KEYS = {
	versatile: "ver", reach: "rch", small: "sml", stout: "sto", "off-hand": "off", "heavy thrown": "thv", "light thrown": "tlg",
	"load free": "lof", "load minor": "lom", mounted: "mou", defensive: "def", "high crit": "hic", brutal: "bru",
};
/** Weapon group printed -> CONFIG.DND4E.weaponGroup key. */
export const GROUP_KEYS = {
	axe: "axe", "heavy blade": "bladeH", "light blade": "bladeL", blowgun: "blowgun", bow: "bow", crossbow: "cbow", flail: "flail", garrote: "garrote",
	hammer: "ham", mace: "mace", pick: "pik", polearm: "pole", sling: "sling", spear: "spear", staff: "staff", unarmed: "unarm", whip: "whip",
};
/** Implement printed -> CONFIG.DND4E.implement key. */
export const IMPLEMENT_KEYS = { "holy symbol": "holyS", "ki focus": "ki", orb: "orb", rod: "rod", staff: "staff", tome: "tome", totem: "totem", wand: "wand" };

const BASE_TABLES = {
	simpleM: labelMap("simpleM"), simpleR: labelMap("simpleR"), militaryM: labelMap("militaryM"), militaryR: labelMap("militaryR"),
	superiorM: labelMap("superiorM"), superiorR: labelMap("superiorR"),
};
/** The system labels some keys with another name than the compendium's (dejada is "Basket Sling" there). */
const BASE_ALIASES = {
	dejada: "dejada", alhulak: "alhulak", carrikal: "carrikal", chatkcha: "chatchka", trikal: "trikal", cahulaks: "cahulaks", gythka: "gythka",
	lotulis: "lotulis", tratnyr: "tratnyr", zadatl: "zadatl", zulaat: "zulaat", drowlongknife: "longKnife", talentaboomerang: "boomerang",
	xendrikboomerang: "boomerang", talentasharrash: "sharrash", talentatangat: "tangat",
};
const baseKey = (table, name) => {
	const clean = letters(name.replace(/\s*\(.*\)\s*$/, "").replace(/\s*-\s*secondary end$/i, ""));
	for (const [label, key] of BASE_TABLES[table] ?? []) if (letters(label) === clean) return key;
	const alias = BASE_ALIASES[clean];
	return alias && [...(BASE_TABLES[table]?.values() ?? [])].includes(alias) ? alias : "";
};

/** A weapon name -> its weapon type and base type key in the system ("Longsword" -> militaryM / longsword), or null. */
export function findBase(name) {
	for (const type of Object.keys(BASE_TABLES)) {
		const key = baseKey(type, name);
		if (key) return { type, key };
	}
	return null;
}

const source = e => ({ book: e.sourceCode ?? "", page: "", custom: "", revision: 1 });
const importFlags = (e, role, extra = {}) => ({
	dnd4e: { import: { origin: "iws-4e-compendium", kind: "gear", id: e.id, sourceCode: e.sourceCode, schema: GEAR_SCHEMA_VERSION, role, gearKind: e.kind, ...extra } },
});

/** Rules text of a property the system has no switch for (Accurate, Energized...), the only place that rule is written. */
function propertyText(properties) {
	return properties.filter(p => !PROPERTY_KEYS[p.name.toLowerCase().replace(/\s*\d+$/, "")] && p.text)
		.map(p => `<p><strong>${esc(p.name)}.</strong> ${esc(p.text)}</p>`).join("");
}

function weaponSystem(e) {
	const ranged = e.reach === "ranged";
	// The system calls the improvised weapon types improvM / improvR.
	const type = e.category ? `${e.category === "improvised" ? "improv" : e.category}${ranged ? "R" : "M"}` : "other";
	const properties = {}, brutal = e.properties.find(p => /^brutal\b/i.test(p.name));
	for (const p of e.properties) {
		const key = PROPERTY_KEYS[p.name.toLowerCase().replace(/\s*\d+$/, "")];
		if (key) properties[key] = true;
	}
	const groups = {};
	for (const g of e.groups) if (GROUP_KEYS[g.toLowerCase()]) groups[GROUP_KEYS[g.toLowerCase()]] = true;
	return {
		type, properties, groups,
		system: {
			description: { value: paragraphs(e.description) + propertyText(e.properties) },
			source: source(e),
			weight: e.weight ?? 0, price: e.price ?? 0, rarity: e.rarity ?? "Mundane",
			weaponType: type,
			weaponHand: e.hands === "one" ? "hMain" : e.hands ? "hTwo" : "hMain",
			weaponBaseType: baseKey(type, e.name),
			properties,
			weaponGroup: groups,
			profBonus: e.proficiency ?? 0,
			isRanged: ranged,
			...(e.range ? { range: { value: e.range[0], long: e.range[1] } } : {}),
			damageDice: { parts: e.damage ? [{ numDice: String(e.damage.dice), numFaces: String(e.damage.faces), modifier: "" }] : [] },
			...(brutal ? { brutalNum: Number(brutal.name.match(/\d+/)?.[0] ?? 1) } : {}),
		},
	};
}

function implementSystem(e) {
	const key = IMPLEMENT_KEYS[e.implementType.toLowerCase()] ?? "";
	const groups = {};
	for (const g of e.groups) if (GROUP_KEYS[g.toLowerCase()]) groups[GROUP_KEYS[g.toLowerCase()]] = true;
	const properties = { imp: true };
	for (const p of e.properties) {
		const k = PROPERTY_KEYS[p.name.toLowerCase().replace(/\s*\d+$/, "")];
		if (k) properties[k] = true;
	}
	return {
		system: {
			description: { value: paragraphs(e.description) + propertyText(e.properties) },
			source: source(e),
			weight: e.weight ?? 0, price: e.price ?? 0, rarity: e.rarity ?? "Mundane",
			weaponType: "implement",
			weaponHand: "hMain",
			weaponBaseType: key,
			properties,
			weaponGroup: groups,
			implement: key ? { [key]: true } : {},
			profBonus: e.proficiency ?? 0,
			...(e.range ? { range: { value: e.range[0], long: e.range[1] } } : {}),
		},
		key,
	};
}

const ARMOUR_BASE = { cloth: ["light", "cloth"], leather: ["light", "leather"], hide: ["light", "hide"], chainmail: ["heavy", "chain"], chain: ["heavy", "chain"], scale: ["heavy", "scale"], plate: ["heavy", "plate"] };

function armorSystem(e) {
	const common = {
		description: { value: paragraphs(e.description) + (e.special ? `<p><strong>Special.</strong> ${esc(e.special)}</p>` : "") + (e.minEnhancement ? `<p><strong>Minimum enhancement:</strong> +${e.minEnhancement}</p>` : "") },
		source: source(e),
		weight: e.weight ?? 0, price: e.price ?? 0, rarity: e.rarity ?? "Mundane",
	};
	const penalties = {
		movePen: e.speed !== null, movePenValue: e.speed ?? 0,
		skillCheck: e.check !== null, skillCheckValue: e.check ?? 0,
	};
	if (e.form === "shield") {
		const weight = /heavy/i.test(e.armorType) ? "heavy" : "light";
		return { subtype: weight, base: weight, system: { ...common, armour: { type: "arms", subtype: weight, enhance: 0, ac: e.bonus ?? 0, ref: e.bonus ?? 0, ...penalties }, shieldBaseType: weight } };
	}
	if (e.form === "barding") return { subtype: "", base: "", system: { ...common, armour: { type: "other", subtype: "", enhance: 0, ac: e.bonus ?? 0, ...penalties } } };
	const [subtype, base] = ARMOUR_BASE[letters(e.armorType)] ?? ["", ""];
	return { subtype, base, system: { ...common, armour: { type: "armour", subtype, enhance: 0, ac: e.bonus ?? 0, ...penalties }, armourBaseType: base } };
}

function ammoSystem(e) {
	return {
		description: { value: paragraphs(e.description) },
		source: source(e),
		weight: e.weight ?? 0, price: e.price ?? 0, rarity: e.rarity ?? "Mundane", quantity: e.quantity ?? 1,
		consumableType: "ammo",
		uses: { autoDestroy: false, max: "1", value: 1, per: "" },
	};
}

/** The adventuring gear's types -> the importer's categories; anything else (food, services, components...) is plain gear. */
const ITEM_CATEGORIES = { Mount: "mount", Transportation: "transport", "Musical Instrument": "instrument", Building: "building" };

function lootSystem(e) {
	return {
		description: { value: paragraphs(e.description) },
		source: source(e),
		weight: e.weight ?? 0, price: e.price ?? 0, rarity: e.rarity ?? "Mundane",
	};
}

const item = (e, key, name, type, system, role, extra) => ({
	_id: stableId(`${e.id}:${key}`), name, type, system,
	flags: importFlags(e, role, extra), effects: [],
});

const SECONDARY = /\s*-\s*secondary end$/i;

/** @param {object[]} parsed the parsed entries; secondary ends are attached to the double weapon they belong to */
export function buildGear(parsed) {
	const secondaries = new Map(parsed.filter(e => e.kind === "weapon" && SECONDARY.test(e.name)).map(e => [e.name.replace(SECONDARY, "").toLowerCase(), e]));
	const entries = [];
	for (const e of parsed) {
		if (e.kind === "weapon" && SECONDARY.test(e.name)) continue;
		const notes = [...e.notes];
		let main, subtype = "", category = null;
		if (e.kind === "weapon") {
			const w = weaponSystem(e);
			category = w.type;
			subtype = Object.keys(w.groups)[0] ?? "";
			// Improvised weapons are not a named weapon: they have no base type to miss.
			if (!w.system.weaponBaseType && e.category !== "improvised") notes.push("base-type-unknown");
			main = item(e, "main", e.name, "weapon", w.system, "main");
		} else if (e.kind === "implement") {
			const w = implementSystem(e);
			category = "implement";
			subtype = w.key;
			if (!w.key) notes.push("base-type-unknown");
			main = item(e, "main", e.name, "weapon", w.system, "main");
		} else if (e.kind === "armor") {
			const a = armorSystem(e);
			category = e.rarity === "Masterwork" ? "masterwork" : e.form;
			subtype = a.base;
			if (e.form === "armor" && !a.base) notes.push("base-type-unknown");
			if (e.form === "barding") notes.push("barding");
			main = item(e, "main", e.name, "equipment", a.system, "main");
		} else if (e.kind === "item") {
			category = ITEM_CATEGORIES[e.itemType] ?? "gear";
			main = item(e, "main", e.name, "loot", lootSystem(e), "main");
		} else {
			category = "ammo";
			main = item(e, "main", e.name, "consumable", ammoSystem(e), "main");
		}
		const items = [main];
		const sec = e.kind === "weapon" ? secondaries.get(e.name.toLowerCase()) : null;
		if (sec) {
			const w = weaponSystem({ ...sec, price: null, weight: null });
			items.push(item(e, "secondary", sec.name, "weapon", w.system, "child"));
			notes.push("double-weapon");
		}
		for (const it of items) it.flags.dnd4e.import.bundle = main._id;
		entries.push({
			id: e.id, _id: main._id, name: e.name, kind: e.kind, category, subtype,
			price: e.price, weight: e.weight ?? null, source: e.sourceCode, sources: e.sources, rarity: e.rarity ?? "Mundane",
			notes, items,
		});
	}
	return entries;
}

/** The numbers the importer's list shows next to a name, read from the main item (damage, bonus, penalties). */
export function summaryOf(main) {
	const s = main.system;
	if (main.type === "weapon") {
		const part = s.damageDice?.parts?.[0];
		return {
			damage: part ? `${part.numDice}d${part.numFaces}` : null, proficiency: s.profBonus || null,
			range: s.range ? [s.range.value, s.range.long] : null, hand: s.weaponHand, group: Object.keys(s.weaponGroup ?? {})[0] ?? null,
			// the properties the weapon has (versatile, reach, high crit, heavy thrown...), for the importer's list
			properties: Object.keys(s.properties ?? {}).filter(k => s.properties[k] && k !== "imp"),
		};
	}
	if (main.type === "equipment") {
		const a = s.armour;
		return { bonus: a.ac, check: a.skillCheck ? a.skillCheckValue : null, speed: a.movePen ? a.movePenValue : null };
	}
	if (main.type === "consumable") return { quantity: s.quantity };
	return {};
}

/** A light row for the importer's list. */
export const indexRow = entry => ({
	id: entry.id, _id: entry._id, name: entry.name, kind: entry.kind, category: entry.category, subtype: entry.subtype,
	price: entry.price, weight: entry.weight, source: entry.source, sources: entry.sources, rarity: entry.rarity, notes: entry.notes,
	summary: summaryOf(entry.items[0]),
	items: entry.items.map(i => i._id),
});

async function main() {
	const argv = process.argv.slice(2);
	const flag = (name, fallback) => (argv.includes(`--${name}`) ? argv[argv.indexOf(`--${name}`) + 1] : fallback);
	const here = path.dirname(fileURLToPath(import.meta.url));
	const input = path.resolve(here, flag("in", "out/parsed/gear.json"));
	const dbDir = path.resolve(here, flag("db", "out/db"));
	const parsed = JSON.parse(await readFile(input, "utf8"));
	const entries = buildGear(parsed);
	await mkdir(path.join(dbDir, "gear"), { recursive: true });
	await writeFile(path.join(dbDir, "gear", "gear.json"), JSON.stringify(entries));
	await writeFile(path.join(dbDir, "gear", "_index.json"), JSON.stringify(entries.map(indexRow)));
	const manifestFile = path.join(dbDir, "manifest.json");
	const manifest = JSON.parse(await readFile(manifestFile, "utf8"));
	manifest.gear = { count: entries.length, items: entries.reduce((n, e) => n + e.items.length, 0), schema: GEAR_SCHEMA_VERSION };
	await writeFile(manifestFile, JSON.stringify(manifest, null, 1));
	const notes = {};
	for (const e of entries) for (const n of e.notes) notes[n] = (notes[n] ?? 0) + 1;
	console.log(`Gear: ${entries.length} entries -> ${manifest.gear.items} items; notes:`, notes);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
