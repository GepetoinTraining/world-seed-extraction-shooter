/**
 * The hub over HTTP, mounted at /api/hub. Routes are listed in DEPLOY.md.
 *
 * Unlike the game's doors this one answers the network: it is what a deployed server is for. So
 * every POST takes JSON only (a JSON body forces a browser's preflight, which this answers none of,
 * so another site cannot post here through a visitor's browser), a signed-in route takes a bearer
 * token in a header (which a cross-site form cannot set), and a body has a ceiling.
 *
 * A PAGE ON THE HUB'S OWN DOMAIN (the game, served beside it) signs in with `keep: 'cookie'`: the
 * token then goes into an HttpOnly, Secure, SameSite=Strict cookie scoped to /api/hub, which the
 * page's scripts cannot read, and is left out of the answer. A runner's bridge, which holds the
 * token itself, asks without it.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Hub } from './Hub';
import { HubPool } from './pool';
import { HostedWorld } from './hosted';

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

const COOKIE = 'ws_hub';
const COOKIE_DAYS = 30;

/** The caller's token: a bearer header first, else this hub's cookie. */
export const tokenOf = (req: IncomingMessage) => {
  const header = req.headers.authorization ?? '';
  if (header.startsWith('Bearer ')) return header.slice('Bearer '.length).trim();
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [name, ...value] = part.trim().split('=');
    if (name === COOKIE) return decodeURIComponent(value.join('='));
  }
  return '';
};

const cookie = (value: string, maxAge: number) =>
  `${COOKIE}=${value}; HttpOnly; Secure; SameSite=Strict; Path=/api/hub; Max-Age=${maxAge}`;

/** An answer from the hub, sent with its own status. */
const answer = (res: ServerResponse, out: { ok: boolean; status?: number }) => {
  const { status, ...rest } = out as { ok: boolean; status?: number };
  return send(res, out.ok ? 200 : status ?? 400, out.ok ? rest : { ...rest, status });
};

/** `path` is what follows the mount. */
export function createHubHandler(hub: Hub) {
  const pool = new HubPool(hub);
  const hosted = new HostedWorld(hub);
  return async (req: IncomingMessage, res: ServerResponse, path: string): Promise<void> => {
    try {
      const token = tokenOf(req);

      if (req.method === 'GET') {
        if (path === '/health') return send(res, 200, { ok: true, service: 'worldseed-hub', hub: { id: hub.id, publicKeyPem: hub.key.publicKeyPem, url: hub.publicUrl }, time: Date.now() });
        if (path === '/where') {
          const account = await hub.session(token);
          return send(res, 200, { configured: true, url: hub.publicUrl, signedIn: account?.handle ?? null });
        }
        if (path === '/clock') return send(res, 200, { ok: true, statement: hub.clock() });
        if (path === '/session') {
          const account = await hub.session(token);
          return account ? send(res, 200, { ok: true, account: { handle: account.handle } }) : send(res, 401, { ok: false, status: 401, reason: 'Sign in first.' });
        }
        if (path === '/characters') return answer(res, await hub.characters(token));
        if (path.startsWith('/record/')) return answer(res, await hub.record(token, decodeURIComponent(path.slice('/record/'.length))));
        if (path === '/pool') return answer(res, await pool.members(token));
        if (path.startsWith('/jobs/')) return answer(res, await pool.get(token, decodeURIComponent(path.slice('/jobs/'.length))));
        if (path === '/hosted') return answer(res, await hosted.describe());
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
        case '/sessions': {
          const out = await hub.signIn(body.handle, body.password);
          if (out.ok && body.keep === 'cookie') {
            res.setHeader('Set-Cookie', cookie(encodeURIComponent(out.token), COOKIE_DAYS * 24 * 60 * 60));
            return send(res, 200, { ok: true, account: out.account });
          }
          return answer(res, out);
        }
        case '/session/end':
          res.setHeader('Set-Cookie', cookie('', 0));
          if (!(await hub.session(token))) return send(res, 401, { ok: false, status: 401, reason: 'Sign in first.' });
          await hub.signOut(token);
          return send(res, 200, { ok: true });
        case '/characters/nonce': return answer(res, await hub.nonce(token));
        case '/characters': return answer(res, await hub.registerCharacter(token, body.certificate, body.proof));
        case '/receipts': return answer(res, await hub.checkReceipts(token, body.uid, body.rows, { reading: body.reading, sessions: body.sessions, tables: body.tables }));
        case '/people': return answer(res, await hub.checkPeople(token, body.chains));
        case '/people/table': return answer(res, await hub.peopleOf(token, body.city));
        case '/worlds/check': return answer(res, await hub.checkWorld(token, body.manifest));
        case '/pool/join': return answer(res, await pool.join(token, body.voice));
        case '/pool/leave': return answer(res, await pool.leave(token));
        case '/pool/beat': return answer(res, await pool.beat(token));
        case '/jobs': return answer(res, await pool.post(token, { kind: body.kind, path: body.path, body: body.body }));
        case '/jobs/take': return answer(res, await pool.take(token));
        case '/jobs/done': return answer(res, await pool.done(token, body.jobId, body.outcome));
        case '/jobs/withdraw': return answer(res, await pool.withdraw(token, body.jobId));
        case '/hosted/connect': return answer(res, await hosted.connect(token, body.uid));
        default: return send(res, 404, { ok: false, reason: 'No such route on this hub.' });
      }
    } catch (e) {
      console.error('[HUB] A request failed:', e);
      return send(res, 500, { ok: false, reason: 'The hub failed on that. Try again.' });
    }
  };
}
