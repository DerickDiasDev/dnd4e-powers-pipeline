/**
 * Parses the traps, hazards, terrain and obstacles (out/trap.json) into a clean intermediate schema (out/parsed/trap.json).
 *
 * Three page layouts exist (a "trap" stat block with titled blocks, a "th" block with triggered actions, and a plain page for
 * terrain); they give the same data here: the numbers a trap can have (level, XP, hit points, defences, initiative) when the page
 * prints them, and the whole text as lines, which is where the triggers, attacks and countermeasures are. The attacks are not
 * turned into powers: a trap's text is read by the DM.
 *
 * Usage: node parse-traps.mjs [--in out/trap.json] [--out out/parsed]
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { txt } from "./parse-powers.mjs";

/** The page's text as lines, the titled blocks of the trap layout each on their own line. */
export function trapLines(html) {
	const body = html.replace(/<p class=publishedIn>[\s\S]*$/i, "")
		.replace(/<span class=(?:trapblocktitle|trapblockbody|traplead)>/gi, "\n")
		.replace(/<\/(?:span|h[1-6])>/gi, "\n")
		.replace(/<\/?(?:table|tr)[^>]*>/gi, "\n").replace(/<t[dh][^>]*>/gi, " | ");
	return txt(body).split("\n").map(l => l.replace(/^\s*\|\s*/, "").trim()).filter(Boolean);
}

const GROUPS = { elite: "elite", solo: "solo", minion: "minion" };

/** "Level 1 Elite Warder" / "Level 10 BlasterXP 500" / "Level 3 Minion Trap" -> { level, group, role } (any may be null). */
export function parseHeader(lines, listing = {}) {
	const head = lines.slice(0, 5).join(" ");
	const m = head.match(/Level\s+(\d+)\+?\s+((?:Elite|Solo|Minion)\s+)?([A-Za-z]+(?: [A-Za-z]+)?)?\s*(?:XP|$)/);
	const level = m ? Number(m[1]) : (listing.Level && /^\d+$/.test(String(listing.Level)) ? Number(listing.Level) : null);
	const group = m?.[2] ? GROUPS[m[2].trim().toLowerCase()] : GROUPS[String(listing.GroupRole ?? "").toLowerCase()] ?? "standard";
	const word = (m?.[3] ?? "").trim().toLowerCase();
	// "Trap", "Hazard" and "Obstacle" in the header are what it is, not a role.
	const role = ["", "trap", "hazard", "obstacle", "terrain"].includes(word) ? (["blaster", "lurker", "warder", "obstacle"].includes(String(listing.Type ?? "").toLowerCase()) ? String(listing.Type).toLowerCase() : "") : word;
	return { level, group, role };
}

const sourcesOf = listing => String(listing.SourceBook ?? "").split(",").map(s => s.trim()).filter(Boolean);

/** The text without the title and the lines that only restate what the actor already has ("Trap", "Level 1 Elite Warder XP 200"). */
export function withoutHeader(lines, name) {
	const out = [...lines];
	if (out[0] === name) out.shift();
	while (out.length && (/^(?:Trap|Hazard|Obstacle|Terrain|XP \d+)$/i.test(out[0]) || (/^Level \d+/.test(out[0]) && out[0].length < 60))) out.shift();
	return out;
}

export function parseTrap(entry) {
	const listing = entry.listing;
	const lines = trapLines(entry.html);
	const name = txt(listing.Name);
	const text = lines.join("\n");
	const header = parseHeader(lines, listing);
	const def = text.match(/AC\s+(\d+),\s*Fortitude\s+(\d+),\s*Reflex\s+(\d+),\s*Will\s+(\d+|—|-)/i);
	const hp = text.match(/^HP\s+(\d+)/im);
	const init = text.match(/^Initiative\s+([+-]?\d+)/im);
	const xp = text.match(/XP\s*(\d+)/i);
	// What it is: the listing's type when it is one of the four, else the id of the page ("terrain100").
	const idKind = entry.id.replace(/\d+$/, "");
	const typeWord = String(listing.Type ?? "").toLowerCase();
	const kind = ["trap", "hazard", "terrain", "obstacle"].includes(typeWord) ? typeWord : (idKind === "terrain" ? "terrain" : /^\s*(?:Trap|Hazard|Obstacle)$/im.exec(lines.slice(0, 3).join("\n"))?.[0].trim().toLowerCase() ?? "trap");
	const extraKind = ["Fantastic Terrain", "Terrain Power", "Single-Use"].includes(listing.GroupRole) ? listing.GroupRole : null;
	const sources = sourcesOf(listing);
	const notes = [];
	if (header.level === null) notes.push("level-missing");
	if (!hp) notes.push("hp-none");
	return {
		id: entry.id, name, kind, extraKind, ...header,
		xp: xp ? Number(xp[1]) : null,
		hp: hp ? Number(hp[1]) : null,
		initiative: init ? Number(init[1]) : null,
		defences: def ? { ac: Number(def[1]), fort: Number(def[2]), ref: Number(def[3]), wil: /\d/.test(def[4]) ? Number(def[4]) : null } : null,
		// The title is the actor's name: the first line, when it is that.
		body: withoutHeader(lines, name),
		sources, sourceCode: sources[0] ?? null, notes,
	};
}

async function main() {
	const argv = process.argv.slice(2);
	const flag = (name, fallback) => (argv.includes(`--${name}`) ? argv[argv.indexOf(`--${name}`) + 1] : fallback);
	const here = path.dirname(fileURLToPath(import.meta.url));
	const input = path.resolve(here, flag("in", "out/trap.json"));
	const outDir = path.resolve(here, flag("out", "out/parsed"));
	const parsed = JSON.parse(await readFile(input, "utf8")).map(parseTrap);
	await mkdir(outDir, { recursive: true });
	await writeFile(path.join(outDir, "trap.json"), JSON.stringify(parsed));
	const count = get => { const c = {}; for (const p of parsed) c[get(p)] = (c[get(p)] ?? 0) + 1; return c; };
	const notes = {};
	for (const p of parsed) for (const n of p.notes) notes[n] = (notes[n] ?? 0) + 1;
	console.log(`Traps: ${parsed.length}`, count(p => p.kind), count(p => p.group), "notes:", notes);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
