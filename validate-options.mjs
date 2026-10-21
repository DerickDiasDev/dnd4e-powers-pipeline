/**
 * Static validation of out/db/option against the installed dnd4e system's enumerations (see system-enums.mjs).
 *
 * Usage: node validate-options.mjs [--db out/db]
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ENUMS } from "./system-enums.mjs";
import { effectProblems } from "./validate-effects.mjs";
import { KINDS } from "./parse-options.mjs";

const TIERS = ["Heroic", "Paragon", "Epic"];

/** @returns {Map<string, {count: number, examples: string[]}>} problems found, keyed by message */
export function validateOptions(kind, entries, index, powerIds) {
	const errors = new Map();
	const fail = (name, msg) => {
		const e = errors.get(msg) ?? { count: 0, examples: [] };
		e.count++;
		if (e.examples.length < 3) e.examples.push(name);
		errors.set(msg, e);
	};
	const seen = new Set();
	const effectIds = new Set();
	const rowById = new Map(index.map(r => [r.id, r]));
	for (const e of entries) {
		const n = e.name;
		if (e.kind !== kind) fail(n, `entry kind "${e.kind}" in the ${kind} file`);
		if (!n) fail(e.id, "option without a name");
		if (seen.has(e._id)) fail(n, "duplicate option _id");
		seen.add(e._id);
		if (e.tier !== null && !TIERS.includes(e.tier)) fail(n, `tier "${e.tier}" not in [${TIERS.join(",")}]`);
		if (["feat", "path", "destiny", "theme"].includes(kind) && e.tier === null) fail(n, "no tier");
		if (e.level !== null && !(Number.isInteger(e.level) && e.level >= 1 && e.level <= 30)) fail(n, `level ${e.level}`);
		if (!e.items.length || e.items[0]._id !== e._id) fail(n, "the first item must be the option itself");
		for (const item of e.items) {
			for (const p of effectProblems(item, effectIds)) fail(n, `effect: ${p}`);
			if (item.type !== "feature") fail(n, `item "${item.name}" is not a feature`);
			if (item.system.featureType !== kind || !ENUMS.featureTypes.includes(item.system.featureType)) fail(n, `item "${item.name}" has featureType "${item.system.featureType}"`);
			if (!/^[A-Za-z0-9]{16}$/.test(item._id)) fail(n, "item _id is not a 16-char id");
			if (seen.has(item._id) && item._id !== e._id) fail(n, "duplicate item _id");
			seen.add(item._id);
			if (!item.name) fail(n, "item without a name");
			if (item.system.level !== null && !(Number.isInteger(item.system.level) && item.system.level >= 1 && item.system.level <= 30)) fail(n, `item "${item.name}" has level ${item.system.level}`);
			if (item.flags.dnd4e.import.bundle !== e._id) fail(n, "item bundle does not point at the option");
		}
		if (kind !== "path" && e.apply.paragon !== null) fail(n, "only a paragon path sets the paragon path");
		if (kind !== "destiny" && e.apply.epic !== null) fail(n, "only an epic destiny sets the epic destiny");
		for (const p of e.powers) {
			if (powerIds && !powerIds.has(p.id)) fail(n, `power "${p.name}" is not in the power database`);
			if (!["granted", "option"].includes(p.kind)) fail(n, `power kind "${p.kind}"`);
		}
		const row = rowById.get(e.id);
		if (!row) fail(n, "option is not in the index");
		else if (JSON.stringify(row.items) !== JSON.stringify(e.items.map(i => i._id))) fail(n, "index items differ from the option's items");
	}
	return errors;
}

async function main() {
	const here = path.dirname(fileURLToPath(import.meta.url));
	const argv = process.argv.slice(2);
	const dbDir = path.resolve(argv.includes("--db") ? argv[argv.indexOf("--db") + 1] : path.join(here, "out", "db"));
	const powerIds = new Set(JSON.parse(await readFile(path.join(dbDir, "power", "_index.json"), "utf8")).map(p => p.id));
	let bad = false;
	for (const kind of Object.keys(KINDS)) {
		const entries = JSON.parse(await readFile(path.join(dbDir, "option", kind, "entries.json"), "utf8"));
		const index = JSON.parse(await readFile(path.join(dbDir, "option", kind, "_index.json"), "utf8"));
		const errors = validateOptions(kind, entries, index, powerIds);
		if (!errors.size) { console.log(`${kind}: ${entries.length} entries, no problems.`); continue; }
		bad = true;
		for (const [msg, e] of errors) console.log(`${kind}: ${e.count}x ${msg}  e.g. ${e.examples.join(", ")}`);
	}
	if (bad) process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
