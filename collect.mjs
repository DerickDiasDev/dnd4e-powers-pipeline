/**
 * Collector for the trpg-dnd-4e-db viewer data (JSONP files).
 *
 * Layout on the host (see 4e_database_files/res/script.js, od.config.url):
 *   catalog.js                   -> { category: count }
 *   <cat>/_listing.js            -> (version, cat, [headers], [rows])
 *   <cat>/data0.js..data19.js    -> (version, cat, { id: htmlString })
 *
 * Output (all under --out, default ./out):
 *   raw/catalog.json
 *   raw/<cat>/listing.json       { headers, rows }
 *   raw/<cat>/data<N>.json       { id: html }
 *   <cat>.json                   merged: [{ id, listing: {...}, html }]
 *   manifest.json                run summary
 *
 * Usage: node collect.mjs [--host URL] [--out DIR] [--category a,b] [--max-shards N]
 *                         [--delay MS] [--force]
 * Re-running skips files already on disk (resumable) unless --force.
 */
import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const args = parseArgs(process.argv.slice(2));
const HOST = (args.host ?? "https://iws.mx/dnd/4e_database_files").replace(/\/+$/, "");
const OUT = path.resolve(args.out ?? path.join(path.dirname(fileURLToPath(import.meta.url)), "out"));
const DELAY = Number(args.delay ?? 400);
const MAX_SHARDS = Number(args["max-shards"] ?? 20);
const ONLY = args.category ? String(args.category).split(",").map(s => s.trim().toLowerCase()) : null;
const FORCE = Boolean(args.force);
const UA = "dnd4e-collector/0.1 (personal, private archive; low rate)";

function parseArgs(argv) {
	const out = {};
	for (let i = 0; i < argv.length; i++) {
		if (!argv[i].startsWith("--")) continue;
		const key = argv[i].slice(2);
		const next = argv[i + 1];
		if (next === undefined || next.startsWith("--")) out[key] = true;
		else { out[key] = next; i++; }
	}
	return out;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const exists = p => access(p).then(() => true, () => false);

/** Fetch text, retrying on network/5xx errors. Returns null on 404. */
async function fetchText(url, tries = 4) {
	for (let attempt = 1; attempt <= tries; attempt++) {
		try {
			const res = await fetch(url, { headers: { "User-Agent": UA } });
			if (res.status === 404) return null;
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			return await res.text();
		} catch (err) {
			if (attempt === tries) throw new Error(`${url}: ${err.message}`);
			await sleep(1000 * attempt);
		}
	}
}

/** Turn `fn(a, b, c)` JSONP text into the JS array [a, b, c]. */
function parseJsonp(text) {
	const start = text.indexOf("(");
	const end = text.lastIndexOf(")");
	if (start < 0 || end < start) throw new Error("Not a JSONP payload");
	return JSON.parse(`[${stripTrailingCommas(text.slice(start + 1, end))}]`);
}

/**
 * Convert the JS-literal flavour used by some shards into strict JSON:
 * drops trailing commas, quotes bare property names and re-quotes 'single' strings.
 * Strings are copied through untouched, so HTML content is never altered.
 */
function stripTrailingCommas(src) {
	const bareWord = /[A-Za-z_][\w$-]*/y;
	const comma = /\s*[}\]]/y;
	const colon = /\s*:/y;
	let out = "";
	for (let i = 0; i < src.length; i++) {
		const ch = src[i];
		if (ch === "\"" || ch === "'") {
			let j = i + 1;
			let str = "";
			while (j < src.length && src[j] !== ch) {
				if (src[j] === "\\") {
					const esc = src[j + 1];
					str += (esc === "'") ? "'" : "\\" + esc;
					j += 2;
				} else {
					str += (src[j] === "\"") ? "\\\"" : src[j];
					j++;
				}
			}
			out += `"${str}"`;
			i = j;
		} else if (ch === ",") {
			comma.lastIndex = i + 1;
			if (!comma.test(src)) out += ch;
		} else if (/[A-Za-z_]/.test(ch)) {
			bareWord.lastIndex = i;
			const word = bareWord.exec(src)[0];
			colon.lastIndex = i + word.length;
			out += colon.test(src) ? `"${word}"` : word;
			i += word.length - 1;
		} else out += ch;
	}
	return out;
}

async function writeJson(file, data) {
	await mkdir(path.dirname(file), { recursive: true });
	await writeFile(file, JSON.stringify(data));
}

/** Download + parse one remote file into a cache file, or load the cache. */
async function cached(rel, remotePath, pick) {
	const file = path.join(OUT, "raw", rel);
	if (!FORCE && await exists(file)) return JSON.parse(await readFile(file, "utf8"));
	const text = await fetchText(`${HOST}/${remotePath}`);
	await sleep(DELAY);
	if (text === null) return null;
	const data = pick(parseJsonp(text));
	await writeJson(file, data);
	return data;
}

async function main() {
	console.log(`Host: ${HOST}\nOut:  ${OUT}`);
	const catalog = await cached("catalog.json", "catalog.js", a => a[1]);
	if (!catalog) throw new Error("catalog.js not found on host");

	const categories = Object.keys(catalog).filter(c => !ONLY || ONLY.includes(c));
	if (!categories.length) throw new Error(`No matching categories. Available: ${Object.keys(catalog).join(", ")}`);

	const summary = { host: HOST, collectedAt: new Date().toISOString(), categories: {} };

	for (const cat of categories) {
		const listing = await cached(`${cat}/listing.json`, `${cat}/_listing.js`, a => ({ headers: a[2], rows: a[3] }));
		if (!listing) { console.warn(`[${cat}] no listing, skipping`); continue; }

		const entries = new Map();
		const idCol = listing.headers.indexOf("ID");
		for (const row of listing.rows) {
			entries.set(row[idCol], { id: row[idCol], listing: Object.fromEntries(listing.headers.map((h, i) => [h, row[i]])), html: null });
		}

		let shardsFound = 0;
		for (let n = 0; n < Math.min(MAX_SHARDS, 20); n++) {
			const shard = await cached(`${cat}/data${n}.json`, `${cat}/data${n}.js`, a => a[2]);
			if (!shard) continue;
			shardsFound++;
			for (const [id, html] of Object.entries(shard)) {
				const entry = entries.get(id) ?? { id, listing: null, html: null };
				entry.html = html;
				entries.set(id, entry);
			}
			console.log(`[${cat}] shard ${n}: ${Object.keys(shard).length} entries`);
		}

		const merged = [...entries.values()];
		const withHtml = merged.filter(e => e.html).length;
		await writeJson(path.join(OUT, `${cat}.json`), merged);
		summary.categories[cat] = { catalogCount: catalog[cat], listed: listing.rows.length, withHtml, shardsFound };
		console.log(`[${cat}] ${merged.length} merged (${withHtml} with html, catalog says ${catalog[cat]})`);
	}

	await writeJson(path.join(OUT, "manifest.json"), summary);
	console.log("Done.");
}

main().catch(err => { console.error(err); process.exit(1); });
