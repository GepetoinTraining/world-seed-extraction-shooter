// @vitest-environment node
/**
 * CARRYING A SAVE OVER. Pedro: a tool that reads the old file and writes the new
 * one, and leaves the old file untouched.
 *
 * The tool and the fixture that makes old saves run as real processes, because the
 * old driver can exit 139 after finishing (N16). So these bars read what the tool
 * printed and wrote, as a person must, and never its exit code. libSQL stays out of
 * this test process, so it cannot take a test run down either.
 */
import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { DatabaseUnavailable, folderUrl, openDatabase } from '../server/connection';
import { openStore } from '../server/SqlStore';

const ROOT = process.cwd();
const dirs: string[] = [];
const scratch = () => { const d = mkdtempSync(join(tmpdir(), 'ws-carry-test-')); dirs.push(d); return d; };
afterAll(() => { for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }); } catch { /* left for the OS */ } } });

const TSX = ['--import', 'tsx'];

function makeOldSave(file: string, kind = 'plain') {
  const made = spawnSync(process.execPath, [...TSX, 'tests/fixtures/old-save.ts', file, kind], { cwd: ROOT, encoding: 'utf8' });
  if (!made.stdout.includes('MADE')) throw new Error(`The old save was not made: ${made.stdout} ${made.stderr}`);
  if (!existsSync(file)) throw new Error('The old save is not on disk.');
}

const carry = (from: string, to: string) => spawnSync(process.execPath, [...TSX, 'scripts/carry-save.ts', from, to], { cwd: ROOT, encoding: 'utf8' }).stdout;

const sha = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');

describe('the tool, on an old save with its log beside it', () => {
  let oldFile: string; let target: string; let printed: string;
  const before: Record<string, string> = {};

  beforeAll(() => {
    const dir = scratch();
    oldFile = join(dir, 'save.db');
    target = join(dir, 'save');
    makeOldSave(oldFile);
    expect(existsSync(`${oldFile}-wal`)).toBe(true);
    for (const name of readdirSync(dir)) before[name] = sha(join(dir, name));
    printed = carry(oldFile, target);
  }, 120_000);

  it('says CARRIED, and that this line and the receipt are the evidence, not the exit code', () => {
    expect(printed).toContain(`CARRIED: ${target}`);
    expect(printed).not.toContain('NOT CARRIED');
    expect(printed).toMatch(/exit code alone does not/);
    expect(readFileSync(`${target}.carried.txt`, 'utf8')).toContain(`CARRIED: ${target}`);
  });

  it('prints what it checked: counts per table, a hash of every row, the balances', () => {
    expect(printed).toMatch(/documents\s+1205 rows/);
    expect(printed).toMatch(/ledger_rows\s+700 rows/);
    expect(printed).toMatch(/treasuries\s+4 rows/);
    expect(printed).toMatch(/commits\s+900 rows/);
    expect(printed).toMatch(/digest [0-9a-f]{64}/);
    expect(printed).toMatch(/balance treasury_world_a = 0\.30000000000000004/);
    expect(printed).toMatch(/1 ledger chains read, 1 of them running unbroken/);
  });

  it('leaves the old file and its log exactly as they were, byte for byte', () => {
    expect(printed).toMatch(/Old file untouched/);
    for (const [name, hash] of Object.entries(before)) expect(sha(join(oldFile, '..', name)), name).toBe(hash);
  });

  it('carries text byte for byte, numbers exact, and the newest row that only the log held', async () => {
    const store = await openStore(folderUrl(target));
    try {
      const { NASTY } = await nastyText();
      expect((await store.get('ws_abc_character'))!.dataText).toBe(NASTY);
      expect((await store.get('ws_abc_character'))!.metadata).toEqual({ createdAt: 1730000000000, updatedAt: 1730000000999, ownerCertUid: 'ws_abc', signature: 'sig-char', version: 3 });
      expect((await store.get('res_tree_log'))!.dataText).toBe('{ "type":"res",  "spacing":"kept" }');
      expect((await store.get('res_tree_log'))!.embedding).toEqual([0.1, 0.2]);
      expect((await store.get("quote'd_id_é"))!.dataText).toBe('{}');
      expect(JSON.parse((await store.get('hub_state_a'))!.dataText).body.length).toBe(1_050_000);
      expect((await store.get('only_in_the_log'))!.dataText).toBe('{"newest":true}');
      expect(JSON.parse((await store.get('treasury_world_a'))!.dataText).gold).toBe(0.1 + 0.2);
      expect(JSON.parse((await store.get('wallet_world_a__npc_banker'))!.dataText).gold).toBe(1 / 3);
      expect(JSON.parse((await store.get('ledger_head_ws_abc'))!.dataText)).toEqual({ seq: 700 });
    } finally {
      await store.close();
    }
  }, 60_000);

  it('carries the commits too: a request retried from before the move still applies once', async () => {
    const store = await openStore(folderUrl(target));
    try {
      expect((await store.commit({ commitId: 'commit_5', ops: [{ kind: 'add', namespace: 'territories', id: 'treasury_world_b', amount: 1, at: 1 }] })).applied).toBe(false);
      expect(JSON.parse((await store.get('treasury_world_b'))!.dataText).gold).toBe(111581);
    } finally {
      await store.close();
    }
  }, 60_000);

  it('what it made plays on: the next ledger row takes the next seq', async () => {
    const store = await openStore(folderUrl(target));
    try {
      const signed = { payload: { seq: 701, prevSeq: 700, ts: 1, type: 'GOLD_DELTA', data: {} }, signature: 's', certUid: 'ws_abc', timestamp: 1 };
      const result = await store.commit({ commitId: 'after_the_move', ops: [{ kind: 'put', doc: { id: 'ledger_ws_abc_00000701', namespace: 'transactions', dataText: JSON.stringify(signed), metadata: { createdAt: 1, updatedAt: 1, ownerCertUid: 'ws_abc', signature: 's', version: 1 } } }] });
      expect(result.applied).toBe(true);
    } finally {
      await store.close();
    }
  }, 60_000);

  it('run a second time, it refuses and touches nothing', () => {
    const second = carry(oldFile, target);
    expect(second).toContain('NOT CARRIED');
    expect(second).toMatch(/already exists/);
    expect(existsSync(`${target}.partial`)).toBe(false);
  }, 60_000);
});

// The fixture's own text, without loading it (it would open a database when imported).
async function nastyText() {
  const source = readFileSync(join(ROOT, 'tests/fixtures/old-save.ts'), 'utf8');
  const literal = /export const NASTY = JSON\.stringify\(([\s\S]*?)\);\n/.exec(source)![1];
  // eslint-disable-next-line no-new-func
  return { NASTY: JSON.stringify(new Function(`return (${literal});`)()) };
}

describe('what the tool refuses', () => {
  it('an empty folder at the target counts as something: it never writes over anything', () => {
    const dir = scratch();
    const oldFile = join(dir, 'save.db');
    const target = join(dir, 'save');
    makeOldSave(oldFile);
    mkdirSync(target);
    writeFileSync(join(target, 'mine.txt'), 'kept');
    const printed = carry(oldFile, target);
    expect(printed).toContain('NOT CARRIED');
    expect(readdirSync(target)).toEqual(['mine.txt']);
    expect(readFileSync(join(target, 'mine.txt'), 'utf8')).toBe('kept');
  }, 120_000);

  it('a missing file, and a file that is not a save, without leaving a folder behind', () => {
    const dir = scratch();
    expect(carry(join(dir, 'nothing.db'), join(dir, 'a'))).toContain('NOT CARRIED');
    expect(existsSync(join(dir, 'a'))).toBe(false);
    const stranger = join(dir, 'stranger.db');
    writeFileSync(stranger, 'not a database at all, and long enough to look like nothing');
    expect(carry(stranger, join(dir, 'b'))).toContain('NOT CARRIED');
    expect(existsSync(join(dir, 'b'))).toBe(false);
  }, 120_000);

  it('text Postgres cannot store is named, and nothing takes the target\'s name', () => {
    const dir = scratch();
    const oldFile = join(dir, 'save.db');
    const target = join(dir, 'save');
    makeOldSave(oldFile, 'nul');
    const printed = carry(oldFile, target);
    expect(printed).toContain('NOT CARRIED');
    expect(printed).toMatch(/has_nul/);
    expect(existsSync(target)).toBe(false);
  }, 120_000);

  it('a fraction in a whole-number column is cut and said out loud, and the text beside it is exact', async () => {
    const dir = scratch();
    const oldFile = join(dir, 'save.db');
    const target = join(dir, 'save');
    makeOldSave(oldFile, 'fraction');
    const printed = carry(oldFile, target);
    expect(printed).toContain(`CARRIED: ${target}`);
    expect(printed).toMatch(/NOTE 2 whole-number columns held a fraction/);
    const store = await openStore(folderUrl(target));
    const doc = await store.get('has_fraction');
    await store.close();
    expect(doc!.dataText).toBe('{"kept":"exactly"}');
    expect(doc!.metadata.createdAt).toBe(1730000000123);
  }, 120_000);

  it('a run that stopped halfway left a .partial, which is no save: the next run replaces it', () => {
    const dir = scratch();
    const oldFile = join(dir, 'save.db');
    const target = join(dir, 'save');
    makeOldSave(oldFile);
    mkdirSync(`${target}.partial`);
    writeFileSync(join(`${target}.partial`, 'half'), 'half');
    const printed = carry(oldFile, target);
    expect(printed).toContain(`CARRIED: ${target}`);
    expect(existsSync(`${target}.partial`)).toBe(false);
    expect(existsSync(join(target, 'half'))).toBe(false);
  }, 120_000);
});

describe('nothing migrates by itself', () => {
  it('an old file with no folder: the game says what to run, and creates nothing', async () => {
    const dir = scratch();
    const folder = join(dir, 'test-player');
    writeFileSync(`${folder}.db`, 'an old save');
    const opened = openDatabase(folderUrl(folder));
    await expect(opened).rejects.toBeInstanceOf(DatabaseUnavailable);
    await expect(opened).rejects.toThrow(/npm run db:carry/);
    expect(existsSync(folder)).toBe(false);
    expect(existsSync(`${folder}.lock`)).toBe(false);
  });

  it('an old file beside a folder that holds a database: the folder is the save', async () => {
    const dir = scratch();
    const folder = join(dir, 'test-player');
    await (await openDatabase(folderUrl(folder))).close();
    writeFileSync(`${folder}.db`, 'an old save');
    await (await openDatabase(folderUrl(folder))).close();
    expect(readFileSync(`${folder}.db`, 'utf8')).toBe('an old save');
  }, 60_000);

  it('a file: URL is told the tool, rather than opened', async () => {
    await expect(openDatabase('file:data/anything.db')).rejects.toThrow(/npm run db:carry/);
  });

  it('a carried folder answers the plain SQL the tool promised', async () => {
    const dir = scratch();
    const oldFile = join(dir, 'save.db');
    const target = join(dir, 'save');
    makeOldSave(oldFile);
    expect(carry(oldFile, target)).toContain(`CARRIED: ${target}`);
    const d = await openDatabase(folderUrl(target));
    const count = async (t: string) => Number((await d.db.execute(sql`SELECT COUNT(*) n FROM ${sql.raw(t)}`)).rows[0].n);
    expect([await count('documents'), await count('ledger_rows'), await count('treasuries'), await count('commits')]).toEqual([1205, 700, 4, 900]);
    await d.close();
  }, 120_000);
});
