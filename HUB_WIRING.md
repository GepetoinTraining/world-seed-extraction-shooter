# Hub wiring: what the game has to plumb

Pedro, 2026-11-12: "can you build without touching the game paths, and then layout the API wirings for the guys running the coding to plumb?"

This is that layout. The server side is built on branch `claude/hub-deploy` and touches nothing under `src/` or `shared/`. Everything below marked **GAME** is work in the game's own code that no one has done yet. Everything marked **SERVER** exists and is tested (`tests/database.deploy.test.ts`).

The rulings it follows, all Pedro's, all 2026-11-12:

- The game is a browser game played from our site ("we're not using realm of the mad god new format, it's the old one, browser game"). The hub is the page's own origin, so it is always reachable when a character is made.
- "we need the minting of a new player to be done from the hub we're going to launch with the server, every new player get's their account registered there, even if they never log on to the hub".
- "we need e-mail + password (use clerk)", and one reason is "for players to delete their data from our server".
- Receipts go up by themselves ("agreed").

## 1. The five things the game must do

| # | What | Where it lives today | Size |
|---|---|---|---|
| 1 | Refuse to make a character with nobody signed in, and send the player to the site's first page | `src/components/IdentityGate.tsx` | small |
| 2 | Register the character with the hub as it is made, and keep the hub's word beside the certificate | `IdentityGate.tsx` `handleMint`, `src/logic/hub/HubClient.ts` `register`, `src/entities/identity/roster` | small |
| 3 | Name the mint in the character's first ledger row | `src/logic/initialization/StartupSequence.ts`, the `CHARACTER_GENESIS` row | one field |
| 4 | Send receipts by themselves | `HubClient.sendReceipts`, `HubClient.sendPeople`; today only a button in `src/components/HubPanel.tsx` | medium |
| 5 | Ask the live room for nothing old on a first join | `src/logic/live/LiveClient.ts` `join` | one line |

And three places whose words are now wrong: section 7.

Nothing else changes for the game. Every route it already calls answers as before.

**Built, 2026-11-18** (the ledger's HV10), after Pedro's "the account takes precedence, so when someone logs in again we need to serve them the data we have". All five, and section 7's words, in `src/logic/hub/HubLink.ts` and the places the table names:

- **Where it applies.** Only where the game is the hub's own page (`HubLink.required()`, true in the build `npm run build:site` makes). In development and under a runner nothing is required and nothing changed: there an account is signed in to inside the game, after a character exists, so asking for one first would lock the door from the inside.
- **1.** With nobody signed in, the gate shows SIGN IN FIRST and a way to the first page; nothing is made and nothing is played.
- **2.** A character is registered as it is made (`HubLink.bind`), and its `issued` and `mint` are kept in this browser under `ws_hub_mints`. The choice section 3 left open is taken this way: the character is kept, the birth screen says the hub's reason and offers TRY AGAIN, and ENTER stays shut until the hub holds it, so a first row is never written without its mint. A character this browser already held is registered when it is next played; one the hub holds under another account is not played here. A hub that cannot be reached holds nobody back from a character they already have.
- **3.** The first row names the mint when one is kept. The hub then holds the birth as `WITNESSED`; a character made before this has no mint in its first row and is held as `CLAIMED`, as section 3 says.
- **4.** Receipts go up by themselves (`HubLink.start`, from `App.tsx` once the game is up): at the start, every three minutes, when the page is hidden, and when a session's receipt lands (`SessionJournal`). One send at a time; a challenge is the one thing passed on (`HubLink.onChallenge`, which no screen listens to yet). Not hooked: the end of a rest or of a downtime queue, which the three-minute beat covers.
- **5.** A first join subscribes with `since: 'now'`.
- **Beyond the five.** The select screen says who is signed in, marks each character as on the account or joining it when played, and lists the account's characters that are not on this device, with how many receipts the hub holds of each. `mint` and `issued` do not travel with an avatar backup yet; a restored character asks the hub again when it is played and is answered the same statement.

**The account is the root of a character's keys, built 2026-11-18** (the ledger's HV11). Pedro, to a key per browser: "sure, but the central node of the keys must be the account, what we then do is allow the person to export character from their idb to ours for changing where they'll play".

- **SERVER** (`server/hub/Hub.ts`). `POST /receipts` takes one more field, `save`: the character's signed player doc as it stands at the head sent. The hub keeps it whole (`hub_character_save_<uid>`), reads nothing into it, and answers `saved`, the head its save is of. `GET /characters` and `GET /record/<uid>` answer `key` (the hash of the key the character signs with now) and `saved`. `POST /characters/bring { uid, publicKeyJWK, proof }`: the account takes a character to the browser asking. `proof` is `{ claim: 'hub-character-key', hub, nonce }` signed with the NEW key. The hub makes that key the character's from the row after the last it holds, retires the one before at that row and keeps it, signs a statement of it (`worldseed-hub-character-key`: `publicKey`, `was`, `from`), and answers the name, the birth, the keys before, and the save. It refuses while it holds rows it has no save of. `POST /characters/rows { uid, from }` hands the rows back, 500 an answer. A row is checked against the key that held its seq; one signed by a retired key past its last seq is refused with `moved: true`.
- **GAME.** `HubClient.sendReceipts` sends the save with the last rows, when there is something new or the hub's save is behind (`HubLink.send`, which `App.tsx` gives the reader: the player doc is saved first, then read). `src/logic/hub/BringCharacter.ts` brings one here: it checks that what this browser holds is the start of what the hub holds, makes a key, asks the hub, verifies every row and the save against the keys the hub names, and only then writes the key, a certificate carrying `formerKeys`, the save and the rows. `CertificateSystem.verifyPayload` reads a signature under the key a certificate names or any of its `formerKeys`, which is the one change that lets a brought character's old rows and save read here. The select screen offers BRING IT HERE for a character not on this device whose save the hub holds, and for one on this device that the account has since taken elsewhere, which it will not JACK IN.
- **What a move costs, and is not fixed.** A character plays in one browser at a time: what the browser it was taken from adds afterwards is refused, and that browser can only bring it back (a browser that went on past the hub cannot, since a chain only appends). What is brought is the player doc and the ledger: a city's people, a world's shared documents and a session's own receipts stay in the browser that made them, so a session receipt the hub is still owed stays owed after a move. Nothing tells a player mid-game that the character has moved (`HubLink.onMoved` has no listener yet); they learn it at character select.

## 2. Signing in happens on the site, not in the game

**SERVER.** On the hub we launch, an account is an e-mail and a password kept by Clerk. The site's first page (`landing/`) shows Clerk's form, then asks the hub once for the hub's own session (`POST /api/hub/sessions/clerk`). That session is the same cookie as before: `ws_hub`, HttpOnly, `Path=/api/hub`, 30 days. It rides on every request the game makes to `/api/hub/...` with no code in the game.

A hub someone else runs has no Clerk and keeps the handle and password it always had.

**GAME.** Ask which kind of hub this is and who is signed in:

```
GET /api/hub/where
→ { configured: true, url, signedIn: "alder" | null, accounts: "clerk" | "builtin", clerk?: { publishableKey } }
```

- `accounts === "clerk"`: the game shows no sign-in form and no "make an account". With `signedIn === null` it says so and links to `/` (the site's first page). Calling `POST /accounts` or `POST /sessions` there answers 403.
- `accounts === "builtin"`: `HubPanel`'s form works as it does now.

The game never loads Clerk and never sees a Clerk token.

## 3. A character is born on the hub's word

**SERVER.** Unchanged routes, one new field in the answer:

```
POST /api/hub/characters/nonce   {}                         → { ok, nonce }
POST /api/hub/characters         { certificate, proof }     → { ok, uid, issued: { text, signature }, mint }
```

`issued` is the hub's signed statement (`worldseed-hub-character`: the hub's id and address, the uid, a hash of the public key, the account's handle, the hub's time). `mint` is `sha256(issued.signature)` in hex, 64 characters: the short word for that statement.

**GAME, at MINT** (`IdentityGate.handleMint`, after `createIdentity` succeeds and before the gate says "minted"):

1. `GET /where` must have answered `signedIn`. If not, do not make the key at all: say the player has to sign in on the site first, and link to `/`.
2. Call `HubClient.register(certificate)`. It already does the nonce, the proof and the POST.
3. On `ok`, keep `issued` and `mint` beside the certificate, wherever the roster keeps a certificate (they must survive a reload and travel with an avatar backup).
4. On failure, the character is not minted. Say the hub's `reason`. A fresh character that cannot be registered should not be left half-made in the roster: either remove it or keep it marked unminted and retry step 2 on the next load, before anything else is written. Pick one; the server allows both, since registering the same character twice under the same account answers the same statement again.

**GAME, the first row** (`StartupSequence`, the `CHARACTER_GENESIS` row): add the mint to its data.

```
{ type: 'CHARACTER_GENESIS', data: { certUid, username, gold, mint } }
```

**SERVER, what it does with it.** When the first row arrives in a batch of receipts:

- it names this hub's mint for this character: held, and the character is marked `born: "WITNESSED"`;
- it names any other value: the whole batch is refused, 400, "names a mint this hub did not give it";
- it names none: held, and the character is marked `born: "CLAIMED"`. This is every character that exists today, and it stays allowed so nothing made before this breaks. What a claimed birth costs on the market is not decided.

`GET /api/hub/characters` now answers `mint` and `born` (`"WITNESSED" | "CLAIMED" | null`, null until the first row is held) for each character.

One consequence to know: a character's first row can never be changed, so a character is tied to the mint it was born with. If its account is deleted (section 6) and it is registered again under a new account, the hub gives it a new mint, its first row names the old one, and its receipts are refused. A deleted account's characters do not come back to this hub.

## 4. Receipts go up by themselves

**SERVER.** `POST /api/hub/receipts` and `POST /api/hub/people` are unchanged. Sending the same rows twice is safe: rows the hub holds are compared, not added.

**GAME.** Call what the button calls, without the button:

```ts
HubClient.sendReceipts(uid, () => usePlayerStore.getState().player.bank.gold)
HubClient.sendPeople(activeHubId)      // after the receipts, as HubPanel does now
```

When:

- after a dive ends (extraction, death, abandon), since that is when a session's signed receipt exists and the hub can rerun its drops;
- after a rest or a downtime queue settles;
- on a slow beat while the page is open, for everything else (a few minutes is enough; the hub does not need them sooner);
- when the page is hidden (`visibilitychange`), as a last send.

Rules:

- one send at a time for a character. If one is running, the next waits for it rather than racing it: two at once can meet the hub's "another send landed first" answer (409), which is harmless but noisy;
- only for a character the hub holds (section 3). Skip quietly when nobody is signed in;
- an answer with `standing: "CHALLENGED"` or `challenge` is the one thing the player must be told. Everything else can stay out of their way;
- `rerun.owed > 0` means the hub is still waiting for a session's receipt. The next send carries it.

The button can stay as "send now", or go.

## 5. Online play: two small changes, and what the room now promises

**SERVER, what changed.** The hosted world's room runs on a function host as several instances, and the host closes every socket on a timer: 300 seconds on Vercel's free plan, 800 on its paid one. The room now:

- numbers a world's events in the database, so two instances cannot give one number twice;
- tells each instance's sockets of what landed on any instance;
- passes where players stand between instances;
- keeps a line of people waiting to talk in the database, as one line;
- holds a player whose socket closed in their place and their lines for 5 seconds, so a socket the host closed costs nothing if the browser is back within that.

On the host its store is Turso alone (Pedro, 2026-11-13: "Yes, Turso only"; `DEPLOY.md`, "Turso alone"). There is no Postgres to nudge through, so instances hear each other on a beat: an event or a line change reaches a player on another instance within about a second, and another instance's player walking is seen at most about three seconds late, at points two seconds apart, which `Presence.ts` slides between as it does for any late word. Two players on one instance see each other as before. Nothing in the game changes for it.

**GAME, change 1.** `LiveClient.join` subscribes with `since: 0` the first time, which asks for every event the world ever had. A first join reads the documents themselves through `/live/get` and `/live/query`, so it needs none of them:

```ts
socket.send(JSON.stringify({ subscribe: `world:${worldUid}`, since: seq > 0 ? seq : 'now' }));
```

The room answers `{ ready: { channel, seq } }` with the world's current number and sends nothing older. A reconnect keeps sending its last number, as now.

**GAME, change 2.** Nothing to write, one thing to check: `LiveClient` already reconnects (400 ms, doubling to 8 s) and says where the player is as soon as the socket opens. That first "where" inside 5 seconds is what keeps their place in a line. If the reconnect delay is ever raised, keep the first try well under 5 seconds.

Everything else is as it was: `/live/get`, `/live/query`, `/live/commit`, `/live/chests`, the socket's messages, and `?uid=` on each.

Known and not fixed here: creatures are still each browser's own; carts and population are still written whole.

**Multiplayer is always on, and a player hosts their own, built 2026-11-18** (the ledger's HV12). Pedro: "now we need to make the multiplayer always on WHEN someone is in server, it's ready to deploty the websocket, if there's a web socket we log people into to it, unless they choose to host their own, then we tunnel theirs as an option like old warcraft 3 used to do".

- **SERVER** (`server/hub/open.ts`, `OpenWorlds`; routes in `http.ts`, composed in `app.ts`). `GET /worlds/open` lists every world open here for whoever is signed in: `{ worldUid, name, themeId, by: 'HUB' | 'PLAYER', host, mine, answering, openedAt }`. `POST /worlds/enter { uid, worldUid }` checks the character (this account's, not challenged, owing no receipts) and serves the manifest. `POST /worlds/open { uid, manifest, docs }` is a maker opening their world: `manifest` is `{ world, certificate, themes, mint }`, checked by `Hub.checkWorld`; `docs` are the world's shared documents (`shared/logic/live/shared.ts`), which `LiveRoom.seed` lands as the room's first event. A world still open is taken up as the room holds it (`resumed: true`) and `docs` is not read. `POST /worlds/beat { worlds }` keeps them listed (`OPEN_BEAT_MS` 60 s, `OPEN_FOR_MS` 180 s). `POST /worlds/close { worldUid }` marks it closed, has the room land a last event (`closed: true`) and answers the shared documents. The room's doors take `?world=`; its word on who may is `OpenWorlds.access`, which answers `410` for a world that is closed or whose host is not heard from.
- **GAME** (`src/logic/live/OpenWorlds.ts`, started from `App.tsx` beside the receipts). `sync` reads the list, installs what the hub serves (themes banked, certificate saved, `MintStore.save`), and marks each world in `HostedLink` (`HUB`, `JOINED`, `MINE`, `CLOSING`). `useWorldStore.refreshWorlds` offers a served world only while `OpenWorlds.offered` says it is open, and puts `live` on its card. `selectWorld` joins the room of any marked world, as it did for ours. `openToOthers` and `closeToOthers` are the card's two buttons. `LiveClient` names its world on every request and the socket, and falls back to the game's own store (`StoreClient.own`) when the room says the world is not open (`status: 'CLOSED'`, until the world is left).
- **Under a runner or in development** none of this runs (`OpenWorlds.on` is `HubLink.required`): CONNECT HUB TO ONLINE WORLD stays the way in.

## 6. What the hub holds of a player, and deleting it

**SERVER.**

```
GET  /api/hub/account
→ { ok, account: { handle, since }, characters: [{ uid, displayName, receipts, standing }], people, worlds }

POST /api/hub/account/delete   { confirm: "<the account's handle>" }
→ { ok, erased: { characters, rows, documents, record: "CLEARED" | "WAITING" | "NONE" }, signIn?: "DELETED" | "KEPT", reason? }
```

Deleting takes out the account, its sessions, its characters as the hub knows them, every ledger row of theirs, the people their cities minted, their place in the pool, the jobs they posted, the worlds they had checked and their standing on our world. It is also taken out of the record on Turso. The e-mail and password are deleted at Clerk in the same request. What stays is what other players hold in their own histories, and content this hub judged (themes, creature kinds, loot tables), which names nobody.

The site's first page already shows this and asks for the handle before deleting. The save in the browser is not touched: it is the player's.

**GAME.** Nothing required. Worth doing: a line under SYSTEM that says where this lives (`/`, "What this hub holds of you"). And after a deletion the game will find `signedIn: null` and its character missing from `GET /characters`; it should say the hub no longer knows this character rather than offer to register it (section 3, last paragraph).

## 7. Words in the game that are now wrong on the hub we launch

- `src/components/OnlinePanel.tsx`: "An account on a hub is made and signed in to inside the game, under SYSTEM, THE HUB."
- `src/components/HubPanel.tsx`: the sign-in form, MAKE AN ACCOUNT, REGISTER THIS CHARACTER and SEND RECEIPTS, when `accounts === "clerk"`. What is left to show there is who is signed in, the character's standing and how many receipts the hub holds.
- `src/components/ConnectWorld.tsx`: "the first thing in the game that asks for an account". An account now comes before the first character.

## 8. Every route, as it stands

Mounted at `/api/hub`. A `POST` takes JSON only. A signed-in route takes the `ws_hub` cookie or `Authorization: Bearer <token>`.

| Route | Who | New or changed |
|---|---|---|
| `GET /health` | anyone | `hub.accounts` added |
| `GET /where` | anyone | `accounts`, `clerk.publishableKey` added; `voice` added (2026-11-18): whether this hub answers the model's asks itself |
| `GET /voice/status`, `POST /voice/<ask>` | signed in, on a hub with a voice | **new** (2026-11-18): the door's own asks, answered on the hub's key (`DEPLOY.md`, "The hub's own voice"). The game already asks it, through `DoorTransport`; nothing to plumb |
| `GET /clock` | anyone | |
| `POST /sessions/clerk` | someone Clerk signed in | **new**: `{ token }`, sets the hub's cookie. The site's page calls it, not the game |
| `POST /accounts`, `POST /sessions` | anyone | 403 when `accounts` is `clerk` |
| `GET /session`, `POST /session/end` | signed in | `account.key` added to `GET /session`: the account's own key |
| `GET /account` | signed in | **new** |
| `POST /account/delete` | signed in | **new** |
| `POST /characters/nonce` | signed in | |
| `POST /characters` | signed in | `mint` added to the answer |
| `GET /characters` | signed in | `mint`, `born` added to each |
| `POST /receipts`, `GET /record/<uid>` | signed in | a first row naming a wrong mint is refused |
| `POST /people`, `POST /people/table` | signed in | |
| `POST /worlds/check` | signed in | |
| `POST /pool/join`, `/pool/leave`, `/pool/beat`, `GET /pool` | signed in | |
| `POST /jobs`, `/jobs/take`, `/jobs/done`, `/jobs/withdraw`, `GET /jobs/<id>` | signed in | |
| `GET /hosted`, `POST /hosted/connect` | anyone, signed in | |
| `POST /live/get`, `/live/query`, `/live/commit`, `/live/chests` `?uid=` | let into our world | |
| `GET /live/socket?uid=` (upgrade) | let into our world | `since: 'now'` accepted |
| `GET /maintenance` | the host's scheduled call only | **new**: writes down to the record |
| `POST /clerk` | Clerk only | **new**: Clerk's signed word that an account was deleted there |
| `GET /dev/state`, `/dev/tables`, `/dev/rows`, `/dev/row`, `/dev/find` | an account on the host's `WS_DEV_ACCOUNTS` only | **new**: the developers' view of the data, read only (`DEPLOY.md`, "The developers' view"). The game never calls these, and needs nothing for them |

## 9. What is not built, so nobody plumbs toward it yet

Pedro named these on 2026-11-12 and none has a route:

- the 5-dollar subscription for a player with no key and no local model, which gives the online hub only;
- forum gold, the market's coin, a balance kept on the main hub;
- linking the marketplace on its own, apart from connecting to our world.

When they come they hang off the same account and the same character registration as above, so nothing in sections 2 to 4 will need redoing.

## 10. What has been seen on the real services, and what has not

Seen on the host on 2026-11-13, with main at `2f1b6d6` deployed (the ledger's HH rows):

- Vercel builds and runs the function: the hub is built into one file first (`scripts/build-hub.ts`, `DEPLOY.md`), and `GET /api/hub/health` answers 200;
- the store on Turso alone opens from the function (`server/tursoStore.ts`), read from the two names Turso's integration writes (`server/hub/settings.ts`);
- Vercel hands `api/hub.js`'s server both plain requests and the socket's upgrade through the rewrite in `vercel.json`: an upgrade with no sign-in gets the room's own refusal;
- the page's headers: `vercel.json`'s fixed ones on every address, and the content policy `npm run build:site` writes into each landing page (`DEPLOY.md`, "The page's headers");
- Clerk's own form drawn on the site's first page (`landing/landing.js`), on a development instance.

Not seen anywhere but on a database in memory, real local servers, Turso's stand-in and a Turso test database of Pedro's:

- an account made and signed in on the host, a character born on the hub's word there, a receipt checked there;
- a socket held open by a signed-in player, two instances hearing each other on the beat (`server/live/tursoLive.ts`), and the host closing a socket on its timer;
- a commit's time from the function to its own Turso (the ledger's HT17 is from this machine to a test database);
- the developers' view opened by an account on `WS_DEV_ACCOUNTS`, the scheduled call with its `CRON_SECRET`, and an account's data deleted on Clerk's word: each waits on a setting only the owner enters;
- Clerk's abuse check under the page's policy: the first policy refused its script, the policy now names it (HH3), and that has not been deployed;
- for whoever names a Postgres instead: the word between instances over a real Postgres (`server/live/bus.ts`), and the turn-taking lock on its transactions (`server/connection.ts`).
