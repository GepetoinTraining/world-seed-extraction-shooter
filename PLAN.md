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

**Order:** commit Wave 8 → 8B Motion → 9 Interface → 10 Inside the Houses → 11 Bringing the Nexi Home → 12 The Second True Test.

**Why this order:**
- Motion comes first because it changes the sprites the interface will show.
- The interface comes before the interiors because placing things in a room needs menus, cards and the pack.
- People and farms need rooms to live in.
- The gates stay serial. The one safe exception: the interior generator's prototype in 10.1 touches no shared files, so it could run alongside Wave 9.

**Decisions.** Each has a recommendation, and each changes what gets built. Ask at the start of the leg named.

| # | Leg | Decision | Recommendation |
|---|---|---|---|
| D1 | 8B | The camera rule | Anything with a height stands upright and shows its front; only flat ground is seen from above. The tree gets a trunk and a crown to match |
| D2 | 8B | How many walk frames | Prototype 2 and 4 side by side and choose by eye. The brief says "a few stepped frames, never smooth" |
| D3 | 8B | Do trees block? | The trunk blocks and you walk under the crown. That gives forests real depth for little code |
| D4 | 9 | Screens as DOM or canvas | DOM dressed in atom-built frames: text, keyboard use and tests stay easy. Only the world is canvas |
| D5 | 9 | One avatar per device, or character select | Select. Keys are already stored per identity and only the certificate has a single slot. Each avatar stays a complete, separate owner |
| D6 | 9 | What a level gives | Skills keep growing by use. Kills feed your rank F to SSS, and each rank-up grants `attributePoints`. The rank is the status mark |
| D7 | 9 | How much frame around the game | Very little. The city is the navigation, and a thin bar holds gold, identity and the console |
| D8 | 10 | Generated rooms or player-built | A generated shell with player-filled slots: stable and signed, but still yours |
| D9 | 10 | Lots only, or every building | Lots first. The generator then makes the tavern and the bank cheap to add |
| D10 | 11 | Do residents cost gold? | Yes, through higher upkeep, which already goes to the hub's treasury. No new money path |
| D11 | 11 | Is a farm a new lot type? | Yes, a `FARM` structure alongside `WORKSHOP`, `VENDOR` and `HOUSE` |

### WAVE 8B — Motion and Sprites
Start from `BUILDERS_LOG.md`.

**Builds on:** a working minimum: a two-frame walk and four facings for the player, enemies that notice and chase, shots and swings, felling stages, and rippling water and flickering lamps in the city. The job is to deepen it and keep the approved look.

- **8B.1 Atom grid:** decide whether motion snaps to the 2px grid. Sprites move in 1px steps today, and that may matter more to the look than any new frame.
- **8B.2 The player:** a standing frame (it freezes mid-step today), the chosen walk cycle, and the same walk in the city.
- **8B.3 Creatures:** facings and frames from each body plan, so a new creature still needs no new art.
- **8B.4 Behavior:** enemies respect terrain and use their definition's `behavior`, which is never read today, so a Turret walks like a rat.
- **8B.5 Feedback:** hit and death on the `HIT`, `KILL` and `PLAYER_DAMAGE` events that are already emitted. Enemy health. Readable in grayscale.
- **8B.6 Sprite pass:** portraits first, then rank marks, water, the sapling, and the tree under D1 and D3.
- **Bars:** every frame still passes the threat-vs-resource and exit bars; no enemy ends a tick on a blocked tile in a long chase; 300 animated things stay inside the frame budget; sprite memory stays under a stated bound; a reduced-motion mode exists.
- **Gate:** test lines 21–25.

### WAVE 9 — The Interface
**Builds on:** `itemArt`, `figure`, `portrait`, the 3×5 type, the inspect card and `hitTest`, all unused by the screens. `DESIGN_ASK.md` lists every screen and moment.

- **9.1 The kit:** panel, button, input, list, tabs, bars, tooltip and dialogue built from atoms and themed in one place. Replaces the Mantine look and about 70 scattered colors. Everything else in this wave uses it.
- **9.2 The frame:** D7. The sidebar and header shrink or go.
- **9.3 Birth and character select:** D5. Choosing an archetype shows your real avatar from your real certificate. The welcome-back screen becomes reachable. It must not reset the player to Operator, as `handleLogin` would today.
- **9.4 Pack and bank:** real item art at real footprints, no emoji anywhere, the inspect card everywhere, and one pack shared by the field and the Bank.
- **9.5 Skills and levels:** D6. **Fix a real bug first: kill XP is calculated and never applied.** Level-ups are silent today and need a moment.
- **9.6 The moments:** the seal and `DIED` receipts first, because the game is built around them. Then damage, refusals, what you harvested, the direction to the exit, lore, and the ledger viewer.
- **9.7 Dead options:** the city's dialogues offer 20 actions and only 6 are handled, some of those only logging. Each one gets built or removed. Nothing may look finished that is not.
- **Bars:** no emoji left in the UI; minimum readable text size; everything reachable by keyboard; recon readable in grayscale (it is hue only today); no dialogue option without an effect.
- **Gate:** test lines 26–31.

### WAVE 10 — Inside the Houses
**Builds on:** the grid, the hub's floors and doors, and working Workshop and Vendor logic that only exists as panels today. Clicking a lot in the city does nothing yet except log a line.

- **10.1 The generator, as a prototype first:** rooms as a pure function of lot and structure, on the same 20px tile and in the hub's warm ramp. A proof page shows every structure type at several sizes.
- **10.2 Entering:** a real door, a real transition and a way back, with your place in the city kept. Lots stop being walk-through.
- **10.3 Stations:** the bench and the shop counter move into the room and call the same store functions the panels use today. No duplicate logic.
- **10.4 Placement:** D8. Put things from your stash into slots, seen by their real grain. Every placement is a signed record with provenance.
- **10.5 Public buildings:** D9. Only if the generator has proved itself.
- **Bars:** same lot gives the same bytes; every room is fully walkable from its door; every station reachable; no placement can block the way out; a placed item is never lost or duplicated across reloads; composing stays cheap enough to cache.
- **Gate:** test lines 32–34.

### WAVE 11 — Bringing the Nexi Home
What comes back through the Nexus populates the hub. The hooks exist as dead ends:

- **11.1 People:** `Escort Bond` is an item worth 200G today, and its text already says it is worth more than gold. Redeeming one places a resident. Their type comes from the sheet already rolled in the world (temperament, objective, want), so the person you rescued is recognisably that person. A job gives a real effect, such as faster crafting or a tended shop. D10.
- **11.2 Farms:** D11. `res_tree_sapling` and `IFarmPlot` exist, but nothing can be planted. Plant what you harvested. Growth uses the Workshop's accumulate-and-resolve timer, so nothing runs while you are away. A farm is drawn by the same generator.
- **11.3 Materials:** stored and displayed in rooms by their real grain, with their history kept. This is where the material-knowledge levels start to pay off.
- **11.4 The city fills up:** residents are visible in the hub, using the walk from 8B.
- **Bars:** the gold audit still balances after a full cycle of rescue, planting, selling and upkeep; farming mints items and never gold; growth depends only on time and is the same on every machine; a resident can never be duplicated from one Bond.
- **Gate:** test lines 35–38.

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
