/**
 * Downloads, once, the 5etools tokens that go with the monsters, traps and companions of the database, into a folder of the Foundry
 * data (default G:/Foundry/FoundryVTT/Data/dnd4e-tokens), so the actors point at files that are on your machine.
 *
 * The images are the 5etools image repository's (https://github.com/5etools-mirror-3/5etools-img, `bestiary/tokens/<book>/<name>.webp`),
 * read from raw.githubusercontent.com. They are art of the books and are not part of this project: they go to your data folder, never
 * to a repository. Only the tokens a monster is matched to (see tokens.mjs) are downloaded, and the ones already there are kept.
 *
 *   node fetch-tokens.mjs --list      the list of tokens in the repository (3 calls to the GitHub API), saved in out/tokens/list.json
 *   node fetch-tokens.mjs --bestiary  the 5etools bestiary files of the books that have tokens (about 110 files, 12 MB), saved in out/tokens/bestiary/:
 *                                     the types, sizes and challenge ratings that let a monster take the token of the most like creature of its family
 *   node fetch-tokens.mjs             download the matched tokens (needs the list and the built database: npm run pipeline)
 *   node fetch-tokens.mjs --to <dir>  another folder (or set DND4E_TOKENS_TO)
 */
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { localPath } from "./tokens.mjs";
import { matchesIn } from "./apply-tokens.mjs";

const root = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const flag = name => (argv.includes(`--${name}`) ? argv[argv.indexOf(`--${name}`) + 1] : undefined);
const listFile = path.join(root, "out", "tokens", "list.json");
const REPO = "5etools-mirror-3/5etools-img";

const api = async part => {
	const response = await fetch(`https://api.github.com/repos/${REPO}/git/${part}`, { headers: { "User-Agent": "dnd4e-collector" } });
	if (!response.ok) throw new Error(`GitHub ${part}: HTTP ${response.status}`);
	return response.json();
};

if (argv.includes("--list")) {
	const top = await api("trees/main");
	const bestiary = await api(`trees/${top.tree.find(t => t.path === "bestiary").sha}`);
	const tokens = await api(`trees/${bestiary.tree.find(t => t.path === "tokens").sha}?recursive=1`);
	if (tokens.truncated) throw new Error("the list of tokens is truncated");
	const files = tokens.tree.filter(e => e.type === "blob" && /\.(webp|png|jpg)$/i.test(e.path)).map(e => e.path);
	await mkdir(path.dirname(listFile), { recursive: true });
	await writeFile(listFile, JSON.stringify(files));
	console.log(`${files.length} tokens in the repository, list saved to ${listFile}`);
	process.exit(0);
}

if (argv.includes("--bestiary")) {
	const base = "https://raw.githubusercontent.com/5etools-mirror-3/5etools-src/main/data/bestiary";
	let listed;
	try { listed = new Set(JSON.parse(await readFile(listFile, "utf8")).map(f => f.split("/")[0])); } catch { console.error("No list of tokens. Run: node fetch-tokens.mjs --list"); process.exit(1); }
	const index = await (await fetch(`${base}/index.json`)).json();
	const folder = path.join(root, "out", "tokens", "bestiary");
	await mkdir(folder, { recursive: true });
	let saved = 0;
	for (const [source, file] of Object.entries(index)) {
		if (!listed.has(source)) continue;
		const response = await fetch(`${base}/${file}`);
		if (!response.ok) { console.error(`${source}: HTTP ${response.status}`); continue; }
		await writeFile(path.join(folder, `${source}.json`), Buffer.from(await response.arrayBuffer()));
		saved++;
	}
	console.log(`${saved} bestiary files saved to ${folder}`);
	process.exit(0);
}

let files;
try { files = JSON.parse(await readFile(listFile, "utf8")); } catch { console.error("No list of tokens. Run: node fetch-tokens.mjs --list"); process.exit(1); }
const to = path.resolve(flag("to") ?? process.env.DND4E_TOKENS_TO ?? "G:/Foundry/FoundryVTT/Data/dnd4e-tokens");
const wanted = [...new Set((await matchesIn(files)).map(m => m.file))];

let done = 0, kept = 0, failed = 0;
const exists = async file => { try { await stat(file); return true; } catch { return false; } };
const download = async file => {
	const target = path.join(to, localPath(file));
	if (await exists(target)) { kept++; return; }
	const url = `https://raw.githubusercontent.com/${REPO}/main/bestiary/tokens/${file.split("/").map(encodeURIComponent).join("/")}`;
	try {
		const response = await fetch(url);
		if (!response.ok) throw new Error(`HTTP ${response.status}`);
		await mkdir(path.dirname(target), { recursive: true });
		await writeFile(target, Buffer.from(await response.arrayBuffer()));
		done++;
	} catch (error) { failed++; console.error(`${file}: ${error.message}`); }
};
const queue = [...wanted];
await Promise.all(Array.from({ length: 6 }, async () => { while (queue.length) await download(queue.shift()); }));
console.log(`${wanted.length} tokens wanted: ${done} downloaded, ${kept} already there, ${failed} failed, in ${to}`);
