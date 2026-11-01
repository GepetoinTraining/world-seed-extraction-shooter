# Playtest ledger

Things to fix, found by playing. Add a row when something is found, with what happened in plain words. Move it to Fixed with the commit when it is done and checked. Design decisions stay in `PLAN.md`; this is the list of what is wrong.

## Open

### Left open by the usability pass, approved "for now" by Pedro, 2026-10-31

| # | What happens | Where |
|---|---|---|
| U15b | The body is a figure now, but the rest of the Agent tab (identity, attributes, what the hands know) still reads as a column of forms | `PlayerHub.tsx` |
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
| N9 | The holdings screen says `LOT 13` where the sign says `Lot #14`. Predates the hub manifest | `HoldingsPanel.tsx` |
| N10 | A deep scan's manifest still prints raw ids for what is not a creature (`struct_ruin`, `res_...`) | `SurveySystem.manifest` |
| N11 | The Agent tab says "Mental stats come only from frames", which is no longer true | `PlayerHub.tsx` |
| N12 | Three places skip worn `carry_capacity` when reading the carry limit. Pedro asked how carry works and has not asked for a change | `player/store.ts` about 640 and 932, `PlayerHub.tsx` about 130 |
| N13 | Tax Evasion's first attempt says "Winging it: ... It costs more without the skill", and it costs nothing more. Farming says the same, and charges no energy | the skill's first-use line, `workOn` |
| N14 | Reading a scroll feeds "Writ of Breach: +0 health." Every scroll has since Layer 3 | `store.consumeItem` |
| N15 | Glass panes answer `building`, so a window's panes can go into a wall's line | `resourceDefinitions`, `answersTag` |
| N16 | The database pass can exit 139, a crash at teardown, after every bar has passed. Counted 2026-11-01, 12 runs each, taking turns: the join 1 at 139, a tree without B2's population code 2 at 139 and 1 at exit 1. So it is not B2's. It comes from `tests/database.store.test.ts` alone (1 of 4 runs of that file; the other two files 0 of 4) and the cause is not found. It reached 2 of 3 on a quiet machine, so `npm test` often reports a failure with every bar green: read the bar count. **Narrowed 2026-11-01: the bare driver, `@libsql/client` 0.17.4 with no game code, exits 139 after finishing in 7 of 10 runs that used transactions. It is not this game's code. The dev server's mid-run `0xC0000005` under refused commits, 3 of 3 on `main`, is related in kind and its cause is not found. The same load on PGlite in memory: 0 of 5** | `tests/database.store.test.ts` at teardown, the driver |

### Found while building and joining Wave C's first pass, 2026-11-01

| # | What happens | Where |
|---|---|---|
| W1 | A world deed sells at the counter, for 94 G on a new hub, where a standing would be expected to be refused. A free deed then sits on a shelf at about 225 G | `sellToVendor`, `WorldDeed` |
| W2 | A fresh hub's load does not clear `rooms`, so moving to a new hub keeps the old one's rooms in memory | `hub/store.ts`'s `loadHub` |
| W3 | The market a hub's cost reads includes the stash and body of the person present, so what someone carries into the city moves what it costs. A client knows no other player's bank, so this needs the server | `MarketCap`, Wave 13 |
| W4 | A hidden pane stalls a beacon's channel until a screenshot forces frames, which looks like a stuck seal and is not | the pane, not the game |
| W6 | A goal on the floor reads badly on the bottom rung: "Working toward fed." | `TalkLaw`'s plain goal |
| W7 | A hub's document grows with what comes apart, about 50 KB a week on a hub nobody shops in, and it is written whole on each commit | `closeWeeks`, `VendorSystem`'s parts |
| W5 | A `.env` at the root of a checkout on `claude/world-clock` would not be ignored, because that branch's `.gitignore` predates it. `main`'s lists it. Staging by name is all that stands in the way until the checkout moves. The only copy of Pedro's key is the `.env` in `.claude/worktrees/wave-b3-creation-deed-0bc7a1`, so removing that worktree removes it | `.gitignore`, B3's worktree |

### Found while building the timer, 2026-11-01

| # | What happens | Where |
|---|---|---|
| T1 | A harvest's menu and card promise seconds ("2.5s"), but a harvest is instant and nothing reads the number. Either the wait becomes real, with a bar, or the number goes. Pedro's call | `InteractionEngine.ts`, `inspect.ts:83` |
| T2 | Any error while drawing blanks the whole game to black. There is no error boundary, so nothing says what happened and the only way back is a reload. Found by a bad test poke, not by play | `App.tsx` |

## Fixed

| # | What was wrong | Commit | Checked |
|---|---|---|---|
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
