/**
 * MAINTENANCE (D103): when the week's work happens.
 *
 * Asked whether a leader's weekly call goes out in a scan window, Pedro, 2026-11-01: "server downtime
 * for maintnance, locally it warns the player they need to maintain the DB, after the third warning
 * (10 days) it's forced". So on a served hub this is its downtime, which is Wave 13's to schedule.
 * On a person's own machine it is this: a warning at a week, a second, and a third on the tenth day,
 * and that third one does not ask.
 *
 * The law here is pure and takes `now` as an argument, because a server's wall clock is the truth
 * (D103) and a browser's is a known gap. The steps run in order, and one that fails does not stop the
 * rest: a person is only held here for as long as the work takes.
 */

import { VectorNamespace, VectorStore } from '../../entities/data/VectorStore';
import { IAskKind } from './ScanPass';
import { WEEK_MS } from './DecisionLayer';
import { LEADER_ASK } from './LeaderPlan';
import { IWriteDownReceipt } from '../../entities/data/wire';

const DAY_MS = 24 * 60 * 60 * 1000;

export const TEN_DAYS_MS = 10 * DAY_MS;
/** Pedro's numbers are the week and the tenth day. The second warning between them is the builder's reading. */
const WARN_AT_MS = [WEEK_MS, 8.5 * DAY_MS, TEN_DAYS_MS];

export interface IMaintenanceState {
  warnings: number;
  forced: boolean;
  /** How long since it last ran. */
  sinceMs: number;
  /** How long until the third warning, when it stops asking. */
  forcedInMs: number;
}

export interface IMaintenanceStep {
  name: string;
  /** A step that wrote to the record says how that went. */
  run(): Promise<void | IWriteDownReceipt>;
}

export interface IMaintenanceRun {
  failed: string[];
  record?: IWriteDownReceipt;
}

export interface IMaintenanceRoom {
  lastAt(): Promise<number | null>;
  mark(at: number): Promise<void>;
}

/** What goes out to a model in maintenance. A further weekly ask joins here. */
export const MAINTENANCE_ASKS: IAskKind[] = [LEADER_ASK];

const docId = 'maintenance_local';

/** A person's own machine: one record, beside the rest of what changes. */
export const localRoom: IMaintenanceRoom = {
  async lastAt() {
    const doc = await VectorStore.get<{ at: number }>(VectorNamespace.TERRITORIES, docId);
    return doc?.data?.at ?? null;
  },
  async mark(at) {
    await VectorStore.put({
      id: docId, namespace: VectorNamespace.TERRITORIES, data: { at },
      metadata: { createdAt: at, updatedAt: at, ownerCertUid: 'SYSTEM', version: 1 }
    });
  }
};

/** The downtime's work on the server: the record first, then compacting the live store, through the door it already has. */
export const STEPS: IMaintenanceStep[] = [
  {
    name: 'database',
    async run() {
      const res = await fetch('/api/db/maintain', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      if (!res.ok) throw new Error(`The database answered ${res.status}.`);
      return ((await res.json()) as { record?: IWriteDownReceipt }).record;
    }
  },
  {
    // The weekly call. With nothing waiting it asks nothing, which is every world until C2's hook is in
    name: 'leaders',
    async run() {
      for (const ask of MAINTENANCE_ASKS) ask.waiting({ generation: 0, felled: {}, fell: {}, weights: {} });
    }
  }
];

export class Maintenance {

  static stateAt(lastAt: number, now: number): IMaintenanceState {
    const sinceMs = Math.max(0, now - lastAt);
    const warnings = WARN_AT_MS.filter(at => sinceMs >= at).length;
    return { warnings, forced: warnings >= WARN_AT_MS.length, sinceMs, forcedInMs: Math.max(0, TEN_DAYS_MS - sinceMs) };
  }

  /** Runs what is due. The clock restarts when it is done, whatever a step said. */
  static async run(room: Pick<IMaintenanceRoom, 'mark'>, now: number, steps: IMaintenanceStep[] = STEPS): Promise<IMaintenanceRun> {
    const failed: string[] = [];
    let record: IWriteDownReceipt | undefined;
    for (const step of steps) {
      try {
        record = (await step.run()) || record;
      } catch (e) {
        console.error(`[MAINTENANCE] ${step.name} did not finish:`, e);
        failed.push(step.name);
      }
    }
    await room.mark(now);
    return { failed, record };
  }

  /** What a person is told. Done is only said of what is done, so the record not having it is said here too. */
  static say({ failed, record }: IMaintenanceRun): { line: string; tone: 'proof' | 'loss' } {
    const reached = !record || record.status === 'WRITTEN' || record.status === 'NOTHING' || record.status === 'NO_RECORD';
    const done = `Maintenance done${reached ? '' : ' on this machine'}`;
    const line = failed.length === 0 ? `${done}.` : `${done}, except ${failed.join(', ')}. It will try again next time.`;
    if (!reached) return { line: `${line} What you did has not gone up yet.`, tone: 'loss' };
    const tone = failed.length === 0 ? 'proof' : 'loss';
    return { line: record?.status === 'NO_RECORD' ? `${line} This game is kept on this machine only.` : line, tone };
  }
}
