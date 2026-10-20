/**
 * Copies the generated database (out/db) into the Foundry data folder, where the dnd4e-importer module reads it.
 * Foundry serves files under its data folder, so the module can fetch <data>/dnd4e-db/power/_index.json.
 *
 * Only `power/` and `manifest.json` inside the target are replaced; nothing else in the target is touched.
 *
 * Usage: node publish-db.mjs [--to G:/Foundry/FoundryVTT/Data/dnd4e-db]   (or set DND4E_PUBLISH_TO)
 */
import { cp, mkdir, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const flag = name => (argv.includes(`--${name}`) ? argv[argv.indexOf(`--${name}`) + 1] : undefined);

const from = path.join(root, "out", "db");
const to = path.resolve(flag("to") ?? process.env.DND4E_PUBLISH_TO ?? "G:/Foundry/FoundryVTT/Data/dnd4e-db");

try { await stat(path.join(from, "power", "_index.json")); } catch { console.error(`No database at ${from}. Run: npm run pipeline`); process.exit(1); }
if (path.resolve(from) === to || to.startsWith(path.resolve(from) + path.sep)) { console.error("The target must be outside out/db."); process.exit(1); }

await mkdir(to, { recursive: true });
await rm(path.join(to, "power"), { recursive: true, force: true });
await rm(path.join(to, "manifest.json"), { force: true });
await cp(path.join(from, "power"), path.join(to, "power"), { recursive: true });
await cp(path.join(from, "manifest.json"), path.join(to, "manifest.json"));

const manifest = JSON.parse(await readFile(path.join(to, "manifest.json"), "utf8"));
console.log(`Published ${manifest.powers} powers (${manifest.items} items, ${manifest.files} files) to ${to}`);
console.log("In Foundry: the importer reads the folder named in its 'Database folder' setting (default: dnd4e-db).");
