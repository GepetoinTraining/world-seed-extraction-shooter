/**
 * THE CHAIN'S LAW, one file for every side that checks a ledger: the browser's own audit, an avatar
 * coming back from a backup, the one-time import, and a hub checking receipts (server/hub). Pure
 * and synchronous: its SHA-256 is written out (sha256.ts), so every side reaches the same digits.
 *
 * Rows in the newer form (D135) carry two more things inside what is signed:
 *   prev    the SHA-256 of the row before's signature, so every row stands on the whole history
 *           under it, and a head held by someone else certifies all of it, not only its own seq
 *   clock   the moment's radix-chain address, and whose clock read it, which must name the row's own
 *           time, and a day never earlier than the row before's
 *
 * Older rows, written before this, still stand as they are. Once a chain has a newer row, every row
 * after it is in the newer form.
 *
 * Signatures are not checked here: each side checks them with the key it holds.
 */
import { addressMatches, dayIndexOf, type Residues, type InnerCount } from '../time/RadixClock';
import { sha256Hex } from './sha256';

export const ROW_VERSION = 2;

export interface IChainRow {
  payload: { seq: number; prevSeq: number; ts: number; v?: number; prev?: string | null; clock?: { n: Residues; t: InnerCount; by: string } };
  signature: string;
}

/** The row held just before a run being checked, when the run does not start at seq 1. */
export interface IChainStart { seq: number; signature: string; ts: number; v?: number }

export type ChainProblemKind = 'order' | 'link' | 'clock' | 'form';
export interface IChainProblem { seq: number; kind: ChainProblemKind; why: string }

/** What a newer row names its predecessor by. */
export const linkOf = (signature: string): string => sha256Hex(signature);

const isNewer = (v: unknown) => typeof v === 'number' && v >= ROW_VERSION;

/** The first thing wrong with a run of rows in seq order, or null. */
export function chainProblem(rows: readonly IChainRow[], before: IChainStart | null = null): IChainProblem | null {
  let previous: IChainStart | null = before;
  let expected = (before?.seq ?? 0) + 1;

  for (const row of rows) {
    const p = row.payload;
    if (p?.seq !== expected || p.prevSeq !== expected - 1) {
      return { seq: expected, kind: 'order', why: `The chain breaks at seq ${expected}.` };
    }

    if (!isNewer(p.v)) {
      if (previous && isNewer(previous.v)) return { seq: p.seq, kind: 'form', why: `Row ${p.seq} is in the older form, after a row in the newer one.` };
    } else {
      if (previous === null && p.seq !== 1) return { seq: p.seq, kind: 'link', why: `Row ${p.seq} has nothing before it to be checked against.` };
      const wanted = previous ? linkOf(previous.signature) : null;
      if ((p.prev ?? null) !== wanted) return { seq: p.seq, kind: 'link', why: `Row ${p.seq} names a different row before it than the one in this chain.` };
      if (!Number.isFinite(p.ts) || typeof p.clock?.by !== 'string' || !addressMatches(p.clock, p.ts)) {
        return { seq: p.seq, kind: 'clock', why: `Row ${p.seq}'s moment does not name its own time.` };
      }
      if (previous && isNewer(previous.v) && dayIndexOf(p.ts) < dayIndexOf(previous.ts)) {
        return { seq: p.seq, kind: 'clock', why: `Row ${p.seq} is dated a day before the row under it.` };
      }
    }

    previous = { seq: p.seq, signature: row.signature, ts: p.ts, v: p.v };
    expected++;
  }
  return null;
}
