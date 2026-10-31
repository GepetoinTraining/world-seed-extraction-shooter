# Builder's log

Written 2026-10-31 at the end of Wave 8, updated the same day at the end of Wave 8B, for whoever builds next. It assumes you have seen none of the conversation. The next pass is **Wave 9, the interface**, and everything you need to start is here.

Read this first, then `PLAN.md` section 3B, then look at the game running. `HANDOVER.md` covers the systems up to Wave 7 (signing, ledger, economy). `DESIGN_ASK.md` is the single design brief and holds the measured results.

## Where it stands

World Seed is a browser extraction game: a signed identity, generated worlds, a drop, a haul, a ledger. It is meant to feel like the bank's own terminal, running alone for a very long time.

Pedro's verdict on the current look, seeing it in the real game: *"literally absurdly good"*, and *"EVEN MY WIFE said this has character"*. **The look is approved. Your job is to make it move without losing it.**

- **Tests:** 169 passing (`npm test`), including one recorded known failure (see Known weak spots). The motion bars live in `tests/atoms.motion.test.ts`.
- **Commits:** Wave 8 and Wave 8B are each committed per the plan's order; check `git log` and `git status` before you start. Commit at the end of your own leg.
- **Run it:** `npm run dev`, then `http://localhost:3000`. The proof pages are `/prototype/atoms/index.html` (atoms, creature motion, trees, water) and `/prototype/atoms/hub.html` (people, walk cycles, the city — walkable, smooth). Press Grayscale first on both.

## Working with Pedro

- **Pedro approves wave by wave**, usually "Yes, Wave N". Report plainly, including what failed. Don't call something done that you have not seen working.
- **Don't side-track.** "Do not change your plan from fixing this because something else is cool." `agent.md` holds the original vision and it stays fixed: SAO-style world, hubs, owning your avatar.
- **Colourblind:** code by position, shape and hard seams, never by hue alone. Grayscale is a real test, not a courtesy.
- **Game terms** stay in code and design documents. In commentary to Pedro, use neutral language.
- **One design document.** `DESIGN_ASK.md` stays singular. Update it; do not start another.
- **Pedro thinks in structure and is often right.** The tile, quadrant, chunk and sector hierarchy was Pedro's call, better than my proposal, and quadrants turned out to be the natural cache unit exactly as predicted. Listen for that.

## The method that produced this look

This is why it works. Keep it.

1. **Real data.** Art comes from real seeds, definitions and certificates. No image files, no hand-placed pixels outside the families.
2. **Register bars before the art exists**, in a test file, and never lower one to get a pass. If a bar is wrong, say so and record it.
3. **Then look with your eyes.** Every important failure here passed its numbers first: worlds "different" per pixel but identical to the eye, a tree that read as a flower, a forest that was a solid carpet. When the eye catches something, add a bar for it, then fix the art.
4. **Play it through the real interface.** Unit tests never found the worst bugs. Dying in seconds found the drop bug; a silent empty map found the missing Post-Apoc creatures.
5. **Report failures as failures.** A bar you cannot clear becomes `it.fails` with a comment, which turns red if it ever starts passing.

## The grid

Defined in `src/entities/world/grid.ts`. World size counts sectors.

| Cell | Size | Purpose |
|---|---|---|
| Atom | 2px | The one unit of art |
| Tile | 10 atoms, 20px | Terrain is decided here; things stand on tile centers when generated |
| Quadrant | 16 tiles, 320px | Things are placed here and terrain art is cached here |
| Chunk | 64 tiles, 1,280px | Built on demand and simulated |
| Sector | 512 tiles, 10,240px | Scanned and dropped into |

A chunk is a pure function of seed and position: no shared random stream, and no dependence on world size or generation order. Worlds made on the old grid are retired, with Deploy disabled.

## Where the code is

| File | What it does |
|---|---|
| `src/render/atoms/atoms.ts` | Pixel encoding, ramps, grain, `Ink` and `stamp`, creatures, resources, items, marks |
| `src/render/atoms/people.ts` | `figure` (player, 4 facings, 2 steps), `portrait`, `castFigure`, `castPortrait` |
| `src/render/atoms/hub.ts` | The city from `HubGenerator`: floors, lamplight, buildings, signs, type, lots |
| `src/render/atoms/world.ts` | Genres and looks, terrain buffer, `entitySprite`, `composeView` |
| `src/render/atoms/inspect.ts` | Inspect card and `hitTest`. Clicks use the hit test; the card is not in the game yet |
| `src/render/FieldRenderer.ts` | Draws the field on one canvas, with terrain cached per quadrant |
| `src/components/WorldCanvas.tsx` | Field game loop, recon, input, HUD |
| `src/entities/hub/HubCanvas.tsx` | City view, movement, dialogue, shops |
| `src/entities/world/WorldGenerator.ts` | Regions, exits, drops, chunks on demand |
| `src/entities/mob/ai/MobAI.ts` | Enemy state and movement |
| `prototype/atoms/` | The two proof pages. Add new sprite sheets here |
| `tests/atoms*.test.ts`, `tests/grid.test.ts` | The bars |

A pixel byte is 0 for transparent, otherwise `1 + role * 5 + step`. Everything is pure integer work over byte buffers with no canvas, so it is testable in Node and hashes the same in the browser.

## What the motion pass (Wave 8B) built

Done 2026-10-31, bars in `tests/atoms.motion.test.ts`, full detail in `PLAN.md` 3B. In short:

- **One camera rule (D1):** anything with a height stands upright and shows its front; only flat ground is seen from above. The tree gained a life crown over a matter trunk (`treeSprite` in `atoms.ts`); fellings bite the crown; the stump keeps none.
- **Drawing snaps to the 2px atom grid (8B.1)** in `FieldRenderer` and the hub: movement floats, drawing quantizes, so sprites and terrain never sit half an atom apart.
- **The walk (D2, still open for Pedro's eye):** a defined standing frame, and both a 2-frame and a 4-frame cycle behind `WALK_PHASES` in `people.ts` (currently 4). The hub proof page shows them side by side, animated. One constant switches the game.
- **One walk everywhere (D3 of the log's list):** the city now walks like the field — held keys, per-axis navmesh sliding, same speed and cadence, stand on stop (`HubCanvas`, rAF loop).
- **Creature facings and frames** derive per body plan (`creature(def, s, {facing, frame})`): sides squeeze to 5/8 with the eye sliding but never off the body; backs lose eyes and gain a low dorsal line; `ring` is radial and keeps one face. Sprite memory for all of it: 78KB (bound 512KB).
- **Enemies obey the world and themselves:** `MobAI.tick` takes the map and moves through `WorldGenerator.resolveMove` (water, rock, trunks refuse; mud slows); `speed`, `viewRange` and `behavior` come from the definition. Turret holds, swarm takes a hashed slot on a ring and bites only from there, siege plods, neutral stirs at touch or damage, passive ignores until provoked. `MobAI.pose(id)` gives the renderer facing and gait; `MobAI.provoke(id)` is called on every HIT.
- **Trunks block (D3):** `WorldGenerator.trunkAt`; checked at the destination only, so nothing is ever trapped. Standing things (mobs, NPCs, trees, player) y-sort by their feet, so you walk under crowns.
- **Feedback is on screen:** hit brackets, a stepped death burst with strike-through, five health pips over the wounded, a loss edge when the player is hit, rank marks at double scale in the field. All in `FieldRenderer`, fed by `effects`/`mobPoses`/`hurtAt` on `FieldScene`; grayscale-barred.
- **Sprite pass:** portraits grew brows/noses/mouths/hair and per-id hoods and halos (bar raised 0.10 → 0.12); the sapling is a sprout; water is a dark body with broken crest lines, held to mud's law (≥25% vs open ground, every genre) and always darker than mud.
- **Reduced motion:** `prefers-reduced-motion` honored in field, city and both proof pages — effects hold one step, ambient animation stops, walks still step (they carry state).

**Left open, honestly:**
- **Line 25 is unmeasured in the real game.** The session's browser pane ran throttled in the background, so no honest frame number exists for 300 animated things in real play. The proof page's measured table still runs on load. Measure it when you can see the window.
- A moved enemy still belongs to its original chunk's entity list (the leash hides it; it is still the wrong shape).
- Hit-flash and death-burst were verified by code path and color bars, not caught by eye — they last 140/450ms. Watch one kill when you run the game.
- Keepers still stand still and cannot be bumped into.

## Your pass: the interface (Wave 9)

**Your scope, decisions and test lines are in `PLAN.md` under "The next legs"**: Wave 9, decisions D4 to D7, lines 26 to 31. Fix the kill-XP-never-applied bug first (`CombatSystem` emits `xpReward` on KILL; `WorldCanvas` consumes HIT/KILL for effects now but still applies nothing). The `KILL` event now carries `definitionId` and `position`. Mantine still owns the screens; the kit in 9.1 replaces it piece by piece.

## Known weak spots

**In the art**
- **Near-twins:** a few certificates differ by only 1–4% as figures. Portraits now tell them apart more, but the figures themselves still stand.
- **Worn gear:** the first bite is easy to miss at 36px.
- **Recorded failure:** Silica Sand's Conductivity and Rusted Plate's Hardness reach only 2 atoms at real size (bar 3).

**In the game**
- Balance at the new scale is unplayed. Enemy density, run length and gold are estimates. The worst measured walk from a drop to an exit is about 100 seconds.
- A full fight-to-exit run at normal health has not been played. Harvest, attack and exit were verified with raised health; a plain test character at a drop dies to the first rat in seconds, which is itself unbalanced.
- You can still walk through a house on your own lot (trees block now; buildings in the hub always did; lot structures in the field of the hub do not).
- Existing saves have no archetype and default to Operator.
- An invented genre still gets its look from a hash, and the set of looks needs widening.

**Still using the old interface, for Wave 9:** the pack (emoji), HUD text (dim and small), recon sector colors (hue only), Mantine panels, and the unused inspect card.

## Traps that cost me time

- **Test characters die fast.** In-memory health changes are fine for testing and do not reach the save, because sessions are not persisted. Teleporting skips collision, so you can land in a lake, which is what a screenshot of 99,924 health in deep water was.
- **Driving the game from a script.** `window.__ws` exposes the stores. `await import('/src/entities/world/WorldGenerator.ts')` gives you live modules in the page. To hold a key, dispatch `keydown` and `keyup` on `window`; a plain key press is too short to walk.
- **The console buffer keeps old errors** across reloads. Check timestamps or the file names in the stack before believing one.
- **Windows files are often CRLF with trailing spaces**, and shell heredocs can mangle quoting and backslashes. Long edits are safest as a Python script written to the scratchpad, normalising line endings, and asserting that each target string exists. A plain `replace` with no assert fails silently.
- **RxDB freezes documents in dev mode.** Copy before mutating anything that came from the database.
- **Generation hashes:** any change to world generation changes `GOLDEN_VECTORS` in `src/entities/world/goldens.ts`. Recapture them deliberately. Animation work should not touch them, so a change there means something leaked.
- **`composeView` and the proof view** must be a typical terrain mix. A view that was 50% mud once failed a genre bar for a reason that had nothing to do with genres.

## After this pass

`PLAN.md`, under "The next legs", has the rest with its decisions, bars and test lines: Wave 9 (interface, character select, skills, level-ups), Waves 10 and 11 (house interiors from our own tile generator, and bringing people, materials and farms home from the nexi), and Wave 12 (a second true test, played honestly, with balance). Most of the hooks exist as dead ends: `Escort Bond`, `res_tree_sapling`, `IFarmPlot`, `attributePoints`.
