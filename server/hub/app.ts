/**
 * THE HUB, WHOLE, AS A FUNCTION HOST RUNS IT (DEPLOY.md). One composition for every place it runs:
 * the function on Vercel (`api/hub.ts`), and the local stand-ins (`npm run hub`, `npm run hosted`).
 * It answers plain requests and takes the socket's upgrade, so the checks and online play are one
 * deployment and nothing has to stay running between requests.
 *
 *   /api/hub/…               the hub's own routes (http.ts): accounts, characters, receipts, worlds, the pool
 *   /api/hub/live/…          online play on the world we host (live/room.ts): commits, claims
 *   /api/hub/live/socket     the socket (an upgrade)
 *   /api/hub/maintenance     the host's scheduled call: the write-down to the record, the erasures waiting on it
 *   /api/hub/clerk           Clerk's word that an account was deleted there (clerk.ts)
 *
 * SEVERAL INSTANCES. A function host starts as many of these as the traffic asks and may stop any
 * of them between requests, so nothing here is kept in an instance but what it can read again:
 * the store, the room's working table, and the word between instances (live/bus.ts).
 *
 *   WS_HUB_DATABASE_URL    the served Postgres (pooled is fine)
 *   WS_HUB_KEY             the hub's signing key, PKCS#8 PEM
 *   WS_PUBLIC_URL          the hub's own address
 *   WS_LIVE_DATABASE_URL   the hosted world's shared documents, if kept apart. Left out, they share the hub's database
 *   WS_LIVE_LISTEN_URL     a direct (not pooled) connection to that database, for the word between instances
 *   WS_RECORD              1 to keep the record on Turso (TURSO_DATABASE_URL, TURSO_AUTH_TOKEN);
 *                          a live database kept apart has a record of its own (TURSO_LIVE_DATABASE_URL), or none
 *   CRON_SECRET            what the scheduled call carries
 *   CLERK_…                accounts by e-mail and password (clerk.ts); left out, the hub keeps its own
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';
import { openLive, recordConfig } from '../record';
import { Hub, type IRefusal } from './Hub';
import type { IHubKey } from './keys';
import { createHubHandler, send, tokenOf } from './http';
import { hubConfigFrom } from './function';
import { HostedWorld, type IHostedManifest } from './hosted';
import { clerkConfigFrom, type IClerkConfig } from './clerk';
import { Eraser } from './erase';
import { LiveRoom, type LiveAccess } from '../live/room';
import { postgresBus, soloBus } from '../live/bus';
import { tableLines } from '../live/lines';

export interface IHubAppConfig {
  databaseUrl: string;
  key: IHubKey;
  publicUrl: string;
  liveDatabaseUrl?: string;
  liveListenUrl?: string;
  /** What the settings above do not carry (the record, Clerk, the scheduled call's secret). The process's own by default. */
  env?: NodeJS.ProcessEnv;
}

export function hubAppConfigFrom(env: NodeJS.ProcessEnv): IHubAppConfig | { problem: string } {
  const base = hubConfigFrom(env);
  if ('problem' in base) return base;
  return {
    ...base,
    ...(env.WS_LIVE_DATABASE_URL?.trim() ? { liveDatabaseUrl: env.WS_LIVE_DATABASE_URL.trim() } : {}),
    ...(env.WS_LIVE_LISTEN_URL?.trim() ? { liveListenUrl: env.WS_LIVE_LISTEN_URL.trim() } : {}),
    env
  };
}

const LIVE = '/live';
/** How long the hub's word on a character is taken before it is asked again: a barred character is out within this. */
const LIVE_WORD_MS = 30_000;
/**
 * How long a player whose socket closed is held in their place and their lines. A host closes
 * every socket on a timer and the browser is back within a second or two; five is how long the
 * others would go on drawing a silent player anyway (Presence.ts, GONE_AFTER_MS).
 */
const HOLD_MS = 5_000;

/**
 * The path after /api/hub. A host that rewrites every address under the mount to this one function
 * may hand over the function's own address, with the asked one carried beside it (`__path`,
 * vercel.json); either way reads the same.
 */
export function appPathOf(url: string | undefined): string {
  const asked = new URL(url ?? '/', 'http://hub.invalid');
  const direct = asked.pathname.replace(/^\/api\/hub/, '') || '/';
  const carried = asked.searchParams.get('__path');
  return direct === '/' && carried ? `/${carried.replace(/^\/+/, '')}` : direct;
}

const isServed = (url: string) => /^postgres(ql)?:\/\//.test(url);

export function createHubApp(config: IHubAppConfig | { problem: string }) {
  const open = async () => {
    if ('problem' in config) throw new Error(config.problem);
    const env = config.env ?? process.env;
    const found = clerkConfigFrom(env, config.publicUrl);
    if (found && 'problem' in found) throw new Error(found.problem);
    const clerk = found as IClerkConfig | null;

    const own = await openLive(config.databaseUrl, env);
    const hub = new Hub(own.store, config.key, { publicUrl: config.publicUrl, accounts: clerk ? 'clerk' : 'builtin' });
    const eraser = new Eraser(hub, own.database, recordConfig(env));

    // One database carries both unless the world's documents are kept apart. Two stores cannot share one
    // record: its write-downs are one chain with one head, and each would take the other's for a save it never came from.
    const liveUrl = config.liveDatabaseUrl && config.liveDatabaseUrl !== config.databaseUrl ? config.liveDatabaseUrl : null;
    const live = liveUrl
      ? await openLive(liveUrl, { ...env, TURSO_DATABASE_URL: env.TURSO_LIVE_DATABASE_URL, TURSO_AUTH_TOKEN: env.TURSO_LIVE_AUTH_TOKEN ?? env.TURSO_AUTH_TOKEN })
      : own;

    const listenUrl = config.liveListenUrl ?? (isServed(liveUrl ?? config.databaseUrl) ? liveUrl ?? config.databaseUrl : null);
    const bus = listenUrl ? await postgresBus(listenUrl) : soloBus();

    // Who may: the hub's own word (HostedWorld.connect), asked here and taken for a little while
    const hosted = new HostedWorld(hub);
    const heard = new Map<string, { until: number; answer: Awaited<ReturnType<LiveAccess>> }>();
    const access: LiveAccess = async (token, uid) => {
      if (!token) return { ok: false, status: 401, reason: 'Sign in to the hub first.' };
      const key = `${token}|${uid}`;
      const now = Date.now();
      const kept = heard.get(key);
      if (kept && kept.until > now) return kept.answer;
      const out = await hosted.connect(token, uid);
      const answer = out.ok
        ? { ok: true, worldUid: String((out as { manifest: IHostedManifest }).manifest.world.worldUid) }
        : { ok: false, status: (out as IRefusal).status, reason: (out as IRefusal).reason };
      for (const [k, v] of heard) if (v.until <= now) heard.delete(k);
      heard.set(key, { until: now + LIVE_WORD_MS, answer });
      return answer;
    };
    const room = new LiveRoom(live.store, access, Date.now, { bus, lines: await tableLines(live.database), holdMs: HOLD_MS });

    const maintain = async () => {
      const record: string[] = [];
      for (const store of liveUrl ? [own.store, live.store] : [own.store]) record.push((await store.maintain()).record?.status ?? 'NO_RECORD');
      return { record, erasuresWaiting: await eraser.sweep() };
    };
    const handler = createHubHandler(hub, { clerk, eraser, maintain, cronSecret: env.CRON_SECRET?.trim() || undefined });
    return {
      hub, room, handler, eraser,
      close: async () => {
        await room.close();
        if (liveUrl) await live.store.close();
        await own.store.close();
      }
    };
  };

  let opening: ReturnType<typeof open> | null = null;
  /** Opened on first need and kept while this instance is warm. A failure is tried again on the next request. */
  const ready = () => (opening ??= open().catch(e => { opening = null; throw e; }));

  return {
    ready,

    async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
      const path = appPathOf(req.url);
      let parts: Awaited<ReturnType<typeof open>>;
      try {
        parts = await ready();
      } catch (e) {
        return send(res, 503, { ok: false, reason: `This hub cannot check anything yet: ${e instanceof Error ? e.message : String(e)}` });
      }
      if (path === LIVE || path.startsWith(`${LIVE}/`)) {
        try {
          return await parts.room.http(req, res, path.slice(LIVE.length), tokenOf(req));
        } catch (e) {
          console.error('[LIVE] A request failed:', e);
          if (!res.headersSent) send(res, 500, { ok: false, reason: 'Online play failed on that. Try again.' });
          return;
        }
      }
      return parts.handler(req, res, path);
    },

    /** The socket's upgrade, and nothing else's. */
    upgrade(req: IncomingMessage, raw: Duplex): void {
      if (appPathOf(req.url) !== `${LIVE}/socket`) return void raw.destroy();
      ready().then(parts => parts.room.upgrade(req, raw, tokenOf(req))).catch(() => raw.destroy());
    },

    async close(): Promise<void> {
      const parts = opening ? await opening.catch(() => null) : null;
      opening = null;
      await parts?.close();
    }
  };
}
