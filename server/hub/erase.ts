/**
 * A PLAYER'S DATA, TAKEN OUT (Pedro, 2026-11-12: "we need to have account and password for players
 * to delete their data from our server"). An account asks, or Clerk says the account was deleted
 * there (clerk.ts), and everything this hub holds of it goes: the account, its sessions, its
 * characters and what the hub stated of them, every row of their ledgers, the people their cities
 * minted and those people's rows, their place in the pool, the jobs they posted, the worlds they
 * had checked, and their standing on the world we host.
 *
 * WHAT STAYS. What other players hold of them in their own histories (a trade's row names both
 * sides by character id), which are those players' and say nothing a person could be found by. The
 * content a world brought and this hub judged (themes, creature kinds, loot tables), which names no
 * one. A one-time text already used, which is a hash.
 *
 * WHY IT IS NOT THE STORE'S. The store's law is that a chain only appends, and it has no way to
 * delete at all, which is right for play. Taking a person out is the one act that goes around it,
 * so it is here, on the database itself, in one transaction, and nowhere else.
 *
 * THE RECORD FORGETS TOO. The record on Turso only ever takes what is added (record.ts), so a row
 * deleted here would stay there for good. The same ids are deleted there. A write-down that was on
 * its way when the account was deleted can still land after (coldStore.ts), so what was deleted is
 * remembered by id until a later maintenance looks at the record again and finds none of it: only
 * then is the note itself deleted, here and there. With no record, nothing is remembered.
 *
 * WHERE THE STORE IS TURSO ALONE (tursoStore.ts) there is no second copy: the store is the record. The
 * same ids go in one request on the store itself, whole or not at all, nothing is remembered, and the
 * answer says NONE, as for any hub that keeps no record apart from its store.
 */
import { sql } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import type { IDatabase } from '../../shared/dbShared';
import { openColdDoor, type IColdDoor } from '../coldStore';
import type { IRecordConfig } from '../record';
import type { Hub } from './Hub';

export interface IErased {
  /** How much went, in counts: nothing here names what it was. */
  characters: number;
  rows: number;
  documents: number;
  /** CLEARED: the record held none of it after. WAITING: the record could not be reached, and is tried at each maintenance. NONE: this hub keeps no record. */
  record: 'CLEARED' | 'WAITING' | 'NONE';
}

interface IErasure {
  type: 'hub_erase';
  docs: string[];
  chains: string[];
  at: number;
}

const NS = 'hub';
/** Ids in one statement: under what either database takes as bound values. */
const IDS_PER_ASK = 500;

const parts = <T>(list: T[], size = IDS_PER_ASK): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
};
const marks = (n: number) => Array.from({ length: n }, () => '?').join(', ');
const noteId = (accountKey: string) => `hub_erase_${createHash('sha256').update(accountKey).digest('hex').slice(0, 32)}`;

/** Ids taken out of the database under a store, whole or not at all: what a store on Turso does for itself (tursoStore.ts). */
export interface IEraseHere {
  erase(docs: string[], chains: string[]): Promise<{ rows: number; documents: number }>;
}

export class Eraser {
  constructor(
    private readonly hub: Hub,
    /** The Postgres under the store, or a store that takes ids out itself. */
    private readonly here: IDatabase | IEraseHere,
    private readonly record: IRecordConfig,
    private readonly openDoor: (config: { url: string; authToken?: string }) => Promise<IColdDoor> = openColdDoor
  ) {}

  /** Everything this hub holds that is this account's, by id. */
  private async gather(accountKey: string): Promise<{ docs: string[]; chains: string[]; characters: number }> {
    const store = this.hub.store;
    const of = async (type: string) => (await store.query({ namespace: NS, filter: { 'data.type': type } })).map(d => ({ id: d.id, data: JSON.parse(d.dataText) }));
    const characters = (await of('hub_character')).filter(d => d.data.account === accountKey);
    const uids = new Set<string>(characters.map(d => String(d.data.uid)));
    const rolls = (await of('hub_roll')).filter(d => d.data.account === accountKey);
    const people = (await of('hub_person')).filter(d => d.data.account === accountKey);
    const sessions = (await of('hub_session')).filter(d => d.data.account === accountKey);
    const jobs = (await of('hub_job')).filter(d => d.data.postedBy === accountKey);
    const worlds = (await of('hub_world')).filter(d => uids.has(String(d.data.creator)));
    const standings = (await of('hub_world_standing')).filter(d => uids.has(String(d.data.uid)));
    const docs = [
      `hub_account_${accountKey}`, `hub_failures_${accountKey}`, `hub_pool_${accountKey}`,
      ...[characters, rolls, people, sessions, jobs, worlds, standings].flat().map(d => d.id)
    ];
    const chains = [
      ...uids,
      ...rolls.map(d => d.id.slice('hub_roll_'.length)),
      ...people.map(d => d.id.slice('hub_person_'.length))
    ];
    return { docs: [...new Set(docs)], chains: [...new Set(chains)], characters: characters.length };
  }

  /** Out of this hub's own database, whole or not at all. Returns how much went. */
  private async eraseHere(docs: string[], chains: string[]): Promise<{ rows: number; documents: number }> {
    if ('erase' in this.here) return this.here.erase(docs, chains);
    const list = (ids: string[]) => sql.join(ids.map(id => sql`${id}`), sql`, `);
    return this.here.db.transaction(async (tx: any) => {
      let rows = 0;
      let documents = 0;
      for (const ids of parts(chains)) {
        const gone = await tx.execute(sql`DELETE FROM ledger_rows WHERE owner_uid IN (${list(ids)}) RETURNING id`);
        rows += gone.rows.length;
        for (const marked of parts<string>(gone.rows.map((r: any): string => String(r.id)))) await tx.execute(sql`DELETE FROM cold_changes WHERE tbl = 'ledger_rows' AND id IN (${list(marked)})`);
      }
      for (const ids of parts(docs)) {
        const gone = await tx.execute(sql`DELETE FROM documents WHERE id IN (${list(ids)}) RETURNING id`);
        documents += gone.rows.length;
        await tx.execute(sql`DELETE FROM cold_changes WHERE tbl = 'documents' AND id IN (${list(ids)})`);
      }
      return { rows, documents };
    });
  }

  /** Out of the record. Returns how much of it the record still held when asked. */
  private async eraseOnRecord(docs: string[], chains: string[]): Promise<number> {
    const door = await this.openDoor({ url: this.record.url!, authToken: this.record.authToken });
    try {
      const out = await door.runDowntimeJob({
        name: 'erase',
        async run(cold) {
          let found = 0;
          for (const ids of parts(chains)) {
            found += Number((await cold.all(`SELECT COUNT(*) n FROM ledger_rows WHERE owner_uid IN (${marks(ids.length)})`, ids))[0].n);
            await cold.all(`DELETE FROM ledger_rows WHERE owner_uid IN (${marks(ids.length)})`, ids);
            await cold.all(`DELETE FROM cold_stage_ledger_rows WHERE owner_uid IN (${marks(ids.length)})`, ids);
          }
          for (const ids of parts(docs)) {
            found += Number((await cold.all(`SELECT COUNT(*) n FROM documents WHERE id IN (${marks(ids.length)})`, ids))[0].n);
            await cold.all(`DELETE FROM documents WHERE id IN (${marks(ids.length)})`, ids);
            await cold.all(`DELETE FROM cold_stage_documents WHERE id IN (${marks(ids.length)})`, ids);
          }
          // What the record keeps of this job is a count, never an id
          return { ok: true, report: { found } };
        }
      });
      return Number((out.report as { found: number }).found);
    } finally {
      door.close();
    }
  }

  private get recorded() { return this.record.on && !!this.record.url; }

  /** Everything of one account, out. Safe to ask again: what is gone already is not there to delete. */
  async erase(accountKey: string): Promise<IErased> {
    const { docs, chains, characters } = await this.gather(accountKey);
    const note = noteId(accountKey);
    if (this.recorded) {
      // Remembered first, so a stop at any moment after leaves something for the next maintenance to finish
      const data: IErasure = { type: 'hub_erase', docs, chains, at: this.hub.now() };
      await this.hub.commit([{ kind: 'put', doc: this.hub.doc(note, data as unknown as Record<string, unknown>) }]);
    }
    const here = await this.eraseHere(docs, chains);
    if (!this.recorded) return { characters, ...here, record: 'NONE' };
    try {
      await this.eraseOnRecord(docs, chains);
      return { characters, ...here, record: 'CLEARED' };
    } catch (e) {
      console.warn(`[HUB] An account's data is out of this hub, and the record could not be reached to take it out there. It is tried again at each maintenance. (${e instanceof Error ? e.message : String(e)})`);
      return { characters, ...here, record: 'WAITING' };
    }
  }

  /**
   * At maintenance, after the write-down: every erasure still remembered is asked of the record
   * again. One the record held nothing of is finished, and its note is deleted here and there.
   * Returns how many are still remembered.
   */
  async sweep(): Promise<number> {
    if (!this.recorded) return 0;
    const notes = await this.hub.store.query({ namespace: NS, filter: { 'data.type': 'hub_erase' } });
    let left = 0;
    for (const doc of notes) {
      const note = JSON.parse(doc.dataText) as IErasure;
      try {
        // Its own rows may have been marked again by a commit that was in flight: out of here first
        await this.eraseHere(note.docs, note.chains);
        const found = await this.eraseOnRecord(note.docs, note.chains);
        if (found > 0) { left++; continue; }
        await this.eraseHere([doc.id], []);
        await this.eraseOnRecord([doc.id], []);
      } catch {
        left++;
      }
    }
    return left;
  }
}
