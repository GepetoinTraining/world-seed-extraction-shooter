/**
 * BEFORE THE SECOND RUN: what leg 2's first run met, where a bug, a ruling or plain sense
 * already answers it. Registered before the fixes. The ledger's rows:
 *   N10 a deep scan's list prints raw ids, and the ground's own name never shows
 *   C7  a scan's leaders and packs run to hundreds of lines that read the same
 *   L6  one sector's count reads like a whole world's, with nothing saying how big a sector is
 *   L7  the advice says the way out is under your feet when it is somewhere in the sector
 *   C8  a missed round reads "They took it as: lands."
 *   C13 a line from the first day stands in the talk as if it were today's
 *   N13 "It costs more without the skill" where nothing costs more
 *   N14 a scroll read feeds "+0 health."
 *   T2  any error while drawing blanks the whole game
 *   C10 the field's own readout runs under the notices at the top centre
 *   C12 creation's first page grows under the pointer
 *   C11 the landing page says the page has no voice yet
 *   L3  the city's own lines say a piece's stored name
 *   W6  the bottom rung reads "Working toward fed."
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import React, { createElement } from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot, Root } from 'react-dom/client';

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

import { Rarity, UniversalRank } from '../shared/types';
import { EntityType, IWorldEntity, ScanLevel } from '../shared/entities/world/types';
import { SECTOR_TILES } from '../shared/entities/world/grid';
import { WorldGenerator } from '../shared/entities/world/WorldGenerator';
import { RESOURCE_DEFINITIONS } from '../shared/entities/item/data/resourceDefinitions';
import { ContentRegistry } from '../shared/logic/theme/ContentRegistry';
import { FIRST_THEME_PACK, installShippedThemes } from '../shared/logic/theme/boot';
import { ILogLine, JUDGE_BANDS } from '../shared/logic/systems/TalkTypes';
import { WebSystem } from '../shared/logic/systems/WebSystem';
import { SurveySystem } from '../src/logic/systems/SurveySystem';
import { ContactNames } from '../src/logic/systems/ContactNames';
import { suggestStart } from '../src/logic/systems/FieldInput';
import { TalkLaw } from '../src/logic/systems/TalkLaw';
import { LADDER } from '../src/logic/systems/NpcAgenda';
import { FieldWords } from '../src/logic/systems/FieldWords';
import { ReconView, openRecon } from '../src/components/ReconView';
import { CreationFlow } from '../src/components/CreationFlow';
import { ErrorBoundary } from '../src/components/ErrorBoundary';
import { useCreationDraft } from '../src/components/ui/creationDraft';
import { useAppView, useFeed, useSheet } from '../src/components/ui/stores';
import { useWorldStore, IWorldCard } from '../src/entities/world/store';
import { usePlayerStore } from '../src/entities/player/store';
import { useIdentityStore } from '../src/entities/identity/store';
import { IntelligenceClient } from '../src/logic/intelligence/IntelligenceClient';

installShippedThemes();

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SRC = (p: string) => readFileSync(p, 'utf8');
const CERT = (uid: string, name: string) => ({
  metadata: { uid, displayName: name, createdAt: 0 }, publicKey: {} as any, publicKeyJWK: {} as any
}) as any;

const mob = (id: string, over: Partial<IWorldEntity> = {}): IWorldEntity => ({
  id, type: EntityType.MOB, definitionId: 'secret_kind', position: { x: 0, y: 0 }, rank: UniversalRank.E, rarity: Rarity.COMMON, isHostile: true, health: 10, ...over
} as IWorldEntity);
const thing = (id: string, type: EntityType, definitionId: string, over: Partial<IWorldEntity> = {}): IWorldEntity => ({
  id, type, definitionId, position: { x: 0, y: 0 }, rank: UniversalRank.F, rarity: Rarity.COMMON, isHostile: false, ...over
} as IWorldEntity);

/** How many bodies a list of lines stands for, counted back out of what it says. */
const bodiesIn = (lines: ReturnType<typeof SurveySystem.manifest>) =>
  lines.reduce((sum, l) => sum + l.times * (l.mark === 'leader' ? 1 + (l.pack ?? 0) : l.count), 0);

let root: Root | null = null;
let host: HTMLDivElement;
const mount = async (el: React.ReactElement) => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root!.render(el); });
};
const text = () => host.textContent ?? '';
const buttons = () => [...host.querySelectorAll('button')] as HTMLButtonElement[];
const button = (name: RegExp) => buttons().find(b => name.test(b.textContent ?? '')) as HTMLButtonElement;
const click = async (name: RegExp) => {
  const b = button(name);
  expect(b, `a button ${name}`).toBeTruthy();
  await act(async () => { b.click(); await Promise.resolve(); });
};

beforeEach(() => {
  db.clear();
  localStorage.clear();
  useFeed.setState({ lines: [] });
  useSheet.setState({ open: false });
  useIdentityStore.setState({ certificate: CERT('uid_second', 'SCREE') } as any);
  usePlayerStore.getState().initializeSession(CERT('uid_second', 'SCREE'), 'NOMAD');
});

afterEach(async () => {
  if (root) await act(async () => { root!.unmount(); });
  root = null;
  host?.remove();
  vi.restoreAllMocks();
});

// -----------------------------------------------------------------------------
// N10: A SCAN'S LIST SAYS NAMES, NEVER IDS
// -----------------------------------------------------------------------------

describe("N10: a deep scan's list names what it saw, the way its card would", () => {
  const def = Object.values(RESOURCE_DEFINITIONS)[0];
  const seen = () => [
    thing('r1', EntityType.RESOURCE, def.id),
    thing('r2', EntityType.RESOURCE, def.id),
    thing('s1', EntityType.STRUCTURE, 'struct_ruin'),
    thing('c1', EntityType.CONTAINER, 'chest_plain', { container: { lootRank: UniversalRank.F, looted: false, hasLore: false } } as Partial<IWorldEntity>),
    thing('p1', EntityType.NPC, 'npc_survivor', { npc: { name: 'Orrin Error', temperament: 'PASSIVE', objective: 'WITNESS', want: 'GOLD', disposition: 50, attempts: 2 } }),
    thing('p2', EntityType.NPC, 'npc_survivor', { npc: { name: 'Sera Basalt', temperament: 'PASSIVE', objective: 'WITNESS', want: 'GOLD', disposition: 50, attempts: 0 } }),
    thing('p3', EntityType.NPC, 'npc_survivor', { npc: { name: 'Io Null', temperament: 'COWARD', objective: 'SURVIVE', want: 'GIFT', disposition: 40, attempts: 0 } }),
    thing('x1', EntityType.EXTRACTION, 'extraction_beacon')
  ];

  it('a thing to gather reads by its name once it is known', () => {
    const lines = SurveySystem.manifest(seen(), () => 1);
    const line = lines.find(l => l.label === def.name)!;
    expect(line, def.name).toBeDefined();
    expect(line.count).toBe(2);
  });

  it('and as an unknown substance while it is not, with its name kept back', () => {
    const lines = SurveySystem.manifest(seen(), () => 0);
    expect(lines.some(l => l.label === def.name)).toBe(false);
    expect(lines.find(l => l.label === 'Unknown Substance')!.count).toBe(2);
  });

  it('a ruin, a chest and an exit read as the field card names them', () => {
    const labels = SurveySystem.manifest(seen(), () => 1).map(l => l.label);
    expect(labels).toContain('Ruin');
    expect(labels).toContain('Chest');
    expect(labels).toContain('Exit');
  });

  it('a person is one of the unknown figures, and only one whose name the reader was told gives it', () => {
    // Ruled 2026-11-10: a name is known by being asked, not by having talked (tests/prerun.rulings.test.ts)
    const told = ContactNames.learnName({}, seen().find(e => e.id === 'p1')!);
    const lines = SurveySystem.manifest(seen(), () => 1, told);
    expect(lines.find(l => l.label === 'Unknown Figure')!.count).toBe(2);
    expect(lines.find(l => l.label === 'Orrin Error')!.count).toBe(1);
    const said = JSON.stringify(lines);
    expect(said).not.toContain('Sera Basalt');
    expect(said).not.toContain('Io Null');
  });

  it('no line is a raw id, whatever the reader knows', () => {
    for (const level of [0, 1, 3]) {
      for (const line of SurveySystem.manifest(seen(), () => level)) {
        expect(line.label, line.label).not.toMatch(/^(res|struct|npc|mob|chest|extraction)_/);
        expect(line.label).not.toContain(def.id);
      }
    }
  });

  it('a creature still gives only the name it has earned', () => {
    const lines = SurveySystem.manifest([mob('a'), mob('b', { displayName: 'Honored Hound' })], () => 3);
    expect(JSON.stringify(lines)).not.toContain('secret');
    expect(lines.map(l => l.label).sort()).toEqual(['Honored Hound', 'Unknown Contact']);
  });

  it('a kind of thing is counted in plain words', () => {
    expect(SurveySystem.counted('MOB', 1197)).toBe('1197 creatures');
    expect(SurveySystem.counted('MOB', 1)).toBe('1 creature');
    expect(SurveySystem.counted('NPC', 59)).toBe('59 people');
    expect(SurveySystem.counted('NPC', 1)).toBe('1 person');
    expect(SurveySystem.counted('RESOURCE', 2)).toBe('2 things to gather');
    for (const type of Object.values(EntityType)) expect(SurveySystem.counted(type, 3)).not.toContain(type);
    // A kind this list has never heard of still reads, in lower case
    expect(SurveySystem.counted('HARVEST', 2)).toBe('2 harvest');
  });
});

// -----------------------------------------------------------------------------
// C7: LINES THAT READ THE SAME ARE ONE LINE
// -----------------------------------------------------------------------------

describe('C7: leaders and packs that read the same share a line, and nothing is dropped', () => {
  const pack = (cx: number, size: number, over: Partial<IWorldEntity> = {}) =>
    Array.from({ length: size }, (_, i) => mob(`pop_${cx}_4_rat_${i}`, over));
  const led = (cx: number, followers: number, over: Partial<IWorldEntity> = {}) =>
    [mob(`lead_${cx}_2_0`, { rank: UniversalRank.D, ...over }), ...Array.from({ length: followers }, (_, i) => mob(`lead_${cx}_2_0_f${i}`))];

  it('forty packs of three that read alike are one line that says forty', () => {
    const bodies = Array.from({ length: 40 }, (_, cx) => pack(cx, 3)).flat();
    const lines = SurveySystem.packs(bodies);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ mark: 'pack', count: 3, times: 40 });
    expect(bodiesIn(lines)).toBe(bodies.length);
  });

  it('leaders with the same pack behind them share a line too', () => {
    const bodies = [...led(1, 5), ...led(2, 5), ...led(3, 5), ...led(4, 2)];
    const lines = SurveySystem.packs(bodies);
    expect(lines).toHaveLength(2);
    expect(lines.find(l => l.pack === 5)).toMatchObject({ mark: 'leader', times: 3 });
    expect(lines.find(l => l.pack === 2)).toMatchObject({ mark: 'leader', times: 1 });
    expect(bodiesIn(lines)).toBe(bodies.length);
  });

  it('what reads differently stays apart: another size, rank, name or danger', () => {
    const bodies = [
      ...pack(1, 3), ...pack(2, 4),
      ...pack(3, 3, { rank: UniversalRank.C }),
      ...pack(4, 3, { displayName: 'Tally Rat' }),
      ...pack(5, 3, { isHostile: false })
    ];
    const lines = SurveySystem.packs(bodies);
    expect(lines).toHaveLength(5);
    expect(lines.every(l => l.times === 1)).toBe(true);
    expect(bodiesIn(lines)).toBe(bodies.length);
  });

  it('a whole list still stands for every body it was given', () => {
    const bodies = [
      ...Array.from({ length: 30 }, (_, cx) => pack(cx, 2 + (cx % 3))).flat(),
      ...Array.from({ length: 12 }, (_, cx) => led(cx, 4 + (cx % 2))).flat(),
      ...Array.from({ length: 9 }, (_, i) => mob(`solo_${i}`))
    ];
    const lines = SurveySystem.manifest(bodies);
    expect(bodiesIn(lines)).toBe(bodies.length);
    expect(lines.length).toBeLessThan(10);
  });

  it('a line says how many it stands for, by a count ahead of its mark', () => {
    const [packs] = SurveySystem.packs(Array.from({ length: 40 }, (_, cx) => pack(cx, 3)).flat());
    expect(SurveySystem.say(packs)).toBe('! 40× ≡ PACK OF 3 [E] Unknown Contact');
    const [one] = SurveySystem.packs(pack(1, 3));
    expect(SurveySystem.say(one)).toBe('! ≡ PACK OF 3 [E] Unknown Contact');
    const leaders = SurveySystem.packs([...led(1, 5), ...led(2, 5)]);
    expect(SurveySystem.say(leaders[0])).toBe('! 2× ▲ LEADER [D] Unknown Contact, 5 behind each');
    expect(SurveySystem.say(SurveySystem.packs(led(1, 5))[0])).toBe('! ▲ LEADER [D] Unknown Contact, 5 behind it');
  });
});

// -----------------------------------------------------------------------------
// N10, L6, L7: THE VIEW ITSELF
// -----------------------------------------------------------------------------

describe('N10, L6, L7: recon reads in the world\'s own words', () => {
  const M = 60_000, H = 60 * M;
  const CELL_PX = 32;
  const card = (over: Partial<IWorldCard> = {}): IWorldCard => ({
    id: 'w1', seed: 'grey-reach', size: 16, createdAt: Date.now() - (H + 90 * M + M), playerCount: 0, name: 'Grey Reach', difficulty: 'E',
    creator: 'x', extractionTaxRate: 0.05, deathPenalty: 'INVENTORY_LOSS', themeId: FIRST_THEME_PACK.themeId, ...over
  });
  const LAND = WorldGenerator.generate('grey-reach', 16).sectors;
  const A = Object.values(LAND)[0];
  const clickSector = async (x: number, y: number) => {
    const canvas = host.querySelector('canvas')!;
    await act(async () => {
      canvas.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: x * CELL_PX + 2, clientY: y * CELL_PX + 2 }));
    });
  };
  const open = async () => {
    useWorldStore.getState().exitWorld();
    useAppView.setState({ view: 'MISSIONS' });
    useWorldStore.setState({ availableWorlds: [card()] });
    await openRecon('w1');
    await mount(createElement(ReconView));
  };

  it("the ground reads by the name this world gives it, and never by the game's own word for it", async () => {
    const named = ContentRegistry.regionName(FIRST_THEME_PACK.themeId, A.biome);
    expect(named, `a name for ${A.biome}`).toBeTruthy();
    await open();
    await clickSector(A.x, A.y);
    expect(text()).toContain(named!);
    expect(text()).not.toContain(A.biome);
  });

  it('a sector says how far across it is, so its counts read as one sector', async () => {
    await open();
    await clickSector(A.x, A.y);
    expect(text()).toContain(`${SECTOR_TILES} m across`);
  });

  it('what a scan counts and lists reads in plain words, with no id and no type name', async () => {
    await open();
    for (let i = 0; i < 3; i++) await clickSector(A.x, A.y);
    expect(useWorldStore.getState().currentMap!.sectors[`${A.x},${A.y}`].scanLevel).toBe(ScanLevel.COMPLETE);
    expect(text()).toMatch(/MANIFEST/);
    expect(text()).not.toMatch(/\d+× (MOB|RESOURCE|STRUCTURE|NPC|CONTAINER|EXTRACTION)\b/);
    expect(text()).not.toMatch(/\b(res|struct|npc)_[a-z0-9_]+/);
  });

  it('the list is given the reader\'s own knowledge of what grows there', () => {
    const view = SRC('src/components/ReconView.tsx');
    expect(view).toMatch(/SurveySystem\.manifest\(selected\.entities, WebSystem\.knowledgeReader\(player\), player\)/);
    expect(view).toMatch(/SurveySystem\.say\(line\)/);
    expect(view).not.toMatch(/\{count\}× \{type\}/);
  });

  it('where to start promises a beacon in the sector, and no nearer than that', () => {
    const sectors = { '2,3': { ...A, x: 2, y: 3, scanLevel: ScanLevel.BASIC, hasExtraction: true, difficulty: 'F' } } as never;
    const advice = suggestStart({ width: 16, height: 16, sectors });
    expect(advice.kind).toBe('DROP');
    expect(advice.why).not.toMatch(/under your feet/);
    expect(advice.why).toMatch(/beacon/);
    expect(advice.why).toMatch(/somewhere in/);
  });
});

// -----------------------------------------------------------------------------
// C8, C13: THE TALK'S WINDOW
// -----------------------------------------------------------------------------

describe('C8: how a line was taken is said in words the roll does not use', () => {
  it('every band has its words', () => {
    const said = JUDGE_BANDS.map(band => TalkLaw.tookAs(band));
    expect(new Set(said).size).toBe(JUDGE_BANDS.length);
    for (const words of said) expect(words.trim().length).toBeGreaterThan(0);
  });

  it('none of them says landed or missed, which are the roll\'s', () => {
    for (const band of JUDGE_BANDS) {
      expect(TalkLaw.tookAs(band), band).not.toMatch(/\bland|\bmiss/i);
      expect(TalkLaw.tookAs(band), band).not.toBe(band);
    }
  });

  it('they run from worst to best in the order the bands do', () => {
    expect(TalkLaw.tookAs('repels')).toMatch(/badly/);
    expect(TalkLaw.tookAs('moves')).toMatch(/well/);
  });

  it('the window says them, and never the band itself', () => {
    const view = SRC('src/components/TalkWindow.tsx');
    expect(view).toMatch(/TalkLaw\.tookAs\(last\.band\)/);
    expect(view).not.toMatch(/They took it as: \$\{last\.band\}/);
  });
});

describe('C13: a line from another day is marked as that day\'s', () => {
  const line = (day: number | undefined, text = 'x'): ILogLine => ({ who: 'NOTE', text, ...(day === undefined ? {} : { day }) });

  it('a talk that is all today\'s carries no mark', () => {
    expect(TalkLaw.dayMarks([line(9), line(9), line(9)], 9)).toEqual([null, null, null]);
    expect(TalkLaw.dayMarks([], 9)).toEqual([]);
  });

  it('older lines are marked where each day starts, and today\'s where today starts', () => {
    expect(TalkLaw.dayMarks([line(5), line(5), line(8), line(9), line(9)], 9)).toEqual(['4 DAYS AGO', null, 'YESTERDAY', 'TODAY', null]);
  });

  it('a line kept from before days were written reads as earlier', () => {
    expect(TalkLaw.dayMarks([line(undefined), line(undefined), line(9)], 9)).toEqual(['EARLIER', null, 'TODAY']);
  });

  it('a talk that keeps no days, as one in the field does, carries no mark', () => {
    expect(TalkLaw.dayMarks([line(undefined), line(undefined)], 9)).toEqual([null, null]);
  });

  it('with nothing said today, the old lines still say how old they are', () => {
    expect(TalkLaw.dayMarks([line(2), line(3)], 9)).toEqual(['7 DAYS AGO', '6 DAYS AGO']);
  });

  it('a city talk writes the day on each line it keeps, and the window draws the marks', () => {
    const store = SRC('src/entities/interaction/talkStore.ts');
    // Every line a city talk adds to its kept log goes through the one stamp
    expect(store).toMatch(/const today = \(line: ILogLine\): ILogLine => \(\{ \.\.\.line, day: worldDay\(\) \}\)/);
    const city = store.slice(store.indexOf('// ------ In the city'));
    expect(city.match(/today\(/g)!.length).toBeGreaterThanOrEqual(4);
    expect(SRC('src/components/TalkWindow.tsx')).toMatch(/TalkLaw\.dayMarks\(log, /);
  });
});

// -----------------------------------------------------------------------------
// N13, N14: WHAT THE FEED SAYS
// -----------------------------------------------------------------------------

describe('N13: a first try says it costs more only where it does', () => {
  const lastLine = () => useFeed.getState().lines.at(-1)?.text ?? '';

  it('the words differ by whether anything was charged for it', () => {
    expect(FieldWords.winging('Scavenging', false)).toMatch(/Winging it: Scavenging\./);
    expect(FieldWords.winging('Scavenging', false)).not.toMatch(/costs more/);
    expect(FieldWords.winging('Scavenging', false)).toMatch(/counts toward it/);
    expect(FieldWords.winging('Felling', true)).toMatch(/costs more without the skill/);
  });

  // Nobody here holds the skill or has tried it, so each of these is a first try
  beforeEach(() => usePlayerStore.setState(s => ({ player: { ...s.player, skillProgress: {}, bank: { ...s.player.bank, universalSkills: {} } } })));

  it('work that charged nothing more does not claim to have', () => {
    const pair = WebSystem.mint(['saw'], ['wood']);
    usePlayerStore.getState().workOn(pair, 0, 5);
    expect(lastLine()).toMatch(/Winging it/);
    expect(lastLine()).not.toMatch(/costs more/);
  });

  it('work that did charge more says so', () => {
    const pair = WebSystem.mint(['axe'], ['wood']);
    usePlayerStore.getState().workOn(pair, 0, 5, true);
    expect(lastLine()).toMatch(/costs more without the skill/);
  });

  it('gathering is the road that charges more, and it passes that on', () => {
    const store = SRC('src/entities/player/store.ts');
    expect(store).toMatch(/workOn\(pair, rankIndexOf\(def\.rank\), Math\.ceil\(10 \* quantity \* 0\.5\), effort\.winging\)/);
    expect(store).not.toMatch(/It costs more without the skill/);
  });
});

describe('N14: something used says what it did, and never "+0 health"', () => {
  it('a scroll read says it was read', () => {
    const said = FieldWords.consumed({ name: 'Writ of Breach', restore: 0, refill: 0, casts: true });
    expect(said.text).toBe('Writ of Breach: read.');
    expect(said.text).not.toMatch(/\+0/);
  });

  it('what restores says how much, and what harms says so as a loss', () => {
    expect(FieldWords.consumed({ name: 'Ration', restore: 12, refill: 0, casts: false })).toEqual({ text: 'Ration: +12 health.', tone: 'signal' });
    expect(FieldWords.consumed({ name: 'Bad Tonic', restore: -4, refill: 0, casts: false })).toMatchObject({ tone: 'loss' });
    expect(FieldWords.consumed({ name: 'Bad Tonic', restore: -4, refill: 0, casts: false }).text).toMatch(/-4 health/);
  });

  it('what only refills the day says energy, and what does neither claims nothing', () => {
    expect(FieldWords.consumed({ name: 'Day Moss', restore: 0, refill: 20, casts: false })).toEqual({ text: 'Day Moss: +20 energy.', tone: 'proof' });
    expect(FieldWords.consumed({ name: 'Chalk', restore: 0, refill: 0, casts: false }).text).not.toMatch(/\+0|health/);
  });

  it('from the belt it reads the same, and says the pack stayed shut', () => {
    const said = FieldWords.consumed({ name: 'Writ of Breach', restore: 0, refill: 0, casts: true, fromBelt: true });
    expect(said.text).not.toMatch(/\+0/);
    expect(said.text).toMatch(/belt/);
    expect(said.text).toMatch(/pack never opened/);
  });

  it('both ways of using a thing speak through it', () => {
    const store = SRC('src/entities/player/store.ts');
    expect(store.match(/FieldWords\.consumed\(/g)!.length).toBe(2);
    expect(store).not.toMatch(/\$\{restore\} health\./);
  });
});

// -----------------------------------------------------------------------------
// T2: A SCREEN THAT BREAKS SAYS SO
// -----------------------------------------------------------------------------

describe('T2: an error while drawing is said on screen, with a way back that keeps the run', () => {
  let broken = true;
  const Fragile: React.FC = () => {
    if (broken) throw new Error('the pane could not be composed');
    return createElement('div', null, 'THE FIELD');
  };

  beforeEach(() => {
    broken = true;
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('what broke is named, in place of a blank window', async () => {
    await mount(createElement(ErrorBoundary, null, createElement(Fragile)));
    expect(text()).toMatch(/THIS SCREEN STOPPED/);
    expect(text()).toContain('the pane could not be composed');
    expect(host.querySelector('[role="alert"]')).toBeTruthy();
  });

  it('trying again draws the same screen, with nothing reloaded', async () => {
    await mount(createElement(ErrorBoundary, null, createElement(Fragile)));
    broken = false;
    await click(/TRY AGAIN/);
    expect(text()).toBe('THE FIELD');
  });

  it('a screen that breaks again says so again', async () => {
    await mount(createElement(ErrorBoundary, null, createElement(Fragile)));
    await click(/TRY AGAIN/);
    expect(text()).toMatch(/THIS SCREEN STOPPED/);
  });

  it('a reload is offered second, and says what it costs in the field', async () => {
    await mount(createElement(ErrorBoundary, null, createElement(Fragile)));
    const labels = buttons().map(b => b.textContent ?? '');
    expect(labels.findIndex(l => /TRY AGAIN/.test(l))).toBeLessThan(labels.findIndex(l => /RELOAD/.test(l)));
    expect(text()).toMatch(/reload ends a run/i);
  });

  it('the field and the city each stand inside one, below what the app itself holds, so trying again keeps the run', () => {
    const app = SRC('App.tsx');
    // Where a person is (booted, in a hub, in a session) is the app's own state. A catch above it would start over.
    expect(app).toMatch(/<ErrorBoundary>\s*<WorldCanvas session=\{session\} \/>/);
    expect(app).toMatch(/<ErrorBoundary>\s*<TerminalBar /);
    expect(app.indexOf('useState')).toBeLessThan(app.indexOf('<ErrorBoundary>'));
  });

  it('the whole game stands inside a last one, which promises no more than a reload does', async () => {
    expect(SRC('index.tsx')).toMatch(/<ErrorBoundary whole>\s*<App \/>\s*<\/ErrorBoundary>/);
    await mount(createElement(ErrorBoundary, { whole: true, children: createElement(Fragile) }));
    expect(text()).toMatch(/THE GAME STOPPED/);
    expect(text()).toContain('the pane could not be composed');
    expect(text()).not.toMatch(/keeps where you are/);
    expect(text()).toMatch(/starts from the character list/);
    expect(text()).toMatch(/a run in the field ends/);
  });
});

// -----------------------------------------------------------------------------
// C10, C12: NOTHING MOVES OR HIDES UNDER THE POINTER
// -----------------------------------------------------------------------------

describe('C10: the field\'s readout keeps to its own column', () => {
  it('its first row wraps inside the column, so nothing runs under the notices at the top centre', () => {
    const field = SRC('src/components/WorldCanvas.tsx');
    expect(field).toMatch(/flexWrap: 'wrap' \}\}>\s*<Chip tone="signal">ACTIVE AGENT<\/Chip>/);
  });
});

describe('C12: creation\'s first page is the same size before and after a life is picked', () => {
  const flow = () => createElement(CreationFlow, { onMint: async () => {}, creating: false, error: null });

  beforeEach(() => {
    useCreationDraft.getState().reset();
    vi.spyOn(IntelligenceClient, 'grantSkills').mockResolvedValue({ status: 'NO_KEY' } as any);
  });

  it('the shapes stand on the page from the start, waiting', async () => {
    await mount(flow());
    expect(text()).toMatch(/THE SHAPE YOU WEAR/);
    for (const name of [/^\[ \]OPERATOR/, /^\[ \]STREET SAMURAI/, /^\[ \]NOMAD/, /^\[ \]ARCANIST/]) {
      expect(button(name), String(name)).toBeTruthy();
      expect(button(name).disabled).toBe(true);
    }
  });

  it('picking a life adds no control to the page, and opens the shapes', async () => {
    await mount(flow());
    const before = buttons().length;
    await click(/QUIET/);
    expect(buttons().length).toBe(before);
    expect(button(/NOMAD/).disabled).toBe(false);
    expect(button(/NOMAD/).getAttribute('aria-pressed')).toBe('true');
  });

  it('a shape that is waiting says so without colour', async () => {
    await mount(flow());
    expect(button(/ARCANIST/).getAttribute('aria-disabled')).toBe('true');
    expect(text()).toMatch(/PICK A LIFE FIRST/);
  });
});

// -----------------------------------------------------------------------------
// W6: EVERY RUNG OF THE LADDER FINISHES ITS SENTENCE
// -----------------------------------------------------------------------------

describe('W6: what a person is working toward reads as a sentence on every rung', () => {
  it('each rung names a thing to work toward, and none is a bare describing word', () => {
    for (const rung of LADDER) expect(rung.says, rung.need).toMatch(/^(a|an|the|more|being) /);
  });

  it('the bottom rung reads "Working toward being fed."', () => {
    const goal = TalkLaw.floorGoal({ binding: 'LADDER', need: 'survival', who: {}, memory: [], buildings: [], questTags: [] }).goal;
    expect(goal).toBe('Working toward being fed.');
  });
});

// -----------------------------------------------------------------------------
// L3: THE CITY NAMES A PIECE AS ITS CARD DOES
// -----------------------------------------------------------------------------

describe("L3: the city's own lines name a piece the way its card does", () => {
  const city = SRC('src/entities/hub/HubCanvas.tsx');

  it('none of them says a stored name outright: placing, reclaiming, building, the shelf, repair, the study list', () => {
    expect(city).not.toMatch(/\b(?:item|i|mat|material)\.name\b/);
  });

  it('what has not been read is named in one way, the card\'s', () => {
    expect(city).not.toMatch(/Unidentified signal/);
    expect(city.match(/LoadoutSystem\.shownName\(/g)!.length).toBeGreaterThanOrEqual(15);
  });
});

// -----------------------------------------------------------------------------
// C11: THE LANDING PAGE
// -----------------------------------------------------------------------------

describe('C11: the landing page says what the page can do today', () => {
  const page = SRC('landing/index.html');

  it('it no longer says the page has no voice, or that one is still to be built', () => {
    expect(page).not.toMatch(/no voice yet/);
    expect(page).not.toMatch(/next piece to be built/);
  });

  it('it says where a voice is set up, and that no key reaches the hub', () => {
    expect(page).toMatch(/THE VOICE/);
    expect(page).toMatch(/your own machine/);
    expect(page).toMatch(/never sent here/i);
  });
});
