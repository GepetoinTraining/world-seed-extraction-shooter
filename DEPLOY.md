# Deploying World Seed for testing

Pedro, 2026-11-04: "develop out the API connections so we can test this deployed (I haven't yet decided the domain we'll use, it also needs a static landing page, account creation such and such... it's abrowser based game, should run on the person's own machine we simply check the receipts, the model itself needs a way to communicate with the game for the local test)".

Then, ruling on hosting: "If we need ACTIVE compute outside the player viewing the game, we built it wrong. We don't compute anything, we check receipts, this is math, vercel and players are computing view workers, the DB layer needs to be local (idb) or postgress for online play, we serve a postgress we socket to join them and keep it live speaking to the Turso DB, which they can't access, and they run the code locally on the browser, they send to us the world manifest, we simply check if everything is pre existing, what's not pre existing needs to pass a function to be checked if it doesn't break any rules. If it doesn't we accept, they continually play, what happens if it does break a rule is that we serve the corrected atom, and the item, or the loot table, or the world manifest gets the diff, never the full load."

The domain is configuration everywhere: nothing in the code names one.

## The split

**The game, in the player's browser.** A static site: the landing page at `/`, and the game at `/play/` (`npm run build:site` writes both to `dist-site/`). The game runs entirely in the page:

- its save is the game's own store (`SqlStore`, with all its law) on PGlite, which keeps its files in the browser's IndexedDB (`src/entities/data/BrowserStore.ts`). One tab holds it, by a Web Lock; a second tab is told so;
- its time is the hub's, read from the hub's signed clock and counted on the browser's steady counter (`GameClock`);
- its session with the hub rides in a cookie the page's scripts cannot read.

**The hub, as stateless functions.** One request handler (`server/hub/function.ts`), which a host such as Vercel runs per request (`api/hub/[...path].ts`, `vercel.json`). Nothing outlives a call but the store: a proof's one-time text is signed by the hub and carries its own account and expiry, and wrong passwords are counted in the store, so any instance answers the same. It computes nothing of play. It:

- holds accounts and sessions;
- registers a player's characters, answering with a statement it signs with its key and its time (D134's anchor);
- checks receipts: signed ledger rows, each signature against the registered key, each row linked to the one before, each moment its own and none from a day the hub has not reached (D135). A row that differs from one it holds, or links to a different one, is a challenge;
- checks worlds (below);
- keeps its store on a served Postgres (`WS_HUB_DATABASE_URL`), and its record on Turso through the game's own keeper (`WS_RECORD=1`). Players reach neither.

`npm run hub` runs the same function locally behind a plain Node server, serving `dist-site/` (or the landing page alone, before a build): the stand-in for the host.

## The world check

`POST /api/hub/worlds/check` with `{ manifest }`:

```
{ world: { worldUid, creatorCertUid, themeId }, themes: [theme packs], kinds: [line proofs] }
```

- The world's maker must be a character of the signed-in account. A world keeps the theme it was first checked with, and its maker.
- A theme the hub holds (shipped, or judged before by any instance) passes. A new one must carry an id that matches its words (`themeIdOf`) and keep the law (`ContentRegistry.install`, the browser's own law); then it is held as known. One that breaks the law is refused, with the law's reason.
- A creature kind the hub holds with the same definition passes. A new one goes through `CreatureLines.correctProof`, the browser's own line check. A line that does not prove itself is refused. Numbers that are not what its line makes are put right: the answer carries the corrected kind and JSON Patch operations on the manifest (`{ op: 'replace', path: '/kinds/0/def/baseHealth', value }`), never the whole load.
- The answer is signed by the hub.

**Not yet in the check:** items and their numbers, loot (which is code, not data: there is no table to diff), and the hub manifest. An item does not carry its definition today, and its numbers come from several formulas; that is the next atom to check.

## The routes

On the hub, mounted at `/api/hub`. Every `POST` takes JSON only, so another site cannot post here through a visitor's browser (a JSON body forces a preflight, and the hub answers none). A signed-in route takes the session cookie or `Authorization: Bearer <token>`.

| Route | Who | What |
|---|---|---|
| `GET /health` | anyone | `service: worldseed-hub`, the hub's id, its public key, its address, its time |
| `GET /clock` | anyone | the hub's time as the clock's address, signed |
| `GET /where` | anyone | this hub's address, and who is signed in here |
| `POST /accounts` | anyone | `{ handle, password }`: a new account |
| `POST /sessions` | anyone | `{ handle, password, keep? }`: signs in; with `keep: 'cookie'` the token goes into an HttpOnly, Secure, SameSite=Strict cookie and is left out of the answer |
| `GET /session` | signed in | who this is |
| `POST /session/end` | signed in | signs out, and clears the cookie |
| `POST /characters/nonce` | signed in | a one-time text for the character's key to sign |
| `POST /characters` | signed in | `{ certificate, proof }`: registers a character, answers the hub's signed statement |
| `GET /characters` | signed in | this account's characters, each with its held seq and standing |
| `POST /receipts` | signed in | `{ uid, rows }`: signed ledger rows, checked and held; answers the acknowledgement or the challenge |
| `GET /record/<uid>` | signed in | what the hub holds for a character: its seq, head hash, standing |
| `POST /worlds/check` | signed in | `{ manifest }`: the world check above |

## Time (D135)

The game's time is Pedro's radix-chain clock (`lettersacrosssubstrate.dev/en/clock`). A moment's address is the day index N, counted from machine zero (JDN 2451911, a Monday in 2001), as its residues mod 2⁶, 3³, 5², 7², 11², 13², with the day's inner count beside it (3 blocks × 8 hours, 3 segments × 20 minutes, 10 turns × 6 seconds). The arithmetic is `src/logic/time/RadixClock.ts`, integer only. The game's own day number stays the Unix day (N + 11,323), so nothing stored as a day moves.

Every day the game reads comes from `GameClock`, which takes its time from the hub and counts on the browser's steady counter between readings. Moving the computer's clock no longer moves the game's day.

Every ledger row carries, inside what is signed: `v: 2`, `prev` (the SHA-256 of the row before's signature) and `clock` (the moment's address, and whose clock read it). One law checks it on every side (`src/logic/ledger/chainLaw.ts`). Its SHA-256 is written out and synchronous (`sha256.ts`), so the browser and the hub reach the same digits. Because each row links to the whole history under it, the hub's head certifies all of it, which closes D135's measured gap where a drop below a checkpoint went uncaught.

## Configuration

| Name | Where | What |
|---|---|---|
| `WS_HUB_DATABASE_URL` | hub | the served Postgres (`postgres://…`); `npm run hub` defaults to a folder at `data/hub-test` |
| `WS_HUB_KEY` | hub | its signing key (PKCS#8 PEM, Ed25519), from the host's secret store. `npm run hub` makes one into `data/hub-key.pem` when none is named |
| `WS_PUBLIC_URL` | hub | its own address, named in what it signs |
| `WS_RECORD`, `TURSO_*` | hub | the record, as before |
| `VITE_WS_STORE=browser` | game build | set by `npm run build:site`: the save lives in the browser |

## A local test of the whole thing

```bash
npm run build:site
npm run hub
```

Open `http://127.0.0.1:3950` for the landing page and make an account, then PLAY IN THIS BROWSER (`/play/`). Under SYSTEM, THE HUB, sign in, register the character and send its receipts.

## The model, from the browser: not built yet

The game's voice is the door in `server/intelligence/`, which today runs on a server: in development, or under `npm run play` (`server/main.ts`, the runner), which still works and is now only needed for the voice. Played from the domain, the game plays on without one.

What reaching a local model from a page on the domain takes, checked 2026-11-04:

- **Ollama's allowed origins.** Ollama answers a browser only from local origins unless told otherwise, so the player sets `OLLAMA_ORIGINS=https://<domain>` once and restarts Ollama.
- **Chrome's Local Network Access.** A public page reaching `127.0.0.1` needs the player's permission, asked once. Since Chrome 145 it is its own permission, for loopback. A player who refuses is not asked again until they change it in the site's settings.
- **The door itself moves into the page.** The prompts, the law over what comes back and the local runtime are already free of Node. The machine check is not: a page cannot read the machine's memory or graphics card, only what Ollama reports (`/api/tags`, `/api/ps`) and the little a browser says.
- **A key the player inserts** would be called from the page straight to its provider. Whether each free option answers a browser (its CORS) is not checked; Anthropic's needs a header marking direct browser access.

## Not built, on purpose

- Online play: a served Postgres that players join over a socket and that stays live, speaking to Turso (the data layer's sockets phase, leg 5).
- Rerunning a character's arithmetic on the hub (D134). It waits on integer-only reruns.
- Items, loot and the hub manifest in the world check.
- A world certificate the hub can verify: the certificate keeps its signature but not the moment signed, and its stats change after signing, so nothing can check it today. The check ties a world to a character registered under the account instead.
- Timers inside a day (rests, crafting jobs) still count milliseconds on `Date.now()` in the browser; they move to `GameClock.now()` in their own pass.
- A Turso write-down for the hub on a schedule: a function host has no clean stop, so the marks wait in Postgres until a scheduled call writes them down.
- Goods carried between hubs, charging for model use, the market and its currency.
