/**
 * RECON GETS ITS OWN VIEW, AND A MAP IS AN ITEM (D85): lines 125, 126. Registered before the build.
 *   125 Recon has its own view, reached without entering a world's field
 *   126 A scribe can write scan data into a map item, and reading one adds it to the
 *       reader's survey, as old as it was when scanned
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import React, { createElement } from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot, Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';

const db = new Map<string, any>();
vi.mock('../shared/entities/data/VectorStore', () => ({
  VectorNamespace: { CHARACTERS: 'characters', ITEMS: 'items', WORLDS: 'worlds', TRANSACTIONS: 'transactions', CONTENT: 'content', TERRITORIES: 'territories' },
  VectorStore: {
    get: async (_ns: string, id: string) => db.get(id) ?? null,
    put: async (doc: any) => { db.set(doc.id, doc); return true; },
    query: async () => [...db.values()],
    saveContent: async () => true,
    searchContent: async () => []
  }
}));
vi.mock('../src/entities/identity/certificateSystem', () => ({
  CertificateSystem: {
    signPayload: async (uid: string, payload: any) => ({ payload, signature: 'sig', certUid: uid, timestamp: 0 }),
    verifyPayload: async () => true,
    getPrivateKey: async () => null
  }
}));

import { IItem, IPlayer, ItemType } from '../shared/types';
import { SurveySystem, ISurveyEntry } from '../src/logic/systems/SurveySystem';
import { MapSystem, IMapItem, isMapItem } from '../src/logic/systems/MapSystem';
import { TEMPLATE_MINT_BILL } from '../shared/entities/hub/template';
import { ReconView, closeRecon, openRecon } from '../src/components/ReconView';
import { TemplateStudio } from '../src/components/TemplateStudio';
import { WorldCard } from '../src/components/MissionControl';
import { useAppView, useFeed, useSheet } from '../src/components/ui/stores';
import { useWorldStore, IWorldCard } from '../src/entities/world/store';
import { usePlayerStore } from '../src/entities/player/store';
import { useHubStore } from '../src/entities/hub/store';
import { useIdentityStore } from '../src/entities/identity/store';
import { EntityType, IWorldEntity, ScanLevel } from '../shared/entities/world/types';
import { WorldGenerator } from '../shared/entities/world/WorldGenerator';
import { inspectItem } from '../src/render/atoms/inspect';
import { itemArtFor } from '../src/render/atoms/items';
import { hashBytes } from '../shared/render/atoms/atoms';
import { ItemFactory } from '../shared/entities/item/ItemFactory';
import { CRAFTED_DEFINITIONS } from '../shared/entities/economy/data/recipeDefinitions';
import { Rng } from '../shared/logic/rng/DeterministicRNG';
import { FIRST_THEME_PACK, installShippedThemes } from '../shared/logic/theme/boot';

installShippedThemes();

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SRC = (p: string) => readFileSync(p, 'utf8');
const M = 60_000, H = 60 * M;
/** How long ago a small world was minted, for it to stand in each phase now. */
const MINTED_FOR = { UP: 10 * M, OFF: H + M, SCAN: H + 90 * M + M };
const CELL_PX = 32;

const CERT = (uid: string, name: string) => ({
  metadata: { uid, displayName: name, createdAt: 0 }, publicKey: {} as any, publicKeyJWK: {} as any
}) as any;

const card = (phase: keyof typeof MINTED_FOR, over: Partial<IWorldCard> = {}): IWorldCard => ({
  id: 'w1', seed: 'grey-reach', size: 16, createdAt: Date.now() - MINTED_FOR[phase], playerCount: 0, name: 'Grey Reach', difficulty: 'E',
  creator: 'x', extractionTaxRate: 0.05, deathPenalty: 'INVENTORY_LOSS', themeId: FIRST_THEME_PACK.themeId, ...over
});

// A world's land has a shape of its own, so these are sectors that really exist, side by side
const LAND = WorldGenerator.generate('grey-reach', 16).sectors;
const A = Object.values(LAND).find(s => LAND[`${s.x + 1},${s.y}`])!;
const NEXT_TO_A = LAND[`${A.x + 1},${A.y}`];
const B = Object.values(LAND).find(s => s.y > A.y + 1)!;
const KEY_A = `${A.x},${A.y}`, KEY_NEXT = `${NEXT_TO_A.x},${NEXT_TO_A.y}`, KEY_B = `${B.x},${B.y}`;

const mintRes = (defId: string, key: string): IItem => ItemFactory.createResourceItem(CRAFTED_DEFINITIONS[defId] as never, Rng.fromKey(key));
const scribeKit = () => [mintRes('crf_paper', 'map:paper'), mintRes('crf_ink', 'map:ink')];
const stash = () => usePlayerStore.getState().player.bank.stashTabs[0].items;
const primeStash = (items: IItem[]) => usePlayerStore.setState(s => ({
  player: { ...s.player, bank: { ...s.player.bank, stashTabs: [{ name: 'MAIN', items }] } }
}));
const entry = (level: number, generation: number, contacts: Record<string, number> = { MOB: 2 }, changed = 0): ISurveyEntry => ({ level, generation, contacts, changed });
const primeSurvey = (worldId: string, sectors: Record<string, ISurveyEntry>) => usePlayerStore.setState(s => ({
  player: { ...s.player, survey: { ...s.player.survey, [worldId]: sectors } }
}));
const survey = (worldId = 'w1') => usePlayerStore.getState().player.survey?.[worldId] ?? {};

const switchCharacter = (uid: string, name: string) => {
  useIdentityStore.setState({ certificate: CERT(uid, name) });
  usePlayerStore.getState().initializeSession(CERT(uid, name), 'NOMAD');
};

const body = (id: string, over: Partial<IWorldEntity> = {}): IWorldEntity => ({
  id, type: EntityType.MOB, definitionId: 'mob_secret_kind', position: { x: 0, y: 0 }, rank: 'E', rarity: 'COMMON', isHostile: true, ...over
} as IWorldEntity);

// --- the view, really mounted ---

let root: Root | null = null;
let host: HTMLDivElement;
const mount = async (el: React.ReactElement) => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root!.render(el); });
};
const text = () => host.textContent ?? '';
const clickSector = async (x: number, y: number) => {
  const canvas = host.querySelector('canvas')!;
  await act(async () => {
    canvas.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: x * CELL_PX + 2, clientY: y * CELL_PX + 2 }));
  });
};
const press = async (key: string) => { await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })); }); };
const clickButton = async (label: RegExp) => {
  const button = [...host.querySelectorAll('button')].find(b => label.test(b.textContent ?? ''));
  if (!button) throw new Error(`No button ${label}, in: ${text()}`);
  await act(async () => { button.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
};
const openOn = async (phase: keyof typeof MINTED_FOR, over: Partial<IWorldCard> = {}) => {
  useWorldStore.setState({ availableWorlds: [card(phase, over)] });
  await openRecon('w1');
};

beforeEach(() => {
  db.clear();
  localStorage.clear();
  useWorldStore.getState().exitWorld();
  useAppView.setState({ view: 'MISSIONS' });
  useFeed.setState({ lines: [] });
  useSheet.setState({ open: false });
  switchCharacter('uid_scribe', 'HALDE');
});

afterEach(async () => {
  if (root) await act(async () => { root!.unmount(); });
  root = null;
  host?.remove();
});

// -----------------------------------------------------------------------------
// LINE 125
// -----------------------------------------------------------------------------

describe("line 125: recon has its own view, reached without entering a world's field", () => {
  it('the field keeps none of it, and hands its own drop to the one view', () => {
    const field = SRC('src/components/WorldCanvas.tsx');
    expect(field).not.toMatch(/ReconOverlay/);
    expect(field).not.toMatch(/reconCell/);
    expect(field).not.toMatch(/SECTOR INTEL/);
    expect(field).not.toMatch(/scanSector/);
    expect(field).toMatch(/<ReconView onDrop=\{handleConfirmDrop\} \/>/);
  });

  it('it is a view of the app, not a window over the zones', () => {
    const app = SRC('App.tsx');
    expect(app).toMatch(/view === 'RECON'/);
    expect(app).toMatch(/closeRecon\(\)/);
    expect(SRC('src/components/MissionControl.tsx')).not.toMatch(/position: 'fixed'/);
  });

  it('it opens without a session, and leaving makes none', async () => {
    await openOn('SCAN');
    expect(useAppView.getState().view).toBe('RECON');
    expect(useWorldStore.getState().currentMap).not.toBeNull();
    expect(usePlayerStore.getState().player.currentSession).toBeUndefined();
    closeRecon();
    expect(useWorldStore.getState().currentMap).toBeNull();
    expect(usePlayerStore.getState().player.currentSession).toBeUndefined();
  });

  it('every card offers it while booting or open, and says so by which buttons stand', () => {
    const read = (phase: keyof typeof MINTED_FOR, over: Partial<IWorldCard> = {}) =>
      renderToStaticMarkup(createElement(WorldCard, { world: card(phase, over), onDeploy: () => {}, onSurvey: () => {} }));
    const enabled = (html: string, label: string) => new RegExp(`<button(?![^>]*disabled)[^>]*>[^<]*${label}`).test(html);

    expect(enabled(read('UP'), 'RECON')).toBe(true);
    expect(enabled(read('UP'), 'DEPLOY')).toBe(true);
    expect(enabled(read('SCAN'), 'RECON')).toBe(true);
    expect(read('SCAN')).not.toMatch(/DEPLOY/);
    expect(enabled(read('OFF'), 'RECON')).toBe(false);
    expect(enabled(read('OFF'), 'DEPLOY')).toBe(false);
    // The simulation stands outside the clock and still skips recon
    expect(read('UP', { isDebug: true })).not.toMatch(/RECON/);
  });

  it('during a boot it is recon only: the time shows, and nothing drops', async () => {
    await openOn('SCAN');
    await mount(createElement(ReconView));
    expect(text()).toMatch(/BOOTING, RECON ONLY/);
    expect(text()).toMatch(/\d\d:\d\d/);
    await clickSector(A.x, A.y);
    expect(text()).not.toMatch(/CONFIRM DROP/);
    await press('Enter');
    expect(usePlayerStore.getState().player.currentSession).toBeUndefined();
  });

  it('it scans, and what is read is saved on the character at the regeneration it stands in', async () => {
    await openOn('SCAN');
    await mount(createElement(ReconView));
    await clickSector(A.x, A.y);
    expect(survey()[KEY_A].generation).toBe(1);
    const first = survey()[KEY_A].level;
    expect(first).toBeGreaterThan(0);
    await clickSector(A.x, A.y);
    expect(survey()[KEY_A].level).toBeGreaterThanOrEqual(first);
  });

  it('the first touch on a stale sector shows what was known, the next scans and shows the change', async () => {
    primeSurvey('w1', { [KEY_A]: entry(ScanLevel.COMPLETE, 0, { MOB: 7 }) });
    await openOn('SCAN');
    await mount(createElement(ReconView));

    await clickSector(A.x, A.y);
    expect(text()).toMatch(/LAST READ/);
    expect(text()).toMatch(/1 regeneration\(s\) ago/);
    expect(text()).toMatch(/then: 7× MOB/);
    expect(survey()[KEY_A].generation).toBe(0);

    await clickSector(A.x, A.y);
    expect(survey()[KEY_A].generation).toBe(1);
    expect(survey()[KEY_A].prior?.generation).toBe(0);
    // Two clicks of one scan each climb back up from land only
    await clickSector(A.x, A.y);
    expect(text()).toMatch(/SINCE REGENERATION 0/);
    expect(text()).toMatch(/That have changed/);
  });

  it('it says where to start, and the keys walk, scan and leave', async () => {
    await openOn('SCAN');
    await mount(createElement(ReconView));
    expect(text()).toMatch(/WHERE TO START/);
    expect(text()).toMatch(/SCAN HERE/);

    await clickSector(A.x, A.y);
    await press('ArrowRight');
    await press(' ');
    expect(survey()[KEY_NEXT]).toBeDefined();
    expect(text()).toMatch(/Threat/); // it has something to say now


    await press('x');
    expect(useAppView.getState().view).toBe('MISSIONS');
  });

  it('the keys do not reach through an open sheet', async () => {
    await openOn('SCAN');
    await mount(createElement(ReconView));
    useSheet.setState({ open: true });
    await press('x');
    expect(useAppView.getState().view).toBe('RECON');
  });

  it('the map can be dragged, and a drag is not a scan', () => {
    const view = SRC('src/components/ReconView.tsx');
    expect(view).toMatch(/onPointerDown=\{startPan\}/);
    expect(view).toMatch(/dragged\.current/);
    expect(view).toMatch(/desk\.scrollLeft/);
  });

  it('while the world is open it leads to a drop, through the one door, at the sector chosen', async () => {
    await openOn('UP');
    await mount(createElement(ReconView));
    await clickSector(B.x, B.y);
    expect(usePlayerStore.getState().player.currentSession).toBeUndefined();
    await clickButton(/CONFIRM DROP/);
    expect(usePlayerStore.getState().player.currentSession).toBeDefined();
    expect(useAppView.getState().view).toBe('MISSIONS');

    // The field mounts the same view in its own mode, and that is where the order lands
    // and the door having reopened the world, the choice must stand again for the store's own confirm
    expect(useWorldStore.getState().selectedDropZone).toBeNull();
    const dropped = vi.fn(() => useWorldStore.getState().confirmDrop());
    await act(async () => { root!.render(createElement(ReconView, { onDrop: dropped })); });
    expect(dropped).toHaveBeenCalledTimes(1);
    expect(dropped).toHaveBeenCalledWith(B.x, B.y);
    expect(useWorldStore.getState().selectedDropZone).toEqual({ x: B.x, y: B.y });
    expect(useWorldStore.getState().reconMode).toBe(false);

    // An order is carried out once
    await act(async () => { root!.unmount(); });
    root = null;
    host.remove();
    const again = vi.fn();
    await mount(createElement(ReconView, { onDrop: again }));
    expect(again).not.toHaveBeenCalled();

    const view = SRC('src/components/ReconView.tsx');
    expect(view).toMatch(/deployToWorld\(/);
    expect(view).not.toMatch(/diveIntoLayer/);
  });

  it('a refusal at the door stays in the view and says why', async () => {
    usePlayerStore.setState(s => ({ player: { ...s.player, rest: { until: Date.now() + H, place: 'INN' } } }));
    await openOn('UP');
    await mount(createElement(ReconView));
    await clickSector(B.x, B.y);
    await clickButton(/CONFIRM DROP/);
    expect(usePlayerStore.getState().player.currentSession).toBeUndefined();
    expect(useAppView.getState().view).toBe('RECON');
    expect(useWorldStore.getState().currentMap).not.toBeNull();
    expect(useFeed.getState().lines.at(-1)?.text).toMatch(/at rest/);
  });

  it('with the gate down it reads only what it already held', async () => {
    await openOn('UP');
    // The gate goes down with the view still open
    useWorldStore.setState({ availableWorlds: [card('OFF')] });
    await mount(createElement(ReconView));
    expect(text()).toMatch(/GATE IS DOWN/);
    await clickSector(A.x, A.y);
    expect(survey()[KEY_A]).toBeUndefined();
    expect(text()).not.toMatch(/CONFIRM DROP/);
  });

  it('a regeneration under an open view reopens the world, so nothing is saved against the old one', async () => {
    await openOn('UP'); // generation 0
    useWorldStore.setState({ availableWorlds: [card('SCAN')] }); // now generation 1
    await mount(createElement(ReconView));
    await act(async () => { await vi.waitFor(() => expect(useWorldStore.getState().generation).toBe(1)); });
    await clickSector(A.x, A.y);
    expect(survey()[KEY_A].generation).toBe(1);
  });

  it('the drop inside a session keeps its own words and keys', async () => {
    await openOn('UP');
    const dropped = vi.fn();
    await mount(createElement(ReconView, { onDrop: dropped }));
    expect(text()).toMatch(/DRONE RECON/);
    expect(text()).toMatch(/WITHDRAW/);
    await press('Enter');
    expect(dropped).not.toHaveBeenCalled(); // no sector chosen
    await clickSector(A.x, A.y);
    expect(text()).toMatch(/CONFIRM DROP/);
    await press('Enter');
    expect(dropped).toHaveBeenCalledWith(A.x, A.y);
  });

  it('each state reads by its words and marks, with no meaning left to hue', () => {
    const view = SRC('src/components/ReconView.tsx');
    // The brackets are told apart by line and label, in one ink
    expect(view).toMatch(/\$\{dashed \? 'dashed' : 'solid'\} var\(--ws-text-bright\)/);
    expect(view).toMatch(/'DROP HERE' : 'SCAN HERE'/);
    expect(view).toMatch(/'SELECTED'/);
  });
});

// -----------------------------------------------------------------------------
// LINE 126: the law
// -----------------------------------------------------------------------------

describe('line 126: what a map holds, and what reading one does', () => {
  it('goes on paper as levels and counts, whatever else an entry comes to hold', () => {
    const scanned = SurveySystem.entry(ScanLevel.COMPLETE, 2, [body('a', { displayName: 'Honored Hound' }), body('b')]);
    const sheet = SurveySystem.mapSheet({ '1,1': { ...scanned, note: 'mob_secret_kind' } as ISurveyEntry });
    const paper = JSON.stringify(sheet);
    expect(paper).not.toContain('secret');
    expect(paper).not.toContain('Honored Hound');
    expect(sheet['1,1']).toEqual({ level: ScanLevel.COMPLETE, generation: 2, contacts: { MOB: 2 }, changed: 0 });
  });

  const reader = (held: Record<string, ISurveyEntry> = {}) => ({ id: 'r', survey: { w1: held } }) as unknown as IPlayer;

  it('adds what the reader lacks, as old as it was when scanned', () => {
    const { player, taken, kept } = SurveySystem.readMap(reader(), 'w1', { '1,1': entry(3, 2) });
    expect(taken).toBe(1);
    expect(kept).toBe(0);
    expect(player.survey!.w1['1,1'].generation).toBe(2);
    expect(SurveySystem.staleBy(player.survey!.w1['1,1'], 5)).toBe(3);
    expect(SurveySystem.levelNow(player.survey!.w1['1,1'], 5)).toBe(ScanLevel.BASIC);
    expect(SurveySystem.levelNow(player.survey!.w1['1,1'], 2)).toBe(3);
  });

  it('never overwrites a fresher entry', () => {
    const { player, taken, kept } = SurveySystem.readMap(reader({ '1,1': entry(1, 4, { MOB: 9 }) }), 'w1', { '1,1': entry(3, 2, { MOB: 1 }) });
    expect(taken).toBe(0);
    expect(kept).toBe(1);
    expect(player.survey!.w1['1,1']).toEqual(entry(1, 4, { MOB: 9 }));
  });

  it('in the same regeneration, only a deeper reading is news', () => {
    const shallower = SurveySystem.readMap(reader({ '1,1': entry(3, 2, { MOB: 9 }) }), 'w1', { '1,1': entry(1, 2) });
    expect(shallower.kept).toBe(1);
    expect(shallower.player.survey!.w1['1,1'].level).toBe(3);
    const deeper = SurveySystem.readMap(reader({ '1,1': entry(1, 2, {}) }), 'w1', { '1,1': entry(3, 2, { MOB: 4 }) });
    expect(deeper.taken).toBe(1);
    expect(deeper.player.survey!.w1['1,1'].contacts).toEqual({ MOB: 4 });
  });

  it("what the reader held before becomes the change it can see", () => {
    const { player } = SurveySystem.readMap(reader({ '1,1': entry(3, 1, { MOB: 2 }, 1) }), 'w1', { '1,1': entry(3, 3, { MOB: 5 }, 4) });
    expect(player.survey!.w1['1,1'].prior).toEqual({ contacts: { MOB: 2 }, changed: 1, generation: 1 });
    expect(player.survey!.w1['1,1'].contacts).toEqual({ MOB: 5 });
  });

  it('a map is for one world', () => {
    const start = { id: 'r', survey: { w2: { '1,1': entry(1, 1) } } } as unknown as IPlayer;
    const { player } = SurveySystem.readMap(start, 'w1', { '2,2': entry(3, 2) });
    expect(player.survey!.w2).toEqual({ '1,1': entry(1, 1) });
    expect(Object.keys(player.survey!.w1)).toEqual(['2,2']);
    expect(start.survey!.w1).toBeUndefined();
  });

  it('a fresh map is worth more than the same sectors gone stale, and a deeper one more than a shallow one', () => {
    const sheet = { '1,1': entry(3, 2), '1,2': entry(3, 2) };
    expect(SurveySystem.mapWorth(sheet, 2)).toBeGreaterThan(SurveySystem.mapWorth(sheet, 5));
    expect(SurveySystem.mapWorth(sheet, 2)).toBeGreaterThan(SurveySystem.mapWorth({ '1,1': entry(1, 2), '1,2': entry(1, 2) }, 2));
    expect(SurveySystem.mapWorth({}, 2)).toBeGreaterThan(0);
  });

  it('says how old a sheet runs', () => {
    expect(SurveySystem.mapSpread({ '1,1': entry(1, 2), '1,2': entry(1, 5), '1,3': entry(1, 3) })).toEqual({ sectors: 3, oldest: 2, newest: 5 });
  });
});

// -----------------------------------------------------------------------------
// LINE 126: the item, at the scribe's table
// -----------------------------------------------------------------------------

describe("line 126: a scribe writes a map, and it lands signed in the stash", () => {
  beforeEach(() => {
    useWorldStore.setState({ availableWorlds: [card('SCAN')] });
  });

  const written = async (): Promise<IMapItem> => {
    primeSurvey('w1', { '3,3': entry(3, 1, { MOB: 2, HARVEST: 1 }), '4,4': entry(1, 0, {}) });
    primeStash(scribeKit());
    const res = await MapSystem.write('w1');
    expect(res.ok, res.reason).toBe(true);
    return res.item!;
  };

  it('is paid for by the same bill as a plan, exactly once', async () => {
    expect(SRC('src/logic/systems/MapSystem.ts')).toMatch(/TemplateSystem\.payBill\(\)/);
    expect(SRC('src/logic/systems/TemplateSystem.ts')).toMatch(/pickBill\(TEMPLATE_MINT_BILL/);
    expect(TEMPLATE_MINT_BILL.map(l => l.tag)).toEqual(['paper', 'ink']);
    const item = await written();
    expect(stash().map(i => i.id)).toEqual([item.id]);
    expect(isMapItem(stash()[0])).toBe(true);
    expect(stash()[0].type).toBe(ItemType.MAP);
    expect(stash()[0].tags).toEqual(['document']);
  });

  it('refuses a short bill and takes nothing', async () => {
    primeSurvey('w1', { '3,3': entry(3, 1) });
    primeStash([mintRes('crf_paper', 'map:paper')]);
    const res = await MapSystem.write('w1');
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/short/);
    expect(stash().length).toBe(1);
  });

  it('refuses when nothing was scanned there, or the world is not on the registry', async () => {
    primeStash(scribeKit());
    expect((await MapSystem.write('w1')).reason).toMatch(/nothing/i);
    primeSurvey('gone', { '3,3': entry(3, 1) });
    expect((await MapSystem.write('gone')).reason).toMatch(/registry/);
    expect(stash().length).toBe(2);
  });

  it('holds who wrote it, of where, and every sector scanned, signed', async () => {
    const item = await written();
    expect(item.mapData.worldId).toBe('w1');
    expect(item.mapData.worldName).toBe('Grey Reach');
    expect(item.mapData.scribeUid).toBe('uid_scribe');
    expect(item.mapData.scribeName).toBe('HALDE');
    expect(item.mapData.sectors['3,3']).toEqual(entry(3, 1, { MOB: 2, HARVEST: 1 }));
    expect(Object.keys(item.mapData.sectors)).toHaveLength(2);

    const chain = db.get(`prov_${item.id}`);
    const event = chain.data.events[0].payload;
    expect(event.type).toBe('MINT');
    expect(event.context.origin).toBe('SURVEY');
    expect(event.context.authorUid).toBe('uid_scribe');
    expect(event.context.worldId).toBe('w1');
    expect(event.context.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify([...db.values()])).toContain('MAP_WRITTEN');
  });

  it('never carries a name: not in its data, its words, or its card', async () => {
    const scanned = SurveySystem.entry(ScanLevel.COMPLETE, 1, [body('a', { displayName: 'Honored Hound' }), body('b')]);
    primeSurvey('w1', { '3,3': scanned });
    primeStash(scribeKit());
    const item = (await MapSystem.write('w1')).item!;
    const everything = JSON.stringify(item) + JSON.stringify(inspectItem(item));
    expect(everything).not.toContain('secret');
    expect(everything).not.toContain('Honored Hound');
    expect(everything).toContain('Grey Reach');
  });

  it('reads on its card: where, how much, how old and whose hand', async () => {
    const card = inspectItem(await written());
    const rows = Object.fromEntries(card.rows);
    expect(rows.World).toBe('Grey Reach');
    expect(rows.Sectors).toBe('2');
    expect(rows.Scanned).toMatch(/regeneration 0 to 1/);
    expect(rows.Scribe).toBe('HALDE');
  });

  it('has a body like any other item', async () => {
    const item = await written();
    const art = itemArtFor(item);
    expect(art.w).toBeGreaterThan(0);
    expect(art.data.some(v => v !== 0)).toBe(true);
    expect(item.dimensions).toEqual({ width: 2, height: 2 });
    // Its art is what it holds, told apart by shape and value alone
    const other = { ...item, mapData: { ...item.mapData, sectors: { '9,1': entry(1, 0) } } };
    expect(hashBytes(itemArtFor(other).data)).not.toBe(hashBytes(art.data));
    const inks = new Set(art.data.filter(v => v !== 0));
    expect(inks.size).toBeGreaterThanOrEqual(2);
    expect(item.value).toBeGreaterThan(0);
    expect(JSON.parse(JSON.stringify(item)).mapData).toEqual(item.mapData);
  });

  it("the scribe's table writes one, and a sector list it can't pay for stays unwritten", async () => {
    primeSurvey('w1', { '3,3': entry(3, 1) });
    primeStash(scribeKit());
    await mount(createElement(TemplateStudio, { onClose: () => {} }));
    // The modal portals nothing: it renders in place
    await clickButton(/WRITE A MAP/);
    expect(text()).toMatch(/Grey Reach/);
    expect(text()).toMatch(/1 sector/);
    await clickButton(/WRITE \(1 PAPER, 1 INK\)/);
    await vi.waitFor(() => expect(stash().some(isMapItem)).toBe(true));
    await act(async () => { await Promise.resolve(); });
    const button = [...host.querySelectorAll('button')].find(b => /WRITE \(1 PAPER, 1 INK\)/.test(b.textContent ?? ''))!;
    expect(button.disabled).toBe(true);
  });
});

describe('line 126: another character reads it', () => {
  beforeEach(() => {
    useWorldStore.setState({ availableWorlds: [card('SCAN')] });
  });

  /** The scribe writes, and the map changes hands as bytes do: nothing shared but the item. */
  const handOver = async (sectors: Record<string, ISurveyEntry>): Promise<IItem> => {
    primeSurvey('w1', sectors);
    primeStash(scribeKit());
    const item = (await MapSystem.write('w1')).item!;
    switchCharacter('uid_reader', 'TENON');
    const passed = JSON.parse(JSON.stringify(item)) as IItem;
    primeStash([passed]);
    return passed;
  };

  it("the reader's survey shows those sectors at the regeneration they were scanned in", async () => {
    const item = await handOver({ [KEY_A]: entry(3, 1), [KEY_B]: entry(2, 0) });
    expect(survey()).toEqual({});
    const res = MapSystem.read(item.id);
    expect(res.ok).toBe(true);
    expect(res.taken).toBe(2);
    expect(survey()[KEY_A].generation).toBe(1);
    expect(survey()[KEY_B].generation).toBe(0);
    expect(SurveySystem.staleBy(survey()[KEY_B], 1)).toBe(1);
  });

  it('reading it uses nothing up, and a second reading adds nothing', async () => {
    const item = await handOver({ [KEY_A]: entry(3, 1) });
    expect(MapSystem.read(item.id).taken).toBe(1);
    expect(stash().map(i => i.id)).toEqual([item.id]);
    const again = MapSystem.read(item.id);
    expect(again.ok).toBe(true);
    expect(again.taken).toBe(0);
    expect(again.kept).toBe(1);
  });

  it('it changes hands over a counter like any plan, and rides the trade whole and signed', async () => {
    primeSurvey('w1', { [KEY_A]: entry(3, 1) });
    primeStash(scribeKit());
    const item = (await MapSystem.write('w1')).item!;
    useHubStore.setState({ activeHubId: null, lots: [], craftingJobs: [], rooms: {}, buildJobs: [] } as never);
    await useHubStore.getState().loadHub('hub_map');
    const seller = usePlayerStore.getState().player;
    const lotId = useHubStore.getState().lots[0].id;
    useHubStore.setState({ lots: useHubStore.getState().lots.map(l => l.id === lotId ? { ...l, ownerId: seller.id, ownerName: seller.username, structureType: 'VENDOR' } as typeof l : l) });
    expect(await useHubStore.getState().listItemForSale(lotId, item.id, 40)).toBe(true);
    expect(stash().some(i => i.id === item.id)).toBe(false);

    switchCharacter('uid_reader', 'TENON');
    usePlayerStore.setState(s => ({ player: { ...s.player, bank: { ...s.player.bank, gold: 500 } } }));
    expect(await useHubStore.getState().buyFromLot(lotId, item.id)).toBe(true);
    const bought = stash().find(i => i.id === item.id)!;
    expect(isMapItem(bought)).toBe(true);
    expect(MapSystem.read(bought.id).taken).toBe(1);
    expect(survey()[KEY_A].generation).toBe(1);
    const events = db.get(`prov_${item.id}`).data.events.map((e: { payload: { type: string } }) => e.payload.type);
    expect(events).toContain('TRANSFER');
  });

  it('refuses what is not a map in the stash', () => {
    primeStash(scribeKit());
    expect(MapSystem.read(stash()[0].id).ok).toBe(false);
    expect(MapSystem.read('nope').ok).toBe(false);
  });

  it('the view offers it, the map opens on the board at once, fresh reads deep and old reads land', async () => {
    const item = await handOver({ [KEY_A]: entry(3, 1), [KEY_B]: entry(3, 0) });
    await openRecon('w1');
    await mount(createElement(ReconView));
    expect(text()).toMatch(/MAP OF GREY REACH/);
    expect(text()).toMatch(/by HALDE/);
    expect(text()).toMatch(/2 sectors/);
    expect(useWorldStore.getState().currentMap!.sectors[KEY_A].scanLevel).toBe(ScanLevel.UNKNOWN);

    await clickButton(/READ/);
    expect(useWorldStore.getState().currentMap!.sectors[KEY_A].scanLevel).toBe(3);
    expect(useWorldStore.getState().currentMap!.sectors[KEY_B].scanLevel).toBe(ScanLevel.BASIC);
    expect(stash().map(i => i.id)).toEqual([item.id]);
    expect(useFeed.getState().lines.at(-1)?.text).toMatch(/2 sectors/);
    expect(text()).toMatch(/NOTHING NEW/);

    // The stale one shows its age the same way a scan of its own would
    await clickSector(B.x, B.y);
    expect(text()).toMatch(/LAST READ/);
    expect(text()).toMatch(/1 regeneration\(s\) ago/);
  });

  it('the view offers no map of another world', async () => {
    await handOver({ [KEY_A]: entry(3, 1) });
    useWorldStore.setState({ availableWorlds: [card('SCAN'), card('SCAN', { id: 'w2', name: 'Elsewhere', seed: 'other-world' })] });
    await openRecon('w2');
    await mount(createElement(ReconView));
    expect(text()).not.toMatch(/MAP OF GREY REACH/);
  });

  it('R reads the next map that still has something to say', async () => {
    await handOver({ [KEY_A]: entry(3, 1) });
    await openRecon('w1');
    await mount(createElement(ReconView));
    await press('r');
    expect(survey()[KEY_A]).toBeDefined();
    expect(text()).toMatch(/NOTHING NEW/);
  });
});
