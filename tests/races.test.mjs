/**
 * Race pipeline tests: HTML -> parsed race -> feature items + the actor patch the importer applies.
 * The fixtures are invented (no book text). The last block checks the real database when out/ exists.
 * Run: npm test
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseRace } from "../parse-races.mjs";
import { buildRace, indexRow, originKey } from "../build-races.mjs";
import { validateRaces } from "../validate-races.mjs";

/** An invented race page in the shape of the compendium's. */
const page = ({ name = "Zorbling", tagline = "Tiny tricksters of the test marsh", traits = "", fixed = "", powers = "" } = {}) => ({
	id: "race900",
	listing: { ID: "race900", Name: name, Origin: "Fey", Size: "Small", SourceBook: "TST, TST2" },
	html: `<h1 class=player>${name}</h1><i>${tagline}</i><br><p class=flavor><b>RACIAL TRAITS</b></p><blockquote>`
		+ `<b>Average Height</b>: 3' 0" - 3'6"<br><b>Average Weight</b>: 40 - 60<br><br>`
		+ (fixed || `<b>Ability scores</b>: +2 Dexterity, +2 Intelligence or +2 Wisdom<br><b>Size</b>: Small<br><b>Speed</b>: 5 squares. <br><b>Vision</b>: Darkvision<br><br>`)
		+ `<b>Languages</b>: Common, Deep Speech, Zorbish<br><b>Skill Bonuses</b>: +2 Stealth, +2 Thievery.<br>`
		+ traits + `<br></blockquote><br>` + powers
		+ `<h3>PHYSICAL QUALITIES</h3>Zorblings are small and damp.<br>    They live in marshes.<h3>PLAYING A ZORBLING</h3>Be tricky.`,
});

const TRAITS = `<b>Marsh Step</b>: You ignore difficult terrain made of mud.<br>`
	+ `<b>Zorbling Hop</b>: You have the zorbling hop power.<br>`
	+ `<b>Damp Nerves</b>: You gain a +1 racial bonus to Will. In addition, you gain a +2 racial bonus to saving throws against fear.<br>`
	+ `<b>Quick Feet</b>: You gain a +1 racial bonus to Reflex while you are bloodied.<br>`
	+ `<b>Slime Spit</b>: You can use slime spit as an encounter power.<br>`;

const POWERS = [
	{ id: "power1", name: "Zorbling Hop", class: "Zorbling", powerType: "race" },
	{ id: "power2", name: "Slime Spit", class: "Zorbling", powerType: "race" },
	{ id: "power3", name: "Marsh Gift", class: "Zorbling", powerType: "race" },
	{ id: "power4", name: "Zorbling Hop (Fighter)", class: "Fighter", powerType: "class" },
];

describe("race parser", () => {
	test("basic traits", () => {
		const r = parseRace(page({ traits: TRAITS }));
		assert.equal(r.name, "Zorbling");
		assert.deepEqual(r.sources, ["TST", "TST2"]);
		assert.equal(r.sourceCode, "TST");
		assert.equal(r.tagline, "Tiny tricksters of the test marsh");
		assert.deepEqual([r.size, r.speed.squares, r.vision], ["sm", 5, "dv"]);
		assert.equal(r.height, "3' 0\" - 3'6\"");
		assert.equal(r.quality, "complete");
	});

	test("skill bonuses become sheet keys", () => {
		assert.deepEqual(parseRace(page()).skillBonuses, { stl: 2, thi: 2 });
	});

	test("known languages go to the spoken list, unknown ones to the free text, choices are kept apart", () => {
		const r = parseRace(page());
		assert.deepEqual(r.languages.spoken, ["Common", "DeepSpeech"]);
		assert.deepEqual(r.languages.custom, ["Zorbish"]);
		const choice = parseRace(page({ fixed: "" }));
		assert.deepEqual(choice.languages.choices, []);
		const p = page();
		p.html = p.html.replace("Common, Deep Speech, Zorbish", "Common, choice of two others");
		assert.deepEqual(parseRace(p).languages, { text: "Common, choice of two others", spoken: ["Common"], custom: [], choices: ["choice of two others"] });
	});

	test("ability scores: the first is given, the last two are the alternatives for the second +2", () => {
		assert.deepEqual(parseRace(page()).abilityScores, {
			text: "+2 Dexterity, +2 Intelligence or +2 Wisdom",
			fixed: [{ ability: "dex", bonus: 2 }],
			choose: [{ ability: "int", bonus: 2 }, { ability: "wis", bonus: 2 }],
			any: false,
		});
		const two = page({ fixed: `<b>Ability scores</b>: +2 Strength, +2 Wisdom<br><b>Size</b>: Medium<br><b>Speed</b>: 6 squares.<br><b>Vision</b>: Normal<br>` });
		assert.deepEqual(parseRace(two).abilityScores.fixed.map(a => a.ability), ["str", "wis"]);
		assert.deepEqual(parseRace(two).abilityScores.choose, []);
		const any = page({ fixed: `<b>Ability scores</b>: +2 to one ability score of your choice<br><b>Size</b>: Medium<br><b>Speed</b>: 6 squares.<br><b>Vision</b>: Normal<br>` });
		assert.equal(parseRace(any).abilityScores.any, true);
	});

	test("an unconditional defence bonus is taken; conditional ones stay in the text only", () => {
		const r = parseRace(page({ traits: TRAITS }));
		assert.deepEqual(r.defenceBonuses, { wil: 1 });
		const nerves = r.traits.find(t => t.name === "Damp Nerves");
		assert.deepEqual(nerves.appliesDefences, ["wil"]);
		assert.match(nerves.text, /against fear/, "the whole text is kept");
		assert.deepEqual(r.traits.find(t => t.name === "Quick Feet").appliesDefences, [], "'while you are bloodied' is not a flat bonus");
	});

	test("a list of defences in one sentence", () => {
		const r = parseRace(page({ traits: `<b>Tough</b>: You gain a +1 racial bonus to Fortitude, Reflex, and Will.<br>` }));
		assert.deepEqual(r.defenceBonuses, { fort: 1, ref: 1, wil: 1 });
	});

	test("racial powers are named, in both phrasings, and are not traits", () => {
		const r = parseRace(page({ traits: TRAITS }));
		assert.deepEqual(r.powerNames, ["zorbling hop", "slime spit"]);
		assert.deepEqual(r.traits.map(t => t.name), ["Marsh Step", "Damp Nerves", "Quick Feet"]);
	});

	test("the flavour text is kept in headed sections", () => {
		const r = parseRace(page());
		assert.deepEqual(r.description.map(d => d.heading), ["PHYSICAL QUALITIES", "PLAYING A ZORBLING"]);
		assert.match(r.description[0].text, /small and damp\.\nThey live in marshes\./);
	});

	test("a sub-race without a traits block is description-only, with the size from the listing", () => {
		const r = parseRace({ id: "race901", listing: { Name: "Marsh Zorbling", Size: "Small", Origin: "Fey", SourceBook: "TST" }, html: "<h1 class=player>Marsh Zorbling</h1><br>Lives deeper in the marsh.<br><h3>Roleplaying</h3>Be damp." });
		assert.equal(r.quality, "description-only");
		assert.equal(r.size, "sm");
		assert.deepEqual(r.notes, ["no-traits-block"]);
		assert.ok(r.description.length >= 1);
	});
});

describe("race builder", () => {
	const build = (options, powers = POWERS) => buildRace(parseRace(page(options)), powers);

	test("the race is one feature item plus one per trait, all of featureType race, all pointing at the race", () => {
		const e = build({ traits: TRAITS });
		assert.deepEqual(e.items.map(i => i.name), ["Zorbling", "Marsh Step", "Damp Nerves", "Quick Feet"]);
		for (const item of e.items) {
			assert.equal(item.type, "feature");
			assert.equal(item.system.featureType, "race");
			assert.equal(item.system.featureSource, "Zorbling");
			assert.equal(item.flags.dnd4e.import.bundle, e._id);
			assert.equal(item.flags.dnd4e.import.kind, "race");
		}
		assert.equal(e._id, e.items[0]._id);
		assert.match(e.items[0].system.description.value, /<strong>Speed:<\/strong> 5 squares/);
		assert.match(e.items[0].system.description.value, /Tiny tricksters/);
		assert.equal(new Set(e.items.map(i => i._id)).size, 4);
	});

	test("ids are stable: building twice gives the same ids", () => {
		assert.deepEqual(build({ traits: TRAITS }).items.map(i => i._id), build({ traits: TRAITS }).items.map(i => i._id));
	});

	test("the actor patch holds what the sheet has fields for", () => {
		assert.deepEqual(build({ traits: TRAITS }).apply, {
			race: "Zorbling", size: "sm", origin: "fey", vision: "dv", speed: 5,
			spoken: ["Common", "DeepSpeech"], customLanguages: ["Zorbish"], skills: { stl: 2, thi: 2 }, defences: { wil: 1 },
		});
	});

	test("racial powers come from the power database: named ones are granted, the rest are options", () => {
		const e = build({ traits: TRAITS });
		assert.deepEqual(e.powers, [
			{ id: "power1", name: "Zorbling Hop", granted: true },
			{ id: "power2", name: "Slime Spit", granted: true },
			{ id: "power3", name: "Marsh Gift", granted: false },
		], "the Fighter's power with the same name is not a racial power");
		assert.ok(!e.notes.includes("power-choice"));
	});

	test("when no power is named the race says the player chooses", () => {
		assert.ok(build({ traits: "" }).notes.includes("power-choice"));
		assert.ok(build({ traits: TRAITS }, []).notes.includes("no-powers-found"));
	});

	test("notes tell what is left to the player", () => {
		const e = build({ traits: TRAITS });
		assert.ok(e.notes.includes("ability-scores-manual"));
		assert.ok(!e.notes.includes("language-choice"));
	});

	test("origin: the compendium's extra keywords are dropped, unknown origins are null", () => {
		assert.equal(originKey("Natural Reptile"), "natural");
		assert.equal(originKey("Fey Shapechanger"), "fey");
		assert.equal(originKey("Living Undead"), null);
		assert.equal(originKey(null), null);
	});

	test("the index row is light and lists the items", () => {
		const e = build({ traits: TRAITS });
		const row = indexRow(e);
		assert.equal(row.name, "Zorbling");
		assert.deepEqual(row.items, e.items.map(i => i._id));
		assert.equal("apply" in row, false);
		assert.equal(row.abilityScores, "+2 Dexterity, +2 Intelligence or +2 Wisdom");
	});

	test("the built race passes the static validation, and breaking it is caught", () => {
		const e = build({ traits: TRAITS });
		assert.equal(validateRaces([e], [indexRow(e)], new Set(["power1", "power2", "power3"])).size, 0);
		const bad = structuredClone(e);
		bad.apply.size = "gigantic"; bad.apply.skills.xyz = 2; bad.apply.origin = "plasma";
		const errors = validateRaces([bad], [indexRow(e)], new Set(["power1"]));
		assert.ok([...errors.keys()].some(m => /size: "gigantic"/.test(m)));
		assert.ok([...errors.keys()].some(m => /skill: "xyz"/.test(m)));
		assert.ok([...errors.keys()].some(m => /origin: "plasma"/.test(m)));
		assert.ok([...errors.keys()].some(m => /not in the power database/.test(m)));
	});

	test("HTML in book text is escaped in the descriptions", () => {
		const e = build({ traits: `<b>Odd</b>: You are &lt;b&gt;bold&lt;/b&gt; &amp; brave.<br>` });
		assert.equal(e.items[1].system.description.value, "<p>You are &lt;b&gt;bold&lt;/b&gt; &amp; brave.</p>");
	});
});

const here = path.dirname(fileURLToPath(import.meta.url));
const dbDir = path.join(here, "..", "out", "db");
const skip = existsSync(path.join(dbDir, "race", "races.json")) ? false : "race database not built (out/db/race)";

describe("real race database", { skip }, () => {
	test("all races pass the static validation and every race is in the index", async () => {
		const entries = JSON.parse(await readFile(path.join(dbDir, "race", "races.json"), "utf8"));
		const index = JSON.parse(await readFile(path.join(dbDir, "race", "_index.json"), "utf8"));
		const powerIds = new Set(JSON.parse(await readFile(path.join(dbDir, "power", "_index.json"), "utf8")).map(p => p.id));
		const errors = validateRaces(entries, index, powerIds);
		assert.deepEqual([...errors.keys()], []);
		assert.equal(entries.length, index.length);
		assert.ok(entries.length >= 50);
	});

	test("known races read like the book: elf, human, eladrin", async () => {
		const entries = JSON.parse(await readFile(path.join(dbDir, "race", "races.json"), "utf8"));
		const by = n => entries.find(e => e.name === n);
		assert.deepEqual(by("Elf").apply, { race: "Elf", size: "med", origin: "fey", vision: "lv", speed: 7, spoken: ["Common", "Elven"], customLanguages: [], skills: { nat: 2, prc: 2 }, defences: {} });
		assert.deepEqual(by("Human").apply.defences, { fort: 1, ref: 1, wil: 1 });
		assert.equal(by("Human").apply.speed, 6);
		assert.deepEqual(by("Eladrin").apply.defences, { wil: 1 });
		assert.ok(by("Elf").powers.some(p => p.name === "Elven Accuracy" && p.granted));
		assert.ok(by("Dragonborn").notes.includes("power-choice"));
	});
});
