/**
 * The powers of a magic item as `power` items. A magic item's page has one section per power ("Power (Fire) ✦ Daily (Free Action)",
 * "Utility Power ✦ Encounter (Minor Action)", "Attack Power (Lightning) ✦ At-Will (Standard Action)") followed by its lines (Trigger,
 * Attack, Hit, Effect...). Each section is turned into a PowerData item by the same converter the monsters' powers use, so the
 * usage, the action, the keywords, the range, an attack with a plain "+N vs. Defence", a damage roll and the conditions it applies
 * come out as the system's own fields and effects.
 *
 * Many powers get stronger with the item's level: "Level 13 or 18: 2d8 lightning damage". Those lines are not part of the power: they
 * are kept in `flags.dnd4e.import.scaling` as {line, levels, text}, and the importer applies the ones that hold for the level it
 * imports the item at.
 *
 * The system links an item to its powers by UUID (`system.itemPowers`) and copies them to the actor while the item is equipped, so
 * the importer creates these power items next to the item and fills `itemPowers`.
 */
import { convertPowerItem } from "./build-monsters.mjs";
import { readAttack } from "./parse-monsters.mjs";
import { txt } from "./parse-powers.mjs";

export const ITEM_POWER_SCHEMA_VERSION = 1;

const ICONS = ["⚔", "➶", "ᗕ", "✺", "ᘖ"];
const ACTIONS = { standard: "standard", move: "move", minor: "minor", free: "free", "immediate reaction": "reaction", "immediate interrupt": "interrupt", reaction: "reaction", interrupt: "interrupt", "opportunity action": "opportunity", opportunity: "opportunity", "no action": "none" };
const actionOf = text => {
	const t = String(text ?? "").toLowerCase().trim();
	return ACTIONS[t] ?? ACTIONS[t.replace(/\s+action$/, "")] ?? null;
};

/** True for the heading of a power section. */
export const isPowerHeading = heading => /power|✦/i.test(heading);

/**
 * "⚔ Attack Power (Lightning) ✦ Daily (Minor Action)" -> { icon, kind: "attack", keywords: ["Lightning"], usage: "daily", action: "minor" }.
 * `kind` is attack, utility or null (a plain "Power"); a usage the system has no word for (a consumable's) is "item".
 */
export function parseHeading(heading) {
	const text = txt(heading);
	const icon = ICONS.find(i => text.includes(i)) ?? null;
	const [before, ...rest] = text.split("✦");
	const after = rest.join("✦");
	let action = null;
	const keywords = [];
	for (const m of before.matchAll(/\(([^)]*)\)/g)) {
		if (actionOf(m[1])) action = actionOf(m[1]);
		else keywords.push(...m[1].split(/\s*,\s*/).map(s => s.trim()).filter(Boolean));
	}
	const kind = /\bAttack\b/i.test(before) ? "attack" : /\bUtility\b/i.test(before) ? "utility" : (/\bUtility\b/i.test(after) ? "utility" : null);
	const usageWord = (after.match(/At-?Will|Encounter|Daily|Consumable|Recharge/i)?.[0] ?? "").toLowerCase().replace("-", "");
	const usage = { atwill: "atwill", encounter: "encounter", daily: "daily", consumable: "item", recharge: "recharge" }[usageWord] ?? null;
	const paren = after.match(/\(([^)]*)\)/)?.[1];
	if (paren && actionOf(paren)) action = actionOf(paren);
	return { icon, kind, keywords, usage, action };
}

const SCALING = /^Levels?\s+(\d+(?:\s*(?:,|or|and|&)\s*\d+)*)\s*:\s*(.*)$/i;
const LABEL = /^([A-Z][A-Za-z' ]{0,40}):\s*(.*)$/;

/** The lines of a power (labelled when the text starts with "Label:") and the scaling lines that follow some of them. */
export function parseLines(paragraphs) {
	const lines = [], scaling = [];
	for (const p of paragraphs) {
		const s = p.text.match(SCALING);
		if (s) {
			const levels = [...s[1].matchAll(/\d+/g)].map(m => Number(m[0]));
			scaling.push({ line: (lines.at(-1)?.label ?? "").toLowerCase(), levels, text: s[2].trim() });
			continue;
		}
		const l = p.text.match(LABEL);
		lines.push(l ? { label: l[1].trim(), text: l[2].trim() } : { label: "", text: p.text.trim() });
	}
	return { lines, scaling };
}

/**
 * @param {object} m   a parsed magic item
 * @returns {object[]} the item's powers as `power` items (empty when it has none)
 */
export function buildItemPowers(m) {
	const sections = m.sections.filter(s => isPowerHeading(s.heading) && s.paragraphs.length);
	const first = m.tiers[0];
	const host = { id: m.id, level: first?.level ?? 1, name: m.name, sourceCode: m.sourceCode, traits: [] };
	return sections.map((section, index) => {
		const head = parseHeading(section.heading);
		const { lines, scaling } = parseLines(section.paragraphs);
		const name = sections.length > 1 ? `${m.name} (${{ atwill: "At-Will", encounter: "Encounter", daily: "Daily", item: "Consumable" }[head.usage] ?? "Power"}${sections.filter((s, i) => i < index && parseHeading(s.heading).usage === head.usage).length ? ` ${index + 1}` : ""})` : m.name;
		const power = {
			name, keywords: head.keywords, usage: head.usage, action: head.action, icon: head.icon, limit: null, recharge: null,
			lines, text: lines.map(l => `${l.label ? `${l.label}: ` : ""}${l.text}`).join("\n"),
			attack: readAttack(lines),
		};
		const item = convertPowerItem(host, power, index);
		// "the weapon's level + 3 vs. Reflex": the bonus is the item's level plus a number, so it follows the level the item is imported at.
		const levelAttack = lines.map(l => l.text).join(" ").match(/(?:^|[ ;:])(?:[A-Za-z]+(?: [A-Za-z]+)?)'s level\s*\+\s*(\d+)\s+vs\.?\s+(AC|Fortitude|Reflex|Will)\b/i);
		if (levelAttack && !item.system.attack.isAttack) {
			const offset = Number(levelAttack[1]);
			Object.assign(item.system.attack, { isAttack: true, def: { ac: "ac", fortitude: "fort", reflex: "ref", will: "wil" }[levelAttack[2].toLowerCase()], formula: String((first?.level ?? 1) + offset) });
			item.flags.dnd4e.import.review = (item.flags.dnd4e.import.review ?? []).filter(r => r !== "attack-unparsed");
			item.flags.dnd4e.import.attackLevelOffset = offset;
		}
		if (head.kind === "attack") item.system.powerSubtype = "attack";
		else if (head.kind === "utility") item.system.powerSubtype = "utility";
		item.flags.dnd4e.import = {
			...item.flags.dnd4e.import,
			kind: "magic-power", id: m.id, role: "power", section: index, schema: ITEM_POWER_SCHEMA_VERSION,
			...(scaling.length ? { scaling } : {}),
		};
		return item;
	});
}
