/**
 * The browser's side of a hub (DEPLOY.md). On the hub's own domain it asks the hub at /api/hub, and
 * the session rides in a cookie this page's scripts cannot read. Under a runner it asks the runner at
 * the same path, which holds the token itself. Either way nothing here ever sees the token. A password goes
 * to the runner once and is not kept. Every answer is an outcome, never a thrown error, so a hub that
 * is down or not set leaves the game standing.
 */
import { CertificateSystem, ISignedPayload, IPlayerCertificate } from '../../entities/identity/certificateSystem';
import { Ledger, ILedgerRow } from '../ledger/Ledger';
import { VectorNamespace, VectorStore } from '../../../shared/entities/data/VectorStore';
import { LootBook } from '../theme/LootBook';
import { PersonLedger } from '../people/PersonLedger';

/**
 * What the hub reruns beside a batch (D134): the player's own reading of their gold at its head,
 * the signed receipts the batch's session rows name, and the loot tables those sessions rolled on.
 */
export interface IReceiptReading { gold: number }

async function rerunExtras(rows: ISignedPayload<ILedgerRow>[], reading?: IReceiptReading) {
  const sessions: unknown[] = [];
  const tables = new Map<string, unknown>();
  for (const r of rows) {
    if (r.payload.type !== 'SESSION_RESULT' || !r.payload.data?.receiptHash) continue;
    const doc = await VectorStore.get<any>(VectorNamespace.TRANSACTIONS, `session_${r.payload.data.sessionId}`);
    if (!doc) continue;
    sessions.push(doc.data);
    for (const a of doc.data?.payload?.actions ?? []) {
      const id = a?.data?.table?.table;
      const table = typeof id === 'string' ? LootBook.all().find(t => t.id === id) : undefined;
      if (table) tables.set(table.id, table);
    }
  }
  const head = rows[rows.length - 1]?.payload.seq;
  return { sessions, tables: [...tables.values()], ...(reading && head !== undefined ? { reading: { seq: head, gold: reading.gold } } : {}) };
}

const MOUNT = '/api/hub';
/** Rows per request, so a long chain goes up in parts the hub will read. Not a limit on the chain. */
const ROWS_PER_SEND = 500;

export interface IHubWhere { configured: boolean; url: string | null; signedIn: string | null; reason?: string }
export interface IHubStatement { text: string; signature: string }
export interface IHubCharacter { uid: string; displayName: string; held: number; standing: 'GOOD' | 'CHALLENGED'; issued: IHubStatement }
export interface IHubOutcome { ok: boolean; status?: number | string; reason?: string; [more: string]: any }
export interface IPoolMember { handle: string; voice: 'keyed' | 'local'; jobsDone: number; spentUsd: number; online: boolean; since: number }
export interface IPoolJob { id: string; kind: string; path: string; body: unknown }

async function call<T extends IHubOutcome>(path: string, body?: unknown): Promise<T> {
  try {
    const res = await fetch(`${MOUNT}${path}`, body === undefined ? { cache: 'no-store' } : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return await res.json() as T;
  } catch {
    return { ok: false, status: 'OFFLINE', reason: 'This game\'s own server cannot be reached.' } as T;
  }
}

export const HubClient = {
  async where(): Promise<IHubWhere> {
    try {
      return await (await fetch(`${MOUNT}/where`, { cache: 'no-store' })).json();
    } catch {
      return { configured: false, url: null, signedIn: null, reason: 'This game\'s own server cannot be reached.' };
    }
  },

  hub: () => call<IHubOutcome & { hub?: { id: string; url: string } }>('/health'),
  createAccount: (handle: string, password: string) => call('/accounts', { handle, password }),
  signIn: (handle: string, password: string) => call<IHubOutcome & { account?: { handle: string } }>('/sessions', { handle, password, keep: 'cookie' }),
  signOut: () => call('/session/end', {}),
  characters: () => call<IHubOutcome & { characters?: IHubCharacter[] }>('/characters'),
  record: (uid: string) => call<IHubOutcome & { held?: number; head?: string | null; standing?: string }>(`/record/${encodeURIComponent(uid)}`),

  /** Registers this character under the signed-in account: its own key signs a text the hub just gave. */
  async register(certificate: IPlayerCertificate): Promise<IHubOutcome & { issued?: IHubStatement }> {
    const hub = await this.hub();
    if (!hub.ok || !hub.hub) return hub;
    const nonce = await call<IHubOutcome & { nonce?: string }>('/characters/nonce', {});
    if (!nonce.ok || !nonce.nonce) return nonce;
    let proof: ISignedPayload<unknown>;
    try {
      proof = await CertificateSystem.signPayload(certificate.metadata.uid, { claim: 'hub-character', hub: hub.hub.id, nonce: nonce.nonce });
    } catch (e) {
      return { ok: false, reason: e instanceof Error ? e.message : String(e) };
    }
    const { metadata, publicKeyJWK } = certificate;
    return call('/characters', { certificate: { metadata: { uid: metadata.uid, displayName: metadata.displayName, createdAt: metadata.createdAt }, publicKeyJWK }, proof });
  },

  // THE POOL (server/hub/pool.ts): shared work, in turns, on each member's own voice
  joinPool: (voice: 'keyed' | 'local') => call('/pool/join', { voice }),
  leavePool: () => call('/pool/leave', {}),
  pool: () => call<IHubOutcome & { members?: IPoolMember[]; says?: string }>('/pool'),
  takeJob: () => call<IHubOutcome & { job?: IPoolJob | null; turn?: string }>('/jobs/take', {}),
  handIn: (jobId: string, outcome: unknown) => call<IHubOutcome & { state?: string; diff?: unknown[] }>('/jobs/done', { jobId, outcome }),
  postJob: (kind: string, path: string, body: unknown) => call<IHubOutcome & { jobId?: string }>('/jobs', { kind, path, body }),
  job: (jobId: string) => call<IHubOutcome & { job?: { id: string; kind: string; state: string; result?: unknown } }>(`/jobs/${encodeURIComponent(jobId)}`),
  withdrawJob: (jobId: string) => call('/jobs/withdraw', { jobId }),

  // THE WORLD WE HOST (server/hub/hosted.ts)
  hosted: () => call<IHubOutcome & { world?: { worldUid: string; name: string; themeId: string } }>('/hosted'),
  connectHosted: (uid: string) => call<IHubOutcome & { manifest?: { world: { worldUid: string; name: string }; certificate?: any; themes: any[] }; standing?: string }>('/hosted/connect', { uid }),

  /**
   * Sends the rows the hub does not hold yet, in order, with the last one it holds beside them, so a
   * history written over under the hub's head shows there as a challenge. The last answer says where
   * the hub stands.
   */
  /**
   * @param readGold the character's gold as the game holds it, read before and after the rows are
   * listed: a reading is sent only when the two agree, so it is the reading at the head sent.
   */
  /**
   * A city's people: the city's own chain of mints first, then the chain of everyone it minted, each
   * from the row after the last this hub held of it. What the hub
   * answers for each is kept, so the next send starts where it stands. A chain the hub held first
   * from another browser stands there; this one reads from where it says.
   */
  async sendPeople(city: string): Promise<IHubOutcome & { people?: { uid: string; ok: boolean; held?: number; reason?: string }[] }> {
    const sentId = `people_sent_${city}`;
    const sent = (await VectorStore.get<Record<string, number>>(VectorNamespace.TRANSACTIONS, sentId))?.data ?? {};
    // The city's own chain of mints goes first, then the chain of everyone it minted (PersonChain.ts)
    const hubChain = PersonLedger.hubUidOf(city);
    const hubRows = await Ledger.list(hubChain);
    const minted = new Set(hubRows.map(r => r.payload.data?.person).filter((p): p is string => typeof p === 'string'));
    const unsent = (uid: string, rows: ISignedPayload<ILedgerRow>[]) => rows.filter(r => r.payload.seq > (sent[uid] ?? 0));
    const ours: [string, ISignedPayload<ILedgerRow>[]][] = [[hubChain, unsent(hubChain, hubRows)]];
    for (const person of minted) ours.push([person, unsent(person, await Ledger.list(person))]);
    const waiting = ours.filter(([, rows]) => rows.length > 0);
    if (waiting.length === 0) return { ok: true, people: [] };
    const answers: { uid: string; ok: boolean; held?: number; reason?: string }[] = [];
    let part: { uid: string; rows: ISignedPayload<ILedgerRow>[] }[] = [];
    let size = 0;
    const flush = async () => {
      if (part.length === 0) return true;
      const out = await call<IHubOutcome & { people?: { uid: string; ok: boolean; held?: number; reason?: string }[] }>('/people', { chains: part });
      part = []; size = 0;
      if (!out.ok) return false;
      for (const a of out.people ?? []) { answers.push(a); if (a.held !== undefined) sent[a.uid] = a.held; }
      return true;
    };
    for (const [uid, rows] of waiting) {
      part.push({ uid, rows: rows.sort((a, b) => a.payload.seq - b.payload.seq) });
      size += rows.length;
      if (size >= ROWS_PER_SEND && !(await flush())) break;
    }
    await flush();
    const now = Date.now();
    await VectorStore.put({ id: sentId, namespace: VectorNamespace.TRANSACTIONS, data: sent, metadata: { createdAt: now, updatedAt: now, version: 1 } });
    return { ok: true, people: answers };
  },

  async sendReceipts(uid: string, readGold?: () => number): Promise<IHubOutcome & { held?: number; sent?: number; ack?: IHubStatement; challenge?: unknown; rerun?: unknown }> {
    const record = await this.record(uid);
    if (!record.ok) return record;
    const before = readGold?.();
    const rows: ISignedPayload<ILedgerRow>[] = (await Ledger.list(uid)).filter(r => r.payload.seq >= (record.held ?? 0));
    const after = readGold?.();
    const reading = before !== undefined && before === after ? { gold: before } : undefined;
    if (rows.length === 0) return { ...(await call('/receipts', { uid, rows: [] })), sent: 0 };
    let last: IHubOutcome = record;
    for (let i = 0; i < rows.length; i += ROWS_PER_SEND) {
      const part = rows.slice(i, i + ROWS_PER_SEND);
      const lastPart = i + ROWS_PER_SEND >= rows.length;
      last = await call('/receipts', { uid, rows: part, ...(await rerunExtras(part, lastPart ? reading : undefined)) });
      if (!last.ok) return { ...last, sent: i };
    }
    return { ...last, sent: rows.length };
  }
};
