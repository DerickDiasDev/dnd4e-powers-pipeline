/**
 * Icons: every power and feature gets one of Foundry's core icons, chosen by what it is, stable for a given name; actors and effects are left alone.
 * Run: npm test
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { ICON_CATALOG, consumableKind, decorate, equipmentKind, featureKind, hash, iconForItem, lootKind, pick, powerKind, weaponKind } from "../icons.mjs";

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
	test("an item that is not covered gets none", () => {
		assert.equal(iconForItem({ _id: "x", name: "Thing", type: "tool", system: {} }), null);
	});
});

const weapon = (system, name = "Blade") => ({ _id: "w", name, type: "weapon", system });
const worn = (armour, extra = {}, name = "Thing") => ({ _id: "e", name, type: "equipment", system: { armour, ...extra } });

describe("weapons and implements", () => {
	test("by group first, then by a word of the base type, the name or the kind a magic item names", () => {
		assert.equal(weaponKind(weapon({ weaponType: "militaryM", weaponBaseType: "longsword", weaponGroup: { bladeH: true } })), "swords");
		assert.equal(weaponKind(weapon({ weaponType: "simpleM", weaponBaseType: "dagger", weaponGroup: { bladeL: true } })), "bladeL");
		assert.equal(weaponKind(weapon({ weaponType: "militaryR", weaponBaseType: "longbow", weaponGroup: { bow: true } })), "bows");
		assert.equal(weaponKind(weapon({ weaponType: "simpleR", weaponGroup: { cbow: true } })), "crossbows");
		assert.equal(weaponKind(weapon({ weaponType: "militaryM", weaponBaseType: "greataxe" }, "Axe of the Dwarvish Lords"), { type: "Greataxe" }), "axes");
		assert.equal(weaponKind(weapon({}, "Frost Brand"), { type: "Light blade" }), "bladeL");
		assert.equal(weaponKind(weapon({ weaponType: "militaryM" }, "Mystery")), "swords");
		assert.equal(weaponKind(weapon({ weaponType: "militaryR" }, "Mystery")), "bows");
	});
	test("an implement by its kind", () => {
		for (const [weaponBaseType, kind] of [["holyS", "holySymbols"], ["staff", "staves"], ["rod", "rods"], ["wand", "wands"], ["orb", "orbs"], ["totem", "staves"], ["ki", "fists"], ["tome", "tomes"]]) assert.equal(weaponKind(weapon({ weaponType: "implement", weaponBaseType })), kind, weaponBaseType);
	});
});

describe("armour, worn items, consumables and loot", () => {
	test("armour by its kind, shields apart from bracers, worn items by their slot", () => {
		assert.equal(equipmentKind(worn({ type: "armour", subtype: "heavy" }, { armourBaseType: "plate" })), "plateArmor");
		assert.equal(equipmentKind(worn({ type: "armour", subtype: "light" }, { armourBaseType: "hide" })), "leatherArmor");
		assert.equal(equipmentKind(worn({ type: "armour", subtype: "light" }, { armourBaseType: "cloth" })), "clothArmor");
		assert.equal(equipmentKind(worn({ type: "arms", subtype: "heavy" }, { shieldBaseType: "heavy" })), "shields");
		assert.equal(equipmentKind(worn({ type: "arms", subtype: "" })), "wrists");
		assert.deepEqual(["head", "neck", "ring", "feet", "hands", "waist", "alternative", "other"].map(type => equipmentKind(worn({ type }))), ["head", "neck", "ring", "feet", "hands", "waist", "boon", "cloaks"]);
	});
	test("consumables: ammunition, poison, scrolls, food, potions", () => {
		const c = (consumableType, name = "Thing") => ({ name, system: { consumableType } });
		assert.deepEqual([c("ammo"), c("poison"), c("other", "Scroll of Fire"), c("other", "Travel Ration"), c("alchemical", "Acid")].map(consumableKind), ["ammo", "poisons", "scrolls", "food", "potions"]);
	});
	test("loot: gear, mounts, instruments, banners, tattoos, lair and wondrous items", () => {
		assert.equal(lootKind({ name: "Crowbar" }, { kind: "item", category: "gear" }), "gear");
		assert.equal(lootKind({ name: "Rope" }, { kind: "item", category: "gear" }), "rope");
		assert.equal(lootKind({ name: "Warhorse" }, { kind: "mount" }), "mounts");
		assert.equal(lootKind({ name: "Lute" }, { kind: "item" }), "instruments");
		assert.equal(lootKind({ name: "Battle Standard" }, { category: "Wondrous" }), "banners");
		assert.equal(lootKind({ name: "Tattoo of Might" }, { category: "Wondrous" }), "tattoos");
		assert.equal(lootKind({ name: "Hoard" }, { category: "Lair" }), "treasure");
		assert.equal(lootKind({ name: "Bag of Tricks" }, { category: "Wondrous" }), "wondrous");
	});
	test("rituals get a scroll or a book", () => {
		const icon = iconForItem({ _id: "r", name: "Alarm", type: "ritual", system: {} });
		assert.ok(ICON_CATALOG.has(icon) && /sundries\/(scrolls|books)\//.test(icon));
	});
	test("every kind of equipment has icons in the catalog", () => {
		for (const item of [weapon({ weaponType: "implement", weaponBaseType: "holyS" }), worn({ type: "head" }), worn({ type: "arms", subtype: "light" }), { _id: "c", name: "Elixir", type: "consumable", system: { consumableType: "other" } }, { _id: "l", name: "Rope", type: "loot", system: {} }]) assert.ok(ICON_CATALOG.has(iconForItem(item)), item.type);
	});
});

describe("decorate", () => {
	test("sets img on powers and features wherever they are, and counts them", () => {
		const data = [power({}, "One"), { _id: "e", name: "Entry", items: [feature({ featureType: "feat" }, "Two")], powers: [power({}, "Three")] }];
		assert.equal(decorate(data), 3);
		assert.ok(data[0].img && data[1].items[0].img && data[1].powers[0].img);
	});
	test("leaves the actors and the effects alone, and gives the items inside an actor theirs", () => {
		const effect = { _id: "fx", name: "Slowed", type: "base", img: "icons/svg/net.svg", system: { changes: [] } };
		const actor = { _id: "a", name: "Goblin", type: "NPC", system: {}, items: [power()] };
		const withEffect = { ...power(), effects: [effect] };
		assert.equal(decorate([actor, withEffect]), 2);
		assert.equal(actor.img, undefined);
		assert.ok(ICON_CATALOG.has(actor.items[0].img));
		assert.equal(effect.img, "icons/svg/net.svg");
	});
	test("an entry's category and kind reach its items", () => {
		const entry = { _id: "g", name: "Warhorse", kind: "mount", category: "mount", items: [{ _id: "i", name: "Warhorse", type: "loot", system: {} }] };
		decorate([entry]);
		assert.ok(entry.items[0].img.startsWith("icons/creatures/mammals/"));
	});
	test("again changes nothing", () => {
		const data = [power({ damageType: { acid: true } }, "Acid")];
		decorate(data);
		const first = data[0].img;
		decorate(data);
		assert.equal(data[0].img, first);
	});
});

describe("traits", () => {
	test("by a word of the name", async () => {
		const { traitKind } = await import("../icons.mjs");
		assert.deepEqual(["Regeneration", "Frost Aura", "Darkvision", "Fire Shroud", "Ambusher"].map(traitKind), ["healing", "cold", "psychic", "fire", "generic"]);
		assert.ok(ICON_CATALOG.has(iconForItem(feature({ featureType: "trait" }, "Regeneration"))));
	});
});

describe("what does not belong in a fantasy game", () => {
	test("no icon of a gun, a rocket, a bomb, tech or a damaged weapon is ever chosen", async () => {
		const bad = /(^|[-/])(gun|guns|rifle|pistol|musket|rocket|laser|tech|grenade|bomb|cannon|drill|bullet|bullets|shells|damaged|broken)([-.]|$)/;
		for (const [name, system] of [["Shortbow", { weaponType: "ranged" }], ["Ranged Thing", { weaponType: "ranged" }], ["Slash", { weaponType: "melee" }], ["Strike", {}]]) {
			for (let i = 0; i < 40; i++) assert.ok(!bad.test(iconForItem(power(system, `${name} ${i}`))), `${name} ${i}`);
		}
		for (let i = 0; i < 40; i++) assert.ok(!bad.test(iconForItem({ _id: "c", name: `Arrows ${i}`, type: "consumable", system: { consumableType: "ammo" } })));
	});
	test("a ranged power is an arrow, a bow or a thrown blade, and a melee one is never a shield", () => {
		for (let i = 0; i < 60; i++) {
			assert.match(iconForItem(power({ weaponType: "ranged" }, `Volley ${i}`)), /arrow|bow|archery|dagger|dart|target-bullseye|shuriken|projectile-(spiral|strike)/);
			assert.doesNotMatch(iconForItem(power({ weaponType: "melee" }, `Slash ${i}`)), /shield-/);
		}
	});
});

describe("powers named for a weapon or a natural attack", () => {
	test("a weapon's name takes the weapon's art, a magic one ('... of ...') does not", async () => {
		const { weaponNamed, naturalWeapon } = await import("../icons.mjs");
		assert.deepEqual(["Shortbow", "Javelin", "Longsword", "Spear Charge", "Dagger Throw", "Sling"].map(weaponNamed), ["bows", "slings", "swords", "polearms", "bladeL", "slings"]);
		assert.equal(weaponNamed("Dagger of Flame"), null);
		assert.equal(weaponNamed("Burning Hands"), null);
		assert.match(iconForItem(power({ damageType: { fire: true } }, "Shortbow")), /^icons\/weapons\/bows\//);
		assert.match(iconForItem(power({ damageType: { fire: true } }, "Dagger of Flame")), /^icons\/magic\/fire\//);
		assert.deepEqual(["Claw", "Claw Flurry", "Bite", "Slam", "Tail Slap", "Gore"].map(naturalWeapon), ["claws", "claws", "bites", "slams", "slams", "bites"]);
		assert.match(iconForItem(power({}, "Claw")), /^icons\/creatures\/claws\//);
	});
});

describe("breath weapons", () => {
	test("fire and cold have Foundry's dragon breaths, the other elements their own art, none the plain breath", async () => {
		const { breathKind } = await import("../icons.mjs");
		assert.deepEqual([{ fire: true }, { cold: true }, { acid: true }, { lightning: true }, {}].map(damageType => breathKind({ damageType })), ["breathFire", "breathCold", "acid", "lightning", "breath"]);
		assert.match(iconForItem(power({ damageType: { fire: true } }, "Breath Weapon")), /dragon-fire-breath/);
		assert.match(iconForItem(power({ damageType: { cold: true } }, "Breath Weapon")), /dragon-ice-breath/);
		assert.match(iconForItem(power({ damageType: { acid: true } }, "Breath Weapon")), /^icons\/magic\/acid\//);
		assert.match(iconForItem(power({}, "Breath of the Grave")), /dragon-breath/);
		assert.doesNotMatch(iconForItem(power({}, "Breathe Mosquitoes")), /dragon-breath/);
	});
});

describe("adventuring gear with an icon of its own", () => {
	test("rations are a ration, a waterskin a waterskin; a bedroll, a pack, a pouch, a fire lighter, a sunrod and rope have theirs", () => {
		const loot = name => iconForItem({ _id: "l", name, type: "loot", system: {} });
		assert.equal(loot("Trail Rations"), "icons/consumables/grains/breadsticks-crackers-wrapped-ration-brown.webp");
		assert.equal(loot("Waterskin"), "icons/sundries/survival/waterskin-leather-brown.webp");
		assert.match(loot("Bedroll"), /^icons\/sundries\/survival\/bedroll-/);
		assert.match(loot("Backpack (empty)"), /^icons\/containers\/bags\/pack-leather/);
		assert.match(loot("Belt Pouch (empty)"), /^icons\/containers\/bags\/pouch-leather/);
		assert.match(loot("Flint and Steel"), /^icons\/sundries\/survival\/fire-lighter/);
		assert.match(loot("Sunrod"), /^icons\/magic\/light\/torch-fire/);
		assert.match(loot("Hempen Rope (50 ft.)"), /^icons\/sundries\/survival\/rope-/);
		assert.doesNotMatch(loot("Operation Iterations"), /ration/, "a whole word");
	});
});
