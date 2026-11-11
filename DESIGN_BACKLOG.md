# The design backlog

Pedro, 2026-11-11: "can you check the designs needed? we have a lot of backlog in there probably, a UX pass would be good too, right now we have the small character sheet and no big one, dragging items outside to drop would be good too, the carts need variable sizes of bed and their stats, and an overall better inventory tetris system would be good".

This is the list: everything the project's own records say still needs design. A screen or a view, a way of handling something, a moment that has no interface, a system that was ruled on and never designed, anything put off to a later pass. It leaves out bugs to fix and numbers to tune.

**How it was compiled.** Five readers each took a fixed list and read it whole: `DESIGN_ASK.md`, the leg 1 questions and the handover; the open rows of the ledger, the leg 2 playthrough, the builders' log and the design parts of `BALANCE_RUN.md`; `PLAN.md` in two halves; and the code behind his four points. Each gave an item's status as its record states it and judged no further. Several records are dated from 2026-10-30 to 2026-11-04 and were not brought up to date, so "not built" below means the record says so, and section 8 lists where records disagree. A pointer such as `PLAN.md:530` is a file and a line.

## 1. The interface pass he asked for

His four points, each with what the game does today, read in the code.

### 1.1 The character sheet

| Today | Where |
|---|---|
| One overlay, opened with C or Tab, at one size: a row of panels that wraps, at most 1,500 px wide and 332 px tall | `CharacterSheet.tsx:396`, `:52` |
| It holds who you are (name, rank, level, attributes with a + when points are unspent, what the hands know, a list of skills), the body at a small size, and the pack in a world or the vault at home | `CharacterSheet.tsx:323`, `:398`, `:108`, `:268` |
| A second, larger sheet exists only in the hub, as the AGENT tab: the body at full size, the vault, the kit, an identity panel, and each attribute as its base against what gear makes it | `PlayerHub.tsx:575-595`, `:236-258` |
| The two repeat each other: the attribute grid and the head budget are drawn twice, and the vault is shown in three places | `CharacterSheet.tsx`, `PlayerHub.tsx` |

Pedro asked for the first sheet on 2026-10-31: "how to access my skills and inventory in a singular place, without going through the views that shouldn't be available. A character sheet" (`PLAN.md:530`). It was built along the lower half of the window. On record against it: below about 1,100 px wide the row runs out of room (`PLAN.md:537`), and in a 1,024 px window its left column is cut off, which was decided to be a bug (leg 1, Q8). The AGENT tab is "still a column of forms", approved for now (ledger U15b).

What a character has that no sheet shows, by comparing the character's record with the panels (the code reader's inference): health and energy with their maxima; every derived fight number (damage, protection, crit and the rest); gold while in a world; each topic of lore (only the amount held shows); mastery of materials; gifts in detail; aether reserves and workings known; class and the record of creation; guild and city; who is known by name; what waits at the next rest; statuses; escorts and tamed creatures.

**Not there today:** one large sheet that is the same in a world and at home, and a place on it for anything in the list above.

**Now built (89adf1c, the interface pass, part 2).** Pedro: "right now we have the small character sheet and no big one". One large sheet, the same in a world and at home (`LargeSheet.tsx`), opened by SHIFT+C or the small sheet's LARGE SHEET button; the AGENT tab shows it. It holds every item in the list above but who is known by name, each in its own place: health, energy and aether with their maxima, every derived fight number with what feeds it, gold, lore by category, mastery, gifts, statuses, who walks with you, what waits at the next rest, the body at full size, and the pack or the vault and kit. Its numbers come through `SheetNumbers`, which asks the rules; the carry limit is `LoadoutSystem.carryLimit`. Open calls: ledger I2a to I2f.

### 1.2 Dropping by dragging outside

| Today | Where |
|---|---|
| An item leaves the pack by the LEAVE BEHIND button, by a drag onto the small ground strip inside the pack panel, onto a cart's bed, or by being worn, stowed or used. No key drops. | `CharacterSheet.tsx:166`, `ItemHands.ts:106-109` |
| A drag let go outside every grid finds no place, and the piece goes back. Nothing moves and nothing is said. | `hands.tsx:85-87`, `:96-108`, `:129-139` |
| The ground strip exists only while the sheet is open. In the cart's window and in the hub there is no ground at all. | `CharacterSheet.tsx:73` |
| A drag can end on eight kinds of place: pack, stash, a body slot, a cart, a cache, the ground, the kit, and onto another material | `ItemHands.ts:19-28` |
| Each thing dropped makes a cache of its own, and the ground strip shows only the first cache in reach | `store.ts:1604-1613`, `CharacterSheet.tsx:80` |

No record asks for or rules on a drop by dragging out. The one drag system covers pack, stash, body, belt, cart and ground (`PLAN.md:495`, `:503`).

**Not there today:** letting go of a piece outside the grids drops it. To design: what "outside" is (the field behind the sheet, the window's edge), what is said when it happens, and what a pile of dropped things is, since today ten drops are ten caches.

**Now built (32e4d56, the interface pass, part 1).** Pedro: "dragging items outside to drop would be good too". A piece let go over the field's own ground, outside every grid, is dropped at your feet, and the ghost and a line say so first; in the city or over a window with no field behind it, it goes back and a line says why; a near miss on a panel goes back silently. X drops by key. A drop within three tiles of a pile you made joins it. Open calls: ledger I1d, I1e.

### 1.3 Carts

| Today | Where |
|---|---|
| A cart is a kit that unfolds into a thing in the world with its own grid. Each cart carries its own width and height, and the grid, the loading check and the placing all read them. | `shared/types.ts:578`, `CartSystem.ts:25-42`, `:76` |
| Every cart is 10 by 8, from one row of content. No second kind of cart and nothing by rank. | `ThemeFormula.ts:295`, `CartSystem.ts:26` |
| Folded, a kit is always 2 by 3 and weighs 15, written by hand where it is folded back. By the reader's inference that rebuild keeps the bed's size and not the kit's affixes. | `ItemFactory.ts:299`, `WorldCanvas.tsx:466-471` |
| Its stats: the bed's size; the weight aboard, which slows the tow (`max(0.4, 0.75 - kg / 400)`); a lock (ten seconds a level to break); an alarm. One affix exists for a cart. | `LoadoutSystem.ts:471`, `CartSystem.ts:49-60`, `firstTheme.ts:159` |
| It has no weight of its own, no limit on what it bears, no speed, no wear. | `CartSystem.ts` |
| The cart's window shows the bed, the pack, the weight, the tow pace, the seal and the last theft. It does not show the lock or the alarm. | `WorldCanvas.tsx:89-145` |

The ruling it was built to (D16): a towed thing with its own grid and a real cost in speed, that stays in the world across a death and that anyone may tow away, the theft being a signed fact, "a bed bigger than any pack". On record against it: a bed has no key or button to turn a piece, only R while dragging (ledger H1b), and a bed does not take one material set on another (H13d).

**Not there today:** beds of different sizes (the data allows it; the content has one), and a cart's own stats. This meets his ruling that gear is a generated noun: a cart is a kind like any other, and its bed and stats are what it carries.

### 1.4 The item grid

| Today | Where |
|---|---|
| The pack is 8 by 6. The stash is 12 wide and grows by rows. A cart's bed is the cart's own. | `InventorySystem.ts:16-17`, `StashGrid.ts:12-14` |
| A piece's footprint is written on it: by its tags for gear, and 1 by 1, 1 by 2 or 1 by 3 for a material | `ItemFactory.ts:296`, `ThemeFormula.ts:192` |
| A dragged piece lands on the cell under the pointer if it is free. A picked-up piece takes the first place it fits, turned if it must be. | `ItemGrid.tsx:56-60`, `InventorySystem.ts:88-100` |
| A piece is turned with R or a button, and moves to the nearest place it fits once turned | `InventorySystem.ts:128-147` |
| Nothing stacks and nothing splits: every piece is its own thing | no code |
| Only the stash sorts (name, rank, value, weight, type) and filters. The pack has no sort and nothing arranges it. | `StashGrid.ts:121-143` |
| A pickup that does not fit is refused with a line in the developer's console only | `store.ts:1570-1572` |
| The whole of it has keys (grab, walk, change place, set down, turn, put back), except setting one material on another, which is pointer only | `hands.tsx:257-312`, ledger H13d |

On record: a pouch's contents cannot be dragged (ledger U23); wear is faint at 36 px and the rank mark covers much of a one-cell piece (`DESIGN_ASK.md:133`); the city should show one weight, the one that rides on the next drop (leg 1, Q6, decided, not built).

**Not there today:** stacks and splits, a sort or an arranging for the pack, a plain sign that the pack is full, anything that makes a pack grow, and a spoken refusal when a pickup does not fit.

Colour alone tells the load in two places in the hub's kit panel (the kit's weight and the load bar's tone), against the project's rule that meaning is carried by position and shape.

**Now built (32e4d56, the interface pass, part 1).** Pedro: "an overall better inventory tetris system would be good". Like things stack in the pack, the vault and a cart's bed: one footprint with a count, weighing their sum, with no top but the weight, every piece still its own thing underneath. Shift takes half, by pointer or key. The pack arranges (TIGHT and the vault's five sorts, P for tight), says FULL, and a pickup that does not fit is refused in the feed with its reason. A pouch's contents drag (U23); a cart's bed turns a piece by button and R (H1b) and takes one material set on another, and O does it by keys (H13d). The kit panel says SLOWED or OVER THE LIMIT in words. Still not there: a pack that holds more cells. Open calls: ledger I1a to I1c, I1f, I1g.

### 1.5 Handling already on record as open

- Placing a thing in a room is the tile ahead and a list, not the hands (ledger U24); building targets only the tile ahead, with no pointing (`PLAN.md:361`).
- The field's small map forgets seen ground when a session ends (U25); the beacon's bearing ignores what was never scanned (U26).
- An item's card has no damage line, and whether it can show one within the rule on what is known "has not been worked out" (U22).
- A harvest promises seconds and is instant: the wait becomes real with a bar, or the number goes. "Pedro's call" (ledger T1).
- "Needs a tool" does not say which tool (H6b).
- Three ways to make a thing now stand side by side: one material dragged onto another, the IMPROVISE button, and a bench job. "Which stay is his" (H13c).
- Two forms take a key for a model; "one of them should go" (C35). Text above 150% is unchecked on fixed-width screens (C34).
- Nothing in the city points to the Nexus before the first order (`PLAYTHROUGH_LEG2.md:246`).
- Switching tabs in the city returns you to the plaza (`PLAN.md:377`).
- Overlapping things in the field are hard to click (`HANDOVER.md:332`).
- The radial action menu in the field: its status is not stated (`DESIGN_ASK.md:294-300`).

## 2. Views and screens

| What | Status in the record | Where |
|---|---|---|
| A view of the tech web: what unlocks what and where things sit, to plan lore by | Asked 2026-11-11. Nothing draws the web. What it may show meets D125, where a skill enters a hub's web unseen. | `BALANCE_RUN.md` 3.7 |
| A map view to choose where to scan from. Pedro: "right now there's no view from the map itself to choose where to scan" | Not built | leg 1, Q14 |
| Recon and dive stations inside the Nexus; the card's buttons are stand-ins. "A button exists before we make the world provide the button" | Not built | `PLAN.md:807` (D92) |
| A home dive station and the dungeon it makes: "rooms with encounters, skill checks to progress and energy as the resource to map" | Not built | `PLAN.md:813` (D98) |
| A world's window (its phase, the time left) on its Nexus card | Asked and unanswered; not built | `PLAN.md:818`, `:1038` |
| Somewhere to find open worlds when yours is off | Not named as built | `PLAN.md:793` (D78) |
| A view of where a thing came from and of past receipts | "No view... yet" | `DESIGN_ASK.md:323` |
| Leaders on the map: held ground as hatching with a hard seam, structures as marks by shape | Designed, not built | `DESIGN_ASK.md:405` |
| The guildhall's posted chains and a warning post for a titan | Not built | `PLAN.md:1044`, `DESIGN_ASK.md:439` |
| Residents visible in the hub; materials stored and shown in rooms by their grain | Planned (Wave 11) | `PLAN.md:1107-1108` |
| The city: about half of it is empty, unnamed ground ("Decide what that is"), and STATUE and ARENA are defined with nothing built from them | Open | `DESIGN_ASK.md:284` |
| Bank and Holdings "overlap badly today. Unify them" | Partly answered | `DESIGN_ASK.md:290` |
| A hover card on a map's sectors and lots; where a card sits on a crowded map | Not stated; open | `DESIGN_ASK.md:258`, `:134` |
| Moving a world's file, which has no interface; a refused save, which leaves a blank character with no word why | Open | `HANDOVER.md:107`, `:326` |
| The identity, hub selection and world creation screens | Status not stated | `DESIGN_ASK.md:276-286` |
| Decided in leg 1 and not built, each a small change to a view: the city bar shows what waits after a level (Q28); energy shown in the city wherever it is spent (Q26); a lot's weekly tax on the deeds screen (Q34); a world's card names its maker and counts its agents (Q5, Q41); the recon line says which count it is and marks leaders and packs (Q40, Q44); identical pieces in a bin merge with a count (Q38); a receipt hides the worth of unread pieces (Q12) | Decided, not built | `DESIGN_QUESTIONS_LEG1.md` |

## 3. Flows

| What | Status in the record | Where |
|---|---|---|
| Acts laid out for a character to take while its player sleeps, on the server's clock | Asked 2026-11-11. Nothing queues an act. | `BALANCE_RUN.md` 3.7 |
| The crafting window. Pedro: "we need the crafting interface (componet + component and input to send to haiku what the person wants to make" | Listed under Wave C's second pass. Crafting by two (one material on another) was built since; the window that says what you want was not. | `PLAN.md:834` (D119), `:950` |
| Character creation as four screens (who you were, what you carry, the world's face, the conversation) | The records disagree: eight choices and the questions are built, the status table says planned | `PLAN.md:733-744`, `:1042`, `:1362` |
| An escort that walks beside you and fights, carried as a heavy body if it falls | Ruled, not built | leg 1, Q16 |
| Identify as a learned skill, town only; the IDENTIFY button goes | Ruled, not built | leg 1, Q27 |
| A talk that shows no cost, and asking what someone wants on the mind's attributes | Ruled; the ask was built since, by the code | leg 1, Q50 |
| A toll for a solitary elite: "a new interaction, with a reader to write" | Nothing built | `DESIGN_ASK.md:342` |
| The guild's chain of quests from a map handed in | Designed, not built | `DESIGN_ASK.md:409-417` |
| The tutorial stays open while a newcomer's own world is written | Ruled 2026-11-04, not built | ledger L1 |
| Resting outside a world as a night that loads while the dream plays | The other option was built | ledger H10b |
| Taking someone on at the bench "has words and no effect"; what a failed tax evasion costs is unsaid | Open | `PLAN.md:816`, `:815` |
| A bargain menu for a creature that can be talked to | Wave C's second pass | `PLAN.md:829` (D114) |
| Players pooling materials for a resident to move in | Not built | `PLAN.md:358` |
| Resuming a run after a reload in the middle of it | "Pedro's open question" | `PLAN.md:485`, `HANDOVER.md:317` |

## 4. Moments with no interface

- A lore misreading: it shows as a large amount and wears down (asked 2026-11-11; `BALANCE_RUN.md` 3.7).
- How a body shows what it has become to someone who cannot read its card: a mark for each property by shape (`BALANCE_RUN.md` 2.12; D131).
- Securing someone for an escort is "not designed as a moment of its own" (`DESIGN_ASK.md:322`).
- A lot foreclosed has only its mark in the hub's art (`DESIGN_ASK.md:324`).
- A session ended by withdrawing from recon has no receipt, "by design for now" (`PLAN.md:349`).
- The vault's refusal shows while the field keeps running under it, so a creature can still bite (`PLAN.md:478`).
- Any error in the loop freezes the game with no word (`HANDOVER.md:307`); one inside the app was caught since.
- A gate that closes with nothing carried reads as a death (leg 1, Q42, wording).
- What a challenge asks of a player is "not settled" (`PLAN.md:849`, D134).
- Where a hub and its people go during the seven days the biggest world is off (`PLAN.md:795`).

## 5. Systems ruled on and not designed

| What | Status in the record | Where |
|---|---|---|
| A material's properties becoming a piece's numbers, through study | Pedro: "Still to design"; the study loop is the step | `BALANCE_RUN.md` 3.5 |
| Lore as a good: a held skill written out as a piece to trade, and the board asking for lore; two kinds of lore | Asked 2026-11-11; the roll's numbers are with the lore pass | `BALANCE_RUN.md` 3.7 |
| What hides what the game exposes: an item's Made of, Chain and Labor rows, a talk's printed roll, the Hall's figures; a stranger's regard and want on the card; names in the city | "A later pass" with no stream (D127) | `PLAN.md:842`, ledger C26, C27 |
| Noticing: a person noticing a creature, sight as noticing, an unseen blow | The hiding pass | `BALANCE_RUN.md` 2.12 |
| An observation skill: without it, question marks and a toughness that may mislead | Ruled (D131), not built | `PLAN.md:846` |
| A limit on recon tied to the mind's attributes. Pedro: "there's a limit to recon, it will be tied to mental stats." | Not built | `PLAN.md:800` |
| The fight's missing sides and a person's wind-up; a mount; frames with a rank and a mint | The balance run's calls and design list | `BALANCE_RUN.md` 2.11, 2.12 |
| Player magic's real work. Pedro: "we inserted it, we haven't made it operational yet." Tome casts, set effects, a boss's phases, more effects and triggers | "No stream yet" | `PLAN.md:812`, `:877-878` |
| Leaders and the ground they hold: parties, the titan, shares of what falls, the weekly call | Approved as written; partly built | `DESIGN_ASK.md:327-448`, `PLAN.md:1013` |
| Lots that grow with the hub; stairs and a second floor; what a house is for | Waits on the hub's growth | `PLAN.md:361`, `:600` |
| Bonuses from what a piece of furniture is made of; plans and scrolls that inherit from their paper and ink | "Still to build" | `PLAN.md:292` (D9), `:444` |
| A farm's lot and what a resident costs; public housing; "nothing pays a person for their time" | Open | `PLAN.md:293-294`, `:838` |
| The market, a currency, an auction house; a guild buying from a person | Types and no system | `PLAN.md:770`, `HANDOVER.md:367` |
| Camps by trade, how a creature becomes another, raiding parties, migration, guilds, who may release what is caught | Wave C's second pass and later | `PLAN.md:775-780`, `:827` |
| One mapping across sectors (C10); the dungeon arc of creatures talked round (C8) | Wave C's second pass | `PLAN.md:951-952` |
| A world that never retires and grows tougher; a local model when there is no key | Ruled; the local model was built since, by the code | leg 1, Q43, Q24 |
| Theme generation by meaning from the stored content: "special quest zone... not done yet" | Ruled, partly built | leg 1, Q1 |
| What becomes of what already exists when the numbers move: levels, pieces with baked numbers, worn frames | No migration designed | `BALANCE_RUN.md` 2.12 |
| The attributes pass: "connect stats to atributes to make the character feel different each time" | Planned (D52) | `BUILDERS_LOG.md:287` |

## 6. Art, sound and words

- Sound: the game has none (`DESIGN_ASK.md:458`, ledger C33).
- An icon pass for the small map's marks. Pedro: "that's why I asked for an icon pass in the design. but yes, that's later" (`PLAN.md:804`).
- Stations told apart by name and card, not by outline; eleven want one (`PLAN.md:361`, `BUILDERS_LOG.md:140`).
- A resident drawn in the player's figure (ledger L17); walls of stone and plank that are near twins in grey (`PLAN.md:405`); a satchel muddy at large cells (`PLAN.md:391`).
- A typeface: a real pairing, or a pixel face (`DESIGN_ASK.md:454`). A guide for the game's voice (`DESIGN_ASK.md:459`).
- The strengths of the colour-vision settings were never judged by an eye of the kind they are for (ledger C29).
- Seventeen bosses are stubs: "content must be written" (`PLAN.md:693`).
- Words: "terminology needs to be earned, never thrusted out at the user" (`PLAN.md:959`). A registry of earned terms, and a check that scans the interface for system words, are leg 4, not started.

## 7. Passes the plan names that have not happened

| Pass | What it is meant to hold | Where |
|---|---|---|
| Leg 3, the design handover | Every screen, word and number marked a guess, and the questions of sprite and feel | `PLAN.md:966` |
| Leg 4, exposition out | The registry of earned terms; eight leg 1 wordings wait here | `PLAN.md:967` |
| The hiding pass (D127) | What the game exposes; it comes after the end-to-end playtest | `PLAN.md:842` |
| Wave C's second pass | C6, C7 (the crafting window), C8, C10, C11, the stat wall, C13 | `PLAN.md:969` |
| Wave 11 and 11C | The hub remade, residents, farms, people who adventure | `PLAN.md:1090-1108` |
| Wave 12 | The honest test and its balance | `PLAN.md:1125` |
| Wave 13 | The served runtime | `PLAN.md:897` |
| The balance program | The rarity rescale, the fight's rebalance, the design pass | `BALANCE_RUN.md` |

## 8. Where the records disagree, or are old

- Drag. The handover says in one place that the pack has no drag and in another lists the hands moving anything anywhere (`HANDOVER.md:324`, `:135`). The code has the drag.
- Character creation: built as eight choices in one record, "planned" in the status table (`PLAN.md:1042`, `:1362`).
- Identify: the design ask describes reading in the field as a gamble; his later answer says nothing is read before town (`DESIGN_ASK.md:245`; leg 1, Q27).
- The magic and content layer: the plan's header says built and awaiting approval, a later line says "nothing built" (`PLAN.md:5`, `:654`).
- Leg 1's list says "Nothing is left open" and also that no entry is answered in code (`DESIGN_QUESTIONS_LEG1.md:11`, `:7`). Its 29 decided entries may have been built since; the readers could not tell.
- The bank's stash as thumbnails and not a grid is in the builders' log as open and was made a grid later (`BUILDERS_LOG.md:139`, `:227`).
- Of the 53 open rows in the ledger, 21 are in this list as design and 32 were left out as bugs or tuning.

## 9. Not read

`DEPLOY.md`, `DATA_LAYER_PLAN.md` and `STAT_TREES.md` were not read for this. `PLAN.md`'s test lines 105 to 166 were read but not checked against the code. The code was read only for the four points of section 1, and there only in part: the whole of `WorldCanvas.tsx` and `PlayerHub.tsx`, the hover card, selling and discarding, and the tests were not read. Nothing was run or opened on screen.
