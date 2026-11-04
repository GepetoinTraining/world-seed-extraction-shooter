/**
 * A MEMBER'S TURN IN THE POOL (server/hub/pool.ts), in the player's own browser. While the player
 * is in the pool, it asks the hub every so often whether there is a job and it is this player's
 * turn; if so, it asks this player's own door (the page's, on their own key or their own machine),
 * and hands the answer in to be checked. Our side never makes the call. The player can leave at
 * any time, and a job they leave behind goes back for another turn.
 */
import { DoorTransport } from '../intelligence/DoorTransport';
import { HubClient, IPoolJob } from './HubClient';

const EVERY_MS = 20_000;

export interface IPoolClient {
  takeJob(): Promise<{ ok: boolean; job?: IPoolJob | null; reason?: string }>;
  handIn(jobId: string, outcome: unknown): Promise<{ ok: boolean; reason?: string; diff?: unknown[] }>;
}

export type Ask = (path: string, body: unknown) => Promise<unknown>;

export interface ITurn { job?: IPoolJob; handedIn?: boolean; reason?: string }

/** One look: a job if it is this player's turn, run on their door and handed in. */
export async function takeTurn(client: IPoolClient = HubClient, ask: Ask = (path, body) => DoorTransport.json(path, body)): Promise<ITurn> {
  const taken = await client.takeJob();
  if (!taken.ok) return { reason: taken.reason };
  if (!taken.job) return {};
  let outcome: unknown;
  try {
    outcome = await ask(taken.job.path, taken.job.body);
  } catch (e) {
    outcome = { status: 'OFFLINE', reason: e instanceof Error ? e.message : String(e) };
  }
  const out = await client.handIn(taken.job.id, outcome);
  return { job: taken.job, handedIn: out.ok, ...(out.ok ? {} : { reason: out.reason }) };
}

let timer: ReturnType<typeof setInterval> | undefined;

export const PoolWorker = {
  start(onTurn?: (turn: ITurn) => void) {
    if (timer) return;
    const tick = () => { void takeTurn().then(t => onTurn?.(t), () => undefined); };
    timer = setInterval(tick, EVERY_MS);
    tick();
  },
  stop() {
    if (timer) clearInterval(timer);
    timer = undefined;
  },
  running: () => timer !== undefined
};
