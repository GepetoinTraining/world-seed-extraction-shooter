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

**GAME, change 1.** `LiveClient.join` subscribes with `since: 0` the first time, which asks for every event the world ever had. A first join reads the documents themselves through `/live/get` and `/live/query`, so it needs none of them:

```ts
socket.send(JSON.stringify({ subscribe: `world:${worldUid}`, since: seq > 0 ? seq : 'now' }));
```

The room answers `{ ready: { channel, seq } }` with the world's current number and sends nothing older. A reconnect keeps sending its last number, as now.

**GAME, change 2.** Nothing to write, one thing to check: `LiveClient` already reconnects (400 ms, doubling to 8 s) and says where the player is as soon as the socket opens. That first "where" inside 5 seconds is what keeps their place in a line. If the reconnect delay is ever raised, keep the first try well under 5 seconds.

Everything else is as it was: `/live/get`, `/live/query`, `/live/commit`, `/live/chests`, the socket's messages, and `?uid=` on each.

Known and not fixed here: creatures are still each browser's own; carts and population are still written whole.

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
| `GET /where` | anyone | `accounts`, `clerk.publishableKey` added |
| `GET /clock` | anyone | |
| `POST /sessions/clerk` | someone Clerk signed in | **new**: `{ token }`, sets the hub's cookie. The site's page calls it, not the game |
| `POST /accounts`, `POST /sessions` | anyone | 403 when `accounts` is `clerk` |
| `GET /session`, `POST /session/end` | signed in | |
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

## 9. What is not built, so nobody plumbs toward it yet

Pedro named these on 2026-11-12 and none has a route:

- the 5-dollar subscription for a player with no key and no local model, which gives the online hub only;
- forum gold, the market's coin, a balance kept on the main hub;
- linking the marketplace on its own, apart from connecting to our world.

When they come they hang off the same account and the same character registration as above, so nothing in sections 2 to 4 will need redoing.

## 10. What is built and has not been proved on the real services

Everything here passes on a database in memory and real local servers. None of it has run on Vercel, against a Clerk instance, against a served Postgres or against Turso itself, because that needs accounts only Pedro can open:

- that Vercel hands `api/hub.ts`'s server both plain requests and the socket's upgrade through the rewrite in `vercel.json`;
- that Vercel builds the function from these TypeScript files as they are;
- Clerk's own form on the site's first page (`landing/landing.js`), which was written from Clerk's documentation and never loaded;
- the word between instances over a real Postgres (`server/live/bus.ts`), and the turn-taking lock on its transactions (`server/connection.ts`).

The first preview deployment settles the first two in a minute: `GET /api/hub/health` must answer.
