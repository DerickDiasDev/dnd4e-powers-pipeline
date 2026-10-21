/**
 * Character-option pipeline tests (feats, paragon paths, epic destinies, themes, backgrounds): HTML -> parsed option ->
 * feature items + the actor patch the importer applies. The fixtures are invented (no book text). The last block checks the real
 * database when out/ exists.
 * Run: npm test
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseBackground, parseFeat, parsePath } from "../parse-options.mjs";
import { buildOption, indexRow } from "../build-options.mjs";
import { validateOptions } from "../validate-options.mjs";

const card = (name, level = "Zapper Attack 11") => `<h1 class=encounterpower>${name}<span class=level>${level}</span></h1><p class=flavor><i>Zap.</i></p><p class=powerstat><b>Encounter</b>   ✦     <b>Arcane</b><br><b>Standard Action</b>      <b>Ranged</b> 10</p><p class=flavor><b>Hit</b>: Zap.</p><br>`;

const feat = (o = {}) => ({
	id: "feat900", listing: { Name: "Static Skin", Tier: "Paragon", Prerequisite: "Zapper, 11th level", SourceBook: "TST, TST2", ...o.listing },
	html: o.html ?? `<h1 class=player>Static Skin [Multiclass Zapper]</h1><p class=flavor><b>Paragon Tier</b><br><b>Prerequisite</b>: Zapper, 11th level<br><b>Benefit</b>: You gain a +1 bonus to Will.<br><b>Special</b>: You can take this feat twice.<br></p><p class=publishedIn>Published in Test Book, page(s) 1.</p>`,
});

const FEATURES = `<h3>STORMWALKER PATH FEATURES</h3>    <b>Second Step (11th level)</b>: You step twice.<br>    <b>Spark Timing (11th level)</b>: You spark.<br>      Also you spark again.<br>    <b>Static Tactics (16th level)</b>: You are static.<br>`;
const path_ = (o = {}) => ({
	id: "paragonpath900", listing: { Name: "Stormwalker", Prerequisite: "Eladrin, zapper", SourceBook: "TST", ...o.listing },
	html: o.html ?? `<h1 class=player>Stormwalker</h1><p><i>"The storm is my road."</i></p><b>Prerequisite: </b>Eladrin, zapper<br><br>Storms are roads.<br>    Walk them.<br><br>${FEATURES}${card("Storm Step")}${card("Convey Spark", "Stormwalker Utility 12")}${card("Spiral of Sparks", "Stormwalker Attack 20")}<p class=publishedIn>Published in Test Book, page(s) 2.</p>`,
});

const theme = () => ({
	id: "theme900", listing: { Name: "Stormborn", Prerequisite: "", SourceBook: "TST" },
	html: `<h1 class=player>Stormborn</h1><p><i>"Thunder is my name."</i></p>You were born in a storm.<br><br>${card("Thunder Clap", "Stormborn Feature")}${card("Static Hop", "Stormborn Utility 2")}${card("Bolt Strike", "Stormborn Attack 5")}<p class=publishedIn>Published in Test Book, page(s) 3.</p>`,
});

const background = (o = {}) => ({
	id: "background900", listing: { Name: "Marsh Born", Type: "Geography", Campaign: "Test World", Benefit: "Add Elven to languages known.", SourceBook: "TST" },
	html: o.html ?? `<h1 class=player>Marsh Born</h1><p><i>The marsh is damp.</i></p><p class=flavortext><b>Type: </b>Geography<br></p>Folk of the marsh are damp.<br>    They like it.<br><i>Benefit: </i>You add Elven to your list of languages known.<br><p class=publishedIn>Published in Test Book, page(s) 4.</p>`,
});

const POWERS = [
	{ id: "power1", name: "Storm Step", class: "Stormwalker", powerType: "paragon", level: 11, kind: "attack" },
	{ id: "power2", name: "Convey Spark", class: "Stormwalker", powerType: "paragon", level: 12, kind: "utility" },
	{ id: "power3", name: "Spiral of Sparks", class: "Stormwalker", powerType: "paragon", level: 20, kind: "attack" },
	{ id: "power4", name: "Thunder Clap", class: "Stormborn", powerType: "theme", level: null, kind: "feature" },
	{ id: "power5", name: "Static Hop", class: "Stormborn", powerType: "theme", level: 2, kind: "utility" },
	{ id: "power6", name: "Bolt Strike", class: "Stormborn", powerType: "theme", level: 5, kind: "attack" },
	{ id: "power7", name: "Zap Hop", class: "Zapper", powerType: "feat", level: null, kind: "utility" },
];

describe("feat parser", () => {
	test("name, bracket category, tier, prerequisite, books", () => {
		const f = parseFeat(feat());
		assert.deepEqual([f.name, f.category, f.tier, f.prerequisite], ["Static Skin", "Multiclass Zapper", "Paragon", "Zapper, 11th level"]);
		assert.deepEqual(f.sources, ["TST", "TST2"]);
		assert.equal(f.sourceCode, "TST");
	});

	test("the labelled lines are kept in order, without the tier and prerequisite lines", () => {
		assert.deepEqual(parseFeat(feat()).sections, [{ label: "Benefit", text: "You gain a +1 bonus to Will." }, { label: "Special", text: "You can take this feat twice." }]);
	});

	test("a feat without a bracket has no category; the tier comes from the page when the listing lacks it", () => {
		const f = parseFeat(feat({ listing: { Name: "Plain", Tier: undefined }, html: `<h1 class=player>Plain</h1><p class=flavor><b>Epic Tier</b><br><b>Benefit</b>: Good.<br></p>` }));
		assert.deepEqual([f.name, f.category, f.tier], ["Plain", null, "Epic"]);
	});

	test("a feat with no benefit line is partial", () => {
		const f = parseFeat(feat({ html: `<h1 class=player>Odd</h1><p class=flavor><b>Heroic Tier</b><br></p>` }));
		assert.deepEqual([f.quality, f.notes], ["partial", ["no-benefit"]]);
	});

	test("powers printed on the page are named", () => {
		const f = parseFeat(feat({ html: `<h1 class=player>Zap Gift</h1><p class=flavor><b>Heroic Tier</b><br><b>Benefit</b>: You gain the zap hop power.<br></p>${card("Zap Hop", "Zapper Utility")}` }));
		assert.deepEqual(f.powerNames, ["Zap Hop"]);
	});
});

describe("path parser", () => {
	test("quote, prerequisite, prose and the powers named by the cards", () => {
		const p = parsePath("path", path_());
		assert.equal(p.quote, "\"The storm is my road.\"");
		assert.equal(p.prerequisite, "Eladrin, zapper");
		assert.deepEqual(p.prose, [{ heading: "", text: "Storms are roads.\nWalk them." }]);
		assert.deepEqual(p.powerNames, ["Storm Step", "Convey Spark", "Spiral of Sparks"]);
	});

	test("features: name, level, text; a continuation line joins the previous feature; cards are not features", () => {
		assert.deepEqual(parsePath("path", path_()).features, [
			{ name: "Second Step", level: 11, text: "You step twice." },
			{ name: "Spark Timing", level: 11, text: "You spark.\nAlso you spark again." },
			{ name: "Static Tactics", level: 16, text: "You are static." },
		]);
	});

	test("a path without a features heading is partial; a theme never is", () => {
		const bare = path_({ html: `<h1 class=player>Bare</h1><p><i>"x"</i></p>Plain.<br>` });
		assert.deepEqual([parsePath("path", bare).quality, parsePath("path", bare).notes], ["partial", ["no-features"]]);
		assert.equal(parsePath("theme", theme()).quality, "complete");
	});

	test("a theme: quote, prose before the first card, its powers", () => {
		const t = parsePath("theme", theme());
		assert.equal(t.quote, "\"Thunder is my name.\"");
		assert.deepEqual(t.prose, [{ heading: "", text: "You were born in a storm." }]);
		assert.deepEqual(t.powerNames, ["Thunder Clap", "Static Hop", "Bolt Strike"]);
		assert.deepEqual(t.features, []);
	});
});

describe("background parser", () => {
	test("type, campaign, intro, prose and the benefit", () => {
		const b = parseBackground(background());
		assert.deepEqual([b.type, b.campaign, b.intro], ["Geography", "Test World", "The marsh is damp."]);
		assert.deepEqual(b.prose, [{ heading: "", text: "Folk of the marsh are damp.\nThey like it." }]);
		assert.equal(b.benefit, "You add Elven to your list of languages known.");
	});

	test("the listing's benefit is used when the page has none", () => {
		const b = parseBackground(background({ html: `<h1 class=player>Marsh Born</h1>Only prose.<br>` }));
		assert.equal(b.benefit, "Add Elven to languages known.");
		assert.equal(b.quality, "complete");
	});
});

describe("option builder", () => {
	test("a feat is one feature item: tier level, prerequisite, group, labelled lines", () => {
		const e = buildOption("feat", parseFeat(feat()), POWERS);
		assert.equal(e.items.length, 1);
		const item = e.items[0];
		assert.deepEqual([item.type, item.system.featureType, item.system.level, item.system.requirements, item.system.featureGroup], ["feature", "feat", 11, "Zapper, 11th level", "Multiclass Zapper"]);
		assert.equal(item.system.description.value, "<p><strong>Prerequisite:</strong> Zapper, 11th level</p><p><strong>Benefit:</strong> You gain a +1 bonus to Will.</p><p><strong>Special:</strong> You can take this feat twice.</p>");
		assert.deepEqual([e.tier, e.level, e.category], ["Paragon", 11, "Multiclass Zapper"]);
	});

	test("heroic and epic feats start at levels 1 and 21", () => {
		assert.equal(buildOption("feat", parseFeat(feat({ listing: { Tier: "Heroic" } })), []).level, 1);
		assert.equal(buildOption("feat", parseFeat(feat({ listing: { Tier: "Epic" } })), []).level, 21);
	});

	test("a feat gives the powers its page names, and only those", () => {
		const html = `<h1 class=player>Zap Gift</h1><p class=flavor><b>Heroic Tier</b><br><b>Benefit</b>: You gain the zap hop power.<br></p>${card("Zap Hop", "Zapper Utility")}`;
		const e = buildOption("feat", parseFeat(feat({ listing: { Tier: "Heroic" }, html })), POWERS);
		assert.deepEqual(e.powers, [{ id: "power7", name: "Zap Hop", kind: "granted", level: 1 }]);
		assert.deepEqual(buildOption("feat", parseFeat(feat()), POWERS).powers, []);
	});

	test("a paragon path: the path itself plus one item per feature, levels, and all three powers granted", () => {
		const e = buildOption("path", parsePath("path", path_()), POWERS);
		assert.deepEqual(e.items.map(i => [i.name, i.system.level, i.system.featureType]), [
			["Stormwalker", 11, "path"], ["Second Step", 11, "path"], ["Spark Timing", 11, "path"], ["Static Tactics", 16, "path"],
		]);
		assert.ok(e.items.every(i => i.system.featureSource === "Stormwalker" && i.flags.dnd4e.import.bundle === e._id));
		assert.deepEqual(e.items.slice(1).map(i => i.flags.dnd4e.import.section), [0, 1, 2]);
		assert.deepEqual(e.powers.map(p => [p.name, p.kind, p.level]), [["Storm Step", "granted", 11], ["Convey Spark", "granted", 12], ["Spiral of Sparks", "granted", 20]]);
		assert.deepEqual(e.apply, { paragon: "Stormwalker", epic: null });
		assert.equal(e.tier, "Paragon");
	});

	test("two powers on the same level are a choice", () => {
		const rows = [...POWERS, { id: "power8", name: "Storm Step Too", class: "Stormwalker", powerType: "paragon", level: 11, kind: "attack" }];
		const e = buildOption("path", parsePath("path", path_()), rows);
		assert.deepEqual(e.powers.filter(p => p.level === 11).map(p => p.kind), ["option", "option"]);
		assert.ok(e.notes.includes("power-choice"));
	});

	test("an epic destiny sets the epic field", () => {
		const html = path_().html.replace("STORMWALKER PATH FEATURES", "STORMWALKER FEATURES").replace(/ \(11th level\)/g, " (21st level)");
		const e = buildOption("destiny", parsePath("destiny", path_({ html })), []);
		assert.deepEqual(e.apply, { paragon: null, epic: "Stormwalker" });
		assert.deepEqual([e.tier, e.level], ["Epic", 21]);
	});

	test("a theme grants its feature power; the rest are options", () => {
		const e = buildOption("theme", parsePath("theme", theme()), POWERS);
		assert.deepEqual(e.powers.map(p => [p.name, p.kind]), [["Thunder Clap", "granted"], ["Static Hop", "option"], ["Bolt Strike", "option"]]);
		assert.equal(e.items.length, 1);
		assert.deepEqual([e.tier, e.level], ["Heroic", 1]);
	});

	test("a background is one item with its type as group and its benefit", () => {
		const e = buildOption("background", parseBackground(background()), POWERS);
		assert.equal(e.items[0].system.featureType, "background");
		assert.equal(e.items[0].system.featureGroup, "Geography");
		assert.match(e.items[0].system.description.value, /<strong>Benefit:<\/strong> You add Elven to your list of languages known\./);
		assert.deepEqual([e.tier, e.level, e.powers], [null, null, []]);
	});

	test("ids are stable and differ per kind even for the same source id", () => {
		const a = buildOption("path", parsePath("path", path_()), POWERS);
		assert.deepEqual(a.items.map(i => i._id), buildOption("path", parsePath("path", path_()), POWERS).items.map(i => i._id));
		const asDestiny = buildOption("destiny", parsePath("destiny", path_()), POWERS);
		assert.notEqual(a._id, asDestiny._id);
	});

	test("book text is escaped in the descriptions", () => {
		const e = buildOption("feat", parseFeat(feat({ html: `<h1 class=player>Odd</h1><p class=flavor><b>Heroic Tier</b><br><b>Benefit</b>: You are &lt;b&gt;fast&lt;/b&gt; &amp; sure.<br></p>` })), []);
		assert.match(e.items[0].system.description.value, /<strong>Benefit:<\/strong> You are &lt;b&gt;fast&lt;\/b&gt; &amp; sure\.<\/p>/);
	});

	test("the index row is light and the built options pass the static validation; breaking them is caught", () => {
		const e = buildOption("path", parsePath("path", path_()), POWERS);
		const row = indexRow(e);
		assert.equal("apply" in row, false);
		assert.deepEqual(row.items, e.items.map(i => i._id));
		assert.equal(validateOptions("path", [e], [row], new Set(["power1", "power2", "power3"])).size, 0);
		const bad = structuredClone(e);
		bad.tier = "Mythic"; bad.items[1].system.featureType = "feat"; bad.items[2].system.level = 99; bad.apply.epic = "x";
		const keys = [...validateOptions("path", [bad], [row], new Set()).keys()].join("\n");
		for (const re of [/tier "Mythic"/, /featureType "feat"/, /has level 99/, /only an epic destiny/, /not in the power database/]) assert.match(keys, re);
	});
});

const here = path.dirname(fileURLToPath(import.meta.url));
const dbDir = path.join(here, "..", "out", "db");
const skip = existsSync(path.join(dbDir, "option", "feat", "entries.json")) ? false : "option database not built (out/db/option)";

describe("real option database", { skip }, () => {
	const load = async kind => ({
		entries: JSON.parse(await readFile(path.join(dbDir, "option", kind, "entries.json"), "utf8")),
		index: JSON.parse(await readFile(path.join(dbDir, "option", kind, "_index.json"), "utf8")),
	});
	const powerIds = async () => new Set(JSON.parse(await readFile(path.join(dbDir, "power", "_index.json"), "utf8")).map(p => p.id));

	test("every kind passes the static validation and the index lists every entry", async () => {
		const ids = await powerIds();
		for (const kind of ["feat", "path", "destiny", "theme", "background"]) {
			const { entries, index } = await load(kind);
			assert.deepEqual([...validateOptions(kind, entries, index, ids).keys()], [], kind);
			assert.equal(entries.length, index.length, kind);
		}
		assert.ok((await load("feat")).entries.length >= 3000);
	});

	test("item ids are unique across all kinds", async () => {
		const all = [];
		for (const kind of ["feat", "path", "destiny", "theme", "background"]) all.push(...(await load(kind)).entries.flatMap(e => e.items.map(i => i._id)));
		assert.equal(new Set(all).size, all.length);
	});

	test("known options read like the book: toughness, spiral tactician", async () => {
		const toughness = (await load("feat")).entries.find(e => e.name === "Toughness");
		assert.deepEqual([toughness.tier, toughness.level], ["Heroic", 1]);
		assert.match(toughness.items[0].system.description.value, /5 additional hit points/);
		const path = (await load("path")).entries.find(e => e.name === "Spiral Tactician");
		assert.deepEqual(path.items.map(i => [i.name, i.system.level]), [["Spiral Tactician", 11], ["Second Step", 11], ["Spiral Timing", 11], ["Fey Tactics", 16]]);
		assert.deepEqual(path.powers.map(p => [p.name, p.kind]), [["Fey Step Assault", "granted"], ["Convey Ally", "granted"], ["Spiral of Fey Death", "granted"]]);
	});

	test("every path and destiny has features, a quote or prose, and powers", async () => {
		for (const kind of ["path", "destiny"]) {
			const { entries } = await load(kind);
			assert.ok(entries.every(e => e.items.length > 1), `${kind}: an option without features`);
			assert.ok(entries.filter(e => e.powers.length === 0).length < entries.length * 0.05, `${kind}: too many without powers`);
		}
	});
});
