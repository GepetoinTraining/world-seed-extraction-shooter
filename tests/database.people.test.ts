/**
 * A CITY'S PEOPLE ON THE HUB (Pedro, 2026-11-06): "the npc needs to be minted as a world entity for
 * the hub under the hubs chain, that will allow you to track them deterministically from their table
 * in the hub and resolve the chain of actions they produce." And 2026-11-07: "Yes, mint on the hub's".
 * Test lines, stated plainly:
 *   - a person is minted on their city's own chain; the hub signs each mint with its own clock, and
 *     the person stands in the city's table from then
 *   - what they do goes on their own chain, whose first act names the link of their mint row, checked
 *     by the person's law and folded into the table
 *   - a person whose mint the hub does not hold is refused, even when their chain is sound
 *   - a row is signed by a character of the account that sends it, and names the chain it is on
 *   - two browsers writing one chain at once: the chain the hub held first stands
 *   - one chain that breaks the law holds back only itself
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqlStore } from '../shared/SqlStore';
import { openStore } from '../server/openStore';
import { Hub } from '../server/hub/Hub';
import { makeHubKey, verifyStatement } from '../server/hub/keys';
import { signedText } from '../shared/entities/identity/signedText';
import { addressOf } from '../shared/logic/time/RadixClock';
import { linkOf, ROW_VERSION } from '../shared/logic/ledger/chainLaw';
import { PersonChain } from '../shared/logic/people/PersonChain';

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
type Character = Awaited<ReturnType<typeof makeCharacter>>;

/** Any chain as a browser writes it: each row signed by whoever computed it, linked to the one before. */
function chainOf(uid: string) {
  let seq = 0;
  let last: string | null = null;
  return {
    uid,
    next: async (signer: Character, data: Record<string, unknown>, ts: number) => {
      seq++;
      const prev = last ? linkOf(last) : null;
      const row = await signer.sign({ seq, prevSeq: seq - 1, ts, type: 'PERSON', data, v: ROW_VERSION, prev, clock: { ...addressOf(ts), by: 'machine' } }, ts);
      last = row.signature;
      return row;
    }
  };
}

/** A city's own chain of mints. */
function cityChain(city: string) {
  const c = chainOf(PersonChain.hubUidOf(city));
  return {
    uid: c.uid,
    mint: (signer: Character, npcId: string, ts: number, over: Record<string, unknown> = {}) =>
      c.next(signer, { hub: c.uid, person: PersonChain.uidOf(city, npcId), kind: 'MINTED', hubId: city, npcId, as: 'keeper', name: 'Mags', origin: `keeper:${npcId}`, ...over }, ts)
  };
}

/** A person's own chain: its first act names the link of their mint row. */
function personChain(city: string, npcId: string) {
  const c = chainOf(PersonChain.uidOf(city, npcId));
  let first = true;
  return {
    uid: c.uid,
    act: (signer: Character, mintRow: { signature: string } | null, data: Record<string, unknown>, ts: number) => {
      const named = first && mintRow ? { mint: linkOf(mintRow.signature) } : {};
      first = false;
      return c.next(signer, { person: c.uid, ...data, ...named }, ts);
    }
  };
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

  it('a mint on the city\'s chain is held, signed by the hub with its own clock and where it sits, and the person stands in the table', async () => {
    const token = await account();
    const me = await character(token, 'ws_aaaaaaaa_x1_bbbbbbbb');
    const city = cityChain(CITY);
    const magsRow = await city.mint(me, 'npc_bartender', clock - 10);
    const bobRow = await city.mint(me, 'res_seed_bob', clock - 9, { as: 'resident', name: 'Bob' });
    const out = await hub.checkPeople(token, [{ uid: city.uid, rows: [magsRow, bobRow] }]);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const [answer] = out.people;
    expect(answer).toMatchObject({ uid: city.uid, ok: true, held: 2 });
    expect(answer.minted!.map(m => m.uid)).toEqual([PersonChain.uidOf(CITY, 'npc_bartender'), PersonChain.uidOf(CITY, 'res_seed_bob')]);
    const { mint } = answer.minted![0];
    expect(verifyStatement(key.publicKeyPem, mint.text, mint.signature)).toBe(true);
    expect(JSON.parse(mint.text)).toMatchObject({ kind: 'worldseed-person-minted', uid: PersonChain.uidOf(CITY, 'npc_bartender'), city: CITY, npcId: 'npc_bartender', chain: city.uid, seq: 1, link: linkOf(magsRow.signature), at: clock });
    // In the table before they have done anything, in the order the city's chain minted them
    const table = await hub.peopleOf(token, CITY);
    expect(table.ok && table.people.map(p => [p.record.npcId, p.record.seq])).toEqual([['npc_bartender', 0], ['res_seed_bob', 0]]);
  });

  it('what they did is folded into their row of the table, the first act naming their mint, and the mint stays the one first signed', async () => {
    const token = await account();
    const me = await character(token, 'ws_aaaaaaaa_x1_bbbbbbbb');
    const city = cityChain(CITY);
    const bobMint = await city.mint(me, 'res_seed_bob', clock - 30, { as: 'resident', name: 'Bob' });
    const bob = personChain(CITY, 'res_seed_bob');
    const rows = [
      await bob.act(me, bobMint, { kind: 'FED', from: 'npc_bartender', paid: true, day: 1 }, clock - 20),
      await bob.act(me, bobMint, { kind: 'MET', with: 'res_seed_glenda', where: 'by the tavern', why: 'waiting', band: 'lands', usual: false }, clock - 19),
      await bob.act(me, bobMint, { kind: 'MET', with: 'res_seed_glenda', where: 'by the tavern', why: 'waiting', band: 'lands', usual: true }, clock - 18),
      await bob.act(me, bobMint, { kind: 'PROMISED', key: 'q_1' }, clock - 17)
    ];
    // One send carries both: the city's chain is checked first, so Bob's mint is held before his chain
    const out = await hub.checkPeople(token, [{ uid: bob.uid, rows }, { uid: city.uid, rows: [bobMint] }]);
    expect(out.ok && out.people.map(p => [p.uid, p.ok, p.held])).toEqual([[bob.uid, true, 4], [city.uid, true, 1]]);
    const record = out.ok ? out.people[0].record! : null;
    expect(record!.fed).toMatchObject({ paid: 1, without: 0, lastDay: 1 });
    expect(record!.met.res_seed_glenda).toEqual({ times: 2, band: 'lands', usual: 1 });
    expect(record!.open).toEqual(['q_1']);
    expect(record!.mint).toBe(linkOf(bobMint.signature));
    expect(out.ok && out.people[0].mint).toEqual(out.ok && out.people[1].minted![0].mint);
  });

  it('a person whose mint is not on the city\'s chain is refused, and so is a first act naming another mint', async () => {
    const token = await account();
    const me = await character(token, 'ws_aaaaaaaa_x1_bbbbbbbb');
    const a = personChain(CITY, 'npc_a');
    const unminted = await hub.checkPeople(token, [{ uid: a.uid, rows: [await a.act(me, { signature: 'nothing' }, { kind: 'FED', from: 'x', paid: true, day: 1 }, clock - 5)] }]);
    expect(unminted.ok && unminted.people[0]).toMatchObject({ ok: false, held: 0 });
    expect(unminted.ok && unminted.people[0].reason).toMatch(/not on the hub's chain/);

    const city = cityChain(CITY);
    const aMint = await city.mint(me, 'npc_a', clock - 6);
    const bMint = await city.mint(me, 'npc_b', clock - 6);
    expect((await hub.checkPeople(token, [{ uid: city.uid, rows: [aMint, bMint] }])).ok).toBe(true);
    const lifted = personChain(CITY, 'npc_a');
    const wrong = await hub.checkPeople(token, [{ uid: lifted.uid, rows: [await lifted.act(me, bMint, { kind: 'FED', from: 'x', paid: true, day: 1 }, clock - 5)] }]);
    expect(wrong.ok && wrong.people[0].reason).toMatch(/names their mint/);
  });

  it('the city\'s chain mints only its own people, once each, and a person\'s row lifted onto another\'s chain is refused', async () => {
    const token = await account();
    const me = await character(token, 'ws_aaaaaaaa_x1_bbbbbbbb');
    const city = cityChain(CITY);
    const elsewhere = await hub.checkPeople(token, [{ uid: city.uid, rows: [await city.mint(me, 'npc_b', clock - 5, { hubId: 'another_city', person: PersonChain.uidOf('another_city', 'npc_b') })] }]);
    expect(elsewhere.ok && elsewhere.people[0].reason).toMatch(/another city/);

    const fresh = cityChain(CITY);
    const once = await fresh.mint(me, 'npc_c', clock - 5);
    const twice = await fresh.mint(me, 'npc_c', clock - 4);
    const again = await hub.checkPeople(token, [{ uid: fresh.uid, rows: [once, twice] }]);
    expect(again.ok && again.people[0]).toMatchObject({ ok: false, held: 0 });
    expect(again.ok && again.people[0].reason).toMatch(/already minted/);

    // c and d both minted in another city; c's first act sent as d's chain
    const TWO = 'hub_city_two';
    const two = cityChain(TWO);
    const cMint = await two.mint(me, 'npc_c', clock - 4);
    const dMint = await two.mint(me, 'npc_d', clock - 4);
    const row = await personChain(TWO, 'npc_c').act(me, cMint, { kind: 'FED', from: 'x', paid: true, day: 1 }, clock - 3);
    const moved = await hub.checkPeople(token, [{ uid: two.uid, rows: [cMint, dMint] }, { uid: PersonChain.uidOf(TWO, 'npc_d'), rows: [row] }]);
    expect(moved.ok && moved.people.map(p => p.ok)).toEqual([true, false]);
    expect(moved.ok && moved.people[1].reason).toMatch(/another person's chain/);
  });

  it('a row signed by a character another account holds is not this account\'s to send', async () => {
    const mine = await account('tester');
    const theirs = await account('someone');
    const them = await character(theirs, 'ws_cccccccc_x1_dddddddd');
    const city = cityChain(CITY);
    const out = await hub.checkPeople(mine, [{ uid: city.uid, rows: [await city.mint(them, 'npc_bartender', clock - 5)] }]);
    expect(out.ok && out.people[0]).toMatchObject({ ok: false });
    expect(out.ok && out.people[0].reason).toMatch(/does not hold here/);
  });

  it('two browsers write the city\'s chain at once: the chain held first stands, and the other is told to read it back', async () => {
    const token = await account();
    const me = await character(token, 'ws_aaaaaaaa_x1_bbbbbbbb');
    const other = await character(token, 'ws_eeeeeeee_x1_ffffffff');
    const one = cityChain(CITY);
    const two = cityChain(CITY);
    expect((await hub.checkPeople(token, [{ uid: one.uid, rows: [await one.mint(me, 'npc_bartender', clock - 9)] }])).ok).toBe(true);
    const out = await hub.checkPeople(token, [{ uid: two.uid, rows: [await two.mint(other, 'npc_bartender', clock - 8)] }]);
    expect(out.ok && out.people[0]).toMatchObject({ ok: false, held: 1 });
    expect(out.ok && out.people[0].reason).toMatch(/read it back from seq 1/);
  });

  it('one chain that breaks the law holds back only itself', async () => {
    const token = await account();
    const me = await character(token, 'ws_aaaaaaaa_x1_bbbbbbbb');
    const city = cityChain(CITY);
    const goodMint = await city.mint(me, 'npc_good', clock - 6);
    const badMint = await city.mint(me, 'npc_bad', clock - 6);
    const good = personChain(CITY, 'npc_good');
    const bad = personChain(CITY, 'npc_bad');
    const out = await hub.checkPeople(token, [
      { uid: city.uid, rows: [goodMint, badMint] },
      { uid: bad.uid, rows: [await bad.act(me, badMint, { kind: 'FED', from: 'x', paid: true, day: 1 }, clock - 5), await bad.act(me, null, { kind: 'MINTED', hubId: CITY, npcId: 'npc_bad', as: 'keeper', name: 'Again', origin: '' }, clock - 4)] },
      { uid: good.uid, rows: [await good.act(me, goodMint, { kind: 'FED', from: 'x', paid: true, day: 1 }, clock - 5)] }
    ]);
    expect(out.ok && out.people.map(p => p.ok)).toEqual([true, false, true]);
    const table = await hub.peopleOf(token, CITY);
    expect(table.ok && table.people.map(p => [p.record.npcId, p.record.seq])).toEqual([['npc_good', 1], ['npc_bad', 0]]);
  });
});
