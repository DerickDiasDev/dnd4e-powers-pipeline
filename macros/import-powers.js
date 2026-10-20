/**
 * Foundry VTT script macro: imports a power (with its melee/ranged version and child powers) from a DB file into an actor.
 * A minimal importer for testing. It creates real items on the actor, so use a test character.
 *
 * 1. Select a token (or set your character) of the actor that should receive the power.
 * 2. Run the macro and pick one file from out/db/power/ (e.g. dscs.json). Do not pick _index.json.
 * 3. Type part of the power's name. If several bundles match, choose one.
 * 4. The power appears on the actor's Powers tab.
 *
 * Every item of the chosen bundle is created together: the main power, its ranged variant (when the power was split into
 * "Name (Melee)" / "Name (Ranged)") and any child powers. Importing twice creates a second copy.
 */
const actor = canvas.tokens?.controlled[0]?.actor ?? game.user.character;
if (!actor) return ui.notifications.warn("Select a token (or set your character) first.");

const file = await new Promise(resolve => {
	const input = document.createElement("input");
	input.type = "file";
	input.accept = ".json";
	input.onchange = () => resolve(input.files[0]);
	input.click();
});
if (!file) return;
if (file.name.startsWith("_")) return ui.notifications.warn("Pick a book file (e.g. dscs.json), not _index.json.");

const items = JSON.parse(await file.text());
const mains = items.filter(i => i.flags?.dnd4e?.import?.role === "main");

const { DialogV2 } = foundry.applications.api;
const query = await DialogV2.prompt({
	window: { title: `Import a power into ${actor.name}` },
	content: `<p>${mains.length} powers in ${foundry.utils.escapeHTML(file.name)}. Part of the name:</p><input type="text" name="q" autofocus style="width:100%">`,
	ok: { label: "Search", callback: (event, button) => button.form.elements.q.value.trim() },
	rejectClose: false,
});
if (!query) return;

const matches = mains.filter(i => i.name.toLowerCase().replace(/ \((melee|ranged)\)$/, "").includes(query.toLowerCase()));
if (!matches.length) return ui.notifications.warn(`No power named like "${query}" in ${file.name}.`);

const bundleOf = main => items.filter(i => i.flags.dnd4e.import.bundle === main.flags.dnd4e.import.bundle);
let chosen = matches[0];
if (matches.length > 1) {
	const options = matches.slice(0, 40).map(m => {
		const size = bundleOf(m).length;
		return `<option value="${m._id}">${foundry.utils.escapeHTML(m.name)} — level ${m.system.level ?? "-"}, ${m.system.useType}, ${foundry.utils.escapeHTML(m.system.powersourceName)}${size > 1 ? ` (${size} items)` : ""}</option>`;
	}).join("");
	const id = await DialogV2.prompt({
		window: { title: `${matches.length} matches` },
		content: `<select name="id" style="width:100%">${options}</select>${matches.length > 40 ? "<p>Showing the first 40. Refine the search to see others.</p>" : ""}`,
		ok: { label: "Import", callback: (event, button) => button.form.elements.id.value },
		rejectClose: false,
	});
	if (!id) return;
	chosen = matches.find(m => m._id === id);
}

const bundle = bundleOf(chosen).map(i => foundry.utils.deepClone(i));
const created = await actor.createEmbeddedDocuments("Item", bundle);
ui.notifications.info(`Imported ${created.length} item(s) into ${actor.name}: ${created.map(i => i.name).join(", ")}`);
console.log("dnd4e import:", created);
