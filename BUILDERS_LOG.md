# Builder's log

Written 2026-10-31 at the end of Wave 8, updated the same day at the end of 8B (motion), Wave 9 (the interface), Wave 10 (the interiors), Wave 10B (the Architect), Wave 10C (the Load-Out), Wave 10D (the Anatomy of Items), Wave 10E (the Affix Bank and the Dreaming — Pedro's itemization program complete), the raw materials leg (D23) and the technology web and auto skill (D27), for whoever builds next. It assumes you have seen none of the conversation. Wave 10E and the raw materials leg are approved; D27 is built and awaits Pedro's word. The next pass is **the playtest fixes**, then **Wave 11, Bringing the Nexi Home** — residents, farms, materials displayed — and everything you need to start is here.

Read this first, then `PLAN.md` section 3B, then look at the game running. `HANDOVER.md` covers the systems up to Wave 7 (signing, ledger, economy). `DESIGN_ASK.md` is the single design brief and holds the measured results.

## Where it stands

World Seed is a browser extraction game: a signed identity, generated worlds, a drop, a haul, a ledger. It is meant to feel like the bank's own terminal, running alone for a very long time — and as of Wave 9, the screens finally are that terminal.

Pedro's verdict on the look, seeing it in the real game: *"literally absurdly good"*. **The look is approved, and the interface is now made of it.** Mantine survives only under the admin Genre Creator (with its provider in `index.tsx`, `src/theme.ts`, and the unused `src/components/Layout.tsx`); every player-facing screen is built from the kit in `src/components/ui/`.

- **Tests:** 585 (`npm test`), including one recorded known failure (bar 3, in the art), and one timing bar red on this machine (see the traps). Wave 9's bars live in `tests/interface.test.ts`; Wave 10's in `tests/rooms.test.ts`; Wave 10B's in `tests/templates.test.ts`; Wave 10C's in `tests/loadout.test.ts` (41); Wave 10D's in `tests/anatomy.test.ts` (29); Wave 10E's in `tests/affixes.test.ts` (43, registered before the build); the raw materials leg's in `tests/rawmaterials.test.ts` (91, registered before the build); the web's in `tests/technologyweb.test.ts` (129, registered before the build). The chunk-generation timing bar in `tests/grid.test.ts` reads load, not code: see the traps.
- **Commits:** Waves 8 through 10E, the raw materials leg and the web are each committed per the plan's order; check `git log` and `git status` before you start. Commit at the end of your own leg.
- **Run it:** `npm run dev`, then `http://localhost:3000`. Proof pages: `/prototype/atoms/index.html`, `/prototype/atoms/hub.html` and `/prototype/atoms/room.html` (press Grayscale first). The game itself is now also a proof page: the gate, the city, the rooms behind the lot doors, the survey, the field, the receipts — and now the scribe's table and a house rising from a signed plan.

## Working with Pedro

- **Pedro approves wave by wave**, usually "Yes, Wave N". Report plainly, including what failed. Don't call something done that you have not seen working.
- **Don't side-track.** "Do not change your plan from fixing this because something else is cool." `agent.md` holds the original vision and it stays fixed.
- **Colourblind:** code by position, shape and hard seams, never by hue alone. Grayscale is a real test, not a courtesy.
- **Game terms** stay in code and design documents. In commentary to Pedro, use neutral language.
- **One design document.** `DESIGN_ASK.md` stays singular. Update it; do not start another.
- **Pedro thinks in structure and is often right.** The grid hierarchy was his call and it was better. His D6 answer redesigned ranks as *effectiveness against the task* with a 3-rank auto-success rule — half of it is built, the crafting half is recorded in the decisions table. Listen for that.

## The method that produced this look

This is why it works. Keep it.

1. **Real data.** Art comes from real seeds, definitions and certificates. No image files, no hand-placed pixels outside the families. The UI's colors come from the same ramps as the sprites (`tokens.ts` reads `buildPalette`).
2. **Register bars before the art exists**, in a test file, and never lower one to get a pass.
3. **Then look with your eyes.** Wave 9's example: recon cells drawn only in the ground ramp PASSED their numeric grayscale bar and were still unreadably dark on screen. The eye moved the structures to the matter ramp; the bar stayed. The numbers measure, the eye decides.
4. **Play it through the real interface.** The whole Wave 9 loop was played: mint → select → city → deploy → survey → drop → fight → rank-up → extract (and die) → receipts → ledger.
5. **Report failures as failures.** A bar you cannot clear becomes `it.fails` with a comment.

## The grid

Defined in `src/entities/world/grid.ts`. Atom 2px → tile 10 atoms (20px) → quadrant 16 tiles → chunk 64 tiles → sector 512 tiles. A chunk is a pure function of seed and position. Worlds on the old grid are retired.

## Where the code is

| File | What it does |
|---|---|
| `src/render/atoms/atoms.ts` | Pixel encoding, ramps, grain, creatures, resources, `itemArt`, marks, `seal`, `avatar` |
| `src/render/atoms/people.ts` | `figure`, `portrait`, `castFigure`, `castPortrait`, `WALK_PHASES` (4, Pedro's D2) |
| `src/render/atoms/world.ts` / `hub.ts` | Terrain, `entitySprite`, `composeView`; the city, signs, lots |
| `src/render/atoms/recon.ts` | NEW: survey cells — biome structure in matter ink, void static, exit lozenges |
| `src/render/atoms/items.ts` | NEW: `itemArtFor(item)` — the one rule for what an item looks like |
| `src/render/atoms/inspect.ts` | The one card, `hitTest`, `cycleTarget` — now used everywhere |
| `src/components/ui/tokens.ts` | THE theme: machine colors from the atoms' own ramps, `TERMINAL_GENRE`, `FONT_PX` (12px floor) |
| `src/components/ui/kit.tsx` + `kit.css` | Panel, Button, Input, Tabs, Bar, Chip, Row, CardView, Modal, Dialogue, SpriteView/ItemSprite/PortraitView/RankMark/SealView |
| `src/components/ui/stores.ts` | View router (`useAppView`), feed, receipt, rank moment |
| `src/components/IdentityGate.tsx` | Birth, restore, CHARACTER SELECT (D5); `ensureCharacter` kills the reset-to-Operator bug |
| `src/entities/identity/roster.ts` | `AvatarRoster`: several complete owners per device, legacy slot migrated |
| `src/components/PlayerHub.tsx` | THE BANK: Agent (stats/build/loadout, attribute spending), Skills, Stash, Ledger |
| `src/components/WorldCanvas.tsx` | Recon survey (pannable, WITHDRAW), field HUD, pack grid, inspect by hover/Q, kill rewards, both receipts |
| `src/entities/hub/HubCanvas.tsx` | The city, kit dialogue, shop/sell/repair/lore/missions windows |
| `src/entities/hub/dialogue.ts` | THE dialogue registry: every option's effect, or its honest refusal |
| `src/entities/combat/killRewards.ts` | The Wave 9.5 fix: KILL xpReward → the rank track |
| `src/entities/player/systems/ProgressionSystem.ts` | `RANK_XP_THRESHOLDS`, `rankFromXp`, `checkSkill` (D6 auto-success) |
| `src/logic/systems/Deploy.ts` | The one door into a world (Mission Control AND quick deploy) |
| `src/entities/hub/room.ts` | NEW: the room contract and pure logic — build records, walkability, refusals, bills by tag, minimum sizes, NPC presets |
| `src/render/atoms/room.ts` | NEW: `composeRoom` — a build record into atoms; walls from the material that paid their bill |
| `src/entities/hub/store.ts` | Now also: `rooms`, `buildJobs`, `resolveBuilds`, `queuePiece`, `placeItem`, `reclaimItem` — construction and placement, signed |
| `tests/interface.test.ts` | Wave 9's bars: lines 26–31, emoji, text floor, keyboard, recon grayscale, dialogue |
| `tests/rooms.test.ts` | Wave 10's bars: lines 32–34, determinism, walkability, refusals, materials-once, persistence, grayscale, lot blocking |
| `src/entities/hub/template.ts` | NEW: the template contract (`ITemplate`, sheets, bills, validators, `templateToRoom`, mono-material, `lotConstruction`) — the presets live here now as SYSTEM TEMPLATES |
| `src/logic/systems/TemplateSystem.ts` | NEW: mint and copy plans for paper and ink, signed, author riding every copy |
| `src/components/TemplateStudio.tsx` | NEW: the builder view at the scribe's table — tile cursor, live refusals, zones, grayscale preview, MINT/COPY |
| `src/components/TemplateApplyModal.tsx` | NEW: the material sheet — one material per element class, billed by tag, APPLY |
| `tests/templates.test.ts` | Wave 10B's bars: lines 41–44, determinism, mint law, paper-and-ink, bill-once, scaffold, thumbnails, mono-material |
| `types.ts` (root) | THE CONTRACT — now holds the slot tree (`BODY_SLOT_IDS`, `TOOL_SLOT_COUNT`, `EquipSlotId`), the head budget (`HEAD_BUDGET_POSITIONS`, `MAX_FRAMES`), the partition (`MENTAL_ATTRIBUTES`/`PHYSICAL_ATTRIBUTES`), `IEquipmentState`, and `IItem.requirements/pouchData/beltData/cartData` |
| `src/entities/player/systems/LoadoutSystem.ts` | NEW: the slot tree's pure law — acceptance with reasons, requirements with numbers, the head budget, the partition, the D19 blind sheet (`isAffixStudied`, real since 10E), `reconEfficiency`, `migrate`, `paperDollLayout` |
| `src/entities/world/CartSystem.ts` + `CartOverlay.ts` | NEW (D16): the cart's pure logic (grid via InventorySystem at any size, tow cost, signed theft) and its per-world persistence — the one thing in a world not derived from its seed |
| `src/components/PaperDoll.tsx` | NEW: the body on the Agent tab — keyboard-complete, refusals said in the fitting list, frames seated by position, dev-protect on P |
| `src/render/atoms/items.ts` | Now also `frameMark` — a frame as a hollow diamond, type by interior structure, never hue |
| `src/render/atoms/world.ts` | Now also the cart sprite (bed, wheels, seal plank; cargo in proof atoms when loaded) |
| `src/logic/economy/CompositionSystem.ts` | NEW (10D): THE ANATOMY — `IComposition` law: root/compose, per-item counts and labor, depth = THE POWER BUDGET, `priceOf` (atoms + labor × route rarity, monotonic in depth), `powerBudget`, versioned rules |
| `src/logic/economy/MintRegistry.ts` | NEW (10D, D18): the bank's registry of every rolled tuple; deterministic nudge ladder; first keeps its claim; replay-idempotent by item id; persisted write-behind |
| `src/logic/systems/ImprovisedCrafting.ts` | NEW (10D): the floor — `improvise()`: stone-and-stick, no bench, anywhere; refusals in voice |
| `tests/anatomy.test.ts` | Wave 10D's bars: lines 50/51/54, composition, the floor, prices, uniqueness, masonry, one quality law, salvage, set-bonus numbers, the full-loop audit |
| `src/logic/content/AffixBank.ts` | NEW (10E, D20+D22): the bank law — batches validate or refuse WHOLE, packs compile per version, sign into CONTENT, and the legacy pool is PURGED of mental-stat affixes |
| `src/entities/generation/packs/affixBatches.ts` | NEW (10E): the shipped agent runs — run 001 names (32, themed per biome + GLOBAL + CART), run 002 effects (27, negatives included); five entries still name-only |
| `src/entities/world/Dreaming.ts` | NEW (10E.3): `DreamingSystem` — biome pools, the material dream roll, the sector DREAM readout, the hub shelf's pool; active dream set at deploy from the world's PINNED pack version |
| `src/logic/systems/StudySystem.ts` | NEW (10E.2, D19): identify as a scoped trained skill — scopes, the timed clock (never free), the reveal into materialMastery (the one knowledge ledger) |
| `src/logic/systems/InsuranceSystem.ts` | NEW (10E.5, D21): charms and scrolls that name what a death keeps; `plan()` picks chosen/random slots; scrolls written at the scribe's table for paper and ink |
| `scripts/run-affix-batch.ts` | NEW (10E.4): the dev-time pipeline harness — `npx vite-node scripts/run-affix-batch.ts [candidate.json]` |
| `tests/affixes.test.ts` | Wave 10E's bars: lines 52/53/55/56, the bank law, the purge, the Dreaming, the knowledge law, insurance, cart security, D6's crafting half |
| `src/logic/systems/ProcessSystem.ts` | NEW (raw materials leg, D26): what a transformation step adds — families, pools by rank and rarity, the keyed draw, the reveal by skill and by lore, trade notes |
| `src/logic/economy/SourcingAudit.ts` | NEW (line 45): every material sourced, refined and consumed, read from the live definitions; the cold start walked; one named waiver |
| `src/entities/hub/room.ts` | Now also: `answersTag`, `shellBillFor` (with a fitting, D27), `ownerHasBench` (the one place that knows "first"), `stationMinAreaOf`, `stationFunctionOf`, `roomAdditions`, `roomProcessBonus`, `materialLabel` |
| `src/render/atoms/room.ts` | Now also: `rawWallKind`, `rawAtom` — logs by coursing, stone by rubble, worked materials byte-identical |
| `tests/rawmaterials.test.ts` | The raw materials leg's bars: lines 60/61/62/45, the one-way door against hashes taken before the build, the grayscale read |
| `src/logic/content/TagLaw.ts` | NEW (D28): spelling and identity. `skillIdOf`, `parseSkillId`, variants. Pure, and it reads no clock |
| `src/logic/content/WebBank.ts` | NEW (D27, D29): the web's batch law, the one registry, versions, `connections` (derived, linear), `mintTool`, signing |
| `src/entities/generation/packs/webBatches.ts` | NEW: run 005, the registry; run 006, tools, stations, goods, recipes, designs, words. Add a run and the web grows |
| `src/logic/systems/WebSystem.ts` | NEW (D27): the mint, the auto skill, the rungs and their reveal, nodes and links, verbs, `openStations`, reverse engineering, `admit`, `earnedSheet`, `migrate` |
| `src/logic/systems/NpcSheet.ts` | NEW (line 66): stats and skills dealt at read time from (seed, entity, pinned web); `fromBond` is Wave 11's seam |
| `src/entities/player/systems/SkillDiscovery.ts` | No table any more: a context's identity is what the registry says identifies |
| `tests/technologyweb.test.ts` | The web's bars: lines 63–68, the seven clauses, source scans of the law's own files, the one-way door |

A pixel byte is 0 for transparent, otherwise `1 + role * 5 + step`. Pure integer work over byte buffers, testable in Node.

## What the interface pass (Wave 9) built

Full detail in `PLAN.md` 3B. In short: the kit and one theme (9.1); the thin bar and the Agent/loadout screen, HUD-style per Pedro's D7 (9.2); character select with a roster of real owners, birth that ends face-to-face with your real portrait, and the login-reset bug dead (9.3); real item art at real footprints everywhere, no emoji anywhere, the inspect card answering mouse and keyboard (9.4); kill XP finally applied to a rank track with a visible rank-up moment and spendable points (9.5); the SEAL and DIED receipts, the feed, the exit bearing, the ledger viewer (9.6); every dialogue option built or removed in voice (9.7); and the survey redrawn from atoms so it reads in grayscale.

## What the interiors pass (Wave 10) built

Full detail in `PLAN.md` 3B. Pedro's D8/D9 reshaped it at the start: rooms are BUILT from a tile↔function builder, never generated — walls, stairs, windows and doors are the only structure, and everything else in a room is an item. In short: the room contract and composer with its proof page (10.1); real doors — built lots block their footprint, `[E] ENTER` walks you in, the doorway walks you out, your street position kept (10.2); construction as jobs — gold permit + material bill consumed exactly once + clock, every step signed, the shell minting its bench or counter (10.3); placement of any stash item at its real art, validated (nothing seals the way out; stations demand their minimum area), signed with provenance, surviving reloads and coming home on foreclosure (10.4); and the NPC presets as data for Wave 11's pooling (10.5). The whole loop was played: mint → buy → build on the clock → enter → place → craft at the bench → wall up → reload → same room → counter serving with the hub's cut.

**Left open, honestly:**
- A session left through recon's WITHDRAW is ABORTED and gets no receipt moment.
- The stash list in the Bank shows footprint-scaled thumbnails in rows, not a spatial grid; the spatial grid lives in the field pack. Placement went keyboard-first instead (the tile ahead), so the Bank grid question still stands for a later pass.
- Stations are told apart by card and name; they still want a silhouette family of their own.
- STAIR is typed and refused in voice — one floor until the hub grows. A HOUSE has no function hook yet. (Demolish returning no materials was closed in 10D.)
- The near-twin figures, worn-gear subtlety at 36px, and the city's motionless keepers stand as before.
- Balance is still unplayed at scale (Wave 12). A fresh F-rank still dies to the first pack of anything.
- An invented genre still gets its look from a hash; the look family still needs widening.

## What the architect pass (Wave 10B) built

Full detail in `PLAN.md` 3B. Pedro's D12/D13/D14 shaped it at the start, each bigger than the recommendation: the station is a SCRIBE'S TABLE (generalist — scrolls will be written there too), a house built fully of one material earns a recorded set bonus (numbers land in 11B), and the mint runs on PAPER AND INK (paper from planks, iron gall ink from gallpods and raw iron; the alchemist stocks the gallpod).

In short: the template contract as data (`ITemplate` — geometry, zones with promised areas, size needs; the presets folded in as SYSTEM TEMPLATES through the one `templateToRoom` path; an invalid plan cannot be minted and refuses in voice) (10B.1); the builder view at the placed scribe's table — tile cursor, keyboard-complete, live refusals, zones measured live, color/grayscale preview through composeRoom, MINT and COPY both paid in paper and ink with the ORIGINAL author riding every copy (10B.2); trade through the existing counter unchanged, with the template card (needs, pieces, zones, ARCHITECT) and thumbnails that are the composed plan itself (10B.3); `applyTemplate` — size needs refused with the numbers, the material sheet one-choice-per-class billed by tag, everything consumed exactly once, an UNDER_CONSTRUCTION lot state whose scaffold blocks exactly what it draws and whose building rises by shape as the signed job batch lands shell-first-then-pieces-in-order, finished meaning piece-for-piece equal (10B.4); and the house remembering its architect on cards from the street and inside, with the mono-material line (10B.5). The whole loop was played as BASALT: tools and gallpods bought → an honest death in the ruins → a real harvest run (logs, iron, pack-refusal caches) → sealed haul → planks/paper/ink/scribe's table milled and joined → plan drawn, minted, copied, sold and bought back over the counter → applied → the scaffold watched from the street and the pieces from inside → the finished house, its plaque, and a full reload keeping every byte.

**Left open, honestly:**
- Line 43's size refusal passes by test and shows in the sheet, but all six city lots are one 4×4 class, so it cannot be PLAYED until lots grow with the hub. The 3×3 and 6×5 classes already exist in the studio.
- The mono-material set bonus is detected and recorded. (Its numbers landed in 10D.)
- Switching app tabs (BANK/HOLDINGS) while walking the city returns you to the plaza spawn — pre-existing, now on record.
- The glass chain still needs a field trip for sand; BASALT's first apply was refused on the glass bill (honestly, in voice) and the built house is the windowless all-plank plan.

## What the load-out pass (Wave 10C) built

Full detail in `PLAN.md` 3B (Wave 10C ✅) and the settled record in `DESIGN_ASK.md`. In short: the slot tree replaced Wave 4's three buckets — fifteen body positions plus dedicated TOOL slots behind one constant, equipped items living on `IPlayer.equipment` (OFF the pack grid, which IS the weight law: the limit is the haul, not the harness), migrated in losslessly on hydrate. The head budget (D22): four positions holding gear OR a frame, three frames at most, the mind/matter partition a stat law, not a dress code (Pedro’s correction): gear has no pathway into attributes, so +int "of the Owl" gear wears fine with its mental line dead ("asleep" on the card), and `validateStatPartition` waits as 10E’s bank validator — and mental stats driving recon depth, played at BASIC vs DETAILED in one click. Requirements stamped at mint, refused with the numbers. The belt opens pouch slots; a pouch stacks only what its rule names; quick-use fires by digit key, pack unopened. The slot-protection contract (D21): marks name their magic, the death keeps exactly the marked slots, the receipt reads KEPT BY MAGIC (dev hook `__ws.protectSlot`; the charm items are 10E's). THE CART (D16): unfolds from a kit, 10×8 bed under a signed seal, tows at a cost, persists per-world in `CartOverlay` across deaths and abandonments, theft signed by the thief's own certificate, bed banked at the beacon with the kit folding home. The paper-doll on the Agent tab: keyboard-complete, refusals said in the fitting list, frames as hollow diamonds coded by shape.

**Left open, honestly:**
- The shoulder theming (per-genre shelf name) landed after the played purchase; the next shelf day shows it. Left hand and boots were proven by bar, not play (that day's shelf stocked neither).
- Legacy mental-affix gear (the Owl suffix family) still exists in stash and shops; it wears fine, and its mental line is dead (the inspect card says "asleep"). 10E purged the affix pool, so no new piece rolls; the standing pieces stay honest contraband.
- The Field Satchel's art reads muddy at the paper-doll's biggest cells (the numeric bars pass; the eye noted it).
- The cart-to-beacon tow in play used the logged teleport practice; nobody has yet made the honest long haul (Wave 12's business).
- Recon plays at depth 1 vs 2; nobody has built the mental spread for 3+.
- A towed cart waits at a chunk seam if its destination chunk is unbuilt that tick (it catches up on the next step — the known mob-chunk shape, now on wheels).

## What the anatomy pass (Wave 10D) built

Full detail in `PLAN.md` 3B (Wave 10D ✅) and the settled record in `DESIGN_ASK.md`. In short: the economy was audited FIRST (Pedro's order) and the audit found labor destroying value in six of eight chains — so prices now derive from the chain (`priceOf` = atoms + labor × route rarity, monotonic in depth; every recipe value-positive). Every item carries `composition`: its root materials with lawful origins, its step-by-step chain with labor, and its depth — THE POWER BUDGET. The floor is real and played: a Dense Stone and a Hardwood Log lash into the Stonebound Club through the field pack's IMPROVISE button, no bench, measurably the worst weapon the game can mint (IP 31 vs the shelf's floor of 40); the Iron-Headed Maul (depth 2) doubles it. D18 is enacted: `MintRegistry` claims every rolled tuple, collisions walk a deterministic nudge ladder, the first keeps its claim, shop units are per-unit deterministic mints (the `crypto.randomUUID` leak is dead). Masonry gives stone the `building` tag; quality is ONE scale (0 = no roll; `purity` retired); demolish-salvage was decided and enacted — the whole bill returns, bitten −0.10 quality per demolition, floored at −0.20, shells and permits never return. The mono-material set bonus got its numbers from the material's own properties and is actually charged (upkeep, bench speed, light). The inspect card says MADE OF / CHAIN / LABOR, or the origin in voice ("Torn back out of a wall").

**Left open, honestly:**
- A fresh origin could not raise its first WORKSHOP honestly: the shell bill asked for crafted goods only a workshop makes (the cold-start gap). Closed by the raw materials leg (D23).
- Balance is loud: flyer swarms broke five extraction channels and killed a 2,000-health test rig twice (Wave 12's business), and a mob biting from beside the player was in no loaded chunk's entity list (the known moved-mob shape, now with teeth).
- Stone and plank wall FACES are grayscale near-twins at game scale; the seams differ (stipple vs hatch). The wall family wants a bolder large-scale structure difference.
- The set-bonus numbers are charged by bar, not yet seen in play (no templated house stands on the 3102 origin).
- Crafted gear's value derives from its chain only; its quality roll moves stats, not price.
- The in-game AUDIT button replays gold; the item half of line 54 lives in the bars' store-driven multiset audit.

## What the affix pass (Wave 10E) built

Full detail in `PLAN.md` 3B (Wave 10E ✅) and the settled record in `DESIGN_ASK.md`. In short: the AFFIX BANK — batched agent runs banked as signed, versioned content packs (a NAMES run, then an EFFECTS run; a broken batch refused WHOLE; D22 a bank law: a mental affix only ever rolls on a frame, and the legacy Owl purged from every future roll); the KNOWLEDGE LAW made real (identify a scoped skill trained by STUDY sittings at the bench, usable in the field always timed, revealing exactly the banked record — negative offsets included, since downside pays for upside); the DREAMING (a world populates its drops, chests, harvests and sector readouts from its biome's bank, deterministically from (seed, pack version), the version PINNED at mint — older worlds honestly dream nothing new); the pipeline harness (`scripts/run-affix-batch.ts`); insurance as ITEMS (the Clasp, the Knot, the Scroll of the Kept Hand on a real clock; the DIED receipt reads KEPT BY MAGIC naming the charm — played with a real death); cart security grown in the same banks (Shrieking played and stolen signed; Warded's tow-delay by bar); and D6's crafting half (components carry their affixes onto what they make; rank S+ takes the maker's name — "The Long Account" was drawn and named at the bench).

**Left open, honestly:**
- Frames are definitions, not items, so the bank's one mental affix (`of the Long Vigil`) can roll on nothing yet. The door D22 holds open waits for a frame-minting wave.
- The Warded lock's tow-delay and the scroll's expiry are proven by bar, not play (no Warded kit on that day's shelf; nobody waited an hour). Station study is a click with the sitting in the feed, not yet a job on the bench's clock.
- The dreamed-material improvise (a Mire-Cured club) was never played: Overgrowth grows no stones, and the dreamed log fell to a death. Inheritance is proven by bar through the same `improvise()` door the field button calls.
- The extraction channel was broken repeatedly by biters no 200px entity scan could find (the known moved-mob shape). Three honest deaths this leg, one at 5,000 test health. Balance is Wave 12's, and it is loud.
- The hub shelf rolls on the bank's LATEST law (legacy purged pool + current GLOBAL/CART) — deliberate: worlds pin, the shelf grows. Recorded in DESIGN_ASK.

## What the raw materials pass built

Full detail in `PLAN.md` 3B (the raw materials leg) and the settled record in `DESIGN_ASK.md`. In short: logs and stone answer `building` bills, so a fresh origin raises a house and its first bench from raw (D24, D25; the first WORKSHOP's metal line gives way, and the second asks for it again). A transformation step now adds something: 56 banked entries in seven trades, in the existing NAMES and EFFECTS batches, drawn by a keyed stream from pools that grow with rank and rarity, with ranges, and kept out of every dream by their theme, so pinned worlds are byte-identical (D26). Goods carry what their components carried, walls and floors and furniture record it and act on it (upkeep, bench clock), and it stays unknown until a study sitting, a read trade note or the skill's own level reveals it, all in `materialMastery` (line 62). A raw house draws by shape, inside and from the street. Line 45's audit ran and is now a bar over the live definitions; five raw materials got processes for it.

**Left open, honestly:**
- A fresh origin raises its walls from raw but does not earn its lot: 500 G against 5,000 G. LATHE's gold was a ledgered test grant. Wave 12's balance, and now the first thing in line 60's way.
- A mono-log house reads upkeep −13% and a mono-plank one −11% before additions: the set law reads properties, and cutting a log lowers its density. Left as the law gives it, on the record for Pedro.
- By bar, not play: raising from a plan on raw, a chest's trade note, a made weapon's addition, the upkeep charge, titanium's deep pools.
- Plans and scrolls inherit nothing from their paper and ink. A room's bonus has a ceiling and no floor (D19). A station's own card does not say what it was raised from.
- The first-bench rule reads the state of the world: sell your only bench and the next WORKSHOP is your first again. Deliberate, so the floor cannot be lost; recorded for Pedro to overrule.

## What the web pass built

Full detail in `PLAN.md` 3B (the technology web and auto skill) and the settled record in `DESIGN_ASK.md`. In short: Primordial's version, on tags. A tool on a material mints a skill from that pair, the id computed from the canonical tag set and nothing else, under a seven-clause law with bars that read the code itself. Working without the skill costs more and accrues; it settles only at a seal, a death or a withdrawal, on a roll keyed by who, what and how many attempts. Rungs reveal more of the material into `materialMastery`. A skill is a node, its links come from its tags, and a further bench is fitted as whatever station a connection has opened. Loot teaches by a study sitting. The first to reach a skill or a rung signs a ledger row. An NPC's stats and skills are dealt at read time, so the golden vectors did not move; a bond reads the same sheet back. Two batches ship through the pipeline, and a bar adds 5,000 entries with no code change.

**Left open, honestly:**
- By bar, not play: a reverse-engineered skill emerging and opening its station; graded and attuned; a real old save's migration; the hub's web opening for a second avatar; `WebSystem.admit`.
- Winging it has a price at the harvest and the bench only. Combat and talk accrue and pay nothing, and a held combat skill changes no number yet.
- Some connections have no door: nothing lets a hand tool work a crafted good outside a station's recipe.
- A batch can sell a raw material with no code, but it cannot grow one on the ground: spawn tables are pinned by the golden vectors.
- Stations share generic item art. Eleven more of them now want a silhouette family.
- Lots still do not grow with the hub. `STATION_MIN_AREA` holds the four old stations; a batch's station brings its own number.
- Readings on the record for Pedro: a bare hand's skill IS the material; a death is a return to the hub; the web is the hub's, the exp is the person's; a resident both extends the web and works inside it.

## Your pass: the playtest fixes

Pedro found these in play on 2026-10-31 and deferred them, and the plan runs them after the itemization program, which is now done, after D23 and after D27, both built. Each is self-contained. Register the bar first. The test lines are proposed in `PLAN.md` (57–59). None is fixed; all three were re-checked against the code at d75f541.

1. **Cache duplication (line 57).** Opening a ground cache with a FULL pack duplicates its contents, one copy per E press, at 2 energy each. In `src/entities/player/store.ts`, the `int_open_` explicit-contents branch (:1504) hands the cache's items to `addToInventory`. The pack refuses them, so its overflow rule (:1405) mints a new `cache_ovf_*` entity holding them, correct for harvests and chests but wrong when the source is already a cache. The branch then keeps the same items in the original cache as `left`. The result is the same ids in two world entities, which can be banked as N copies with one provenance chain and sold for treasury gold. A partial pickup double-mints the refused items the same way. **Fix:** call `tryAddItems` directly in that branch, so refused items simply stay in the source cache; no overflow entity when the source is a container; feed line "The pack refuses N; they stay in the cache."
2. **Mint-world draft loss (line 58).** `src/components/WorldCreator.tsx` holds the whole four-step draft as local state inside a kit `Modal`, which closes on a backdrop click or a window-level Escape (`src/components/ui/kit.tsx`). That unmounts the creator and the draft is gone. **Fix, either half is enough and both are better:** a heavy flow does not close on the backdrop, and a dirty draft asks in voice before discarding ("The draft is unsigned. Abandon it?"); or lift the draft into a small store so reopening restores it. The Escape listener also fires from nested inputs.
3. **Pack placement (line 59).** The pack grid in `src/components/WorldCanvas.tsx` offers click-to-select with ROTATE, USE, EQUIP and LEAVE BEHIND; placement is `InventorySystem.autoPlace` only, so the player cannot choose a cell. The pure logic exists (`footprint`, `buildOccupancy`, `canPlaceAt`, `tryRotate`). **Shape:** click grabs, hover shows the footprint ghost, valid or invalid by shape and seam (solid vs broken outline), click sets down through `canPlaceAt`, R rotates while held, Escape puts it back; select, arrows and Enter as the keyboard path. Build one small reusable grid-placement hook, because the stash grid and the room cursor want the same thing later.

## Then: bringing the Nexi home (Wave 11)

**Scope, decisions (D10, D11) and bars are in `PLAN.md`** (gate lines 35–38): redeeming an `Escort Bond` places a RESIDENT whose sheet was already rolled in the world (recognisably that person), with a job that has a real effect; FARMS as a lot structure (D11) — plant what you harvested, growth on the accumulate-and-resolve clock, nothing running while away; materials stored and displayed by their real grain with history; residents visible in the city using 8B's walk. D8's deferred half lands here: NPC pooling pools player materials against a TEMPLATE's bill — `SYSTEM_TEMPLATES` and `templateBill` in `src/entities/hub/template.ts` are exactly that bill, and `applyTemplate`/the `IBuildJob` batch in the hub store is the construction path to reuse (a resident's house should rise through the same UNDER_CONSTRUCTION state, pooled instead of paid by one hand). Upkeep for residents goes through the existing treasury path (D10). 10E leaves you: the banks and the Dreaming, should residents' wants or wares draw on themed content. Bills changed under D23: raw logs and stone answer them, so pooling should pay by tag through `pickBill` and `answersTag`, and read `shellBillFor` rather than `SHELL_BILLS` for what a shell asks. D27 leaves you the person: `NpcSheet.fromBond(bond)` reads back the sheet the world rolled, skills included, and `WebSystem.admit(web, who, skills, at)` is how they extend the hub's web, the same door a player's emergence uses. Register the bars before anything exists; ask D10/D11 at the start if unanswered.

**After Wave 11:** Wave 12 (the second true test). Wave 11B was absorbed into 10D/10E, and the raw materials leg ran its last piece, line 45's sourcing audit.

## Known weak spots

**In the art:** near-twin certificates at 16 atoms; first wear bite easy to miss at 36px; recorded failure: Silica Sand's Conductivity and Rusted Plate's Hardness reach only 2 atoms (bar 3).

**In the game:** balance unplayed at the new scale; a moved enemy still belongs to its origin chunk's entity list (leashed, but the wrong shape); the three playtest findings above; a finished craft or a foreclosed lot still has no feed line or other moment on screen (the foreclosed mark exists only in the hub's art). (The walk-through lots are fixed: a built lot blocks exactly what it draws, and its door is real — Wave 10.2.)

**Not up yet, on purpose (Pedro, 2026-10-31), so not faults:** `src/entities/magic/SpellEngine.ts` is not finished, and `src/entities/world/Director.ts` depends on the full game loop. Nothing imports them yet.

**In the code:** six more modules are reached by nothing from `index.tsx`: `src/components/Layout.tsx`, `src/entities/hub/types.ts` (it sketches hub expansion, so read it before the technology web), `src/entities/identity/IdentityGenerator.ts`, `src/entities/identity/VectorStore.ts` (the live one is `src/entities/data/VectorStore.ts`), `src/entities/mob/utils/SpriteGenerator.ts` and `src/entities/player/LoreManager.ts`. Nobody has decided about these yet, so ask before removing any. `three` and the React Three Fiber packages are installed, but nothing in `src` imports them.

## Traps that cost me time

- **The browser pane throttles when hidden — twice over.** 8B lost line 25 to a backgrounded pane. Wave 9 found the deeper layer: `document.hidden` can be FALSE and rAF still runs at ~3fps with an idle main thread, because the desktop pane itself isn't displayed. Front the tab AND show the pane (and keep the window visible) before believing any frame number. Wave 10 hit it again walking the city (2 tiles in 5 seconds): `tabs_context` SAYS "the Browser pane is currently hidden" — check it before walking anywhere. The honest measure: 314 things, 4.17ms/frame, vsync-locked at 240Hz.
- **HMR resets zustand stores.** Editing a store-adjacent module mid-session rebuilds the module graph: the bar suddenly says "Unknown · 100 G". That's the template, not data loss — reload fully and the signed doc rehydrates.
- **Test characters die fast.** In-memory health/XP changes are fine for testing and never reach the save. Teleporting skips collision: you can land in a lake.
- **Driving the game from a script.** `window.__ws` exposes the stores — USE THOSE for store state: Wave 10 found that `await import('/src/entities/player/store.ts')` in the console can hand you a SECOND module instance whose setState the app never sees (gold stays stale on screen). `await import('/src/...')` is still right for pure modules (ItemFactory, definitions, Rng) and for monkey-patching. To walk, dispatch `keydown`/`keyup` on `window` and hold for over a second.
- **The console buffer keeps old errors** across reloads. Check timestamps before believing one.
- **Windows files are CRLF**; long edits are safest as a Python script that normalizes endings and asserts each target string exists.
- **RxDB freezes documents in dev.** Copy before mutating anything from the database (CombatSystem already copies mobs).
- **Generation hashes:** any change to world generation changes `GOLDEN_VECTORS` in `src/entities/world/goldens.ts`. Interface work should never touch them; a change there means something leaked.
- **Vite port:** another session's dev server may hold 3000. `.claude/launch.json` has `world-seed-dev-3100` and `world-seed-dev-3101` (`--strictPort`). The test avatar BASALT lives under origin `localhost:3101` — use 3101 to inherit it. Wave 10C found 3101 held too and the harness auto-shifted to 3102, a FRESH origin: GABBRO (Operator, framed analyst) and MAGPIE (Street Samurai, cart thief) live there now, with a world card `RECON PROOF`. `launch.json` has no 3102 entry, so to reach them run `npm run dev -- --port 3102 --strictPort`. Check which origin you actually got before expecting anyone's stash.
- **Shop listing refs drift under the pointer.** Buying from a scrolled shop list by element refs mis-clicks as stock reflows — one buy, one verify. Related, fixed in 10C: two same-type-same-rank stock batches used to share listing ids and sell the wrong row (`generateDailyStock` now tags batches).
- **Clicking field entities from a script is flaky**: the DOM hit areas don't always sit where the sprite draws. The first click proved the real menu path; after that, `InteractionEngine.getAvailableInteractions` + `performInteraction` from the console is the same function the menu button calls. Harvest outputs that don't fit the pack become ground caches at your feet (the feed says so). The grid is 8×6 (`GRID_W`, `GRID_H`) and holds sixteen 1×3 items, so a refusal at eight of them is not the grid; check the weight limit before you read a refusal as a space problem.
- **The studio canvas is CSS-scaled** in screenshots: tile = 20 CSS px × (screenshot width / viewport width). Compute tile centers from the canvas origin before clicking, or use the keyboard cursor.
- **Walking long field distances by held keys stalls on lakes** — the resolver refuses water and the straight-line walker just grinds. Wave 8's recorded practice stands: raised in-memory health for material runs and a teleport past a pinning lake are testing tools, never balance claims; say so in the record.
- **Every TOOL in the stash rides into the drop with you** — and falls with your death. Wave 10D stocked a spare axe and lost both. Don't keep spares in the stash before a risky run; the kit takes them all.
- **A mob can bite you from NO loaded chunk's entity list** (the moved-mob shape, with teeth): Wave 10D's extraction channels were broken five times by flyers that a 200px entity scan could not find, so there was nothing to fight back at. Leash-breaking by distance works; expect the pest back at the beacon.
- **The character-select JACK IN button only exists for the active row.** Scripted play: click the row first, then find JACK IN again — the ref moves.
- **A shop card's blind sheet is not a bug.** Since 10E, an unstudied affix shows NOTHING on any sheet while it acts in full (a bought "of the Dreaming Seed" blade really does carry −10 max health you cannot see). Study it at a bench before believing a stat line.
- **Pinned worlds roll differently from the hub's shelf on purpose.** A world rolls from its mint-pinned pack version forever; the hub shelf rolls from the CURRENT bank (purged legacy + GLOBAL + CART). If a roll "changed", check which pool you are in before suspecting determinism.
- **The affix roll pool accepts banked entries and legacy definitions both** (`statModifiers` optional, `name` vs `nameTemplate`). If you add a pool source, keep both shapes or pickAffix throws on name-only entries.
- **Nothing you buy rides into a drop unless CARRIED.** Only tools auto-ride. Wave 10E's first deploy landed naked in a B-threat forest and died in 90 seconds — mark CARRY in the stash (or wear it: the harness rides) before every deploy.
- **Bring the pane forward yourself.** `mcp__ccd_view__show_pane` with `preview`, then `tabs_select`: the raw materials leg went from 2 frames a second to 240 in one call. The hidden-pane trap above still holds if the window itself is covered.
- **`javascript_tool` gives up at 45 seconds.** The script keeps running in the page and your next call may race it. Split a walk or a run across calls, and check where you are before continuing.
- **Logs and stone now answer `building`.** `pickBill` with no material named eats them in stash order, including the logs you meant to mill. Pass the third argument, in code and in test setups. It cost three older tests their setup, not their bars.
- **Read tags through `answersTag`, never `item.tags`, on any bill path.** An item stores its tags at mint; a stash can hold logs from before D24.
- **`LORE_FRAGMENTS` must never grow,** and no table a pinned world's `rng.pick` reads may. New per-world behaviour takes its own keyed stream, like `ProcessSystem.chestNote`.
- **A new theme in the bank must stay out of `DreamingSystem.entriesFor`.** It reads biome, GLOBAL and CART only; that is what keeps PROCESS entries out of the dream. Adding batches also moves `AffixBank.version()`, so the next world minted pins the new version, and that is correct; `tests/rawmaterials.test.ts` holds v1 and v2 to their byte hashes.
- **A room's stats and a weapon's are different halves of one record.** `ROOM_ACTING_STATS` never merges into a gear item's acting stats; the rest never reach a room. The card shows the whole record once studied.
- **Fresh origin at `localhost:3104`** (`world-seed-dev-3104`): LATHE, Nomad, with a stone workshop, a log house and a plank house, the world RAW TIMBER pinned at v4. Carry limit 40 kg, SLOWED above 80%: six logs and two tools are a full load.
- **`tests/grid.test.ts`'s chunk bar reads load.** On 2026-10-31 it sat at 17.6–19.5 ms against 16, and at the same numbers on the untouched commit with ten node processes up. Before believing a red, stop every dev server, and if it is still red, run that bar on an untouched commit from `git archive` (never stash; other sessions share this folder).
- **Windows files are CRLF on disk and LF in the index, and git reports it per file (`git ls-files --eol`).** `grep -c $'\r'` from the Bash tool reads 0 on them. A multi-line edit target fails on more than the endings too: some older lines end in a trailing space.
- **Reaching `__ws` after a thrown script can leave a mess.** `setState` spreading a session that is gone builds a fake one. Check `currentSession` before writing to it: the death may have landed between your calls.
- **A fresh card reads no properties.** The field card's default fell from knowledge level 2 to 1 on purpose: Density and Hardness now take a handled skill. An old test or a screenshot expecting them is reading the old law.
- **A skill will not appear in the field.** That is line 64. Look in `player.skillProgress`, and take a seal, a death or a withdrawal to settle it. A failed rest with no new attempts gets the same answer forever, by design.
- **A new tag goes in a batch first.** A tag literal in `src` that is not registered fails a source scan, and a tag on a definition fails the harness. Identity kinds are forever: pick the kind with care, because it decides whether old skills split.
- **Fresh origin at `localhost:3105`** (`world-seed-dev-3105`): TENON, Nomad, Felling at handled, the first in the hub; a raw log workshop and a Sawpit standing; the world THE LONG STANDS pinned at v4 and web v2, though it collapses on its clock.
- **Same-millisecond jobs used to share ids** — two crafts queued in one ms on one lot minted outputs with IDENTICAL item ids (fixed in 10D with a queue-length tie-break). If you add any id built from `Date.now()`, break the tie yourself.

## After this pass

`PLAN.md`, under "The next legs": the playtest fixes, then Wave 11 (people, farms and materials come home — `Escort Bond`, `res_tree_sapling`, `IFarmPlot` wait as hooks; D8's NPC pooling pools against a TEMPLATE's bill, which now exists; the banks and the Dreaming stand ready if residents' wants draw on themed content), then Wave 12 (the second true test, played honestly, with balance — the flyer swarms, the unfindable biters, the honest cart haul and the honest tow-break all wait for it).
