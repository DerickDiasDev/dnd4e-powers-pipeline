/**
 * The icon of an item in the database. Foundry gives every item the same bag until the data says otherwise; here a power or a feature
 * gets one of Foundry's own core icons (`icons/magic/fire/...`), chosen by what it is: the damage a power deals, the way it is delivered,
 * the power source, or the kind of feature. Several icons fit each kind, and the one used is picked from the item's name, so a given
 * item always has the same icon and different items of a kind look different. Repeating an icon is fine.
 *
 * The icons are used by path, not copied: they are Foundry's, to be used inside Foundry (see icons/LICENSE in its install). The
 * list of paths to pick from is icons-catalog.json, made by build-icon-catalog.mjs.
 *
 * Powers, features, equipment, magic items and rituals are given an icon here, in actors too; the actors themselves (monsters, traps, companions) are not.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CATALOG = JSON.parse(readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "icons-catalog.json"), "utf8"));
export const ICON_CATALOG = new Set(CATALOG);

/**
 * Words (the parts of a file name between dashes) of icons that do not belong in a fantasy game: guns, rockets, bombs, tech, tools of a
 * workshop, a damaged weapon. The catalog has them (Foundry's icons are for every setting); the pools never use them.
 */
const NOT_FANTASY = new Set([
	"gun", "guns", "rifle", "pistol", "musket", "blunderbuss", "rocket", "laser", "tech", "cyber", "robot", "grenade", "bomb", "cannon", "drill", "drilling",
	"bullet", "bullets", "tracers", "missile", "jet", "battery", "plasma", "electronics", "circuit", "gramophone", "microphone", "megaphone", "loudspeaker",
	"computer", "wrench", "screwdriver", "screw", "kevlar", "locomotive", "corkscrew", "welding", "goggles", "antenna", "turret", "shells", "shell",
	"damaged", "broken", "chips",
]);
const notFantasy = file => file.slice(file.lastIndexOf("/") + 1).replace(/\.[a-z]+$/, "").split("-").some(part => NOT_FANTASY.has(part)) || /energy-weapon|blast-energy/.test(file);

/** The catalog paths under the folders, when given, the ones whose file name matches `re`; never the ones that are not fantasy. */
const pool = (folders, re = null) => {
	const found = [].concat(folders).flatMap(folder => CATALOG.filter(p => p.startsWith(`icons/${folder}/`) && !notFantasy(p) && (!re || re.test(p.slice(p.lastIndexOf("/") + 1)))));
	if (!found.length) throw new Error(`no icons for ${folders}`);
	return found;
};

/** A stable number from a text (FNV-1a), so the same name always picks the same icon. */
export function hash(text) {
	let h = 2166136261;
	for (const ch of String(text)) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619) >>> 0; }
	return h;
}
export const pick = (icons, seed) => icons[hash(seed) % icons.length];

const POOLS = {
	healing: pool("magic/life"),
	fire: pool("magic/fire"),
	cold: pool("magic/water", /ice|frost|snow|cold|crystal|freez/),
	lightning: pool("magic/lightning"),
	thunder: pool("magic/sonic"),
	acid: pool("magic/acid"),
	poison: pool("skills/toxins"),
	necrotic: pool("magic/death"),
	radiant: pool(["magic/holy", "magic/light"]),
	psychic: pool("magic/perception"),
	force: pool("magic/control", /force|telekin|impact|push|pull|repel|slow|hold|stun/),
	melee: pool("skills/melee", /^(?!shield-)/),
	ranged: pool("skills/ranged", /arrow|bow|archery|dagger|dart|target-bullseye|shuriken|projectile-(spiral|strike)/),
	arcane: pool(["magic/symbols", "magic/control"]),
	divine: pool(["magic/holy", "magic/light"]),
	primal: pool("magic/nature"),
	psionic: pool(["magic/perception", "magic/control"]),
	shadow: pool("magic/unholy"),
	elemental: pool(["magic/air", "magic/earth", "magic/fire", "magic/water"]),
	area: pool("magic/light"),
	generic: pool(["magic/symbols", "magic/defensive"]),
	feat: pool(["skills/melee", "skills/ranged", "skills/movement", "skills/social", "skills/targeting"]),
	path: pool(["magic/control", "magic/defensive"]),
	destiny: pool(["magic/light", "magic/holy"]),
	background: pool(["sundries/documents", "sundries/flags", "sundries/books"]),
	theme: pool("magic/symbols"),
	classFeature: pool(["magic/defensive", "skills/melee"]),
	race: pool("environment/people"),
	deity: pool("magic/holy"),
	disease: pool("skills/wounds"),
	companion: pool("magic/nature"),
	// equipment
	swords: pool("weapons/swords"),
	bladeL: pool(["weapons/daggers", "weapons/swords"], /dagger|dirk|knife|kukri|short|rapier|cutlass|scimitar|sabre|saber/),
	axes: pool("weapons/axes"),
	hammers: pool("weapons/hammers"),
	maces: pool(["weapons/maces", "weapons/clubs"]),
	polearms: pool("weapons/polearms"),
	staves: pool("weapons/staves"),
	fists: pool("weapons/fist"),
	bows: pool("weapons/bows"),
	crossbows: pool("weapons/crossbows"),
	slings: pool(["weapons/slings", "weapons/thrown"]),
	whips: pool("weapons/misc"),
	ammo: pool("weapons/ammunition", /arrow|bolt|quiver|dart|stone|sling|pellet/),
	wands: pool("weapons/wands"),
	rods: pool(["weapons/wands", "weapons/staves"], /rod|wand|scepter|sceptre|staff/),
	orbs: pool("commodities/gems"),
	tomes: pool("sundries/books"),
	holySymbols: pool("equipment/neck", /holy|cross|symbol|pendant|amulet|ankh|medallion/),
	plateArmor: pool("equipment/chest", /plate|mail|scale|chain|armor|breastplate/),
	leatherArmor: pool("equipment/chest", /leather|hide/),
	clothArmor: pool(["equipment/chest", "equipment/body"], /robe|cloth|vest|tunic|body/),
	shields: pool("equipment/shield"),
	head: pool("equipment/head"),
	neck: pool("equipment/neck"),
	ring: pool("equipment/finger"),
	feet: pool("equipment/feet"),
	hands: pool("equipment/hand"),
	waist: pool("equipment/waist"),
	wrists: pool("equipment/wrist"),
	cloaks: pool(["equipment/back", "equipment/shoulder"]),
	boon: pool("magic/symbols"),
	potions: pool("consumables/potions"),
	poisons: pool("skills/toxins"),
	scrolls: pool("sundries/scrolls", /scroll/),
	food: pool("consumables/food"),
	instruments: pool("tools/instruments"),
	banners: pool("sundries/flags"),
	tattoos: pool("skills/wounds"),
	mounts: pool("creatures/mammals"),
	treasure: pool("commodities/treasure"),
	buildings: pool("environment/settlement"),
	gear: pool(["containers/bags", "tools/hand", "sundries/survival"]),
	// adventuring gear that has an icon of its own
	rations: pool("consumables/grains", /ration/),
	waterskin: pool("sundries/survival", /^waterskin/),
	bedroll: pool("sundries/survival", /^bedroll/),
	backpack: pool("containers/bags", /^pack-leather/),
	beltPouch: pool("containers/bags", /^pouch-leather/),
	firelighter: pool("sundries/survival", /^fire-lighter/),
	sunrod: pool("magic/light", /^torch-fire/),
	rope: pool("sundries/survival", /^rope-(brown|coil|coiled)/),
	wondrous: pool(["commodities/gems", "sundries/misc"]),
	ritual: pool(["sundries/scrolls", "sundries/books"]),
	// breaths
	breathFire: pool("creatures/abilities", /^dragon-fire-breath/),
	breathCold: pool("creatures/abilities", /^dragon-ice-breath/),
	breath: pool("creatures/abilities", /^dragon-breath/),
	// the natural attacks of creatures
	claws: pool("creatures/claws"),
	bites: pool(["creatures/abilities", "creatures/reptiles"], /fang|bite|mouth-teeth-(?!human|crooked)|snake-fangs/),
	slams: pool(["creatures/claws", "creatures/tentacles", "skills/melee"], /hammer|slam|punch|fist|tentacle|claw|club|strike-club|horn|tail/),
};

/** The damage types, in the order the first one a power deals decides its icon. */
const DAMAGE_ORDER = ["fire", "cold", "lightning", "thunder", "acid", "poison", "necrotic", "radiant", "psychic", "force"];
const HEALS = /\bregains?\b[^.]*\bhit points\b|\bhealing surge\b|\bheals?\b/i;
const SOURCE = { arcane: "arcane", divine: "divine", primal: "primal", psionic: "psionic", shadow: "shadow", martial: "melee", elemental: "elemental" };

/** The kind of icon (a key of POOLS) for a power. */
export function powerKind(item) {
	const s = item.system ?? {};
	const text = `${s.hit?.detail ?? ""} ${s.effect?.detail ?? ""}`;
	if (!s.attack?.isAttack && !s.hit?.isDamage && HEALS.test(text)) return "healing";
	// A power named for a weapon ("Shortbow", "Javelin", "Spear Charge") takes the weapon's own art; "Dagger of Flame" is a magic one.
	const weapon = naturalWeapon(item.name) ?? weaponNamed(item.name);
	if (weapon) return weapon;
	if (/^breath\b/i.test(item.name ?? "")) return breathKind(s);
	for (const type of DAMAGE_ORDER) if (s.damageType?.[type]) return type;
	if (s.weaponType === "melee" || s.weaponType === "meleeRanged") return "melee";
	if (s.weaponType === "ranged") return "ranged";
	const source = SOURCE[String(s.powersource ?? "").toLowerCase()];
	if (source) return source;
	if (["melee", "reach", "touch"].includes(s.rangeType)) return "melee";
	if (["range", "weapon"].includes(s.rangeType)) return "ranged";
	if (["closeBurst", "closeBlast", "rangeBurst", "wall"].includes(s.rangeType)) return "area";
	return "generic";
}

/** The kind of icon for a feature (a feat, a class or race feature, a path, a destiny...). */
export function featureKind(item) {
	const s = item.system ?? {};
	switch (s.featureType) {
		case "feat": return "feat";
		case "path": return "path";
		case "destiny": return "destiny";
		case "background": return "background";
		case "theme": return "theme";
		case "class": return "classFeature";
		case "race": return "race";
		case "other":
			if (s.featureGroup === "Deity") return "deity";
			if (s.featureGroup === "Disease") return "disease";
			if (s.featureGroup === "Familiar" || s.featureGroup === "Companion") return "companion";
			return "generic";
		case "trait": return traitKind(item.name);
		default: return "generic";
	}
}

/** A trait (mostly a monster's) by a word of its name: auras, regeneration, resistances, senses, flight, the elements. */
const TRAIT_WORDS = [
	[/regenerat|heal|life/i, "healing"], [/poison|venom|toxic/i, "poison"], [/fire|flame|burn|ember/i, "fire"], [/cold|frost|ice|freez/i, "cold"],
	[/lightning|storm|shock/i, "lightning"], [/thunder|sonic|roar/i, "thunder"], [/acid|corros/i, "acid"], [/necro|undead|death|grave|vampir/i, "necrotic"],
	[/radiant|holy|divine|sacred/i, "radiant"], [/psychic|mind|dominat|charm/i, "psychic"],
	[/aura|glow|light/i, "area"], [/vision|sight|sense|tremorsense|perception/i, "psychic"], [/resist|immun|armor|shield|hard|tough/i, "generic"],
];
export function traitKind(name) {
	for (const [re, kind] of TRAIT_WORDS) if (re.test(name)) return kind;
	return "generic";
}

/** What the weapon is: its group, else a word of its base type, name or the kind a magic item names ("Light blade", "Bow or crossbow"). */
const WEAPON_WORDS = [
	[/crossbow/i, "crossbows"], [/\bbows?\b|longbow|shortbow/i, "bows"], [/sling/i, "slings"], [/blowgun|dart|javelin|shuriken|throwing/i, "slings"],
	[/dagger|knife|dirk|kukri|light blade/i, "bladeL"], [/sword|blade|rapier|scimitar|falchion|saber|sabre|katana/i, "swords"],
	[/axe|hatchet/i, "axes"], [/hammer|maul/i, "hammers"], [/mace|morningstar|club|flail/i, "maces"],
	[/spear|lance|pike|halberd|glaive|trident|polearm|scythe|sickle/i, "polearms"],
	[/staff|quarterstaff/i, "staves"], [/gauntlet|claw|fist|knuckle|unarmed|paw/i, "fists"], [/whip|garrote/i, "whips"],
	[/ammunition|arrow|bolt|bullet|shot/i, "ammo"],
];
const WEAPON_GROUPS = { bladeH: "swords", bladeL: "bladeL", axe: "axes", ham: "hammers", mace: "maces", flail: "maces", spear: "polearms", pole: "polearms", pik: "polearms", staff: "staves", unarm: "fists", bow: "bows", cbow: "crossbows", sling: "slings", blowgun: "slings", garrote: "whips", whip: "whips" };
const IMPLEMENTS = { holyS: "holySymbols", staff: "staves", rod: "rods", wand: "wands", orb: "orbs", totem: "staves", ki: "fists", tome: "tomes" };

/** The weapon kind a power's name begins with, or null: its first two words are a weapon and it is not "... of ...". */
export function weaponNamed(name) {
	if (/\bof\b/i.test(name ?? "")) return null;
	const start = String(name ?? "").replace(/["'‘’“”]/g, "").split(/\s+/).slice(0, 2).join(" ");
	for (const [re, kind] of WEAPON_WORDS) if (re.test(start) && kind !== "ammo") return kind;
	return null;
}

/**
 * The kind of icon for a breath weapon: Foundry has dragon breaths of fire and of ice; the other elements use the art of the element,
 * and a breath with no element (or no damage) the plain dragon breath.
 */
export function breathKind(system) {
	const element = DAMAGE_ORDER.find(type => system?.damageType?.[type]);
	if (element === "fire") return "breathFire";
	if (element === "cold") return "breathCold";
	return element ?? "breath";
}

/** The natural attack a power's name begins with (a claw, a bite, a slam), or null: creatures have art for them. */
export function naturalWeapon(name) {
	const first = String(name ?? "").split(/\s+/)[0].toLowerCase().replace(/[^a-z]/g, "");
	if (/^(claw|claws|talon|talons|rake|rend|rending|swipe)$/.test(first)) return "claws";
	if (/^(bite|bites|fang|fangs|maw|gore|sting|stinger|venomous)$/.test(first)) return "bites";
	if (/^(slam|tail|horns?|trample|stomp|tentacle|tentacles|constrict|crush|pincer|pincers)$/.test(first)) return "slams";
	return null;
}

/**
 * The icons made for the very weapon a name says (a scimitar, a shortsword, a greatsword, a dagger): the files of Foundry's weapon folders
 * named for it. A name with none of these words, or a weapon Foundry has no art for (a longsword, a rapier), has none: the weapon's kind decides.
 */
export function namedWeaponIcons(name) {
	const words = new Set(String(name ?? "").toLowerCase().split(/[^a-z]+/));
	for (const word of ["scimitar", "shortsword", "greatsword", "dagger"]) {
		if (!words.has(word) && !words.has(`${word}s`)) continue;
		const found = CATALOG.filter(p => p.startsWith("icons/weapons/") && !notFantasy(p) && new RegExp(`/${word}(-[^/]*)?\\.[a-z]+$`).test(p));
		if (found.length) return found;
	}
	return null;
}

/** The kind of icon for a weapon or an implement. */
export function weaponKind(item, ctx = {}) {
	const s = item.system ?? {};
	if (s.weaponType === "implement" && IMPLEMENTS[s.weaponBaseType]) return IMPLEMENTS[s.weaponBaseType];
	for (const group of Object.keys(s.weaponGroup ?? {})) if (s.weaponGroup[group] && WEAPON_GROUPS[group]) return WEAPON_GROUPS[group];
	const text = `${s.weaponBaseType ?? ""} ${ctx.type ?? ""} ${item.name}`;
	for (const [re, kind] of WEAPON_WORDS) if (re.test(text)) return kind;
	return /R$/.test(s.weaponType ?? "") ? "bows" : "swords";
}

/** The kind of icon for armour, a shield or a worn item. */
export function equipmentKind(item, ctx = {}) {
	const a = item.system?.armour ?? {};
	const base = item.system?.armourBaseType;
	switch (a.type) {
		case "armour":
			if (["plate", "chain", "scale"].includes(base) || (!base && a.subtype === "heavy")) return "plateArmor";
			if (["leather", "hide"].includes(base)) return "leatherArmor";
			return "clothArmor";
		case "arms": return a.subtype === "heavy" || a.subtype === "light" || item.system?.shieldBaseType ? "shields" : "wrists";
		case "head": return "head";
		case "neck": return "neck";
		case "ring": return "ring";
		case "feet": return "feet";
		case "hands": return "hands";
		case "waist": return "waist";
		case "alternative": return "boon";
		default: return /ring/i.test(ctx.category ?? "") ? "ring" : "cloaks";
	}
}

/** The kind of icon for a consumable. */
export function consumableKind(item) {
	const s = item.system ?? {};
	if (s.consumableType === "ammo") return "ammo";
	if (s.consumableType === "poison") return "poisons";
	if (/scroll/i.test(item.name)) return "scrolls";
	if (/\b(food|ration|bread|meal|honey|fruit|stew|wine|ale)\b/i.test(item.name)) return "food";
	return "potions";
}

const GEAR_NAMES = [
	[/\brations?\b/i, "rations"], [/\bwaterskin\b/i, "waterskin"], [/\bbedroll\b/i, "bedroll"], [/\bbackpack\b/i, "backpack"], [/\bbelt pouch\b/i, "beltPouch"],
	[/\bflint\b/i, "firelighter"], [/\bsunrod\b/i, "sunrod"], [/\brope\b/i, "rope"],
];

/** The kind of icon for loot: gear, a mount, an instrument, a wondrous item. */
export function lootKind(item, ctx = {}) {
	// What the adventurer carries has its own art: rations, a waterskin, a bedroll, a pack, a pouch, a fire lighter, a sunrod, rope.
	for (const [re, kind] of GEAR_NAMES) if (re.test(item.name ?? "")) return kind;
	const text = `${item.name} ${ctx.type ?? ""} ${ctx.subtype ?? ""}`;
	if (ctx.kind === "mount" || ctx.category === "Mount" || /\bmount\b/i.test(ctx.type ?? "")) return "mounts";
	if (ctx.kind === "building") return "buildings";
	if (ctx.kind === "instrument" || /instrument|horn|lute|flute|drum|harp|lyre/i.test(text)) return "instruments";
	if (/tattoo/i.test(text)) return "tattoos";
	if (/standard|banner|flag/i.test(text)) return "banners";
	if (ctx.category === "Lair") return "treasure";
	if (ctx.category && ctx.category !== "Item Set" && ctx.kind !== "item") return "wondrous";
	return "gear";
}

/**
 * The icon of an item, or null for a kind of item that is not given one. `ctx` is what the entry the item belongs to says
 * (`{ category, kind, type, subtype }`): a magic item's category, a piece of gear's kind.
 */
export function iconForItem(item, ctx = {}) {
	switch (item?.type) {
		case "power": return pick(POOLS[powerKind(item)], item.name);
		case "feature": return pick(POOLS[featureKind(item)], item.name);
		case "weapon": return pick((item.system?.weaponType === "implement" ? null : namedWeaponIcons(item.name)) ?? POOLS[weaponKind(item, ctx)], item.name);
		case "equipment": return pick(POOLS[equipmentKind(item, ctx)], item.name);
		case "consumable": return pick(POOLS[consumableKind(item)], item.name);
		case "loot": return pick(POOLS[lootKind(item, ctx)], item.name);
		case "ritual": return pick(POOLS.ritual, item.name);
		default: return null;
	}
}

const ACTORS = new Set(["NPC", "Hazard", "Player Character", "Companion"]);
const isItem = o => o && typeof o === "object" && !Array.isArray(o) && o._id && o.name && o.type && o.system && typeof o.system === "object" && !ACTORS.has(o.type);

/**
 * Gives an icon to every item the rules cover (powers, features, weapons, armour and worn items, consumables, loot, rituals) wherever it
 * is in the data (a list of documents, an entry with `items` or `powers`, anything nested), the ones of monsters, traps and companions included;
 * the actors themselves are left as they are. An entry's category, kind and type are passed down to its items. Returns how many it set.
 */
export function decorate(data, ctx = {}) {
	if (Array.isArray(data)) return data.reduce((n, x) => n + decorate(x, ctx), 0);
	if (!data || typeof data !== "object") return 0;
	let count = 0;
	if (isItem(data)) {
		const img = iconForItem(data, ctx);
		if (img) { data.img = img; count++; }
	}
	const here = !data.system && (data.category !== undefined || data.kind !== undefined)
		? { category: data.category, kind: data.kind, type: typeof data.type === "string" ? data.type : undefined, subtype: data.subtype }
		: ctx;
	for (const [key, value] of Object.entries(data)) if (value && typeof value === "object" && key !== "system" && key !== "flags" && key !== "effects") count += decorate(value, here);
	return count;
}
