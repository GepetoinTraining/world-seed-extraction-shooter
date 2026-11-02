/**
 * CARRYING A SAVE OVER: the old SQLite file in, and out to the record or to a live folder.
 * Pedro's choice, and run by hand, once, by a person. Nothing migrates by itself.
 *
 *   npm run db:carry -- <old-file> --to-record     up to Turso (D133); the game loads it from there
 *   npm run db:carry -- <old-file> <new-folder>    a live folder here, needing no account at all
 *
 * The second is what the vault's button runs, so an old file never holds anyone at the
 * door for want of a Turso database. What it writes is marked like any other play, so it
 * goes up at the next downtime if a record is set up later. Choose one: a folder and a
 * record each carried separately are two saves, and the keeper will not merge them.
 *
 * What it promises:
 *   - The old file is never opened. It is copied, the copy is read, and the file's
 *     bytes are hashed before and after to prove it.
 *   - It refuses to write over anything that already exists at the target.
 *   - A folder is built under another name and takes its real name only once it has
 *     been closed, reopened from disk and checked. A write-down to the record lands
 *     whole or not at all, and is read back. A half-carried save can never look like a save.
 *   - All four tables, commits included, and every text byte for byte, because
 *     signatures cover the exact content.
 *
 * It reads through node:sqlite, built into Node, so the old driver's file path is loaded
 * by nothing at all any more. Success is still the CARRIED line and the receipt: they say
 * what was checked, and an exit code does not.
 */
import { closeSync, copyFileSync, existsSync, fsyncSync, mkdtempSync, openSync, readFileSync, renameSync, rmSync, statSync, writeFileSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { sql } from 'drizzle-orm';
import { openColdDoor } from '../server/coldStore';
import { DatabaseUnavailable, folderUrl, IDatabase, openDatabase } from '../server/connection';
import { loadLocalEnv } from '../server/intelligence';
import { RECORD_TABLES, IRecordTable, RecordRow, RecordTableName, digestOf, fingerprint, normalRow, printKey, sha256 } from '../server/recordRows';
import * as schema from '../server/schema.pg';

/** What each table's rows go through to reach the driver, by the schema's own property names. */
const DRIZZLE_TABLES: Record<TableName, any> = {
  documents: schema.documents,
  ledger_rows: schema.ledgerRows,
  treasuries: schema.treasuries,
  commits: schema.commits
};
type TableName = RecordTableName;

const camel = (column: string) => column.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

const PAGE = 500;

class Refusal extends Error {}

const hashFile = (path: string) => sha256(readFileSync(path));

interface IHeld {
  rows: number;
  /** Row id to its fingerprint, for naming the first row that differs. */
  prints: Map<string, string>;
  digest: string;
}

/** Reads the copy. Each text column's stored size comes from SQLite itself: a driver can cut text at a NUL and say nothing. */
async function readOldSave(copyPath: string, take: (shape: IRecordTable, rows: RecordRow[]) => Promise<void>, say: (line: string) => void): Promise<{ truncated: number }> {
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(copyPath);
  let truncated = 0;
  try {
    let integrity = '';
    try {
      integrity = String((db.prepare('PRAGMA integrity_check').all()[0] as any)?.integrity_check ?? '');
    } catch (e) {
      throw new Refusal(`This file is not a database that can be read: ${(e as Error).message}`);
    }
    if (integrity !== 'ok') throw new Refusal(`The old file fails its own integrity check: ${integrity}`);
    say('  old file integrity_check: ok');

    for (const shape of RECORD_TABLES) {
      if (db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`).all(shape.name).length === 0) {
        throw new Refusal(`The old file has no ${shape.name} table, so it is not a World Seed save.`);
      }
      const sizes = shape.text.map(c => `length(CAST(${c} AS BLOB)) AS ${c}__bytes`).join(', ');
      const page = db.prepare(`SELECT ${shape.columns.join(', ')}, ${sizes} FROM ${shape.name} WHERE id > ? ORDER BY id LIMIT ${PAGE}`);
      let after = '';
      for (;;) {
        const found = page.all(after) as any[];
        if (found.length === 0) break;
        const rows: RecordRow[] = found.map(r => {
          for (const c of shape.text) {
            const value = r[c];
            if (value === null || value === undefined) continue;
            if (typeof value !== 'string') throw new Refusal(`${shape.name} row "${r.id}" holds something other than text in ${c}. Nothing was written under the target's name.`);
            const stored = Number(r[`${c}__bytes`]);
            if (Buffer.byteLength(value, 'utf8') !== stored) {
              throw new Refusal(`${shape.name} row "${r.id}" holds ${stored} bytes in ${c}, and the driver returned ${Buffer.byteLength(value, 'utf8')}. That is a NUL character or broken text, which Postgres cannot store and this tool will not cut. Nothing was written under the target's name.`);
            }
          }
          const row: RecordRow = {};
          for (const c of shape.columns) row[c] = r[c] ?? null;
          for (const c of shape.whole) {
            const value = Number(row[c]);
            if (!Number.isInteger(value)) truncated++;
            row[c] = Math.trunc(value);
          }
          if (shape.name === 'treasuries') row.gold = Number(row.gold);
          return row;
        });
        await take(shape, rows);
        after = String(found[found.length - 1].id);
      }
    }
  } finally {
    db.close();
  }
  return { truncated };
}

async function writeRows(db: IDatabase, shape: IRecordTable, rows: RecordRow[]) {
  const table = DRIZZLE_TABLES[shape.name];
  const values = rows.map(r => Object.fromEntries(shape.columns.map(c => [camel(c), r[c]])));
  await db.db.transaction(async (tx: any) => {
    for (const value of values) await tx.insert(table).values(value);
  });
}

/** The new side, read back through plain SQL: ids in byte order, the same order the old side gave. */
async function readNewSide(db: IDatabase, shape: IRecordTable): Promise<IHeld> {
  const prints = new Map<string, string>();
  let after = '';
  for (;;) {
    const result = await db.db.execute(sql`SELECT ${sql.raw(shape.columns.join(', '))} FROM ${sql.raw(shape.name)} WHERE id COLLATE "C" > ${after} ORDER BY id COLLATE "C" LIMIT ${sql.raw(String(PAGE))}`);
    const rows: RecordRow[] = result.rows;
    if (rows.length === 0) break;
    for (const r of rows) {
      const row = normalRow(shape, r);
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
function compareBalances(oldBalances: Map<string, number>, newBalances: Map<string, number>, say: (line: string) => void) {
  if (newBalances.size !== oldBalances.size) throw new Refusal(`The old file holds ${oldBalances.size} balances and the target ${newBalances.size}.`);
  let total = 0;
  for (const [id, gold] of oldBalances) {
    const back = newBalances.get(id);
    if (back !== gold) throw new Refusal(`Balance ${id}: the old file says ${gold} and the target ${back}.`);
    total += gold;
    say(`  balance ${id} = ${gold}`);
  }
  say(`  ${oldBalances.size} balances equal, adding up to ${total}`);
}

/** Every chain still runs 1, 2, 3 with no gap: the column check, not the signatures, which hold no keys here. */
function chainsAreWhole(ledger: RecordRow[]): { chains: number; broken: string[] } {
  const owners = new Map<string, { n: number; lo: number; hi: number; bad: boolean }>();
  for (const row of ledger) {
    const seq = Number(row.seq);
    const held = owners.get(String(row.owner_uid)) ?? { n: 0, lo: seq, hi: seq, bad: false };
    held.n++;
    held.lo = Math.min(held.lo, seq);
    held.hi = Math.max(held.hi, seq);
    if (Number(row.prev_seq) !== seq - 1) held.bad = true;
    owners.set(String(row.owner_uid), held);
  }
  const broken = [...owners].filter(([, c]) => !(c.lo === 1 && c.hi === c.n && !c.bad)).map(([uid]) => uid);
  return { chains: owners.size, broken };
}

/** The old file, hashed, and a copy to read: without its log, the newest play would be missing. */
function takeCopy(source: string, say: (line: string) => void): { copy: string; copyDir: string; assertUntouched: (when: string) => void } {
  const companions = [source, `${source}-wal`].filter(p => existsSync(p));
  const before = new Map(companions.map(p => [p, hashFile(p)]));
  say('Reading a copy, never the old file itself:');
  for (const [path, hash] of before) say(`  ${basename(path)} sha256 ${hash}`);

  const copyDir = mkdtempSync(join(tmpdir(), 'ws-carry-'));
  const copy = join(copyDir, 'old.db');
  copyFileSync(source, copy);
  if (companions.includes(`${source}-wal`)) copyFileSync(`${source}-wal`, `${copy}-wal`);

  const assertUntouched = (when: string) => {
    for (const [path, hash] of before) {
      if (hashFile(path) !== hash) throw new Refusal(`${basename(path)} changed ${when}, so a server is still writing to it. Stop that server and run this again.`);
    }
  };
  assertUntouched('while it was being copied');
  return { copy, copyDir, assertUntouched };
}

function writeDurably(path: string, text: string) {
  writeFileSync(path, text);
  const fd = openSync(path, 'r+');
  try { fsyncSync(fd); } finally { closeSync(fd); }
}

const EVIDENCE = 'That line and the receipt are what say this worked, because they say what was checked.';

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

    const taken = takeCopy(source, say);
    copyDir = taken.copyDir;

    // Only ever what an earlier, stopped run of this tool left under this tool's own name.
    if (existsSync(partial)) {
      rmSync(partial, { recursive: true, force: true });
      say(`  removed what an earlier stopped run left at ${basename(partial)}`);
    }

    // Write. The source is read before anything is made, so a file that is no save leaves nothing behind.
    const oldSide = new Map<TableName, IHeld>(RECORD_TABLES.map(t => [t.name, { rows: 0, prints: new Map(), digest: '' }]));
    const oldBalances = new Map<string, number>();
    const ledger: RecordRow[] = [];
    let writing: IDatabase | null = null;
    let truncated = 0;
    try {
      ({ truncated } = await readOldSave(taken.copy, async (shape, rows) => {
        writing ??= await openDatabase(folderUrl(partial));
        const held = oldSide.get(shape.name)!;
        for (const row of rows) {
          held.prints.set(String(row.id), fingerprint(shape, row));
          held.rows++;
          if (shape.name === 'treasuries') oldBalances.set(String(row.id), Number(row.gold));
          if (shape.name === 'ledger_rows') ledger.push(row);
        }
        await writeRows(writing, shape, rows);
      }, say));
    } finally {
      await (writing as IDatabase | null)?.close();
    }

    // Verify, from the disk: closed above, opened again here.
    say('Checked, closed and reopened from disk:');
    const reopened = await openDatabase(folderUrl(partial));
    try {
      for (const shape of RECORD_TABLES) {
        const held = oldSide.get(shape.name)!;
        held.digest = digestOf(held.prints);
        const back = await readNewSide(reopened, shape);
        if (back.rows !== held.rows) throw new Refusal(`${shape.name}: the old file holds ${held.rows} rows and the new folder ${back.rows}.`);
        const differs = firstDifference(held.prints, back.prints);
        if (differs) throw new Refusal(`${shape.name}: ${differs}.`);
        if (back.digest !== held.digest) throw new Refusal(`${shape.name}: the digests differ though no row does, and that should not be possible.`);
        say(`  ${shape.name.padEnd(12)} ${String(held.rows).padStart(7)} rows, each row's every column hashed and equal, digest ${held.digest}`);
      }

      const { rows } = await reopened.db.execute(sql.raw(`SELECT id, gold FROM treasuries ORDER BY id COLLATE "C"`));
      compareBalances(oldBalances, new Map(rows.map((r: RecordRow) => [String(r.id), Number(r.gold)])), say);

      const chains = chainsAreWhole(ledger);
      if (chains.broken.length > 0) say(`  NOTE ledger chains with a gap, as the old file already held them: ${chains.broken.join(', ')}`);
      say(`  ${chains.chains} ledger chains read, ${chains.chains - chains.broken.length} of them running unbroken from 1`);
      if (truncated > 0) say(`  NOTE ${truncated} whole-number columns held a fraction in the old file and were cut to the whole number. Their text was not touched.`);
    } finally {
      await reopened.close();
    }

    taken.assertUntouched('while the tool ran. The folder was not given its real name');
    say('Old file untouched: same sha256 before and after.');

    // Its real name, only now. A rename is whole or not at all.
    if (existsSync(target)) throw new Refusal(`Something appeared at ${target} while the tool ran. It was not touched.`);
    renameSync(partial, target);
    rmSync(`${partial}.lock`, { force: true });

    // Opened once more under its real name, so what is promised is what a server will find.
    try {
      const final = await openDatabase(folderUrl(target));
      try {
        for (const shape of RECORD_TABLES) {
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
    say(EVIDENCE);
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

/** Straight to the record: the same reading and the same checks, and the write-down's own promise of whole or not at all. */
export async function carryToRecord(oldFile: string, env: NodeJS.ProcessEnv, emit: (line: string) => void): Promise<boolean> {
  const source = resolve(oldFile);
  const receipt = `${source}.carried-to-record.txt`;
  const lines: string[] = [];
  const say = (line: string) => { lines.push(line); emit(line); };
  let copyDir: string | null = null;
  const url = env.TURSO_DATABASE_URL?.trim();

  try {
    if (!existsSync(source) || !statSync(source).isFile()) throw new Refusal(`There is no file at ${source}.`);
    if (!url) throw new Refusal('No record is set up: there is no TURSO_DATABASE_URL. The game does not need one. To play this save on this machine, carry it to a folder instead: npm run db:carry -- <old-file> <new-folder>');

    say(`Carrying ${source}`);
    say('      up to the record');

    const taken = takeCopy(source, say);
    copyDir = taken.copyDir;

    const rows: Partial<Record<TableName, RecordRow[]>> = {};
    const { truncated } = await readOldSave(taken.copy, async (shape, some) => {
      (rows[shape.name] ??= []).push(...some);
    }, say);

    const door = await openColdDoor({ url, authToken: env.TURSO_AUTH_TOKEN?.trim() || undefined });
    try {
      if (await door.head()) throw new Refusal('The record already holds a save, and this tool never writes over anything.');

      const prints = new Map<string, string>();
      for (const shape of RECORD_TABLES) {
        for (const row of rows[shape.name] ?? []) prints.set(printKey(shape.name, String(row.id)), fingerprint(shape, row));
      }
      const digest = digestOf(prints);
      const id = `wd_${sha256(`carried|${digest}`).slice(0, 32)}`;

      const result = await door.writeDown({ id, prev: null, why: 'carried', at: Date.now(), digest, rows });
      if (result.status === 'MOVED') throw new Refusal('The record took a save while this ran, and this tool never writes over anything.');
      if (result.status === 'FORK') throw new Refusal(`The record holds a different ledger row at ${result.id}.`);

      say('Read back from the record:');
      const oldBalances = new Map<string, number>();
      const newBalances = new Map<string, number>();
      for (const shape of RECORD_TABLES) {
        const sent = rows[shape.name] ?? [];
        const back = await door.read(shape.name, sent.map(r => String(r.id)));
        const oldPrints = new Map<string, string>(sent.map(r => [String(r.id), fingerprint(shape, r)]));
        const newPrints = new Map<string, string>(back.map(r => [String(r.id), fingerprint(shape, r)]));
        const differs = firstDifference(oldPrints, newPrints);
        if (differs) throw new Refusal(`${shape.name}: ${differs}.`);
        say(`  ${shape.name.padEnd(12)} ${String(sent.length).padStart(7)} rows, each row's every column hashed and equal, digest ${digestOf(oldPrints)}`);
        if (shape.name === 'treasuries') {
          for (const r of sent) oldBalances.set(String(r.id), Number(r.gold));
          for (const r of back) newBalances.set(String(r.id), Number(r.gold));
        }
      }
      compareBalances(oldBalances, newBalances, say);

      const chains = chainsAreWhole(rows.ledger_rows ?? []);
      if (chains.broken.length > 0) say(`  NOTE ledger chains with a gap, as the old file already held them: ${chains.broken.join(', ')}`);
      say(`  ${chains.chains} ledger chains read, ${chains.chains - chains.broken.length} of them running unbroken from 1`);
      if (truncated > 0) say(`  NOTE ${truncated} whole-number columns held a fraction in the old file and were cut to the whole number. Their text was not touched.`);

      taken.assertUntouched('while the tool ran. The record has what was read before that');
      say('Old file untouched: same sha256 before and after.');
      say(`CARRIED: the record, write-down ${id}. A new database for this game comes up from it.`);
      say(EVIDENCE);
      writeDurably(receipt, `${lines.join('\n')}\n`);
      emit(`Receipt: ${receipt}`);
      return true;
    } finally {
      door.close();
    }
  } catch (e) {
    say(`NOT CARRIED: ${e instanceof Error ? e.message : String(e)}`);
    if (!(e instanceof Refusal)) say('That was not a refusal this tool chose. A write-down lands whole or not at all, so running it again is safe.');
    return false;
  } finally {
    if (copyDir) { try { rmSync(copyDir, { recursive: true, force: true }); } catch { /* the OS cleans temp */ } }
  }
}

const invoked = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (invoked) {
  const [oldFile, target] = process.argv.slice(2);
  const out = (line: string) => { writeSync(1, `${line}\n`); };
  if (!oldFile || !target) {
    out('Carries an old SQLite save over. The old file is left as it is.');
    out('  npm run db:carry -- <old-file> --to-record');
    out('  npm run db:carry -- <old-file> <new-folder>');
    process.exit(2);
  }
  loadLocalEnv();
  const ok = target === '--to-record' ? await carryToRecord(oldFile, process.env, out) : await carrySave(oldFile, target, out);
  process.exit(ok ? 0 : 1);
}
