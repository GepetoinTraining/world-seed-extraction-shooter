/**
 * What the store needs from a database, with nothing tied to Node, so the same SqlStore runs on a
 * folder, on a served Postgres, and in a browser on IndexedDB (src/entities/data/BrowserStore.ts).
 * Opening one is connection.ts's on a machine, and BrowserStore.ts's in a browser.
 */
import type * as schema from './schema.pg';

/** The database cannot be opened, for a reason a person can act on. The game shows this text. */
export class DatabaseUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DatabaseUnavailable';
  }
}

export interface IDatabase {
  dialect: 'postgres';
  db: any;
  schema: typeof schema;
  /** Maintenance (D103): gives back what weeks of writes left behind. */
  compact: () => Promise<void>;
  /**
   * What a database with no background workers needs between maintenances. Single-user
   * Postgres has no checkpointer and no autovacuum, so the log and the dead rows only
   * grow until someone asks. A served Postgres has both, and leaves this out.
   */
  tidy?: { everyBytes: number; run: () => Promise<void> };
  close: () => Promise<void>;
}

export interface IOpenOptions {
  /** The pool size for postgres:// (a socket onto PGlite takes one connection at a time). */
  poolSize?: number;
  /** The record already holds this game, so a new folder comes up from it, whatever old file sits beside it. */
  recordHoldsSave?: boolean;
  /** A record answered, so an old save has somewhere else it may go. */
  recordReachable?: boolean;
}

function causeChain(e: unknown): any[] {
  const chain: any[] = [];
  for (let at: any = e; at && chain.length < 8; at = at.cause) chain.push(at);
  return chain;
}

export const isUniqueViolation = (e: unknown) => causeChain(e).some(c => c?.code === '23505');

/** Class 22: this text or this number cannot be stored at all, and trying again will not change that. */
export const isDataException = (e: unknown) => causeChain(e).some(c => typeof c?.code === 'string' && c.code.startsWith('22'));

