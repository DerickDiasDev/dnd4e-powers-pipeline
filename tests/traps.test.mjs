/**
 * Trap tests: HTML (three layouts) -> parsed trap -> NPC actor. The fixtures are invented (no book text).
 * The last block checks the real database when out/ exists.
 * Run: npm test
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseHeader, parseTrap, trapLines, withoutHeader } from "../parse-traps.mjs";
import { buildTrap, describeHtml, indexRow } from "../build-traps.mjs";
import { validateTraps } from "../validate-traps.mjs";

const published = `<p class=publishedIn>Published in Test Book, page(s) 1.</p>`;
const trapLayout = ({ name = "Zorb Pit (Elite)", level = "Level 3 Elite Warder", extra = "" } = {}) => ({
	id: "trap900",
	listing: { ID: "trap900", Name: name, Type: "Trap", GroupRole: "Elite", Level: "3", SourceBook: "TST, TST2" },
	html: `<h1 class=trap>${name}<br><span class=type>Trap</span><br><span class=level>${level}<br><span class=xp>XP 150</span></span></h1><p class=flavor><i>A pit.</i></p><span class=traplead><b>Trap:</b> A hidden pit.</span><span class=trapblocktitle>Trigger</span><span class=trapblockbody>A creature enters.</span><span class=trapblocktitle>Attack</span><span class=trapblockbody><b>Attack: </b>+4 vs. Reflex</span>${extra}${published}`,
});
const hazardLayout = () => ({
	id: "trap901",
	listing: { ID: "trap901", Name: "Zorb Stalagmite", Type: "Blaster", GroupRole: "None", Level: "10", SourceBook: "TST" },
	html: `<h1 class=thHead>Zorb Stalagmite</h1><h2 class=thHead>Hazard</h2><p class=th1>Level 10 Blaster<span class=xp>XP 500</span></p><p>Initiative +10</p><p>HP 90</p><p>AC 24, Fortitude 21, Reflex 5, Will —</p><h2 class=thHead>Standard Actions</h2><p class=tbod><i>Hit</i>: 2d8 + 4 lightning damage.</p>${published}`,
});
const terrainLayout = () => ({
	id: "terrain900",
	listing: { ID: "terrain900", Name: "Zorb Lantern", Type: "Terrain", GroupRole: "Fantastic Terrain", Level: "", SourceBook: "TST" },
	html: `<h1 class=dm>Zorb Lantern</h1><p class=flavor>A glowing ball.</p><p>    <b>Effect: </b>A bonus per tier.</p>${published}`,
});

describe("parsing", () => {
	test("the header gives level, group and role, and falls back to the listing", () => {
		assert.deepEqual(parseHeader(["Trap", "Level 1 Elite Warder", "XP 200"]), { level: 1, group: "elite", role: "warder" });
		assert.deepEqual(parseHeader(["Hazard", "Level 10 BlasterXP 500"], {}), { level: 10, group: "standard", role: "blaster" });
		assert.deepEqual(parseHeader(["Level 3 Minion Trap"], {}), { level: 3, group: "minion", role: "" });
		assert.deepEqual(parseHeader(["A pit"], { Level: "7", GroupRole: "Solo" }), { level: 7, group: "solo", role: "" });
	});

	test("the titled blocks of the trap layout are lines of their own, and the title is dropped with its restated header", () => {
		const lines = trapLines(trapLayout().html);
		assert.ok(lines.includes("Trigger") && lines.includes("A creature enters."));
		assert.deepEqual(withoutHeader(["Zorb Pit (Elite)", "Trap", "Level 3 Elite Warder", "XP 150", "A pit."], "Zorb Pit (Elite)"), ["A pit."]);
	});

	test("a trap: kind, level, group, role, XP, source and the text", () => {
		const t = parseTrap(trapLayout());
		assert.deepEqual([t.kind, t.level, t.group, t.role, t.xp], ["trap", 3, "elite", "warder", 150]);
		assert.deepEqual(t.sources, ["TST", "TST2"]);
		assert.equal(t.body[0], "A pit.");
		assert.ok(t.body.includes("Attack: +4 vs. Reflex"));
		assert.deepEqual(t.notes, ["hp-none"]);
	});

	test("a hazard prints its numbers", () => {
		const t = parseTrap(hazardLayout());
		assert.deepEqual([t.kind, t.level, t.role, t.hp, t.initiative, t.defences], ["hazard", 10, "blaster", 90, 10, { ac: 24, fort: 21, ref: 5, wil: null }]);
		assert.deepEqual(t.notes, []);
	});

	test("terrain has no level or hit points, and says what kind of terrain it is", () => {
		const t = parseTrap(terrainLayout());
		assert.deepEqual([t.kind, t.extraKind, t.level, t.hp], ["terrain", "Fantastic Terrain", null, null]);
		assert.deepEqual(t.notes, ["level-missing", "hp-none"]);
		assert.equal(t.body[1], "Effect: A bonus per tier.");
	});
});

describe("building", () => {
	test("an NPC with the printed numbers; at least 1 hit point; the text is the biography", () => {
		const a = buildTrap(parseTrap(hazardLayout()));
		assert.deepEqual([a.type, a.system.advancedCals, a.system.details.level, a.system.details.exp, a.system.attributes.hp.max, a.system.attributes.init.base], ["NPC", false, 10, 500, 90, 10]);
		assert.deepEqual([a.system.defences.ac.base, a.system.defences.wil.base], [24, 10], "an unprinted defence is 10");
		assert.equal(a.system.details.role.primary, "blaster");
		assert.deepEqual(a.flags.dnd4e.import.keywords, ["Hazard"]);
		const bare = buildTrap(parseTrap(terrainLayout()));
		assert.deepEqual([bare.system.attributes.hp.max, bare.system.details.level], [1, 0]);
		assert.deepEqual(bare.flags.dnd4e.import.keywords, ["Terrain", "Fantastic Terrain"]);
	});

	test("the biography escapes the text and bolds the titles of the blocks", () => {
		const html = describeHtml({ body: ["Trigger", "A <b> creature enters.", "Attack: +4 vs. Reflex"] });
		assert.equal(html, "<p><strong>Trigger</strong></p><p>A &lt;b&gt; creature enters.</p><p>Attack: +4 vs. Reflex</p>");
	});

	test("ids are deterministic, the index row has the monsters' shape, and what is built validates", () => {
		const t = parseTrap(trapLayout());
		const a = buildTrap(t), b = buildTrap(t);
		assert.equal(a._id, b._id);
		const row = indexRow(a, t, "tst.json");
		assert.deepEqual([row.level, row.role, row.group, row.file, row.powers, row.traits], [3, "warder", "elite", "tst.json", 0, 0]);
		assert.equal(validateTraps([a], [row]).size, 0);
		a.system.attributes.hp.max = 0;
		assert.match([...validateTraps([a], [row]).keys()].join(), /hit points/);
	});
});

describe("the real database", () => {
	const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "out", "db", "trap");
	const skip = existsSync(path.join(dir, "_index.json")) ? false : "out/db/trap not built";

	test("every trap validates and the well-known ones have the book's numbers", { skip }, async () => {
		const index = JSON.parse(await readFile(path.join(dir, "_index.json"), "utf8"));
		const actors = [];
		for (const f of (await readdir(dir)).filter(f => f !== "_index.json")) actors.push(...JSON.parse(await readFile(path.join(dir, f), "utf8")));
		assert.equal(validateTraps(actors, index).size, 0);
		assert.equal(index.length, actors.length);
		assert.ok(actors.length >= 770);
		const pit = actors.find(a => a.name === "False-Floor Pit (Elite)");
		assert.deepEqual([pit.system.details.level, pit.system.details.exp, pit.system.details.role.secondary, pit.system.details.role.primary], [1, 200, "elite", "warder"]);
	});
});
