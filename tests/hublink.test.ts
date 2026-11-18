// @vitest-environment jsdom
/**
 * A CHARACTER AND ITS ACCOUNT (src/logic/hub/HubLink.ts; HUB_WIRING.md, sections 1 to 4). Pedro,
 * 2026-11-12: "we need the minting of a new player to be done from the hub", and 2026-11-18: "the
 * account takes precedence, so when someone logs in again we need to serve them the data we have".
 *
 * The hub is stood in for at the game's own client (HubClient): what it answers is what the real
 * hub's routes answer (tests/database.deploy.test.ts holds those).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { HubClient } from '../src/logic/hub/HubClient';
import { HubLink, RECEIPTS_EVERY_MS } from '../src/logic/hub/HubLink';
import type { IPlayerCertificate } from '../src/entities/identity/certificateSystem';

const cert = (uid: string) => ({ metadata: { uid, displayName: 'TESTA', createdAt: 1 }, publicKeyJWK: {} }) as unknown as IPlayerCertificate;
const signedIn = { configured: true, url: 'https://hub.test', signedIn: 'alder' };
const signedOut = { configured: true, url: 'https://hub.test', signedIn: null };

beforeEach(() => { localStorage.clear(); HubLink.setRequired(null); });
afterEach(() => { HubLink.stop(); vi.restoreAllMocks(); vi.useRealTimers(); HubLink.setRequired(null); });

describe('where the account comes first', () => {
  it('is only where the game is the hub\'s own page, unless a test says so', () => {
    expect(HubLink.required()).toBe(false);
    HubLink.setRequired(true);
    expect(HubLink.required()).toBe(true);
  });
});

describe('a character is registered under the signed-in account', () => {
  it('keeps the hub\'s word for it beside the certificate, for the first row to name', async () => {
    vi.spyOn(HubClient, 'where').mockResolvedValue(signedIn);
    const register = vi.spyOn(HubClient, 'register').mockResolvedValue({ ok: true, uid: 'c1', issued: { text: 't', signature: 's' }, mint: 'a'.repeat(64) });
    expect(HubLink.mintOf('c1')).toBeNull();
    expect(await HubLink.bind(cert('c1'))).toEqual({ state: 'BOUND', mint: 'a'.repeat(64) });
    expect(register).toHaveBeenCalledTimes(1);
    expect(HubLink.mintOf('c1')).toBe('a'.repeat(64));
    expect(HubLink.issuedOf('c1')).toEqual({ text: 't', signature: 's' });
    // Another character's is its own
    expect(HubLink.mintOf('c2')).toBeNull();
  });

  it('asks nothing of the hub with nobody signed in, and says where to sign in', async () => {
    vi.spyOn(HubClient, 'where').mockResolvedValue(signedOut);
    const register = vi.spyOn(HubClient, 'register');
    expect(await HubLink.bind(cert('c1'))).toMatchObject({ state: 'SIGNED_OUT', reason: expect.stringMatching(/first page/) });
    expect(register).not.toHaveBeenCalled();
    expect(HubLink.mintOf('c1')).toBeNull();
  });

  it('says a character another account holds is another\'s, and keeps no word for it', async () => {
    vi.spyOn(HubClient, 'where').mockResolvedValue(signedIn);
    vi.spyOn(HubClient, 'register').mockResolvedValue({ ok: false, status: 409, reason: 'That character is held by another account on this hub.' });
    expect(await HubLink.bind(cert('c1'))).toMatchObject({ state: 'ANOTHERS', reason: expect.stringMatching(/another account/) });
    expect(HubLink.mintOf('c1')).toBeNull();
  });

  it('with no hub, or one that refuses, is an outcome with the hub\'s reason', async () => {
    vi.spyOn(HubClient, 'where').mockResolvedValue({ configured: false, url: null, signedIn: null, reason: 'This game\'s own server cannot be reached.' });
    expect(await HubLink.bind(cert('c1'))).toMatchObject({ state: 'NO_HUB' });
    vi.spyOn(HubClient, 'where').mockResolvedValue(signedIn);
    vi.spyOn(HubClient, 'register').mockResolvedValue({ ok: false, status: 400, reason: 'That proof does not hold.' });
    expect(await HubLink.bind(cert('c1'))).toEqual({ state: 'REFUSED', reason: 'That proof does not hold.' });
    vi.spyOn(HubClient, 'register').mockResolvedValue({ ok: false, status: 401, reason: 'Sign in first.' });
    expect(await HubLink.bind(cert('c1'))).toMatchObject({ state: 'SIGNED_OUT' });
  });

  it('reads what the account holds on the hub, and nothing when nobody is signed in', async () => {
    vi.spyOn(HubClient, 'characters').mockResolvedValue({ ok: true, characters: [{ uid: 'c9', displayName: 'ELSE', held: 12, standing: 'GOOD', issued: { text: '', signature: '' } }] });
    expect(await HubLink.held()).toMatchObject([{ uid: 'c9', held: 12 }]);
    vi.spyOn(HubClient, 'characters').mockResolvedValue({ ok: false, status: 401, reason: 'Sign in first.' });
    expect(await HubLink.held()).toEqual([]);
  });
});

describe('receipts go up by themselves', () => {
  const flush = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };

  it('once at the start, then on a slow beat, and stops when told', async () => {
    vi.useFakeTimers();
    vi.spyOn(HubClient, 'where').mockResolvedValue(signedIn);
    const send = vi.spyOn(HubClient, 'sendReceipts').mockResolvedValue({ ok: true, held: 3, sent: 3 });
    const people = vi.spyOn(HubClient, 'sendPeople').mockResolvedValue({ ok: true, people: [] });
    const stop = HubLink.start('c1', () => 500, () => 'city_1');
    await flush();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toBe('c1');
    // The city's people go up after the receipts
    expect(people).toHaveBeenCalledWith('city_1');
    await vi.advanceTimersByTimeAsync(RECEIPTS_EVERY_MS);
    expect(send).toHaveBeenCalledTimes(2);
    stop();
    await vi.advanceTimersByTimeAsync(RECEIPTS_EVERY_MS * 3);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('is quiet with nobody signed in', async () => {
    vi.useFakeTimers();
    vi.spyOn(HubClient, 'where').mockResolvedValue(signedOut);
    const send = vi.spyOn(HubClient, 'sendReceipts');
    HubLink.start('c1');
    await flush();
    await vi.advanceTimersByTimeAsync(RECEIPTS_EVERY_MS);
    expect(send).not.toHaveBeenCalled();
  });

  it('never races itself: a send asked for while one runs waits, and goes once after it', async () => {
    let release!: (v: { ok: boolean }) => void;
    const send = vi.spyOn(HubClient, 'sendReceipts')
      .mockImplementationOnce(() => new Promise(r => { release = r; }))
      .mockResolvedValue({ ok: true });
    const first = HubLink.send('c1');
    const second = HubLink.send('c1');
    const third = HubLink.send('c1');
    expect(second).toBe(first);
    expect(third).toBe(first);
    expect(send).toHaveBeenCalledTimes(1);
    release({ ok: true });
    await first;
    await flush();
    // The two asked for meanwhile are one send, after
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('goes at once when a dive ends, and when the page is hidden', async () => {
    vi.useFakeTimers();
    vi.spyOn(HubClient, 'where').mockResolvedValue(signedIn);
    const send = vi.spyOn(HubClient, 'sendReceipts').mockResolvedValue({ ok: true });
    HubLink.start('c1');
    await flush();
    expect(send).toHaveBeenCalledTimes(1);
    HubLink.soon();
    await flush();
    expect(send).toHaveBeenCalledTimes(2);
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    await flush();
    expect(send).toHaveBeenCalledTimes(3);
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    // With no character being played, a dive's end asks nothing
    HubLink.stop();
    HubLink.soon();
    await flush();
    expect(send).toHaveBeenCalledTimes(3);
  });

  it('tells the player the one thing they must hear: a challenge', async () => {
    vi.spyOn(HubClient, 'sendReceipts').mockResolvedValue({ ok: false, status: 409, standing: 'CHALLENGED', challenge: { why: 'gold' }, reason: 'This hub\'s own rerun did not land where this character\'s did.' });
    const heard: string[] = [];
    const off = HubLink.onChallenge(said => heard.push(said));
    await HubLink.send('c1');
    expect(heard).toEqual(['This hub\'s own rerun did not land where this character\'s did.']);
    off();
    await HubLink.send('c1');
    expect(heard).toHaveLength(1);
    // An ordinary answer says nothing to the player
    vi.spyOn(HubClient, 'sendReceipts').mockResolvedValue({ ok: true, held: 4 });
    const quiet: string[] = [];
    HubLink.onChallenge(said => quiet.push(said));
    await HubLink.send('c1');
    expect(quiet).toEqual([]);
  });
});
