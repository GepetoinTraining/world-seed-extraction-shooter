# Playtest ledger

Things to fix, found by playing. Add a row when something is found, with what happened in plain words. Move it to Fixed with the commit when it is done and checked. Design decisions stay in `PLAN.md`; this is the list of what is wrong.

## Open

### Left open by the usability pass, approved "for now" by Pedro, 2026-10-31

| # | What happens | Where |
|---|---|---|
| U15b | The body is a figure now, but the rest of the Agent tab (identity, attributes, what the hands know) still reads as a column of forms. Met again in leg 1 (arrival): the Agent tab still reads as a column of forms. | `PlayerHub.tsx` |
| U22 | The card has no damage line, so two weapons compare on what the sheet shows (attack speed, crit) and not on what they hit for. Damage comes from `itemPower`; whether that can be shown without breaking the knowledge law has not been worked out | `inspect.ts`, `CombatMath.ts` |
| U23 | What rides a pouch has no drag: a right-click on the hotbar's pouch cell takes the last one back into the pack | `Hotbar.tsx` |
| U24 | Placing a thing in a room is still the tile ahead and a list, not the hands | `HubCanvas.tsx` |
| U25 | The field minimap forgets what was seen when the session ends; it is kept for the run only | `WorldCanvas.tsx` |
| U26 | The beacon chip gives the nearest exit's bearing and distance even when its sector was never scanned. The minimap keeps that fog; the chip, as it always has, does not | `WorldCanvas.tsx` |

### Found by Pedro in the run, 2026-10-31

| # | What happens | Where |
|---|---|---|
| R2 | Pedro said a couple of things; only R1 has been named so far | |

### Found while checking the magic + content layer, 2026-11-01

| # | What happens | Where |
|---|---|---|
| N5 | `tests/database.store.test.ts`, two processes writing one new file: it failed about one run in three, because both tried to create the tables on first open. `migrateTakingTurns` fixes that cause, and 45 runs since gave 44 passes. The one failure was not captured, so it may be a second cause. Machine load is the likeliest, and that is a guess | `server/connection.ts` |
| N10 | A deep scan's manifest still prints raw ids for what is not a creature (`struct_ruin`, `res_...`). Met again in leg 1 (worlds over time, the door): `res_7c21a3eb_compound_oak`, `res_7c21a3eb_sovereign_silver`, `struct_ruin`, `npc_survivor` in the recon manifest. | `SurveySystem.manifest` |
| N12 | Three places skip worn `carry_capacity` when reading the carry limit. Pedro asked how carry works and has not asked for a change | `player/store.ts` about 640 and 932, `PlayerHub.tsx` about 130 |
| N13 | Tax Evasion's first attempt says "Winging it: ... It costs more without the skill", and it costs nothing more. Farming says the same, and charges no energy. Met again in leg 1 on seven more roads: ranged combat and a chest (the field); Persuasion, Escort, Quarrying, Tax Evasion (a person's road); firing (rest and growth); and in the integrated game, Ranged on biological and Escort. Nothing cost more. | the skill's first-use line, `workOn` |
| N14 | Reading a scroll feeds "Writ of Breach: +0 health." Every scroll has since Layer 3. Met again in leg 1 (the field): reading a Writ of Breach fed "Writ of Breach: +0 health." | `store.consumeItem` |
| N15 | Glass panes answer `building`, so a window's panes can go into a wall's line | `resourceDefinitions`, `answersTag` |

### Found while building and joining Wave C's first pass, 2026-11-01

| # | What happens | Where |
|---|---|---|
| W1 | A world deed sells at the counter, for 94 G on a new hub, where a standing would be expected to be refused. A free deed then sits on a shelf at about 225 G. Met again in leg 1 (the city's week): offered at 94 G at the Alchemist's counter, beside a tonic. Q35. | `sellToVendor`, `WorldDeed` |
| W2 | A fresh hub's load does not clear `rooms`, so moving to a new hub keeps the old one's rooms in memory | `hub/store.ts`'s `loadHub` |
| W3 | The market a hub's cost reads includes the stash and body of the person present, so what someone carries into the city moves what it costs. A client knows no other player's bank, so this needs the server | `MarketCap`, Wave 13 |
| W4 | A hidden pane stalls a beacon's channel until a screenshot forces frames, which looks like a stuck seal and is not. Met again in leg 1: every stream played with the pane hidden. The field saw walks and channels slow until a screenshot forced frames; the others replaced `requestAnimationFrame` with a 16 ms timer. In the integrated game that timer stalled: after some minutes hidden, the page's own timers ran about once a minute, and in the field a free-running timer clock starved the page until it stopped answering. Frames paced by a worker, one at a time, worked. | the pane, not the game |
| W6 | A goal on the floor reads badly on the bottom rung: "Working toward fed." | `TalkLaw`'s plain goal |
| W7 | A hub's document grows with what comes apart, about 50 KB a week on a hub nobody shops in, and it is written whole on each commit. Met again in leg 1 (the city's week): 109 parts on three keepers after one quiet week, 14,539 G of loss. In the integrated game a quiet hub's ledger grew from 51 to 275 rows on day 4, when the first bin came apart. | `closeWeeks`, `VendorSystem`'s parts |
| W5 | A `.env` at the root of a checkout on `claude/world-clock` would not be ignored, because that branch's `.gitignore` predates it. `main`'s lists it. Staging by name is all that stands in the way until the checkout moves. The only copy of Pedro's key is the `.env` in `.claude/worktrees/wave-b3-creation-deed-0bc7a1`, so removing that worktree removes it | `.gitignore`, B3's worktree |

### Found while building the timer, 2026-11-01

| # | What happens | Where |
|---|---|---|
| T1 | A harvest's menu and card promise seconds ("2.5s"), but a harvest is instant and nothing reads the number. Either the wait becomes real, with a bar, or the number goes. Pedro's call | `InteractionEngine.ts`, `inspect.ts:83` |
| T2 | Any error while drawing blanks the whole game to black. There is no error boundary, so nothing says what happened and the only way back is a reload. Found by a bad test poke, not by play. Met again in leg 1 (the city's week): a render error mid-edit (the stream's own) blanked the game until a reload. | `App.tsx` |

### Found in leg 1, the integration pass, 2026-11-03

| # | What happens | Where |
|---|---|---|
| L1 | With a key, the Seed cannot write a world or a chain. The API refuses the `theme`, `theme_large` and `chain` schemas before billing, "The compiled grammar is too large", and the person reads "The Seed did not answer." With no key the game looks the same, so only the door saw it. Ruled 2026-11-04, not built. A tutorial world stays open while the player's own world is generated: its tiles, creatures, professions, flora and fauna, before the first deploy. First comes a pull, by meaning, from the database near the theme. The model then selects from it, then adds only what is missing, never a copy. Names come from prefix and suffix lists, what a thing does comes from study, and nothing rolled is the model's. Q1 | `server/intelligence/` (`THEME_SCHEMA`, `CHAIN_SCHEMA`); MINT NEW REALITY |
| L2 | The city opens twice at once in dev: strict mode runs `HubSelector`'s effect twice. Only the fold is guarded (`e419b80`); `loadHub`'s other doors (vendors, crafts, builds, upkeep, wants) also run twice. No doubling seen there, and no bar goes red. The integrated game's first boot logged "[HUB] No state found. Generating fresh layout..." twice; across ten days each week still closed once | `hub/store.ts`'s `loadHub`, `HubSelector` |
| L3 | A piece's stored name still shows raw in the city's own lines: a player's own shelf, repair, the study list, and placing and reclaiming in a room. A piece named "Broken …" at full durability reads so there while its card says "Crude" | `HubCanvas.tsx`, at `8af0f86` about lines 1110, 1235, 1028, and 391, 400, 807, 856, 860 |
| L4 | Two quality scales: the factory writes "Broken" and "Superior" into the stored name at ±15%, the card reads five bands at ±4% and ±12%. A +12% to +15% piece reads "Superior +12%" on its card with no word in its name; a word lands before "The": "Crude The Repossessor". Q13 | the item factory, `inspect.ts`, `LoadoutSystem.shownName` |
| L5 | HAUL VALUE on the receipt sums the true worth of unread pieces (2,803 G) while the pack shows "Unidentified Signal"; a caught levy would show it too. Q12 | the SEALED receipt |
| L6 | Recon's SECTOR INTEL for one sector reads like the whole world's count: "1212× MOB · 7457× RESOURCE · 112× STRUCTURE…" for one of 256 sectors, and "1131× MOB" on another world. Not checked in code | recon, SECTOR INTEL |
| L7 | Recon's WHERE TO START said "the way out is already under your feet", and the beacon was 92 m east on landing | recon, WHERE TO START |
| L8 | The tavern was out of reach from beside its east wall on the door's row, 3 tiles counted from the door and the centre. It may be intended | `withinReach`, the Rusty Anchor |
| L9 | The sheet is wider than a 1024-wide window: pinned right in a fixed strip (`justify-content: flex-end`), the first panel starts at -36 px, so name, attributes and skills are cut off, in the city and the field. Q8 | the sheet (TAB) |
| L10 | The Agent tab shows two weights: "LOADOUT — NEXT DROP 4.5 / 49 kg", and under it "Current bank weight: 0.0 / 49 kg", which reads the field pack and is always 0 in the city. Q6 | `PlayerHub.tsx`, about lines 182 and 207 |
| L11 | A world card names its maker by an id: "ARCHITECT WS_2EF4E" where the person is TRELLIS. Q5 | the ZONES card |
| L12 | Vex says people come out of the gate "with a little coin", against D128 (a person from a bond carries 2,600 G and up; one came home with 7,924 G). Q3 | `dialogue.ts` about line 207, ASK ABOUT THE HALL |
| L13 | The debug world is the only card on a new person's zones list, with a live DEPLOY, and first in QUICK DEPLOY. Q14 | VIEW EXTRACTION ZONES, QUICK DEPLOY |
| L14 | After THEY WILL COME the feed says "Sera Basalt walks beside you now. Reach the beacon together.", and nobody does: the person leaves the world and becomes an Escort Bond in the pack (weight 0). Q16 | the field's talk, the bond |
| L15 | Once a person's house stands they cannot be talked to: TALK WITH THEM is only on Mags's list, and neither their body at the door nor the house's inside offers it, so their regard and ladder are out of reach. Q18 | the Rusty Anchor, the person's house |
| L16 | Two readers name two wants for one person on one day: the talk's WHAT THEY ARE AFTER "SAFETY: Working toward a house of their own", the board's "could use 1 thing marked stone". Q19 | `TalkLaw`'s goal, `guild.ts` `wantFor` |
| L17 | A resident is drawn in the same figure and colour ramp as the player, told apart only by where they stand. In the integrated game the camera sat at the plaza's edge and the walk was read off the wrong figure for several tries; only the corner brackets, zoomed, told JOINER from Kael Gantry. Q22 | the resident's drawing (B4) |
| L18 | Right after a print of 14 days the Hall says the treasury holds 7: the print reads the cost before the shelf restocks (12,418 G = 14 × 887; then 1,551 G a day). Q31 | the week's close, the Hall's books |
| L19 | Recon's "Chunks · anchors" reads 0 for a camp whose built post the map draws: the number is the boss's ward. Q40 | recon, `Territory.layOver` |
| L20 | AGENTS on a minted world's card is always 0: `WorldCertificate.recordSession`, its only writer, has no caller. The debug world's 1 is fixed. Q41 | the zones card |
| L21 | A deep scan marks leaders seen, which fixes their goal's outcome for the cycle (D93), while the manifest shows no leader or pack. Q44 | recon, the manifest |
| L22 | No city screen shows energy held, though a sitting, an identify and a station's study spend it there and a rest's length follows it. Q26 | the sheet's study panel, the inn |
| L23 | After a level, the city's bar says "F · LV 4" and nothing waiting, while the field chip says "3 TO SPEND · 3 TO FILL". Q28 | the city's bar |
| L24 | A skill from creation has two names: the model's on the sheet ("Quiet Sawing"), the hub bank's in the feed and on the ledger's FIRST row ("Saw on wood"). Q9 | `skillWords`, the hub bank, the feed |
| L25 | With no key, a gift can never come: lore is written only by the dream, so sittings wait and lore stays 0, and filled circles stay owed for ever. Since `9b0db17` the rest names the gift. Q24 | `RestDoor.ts`, the dream (D126) |
| L33 | The Hall's ground button asks "ON THE TREASURY: SURE?", and nothing leaves the treasury: it read 39,928 G before and after the Hall bought Lot #6 (4,450 G) for Kael Gantry. By design no gold moves ("The seller is the treasury that backs the buyer"), so the words and the books disagree. Q51 | `GuildHall.tsx` about line 129, `hub/store.ts` `guildBuyLot` about line 1109 |

## Fixed

| # | What was wrong | Commit | Checked |
|---|---|---|---|
| N9 | A lot was named from its index, one behind its sign: the holdings, the chip inside a room, the "Through the door" line, the plan window, the split line and a servidão's lines ("LOT 5" under "LOT #6", Plot #19 as "LOT 18"). Every screen now reads `HubGenerator.lotName`, the sign's name | `964299f` (arrival) and `5a13b0a` (the city's week), made one `lotName` at the join `b2bf097` (an id alone falls back to the id, a lot to `Lot #n+1`) | Bars in `tests/arrival.test.ts` and `tests/cityweek.test.ts`, red first; played on two avatars: the deeds read LOT #1 to #6, then PLOT #7 to #22; seen again in the integrated game on the join: the Land Office's deeds, the Hall's ground and the street signs all read Lot #1 to #6 |
| N11 | The Agent tab said "Mental stats come only from frames", while creation deals them. It now says gear never adds to them and a frame does, beside what was dealt | `964299f`, joined at `b2bf097` | Bar in `tests/arrival.test.ts`, red first; seen on screen; seen again in the integrated game on the join |
| L26 | A week's close was paid twice: two SHOP_WEEK rows for one week, 29,080 G out for a 14,540 G loss, because the city opened twice at once in dev (a double click on MATERIALIZE would do the same in a build). Days and weeks now fold one at a time | `e419b80`, joined at `6a4effd` | Bar in `tests/shopweek.test.ts`, red first (two HUB_RUNNING rows); played: week 3 closed once, 5,425 G covered. See L2; in the integrated game ten days were moved one at a time and weeks 2965 and 2966 each closed once, with the audit balanced every day |
| L27 | The Hall's lines did not add up to its day ("1,551 G a day" over lines adding to 228; 2,521 over 158 on another avatar): the shops' week was in the total and not listed | `eedb87e`, joined at `6a4effd` | Bars in `tests/cityweek.test.ts`, red first; played: "The shops' week, as stocked, 1,323 G a day"; in the integrated game the lines added to the day twice: 2,852 G on day 0, 1,371 G on day 10 |
| L28 | A piece had two names on one screen: the counter's "Broken The Repossessor" beside its card's "Crude, 100 of 100", and "Broken Ledger Saw" on a shelf. `LoadoutSystem.shownName` now turns "Broken" into "Crude" as the card does, and the card, shelf, counter and their feed lines name through it | `a66a666`, joined at `df4747d` | Bar in `tests/atoms.depth.test.ts`, red first; played after a reload: "Crude Ledger Saw". The hand slot ("Broken Clerk's Hatchet", met by the door on a base without it) names through `shownName`, by source only. See L3; in the integrated game the armory's shelf read "Crude Auditor's Seal" and "Crude Claim Pick" |
| L29 | A drop could land a person on a trunk's tile and hold them there for good: every step was refused. A trunk or standing wall now refuses walking into its tile, not out of the one you stand on | `7613374`, joined at `c77be66` | Bar in `tests/atoms.motion.test.ts`, red first; played: after a reload the same drop walked; not met in the integrated game |
| L30 | A want for one thing said "1 things marked stone". A want posted before the fix keeps its stored words | `31c944f` (its bar's type slip fixed in `41cb126`), joined at `c77be66` | Bar in `tests/guild.test.ts`, red first; not met in the integrated game (no want for one thing came up) |
| L31 | A person coming home posted a want the same day their last was met: the house standing reset the next want to today, against the board's "a day apart" | `31c944f`, joined at `c77be66` | Bar in `tests/guild.test.ts`, red first; in the integrated game Kael Gantry's next want was set for the next day and came then: "4 things marked ore" |
| L32 | A rest the dream could not reach said only "What you studied waits" and nothing of the gift the person had just been told to rest for. It now says "X is owed a gift. It waits for a rest the dream can reach." | `9b0db17`, joined at `8af0f86` | Bar in `tests/study.test.ts`, red first; played; in the integrated game: "Blunt on metal, mineral, ore is owed a gift. It waits for a rest the dream can reach." |
| N16 | The database pass could exit 139 after every bar had passed, and the dev server could go down with `0xC0000005` under refused commits. The bare `@libsql/client` 0.17.4 did it with no game code. Its cause in the driver was not found: the driver left the server's path | `d6c743b` | 0 of 12 database passes at 139; 0 of 20 crashes on a folder by the stream, and 0 of 5 on a recount by the coordinator |
| N6 | A creature could be defeated from beyond where it noticed anything, and never answered: a hit woke it, and the next tick put it back to sleep past the leash. A hit is now felt from any distance and answered by the creature's own behaviour, and sight has no cap in `MobAI` | 3f2c6bd | By 22 bars that failed first, and played at 15 to 19 tiles against passive, neutral, turret, swarm, siege and aggressive creatures |
| N7 | A creature outside the simulated box could not wake or move, so sight was capped by the box | B2, `2beeba1` | The box reaches the widest sight in the dark, and any chunk a provoked body stands in stays simulated. By bars; played at 109 tiles |
| N8 | A creature that followed froze when its home chunk left the box | B2, `2beeba1` | A body moves to the chunk under its feet as it crosses, and a chunk not yet built holds it at the line. By bars; played across a chunk line |
| P1 | A cache duplicated its contents into the pack and an overflow cache, one copy per press | b5cd6ea | Bar; played: full pack, five presses, no new entity or item, no energy charged |
| P2 | A stray click or Escape discarded the mint-world draft | b5cd6ea | Bar on the real component; played: the backdrop does nothing, Escape asks "The draft is unsigned. Abandon it?", reopening restores the draft |
| P3 | A pack item could not be moved to a chosen cell | b5cd6ea | Bar; played by mouse on the stash, cart and ground; the keyboard walk played on the stash by scripted keys |
| U1 | Every shot needed its own click | b5cd6ea | Bar; played: 9 shots in 2s at 4 a second, melee and focus alike, none after release |
| U2 | The field had no interact key | b5cd6ea | Bar; played: E on a harvest, a cache, a cart and the beacon |
| U3 | Firing and interacting shared one click | b5cd6ea | Bar; played: a click on a grain plant fires and opens nothing |
| U4 | Nothing could be dragged | b5cd6ea | Bar over 1,200 moves, field and bank; played by mouse: vault to hand, vault to kit, stash to stash, pack to ground, pack to cart |
| U5 | Digits reached only the belt, and hands and tools were not on the HUD | b5cd6ea | Bar; played: 1 and 2 change the hand; a pouch on a digit by bar |
| U6 | Equipping took three steps | b5cd6ea | Bar; played: right-click wears; a swap needs no unequip |
| U7 | Leaving had no key | b5cd6ea | Played: E channels at the beacon, Esc aborts it; X withdraws and Enter drops in recon (X by bar) |
| U8 | Hovering an item showed no card | b5cd6ea | Played on the shop, stash, vault and cart |
| U9 | Nothing could be compared | b5cd6ea | Bar, knowledge law included; played: shortbow against the worn blade |
| U10 | Selecting a pack item moved the grid | b5cd6ea | The actions live in a fixed column; played |
| U11 | Shop, cart, bench and body items had no card | b5cd6ea | Every item sprite answers by construction; shop and cart played; the bench and counter by source bar only |
| U12 | The field showed raw coordinates | b5cd6ea | Bar; played, field and city |
| U13 | The stash was a text list | b5cd6ea | Bar; played: grid, filter, sort; the layout survives a reload |
| U14 | SELL acted on one click | b5cd6ea | Bar on the real button; played |
| U15 | The body was empty outlined boxes | b5cd6ea | A filled figure stands behind the slots; worn pieces fill and frame. Looked at in colour and grayscale. See U15b |
| U16 | The city drew in a box with buildings cut off | b5cd6ea | Bar on the camera; played at 1280×800: full window, ground past the city's edge rather than black |
| U17 | No minimap | b5cd6ea | Bar, fog included; played in field and city, grayscale looked at |
| U18 | Recon was a small panel with scrollbars | b5cd6ea | Bar on the advice; played: full window, SCAN HERE then DROP HERE, keys |
| U19 | A hub stop with one hub | b5cd6ea | Bar on the rule; played: the city follows the gate directly. Two hubs still show the screen, by bar only |
| U20 | Developer controls in the player's bar | b5cd6ea | Bar; played: SYSTEM holds backup and switch; Ctrl+Shift+D reaches the rest |
| U21 | Key help ran into the data | b5cd6ea | Bar; played |
| U20b | CITY, ZONES, BANK and HOLDINGS were a row of tabs in the player's view | b924a1d | Bar; played: the bar holds CHARACTER and SYSTEM, the Conduit leads to the zones, Esc comes back to the same spot |
| U27 | Pedro: no one place for skills and inventory, except through views that shouldn't be available | b924a1d | Bars on the real component, field and city; played in both, frame cost and grayscale checked |
| N2 | DISCARD at the vault did nothing | b924a1d | Bar |
| N3 | Coming back from a keeper's screen put you at the plaza spawn | b924a1d | Played |
| R1 | Pedro: an unidentified cart kit could be unfolded | d09b6cb | Bars; played on a test avatar: refused in voice, stays in the pack. Pedro's own run found it |
| N4 | Found checking R1: a signal gave itself away by the hover's comparison and rank, by its real name in refusals and the feed, by the fitting list, and by which buttons it offered | d09b6cb | Bars |
| R3 | Pedro's call on R1: identify in the field refused the unschooled outright, and its refusal named the piece's kind | b6fe63a | D32: a keyed roll paid in energy. Bars; played on a test avatar: paid, timed, hit, read. A miss by bar |
| R4 | A "neutral" dragon killed a 120-health character in one hit, with no warning | this branch | Bars; played on a test avatar: a world's difficulty bounds its ground, spawns weigh to the chunk's rank and elites are scarce and alone, neutral waits to be harmed, and a hound's brackets show before its blow. Nothing outruns a bare walk, by formula |
| R5 | An Aetheric Lens could not be worn and did nothing | this branch | Gone with the tables. Its rule is law: every gear kind has a slot, by bar. `field_analysis_speed` shortens the study clock |
| R6 | Repair could not see what you were wearing | this branch | Bar: a worn piece repaired, paid for, still worn. Not played in the window |
| B1 | A worn bag's capacity could not be filled by pickups | this branch | Bar: one limit, `LoadoutSystem.carryLimit`, everywhere |
| M1 | Most item stats did nothing | this branch | Bars: every stat has a reader or the batch falls. Felt in play only as far as reserves and the shelf; balance waits for Wave 12 |
| M2 | Each new drop refilled energy | this branch | Bars; played: 37 kept through a return and a reload, restored by a night at the inn |
| T3 | Pedro: many waits felt like the game froze | this branch | Bars (`tests/timer.test.ts`); played on a test avatar: world card ribbon, exit wait 40% to 100% to the receipt, lock and identify bars with the sheet shut and open, body effects, city bench job and its ready line, rest and batch chips, grayscale looked at. By bar only: reduced-motion block, the AI waits (no key here). The rest bar in the field was played with a set state, not a real field rest |
| T4 | A boot that threw an error counted forever with nothing said | this branch | Played: a broken save stops the clock, says why, and offers another avatar |
| N1 | Found by the conservation bar: two caches left in one millisecond shared an id, and taking one took both | b5cd6ea | Bar |
