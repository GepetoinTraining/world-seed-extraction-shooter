# World Seed: the design ask

Design the atoms that every World Seed world is made of, then prove them across the whole game: the smallest pieces of pixel and the rules that compose them into any terrain, creature, item, avatar and screen. The game works. It has no character yet. Give it one, at the level of the pixel.

**Status, 2026-10-31.** This began as a brief to a designer, and Waves 8 through 10E, the raw materials leg, the technology web and the usability pass have since answered most of it in the game itself, and Pedro approved the look in the real game. Read it as the design record. The "Settled by…" blocks say what was decided. Passages that say "today" or "currently" describe the game when the brief was written, unless a status note beside them says otherwise. Still open: the weak spots listed under "Still weak, by eye", the widening of the look family, invented genres reaching world generation, sound, and a chosen typeface.

## What this game is

World Seed is a browser extraction game. You create a cryptographic identity, scan a generated world from above, drop in, gather and fight, and try to reach an exit point alive with what you found. Whatever you carry out is signed into a permanent ledger and banked in a shared hub, where you can own land, build, craft and sell. Die, and it stays behind.

Underneath, it is a bank of meaning disguised as a game. The founding line is: *"This is not a game. This is a cradling environment for a silicon-based intelligence."* The inspiration is the full-dive world of Sword Art Online: a world you live in, a society you belong to, and an avatar that is truly yours. Value is time plus risk. Power is a universal rank from F to SSS. Society is interdependence.

The tone is already written: **scientific mysticism, industrial decay, hopeful nihilism.** The writing rule is: *"Never explain the magic. Describe the smell, the sound, the error code."* These fragments, found in ruins, are the voice to design toward:

> Ledger stub: 40,000 G transferred to "NULL". The bank honored it. The bank always honors it.

> DO NOT RECALIBRATE THE BEACONS. They are not pointing at where we are. They are pointing at where we were.

> Maintenance log, cycle 40,221: the Seed is still dreaming. We have stopped asking what about.

> Engram fragment, corrupted: ...and the rank is not a measure of power. It is a measure of how much the world believes in you...

## The character

**The interface is the bank's own terminal, and it has been running alone for a very long time.** Nothing on screen is decoration. Everything is a record the Seed keeps about you: a survey, a ledger entry, a signature, an error it has learned to live with. It is cold and exact, and it is strangely loyal. It will refuse a forged save without hesitation, and it will honor your last 3 gold forever.

Five ideas carry this through every screen:

1. **The machine's colors never change, and they stay rationed.** Void black is what has not been recorded. Emerald is living signal: you, what is active, what you can act on. Gold is value and proof: currency, ownership, signatures. Red is loss, used for almost nothing else. Worlds bring their own palettes, but these four belong to the machine, so its voice is the same in every world.
2. **The world is a survey being rendered, not an illustration.** The field reads as instrument output, closer to a topographic plot and a sonar return than a painted map. Everything in it is computed from the atoms below. Nothing is an emoji.
3. **The record is the reward.** The signature moment of the game is not a kill. It is the instant your haul is sealed into the ledger. That moment should feel as heavy as a bank vault closing, and so should its mirror, the receipt that reads `DIED`.
4. **The hub is the only warm place.** Ledger-cold everywhere else, but the city has lamp light, a fountain, a tavern and people who talk. Coming home should register physically.
5. **It is worn, not sleek.** Sharp corners and monospace are already the foundation. Add age: faint scan residue, ruled ledger lines, stamped marks, an occasional corrupted character. This is an old machine, not a cyberpunk nightclub. Avoid neon glow as a default.

Take this as the direction. Interpret it boldly, and if something here is wrong for the whole, say so and show the better answer.

## Start one step prior: the atoms

World Seed has no single world to draw. It has a seed that makes worlds, up to 64×64 sectors, and a tool that invents new genres. Nobody will see them all, and nobody could illustrate them. So do not design pictures. Design the smallest pieces and the rules, so that any world can compute its own pixels and still look like the same machine made it.

**The game already knows what things are. Almost none of it reaches the screen.** Enemies are red circles and resources are emoji. These are your inputs:

| Input | Values today |
|---|---|
| Seed | Any string; also derives terrain elevation per tile |
| Terrain | Ground, mud, water, rock |
| Biome | Wasteland, Overgrowth, Ruins, Industrial, Cyber City |
| Genre | Fantasy, Sci-Fi, Post-Apoc, Eldritch, Retro, plus invented ones with a name, aesthetic, keywords, tech level and a four-color palette |
| Material | Density, Hardness, Conductivity, Resonance, Luminosity, Toxicity, Elasticity. Code comment: *"Properties determine reality."* |
| Creature | Size (Tiny to Colossal), behavior (Swarm, Siege, Turret...), tags (biological, mechanical, flying, armored, elite, boss), mutations (Armored Shell, Hive Mind...) |
| Item | Tags (blade, heavy, tech, caster...), slot, grid footprint such as 1×3, durability, affixes, identified or not |
| Status | Rank F to SSS, rarity Scrap to Artifact, quality −20% to +20%, durability, identified or not. Separate facts that must not read as one |
| Identity | Certificate id, a hash on every signed record, and one of four archetypes |

**The atoms.** These are my starting proposal. Keep them or beat them, but the families must be small and closed:

| Atom | What it is | Starting point |
|---|---|---|
| **Pixel** | The one unit. Integer scales only, hard edges, no anti-aliasing or gradients | 1 atom = 2 screen px, so a 20px tile is 10×10 atoms. The game's grid is fixed: a quadrant is 16 tiles, a chunk 64 and a sector 512. Terrain art is cached a quadrant at a time |
| **Ramp** | A short color run. Roles and their brightness stay constant while hues change per world | 5 steps each for ground, matter, life and threat, with hue from the genre. Signal, proof, loss and void belong to the machine and never change |
| **Grain** | A repeatable fill pattern | About 8: solid, dither, hatch, speckle, trace, ring... |
| **Edge** | How a shape ends | Hard, rounded, notched, broken, doubled |
| **Part** | A piece of a silhouette | Core, limb, plate, wing, tread, eye, antenna... |
| **Mark** | A tiny fixed symbol that means one thing everywhere | Rank notches, status, ownership, signature |

**The rule that gives this its character: properties become pixels.** A material's look comes from the same numbers that decide its physics, so players learn to read matter by sight:

| Property | Reads as |
|---|---|
| Density | How solid the fill is |
| Hardness | How angular the edge is |
| Conductivity | Straight traces through the grain |
| Resonance | Symmetry and rings |
| Luminosity | Brightest ramp steps, and light spilling onto neighbors |
| Toxicity | Broken, speckled edges |
| Elasticity | Curves |

**How atoms compose, with no exceptions:**
- Pixel → grain → tile → quadrant → chunk → sector → world. A world's thumbnail on its card is its real map.
- Part → silhouette → creature, from size, tags and behavior. A swarm grunt and a siege machine must differ at a glance in any genre.
- Material + footprint → item. A 1×3 blade fills its real shape in the pack.
- Certificate id + archetype → avatar. Your face is derived from the identity you own, which is the ownership fantasy made visible.
- Record hash → seal. Every receipt, deed and banked item gets its own stamped pixel seal, computed from its signature.
- Knowledge → resolution. Something unidentified renders as noise that resolves as you learn it, which matches how the game hides material properties.
- Screens use the same atoms. Panel borders are edges, ledger rules are grain and rank badges are marks, so the interface is made of the same matter as the world.

**The laws:**
- Deterministic. The same seed gives the same pixels on every machine. Use keys such as `{seed}:sprite:v1:{id}`, integers only, with no clock or `Math.random`. The rule set is versioned, so old worlds keep their look.
- Computed once and cached, then blitted to canvas. Animation is a few stepped frames, never smooth interpolation.
- Hand-drawn pieces are allowed only as new parts or marks that join the families. Named bosses may add parts, not bypass the system.

**It passes when:**
1. A genre nobody has seen, such as *Biopunk Wasteland* from a name, four colors and a chosen look, renders with no new art and looks like a different world from the same machine, in color and in grayscale.
2. In grayscale, a player can still tell threat from resource from exit, and can still read rank. Code by position, shape and hard seams, never by hue alone.
3. A Hardness 80 material reads as hard in every genre, and a Rank S mark reads as Rank S everywhere.
4. It stays fast with about 300 things on screen.

**What a prototype has already tested.** `prototype/atoms/` computes these atoms from the game's real seeds, creature definitions and material numbers, with no image files. Run `npm run dev`, then open `http://localhost:3000/prototype/atoms/index.html` for the atoms and `http://localhost:3000/prototype/atoms/hub.html` for the people and the city, which you can walk. `http://localhost:3000/prototype/atoms/room.html` was added for rooms in Wave 10. Grayscale is the first button to press on all three. `tests/atoms.test.ts`, `tests/atoms.depth.test.ts`, `tests/atoms.people.test.ts` and `tests/atoms.motion.test.ts` hold the bars. They were set before each check first ran and were not lowered; four were added afterward, when the eye caught something the numbers had missed. It is one map, nine creatures and fourteen resources, with no animation, and it is a working sketch to beat, not art to polish.

| Question | Measured | Verdict |
|---|---|---|
| Same pixels on every machine? | Node and browser give byte-identical hashes in all three genres | Holds |
| 300 moving sprites | p95 0.40ms to draw, sprites plus one background only, not the whole game | Holds |
| Is a 10×10 tile too coarse? | Closest creature pair differs by 32% (bar 20%), and threat vs resource by 28% (bar 25%, 0 of 126 pairs fail) | 1 atom = 2px holds |
| Could the tile be 5×5? | Dragon and mech differ by 18%, under the bar | No |
| Threats against ground in grayscale | Contrast 7.3 for threats, 5.4 for matter, 5.8 for life (bar 3:1) | Holds |
| Is the exit unlike any creature? | Passes against all nine | Holds |
| Do worlds differ in grayscale? | **Hue alone failed: 0% of 10×10 blocks differed between Fantasy and Eldritch (bar 30%).** With structure and a value key: 86%, 84%, and a narrow 33% for Fantasy vs Biopunk Wasteland | Holds, narrowly |
| Dense Stone, Iron and Titanium apart at real size? | 42%, 44% and 53% of atoms differ visibly (bar 25%) | Holds |
| Hardness 80 vs 20 in the outline | 32% (bar 15%) | Holds |
| Does every real property reach pixels? | **All but two: Silica Sand's Conductivity 2 and Rusted Plate's Hardness 35 reach only 2 atoms (bar 3)** | Fails, kept as a recorded failure |
| Rarity, rank, quality and wear on one item | Each changes only its own region, and all 1,575 combinations give different pixels | Holds |
| Quality readable on all gear | Worst step 14% (bar 12%), full range 46% (bar 30%) | Holds |
| Inspect card vs the game's own rules | Agrees on all 336 harvest cases, and gives a reason on every refusal | Holds |
| Hit-test 300 moving things | p95 0.10ms in the browser (bar 1ms) | Holds |
| Is an archetype readable from silhouette alone? | 100% of 800 figures, on certificates it had not seen (bar 90%) | Holds |
| Does a certificate look like itself? | 196–200 of 200 unique per archetype (bar 195), median difference 15–26% (bar 15%), but the closest pairs differ by only 1–4% | Holds, with near-twins |
| Player vs any creature | Closest 45% (bar 25%) | Holds |
| Hub drawn against its navmesh | 0 tiles wrong in either direction, and a hard seam around every building | Holds |
| Hub districts apart in grayscale | Closest pair 58% of blocks (bar 30%) | Holds |
| Is the hub warmer than the field? | 24.9 vs 22.5 for the warmest genre, by red minus blue, and lamplight 9.4 levels brighter without color (bar 8) | Holds, narrowly against warm genres |
| Compose the whole hub | 19ms, once (bar 100ms), and a new animation frame changes 0.08% of atoms | Holds |

Three findings that change the brief:

- **A genre must bring structure, not just four colors.** A per-pixel test said the worlds differed, while the eye saw one world recolored. A genre now also sets a large ground structure (strata, blotches, lattice or dunes) and a value key (how bright its ground sits).
- **That family is too small, and a look has to be chosen, not hashed.** Four structures and three keys make 12 looks. Picking by hash put two of the game's five genres on the same look, and six random genre names collided in 74% of trials. The game's five genres now have assigned looks. An invented genre still falls back to a hash until the creator lets it choose, and the family still needs widening.
- **Terrain that changes how you move cannot lean on a genre's brightness.** Once genres had value keys, mud vanished into dark ground (17% of its atoms differed from open ground, bar 25%). It is now a fixed ripple using only the darkest and brightest steps (46% or better). Hold every gameplay terrain to this law: water and rock already carry hard seams.

Still weak, by eye, and yours to solve:

- **Near-twins exist.** At 16 atoms a few certificates are almost the same figure. Portraits tell them apart, but decide whether that is enough.
- **Wear is subtle at real size.** The first bite, at 70% durability, is easy to miss on a 36px item, and the rank mark covers much of a 1×1 slot.
- **The inspect card covers neighbors** where the map is crowded. The compact form helps, but placement needs design.
- **Density and Hardness grains** look similar at thumbnail size.
- **The city's keepers** still stand still and cannot be bumped into.

Settled by the motion pass (Wave 8B), kept here as the record:

- **The camera rule is now one rule.** Anything with a height — people, creatures, trees — stands upright and shows its front; only flat ground is seen from above. The tree gained a trunk in matter under a crown in life; the trunk blocks its tile and everything standing is drawn by its feet, so you walk under the crown.
- **Walking is now one walk.** The city walks like the field: held keys, the same speed, the same stepped cycle, a defined standing frame on stop. Both a 2-frame and a 4-frame cycle exist behind one constant; the hub proof page shows them side by side. Pedro chose the 4-frame cycle by eye (2026-10-31), and the game ships with it.
- **Creatures face and step.** Four facings and two frames derive from every body plan with no new art; each definition's `behavior` finally moves it (a Turret holds, a swarm surrounds, a siege plods), and no enemy crosses water, rock or a trunk.
- **Hits, deaths and enemy health reach the screen**, readable in grayscale: brackets on a hit, a stepped burst on a kill, five pips on the wounded, the screen's own edge marking loss taken. Rank marks draw at double scale in the field.
- **Portraits grew features** — brows, noses, mouths, more hair, hoods and halos that belong to the id — and their bar was raised from 0.10 to 0.12.
- **The sapling** is a sprout with leaves. **Water** is a dark body with long broken crest lines, held to the same law as mud: ≥25% from open ground in every genre, and always darker than mud's ripple.
- **Reduced motion exists** everywhere motion does: effects hold one step, ambient animation stops, `prefers-reduced-motion` is honored.

Settled by the interface pass (Wave 9), kept here as the record:

- **The screens are made of the same matter as the world.** One theme (`src/components/ui/tokens.ts`) computes the machine's CSS colors from the SAME `buildPalette` ramps the sprites use; the ~70 scattered colors are gone. UI sprites (items, seals, portraits in panels) stamp through a cold `TERMINAL_GENRE`; the city keeps its warm ramp, so the hub stays the only warm place. Panels carry ledger-rule grain; bars fill in twentieth steps, never smoothly; every control is native and the keyboard reaches all of it, with focus drawn in signal.
- **The two vault moments exist.** Sealing a haul and the `DIED` receipt both hold the screen: the haul at its real art, value and levy, duration, actions on record, and a seal computed from the session's real signature. Their copy is the bank's: "The bank honors it", "The world keeps what fell".
- **The survey stopped being five hues.** Recon cells are computed atoms: per-biome STRUCTURE (dunes, blotches, strata, lattice, traces) in matter ink over a ground value key; void static for the unscanned; a signal lozenge with a void moat for the exit; loss ticks for contacts. A finding for the record: cells drawn only in the ground ramp PASSED the numeric step-difference bar and were still unreadably dark — survey structure needs the matter ramp. The numbers measure; the eye decides.
- **Properties finally reach a player.** The one inspect card answers hover, click and Q-cycling in the field and selection in the pack, stash and shops; it shows material properties at knowledge level, and every refusal gives its reason (`Needs axe, saw or laser cutter`, `Move closer`, energy shortfalls).
- **Kills count and the rank is a moment.** The calculated-and-discarded kill XP now lands on the universal rank track; a rank-up takes the screen with the mark at ten times scale and grants attribute points that really spend. "The rank is not a measure of power…" is now on screen where it belongs.
- **Vocabulary, as now used by the screens:** MINT signs things into existence (identities, worlds); MATERIALIZE enters a hub; DEPLOY enters a zone and the DROP is the landing; EXTRACT leaves with the haul; JACK IN resumes an avatar at the gate; the BANK is the place and the STASH is its storage; AVATAR at the gate, AGENT in the field. "NerveGear" is gone — the console is the SEED CONSOLE.
- **Every dialogue option does something or says why it cannot.** The Hall and the auction block refuse in voice instead of pretending; REST left with nothing to heal.

Settled by the interiors pass (Wave 10), kept here as the record:

- **A room is a build record, not a picture.** Pedro's D8 made rooms neither generated nor free-form: walls, stairs, windows and doors are the only structure, and everything else standing in a room is an item. The composer (`src/render/atoms/room.ts`) is a pure function of that record — the same record gives the same bytes — and the bill for every structural piece asks for a material TAG, never a specific item, so the material that answers the bill is what the wall looks like. Properties became pixels one more time: a plank wall, an ingot wall and a glass wall read apart in color and in grayscale.
- **A table is a workstation and a thing to sell.** D9 dissolved "which buildings get interiors": furniture is itemizable like the character is. `recipe_table` mills three planks into a 2×2 table with its own provenance; the bench and the counter are items a shell mints on completion, and placing them IS placing the Workshop and the shop. The in-room windows call the same store functions the Holdings panels call.
- **The builder refuses out loud.** Nothing may seal the way out, wall a placement in, or build on the door; a stair refuses with the honest reason (one floor at this tier); a station refuses a region smaller than its working minimum, naming the tiles it needs and the tiles it has. Refusal copy lives in the verdicts, in the bank's voice.
- **A built lot blocks exactly what it draws.** The three built-lot faces (gable, corrugation and chimney, striped awning) fill every tile they block, hard-seamed, with the doorway at the bottom centre and the door tile you stand on one row below the footprint. Entering keeps your place in the street; leaving is walking the doorway, not a button.
- **Light without color, again.** Windows brighten the floor around them by ramp steps at a fixed radius, the same law as the lamps, so a lit room survives grayscale.

Settled by the architect pass (Wave 10B), kept here as the record:

- **A plan is geometry; the house is materials.** Pedro's D12–D14 shaped it: templates fix what stands where — walls, doors, windows, named floor zones with promised open areas — and the buyer picks one material per element class on the apply sheet, billed by tag (D13: never by type or subtype; anything carrying the tag answers). The same record and the same sheet give the same bytes, so a plan IS the house it promises.
- **An invalid plan cannot be minted.** The pen obeys the builder's own law: the mint runs the same validators, and refuses in voice — the sealed pocket, the interior window, the stair, the way out, the zone that promises more open tiles than the plan holds (with the numbers).
- **Designing is work done somewhere.** The SCRIBE'S TABLE (D12) is a craftable, placeable, generalist writing station — [E] opens the design surface; the same table is where scrolls and documents will be written when they come. The mint and every copy are paid in PAPER AND INK (D14): paper pressed from planks, iron gall ink boiled from gallpods and raw iron. Scarcity comes from labor and materials, never from burning drawings — a plan is never consumed by use.
- **The architect's name travels with the house.** The author is fixed into the plan at design time and rides every copy, every resale, and the standing building: the inspect card reads the plan's name and its architect from the street and from inside. Your face from your certificate, your house from someone's signed hand.
- **A house of one material is known.** D13's expansion: a building raised fully of one material is detected and recorded on the room and said on its card. The set bonus's numbers land with the materials pass, where properties reach bonuses.
- **UNDER CONSTRUCTION is a state the street can read.** The scaffold blocks exactly what it draws, and the building rises solid from the ground as steps complete — progress by shape, forward only, no words needed. After the shell stands you can walk in and watch the interior fill, outline by outline, in the plan's own order.
- **Template thumbnails are the plan itself.** The item's art is the composed room, downsampled — real atoms through the one composer, never an icon.

Settled by the load-out pass (Wave 10C), kept here as the record:

- **The body is a tree, and position is the code.** Wave 4's three buckets became fifteen named positions plus dedicated TOOL slots — tools ARE the extraction, used from their own slot, never swapped for a sword. The paper-doll on the Agent tab draws the body from the same atoms: the head column runs down the middle, hands flank it, jewelry sits right, tools stand apart. A cognitive frame holding a position is a hollow diamond — its TYPE coded by the structure inside (ruled traces, chevrons, facing points), never by hue — so mind reads apart from matter in grayscale by shape alone.
- **The head budget is a stat law, not geography (D22).** HEAD, EYES, EARRING and NECKLACE each hold gear OR a frame, three frames at most. Mental stats come ONLY from frames — a stat law and a bank law, not a dress code (Pedro's correction, 2026-10-31): gear has no pathway into the mind, so legacy contraband like the "Silk Robe of the Owl" (+intelligence) wears fine and its mental line is simply dead. `validateStatPartition` stays as the validator 10E's banks inherit. And mental stats drive the recon survey: the framed analyst's one click read a sector to the full manifest where the bruiser's click read only the biome.
- **The limit is the haul, not the harness.** Equipped gear leaves the pack grid and weighs nothing against the carry cap; what you HAUL still counts, step for step. Bags extend the cap. The belt opens pouch slots; a pouch stacks only what its rule names, and quick-use fires from the belt by digit key with the pack never opened — mid-fight, as intended.
- **Refusals carry the numbers.** Every slot says why it refuses ("HEAD takes a helmet. Signet Ring does not sit there."); every unmet requirement says both numbers ("Refused: Great Helm asks STRENGTH 3; you hold 1."); the fitting list shows the refusal beside every ineligible item instead of hiding it.
- **The sheet is blind before study (D19, reaching back).** An unstudied affix shows NO stat on any card or sheet — and acts in full. Equip at your own peril; the screen never learned the bad habit.
- **Protection is never a rule; it is a named magic (D21).** A slot marked protected survives the death — exactly that slot, nothing more — and the DIED receipt says KEPT BY MAGIC, item by item, naming the charm. Marks are spent by the death. Frames survive it free: mind is not loot.
- **The cart is a place in the world (D16).** It unfolds from a packed kit, carries a bed bigger than any pack under its owner's signed seal, tows at a real pace cost, and STAYS — across your death, across an extraction without it. Anyone may take the tow bar; the menu warns, and the theft lands in the cart's log signed by the thief's own certificate, the owner's claim intact. Towed into the beacon, its bed banks with the haul and the kit folds home. Carriers are a first-class way to play.

Settled by the anatomy pass (Wave 10D), kept here as the record:

- **An item knows what it is made of.** Every mint carries its composition: the root materials with lawful origins (a harvest, a purchase, an improvisation, the world itself, a finished shell, a salvage), the transformation chain step by step with each step's labor, and the depth of the route. The card says it plainly — MADE OF, CHAIN, LABOR — and a raw thing says its origin in voice: "Torn back out of a wall."
- **The chain is the power budget, and the floor is on purpose.** A stone and a stick lash into the crudest weapon the game can make, with no bench, anywhere, including mid-extraction — and the long route beats it: the same law that prices an item powers it, so time invested in the chain IS the balance law. Improvised gear says "(no bench)" on its record.
- **Labor never destroys value again.** The 10D audit found six of eight chains worth less than their inputs; the price law is now atoms + labor × the rarity of the route, monotonic in chain depth. The ingot is finally worth more than its ore.
- **No two rolled items are ever exactly the same (D18).** The bank's registry claims every rolled tuple at mint; a collision nudges the later roll by a whisper, deterministically, and the first keeps its claim forever. Commodities stay fungible by design — a plank is a plank; its uniqueness is its provenance. Buying twice from one shelf listing mints two distinct items, each on its own rung.
- **One quality law.** Everything sits on the gear scale (−0.2 to +0.2); 0 means no roll was taken; the dead `quality: 100` and the never-used commodity `purity` are retired. Quality reaches value, and the card shows the row only when a roll or a bite moved it.
- **Demolition salvages, and the bite is the sink.** Tearing a piece down returns its whole bill as the real material that paid it — at a quality bite of −0.10 per demolition, floored at −0.20. Build-and-tear grinds materials toward Crude; permits and shells never return.
- **A house of one material pays its bonus now (D13's numbers).** The set bonus derives from the material's own properties — hardness and density stand the house cheaper (upkeep discount), conductivity runs the bench faster, luminosity brightens the rooms — and the plaque says the numbers.

Settled by the affix pass (Wave 10E), kept here as the record:

- **The bank grows by batches, and a batch is lawful or it is nothing.** Content enters as signed, versioned packs: a run banks NAMES themed to a biome; a later run defines their EFFECTS; one broken entry refuses the whole batch, clean siblings falling with it. A bank entry starts as a name and does nothing until its effect is written — the game starts nearly empty and grows because content is added. That is the design, not a gap.
- **D22 binds the banks, and the Owl stopped rolling.** A mental stat rides only an entry scoped to frames alone; a batch that puts mental stats on physical gear is refused whole, in voice. The legacy pool is purged — no new mint carries a mental affix on gear — while the standing contraband wears on with its mental line dead, exactly as 10C left it.
- **The pin is the one-way door.** A world carries its content-pack version from mint, forever: its drops, chests, harvests and sector readouts derive from (seed, pinned version), and no later batch changes them. Older worlds read "minted before the banks" on their card and dream nothing new. The hub's shelf, by contrast, stands on the bank's latest law — worlds are records; the shelf is a market, and it grows.
- **Knowledge gain IS the mechanic.** An unstudied affix shows nothing anywhere and acts in full — the bought blade really does carry the downside its sheet cannot show, because the banks price upside in downside (negative offsets are the tag). Identify is a skill with a scope: study a type at a workstation, time and again, and the field obeys — always on a clock, faster with skill, never free. Study reveals exactly what was banked, the minus signs included.
- **The survey reads the dream.** A deep scan names the themed signatures running in a sector's ground — "The Seed is still dreaming. These names run in this ground." — fixed at the world's mint, different sector to sector. The lore wrote this law before the code did.
- **The magic says what the death keeps, and it is an item.** The Clasp keeps one chosen slot once; the Knot keeps three of its own choosing; the Scroll of the Kept Hand holds one slot for an hour of the clock and lapses with the ink. The DIED receipt reads KEPT BY MAGIC, item by item, naming the charm. Scrolls are written at any scribe's table for paper and ink — the table was always meant for this.
- **The theft risk grew its locks.** Security affixes live in the CART theme: a Warded cart costs the thief ten seconds a lock before the bar gives (the owner pays nothing), a Shrieking cart says the thief's name across the field, and the broken lock lands inside the signed theft. Of Seven Locks is still only a name. The banks will give it teeth.
- **A making remembers its makings, and a master signs.** Components carry their affixes onto the item they make — a dreamed material is worth crafting with — and the partition holds even here: a mental component affix never lands on gear. At rank S the bank lends its pen: the maker writes the name, and the name is the item's forever.

Settled by the raw materials pass (D23–D26), kept here as the record:

- **What comes out of the ground is usable, and what work adds is real.** A log and a dense stone raise a wall as they are. Pebbles do not. A process takes a material further and leaves something behind: a bonus, an affix, a suffix, on gear, on furniture and in the walls. The raw thing has none of it; that is the difference, and it is the whole reason to mill a log.
- **A raw house reads by shape, in grayscale, from the street.** Logs lie in long unbroken courses with a dark seam between them. Raw stone is rubble, each lump its own tone between hard joints, plainly not the fine stipple of a cut block. A raw building has no window band: its first window waits for glass. Worked materials keep the fine grain they always had, and every room standing before this composes to the same bytes.
- **The first bench is owed to everyone.** With no bench anywhere, a workshop asks only for walls; the button says the metal line waits for the second. The rule reads the world, not a flag, so nobody can lose the floor by selling their bench.
- **What a step adds comes from a pool, and rank and rarity open more pools.** Seven trades, four tiers, ranges on every number, downside among them. Each number is rolled once and kept, and the same record comes out on every machine. An addition never moves the price: the chain sets the worth, and what a Green-Cut plank is worth is for players to work out.
- **The same addition is two things.** It has a gear half and a room half. In a blade it is an edge; in a wall it is a lower upkeep or a faster bench. It acts studied or not, and the bench button still says 10 seconds while a job takes 9. The sheet is blind; the clock is not.
- **Knowledge comes through play, three ways, into one ledger.** Sit with a piece at the bench and it opens, exactly as rolled. Read a trade's notes, off the alchemist's shelf or out of a chest in a world new enough to hold them, and that trade's common tier opens. Or do the work: a first attempt teaches nothing, a practised hand knows what common carpentry leaves behind, and the feed says when. "The actual knowledge is through play."
- **Every material earns its place, and a bar says so.** Each raw thing takes a process or is eaten; each good has a way out; a fresh origin can reach all of it. Grain presses into straw paper, pebbles flux glass, scrap melts down, shards melt whole, titanium draws into a bar. The sapling alone waits, for the farms.
- **A later bench is not this pass's business.** After the first, stations come from tool and material connected, which is the technology web.

Settled by the web pass (D27–D30), kept here as the record:

- **A skill is the tool and the thing it worked.** An axe on a log is Felling, on every machine, in any order of arrival, and nothing but that pair can make it. The bare hand adds nothing, so a hand skill is the material itself, and it sits under every tool skill that works that material.
- **Nobody learns on the spot.** You wing it, and the card says so: 12 energy, not 8, "winging it". A bench button shows the longer clock. It counts, and it settles only when you stop: the seal, a death, a withdrawal. The receipt reads IT SETTLED, or says nothing. It might not settle, and reloading will not change that; only more work buys another chance.
- **What your hands know reads by shape.** Four notches, filled, name how far: named, handled, graded, attuned. A skill still forming is a broken outline that fills. Neither carries a number, and the fill never says how far is far enough. The Agent tab lists only what is held, so nothing closed is ever named.
- **Knowing more shows on the card.** A stranger to a log reads its name. Handled, its density and hardness. Graded, what it becomes. Attuned, what can land on it unseen. All of it files in the one knowledge ledger.
- **A further bench is a fitting.** Once a tool and a material are connected, the next workshop can be raised as a Sawpit, a Bloomery, an Anvil, and the button says the extra bill. Bigger technology asks for a bigger room. A station's work wants the verb in your own hands: "wants hands that can hew", said in words, not only on a hover.
- **The web belongs to the hub, the exp to the person.** What anyone here has reached opens for everyone here, and someone is on record as first. The credit is a signed ledger row, and lore.
- **Tags are law.** Every tag has one kind and one meaning in one registry, a variant spelling is refused, a retired spelling is never reused, and a batch that breaks any of it falls whole. Nothing caps what batches can add.
- **People have hands.** Someone met in the field has stats and skills dealt from their own seed, the same forever, read through the same web as yours. You learn what they are good at by talking to them: the card says Hands after the first word. A bond carries the person home, and Wave 11 puts them to work.

Settled by the timer pass (line 124), kept here as the record:

- **A wait says it is a wait.** Pedro: "many of the waiting mechanics feels like the game froze." The game was never frozen: world generation takes 4 to 77ms. It was silent.
- **Two shapes, because there are two kinds of wait.** A known end is the same stepped bar as vitals, filling toward it, with the time left. An unknown end is one block walking that track, with the time passed, and never a percentage nobody can know. They read apart in grayscale, by shape. Reduced motion holds the block still and the count still moves.
- **One place in the field.** Waits stand in a strip above the hotbar and climb over the sheet when it opens, so none hides in a window that can close. What works on your own body stands beside the vitals. A busy hand is a hatch draining over its hotbar cell.
- **A gate is a cycle, not a number.** The world card has a ribbon of the whole cycle: open is solid, down is empty, booting is hatched, with hard seams and a notch where it stands.
- **A load that cannot finish says so.** A boot that fails stops counting, says why, and offers another avatar.

Settled by the usability pass, kept here as the record:

- **The art and the voice did not move.** This pass changed how things are used, and it added no new art family: the minimap and the body's silhouette are drawn from the atoms already approved.
- **Firing and acting are two inputs.** The button on the ground fires, held or tapped, and opens nothing. E acts, here and in the city, and says above the hotbar what it would do.
- **Valid and invalid are a seam.** A ghost has a solid outline or a broken one, in the same ink, over a clean fill or a hatch. In-hand and empty read the same way: a solid frame and a mark, or a broken outline.
- **A comparison reads by column and mark.** This piece, the worn piece, ▲ or ▼ and the difference. Up means more; nothing says better, and no hue does. What is unstudied stays out of both columns, so no difference can give it away.
- **Marks on the minimap are shapes.** A cross for you, an X for what can hurt you, a hollow lozenge for an exit, a dot for anything else. What has not been seen is static that knows nothing of the world.
- **One sheet, everywhere.** Tab shows who you are, what you wear and what you carry, side by side, in the field and at home alike, and the game goes on above it. The tabs left the bar: the city is the way to every other screen, each with a way back.
- **Reading is a gamble in the field and a sure thing at the bench.** Anyone may try: energy up front, a clock, no odds shown, and the price is yours, never the piece's. A miss costs only what you paid. The eye that gets it right is earned by trying.
- **A signal says nothing.** What has not been read has no name, no rank, no slot to compare against, and the same four buttons as any other. It won't unfold or be spent until read.
- **A heavy step asks; a stray one does nothing.** A sale takes a second press, and the armed button changes shape. A draft ignores the backdrop, and asks in voice before Escape can lose it: "The draft is unsigned. Abandon it?"

Strong, and worth keeping: body plans from tags, the seven property grains as a family, avatars from certificates and seals from signatures.

**Four things the atoms must answer.** The prototype has tried each, so start from what it found and beat it.

*Status: the tree's blocking was settled by D1 and D3 (Wave 8B). Quality became one scale, and `purity` was retired (Wave 10D). The inspect card reached the pack, stash and shops (Wave 9). The text below is the original finding.*

- **Trees.** The game has one definition, `Hardwood Log`, for both the standing tree and the 1×3 log in the pack. The prototype gives it two forms: a canopy from above, six times a berry's area, and a log at its real footprint. Each of its three fellings bites the crown, ending in a stump, since a tree never regrows. Every other depleted resource also has its own state in place of today's fade to 35% opacity: a broken outline if it is gone for good, and a live center if it will return. Two things need a decision, not art. Forests now grow in Overgrowth, at about 112 trees a chunk. One thing needs a decision: **you walk straight through a tree**, because only terrain blocks movement. Say whether a forest should block, because that changes what it is.
- **Materials.** Properties are the core of the atoms, yet no player can see one: no tooltip shows them, and `MaterialScience.inspectMaterial` has knowledge levels that nothing calls. The prototype draws those levels. At level 0, things of one form share every pixel, so Iron and Titanium are identical and Amberfruit cannot be told from the poisonous Gallpod. Naming reveals density, and study reveals the rest. Consider the consequence: a new player knows nothing, so at first every ore looks the same. Decide what a new player starts knowing, and how this relates to `isIdentified`, a separate flag that resources skip. The grain scale is fixed and versioned, because deriving it from data would change old worlds whenever a material arrived. Density and Conductivity sit on a square root because their ranges are so wide. Those multipliers are the prototype's own choice, so review them. No real material has Resonance, so its grain has only been drawn from invented values. The affixes `Compressed`, `Volatile` and `Ley-Touched` are never rolled and their numbers are ambiguous (additive or multiplied), so the prototype only marks them. Gear has no material data at all, and `gearMaterial` proposes a profile from tags.
- **Quality.** Gear rolls −20% to +20% at creation, which scales its stats and item power, and nothing reads it afterward. It only surfaces as `Broken` or `Superior` in the name, past ±15%, and one line of description, past ±10%. Resources and deeds store `quality: 100`, on a different scale, which the prototype treats as no roll. Commodity `purity` is defined and unused. `Broken` as a low-quality name also means something other than the `BROKEN` shown at zero durability, so the card says `Crude` for the first and keeps `Broken` for the second. The prototype puts each fact in its own place on a real pack footprint (36px, 18 atoms a cell): rarity in the frame, wear as bites from the middle of the frame, quality in the fill and plate, rank in its mark. An unidentified item shows only noise, and hides its rank, which today's Bank does not.
- **Hover.** Today there are four unrelated behaviours, and things in the field have nothing at all. The prototype has one card format for world things and items. The proof page's map is live: hover anything, or press Tab to step through what is near, nearest first, and C for the compact form. Item cards are only shown open, so hover in the pack is untested. Whether you can act is asked of the game's own `InteractionEngine`, and the card only explains the answer (`Needs pickaxe, drill or impact hammer`, `Move closer`). It reveals only what your knowledge level allows. A target stays selected while it is under the cursor, so the card does not flicker as things move. Design its real form, including copy for raw values such as `SWARM`, and carry it to shops, map sectors and lots, which the prototype does not reach. It answers the "why isn't this offered" moment below.

**The people and the city.** Both pages use real data. Start from them, and beat them.

- **A character is three things.** Archetype sets the silhouette family: Operator has a pack and antenna, Street Samurai angular shoulders and a topknot, Nomad a hood and cloak, Arcanist a robe and halo. The certificate id decides who you are inside it, so nobody can choose your face and you cannot lose it. What you carry changes the outline: five held shapes cover every real weapon and tool, and armor class changes the body. There are four facings and two stepped walking frames.
- **Only you are drawn in signal.** You also carry four corner brackets, the machine marking its subject, so you can be picked out by shape in any world and any palette. The named cast uses the hub's life ramp, each with their own silhouette and portrait.
- **The hub is the real layout.** Zones, footprints, lamps and the rules for walking and talking all come from `HubGenerator`, so what looks solid is exactly what blocks you. Each district has its own floor, each kind of building an emblem readable without words, each door is real, and the lots show their real states, plus a foreclosed mark for the moment a lot reverts. Its warmth is its own ramp, lit windows and lamplight at each lamp's real radius, which also shows as brightness, so it survives without color.
- **Signs are made of atoms.** A 3×5 typeface sets every name in full, so `The` can never again stand in for three buildings. Signs hang above the roofline and may overhang the street.
- **It needs a tile of 20px, not 16.** The game's hub uses 16px and its field 20px. At 16px a two-word name does not fit on a building. The game now uses 20px, matching the field.

## The emotional arc to design

Certainty in the bank → cold curiosity over the survey → exposure in the field, where the screen should feel smaller and louder → held breath during the 5-second channel at the exit → the weight of the seal, or of the loss → warmth back in the city. Each screen below belongs to a step in this arc.

## Screens: design all of them

Every string in `code style` exists today. Rewrite anything that doesn't carry the voice. Screens are desktop, 1024px wide and up.

**1. Identity.** First contact. Fields: codename, one of four archetypes with attribute bonuses (`OPERATOR`, `STREET_SAMURAI`, `NOMAD`, `ARCANIST`), the button `MINT IDENTITY CERTIFICATE`. A second path restores a backup: file, passphrase, `RESTORE AVATAR`, plus refusal states (`wrong passphrase`, `digest mismatch`). This is birth; make it feel like it.

**2. Boot.** `INITIALIZING GENESIS PROTOCOL...` for a few seconds. Include the refusal state shown when a save fails its signature check.

**3. Hub selection.** Search and a card per hub: name, rank, population, description, `MATERIALIZE`.

**4. Application frame.** Currently a header (wordmark, `ONLINE`, console toggle, backup button, gold, name, user/dev switch) and a sidebar: City Hub, Mission Control, Bank / Stash, Holdings. Decide how much frame should exist at all, given a walkable city is also the navigation.

**5. The city.** Top-down, walked with WASD; it's 50 tiles wide with zones like `Central Plaza`, though about half of it is empty ground outside any zone, walkable and unnamed. Decide what that is. Today it's flat colored rectangles. Contains the Consortium bank, Truthsight's analyst, the portal, Ironfist's arms, Steelweave's armor, an alchemist, the guild hall, the auction house, the Rusty Anchor tavern, a fountain, lamp posts and six purchasable lots. The game defines `STATUE` and `ARENA` types but builds nothing from them; add them if the city wants them. Includes the `[E] Interact` prompt and a dialogue window with portrait, greeting and options. The cast has names and lines: Marcus Goldweave, *"Your assets are secure with the Consortium."* Old Mags, *"We got drinks and rumors, both equally watered down."* The Conduit, *"The threads of reality await."* Also shop lists: item, stock, price, buy.

**6. Mission Control.** A card per world: name, rank, sector, creator, agents, a large countdown (`TIME UNTIL REALITY COLLAPSE`), `DEPLOY`. Plus the four-step world creation flow: Concept, Laws, Economy, and Sign, ending in `SIGN & MINT WORLD`.

**7. Bank.** Identity panel, cognitive frames (three slots from six, such as `Analytic Engine`, `Grey Man`), fifteen attributes grouped as Hardware, Software and Wetware, a searchable skill list, and the stash grid with item tooltips.

**8. Holdings.** Stash with Carry and Sell on each item. Lots with their states: for sale, redeem a deed, build, Workshop with recipes and timers, Vendor with listings and money to collect. Bank and Holdings overlap badly today. Unify them if that serves the player better.

**9. Recon survey.** The world from above as a fogged grid of up to 64×64 sectors, each 512×512 tiles, about three minutes' walk across. Each click deepens a scan: biome and threat, then contact counts, then a full manifest. Beside it, the sector intel panel and `CONFIRM DROP`.

**10. The field.** The heart of the game. Your character in a live world, seen from directly above, with:
- Terrain: ground, mud (slow), water and rock (blocked), across five biomes
- Up to about 300 things on screen: enemies, resource nodes, ruins, chests, ground caches, NPCs, exit beacons, dropped loot, projectiles from both sides
- Vitals, energy, load, and distance to the nearest exit
- The radial or popup action menu on an object: harvest, open, talk, give gift, secure
- The exit control: distance, then `EXTRACT (5s)`, then the channel state
- The pack: an 8×6 grid where items occupy real shapes, rotate, equip, get used, and get left behind, with weight and a `SLOWED` state

**11. Console.** A developer log that slides up on `~`. Keep it in the world; it's the machine talking to itself.

**12. Genre Creator.** An admin tool for generating content. Lowest priority. It only needs to inherit the system.

## Moments that have no UI yet

This is the most valuable part of the job. These all happened in the game when this was written, but most only appeared in a hidden log or not at all. Design each one:

| Moment | When written | Now (2026-10-31) |
|---|---|---|
| **Sealing a haul: the signed receipt after a successful exit** | Silently returns to a menu | Built: holds the screen (Wave 9.6) |
| **Losing everything: the `DIED` receipt** | Silently returns to a menu | Built, with KEPT BY MAGIC (Waves 9.6, 10C) |
| Hitting and being hit; enemy health; low health | Almost nothing | Built: brackets, burst, pips, the hurt edge (Wave 8B.5) |
| Channel interrupted by damage | Button quietly reappears | Built: a feed line |
| Pack refuses an item, or overflow lands in a cache | Log only | Built: a feed line |
| Why an action isn't offered (wrong tool, too far, no energy) | Nothing happens | Built: the inspect card gives the reason |
| What was just harvested | Log only | Built: a feed line |
| Which direction the exit is | Distance only, no direction | Built: bearing on the beacon chip |
| Reading a lore fragment | Tooltip in the Bank only, and it's the best writing in the game | Built: the stash and the Study window |
| An NPC reacting to you | A number in a button label | Built: a feed line |
| Securing an NPC for escort | An item quietly appears | Not designed as a moment of its own |
| Viewing your ledger, your receipts and an item's history | Not visible anywhere, though it's the core of the fantasy | Ledger tab with audit (Wave 9.6); the card shows MADE OF and CHAIN (Wave 10D). No view of a provenance chain or past receipts yet |
| Craft finished, lot foreclosed for unpaid upkeep | Log only, or a timer you must watch | Craft finished: built, a feed line and a bar in the strip (line 124). **Still open:** a foreclosed lot has only its mark in the hub's art |
| Unidentified items | Blur and a `?`, with no explanation | Built: noise art and the blind sheet; study reveals (Waves 9.4, 10E) |

## Leaders and the ground they hold

**Status, 2026-11-01: a design by the builder, nothing built, awaiting Pedro's word.** His ruling: elite and boss "are leader types ... they strategize (AI = LLM defined actions) and direct the flow in a given territory. parties should be necessary to kill one (think a goblin king... killing it is the easiest part of the raid). Their territory once seen gets marked as the maps feature, and it evolves", and the industrious type builds its territory up over cycles.

**What the donor does.** `D:\-ttrpg-engine\engine\monster-actor.ts` and `mm-monster-actor.ts`: one actor per camp, ticked monthly. A leader emerges after four weeks of a gate overflowing (`dungeon-gate.ts`). It picks one of six actions, survival first: raid, expand, fortify, recruit, hunt, migrate. A d20 plus its rating and tenure grades the month, and the grade moves population, food, gold and danger radius. A bad month opens it to a leadership challenge, and a loser who walks away seeds a new lair. Its danger feeds the guild's quests. `mm-faction.ts` and `intent.ts` add a leader whose drives bias what its people pursue.

**What changes here.** No model runs in the donor: code picks from the list. Here a model writes the plan and the law judges it. The donor's camp is a number; here it stands on the land, and a person can walk in, scan it and map it. The donor's clear is one roll of party strength against a number; here the party is needed by the shape of the place.

### Who leads

Pedro, 2026-11-01: "elite is a pack leader, MAY BE industrious prior to having set up a base, or simply a pack leader, Elites aren't AS RARE, they're a rare in PoE that has a pack. They're tougher, but aren't unsoloable. they eventually become bosses if you die on repeat to them, afterall when the world closes the ledger for what happened during it being opened levels up the mobs."

- **Elite: a pack leader.** Tougher than its pack, and one person can bring it down, so everything under "Why it takes a party" is the boss's alone. It holds no ground and has no map mark, and it moves with its pack. An industrious one carries its trade with it and has no base yet.
- **Not as rare, and not alone.** R4's rule in `WorldGenerator` (`ELITE_WEIGHT`, a count of one) stays for boss, titan and god and comes off elite, which stands at the head of a pack of its own kind. A world rolls its elites at the mint: a keyed roster by sector, so "this world has three" is known without building a chunk, and a regeneration can walk them without building the world. Adding them moves `GOLDEN_VECTORS` and `FIRST_THEME_VECTORS`, on purpose. The first theme holds no plain elite today, so it needs some written.
- **Only a social species leads.** Pedro: animals get leaders, "but that requires the species to be social, think of a pride of lions." So a pack says `social` on each creature, in both trees, because a pack leader needs a pack. In the first theme a stag can lead its herd and the Compound Bear walks alone. A new field moves that theme's bytes again, on purpose, the same way the trees did.
- **Boss: the seat of a territory**, one to a territory, with a base. Titan and god stay one of a kind and lead nothing by those words alone.
- **Elite becomes boss when people keep falling to it.** The world's ledger settles when it closes, and what happened while it was open levels up its creatures. That is the Director's record, settled at the regeneration, and this is one more thing it decides. Repeated means the same elite brings people down across a formula's count (a guess until Wave 12), with no roll and no model. It stays where it stands, takes that ground as its seat, and its pack is its first band. An industrious one starts building, and any other holds the ground as it is.
- The tally needs one change: `reportToDirector` hears only a kind today, and this has to name the body too. A kind stays a kind (D64). A leader is the one body the record holds by itself: its kind, its tally, then its seat, tenure and stores.
- A world is alpha as minted: no record, no territory. Land and alpha bind the vectors as they do now.
- Names keep D60's rule: boss qualifies as one of a kind, elite does not. Until a leader has earned a name, its ground reads as an unknown holding.

### Sheets and goals

Pedro: "elite and higher mobs have goals, they get a cycle to complete it, if no player sees them we roll for the goal's completion, and we need them to have stat sheets, their villanous npc types. the goal is set up when we generate, so a world generated that rolls 3 elites at the start needs each to have their own goal, that comes from the skills that were assigned to it and the species behavior."

- **A sheet, by the door people already use.** `NpcSheet` deals stats and skills from (seed, body, pinned web) at read time, and stores nothing. An elite or higher reads through the same door, so its sheet comes back byte for byte on every machine and no later batch can change it. Its toughness comes from that sheet, through the formula.
- **Its villain's nature:** beside the stats it gets a temperament and a drive, keyed the same way. The donor's drives in `intent.ts` (power, wealth, safety, revenge, legacy and so on) are where to start. The drive says which goal it prefers, not which it may take.
- **A goal, from the moment it exists.** It is dealt from the same seed, so a world that rolls three elites has three goals at alpha with nothing stored. Skills and species say what it may want, and its drive picks among those:
  - `settle`: raise a base. Takes a working skill on the sheet and a species that builds.
  - `grow`: more bodies in the pack. Any social species.
  - `take`: hold more ground, or the ground of a rival.
  - `hunt`: feed the pack. Reads B2's food.
- A goal is a word with a reader, like an effect or a verb, so the list grows as readers are written. A model may name a goal and, in the scan window, propose the next one for a leader someone has seen. It chooses only from what the sheet allows. The first goal is dealt, never asked for, because generation calls no model.
- **One cycle to do it.** At the close, for each one on the roster:
  - **Nobody saw it:** a keyed roll, the d20 plus its sheet against the goal's band, graded as the donor grades a month.
  - **Someone saw it:** no roll, because what a person saw must stay true. It finishes if it still stands with most of its pack, and fails if they stopped it. So a person can really prevent it. Seen means read by a scan or within sight in the field, and the ledger has to record that.
  - **Next:** done, it takes the next goal from what it now is. Failed, it may try again, keyed.
- **`settle` is the second road to boss.** A finished base is a seat, and a seat makes a boss with nobody having fallen to it. Repeated falls stay the other road, and both go through the same record.

### The cycle

At each regeneration, compute first (D69):

1. **Compute** reads what the territory holds and what happened to it, and rules what is possible.
2. **The model** is asked only for leaders someone has seen or fought, in small batches across the scan window. It answers with a plan: `{ verb, target, name, why }`, plus standing orders. It names and aims its actions in this world's voice, and the numbers stay with the formula. A verb with no reader is refused (the law's rule), so the list grows only as readers are written: claim, raise, muster, hunt, raid, migrate to start.
3. **No key, or no answer:** the donor's rule picks instead, keyed. The world keeps growing, on plain names, and nothing blocks.
4. **Resolve:** a keyed roll plus rank and tenure grades the cycle. The formula turns the grade into what is gained. A bad cycle opens a challenge, and a loser who walks seeds a new territory on other ground.

Cycles nobody watched are folded one at a time, as the donor's clockwork folds months. This differs from the Director, whose unwatched regenerations pass as one, because growth over time is the point here. Each step is pure and cheap, so every machine agrees. The territory joins the signed root beside the living lines.

### Directing the flow

No model is called during play (D46). A plan becomes standing orders that the bodies read: which ground each band holds, whether a post that raises the alarm calls bands in, and the leader's posture (hold, sortie, fall back to the seat). Sight and noise are A5's; herding and moving between chunks are B2's. Orders sit on top of those.

### Why it takes a party

This is the boss's, never the elite's. Not health: a boss's health stays ordinary for its rank, because reaching it and leaving are the raid.

- The seat is warded while its **anchors** stand: posts spread across the territory, whose function is `anchor`. A boss whose species builds nothing has no posts, so its anchors are bodies: the eldest of the pride, each holding its own ground. The rule is the same either way.
- A broken anchor relights after a window, unless all of them are down. The formula sets that window **shorter than the walk between them**, from the real distance. One person cannot be in two places, so the requirement holds at any strength and needs no cap.
- How many anchors comes from rank, and never fewer than two, so every boss asks for more than one person. Building more is a thing a boss can plan.
- When the boss falls, the ground does not clear itself. The alarm is up, the bands are still there, and the challenge decides who takes the seat next cycle, or the territory splits. The payoff is its stores, which must be carried out through all of that.

Parties do not exist yet. NPC adventurers (D76, stream C2) are the first time anyone can stand at a second anchor, and the served runtime is the second. Until then a boss simply cannot be brought down, though every elite can. So a person who keeps falling to an elite makes something they cannot yet remove: that is the ruling's own consequence, and it is worth watching in the playtest.

### On the map, once seen

- A scan or a walk that reads a territory's ground records a `holding` on the survey entry: which chunks, what stood there, at which generation. Nothing marks it before someone has seen it.
- The recon view draws it as hatching with a hard seam at its border, and structures as marks by shape, never hue.
- It decays as D68 says: the land keeps, the holding goes stale, and a reading says how long ago. Territories grow, so a stale border is a real danger, and a fresh map of one is worth more (D85).
- A written map carries the field through `mapSheet` (A3), by name, so a later field cannot ride along. The guild's quests read territories as the donor's read danger (B4).

### What the industrious build

- **Industrious** means a body, not a kind: its sheet holds a working skill and its species builds, which a pack says by a `builds` word beside `social`. Others hold ground and build nothing, and that includes every animal leader. Its pack works while it is an elite, and building begins at the base.
- **D62's answer:** an elite on `settle` goes looking for ground holding what its skill works, and raises its base there. One made a boss by repeated falls has no such choice: its seat is where it stood, and its skill works what that ground holds.
- A structure is a function with a reader, plus words from the model: `watch` (sight and alarm), `wall` (blocks), `store`, `works` (makes what its bodies wear), `muster` (more bodies), `anchor`, `seat`. The formula sets the bill, by tag and rising with what already stands. Food and stores are the limit, not a count.
- It builds on the hub's own contract: `ITemplate`, `templateBill`, a building under construction across cycles, walls drawn from the material that paid for them. Loggers raise log walls and miners stone. A scan shows scaffolding, and a raid can stop it mid-build.
- Territories are a record over the land (D66), read by a chunk the way it reads the Director. The land stays a pure function of the seed.

### Where it goes in the plan

Elites with packs belong with B2, which owns `WorldGenerator`; the vectors they move need the coordinator's word, since the trees stream held them in Wave A. The rest grows C3, settling by trade: needs B2 for population and movement, A3 for maps, B1 for the window. Anchors can be tested by script earlier, but only played once C2 is in. Bars to register first: an elite stands at the head of a pack, and one person can bring it down; only a social species leads; a sheet and a first goal come back byte for byte from the seed, and nothing is stored for them; a goal never asks for what the sheet lacks; unseen rolls, seen does not, and a person can stop a goal they saw; `settle` and repeated felling both make a boss, on the record; territory is pure and keyed; two machines agree after folding; a plan's verb and bill stand before the law; no key still grows; one body cannot clear two anchors at any strength; a person reads only what was seen, and it goes stale; land and alpha stay what the vectors say.

### Taken by the builder, for Pedro to overrule

1. A goal someone saw is decided by what happened, with no roll.
2. Social binds monsters too, so a solitary monster never leads a pack.
3. An animal leader builds nothing. Pedro said yes to animal leaders, and "building nothing" was the builder's half of that question.
4. A finished base makes a boss.

## The design system to deliver

- **The atom sheet and the rules:** every family above, plus the composition rules written precisely enough that a developer can implement each as a pure function.
- **Machine color tokens:** the existing roles are emerald (`#20de81`), gold (`#ffd700`) and void black (`#050505`–`#27272a`). Keep or evolve them, and define semantic roles. Replace the ~70 hard-coded colors scattered through the screens. World ramps stay separate from these.
- **Type:** monospace is the foundation, using system fonts today. Choose a real typeface pairing and scale, or a pixel face built from the atoms if it stays readable. It must set dense numbers and long item names well: `Reinforced Superior Woodsman's Axe of the Whale`.
- **Proof of coverage:** show the rules producing all of this, replacing every emoji: nine enemy types from tiny to colossal, every resource (grain, berry, fruit, poison fruit, fiber, tree, sapling, pebbles, sand, rock, iron, titanium, scrap, glass), structures, chests, caches, NPCs, beacons, item classes and tools. Everything must stay legible at its real size.
- **Rank, rarity, quality and durability:** nine ranks (F to SSS), seven rarities (Scrap to Artifact), the quality range and durability wear, as marks, edges and grain rather than color. Rank is the game's core status symbol, so give it a real mark. Show one item carrying all four at its real size.
- **Components:** panels, buttons, inputs, cards, item slot and the one inspect card, dialogue, tables, progress bars, stamps and seals, map overlays, all built from the atoms.
- **Motion and sound notes:** scan, channel, seal, damage, loss. Provide a reduced-motion version.
- **Copy:** a voice guide and rewritten strings for all of the above.

Settle the vocabulary too. The game currently says all of these for the same things, so choose one word for each and use it everywhere:
- Deploy / Dive / Drop
- Extract / Jack out / Exit
- Bank / Stash / Cache / Secure Storage / Cold Storage
- Mint / Create / Materialize
- Agent / Player / Avatar
- Broken (low quality) / Broken (zero durability)

Use a naming rule from the lore: surnames from function, failure or geology (*Steelweave, Null, Basalt*), first names archaic or astronomical (*Kael, Sera, Io*). Replace **"NerveGear"**, which belongs to Sword Art Online, with an original name. Likewise, draw on the idea of SAO without borrowing its interface.

## What to fix along the way

*Status: all of these are closed. Item art replaced the raw icon text and built lots block (Wave 10.2). Labels hold the 12px floor and one theme (Wave 9). Signs are set in full and survey cells share one logic (Waves 8 and 9). Dialogue options are built or refuse in voice (Wave 9.7). The lots' walk-through question was answered by D8 and D9.*

- Item icons currently show raw text such as `weapon_icon` spilling across the Bank grid.
- **Lots stay walkable with a building on them.** You can walk through your own house. Decide whether a structure should block.
- Many low-contrast labels are close to unreadable on the void background.
- Town buildings show only the first word of their names, so three are just labeled `The`.
- Worlds, biomes and ranks use unrelated colors with no shared logic.
- Many dialogue options and Bank menu items do nothing yet: identify, repair, guilds, auction, rest, rumors, study, and equip from the Bank. Design what the world needs, and mark clearly which of these need building, so nothing looks finished that isn't.

## Constraints

*Status: the first two were overtaken. Screens now use the kit in `src/components/ui/` with `tokens.ts` as the one theme, and Mantine remains only for the admin Genre Creator (D4, D7). The field is on canvas, measured at 4.17ms a frame with 314 things (Waves 8 and 9). Gear now draws from a tag-based material profile (`gearMaterial`). Invented genres still do not reach world generation: `genreForWorld` chooses only among the built-in looks.*

- Built with React 18, TypeScript and Mantine v7, themed through one `theme.ts`. No Tailwind. Layout uses Mantine components.
- The field is currently DOM elements over a 2D canvas, running about 26 FPS. Assume it moves entirely to canvas with cached bitmaps, and that it must stay fast with about 300 things moving. Avoid effects that are expensive per element, such as blur and large shadows. A later 3D version is planned but isn't part of this ask.
- Only resources have material data today. Say what profile creatures and gear need, and the developer will add it.
- Invented genres produce data in the admin tool but don't reach world generation yet. Design as if they do, and the developer will connect them.
- Free to replace: `SpriteGenerator.ts` (round blobs, unused), `modelId` (never read), and the per-item and per-enemy `colorHex` values.
- Sharp corners and a dark, forced color scheme are established.
- No gold-for-real-money or store patterns. Gold is earned.
- Colorblind-safe status, a readable minimum text size, and full keyboard support where the game already uses keys: WASD, E, TAB, `~`.

## What to hand back

One coherent package: the atom sheet and rules as data a developer can implement, tokens ready to map onto `theme.ts`, high-fidelity layouts of every screen and state listed, the unbuilt moments designed in full, the copy, and a short note on any place you changed this direction and why.

Work in this order, and stop to show each step:

1. **The atoms alone:** one sheet, every family, starting from the prototype's sheet and its weak spots.
2. **Three worlds from them:** the same small map rendered in three genres, one of them invented, with the same creature, material and exit in each. Show them in grayscale too, and include two genres the prototype could not separate. This is the moment that proves or kills the system.
3. **The people and the city:** the four archetypes, a dozen certificates, the cast, and New Carleon walked from the portal to the bank. Faces first.
4. **The sequence:** the recon survey, the drop, a fight, the channel at the exit, and the seal. If those five moments feel like one machine with one memory, the remaining screens will follow.
