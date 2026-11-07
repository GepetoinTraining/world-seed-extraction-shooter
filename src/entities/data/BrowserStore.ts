/**
 * THE STORE IN THE BROWSER (Pedro, 2026-11-04: "the DB layer needs to be local (idb) or postgress
 * for online play"). The game's own SqlStore, with all its law (the chain only appends, a commit
 * is whole or nothing, a treasury is a number the database adds to), on PGlite, which in a browser
 * keeps its files in IndexedDB. Nothing about play needs a server: the page is the game.
 *
 * Its migrations are the server's own files, bundled, and hashed the way drizzle hashes them on a
 * machine, so a browser's database and a served one keep one migrations table.
 *
 * ONE TAB. PGlite on IndexedDB is one Postgres in one page; a second tab opening it would corrupt
 * it, as a second process would a folder (connection.ts). A Web Lock holds it for the page's life,
 * and a second tab is told plainly rather than sharing.
 */
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import * as schema from '../../../shared/schema.pg';
import { SqlStore } from '../../../shared/SqlStore';
import { DatabaseUnavailable, type IDatabase } from '../../../shared/dbShared';
import { sha256Hex } from '../../../shared/logic/ledger/sha256';
import journal from '../../../drizzle/pg/meta/_journal.json';

const FILES = import.meta.glob('../../../drizzle/pg/*.sql', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

export interface IMigrationMeta { sql: string[]; bps: boolean; folderMillis: number; hash: string }

/** What drizzle's migrator reads from the folder, built from the bundle instead. */
export const BROWSER_MIGRATIONS: IMigrationMeta[] = journal.entries.map(entry => {
  const file = Object.entries(FILES).find(([path]) => path.endsWith(`/${entry.tag}.sql`));
  if (!file) throw new Error(`The migration ${entry.tag} is not in this build.`);
  const query = file[1];
  return { sql: query.split('--> statement-breakpoint'), bps: entry.breakpoints, folderMillis: entry.when, hash: sha256Hex(query) };
});

interface ILocks {
  request(name: string, options: { mode: 'exclusive'; ifAvailable: true }, grant: (lock: unknown) => unknown): Promise<unknown>;
}

/** Holds the store's lock for as long as the page lives, or says the store is held elsewhere. */
async function holdTheTab(name: string, locks: ILocks | undefined): Promise<void> {
  if (!locks) return;
  await new Promise<void>((resolve, reject) => {
    void locks.request(`worldseed-store:${name}`, { mode: 'exclusive', ifAvailable: true }, lock => {
      if (!lock) {
        reject(new DatabaseUnavailable('This game is open in another tab of this browser, and one tab holds its save at a time. Close the other tab, then reload this one.'));
        return undefined;
      }
      resolve();
      // Held until the page goes
      return new Promise(() => undefined);
    });
  });
}

export interface IBrowserStoreOptions {
  /** A test seam: the browser's Web Locks. */
  locks?: ILocks;
}

/** `idb://<name>` in a browser; `memory://` in a test. */
export async function openBrowserStore(dataDir = 'idb://worldseed', options: IBrowserStoreOptions = {}): Promise<SqlStore> {
  const locks = options.locks ?? (typeof navigator !== 'undefined' ? (navigator as any).locks : undefined);
  await holdTheTab(dataDir, locks);

  const client = await PGlite.create(dataDir);
  const db = drizzle(client, { schema });
  await (db as any).dialect.migrate(BROWSER_MIGRATIONS, (db as any).session, { migrationsFolder: '' });
  const database: IDatabase = {
    dialect: 'postgres',
    db,
    schema,
    compact: async () => { await client.exec('VACUUM'); },
    close: async () => client.close()
  };
  return new SqlStore(database);
}
