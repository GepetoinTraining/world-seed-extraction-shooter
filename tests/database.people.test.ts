/**
 * A CITY'S PEOPLE ON THE HUB (Pedro, 2026-11-06): "the npc needs to be minted as a world entity for
 * the hub under the hubs chain, that will allow you to track them deterministically from their table
 * in the hub and resolve the chain of actions they produce." Test lines, stated plainly:
 *   - a person's chain starts with their mint, which the hub signs with its own clock
 *   - every row after it is something they did, checked by the person's law and folded into the
 *     hub's table of people
 *   - a row is signed by a character of the account that sends it, and names the chain it is on
 *   - two browsers writing one person at once: the chain the hub held first stands
 *   - one chain that breaks the law holds back only itself
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqlStore } from '../server/SqlStore';
import { openStore } from '../server/openStore';
import { Hub } from '../server/hub/Hub';
import { makeHubKey, verifyStatement } from '../server/hub/keys';
import { signedText } from '../src/entities/identity/signedText';
import { addressOf } from '../src/logic/time/RadixClock';
import { linkOf, ROW_VERSION } from '../src/logic/ledger/chainLaw';
import { PersonChain } from '../src/logic/people/PersonChain';

const ALGORITHM = { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' };
const b64 = (bytes: ArrayBuffer) => Buffer.from(bytes).toString('base64');
const CITY = 'hub_city_one';

async function makeCharacter(uid: string) {
  const pair = await crypto.subtle.generateKey(ALGORITHM, true, ['sign', 'verify']) as CryptoKeyPair;
  const publicKeyJWK = await crypto.subtle.exportKey('jwk', pair.publicKey);
  const sign = async <T>(payload: T, timestamp: number) => ({
    payload,
    signature: b64(await crypto.subtle.sign(ALGORITHM.name, pair.privateKey, new TextEncoder().encode(signedText(payload, timestamp)))),
    certUid: uid,
    timestamp
  });
  return { uid, certificate: { metadata: { uid, displayName: 'TESTER', createdAt: 1 }, publicKeyJWK }, sign };
}

/** A person's chain as a browser writes it: each row signed by whoever computed it, linked to the one before. */
function personChain(city: string, npcId: string) {
  const uid = PersonChain.uidOf(city, npcId);
  let seq = 0;
  let last: string | null = null;
  const next = async (signer: Awaited<ReturnType<typeof makeCharacter>>, data: Record<string, unknown>, ts: number) => {
    seq++;
    const prev = last ? linkOf(last) : null;
    const row = await signer.sign({ seq, prevSeq: seq - 1, ts, type: 'PERSON', data: { person: uid, ...data }, v: ROW_VERSION, prev, clock: { ...addressOf(ts), by: 'machine' } }, ts);
    last = row.signature;
    return row;
  };
  return { uid, next, mint: (signer: Awaited<ReturnType<typeof makeCharacter>>, ts: number, over: Record<string, unknown> = {}) => next(signer, { kind: 'MINTED', hubId: city, npcId, as: 'keeper', name: 'Mags', origin: `keeper:${npcId}`, ...over }, ts) };
}

describe('a city\'s people on the hub', () => {
  let store: SqlStore;
  let hub: Hub;
  const clock = 1_800_000_000_000;
  const key = makeHubKey();

  beforeEach(async () => {
    store = await openStore('pglite://memory');
    hub = new Hub(store, key, { publicUrl: 'https://hub.test', now: () => clock });
  });
  afterEach(async () => { await store.close(); });

  const account = async (handle = 'tester') => {
    expect((await hub.createAccount(handle, 'correct horse battery')).ok).toBe(true);
    const session = await hub.signIn(handle, 'correct horse battery');
    if (!session.ok) throw new Error(session.reason);
    return session.token;
  };
  const character = async (token: string, uid: string) => {
    const c = await makeCharacter(uid);
    const nonce = await hub.nonce(token);
    if (!nonce.ok) throw new Error(nonce.reason);
    const proof = await c.sign({ claim: 'hub-character', hub: key.id, nonce: nonce.nonce }, clock);
    expect((await hub.registerCharacter(token, c.certificate, proof)).ok).toBe(true);
    return c;
  };

  it('a mint is held, signed by the hub with its own clock, and the person stands in the city\'s table', async () => {
    const token = await account();
    const me = await character(token, 'ws_aaaaaaaa_x1_bbbbbbbb');
    const mags = personChain(CITY, 'npc_bartender');
    const out = await hub.checkPeople(token, [{ uid: mags.uid, rows: [await mags.mint(me, clock - 10)] }]);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const [answer] = out.people;
    expect(answer).toMatchObject({ uid: mags.uid, ok: true, held: 1 });
    expect(answer.record).toMatchObject({ npcId: 'npc_bartender', hubId: CITY, as: 'keeper', name: 'Mags' });
    expect(verifyStatement(key.publicKeyPem, answer.mint!.text, answer.mint!.signature)).toBe(true);
    expect(JSON.parse(answer.mint!.text)).toMatchObject({ kind: 'worldseed-person-minted', uid: mags.uid, city: CITY, npcId: 'npc_bartender', at: clock });
    const table = await hub.peopleOf(token, CITY);
    expect(table.ok && table.people.map(p => p.record.npcId)).toEqual(['npc_bartender']);
  });

  it('what they did is folded into their row of the table, and the mint stays the one first signed', async () => {
    const token = await account();
    const me = await character(token, 'ws_aaaaaaaa_x1_bbbbbbbb');
    const bob = personChain(CITY, 'res_seed_bob');
    const first = await hub.checkPeople(token, [{ uid: bob.uid, rows: [await bob.mint(me, clock - 30, { as: 'resident', name: 'Bob' })] }]);
    const mint = first.ok ? first.people[0].mint : undefined;
    const rows = [
      await bob.next(me, { kind: 'FED', from: 'npc_bartender', paid: true, day: 1 }, clock - 20),
      await bob.next(me, { kind: 'MET', with: 'res_seed_glenda', where: 'by the tavern', why: 'waiting', band: 'lands', usual: false }, clock - 19),
      await bob.next(me, { kind: 'MET', with: 'res_seed_glenda', where: 'by the tavern', why: 'waiting', band: 'lands', usual: true }, clock - 18),
      await bob.next(me, { kind: 'PROMISED', key: 'q_1' }, clock - 17)
    ];
    const out = await hub.checkPeople(token, [{ uid: bob.uid, rows }]);
    expect(out.ok && out.people[0]).toMatchObject({ ok: true, held: 5 });
    const record = out.ok ? out.people[0].record! : null;
    expect(record!.fed).toMatchObject({ paid: 1, without: 0, lastDay: 1 });
    expect(record!.met.res_seed_glenda).toEqual({ times: 2, band: 'lands', usual: 1 });
    expect(record!.open).toEqual(['q_1']);
    expect(out.ok && out.people[0].mint).toEqual(mint);
  });

  it('a chain that does not start with its mint, a mint of another chain, or a row naming another person is refused, and nothing of it is held', async () => {
    const token = await account();
    const me = await character(token, 'ws_aaaaaaaa_x1_bbbbbbbb');
    const a = personChain(CITY, 'npc_a');
    const notMinted = await hub.checkPeople(token, [{ uid: a.uid, rows: [await a.next(me, { kind: 'FED', from: 'x', paid: true, day: 1 }, clock - 5)] }]);
    expect(notMinted.ok && notMinted.people[0]).toMatchObject({ ok: false, held: 0 });

    const b = personChain(CITY, 'npc_b');
    const elsewhere = await hub.checkPeople(token, [{ uid: b.uid, rows: [await b.mint(me, clock - 5, { hubId: 'another_city' })] }]);
    expect(elsewhere.ok && elsewhere.people[0].reason).toMatch(/not of this chain/);

    const c = personChain(CITY, 'npc_c');
    const lifted = await c.mint(me, clock - 5);
    const onto = PersonChain.uidOf(CITY, 'npc_d');
    const moved = await hub.checkPeople(token, [{ uid: onto, rows: [lifted] }]);
    expect(moved.ok && moved.people[0].reason).toMatch(/another person's chain/);
  });

  it('a row signed by a character another account holds is not this account\'s to send', async () => {
    const mine = await account('tester');
    const theirs = await account('someone');
    const them = await character(theirs, 'ws_cccccccc_x1_dddddddd');
    const p = personChain(CITY, 'npc_bartender');
    const out = await hub.checkPeople(mine, [{ uid: p.uid, rows: [await p.mint(them, clock - 5)] }]);
    expect(out.ok && out.people[0]).toMatchObject({ ok: false });
    expect(out.ok && out.people[0].reason).toMatch(/does not hold here/);
  });

  it('two browsers write one person at once: the chain held first stands, and the other is told to read it back', async () => {
    const token = await account();
    const me = await character(token, 'ws_aaaaaaaa_x1_bbbbbbbb');
    const other = await character(token, 'ws_eeeeeeee_x1_ffffffff');
    const one = personChain(CITY, 'npc_bartender');
    const two = personChain(CITY, 'npc_bartender');
    expect((await hub.checkPeople(token, [{ uid: one.uid, rows: [await one.mint(me, clock - 9)] }])).ok).toBe(true);
    const out = await hub.checkPeople(token, [{ uid: two.uid, rows: [await two.mint(other, clock - 8)] }]);
    expect(out.ok && out.people[0]).toMatchObject({ ok: false, held: 1 });
    expect(out.ok && out.people[0].reason).toMatch(/read it back from seq 1/);
  });

  it('one chain that breaks the law holds back only itself', async () => {
    const token = await account();
    const me = await character(token, 'ws_aaaaaaaa_x1_bbbbbbbb');
    const good = personChain(CITY, 'npc_good');
    const bad = personChain(CITY, 'npc_bad');
    const out = await hub.checkPeople(token, [
      { uid: bad.uid, rows: [await bad.mint(me, clock - 5), await bad.next(me, { kind: 'MINTED', hubId: CITY, npcId: 'npc_bad', as: 'keeper', name: 'Again', origin: '' }, clock - 4)] },
      { uid: good.uid, rows: [await good.mint(me, clock - 5)] }
    ]);
    expect(out.ok && out.people.map(p => p.ok)).toEqual([false, true]);
    const table = await hub.peopleOf(token, CITY);
    expect(table.ok && table.people.map(p => p.record.npcId)).toEqual(['npc_good']);
  });
});
