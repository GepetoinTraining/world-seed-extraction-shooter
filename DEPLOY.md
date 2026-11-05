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
{ world: { worldUid, creatorCertUid, themeId }, themes: [theme packs], kinds: [line proofs], loot: [loot tables], items: [items] }
```

- The world's maker must be a character of the signed-in account. A world keeps the theme it was first checked with, and its maker.
- A theme the hub holds (shipped, or judged before by any instance) passes. A new one must carry an id that matches its words (`themeIdOf`) and keep the law (`ContentRegistry.install`, the browser's own law); then it is held as known. One that breaks the law is refused, with the law's reason.
- A creature kind the hub holds with the same definition passes. A new one goes through `CreatureLines.correctProof`, the browser's own line check. A line that does not prove itself is refused. Numbers that are not what its line makes are put right: the answer carries the corrected kind and JSON Patch operations on the manifest (`{ op: 'replace', path: '/kinds/0/def/baseHealth', value }`), never the whole load.
- The answer is signed by the hub.

- **Loot tables** (Pedro: items and loot "should be deterministic and only updated by LLM, checked"). A table is an atom beside its theme (`src/logic/theme/LootLaw.ts`): a model writes it in bands (what drops, how often, how many, at what rank), the formula turns the bands into whole numbers (`lootNumbers`, a chance in parts per million), and its id is computed from its words, so a table written again is a new table. A table the hub holds passes; a new one stands before `LootLaw.correct`: a word the game does not know, a key its theme does not hold, or a table that fits no creature is refused, and numbers that are not the formula's come back as `/loot/0/lines/1/chance` operations. Nothing but a model writes one: `LootWriter` asks for a theme's tables the first time a world of that theme is entered, through the pool or the player's own door, and a theme with none yet drops as the old code did.
- **Items.** Each is checked against the definition it was minted from (`src/logic/content/ItemLaw.ts`): found gear's rank, level, power and worth (the factory's own arithmetic from base, rank, rarity and quality), a material's rank and rarity. What is off comes back as `/items/2/itemPower` operations. An item minted from nothing the world's themes hold is refused. A made thing's worth is its chain's, so it comes back as not checked, and says so. Rolled base stats and affixes come from a stream the hub does not hold, and are not judged here.
- **Not yet in the check:** the hub manifest itself.

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
| `POST /receipts` | signed in | `{ uid, rows, reading?, sessions?, tables? }`: signed ledger rows, checked and held, then rerun (D134 below); answers the acknowledgement, with the hub's own reading, or the challenge |
| `GET /record/<uid>` | signed in | what the hub holds for a character: its seq, head hash, standing |
| `POST /worlds/check` | signed in | `{ manifest }`: the world check above |
| `POST /pool/join`, `/pool/leave`, `/pool/beat` | signed in | the pool: `{ voice: 'keyed' \| 'local' }` to join |
| `GET /pool` | signed in | who is in the pool, with what, what each has done and spent |
| `POST /jobs` | signed in | `{ kind, path, body }`: shared work, for a kind the hub has a law for |
| `POST /jobs/take`, `/jobs/done` | signed in | a member's turn, and its answer handed in to be checked |
| `POST /jobs/withdraw` | signed in | `{ jobId }`: the poster takes back a job it stopped waiting for |
| `GET /jobs/<id>` | signed in | a job's state, and its checked result |
| `GET /hosted` | anyone | the world this hub hosts |
| `POST /hosted/connect` | signed in | `{ uid }`: the account and the character's standing checked, the world served |
| `POST /live/get`, `/live/query`, `/live/commit` `?uid=` | signed in, let into our world | online play, on the hosted server only (below) |
| `GET /live/socket?uid=` (upgrade) | signed in, let into our world | the world's events, by number |

## Time (D135)

The game's time is Pedro's radix-chain clock (`lettersacrosssubstrate.dev/en/clock`). A moment's address is the day index N, counted from machine zero (JDN 2451911, a Monday in 2001), as its residues mod 2⁶, 3³, 5², 7², 11², 13², with the day's inner count beside it (3 blocks × 8 hours, 3 segments × 20 minutes, 10 turns × 6 seconds). The arithmetic is `src/logic/time/RadixClock.ts`, integer only. The game's own day number stays the Unix day (N + 11,323), so nothing stored as a day moves.

Every day the game reads comes from `GameClock`, which takes its time from the hub and counts on the browser's steady counter between readings. Moving the computer's clock no longer moves the game's day.

Every ledger row carries, inside what is signed: `v: 2`, `prev` (the SHA-256 of the row before's signature) and `clock` (the moment's address, and whose clock read it). One law checks it on every side (`src/logic/ledger/chainLaw.ts`). Its SHA-256 is written out and synchronous (`sha256.ts`), so the browser and the hub reach the same digits. Because each row links to the whole history under it, the hub's head certifies all of it, which closes D135's measured gap where a drop below a checkpoint went uncaught.

## The hub does the same arithmetic (D134)

Pedro: the player and the hub "need to have the same reading done at different times, without each knowing the other", and what a mismatch costs: the minted character's standing, never the player ("they can log back in, be the god in their own browser"). The rows are held as sent; then the hub reruns what it can rerun exactly (`server/hub/rerun.ts`):

- **Gold.** Every held row's effect on the character's own gold (`goldOfRow`, the one equation the browser's `GoldAudit` reads too), added in seq order. The hub signs its reading into the acknowledgement. The player sends theirs with the batch (`reading: { seq, gold }`, read before and after the rows are listed, and sent only when the two agree); one that does not fit challenges the character. Two readings agree within a millionth, since "math can skew ever so slightly".
- **Drops.** A session row now names its signed receipt (`receiptHash`, the SHA-256 of the receipt's signature). Until that receipt is sent, the session is owed. When it comes, signed by the character's key and for the session the row named, every drop it rolled on a loot table is rolled again (`LootLaw.roll`: whole numbers and the stream's one plain divide, so any engine lands exactly). A kill's rank is the hub's (its kind's definition), never the player's. A table sent with the receipts stands before the law first, and the law's numbers are the ones rerun, so a table with numbers of its own reruns to the law's drop. A drop that does not land where the player's did challenges the character.
- **Not rerun, and said so:** drops on the old code's tables, whose powers and floats the engines do not agree on (counted as `unchecked`); a chest's rank, which is its world's and not held by the hub.
- **What it costs.** A challenged character keeps its rows and its account; our hosted world closes to it, and to a character that still owes session receipts. Its own hub and every other world play on.

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

## The model, from the browser

Pedro: "their IDB makes the call, not our Turso or postgress". Played from the domain, the game holds its own door (`src/logic/intelligence/PageDoor.ts`): the server's door, the same routes (`server/intelligence/routes.ts`), the same shapes and the same law, asking from the page. Our servers make no model call and carry none.

- **A model on the player's machine.** Ollama at `127.0.0.1:11434`, once the player allows this game's origin. Chrome, Edge and Firefox (153 and later) ask the player once before a public page may reach their machine; then it works. **Safari, and every browser on iPhone and iPad, block it** as mixed content and offer no prompt (WebKit bug 171934, open), so there a key is the only way. Ollama answers a browser only from local origins by default, so the player sets `OLLAMA_ORIGINS` to this game's origin and restarts it.
- **Setting that up**, under SYSTEM, THE VOICE, SET UP A MODEL HERE (`LocalSetup.ts`): a prompt for whatever coding agent the player has, shown whole before it is copied; a plain script per system (PowerShell; shell for macOS and Linux), shown whole, also served at `/setup/`, run only by the player; and free agents for a player with none (`server/intelligence/agents.json`, read on each vendor's page 2026-11-04). Every way allows this origin only, never `*`.
- **A player's own key.** Anthropic (with the `anthropic-dangerous-direct-browser-access` header), Gemini, Groq, OpenRouter and Mistral answer a page (their preflights passed on 2026-11-04, though none of the four documents it); Cloudflare's does not and is not offered in the page. The key lives with the player: sealed at rest with AES-GCM under a key made in the browser as not extractable, in IndexedDB (`KeyVault.ts`). No storage holds it as written, and it never reaches our servers; a script running in this page's own origin could still ask the browser to unseal it, which is as far as any browser lets a page go.
- **An Anthropic vault** is not used for this. A vault's credential is usable only inside a Managed Agents session, which bills our workspace: $0.08 per session-hour while running, plus the tokens (platform.claude.com pricing, read 2026-11-04). No shape of it leaves our side without a standing cost, so the call stays the player's.

## The pool (shared work, in turns)

Pedro: "the players in a server can rotate the one using their key... the more players in a hub the less it costs each one, distributed content generation". `server/hub/pool.ts`, behind `/api/hub/pool*` and `/api/hub/jobs*`:

- A player opts in, with their own key or their own machine's model, under THE HUB, THE POOL. They see who is in it, with which voice, how many jobs each has done and what each has spent (as their own client reported it: the hub never sees a provider's bill), and can leave at any time.
- A job is one door request (a route and its body). It goes to the online member who has done the fewest; that member's client asks its own door (`src/logic/hub/PoolWorker.ts`) and hands the answer in.
- What comes back passes the same law as a world manifest: a theme through `ContentRegistry`, a creature kind through `CreatureLines.correctProof` with wrong numbers put right as a diff. What breaks the law and cannot be put right is refused, and the job goes back for another turn. A job of a kind the hub has no law for is refused when posted.
- A local model costs its player nothing and takes its turns the same. That is safe as far as the law reaches, because the law judges what comes back, never who wrote it: a weaker model costs turns (more refusals), not the world's rules.
- **The game's own producers post to it** (`src/logic/hub/SharedWork.ts`): a world written pass by pass, a hub's chain resolved backwards, a theme's loot tables. Each goes to the pool when this player is signed in to a hub whose pool has someone online, and to the player's own door when not. Each kind has its law on the hub (`server/hub/poolLaw.ts`): a pass must fit its shape and pick only what it was offered; a chain round is judged by `ChainWeb.judge` against the chain the poster sent; loot tables are sealed and judged by `LootLaw`. The poster's client judges the result again when it lands, as it would its own door's. Nobody takes it within a turn's lease, and the poster takes it back and asks its own door.

## The world we host

Pedro: "The server still needs it for the world we'll host for everyone, that one is the solid deploy plan". The one live server (`npm run hosted`, `server/hosted/main.ts`): the hub's function always on, the site, and the door on our own key, answering its own machine only, the key read from the host's secret store. `npm run hosted:publish -- <game database url> <worldUid>` publishes a world from a game's store as the hosted one.

**Reaching it:** after the tutorial's first order is sealed, the zones list shows CONNECT HUB TO ONLINE WORLD, the first thing in the game that asks for an account. Connecting checks that the account holds the character and that the character's standing on our world is good; then the world's certificate and theme join this hub's zones, to deploy into as into any. A character barred from our world (`HostedWorld.setStanding`, the operator's, not a route) is barred from that world only: its account, its own hub and every other world play on.

**The smallest host for it:** one always-on Node process with a Postgres beside it. A single small machine on Fly.io or a starter instance on Render carries that; their current prices were not checked. Money is a later problem, and nothing for billing or limits is built.

## Online play

Pedro: "we serve a postgress we socket to join them and keep it live speaking to the Turso DB, which they can't access, and they run the code locally on the browser". On the hosted server only (`server/live/room.ts`, mounted at `/api/hub/live`, under the hub's cookie path):

- **What is shared** is every document whose id carries the hosted world's uid: its chests, carts, population, director. They live in their own Postgres (`WS_LIVE_DATABASE_URL`, a folder under `data/hosted-live` by default), opened with the keeper (`openLiveStore`) that writes it down to Turso when `WS_RECORD=1`. Players never reach Turso.
- **Commands stay HTTP, events come over a socket.** A commit is the game's own idempotent commit, to `/api/hub/live/commit`; one that lands is also an event, kept in the same transaction with the next number on the world's channel. The socket (`/api/hub/live/socket`, written on Node's own HTTP upgrade, nothing installed) sends every event to everyone listening; a player who drops comes back asking `since` their last number and gets every event after it, from the store, so no window is dropped and a restart loses nothing.
- **Who may** is the hub's own word (`HostedWorld.connect`, asked over its route and taken for 30 seconds): the account holds the character, it is in good standing on our world and on the hub, and it owes no receipts. A commit that writes anything but the world's own documents is refused whole.
- **In the game** (`src/logic/live/LiveClient.ts`): after CONNECT HUB TO ONLINE WORLD, deploying into our world joins it live. The world's documents go to the room, everything else stays in the browser. A commit that touches both is two commits, the world's first, each applied once. Another player's emptied chest is emptied here too (chests and guards merge by the later cycle).
- **Not yet:** population and carts are shared but not merged live (the later save wins until they are); other players are not drawn in the world; a world played live by two people at once can still race on one document between two saves.

## Not built, on purpose

- The hub manifest in the world check.
- Rerunning the old code's drops, and anything else on the engines' powers and floats (D134): they wait on integer-only formulas.
- A world certificate the hub can verify: the certificate keeps its signature but not the moment signed, and its stats change after signing, so nothing can check it today. The check ties a world to a character registered under the account instead.
- Timers inside a day (rests, crafting jobs) still count milliseconds on `Date.now()` in the browser; they move to `GameClock.now()` in their own pass.
- A Turso write-down for the hub on a schedule: a function host has no clean stop, so the marks wait in Postgres until a scheduled call writes them down.
- Goods carried between hubs, charging for model use, the market and its currency.
