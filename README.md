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

`npm run dev` brings up the game and its database with one command: a SQLite file at `data/worldseed.db`, created on first run and never committed. The first load on a browser origin that holds old saves imports them, after verifying their signatures. If the database is not answering, the game refuses to open rather than guess.

To run the built game standing alone, on SQLite or on Postgres:

```bash
npm run build
```
```bash
npm run serve
```

`npm run serve` listens on port 3900, and reads `WS_DATABASE_URL` (`file:…` or `postgres://…`), `WS_PORT` and `WS_HOST`. **It has no authentication, so it answers this machine only. A real deploy needs a login in front of it first.**

The game runs on `http://localhost:3000`. The proof pages are under `/prototype/atoms/` (`index.html`, `hub.html`, `room.html`).

## Where to read

| File | What it is |
|---|---|
| `BUILDERS_LOG.md` | Start here: where the build stands, the next pass, the traps |
| `PLAN.md` | The test list, the decisions table, and the record of each wave |
| `DESIGN_ASK.md` | The one design document, with its settled record and measurements |
| `PLAYTEST_LEDGER.md` | What to fix, found by playing |
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