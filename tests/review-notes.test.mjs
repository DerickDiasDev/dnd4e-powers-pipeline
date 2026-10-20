/**
 * Review notes: the structured reasons (and their level) the importer shows next to a power.
 * Run: npm test
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parsePower } from "../parse-powers.mjs";
import { convertPower } from "../build-db.mjs";
import { REVIEW_LEVELS, levelOf, reviewLevel, reviewNotes } from "../review-notes.mjs";
import { CATEGORIES, FIXTURES } from "./fixtures.mjs";

const item = (...review) => ({ flags: { dnd4e: { import: { review } } } });
const notesOf = name => {
	const parsed = parsePower(FIXTURES[name]);
	return reviewNotes(convertPower(parsed, { categories: CATEGORIES }), parsed.quality, parsed.unparsed);
};
const summary = notes => notes.map(n => `${n.level}:${n.code}${n.detail ? `:${n.detail}` : ""}`);

describe("reviewNotes", () => {
	test("no review strings -> no notes", () => {
		assert.deepEqual(reviewNotes([item(), item()]), []);
		assert.equal(reviewLevel([]), "none");
	});

	test("a string is split into code and detail at the first colon only", () => {
		const [note] = reviewNotes([item("damage-from:hit-variant:Reflex")]);
		assert.deepEqual(note, { code: "damage-from", level: "info", detail: "hit-variant:Reflex" });
	});

	test("the same note on several items of a bundle is listed once", () => {
		const notes = reviewNotes([item("range-origin:Area burst 1 within weapon range"), item("range-origin:Area burst 1 within weapon range", "range-sight")]);
		assert.deepEqual(summary(notes), ["info:range-origin:Area burst 1 within weapon range", "info:range-sight"]);
	});

	test("warnings come first, then info, each sorted by code", () => {
		const notes = reviewNotes([item("range-sight", "damage-mod:chosen", "damage-from:effect", "attack-ability:beast")]);
		assert.deepEqual(summary(notes), ["warn:attack-ability:beast", "warn:damage-mod:chosen", "info:damage-from:effect", "info:range-sight"]);
	});

	test("a long detail is cut so the index stays small", () => {
		const [note] = reviewNotes([item(`range:${"x".repeat(300)}`)]);
		assert.equal(note.detail.length, 80);
	});

	test("an unknown code counts as a warning: a new kind of note is never silently demoted", () => {
		assert.equal(levelOf("something-new"), "warn");
		assert.equal(reviewNotes([item("something-new")])[0].level, "warn");
	});

	test("overall level: any warning wins; otherwise info", () => {
		assert.equal(reviewLevel(reviewNotes([item("range-sight")])), "info");
		assert.equal(reviewLevel(reviewNotes([item("range-sight", "range-missing")])), "warn");
	});

	test("a partial entry gets a 'partial' note with the parser's problem", () => {
		const notes = reviewNotes([item()], "partial", ["range:Close touch"]);
		assert.deepEqual(summary(notes), ["warn:partial:range:Close touch"]);
	});

	test("a partial entry whose only problem is unstructured damage is not reported twice", () => {
		const notes = reviewNotes([item("damage-unparsed")], "partial", ["damage:unparsed"]);
		assert.deepEqual(summary(notes), ["warn:damage-unparsed"]);
	});

	test("a partial entry with no other note still says so", () => {
		assert.deepEqual(summary(reviewNotes([item()], "partial", ["damage:unparsed"])), ["warn:partial"]);
	});
});

describe("notes from converted fixtures", () => {
	test("a plain weapon power has none", () => assert.deepEqual(notesOf("weaponBasic"), []));
	test("a split melee/ranged power with different attacks has none", () => assert.deepEqual(notesOf("meleeRangedSplit"), []));
	test("primary and highest ability need no note (they are automated)", () => {
		for (const name of ["primaryAttack", "highestAll", "highestMental"]) assert.deepEqual(notesOf(name), [], name);
	});
	test("one roll against several defences warns; damage found in a variant is informative", () => {
		assert.deepEqual(summary(notesOf("hitVariants")), ["warn:attack-multiple-defences", "info:damage-from:hit-variant:Reflex"]);
	});
	test("an area with another origin is informative", () => assert.deepEqual(summary(notesOf("areaOrigin")), ["info:range-origin:Area burst 1 within weapon range"]));
	test("a bare 'ability modifier' next to a normal attack warns", () => assert.deepEqual(summary(notesOf("abilityAmbiguous")), ["warn:damage-mod:ability"]));
	test("damage taken from Effect is informative", () => assert.deepEqual(summary(notesOf("selfDamage")), ["info:damage-from:effect"]));
});

describe("review notes in the real index", () => {
	const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
	const indexFile = path.join(root, "out", "db", "power", "_index.json");
	const skip = existsSync(indexFile) ? false : "generated data not found (run npm run pipeline)";

	test("every code in the database has a level in the table (none fall back silently)", { skip }, async () => {
		const index = JSON.parse(await readFile(indexFile, "utf8"));
		const unknown = new Set();
		for (const row of index) for (const note of row.reviewNotes) if (!(note.code in REVIEW_LEVELS)) unknown.add(note.code);
		assert.deepEqual([...unknown], [], "add the new code to REVIEW_LEVELS (and to the importer's language files)");
	});

	test("each row's fields agree: level, count and note levels", { skip }, async () => {
		const index = JSON.parse(await readFile(indexFile, "utf8"));
		for (const row of index) {
			assert.equal(row.review, row.reviewNotes.length, row.name);
			assert.equal(row.reviewLevel, reviewLevel(row.reviewNotes), row.name);
			for (const note of row.reviewNotes) assert.equal(note.level, levelOf(note.code), `${row.name}: ${note.code}`);
			if (row.quality !== "full") assert.ok(row.reviewNotes.length > 0, `${row.name} is partial but has no note`);
		}
	});
});
