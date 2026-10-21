/**
 * Reads the allowed values straight from the dnd4e system's config.mjs / en.json, so the converter and the
 * validator always agree with the installed system instead of a copy that can drift.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

export const SYSTEM_DIR = process.env.DND4E_SYSTEM ?? "G:/Foundry/FoundryVTT/Data/systems/dnd4e";

const config = readFileSync(path.join(SYSTEM_DIR, "module", "config.mjs"), "utf8").split(/\r?\n/);
const lang = JSON.parse(readFileSync(path.join(SYSTEM_DIR, "lang", "en.json"), "utf8"));

/** Flattens nested lang JSON to dotted keys. */
function flatten(obj, prefix = "", out = {}) {
	for (const [k, v] of Object.entries(obj)) {
		const key = prefix ? `${prefix}.${k}` : k;
		if (v && typeof v === "object") flatten(v, key, out);
		else out[key] = v;
	}
	return out;
}
const flatLang = flatten(lang);

/** Top-level entries (one tab of indentation) of `DND4E.<name> = { ... };` as [key, rawValueLine] pairs. */
function entriesOf(name) {
	// Later assignments win in the config (weaponProficiencies is defined twice), so read the last one.
	const start = config.findLastIndex(l => l.startsWith(`DND4E.${name} = {`));
	if (start < 0) throw new Error(`DND4E.${name} not found in config.mjs`);
	const out = [];
	for (let i = start + 1; i < config.length && !/^\};?/.test(config[i]); i++) {
		const m = config[i].match(/^\t"?([A-Za-z0-9_]+)"?\s*:\s*(.*)$/);
		if (m) out.push([m[1], m[2]]);
	}
	return out;
}

const keysOf = name => entriesOf(name).map(([k]) => k);

/** Label shown for a config entry whose value is a lang key string, e.g. `"DND4E.Augmentable"`. */
function labelOf(rawValue) {
	const m = rawValue.match(/"(DND4E\.[^"]+)"/);
	return m ? (flatLang[m[1]] ?? m[1]) : null;
}

export const ENUMS = {
	actionType: keysOf("abilityActivationTypes"),
	useType: keysOf("powerUseType"),
	powerType: keysOf("powerType"),
	powerSubtype: keysOf("powerSubtype"),
	powerSource: keysOf("powerSource"),
	weaponType: keysOf("weaponType"),
	diceTypes: keysOf("powerDiceTypes"),
	damageTypes: keysOf("damageTypes"),
	effectTypes: keysOf("effectTypes"),
	autoTarget: keysOf("autoTargetModes"),
	abilities: keysOf("abilities"),
	defences: keysOf("defensives"),
	sizes: keysOf("actorSizes"),
	origins: keysOf("creatureOrigin"),
	skills: keysOf("skills"),
	spoken: keysOf("spoken"),
	featureTypes: keysOf("featureTypes"),
	armourProf: keysOf("profArmor"),
	durationType: keysOf("durationType"),
	powerEffectTypes: keysOf("powerEffectTypes"),
	statusEffects: keysOf("statusEffect"),
	weaponProf: keysOf("weaponProficiencies"),
	weaponTypes: keysOf("weaponTypes"),
	weaponHands: keysOf("weaponHands"),
	weaponProperties: keysOf("weaponProperties"),
	weaponGroups: keysOf("weaponGroup"),
	implements: keysOf("implement"),
	equipmentTypes: keysOf("equipmentTypes"),
	equipmentTypesArmour: keysOf("equipmentTypesArmour"),
	consumableTypes: keysOf("consumableTypes"),
	// rangeType's nested objects make a one-tab scan useless; these are the keys rangeData() in item.mjs handles.
	rangeType: ["weapon", "melee", "touch", "reach", "range", "closeBurst", "closeBlast", "rangeBurst", "rangeBlast", "wall", "personal", "special"],
};

/** lowercase label -> effectType key, e.g. "beast form" -> "beastForm". */
export const EFFECT_BY_LABEL = new Map(entriesOf("effectTypes").map(([k, raw]) => [(labelOf(raw) ?? k).toLowerCase(), k]));
EFFECT_BY_LABEL.set("channel divinity", "channelDiv");

/** lowercase key -> real key, so "Elemental"/"elemental" both resolve for powerSource. */
export const POWER_SOURCE_BY_LOWER = new Map(ENUMS.powerSource.map(k => [k.toLowerCase(), k]));

/** status id -> icon path, read from CONFIG.DND4E.statusEffect, so the effects use the icons the installed system has. */
export const STATUS_IMG = (() => {
	const start = config.findLastIndex(l => l.startsWith("DND4E.statusEffect = {"));
	const out = {};
	let id = null;
	for (let i = start + 1; i < config.length && !/^\};?/.test(config[i]); i++) {
		const key = config[i].match(/^\t([A-Za-z0-9]+):\s*\{/);
		if (key) id = key[1];
		const img = config[i].match(/img:\s*"([^"]+)"/);
		if (img && id) out[id] = img[1];
	}
	return out;
})();

/** lowercase label -> key of a `DND4E.<name>` table whose values are lang keys ("Longsword" -> "longsword" for militaryM). */
export const labelMap = name => new Map(entriesOf(name).map(([k, raw]) => [(labelOf(raw) ?? k).toLowerCase(), k]));
