/**
 * THE KEEPER (D133): what stands between the live store and the record.
 *
 * Pedro: "So postgress needs to run the client and love version, the downtimes are all
 * done on sql". A commit lands on Postgres, with a mark beside it in the same transaction,
 * and never waits on the network. When a downtime comes (a world's gate going down,
 * maintenance, a clean stop), everything marked goes up as one write-down.
 *
 * ONCE, AND NOTHING LOST. The marks leave Postgres only after the record has answered and
 * its rows have been read back and hashed. A stop at any moment leaves them there, and
 * what the next try sends covers them all. A send whose answer never came is remembered
 * before it goes, so the next try can ask whether it landed instead of guessing.
 *
 * THE GAME GOES ON (D35's spirit). No record set up, or none answering: play continues on
 * Postgres, the write-down waits and is retried whole, a person is told once in plain
 * words, and nothing here ever says a thing is saved that has not been read back.
 *
 * ASKED FOR, NOT ASSUMED. `WS_RECORD=1` turns this on, and `npm run pedro` is what sets it.
 * A root `.env` holds the URL for that one game: test-claude and every test server must
 * never write into a person's record because they found it there.
 */
import { sql } from 'drizzle-orm';
import { ColdDoorRefused, IColdDoor, IDowntimeJob, IWriteDownHead, openColdDoor } from './coldStore';
import { IDatabase, openDatabase } from './connection';
import { RECORD_TABLES, RecordRow, RecordTableName, digestOf, fingerprint, normalRow, printKey, sha256, tableOf } from './recordRows';
import { openStore, SqlStore, IStoreKeeper, IStoreOptions } from './SqlStore';
import { IRecordStatus, IWriteDownReceipt } from '../src/entities/data/wire';

const RETRY_FIRST_MS = 30_000;
const RETRY_MOST_MS = 10 * 60_000;
/** A clean stop tries once and does not hold a person at the door: the marks are still there. */
const STOP_WAIT_MS = 15_000;

export interface IRecordConfig {
  on: boolean;
  url?: string;
  authToken?: string;
}

export function recordConfig(env: NodeJS.ProcessEnv = process.env): IRecordConfig {
  if (env.WS_RECORD !== '1') return { on: false };
  return { on: true, url: env.TURSO_DATABASE_URL?.trim() || undefined, authToken: env.TURSO_AUTH_TOKEN?.trim() || undefined };
}

export interface IKeeperOptions {
  retryFirstMs?: number;
  /** A test seam: Line 71's kind. Called at each moment a stop could fall. */
  fault?: (stage: string) => void | Promise<void>;
  say?: (line: string) => void;
}

const SAYS = {
  none: 'No record is set up, so this game is kept on this machine only. It plays on. Nothing has been written anywhere else.',
  waiting: (reason: string) => `The record is not answering, so what you do is kept on this machine for now, and goes up when it can. It plays on. (${reason})`,
  moved: 'The record holds a save this database did not come from, so nothing was written to it and nothing was taken from it. It plays on here. Someone has to choose which one is the save.',
  fork: (id: string) => `The record holds a different ledger row at ${id}, and a chain only appends, so nothing was written to it. It plays on here. Someone has to look at this.`,
  mismatch: (id: string) => `What was read back from the record differs at ${id}, so this write-down is not counted as saved. It plays on here, and it will be tried again.`,
  wrongUrl: (reason: string) => `The record's address is wrong, and it will stay so until someone changes it. It plays on, on this machine only. ${reason}`,
  audit: (report: unknown) => `The downtime's audit on the record did not add up: ${JSON.stringify(report)}. Nothing was changed by it.`
};

export class RecordKeeper implements IStoreKeeper {
  private doorOpening: Promise<IColdDoor> | null = null;
  private running: Promise<IWriteDownReceipt> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private retryIn: number;
  private stopped = false;
  private state: IRecordStatus['state'];
  private says: string | undefined;
  private told = new Set<string>();

  constructor(
    private readonly database: IDatabase,
    private readonly config: IRecordConfig,
    private readonly options: IKeeperOptions = {}
  ) {
    this.retryIn = options.retryFirstMs ?? RETRY_FIRST_MS;
    this.state = config.url ? 'READY' : 'NONE';
    if (!config.url) this.tell(SAYS.none);
  }

  /** Said once in the log. The game reads it from the health door and says it once too. */
  private tell(line: string) {
    this.says = line;
    if (this.told.has(line)) return;
    this.told.add(line);
    (this.options.say ?? console.warn)(`[RECORD] ${line}`);
  }

  private get db() { return this.database.db; }
  private fault(stage: string) { return this.options.fault?.(stage); }

  private door(): Promise<IColdDoor> {
    this.doorOpening ??= openColdDoor({ url: this.config.url!, authToken: this.config.authToken })
      .catch(e => { this.doorOpening = null; throw e; });
    return this.doorOpening;
  }

  private async getState(key: string): Promise<string | null> {
    const { rows } = await this.db.execute(sql`SELECT value FROM cold_state WHERE key = ${key}`);
    return rows[0] ? String(rows[0].value) : null;
  }

  private async setState(tx: any, key: string, value: string | null) {
    if (value === null) await tx.execute(sql`DELETE FROM cold_state WHERE key = ${key}`);
    else await tx.execute(sql`INSERT INTO cold_state (key, value) VALUES (${key}, ${value}) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`);
  }

  private async markCount(): Promise<number> {
    const { rows } = await this.db.execute(sql`SELECT COUNT(*) n FROM cold_changes`);
    return Number(rows[0].n);
  }

  async status(): Promise<IRecordStatus> {
    const behind = await this.markCount();
    return { state: this.state, behind, last: (await this.getState('last')) ?? undefined, ...(this.says ? { says: this.says } : {}) };
  }

  // ---------------------------------------------------------------------------
  // GOING LIVE
  // ---------------------------------------------------------------------------

  /** A new database comes up holding what the record holds. Anything of its own is never replaced. */
  async goLive(head?: IWriteDownHead | null): Promise<{ loaded: number }> {
    if (!this.config.url) return { loaded: 0 };
    try {
      const door = await this.door();
      const top = head === undefined ? await door.head() : head;
      if (!top) return { loaded: 0 };
      const last = await this.getState('last');
      if (top.id === last) return { loaded: 0 };
      if ((await this.markCount()) > 0) {
        // Its own play has not gone up, and the record has moved on without it.
        this.state = 'MOVED';
        this.tell(SAYS.moved);
        return { loaded: 0 };
      }
      return { loaded: await this.loadUp(door, top) };
    } catch (e) {
      if (e instanceof ColdDoorRefused) return this.wrongUrl(e), { loaded: 0 };
      this.waiting(e);
      return { loaded: 0 };
    }
  }

  /**
   * One Postgres transaction, whole or not at all, so a stop here leaves a database that
   * is still empty and comes up again the same way. Nobody can be waiting on it: the store
   * is not handed to anyone until this is done.
   */
  private async loadUp(door: IColdDoor, head: IWriteDownHead): Promise<number> {
    let loaded = 0;
    await this.db.transaction(async (tx: any) => {
      await tx.execute(sql`SET LOCAL worldseed.loading_up = 'on'`);
      const sent = new Map<string, string>();
      for (const shape of RECORD_TABLES) {
        const table = this.drizzleTable(shape.name);
        for (let after = '', rows = await door.rows(shape.name, after); rows.length > 0; rows = await door.rows(shape.name, after)) {
          for (const row of rows) {
            sent.set(printKey(shape.name, String(row.id)), fingerprint(shape, row));
            const value = toDrizzle(shape.name, row);
            const { id, ...fields } = value;
            await tx.insert(table).values(value).onConflictDoUpdate({ target: table.id, set: fields });
            loaded++;
          }
          after = String(rows[rows.length - 1].id);
        }
      }
      // Read back inside the transaction: if the two sides differ, none of it happened.
      const held = new Map<string, string>();
      for (const shape of RECORD_TABLES) {
        const { rows } = await tx.execute(sql`SELECT ${sql.raw(shape.columns.join(', '))} FROM ${sql.raw(shape.name)}`);
        for (const raw of rows) {
          const row = normalRow(shape, raw as RecordRow);
          held.set(printKey(shape.name, String(row.id)), fingerprint(shape, row));
        }
      }
      for (const [key, print] of sent) {
        if (held.get(key) !== print) throw new Error(`What came up from the record differs at ${key.replace('\0', ' ')}.`);
      }
      await this.fault('loaded');
      await this.setState(tx, 'last', head.id);
    });
    (this.options.say ?? console.log)(`[RECORD] Loaded ${loaded} rows from the record, as of ${head.why}.`);
    return loaded;
  }

  private drizzleTable(name: RecordTableName) {
    const { schema } = this.database;
    return { documents: schema.documents, ledger_rows: schema.ledgerRows, treasuries: schema.treasuries, commits: schema.commits }[name] as any;
  }

  // ---------------------------------------------------------------------------
  // WRITING DOWN
  // ---------------------------------------------------------------------------

  /** One at a time. A call while one is running shares it: what it did not cover stays marked for the next. */
  writeDown(why: string): Promise<IWriteDownReceipt> {
    if (!this.config.url) return Promise.resolve({ status: 'NO_RECORD' });
    this.running ??= this.attempt(why).finally(() => { this.running = null; });
    return this.running;
  }

  private async attempt(why: string): Promise<IWriteDownReceipt> {
    try {
      const receipt = await this.send(why);
      if (receipt.status === 'WRITTEN' || receipt.status === 'NOTHING') {
        this.state = 'READY';
        this.says = undefined;
        this.retryIn = this.options.retryFirstMs ?? RETRY_FIRST_MS;
        if (this.retryTimer) { clearTimeout(this.retryTimer); this.retryTimer = null; }
      }
      return receipt;
    } catch (e) {
      if (e instanceof ColdDoorRefused) return this.wrongUrl(e);
      return this.waiting(e);
    }
  }

  private wrongUrl(e: ColdDoorRefused): IWriteDownReceipt {
    this.state = 'WRONG_URL';
    this.tell(SAYS.wrongUrl(e.message));
    return { status: 'WRONG_URL', says: this.says };
  }

  private waiting(e: unknown): IWriteDownReceipt {
    this.state = 'WAITING';
    this.tell(SAYS.waiting(e instanceof Error ? e.message : String(e)));
    this.scheduleRetry();
    return { status: 'WAITING', says: this.says };
  }

  private scheduleRetry() {
    if (this.stopped || this.retryTimer) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.writeDown('retry');
    }, this.retryIn);
    this.retryTimer.unref?.();
    this.retryIn = Math.min(this.retryIn * 2, RETRY_MOST_MS);
  }

  /** Under one snapshot, so what goes up stands at a commit's edge. No network in here: a commit is free to land. */
  private async readMarked(): Promise<{ upTo: number; rows: Partial<Record<RecordTableName, RecordRow[]>>; total: number }> {
    return this.db.transaction(async (tx: any) => {
      const top = await tx.execute(sql`SELECT MAX(seq) top FROM cold_changes`);
      const upTo = top.rows[0].top === null ? 0 : Number(top.rows[0].top);
      const rows: Partial<Record<RecordTableName, RecordRow[]>> = {};
      let total = 0;
      for (const shape of RECORD_TABLES) {
        const columns = sql.raw(shape.columns.map(c => `t.${c}`).join(', '));
        const table = sql.raw(shape.name);
        const found = await tx.execute(sql`SELECT ${columns} FROM cold_changes m JOIN ${table} t ON t.id = m.id COLLATE "C" WHERE m.tbl = ${shape.name} AND m.seq <= ${upTo}`);
        rows[shape.name] = found.rows.map((raw: RecordRow) => normalRow(shape, raw));
        total += found.rows.length;
      }
      return { upTo, rows, total };
    }, { isolationLevel: 'repeatable read' });
  }

  /** The record has them: the marks go, unless the row changed since, which gave its mark a newer number. */
  private async settle(id: string, upTo: number) {
    await this.db.transaction(async (tx: any) => {
      await tx.execute(sql`DELETE FROM cold_changes WHERE seq <= ${upTo}`);
      await this.setState(tx, 'last', id);
      await this.setState(tx, 'pending', null);
    });
  }

  private async send(why: string): Promise<IWriteDownReceipt> {
    const door = await this.door();

    // A send that was never answered: did it land? Only the record can say.
    const pendingText = await this.getState('pending');
    if (pendingText) {
      const pending = JSON.parse(pendingText) as { id: string; upTo: number };
      if (await door.has(pending.id)) await this.settle(pending.id, pending.upTo);
      else await this.db.transaction((tx: any) => this.setState(tx, 'pending', null));
    }

    const head = await door.head();
    const last = await this.getState('last');
    if ((head?.id ?? null) !== last) {
      this.state = 'MOVED';
      this.tell(SAYS.moved);
      return { status: 'MOVED', says: this.says };
    }

    const { upTo, rows, total } = await this.readMarked();
    if (total === 0) {
      // Marks with no row behind them have nothing to say, so they go too.
      if (upTo > 0) await this.db.execute(sql`DELETE FROM cold_changes WHERE seq <= ${upTo}`);
      return { status: 'NOTHING' };
    }

    const sentPrints = new Map<string, string>();
    for (const shape of RECORD_TABLES) {
      for (const row of rows[shape.name] ?? []) sentPrints.set(printKey(shape.name, String(row.id)), fingerprint(shape, row));
    }
    const digest = digestOf(sentPrints);
    const id = `wd_${sha256(`${last ?? ''}|${digest}`).slice(0, 32)}`;

    await this.db.transaction((tx: any) => this.setState(tx, 'pending', JSON.stringify({ id, upTo })));
    await this.fault('pending');

    const result = await door.writeDown({ id, prev: last, why, at: Date.now(), digest, rows }, stage => this.fault(stage));
    if (result.status === 'MOVED') {
      await this.db.transaction((tx: any) => this.setState(tx, 'pending', null));
      this.state = 'MOVED';
      this.tell(SAYS.moved);
      return { status: 'MOVED', says: this.says };
    }
    if (result.status === 'FORK') {
      await this.db.transaction((tx: any) => this.setState(tx, 'pending', null));
      this.state = 'FORK';
      this.tell(SAYS.fork(result.id));
      return { status: 'FORK', says: this.says };
    }

    // Read back and hashed before anything is called saved.
    for (const shape of RECORD_TABLES) {
      const sent = rows[shape.name] ?? [];
      const back = await door.read(shape.name, sent.map(r => String(r.id)));
      const backPrints = new Map(back.map(r => [String(r.id), fingerprint(shape, r)]));
      for (const row of sent) {
        if (backPrints.get(String(row.id)) !== fingerprint(tableOf(shape.name), row)) {
          this.state = 'WAITING';
          this.tell(SAYS.mismatch(`${shape.name} ${row.id}`));
          this.scheduleRetry();
          return { status: 'MISMATCH', says: this.says };
        }
      }
    }
    await this.fault('verified');

    await this.settle(id, upTo);
    return { status: 'WRITTEN', id, rows: total, digest };
  }

  // ---------------------------------------------------------------------------
  // DOWNTIME
  // ---------------------------------------------------------------------------

  /** Maintenance: the record first, then the work that belongs on it. */
  async downtime(): Promise<IWriteDownReceipt> {
    const receipt = await this.writeDown('maintenance');
    if (receipt.status !== 'WRITTEN' && receipt.status !== 'NOTHING') return receipt;
    try {
      const door = await this.door();
      const audit = await door.runDowntimeJob(RECORD_AUDIT);
      if (!audit.ok) this.tell(SAYS.audit(audit.report));
      return { ...receipt, audit };
    } catch (e) {
      this.waiting(e);
      return { ...receipt, says: this.says };
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.retryTimer) { clearTimeout(this.retryTimer); this.retryTimer = null; }
    if (!this.config.url) return;
    const done = this.writeDown('stop').then(() => true);
    const inTime = await Promise.race([done, new Promise<boolean>(r => setTimeout(() => r(false), STOP_WAIT_MS))]);
    if (!inTime) (this.options.say ?? console.warn)('[RECORD] The record did not answer in time. Nothing is lost: what it has not seen stays marked here, and goes up next time.');
    if (this.doorOpening) (await this.doorOpening.catch(() => null))?.close();
  }
}

function toDrizzle(name: RecordTableName, row: RecordRow): any {
  const value: any = {};
  for (const c of tableOf(name).columns) value[c.replace(/_([a-z])/g, (_, l: string) => l.toUpperCase())] = row[c];
  return value;
}

/**
 * The downtime's first job on SQL: the books, added up where the record lives. The same
 * arithmetic as `GoldAudit`, over every chain at once. It changes nothing and stops
 * nothing: it says what it found, and `cold_jobs` keeps it.
 */
export const RECORD_AUDIT: IDowntimeJob = {
  name: 'the-books',
  async run(cold) {
    const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;
    const chains = await cold.all(`SELECT owner_uid, COUNT(*) n, MIN(seq) lo, MAX(seq) hi, SUM(CASE WHEN prev_seq = seq - 1 THEN 0 ELSE 1 END) bad FROM ledger_rows GROUP BY owner_uid`);
    const broken = chains.filter(c => !(Number(c.lo) === 1 && Number(c.hi) === Number(c.n) && Number(c.bad) === 0)).map(c => String(c.owner_uid));

    const one = async (text: string) => Number((await cold.all(text))[0].v ?? 0);
    const endowed = await one(`SELECT SUM(json_extract(data, '$.gold')) v FROM documents WHERE substr(id, 1, 10) = 'endowment_'`);
    const moved = await one(`SELECT SUM(CASE type
        WHEN 'GOLD_DELTA' THEN COALESCE(json_extract(data, '$.payload.data.treasuryDelta'), 0)
        WHEN 'TRADE' THEN COALESCE(json_extract(data, '$.payload.data.treasuryDelta'), 0)
        WHEN 'TAX' THEN COALESCE(json_extract(data, '$.payload.data.tax'), 0)
        WHEN 'UPKEEP' THEN COALESCE(json_extract(data, '$.payload.data.amount'), 0)
        WHEN 'PRINT' THEN COALESCE(json_extract(data, '$.payload.data.amount'), 0)
        ELSE 0 END) v FROM ledger_rows`);
    const treasuryHeld = await one(`SELECT SUM(gold) v FROM treasuries WHERE substr(id, 1, 9) = 'treasury_'`);

    const walletRows = await one(`SELECT SUM(COALESCE(json_extract(data, '$.payload.data.amount'), 0)) v FROM ledger_rows WHERE type = 'WALLET'`);
    const walletDeltas = await one(`SELECT SUM(j.value) v FROM ledger_rows l, json_each(l.data, '$.payload.data.wallets') j WHERE l.type IN ('GOLD_DELTA', 'TRADE')`);
    const walletHeld = await one(`SELECT SUM(gold) v FROM treasuries WHERE substr(id, 1, 7) = 'wallet_'`);

    const report = {
      chains: chains.length,
      broken,
      treasury: { expected: endowed + moved, held: treasuryHeld },
      wallets: { expected: walletRows + walletDeltas, held: walletHeld }
    };
    return { ok: broken.length === 0 && near(report.treasury.expected, treasuryHeld) && near(report.wallets.expected, walletHeld), report };
  }
};

/**
 * The store a server runs on: the live database, with its keeper if this game asked for
 * one. The record is asked first, because an old file with no folder means something
 * different when the record already holds that save.
 */
export async function openLiveStore(url: string, env: NodeJS.ProcessEnv = process.env, options: IStoreOptions & IKeeperOptions = {}): Promise<SqlStore> {
  const config = recordConfig(env);
  if (!config.on) return openStore(url, options);

  let head: IWriteDownHead | null | undefined;
  let probe: IColdDoor | null = null;
  if (config.url) {
    try {
      probe = await openColdDoor({ url: config.url, authToken: config.authToken });
      head = await probe.head();
    } catch { /* the keeper finds this out for itself, and says so */ }
    finally { probe?.close(); }
  }

  const database = await openDatabase(url, { ...options, recordHoldsSave: !!head, recordReachable: head !== undefined });
  const keeper = new RecordKeeper(database, config, options);
  try {
    await keeper.goLive(head);
  } catch (e) {
    await database.close();
    throw e;
  }
  return new SqlStore(database, options, keeper);
}
