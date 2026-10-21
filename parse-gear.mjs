/**
 * Parses the raw mundane equipment (out/weapon.json, armor.json, implement.json) into a clean intermediate schema
 * (out/parsed/gear.json). Only `Rarity: Mundane` entries: the magic ones (enhancement levels, properties, powers) are a
 * separate stage.
 *
 * Kinds produced: `weapon` (the weapon tables), `armor` (armour, shields, barding), `implement` (the nonmagical and the
 * superior implements) and `ammo` (ammunition, listed with the weapons). Nothing is invented: a field that is not
 * printed stays null, and a printed property or group the system has no key for is kept by name.
 *
 * Usage: node parse-gear.mjs [--in out] [--out out/parsed]
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { txt } from "./parse-powers.mjs";

/** Price in gold pieces from "15 gp", ".2 gp", "5 cp", "3 sp", "1 pp". */
export function parsePrice(raw) {
	const m = String(raw ?? "").match(/([\d,]*\.?\d+)\s*(pp|gp|sp|cp|ad)\b/i);
	if (!m) return null;
	const unit = { pp: 100, gp: 1, sp: 0.1, cp: 0.01, ad: 1 }[m[2].toLowerCase()];
	return Math.round(Number(m[1].replace(/,/g, "")) * unit * 100) / 100;
}

export const parseWeight = raw => {
	const m = String(raw ?? "").match(/([\d,]*\.?\d+)\s*lb/i);
	return m ? Number(m[1].replace(/,/g, "")) : null;
};

const signed = raw => {
	const m = String(raw ?? "").match(/([+-])\s*(\d+)/);
	return m ? Number(m[1] + m[2]) : null;
};

/** The text of a `<b>Label</b>: value` field, up to the next tag break. */
const field = (html, label) => {
	const m = html.match(new RegExp(`<b>\\s*${label}\\s*:?\\s*</b>\\s*:?\\s*([^<]*)`, "i"));
	return m ? m[1].trim() : null;
};

/** A line printed without bold ("Cost: 15 gp", "Weight: 4 lb.", "Range: 20/40", "Proficient: +2"). */
const plain = (html, label) => {
	const m = html.match(new RegExp(`(?:^|<br>|</b>)\\s*${label}\\s*:\\s*([^<]*)`, "i"));
	return m ? m[1].trim() : null;
};

/** Splits off the "Published in ..." paragraph. */
function splitPublished(html) {
	const m = html.match(/<p class=publishedIn>([\s\S]*?)<\/p>/i);
	return { body: html.replace(/<p class=publishedIn>[\s\S]*?<\/p>/i, ""), published: m ? txt(m[1]) : "" };
}

/**
 * The names under a "Properties" or "Group" heading. Each is `Name (<i>rules text</i>).`; the rules text is returned
 * too, because for a property the system has no switch for (Accurate, Unerring...) it is the only place the rule is.
 */
export function listBlock(body, heading) {
	const m = body.match(new RegExp(`<b>\\s*${heading}\\s*:?\\s*</b>\\s*:?\\s*<br>([\\s\\S]*?)(?=<br>\\s*<b>|$)`, "i"));
	if (!m) return [];
	const out = [];
	// The rules text can contain line breaks of its own: they must not split the entry.
	const flat = m[1].replace(/<i>[\s\S]*?<\/i>/gi, i => i.replace(/<br\s*\/?>/gi, " "));
	for (const raw of flat.split(/<br>/i)) {
		const line = raw.trim();
		if (!line) continue;
		const text = line.match(/<i>([\s\S]*?)<\/i>/i)?.[1];
		const name = txt(line.replace(/<i>[\s\S]*?<\/i>/gi, "")).replace(/\(\s*\)/g, "").replace(/[\s.]+$/, "").trim();
		if (name) out.push({ name, text: text ? txt(text) : "" });
	}
	return out;
}

/** "Simple one-handed melee weapon" / "Superior double melee weapon" / "Superior two-handed weapon" / "Superior ". */
export function parseWeaponHeader(line) {
	const t = txt(line ?? "");
	const m = t.match(/^(Simple|Military|Superior|Improvised)\b\s*(one-handed|two-handed|double)?\s*(melee|ranged)?/i);
	if (!m) return null;
	return { category: m[1].toLowerCase(), hands: m[2]?.toLowerCase().replace("-handed", "") ?? null, reach: m[3]?.toLowerCase() ?? null };
}

/** "20/40" -> [20, 40]; "-" or missing -> null. */
export function parseRange(raw) {
	const m = String(raw ?? "").match(/(\d+)\s*\/\s*(\d+)/);
	return m ? [Number(m[1]), Number(m[2])] : null;
}

const sourcesOf = listing => String(listing.SourceBook ?? "").split(",").map(s => s.trim()).filter(Boolean);

const common = (entry, kind, published) => {
	const sources = sourcesOf(entry.listing);
	// "Masterwork", "Pact Weapon"; the improvised weapons and the adventuring gear print none, and are as mundane as the rest.
	return { id: entry.id, name: txt(entry.listing.Name), kind, sources, sourceCode: sources[0] ?? null, published, rarity: entry.listing.Rarity || "Mundane" };
};

/** The free text between the stats and the "Properties" heading, which the compendium prints as a flavour paragraph. */
function flavour(body) {
	const cut = body.split(/<b>\s*(?:Properties|Group)\s*:?\s*<\/b>/i)[0];
	const parts = cut.split(/<br>\s*<br>/i).slice(1);
	const stat = /^(?:cost|damage|proficient|range|weight)\s*:/i;
	return parts.map(txt).map(p => p.split("\n").filter(l => !stat.test(l.trim())).join("\n")).filter(Boolean).join("\n");
}

export function parseWeapon(entry) {
	const { body, published } = splitPublished(entry.html);
	const lines = body.split(/<br>/i);
	if (/<b>\s*Category\s*<\/b>:\s*Ammunition/i.test(body)) return parseAmmo(entry, body, published);
	const head = parseWeaponHeader(lines[1]);
	const notes = [];
	if (!head) notes.push("weapon-header-unparsed");
	const damage = field(body, "Damage");
	const dice = damage?.match(/^(\d+)d(\d+)$/i);
	const range = parseRange(plain(body, "Range"));
	return {
		...common(entry, "weapon", published),
		category: head?.category ?? null,
		hands: head?.hands ?? null,
		reach: head?.reach ?? (range ? "ranged" : "melee"),
		price: parsePrice(plain(body, "Cost")),
		weight: parseWeight(plain(body, "Weight")),
		damage: dice ? { dice: Number(dice[1]), faces: Number(dice[2]) } : null,
		damageText: damage,
		proficiency: signed(plain(body, "Proficient")),
		range,
		properties: listBlock(body, "Properties"),
		groups: listBlock(body, "Group").map(g => g.name),
		description: flavour(body),
		notes,
	};
}

function parseAmmo(entry, body, published) {
	return {
		...common(entry, "ammo", published),
		// "Arrows (30)": the listing calls it "Arrows", the page says how many come in the quiver.
		quantity: Number(txt(body.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? "").match(/\((\d+)\)\s*$/)?.[1] ?? 1),
		price: parsePrice(field(body, "Price")),
		weight: parseWeight(field(body, "Weight")),
		description: txt(field(body, "Description") ?? body.match(/<b>\s*Description\s*<\/b>:\s*([\s\S]*)$/i)?.[1] ?? ""),
		notes: [],
	};
}

export function parseArmor(entry) {
	const { body, published } = splitPublished(entry.html);
	const type = txt(entry.listing.Type);
	const shield = /shield/i.test(type) || /<b>\s*Shield Bonus/i.test(body);
	const barding = /barding/i.test(type);
	const description = txt(field(body, "Description") ?? body.match(/<b>\s*Description\s*<\/b>:\s*([\s\S]*?)(?=<b>)/i)?.[1] ?? "");
	return {
		...common(entry, "armor", published),
		armorType: type,
		form: shield ? "shield" : barding ? "barding" : "armor",
		// Cloth armour prints no AC bonus at all: it is 0, and the entry says it grants its bonus only as a magic item.
		bonus: signed(field(body, shield ? "Shield Bonus" : "AC Bonus")) ?? 0,
		check: signed(field(body, "Check")),
		speed: signed(field(body, "Speed")),
		weight: parseWeight(field(body, "Weight")),
		price: parsePrice(field(body, "Cost")),
		special: field(body, "Special"),
		// Masterwork armour is made with at least this enhancement bonus.
		minEnhancement: signed(field(body, "Minimum Enhancement Value")),
		description,
		notes: [],
	};
}

export function parseImplement(entry) {
	const { body, published } = splitPublished(entry.html);
	const gear = /<b>\s*Category\s*<\/b>:\s*Gear/i.test(body);
	const type = txt(entry.listing.Type);
	if (gear) {
		return {
			...common(entry, "implement", published),
			implementType: type, superior: false,
			price: parsePrice(field(body, "Price")),
			weight: parseWeight(field(body, "Weight")),
			range: null, proficiency: null, properties: [], groups: [],
			description: txt(field(body, "Description") ?? ""),
			notes: [],
		};
	}
	const head = parseWeaponHeader(body.split(/<br>/i)[1]);
	return {
		...common(entry, "implement", published),
		implementType: type, superior: Boolean(head),
		price: parsePrice(plain(body, "Cost")),
		weight: parseWeight(plain(body, "Weight")),
		range: parseRange(plain(body, "Range")),
		proficiency: signed(plain(body, "Proficient")),
		properties: listBlock(body, "Properties"),
		groups: listBlock(body, "Group").map(g => g.name),
		description: flavour(body),
		notes: head ? [] : ["implement-header-unparsed"],
	};
}

/** The adventuring gear of the item table: gear, mounts, vehicles, instruments, food, services and buildings. */
export function parseItem(entry) {
	const { body, published } = splitPublished(entry.html);
	const type = txt(entry.listing.Type);
	const heading = txt(body.match(/<h1 class=player>([\s\S]*?)<\/h1>/i)?.[1] ?? "");
	const category = txt(entry.listing.Category);
	const description = field(body, "Description") === null
		// A mount has no description line: the stat block of the creature follows the price.
		? txt(body.split(/<br>\s*<br>/i).slice(1).join("\n"))
		: txt(body.match(/<b>\s*Description\s*<\/b>\s*:?\s*([\s\S]*)$/i)[1]);
	const base = {
		...common(entry, type === "Ammunition" ? "ammo" : "item", published),
		price: parsePrice(field(body, "Price")) ?? parsePrice(entry.listing.Cost),
		weight: parseWeight(field(body, "Weight")),
		description, notes: [],
	};
	if (type === "Ammunition") return { ...base, quantity: Number(heading.match(/\((\d+)\)\s*$/)?.[1] ?? 1) };
	return { ...base, itemType: category === "Lair" ? "Building" : type || "Gear", mount: type === "Mount" };
}

export const isMundane = entry => entry.listing.Rarity === "Mundane";
/** Everything that is not a magic page: the mundane entries, masterwork armour, pact and improvised weapons, gear. */
export const isPlain = entry => !/<h1 class=mihead/i.test(entry.html);

async function main() {
	const argv = process.argv.slice(2);
	const flag = (name, fallback) => (argv.includes(`--${name}`) ? argv[argv.indexOf(`--${name}`) + 1] : fallback);
	const here = path.dirname(fileURLToPath(import.meta.url));
	const inDir = path.resolve(here, flag("in", "out"));
	const outDir = path.resolve(here, flag("out", "out/parsed"));
	const load = async name => JSON.parse(await readFile(path.join(inDir, `${name}.json`), "utf8")).filter(isPlain);
	const parsed = [
		...(await load("weapon")).map(parseWeapon),
		...(await load("armor")).map(parseArmor),
		...(await load("implement")).map(parseImplement),
		...(await load("item")).map(parseItem),
	];
	await mkdir(outDir, { recursive: true });
	await writeFile(path.join(outDir, "gear.json"), JSON.stringify(parsed));
	const byKind = {};
	for (const g of parsed) byKind[g.kind] = (byKind[g.kind] ?? 0) + 1;
	const notes = {};
	for (const g of parsed) for (const n of g.notes) notes[n] = (notes[n] ?? 0) + 1;
	console.log(`Gear: ${parsed.length} entries`, byKind, "notes:", notes);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
