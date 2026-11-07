/**
 * A PERSON'S CHAIN (Pedro, 2026-11-06): "the npc needs to be minted as a world entity for the hub
 * under the hubs chain, that will allow you to track them deterministically from their table in the
 * hub and resolve the chain of actions they produce."
 *
 * A person in a city (a resident, a keeper, someone at a bench) is minted on THE HUB'S OWN CHAIN
 * (Pedro, 2026-11-07: "Yes, mint on the hub's"): one chain per city, one row per person, so the hub
 * holds one ordered list of everyone who exists there. What they do after goes on a chain of their
 * own, whose first act names the link of their mint row (the hash of its signature, the same link a
 * chain's rows carry to the row before), so a person's chain cannot exist without their mint.
 *
 * Both ids are computed: the hub's chain from the city, a person's from the city and the person, so
 * every browser and the hub reach the same ones without asking. The hub holds the rows it checked,
 * signs each mint with its own clock, and keeps a table of the people it holds, each the fold of
 * their mint and their acts.
 *
 * Who signs these rows: whoever's browser computed them, with that character's key, as every other
 * row is signed. Every row names the chain it belongs to, so a row cannot be lifted onto another
 * chain. My call; Pedro may overrule.
 *
 * Pure: the fold and the law run the same in the browser and on the hub.
 */

import { sha256Hex } from '../ledger/sha256';

export const PERSON_ROW = 'PERSON';

/** What a person stands as when minted. What they become after is in their acts. */
export type PersonAs = 'resident' | 'keeper' | 'craftsman';

/** A mint, one row of the hub's own chain: which hub chain it is on, and whom it mints. */
export interface IMintRowData { hub: string; person: string; kind: 'MINTED'; hubId: string; npcId: string; as: PersonAs; name: string; origin: string }

/** What a person did, one row each on their own chain. */
export type IPersonAct =
  | { kind: 'MET'; with: string; where: string; why: string; band: string; usual: boolean }
  | { kind: 'FED'; from: string; paid: boolean; day: number }
  | { kind: 'APPRENTICED'; master: string }
  | { kind: 'ROSE'; master: string; to: string }
  | { kind: 'MOVED_ON'; from: string }
  | { kind: 'BOUGHT_PARTS'; from: string }
  | { kind: 'PROMISED'; key: string }
  | { kind: 'SETTLED'; key: string }
  | { kind: 'TALKED'; with: string; band: string };

/** A person's row: it names its chain in `person`, and the first act names the link of their mint row in `mint`. */
export type IPersonRowData = IPersonAct & { person: string; mint?: string };

/** A person as their mint made them, read off the hub's chain. */
export interface IPersonMint {
  uid: string;
  hubId: string;
  npcId: string;
  as: PersonAs;
  name: string;
  origin: string;
  mintedAt: number;
  /** Where the mint sits on the hub's chain, and the link of that row. */
  hubSeq: number;
  link: string;
}

/** The hub's own chain of a city, folded: everyone minted there, in order. */
export interface IHubRoll {
  uid: string;
  hubId: string;
  seq: number;
  lastAt: number;
  people: Record<string, IPersonMint>;
}

/** A person as the hub's table holds them: who they are, and what their chain resolves to. */
export interface IPersonRecord {
  uid: string;
  hubId: string;
  npcId: string;
  as: PersonAs;
  name: string;
  origin: string;
  mintedAt: number;
  /** The link of their mint row on the hub's chain. */
  mint: string;
  /** The last row of their own chain folded; 0 before they did anything. */
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

type IRow = { seq: number; ts: number; type: string; data: unknown };

const KINDS = ['MET', 'FED', 'APPRENTICED', 'ROSE', 'MOVED_ON', 'BOUGHT_PARTS', 'PROMISED', 'SETTLED', 'TALKED'] as const;
const AS: readonly string[] = ['resident', 'keeper', 'craftsman'];
const text = (v: unknown) => typeof v === 'string' && v.length > 0;

export const PersonChain = {
  /** A person's chain: the city and the person, hashed. Every machine reaches the same one. */
  uidOf(hubId: string, npcId: string): string {
    return `person_${sha256Hex(`person|${hubId}|${npcId}`).slice(0, 16)}`;
  },

  /** The hub's own chain of a city: the city, hashed. */
  hubUidOf(hubId: string): string {
    return `hub_${sha256Hex(`hub|${hubId}`).slice(0, 16)}`;
  },

  /**
   * One mint folded onto the hub's chain as it stood. Every row of it is a mint of someone of this
   * city, onto this chain, under the id their city and person make, and nobody is minted twice.
   * `link` is the link of this row (linkOf of its signature), which their first act will name.
   */
  mint(before: IHubRoll | null, row: IRow, hubUid: string, link: string): IHubRoll | string {
    if (row.type !== PERSON_ROW) return `Row ${row.seq} is not a person's row.`;
    const d = row.data as Partial<IMintRowData>;
    if (!d || d.kind !== 'MINTED') return `Row ${row.seq}: the hub's chain holds mints only.`;
    if (!text(d.hub) || !text(d.person) || !text(d.hubId) || !text(d.npcId) || !text(d.name) || typeof d.origin !== 'string' || !AS.includes(d.as as string)) {
      return `Row ${row.seq}: a mint must say the city, the person, what they stand as and their name.`;
    }
    if (d.hub !== hubUid) return `Row ${row.seq} names another hub's chain.`;
    if (this.hubUidOf(d.hubId!) !== hubUid) return `Row ${row.seq} mints someone of another city onto this hub's chain.`;
    if (this.uidOf(d.hubId!, d.npcId!) !== d.person) return `Row ${row.seq}: that mint is not of the person it names: the city and the person make another id.`;
    if (before?.people[d.person!]) return `Row ${row.seq} mints a person who is already minted.`;
    const minted: IPersonMint = { uid: d.person!, hubId: d.hubId!, npcId: d.npcId!, as: d.as as PersonAs, name: d.name!, origin: d.origin, mintedAt: row.ts, hubSeq: row.seq, link };
    return { uid: hubUid, hubId: d.hubId!, seq: row.seq, lastAt: row.ts, people: { ...(before?.people ?? {}), [minted.uid]: minted } };
  },

  /** A hub's whole chain, folded, each row with its link. The first problem stops it. */
  roll(rows: { row: IRow; link: string }[], hubUid: string): IHubRoll | string {
    let at: IHubRoll | null = null;
    for (const { row, link } of [...rows].sort((a, b) => a.row.seq - b.row.seq)) {
      const out = this.mint(at, row, hubUid, link);
      if (typeof out === 'string') return out;
      at = out;
    }
    return at ?? 'There is no chain to fold.';
  },

  /** A person as their mint made them, before they did anything. */
  start(m: IPersonMint): IPersonRecord {
    return {
      uid: m.uid, hubId: m.hubId, npcId: m.npcId, as: m.as, name: m.name, origin: m.origin, mintedAt: m.mintedAt, mint: m.link,
      seq: 0, lastAt: m.mintedAt, acts: {}, met: {}, fed: { paid: 0, without: 0 }, open: []
    };
  },

  /** What is wrong with one act on its own, or null. */
  actProblem(data: unknown): string | null {
    const d = data as Partial<IPersonRowData> & Record<string, unknown>;
    if (!d || typeof d !== 'object') return 'A person\'s row says nothing.';
    if (!text(d.person)) return 'A person\'s row names no chain.';
    if (!(KINDS as readonly string[]).includes(d.kind as string)) return `${String(d.kind)} is not something a person does.`;
    switch (d.kind) {
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
   * One act folded onto what the person stood as before it (PersonChain.start for none yet). The
   * first act names the link of their mint row, and only the first; a mint is never on a person's
   * own chain. A problem comes back as words.
   */
  apply(before: IPersonRecord, row: IRow, chainUid: string): IPersonRecord | string {
    if (row.type !== PERSON_ROW) return `Row ${row.seq} is not a person's row.`;
    if ((row.data as { kind?: unknown })?.kind === 'MINTED') return `Row ${row.seq}: a mint goes on the hub's chain, never on a person's own.`;
    const problem = this.actProblem(row.data);
    if (problem) return `Row ${row.seq}: ${problem}`;
    const d = row.data as IPersonRowData;
    if (d.person !== chainUid || before.uid !== chainUid) return `Row ${row.seq} names another person's chain.`;
    if (before.seq === 0) {
      if (row.seq !== 1 || d.mint !== before.mint) return 'A person\'s chain starts with an act that names their mint on the hub\'s chain.';
    } else if (d.mint !== undefined) {
      return `Row ${row.seq} names a mint: only the first act does.`;
    }
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

  /** A person: their mint off the hub's chain, then their own chain folded. The first problem stops it. */
  fold(mint: IPersonMint | null | undefined, rows: IRow[], chainUid: string): IPersonRecord | string {
    if (!mint) return 'This person\'s mint is not on the hub\'s chain.';
    if (mint.uid !== chainUid) return 'That mint is of another person.';
    let at = this.start(mint);
    for (const row of [...rows].sort((a, b) => a.seq - b.seq)) {
      const out = this.apply(at, row, chainUid);
      if (typeof out === 'string') return out;
      at = out;
    }
    return at;
  }
};
