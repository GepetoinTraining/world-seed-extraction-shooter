// @vitest-environment node
/**
 * THE HUB, deployed (DEPLOY.md). It holds accounts and checks receipts; it runs nobody's play.
 * These bars stand on a store in memory and on characters whose keys are made here the way the
 * browser makes them, signing the same text (`signedText`), so a row the game signs is a row the
 * hub can check.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer, Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqlStore } from '../server/SqlStore';
import { openStore } from '../server/openStore';
import { Hub } from '../server/hub/Hub';
import { makeHubKey, verifyStatement } from '../server/hub/keys';
import { createHubHandler } from '../server/hub/http';
import { createHubListener } from '../server/hub/server';
import { createHubBridge } from '../server/runner';
import { createHubFunction, hubConfigFrom, hubPathOf } from '../server/hub/function';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { signedText } from '../src/entities/identity/signedText';
import { addressOf, dayIndexOf } from '../src/logic/time/RadixClock';
import { linkOf, ROW_VERSION } from '../src/logic/ledger/chainLaw';
import { FIRST_THEME_PACK, installShippedThemes } from '../src/logic/theme/boot';
import { sealLoot, lootItemsOf, LootLaw } from '../src/logic/theme/LootLaw';
import { ItemFactory } from '../src/entities/item/ItemFactory';
import { Rng } from '../src/logic/rng/DeterministicRNG';
import { bodyOf, compileTheme, sealTheme } from '../src/logic/theme/ThemeCompiler';

const ALGORITHM = { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' };
const b64 = (bytes: ArrayBuffer) => Buffer.from(bytes).toString('base64');

/** A character as the browser makes one: an RSA key, a certificate naming it, rows signed over `signedText`. */
async function makeCharacter(uid: string) {
  const pair = await crypto.subtle.generateKey(ALGORITHM, true, ['sign', 'verify']) as CryptoKeyPair;
  const publicKeyJWK = await crypto.subtle.exportKey('jwk', pair.publicKey);
  const sign = async <T>(payload: T, timestamp = Date.now()) => ({
    payload,
    signature: b64(await crypto.subtle.sign(ALGORITHM.name, pair.privateKey, new TextEncoder().encode(signedText(payload, timestamp)))),
    certUid: uid,
    timestamp
  });
  const certificate = { metadata: { uid, displayName: 'TESTER', createdAt: 1 }, publicKeyJWK };
  let seq = 0;
  const row = (type = 'GOLD_DELTA', data: Record<string, unknown> = { amount: 5 }) => {
    seq++;
    return sign({ seq, prevSeq: seq - 1, ts: 1_000 + seq, type, data });
  };
  /** A row in the newer form (D135): its moment's address, and the link to the row before it. */
  let lastSignature: string | null = null;
  const linked = async (ts: number, data: Record<string, unknown> = { amount: 5 }, type = 'GOLD_DELTA') => {
    seq++;
    const prev = lastSignature ? await linkOf(lastSignature) : null;
    const signed = await sign({ seq, prevSeq: seq - 1, ts, type, data, v: ROW_VERSION, prev, clock: { ...addressOf(ts), by: 'machine' } }, ts);
    lastSignature = signed.signature;
    return signed;
  };
  return { uid, certificate, sign, row, linked };
}

describe('the hub', () => {
  let store: SqlStore;
  let hub: Hub;
  let clock: number;
  const key = makeHubKey();

  beforeEach(async () => {
    store = await openStore('pglite://memory');
    clock = 1_800_000_000_000;
    hub = new Hub(store, key, { publicUrl: 'https://hub.test', now: () => clock });
  });
  afterEach(async () => { await store.close(); });

  const signedIn = async (handle = 'tester', password = 'correct horse battery') => {
    expect((await hub.createAccount(handle, password)).ok).toBe(true);
    const session = await hub.signIn(handle, password);
    if (!session.ok) throw new Error(session.reason);
    return session.token;
  };

  const registered = async (token: string, uid = 'ws_aaaaaaaa_x1_bbbbbbbb') => {
    const character = await makeCharacter(uid);
    const nonce = await hub.nonce(token);
    if (!nonce.ok) throw new Error(nonce.reason);
    const proof = await character.sign({ claim: 'hub-character', hub: key.id, nonce: nonce.nonce });
    const out = await hub.registerCharacter(token, character.certificate, proof);
    return { character, out };
  };

  describe('accounts', () => {
    it('an account is made once, and a handle is the same handle in any case', async () => {
      expect(await hub.createAccount('Tester', 'correct horse battery')).toMatchObject({ ok: true, account: { handle: 'Tester' } });
      expect(await hub.createAccount('tester', 'another long password')).toMatchObject({ ok: false, status: 409 });
      expect(await hub.createAccount('TESTER', 'another long password')).toMatchObject({ ok: false, status: 409 });
    });

    it('a handle with no letters, or a password too short to stand, is refused with a reason', async () => {
      expect(await hub.createAccount('  ', 'correct horse battery')).toMatchObject({ ok: false, status: 400 });
      expect(await hub.createAccount('has space', 'correct horse battery')).toMatchObject({ ok: false, status: 400 });
      const short = await hub.createAccount('tester', 'short');
      expect(short).toMatchObject({ ok: false, status: 400 });
      expect(short.ok ? '' : short.reason).toMatch(/password/i);
    });

    it('a password is never kept as written', async () => {
      await hub.createAccount('tester', 'correct horse battery');
      const docs = await store.query({ namespace: 'hub' });
      expect(docs.length).toBeGreaterThan(0);
      for (const d of docs) expect(d.dataText).not.toContain('correct horse battery');
    });

    it('signing in answers a token that names the account; a wrong password or an unknown handle answers nothing', async () => {
      const token = await signedIn();
      expect(token.length).toBeGreaterThanOrEqual(32);
      expect(await hub.session(token)).toMatchObject({ handle: 'tester' });
      expect(await hub.signIn('tester', 'wrong password here')).toMatchObject({ ok: false, status: 401 });
      expect(await hub.signIn('nobody', 'correct horse battery')).toMatchObject({ ok: false, status: 401 });
      expect(await hub.session('not-a-token')).toBeNull();
    });

    it('a token is never kept as written either', async () => {
      const token = await signedIn();
      for (const d of await store.query({ namespace: 'hub' })) {
        expect(d.dataText).not.toContain(token);
        expect(d.id).not.toContain(token);
      }
    });

    it('signing out ends the session', async () => {
      const token = await signedIn();
      await hub.signOut(token);
      expect(await hub.session(token)).toBeNull();
    });

    it('after repeated wrong passwords a handle waits, even for the right one, and then signs in', async () => {
      await hub.createAccount('tester', 'correct horse battery');
      for (let i = 0; i < 5; i++) await hub.signIn('tester', `wrong ${i} attempt`);
      const held = await hub.signIn('tester', 'correct horse battery');
      expect(held).toMatchObject({ ok: false, status: 429 });
      clock += 60 * 60_000;
      expect((await hub.signIn('tester', 'correct horse battery')).ok).toBe(true);
    });
  });

  describe('characters', () => {
    it('a character is registered with a proof its own key signed, and the statement verifies with the hub\'s key', async () => {
      const token = await signedIn();
      const { out } = await registered(token);
      expect(out.ok).toBe(true);
      if (!out.ok) return;
      expect(verifyStatement(key.publicKeyPem, out.issued.text, out.issued.signature)).toBe(true);
      const said = JSON.parse(out.issued.text);
      expect(said).toMatchObject({ kind: 'worldseed-hub-character', hub: key.id, issuer: 'https://hub.test', uid: 'ws_aaaaaaaa_x1_bbbbbbbb', account: 'tester', at: clock });
      expect(verifyStatement(key.publicKeyPem, out.issued.text.replace('tester', 'someone'), out.issued.signature)).toBe(false);
      expect(await hub.characters(token)).toMatchObject({ ok: true, characters: [{ uid: 'ws_aaaaaaaa_x1_bbbbbbbb', held: 0, standing: 'GOOD' }] });
    });

    it('another account cannot take a character that is held', async () => {
      const first = await signedIn('first');
      const { character } = await registered(first);
      const second = await signedIn('second');
      const nonce = await hub.nonce(second);
      if (!nonce.ok) throw new Error(nonce.reason);
      const proof = await character.sign({ claim: 'hub-character', hub: key.id, nonce: nonce.nonce });
      expect(await hub.registerCharacter(second, character.certificate, proof)).toMatchObject({ ok: false, status: 409 });
    });

    it('a proof signed by another key, over a nonce that was not given, or given twice, is refused', async () => {
      const token = await signedIn();
      const character = await makeCharacter('ws_cccccccc_x1_dddddddd');
      const other = await makeCharacter('ws_cccccccc_x1_dddddddd');

      const n1 = await hub.nonce(token);
      if (!n1.ok) throw new Error(n1.reason);
      expect(await hub.registerCharacter(token, character.certificate, await other.sign({ claim: 'hub-character', hub: key.id, nonce: n1.nonce }))).toMatchObject({ ok: false, status: 400 });

      expect(await hub.registerCharacter(token, character.certificate, await character.sign({ claim: 'hub-character', hub: key.id, nonce: 'made-up' }))).toMatchObject({ ok: false, status: 400 });

      const n2 = await hub.nonce(token);
      if (!n2.ok) throw new Error(n2.reason);
      const proof = await character.sign({ claim: 'hub-character', hub: key.id, nonce: n2.nonce });
      expect((await hub.registerCharacter(token, character.certificate, proof)).ok).toBe(true);
      const again = await makeCharacter('ws_eeeeeeee_x1_ffffffff');
      expect(await hub.registerCharacter(token, again.certificate, await again.sign({ claim: 'hub-character', hub: key.id, nonce: n2.nonce }))).toMatchObject({ ok: false, status: 400 });
    });

    it('a nonce one account was given does not serve another', async () => {
      const first = await signedIn('first');
      const second = await signedIn('second');
      const character = await makeCharacter('ws_cccccccc_x1_dddddddd');
      const nonce = await hub.nonce(first);
      if (!nonce.ok) throw new Error(nonce.reason);
      expect(await hub.registerCharacter(second, character.certificate, await character.sign({ claim: 'hub-character', hub: key.id, nonce: nonce.nonce }))).toMatchObject({ ok: false, status: 400 });
    });
  });

  describe('receipts', () => {
    it('signed rows are checked and held, and the acknowledgement names the seq and the head, signed with the hub\'s time', async () => {
      const token = await signedIn();
      const { character } = await registered(token);
      const rows = [await character.row('CHARACTER_GENESIS', {}), await character.row(), await character.row()];
      const out = await hub.checkReceipts(token, character.uid, rows);
      expect(out).toMatchObject({ ok: true, held: 3, standing: 'GOOD' });
      if (!out.ok) return;
      expect(verifyStatement(key.publicKeyPem, out.ack.text, out.ack.signature)).toBe(true);
      expect(JSON.parse(out.ack.text)).toMatchObject({ kind: 'worldseed-hub-receipt', hub: key.id, uid: character.uid, seq: 3, at: clock });
      expect(JSON.parse(out.ack.text).head).toMatch(/^[0-9a-f]{64}$/);
      expect(await hub.record(token, character.uid)).toMatchObject({ ok: true, held: 3, standing: 'GOOD', head: JSON.parse(out.ack.text).head });
    });

    it('sending the same rows again holds nothing twice, and more rows go on from the head', async () => {
      const token = await signedIn();
      const { character } = await registered(token);
      const first = [await character.row(), await character.row()];
      await hub.checkReceipts(token, character.uid, first);
      const more = [await character.row()];
      expect(await hub.checkReceipts(token, character.uid, [...first, ...more])).toMatchObject({ ok: true, held: 3 });
      expect(await hub.checkReceipts(token, character.uid, first)).toMatchObject({ ok: true, held: 3 });
    });

    it('a row with a bad signature is refused, and nothing in its batch is held', async () => {
      const token = await signedIn();
      const { character } = await registered(token);
      const good = await character.row();
      const bad = await character.row();
      bad.payload.data = { amount: 5000 };
      expect(await hub.checkReceipts(token, character.uid, [good, bad])).toMatchObject({ ok: false, status: 400 });
      expect(await hub.record(token, character.uid)).toMatchObject({ ok: true, held: 0 });
    });

    it('a row signed by another key is refused', async () => {
      const token = await signedIn();
      const { character } = await registered(token);
      const stranger = await makeCharacter(character.uid);
      expect(await hub.checkReceipts(token, character.uid, [await stranger.row()])).toMatchObject({ ok: false, status: 400 });
    });

    it('a gap is refused, and says where the hub stands', async () => {
      const token = await signedIn();
      const { character } = await registered(token);
      await character.row();
      const out = await hub.checkReceipts(token, character.uid, [await character.row()]);
      expect(out).toMatchObject({ ok: false, status: 409, held: 0 });
    });

    it('a rewritten row at a held seq is a challenge: the first chain stands, and the standing says so', async () => {
      const token = await signedIn();
      const { character } = await registered(token);
      const one = await character.row();
      const two = await character.row();
      await hub.checkReceipts(token, character.uid, [one, two]);

      // The same key signs a different row two: the person rewrote their own history.
      const rewritten = await character.sign({ ...two.payload, data: { amount: 9999 } });
      const out = await hub.checkReceipts(token, character.uid, [one, rewritten]);
      expect(out).toMatchObject({ ok: false, status: 409, challenge: { seq: 2 }, standing: 'CHALLENGED' });

      const record = await hub.record(token, character.uid);
      expect(record).toMatchObject({ ok: true, held: 2, standing: 'CHALLENGED' });
      const heldTwo = await store.get(`ledger_${character.uid}_00000002`);
      expect(JSON.parse(heldTwo!.dataText).payload.data).toEqual({ amount: 5 });
    });

    it('receipts for a character another account holds are refused', async () => {
      const first = await signedIn('first');
      const { character } = await registered(first);
      const second = await signedIn('second');
      expect(await hub.checkReceipts(second, character.uid, [await character.row()])).toMatchObject({ ok: false, status: 403 });
      expect(await hub.record(second, character.uid)).toMatchObject({ ok: false, status: 403 });
    });

    it('nothing is asked of a signed-out caller', async () => {
      expect(await hub.nonce('not-a-token')).toMatchObject({ ok: false, status: 401 });
      expect(await hub.characters('not-a-token')).toMatchObject({ ok: false, status: 401 });
      expect(await hub.checkReceipts('not-a-token', 'ws_x', [])).toMatchObject({ ok: false, status: 401 });
    });
  });

  describe('stateless: every call could be a different function instance over one store', () => {
    it('a text one instance gave for a proof is honoured by another, and only once', async () => {
      const token = await signedIn();
      const other = new Hub(store, key, { publicUrl: 'https://hub.test', now: () => clock });
      const character = await makeCharacter('ws_99999999_x1_88888888');
      const nonce = await hub.nonce(token);
      if (!nonce.ok) throw new Error(nonce.reason);
      const proof = await character.sign({ claim: 'hub-character', hub: key.id, nonce: nonce.nonce });
      expect((await other.registerCharacter(token, character.certificate, proof)).ok).toBe(true);
      const second = await makeCharacter('ws_77777777_x1_66666666');
      expect(await hub.registerCharacter(token, second.certificate, await second.sign({ claim: 'hub-character', hub: key.id, nonce: nonce.nonce }))).toMatchObject({ ok: false, status: 400 });
    });

    it('a text past its time is refused, wherever it was given', async () => {
      const token = await signedIn();
      const character = await makeCharacter('ws_99999999_x1_88888888');
      const nonce = await hub.nonce(token);
      if (!nonce.ok) throw new Error(nonce.reason);
      clock += 11 * 60_000;
      const later = new Hub(store, key, { publicUrl: 'https://hub.test', now: () => clock });
      const proof = await character.sign({ claim: 'hub-character', hub: key.id, nonce: nonce.nonce });
      expect(await later.registerCharacter(token, character.certificate, proof)).toMatchObject({ ok: false, status: 400 });
    });

    it('wrong passwords counted by one instance hold on another', async () => {
      await hub.createAccount('tester', 'correct horse battery');
      for (let i = 0; i < 5; i++) await new Hub(store, key, { publicUrl: 'https://hub.test', now: () => clock }).signIn('tester', `wrong ${i} attempt`);
      expect(await new Hub(store, key, { publicUrl: 'https://hub.test', now: () => clock }).signIn('tester', 'correct horse battery')).toMatchObject({ ok: false, status: 429 });
    });
  });

  describe('the world manifest check (Pedro, 2026-11-04)', () => {
    const shipped = () => FIRST_THEME_PACK;
    const variant = (name: string) => sealTheme({ ...bodyOf(FIRST_THEME_PACK), name }, 'test', 1);
    const firstKind = () => {
      const compiled = compileTheme(FIRST_THEME_PACK);
      const kind = Object.keys(compiled.mobs)[0];
      return { kind, worldSeed: 'seed_test', themeId: FIRST_THEME_PACK.themeId, nodes: [], roots: [kind], def: JSON.parse(JSON.stringify(compiled.mobs[kind])) };
    };
    const worldOf = (uid: string, themeId = FIRST_THEME_PACK.themeId, worldUid = 'world_check_1') => ({ worldUid, creatorCertUid: uid, themeId });

    it('what already exists passes, and the answer is signed by the hub', async () => {
      const token = await signedIn();
      const { character } = await registered(token);
      const out = await hub.checkWorld(token, { world: worldOf(character.uid), themes: [shipped()], kinds: [firstKind()] });
      expect(out).toMatchObject({ ok: true, themes: { known: [FIRST_THEME_PACK.themeId], accepted: [], refused: [] }, diff: [] });
      if (!out.ok) return;
      expect(verifyStatement(key.publicKeyPem, out.ack.text, out.ack.signature)).toBe(true);
      expect(JSON.parse(out.ack.text)).toMatchObject({ kind: 'worldseed-hub-world', hub: key.id, world: 'world_check_1', themeId: FIRST_THEME_PACK.themeId, at: clock });
    });

    it('a new theme that keeps the law is accepted, and is known from then on, to every instance', async () => {
      const token = await signedIn();
      const { character } = await registered(token);
      const second = variant('A Second World, for the check');
      expect(await hub.checkWorld(token, { world: worldOf(character.uid, second.themeId), themes: [shipped(), second] })).toMatchObject({ ok: true, themes: { accepted: [second.themeId] } });
      const other = new Hub(store, key, { publicUrl: 'https://hub.test', now: () => clock });
      expect(await other.checkWorld(token, { world: worldOf(character.uid, second.themeId), themes: [second] })).toMatchObject({ ok: true, themes: { known: [second.themeId], accepted: [] } });
    });

    it('a theme whose id does not match its words, or that breaks the law, is refused with the reason', async () => {
      const token = await signedIn();
      const { character } = await registered(token);
      const forged = { ...variant('A Forged World'), name: 'Not what was sealed' };
      const lawless = sealTheme({ ...bodyOf(FIRST_THEME_PACK), name: 'A Lawless World', lore: [...FIRST_THEME_PACK.lore, 42 as any] }, 'test', 1);
      const out = await hub.checkWorld(token, { world: worldOf(character.uid), themes: [shipped(), forged, lawless] });
      expect(out).toMatchObject({ ok: false, status: 200 });
      const refused = (out as any).themes.refused;
      expect(refused.map((r: any) => r.themeId)).toEqual([forged.themeId, lawless.themeId]);
      expect(refused[0].reason).toMatch(/id does not match/);
      expect(refused[1].reason).toMatch(/number/);
    });

    it('a kind whose numbers are not what its line makes them comes back corrected, as a diff, never the whole load', async () => {
      const token = await signedIn();
      const { character } = await registered(token);
      const honest = firstKind();
      const inflated = { ...honest, def: { ...honest.def, baseHealth: (honest.def.baseHealth as number) * 10, baseDamage: (honest.def.baseDamage as number) + 99 } };
      const out = await hub.checkWorld(token, { world: worldOf(character.uid), themes: [shipped()], kinds: [inflated] });
      expect(out).toMatchObject({ ok: true });
      expect((out as any).diff).toEqual([
        { op: 'replace', path: '/kinds/0/def/baseHealth', value: honest.def.baseHealth },
        { op: 'replace', path: '/kinds/0/def/baseDamage', value: honest.def.baseDamage }
      ]);
      expect((out as any).kinds.corrected).toEqual([{ kind: honest.kind, def: honest.def }]);
    });

    it('loot tables (Pedro: "deterministic and only updated by LLM, checked"): a fair one is accepted and known after, wrong numbers come back as a diff, a forged one is refused', async () => {
      const token = await signedIn();
      const { character } = await registered(token);
      const fair = sealLoot(FIRST_THEME_PACK.themeId, { name: 'Pockets', source: 'creature', fits: ['humanoid'], lines: [{ what: 'material', item: '', odds: 'often', count: 'few', rank: 'same' }] });
      const greedy = sealLoot(FIRST_THEME_PACK.themeId, { name: 'Greedy', source: 'creature', fits: [], lines: [{ what: 'gear', item: '', odds: 'rarely', count: 'one', rank: 'same' }] });
      greedy.lines[0].chance = 1_000_000;
      const forged = { ...sealLoot(FIRST_THEME_PACK.themeId, { name: 'Forged', source: 'chest', fits: [], lines: [{ what: 'gear', item: '', odds: 'rarely', count: 'one', rank: 'same' }] }) };
      forged.lines = forged.lines.map(l => ({ ...l, odds: 'always' as const }));

      const out = await hub.checkWorld(token, { world: worldOf(character.uid), themes: [shipped()], loot: [fair, greedy, forged] }) as any;
      expect(out.ok).toBe(false);
      expect(out.loot.accepted).toEqual([fair.id]);
      expect(out.loot.corrected).toMatchObject([{ id: greedy.id, table: { lines: [{ chance: 5_000 }] } }]);
      expect(out.loot.refused).toEqual([{ id: forged.id, reason: 'Its id does not match its words.' }]);
      expect(out.diff).toEqual([{ op: 'replace', path: '/loot/1/lines/0/chance', value: 5_000 }]);

      const again = await hub.checkWorld(token, { world: worldOf(character.uid), themes: [shipped()], loot: [fair] }) as any;
      expect(again).toMatchObject({ ok: true, loot: { known: [fair.id], accepted: [] } });
    });

    it('an item is checked against what it was minted from: its power put right as a diff, one from nowhere refused, a made one said to be unchecked', async () => {
      const token = await signedIn();
      const { character } = await registered(token);
      installShippedThemes();
      const found = FIRST_THEME_PACK.gear.find(g => g.craftAt === 'none')!;
      const baseId = lootItemsOf(FIRST_THEME_PACK).gear.find(g => g.key === found.key)!.id;
      const honest = ItemFactory.createItem(found.rank as any, false, Rng.fromKey('hub:item:1'), undefined, baseId);
      const inflated = { ...honest, itemPower: honest.itemPower * 50, value: 1 };
      const nowhere = { ...honest, id: 'itm_nowhere', universalDefinitionId: 'wpn_nothing_here' };
      const made = { ...honest, id: 'itm_made', composition: { ...honest.composition!, steps: [{ recipeId: 'r', name: 'r', laborSeconds: 1, facility: null }] } };

      const out = await hub.checkWorld(token, { world: worldOf(character.uid), themes: [shipped()], items: [honest, inflated, nowhere, made] }) as any;
      expect(out.items.checked).toEqual([honest.id]);
      expect(out.items.corrected).toMatchObject([{ id: honest.id, item: { itemPower: honest.itemPower, value: honest.value } }]);
      expect(out.items.refused).toMatchObject([{ id: 'itm_nowhere' }]);
      expect(out.items.unchecked).toMatchObject([{ id: 'itm_made' }]);
      expect(out.diff).toEqual([
        { op: 'replace', path: '/items/1/itemPower', value: honest.itemPower },
        { op: 'replace', path: '/items/1/value', value: honest.value }
      ]);
    });

    it('a kind whose line does not prove itself cannot be corrected, and is refused', async () => {
      const token = await signedIn();
      const { character } = await registered(token);
      const gap = { ...firstKind(), roots: [] };
      expect(await hub.checkWorld(token, { world: worldOf(character.uid), themes: [shipped()], kinds: [gap] })).toMatchObject({ ok: false, kinds: { refused: [{ kind: gap.kind }] } });
    });

    it('a world belongs to a character of this account, and keeps the theme it was first checked with', async () => {
      const first = await signedIn('first');
      const { character } = await registered(first);
      const second = await signedIn('second');
      expect(await hub.checkWorld(second, { world: worldOf(character.uid), themes: [shipped()] })).toMatchObject({ ok: false, status: 403 });

      expect((await hub.checkWorld(first, { world: worldOf(character.uid), themes: [shipped()] })).ok).toBe(true);
      const moved = variant('A World Moved Under Its Feet');
      expect(await hub.checkWorld(first, { world: worldOf(character.uid, moved.themeId), themes: [shipped(), moved] })).toMatchObject({ ok: false, world: { reason: expect.stringMatching(/theme/) } });
    });
  });

  describe('the hub does the same arithmetic (D134)', () => {
    const sha = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
    const table = () => sealLoot(FIRST_THEME_PACK.themeId, { name: 'Pockets', source: 'creature', fits: ['humanoid'], lines: [{ what: 'material', item: '', odds: 'always', count: 'few', rank: 'same' }, { what: 'gear', item: '', odds: 'sometimes', count: 'one', rank: 'same' }] });
    const humanoid = () => {
      const mobs = compileTheme(FIRST_THEME_PACK).mobs;
      const [defId, def] = Object.entries(mobs).find(([, m]) => m.tags.includes('humanoid'))!;
      return { defId, rank: def.rank as string };
    };
    /** A session as the game seals one: its kills journaled with the table roll behind each drop. */
    const session = async (character: Awaited<ReturnType<typeof makeCharacter>>, sessionId: string, kills: { rank?: string; tamper?: (lines: any[]) => any[] }[]) => {
      const t = table();
      const { defId, rank } = humanoid();
      const items = lootItemsOf(FIRST_THEME_PACK);
      const actions = kills.map((k, i) => {
        const rollKey = `seed:${sessionId}:loot:mob_${i}`;
        const lines = LootLaw.roll(t, k.rank ?? rank, rollKey, items);
        return { seq: i + 1, t: i, type: 'KILL', data: { mobId: `mob_${i}`, defId, rollKey, drops: [], table: { table: t.id, rank: k.rank ?? rank, lines: k.tamper ? k.tamper(lines) : lines } } };
      });
      const receipt = await character.sign({ claim: { sessionId, worldCertUid: 'w', seed: 'seed', baseHash: 'b', certUid: character.uid, startedAt: 1 }, outcome: 'EXTRACTED', durationMs: 1, actionCount: actions.length, actions, endHash: 'e' }, clock - 120_000);
      return { receipt, table: t, data: { sessionId, worldCertUid: 'w', outcome: 'EXTRACTED', actionCount: actions.length, endHash: 'e', receiptHash: sha(receipt.signature) } };
    };

    it('the hub reads the gold its rows add up to, signs that reading, and a player\'s reading that does not fit challenges the character', async () => {
      const token = await signedIn();
      const { character } = await registered(token);
      const rows = [await character.linked(clock - 300_000, { gold: 500 }, 'CHARACTER_GENESIS'), await character.linked(clock - 200_000, { amount: 12.5 })];
      const out = await hub.checkReceipts(token, character.uid, rows, { reading: { seq: 2, gold: 512.5 } }) as any;
      expect(out).toMatchObject({ ok: true, held: 2, standing: 'GOOD', rerun: { gold: 512.5 } });
      expect(JSON.parse(out.ack.text)).toMatchObject({ gold: 512.5, seq: 2 });

      const third = await character.linked(clock - 100_000, { amount: -2.5 });
      const lie = await hub.checkReceipts(token, character.uid, [third], { reading: { seq: 3, gold: 9999 } }) as any;
      expect(lie).toMatchObject({ ok: false, status: 409, standing: 'CHALLENGED', held: 3, challenge: { kind: 'arithmetic', seq: 3 } });
      expect(lie.reason).toMatch(/510/);
      expect(await hub.record(token, character.uid)).toMatchObject({ ok: true, held: 3, standing: 'CHALLENGED' });
    });

    it('a session row is owed until its receipt comes; its drops are rolled again and pass when they land where the player\'s did', async () => {
      const token = await signedIn();
      const { character } = await registered(token);
      const s = await session(character, 'sess_1', [{}, {}, {}]);
      const first = await hub.checkReceipts(token, character.uid, [await character.linked(clock - 100_000, s.data, 'SESSION_RESULT')]) as any;
      expect(first).toMatchObject({ ok: true, rerun: { owed: 1, sessions: 0 } });

      const later = await hub.checkReceipts(token, character.uid, [], { sessions: [s.receipt], tables: [s.table] }) as any;
      expect(later).toMatchObject({ ok: true, standing: 'GOOD', rerun: { owed: 0, sessions: 1, rolls: 3, unchecked: 0 } });
    });

    it('a drop that does not land where the hub\'s rerun does, or a kill rolled at a rank its kind is not, challenges the character; the rows stay held', async () => {
      const token = await signedIn();
      const { character } = await registered(token);
      const forged = await session(character, 'sess_forged', [{}, { tamper: lines => [...lines, { ...lines[0] ?? { line: 0, what: 'material', key: 'x', id: 'x', rank: 'F' }, count: 99 }] }]);
      await hub.checkReceipts(token, character.uid, [await character.linked(clock - 100_000, forged.data, 'SESSION_RESULT')]);
      const out = await hub.checkReceipts(token, character.uid, [], { sessions: [forged.receipt], tables: [forged.table] }) as any;
      expect(out).toMatchObject({ ok: false, status: 409, standing: 'CHALLENGED', challenge: { kind: 'arithmetic', seq: 1 } });
      expect(out.reason).toMatch(/action 2/);

      const other = await signedIn('other');
      const { character: second } = await registered(other, 'ws_cccccccc_x1_dddddddd');
      const higher = await session(second, 'sess_rank', [{ rank: 'SSS' }]);
      await hub.checkReceipts(other, second.uid, [await second.linked(clock - 100_000, higher.data, 'SESSION_RESULT')]);
      expect(await hub.checkReceipts(other, second.uid, [], { sessions: [higher.receipt], tables: [higher.table] })).toMatchObject({ ok: false, status: 409, challenge: { why: expect.stringMatching(/rank/) } });
    });

    it('a receipt that is not the one its row named, or not this character\'s, is not taken: the session stays owed', async () => {
      const token = await signedIn();
      const { character } = await registered(token);
      const s = await session(character, 'sess_2', [{}]);
      const stranger = await makeCharacter('ws_eeeeeeee_x1_ffffffff');
      const strange = await session(stranger, 'sess_2', [{}]);
      await hub.checkReceipts(token, character.uid, [await character.linked(clock - 100_000, s.data, 'SESSION_RESULT')]);
      expect(await hub.checkReceipts(token, character.uid, [], { sessions: [strange.receipt] })).toMatchObject({ ok: true, rerun: { owed: 1, sessions: 0 } });
    });
  });

  describe('time (D135)', () => {
    it('the hub states its own time as the clock\'s address, signed', () => {
      const said = hub.clock();
      expect(verifyStatement(key.publicKeyPem, said.text, said.signature)).toBe(true);
      expect(JSON.parse(said.text)).toEqual({ kind: 'worldseed-hub-clock', hub: key.id, issuer: 'https://hub.test', at: clock, day: dayIndexOf(clock), address: addressOf(clock) });
    });

    it('rows in the newer form go on from the row the hub holds, each linked to the last', async () => {
      const token = await signedIn();
      const { character } = await registered(token);
      const first = [await character.linked(clock - 3 * 86_400_000), await character.linked(clock - 2 * 86_400_000)];
      expect(await hub.checkReceipts(token, character.uid, first)).toMatchObject({ ok: true, held: 2 });
      expect(await hub.checkReceipts(token, character.uid, [first[1], await character.linked(clock - 60_000)])).toMatchObject({ ok: true, held: 3 });
    });

    it('a row from a day the hub has not reached is refused, and nothing in its batch is held', async () => {
      const token = await signedIn();
      const { character } = await registered(token);
      const today = await character.linked(clock - 60_000);
      const tomorrow = await character.linked(clock + 86_400_000);
      const out = await hub.checkReceipts(token, character.uid, [today, tomorrow]);
      expect(out).toMatchObject({ ok: false, status: 400 });
      expect(out.reason).toMatch(/day/);
      expect(await hub.record(token, character.uid)).toMatchObject({ ok: true, held: 0 });
    });

    it('a row whose moment does not match its own time is refused', async () => {
      const token = await signedIn();
      const { character } = await registered(token);
      const ts = clock - 86_400_000;
      const lying = await character.sign({ seq: 1, prevSeq: 0, ts, type: 'GOLD_DELTA', data: {}, v: ROW_VERSION, prev: null, clock: { ...addressOf(clock - 9 * 86_400_000), by: 'machine' } }, ts);
      expect(await hub.checkReceipts(token, character.uid, [lying])).toMatchObject({ ok: false, status: 400 });
    });

    it('a row that names another row before it than the one the hub holds is a challenge: the history under the head was written over', async () => {
      const token = await signedIn();
      const { character } = await registered(token);
      const one = await character.linked(clock - 5 * 60_000);
      await hub.checkReceipts(token, character.uid, [one]);
      const strayTwo = await character.sign({ seq: 2, prevSeq: 1, ts: clock - 60_000, type: 'GOLD_DELTA', data: {}, v: ROW_VERSION, prev: await linkOf('another row one'), clock: { ...addressOf(clock - 60_000), by: 'machine' } }, clock - 60_000);
      expect(await hub.checkReceipts(token, character.uid, [strayTwo])).toMatchObject({ ok: false, status: 409, standing: 'CHALLENGED', challenge: { seq: 2 } });
      expect(await hub.record(token, character.uid)).toMatchObject({ held: 1, standing: 'CHALLENGED' });
    });
  });

  describe('over HTTP', () => {
    let server: Server | undefined;
    let landing: string | undefined;
    afterEach(async () => {
      await new Promise<void>(r => (server ? server.close(() => r()) : r()));
      server = undefined;
      if (landing) rmSync(landing, { recursive: true, force: true });
      landing = undefined;
    });

    const listen = async () => {
      landing = mkdtempSync(join(tmpdir(), 'ws-landing-'));
      writeFileSync(join(landing, 'index.html'), '<!DOCTYPE html><title>World Seed</title><p>landing</p>');
      server = createServer(createHubListener({ api: createHubHandler(hub), landingDir: landing }));
      await new Promise<void>(r => server!.listen(0, '127.0.0.1', () => r()));
      return `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
    };

    const post = (url: string, body: unknown, headers: Record<string, string> = {}) =>
      fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });

    it('the function a host runs answers as the hub from its environment alone, and says what is missing when it cannot', async () => {
      const pem = generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
      const config = hubConfigFrom({ WS_HUB_DATABASE_URL: 'pglite://memory', WS_HUB_KEY: pem, WS_PUBLIC_URL: 'https://hub.test/' });
      const fn = createHubFunction(config);
      server = createServer((req, res) => void fn(req, res, hubPathOf(req.url)));
      await new Promise<void>(r => server!.listen(0, '127.0.0.1', () => r()));
      const base = `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
      const health = await (await fetch(`${base}/api/hub/health`)).json();
      expect(health).toMatchObject({ ok: true, service: 'worldseed-hub', hub: { id: makeHubKey(pem).id, url: 'https://hub.test' } });
      expect((await post(`${base}/api/hub/accounts`, { handle: 'fn_made', password: 'correct horse battery' })).status).toBe(200);

      expect(hubConfigFrom({ WS_HUB_KEY: pem, WS_PUBLIC_URL: 'https://hub.test' })).toMatchObject({ problem: expect.stringMatching(/WS_HUB_DATABASE_URL/) });
      expect(hubConfigFrom({ WS_HUB_DATABASE_URL: 'pglite://memory', WS_PUBLIC_URL: 'https://hub.test' })).toMatchObject({ problem: expect.stringMatching(/WS_HUB_KEY/) });
      const broken = createHubFunction(hubConfigFrom({}));
      const res = { statusCode: 0, setHeader() {}, end(b: string) { (this as any).body = b; } } as any;
      await broken({} as any, res, '/health');
      expect(res.statusCode).toBe(503);
      expect(JSON.parse(res.body).reason).toMatch(/WS_HUB_DATABASE_URL/);
    });

    it('the hub says what it is and whose key it signs with', async () => {
      const base = await listen();
      const health = await (await fetch(`${base}/api/hub/health`)).json();
      expect(health).toMatchObject({ ok: true, service: 'worldseed-hub', hub: { id: key.id, publicKeyPem: key.publicKeyPem } });
      const time = await (await fetch(`${base}/api/hub/clock`)).json();
      expect(time.ok).toBe(true);
      expect(verifyStatement(key.publicKeyPem, time.statement.text, time.statement.signature)).toBe(true);
    });

    it('a POST that is not JSON is refused, and a signed-in route without a token is 401', async () => {
      const base = await listen();
      const form = await fetch(`${base}/api/hub/accounts`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{"handle":"a","password":"b"}' });
      expect(form.status).toBe(415);
      expect((await fetch(`${base}/api/hub/session`)).status).toBe(401);
      expect((await post(`${base}/api/hub/characters/nonce`, {})).status).toBe(401);
    });

    it('an account, a session, a character and its receipts, all over the wire', async () => {
      const base = await listen();
      expect((await post(`${base}/api/hub/accounts`, { handle: 'wire', password: 'correct horse battery' })).status).toBe(200);
      const { token } = await (await post(`${base}/api/hub/sessions`, { handle: 'wire', password: 'correct horse battery' })).json();
      const auth = { Authorization: `Bearer ${token}` };
      expect(await (await fetch(`${base}/api/hub/session`, { headers: auth })).json()).toMatchObject({ ok: true, account: { handle: 'wire' } });

      const character = await makeCharacter('ws_11111111_x1_22222222');
      const { nonce } = await (await post(`${base}/api/hub/characters/nonce`, {}, auth)).json();
      const proof = await character.sign({ claim: 'hub-character', hub: key.id, nonce });
      expect((await post(`${base}/api/hub/characters`, { certificate: character.certificate, proof }, auth)).status).toBe(200);
      const receipt = await (await post(`${base}/api/hub/receipts`, { uid: character.uid, rows: [await character.row()] }, auth)).json();
      expect(receipt).toMatchObject({ ok: true, held: 1 });
      expect(await (await fetch(`${base}/api/hub/record/${character.uid}`, { headers: auth })).json()).toMatchObject({ ok: true, held: 1 });

      expect((await post(`${base}/api/hub/session/end`, {}, auth)).status).toBe(200);
      expect((await fetch(`${base}/api/hub/session`, { headers: auth })).status).toBe(401);
    });

    it('a page on the hub\'s own domain signs in with a cookie its scripts cannot read, and never sees the token', async () => {
      const base = await listen();
      await post(`${base}/api/hub/accounts`, { handle: 'cookied', password: 'correct horse battery' });
      expect(await (await fetch(`${base}/api/hub/where`)).json()).toMatchObject({ configured: true, url: 'https://hub.test', signedIn: null });

      const signIn = await post(`${base}/api/hub/sessions`, { handle: 'cookied', password: 'correct horse battery', keep: 'cookie' });
      const said = await signIn.json();
      expect(said).toMatchObject({ ok: true, account: { handle: 'cookied' } });
      expect(said.token).toBeUndefined();
      const cookie = signIn.headers.get('set-cookie') ?? '';
      expect(cookie).toMatch(/^ws_hub=[^;]+;/);
      for (const flag of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/api/hub']) expect(cookie).toContain(flag);

      const jar = { Cookie: cookie.split(';')[0] };
      expect(await (await fetch(`${base}/api/hub/where`, { headers: jar })).json()).toMatchObject({ signedIn: 'cookied' });
      expect(await (await fetch(`${base}/api/hub/session`, { headers: jar })).json()).toMatchObject({ ok: true, account: { handle: 'cookied' } });
      const out = await post(`${base}/api/hub/session/end`, {}, jar);
      expect(out.headers.get('set-cookie')).toMatch(/ws_hub=;.*Max-Age=0/);
      expect((await fetch(`${base}/api/hub/session`, { headers: jar })).status).toBe(401);
    });

    it('the deployed server serves the landing page and the hub, and nothing of play', async () => {
      const base = await listen();
      const page = await fetch(`${base}/`);
      expect(page.status).toBe(200);
      expect(page.headers.get('content-type')).toMatch(/text\/html/);
      expect(await page.text()).toContain('landing');
      for (const path of ['/api/db/health', '/api/intelligence/status', '/api/db/commit']) {
        expect((await fetch(`${base}${path}`)).status).toBe(404);
      }
      expect((await fetch(`${base}/../../package.json`)).status).not.toBe(200);
    });

    it('through the runner\'s bridge, the browser never holds the token: the runner does', async () => {
      const hubBase = await listen();
      const bridge = createHubBridge({ hubUrl: hubBase });
      const runner = createServer((req, res) => {
        const path = (req.url ?? '/').split('?')[0];
        if (path.startsWith('/api/hub')) return void bridge(req, res, path.slice('/api/hub'.length) || '/');
        res.statusCode = 404; res.end();
      });
      await new Promise<void>(r => runner.listen(0, '127.0.0.1', () => r()));
      const base = `http://127.0.0.1:${(runner.address() as AddressInfo).port}`;
      try {
        expect(await (await fetch(`${base}/api/hub/where`)).json()).toMatchObject({ configured: true, signedIn: null });
        expect((await post(`${base}/api/hub/accounts`, { handle: 'bridged', password: 'correct horse battery' })).status).toBe(200);
        const signIn = await post(`${base}/api/hub/sessions`, { handle: 'bridged', password: 'correct horse battery' });
        const said = await signIn.json();
        expect(said).toMatchObject({ ok: true, account: { handle: 'bridged' } });
        expect(said.token).toBeUndefined();
        expect(await (await fetch(`${base}/api/hub/where`)).json()).toMatchObject({ configured: true, signedIn: 'bridged' });
        expect(await (await fetch(`${base}/api/hub/session`)).json()).toMatchObject({ ok: true, account: { handle: 'bridged' } });
        expect((await post(`${base}/api/hub/session/end`, {})).status).toBe(200);
        expect(await (await fetch(`${base}/api/hub/where`)).json()).toMatchObject({ signedIn: null });
      } finally {
        await new Promise<void>(r => runner.close(() => r()));
      }
    });
  });
});
