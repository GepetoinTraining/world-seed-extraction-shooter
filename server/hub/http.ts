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
import { timingSafeEqual } from 'node:crypto';
import type { Hub } from './Hub';
import { HubPool } from './pool';
import { HostedWorld } from './hosted';
import { deleteClerkUser, readClerkToken, readClerkWebhook, type IClerkConfig } from './clerk';
import type { Eraser } from './erase';
import type { DevView } from './dev';

/** What a deployed hub adds to the routes: who keeps its accounts, how one is deleted, and its scheduled call. */
export interface IHubHandlerParts {
  /** Clerk, on the hub whose accounts are an e-mail and a password (clerk.ts). */
  clerk?: IClerkConfig | null;
  /** Takes an account's data out (erase.ts). */
  eraser?: Eraser;
  /** What the host's scheduled call runs: the write-down to the record, and what waits on it. */
  maintain?: () => Promise<Record<string, unknown>>;
  /** What the scheduled call must carry (`Authorization: Bearer …`), from the host's secret store. */
  cronSecret?: string;
  /** The developers' view of the data (dev.ts), for the accounts on the host's list and nobody else. */
  dev?: DevView;
}

/** What an address that does not exist answers. A developers' route answers anyone not on the list the same, byte for byte. */
const noSuchRoute = (res: ServerResponse) => send(res, 404, { ok: false, reason: 'No such route on this hub.' });

/** The asked query, without what a host's rewrite carries beside it (vercel.json). */
const queryOf = (req: IncomingMessage) => {
  const query = new URL(req.url ?? '/', 'http://hub.invalid').searchParams;
  query.delete('__path');
  return query;
};

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

const cookieOf = (req: IncomingMessage, wanted: string) => {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [name, ...value] = part.trim().split('=');
    if (name === wanted) { try { return decodeURIComponent(value.join('=')); } catch { return ''; } }
  }
  return '';
};

/** The caller's token: a bearer header first, else this hub's cookie. */
export const tokenOf = (req: IncomingMessage) => {
  const header = req.headers.authorization ?? '';
  if (header.startsWith('Bearer ')) return header.slice('Bearer '.length).trim();
  return cookieOf(req, COOKIE);
};

const sameText = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

const cookie = (value: string, maxAge: number) =>
  `${COOKIE}=${value}; HttpOnly; Secure; SameSite=Strict; Path=/api/hub; Max-Age=${maxAge}`;

/** An answer from the hub, sent with its own status. */
const answer = (res: ServerResponse, out: { ok: boolean; status?: number }) => {
  const { status, ...rest } = out as { ok: boolean; status?: number };
  return send(res, out.ok ? 200 : status ?? 400, out.ok ? rest : { ...rest, status });
};

/** `path` is what follows the mount. */
export function createHubHandler(hub: Hub, parts: IHubHandlerParts = {}) {
  const pool = new HubPool(hub);
  const hosted = new HostedWorld(hub);
  const clerk = parts.clerk ?? null;
  return async (req: IncomingMessage, res: ServerResponse, path: string): Promise<void> => {
    try {
      // The host's scheduled call, by the secret the host gives it and nothing else: it is nobody's session
      if (path === '/maintenance') {
        if (!parts.maintain || !parts.cronSecret) return send(res, 404, { ok: false, reason: 'No such route on this hub.' });
        if (!sameText(req.headers.authorization ?? '', `Bearer ${parts.cronSecret}`)) return send(res, 401, { ok: false, reason: 'That call does not carry this hub\'s word.' });
        // When it last came, for the developers' view, noted before the write-down so the write-down carries it
        await hub.commit([{ kind: 'put', doc: hub.doc('hub_maintenance', { type: 'hub_maintenance', at: hub.now() }) }])
          .catch(e => console.warn('[HUB] The scheduled call could not note its run, and runs on:', e instanceof Error ? e.message : e));
        return send(res, 200, { ok: true, ...(await parts.maintain()) });
      }

      const token = tokenOf(req);

      // The developers' view (dev.ts): read only, and for anyone not on the host's list an address that does not exist
      if (req.method === 'GET' && (path === '/dev' || path.startsWith('/dev/'))) {
        const account = parts.dev ? await hub.session(token) : null;
        if (!parts.dev || !parts.dev.allows(account)) return noSuchRoute(res);
        const out = await parts.dev.read(account, path.slice('/dev'.length), queryOf(req));
        return out ? send(res, out.status, out.body) : noSuchRoute(res);
      }

      if (req.method === 'GET') {
        if (path === '/health') return send(res, 200, { ok: true, service: 'worldseed-hub', hub: { id: hub.id, publicKeyPem: hub.key.publicKeyPem, url: hub.publicUrl, accounts: hub.accounts }, time: Date.now() });
        if (path === '/where') {
          const account = await hub.session(token);
          // The publishable key is public by design: it is what a page loads Clerk with
          return send(res, 200, { configured: true, url: hub.publicUrl, signedIn: account?.handle ?? null, accounts: hub.accounts, ...(clerk ? { clerk: { publishableKey: clerk.publishableKey } } : {}) });
        }
        if (path === '/account') return answer(res, await hub.held(token));
        if (path === '/clock') return send(res, 200, { ok: true, statement: hub.clock() });
        if (path === '/session') {
          const account = await hub.session(token);
          // The account's own key, which is what the host's list of developers names (dev.ts)
          return account ? send(res, 200, { ok: true, account: { handle: account.handle, key: account.key } }) : send(res, 401, { ok: false, status: 401, reason: 'Sign in first.' });
        }
        if (path === '/characters') return answer(res, await hub.characters(token));
        if (path.startsWith('/record/')) return answer(res, await hub.record(token, decodeURIComponent(path.slice('/record/'.length))));
        if (path === '/pool') return answer(res, await pool.members(token));
        if (path.startsWith('/jobs/')) return answer(res, await pool.get(token, decodeURIComponent(path.slice('/jobs/'.length))));
        if (path === '/hosted') return answer(res, await hosted.describe());
        return noSuchRoute(res);
      }

      if (req.method !== 'POST') return send(res, 405, { ok: false, reason: 'GET or POST only.' });
      if (!(req.headers['content-type'] ?? '').startsWith('application/json')) return send(res, 415, { ok: false, reason: 'JSON only.' });

      // Clerk's own word (an account deleted there): checked over the very bytes it signed, before anything reads them
      if (path === '/clerk') {
        if (!clerk) return send(res, 404, { ok: false, reason: 'No such route on this hub.' });
        let raw: string;
        try { raw = await readBody(req); } catch { return send(res, 413, { ok: false, reason: 'That is more than one request carries.' }); }
        const said = readClerkWebhook(clerk, req.headers, raw, hub.now());
        if ('problem' in said) return send(res, 401, { ok: false, reason: said.problem });
        if (said.type === 'user.deleted' && typeof said.data?.id === 'string' && parts.eraser) {
          return send(res, 200, { ok: true, erased: await parts.eraser.erase(`clerk_${said.data.id}`) });
        }
        return send(res, 200, { ok: true });
      }

      let body: any;
      try {
        body = JSON.parse((await readBody(req)) || '{}');
      } catch (e) {
        if (e instanceof TooLarge) return send(res, 413, { ok: false, reason: 'That is more than one request carries. Send it in parts.' });
        return send(res, 400, { ok: false, reason: 'That was not JSON.' });
      }

      switch (path) {
        case '/sessions/clerk': {
          // Someone Clerk has signed in, on this hub's own page: this hub's session from here on, in its own cookie
          if (!clerk) return send(res, 404, { ok: false, reason: 'This hub keeps its own accounts.' });
          const who = readClerkToken(clerk, body.token ?? cookieOf(req, '__session'), hub.now());
          if ('problem' in who) return send(res, 401, { ok: false, status: 401, reason: who.problem });
          const out = await hub.signInAs({ provider: 'clerk', ...who });
          if (!out.ok) return answer(res, out);
          res.setHeader('Set-Cookie', cookie(encodeURIComponent(out.token), COOKIE_DAYS * 24 * 60 * 60));
          return send(res, 200, { ok: true, account: out.account });
        }
        case '/account/delete': {
          const account = await hub.session(token);
          if (!account) return send(res, 401, { ok: false, status: 401, reason: 'Sign in first.' });
          if (!parts.eraser) return send(res, 501, { ok: false, reason: 'This hub has no way to delete an account yet.' });
          // Asked for on purpose: the request names the account it deletes (`confirm`), so nothing deletes one by accident
          if (body.confirm !== account.handle) return send(res, 400, { ok: false, reason: 'That is not this account\'s handle. Write it exactly to delete the account and everything this hub holds of it. It cannot be undone.' });
          const erased = await parts.eraser.erase(account.key);
          res.setHeader('Set-Cookie', cookie('', 0));
          // The e-mail and password are Clerk's to delete: asked here, so one request takes everything
          const atClerk = clerk && account.key.startsWith('clerk_') ? await deleteClerkUser(clerk, account.key.slice('clerk_'.length)) : null;
          return send(res, 200, {
            ok: true, erased,
            ...(atClerk ? { signIn: atClerk.ok ? 'DELETED' : 'KEPT' } : {}),
            ...(atClerk && !atClerk.ok ? { reason: `Everything this hub held is deleted. Its e-mail and password could not be deleted from here (${atClerk.reason}): delete them from the account's own page.` } : {})
          });
        }
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
        default: return noSuchRoute(res);
      }
    } catch (e) {
      console.error('[HUB] A request failed:', e);
      return send(res, 500, { ok: false, reason: 'The hub failed on that. Try again.' });
    }
  };
}
