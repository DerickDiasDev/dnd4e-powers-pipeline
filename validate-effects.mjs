/**
 * Static checks of the ActiveEffects embedded in a power item against the installed dnd4e system's enumerations.
 * Used by validate-db.mjs (over the whole DB) and by the tests.
 */
import { ENUMS, STATUS_IMG } from "./system-enums.mjs";

const ICONS = new Set(Object.values(STATUS_IMG));

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
		if (e.transfer !== false) problems.push("a power's effect must not transfer to its owner");
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
		if (!(e.statuses?.length || sys.dots?.length || sys.changes?.length)) problems.push("an effect that does nothing (no status, dot or change)");
	}
	return problems;
}
