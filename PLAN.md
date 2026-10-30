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
 4. [ ] Buy a tool (axe or pick) → gold actually deducted, item in stash
 5. [ ] Deploy → Drone Recon → scan sectors → pick drop zone → confirm
 6. [ ] Walk the world: terrain matters (slow ground, blocked tiles, biome texture)
 7. [ ] Harvest flora with the right tool (wrong tool refused)
 8. [ ] Mine a mineral node (vein depletes)
 9. [ ] Find a ruin → fight the garrison → open the chest → read the lore note
10. [ ] Meet an NPC → social interaction → convince them → they become extractable
11. [ ] Inventory fills: tetris placement forced, weight slows you down,
        something must be left behind (the decision IS the game)
12. [ ] Reach an extraction beacon → channel timer → extraction tax applied
13. [x] Loot banked, XP applied, deed (if dropped) in stash — all SIGNED
14. [x] Reload browser → everything from 13 is still there, signatures verify
15. [ ] Redeem deed → own a lot → build a workshop
16. [ ] Refine raw logs → planks at the workshop (recipe consumes, produces)
17. [ ] List planks in a shop → another identity could buy them
18. [ ] Die on a second run → death penalty from the WORLD CERT rules applies
        (inventory lost, not banked)
19. [ ] Export avatar (cert + encrypted key + signed player doc) → import in a
        fresh browser profile → same character, provably the same
20. [ ] Same world seed on two clients → identical map, chunk for chunk
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

### WAVE 2 — The World Is a Place (finish the extraction battle JSON)
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

### WAVE 3 — The Body Is Real (weight + inventory tetris)
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

### WAVE 4 — Stats Mean Something (combat integration)
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

### WAVE 5 — Society (the hub economy loop)
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

### WAVE 6 — Sovereignty (own your avatar, the full 9 yards)
- **W6.1 Avatar export/import.** Content-addressed export file (donor: `.seed` format —
  magic, version, digest): cert + passphrase-encrypted private key + signed player doc +
  ledger tail. Import into a clean profile reconstructs the identity; signatures prove it.
- **W6.2 Item provenance.** Mint signature at creation (crafter or world+session), transfer
  signatures on trade. `history` chain verifiable end to end. An item's story is its value.
- **W6.3 World portability.** A world cert + seed fully determines the map (guaranteed by
  W1.3 + W2.6). Export/import world certs; visiting a world records a visit row against
  its stats (creator revenue share becomes payable).
- **Gate:** test lines **19, 20**.

### WAVE 7 — The True Test + Design Handover
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
