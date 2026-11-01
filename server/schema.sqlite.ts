/**
 * THE SCHEMA, SQLite's spelling. `schema.pg.ts` is the same tables in Postgres's
 * spelling, and a bar holds the two together, column by column and index by index.
 *
 * `data` is TEXT and stays TEXT: signed documents are stored byte-identical, and
 * everything a query needs sits in a column beside them.
 */
import { index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const documents = sqliteTable('documents', {
  id: text('id').primaryKey(),
  namespace: text('namespace').notNull(),
  data: text('data').notNull(),
  embedding: text('embedding'),
  docType: text('doc_type'),
  genre: text('genre'),
  ownerCertUid: text('owner_cert_uid'),
  signature: text('signature'),
  version: integer('version').notNull(),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull()
}, t => [
  index('documents_namespace_idx').on(t.namespace),
  index('documents_namespace_type_idx').on(t.namespace, t.docType),
  index('documents_owner_idx').on(t.ownerCertUid)
]);

/** Append-only, one chain per identity. The chain's head is MAX(seq): it cannot disagree with its rows. */
export const ledgerRows = sqliteTable('ledger_rows', {
  id: text('id').primaryKey(),
  ownerUid: text('owner_uid').notNull(),
  seq: integer('seq').notNull(),
  prevSeq: integer('prev_seq').notNull(),
  ts: integer('ts').notNull(),
  type: text('type').notNull(),
  signature: text('signature').notNull(),
  data: text('data').notNull(),
  version: integer('version').notNull(),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull()
}, t => [
  uniqueIndex('ledger_rows_owner_seq_idx').on(t.ownerUid, t.seq),
  index('ledger_rows_type_idx').on(t.type)
]);

/** A balance is a number the database adds to, so overlapping credits lose nothing. */
export const treasuries = sqliteTable('treasuries', {
  id: text('id').primaryKey(),
  namespace: text('namespace').notNull(),
  gold: real('gold').notNull(),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull()
});

/** Every commit that landed, so a retried request applies once. */
export const commits = sqliteTable('commits', {
  id: text('id').primaryKey(),
  at: integer('at').notNull()
});
