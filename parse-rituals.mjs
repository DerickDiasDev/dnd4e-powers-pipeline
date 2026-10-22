/**
 * Parses the raw rituals (out/ritual.json) into a clean intermediate schema (out/parsed/ritual.json).
 *
 * A ritual page has: the title, an optional flavour line, a stats block (component cost, market price, key skill, level,
 * category, time, duration) and the text, with result tables; the alchemical rituals also carry the pages of the item they make
 * (one per level). Nothing is invented: a field that does not parse stays null and the stats block is kept as printed.
 *
 * Usage: node parse-rituals.mjs [--in out/ritual.json] [--out out/parsed]
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { txt } from "./parse-powers.mjs";
import { parsePrice } from "./parse-gear.mjs";

/** Category printed -> CONFIG.DND4E.ritualTypes key. */
export const CATEGORY_KEYS = {
	binding: "binding", creation: "creation", deception: "deception", divination: "divination", exploration: "exploration",
	restoration: "restoration", scrying: "scrying", travel: "travel", teleportation: "travel", warding: "warding",
	"martial practice": "martial", curative: "curative", oil: "oil", poison: "poison", volatile: "volatile", other: "other",
};
/** Skill printed -> the sheet's skill key. */
export const SKILL_KEYS = {
	acrobatics: "acr", arcana: "arc", athletics: "ath", bluff: "blu", diplomacy: "dip", dungeoneering: "dun", endurance: "end", heal: "hea",
	history: "his", insight: "ins", intimidate: "itm", nature: "nat", perception: "prc", religion: "rel", stealth: "stl", streetwise: "stw", thievery: "thi",
};
const UNITS = { minute: "minute", minutes: "minute", hour: "hour", hours: "hour", day: "day", days: "day", round: "round", rounds: "round", month: "month", months: "month", year: "year", years: "year" };

/** "Arcana or Nature (no check)" -> { skills: ["arc", "nat"], noCheck: true } */
export function parseKeySkill(raw) {
	const text = String(raw ?? "");
	const skills = [...new Set([...text.matchAll(/[A-Za-z]+/g)].map(m => SKILL_KEYS[m[0].toLowerCase()]).filter(Boolean))];
	return { skills, noCheck: /no check/i.test(text) };
}

/** "30 minutes" / "1 hour" / "Standard action" -> { value, units } for the sheet's time units, or the printed text under `text`. */
export function parseTime(raw) {
	const text = String(raw ?? "").trim();
	const m = text.match(/^(\d+)\s+([a-z]+)/i);
	if (m && UNITS[m[2].toLowerCase()]) return { value: m[1], units: UNITS[m[2].toLowerCase()], text };
	if (/^instant/i.test(text)) return { value: null, units: "inst", text };
	if (/^permanent/i.test(text)) return { value: null, units: "perm", text };
	return { value: null, units: text ? "spec" : "", text };
}

/** A table as lines "a | b | c". */
const tableText = html => [...html.matchAll(/<tr>([\s\S]*?)(?=<tr>|$)/gi)]
	.map(row => [...row[1].matchAll(/<t[hd][^>]*>([\s\S]*?)(?=<t[hd]|<\/t[hd]>|$)/gi)].map(c => txt(c[1])).join(" | "))
	.filter(Boolean);

/** The text after the stats block: paragraphs, tables as lines, and the pages of the item an alchemical ritual makes. */
export function parseBody(html) {
	const rest = html.replace(/^[\s\S]*?<\/span>/i, "");
	const lines = [];
	// The stats block ends the first paragraph with its own lines (Level, Category, Time, Duration): they are read elsewhere.
	const blocks = rest.matchAll(/<table>([\s\S]*?)<\/table>|<h1 class=magicitem>([\s\S]*?)<\/h1>|<p[^>]*>([\s\S]*?)<\/p>/gi);
	let first = true;
	for (const b of blocks) {
		if (b[1] !== undefined) lines.push(...tableText(b[1]).map(text => ({ text, table: true })));
		else if (b[2] !== undefined) lines.push({ text: txt(b[2]), heading: true });
		else {
			let body = b[3];
			if (first) {
				// "<b>Level</b>: 1<br><b>Category</b>...<br><b>Duration</b>: 8 hours</p>" -> only what follows the last stat line
				body = body.replace(/^(?:\s*<b>(?:Level|Category|Time|Duration|Requirements?)<\/b>:[^<]*<br>)*\s*(?:<b>(?:Level|Category|Time|Duration)<\/b>:[^<]*)?/i, "");
				first = false;
			}
			for (const text of txt(body).split("\n")) if (text) lines.push({ text });
		}
	}
	return lines;
}

const sourcesOf = listing => String(listing.SourceBook ?? "").split(",").map(s => s.trim()).filter(Boolean);
const stat = (html, label) => html.match(new RegExp(`<b>${label}</b>:\\s*([^<]*)`, "i"))?.[1]?.trim() ?? null;

export function parseRitual(entry) {
	const html = entry.html.replace(/<p class=publishedIn>[\s\S]*$/i, "");
	const listing = entry.listing;
	const categoryText = stat(html, "Category");
	const key = CATEGORY_KEYS[String(categoryText ?? "").toLowerCase()];
	const keySkill = stat(html, "Key Skill");
	const sources = sourcesOf(listing);
	const notes = [];
	if (!key) notes.push("category-unknown");
	const skill = parseKeySkill(keySkill);
	if (!skill.skills.length) notes.push("skill-unknown");
	const level = Number(stat(html, "Level"));
	return {
		id: entry.id,
		name: txt(listing.Name),
		level: Number.isFinite(level) && stat(html, "Level") !== null ? level : null,
		category: key ?? "other", categoryText,
		keySkill, skills: skill.skills, noCheck: skill.noCheck,
		componentCost: stat(html, "Component Cost"),
		marketPrice: parsePrice(stat(html, "Market Price")), marketText: stat(html, "Market Price"),
		time: parseTime(stat(html, "Time")),
		duration: parseTime(stat(html, "Duration")),
		flavor: txt(html.match(/<\/h1>\s*<i>([\s\S]*?)<\/i>/i)?.[1] ?? ""),
		body: parseBody(html),
		sources, sourceCode: sources[0] ?? null,
		published: txt(entry.html.match(/<p class=publishedIn>([\s\S]*?)<\/p>/i)?.[1] ?? ""),
		notes,
	};
}

async function main() {
	const argv = process.argv.slice(2);
	const flag = (name, fallback) => (argv.includes(`--${name}`) ? argv[argv.indexOf(`--${name}`) + 1] : fallback);
	const here = path.dirname(fileURLToPath(import.meta.url));
	const input = path.resolve(here, flag("in", "out/ritual.json"));
	const outDir = path.resolve(here, flag("out", "out/parsed"));
	const parsed = JSON.parse(await readFile(input, "utf8")).map(parseRitual);
	await mkdir(outDir, { recursive: true });
	await writeFile(path.join(outDir, "ritual.json"), JSON.stringify(parsed));
	const byCategory = {};
	for (const r of parsed) byCategory[r.category] = (byCategory[r.category] ?? 0) + 1;
	const notes = {};
	for (const r of parsed) for (const n of r.notes) notes[n] = (notes[n] ?? 0) + 1;
	console.log(`Rituals: ${parsed.length}`, byCategory, "notes:", notes);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
