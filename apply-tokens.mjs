/**
 * Gives the monsters, traps and companions of the built database (out/db) the 5etools token that goes with them (see tokens.mjs):
 * the actor's portrait and its token image become `dnd4e-tokens/<book>/<name>.webp`, a path under the Foundry data folder where
 * fetch-tokens.mjs downloads the files. An actor with no matching token is left as it is.
 *
 * It needs the list of tokens (node fetch-tokens.mjs --list); without it nothing is changed. Running it again changes nothing.
 *
 * Usage: node apply-tokens.mjs
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { indexTokens, localPath, matchToken } from "./tokens.mjs";

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

/** The matches of the database's actors against a list of tokens: `[{ name, file, how }]`. */
export async function matchesIn(tokenFiles) {
	const index = indexTokens(tokenFiles);
	return (await actorFiles()).flatMap(({ data }) => actorsOf(data)).map(a => ({ name: a.name, ...matchToken(a.name, index) })).filter(m => m.file);
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
	const index = indexTokens(list);
	const how = { exact: 0, edge: 0, modifier: 0 };
	let total = 0;
	for (const { file, data } of await actorFiles()) {
		let changed = false;
		for (const actor of actorsOf(data)) {
			total++;
			const match = matchToken(actor.name, index);
			if (!match) continue;
			setToken(actor, match.file);
			how[match.how]++;
			changed = true;
		}
		if (changed) await writeFile(file, JSON.stringify(data));
	}
	console.log(`${how.exact + how.edge + how.modifier} of ${total} actors have a token (${how.exact} by the name, ${how.edge} by the creature the name begins or ends with, ${how.modifier} with Young, Adult...)`);
}
