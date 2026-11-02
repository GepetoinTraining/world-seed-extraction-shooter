/**
 * THE CONNECTION: one URL picks the door, and everything past here is one path on
 * one dialect.
 *
 *   pglite://<folder>   Postgres in process on a folder (the local game): nobody installs a database
 *   postgres://…        Postgres through node-postgres (served)
 *   pglite://memory     Postgres in process on nothing (the test suite)
 *
 * Migrations run on open, so a fresh folder or a fresh database comes up ready.
 *
 * This is the live store. Turso holds the record behind it: see `record.ts`.
 *
 * ONE OPENER AT A TIME. SQLite let several dev servers share a file, one per port.
 * A PGlite folder is one Postgres in one process, and a second one opening it would
 * corrupt it: nothing in PGlite stops that, so the lock file beside the folder does.
 * Two dev servers in one checkout now need two folders (WS_DATABASE_URL), and the
 * second one is told so in plain words rather than sharing.
 *
 * WHAT A FOLDER DOES NOT PROMISE. PGlite's file layer never forces a write to the
 * disk: fsync is off and its fdatasync does nothing. A killed process loses nothing,
 * because the operating system holds what was written. A power cut or a crash of
 * the machine can lose the last moments and may damage the folder. A served
 * postgres:// database has neither limit.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as schema from './schema.pg';

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

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = resolve(here, '..', 'drizzle', 'pg');

/** The local door for a folder on this machine. */
export const folderUrl = (folder: string) => `pglite://${resolve(folder).replace(/\\/g, '/')}`;

/** Where a checkout's game lives unless told otherwise. */
export const defaultDatabaseUrl = (root: string) => folderUrl(resolve(root, 'data/test-claude'));

function causeChain(e: unknown): any[] {
  const chain: any[] = [];
  for (let at: any = e; at && chain.length < 8; at = at.cause) chain.push(at);
  return chain;
}

export const isUniqueViolation = (e: unknown) => causeChain(e).some(c => c?.code === '23505');

/** Class 22: this text or this number cannot be stored at all, and trying again will not change that. */
export const isDataException = (e: unknown) => causeChain(e).some(c => typeof c?.code === 'string' && c.code.startsWith('22'));

export async function openDatabase(url: string, options: IOpenOptions = {}): Promise<IDatabase> {
  if (url.startsWith('postgres://') || url.startsWith('postgresql://')) return openPostgres(url, options);
  if (url === 'pglite://memory') return openPglite();
  if (url.startsWith('pglite://')) return openPglite(resolve(url.slice('pglite://'.length)), options);
  if (url.startsWith('file:')) {
    const file = resolve(url.slice('file:'.length));
    throw new DatabaseUnavailable(`"${url}" is an old SQLite save, and this server no longer opens those. Carry it over once by hand: npm run db:carry -- "${file}" "<new folder>". The old file stays as it is.`);
  }
  throw new DatabaseUnavailable(`The database URL "${url}" names no door this server has.`);
}

async function openPostgres(url: string, options: IOpenOptions): Promise<IDatabase> {
  const { Pool } = (await import('pg')).default;
  const { drizzle } = await import('drizzle-orm/node-postgres');
  const { migrate } = await import('drizzle-orm/node-postgres/migrator');

  const pool = new Pool({ connectionString: url, ...(options.poolSize ? { max: options.poolSize } : {}) });
  const db = drizzle(pool, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS });

  return {
    dialect: 'postgres',
    db,
    schema,
    compact: async () => { await pool.query('VACUUM'); },
    close: async () => pool.end()
  };
}

// ---------------------------------------------------------------------------
// THE FOLDER
// ---------------------------------------------------------------------------

/** How long a second open in one process waits for the first to close, which is what a Vite restart does. */
const SAME_PROCESS_WAIT_MS = 10_000;
/** How long a new lock sits before it is trusted, so that of two openers finding one dead holder only one goes on. */
const LOCK_SETTLE_MS = 50;
/** A save this size of writes apart: often enough that the log stays small, rarely enough that nobody waits on it. */
const TIDY_EVERY_BYTES = 32 * 1024 * 1024;

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/**
 * What this process holds, kept on the process and not on this module. Vite bundles its
 * config afresh on every restart, so this file can be loaded twice in one process, and a
 * second copy with its own empty map would take its own process id on a lock for a stale
 * one, and open a folder the first copy still has open.
 */
const processHolds: { folders: Map<string, Promise<void>>; locks: Set<string>; releasesOnExit: boolean } =
  ((globalThis as any)[Symbol.for('worldseed.database.holds')] ??= { folders: new Map(), locks: new Set(), releasesOnExit: false });
const heldHere = processHolds.folders;
const locksToRelease = processHolds.locks;

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // EPERM: it is alive and belongs to someone else.
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

const heldMessage = (folder: string, lock: string, pid: number | string) =>
  `The database folder ${folder} is open in another process (${pid}), and one process holds a folder at a time. Stop that server, or give this one its own folder through WS_DATABASE_URL. If nothing is running, delete ${lock} and try again.`;

/** Takes the folder for this process, or says who has it. A dead holder's lock is taken over: a killed server cannot release its own. */
async function takeLock(folder: string): Promise<() => void> {
  const lock = `${folder}.lock`;
  const mine = JSON.stringify({ pid: process.pid, at: Date.now(), nonce: Math.random() });
  mkdirSync(dirname(folder), { recursive: true });

  for (let attempt = 0; ; attempt++) {
    try {
      writeFileSync(lock, mine, { flag: 'wx' });
      break;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
    }
    let pid: number | null = null;
    try { pid = JSON.parse(readFileSync(lock, 'utf8')).pid; } catch { /* being written this moment, or torn by a kill */ }
    if (pid === null && attempt < 3) { await sleep(LOCK_SETTLE_MS); continue; }
    if (pid !== null && pid !== process.pid && isAlive(pid)) throw new DatabaseUnavailable(heldMessage(folder, lock, pid));
    if (attempt >= 6) throw new DatabaseUnavailable(heldMessage(folder, lock, pid ?? 'unknown'));
    rmSync(lock, { force: true });
  }

  await sleep(LOCK_SETTLE_MS);
  let still = '';
  try { still = readFileSync(lock, 'utf8'); } catch { /* taken and gone: not ours */ }
  if (still !== mine) throw new DatabaseUnavailable(heldMessage(folder, lock, 'starting at this moment'));

  if (!processHolds.releasesOnExit) {
    processHolds.releasesOnExit = true;
    process.on('exit', () => { for (const l of locksToRelease) { try { rmSync(l, { force: true }); } catch { /* the next opener takes it over */ } } });
  }
  locksToRelease.add(lock);
  return () => {
    locksToRelease.delete(lock);
    // Only ever one's own: whoever came next may already hold this name.
    try { if (readFileSync(lock, 'utf8') === mine) rmSync(lock, { force: true }); } catch { /* gone already */ }
  };
}

/** An old save sits where this game's database should. A person can carry it over from where they stand. */
export class UncarriedSave extends DatabaseUnavailable {
  constructor(readonly oldFile: string, readonly folder: string, recordReachable: boolean) {
    super(`This save is still the old file ${oldFile}, and it has not been carried over. Nothing was changed and nothing was created. Carry it over here, which needs no account and takes a few seconds, or run this: npm run db:carry -- "${oldFile}" "${folder}"${recordReachable ? `. To send it straight to the record instead: npm run db:carry -- "${oldFile}" --to-record` : ''}. The old file stays as it is either way.`);
  }
}

/**
 * A person's save never starts over because nobody carried it. It would not stay harmless:
 * this browser still holds that avatar's key, so an empty database would start a second
 * chain under the same name as the one in the old file. So an old file with no folder holds
 * the door, and the door is one press to open: nothing about it needs a record or an account.
 */
function refuseUncarriedSave(folder: string, options: IOpenOptions) {
  const oldFile = `${folder}.db`;
  if (options.recordHoldsSave || existsSync(join(folder, 'PG_VERSION')) || !existsSync(oldFile)) return;
  throw new UncarriedSave(oldFile, folder, !!options.recordReachable);
}

async function openPglite(folder?: string, options: IOpenOptions = {}): Promise<IDatabase> {
  const { PGlite } = await import('@electric-sql/pglite');
  const { drizzle } = await import('drizzle-orm/pglite');
  const { migrate } = await import('drizzle-orm/pglite/migrator');

  if (!folder) {
    const client = await PGlite.create();
    const db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder: MIGRATIONS });
    return {
      dialect: 'postgres',
      db,
      schema,
      compact: async () => { await client.exec('VACUUM'); },
      close: async () => client.close()
    };
  }

  refuseUncarriedSave(folder, options);

  // Vite builds a restarted server before it closes the old one, in one process. Those
  // who wait go one at a time: nothing happens between the last look here and the set below.
  const giveUpAt = performance.now() + SAME_PROCESS_WAIT_MS;
  for (let closing = heldHere.get(folder); closing; closing = heldHere.get(folder)) {
    const left = giveUpAt - performance.now();
    if (left <= 0) throw new DatabaseUnavailable(heldMessage(folder, `${folder}.lock`, `this one, ${process.pid}`));
    await Promise.race([closing, sleep(left)]);
  }
  let released = () => {};
  const closed = new Promise<void>(r => { released = r; });
  heldHere.set(folder, closed);

  let unlock: () => void = () => {};
  const letGo = () => {
    unlock();
    if (heldHere.get(folder) === closed) heldHere.delete(folder);
    released();
  };

  try {
    unlock = await takeLock(folder);
    // A small log: single-user Postgres never checkpoints alone, so tidy() does, and this is what it keeps afterwards.
    const client = await PGlite.create(folder, {
      startParams: [...PGlite.defaultStartParams, '-c', 'max_wal_size=64MB', '-c', 'min_wal_size=32MB']
    });
    const db = drizzle(client, { schema });
    try {
      await migrate(db, { migrationsFolder: MIGRATIONS });
    } catch (e) {
      await client.close().catch(() => undefined);
      throw e;
    }

    return {
      dialect: 'postgres',
      db,
      schema,
      compact: async () => { await client.exec('VACUUM FULL'); await client.exec('CHECKPOINT'); },
      tidy: {
        everyBytes: TIDY_EVERY_BYTES,
        run: async () => { await client.exec('VACUUM'); await client.exec('CHECKPOINT'); }
      },
      close: async () => {
        try { await client.close(); } finally { letGo(); }
      }
    };
  } catch (e) {
    letGo();
    throw e;
  }
}
