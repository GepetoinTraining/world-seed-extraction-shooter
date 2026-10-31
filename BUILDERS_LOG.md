# Builder's log

Written 2026-10-31 at the end of Wave 8, updated the same day at the end of 8B (motion), Wave 9 (the interface), Wave 10 (the interiors) and Wave 10B (the Architect), for whoever builds next. It assumes you have seen none of the conversation. The next pass is **Wave 10C, The Load-Out** — the first leg of Pedro's itemization program (10C slots and carts, 10D item anatomy, 10E affix banks and world population; Wave 11's residents follow it) — and everything you need to start is here.

Read this first, then `PLAN.md` section 3B, then look at the game running. `HANDOVER.md` covers the systems up to Wave 7 (signing, ledger, economy). `DESIGN_ASK.md` is the single design brief and holds the measured results.

## Where it stands

World Seed is a browser extraction game: a signed identity, generated worlds, a drop, a haul, a ledger. It is meant to feel like the bank's own terminal, running alone for a very long time — and as of Wave 9, the screens finally are that terminal.

Pedro's verdict on the look, seeing it in the real game: *"literally absurdly good"*. **The look is approved, and the interface is now made of it.** Mantine survives only under the admin Genre Creator; every player-facing screen is built from the kit in `src/components/ui/`.

- **Tests:** 252 passing (`npm test`), including one recorded known failure (bar 3, in the art). Wave 9's bars live in `tests/interface.test.ts`; Wave 10's in `tests/rooms.test.ts`; Wave 10B's in `tests/templates.test.ts`.
- **Commits:** Waves 8, 8B, 9, 10 and 10B are each committed per the plan's order; check `git log` and `git status` before you start. Commit at the end of your own leg.
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

A pixel byte is 0 for transparent, otherwise `1 + role * 5 + step`. Pure integer work over byte buffers, testable in Node.

## What the interface pass (Wave 9) built

Full detail in `PLAN.md` 3B. In short: the kit and one theme (9.1); the thin bar and the Agent/loadout screen, HUD-style per Pedro's D7 (9.2); character select with a roster of real owners, birth that ends face-to-face with your real portrait, and the login-reset bug dead (9.3); real item art at real footprints everywhere, no emoji anywhere, the inspect card answering mouse and keyboard (9.4); kill XP finally applied to a rank track with a visible rank-up moment and spendable points (9.5); the SEAL and DIED receipts, the feed, the exit bearing, the ledger viewer (9.6); every dialogue option built or removed in voice (9.7); and the survey redrawn from atoms so it reads in grayscale.

## What the interiors pass (Wave 10) built

Full detail in `PLAN.md` 3B. Pedro's D8/D9 reshaped it at the start: rooms are BUILT from a tile↔function builder, never generated — walls, stairs, windows and doors are the only structure, and everything else in a room is an item. In short: the room contract and composer with its proof page (10.1); real doors — built lots block their footprint, `[E] ENTER` walks you in, the doorway walks you out, your street position kept (10.2); construction as jobs — gold permit + material bill consumed exactly once + clock, every step signed, the shell minting its bench or counter (10.3); placement of any stash item at its real art, validated (nothing seals the way out; stations demand their minimum area), signed with provenance, surviving reloads and coming home on foreclosure (10.4); and the NPC presets as data for Wave 11's pooling (10.5). The whole loop was played: mint → buy → build on the clock → enter → place → craft at the bench → wall up → reload → same room → counter serving with the hub's cut.

**Left open, honestly:**
- A session left through recon's WITHDRAW is ABORTED and gets no receipt moment.
- The stash list in the Bank shows footprint-scaled thumbnails in rows, not a spatial grid; the spatial grid lives in the field pack. Placement went keyboard-first instead (the tile ahead), so the Bank grid question still stands for a later pass.
- Stations are told apart by card and name; they still want a silhouette family of their own.
- STAIR is typed and refused in voice — one floor until the hub grows. Demolish returns no materials. A HOUSE has no function hook yet.
- The near-twin figures, worn-gear subtlety at 36px, and the city's motionless keepers stand as before.
- Balance is still unplayed at scale (Wave 12). A fresh F-rank still dies to the first pack of anything.
- An invented genre still gets its look from a hash; the look family still needs widening.

## What the architect pass (Wave 10B) built

Full detail in `PLAN.md` 3B. Pedro's D12/D13/D14 shaped it at the start, each bigger than the recommendation: the station is a SCRIBE'S TABLE (generalist — scrolls will be written there too), a house built fully of one material earns a recorded set bonus (numbers land in 11B), and the mint runs on PAPER AND INK (paper from planks, iron gall ink from gallpods and raw iron; the alchemist stocks the gallpod).

In short: the template contract as data (`ITemplate` — geometry, zones with promised areas, size needs; the presets folded in as SYSTEM TEMPLATES through the one `templateToRoom` path; an invalid plan cannot be minted and refuses in voice) (10B.1); the builder view at the placed scribe's table — tile cursor, keyboard-complete, live refusals, zones measured live, color/grayscale preview through composeRoom, MINT and COPY both paid in paper and ink with the ORIGINAL author riding every copy (10B.2); trade through the existing counter unchanged, with the template card (needs, pieces, zones, ARCHITECT) and thumbnails that are the composed plan itself (10B.3); `applyTemplate` — size needs refused with the numbers, the material sheet one-choice-per-class billed by tag, everything consumed exactly once, an UNDER_CONSTRUCTION lot state whose scaffold blocks exactly what it draws and whose building rises by shape as the signed job batch lands shell-first-then-pieces-in-order, finished meaning piece-for-piece equal (10B.4); and the house remembering its architect on cards from the street and inside, with the mono-material line (10B.5). The whole loop was played as BASALT: tools and gallpods bought → an honest death in the ruins → a real harvest run (logs, iron, pack-refusal caches) → sealed haul → planks/paper/ink/scribe's table milled and joined → plan drawn, minted, copied, sold and bought back over the counter → applied → the scaffold watched from the street and the pieces from inside → the finished house, its plaque, and a full reload keeping every byte.

**Left open, honestly:**
- Line 43's size refusal passes by test and shows in the sheet, but all six city lots are one 4×4 class, so it cannot be PLAYED until lots grow with the hub. The 3×3 and 6×5 classes already exist in the studio.
- The mono-material set bonus is detected and recorded; its numbers land in 11B with D9's property bonuses.
- Switching app tabs (BANK/HOLDINGS) while walking the city returns you to the plaza spawn — pre-existing, now on record.
- The glass chain still needs a field trip for sand; BASALT's first apply was refused on the glass bill (honestly, in voice) and the built house is the windowless all-plank plan.

## Your pass: the Load-Out (Wave 10C)

**Scope, decisions and bars are in `PLAN.md`** (gate lines 47–49; D16, D17, D19 and D21 are ALL DECIDED — read their rows, nothing is left to ask at the start): the full slot tree replacing Wave 4's three buckets (HEAD and EYES — helmet and glasses, D17 — right/left hand, chest, legs, boots, themed shoulder, bag, necklace, earring, two rings, quiver, belt, PLUS dedicated TOOL slots so nobody swaps pick for sword between fighting and extracting — tools ARE the extraction; and D22's HEAD BUDGET, refined: HEAD, EYES, EARRING and NECKLACE each hold either their gear or a cognitive frame, three frames at most — and the stat partition is law: mental stats come ONLY from frames, never from physical gear, and they drive the recon phase too), stat requirements refusing in voice, the weight law (equipped gear exempt from carry weight — the limit is the haul, not the harness), the belt-and-pouch law (D17: pouch slots plus quick-use; a pouch names what it stacks), the slot-protection contract (D21: a slot can be marked protected for the session by magic, and the death path keeps exactly the protected slots — the items that grant it are 10E's; build the contract and a dev hook now), and THE CART (D16, decided): towed world entity, own grid, real speed cost, stays across your death, anyone may tow it away with the theft signed. Equip must already show NO stat change for unstudied affixes (D19 decided: they ACT; stub the knowledge check now so the screen never learns the bad habit). The slot tree is a `types.ts` contract change — additive, migrate the three old buckets in. Register the bars before anything exists. Pedro approves the leg at its end.

## Queued after this program: bringing the Nexi home (Wave 11)

**Scope, decisions (D10, D11) and bars are in `PLAN.md`** (gate lines 35–38): redeeming an `Escort Bond` places a RESIDENT whose sheet was already rolled in the world (recognisably that person), with a job that has a real effect; FARMS as a lot structure (D11) — plant what you harvested, growth on the accumulate-and-resolve clock, nothing running while away; materials stored and displayed by their real grain with history; residents visible in the city using 8B's walk. D8's deferred half lands here: NPC pooling pools player materials against a TEMPLATE's bill — `SYSTEM_TEMPLATES` and `templateBill` in `src/entities/hub/template.ts` are exactly that bill, and `applyTemplate`/the `IBuildJob` batch in the hub store is the construction path to reuse (a resident's house should rise through the same UNDER_CONSTRUCTION state, pooled instead of paid by one hand). Upkeep for residents goes through the existing treasury path (D10). Register the bars before anything exists; ask D10/D11 at the start if unanswered.

**After the program and Wave 11:** Wave 12 (the second true test). Wave 11B was absorbed into 10D/10E (its mono-material bonus numbers, property prices, demolish salvage and full-loop audit all land there). The "Found in Play" fixes card (cache duplication, mint-world draft loss, pack grab-and-hover — diagnoses in the shared notes folder) runs between legs, after this program by Pedro's word.

## Known weak spots

**In the art:** near-twin certificates at 16 atoms; first wear bite easy to miss at 36px; recorded failure: Silica Sand's Conductivity and Rusted Plate's Hardness reach only 2 atoms (bar 3).

**In the game:** balance unplayed at the new scale; a moved enemy still belongs to its origin chunk's entity list (leashed, but the wrong shape). (The walk-through lots are fixed: a built lot blocks exactly what it draws, and its door is real — Wave 10.2.)

## Traps that cost me time

- **The browser pane throttles when hidden — twice over.** 8B lost line 25 to a backgrounded pane. Wave 9 found the deeper layer: `document.hidden` can be FALSE and rAF still runs at ~3fps with an idle main thread, because the desktop pane itself isn't displayed. Front the tab AND show the pane (and keep the window visible) before believing any frame number. Wave 10 hit it again walking the city (2 tiles in 5 seconds): `tabs_context` SAYS "the Browser pane is currently hidden" — check it before walking anywhere. The honest measure: 314 things, 4.17ms/frame, vsync-locked at 240Hz.
- **HMR resets zustand stores.** Editing a store-adjacent module mid-session rebuilds the module graph: the bar suddenly says "Unknown · 100 G". That's the template, not data loss — reload fully and the signed doc rehydrates.
- **Test characters die fast.** In-memory health/XP changes are fine for testing and never reach the save. Teleporting skips collision: you can land in a lake.
- **Driving the game from a script.** `window.__ws` exposes the stores — USE THOSE for store state: Wave 10 found that `await import('/src/entities/player/store.ts')` in the console can hand you a SECOND module instance whose setState the app never sees (gold stays stale on screen). `await import('/src/...')` is still right for pure modules (ItemFactory, definitions, Rng) and for monkey-patching. To walk, dispatch `keydown`/`keyup` on `window` and hold for over a second.
- **The console buffer keeps old errors** across reloads. Check timestamps before believing one.
- **Windows files are CRLF**; long edits are safest as a Python script that normalizes endings and asserts each target string exists.
- **RxDB freezes documents in dev.** Copy before mutating anything from the database (CombatSystem already copies mobs).
- **Generation hashes:** any change to world generation changes `GOLDEN_VECTORS` in `src/entities/world/goldens.ts`. Interface work should never touch them; a change there means something leaked.
- **Vite port:** another session's dev server may hold 3000. `.claude/launch.json` has `world-seed-dev-3100` and `world-seed-dev-3101` (`--strictPort`). The test avatar BASALT lives under origin `localhost:3101` — use 3101 to inherit it.
- **Clicking field entities from a script is flaky**: the DOM hit areas don't always sit where the sprite draws. The first click proved the real menu path; after that, `InteractionEngine.getAvailableInteractions` + `performInteraction` from the console is the same function the menu button calls. Harvest outputs that don't fit the pack become ground caches at your feet (the feed says so) — the field pack is 8 columns × 3 rows, and six 1×3 logs plus two 1×3 tools fill ALL of it.
- **The studio canvas is CSS-scaled** in screenshots: tile = 20 CSS px × (screenshot width / viewport width). Compute tile centers from the canvas origin before clicking, or use the keyboard cursor.
- **Walking long field distances by held keys stalls on lakes** — the resolver refuses water and the straight-line walker just grinds. Wave 8's recorded practice stands: raised in-memory health for material runs and a teleport past a pinning lake are testing tools, never balance claims; say so in the record.

## After this pass

`PLAN.md`, under "The next legs": Wave 11 (people, farms and materials come home — `Escort Bond`, `res_tree_sapling`, `IFarmPlot` wait as hooks; D8's NPC pooling pools against a TEMPLATE's bill, which now exists), Wave 11B (the materials pass — the full economic and transformation loops, D15; the mono-material set bonus numbers and D9's furniture-from-materials bonuses land there, and D6's crafting half lands there or in the crafting waves proper), Wave 12 (the second true test, played honestly, with balance).
