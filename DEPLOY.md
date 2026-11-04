# Deploying World Seed for testing

Pedro, 2026-11-04: "develop out the API connections so we can test this deployed (I haven't yet decided the domain we'll use, it also needs a static landing page, account creation such and such... it's abrowser based game, should run on the person's own machine we simply check the receipts, the model itself needs a way to communicate with the game for the local test)".

This file is the split, written before it was built. The domain is configuration everywhere: nothing in the code names one.

## Two programs

**The runner, on the person's machine.** `npm run play` builds the game and starts `server/main.ts` on `127.0.0.1`. It is what the person's browser opens. It:

- serves the built game to that browser;
- holds the person's live store (Postgres on a folder, `data/…`), which is where their play is kept;
- holds the door to the model: Gemma or any other model through Ollama on the same machine, or a key the person inserts, kept in the runner's memory and nowhere else;
- holds the bridge to a hub (`/api/hub/…`), forwarding to the address in `WS_HUB_URL`. The hub's session token stays in the runner's memory, so the browser never holds it;
- tells the browser what time the game is (`/api/clock`): the hub's, read from its signed clock and counted forward on a steady counter the machine's clock does not move, or with no hub, this machine's own;
- answers this machine only, as every door here has since D31.

**The hub, deployed.** `npm run hub` starts `server/hub/main.ts`. It:

- serves the landing page (`landing/`), a static page apart from the game;
- holds accounts and sessions;
- registers a person's characters (the certificate the browser made, its public key) under their account, and answers with a statement it signs with its own key and its own time. That is D134's anchor: the character's certificate chained to the hub that issued it, with a time;
- checks receipts: a character's signed ledger rows, each signature against the registered key, each row onto the last. It keeps the rows it accepted, so it holds that character's head. A row that differs from one it already holds is a challenge (D134), kept beside the character, and the chain it held first stands. It answers each check with an acknowledgement it signs (the hub id, the character, the seq, the head row's hash, its time), which is the checkpoint "held by someone else" that D135's measurement asked for;
- keeps its own store on Postgres (a `postgres://` URL when served) and its record on Turso through the same keeper the game uses (`WS_RECORD=1`).

It does **not** run anyone's play, hold anyone's game store, hold a door to a model, or hold a model key. Nothing it serves reaches `/api/db` or `/api/intelligence`.

## Time (D135)

The game's time is Pedro's radix-chain clock (`lettersacrosssubstrate.dev/en/clock`). A moment's address is the day index N, counted from machine zero (JDN 2451911, a Monday in 2001), as its residues mod 2⁶, 3³, 5², 7², 11², 13², with the day's inner count beside it (3 blocks × 8 hours, 3 segments × 20 minutes, 10 turns × 6 seconds). The arithmetic is `src/logic/time/RadixClock.ts`, integer only. The game's own day number stays the Unix day (N + 11,323), so nothing stored as a day moves.

Every day the game reads comes from `GameClock` (`src/logic/time/GameClock.ts`), which takes its time from the runner and counts on the browser's steady counter between readings. Moving the computer's clock no longer moves the game's day. With no server read yet, as in the tests, it reads the browser's clock, as before.

Every ledger row now carries, inside what is signed: `v: 2`, `prev` (the SHA-256 of the row before's signature) and `clock` (the moment's address, and whose clock read it: the hub's id, `machine` or `browser`). One law checks it on every side (`src/logic/ledger/chainLaw.ts`): each row links to the one before, its address names its own time, and no day runs backward. Older rows stand as they were, and once a chain has a newer row every later row is newer. The hub adds two checks of its own: nothing from a day it has not reached, and a row whose link names a different row than the one the hub holds under it is a challenge. Because each row links to the whole history under it, the hub's head now certifies all of it, which closes D135's measured gap where a drop below a checkpoint went uncaught.

## Why the runner serves the game, and not the hub

The game's store and the model's door have to be on the person's machine (their play, their compute, their key). A page served from a public domain that reaches a server on `127.0.0.1` runs into the browsers' local-network gates: a permission prompt in current Chrome, and plain `http` from an `https` page in others. A page served by the runner itself has none of that: the store, the door and the bridge are on its own address. So the hub's domain serves the landing page and the accounts, and the game is opened from the runner.

## The model's channel, for a local test

The browser asks the runner's door (`/api/intelligence/…`), the same address the page came from. The door asks Ollama on `127.0.0.1:11434` (`WS_LOCAL_URL` to point it elsewhere, such as another machine on the person's network), or the free option the person picked with their own key. The machine check and the free options (`server/intelligence/machine.ts`, `door-options.json`) are read in the game's VOICE panel, under SYSTEM. Nothing about this goes through the hub.

## The routes

On the hub, mounted at `/api/hub`. Every `POST` takes JSON only, so another site cannot post here through a visitor's browser (a JSON body forces a preflight, and the hub answers none). A signed-in route takes `Authorization: Bearer <token>`.

| Route | Who | What |
|---|---|---|
| `GET /health` | anyone | `service: worldseed-hub`, the hub's id, its public key, its time |
| `GET /clock` | anyone | the hub's time as the clock's address, signed |
| `POST /accounts` | anyone | `{ handle, password }`: a new account |
| `POST /sessions` | anyone | `{ handle, password }`: signs in, answers a token |
| `GET /session` | signed in | who this is |
| `POST /session/end` | signed in | signs out |
| `POST /characters/nonce` | signed in | a one-time text for the character's key to sign |
| `POST /characters` | signed in | `{ certificate, proof }`: registers a character, answers the hub's signed statement |
| `GET /characters` | signed in | this account's characters, each with its held seq and standing |
| `POST /receipts` | signed in | `{ uid, rows }`: signed ledger rows, checked and held; answers the acknowledgement or the challenge |
| `GET /record/<uid>` | signed in | what the hub holds for a character: its seq, head hash, standing |

On the runner, `/api/hub/…` forwards these, holding the token, plus `GET /api/hub/where` (which hub, and who is signed in). With no `WS_HUB_URL` it answers that no hub is set, and the game plays on alone. It refuses a hub address in plain `http` unless that address is on this machine, so a token never crosses a network unencrypted.

## Accounts

Built here, with nothing outside: a hub anyone runs cannot depend on an account service someone else holds. A handle and a password; the password is kept as a salted scrypt hash and compared in constant time; a token is 32 random bytes, kept only as its hash. Repeated wrong passwords for one handle wait before they are tried again. No email is asked for, because no mail service is chosen, so there is no recovery yet.

## Configuration

| Name | Program | What |
|---|---|---|
| `WS_HUB_URL` | runner | the hub's address, for example `https://<domain>`; unset, no hub |
| `WS_HUB_DATABASE_URL` | hub | `postgres://…` when served; default a folder at `data/hub-test` |
| `WS_PUBLIC_URL` | hub | its own address, named in what it signs; default its listening address |
| `WS_HUB_KEY` / `WS_HUB_KEY_FILE` | hub | its signing key (PKCS#8 PEM, Ed25519), from the host's secret store; with neither, one is made into `data/hub-key.pem` for a local test |
| `WS_HOST`, `WS_PORT` | both | where it listens; the hub defaults to `127.0.0.1:3950`, and a host sets `0.0.0.0` |
| `WS_RECORD`, `TURSO_*` | both | the record, as before |

## A local test of the whole thing

```bash
npm run hub
WS_HUB_URL=http://127.0.0.1:3950 npm run play
```

Open `http://127.0.0.1:3950` for the landing page and make an account. Open `http://127.0.0.1:3900` for the game, sign in under SYSTEM, THE HUB, register the character and send its receipts.

## Not built, on purpose

- Rerunning a character's arithmetic on the hub, so a challenge can come from numbers that do not fit and not only from a rewritten row (D134). It waits on integer-only reruns.
- Timers inside a day: rests, crafting jobs and the like still count milliseconds on `Date.now()` in the browser. They move to `GameClock.now()` in their own pass.
- A hub that refuses a row signed while the game followed only its own machine. Today such a row is accepted if it is not from the future and fits the chain.
- Goods carried between hubs (the bag and the threading).
- Charging for model use, the market and its currency.
- A runner a person can start without Node and a copy of this repository.
