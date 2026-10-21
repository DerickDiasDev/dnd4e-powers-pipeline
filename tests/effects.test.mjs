/**
 * Power ActiveEffects: the conditions and ongoing damage a power applies become the effects embedded in its items.
 * The fixtures are invented (no book text). The last block checks the whole real database when out/ exists.
 * Run: npm test
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { appliesCondition, parsePower, subjectOf } from "../parse-powers.mjs";
import { convertPower } from "../build-db.mjs";
import { durationTypeOf, statusId } from "../build-effects.mjs";
import { effectProblems } from "../validate-effects.mjs";
import { CATEGORIES, FIXTURES, entry } from "./fixtures.mjs";

const power = (name, blocks, o = {}) => entry(`t-fx-${name}`, { name: `Test ${name}`, cls: "Wizard", keywords: ["Arcane", "Implement"], range: "<b>Ranged</b> 10", blocks: [["Target", "One creature"], ["Attack", "Intelligence vs. Will"], ...blocks], ...o });
const build = (raw, ctx = {}) => convertPower(parsePower(raw), { categories: CATEGORIES, ...ctx });
const effectsOf = (blocks, o) => build(power("x", blocks, o))[0].effects;
const summary = effects => effects.map(e => [e.name, e.statuses, e.system.durationType, e.system.powerEffectType]);

describe("who a condition lands on", () => {
	test("the closest of 'you' and a target word wins", () => {
		assert.equal(subjectOf("1d8 damage, and the target is "), "target");
		assert.equal(subjectOf("You are "), "self");
		assert.equal(subjectOf("You push the target 2 squares and knock it "), "target");
		assert.equal(subjectOf("Each enemy in the burst is "), "target");
		assert.equal(subjectOf("Until the end of your next turn, you are "), "self");
		assert.equal(subjectOf("Always "), "unknown");
	});

	test("'your' is not 'you'", () => {
		assert.equal(subjectOf("Until the end of your next turn "), "unknown");
	});
});

describe("applied or only mentioned", () => {
	test("applied conditions", () => {
		for (const s of ["The target is dazed (save ends).", "You knock the target prone.", "Each enemy in the burst is slowed until the end of your next turn.", "The target falls prone.", "The target grants combat advantage (save ends)."]) assert.equal(appliesCondition(s), true, s);
	});

	test("mentions are not applied", () => {
		for (const s of [
			"Your attacks against immobilized, restrained, or prone targets deal 5 extra fire damage.",
			"The dazed condition ends on each ally within 5 squares of you.",
			"You are no longer slowed.",
			"You are immune to the blinded condition.",
			"Any enemy that starts its turn adjacent to the target is immobilized until the start of that enemy's next turn.",
			"Until the stance ends, each enemy adjacent to you is slowed.",
			"The target is marked by an ally within 5 squares of you.",
		]) assert.equal(appliesCondition(s), false, s);
	});

	test("'(save ends)' is not mistaken for the end of a condition", () => {
		assert.equal(appliesCondition("The target is dazed (save ends)."), true);
	});
});

describe("duration and status mapping", () => {
	test("the parser's durations map to the system's duration types", () => {
		assert.equal(durationTypeOf(null), "");
		assert.equal(durationTypeOf({ type: "saveEnds", group: null }), "saveEnd");
		assert.equal(durationTypeOf({ type: "saveEnds", group: "both" }), "saveEnd");
		assert.equal(durationTypeOf({ type: "endOfTurn", owner: "source" }), "endOfUserTurn");
		assert.equal(durationTypeOf({ type: "endOfTurn", owner: "target" }), "endOfTargetTurn");
		assert.equal(durationTypeOf({ type: "startOfTurn", owner: "source" }), "startOfUserTurn");
		assert.equal(durationTypeOf({ type: "startOfTurn", owner: "target" }), "startOfTargetTurn");
		assert.equal(durationTypeOf({ type: "endOfEncounter" }), "endOfEncounter");
		assert.equal(durationTypeOf({ type: "endOfTurn", owner: "other", who: "an ally" }), "custom", "someone else's turn: the system has no such type");
	});

	test("the parser's names map to the system's status ids", () => {
		assert.equal(statusId("marked"), "mark");
		assert.equal(statusId("combatAdvantage"), "grantingCA");
		assert.equal(statusId("dazed"), "dazed");
	});
});

describe("effects of a power", () => {
	test("the conditions of a hit, with their durations; conditions that share a duration share an effect", () => {
		const effects = build(FIXTURES.durations)[0].effects;
		assert.deepEqual(summary(effects), [
			["Dazed", ["dazed"], "endOfTargetTurn", "hit"],
			["Slowed and Weakened", ["slowed", "weakened"], "saveEnd", "hit"],
			["Marked", ["mark"], "startOfUserTurn", "hit"],
		]);
	});

	test("every effect is a plain, valid effect the system can apply", () => {
		for (const e of build(FIXTURES.durations)[0].effects) {
			assert.equal(e.transfer, false);
			assert.deepEqual(e.system.keywords, []);
			assert.deepEqual(e.system.changes, []);
			assert.match(e._id, /^[A-Za-z0-9]{16}$/);
			assert.match(e.img, /^systems\/dnd4e\/icons\/statusEffects\/.+\.svg$/);
		}
		assert.deepEqual(effectProblems(build(FIXTURES.durations)[0]), []);
	});

	test("ongoing damage is an effect with a dot, ending on a save", () => {
		const [fx] = build(FIXTURES.ongoing)[0].effects;
		assert.deepEqual([fx.name, fx.statuses, fx.system.durationType, fx.system.powerEffectType], ["Ongoing 5 fire", [], "saveEnd", "hit"]);
		assert.deepEqual(fx.system.dots, [{ amount: "5", types: ["fire"] }]);
	});

	test("a miss, an effect line and the user's own conditions get their own timing", () => {
		const effects = effectsOf([
			["Hit", "1d8 damage."],
			["Miss", "The target is slowed until the end of your next turn."],
			["Effect", "The target is knocked prone. You are slowed until the end of your next turn. You grant combat advantage until the start of your next turn."],
		]);
		assert.deepEqual(summary(effects), [
			["Slowed", ["slowed"], "endOfUserTurn", "miss"],
			["Prone", ["prone"], "", "all"],
			["Slowed", ["slowed"], "endOfUserTurn", "self"],
			["Grants combat advantage", ["grantingCA"], "startOfUserTurn", "self"],
		]);
	});

	test("who grants combat advantage matters", () => {
		const target = effectsOf([["Hit", "1d8 damage, and the target grants combat advantage (save ends)."]]);
		const self = effectsOf([["Hit", "1d8 damage, and you grant combat advantage until the end of your next turn."]]);
		assert.deepEqual(summary(target), [["Grants combat advantage", ["grantingCA"], "saveEnd", "hit"]]);
		assert.deepEqual(summary(self), [["Grants combat advantage", ["grantingCA"], "endOfUserTurn", "selfHit"]]);
	});

	test("a condition that is only mentioned makes no effect", () => {
		assert.deepEqual(effectsOf([["Hit", "1d8 damage. Your attacks against prone targets deal 2 extra damage until the end of your next turn."]]), []);
		assert.deepEqual(effectsOf([["Effect", "The dazed condition ends on each ally within 5 squares of you."]]), []);
		assert.deepEqual(effectsOf([["Hit", "1d8 damage, and the target is no longer slowed."]]), [], "a subject is named, but the condition is removed, not applied");
	});

	test("someone else's turn becomes a custom duration, not a wrong one", () => {
		const effects = effectsOf([["Hit", "The target is dazed until the end of an ally's next turn."]]);
		assert.deepEqual(summary(effects), [["Dazed", ["dazed"], "custom", "hit"]]);
	});

	test("an aftereffect is not built, and the power says so", () => {
		const items = build(power("after", [["Hit", "1d8 damage, and the target is slowed (save ends)."], ["Aftereffect", "The target is dazed until the end of your next turn."]]));
		assert.deepEqual(summary(items[0].effects), [["Slowed", ["slowed"], "saveEnd", "hit"]]);
		assert.deepEqual(items[0].flags.dnd4e.import.effectsUnresolved, [{ what: "dazed", why: "aftereffect" }]);
		assert.ok(items[0].flags.dnd4e.import.review.includes("effect-unresolved:1"));
	});

	test("a power with nothing to apply has no effects and no note", () => {
		const items = build(FIXTURES.weaponBasic);
		assert.deepEqual(items[0].effects, []);
		assert.equal(items[0].flags.dnd4e.import.effectsUnresolved, undefined);
		assert.ok(!items[0].flags.dnd4e.import.review.some(r => r.startsWith("effect-unresolved")));
	});

	test("the melee and ranged versions each carry the effects, with their own ids", () => {
		const [melee, ranged] = build(FIXTURES.meleeRangedSplit);
		assert.deepEqual(summary(melee.effects), summary(ranged.effects));
		assert.notEqual(melee.effects[0]._id, ranged.effects[0]._id);
		assert.deepEqual(summary(melee.effects), [["Dazed", ["dazed"], "saveEnd", "hit"]]);
	});

	test("a child power carries the effects of its own text, not its parent's", () => {
		const raw = entry("t-fx-child", {
			name: "Test Form", kind: "Utility", usage: "Daily", keywords: ["Martial", "Stance"], action: "Minor Action", range: "<b>Personal</b>",
			blocks: [["Effect", "You enter the stance."]],
			children: [{ name: "Test Form Attack", usage: "At-Will", blocks: [["Target", "One creature"], ["Attack", "Strength vs. AC"], ["Hit", "1[W] damage, and the target is knocked prone."]] }],
		});
		const items = build(raw);
		assert.deepEqual(items.map(i => i.effects.length), [0, 1]);
		assert.deepEqual(summary(items[1].effects), [["Prone", ["prone"], "", "hit"]]);
	});

	test("ids are stable between builds, and differ between items", () => {
		const ids = () => build(FIXTURES.durations)[0].effects.map(e => e._id);
		assert.deepEqual(ids(), ids());
		assert.equal(new Set(ids()).size, 3);
	});
});

describe("effect validation", () => {
	const good = () => structuredClone(build(FIXTURES.durations)[0]);

	test("a built item is clean", () => assert.deepEqual(effectProblems(good()), []));

	test("breaking an effect is caught", () => {
		const item = good();
		const [a, b, c] = item.effects;
		a.statuses = ["frightened"];
		b.system.durationType = "forever";
		c.system.powerEffectType = "sometimes";
		item.effects.push({ _id: "short", name: "", transfer: true, img: "x.svg", statuses: [], system: { durationType: "", powerEffectType: "hit", dots: [{ amount: "5 + 2", types: ["boom"] }], keywords: {}, changes: [] } });
		item.effects.push({ _id: "ABCDEFGHIJKLMNOP", name: "Nothing", transfer: false, statuses: [], system: { durationType: "", powerEffectType: "hit", dots: [], keywords: [], changes: [] } });
		const text = effectProblems(item).join("\n");
		for (const re of [/status "frightened"/, /durationType "forever"/, /powerEffectType "sometimes"/, /not a 16-char id/, /without a name/, /must not transfer/, /not a status icon/, /dot amount "5 \+ 2"/, /dot type "boom"/, /keywords must be an array/, /does nothing/]) assert.match(text, re);
	});

	test("a duplicate id across items is caught", () => {
		const seen = new Set();
		effectProblems(good(), seen);
		assert.match(effectProblems(good(), seen).join("\n"), /duplicate effect _id/);
	});
});

const here = path.dirname(fileURLToPath(import.meta.url));
const dbDir = path.join(here, "..", "out", "db");
const skip = existsSync(path.join(dbDir, "power", "_index.json")) ? false : "database not built (out/db)";

describe("real database effects", { skip }, () => {
	const loadAll = async () => {
		const dir = path.join(dbDir, "power");
		const items = [];
		for (const f of (await readdir(dir)).filter(f => f !== "_index.json")) items.push(...JSON.parse(await readFile(path.join(dir, f), "utf8")));
		return items;
	};

	test("every effect of every item is valid, with unique ids", async () => {
		const seen = new Set();
		const bad = [];
		for (const item of await loadAll()) for (const p of effectProblems(item, seen)) bad.push(`${item.name}: ${p}`);
		assert.deepEqual(bad.slice(0, 5), []);
	});

	test("an effect's statuses were named by the power's own text", async () => {
		const bad = [];
		for (const item of await loadAll()) {
			const named = new Set(item.flags.dnd4e.import.candidates.conditions.map(c => (c.name === "marked" ? "mark" : c.name === "combatAdvantage" ? "grantingCA" : c.name)));
			for (const e of item.effects) for (const s of e.statuses) if (!named.has(s)) bad.push(`${item.name}: ${s}`);
		}
		assert.deepEqual(bad.slice(0, 5), []);
	});

	test("an item that says it has effects has that many; ones without say nothing", async () => {
		for (const item of await loadAll()) assert.equal(item.flags.dnd4e.import.effects ?? 0, item.effects.length, item.name);
	});

	test("the amount of effects is in the expected range (a regression guard, not a target)", async () => {
		const items = await loadAll();
		const total = items.reduce((n, i) => n + i.effects.length, 0);
		assert.ok(total > 3000 && total < 4000, `${total} effects`);
		assert.ok(items.filter(i => i.effects.length).length > 2000);
	});

	test("known powers: a PHB power that knocks the target prone has a prone effect on hit", async () => {
		const flurry = (await loadAll()).find(i => i.name === "Cunning Flurry");
		assert.deepEqual(summary(flurry.effects), [["Prone", ["prone"], "", "hit"]]);
	});
});
