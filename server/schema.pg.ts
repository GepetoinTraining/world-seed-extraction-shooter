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
import { bigint, customType, doublePrecision, index, integer, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';

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
