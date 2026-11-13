/**
 * THE HUB AS A FUNCTION (Pedro, 2026-11-04: "we don't compute anything, we check receipts... vercel
 * and players are computing view workers"). One stateless request handler over the hub's own
 * routes, and how a host's environment is read. What a host runs is app.ts, which puts online play,
 * the scheduled call and the accounts beside these routes (`entry.ts`, built for `api/hub.js`). Nothing here outlives a
 * call but the store's connection, which an instance opens once and reuses while it is warm.
 *
 * WS_HUB_DATABASE_URL   the served Postgres (postgres://…); a folder (pglite://…) for the local stand-in
 * WS_HUB_KEY            the hub's signing key, PKCS#8 PEM, from the host's secret store
 * WS_PUBLIC_URL         the hub's own address (the domain is configuration)
 * WS_RECORD             1 to keep the record on Turso through the keeper (TURSO_DATABASE_URL, TURSO_AUTH_TOKEN)
 *
 * Where the hub's own name is not set, what the host's integrations write for the same thing is
 * read (settings.ts). Everything missing is said at once, by name.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { openLiveStore } from '../record';
import { Hub } from './Hub';
import { IHubKey, makeHubKey } from './keys';
import { createHubHandler, send } from './http';
import { lacking, withHostNames } from './settings';

export interface IHubFunctionConfig {
  databaseUrl: string;
  key: IHubKey;
  publicUrl: string;
}

/** Why this hub cannot check anything yet: every setting it lacks or cannot read, by name, in one sentence each. */
export interface IConfigProblem {
  problem: string;
  missing?: string[];
  unreadable?: string[];
}

/** What a function host gives: the environment, read once per instance. */
export function hubConfigFrom(env: NodeJS.ProcessEnv): IHubFunctionConfig | IConfigProblem {
  const read = withHostNames(env);
  const said: string[] = [];
  const missing: string[] = [];
  const unreadable: string[] = [];
  const lack = (name: string) => { missing.push(name); said.push(lacking(name)); };

  const databaseUrl = read.WS_HUB_DATABASE_URL?.trim();
  if (!databaseUrl) lack('WS_HUB_DATABASE_URL');
  // A host's secret store may keep a key on one line, its line ends arriving as the two characters \ and n.
  // A key that cannot be read is said like any other missing setting: thrown here, it would kill the
  // function as it loads, and the host would answer for the hub with nothing a person can act on.
  let key: IHubKey | undefined;
  const pem = read.WS_HUB_KEY?.trim();
  if (!pem) lack('WS_HUB_KEY');
  else {
    try {
      key = makeHubKey(pem.replace(/\\n/g, '\n'));
    } catch (e) {
      unreadable.push('WS_HUB_KEY');
      // Node's own words about a bad key never quote it, so they are safe to pass on
      said.push(`WS_HUB_KEY cannot be read as a key (it is the PKCS#8 PEM text, whole, with its first and last lines): ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  const publicUrl = read.WS_PUBLIC_URL?.trim().replace(/\/+$/, '');
  if (!publicUrl) lack('WS_PUBLIC_URL');

  if (said.length > 0 || !databaseUrl || !key || !publicUrl) return { problem: said.join(' '), missing, unreadable };
  return { databaseUrl, key, publicUrl };
}

/** A handler for one hub, its store opened on first need and kept while the instance is warm. */
export function createHubFunction(config: IHubFunctionConfig | IConfigProblem) {
  let opening: Promise<ReturnType<typeof createHubHandler>> | null = null;
  const ready = () => {
    if ('problem' in config) return Promise.reject(new Error(config.problem));
    return (opening ??= openLiveStore(config.databaseUrl)
      .then(store => createHubHandler(new Hub(store, config.key, { publicUrl: config.publicUrl })))
      .catch(e => { opening = null; throw e; }));
  };

  return async (req: IncomingMessage, res: ServerResponse, path: string): Promise<void> => {
    if ('problem' in config) return notSetUp(res, config);
    let handle: ReturnType<typeof createHubHandler>;
    try {
      handle = await ready();
    } catch (e) {
      return send(res, 503, { ok: false, reason: `This hub cannot check anything yet: ${e instanceof Error ? e.message : String(e)}` });
    }
    return handle(req, res, path);
  };
}

/** The hub's own 503 for a hub not set up: the whole list of what is left to do, by name and never a value. */
export function notSetUp(res: ServerResponse, config: IConfigProblem): void {
  send(res, 503, { ok: false, reason: `This hub cannot check anything yet: ${config.problem}`, settings: { missing: config.missing ?? [], unreadable: config.unreadable ?? [] } });
}

/** The path after /api/hub, from whatever URL the host hands over. */
export const hubPathOf = (url: string | undefined) => (new URL(url ?? '/', 'http://hub.invalid').pathname.replace(/^\/api\/hub/, '') || '/');
