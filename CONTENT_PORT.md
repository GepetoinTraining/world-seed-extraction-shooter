# Content written into the code, and its port to logic

Pedro, 2026-11-12: "finally, together with this, can you run a full "inlined" or "hardcoded" content and port it to logic with how to operate over for the API calls?"

This is phase 1 of that: the audit, and how the port would run. Nothing in the code was changed to write it. It was read from main at `d27d8a3`, while three sessions (ux-cards, ux-sheet, ux-fight) were changing some of the same files, so a line number in a file they touch may have moved by the time the port starts.

The rule it rests on is his: "never simplify with a cap or hardcoded table; LLM content is virtually infinite". A world's content is meant to be words a model writes through the one door (`server/intelligence/index.ts`), judged by a law, turned into numbers by one formula (`shared/logic/theme/ThemeFormula.ts`). Content that sits in the code cannot grow with what the model writes. Laws and formulas are logic already and stay.

| Section | What it holds |
|---|---|
| 1 | The six classes, and the counts |
| 2 | The list by class: where each thing is, how big, what reads it |
| 3 | The port of each A, B, C and F entry: its law, its request, where its answer is kept, when, which model, what it costs, what stands with no key, and the bar that would pin it |
| 4 | How the calls are operated: one section a builder can follow alone |
| 5 | The port in order: plumbing only, design calls, and what waits for the UX joins |
| 6 | What was read whole, what was only searched, and what was not looked at |

## 1. The classes, and the counts

| Class | What it is | What happens to it | Count |
|---|---|---|---|
| A | Content to be written through the door: a thing, a list of things, a name for a particular thing, an item built inline, logic keyed to a particular content id | Gets a law and a request, and is kept where its kind is kept. Today's words become the floor that stands with no key | 17 entries |
| B | A pack: a model's answer frozen into code so a start needs no call | Says which law and request made it, whether the same request can write it again, and what hangs on its bytes | 4 in the game, 2 in tools |
| C | A closed list that caps what the model may name | Opens by composition where a new member can be made of parts the code already reads; stays closed where each member is code (a reader, a drawing, a geometry) | 14 entries |
| D | A law's own constant or formula | Stays | About 140 of the scan's 173 tables of 8 lines or more, and most of the small ones. The ones a reader could mistake for content are listed in 2.4 |
| E | Interface words: a label, a refusal, a feed line in the game's voice | Stays | About 2,900 strings: about 1,700 in `src/components`, 390 in `src/entities`, 475 in `server`, `landing`, `scripts`, `src/render` and `HubCanvas.tsx`, and the rest in `src/logic` and `shared` by the scan's count. Estimates from reading, not tallies |
| F | Words about one particular thing: a description, a name, the sentence under a stat | Should come with that thing's own record when it is written | 8 entries |

The coordinator's scan (`content-scan.txt` in the notes folder) listed 296 top-level tables. Most of the large ones are laws: objects of functions, schemas, stores, doors. Of the 173 tables of 8 lines or more, 16 are content (A, B, C or F), about 16 are interface words, and the rest are laws. The scan does not see content inside functions; about half of the A entries below were found there.

Two findings shape everything after:

- **Most of the old tables are already gone.** `RESOURCE_DEFINITIONS`, `ITEM_DEFINITIONS`, `MOB_DEFINITIONS`, `RECIPE_DEFINITIONS`, `GEAR_RECIPES`, `CRAFTED_DEFINITIONS`, `AFFIX_DEFINITIONS`, `AFFIX_BATCHES`, `LORE_FRAGMENTS` and `SHELF` are empty registries, filled when a theme is installed (D53); only `tests/fixtures/content/` fills them for the older bars. So the `shared/entities/*/data/*.ts` files the brief names are not content any more. What is left is the content that never went through a theme: the hub, the game's own acts' items, the world's looks, and the closed lists.
- **The door is ready for it.** `MaterialDoing` and `MaterialDoingWriter` (ML21) are the whole pattern in two files: a law, an ask, a refusal sent back once, a floor with no key, kept once and never written again. `KamiPersona` is the same for something a hub holds. Section 4 is written from them.

## 2. The list by class

Paths are from the repo root. A size is in lines of the table, or in entries.

### 2.1 A: content to be written through the door

| # | What | Where | Size | What reads it |
|---|---|---|---|---|
| A1 | The hub's names: the hub ("New Carleon"), its 6 districts, its 13 buildings and lots | `src/entities/hub/hubManifest.ts:85-120`; again as `HUB_GENRE` in `src/render/atoms/hub.ts:22` and as the creation screen's fallback hub in `src/components/CreationFlow.tsx:147` | 36 lines; 20 names | `HubGenerator.generate`, `raiseChunk`, the city's drawing, `TavernRoom`, `TemplateStudio` |
| A2 | The hub's ten keepers: name, title, greeting, dialogue options, colour, and which three train people | `src/entities/hub/HubGenerator.ts:36-189`; their looks keyed by id in `shared/render/atoms/people.ts:399-490` | 154 lines; 10 people | `HubCanvas.tsx` (the dialogue window), `hub/store.ts` (people, feed lines), `talkStore.ts`, `money.npcRank`, `ApprenticeRoad.generalKeepers`, `GuildHall`, `ApprenticeWindow` |
| A3 | Logic keyed to particular keepers | `src/entities/hub/store.ts:100` `SHOP_VENDOR`, `:102` `TAVERN_KEEPER`, `:104` `COUNTER_NPC`, `:151` `SHELF_OF`; `src/entities/hub/money.ts:44` `GROUND_KEEPER`; the hub's three shops (weapon, armour, consumables) are three keepers by id | 7 tables | the shops, the counter, the week's books |
| A4 | Watered Ale, an item built inside a dialogue handler: name, tags, worth 5, heals 15, its line | `src/entities/hub/dialogue.ts:172-186`, with `drink_ale` in the barkeep's option in `HubGenerator.ts` | 1 item | `BUY_CONSUMABLE` |
| A5 | Insurance: two charms (Clasp of Keeping, Gambler's Knot) and one scroll (Scroll of the Kept Hand), each with slots, choice, uses or duration, worth and a line; the scroll's bill names `crf_paper` and `crf_ink` | `src/logic/systems/InsuranceSystem.ts:41-79` | 3 items, 39 lines | the shelf `hub/store.ts:2840-2862`, the scribe in `TemplateStudio.tsx:356` |
| A6 | Six cognitive frames: name, line, kind (LOGIC, INSTINCT, SOCIAL), colour and attribute modifiers | `shared/entities/player/data/cognitiveFrames.ts:3`; their marks per kind in `src/render/atoms/items.ts:37-60` | 89 lines | `PaperDoll.tsx:304`, `player/store.ts:442`, `LoadoutSystem.ts:278` |
| A7 | Four system templates and three room presets (Keeper's House, Carpenter Mill, Market Stall, Keeper's Cottage), and the four base stations they place (`stn_bench`, `stn_counter`, `stn_table`, `stn_scribe`) with their room sizes and what each opens | `shared/entities/hub/template.ts:415-473`; `shared/entities/hub/room.ts:338-360` | 60 lines | the guild's houses (D8: "NPCs never design"), `SHELL_STATION`, `ownerHasBench`, `hubTech.ts:168`, `SourcingAudit.ts:71`. The presets have no reader in the game. See CP14: the four stations are defined only in the test fixture |
| A8 | Three material affixes (Compressed, Volatile, Ley-Touched) | `src/entities/world/MaterialScience.ts:14` | 17 lines | `player/store.ts:2128` only. Close to a relic |
| A9 | Survivors' names: 8 first names and 7 surnames, for every world | `shared/entities/world/WorldGenerator.ts:150-151`, used at `:542` (`personName`, the tutorial's person) and `:757` (a survivor) | 2 lines, 15 names | every person a world lays |
| A10 | Items the game's own acts make, built inline: the snare, the caged contact, spoiled work and its three lines, the packed cart (and the cart's body in the field), meat, the lore fragment (built twice), and the old loot's "Salvaged Component", "Something Unnamed", "Relic of …", "Raw …" | `shared/logic/systems/Capture.ts:103,129`; `shared/logic/systems/PairCraft.ts:48-52,171`; `src/entities/world/CartSystem.ts:63-66`; `src/components/WorldCanvas.tsx:649-652`; `src/entities/hub/herd.ts:185-194`; `src/entities/world/LootTable.ts:142-147` and `src/entities/player/store.ts:2353-2358`; `LootTable.ts:200-212,255,279,448` | 10 items | the makers; chests; the pen |
| A11 | A world's look: chosen from five hand-made genres (Fantasy, Eldritch, Sci-Fi, Post-Apoc, Retro: a palette and a ground pattern each) by a hash of the seed, whatever the world is about; and a shoulder piece's name per genre that nothing reads | `src/render/atoms/world.ts:22-40`; `shared/entities/player/systems/LoadoutSystem.ts:505-513` | 19 lines | `WorldCanvas.tsx:1358` (the field's renderer) |
| A12 | Each kind of ground's look and stuff, the same in every world: its material numbers, its tint, its recon pattern, and water's and rock's | `src/render/atoms/world.ts:72-78,101-104`; `src/render/atoms/recon.ts:25-36`; `shared/entities/world/TerrainSystem.ts:61-67` | 4 tables, 5 grounds each | the field's ground, recon |
| A13 | The hub's buildings drawn by kind: an emblem, a roof and a floor per kind of building or district, a roof per kind of lot, the fountain and the lamp | `src/render/atoms/hub.ts:24-27,96-121,166-216,298-321,446-458,490-513` | about 9 kinds | the city's drawing |
| A14 | Weapon words the formula reads a strike shape from when a kind names none: "spear", "pike", "halberd", "glaive", "knife", "flail" and the like | `shared/logic/theme/ThemeFormula.ts:568-572` | 5 lists, 38 words | `strikeWordsOf`, for the pinned pack's gear |
| A15 | A relic: a lore brief for a model that is no longer asked, and a name generator that returns "Kael Steelweave" | `src/entities/lore/LoreBible.ts:8-20`; `src/entities/identity/IdentityGenerator.ts` | 27 lines | `IdentityGenerator` only, which nothing calls |
| A16 | The four archetypes' attribute blocks, and "OPERATOR" as the default archetype in about 12 places, "NOMAD" as every resident's face | `src/entities/player/store.ts:87-92`; `IdentityGate.tsx:80,112,113,222,228`, `LargeSheet.tsx:141-143,303`, `PaperDoll.tsx:161`, `WorldCanvas.tsx:1344,1376`, `TavernRoom.tsx:24` | 6 lines and 12 uses | `initializeSession`, the figures |
| A17 | Acts keyed to particular registry words or content ids, inside functions: which skill tags an act trains (`InteractionEngine.ts:60-263`, ten sets; `player/store.ts:945-2418`, eight sets; `farmDoors.ts:165-442`, four skills); what a resident eats or walks to (`guild.ts:310-356`, `residentDay.ts:40-49`); a scanner found by its name containing "Scanner" (`InteractionEngine.ts:251`); `ground_cache`, `struct_store`, `cart_field`, `int_study`, `skill_analysis` | as given | about 30 places | the acts themselves |

A17 is mostly law: an act is code, and naming the registry word it trains is how the code says which skill grows. It is listed because a world whose registry lacks the word has no skill for that act, and because the same pairing is written again in each place. `WorkCost.pairOf` (EN) already holds one act's pairing as data; the rest could read from there.

### 2.2 B: packs

| # | What | Where | Size | What reads it |
|---|---|---|---|---|
| B1 | The web's batches: the tag registry (run 005, 185 tags, each with a kind, a meaning, a player's word and refused spellings), verbs, verb links, skill names by tag set (run 006 and runs 007 to 010) | `shared/entities/generation/packs/webBatches.ts:16` | 326 lines | `prompts.ts:20-29` builds `REGISTRY` from it, and every system text of the door carries it; `WebBank.packAt` and `WebBank.version()` (a world pins the web version it was minted on); `ContentRegistry.install` appends a theme's tags to it; `scripts/run-affix-batch.ts` |
| B2 | The first theme, "The Long Audit": regions, tags, abilities, 27 creatures, 10 materials, stations, goods, 27 gear nouns, consumables, 19 affixes, lore, junk, anchors, professions | `shared/entities/generation/packs/firstTheme.ts:19`, sealed in `shared/logic/theme/boot.ts:14` | 175 lines | `installShippedThemes`; `Hub.ts` (`SHIPPED_THEMES`); 11 test files |
| B3 | The first theme's loot, one table to each creature | `shared/entities/generation/packs/firstThemeLoot.ts:36` | 110 lines, 27 tables | `src/logic/theme/LootBook.ts:51` (`admitShipped`) |
| B4 | Who you were: one batch of origins (8), kits, questions, closings, skill lines for when no model writes one, fate's names and lines | `src/entities/generation/packs/originBatches.ts:48` | 142 lines | `src/logic/content/OriginBank.ts`, `CreationFlow`, `LargeSheet` |
| B5 | Tools, not shipped: the chain trial's tribe and its extra words; the site's four figures and six creatures | `scripts/chain-trial.ts:23-65`; `scripts/build-brand.ts:262-283` | 60 lines | those scripts only |

### 2.3 C: closed lists

| # | What | Where | Size |
|---|---|---|---|
| C1 | The stats: every stat a batch may name must be a key of `STAT_READERS`, or `AffixBank` refuses the batch whole; a gift's stat must be one of `PASSIVE_STATS`; `STAT_SCALE` sizes only those; `ISimulationStats` is the sheet's own list | `shared/logic/systems/StatSystem.ts:27`; `shared/logic/theme/ThemeTypes.ts:102`; `ThemeFormula.ts:491`; `src/entities/player/types.ts:25-81` | 36, 17, 35, about 47 |
| C2 | Gear kinds: 21 nouns, each with a body slot, tags and implicit lines | `ThemeTypes.ts:46`; `ThemeFormula.ts:457-483` (`GEAR_SHAPES`) | 21 |
| C3 | What an ability or a piece does: effects 8, deliveries 6, triggers 4 (and the field fires only those four, `WorldCanvas.tsx:1172,1173,1288,1289`), skill grants 1 (rest) | `ThemeTypes.ts:86-97` | 19 |
| C4 | The kinds of ground: always the same five, which a world only names | `ThemeTypes.ts:31` | 5 |
| C5 | What a thing looks like: 11 features a changed creature can grow, 10 colours, 12 shapes, 4 sizes | `ThemeTypes.ts:111,303-305`; drawn by `shared/render/atoms/atoms.ts` (`LOOK_HUES:94`, `FEATURE_STROKES:376`) | 37 |
| C6 | How a material lies and is taken: 8 forms, 3 verbs | `ThemeTypes.ts:41-42`; `ThemeCompiler.ts:79-83` | 11 |
| C7 | A world's look: five genres | `src/render/atoms/world.ts:37` (`GENRE_ORDER`), `GenreType` | 5 |
| C8 | A person's nature: temperament 5, objective 4, want 3 (a survivor and a monster that thinks); a leader's drive 5 and nature 6; a leader's goal 6 | `WorldGenerator.ts:152-154`; `src/entities/interaction/talkStore.ts:200-202`; `shared/entities/world/Leaders.ts:29-30`; `ThemeFormula.ts` `GOAL_BANDS` | 29 |
| C9 | The seven trades a process step knows (carpentry, smelting, weaving, glassblowing, alchemy, masonry, smithing) | `shared/logic/systems/ProcessSystem.ts:30` | 7 |
| C10 | A material's seven physical properties | `shared/entities/economy/types.ts:165` | 7 |
| C11 | The four silhouettes and archetypes, and the six places a kit draws from | `src/logic/content/OriginBank.ts:11-12`; `player/store.ts:87` | 10 |
| C12 | Words every world must hold without being asked: a wall wants `building`, a door `wood`, a window `glass`, a workshop `metal`, a plan and a scroll `paper` and `ink`, a snare `fiber`, a meal or a resident's food `food`, `berry`, `fruit`, `grain` | `room.ts:237-280` (`PIECE_BILLS`, `SHELL_BILLS`); `template.ts:70`; `InsuranceSystem.ts:76`; `Capture.ts:94`; `hub/store.ts:1284-1286`; `guild.ts:310`; `TemplateApplyModal.tsx:59-71`; `TemplateStudio.tsx:232,365` | 9 words in 10 places |
| C13 | Building kinds and what a station opens: house, workshop, vendor; workshop, vendor, scribe; nine kinds of building drawn | `room.ts:338-360`; `src/render/atoms/hub.ts:24-27`; `HoldingsPanel.tsx:25` | 15 |
| C14 | Grammar a formula reads, closed on purpose: ranks, every band (stat, cost, judge, promise, harm, quest size, lore stretch), sizes, behaviours, build, threat, pace, weight, worth, strike reach, sweep and hollow, volleys, consumable kinds, what a material restores, the two terrain roles, the required trees, the four mastery rungs, the word kinds, what a loot line drops | `ThemeTypes.ts`, `TalkTypes.ts`, `LoreConstants.ts`, `WebSystem.ts:54`, `WorldPasses.ts:63`, `LootLaw.ts:28` | about 25 lists |

### 2.4 D: laws a reader could mistake for content

All stay. `LEGACY_SKILLS` (`WebSystem.ts:847`, dead skill ids for migration only, closed by its own comment); `STRUCTURE_COSTS` and `PLAYER_SHOP_TAX` (`recipeDefinitions.ts:64-73`); `GEAR_SHAPES`' implicit ranges and `STAT_SCALE` (`ThemeFormula.ts:457-501`); `LAND_NUMBERS`, `ROSTER_NUMBERS`, `TERRITORY_NUMBERS` (`ThemeFormula.ts:165-240`); `RANK_BANDS` (`WorldGenerator.ts:140`); `BASE_SIMULATION_STATS` (`player/types.ts:108`); the rank tables in `LootTable.ts:387-427`; the hub's lot and chunk numbers in `NEW_CARLEON` (`hubManifest.ts:89-95`) and its layout matrices (`:121-300`), which are the city's geometry by design ("Think Carleon from Albion"); `PIECE_BUILD_SECONDS`, `SHELL_BUILD_SECONDS`; the game's own ways (`gameWays.ts`); `HUB_ITEM_DEFINITIONS` (`server/hub/Hub.ts:157`, a lookup over the installed themes, holding nothing); the ladder of needs (`NpcAgenda.ts:38`, Pedro's Maslow); `PAY_SHARE` (`guild.ts:308`); the hub's type font (`src/render/atoms/hub.ts:36-53`); the frozen seed hashes (`src/entities/world/goldens.ts`); `RANK_COLORS` (`shared/constants.ts:34`); the door's own system texts in `prompts.ts` (the requests are logic).

### 2.5 E: interface words

About 2,900 strings (section 1). The tables among them: `LESSONS` (`Tutorial.ts:48`), `TITLES`, `HINTS`, `DONE_LINES` (`FirstOrder.ts:24-50`), `PASS_SAID` (`WorldPasses.ts:41`), `ODDS_STEPS` (`ExtractLaw.ts:39`), `KIND_WORDS` (`ContactNames.ts:29`), `ENTRY_ITEMS` (`EntryView.tsx:20`), `ROW_WORDS` (`PlayerHub.tsx:392`), the two `SAID_WHEN_CLOSED` (`KamiTalk.tsx:22`, `ThemeTalk.tsx:23`), `SAID_WHEN_SILENT` (`talkStore.ts:138`), `WorkSay.lines`, `FieldWords`, `TOOK_AS` (`TalkLaw.ts:81`), `QUALITY_NAMES` (`atoms.ts:949`), `GROUP_WORDS` (`ProgressionSystem.ts:91`), `SAYS` (`server/record.ts:67`), and the keepers' replies in `dialogue.ts`, which are refusals and confirmations in a keeper's voice.

### 2.6 F: words about one particular thing

| # | What | Where | Size |
|---|---|---|---|
| F1 | A stat as a player reads it, written three times over: `STAT_WORDS` (46), `STAT_SAY` in `SkillSay` (17, the same words), and a material property's name in the card | `shared/logic/systems/StatWords.ts:8`; `src/logic/systems/SkillSay.ts:37`; `src/render/atoms/inspect.ts:69` (`PROPERTY_NAMES`) | 70 |
| F2 | An effect, a delivery, a body's state and a step of learning, in words: `EFFECT_SAY` (8) and its copy in `TheWorking` (6), `DELIVERY_SAY` (6), the body clocks' words (5), `STEP_SHOWS` (4) | `SkillSay.ts:31-49`; `src/components/TheWorking.tsx:21-24`; `src/components/WaitStrip.tsx:67` | 29 |
| F3 | Seven trades' notes, a name and a line each | `ProcessSystem.ts:56` | 7 |
| F4 | Lore and wants in a keeper's mouth: the guild's lore, the dark auction block, the Hall's four chain steps, what each of five needs makes a vendor say, a want's sentence per temperament | `dialogue.ts:197,203`; `guild.ts:334-340,440-449`; `VendorSystem.ts:112` | 16 lines |
| F5 | The hub's people and places named in screens and feed lines: Mags, the Rusty Anchor, the Hall of Banners, the Land Office, the Vault Keeper, Steelweave, Ironfist, the shops' titles, "the city around you" | `hub/store.ts:1188,1195`; `money.ts:114,127`; `GuildHall.tsx:59,267`; `TavernRoom.tsx:2-3,51,53,69,88`; `LargeSheet.tsx:274`; `ApprenticeWindow.tsx:58`; `WorkshopPanel.tsx:42`; `CharacterSheet.tsx:313`; `HubCanvas.tsx:377,1240,1333`; `MissionControl.tsx:72`; `StudyPanel.tsx:51,67`; `TollPrompt.tsx:26,39` | about 30 places |
| F6 | The archetypes said: a line each, the fate gambler's blurb, the site's four | `CreationFlow.tsx:38-43,233-241`; `landing/index.html:119-140` | 9 |
| F7 | What a want and an objective look like from outside | `TalkLaw.ts:50-60` (`SHEET_TELLS`, `AIM_TELLS`) | 7 |
| F8 | Small: a material's own line with no key (`MaterialDoing.ts:59`), the cache's and the store's names (`ContactNames.ts:114`), the affix bank's version names (`AffixBank.ts:37`), "NerveGear Link Established" (`LogStore.ts:78`), "A person has no name until it is asked" in the settings (`SettingsPanels.tsx:73`) | as given | 9 |

## 3. The port of each entry

How to read the columns. **Law**: what judges the answer, and whether it exists. **Request**: what the door is asked, and whether it exists. **Kept**: the store and the key (the stores are the world's theme pack, a world's minting, the hub's, the content bank's, and the tech web's; section 4.7). **When**: the moment the call is made. **Model, cost**: from `MODEL_FOR` and the rates in `shared/intelligence/claude.ts` (per million tokens: Haiku 0.10 in and 0.50 out, Sonnet 2 and 10, Opus 4 and 20; a batch half), with about four characters to a token; a rough figure for one call, and the door's ceiling where it matters. **No key**: what stands when the call is not made or fails. **Bar**: what a test would pin.

"Today's words become the floor" means: the words now in the code move to one file beside the shipped pack, are read only when nothing better is kept, and are never deleted, as `FIRST_THEME` is for a world.

### 3.1 A

| # | Law | Request | Kept | When | Model, cost | No key | Bar |
|---|---|---|---|---|---|---|---|
| A1, A2, A3, F5 | Missing. `validateManifest` holds the geometry only. A new `HubWords.judge`: every district, building and keeper answered; names unique in the hub; no word that stays unsaid (`KamiPersona`'s `HIDDEN`); a greeting one line, under 120 letters; a keeper's look in the look words (C5) | Missing. New kind `hub_words`: the hub's seed, Kami's reading of it, the roles to fill (each building's kind, each keeper's work, which train people), the registry. Words only | The hub's store, `TERRITORIES`, `hub_words_<hubId>`, beside `kami_persona_<hubId>`; written once and never rewritten | The first time anyone enters a hub, as Kami's reading is | Haiku: about 1,500 tokens in, 2,000 out, about a tenth of a cent, once a hub | New Carleon's words, as today: the no-key hub. Keepers' ids, roles and the layout stay code | A hub entered twice asks once (stub counts calls); no key gives today's names; no file outside the floor names a keeper or a building |
| A4 | `ThemeLaw` already judges a theme's consumables | Exists: a theme's `consumables`, and the world's `made` pass picks them | The world's theme pack | When a world is written | Rides the world's writing: nothing extra | The ale moves to the floor, as the first theme's tavern drink | The tavern sells a consumable its world holds, by tag `drink` |
| A5 | D21's contract holds slots, choice, uses and duration; the price law holds worth. A word for the effect is missing (`EFFECTS` has no keeping) | Exists in shape: a theme's consumables and abilities. Needs the effect word (CP9) | The world's theme pack | When a world is written | Rides the world's writing | Today's three are the floor | A charm a world wrote keeps what D21 says; the shelf lists the world's own charms |
| A6 | Missing: frames are no gear kind (C2). D22 holds mind stats to frames | Exists in shape: the `bases` ask writes nouns for a slot | The minting's store, `CONTENT` `mint_<worldUid>`; or the pack's gear | At minting | Rides `bases` (Sonnet, one call a world): a few hundred tokens more, under a cent | The six frames are the floor | A world's frame carries mind stats only; the paper doll lists frames the hub holds |
| A7 | `ItemLaw` for the stations; a template's own law (`template.ts`) for the geometry | The stations: none needed, they are the game's own acts' places. The names: ride `hub_words` | The hub's words, as A1 | As A1 | As A1 | Today's names. First define the four stations outside the fixture (CP14) | A shell's completion mints a station the game defines |
| A8 | `ProcessSystem` and `AffixBank` already hold what a step adds to a material | Exists (the bank's process runs) | The affix bank | Dev time | None | Remove: it is one call from a relic (CP15) | `studyMaterial` reads the bank, or is gone |
| A9 | Exists: a name is one prefix and one suffix of the world's own (`NameWell` in `WorldWriter.ts`, the world writer's ledger row C17) | Exists: the ground pass and the names pass write the pieces | Missing: the well is kept only while a world is being written. Keep `names` (prefixes, suffixes) on the sealed pack | When a world is written | Nothing extra | The 8 and 7 names are the floor, for a pack with none (the first theme) | A person in a written world is named from its pieces; the first theme's still read as today; `GROUND_VERSION` rises |
| A10 | `ItemLaw` (words of an item); the act's own law for its numbers (the snare's parts, the cage's weight, the cart's bed) | Exists: `bases`. Add a list of the game's ways to it: "what this world calls a snare, a cage, a packed cart, spoiled work, meat, a written fragment, a dropped cache", a name and a line each | The minting's store, `mint_<worldUid>`, as `ways` | At minting | Rides `bases`: about 400 tokens more, half a cent a world | Today's words are the floor, read by way id | A snare made in a written world carries that world's noun; one function builds the lore fragment |
| A11, C7 | Missing: a palette of four look words and a ground pattern word (C5's words and `STRUCTURES`) | Exists: the ground pass. Add `look` to its schema | The world's theme pack, `look` | When a world is written | Rides the ground pass (Sonnet, or Opus for a large world): about 80 tokens, a tenth of a cent | The five genres are the floor, picked by seed as today | A written world is drawn in its own palette; the pinned pack's worlds draw as today. The shoulder's names go (CP15) |
| A12 | As A11 | As A11: one look line per kind of ground in the ground pass, which already writes a line per ground | As A11 | As A11 | As A11 | Today's per-ground looks are the floor | Two worlds with different words draw different ground |
| A13 | C5's look words; a building's kind is C13 | Rides `hub_words`: one look per building kind | As A1 | As A1 | As A1 | Today's drawings | The city's drawing reads the hub's words |
| A14 | The registry's tag entry. Missing: a tag's lean (reach, sweep, hollow) | Exists in shape: a tag registered by a world pass or a chain says its meaning; add its strike lean for `tool` tags | The tech web's registry (B1's move, CP13) | When a tag is registered | Rides the pass that registers it | The 38 words are the floor for the registry's first run | A tag a world registered for a spear reads long and thrust |
| A15 | None | None | None | None | None | Delete (CP15) | None |
| A16 | Pedro's design: four shapes and fate (his "4 hardcoded classes, adding a 5th") | None | Stays | | | Stays | The default `'OPERATOR'` read from one place, not twelve |
| A17 | `WorkCost.pairOf` holds an act's skill | None: this is wiring | One table of acts in `WorkCost`, read by every place in A17 | | | Stays | Every act's pairing comes from `WorkCost`; a bar lists the acts |

### 3.2 B

| # | Law | Request, and can it write it again | What hangs on its bytes | Port |
|---|---|---|---|---|
| B1 | `WebBank.validateBatch` (D28's tag law, refused whole) | A dev-time batch (D20: "nothing here calls a model at run time"), checked by `scripts/run-affix-batch.ts`. At run time the `chain` kind and the world passes register words, but into a hub's web or a theme, never into this registry | `WebBank.version()` is its length, and every world pins the version it was minted on; `REGISTRY` in `prompts.ts` is built from it and sits in every cached system text, so a change re-caches every kind; `ContentRegistry.install` pushes a theme's tags onto it | Move the registry to the tech web's store as its first run, so a word the chain or a pass registers reaches the prompts (CP13). Waits for ux-sheet and ux-cards |
| B2 | `ThemeLaw.validate`, sealed by `sealTheme` | Yes: `theme`, or the world passes. But it is pinned by its bytes on purpose: its id is its bytes' hash, and every world pinned to it reads it | Every world on it; `GROUND_VERSION`; `SHIPPED_THEMES` in `Hub.ts`; 11 test files | None. It is the no-key world, and the floor this whole port leans on. Never edited |
| B3 | `LootLaw.correct`, table by table | Yes: `loot` (`LootWriter`), the same request a written world uses | The first theme's chests and drops, by creature key | None needed. Its words are words already, and a rewrite would change what existing worlds drop |
| B4 | `OriginBank.validate` (shown words never name the hidden ones) | None exists. It could be a dev-time batch like B1 | Characters already made keep their origin id | Keep (CP11): the lives are Pedro's own list. Its skill lines and fate's names are a no-key floor already |
| B5 | | | Nothing in the game | Leave |

### 3.3 C

| # | Composition that would let a new one operate with no new code, or why it stays | Law | Request | Kept | When | Cost | No key |
|---|---|---|---|---|---|---|---|
| C1 | **Opens.** A stat is a composition: one reader act (what code reads it: damage out, harm in, health, energy, pace, sight, carry, reach, odds of a find, a clock), a scope (tech-web tags it is limited to: "zombie slayer" is damage against what carries `zombie`; "french-technique cooking" is a clock on `cooking`) and a word. The acts stay code, about twenty; the stats are open (CP4). This is the tech-web ruling: "every stat (non character sheet ones, like "french-technique cooking" or "zombie slayer") ... needs to be rooted in tech web" | `AffixBank` and `PieceLaw` check the act and that the scope tags are registered | Rides what writes affixes today (the world passes, the chain, `bases`); a stat met with no word asks one, as `doing` does | The tech web's store, `stat_<id>`, id from act and scope | When first named | Haiku about two hundredths of a cent for a lone word; nothing when it rides | A stat with no word reads as its act's word with its scope ("damage against zombie") |
| C2 | **Opens partly.** A kind is a body slot (closed: the body has those slots) plus tags plus implicit lines as stat words and bands. The 21 kinds become the slot grammar, and a frame becomes a kind (CP5) | `ThemeLaw`'s gear check | `bases` writes a noun for a slot already | The minting's store | At minting | Rides `bases` | Today's 21 kinds and their lines are the floor |
| C3 | **Stays closed.** Each effect, delivery and trigger is read by code (`EffectSystem`, the field). A new word ships with its reader and its player's word in one change. An ability is already a composition of these | The theme law | | | | | |
| C4 | **Stays closed as slots.** The land lays five kinds of ground from two noise fields; a world names and dresses them (A11, A12). More slots would be a change to the land's law, not content | | | | | | |
| C5 | **Stays closed, grows with drawings.** Each word needs a stroke or a hue in the atoms, and a bar holds that every word has one (the comment at `ThemeTypes.ts:299`). A feature could become a composition of strokes; that is an art pass, not this one | | | | | | |
| C6 | **Stays closed.** A form is what the art draws and what the hands need | | | | | | |
| C7 | See A11 | | | | | | |
| C8 | **Stays closed (CP12).** Each word has a reader: a want pays in gold, a gift or respect; an objective sets what a resident asks for; a drive picks a goal. What a person shows is already free words, written by the talk (`npc_talk`, `npc_goal`) | | | | | | |
| C9 | **Opens.** A trade is a registry tag of kind `trade` with a station; a process step reads the trade's tag (CP10) | `ProcessSystem` with `WebBank.hasKind(tag, 'trade')` | None: the trade comes from the web | The tech web | | | The seven are the first registry's trades |
| C10 | **Stays closed.** Seven properties are the physics a material is made of ("properties determine reality", 6570f17) | | | | | | |
| C11 | **Stays.** Pedro's design | | | | | | |
| C12 | **Opens by asking a use.** A bill asks for a use (kind `use`, which the registry already has: `building`), never a material: walls want `building`, doors `framing`, windows `glazing`, plans and scrolls `writing`, snares `binding`, meals `food`. The theme law requires every use a law bills for, as it requires `building` today (CP6) | `ThemeLaw` | Rides the world's writing | The registry and the pack | When a world is written | Nothing extra | Today's words become the first registry's uses: `wood` answers framing, `glass` glazing |
| C13 | **Stays closed.** Each building kind and station kind is an act the code runs | | | | | | |
| C14 | **Stays closed.** Each word is a band or a shape the formula turns into a number or a geometry | | | | | | |

### 3.4 F

| # | Where it should live | Request | When | Cost | No key | Waits for |
|---|---|---|---|---|---|---|
| F1 | On the stat's record in the tech web (C1). Until C1, one table, `StatWords`; `STAT_SAY` and `PROPERTY_NAMES` read it | With C1 | With C1 | With C1 | `StatWords` | ux-sheet (`StatWords`, `SkillSay`), ux-cards (`inspect.ts`) |
| F2 | The words of closed grammar (C3, C14): they stay as interface words, in one place each. `TheWorking` reads `EFFECT_SAY` | None | | | | ux-sheet and ux-cards (`SkillSay`) |
| F3 | On the trade's record (C9): a lore piece written lazily, per trade and theme, under `LorePiece`'s law | New kind or ride `doing`'s shape: a trade, its world, a name and one line | The first time a note of that trade is minted | Haiku, about three hundredths of a cent | Today's seven are the floor | ux-cards (`prompts.ts`) |
| F4 | The keepers' words (A2) for what a keeper says of the guild and the block; a vendor's want is already said by the talk | Rides `hub_words` | As A1 | As A1 | Today's lines | As A1 |
| F5 | The hub's words (A1, A2) | Rides `hub_words` | As A1 | As A1 | Today's names | ux-sheet, ux-cards (`LargeSheet`, `CharacterSheet`, `PlayerHub`), and the hiding pass for keepers' names, which by his ruling are not known until asked (the city waits for that pass) |
| F6 | Stays: the archetypes are his | | | | | |
| F7 | Stays: words of C8 | | | | | |
| F8 | `MaterialDoing`'s own lines are its floor already; the cache's name rides A10; the rest stay or go with CP15 | | | | | |

## 4. How the calls are operated

For a builder porting one family, reading nothing else first. The whole pattern is in two files: `shared/logic/systems/MaterialDoing.ts` (the law, the ask, the floor) and `src/logic/theme/writing/MaterialDoingWriter.ts` (asking, keeping, never asking twice). Read them before anything.

### 4.1 The door

All model work goes through one door. A page asks `IntelligenceClient` (`src/logic/intelligence/IntelligenceClient.ts`), which posts to the door through `DoorTransport`, on the server or, with a person's own key, inside the page (`PageDoor.ts`); the same table answers either way (`shared/intelligence/routes.ts`, `routeDoor`). The door (`shared/intelligence/door.ts`) holds one provider: Claude with the server's key (`claude.ts`), a person's key (`KeyedClaudeProvider`), or with none a model on this machine (`local.ts`, Pedro: "local model"). A refusal, a missing key, a rate limit or an outage comes back as an outcome (`NO_KEY`, `REFUSED`, `BUSY`, `OFFLINE`, `OUTAGE`, `CUT_OFF`, `OVER_LIMIT`), never a thrown error, and the game goes on.

Three roads:
- **A person waits** (`ask`, `askStream`): a talk, creation, a gift, a material's doing. Live, with the server-side fallback on for Sonnet and Opus.
- **A talk** (`askTalk`): live, counted against `TALK_SPEND_LIMIT_USD` (5 cents) per talk id.
- **Nobody waits** (`fileRest`, `fileWindow`, then `collect`): a rest or a world's window, filed as a Message Batch at half the price, collected later; over `REST_SPEND_LIMIT_USD` or `WINDOW_SPEND_LIMIT_USD` (50 cents each) it waits for the next one.

### 4.2 Adding a kind

Prefer riding an ask that already runs (section 4.6). When a new kind is right, it is seven places, in this order:

1. The law, pure, in `shared/`: `askOf(...)` builds what the model hears, `judge(answer, ...)` returns `{ thing }` or `{ reason }`, and a `floor(...)` gives what stands with no key. Nothing in it is a store or a door.
2. `shared/intelligence/door.ts`: the name in `DoorKind`.
3. `shared/intelligence/claude.ts`: `MODEL_FOR` (with the words of Pedro's that chose it, or "decided; Pedro may overrule"), `EFFORT_FOR`, and `NO_FALLBACK` if it runs on Haiku (Haiku has no server-side fallback).
4. `shared/intelligence/prompts.ts`: the system text (frozen, so it caches: the voice, the grammar, then `REGISTRY`; nothing volatile), the schema, and a `build...Request(ask)` that puts the volatile part in the message. Set `maxTokens` to what the answer needs; it is the ceiling the door bills against.
5. `shared/intelligence/routes.ts`: a `case` in `routeDoor`, with any length check on what a person typed.
6. `src/logic/intelligence/IntelligenceClient.ts`: one method.
7. The writer in `src/logic/theme/writing/` (or beside its system): `need()` and `write()`, as `MaterialDoingWriter`.

A bar stubs the client method and counts its calls. No bar calls a real model.

### 4.3 The schema

A schema is strict JSON Schema: every object `additionalProperties: false`, every field `required`, a word from a closed list as an `enum`. It never holds a number, a stat, a price or a chance: the model writes words and bands, and the formula writes numbers ("You never write numbers"). Two limits met before:
- The API refuses a grammar that is too large (Q1). A round of the chain is asked in two parts that each compile (`CHAIN_PARTS`); a world in passes, one small ask each, in the order a world comes to be.
- A local model is held to every word of a schema by its grammar, so a request carries `tight` beside `schema`: the same shape narrowed to this ask (its ids, its count). The cached `schema` stays frozen; `tight` is for the local provider. See `tightSkills`, `tightGift`, `tightPass`.

### 4.4 The law's check, and a refused answer

What comes back is never trusted, whoever wrote it. Two checks, in order: `schemaProblem(schema, data)` (`shared/logic/content/SchemaFit.ts`), because a local model or a client handing an answer in is held to no grammar; then the law's `judge`. A refused answer is asked once more, with the refusal in the ask as `refused` ("The last answer was refused and nothing of it stands. ... Write it again without that."), then it falls to the floor (`DOING_ASK_TRIES` is 2; a world pass is refused twice before the writing stops).

What went wrong before, in the ledger:
- **CT1.** The law refused a round whole and named only the first bad word; the next answer mended that one and tripped on another, three times running. A refusal names every bad word once, with what carries it. The same one-word refusal still stands in `WebBank.validateBatch` and `OriginBank`.
- **CT2.** The instructions said what one field held and not another, so the model filled it with words of its own. Every field the law checks is said in the system text, in one sentence.
- Still open from CT2: a refused round is rewritten whole, since the next ask carries the refusal and not the answer it refused.

Blind prompts: the expected answer is held back, and a striking figure gets its own slot rather than a hint; a law pulls a drifting answer back to the standard (Pedro's ruling on blind prompts).

### 4.5 What stands with no key

Every port keeps a floor, and the floor is the words the code holds today: moved beside the shipped pack, never deleted, read when nothing better is kept. The first theme is that floor for a whole world. A floor written with no key is kept like a model's answer and is not replaced when a key arrives later (Pedro: "once something exists it's determined"). The bars run with no key, so the floor is what the bars see.

### 4.6 Batching: a world costs few calls

- Ride an ask that already runs before adding a kind. A world's own things ride its passes (when it is written) or the minting's one `bases` ask ("one ask for a whole minting, so a world costs few calls"). A hub's things ride one ask when the hub is first entered.
- Nobody waits on a window: kinds of ask a window carries are listed in `ASK_KINDS` (`ScanPass.ts:128`), each with how many go in one batch; a new kind joins there and in `WINDOW_REQUESTS` (`prompts.ts:562`).
- Meetings nobody watched go in one batch (`buildMeetWindowRequest`).
- The system text is the same for every call of a kind and is cached; the volatile part is the message.

### 4.7 What is kept, so a call is never made twice

Three layers, as `MaterialDoingWriter.need` does it: the book in memory, then the store, then the door; a `pending` map so two needs at once make one ask; and after writing, the store read again, so that the first thing written stands. Where:

| What | Store | Key |
|---|---|---|
| A world's pack, sealed | `CONTENT`, content type `THEME_PACK` (`ContentRegistry`, `boot.ts`) | the theme id, a hash of its bytes |
| What a minting added | `CONTENT`, `MINT_ADDITIONS` (`MintStore`) | `mint_<worldUid>` |
| A thing's lazily written words | `CONTENT`, one content type per kind (`MATERIAL_DOING`) | `<kind>_<thing id>` |
| A world's loot | `CONTENT`, `LOOT_CONTENT_TYPE` (`LootBook.bank`) | the table's id |
| What a hub holds | `TERRITORIES` | `<kind>_<hubId>` (`kami_persona_<hubId>`) |
| The tech web | the hub's web (`IHubWeb`, `src/entities/hub/hubTech.ts`) and `WebBank` | the node's id, minted from its parts |

What a world's content gives is pinned: by its theme's bytes, by the web version it was minted on, and by `GROUND_VERSION` for what its ground lays. A change to what a world gives raises `GROUND_VERSION` and is never applied to a world that already stands. Pedro tests on fresh characters and fresh worlds: no migrations.

### 4.8 The receipt

Every outcome carries `usage`: the model, the tokens in and out, the cache reads, and what it cost in dollars at the rates in `claude.ts`. Before anything is sent the provider gives a ceiling (`ceilingOf`: every token it may write billed, its input counted high) that the spend limits read. The receipt is a row on the ledger: `Ledger.append('TECH', { kind: 'INTELLIGENCE_USE', door, hubId, ...usage })`. Today only creation (`CreationDoor.ts:122`), a rest (`RestDoor.ts:176`) and a window (`ScanDoor.ts:77`) write it; a material's doing, the bases, the loot, Kami's reading, the gift, the chain and a talk do not (CP17). Every ported kind writes one.

### 4.9 What each kind costs today, for scale

The ceiling is mostly the answer's room (`maxTokens`) at the output rate; real answers are shorter.

| Kind | Model | Room | Ceiling of one call | Made |
|---|---|---|---|---|
| `doing` | Haiku | 300 | about 0.02 cents | once a material |
| `kami_persona` | Haiku | 1,000 | about 0.05 cents | once a hub |
| `kami_gift`, `npc_talk`, `npc_goal`, `bargain` | Haiku | 1,500 | about 0.08 cents | a round |
| `creation` | Haiku | 4,000 | about 0.2 cents | once a character |
| `chain` | Haiku | 16,000 a part, two parts | about 1.6 cents | a round |
| `bases` | Sonnet | 16,000 | about 16 cents (a real answer a few) | once a minting |
| `loot` | Sonnet | 12,000 | about 12 cents | once a written world |
| a world pass | Sonnet (Opus large) | 16,000 | about 16 cents (32) each, ten asks | once a world |
| `rest`, `window` | Sonnet, batched | 12,000; up to 16,000 | about 6 to 8 cents | a rest; a window |

## 5. The port in order

### 5.1 Families

| Order | Family | Entries | Kind of work | Touches a UX session's files? |
|---|---|---|---|---|
| 1 | A world's people named from its own pieces | A9 | **Plumbing only.** Law (`NameWell`), request (ground and names passes) and store (the pack) all exist; keep the well on the sealed pack, read it in `WorldGenerator`, raise `GROUND_VERSION` | No: `WorldWriter.ts`, `ThemeTypes.ts`, `ThemeCompiler.ts`, `WorldGenerator.ts` |
| 2 | Relics, copies and orphans | A8, A15, A11's shoulder names, F1's copies, F2's copy, A10's two lore fragments, the tutorial's tasks written twice, CP14's stations | **Plumbing only**: delete what nothing reads, read one table where three say the same, define the four base stations outside the fixture | Partly: `SkillSay.ts` (`STAT_SAY`, `EFFECT_SAY`) waits for ux-sheet and ux-cards; the rest does not |
| 3 | Bills ask for a use | C12 | **Design call (CP6)** | The bills, no. The theme's grammar text in `prompts.ts`: waits for ux-cards |
| 4 | The game's ways named by each world | A10, A4 | **Design call (CP3)**: ride `bases` | `prompts.ts` (ux-cards); `WorldCanvas.tsx` (ux-fight) for the cart's body |
| 5 | A world's look from its words | A11, A12, C7 | **Design call (CP7)**: ride the ground pass | `prompts.ts` (ux-cards); `WorldCanvas.tsx` and `FieldRenderer.ts` (ux-fight) |
| 6 | The hub's words | A1, A2, A3, A7's names, A13, F4, F5 | **Design call (CP2)**, a new kind `hub_words` | `prompts.ts`, `door.ts`, `claude.ts`, `routes.ts`, `IntelligenceClient.ts` (ux-cards adds a kind in the same five); `LargeSheet`, `CharacterSheet`, `PlayerHub` (ux-sheet, ux-cards); keepers' names wait for the hiding pass |
| 7 | Stats as compositions | C1, F1 | **Design call (CP4)**, the largest | `StatWords.ts`, `WebSystem.ts`, `SkillSay.ts`, `SheetNumbers.ts` (ux-sheet); `inspect.ts`, `prompts.ts` (ux-cards) |
| 8 | Gear kinds as slots, frames as gear | C2, A6 | **Design call (CP5)** | `prompts.ts` (ux-cards); `LargeSheet`, `CharacterSheet` (frames shown) |
| 9 | The registry into the tech web | B1, A14 | **Design call (CP13)** | `WebBank.ts`, `WebSystem.ts` (ux-sheet); `prompts.ts` (ux-cards) |
| 10 | Keeping magic and trades' notes | A5, C9, F3 | **Design calls (CP9, CP10)** | `prompts.ts` (ux-cards) |
| | Stays | B2, B3, B4, C3 to C6, C8, C10, C11, C13, C14, A16, F6, F7 | Nothing to port (CP11, CP12) | |

Every family that adds a door kind or changes a system text waits for ux-cards' join: ux-cards is adding a kind (the spoken note) in the same five door files.

**Since 2026-11-13:** the UX joins are in main (`2f1b6d6`), and families 1 and 2 are built on this branch (ledger CP18 to CP28, Fixed CP25f): a world's people are named from its own pieces from ground 8, the relics are gone, the copies are read from one table, and the four base stations are the game's own. Families 3 to 10 still wait on Pedro's reading of CP2 to CP13, and on leave to change a system text or a schema, which the two built families did not need.

### 5.2 The design calls, as I would make them

Each is an open row in `PLAYTEST_LEDGER.md` under the same number, for Pedro to strike.

- **CP2. A hub's words are written once, from its seed.** A new Haiku ask, `hub_words`, the first time anyone enters a hub: its name, its districts' and buildings' names, and each keeper's name, title, greeting and look, from the hub's seed and Kami's reading of it. Kept beside Kami's reading and never rewritten. New Carleon's words become the no-key hub. The layout matrices stay hand-drawn: a hub is fixed by design. Keepers' ids and roles stay code: each is an act (the bank, the shops, the land office). Why Haiku: it is names and one-line greetings, the same as Kami's reading, and it is made once a hub.
- **CP3. The game's own acts keep their code and take the world's nouns.** A snare, a cage, a packed cart, spoiled work, meat, a written fragment, a dropped cache and the tavern's drink: the act stays code; what each is called in this world, and its one line, rides the minting's `bases` ask. Today's words are the floor by way id.
- **CP4. A stat is a reader act, a scope and a word.** `STAT_READERS` shrinks to the acts that code reads (about twenty). A stat the model names is an act plus a scope of registered tags; `AffixBank` checks both instead of a key in a list. Its word comes with it, or is asked lazily. This is his tech-web ruling read literally; it is the largest change here and touches the balance work, so it should be built after his second run, not before.
- **CP5. A gear kind is a body slot and words.** The 21 kinds stay as the slot grammar; their implicit lines move to the bases a minting writes, as stat words with bands; a cognitive frame becomes a kind of gear the head's slot takes, so a world writes its own frames (D22 already holds mind stats to frames).
- **CP6. A bill asks for a use.** Walls, doors, windows, plans, scrolls, snares and meals ask for a registry word of kind `use`. The theme law requires a material for every use a law bills, as it requires `building` today. Today's words answer as the first uses (`wood` for framing, `glass` for glazing, `paper` and `ink` for writing, `fiber` for binding).
- **CP7. A world is drawn in its own words.** The ground pass also writes a palette of four look colours and a ground pattern, and a look line for each kind of ground. The five genres stay as the floor for a pack with none.
- **CP8. People are named from the world's own pieces.** The pieces are kept on the sealed pack; the 8 and 7 names are the floor for a pack with none.
- **CP9. Keeping is an effect a world can write.** One word, `keep`, joins `EFFECTS` with its reader, D21's contract; slots, choice, uses and duration come from bands. A world writes its charms and scrolls; today's three are the floor.
- **CP10. A trade is any registry trade with a station.** `PROCESS_FAMILIES` reads the web's trade tags; a trade's note is written the first time one is minted, per trade and theme, on Haiku. The seven are the first registry's trades and their notes the floor.
- **CP11. Origins stay a pack.** The lives are Pedro's own list from his June design; their lines are already a no-key floor. Not ported.
- **CP12. People's natures stay closed.** Temperament, objective, want, drive and nature are each read by code; what a person says and wants in words is written by the talk already.
- **CP13. The registry moves into the tech web.** The web's batches become the tech web's first run; a word the chain or a world pass registers joins the same registry the prompts read. The cached `REGISTRY` text is then built per hub, so its cache is per hub.

### 5.3 What waits for the UX joins

These files are being changed by ux-cards, ux-sheet or ux-fight, and no port touches them until their joins are in main: `src/render/atoms/inspect.ts`, `src/components/ui/kit.tsx`, `HoverLayer.tsx`, `Hotbar.tsx`, `LargeSheet.tsx`, `CharacterSheet.tsx`, `PlayerHub.tsx`, `SheetNumbers.ts`, `SheetWords.ts`, `SkillSay.ts`, `WorkSay.ts`, `src/render/FieldRenderer.ts`, `WorldCanvas.tsx`, `CombatSystems.ts`, `projectileSystem.ts`, `FeedView.tsx`. Their notes in the notes folder name more: ux-cards also `shared/intelligence/prompts.ts`, `shared/intelligence/local.ts`, `server/intelligence/index.ts`, `VoiceGift.ts`, `VoiceGiftDoor.ts`; ux-sheet also `shared/logic/systems/StatWords.ts`, `shared/logic/content/WebBank.ts`, `shared/logic/systems/WebSystem.ts`, `SkillNames.ts`. So families 3 to 10 wait. Families 1 and 2 (except `SkillSay`'s copies) can start now.

### 5.4 Found in passing

- **CP14.** The four base stations, `stn_bench`, `stn_counter`, `stn_table`, `stn_scribe`, are named by the hub's logic (`SHELL_STATION` mints `stn_bench` or `stn_counter` when a workshop or vendor shell is done; `ownerHasBench`, `hubTech.ts:168`, `SourcingAudit.ts:71` look for `stn_bench`; the room presets place them) and are defined only in `tests/fixtures/content/recipes.ts`. A theme's stations are `stn_<theme>_<key>`. What a finished shell mints in the game was not checked.
- **CP15.** Content nothing reads: `IdentityGenerator` and `LORE_CONTEXT`, `LoadoutSystem.themedShoulderName`, the room presets, the old loot's names in `LootTable.generateLoot`, and `MaterialScience`'s affixes (one caller).
- **CP16.** Said twice: `STAT_SAY` copies `STAT_WORDS`; `TheWorking`'s effect words copy `EFFECT_SAY`; the lore fragment item is built in `LootTable.ts` and in `player/store.ts`; the tutorial's five tasks are written as prose in `GuildHall.tsx:59` and `MissionControl.tsx:72` beside `FirstOrder`'s titles.
- **CP17.** Only three kinds write the receipt (4.8).

## 6. What was read, and what was not

**Read whole, by me:** `server/intelligence/index.ts`; `shared/intelligence/door.ts`, `claude.ts`, `routes.ts`, `prompts.ts`; `src/logic/intelligence/IntelligenceClient.ts`; `shared/logic/systems/MaterialDoing.ts` and `src/logic/theme/writing/MaterialDoingWriter.ts`; `src/entities/hub/dialogue.ts`; `src/entities/lore/LoreBible.ts`; `src/entities/identity/IdentityGenerator.ts`; `shared/logic/systems/StatWords.ts`; `src/logic/systems/SkillSay.ts`, `WorkSay.ts`, `SheetWords.ts`, `SkillNames.ts`, `FieldWords.ts`, `ContactNames.ts`; `shared/logic/economy/gameWays.ts`; `shared/logic/theme/shelf.ts`; `shared/entities/generation/packs/affixBatches.ts`; the five `shared/entities/*/data/*.ts` files; `scripts/run-affix-batch.ts` to line 64.

**Read whole, by three bounded readers** (each a fixed list, read to the end, its findings checked against the files where they are cited here): every file under `src/components/` (62); `src/entities/hub/` `farmDoors`, `guild`, `residentDay`, `herd`, `farm`, `hubTech`, `techDoors`, `money`, `store`, `HubCanvas.tsx`; `src/entities/world/` `LootTable`, `store`, `WorldCertificate`, `CartSystem`, `TutorialStart`, `goldens`; `src/entities/interaction/` `talkStore`, `InteractionEngine`, `memoryStore`; `src/entities/player/` `store`, `types`, `LoreManager`; every `.ts` under `server/` (36); `landing/index.html`, `landing/landing.js`; every file under `scripts/`; every `.ts` under `src/render/`.

**Read in the part that holds the table, by me:** `webBatches.ts` (its structure, every non-tag line, the run headers; the 185 tag lines by pattern), `firstTheme.ts` (its header and its keys: pinned, so its content was counted from `CONTENT_REACH.md`), `firstThemeLoot.ts` (header), `originBatches.ts` (to line 120) and `OriginBank.ts` (to line 60), `hubManifest.ts` (to line 200, and its function list), `HubGenerator.ts` (to line 200), `ThemeTypes.ts` (lines 1-112, 296-360), `StatSystem.ts` (to 135), `ThemeFormula.ts` (150-245, 440-505, 568-572), `InsuranceSystem.ts` (to 80), `MaterialScience.ts` (to 40), `template.ts` (395-497), `room.ts` (230-375), `cognitiveFrames.ts` (to 30), `WebSystem.ts` (835-870), `ProcessSystem.ts` (to 75), `WorldGenerator.ts` (136-160, 530-548, 745-775), `Tutorial.ts` (40-75), `Maintenance.ts` (55-92), `TalkLaw.ts` (45-90), `VendorSystem.ts` (105-125), `FirstOrder.ts` (20-55), `WorldPasses.ts` (20-75), `Leaders.ts` (25-35), `NpcAgenda.ts` (30-50), `ScanPass.ts` (120-145), `ExtractLaw.ts` (35-50), `Capture.ts` (92-140), `PairCraft.ts` (44-62, 160-180), `LoadoutSystem.ts` (495-520), `src/render/atoms/world.ts` (15-110), `KamiPersona.ts` (to 60), `MintAdditionsWriter.ts` (25-45), `LootBook.ts` (40-70), `src/entities/hub/store.ts` (2770-2870), `shared/render/atoms/people.ts` (around 399-490), `WeaveSystem.ts` (`floorName`).

**Only searched, by pattern** (inline word lists of three or more, word maps keyed by an id or a kind, things named in title case, content ids such as `res_`, `npc_`, `stn_`, `crf_`, `chm_`): the rest of `shared/` (`logic`, `entities`, `render`, `intelligence`) and the rest of `src/logic/` (122 files), `src/entities/combat`, `data`, `economy`, `generation`, `identity`, `mob`. A search finds what it was shaped to find. Nothing in these is called absent here; content written some other way (a sentence built from pieces, a number standing for a thing) would not have been found.

**Not looked at:** `tests/`, with `tests/fixtures/content/`, which holds the old content on purpose and is never imported by the game; `prototype/`; `drizzle/`; `api/hub.ts`; the root `index.tsx`, `App.tsx` and `vite-env.ts`; `landing/landing.css` and the images; the `.md` documents; the provider and credit data (`src/logic/intelligence/agents.json`, `shared/intelligence/door-options.json`, the credits), which are data about providers and people, not the game's content.
