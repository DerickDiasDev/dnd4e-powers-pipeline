/**
 * Lists the Foundry core icons the database may use (`icons-catalog.json`, committed), so the rules in icons.mjs can pick from real
 * files and the tests can check every choice without Foundry installed.
 *
 * The icons are Foundry's own: they are used by their path inside Foundry (`icons/magic/fire/...`), never copied into the database.
 *
 * Usage: node build-icon-catalog.mjs [--app "G:/Foundry/Foundry 14/Foundry Virtual Tabletop/resources/app"]   (or set FOUNDRY_APP)
 */
import { readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const app = (argv.includes("--app") ? argv[argv.indexOf("--app") + 1] : process.env.FOUNDRY_APP) ?? "G:/Foundry/Foundry 14/Foundry Virtual Tabletop/resources/app";
const icons = path.join(app, "public", "icons");

/** The folders of core icons the rules draw from. */
export const CATALOG_FOLDERS = ["magic", "skills", "weapons", "equipment", "consumables", "containers", "tools", "commodities", "sundries", "creatures", "environment"];

const walk = async dir => (await readdir(dir, { withFileTypes: true })).flatMap(e => (e.isDirectory() ? [] : [e.name])).concat(
	...(await Promise.all((await readdir(dir, { withFileTypes: true })).filter(e => e.isDirectory()).map(async e => (await walk(path.join(dir, e.name))).map(n => `${e.name}/${n}`)))));

const paths = [];
for (const folder of CATALOG_FOLDERS) for (const name of await walk(path.join(icons, folder))) if (/\.(webp|svg|png)$/.test(name)) paths.push(`icons/${folder}/${name}`);
paths.sort();
await writeFile(path.join(root, "icons-catalog.json"), `${JSON.stringify(paths, null, 0).replaceAll('","', '",\n"')}\n`);
console.log(`${paths.length} icons from ${CATALOG_FOLDERS.length} folders`);
