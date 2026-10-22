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
 *   E. equipment  armour, shields and weapons change the sheet as the book says (AC, speed, armour check, dice, proficiency); gear is accepted
 *   F. magic      a level chosen at import gives its enhancement and price; plain bonuses work only while equipped; a magic weapon based on a
 *                 mundane one rolls its dice; magic armour of one kind is that armour plus the enhancement
 *   G. rituals    a ritual is accepted by the model with its category, times and the skill it rolls
 *   H. extras     a deity writes its name into the sheet; diseases and companions, poisons, traps (NPCs with printed numbers) and glossary entries
 *                 (journal entries) are accepted by the model
 *   I. item powers the powers of a magic item are power items with the numbers of the level it is imported at (the equip/copy flow needs a world: see the README)
 *   K. consumables a consumable is its own power: it takes the attack and damage of the level it is imported at
 *   J. armour base a magic armour that names several kinds takes the bonus, penalties and kind of the armour or shield it is based on
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

/* ======================================================= E. equipment */
const gearModule = await import(`/modules/${MODULE_ID}/scripts/gear.mjs`);
const magicModule = await import(`/modules/${MODULE_ID}/scripts/magic.mjs`);
const planModule = await import(`/modules/${MODULE_ID}/scripts/plan.mjs`);
const gearIndex = await get("gear/_index.json");
const gearEntry = async name => {
	const row = gearIndex.find(r => r.name === name);
	if (!row) throw new Error(`gear "${name}" is not in the database`);
	return (await get("gear/gear.json")).find(e => e._id === row._id);
};
/** The item data of an entry as an import would create it, optionally equipped. */
const gearItems = async (name, equip = false) => {
	const entry = await gearEntry(name);
	const { create } = gearModule.planGearImport(entry);
	return equip ? gearModule.equipItems(create) : create;
};

await run("E equipment", "armour: heavy armour changes AC, speed and the armour-check skills only while worn", async () => {
	const plain = make(pc());
	const worn = make(pc(), { items: await gearItems("Plate Armor", true) });
	const packed = make(pc(), { items: await gearItems("Plate Armor", false) });
	eq("E equipment", "plate armour worn: +8 AC", worn.system.defences.ac.value - plain.system.defences.ac.value, 8);
	eq("E equipment", "plate armour worn: speed -1", worn.system.movement.walk.value - plain.system.movement.walk.value, -1);
	eq("E equipment", "plate armour worn: Stealth -2 (armour check)", worn.system.skills.stl.total - plain.system.skills.stl.total, -2);
	eq("E equipment", "plate armour only carried: nothing changes", [packed.system.defences.ac.value - plain.system.defences.ac.value, packed.system.movement.walk.value - plain.system.movement.walk.value], [0, 0]);
});

await run("E equipment", "armour: a shield gives its bonus to AC and Reflex, and only to who is proficient", async () => {
	const plain = make(pc());
	const trained = make(pc({ details: { armourProf: { value: ["heavy"] } } }), { items: await gearItems("Heavy Shield", true) });
	const untrained = make(pc(), { items: await gearItems("Heavy Shield", true) });
	const reference = make(pc({ details: { armourProf: { value: ["heavy"] } } }));
	eq("E equipment", "heavy shield, proficient: +2 AC and +2 Reflex", ["ac", "ref"].map(k => trained.system.defences[k].value - reference.system.defences[k].value), [2, 2]);
	eq("E equipment", "heavy shield, not proficient: no benefit", ["ac", "ref"].map(k => untrained.system.defences[k].value - plain.system.defences[k].value), [0, 0]);
});

await run("E equipment", "a weapon rolls the dice of the book and knows what it is proficient with", async () => {
	const sword = make(pc({ details: { weaponProf: { value: ["militaryM"] } } }), { items: await gearItems("Longsword") }).items.find(i => i.name === "Longsword");
	eq("E equipment", "longsword: weapon dice 1d8", sword.getWepDice(), "1d8");
	eq("E equipment", "longsword: proficient for a military melee character", sword.isActorProficient, true);
	const untrained = make(pc(), { items: await gearItems("Longsword") }).items.find(i => i.name === "Longsword");
	eq("E equipment", "longsword: not proficient for a character with no weapon training", untrained.isActorProficient, false);
	const bow = make(pc(), { items: await gearItems("Longbow") }).items.find(i => i.name === "Longbow");
	eq("E equipment", "longbow: dice 1d10, ranged, range 20/40", [bow.getWepDice(), bow.system.isRanged, bow.system.range.value, bow.system.range.long], ["1d10", true, 20, 40]);
});

await run("E equipment", "a double weapon is two items, ammunition is a pack, gear is loot", async () => {
	const axe = await gearItems("Double axe");
	eq("E equipment", "double axe: both ends", axe.map(i => i.name), ["Double axe", "Double axe - secondary end"]);
	const a = make(pc(), { items: [...axe, ...(await gearItems("Arrows")), ...(await gearItems("Alchemy Case"))] });
	eq("E equipment", "arrows: 30 of them, ammunition", [a.items.find(i => i.name === "Arrows").system.quantity, a.items.find(i => i.name === "Arrows").system.consumableType], [30, "ammo"]);
	eq("E equipment", "alchemy case: loot, 40 gp", [a.items.find(i => i.name === "Alchemy Case").type, a.items.find(i => i.name === "Alchemy Case").system.price], ["loot", 40]);
});

await run("E equipment", "masterwork armour and a rod implement are accepted by the model", async () => {
	const a = make(pc(), { items: [...await gearItems("Baazrag Bone Armor", true), ...await gearItems("Rod Implement")] });
	const armour = a.items.find(i => i.name === "Baazrag Bone Armor");
	eq("E equipment", "baazrag bone armour: AC bonus 8, and 'Minimum enhancement: +2' in the text", [armour.system.armour.ac, armour.system.description.value.includes("Minimum enhancement:</strong> +2")], [8, true]);
	eq("E equipment", "rod implement: an implement of group rod", [a.items.find(i => i.name === "Rod Implement").system.weaponType, a.items.find(i => i.name === "Rod Implement").system.weaponBaseType], ["implement", "rod"]);
});

/* ======================================================= F. magic items */
const magicIndex = await get("magic/_index.json");
const magicRow = name => {
	const row = magicIndex.find(r => r.name === name);
	if (!row) throw new Error(`magic item "${name}" is not in the database`);
	return row;
};
const magicEntry = async row => (await get(`magic/${row.file}`)).find(e => e._id === row._id);
/** The item an import would create at `level` (null: the first), optionally based on a weapon and equipped. */
const magicItem = async (name, { level = null, base = null, equip = false } = {}) => {
	const row = magicRow(name);
	const entry = await magicEntry(row);
	const { create } = magicModule.planMagicImport(entry, row, new Set(), { level, baseWeapon: base });
	return { row, items: equip ? gearModule.equipItems(create) : create };
};

await run("F magic", "a magic item's plain bonus works only while it is equipped", async () => {
	const base0 = make(pc()).system.skills.thi.total;
	const worn = make(pc(), { items: (await magicItem("Burglar's Gloves", { equip: true })).items });
	const packed = make(pc(), { items: (await magicItem("Burglar's Gloves")).items });
	eq("F magic", "burglar's gloves worn: Thievery +1", worn.system.skills.thi.total - base0, 1);
	eq("F magic", "burglar's gloves only carried: the effect is there but suppressed", [packed.system.skills.thi.total - base0, [...packed.allApplicableEffects()].some(e => e.isSuppressed)], [0, true]);
});

await run("F magic", "a level is chosen at import: enhancement, price and name follow", async () => {
	const { items } = await magicItem("Magic Holy Symbol", { level: 11 });
	eq("F magic", "magic holy symbol at level 11: +3, 9,000 gp, level 11", [items[0].name, items[0].system.enhance, items[0].system.price, items[0].system.level], ["Magic Holy Symbol +3", 3, 9000, 11]);
	const a = make(pc(), { items });
	eq("F magic", "the model keeps it: an implement, holy symbol, +3", [a.items.contents[0].system.weaponType, a.items.contents[0].system.weaponBaseType, a.items.contents[0].system.enhance], ["implement", "holyS", 3]);
	const row = magicRow("Magic Holy Symbol");
	const first = magicModule.planMagicImport(await magicEntry(row), row, new Set(), { level: 1 });
	const second = magicModule.planMagicImport(await magicEntry(row), row, planModule.existingKeys(first.create), { level: 11 });
	eq("F magic", "two levels of the same item can be imported side by side; the same level twice cannot", [second.create.length, magicModule.planMagicImport(await magicEntry(row), row, planModule.existingKeys(first.create), { level: 1 }).create.length], [1, 0]);
});

await run("F magic", "a magic weapon based on a mundane one rolls that weapon's dice", async () => {
	const mace = (await gearEntry("Mace")).items[0];
	const { items } = await magicItem("Weapon of Disruption", { level: 15, base: mace });
	const a = make(pc(), { items });
	const weapon = a.items.contents[0];
	eq("F magic", "weapon of disruption at 15: +3, based on the mace", [weapon.system.enhance, weapon.flags.dnd4e.import.baseWeapon], [3, "Mace"]);
	eq("F magic", "its weapon dice are the mace's", weapon.getWepDice(), `${mace.system.damageDice.parts[0].numDice}d${mace.system.damageDice.parts[0].numFaces}`);
	const bow = (await gearEntry("Longbow")).items[0];
	const unfit = (await magicItem("Weapon of Disruption", { base: bow })).items[0];
	eq("F magic", "a bow does not fit a mace item: no base applied", [unfit.flags.dnd4e.import.baseWeapon ?? null, unfit.system.damageDice?.parts?.length ?? 0], [null, 0]);
});

await run("F magic", "magic armour of one kind is that armour plus its enhancement", async () => {
	const plain = make(pc());
	const { items } = await magicItem("Quicksilver Armor", { level: 10, equip: true });
	const worn = make(pc(), { items });
	eq("F magic", "quicksilver armour (chain) at 10: +6 chain +2 enhancement = +8 AC", worn.system.defences.ac.value - plain.system.defences.ac.value, 8);
	eq("F magic", "it is chain, heavy armour", [items[0].system.armour.subtype, items[0].system.armourBaseType], ["heavy", "chain"]);
});

await run("F magic", "every item with effects is accepted by the model and its effects are suppressed when not equipped", async () => {
	const rows = magicIndex.filter(r => r.effects > 0).filter((_, i) => i % 3 === 0).slice(0, 40);
	const items = [];
	for (const row of rows) items.push(...magicModule.planMagicImport(await magicEntry(row), row, new Set(), {}).create);
	const packed = make(pc(), { items });
	const expected = items.reduce((n, i) => n + i.effects.length, 0);
	eq("F magic", `${rows.length} items with effects: all their effects are on the actor`, [...packed.allApplicableEffects()].length, expected);
	eq("F magic", "carried, none of them is active", [...packed.allApplicableEffects()].filter(e => !e.isSuppressed).length, 0);
});

/* ======================================================= G. rituals */
const ritualIndex = await get("ritual/_index.json");
const ritualItem = async name => {
	const row = ritualIndex.find(r => r.name === name);
	if (!row) throw new Error(`ritual "${name}" is not in the database`);
	return (await get("ritual/rituals.json")).find(e => e._id === row._id).items;
};

await run("G rituals", "a ritual is accepted by the model, with its category, times and the skill it rolls", async () => {
	const a = make(pc(), { items: [...await ritualItem("Alarm"), ...await ritualItem("Alchemist's Acid")] });
	const alarm = a.items.find(i => i.name === "Alarm");
	eq("G rituals", "alarm: a level 1 warding ritual of the ritual kind", [alarm.type, alarm.system.level, alarm.system.category, alarm.system.subtype], ["ritual", 1, "warding", "ritual"]);
	eq("G rituals", "alarm: 10 minutes to cast, lasts 8 hours, market price 50 gp", [alarm.system.castTime.value, alarm.system.castTime.units, alarm.system.duration.value, alarm.system.duration.units, alarm.system.market], ["10", "minute", "8", "hour", "50 gp"]);
	eq("G rituals", "alarm: rolls Arcana, and the path points at a real number on the sheet", [alarm.system.attribute, Number.isFinite(foundry.utils.getProperty(a.system, alarm.system.attribute))], ["skills.arc.total", true]);
	eq("G rituals", "alchemist's acid is an alchemical (volatile) ritual", a.items.find(i => i.name === "Alchemist's Acid").system.subtype, "alchemical");
});

/* ======================================================= H. the rest: deities, diseases, companions, poisons, traps */
const optionModule = await import(`/modules/${MODULE_ID}/scripts/option.mjs`);

await run("H extras", "a deity writes its name into the sheet; a disease and a companion are accepted as features", async () => {
	const deity = await optionEntry("deity", "Avandra");
	const plain = make(pc());
	const actor = patched(pc(), optionModule.optionPatch(deity.apply));
	eq("H extras", "avandra: the deity field of the sheet", actor.system.details.deity, "Avandra");
	const a = make(pc(), { items: [...clone(deity.items), ...clone((await optionEntry("disease", "Echo Madness")).items), ...clone((await optionEntry("companion", "Bear Animal Companion")).items)] });
	eq("H extras", "three features of the groups Deity, Disease and Animal Companion", a.items.map(i => [i.type, i.system.featureType, i.system.featureGroup]).sort(), [["feature", "other", "Animal Companion"], ["feature", "other", "Deity"], ["feature", "other", "Disease"]]);
	eq("H extras", "the disease keeps its level", a.items.find(i => i.name === "Echo Madness").system.level, 9);
	eq("H extras", "a deity changes nothing else on the sheet", [a.system.defences.ac.value, a.system.skills.prc.total], [plain.system.defences.ac.value, plain.system.skills.prc.total]);
});

await run("H extras", "poisons are consumables of type poison, in both page layouts", async () => {
	const rows = magicIndex.filter(r => r.category === "Poison");
	const items = [];
	// Two poisons share the name Carrion Crawler Brain Juice: the DMG one (poison3) is the older layout.
	for (const id of ["poison0710", "poison3"]) {
		const row = rows.find(r => r.id === id);
		if (!row) throw new Error(`poison "${id}" is not in the database`);
		items.push(...magicModule.planMagicImport(await magicEntry(row), row, new Set(), {}).create);
	}
	const a = make(pc(), { items });
	eq("H extras", "bloodroot (newer page) and carrion crawler brain juice (DMG, older page): consumables of type poison", a.items.map(i => [i.type, i.system.consumableType]), [["consumable", "poison"], ["consumable", "poison"]]);
	eq("H extras", "the DMG poison costs 250 gp and is level 5", [a.items.contents[1].system.price, a.items.contents[1].system.level], [250, 5]);
});

await run("H extras", "a trap is a Hazard actor with its printed numbers, how to notice it and how to deal with it", async () => {
	const index = await get("trap/_index.json");
	const load = async name => {
		const row = index.find(r => r.name === name);
		if (!row) throw new Error(`trap "${name}" is not in the database`);
		return (await get(`trap/${row.file}`)).find(a => a._id === row._id);
	};
	const a = make(await load("False-Floor Pit (Elite)"));
	eq("H extras", "false-floor pit (elite): a Hazard actor, level 1, 200 XP", [a.type, a.system.details.level, a.system.details.exp], ["Hazard", 1, 200]);
	eq("H extras", "its roles: a trap, elite, a warder", a.system.details.role.toObject?.() ?? a.system.details.role, { primary: "trap", secondary: "elite", tertiary: "warder" });
	eq("H extras", "no printed hit points: switched off; its attack is a power on the sheet, +4 vs. Reflex", [a.system.attributes.hp.none, a.items.size, a.items.contents[0].type, a.items.contents[0].system.attack.formula, a.items.contents[0].system.attack.def], [true, 1, "power", "4", "ref"]);
	record("H extras", "detection, countermeasures and the description have their texts", /DC 22/.test(a.system.details.detection) && /Thievery DC 27/.test(a.system.details.countermeasures) && /Trigger/.test(a.system.description), [a.system.details.detection.slice(0, 40), a.system.details.countermeasures.slice(0, 40)], "DC 22, Thievery DC 27 and a Trigger");
	const h = make(await load("Crystalshock Stalagmite"));
	eq("H extras", "crystalshock stalagmite: 90 hit points, AC 24, Fortitude 21, Reflex 5", [h.system.attributes.hp.max, h.system.defences.ac.base, h.system.defences.fort.base, h.system.defences.ref.base], [90, 24, 21, 5]);
	eq("H extras", "its Will defence, printed as a dash, is switched off", h.system.defences.wil.none, true);
	eq("H extras", "its attack is a power: close burst 2, +13 vs. Reflex, 2d8 + 4", [h.items.contents[0].system.rangeType, h.items.contents[0].system.area, h.items.contents[0].system.attack.formula, h.items.contents[0].system.hit.formula], ["closeBurst", "2", "13", "2d8 + 4"]);
});

await run("H extras", "a glossary entry is a journal entry with one text page", async () => {
	const index = await get("glossary/_index.json");
	const row = index.find(r => r.name === "Athletics");
	const entry = (await get("glossary/entries.json")).find(e => e._id === row._id);
	const journal = new JournalEntry.implementation(clone(entry.journal));
	eq("H extras", "athletics: one text page with the rules", [journal.pages.size, journal.pages.contents[0].type, journal.pages.contents[0].text.content.length > 3000], [1, "text", true]);
});

/* ======================================================= I. the powers of magic items */
await run("I item powers", "an item's powers are power items with the numbers of the level it is imported at", async () => {
	const thrower = magicRow("Dwarven Thrower");
	const throwerEntry = await magicEntry(thrower);
	const plan = magicModule.planMagicImport(throwerEntry, thrower, new Set(), { level: 12 });
	const [power] = plan.powers;
	eq("I item powers", "dwarven thrower at 12: one daily free-action power named like the item", [plan.powers.length, power.type, power.name, power.system.useType, power.system.actionType], [1, "power", "Dwarven Thrower +3", "daily", "free"]);
	record("I item powers", "its effect says what it is at level 12 (6 extra damage)", /6 extra damage/.test(power.system.effect.detail) && /You hit a Large/.test(power.system.trigger), [power.system.trigger, power.system.effect.detail], "the trigger and the 6 extra damage of level 12");

	const shock = magicRow("Shock Weapon");
	const shockPlan = magicModule.planMagicImport(await magicEntry(shock), shock, new Set(), { level: 13 });
	const [attack] = shockPlan.powers;
	eq("I item powers", "shock weapon at 13: an attack of the item's level + 3 (16) against Reflex, 2d8 damage, critical 16", [attack.system.attack.isAttack, attack.system.attack.def, attack.system.attack.formula, attack.system.hit.formula, attack.system.hit.critFormula], [true, "ref", "16", "2d8", "16"]);

	const a = make(pc(), { items: [...plan.create, ...plan.powers, ...shockPlan.powers] });
	eq("I item powers", "the model accepts the item, with its link, and the powers", [a.items.filter(i => i.type === "power").length, a.items.filter(i => i.type === "weapon").length], [2, 1]);
});

await run("I item powers", "two levels of an item have their own powers; an item already there needs none", async () => {
	const row = magicRow("Dwarven Thrower");
	const entry = await magicEntry(row);
	const four = magicModule.planMagicImport(entry, row, new Set(), { level: row.tiers[0].level });
	const twelve = magicModule.planMagicImport(entry, row, new Set(), { level: 12 });
	eq("I item powers", "each level has a power id of its own", four.powers[0]._id !== twelve.powers[0]._id, true);
	const again = magicModule.planMagicImport(entry, row, planModule.existingKeys(twelve.create), { level: 12 });
	eq("I item powers", "the same level again: nothing to create, no power", [again.create.length, again.powers.length], [0, 0]);
});

/* ======================================================= J. magic armour based on a mundane one */
/** The item an import would create for a magic armour at `level`, based on a mundane armour or shield, optionally equipped. */
const armourItem = async (name, baseName, { level = null, equip = false } = {}) => {
	const row = magicRow(name);
	const base = (await gearEntry(baseName)).items[0];
	const { create } = magicModule.planMagicImport(await magicEntry(row), row, new Set(), { level, baseArmour: base });
	return equip ? gearModule.equipItems(create) : create;
};

await run("J armour base", "a magic armour that names several kinds takes the numbers of the armour it is based on", async () => {
	const plain = make(pc());
	const items = await armourItem("Dwarven Armor", "Plate Armor", { level: 12, equip: true });
	const worn = make(pc(), { items });
	eq("J armour base", "dwarven armour at 12 based on plate: a heavy armour, plate, +3 enhancement, bonus 8", [items[0].system.armour.subtype, items[0].system.armourBaseType, items[0].system.armour.enhance, items[0].system.armour.ac], ["heavy", "plate", 3, 8]);
	eq("J armour base", "worn: +8 plate and +3 enhancement = +11 AC", worn.system.defences.ac.value - plain.system.defences.ac.value, 11);
	eq("J armour base", "worn: speed -1 and Stealth -2, the plate's penalties", [worn.system.movement.walk.value - plain.system.movement.walk.value, worn.system.skills.stl.total - plain.system.skills.stl.total], [-1, -2]);
	eq("J armour base", "it remembers what it is based on", items[0].flags.dnd4e.import.baseArmour, "Plate Armor");
});

await run("J armour base", "an armour that does not fit is not used; a shield item takes a shield", async () => {
	const unfit = await armourItem("Dwarven Armor", "Heavy Shield");
	eq("J armour base", "a shield does not fit 'Chain, scale or plate': no base applied", [unfit[0].flags.dnd4e.import.baseArmour ?? null, unfit[0].system.armour.ac], [null, 0]);
	const plain = make(pc({ details: { armourProf: { value: ["heavy"] } } }));
	const items = await armourItem("Fighting Shield", "Heavy Shield", { equip: true });
	const worn = make(pc({ details: { armourProf: { value: ["heavy"] } } }), { items });
	eq("J armour base", "fighting shield based on a heavy shield: +2 AC and +2 Reflex for who is proficient", ["ac", "ref"].map(k => worn.system.defences[k].value - plain.system.defences[k].value), [2, 2]);
	eq("J armour base", "it is an arms item of the heavy shield kind", [items[0].system.armour.type, items[0].system.armour.subtype, items[0].system.shieldBaseType], ["arms", "heavy", "heavy"]);
});

/* ======================================================= K. the powers of consumables */
await run("K consumables", "a consumable is its own power: the attack and damage of the level it is imported at, one use", async () => {
	const row = magicRow("Alchemist's Acid");
	const entry = await magicEntry(row);
	const at = level => magicModule.planMagicImport(entry, row, new Set(), { level });
	const first = at(null).create[0];
	eq("K consumables", "alchemist's acid as it is first: +4 vs. Reflex, 1d10 acid, a power card, used up with the use", [first.system.attack.formula, first.system.attack.def, first.system.hit.formula, first.system.autoGenChatPowerCard, first.system.uses.autoDestroy], ["4", "ref", "1d10", true, true]);
	const high = at(11).create[0];
	eq("K consumables", "at 11: +14 vs. Reflex and 2d10", [high.system.attack.formula, high.system.hit.formula, high.system.level], ["14", "2d10", 11]);
	eq("K consumables", "it has no power items to create; ranged 5/10, standard action", [at(11).powers.length, high.system.actionType, high.system.rangeType], [0, "standard", "range"]);
	const a = make(pc(), { items: [first, high] });
	eq("K consumables", "the model accepts both", a.items.filter(i => i.type === "consumable").length, 2);
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
