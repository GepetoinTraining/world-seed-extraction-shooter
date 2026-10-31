# WORLD SEED // THE SYSTEMS PLAN

**Status:** the build plan and the record of each wave. Reconciled with the code on 2026-10-31
at commit d75f541: Waves 1 through 10E are built and the suite stands at 365 passing. Wave 10E
is approved. Next, in order: the raw materials leg (D23), the playtest fixes, the technology web
(D27), Wave 11, Wave 12. Open test lines
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

**Where it stands (2026-10-31):** 8 through 10E are built and committed. 10E is approved. Next: the raw materials leg (D23, placed first by Pedro, 2026-10-31) → the playtest fixes → the technology web (D27, required before 11 by Pedro, 2026-10-31) → 11 → 12.

**Why this order:**
- Motion comes first because it changes the sprites the interface will show.
- The interface comes before the interiors because placing things in a room needs menus, cards and the pack.
- Templates (10B) come straight after the rooms, while the builder is hot, and BEFORE residents: Wave 11's NPC pooling then pools materials against a template's bill instead of a second one-off system — presets and templates become one contract.
- People and farms need rooms to live in; farms begin making materials renewable in the hub.
- The materials pass (11B) comes after the houses stand and the farms grow (Pedro, 2026-10-31: the full economic and transformation loops land once the house is there). Superseded the same day: 11B was absorbed into 10D and 10E.
- The gates stay serial. The one safe exception: the interior generator's prototype in 10.1 touches no shared files, so it could run alongside Wave 9.

**Decisions.** Each has a recommendation, and each changes what gets built. Ask at the start of the leg named. Still open: D10 and D11. D23 through D27 are decided and not yet built.

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
| D23 | Raw materials leg | Raw materials and what processing adds | ✅ DECIDED (Pedro, restated 2026-10-31): base materials, non processed, can be used, and transformation processes add bonuses, affixes and suffixes — to buildings and furniture too, to everything. NOT BUILT: see "D23 against the code" under Wave 11B. This rule replaces the "cold-start gap" as a separate problem |
| D24 | Raw materials leg | Which raw materials raise walls and shells | ✅ DECIDED (Pedro, 2026-10-31), as recommended: logs and stone take the `building` tag, so bills stay by tag and nothing else changes. Pebbles stay out |
| D25 | Raw materials leg | How furniture starts from raw | ✅ DECIDED (Pedro, 2026-10-31): the first bench is raised from those raw materials, and "then the next ones are tool + material connected". That connection is the technology web (D27), which is why the web comes before the NPCs |
| D26 | Raw materials leg | What processing adds | ✅ DECIDED (Pedro, 2026-10-31): the additions are deterministic with ranges, and higher rarity and rank add pools. Studying, lore and the skill itself reveal them: "the actual knowledge is through play". D19's knowledge law carries this. Room pieces must start recording what they inherit, so it reaches buildings and furniture |
| D27 | Technology web | A technology web before Wave 11 | ✅ DECIDED (Pedro, 2026-10-31): "we'll need to tackle technology web as pre 11, without it the npcs add little to nothing". D25 gives its core: tool + material connected. The rest of the shape is open: ask at the leg's start |

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

### THE RAW MATERIALS LEG (D23) — next
Pedro placed this first on 2026-10-31, ahead of the playtest fixes and Wave 11, because Wave 11's pooling pays against these same bills. Scope and the current gaps are under "D23 against the code" in Wave 11B. D24–D26 are answered. Register bars first, and play it on a fresh origin.

- **Scope line:** this leg raises the first bench from raw materials and builds D26's process law. Later stations belong to the technology web, per D25.
- **One thing to settle in the build:** a WORKSHOP shell mints the first bench, and its bill also asks for 2 `metal`. D25 says logs and stone raise that bench, so that line has to give way for the first one.
- **Gate:** proposed lines 60–62 once agreed, with line 45's sourcing audit run in the same leg, since the bills it audits change here.
- **Mind the one-way door:** a raw-built house must read apart from a plank-built one in grayscale, and finished houses, stored rooms and pinned worlds must not change. Check the golden vectors after any change to definitions.

### THE PLAYTEST FIXES — after the raw materials leg
Three findings from Pedro's own play on 2026-10-31. Pedro deferred them "for now", and they run after the itemization program, which is now complete, and after D23. None is fixed. Register the bars first. Diagnoses are in `BUILDERS_LOG.md`, "Your pass". Lines 57–59 are proposed so that guardrail 1 is met.

- **Cache duplication:** opening a ground cache with a full pack copies its contents, one copy per press.
- **Mint-world draft loss:** a stray backdrop click or Escape discards the four-step draft.
- **Pack placement:** the player cannot move an item to a chosen cell. Add grab, a footprint ghost and a keyboard path.

### THE TECHNOLOGY WEB (D27) — after the playtest fixes, before Wave 11
Pedro's word on 2026-10-31: without it, the NPCs add little to nothing. It follows D23 because D26's processes are natural things for a web to connect. Guardrail 1 applies: write its test lines with Pedro at the leg's start, before anything is built.

**What exists today:** no technology system. There are only hooks:
- D8 promises that higher-technology workstations need bigger rooms as the hub's technology accrues, and that lots grow as the hub grows. `STATION_MIN_AREA` in `src/entities/hub/room.ts` holds fixed numbers with no technology behind them.
- `IHubState` in `src/entities/hub/types.ts` sketches hub tier, cycles, expansion and districts. Nothing imports it.
- `techLevel` in `src/entities/generation/ContentPipeline.ts` describes a genre for the admin tool, not a hub.
- Every city lot is one size class, which is why line 43 cannot be played. Lots growing with the hub could settle that here.

**Pattern to borrow (never the code):** `D:\primordial\crates/tech/src/lib.rs`, a hub's tech tree rooted in its land. It keeps one level per extraction vertical, derives starting tech from geography, and advances a domain by working it. Its comments name downstream branches: smithing from mining, masonry from quarrying, woodworking from lumber.

**Its core, from Pedro's D25 (2026-10-31):** after the first bench, the next stations are tool + material connected. That connection is the web, and it is why the web comes before the NPCs.

**To ask at the start:**
- Is it a hub's technology, a player's, or both?
- Which tool and material pairs open what?
- Does a resident's job extend the web, work inside it, or both?

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

**D23 against the code (checked against the definitions, 2026-10-31).** Three things stand between the code and the rule:
- **Raw materials cannot raise a building.** Every shell bill and the WALL and STAIR bills ask for the `building` tag, and only crafted goods carry it (plank, ingot, glass, stone block). Every recipe for those goods needs a WORKSHOP, and a WORKSHOP's shell needs six of them, so a fresh origin can raise no shell at all. The other bill lines already take raw materials: a log answers `wood`, ore answers `metal`, sand and shards answer `glass`. Bills go by tag, so `building` is the one line in the way.
- **The first bench has no raw path.** Stations come from WORKSHOP recipes that take crafted goods, or from a finished shell. Only gear has a no-bench route (`GEAR_RECIPES` with `requiredFacility: null`). D25: the first bench is raised from raw materials, and later ones come through the technology web.
- **Processing adds nothing of its own.** A transformation carries its inputs' affixes forward, and depth raises price and gear power, but no step adds a bonus, affix or suffix. Room pieces record only material and quality, so affixes do not reach buildings at all. A placed station's affixes have not been shown to change what it does.

**Line 45 is not closed.** The sourceability audit moved to 10E was never run and no bar holds the line. Beyond D23's points above, the data shows:
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
55. Identify is a skill: scoped by item type, trained at a workstation, usable in the field, always timed, faster with skill
56. Protection is an item: a death keeps exactly the slots the magic named, nothing more, and the receipt shows it

Proposed for D23, not yet agreed:

60. A fresh origin raises a house and its first bench from raw logs and stone alone
61. Each transformation step adds something the raw material lacks, drawn deterministically from pools that grow with rarity and rank, with ranges, on buildings and furniture as on gear
62. What a step added stays unknown until study, lore or the skill itself reveals it

Proposed for the playtest fixes, not yet agreed:

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
| 10D/10E (from 11B) | 45 | **Not closed**: see Wave 11B |
| Playtest fixes | 57–59 (proposed) | Not started |
| Technology web (D27) | To be written at its start | Not started; required before 11 |
| Raw materials leg (D23) | 60–62 (proposed), 45 | Not started; next |
| 11 Bringing the Nexi Home | 35–38 | Not started |
| 12 The Second True Test | 39–40 | Not started |
