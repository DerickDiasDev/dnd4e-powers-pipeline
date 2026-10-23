/**
 * Trap tests: HTML (three layouts) -> parsed trap -> Hazard actor. The fixtures are invented (no book text).
 * The last block checks the real database when out/ exists.
 * Run: npm test
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseHeader, parseTrap, splitSections, trapLines, withoutHeader } from "../parse-traps.mjs";
import { buildTrap, describeHtml, indexRow } from "../build-traps.mjs";
import { extractPowers } from "../trap-powers.mjs";
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
		assert.ok(!t.body.includes("Attack: +4 vs. Reflex"), "the attack is a power, not text");
		assert.deepEqual(t.powers.map(p => [p.name, p.attack.bonus, p.attack.defence]), [["Zorb Pit (Elite)", 4, "ref"]]);
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
	test("a Hazard actor with the printed numbers; what is not printed is switched off", () => {
		const a = buildTrap(parseTrap(hazardLayout()));
		assert.deepEqual([a.type, a.system.advancedCals, a.system.details.level, a.system.details.exp, a.system.attributes.hp.max, a.system.attributes.init.base], ["Hazard", false, 10, 500, 90, 10]);
		assert.deepEqual([a.system.attributes.hp.none, a.system.attributes.init.none], [false, false]);
		assert.deepEqual([a.system.defences.ac.base, a.system.defences.ac.none, a.system.defences.wil.none], [24, false, true], "a defence the page marks with a dash is switched off");
		assert.deepEqual(a.system.details.role, { primary: "hazard", secondary: "standard", tertiary: "blaster" });
		assert.deepEqual(a.flags.dnd4e.import.keywords, ["Hazard"]);
		const bare = buildTrap(parseTrap(terrainLayout()));
		assert.deepEqual([bare.system.attributes.hp.none, bare.system.attributes.hp.max, bare.system.details.level], [true, 0, 0]);
		assert.deepEqual([bare.system.defences.ac.none, bare.system.attributes.init.none], [true, true]);
		assert.deepEqual(bare.system.details.role, { primary: "other", secondary: "standard", tertiary: "other" });
		assert.deepEqual(bare.flags.dnd4e.import.keywords, ["Terrain", "Fantastic Terrain"]);
	});

	test("how to notice it and how to deal with it have their own fields, and are not in the description", () => {
		const t = parseTrap(trapLayout({ extra: '<span class=trapblocktitle>Perception</span><span class=trapblockbody>✦ DC 22: Notice the stonework.</span><span class=trapblocktitle>Countermeasures</span><span class=trapblockbody>✦ Thievery DC 12: Trigger it.</span><span class=trapblockbody>✦ Thievery DC 27: Disable it.</span>' }));
		assert.deepEqual([t.detection, t.countermeasures], ["DC 22: Notice the stonework.", "Thievery DC 12: Trigger it.\nThievery DC 27: Disable it."]);
		assert.ok(!t.body.some(l => /Notice the stonework|Disable it|^Perception$|^Countermeasures$/.test(l)));
		const a = buildTrap(t);
		assert.deepEqual([a.system.details.detection, a.system.details.countermeasures.split("\n").length], ["DC 22: Notice the stonework.", 2]);
	});

	test("the numbers the actor has fields for are not repeated in the text; a Detect line is the detection", () => {
		const { body, detection } = splitSections(["Detect automatic", "Standard Actions", "Hit: 1d8."]);
		assert.deepEqual([detection, body], ["Detect automatic", ["Standard Actions", "Hit: 1d8."]]);
		const t = parseTrap(hazardLayout());
		assert.ok(!t.body.some(l => /^(?:HP|AC|Initiative) /.test(l)));
	});

	test("the description escapes the text and bolds the titles of the blocks", () => {
		const html = describeHtml({ body: ["Trigger", "A <b> creature enters.", "Attack: +4 vs. Reflex"] });
		assert.equal(html, "<p><strong>Trigger</strong></p><p>A &lt;b&gt; creature enters.</p><p>Attack: +4 vs. Reflex</p>");
	});

	test("ids are deterministic, the index row has the monsters' shape, and what is built validates", () => {
		const t = parseTrap(trapLayout());
		const a = buildTrap(t), b = buildTrap(t);
		assert.equal(a._id, b._id);
		const row = indexRow(a, t, "tst.json");
		assert.deepEqual([row.level, row.role, row.group, row.file, row.powers, row.traits], [3, "warder", "elite", "tst.json", 1, 0]);
		assert.equal(validateTraps([a], [row]).size, 0);
		a.system.attributes.hp.max = 5;
		assert.match([...validateTraps([a], [row]).keys()].join(), /hit points/, "no hit points (none) but a maximum");
		a.system.attributes.hp.none = false;
		a.system.attributes.hp.value = 5;
		assert.equal(validateTraps([a], [row]).size, 0, "hit points that are on, at least 1 and full, are fine");
	});
});

describe("the attacks of a trap are powers on the actor", () => {
	const lines = ["A pit.", "Trigger", "A creature enters.", "Attack", "Opportunity Action Close burst 2", "Target: Each creature in burst", "Attack: +9 vs. Will", "Hit: 2d6 + 3 fire damage, and the target is dazed (save ends).", "Miss: Half damage.", "Special: Once a round.", "The pit stays open."];

	test("the block that follows an Attack title: action, range, target, bonus, damage; the prose around it stays", () => {
		const { powers, body } = extractPowers(lines, "Zorb Pit");
		assert.deepEqual(body, ["A pit.", "Trigger", "A creature enters.", "The pit stays open."]);
		const [p] = powers;
		assert.deepEqual([p.name, p.action, p.usage, p.attack.range, p.attack.bonus, p.attack.defence, p.attack.damage], ["Zorb Pit", "opportunity", "atwill", "Close burst 2", 9, "wil", "2d6+3"]);
		const item = buildTrap({ id: "trap910", name: "Zorb Pit", kind: "trap", level: 3, group: "standard", role: "", xp: 100, hp: null, initiative: null, defences: null, detection: "", countermeasures: "", body, powers, sourceCode: "TST", notes: [] }).items[0];
		assert.deepEqual([item.type, item.system.actionType, item.system.rangeType, item.system.area, item.system.attack.formula, item.system.attack.def, item.system.hit.formula, item.system.miss.halfDamage], ["power", "opportunity", "closeBurst", "2", "9", "wil", "2d6 + 3", true]);
		assert.equal(item.flags.dnd4e.import.kind, "trap-power");
	});

	test("the page may leave out the word Action, number its attacks and give them keywords; two powers of one name are numbered", () => {
		const text = ["Attack 1 * Necrotic", "Immediate Interrupt Ranged 10", "Attack: +5 vs. AC", "Hit: 1d6 damage.", "Attack 2", "Standard Action Melee", "Attack: +5 vs. AC", "Hit: 2d6 damage."];
		const { powers } = extractPowers(text, "Zorb");
		assert.deepEqual(powers.map(p => [p.name, p.action, p.keywords, p.attack.range]), [["Zorb (attack 1)", "interrupt", ["Necrotic"], "Ranged 10"], ["Zorb (attack 2)", "standard", [], "Melee 1"]]);
	});

	test("triggered actions are powers with the monsters' headings", () => {
		const text = ["Triggered Actions", "ᗕ Silver Fire (radiant) ✦ Daily", "Trigger: The chest is opened.", "Attack: Close burst 3 (each undead in the burst); +11 vs. Fortitude", "Hit: 2d6 + 5 radiant damage."];
		const { powers, body } = extractPowers(text, "Brazier");
		assert.deepEqual(body, []);
		assert.deepEqual(powers.map(p => [p.name, p.usage, p.keywords, p.attack.bonus, p.attack.range]), [["Silver Fire", "daily", ["radiant"], 11, "Close burst 3"]]);
	});

	test("titles with keywords or a name, and a typo in a label", () => {
		const block = ["Standard Action Close burst 2", "Targers All creatures in burst", "Attack: +9 vs. Reflex", "Hit: 1d6 damage."];
		for (const [title, name, keywords] of [["Attack Poison, Fire", "Zorb", ["Poison", "Fire"]], ["Attack • Zone", "Zorb", ["Zone"]], ["Attack—Claws of the Dead", "Zorb (Claws of the Dead)", []], ["Blue Dragon Head Attack", "Zorb (Blue Dragon Head)", []]]) {
			const { powers } = extractPowers([title, ...block], "Zorb");
			assert.deepEqual([powers.length, powers[0]?.name, powers[0]?.keywords, powers[0]?.attack.range, powers[0]?.attack.bonus], [1, name, keywords, "Close burst 2", 9], title);
		}
		assert.equal(extractPowers(["Attack Poison is bad", "Prose."], "Zorb").powers.length, 0, "it needs the action line after it");
	});

	test("a terrain power: its action, then Requirement, Check, Success, Target, Attack and Hit; the attack is the level plus a number", () => {
		const text = ["Standard Action", "Requirement: You must be adjacent.", "Check: Athletics check to shove the rock.", "Success: The rock rolls.", "Target: Each creature in a close blast 3 from the rock", "Attack: Level + 3 vs. Fortitude", "Hit: 2d10 + one-half level damage, and the target is knocked prone."];
		const { powers, body } = extractPowers(text, "Boulder");
		assert.deepEqual([powers.length, body.length, powers[0].action, powers[0].attack.range, powers[0].levelAttack], [1, 0, "standard", "close blast 3", { offset: 3, def: "fort" }]);
		const t = { id: "terrain910", name: "Boulder", kind: "terrain", level: null, group: "standard", role: "", xp: null, hp: null, initiative: null, defences: null, detection: "", countermeasures: "", body, powers, sourceCode: "TST", notes: [] };
		const [item] = buildTrap(t).items;
		assert.deepEqual([item.system.attack.isAttack, item.system.attack.def, item.system.attack.formula, item.flags.dnd4e.import.attackLevelOffset, item.system.requirement], [true, "fort", "3", 3, "You must be adjacent."]);
		const leveled = buildTrap({ ...t, level: 6 }).items[0];
		assert.equal(leveled.system.attack.formula, "9", "the trap's level plus 3");
	});

	test("an Attack title with nothing after it stays in the text", () => {
		assert.deepEqual(extractPowers(["Attack", "Prose."], "Zorb"), { powers: [], body: ["Attack", "Prose."] });
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
		assert.ok(actors.filter(a => a.items.length).length >= 500, "most traps have their attacks as powers");
		const ice = actors.find(a => a.name === "Ice Cell");
		assert.deepEqual([ice.items[0].system.attack.formula, ice.items[0].system.attack.def, ice.items[0].system.rangeType], ["8", "ref", "melee"]);
		const pit = actors.find(a => a.name === "False-Floor Pit (Elite)");
		assert.deepEqual([pit.type, pit.system.details.level, pit.system.details.exp, pit.system.details.role], ["Hazard", 1, 200, { primary: "trap", secondary: "elite", tertiary: "warder" }]);
	});
});
