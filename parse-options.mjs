/**
 * Parses the raw HTML of the "character option" categories into one clean intermediate schema (out/parsed/option-<kind>.json):
 * feats, paragon paths, epic destinies, themes and backgrounds.
 *
 * Every option has a name, a prerequisite, its books and some text. What is specific:
 *   feat        tier, category (the bracket in the title: "[Multiclass Fighter]"), and the labelled lines (Benefit, Special, ...)
 *   path/destiny/theme   the quote, the prose, and the features by level ("Second Step (11th level): ...")
 *   background  type and campaign setting, and the benefit
 * Powers printed inside a page (path and theme powers, powers a feat gives) are NOT parsed: they are in the power database,
 * only their names are kept so the builder can link them.
 *
 * Usage: node parse-options.mjs [--out out/parsed]   (reads out/feat.json, paragonpath.json, epicdestiny.json, theme.json, background.json)
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { txt } from "./parse-powers.mjs";

export const KINDS = {
	feat: { file: "feat.json" },
	path: { file: "paragonpath.json" },
	destiny: { file: "epicdestiny.json" },
	theme: { file: "theme.json" },
	background: { file: "background.json" },
};

const POWER_CARD = /<h1 class=\w*power>([^<]*)(?:<span class=level>|<\/h1>)/gi;
const sourcesOf = listing => String(listing.SourceBook ?? "").split(",").map(s => s.trim()).filter(Boolean);
const quoteOf = html => txt(html.match(/<\/h1>\s*<p>\s*<i>([\s\S]*?)<\/i>\s*<\/p>/i)?.[1] ?? "");
const powersIn = html => [...new Set([...html.matchAll(POWER_CARD)].map(m => txt(m[1])).filter(n => n && !/ Secondary Power$/i.test(n)))];
const cutAtCards = html => { const i = html.search(/<h1 class=\w*power>/i); return i >= 0 ? html.slice(0, i) : html; };
const cutAtPublished = html => html.replace(/<p class=publishedIn>[\s\S]*$/i, "");

function base(kind, entry) {
	const listing = entry.listing ?? {};
	const sources = sourcesOf(listing);
	return { kind, id: entry.id, name: listing.Name ?? "", sources, sourceCode: sources[0] ?? null, prerequisite: listing.Prerequisite ?? "", quality: "complete", notes: [] };
}

/* -------------------------------------------- */
/*  Feats                                       */
/* -------------------------------------------- */

export function parseFeat(entry) {
	const feat = { ...base("feat", entry), tier: entry.listing?.Tier ?? null, category: null, sections: [] };
	const html = entry.html ?? "";
	const title = txt(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? feat.name);
	const bracket = title.match(/^(.*?)\s*\[([^\]]+)\]\s*$/);
	if (bracket) { feat.name = bracket[1]; feat.category = bracket[2]; }
	const block = html.match(/<p class=flavor>([\s\S]*?)<\/p>/i)?.[1] ?? "";
	for (const part of block.split(/<br\s*\/?>/i)) {
		const m = part.match(/^\s*<b>\s*([^<]*?)\s*:?\s*<\/b>\s*:?\s*([\s\S]*)$/i);
		if (!m || !m[1]) continue;
		const label = m[1].trim(), text = txt(m[2]);
		const tier = label.match(/^(Heroic|Paragon|Epic) Tier$/i);
		if (tier) feat.tier = feat.tier ?? tier[1];
		else if (/^prerequisite$/i.test(label)) feat.prerequisite = text || feat.prerequisite;
		else feat.sections.push({ label, text });
	}
	feat.powerNames = powersIn(html);
	if (!feat.sections.length) { feat.quality = "partial"; feat.notes.push("no-benefit"); }
	return feat;
}

/* -------------------------------------------- */
/*  Paths, destinies, themes                    */
/* -------------------------------------------- */

/** "Second Step (11th level): text" lines, with continuation lines joined to the previous feature. */
function parseLeveledFeatures(region) {
	const features = [];
	for (const line of region.split(/<br\s*\/?>/i)) {
		const m = line.match(/^\s*<b>\s*([^<]*?)\s*\((\d+)(?:st|nd|rd|th) level\)\s*<\/b>\s*:?\s*([\s\S]*)$/i);
		if (m) { features.push({ name: m[1].trim(), level: Number(m[2]), text: txt(m[3]) }); continue; }
		const more = txt(line);
		if (more && features.length) features.at(-1).text += `\n${more}`;
	}
	return features;
}

export function parsePath(kind, entry) {
	const option = { ...base(kind, entry), quote: quoteOf(entry.html ?? ""), prose: [], features: [], powerNames: [] };
	const html = cutAtPublished(entry.html ?? "");
	option.powerNames = powersIn(html);
	const pre = html.match(/<b>\s*Prerequisite:?\s*<\/b>\s*([^<]*)/i)?.[1];
	if (pre) option.prerequisite = txt(pre) || option.prerequisite;

	const heading = html.match(/<h3>[^<]*FEATURES<\/h3>/i);
	const head = heading ? html.slice(0, heading.index) : cutAtCards(html);
	const prose = txt(head.replace(/^[\s\S]*?<\/h1>/i, "").replace(/<p><i>[\s\S]*?<\/i><\/p>/i, "").replace(/<b>\s*Prerequisite:?\s*<\/b>[^<]*(?:<br>)?/i, ""));
	option.prose = prose ? [{ heading: "", text: prose }] : [];
	if (heading) option.features = parseLeveledFeatures(cutAtCards(html.slice(heading.index + heading[0].length)));
	else if (kind !== "theme") { option.quality = "partial"; option.notes.push("no-features"); } // a theme is its powers: no features list
	return option;
}

/* -------------------------------------------- */
/*  Backgrounds                                 */
/* -------------------------------------------- */

export function parseBackground(entry) {
	const listing = entry.listing ?? {};
	const html = cutAtPublished(entry.html ?? "");
	const bg = { ...base("background", entry), type: listing.Type || null, campaign: listing.Campaign || null, intro: txt(html.match(/<\/h1>\s*<p>\s*<i>([\s\S]*?)<\/i>\s*<\/p>/i)?.[1] ?? ""), prose: [], benefit: "" };
	const benefitHtml = html.match(/<i>\s*Benefit:?\s*<\/i>\s*([\s\S]*?)(?:<br>|$)/i)?.[1];
	bg.benefit = txt(benefitHtml ?? "") || String(listing.Benefit ?? "").trim();
	const body = html.replace(/^[\s\S]*?<\/h1>/i, "").replace(/<p>\s*<i>[\s\S]*?<\/i>\s*<\/p>/i, "").replace(/<p class=flavortext>[\s\S]*?<\/p>/i, "").replace(/<i>\s*Benefit:?\s*<\/i>[\s\S]*$/i, "");
	const prose = txt(body);
	bg.prose = prose ? [{ heading: "", text: prose }] : [];
	if (!bg.benefit) { bg.quality = "partial"; bg.notes.push("no-benefit"); }
	return bg;
}

export function parseOption(kind, entry) {
	if (kind === "feat") return parseFeat(entry);
	if (kind === "background") return parseBackground(entry);
	return parsePath(kind, entry);
}

async function main() {
	const argv = process.argv.slice(2);
	const flag = (name, fallback) => (argv.includes(`--${name}`) ? argv[argv.indexOf(`--${name}`) + 1] : fallback);
	const here = path.dirname(fileURLToPath(import.meta.url));
	const outDir = path.resolve(here, flag("out", "out/parsed"));
	await mkdir(outDir, { recursive: true });
	for (const [kind, { file }] of Object.entries(KINDS)) {
		const entries = JSON.parse(await readFile(path.join(here, "out", file), "utf8"));
		const parsed = entries.map(e => parseOption(kind, e));
		await writeFile(path.join(outDir, `option-${kind}.json`), JSON.stringify(parsed));
		const q = {};
		for (const p of parsed) q[p.quality] = (q[p.quality] ?? 0) + 1;
		console.log(`Parsed ${parsed.length} ${kind}:`, q);
	}
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
