/**
 * THE HUB, as deployed (DEPLOY.md): accounts, sessions, a person's characters, and the receipts it
 * checks. It runs nobody's play. Everything it keeps is in its own store, the same SqlStore the game
 * uses, so its record goes to Turso through the same keeper:
 *
 *   hub_account_{handle}    an account: the handle as written, a salted scrypt hash
 *   hub_session_{sha256}    a session, under the hash of its token and never the token
 *   hub_character_{uid}     a character's public key, the account that holds it, what the hub
 *                           stated when it registered it, and its standing here
 *   ledger_{uid}_{seq}      the rows of that character's ledger this hub checked and holds. The
 *                           store's own law (rows only append, each onto the last, and never
 *                           change) is the chain law here too
 *
 * A CHALLENGE (D134). A row that differs from one this hub already holds, at the same seq, signed by
 * the same key, means the person's history was written over. The chain the hub held first stands,
 * nothing from that batch is held, and the character's standing on this hub says CHALLENGED. How much
 * a challenge costs a character, and what a challenge asks, are not settled; nothing here decides them.
 *
 * TIME (D135). What the hub signs carries its own clock, the server's and never the browser's, and
 * it states that clock as the radix-chain address (`clock()`), which a runner follows. A receipt in
 * the newer form must name its own moment, never a day earlier than the row under it nor a day this
 * hub has not reached, and must link to the row this hub holds under it: a row that links to a
 * different one says the history under the head was written over, which is a challenge.
 */
import { createHash, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import type { SqlStore } from '../SqlStore';
import { StoreConflict } from '../SqlStore';
import type { CommitOp, IWireDoc } from '../../src/entities/data/wire';
import { signedText } from '../../src/entities/identity/signedText';
import { IHubKey, ISignedStatement, statementOf } from './keys';
import { addressOf, dayIndexOf } from '../../src/logic/time/RadixClock';
import { chainProblem, type IChainStart } from '../../src/logic/ledger/chainLaw';

export interface IHubOptions {
  /** Its own address, named in what it signs. */
  publicUrl: string;
  now?: () => number;
}

export interface IRefusal { ok: false; status: number; reason: string; [more: string]: unknown }
/** `reason` reads on both sides, so a caller can say why without narrowing first. */
export type Answer<T> = ({ ok: true; reason?: undefined } & T) | IRefusal;

export interface IAccount { key: string; handle: string }

export interface ISignedRow {
  payload: { seq: number; prevSeq: number; ts: number; type: string; data: unknown; v?: number; prev?: string | null; clock?: any };
  signature: string;
  certUid: string;
  timestamp: number;
}

export type Standing = 'GOOD' | 'CHALLENGED';

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
const refuse = (status: number, reason: string, more: Record<string, unknown> = {}): IRefusal => ({ ok: false, status, reason, ...more });
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
  private readonly now: () => number;
  private readonly failures = new Map<string, { fails: number; until: number }>();
  private readonly nonces = new Map<string, { account: string; until: number }>();
  /** Measured against when the handle does not exist, so a wrong handle takes as long as a wrong password. */
  private readonly decoy = randomBytes(16);

  constructor(private readonly store: SqlStore, readonly key: IHubKey, private readonly options: IHubOptions) {
    this.now = options.now ?? Date.now;
  }

  get id(): string { return this.key.id; }

  /** This hub's time, as the clock's address, signed: what a runner sets the game's clock by. */
  clock(): ISignedStatement {
    const at = this.now();
    return statementOf(this.key, { kind: 'worldseed-hub-clock', hub: this.id, issuer: this.publicUrl, at, day: dayIndexOf(at), address: addressOf(at) });
  }
  get publicUrl(): string { return this.options.publicUrl; }

  private doc(id: string, data: Record<string, unknown>, createdAt = this.now(), namespace = NS): IWireDoc {
    const at = this.now();
    return { id, namespace, dataText: JSON.stringify(data), metadata: { createdAt, updatedAt: at, version: 1 } };
  }

  private async read<T>(id: string): Promise<{ doc: IWireDoc; data: T } | null> {
    const doc = await this.store.get(id);
    return doc ? { doc, data: JSON.parse(doc.dataText) as T } : null;
  }

  private commit(ops: CommitOp[], guardAbsent?: string) {
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
    const held = this.failures.get(key);
    if (held && held.fails >= FAILS_BEFORE_WAIT && this.now() < held.until) {
      return refuse(429, 'Too many wrong passwords for this handle. Try again later.', { waitMs: held.until - this.now() });
    }

    const account = await this.read<{ handle: string; salt: string; hash: string }>(`hub_account_${key}`);
    const salt = account ? Buffer.from(account.data.salt, 'base64') : this.decoy;
    const tried = await scrypt(typeof password === 'string' ? password : '', salt);
    const right = !!account && timingSafeEqual(tried, Buffer.from(account.data.hash, 'base64'));
    if (!right) {
      const fails = (held?.fails ?? 0) + 1;
      this.failures.set(key, { fails, until: fails >= FAILS_BEFORE_WAIT ? this.now() + WAIT_MS : 0 });
      return refuse(401, 'That handle and password do not match an account here.');
    }
    this.failures.delete(key);

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

  private async who(token: unknown): Promise<IAccount | IRefusal> {
    return (await this.session(token)) ?? refuse(401, 'Sign in first.');
  }

  // ---------------------------------------------------------------------------
  // CHARACTERS
  // ---------------------------------------------------------------------------

  /** A one-time text for a character's key to sign, so a proof cannot be carried to another account or used twice. */
  async nonce(token: unknown): Promise<Answer<{ nonce: string }>> {
    const account = await this.who(token);
    if ('ok' in account) return account;
    const now = this.now();
    for (const [n, held] of this.nonces) if (held.until <= now) this.nonces.delete(n);
    const nonce = randomBytes(24).toString('base64url');
    this.nonces.set(nonce, { account: account.key, until: now + NONCE_MS });
    return { ok: true, nonce };
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
    const given = typeof nonce === 'string' ? this.nonces.get(nonce) : undefined;
    if (!given || given.account !== account.key || given.until <= this.now()) return refuse(400, 'That proof was not made over a text this hub gave you. Ask for a new one.');
    this.nonces.delete(nonce);
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

  async checkReceipts(token: unknown, uid: unknown, rows: unknown): Promise<Answer<{ held: number; head: string | null; standing: Standing; ack: ISignedStatement }>> {
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

    const head = await this.headHash(own.uid, held);
    const ack = statementOf(this.key, { kind: 'worldseed-hub-receipt', hub: this.id, issuer: this.publicUrl, uid: own.uid, seq: held, head, at: this.now() });
    return { ok: true, held, head, standing: character.data.standing, ack };
  }

  private async challenge(uid: string, character: { doc: IWireDoc; data: any }, seq: number, keptText: string, offeredText: string, held: number): Promise<IRefusal> {
    const challenge = { seq, at: this.now(), held: sha256(keptText), offered: sha256(offeredText) };
    const data = { ...character.data, standing: 'CHALLENGED' as Standing, challenges: [...(character.data.challenges ?? []), challenge] };
    await this.commit([{ kind: 'put', doc: this.doc(`hub_character_${uid}`, data, character.doc.metadata.createdAt) }]);
    return refuse(409, `This hub already holds a different row at seq ${seq}, signed by the same key. The chain it held first stands, and this character's standing here is challenged.`, { challenge, standing: 'CHALLENGED', held });
  }
}
