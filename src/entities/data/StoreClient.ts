/**
 * THE STORE CLIENT (D31): how the game reaches the database server.
 *
 * The law this file exists for: when the bank is not answering, nothing above it
 * is told a lie. A read never answers "there is nothing there" because the server
 * is down, which would mint a new character over a real save. A write never
 * pretends it landed, and there is no second set of books in the browser. The
 * request WAITS, the vault says it is closed, and everything resumes in order
 * when the server returns. A commit carries its own id, so a request that landed
 * but lost its answer is not applied twice.
 *
 * Only an answer from the server itself ends the wait: 200, or a refusal (400,
 * 409). Anything else, including a 5xx, counts as the bank not answering.
 */

import { create } from 'zustand';
import { ICommitRequest, ICommitResult, IHealth, IWireDoc, IWireQuery, IWireSearch } from './wire';

export type VaultStatus = 'CHECKING' | 'OPEN' | 'CLOSED';

interface IVaultState {
  status: VaultStatus;
  /** What the last failure said, for the refusal's small print. */
  reason: string | null;
  /** The reason is an old save a person can carry over from the vault's own screen. */
  canCarry?: boolean;
  /** Requests waiting for the server to come back. */
  waiting: number;
}

export const useVault = create<IVaultState>(() => ({ status: 'CHECKING', reason: null, waiting: 0 }));

/** The server looked at the request and said no. Nothing was applied. */
export class StoreRefused extends Error {
  readonly conflict: boolean;
  constructor(message: string, conflict: boolean) {
    super(message);
    this.name = 'StoreRefused';
    this.conflict = conflict;
  }
}

const MAX_RETRY_MS = 4000;

let base = '';
let firstRetryMs = 400;

const closeVault = (reason: string, canCarry = false) => useVault.setState({ status: 'CLOSED', reason, canCarry });
const openVault = () => {
  if (useVault.getState().status !== 'OPEN') {
    useVault.setState({ status: 'OPEN', reason: null, canCarry: false });
  }
};

async function request<T>(path: string, body: unknown): Promise<T> {
  const payload = JSON.stringify(body);
  let delay = firstRetryMs;
  let counted = false;

  try {
    for (;;) {
      let failure: string;
      try {
        const res = await fetch(`${base}/api/db${path}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: payload
        });
        if (res.ok) {
          const answer = await res.json();
          openVault();
          return answer as T;
        }
        if (res.status === 400 || res.status === 409) {
          const refusal = await res.json().catch(() => ({} as any));
          openVault();
          throw new StoreRefused(refusal.error ?? `The store refused (${res.status}).`, res.status === 409);
        }
        failure = `The server answered ${res.status}.`;
      } catch (e) {
        if (e instanceof StoreRefused) throw e;
        failure = e instanceof Error ? e.message : String(e);
      }

      if (!counted) {
        counted = true;
        useVault.setState(s => ({ waiting: s.waiting + 1 }));
      }
      closeVault(failure);
      await new Promise(resolve => setTimeout(resolve, delay));
      delay = Math.min(delay * 2, MAX_RETRY_MS);
    }
  } finally {
    if (counted) useVault.setState(s => ({ waiting: s.waiting - 1 }));
  }
}

export const StoreClient = {
  /** Where the server is. Same origin in the game; a test names its own server. */
  configure(options: { baseUrl?: string; retryMs?: number }) {
    if (options.baseUrl !== undefined) base = options.baseUrl;
    if (options.retryMs !== undefined) firstRetryMs = options.retryMs;
  },

  baseUrl: () => base,

  /** One honest look, no waiting: is our database answering? The gate asks this. */
  async health(): Promise<IHealth> {
    try {
      const res = await fetch(`${base}/api/db/health`, { cache: 'no-store' });
      const body = await res.json().catch(() => null);
      if (res.ok && body?.ok === true && body?.service === 'worldseed-db') return body;
      return { ok: false, reason: body?.reason ?? body?.error ?? `The server at this address is not the bank's (${res.status}).`, ...(body?.canCarry ? { canCarry: true } : {}) };
    } catch (e) {
      return { ok: false, reason: e instanceof Error ? e.message : String(e) };
    }
  },

  /** An old save holds the door: carry it over, as a person asked. The old file stays as it is. */
  async carryOldSave(): Promise<{ ok: boolean; lines: string[] }> {
    const res = await fetch(`${base}/api/db/carry`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    const body = await res.json().catch(() => null);
    return { ok: !!body?.ok, lines: Array.isArray(body?.lines) ? body.lines : [body?.error ?? `The server answered ${res.status}.`] };
  },

  /** Ask once, and set the vault's status from the answer. */
  async checkVault(): Promise<IHealth> {
    const health = await this.health();
    if (health.ok) openVault();
    else closeVault(health.reason ?? 'The server did not answer.', !!health.canCarry);
    return health;
  },

  async get(id: string): Promise<IWireDoc | null> {
    return (await request<{ doc: IWireDoc | null }>('/get', { id })).doc;
  },

  async query(query: IWireQuery): Promise<IWireDoc[]> {
    return (await request<{ docs: IWireDoc[] }>('/query', query)).docs;
  },

  async search(search: IWireSearch): Promise<IWireDoc[]> {
    return (await request<{ docs: IWireDoc[] }>('/search', search)).docs;
  },

  commit(commit: ICommitRequest): Promise<ICommitResult> {
    return request<ICommitResult>('/commit', commit);
  }
};
