# dnd4e-collector

Private pipeline that turns a 4e compendium snapshot into Foundry-ready `power` Items for the `dnd4e` system.
Nothing here ships book content: `out/` and `rules/` are git-ignored and stay on your machine.

```
collect.mjs        iws.mx viewer data (JSONP)        -> out/<category>.json      (raw HTML per entry)
parse-powers.mjs   power HTML                        -> out/parsed/power.json    (clean intermediate schema)
build-db.mjs       intermediate schema + system enums -> out/db/                  (PowerData items, grouped by book)
validate-db.mjs    out/db vs the installed system's enums (static)
macros/validate-powers.js   run inside Foundry: validates items against the real PowerData model
build-review.mjs   out/parsed                        -> out/review/index.html    (local viewer: original vs parsed)
```

Typical run: `node collect.mjs` (once), then `node parse-powers.mjs && node build-db.mjs && node validate-db.mjs`.

`system-enums.mjs` reads the allowed values from the system's `config.mjs` / `lang/en.json` (override the path with `DND4E_SYSTEM`), so the converter follows the installed system.

## DB layout
```
out/db/manifest.json         counts and quality totals
out/db/power/_index.json     one light row per power (with its keywords, review notes and ability versions): id, _id, name, class, powerType, level, usage, action, source, file, quality, review, children
out/db/power/<SOURCE>.json   Item data arrays per source book (PHB, Dra385, ...)
```
Each item is `{ _id, name, type: "power", system, flags }`. `_id` is deterministic, so rebuilding keeps ids stable.

### Bundles: one listing, several items
The index lists **one row per power**. Importing a row imports every item in its `items` array, in order:

| `flags.dnd4e.import.role` | what it is |
|---|---|
| `main` | the power itself (the *melee* version when the power is split) |
| `variant` | every other version of the power: the *ranged* version of a melee/ranged power, and one version per ability when the player chooses the ability |
| `child` | an extra part of the power (secondary attack, second technique, ...) |

All members share `import.bundle` (the main item's `_id`). A power is split into "Name (Melee)" / "Name (Ranged)" only when the attack or the damage differs between the two
(47 powers, e.g. `Strength vs. AC (melee) or Dexterity vs. AC (ranged)`); the ~190 powers with the same stats for both use one item with `weaponType: meleeRanged`.

### Choice of ability
When the text lets the player choose the ability ("Strength or Wisdom vs. AC", or a fixed attack with "+ Strength, Dexterity, or Constitution damage"), the power imports one version per ability: "Name (Strength)", "Name (Wisdom)". Each version has its own attack ability and damage modifier, `flags.dnd4e.import.ability`, and a note `ability-versions`. In the current data this is 215 powers with 2 or 3 options (290 extra items). When the choice is in a child part (typically the attack you can use while in a transformation, such as "Form of the Forge Spirit"), only that part is split: the form, with its several benefits, stays one item and its attack becomes "Forge Spirit Attack (Strength)", "(Constitution)", "(Wisdom)". The index row lists them in `abilities`. A melee/ranged power with a choice on one side gets a version per combination that exists ("Name (Melee, Strength)", "Name (Melee, Dexterity)", "Name (Ranged)").

`flags.dnd4e.import` also holds what PowerData cannot express yet: `review` notes, `extraDamage`, `ongoing`, `scaling`, and `candidates` (conditions, resistances, forced movement) for a future ActiveEffect pass.

## Races
`parse-races.mjs` -> `out/parsed/race.json`, `build-races.mjs` -> `out/db/race/_index.json` + `races.json`, `validate-races.mjs` checks them against the system's enums. A race is a set of `feature` items (the race + one per trait), an `apply` block (what the importer writes into the actor: size, origin, vision, speed, languages, skill and defence bonuses) and the racial powers found in the power DB (`granted` when the traits name them). Ability score bonuses are kept as text only. `npm run pipeline` runs everything.

## Tests (`npm test`, ~2 s, no Foundry needed)

| File | What it checks |
|---|---|
| `tests/pipeline.test.mjs` | Parser and converter on **synthetic** fixtures (`tests/fixtures.mjs`, invented text, safe to commit). One behaviour per test, named after the bug it guards (self damage, melee/ranged split, resistances, durations with owner, ...). |
| `tests/db-sim.test.mjs` | Over the **whole DB**: every item is "rolled" for fictional characters and compared with the number the book rules give. Skipped when `out/` is missing. |
| `tests/sim/sheet.mjs` | Sheet simulator: evaluates the item's formulas the way the dnd4e system does (`@powBase`, `@powerMod`, `@wepDamage`, ...). |
| `tests/sim/oracle.mjs` | The expected numbers, from the parsed book text and Rules Compendium p. 80. It never reads the item's formulas. |
| `tests/sim/characters.mjs` | Two characters (level 1 and 21) whose ability modifiers and weapon numbers are all different, so a wrong ability or weapon changes the total. |

**Limit:** `sheet.mjs` copies the system's *rules* (item.mjs `getPowBase`/`getPowMax`/`getRollData`, weapon defaults), not its code. If the system changes those, update `sheet.mjs`.
Anything that depends on the real runtime (which weapon is equipped, actor derived data, chat output) still has to be confirmed inside Foundry (`macros/validate-powers.js`, and the planned in-Foundry harness).
