/**
 * Foundry VTT script macro: validates DB item files against the installed dnd4e PowerData model.
 * Nothing is saved. Run it in a world that uses the dnd4e system.
 *
 * 1. Create a Script macro and paste this file.
 * 2. Run it and pick one or more files from out/db/power/ (e.g. PHB.json). Do not pick _index.json.
 * 3. Read the summary dialog (the full list is also in the console, F12).
 *
 * Two kinds of problems are reported:
 *  - "invalid": the model rejected the item (bad value, wrong type).
 *  - "dropped": a field we wrote does not exist in PowerData and was silently discarded.
 */
const files = await new Promise(resolve => {
	const input = document.createElement("input");
	input.type = "file";
	input.multiple = true;
	input.accept = ".json";
	input.onchange = () => resolve([...input.files]);
	input.click();
});
if (!files.length) return;

const items = [];
for (const file of files) {
	if (file.name.startsWith("_")) continue;
	const data = JSON.parse(await file.text());
	if (Array.isArray(data)) items.push(...data);
}

const problems = new Map();
const add = (msg, name) => {
	const p = problems.get(msg) ?? { count: 0, examples: [] };
	p.count++;
	if (p.examples.length < 3) p.examples.push(name);
	problems.set(msg, p);
};

/** Paths present in `input` that are missing from `output`. */
const missing = (input, output, path, out) => {
	for (const [key, value] of Object.entries(input ?? {})) {
		const here = `${path}.${key}`;
		if (!output || !(key in output)) { out.push(here); continue; }
		if (value && typeof value === "object" && !Array.isArray(value)) missing(value, output[key], here, out);
	}
};

let ok = 0;
for (const data of items) {
	try {
		const doc = await Item.implementation.create(foundry.utils.deepClone(data), { temporary: true });
		const dropped = [];
		missing(data.system, doc.toObject().system, "system", dropped);
		// The effects embedded in the item: every one must survive the model with its statuses, timing and dots.
		for (const fx of data.effects ?? []) {
			const kept = doc.effects.get(fx._id)?.toObject();
			if (!kept) { dropped.push(`effects.${fx.name}`); continue; }
			if (JSON.stringify([...(kept.statuses ?? [])].sort()) !== JSON.stringify([...(fx.statuses ?? [])].sort())) dropped.push(`effects.${fx.name}.statuses`);
			for (const key of ["durationType", "powerEffectType"]) if (kept.system?.[key] !== fx.system[key]) dropped.push(`effects.${fx.name}.system.${key}`);
			if ((kept.system?.dots?.length ?? 0) !== fx.system.dots.length) dropped.push(`effects.${fx.name}.system.dots`);
		}
		if (dropped.length) dropped.forEach(path => add(`dropped: ${path}`, data.name));
		else ok++;
	} catch (err) {
		add(`invalid: ${String(err.message).split("\n")[0].slice(0, 160)}`, data.name);
	}
}

const rows = [...problems.entries()].sort((a, b) => b[1].count - a[1].count);
console.log(`dnd4e DB check: ${ok}/${items.length} items clean`);
console.table(rows.map(([msg, p]) => ({ problem: msg, count: p.count, examples: p.examples.join(", ") })));

const html = `<p><strong>${ok}</strong> of <strong>${items.length}</strong> items are clean.</p>`
	+ (rows.length ? `<ul>${rows.slice(0, 15).map(([msg, p]) => `<li>${p.count} × ${foundry.utils.escapeHTML(msg)} <em>(${foundry.utils.escapeHTML(p.examples.join(", "))})</em></li>`).join("")}</ul>` : "<p>No problems found.</p>");
if (foundry.applications?.api?.DialogV2) {
	await foundry.applications.api.DialogV2.prompt({ window: { title: "dnd4e DB check" }, content: html, ok: { label: "Close" } });
} else ui.notifications.info(`${ok}/${items.length} items clean (see console)`);
