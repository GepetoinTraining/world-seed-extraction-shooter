/**
 * What the record and the live store hold in common: the four tables, and how a row is
 * fingerprinted, so that "the same on both sides" means one thing everywhere it is asked.
 */
import { createHash } from 'node:crypto';

export type RecordTableName = 'documents' | 'ledger_rows' | 'treasuries' | 'commits';
export type RecordRow = Record<string, unknown>;

export interface IRecordTable {
  name: RecordTableName;
  /** Every column the table has, in the database's own names. */
  columns: string[];
  /** Whole numbers on Postgres. */
  whole: string[];
  text: string[];
}

export const RECORD_TABLES: IRecordTable[] = [
  {
    name: 'documents',
    columns: ['id', 'namespace', 'data', 'embedding', 'doc_type', 'genre', 'owner_cert_uid', 'signature', 'version', 'created_at', 'updated_at'],
    whole: ['version', 'created_at', 'updated_at'],
    text: ['id', 'namespace', 'data', 'embedding', 'doc_type', 'genre', 'owner_cert_uid', 'signature']
  },
  {
    name: 'ledger_rows',
    columns: ['id', 'owner_uid', 'seq', 'prev_seq', 'ts', 'type', 'signature', 'data', 'version', 'created_at', 'updated_at'],
    whole: ['seq', 'prev_seq', 'ts', 'version', 'created_at', 'updated_at'],
    text: ['id', 'owner_uid', 'type', 'signature', 'data']
  },
  {
    name: 'treasuries',
    columns: ['id', 'namespace', 'gold', 'created_at', 'updated_at'],
    whole: ['created_at', 'updated_at'],
    text: ['id', 'namespace']
  },
  {
    name: 'commits',
    columns: ['id', 'at'],
    whole: ['at'],
    text: ['id']
  }
];

export const tableOf = (name: RecordTableName) => RECORD_TABLES.find(t => t.name === name)!;

export const sha256 = (text: string | Buffer) => createHash('sha256').update(text).digest('hex');

/** A row as both sides read it: every number a JS number, whatever the driver handed over. */
export function normalRow(shape: IRecordTable, raw: RecordRow): RecordRow {
  const row: RecordRow = {};
  for (const c of shape.columns) row[c] = raw[c] ?? null;
  for (const c of shape.whole) row[c] = Number(row[c]);
  if (shape.name === 'treasuries') row.gold = Number(row.gold);
  return row;
}

/** One row, as text nothing can reorder: its columns in their fixed order. */
export const fingerprint = (shape: IRecordTable, row: RecordRow) => sha256(JSON.stringify(shape.columns.map(c => row[c] ?? null)));

/** Prints of one table, or several, as one hash. The order is the ids', so either side may read in any order. */
export function digestOf(prints: Iterable<[string, string]>): string {
  const sorted = [...prints].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const hash = createHash('sha256');
  for (const [id, print] of sorted) hash.update(`${id}\0${print}\n`);
  return hash.digest('hex');
}

export const printKey = (table: RecordTableName, id: string) => `${table}\0${id}`;
