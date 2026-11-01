# WORLD SEED // THE SYSTEMS PLAN

**Status:** the build plan and the record of each wave. Waves 1 through 10E are built and approved.
The raw materials leg (D23) is built and approved. The technology web and auto skill (D27) is built and
approved; the suite stands at 585, with one timing bar that reads load (see that leg's record).
Next, in order: the stable database and the usability pass, then Pedro's full run, then Wave 11 and Wave 12.
Open test lines
and their status are in section 5.

**Prime directive (unchanged):** SAO. A world you live in. Hubs as society. Players own their
avatar — cert-signed, portable, provable — the full 9 yards. Value = Time + Risk.
Power = Universal Rank (F–SSS). Society = Interdependence (taxes & upkeep).
Nothing in this plan alters that vision; everything in it exists to make it true.

---

## 0. THE END-TO-END TRUE TEST (the list)

This script is the definition of done. Every wave below exists to make one more line of it pass.
When all lines pass in one unbroken sitting — including the browser reload — the game works.

```
 1. [x] Birth: mint identity cert (keypair in browser, geo+entropy UID)
 2. [x] Reload browser → identity persists, signature verifies
 3. [x] Materialize into Hub → player doc hydrates (gold, stash, skills, lore)
 4. [x] Buy a tool (axe or pick) → gold actually deducted, item in stash
 5. [x] Deploy → Drone Recon → scan sectors → pick drop zone → confirm
 6. [x] Walk the world: terrain matters (slow ground, blocked tiles, biome texture)
 7. [x] Harvest flora with the right tool (wrong tool refused)
 8. [x] Mine a mineral node (vein depletes)
 9. [x] Find a ruin → fight the garrison → open the chest → read the lore note
10. [x] Meet an NPC → social interaction → convince them → they become extractable
11. [x] Inventory fills: tetris placement forced, weight slows you down,
        something must be left behind (the decision IS the game)
12. [x] Reach an extraction beacon → channel timer → extraction tax applied
13. [x] Loot banked, XP applied, deed (if dropped) in stash — all SIGNED
14. [x] Reload browser → everything from 13 is still there, signatures verify
15. [~] Redeem deed → own a lot → build a workshop
16. [x] Refine raw logs → planks at the workshop (recipe consumes, produces)
17. [x] List planks in a shop → another identity could buy them
18. [x] Die on a second run → death penalty from the WORLD CERT rules applies
        (inventory lost, not banked)
19. [x] Export avatar (cert + encrypted key + signed player doc) → import in a
        fresh browser profile → same character, provably the same
20. [~] Same world seed on two clients → identical map, chunk for chunk
```

`[x]` passed; `[~]` passed with a recorded limit (see `HANDOVER.md` section 1). Lines 21 onward are under "New test lines", with their status in section 5.

---

## 1. ARCHITECTURE DECISIONS (borrowed, not invented)

Two donor codebases were mined for patterns. We take the pattern, never the feature.
Donors are idea quarries — if it isn't on the test list above, it doesn't come in.

### From `D:\-ttrpg-engine` (the harness patterns)

| Pattern | Donor reference | What it fixes here |
|---|---|---|
| **Universal write action + write capture** — every state change is one typed action; a wrapper records every write automatically | `engine/tpb-world.ts`, `engine/tp-write-capture.ts` | Our save/persistence problem AND our anti-cheat seed. Save = seed + action log. The session journal becomes replayable. |
| **Save = seed + log, replay to rebuild** | `engine/tpb-replay.ts`, `src/lib/kappa-log.ts` | Never store generated content; store what happened to it. Shrinks the DB, makes worlds shareable. |
| **One adapter hook; React renders only** | `src/lib/use-world.ts`, `src/lib/engine-client.ts` | WorldCanvas currently *is* the game loop. The loop moves to a system layer; the canvas draws snapshots. |
| **Cheap accumulate / expensive resolve-on-observe** | `engine/mm-simulated.ts`, `engine/clockwork.ts` | Hub economy + NPCs tick cheaply off-screen, resolve fully only when a player looks. |
| **Seeded rolls that return receipts** | `engine/mf-dice.ts` | Loot/craft/hit rolls become checkable. The vector bank can prove its own history. |
| **Chunk tiers: current / adjacent / predicted / cold-from-seed; materialize on first visit** | `engine/hub-chunks.ts`, `src/game/world.ts` | Our worlds get big without the DB getting big. |
| **Nested containers, weight+volume caps, "every item exists somewhere"** | `engine/inventory.ts` | The weight half of inventory. (The grid-tetris half is ours to build — donor explicitly lacks it.) |

### From `D:\primordial` (the determinism & provenance patterns)

| Pattern | Donor reference | What it fixes here |
|---|---|---|
| **Coordinate-keyed derivation** — every cell is a pure function of `"{seed}:{layer}:v1:{x},{y}"`, no RNG state carried | `crates/patch/src/lib.rs`, `crates/rng/src/lib.rs` | THE pattern for WorldGenerator. Lazy, order-independent, re-versionable per layer. Line 20 of the test falls out of this. |
| **Claim / Receipt protocol with a baseHash** | `packages/protocol/src/index.ts` | The shape for signed player actions: claim carries what-state-I-acted-on, receipt carries the result hash. Slots directly into our existing `ISignedPayload`. |
| **Append-only ledger: seq, logical day, seed digest, tombstones; content-addressed export** | `docs/byte-substrate-design.md` §2.4–2.6 | The avatar/world export format (test lines 19–20) and the shape of the transaction ledger. |
| **Ownership graph separate from containment** | `crates/io/src/seed.rs`, `crates/hub/src/ownership.rs` | Deeds, lots, loot in transit: *who owns it* and *what holds it* are different questions. Stops dupe/limbo bugs before they exist. |
| **Material properties derive weight & stats; material→tool table; exhaustible vs regenerating deposits** | `crates/economy/src/caravan.rs`, `crates/patch/src/lib.rs` (`species_table`), `crates/economy/src/deposit.rs` | MaterialScience stops being a mock: density × amount = weight, material class names its tool, veins run dry, flora regrows. |
| **Golden-vector harness** (reference outputs, zero-mismatch check) | `tools/capture-*-goldens.mjs`, `harness/` | Pin WorldGenerator output across refactors so old world certs never generate different worlds. |

Where the donors disagree with our stack (Rust, hex grids, prime-factor identity, no real crypto),
we keep our stack: TypeScript, square 20px-tile chunks, X.509 + WebCrypto (which we already have
and primordial lacks).

### Standing constraints (from agent.md — still law)
- No Tailwind. `types.ts` is THE CONTRACT. Logic in stores/systems, components render.
- "Mantine only" was superseded by D4 and Wave 9: player-facing screens use the kit in `src/components/ui/`, and Mantine remains only for the admin Genre Creator.
- The vector DB (RxDB) is the source of truth. The hub is society. No shortcuts around certs.

---

## 2. CURRENT-STATE AUDIT (what exists vs. what's real)

*A snapshot from before Wave 1, kept as the starting record. The waves below closed most of it. For what is open today, see `BUILDERS_LOG.md` "Known weak spots" and `HANDOVER.md` section 8.*

| System | Logic exists | System real? | Gap |
|---|---|---|---|
| Identity certs (birth, keypair, signing) | ✅ | ✅ | — |
| World certs (mint, sign, rules) | ✅ | ⚠️ | Rules (death penalty, tax, caps) never *enforced* |
| Vector DB (RxDB + embeddings) | ✅ | ✅ | Local hash embeddings offline; Gemini optional |
| Player persistence | hydrate-only | ❌ | **Nothing ever writes CHARACTERS. All progress lost on reload** |
| Signing of items/trades/results | types only | ❌ | `signature: ''` everywhere; ledger is an unsigned table |
| World gen: mobs + resources | ✅ | ⚠️ | `Math.random` in ItemFactory/LootTable breaks determinism |
| Terrain / geography / traversability | ❌ | ❌ | Chunks are empty squares |
| Ruins / containers / lore | types only | ❌ | Never spawned |
| NPC entity + social extraction | enum only | ❌ | No sheet, no dialogue, no extraction path |
| Extraction points | data only | ❌ | EXTRACT works from anywhere, tax never applied |
| Recon → drop | ✅ | ✅ | Built & tested (this sprint) |
| Combat loop | ✅ | ⚠️ | Damage hardcoded; stats/equipment/durability/spells unwired |
| Weight | fields + recalc | ❌ | Pickup ignores caps, encumbrance affects nothing |
| Inventory tetris | dimensions on items | ❌ | InventoryGrid is a flat list |
| Economy: shops | generate stock | ❌ | Purchases don't deduct gold; no selling |
| Crafting (TransformationEngine) | 55-line skeleton | ❌ | No recipes, no facility check, not wired to lots |
| Auction | types only | ❌ | — |
| Taxes / upkeep (Society pillar) | rate fields | ❌ | Never charged |
| Deeds → lots | ✅ | ⚠️ | Works; structure build flow minimal |
| Progression / skills / frames | ✅ | ⚠️ | Runs in-session; not persisted |
| Avatar export/import | ❌ | ❌ | The "own your avatar" promise needs this |

---

## 3. THE WAVES

Each wave has a **goal**, the **systems** it builds, the **donor patterns** it uses, and a
**gate** — the test-list lines that must pass before the next wave starts. No wave starts
until the previous gate is green. No feature enters a wave from outside the test list.

### WAVE 1 — Truth & Persistence (make the ledger real) ✅ DONE
*The bank must not forget. The bank must not lie.*
*(Gate passed: signed write-through + verify-on-load live; tampered doc refused;
keyed deterministic rolls in ItemFactory/LootTable/shops; session journal seals
claim/receipt; ledger chain audits clean.)*

- **W1.1 Player write-through.** Save the signed player doc to `CHARACTERS` on: extract,
  jack-out, death, hub transactions, and a 30s debounce. Verify signature on hydrate.
- **W1.2 The Action Journal.** One typed action for every state mutation (donor: writeKappa).
  A session is `{worldCertUid, dropZone, seed, actions[]}`. Extraction result = signed summary
  of the journal (donor: Claim/Receipt — claim carries baseHash of the pre-session player doc).
- **W1.3 Deterministic rolls.** Replace `Math.random` in ItemFactory/LootTable/shops with the
  seeded RNG, keyed primordial-style (`"{sessionSeed}:loot:{mobId}:{n}"`). Rolls recorded in
  the journal with receipts (donor: mf-dice receipts).
- **W1.4 Transaction ledger.** Append-only, seq-numbered, tombstones-not-deletes
  (donor: byte-substrate §2.4). Gold changes, trades, tax events are ledger rows, signed.
- **Gate:** test lines **2, 13, 14**. Play → extract → hard reload → everything survives
  and verifies. Tamper with a saved doc in devtools → load refuses it.

### WAVE 2 — The World Is a Place (finish the extraction battle JSON) ✅ DONE
*README item 3, all of it — this is the content wave.*

- **W2.1 Terrain layer.** Per-chunk tile texture + traversability derived coordinate-keyed
  (`"{seed}:terrain:v1:{x},{y}"` — donor: patch crate). Water/rock blocks movement; mud slows.
  Movement system reads it (speed modifier slot already exists from encumbrance work in W3).
- **W2.2 Extractables taxonomy.** Fill RESOURCE_DEFINITIONS per the README list:
  flora (grassy seeds/grains, shrubs/berries, fruit incl. poison, trees → logs + saplings),
  minerals (ore veins, sand, rocks, pebbles). Each gets material properties
  (density, hardness, toxicity) so **weight = density × amount** and MaterialScience reads
  real data (donor: caravan weight, species→tool table). Veins deplete; flora regrows on a
  world-clock cadence (donor: deposit.rs).
- **W2.3 Ruins & structures.** Spawn STRUCTURE entities (coordinate-keyed placement) that
  contain: CONTAINER chests (generateChestLoot — already written, never called), mob
  garrisons, and lore notes (LoreBible entries as items). Structures gate chunk difficulty.
- **W2.4 NPC entities.** A rolled sheet: name seed, temperament + objective (reuse MobAI's
  Temperament/MobObjective enums), a want (item/gold/escort), and a disposition meter.
  Social extraction = interaction menu (InteractionEngine already brokers this) where
  attribute checks + gifts move disposition; success converts the NPC to an escort-extract
  entity worth XP + reputation. **No AI text generation in the loop** — sheets are data,
  dialogue is menu-driven. (ContentPipeline/Gemini stays admin-side only.)
- **W2.5 Extraction beacons.** EXTRACT only within a beacon chunk; 5s channel
  interruptible by damage; the world cert's `extractionTaxRate` actually taxes the haul
  into the hub treasury (ledger row).
- **W2.6 Golden vectors.** Capture reference chunk output for 3 seeds; CI script fails on
  any mismatch (donor: primordial harness). From here on, generation changes bump the
  layer version string, never silently change old worlds.
- **Gate:** test lines **6, 7, 8, 9, 10, 12, 20**.

### WAVE 3 — The Body Is Real (weight + inventory tetris) ✅ DONE
*Two vectors, per the README: size of objects, and weight of objects.*

- **W3.1 The grid.** Session inventory becomes a spatial grid (e.g. 8×6 base). Items occupy
  `dimensions` footprints, rotatable. Pure placement functions (`canPlace`, `autoPlace`,
  `rotate`) in a system file with unit tests — the donor had none of this; it's our build.
  InventoryGrid.tsx becomes a render of the grid + drag interactions, nothing more.
- **W3.2 Weight for real.** Capacity = f(strength). Pickup checks BOTH space and weight
  (donor: inventory.ts dual caps). Auto-pickup replaced by a loot prompt when either cap
  would be hit. Over 80% load → speed multiplier down to 0.5; over 100% → can't run;
  hard cap refuses pickup.
- **W3.3 Leave-behind loop.** Drop-to-ground creates a world CONTAINER entity (persisted in
  the session journal), so stashing loot behind a rock to come back for it *works* —
  ownership vs. containment kept separate (donor: owner forest) so dropped ≠ unowned.
- **Gate:** test line **11** — and the qualitative check: did you have to make a choice?

### WAVE 4 — Stats Mean Something (combat integration) ✅ DONE
- **W4.1 Equipment applies.** Damage from equipped weapon stats, mitigation from defense,
  fire cooldown from attackSpeed, durability loss on use, broken = unusable.
- **W4.2 Player melee + spells.** Melee swing fills the already-plumbed `activeSwings`;
  SpellEngine drives SHOTGUN/NOVA patterns off equipped foci. Energy is the resource.
  *(Spells are not finished, and `SpellEngine` is not wired in yet. This is expected: Pedro, 2026-10-31.)*
- **W4.3 Mob stats from definitions.** baseDamage/baseHealth × rank scaling; elite/boss
  tags modify (LootTable already respects tags).
- **W4.4 World rules enforced.** `deathPenalty` from the world cert: INVENTORY_LOSS means
  the session journal ends in a death record and *nothing* banks (fixes the current
  death-banks-loot bug). ipCap/ipFloor gate deployment.
- **Gate:** test line **18**, plus: swapping F-rank → E-rank weapon measurably changes
  time-to-kill (assert via deterministic sim test, not feel).

### WAVE 5 — Society (the hub economy loop) ✅ DONE
- **W5.1 Gold conservation.** Every gold movement is a ledger row; purchases deduct, vendors
  buy at a spread, the sum across all accounts + treasury is invariant (test asserts it).
- **W5.2 Crafting at lots.** TransformationEngine gets real recipes (log→plank, ore→ingot,
  fiber→cloth, plank+ingot→tool) requiring a WORKSHOP on an owned lot. Production uses the
  accumulate/resolve pattern so queued jobs finish in real time off-screen
  (donor: mm-simulated + production-chain shape).
- **W5.3 Player shops.** VENDOR structure lists items; any identity can buy; proceeds to the
  owner minus hub tax. Auction deferred to post-handover (it's on no test line).
- **W5.4 Upkeep.** Lots charge periodic upkeep from the owner's bank (logical world-days,
  not wall clock — donor: primordial's observed-time rule); unpaid → lot reverts to market.
  This is the Interdependence pillar: extraction taxes fund the hub, the hub charges rent.
- **Gate:** test lines **4, 15, 16, 17** + the conservation invariant.

### WAVE 6 — Sovereignty (own your avatar, the full 9 yards) ✅ DONE
- **W6.1 Avatar export/import.** Content-addressed export file (donor: `.seed` format —
  magic, version, digest): cert + passphrase-encrypted private key + signed player doc +
  ledger tail. Import into a clean profile reconstructs the identity; signatures prove it.
- **W6.2 Item provenance.** Mint signature at creation (crafter or world+session), transfer
  signatures on trade. `history` chain verifiable end to end. An item's story is its value.
- **W6.3 World portability.** A world cert + seed fully determines the map (guaranteed by
  W1.3 + W2.6). Export/import world certs; visiting a world records a visit row against
  its stats (creator revenue share becomes payable).
- **Gate:** test lines **19, 20**.

### WAVE 7 — The True Test + Design Handover ✅ RUN, WITH LIMITS
*(See HANDOVER.md section 1 for the result of each line. Line 15 was assisted, line 20 is partial, and lines 10, 17 and 19 have noted limits. It was not one unbroken sitting.)*
- **W7.1 Run the list.** All 20 lines, one sitting, one reload, fresh profile for line 19.
  Every failure becomes a fix ticket; re-run until green.
- **W7.2 The Design Handover** (the final thing). One document, written for the next
  builder — human or agent — containing:
  1. **Systems map** — every system, its owner file, its inputs/outputs, one diagram.
  2. **The Contract** — types.ts annotated: what each type means, what may never change.
  3. **Data model** — DB namespaces, document shapes, ledger format, journal format.
  4. **The signing model** — what gets signed, by which key, verified when, threat notes.
  5. **The determinism charter** — what must derive from seed, layer version rules,
     golden-vector procedure, what is allowed to be random (nothing unjournaled).
  6. **Tuning tables** — every constant (speeds, radii, caps, rates, densities) in one
     place with its current value and its reason.
  7. **Debt register** — every known shortcut, each with its tripwire ("this breaks when…").
  8. **The next worlds** — what the vision wants next (multiplayer sync, real server
     notary, PvP) and which seams were left for it. Noted, not started.

---

## 3B. THE NEXT WAVES (from the atoms prototype onward)

Same method as the prototype: real data, bars registered before the art exists, then look with eyes.

### WAVE 8 — One Grid ✅ DONE
The grid is **tile (20px) → quadrant (16 tiles, 320px) → chunk (64 tiles, 1280px) → sector (512 tiles, 10,240px)**, in `src/entities/world/grid.ts`. World size counts sectors, and a sector is what you scan and drop into.
- **Before, on four 32-unit maps:** neighbouring Ruins/Overgrowth chunks matched only 48–53%, 8–10% of things sat on blocked tiles, and 99.8% were off the grid. One random stream fed the whole map. Cyber City was never generated, so Titanium never spawned.
- **After:** neighbouring chunks match 83–84%; 0 things on blocked tiles, 0 off grid, 0 sharing a tile; a chunk is a pure function of seed and place; all five biomes and all 14 resources appear; a 64-sector world opens in about 45ms with nothing built, and chunks build on demand in about 0.3ms (worst about 14ms).
- **Rendering:** the atoms moved to `src/render/atoms/`. The field draws on one canvas with terrain cached per quadrant (`FieldRenderer`), and the hub draws from its real layout at 20px.
- **Faults fixed:** spawn in the fountain, lamps in buildings, the Alchemist with no keeper or stock, archetype not stored, drops landing beside enemies, and genres with no creatures leaving whole regions empty.
- **Decision taken:** worlds made on the old grid are retired, not converted. Their certificates remain, but Deploy is disabled.
- **Not done, and carried on:** enemies still walk over water and rock, because their movement ignores terrain. Trees still do not block. Balance has not been played at this scale.

### THE NEXT LEGS

Planned 2026-10-31, after checking each leg against the code. Each leg gets its own full-context session and is approved by Pedro before it starts. Commit at the end of each, so the next starts from a clean tree.

**Order:** commit Wave 8 → 8B Motion → 9 Interface → 10 Inside the Houses → 10B The Architect → 10C The Load-Out → 10D The Anatomy of Items → 10E The Affix Bank and the Dreaming → 11 Bringing the Nexi Home → 12 The Second True Test. (11B is absorbed into 10D/10E; the Found-in-Play fixes card runs between legs, after this program by Pedro's word.)

**Where it stands (2026-10-31):** 8 through 10E are built, committed and approved. The raw materials leg (D23, placed first by Pedro, 2026-10-31) is built, committed and approved. The technology web and auto skill (D27, moved ahead of the playtest fixes by Pedro, 2026-10-31) is built, committed and approved. Next: the stable database and the usability pass (Pedro, 2026-10-31: both before the full run) → Pedro's full run, with `PLAYTEST_LEDGER.md` kept as the list of what to fix → 11 → 12.

**Why this order:**
- Motion comes first because it changes the sprites the interface will show.
- The interface comes before the interiors because placing things in a room needs menus, cards and the pack.
- Templates (10B) come straight after the rooms, while the builder is hot, and BEFORE residents: Wave 11's NPC pooling then pools materials against a template's bill instead of a second one-off system — presets and templates become one contract.
- People and farms need rooms to live in; farms begin making materials renewable in the hub.
- The materials pass (11B) comes after the houses stand and the farms grow (Pedro, 2026-10-31: the full economic and transformation loops land once the house is there). Superseded the same day: 11B was absorbed into 10D and 10E.
- The gates stay serial. The one safe exception: the interior generator's prototype in 10.1 touches no shared files, so it could run alongside Wave 9.

**Decisions.** Each has a recommendation, and each changes what gets built. Ask at the start of the leg named. Still open: D10, D11 and D31. D27 through D30 are decided, built and approved.

| # | Leg | Decision | Recommendation |
|---|---|---|---|
| D1 | 8B | The camera rule | Anything with a height stands upright and shows its front; only flat ground is seen from above. The tree gets a trunk and a crown to match. **Enacted in 8B.6** |
| D2 | 8B | How many walk frames | Prototype 2 and 4 side by side and choose by eye. The brief says "a few stepped frames, never smooth". **Decided: Pedro chose 4 frames by eye (2026-10-31)** |
| D3 | 8B | Do trees block? | The trunk blocks and you walk under the crown. That gives forests real depth for little code. **Enacted in 8B.6** |
| D4 | 9 | Screens as DOM or canvas | ✅ DECIDED: DOM dressed in atom-built frames. Only the world is canvas |
| D5 | 9 | One avatar per device, or character select | ✅ DECIDED: Select. Each avatar is a complete, separate owner (`AvatarRoster`) |
| D6 | 9 | What a level gives | ✅ DECIDED (Pedro, expanded): skills grow by use — usage raises the numerical base AND discovers new skills. A rank is EFFECTIVENESS against the task's difficulty: outside combat, outranking the task by 3+ ranks is an automatic success (Magic Lockpicking SS opens a simple B lock without a roll — `ProgressionSystem.checkSkill`). Kills feed the player rank F→SSS; each rank-up grants `attributePoints` (3). BUILT IN 10E: components carry their affixes onto the item they make, and rank S+ crafts take the maker's name. STILL TO BUILD: items raising a skill's number or rank; flavour text and batch-LLM naming for S+ crafts (`canNameCraft` lends the name only) |
| D7 | 9 | How much frame around the game | ✅ DECIDED (Pedro): HUD style. A thin bar (38px) holds tabs, rank, gold, identity, console; the BANK's Agent tab is the player-facing stats/build/loadout screen for testing kits between runs |
| D8 | 10 | Generated rooms or player-built | ✅ DECIDED (Pedro, expanded, 2026-10-31): neither — a tile↔function BUILDER. Walls, stairs, windows and doors are the only structural pieces; everything else in a room is an item. Room types have minimum sizes, and higher-technology workstations need bigger rooms as the hub's technology accrues. Lot sizes grow as the hub grows (hubs grow — `IHubState` already says so). Housing, for players AND NPCs, is itself a workstation and the place where commerce happens (player↔player, player↔NPC): the economy lives in this layer, so construction must be the fully built system, not a sketch. NPCs do not design: they use preset blueprints, and players bring the materials (or the seeds that make those materials renewable in the hub); materials pool on the lot, and when the bill is met a construction timer runs (accumulate-and-resolve, like the Workshop). Wave 10 builds the construction core on player lots; NPC preset pooling lands with residents (Wave 11) |
| D9 | 10 | Lots only, or every building | ✅ DECIDED (Pedro, 2026-10-31): D8 dissolves the question. Everything inside a building is an item, a tool or a workstation — only walls, stairs, windows and doors are structure. A table is a workstation AND decoration; the material it is made from gives different bonuses; furniture is itemizable like the character is (portable, tradable, signed), so someone can live the slow life of being the hub's best table-maker — planting trees and building tables to sell. STILL TO BUILD: per-furniture bonuses derived from the material (10D's set bonus reaches whole houses only); Wave 10 ships placement, the structural pieces, and workstation items that call the existing store logic |
| D10 | 11 | Do residents cost gold? | Yes, through higher upkeep, which already goes to the hub's treasury. No new money path. **OPEN: ask at Wave 11's start** |
| D11 | 11 | Is a farm a new lot type? | Yes, a `FARM` structure alongside `WORKSHOP`, `VENDOR` and `HOUSE`. **OPEN: ask at Wave 11's start** |
| D12 | 10B | Where templates are designed | ✅ DECIDED (Pedro, 2026-10-31): at a SCRIBE'S TABLE — a generalist writing station, not a drafting-only one. [E] at it opens the builder view. The station stays generic now and specializes later through the economy loop (the same table is where scrolls and documents will be written); dev mode opens the view free for testing |
| D13 | 10B | Materials per piece, or per element | ✅ DECIDED (Pedro, expanded, 2026-10-31): material per element class stands, and the bill asks by TAG, never by type or subtype — any material carrying the tag answers it. AND: a house built FULLY of one material earns a same-material set bonus (Pedro: a STAB-like bonus, as in Pokémon's same-type attack bonus). 10B detects and records the mono-material state on the standing house and its card; the bonus's NUMBERS were enacted in 10D (`setBonusFor`) |
| D14 | 10B | Is a template consumed by use? | ✅ DECIDED (Pedro, expanded, 2026-10-31): not consumed — and the mint and copy bill is PAPER AND INK, real inputs with their own recipes (paper milled from planks; ink from gallpods and iron, the iron gall ink). The original is keepable and tradable; copies are minted at the scribe's table for the same paper-and-ink bill, and the author's signature rides every copy in provenance forever. Pedro: paper and ink also open SCROLLS FOR MAGIC later — the scribe's table is that hook |
| D15 | 11B | What the materials pass must close | ABSORBED (2026-10-31): Pedro's itemization program (Waves 10C–10E) swallowed 11B. Its scope moved: properties→bonuses/prices, purity unification, stone masonry and demolish salvage into 10D; sourceability auditing into 10E's population work; farm renewability stays with Wave 11 |
| D16 | 10C | What a cart is | ✅ DECIDED (Pedro, 2026-10-31): as recommended — a towed WORLD ENTITY with its own grid, real speed cost, stays in the world across your death, and anyone may tow it away with the theft a signed fact. Pedro's addendum: the theft risk is on purpose — it opens a whole family of SECURITY AFFIXES later (locks, wards, alarms) for 10E's banks to grow into. The extractor fantasy (from Solo Leveling): carriers as a first-class way to play |
| D17 | 10C | The belt-and-pouch law | ✅ DECIDED (Pedro, 2026-10-31): belt and pouches as recommended — pouch slots plus quick-use (potions, scrolls, no pack-opening); a POUCH is a bag type whose rule names what it stacks. And the missing head was an oversight, answered laughing: HELMET AND GLASSES — a HEAD slot and an EYES slot join the tree (glasses are a natural home for identify, scan and study affixes when 10E's banks grow) |
| D18 | 10D | How far uniqueness reaches | ✅ DECIDED (Pedro) and ENACTED (10D, `MintRegistry`): first come, first served, GLOBALLY: the bank keeps a registry of every minted item's tuple (definition, affixes, numbers); a collision deterministically nudges the later roll until it is unique, and the first keeps its claim. No two items are ever exactly the same |
| D19 | 10E | Do unstudied affixes act? | ✅ DECIDED (Pedro, expanded, 2026-10-31): they ACT — "equip at your own peril." Only the sheet is blind. AND the banks carry NEGATIVE stats and negative multipliers as offsets, so peaks can run higher: downside pays for upside, variability goes huge, and value becomes something players themselves work out. AND identify is a SKILL a person acquires: study an ITEM TYPE at a workstation, time and again, to earn identify SCOPED to that type; once earned it works INSIDE the extraction, always timed, and the skill level cuts the time (D6's skills-grow-by-use law carries it) |
| D20 | 10E | The content pipeline's shape | ✅ DECIDED and ENACTED (10E, `AffixBank`): batched LLM agent runs, dev-time for now: a run banks NAMES themed to a biome; a later run defines their EFFECTS; every batch is a signed, versioned content pack in the CONTENT namespace. A world pins its pack version at mint, so added content never changes an existing world (the determinism one-way door) |
| D21 | 10C+10E | Dying without losing everything | ✅ DECIDED (Pedro, 2026-10-31): protection from loss is never a rule — it is a MAGIC ITEM. Usage-limited or single-use charms, and scrolls that buff for a time (the scribe's table's paper-and-ink hook, D14), each naming HOW MANY slots it protects and whether they are chosen or random. A death keeps exactly what the magic named; everything else stays behind as ever. Variability huge, value player-determinable by what is protected. The slot-protection contract (which slots survive a death) lands in 10C with the slot tree; the items, scrolls and their affixes land in 10E's banks |
| D22 | 10C | The head budget | ✅ DECIDED (Pedro, refined, 2026-10-31): head-and-neck gear and cognitive frames CANCEL EACH OTHER OUT. The region is FOUR positions — HEAD (helmet), EYES (glasses), EARRING and NECKLACE — and each holds EITHER its gear OR a cognitive frame, three frames at most: max frames still leaves one piece of gear up there. THE REASON IS A STAT LAW, not geography: ONLY frames can carry mental stats — physical gear never does, in any slot — so the trade is always mind against matter and can never be dodged by mental-stat jewelry. The law binds 10E's banks too: a mental affix can only ever roll on a frame. And mental stats are not combat-dead: they drive the RECON PHASE as well (scan depth and speed draw on them — the analyst build earns its keep before the drop) |
| D23 | Raw materials leg | Raw materials and what processing adds | ✅ DECIDED (Pedro, restated 2026-10-31): base materials, non processed, can be used, and transformation processes add bonuses, affixes and suffixes — to buildings and furniture too, to everything. BUILT and approved in the raw materials leg. This rule replaces the "cold-start gap" as a separate problem |
| D24 | Raw materials leg | Which raw materials raise walls and shells | ✅ DECIDED (Pedro, 2026-10-31), as recommended: logs and stone take the `building` tag, so bills stay by tag and nothing else changes. Pebbles stay out |
| D25 | Raw materials leg | How furniture starts from raw | ✅ DECIDED (Pedro, 2026-10-31): the first bench is raised from those raw materials, and "then the next ones are tool + material connected". That connection is the technology web (D27), which is why the web comes before the NPCs |
| D26 | Raw materials leg | What processing adds | ✅ DECIDED (Pedro, 2026-10-31): the additions are deterministic with ranges, and higher rarity and rank add pools. Studying, lore and the skill itself reveal them: "the actual knowledge is through play". D19's knowledge law carries this. Room pieces must start recording what they inherit, so it reaches buildings and furniture |
| D27 | Technology web | A technology web before Wave 11 | ✅ DECIDED (Pedro, 2026-10-31): "we'll need to tackle technology web as pre 11, without it the npcs add little to nothing". D25 gives its core: tool + material connected. Pedro, the same day: it and the auto skill were already built somewhere, and that version is to be built here before anything else, "so we can produce NPC with stats sheets and skills". Sources are in the technology web's section below. **BUILT.** Decided in the build, for Pedro to overrule: the web is the hub's and the exp is the person's; a resident both extends the web and works inside it |
| D28 | Technology web | What identifies a skill: tags or prime numbers | ✅ DECIDED (Pedro, 2026-10-31): tags, on one condition: "make the tagging rule iron clad so we don't use a uuid throwaway and think that's good enough... the idea is to not have ambiguity". Primes cannot drift and tags can, so the tag law below carries what primes gave for free. **ENACTED**, all seven clauses as bars |
| D29 | Technology web | How far the web can grow | ✅ DECIDED (Pedro, 2026-10-31): no cap, "not okay by some artificial cap when the content generation is made by LLMs and it's virtually infinite". Nothing in the code limits tools, materials, tags, skills, verbs or edges. Breadth comes from the pairs and from LLM batches through D20's batch law; a fixed adjacency table is a cap wearing another name. **ENACTED**: a bar adds 5,000 entries with no code change |
| D30 | Technology web | Where a skill emerges, since Wave 9 removed REST | ✅ DECIDED (Pedro, 2026-10-31): at the sealed session and the return to the hub. **ENACTED**: the seal, the death and the withdrawal. Reading on the record: a death is a return to the hub |
| D32 | Usability pass | How identify works in the field | ✅ DECIDED (Pedro, 2026-10-31, "Yes, build it"): anyone may try. A keyed roll by the scoped eye against rank and rarity, paid in energy up front, always timed. The odds are never shown and the price is the person's, never the piece's. Unschooled tries wing it and settle at a rest. The bench still needs no roll. This amends line 55 and D19's "once earned". Numbers are guesses until Wave 12 |
| D31 | Stable database | How the SQL database is reached | Recommendation under "The stable database" below: a SQLite file on a small local server, Postgres for deploy, through the existing `VectorStore` interface |

### WAVE 8B — Motion and Sprites ✅ DONE
Start from `BUILDERS_LOG.md`.

**Builds on:** a working minimum: a two-frame walk and four facings for the player, enemies that notice and chase, shots and swings, felling stages, and rippling water and flickering lamps in the city. The job is to deepen it and keep the approved look.

- **8B.1 Atom grid:** ✅ Decided: everything drawn snaps to the 2px atom grid — camera, sprites, effects. Movement stays float; only drawing quantizes, so sprites and terrain can never sit half an atom apart.
- **8B.2 The player:** ✅ A defined standing frame (stopping always returns to it), and BOTH walk cycles built behind one constant (`WALK_PHASES` in `people.ts`, currently 4): 2-frame is contact-L/contact-R, 4-frame adds passing poses with a head-sink. The hub proof page shows them side by side, animated — **D2 decided: Pedro chose 4 frames by eye (2026-10-31).** The city walks like the field now: held keys, per-axis sliding, the same speed and cadence, standing on stop.
- **8B.3 Creatures:** ✅ Four facings and two stepped frames derived from every body plan, no new art: sides narrow to 5/8 with the eye sliding (never off the body), backs lose eyes and gain a low dorsal line, radial bodies (the god-ring) keep one face. Each plan moves only what that body would move; every delta survives TINY size.
- **8B.4 Behavior:** ✅ Enemies move through the same resolver as the player (water, rock and trunks refuse; mud slows), at their definition's own `speed` and `viewRange`. `behavior` is finally read: a Turret holds and shoots, a swarm walks to its own slot on a ring and bites only from there, a siege plods straight, neutral stirs at touch or when hit, passive ignores until provoked. Being hit provokes. Each enemy carries a facing from its own motion.
- **8B.5 Feedback:** ✅ `HIT` → four loss-brackets close on the target; `KILL` → a three-step burst and a strike-through; `PLAYER_DAMAGE` → the screen's own edge marks loss briefly. Wounded enemies show five pips (count and position, not hue). Rank marks draw at double scale in the field. All grayscale-barred.
- **8B.6 Sprite pass:** ✅ Portraits grew brows, noses, mouths, more hair, and per-id hoods and halos; the portrait bar was raised from 0.10 to 0.12 and holds per archetype. The tree stands upright (D1): life crown over matter trunk, fellings bite the crown, the stump keeps no crown and blocks nothing; the trunk blocks its tile and you walk under the crown (D3), with standing things y-sorted by their feet. The sapling is a sprout, not a plus sign. Water is a dark body with long broken crest lines inside its seams, barred ≥25% against open ground in every genre and always darker than mud's ripple.
- **Bars:** all registered in `tests/atoms.motion.test.ts` and green: every frame and facing against every resource and the exit (≥25%); walk frames change only moving parts (player ≤30%, creatures ≤40%); a 2,400-tick chase around a real lake ends 0 ticks on blocked ground; sprite memory 78KB for all creatures × facings × frames (bound 512KB); reduced motion exists (`prefers-reduced-motion` honored in field, city and both proof pages — effects hold one step, ambient animation stops).
- **Gate:** lines 21–24 pass (21–23 by test and by play; 24 by test, pips seen in play). **Line 25 was NOT measured here** (throttled background pane) — Wave 9 measured it with a visible pane: 314 things in frame at 4.17ms/frame, vsync-locked, zero drops. Cleared.
- **Also carried:** a moved enemy still belongs to its original chunk's entity list (leash keeps it near, but it is the known wrong shape); kill XP still never applied (Wave 9.5); hit-flash and death-burst were verified by code path and color bars, not caught by eye in a screenshot.

### WAVE 9 — The Interface ✅ DONE
Done 2026-10-31; **approved by Pedro ("Yes, Wave 9", 2026-10-31)**. Bars in `tests/interface.test.ts` (31 tests; suite 200). Every player-facing screen is built from the kit; Mantine remains only under the admin Genre Creator.

- **9.1 The kit:** ✅ `src/components/ui/` — `tokens.ts` (ONE theme: machine colors computed from the same `buildPalette` ramps the atoms use, so a panel border and a sprite can never disagree; `TERMINAL_GENRE` is the bank's own cold palette for UI sprites, the city keeps its warm one), `kit.css` + `kit.tsx` (Panel with ledger-rule grain, Button/Input/Tabs/Bar/Chip/Row/CardView/Dialogue/Modal — all native controls, focus always visible in signal; Bar fills are quantized to twentieths, stepped never smooth), `SpriteView`/`ItemSprite`/`PortraitView`/`RankMark`/`SealView` draw atoms into the DOM. `stores.ts` holds the view router, the feed, the receipt and the rank moment.
- **9.2 The frame:** ✅ D7: one 38px bar (wordmark, tabs CITY/ZONES/BANK/HOLDINGS, rank mark, gold, identity, console, backup, SWITCH avatar). AppShell and the sidebar are gone. The BANK gained an **Agent** tab: portrait + figure as the next drop will draw them, rank track with XP-to-next, attribute spending, cognitive frames, and the loadout (carry list, kit weight vs capacity) for testing kits between runs.
- **9.3 Birth and character select:** ✅ D5: `AvatarRoster` (localStorage roster + the old single slot as "active", migrated in). The gate is select-first; birth shows archetype silhouettes and then the REAL portrait and figure from the minted certificate; restore is a mode of the gate. **The handleLogin bug is dead:** `ensureCharacter` refuses to reinitialize an identity the store already holds, and genesis uses the gate's archetype, not 'OPERATOR'.
- **9.4 Pack and bank:** ✅ `itemArtFor` (resources by their material properties, gear by its tags, per-item seed) feeds `ItemSprite` everywhere: the field pack (real footprints in the 8×6 grid, rotation shown), the stash, shops, lot listings, receipts. No emoji anywhere (bar scans every .tsx). The inspect card (`CardView` over `inspectItem`/`inspectEntity`) answers hover, click, Q-cycling in the field, and selection in stash and shops — with refusal reasons.
- **9.5 Skills and levels:** ✅ **The bug died first:** `applyKillRewards` consumes CombatSystem's `xpReward` → `applyKillXp` on the rank track (`RANK_XP_THRESHOLDS` F→SSS, `POINTS_PER_RANK_UP`=3). A rank-up is a MOMENT (full-screen mark at 10×, the engram line, the points) and the Agent tab spends the points into baseAttributes for real. D6's auto-success rule exists as `ProgressionSystem.checkSkill` (gap ≥ 3, non-combat); the item/crafting halves of D6 are recorded in the decisions table for the crafting waves.
- **9.6 The moments:** ✅ the SEAL and DIED receipts hold the screen (haul with art, value, levy, duration, actions on record, the seal computed from the real signature; DIED mirrors it in loss). The feed (bottom-left, terminal voice) now carries: harvests, pack refusals with ground caches, energy refusals, channel broken, gear equipped/broken, consumables, NPC reactions, purchases, kill XP. The beacon chip gained a bearing (rotated chevron + octant). Lore reads from the stash and the Study window. The LEDGER tab lists every signed row with its seal and an AUDIT THE CHAIN button.
- **9.7 Dead options:** ✅ `src/entities/hub/dialogue.ts` is the whole registry; a test holds every authored option to it and an unregistered action is refused out loud. Built: OPEN_BANK (navigates), SHOW_BALANCE, OPEN_LEDGER, IDENTIFY_ITEM/IDENTIFY_ALL (charges to treasury, resolves stash items), OPEN_LORE, OPEN_MISSIONS, QUICK_DEPLOY (through the one `deployToWorld` door Mission Control also uses), OPEN_SHOP, OPEN_SELL, OPEN_REPAIR (cost scales with damage), BUY_CONSUMABLE (mints a real Watered Ale, health_restore 15), GET_HINT (the day's rumor, deterministic per hub+day). Removed, with the keepers saying so in voice: REST (nothing in the hub is wounded), guild forms (the Hall says the charter ledger is sealed), auction forms (Quickfingers points at the player lots). Hubs no longer appear as deployable zones.
- **Recon rebuilt:** sector cells are computed atoms (`src/render/atoms/recon.ts`): each biome brings a STRUCTURE (dunes/blotches/strata/lattice/traces) in matter ink over a GROUND value key, the unknown is void static, exits are signal lozenges with void moats, contacts are loss ticks — position, shape and seams, never hue. The eye corrected the numbers once: ground-ramp-only cells passed the step-difference bar and were still unreadably dark, so structures moved to the MATTER ramp. The survey pans at true cell size (32px) and recon gained WITHDRAW.
- **Bars (all green):** no emoji in any .tsx; no font below 12px (tokens are the floor); kit renders native controls with visible focus; recon biome pairs ≥25% apart by atom steps in grayscale at every scan depth, unknown ≥30%, exits ≥8 signal atoms; every dialogue option registered with a real effect; itemArt at real footprints, unidentified ≥30% noise.
- **Line 25 finally measured, honestly:** 314 animated things in frame (154 natural + 160 spawned hostiles swarming), browser pane VISIBLE: 4.17ms/frame average over 10s, vsync-locked at 240Hz, p95 4.3ms, worst 4.3ms — zero dropped frames. (Trap for the record: a hidden pane throttles rAF to ~3fps with an idle main thread; front the pane AND show it before believing any number.)
- **Seen by eye in the real game:** birth → real face; select → jack in with nothing reset; rank-up moment on a real kill (F→E by play, D by primed threshold); hit brackets, pips, hurt edge; the seal; the DIED receipt; the survey in color and grayscale; the pack's real art; the armory's real art; the feed.
- **Gate:** test lines 26–31 pass (26–30 by test and by play; 31 by test and both receipts seen by play).
- **Carried, honestly:** an ABORTED session (recon WITHDRAW) has no receipt moment, by design for now. The `[E]` radial menu options draw from `IInteractionOption.label` — their `icon` field is dead data. The near-twin figures, worn-gear subtlety and keeper stillness stand as before.

### WAVE 10 — Inside the Houses ✅ DONE
Done 2026-10-31. Bars in `tests/rooms.test.ts` (27 tests; suite 227). Reshaped at the start by Pedro's D8/D9: rooms are built, not generated, from a tile↔function builder — walls, stairs, windows and doors are the only structure, and everything else is an item.

- **10.1 The composer, first as a prototype:** ✅ `src/entities/hub/room.ts` is the contract and the pure logic (build record, occupancy, flood-fill walkability, refusals in voice, bills by material TAG per `IBlueprint`'s law, the minimum-size rule, NPC presets); `src/render/atoms/room.ts` turns a record into atoms — warm plank floor, walls drawn from the material that paid their bill (a plank wall, an ingot wall and a glass wall differ by grain, in color and grayscale), windows spill brightness, placements blit `itemArtFor`. Proof page `prototype/atoms/room.html`: shells at three lot sizes, the three materials, a lived-in workshop, the three NPC presets, the minimum-size refusal saying its numbers, and the street-side buildings. Touched no shared files until the game wiring began.
- **10.2 Entering:** ✅ a built lot draws as a real building (gable/corrugation+chimney/awning — apart by atoms ≥25%), blocks its whole footprint (`builtLotBlocksAt`; the door tile sits one row below), and `[E] ENTER` walks you in through the city door to the room's own door gap. Your city position is kept; walking the doorway puts you back on the street. HUD shows the lot; the feed narrates both crossings.
- **10.3 The builder:** ✅ THE WORKS panel in your own room: WALL/DOOR/WINDOW on the tile ahead (STAIR refused in voice: one floor at this tier), each consuming its bill from the stash at queue time — exactly once — and applying on the clock (`IBuildJob`, accumulate-and-resolve like the crafts; pending pieces draw as outlines). The shell itself became a construction: gold permit (`STRUCTURE_COSTS`, to the treasury) + material bill (`SHELL_BILLS`) + timer (`SHELL_BUILD_SECONDS`); a WORKSHOP mints its Work Bench and a VENDOR its Shop Counter on completion (provenance MINT, origin CONSTRUCTION). Every queued step is signed by the owner's certificate; `BUILD` is a ledger row type.
- **10.4 Placement:** ✅ any stash item stands in the room at its real art (`stn_bench` 2×1, `stn_counter` 3×1, `stn_table` 2×2 — `ItemType.STRUCTURE`, and `recipe_table` mills three planks into a sellable table, per D9). The validator refuses whatever would seal the way out or wall a thing in, and a station refuses a region smaller than its minimum, naming the numbers. The placed bench and counter open windows that call the SAME `queueCraft`/`resolveCrafts`/`listItemForSale`/`buyFromLot`/`collectProceeds` the Holdings panels call. Placements are signed, carry provenance (TRANSFER via PLACED/RECLAIMED), survive reload byte-for-byte, and come home to the stash on foreclosure.
- **10.5 NPC presets:** ✅ as data (`ROOM_PRESETS`) rendered by the same composer on the proof page; every preset fully walkable with every station reachable, by bar. The pooling flow (players bring materials, a timer runs, a resident moves in) lands with Wave 11's residents.
- **Bars (all green):** same build record → same bytes (and across deep copies); every room walkable from its door at three lot sizes and in every preset; the builder refuses the sealing wall, the corking placement, the door tile and the stair, each with its reason; stations refuse too-small regions naming need and have; materials consumed exactly once per step (double-resolve mints nothing twice); a placed item is never lost or duplicated across a cold reload and returns exactly once on reclaim and on foreclosure; composing stays inside 25ms (measured ~1ms); walls read apart from floor in grayscale and the door gap reads open; built lots block exactly what they draw with a doorway at the bottom centre.
- **Played through the real interface:** mint BASALT → materialize → buy two lots → raise WORKSHOP and VENDOR (permits paid, bills consumed, clocks watched) → walk to Homestead Row → the buildings stand and block → E through the door → place the minted bench, signed → mill planks AT the bench → build a plank wall ahead (8s, outline, then solid and blocking) → full reload → jack in → the room identical → place the counter, list a Cut Plank, buy it (the hub kept its 3 G cut).
- **Carried, honestly:** STAIR is typed and refused (single floor until the hub grows); stations are told apart by their card and name, not yet by a silhouette family of their own; build/place targets the tile ahead (keyboard-first — no pointer tile-picking yet); demolish returns no materials; any walker may enter a built lot (commerce wants it) while build/place/reclaim stay the owner's; a HOUSE has no function hook yet; interior size is a fixed function of the lot footprint — lots growing as the hub grows waits for hub expansion itself.
- **Gate:** test lines 32–34 pass, by test and by play.

### WAVE 10B — The Architect ✅ DONE
Done 2026-10-31. Bars in `tests/templates.test.ts` (25 tests; suite 252), registered before the build. Pedro answered D12/D13/D14 at the start, each bigger than the recommendation (recorded in the decisions table): the station is a SCRIBE'S TABLE (generalist — scrolls will be written at it too), a mono-material house earns a recorded set bonus, and the mint runs on PAPER AND INK with their own recipes.

**The idea held:** the template separates GEOMETRY (designed once, signed by its author, tradable as an item) from MATERIALS (chosen at apply time, per element class). Architecture became a trade: BASALT designed a plan at a scribe's table built from planks and ink, minted it, copied it, sold the copy over the counter, bought it back, and raised a house from it on another lot.

- **10B.1 The contract, as data first:** ✅ `src/entities/hub/template.ts` — `ITemplate` (version, name, structureType, footprint class, pieces as geometry only, named FLOOR ZONES with promised open areas, author fixed at design time), `ITemplateSheet` (D13: one material per element class, billed by TAG — walls, doors, windows, each zone's floor), `templateToRoom` as the ONE composition path, `validateTemplate` running the same `canBuildPiece` law the Wave 10 builder runs plus whole-plan walkability and zone promises with the numbers. `ROOM_PRESETS` fold in: each preset now rides a SYSTEM TEMPLATE (`SYSTEM_TEMPLATES`, author THE HUB) and `presetToRoom` goes through `templateToRoom` — one contract, no second path. The law holds: an invalid plan cannot be minted, and the refusal says why.
- **10B.2 The builder view:** ✅ `src/components/TemplateStudio.tsx`, opened by [E] at a placed SCRIBE'S TABLE (`stn_scribe`, STATION_FUNCTION 'SCRIBE'; dev mode opens it free from Holdings). Size class, structure type, tile cursor (arrows/WASD move, SPACE draws, 1–5 pick tools, G toggles grayscale), live refusals in voice on every stroke (`canAddPiece`), zones painted and measured live ("STUDY — 4 tiles · 137 open"), preview through `composeRoom` itself in color and grayscale. MINT TEMPLATE pays the paper-and-ink bill, uppercases the name (the lore naming hint is on the panel), signs the plan into an `ITemplateItem` with provenance MINT origin DESIGN. The COPY tab mints copies for the same bill — provenance MINT origin COPY, THE ORIGINAL AUTHOR riding every copy (D14).
- **10B.3 The trade:** ✅ nothing new but the CARD, as planned: the existing counter/`listItemForSale`/`buyFromLot` sold and bought a plan unchanged (hub kept its cut; played). `inspectItem` gained the template branch (size needs, piece counts, zone promises, ARCHITECT, signed date) and `itemArtFor` draws a template as its real composed plan, downsampled (`templateThumb`) — real atoms, never an icon, everywhere items draw.
- **10B.4 Raising the house:** ✅ `applyTemplate` in the hub store: ownership/emptiness checks, size needs refused with the numbers (line 43), the MATERIAL SHEET (`TemplateApplyModal`) choosing one material per element class from what the stash really holds, the whole bill + gold permit consumed exactly once at apply (a refused apply consumes nothing — played: the glass shortfall refused in voice and nothing moved), then one signed `IBuildJob` batch: shell first, pieces in the plan's own order, each on its own clock. UNDER_CONSTRUCTION joined the lot states: a scaffold dense enough to read blocked on every tile (and the city blocks exactly that footprint), with the building rising solid from the ground as progress climbs — read by shape from the street, forward only. After the shell lands you can walk in and watch the outlines become solid in order. Finished means `templateMatchesRoom`: piece for piece, zone for zone.
- **10B.5 The house remembers its architect:** ✅ `IRoomState.template` carries name + author; `inspectTemplateRoom` is the plaque, drawn from the street when near the lot and inside the room. D13's expansion: `monoMaterialOf` detects a house built fully of one material, and the card says so — "ONE MATERIAL: Cut Plank. The set bonus is on record; it pays when the materials pass lands" (the numbers are 11B's, with D9's property bonuses).
- **The paper economy (D14):** ✅ `recipe_paper` (1 plank → 2 Pressed Paper), `recipe_ink` (1 Gallpod + 1 raw iron → 2 Iron Gall Ink — the oldest ink there is), `recipe_scribe_table` (2 planks + 1 ink). The alchemist now stocks the Gallpod. Pedro's hook on record: paper and ink open SCROLLS FOR MAGIC later; the scribe's table is deliberately generalist.
- **Bars (all green, registered first):** same template + same sheet → same bytes (and across deep copies, and different sheets differ); zone floors read apart per tile (≥10%); every system template validates; invalid plans refuse in voice (sealing column, interior window, stair, the way out, over-promised zone with the numbers); a refused mint and a refused apply consume nothing; mint pays paper+ink exactly once with DESIGN provenance; the apply bill is consumed exactly once (double resolve doubles nothing) and jobs ascend in order; the finished room matches piece for piece and survives a cold reload byte for byte with its architect; author survives copying by another hand and resale; the scaffold is ≥70% solid per blocked tile and its fill only grows; thumbnails are the composed plan and differ between plans; mono-material detection (all-plank yes, one glass window no).
- **Played through the real interface, as BASALT:** bought axe, pick and gallpods (the new shelf line) → died for real walking a rank-D ruins sector (the world kept the tools and 56 G — the Wave 10 warning is true) → re-bought tools, walked the field with raised in-memory health (the logged test practice; two lake stretches crossed by teleport, on record), felled 6 logs through the real harvest menu, mined 2 iron (pack-full refusal → ground caches → traded the spent tools into the cache for the ore), channelled out at a beacon → SEALED, 335 G haul → milled planks, pressed paper, boiled iron gall ink, joined and placed the scribe's table, signed → drew a plan at it (window-on-floor refused in voice), minted GALLPOD ROW HOUSE, minted a copy, listed the copy for 150 G and bought it back (hub kept 8 G) → the glass bill refused the first apply honestly → pressed more paper, drew BASALT TERRACE (no windows, all plank), minted, APPLIED on the empty lot: 100 G permit + 8 planks consumed once, 4 steps on the clock → the scaffold stood and BLOCKED (walked into it), "UNDER CONSTRUCTION — 1 of 4 steps stand", the building rose by shape → entered, watched outlines fill → finished house matches the plan, STUDY zone laid, plaque reading BASALT TERRACE / ARCHITECT BASALT / ONE MATERIAL from street and room → full reload: everything identical, three plans still in the stash, none burned.
- **Carried, honestly:** line 43's size refusal passes by test and shows in the sheet, but every city lot is one 4×4 class today, so the refusal cannot be PLAYED until lots grow with the hub (the 3×3 and 6×5 classes exist in the studio now); the mono-material set bonus is detected and recorded, its numbers land in 11B; template thumbnails ghost their materials (geometry is all a plan fixes); per-piece material exceptions remain the Wave 10 tile-ahead builder, as D13 says; switching app tabs while in the city still returns you to the plaza spawn (pre-existing; noted for a later pass).
- **Gate:** test lines 41–44 — 41, 42, 44 by test and by play; 43 by test, and by play as far as one lot class allows (the sheet shows the verdict line; the numbers were exercised in the bar).

### WAVE 10C — The Load-Out ✅ DONE
Done 2026-10-31; **approved by Pedro ("Now we're good", 2026-10-31)**. Bars in `tests/loadout.test.ts` (41 tests; suite 293), registered before the build. All of D16, D17, D19, D21 and D22 were decided before the leg started; nothing was asked.

- **10C.1 The slot tree:** ✅ the three buckets became the full body (`types.ts`, additive): the fifteen positions (HEAD, EYES, RIGHT_HAND, LEFT_HAND, CHEST, LEGS, BOOTS, SHOULDER, BAG, NECKLACE, EARRING, RING ×2, QUIVER, BELT) plus dedicated TOOL slots — `TOOL_SLOT_COUNT` is a constant, raising it is the whole cost of more; a tool is used from its slot without unequipping weapons (played: blade in the right hand, buckler in the left, pick in TOOL_1, all at once). Equipped items LEAVE the pack and live on `IPlayer.equipment` — the harness persists in the bank doc and comes home. `LoadoutSystem` is the pure law (acceptance, requirements, the budget, the partition); `LoadoutSystem.migrate` brings Wave 4's `equipped` buckets in on hydrate, idempotently. The SHOULDER piece is themed per genre on the shelf (`themedShoulderName`). The paper-doll (`PaperDoll.tsx`) draws the body on the Agent tab from the same atoms: position is the code, a cognitive frame reads as a hollow diamond (`frameMark` — type coded by interior structure, never hue), arrows/Enter/U/F walk and work every slot, and every ineligible vault item SAYS its refusal in the fitting list.
- **D22, the head budget:** ✅ HEAD, EYES, EARRING and NECKLACE each hold gear OR a frame; three frames at most (the fourth position refuses in voice); frames moved from index slots to positions (`equipment.frames`, floatMemory kept as a mirror). THE PARTITION IS A STAT LAW AND A BANK LAW, NOT A DRESS CODE (Pedro's correction, 2026-10-31, superseding this leg's first cut): gear has no pathway into the mind (`recalcAttributes` reads frames only), so contraband wears fine with its mental line dead — the inspect card says "asleep" — while `validateStatPartition` stays as the validator 10E's bank batches must pass ("Silk Robe of the Owl", +intelligence suffix, is the played proof: worn at the CHEST, intelligence unmoved). Mental stats drive recon: `reconEfficiency(attributes)` sets scan depth per click — played: a base click reached BASIC, the framed analyst's single click reached DETAILED with the full manifest.
- **10C.2 Requirements:** ✅ stamped at mint, derived deterministically from rank and tags for anything older; refused in voice with the numbers ("Refused: Great Helm asks STRENGTH 3; you hold 1") in the store, the fitting list and the card. D19 reaches back: `visibleItemStats` subtracts every unstudied affix (the stub says nothing is studied; 10E makes study real) — the inspect card now shows the blind sheet while `item.stats` keeps acting.
- **10C.3 The weight law:** ✅ equipped gear weighs nothing against the carry limit (the harness left the pack, so the law falls out of the shape); hauled weight still counts; bags extend capacity (`carry_bonus_kg`, played at 60→70 kg); the BELT opens pouch slots; a POUCH stacks ONLY what its rule names, to its capacity, both refusals in voice; quick-use fires from the belt by digit keys with the pack never opened (played mid-maul).
- **D21, the slot-protection contract:** ✅ any slot can be marked protected for the session, naming the magic (`markSlotProtected`; dev hook `__ws.protectSlot` until 10E mints the charms). The death path keeps EXACTLY the protected slots — pack and unprotected harness fall, frames survive (mind is not loot), marks are spent by the death — and the DIED receipt carries a KEPT BY MAGIC block naming each kept item and its magic. Played: ward on RIGHT_HAND, death by shamblers, the blade alone came home, the receipt said by whose hand.
- **10C.4 The cart (D16):** ✅ a packed cart item unfolds into a CART world entity (own grid 10×8 > any pack, owner seal signed at deploy). Load/unload through the grid's own caps; tow at a real cost (`towSpeedModifier`, played: 89px walked where 120 would have); leave it, come back for it. `CartOverlay` persists every cart per world uid — the ONE thing in a world not derived from its seed — so it stands across your death (played: died towing it; it stood, cargo intact) and across an extraction without it. Anyone may tow it: the theft is a SIGNED fact in the cart's log, said on the card and warned in the menu ("GABBRO'S SEAL — THE THEFT WILL BE SIGNED"; played with a second minted identity). Towing it into the beacon banks its bed and folds the kit back into the stash, exactly once; gear equipped mid-run counts as haul for the levy.
- **Bars (all green, registered first):** every slot holds/refuses with the reason; 400 keyed random equip/unequip/stow/belt/cart operations conserve the item multiset; equipped weight provably exempt while hauled counts; unequip into a full pack refuses and the harness holds; the belt comes off with its pouches intact or not at all; cart grid/determinism/theft/death bars; the partition refuses mental-stat gear and admits frames; recon efficiency moves only with mental stats; the paper-doll lays out every slot once, non-overlapping, stable for the keyboard; frame marks read apart from gear and from each other in grayscale; migration is lossless and idempotent.
- **Played through the real interface** (fresh origin; BASALT's 3101 was held, so GABBRO the Operator and MAGPIE the Street Samurai were minted on 3102): mint → full body dressed through the fitting list and the one store door → Great Helm refused with the numbers → frame seated at HEAD, helmet refused by the budget, frame cleared, helmet on (after a logged +2 strength test grant), traded back → pouch filled with Stim-Berries, quick-used by key under fire → cart bought, unfolded, loaded, towed at cost → ward on the right hand, died in the swarm, DIED receipt read KEPT BY MAGIC, frames and blade survived, all else fell → redeployed: the cart stood where it was left, cargo recovered exactly once → extracted WITHOUT it (it stayed, on record) → MAGPIE deployed, towed GABBRO's cart away, theft signed under GABBRO's intact seal → towed it into the beacon: bed banked (20 G, 1 G levy), kit folded into the thief's stash, overlay empty → recon: MAGPIE's click BASIC, GABBRO's framed click DETAILED. Test practices on record: +3,000 G grant, +2 strength grant, two beacon teleports.
- **Carried, honestly:** the shoulder theming landed after the played purchase (the bought piece reads "Mantle"; the next shelf day reads its genre); left hand and boots were proven by bar, not play (no off-hand or boots on that day's shelf); the satchel's art reads muddy at the paper-doll's large cells (numbers pass, the eye notes it); legacy mental-affix gear (the Owl family) remains in stash and shops, wearable with its mental line dead, until 10E purges the banks; the cart-to-beacon tow used teleport assist (the honest long tow waits for Wave 12); recon depths beyond DETAILED-in-one-click are untouched; a fix of the leg's own making: shop listing ids now carry a batch tag (two same-rank batches used to collide and sell the wrong row).
- **Gate:** test lines 47–49 pass, by test and by play. Line 56's contract half (death keeps exactly the named slots, the receipt says so) is proven here; the item half waits on 10E.

### WAVE 10D — The Anatomy of Items ✅ DONE
Done 2026-10-31; **approved by Pedro ("Yes, Wave 10D", 2026-10-31)**. Bars in `tests/anatomy.test.ts` (29 tests; suite 322), registered before the build. D18 was decided before the leg started; the one decision the leg itself owed — demolish-salvage — was taken in the record (below). Pedro's order held: the economy was audited FIRST, and the findings drove the pipeline.

- **10D.1 The economy as found (the audit, before anything was built):** ONE player gold faucet exists — the 500 G genesis grant; kills and chests drop items, never gold; each hub holds a one-time 100,000 G endowment that funds vendor buybacks (60% of value, treasury-capped); every sink (markup ×1.5/×3, lots 5,000 G, permits, upkeep, levy 5%, shop fee 5%) drains to the treasury. Item value was material-blind for gear (2×IP) and CHAIN-BLIND for goods (weight×4+hardness). **The finding that drove 10D.4: labor destroyed value in six of eight chains** — 2 ore (122 G) smelted into an ingot worth 67 G; 3 planks (78 G) joined into a table worth 30 G; ink, paper, glass, cloth and the scribe's table all negative; only milling paid. Construction masked it: bills consume at any price, so crafting was done for use, never for margin — nobody could be the hub's best table-maker. Also found: `purchaseFromShop` re-id'd bought items with `crypto.randomUUID()` (a determinism leak, fixed here under D18); stone answered NO building bill; quality lived on three scales; one listing's stock was the same item object sold up to six times.
- **10D.2 Composition:** ✅ `IComposition` on `IItem` (contract upgrade, additive, versioned `COMPOSITION_RULES_VERSION`): materials with per-item counts and lawful origins (HARVEST, PURCHASE, IMPROVISATION, WORLD, CONSTRUCTION, SALVAGE), the step-by-step chain with each step's labor, per-item labor seconds, depth (the longest path) and batch yield. `CompositionSystem` is the pure law: `root` for raw things, `compose` folds consumed items' chains into the output (counts and labor divide by the batch, inputs' stories concatenate, depth = max+1), byte-deterministic for the same chain. Every mint path stamps it: harvests, crafts (jobs snapshot what they consumed, composition and all), shop units, construction stations, salvage, world rolls. **The floor exists and is played:** `GEAR_RECIPES` with `requiredFacility: null` are improvised — a Dense Stone and a Hardwood Log lash into the Stonebound Club with NO bench, anywhere, through a real IMPROVISE button in the field pack; its item power (31) is measurably below the weakest weapon the shelf can mint (40). **The chain is the power budget:** `powerBudget` derives crafted gear's IP from its root materials' properties × depth — the Iron-Headed Maul (fell→mill, mine→smelt, hang; depth 2) lands at IP 63, twice the club. The inspect card says the anatomy everywhere: MADE OF, CHAIN (with "(no bench)"), LABOR and depth — or the origin in voice ("Torn back out of a wall").
- **10D.3 Uniqueness (D18):** ✅ `MintRegistry` — the bank remembers every ROLLED mint's tuple (definition, rank, rarity, quality to 6 decimals, stats, affix rolls, hashed); a collision walks a deterministic nudge ladder (+0.0001 quality per rung) until it stands on a free rung; the first keeps its claim, claims are never released, and re-claiming by the same item id is idempotent — so journaled rolls replay to the same rung forever. Persisted write-behind (`mint_registry_v1` in ITEMS), hydrated at hub load. Scoped honestly: commodities (planks, ore, blocks) are fungible by design — ICommodity is the bulk contract; their uniqueness is their provenance. The shop's randomUUID leak died here: each unit of stock is its own deterministic mint keyed by listing and remaining stock, claiming its own rung — played: two Field Axes from one listing, distinct ids, qualities 0.058228 and 0.058328. **Fixed in passing (found by the bars):** two crafts queued in the same millisecond on one lot shared a job id, and their outputs minted with IDENTICAL item ids — the queue length now breaks the tie.
- **10D.4 Prices from the chain (absorbing 11B's price work):** ✅ `priceOf` = atoms (the kept root law, weight×4+hardness, now quality-adjusted) + labor × route rarity (1 + 0.25 per depth past 1) — monotonic in depth by construction, and **every real recipe is now value-positive** (the ingot prices at 137 G over its 122 G of ore; the day the audit table above went right-side-up). Crafted outputs carry chain prices through the real store. **D13's deferred numbers landed with D9's property bonuses:** `setBonusFor` derives the mono-material set bonus from the material's own properties — upkeep −min(40, (hardness+density)/2)%, craft speed +min(30, conductivity/2)%, light +⌊luminosity/5⌋ — and they are REAL: a mono-material house is charged the discounted upkeep, a mono-material workshop finishes jobs faster, and the plaque says the numbers.
- **10D.5 The absorbed materials matters:** ✅ MASONRY — `recipe_masonry` cuts 2 Dense Stone into a Cut Stone Block carrying the `building` tag: stone finally answers a wall bill, and a stone wall reads apart from plank by seam grain (bar ≥10%; the eye's note is carried below). ONE QUALITY LAW — everything mints on the gear scale now (resources, deeds and templates at 0 = no roll; the dead `quality: 100` and the never-instantiated commodity `purity` are retired); quality reaches material value; the card shows the row only when a roll or a bite moved it. DEMOLISH-SALVAGE, **decided and enacted**: tearing a piece down returns its WHOLE bill as real items of the material that paid it, but every demolition bites the quality by 0.10, floored at −0.20 — build-and-tear grinds materials toward Crude; gold permits and shell bills never return; salvage mints signed, with SALVAGE on its record. The reason: full free return would make walls reversible storage, and zero return (Wave 10's placeholder) punished honest rebuilding; the bite is a real sink that the one-quality law prices.
- **Bars (all green, registered first):** composition complete with lawful origins on every mint path; same chain → byte-identical composition, price and budget; the improvised club measurably the worst weapon the game can make and the deep maul above it; price strictly monotonic in depth for fixed materials; no real recipe destroys value; a 3,000-mint storm holds no two identical tuples; the nudge ladder deterministic, idempotent and replayable; two units of one listing distinct and deterministic; masonry answers the wall bill and reads apart in grayscale; one quality scale with value following; salvage returns the bill bitten exactly once, floors at −0.20, never dupes, never refunds a shell; set-bonus numbers distinct per material and actually charged; the full-loop gold-and-item audit balances (ledger replay plus item multiset: nothing exists twice, everything knows its atoms).
- **Played through the real interface, as GABBRO on the 3102 origin:** two Field Axes bought from ONE listing (the bank nudged the second roll — D18 seen on the shelf) → an honest death to the Overgrowth's flyers mid-fell (304 G of kit lost, receipt signed) → re-kitted with the day's last pick (the Rusty Pick had sold out; the 1,119 G Tempered) → four logs felled with the slotted axe and SEALED (140 G haul, 7 G levy) → the framed analyst's single click read a sector to the full manifest → dropped on RUINS found by recon, mined Dense Stone, and **lashed the Stonebound Club together in the field through the pack's own IMPROVISE button** — its card reading "1 Dense Stone, 1 Hardwood Log · Lash Stone to Haft (no bench) · 5s on the record, depth 1" — equipped it, swung it, and lost it with everything else to a second honest death (1,229 G to the world) → the hub leg on ledgered test grants (below): lot, WORKSHOP raised, and the bench's real buttons ran mill → smelt → masonry → HANG AN IRON HEAD: the maul minted at depth 2, IP 63 over the club's 31, 226 G over 86, remembering "2 Iron Ore, 1 Hardwood Log" → a stone wall built from the cut block and torn down again: the block came home Rough −10%, "Torn back out of a wall" on its card → the gold audit ran green over 51 ledger rows → a cold reload kept every byte: the maul's chain, the salvage bite, the workshop, and the registry's 38 claims.
- **Test practices on record:** raised in-memory health and beacon/terrain teleports for the material runs (the logged Wave 8 practice); +9,000 G and 16 materials granted THROUGH the ledger (TEST_GRANT_10D rows) for the hub leg after the second death; 10C's historical unledgered +3,000 G grant booked as a reconciliation row so the audit could speak.
- **Carried, honestly:** a fresh origin cannot raise its first WORKSHOP honestly — the shell bill asks for crafted goods only a workshop makes (the cold-start gap; Wave 11's NPC pooling or a shelf line should close it — superseded: D23 closes it); balance is loud now and belongs to Wave 12 — flyer swarms broke five extraction channels and killed a 2,000-health test rig twice, and a mob biting from beside the player could not be found in any loaded chunk's entity list to fight back (the known moved-mob shape, now with teeth); stone and plank wall FACES are near-twins in grayscale at game scale — the seams differ (stipple vs hatch, bar-measured), but the wall family wants a bolder large-scale structure difference, the same lesson the survey cells taught in Wave 9; the mono-material set bonus numbers are charged and said by bar, not yet seen in play (no templated house stands on the 3102 origin); crafted gear's value derives from its chain only — its quality roll moves stats, not price (the law's current edge, recorded); the in-game AUDIT button replays gold — the item half of line 54 lives in the bar's store-driven multiset audit; `history.dropDate` still stamps wall-clock time on mints. D6's crafting half is placed: components carrying affixes and S+ naming land with 10E's banks.
- **Gate:** test lines 50, 51 and 54 pass, by test and by play.

### WAVE 10E — The Affix Bank and the Dreaming ✅ DONE
Done 2026-10-31; **approved by Pedro (2026-10-31)**. Bars in `tests/affixes.test.ts` (43 tests; suite 365), registered before the build. All of D19, D20, D21 and D22 were decided before the leg started; nothing was asked. The program's last leg: 10C slots ✅, 10D anatomy ✅, 10E banks ✅.

- **10E.1 The banks:** ✅ `IBankedAffix` / `IAffixBatch` / `IContentPack` joined the contract (additive); `AffixBank` is the law — a NAMES run banks names only, an EFFECTS run defines banked names once each, and any broken entry refuses the WHOLE batch, clean siblings falling with it. D22 is a bank law enacted: a mental stat rides only an entry scoped exactly `['frame']` ("…and gear doesn't think. A mental affix only ever rolls on a frame."); the shipped bank's one mental entry (`of the Long Vigil`) is frame-scoped and rolls nowhere until frames become items. THE PURGE is real: the live legacy pool is `AffixBank.legacyPool()`, the Owl (`suf_int`) dropped from every future roll — 500 keyed mints carry no mental affix by bar — while standing contraband wears on with its mental line dead, as 10C left it. Two batches ship (`src/entities/generation/packs/affixBatches.ts`, both authored as real LLM dev runs, the model on each record): run 001 "The First Naming" — 32 entries themed to the five biomes plus GLOBAL and CART; run 002 "given teeth" — 27 effects, several deliberately NEGATIVE (Unpaid: +damage, −max health; Sun-Flayed: +defense, −health; downside pays for upside, D19). Five entries stay name-only after v2 — the bank remembering more than it says, on purpose.
- **10E.2 The knowledge law (D19):** ✅ the 10C stub died: `LoadoutSystem.isAffixStudied` reads `materialMastery`'s `discoveredAffixes` — the one knowledge ledger, never a parallel one — and `StudySystem` is the law: identify is a SKILL scoped by item type (weapon/armor/tool), earned as `skill_identify_<scope>` in `universalSkills` by STUDY sittings at a workstation (the bench window gained the STUDY section; skills grow by use, D6), usable in the field ALWAYS TIMED (12s at level 1, falling with skill, floored at 2s, never free), and refused in voice for an unschooled scope ("Your eye is not schooled for armor. Study armor pieces at a workstation, time and again, and the field will obey."). Study reveals EXACTLY the banked record, negative offsets included; the inspect card shows a studied affix's numbers and keeps the blind line for the rest. The pack grid grew the IDENTIFY button with its honest clock.
- **10E.3 The Dreaming:** ✅ `DreamingSystem` — a world POPULATES from the banks deterministically from (seed, pack version): mob drops and chest loot roll from the biome's themed pool (theme + GLOBAL + CART, nothing else, 100% in theme by bar), harvests carry a banked material affix at a keyed 8% ("Mire-Cured Hardwood Log — the Seed dreamed something into this one"), and the COMPLETE scan reads THE DREAM on the sector intel — themed signatures fixed by (seed, version, place), with the lore's own line. The version pins at mint (`IWorldRules.contentPackVersion`, stamped by `mintWorld`), rides the world card ("DREAM PACK v2 — pinned at mint"; older worlds read "MINTED BEFORE THE BANKS — it dreams nothing new" and keep the purged legacy pool forever). No later batch alters a pinned world, structurally: a v1 world compiles only batch 1. Positions never moved — the Dreaming is the contents layer; the golden vectors stand untouched.
- **10E.4 The pipeline (D20):** ✅ the harness is `scripts/run-affix-batch.ts` (vite-node): shipped batches validate version by version with each pack's hash printed; a candidate batch JSON is judged against the full bank before it may ship; the game signs the current pack into the CONTENT namespace at hub load (`content_pack_v2`, a real WebCrypto signature under the loading identity) — a bank batch loads, validates and signs, or is refused whole, by bar and on screen.
- **10E.5 Insurance is an item (D21):** ✅ `InsuranceSystem` — the Clasp of Keeping (1 chosen slot, 1 use), the Gambler's Knot (3 slots, not your choosing, keyed by the charm's own id), the Scroll of the Kept Hand (1 chosen slot, one hour of the clock — `ISlotProtection.until`, a lapsed mark holds nothing at the death). Charms and the scroll stock the alchemist's shelf; scrolls are also WRITTEN at any scribe's table for paper and ink (the studio's new SCROLLS tab, D14's hook kept), signed into provenance, refusals naming the shortfall. INVOKE lives in the vault and the field pack; a use is a use; the death path keeps exactly the named, unexpired slots and the DIED receipt reads KEPT BY MAGIC naming the charm. CART SECURITY grew in the same banks (D16's addendum): `Warded` (cart_lock — a thief's tow costs 10s per lock level, the owner pays none, the broken lock in the signed theft), `Shrieking` (cart_alarm — the shriek says the thief's name), `of Seven Locks` still name-only. `CartSystem.securityOf` captures the kit's affixes onto the unfolded cart.
- **D6's crafting half:** ✅ components carry their affixes onto the item they make — craft jobs snapshot consumed items' affixes and `createComposedItem` folds them in (stats acting, name riding), the partition holding the door (a mental component affix never lands on gear); `improvise()` inherits the same way through the field button. Rank S+ crafts take the maker's own name: the bench shows the pen only for an S+ making (`canNameCraft`; "The bank lends its pen at rank S…"), and `recipe_masterwork_blade` (3 ingots, plank, cloth, 120s) is the first making it lends to.
- **Bars (all green, registered first):** batches validate/compile/sign or refuse whole (names-with-stats, stranger effects, duplicates, the Owl Reborn refused whole with its clean sibling); every theme present; negative offsets ≥5 entries; name-only entries exist and roll as nothing; the purge (raw table keeps the Owl, live pool does not; 500 mints clean; the partition names the contraband); biome pools deterministic and in theme (100% over 180 rolls); same (seed, version) → byte-identical rolls; v1 vs v2 ≥30% different; a v1 world identical while v2 stands; sector dream deterministic, in theme, place-varying; material dream keyed and resource-scoped; dreamed loot draws only bank ids while legacy draws none; the blind sheet (acting ≠ shown) and the exact reveal (negatives included); scope refusals in voice; identify timed, monotone falling, floored; training by sittings through the store door; field identify through the one door; knowledge in materialMastery, no parallel ledger; charms name their protection, mark exactly it, death keeps exactly it, receipt names the magic, uses spend and consume; random plans keyed-deterministic; scrolls on a clock (expired keeps nothing) and written for paper+ink exactly once; cart entries cart-scoped, lock time real, zero for the owner, broken lock in the theft log; component affixes ride, mental ones never, S+ names honored, sub-S refused in voice; charms/scrolls on the shelf, charmData surviving the purchase mint.
- **Played through the real interface, as GABBRO (and MAGPIE) on the 3102 origin:** the signed pack verified in CONTENT at hub load → Clasp, Scroll, the day's "Soldier's Gladius of the Dreaming Seed" (+8 dmg/+12 def/−10 health, ALL invisible on the shelf's blind sheet) and a "Shrieking Field Cart" bought over real counters → the bench placed, the Gladius STUDIED (weapon eye 1, the card now reading the exact record, downside included) → "The Long Account" written into the rank-S pen and drawn on the bench from ledgered TEST_GRANT_10E inputs → THE DREAMT LEDGER minted and PINNED at v2 (the two older worlds honestly reading "minted before the banks") → the COMPLETE scan reading THE DREAM: Spore-Fed, Rootbound, of the Keeping → three honest deaths on the way (one naked in 90s, one at 5,000 test health in 4 minutes — the flyer-swarm balance file grows, Wave 12) → the death that mattered: Clasp invoked on RIGHT_HAND, the DIED receipt reading KEPT BY MAGIC — "Soldier's Gladius of the Dreaming Seed, held by Clasp of Keeping. The death took everything else." → a harvest dreaming ("Mire-Cured Hardwood Log", +7 max health, lost honestly to the second death — the world kept it) → a chest pouring a double-dreamed "Bank-Honored Superior Great Helm of the Dreaming Seed [UNID]" → the field refusing the unschooled armor eye in voice, then identifying the unknown Gladius in its honest 12 seconds → SEALED: 1,564 G of dreamed haul, 78 G levy → MAGPIE jacked in, deployed, and towed GABBRO's shrieking cart away, the theft signed by her own certificate in the cart's log → a cold reload keeping every byte: the eye, the studied record, the blade, the helm.
- **Carried, honestly:** the alarm's shriek hid behind the lock branch on the played theft (fixed the same day, after the play; the signed theft itself was right) and a cart kit's identify scope read as armor (now the tool eye) — both found only by playing; the Warded lock's tow-delay is proven by bar, not play (no Warded kit on that day's shelf — the shelf will roll one); a scroll's expiry death and the scribe-written scroll are proven by bar, with the written-scroll path played only as far as the SCROLLS tab (no scribe's table stands on 3102 — paper and ink were spent on the bar's mint instead); the Mire-Cured improvised club never happened (Overgrowth grows no stones; inheritance is proven by bar through the same improvise door the field button calls); The Long Account's chain reads depth 1 because its granted inputs were purchase roots — an honestly-smelted blade would carry depth 3 and a deeper budget; station study is a click with the sitting in the feed, not yet on the bench's clock; frames are definitions still, so the bank's one mental affix can roll on nothing yet (the door D22 holds open for a later wave); the extraction channel was broken repeatedly by biters no entity scan could find (the known moved-mob shape — the seal came at the sector's far exit); balance stays loud and stays Wave 12's.
- **Gate:** test lines 52, 53, 55 and 56 pass — 52/55/56 by test and by play; 53 by test, and by play as far as one minted world shows (pin seen on the card, the dream read on the survey, the same keys rolling the same records).

### THE RAW MATERIALS LEG (D23) ✅ DONE
Done 2026-10-31; **approved by Pedro (2026-10-31)**. Bars in `tests/rawmaterials.test.ts` (91 tests; suite 456), registered before the build, against byte hashes of stored rooms, the city and the pinned packs captured from the untouched code at 1128831. D23–D26 were all answered before the leg started; nothing was asked. Pedro placed this first, ahead of the playtest fixes and Wave 11, because Wave 11's pooling pays against these same bills.

- **D24, enacted:** ✅ logs and dense stone carry `building`; pebbles stay out; bills stay by tag. A log already in a stash keeps its stored bytes and still answers: `answersTag` reads the item's tags or its definition's as they stand today, and every bill door reads through it.
- **D25, enacted, with the reading Pedro was told:** ✅ `shellBillFor(type, ownerHasABench)` is the ONE place that knows about "first". With no bench held, placed, listed, standing or rising, a WORKSHOP asks 6 `building` and nothing else; a second asks its 2 `metal` again, and a plan raising a first WORKSHOP drops the same line (`templateBill(tpl, sheet, firstBench)`). The rule reads the state of the world, not a flag: an owner who sells their only bench is owed a first one again, so the floor can never be lost. Recorded for Pedro to overrule. The builder now names the material (D13's choice, which raw made matter): a picker on the lot card and in THE WORKS, and `buildStructure(lotId, type, material)`.
- **D26, banked:** ✅ the additions live in the one bank, under the one law. Run 003 banked 56 NAMES and run 004 their EFFECTS (`affixBatches.ts`), so `AffixBank.validateBatch` judges them, D22 included. Their theme is `PROCESS`, which no biome, GLOBAL or CART pool reads, so they cannot reach a drop, chest, harvest, survey or shelf. A world pinned at v2 compiles without them and its pack hash is unchanged (`da2b84b8`, `3f842e24`); new worlds pin v4. Seven families (carpentry, smelting, weaving, glassblowing, alchemy, masonry, smithing), eight entries each across four tiers, negatives included (D19), every one with a gear half and a room half (`ROOM_ACTING_STATS`).
- **D26, the law:** ✅ `ProcessSystem`. Rank and rarity each open pools, and a pool is a superset as either rises (`openTier`). A step draws from its own stream (`${job.id}:process:…`), so the item ids and rolls that were already keyed do not move; it draws something the good does not hold yet, and if the whole pool is already on it, it works an addition deeper. Components carry onto what they make, on goods as well as gear (found while building: only gear did). A job stamps the pack it was queued under; a job from before the law mints what it always would have. Improvised work is not a process and adds nothing: the floor stays the floor. Additions change the record and the name, never the price: chain sets worth (10D), and what an addition is worth is for players to work out (D19).
- **Rooms record what they inherit:** ✅ `IRoomPiece.inherited`, `IRoomState.shellInherited`, `IRoomFloorZone.inherited` (additive; absent on everything standing). `roomProcessBonus` sums a room's shell, pieces, floors and placed furniture, capped at 40% upkeep and 30% speed, and it ACTS: charged in `resolveUpkeep`, read by the bench clock in `queueCraft`, studied or not. A shell's station inherits the shell; salvage hands a wall's additions back with its material.
- **Line 62:** ✅ all three doors file into `materialMastery`, the one ledger. STUDY: two new scopes, `material` (a good with something worked or dreamed into it; plain cargo still has no riddle) and `furniture`, plus STUDY THE ROOM at its own bench; this also closed a 10E hole, since a dreamed log could never be studied. LORE: trade notes (`ProcessSystem.tradeNote`), two trades on the alchemist's shelf keyed by the day, READ IT in Sera's study, opening tier 1 of that trade once; in a world pinned to v4 a quarter of chest fragments are a trade's notes, from a separate keyed stream. `LORE_FRAGMENTS` must never grow: a pinned chest's `rng.pick` indexes it. THE SKILL: a finished job is 20 XP on the trade's own skill (D6's use law at last, for crafting), and hands at level 2 know the common tier of their own trade, level 3 the next. Level 1 knows nothing. The room card, like every sheet, counts what is unstudied and says no number.
- **The raw look:** ✅ `rawWallKind` and `rawAtom` in `render/atoms/room.ts`. Logs are long unbroken courses; raw stone is rubble, each lump its own tone between dark joints. Both apply to shells, inner walls and floors, and to the street (`lotArt(…, facade)`, `composeHub({ facades })`), where a raw building also has no window band: its first window waits for glass. Worked materials keep their fine grain, and every older room's bytes are unchanged by bar.
- **Line 45, the audit, run and held as a bar:** ✅ `logic/economy/SourcingAudit.ts` reads the live definitions, so a material added later with no way in or out reopens the bar. It found five raw materials with no process, each now closed: grain (`recipe_straw_paper`), pebbles (`recipe_flint_glass`, which raises nothing, per D24), scrap (`recipe_scrap_ingot`), shards (`recipe_shard_glass`), titanium (`recipe_titanium_bar`, a new good, `crf_titanium_bar`, rank C RARE, which also makes the deep pools reachable by real data). Berries and amberfruit are named as used directly: eaten. The sapling is the one waiver, to Wave 11 (D11, line 36). The cold start is walked from raw through the first bench to every crafted good, and a real world scan finds every raw material growing. All new recipes are value-positive.
- **The seam for the technology web (D27), left clean and not built:** `shellBillFor`/`ownerHasBench` is where a further bench's ask plugs in; `ProcessSystem.familyOfRecipe` and `familySkill` name the trade of every recipe, which is what a tool + material edge connects to; `STATION_FUNCTION` and the facility check in `queueCraft` are untouched. No station, tool or web edge was added.
- **Older bars corrected, none lowered, because D24 and D25 changed what they measured:** `tests/rooms.test.ts` "a shell consumes its bill" now reads the first bill through `shellBillFor`, still exactly the bill, exactly once. `tests/anatomy.test.ts` "hang an iron head" no longer grants the two ingots the shell no longer eats, so its chain assertions still bind to smelted ones. `tests/anatomy.test.ts` "a full loop" names planks for its shell, because the logs and stones it keeps for masonry now answer that bill too.
- **Bars (all green, registered first):** logs and stone answer, pebbles refuse, stale tags answer; the first-bench bill and every way of holding a bench; raw house, raw workshop, the bench working, the second refusing without metal, the named material, a plan from raw; the batches lawful and D22 holding; every family in every tier with both halves; pools grow by rank and rarity as supersets; keyed draws byte-identical, ranges held and walked; every recipe adding; the chain carrying through log, plank and table; dreamed inputs riding; names, price untouched, the floor, pack stamping, older jobs; gear acting on its half only; pieces, shells, zones and benches recording; salvage returning; the room bonus summing and capped; furniture shortening the clock; walls lowering upkeep; blind cards on goods, gear and rooms; study, lore and skill each revealing exactly their share in the one ledger; golden vectors; pinned packs byte-identical; no process entry in any dream; stored rooms, mixed rooms, system templates and the city byte-identical; atoms, 5×5 blocks and coursing apart in grayscale; the audit closed; the raw loop's gold and item audit.
- **Played through the real interface, as LATHE, a fresh avatar on a fresh origin (`localhost:3104`, `world-seed-dev-3104`):** minted with 500 G → Field Axe and Rusty Pick bought over the real counter → RAW TIMBER minted, reading "DREAM PACK v4 — pinned at mint" → six logs felled and an honest death to rats at the beacon, 110 health, the world keeping logs and tools → tools rebought → one run for seven raw stones (one dreaming "Vault-Aged", the name-only entry) and two runs for eleven logs (two dreaming "Mire-Cured") → SEALED each time → lots bought on HOLDINGS → the button reading BUILD WORKSHOP (150G + 6 BUILDING) with its line about the first bench → a stone workshop and a log house queued by the wall picker, and the next lot's button at once asking 2 METAL again → both seen standing from the street, and read apart in grayscale by eye → through the door, the card reading "Dense Stone, raw, as it came out of the ground" → the bench placed and worked → logs milled through the real button: "Cut Plank of the True Grain", "Green-Cut Cut Plank", "Mire-Cured Cut Plank" → the blind card, then STUDY reading exactly the rolled record while its twin stayed blind → STUDY THE ROOM → five mills: carpentry reaching level 2, the feed saying so, the common tier open and nothing above it → a Glassblower's Notes bought, READ IT in Sera's study, the topic filed → a plank house raised for the side-by-side → "Green-Cut Joined Table of the True Grain" joined and placed, the room bonus reading +10% speed, and a 10-second mill really taking 9 seconds under a button still saying 10 → a full reload keeping every byte, GoldAudit balanced with no notes, the ledger chain verified at 42 rows → a plank WALL through the WORKS picker, carrying Seasoned in its record, taken down, and the plank back at −10% with Seasoned on it.
- **Fixed because play found them:** a name-only dream read "Vault-Aged —" with nothing after it; STUDY THE ROOM counted an addition twice when it stood in the wall and on the bench; the material pickers named a whole material after whichever item came first (now `materialLabel`); and the feed still said "the materials are spent" on a demolition, false since 10D. The first three got bars.
- **Test practices on record:** raised in-memory health (50,000) and energy (400) on the three material runs after the honest death, never written to the save; teleports to a beacon to reach it past tree lines and to break a rat chase, on every run after the first, and one on the first; 30,000 G granted THROUGH the ledger (`TEST_GRANT_RAW`), because a lot costs 5,000 G and a fresh origin holds 500.
- **Carried, honestly:**
  - **A fresh origin raises its walls from raw, but it does not yet earn its lot.** 500 G buys no lot, and a run's stone hauled about 300 G. Line 60's materials are honest; its gold was granted. That is balance, Wave 12's, and now the first thing in the way of the line.
  - **A raw log's set bonus beats a plank's on the numbers:** a mono-log house reads upkeep −13%, a mono-plank one −11% before its additions (density falls when a log is cut, and the set law reads properties). Seasoned planks close that gap and Green-Cut ones widen it. Left as the law gives it; D13's numbers are Pedro's to move.
  - **Proven by bar, not by play:** raising from a plan on raw (no scribe's table stands on 3104); a chest's trade note; a made weapon's addition and its blind sheet (LATHE made no maul); the upkeep charge; the second workshop's refusal (seen as a disabled button asking 2 METAL, not pressed); titanium's deep pools (no 50-power pick).
  - **"To everything" stops short of paper.** Plans and scrolls take paper and ink and inherit nothing from them, and a placed gear piece carries its affixes without acting on the room's numbers beyond the two room stats. A plan's bill reaches the house it raises; the drawing itself is untouched.
  - **Downside has no floor.** A room's bonus is capped above, not below, so a house of Green-Cut walls can cost more upkeep than a raw one. D19 says downside pays for upside; a floor is Pedro's call.
  - **Names show one prefix and one suffix,** as gear always has; the rest are on the card ("Mire-Cured Cut Plank" also holds Seasoned). "Green-Cut Cut Plank" reads clumsily; the bank's name stands.
  - **A station's own card** still says "Minted by a finished shell", not what it was raised from; the room's card says the walls.
  - **The sapling answers a door bill** by accident of its `wood` tag, until Wave 11 gives it its real use.
  - **Balance stays loud:** the first death was at the beacon, and the channel was broken repeatedly by rats (the known shape). Wave 12's.
- **Gate:** test lines 60, 61 and 62 pass by test and by play, within the carried items above; line 45 passes by bar, with the raw loop's audit also balanced in play.

### THE STABLE DATABASE — before the full run
Pedro, 2026-10-31: "before I do run once, we need to have a stable database (sql for now, we'll need postgres for deploy)". This is also what the 2025 brief asked for: a relational database for the hub and character loading.

**What exists:** everything goes through `VectorStore` in `src/entities/data/VectorStore.ts` (`put`, `get`, `query`, `saveContent`, `searchContent`), over RxDB and Dexie in the browser. About 25 files use it and most tests mock it, so one interface carries the whole change. The certificate, roster and private key sit outside it in `localStorage` and IndexedDB.

**Recommendation for D31:**
- **SQLite file on a small local server now**, reached through the `VectorStore` interface. Your TTRPG engine and Primordial both use libSQL with Drizzle, so that is the first choice to check.
- **Postgres for deploy:** keep the SQL portable, and run the same contract tests against Postgres (PGlite can run it in the test suite), so deploy brings no surprise.
- **Signed documents stay byte-identical:** store them as text, because their signatures are over the exact content. Add indexed columns beside them, and real tables where a query needs them, starting with ledger rows.
- **Private keys stay in the browser.** The server never holds them. A wiped browser is restored from the avatar backup, then finds its saves in the database.
- **Transactions:** a gold change and its ledger row commit together, which closes the debt in `HANDOVER.md` section 8.
- **Migration:** a one-time import of existing browser data, so BASALT, GABBRO, MAGPIE, LATHE and TENON survive.
- **Out of scope:** multiplayer, authentication and a notary. Deploy needs authentication, and this leg records that rather than building it.

- **Gate:** proposed lines 69–71.

### THE USABILITY PASS — before the full run, absorbing the playtest fixes
Built 2026-10-31 at b5cd6ea, bars registered first at 8a01403, with the character sheet added after at b924a1d (`tests/usability.test.ts`, 95 tests; suite 680). **Awaiting Pedro's approval.** The list and its state are in `PLAYTEST_LEDGER.md`.

Pedro, 2026-10-31: "take a look at the views and see if they're game like... the usability of the game, the controls, the actual hovers... we can do much better than them and are currently worse", after playing RotmG. The list is `PLAYTEST_LEDGER.md`, P1–P3 and U1–U21. Keep this quick: controls first, then hovers, then the views. The art and the voice are approved, so this changes how things are used, not how they look.

**Order of work:**
1. **Controls:** hold to fire; one interact key everywhere; firing and interacting no longer share a click; a hotbar for hands and tools, shown on the HUD (U1–U3, U5–U7).
2. **Hands on items:** one drag system for pack, stash, body slots, belt, cart and ground, with a keyboard path, and P1 and P3 fixed in it (U4, U6).
3. **Hovers:** the one card on hover everywhere, at once, placed so it does not cover the thing or move the layout, and compared with what is worn or held (U8–U11). What the knowledge law hides stays hidden in the comparison too.
4. **The views:** stash as a grid with sort and filter, and selling behind a deliberate step (U13, U14); the body as a filled figure (U15); the city filling the window (U16); a minimap (U17); recon (U18); skip the hub stop when there is one hub (U19); player's bar without developer controls (U20); HUD layout (U12, U21); P2.

**Standing laws:** colourblind coding, grayscale bars, native focus and full keyboard reach, nothing below the 12px floor.

**What was built, in the order asked:**
- **Controls:** ✅ `logic/systems/FieldInput.ts` holds the laws, pure. `fireGate` asks each frame whether a held button fires; a click is a very short hold, and melee, ranged and focus go through one door. A pointer press on the ground only ever fires. E (or Enter) acts on the nearest thing in reach through `pickInteract`, the same key the city uses, and it says above the hotbar what it would do. One answer acts at once; several open the menu by keyboard; a right-click asks a thing directly. Space fires too, at what Q holds or the way you face, so the keyboard reaches a fight. `components/Hotbar.tsx` reads hands, tools and the belt from the harness, with digits as far as digits go and nothing capped. E at the beacon channels and Esc aborts; recon has X and Enter.
- **Hands on items:** ✅ `logic/systems/ItemHands.ts` decides nothing itself: `probeMove` asks the laws the doors ask, `commitMove` walks through the doors, and a move of two doors asks first. `components/ui/hands.tsx` is the one drag and the one ghost, whose seam is solid or broken in one ink. `components/ui/ItemGrid.tsx` is pack, stash, cart bed and cache. A held item has not moved, so there is no moment in which it could be lost. New store doors: `equipSwap`, `placeInPack`, `placeInStash`, `arrangeStash`, `takeFromCache`, `placeOnCart`, `wearSlot`. P1 fixed by the diagnosis, and a press that moves nothing costs nothing.
- **Hovers:** ✅ `compareItems` reads both sides through `visibleItemStats`, so an unstudied affix on either side enters no number; a bar holds the blind comparison byte-equal to the comparison of the plain twins. `comparisonFor` finds what the piece would replace, or for a tool, the worn tool of its kind. `ItemSprite` carries the hover itself, so every item drawn anywhere answers by construction. `placeCard` never covers the thing or leaves the window. `HoverLayer` is one fixed layer, so nothing moves.
- **The views:** ✅ `StashGrid` with rows that grow and never refuse; an additive `layout` on a stash tab; a filter that reads only the name the sheet may show. `ArmedButton` for selling and discarding. A silhouette of the avatar behind the slots. The city's canvas is the window, `cityCamera` centers a city narrower than it, and past the edge is ground. `render/atoms/minimap.ts`, whose unseen cells are static keyed on nothing but where they are. `suggestStart` reads only scanned sectors. One hub skips the stop. A SYSTEM window holds backup and switch; Ctrl+Shift+D or that window turns on developer tools. P2: a heavy `Modal` ignores its backdrop, and the draft lives in its own store.

**Decided in the build, for Pedro to overrule:**
- **A click selects and a drag grabs.** The diagnosis of P3 said click grabs. I kept click for choosing a piece, because the pack's other actions (identify, stow, invoke) need a chosen piece, and made Enter the keyboard's grab.
- **Digits moved.** Hands and tools take the first digits and the belt follows: 1 right hand, 2 left, 3 tool, then pouches. They used to be pouches 1–4.
- **A tool in the hand swings as melee,** at its own `itemPower`. Selecting it does not change harvesting, which still finds the best tool you hold. A shield refuses in voice.
- **An empty cache press costs no energy.** It used to charge 2.
- **The `~` console still opens from anywhere,** though no player-facing text mentions it.

**Played through the real interface at 1280×800, as MORTISE, a fresh avatar on a fresh origin (`localhost:3106`, `world-seed-dev-3106`):** minted → the gate straight into the city, no hub stop → city full window, minimap → walked to Ironfist, E, Enter on BROWSE WEAPONS → hover on a listing: card beside it, "RIGHT HAND holds nothing." → bought a blade, bow, pouch and axe → B → blade dragged from the vault to the right hand → bow hovered: compared against the blade by sign → stash grid, a piece selected, SELL armed by one press and left alone → Z → the creator: a click on the backdrop did nothing, Escape asked, KEEP DRAFTING kept everything → minted THE GROUND TRUTH → recon full window, SCAN HERE → Space, arrows, Space: DROP HERE on threat F with a beacon → Enter → an honest death, standing still, in 45 seconds → receipt → bow worn by right-click, pouch dragged to the loadout → second drop → held fire at 4, 2 and 2 shots a second, rates kept, nothing after release, 40 energy spent by the focus → Tab: pack and body clear of the player → pack to ground by drag: one cache → pack filled: five presses of E, no new entity, no item, no energy, "The pack refuses 1" → cart kit unfolded by right-click into a real cart → E: a menu, walked by arrows, Enter → cart bed and pack grids side by side, a stone dragged to a chosen cell → a click on a grain plant fired and opened nothing → E harvested it, the prompt having said what it would do → 1 and 2 changed the hand → E at the beacon channeled, with the screen in grayscale → SEALED, the receipt reading IT SETTLED → stash sorted by value → a reload after the autosave: layout, 11 items, the worn bow and 105 G all kept → SYSTEM window, Ctrl+Shift+D.

**Frame cost against line 25's budget (16.7 ms), at 1280×800 with the pane in front:** vsync-locked at 4.2 ms with the pack open and hold to fire on. With 282 things in view, walking, firing at 8 a second and the full pack window open: median 6.2 ms, p95 9.9, p99 11.5, worst 12.7.

**Fixed because play found them:** a rotated piece lost its turn on being grabbed; the drop's Enter also pressed E in the field; the ground panel's scrollbar moved the pack window; the shop's list pushed its own card out of the window, an old fault that the hover made plain; the figure was first drawn in full and fought everything, so it became one quiet ink; the minimap covered a lot in the city, so the city's map is half the size.

**Test practices on record:** raised in-memory health (50,000, then 5,000,000) and energy on every run after the honest death; weapon tags and attack speed rewritten in memory to time melee and focus with a bow in hand; 290 cloned mobs in memory to reach 282 things in view; hostiles removed by console while the channel ran; 48 stones and a cart kit minted by console, some of which were banked at the seal, so MORTISE is not a clean avatar; teleports to a grain plant and a beacon. Hold to fire, the ghost and the keyboard walk were driven by dispatched pointer and key events; the plain drags, right-clicks and keys were real input to the page.

**Bars corrected before first green, none lowered:** the conservation fuzz was refused so often that it moved too little to meet its own floor, so half its moves now aim at a piece's real slot; the floor stayed at 200.

**Carried, honestly:**
- **`tests/grid.test.ts` still reads load.** "generates a chunk within a frame" read 18.6 ms against 16 run alone at the time of commit, with the database session's processes up. Three runs of the whole suite: one fully green at 654; one red on that bar alone (19.0 ms, 653 of 654); one red on that bar and the 60 ms world bar (63 ms). Not lowered, and this leg touched no generation. The trap in the log stands: check it on a quiet machine.
- **Proven by bar, not by play:** a belt and pouches on the hotbar; a pouch reached by a digit; two hubs; X in recon; a body-slot grab by key; the shop's sale; bench and counter hovers; cart to slot; trading places on the body.
- **Left open, in the ledger:** U15b, U20b, U22 to U26, and B1, a bag's capacity a pickup cannot use.
- **Reload loses what the last ten seconds moved,** because a hand move only schedules the existing autosave. It flushes on the tab being hidden, and at every seal and death.

**The character sheet (line 76), asked for by Pedro after the pass:** "how to access my skills and inventory in a singular place, without going through the views that shouldn't be available. A character sheet". Bars registered first at 1123dd0, build at b924a1d.
- **One key, one screen, field and city alike:** ✅ Tab or C opens `components/CharacterSheet.tsx`, over whatever you were doing, and the game goes on underneath. Name, rank, attributes with points to spend, what the hands know and every skill; the body; the pack in the field or the vault at home; this piece's actions. It sits along the lower half of the window, so in the field the player and the fight stay in view. The field's own pack window is gone: this replaced it. It has one mount per tree and one key listener.
- **The other views left the player's bar:** ✅ The bar is who you are, what you hold, CHARACTER and SYSTEM. The city leads everywhere: the Vault Keeper to the bank and ledger (and the stash's sort and sale), the Conduit to the zones screen and the mint, a lot or THE DEEDS in your own room to the holdings. Each has BACK TO THE CITY and Esc, and you come back standing where you stood. Dev mode keeps all the tabs. This closes U20b.
- **Decided in the build, for Pedro to overrule:** Tab stays the browser's on a screen of forms, where C still opens the sheet. The sheet has no sort, filter or sale: those stay at the Vault Keeper's screen and the counters, so a sale still means walking to a counter. Dropping off the tab row is a real change of habit, and it is one const away from coming back.
- **Fixed because this found them:** DISCARD at the vault did nothing (`trashItem` only knew the field), an old fault that my stash panel had kept; the feed spoke over the sheet, so it now speaks from above it; the street position reset on every keeper's screen, on record since 10B, and with the tabs gone everyone would have hit it.
- **Played at 1280×800 as MORTISE:** Tab in the city; a point spent and kept; walked with the sheet open; closed; walked to the Conduit, E, View Extraction Zones, Esc back onto the same spot; deployed; Tab in the field, the player above the sheet; an axe dragged from the pack to the tool slot; a worn piece hovered; grayscale looked at. With 270 things in view, walking, firing at 8 a second and the sheet open: median 5.7 ms, p95 8.1, p99 10.2, worst 11.7, against 16.7. **Same test practices as above,** and the keys and walks for this were dispatched by script; the drag and hovers were real input to the page.
- **One older bar re-pointed, not lowered:** the fixed-column bar for U10 now reads `CharacterSheet.tsx`, where the pack's actions moved.
- **Carried:** below about 1,100 pixels wide the row runs out of room. By bar, not play: the C key and the discard. Not exercised at all: THE DEEDS button, since MORTISE owns no room.

**What has not been read, found in Pedro's own run:** "the cart could be used unidentified... but that almost saved my greedy ass". Bars first at 3e49b54, build at d09b6cb.
- **The fix he named:** ✅ `deployCart` refuses a kit nobody has read, in voice and without saying what it is; `useProtection` and `consumeItem` the same.
- **The leaks I had built, found while checking:** ✅ the hover card named what a signal would replace and showed its rank; a refusal or a feed line said its real name when it was dragged or worn; the fitting list named it. `LoadoutSystem.shownName` is now what every moving door says, a bar runs a secret name through them all, and every signal offers the same buttons (TRY IT, IDENTIFY, ROTATE, LEAVE BEHIND).
- **A clause withdrawn, then settled by D32:** I registered a bar that an unschooled eye's refusal should hide the piece's kind; line 55's approved bar said it names its scope, so the clause came out. Pedro then answered with D32, and there is no refusal left to name anything.
- **Gear can still be worn unread:** Pedro has not ruled otherwise. A refusal on TRY IT still tells you a thing isn't wearable by being refused; that is what trying is.
- **So a found cart kit now takes a roll in the field,** or comes home and reads itself at the seal. With D32 Pedro's nearly-saving cart costs a gamble first.
- **Played:** by console on GABBRO (`localhost:3102`), a kit and a blade minted unread and in-memory, because MORTISE was Pedro's own run by then.

**D32, the field identify as a roll:** bars first at aed5d97, build at b6fe63a.
- `StudySystem.identifyChance`: 20, plus 10 if the scope is schooled, plus 15 per rank the eye stands above the piece (minus 15 per rank below), minus 5 per rarity step above common; floor 3, ceiling 95. D6: outranking by three opens it, 100. Every number is a guess until Wave 12.
- `StudySystem.identifyAsk`: 10 energy, or 15 if no eye is schooled at all, and the clock, both asked of the person's best eye for anything unread, so the price and the timer say nothing of the piece. A piece already read with something unstudied on it asks its own scope.
- `fieldIdentify` pays up front and `completeFieldIdentify` rolls, keyed by session, item and attempt, and one payment buys one roll. A miss costs the energy and the seconds: the piece stays, unread, with `identifyAttempts` counted. A hit reveals exactly what was banked.
- The eye grows either way: schooled by experience (15 on a hit, 5 on a miss), unschooled by `WebSystem.accrue`, settling at a rest under line 64's law. It is not named while the piece is unread; the Hands panel's forming list says "the eye".
- **Three approved bars rewritten on Pedro's word** (`tests/affixes.test.ts`): the scope bar now holds worse odds outside the scope in place of a refusal, the training bar holds better odds after study in place of a refusal, and the reveal bar takes as many keyed attempts as it needs. Their reveal and clock clauses are unchanged.
- **Corrected from what I told Pedro:** I said about 7 tries on 70 energy. Unschooled attempts cost 15, so 70 buys 4: about 59% on a plain F-rank piece and 11% on a rare S-rank one. Schooled at 10 energy, 7 tries on a plain F piece is about 92%.
- **Played on GABBRO (`localhost:3102`), weapon eye schooled:** a cart kit and a blade minted unread by console, health raised and hostiles removed, as test practice, and energy as it stood. The sheet read IDENTIFY · 10 energy · 12s for the kit; a click took 55 energy to 45, the feed "It may give nothing up", the button IDENTIFYING…; twelve seconds on, it hit, the card read Field Cart (Packed), and UNFOLD CART appeared. A miss, the energy refusal and the settling at a rest are by bar, not play. The Hands panel read "the eye".
- **Carried:** a schooled eye crossing a rung announces itself in the feed, which can say its kind on a miss. `energy_regen` exists on the sheet and nothing applies it, so energy is a run's whole budget; that is how it plays today, not a decision. If a signal's first roll hits, nothing else about attempts is learned, by design.

- **Gate:** lines 57–59, proposed lines 72–76, and played through the real interface, within the carried items above.

### THE PLAYTEST FIXES — absorbed into the usability pass
Three findings from Pedro's own play on 2026-10-31. All three are fixed at b5cd6ea, awaiting Pedro's approval with the pass. Lines 57–59 are proposed so that guardrail 1 is met.

- **Cache duplication:** opening a ground cache with a full pack copies its contents, one copy per press.
- **Mint-world draft loss:** a stray backdrop click or Escape discards the four-step draft.
- **Pack placement:** the player cannot move an item to a chosen cell. Add grab, a footprint ghost and a keyboard path.

### THE TECHNOLOGY WEB AND AUTO SKILL (D27) ✅ DONE
Done 2026-10-31; **approved by Pedro (2026-10-31), with its readings standing as built**. Bars in `tests/technologyweb.test.ts` (129 tests; suite 585), registered before the build, against the affix pack hashes taken from the untouched code at 840eebb. D27–D30 were decided before the leg started; nothing was asked. Lines 63–68, stated plainly: 63 a tool on a material mints a skill from that pair, the same pair always the same skill; 64 working without it accrues, and it can emerge only at a rest, on a keyed roll that replays the same; 65 a further station opens through a skill's tool + material connection, never a fixed list; 66 an NPC carries stats and skills derived from its seed, read through the same web as the player's; 67 the tag law holds; 68 nothing caps the web.

**The tag audit, run first, as Pedro asked.** 142 spellings in the source, every definition and every batch. 138 are tags; `tag1`, `tag2`, `other_tags` and `grunt|elite|boss` are placeholder text in the admin Genre Creator's prompt, not tags. Against the law it found:
- **Synonyms, three spellings of one root, retired on the record, call sites moved:** `craft`/`crafting`, `improvisation`/`improvised`, `science`/`intel`/`analysis`. Their spellings stay on the books and can never be reused. Near-synonyms kept, because each is a non-identity kind and cannot split a skill: `axe`/`chopping`, `pickaxe`/`mining`, `lore`/`document`, `caster`/`magic`, `energy`/`energy_shield`.
- **One tag with two meanings:** `masonry` was both a trade and a tag on Cut Stone Block, so it came off the block (a stored block keeps its bytes; the identity filter reads only material kinds). `glass`, `metal` and `wood` meant "is it" on a pane and "answers the bill" on sand or ore, so the registry gives each one meaning that covers both: *bears glass*. `blade` was written on every melee hit in the combat log, whatever was held, so a club read as a sword; a blow's tool is now whatever is in the hand. `defense` meant both armor and taking a blow; registered as standing up to harm, which covers both.
- **Descriptive tags that must not split a skill:** `crafted`, `heavy`, `light`, `rare`, `salvage`, `improvised`, `masterwork`, `generic`, `crit`, `one_hand`, `two_hand`, `armored`, `flying`, `chopping`, `mining`, `offense`, `rogue`, `physical`, `precision`, `energy`, `poison`; `grunt`, `elite`, `boss` as magnitude; `building`, `food`, `drink`, `consumable`, `station` as uses. All registered as not identifying, by bar.
- **Dead readers, on the record:** `helmet`, `head`, `chest`, `body`, `amulet` and `plate` are read by `ItemFactory.getDimensions` and set by no base. `meme` is read by an unused `calculateLearningRate`. Registered, and left alone.

- **The law (D28), all seven clauses as bars:** ✅ `logic/content/TagLaw.ts` is spelling and identity only; `WebBank` holds the one versioned registry of 204 tags. A tag has a kind and a one-line meaning, or the whole batch falls. Variants of case, plural, separator and word order are refused (`laser cutter`, `axes`, `cutter_laser`), a word another tag refuses cannot be registered (`timber`, `rock`, `pick`), and a retired spelling stays taken. The id reads `skill_` + the sorted tags joined by `+`, which a tag can never hold, so it reads back to exactly its tags, and {carpentry} computes to `skill_carpentry`, which is why the older tracks needed no move. A door handed an id the law cannot read refuses it (`gainSkillXp`). Rank rides beside identity: iron and titanium are one skill, and the deeper rank is kept. A later batch may rename a skill; nothing else moves. **Source bars read the code itself:** every tag literal in `src` must be registered, the law's files hold no uuid, `Math.random` or clock behind an id, and name no tool, material or verb.
- **No caps (D29):** ✅ what connects comes from each entry's own tags, and `WebBank.connections` is linear, indexed by tag. A bar adds a tool, a material, a station and a name no code has heard of, and the web grows. Another compiles 5,000 of each and all connect. `FACTOR_DOMAIN` appears nowhere; verbs hang on tools and on `verbLinks`, as content. One closed table stands in the law, marked: the eleven dead ids of the old fixed list, read only by migration.
- **The mint (line 63):** ✅ `WebSystem.mint`. **Reading of "bare hands add nothing", from E1.25, for Pedro to confirm:** the hand is the identity element, so a hand skill IS the material ({berry, flora}, Foraging), and it sits under every tool skill on that material. The lattice of tag sets replaces Primordial's divisor lattice. A tool's `works` lets it take a hand-gathered material, so a sickle on grain mints with the sickle. A bench job mints from its trade (or the station's tool the hands know) and what it consumed. `SkillDiscovery.ts` lost its table: identity is whatever the registry says identifies, and a context with nothing that identifies mints nothing. `universalSkills`, `practiceTrade` and `checkSkill` are untouched, and every older bar passes unedited.
- **The auto skill (line 64):** ✅ `player.skillProgress`, batched. Winging it costs half again in energy on a harvest and a quarter on a bench clock, said on the card and the button, and a poor attempt still teaches. **D30, enacted:** `restAndCredit` at the seal, the death and the withdrawal, called from those three doors and nowhere else; the seal's receipt reads IT SETTLED. **Reading for Pedro to overrule:** "the return to the hub" includes dying, as Primordial's faint-to-town does. The roll is keyed by who, what and how many attempts, so a failed rest cannot be re-rolled by reloading: only more work buys a new roll. Chance is the donor's: 20 plus how far past the bar, 95 at most.
- **Mastery:** ✅ named, handled, graded, attuned, at the donor's cumulative 0/60/180/420. They file into `materialMastery` and nothing else: named the name, handled the properties (`knowledgeLevel` 2, and the field card's default fell from 2 to 1 so this is real), graded what it can become (the `Becomes` row, `graded` on the record), attuned what can land on it unseen (exactly its biomes' resource pools). A trade pair opens tiers of its trade through D26's door (`ProcessSystem.revealTier`). Each rung also cuts the penalty's other side, energy and clock.
- **The web (line 65):** ✅ `nodeOf`, `placeInWeb`, `verbsOf`, `hasVerb`, all derived. **At the seam:** `shellBillFor(type, hasBench, fitting)`. D25's first bench is untouched; a further bench can be fitted as any station a connection has opened, and asks its own lines on top. The room reads `stationMinAreaOf` and `stationFunctionOf`, so a station's numbers come with its batch and bigger technology asks for bigger rooms (D8's start). A station's recipes stand only where it stands, and want a held skill carrying their verb. `room.ts` names none of them. **Loot teaches:** a STUDY sitting reads a piece back (`reverseEngineer`) and accrues toward what its `designs` imply, so a studied blade works toward {hammer, metal}, which opens the Anvil. **Credit:** a `TECH` ledger row, signed by the inventor's certificate, and a lore entry; the first keeps the claim; a higher rung is a row of its own.
- **Decided in the build, for Pedro to overrule:** **the web is the hub's and the exp is the person's**, Primordial's answer: what anyone in this hub has reached opens a station for everyone in it, the verb to work its recipes still has to be in your own hands, and a person's held skills open stations even in a hub that never met them. **A resident's job does both:** a person brought home extends the web through `WebSystem.admit`, the same door a player's emergence uses, and their exp stays on them. Wave 11 calls that door; no resident exists yet.
- **NPC sheets (line 66):** ✅ `logic/systems/NpcSheet.ts`, derived at read time and never stored, because a stored field would move the golden vectors; a generated person's bytes are unchanged, by bar. All fifteen attributes dealt by a keyed shuffle, every nature of a rank totalling the same; one skill at F and one more per rank, drawn from whatever that web can mint. A world pins `webVersion` at mint, a world from before reads version 1 forever, and a later batch cannot change a pinned person. The Escort Bond carries `bondData`, and the sheet reads back from it byte for byte: Wave 11's seam. The field card names their skills once you have spoken.
- **The batch:** ✅ `generation/packs/webBatches.ts` through `scripts/run-affix-batch.ts`, which judges a web batch or an affix batch by the same law, signed into CONTENT at hub load. Run 005 is the registry. Run 006 is the breadth: 13 tools on the shelf by their own keyed stream, one raw material on the alchemist's shelf, 11 goods, 11 stations, 12 recipes, 12 designs, and with run 005 64 connections and 106 names, all value-positive and held to line 45's audit.
- **The player sees it:** ✅ WHAT THE HANDS KNOW on the Agent tab: rung by four notches filled, forming by a broken outline, neither by hue, read in grayscale by eye. Verbs, what it opens, who was first. FORMING shows a fill and no number. It lists only what is held; nothing closed is named. The Skills tab reads names. The bench shows a refusal in words. A world card reads WEB v2.
- **Bars (all green, registered first):** the seven clauses; the audit's fixes; a stranger's content, 5,000 entries, no hidden table; the batch law, refused whole; breadth floors, every station reachable, every recipe value-positive, the audit closed; the mint at the store door by tool, hand, tool-works and bench; winging on energy and clock; no skill outside a rest; keyed, replayed, not re-rollable; rungs and each reveal, exactly, in the one ledger; nodes, links and verbs; the seam, refusal, exact bill, fitted mint, recipe gates; reverse engineering; first credit signed and kept, rung rows, lore, gold untouched, surviving reload; hub web, person's exp; NPC determinism, totals, rank, breadth, one-way door, goldens, pinned affix packs, pin, bond, admit, card; the Agent sheet's contents and what it must not carry.
- **Played through the real interface, as TENON, a fresh avatar on a fresh origin (`localhost:3105`, `world-seed-dev-3105`):** minted, the Hands panel empty → Sharp Field Axe bought at Ironfist's real counter, the new tools on the shelf → THE LONG STANDS minted, pinned at web v2 → dropped, the card reading "12 energy, 3s, winging it", no density, the menu saying 12, the feed saying so → five fellings → an honest death at 110 health, slowed under load, walking for the beacon: 248 G and the kit lost, the rest not settling → axe rebought → logs felled, nine attempts → SEALED, the receipt reading IT SETTLED: Felling, the feed "First in this hub to reach Felling", the signed `TECH` row → reload, every byte kept → Agent tab: Felling, named, can fell, opens Sawpit, first in this hub: TENON → lots bought → first bench raised from raw logs, no fitting offered, as D25 says → next lot's picker: "Fitted as Sawpit — needs 16 clear tiles", the button reading 6 BUILDING, 2 METAL, 3 WOOD → Sawpit minted, carried in, placed, E WORK → RIP FINE BOARDS in the bench window, refused: "wants hands that can hew" → fourteen more fellings at 8 energy, not 12 → the feed "Felling: handled", the card now reading Density and Hardness at 7 energy → Apprentice Blade bought and STUDIED: "Taking Apprentice Blade apart in your head", {hammer, metal} forming → Io Steelweave and Null Null talked to, the card reading "Hands: Vein-Boring" only after the first word → Io secured, the Escort Bond's sheet reading back identical → SEALED, the RUNG row signed → RIP FINE BOARDS now open: three Fine Boards, each with its own addition, blind on the card → WITHDRAW, a rest with no re-roll, the forming list unchanged → a full reload keeping all of it, GoldAudit ok with no notes, the ledger chain verified at 30 rows.
- **Fixed because play found them:** "Hammer on metal" read as a raw pair, so run 006 grew the words; a forming action with no material read "social on"; a station's refusal lived only in a hover; the Hands panel sat below the fold, now beside IDENTITY.
- **Test practices on record:** raised in-memory health (50,000) and energy (400) on every run after the honest death, never written to the save; teleports to beacons and to two NPCs; 30,000 G through the ledger (`TEST_GRANT_WEB`); 10 planks and 3 ingots minted by console with a ledger row (`TEST_GRANT_WEB_MATERIALS`), for the fitted bench's bill; the tool rebuy, the second fellings, the blade purchase, the talks and the recruit called the same store doors the buttons call, after the buttons were proven once each.
- **Bars corrected before first green, none lowered:** the "import runs migration" bar named `AvatarExport`, but a signed doc cannot be rewritten there; it now holds the import to reloading through the boot's door, which is what carries it. A gold bar named an API that does not exist; it now runs `GoldAudit.run()`. A chunk scan was missing its context argument. A mock's query returned docs with no id. **No older test file was edited.**
- **Carried, honestly:**
  - **`tests/grid.test.ts` "generates a chunk within a frame" fails under full-suite load: 17.6–19.5 ms worst case against 16 (the median is near 0.3 ms against 4).** Run three times on the untouched 840eebb it fails the same way, 17.6–18.7 ms, with ten node processes up, so this leg did not move it. Run alone with the same ten processes up, the file passes on both commits: worst case 12.5–15.7 ms here, 13.5–13.9 ms on 840eebb. The log called this a fraction of a millisecond; it is now two. Not lowered. Check it on a quiet machine.
  - **Proven by bar, not by play:** a reverse-engineered skill actually emerging and opening its station (the sitting was played, and {hammer, metal} stayed forming); graded and attuned; a real old save's migration (TENON is new); the hub's web opening for a second avatar; a sickle on grain; `WebSystem.admit`; a known hand's clock discount (the button read it).
  - **Winging it has a price at the harvest and the bench only.** Combat and talk accrue and pay nothing, and a held combat skill changes no number yet. Wave 12's balance, and D6 still owes it.
  - **Some connections have no door.** An awl on paper or shears on cloth can be named and can open things, but nothing yet lets a hand tool work a crafted good outside a station's own recipe. They are reachable by NPCs and by design. Nothing is capped; the door is simply not built.
  - **A batch's raw material reaches play by a shelf, not by the world.** Spawn tables stay outside batches, because the golden vectors pin them. A batch can sell a material with no code; it cannot grow one on the ground.
  - **Stations share the generic item art,** so a Sawpit reads by its card and footprint, not its silhouette: the old open item, now with eleven more of them.
  - **The hub's web lives in the hub doc, unsigned;** the credit is what is signed, by the inventor. Two people on one device each sign their own firsts.
  - **The admin Genre Creator's tags do not pass the registry.** It is run-time LLM work under Mantine, and nothing it makes reaches the web today. When it does, it goes through `WebBank`.
  - **Every number here is the donor's or a guess:** 1.5 and 1.25 for winging, the rung discounts, the DC. A fresh F-rank still dies on the way to the beacon. Wave 12's.
  - **`STATION_MIN_AREA` still holds the four old stations.** D8's "as the hub's technology accrues" is half done: bigger technology asks for bigger rooms, but lots still do not grow with the hub.
- **Gate:** lines 63–68 pass by test, and by play within the carried items above.

**The brief this leg was built from, kept as the record.** Pedro's word on 2026-10-31: without it, the NPCs add little to nothing. The same day: this was already built in another project, so find it and build that version here before continuing, so NPCs can have stat sheets and skills. It now runs ahead of the playtest fixes.

**Where it was built.** The working version is in `D:\primordial`, in the TypeScript under `legacy/engine/cube/`, with tests in `legacy/engine/__tests__/`. Reimplement the pattern inside our contract (guardrail 2). "Auto skill" appears nowhere under that name, so the mapping below is a reading, for Pedro to confirm:

| What it does | Source | Use here |
|---|---|---|
| **The mint law:** a skill is the tool plus the object it worked; bare hands add nothing | `EPITAXY.md` (E1.25), `crates/patch/src/lib.rs` (`species_table`) | This is D25's "tool + material connected" |
| **Auto skill:** working without a skill accrues attempts per would-be skill, and at a rest it can emerge, on a keyed roll | `skill-emergence.ts`, `skill-discovery.ts` | Replaces the instant, fixed table in `SkillDiscovery.ts` |
| **Mastery rungs:** named, handled, graded, attuned, each revealing more of the material | `skill-mastery.ts`, `crates/skill` | Fits D26's reveal law |
| **The web:** a skill is a node with verbs, tool, bench, parent, children and siblings; edges come from structure, and loot teaches crafting by reverse engineering | `craft-web.ts`, `web.ts` | The connections that open further stations |
| **Verbs open things:** a station or building gates on a verb a held skill grants, never on a fixed list | `hub-governor-loop.ts` (`hasVerb`, `requiresVerb`, `elicitWeb`, `FACTOR_DOMAIN`) | Plugs into `shellBillFor` |
| **NPC sheets and skills:** stats dealt from a seed; a worker holds skills as exp; a delivered person joins with their own skills, which enter the hub's web | `character-stats.ts`, `hub-governor-loop.ts` (`Worker`, `admitSkilledFamily`), `npc-persona.ts`, `skill-match.ts` | `INpcSheet` gains stats and skills; Wave 11 places them |
| **Who found it first:** a tech or mastery is credited to its inventor, per hub | `tech-lore.ts` | A signed ledger row, and lore |

**The other version.** `D:\-ttrpg-engine\engine\technology-web.ts`, with `mf-study-tech.ts`, `mm-technology-web.ts`, `study.ts`, `craftsman.ts` and `docs/to-be implemented/technology-web-mm.md`, is the first concept: tech per purpose on a fixed tier ladder, with slots, dependencies, study checks and hints to NPC craftsmen. Its seed catalog holds only fishing and mining, and Primordial later ruled out hardcoded professions and tech. Worth borrowing from it: study queue timing, and hints reaching craftsmen.

**THE TAG LAW (D28).** A tag set must be as unambiguous as a prime signature. This is law for skills, tools, materials, verbs and every batch that adds to them:

1. **One registry.** Every tag used by anything lives in one versioned registry, with its kind (tool, material, action, trade and so on) and a one-line meaning. A tag not in the registry is refused, and the whole batch or definition set falls with it.
2. **One meaning.** A tag has one meaning, forever, under one normalized spelling. A batch cannot register a duplicate or a variant of an existing tag (case, plural, separators). A tag is retired, never reused for something new.
3. **Identity is the canonical set.** A skill's id is computed only from its normalized, sorted, deduplicated identity tags. Same set, same id, on every machine, in any order of arrival.
4. **No throwaway identity.** No identity ever comes from a uuid, a random value, the clock, a counter, insertion order or a display name.
5. **Only identity tags identify.** Each kind states whether it counts toward identity. Magnitude and description (rank, rarity, `heavy`, `crafted`, `rare`) never split a skill; rank rides beside the identity, as it does in Primordial.
6. **The word is not the identity.** Names attach to the id, so naming or renaming a skill changes nothing about what it is.
7. **Bars enforce it.** Every tag in every definition and batch is registered; order and duplicates never change an id; a variant spelling is refused; no skill id comes from a throwaway source; existing `universalSkills` saves migrate without loss.

**NO CAPS (D29).** Nothing limits tools, materials, tags, skills, verbs or edges. Primordial's floor stopped near 10 skills because of a tiny hardcoded table (`FACTOR_DOMAIN`), and that shape does not come here: what connects to what is derived from tags and data, and new connections arrive as content. A bar adds a new tool, material and batch with no code change and sees the web grow. LLM batches are the breadth, under D20's batch law. D20 keeps them at dev time for now, so a run-time call stays out until Pedro changes that.

**REST (D30).** Skills emerge at the sealed session and the return to the hub.

**What the game has today:**
- `SkillDiscovery.ts` is a short fixed table over action tags, ignoring the tool, and `processAction` grants the skill at once. Primordial's skill discovery names this file as its origin.
- `universalSkills` and `practiceTrade` grow by use, and `checkSkill` holds D6's auto-success. Keep these.
- `INpcSheet` holds name, temperament, objective, want, disposition and attempts: no stats and no skills.

**Other hooks:**
- D8 promises that higher-technology workstations need bigger rooms as the hub's technology accrues, and that lots grow as the hub grows. `STATION_MIN_AREA` in `src/entities/hub/room.ts` holds fixed numbers with no technology behind them.
- `IHubState` in `src/entities/hub/types.ts` sketches hub tier, cycles, expansion and districts. Nothing imports it.
- `techLevel` in `src/entities/generation/ContentPipeline.ts` describes a genre for the admin tool, not a hub.
- Every city lot is one size class, which is why line 43 cannot be played. Lots growing with the hub could settle that here.

**Also in Primordial:** `crates/tech/src/lib.rs`, a hub's tech rooted in its land. It keeps one level per extraction vertical, derives starting tech from geography, and advances a domain by working it. Its `HubSimState` keeps the web on the hub and the exp on each person.

**Its core, from Pedro's D25 (2026-10-31):** after the first bench, the next stations are tool + material connected. That connection is the web, and it is why the web comes before the NPCs.

**The seam the raw materials leg left:** `shellBillFor` and `ownerHasBench` in `src/entities/hub/room.ts` are the one place that knows about "first", and what a further bench asks plugs in there. `ProcessSystem.familyOfRecipe` and `familySkill` name each recipe's trade, which is what an edge connects to. Trade skills now grow by use (`practiceTrade`), so a web can read them.

**To ask at the start, if the build needs them:**
- Is the web the hub's, a player's, or both? Primordial's answer is the web on the hub and the exp on each person.
- Does a resident's job extend the web, work inside it, or both? Primordial's workers do both.

### WAVE 11 — Bringing the Nexi Home
What comes back through the Nexus populates the hub. The hooks exist as dead ends:

- **11.1 People:** `Escort Bond` is an item worth 200G today, and its text already says it is worth more than gold. Redeeming one places a resident. Their type comes from the sheet already rolled in the world (temperament, objective, want), so the person you rescued is recognisably that person. A job gives a real effect, such as faster crafting or a tended shop. D10.
- **11.2 Farms:** D11. `res_tree_sapling` and `IFarmPlot` exist, but nothing can be planted. Plant what you harvested. Growth uses the Workshop's accumulate-and-resolve timer, so nothing runs while you are away. A farm is drawn by the same generator.
- **11.3 Materials:** stored and displayed in rooms by their real grain, with their history kept. This is where the material-knowledge levels start to pay off.
- **11.4 The city fills up:** residents are visible in the hub, using the walk from 8B.
- **Also owed here:** D8's NPC pooling against a template's bill.
- **Bars:** the gold audit still balances after a full cycle of rescue, planting, selling and upkeep; farming mints items and never gold; growth depends only on time and is the same on every machine; a resident can never be duplicated from one Bond.
- **Gate:** test lines 35–38.

### WAVE 11B — The Materials Pass (ABSORBED)
Absorbed 2026-10-31 into Pedro's itemization program: 11B.1's sourcing audit and the recipe-graph review moved to 10E's population work and 10D.5; 11B.2's demolish salvage, 11B.3's property bonuses and prices (with the mono-material house numbers), and 11B.4's one-quality law moved to 10D; 11B.5's full-loop audit became 10D's gold-AND-item audit (line 54). Farm renewability stays with Wave 11. D6's crafting half landed in 10E (components carrying affixes, S+ naming); items raising skills remain unbuilt. Line 46 was delivered by 10D.

**D23 against the code (checked against the definitions, 2026-10-31; closed by the raw materials leg, kept as the record of what it found).** Three things stood between the code and the rule:
- **Raw materials cannot raise a building.** Every shell bill and the WALL and STAIR bills ask for the `building` tag, and only crafted goods carry it (plank, ingot, glass, stone block). Every recipe for those goods needs a WORKSHOP, and a WORKSHOP's shell needs six of them, so a fresh origin can raise no shell at all. The other bill lines already take raw materials: a log answers `wood`, ore answers `metal`, sand and shards answer `glass`. Bills go by tag, so `building` is the one line in the way.
- **The first bench has no raw path.** Stations come from WORKSHOP recipes that take crafted goods, or from a finished shell. Only gear has a no-bench route (`GEAR_RECIPES` with `requiredFacility: null`). D25: the first bench is raised from raw materials, and later ones come through the technology web.
- **Processing adds nothing of its own.** A transformation carries its inputs' affixes forward, and depth raises price and gear power, but no step adds a bonus, affix or suffix. Room pieces record only material and quality, so affixes do not reach buildings at all. A placed station's affixes have not been shown to change what it does.

**Line 45 was not closed, until the raw materials leg ran the audit and made it a bar (`SourcingAudit`).** The sourceability audit moved to 10E had never run. Beyond D23's points above, the data showed:
- **Raw materials no recipe consumes:** grain, berry, amberfruit, sapling, pebbles, titanium, scrap and glass shards. Some have another use: titanium and scrap answer `metal` bills, shards answer `glass` bills, the sapling waits for Wave 11's farms, and some are eaten. Each still needs checking against the line.
- **Crafted goods no recipe consumes:** glass, paper and stone block. All three are used elsewhere, by bills or the scribe's table, so this is not a fault by itself.

### WAVE 12 — The Second True Test
Wave 7 ran with limits, and Wave 8 was checked with raised health and teleports. This one is the honest version: a new identity, normal health, one sitting, no script help. It is also where balance finally gets played: enemy density, run length, gold, and how long the Tempered Pick really takes to earn. Update `HANDOVER.md`.

- **Gate:** test lines 39–40.

### New test lines

Guardrail 1 still holds: nothing gets built without a line here.

21. The player stands, walks and stops cleanly in the field and the city
22. Each creature faces its way and moves by its own behavior: a Turret holds, a swarm surrounds
23. No enemy crosses water or rock
24. Hits, deaths and enemy health can be read in grayscale
25. 300 animated things stay inside the frame budget in the real game
26. A new identity picks an archetype, sees its real avatar, leaves, and returns through character select
27. Every option on every screen does something, or is not there
28. No emoji remain; items show their real art at real footprints
29. The inspect card works everywhere, by mouse and by keyboard
30. Kills count, a level-up is seen, and what it gives is real
31. The seal and the `DIED` receipt exist, and the ledger can be read
32. You walk through the door of your own house and back, and the room is the same after a reload
33. You craft at a bench in your Workshop and serve from a counter in your shop
34. You place something in a room, reload, and it is still there, signed
35. A rescued person becomes a resident with a job, recognisably the same person
36. You plant something you harvested, leave, come back, and harvest it
37. Materials are stored and shown by their real grain, with their history
38. The gold audit balances after a full cycle of all of the above
39. A new identity plays the whole loop in one sitting, at normal health, with no script help
40. Everything from 39 survives a reload and a backup restored on a fresh profile
41. A template is designed at a scribe's table (D12), minted as a signed item, and sold and bought like any other
42. A bought template raises a house under construction; materials are chosen per element, consumed once, and the finished room matches the template exactly
43. A template refuses a lot that does not meet its size needs, in voice, with the numbers
44. The architect's name survives: author provenance reads on the template and on the standing house, after copying and resale
45. Every gameplay material can be sourced, refined and consumed, and the gold audit balances over the full loop
46. Material choice changes the thing built: properties reach bonuses and prices
47. Every slot on the body holds what it should and refuses what it should not, in voice, requirements included
48. Equipped gear weighs nothing against the carry limit; bags, pouches and the belt hold and stack exactly what their rules say
49. A cart is loaded, towed at a cost, left, and recovered; nothing in it is ever lost or duplicated, even across a death
50. An item knows what it is made of: its atoms and its chain, from stone-and-stick to the long route, and the chain sets its worth
51. No two items are ever exactly the same, and the first keeps its claim
52. Affix banks grow by themed batches; an unstudied affix shows nothing on equip, and study reveals exactly what was banked
53. A world populates from the banks during recon, deterministically for its seed and pinned pack version, and no later batch changes it
54. The gold and item audit balances across the whole itemization economy
55. Identify is a skill: scoped by item type, trained at a workstation or by trying, usable in the field on a keyed roll paid in energy (D32), always timed, faster with skill
56. Protection is an item: a death keeps exactly the slots the magic named, nothing more, and the receipt shows it

For D23, registered as bars in `tests/rawmaterials.test.ts`, approved with the leg:

60. A fresh origin raises a house and its first bench from raw logs and stone alone
61. Each transformation step adds something the raw material lacks, drawn deterministically from pools that grow with rarity and rank, with ranges, on buildings and furniture as on gear
62. What a step added stays unknown until study, lore or the skill itself reveals it

For the technology web and auto skill, registered as bars in `tests/technologyweb.test.ts`, approved with the leg:

63. Working with a tool on a material mints a skill from that pair, and the same pair always mints the same skill
64. Working without the skill accrues toward it, and it can emerge only at a rest, on a keyed roll that replays the same
65. A further station opens through a skill's tool + material connection, not through a fixed list
66. An NPC carries a stat sheet and skills derived from its seed, read through the same web as the player's
67. The tag law holds: every tag is registered with one meaning, and a skill's identity is its canonical tag set and nothing else
68. Nothing caps the web: new tools, materials and batches grow it with no code change

Proposed for the stable database, not yet agreed:

69. Saves live in the SQL database: clearing browser storage and restoring the avatar backup brings everything back
70. The same store contract passes on the SQLite file and on Postgres
71. A gold change and its ledger row commit together or not at all, across a killed process

Proposed for the usability pass, registered as bars in `tests/usability.test.ts`, awaiting Pedro's approval with the leg:

72. Holding the button keeps firing at the weapon's own rate; one key interacts everywhere; firing never opens a menu
73. Every item anywhere shows its card on hover at once, compared with what is worn or held, without moving the layout
74. Items drag between every grid and slot with the same hands, by mouse and by keyboard, and no sequence loses or duplicates one
75. Hands and tools are on a hotbar the HUD shows, and the field and city have a minimap
76. One key opens one character sheet, in the field and the city alike: the body, what you carry, attributes and skills together, through no other view

Proposed for the playtest fixes, now part of the usability pass, registered in the same file, awaiting the same approval:

57. Opening a cache with a full pack creates no new entity and no new item, however often it is tried; a partial pickup leaves the rest only in the original cache
58. A stray click or Escape cannot silently discard a mint-world draft
59. A pack item can be moved to a chosen cell by mouse and by keyboard, and no grab, rotate or place sequence ever loses or duplicates it

---

## 4. GUARDRAILS (anti-sidetrack clauses)

1. **The test list is the scope.** A feature with no test line number attached does not get
   built. Auction house, 3D renderer, multiplayer netcode, AI dialogue: all noted in the
   handover's "next worlds" section, none built now.
2. **Donors give patterns, not pull requests.** We never port donor code wholesale; we
   reimplement the pattern inside our contract (types.ts) and our stack (TS/RxDB, with the
   Wave 9 kit for screens).
3. **The vision is read-only.** Certs, hubs, F–SSS, extraction, interdependence, avatar
   ownership — if a wave's design conflicts with the agent.md prime directive, the wave
   design is wrong, not the directive.
4. **Gates are serial.** Jumping ahead (building tetris before persistence) recreates
   today's problem: logic without systems. The order is the plan.
5. **Determinism is a one-way door.** After W1.3 lands, any `Math.random` in a gameplay
   path is a bug by definition.

---

## 5. WAVE → TEST LINE MATRIX

| Wave | Delivers test lines | Depends on |
|---|---|---|
| 1 Truth & Persistence | 2, 13, 14 | (done: 1, 3, 5 from current sprint) |
| 2 World Is a Place | 6, 7, 8, 9, 10, 12, 20 | 1 (journal, seeded RNG) |
| 3 Body Is Real | 11 | 1 (journal records drops) |
| 4 Stats Mean Something | 18 | 1, 3 (equipment lives in grid) |
| 5 Society | 4, 15, 16, 17 | 1 (ledger), 2 (materials) |
| 6 Sovereignty | 19, 20 | 1, 2 (determinism + signatures) |
| 7 True Test + Handover | all 20, handover doc | everything |

Waves from 8 onward, with status as recorded in each wave's gate:

| Wave | Delivers test lines | Status |
|---|---|---|
| 8 One Grid | none (bars in `tests/grid.test.ts`) | Done |
| 8B Motion | 21–25 | Passed; line 25 was measured in Wave 9 |
| 9 Interface | 26–31 | Passed |
| 10 Inside the Houses | 32–34 | Passed |
| 10B The Architect | 41–44 | Passed; 43's refusal is by test, since every city lot is one size class |
| 10C The Load-Out | 47–49, contract half of 56 | Passed |
| 10D Anatomy of Items | 46, 50, 51, 54 | Passed; 46's set-bonus numbers are by test, not seen in play |
| 10E Affix Bank | 52, 53, 55, 56 | Passed; 53 was shown on one minted world |
| Technology web and auto skill (D27) | 63–68 | Passed, by test and by play within its carried items; approved |
| Stable database | 69–71 (proposed) | Not started; before the full run |
| Usability pass, with the playtest fixes | 57–59, 72–76 (proposed) | Built, by test and by play within its carried items; awaiting approval |
| Raw materials leg (D23) | 60–62, 45 | Passed, by test and by play within its carried items; approved |
| 11 Bringing the Nexi Home | 35–38 | Not started |
| 12 The Second True Test | 39–40 | Not started |
