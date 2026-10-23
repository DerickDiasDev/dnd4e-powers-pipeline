# dnd4e-powers-pipeline

A private pipeline that turns a snapshot of the D&D 4th Edition compendium into a Foundry-ready database for the [`dnd4e`](https://github.com/EndlesNights/dnd4eBeta) system: powers, races, classes, feats, paragon paths, epic destinies, themes, backgrounds, monsters, mundane equipment, magic items and rituals, with their conditions, bonuses and resistances as ActiveEffects. The [`dnd4e-importer`](https://github.com/DerickDiasDev/foundry-dnd4e-importer) module reads that database and imports it into a world.

> **No book content is in this repository.** The compendium is copyrighted. `out/` (the downloaded and generated data) and `rules/` (reference PDFs) are git-ignored and stay on your machine; the tests run on invented text. Use it for your own games.

## What you get

| | Entries | Foundry documents |
|---|---|---|
| Powers | 9,415 | 10,130 `power` items (melee/ranged and per-ability versions, extra parts) |
| Races | 55 | 181 `feature` items + the sheet fields to fill |
| Classes | 77 | 704 `feature` items (one per class feature, with its level) + the sheet fields to fill |
| Feats, paragon paths, epic destinies, themes, backgrounds | 3,272 / 577 / 115 / 116 / 817 | `feature` items (paths and destinies: one per feature) |
| Monsters | 5,329 | NPC actors with their powers, traits and effects |
| Magic items | 3,245 | one item each, with its levels (tiers), enhancement bonus and price |
| Deities, diseases, familiars and the old companions | 134 / 69 / 105 | `feature` items, listed with the character options |
| Companion creatures | 89 | NPC templates (animal, fey beast and elemental companions, summoned creatures, mounts) whose numbers are made from the master's |
| Poisons | 38 | `consumable` items of type poison, with the magic items |
| Rules glossary | 545 | journal entries (one text page each) |
| Traps, hazards, terrain | 776 | `Hazard` actors with the printed numbers, detection, countermeasures, the text and the attacks as powers |
| Rituals | 360 | `ritual` items: category, level, time, duration, price, key skill and the result tables |
| Mundane equipment | 481 | 492 `weapon`, `equipment`, `consumable` and `loot` items (weapons, armour incl. masterwork, shields, implements, ammunition, adventuring gear) |

## Quick start

Requires Node 18 or newer. No dependencies to install.

```sh
node collect.mjs          # once: downloads the snapshot into out/<category>.json (raw HTML)
npm run pipeline          # parse -> build -> validate, for every kind of entry
npm run publish           # copies out/db to <Foundry data>/dnd4e-db (or: node publish-db.mjs --to <folder>)
npm test                  # ~300 tests, a few seconds, no Foundry needed
```

`npm run pipeline` stops at the first validation failure. `system-enums.mjs` reads the allowed values (damage types, statuses, skills, ...) straight from the installed system's `config.mjs` and `lang/en.json`, so the converter follows whatever system version is installed (set `DND4E_SYSTEM` to point at another copy).

## How it works

```
collect.mjs          compendium viewer data (JSONP)   ->  out/<category>.json         raw HTML per entry
parse-<kind>.mjs     raw HTML                         ->  out/parsed/<kind>.json      a clean, Foundry-independent schema
build-<kind>.mjs     parsed schema + system enums     ->  out/db/<kind>/              Foundry document data, deterministic ids
validate-<kind>.mjs  out/db vs the installed system   ->  pass/fail, grouped by problem
publish-db.mjs       out/db                           ->  <Foundry data>/dnd4e-db     what the importer reads
```

Kinds: `powers`, `races`, `classes`, `options` (feats, paths, destinies, themes, backgrounds), `monsters`, `gear` (mundane equipment), `magic` and `ritual`. Build order matters in one place: `build-db.mjs` (powers) runs first, because races, classes, options and monsters link to the power index and `manifest.json` is rewritten by it.

Two design rules run through everything:

- **Nothing is invented and nothing is dropped.** A field is structured when its pattern is recognised, kept as text otherwise. What could not be automated is recorded as a *review note* (`flags.dnd4e.import.review`), which the importer shows next to the entry in the user's language.
- **Ids are deterministic** (a hash of the source id and the part), so rebuilding never changes an id and an import twice never duplicates.

## Output layout

```
out/db/manifest.json                 counts and quality totals
out/db/power/_index.json             one light row per power; out/db/power/<BOOK>.json holds the items of each book
out/db/race/      _index.json  races.json
out/db/class/     _index.json  classes.json
out/db/option/<feat|path|destiny|theme|background>/   _index.json  entries.json
out/db/monster/   _index.json  <BOOK>.json            one file of actors per book
out/db/gear/      _index.json  gear.json
out/db/magic/     _index.json  <BOOK>.json            one file of entries per book
out/db/ritual/    _index.json  rituals.json
```

An index row is small and has what the importer lists (name, level, book, quality, notes, the ids of its items); the data files hold the Foundry document data.

## Powers

Each item is `{ _id, name, type: "power", system, flags, effects }`. One listing can import several items (a **bundle**; all share `flags.dnd4e.import.bundle`):

| `import.role` | What it is |
|---|---|
| `main` | the power itself (the *melee* version when the power is split) |
| `variant` | another version: the *ranged* version, or one version per ability when the player chooses the ability |
| `child` | an extra part (a secondary attack, a second technique, the attack you can use in a form) |

- **Melee/ranged**: a power is split in two only when the attack or the damage differs between the sides (47 powers); the rest use one item with `weaponType: meleeRanged`.
- **Choice of ability** ("Strength or Wisdom vs. AC"): one version per ability (215 powers), each with its own attack ability and damage modifier. When the choice is in a child part, only that part is split; a transformation with several benefits stays one item.
- **Damage and attack** become the system's formulas (`@powBase`, `@powerMod`, `@wepDamage`, `@primaryMod`, ...), checked numerically against the rules (see Tests).
- `flags.dnd4e.import` also keeps what PowerData cannot express: `review`, `extraDamage`, `ongoing`, `scaling` and `candidates` (everything the text mentions: conditions, resistances, forced movement).

## Effects

Each item (power, monster power) carries `effects`, the system's own `ActiveEffect4e` data, so the system applies them when the power is used:

- **Conditions** (`statuses`: `dazed`, `prone`, `mark`, `grantingCA`, ...) with their duration (`system.durationType`: `saveEnd`, `endOfUserTurn`, `endOfTargetTurn`, `startOfUserTurn`, `startOfTargetTurn`, `endOfEncounter`, `custom`) and when they apply (`system.powerEffectType`: `hit`, `miss`, `all`, `self`, `selfHit`, `selfMiss`, `allies`).
- **Ongoing damage** as `system.dots`: "ongoing 5 fire damage (save ends)", the older "5 ongoing fire damage", a sentence that starts with it or an imperative ("Deal ongoing 5 acid damage"), and a "(save ends both)" later in the sentence (it ends with the condition it is written with). A power with no Effect line and no attack (a monster’s "The target takes ongoing 5 cold damage (save ends).", an item’s sentences) has its text as its effect, so it is built too; "Make an attack: Ranged 5/10; +4 vs. Reflex; on a hit..." (a consumable’s) is read as the attack line. What is not built: an ongoing amount that grows ("each time the target fails the saving throw, increase the ongoing damage by 5", "First Failed Saving Throw: ..."), which stays in the text. The importer changes the amount to the one of the level an item’s power is imported at. In the published database 99% of the plain mentions in the monsters’ powers, 98% in the magic items’ and in the powers’ are effects.
- **Bonuses, penalties and resistances written as a plain number** (`parse-bonuses.mjs`): defences, speed, saves, initiative and skills go to the sheet slot of their type (`system.defences.ac.power`, `system.skills.prc.feat`); attack and damage rolls to the system's keyed bonuses (`power.attack.melee.power`); resistances to `system.resistances.<type>.res` (`.vuln` for vulnerability). Typed bonuses use `upgrade` (the highest counts) and untyped ones `add`, as the 4e stacking rules say.
- **Standing bonuses** of a feat, a racial trait or a class/path feature are effects on that feature item that `transfer` to the character while it is owned.

Only what is certain is built: a condition the text *applies* (not one it merely mentions), on a subject it names, with a duration the system has; a bonus that is not conditional ("against", "while", "your next attack roll"), not narrowed, not a choice and not scaling with the level. The rest stays in the text and `flags.dnd4e.import.effectsUnresolved`, and gives the info note `effect-unresolved`. **Not automated:** forced movement, aftereffects, bonuses that depend on a modifier or the level, auras and zones.

## Races, classes and options

A race, class, feat, path, destiny or theme is a set of `feature` items (the thing itself, plus one per trait or feature, with its level), an `apply` block and the powers it names, found in the power database:

- `apply` is what the importer writes into the actor, declaratively: for a race the size, origin, vision, speed, languages and the skill and defence bonuses; for a class the primary ability (the first key ability), hit points, healing surges, defence bonuses, fixed trained skills and the armour and weapon proficiencies (hybrid classes only their name); for a path or destiny its name on the sheet. Ability score bonuses stay as text: the choice is the player's.
- `powers` link to the power index; `kind: granted` when the text says "You gain the X power", `option` when the player picks among several.

## Monsters

Two page layouts exist (a table under a heading per kind of action; an older stats paragraph with compact power lines); both give the same data. A monster is an **NPC actor** with the printed numbers as values (`advancedCals: false`: defences, initiative, skills and speed are the printed numbers, not recomputed), its powers as `power` items (printed attack bonus in `attack.formula`, printed damage in `hit.formula`, the critical at maximum dice, `weaponType: none`) and its traits as `feature` items of type trait (an aura keeps its size). Conditions, ongoing damage and bonuses in a power's text become effects exactly as for the player powers; the monster's own name in the text counts as the user. Skills the block does not list are half the level plus the ability modifier. Notes: `conjured`, `minion`, `hp-special`, `initiative-conjurer`, `missing-*`.

## Mundane equipment

Every page that is not a magic item: the mundane weapons, armour and implements, plus the masterwork armour, the pact and improvised weapons, and the adventuring gear of the item table (magic items are the next section). Each becomes an item the sheet understands:

- **Weapons** (`weapon`): `weaponType` (simple/military/superior, melee or ranged), `weaponBaseType` (so automatic proficiency finds it), hand, group, properties (Brutal keeps its number), `damageDice`, proficiency bonus and range. A double weapon is one entry with two items (`role: child` for the secondary end).
- **Armour and shields** (`equipment`): the AC bonus, the base type (cloth, leather, hide, chain, scale, plate), check and speed penalties as the sheet expects them (negative, switched on). A shield gives its bonus to AC and Reflex. Barding is an item of type *other*.
- **Implements** (`weapon` of type implement): the implement group as base type; the rules text of properties the system has no switch for (Accurate, Energized...) goes into the description.
- **Ammunition** (`consumable` of type ammo) with the quantity of the pack.
- **Masterwork armour** is armour with its minimum enhancement in the text; **improvised weapons** use the system's improvised types; **pact weapons** are named weapons.
- **Adventuring gear** (`loot`): gear, components, food, services, instruments, vehicles, buildings and mounts, with price, weight and text; a mount keeps the creature's stat block as text.

A name the installed system has no base type for (a few Dragon Magazine weapons) is imported with an empty base type and the info note `base-type-unknown`; the proficiency then follows the category only.

## Magic items

Every `mihead` page of the weapon, armour, implement and item tables. The title gives level and rarity, the flavour line and a table of levels (level, enhancement bonus, price) come next, then stat lines and the Property/Power sections. An item that exists at several levels is **one entry with `tiers`**; the item data is built at the first tier and the importer patches level, price and enhancement (`flags.dnd4e.import.enhancePath`) for the tier the player picks.

- **Weapons and implements** (`weapon`): enhancement on `enhance`. The page names a group ("Maces", "Any melee"), not a weapon, so there are no damage dice; the index row's `base` says which weapons fit, and the importer can base the item on a mundane weapon. A page that names one weapon ("Longsword") gets its type and base type.
- **Armour** (`equipment`): enhancement on `armour.enhance`; when the page names one kind of armour the base bonus and penalties of that armour are filled in. Shields are `arms`. When it names several kinds ("Chain, scale or plate"), "Any" or "Any shield", the index row’s `base` lists them (`kinds`, `any`) and the importer can base the item on a mundane armour or shield, as it does for weapons.
- **Slot items** (head, neck, arms, hands, feet, waist, ring), **wondrous items** (equipment of type other, so they can be equipped) and **alternative rewards** (boons, gifts, secrets...) are `equipment`. Consumables are `consumable`; familiars, mounts, companions, lairs and item sets are `loot`.
- **Effects:** plain standing bonuses in a Property section become transferring effects with `equippedRec`, so the system suppresses them while the item is not equipped. A property whose numbers change with the level, or that is conditional, stays in the text.
- **Powers** (`item-powers.mjs`): each power section of an item is converted with the monsters’ power converter into a `power` item kept in the entry’s `powers`: usage (at-will, encounter, daily), action, keywords, range, an attack with a plain "+N vs. Defence" or "the weapon’s level + N vs. Defence" (`attackLevelOffset`), the damage roll, and the conditions it applies as effects. The lines that make a power stronger with the item’s level ("Level 13 or 18: 2d8 lightning damage") are kept in `flags.dnd4e.import.scaling` as `{line, levels, text}` for the importer to apply. The system links an item to its powers by UUID (`system.itemPowers`) and copies them to the actor while it is equipped, so the importer creates them next to the item. A **consumable** is used from the item itself, which has the fields of a power: its first power is merged into the item (`consumablePower`: range, action, attack, hit, miss, effect, damage type, conditions; one use, destroyed when used, with a power card) and flagged `itemPower`; its scaling lines ("Level 6: +9 vs. Reflex; 2d10 acid damage") stay in the import flags for the importer. Notes: `powers-linked`, `power-attack-text` (an attack that depends on something other than the item’s level stays in the text), `powers-in-text` (a consumable with more than one power: only the first is on the item).

## Deities, diseases and companions

They are written where the character options are (`out/db/option/<deity|disease|companion>/`, the same shape), so the importer lists them in the options window. Each is one `feature` item (`featureType: other`, `featureGroup` says what it is) whose description is the page. A **deity** keeps its header facts (type, alignment, domains, sphere, priests...) and `apply.deity` lets the importer write its name into the sheet's deity field; its domains are searchable. A **disease** keeps its level (or none, for the variable-level ones), its stages and the check between them. A **companion** (animal and elemental companions, familiars, mounts, summoned creatures) keeps its stat block as text: their numbers depend on the master's level, so they cannot be a fixed actor.

**Companion creatures** are the exception: animal, fey beast and elemental companions, summoned creatures and mounts are creatures with a stat block, and become NPC templates (`parse-companions.mjs`, `build-companions.mjs`, `validate-companions.mjs`, `out/db/companion/`, the monsters' index rows). Almost none has fixed numbers: they are the master's ("HP your bloodied value", "Defenses your defenses + 2", "AC 13, Fortitude 15... (add your level to each defense)", "Initiative equal to yours", "your level + 5 vs. AC", "1d12 + your Wisdom modifier damage" with the lines that change it at levels 13 and 23). The template is level 0 with one hit point; how each number is made is in `flags.dnd4e.import.companion` (`hp`: bloodied/surge/fixed, `defences`: master/levelPlus/fixed, `initiative`, `perception`) and in each power (`attackLevelOffset`, `companionDamage` = `{from, dice, flat, mods, half}` per level), and the importer fills them in. Their powers and traits come from the same converter as the monsters’ (the heading’s icon, keywords, action and usage; auras are traits). Familiars and the old formula-based beast companions are not stat blocks and stay `feature` items. Notes: `master-numbers`.

**Poisons** go through the magic item stage (both page layouts, the older one with the attack and the failed saves as lines): a `consumable` of type poison with its level and price.

## Traps, hazards and terrain

The system has a `Hazard` actor, and that is what a trap becomes (`out/db/trap/`, with the same index rows as the monsters, so the importer lists them in a window like the monsters’). Three page layouts exist; they give the same data: level, XP, group (standard, elite, solo, minion) and role when printed; hit points, defences and initiative when printed, and what is not printed is switched off with the sheet’s own `none` flags (a trap without hit points cannot be killed, a Will printed as a dash is no defence). The sheet’s roles are filled: primary trap/hazard/other, secondary the group, tertiary blaster/lurker/obstacle/warder/other. How to notice it (the Perception block or the Detect line) is `details.detection`, how to deal with it (the Countermeasures block) is `details.countermeasures`, and the rest of the text, with the triggers, is the description. The attacks are `power` items on the actor (the hazard sheet has a powers tab), made by the monsters’ converter from what `trap-powers.mjs` finds in the text: a block titled "Attack" (also "Secondary Attack", "Attack 1", "Attack * Necrotic") with its action and range line and its Target, Attack, Hit, Miss and Effect lines, or the "Triggered Actions" with the monsters’ power headings (618 of the 776 have at least one: also "Attack Poison", "Attack • Zone", "Attack—Claws of the Hungry Dead", "Blue Dragon Head Attack", and the terrain powers with their Requirement, Check, Success, Target, Attack and Hit lines, whose attack is "Level + 3 vs. Reflex", the trap’s level plus a number; the 16 that are still text have a layout of their own). A consequence the converter has no field for ("ongoing 5 acid damage") stays in the power’s hit text. `power-attack-text` marks an attack that could not be read. The keyword says what it is (Trap, Hazard, Terrain, Obstacle, and Fantastic Terrain or Terrain Power). Notes: `level-missing` (159), `hp-none`.

## Rituals

One `ritual` item per page: `category` (the system's ritual types; Martial Practice is `martial`, Teleportation `travel`), `level`, `castTime` and `duration` in the sheet's time units (a time that is not a number of minutes, hours or days, such as "Standard action", is `spec` and kept in the text), `market` (the market price as printed), and `attribute` with the formula `@attribute`, so the sheet rolls the check of the first key skill. The description keeps what the sheet cannot show (the component cost, the other key skills, a time or duration with more words than a number and a unit), the text, the result tables, and for the alchemical rituals the pages of the item they make at each level. The first paragraph of the text is the chat description (the flavour at the top of the ritual's chat card) and is not repeated in the description, because the system's ritual card shows the description twice when there is no chat description. Notes: `skill-choice` (several key skills, the first is used), `skill-unknown`, `category-unknown`.

## Icons

Powers, features, equipment and magic items, consumables, loot and rituals get one of Foundry's own core icons, so they no longer all show the same bag. `icons.mjs` chooses by what the item is: for a power, the damage it deals, healing, the weapon, the power source or the way it is delivered; for a feature, its kind (feat, path, destiny, class, race...); for a weapon, its group (swords, axes, bows...) or, for an implement, its kind (staff, wand, holy symbol...); for armour, its kind, with shields, bracers and the worn slots (head, neck, ring, feet, hands, waist, cloaks) apart; for a consumable, ammunition, poison, scroll, food or potion; for loot, gear, mounts, instruments, banners, tattoos and wondrous items; for a ritual, a scroll or a book. A magic item's category and kind are passed down from its entry. A power named for a weapon (Shortbow, Javelin, Longsword, Spear Charge) takes the weapon's own art, and one named for a natural attack (Claw, Bite, Slam) takes the art of creatures; "... of ..." names are magic ones and are chosen by their damage. A breath weapon takes the art of its element: Foundry's dragon breath of fire or of ice, the element's art for the others, the plain dragon breath when it has none. Icons that do not belong in a fantasy game (guns, rockets, bombs, tech, damaged weapons, a shield for a melee attack) are never used. Several icons fit each kind and the one used comes from the item's name, so an item always has the same icon and repeats are fine. `apply-icons.mjs` adds `img` to the built database (it is the last step of `npm run pipeline`, and `npm run icons` runs it alone). The powers and traits inside monsters, traps and companions get theirs (a trait by a word of its name: regeneration, aura, vision, an element); the monsters, traps and companions themselves are not given an icon yet.

The icons are used by their path (`icons/magic/fire/...`), never copied: they are Foundry's, to be used inside Foundry. The paths to pick from are in `icons-catalog.json`, made from a Foundry install by `npm run icons:catalog`.

## Tokens

Monsters, traps and companions can take the token of the 5etools image repository (`bestiary/tokens/<book>/<name>.webp` of `5etools-mirror-3/5etools-img`), as both portrait and token image. The same creature has other names in 4e and 5e (a goblin mage is a Booyahg Caster), so the match is made in a family (`token-family.mjs`): the creatures of 5etools whose name has the monster's creature word ("Goblin Hexer" -> goblin), or whose type tag begins with a word the name begins with ("goblin" -> goblinoid). The same name comes first; otherwise the creature most like the monster wins: a caster for a caster (a controller, or a name like Mage, Shaman, Hexer), an archer for an artillery, a boss for a leader, then the nearest in level (the challenge rating of 5e against the level of 4e) and in size, so an Elder White Dragon takes the Young, Adult or Ancient one by its level. A role, a size, an element or a colour alone (Giant, Fire, Warrior) is not a creature, a name that ends with a role is not looked up by it, and what follows "of" is a name: "Giant Sea Snake", "Fire Drake" and "Adept of Orcus" get none. Without the bestiary files the match is by the name alone (the creature the name begins or ends with). About 40% of the monsters get a token this way. The monsters with no token keep the default image of Foundry, and so do the traps.

```
npm run tokens:list      # the list of tokens in the repository (3 calls to the GitHub API), saved in out/tokens/list.json
node fetch-tokens.mjs --bestiary   # the 5etools bestiary files of those books (110 files, 12 MB), saved in out/tokens/bestiary/
npm run pipeline         # (or npm run tokens:apply) sets the actors' portrait and token image to dnd4e-tokens/<book>/<name>.webp
npm run tokens           # downloads the matched tokens (about 600 files, 100 MB) to G:/Foundry/FoundryVTT/Data/dnd4e-tokens
```

The images are art of the books and are not part of this project: they are downloaded to your Foundry data folder (`--to <dir>` or `DND4E_TOKENS_TO` for another one, and then the path in the actors has to match), never to a repository. Without the list, `apply-tokens.mjs` changes nothing; an actor whose file is not downloaded shows a missing image.

## Tests

`npm test` runs without Foundry:

| What | How |
|---|---|
| Parsers and builders | on **invented** fixtures (`tests/fixtures.mjs` and the fixtures inside each test file; no book text), one behaviour per test, named after the bug it guards |
| Damage and attack numbers | `tests/db-sim.test.mjs` "rolls" every power for fictional characters with `tests/sim/sheet.mjs` (the system's rules) and compares it with `tests/sim/oracle.mjs` (the number the Rules Compendium gives); it never reads the item's formulas |
| The whole real database | invariants over `out/db` (static validation against the system's enums, id uniqueness, plausible ranges, known entries); skipped when `out/` is missing |
| Mutation checks | a deliberate break of a rule must make a test fail (done by hand when a rule is added) |

Inside Foundry (a world on the `dnd4e` system, the importer active, the database published):

- `macros/validate-powers.js` checks that the real data model keeps every field and effect of the chosen files.
- `macros/smoke-test.js` is read-only (it builds actors in memory) and checks the monsters' printed numbers after the system's own derived data, that effects apply and stack as 4e says, that feature bonuses transfer, and that the race and class sheet fills give the numbers of the book.

`tests/sim/sheet.mjs` copies the system's *rules*, not its code: if the system changes how powers are computed, update it.

## Related repositories

- [`foundry-dnd4e-importer`](https://github.com/DerickDiasDev/foundry-dnd4e-importer): the module that reads this database.
- [`foundry-dnd4e-system`](https://github.com/DerickDiasDev/foundry-dnd4e-system): a fork of the `dnd4e` system with the changes this work needs (a primary ability field).

## License

Not chosen yet; until one is added, all rights are reserved. The code is for personal use. The data it produces comes from copyrighted books and is not to be redistributed.
