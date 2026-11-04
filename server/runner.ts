/**
 * THE RUNNER, on the person's own machine (DEPLOY.md). One listener serves their browser everything
 * at one address: the built game, their store (/api/db), the door to their model (/api/intelligence),
 * the bridge to a hub (/api/hub), and the game's clock (/api/clock, server/clock.ts). `server/main.ts` runs it; the dev server mounts the same doors.
 *
 * THE BRIDGE. The hub is somewhere else, at `WS_HUB_URL`. The browser asks the runner, and the runner
 * asks the hub, holding the hub's session token itself, in memory: the token never reaches the
 * browser, as a model key never does. A runner that restarts has forgotten it, and the person signs
 * in again. With no hub set, the bridge says so and the game plays on alone.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';

export type Door = (req: IncomingMessage, res: ServerResponse, path: string) => Promise<void> | void;

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);
const BODY_BYTES = 4 * 1024 * 1024;

const MIME: Record<string, string> = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.wasm': 'application/wasm'
};

function send(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > BODY_BYTES) { reject(new Error('too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/** Why a hub address will not be used, or null. A token goes in plain text only to this machine. */
export function hubUrlProblem(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return `"${url}" is not an address.`;
  }
  if (parsed.protocol === 'https:') return null;
  if (parsed.protocol === 'http:' && LOCAL_HOSTS.has(parsed.hostname)) return null;
  return `A hub is reached over https, unless it runs on this machine. "${url}" is not, so nothing is sent to it.`;
}

export interface IBridgeOptions {
  hubUrl?: string;
  allowRemote?: boolean;
}

/** `path` is what follows /api/hub. */
export function createHubBridge(options: IBridgeOptions): Door {
  const hubUrl = options.hubUrl?.trim().replace(/\/+$/, '') || undefined;
  const problem = hubUrl ? hubUrlProblem(hubUrl) : 'No hub is set for this game (WS_HUB_URL), so it plays on this machine alone.';
  let token: string | null = null;
  let handle: string | null = null;
  const forget = () => { token = null; handle = null; };

  return async (req, res, path) => {
    if (!options.allowRemote && !LOOPBACK.has(req.socket.remoteAddress ?? '')) {
      return send(res, 403, { ok: false, reason: 'This game answers this machine only.' });
    }
    if (req.method === 'GET' && path === '/where') {
      return send(res, 200, { configured: !problem, url: hubUrl ?? null, signedIn: handle, ...(problem ? { reason: problem } : {}) });
    }
    if (req.method !== 'GET' && req.method !== 'POST') return send(res, 405, { ok: false, reason: 'GET or POST only.' });
    if (req.method === 'POST' && !(req.headers['content-type'] ?? '').startsWith('application/json')) return send(res, 415, { ok: false, reason: 'JSON only.' });

    let body: string | undefined;
    if (req.method === 'POST') {
      try { body = (await readBody(req)) || '{}'; } catch { return send(res, 413, { ok: false, reason: 'That is more than one request carries.' }); }
    }
    if (problem || !hubUrl) return send(res, 200, { ok: false, status: 'NO_HUB', reason: problem });
    if (path === '/sessions' && body) {
      try { const asked = JSON.parse(body); delete asked.keep; body = JSON.stringify(asked); } catch { /* the hub says what is wrong with it */ }
    }

    let answer: Response;
    try {
      answer = await fetch(`${hubUrl}/api/hub${path}`, {
        method: req.method,
        headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        ...(body !== undefined ? { body } : {})
      });
    } catch (e) {
      return send(res, 502, { ok: false, status: 'OFFLINE', reason: `The hub cannot be reached: ${e instanceof Error ? e.message : String(e)}` });
    }
    const said: any = await answer.json().catch(() => ({ ok: false, reason: `The hub answered ${answer.status}, and not in JSON.` }));

    if (path === '/session/end') forget();
    if (answer.status === 401) forget();
    if (path === '/sessions' && answer.ok && typeof said?.token === 'string') {
      token = said.token;
      handle = said.account?.handle ?? null;
      delete said.token;
    }
    return send(res, answer.status, said);
  };
}

export interface IRunnerParts {
  clock: Door;
  db: Door;
  intelligence: Door;
  hub: Door;
  /** The built game. */
  dist?: string;
  /** Doors only, no game: a test, or a dev server that serves the game itself. */
  noStatic?: boolean;
}

export function createRunnerListener(parts: IRunnerParts) {
  const dist = parts.dist ? resolve(parts.dist) : undefined;
  return (req: IncomingMessage, res: ServerResponse) => {
    const path = (req.url ?? '/').split('?')[0];
    for (const [mount, door] of [['/api/intelligence', parts.intelligence], ['/api/db', parts.db], ['/api/hub', parts.hub], ['/api/clock', parts.clock]] as const) {
      if (path === mount || path.startsWith(`${mount}/`)) return void door(req, res, path.slice(mount.length) || '/');
    }
    if (parts.noStatic || !dist) {
      res.statusCode = 404;
      res.end();
      return;
    }
    let file: string;
    try {
      file = normalize(join(dist, path === '/' ? 'index.html' : decodeURIComponent(path)));
    } catch {
      file = join(dist, 'index.html');
    }
    const inside = file.startsWith(dist + sep) && existsSync(file) && statSync(file).isFile();
    const chosen = inside ? file : join(dist, 'index.html');
    if (!existsSync(chosen)) {
      res.statusCode = 404;
      res.end('No build here. Run npm run play, which builds first, or npm run dev for the dev server.');
      return;
    }
    res.setHeader('Content-Type', MIME[extname(chosen)] ?? 'application/octet-stream');
    createReadStream(chosen).pipe(res);
  };
}
