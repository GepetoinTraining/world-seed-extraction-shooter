# WORLD SEED // THE SYSTEMS PLAN

**Status:** Planning doc for the end-to-end true test. The code has the *logic* of a game;
this plan turns it into *systems*. The final deliverable is a design handover.

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
- Mantine only, no Tailwind. `types.ts` is THE CONTRACT. Logic in stores/systems, components render.
- The vector DB (RxDB) is the source of truth. The hub is society. No shortcuts around certs.

---

## 2. CURRENT-STATE AUDIT (what exists vs. what's real)

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

**Order:** commit Wave 8 → 8B Motion → 9 Interface → 10 Inside the Houses → 10B The Architect → 11 Bringing the Nexi Home → 11B The Materials Pass → 12 The Second True Test.

**Why this order:**
- Motion comes first because it changes the sprites the interface will show.
- The interface comes before the interiors because placing things in a room needs menus, cards and the pack.
- Templates (10B) come straight after the rooms, while the builder is hot, and BEFORE residents: Wave 11's NPC pooling then pools materials against a template's bill instead of a second one-off system — presets and templates become one contract.
- People and farms need rooms to live in; farms begin making materials renewable in the hub.
- The materials pass (11B) comes after the houses stand and the farms grow (Pedro, 2026-10-31: the full economic and transformation loops land once the house is there).
- The gates stay serial. The one safe exception: the interior generator's prototype in 10.1 touches no shared files, so it could run alongside Wave 9.

**Decisions.** Each has a recommendation, and each changes what gets built. Ask at the start of the leg named.

| # | Leg | Decision | Recommendation |
|---|---|---|---|
| D1 | 8B | The camera rule | Anything with a height stands upright and shows its front; only flat ground is seen from above. The tree gets a trunk and a crown to match |
| D2 | 8B | How many walk frames | Prototype 2 and 4 side by side and choose by eye. The brief says "a few stepped frames, never smooth". **Decided: Pedro chose 4 frames by eye (2026-10-31)** |
| D3 | 8B | Do trees block? | The trunk blocks and you walk under the crown. That gives forests real depth for little code |
| D4 | 9 | Screens as DOM or canvas | ✅ DECIDED: DOM dressed in atom-built frames. Only the world is canvas |
| D5 | 9 | One avatar per device, or character select | ✅ DECIDED: Select. Each avatar is a complete, separate owner (`AvatarRoster`) |
| D6 | 9 | What a level gives | ✅ DECIDED (Pedro, expanded): skills grow by use — usage raises the numerical base AND discovers new skills. A rank is EFFECTIVENESS against the task's difficulty: outside combat, outranking the task by 3+ ranks is an automatic success (Magic Lockpicking SS opens a simple B lock without a roll — `ProgressionSystem.checkSkill`). Kills feed the player rank F→SSS; each rank-up grants `attributePoints` (3). STILL TO BUILD (crafting waves): items can raise a skill's number or rank; components carry the prefixes/suffixes of the item they make; rank S+ crafts let the player write (or batch-LLM) the name and flavour text |
| D7 | 9 | How much frame around the game | ✅ DECIDED (Pedro): HUD style. A thin bar (38px) holds tabs, rank, gold, identity, console; the BANK's Agent tab is the player-facing stats/build/loadout screen for testing kits between runs |
| D8 | 10 | Generated rooms or player-built | ✅ DECIDED (Pedro, expanded, 2026-10-31): neither — a tile↔function BUILDER. Walls, stairs, windows and doors are the only structural pieces; everything else in a room is an item. Room types have minimum sizes, and higher-technology workstations need bigger rooms as the hub's technology accrues. Lot sizes grow as the hub grows (hubs grow — `IHubState` already says so). Housing, for players AND NPCs, is itself a workstation and the place where commerce happens (player↔player, player↔NPC): the economy lives in this layer, so construction must be the fully built system, not a sketch. NPCs do not design: they use preset blueprints, and players bring the materials (or the seeds that make those materials renewable in the hub); materials pool on the lot, and when the bill is met a construction timer runs (accumulate-and-resolve, like the Workshop). Wave 10 builds the construction core on player lots; NPC preset pooling lands with residents (Wave 11) |
| D9 | 10 | Lots only, or every building | ✅ DECIDED (Pedro, 2026-10-31): D8 dissolves the question. Everything inside a building is an item, a tool or a workstation — only walls, stairs, windows and doors are structure. A table is a workstation AND decoration; the material it is made from gives different bonuses; furniture is itemizable like the character is (portable, tradable, signed), so someone can live the slow life of being the hub's best table-maker — planting trees and building tables to sell. STILL TO BUILD (crafting waves): crafting furniture from materials with material-derived bonuses; Wave 10 ships placement, the structural pieces, and workstation items that call the existing store logic |
| D10 | 11 | Do residents cost gold? | Yes, through higher upkeep, which already goes to the hub's treasury. No new money path |
| D11 | 11 | Is a farm a new lot type? | Yes, a `FARM` structure alongside `WORKSHOP`, `VENDOR` and `HOUSE` |
| D12 | 10B | Where templates are designed | At a DRAFTING TABLE: a craftable station whose [E] opens the builder view. Designing is work done somewhere, like everything else in the hub; dev mode opens the view free for testing |
| D13 | 10B | Materials per piece, or per element | Per ELEMENT CLASS at apply time: all walls one material, all windows another, each floor zone its own. Per-piece exceptions afterwards by hand, with the Wave 10 tile-ahead builder, which stays. One choice per class keeps the apply sheet readable |
| D14 | 10B | Is a template consumed by use? | No. The original is a keepable, tradable item; COPIES are minted at the drafting table for a small bill, and every copy carries the author's signature in provenance forever — the architect's name travels with the house. Scarcity comes from labor and materials, never from burning drawings |
| D15 | 11B | What the materials pass must close | Every gameplay material sourceable (field or farm), refinable and consumable; stone joins the building tags with masonry recipes; demolish salvage decided; properties reach bonuses and prices (D9's deferred half); commodity `purity` stops being dead data; the gold audit balances over the whole loop |

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

### WAVE 10B — The Architect
Planned 2026-10-31, at Pedro's ask, the day Wave 10 landed. **Builds on:** Wave 10's rooms — the validators, the composer, the construction queue and the counter are all reused, none duplicated.

**The idea:** D8 said the economy lives in this layer. The template is what makes that true for building itself: it separates GEOMETRY (designed once, signed by its author, tradable as an item) from MATERIALS (chosen at build time, per element). A player designs a floor plan, mints it, and sells it; the buyer raises it on their own lot, picks what it is built from, and watches it go up. Architecture becomes a trade, like table-making.

- **10B.1 The template contract, as data first:** `ITemplate` — a structure layer (wall / door / window / stair per tile), FLOOR ZONES (tiles painted into named zones, each zone taking its own floor material at build time), and the SIZE NEEDS: the lot footprint class it requires plus named open regions with minimum areas (where the buyer's stations will want to stand). Versioned, like every rule set. `ROOM_PRESETS` fold into it — NPC blueprints are system templates, one contract and no second path. The law: a template that would compose an invalid room CANNOT BE MINTED — minting runs the same validators the builder runs (walkable from the door, nothing sealed, regions meeting their declared minimums), and refuses in voice.
- **10B.2 The builder view:** opened at a DRAFTING TABLE (D12), a new craftable station. A design surface at the room's own scale: pick a size class, paint structure and floor zones, see the live validation refuse in voice as you draw, preview in color and grayscale through `composeRoom` itself (ghost materials). Keyboard reaches everything; the cursor is a tile, not a pixel. MINT TEMPLATE names it (the lore naming rule applies) and signs it into an item carrying `templateData`, provenance MINT origin DESIGN.
- **10B.3 The trade:** a template is an item, so the existing counter, shops and stash already sell, buy and store it — nothing new to build but the CARD: a template's inspect card shows its real thumbnail (the composer at small scale), its size needs, its region minimums and its AUTHOR, read from provenance. Copies are minted at the drafting table for a small bill (D14); author's signature rides every copy and every resale.
- **10B.4 Raising a house from a template:** APPLY on a lot you own. Size needs unmet → refusal with the numbers (line 43). Then the MATERIAL SHEET: one material per element class (D13) — walls, windows, doors, each floor zone — each billed by tag, all consumed exactly once at apply. The lot enters UNDER CONSTRUCTION: a new city lot state (scaffold frame, progress readable by shape), blocking like a built lot; the owner can step inside and watch pieces fill in on the clock, shell first, then the interior, through the same `IBuildJob` queue — the outlines Wave 10 already draws, becoming solid in order. Finished means the room equals the template piece for piece.
- **10B.5 The house remembers its architect:** the inspect card on a templated building, inside or from the street, names the template and its author from the provenance chain. The ownership fantasy, extended one step: your face from your certificate, your house from someone's signed hand.
- **Bars (register before building):** same template + same material sheet → same built bytes; an invalid template cannot be minted and says why; size needs refuse with the numbers; the author's provenance survives copying and resale; the apply bill is consumed exactly once (double resolve mints and consumes nothing twice); an under-construction lot blocks exactly what it draws and its progress only moves forward; the finished room matches the template record piece for piece; the builder view passes the kit's keyboard and grayscale bars; template thumbnails are real composed atoms, not icons.
- **Gate:** test lines 41–44.

### WAVE 11 — Bringing the Nexi Home
What comes back through the Nexus populates the hub. The hooks exist as dead ends:

- **11.1 People:** `Escort Bond` is an item worth 200G today, and its text already says it is worth more than gold. Redeeming one places a resident. Their type comes from the sheet already rolled in the world (temperament, objective, want), so the person you rescued is recognisably that person. A job gives a real effect, such as faster crafting or a tended shop. D10.
- **11.2 Farms:** D11. `res_tree_sapling` and `IFarmPlot` exist, but nothing can be planted. Plant what you harvested. Growth uses the Workshop's accumulate-and-resolve timer, so nothing runs while you are away. A farm is drawn by the same generator.
- **11.3 Materials:** stored and displayed in rooms by their real grain, with their history kept. This is where the material-knowledge levels start to pay off.
- **11.4 The city fills up:** residents are visible in the hub, using the walk from 8B.
- **Bars:** the gold audit still balances after a full cycle of rescue, planting, selling and upkeep; farming mints items and never gold; growth depends only on time and is the same on every machine; a resident can never be duplicated from one Bond.
- **Gate:** test lines 35–38.

### WAVE 11B — The Materials Pass
Planned 2026-10-31 (Pedro: the full economic and transformation loops, once the house is there). **Builds on:** 10B's templates (demand for materials), 11's farms (renewable supply). Scope is D15; this is the leg where the economy closes into a circle: source → refine → build and craft → sell → upkeep → back.

- **11B.1 Every material has a source:** audit the field — every gameplay material spawns somewhere reachable, per biome, and the ones that should renew in the hub grow on farms (bring the seeds, D8). Stone finally joins the building economy: masonry tags and recipes, so a stone wall is real and reads as stone.
- **11B.2 Every transformation exists:** no refined good unreachable from raw inputs; recipe chains reviewed as one graph. The demolish-salvage decision is taken and enacted (today demolition returns nothing, on record).
- **11B.3 Properties pay:** D9's deferred half — the material a thing is made from gives it its bonuses (the table built from dense stone is not the table built from cloth), and PRICES derive from properties and provenance instead of flat values. D6's crafting half (items raising skills, components carrying affixes, S+ naming) lands here or in the crafting waves proper — decide at the leg's start.
- **11B.4 One quality system:** commodity `purity` and resource `quality` stop being parallel dead scales; one law, drawn the way the atoms already draw quality.
- **11B.5 The audit:** the gold audit balances over the FULL cycle — harvest, farm, refine, build from a template, craft, sell at a counter, pay upkeep — and materials are conserved: nothing minted from nowhere, nothing vanishing unrecorded.
- **Gate:** test lines 45–46.

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
41. A template is designed at a drafting table, minted as a signed item, and sold and bought like any other
42. A bought template raises a house under construction; materials are chosen per element, consumed once, and the finished room matches the template exactly
43. A template refuses a lot that does not meet its size needs, in voice, with the numbers
44. The architect's name survives: author provenance reads on the template and on the standing house, after copying and resale
45. Every gameplay material can be sourced, refined and consumed, and the gold audit balances over the full loop
46. Material choice changes the thing built: properties reach bonuses and prices

---

## 4. GUARDRAILS (anti-sidetrack clauses)

1. **The test list is the scope.** A feature with no test line number attached does not get
   built. Auction house, 3D renderer, multiplayer netcode, AI dialogue: all noted in the
   handover's "next worlds" section, none built now.
2. **Donors give patterns, not pull requests.** We never port donor code wholesale; we
   reimplement the pattern inside our contract (types.ts) and our stack (TS/Mantine/RxDB).
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
