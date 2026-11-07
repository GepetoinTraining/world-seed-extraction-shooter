/**
 * THE DOOR: the store over HTTP, as one handler that a dev server mounts and the
 * standalone server runs. Same code in both places.
 *
 * NO AUTHENTICATION, ON PURPOSE AND ON THE RECORD. Anyone who can reach this can
 * rewrite any save. So it answers loopback only unless told otherwise, and a
 * deploy must put real authentication in front of it first (D31 leaves that out).
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { SqlStore } from '../shared/SqlStore';
import { StoreConflict, StoreRefusal } from '../shared/SqlStore';
import { UncarriedSave } from './connection';

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

function send(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

export interface IHandlerOptions {
  allowRemote?: boolean;
  /** Carries an old save over, when the store refused for that reason (server/carryDoor.ts). */
  carry?: (oldFile: string, folder: string) => Promise<{ ok: boolean; lines: string[] }>;
}

/** `path` is what follows the mount point: /health, /get, /query, /search, /commit. */
export function createDbHandler(getStore: () => Promise<SqlStore>, options: IHandlerOptions = {}) {
  return async (req: IncomingMessage, res: ServerResponse, path: string): Promise<void> => {
    if (!options.allowRemote && !LOOPBACK.has(req.socket.remoteAddress ?? '')) {
      return send(res, 403, { error: 'This database answers this machine only. It has no authentication yet.' });
    }

    if (path === '/health') {
      try {
        return send(res, 200, await (await getStore()).health());
      } catch (e) {
        return send(res, 503, { ok: false, reason: e instanceof Error ? e.message : String(e), ...(e instanceof UncarriedSave && options.carry ? { canCarry: true } : {}) });
      }
    }

    if (req.method !== 'POST') return send(res, 405, { error: 'POST only.' });
    // A JSON content type forces a browser's preflight, which this door never
    // answers: another website cannot write here through a visitor's browser.
    if (!(req.headers['content-type'] ?? '').startsWith('application/json')) {
      return send(res, 415, { error: 'JSON only.' });
    }

    let store: SqlStore;
    try {
      store = await getStore();
    } catch (e) {
      // The one thing that can be asked of a store that will not open, because of what it says it needs.
      if (path === '/carry' && e instanceof UncarriedSave && options.carry) return send(res, 200, await options.carry(e.oldFile, e.folder));
      return send(res, 503, { error: e instanceof Error ? e.message : String(e) });
    }

    try {
      const body = JSON.parse(await readBody(req));
      if (path === '/get') return send(res, 200, { doc: await store.get(body.id) });
      if (path === '/query') return send(res, 200, { docs: await store.query(body) });
      if (path === '/search') return send(res, 200, { docs: await store.search(body) });
      if (path === '/commit') return send(res, 200, await store.commit(body));
      if (path === '/maintain') return send(res, 200, await store.maintain());
      if (path === '/record') return send(res, 200, await store.writeDown(String(body.why ?? 'asked')));
      return send(res, 404, { error: `No such door: ${path}` });
    } catch (e) {
      if (e instanceof StoreConflict) return send(res, 409, { conflict: true, error: e.message });
      if (e instanceof StoreRefusal || e instanceof SyntaxError) return send(res, 400, { error: e.message });
      console.error('[DB] The store failed:', e);
      return send(res, 500, { error: e instanceof Error ? e.message : String(e) });
    }
  };
}

/**
 * The store, opened once on first need, and retried if the first try failed. Closed
 * means closed: a request caught in a restart must not open the folder again on a
 * server that is gone, where nothing would ever close it and the new server could not open it.
 */
export function lazyStore(open: () => Promise<SqlStore>): { get: () => Promise<SqlStore>; close: () => Promise<void> } {
  let opening: Promise<SqlStore> | null = null;
  let closed = false;
  return {
    get: () => {
      if (closed) return Promise.reject(new Error('This server is closing.'));
      if (!opening) {
        opening = open().catch(e => { opening = null; throw e; });
      }
      return opening;
    },
    close: async () => {
      closed = true;
      if (opening) await (await opening.catch(() => null))?.close();
      opening = null;
    }
  };
}
