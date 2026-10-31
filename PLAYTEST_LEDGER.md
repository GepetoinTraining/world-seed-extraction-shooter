# Playtest ledger

Things to fix, found by playing. Add a row when something is found, with what happened in plain words. Move it to Fixed with the commit when it is done and checked. Design decisions stay in `PLAN.md`; this is the list of what is wrong.

## Open

### Found by Pedro, 2026-10-31

| # | What happens | Where | Plan |
|---|---|---|---|
| P1 | Opening a ground cache with a full pack duplicates its contents, one copy per press | `src/entities/player/store.ts`, `int_open_` branch | Usability pass, line 57 |
| P2 | A stray backdrop click or Escape discards the whole mint-world draft | `src/components/WorldCreator.tsx`, kit `Modal` | Usability pass, line 58 |
| P3 | A pack item cannot be moved to a chosen cell | `src/components/WorldCanvas.tsx` pack grid | Usability pass, line 59 |

### Found in the usability review, 2026-10-31

Seen on TENON at `localhost:3105` at 1280×800, with the input code read alongside.

**Controls**

| # | What happens | Where |
|---|---|---|
| U1 | Every shot needs its own click; holding the button does nothing | `handleCanvasClick` in `WorldCanvas.tsx` |
| U2 | The field has no interact key, while the city uses E, so the same action has two controls | `WorldCanvas.tsx`, `HubCanvas.tsx` |
| U3 | Firing and interacting share one click: clicking near a resource or chest opens it instead of firing, even in a fight | `handleCanvasClick` |
| U4 | Nothing in the game can be dragged: no pack, stash, body slot or cart | No drag handling in `src/components` or `src/entities/hub` |
| U5 | Digit keys reach only the four belt pouches; hands and tools have no hotbar, and the HUD does not show what is in them | `WorldCanvas.tsx` HUD |
| U6 | Equipping an item takes opening the pack, clicking the item, then clicking EQUIP; the Agent tab asks for a slot first, then a list | Pack panel, `PaperDoll.tsx` |
| U7 | Withdrawing from a drop or leaving a run has no key | Field HUD, recon |

**Hovers and information**

| # | What happens | Where |
|---|---|---|
| U8 | Hovering an item in the pack or stash shows no card; the card needs a click | Pack grid, `PlayerHub.tsx` stash |
| U9 | No item can be compared with what is worn or held | `inspect.ts` has no comparison |
| U10 | Selecting a pack item grows the panel upward, so the grid moves under the cursor | Pack panel |
| U11 | Shop, cart, bench and body-slot items need the same check as U8 and U9 | Each window |
| U12 | The field shows raw coordinates such as `POS 158730, 168970` | Field HUD |

**Whether the views feel like a game**

| # | What happens | Where |
|---|---|---|
| U13 | The stash is a text list of rows, not a grid, with no sorting or filters | `PlayerHub.tsx` |
| U14 | SELL sits on every stash row and acts on one click with no confirmation, next to CARRY | `PlayerHub.tsx` |
| U15 | The Agent tab's body is empty outlined boxes, and the rest of the tab reads as a form | `PaperDoll.tsx`, `PlayerHub.tsx` |
| U16 | The city draws in a box with buildings cut off at its edges and large black margins, while the field fills the window | `HubCanvas.tsx` |
| U17 | There is no minimap in the field or the city | Field and city HUD |
| U18 | Recon opens as a near-black panel with browser scrollbars, a small side panel and instructions below | `WorldCanvas.tsx` recon |
| U19 | The hub selection screen adds a stop on every entry even with one hub | `HubSelector.tsx` |
| U20 | The top bar reads as a website: tabs, ONLINE, CONSOLE, BACKUP, SWITCH and USER, in the player's view | `App.tsx` |
| U21 | The HUD's key help runs into its data as one small wrapped line | Field HUD |

## Fixed

Nothing yet.
