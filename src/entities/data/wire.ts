/**
 * THE WIRE (D31): what the game and the database server say to each other.
 *
 * Pure types, shared by the browser and the server. A document's data travels
 * and rests as TEXT: signatures cover the exact content, so nothing between the
 * signer and the verifier may parse and re-serialize it.
 */

export interface IWireMetadata {
  createdAt: number;
  updatedAt: number;
  ownerCertUid?: string;
  signature?: string;
  version: number;
}

export interface IWireDoc {
  id: string;
  namespace: string;
  /** JSON.stringify(doc.data), exactly once, by whoever made the document. */
  dataText: string;
  embedding?: number[];
  metadata: IWireMetadata;
}

export type CommitOp =
  /** Upsert. A ledger row is append-only and a treasury holds a number; the store knows which is which by id. */
  | { kind: 'put'; doc: IWireDoc }
  /** Insert or leave alone. The one-time import and the backup restore write only through this. */
  | { kind: 'putIfAbsent'; doc: IWireDoc }
  /** Add to a treasury atomically, so overlapping credits from any client lose nothing. */
  | { kind: 'add'; namespace: string; id: string; amount: number; at: number };

export interface ICommitRequest {
  /** Retried until answered, and applied once: a commit that landed but lost its reply is not repeated. */
  commitId: string;
  ops: CommitOp[];
  /** One-time grants: if a document with this id exists, nothing in the commit applies. */
  guardAbsent?: string;
}

export interface ICommitResult {
  applied: boolean;
}

export interface IWireQuery {
  namespace: string;
  /** Equality on dotted paths: data.type, data.genre and metadata.ownerCertUid are indexed. */
  filter?: Record<string, unknown>;
  /** A literal, case-sensitive prefix of the id. */
  idPrefix?: string;
  limit?: number;
}

export interface IWireSearch {
  namespace: string;
  vector: number[];
  threshold: number;
  limit: number;
}

export interface IHealth {
  ok: boolean;
  service?: 'worldseed-db';
  dialect?: 'postgres';
  reason?: string;
  /** An old save with no database beside it: a person can carry it over from where they stand. */
  canCarry?: boolean;
  record?: IRecordStatus;
}

/** Where a game stands with the record (D133). Only a game that asked for one has this. */
export interface IRecordStatus {
  /** READY means it answered last time, and says nothing about what has gone up since: `behind` does. */
  state: 'READY' | 'NONE' | 'WAITING' | 'MOVED' | 'FORK' | 'WRONG_URL';
  /** Rows changed here that the record has not seen. */
  behind: number;
  last?: string;
  /** What a person should be told, once. */
  says?: string;
}

export interface IWriteDownReceipt {
  status: 'WRITTEN' | 'NOTHING' | 'NO_RECORD' | 'WAITING' | 'MOVED' | 'FORK' | 'MISMATCH' | 'WRONG_URL';
  id?: string;
  rows?: number;
  digest?: string;
  says?: string;
  audit?: { ok: boolean; report: unknown };
}
