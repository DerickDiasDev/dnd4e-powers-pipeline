/**
 * Synthetic power entries in the same HTML shape as the compendium data, with invented names and text.
 * Nothing here is book content, so this file is safe to commit.
 */

const CSS = { "At-Will": "atwillpower", Encounter: "encounterpower", Daily: "dailypower" };

const bold = list => list.map(k => `<b>${k}</b>`).join(", ");
const para = ([label, text]) => `<p class=powerstat><b>${label}</b>: ${text}</p>`;

/** One section: header (usage, keywords, action, range) plus labelled blocks. */
function section({ usage, keywords, action, range, blocks }) {
	const head = `<p class=powerstat><b>${usage}</b>   ✦     ${bold(keywords)}<br><b>${action}</b>      ${range}</p>`;
	return head + blocks.map(para).join("");
}

/**
 * @param {string} id
 * @param {object} o
 * @returns {{id: string, listing: object, html: string}}
 */
export function entry(id, o) {
	const {
		name, cls = "Fighter", level = 1, kind = "Attack", usage = "At-Will", keywords = ["Martial", "Weapon"],
		action = "Standard Action", range = "<b>Melee</b> weapon", blocks = [], children = [], source = "TST", flavor = "Invented flavor text.",
	} = o;
	const html = `<h1 class=${CSS[usage]}>${name}<span class=level>${cls} ${kind} ${level}</span></h1>`
		+ `<p class=flavor><i>${flavor}</i></p>`
		+ section({ usage, keywords, action, range, blocks })
		+ children.map(c => `<h1 class=${CSS[c.usage ?? usage]}>${c.name}</h1>` + section({ usage: c.usage ?? usage, keywords: c.keywords ?? keywords, action: c.action ?? action, range: c.range ?? range, blocks: c.blocks })).join("")
		+ `<p class=publishedIn>Published in Test Book, page(s) 7.</p>`;
	const typeLabel = { "At-Will": "At-Will", Encounter: "Enc.", Daily: "Daily" }[usage];
	return {
		id,
		listing: { ID: id, Name: name, ClassName: cls, Level: String(level), Type: `${typeLabel} ${kind}`, Action: action.replace(" Action", ""), Keywords: keywords.join(", "), SourceBook: source },
		html,
	};
}

export const CATEGORIES = new Map([["fighter", "class"], ["wizard", "class"]]);

export const FIXTURES = {
	weaponBasic: entry("t-weapon", {
		name: "Test Strike",
		blocks: [["Target", "One creature"], ["Attack", "Strength vs. AC"], ["Hit", "2[W] + Strength modifier damage."]],
	}),

	implementDice: entry("t-implement", {
		name: "Test Bolt", cls: "Wizard", usage: "Daily", keywords: ["Arcane", "Fire", "Implement"], range: "<b>Ranged</b> 10",
		blocks: [["Target", "One creature"], ["Attack", "Intelligence vs. Reflex"], ["Hit", "3d6 + Wisdom modifier fire damage."]],
	}),

	// Attack and damage differ between melee and ranged -> two items
	meleeRangedSplit: entry("t-split", {
		name: "Test Volley", range: "<b>Melee or Ranged</b> weapon",
		blocks: [
			["Target", "One creature"],
			["Attack", "Strength vs. AC (melee) or Dexterity vs. AC (ranged)"],
			["Hit", "1[W] + Strength modifier damage (melee) or 1[W] + Dexterity modifier damage (ranged), and the target is dazed (save ends)."],
		],
	}),

	// Same numbers for both -> one item that accepts either weapon
	meleeRangedSame: entry("t-same", {
		name: "Test Flexible Shot", range: "<b>Melee or Ranged</b> weapon",
		blocks: [["Target", "One creature"], ["Attack", "Dexterity vs. AC"], ["Hit", "1[W] + Dexterity modifier damage."]],
	}),

	// The second half of the damage drops the dice: "Dexterity modifier damage (ranged)" shares the 2[W] of the first half
	sharedDiceSplit: entry("t-shared-dice", {
		name: "Test Shared Dice", range: "<b>Melee or Ranged</b> weapon",
		blocks: [["Target", "One creature"], ["Attack", "Strength vs. AC (melee) or Dexterity vs. AC (ranged)"], ["Hit", "2[W] + Strength modifier damage (melee) or Dexterity modifier damage (ranged)."]],
	}),

	closeBurst: entry("t-close", {
		name: "Test Shockwave", cls: "Wizard", usage: "Encounter", keywords: ["Arcane", "Thunder", "Implement"], range: "<b>Close</b> burst 2",
		blocks: [["Target", "Each enemy in the burst"], ["Attack", "Intelligence vs. Fortitude"], ["Hit", "2d6 + Intelligence modifier thunder damage."], ["Miss", "Half damage."]],
	}),

	areaBurst: entry("t-area", {
		name: "Test Fireball", cls: "Wizard", usage: "Daily", keywords: ["Arcane", "Fire", "Implement"], range: "<b>Area</b> burst 1 within 10 squares",
		blocks: [["Target", "Each creature in the burst"], ["Attack", "Intelligence vs. Reflex"], ["Hit", "3d6 + Intelligence modifier fire damage."]],
	}),

	areaOrigin: entry("t-area-origin", {
		name: "Test Weapon Burst", usage: "Encounter", range: "<b>Area</b> burst 1 within weapon range",
		blocks: [["Target", "Each enemy in the burst"], ["Attack", "Strength vs. Reflex"], ["Hit", "1[W] + Strength modifier damage."]],
	}),

	// "damage" without a type, but the power has the Psychic keyword: the keyword gives the type
	keywordType: entry("t-keyword-type", {
		name: "Test Mind Spike", cls: "Wizard", keywords: ["Arcane", "Psychic", "Implement"], range: "<b>Ranged</b> 10",
		blocks: [["Target", "One creature"], ["Attack", "Intelligence vs. Will"], ["Hit", "2d8 + Intelligence modifier damage."]],
	}),

	// Damage the user takes is not the power's damage roll
	selfDamage: entry("t-self", {
		name: "Test Blood Price", cls: "Wizard", kind: "Utility", usage: "Daily", keywords: ["Arcane", "Necrotic"], range: "<b>Ranged</b> 5",
		blocks: [["Target", "One creature"], ["Effect", "You take 5 damage, and the target takes 2d8 + Wisdom modifier necrotic damage."]],
	}),

	resistAll: entry("t-resist", {
		name: "Test Ward", kind: "Utility", usage: "Encounter", keywords: ["Martial"], action: "Minor Action", range: "<b>Personal</b>",
		blocks: [["Effect", "You gain resist 5 to all damage until the end of your next turn."]],
	}),

	durations: entry("t-durations", {
		name: "Test Hex", cls: "Wizard", keywords: ["Arcane", "Implement"], range: "<b>Ranged</b> 10",
		blocks: [
			["Target", "One creature"], ["Attack", "Intelligence vs. Will"],
			["Hit", "The target is dazed until the end of the target's next turn. The target is slowed and weakened (save ends both). You mark the target until the start of your next turn."],
		],
	}),

	secondary: entry("t-secondary", {
		name: "Test Chain", cls: "Wizard", usage: "Encounter", keywords: ["Arcane", "Implement"], range: "<b>Ranged</b> 10",
		blocks: [
			["Primary Target", "One creature"], ["Primary Attack", "Intelligence vs. Reflex"], ["Hit", "1d8 + Intelligence modifier damage. Make a secondary attack."],
			["Secondary Target", "Each creature adjacent to the primary target"], ["Secondary Attack", "Intelligence vs. Reflex"], ["Hit", "1d6 damage."],
		],
	}),

	childPower: entry("t-child", {
		name: "Test Stance Form", kind: "Utility", usage: "Daily", keywords: ["Martial", "Stance"], action: "Minor Action", range: "<b>Personal</b>",
		blocks: [["Effect", "You enter the stance."]],
		children: [{ name: "Test Stance Attack", usage: "Encounter", action: "Standard Action", range: "<b>Melee</b> weapon", keywords: ["Martial", "Weapon"], blocks: [["Target", "One creature"], ["Attack", "Strength vs. AC"], ["Hit", "2[W] + Strength modifier damage."]] }],
	}),

	hitVariants: entry("t-variants", {
		name: "Test Prism", cls: "Wizard", usage: "Daily", keywords: ["Arcane", "Fire", "Implement"], range: "<b>Close</b> blast 4",
		blocks: [
			["Target", "Each enemy in the blast"], ["Attack", "Intelligence vs. Fortitude, Reflex, and Will. You make a single attack roll and use it against each defense."],
			["Hit (Fortitude)", "The target is slowed (save ends)."], ["Hit (Reflex)", "2d6 + Intelligence modifier fire damage."], ["Hit (Will)", "The target is stunned (save ends)."],
		],
	}),

	attackProse: entry("t-prose", {
		name: "Test Ally Strike", blocks: [["Target", "One creature"], ["Attack", "An ally of your choice can make a basic attack against the target."], ["Effect", "The ally gains a +2 bonus to the damage roll."]],
	}),

	scaling: entry("t-scaling", {
		name: "Test Scaling", keywords: ["Martial"], range: "<b>Melee</b> touch",
		blocks: [["Target", "One creature"], ["Attack", "Dexterity vs. Reflex"], ["Hit", "1d6 + Dexterity modifier damage.<br>Level 21: 2d6 + Dexterity modifier damage."]],
	}),

	fixedBonus: entry("t-bonus", {
		name: "Test Precise Strike", blocks: [["Target", "One creature"], ["Attack", "Strength + 2 vs. AC"], ["Hit", "1[W] + Strength modifier damage."]],
	}),

	ongoing: entry("t-ongoing", {
		name: "Test Burn", cls: "Wizard", keywords: ["Arcane", "Fire", "Implement"], range: "<b>Ranged</b> 10",
		blocks: [["Target", "One creature"], ["Attack", "Intelligence vs. Reflex"], ["Hit", "1d6 + Intelligence modifier fire damage, and ongoing 5 fire damage (save ends)."]],
	}),

	unknownLabel: entry("t-label", {
		name: "Test Pact Power", blocks: [["Target", "One creature"], ["Attack", "Strength vs. AC"], ["Hit", "1[W] + Strength modifier damage."], ["Mystic Pact", "Invented class feature text."]],
	}),

	typo: entry("t-typo", {
		name: "Test Typo", blocks: [["Target", "One creature"], ["Attack", "Strength vs. Relfex"], ["Hit", "1[W] + Strength modifier damage."]],
	}),

	// [W] damage on a power whose header has no Weapon keyword: it still needs a weapon
	weaponWithoutKeyword: entry("t-no-kw", {
		name: "Test Stance Strike", keywords: ["Martial", "Stance"],
		blocks: [["Target", "One creature"], ["Attack", "Strength vs. AC"], ["Hit", "1[W] + Strength modifier damage."]],
	}),

	// "Highest ability": the largest of all six, only the mental three (Int/Wis/Cha), or only the physical three (Str/Dex/Con)
	highestAll: entry("t-high-all", {
		name: "Test Highest", blocks: [["Target", "One creature"], ["Attack", "Your highest ability modifier vs. Will"], ["Hit", "2[W] + your highest ability modifier damage."]],
	}),
	highestMental: entry("t-high-mental", {
		name: "Test Mind Over", cls: "Wizard", keywords: ["Arcane", "Implement"], range: "<b>Ranged</b> 10",
		blocks: [["Target", "One creature"], ["Attack", "Highest mental ability vs. Will"], ["Hit", "2d6 + your highest mental ability modifier damage."]],
	}),
	highestPhysical: entry("t-high-physical", {
		name: "Test Brawn Over", blocks: [["Target", "One creature"], ["Attack", "Highest physical ability + 2 vs. AC"], ["Hit", "1[W] + highest physical ability modifier damage."]],
	}),

	// "Primary ability": the ability the character picked on the Details tab (@primaryMod). A bare "ability modifier" in the
	// damage of such a power means the same ability.
	primaryAttack: entry("t-primary", {
		name: "Test Primal Gift", usage: "Encounter",
		blocks: [["Target", "One creature"], ["Attack", "Primary ability + 6 vs. Reflex"], ["Hit", "2[W] + ability modifier damage."]],
	}),
	primaryNamed: entry("t-primary-named", {
		name: "Test Primal Gift Named", usage: "Encounter",
		blocks: [["Target", "One creature"], ["Attack", "Primary ability vs. Will"], ["Hit", "1[W] + primary ability modifier damage."]],
	}),
	// A bare "ability modifier" with a normal attack is ambiguous: kept as a review note, not guessed
	abilityAmbiguous: entry("t-ability-ambiguous", {
		name: "Test Ambiguous", usage: "Encounter",
		blocks: [["Target", "One creature"], ["Attack", "Strength vs. AC"], ["Hit", "1[W] + ability modifier damage."]],
	}),

	// The player chooses the ability: one version per ability. Attack and damage choose the same set ...
	choiceLinked: entry("t-choice-linked", {
		name: "Test Pick", blocks: [["Target", "One creature"], ["Attack", "Strength or Wisdom vs. AC"], ["Hit", "1[W] + Strength or Wisdom modifier damage."]],
	}),
	// ... or only the attack chooses (the damage modifier is fixed) ...
	choiceAttackOnly: entry("t-choice-attack", {
		name: "Test Mind Pick", cls: "Wizard", keywords: ["Arcane", "Implement"], range: "<b>Ranged</b> 10",
		blocks: [["Target", "One creature"], ["Attack", "Intelligence, Wisdom, or Charisma vs. Will"], ["Hit", "2d6 + Strength modifier damage."]],
	}),
	// ... or only the damage chooses (the attack is fixed)
	choiceDamageOnly: entry("t-choice-damage", {
		name: "Test Damage Pick", blocks: [["Target", "One creature"], ["Attack", "Strength vs. AC"], ["Hit", "2[W] + Strength, Dexterity, or Constitution damage."]],
	}),
	// A melee/ranged power where only the melee side lets the player choose
	choiceAndSplit: entry("t-choice-split", {
		name: "Test Both", range: "<b>Melee or Ranged</b> weapon",
		blocks: [
			["Target", "One creature"],
			["Attack", "Strength or Dexterity vs. AC (melee) or Dexterity vs. AC (ranged)"],
			["Hit", "1[W] + Strength or Dexterity modifier damage (melee) or 1[W] + Dexterity modifier damage (ranged)."],
		],
	}),

	bareAbility: entry("t-bare", {
		name: "Test Bare", keywords: ["Martial", "Weapon"],
		blocks: [["Target", "One creature"], ["Attack", "Strength vs. AC"], ["Hit", "2[W] + Strength damage."]],
	}),
};
