/**
 * Gives the monsters, traps and companions of the built database (out/db) the 5etools token that goes with them (see tokens.mjs):
 * the actor's portrait and its token image become `dnd4e-tokens/<book>/<name>.webp`, a path under the Foundry data folder where
 * fetch-tokens.mjs downloads the files. An actor with no matching token is left as it is.
 *
 * It needs the list of tokens (node fetch-tokens.mjs --list); without it nothing is changed. With the bestiary files (--bestiary) a monster
 * takes the token of the most like creature of its family; without them, the one its name gives. Running it again changes nothing.
 *
 * Usage: node apply-tokens.mjs
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { indexTokens, localPath, matchToken } from "./tokens.mjs";
import { candidatesFrom, matchFamily } from "./token-family.mjs";

const root = path.dirname(fileURLToPath(import.meta.url));
const db = path.join(root, "out", "db");
/** The folder of the tokens under the Foundry data folder: what the actors' paths start with. */
export const TOKEN_FOLDER = "dnd4e-tokens";
const ACTOR_TYPES = new Set(["NPC", "Hazard"]);
const FOLDERS = ["monster", "trap", "companion"];

const walk = async dir => (await readdir(dir, { withFileTypes: true })).flatMap(e => (e.isDirectory() ? [] : [path.join(dir, e.name)])).concat(
	...(await Promise.all((await readdir(dir, { withFileTypes: true })).filter(e => e.isDirectory()).map(e => walk(path.join(dir, e.name))))));
const isActor = o => o && typeof o === "object" && !Array.isArray(o) && o._id && o.name && ACTOR_TYPES.has(o.type) && o.system && typeof o.system === "object";

/** Every actor of the monster, trap and companion files: `{ file (of the database), actors }`. */
async function actorFiles() {
	const out = [];
	for (const folder of FOLDERS) {
		let files = [];
		try { files = await walk(path.join(db, folder)); } catch { continue; }
		for (const file of files) if (file.endsWith(".json") && !/_index\.json$/.test(file)) out.push({ file, data: JSON.parse(await readFile(file, "utf8")) });
	}
	return out;
}
const actorsOf = data => (Array.isArray(data) ? data : [data]).filter(isActor);

/**
 * The function that finds the token of an actor: its family in the 5etools bestiary when the bestiary files are there
 * (node fetch-tokens.mjs --bestiary), then the creature its name begins or ends with. It returns `{ file, how }` or null.
 */
export async function tokenMatcher(tokenFiles) {
	const index = indexTokens(tokenFiles);
	let candidates = null;
	try {
		const dir = path.join(root, "out", "tokens", "bestiary");
		const bySource = {};
		for (const file of await readdir(dir)) if (file.endsWith(".json")) bySource[file.slice(0, -5)] = JSON.parse(await readFile(path.join(dir, file), "utf8")).monster ?? [];
		if (Object.keys(bySource).length) candidates = candidatesFrom(bySource, tokenFiles);
	} catch { /* no bestiary files: the names alone */ }
	return actor => (candidates && matchFamily(actor, candidates)) || matchToken(actor.name, index);
}

/** The matches of the database's actors against a list of tokens: `[{ name, file, how }]`. */
export async function matchesIn(tokenFiles) {
	const match = await tokenMatcher(tokenFiles);
	return (await actorFiles()).flatMap(({ data }) => actorsOf(data)).map(a => ({ name: a.name, ...match(a) })).filter(m => m.file);
}

/** Sets the portrait and the token image of an actor to the downloaded token. */
export function setToken(actor, file) {
	const src = `${TOKEN_FOLDER}/${localPath(file)}`;
	actor.img = src;
	actor.prototypeToken = { ...actor.prototypeToken, texture: { ...actor.prototypeToken?.texture, src } };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	let list;
	try { list = JSON.parse(await readFile(path.join(root, "out", "tokens", "list.json"), "utf8")); } catch { console.log("No list of tokens (node fetch-tokens.mjs --list): no token was set."); process.exit(0); }
	const match = await tokenMatcher(list);
	const how = { exact: 0, family: 0, edge: 0, modifier: 0 };
	let total = 0;
	for (const { file, data } of await actorFiles()) {
		let changed = false;
		for (const actor of actorsOf(data)) {
			total++;
			const found = match(actor);
			if (!found) continue;
			setToken(actor, found.file);
			how[found.how]++;
			changed = true;
		}
		if (changed) await writeFile(file, JSON.stringify(data));
	}
	console.log(`${how.exact + how.family + how.edge + how.modifier} of ${total} actors have a token (${how.exact} by the name, ${how.family} by the most like creature of the family, ${how.edge} by the creature the name begins or ends with, ${how.modifier} with Young, Adult...)`);
}
