/**
 * THE TUTORIAL WORLD AND RECON (Q2, Q4, Q11, Q14, Q46). Registered before the build.
 *   - the debug world becomes the tutorial world, and it is a newcomer's first order
 *   - it forces a scan on a known block, points the way out, and teaches contacts
 *   - nothing brought into it is lost there; everywhere else the first death stays hard
 *   - recon shows the land before any scan, so a person can choose where to scan
 *   - the free deed's danger defaults to the person's rank
 *   - nothing points at a boss
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

import { IItem, UniversalRank } from '../shared/types';
import { Tutorial, TUTORIAL_WORLD_ID, LESSONS } from '../src/logic/systems/Tutorial';
import { ReconView } from '../src/components/ReconView';
import { WorldCard } from '../src/components/MissionControl';
import { WORLD_DRAFT_DEFAULTS, draftDanger, useAppView, useFeed, useSheet } from '../src/components/ui/stores';
import { useWorldStore, IWorldCard } from '../src/entities/world/store';
import { usePlayerStore } from '../src/entities/player/store';
import { useIdentityStore } from '../src/entities/identity/store';
import { ScanLevel } from '../shared/entities/world/types';
import { WorldGenerator } from '../shared/entities/world/WorldGenerator';
import { BiomeType } from '../shared/entities/world/types';
import { reconCell } from '../src/render/atoms/recon';
import { quickDeployTargetId } from '../src/entities/hub/dialogue';
import { ItemFactory } from '../shared/entities/item/ItemFactory';
import { CRAFTED_DEFINITIONS } from '../shared/entities/economy/data/recipeDefinitions';
import { Rng } from '../shared/logic/rng/DeterministicRNG';
import { FIRST_THEME_PACK, installShippedThemes } from '../shared/logic/theme/boot';

installShippedThemes();

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SRC = (p: string) => readFileSync(p, 'utf8');
const M = 60_000;
const CELL_PX = 32;

const CERT = (uid: string, name: string) => ({
  metadata: { uid, displayName: name, createdAt: 0 }, publicKey: {} as any, publicKeyJWK: {} as any
}) as any;

const openWorld = (over: Partial<IWorldCard> = {}): IWorldCard => ({
  id: 'w1', seed: 'grey-reach', size: 16, createdAt: Date.now() - 10 * M, playerCount: 0, name: 'Grey Reach', difficulty: 'F',
  creator: 'x', extractionTaxRate: 0.05, deathPenalty: 'INVENTORY_LOSS', themeId: FIRST_THEME_PACK.themeId, ...over
});

const mintRes = (defId: string, key: string): IItem => ItemFactory.createResourceItem(CRAFTED_DEFINITIONS[defId] as never, Rng.fromKey(key));

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

beforeEach(() => {
  db.clear();
  localStorage.clear();
  useWorldStore.getState().exitWorld();
  useAppView.setState({ view: 'MISSIONS' });
  useFeed.setState({ lines: [] });
  useSheet.setState({ open: false });
  useIdentityStore.setState({ certificate: CERT('uid_new', 'FIRSTLING') });
  usePlayerStore.getState().initializeSession(CERT('uid_new', 'FIRSTLING'), 'NOMAD');
});

afterEach(async () => {
  if (root) await act(async () => { root!.unmount(); });
  root = null;
  host?.remove();
});

describe('Q14: the debug world becomes the tutorial world', () => {
  it('the zones list offers the tutorial first, and no debug world', async () => {
    await useWorldStore.getState().refreshWorlds();
    const first = useWorldStore.getState().availableWorlds[0];
    expect(first.id).toBe(TUTORIAL_WORLD_ID);
    expect(first.isTutorial).toBe(true);
    expect(first.name).not.toMatch(/DEBUG|SIMULATION/);
    expect(SRC('src/entities/world/store.ts')).not.toMatch(/SIMULATION_DEBUG/);
  });

  it('its card names it and carries no fixed agent count (Q41)', () => {
    const html = renderToStaticMarkup(createElement(WorldCard, { world: Tutorial.card(Date.now()), onDeploy: () => {}, onSurvey: () => {} }));
    expect(html).toMatch(/THE TUTORIAL/);
    expect(html).not.toMatch(/SIMULATION/);
    expect(html).not.toMatch(/AGENTS/);
    expect(html).toMatch(/DEPLOY/);
  });

  it('it is rank F and stands outside the clock, so it is open whenever a person is', () => {
    const card = Tutorial.card(0);
    expect(card.difficulty).toBe('F');
    expect(card.isDebug).toBe(true);
  });
});

describe('Q2: the tutorial is the first order', () => {
  it('quick deploy sends a newcomer to the tutorial, and after it is sealed, to a world of theirs', () => {
    useWorldStore.setState({ availableWorlds: [openWorld({ id: 'mine' }), Tutorial.card(Date.now())] });
    expect(quickDeployTargetId()).toBe(TUTORIAL_WORLD_ID);
    usePlayerStore.setState(s => ({ player: { ...s.player, tutorialSealedAt: Date.now() } }));
    expect(quickDeployTargetId()).toBe('mine');
  });

  it('with no world of their own, quick deploy still reaches the tutorial', () => {
    usePlayerStore.setState(s => ({ player: { ...s.player, tutorialSealedAt: Date.now() } }));
    useWorldStore.setState({ availableWorlds: [Tutorial.card(Date.now())] });
    expect(quickDeployTargetId()).toBe(TUTORIAL_WORLD_ID);
  });

  it('the card says it is the first order until it is sealed', async () => {
    await mount(createElement(WorldCard, { world: Tutorial.card(Date.now()), onDeploy: () => {}, onSurvey: () => {} }));
    expect(text()).toMatch(/FIRST ORDER/);
    await act(async () => { usePlayerStore.setState(s => ({ player: { ...s.player, tutorialSealedAt: Date.now() } })); });
    expect(text()).not.toMatch(/FIRST ORDER/);
  });

  it('the Hall board points a newcomer to it', () => {
    expect(SRC('src/components/GuildHall.tsx')).toMatch(/Tutorial\.firstOrderOpen/);
  });

  it('sealing a run out of the tutorial marks the first order done', () => {
    expect(SRC('src/components/WorldCanvas.tsx')).toMatch(/tutorialSealedAt: Date\.now\(\)/);
  });
});

describe('Q14: the tutorial forces a scan on a known block', () => {
  it('opening it goes to recon, not straight to the field', async () => {
    useWorldStore.setState({ availableWorlds: [Tutorial.card(Date.now())] });
    await useWorldStore.getState().selectWorld(TUTORIAL_WORLD_ID);
    expect(useWorldStore.getState().reconMode).toBe(true);
    expect(useWorldStore.getState().selectedDropZone).toBeNull();
  });

  it('the known block is the lowest threat, nearest the middle, the same every time', () => {
    const map = WorldGenerator.generate('dev-sandbox-v4', 32, { difficulty: UniversalRank.F } as never);
    const at = Tutorial.knownBlock(map);
    expect(Tutorial.knownBlock(map)).toEqual(at);
    const order = Object.values(UniversalRank) as string[];
    const lowest = Math.min(...Object.values(map.sectors).map(s => order.indexOf(String(s.difficulty))));
    expect(order.indexOf(String(map.sectors[`${at.x},${at.y}`].difficulty))).toBe(lowest);
  });

  it('only the known block scans, and the drop waits until it is read deep', () => {
    const map = WorldGenerator.generate('dev-sandbox-v4', 32, { difficulty: UniversalRank.F } as never);
    const at = Tutorial.knownBlock(map);
    const other = Object.values(map.sectors).find(s => s.x !== at.x || s.y !== at.y)!;
    expect(Tutorial.mayScan(map, at.x, at.y).ok).toBe(true);
    expect(Tutorial.mayScan(map, other.x, other.y).ok).toBe(false);
    expect(Tutorial.mayDrop(map, at.x, at.y).ok).toBe(false);
    const read = { ...map, sectors: { ...map.sectors, [`${at.x},${at.y}`]: { ...map.sectors[`${at.x},${at.y}`], scanLevel: ScanLevel.DETAILED } } };
    expect(Tutorial.mayDrop(read, at.x, at.y).ok).toBe(true);
    expect(Tutorial.mayDrop(read, other.x, other.y).ok).toBe(false);
  });

  it('in the view, another block refuses with a reason and the marked one scans', async () => {
    useWorldStore.setState({ availableWorlds: [Tutorial.card(Date.now())] });
    await useWorldStore.getState().selectWorld(TUTORIAL_WORLD_ID);
    const dropped: { x: number; y: number }[] = [];
    await mount(createElement(ReconView, { onDrop: (x: number, y: number) => { dropped.push({ x, y }); } }));
    expect(text()).toMatch(new RegExp(LESSONS.SCAN.title));
    const map = useWorldStore.getState().currentMap!;
    const at = Tutorial.knownBlock(map);
    const other = Object.values(map.sectors).find(s => Math.abs(s.x - at.x) + Math.abs(s.y - at.y) === 1)!;

    await clickSector(other.x, other.y);
    expect(useWorldStore.getState().currentMap!.sectors[`${other.x},${other.y}`].scanLevel).toBe(ScanLevel.UNKNOWN);
    expect(useFeed.getState().lines.at(-1)?.text).toMatch(/marked/);

    await clickSector(at.x, at.y);
    await clickSector(at.x, at.y);
    await clickSector(at.x, at.y);
    expect(useWorldStore.getState().currentMap!.sectors[`${at.x},${at.y}`].scanLevel).toBeGreaterThanOrEqual(ScanLevel.DETAILED);
    expect(text()).toMatch(new RegExp(LESSONS.DROP.title));

    await press('Enter');
    expect(dropped).toEqual([at]);
  });

  it('a lesson follows the person: scan, drop, contact, the way out, sealed', () => {
    const p = { scanned: false, inField: false, metContact: false, sealed: false };
    expect(Tutorial.step(p)).toBe('SCAN');
    expect(Tutorial.step({ ...p, scanned: true })).toBe('DROP');
    expect(Tutorial.step({ ...p, scanned: true, inField: true })).toBe('CONTACT');
    expect(Tutorial.step({ ...p, scanned: true, inField: true, metContact: true })).toBe('EXTRACT');
    expect(Tutorial.step({ ...p, sealed: true })).toBe('SEALED');
  });

  it('found in play: the contact lesson stands while a body is near, even one met at the landing', () => {
    const field = { scanned: true, inField: true, sealed: false };
    expect(Tutorial.step({ ...field, metContact: true, contactNear: true })).toBe('CONTACT');
    expect(Tutorial.step({ ...field, metContact: true, contactNear: false })).toBe('EXTRACT');
  });

  it('found in play: once sealed, a lesson no longer calls itself the first order', () => {
    expect(Tutorial.titleOf('DROP', true)).toMatch(/^FIRST ORDER/);
    expect(Tutorial.titleOf('DROP', false)).toMatch(/^THE TUTORIAL/);
  });

  it('found in play: the view starts its cursor on the marked block, and offers no drop elsewhere', async () => {
    useWorldStore.setState({ availableWorlds: [Tutorial.card(Date.now())] });
    await useWorldStore.getState().selectWorld(TUTORIAL_WORLD_ID);
    await mount(createElement(ReconView, { onDrop: () => {} }));
    const map = useWorldStore.getState().currentMap!;
    const at = Tutorial.knownBlock(map);
    expect(useWorldStore.getState().selectedDropZone).toEqual(at);
    await press(' ');
    expect(useWorldStore.getState().currentMap!.sectors[`${at.x},${at.y}`].scanLevel).toBeGreaterThan(ScanLevel.UNKNOWN);
    const other = Object.values(map.sectors).find(s => Math.abs(s.x - at.x) + Math.abs(s.y - at.y) === 1)!;
    await clickSector(other.x, other.y);
    expect(text()).not.toMatch(/CONFIRM DROP/);
  });

  it('the field shows the lesson and an arrow to the way out, in the tutorial only', () => {
    const field = SRC('src/components/WorldCanvas.tsx');
    expect(field).toMatch(/<TutorialGuide /);
    expect(SRC('src/components/TutorialGuide.tsx')).toMatch(/isTutorial/);
  });
});

describe('Q14, Q11: nothing brought into the tutorial is lost there; elsewhere the first death stays hard', () => {
  const dieWith = (penalty: IWorldCard['deathPenalty']) => {
    const kit = [mintRes('crf_paper', 'kit:paper'), mintRes('crf_ink', 'kit:ink')];
    usePlayerStore.setState(s => ({
      player: { ...s.player, bank: { ...s.player.bank, stashTabs: [{ name: 'MAIN', items: [] }] }, currentSession: { ...(s.player.currentSession ?? {} as never), inventory: kit, energy: 10 } as never }
    }));
    const outcome = usePlayerStore.getState().emergencyJackOut(penalty);
    return { kit, outcome, stash: usePlayerStore.getState().player.bank.stashTabs[0].items };
  };

  it('a death in the tutorial loses nothing', () => {
    const { kit, outcome, stash } = dieWith(Tutorial.card(0).deathPenalty);
    expect(outcome.lost).toEqual([]);
    expect(stash.map(i => i.id).sort()).toEqual(kit.map(i => i.id).sort());
  });

  it('found in play: its receipt says nothing was lost, not that the world keeps it', async () => {
    const { ReceiptScreen } = await import('../src/components/ReceiptScreen');
    const { useReceipt } = await import('../src/components/ui/stores');
    useReceipt.getState().show({ outcome: 'DIED', haul: [], haulValue: 0, tax: 0, worldName: 'THE TUTORIAL', durationMs: 0, actionCount: 0, spared: true });
    await mount(createElement(ReceiptScreen));
    expect(text()).toMatch(/THIS WORLD TAKES NOTHING/);
    expect(text()).not.toMatch(/ACKNOWLEDGE THE LOSS|KEEPS WHAT FELL/);
    expect(SRC('src/components/WorldCanvas.tsx')).toMatch(/spared: penalty === 'NONE'/);
  });

  it('a death in any other world takes what was carried', () => {
    const { kit, outcome } = dieWith(openWorld().deathPenalty);
    expect(outcome.lost.map(i => i.id).sort()).toEqual(kit.map(i => i.id).sort());
  });
});

describe('Q14: recon shows the land, so a person chooses where to scan', () => {
  const BIOMES = Object.values(BiomeType);
  const diff = (a: Uint8Array, b: Uint8Array) => { let n = 0; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++; return n / a.length; };

  it('before any scan, two kinds of ground read apart', () => {
    for (let i = 0; i < BIOMES.length; i++) for (let j = i + 1; j < BIOMES.length; j++) {
      const a = reconCell({ biome: BIOMES[i], scanLevel: 0, seed: 's', sx: 3, sy: 4 });
      const b = reconCell({ biome: BIOMES[j], scanLevel: 0, seed: 's', sx: 3, sy: 4 });
      expect(diff(a.data, b.data), `${BIOMES[i]} vs ${BIOMES[j]}`).toBeGreaterThanOrEqual(0.12);
    }
  });

  it('the view says what the land shows and what only a scan reads', async () => {
    useWorldStore.setState({ availableWorlds: [openWorld()] });
    await useWorldStore.getState().selectWorld('w1');
    await mount(createElement(ReconView, { onDrop: () => {} }));
    expect(text()).toMatch(/land shows from above/i);
    expect(text()).toMatch(/a scan reads/i);
  });

  it('in another world, any block scans', async () => {
    useWorldStore.setState({ availableWorlds: [openWorld()] });
    await useWorldStore.getState().selectWorld('w1');
    await mount(createElement(ReconView, { onDrop: () => {} }));
    const map = useWorldStore.getState().currentMap!;
    const s = Object.values(map.sectors).find(x => !Tutorial.isKnownBlock(map, x.x, x.y))!;
    await clickSector(s.x, s.y);
    expect(useWorldStore.getState().currentMap!.sectors[`${s.x},${s.y}`].scanLevel).toBeGreaterThan(ScanLevel.UNKNOWN);
  });
});

describe('Q4: the free deed\'s danger defaults to the person\'s rank', () => {
  it('an untouched draft takes the rank, and a hand-set one keeps its own', () => {
    expect(draftDanger(WORLD_DRAFT_DEFAULTS, UniversalRank.F)).toBe('F');
    expect(draftDanger(WORLD_DRAFT_DEFAULTS, UniversalRank.C)).toBe('C');
    expect(draftDanger({ ...WORLD_DRAFT_DEFAULTS, difficulty: 'B' }, UniversalRank.F)).toBe('B');
  });

  it('the creator reads it through that one door', () => {
    expect(SRC('src/components/WorldCreator.tsx')).toMatch(/draftDanger\(draft, ProgressionSystem\.rankOf\(player\)\)/);
  });
});

describe('Q46: nothing points at a boss', () => {
  it('the known block and the lessons read no leader and no held ground', () => {
    const src = SRC('src/logic/systems/Tutorial.ts');
    expect(src).not.toMatch(/import[^;]*(Leaders|Territory|Wards)/);
    for (const lesson of Object.values(LESSONS)) expect(`${lesson.title} ${lesson.body}`).not.toMatch(/boss/i);
  });
});
