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
 * and `npm run db:sync` runs it alone. SQLite files only, since deploy has one
 * database and nothing to sync.
 */
import { createClient, Client, InStatement } from '@libsql/client';
import { openDatabase } from './connection';

const REGISTRY_ID = 'mint_registry_v1';

/** Definitions and what was found. World certificates and carts belong to their worlds. */
const SHARED = `(namespace = 'items' OR (namespace = 'content' AND id NOT LIKE 'world\\_%' ESCAPE '\\'))`;

const COLUMNS = ['id', 'namespace', 'data', 'embedding', 'doc_type', 'genre', 'owner_cert_uid', 'signature', 'version', 'created_at', 'updated_at'] as const;

type Row = Record<(typeof COLUMNS)[number], any>;

export interface ISyncReport {
  /** Documents written into the target, and back into the source. */
  toTarget: number;
  toSource: number;
}

async function sharedRows(client: Client): Promise<Map<string, Row>> {
  const result = await client.execute(`SELECT ${COLUMNS.join(', ')} FROM documents WHERE ${SHARED}`);
  return new Map(result.rows.map(r => [String(r.id), r as unknown as Row]));
}

const upsert = (row: Row): InStatement => ({
  sql: `INSERT INTO documents (${COLUMNS.join(', ')}) VALUES (${COLUMNS.map(() => '?').join(', ')})
        ON CONFLICT(id) DO UPDATE SET ${COLUMNS.filter(c => c !== 'id').map(c => `${c} = excluded.${c}`).join(', ')}`,
  args: COLUMNS.map(c => row[c] ?? null)
});

/** Every claim from both, and where they differ the source's stands: the first keeps its claim. */
function mergedRegistry(source?: Row, target?: Row): string | null {
  if (!source || !target) return null;
  const parse = (row: Row) => JSON.parse(String(row.data));
  const from = parse(source);
  const claims = new Map<string, string>(from.rows ?? []);
  for (const [hash, id] of (parse(target).rows ?? []) as [string, string][]) {
    if (!claims.has(hash)) claims.set(hash, id);
  }
  return JSON.stringify({ ...from, rows: [...claims.entries()] });
}

export async function syncBase(sourceUrl: string, targetUrl: string): Promise<ISyncReport> {
  if (sourceUrl === targetUrl) throw new Error('A database cannot be synced with itself.');
  for (const url of [sourceUrl, targetUrl]) {
    if (!url.startsWith('file:')) throw new Error(`The base syncs between SQLite files, and "${url}" is not one.`);
    // Opening runs the migrations, so a database that does not exist yet comes up ready.
    await (await openDatabase(url)).close();
  }

  const source = createClient({ url: sourceUrl, timeout: 30_000 });
  const target = createClient({ url: targetUrl, timeout: 30_000 });
  try {
    const here = await sharedRows(source);
    const there = await sharedRows(target);
    const toTarget: InStatement[] = [];
    const toSource: InStatement[] = [];

    for (const id of new Set([...here.keys(), ...there.keys()])) {
      const a = here.get(id);
      const b = there.get(id);
      if (id === REGISTRY_ID && a && b) {
        const merged = mergedRegistry(a, b)!;
        const at = Math.max(Number(a.updated_at), Number(b.updated_at));
        if (String(a.data) !== merged) toSource.push(upsert({ ...a, data: merged, updated_at: at }));
        if (String(b.data) !== merged) toTarget.push(upsert({ ...b, data: merged, updated_at: at }));
      } else if (a && (!b || Number(a.updated_at) > Number(b.updated_at))) {
        toTarget.push(upsert(a));
      } else if (b && (!a || Number(b.updated_at) > Number(a.updated_at))) {
        toSource.push(upsert(b));
      }
    }

    if (toTarget.length) await target.batch(toTarget, 'write');
    if (toSource.length) await source.batch(toSource, 'write');
    return { toTarget: toTarget.length, toSource: toSource.length };
  } finally {
    source.close();
    target.close();
  }
}
