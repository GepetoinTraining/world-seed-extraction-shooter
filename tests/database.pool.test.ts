// @vitest-environment node
/**
 * THE POOL AND THE WORLD WE HOST (Pedro, 2026-11-04).
 *
 * The pool: "the players in a server can rotate the one using their key... the more players in a
 * hub the less it costs each one, distributed content generation". A hub's shared work rotates
 * among the online players who opted in; each job runs on one player's client and voice, and what
 * comes back passes the same law as any manifest. Everyone in the pool sees who is in it, with
 * what, and what each has spent.
 *
 * The world we host: connecting a hub to it checks the account, and a character barred from our
 * world is barred from that world only. These bars stand on a store in memory; no model is called.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqlStore } from '../shared/SqlStore';
import { openStore } from '../server/openStore';
import { Hub } from '../server/hub/Hub';
import { HubPool } from '../server/hub/pool';
import { HostedWorld } from '../server/hub/hosted';
import { takeTurn } from '../src/logic/hub/PoolWorker';
import { SharedWork } from '../src/logic/hub/SharedWork';
import { emptyChain } from '../shared/logic/theme/ChainWeb';
import { makeHubKey } from '../server/hub/keys';
import { signedText } from '../shared/entities/identity/signedText';
import { FIRST_THEME_PACK } from '../shared/logic/theme/boot';
import { bodyOf, compileTheme } from '../shared/logic/theme/ThemeCompiler';

const ALGORITHM = { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' };

async function character(uid: string) {
  const pair = await crypto.subtle.generateKey(ALGORITHM, true, ['sign', 'verify']) as CryptoKeyPair;
  const sign = async (payload: unknown, timestamp = 1) => ({
    payload, timestamp, certUid: uid,
    signature: Buffer.from(await crypto.subtle.sign(ALGORITHM.name, pair.privateKey, new TextEncoder().encode(signedText(payload, timestamp)))).toString('base64')
  });
  return { uid, certificate: { metadata: { uid, displayName: uid.toUpperCase() }, publicKeyJWK: await crypto.subtle.exportKey('jwk', pair.publicKey) }, sign };
}

describe('the hub\'s pool and the world it hosts', () => {
  let store: SqlStore;
  let hub: Hub;
  let pool: HubPool;
  let clock: number;
  const key = makeHubKey();

  beforeEach(async () => {
    store = await openStore('pglite://memory');
    clock = 1_800_000_000_000;
    hub = new Hub(store, key, { publicUrl: 'https://hub.test', now: () => clock });
    pool = new HubPool(hub);
  });
  afterEach(async () => { await store.close(); });

  const player = async (handle: string) => {
    await hub.createAccount(handle, 'correct horse battery');
    const out = await hub.signIn(handle, 'correct horse battery');
    if (!out.ok) throw new Error(out.reason);
    return out.token;
  };

  const kindJob = () => {
    const compiled = compileTheme(FIRST_THEME_PACK);
    const kind = Object.keys(compiled.mobs)[0];
    return { kind: 'kind' as const, path: '/creation', body: { ask: { kind } }, honest: { kind, worldSeed: 's', themeId: FIRST_THEME_PACK.themeId, nodes: [], roots: [kind], def: JSON.parse(JSON.stringify(compiled.mobs[kind])) } };
  };

  describe('the pool', () => {
    it('a player joins with a voice, and everyone in it sees who is in, with what, and what each has spent', async () => {
      const a = await player('alder');
      const b = await player('birch');
      expect(await pool.join(a, 'keyed')).toMatchObject({ ok: true });
      expect(await pool.join(b, 'local')).toMatchObject({ ok: true });
      expect(await pool.join(b, 'nonsense' as any)).toMatchObject({ ok: false, status: 400 });
      const seen = await pool.members(a);
      expect(seen).toMatchObject({ ok: true, members: [
        { handle: 'alder', voice: 'keyed', jobsDone: 0, spentUsd: 0, online: true },
        { handle: 'birch', voice: 'local', jobsDone: 0, spentUsd: 0, online: true }
      ] });
    });

    it('a job goes to whoever has done the fewest, so the cost goes round', async () => {
      const a = await player('alder');
      const b = await player('birch');
      await pool.join(a, 'keyed');
      clock += 1;
      await pool.join(b, 'keyed');
      const job = kindJob();
      const first = await pool.post(a, job);
      // Jobs posted in the same millisecond have no order between them
      clock += 1;
      await pool.post(a, job);
      if (!first.ok) throw new Error(first.reason);

      const taken = await pool.take(a);
      expect(taken).toMatchObject({ ok: true, job: { id: first.jobId, path: '/creation' } });
      expect(await pool.done(a, first.jobId, { status: 'OK', data: job.honest, usage: { usd: 0.02 } })).toMatchObject({ ok: true, state: 'DONE' });

      // alder has done one, birch none: the next is birch's, and alder waits its turn
      expect(await pool.take(a)).toMatchObject({ ok: true, job: null });
      expect(await pool.take(b)).toMatchObject({ ok: true, job: { path: '/creation' } });
      expect(await pool.members(b)).toMatchObject({ members: [{ handle: 'alder', jobsDone: 1, spentUsd: 0.02 }, { handle: 'birch', jobsDone: 0 }] });
    });

    it('what comes back passes the same law: wrong numbers come back put right, as a diff', async () => {
      const a = await player('alder');
      await pool.join(a, 'local');
      const job = kindJob();
      const posted = await pool.post(a, job);
      if (!posted.ok) throw new Error(posted.reason);
      await pool.take(a);
      const tampered = { ...job.honest, def: { ...job.honest.def, baseHealth: 999_999 } };
      const out = await pool.done(a, posted.jobId, { status: 'OK', data: tampered, usage: { usd: 0 } });
      expect(out).toMatchObject({ ok: true, state: 'DONE', diff: [{ op: 'replace', path: '/def/baseHealth', value: job.honest.def.baseHealth }] });
      expect(await pool.get(a, posted.jobId)).toMatchObject({ ok: true, job: { state: 'DONE', result: { def: job.honest.def } } });
    });

    it('what breaks the law and cannot be put right is refused, and the job goes back for another turn', async () => {
      const a = await player('alder');
      await pool.join(a, 'keyed');
      const posted = await pool.post(a, { kind: 'theme', path: '/theme', body: {} });
      if (!posted.ok) throw new Error(posted.reason);
      await pool.take(a);
      const lawless = { ...bodyOf(FIRST_THEME_PACK), name: 'Lawless', lore: [...FIRST_THEME_PACK.lore, 7] };
      expect(await pool.done(a, posted.jobId, { status: 'OK', data: lawless, usage: { usd: 0.03 } })).toMatchObject({ ok: false, status: 422 });
      expect(await pool.get(a, posted.jobId)).toMatchObject({ job: { state: 'OPEN' } });
      expect(await pool.members(a)).toMatchObject({ members: [{ jobsDone: 0, spentUsd: 0.03 }] });
    });

    it('a member\'s turn, in their browser: it takes the job, asks its own door, and hands the answer in to be checked', async () => {
      const a = await player('alder');
      await pool.join(a, 'local');
      const job = kindJob();
      const posted = await pool.post(a, job);
      if (!posted.ok) throw new Error(posted.reason);
      const client = { takeJob: () => pool.take(a) as any, handIn: (id: string, outcome: unknown) => pool.done(a, id, outcome as any) as any };
      const asked: string[] = [];
      const turn = await takeTurn(client, async (path) => { asked.push(path); return { status: 'OK', data: job.honest, usage: { usd: 0 } }; });
      expect(asked).toEqual(['/creation']);
      expect(turn).toMatchObject({ handedIn: true, job: { id: posted.jobId } });
      expect(await pool.get(a, posted.jobId)).toMatchObject({ job: { state: 'DONE' } });
      expect(await takeTurn(client, async () => { throw new Error('not asked'); })).toEqual({});
    });

    it('a job the hub has no law for is refused when it is posted, not run', async () => {
      const a = await player('alder');
      expect(await pool.post(a, { kind: 'anything' as any, path: '/talk', body: {} })).toMatchObject({ ok: false, status: 400 });
    });

    it('a player who leaves, or stops answering, gets no turn; only the player who took a job can hand it in', async () => {
      const a = await player('alder');
      const b = await player('birch');
      await pool.join(a, 'keyed');
      await pool.join(b, 'keyed');
      const posted = await pool.post(a, kindJob());
      if (!posted.ok) throw new Error(posted.reason);
      await pool.leave(a);
      expect(await pool.take(a)).toMatchObject({ ok: false, status: 403 });
      expect((await pool.take(b) as any).job?.id).toBe(posted.jobId);
      expect(await pool.done(a, posted.jobId, { status: 'OK', data: kindJob().honest })).toMatchObject({ ok: false, status: 403 });

      clock += 5 * 60_000;
      const c = await player('cedar');
      await pool.join(c, 'local');
      expect(await pool.members(c)).toMatchObject({ members: expect.arrayContaining([expect.objectContaining({ handle: 'birch', online: false })]) });
      // birch's lease ran out while it was away: the job is open again, and cedar's to take
      expect((await pool.take(c) as any).job?.id).toBe(posted.jobId);
    });
  });

  describe('the game\'s own shared work: a world\'s passes, the chain, loot tables', () => {
    const passBody = { pass: 'made', ask: { pass: 'made', said: 'x', world: {}, offered: { gear: [{ id: 'g1', is: 'a hook' }], goods: [{ id: 'd1', is: 'a rope' }] }, words: [] }, draft: {} };
    const lootWords = { name: 'Pockets', source: 'creature', fits: ['humanoid'], lines: [{ what: 'material', item: '', odds: 'often', count: 'few', rank: 'same' }] };
    const turn = async (who: string, kind: any, path: string, body: unknown, answer: unknown) => {
      const t = await player(who);
      await pool.join(t, 'keyed');
      const posted = await pool.post(t, { kind, path, body });
      if (!posted.ok) throw new Error(posted.reason);
      await pool.take(t);
      const out = await pool.done(t, posted.jobId, { status: 'OK', data: answer }) as any;
      // A refused job goes back for another turn: taken back here, so the next bar's turn is its own
      if (!out.ok) await pool.withdraw(t, posted.jobId);
      // and the player leaves, so the next bar's player has the turn
      await pool.leave(t);
      return { t, jobId: posted.jobId, out };
    };

    it('a pass\'s answer must fit its shape and pick only what it was offered', async () => {
      const good = await turn('alder', 'pass', '/world/pass', passBody, { picked: ['g1', 'd1'] });
      expect(good.out).toMatchObject({ ok: true, state: 'DONE' });
      expect((await pool.get(good.t, good.jobId) as any).job).toMatchObject({ state: 'DONE', result: { picked: ['g1', 'd1'] } });
      clock += 1;
      expect((await turn('birch', 'pass', '/world/pass', passBody, { picked: ['g1', 'stolen'] })).out).toMatchObject({ ok: false, status: 422, reason: expect.stringMatching(/stolen/) });
      clock += 1;
      expect((await turn('cedar', 'pass', '/world/pass', passBody, { picked: 'g1' })).out).toMatchObject({ ok: false, status: 422 });
    });

    it('a chain round is judged against the chain the poster sent, and refused without one', async () => {
      const check = { chain: emptyChain(), ground: { things: [], stations: [], tools: [] }, open: [], registered: [] };
      const broken = await turn('alder', 'chain', '/chain', { ask: {}, check }, { tags: [], materials: [{ key: 'Not A Key' }], stations: [], goods: [], gear: [] });
      expect(broken.out).toMatchObject({ ok: false, status: 422, reason: expect.stringMatching(/refused whole/i) });
      clock += 1;
      expect((await turn('birch', 'chain', '/chain', { ask: {} }, { tags: [], materials: [], stations: [], goods: [], gear: [] })).out).toMatchObject({ ok: false, status: 422, reason: expect.stringMatching(/chain it was asked from/) });
    });

    it('loot tables come back sealed with the formula\'s numbers, for a theme the hub holds; a theme it does not hold is refused at the post', async () => {
      const { t, jobId, out } = await turn('alder', 'loot', '/loot', { ask: { themeId: FIRST_THEME_PACK.themeId } }, { tables: [lootWords] });
      expect(out).toMatchObject({ ok: true, state: 'DONE' });
      expect((await pool.get(t, jobId) as any).job.result.tables[0]).toMatchObject({ themeId: FIRST_THEME_PACK.themeId, lines: [{ chance: 600_000, low: 1, high: 3 }] });
      expect(await pool.post(t, { kind: 'loot', path: '/loot', body: { ask: { themeId: 'theme_nowhere' } } })).toMatchObject({ ok: false, status: 400 });
      clock += 1;
      expect((await turn('birch', 'loot', '/loot', { ask: { themeId: FIRST_THEME_PACK.themeId } }, { tables: [{ ...lootWords, lines: [{ ...lootWords.lines[0], item: 'golden_ticket' }] }] })).out).toMatchObject({ ok: false, status: 422 });
    });

    it('a poster takes back a job it stopped waiting for; nobody takes it after, and only the poster can', async () => {
      const a = await player('alder');
      const b = await player('birch');
      await pool.join(b, 'keyed');
      const posted = await pool.post(a, { kind: 'pass', path: '/world/pass', body: passBody });
      if (!posted.ok) throw new Error(posted.reason);
      expect(await pool.withdraw(b, posted.jobId)).toMatchObject({ ok: false, status: 403 });
      expect(await pool.withdraw(a, posted.jobId)).toMatchObject({ ok: true });
      expect(await pool.take(b)).toMatchObject({ ok: true, job: null });
    });

    it('SharedWork: no hub or nobody online, the player\'s own door answers; someone online, the pool\'s checked result comes back; nobody takes it in time, it is taken back and the door answers', async () => {
      const own = async () => ({ status: 'OK', data: 'own door' });
      const fake = (over: Partial<Record<string, any>>) => ({
        where: async () => ({ configured: true, url: 'x', signedIn: 'alder' }),
        pool: async () => ({ ok: true, members: [{ handle: 'birch', online: true }] }),
        postJob: async () => ({ ok: true, jobId: 'job_1' }),
        job: async () => ({ ok: true, job: { id: 'job_1', kind: 'pass', state: 'DONE', result: 'pool' } }),
        withdrawJob: async () => ({ ok: true }),
        ...over
      }) as any;
      const quick = { everyMs: 1, waitMs: 3, sleep: async () => undefined };
      expect(await SharedWork.ask('pass', '/world/pass', {}, own, { ...quick, client: fake({ where: async () => ({ configured: false, url: null, signedIn: null }) }) })).toEqual({ status: 'OK', data: 'own door' });
      expect(await SharedWork.ask('pass', '/world/pass', {}, own, { ...quick, client: fake({ pool: async () => ({ ok: true, members: [{ handle: 'birch', online: false }] }) }) })).toEqual({ status: 'OK', data: 'own door' });
      expect(await SharedWork.ask('pass', '/world/pass', {}, own, { ...quick, client: fake({}) })).toEqual({ status: 'OK', data: 'pool' });
      let withdrawn = 0;
      expect(await SharedWork.ask('pass', '/world/pass', {}, own, { ...quick, client: fake({ job: async () => ({ ok: true, job: { state: 'OPEN' } }), withdrawJob: async () => { withdrawn++; return { ok: true }; } }) })).toEqual({ status: 'OK', data: 'own door' });
      expect(withdrawn).toBe(1);
    });
  });

  describe('the world we host', () => {
    const hostedManifest = { world: { worldUid: 'world_hosted_1', name: 'The Common World', creatorCertUid: 'operator', themeId: FIRST_THEME_PACK.themeId }, themes: [FIRST_THEME_PACK] };

    it('says what it is to anyone, and serves itself to a hub whose account holds the character', async () => {
      const hosted = new HostedWorld(hub);
      expect(await hosted.describe()).toMatchObject({ ok: false, status: 404 });
      await hosted.publish(hostedManifest);
      expect(await hosted.describe()).toEqual({ ok: true, world: { worldUid: 'world_hosted_1', name: 'The Common World', themeId: FIRST_THEME_PACK.themeId } });

      const token = await player('alder');
      const me = await character('ws_aaaa1111_x1_bbbb2222');
      const nonce = await hub.nonce(token);
      if (!nonce.ok) throw new Error(nonce.reason);
      await hub.registerCharacter(token, me.certificate, await me.sign({ claim: 'hub-character', hub: key.id, nonce: nonce.nonce }));
      expect(await hosted.connect(token, me.uid)).toMatchObject({ ok: true, manifest: { world: { worldUid: 'world_hosted_1' }, themes: [{ themeId: FIRST_THEME_PACK.themeId }] }, standing: 'GOOD' });

      const other = await player('birch');
      expect(await hosted.connect(other, me.uid)).toMatchObject({ ok: false, status: 403 });
      expect(await hosted.connect('not-a-token', me.uid)).toMatchObject({ ok: false, status: 401 });
    });

    it('our world waits for a character\'s owed session receipts, and closes to one the hub\'s rerun challenged (D134)', async () => {
      const hosted = new HostedWorld(hub);
      await hosted.publish(hostedManifest);
      const token = await player('alder');
      const me = await character('ws_eeee5555_x1_ffff6666');
      const nonce = await hub.nonce(token);
      if (!nonce.ok) throw new Error(nonce.reason);
      await hub.registerCharacter(token, me.certificate, await me.sign({ claim: 'hub-character', hub: key.id, nonce: nonce.nonce }));
      const held = (await hub.read<any>(`hub_character_${me.uid}`))!;
      await hub.commit([{ kind: 'put', doc: hub.doc(`hub_character_${me.uid}`, { ...held.data, owed: [{ seq: 1, sessionId: 's', receiptHash: 'h', actionCount: 1 }] }, held.doc.metadata.createdAt) }]);
      expect(await hosted.connect(token, me.uid)).toMatchObject({ ok: false, status: 409, owed: 1 });
      await hub.commit([{ kind: 'put', doc: hub.doc(`hub_character_${me.uid}`, { ...held.data, owed: [], standing: 'CHALLENGED' }, held.doc.metadata.createdAt) }]);
      expect(await hosted.connect(token, me.uid)).toMatchObject({ ok: false, status: 403, standing: 'CHALLENGED' });
    });

    it('a character barred from our world is barred from that world only, and is told the rest plays on', async () => {
      const hosted = new HostedWorld(hub);
      await hosted.publish(hostedManifest);
      const token = await player('alder');
      const me = await character('ws_cccc3333_x1_dddd4444');
      const nonce = await hub.nonce(token);
      if (!nonce.ok) throw new Error(nonce.reason);
      await hub.registerCharacter(token, me.certificate, await me.sign({ claim: 'hub-character', hub: key.id, nonce: nonce.nonce }));

      await hosted.setStanding(me.uid, 'BARRED', 'Wrote over its own history on this world.');
      const out = await hosted.connect(token, me.uid);
      expect(out).toMatchObject({ ok: false, status: 403, standing: 'BARRED' });
      expect((out as any).reason).toMatch(/The Common World/);
      expect((out as any).reason).toMatch(/everything else/i);
      // Its account and its own hub stand: it still signs in and sends receipts
      expect(await hub.session(token)).toMatchObject({ handle: 'alder' });
      expect(await hub.record(token, me.uid)).toMatchObject({ ok: true });

      await hosted.setStanding(me.uid, 'GOOD', 'Lifted.');
      expect((await hosted.connect(token, me.uid)).ok).toBe(true);
    });
  });
});
