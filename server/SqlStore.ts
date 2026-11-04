/**
 * THE STORE (D31): the one body of SQL behind `VectorStore`, on Postgres, whether in
 * process on a folder or served.
 *
 * A document id says where a document lives, so the 25 files above the interface
 * never learned there are tables:
 *   ledger_{uid}_{seq}   a row in ledger_rows, append-only and chained
 *   ledger_head_{uid}    no row at all: the head IS the chain's MAX(seq)
 *   treasury_{world}     a number in treasuries, which the database adds to
 *   wallet_{hub}__{who}  a person's own coin, the same kind of number in the same table (D115)
 *   anything else        a row in documents
 *
 * A commit is one SQL transaction, whole or not at all. That is line 71, and
 * with it a gold change and its ledger row can no longer come apart.
 *
 * Signatures are not checked here. The server holds no keys and is no notary:
 * verification stays where the certificates are, and out of scope for this leg.
 */
import { and, asc, eq, max, sql } from 'drizzle-orm';
import { cosineSimilarity } from '../src/entities/data/similarity';
import { CommitOp, ICommitRequest, ICommitResult, IHealth, IRecordStatus, IWireDoc, IWireQuery, IWireSearch, IWriteDownReceipt } from '../src/entities/data/wire';
import { IDatabase, IOpenOptions, isDataException, isUniqueViolation } from './dbShared';

/** The commit disagrees with what is stored (a fork, a gap, a moved head). Nothing applied. */
export class StoreConflict extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StoreConflict';
  }
}

/** The request itself cannot be honored. Nothing applied. */
export class StoreRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StoreRefusal';
  }
}

/** What keeps the record for this store, if this game asked for one (server/record.ts). */
export interface IStoreKeeper {
  status(): Promise<IRecordStatus>;
  writeDown(why: string): Promise<IWriteDownReceipt>;
  downtime(): Promise<IWriteDownReceipt>;
  stop(): Promise<void>;
}

export interface IStoreOptions extends IOpenOptions {
  /** A test seam: called between the ops of a commit. Line 71's fixtures kill the process here. */
  fault?: (stage: string) => void;
}

const LEDGER_NS = 'transactions';
const TREASURY_NS = 'territories';
const HEAD_PREFIX = 'ledger_head_';
const ROW_ID = /^ledger_(.+)_(\d+)$/;
const TREASURY_PREFIX = 'treasury_';
const WALLET_PREFIX = 'wallet_';

type Route = { to: 'head'; uid: string } | { to: 'row'; uid: string; seq: number } | { to: 'treasury' } | { to: 'document' };

function route(id: string, namespace?: string): Route {
  if (id.startsWith(HEAD_PREFIX) && (namespace === undefined || namespace === LEDGER_NS)) {
    return { to: 'head', uid: id.slice(HEAD_PREFIX.length) };
  }
  const row = ROW_ID.exec(id);
  if (row && (namespace === undefined || namespace === LEDGER_NS)) return { to: 'row', uid: row[1], seq: Number(row[2]) };
  if ((id.startsWith(TREASURY_PREFIX) || id.startsWith(WALLET_PREFIX)) && (namespace === undefined || namespace === TREASURY_NS)) return { to: 'treasury' };
  return { to: 'document' };
}

/** The columns a document's own text fills in, and the paths they answer. */
const DOCUMENT_COLUMNS: Record<string, 'docType' | 'genre' | 'ownerCertUid'> = {
  'data.type': 'docType',
  'data.genre': 'genre',
  'metadata.ownerCertUid': 'ownerCertUid'
};

function indexedFields(dataText: string): { docType: string | null; genre: string | null } {
  try {
    const data = JSON.parse(dataText);
    return {
      docType: typeof data?.type === 'string' ? data.type : null,
      genre: typeof data?.genre === 'string' ? data.genre : null
    };
  } catch {
    throw new StoreRefusal('A document\'s data is not JSON text.');
  }
}

function assertEqualityFilter(filter: Record<string, unknown>) {
  for (const [path, want] of Object.entries(filter)) {
    if (want !== null && typeof want === 'object') {
      throw new StoreRefusal(`The filter on "${path}" asks for more than equality, and this store will not pretend to honor it.`);
    }
  }
}

function pathValue(doc: IWireDoc, path: string): unknown {
  const parts = path.split('.');
  const root: any = parts[0] === 'metadata' ? doc.metadata : parts[0] === 'data' ? JSON.parse(doc.dataText) : doc;
  return (parts[0] === 'metadata' || parts[0] === 'data' ? parts.slice(1) : parts).reduce((at: any, key) => at?.[key], root);
}

/**
 * A timestamp or a version column is a whole number. The old store's file kept a
 * fraction there and said nothing, and Postgres refuses one, so a client's stray
 * fraction loses it here rather than the whole commit. None of these columns is signed:
 * a signature covers the data text, which never comes through here.
 */
const whole = (n: number) => Math.trunc(n);

const toEmbedding = (text: string | null): number[] | undefined => {
  if (!text) return undefined;
  const parsed = JSON.parse(text);
  return Array.isArray(parsed) && parsed.length > 0 ? parsed : undefined;
};

export class SqlStore {
  private readonly database: IDatabase;
  private readonly fault: (stage: string) => void;
  /**
   * Writes from this process take turns, and two things depend on it. A commit reads
   * before it writes (a guard, a chain's top), and under READ COMMITTED two at once
   * could both find a guard absent and both land. And VACUUM runs outside any
   * transaction, so none of ours may be open. PGlite would serialize its transactions
   * alone; a pool would not. Across several server processes on one Postgres only the
   * chain's unique index holds: a guard would race. One process per database for now.
   */
  private writes: Promise<unknown> = Promise.resolve();
  private writtenSinceTidy = 0;

  constructor(database: IDatabase, options: IStoreOptions = {}, private readonly keeper?: IStoreKeeper) {
    this.database = database;
    this.fault = options.fault ?? (() => undefined);
  }

  private get db() { return this.database.db; }
  private get t() { return this.database.schema as any; }

  async close(): Promise<void> {
    await this.keeper?.stop();
    await this.writes.catch(() => undefined);
    await this.database.close();
  }

  async health(): Promise<IHealth> {
    await this.db.select({ id: this.t.commits.id }).from(this.t.commits).limit(1);
    return { ok: true, service: 'worldseed-db', dialect: this.database.dialect, ...(this.keeper ? { record: await this.keeper.status() } : {}) };
  }

  /** A downtime other than maintenance: a world's gate going down. No record, no work, and that is an answer. */
  async writeDown(why: string): Promise<IWriteDownReceipt> {
    return this.keeper ? this.keeper.writeDown(why) : { status: 'NO_RECORD' };
  }

  /** Maintenance (D103): compacts what weeks of writes left behind. Nothing here reads a row's meaning. */
  async maintain(): Promise<{ ok: true; record?: IWriteDownReceipt }> {
    // The record first and outside the queue, so commits go on meanwhile. Whatever it says, the live store's own bytes are still tidied.
    const record = await this.keeper?.downtime();
    // It takes its turn with the writes, so no transaction of ours is open when it runs.
    // On a folder that is VACUUM FULL and a checkpoint, which give the space back as SQLite's VACUUM did.
    const run = this.writes.then(() => this.database.compact());
    this.writes = run.catch(() => undefined);
    await run;
    return { ok: true, ...(record ? { record } : {}) };
  }

  // ---------------------------------------------------------------------------
  // READS
  // ---------------------------------------------------------------------------

  async get(id: string): Promise<IWireDoc | null> {
    const where = route(id);
    if (where.to === 'head') return this.readHead(this.db, where.uid);
    if (where.to === 'row') {
      const [row] = await this.db.select().from(this.t.ledgerRows).where(eq(this.t.ledgerRows.id, id));
      if (row) return this.rowToWire(row);
    }
    if (where.to === 'treasury') {
      const [row] = await this.db.select().from(this.t.treasuries).where(eq(this.t.treasuries.id, id));
      if (row) return this.treasuryToWire(row);
    }
    const [doc] = await this.db.select().from(this.t.documents).where(eq(this.t.documents.id, id));
    return doc ? this.documentToWire(doc) : null;
  }

  async query(q: IWireQuery): Promise<IWireDoc[]> {
    const filter = q.filter ?? {};
    assertEqualityFilter(filter);
    const paths = Object.entries(filter);
    const onlyIndexed = paths.every(([path]) => DOCUMENT_COLUMNS[path]);

    // A limit goes down to the database when nothing above it has to look: one
    // table and indexed filters. Otherwise every source is read in id order,
    // merged, and limited here.
    const severalTables = q.namespace === LEDGER_NS || q.namespace === TREASURY_NS;
    const docs = await this.queryDocuments(q, paths, !severalTables && onlyIndexed ? q.limit : undefined);
    const extra = q.namespace === LEDGER_NS ? await this.queryRows(q, paths)
      : q.namespace === TREASURY_NS ? await this.queryTreasuries(q)
      : [];

    let merged = [...docs, ...extra];
    if (extra.length > 0) merged.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    for (const [path, want] of paths) {
      if (!DOCUMENT_COLUMNS[path] || extra.length > 0) merged = merged.filter(d => pathValue(d, path) === want);
    }
    return q.limit !== undefined ? merged.slice(0, q.limit) : merged;
  }

  private prefixCondition(column: any, prefix?: string) {
    if (!prefix) return undefined;
    // Not LIKE: a prefix may hold its wildcards.
    return sql`substr(${column}, 1, ${prefix.length}) = ${prefix}`;
  }

  private async queryDocuments(q: IWireQuery, paths: [string, unknown][], limit?: number): Promise<IWireDoc[]> {
    const t = this.t.documents;
    const conditions = [eq(t.namespace, q.namespace), this.prefixCondition(t.id, q.idPrefix)];
    for (const [path, want] of paths) {
      const column = DOCUMENT_COLUMNS[path];
      if (column) conditions.push(want === null ? sql`${t[column]} is null` : eq(t[column], want as string));
    }
    let statement = this.db.select().from(t).where(and(...conditions.filter(Boolean))).orderBy(asc(t.id));
    if (limit !== undefined) statement = statement.limit(limit);
    return (await statement).map((d: any) => this.documentToWire(d));
  }

  private async queryRows(q: IWireQuery, paths: [string, unknown][]): Promise<IWireDoc[]> {
    const t = this.t.ledgerRows;
    const owner = paths.find(([path]) => path === 'metadata.ownerCertUid');
    const conditions = [this.prefixCondition(t.id, q.idPrefix), owner ? eq(t.ownerUid, owner[1] as string) : undefined];
    const rows = await this.db.select().from(t).where(and(...conditions.filter(Boolean))).orderBy(asc(t.id));
    return rows.map((r: any) => this.rowToWire(r));
  }

  private async queryTreasuries(q: IWireQuery): Promise<IWireDoc[]> {
    const t = this.t.treasuries;
    const rows = await this.db.select().from(t).where(this.prefixCondition(t.id, q.idPrefix)).orderBy(asc(t.id));
    return rows.map((r: any) => this.treasuryToWire(r));
  }

  /**
   * Semantic search: cosine similarity, ranked here. On Postgres this one method
   * is where pgvector goes (see schema.pg.ts).
   */
  async search(s: IWireSearch): Promise<IWireDoc[]> {
    const t = this.t.documents;
    const rows = await this.db.select().from(t).where(and(eq(t.namespace, s.namespace), sql`${t.embedding} is not null`));
    return rows
      .map((row: any) => {
        const doc = this.documentToWire(row);
        return { doc, score: cosineSimilarity(s.vector, doc.embedding ?? []) };
      })
      .filter((hit: { score: number }) => hit.score >= s.threshold)
      .sort((a: { score: number }, b: { score: number }) => b.score - a.score)
      .slice(0, s.limit)
      .map((hit: { doc: IWireDoc }) => hit.doc);
  }

  // ---------------------------------------------------------------------------
  // THE COMMIT
  // ---------------------------------------------------------------------------

  commit(request: ICommitRequest): Promise<ICommitResult> {
    const run = this.writes.then(() => this.commitNow(request));
    this.writes = run.then(result => this.tidyIfDue(request, result), () => undefined);
    return run;
  }

  /** Takes its turn after the commit that made it due. The commit has its answer already: nobody waits on this. */
  private async tidyIfDue(request: ICommitRequest, result: ICommitResult): Promise<void> {
    const tidy = this.database.tidy;
    if (!tidy || !result.applied) return;
    for (const op of request.ops) this.writtenSinceTidy += op.kind === 'add' ? 0 : op.doc.dataText.length;
    if (this.writtenSinceTidy < tidy.everyBytes) return;
    this.writtenSinceTidy = 0;
    await tidy.run().catch(e => console.error('[DB] Tidying the database failed, and nothing was lost by it:', e));
  }

  private async commitNow(request: ICommitRequest): Promise<ICommitResult> {
    const { commits, documents } = this.t;
    try {
      return await this.db.transaction(async (tx: any) => {
        const [seen] = await tx.select({ id: commits.id }).from(commits).where(eq(commits.id, request.commitId));
        if (seen) return { applied: false };

        if (request.guardAbsent) {
          const [held] = await tx.select({ id: documents.id }).from(documents).where(eq(documents.id, request.guardAbsent));
          if (held) return { applied: false };
        }

        for (let i = 0; i < request.ops.length; i++) {
          this.fault(`op:${i}`);
          await this.applyOp(tx, request.ops[i]);
        }

        await tx.insert(commits).values({ id: request.commitId, at: Date.now() });
        this.fault('before-commit');
        return { applied: true };
      });
    } catch (e) {
      if (e instanceof StoreConflict || e instanceof StoreRefusal) throw e;
      // Two writers raced for one seq, or for one commit id: the loser re-reads.
      if (isUniqueViolation(e)) throw new StoreConflict('Another writer took that place first.');
      // Text or a number Postgres cannot hold. A 500 would have the client retry it forever.
      if (isDataException(e)) throw new StoreRefusal(`The commit holds a value the database cannot store: ${(e as Error).message}`);
      throw e;
    }
  }

  private async applyOp(tx: any, op: CommitOp): Promise<void> {
    if (op.kind === 'add') return this.addToTreasury(tx, op);

    const { doc } = op;
    const ifAbsent = op.kind === 'putIfAbsent';
    const where = route(doc.id, doc.namespace);
    if (where.to === 'head') return this.checkHead(tx, where.uid, doc, ifAbsent);
    if (where.to === 'row') return this.appendRow(tx, where.uid, where.seq, doc, ifAbsent);
    if (where.to === 'treasury') return this.setTreasury(tx, doc, ifAbsent);
    return this.writeDocument(tx, doc, ifAbsent);
  }

  private async writeDocument(tx: any, doc: IWireDoc, ifAbsent: boolean): Promise<void> {
    const t = this.t.documents;
    const fields = {
      namespace: doc.namespace,
      data: doc.dataText,
      embedding: doc.embedding && doc.embedding.length > 0 ? JSON.stringify(doc.embedding) : null,
      ...indexedFields(doc.dataText),
      ownerCertUid: doc.metadata.ownerCertUid ?? null,
      signature: doc.metadata.signature ?? null,
      version: whole(doc.metadata.version),
      createdAt: whole(doc.metadata.createdAt),
      updatedAt: whole(doc.metadata.updatedAt)
    };
    const insert = tx.insert(t).values({ id: doc.id, ...fields });
    await (ifAbsent ? insert.onConflictDoNothing({ target: t.id }) : insert.onConflictDoUpdate({ target: t.id, set: fields }));
  }

  /** The chain's law: rows only append, each onto the last, and a row never changes. */
  private async appendRow(tx: any, uid: string, seq: number, doc: IWireDoc, ifAbsent: boolean): Promise<void> {
    const t = this.t.ledgerRows;
    const [held] = await tx.select({ data: t.data }).from(t).where(eq(t.id, doc.id));
    if (held) {
      if (held.data === doc.dataText || ifAbsent) return;
      throw new StoreConflict(`Ledger ${uid} already holds a different row at seq ${seq}.`);
    }

    const top = await this.chainTop(tx, uid);
    if (seq !== top + 1) throw new StoreConflict(`Ledger ${uid} is at seq ${top}; a row at seq ${seq} would break the chain.`);

    let signed: any;
    try { signed = JSON.parse(doc.dataText); } catch { throw new StoreRefusal(`Row ${doc.id} is not JSON text.`); }
    const payload = signed?.payload;
    if (payload?.seq !== seq || payload?.prevSeq !== seq - 1 || typeof payload?.type !== 'string' || typeof signed?.signature !== 'string') {
      throw new StoreConflict(`Row ${doc.id} does not say what its id says.`);
    }

    await tx.insert(t).values({
      id: doc.id,
      ownerUid: uid,
      seq,
      prevSeq: payload.prevSeq,
      ts: whole(payload.ts),
      type: payload.type,
      signature: signed.signature,
      data: doc.dataText,
      version: whole(doc.metadata.version),
      createdAt: whole(doc.metadata.createdAt),
      updatedAt: whole(doc.metadata.updatedAt)
    });
  }

  private async chainTop(tx: any, uid: string): Promise<number> {
    const t = this.t.ledgerRows;
    const [row] = await tx.select({ top: max(t.seq) }).from(t).where(eq(t.ownerUid, uid));
    return Number(row?.top ?? 0);
  }

  /** The head is derived, so writing one only checks that the writer agrees with the chain. */
  private async checkHead(tx: any, uid: string, doc: IWireDoc, ifAbsent: boolean): Promise<void> {
    if (ifAbsent) return;
    const top = await this.chainTop(tx, uid);
    const claimed = JSON.parse(doc.dataText)?.seq;
    if (claimed !== top) throw new StoreConflict(`Ledger ${uid} is at seq ${top}, not ${claimed}.`);
  }

  private async readHead(db: any, uid: string): Promise<IWireDoc | null> {
    const t = this.t.ledgerRows;
    const top = await this.chainTop(db, uid);
    if (top === 0) return null;
    const [row] = await db.select({ ts: t.ts }).from(t).where(and(eq(t.ownerUid, uid), eq(t.seq, top)));
    return {
      id: `${HEAD_PREFIX}${uid}`,
      namespace: LEDGER_NS,
      dataText: JSON.stringify({ seq: top }),
      metadata: { createdAt: Number(row.ts), updatedAt: Number(row.ts), ownerCertUid: uid, version: 1 }
    };
  }

  private async addToTreasury(tx: any, op: Extract<CommitOp, { kind: 'add' }>): Promise<void> {
    const t = this.t.treasuries;
    await tx.insert(t)
      .values({ id: op.id, namespace: op.namespace, gold: op.amount, createdAt: whole(op.at), updatedAt: whole(op.at) })
      .onConflictDoUpdate({ target: t.id, set: { gold: sql`${t.gold} + ${op.amount}`, updatedAt: whole(op.at) } });
  }

  private async setTreasury(tx: any, doc: IWireDoc, ifAbsent: boolean): Promise<void> {
    const t = this.t.treasuries;
    const gold = JSON.parse(doc.dataText)?.gold;
    if (typeof gold !== 'number') throw new StoreRefusal(`Treasury ${doc.id} holds no number.`);
    const fields = { namespace: doc.namespace, gold, createdAt: whole(doc.metadata.createdAt), updatedAt: whole(doc.metadata.updatedAt) };
    const insert = tx.insert(t).values({ id: doc.id, ...fields });
    await (ifAbsent ? insert.onConflictDoNothing({ target: t.id }) : insert.onConflictDoUpdate({ target: t.id, set: fields }));
  }

  // ---------------------------------------------------------------------------
  // ROWS TO THE WIRE
  // ---------------------------------------------------------------------------

  private documentToWire(row: any): IWireDoc {
    const embedding = toEmbedding(row.embedding);
    return {
      id: row.id,
      namespace: row.namespace,
      dataText: row.data,
      ...(embedding ? { embedding } : {}),
      metadata: {
        createdAt: Number(row.createdAt),
        updatedAt: Number(row.updatedAt),
        ...(row.ownerCertUid !== null ? { ownerCertUid: row.ownerCertUid } : {}),
        ...(row.signature !== null ? { signature: row.signature } : {}),
        version: row.version
      }
    };
  }

  private rowToWire(row: any): IWireDoc {
    return {
      id: row.id,
      namespace: LEDGER_NS,
      dataText: row.data,
      metadata: { createdAt: Number(row.createdAt), updatedAt: Number(row.updatedAt), ownerCertUid: row.ownerUid, signature: row.signature, version: row.version }
    };
  }

  private treasuryToWire(row: any): IWireDoc {
    return {
      id: row.id,
      namespace: row.namespace,
      dataText: JSON.stringify({ gold: row.gold }),
      metadata: { createdAt: Number(row.createdAt), updatedAt: Number(row.updatedAt), ownerCertUid: 'SYSTEM', version: 1 }
    };
  }
}

// Opening one on a machine is openStore.ts's, so a browser that builds its own database never bundles Node's opener.

