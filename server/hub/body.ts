/**
 * THE HUB'S STORE, AND WHAT STANDS UNDER IT, BY ITS ADDRESS (HT0). The hub's parts ask a store for its
 * law (server/store.ts), and the database under it for three things around the law: taking a player's
 * data out (erase.ts), the live room's lines (live/lines.ts) and the word between instances
 * (live/bus.ts). Each body answers all four in its own way:
 *
 *   postgres://… pglite://…   SqlStore on Postgres, with the record written down to Turso when asked
 *                             (WS_RECORD=1); taken out in one transaction; lines in the room's own
 *                             table; the word between instances through LISTEN and NOTIFY
 *   libsql://… https://…      TursoStore on Turso alone (Pedro, 2026-11-13: "Yes, Turso only"): the store
 *                             is its own record; taken out in one request; lines in its own table, changed
 *                             by version; the word between instances is the store read on a beat
 *
 * And the developers' view (server/hub/dev.ts) reads each through its own body of `IDevStore`
 * (devStorePostgres.ts, devStoreTurso.ts), so its routes and page never know which is underneath (HT21).
 */
import type { IDatabase } from '../../shared/dbShared';
import { openLive, recordConfig, type IKeeperOptions, type IRecordConfig } from '../record';
import { isTursoUrl, openTursoStore, STORE_IS_ITS_RECORD } from '../tursoStore';
import type { IStore } from '../store';
import type { IEraseHere } from './erase';
import { postgresBus, soloBus, type ILiveBus } from '../live/bus';
import { tableLines, type ILineBook } from '../live/lines';
import { instanceId, tursoBus, tursoLines, TURSO_LIVE, type ITursoLiveTiming } from '../live/tursoLive';
import type { IDevStore } from './devStore';
import { PostgresDevStore } from './devStorePostgres';
import { TursoDevStore } from './devStoreTurso';
import type { IDevLive } from './dev';

export interface IBody {
  kind: 'postgres' | 'turso';
  store: IStore;
  /** How a player's data is taken out around the store's law (erase.ts). */
  eraseHere: IDatabase | IEraseHere;
  /** The record this store is written down to. None where the store is Turso: it is its own. */
  record: IRecordConfig;
  /** The Postgres under the store, for the parts that read it raw. None on Turso. */
  database?: IDatabase;
  /** The daily call for this store, and its word for the record: the keeper's, NO_RECORD, or IN_STORE where the store is its own record. */
  maintain(): Promise<string>;
  lines(): Promise<ILineBook>;
  /** The word between instances. On Postgres, through `listenUrl` when it is a served database; on Turso, read on a beat. */
  bus(options?: { listenUrl?: string | null } & Partial<ITursoLiveTiming>): Promise<ILiveBus>;
  /** What the developers' view reads, whatever the store is (devStore.ts). */
  dev(): IDevStore;
  /** How this body's instances hear each other, in the developers' view's words. */
  between(listenUrl?: string | null): IDevLive;
}

export interface IBodyOptions extends IKeeperOptions {
  /** Turso's token, for a Turso address. */
  token?: string;
}

export async function openBody(url: string, env: NodeJS.ProcessEnv = process.env, options: IBodyOptions = {}): Promise<IBody> {
  if (isTursoUrl(url)) {
    const store = await openTursoStore({ url, authToken: options.token });
    // Opened now, so a host that cannot reach it says so on the first request and not on the tenth
    await store.ready();
    // HT5: the store is already on Turso, so nothing is written down twice, whatever WS_RECORD says
    if (recordConfig(env).on) (options.say ?? console.log)(`[HUB] WS_RECORD is set, and this hub's store is on Turso itself. ${STORE_IS_ITS_RECORD}`);
    const instance = instanceId();
    return {
      kind: 'turso',
      store,
      eraseHere: store,
      record: { on: false },
      maintain: async () => { await store.maintain(); return 'IN_STORE'; },
      lines: () => tursoLines(store, instance),
      bus: (timing = {}) => tursoBus(store, { ...timing, id: instance }),
      dev: () => new TursoDevStore(store),
      between: () => ({ word: 'beat', ...TURSO_LIVE })
    };
  }
  const { store, database } = await openLive(url, env, options);
  return {
    kind: 'postgres',
    store,
    eraseHere: database,
    record: recordConfig(env),
    database,
    maintain: async () => (await store.maintain()).record?.status ?? 'NO_RECORD',
    lines: () => tableLines(database),
    bus: async ({ listenUrl } = {}) => (listenUrl ? postgresBus(listenUrl) : soloBus()),
    dev: () => new PostgresDevStore(store, database),
    between: listenUrl => ({ word: listenUrl ? 'listen' : 'alone' })
  };
}
