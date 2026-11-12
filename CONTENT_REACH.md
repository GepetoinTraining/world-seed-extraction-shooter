# How much content a world can hold

Pedro, 2026-11-12, after playing a good while: "The worlds need to regenerate the materials, even the tutorial one, right now it's not a lot of variance. We need to check how much content is possible."

This is that check, read from the code at `481f5fe` (main at `854bcce` plus the shooting branch). Sections 1 to 6 describe and count what the game does today. Only section 7 proposes anything, and each proposal there is marked.

**How it was counted.** The shipped pack (`shared/entities/generation/packs/firstTheme.ts`) was counted by a script that reads it, not by hand. The places a world holds were counted by building chunks with the game's own `WorldGenerator.buildChunk`: 120 chunks drawn at random from two worlds of each size (seeds `measure-a` and `measure-b`), at difficulty F and today's ground (`GROUND_VERSION` 5), then multiplied up to the world's whole count of chunks. Two seeds of one size agree within 5%, so a figure below is good to about that. The law, the writing passes and the mint were read by hand. A Sonnet reader read the mint screens (`WorldCreator`, `ThemeTalk`, `MissionControl`, `WorldDeed`) and its answers were spot-checked.

| Section | What it holds |
|---|---|
| 1 | One world as it is made today: what the pack gives, what the seed rolls, and how many places of each |
| 2 | What makes one world differ from another, and what cannot differ |
| 3 | How a person comes by a different world |
| 4 | What a theme's writer is asked for: every floor and every ceiling |
| 5 | The stored content: pulled by meaning, selected, then added to |
| 6 | What most limits variance |
| 7 | Proposals |

## 1. One world, as it is made today

### What comes from the pack

Every world reads one pack, the theme its certificate pinned (`ContentRegistry.contextFor`). A fresh game holds one pack, "The Long Audit". Its counts:

| List | Count | Notes |
|---|---|---|
| Kinds of ground (regions) | 5 | Always the same five: wasteland, overgrowth, ruins, industrial, cyber city. A pack only names them. |
| Materials | 10 | 5 that grow (chaffwheat, accrual berry, ledger gall, teller's reed, compound oak), 5 that lie (vault stone, tally pebble, counting sand, collateral iron, sovereign silver). 9 are rank F, 1 is rank D. None restores energy, so no world on this pack has a rare find. |
| Creatures | 27 | 12 animals and 15 monsters. 10 are elites (one of them a god). By rank: F 6, E 7, D 6, C 4, B 1, A 1, S 2. |
| Gear nouns | 27 | 8 weapons (2 blades, 3 bludgeons, 1 bow, 2 foci), 5 armour, 5 jewellery, a quiver, 4 carriers, 5 tools. 2 can be made. |
| Affixes | 19 | 10 prefixes, 9 suffixes. 13 land on gear, 2 on materials, 2 on creatures, 1 on a frame, 1 on a cart. |
| Abilities | 8 | |
| Goods | 9 | made from materials, 2 of them at a station |
| Stations | 2 | |
| Consumables | 4 | |
| Junk | 6 | what a body leaves |
| Anchors | 5 | gems and art, found in chests |
| Professions | 5 | |
| Lore lines | 8 | |
| Loot tables | 27 | one per creature (`firstThemeLoot.ts`). None for chests: a chest rolls the generic table by its rank. |
| Terrain dressing | 0 | The pack names no impassable or skilled ground, so the land is drawn as the code's default. |

A material's numbers come from four of its words only: its form (8 forms), its rank, its weight (3) and its worth (3) (`ThemeFormula.materialNumbers`). Chaffwheat and teller's reed are both `grain / hands / F / light / common`, so they are the same numbers under two names.

### What the seed rolls, per world

Everything below is a pure function of the world's seed and the place (`WorldGenerator`). Nothing a model says reaches it.

- The shape of the land: a rough disc of sectors.
- Where each of the five kinds of ground lies (two noise fields, about seven chunks across).
- The rank of each chunk: the world's difficulty, and up to two ranks above it (`MAX_CLIMB`).
- Where forests stand (a third noise field), and in each quadrant of 16 by 16 tiles:
  - a ruin with a chest and two guards, 1 quadrant in 10;
  - a pack of one kind of creature, 1 to 3 bodies, 45 in 100;
  - 9 to 18 trees, where the forest noise is over one half and the land has a tree;
  - 1 to 4 scattered materials, each picked evenly from the land's table;
  - a survivor, 6 in 100, named from 8 first names and 7 surnames written in the code;
  - a rare find, 1 in 2,000, if the pack has one for that ground;
  - a loose stone to throw, half of all quadrants, 1 or 2, on ground whose table has no pebble.
- Four exits a sector, the leaders on each sector's roster, and once a world has turned, each body's variant (`Director`).

### How many places a world of each size holds

A world is counted in sectors of 512 by 512 tiles; each holds 64 chunks.

| Deed size | Sectors | Chunks | Material places | Of which trees | Creatures at alpha | Chests | A cycle of its gate |
|---|---|---|---|---|---|---|---|
| 16 | about 176 | about 11,300 | about 1.7 million | 75% | about 200,000 | about 18,000 | 3 hours (1 up) |
| 32 (the tutorial's size) | about 720 | about 46,000 | about 7.1 million | 75% | about 810,000 | about 72,000 | 10 hours (4 up) |
| 64 | about 2,890 | about 185,000 | about 29 million | 75% | about 3.3 million | about 280,000 | 32 hours (12 up) |
| 128 (no deed gives it) | about 11,600 | about 742,000 | about 110 million | 75% | about 13 million | about 1.1 million | 14 days (5 up) |

A chunk holds about 150 material places, of which about 112 are trees and 38 are everything else, about 18 creatures, 1.5 chests and one survivor.

Of the places in a 16 world, by kind: compound oak 75%, tally pebble 5.6%, vault stone 3.9%, teller's reed 2.7%, collateral iron 2.7%, sovereign silver 2.6%, chaffwheat 2.1%, counting sand 2.0%, ledger gall 1.9%, accrual berry 1.7%. Sovereign silver, rank D and worth "rare", lies about as often as collateral iron at F, because a scattered material is picked evenly from its land's table whatever its rank or worth: in the cyber city and the industrial ground it is one pick in four.

So the count of places is very large and the count of kinds is very small. A person never runs out of ground; they run out of different things on it.

### What is taken, and what comes back, today

A world's land is never stored. Each time a person opens a world its map is built again from the seed (`WorldGenerationService.activateWorld`), and only records lie over it: chests, the population, carts. There is no record of what was taken from the ground. So:

- Within one opening, a plant that is stripped comes back after 90 seconds (grain), 2 minutes (shrub), 3 minutes (fruit) or 10 minutes (tree), the same plant, on the device's clock (`Date.now()`), and only while its chunk is loaded. A table by form sets the times (`FORM_REGROW_MS`). Found while building part 2: in a chunk where creatures walk, the field undid that return in the frame it was made (ledger RGs), so there a plant came back only on a sweep when nothing in its chunk moved.
- Within one opening, a mineral that is stripped is removed and never returns.
- At the next opening, everything taken stands again, exactly as it was: the same kind, the same count, in the same place. A taking is forgotten. This is the "not a lot of variance": the same ground hands over the same things every visit.
- A harvested material always has quality 0. Two takings differ only in how many fall (1 or 2 a use) and, in a world whose magic is unlocked, a dreamed affix.

## 2. What makes one world differ, and what cannot

Two worlds on the same pack differ in:

- the seed, so everything in section 1's seed list;
- the size (16, 32 or 64 from a deed) and so the cadence of its gate;
- the difficulty (the floor its ranks climb from), the sky (turning, locked, night), access, fees, PvP and death rules, signed on the certificate;
- over time, what happened in it: who fell and who was born (`Population`), leaders' goals and territories, chests emptied, creature lines that changed at a regeneration, and, where a model writes the words, what the world grew (new creatures, materials, affixes, abilities and lore, `WorldGrowth`). With no key a changed creature stands on plain words ("X, as of regeneration n") and nothing new grows.

They cannot differ in:

- the five kinds of ground, the grid, and every per-quadrant odd above;
- the kinds of thing in them: every world on The Long Audit holds the same 10 materials, 27 creatures, 27 gear nouns, 19 affixes, 8 abilities and 27 loot tables;
- what a material is in numbers, given its four words;
- the forest's tree: a forest only ever grows the first timber of its land, by id (`pool.find(isTimber)`), so a land with three trees grows one in its woods;
- the survivors' names and temperaments, from tables in the code (56 names);
- what a harvest gives in quality (always 0).

## 3. How a person comes by a different world

The zones list in Mission Control offers:

- **The tutorial.** First on the list, always open, rank F. Its seed (`dev-sandbox-v4`), size (32) and pack (the hub's first, so The Long Audit) are fixed in the code, so every newcomer on every hub walks the same land. It turns, from the day the hub first held it, every 10 hours.
- **Worlds of their own.** "+ MINT NEW WORLD" with a deed. Every new character gets one deed of size 16; more drop from creatures, likelier from bosses, in sizes 16, 32 and 64. The mint asks a name (the only thing required), a description up to 500 characters, a world type, the deed, a sky, access, danger, PvP and fees.
  - With a model answering, an optional talk and "WRITE IT" write a new theme in passes from the hub's pool (section 5). It is judged by the law and banked, and from then on every later mint on that hub can pick it.
  - With no model, the talk says it is not answering and the person picks a theme already written from a list (`ContentRegistry.offered()`), which defaults to the hub's first. On a hub that has banked nothing, that is The Long Audit, so a newcomer with no key makes every world from the one shipped pack, differing only by seed, size, difficulty and sky.
- **The hosted world.** One per hub, joined after the tutorial's first order is sealed.

A newly written theme adds over the shipped one: its own premise and region names, and new flora, fauna, minerals, junk, anchors, professions, terrain and lore where the pool has nothing that fits. It does not add gear, goods, stations, consumables, abilities or affixes of its own: those passes pick only (section 4).

## 4. What a theme's writer is asked for

### Floors (the law refuses a pack below them)

From `ThemeLaw.validate`, the pass schemas (`WorldPasses`) and the loot law:

- a name and a premise; a region name for every one of the five kinds of ground;
- on every kind of ground, at least one creature and at least one material that is not an energy plant;
- at least one creature at rank F or E; a weapon, a piece of armour and boots at rank F; a chop tool or mine tool if any material asks for one; at least one material that builds;
- at least one line of lore; at least one anchor; at least one social elite that leads a social kind; both an animal and a monster tree; junk for every creature;
- among the gear affixes, at least three stats added to a figure and three read as ratings;
- every good, station, profession, affix and junk names at least one of whatever it is made from, works or lands on;
- a creature's own loot table holds lines at three different odds at least (`LOOT_OWN_SPREAD`);
- a creature line that changes shows at least one feature; a names pass writes at least one new prefix.

None of these is a problem for variance: each asks for more, never less.

### Ceilings (against his rule: "never simplify with a cap")

- **Gear, goods, stations and consumables are picked, never written** (`WorldPasses`, the `made` pass: "Pick only"). A written world adds none of its own; a gear kind no pick answers is the one exception, through the `lack` pass.
- **Abilities and affixes are picked, never written** (the `known` pass). With one pack in the pool, every world written on a fresh hub carries a subset of the same 19 affixes and 8 abilities.
- **The lack pass adds to one list at a time**; every other list in its schema has `maxItems: 0`.
- **Exactly five regions, one per kind of ground** (`minItems` and `maxItems` 5), and the five kinds are the same in every world.
- **Exactly one impassable and one skilled ground** ("must be dressed exactly once").
- **Energy plants**: the prompt asks for "one or two at most". Words, not a check.
- **Deed sizes** 16, 32 and 64 (`WORLD_DEED_SIZES`). The clock has a cadence for 128 and its own comment says "Nothing here is a ceiling on size", but no deed gives one.
- **Survivors' names, temperaments, objectives and wants** are tables in the code (8, 7, 5, 4 and 3 words), not content.
- **A drop's rank** is its source's or one below, never above (`LOOT_RANKS`).
- **The forest's tree** is one per land (section 2).
- **Closed word lists the formula reads**: 8 material forms, 3 harvest verbs, 3 weights, 3 worths, 21 gear kinds, 5 sizes, 6 behaviours, 3 builds, 3 threats, 3 paces, 3 reaches, 3 sweeps, 2 hollows, 4 volleys, 3 consumable kinds, 3 stat bands, the stats `STAT_SCALE` holds, 6 deliveries, 8 effects, 4 triggers, 5 cost bands, 11 line features, and a look of 10 colours, 12 shapes and 4 sizes. These are the formula's grammar, not caps on how many things a world holds, but they cap how many different numbers a thing can have: there are 72 distinct materials in numbers at each rank (216 counting how each is taken), however many are named.

The per-quadrant numbers (1 to 4 scattered, 9 to 18 trees, a ruin in 10, a pack in 45 of 100) are densities, marked in the code as guesses, not caps on content.

## 5. The stored content: pulled by meaning, selected, then added to

His design: a theme is what a dive is about; content is pulled by meaning from what is stored, the model selects, then adds, and never copies.

- **Built.** `WorldPool` holds everything the hub's installed packs hold, one entry per thing (an oak two worlds share word for word is one oak), in 13 lists. The pull is by counting, with no embedding model (PPMI over the pool's own words, ranked by how distinctive an entry is to the fields the theme resembles), and offers what scores above its list's own mean, with no fixed count. `WorldPasses` asks a model in eight passes (ground, terrain, flora, fauna, people, holds, made, known), then `lack` and `names`. In each the model picks by id from what was offered, then writes what is missing in words; code rolls every number. `writeForMint` runs it at the mint; `server/hub/poolLaw.ts` judges it on the hub.
- **Partly.** "Adds" holds for the land and what lives on it, not for what is made, worn or known (section 4's first two ceilings). The pool is only this hub's installed packs: on a fresh hub it is one pack, so the first written world can pick from 10 materials, 27 creatures, 27 gear nouns and 19 affixes, and nothing else. A world's growth at a regeneration (`WorldGrowth`) is written new, without a pull.
- **Not built.** Pulling at a dive. A theme is pulled once, at the mint, for the whole world, and a dive reads only its world's pinned pack. Nothing pulls from other hubs' worlds. Nothing writes without a model: with no key nothing is pulled, selected or added, and the mint falls back to a theme already written.

## 6. What most limits variance

1. **What is taken is forgotten.** The ground is rebuilt from the seed each opening, so every visit to a place hands over the same thing, and a mineral stripped in one visit is back whole in the next. Lifting it needs a record of what was taken, laid over the land like the chests' record, and what comes back rolled anew. Part 2 of this work builds that.
2. **One pack, and a newcomer with no key never leaves it.** Every world a newcomer can make holds the same 10 materials and 27 creatures; the tutorial is the same seed for everyone. Lifting it needs more packs in the shipped pool, or a mint with no key that draws a world's lists from the pool by its seed (a keyed selection, no model) rather than taking a whole pack.
3. **Kinds are few and evenly drawn.** A land's table holds 4 to 8 kinds, a forest one tree, and a scatter picks evenly whatever the rank or worth, so the silver that is meant to be rare is as common as iron, and a material's numbers come from four words. Lifting it needs the pick weighted by what a thing says of itself (rank and worth, as creatures are already weighted by rank), the forest drawn from every tree the land has, and more of a material's words read by the formula.
4. **What is made and known is never written.** A new theme picks its gear, affixes and abilities from the pool. Lifting it is lifting the pick-only rule in the `made` and `known` passes, so they select and then add, as the land's passes do.

## 7. Proposals

Each is a proposal only, for Pedro to take or strike.

- **P1 (built in part 2).** Materials come back: a record of what was taken from the ground, laid over the land; a place comes back after a wait the formula reads from the material's own words, counted in turns of the world's gate; what comes back is rolled anew, keyed by the place, the seed and the turn it came back in.
- **P2.** Weight the scattered pick by rank and worth through the formula, as `pickSpawn` already weighs creatures, and let a forest draw from every timber its land holds. A new `GROUND_VERSION`, so standing worlds keep their land.
- **P3.** Let the `made` and `known` passes select and then add, as the land's passes do: a world's own gear nouns, affixes and abilities, judged by the same law.
- **P4.** A no-key mint that builds a world's lists from the pool by a keyed roll on its seed (selection only, no words written), so a newcomer's second world is not the first pack again.
- **P5.** Give the tutorial a seed per hub, so two hubs' newcomers do not walk the same land.
- **P6.** Move the survivors' names and temperaments out of the code's tables and into the pack's words.
