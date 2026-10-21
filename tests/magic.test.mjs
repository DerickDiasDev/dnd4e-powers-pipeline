/**
 * Magic item tests: HTML -> parsed item -> Foundry item. The fixtures are invented (no book text).
 * The last block checks the real database when out/ exists.
 * Run: npm test
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseBody, parseLevelLine, parseMagic, parseTiers } from "../parse-magic.mjs";
import { baseOf, buildMagic, describeHtml, indexRow } from "../build-magic.mjs";
import { validateMagic } from "../validate-magic.mjs";

const table = rows => `<table class=magicitem>${rows.map(([l, e, p]) => `<tr><td class=mic1>Lvl ${l}<td class=mic2>${e}<td class=mic3>${p}<td class=mic4> `).join("")}</table>`;
const published = `<p class=publishedIn>Published in Test Book, page(s) 1.</p>`;
const page = ({ name = "Zorb Weapon", level = "Level 4+ Uncommon", tiers = [[4, "+1", "840 gp"], [9, "+2", "4,200 gp"]], stats = `<p class=mistat><b>Weapon: </b>Maces</p><p class=mistat><b>Enhancement Bonus:</b> attack rolls and damage rolls</p><p class='mistat indent'><b>Critical:</b> +1d6 damage per plus</p>`, sections = `<h2 class=mihead>Property</h2><p class=mistat>You gain a +1 item bonus to Thievery checks.<br></p>` } = {}) =>
	`<h1 class=mihead>${name}<span class=milevel id=headerlevel>${level}</span></h1><p class=miflavor>A test item.</p>${tiers ? table(tiers) : ""}${stats}${sections}<br><br>${published}`;
const entry = (html, listing = {}) => ({ id: "weapon9", listing: { Name: "Zorb Weapon", Category: undefined, Type: "Maces", Rarity: "Uncommon", SourceBook: "TST", Cost: "", ...listing }, html });

describe("parsing", () => {
	test("the levels table gives one tier per row, in level order, with enhancement and price", () => {
		const tiers = parseTiers(page({ tiers: [[9, "+2", "4,200 gp"], [4, "+1", "840 gp"], [14, "+3", "21,000 gp"]] }));
		assert.deepEqual(tiers, [{ level: 4, enhancement: 1, price: 840 }, { level: 9, enhancement: 2, price: 4200 }, { level: 14, enhancement: 3, price: 21000 }]);
		assert.deepEqual(parseTiers(page({ tiers: null })), []);
	});

	test("the title line gives level, whether it scales, and rarity", () => {
		assert.deepEqual(parseLevelLine(page()), { level: 4, scales: true, rarity: "Uncommon" });
		assert.deepEqual(parseLevelLine(page({ level: "Level 8 Rare" })), { level: 8, scales: false, rarity: "Rare" });
		assert.equal(parseLevelLine(`<span class=milevel>Heroic Level</span>`), null);
	});

	test("stats, the property bullets and a power with its lines", () => {
		const html = page({ sections: `<h2 class=mihead>Properties</h2><ul class=mistat><li>One.<br></li><li>Two.<br></li></ul><h2 class=mihead>Power ✦ Daily (Free Action)</h2><p class='mistat indent1'><i>Trigger:</i> You hit.</p><p class='mistat indent1'><i>Effect:</i> You push.</p>` });
		const body = parseBody(html);
		assert.equal(body.stats.Weapon, "Maces");
		assert.equal(body.stats.Critical, "+1d6 damage per plus");
		assert.deepEqual(body.sections.map(s => s.heading), ["Properties", "Power ✦ Daily (Free Action)"]);
		assert.deepEqual(body.sections[0].paragraphs, [{ text: "One.", bullet: true }, { text: "Two.", bullet: true }]);
		assert.equal(body.sections[1].paragraphs[1].text, "Effect: You push.");
	});

	test("a slot line before the sections is a stat, and an unbolded paragraph is kept as intro", () => {
		const html = `<h1 class=mihead>X<span class=milevel>Level 1 Common</span></h1><p class=miflavor>f</p><p class=mistat><b>Hands Slot</b>        360 gp</p><p class=mistat>The X is a +2 thing.</p><h2 class=mihead>Property</h2><p class=mistat>Does.</p>`;
		const body = parseBody(html);
		assert.equal(body.stats["Hands Slot"], "360 gp");
		assert.deepEqual(body.intro, ["The X is a +2 thing."]);
	});

	test("an item without a table has one tier: its own level, price and printed enhancement", () => {
		const m = parseMagic(entry(page({ tiers: null, level: "Level 17 Rare", stats: `<p class=mistat><b>Weapon: </b>Short sword</p><p class=mistat><b>Enhancement Bonus:</b> +4 to Attack rolls and damage rolls</p>` }), { Cost: "9,000 gp", Type: "Short sword" }));
		assert.deepEqual(m.tiers, [{ level: 17, enhancement: 4, price: 9000 }]);
		assert.equal(m.scales, false);
	});
});

describe("building", () => {
	const build = (html, listing, mundane) => buildMagic(parseMagic(entry(html, listing)), mundane);
	const mundane = new Map([["Chainmail", { bonus: 6, check: -1, speed: -1 }], ["Heavy Shield", { bonus: 2, check: -2, speed: null }]]);

	test("a weapon takes the first tier's enhancement and says which weapons fit, without inventing damage", () => {
		const e = build(page(), { Type: "Maces" });
		const item = e.items[0];
		assert.equal(item.type, "weapon");
		assert.equal(item.system.enhance, 1);
		assert.equal(item.system.price, 840);
		assert.equal(item.system.level, 4);
		assert.deepEqual(item.system.weaponGroup, { mace: true });
		assert.equal(item.system.damageDice, undefined);
		assert.equal(item.flags.dnd4e.import.enhancePath, "system.enhance");
		assert.deepEqual(e.base, { kind: "weapon", groups: ["mace"], any: null, name: null, ranged: false });
		assert.equal(e.tiers.length, 2);
	});

	test("a weapon that names one weapon gets its type and base type", () => {
		const e = build(page(), { Type: "Longsword" });
		assert.equal(e.items[0].system.weaponType, "militaryM");
		assert.equal(e.items[0].system.weaponBaseType, "longsword");
		const any = build(page(), { Type: "Any ranged" });
		assert.equal(any.base.any, "ranged");
		assert.equal(any.items[0].system.isRanged, true);
	});

	test("armour of one kind brings that armour's bonus and penalties", () => {
		const e = build(page({ stats: `<p class=mistat><b>Armor: </b>Chain</p><p class=mistat><b>Enhancement Bonus:</b> AC</p>`, sections: "" }), { Type: "Chain", Category: "Armor" }, mundane);
		const a = e.items[0].system.armour;
		assert.deepEqual([e.items[0].type, a.type, a.subtype, a.enhance, a.ac, a.movePenValue, a.skillCheckValue], ["equipment", "armour", "heavy", 1, 6, -1, -1]);
		assert.equal(e.items[0].system.armourBaseType, "chain");
		assert.equal(e.items[0].flags.dnd4e.import.enhancePath, "system.armour.enhance");
	});

	test("armour of several kinds says the base is unknown instead of guessing", () => {
		const e = build(page({ stats: `<p class=mistat><b>Armor: </b>Chain or plate</p>`, sections: "" }), { Type: "Chain or plate", Category: "Armor" }, mundane);
		assert.equal(e.items[0].system.armourBaseType, "");
		assert.ok(e.notes.includes("base-unknown"));
	});

	test("a shield is an arms item with no enhancement to patch", () => {
		const e = build(page({ stats: `<p class=mistat><b>Armor: </b>Heavy shield</p>`, sections: "" }), { Type: "Heavy shield", Category: "Armor" }, mundane);
		const s = e.items[0].system;
		assert.deepEqual([s.armour.type, s.armour.subtype, s.armour.ac, s.armour.ref, s.shieldBaseType], ["arms", "heavy", 2, 2, "heavy"]);
		assert.equal(e.items[0].flags.dnd4e.import.enhancePath, null);
	});

	test("a slot item with a plain bonus carries an effect that only works while it is equipped", () => {
		const html = `<h1 class=mihead>Gloves<span class=milevel>Level 1 Common</span></h1><p class=miflavor>f</p><p class=mistat><b>Hands Slot</b>        360 gp</p><h2 class=mihead>Property</h2><p class=mistat>You gain a +1 item bonus to Thievery checks.<br></p>`;
		const e = buildMagic(parseMagic({ id: "item9", listing: { Name: "Gloves", Category: "Hands", Type: "", Rarity: "Common", SourceBook: "TST", Cost: "360 gp" }, html }));
		const item = e.items[0];
		assert.equal(item.system.armour.type, "hands");
		assert.equal(item.effects.length, 1);
		assert.equal(item.effects[0].transfer, true);
		assert.equal(item.effects[0].system.equippedRec, true);
	});

	test("a bonus that changes with the level is not made into an effect", () => {
		const sections = `<h2 class=mihead>Property</h2><p class=mistat>You gain a +1 item bonus to Thievery checks.<br>    <i>Level 11:</i> +2 item bonus</p>`;
		const e = build(page({ sections }), { Type: "Maces" });
		assert.equal(e.items[0].effects.length, 0);
		assert.match(e.items[0].system.description.value, /Level 11/);
	});

	test("the description escapes text, lists bullets and keeps the powers", () => {
		const html = describeHtml(parseMagic(entry(page({ sections: `<h2 class=mihead>Properties</h2><ul class=mistat><li>A &lt;b&gt; thing.<br></li></ul><h2 class=mihead>Power ✦ Daily (Free Action)</h2><p class='mistat indent1'><i>Effect:</i> You push.</p>` }))));
		assert.match(html, /<ul><li>A &lt;b&gt; thing\.<\/li><\/ul>/);
		assert.match(html, /<h3>Power ✦ Daily \(Free Action\)<\/h3><p>Effect: You push\.<\/p>/);
		assert.match(html, /<strong>Critical:<\/strong>/);
	});

	test("ids are deterministic, the index row is light, and what is built validates", () => {
		const a = build(page(), { Type: "Maces" }), b = build(page(), { Type: "Maces" });
		assert.equal(a._id, b._id);
		const row = indexRow(a, "tst.json");
		assert.equal(row.items[0], a._id);
		assert.equal(row.powers, 0);
		assert.equal(validateMagic([a], [row]).size, 0);
	});

	test("the validator rejects a tier out of order and an effect that is not suppressed when unequipped", () => {
		const a = build(page(), { Type: "Maces" });
		a.tiers.reverse();
		a.items[0].effects = [{ _id: "aaaaaaaaaaaaaaaa", name: "x", transfer: true, statuses: [], system: { changes: [{ key: "system.skills.thi.item", type: "upgrade", value: 1 }], durationType: "", powerEffectType: "misc", dots: [], keywords: [] } }];
		const errors = [...validateMagic([a], [indexRow(a, "tst.json")]).keys()].join("\n");
		assert.match(errors, /increasing level order/);
		assert.match(errors, /suppressed while the item is not equipped/);
	});

	test("baseOf reads the page's type", () => {
		assert.deepEqual(baseOf({ category: "Implement", type: "Holy symbol" }), { kind: "implement", groups: ["holyS"], any: null });
		assert.equal(baseOf({ category: "Neck", type: "" }), null);
	});
});

describe("the real database", () => {
	const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "out", "db", "magic");
	const skip = existsSync(path.join(dir, "_index.json")) ? false : "out/db/magic not built";

	test("every entry validates, and well-known items have the book's numbers", { skip }, async () => {
		const index = JSON.parse(await readFile(path.join(dir, "_index.json"), "utf8"));
		const entries = [];
		for (const f of (await readdir(dir)).filter(f => f !== "_index.json")) entries.push(...JSON.parse(await readFile(path.join(dir, f), "utf8")));
		assert.equal(validateMagic(entries, index).size, 0);
		assert.ok(entries.length > 3000);
		const find = n => entries.find(e => e.name === n);
		assert.deepEqual(find("Magic Holy Symbol").tiers.map(t => [t.level, t.enhancement]), [[1, 1], [6, 2], [11, 3], [16, 4], [21, 5], [26, 6]]);
		assert.equal(find("Burglar's Gloves").items[0].effects.length, 1);
	});
});
