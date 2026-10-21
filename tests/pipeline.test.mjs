/**
 * Pipeline tests: HTML -> parsed power -> Foundry item, on synthetic fixtures (tests/fixtures.mjs).
 * Each case states the behaviour we want, so a regression in the parser or the converter fails here with a clear name.
 * Run: npm test
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { parsePower } from "../parse-powers.mjs";
import { convertPower } from "../build-db.mjs";
import { CATEGORIES, FIXTURES } from "./fixtures.mjs";
import { CHARACTERS } from "./sim/characters.mjs";
import { simulate } from "./sim/sheet.mjs";

const parse = name => parsePower(FIXTURES[name]);
const convert = name => convertPower(parse(name), { categories: CATEGORIES });
const main = name => convert(name)[0];

describe("parser: header", () => {
	test("usage, action, keywords, source", () => {
		const p = parse("weaponBasic");
		assert.equal(p.usage, "atwill");
		assert.equal(p.action, "standard");
		assert.deepEqual(p.keywords, ["Martial", "Weapon"]);
		assert.equal(p.class, "Fighter");
		assert.equal(p.level, 1);
		assert.equal(p.tier, "heroic");
		assert.equal(p.published.book, "Test Book");
		assert.equal(p.quality, "full");
	});

	test("range shapes", () => {
		assert.deepEqual([parse("weaponBasic").range.type, parse("weaponBasic").range.weaponType], ["weapon", "melee"]);
		assert.deepEqual([parse("implementDice").range.type, parse("implementDice").range.size], ["range", 10]);
		assert.deepEqual([parse("closeBurst").range.type, parse("closeBurst").range.size], ["closeBurst", 2]);
		assert.deepEqual([parse("areaBurst").range.type, parse("areaBurst").range.size, parse("areaBurst").range.within], ["rangeBurst", 1, 10]);
		assert.equal(parse("scaling").range.type, "touch");
		assert.equal(parse("meleeRangedSame").range.weaponType, "meleeRanged");
	});
});

describe("parser: attack", () => {
	test("ability and defence", () => {
		const a = parse("weaponBasic").attack;
		assert.deepEqual([a.abilities, a.defences], [["str"], ["ac"]]);
	});

	test("melee/ranged attack keeps both sides", () => {
		const a = parse("meleeRangedSplit").attack;
		assert.deepEqual(a.alternatives.map(x => [x.when, x.abilities[0], x.defences[0]]), [["melee", "str", "ac"], ["ranged", "dex", "ac"]]);
		assert.equal(a.multipleDefences, false);
	});

	test("one roll against several defences", () => {
		const a = parse("hitVariants").attack;
		assert.deepEqual(a.defences, ["fort", "ref", "wil"]);
		assert.equal(a.multipleDefences, true);
	});

	test("a fixed attack bonus is read", () => assert.equal(parse("fixedBonus").attack.bonus, 2));

	test("typos in the source are corrected, and the original text is kept", () => {
		const a = parse("typo").attack;
		assert.deepEqual(a.defences, ["ref"]);
		assert.equal(a.corrected, true);
		assert.match(a.text, /Relfex/);
	});

	test("prose under Attack is not an attack roll", () => {
		const p = parse("attackProse");
		assert.equal(p.attack, null);
		assert.ok(p.extra.some(e => e.label === "Attack"));
	});
});

describe("parser: damage", () => {
	test("[W] with an ability modifier", () => {
		const d = parse("weaponBasic").hit.damage[0];
		assert.deepEqual([d.weapon, d.mods, d.dice, d.types], [2, ["str"], [], []]);
	});

	test("dice, another ability, damage type", () => {
		const d = parse("implementDice").hit.damage[0];
		assert.deepEqual([d.dice, d.mods, d.types], [[{ count: 3, faces: 6 }], ["wis"], ["fire"]]);
	});

	test("an ability named without 'modifier' still counts", () => assert.deepEqual(parse("bareAbility").hit.damage[0].mods, ["str"]));

	test("melee and ranged formulas are tagged", () => {
		const d = parse("meleeRangedSplit").hit.damage;
		assert.deepEqual(d.map(x => [x.when, x.mods[0], x.weapon]), [["melee", "str", 1], ["ranged", "dex", 1]]);
	});

	test("a ranged half that drops the dice shares the dice of the melee half", () => {
		const d = parse("sharedDiceSplit").hit.damage;
		assert.deepEqual(d.map(x => [x.when, x.weapon, x.mods[0]]), [["melee", 2, "str"], ["ranged", 2, "dex"]]);
		assert.equal(d[1].inferred, true);
	});

	test("an untyped damage takes its type from the power's damage-type keyword", () => {
		const d = parse("keywordType").hit.damage[0];
		assert.deepEqual([d.types, d.typesFromKeywords], [[], ["psychic"]]);
	});

	test("damage the user takes is marked as self damage", () => {
		const list = parse("selfDamage").effect.damage;
		assert.deepEqual(list.map(d => [d.expr, !!d.self]), [["5", true], ["2d8 + Wisdom modifier", false]]);
	});

	test("half damage on a miss", () => assert.equal(parse("closeBurst").miss.half, true));

	test("ongoing damage with save ends", () => {
		assert.deepEqual(parse("ongoing").hit.ongoing, [{ amount: 5, types: ["fire"], saveEnds: true }]);
	});

	test("resistance is an effect, not damage", () => {
		const p = parse("resistAll");
		assert.deepEqual(p.effect.resistances, [{ kind: "resist", amount: 5, types: ["all"] }]);
		assert.equal(p.effect.damage.length, 0);
		assert.equal(p.quality, "full", "no false 'damage not parsed' alert");
	});

	test("'Level N:' lines become scaling, not hit text", () => {
		const p = parse("scaling");
		assert.deepEqual(p.scaling.map(s => [s.levels, s.field]), [[[21], "hit"]]);
		assert.doesNotMatch(p.hit.text, /Level 21/);
	});
});

describe("parser: durations (Rules Compendium p. 226-228)", () => {
	const conditions = () => parse("durations").hit.conditions;
	const find = name => conditions().find(c => c.name === name);

	test("someone else's turn keeps whose turn it is", () => assert.deepEqual(find("dazed").duration, { type: "endOfTurn", owner: "target" }));
	test("save ends both is one group", () => {
		assert.deepEqual(find("slowed").duration, { type: "saveEnds", group: "both" });
		assert.deepEqual(find("weakened").duration, { type: "saveEnds", group: "both" });
	});
	test("until the start of your next turn", () => assert.deepEqual(find("marked").duration, { type: "startOfTurn", owner: "source" }));
	test("marked is an effect, not a condition", () => assert.equal(find("marked").kind, "effect"));
	test("dazed is a condition", () => assert.equal(find("dazed").kind, "condition"));
});

describe("parser: structure", () => {
	test("secondary attack stays inside the power", () => {
		const p = parse("secondary");
		assert.equal(p.target, "One creature");
		assert.equal(p.secondary.target, "Each creature adjacent to the primary target");
		assert.equal(p.secondary.attack.abilities[0], "int");
		assert.equal(p.hit.damage.length, 1, "the secondary damage is not the primary one");
	});

	test("a second heading is a child power", () => {
		const p = parse("childPower");
		assert.deepEqual(p.children.map(c => c.name), ["Test Stance Attack"]);
		assert.equal(p.children[0].attack.abilities[0], "str");
	});

	test("an unknown labelled block is kept as an extra, not an error", () => {
		const p = parse("unknownLabel");
		assert.ok(p.extra.some(e => e.label === "Mystic Pact"));
		assert.equal(p.quality, "full");
	});
});

describe("converter: damage formulas", () => {
	test("[W] power: base from the weapon, ability from the attack", () => {
		const s = main("weaponBasic").system;
		assert.deepEqual([s.hit.baseQuantity, s.hit.baseDiceType], ["2", "weapon"]);
		assert.equal(s.hit.formula, "@powBase + @powerMod + @wepDamage");
		assert.equal(s.hit.critFormula, "@powMax + @powerMod + @wepDamage + @wepCritBonus");
		assert.equal(s.hit.isDamage, true);
	});

	test("dice power: other ability is written out, implement bonus included", () => {
		const s = main("implementDice").system;
		assert.deepEqual([s.hit.baseQuantity, s.hit.baseDiceType], ["3", "d6"]);
		assert.equal(s.hit.formula, "@powBase + @abilities.wis.mod + @wepDamage");
		assert.equal(s.hit.critFormula, "@powMax + @abilities.wis.mod + @wepDamage + @wepCritBonus");
		assert.equal(s.weaponType, "implement");
		assert.equal(s.damageType.fire, true);
	});

	test("a power without weapon or implement has no enhancement terms", () => {
		const s = main("selfDamage").system;
		assert.equal(s.weaponType, "none");
		assert.doesNotMatch(s.hit.formula, /@wepDamage/);
	});

	test("[W] needs a weapon even when the header lacks the Weapon keyword", () => {
		const s = main("weaponWithoutKeyword").system;
		assert.equal(s.weaponType, "melee");
		assert.match(s.hit.formula, /@wepDamage/);
	});

	test("the damage the power deals is chosen, not the damage the user takes", () => {
		const i = main("selfDamage");
		assert.deepEqual([i.system.hit.baseQuantity, i.system.hit.baseDiceType], ["2", "d8"]);
		assert.ok(i.flags.dnd4e.import.review.includes("damage-from:effect"));
	});

	test("damage found only in a Hit (Defence) variant is still rolled", () => {
		const i = main("hitVariants");
		assert.equal(i.system.hit.isDamage, true);
		assert.deepEqual([i.system.hit.baseQuantity, i.system.hit.baseDiceType], ["2", "d6"]);
		assert.ok(i.flags.dnd4e.import.review.includes("attack-multiple-defences"));
	});

	test("keyword gives the damage type when the text has none", () => assert.equal(main("keywordType").system.damageType.psychic, true));

	test("fixed attack bonus goes into attack.formula (abilityBonus is not read by the system)", () => {
		const s = main("fixedBonus").system;
		assert.equal(s.attack.formula, "@wepAttack + @powerMod + @lvhalf + 2");
		assert.equal(s.attack.abilityBonus, undefined);
	});

	test("a weapon power also records the typo-corrected defence", () => assert.equal(main("typo").system.attack.def, "ref"));

	test("a power that never rolls damage has no hit formula", () => {
		const s = main("resistAll").system;
		assert.equal(s.hit.isDamage, false);
		assert.equal(s.hit.formula, undefined);
	});
});

describe("converter: range and targeting", () => {
	test("close burst: area, enemies, one shared damage roll, half damage on a miss", () => {
		const s = main("closeBurst").system;
		assert.deepEqual([s.rangeType, s.area, s.autoTarget.mode, s.hit.shareDamageRoll, s.miss.halfDamage], ["closeBurst", "2", "enemies", true, true]);
	});

	test("area burst: size and distance", () => {
		const s = main("areaBurst").system;
		assert.deepEqual([s.rangeType, s.area, s.rangePower, s.autoTarget.mode], ["rangeBurst", "1", "10", "all"]);
	});

	test("an origin the schema cannot hold is flagged, not dropped", () => {
		const i = main("areaOrigin");
		assert.equal(i.system.rangeType, "rangeBurst");
		assert.ok(i.flags.dnd4e.import.review.some(r => r.startsWith("range-origin")));
	});

	test("a weapon power does not share its damage roll", () => assert.equal(main("weaponBasic").system.hit.shareDamageRoll, false));
});

describe("converter: bundles", () => {
	test("different attack and damage -> a melee and a ranged item", () => {
		const items = convert("meleeRangedSplit");
		assert.deepEqual(items.map(i => i.name), ["Test Volley (Melee)", "Test Volley (Ranged)"]);
		assert.deepEqual(items.map(i => i.system.weaponType), ["melee", "ranged"]);
		assert.deepEqual(items.map(i => i.system.attack.ability), ["str", "dex"]);
		assert.deepEqual(items.map(i => i.flags.dnd4e.import.role), ["main", "variant"]);
		assert.equal(new Set(items.map(i => i.flags.dnd4e.import.bundle)).size, 1);
		assert.equal(items[0].flags.dnd4e.import.bundle, items[0]._id);
		assert.notEqual(items[0]._id, items[1]._id);
		for (const i of items) assert.equal(i.system.hit.formula, "@powBase + @powerMod + @wepDamage", "each version uses its own attack ability as the modifier");
	});

	test("shared dice: the ranged version keeps the weapon dice", () => {
		const items = convert("sharedDiceSplit");
		assert.deepEqual(items.map(i => [i.system.hit.baseQuantity, i.system.hit.baseDiceType]), [["2", "weapon"], ["2", "weapon"]]);
		assert.equal(items.some(i => i.flags.dnd4e.import.review.includes("damage-dice-inferred")), false);
	});

	test("same numbers for melee and ranged -> one item for either weapon", () => {
		const items = convert("meleeRangedSame");
		assert.equal(items.length, 1);
		assert.equal(items[0].system.weaponType, "meleeRanged");
		assert.equal(items[0].flags.dnd4e.import.variant, undefined);
	});

	test("a second heading becomes a child item in the same bundle", () => {
		const items = convert("childPower");
		assert.deepEqual(items.map(i => i.flags.dnd4e.import.role), ["main", "child"]);
		assert.equal(items[1].flags.dnd4e.import.bundle, items[0]._id);
		assert.equal(items[1].flags.dnd4e.import.section, 0);
		assert.equal(items[1].name, "Test Stance Attack");
		assert.equal(items[1].system.weaponType, "melee");
	});

	test("ids are stable: converting twice gives the same ids", () => {
		assert.deepEqual(convert("meleeRangedSplit").map(i => i._id), convert("meleeRangedSplit").map(i => i._id));
		assert.match(main("weaponBasic")._id, /^[A-Za-z0-9]{16}$/);
	});
});

describe("converter: classification and text", () => {
	test("class powers get powerType class and the class as source name", () => {
		const s = main("weaponBasic").system;
		assert.deepEqual([s.powerType, s.powersourceName, s.powersource, s.useType, s.actionType], ["class", "Fighter", "martial", "atwill", "standard"]);
	});

	test("things the schema cannot express are kept as text", () => {
		const parts = main("secondary").system.specialAdd.parts;
		assert.ok(parts.some(p => p.startsWith("Secondary Attack:")));
		assert.ok(parts.some(p => p.startsWith("Secondary Hit:")));
	});

	test("scaling is appended to the hit text", () => assert.match(main("scaling").system.hit.detail, /Level 21: 2d6/));
	test("ongoing damage is kept for the later effect pass", () => assert.equal(main("ongoing").flags.dnd4e.import.ongoing[0].amount, 5));
});

describe("highest ability modifier (all six / mental / physical)", () => {
	// The system already defines @maxMod (Actor#getRollData); the mental/physical sets use max() over its <ability>Mod variables.
	const MAX_ALL = "@maxMod";
	const MAX_MENTAL = "max(@intMod, @wisMod, @chaMod)";
	const MAX_PHYSICAL = "max(@strMod, @dexMod, @conMod)";
	const [novice, caster] = CHARACTERS; // novice: Str +5 is the top modifier. caster: Int +5 is the top modifier, physical best is Dex +2.

	test("the parser keeps the three sets apart", () => {
		assert.equal(parse("highestAll").attack.abilities[0], "highest");
		assert.equal(parse("highestMental").attack.abilities[0], "highest-mental");
		assert.equal(parse("highestPhysical").attack.abilities[0], "highest-physical");
		assert.deepEqual(parse("highestAll").hit.damage[0].mods, ["highest"]);
		assert.deepEqual(parse("highestMental").hit.damage[0].mods, ["highest-mental"]);
		assert.equal(parse("highestAll").quality, "full");
	});

	test("the converter writes @maxMod or max() over the right abilities, in the attack and in the damage", () => {
		const all = main("highestAll").system;
		assert.equal(all.attack.formula, `@wepAttack + ${MAX_ALL} + @lvhalf`);
		assert.equal(all.attack.ability, "");
		assert.equal(all.hit.formula, `@powBase + ${MAX_ALL} + @wepDamage`);
		assert.equal(main("highestMental").system.attack.formula, `@wepAttack + ${MAX_MENTAL} + @lvhalf`);
		assert.equal(main("highestMental").system.hit.formula, `@powBase + ${MAX_MENTAL} + @wepDamage`);
		assert.equal(main("highestPhysical").system.attack.formula, `@wepAttack + ${MAX_PHYSICAL} + @lvhalf + 2`);
	});

	// Numbers worked out by hand from the characters in tests/sim/characters.mjs
	test("highest of all six: Str +5 for the novice, Int +5 for the caster", () => {
		const item = main("highestAll");
		// novice: half level 0 + 5 + melee weapon (prof 3 + enh 1); caster: 5 + 5 + (prof 2 + enh 3)
		assert.equal(simulate(item, novice).attack.max, 9);
		assert.equal(simulate(item, caster).attack.max, 15);
		// novice 2d8 + 5 + 1 = 8..22; caster 2d4 + 5 + 3 = 10..16
		assert.deepEqual([simulate(item, novice).damage.min, simulate(item, novice).damage.max], [8, 22]);
		assert.deepEqual([simulate(item, caster).damage.min, simulate(item, caster).damage.max], [10, 16]);
	});

	test("highest mental: Wis +4 for the novice, Int +5 for the caster (never Str)", () => {
		const item = main("highestMental");
		// implement: novice 0 + 4 + (1 + 3) = 8; caster 5 + 5 + (2 + 4) = 16
		assert.equal(simulate(item, novice).attack.max, 8);
		assert.equal(simulate(item, caster).attack.max, 16);
	});

	test("highest physical: Str +5 for the novice, Dex +2 for the caster (never Int)", () => {
		const item = main("highestPhysical");
		// melee weapon, +2 fixed: novice 0 + 5 + (3 + 1) + 2 = 11; caster 5 + 2 + (2 + 3) + 2 = 14
		assert.equal(simulate(item, novice).attack.max, 11);
		assert.equal(simulate(item, caster).attack.max, 14);
	});
});

describe("primary ability (@primaryMod)", () => {
	const [novice, caster, veteran] = CHARACTERS; // primary abilities: novice Wis +4, caster Cha +3, veteran Dex +2

	test("the parser reads the attack and the bare 'ability modifier'", () => {
		const p = parse("primaryAttack");
		assert.equal(p.attack.abilities[0], "primary");
		assert.equal(p.attack.bonus, 6);
		assert.deepEqual(p.hit.damage[0].mods, ["ability"]);
		assert.deepEqual(parse("primaryNamed").hit.damage[0].mods, ["primary"]);
		assert.equal(p.quality, "full");
	});

	test("attack and damage both use @primaryMod, and nothing is left to review", () => {
		const i = main("primaryAttack");
		assert.equal(i.system.attack.formula, "@wepAttack + @primaryMod + @lvhalf + 6");
		assert.equal(i.system.attack.ability, "");
		assert.equal(i.system.hit.formula, "@powBase + @primaryMod + @wepDamage");
		assert.equal(i.system.hit.critFormula, "@powMax + @primaryMod + @wepDamage + @wepCritBonus");
		assert.equal(i.flags.dnd4e.import.review.length, 0);
		assert.equal(main("primaryNamed").system.hit.formula, "@powBase + @primaryMod + @wepDamage");
	});

	test("a bare 'ability modifier' next to an ordinary attack is not guessed", () => {
		const i = main("abilityAmbiguous");
		assert.ok(i.flags.dnd4e.import.review.includes("damage-mod:ability"));
		assert.doesNotMatch(i.system.hit.formula, /@primaryMod/);
	});

	// Worked by hand. Melee weapon: novice d8 prof 3 enh 1; caster d4 prof 2 enh 3; veteran d12 prof 3 enh 5.
	test("attack: half level + primary modifier + weapon + 6", () => {
		const item = main("primaryAttack");
		assert.equal(simulate(item, novice).attack.max, 14); // 0 + 4 + (3 + 1) + 6
		assert.equal(simulate(item, caster).attack.max, 19); // 5 + 3 + (2 + 3) + 6
		assert.equal(simulate(item, veteran).attack.max, 26); // 10 + 2 + (3 + 5) + 6
	});

	test("damage: 2[W] + primary modifier + enhancement", () => {
		const item = main("primaryAttack");
		const range = c => [simulate(item, c).damage.min, simulate(item, c).damage.max];
		assert.deepEqual(range(novice), [7, 21]); // 2d8 + 4 + 1
		assert.deepEqual(range(caster), [8, 14]); // 2d4 + 3 + 3
		assert.deepEqual(range(veteran), [9, 31]); // 2d12 + 2 + 5
	});

	test("a character with no primary ability set counts it as +0 (the sheet warns)", () => {
		const unset = { ...novice, primary: "" };
		assert.equal(simulate(main("primaryAttack"), unset).attack.max, 10); // 0 + 0 + (3 + 1) + 6
	});
});

describe("keywords shown on the card", () => {
	test("Weapon and Implement are not repeated as custom keywords: the system shows them from weaponType", () => {
		for (const name of ["weaponBasic", "implementDice", "meleeRangedSame", "closeBurst"]) {
			const s = main(name).system;
			assert.equal(s.keywordsCustom, "", `${name}: ${s.keywordsCustom}`);
			assert.notEqual(s.weaponType, "none", `${name}: the tool must still come from weaponType`);
		}
	});

	test("keywords the system has no field for are still kept", () => {
		// "Stance" has an effectType; an unknown one (Reaping, Rune, ...) must survive as a custom keyword
		const item = convertPower(parsePower({ ...FIXTURES.weaponBasic, html: FIXTURES.weaponBasic.html.replace("<b>Weapon</b>", "<b>Weapon</b>, <b>Reaping</b>") }), { categories: CATEGORIES })[0];
		assert.equal(item.system.keywordsCustom, "Reaping");
	});
});

describe("a power that lets the player choose the ability: one version per ability", () => {
	const [novice] = CHARACTERS; // Str +5, Wis +4; melee weapon d8 (proficiency 3, enhancement 1)
	const notes = item => item.flags.dnd4e.import.review;

	test("attack and damage choose the same set: one item per ability, each using its own", () => {
		const items = convert("choiceLinked");
		assert.deepEqual(items.map(i => i.name), ["Test Pick (Strength)", "Test Pick (Wisdom)"]);
		assert.deepEqual(items.map(i => i.flags.dnd4e.import.ability), ["str", "wis"]);
		assert.deepEqual(items.map(i => i.flags.dnd4e.import.role), ["main", "variant"]);
		assert.deepEqual(items.map(i => i.system.attack.ability), ["str", "wis"]);
		for (const i of items) assert.equal(i.system.hit.formula, "@powBase + @powerMod + @wepDamage", "the damage follows the version's attack ability");
		assert.equal(new Set(items.map(i => i._id)).size, 2);
		assert.equal(new Set(items.map(i => i.system.identifier)).size, 2);
		assert.equal(items[1].flags.dnd4e.import.bundle, items[0]._id);
	});

	test("the choice is no longer a warning: the versions are a note that says so", () => {
		for (const i of convert("choiceLinked")) {
			assert.ok(notes(i).includes("ability-versions:str|wis"), notes(i).join());
			assert.equal(notes(i).some(n => n.startsWith("attack-ability-choice") || n.startsWith("damage-ability-choice")), false);
		}
	});

	test("numbers: each version rolls with its own ability", () => {
		const [strength, wisdom] = convert("choiceLinked");
		assert.equal(simulate(strength, novice).attack.max, 9); // 0 + Str 5 + (3 + 1)
		assert.equal(simulate(wisdom, novice).attack.max, 8); // 0 + Wis 4 + (3 + 1)
		assert.deepEqual([simulate(strength, novice).damage.min, simulate(strength, novice).damage.max], [7, 14]); // 1d8 + 5 + 1
		assert.deepEqual([simulate(wisdom, novice).damage.min, simulate(wisdom, novice).damage.max], [6, 13]); // 1d8 + 4 + 1
	});

	test("only the attack chooses: three versions, the fixed damage modifier is the same in all", () => {
		const items = convert("choiceAttackOnly");
		assert.deepEqual(items.map(i => i.name), ["Test Mind Pick (Intelligence)", "Test Mind Pick (Wisdom)", "Test Mind Pick (Charisma)"]);
		assert.deepEqual(items.map(i => i.system.attack.ability), ["int", "wis", "cha"]);
		for (const i of items) assert.equal(i.system.hit.formula, "@powBase + @abilities.str.mod + @wepDamage");
	});

	test("only the damage chooses: the attack ability is fixed, the damage modifier is the chosen one", () => {
		const items = convert("choiceDamageOnly");
		assert.deepEqual(items.map(i => i.name), ["Test Damage Pick (Strength)", "Test Damage Pick (Dexterity)", "Test Damage Pick (Constitution)"]);
		assert.deepEqual(items.map(i => i.system.attack.ability), ["str", "str", "str"]);
		assert.deepEqual(items.map(i => i.system.hit.formula), [
			"@powBase + @powerMod + @wepDamage", "@powBase + @abilities.dex.mod + @wepDamage", "@powBase + @abilities.con.mod + @wepDamage",
		]);
	});

	test("melee/ranged and ability choice together: a version for each combination that exists", () => {
		const items = convert("choiceAndSplit");
		assert.deepEqual(items.map(i => i.name), ["Test Both (Melee, Strength)", "Test Both (Melee, Dexterity)", "Test Both (Ranged)"]);
		assert.deepEqual(items.map(i => i.system.weaponType), ["melee", "melee", "ranged"]);
		assert.deepEqual(items.map(i => i.flags.dnd4e.import.ability), ["str", "dex", undefined], "the ranged side offers no choice");
		assert.deepEqual(items.map(i => i.system.attack.ability), ["str", "dex", "dex"]);
		assert.equal(new Set(items.map(i => i._id)).size, 3);
	});

	test("a power without a choice is one item, as before", () => {
		for (const name of ["weaponBasic", "implementDice", "closeBurst"]) assert.equal(convert(name).length, 1, name);
		assert.equal(convert("meleeRangedSplit").length, 2, "melee/ranged alone is still two");
	});

	test("ids of the melee/ranged versions do not change", () => {
		// the main item keeps the id of the power; the ranged one keeps the "ranged" id, so republishing does not orphan imported items
		const [melee, ranged] = convert("meleeRangedSplit");
		assert.match(melee._id, /^[A-Za-z0-9]{16}$/);
		assert.deepEqual(convert("meleeRangedSplit").map(i => i._id), [melee._id, ranged._id]);
		assert.equal(ranged.flags.dnd4e.import.ability, undefined);
	});
});

describe("a transformation whose attack chooses the ability, and a list of abilities in the damage", () => {
	const [novice] = CHARACTERS; // Str +5, Con +3, Wis +4, level 1

	test("the form is one item; only its attack part has a version per ability", () => {
		const items = convert("formWithChoice");
		assert.deepEqual(items.map(i => i.name), ["Test Form", "Test Form Attack (Strength)", "Test Form Attack (Constitution)", "Test Form Attack (Wisdom)"]);
		assert.deepEqual(items.map(i => i.flags.dnd4e.import.role), ["main", "child", "child", "child"]);
		assert.deepEqual(items.map(i => i.flags.dnd4e.import.ability), [undefined, "str", "con", "wis"], "the form has no ability");
		assert.deepEqual(items.map(i => i.flags.dnd4e.import.section), [null, 0, 0, 0], "all three versions come from the same part");
		assert.equal(new Set(items.map(i => i._id)).size, 4);
		assert.equal(items.every(i => i.flags.dnd4e.import.bundle === items[0]._id), true);
	});

	test("the form keeps its benefits text and has no attack of its own", () => {
		const [form] = convert("formWithChoice");
		assert.equal(form.system.attack.isAttack, false);
		assert.match(form.system.effect.detail, /\+2 power bonus to AC/);
		assert.equal(form.flags.dnd4e.import.review.some(r => r.startsWith("ability-versions")), false, "the note belongs to the versions");
	});

	test("each attack version uses its own ability for the attack and for the damage", () => {
		const attacks = convert("formWithChoice").slice(1);
		assert.deepEqual(attacks.map(i => i.system.attack.ability), ["str", "con", "wis"]);
		for (const i of attacks) assert.equal(i.system.hit.formula, "@powBase + @powerMod", "no weapon or implement: no enhancement term");
		const power = (i, key) => [simulate(i, novice)[key].min, simulate(i, novice)[key].max];
		assert.equal(simulate(attacks[0], novice).attack.max, 5); // half level 0 + Str 5
		assert.equal(simulate(attacks[1], novice).attack.max, 3); // Con 3
		assert.equal(simulate(attacks[2], novice).attack.max, 4); // Wis 4
		assert.deepEqual(power(attacks[0], "damage"), [8, 35]); // 3d10 + 5
		assert.deepEqual(power(attacks[1], "damage"), [6, 33]); // 3d10 + 3
		assert.deepEqual(power(attacks[2], "damage"), [7, 34]); // 3d10 + 4
	});

	test("a list of abilities before 'modifier' is read whole", () => {
		const parsed = parse("damageCommaList");
		assert.deepEqual(parsed.hit.damage[0].mods, ["str|wis|cha"]);
		assert.equal(parsed.quality, "full");
	});

	test("a fixed attack with that damage list gets one version per ability, each with its own damage modifier", () => {
		const items = convert("damageCommaList");
		assert.deepEqual(items.map(i => i.name), ["Test List (Strength)", "Test List (Wisdom)", "Test List (Charisma)"]);
		assert.deepEqual(items.map(i => i.system.attack.ability), ["str", "str", "str"], "the attack ability does not change");
		assert.deepEqual(items.map(i => i.system.hit.formula), [
			"@powBase + @powerMod + @wepDamage", "@powBase + @abilities.wis.mod + @wepDamage", "@powBase + @abilities.cha.mod + @wepDamage",
		]);
	});
});
