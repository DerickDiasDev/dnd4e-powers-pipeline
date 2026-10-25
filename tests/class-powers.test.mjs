/**
 * The powers a class page spells out and the catalog does not list: read from the page, added once, never twice.
 * Run: npm test
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { baseClassName, classPowerEntries, powerBlocks } from "../collect-class-powers.mjs";

const QUARRY = "<h1 class=atwillpower>Hunter's Quarry<span class=level>Hunter's Quarry Power</span></h1><p class=powerstat><b>At-Will</b><br><b>Minor Action</b>  </p><p class=flavor><b>Effect</b>: You can designate the nearest enemy to you that you can see as your quarry.</p><table><tr><th>Level</th></tr></table><br>Addition (10/17/2008)<br>Add the following sentence.";
const STEED = "<h1 class=encounterpower>Summon Celestial Steed<span class=level>Paladin Utility 4</span></h1><p class=powerstat><b>Daily</b><br><b>Minor Action</b></p><p class=flavor><b>Effect</b>: A steed appears.</p>";
const page = (name, html) => ({ listing: { Name: name }, html });

describe("the power blocks of a class page", () => {
	test("each block: its name, its kind and level from the heading, its text up to the notes", () => {
		const [block] = powerBlocks(`<p>The class.</p>${QUARRY}<br><br><b>Hybrid talent Options</b>`);
		assert.deepEqual([block.name, block.kind, block.level], ["Hunter's Quarry", "Feature", "1"]);
		assert.ok(block.html.includes("nearest enemy") && !block.html.includes("Addition") && !block.html.includes("Hybrid talent"));
		const [steed] = powerBlocks(STEED);
		assert.deepEqual([steed.name, steed.kind, steed.level], ["Summon Celestial Steed", "Utility", "4"]);
	});

	test("two blocks one after the other are two", () => {
		assert.deepEqual(powerBlocks(QUARRY + STEED).map(b => b.name), ["Hunter's Quarry", "Summon Celestial Steed"]);
	});
});

describe("the entries to add", () => {
	test("a block the catalog does not have becomes an entry of the base class, in the catalog's shape", () => {
		const [entry] = classPowerEntries([page("Ranger", `${QUARRY}`)], []);
		assert.equal(entry.id, "classpower-ranger-hunter-s-quarry");
		assert.deepEqual(entry.listing, { ID: entry.id, Name: "Hunter's Quarry", ClassName: "Ranger", Level: "1", Type: "Ranger Feature", Action: "Minor", Keywords: "", SourceBook: "ClassFeature" });
		assert.ok(entry.html.startsWith("<h1 class=atwillpower>"));
	});

	test("a power already in the catalog, a secondary power and a hybrid class's copy are left out; the same block twice is one", () => {
		const known = [{ id: "p1", listing: { Name: "Summon Celestial Steed" } }];
		const secondary = "<h1 class=dailypower>Well of Shadows Secondary Power<span class=level></span></h1><p>x</p>";
		const entries = classPowerEntries([page("Paladin (Cavalier)", STEED), page("Ranger", QUARRY + secondary), page("Hybrid Ranger", QUARRY), page("Ranger (Scout)", QUARRY)], known);
		assert.deepEqual(entries.map(e => e.listing.Name), ["Hunter's Quarry"]);
		assert.equal(entries[0].listing.ClassName, "Ranger");
	});

	test("the base name of a class, none for a hybrid", () => {
		assert.deepEqual(["Wizard (Arcanist)", "Ranger", "Hybrid Ranger"].map(baseClassName), ["Wizard", "Ranger", null]);
	});
});
