/**
 * The icon of an item in the database. Foundry gives every item the same bag until the data says otherwise; here a power or a feature
 * gets one of Foundry's own core icons (`icons/magic/fire/...`), chosen by what it is: the damage a power deals, the way it is delivered,
 * the power source, or the kind of feature. Several icons fit each kind, and the one used is picked from the item's name, so a given
 * item always has the same icon and different items of a kind look different. Repeating an icon is fine.
 *
 * The icons are used by path, not copied: they are Foundry's, to be used inside Foundry (see icons/LICENSE in its install). The
 * list of paths to pick from is icons-catalog.json, made by build-icon-catalog.mjs.
 *
 * Only powers and features are given an icon here; actors (monsters, traps, companions) and gear are not.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CATALOG = JSON.parse(readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "icons-catalog.json"), "utf8"));
export const ICON_CATALOG = new Set(CATALOG);

/** The catalog paths under the folders, when given, the ones whose file name matches `re`. */
const pool = (folders, re = null) => {
	const found = [].concat(folders).flatMap(folder => CATALOG.filter(p => p.startsWith(`icons/${folder}/`) && (!re || re.test(p.slice(p.lastIndexOf("/") + 1)))));
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
	melee: pool("skills/melee"),
	ranged: pool("skills/ranged"),
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
		default: return "generic";
	}
}

/** The icon of an item, or null for a kind of item that is not given one (gear, rituals...). */
export function iconForItem(item) {
	if (item?.type === "power") return pick(POOLS[powerKind(item)], item.name);
	if (item?.type === "feature") return pick(POOLS[featureKind(item)], item.name);
	return null;
}

const ACTORS = new Set(["NPC", "Hazard", "Player Character", "Companion"]);
const isItem = o => o && typeof o === "object" && !Array.isArray(o) && o._id && o.name && o.type && o.system && typeof o.system === "object" && !ACTORS.has(o.type);

/**
 * Gives an icon to every power and feature in the data (a list of documents, an entry with `items` or `powers`, anything nested),
 * except the ones inside an actor: monsters, traps and companions are left as they are. Returns how many it set.
 */
export function decorate(data) {
	if (Array.isArray(data)) return data.reduce((n, x) => n + decorate(x), 0);
	if (!data || typeof data !== "object") return 0;
	if (data.system && typeof data.system === "object" && ACTORS.has(data.type)) return 0;
	let count = 0;
	if (isItem(data)) {
		const img = iconForItem(data);
		if (img) { data.img = img; count++; }
	}
	for (const [key, value] of Object.entries(data)) if (value && typeof value === "object" && key !== "system" && key !== "flags" && key !== "effects") count += decorate(value);
	return count;
}
