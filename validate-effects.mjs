/**
 * Static checks of the ActiveEffects embedded in a power item against the installed dnd4e system's enumerations.
 * Used by validate-db.mjs (over the whole DB) and by the tests.
 */
import { ENUMS, STATUS_IMG } from "./system-enums.mjs";

const ICONS = new Set(Object.values(STATUS_IMG));

const PLAIN = "feat|item|power|race|untyped";
const alt = list => list.join("|");
/** The keys a change may have, each tied to a field the sheet or the roll code reads (checked against the installed system). */
const KEYS = [
	new RegExp(String.raw`^system\.defences\.(?:${alt(ENUMS.defences)})\.(?:${PLAIN}|shield|enhance|class)$`),
	new RegExp(String.raw`^system\.movement\.base\.(?:${PLAIN})$`),
	new RegExp(String.raw`^system\.details\.(?:saves|deathsavebon)\.(?:${PLAIN})$`),
	new RegExp(String.raw`^system\.attributes\.init\.(?:${PLAIN})$`),
	new RegExp(String.raw`^system\.skills\.(?:${alt(ENUMS.skills)})\.(?:${PLAIN})$`),
	new RegExp(String.raw`^system\.modifiers\.(?:skills|abilities)\.(?:${PLAIN})$`),
	new RegExp(String.raw`^system\.resistances\.(?:${alt(ENUMS.damageTypes)})\.(?:res|vuln)$`),
	// The system's own keyed bonuses: owner.effectType.keyword.bonusType
	new RegExp(String.raw`^power\.(?:attack|damage)\.(?:global|melee|ranged|weapon|usesImplement|opp|charge|basic|mBasic|rBasic)\.(?:${PLAIN})$`),
];
const TYPES = ["add", "upgrade", "downgrade"];

/** The change type the stacking rules need: untyped bonuses add up, typed ones take the highest, resistances the highest (vulnerabilities the lowest). */
function expectedType(key) {
	if (/\.(?:res)$/.test(key)) return "upgrade";
	if (/\.(?:vuln)$/.test(key)) return "downgrade";
	if (key.startsWith("power.")) return "add";
	return key.endsWith(".untyped") ? "add" : "upgrade";
}

/** @returns {string[]} what is wrong with the item's effects (empty when it is all fine) */
export function effectProblems(item, seenIds = new Set()) {
	const problems = [];
	const effects = item.effects;
	if (!Array.isArray(effects)) return ["effects is not an array"];
	for (const e of effects) {
		if (!/^[A-Za-z0-9]{16}$/.test(e._id ?? "")) problems.push("effect _id is not a 16-char id");
		if (seenIds.has(e._id)) problems.push("duplicate effect _id");
		seenIds.add(e._id);
		if (!e.name) problems.push("effect without a name");
		// A power's effects are applied to targets when it is used; a feature's stay on the character while it is owned.
		const transfers = item.type === "feature";
		if (e.transfer !== transfers) problems.push(transfers ? "a feature's effect must transfer to its owner" : "a power's effect must not transfer to its owner");
		if (e.img !== undefined && !ICONS.has(e.img)) problems.push(`effect img "${e.img}" is not a status icon of the system`);
		for (const s of e.statuses ?? []) if (!ENUMS.statusEffects.includes(s)) problems.push(`status "${s}" is not one of the system's statuses`);
		const sys = e.system ?? {};
		if (sys.durationType !== "" && !ENUMS.durationType.includes(sys.durationType)) problems.push(`durationType "${sys.durationType}" not in the system's durationType`);
		if (!ENUMS.powerEffectTypes.includes(sys.powerEffectType)) problems.push(`powerEffectType "${sys.powerEffectType}" not in the system's powerEffectTypes`);
		if (!Array.isArray(sys.keywords)) problems.push("system.keywords must be an array (the system adds to it)");
		if (!Array.isArray(sys.changes)) problems.push("system.changes must be an array");
		for (const d of sys.dots ?? []) {
			if (!/^\d+$/.test(d.amount)) problems.push(`dot amount "${d.amount}" is not a whole number string`);
			for (const t of d.types) if (!ENUMS.damageTypes.includes(t)) problems.push(`dot type "${t}" is not a damage type`);
		}
		for (const c of sys.changes ?? []) {
			if (!KEYS.some(re => re.test(c.key))) problems.push(`change key "${c.key}" is not a field the sheet or the roll code reads`);
			if (!TYPES.includes(c.type)) problems.push(`change type "${c.type}" is not one of ${TYPES.join("/")}`);
			else if (KEYS.some(re => re.test(c.key)) && c.type !== expectedType(c.key)) problems.push(`change on "${c.key}" should be "${expectedType(c.key)}", not "${c.type}" (stacking rules)`);
			if (!/^-?\d+$/.test(String(c.value))) problems.push(`change value "${c.value}" is not a whole number`);
			if (c.key.endsWith(".vuln") && Number(c.value) > 0) problems.push("a vulnerability must be negative");
		}
		if (!(e.statuses?.length || sys.dots?.length || sys.changes?.length)) problems.push("an effect that does nothing (no status, dot or change)");
	}
	return problems;
}
