/**
 * Foundry VTT script macro: an end-to-end smoke test of the database and of what the importer writes, against the REAL dnd4e system.
 *
 * It creates NOTHING in the world: every actor here is built in memory (`new Actor.implementation(data)`), prepared by the system
 * and inspected. Run it in a world that uses the dnd4e system, with the dnd4e-importer module active and the database published
 * (npm run publish in the collector). A scratch world is best, but it is read-only.
 *
 *   1. Create a Script macro and paste this file.   2. Run it.   3. Read the dialog (the table is also in the console, F12).
 *
 * What it answers (each a pass/fail line):
 *   A. monsters   the printed numbers survive the NPC model and the system's own derived data (defences, initiative, speed, skills,
 *                 resistances, hit points), and a monster power keeps its printed attack and damage formulas
 *   B. effects    a power's conditions apply to a target (the status is there), a "-2 penalty" lowers the real defence, bonuses of
 *                 the same type do not stack while different types do, a resistance shows in the resistance table
 *   C. features   a feat/feature bonus transfers to its owner (+2 feat bonus to Perception), typed vs untyped stacking
 *   D. patches    the race and class "fill the sheet" updates are accepted by the model and give the numbers the book gives
 */
const MODULE_ID = "dnd4e-importer";
const base = (game.settings.get(MODULE_ID, "dbPath") || "dnd4e-db").replace(/^\/+|\/+$/g, "");
const get = async path => {
	const response = await fetch(foundry.utils.getRoute(`${base}/${path}`));
	if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
	return response.json();
};

const results = [];
const record = (group, test, ok, actual, expected) => results.push({ group, test, result: ok ? "PASS" : "FAIL", actual: JSON.stringify(actual), expected: ok ? "" : JSON.stringify(expected) });
const eq = (group, test, actual, expected) => record(group, test, JSON.stringify(actual) === JSON.stringify(expected), actual, expected);
const near = (group, test, actual, expected, tolerance = 0) => record(group, test, Math.abs(actual - expected) <= tolerance, actual, expected);
/** Runs a test body; a thrown error is a failed test with its message, not the end of the run. */
const run = async (group, name, body) => {
	try { await body(); } catch (error) { record(group, name, false, `${error.name}: ${error.message}`.slice(0, 160), "no error"); console.error(error); }
};

const clone = data => foundry.utils.deepClone(data);
const make = (data, extra = {}) => new Actor.implementation(foundry.utils.mergeObject(clone(data), extra, { inplace: false }));
const fx = (name, statuses, changes = [], system = {}) => ({
	_id: foundry.utils.randomID(), name, statuses, transfer: false,
	system: { changes, durationType: "", powerEffectType: "hit", dots: [], keywords: [], ...system },
});
const change = (key, type, value) => ({ key, type, value: String(value), priority: null });

/* ---- the data ---- */
const monsterIndex = await get("monster/_index.json");
const loadMonster = async name => {
	const row = monsterIndex.find(r => r.name === name);
	if (!row) throw new Error(`monster "${name}" is not in the database`);
	return (await get(`monster/${row.file}`)).find(a => a._id === row._id);
};
const powerIndex = await get("power/_index.json");
const loadPower = async name => {
	const row = powerIndex.find(r => r.name === name);
	if (!row) throw new Error(`power "${name}" is not in the database`);
	return (await get(`power/${row.file}`)).filter(i => row.items.includes(i._id));
};
const optionEntry = async (kind, name) => {
	const index = await get(`option/${kind}/_index.json`);
	const row = index.find(r => r.name === name);
	if (!row) throw new Error(`${kind} "${name}" is not in the database`);
	return (await get(`option/${kind}/entries.json`)).find(e => e._id === row._id);
};
/** The option (feat, path, destiny...) that has an item of this name: "Epic Combatant" is a feature of the destiny "Destined Scion". */
const optionWithItem = async (kind, itemName) => {
	const entry = (await get(`option/${kind}/entries.json`)).find(e => e.items.some(i => i.name === itemName));
	if (!entry) throw new Error(`no ${kind} has an item "${itemName}"`);
	return entry;
};
const pc = (system = {}) => ({ name: "Smoke PC", type: "Player Character", system: foundry.utils.mergeObject({ details: { level: 1 } }, system) });

/* ======================================================= A. monsters */
const cutter = await loadMonster("Goblin Cutter");
const dragon = await loadMonster("Fledgling White Dragon");

await run("A monsters", "goblin cutter", async () => {
	const a = make(cutter);
	eq("A monsters", "cutter: AC / Fort / Ref / Will are the printed 16 / 12 / 14 / 11", ["ac", "fort", "ref", "wil"].map(k => a.system.defences[k].value), [16, 12, 14, 11]);
	eq("A monsters", "cutter: initiative +5, hit points 1", [a.system.attributes.init.value, a.system.attributes.hp.max], [5, 1]);
	eq("A monsters", "cutter: Stealth +5, Perception +1 (the printed skills)", [a.system.skills.stl.total, a.system.skills.prc.total], [5, 1]);
	eq("A monsters", "cutter: speed 6, low-light vision", [a.system.movement.walk.value, a.system.senses.basic], [6, "lv"]);
	eq("A monsters", "cutter: Small size, token 1 square", [a.system.details.size, a.prototypeToken.width], ["sm", 1]);
	eq("A monsters", "cutter: two items (its attack and its trait)", a.items.map(i => i.name).sort(), ["Goblin Tactics", "Short Sword"].sort());
});

await run("A monsters", "fledgling white dragon", async () => {
	const a = make(dragon);
	eq("A monsters", "dragon: 128 hit points, bloodied 64", [a.system.attributes.hp.max, a.system.details.bloodied], [128, 64]);
	eq("A monsters", "dragon: fly speed 6, 2 action points, saving throws +5", [a.system.movement.fly.value, a.system.actionpoints.value, a.system.details.saves.value], [6, 2, 5]);
	eq("A monsters", "dragon: resist 5 cold", [a.system.resistances.cold.res, a.system.resistances.cold.value], [5, 5]);
	eq("A monsters", "dragon: Large, token 2 squares", [a.system.details.size, a.prototypeToken.width], ["lg", 2]);
});

await run("A monsters", "a monster power keeps its printed formulas", async () => {
	const a = make(dragon);
	const bite = a.items.find(i => i.name === "Bite");
	eq("A monsters", "bite: attack +6 vs AC", [bite.system.attack.isAttack, bite.system.attack.def, bite.system.attack.formula], [true, "ac", "6"]);
	eq("A monsters", "bite: damage 1d12 + 11, critical 12 + 11", [bite.system.hit.formula, bite.system.hit.critFormula], ["1d12 + 11", "12 + 11"]);
	const roll = await new Roll(bite.system.hit.formula).evaluate();
	record("A monsters", "bite: the damage formula rolls between 12 and 23", roll.total >= 12 && roll.total <= 23, roll.total, "12..23");
	eq("A monsters", "bite: the critical formula is a plain 23", (await new Roll(bite.system.hit.critFormula).evaluate()).total, 23);
});

/* ======================================================= B. effects */
await run("B effects", "a condition applies to a target", async () => {
	const breath = a => a.items.find(i => i.name === "Breath Weapon");
	const effect = breath(make(dragon)).effects.contents?.[0]?.toObject() ?? clone(dragon.items.find(i => i.name === "Breath Weapon").effects[0]);
	const target = make(cutter, { effects: [effect] });
	record("B effects", "breath weapon's slowed effect puts the 'slowed' status on the target", target.statuses.has("slowed"), [...target.statuses], ["slowed"]);
	eq("B effects", "its duration type is 'save ends'", effect.system.durationType, "saveEnd");
});

await run("B effects", "a penalty lowers the real defence", async () => {
	// Any power in the database whose effect is a plain -N penalty to AC.
	const items = (await get("power/phb.json"));
	const item = items.find(i => i.effects.some(e => e.system.changes.some(c => c.key === "system.defences.ac.untyped" && Number(c.value) < 0)));
	if (!item) throw new Error("no PHB power with an AC penalty effect found");
	const effect = item.effects.find(e => e.system.changes.some(c => c.key === "system.defences.ac.untyped" && Number(c.value) < 0));
	const penalty = Number(effect.system.changes.find(c => c.key === "system.defences.ac.untyped").value);
	const target = make(cutter, { effects: [effect] });
	eq("B effects", `"${item.name}": "${effect.name}" lowers the cutter's AC from 16`, target.system.defences.ac.value, 16 + penalty);
});

await run("B effects", "bonus stacking follows the 4e rules", async () => {
	const bonus = (type, n) => fx(`${type} +${n}`, [], [change(`system.defences.ac.${type}`, type === "untyped" ? "add" : "upgrade", n)], { powerEffectType: "self" });
	const ac = effects => make(cutter, { effects }).system.defences.ac.value;
	eq("B effects", "+2 power bonus to AC", ac([bonus("power", 2)]), 18);
	eq("B effects", "+2 and +3 power bonuses do not stack: the highest counts", ac([bonus("power", 2), bonus("power", 3)]), 19);
	eq("B effects", "a power and a feat bonus do stack", ac([bonus("power", 2), bonus("feat", 1)]), 19);
	eq("B effects", "two untyped bonuses stack", ac([bonus("untyped", 1), bonus("untyped", 1)]), 18);
	eq("B effects", "a -2 untyped penalty and a +2 power bonus cancel", ac([bonus("untyped", -2), bonus("power", 2)]), 16);
});

await run("B effects", "a resistance shows in the resistance table", async () => {
	const resist = fx("Resist 5 to all damage", [], ["fire", "cold", "necrotic", "acid"].map(t => change(`system.resistances.${t}.res`, "upgrade", 5)), { powerEffectType: "self" });
	const a = make(cutter, { effects: [resist] });
	eq("B effects", "resist 5 fire / cold / necrotic / acid", ["fire", "cold", "necrotic", "acid"].map(t => a.system.resistances[t].value), [5, 5, 5, 5]);
	eq("B effects", "a type the effect does not name is untouched", a.system.resistances.thunder.value, 0);
	const withNative = make(dragon, { effects: [resist] });
	eq("B effects", "an effect resist 5 does not add to the dragon's own resist 5 cold (the highest counts)", withNative.system.resistances.cold.value, 5);
});

/* ======================================================= C. features */
await run("C features", "a feat's bonus transfers to its owner", async () => {
	const feat = await optionEntry("feat", "Adamant Arrow Student");
	const withFeat = make(pc(), { items: clone(feat.items) });
	const without = make(pc());
	eq("C features", `"${feat.items[0].name}" is an item with one transferred effect`, [withFeat.items.size, feat.items[0].effects.length, feat.items[0].effects[0].transfer], [1, 1, true]);
	eq("C features", "Perception goes up by the feat's +2", withFeat.system.skills.prc.total - without.system.skills.prc.total, 2);
	record("C features", "the effect is on the owner's applicable effects", [...withFeat.allApplicableEffects()].some(e => e.name.includes("Perception")), [...withFeat.allApplicableEffects()].map(e => e.name), "a Perception effect");
});

await run("C features", "feat and untyped bonuses to the same skill", async () => {
	const feat = await optionEntry("feat", "Adamant Arrow Student");
	const twin = clone(feat.items[0]);
	twin._id = foundry.utils.randomID();
	twin.effects = twin.effects.map(e => ({ ...e, _id: foundry.utils.randomID() }));
	const base0 = make(pc()).system.skills.prc.total;
	eq("C features", "two +2 feat bonuses to Perception: still +2", make(pc(), { items: [clone(feat.items[0]), twin] }).system.skills.prc.total - base0, 2);
	const untyped = { _id: foundry.utils.randomID(), name: "Untyped test", type: "feature", system: { featureType: "other" }, effects: [{ ...fx("+3 bonus to Perception", [], [change("system.skills.prc.untyped", "add", 3)], { powerEffectType: "misc" }), transfer: true }] };
	eq("C features", "a feat +2 and an untyped +3: +5", make(pc(), { items: [clone(feat.items[0]), untyped] }).system.skills.prc.total - base0, 5);
});

await run("C features", "a feature's saving-throw and defence bonuses", async () => {
	const destiny = await optionWithItem("destiny", "Epic Combatant");
	const item = destiny.items.find(i => i.name === "Epic Combatant");
	const a = make(pc(), { items: [clone(item)] });
	const b = make(pc());
	eq("C features", "Epic Combatant: +2 to saving throws", a.system.details.saves.value - b.system.details.saves.value, 2);
});

/* ======================================================= D. patches */
/**
 * A fresh actor made from the source data with an update ("system.a.b": value) merged in. Not updateSource + prepareData on the same
 * actor: the system's derived data adds to itself (value += bonus), so preparing twice counts every bonus twice.
 */
const patched = (data, update) => make(data, foundry.utils.expandObject(update));
const raceModule = await import(`/modules/${MODULE_ID}/scripts/race.mjs`);
const classModule = await import(`/modules/${MODULE_ID}/scripts/class.mjs`);

await run("D patches", "the elf", async () => {
	const index = await get("race/_index.json");
	const row = index.find(r => r.name === "Elf");
	const entry = (await get("race/races.json")).find(e => e._id === row._id);
	const plain = make(pc());
	const before = plain.system.skills.nat.total;
	const actor = patched(pc(), raceModule.racePatch(plain.system, entry.apply).update);
	eq("D patches", "elf: race, size, vision", [actor.system.details.race, actor.system.details.size, actor.system.senses.basic], ["Elf", "med", "lv"]);
	eq("D patches", "elf: speed 7", actor.system.movement.walk.value, 7);
	eq("D patches", "elf: Nature and Perception +2 (racial)", [actor.system.skills.nat.total - before, actor.system.skills.prc.total - make(pc()).system.skills.prc.total], [2, 2]);
	eq("D patches", "elf: speaks Common and Elven", [...actor.system.languages.spoken.value].sort(), ["Common", "Elven"]);
});

await run("D patches", "the human's racial defence bonuses", async () => {
	const row = (await get("race/_index.json")).find(r => r.name === "Human");
	const entry = (await get("race/races.json")).find(e => e._id === row._id);
	const plain = make(pc());
	const before = ["fort", "ref", "wil"].map(k => plain.system.defences[k].value);
	const actor = patched(pc(), raceModule.racePatch(plain.system, entry.apply).update);
	eq("D patches", "human: +1 Fortitude, Reflex and Will", ["fort", "ref", "wil"].map((k, i) => actor.system.defences[k].value - before[i]), [1, 1, 1]);
});

await run("D patches", "the knight (a fighter build)", async () => {
	const row = (await get("class/_index.json")).find(r => r.name === "Fighter (Knight)");
	const entry = (await get("class/classes.json")).find(e => e._id === row._id);
	const source = pc({ abilities: { con: { value: 14 } } });
	const plain = make(source);
	const fortBefore = plain.system.defences.fort.value;
	const actor = patched(source, classModule.classPatch(plain.system, entry.apply).update);
	eq("D patches", "knight: primary ability Strength, class 'Fighter (Knight)'", [actor.system.details.primaryAbility, actor.system.details.class], ["str", "Fighter (Knight)"]);
	eq("D patches", "knight: 15 + Constitution 14 = 29 hit points at level 1", actor.system.attributes.hp.max, 29);
	eq("D patches", "knight: 9 + Constitution modifier (+2) = 11 healing surges", actor.system.details.surges.max, 11);
	eq("D patches", "knight: +2 Fortitude (class)", actor.system.defences.fort.value - fortBefore, 2);
	eq("D patches", "knight: proficient with plate and heavy shields", ["plate", "heavy"].map(k => actor.system.details.armourProf.value.has(k)), [true, true]);
	eq("D patches", "knight: military melee weapons", actor.system.details.weaponProf.value.has("militaryM"), true);
});

/* ======================================================= report */
const failed = results.filter(r => r.result === "FAIL");
console.log(`dnd4e smoke test: ${results.length - failed.length}/${results.length} passed`);
console.table(results);

const rows = results.map(r => `<tr style="${r.result === "FAIL" ? "color:#d33;font-weight:600" : ""}"><td>${r.result}</td><td>${foundry.utils.escapeHTML(r.group)}</td><td>${foundry.utils.escapeHTML(r.test)}</td><td>${r.result === "FAIL" ? `${foundry.utils.escapeHTML(r.actual)} (expected ${foundry.utils.escapeHTML(r.expected)})` : ""}</td></tr>`).join("");
const html = `<p><strong>${results.length - failed.length}</strong> of <strong>${results.length}</strong> checks passed. Nothing was created in this world.</p>`
	+ `<div style="max-height:420px;overflow:auto"><table style="width:100%;font-size:0.85em"><tbody>${rows}</tbody></table></div>`;
if (foundry.applications?.api?.DialogV2) await foundry.applications.api.DialogV2.prompt({ window: { title: "dnd4e smoke test", resizable: true }, position: { width: 820 }, content: html, ok: { label: "Close" } });
else ui.notifications.info(`${results.length - failed.length}/${results.length} passed (see the console)`);
