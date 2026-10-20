/**
 * Simulated-sheet tests over the whole DB: for every item and every fictional character, the number the item's formulas
 * produce (sheet simulator) must equal the number the book text and rules say (oracle).
 *
 * Needs the generated data (out/parsed/power.json and out/db). Without it the tests are skipped, not failed.
 * Run: npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CHARACTERS } from "./sim/characters.mjs";
import { simulate } from "./sim/sheet.mjs";
import { expected, primaryDamage } from "./sim/oracle.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const parsedFile = path.join(root, "out", "parsed", "power.json");
const indexFile = path.join(root, "out", "db", "power", "_index.json");
const haveData = existsSync(parsedFile) && existsSync(indexFile);
const skip = haveData ? false : "generated data not found (run parse-powers.mjs and build-db.mjs first)";

/** Items whose review flags say the conversion is knowingly incomplete are counted, not compared. */
const KNOWN_INCOMPLETE = /^(?:attack-ability:|damage-mod:|damage-unparsed)/;

async function loadAll() {
	const parsed = new Map(JSON.parse(await readFile(parsedFile, "utf8")).map(p => [p.id, p]));
	const index = JSON.parse(await readFile(indexFile, "utf8"));
	const items = [];
	for (const file of new Set(index.map(r => r.file))) items.push(...JSON.parse(await readFile(path.join(root, "out", "db", "power", file), "utf8")));
	return { parsed, items };
}

const fmt = (v) => (v ? `${v.min}..${v.max}` : "-");

test("every item's formulas give the numbers the book rules give", { skip }, async () => {
	const { parsed, items } = await loadAll();
	const stats = { compared: 0, attackChecks: 0, damageChecks: 0, critChecks: 0, knownIncomplete: 0, oracleSkipped: 0 };
	const problems = [];
	const add = (kind, item, character, detail) => problems.push({ kind, name: item.name, character: character.name, detail });

	for (const item of items) {
		const flags = item.flags.dnd4e.import;
		const power = parsed.get(flags.id);
		if (flags.review.some(r => KNOWN_INCOMPLETE.test(r))) { stats.knownIncomplete++; continue; }

		for (const character of CHARACTERS) {
			let actual;
			try { actual = simulate(item, character); } catch (e) { add("simulator-error", item, character, e.message); continue; }
			const want = expected(power, flags, item.system.weaponType, character);
			if (want.skip) { stats.oracleSkipped++; continue; }
			stats.compared++;

			if (want.weaponDiceWithoutWeapon) add("weapon-dice-without-weapon", item, character, `weaponType=${item.system.weaponType}`);
			if ((want.attack === null) !== (actual.attack === null)) add("attack-presence", item, character, `expected ${fmt(want.attack)}, got ${fmt(actual.attack)}`);
			else if (want.attack) {
				stats.attackChecks++;
				if (want.attack.max !== actual.attack.max) add("attack-bonus", item, character, `expected +${want.attack.max}, got +${actual.attack.max}`);
			}
			if ((want.damage === null) !== (actual.damage === null)) add("damage-presence", item, character, `expected ${fmt(want.damage)}, got ${fmt(actual.damage)}`);
			else if (want.damage) {
				stats.damageChecks++;
				if (want.damage.min !== actual.damage.min || want.damage.max !== actual.damage.max) add("damage", item, character, `expected ${fmt(want.damage)}, got ${fmt(actual.damage)}`);
				stats.critChecks++;
				if (want.crit.min !== actual.crit.min || want.crit.max !== actual.crit.max) add("crit-damage", item, character, `expected ${fmt(want.crit)}, got ${fmt(actual.crit)}`);
			}
		}
	}

	console.log("simulated sheet:", JSON.stringify(stats));
	if (problems.length) {
		const byKind = {};
		for (const p of problems) (byKind[p.kind] ??= []).push(p);
		const lines = Object.entries(byKind).map(([kind, list]) => `${list.length} x ${kind}\n` + list.slice(0, 4).map(p => `    ${p.name} [${p.character}]: ${p.detail}`).join("\n"));
		assert.fail(`${problems.length} mismatches between the DB formulas and the book rules:\n${lines.join("\n")}`);
	}
});

test("weaponType follows the keywords and the melee/ranged variant", { skip }, async () => {
	const { parsed, items } = await loadAll();
	const bad = [];
	for (const item of items) {
		const flags = item.flags.dnd4e.import;
		const section = flags.role === "child" ? parsed.get(flags.id).children[flags.section] : parsed.get(flags.id);
		const keywords = (section.keywords?.length ? section.keywords : parsed.get(flags.id).keywords).map(k => k.toLowerCase());
		const weapon = keywords.includes("weapon");
		const implement = keywords.includes("implement");
		const type = item.system.weaponType;
		// Rules: [W] is the damage die of a weapon, so damage rolled in [W] needs a real weapon, whatever the keywords say.
		const rollsWeaponDice = (primaryDamage(section, flags.variant ?? null)?.weapon ?? 0) > 0;
		if (rollsWeaponDice) {
			if (!["melee", "ranged", "meleeRanged", "any"].includes(type)) bad.push(`${item.name}: damage uses [W] but weaponType=${type}`);
			else if (flags.variant && type !== flags.variant) bad.push(`${item.name}: ${flags.variant} variant but weaponType=${type}`);
		}
		else if (!weapon && !implement && type !== "none") bad.push(`${item.name}: no weapon/implement keyword but weaponType=${type}`);
		else if (implement && !weapon && type !== "implement") bad.push(`${item.name}: implement-only but weaponType=${type}`);
		else if (flags.variant && (weapon || implement) && type !== flags.variant) bad.push(`${item.name}: ${flags.variant} variant but weaponType=${type}`);
	}
	assert.equal(bad.length, 0, `${bad.length} weaponType problems:\n${bad.slice(0, 8).join("\n")}`);
});

test("a melee/ranged power is listed once and imports both versions", { skip }, async () => {
	const index = JSON.parse(await readFile(indexFile, "utf8"));
	const split = index.filter(r => r.variants.length);
	assert.ok(split.length > 0, "expected some split powers");
	for (const row of split) {
		assert.deepEqual(row.variants, ["melee", "ranged"], row.name);
		assert.equal(row.items.length, 2 + row.children, `${row.name}: items = melee + ranged + children`);
	}
	assert.equal(new Set(index.map(r => r.id)).size, index.length, "one index row per power");
});

test("a power that lets the player choose the ability has exactly one version per ability of its text", { skip }, async () => {
	const { parsed, items } = await loadAll();
	const index = JSON.parse(await readFile(indexFile, "utf8"));
	const ABILITIES = new Set(["str", "con", "dex", "int", "wis", "cha"]);

	// The set of abilities the text offers, worked out here from the parsed text (not from the converter).
	function offered(power) {
		const a = power.attack?.abilities;
		if (a && a.length > 1 && a.every(x => ABILITIES.has(x))) return a;
		for (const block of [power.hit, ...(power.hitVariants ?? []), power.effect]) {
			const candidates = (block?.damage ?? []).filter(d => !d.extra && !d.equalTo && !d.self);
			if (!candidates.length) continue;
			const mod = candidates[0].mods.find(m => m.includes("|") && m.split("|").every(o => ABILITIES.has(o)));
			return mod ? mod.split("|") : null;
		}
		return null;
	}

	const byId = new Map(items.map(i => [i._id, i]));
	const problems = [];
	let checked = 0;
	for (const row of index) {
		const power = parsed.get(row.id);
		if (power.attack?.alternatives || row.variants.length) continue; // melee/ranged powers are covered by their own tests
		const want = offered(power) ?? [];
		checked += want.length ? 1 : 0;
		if (JSON.stringify(row.abilities) !== JSON.stringify(want)) problems.push(`${row.name}: text offers [${want}], row has [${row.abilities}]`);
		const versions = row.items.map(id => byId.get(id)).filter(i => i.flags.dnd4e.import.role !== "child");
		if (versions.length !== Math.max(1, want.length)) problems.push(`${row.name}: ${versions.length} versions for ${want.length || 1} expected`);
		if (want.length && JSON.stringify(versions.map(v => v.flags.dnd4e.import.ability)) !== JSON.stringify(want)) problems.push(`${row.name}: version abilities ${versions.map(v => v.flags.dnd4e.import.ability)} != ${want}`);
		if (want.length && new Set(versions.map(v => v.name)).size !== versions.length) problems.push(`${row.name}: two versions share a name`);
	}
	assert.ok(checked > 150, `only ${checked} powers with a choice were checked`);
	assert.equal(problems.length, 0, `${problems.length} problems:\n${problems.slice(0, 6).join("\n")}`);
});
