# Deploying World Seed for testing

Pedro, 2026-11-04: "develop out the API connections so we can test this deployed (I haven't yet decided the domain we'll use, it also needs a static landing page, account creation such and such... it's abrowser based game, should run on the person's own machine we simply check the receipts, the model itself needs a way to communicate with the game for the local test)".

Then, ruling on hosting: "If we need ACTIVE compute outside the player viewing the game, we built it wrong. We don't compute anything, we check receipts, this is math, vercel and players are computing view workers, the DB layer needs to be local (idb) or postgress for online play, we serve a postgress we socket to join them and keep it live speaking to the Turso DB, which they can't access, and they run the code locally on the browser, they send to us the world manifest, we simply check if everything is pre existing, what's not pre existing needs to pass a function to be checked if it doesn't break any rules. If it doesn't we accept, they continually play, what happens if it does break a rule is that we serve the corrected atom, and the item, or the loot table, or the world manifest gets the diff, never the full load."

The domain is configuration everywhere: nothing in the code names one.

## The split

**The game, in the player's browser.** A static site: the landing page at `/`, and the game at `/play/` (`npm run build:site` writes both to `dist-site/`). The game runs entirely in the page:

- its save is the game's own store (`SqlStore`, with all its law) on PGlite, which keeps its files in the browser's IndexedDB (`src/entities/data/BrowserStore.ts`). One tab holds it, by a Web Lock; a second tab is told so;
- its time is the hub's, read from the hub's signed clock and counted on the browser's steady counter (`GameClock`);
- its session with the hub rides in a cookie the page's scripts cannot read.

**The hub, as stateless functions.** One composition (`server/hub/app.ts`), which a host such as Vercel runs on demand (`server/hub/entry.ts`, built into one file that `api/hub.js` hands the host; `vercel.json`): it answers plain requests and takes the socket's upgrade, so the checks and online play are one deployment and nothing stays running between requests. Nothing outlives a call but the store: a proof's one-time text is signed by the hub and carries its own account and expiry, and wrong passwords are counted in the store, so any instance answers the same. It computes nothing of play. It:

- holds accounts and sessions;
- registers a player's characters, answering with a statement it signs with its key and its time (D134's anchor);
- checks receipts: signed ledger rows, each signature against the registered key, each row linked to the one before, each moment its own and none from a day the hub has not reached (D135). A row that differs from one it holds, or links to a different one, is a challenge;
- checks worlds (below);
- keeps its store on Turso, the database connected to the project, which is then its own record (`server/tursoStore.ts`, below); or on a Postgres named for it (`WS_HUB_DATABASE_URL`), with its record on Turso through the game's own keeper (`WS_RECORD=1`). Players reach neither.

`npm run hub` runs the same function locally behind a plain Node server, serving `dist-site/` (or the landing page alone, before a build): the stand-in for the host.

## Where it runs (2026-11-12)

Pedro asked for the stack to be analyzed and a deployment chosen: "browser local compute and turso backend synced to check receipts + websocket through postgres". The choice, which he took ("vercel is simply the BEST DEPLOYMENT CHOICE EVER"):

| Piece | Where |
|---|---|
| The landing page and the game (`dist-site/`) | Vercel's static hosting; the save is in the player's browser |
| The hub's checks, and online play with its socket | one Vercel Function, `api/hub.js` (the hub built into one file, `npm run build:hub`) |
| The store, its record, and the word between function instances | Turso alone, the database connected to the project (2026-11-13, below) |
| Accounts | Clerk: an e-mail and a password |

Vercel Functions take WebSocket upgrades, so the always-on machine this document once set aside for the hosted world is not needed. `npm run hosted` stays as the same thing on one machine, and as the way anyone else runs a hub.

**Turso alone (2026-11-13).** As first built, the store on the host was a served Postgres, there for the word between instances, with Turso as the record it was written down to once a day. Pedro: "not neon, I'm not going to dabble in neon, please rethink this option", and, to building the store on Turso with no Postgres on the host: "Yes, Turso only". So on the host the store is `TursoStore` (`server/tursoStore.ts`), the same law as the game's `SqlStore` on Turso's own tables, through the network driver only:

- **a commit is one request**, which Turso runs whole or not at all under its write lock, and every decision the store's law makes (seen before, its guard, a ledger row held as it is or the next of its chain, a head where its chain stands) is taken there, by the batch's own SQL. Each send carries its own token, so a commit whose answer was lost says truly that it landed and writes nothing more, and one that reaches Turso after its sender gave up writes nothing at all. Every read is one request;
- **its tables are its own**, all named `store_` (`drizzle/turso`), made on the first request and never dropped or altered, so a record written into the same database never meets them;
- **the store is its own record.** Nothing is written down twice: a write-down answers that there is nothing to write, `WS_RECORD` changes nothing for it and says so in the log, and the daily call only tidies what the live room left and finishes any erasure;
- **the word between instances is the store, read on a beat** (`server/live/tursoLive.ts`): each instance holding players reads, in one request a second, the world's head, the other instances' row of where their players stand, and the lines another instance changed. An event or a line reaches a socket on another instance within about a second. Where an instance's players stand is kept in its memory and written as one row for the whole instance, inside that same request, and only while another instance is there to read it: at most once every two seconds while they move, once every five while they stand, never while it is alone. So a player walking on another instance is seen at most about three seconds late, and drawn between those points.

What it costs, against Turso's plan here (500 million rows read and 10 million rows written a month): an instance holding players makes one request a second and reads a few rows in it (the head, one row per other instance, a line changed); it writes no place at all while alone, and at most 1,800 rows an hour while another instance is there and its players walk (720 while they stand), however many players it holds. A commit on the world we host is two requests (the room reads the head, then commits) and writes its documents and three rows more. A Postgres stays possible for whoever names one, and then everything below about a served Postgres holds.

**The new Rust Turso** was looked at for the socket and cannot carry it: it has no network subscription and no publish and subscribe, its change capture is a table to read, its sync is push and pull with "last push wins", and Turso Cloud offers it as an early preview. Turso's network driver over HTTP is what the store uses.

**Several instances.** A function host starts as many instances as the traffic asks, pins each socket to one, and closes every socket at the function's longest run (300 seconds on Vercel's Hobby plan, 800 on Pro). On Turso, a commit is decided whole by the database in its one request, the room's lines are changed by version, and the instances hear each other on the beat above; what is said below of a world's numbers and of a closed socket holds there too. On a served Postgres:

- every transaction on a served Postgres takes one lock first (`server/connection.ts`), and transactions from every instance take turns as one process's writes do. The store's guards were written for one process and would race without it;
- a world's events take their numbers in the database: one that finds its number taken reads again and takes the next, and a chest's claim is decided again on what stands then (`server/live/room.ts`);
- instances nudge each other through the same Postgres, LISTEN and NOTIFY (`server/live/bus.ts`). It is only a nudge: each instance tells its own sockets from the store, by number, and looks again on a slow beat whatever it heard;
- a line of people waiting to talk is kept in a working table of the room's own (`server/live/lines.ts`), which the record never sees;
- a player whose socket closed is held in their place and their lines for five seconds, which a browser's reconnect is well inside.

Not made safe for several instances, and said so: the pool's turns (two instances could hand one job to two members, who would both do it; the first answer handed in stands), and the count of wrong passwords on a hub that keeps its own accounts.

**One database, one record.** The hub's store and the hosted world's shared documents share one database unless `WS_LIVE_DATABASE_URL` names another. On Turso that one database is also the record. On a Postgres, a record is one chain of write-downs with one head, so two stores cannot share one: kept apart, the world's documents have a record of their own (`TURSO_LIVE_DATABASE_URL`) or none.

**The scheduled call.** The host calls `GET /api/hub/maintenance` once a day (`vercel.json`, `crons`), carrying `CRON_SECRET`. On Turso it has nothing to write down (its answer says `IN_STORE`): it clears the rows of instances gone a day and lines emptied a day ago, and finishes any erasure still waiting. On a Postgres, which has no clean stop for the keeper to write down at, it writes down to the record, tidies the database, and finishes any erasure still waiting on the record (below).

### Accounts, a character's birth, and deleting

Pedro, 2026-11-12: "we need to have account and password for players to delete their data from our server", "we need e-mail + password (use clerk)", and "we need the minting of a new player to be done from the hub we're going to launch with the server, every new player get's their account registered there, even if they never log on to the hub".

- **Accounts** (`server/hub/clerk.ts`). On the hub we launch, Clerk holds the e-mail and the password and proves who is at the door. The landing page shows Clerk's form, then asks the hub once for the hub's own session (`POST /sessions/clerk`); from there on it is the hub's cookie, as before, and the game needs no Clerk code. The hub reads Clerk's token with Clerk's public key and no call. It keeps the account's id at Clerk and a handle: no password and no e-mail. A hub anyone else runs names no Clerk and keeps its own handle and password.
- **Birth.** The landing page shows PLAY only to someone signed in. The character is registered as it is made, and the hub's answer carries its `mint`, which the character's first ledger row names. A first row naming another mint is refused; one naming none is held as `CLAIMED` instead of `WITNESSED`. The game's side of this is not written yet: `HUB_WIRING.md`.
- **Deleting** (`server/hub/erase.ts`). The player asks (`POST /account/delete`, on the landing page), or Clerk says the account was deleted there (`POST /clerk`). Everything the hub holds of the account goes, whole or not at all, on the database itself, since the store's own law has no way to delete. On Turso that is one request on the store, which is the record: nothing is left anywhere else, and nothing is remembered. On a Postgres, the same ids are deleted on the record; a write-down already on its way can land after, so the ids are remembered until a later maintenance finds none of them on the record; then the note is deleted too.

### Putting it on Vercel

Pedro, 2026-11-13: "we need to set up how to work these out right?", and then, of the store: "Yes, Turso only". The project exists and is deployed; what it holds is Turso's two settings, Clerk's two public ones and `WS_PUBLIC_URL`. What is left, in order, each marked as **one click** in the host, **a paste** into the project's Environment Variables, or **nothing**, because the hub reads it by itself (`server/hub/settings.ts`). The hub's own name always wins over a host's, so any step can be done by hand instead. A setting is entered for Production, and for Preview too if previews are to answer; a change reaches only the next deployment, so the last steps deploy again and look.

1. **The store: nothing.** The Turso database made for this project is connected to it, and Turso's integration wrote `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN`. With no Postgres named, the hub reads those two as its store (its log says `WS_HUB_DATABASE_URL (from TURSO_DATABASE_URL)`, never a value), makes its own tables on the first request, all named `store_`, and needs nothing else: no Postgres, nothing to listen on. The store is its own record. If the address is there and the token is not, `/api/hub/health` says `TURSO_AUTH_TOKEN` is what is missing. Do not connect a Postgres to this project: one that writes `DATABASE_URL` is read before Turso's names and would become the store, empty. (Whoever wants a Postgres names it in `WS_HUB_DATABASE_URL`, and then `WS_RECORD=1` keeps its record on Turso as before.)
2. **The address: nothing, for now.** Vercel gives every deployment `VERCEL_PROJECT_PRODUCTION_URL`, the production domain without its scheme, set even in a preview, while the project's "Enable access to System Environment Variables" is on (Vercel's page, "System environment variables"). The hub reads it as `https://` and that domain when `WS_PUBLIC_URL` is not set. **Paste `WS_PUBLIC_URL` once the domain is chosen, before real players register**: the address is inside everything the hub signs, and Vercel's value moves by itself to the shortest custom domain the day one is added.
3. **The hub's key: a paste.** In your own terminal, in your own checkout: `npm run hub:key`. It prints a new key and writes it nowhere. Paste all of it, the BEGIN and END lines included, into `WS_HUB_KEY`, as a Secret, and keep a copy somewhere safe: a hub whose key changes cannot stand behind what it signed. It names the hub that key makes, and `/api/hub/health` names the same once it is deployed. (`npm run hub` still makes one at `data/hub-key.pem` for a local test.)
4. **The record: nothing.** The store is already on Turso, so nothing is written down twice. `WS_RECORD` is not needed, and if it is set it changes nothing for a store on Turso (the log says so once).
5. **The scheduled call: a paste.** `CRON_SECRET`: the fresh text `npm run hub:key` printed under the key, or any 16 or more letters and digits with no line break. Vercel sends it by itself on the daily call to `/api/hub/maintenance`, on the production deployment only (Vercel's page, "Managing Cron Jobs"). On Turso it tidies what the live room left and finishes any erasure.
6. **Accounts: one click, then three pastes.**
   - Connect Clerk's integration to the project. It makes the application and writes `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY` (Clerk's page, "Integrate Clerk through the Vercel Marketplace"); the hub reads the first as `CLERK_PUBLISHABLE_KEY` and the second as it is. Clerk's development instance goes to Preview and Development, its production instance to Production. A production instance needs a domain you own (Clerk's page, "Deploy your Clerk app to production"), so on a `vercel.app` address the site runs on the development instance's keys.
   - In Clerk's dashboard: e-mail and password on, username on and required; in the session token one more claim, `{ "handle": "{{user.username}}" }`; let users delete their own account.
   - Paste `CLERK_JWT_KEY`: the PEM Clerk shows as its JWT public key (API keys). Until it is there the hub refuses and says so, because a publishable key without it is a hub half on Clerk. A key pasted into a one-line field reads whatever became of its line ends (spaces, nothing, `\n`, Windows' own), as long as its BEGIN and END lines and everything between them came along; if it still does not read, `/api/hub/health` names it under `settings.unreadable`, and the whole PEM is pasted again. The same holds for `WS_HUB_KEY`.
   - In Clerk, a webhook to `https://<the address>/api/hub/clerk` for `user.deleted`; paste its signing secret into `CLERK_WEBHOOK_SECRET`.
7. **Deploy again: one click.** Deployments, the latest, Redeploy.
8. **Look: nothing to set.** `GET https://<the address>/api/hub/health` answers with the hub's own word: `ok: true`, or a 503 whose reason says every setting still missing or unreadable at once, with their names in `settings.missing` and `settings.unreadable`. The function's log says at each start which name each setting was read from (`[HUB] Settings: WS_HUB_DATABASE_URL (from TURSO_DATABASE_URL), …`), never a value. The host's own 500 (`FUNCTION_INVOCATION_FAILED`) means the function died as it loaded, before it read any setting.
9. **The developers' view: a paste, after the first sign-in.** Sign in on the site, then open `/dev/`. It says the account is not on the list and shows its account key (`clerk_` and Clerk's id for it). Paste that key into `WS_DEV_ACCOUNTS` (several are separated by commas) and deploy again; `/dev/` then shows the data (below, "The developers' view"). The list is the operator's to keep short: what the view shows is players' data.

**What the first deployment showed (2026-11-13).** The site built and was served. Every address under `/api/hub` answered the host's own 500: `Cannot find module '/var/task/server/hub/app'`. The host compiles each file alone and runs the result as plain Node, and plain Node finds an import only when its address is written whole, which nothing under `server/` or `shared/` does. So the hub is built into one file first (`scripts/build-hub.ts`, to `dist-hub/hub.mjs`; `npm run build:site` does it too, and `vercel-build` names it for the host's own step before a function), and `api/hub.js` hands that to the host. `tests/deploy.function.test.ts` runs it the way the host does. Whether the host now builds and runs it has not been seen: the next deployment shows it.

**The page's headers.** What never changes is in `vercel.json`'s `headers`, for every address: no framing (`X-Frame-Options: DENY`, and `Content-Security-Policy: frame-ancestors 'none'`), no sniffing, no referrer. The landing pages' content policy names Clerk's own address, which the publishable key carries and which is known when the site is built, so `npm run build:site` writes it into each landing page as a meta tag, from the key the build is given (by the hub's name or the one Clerk's integration writes), with the very function the local stand-in sends it with (`server/hub/pagePolicy.ts`). A page built with no Clerk key gets the strict policy, which loads nothing from Clerk: **after Clerk is connected the site is built again** (step 7). The game's pages under `/play/` get no policy of the landing page's. Where the accounts are Clerk's, the policy names what Clerk's own page on content policies lists for its form: its instance's address, the bot check, its picture host, and its abuse check (`https://*.protect.clerk.com` for scripts and frames, and with `:*` for what the page talks to, since those hosts answer on other ports). Seen on the host on 2026-11-13 (the ledger's HH rows): the fixed headers on every address, the policy in the first page, Clerk's form drawn; the abuse check's script was refused by the first policy, and the policy that lets it in has not been seen there yet.

The address is inside everything the hub signs (`issuer`), so it is chosen before real players register. A `vercel.app` address serves for testing. Vercel's Hobby plan is for non-commercial use, closes sockets every 300 seconds and runs a scheduled call once a day; the project moves to Pro before any money is taken.

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
- **Items.** Each is checked against what made it (`src/logic/content/ItemLaw.ts`). Found gear: rank, level, power and worth, the factory's own arithmetic from base, rank, rarity and quality. A material: rank and rarity. A made thing (Pedro: "if the crafting was done locally then brought online the chain of the crafting is inferrable by the host's tech web"): every step of its chain must be one the host knows (its themes' recipes, its web's, or the game's own two ways, `gameWays.ts`) at that recipe's labor, and every material one it holds; then its worth is the chain's price and a made piece of gear's power the chain's budget. What is off comes back as `/items/2/value` operations; a step the host cannot infer, a labor its recipe does not take, or a definition it does not hold is refused. Where an item sat before it came online, such as a chest in its owner's house, is never asked: what made it is. Rolled base stats and affixes come from a stream the hub does not hold, and are not judged here.
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
| `POST /sessions/clerk` | someone Clerk signed in | `{ token }`: this hub's own session, in its cookie. On a hub whose accounts are Clerk's, `/accounts` and `/sessions` answer 403 |
| `GET /account` | signed in | what this hub holds of the account, in counts |
| `POST /account/delete` | signed in | `{ confirm: handle }`: everything this hub holds of the account, deleted, and the sign-in at Clerk with it |
| `GET /maintenance` | the host's scheduled call | the write-down to the record, and erasures waiting on it; carries `CRON_SECRET`. Notes when it came, for the developers' view |
| `POST /clerk` | Clerk | its signed word that an account was deleted there |
| `GET /dev/state`, `/dev/tables`, `/dev/rows`, `/dev/row`, `/dev/find` | an account on `WS_DEV_ACCOUNTS` | the developers' view of the data, read only (below). To anyone else, an address that does not exist |

`GET /session` also answers the account's own key (`account.key`), which is what `WS_DEV_ACCOUNTS` names.

## The developers' view

Pedro, 2026-11-13: "I think we should protected route and actually be able to see the DB and check the state of things... like a view from the data side as devs". A page at `/dev/` (`landing/dev/`, in the site's own look) over read-only routes in the hub's handler (`server/hub/dev.ts`). Neither knows which database is underneath: the routes read through one interface, `IDevStore` (`server/hub/devStore.ts`), with one body per kind of store holding every query the view needs: `server/hub/devStoreTurso.ts` for the store on Turso alone, which the host runs, and `server/hub/devStorePostgres.ts` for a Postgres. Each gives the same answers for the same data, under its own names for its tables, and the page asks only with names an answer gave it.

- **Who may.** A signed-in account whose key is on the list the host holds, `WS_DEV_ACCOUNTS`. Anyone else, signed in or not, gets exactly what an address that does not exist gets. With the list empty, nobody may. The page itself is a static file, so it can say "not on the list" and show the signed-in person their own account key: that is how the owner learns what to put there.
- **The state of things** (`/dev/state`): every setting by name, set or not and which name it was read from; whether the database answers and how many of this build's migrations it has; the record: on Turso, that the store is its own record, and on a Postgres, the record's state, what is not on it yet and its last write-down read back whole; how the instances hear each other (on Turso, the beat and its timings); when the scheduled call last came; erasures still waiting; how many accounts, sessions, characters, ledger rows, worlds, cities, people, themes, kinds, loot tables, pool members, jobs, lines and live events the hub holds, with the latest of each.
- **The data itself**: every table, and every collection of the documents and the ledger, with counts (`/dev/tables`); a table's or a collection's rows newest first, fifty to a page (`/dev/rows?table=&namespace=&type=&owner=&page=&size=`); one row opened whole, its text read as JSON (`/dev/row?table=&id=`); and what the hub holds of an account, a character or a world, by its id (`/dev/find?id=`).
- **Never shown**, by any route: a password's hash or salt, a session's token, a one-time text, the hub's key, any setting's value. The store keeps no token and no one-time text as written, only their hashes, inside the ids `hub_session_…` and `hub_nonce_…`; those are shown by a short mark and never opened. The rest is hidden on the server: by a rule on names (a password, a secret, a token, a salt, a key that is private or an API's, and the like), by a list kept per kind of document (an account's hash and salt), and, over everything a route answers, every text a secret setting holds and anything shaped as a private key or a provider's secret. What was hidden says `‹hidden›` where it stood.
- **Each read** answers `Cache-Control: no-store` and is written to the function's log with who asked and for what (`[DEV] alder (clerk_…) read /dev/rows table=documents …`), never the rows.
- **Limits, on purpose.** It writes nothing. No box to type SQL into: the provider's own console already shows the raw database, and this view is for what the hub means by its rows. No bulk export. Players' rows are players' data: **the list of developer accounts is the operator's to keep short.**

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

Every name the hub reads is in `server/hub/settings.ts`, with the names a host writes for the same thing. On a function host the hub reads those when its own is not set; the local stand-ins (`npm run hub`, `npm run hosted`) do not, so a test on this machine never finds a database because a shell happened to name one.

| Name | Where | Read also from, on the host | What |
|---|---|---|---|
| `WS_HUB_DATABASE_URL` | hub | `DATABASE_URL` (a Postgres the host connected), then `TURSO_DATABASE_URL` (Turso's integration) | the store: a Turso address (`libsql://…`, its token from `TURSO_AUTH_TOKEN`), or a served Postgres (`postgres://…`); `npm run hub` defaults to a folder at `data/hub-test` |
| `WS_HUB_KEY` | hub | | its signing key (PKCS#8 PEM, Ed25519), from the host's secret store; `npm run hub:key` prints one. `npm run hub` makes one into `data/hub-key.pem` when none is named |
| `WS_PUBLIC_URL` | hub | `VERCEL_PROJECT_PRODUCTION_URL` (Vercel, as `https://` and that domain) | its own address, named in what it signs |
| `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` | hub | (Turso's integration writes these names) | the store, when no Postgres is named; beside a Postgres store, its record |
| `WS_RECORD` | hub | | `1` keeps a Postgres store's record on Turso. A store on Turso is its own record, and this changes nothing for it |
| `WS_LIVE_LISTEN_URL` | hub | `DATABASE_URL_UNPOOLED` (the same Postgres, direct), only beside a store read from `DATABASE_URL` | for a Postgres store only: a direct (not pooled) connection to it, for the word between instances. Left out, the database's own address is used |
| `WS_LIVE_DATABASE_URL` | hub | | the hosted world's shared documents, if kept apart from the hub's own; then `TURSO_LIVE_DATABASE_URL` for their record, or none |
| `CRON_SECRET` | hub | | what the host's scheduled call carries. Vercel sends it by itself once it is set |
| `CLERK_JWT_KEY` | hub | | Clerk's public key for this application, PEM (dashboard, API keys, JWKS public key). Naming it is what makes this hub's accounts Clerk's; a publishable key without it is refused as half set |
| `CLERK_PUBLISHABLE_KEY` | hub, site build | `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` (Clerk's integration) | what the landing page loads Clerk with; public by design |
| `CLERK_WEBHOOK_SECRET` | hub | | the signing secret of the webhook to `/api/hub/clerk` |
| `CLERK_SECRET_KEY` | hub | (Clerk's integration writes this name) | to delete the account at Clerk when its player asks the hub to |
| `CLERK_AUTHORIZED_PARTIES` | hub | | the origins a Clerk token may come from; the hub's own address when left out |
| `WS_DEV_ACCOUNTS` | hub | | the account keys that may open the developers' view, separated by commas; empty, nobody |
| `VITE_WS_STORE=browser` | game build | | set by `npm run build:site`: the save lives in the browser |

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

**Where it runs:** on the function host with everything else (Where it runs, above), since 2026-11-12. `npm run hosted` is the same hub as one process on one machine: the local stand-in, and what anyone else runs. Money is a later problem, and nothing for billing or limits is built.

## Online play

Pedro: "we serve a postgress we socket to join them and keep it live speaking to the Turso DB, which they can't access, and they run the code locally on the browser". On the hosted server only (`server/live/room.ts`, mounted at `/api/hub/live`, under the hub's cookie path):

- **What is shared** is the hosted world's chests, carts, population and director, by name (`src/logic/live/shared.ts`), and nothing else. A personal chest inside an owner's house stays in that player's browser (Pedro: "controlled by idb, we don't care what's in them because we know what generated them"); its treasury stays out too. On the host they live in the hub's own store on Turso; on a machine (`npm run hosted`), in their own Postgres (`WS_LIVE_DATABASE_URL`, a folder under `data/hosted-live` by default), opened with the keeper (`openLiveStore`) that writes it down to Turso when `WS_RECORD=1`. Players never reach Turso.
- **A chest is claimed, never written whole** (Pedro: "queue it, the first or best lag gets the first spot, the write happens AFTER"). Opening a chest in our world first sends a claim to `/api/hub/live/chests`, naming what the player saw of it. The room takes claims one at a time in the order they arrive; the first that still matches what stands wins and the chest opens, and the room writes the record after. A later claim on the same chest is told someone reached it first, and gets the record as it stands. A guard's fall goes through the same queue and only ever moves forward.
- **Commands stay HTTP, events come over a socket.** A commit is the game's own idempotent commit, to `/api/hub/live/commit`; one that lands is also an event, kept in the same transaction with the next number on the world's channel. The socket (`/api/hub/live/socket`, written on Node's own HTTP upgrade, nothing installed) sends every event to everyone listening; a player who drops comes back asking `since` their last number and gets every event after it, from the store, so no window is dropped and a restart loses nothing.
- **Who may** is the hub's own word (`HostedWorld.connect`, asked over its route and taken for 30 seconds): the account holds the character, it is in good standing on our world and on the hub, and it owes no receipts. A commit that writes anything but the world's own documents is refused whole.
- **In the game** (`src/logic/live/LiveClient.ts`): after CONNECT HUB TO ONLINE WORLD, deploying into our world joins it live. The world's documents go to the room, everything else stays in the browser. A commit that touches both is two commits, the world's first, each applied once. Another player's emptied chest is emptied here too, from the event their claim made.
- **Other players are drawn a little behind** (`src/logic/live/Presence.ts`). Your own walk is your browser's alone, so it never waits and is never corrected. Each browser says where its player is (place, spot, facing, walking or not) at most ten times a second over the same socket, and again once a second when standing still. The room puts on the uid the socket opened with and passes it only to those in the same place; it keeps none of it. Everyone else is drawn 100 ms in their own past, sliding between the two things they said around that moment, with each sender's clock gap learned from the fastest message, so a late one never makes them jump. With nothing newer they walk on their last heading for 250 ms, then stand and wait; one silent for five seconds, gone to another place or closed, is no longer drawn. They are told apart by shape: their own body without your corner brackets, ringed one atom wide, with a square name plate (no tail, so never speech) over the head.
- **Not yet:** population and carts are shared but still written whole (the later save wins until they are claimed the way chests are). Monsters are still each browser's own, so two players cannot fight the same one; the proposal is one browser running each chunk's monsters, the others drawing them the same way as players.

## Not built, on purpose

- The hub manifest in the world check.
- Rerunning the old code's drops, and anything else on the engines' powers and floats (D134): they wait on integer-only formulas.
- A world certificate the hub can verify: the certificate keeps its signature but not the moment signed, and its stats change after signing, so nothing can check it today. The check ties a world to a character registered under the account instead.
- Timers inside a day (rests, crafting jobs) still count milliseconds on `Date.now()` in the browser; they move to `GameClock.now()` in their own pass.
- The game's side of a character's birth on the hub's word and of receipts sent by themselves: `HUB_WIRING.md` lays out what to call.
- What Pedro named on 2026-11-12 and nothing yet serves: a subscription of 5 dollars a month for a player with no key and no local model, which gives the online hub only; forum gold as the market's coin ("D2 forum gold... the easiest model"), a balance kept on the main hub; linking the marketplace on its own.
- Goods carried between hubs, and the market itself.
