/**
 * WHAT THE DEVELOPERS' VIEW READS, WHATEVER THE STORE IS (dev.ts). Pedro, 2026-11-13, on the hub's
 * store on the host: "Yes, Turso only". The view's routes and its page know no database: they ask
 * this interface, and every line of a query language the view needs is in one body per kind of store.
 *
 *   devStorePostgres.ts   the store as it stands today: SqlStore on Postgres, served or in a folder
 *   (a body for Turso is written beside it, by the same shapes)
 *
 * A body answers in the shapes below and nothing else, with every table name it gives coming from
 * its own catalog and every table name it is asked checked against that catalog. It never writes.
 * It need not hide anything: the view's guard hides what must never leave (dev.ts), over whatever a
 * body answers. A body may name its tables as it likes; the view and the page only ever pass back a
 * name the body gave them.
 */

/** How many of something, the latest of them and the oldest. */
export interface IDevCount {
  count: number;
  /** The newest, by its own moment: the table it is in, its id, when. */
  latest: { table: string; id: string; at: number } | null;
  /** When the oldest was made. */
  oldest: number | null;
}

/** What to count: documents of one kind (their `type`), or one of the store's own kinds of thing. */
export type DevCountOf = { kind: string } | { of: 'receipts' | 'lines' | 'live_events' };

/** The state of the store itself. A body that cannot answer throws, with words a person can read. */
export interface IDevStoreState {
  /** What the store is, in a word the store gives (`postgres`, `turso`). */
  dialect: string;
  /** How far its migrations stand against the ones this build carries. `applied` is null when the store cannot say. */
  migrations: { applied: number | null; known: number; newest: string | null };
  /** The record kept for this store, if one is asked for, and the changes here not yet on it. */
  record: { asked: boolean; state?: string; behind?: number; last?: string; says?: string; marked: number };
}

export interface IDevTables {
  /** Every table, by the store's own name for it, with its rows and its newest moment. */
  tables: { name: string; rows: number; newest: number | null }[];
  /** The documents, by namespace and kind. */
  collections: { table: string; namespace: string; type: string | null; rows: number; newest: number | null }[];
  /** The ledger's rows, by kind. */
  ledger: { table: string; type: string; rows: number; newest: number | null }[];
}

/** A page of a table, newest first. Filters a table does not have are passed over. */
export interface IDevPageAsk {
  table: string;
  namespace?: string;
  type?: string;
  owner?: string;
  page: number;
  size: number;
}

/** A document's line in a list. */
export interface IDevDocumentLine { table: string; id: string; namespace: string; type: string | null; owner: string | null; createdAt: number | null; updatedAt: number | null; bytes: number | null }
/** A ledger row's line in a list. */
export interface IDevReceiptLine { table: string; id: string; owner: string; seq: number | null; type: string; ts: number | null; bytes: number | null }

export interface IDevPage {
  table: string;
  total: number;
  page: number;
  size: number;
  /** Documents and ledger rows as their lines; any other table's rows whole, long texts cut. */
  rows: Record<string, unknown>[];
}

export interface IDevFindAsk {
  id: string;
  /** Ids to look for exactly (an account's, a character's, a world's document). */
  exact: string[];
  /** At most this many documents naming it, newest first. */
  documents: number;
  /** At most this many of the receipts held under it, newest first. */
  receipts: number;
}

export interface IDevFound {
  exact: { table: string; id: string }[];
  documents: IDevDocumentLine[];
  ledger: { rows: number; newest: IDevReceiptLine[]; mentionedIn: number };
}

/** A table this store does not have. */
export const NO_TABLE = 'NO_TABLE';
/** A table whose rows have no id to be opened by. */
export const NOT_ONE_BY_ONE = 'NOT_ONE_BY_ONE';

export interface IDevStore {
  /** The store itself: what it is, whether it answers (it throws if not), its migrations, its record. */
  state(): Promise<IDevStoreState>;
  /** How many of one kind of thing, and the latest. */
  count(what: DevCountOf): Promise<IDevCount>;
  /** Every table, and every collection of the documents and the ledger. */
  tables(): Promise<IDevTables>;
  /** A page of a table's rows, newest first. */
  page(ask: IDevPageAsk): Promise<IDevPage | typeof NO_TABLE>;
  /** One row whole, its texts read as JSON where they are JSON; null when there is none of that id. */
  row(table: string, id: string): Promise<Record<string, unknown> | null | typeof NO_TABLE | typeof NOT_ONE_BY_ONE>;
  /** What names an id: the documents by that id exactly, the documents naming it, the receipts held under it. */
  find(ask: IDevFindAsk): Promise<IDevFound>;
}

/** A value as JSON can carry it: a database's big numbers as numbers. */
export const plain = (value: unknown): unknown => (typeof value === 'bigint' ? Number(value) : value);
export const plainRow = (row: Record<string, unknown>) => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, plain(v)]));
export const num = (value: unknown): number | null => (value === null || value === undefined ? null : Number(value));
/** A text read as JSON if it is JSON, as it stands if not. */
export const parsed = (text: unknown): unknown => {
  if (typeof text !== 'string') return text;
  try { return JSON.parse(text); } catch { return text; }
};
