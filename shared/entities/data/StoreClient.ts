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
 *
 * THE STORE MAY BE IN THE PAGE (Pedro, 2026-11-04: "the DB layer needs to be local (idb)"). Then
 * the same requests go to a SqlStore on PGlite in this browser (BrowserStore.ts), through the same
 * answers: a refusal is a refusal, a store that will not open closes the vault with its reason.
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

/** What came back, the way a fetch reports it. */
interface IAnswer { ok: boolean; status: number; json: () => Promise<any> }
type Transport = (path: string, body?: string) => Promise<IAnswer>;

const overTheWire: Transport = (path, body) => fetch(`${base}/api/db${path}`, body === undefined
  ? { cache: 'no-store' }
  : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });

const answered = (status: number, value: unknown): IAnswer => ({ ok: status === 200, status, json: async () => value });

/** The store in this page, answering as the server's door does (server/http.ts). */
function inThePage(opening: Promise<any>): Transport {
  return async (path, body) => {
    let store: any;
    try {
      store = await opening;
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      return answered(503, path === '/health' ? { ok: false, reason } : { error: reason });
    }
    try {
      if (path === '/health') return answered(200, await store.health());
      const asked = JSON.parse(body ?? '{}');
      if (path === '/get') return answered(200, { doc: await store.get(asked.id) });
      if (path === '/query') return answered(200, { docs: await store.query(asked) });
      if (path === '/search') return answered(200, { docs: await store.search(asked) });
      if (path === '/commit') return answered(200, await store.commit(asked));
      if (path === '/maintain') return answered(200, await store.maintain());
      if (path === '/record') return answered(200, await store.writeDown(String(asked.why ?? 'asked')));
      return answered(404, { error: `Nothing answers at ${path}` });
    } catch (e) {
      const name = (e as Error)?.name;
      if (name === 'StoreConflict') return answered(409, { conflict: true, error: (e as Error).message });
      if (name === 'StoreRefusal' || e instanceof SyntaxError) return answered(400, { error: (e as Error).message });
      return answered(500, { error: e instanceof Error ? e.message : String(e) });
    }
  };
}

let transport: Transport = overTheWire;
let local = false;

/**
 * ONLINE PLAY (server/live/room.ts): the documents of a world played live go to its room, the rest
 * stay where they are. A commit that touches both is two commits, the world's and this game's own,
 * each applied once; the world's goes first, so a refused world write leaves this game's untouched.
 */
interface IRoute { owns: (id: string) => boolean; transport: Transport }
let routes: IRoute[] = [];
const routeOf = (id: string | undefined) => (id === undefined ? undefined : routes.find(r => r.owns(id)));

/** The live room's doors, over the wire, naming the character that plays. */
export function liveTransport(origin: string, uid: string): Transport {
  return (path, body) => fetch(`${origin}/api/hub/live${path}?uid=${encodeURIComponent(uid)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body ?? '{}', credentials: 'same-origin' });
}

const closeVault = (reason: string, canCarry = false) => useVault.setState({ status: 'CLOSED', reason, canCarry });
const openVault = () => {
  if (useVault.getState().status !== 'OPEN') {
    useVault.setState({ status: 'OPEN', reason: null, canCarry: false });
  }
};

async function request<T>(path: string, body: unknown, via: Transport = transport): Promise<T> {
  const payload = JSON.stringify(body);
  let delay = firstRetryMs;
  let counted = false;

  try {
    for (;;) {
      let failure: string;
      try {
        const res = await via(path, payload);
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

  /** The store is this page's own (BrowserStore.ts), opening or open. */
  useLocal(opening: Promise<unknown>) {
    opening.catch(() => undefined);
    transport = inThePage(opening);
    local = true;
  },

  /** Back to the server at the base URL. */
  useServer() {
    transport = overTheWire;
    local = false;
  },

  isLocal: () => local,

  /** One honest look, no waiting: is our database answering? The gate asks this. */
  async health(): Promise<IHealth> {
    try {
      const res = await transport('/health');
      const body = await res.json().catch(() => null);
      if (res.ok && body?.ok === true && body?.service === 'worldseed-db') return body;
      return { ok: false, reason: body?.reason ?? body?.error ?? `The server at this address is not the bank's (${res.status}).`, ...(body?.canCarry ? { canCarry: true } : {}) };
    } catch (e) {
      return { ok: false, reason: e instanceof Error ? e.message : String(e) };
    }
  },

  /** An old save holds the door: carry it over, as a person asked. The old file stays as it is. */
  async carryOldSave(): Promise<{ ok: boolean; lines: string[] }> {
    if (local) return { ok: false, lines: ['This game keeps its save in this browser, and has no old file to carry.'] };
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

  /** A world played live: documents `owns` claims go to `via`. Returns how to stop. */
  route(owns: (id: string) => boolean, via: Transport): () => void {
    const r = { owns, transport: via };
    routes = [...routes, r];
    return () => { routes = routes.filter(x => x !== r); };
  },

  async get(id: string): Promise<IWireDoc | null> {
    return (await request<{ doc: IWireDoc | null }>('/get', { id }, routeOf(id)?.transport)).doc;
  },

  async query(query: IWireQuery): Promise<IWireDoc[]> {
    return (await request<{ docs: IWireDoc[] }>('/query', query, routeOf(query.idPrefix)?.transport)).docs;
  },

  async search(search: IWireSearch): Promise<IWireDoc[]> {
    return (await request<{ docs: IWireDoc[] }>('/search', search)).docs;
  },

  async commit(commit: ICommitRequest): Promise<ICommitResult> {
    if (routes.length === 0) return request<ICommitResult>('/commit', commit);
    const idOf = (op: ICommitRequest['ops'][number]) => ('doc' in op ? op.doc.id : undefined);
    const groups = new Map<Transport, ICommitRequest['ops']>();
    for (const op of commit.ops) {
      const via = routeOf(idOf(op))?.transport ?? transport;
      groups.set(via, [...(groups.get(via) ?? []), op]);
    }
    if (groups.size === 1) return request<ICommitResult>('/commit', commit, [...groups.keys()][0]);
    let applied = true;
    let n = 0;
    // The world's parts first, each with its own id, so a retry of the whole is still applied once per part
    for (const [via, ops] of [...groups.entries()].sort(([a], [b]) => (a === transport ? 1 : b === transport ? -1 : 0))) {
      const part = via === transport ? commit.commitId : `${commit.commitId}:live${n++}`;
      const out = await request<ICommitResult>('/commit', { ...commit, commitId: part, ops }, via);
      applied = applied && out.applied;
    }
    return { applied };
  }
};
