/**
 * Mundane equipment tests: HTML -> parsed entry -> Foundry items. The fixtures are invented (no book text).
 * The last block checks the real database when out/ exists.
 * Run: npm test
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listBlock, parseArmor, parseImplement, parsePrice, parseWeapon, parseWeaponHeader } from "../parse-gear.mjs";
import { buildGear, indexRow } from "../build-gear.mjs";
import { validateGear } from "../validate-gear.mjs";

const published = `<p class=publishedIn>Published in Test Book, page(s) 1.</p>`;
const entry = (name, html, listing = {}) => ({ id: `x${name.length}`, listing: { Name: name, Rarity: "Mundane", SourceBook: "TST", ...listing }, html });

const weaponPage = ({ name = "Zorb blade", head = "Military one-handed melee weapon", cost = "15 gp", dmg = "1d8", prof = "+3", range = "", props = "Versatile (<i>One hand or two.<br>Second line.</i>).<br>", group = "Heavy blade" } = {}) =>
	`<h1 class=player>${name}</h1><br>${head}<br>Cost: ${cost}<br><b>Damage</b>: ${dmg}<br>Proficient: ${prof}<br>${range}Weight: 4 lb.<br><br>A test blade.<br><br><b>Properties</b>: <br>${props}<br><b>Group</b>: <br>${group} (<i>Blades cut.</i>).<br>${published}`;

describe("parsing", () => {
	test("prices are gold pieces whatever the coin", () => {
		assert.equal(parsePrice("15 gp"), 15);
		assert.equal(parsePrice(".2 gp"), 0.2);
		assert.equal(parsePrice("5 cp"), 0.05);
		assert.equal(parsePrice("3 sp"), 0.3);
		assert.equal(parsePrice("1,250 gp"), 1250);
		assert.equal(parsePrice(""), null);
	});

	test("the header gives category, hands and melee/ranged, and tolerates the shorter forms", () => {
		assert.deepEqual(parseWeaponHeader("Superior double melee weapon"), { category: "superior", hands: "double", reach: "melee" });
		assert.deepEqual(parseWeaponHeader("Superior two-handed weapon"), { category: "superior", hands: "two", reach: null });
		assert.equal(parseWeaponHeader("Superior ").category, "superior");
		assert.equal(parseWeaponHeader("<b>Category</b>: Gear"), null);
	});

	test("a property's rules text with line breaks inside does not split the entry", () => {
		const list = listBlock(weaponPage(), "Properties");
		assert.deepEqual(list.map(p => p.name), ["Versatile"]);
		assert.match(list[0].text, /One hand or two\. Second line\./);
	});

	test("a weapon: damage, proficiency, group and the reach default", () => {
		const w = parseWeapon(entry("Zorb blade", weaponPage()));
		assert.deepEqual(w.damage, { dice: 1, faces: 8 });
		assert.equal(w.proficiency, 3);
		assert.equal(w.price, 15);
		assert.deepEqual(w.groups, ["Heavy blade"]);
		assert.equal(w.reach, "melee");
		assert.equal(w.description, "A test blade.");
	});

	test("a ranged weapon keeps its short and long range", () => {
		const w = parseWeapon(entry("Zorb bow", weaponPage({ head: "Military two-handed ranged weapon", range: "Range: 20/40<br>", props: "Load Free (<i>x</i>).<br>", group: "Bow" })));
		assert.deepEqual(w.range, [20, 40]);
		assert.equal(w.reach, "ranged");
	});

	test("ammunition is told apart by the quiver size in the page title", () => {
		const a = parseWeapon(entry("Zorb arrows", `<h1 class=player>Zorb arrows (30)</h1><br><b>Category</b>: Ammunition<br><b>Price</b>: 1 gp <br><b>Weight</b>: 3 lb<br><b>Description</b>: A quiver.${published}`));
		assert.equal(a.kind, "ammo");
		assert.equal(a.quantity, 30);
		assert.equal(a.price, 1);
	});

	test("armour: the bonus, the penalties, and cloth armour's missing bonus is 0", () => {
		const mail = parseArmor(entry("Zorb mail", `<h1 class=player>Zorb mail</h1><br><b>Description</b>: Heavy.<br><b>AC Bonus</b>: +6<br><b>Check</b>: -1<br><b>Speed</b>: -1<br><b>Weight</b>: 40 lb.<br><b>Cost</b>: 40 gp.<br><b>Special</b>: Tough<br><b>Type</b>: Chainmail<br>${published}`, { Type: "Chainmail" }));
		assert.deepEqual([mail.bonus, mail.check, mail.speed, mail.price, mail.special], [6, -1, -1, 40, "Tough"]);
		const cloth = parseArmor(entry("Zorb robe", `<h1 class=player>Zorb robe</h1><br><b>Description</b>: Soft.<br><b>Weight</b>: 4 lb.<br><b>Cost</b>: 1 gp.<br><b>Type</b>: Cloth<br>${published}`, { Type: "Cloth" }));
		assert.equal(cloth.bonus, 0);
	});

	test("a superior implement keeps the rules text of properties the system has no switch for", () => {
		const imp = parseImplement(entry("Zorb orb", `<h1 class=player>Zorb orb</h1><br>Superior <br>Cost: 30 gp<br><br><b>Properties</b>: <br>Accurate (<i>+1 to implement attacks.</i>).<br><br><b>Group</b>: <br>Orb (<i>Round.</i>).<br>${published}`, { Type: "Orb" }));
		assert.equal(imp.superior, true);
		assert.equal(imp.properties[0].text, "+1 to implement attacks.");
		assert.deepEqual(imp.groups, ["Orb"]);
	});
});

describe("building", () => {
	const build = (...parsed) => buildGear(parsed);
	const w = (name, extra = {}) => parseWeapon(entry(name, weaponPage({ name, ...extra })));

	test("a weapon becomes a weapon item the sheet can use", () => {
		const [e] = build(w("Longsword"));
		const s = e.items[0].system;
		assert.equal(e.items[0].type, "weapon");
		assert.equal(s.weaponType, "militaryM");
		assert.equal(s.weaponBaseType, "longsword");
		assert.equal(s.weaponHand, "hMain");
		assert.deepEqual(s.properties, { ver: true });
		assert.deepEqual(s.weaponGroup, { bladeH: true });
		assert.deepEqual(s.damageDice.parts, [{ numDice: "1", numFaces: "8", modifier: "" }]);
		assert.equal(s.profBonus, 3);
		assert.equal(s.price, 15);
	});

	test("a weapon the system has no base type for says so instead of guessing", () => {
		const [e] = build(w("Zorb blade"));
		assert.equal(e.items[0].system.weaponBaseType, "");
		assert.ok(e.notes.includes("base-type-unknown"));
	});

	test("brutal weapons keep their number; the compendium's own names for a key are understood", () => {
		const [e] = build(w("Gythka", { head: "Superior two-handed melee weapon", props: "Brutal 2 (<i>Rerolls.</i>).<br>" }));
		assert.equal(e.items[0].system.brutalNum, 2);
		assert.equal(e.items[0].system.weaponBaseType, "gythka");
		assert.equal(e.items[0].system.weaponHand, "hTwo");
	});

	test("a double weapon is one entry with its secondary end as a second item of the bundle", () => {
		const all = build(w("Zorb axe", { head: "Superior double melee weapon" }), w("Zorb axe - secondary end", { head: "Superior double melee weapon", cost: "" }));
		assert.equal(all.length, 1);
		assert.equal(all[0].items.length, 2);
		assert.equal(all[0].items[1].flags.dnd4e.import.role, "child");
		assert.equal(all[0].items[1].system.price, 0);
		assert.ok(all[0].notes.includes("double-weapon"));
		assert.ok(all[0].items.every(i => i.flags.dnd4e.import.bundle === all[0]._id));
	});

	test("armour: the bonus goes on AC, the penalties are negative and switched on", () => {
		const a = parseArmor(entry("Zorb mail", `<h1 class=player>Zorb mail</h1><br><b>Description</b>: Heavy.<br><b>AC Bonus</b>: +6<br><b>Check</b>: -1<br><b>Speed</b>: -1<br><b>Weight</b>: 40 lb.<br><b>Cost</b>: 40 gp.<br><b>Type</b>: Chainmail<br>${published}`, { Type: "Chainmail" }));
		const s = build(a)[0].items[0].system;
		assert.deepEqual([s.armour.type, s.armour.subtype, s.armourBaseType, s.armour.ac], ["armour", "heavy", "chain", 6]);
		assert.deepEqual([s.armour.movePen, s.armour.movePenValue, s.armour.skillCheck, s.armour.skillCheckValue], [true, -1, true, -1]);
	});

	test("a shield gives its bonus to AC and to Reflex, as the rules say", () => {
		const a = parseArmor(entry("Zorb shield", `<h1 class=player>Zorb shield</h1><br><b>Description</b>: Round.<br><b>Shield Bonus</b>: +2<br><b>Check</b>: -2<br><b>Weight</b>: 15 lb.<br><b>Cost</b>: 10 gp.<br><b>Type</b>: Heavy Shields<br>${published}`, { Type: "Heavy Shield" }));
		const s = build(a)[0].items[0].system;
		assert.deepEqual([s.armour.type, s.armour.subtype, s.shieldBaseType, s.armour.ac, s.armour.ref], ["arms", "heavy", "heavy", 2, 2]);
	});

	test("the index row carries the numbers the list shows, so the list needs no data file", () => {
		const [e] = build(w("Longsword"));
		assert.deepEqual(indexRow(e).summary, { damage: "1d8", proficiency: 3, range: null, hand: "hMain", group: "bladeH" });
		const mail = parseArmor(entry("Zorb mail", `<h1 class=player>Zorb mail</h1><br><b>AC Bonus</b>: +6<br><b>Check</b>: -1<br><b>Weight</b>: 40 lb.<br><b>Cost</b>: 40 gp.<br><b>Type</b>: Chainmail<br>${published}`, { Type: "Chainmail" }));
		assert.deepEqual(indexRow(build(mail)[0]).summary, { bonus: 6, check: -1, speed: null });
	});

	test("ammunition is a consumable of type ammo with the pack's quantity", () => {
		const a = parseWeapon(entry("Zorb arrows", `<h1 class=player>Zorb arrows (30)</h1><br><b>Category</b>: Ammunition<br><b>Price</b>: 1 gp <br><b>Weight</b>: 3 lb<br><b>Description</b>: A quiver.${published}`));
		const item = build(a)[0].items[0];
		assert.equal(item.type, "consumable");
		assert.equal(item.system.consumableType, "ammo");
		assert.equal(item.system.quantity, 30);
	});

	test("an implement is a weapon item of type implement with its group as base type", () => {
		const imp = parseImplement(entry("Zorb orb", `<h1 class=player>Zorb orb</h1><br>Superior <br>Cost: 30 gp<br><br><b>Properties</b>: <br>Accurate (<i>+1 to implement attacks.</i>).<br><br><b>Group</b>: <br>Orb (<i>Round.</i>).<br>${published}`, { Type: "Orb" }));
		const [e] = build(imp);
		assert.equal(e.items[0].system.weaponType, "implement");
		assert.equal(e.items[0].system.weaponBaseType, "orb");
		assert.deepEqual(e.items[0].system.implement, { orb: true });
		assert.match(e.items[0].system.description.value, /Accurate\.<\/strong> \+1 to implement attacks/);
	});

	test("ids are deterministic and what is built passes the validator", () => {
		const parsed = [w("Longsword"), w("Zorb blade")];
		const a = buildGear(parsed), b = buildGear(parsed);
		assert.deepEqual(a.map(e => e._id), b.map(e => e._id));
		assert.equal(validateGear(a, a.map(indexRow)).size, 0);
	});

	test("the validator rejects a weapon type or property the system does not have", () => {
		const [e] = buildGear([w("Longsword")]);
		e.items[0].system.weaponType = "nonsense";
		e.items[0].system.properties.zzz = true;
		const errors = [...validateGear([e], [indexRow(e)]).keys()].join("\n");
		assert.match(errors, /weaponType/);
		assert.match(errors, /property/);
	});
});

describe("the real database", () => {
	const dbDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "out", "db", "gear");
	const skip = existsSync(path.join(dbDir, "gear.json")) ? false : "out/db/gear not built";

	test("every entry validates and the well-known weapons have the book's numbers", { skip }, async () => {
		const entries = JSON.parse(await readFile(path.join(dbDir, "gear.json"), "utf8"));
		const index = JSON.parse(await readFile(path.join(dbDir, "_index.json"), "utf8"));
		assert.equal(validateGear(entries, index).size, 0);
		const get = n => entries.find(e => e.name === n)?.items[0].system;
		assert.deepEqual([get("Longsword").damageDice.parts[0].numFaces, get("Longsword").profBonus, get("Longsword").price], ["8", 3, 15]);
		assert.equal(get("Longbow").range.long, 40);
		assert.equal(get("Plate Armor").armour.ac, 8);
		assert.equal(get("Heavy Shield").armour.ac, 2);
		assert.equal(get("Heavy Shield").armour.ref, 2);
	});
});
