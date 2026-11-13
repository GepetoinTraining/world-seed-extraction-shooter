-- The hub's store on Turso alone (server/tursoStore.ts). Every name begins store_, so none can meet the
-- record's (server/recordRows.ts, drizzle/cold) in the same database. Made if not there, never dropped
-- or altered: a later migration only adds.
CREATE TABLE IF NOT EXISTS store_documents (
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
CREATE INDEX IF NOT EXISTS store_documents_namespace_idx ON store_documents (namespace, id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS store_documents_namespace_type_idx ON store_documents (namespace, doc_type, id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS store_documents_owner_idx ON store_documents (owner_cert_uid);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS store_ledger_rows (
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
CREATE UNIQUE INDEX IF NOT EXISTS store_ledger_rows_owner_seq_idx ON store_ledger_rows (owner_uid, seq);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS store_ledger_rows_type_idx ON store_ledger_rows (type);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS store_treasuries (
  id text PRIMARY KEY NOT NULL,
  namespace text NOT NULL,
  gold real NOT NULL,
  created_at integer NOT NULL,
  updated_at integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS store_commits (
  id text PRIMARY KEY NOT NULL,
  at integer NOT NULL,
  nonce text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS store_live_lines (
  key text PRIMARY KEY NOT NULL,
  world text NOT NULL,
  line text NOT NULL,
  v integer NOT NULL,
  at integer NOT NULL,
  by text NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS store_live_lines_world_at_idx ON store_live_lines (world, at);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS store_live_places (
  world text NOT NULL,
  instance text NOT NULL,
  at integer NOT NULL,
  places text NOT NULL,
  PRIMARY KEY (world, instance)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS store_live_places_world_at_idx ON store_live_places (world, at);
