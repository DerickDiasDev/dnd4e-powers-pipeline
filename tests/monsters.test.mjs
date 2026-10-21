/**
 * Monster pipeline tests: HTML (both layouts of the compendium) -> parsed monster -> NPC actor with its power and trait items.
 * The fixtures are invented (no book text). The last block checks the real database when out/ exists.
 * Run: npm test
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inlineTraits, parseFooter, parseMonster, parseStats, readAttack } from "../parse-monsters.mjs";
import { buildMonster, damageOf, immunitiesOf, indexRow, languagesOf, resistancesOf, sensesOf } from "../build-monsters.mjs";
import { validateMonsters } from "../validate-monsters.mjs";

const FOOTER = `<p class='flavor alt'><b>Skills</b> Stealth +9, Thievery +7<br> <b>Str</b> 14 (+2)      <b>Dex</b> 17 (+3)      <b>Wis</b> 12 (+1)<br><b>Con</b> 13 (+1)      <b>Int</b> 0 (+1)      <b>Cha</b> 8 (-1)</p><p class=flavor><b>Alignment</b> Evil       <b> Languages</b> Common, Zorbish<br><b>Equipment</b>: leather armor , club .</p><p class=publishedIn>Published in Test Book, page(s) 5.</p>`;

/** The table layout: stats in a table, powers under a heading per kind of action. */
const tableMonster = (o = {}) => ({
	id: "monster900",
	listing: { ID: "monster900", Name: "Marsh Brute", Level: "5", CombatRole: "Brute", GroupRole: "Solo", Size: "Large", CreatureType: "Beast, Dragon, Magical, Natural", SourceBook: "TST, TST2", ...o.listing },
	html: o.html ?? `<h1 class=monster>Marsh Brute<br><span class=type>Large natural magical beast (dragon)</span><br><span class=level>Level 5 Solo Brute<span class=xp> XP 1,000</span></span></h1>`
		+ `<table class=bodytable><tr><td><b>HP</b> 256; <b>Bloodied</b> 128<td class=rightalign><b>Initiative</b> +2<tr><td><b>AC</b> 19, <b>Fortitude</b> 21, <b>Reflex</b> 15, <b>Will</b> 17<td class=rightalign><b>Perception</b>+9`
		+ `<tr><td><b>Speed</b> 6 (swamp walk), fly 8, swim 6<td class=rightalign>Darkvision, tremorsense 5<tr><td colspan=2><b>Immune</b> disease, poison; <b>Resist</b> 10 fire; <b>Vulnerable</b> 5 radiant`
		+ `<tr><td colspan=2><b>Saving Throws</b> +5; <b>Action Points</b> 2</table>`
		+ `<h2>Traits</h2><p class='flavor alt'> <b>Mud Skin</b> </p><p class=flavorIndent>The brute has aura 2; enemies treat the area as difficult terrain.</p>`
		+ `<h2>Standard Actions</h2><p class='flavor alt'>(⚔) <b>Bite</b> (poison) ✦ <b>At-Will</b></p><p class=flavorIndent><i>Attack:</i> Melee 2 (one creature); +10 vs. AC</p><p class=flavorIndent><i>Hit:</i> 1d12 + 8 poison damage, and the target is slowed (save ends).</p><p class=flavorIndent><i>Miss:</i> Half damage.</p>`
		+ `<p class='flavor alt'>ᗕ <b>Mud Breath</b> ✦ Recharge ⚄ ⚅</p><p class=flavorIndent><i>Attack:</i> Close blast 5 (creatures in the blast); +8 vs. Reflex</p><p class=flavorIndent><i>Hit:</i> 2d8 + 4 damage, and the target takes a -2 penalty to attack rolls until the end of the brute's next turn.</p>`
		+ `<h2>Triggered Actions</h2><p class='flavor alt'> <b>Bloodied Roar</b> ✦ <b>Encounter</b></p><p class=flavorIndent><i>Trigger:</i> The brute is first bloodied.</p><p class=flavorIndent><i>Effect (Free Action):</i> The brute uses mud breath.</p>`
		+ FOOTER,
});

/** The old layout: a stats paragraph, then compact power lines with the action in the heading's parentheses. */
const oldMonster = (o = {}) => ({
	id: "monster901",
	listing: { ID: "monster901", Name: "Bog Skirmisher", Level: "1", CombatRole: "Skirmisher", GroupRole: "Standard", Size: "Small", CreatureType: "Humanoid, Natural, Reptile", SourceBook: "TST", ...o.listing },
	html: o.html ?? `<h1 class=monster>Bog Skirmisher<br><span class=type>Small natural humanoid (reptile)</span><br><span class=level>Level 1 Skirmisher<span class=xp> XP 100</span></span> </h1>`
		+ ` <p class=flavor><b>Initiative</b> +5        <b>Senses</b> Perception +0; Darkvision<br><b>Slime Aura</b> aura 1; enemies in the aura are slowed.<br><b>HP</b> 27; <b>Bloodied</b> 13<br><b>AC</b> 15; <b>Fortitude</b> 11, <b>Reflex</b> 14, <b>Will</b> 13<br><b>Speed</b> 6, climb 6</p>`
		+ `<p class='flavor alt'>(⚔) <b>Spear</b> (standard, at-will) ✦ <b>Weapon</b></p><p class=flavorIndent>+6 vs AC; 1d8 damage.</p>`
		+ `<p class='flavor alt'>➶ <b>Spit</b> (standard, encounter) ✦ <b>Poison</b></p><p class=flavorIndent>Ranged 10; +4 vs Fortitude; 1d6+2 poison damage, and the target is dazed until the end of the skirmisher's next turn.</p>`
		+ `<p class='flavor alt'> <b>Shifty</b> (minor; at-will) </p><p class=flavorIndent>The skirmisher shifts 1 square.</p>`
		+ `<p class='flavor alt'> <b>Combat Advantage</b></p><p class=flavorIndent>The skirmisher deals an extra 1d6 damage with combat advantage.</p>`
		+ FOOTER,
});

describe("monster parser: header and stats", () => {
	test("level, roles, size, origin, type, xp, books (table layout)", () => {
		const m = parseMonster(tableMonster());
		assert.deepEqual([m.name, m.level, m.group, m.role, m.leader, m.xp], ["Marsh Brute", 5, "solo", "brute", false, 1000]);
		assert.deepEqual([m.size, m.origin, m.creatureType, m.extraKeywords], ["lg", "natural", "beast", ["dragon"]]);
		assert.deepEqual(m.sources, ["TST", "TST2"]);
		assert.equal(m.sourceCode, "TST");
		assert.equal(m.quality, "complete");
	});

	test("a double role: the leader flag is separate", () => {
		const m = parseMonster(tableMonster({ listing: { CombatRole: "Soldier, Leader" } }));
		assert.deepEqual([m.role, m.leader], ["soldier", true]);
		assert.deepEqual([parseMonster(tableMonster({ listing: { CombatRole: "No role" } })).role], [null]);
	});

	test("hit points, initiative, defences, saves, action points (table)", () => {
		const { stats } = parseMonster(tableMonster());
		assert.deepEqual([stats.hp, stats.bloodied, stats.initiative, stats.perception], [256, 128, 2, 9]);
		assert.deepEqual(stats.defences, { ac: 19, fort: 21, ref: 15, wil: 17 });
		assert.deepEqual([stats.saves, stats.actionPoints], [5, 2]);
	});

	test("the same numbers from the old layout", () => {
		const { stats } = parseMonster(oldMonster());
		assert.deepEqual([stats.hp, stats.bloodied, stats.initiative, stats.perception], [27, 13, 5, 0]);
		assert.deepEqual(stats.defences, { ac: 15, fort: 11, ref: 14, wil: 13 });
		assert.equal(stats.senses, "Darkvision");
	});

	test("speed with modes; a creature that only flies does not walk", () => {
		assert.deepEqual(parseMonster(tableMonster()).stats.speed, { walk: 6, modes: { fly: 8, swim: 6 }, text: "6 (swamp walk), fly 8, swim 6" });
		assert.deepEqual(parseStats("<p><b>Speed</b> fly 6 (hover)</p>").speed, { walk: 0, modes: { fly: 6 }, text: "fly 6 (hover)" });
		assert.equal(parseStats("<p>no speed</p>").speed, null);
	});

	test("resist, vulnerable, immune lines", () => {
		const { stats } = parseMonster(tableMonster());
		assert.deepEqual([stats.resist, stats.vulnerable, stats.immune], ["10 fire; ", "5 radiant", "disease, poison; "].map(s => s.replace(/; $/, "")));
	});

	test("ability scores, skills, alignment, languages, equipment", () => {
		const f = parseFooter(tableMonster().html);
		assert.deepEqual(f.abilities.str, { score: 14, mod: 2 });
		assert.deepEqual(f.skills, { stl: 9, thi: 7 });
		assert.deepEqual([f.alignment, f.languages, f.equipment], ["Evil", "Common, Zorbish", "leather armor, club."]);
	});

	test("a page with no scores or numbers is partial, with the reason", () => {
		const m = parseMonster(tableMonster({ html: `<h1 class=monster>Empty<br><span class=type>Medium natural humanoid</span></h1>` }));
		assert.equal(m.quality, "partial");
		for (const note of ["missing-hp", "missing-initiative", "missing-ac", "missing-abilities", "missing-speed"]) assert.ok(m.notes.includes(note), note);
	});
});

describe("monster parser: powers and traits", () => {
	test("table layout: the heading says the usage and keywords, the section the action", () => {
		const m = parseMonster(tableMonster());
		assert.deepEqual(m.powers.map(p => [p.name, p.action, p.usage, p.keywords, p.recharge ?? null]), [
			["Bite", "standard", "atwill", ["poison"], null],
			["Mud Breath", "standard", "recharge", [], [5, 6]],
			["Bloodied Roar", "free", "encounter", [], null],
		]);
	});

	test("old layout: the action and usage are in the heading's parentheses; a heading with neither is a trait", () => {
		const m = parseMonster(oldMonster());
		assert.deepEqual(m.powers.map(p => [p.name, p.action, p.usage, p.keywords]), [
			["Spear", "standard", "atwill", ["Weapon"]],
			["Spit", "standard", "encounter", ["Poison"]],
			["Shifty", "minor", "atwill", []],
		]);
		assert.deepEqual(m.traits.map(t => t.name), ["Slime Aura", "Combat Advantage"], "one from the stats paragraph, one from a heading");
	});

	test("an aura written in a trait is recognised", () => {
		const m = parseMonster(tableMonster());
		assert.equal(m.traits[0].name, "Mud Skin");
		assert.match(m.traits[0].text, /aura 2/);
		assert.equal(inlineTraits(`<p class=flavor><b>Initiative</b> +1<br><b>Fiery Breach</b> aura 1; each enemy...<br><b>HP</b> 1</p>`)[0].aura, true);
	});

	test("attack, defence, range and damage, from the labelled lines and from the compact line", () => {
		const [bite, breath] = parseMonster(tableMonster()).powers.map(p => p.attack);
		assert.deepEqual(bite, { range: "Melee 2", target: "one creature", bonus: 10, defence: "ac", damage: "1d12+8" });
		assert.deepEqual([breath.range, breath.bonus, breath.defence, breath.damage], ["Close blast 5", 8, "ref", "2d8+4"]);
		const [spear, spit] = parseMonster(oldMonster()).powers.map(p => p.attack);
		assert.deepEqual([spear.bonus, spear.defence, spear.damage], [6, "ac", "1d8"]);
		assert.deepEqual([spit.range, spit.bonus, spit.defence, spit.damage], ["Ranged 10", 4, "fort", "1d6+2"]);
	});

	test("damage: notes in parentheses and a list of types are not the damage", () => {
		const attack = text => readAttack([{ label: "", text }]);
		assert.equal(attack("Close burst 1; +20 vs AC; (+21 while bloodied)1d10+12 damage (crit 2d12+22).").damage, "1d10+12");
		assert.equal(attack("Close blast 5; +20 vs Reflex; 4d10+12 acid, cold, fire, lightning, and poison damage, and the target is slowed.").damage, "4d10+12");
		assert.equal(attack("+4 vs AC; 4 psychic damage.").damage, "4");
		assert.equal(attack("+4 vs Will; the target is dominated (save ends).").damage, null);
		assert.equal(attack("+-2 vs Fortitude; ongoing 5 poison damage.").bonus, -2);
	});

	test("a heading with no name and nothing under it is dropped, and says so", () => {
		const html = oldMonster().html.replace("<p class='flavor alt'><b>Skills</b>", `<p class='flavor alt'>  (standard; encounter) </p><p class='flavor alt'><b>Skills</b>`);
		const m = parseMonster(oldMonster({ html }));
		assert.equal(m.powers.length, 3);
		assert.ok(m.notes.includes("empty-power"));
	});
});

describe("monster builder: values", () => {
	test("damage dice: the formula, the critical (dice at their maximum) and the plain numbers", () => {
		assert.deepEqual(damageOf("1d12+11"), { formula: "1d12 + 11", crit: "12 + 11", dice: { quantity: 1, die: 12 } });
		assert.deepEqual(damageOf("2d8+4"), { formula: "2d8 + 4", crit: "16 + 4", dice: { quantity: 2, die: 8 } });
		assert.deepEqual(damageOf("2d6"), { formula: "2d6", crit: "12", dice: { quantity: 2, die: 6 } });
		assert.deepEqual(damageOf("4"), { formula: "4", crit: "4", dice: null });
		assert.equal(damageOf("1d8+x"), null);
		assert.equal(damageOf(null), null);
	});

	test("senses, resistances, immunities and languages", () => {
		assert.deepEqual(sensesOf("Darkvision, tremorsense 5"), { basic: "dv", special: { ts: { value: true, range: 5 } }, custom: [] });
		assert.deepEqual(sensesOf("low-light vision").basic, "lv");
		assert.deepEqual(sensesOf("blindsight 10; see invisible"), { basic: "nv", special: { bs: { value: true, range: 10 } }, custom: ["see invisible"] });
		assert.deepEqual(resistancesOf("10 fire; 5 cold, insubstantial"), { typed: { fire: 10, cold: 5 }, other: ["insubstantial"] });
		assert.deepEqual(Object.keys(resistancesOf("5 all").typed).length > 10, true, "all covers every damage type of the system");
		assert.deepEqual(immunitiesOf("disease, poison; fear"), { types: ["poison"], other: ["disease", "fear"] });
		assert.deepEqual(languagesOf("Common, Deep Speech, Zorbish"), { spoken: ["Common", "DeepSpeech"], custom: ["Zorbish"] });
		assert.deepEqual(languagesOf("-"), { spoken: [], custom: [] });
	});
});

describe("monster builder: the actor", () => {
	const build = (entry = tableMonster()) => buildMonster(parseMonster(entry));

	test("the printed numbers are the values (advanced calculations off)", () => {
		const a = build();
		const s = a.system;
		assert.deepEqual([a.type, s.advancedCals], ["NPC", false]);
		assert.deepEqual([s.details.level, s.details.exp, s.details.size, s.details.origin, s.details.type, s.details.other], [5, 1000, "lg", "natural", "beast", "dragon"]);
		assert.deepEqual(s.details.role, { primary: "brute", secondary: "solo", leader: false });
		assert.deepEqual([s.attributes.hp.max, s.attributes.hp.value, s.attributes.init.base], [256, 256, 2]);
		assert.deepEqual(Object.fromEntries(Object.entries(s.defences).map(([k, v]) => [k, v.base])), { ac: 19, fort: 21, ref: 15, wil: 17 });
		assert.deepEqual([s.details.saves.untyped, s.actionpoints.value], [5, 2]);
		assert.deepEqual(a.prototypeToken, { name: "Marsh Brute", width: 2, height: 2 });
	});

	test("ability scores; a printed 0 is taken from the printed modifier", () => {
		const s = build().system;
		assert.deepEqual([s.abilities.str.value, s.abilities.dex.value, s.abilities.int.value], [14, 17, 12], "Int 0 (+1) -> 12");
	});

	test("skills: the printed ones, perception from the stats, the rest half the level plus the ability modifier", () => {
		const k = build().system.skills;
		assert.equal(k.stl.base, 9);
		assert.equal(k.thi.base, 7);
		assert.equal(k.prc.base, 9, "from the Perception line");
		assert.equal(k.ath.base, 2 + 2, "Str +2 and half of level 5");
		assert.equal(k.arc.base, 1 + 2, "Int 12 (+1)");
		assert.equal(Object.keys(k).length, 17);
	});

	test("speed modes, senses, languages, resistances, immunities", () => {
		const s = build().system;
		assert.deepEqual(s.movement, { base: { base: 6 }, fly: { formula: "8" }, swim: { formula: "6" } });
		assert.equal(s.senses.basic, "dv");
		assert.deepEqual(s.senses.special, { ts: { value: true, range: 5 } });
		assert.deepEqual(s.languages.spoken, { value: ["Common"], custom: "Zorbish" });
		assert.equal(s.resistances.fire.res, 10);
		assert.equal(s.resistances.radiant.vuln, -5);
		assert.equal(s.resistances.poison.immune, true);
		assert.deepEqual(s.untypedResistances.immunities, ["disease"]);
	});

	test("hit points of 0 (the page says something else) become 1 with a note; a conjured creature is flagged", () => {
		const a = build(tableMonster({ html: tableMonster().html.replace("<b>HP</b> 256; <b>Bloodied</b> 128", "<b>HP</b> 0; <b>Bloodied</b> 0 ; infinite") }));
		assert.equal(a.system.attributes.hp.max, 1);
		assert.ok(a.flags.dnd4e.import.review.includes("hp-special"));
		const c = build(tableMonster({ listing: { GroupRole: "Conjured" } }));
		assert.equal(c.system.details.role.secondary, "companion");
		assert.ok(c.flags.dnd4e.import.review.includes("conjured"));
	});

	test("a minion is noted", () => {
		const html = tableMonster().html.replace("<b>HP</b> 256; <b>Bloodied</b> 128", "<b>HP</b> 1; a missed attack never damages a minion.");
		assert.ok(build(tableMonster({ listing: { GroupRole: "Minion" }, html })).flags.dnd4e.import.review.includes("minion"));
	});
});

describe("monster builder: items", () => {
	const items = () => buildMonster(parseMonster(tableMonster())).items;
	const power = name => items().find(i => i.name === name);

	test("powers and traits, in order, powers first", () => {
		assert.deepEqual(items().map(i => [i.name, i.type]), [["Bite", "power"], ["Mud Breath", "power"], ["Bloodied Roar", "power"], ["Mud Skin", "feature"]]);
	});

	test("an attack is a printed bonus and printed damage", () => {
		const s = power("Bite").system;
		assert.deepEqual([s.attack.isAttack, s.attack.def, s.attack.formula, s.attack.ability], [true, "ac", "10", ""]);
		assert.deepEqual([s.hit.isDamage, s.hit.formula, s.hit.critFormula], [true, "1d12 + 8", "12 + 8"]);
		assert.deepEqual([s.useType, s.actionType, s.weaponType, s.powerType], ["atwill", "standard", "none", "other"]);
		assert.equal(s.damageType.poison, true);
		assert.deepEqual([s.rangeType, s.rangePower], ["reach", "2"]);
		assert.equal(s.miss.halfDamage, true);
	});

	test("an area power rolls its damage once; recharge keeps its numbers", () => {
		const m = power("Mud Breath");
		assert.deepEqual([m.system.rangeType, m.system.area, m.system.hit.shareDamageRoll, m.system.useType], ["closeBlast", "5", true, "recharge"]);
		assert.deepEqual(m.flags.dnd4e.import.recharge, [5, 6]);
		assert.match(m.system.description.value, /Recharge 5, 6/);
	});

	test("a power that is not an attack keeps its text: trigger and effect", () => {
		const s = power("Bloodied Roar").system;
		assert.deepEqual([s.attack.isAttack, s.hit.isDamage, s.trigger, s.effect.detail, s.actionType], [false, false, "The brute is first bloodied.", "The brute uses mud breath.", "free"]);
	});

	test("conditions, ongoing damage and penalties become effects, like the player powers", () => {
		const bite = power("Bite").effects;
		assert.deepEqual(bite.map(e => [e.name, e.statuses, e.system.durationType, e.system.powerEffectType]), [["Slowed", ["slowed"], "saveEnd", "hit"]]);
		const breath = power("Mud Breath").effects;
		// "until the end of the brute's next turn": the monster's own name is its user, so it is the end of the user's turn
		assert.deepEqual(breath.map(e => [e.name, e.system.durationType]), [["-2 penalty to attack rolls", "endOfUserTurn"]]);
		assert.deepEqual(breath[0].system.changes.map(c => c.key), ["power.attack.global.untyped"]);
	});

	test("old layout: a melee attack with no range gets reach 1 from its symbol", () => {
		const spear = buildMonster(parseMonster(oldMonster())).items.find(i => i.name === "Spear");
		assert.deepEqual([spear.system.rangeType, spear.system.rangeText, spear.system.attack.formula, spear.system.hit.formula], ["melee", "Melee 1", "6", "1d8"]);
		const spit = buildMonster(parseMonster(oldMonster())).items.find(i => i.name === "Spit");
		assert.deepEqual([spit.system.rangeType, spit.system.rangePower, spit.system.useType, spit.effects.map(e => e.name)], ["range", "10", "encounter", ["Dazed"]]);
	});

	test("a trait is a feature item of type trait; an aura keeps its size", () => {
		const t = items().find(i => i.type === "feature");
		assert.deepEqual([t.system.featureType, t.system.auraSize, t.system.featureSource], ["trait", "2", "Marsh Brute"]);
		assert.match(t.system.description.value, /difficult terrain/);
	});

	test("ids are stable, and differ from item to item", () => {
		const ids = () => buildMonster(parseMonster(tableMonster())).items.map(i => i._id);
		assert.deepEqual(ids(), ids());
		assert.equal(new Set(ids()).size, 4);
	});

	test("book text is escaped in the descriptions", () => {
		const html = tableMonster().html.replace("enemies treat the area as difficult terrain.", "enemies &lt;b&gt;treat&lt;/b&gt; the area &amp; more.");
		const t = buildMonster(parseMonster(tableMonster({ html }))).items.find(i => i.type === "feature");
		assert.match(t.system.description.value, /&lt;b&gt;treat&lt;\/b&gt; the area &amp; more\./);
	});
});

describe("monster validation", () => {
	const make = () => {
		const a = buildMonster(parseMonster(tableMonster()));
		return { a, row: indexRow(a, parseMonster(tableMonster()), "tst.json") };
	};

	test("a built monster is clean", () => {
		const { a, row } = make();
		assert.equal(validateMonsters([a], [row]).size, 0);
	});

	test("breaking one is caught", () => {
		const { a, row } = make();
		const bad = structuredClone(a);
		bad.system.details.size = "colossal"; bad.system.defences.ac.base = -1; bad.system.advancedCals = true; bad.system.senses.basic = "xray";
		bad.system.resistances.boom = { res: 5 }; bad.items[0].system.useType = "sometimes"; bad.items[0].system.hit.formula = "1d12 + x"; bad.items[0].system.weaponType = "melee";
		bad.items.push({ ...structuredClone(bad.items[0]), _id: bad.items[0]._id });
		const text = [...validateMonsters([bad], [row]).keys()].join("\n");
		for (const re of [/size: "colossal"/, /defence ac -1/, /advancedCals must be false/, /senses\.basic: "xray"/, /resistance type: "boom"/, /useType: "sometimes"/, /damage formula "1d12 \+ x"/, /must not ask for a weapon/, /duplicate item _id/]) assert.match(text, re);
	});
});

const here = path.dirname(fileURLToPath(import.meta.url));
const dbDir = path.join(here, "..", "out", "db");
const skip = existsSync(path.join(dbDir, "monster", "_index.json")) ? false : "monster database not built (out/db/monster)";

describe("real monster database", { skip }, () => {
	const load = async () => {
		const index = JSON.parse(await readFile(path.join(dbDir, "monster", "_index.json"), "utf8"));
		const actors = [];
		for (const f of new Set(index.map(r => r.file))) actors.push(...JSON.parse(await readFile(path.join(dbDir, "monster", f), "utf8")));
		return { index, actors };
	};

	test("every monster passes the static validation and has an index row", async () => {
		const { index, actors } = await load();
		assert.deepEqual([...validateMonsters(actors, index).keys()], []);
		assert.equal(actors.length, index.length);
		assert.ok(actors.length >= 5000);
	});

	test("the numbers read like the book: a monster's bloodied value is half its hit points", async () => {
		const parsed = JSON.parse(await readFile(path.join(here, "..", "out", "parsed", "monster.json"), "utf8"));
		const bad = parsed.filter(m => m.stats.hp && m.stats.bloodied !== null && m.stats.bloodied !== Math.floor(m.stats.hp / 2)).map(m => m.name);
		assert.ok(bad.length <= 3, bad.join(", "));
	});

	test("attack bonuses follow the level (a regression guard against a misread number)", async () => {
		const { actors } = await load();
		let n = 0, off = 0;
		for (const a of actors) for (const i of a.items) if (i.type === "power" && i.system.attack.isAttack) {
			n++;
			const d = Number(i.system.attack.formula) - a.system.details.level;
			if (d < -2 || d > 12) off++;
		}
		assert.ok(n > 10000);
		assert.ok(off / n < 0.01, `${off} of ${n} attacks are far from the monster's level`);
	});

	test("almost every attack has its damage, and every monster has something to do", async () => {
		const { actors } = await load();
		const idle = actors.filter(a => !a.items.length).map(a => a.name);
		assert.ok(idle.length <= 3, idle.join(", "));
		let attacks = 0, dmg = 0;
		for (const a of actors) for (const i of a.items) if (i.type === "power" && i.system.attack.isAttack) { attacks++; if (i.system.hit.isDamage) dmg++; }
		assert.ok(dmg / attacks > 0.85, `${dmg} of ${attacks}`);
	});

	test("a known monster reads like its stat block: the goblin cutter (a minion)", async () => {
		const { index, actors } = await load();
		const row = index.find(r => r.name === "Goblin Cutter");
		const a = actors.find(x => x._id === row._id);
		assert.deepEqual([a.system.details.level, a.system.details.role, a.system.attributes.hp.max, a.system.attributes.init.base], [1, { primary: "skirmisher", secondary: "minion", leader: false }, 1, 5]);
		assert.deepEqual(Object.fromEntries(Object.entries(a.system.defences).map(([k, v]) => [k, v.base])), { ac: 16, fort: 12, ref: 14, wil: 11 });
		const sword = a.items.find(i => i.name === "Short Sword");
		assert.deepEqual([sword.system.attack.formula, sword.system.hit.formula], ["5", "4"]);
		assert.equal(a.system.skills.stl.base, 5);
		assert.ok(a.flags.dnd4e.import.review.includes("minion"));
	});
});
