/**
 * Gives an icon to every power and feature of the built database (out/db), as icons.mjs decides. Run it after the builds: it only adds
 * `img` to items, so running it again changes nothing.
 *
 * Usage: node apply-icons.mjs
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { decorate } from "./icons.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "out", "db");
const walk = async dir => (await readdir(dir, { withFileTypes: true })).flatMap(e => (e.isDirectory() ? [] : [path.join(dir, e.name)])).concat(
	...(await Promise.all((await readdir(dir, { withFileTypes: true })).filter(e => e.isDirectory()).map(e => walk(path.join(dir, e.name))))));

let files = 0, items = 0;
for (const file of await walk(root)) {
	if (!file.endsWith(".json") || /(_index|manifest)\.json$/.test(file)) continue;
	const data = JSON.parse(await readFile(file, "utf8"));
	const n = decorate(data);
	if (!n) continue;
	await writeFile(file, JSON.stringify(data));
	files++; items += n;
}
console.log(`${items} items in ${files} files have an icon`);
