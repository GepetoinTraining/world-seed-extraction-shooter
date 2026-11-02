# The data layer: a plan, not yet built

Pedro, 2026-11-01: "Backend and frontend mixed? We're using state and store as one thing... Tracking it might be the issue, we need the client side with idb and server side with postgress. This is actually a good time to plan the data layer and move a lot of the functions to utils, refactoring the code and making it simpler, removing the inlined data types and making them actual tables in relational DB... And planning for the web sockets and the hooks"

Nothing here is built. It is read against `claude/wave-c-integration`. Line counts and call counts come from a read of the tree on that branch. Sections 3 to 7 are the coordinator's proposal, and section 8 is what he decides.

## 1. What is there

| Where | What it does today |
|---|---|
| `hub/store.ts`, 2,650 lines | Game law, UI state and saving in one object. `buyLot` checks what you can afford, writes gold into the player's store, sets lots, commits the whole hub document, and logs |
| `player/store.ts`, 2,116 lines | The same, by way of `SessionJournal` and a subscription that saves |
| `src/logic`, 90 files | The law's home, but 20 import a store and 10 files across `logic` and `entities` import from `components`. So law reaches up into UI state |
| Law outside `logic` | `hub/money.ts`, `guild.ts`, `farm.ts`, `world/Population.ts` sit under `entities`. Pure helpers such as `binLoss`, `benchPay`, `printedPlus`, `vendorsToday` and `priceOfListing` sit inside `hub/store.ts` |
| Server tables | Four: `documents`, `ledger_rows`, `treasuries`, `commits`. No foreign keys |
| `documents` | About 23 kinds of JSON in one TEXT column, picked by id prefix. Only `type` and `genre` are columns, so every other filter parses JSON in the server |
| `hub_state_` | 13 fields, rewritten whole on each save: chunks, dismembered, planDeposit, lots, craftingJobs, rooms, buildJobs, web, guild, tech, vendors, craftsmen, farmland. About 930 KB after twelve empty weeks on a test hub, growing about 50 KB a week. `lots`, `rooms` and `vendors` embed whole items |
| The browser | IndexedDB holds certificate keys only. `StoreClient` is HTTP, by the rule "no second set of books in the browser", and a test enforces that |
| Dialects | libSQL is the default. Postgres and PGlite pass the same store contract test |
| Live updates | None. No WebSocket, no SSE. A 5 s tick drives rest and scan, and the vault polls health |
| Auth | None on the server, on purpose until Wave 13 (D45). Loopback only. Signatures are not checked on the server |
| Types | `types.ts` 1,031 lines, 28 declarations inside store files, and a 13-field inline type repeating the hub document at `hub/store.ts:540` |

**His read is right.** A zustand store here is at once the view's state, the game's law and the door to the database.

## 2. Why now

1. **The second pass makes it worse.** C6, C7, C8 and C11 all add to `hub/store.ts` and `hub_state_`. C3 alone added wallets, weeks, bins and belongings there.
2. **The crash lives in the driver.** `@libsql/client` 0.17.4 with no game code exits 139 after finishing in 7 of 10 runs that used transactions (N16). The dev server also goes down under refused commits, on `main` too. **The same load on PGlite, the Postgres path, in memory: 0 crashes in 5 runs, about 1,800 refused commits a run, against 8 of 8 on libSQL, which went down at about 550 to 1,200. Valid commits ran at about the same speed: about 210 in 15 s against about 240.** That is strong evidence for Postgres and not a proof: it was in memory, not on a folder, and libSQL's mid-run cause is still not found.
3. **Fan-out conflicts come from this shape.** Most of this wave's joins conflicted in `hub/store.ts`, and a name clash inside `IPopulationRecord` would have overwritten data if nobody had read it.

## 2a. The donor: `D:\-ttrpg-engine`

Pedro, 2026-11-01: "You do know we know how to postgres SQL, devoid the actual we sockets and all the good shit they have... We've actually built the data model of ttrpg to do exactly that." So this plan takes patterns from there and does not invent them. Read from its code, not run, and patterns only, as with earlier donors.

| What this plan needs | What `ttrpg` has | Where |
|---|---|---|
| Law with no database in it | `engine/` imports no database, and `world-tpb.ts` and `world-state.ts` are the only bridge | `CLAUDE.md:146` |
| What may be regenerated | "The database is `(seed, tpb_log)`. The cube is a function of that database." Seed-derived content gets no row, and caches can be rebuilt. **This game already works that way for land** | `README.md:12` |
| A write with a law on it | `writeDomain`, validated, and `attachWriteLog`, which captures a write as an action | `engine/tp.ts:862`, `tp-write-capture.ts` |
| Inheritance | `resolve` merges ancestors, child over parent, across 10 domains. Its ancestry is by place, not by type, so D129's tech web needs its own edge | `engine/tp.ts:403` |
| A tech node | `TechBlob`: purpose, tier, slots, dependencies, stats. Its seeds are thin, and no table holds it | `engine/technology-web.ts:74` |
| A catalogue of nouns | 179 tables, 206 references, 121 JSON columns, in SQLite's dialect. A reference for the shapes, not a schema to copy | `src/db/schema.ts` |
| The client's stores | `idb.ts`: certificates, a local log, a pending slot, a session. That is the outbox of section 6, already written | `src/lib/idb.ts:8` |
| The hook | `useWorld` hydrates from IndexedDB, fetches, and replays the log | `src/lib/use-world.ts:98` |
| Resuming a stream | An envelope with `sinceId`, falling back to polling | `src/lib/spectrum-client.ts:49` |
| Telling a client something changed | A `pg_notify` trigger, in the archive | `archive/bend/src/genesis/schema.sql:205` |

**What it does not have, so this plan writes it:**
- **Sockets.** There is no WebSocket anywhere in `ttrpg`. Its stream is one-way SSE over a one-second database poll.
- **Postgres in its live code.** It runs on libSQL through Drizzle, and Postgres is in its plans and archive. This game's side is the one with `drizzle.config.pg.ts` and now a Postgres store.

**What does not carry over:**
- **Byte-exact signatures.** It treats a signature as forensic, and this game's signed text is what a player carries between hubs (D81).
- **Its hourly drain.** The server there checks shape only and folds actions by cron. Here a commit is judged at once.
- **`Math.random`.** It is banned there and still in 14 engine files, so nothing comes across without a read.
- **5e sheet tables and Faerûn names**, which it is itself removing.

**What this changes below:** section 3's boundary and hook take its shape, section 6's outbox starts from `idb.ts`, section 7's envelope from `spectrum-client.ts` with `pg_notify` behind it, and section 5 gains a rule: **what the seed and a log can rebuild gets no table.**

## 3. Three layers, and which way they may import

```
components  ->  hooks  ->  state (zustand, view only)
                  |
                  v
              commands  ->  utils (pure law)
                  |
                  v
              data (repositories)  ->  client: idb + http + socket
                                       server: drizzle + postgres
```

- **`src/utils/<domain>/`: the law, pure.** Takes `now` and a key as arguments. It imports no store, no React, no `Date.now`, no `Math.random`, no `fetch`. `ShopWeek`, `money`, `Population`, `TalkLaw` and most of `logic/systems` already nearly fit. It is split by domain so that `utils` does not become one drawer. **A bar scans it**, as bars already scan for crime words.
- **`src/data/`: the repositories.** One per table family, for example `hubs.lots.buy(...)`. Only this layer knows SQL, HTTP, IndexedDB or a signature. Tests mock here, where today 26 files fake the store at various depths.
- **`src/commands/`: what happens.** `buyLot` reads through data, asks the law, commits through data, and emits events. It is the only layer that does all three, and it holds no state.
- **State: zustand, for the view.** It holds what the screen shows, filled by events. Nothing in it writes to the database. `useFeed` stops being imported by law: a command emits an event and the feed listens.
- **`src/hooks/`.** `useHub()`, `useLot(id)`, `useWallet(id)`, `useTalk(npcId)`. A component reads a hook and calls a command, and never imports a repository.

## 4. Two stores (D133)

Pedro, correcting this section: "one is cheap to store the other is the live service... You don't use the same thing for two jobs when they wildly differ in some performance. So postgress needs to run the client and love version, the downtimes are all done on sql". **So this is not one dialect.** Postgres is live, and a SQL file is the cheap store where downtime work runs. What moves between them, and what "client" means, is still to ask (D133).

**The live half, built as leg 0.** Locally, PGlite on a folder, so nobody installs a database to play. Served, real Postgres. It is the same SQL and the same migrations, which fits "the hub is a server anyone can run" (D81). The libSQL driver leaves the live path, and N16 went with it.

**The SQL half, Turso ("Use turso"), being built.** It goes through `@libsql/client`'s network entry, never a `file:` URL, because the crash was the native binding's. The entry loaded no native code in 10 of 10 runs. A real Turso has not been met.

**Postgres on Turso's own engine, checked 2026-11-01 on Pedro's word: not built on.** Its README lists Postgres under experimental features, and the project has not reached 1.0. Its `postgres/COMPAT.md` has no LISTEN/NOTIFY, no triggers, no functions, no authentication on the wire, and no VACUUM. Worth checking again at Wave 13.

**Measured 2026-11-01 on Pedro's word, built from source at `8ba16a6cb` and run against our store:**
- It builds on Windows with workarounds: 687 s and 1.8 GB for the Postgres server, 252 s to rebuild after one `core` file changes. Its own 1,111 tests pass.
- Our migrations ran with zero errors, a 1 MB document came back byte-exact, and 20 of 22 contract tests passed on the first run, 21 with a 13-line change that brought `VACUUM` through. No crash in 6 runs.
- Not usable as it stands: about 4% of reads fail with `55P03 Database is busy` under ordinary write load, and about 2,680 in 15 s with maintenance running. A wrong password connects. There is no `LISTEN/NOTIFY` and no triggers. `integer` has no range check. Durability and kill recovery were not tested, and an integrity check could not be run.
- `D:` holds no Rust database engine and no code that fills these gaps: the survey found one storage engine, `fractal_store`, and no query or transaction layer.
- **So this plan does not fork it.** It would be one engine doing two jobs, which D133 rules against, and a fork of something moving at about 390 commits a month. Look again at Wave 13. `tests/database.store.test.ts` already runs the contract on PGlite and Postgres, so this is the cheapest phase to prove.

## 5. The tables

**Stay as signed or content-addressed bodies, with columns beside them.** Signatures cover exact bytes, so these cannot be split without breaking every signature: the player document, `ledger_rows.data`, the session journal, provenance rows, world certificates, theme packs and content packs. They stay as exact text, as now, plus columns for what is queried.

**The foundation is the tech web (D129).** Pedro: "make the foundation the tech web, atop it make the entities inherit characteristics". So tech nodes and edges are the first tables, and what an entity can do points at them. The order below is the order of moving data; the shape of every family starts from that table.

**Become relational, in this order, the worst growth first:**

| Family | Tables | From |
|---|---|---|
| Items | `items` (id, def, owner, place_kind, place_id, slot, body) | Whole items embedded in `lots`, `rooms`, `vendors`, stashes. Moving an item becomes one row, and it stops a document growing |
| Vendors | `vendors`, `vendor_books`, stock through `items` | `hub_state_.vendors`, where parts and bins grow |
| Ground | `hubs`, `hub_chunks`, `lots`, `rooms`, `build_jobs`, `craft_jobs` | `hub_state_` |
| People | `residents`, `craftsmen`, `wallets`, `quests`, `building_asks`, `talks`, `talk_lines` | `guild`, `talk_`, `wallet_`, `brought_` |
| The guild | `guild_books`, `guild_maps`, `trophies`, `prints` | `guild`, with `trophies` and `maps` having no removal today |
| Tech | `web_nodes` (with `silent`), `workshops`, `chain_goods`, `chain_stations`, `chain_materials`, `material_ledger` | `web`, `tech` |
| Land | `farms`, `beds`, `herds`, `registers`, `register_entries` | `farmland` |
| Worlds | `world_sectors`, `world_leaders`, `holdings`, `chests`, `carts`, `director_state`, `scan_batches` | `world_population_`, `world_chests_`, `world_carts_`, `director_`, `scan_` |

**Types come from the tables.** Drizzle's inferred types are the source, in `src/data/types`, and the wire and view types derive from them. The 28 declarations in store files go, and so does the inline hub type.

**What the seed and a log can rebuild gets no table,** as in the donor. A world's land is computed, and no table stores it. The golden vectors stand throughout. Tables are for what people did and own, and what cannot be computed back.

**Foreign keys, and the audit stays.** `GoldAudit` still adds the ledger back up. Relational integrity does not replace it, because a signed row is what a player can carry to another hub (D81, D82).

## 6. The client: IndexedDB

**Recommended: a cache and an outbox, and the server still decides.** Reads come from IndexedDB at once and refresh from the server. A write goes in the outbox with its `commitId`, which is already idempotent, and leaves when the server is reachable. A refused commit rolls the view back and says so. That turns "the server is down, so nothing can happen" into a wait, and keeps "no second set of books": the outbox holds what is not yet true.

Dexie is installed for the legacy import and `idb` is not. Either would do, and `idb` is thinner. The existing test that enforces no second book gets rewritten to say what this says, so the rule changes on purpose.

**Field play.** D94 has values computed by the client and merged, first touch owning. The session journal already works like that, so a dive keeps working on the journal, and the outbox is the same shape. D134 adds what happens later: the server repeats the reading on its own time, and a mismatch overwrites the player's table and bans them. So a write that left the outbox can still be undone, and a commit needs to record which reading it made.

## 7. WebSockets

**Commands stay HTTP, events come over a socket.** A commit is already an idempotent POST with refusals and conflicts as answers. A socket carries only what changed, told by `pg_notify` on a served Postgres and by the store itself on a folder:

```
server -> client   { channel: 'hub:<id>', seq, table, op, id, row }
client -> server   { subscribe: 'hub:<id>', since: <seq> }
```

- **Channels:** a hub, a world while it is open, a person's own bank.
- **Resuming:** every event has a sequence number per channel, so a reconnect asks for what it missed. If that is too far back, it refetches.
- **Hooks:** `useLot(id)` reads state, and state is filled by the first read and by events. A component does not know which.
- **Locally, the same path.** One player on PGlite still goes through the socket, so a served hub is not a second code path, and the 5 s tick becomes a server job.
- **Auth comes first (D45):** "no public route before authentication". A socket is a route. It is a challenge signed by the certificate, which the browser already holds. Until then the socket stays loopback only, as the store does.
- **Where a tick lives:** on a served hub, rest, scan and the week run on the server, once. `closeWeeks` reading only the person present (ledger W3) stops being a limit then. That is Wave 13's work, and this plan gets it its seam, not its whole.

## 8. The order, and what Pedro decides

Each phase leaves the game playable and changes no behaviour. **The golden vectors, the gold audit and the 2,621 bars are the safety net,** and a phase is done when they pass unchanged.

| Phase | Work | Can fan out? |
|---|---|---|
| 0 | Merge Wave C's first pass | No |
| 1 | Move pure law to `src/utils/<domain>`, with the import bar | Yes, by domain, once the store is split into files |
| 2 | Split `hub/store.ts` and `player/store.ts` into commands, data and view state. Events replace `useFeed` in law | One stream per store, in order |
| 3 | Postgres as the one dialect, PGlite locally, a tool that carries a saved database over | One stream. Rehearse on a copy of Pedro's save before touching it |
| 4 | Tables, tech web first (D129), then section 5's order, each with a migration. C13 meets this | Yes, per family, once phase 2 stands |
| 5 | IndexedDB cache and outbox, hooks, and the clock's address as the time source (D135) | One stream |
| 6 | Certificate auth, then the socket | One stream, the door to Wave 13 |

**Decisions, recommendation first:**

1. **When?** Recommended: after merging the first pass, before the second. Phases 1 to 3 at least, so that C6, C7, C8 and C11 are written in the new shape. The other way is the second pass first, which puts the end-to-end playtest sooner but moves more code twice.
2. **Local database?** Recommended: PGlite on a folder, so that anyone can run a hub with no install. The other way is requiring a Postgres install, which is simpler to reason about and harder for anyone hosting at home.
3. **What IndexedDB is for?** Recommended: cache and outbox, with the server deciding. The other way is real offline play with merging, which is much larger and collides with D81 and D82 on who is to be believed.
4. **Your saved games?** Moving them is one-way. Recommended: a tool that reads the old file and writes the new one, keeping the old file untouched. The other way is to start your world over at phase 3.

## 9. Risks

- **Signed bytes.** Anything signed must stay byte-exact. Reading `saveHubState`, it also signs the player's bank on the way, so that is untangled in phase 2, with a bar.
- **A big diff.** A refactor at this scale will conflict with any stream running during it, so nothing else writes to a store while its phase runs.
- **Determinism.** Law taking `now` as an argument is a real change in many signatures. Bars hold keyed rolls as they are.
- **PGlite on a folder is unmeasured.** Section 2's run was in memory, so phase 3 starts by repeating it on disk. PGlite takes one connection at a time, which suits a single player and is not a served hub.
- **Tests.** 26 files fake the store at different depths, so moving the seam moves many of them. Moving a bar is allowed. Weakening one is not.
