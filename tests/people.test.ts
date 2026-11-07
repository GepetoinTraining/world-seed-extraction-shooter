/**
 * A PERSON'S CHAIN, the law (Pedro, 2026-11-06: "the npc needs to be minted as a world entity for the
 * hub under the hubs chain ... track them deterministically from their table in the hub and resolve
 * the chain of actions they produce"). Test lines, stated plainly:
 *   - a person's chain id comes from the city and the person, the same on every machine
 *   - the chain starts with their mint and only there; every row names the chain it is on
 *   - folding the chain resolves who they are and what they have done
 */

import { describe, it, expect } from 'vitest';
import { PersonChain } from '../src/logic/people/PersonChain';

const CITY = 'hub_one';
const uid = PersonChain.uidOf(CITY, 'res_seed_bob');
const row = (seq: number, data: Record<string, unknown>, type = 'PERSON') => ({ seq, ts: 1000 + seq, type, data: { person: uid, ...data } });
const mint = row(1, { kind: 'MINTED', hubId: CITY, npcId: 'res_seed_bob', as: 'resident', name: 'Bob', origin: 'bond:seed:bob' });

describe('a person\'s chain', () => {
  it('its id is the city and the person, hashed: the same everywhere, and another city\'s Bob is another person', () => {
    expect(PersonChain.uidOf(CITY, 'res_seed_bob')).toBe(uid);
    expect(uid).toMatch(/^person_[0-9a-f]{16}$/);
    expect(PersonChain.uidOf('hub_two', 'res_seed_bob')).not.toBe(uid);
  });

  it('folding it resolves who they are and what they did', () => {
    const record = PersonChain.fold([
      mint,
      row(2, { kind: 'FED', from: 'npc_bartender', paid: true, day: 3 }),
      row(3, { kind: 'FED', from: 'npc_bartender', paid: false, day: 4 }),
      row(4, { kind: 'APPRENTICED', master: 'npc_alchemist' }),
      row(5, { kind: 'ROSE', master: 'npc_alchemist', to: 'JOURNEYMAN' }),
      row(6, { kind: 'PROMISED', key: 'q_1' }),
      row(7, { kind: 'PROMISED', key: 'q_2' }),
      row(8, { kind: 'SETTLED', key: 'q_1' }),
      row(9, { kind: 'TALKED', with: 'player_uid', band: 'lands' })
    ], uid);
    expect(typeof record).not.toBe('string');
    if (typeof record === 'string') return;
    expect(record).toMatchObject({ npcId: 'res_seed_bob', name: 'Bob', as: 'craftsman', seq: 9, fed: { paid: 1, without: 1, lastDay: 4 }, road: { master: 'npc_alchemist', rank: 'JOURNEYMAN' }, open: ['q_2'] });
    expect(record.acts).toMatchObject({ MINTED: 1, FED: 2, PROMISED: 2, SETTLED: 1, TALKED: 1 });
  });

  it('it folds the same whatever order its rows arrive in', () => {
    const rows = [mint, row(2, { kind: 'MET', with: 'g', where: 'w', why: 'y', band: 'idle', usual: false }), row(3, { kind: 'MOVED_ON', from: 'npc_x' })];
    expect(PersonChain.fold([...rows].reverse(), uid)).toEqual(PersonChain.fold(rows, uid));
  });

  it('it starts with the mint and only there, the mint must be of this chain, and nothing names another chain', () => {
    expect(PersonChain.fold([row(1, { kind: 'FED', from: 'x', paid: true, day: 1 })], uid)).toMatch(/starts with their mint/);
    expect(PersonChain.fold([row(1, { kind: 'MINTED', hubId: 'hub_two', npcId: 'res_seed_bob', as: 'resident', name: 'Bob', origin: '' })], uid)).toMatch(/not of this chain/);
    expect(PersonChain.fold([mint, row(2, { kind: 'MINTED', hubId: CITY, npcId: 'res_seed_bob', as: 'resident', name: 'Bob', origin: '' })], uid)).toMatch(/already minted/);
    expect(PersonChain.fold([mint, { ...row(2, { kind: 'FED', from: 'x', paid: true, day: 1 }), data: { person: 'person_0000000000000000', kind: 'FED', from: 'x', paid: true, day: 1 } }], uid)).toMatch(/another person/);
  });

  it('an act that is not one, or says too little, is refused, and so is a row that is not a person\'s', () => {
    expect(PersonChain.fold([mint, row(2, { kind: 'FLEW' })], uid)).toMatch(/not something a person does/);
    expect(PersonChain.fold([mint, row(2, { kind: 'MET', with: 'g' })], uid)).toMatch(/with whom and how/);
    expect(PersonChain.fold([mint, row(2, { kind: 'FED', from: 'x', paid: true, day: 1 }, 'GOLD_DELTA')], uid)).toMatch(/not a person's row/);
  });
});
