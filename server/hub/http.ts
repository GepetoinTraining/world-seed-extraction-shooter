/**
 * The hub over HTTP, mounted at /api/hub. Routes are listed in DEPLOY.md.
 *
 * Unlike the game's doors this one answers the network: it is what a deployed server is for. So
 * every POST takes JSON only (a JSON body forces a browser's preflight, which this answers none of,
 * so another site cannot post here through a visitor's browser), a signed-in route takes a bearer
 * token in a header (which a cross-site form cannot set), and a body has a ceiling.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Hub } from './Hub';

/** A request body larger than this is refused unread. Receipts come in batches well under it. */
export const HUB_BODY_BYTES = 4 * 1024 * 1024;

export function send(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(JSON.stringify(body));
}

class TooLarge extends Error {}

function readBody(req: IncomingMessage, limit = HUB_BODY_BYTES): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > limit) { reject(new TooLarge()); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const bearer = (req: IncomingMessage) => {
  const header = req.headers.authorization ?? '';
  return header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : '';
};

/** An answer from the hub, sent with its own status. */
const answer = (res: ServerResponse, out: { ok: boolean; status?: number }) => {
  const { status, ...rest } = out as { ok: boolean; status?: number };
  return send(res, out.ok ? 200 : status ?? 400, out.ok ? rest : { ...rest, status });
};

/** `path` is what follows the mount. */
export function createHubHandler(hub: Hub) {
  return async (req: IncomingMessage, res: ServerResponse, path: string): Promise<void> => {
    try {
      const token = bearer(req);

      if (req.method === 'GET') {
        if (path === '/health') return send(res, 200, { ok: true, service: 'worldseed-hub', hub: { id: hub.id, publicKeyPem: hub.key.publicKeyPem, url: hub.publicUrl }, time: Date.now() });
        if (path === '/clock') return send(res, 200, { ok: true, statement: hub.clock() });
        if (path === '/session') {
          const account = await hub.session(token);
          return account ? send(res, 200, { ok: true, account: { handle: account.handle } }) : send(res, 401, { ok: false, status: 401, reason: 'Sign in first.' });
        }
        if (path === '/characters') return answer(res, await hub.characters(token));
        if (path.startsWith('/record/')) return answer(res, await hub.record(token, decodeURIComponent(path.slice('/record/'.length))));
        return send(res, 404, { ok: false, reason: 'No such route on this hub.' });
      }

      if (req.method !== 'POST') return send(res, 405, { ok: false, reason: 'GET or POST only.' });
      if (!(req.headers['content-type'] ?? '').startsWith('application/json')) return send(res, 415, { ok: false, reason: 'JSON only.' });

      let body: any;
      try {
        body = JSON.parse((await readBody(req)) || '{}');
      } catch (e) {
        if (e instanceof TooLarge) return send(res, 413, { ok: false, reason: 'That is more than one request carries. Send it in parts.' });
        return send(res, 400, { ok: false, reason: 'That was not JSON.' });
      }

      switch (path) {
        case '/accounts': return answer(res, await hub.createAccount(body.handle, body.password));
        case '/sessions': return answer(res, await hub.signIn(body.handle, body.password));
        case '/session/end':
          if (!(await hub.session(token))) return send(res, 401, { ok: false, status: 401, reason: 'Sign in first.' });
          await hub.signOut(token);
          return send(res, 200, { ok: true });
        case '/characters/nonce': return answer(res, await hub.nonce(token));
        case '/characters': return answer(res, await hub.registerCharacter(token, body.certificate, body.proof));
        case '/receipts': return answer(res, await hub.checkReceipts(token, body.uid, body.rows));
        default: return send(res, 404, { ok: false, reason: 'No such route on this hub.' });
      }
    } catch (e) {
      console.error('[HUB] A request failed:', e);
      return send(res, 500, { ok: false, reason: 'The hub failed on that. Try again.' });
    }
  };
}
