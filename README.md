# World Seed

A browser extraction game built on a signed identity, generated worlds and a permanent ledger. Saves live in a SQL database on a small local server, and private keys stay in the browser.

```bash
npm install
```
```bash
npm run dev
```
```bash
npm test
```

`npm run dev` brings up the game and its database with one command: Postgres in process (PGlite) on the folder `data/test-claude`, created on first run and never committed, so nobody installs a database to play. The first load on a browser origin that holds old saves imports them, after verifying their signatures. If the database is not answering, the game refuses to open rather than guess.

One process holds a database folder at a time. A second dev server in the same checkout is told so in the game and in its log; give it its own folder with `WS_DATABASE_URL=pglite://<folder>`. A killed server loses nothing it acknowledged. A folder does not survive a power cut as a served database does: PGlite never forces a write to the disk.

A save from before the move is a SQLite file, and it is never opened or changed by itself. If the game finds one with no folder, its vault offers **CARRY THIS SAVE OVER**, which needs no account. It takes the file with its log beside it, writes a new folder, checks every row, and leaves the old file as it is. By hand, it is:

```bash
npm run db:carry -- data/test-claude.db data/test-claude
```

The `CARRIED` line and the `.carried.txt` receipt beside the folder are what say it worked, because they say what was checked.

### The record

Postgres runs the live game. **Turso holds the record** (D133): a commit lands on Postgres and never waits on the network, and at a downtime (a world's gate going down, maintenance, a clean stop) everything changed goes up as one write-down, whole, once, and read back before it counts. A new database for that game comes up from the record.

Only `npm run pedro` keeps a record, so `npm run dev` and test servers never write into it. It reads `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` from the root `.env`. With neither, or with Turso not answering, the game plays on and says so once, and what has not gone up stays marked until it can. To send an old save straight up instead of to a folder:

```bash
npm run db:carry -- data/test-pedro.db --to-record
```

Pedro's own game has its own database and its own port, so a test session can never touch it:

```bash
npm run pedro
```

That plays on `data/test-pedro` at `http://localhost:3200`. It first syncs the shared base with `test-claude`: the definitions, every item's history and the registry of claims, in both directions, and nothing that belongs to a character. If a server is running on either folder the sync cannot run: this says so and plays on. `npm run db:sync` runs the sync alone, and fails if it cannot.

To run the built game standing alone, on a folder or on a served Postgres:

```bash
npm run build
```
```bash
npm run serve
```

`npm run serve` listens on port 3900, and reads `WS_DATABASE_URL` (`pglite://<folder>` or `postgres://…`), `WS_RECORD=1` to keep a record, `WS_PORT` and `WS_HOST`. **It has no authentication, so it answers this machine only. A real deploy needs a login in front of it first.**

The game runs on `http://localhost:3000`. The proof pages are under `/prototype/atoms/` (`index.html`, `hub.html`, `room.html`). A newcomer's first order is the tutorial world, which stays open while their own world is written.

### The voice

Everything the game asks a model goes through one door on the server (`server/intelligence/`), never from the browser. A person picks how it answers, under SYSTEM:

- **auto:** the server's own key while there is one, the local model while there is none.
- **local:** a model on the person's own machine, through Ollama (`WS_LOCAL_URL`, default `http://127.0.0.1:11434`; `WS_LOCAL_MODEL`). Any served model may be picked. Gemma 4 (`gemma4:e4b-it-qat`, or `e2b` on a smaller card) is only the suggestion.
- **keyed:** a free option on the person's own key, read from `server/intelligence/door-options.json` (`WS_DOOR_OPTIONS` names another file). The key stays in the server's memory and is never sent back.
- **off:** every door still answers, and the game goes on with no voice.

Before it offers local, the game checks the machine: whether a runtime is there and running, the card and its memory, RAM, and the models served. It then says plainly **RUNS HERE**, **CAN RUN HERE** or **NEEDS A KEY**. **TRY** times one question on a chosen model. The check never blocks a choice.

A world is written in passes, in a world's own order: geography, then water and mountains, then where flora and fauna live, then creatures and professions. Each pass picks from what the database already holds, found by counting with no embedding model, and adds only what is missing.

## Where to read

| File | What it is |
|---|---|
| `BUILDERS_LOG.md` | Start here: where the build stands, the next pass, the traps |
| `PLAN.md` | The test list, the decisions table, and the record of each wave |
| `DESIGN_ASK.md` | The one design document, with its settled record and measurements |
| `PLAYTEST_LEDGER.md` | What to fix, found by playing |
| `DESIGN_QUESTIONS_LEG1.md` | Every design question from the integration pass, with Pedro's answers |
| `DATA_LAYER_PLAN.md` | The plan for the rest of the data layer, not yet built |
| `HANDOVER.md` | Systems, data model, signing, determinism, tuning and debt, with the Wave 7 test run |
| `types.ts` | The contract |
| `agent.md` | The founding vision, in its original words. Its prime directive stands; its stack, file layout and roadmap describe 2025 and were kept as written |

## The original brief

The text below is the 2025 brief that started the work. `PLAN.md` cites its numbered items, so it stays as written.

Hey gemini, how are you this morning! hope you`re doing fine! we're now going to hook up this mock data project to an actual running database. Our end goal vision is to use a vector db to serve as the principle engine for generating an extraction battle and use a relational DB for the hub and character loading... I believe that to make this happen we'll need to do a few things



1. Create the cert generation and reading system to make character progression true.

2. Crete the Hub/World cert generation to sign the ledger and create our source of truth.

3. create a service that generates the JSON we'll load as an extraction battle.

a. We need the other entities to populate the JSON:

I. Extractables(natural resources)

i. Fauna related (e.g.: grassy seeds (grains), Shrubs (berries...), Fruit (all kinds of food bearing and poison bearing fruits), Trees (logs and sapplings).

ii. Mineral related (mining, colecting sand (glass and others), collecting rocks and pebbles (smaller portion of a rock that is minable).

ii. Geographical features (Texture and where these above elements are placed)

iii. Ruins and buildings that are containers for mobs, loot chests and Lore.

iv. npc entity (a character like randomly rolled sheet that needs to be extracted through a social interaction.)

b. we need to create the weight mechaninc, making the inventory weight a reality, this needs 2 different vectors of action, size of objects (inventory tetris) and weight of objects (density of material and ammount to carry).

4. Test a game out. (we need to fix the movement speed in game... my character is flying around the chunks)

5. Do this list again to implement next wave.