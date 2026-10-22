/**
 * Ritual tests: HTML -> parsed ritual -> `ritual` item. The fixtures are invented (no book text).
 * The last block checks the real database when out/ exists.
 * Run: npm test
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseBody, parseKeySkill, parseRitual, parseTime } from "../parse-rituals.mjs";
import { buildRitual, describeHtml, indexRow } from "../build-rituals.mjs";
import { validateRituals } from "../validate-rituals.mjs";

const published = `<p class=publishedIn>Published in Test Book, page(s) 1.</p>`;
const page = ({ name = "Zorb Ward", skill = "Arcana or Nature (no check)", time = "10 minutes", duration = "8 hours or until discharged", category = "Warding", body = `<p>You ward a zorb.<br>    More text.</p>`, flavor = "<i>A test ritual.</i><br>" } = {}) => ({
	id: "ritual900",
	listing: { ID: "ritual900", Name: name, Level: "3", SourceBook: "TST, TST2" },
	html: `<h1 class=player>${name}</h1>${flavor}<p><span class=ritualstats><b>Component Cost</b>: 5 gp, plus a focus<br><b>Market Price</b>: 1,250 gp<br><b>Key Skill</b>: ${skill}</span><b>Level</b>: 3<br><b>Category</b>: ${category}<br><b>Time</b>: ${time}<br><b>Duration</b>: ${duration}</p>${body}${published}`,
});

describe("parsing", () => {
	test("key skills: every skill named, and whether the ritual needs no check", () => {
		assert.deepEqual(parseKeySkill("Arcana or Nature (no check)"), { skills: ["arc", "nat"], noCheck: true });
		assert.deepEqual(parseKeySkill("Heal"), { skills: ["hea"], noCheck: false });
		assert.deepEqual(parseKeySkill(null), { skills: [], noCheck: false });
	});

	test("time and duration become the sheet's units, and the printed words are kept", () => {
		assert.deepEqual(parseTime("30 minutes"), { value: "30", units: "minute", text: "30 minutes" });
		assert.deepEqual(parseTime("1 Hour"), { value: "1", units: "hour", text: "1 Hour" });
		assert.deepEqual(parseTime("Instantaneous"), { value: null, units: "inst", text: "Instantaneous" });
		assert.deepEqual(parseTime("Permanent").units, "perm");
		assert.deepEqual(parseTime("Standard action"), { value: null, units: "spec", text: "Standard action" });
		assert.equal(parseTime("8 hours or until discharged").value, "8");
		assert.deepEqual(parseTime(null), { value: null, units: "", text: "" });
	});

	test("a ritual: level, category, price in gold, the stats as printed, flavour and text", () => {
		const r = parseRitual(page());
		assert.deepEqual([r.name, r.level, r.category, r.marketPrice, r.noCheck], ["Zorb Ward", 3, "warding", 1250, true]);
		assert.deepEqual(r.skills, ["arc", "nat"]);
		assert.equal(r.componentCost, "5 gp, plus a focus");
		assert.equal(r.flavor, "A test ritual.");
		assert.deepEqual(r.body.map(b => b.text), ["You ward a zorb.", "More text."]);
		assert.deepEqual(r.sources, ["TST", "TST2"]);
	});

	test("the printed category names map to the system's keys", () => {
		assert.equal(parseRitual(page({ category: "Martial Practice" })).category, "martial");
		assert.equal(parseRitual(page({ category: "Teleportation" })).category, "travel");
		const odd = parseRitual(page({ category: "Zorbish" }));
		assert.deepEqual([odd.category, odd.notes], ["other", ["category-unknown"]]);
	});

	test("result tables are lines marked as table; the pages of an item an alchemical ritual makes are headings and text", () => {
		const body = `<p>Text.<br><br></p><table><tr><th>Check Result</th><th>Duration</th><tr><td>9 or lower<td>1 day<tr><td>10-19<td>3 days</table><h1 class=magicitem>Zorb Oil<br><span class=milevel>Level 1 Uncommon</span></h1><p class=flavor>Power: Standard Action.</p>`;
		const lines = parseBody(page({ body }).html);
		assert.deepEqual(lines.filter(l => l.table).map(l => l.text), ["Check Result | Duration", "9 or lower | 1 day", "10-19 | 3 days"]);
		assert.deepEqual(lines.filter(l => l.heading).map(l => l.text), ["Zorb Oil\nLevel 1 Uncommon"]);
		assert.ok(lines.some(l => l.text === "Power: Standard Action."));
	});

	test("a ritual without a key skill is noted, and defaults to arcana", () => {
		const r = parseRitual(page({ skill: "?" }));
		assert.deepEqual(r.skills, []);
		assert.deepEqual(r.notes, ["skill-unknown"]);
		assert.equal(buildRitual(r).items[0].system.attribute, "skills.arc.total");
	});
});

describe("building", () => {
	test("a ritual item the sheet can roll and read", () => {
		const e = buildRitual(parseRitual(page()));
		const s = e.items[0].system;
		assert.equal(e.items[0].type, "ritual");
		assert.deepEqual([s.level, s.category, s.market, s.attribute, s.formula], [3, "warding", "1,250 gp", "skills.arc.total", "@attribute"]);
		assert.deepEqual([s.castTime, s.duration], [{ value: "10", units: "minute" }, { value: "8", units: "hour" }]);
		assert.deepEqual(e.notes, ["skill-choice"], "two key skills: the first is used");
	});

	test("the description keeps the stats as printed, escapes text and builds tables", () => {
		const r = parseRitual(page({ body: `<p>A &lt;b&gt; thing.</p><table><tr><th>Result</th><th>Effect</th><tr><td>9<td>Bad</table>` }));
		const html = describeHtml(r);
		assert.match(html, /<p><strong>Component Cost:<\/strong> 5 gp, plus a focus<\/p>/);
		assert.match(html, /<strong>Key Skill:<\/strong> Arcana or Nature \(no check\)/);
		assert.match(html, /<p>A &lt;b&gt; thing\.<\/p>/);
		assert.match(html, /<table><tr><th>Result<\/th><th>Effect<\/th><\/tr><tr><td>9<\/td><td>Bad<\/td><\/tr><\/table>/);
	});

	test("ids are deterministic and what is built validates; the validator rejects a bad category and unit", () => {
		const a = buildRitual(parseRitual(page())), b = buildRitual(parseRitual(page()));
		assert.equal(a._id, b._id);
		assert.equal(validateRituals([a], [indexRow(a)]).size, 0);
		a.items[0].system.category = "nonsense";
		a.items[0].system.castTime.units = "fortnight";
		const errors = [...validateRituals([a], [indexRow(a)]).keys()].join("\n");
		assert.match(errors, /category/);
		assert.match(errors, /cast time units/);
	});
});

describe("the real database", () => {
	const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "out", "db", "ritual");
	const skip = existsSync(path.join(dir, "rituals.json")) ? false : "out/db/ritual not built";

	test("every ritual validates and the well-known ones have the book's numbers", { skip }, async () => {
		const entries = JSON.parse(await readFile(path.join(dir, "rituals.json"), "utf8"));
		const index = JSON.parse(await readFile(path.join(dir, "_index.json"), "utf8"));
		assert.equal(validateRituals(entries, index).size, 0);
		assert.ok(entries.length >= 350);
		const alarm = entries.find(e => e.name === "Alarm").items[0].system;
		assert.deepEqual([alarm.level, alarm.category, alarm.market, alarm.castTime.units], [1, "warding", "50 gp", "minute"]);
	});
});
