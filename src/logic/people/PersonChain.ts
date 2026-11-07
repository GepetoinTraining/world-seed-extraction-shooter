/**
 * A PERSON'S CHAIN (Pedro, 2026-11-06): "the npc needs to be minted as a world entity for the hub
 * under the hubs chain, that will allow you to track them deterministically from their table in the
 * hub and resolve the chain of actions they produce."
 *
 * A person in a city (a resident, a keeper, someone at a bench) is minted the way a character is: a
 * chain of their own, whose first row is their mint, and every row after it something they did. The
 * chain's id is computed from the city and the person, so every browser and the hub reach the same
 * one without asking. The hub holds the rows it checked, signs the mint with its own clock, and keeps
 * a table of the people it holds, each row of it the fold of that person's chain.
 *
 * Who signs a person's row: whoever's browser computed what they did, with that character's key, as
 * every other row is signed. Every row names the chain it belongs to, so a row cannot be lifted onto
 * another person's chain. My call; Pedro may overrule.
 *
 * Pure: the fold and the law run the same in the browser and on the hub.
 */

import { sha256Hex } from '../ledger/sha256';

export const PERSON_ROW = 'PERSON';

/** What a person stands as when minted. What they become after is in their acts. */
export type PersonAs = 'resident' | 'keeper' | 'craftsman';

/** What a person did, one row each. Every one names its chain in `person`. */
export type IPersonAct =
  | { kind: 'MINTED'; hubId: string; npcId: string; as: PersonAs; name: string; origin: string }
  | { kind: 'MET'; with: string; where: string; why: string; band: string; usual: boolean }
  | { kind: 'FED'; from: string; paid: boolean; day: number }
  | { kind: 'APPRENTICED'; master: string }
  | { kind: 'ROSE'; master: string; to: string }
  | { kind: 'MOVED_ON'; from: string }
  | { kind: 'BOUGHT_PARTS'; from: string }
  | { kind: 'PROMISED'; key: string }
  | { kind: 'SETTLED'; key: string }
  | { kind: 'TALKED'; with: string; band: string };

export type IPersonRowData = IPersonAct & { person: string };

/** A person as the hub's table holds them: who they are, and what their chain resolves to. */
export interface IPersonRecord {
  uid: string;
  hubId: string;
  npcId: string;
  as: PersonAs;
  name: string;
  origin: string;
  mintedAt: number;
  /** The last row folded. */
  seq: number;
  lastAt: number;
  /** How many of each act. */
  acts: Record<string, number>;
  /** Everyone they have met, by NPC id: how often, the last band it sat at, and how often it was the usual. */
  met: Record<string, { times: number; band: string; usual: number }>;
  fed: { paid: number; without: number; lastDay?: number };
  /** Where they stand on the road at a bench, if they are on it. */
  road?: { master: string; rank: string };
  /** Promises open on their chain, by key. */
  open: string[];
}

const KINDS = ['MINTED', 'MET', 'FED', 'APPRENTICED', 'ROSE', 'MOVED_ON', 'BOUGHT_PARTS', 'PROMISED', 'SETTLED', 'TALKED'] as const;
const text = (v: unknown) => typeof v === 'string' && v.length > 0;

export const PersonChain = {
  /** The chain's id: the city and the person, hashed. Every machine reaches the same one. */
  uidOf(hubId: string, npcId: string): string {
    return `person_${sha256Hex(`person|${hubId}|${npcId}`).slice(0, 16)}`;
  },

  /** What is wrong with one act on its own, or null. */
  actProblem(data: unknown): string | null {
    const d = data as Partial<IPersonRowData> & Record<string, unknown>;
    if (!d || typeof d !== 'object') return 'A person\'s row says nothing.';
    if (!text(d.person)) return 'A person\'s row names no chain.';
    if (!(KINDS as readonly string[]).includes(d.kind as string)) return `${String(d.kind)} is not something a person does.`;
    switch (d.kind) {
      case 'MINTED': return text(d.hubId) && text(d.npcId) && text(d.name) && typeof d.origin === 'string' && ['resident', 'keeper', 'craftsman'].includes(d.as as string) ? null : 'A mint must say the city, the person, what they stand as and their name.';
      case 'MET': return text(d.with) && typeof d.where === 'string' && typeof d.why === 'string' && text(d.band) && typeof d.usual === 'boolean' ? null : 'A meeting must say with whom and how it sat.';
      case 'FED': return text(d.from) && typeof d.paid === 'boolean' && Number.isInteger(d.day) ? null : 'A meal must say from whom, the day, and whether it was paid.';
      case 'APPRENTICED': return text(d.master) ? null : 'An apprenticeship must name the master.';
      case 'ROSE': return text(d.master) && text(d.to) ? null : 'A step on the road must name the master and the rank.';
      case 'MOVED_ON': case 'BOUGHT_PARTS': return text(d.from) ? null : 'It must name whom it was from.';
      case 'PROMISED': case 'SETTLED': return text(d.key) ? null : 'A promise must have its key.';
      case 'TALKED': return text(d.with) && text(d.band) ? null : 'A talk must say with whom and how it sat.';
    }
    return null;
  },

  /**
   * One row folded onto what the chain held before it. The first row must be the mint, and the mint
   * must be of the chain it is on; nothing after it may mint again. A problem comes back as words.
   */
  apply(before: IPersonRecord | null, row: { seq: number; ts: number; type: string; data: unknown }, chainUid: string): IPersonRecord | string {
    if (row.type !== PERSON_ROW) return `Row ${row.seq} is not a person's row.`;
    const problem = this.actProblem(row.data);
    if (problem) return `Row ${row.seq}: ${problem}`;
    const d = row.data as IPersonRowData;
    if (d.person !== chainUid) return `Row ${row.seq} names another person's chain.`;
    if (!before) {
      if (d.kind !== 'MINTED' || row.seq !== 1) return 'A person\'s chain starts with their mint, and only there.';
      if (this.uidOf(d.hubId, d.npcId) !== chainUid) return 'That mint is not of this chain: the city and the person make another id.';
      return {
        uid: chainUid, hubId: d.hubId, npcId: d.npcId, as: d.as, name: d.name, origin: d.origin,
        mintedAt: row.ts, seq: 1, lastAt: row.ts, acts: { MINTED: 1 }, met: {}, fed: { paid: 0, without: 0 }, open: []
      };
    }
    if (d.kind === 'MINTED') return `Row ${row.seq} mints a person who is already minted.`;
    const next: IPersonRecord = { ...before, seq: row.seq, lastAt: row.ts, acts: { ...before.acts, [d.kind]: (before.acts[d.kind] ?? 0) + 1 } };
    switch (d.kind) {
      case 'MET': {
        const was = before.met[d.with] ?? { times: 0, band: d.band, usual: 0 };
        next.met = { ...before.met, [d.with]: { times: was.times + 1, band: d.band, usual: was.usual + (d.usual ? 1 : 0) } };
        break;
      }
      case 'FED': next.fed = { paid: before.fed.paid + (d.paid ? 1 : 0), without: before.fed.without + (d.paid ? 0 : 1), lastDay: d.day }; break;
      case 'APPRENTICED': next.road = { master: d.master, rank: 'APPRENTICE' }; next.as = 'craftsman'; break;
      case 'ROSE': next.road = { master: d.master, rank: d.to }; break;
      case 'PROMISED': next.open = before.open.includes(d.key) ? before.open : [...before.open, d.key]; break;
      case 'SETTLED': next.open = before.open.filter(k => k !== d.key); break;
    }
    return next;
  },

  /** A whole chain, folded. The first problem stops it. */
  fold(rows: { seq: number; ts: number; type: string; data: unknown }[], chainUid: string): IPersonRecord | string {
    let at: IPersonRecord | null = null;
    for (const row of [...rows].sort((a, b) => a.seq - b.seq)) {
      const out = this.apply(at, row, chainUid);
      if (typeof out === 'string') return out;
      at = out;
    }
    return at ?? 'There is no chain to fold.';
  }
};
