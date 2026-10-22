/**
 * Deities, diseases and companions: HTML -> parsed -> feature items in the options' shape. The fixtures are invented (no book text).
 * The last block checks the real database when out/ exists. Poisons (the older and the newer layout) are checked here too, since
 * they go through the magic item stage.
 * Run: npm test
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bodyLines, parseCompanion, parseDeity, parseDeityFacts, parseDisease } from "../parse-extras.mjs";
import { buildExtra, describeHtml, indexRow } from "../build-extras.mjs";
import { validateExtras } from "../validate-extras.mjs";
import { buildMagic } from "../build-magic.mjs";
import { parseMagic } from "../parse-magic.mjs";

const published = `<p class=publishedIn>Published in Test Book, page(s) 1.</p>`;

const deityPage = (extra = "") => ({
	id: "deity900",
	listing: { ID: "deity900", Name: "Zorbra", Domains: "Luck, Marsh", Alignment: "Good", SourceBook: "TST, TST2" },
	html: `<h1 class=player>Zorbra<b>, Lady of the Marsh</b></h1><p class=flavor><b>Type: </b>God<br><b>Alignment: </b>Good<br><b>Gender:</b> Female<br>${extra}<b>Domain: </b>Luck, Marsh<br></p>Zorbra loves damp places.<br>* Keep your feet wet.<br>* Share the mud.<p><br></p>${published}`,
});
const diseasePage = (level = `<span class=level>Level 9 Disease</span>`, flavor = `<p class=flavor><i>A damp cough.</i><br></p>`) => ({
	id: "disease900", listing: { ID: "disease900", Name: "Marsh Cough", Level: "9", SourceBook: "Test Book" },
	html: `<h1 class=atwillpower>Marsh Cough${level}</h1>${flavor}<p class=powerstat><b>Stage 0</b>: The target recovers.<br><b>Stage 1</b>: The target coughs.<br><b>Check</b>: At the end of each extended rest, an Endurance check.<br><i>14 or lower</i>: The stage increases by one.</p>${published}`,
});
const companionPage = (name = "Zorb Hound", type = "Animal Companion") => ({
	id: "associate900", listing: { ID: "associate900", Name: name, Type: type, Size: "Medium", CreatureType: "Beast, Natural", SourceBook: "TST" },
	html: `<h1 class=monster>${name}<br><span class=type>Medium natural beast</span><br></h1><table class=bodytable><tr><td><p class=flavor><b>HP</b> your bloodied value<td class=rightalign><b>Initiative</b> equal to yours<tr><td><b>Speed</b> 6 <td class=rightalign>low-light vision</table><p class='flavor alt'>(⚔) <b>Bite</b> ✦ <b>At-Will</b></p><p class=flavorIndent><i>Hit:</i> 1d8 damage.</p>${published}`,
});

describe("parsing", () => {
	test("a table becomes lines with the cells joined, and spans break lines", () => {
		assert.deepEqual(bodyLines("<table><tr><td>a<td>b<tr><td>c<td>d</table><span class=x>One</span><span class=y>Two</span>"), ["a | b", "c | d", "One", "Two"]);
	});

	test("a deity: the header facts, the title of the h1, alignment as category, the prose and its bullets", () => {
		const d = parseDeity(deityPage("<b>Sphere:</b> Marshes<br>"));
		assert.deepEqual([d.name, d.title, d.category, d.godType, d.domains], ["Zorbra", "Lady of the Marsh", "Good", "God", "Luck, Marsh"]);
		assert.deepEqual(d.facts.map(f => f.label), ["Type", "Alignment", "Gender", "Sphere", "Domain"]);
		assert.deepEqual(d.body, ["Zorbra loves damp places.", "* Keep your feet wet.", "* Share the mud."]);
		assert.deepEqual(d.sources, ["TST", "TST2"]);
		assert.deepEqual(parseDeityFacts("<p class=flavor><b>Type: </b>God<br></p>"), [{ label: "Type", value: "God" }]);
	});

	test("a disease: its level, the flavour and the stages; a variable level has none; a page without flavour keeps its stages", () => {
		const d = parseDisease(diseasePage());
		assert.deepEqual([d.level, d.flavor, d.body[0], d.body.at(-1)], [9, "A damp cough.", "Stage 0: The target recovers.", "14 or lower: The stage increases by one."]);
		const variable = parseDisease(diseasePage(`<span class=level>Variable Level Disease</span>`));
		assert.deepEqual([variable.level, variable.category], [null, "Variable level"]);
		const bare = parseDisease(diseasePage(undefined, ""));
		assert.equal(bare.body[0], "Stage 0: The target recovers.");
	});

	test("a companion: its type as category, the stat block as lines, the repeated name dropped", () => {
		const c = parseCompanion(companionPage());
		assert.deepEqual([c.category, c.size, c.creatureType], ["Animal Companion", "Medium", "Beast, Natural"]);
		assert.deepEqual(c.body.slice(0, 2), ["HP your bloodied value | Initiative equal to yours", "Speed 6 | low-light vision"]);
		assert.ok(c.body.includes("Hit: 1d8 damage."));
		assert.ok(!c.body.some(l => l.startsWith("Zorb Hound")));
	});
});

describe("building", () => {
	test("a deity is a feature item in the options' shape, applying its name to the sheet", () => {
		const e = buildExtra(parseDeity(deityPage()));
		assert.deepEqual([e.kind, e.category, e.extra, e.apply.deity, e.items.length], ["deity", "Good", "Luck, Marsh God Lady of the Marsh", "Zorbra", 1]);
		assert.deepEqual([e.items[0].type, e.items[0].system.featureType, e.items[0].system.featureGroup], ["feature", "other", "Deity"]);
		assert.equal(e.items[0].flags.dnd4e.import.kind, "deity");
		assert.match(describeHtml(parseDeity(deityPage())), /<p><em>Lady of the Marsh<\/em><\/p><p><strong>Type:<\/strong> God<\/p>/);
	});

	test("a disease keeps its level; a companion is grouped by its type and searchable by its size and creature type", () => {
		assert.equal(buildExtra(parseDisease(diseasePage())).level, 9);
		const c = buildExtra(parseCompanion(companionPage("Zorb Hound", "Familiar")));
		assert.deepEqual([c.items[0].system.featureGroup, c.extra, c.apply.deity], ["Familiar", "Medium Beast, Natural", null]);
	});

	test("ids are deterministic and what is built validates; the validator catches a deity that applies another name", () => {
		const a = buildExtra(parseDeity(deityPage())), b = buildExtra(parseDeity(deityPage()));
		assert.equal(a._id, b._id);
		assert.equal(validateExtras("deity", [a], [indexRow(a)]).size, 0);
		a.apply.deity = "Other";
		assert.match([...validateExtras("deity", [a], [indexRow(a)]).keys()].join(), /apply its own name/);
	});
});

describe("poisons", () => {
	const modern = { id: "poison0900", listing: { ID: "poison0900", Name: "Zorb Venom", Level: "5", Cost: "", SourceBook: "TST" }, html: `<h1 class=poison>Zorb Venom<span class=milevel id=headerlevel>Level 5 </span></h1><p class=miflavor>Green.</p><p class=mistat><b>Consumable: </b>Assassin poison        0 gp</p><h2 class=mihead>Power (Poison) ✦ Consumable (Minor Action)</h2><p class='mistat indent'>You apply the poison.</p><br><br>${published}` };
	const legacy = { id: "poison900", listing: { ID: "poison900", Name: "Zorb Old Venom", Level: "5", Cost: "250 GP", SourceBook: "TST" }, html: `<h1 class=poison>Zorb Old Venom<br><span class=level>Level 5 Poison</span></h1><p class=flavor><i>Clear.</i></p><p><b>Poison</b>        250 gp<br><b>Attack:</b> +8 vs. Fortitude; ongoing 5 poison damage.<br><b><i>First Failed Saving Throw:</i></b> Immobilized.<br></p>${published}` };

	test("both layouts give a level, a price and the text; the word after the level is not a rarity", () => {
		const a = parseMagic(modern), b = parseMagic(legacy);
		assert.deepEqual([a.category, a.tiers[0].level, a.tiers[0].price, a.rarity], ["Poison", 5, 0, ""]);
		assert.deepEqual([b.category, b.tiers[0].level, b.tiers[0].price, b.rarity, b.flavor], ["Poison", 5, 250, "", "Clear."]);
		assert.deepEqual(b.sections[0].paragraphs.map(p => p.text.split(":")[0]), ["Poison 250 gp", "Attack", "First Failed Saving Throw"]);
		assert.deepEqual(a.notes.concat(b.notes), []);
	});

	test("a poison is a consumable of type poison", () => {
		for (const page of [modern, legacy]) {
			const item = buildMagic(parseMagic(page)).items[0];
			assert.deepEqual([item.type, item.system.consumableType], ["consumable", "poison"]);
		}
	});
});

describe("the real database", () => {
	const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "out", "db", "option");
	const skip = existsSync(path.join(dir, "deity", "entries.json")) ? false : "out/db/option/deity not built";

	test("every entry validates and the known ones are there", { skip }, async () => {
		const counts = {};
		for (const kind of ["deity", "disease", "companion"]) {
			const entries = JSON.parse(await readFile(path.join(dir, kind, "entries.json"), "utf8"));
			const index = JSON.parse(await readFile(path.join(dir, kind, "_index.json"), "utf8"));
			assert.equal(validateExtras(kind, entries, index).size, 0, kind);
			counts[kind] = entries.length;
		}
		assert.ok(counts.deity >= 130 && counts.disease >= 60 && counts.companion >= 190, JSON.stringify(counts));
		const deities = JSON.parse(await readFile(path.join(dir, "deity", "entries.json"), "utf8"));
		assert.equal(deities.find(e => e.name === "Avandra").apply.deity, "Avandra");
	});
});
