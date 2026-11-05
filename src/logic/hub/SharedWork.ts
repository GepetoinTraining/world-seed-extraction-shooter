/**
 * SHARED WORK GOES ROUND THE POOL (Pedro, 2026-11-04: "the players in a server can rotate the one
 * using their key... distributed content generation"). What the game writes for everyone on a hub
 * (a world's passes, the chain, a theme's loot tables) is posted to the hub's pool when this player
 * is signed in to a hub whose pool has someone online. The member whose turn it is asks their own
 * door, the hub judges the answer by the law of its kind (server/hub/poolLaw.ts), and this client
 * reads the result back and judges it again, as it would its own door's.
 *
 * No hub, no pool, nobody online, or nobody took it in time: the player's own door answers, as it
 * always did, and the posted job is taken back so nobody spends a turn on it after. The game never
 * waits on the pool for longer than a turn would take.
 */
import { HubClient } from './HubClient';
import { PoolWorker, takeTurn } from './PoolWorker';

export type SharedKind = 'pass' | 'chain' | 'loot';

export interface IOutcomeLike { status: string; data?: unknown; reason?: string }

export interface ISharedClient {
  where: typeof HubClient.where;
  pool: typeof HubClient.pool;
  postJob: typeof HubClient.postJob;
  job: typeof HubClient.job;
  withdrawJob: typeof HubClient.withdrawJob;
}

export interface ISharedOptions {
  client?: ISharedClient;
  /** How long to wait for someone's turn before this player's own door answers. A turn's lease, by default. */
  waitMs?: number;
  everyMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

/** A taken job is handed in within its lease (pool.ts), so a wait as long finds it done or not coming. */
const WAIT_MS = 120_000;
const EVERY_MS = 2_000;

let off = false;

export const SharedWork = {
  /** For a player who wants every call on their own door: shared work never leaves this client. */
  keepToMyself(on: boolean) { off = on; },

  async ask<T extends IOutcomeLike>(kind: SharedKind, path: string, body: unknown, own: () => Promise<T>, o: ISharedOptions = {}): Promise<T> {
    const client = o.client ?? HubClient;
    if (off) return own();
    const where = await client.where();
    if (!where.configured || !where.signedIn) return own();
    const pool = await client.pool();
    if (!pool.ok || !(pool.members ?? []).some(m => m.online)) return own();

    const posted = await client.postJob(kind, path, body);
    if (!posted.ok || !posted.jobId) return own();
    // If this player is in the pool, their own worker looks now rather than at its next beat
    if (!o.client && PoolWorker.running()) void takeTurn().catch(() => undefined);

    const sleep = o.sleep ?? (ms => new Promise<void>(r => setTimeout(r, ms)));
    const every = o.everyMs ?? EVERY_MS;
    for (let waited = 0; waited < (o.waitMs ?? WAIT_MS); waited += every) {
      await sleep(every);
      const seen = await client.job(posted.jobId);
      if (seen.ok && seen.job?.state === 'DONE') return { status: 'OK', data: seen.job.result } as T;
    }
    const back = await client.withdrawJob(posted.jobId);
    // Done in the moment between the last look and taking it back: the result stands, and is used
    if (!back.ok && back.status === 409) {
      const seen = await client.job(posted.jobId);
      if (seen.ok && seen.job?.state === 'DONE') return { status: 'OK', data: seen.job.result } as T;
    }
    return own();
  }
};
