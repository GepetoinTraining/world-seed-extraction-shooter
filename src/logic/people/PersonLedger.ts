/**
 * A CITY'S PEOPLE, in the browser: minting them on the hub's own chain, writing what they do onto
 * their own chains, and reading the city's table of people back as the fold of both.
 *
 * The law is PersonChain's. Rows go through the ledger like any other, signed by the character
 * whose browser computed them, into one unit per call, so a day's acts land together or not at all.
 * With nobody signed in nothing is written, and the game stands as it did.
 */

import { VectorNamespace, VectorStore } from '../../entities/data/VectorStore';
import { StoreUnit } from '../../entities/data/StoreUnit';
import { useIdentityStore } from '../../entities/identity/store';
import { ISignedPayload } from '../../entities/identity/certificateSystem';
import { ILedgerRow, Ledger } from '../ledger/Ledger';
import { linkOf } from '../ledger/chainLaw';
import { IHubRoll, IPersonAct, IPersonRecord, PersonAs, PersonChain, PERSON_ROW } from './PersonChain';

export interface IPersonMintAsk { npcId: string; as: PersonAs; name: string; origin: string }

const headOf = async (uid: string) => (await VectorStore.get<{ seq: number }>(VectorNamespace.TRANSACTIONS, `ledger_head_${uid}`))?.data?.seq ?? 0;

/** Write rows onto several chains in one unit, retrying on a conflict the way the ledger does. */
async function commit(write: (unit: StoreUnit) => Promise<boolean>): Promise<boolean> {
  if (!useIdentityStore.getState().certificate) return false;
  return StoreUnit.enqueue(async () => {
    try {
      for (;;) {
        const unit = new StoreUnit();
        if (!(await write(unit))) return false;
        const result = await unit.commit();
        if (result.ok) return true;
        if (!result.conflict) throw new Error(result.reason);
      }
    } catch (e) {
      console.error('[PEOPLE] A write failed:', e);
      return false;
    }
  });
}

/** The hub's own chain of a city, as this browser holds it, folded. Nothing held is an empty roll. */
async function rollOf(hubId: string): Promise<IHubRoll | string> {
  const hubUid = PersonChain.hubUidOf(hubId);
  const rows = await Ledger.list(hubUid);
  if (rows.length === 0) return { uid: hubUid, hubId, seq: 0, lastAt: 0, people: {} };
  return PersonChain.roll(rows.map(r => ({ row: r.payload, link: linkOf(r.signature) })), hubUid);
}

export const PersonLedger = {
  uidOf: (hubId: string, npcId: string) => PersonChain.uidOf(hubId, npcId),
  hubUidOf: (hubId: string) => PersonChain.hubUidOf(hubId),

  /** Mint whoever in this city is not on the hub's chain yet, one row each. Someone already minted is passed over. */
  mintMany(hubId: string, people: IPersonMintAsk[]): Promise<boolean> {
    if (people.length === 0) return Promise.resolve(true);
    const hubUid = PersonChain.hubUidOf(hubId);
    return commit(async unit => {
      const roll = await rollOf(hubId);
      if (typeof roll === 'string') { console.error('[PEOPLE] The hub\'s chain does not fold:', roll); return false; }
      const minting = new Set<string>();
      for (const p of people) {
        const person = PersonChain.uidOf(hubId, p.npcId);
        if (roll.people[person] || minting.has(person)) continue;
        await Ledger.writeInto(unit, PERSON_ROW, { hub: hubUid, person, kind: 'MINTED', hubId, npcId: p.npcId, as: p.as, name: p.name, origin: p.origin }, hubUid);
        minting.add(person);
      }
      return minting.size > 0;
    });
  },

  /**
   * What people did, each onto their own chain, in order. A person's first act names the link of
   * their mint row; someone not on the hub's chain is passed over.
   */
  actMany(hubId: string, acts: { npcId: string; act: IPersonAct }[]): Promise<boolean> {
    if (acts.length === 0) return Promise.resolve(true);
    return commit(async unit => {
      let wrote = false;
      let roll: IHubRoll | string | null = null;
      for (const { npcId, act } of acts) {
        const uid = PersonChain.uidOf(hubId, npcId);
        const first = unit.seqOf(uid) === 0 && (await headOf(uid)) === 0;
        let mint: string | undefined;
        if (first) {
          roll ??= await rollOf(hubId);
          mint = typeof roll === 'string' ? undefined : roll.people[uid]?.link;
          if (!mint) continue;
        }
        await Ledger.writeInto(unit, PERSON_ROW, { person: uid, ...act, ...(mint ? { mint } : {}) }, uid);
        wrote = true;
      }
      return wrote;
    });
  },

  /** One person's own chain, as signed rows. */
  rows(hubId: string, npcId: string): Promise<ISignedPayload<ILedgerRow>[]> {
    return Ledger.list(PersonChain.uidOf(hubId, npcId));
  },

  /** The hub's own chain of a city, as signed rows: its mints, in order. */
  hubRows(hubId: string): Promise<ISignedPayload<ILedgerRow>[]> {
    return Ledger.list(PersonChain.hubUidOf(hubId));
  },

  /** One person, resolved from their mint and their chain. A chain that breaks the law says how. */
  async record(hubId: string, npcId: string): Promise<IPersonRecord | string> {
    const roll = await rollOf(hubId);
    if (typeof roll === 'string') return roll;
    const uid = PersonChain.uidOf(hubId, npcId);
    return PersonChain.fold(roll.people[uid], (await Ledger.list(uid)).map(r => r.payload), uid);
  },

  /** The city's table of people: everyone on the hub's chain, each folded with their own chain. */
  async table(hubId: string): Promise<IPersonRecord[]> {
    const roll = await rollOf(hubId);
    if (typeof roll === 'string') return [];
    const out: IPersonRecord[] = [];
    for (const mint of Object.values(roll.people)) {
      const folded = PersonChain.fold(mint, (await Ledger.list(mint.uid)).map(r => r.payload), mint.uid);
      if (typeof folded !== 'string') out.push(folded);
    }
    return out.sort((a, b) => a.npcId.localeCompare(b.npcId));
  }
};
