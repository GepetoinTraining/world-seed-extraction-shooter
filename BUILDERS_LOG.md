# Builder's log

Written 2026-10-31 at the end of Wave 8, updated the same day at the end of 8B (motion) and again at the end of Wave 9 (the interface), for whoever builds next. It assumes you have seen none of the conversation. The next pass is **Wave 10, inside the houses**, and everything you need to start is here.

Read this first, then `PLAN.md` section 3B, then look at the game running. `HANDOVER.md` covers the systems up to Wave 7 (signing, ledger, economy). `DESIGN_ASK.md` is the single design brief and holds the measured results.

## Where it stands

World Seed is a browser extraction game: a signed identity, generated worlds, a drop, a haul, a ledger. It is meant to feel like the bank's own terminal, running alone for a very long time — and as of Wave 9, the screens finally are that terminal.

Pedro's verdict on the look, seeing it in the real game: *"literally absurdly good"*. **The look is approved, and the interface is now made of it.** Mantine survives only under the admin Genre Creator; every player-facing screen is built from the kit in `src/components/ui/`.

- **Tests:** 200 passing (`npm test`), including one recorded known failure (bar 3, in the art). Wave 9's bars live in `tests/interface.test.ts`.
- **Commits:** Waves 8, 8B and 9 are each committed per the plan's order; check `git log` and `git status` before you start. Commit at the end of your own leg.
- **Run it:** `npm run dev`, then `http://localhost:3000`. Proof pages: `/prototype/atoms/index.html` and `/prototype/atoms/hub.html` (press Grayscale first). The game itself is now also a proof page: the gate, the city, the survey, the field, the receipts.

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
| `tests/interface.test.ts` | Wave 9's bars: lines 26–31, emoji, text floor, keyboard, recon grayscale, dialogue |

A pixel byte is 0 for transparent, otherwise `1 + role * 5 + step`. Pure integer work over byte buffers, testable in Node.

## What the interface pass (Wave 9) built

Full detail in `PLAN.md` 3B. In short: the kit and one theme (9.1); the thin bar and the Agent/loadout screen, HUD-style per Pedro's D7 (9.2); character select with a roster of real owners, birth that ends face-to-face with your real portrait, and the login-reset bug dead (9.3); real item art at real footprints everywhere, no emoji anywhere, the inspect card answering mouse and keyboard (9.4); kill XP finally applied to a rank track with a visible rank-up moment and spendable points (9.5); the SEAL and DIED receipts, the feed, the exit bearing, the ledger viewer (9.6); every dialogue option built or removed in voice (9.7); and the survey redrawn from atoms so it reads in grayscale.

**Left open, honestly:**
- A session left through recon's WITHDRAW is ABORTED and gets no receipt moment.
- The stash list in the Bank shows footprint-scaled thumbnails in rows, not a spatial grid; the spatial grid lives in the field pack. Decide in Wave 10 whether the Bank wants the grid too (placement will want it).
- The near-twin figures, worn-gear subtlety at 36px, and the city's motionless keepers stand as before.
- Balance is still unplayed at scale (Wave 12). A fresh F-rank still dies to the first pack of anything.
- An invented genre still gets its look from a hash; the look family still needs widening.

## Your pass: inside the houses (Wave 10)

**Scope, decisions (D8, D9) and bars are in `PLAN.md`**: the room generator as a prototype first (pure function of lot and structure, 20px tile, warm ramp, proof page with every structure type — it touches no shared files), then real doors and transitions, stations that call the same store functions the Holdings panels use, signed placement. The interface you need exists now: panels, cards, the pack, `ItemSprite` for placing things by their real grain, and the dialogue registry if keepers move indoors. Ask D8 and D9 at the start if unanswered.

## Known weak spots

**In the art:** near-twin certificates at 16 atoms; first wear bite easy to miss at 36px; recorded failure: Silica Sand's Conductivity and Rusted Plate's Hardness reach only 2 atoms (bar 3).

**In the game:** balance unplayed at the new scale; you can walk through a house on your own lot (trees and city buildings block; lot structures do not — Wave 10.2 fixes this); a moved enemy still belongs to its origin chunk's entity list (leashed, but the wrong shape).

## Traps that cost me time

- **The browser pane throttles when hidden — twice over.** 8B lost line 25 to a backgrounded pane. Wave 9 found the deeper layer: `document.hidden` can be FALSE and rAF still runs at ~3fps with an idle main thread, because the desktop pane itself isn't displayed. Front the tab AND show the pane (and keep the window visible) before believing any frame number. The honest measure: 314 things, 4.17ms/frame, vsync-locked at 240Hz.
- **HMR resets zustand stores.** Editing a store-adjacent module mid-session rebuilds the module graph: the bar suddenly says "Unknown · 100 G". That's the template, not data loss — reload fully and the signed doc rehydrates.
- **Test characters die fast.** In-memory health/XP changes are fine for testing and never reach the save. Teleporting skips collision: you can land in a lake.
- **Driving the game from a script.** `window.__ws` exposes the stores; `await import('/src/...')` returns the LIVE module graph (you can monkey-patch `MobAI.tick` etc. for profiling). To walk, dispatch `keydown`/`keyup` on `window` and hold for over a second.
- **The console buffer keeps old errors** across reloads. Check timestamps before believing one.
- **Windows files are CRLF**; long edits are safest as a Python script that normalizes endings and asserts each target string exists.
- **RxDB freezes documents in dev.** Copy before mutating anything from the database (CombatSystem already copies mobs).
- **Generation hashes:** any change to world generation changes `GOLDEN_VECTORS` in `src/entities/world/goldens.ts`. Interface work should never touch them; a change there means something leaked.
- **Vite port:** another session's dev server may hold 3000. `.claude/launch.json` has `world-seed-dev-3100` (`--port 3100 --strictPort`) for a second server.

## After this pass

`PLAN.md`, under "The next legs": Wave 10 (interiors), Wave 11 (people, farms and materials come home — `Escort Bond`, `res_tree_sapling`, `IFarmPlot` wait as hooks), Wave 12 (the second true test, played honestly, with balance). Pedro's D6 crafting half (items raising skills, components carrying affixes, S+ naming) lands with the crafting waves.
