/**
 * THE HUB, as deployed (DEPLOY.md): accounts, sessions, a person's characters, and the receipts it
 * checks. It runs nobody's play. Everything it keeps is in its own store, the same SqlStore the game
 * uses, so its record goes to Turso through the same keeper:
 *
 *   hub_account_{handle}    an account: the handle as written, a salted scrypt hash
 *   hub_session_{sha256}    a session, under the hash of its token and never the token
 *   hub_character_{uid}     a character's public key, the account that holds it, what the hub
 *                           stated when it registered it, and its standing here
 *   hub_failures_{handle}   wrong passwords for a handle, and until when it waits
 *   hub_nonce_{sha256}      a proof's one-time text, once it has been used
 *   hub_theme_{themeId}     a theme this hub has judged and holds as known
 *   hub_kind_{kind}         a creature kind this hub has checked, with the numbers its line makes
 *   hub_world_{worldUid}    a world this hub has checked: its maker, the theme it is pinned to
 *   hub_roll_{uid}          a city's own chain of mints (PersonChain.ts), folded: everyone minted
 *                           there, in order, and the account that first sent it
 *   hub_person_{uid}        a person of a city (PersonChain.ts): their mint and the fold of their
 *                           own chain, the account that first sent it, and the mint this hub signed
 *   ledger_{uid}_{seq}      the rows of that character's ledger this hub checked and holds. The
 *                           store's own law (rows only append, each onto the last, and never
 *                           change) is the chain law here too
 *
 * A CHALLENGE (D134). A row that differs from one this hub already holds, at the same seq, signed by
 * the same key, means the person's history was written over. The chain the hub held first stands,
 * nothing from that batch is held, and the character's standing on this hub says CHALLENGED. How much
 * a challenge costs a character, and what a challenge asks, are not settled; nothing here decides them.
 *
 * STATELESS (Pedro, 2026-11-04: "we don't compute anything, we check receipts"). Every call may
 * land on a different function instance, so nothing is kept in this process: what must outlive a
 * call is in the store, and a proof's one-time text is signed by the hub and carries its own
 * account and expiry, so any instance can read it.
 *
 * THE WORLD CHECK (Pedro, 2026-11-04: "they send to us the world manifest, we simply check if
 * everything is pre existing, what's not pre existing needs to pass a function to be checked if it
 * doesn't break any rules. If it doesn't we accept... if it does... we serve the corrected atom,
 * and... the world manifest gets the diff, never the full load"). `checkWorld` takes a world, the
 * themes it stands on and the creature kinds grown in it. What this hub holds passes. What it does
 * not goes through the game's own law, the same functions the browser runs (ContentRegistry for a
 * theme, CreatureLines for a kind). A kind whose numbers are not what its line makes comes back put
 * right, as JSON Patch operations on the manifest, with the corrected kind beside them. What cannot
 * be put right (a theme that breaks the law, a line that does not prove itself) is refused, by name.
 *
 * TIME (D135). What the hub signs carries its own clock, the server's and never the browser's, and
 * it states that clock as the radix-chain address (`clock()`), which a runner follows. A receipt in
 * the newer form must name its own moment, never a day earlier than the row under it nor a day this
 * hub has not reached, and must link to the row this hub holds under it: a row that links to a
 * different one says the history under the head was written over, which is a challenge.
 */
import { createHash, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import type { SqlStore } from '../../shared/SqlStore';
import { StoreConflict } from '../../shared/SqlStore';
import type { CommitOp, IWireDoc } from '../../shared/entities/data/wire';
import { signedText } from '../../shared/entities/identity/signedText';
import { IHubKey, ISignedStatement, statementOf, verifyStatement } from './keys';
import { addressOf, dayIndexOf } from '../../shared/logic/time/RadixClock';
import { chainProblem, linkOf, type IChainStart } from '../../shared/logic/ledger/chainLaw';
import { ContentRegistry } from '../../shared/logic/theme/ContentRegistry';
import { CreatureLines, type ILineProof } from '../../shared/logic/theme/CreatureLines';
import { canonical, themeIdOf } from '../../shared/logic/theme/ThemeCompiler';
import type { IThemePack } from '../../shared/logic/theme/ThemeTypes';
import { installShippedThemes, FIRST_THEME_PACK } from '../../shared/logic/theme/boot';
import { LootLaw, type ILootTable } from '../../shared/logic/theme/LootLaw';
import { goldOfRow, sameGold } from '../../shared/logic/economy/goldOfRow';
import { rerunDrops, type IRerunFinder } from './rerun';
import { PersonChain, type IHubRoll, type IPersonMint, type IPersonRecord } from '../../shared/logic/people/PersonChain';
import { ItemLaw, type IItemDefinitions } from '../../shared/logic/content/ItemLaw';
import { CRAFTED_GEAR_BASES, ITEM_DEFINITIONS } from '../../shared/entities/item/data/itemDefinitions';
import { RESOURCE_DEFINITIONS } from '../../shared/entities/item/data/resourceDefinitions';
import { CRAFTED_DEFINITIONS, GEAR_RECIPES, RECIPE_DEFINITIONS } from '../../shared/entities/economy/data/recipeDefinitions';
import { WebBank } from '../../shared/logic/content/WebBank';
import { GAME_WAYS } from '../../shared/logic/economy/gameWays';

export interface IHubOptions {
  /** Its own address, named in what it signs. */
  publicUrl: string;
  now?: () => number;
}

export interface IRefusal { ok: false; status: number; reason: string; [more: string]: unknown }
/** `reason` reads on both sides, so a caller can say why without narrowing first. */
export type Answer<T> = ({ ok: true; reason?: undefined } & T) | IRefusal;

export interface IAccount { key: string; handle: string }

/** A person's chain id (PersonChain.uidOf). */
const PERSON_UID = /^person_[0-9a-f]{16}$/;
/** A city's own chain of mints (PersonChain.hubUidOf). */
const HUB_CHAIN_UID = /^hub_[0-9a-f]{16}$/;

export interface IPersonAnswer {
  uid: string; ok: boolean; reason?: string; held?: number; head?: string | null;
  /** A person's chain: what the hub's table now holds of them, and the mint it signed. */
  record?: IPersonRecord; mint?: ISignedStatement;
  /** A city's chain of mints: everyone this send minted, each with the mint the hub signed. */
  minted?: { uid: string; mint: ISignedStatement }[];
}

export interface ISignedRow {
  payload: { seq: number; prevSeq: number; ts: number; type: string; data: unknown; v?: number; prev?: string | null; clock?: any };
  signature: string;
  certUid: string;
  timestamp: number;
}

export type Standing = 'GOOD' | 'CHALLENGED';

/** What may come with receipts for the hub to rerun (D134). */
export interface IReceiptExtra {
  /** The player's own reading at a head: its gold there. */
  reading?: { seq: number; gold: number };
  /** Signed session receipts that session rows named. */
  sessions?: unknown[];
  /** Loot tables those sessions rolled on. */
  tables?: any[];
}

/** A session row whose receipt the hub has not been sent yet. */
interface IOwed { seq: number; sessionId: string; receiptHash: string; actionCount: number }

/** What the hub reran: its own reading of the gold, and the drops it rolled again. */
export interface IRerun { gold: number; sessions: number; rolls: number; unchecked: number; owed: number }

/** What a player sends to be checked (DEPLOY.md). */
export interface IWorldManifest {
  world: { worldUid: string; creatorCertUid: string; themeId: string };
  themes: IThemePack[];
  kinds?: ILineProof[];
  /** The world's loot tables (LootLaw.ts): a model's words, the formula's numbers. */
  loot?: ILootTable[];
  /** Items the world carries: in its chests, on its ground. */
  items?: unknown[];
}

/** One change to the manifest, as JSON Patch (RFC 6902) names it. */
export interface IPatchOp { op: 'replace'; path: string; value: unknown }

export interface IWorldCheck {
  themes: { known: string[]; accepted: string[]; refused: { themeId: string; reason: string }[] };
  kinds: { known: string[]; accepted: string[]; corrected: { kind: string; def: Record<string, unknown> }[]; refused: { kind: string; reason: string }[] };
  loot: { known: string[]; accepted: string[]; corrected: { id: string; table: ILootTable }[]; refused: { id: string; reason: string }[] };
  /** Checked against their definitions; a made thing's numbers are its chain's, and come back as not checked. */
  items: { checked: string[]; corrected: { id: string; item: unknown }[]; unchecked: { id: string; reason: string }[]; refused: { id: string; reason: string }[] };
  world: { worldUid: string; themeId: string; reason?: string };
  diff: IPatchOp[];
  ack: ISignedStatement;
}

/** What an item is checked against: every base and material the installed themes compiled. */
const HUB_ITEM_DEFINITIONS: IItemDefinitions = {
  base: id => [...ITEM_DEFINITIONS.weapon_bases, ...ITEM_DEFINITIONS.armor_bases, ...ITEM_DEFINITIONS.tool_bases, ...CRAFTED_GEAR_BASES].find(b => b.id === id),
  resource: id => RESOURCE_DEFINITIONS[id] ?? CRAFTED_DEFINITIONS[id],
  // The host's tech web: the recipes its themes compiled, its web's own, and the game's own ways (gameWays.ts)
  step: id => {
    const recipe = RECIPE_DEFINITIONS[id] ?? GEAR_RECIPES[id] ?? WebBank.recipe(id);
    if (recipe) return { laborSeconds: recipe.laborTimeSeconds };
    const way = GAME_WAYS.find(w => w.id === id);
    return way ? { laborSeconds: way.laborSeconds } : undefined;
  }
};

/** The themes every hub holds as known: the ones the game ships with. */
const SHIPPED_THEMES = () => [FIRST_THEME_PACK.themeId];
let shippedInstalled = false;

const NS = 'hub';
const LEDGER_NS = 'transactions';
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };
const SESSION_MS = 30 * 24 * 60 * 60_000;
const NONCE_MS = 10 * 60_000;
/** Wrong passwords for one handle before it waits, and how long it waits after each one past that. */
const FAILS_BEFORE_WAIT = 5;
const WAIT_MS = 15 * 60_000;
const PASSWORD_LEAST = 10;
const HANDLE = /^[\p{L}\p{N}_.-]{3,32}$/u;
const UID = /^[A-Za-z0-9_-]+$/;
const RSA = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' };

const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
export const refuse = (status: number, reason: string, more: Record<string, unknown> = {}): IRefusal => ({ ok: false, status, reason, ...more });
const handleKey = (handle: string) => handle.normalize('NFKC').toLowerCase();
const rowId = (uid: string, seq: number) => `ledger_${uid}_${seq.toString().padStart(8, '0')}`;

function scrypt(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => scryptCallback(password.normalize('NFKC'), salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p }, (e, key) => (e ? reject(e) : resolve(key))));
}

const isNumber = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

function rowShapeProblem(row: any, uid: string): string | null {
  const p = row?.payload;
  if (!p || typeof p !== 'object') return 'A row has no payload.';
  if (!Number.isInteger(p.seq) || p.seq < 1 || p.prevSeq !== p.seq - 1) return `Row ${p.seq} is not chained by its own numbers.`;
  if (!isNumber(p.ts) || typeof p.type !== 'string') return `Row ${p.seq} is missing its time or its kind.`;
  if (typeof row.signature !== 'string' || !isNumber(row.timestamp)) return `Row ${p.seq} is not signed.`;
  if (row.certUid !== uid) return `Row ${p.seq} was signed for another character.`;
  return null;
}

export class Hub {
  /** @internal The hub's own clock, shared with its parts (pool.ts, hosted.ts). */
  readonly now: () => number;
  /** Measured against when the handle does not exist, so a wrong handle takes as long as a wrong password. */
  private readonly decoy = randomBytes(16);

  constructor(/** @internal */ readonly store: SqlStore, readonly key: IHubKey, private readonly options: IHubOptions) {
    this.now = options.now ?? Date.now;
  }

  get id(): string { return this.key.id; }

  /** This hub's time, as the clock's address, signed: what a runner sets the game's clock by. */
  clock(): ISignedStatement {
    const at = this.now();
    return statementOf(this.key, { kind: 'worldseed-hub-clock', hub: this.id, issuer: this.publicUrl, at, day: dayIndexOf(at), address: addressOf(at) });
  }
  get publicUrl(): string { return this.options.publicUrl; }

  /** @internal */
  doc(id: string, data: Record<string, unknown>, createdAt = this.now(), namespace = NS): IWireDoc {
    const at = this.now();
    return { id, namespace, dataText: JSON.stringify(data), metadata: { createdAt, updatedAt: at, version: 1 } };
  }

  /** @internal */
  async read<T>(id: string): Promise<{ doc: IWireDoc; data: T } | null> {
    const doc = await this.store.get(id);
    return doc ? { doc, data: JSON.parse(doc.dataText) as T } : null;
  }

  /** @internal */
  commit(ops: CommitOp[], guardAbsent?: string) {
    return this.store.commit({ commitId: randomUUID(), ops, ...(guardAbsent ? { guardAbsent } : {}) });
  }

  // ---------------------------------------------------------------------------
  // ACCOUNTS AND SESSIONS
  // ---------------------------------------------------------------------------

  async createAccount(handle: unknown, password: unknown): Promise<Answer<{ account: { handle: string } }>> {
    const written = String(handle ?? '').trim().normalize('NFKC');
    if (!HANDLE.test(written)) return refuse(400, 'A handle is 3 to 32 letters, digits, dots, dashes or underscores, with no spaces.');
    if (typeof password !== 'string' || [...password].length < PASSWORD_LEAST) return refuse(400, `A password needs at least ${PASSWORD_LEAST} characters.`);

    const id = `hub_account_${handleKey(written)}`;
    if (await this.store.get(id)) return refuse(409, 'That handle is taken on this hub.');
    const salt = randomBytes(16);
    const hash = await scrypt(password, salt);
    const doc = this.doc(id, { type: 'hub_account', handle: written, salt: salt.toString('base64'), hash: hash.toString('base64'), scrypt: SCRYPT, createdAt: this.now() });
    const out = await this.commit([{ kind: 'putIfAbsent', doc }], id);
    if (!out.applied) return refuse(409, 'That handle is taken on this hub.');
    return { ok: true, account: { handle: written } };
  }

  async signIn(handle: unknown, password: unknown): Promise<Answer<{ token: string; account: { handle: string } }>> {
    const key = handleKey(String(handle ?? '').trim());
    const failuresId = `hub_failures_${key}`;
    const held = (await this.read<{ fails: number; until: number }>(failuresId))?.data;
    if (held && held.fails >= FAILS_BEFORE_WAIT && this.now() < held.until) {
      return refuse(429, 'Too many wrong passwords for this handle. Try again later.', { waitMs: held.until - this.now() });
    }

    const account = await this.read<{ handle: string; salt: string; hash: string }>(`hub_account_${key}`);
    const salt = account ? Buffer.from(account.data.salt, 'base64') : this.decoy;
    const tried = await scrypt(typeof password === 'string' ? password : '', salt);
    const right = !!account && timingSafeEqual(tried, Buffer.from(account.data.hash, 'base64'));
    if (!right) {
      const fails = (held?.fails ?? 0) + 1;
      await this.commit([{ kind: 'put', doc: this.doc(failuresId, { type: 'hub_failures', fails, until: fails >= FAILS_BEFORE_WAIT ? this.now() + WAIT_MS : 0 }) }]);
      return refuse(401, 'That handle and password do not match an account here.');
    }
    if (held?.fails) await this.commit([{ kind: 'put', doc: this.doc(failuresId, { type: 'hub_failures', fails: 0, until: 0 }) }]);

    const token = randomBytes(32).toString('base64url');
    const at = this.now();
    await this.commit([{ kind: 'put', doc: this.doc(`hub_session_${sha256(token)}`, { type: 'hub_session', account: key, createdAt: at, endsAt: at + SESSION_MS }) }]);
    return { ok: true, token, account: { handle: account!.data.handle } };
  }

  /** Who a token is, or nobody. */
  async session(token: unknown): Promise<IAccount | null> {
    if (typeof token !== 'string' || !token) return null;
    const session = await this.read<{ account: string; endsAt: number; endedAt?: number }>(`hub_session_${sha256(token)}`);
    if (!session || session.data.endedAt || this.now() >= session.data.endsAt) return null;
    const account = await this.read<{ handle: string }>(`hub_account_${session.data.account}`);
    return account ? { key: session.data.account, handle: account.data.handle } : null;
  }

  async signOut(token: unknown): Promise<void> {
    if (typeof token !== 'string' || !token) return;
    const id = `hub_session_${sha256(token)}`;
    const session = await this.read<Record<string, unknown>>(id);
    if (!session || session.data.endedAt) return;
    await this.commit([{ kind: 'put', doc: this.doc(id, { ...session.data, endedAt: this.now() }, session.doc.metadata.createdAt) }]);
  }

  /** @internal */
  async who(token: unknown): Promise<IAccount | IRefusal> {
    return (await this.session(token)) ?? refuse(401, 'Sign in first.');
  }

  // ---------------------------------------------------------------------------
  // CHARACTERS
  // ---------------------------------------------------------------------------

  /** A one-time text for a character's key to sign, so a proof cannot be carried to another account or used twice. */
  async nonce(token: unknown): Promise<Answer<{ nonce: string }>> {
    const account = await this.who(token);
    if ('ok' in account) return account;
    const text = Buffer.from(JSON.stringify({ a: account.key, until: this.now() + NONCE_MS, r: randomBytes(18).toString('base64url') })).toString('base64url');
    return { ok: true, nonce: `${text}.${Buffer.from(this.key.sign(text), 'base64').toString('base64url')}` };
  }

  /** What a one-time text says, if this hub signed it: whose it is and until when. */
  private readNonce(nonce: unknown): { a: string; until: number } | null {
    if (typeof nonce !== 'string') return null;
    const [text, signature] = nonce.split('.');
    if (!text || !signature || !verifyStatement(this.key.publicKeyPem, text, Buffer.from(signature, 'base64url').toString('base64'))) return null;
    try {
      const said = JSON.parse(Buffer.from(text, 'base64url').toString('utf8'));
      return typeof said?.a === 'string' && isNumber(said?.until) ? said : null;
    } catch {
      return null;
    }
  }

  private async publicKey(jwk: any): Promise<CryptoKey | null> {
    if (!jwk || jwk.kty !== 'RSA' || typeof jwk.n !== 'string' || typeof jwk.e !== 'string') return null;
    try {
      return await crypto.subtle.importKey('jwk', { kty: 'RSA', n: jwk.n, e: jwk.e }, RSA, false, ['verify']);
    } catch {
      return null;
    }
  }

  private async verifies(key: CryptoKey, signed: { payload: unknown; timestamp: number; signature: string }): Promise<boolean> {
    try {
      const signature = Buffer.from(signed.signature, 'base64');
      return await crypto.subtle.verify(RSA.name, key, signature, new TextEncoder().encode(signedText(signed.payload, signed.timestamp)));
    } catch {
      return false;
    }
  }

  async registerCharacter(token: unknown, certificate: any, proof: any): Promise<Answer<{ issued: ISignedStatement; uid: string }>> {
    const account = await this.who(token);
    if ('ok' in account) return account;

    const uid = certificate?.metadata?.uid;
    if (typeof uid !== 'string' || !UID.test(uid)) return refuse(400, 'That certificate names no character.');
    const key = await this.publicKey(certificate.publicKeyJWK);
    if (!key) return refuse(400, 'That certificate carries no key this hub can read.');

    const nonce = proof?.payload?.nonce;
    const given = this.readNonce(nonce);
    if (!given || given.a !== account.key || given.until <= this.now()) return refuse(400, 'That proof was not made over a text this hub gave you. Ask for a new one.');
    const used = `hub_nonce_${sha256(nonce)}`;
    const spent = await this.commit([{ kind: 'putIfAbsent', doc: this.doc(used, { type: 'hub_nonce', until: given.until }) }], used);
    if (!spent.applied) return refuse(400, 'That text has been used already. Ask for a new one.');
    if (proof.payload.claim !== 'hub-character' || proof.payload.hub !== this.id || proof.certUid !== uid || !isNumber(proof.timestamp) || typeof proof.signature !== 'string') {
      return refuse(400, 'That proof does not say what it is for.');
    }
    if (!(await this.verifies(key, proof))) return refuse(400, 'That proof was not signed by this character\'s key.');

    const id = `hub_character_${uid}`;
    const held = await this.read<{ account: string; issued: ISignedStatement }>(id);
    if (held) {
      if (held.data.account !== account.key) return refuse(409, 'That character is held by another account on this hub.');
      return { ok: true, uid, issued: held.data.issued };
    }

    const issued = statementOf(this.key, {
      kind: 'worldseed-hub-character',
      hub: this.id,
      issuer: this.publicUrl,
      uid,
      publicKey: sha256(`${certificate.publicKeyJWK.n}.${certificate.publicKeyJWK.e}`),
      account: account.handle,
      at: this.now()
    });
    const doc = this.doc(id, {
      type: 'hub_character',
      uid,
      account: account.key,
      displayName: String(certificate.metadata.displayName ?? ''),
      publicKeyJWK: { kty: 'RSA', n: certificate.publicKeyJWK.n, e: certificate.publicKeyJWK.e },
      issued,
      standing: 'GOOD' as Standing,
      challenges: []
    });
    const out = await this.commit([{ kind: 'putIfAbsent', doc }], id);
    if (!out.applied) return refuse(409, 'That character was registered a moment ago. Look again.');
    return { ok: true, uid, issued };
  }

  private async heldSeq(uid: string): Promise<number> {
    const head = await this.store.get(`ledger_head_${uid}`);
    return head ? Number(JSON.parse(head.dataText).seq) : 0;
  }

  private async headHash(uid: string, seq: number): Promise<string | null> {
    if (seq === 0) return null;
    const row = await this.store.get(rowId(uid, seq));
    return row ? sha256(row.dataText) : null;
  }

  async characters(token: unknown): Promise<Answer<{ characters: { uid: string; displayName: string; held: number; standing: Standing; issued: ISignedStatement }[] }>> {
    const account = await this.who(token);
    if ('ok' in account) return account;
    const docs = await this.store.query({ namespace: NS, filter: { 'data.type': 'hub_character', 'data.account': account.key } });
    const characters = await Promise.all(docs.map(async d => {
      const c = JSON.parse(d.dataText);
      return { uid: c.uid, displayName: c.displayName, held: await this.heldSeq(c.uid), standing: c.standing as Standing, issued: c.issued };
    }));
    return { ok: true, characters };
  }

  private async ownCharacter(token: unknown, uid: unknown) {
    const account = await this.who(token);
    if ('ok' in account) return account;
    if (typeof uid !== 'string' || !UID.test(uid)) return refuse(400, 'That names no character.');
    const character = await this.read<any>(`hub_character_${uid}`);
    if (!character) return refuse(404, 'That character is not registered on this hub.');
    if (character.data.account !== account.key) return refuse(403, 'That character is held by another account.');
    return { account, character, uid };
  }

  async record(token: unknown, uid: unknown): Promise<Answer<{ uid: string; held: number; head: string | null; standing: Standing }>> {
    const own = await this.ownCharacter(token, uid);
    if ('ok' in own) return own;
    const held = await this.heldSeq(own.uid);
    return { ok: true, uid: own.uid, held, head: await this.headHash(own.uid, held), standing: own.character.data.standing };
  }

  // ---------------------------------------------------------------------------
  // RECEIPTS
  // ---------------------------------------------------------------------------

  async checkReceipts(token: unknown, uid: unknown, rows: unknown, extra: IReceiptExtra = {}): Promise<Answer<{ held: number; head: string | null; standing: Standing; ack: ISignedStatement; rerun: IRerun }>> {
    const own = await this.ownCharacter(token, uid);
    if ('ok' in own) return own;
    const { character } = own;
    if (!Array.isArray(rows)) return refuse(400, 'Receipts come as a list of signed rows.');

    for (const row of rows) {
      const problem = rowShapeProblem(row, own.uid);
      if (problem) return refuse(400, problem);
    }
    const sorted = [...(rows as ISignedRow[])].sort((a, b) => a.payload.seq - b.payload.seq);
    const texts = sorted.map(r => JSON.stringify(r));
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].payload.seq === sorted[i - 1].payload.seq && texts[i] !== texts[i - 1]) return refuse(400, `Two different rows at seq ${sorted[i].payload.seq} came together.`);
    }

    const key = await this.publicKey(character.data.publicKeyJWK);
    if (!key) return refuse(500, 'The key this hub holds for that character cannot be read.');
    for (const row of sorted) {
      if (!(await this.verifies(key, row))) return refuse(400, `Row ${row.payload.seq} was not signed by this character's key. Nothing in this batch was held.`);
    }

    let held = await this.heldSeq(own.uid);
    const fresh: { row: ISignedRow; text: string }[] = [];
    for (let i = 0; i < sorted.length; i++) {
      const { seq } = sorted[i].payload;
      if (i > 0 && seq === sorted[i - 1].payload.seq) continue;
      if (seq > held) { fresh.push({ row: sorted[i], text: texts[i] }); continue; }
      const kept = await this.store.get(rowId(own.uid, seq));
      if (kept && kept.dataText !== texts[i]) return this.challenge(own.uid, character, seq, kept.dataText, texts[i], held);
    }

    for (let i = 0; i < fresh.length; i++) {
      if (fresh[i].row.payload.seq !== held + 1 + i) {
        return refuse(409, `This hub holds this character to seq ${held}. Send from seq ${held + 1}, in order.`, { held });
      }
    }

    // Time: nothing from a day this hub has not reached, each moment its own, each row on the one under it
    const today = dayIndexOf(this.now());
    for (const { row } of fresh) {
      if (dayIndexOf(row.payload.ts) > today) return refuse(400, `Row ${row.payload.seq} is dated a day this hub has not reached. Nothing in this batch was held.`);
    }
    if (fresh.length > 0) {
      const underText = held > 0 ? (await this.store.get(rowId(own.uid, held)))?.dataText : undefined;
      const under = underText ? JSON.parse(underText) : null;
      const before: IChainStart | null = under ? { seq: held, signature: under.signature, ts: under.payload.ts, v: under.payload.v } : null;
      const problem = chainProblem(fresh.map(f => f.row), before);
      if (problem?.kind === 'link' && before && problem.seq === held + 1) {
        return this.challenge(own.uid, character, problem.seq, underText!, fresh[0].text, held);
      }
      if (problem) return refuse(400, `${problem.why} Nothing in this batch was held.`);
    }

    if (fresh.length > 0) {
      const ops: CommitOp[] = fresh.map(({ row, text }) => ({
        kind: 'put',
        doc: { id: rowId(own.uid, row.payload.seq), namespace: LEDGER_NS, dataText: text, metadata: { createdAt: Math.trunc(row.payload.ts), updatedAt: Math.trunc(row.payload.ts), ownerCertUid: own.uid, signature: row.signature, version: 1 } }
      }));
      try {
        await this.commit(ops);
      } catch (e) {
        if (e instanceof StoreConflict) return refuse(409, 'Another send for this character landed first. Look again.', { held: await this.heldSeq(own.uid) });
        throw e;
      }
      held = await this.heldSeq(own.uid);
    }

    // D134: the rows are held; now the hub does the same arithmetic, on its own time
    const done = await this.rerun(own.uid, fresh.map(f => f.row), held, extra, key);
    if (done.challenge) {
      return refuse(409, `The rows were held. This hub's own rerun did not land where this character's did: ${done.challenge.why} Its standing here is challenged.`, { challenge: done.challenge, standing: 'CHALLENGED', held, rerun: done.rerun });
    }

    const head = await this.headHash(own.uid, held);
    const ack = statementOf(this.key, { kind: 'worldseed-hub-receipt', hub: this.id, issuer: this.publicUrl, uid: own.uid, seq: held, head, gold: done.rerun.gold, at: this.now() });
    return { ok: true, held, head, standing: done.standing, ack, rerun: done.rerun };
  }

  // ---------------------------------------------------------------------------
  // PEOPLE (Pedro, 2026-11-06): "the npc needs to be minted as a world entity for the hub under the
  // hubs chain, that will allow you to track them deterministically from their table in the hub and
  // resolve the chain of actions they produce." And 2026-11-07: "Yes, mint on the hub's".
  // ---------------------------------------------------------------------------

  /**
   * A city's people. Each city has a chain of its own that mints them, one row each, so this hub
   * holds one ordered list of everyone who exists there; each person has a chain of their own for
   * what they did, whose first act names the link of their mint row. Every chain is checked on its
   * own: every row signed by a character this account holds here, in order on the rows this hub
   * holds, each on the one under it, no day this hub has not reached, and every row through the
   * people's law. The hub signs each mint with its own clock. A city's chain is checked before the
   * people it mints, so one send can carry both; a person whose mint this hub does not hold is
   * refused. A chain that fails says why and is held no further; the others stand.
   */
  async checkPeople(token: unknown, chains: unknown): Promise<Answer<{ people: IPersonAnswer[] }>> {
    const account = await this.who(token);
    if ('ok' in account) return account;
    if (!Array.isArray(chains)) return refuse(400, 'People come as a list of chains.');
    const keys = new Map<string, CryptoKey | null>();
    const keyOf = async (certUid: string): Promise<CryptoKey | null> => {
      if (!keys.has(certUid)) {
        const c = typeof certUid === 'string' && UID.test(certUid) ? await this.read<any>(`hub_character_${certUid}`) : null;
        keys.set(certUid, c && c.data.account === account.key ? await this.publicKey(c.data.publicKeyJWK) : null);
      }
      return keys.get(certUid)!;
    };
    const list = chains as { uid?: unknown; rows?: unknown }[];
    const isHub = (c: { uid?: unknown }) => typeof c?.uid === 'string' && HUB_CHAIN_UID.test(c.uid);
    const answers = new Map<number, IPersonAnswer>();
    // Cities first, so a person minted in this same send is held before their chain is checked
    for (const pass of [true, false]) {
      for (let i = 0; i < list.length; i++) {
        if (isHub(list[i]) !== pass) continue;
        const { uid, rows } = list[i] ?? {};
        answers.set(i, pass ? await this.checkHubChain(uid as string, rows, keyOf, account.key) : await this.checkPerson(uid, rows, keyOf));
      }
    }
    return { ok: true, people: list.map((_, i) => answers.get(i)!) };
  }

  /**
   * The rows of one chain this hub has not held yet, checked as every chain is: signed by a character
   * this account holds, in order on what this hub holds, two browsers at once leaving the first
   * standing, no day this hub has not reached, and each on the one under it. Then `settle` folds them
   * under the chain's own law and says what to write with them; the rows and that land together.
   */
  private async checkChain<T extends object>(
    uid: string, rows: unknown, keyOf: (certUid: string) => Promise<CryptoKey | null>, what: string,
    settle: (fresh: ISignedRow[]) => Promise<{ ops: CommitOp[]; answer: T } | string>
  ): Promise<IPersonAnswer> {
    const no = async (reason: string): Promise<IPersonAnswer> => ({ uid, ok: false, reason, held: await this.heldSeq(uid) });
    if (!Array.isArray(rows)) return no('A chain comes as a list of signed rows.');
    for (const row of rows) {
      const problem = rowShapeProblem(row, (row as ISignedRow)?.certUid);
      if (problem) return no(problem);
    }
    const sorted = [...(rows as ISignedRow[])].sort((a, b) => a.payload.seq - b.payload.seq);
    const texts = sorted.map(r => JSON.stringify(r));
    for (const row of sorted) {
      const key = await keyOf(row.certUid);
      if (!key) return no(`Row ${row.payload.seq} was signed by a character this account does not hold here.`);
      if (!(await this.verifies(key, row))) return no(`Row ${row.payload.seq} was not signed by the key it names. Nothing of this chain was held.`);
    }

    let held = await this.heldSeq(uid);
    const fresh: { row: ISignedRow; text: string }[] = [];
    for (let i = 0; i < sorted.length; i++) {
      const { seq } = sorted[i].payload;
      if (i > 0 && seq === sorted[i - 1].payload.seq) {
        if (texts[i] !== texts[i - 1]) return no(`Two different rows at seq ${seq} came together.`);
        continue;
      }
      if (seq > held) { fresh.push({ row: sorted[i], text: texts[i] }); continue; }
      const kept = await this.store.get(rowId(uid, seq));
      // Two browsers wrote this chain at once: the one this hub held first stands, and the other reads it back
      if (kept && kept.dataText !== texts[i]) return no(`This hub already holds another row at seq ${seq} of ${what}. The chain this hub holds stands: read it back from seq ${seq}.`);
    }
    for (let i = 0; i < fresh.length; i++) {
      if (fresh[i].row.payload.seq !== held + 1 + i) return no(`This hub holds ${what} to seq ${held}. Send from seq ${held + 1}, in order.`);
    }
    if (fresh.length === 0) return { uid, ok: true, held, head: await this.headHash(uid, held) };

    const today = dayIndexOf(this.now());
    for (const { row } of fresh) {
      if (dayIndexOf(row.payload.ts) > today) return no(`Row ${row.payload.seq} is dated a day this hub has not reached. Nothing of this chain was held.`);
    }
    const underText = held > 0 ? (await this.store.get(rowId(uid, held)))?.dataText : undefined;
    const under = underText ? JSON.parse(underText) : null;
    const before: IChainStart | null = under ? { seq: held, signature: under.signature, ts: under.payload.ts, v: under.payload.v } : null;
    const linked = chainProblem(fresh.map(f => f.row), before);
    if (linked) return no(`${linked.why} Nothing of this chain was held.`);

    const settled = await settle(fresh.map(f => f.row));
    if (typeof settled === 'string') return no(`${settled} Nothing of this chain was held.`);
    const ops: CommitOp[] = [
      ...fresh.map(({ row, text }): CommitOp => ({
        kind: 'put',
        doc: { id: rowId(uid, row.payload.seq), namespace: LEDGER_NS, dataText: text, metadata: { createdAt: Math.trunc(row.payload.ts), updatedAt: Math.trunc(row.payload.ts), ownerCertUid: row.certUid, signature: row.signature, version: 1 } }
      })),
      ...settled.ops
    ];
    try {
      await this.commit(ops);
    } catch (e) {
      if (e instanceof StoreConflict) return no(`Another send for ${what} landed first. Look again.`);
      throw e;
    }
    held = await this.heldSeq(uid);
    return { uid, ok: true, held, head: await this.headHash(uid, held), ...settled.answer };
  }

  /**
   * A city's own chain of mints. Each new row mints one person: the hub signs that mint with its own
   * clock, saying which chain and row it sits on, and the person stands in the city's table from then,
   * before they have done anything.
   */
  private async checkHubChain(uid: string, rows: unknown, keyOf: (certUid: string) => Promise<CryptoKey | null>, accountKey: string): Promise<IPersonAnswer> {
    return this.checkChain(uid, rows, keyOf, 'this city\'s chain', async fresh => {
      const kept = (await this.read<{ roll: IHubRoll; account: string }>(`hub_roll_${uid}`))?.data ?? null;
      let roll: IHubRoll | null = kept?.roll ?? null;
      const minted: IPersonMint[] = [];
      for (const row of fresh) {
        const out = PersonChain.mint(roll, row.payload, uid, linkOf(row.signature));
        if (typeof out === 'string') return out;
        roll = out;
        minted.push(out.people[(row.payload.data as { person: string }).person]);
      }
      const at = this.now();
      const people = minted.map(m => ({
        m,
        mint: statementOf(this.key, {
          kind: 'worldseed-person-minted', hub: this.id, issuer: this.publicUrl, uid: m.uid, city: m.hubId, npcId: m.npcId, as: m.as,
          chain: uid, seq: m.hubSeq, link: m.link, at, day: dayIndexOf(at), address: addressOf(at)
        })
      }));
      return {
        ops: [
          { kind: 'put', doc: this.doc(`hub_roll_${uid}`, { type: 'hub_roll', city: roll!.hubId, roll: roll!, account: kept?.account ?? accountKey }) },
          ...people.map(({ m, mint }): CommitOp => ({ kind: 'put', doc: this.doc(`hub_person_${m.uid}`, { type: 'hub_person', city: m.hubId, record: PersonChain.start(m), mint, account: accountKey }) }))
        ],
        answer: { minted: people.map(({ m, mint }) => ({ uid: m.uid, mint })) }
      };
    });
  }

  /** A person's own chain: what they did, folded onto what this hub holds of them since their mint. */
  private async checkPerson(uid: unknown, rows: unknown, keyOf: (certUid: string) => Promise<CryptoKey | null>): Promise<IPersonAnswer> {
    if (typeof uid !== 'string' || !PERSON_UID.test(uid)) return { uid: String(uid), ok: false, reason: 'That names no chain of a person or a city.' };
    const table = (await this.read<{ record: IPersonRecord; mint: ISignedStatement; account: string }>(`hub_person_${uid}`))?.data ?? null;
    if (!table) return { uid, ok: false, reason: 'This person\'s mint is not on the hub\'s chain: send their city\'s chain first.', held: await this.heldSeq(uid) };
    return this.checkChain(uid, rows, keyOf, 'this person', async fresh => {
      let record = table.record;
      for (const row of fresh) {
        const out = PersonChain.apply(record, row.payload, uid);
        if (typeof out === 'string') return out;
        record = out;
      }
      return {
        ops: [{ kind: 'put', doc: this.doc(`hub_person_${uid}`, { ...table, type: 'hub_person', city: record.hubId, record }) }],
        answer: { record, mint: table.mint }
      };
    });
  }

  /** A city's table of people, as this hub holds them: each their mint and the fold of their chain, with the mint it signed. */
  async peopleOf(token: unknown, city: unknown): Promise<Answer<{ people: { record: IPersonRecord; mint: ISignedStatement }[] }>> {
    const account = await this.who(token);
    if ('ok' in account) return account;
    if (typeof city !== 'string' || !city) return refuse(400, 'That names no city.');
    const docs = await this.store.query({ namespace: NS, filter: { 'data.type': 'hub_person' } });
    // In the order the city's chain minted them
    return {
      ok: true,
      people: docs.map(d => JSON.parse(d.dataText)).filter(p => p.city === city)
        .map(p => ({ record: p.record as IPersonRecord, mint: p.mint as ISignedStatement, seq: Number(JSON.parse(p.mint.text).seq) || 0 }))
        .sort((a, b) => a.seq - b.seq)
        .map(({ record, mint }) => ({ record, mint }))
    };
  }

  /**
   * The hub's own reading of a character (rerun.ts): its gold from every held row, and the drops of
   * every session it was sent, rolled again. A session row names its receipt; until that receipt
   * comes, the session is owed. What does not land where the player's did is a challenge.
   */
  private async rerun(uid: string, fresh: ISignedRow[], held: number, extra: IReceiptExtra, key: CryptoKey): Promise<{ rerun: IRerun; standing: Standing; challenge?: { kind: 'arithmetic'; seq: number; why: string; at: number } }> {
    const character = (await this.read<any>(`hub_character_${uid}`))!;
    const data = character.data;

    let reading: { seq: number; gold: number } = data.reading ?? { seq: 0, gold: 0 };
    for (let seq = reading.seq + 1; seq <= held; seq++) {
      const doc = await this.store.get(rowId(uid, seq));
      if (!doc) break;
      const row = JSON.parse(doc.dataText) as ISignedRow;
      reading = { seq, gold: reading.gold + goldOfRow(row.payload.type, row.payload.data) };
    }

    const owed: IOwed[] = [...(data.owed ?? [])];
    for (const row of fresh) {
      const d: Record<string, any> = row.payload.data ?? {};
      if (row.payload.type === 'SESSION_RESULT' && typeof d.receiptHash === 'string') owed.push({ seq: row.payload.seq, sessionId: String(d.sessionId), receiptHash: d.receiptHash, actionCount: Number(d.actionCount) });
    }

    // Tables sent with these receipts stand before the law; the law's numbers are what is rerun
    const tables = new Map<string, ILootTable>();
    for (const t of Array.isArray(extra.tables) ? extra.tables : []) {
      if (typeof t?.themeId !== 'string' || !(await this.knownTheme(t.themeId))) continue;
      const verdict = LootLaw.correct(t, ContentRegistry.get(t.themeId)!);
      if (!verdict.ok) continue;
      tables.set(verdict.table.id, verdict.table);
      if (!(await this.read(`hub_loot_${verdict.table.id}`))) await this.commit([{ kind: 'putIfAbsent', doc: this.doc(`hub_loot_${verdict.table.id}`, { type: 'hub_loot', id: verdict.table.id, themeId: t.themeId, table: verdict.table, at: this.now() }) }]);
    }

    const sessions = (Array.isArray(extra.sessions) ? extra.sessions : []) as { payload: any; timestamp: number; signature: string }[];
    // What the finder reads, gathered before it runs: it is pure
    const kinds = new Map<string, { rank: string }>();
    for (const s of sessions) {
      for (const a of Array.isArray(s?.payload?.actions) ? s.payload.actions : []) {
        const id = a?.data?.table?.table;
        if (typeof id === 'string' && !tables.has(id)) {
          const heldTable = await this.read<{ table: ILootTable }>(`hub_loot_${id}`);
          if (heldTable && (await this.knownTheme(heldTable.data.table.themeId))) tables.set(id, heldTable.data.table);
        }
        const defId = a?.data?.defId;
        if (a?.type === 'KILL' && typeof defId === 'string' && !kinds.has(defId)) {
          const grown = await this.read<{ def: { rank: string } }>(`hub_kind_${defId}`);
          if (grown) kinds.set(defId, grown.data.def);
        }
      }
    }
    const find: IRerunFinder = {
      table: id => tables.get(id),
      pack: themeId => ContentRegistry.get(themeId),
      mob: (themeId, defId) => ContentRegistry.compiled(themeId)?.mobs[defId] ?? kinds.get(defId)
    };

    let challenge: { kind: 'arithmetic'; seq: number; why: string; at: number } | undefined;
    const rerun: IRerun = { gold: reading.gold, sessions: 0, rolls: 0, unchecked: 0, owed: 0 };
    for (const s of sessions) {
      if (!s || typeof s.signature !== 'string' || !s.payload) continue;
      const at = owed.findIndex(o => o.receiptHash === sha256(s.signature));
      if (at < 0) continue;
      const entry = owed[at];
      const p = s.payload;
      // The receipt the row named, signed by this character, for that session, with its actions whole
      if (!(await this.verifies(key, s)) || p.claim?.certUid !== uid || p.claim?.sessionId !== entry.sessionId || !Array.isArray(p.actions) || p.actions.length !== entry.actionCount) continue;
      const rolled = rerunDrops(p.actions, find);
      rerun.rolls += rolled.rolls;
      rerun.unchecked += rolled.unchecked;
      if (rolled.wrong) { challenge = { kind: 'arithmetic', seq: entry.seq, why: rolled.wrong.why, at: this.now() }; break; }
      owed.splice(at, 1);
      rerun.sessions++;
    }

    // The player's reading of their gold, at the same head, set beside the hub's
    const theirs = extra.reading;
    if (!challenge && theirs && theirs.seq === held && typeof theirs.gold === 'number' && Number.isFinite(theirs.gold) && !sameGold(theirs.gold, reading.gold)) {
      challenge = { kind: 'arithmetic', seq: held, why: `Its gold reads ${theirs.gold} where the rows it signed add up to ${reading.gold}.`, at: this.now() };
    }
    rerun.owed = owed.length;

    const standing: Standing = challenge ? 'CHALLENGED' : data.standing;
    const next = { ...data, reading, owed, standing, ...(challenge ? { challenges: [...(data.challenges ?? []), challenge] } : {}) };
    await this.commit([{ kind: 'put', doc: this.doc(`hub_character_${uid}`, next, character.doc.metadata.createdAt) }]);
    return { rerun, standing, ...(challenge ? { challenge } : {}) };
  }

  // ---------------------------------------------------------------------------
  // THE WORLD CHECK
  // ---------------------------------------------------------------------------

  /** A theme this hub holds: one it ships with, or one in its store, put in the registry if it is not yet. */
  /** @internal Also the pool's (pool.ts). */
  async knownTheme(themeId: string): Promise<boolean> {
    if (!shippedInstalled) { installShippedThemes(); shippedInstalled = true; }
    if (SHIPPED_THEMES().includes(themeId)) return true;
    const held = await this.read<{ pack: IThemePack }>(`hub_theme_${themeId}`);
    if (!held) return false;
    // Another instance judged it: this one takes the store's word, as the store is the hub
    ContentRegistry.install(held.data.pack);
    return true;
  }

  async checkWorld(token: unknown, manifest: any): Promise<({ ok: boolean; status?: number } & IWorldCheck) | IRefusal> {
    const account = await this.who(token);
    if ('ok' in account) return account;
    const world = manifest?.world;
    if (typeof world?.worldUid !== 'string' || typeof world?.creatorCertUid !== 'string' || typeof world?.themeId !== 'string' || !Array.isArray(manifest?.themes)) {
      return refuse(400, 'A world manifest names its world, its maker and its theme, and carries the themes it stands on.');
    }
    const maker = await this.read<{ account: string }>(`hub_character_${world.creatorCertUid}`);
    if (!maker || maker.data.account !== account.key) return refuse(403, 'That world\'s maker is not a character of this account on this hub.');

    const out: Omit<IWorldCheck, 'ack' | 'world'> = {
      themes: { known: [], accepted: [], refused: [] }, kinds: { known: [], accepted: [], corrected: [], refused: [] },
      loot: { known: [], accepted: [], corrected: [], refused: [] }, items: { checked: [], corrected: [], unchecked: [], refused: [] }, diff: []
    };

    for (const pack of manifest.themes as IThemePack[]) {
      const claimed = String(pack?.themeId ?? '');
      if (!pack || typeof pack !== 'object' || themeIdOf(pack) !== claimed) {
        out.themes.refused.push({ themeId: claimed, reason: 'Its id does not match its words.' });
        continue;
      }
      if (await this.knownTheme(claimed)) { out.themes.known.push(claimed); continue; }
      const verdict = ContentRegistry.install(pack);
      if (!verdict.ok) { out.themes.refused.push({ themeId: claimed, reason: verdict.reason ?? 'The law refused it.' }); continue; }
      await this.commit([{ kind: 'putIfAbsent', doc: this.doc(`hub_theme_${claimed}`, { type: 'hub_theme', themeId: claimed, pack, by: account.key, at: this.now() }) }]);
      out.themes.accepted.push(claimed);
    }
    const standing = new Set([...out.themes.known, ...out.themes.accepted]);

    const kinds = Array.isArray(manifest.kinds) ? manifest.kinds as ILineProof[] : [];
    for (let i = 0; i < kinds.length; i++) {
      const proof = kinds[i];
      const kind = String(proof?.kind ?? '');
      if (!proof || typeof proof.def !== 'object' || !Array.isArray(proof.nodes) || !Array.isArray(proof.roots)) { out.kinds.refused.push({ kind, reason: 'That is not a kind\'s proof.' }); continue; }
      if (!standing.has(proof.themeId)) { out.kinds.refused.push({ kind, reason: 'Its theme is not one this world stands on here.' }); continue; }
      const held = await this.read<{ def: Record<string, unknown> }>(`hub_kind_${kind}`);
      if (held && canonical(held.data.def) === canonical(proof.def)) { out.kinds.known.push(kind); continue; }
      const put = await CreatureLines.correctProof(proof);
      if (!put.ok) { out.kinds.refused.push({ kind, reason: put.reason }); continue; }
      for (const c of put.changes) out.diff.push({ op: 'replace', path: `/kinds/${i}/def/${c.field}`, value: c.value });
      if (put.changes.length > 0) out.kinds.corrected.push({ kind, def: put.def });
      else out.kinds.accepted.push(kind);
      await this.commit([{ kind: 'put', doc: this.doc(`hub_kind_${kind}`, { type: 'hub_kind', kind, themeId: proof.themeId, def: put.def, at: this.now() }) }]);
    }

    // Loot: what the hub holds passes; a new table stands before the law, wrong numbers put right
    const tables = Array.isArray(manifest.loot) ? manifest.loot as ILootTable[] : [];
    for (let i = 0; i < tables.length; i++) {
      const table = tables[i];
      const id = String(table?.id ?? '');
      if (!table || typeof table !== 'object' || !standing.has(table.themeId)) { out.loot.refused.push({ id, reason: 'Its theme is not one this world stands on here.' }); continue; }
      const held = await this.read<{ table: ILootTable }>(`hub_loot_${id}`);
      if (held && canonical(held.data.table) === canonical(table)) { out.loot.known.push(id); continue; }
      const verdict = LootLaw.correct(table, ContentRegistry.get(table.themeId)!);
      if (!verdict.ok) { out.loot.refused.push({ id, reason: verdict.reason }); continue; }
      for (const c of verdict.changes) out.diff.push({ op: 'replace', path: `/loot/${i}/lines/${c.line}/${c.field}`, value: c.value });
      if (verdict.changes.length > 0) out.loot.corrected.push({ id, table: verdict.table });
      else out.loot.accepted.push(id);
      await this.commit([{ kind: 'put', doc: this.doc(`hub_loot_${id}`, { type: 'hub_loot', id, themeId: table.themeId, table: verdict.table, at: this.now() }) }]);
    }

    // Items: each against the definition it was minted from, in the themes this world stands on
    const items = Array.isArray(manifest.items) ? manifest.items : [];
    for (let i = 0; i < items.length; i++) {
      const id = String((items[i] as { id?: unknown })?.id ?? '');
      const verdict = ItemLaw.correct(items[i], HUB_ITEM_DEFINITIONS);
      if (!verdict.ok) { out.items.refused.push({ id, reason: verdict.reason }); continue; }
      if (!verdict.checked) { out.items.unchecked.push({ id, reason: verdict.reason }); continue; }
      for (const c of verdict.changes) out.diff.push({ op: 'replace', path: `/items/${i}/${c.field}`, value: c.value });
      if (verdict.changes.length > 0) out.items.corrected.push({ id, item: verdict.item });
      else out.items.checked.push(id);
    }

    // A standing world reads only its own theme, by the id it was pinned to (ContentRegistry)
    let reason: string | undefined;
    const heldWorld = await this.read<{ themeId: string; creator: string }>(`hub_world_${world.worldUid}`);
    if (!standing.has(world.themeId)) reason = 'Its theme is not among the themes this hub holds or accepted.';
    else if (heldWorld && heldWorld.data.themeId !== world.themeId) reason = `This world was first checked on theme ${heldWorld.data.themeId}, and a standing world keeps its theme.`;
    else if (heldWorld && heldWorld.data.creator !== world.creatorCertUid) reason = 'This world was first checked with another maker.';
    else await this.commit([{ kind: 'put', doc: this.doc(`hub_world_${world.worldUid}`, { type: 'hub_world', worldUid: world.worldUid, creator: world.creatorCertUid, themeId: world.themeId, kinds: [...out.kinds.known, ...out.kinds.accepted, ...out.kinds.corrected.map(c => c.kind)], at: this.now() }, heldWorld?.doc.metadata.createdAt) }]);

    const ack = statementOf(this.key, {
      kind: 'worldseed-hub-world', hub: this.id, issuer: this.publicUrl, world: world.worldUid, themeId: world.themeId,
      themes: [...out.themes.known, ...out.themes.accepted], kinds: out.kinds.known.length + out.kinds.accepted.length + out.kinds.corrected.length,
      loot: out.loot.known.length + out.loot.accepted.length + out.loot.corrected.length, items: out.items.checked.length + out.items.corrected.length,
      corrections: out.diff.length, refused: out.themes.refused.length + out.kinds.refused.length + out.loot.refused.length + out.items.refused.length + (reason ? 1 : 0), at: this.now()
    });
    const ok = out.themes.refused.length === 0 && out.kinds.refused.length === 0 && out.loot.refused.length === 0 && out.items.refused.length === 0 && !reason;
    return { ok, ...(ok ? {} : { status: 200 }), ...out, world: { worldUid: world.worldUid, themeId: world.themeId, ...(reason ? { reason } : {}) }, ack };
  }

  private async challenge(uid: string, character: { doc: IWireDoc; data: any }, seq: number, keptText: string, offeredText: string, held: number): Promise<IRefusal> {
    const challenge = { seq, at: this.now(), held: sha256(keptText), offered: sha256(offeredText) };
    const data = { ...character.data, standing: 'CHALLENGED' as Standing, challenges: [...(character.data.challenges ?? []), challenge] };
    await this.commit([{ kind: 'put', doc: this.doc(`hub_character_${uid}`, data, character.doc.metadata.createdAt) }]);
    return refuse(409, `This hub already holds a different row at seq ${seq}, signed by the same key. The chain it held first stands, and this character's standing here is challenged.`, { challenge, standing: 'CHALLENGED', held });
  }
}
