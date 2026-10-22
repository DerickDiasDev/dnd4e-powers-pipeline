/**
 * Glossary tests: a compendium page -> a journal entry with one text page. The fixtures are invented (no book text).
 * The last block checks the real database when out/ exists.
 * Run: npm test
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildGlossary, cleanHtml, indexRow } from "../build-glossary.mjs";
import { validateGlossary } from "../validate-glossary.mjs";

const page = (html = `<h1 class=player>ZORBING</h1><p><i>Rule</i><br>Make a zorb check.</p><h3>SPIN</h3>Spin around.<br>✦  Action: A move action.<table><tr><th>Zorb<th>DC<tr><td>Easy<td>10</table><p class=publishedIn>Published in Test Book.</p>`) => ({
	id: "glossary900", listing: { ID: "glossary900", Name: "Zorbing", Category: "Rules", Type: "Rules Combat", SourceBook: "TST, TST2" }, html,
});

describe("cleaning", () => {
	test("the title, the attributes, the links and the publisher line go; the tags a page needs stay", () => {
		const html = cleanHtml(page().html);
		assert.doesNotMatch(html, /ZORBING|publishedIn|Published/);
		assert.match(html, /^<p><i>Rule<\/i><br>Make a zorb check\.<\/p><h3>SPIN<\/h3>Spin around\./);
		assert.match(html, /<table><tr><th>Zorb<th>DC<tr><td>Easy<td>10<\/table>/);
		assert.equal(cleanHtml(`<p class=x onclick="evil()">See <a href="http://x">the link</a>.</p><script>alert(1)</script><span style="a">s</span>`), "<p>See the link.</p>alert(1)s");
	});

	test("long runs of line breaks collapse", () => {
		assert.equal(cleanHtml("<p>a<br><br><br><br>b</p>"), "<p>a<br><br>b</p>");
	});
});

describe("building", () => {
	test("a journal entry with one text page, the category and the type, and the books", () => {
		const e = buildGlossary(page());
		assert.deepEqual([e.name, e.category, e.type, e.sources], ["Zorbing", "Rules", "Rules Combat", ["TST", "TST2"]]);
		assert.equal(e.journal.pages.length, 1);
		assert.deepEqual([e.journal.pages[0].type, e.journal.pages[0].name, e.journal.pages[0].text.format], ["text", "Zorbing", 1]);
		assert.equal(e.journal.flags.dnd4e.import.id, "glossary900");
		assert.equal(e.journal._id, e._id);
	});

	test("ids are deterministic, the index row is light, and what is built validates; the validator rejects a script", () => {
		const a = buildGlossary(page()), b = buildGlossary(page());
		assert.deepEqual([a._id, a.journal.pages[0]._id], [b._id, b.journal.pages[0]._id]);
		assert.equal("journal" in indexRow(a), false);
		assert.equal(validateGlossary([a], [indexRow(a)]).size, 0);
		a.journal.pages[0].text.content += "<script>x</script>";
		assert.match([...validateGlossary([a], [indexRow(a)]).keys()].join(), /script|not allowed/);
	});

	test("a page with no text is noted", () => {
		assert.deepEqual(buildGlossary(page("<h1 class=player>EMPTY</h1>")).notes, ["empty"]);
	});
});

describe("the real database", () => {
	const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "out", "db", "glossary");
	const skip = existsSync(path.join(dir, "entries.json")) ? false : "out/db/glossary not built";

	test("every entry validates", { skip }, async () => {
		const entries = JSON.parse(await readFile(path.join(dir, "entries.json"), "utf8"));
		const index = JSON.parse(await readFile(path.join(dir, "_index.json"), "utf8"));
		assert.equal(validateGlossary(entries, index).size, 0);
		assert.equal(entries.length, index.length);
		assert.ok(entries.length >= 540);
		assert.ok(entries.find(e => e.name === "Athletics").size > 5000);
	});
});
