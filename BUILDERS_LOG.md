# Builder's log

Written 2026-10-31 at the end of Wave 8, updated the same day at the end of 8B (motion), Wave 9 (the interface) and Wave 10 (the interiors), for whoever builds next. It assumes you have seen none of the conversation. The next pass is **Wave 10B, the Architect** — Pedro reordered the legs the day Wave 10 landed — and everything you need to start is here.

Read this first, then `PLAN.md` section 3B, then look at the game running. `HANDOVER.md` covers the systems up to Wave 7 (signing, ledger, economy). `DESIGN_ASK.md` is the single design brief and holds the measured results.

## Where it stands

World Seed is a browser extraction game: a signed identity, generated worlds, a drop, a haul, a ledger. It is meant to feel like the bank's own terminal, running alone for a very long time — and as of Wave 9, the screens finally are that terminal.

Pedro's verdict on the look, seeing it in the real game: *"literally absurdly good"*. **The look is approved, and the interface is now made of it.** Mantine survives only under the admin Genre Creator; every player-facing screen is built from the kit in `src/components/ui/`.

- **Tests:** 227 passing (`npm test`), including one recorded known failure (bar 3, in the art). Wave 9's bars live in `tests/interface.test.ts`; Wave 10's in `tests/rooms.test.ts`.
- **Commits:** Waves 8, 8B, 9 and 10 are each committed per the plan's order; check `git log` and `git status` before you start. Commit at the end of your own leg.
- **Run it:** `npm run dev`, then `http://localhost:3000`. Proof pages: `/prototype/atoms/index.html`, `/prototype/atoms/hub.html` and `/prototype/atoms/room.html` (press Grayscale first). The game itself is now also a proof page: the gate, the city, the rooms behind the lot doors, the survey, the field, the receipts.

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

## Your pass: the Architect (Wave 10B)

**Scope, decisions (D12–D14) and bars are in `PLAN.md`**: templates separate geometry from materials. The template contract as data first (`ITemplate`: structure layer, floor zones, size needs — `ROOM_PRESETS` fold into it, one contract, no second path), then the builder view opened at a craftable DRAFTING TABLE, minting signed tradable template items with the author's provenance riding every copy; then raising a house from a template — the material sheet (one material per element class), the bill consumed exactly once, an UNDER CONSTRUCTION lot state, pieces filling in on the clock, and the finished room matching the template piece for piece. Wave 10 left you everything: the validators in `room.ts` ARE the template validators (a template that composes an invalid room cannot be minted), `composeRoom` draws thumbnails and ghost previews, `IBuildJob` is the construction queue, the counter already sells any item, and `DeedSystem`'s `IDeedItem extends IItem` is the pattern for an item that carries data. Register the bars before the view exists. Ask D12–D14 at the start if unanswered.

**After 10B:** Wave 11 (residents from `Escort Bond`, farms, materials home — its brief is in PLAN.md; NPC pooling then pools against a TEMPLATE's bill), then Wave 11B (the materials pass: the full economic and transformation loops, D15), then Wave 12.

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
- **Vite port:** another session's dev server may hold 3000. `.claude/launch.json` has `world-seed-dev-3100` (`--port 3100 --strictPort`) for a second server.

## After this pass

`PLAN.md`, under "The next legs": Wave 10B (the Architect — templates), Wave 11 (people, farms and materials come home — `Escort Bond`, `res_tree_sapling`, `IFarmPlot` wait as hooks; D8's NPC pooling pools against a template's bill), Wave 11B (the materials pass — the full economic and transformation loops, D15; D9's furniture-from-materials bonuses land there, and D6's crafting half lands there or in the crafting waves proper), Wave 12 (the second true test, played honestly, with balance).
