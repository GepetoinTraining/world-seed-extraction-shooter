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

### Found while building the usability pass

| # | What happens | Where |
|---|---|---|
| B1 | A worn bag raises the limit the HUD shows, but a pickup is still measured against strength alone, so the extra capacity cannot be filled by picking things up | `tryAddItems` in `src/entities/player/store.ts` |

## Fixed

| # | What was wrong | Commit | Checked |
|---|---|---|---|
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
| N1 | Found by the conservation bar: two caches left in one millisecond shared an id, and taking one took both | b5cd6ea | Bar |
