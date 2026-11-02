-- THE RECORD, on Turso. The same four tables as the live store, in SQLite's spelling, so a
-- row crosses as it is and nothing translates signed text. It stays this small until the
-- data layer's tables come (DATA_LAYER_PLAN.md, section 5).
CREATE TABLE documents (
  id text PRIMARY KEY NOT NULL,
  namespace text NOT NULL,
  data text NOT NULL,
  embedding text,
  doc_type text,
  genre text,
  owner_cert_uid text,
  signature text,
  version integer NOT NULL,
  created_at integer NOT NULL,
  updated_at integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX documents_namespace_idx ON documents (namespace);
--> statement-breakpoint
CREATE TABLE ledger_rows (
  id text PRIMARY KEY NOT NULL,
  owner_uid text NOT NULL,
  seq integer NOT NULL,
  prev_seq integer NOT NULL,
  ts integer NOT NULL,
  type text NOT NULL,
  signature text NOT NULL,
  data text NOT NULL,
  version integer NOT NULL,
  created_at integer NOT NULL,
  updated_at integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX ledger_rows_owner_seq_idx ON ledger_rows (owner_uid, seq);
--> statement-breakpoint
CREATE TABLE treasuries (
  id text PRIMARY KEY NOT NULL,
  namespace text NOT NULL,
  gold real NOT NULL,
  created_at integer NOT NULL,
  updated_at integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE commits (
  id text PRIMARY KEY NOT NULL,
  at integer NOT NULL
);
--> statement-breakpoint
-- Every write-down that landed, each naming the one before it. Its id is the proof a retry looks for.
CREATE TABLE cold_writedowns (
  seq integer PRIMARY KEY AUTOINCREMENT,
  id text NOT NULL UNIQUE,
  prev text,
  why text NOT NULL,
  at integer NOT NULL,
  rows integer NOT NULL,
  digest text NOT NULL
);
--> statement-breakpoint
-- Rows on their way in. A write-down too large for one request lands here in parts,
-- and moves across in one batch, so the record never holds half of one.
CREATE TABLE cold_stage_documents (writedown text NOT NULL, id text NOT NULL, namespace text NOT NULL, data text NOT NULL, embedding text, doc_type text, genre text, owner_cert_uid text, signature text, version integer NOT NULL, created_at integer NOT NULL, updated_at integer NOT NULL);
--> statement-breakpoint
CREATE TABLE cold_stage_ledger_rows (writedown text NOT NULL, id text NOT NULL, owner_uid text NOT NULL, seq integer NOT NULL, prev_seq integer NOT NULL, ts integer NOT NULL, type text NOT NULL, signature text NOT NULL, data text NOT NULL, version integer NOT NULL, created_at integer NOT NULL, updated_at integer NOT NULL);
--> statement-breakpoint
CREATE TABLE cold_stage_treasuries (writedown text NOT NULL, id text NOT NULL, namespace text NOT NULL, gold real NOT NULL, created_at integer NOT NULL, updated_at integer NOT NULL);
--> statement-breakpoint
CREATE TABLE cold_stage_commits (writedown text NOT NULL, id text NOT NULL, at integer NOT NULL);
--> statement-breakpoint
-- What each downtime job found.
CREATE TABLE cold_jobs (
  seq integer PRIMARY KEY AUTOINCREMENT,
  name text NOT NULL,
  at integer NOT NULL,
  ok integer NOT NULL,
  report text NOT NULL
);
