/**
 * The browser's side of a hub (DEPLOY.md). On the hub's own domain it asks the hub at /api/hub, and
 * the session rides in a cookie this page's scripts cannot read. Under a runner it asks the runner at
 * the same path, which holds the token itself. Either way nothing here ever sees the token. A password goes
 * to the runner once and is not kept. Every answer is an outcome, never a thrown error, so a hub that
 * is down or not set leaves the game standing.
 */
import { CertificateSystem, ISignedPayload, IPlayerCertificate } from '../../entities/identity/certificateSystem';
import { Ledger, ILedgerRow } from '../ledger/Ledger';

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

  // THE WORLD WE HOST (server/hub/hosted.ts)
  hosted: () => call<IHubOutcome & { world?: { worldUid: string; name: string; themeId: string } }>('/hosted'),
  connectHosted: (uid: string) => call<IHubOutcome & { manifest?: { world: { worldUid: string; name: string }; certificate?: any; themes: any[] }; standing?: string }>('/hosted/connect', { uid }),

  /**
   * Sends the rows the hub does not hold yet, in order, with the last one it holds beside them, so a
   * history written over under the hub's head shows there as a challenge. The last answer says where
   * the hub stands.
   */
  async sendReceipts(uid: string): Promise<IHubOutcome & { held?: number; sent?: number; ack?: IHubStatement; challenge?: unknown }> {
    const record = await this.record(uid);
    if (!record.ok) return record;
    const rows: ISignedPayload<ILedgerRow>[] = (await Ledger.list(uid)).filter(r => r.payload.seq >= (record.held ?? 0));
    if (rows.length === 0) return { ...(await call('/receipts', { uid, rows: [] })), sent: 0 };
    let last: IHubOutcome = record;
    for (let i = 0; i < rows.length; i += ROWS_PER_SEND) {
      last = await call('/receipts', { uid, rows: rows.slice(i, i + ROWS_PER_SEND) });
      if (!last.ok) return { ...last, sent: i };
    }
    return { ...last, sent: rows.length };
  }
};
