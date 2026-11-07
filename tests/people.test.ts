/**
 * A CITY'S PEOPLE, the law (Pedro, 2026-11-06: "the npc needs to be minted as a world entity for the
 * hub under the hubs chain ... track them deterministically from their table in the hub and resolve
 * the chain of actions they produce"; 2026-11-07: "Yes, mint on the hub's"). Test lines, stated plainly:
 *   - the hub's chain and a person's chain have ids from the city (and the person), the same everywhere
 *   - the hub's chain holds mints only: everyone of this city, once each, in order
 *   - a person's chain holds what they did; its first act names the link of their mint row
 *   - folding a person resolves who they are and what they have done
 */

import { describe, it, expect } from 'vitest';
import { PersonChain, type IPersonMint } from '../src/logic/people/PersonChain';

const CITY = 'hub_one';
const HUB = PersonChain.hubUidOf(CITY);
const uid = PersonChain.uidOf(CITY, 'res_seed_bob');
const mintRow = (seq: number, npcId: string, over: Record<string, unknown> = {}) => ({
  seq, ts: 1000 + seq, type: 'PERSON',
  data: { hub: HUB, person: PersonChain.uidOf(CITY, npcId), kind: 'MINTED', hubId: CITY, npcId, as: 'resident', name: 'Bob', origin: `bond:seed:${npcId}`, ...over }
});
const roll = PersonChain.roll([{ row: mintRow(1, 'npc_bartender', { as: 'keeper', name: 'Mags' }), link: 'link_mags' }, { row: mintRow(2, 'res_seed_bob'), link: 'link_bob' }], HUB);
const bob = (typeof roll === 'string' ? null : roll.people[uid]) as IPersonMint;
const row = (seq: number, data: Record<string, unknown>, type = 'PERSON') => ({ seq, ts: 2000 + seq, type, data: { person: uid, ...data } });

describe('a city\'s people', () => {
  it('the hub\'s chain is the city, hashed, and a person\'s is the city and the person: the same everywhere, another city\'s Bob another person', () => {
    expect(PersonChain.uidOf(CITY, 'res_seed_bob')).toBe(uid);
    expect(uid).toMatch(/^person_[0-9a-f]{16}$/);
    expect(HUB).toMatch(/^hub_[0-9a-f]{16}$/);
    expect(PersonChain.uidOf('hub_two', 'res_seed_bob')).not.toBe(uid);
    expect(PersonChain.hubUidOf('hub_two')).not.toBe(HUB);
  });

  it('the hub\'s chain holds everyone minted in this city, in order, each with the link of their row', () => {
    expect(typeof roll).not.toBe('string');
    if (typeof roll === 'string') return;
    expect(roll.seq).toBe(2);
    expect(Object.values(roll.people).map(p => [p.npcId, p.hubSeq, p.link])).toEqual([['npc_bartender', 1, 'link_mags'], ['res_seed_bob', 2, 'link_bob']]);
  });

  it('the hub\'s chain mints once each, only this city\'s people, under the id they make, and holds nothing but mints', () => {
    const one = { row: mintRow(1, 'res_seed_bob'), link: 'a' };
    expect(PersonChain.roll([one, { row: mintRow(2, 'res_seed_bob'), link: 'b' }], HUB)).toMatch(/already minted/);
    expect(PersonChain.roll([{ row: mintRow(1, 'res_seed_bob', { hubId: 'hub_two', person: PersonChain.uidOf('hub_two', 'res_seed_bob') }), link: 'a' }], HUB)).toMatch(/another city/);
    expect(PersonChain.roll([{ row: mintRow(1, 'res_seed_bob', { hub: PersonChain.hubUidOf('hub_two') }), link: 'a' }], HUB)).toMatch(/another hub's chain/);
    expect(PersonChain.roll([{ row: mintRow(1, 'res_seed_bob', { person: PersonChain.uidOf(CITY, 'someone_else') }), link: 'a' }], HUB)).toMatch(/not of the person it names/);
    expect(PersonChain.roll([one, { row: { ...row(2, { kind: 'FED', from: 'x', paid: true, day: 1 }), data: { hub: HUB, person: uid, kind: 'FED' } }, link: 'b' }], HUB)).toMatch(/mints only/);
  });

  it('folding a person resolves who their mint made them and what they did', () => {
    const record = PersonChain.fold(bob, [
      row(1, { kind: 'FED', from: 'npc_bartender', paid: true, day: 3, mint: 'link_bob' }),
      row(2, { kind: 'FED', from: 'npc_bartender', paid: false, day: 4 }),
      row(3, { kind: 'APPRENTICED', master: 'npc_alchemist' }),
      row(4, { kind: 'ROSE', master: 'npc_alchemist', to: 'JOURNEYMAN' }),
      row(5, { kind: 'PROMISED', key: 'q_1' }),
      row(6, { kind: 'PROMISED', key: 'q_2' }),
      row(7, { kind: 'SETTLED', key: 'q_1' }),
      row(8, { kind: 'TALKED', with: 'player_uid', band: 'lands' })
    ], uid);
    expect(typeof record).not.toBe('string');
    if (typeof record === 'string') return;
    expect(record).toMatchObject({ npcId: 'res_seed_bob', name: 'Bob', as: 'craftsman', mint: 'link_bob', seq: 8, fed: { paid: 1, without: 1, lastDay: 4 }, road: { master: 'npc_alchemist', rank: 'JOURNEYMAN' }, open: ['q_2'] });
    expect(record.acts).toEqual({ FED: 2, APPRENTICED: 1, ROSE: 1, PROMISED: 2, SETTLED: 1, TALKED: 1 });
    // Minted and nothing done yet: they stand as their mint made them
    expect(PersonChain.fold(bob, [], uid)).toMatchObject({ seq: 0, as: 'resident', acts: {} });
  });

  it('it folds the same whatever order its rows arrive in', () => {
    const rows = [row(1, { kind: 'MET', with: 'g', where: 'w', why: 'y', band: 'idle', usual: false, mint: 'link_bob' }), row(2, { kind: 'MOVED_ON', from: 'npc_x' })];
    expect(PersonChain.fold(bob, [...rows].reverse(), uid)).toEqual(PersonChain.fold(bob, rows, uid));
  });

  it('a person\'s chain cannot stand without their mint, its first act must name that mint, and only the first does', () => {
    const fed = (seq: number, o: object = {}) => row(seq, { kind: 'FED', from: 'x', paid: true, day: 1, ...o });
    expect(PersonChain.fold(null, [fed(1, { mint: 'link_bob' })], uid)).toMatch(/not on the hub's chain/);
    expect(PersonChain.fold(bob, [fed(1)], uid)).toMatch(/names their mint/);
    expect(PersonChain.fold(bob, [fed(1, { mint: 'link_mags' })], uid)).toMatch(/names their mint/);
    expect(PersonChain.fold(bob, [fed(1, { mint: 'link_bob' }), fed(2, { mint: 'link_bob' })], uid)).toMatch(/only the first/);
    expect(PersonChain.fold(bob, [fed(1, { mint: 'link_bob' }), row(2, { kind: 'MINTED', hubId: CITY, npcId: 'res_seed_bob', as: 'resident', name: 'Bob', origin: '' })], uid)).toMatch(/never on a person's own/);
    expect(PersonChain.fold(bob, [{ ...fed(1, { mint: 'link_bob' }), data: { person: 'person_0000000000000000', kind: 'FED', from: 'x', paid: true, day: 1, mint: 'link_bob' } }], uid)).toMatch(/another person/);
  });

  it('an act that is not one, or says too little, is refused, and so is a row that is not a person\'s', () => {
    expect(PersonChain.fold(bob, [row(1, { kind: 'FLEW', mint: 'link_bob' })], uid)).toMatch(/not something a person does/);
    expect(PersonChain.fold(bob, [row(1, { kind: 'MET', with: 'g', mint: 'link_bob' })], uid)).toMatch(/with whom and how/);
    expect(PersonChain.fold(bob, [row(1, { kind: 'FED', from: 'x', paid: true, day: 1, mint: 'link_bob' }, 'GOLD_DELTA')], uid)).toMatch(/not a person's row/);
  });
});
