/**
 * A PERSON'S CHAIN, in the browser: minting the people of a city, writing what they do onto their
 * own chains, and reading the city's table of people back as the fold of those chains.
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
import { IPersonAct, IPersonRecord, PersonAs, PersonChain, PERSON_ROW } from './PersonChain';

export interface IPersonMint { npcId: string; as: PersonAs; name: string; origin: string }

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

export const PersonLedger = {
  uidOf: (hubId: string, npcId: string) => PersonChain.uidOf(hubId, npcId),

  /** Mint whoever in this city has no chain yet. Someone already minted is passed over. */
  mintMany(hubId: string, people: IPersonMint[]): Promise<boolean> {
    if (people.length === 0) return Promise.resolve(true);
    return commit(async unit => {
      let wrote = false;
      for (const p of people) {
        const uid = PersonChain.uidOf(hubId, p.npcId);
        if (unit.seqOf(uid) > 0 || (await headOf(uid)) > 0) continue;
        await Ledger.writeInto(unit, PERSON_ROW, { person: uid, kind: 'MINTED', hubId, npcId: p.npcId, as: p.as, name: p.name, origin: p.origin }, uid);
        wrote = true;
      }
      return wrote;
    });
  },

  /** What people did, each onto their own chain, in order. Someone never minted is passed over. */
  actMany(hubId: string, acts: { npcId: string; act: Exclude<IPersonAct, { kind: 'MINTED' }> }[]): Promise<boolean> {
    if (acts.length === 0) return Promise.resolve(true);
    return commit(async unit => {
      let wrote = false;
      const minted = new Map<string, boolean>();
      for (const { npcId, act } of acts) {
        const uid = PersonChain.uidOf(hubId, npcId);
        if (!minted.has(uid)) minted.set(uid, unit.seqOf(uid) > 0 || (await headOf(uid)) > 0);
        if (!minted.get(uid)) continue;
        await Ledger.writeInto(unit, PERSON_ROW, { person: uid, ...act }, uid);
        wrote = true;
      }
      return wrote;
    });
  },

  /** One person's chain, as signed rows. */
  rows(hubId: string, npcId: string): Promise<ISignedPayload<ILedgerRow>[]> {
    return Ledger.list(PersonChain.uidOf(hubId, npcId));
  },

  /** One person, resolved from their chain. A chain that breaks the law says how. */
  async record(hubId: string, npcId: string): Promise<IPersonRecord | string> {
    const uid = PersonChain.uidOf(hubId, npcId);
    return PersonChain.fold((await Ledger.list(uid)).map(r => r.payload), uid);
  },

  /** The city's table of people: every chain held here that minted someone of this city, folded. */
  async table(hubId: string): Promise<IPersonRecord[]> {
    const rows = (await VectorStore.query<ISignedPayload<ILedgerRow>>({ namespace: VectorNamespace.TRANSACTIONS, idPrefix: 'ledger_person_' }))
      .filter(d => d?.id?.startsWith?.('ledger_person_'));
    const chains = new Map<string, ILedgerRow[]>();
    for (const d of rows) {
      const uid = /^ledger_(.+)_\d+$/.exec(d.id)?.[1];
      if (uid) chains.set(uid, [...(chains.get(uid) ?? []), d.data.payload]);
    }
    const out: IPersonRecord[] = [];
    for (const [uid, chain] of chains) {
      const folded = PersonChain.fold(chain, uid);
      if (typeof folded !== 'string' && folded.hubId === hubId) out.push(folded);
    }
    return out.sort((a, b) => a.npcId.localeCompare(b.npcId));
  }
};
