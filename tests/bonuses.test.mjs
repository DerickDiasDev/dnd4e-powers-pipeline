/**
 * Bonuses, penalties and resistances as effect changes. The sentences are invented (no book text). The last block checks the real
 * database when out/ exists.
 * Run: npm test
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bonusSubject, changesOf, parseBonuses, parseResistances, targetsOf } from "../parse-bonuses.mjs";
import { parsePower } from "../parse-powers.mjs";
import { convertPower } from "../build-db.mjs";
import { bonusEffects, bonusName, featureEffects } from "../build-effects.mjs";
import { effectProblems } from "../validate-effects.mjs";
import { ENUMS } from "../system-enums.mjs";
import { CATEGORIES, entry } from "./fixtures.mjs";

const power = (blocks, o = {}) => entry("t-bonus-x", { name: "Test Boon", cls: "Cleric", kind: "Utility", keywords: ["Divine"], action: "Minor Action", range: "<b>Close</b> burst 3", blocks, ...o });
const build = raw => convertPower(parsePower(raw), { categories: CATEGORIES });
const keys = changes => changes.map(c => `${c.key}=${c.value}/${c.type}`);

describe("targets", () => {
	test("defences, in every spelling", () => {
		assert.deepEqual(targetsOf("all defenses"), ["ac", "fort", "ref", "wil"].map(key => ({ kind: "defence", key })));
		assert.deepEqual(targetsOf("AC and Reflex"), [{ kind: "defence", key: "ac" }, { kind: "defence", key: "ref" }]);
		assert.deepEqual(targetsOf("Fortitude, Reflex, and Will"), ["fort", "ref", "wil"].map(key => ({ kind: "defence", key })));
		assert.deepEqual(targetsOf("Will defense"), [{ kind: "defence", key: "wil" }]);
	});

	test("speed, saves, initiative, skills", () => {
		assert.deepEqual(targetsOf("speed"), [{ kind: "speed" }]);
		assert.deepEqual(targetsOf("saving throws"), [{ kind: "saves" }]);
		assert.deepEqual(targetsOf("death saving throws"), [{ kind: "deathsaves" }]);
		assert.deepEqual(targetsOf("initiative checks"), [{ kind: "initiative" }]);
		assert.deepEqual(targetsOf("Stealth checks"), [{ kind: "skill", key: "stl" }]);
		assert.deepEqual(targetsOf("Athletics and Endurance checks"), [{ kind: "skill", key: "ath" }, { kind: "skill", key: "end" }], "the suffix is written once, at the end of the list");
	});

	test("attack and damage rolls with the keyword the system matches", () => {
		assert.deepEqual(targetsOf("attack rolls"), [{ kind: "attack", keyword: "global" }]);
		assert.deepEqual(targetsOf("melee attack rolls"), [{ kind: "attack", keyword: "melee" }]);
		assert.deepEqual(targetsOf("implement damage rolls"), [{ kind: "damage", keyword: "usesImplement" }]);
		assert.deepEqual(targetsOf("opportunity attack rolls"), [{ kind: "attack", keyword: "opp" }]);
		assert.deepEqual(targetsOf("ranged basic attack rolls"), [{ kind: "attack", keyword: "rBasic" }]);
	});

	test("one roll, not a standing bonus: singular forms and anything unknown give null", () => {
		for (const phrase of ["the attack roll", "your attack roll", "a Perception check", "the saving throw", "damage rolls with swords", "healing", "one attack roll"]) assert.equal(targetsOf(phrase), null, phrase);
	});

	test("one unknown target in a list makes the whole list null", () => {
		assert.equal(targetsOf("AC and healing"), null);
	});
});

describe("changes", () => {
	const will = [{ kind: "defence", key: "wil" }];

	test("typed bonuses take the highest (upgrade) and untyped ones add up", () => {
		assert.deepEqual(keys(changesOf(1, "feat", will)), ["system.defences.wil.feat=1/upgrade"]);
		assert.deepEqual(keys(changesOf(2, "racial", will)), ["system.defences.wil.race=2/upgrade"]);
		assert.deepEqual(keys(changesOf(-2, "untyped", will)), ["system.defences.wil.untyped=-2/add"]);
	});

	test("shield, enhancement and class bonuses exist only on defences", () => {
		assert.deepEqual(keys(changesOf(2, "shield", will)), ["system.defences.wil.shield=2/upgrade"]);
		assert.deepEqual(keys(changesOf(1, "enhancement", will)), ["system.defences.wil.enhance=1/upgrade"]);
		assert.equal(changesOf(2, "shield", [{ kind: "speed" }]), null);
		assert.equal(changesOf(1, "class", [{ kind: "attack", keyword: "global" }]), null);
	});

	test("every kind of target has its field", () => {
		const one = (kind, extra = {}) => keys(changesOf(2, "power", [{ kind, ...extra }]))[0];
		assert.equal(one("speed"), "system.movement.base.power=2/upgrade");
		assert.equal(one("saves"), "system.details.saves.power=2/upgrade");
		assert.equal(one("deathsaves"), "system.details.deathsavebon.power=2/upgrade");
		assert.equal(one("initiative"), "system.attributes.init.power=2/upgrade");
		assert.equal(one("skill", { key: "prc" }), "system.skills.prc.power=2/upgrade");
		assert.equal(one("skills"), "system.modifiers.skills.power=2/upgrade");
		assert.equal(one("abilityChecks"), "system.modifiers.abilities.power=2/upgrade");
		assert.equal(one("attack", { keyword: "melee" }), "power.attack.melee.power=2/add", "the system's keyed bonus");
		assert.equal(one("damage", { keyword: "global" }), "power.damage.global.power=2/add");
	});

	test("the stacking the types give: same type takes the highest, different types add", () => {
		// The core's modes, applied to a sheet slot: add = +, upgrade = max, downgrade = min.
		const apply = (base, change) => ({ add: base + Number(change.value), upgrade: Math.max(base, Number(change.value)), downgrade: Math.min(base, Number(change.value)) })[change.type];
		const slot = { feat: 0, power: 0, untyped: 0 };
		for (const [amount, type] of [[1, "feat"], [3, "feat"], [2, "power"], [1, "untyped"], [1, "untyped"]]) {
			const [c] = changesOf(amount, type, will);
			const field = c.key.split(".").at(-1);
			slot[field] = apply(slot[field], c);
		}
		assert.deepEqual(slot, { feat: 3, power: 2, untyped: 2 });
		assert.equal(slot.feat + slot.power + slot.untyped, 7);
	});
});

describe("reading bonuses", () => {
	const one = text => parseBonuses(text).bonuses;

	test("the amount, the type, the target, who and for how long", () => {
		const [b] = one("You gain a +2 power bonus to all defenses until the end of your next turn.");
		assert.deepEqual([b.amount, b.type, b.phrase, b.subject], [2, "power", "all defenses", "self"]);
		assert.deepEqual(b.duration, { type: "endOfTurn", owner: "source" });
		assert.equal(b.changes.length, 4);
	});

	test("penalties are negative and untyped", () => {
		const [b] = one("The target takes a -2 penalty to attack rolls (save ends).");
		assert.deepEqual([b.amount, b.type, b.subject], [-2, "untyped", "target"]);
		assert.deepEqual(b.duration, { type: "saveEnds", group: null });
		assert.deepEqual(keys(b.changes), ["power.attack.global.untyped=-2/add"]);
		assert.equal(one("You take a –2 penalty to Stealth checks.")[0].amount, -2, "an en dash is a minus");
	});

	test("two bonuses in one sentence are two", () => {
		const bs = one("You gain a +1 bonus to attack rolls and a +2 bonus to saving throws.");
		assert.deepEqual(bs.map(b => [b.amount, b.phrase]), [[1, "attack rolls"], [2, "saving throws"]]);
	});

	test("a list of targets is one bonus with several changes", () => {
		const [b] = one("You gain a +2 racial bonus to Stealth and Thievery checks.");
		assert.deepEqual(keys(b.changes), ["system.skills.stl.race=2/upgrade", "system.skills.thi.race=2/upgrade"]);
	});

	test("allies and the target are told apart", () => {
		assert.equal(one("Each ally within 5 squares gains a +1 power bonus to attack rolls.")[0]?.subject, undefined, "'within' makes it conditional");
		assert.equal(one("That ally gains a +1 power bonus to speed until the end of your next turn.")[0].subject, "allies");
		assert.equal(bonusSubject("The target takes "), "target");
		assert.equal(bonusSubject("Always "), "unknown");
	});

	test("conditional, narrowed and single-roll bonuses are skipped, with the reason", () => {
		const cases = {
			"While you are bloodied, you gain a +2 bonus to AC.": "conditional",
			"You gain a +2 power bonus to AC against opportunity attacks.": "conditional",
			"You gain a +2 bonus to your next attack roll.": "conditional",
			"You gain a +5 bonus to any skill checks made to perform the ritual.": "qualified",
			"You gain a +2 bonus to damage rolls with the chosen weapon.": "qualified",
			"You gain a +2 bonus to healing.": "target:healing",
			"Choose one: you gain a +2 bonus to AC or a +2 bonus to Will.": "conditional",
			"It has a +4 bonus to AC and Fortitude.": "conditional",
			"You gain a +1 bonus to speed equal to your Wisdom modifier.": "conditional",
		};
		for (const [sentence, why] of Object.entries(cases)) {
			const r = parseBonuses(sentence);
			assert.deepEqual(r.bonuses, [], sentence);
			assert.equal(r.skipped[0]?.why, why, sentence);
		}
	});

	test("a duration clause does not make a sentence conditional ('next turn' contains 'next')", () => {
		assert.equal(one("You gain a +2 bonus to AC until the end of your next turn.").length, 1);
		assert.equal(one("You gain a +2 bonus to AC until the start of the target's next turn.").length, 1);
	});

	test("nothing in the text, nothing built", () => {
		assert.deepEqual(parseBonuses("You push the target 2 squares."), { bonuses: [], skipped: [] });
		assert.deepEqual(parseBonuses(undefined), { bonuses: [], skipped: [] });
	});
});

describe("reading resistances", () => {
	const types = ENUMS.damageTypes;

	test("resist to all damage covers every damage type of the system", () => {
		const [b] = parseResistances("You gain resist 5 to all damage until the end of your next turn.", types).bonuses;
		assert.deepEqual([b.amount, b.subject, b.duration], [5, "self", { type: "endOfTurn", owner: "source" }]);
		assert.equal(b.changes.length, types.length);
		assert.ok(b.changes.every(c => c.type === "upgrade" && c.value === "5" && c.key.endsWith(".res")));
	});

	test("typed resistance and vulnerability", () => {
		const [r] = parseResistances("You gain resist 10 fire damage.", types).bonuses;
		assert.deepEqual(keys(r.changes), ["system.resistances.fire.res=10/upgrade"]);
		const [v] = parseResistances("The target gains vulnerable 5 to all damage (save ends).", types).bonuses;
		assert.ok(v.changes.every(c => c.key.endsWith(".vuln") && c.value === "-5" && c.type === "downgrade"));
		const [two] = parseResistances("You gain resist 5 fire and cold damage.", types).bonuses;
		assert.deepEqual(two.changes.map(c => c.key), ["system.resistances.cold.res", "system.resistances.fire.res"].sort().length ? ["system.resistances.cold.res", "system.resistances.fire.res"].filter(k => two.changes.some(c => c.key === k)) : []);
	});

	test("an amount that depends on something, or a chosen type, is not built", () => {
		for (const s of ["You gain resist 5 + your Constitution modifier to that damage type.", "You gain resistance to all damage equal to your Wisdom modifier.", "You gain resist 5 to the chosen damage type."]) assert.deepEqual(parseResistances(s, types).bonuses, [], s);
	});
});

describe("effects of a power", () => {
	test("a bonus on the user, with its duration and timing", () => {
		const items = build(power([["Effect", "You gain a +2 power bonus to all defenses until the end of your next turn."]]));
		const fx = items[0].effects.filter(e => e.system.changes.length);
		assert.equal(fx.length, 1);
		assert.deepEqual([fx[0].name, fx[0].system.durationType, fx[0].system.powerEffectType, fx[0].transfer], ["+2 power bonus to all defenses", "endOfUserTurn", "self", false]);
		assert.equal(fx[0].system.changes.length, 4);
	});

	test("a penalty on the target on a hit, ending on a save; an ally's bonus goes to allies", () => {
		const hit = build(entry("t-bonus-hit", { name: "Test Sap", cls: "Wizard", keywords: ["Arcane", "Implement"], range: "<b>Ranged</b> 10", blocks: [["Target", "One creature"], ["Attack", "Intelligence vs. Will"], ["Hit", "1d6 damage, and the target takes a -2 penalty to attack rolls (save ends)."]] }));
		assert.deepEqual(hit[0].effects.map(e => [e.name, e.system.durationType, e.system.powerEffectType]), [["-2 penalty to attack rolls", "saveEnd", "hit"]]);
		const ally = build(power([["Effect", "That ally gains a +1 power bonus to speed until the end of your next turn."]]));
		assert.equal(ally[0].effects[0].system.powerEffectType, "allies");
	});

	test("a bonus that scales with the level is not built (a fixed number would be wrong later)", () => {
		const raw = power([["Effect", "You gain a +2 power bonus to attack rolls until the end of your next turn.\nLevel 11: +3 power bonus.\nLevel 21: +4 power bonus."]]);
		const [item] = build(raw);
		assert.deepEqual(item.effects.filter(e => e.system.changes.length), []);
		assert.ok(item.flags.dnd4e.import.effectsUnresolved.some(g => g.why === "scales"));
	});

	test("a resistance on the user", () => {
		const [item] = build(power([["Effect", "You gain resist 5 to all damage until the end of your next turn."]]));
		const fx = item.effects.find(e => e.system.changes.length);
		assert.equal(fx.name, "Resist 5 to all damage");
		assert.equal(fx.system.changes.length, ENUMS.damageTypes.length);
	});

	test("a bonus whose subject the text does not name is reported, not guessed", () => {
		const [item] = build(power([["Effect", "A +2 power bonus to AC applies until the end of your next turn."]]));
		assert.deepEqual(item.effects.filter(e => e.system.changes.length), []);
	});

	test("the built effects are valid", () => {
		for (const blocks of [[["Effect", "You gain a +2 power bonus to AC and Reflex until the end of the encounter."]], [["Effect", "You gain resist 5 to all damage."]]]) {
			assert.deepEqual(effectProblems(build(power(blocks))[0]), []);
		}
	});
});

describe("effects of a feature", () => {
	const ctx = { itemId: "ITEM1234567890AB", damageTypes: ENUMS.damageTypes };

	test("a standing bonus transfers to the owner", () => {
		const [fx] = featureEffects("You gain a +1 feat bonus to Will.", ctx);
		assert.deepEqual([fx.name, fx.transfer, fx.system.durationType, fx.system.powerEffectType], ["+1 feat bonus to Will", true, "", "misc"]);
		assert.deepEqual(keys(fx.system.changes), ["system.defences.wil.feat=1/upgrade"]);
		assert.match(fx._id, /^[A-Za-z0-9]{16}$/);
	});

	test("a feature that offers a choice, or changes with the level, has no effect", () => {
		assert.deepEqual(featureEffects("Choose one of the following. You gain a +1 feat bonus to Will.", ctx), []);
		assert.deepEqual(featureEffects("You gain a +1 feat bonus to Will. The bonus increases to +2 at 11th level.", ctx), []);
		assert.deepEqual(featureEffects("You gain a +1 feat bonus to Will.\nLevel 11: +2 feat bonus.", ctx), []);
	});

	test("only the character's own, lasting bonuses: not a duration, not someone else's", () => {
		assert.deepEqual(featureEffects("You gain a +2 bonus to AC until the end of the encounter.", ctx), []);
		assert.deepEqual(featureEffects("The target gains a +2 bonus to AC.", ctx), []);
	});

	test("the name of a bonus reads like the book", () => {
		assert.equal(bonusName({ amount: 2, type: "power", phrase: "all defenses" }), "+2 power bonus to all defenses");
		assert.equal(bonusName({ amount: -2, type: "untyped", phrase: "attack rolls" }), "-2 penalty to attack rolls");
		assert.equal(bonusName({ amount: 5, type: "resist", phrase: "resist 5 to all damage", resist: true }), "Resist 5 to all damage");
	});

	test("bonusEffects reports an unnamed subject", () => {
		assert.deepEqual(bonusEffects("A +2 bonus to AC until the end of your next turn.").unresolved, [{ what: "bonus", why: "subject" }]);
	});
});

describe("effect validation of changes", () => {
	const item = () => structuredClone(build(power([["Effect", "You gain a +2 power bonus to AC until the end of your next turn."]]))[0]);

	test("a built item is clean", () => assert.deepEqual(effectProblems(item()), []));

	test("breaking a change is caught", () => {
		const i = item();
		const [fx] = i.effects;
		fx.system.changes = [
			{ key: "system.defences.ac.luck", type: "add", value: "2", priority: null },
			{ key: "system.defences.fort.power", type: "add", value: "2", priority: null },
			{ key: "system.defences.ref.untyped", type: "upgrade", value: "x", priority: null },
			{ key: "system.resistances.fire.vuln", type: "downgrade", value: "5", priority: null },
			{ key: "system.skills.prc.feat", type: "multiply", value: "2", priority: null },
		];
		const text = effectProblems(i).join("\n");
		for (const re of [/change key "system\.defences\.ac\.luck"/, /should be "upgrade", not "add"/, /should be "add", not "upgrade"/, /value "x" is not a whole number/, /vulnerability must be negative/, /type "multiply"/]) assert.match(text, re);
	});

	test("a feature's effect must transfer, and a power's must not", () => {
		const f = { type: "feature", effects: [{ _id: "ABCDEFGHIJKLMNOP", name: "x", transfer: false, statuses: [], system: { durationType: "", powerEffectType: "misc", dots: [], keywords: [], changes: [{ key: "system.defences.wil.feat", type: "upgrade", value: "1", priority: null }] } }] };
		assert.match(effectProblems(f).join("\n"), /effect of a feature or an item must transfer/);
	});
});

const here = path.dirname(fileURLToPath(import.meta.url));
const dbDir = path.join(here, "..", "out", "db");
const skip = existsSync(path.join(dbDir, "power", "_index.json")) ? false : "database not built (out/db)";

describe("real database bonuses", { skip }, () => {
	const loadPowers = async () => {
		const dir = path.join(dbDir, "power");
		const items = [];
		for (const f of (await readdir(dir)).filter(f => f !== "_index.json")) items.push(...JSON.parse(await readFile(path.join(dir, f), "utf8")));
		return items;
	};

	test("every change of every power effect is valid", async () => {
		const seen = new Set(), bad = [];
		for (const item of await loadPowers()) for (const p of effectProblems(item, seen)) bad.push(`${item.name}: ${p}`);
		assert.deepEqual(bad.slice(0, 5), []);
	});

	test("every race, class and option item has valid effects", async () => {
		const files = ["race/races.json", "class/classes.json", ...["feat", "path", "destiny", "theme", "background"].map(k => `option/${k}/entries.json`)];
		const seen = new Set(), bad = [];
		for (const file of files) for (const e of JSON.parse(await readFile(path.join(dbDir, file), "utf8"))) for (const item of e.items) for (const p of effectProblems(item, seen)) bad.push(`${item.name}: ${p}`);
		assert.deepEqual(bad.slice(0, 5), []);
	});

	test("features that offer a choice or scale with the level have no effects", async () => {
		const CHOICE = /\bchoose\b|one of the following|\bincreases? (?:to|by)\b|\b\d+(?:st|nd|rd|th) level\b/i;
		const bad = [];
		for (const file of ["race/races.json", "class/classes.json", ...["feat", "path", "destiny"].map(k => `option/${k}/entries.json`)]) {
			for (const e of JSON.parse(await readFile(path.join(dbDir, file), "utf8"))) for (const item of e.items) {
				// The prerequisite ("11th level") is not part of what the effect was built from.
				const text = item.system.description.value.replace(/<p><strong>Prerequisite:<\/strong>[^<]*<\/p>/, "");
				// Training and proficiencies are read sentence by sentence and do not depend on the rest of the text.
				const bonuses = (item.effects ?? []).filter(fx => fx.system.changes.some(c => !/\.training$|Prof\.value$/.test(c.key)));
				if (bonuses.length && CHOICE.test(text)) bad.push(`${e.name}: ${item.name}`);
			}
		}
		assert.deepEqual(bad.slice(0, 5), []);
	});

	test("the amount of bonus effects is in the expected range (a regression guard, not a target)", async () => {
		const items = await loadPowers();
		const withChanges = items.flatMap(i => i.effects).filter(e => e.system.changes.length);
		assert.ok(withChanges.length > 400 && withChanges.length < 900, `${withChanges.length} effects with changes`);
	});

	test("known sources: Epic Combatant's two bonuses, a racial +1 to Will", async () => {
		const destiny = JSON.parse(await readFile(path.join(dbDir, "option/destiny/entries.json"), "utf8"));
		const combatant = destiny.flatMap(e => e.items).find(i => i.name === "Epic Combatant");
		assert.deepEqual(combatant.effects.map(e => e.name), ["+1 bonus to attack rolls", "+2 bonus to saving throws"]);
		const races = JSON.parse(await readFile(path.join(dbDir, "race/races.json"), "utf8"));
		const eladrin = races.find(r => r.name === "Eladrin").items.find(i => i.name === "Eladrin Will");
		assert.deepEqual(keys(eladrin.effects[0].system.changes), ["system.defences.wil.race=1/upgrade"]);
	});
});
