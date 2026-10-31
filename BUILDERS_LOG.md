# Builder's log

Written 2026-10-31 at the end of Wave 8, for whoever builds next. It assumes you have seen none of the conversation. The next pass is **walking, animation and sprite design**, and everything you need to start is here.

Read this first, then `PLAN.md` section 3B, then look at the game running. `HANDOVER.md` covers the systems up to Wave 7 (signing, ledger, economy). `DESIGN_ASK.md` is the single design brief and holds the measured results.

## Where it stands

World Seed is a browser extraction game: a signed identity, generated worlds, a drop, a haul, a ledger. It is meant to feel like the bank's own terminal, running alone for a very long time.

Pedro's verdict on the current look, seeing it in the real game: *"literally absurdly good"*, and *"EVEN MY WIFE said this has character"*. **The look is approved. Your job is to make it move without losing it.**

- **Tests:** 145 passing (`npm test`), including one recorded known failure (see Known weak spots). Production build passes.
- **Last commit:** `4b0864e`. **Everything since is uncommitted**: the Tempered Pick, the people and hub art, and all of Wave 8. Check `git status` before you start. Commit only when Pedro asks.
- **Run it:** `npm run dev`, then `http://localhost:3000`. The proof pages are `/prototype/atoms/index.html` (atoms) and `/prototype/atoms/hub.html` (people and the city, walkable). Press Grayscale first on both.

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

## Your pass: what exists for motion today

A minimal layer already works, and Pedro noticed it: the player walks on two frames in four facings, enemies notice and chase, shots and swings fly, trees lose their crowns as they are felled, and water and lamps flicker in the city. The job is to deepen that, not to start it. **Your scope, decisions and test lines are in `PLAN.md` under "The next legs"**: Wave 8B, decisions D1 to D3, lines 21 to 25.

**The player (`figure`)**
- 16 atoms plus a seam, 4 facings, 2 step frames. Left is a mirror of right.
- In the field, `WorldCanvas` flips the step every 220ms while moving, and facing comes from the larger axis.
- **When you stop, the step frame stays where it was.** There is no standing frame and no idle.
- The corner brackets that mark "you" are part of the sprite, so they currently mirror and move with it.

**Creatures (`creature` in `atoms.ts`)**
- One frame, front-on, with no facing. Nine body plans come from tags through `planFor`: ring, tracks, spikes, rotor, hull, wings, tendril, biped, swarm.
- Sizes are `SIZE_ATOMS`: Tiny 10, Medium 14, Large 20, Gigantic 32, Colossal 48.
- Rank is a 5×5 mark at the lower right, and it is a speck at real size.

**Enemy movement (`MobAI.tick`)**
- Dormant until 8 tiles away, active until 16. Moves at 2 tiles a second, straight at you.
- **It ignores terrain, so enemies walk across water and rock.**
- `mobMemory` holds state and last attack, but there is no facing. You will need one.
- Every enemy decides with fixed values (`Temperament.AGGRESSIVE`, `GenreType.SCIFI`). The definition's `behavior` (Swarm, Siege, Turret) is not used at all, so a Turret walks like a rat.
- A moved enemy stays in its original chunk's list. `FieldRenderer` and the simulation look at chunks near you, so one that wanders far can drop out of both.
- Generated positions are on tile centers, but active enemies move in floats.

**Combat feedback**
- `CombatSystem.tick` already emits `HIT`, `KILL`, `LOOT_SPAWN` and `PLAYER_DAMAGE`. `WorldCanvas` only reads `ACTION_LOG`. **The hooks for hit flashes and death exist and nothing uses them.** This also means kill XP is calculated and never applied; Wave 9 fixes that.
- Shots are 4px squares, swings are five small squares, drops are a small cross. Enemies have no health display.

**Everything else in the field**
- Resources, ruins, chests, NPCs and the exit beacon are all single static frames.
- Trees change shape per felling, and resources have spent states, but those are state changes with no transition.

**The hub**
- Movement jumps one tile per keypress, with no tween. The step frame comes from position parity.
- Keepers are one frame, standing still, and cannot be bumped into.
- Only water and lamp flames animate, on a 500ms timer, with 2 frames composed for the whole city. `composeHub` takes about 19ms, so per-frame recomposition is not an option; draw moving things as sprites on top.

**Rendering limits to respect**
- Current frame time is 4.2ms typical and 12.5ms at worst while crossing chunks, against 26 FPS before Wave 8. Do not give this back.
- Sprites become bitmaps through a `WeakMap` keyed by `Sprite` identity, and `entitySprite` caches sprites by a string key. Add frames and facings to those keys. Colossal sprites at 48 atoms with many frames are the memory risk, so bound it and measure.
- **Sprites and the camera round to whole pixels, but an atom is 2px.** Things therefore move in half-atom steps, and a 1px offset between terrain and sprites is possible. Decide deliberately whether positions snap to the atom grid. It may matter more to the look than any new frame.

## Decisions for this pass

These expand on D1 to D3 in `PLAN.md`. Ask Pedro about the first two early. Each changes what you draw.

1. **The camera.** Buildings show their front, creatures and people stand upright, and the tree is drawn from straight above. Pick one rule. Walking makes this more visible, because a facing needs a viewpoint.
2. **How much motion.** The design ask says *"a few stepped frames, never smooth interpolation"*, and the character is an old machine. That argues for few frames with strong poses, not fluid animation. My suggestion is to prototype two and four frames side by side and let Pedro choose by eye.
3. **Hub walking.** Tile steps or smooth like the field? I would match the field, so one world has one way of walking.
4. **Enemy movement against terrain.** This belongs in this pass, because a walk cycle across a lake looks wrong. Use the existing `TerrainSystem.isBlockedTile`. Real pathfinding may not be needed; sliding along edges, as the player does, may be enough.
5. **Use `behavior`?** Turrets that hold, swarms that surround and sieges that plod are mostly animation and movement, and they would be the most character per line in the game.

## Bars I would register first

Starting points, to be set before the art exists:

- Every frame of every creature and facing still passes the existing threat-vs-resource and exit bars (25% difference), not just frame 0. **Most likely to catch a real problem.**
- Walk frames change only the moving parts. `STEP_MAX_CHANGE` is 30% for the player today.
- All facings are distinct, left is an exact mirror of right, and the same input gives the same bytes.
- Stopping returns to a defined standing frame.
- No enemy ends a tick on a blocked tile, across a long simulated chase.
- Hit and death feedback reads in grayscale, by shape or position and not by a red tint alone.
- 300 animated moving things stay inside the frame budget in the browser, and sprite memory stays below a stated bound.
- Reduced motion exists: the design ask requires a version.

Add a sprite sheet to a proof page showing every frame at real size and enlarged, in color and grayscale, and look at it before moving on.

## Known weak spots

**In the art**
- **Portraits are the weakest thing.** They pass their bar, but faces look alike within an archetype, and a hooded Nomad is mostly a shape with eyes. In a game about owning your avatar, this matters. They fall under sprite design.
- **Rank marks** are specks at real size.
- **Near-twins:** a few certificates differ by only 1–4% as figures.
- **Water** reads as hollow dark squares, even at lake scale.
- **The sapling** reads as a plus sign.
- **Worn gear:** the first bite is easy to miss at 36px.
- **Recorded failure:** Silica Sand's Conductivity and Rusted Plate's Hardness reach only 2 atoms at real size (bar 3).

**In the game**
- Balance at the new scale is unplayed. Enemy density, run length and gold are estimates. The worst measured walk from a drop to an exit is about 100 seconds.
- A full fight-to-exit run at normal health has not been played. Harvest, attack and exit were verified with raised health and teleports.
- Trees do not block, and you can walk through a house on your own lot.
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
