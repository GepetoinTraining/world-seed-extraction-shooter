/**
 * THE HUB AS A FUNCTION (Pedro, 2026-11-04: "we don't compute anything, we check receipts... vercel
 * and players are computing view workers"). One stateless request handler over the hub's own
 * routes, and how a host's environment is read. What a host runs is app.ts, which puts online play,
 * the scheduled call and the accounts beside these routes (`api/hub.ts`). Nothing here outlives a
 * call but the store's connection, which an instance opens once and reuses while it is warm.
 *
 * WS_HUB_DATABASE_URL   the served Postgres (postgres://…); a folder (pglite://…) for the local stand-in
 * WS_HUB_KEY            the hub's signing key, PKCS#8 PEM, from the host's secret store
 * WS_PUBLIC_URL         the hub's own address (the domain is configuration)
 * WS_RECORD             1 to keep the record on Turso through the keeper (TURSO_DATABASE_URL, TURSO_AUTH_TOKEN)
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { openLiveStore } from '../record';
import { Hub } from './Hub';
import { IHubKey, makeHubKey } from './keys';
import { createHubHandler, send } from './http';

export interface IHubFunctionConfig {
  databaseUrl: string;
  key: IHubKey;
  publicUrl: string;
}

/** What a function host gives: the environment, read once per instance. */
export function hubConfigFrom(env: NodeJS.ProcessEnv): IHubFunctionConfig | { problem: string } {
  const databaseUrl = env.WS_HUB_DATABASE_URL?.trim();
  if (!databaseUrl) return { problem: 'WS_HUB_DATABASE_URL is not set: this hub has no store to check against.' };
  if (!env.WS_HUB_KEY?.trim()) return { problem: 'WS_HUB_KEY is not set: this hub has no key to sign with.' };
  const publicUrl = env.WS_PUBLIC_URL?.trim().replace(/\/+$/, '');
  if (!publicUrl) return { problem: 'WS_PUBLIC_URL is not set: this hub does not know its own address.' };
  return { databaseUrl, key: makeHubKey(env.WS_HUB_KEY.trim()), publicUrl };
}

/** A handler for one hub, its store opened on first need and kept while the instance is warm. */
export function createHubFunction(config: IHubFunctionConfig | { problem: string }) {
  let opening: Promise<ReturnType<typeof createHubHandler>> | null = null;
  const ready = () => {
    if ('problem' in config) return Promise.reject(new Error(config.problem));
    return (opening ??= openLiveStore(config.databaseUrl)
      .then(store => createHubHandler(new Hub(store, config.key, { publicUrl: config.publicUrl })))
      .catch(e => { opening = null; throw e; }));
  };

  return async (req: IncomingMessage, res: ServerResponse, path: string): Promise<void> => {
    let handle: ReturnType<typeof createHubHandler>;
    try {
      handle = await ready();
    } catch (e) {
      return send(res, 503, { ok: false, reason: `This hub cannot check anything yet: ${e instanceof Error ? e.message : String(e)}` });
    }
    return handle(req, res, path);
  };
}

/** The path after /api/hub, from whatever URL the host hands over. */
export const hubPathOf = (url: string | undefined) => (new URL(url ?? '/', 'http://hub.invalid').pathname.replace(/^\/api\/hub/, '') || '/');
