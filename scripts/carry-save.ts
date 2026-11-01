/**
 * CARRYING A SAVE OVER: the old SQLite file in, a new Postgres folder out. Pedro's
 * choice, and run by hand, once, by a person. Nothing migrates by itself.
 *
 *   npm run db:carry -- <old-file> <new-folder>
 *
 * What it promises:
 *   - The old file is never opened. It is copied, the copy is read, and the file's
 *     bytes are hashed before and after to prove it.
 *   - It refuses to write over anything that already exists at the target.
 *   - The folder is built under another name and takes its real name only once it
 *     has been closed, reopened from disk and checked. A half-carried save can never
 *     look like a save.
 *   - All four tables, commits included, and every text byte for byte, because
 *     signatures cover the exact content.
 *
 * Success is the CARRIED line and the receipt beside the folder, and never the exit
 * code alone: this is the one place libSQL is still loaded, and that driver can exit
 * 139 after finishing (N16). So everything here is written synchronously, before the
 * driver gets a chance to take the process down.
 */
import { createHash } from 'node:crypto';
import { closeSync, copyFileSync, existsSync, fsyncSync, mkdtempSync, openSync, readFileSync, renameSync, rmSync, statSync, writeFileSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { sql } from 'drizzle-orm';
import { DatabaseUnavailable, folderUrl, IDatabase, openDatabase } from '../server/connection';
import * as schema from '../server/schema.pg';

type TableName = 'documents' | 'ledger_rows' | 'treasuries' | 'commits';
type Row = Record<string, unknown>;

interface ITableShape {
  name: TableName;
  /** Every column the table has, in the database's own names. */
  columns: string[];
  /** Whole numbers on Postgres. SQLite would have held a fraction there and said nothing. */
  whole: string[];
  text: string[];
}

const TABLES: ITableShape[] = [
  {
    name: 'documents',
    columns: ['id', 'namespace', 'data', 'embedding', 'doc_type', 'genre', 'owner_cert_uid', 'signature', 'version', 'created_at', 'updated_at'],
    whole: ['version', 'created_at', 'updated_at'],
    text: ['id', 'namespace', 'data', 'embedding', 'doc_type', 'genre', 'owner_cert_uid', 'signature']
  },
  {
    name: 'ledger_rows',
    columns: ['id', 'owner_uid', 'seq', 'prev_seq', 'ts', 'type', 'signature', 'data', 'version', 'created_at', 'updated_at'],
    whole: ['seq', 'prev_seq', 'ts', 'version', 'created_at', 'updated_at'],
    text: ['id', 'owner_uid', 'type', 'signature', 'data']
  },
  {
    name: 'treasuries',
    columns: ['id', 'namespace', 'gold', 'created_at', 'updated_at'],
    whole: ['created_at', 'updated_at'],
    text: ['id', 'namespace']
  },
  {
    name: 'commits',
    columns: ['id', 'at'],
    whole: ['at'],
    text: ['id']
  }
];

/** What each table's rows go through to reach the driver, by the schema's own property names. */
const DRIZZLE_TABLES: Record<TableName, any> = {
  documents: schema.documents,
  ledger_rows: schema.ledgerRows,
  treasuries: schema.treasuries,
  commits: schema.commits
};

const camel = (column: string) => column.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

const PAGE = 500;

class Refusal extends Error {}

const sha = (text: string | Buffer) => createHash('sha256').update(text).digest('hex');

/** One row, as text nothing can reorder: its columns in their fixed order. */
const fingerprint = (shape: ITableShape, row: Row) => sha(JSON.stringify(shape.columns.map(c => row[c] ?? null)));

function hashFile(path: string): string {
  return sha(readFileSync(path));
}

interface IHeld {
  rows: number;
  /** Row id to its fingerprint, for naming the first row that differs. */
  prints: Map<string, string>;
  digest: string;
}

function digestOf(prints: Map<string, string>): string {
  const hash = createHash('sha256');
  for (const [id, print] of prints) hash.update(`${id}\0${print}\n`);
  return hash.digest('hex');
}

/** Reads the copy through libSQL, which nothing else in the game loads any more. */
async function readOldSave(copyPath: string, take: (shape: ITableShape, rows: Row[]) => Promise<void>, say: (line: string) => void): Promise<{ truncated: number }> {
  const { createClient } = await import('@libsql/client');
  const client = createClient({ url: `file:${copyPath.replace(/\\/g, '/')}` });
  let truncated = 0;
  try {
    const integrity = String((await client.execute('PRAGMA integrity_check')).rows[0]?.[0] ?? '');
    if (integrity !== 'ok') throw new Refusal(`The old file fails its own integrity check: ${integrity}`);
    say('  old file integrity_check: ok');

    for (const shape of TABLES) {
      const present = (await client.execute({ sql: `SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`, args: [shape.name] })).rows.length;
      if (!present) throw new Refusal(`The old file has no ${shape.name} table, so it is not a World Seed save.`);

      let after = '';
      for (;;) {
        // Each text column's stored size, from SQLite itself. The driver cuts text at a NUL
        // and says nothing, so what it returned is never taken for what the file holds.
        const sizes = shape.text.map(c => `length(CAST(${c} AS BLOB)) AS ${c}__bytes`).join(', ');
        const page = await client.execute({
          sql: `SELECT ${shape.columns.join(', ')}, ${sizes} FROM ${shape.name} WHERE id > ? ORDER BY id LIMIT ${PAGE}`,
          args: [after]
        });
        if (page.rows.length === 0) break;
        const rows: Row[] = page.rows.map(r => {
          const row: Row = {};
          for (const c of shape.columns) row[c] = r[c] ?? null;
          for (const c of shape.text) {
            const value = row[c];
            if (value === null) continue;
            if (typeof value !== 'string') throw new Refusal(`${shape.name} row "${row.id}" holds something other than text in ${c}. Nothing was written under the target's name.`);
            const stored = Number(r[`${c}__bytes`]);
            if (Buffer.byteLength(value, 'utf8') !== stored) {
              throw new Refusal(`${shape.name} row "${row.id}" holds ${stored} bytes in ${c}, and the driver returned ${Buffer.byteLength(value, 'utf8')}. That is a NUL character or broken text, which Postgres cannot store and this tool will not cut. Nothing was written under the target's name.`);
            }
          }
          for (const c of shape.whole) {
            const value = Number(row[c]);
            if (!Number.isInteger(value)) {
              row[c] = Math.trunc(value);
              truncated++;
            } else {
              row[c] = value;
            }
          }
          if (shape.name === 'treasuries') row.gold = Number(row.gold);
          return row;
        });
        await take(shape, rows);
        after = String(page.rows[page.rows.length - 1].id);
      }
    }
  } finally {
    client.close();
  }
  return { truncated };
}

async function writeRows(db: IDatabase, shape: ITableShape, rows: Row[]) {
  const table = DRIZZLE_TABLES[shape.name];
  const values = rows.map(r => Object.fromEntries(shape.columns.map(c => [camel(c), r[c]])));
  await db.db.transaction(async (tx: any) => {
    for (const value of values) await tx.insert(table).values(value);
  });
}

/** The new side, read back through plain SQL: ids in byte order, the same order the old side gave. */
async function readNewSide(db: IDatabase, shape: ITableShape): Promise<IHeld> {
  const prints = new Map<string, string>();
  let after = '';
  for (;;) {
    const result = await db.db.execute(sql`SELECT ${sql.raw(shape.columns.join(', '))} FROM ${sql.raw(shape.name)} WHERE id COLLATE "C" > ${after} ORDER BY id COLLATE "C" LIMIT ${sql.raw(String(PAGE))}`);
    const rows: Row[] = result.rows;
    if (rows.length === 0) break;
    for (const r of rows) {
      const row: Row = { ...r };
      for (const c of shape.whole) row[c] = Number(row[c]);
      if (shape.name === 'treasuries') row.gold = Number(row.gold);
      prints.set(String(row.id), fingerprint(shape, row));
    }
    after = String(rows[rows.length - 1].id);
  }
  return { rows: prints.size, prints, digest: digestOf(prints) };
}

function firstDifference(oldSide: Map<string, string>, newSide: Map<string, string>): string | null {
  for (const [id, print] of oldSide) {
    if (!newSide.has(id)) return `row "${id}" did not arrive`;
    if (newSide.get(id) !== print) return `row "${id}" differs`;
  }
  for (const id of newSide.keys()) if (!oldSide.has(id)) return `row "${id}" appeared from nowhere`;
  return null;
}

/** The balances as both sides hold them, compared as numbers and printed in full. */
async function readBalances(db: IDatabase): Promise<Map<string, number>> {
  const result = await db.db.execute(sql.raw(`SELECT id, gold FROM treasuries ORDER BY id COLLATE "C"`));
  return new Map(result.rows.map((r: Row) => [String(r.id), Number(r.gold)]));
}

/** Every chain still runs 1, 2, 3 with no gap: the column check, not the signatures, which hold no keys here. */
async function chainsAreWhole(db: IDatabase): Promise<{ chains: number; broken: string[] }> {
  const result = await db.db.execute(sql.raw(`SELECT owner_uid, COUNT(*) n, MIN(seq) lo, MAX(seq) hi, SUM(CASE WHEN prev_seq = seq - 1 THEN 0 ELSE 1 END) bad FROM ledger_rows GROUP BY owner_uid`));
  const broken = result.rows
    .filter((r: Row) => !(Number(r.lo) === 1 && Number(r.hi) === Number(r.n) && Number(r.bad) === 0))
    .map((r: Row) => String(r.owner_uid));
  return { chains: result.rows.length, broken };
}

export async function carrySave(oldFile: string, targetFolder: string, emit: (line: string) => void): Promise<boolean> {
  const source = resolve(oldFile);
  const target = resolve(targetFolder);
  const partial = `${target}.partial`;
  const receipt = `${target}.carried.txt`;
  const lines: string[] = [];
  const say = (line: string) => { lines.push(line); emit(line); };
  let copyDir: string | null = null;

  try {
    if (!existsSync(source) || !statSync(source).isFile()) throw new Refusal(`There is no file at ${source}.`);
    if (existsSync(target)) throw new Refusal(`Something already exists at ${target}, and this tool never writes over anything. Move it aside yourself if you mean to replace it.`);

    say(`Carrying ${source}`);
    say(`      to ${target}`);

    // The old file, with its write-ahead log: without the log, the newest play is missing.
    const companions = [source, `${source}-wal`].filter(p => existsSync(p));
    const before = new Map(companions.map(p => [p, hashFile(p)]));
    say('Reading a copy, never the old file itself:');
    for (const [path, hash] of before) say(`  ${basename(path)} sha256 ${hash}`);

    copyDir = mkdtempSync(join(tmpdir(), 'ws-carry-'));
    const copy = join(copyDir, 'old.db');
    copyFileSync(source, copy);
    if (companions.includes(`${source}-wal`)) copyFileSync(`${source}-wal`, `${copy}-wal`);
    for (const [path, hash] of before) {
      if (hashFile(path) !== hash) throw new Refusal(`${basename(path)} changed while it was being copied, so a server is still writing to it. Stop that server and run this again.`);
    }

    if (existsSync(partial)) {
      // Only ever what an earlier, stopped run of this tool left under this tool's own name.
      rmSync(partial, { recursive: true, force: true });
      say(`  removed what an earlier stopped run left at ${basename(partial)}`);
    }

    // Write.
    const oldSide = new Map<TableName, IHeld>(TABLES.map(t => [t.name, { rows: 0, prints: new Map(), digest: '' }]));
    const oldBalances = new Map<string, number>();
    let writing = await openDatabase(folderUrl(partial));
    let truncated = 0;
    try {
      ({ truncated } = await readOldSave(copy, async (shape, rows) => {
        const held = oldSide.get(shape.name)!;
        for (const row of rows) {
          held.prints.set(String(row.id), fingerprint(shape, row));
          held.rows++;
          if (shape.name === 'treasuries') oldBalances.set(String(row.id), Number(row.gold));
        }
        await writeRows(writing, shape, rows);
      }, say));
    } finally {
      await writing.close();
    }

    // Verify, from the disk: closed above, opened again here.
    say('Checked, closed and reopened from disk:');
    writing = await openDatabase(folderUrl(partial));
    try {
      for (const shape of TABLES) {
        const held = oldSide.get(shape.name)!;
        held.digest = digestOf(held.prints);
        const back = await readNewSide(writing, shape);
        if (back.rows !== held.rows) throw new Refusal(`${shape.name}: the old file holds ${held.rows} rows and the new folder ${back.rows}.`);
        const differs = firstDifference(held.prints, back.prints);
        if (differs) throw new Refusal(`${shape.name}: ${differs}.`);
        if (back.digest !== held.digest) throw new Refusal(`${shape.name}: the digests differ though no row does, and that should not be possible.`);
        say(`  ${shape.name.padEnd(12)} ${String(held.rows).padStart(7)} rows, each row's every column hashed and equal, digest ${held.digest}`);
      }

      const newBalances = await readBalances(writing);
      if (newBalances.size !== oldBalances.size) throw new Refusal(`The old file holds ${oldBalances.size} balances and the new folder ${newBalances.size}.`);
      let total = 0;
      for (const [id, gold] of oldBalances) {
        const back = newBalances.get(id);
        if (back !== gold) throw new Refusal(`Balance ${id}: the old file says ${gold} and the new folder ${back}.`);
        total += gold;
        say(`  balance ${id} = ${gold}`);
      }
      say(`  ${oldBalances.size} balances equal, adding up to ${total}`);

      const chains = await chainsAreWhole(writing);
      if (chains.broken.length > 0) say(`  NOTE ledger chains with a gap, as the old file already held them: ${chains.broken.join(', ')}`);
      say(`  ${chains.chains} ledger chains read, ${chains.chains - chains.broken.length} of them running unbroken from 1`);
      if (truncated > 0) say(`  NOTE ${truncated} whole-number columns held a fraction in the old file and were cut to the whole number. Their text was not touched.`);
    } finally {
      await writing.close();
    }

    // The old file, still what it was.
    for (const [path, hash] of before) {
      if (hashFile(path) !== hash) throw new Refusal(`${basename(path)} changed while the tool ran, so a server is writing to it. The folder was not given its real name. Stop that server and run this again.`);
    }
    say('Old file untouched: same sha256 before and after.');

    // Its real name, only now. A rename is whole or not at all.
    if (existsSync(target)) throw new Refusal(`Something appeared at ${target} while the tool ran. It was not touched.`);
    renameSync(partial, target);
    rmSync(`${partial}.lock`, { force: true });

    // Opened once more under its real name, so what is promised is what a server will find.
    try {
      const final = await openDatabase(folderUrl(target));
      try {
        for (const shape of TABLES) {
          const { rows } = await final.db.execute(sql.raw(`SELECT COUNT(*) n FROM ${shape.name}`));
          if (Number(rows[0].n) !== oldSide.get(shape.name)!.rows) throw new Refusal(`${shape.name} changed on being renamed, and that should not be possible.`);
        }
      } finally {
        await final.close();
      }
      say('Opened under its real name, and every count holds.');
    } catch (e) {
      // A server left running finds the folder the moment it has its name. Everything above was checked before that.
      if (!(e instanceof DatabaseUnavailable)) throw e;
      say('A running server opened it under its real name first, so it was not opened again here. It was checked before it took that name.');
    }

    say(`CARRIED: ${target}`);
    say('That line and the receipt beside the folder are what say this worked. The exit code alone does not: the old database driver can exit 139 after finishing.');
    writeDurably(receipt, `${lines.join('\n')}\n`);
    emit(`Receipt: ${receipt}`);
    return true;
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    say(`NOT CARRIED: ${reason}`);
    if (!(e instanceof Refusal)) say('That was not a refusal this tool chose. Nothing has its real name, so running it again is safe.');
    return false;
  } finally {
    if (copyDir) { try { rmSync(copyDir, { recursive: true, force: true }); } catch { /* the OS cleans temp */ } }
  }
}

function writeDurably(path: string, text: string) {
  writeFileSync(path, text);
  const fd = openSync(path, 'r+');
  try { fsyncSync(fd); } finally { closeSync(fd); }
}

const invoked = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (invoked) {
  const [oldFile, targetFolder] = process.argv.slice(2);
  // A synchronous write: a native crash at exit must not take what was printed with it.
  const out = (line: string) => { writeSync(1, `${line}\n`); };
  if (!oldFile || !targetFolder) {
    out('Carries an old SQLite save into a new Postgres folder. The old file is left as it is.');
    out('  npm run db:carry -- <old-file> <new-folder>');
    process.exit(2);
  }
  const ok = await carrySave(oldFile, targetFolder, out);
  process.exit(ok ? 0 : 1);
}
