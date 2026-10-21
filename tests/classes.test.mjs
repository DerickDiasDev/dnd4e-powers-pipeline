/**
 * Class pipeline tests: HTML -> parsed class -> feature items + the actor patch the importer applies.
 * The fixtures are invented (no book text). The last block checks the real database when out/ exists.
 * Run: npm test
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseClass, parseFeatures } from "../parse-classes.mjs";
import { buildClass, featureTitle, indexRow } from "../build-classes.mjs";
import { validateClasses } from "../validate-classes.mjs";

const card = (name, kind = "Zapper Attack") => `<h1 class=atwillpower>${name}<span class=level>${kind} </span></h1><p class=flavor><i>Zap.</i></p><p class=powerstat><b>At-Will</b>   ✦     <b>Arcane</b>, <b>Lightning</b><br><b>Standard Action</b>      <b>Ranged</b> 10</p><p class=flavor><b>Effect</b>: Zap.</p><br>`;

/** An invented class page in the shape of the compendium's. */
const page = ({ name = "Zapper (Stormcaller)", traits = {}, features = "", listing = {} } = {}) => {
	const t = {
		role: "Controller. ", source: "Arcane. ", keys: "Intelligence, Wisdom or Charisma",
		armour: "Cloth, leather; light shields.", weapons: "Simple melee, simple ranged, dagger, staff.", defence: "+1 Will.",
		hp: "10+ Constitution Score.", hpl: "4", surges: "6+ Constitution Modifier.",
		trained: "Arcana. From the class skills list below, choose 3 trained skills at 1st level.", skills: "Arcana (Int), Insight (Wis), Nature (Wis), Religion (Int)",
		...traits,
	};
	return {
		id: "class900",
		listing: { ID: "class900", Name: name, SourceBook: "TST, TST2", ...listing },
		html: `<h1 class=player>${name}</h1><p class=flavor><b>CLASS TRAITS</b></p><blockquote>`
			+ `<b>Role: </b>${t.role}Zaps things.<br><b>Power Source: </b>${t.source}Lightning.<br><b>Key Abilities: </b>${t.keys}<br><br>`
			+ `<b>Armor Proficiencies: </b>${t.armour}<br><b>Weapon Proficiencies: </b>${t.weapons}<br><b>Bonus to Defense: </b>${t.defence}<br><br>`
			+ `<b>Hit Points at 1st Level</b>: ${t.hp}<br><b>Hit Points per Level Gained</b>: ${t.hpl}<br><b>Healing Surges per Day</b>: ${t.surges}<br><br>`
			+ `<b>Trained Skills</b>: ${t.trained}<br><i>Class Skills</i>: ${t.skills}.<br><br><b>Implement: </b>Rods, wands.<br>`
			+ `<b>Build Options: </b>Stormcaller Zapper.<br><b>Class features: </b>Zap Mastery, Static Charge.<br></blockquote>`
			+ `Those who zap are zappers.<br>    They live in storms.<br><br><h3>${name.toUpperCase()} CLASS FEATURES</h3><br><br>`
			+ (features || (`<h3>Level 1:</h3><b>ZAP MASTERY</b><br>You gain the zap power.<br><br>${card("Zap")}`
				+ `<b>STATIC CHARGE</b><br>You gain two of the following powers of your choice.<br><br>${card("Spark")}${card("Arc Flash")}${card("Big Bolt", "Zapper Attack 1")}`
				+ `<b>STORM SENSE</b><br>You gain a +2 bonus to initiative.<br><br>`
				+ `<h3>Level 2:</h3><b>LEVEL 2 ZAPPER UTILITY POWER</b><br>You gain one of the following powers of your choice.<br><br>${card("Static Cling", "Zapper Utility 2")}${card("Shock Hop", "Zapper Utility 2")}`
				+ `<h3>Level 3:</h3><b>IMPROVED ZAP</b><br>Your zap power adds Wisdom damage.<br><br>`
				+ `<h3>Level 5:</h3><b>MENACING STORM</b><br>You gain the menacing storm power.<br><br>${card("Menacing Storm", "Zapper Attack 5")}${card("Menacing Storm Secondary Power", "Zapper Attack 5")}`))
			+ `<p class=publishedIn>Published in Test Book, page(s) 5.</p>`,
	};
};

const POWERS = [
	...["Zap", "Spark", "Arc Flash", "Big Bolt", "Static Cling", "Shock Hop", "Menacing Storm"].map((name, i) => ({ id: `power${i + 1}`, name, class: "Zapper", powerType: "class" })),
	{ id: "power90", name: "Borrowed Trick", class: "Rogue", powerType: "class" },
	{ id: "power91", name: "Hybrid Zap (Hybrid)", class: "Hybrid Zapper", powerType: "class" },
];

describe("class parser: traits", () => {
	test("role, source, key abilities, build, books", () => {
		const c = parseClass(page());
		assert.equal(c.name, "Zapper (Stormcaller)");
		assert.equal(c.baseName, "Zapper");
		assert.equal(c.build, "Stormcaller");
		assert.equal(c.hybrid, false);
		assert.deepEqual(c.sources, ["TST", "TST2"]);
		assert.equal(c.sourceCode, "TST");
		assert.equal(c.role, "Controller");
		assert.equal(c.powerSource, "Arcane");
		assert.deepEqual(c.keyAbilities, ["int", "wis", "cha"], "in the order the book lists them: the first is the main one");
		assert.equal(c.quality, "complete");
	});

	test("hit points, surges, defences", () => {
		const c = parseClass(page());
		assert.deepEqual([c.hpStart, c.hpPerLevel, c.surges], [10, 4, 6]);
		assert.deepEqual(c.defenceBonuses, { wil: 1 });
		assert.deepEqual(parseClass(page({ traits: { defence: "+1 Fortitude, +1 Reflex." } })).defenceBonuses, { fort: 1, ref: 1 });
		assert.deepEqual(parseClass(page({ traits: { defence: "+2 Fortitude." } })).defenceBonuses, { fort: 2 });
	});

	test("armour and weapon proficiencies: known categories become sheet keys, the rest stays as text", () => {
		const c = parseClass(page());
		assert.deepEqual(c.armour.keys, ["cloth", "leather", "light"]);
		assert.deepEqual(c.weapons.keys, ["simpleM", "simpleR"]);
		assert.deepEqual(c.weapons.other, ["dagger", "staff"]);
		assert.equal(c.weapons.text, "Simple melee, simple ranged, dagger, staff.");
		const heavy = parseClass(page({ traits: { armour: "Cloth, leather, hide, chainmail, scale, plate; heavy shields, light shields." } }));
		assert.deepEqual(heavy.armour.keys, ["cloth", "leather", "hide", "chain", "scale", "plate", "heavy", "light"]);
	});

	test("trained skills: the fixed ones and how many to choose; class skills come from the italic line", () => {
		const c = parseClass(page());
		assert.deepEqual(c.trainedSkills.fixed, ["arc"]);
		assert.equal(c.trainedSkills.choose, 3);
		assert.deepEqual(c.classSkills, ["arc", "ins", "nat", "rel"]);
		const two = parseClass(page({ traits: { trained: "Stealth, Thievery. From the class skills list below, choose 2 trained skills at 1st level." } }));
		assert.deepEqual(two.trainedSkills.fixed, ["stl", "thi"]);
		const none = parseClass(page({ traits: { trained: "From the class skills list below, choose four trained skills at 1st level." } }));
		assert.deepEqual([none.trainedSkills.fixed, none.trainedSkills.choose], [[], 4]);
	});

	test("key abilities written with 'or' and a single ability", () => {
		assert.deepEqual(parseClass(page({ traits: { keys: "Dexterity or Strength" } })).keyAbilities, ["dex", "str"]);
		assert.deepEqual(parseClass(page({ traits: { keys: "Strength" } })).keyAbilities, ["str"]);
	});

	test("a hybrid class is flagged, and its fractional numbers are kept", () => {
		const c = parseClass(page({ name: "Hybrid Zapper", traits: { hp: "7.5+ Constitution Score.", hpl: "2", surges: "3.5" } }));
		assert.equal(c.hybrid, true);
		assert.equal(c.baseName, "Zapper");
		assert.deepEqual([c.hpStart, c.surges], [7.5, 3.5]);
	});

	test("lists: implements, build options, feature names", () => {
		const c = parseClass(page());
		assert.deepEqual(c.implements, ["Rods", "wands"]);
		assert.deepEqual(c.buildOptions, ["Stormcaller Zapper"]);
		assert.deepEqual(c.featureNames, ["Zap Mastery", "Static Charge"]);
	});

	test("the prose is kept, the features heading and the power cards are not part of it", () => {
		const c = parseClass(page());
		assert.deepEqual(c.description, [{ heading: "", text: "Those who zap are zappers.\nThey live in storms." }]);
	});
});

describe("class parser: features", () => {
	const features = () => parseClass(page()).features;

	test("name, level, text, in order", () => {
		assert.deepEqual(features().map(f => [f.level, f.name]), [
			[1, "ZAP MASTERY"], [1, "STATIC CHARGE"], [1, "STORM SENSE"], [2, "LEVEL 2 ZAPPER UTILITY POWER"], [3, "IMPROVED ZAP"], [5, "MENACING STORM"],
		]);
		assert.equal(features()[2].text, "You gain a +2 bonus to initiative.");
	});

	test("the bold words inside a power card (At-Will, Arcane...) do not start features", () => {
		assert.equal(features().length, 6);
	});

	test("the text stops where a power card begins", () => {
		assert.equal(features()[1].text, "You gain two of the following powers of your choice.");
		assert.ok(features().every(f => !/Zap\./.test(f.text.replace("Your zap power", ""))), "card text is not in the feature text");
	});

	test("powers: named by the cards; several cards make a choice; secondary powers are not listed", () => {
		const f = features();
		assert.deepEqual([f[0].powers, f[0].powerChoice], [["Zap"], false]);
		assert.deepEqual([f[1].powers, f[1].powerChoice], [["Spark", "Arc Flash", "Big Bolt"], true]);
		assert.deepEqual(f[3].powers, ["Static Cling", "Shock Hop"]);
		assert.deepEqual([f[5].powers, f[5].powerChoice], [["Menacing Storm"], false], "'Menacing Storm Secondary Power' belongs to Menacing Storm");
		assert.deepEqual(f[2].powers, []);
	});

	test("a page without a features heading has none", () => {
		assert.deepEqual(parseFeatures("<h1 class=player>X</h1>nothing"), []);
	});

	test("a hybrid page whose features come without level headings keeps level null", () => {
		const html = "<h3>HYBRID ZAPPER CLASS FEATURES</h3><br><br><b>ZAP BASICS (HYBRID)</b><br>You zap a little.<br><br>";
		assert.deepEqual(parseFeatures(html).map(f => [f.level, f.name, f.text]), [[null, "ZAP BASICS (HYBRID)", "You zap a little."]]);
	});
});

describe("class builder", () => {
	const build = (options, powers = POWERS) => buildClass(parseClass(page(options)), powers);

	test("feature titles: capitalised, level prefix dropped, small words kept small", () => {
		assert.equal(featureTitle("KNIGHT'S VALOR", 22), "Knight's Valor");
		assert.equal(featureTitle("LEVEL 7 EXTRA KNIGHT STANCE", 7), "Extra Knight Stance");
		assert.equal(featureTitle("LEVEL 7 EXTRA KNIGHT STANCE", null), "Level 7 Extra Knight Stance");
		assert.equal(featureTitle("MASTER OF THE STORM", 1), "Master of the Storm");
		assert.equal(featureTitle("COMBAT CHALLENGE (HYBRID)", null), "Combat Challenge (Hybrid)");
	});

	test("the class is one feature item plus one per class feature, with their level", () => {
		const e = build();
		assert.deepEqual(e.items.map(i => [i.name, i.system.level]), [
			["Zapper (Stormcaller)", null], ["Zap Mastery", 1], ["Static Charge", 1], ["Storm Sense", 1], ["Zapper Utility Power", 2], ["Improved Zap", 3], ["Menacing Storm", 5],
		]);
		for (const item of e.items) {
			assert.equal(item.type, "feature");
			assert.equal(item.system.featureType, "class");
			assert.equal(item.system.featureSource, "Zapper (Stormcaller)");
			assert.equal(item.flags.dnd4e.import.bundle, e._id);
			assert.equal(item.flags.dnd4e.import.kind, "class");
		}
		assert.equal(e._id, e.items[0]._id);
		assert.equal(new Set(e.items.map(i => i._id)).size, e.items.length);
		assert.deepEqual(e.items.slice(1).map(i => i.flags.dnd4e.import.section), [0, 1, 2, 3, 4, 5], "the section tells features apart for the duplicate check");
	});

	test("ids are stable", () => {
		assert.deepEqual(build().items.map(i => i._id), build().items.map(i => i._id));
	});

	test("the class item's description lists the traits in the book's words", () => {
		const html = build().items[0].system.description.value;
		assert.match(html, /<strong>Key abilities:<\/strong> Intelligence, Wisdom or Charisma/);
		assert.match(html, /<strong>Weapon proficiencies:<\/strong> Simple melee, simple ranged, dagger, staff\./);
		assert.match(html, /<strong>Healing surges per day:<\/strong> 6 \+ Constitution modifier/);
		assert.match(html, /Those who zap are zappers\./);
	});

	test("the actor patch holds what the sheet has fields for", () => {
		assert.deepEqual(build().apply, {
			class: "Zapper (Stormcaller)", primaryAbility: "int", hpStart: 10, hpPerLevel: 4, surges: 6, defences: { wil: 1 }, trained: ["arc"],
			armour: ["cloth", "leather", "light"], weapons: ["simpleM", "simpleR"], weaponsCustom: ["dagger", "staff"],
		});
	});

	test("a hybrid class writes only its name to the sheet", () => {
		const e = build({ name: "Hybrid Zapper", traits: { hp: "7.5+ Constitution Score.", hpl: "2", surges: "3.5" } });
		assert.deepEqual(e.apply, { class: "Hybrid Zapper", primaryAbility: null, hpStart: null, hpPerLevel: null, surges: null, defences: {}, trained: [], armour: [], weapons: [], weaponsCustom: [] });
		assert.ok(e.notes.includes("hybrid"));
	});

	test("powers: granted when the feature gives one, options when it lets you pick, each with its level", () => {
		const e = build();
		assert.deepEqual(e.powers.map(p => [p.name, p.kind, p.level]), [
			["Zap", "granted", 1], ["Spark", "option", 1], ["Arc Flash", "option", 1], ["Big Bolt", "option", 1],
			["Static Cling", "option", 2], ["Shock Hop", "option", 2], ["Menacing Storm", "granted", 5],
		]);
		assert.equal(e.powers[1].feature, "Static Charge");
		assert.ok(e.notes.includes("power-choice"));
		assert.deepEqual(e.unresolved, []);
	});

	test("a power the database does not have is reported, not invented; a power of another class is found when its name is unique", () => {
		const f = page().html.replace("Spark", "Borrowed Trick").replace("Arc Flash", "Phantom Move");
		const e = buildClass(parseClass({ id: "c", listing: { Name: "Zapper (Stormcaller)", SourceBook: "TST" }, html: f }), POWERS);
		assert.ok(e.powers.some(p => p.name === "Borrowed Trick" && p.id === "power90"));
		assert.deepEqual(e.unresolved, ["Phantom Move"]);
		assert.ok(e.notes.includes("powers-unresolved"));
	});

	test("a hybrid class looks its powers up under the hybrid class", () => {
		const f = page({ name: "Hybrid Zapper" }).html.replace("Spark", "Hybrid Zap (Hybrid)");
		const e = buildClass(parseClass({ id: "c", listing: { Name: "Hybrid Zapper", SourceBook: "TST" }, html: f }), POWERS);
		assert.ok(e.powers.some(p => p.id === "power91"));
	});

	test("notes: the player picks skills and a primary ability among several", () => {
		const e = build();
		assert.ok(e.notes.includes("skill-choice"));
		assert.ok(e.notes.includes("primary-ability-first"));
		assert.ok(e.notes.includes("weapons-custom"));
		assert.deepEqual(e.skillChoice, { choose: 3, from: ["arc", "ins", "nat", "rel"] });
	});

	test("the index row is light", () => {
		const e = build();
		const row = indexRow(e);
		assert.deepEqual([row.name, row.hp, row.surges, row.role], ["Zapper (Stormcaller)", 10, 6, "Controller"]);
		assert.deepEqual(row.items, e.items.map(i => i._id));
		assert.equal("apply" in row, false);
	});

	test("the built class passes the static validation, and breaking it is caught", () => {
		const e = build();
		assert.equal(validateClasses([e], [indexRow(e)], new Set(e.powers.map(p => p.id))).size, 0);
		const bad = structuredClone(e);
		bad.apply.primaryAbility = "luck"; bad.apply.armour.push("mithril"); bad.apply.weapons.push("sim"); bad.apply.defences.xyz = 1; bad.apply.hpStart = 0;
		const keys = [...validateClasses([bad], [indexRow(e)], new Set()).keys()].join("\n");
		for (const re of [/primaryAbility: "luck"/, /armour proficiency: "mithril"/, /weapon proficiency: "sim"/, /defence: "xyz"/, /hpStart is not a sensible/, /not in the power database/]) assert.match(keys, re);
		const hybrid = build({ name: "Hybrid Zapper" });
		hybrid.apply.hpStart = 5;
		assert.match([...validateClasses([hybrid], [indexRow(hybrid)], null).keys()].join("\n"), /hybrid class must not write/);
	});

	test("HTML in book text is escaped in the descriptions", () => {
		const f = page().html.replace("You gain a +2 bonus to initiative.", "You are &lt;b&gt;fast&lt;/b&gt; &amp; sure.");
		const e = buildClass(parseClass({ id: "c", listing: { Name: "Zapper", SourceBook: "TST" }, html: f }), POWERS);
		assert.equal(e.items.find(i => i.name === "Storm Sense").system.description.value, "<p>You are &lt;b&gt;fast&lt;/b&gt; &amp; sure.</p>");
	});
});

const here = path.dirname(fileURLToPath(import.meta.url));
const dbDir = path.join(here, "..", "out", "db");
const skip = existsSync(path.join(dbDir, "class", "classes.json")) ? false : "class database not built (out/db/class)";

describe("real class database", { skip }, () => {
	const load = async () => ({
		entries: JSON.parse(await readFile(path.join(dbDir, "class", "classes.json"), "utf8")),
		index: JSON.parse(await readFile(path.join(dbDir, "class", "_index.json"), "utf8")),
		powerIds: new Set(JSON.parse(await readFile(path.join(dbDir, "power", "_index.json"), "utf8")).map(p => p.id)),
	});

	test("all classes pass the static validation and every class is in the index", async () => {
		const { entries, index, powerIds } = await load();
		assert.deepEqual([...validateClasses(entries, index, powerIds).keys()], []);
		assert.equal(entries.length, index.length);
		assert.ok(entries.length >= 70);
	});

	test("every non-hybrid class has the numbers the sheet needs; every class has features", async () => {
		const { entries } = await load();
		for (const e of entries) {
			assert.ok(e.items.length > 1, `${e.name} has no features`);
			if (!e.hybrid) assert.ok(e.apply.hpStart && e.apply.hpPerLevel && e.apply.surges && e.apply.primaryAbility, e.name);
		}
	});

	test("a known class reads like the book: the knight", async () => {
		const { entries } = await load();
		const knight = entries.find(e => e.name === "Fighter (Knight)");
		assert.deepEqual(knight.apply, {
			class: "Fighter (Knight)", primaryAbility: "str", hpStart: 15, hpPerLevel: 6, surges: 9, defences: { fort: 2 }, trained: [],
			armour: ["cloth", "leather", "hide", "chain", "scale", "plate", "heavy", "light"], weapons: ["simpleM", "militaryM", "simpleR", "militaryR"], weaponsCustom: [],
		});
		assert.deepEqual(knight.skillChoice, { choose: 3, from: ["ath", "dip", "end", "hea", "itm"] });
		assert.ok(knight.powers.some(p => p.name === "Battle Guardian" && p.kind === "granted" && p.level === 1));
		assert.ok(knight.powers.some(p => p.name === "Battle Wrath" && p.kind === "option"));
		assert.ok(knight.items.some(i => i.name === "Spirit of War" && i.system.level === 29));
	});
});
