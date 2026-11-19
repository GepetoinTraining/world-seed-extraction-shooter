// @vitest-environment jsdom
/**
 * THE LOBBY, IN THE GAME (src/logic/live/OpenWorlds.ts). Pedro, 2026-11-18: "we need to make the
 * multiplayer always on WHEN someone is in server... unless they choose to host their own, then we
 * tunnel theirs as an option like old warcraft 3 used to do".
 *
 * The hub is stood in for at the game's own client (HubClient), and the game's store at its doors:
 * what the real hub answers is held in tests/database.openworlds.test.ts.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { HubClient } from '../src/logic/hub/HubClient';
import { HubLink } from '../src/logic/hub/HubLink';
import { HostedLink } from '../src/logic/live/HostedLink';
import { LiveClient } from '../src/logic/live/LiveClient';
import { OpenWorlds, useOpenWorlds } from '../src/logic/live/OpenWorlds';
import { ThemeStore } from '../src/logic/theme/ThemeStore';
import { MintStore } from '../src/logic/theme/writing/MintAdditionsWriter';
import { useIdentityStore } from '../src/entities/identity/store';
import { usePlayerStore } from '../src/entities/player/store';
import { VectorStore } from '../shared/entities/data/VectorStore';
import { StoreClient } from '../shared/entities/data/StoreClient';
import { ContentRegistry } from '../shared/logic/theme/ContentRegistry';
import { installShippedThemes, FIRST_THEME_PACK } from '../shared/logic/theme/boot';
import { OPEN_BEAT_MS, type IOpenWorldRow } from '../shared/logic/live/open';

const ME = 'ws_me';
const row = (worldUid: string, more: Partial<IOpenWorldRow> = {}): IOpenWorldRow => ({ worldUid, name: 'Saltmarsh', themeId: FIRST_THEME_PACK.themeId, by: 'PLAYER', host: 'ALDER', mine: false, answering: true, openedAt: 1, ...more });
const certOf = (worldUid: string, maker = 'ws_alder') => ({ data: { worldUid, worldName: 'Saltmarsh', creatorCertUid: maker, worldType: 'EXTRACTION', rules: { themeId: FIRST_THEME_PACK.themeId } } });
const manifestOf = (worldUid: string) => ({ world: { worldUid, name: 'Saltmarsh', creatorCertUid: 'ws_alder', themeId: FIRST_THEME_PACK.themeId }, certificate: certOf(worldUid), themes: [FIRST_THEME_PACK], mint: { worldUid, themeId: FIRST_THEME_PACK.themeId, writtenAt: 1, batch: { scope: 's', bases: [], materials: [], uses: [] } } });
const wire = (id: string, data: unknown) => ({ id, namespace: 'territories', dataText: JSON.stringify(data), metadata: { createdAt: 1, updatedAt: 1, version: 1 } });

/** The game's own doors, stood in: what was banked, saved and written is what the bars read. */
function doors(held: Record<string, unknown> = {}) {
  const bank = vi.spyOn(ThemeStore, 'bank').mockResolvedValue({ ok: true });
  const saved: string[] = [];
  vi.spyOn(VectorStore, 'saveContent').mockImplementation(async (id: string) => { saved.push(id); return true; });
  vi.spyOn(VectorStore, 'get').mockImplementation(async (_ns: unknown, id: string) => (held[id] ? { data: { content: held[id] } } as any : null));
  const mint = vi.spyOn(MintStore, 'save').mockResolvedValue(undefined);
  vi.spyOn(MintStore, 'load').mockResolvedValue(null);
  return { bank, saved, mint };
}

beforeEach(() => {
  localStorage.clear();
  installShippedThemes();
  HubLink.setRequired(true);
  useOpenWorlds.setState({ rows: [], stamp: '', note: null, busy: null });
  useIdentityStore.setState({ certificate: { metadata: { uid: ME, displayName: 'ME', createdAt: 1 }, publicKeyJWK: {} } as any });
  usePlayerStore.setState(s => ({ player: { ...s.player, tutorialSealedAt: 1 } }));
});
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); HubLink.setRequired(null); });

describe('always on: the worlds open on the hub are among the zones by themselves', () => {
  it('asks nothing where the lobby does not run, with no character, or while the first order is still open', async () => {
    const list = vi.spyOn(HubClient, 'openWorlds');
    HubLink.setRequired(false);
    await OpenWorlds.sync();
    HubLink.setRequired(true);
    useIdentityStore.setState({ certificate: null });
    await OpenWorlds.sync();
    useIdentityStore.setState({ certificate: { metadata: { uid: ME, displayName: 'ME', createdAt: 1 }, publicKeyJWK: {} } as any });
    usePlayerStore.setState(s => ({ player: { ...s.player, tutorialSealedAt: undefined } }));
    await OpenWorlds.sync();
    expect(list).not.toHaveBeenCalled();
    expect(useOpenWorlds.getState().rows).toEqual([]);
  });

  it('has the hub serve a world this game does not hold, keeps it as it keeps its own, and marks it live: once', async () => {
    const { bank, saved, mint } = doors();
    vi.spyOn(HubClient, 'openWorlds').mockResolvedValue({ ok: true, worlds: [row('w1')] });
    const enter = vi.spyOn(HubClient, 'enterWorld').mockResolvedValue({ ok: true, worldUid: 'w1', manifest: manifestOf('w1'), by: 'PLAYER' });
    await OpenWorlds.sync();
    expect(enter).toHaveBeenCalledWith(ME, 'w1');
    expect(bank).toHaveBeenCalledTimes(1);
    expect(saved).toEqual(['w1']);
    expect(mint).toHaveBeenCalledTimes(1);
    expect(HostedLink.markOf('w1')).toBe('JOINED');
    expect(HostedLink.is('w1')).toBe(true);
    expect(OpenWorlds.offered('w1')).toBe(true);
    expect(useOpenWorlds.getState()).toMatchObject({ note: null, rows: [{ worldUid: 'w1' }] });
    // The next beat reads the list and asks for nothing it already holds
    await OpenWorlds.sync();
    expect(enter).toHaveBeenCalledTimes(1);
  });

  it('a world the hub served is offered only while it is open and its host is heard from; a world of this game\'s own always is', async () => {
    doors();
    const list = vi.spyOn(HubClient, 'openWorlds').mockResolvedValue({ ok: true, worlds: [row('w1')] });
    vi.spyOn(HubClient, 'enterWorld').mockResolvedValue({ ok: true, worldUid: 'w1', manifest: manifestOf('w1'), by: 'PLAYER' });
    await OpenWorlds.sync();
    const stamp = useOpenWorlds.getState().stamp;
    expect(OpenWorlds.offered('w1')).toBe(true);
    expect(OpenWorlds.offered('a_world_of_my_own')).toBe(true);

    list.mockResolvedValue({ ok: true, worlds: [] });
    await OpenWorlds.sync();
    expect(OpenWorlds.offered('w1')).toBe(false);
    expect(useOpenWorlds.getState().stamp).not.toBe(stamp);
    // Still marked, so it is not mistaken for a world of this game's own, and is back when it is open again
    expect(HostedLink.markOf('w1')).toBe('JOINED');
    list.mockResolvedValue({ ok: true, worlds: [row('w1')] });
    await OpenWorlds.sync();
    expect(OpenWorlds.offered('w1')).toBe(true);
  });

  it('sends what the hub is owed and asks again when a world is closed to a character for owed receipts; says why a world could not be served', async () => {
    doors();
    vi.spyOn(HubClient, 'openWorlds').mockResolvedValue({ ok: true, worlds: [row('w1'), row('w2', { name: 'Ashfall' })] });
    const sendNow = vi.spyOn(HubLink, 'sendNow').mockResolvedValue({ ok: true });
    const enter = vi.spyOn(HubClient, 'enterWorld')
      .mockResolvedValueOnce({ ok: false, status: 409, owed: 1, reason: 'This hub has not been sent 1 of this character\'s session receipts to rerun.' })
      .mockResolvedValueOnce({ ok: true, worldUid: 'w1', manifest: manifestOf('w1'), by: 'PLAYER' })
      .mockResolvedValue({ ok: false, status: 403, reason: 'This hub\'s rerun of this character did not land where its own did.' });
    await OpenWorlds.sync();
    expect(sendNow).toHaveBeenCalledTimes(1);
    expect(enter).toHaveBeenCalledTimes(3);
    expect(HostedLink.markOf('w1')).toBe('JOINED');
    expect(HostedLink.markOf('w2')).toBeNull();
    expect(useOpenWorlds.getState().note).toMatch(/^Ashfall: This hub's rerun/);
  });

  it('a hub that cannot be reached, or with nobody signed in, closes nothing and says so', async () => {
    HostedLink.remember('w1', 'JOINED');
    useOpenWorlds.setState({ rows: [row('w1')], stamp: 'x' });
    vi.spyOn(HubClient, 'openWorlds').mockResolvedValue({ ok: false, status: 401, reason: 'Sign in first.' });
    await OpenWorlds.sync();
    expect(useOpenWorlds.getState()).toMatchObject({ rows: [{ worldUid: 'w1' }], note: expect.stringMatching(/first page/) });
    expect(OpenWorlds.offered('w1')).toBe(true);
  });

  it('inside a world that is no longer open, the game is put on its own copy', async () => {
    doors();
    HostedLink.remember('w1', 'JOINED');
    vi.spyOn(LiveClient, 'world').mockReturnValue('w1');
    const fall = vi.spyOn(LiveClient, 'fall').mockImplementation(() => undefined);
    const list = vi.spyOn(HubClient, 'openWorlds').mockResolvedValue({ ok: true, worlds: [row('w1')] });
    await OpenWorlds.sync();
    expect(fall).not.toHaveBeenCalled();
    list.mockResolvedValue({ ok: true, worlds: [] });
    await OpenWorlds.sync();
    expect(fall).toHaveBeenCalledWith('w1');
  });
});

describe('hosting one\'s own', () => {
  it('opens a world this character minted with what its players will share as this game holds it, and plays it live from then on', async () => {
    doors({ w9: certOf('w9', ME) });
    vi.spyOn(HubLink, 'sendNow').mockResolvedValue({ ok: true });
    vi.spyOn(StoreClient, 'get').mockImplementation(async (id: string) => (id === 'world_chests_w9' ? wire(id, { chests: {}, guards: {} }) : id === 'world_carts_w9' ? wire(id, { carts: ['c1'] }) : null));
    const open = vi.spyOn(HubClient, 'openWorld').mockResolvedValue({ ok: true, worldUid: 'w9', resumed: false, openedAt: 5 });
    vi.spyOn(HubClient, 'openWorlds').mockResolvedValue({ ok: true, worlds: [row('w9', { mine: true, host: 'ME' })] });
    expect(await OpenWorlds.open('w9')).toEqual({ ok: true });
    const [uid, manifest, docs] = open.mock.calls[0];
    expect(uid).toBe(ME);
    expect(manifest).toMatchObject({ world: { worldUid: 'w9', creatorCertUid: ME, themeId: FIRST_THEME_PACK.themeId }, certificate: { data: { worldUid: 'w9' } }, themes: [{ themeId: FIRST_THEME_PACK.themeId }] });
    expect(docs.map(d => d.id)).toEqual(['world_chests_w9', 'world_carts_w9']);
    expect(HostedLink.markOf('w9')).toBe('MINE');
    expect(HostedLink.is('w9')).toBe(true);
    expect(OpenWorlds.offered('w9')).toBe(true);
    expect(useOpenWorlds.getState().busy).toBeNull();
  });

  it('opens nothing this character did not mint, or that this game does not hold, and marks nothing the hub refused', async () => {
    doors({ w1: certOf('w1', 'ws_alder'), w9: certOf('w9', ME) });
    vi.spyOn(HubLink, 'sendNow').mockResolvedValue({ ok: true });
    vi.spyOn(StoreClient, 'get').mockResolvedValue(null);
    const open = vi.spyOn(HubClient, 'openWorld').mockResolvedValue({ ok: false, status: 400, reason: 'This world cannot be opened to others: the law refused part of it.' });
    expect(await OpenWorlds.open('w1')).toMatchObject({ ok: false, reason: expect.stringMatching(/minted it/) });
    expect(await OpenWorlds.open('nowhere')).toMatchObject({ ok: false, reason: expect.stringMatching(/does not hold/) });
    expect(open).not.toHaveBeenCalled();
    expect(await OpenWorlds.open('w9')).toMatchObject({ ok: false, reason: expect.stringMatching(/law refused/) });
    expect(HostedLink.markOf('w9')).toBeNull();
    expect(ContentRegistry.get(FIRST_THEME_PACK.themeId)).toBeTruthy();
  });

  it('closing writes what was shared back into this game, once, and the world is this game\'s own again', async () => {
    doors({ w9: certOf('w9', ME) });
    HostedLink.remember('w9', 'MINE');
    const commit = vi.spyOn(StoreClient, 'commit').mockResolvedValue({ applied: true });
    vi.spyOn(HubClient, 'closeWorld').mockResolvedValue({ ok: true, worldUid: 'w9', closedAt: 77, docs: [wire('world_carts_w9', { carts: ['c1', 'c2'] })] });
    vi.spyOn(HubClient, 'openWorlds').mockResolvedValue({ ok: true, worlds: [] });
    expect(await OpenWorlds.close('w9')).toEqual({ ok: true });
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit.mock.calls[0][0]).toMatchObject({ commitId: 'take_w9_77', ops: [{ kind: 'put', doc: { id: 'world_carts_w9' } }] });
    expect(HostedLink.markOf('w9')).toBeNull();
    expect(HostedLink.is('w9')).toBe(false);
    expect(OpenWorlds.offered('w9')).toBe(true);
  });

  it('a close whose answer was lost is asked again on the next beat, and nothing is played from the room meanwhile', async () => {
    doors({ w9: certOf('w9', ME) });
    HostedLink.remember('w9', 'MINE');
    const commit = vi.spyOn(StoreClient, 'commit').mockResolvedValue({ applied: true });
    const close = vi.spyOn(HubClient, 'closeWorld').mockResolvedValueOnce({ ok: false, status: 'OFFLINE', reason: 'This game\'s own server cannot be reached.' });
    expect(await OpenWorlds.close('w9')).toMatchObject({ ok: false });
    expect(HostedLink.markOf('w9')).toBe('CLOSING');
    expect(HostedLink.is('w9')).toBe(false);
    expect(commit).not.toHaveBeenCalled();

    close.mockResolvedValue({ ok: true, worldUid: 'w9', closedAt: 77, docs: [wire('world_carts_w9', { carts: [] })] });
    vi.spyOn(HubClient, 'openWorlds').mockResolvedValue({ ok: true, worlds: [] });
    await OpenWorlds.sync();
    expect(commit).toHaveBeenCalledTimes(1);
    expect(HostedLink.markOf('w9')).toBeNull();
  });

  it('one of this game\'s own that the hub no longer lists was closed from elsewhere: its shared part is taken back', async () => {
    doors({ w9: certOf('w9', ME) });
    HostedLink.remember('w9', 'MINE');
    const commit = vi.spyOn(StoreClient, 'commit').mockResolvedValue({ applied: true });
    vi.spyOn(HubClient, 'openWorlds').mockResolvedValue({ ok: true, worlds: [] });
    const close = vi.spyOn(HubClient, 'closeWorld').mockResolvedValue({ ok: true, worldUid: 'w9', closedAt: 9, docs: [wire('world_population_w9', { n: 1 })] });
    await OpenWorlds.sync();
    expect(close).toHaveBeenCalledWith('w9');
    expect(commit.mock.calls[0][0]).toMatchObject({ commitId: 'take_w9_9' });
    expect(HostedLink.markOf('w9')).toBeNull();
  });

  it('a world this account opened from this game is played from the room here after a restart, and one it does not hold is left alone', async () => {
    doors({ w9: certOf('w9', ME) });
    vi.spyOn(HubClient, 'openWorlds').mockResolvedValue({ ok: true, worlds: [row('w9', { mine: true, answering: false }), row('w8', { mine: true })] });
    const enter = vi.spyOn(HubClient, 'enterWorld');
    await OpenWorlds.sync();
    expect(HostedLink.markOf('w9')).toBe('MINE');
    expect(HostedLink.markOf('w8')).toBeNull();
    expect(enter).not.toHaveBeenCalled();
  });

  it('while the game is open it says its open worlds are still open, on a beat', async () => {
    vi.useFakeTimers();
    doors({ w9: certOf('w9', ME) });
    HostedLink.remember('w9', 'MINE');
    HostedLink.remember('w1', 'JOINED');
    const beat = vi.spyOn(HubClient, 'beatWorlds').mockResolvedValue({ ok: true, open: ['w9'] });
    vi.spyOn(HubClient, 'openWorlds').mockResolvedValue({ ok: true, worlds: [row('w9', { mine: true }), row('w1')] });
    const stop = OpenWorlds.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(beat).toHaveBeenCalledTimes(1);
    expect(beat).toHaveBeenCalledWith(['w9']);
    await vi.advanceTimersByTimeAsync(OPEN_BEAT_MS * 2);
    expect(beat).toHaveBeenCalledTimes(3);
    stop();
    await vi.advanceTimersByTimeAsync(OPEN_BEAT_MS * 2);
    expect(beat).toHaveBeenCalledTimes(3);
  });
});
