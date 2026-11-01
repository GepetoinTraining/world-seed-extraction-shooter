/**
 * THE CONNECTION: one URL picks the door, and everything past here is one path.
 *
 *   file:…            a SQLite file through libSQL (the local server)
 *   postgres://…      Postgres through node-postgres (deploy)
 *   pglite://memory   Postgres in process (the test suite)
 *
 * Migrations run on open, so a fresh file or a fresh database comes up ready.
 */
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as sqliteSchema from './schema.sqlite';
import * as pgSchema from './schema.pg';

/**
 * Two servers may open a new file at the same moment, and both find it empty. The
 * loser of that race waits and looks again: by then the winner's migration is on
 * the record, and there is nothing left to do. Any other error is a real one.
 */
const MIGRATE_ATTEMPTS = 10;
async function migrateTakingTurns(run: () => Promise<unknown>): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await run();
      return;
    } catch (e) {
      const said = `${e} ${(e as { cause?: unknown })?.cause ?? ''}`;
      if (attempt >= MIGRATE_ATTEMPTS || !/already exists/.test(said)) throw e;
      await new Promise(resolve => setTimeout(resolve, 100 * attempt));
    }
  }
}

export type Dialect = 'sqlite' | 'postgres';

export interface IDatabase {
  dialect: Dialect;
  /** Drizzle's query builders have the same shape on both dialects; their types do not unify. */
  db: any;
  schema: typeof sqliteSchema | typeof pgSchema;
  /** What each dialect needs to open a write transaction. */
  txConfig: unknown;
  close: () => Promise<void>;
}

export interface IOpenOptions {
  /** The pool size for postgres:// (a socket onto PGlite takes one connection at a time). */
  poolSize?: number;
}

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = (dialect: 'sqlite' | 'pg') => resolve(here, '..', 'drizzle', dialect);

function causeChain(e: unknown): any[] {
  const chain: any[] = [];
  for (let at: any = e; at && chain.length < 8; at = at.cause) chain.push(at);
  return chain;
}

/** Postgres reports a broken unique constraint by code; SQLite in its message. */
export const isUniqueViolation = (e: unknown) => causeChain(e).some(c =>
  c?.code === '23505' || /SQLITE_CONSTRAINT|UNIQUE constraint failed/i.test(`${c?.code ?? ''} ${c?.message ?? ''}`));

export async function openDatabase(url: string, options: IOpenOptions = {}): Promise<IDatabase> {
  if (url.startsWith('file:')) return openSqlite(url);
  if (url.startsWith('postgres://') || url.startsWith('postgresql://')) return openPostgres(url, options);
  if (url === 'pglite://memory') return openPglite();
  throw new Error(`The database URL "${url}" names no door this server has.`);
}

async function openSqlite(url: string): Promise<IDatabase> {
  const { createClient } = await import('@libsql/client');
  const { drizzle } = await import('drizzle-orm/libsql');
  const { migrate } = await import('drizzle-orm/libsql/migrator');

  mkdirSync(dirname(resolve(url.slice('file:'.length))), { recursive: true });

  // Several dev servers may share this file, one per port: writers wait their
  // turn rather than fail. WAL lets readers go on meanwhile.
  const client = createClient({ url, timeout: 30_000 });
  await client.execute('PRAGMA journal_mode=WAL');
  const db = drizzle(client, { schema: sqliteSchema });
  await migrateTakingTurns(() => migrate(db, { migrationsFolder: MIGRATIONS('sqlite') }));

  return {
    dialect: 'sqlite',
    db,
    schema: sqliteSchema,
    txConfig: { behavior: 'immediate' },
    close: async () => client.close()
  };
}

async function openPostgres(url: string, options: IOpenOptions): Promise<IDatabase> {
  const { Pool } = (await import('pg')).default;
  const { drizzle } = await import('drizzle-orm/node-postgres');
  const { migrate } = await import('drizzle-orm/node-postgres/migrator');

  const pool = new Pool({ connectionString: url, ...(options.poolSize ? { max: options.poolSize } : {}) });
  const db = drizzle(pool, { schema: pgSchema });
  await migrate(db, { migrationsFolder: MIGRATIONS('pg') });

  return {
    dialect: 'postgres',
    db,
    schema: pgSchema,
    txConfig: undefined,
    close: async () => pool.end()
  };
}

async function openPglite(): Promise<IDatabase> {
  const { PGlite } = await import('@electric-sql/pglite');
  const { drizzle } = await import('drizzle-orm/pglite');
  const { migrate } = await import('drizzle-orm/pglite/migrator');

  const client = await PGlite.create();
  const db = drizzle(client, { schema: pgSchema });
  await migrate(db, { migrationsFolder: MIGRATIONS('pg') });

  return {
    dialect: 'postgres',
    db,
    schema: pgSchema,
    txConfig: undefined,
    close: async () => client.close()
  };
}
