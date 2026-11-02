/**
 * THE SCHEMA.
 *
 * Text ids use the C collation, so ORDER BY id is byte order.
 * `data` must never become a JSON column type: those reorder keys, and signatures
 * cover the exact content. Everything a query needs sits in a column beside it.
 *
 * Where pgvector fits: `embedding` is JSON text today and search ranks in the
 * server (SqlStore.search). At deploy, add a `vector(n)` column beside it with an
 * ivfflat or hnsw index and replace that one method's body with an ORDER BY on
 * the cosine operator. The offline embedding has 256 dimensions; a better one,
 * if search ever needs it, means choosing a model and embedding again (D46).
 */
import { bigint, customType, doublePrecision, index, integer, pgTable, primaryKey, text, uniqueIndex } from 'drizzle-orm/pg-core';

const idText = customType<{ data: string }>({ dataType: () => 'text COLLATE "C"' });

export const documents = pgTable('documents', {
  id: idText('id').primaryKey(),
  namespace: text('namespace').notNull(),
  data: text('data').notNull(),
  embedding: text('embedding'),
  docType: text('doc_type'),
  genre: text('genre'),
  ownerCertUid: text('owner_cert_uid'),
  signature: text('signature'),
  version: integer('version').notNull(),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  updatedAt: bigint('updated_at', { mode: 'number' }).notNull()
}, t => [
  index('documents_namespace_idx').on(t.namespace),
  index('documents_namespace_type_idx').on(t.namespace, t.docType),
  index('documents_owner_idx').on(t.ownerCertUid)
]);

/** Append-only, one chain per identity. The chain's head is MAX(seq): it cannot disagree with its rows. */
export const ledgerRows = pgTable('ledger_rows', {
  id: idText('id').primaryKey(),
  ownerUid: text('owner_uid').notNull(),
  seq: integer('seq').notNull(),
  prevSeq: integer('prev_seq').notNull(),
  ts: bigint('ts', { mode: 'number' }).notNull(),
  type: text('type').notNull(),
  signature: text('signature').notNull(),
  data: text('data').notNull(),
  version: integer('version').notNull(),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  updatedAt: bigint('updated_at', { mode: 'number' }).notNull()
}, t => [
  uniqueIndex('ledger_rows_owner_seq_idx').on(t.ownerUid, t.seq),
  index('ledger_rows_type_idx').on(t.type)
]);

/** A balance is a number the database adds to, so overlapping credits lose nothing. */
export const treasuries = pgTable('treasuries', {
  id: idText('id').primaryKey(),
  namespace: text('namespace').notNull(),
  gold: doublePrecision('gold').notNull(),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  updatedAt: bigint('updated_at', { mode: 'number' }).notNull()
});

/** Every commit that landed, so a retried request applies once. */
export const commits = pgTable('commits', {
  id: text('id').primaryKey(),
  at: bigint('at', { mode: 'number' }).notNull()
});

/**
 * What the record does not have yet. A trigger keeps this, in the same transaction as
 * the write it marks, so a commit and its mark land together or not at all, and a hard
 * stop cannot lose track of anything Postgres still holds. One row per row changed: a
 * hub document saved a thousand times is one mark, carrying the newest number.
 */
export const coldChanges = pgTable('cold_changes', {
  tbl: text('tbl').notNull(),
  id: text('id').notNull(),
  seq: bigint('seq', { mode: 'number' }).notNull()
}, t => [
  primaryKey({ columns: [t.tbl, t.id] }),
  index('cold_changes_seq_idx').on(t.seq)
]);

/** Where this database stands with the record: the last write-down it knows landed, and one it may have sent. */
export const coldState = pgTable('cold_state', {
  key: text('key').primaryKey(),
  value: text('value').notNull()
});
