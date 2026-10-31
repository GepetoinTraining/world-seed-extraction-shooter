# World Seed: the design ask

Design the atoms that every World Seed world is made of, then prove them across the whole game: the smallest pieces of pixel and the rules that compose them into any terrain, creature, item, avatar and screen. The game works. It has no character yet. Give it one, at the level of the pixel.

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
| Status | Rank F to SSS, rarity Scrap to Artifact |
| Identity | Certificate id, and a hash on every signed record |

**The atoms.** These are my starting proposal. Keep them or beat them, but the families must be small and closed:

| Atom | What it is | Starting point |
|---|---|---|
| **Pixel** | The one unit. Integer scales only, hard edges, no anti-aliasing or gradients | 1 atom = 2 screen px, so a 20px tile is 10×10 and a 100px chunk is 50×50. These sizes are fixed by the game |
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
- Pixel → grain → tile → chunk → world. A world's thumbnail on its card is its real map.
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

**What a prototype has already tested.** `prototype/atoms/` computes these atoms from the game's real seeds, creature definitions and material numbers, with no image files. Run `npm run dev`, then open `http://localhost:3000/prototype/atoms/index.html`. Its Grayscale button is the first thing to press. `tests/atoms.test.ts` holds the bars. They were set before each check first ran and were not lowered. It is one map, nine creatures and fourteen resources, with no animation, and it is a working sketch to beat, not art to polish.

| Question | Measured | Verdict |
|---|---|---|
| Same pixels on every machine? | Node and browser give byte-identical hashes in all three genres | Holds |
| 300 moving sprites | p95 0.40ms to draw, sprites plus one background only, not the whole game | Holds |
| Is a 10×10 tile too coarse? | Closest creature pair differs by 32% (bar 20%), and threat vs resource by 28% (bar 25%, 0 of 126 pairs fail) | 1 atom = 2px holds |
| Could the tile be 5×5? | Dragon and mech differ by 18%, under the bar | No |
| Threats against ground in grayscale | Contrast 7.3 for threats, 5.4 for matter, 5.8 for life (bar 3:1) | Holds |
| Is the exit unlike any creature? | Passes against all nine | Holds |
| Do worlds differ in grayscale? | **Hue alone failed: 0% of 10×10 blocks differed between Fantasy and Eldritch (bar 30%).** With structure and a value key: 85%, 82%, and a narrow 33% for Fantasy vs Biopunk Wasteland | Holds, narrowly |

Three findings that change the brief:

- **A genre must bring structure, not just four colors.** A per-pixel test said the worlds differed, while the eye saw one world recolored. A genre now also sets a large ground structure (strata, blotches, lattice or dunes) and a value key (how bright its ground sits).
- **That family is too small, and a hash is the wrong way to choose from it.** Four structures and three keys make 12 looks. Picking by hash puts two of the game's five genres, `POST_APOC` and `RETRO`, on the same look, identical on open ground in grayscale. Among six random genre names, at least two collide in 74% of trials. Widen the family, and have a genre choose its look when it is created, so the choice is stored and two genres cannot collide by accident. This is the largest open problem in the atoms.
- **Terrain that changes how you move cannot lean on a genre's brightness.** Once genres had value keys, mud vanished into dark ground (17% of its atoms differed from open ground, bar 25%). It is now a fixed ripple using only the darkest and brightest steps (46% or better). Hold every gameplay terrain to this law: water and rock already carry hard seams.

Still weak, by eye, and yours to solve:

- **Rank on the map is a speck.** All nine marks are distinct when enlarged, but at real size pass criterion 2 is not met.
- **Dense metals look alike.** Dense Stone, Iron and Titanium read as similar lumps, so pass criterion 3 is not yet shown.
- **Density and Hardness grains** look similar at thumbnail size.
- **Common and Uncommon** rarity edges barely differ.
- **Water** reads as hollow dark squares, not as water.

Strong, and worth keeping: body plans from tags, the seven property grains as a family, avatars from certificates and seals from signatures.

## The emotional arc to design

Certainty in the bank → cold curiosity over the survey → exposure in the field, where the screen should feel smaller and louder → held breath during the 5-second channel at the exit → the weight of the seal, or of the loss → warmth back in the city. Each screen below belongs to a step in this arc.

## Screens: design all of them

Every string in `code style` exists today. Rewrite anything that doesn't carry the voice. Screens are desktop, 1024px wide and up.

**1. Identity.** First contact. Fields: codename, one of four archetypes with attribute bonuses (`OPERATOR`, `STREET_SAMURAI`, `NOMAD`, `ARCANIST`), the button `MINT IDENTITY CERTIFICATE`. A second path restores a backup: file, passphrase, `RESTORE AVATAR`, plus refusal states (`wrong passphrase`, `digest mismatch`). This is birth; make it feel like it.

**2. Boot.** `INITIALIZING GENESIS PROTOCOL...` for a few seconds. Include the refusal state shown when a save fails its signature check.

**3. Hub selection.** Search and a card per hub: name, rank, population, description, `MATERIALIZE`.

**4. Application frame.** Currently a header (wordmark, `ONLINE`, console toggle, backup button, gold, name, user/dev switch) and a sidebar: City Hub, Mission Control, Bank / Stash, Holdings. Decide how much frame should exist at all, given a walkable city is also the navigation.

**5. The city.** Top-down, walked with WASD; it's 50 tiles wide with zones like `Central Plaza`. Today it's flat colored rectangles. Contains the Consortium bank, Truthsight's analyst, the portal, Ironfist's arms, Steelweave's armor, an alchemist, the guild hall, the auction house, the Rusty Anchor tavern, a fountain, a statue, lamp posts and six purchasable lots. Includes the `[E] Interact` prompt and a dialogue window with portrait, greeting and options. The cast has names and lines: Marcus Goldweave, *"Your assets are secure with the Consortium."* Old Mags, *"We got drinks and rumors, both equally watered down."* The Conduit, *"The threads of reality await."* Also shop lists: item, stock, price, buy.

**6. Mission Control.** A card per world: name, rank, sector, creator, agents, a large countdown (`TIME UNTIL REALITY COLLAPSE`), `DEPLOY`. Plus the four-step world creation flow: Concept, Laws, Economy, and Sign, ending in `SIGN & MINT WORLD`.

**7. Bank.** Identity panel, cognitive frames (three slots from six, such as `Analytic Engine`, `Grey Man`), fifteen attributes grouped as Hardware, Software and Wetware, a searchable skill list, and the stash grid with item tooltips.

**8. Holdings.** Stash with Carry and Sell on each item. Lots with their states: for sale, redeem a deed, build, Workshop with recipes and timers, Vendor with listings and money to collect. Bank and Holdings overlap badly today. Unify them if that serves the player better.

**9. Recon survey.** The world from above as a fogged grid of up to 64×64 sectors. Each click deepens a scan: biome and threat, then contact counts, then a full manifest. Beside it, the sector intel panel and `CONFIRM DROP`.

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

This is the most valuable part of the job. These all happen in the game today, but most only appear in a hidden log or not at all. Design each one:

| Moment | Today |
|---|---|
| **Sealing a haul: the signed receipt after a successful exit** | Silently returns to a menu |
| **Losing everything: the `DIED` receipt** | Silently returns to a menu |
| Hitting and being hit; enemy health; low health | Almost nothing |
| Channel interrupted by damage | Button quietly reappears |
| Pack refuses an item, or overflow lands in a cache | Log only |
| Why an action isn't offered (wrong tool, too far, no energy) | Nothing happens |
| What was just harvested | Log only |
| Which direction the exit is | Distance only, no direction |
| Reading a lore fragment | Tooltip in the Bank only, and it's the best writing in the game |
| An NPC reacting to you | A number in a button label |
| Securing an NPC for escort | An item quietly appears |
| Viewing your ledger, your receipts and an item's history | Not visible anywhere, though it's the core of the fantasy |
| Craft finished, lot foreclosed for unpaid upkeep | Log only, or a timer you must watch |
| Unidentified items | Blur and a `?`, with no explanation |

## The design system to deliver

- **The atom sheet and the rules:** every family above, plus the composition rules written precisely enough that a developer can implement each as a pure function.
- **Machine color tokens:** the existing roles are emerald (`#20de81`), gold (`#ffd700`) and void black (`#050505`–`#27272a`). Keep or evolve them, and define semantic roles. Replace the ~70 hard-coded colors scattered through the screens. World ramps stay separate from these.
- **Type:** monospace is the foundation, using system fonts today. Choose a real typeface pairing and scale, or a pixel face built from the atoms if it stays readable. It must set dense numbers and long item names well: `Reinforced Superior Woodsman's Axe of the Whale`.
- **Proof of coverage:** show the rules producing all of this, replacing every emoji: nine enemy types from tiny to colossal, every resource (grain, berry, fruit, poison fruit, fiber, tree, sapling, pebbles, sand, rock, iron, titanium, scrap, glass), structures, chests, caches, NPCs, beacons, item classes and tools. Everything must stay legible at its real size.
- **Rank and rarity:** nine ranks (F to SSS) and seven rarities (Scrap to Artifact), as marks and edges rather than color. Rank is the game's core status symbol, so give it a real mark.
- **Components:** panels, buttons, inputs, cards, item slot and tooltip, dialogue, tables, progress bars, stamps and seals, map overlays, all built from the atoms.
- **Motion and sound notes:** scan, channel, seal, damage, loss. Provide a reduced-motion version.
- **Copy:** a voice guide and rewritten strings for all of the above.

Settle the vocabulary too. The game currently says all of these for the same things, so choose one word for each and use it everywhere:
- Deploy / Dive / Drop
- Extract / Jack out / Exit
- Bank / Stash / Cache / Secure Storage / Cold Storage
- Mint / Create / Materialize
- Agent / Player / Avatar

Use a naming rule from the lore: surnames from function, failure or geology (*Steelweave, Null, Basalt*), first names archaic or astronomical (*Kael, Sera, Io*). Replace **"NerveGear"**, which belongs to Sword Art Online, with an original name. Likewise, draw on the idea of SAO without borrowing its interface.

## What to fix along the way

- Item icons currently show raw text such as `weapon_icon` spilling across the Bank grid.
- Many low-contrast labels are close to unreadable on the void background.
- Town buildings show only the first word of their names, so three are just labeled `The`.
- Worlds, biomes and ranks use unrelated colors with no shared logic.
- Many dialogue options and Bank menu items do nothing yet: identify, repair, guilds, auction, rest, rumors, study, and equip from the Bank. Design what the world needs, and mark clearly which of these need building, so nothing looks finished that isn't.

## Constraints

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
3. **The sequence:** the recon survey, the drop, a fight, the channel at the exit, and the seal. If those five moments feel like one machine with one memory, the remaining screens will follow.
