/**
 * THE SHARED BASE: two databases, one world's worth of what was found.
 *
 * test-claude is where every test session plays; test-pedro is Pedro's own, kept
 * free of minted characters. They share the definitions, every item's history and
 * the bank's registry of claims, in both directions. Everything that belongs to a
 * person stays put: characters, ledgers, treasuries, hubs, lots, sessions, worlds.
 *
 * Documents are copied as stored text, so a signature over them still verifies.
 * This is a sync you run, not a live link: `npm run pedro` runs it at every start,
 * and `npm run db:sync` runs it alone. Folders only, since a served database is one
 * database with nothing to sync.
 *
 * A folder has one opener at a time, so this holds both while it runs, and refuses
 * with a plain message if a running server holds either. Nothing is half-synced by
 * a refusal: neither side is written until both are open.
 */
import { sql } from 'drizzle-orm';
import { DatabaseUnavailable, IDatabase, openDatabase } from './connection';
import { documents } from '../shared/schema.pg';

const REGISTRY_ID = 'mint_registry_v1';

/** Definitions and what was found. World certificates and carts belong to their worlds. */
const SHARED = sql`(${documents.namespace} = 'items' OR (${documents.namespace} = 'content' AND ${documents.id} NOT LIKE 'world\\_%' ESCAPE '\\'))`;

type Row = typeof documents.$inferSelect;

export interface ISyncReport {
  /** Documents written into the target, and back into the source. */
  toTarget: number;
  toSource: number;
}

async function sharedRows(database: IDatabase): Promise<Map<string, Row>> {
  const rows: Row[] = await database.db.select().from(documents).where(SHARED);
  return new Map(rows.map(r => [r.id, r]));
}

async function writeAll(database: IDatabase, rows: Row[]): Promise<void> {
  if (rows.length === 0) return;
  await database.db.transaction(async (tx: any) => {
    for (const row of rows) {
      const { id, ...fields } = row;
      await tx.insert(documents).values(row).onConflictDoUpdate({ target: documents.id, set: fields });
    }
  });
}

/** Every claim from both, and where they differ the source's stands: the first keeps its claim. */
function mergedRegistry(source: Row, target: Row): string {
  const from = JSON.parse(source.data);
  const claims = new Map<string, string>(from.rows ?? []);
  for (const [hash, id] of (JSON.parse(target.data).rows ?? []) as [string, string][]) {
    if (!claims.has(hash)) claims.set(hash, id);
  }
  return JSON.stringify({ ...from, rows: [...claims.entries()] });
}

export async function syncBase(sourceUrl: string, targetUrl: string): Promise<ISyncReport> {
  if (sourceUrl === targetUrl) throw new Error('A database cannot be synced with itself.');
  for (const url of [sourceUrl, targetUrl]) {
    if (!url.startsWith('pglite://') || url === 'pglite://memory') throw new DatabaseUnavailable(`The base syncs between database folders, and "${url}" is not one.`);
  }

  // Opening runs the migrations, so a database that does not exist yet comes up ready.
  const source = await openDatabase(sourceUrl);
  try {
    const target = await openDatabase(targetUrl);
    try {
      const here = await sharedRows(source);
      const there = await sharedRows(target);
      const toTarget: Row[] = [];
      const toSource: Row[] = [];

      for (const id of new Set([...here.keys(), ...there.keys()])) {
        const a = here.get(id);
        const b = there.get(id);
        if (id === REGISTRY_ID && a && b) {
          const merged = mergedRegistry(a, b);
          const at = Math.max(a.updatedAt, b.updatedAt);
          if (a.data !== merged) toSource.push({ ...a, data: merged, updatedAt: at });
          if (b.data !== merged) toTarget.push({ ...b, data: merged, updatedAt: at });
        } else if (a && (!b || a.updatedAt > b.updatedAt)) {
          toTarget.push(a);
        } else if (b && (!a || b.updatedAt > a.updatedAt)) {
          toSource.push(b);
        }
      }

      await writeAll(target, toTarget);
      await writeAll(source, toSource);
      return { toTarget: toTarget.length, toSource: toSource.length };
    } finally {
      await target.close();
    }
  } finally {
    await source.close();
  }
}

/** What the game's start does with a sync it cannot run: says why, and plays on. A sync by itself reports it as a failure. */
export async function syncAtStart(sourceUrl: string, targetUrl: string, say: (line: string) => void): Promise<boolean> {
  try {
    const report = await syncBase(sourceUrl, targetUrl);
    say(`[DB] Shared base synced: ${report.toTarget} into test-pedro, ${report.toSource} into test-claude.`);
    return true;
  } catch (e) {
    if (!(e instanceof DatabaseUnavailable)) throw e;
    say(`[DB] The shared base was not synced this time: ${e.message}`);
    return false;
  }
}
