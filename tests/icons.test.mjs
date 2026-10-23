/**
 * Icons: every power and feature gets one of Foundry's core icons, chosen by what it is, stable for a given name; actors and effects are left alone.
 * Run: npm test
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { ICON_CATALOG, decorate, featureKind, hash, iconForItem, pick, powerKind } from "../icons.mjs";

const power = (system = {}, name = "A Power") => ({ _id: "p1", name, type: "power", system: { damageType: {}, hit: {}, effect: {}, attack: {}, ...system } });
const feature = (system = {}, name = "A Feature") => ({ _id: "f1", name, type: "feature", system });

describe("the kind of a power", () => {
	test("the damage it deals comes first, in a fixed order", () => {
		assert.equal(powerKind(power({ damageType: { fire: true } })), "fire");
		assert.equal(powerKind(power({ damageType: { cold: true, radiant: true }, weaponType: "melee" })), "cold");
		assert.equal(powerKind(power({ damageType: { radiant: true } })), "radiant");
	});
	test("healing is told from the text, but an attack that mentions healing is not healing", () => {
		assert.equal(powerKind(power({ effect: { detail: "The target regains 10 hit points." } })), "healing");
		assert.equal(powerKind(power({ effect: { detail: "The target can spend a healing surge." } })), "healing");
		assert.equal(powerKind(power({ attack: { isAttack: true }, effect: { detail: "You regain hit points equal to the damage." }, weaponType: "melee" })), "melee");
	});
	test("without damage: the weapon, the power source, the way it is delivered", () => {
		assert.equal(powerKind(power({ weaponType: "ranged" })), "ranged");
		assert.equal(powerKind(power({ weaponType: "implement", powersource: "arcane" })), "arcane");
		assert.equal(powerKind(power({ powersource: "martial" })), "melee");
		assert.equal(powerKind(power({ rangeType: "closeBurst" })), "area");
		assert.equal(powerKind(power({ rangeType: "touch" })), "melee");
		assert.equal(powerKind(power({ rangeType: "personal" })), "generic");
	});
});

describe("the kind of a feature", () => {
	test("by its type, and the group of the 'other' ones", () => {
		assert.deepEqual(["feat", "path", "destiny", "background", "theme", "class", "race", "trait"].map(featureType => featureKind(feature({ featureType }))), ["feat", "path", "destiny", "background", "theme", "classFeature", "race", "generic"]);
		assert.deepEqual(["Deity", "Disease", "Familiar", "Campaign"].map(featureGroup => featureKind(feature({ featureType: "other", featureGroup }))), ["deity", "disease", "companion", "generic"]);
	});
});

describe("the icon", () => {
	test("is a core icon from the catalog, the same for the same name, varying with the name", () => {
		const names = Array.from({ length: 60 }, (_, i) => `Power ${i}`);
		const icons = names.map(name => iconForItem(power({ damageType: { fire: true } }, name)));
		assert.ok(icons.every(i => ICON_CATALOG.has(i) && i.startsWith("icons/magic/fire/")));
		assert.deepEqual(icons, names.map(name => iconForItem(power({ damageType: { fire: true } }, name))));
		assert.ok(new Set(icons).size > 10);
		assert.equal(pick(["a", "b", "c"], "x"), pick(["a", "b", "c"], "x"));
		assert.equal(hash("abc"), hash("abc"));
	});
	test("every kind has icons in the catalog", () => {
		for (const damageType of ["fire", "cold", "lightning", "thunder", "acid", "poison", "necrotic", "radiant", "psychic", "force"]) assert.ok(ICON_CATALOG.has(iconForItem(power({ damageType: { [damageType]: true } }))), damageType);
		for (const system of [{ powersource: "arcane" }, { powersource: "divine" }, { powersource: "primal" }, { powersource: "psionic" }, { powersource: "shadow" }, { powersource: "Elemental" }, { weaponType: "ranged" }, {}]) assert.ok(ICON_CATALOG.has(iconForItem(power(system))), JSON.stringify(system));
		for (const featureType of ["feat", "path", "destiny", "background", "theme", "class", "race", "trait", "other"]) assert.ok(ICON_CATALOG.has(iconForItem(feature({ featureType }))), featureType);
	});
	test("gear, rituals and anything else get none", () => {
		assert.equal(iconForItem({ _id: "x", name: "Sword", type: "weapon", system: {} }), null);
		assert.equal(iconForItem({ _id: "x", name: "Alarm", type: "ritual", system: {} }), null);
	});
});

describe("decorate", () => {
	test("sets img on powers and features wherever they are, and counts them", () => {
		const data = [power({}, "One"), { _id: "e", name: "Entry", items: [feature({ featureType: "feat" }, "Two")], powers: [power({}, "Three")] }];
		assert.equal(decorate(data), 3);
		assert.ok(data[0].img && data[1].items[0].img && data[1].powers[0].img);
	});
	test("leaves actors, what is inside them, and effects alone", () => {
		const effect = { _id: "fx", name: "Slowed", type: "base", img: "icons/svg/net.svg", system: { changes: [] } };
		const actor = { _id: "a", name: "Goblin", type: "NPC", system: {}, items: [power()] };
		const withEffect = { ...power(), effects: [effect] };
		assert.equal(decorate([actor, withEffect]), 1);
		assert.equal(actor.img, undefined);
		assert.equal(actor.items[0].img, undefined);
		assert.equal(effect.img, "icons/svg/net.svg");
	});
	test("again changes nothing", () => {
		const data = [power({ damageType: { acid: true } }, "Acid")];
		decorate(data);
		const first = data[0].img;
		decorate(data);
		assert.equal(data[0].img, first);
	});
});
