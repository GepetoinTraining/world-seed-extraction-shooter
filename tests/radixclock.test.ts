// @vitest-environment node
/**
 * THE GAME'S TIME (D135). Pedro: "A moment is a residue vector, not a number", and "once chaining
 * starts, to go back and rechain anything becomes a losing proposition". The address is his
 * radix-chain clock (lettersacrosssubstrate.dev/en/clock): the day index N counted from machine zero
 * (JDN 2451911, a Monday in 2001), read as its residues mod 2⁶, 3³, 5², 7², 11², 13², and the inner
 * count of the day, 3 blocks × 8 hours, 3 segments × 20 minutes, 10 turns × 6 seconds.
 *
 * The expected values below are the page's own readout, taken 2026-11-04 at Unix second 1,793,806,854.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { addressOf, addressText, dayIndexFrom, dayIndexOf, innerCountOf, MODULI, residuesOf, SPAN } from '../shared/logic/time/RadixClock';
import { GameClock } from '../src/logic/time/GameClock';
import { chainProblem, linkOf, ROW_VERSION } from '../shared/logic/ledger/chainLaw';
import { signedText } from '../shared/entities/identity/signedText';
import { sha256Hex } from '../shared/logic/ledger/sha256';
import { createHash } from 'node:crypto';

const PAGE_MS = 1_793_806_854_000;
const DAY = 86_400_000;

describe('the radix-chain address', () => {
  it('reads the page\'s own instant the way the page does', () => {
    expect(dayIndexOf(PAGE_MS)).toBe(9_438);
    expect(residuesOf(9_438)).toEqual([30, 15, 13, 30, 0, 143]);
    // Greenwich read 15:40:54: block 1 of 3, hour 7 of 8, segment 2 of 3, minute 0 of 20, turn 9 of 10, second 0 of 6
    expect(innerCountOf(PAGE_MS)).toEqual([1, 7, 2, 0, 9, 0]);
    expect(addressOf(PAGE_MS)).toEqual({ n: [30, 15, 13, 30, 0, 143], t: [1, 7, 2, 0, 9, 0] });
    expect(addressText(addressOf(PAGE_MS))).toBe('30.15.13.30.0.143 · 1·7:2·0:9·0');
  });

  it('machine zero is day 0, and its span is the product of the moduli', () => {
    expect(dayIndexOf((2_451_911 - 2_440_588) * DAY)).toBe(0);
    expect(residuesOf(0)).toEqual([0, 0, 0, 0, 0, 0]);
    expect(MODULI.reduce((a, m) => a * m, 1)).toBe(SPAN);
    expect(SPAN).toBe(43_286_443_200);
  });

  it('the residues give the day back, near and far, by arithmetic alone', () => {
    for (const n of [0, 1, 63, 64, 9_438, 100_000, 3_652_425, SPAN - 1, 12_345_678_901]) {
      expect(dayIndexFrom(residuesOf(n))).toBe(n % SPAN);
    }
    expect(residuesOf(-1)).toEqual(MODULI.map(m => m - 1));
  });

  it('a residue out of its ring, or one too few, reads as no day at all', () => {
    expect(dayIndexFrom([64, 0, 0, 0, 0, 0] as any)).toBeNull();
    expect(dayIndexFrom([1, 2, 3] as any)).toBeNull();
    expect(dayIndexFrom([0.5, 0, 0, 0, 0, 0] as any)).toBeNull();
  });
});

describe('the game\'s clock, in the browser', () => {
  afterEach(() => GameClock.reset());

  it('with no server to ask, it reads the browser\'s clock, as before', () => {
    const before = Date.now();
    expect(GameClock.now()).toBeGreaterThanOrEqual(before);
    expect(GameClock.source()).toBe('browser');
  });

  it('once in step with its server, the day is the server\'s, and moving the browser\'s clock moves nothing', async () => {
    let mono = 5_000;
    const serverNow = PAGE_MS + 3 * DAY;
    GameClock.configure({ monotonic: () => mono, read: async () => ({ ok: true, now: serverNow, source: 'hub', hub: 'hub_test' }) });
    await GameClock.sync();
    expect(GameClock.source()).toBe('hub');
    expect(GameClock.day()).toBe(Math.floor(serverNow / DAY));

    const realNow = Date.now;
    Date.now = () => serverNow + 400 * DAY;
    try {
      expect(GameClock.day()).toBe(Math.floor(serverNow / DAY));
    } finally {
      Date.now = realNow;
    }

    mono += DAY;
    expect(GameClock.day()).toBe(Math.floor(serverNow / DAY) + 1);
    expect(GameClock.stamp()).toMatchObject({ by: 'hub_test', n: residuesOf(dayIndexOf(serverNow + DAY)) });
  });

  it('never runs backward, even when the server it follows does', async () => {
    let reading = PAGE_MS + DAY;
    GameClock.configure({ monotonic: () => 0, read: async () => ({ ok: true, now: reading, source: 'machine' }) });
    await GameClock.sync();
    const first = GameClock.now();
    reading = PAGE_MS;
    await GameClock.sync();
    expect(GameClock.now()).toBeGreaterThanOrEqual(first);
  });

  it('a server that cannot be read leaves the clock where it was, and says so', async () => {
    GameClock.configure({ monotonic: () => 0, read: async () => null });
    expect(await GameClock.sync()).toBeNull();
    expect(GameClock.source()).toBe('browser');
  });
});

/** Rows as Ledger writes them in the newer form, signed by a key made here. */
async function chainOf(count: number, startMs = PAGE_MS, stepMs = 60_000) {
  const ALG = { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' };
  const pair = await crypto.subtle.generateKey(ALG, true, ['sign', 'verify']) as CryptoKeyPair;
  const sign = async (payload: any) => {
    const timestamp = payload.ts;
    const signature = Buffer.from(await crypto.subtle.sign(ALG.name, pair.privateKey, new TextEncoder().encode(signedText(payload, timestamp)))).toString('base64');
    return { payload, signature, certUid: 'ws_chain', timestamp };
  };
  const rows: any[] = [];
  for (let seq = 1; seq <= count; seq++) {
    const ts = startMs + (seq - 1) * stepMs;
    const prev = seq === 1 ? null : await linkOf(rows[seq - 2].signature);
    rows.push(await sign({ seq, prevSeq: seq - 1, ts, type: 'GOLD_DELTA', data: { amount: seq }, v: ROW_VERSION, prev, clock: { ...addressOf(ts), by: 'machine' } }));
  }
  return { rows, sign };
}

describe('the link\'s SHA-256, written out', () => {
  it('gives the standard\'s own answers, and Node\'s, at every length around a block', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    for (let n = 0; n < 200; n++) {
      const text = 'é𝄞x'.repeat(n).slice(0, n * 2) + String(n);
      expect(sha256Hex(text)).toBe(createHash('sha256').update(text, 'utf8').digest('hex'));
    }
  });
});

describe('the chain\'s law, the same on every side', () => {
  it('rows in the newer form, each naming the one before and its moment, stand', async () => {
    const { rows } = await chainOf(4, PAGE_MS, 9 * 60 * 60_000);
    expect(await chainProblem(rows)).toBeNull();
  });

  it('a row that names another row before it breaks the chain at that row', async () => {
    const { rows, sign } = await chainOf(3);
    rows[2] = await sign({ ...rows[2].payload, prev: await linkOf(rows[0].signature) });
    expect(await chainProblem(rows)).toMatchObject({ seq: 3, kind: 'link' });
  });

  it('a moment that does not match its own time, or a day that goes back, is refused', async () => {
    const { rows, sign } = await chainOf(3, PAGE_MS, DAY);
    const lying = await sign({ ...rows[1].payload, clock: { ...addressOf(PAGE_MS + 5 * DAY), by: 'machine' } });
    expect(await chainProblem([rows[0], lying])).toMatchObject({ seq: 2, kind: 'clock' });

    const back = await sign({ ...rows[1].payload, ts: PAGE_MS - DAY, clock: { ...addressOf(PAGE_MS - DAY), by: 'machine' } });
    expect(await chainProblem([rows[0], back])).toMatchObject({ seq: 2, kind: 'clock' });
  });

  it('old rows, with no moment and no link, still stand; an old row after a new one does not', async () => {
    const old = [1, 2].map(seq => ({ payload: { seq, prevSeq: seq - 1, ts: PAGE_MS, type: 'GOLD_DELTA', data: {} }, signature: `s${seq}`, certUid: 'ws_chain', timestamp: PAGE_MS }));
    expect(await chainProblem(old)).toBeNull();

    const { rows } = await chainOf(1);
    const after = { payload: { seq: 2, prevSeq: 1, ts: PAGE_MS + 1, type: 'GOLD_DELTA', data: {} }, signature: 's2', certUid: 'ws_chain', timestamp: PAGE_MS };
    expect(await chainProblem([rows[0], after])).toMatchObject({ seq: 2, kind: 'form' });
  });

  it('a chain picked up partway is checked against the row held before it', async () => {
    const { rows } = await chainOf(4);
    const before = { seq: 2, signature: rows[1].signature, ts: rows[1].payload.ts, v: ROW_VERSION };
    expect(await chainProblem(rows.slice(2), before)).toBeNull();
    expect(await chainProblem(rows.slice(2), { ...before, signature: rows[0].signature })).toMatchObject({ seq: 3, kind: 'link' });
    // A gap is named by the seq that was due, as the audit always has
    expect(await chainProblem(rows.slice(3), before)).toMatchObject({ seq: 3, kind: 'order' });
  });
});
