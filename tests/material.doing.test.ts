/**
 * WHAT A MATERIAL DOES, WRITTEN ONCE (ML, part 4). Pedro, 2026-11-12: "lazily we add what each material does, and
 * that's the whole loop", and "once something exists it's determined, and the skill always gives the same thing".
 *
 * The first time anyone needs to know what a material does (it is studied, or it is put into something), that is
 * written then: asked through the one door, judged by the law, kept and stored so any later world that uses the
 * material reads the same. It is never rewritten or rerolled. Until then it reads as not yet known. With no key it is
 * its base's doing; a base with nothing above it reads its own from what it is made of. A key that arrives later does
 * not replace what was written without one. Every door here is a stub: nothing is spent.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';

const saved = new Map<string, unknown>();
vi.mock('../shared/entities/data/VectorStore', () => ({
  VectorNamespace: { CHARACTERS: 'characters', ITEMS: 'items', WORLDS: 'worlds', TRANSACTIONS: 'transactions', CONTENT: 'content', TERRITORIES: 'territories' },
  VectorStore: {
    get: async (_ns: string, id: string) => (saved.has(id) ? { data: { content: saved.get(id) } } : null),
    put: async () => true, query: async () => [],
    saveContent: async (id: string, _type: string, content: unknown) => { saved.set(id, content); return true; },
    searchContent: async () => [...saved.values()]
  }
}));

import { Rarity, UniversalRank } from '../shared/types';
import { EntityType } from '../shared/entities/world/types';
import { RESOURCE_DEFINITIONS, ResourceDef } from '../shared/entities/item/data/resourceDefinitions';
import { ContentRegistry } from '../shared/logic/theme/ContentRegistry';
import { FIRST_THEME_PACK, installShippedThemes } from '../shared/logic/theme/boot';
import { PASSIVE_STATS, STAT_BANDS } from '../shared/logic/theme/ThemeTypes';
import { DoingBook, MaterialDoing, DOING_SCHEMA } from '../shared/logic/systems/MaterialDoing';
import { SpreadBook } from '../shared/entities/world/Spread';
import { schemaProblem } from '../shared/logic/content/SchemaFit';
import { MODEL_FOR } from '../shared/intelligence/claude';
import { buildDoingRequest } from '../shared/intelligence/prompts';
import { DoingStore, MaterialDoingWriter } from '../src/logic/theme/writing/MaterialDoingWriter';
import { inspectEntity, inspectItem } from '../src/render/atoms/inspect';
import { usePlayerStore } from '../src/entities/player/store';
import { ItemFactory } from '../shared/entities/item/ItemFactory';
import { Rng } from '../shared/logic/rng/DeterministicRNG';
import { statWord } from '../src/logic/systems/StatWords';
// A few of the voice bar's builders' words (tests/game.voice.test.ts reads the source of every shown line besides)
const BUILDERS_WORDS = [/formula/i, /\blaw\b/i, /factor/i, /rating/i, /\btags?\b/i, /\bnodes?\b/i].map(word => ({ word }));

installShippedThemes();

const keyOf = (id: string) => id.replace(/^res_[0-9a-f]+_/, '');
const byKey = (key: string) => Object.values(RESOURCE_DEFINITIONS).find(d => keyOf(d.id) === key && d.themeId === FIRST_THEME_PACK.themeId)! as ResourceDef;
const iron = () => byKey('collateral_iron');
const silver = () => byKey('sovereign_silver');
const wheat = () => byKey('chaffwheat');
const reed = () => byKey('tellers_reed');

type Door = (ask: unknown) => Promise<{ status: string; data?: unknown; reason?: string }>;
const offline: Door = async () => ({ status: 'NO_KEY', reason: 'no key' });
const answering = (answer: unknown, seen: unknown[] = []): Door => async ask => { seen.push(ask); return { status: 'OK', data: answer }; };
const GOOD = { stat: statWord('defense'), band: 'moderate', line: 'What is made of it turns a blow aside.' };

beforeEach(() => {
  saved.clear();
  DoingBook.forget();
  SpreadBook.enter(ContentRegistry.contextFor(FIRST_THEME_PACK.themeId, UniversalRank.F).resourceDefinitions as ResourceDef[], FIRST_THEME_PACK.themeId);
});

describe('ML21: what a material does is words the law judges', () => {
  it('a doing names one thing a piece can carry, by its word, how strongly, and one plain line', () => {
    expect(schemaProblem(DOING_SCHEMA, GOOD)).toBeNull();
    const judged = MaterialDoing.judge(GOOD, iron());
    expect('doing' in judged && judged.doing).toMatchObject({ stat: 'defense', band: 'moderate', line: GOOD.line });
  });

  it('the law refuses a stat nothing reads, a band out of the words, a line with a number, one that names the material, and a builders\' word', () => {
    for (const bad of [
      { ...GOOD, stat: 'flight' },
      { ...GOOD, band: 'huge' },
      { ...GOOD, line: 'It adds 12 to what is made.' },
      { ...GOOD, line: `${iron().name} makes a thing harder.` },
      { ...GOOD, line: 'The formula reads it as harder.' },
      { ...GOOD, line: '' }
    ]) expect('reason' in MaterialDoing.judge(bad, iron())).toBe(true);
  });

  it('what is asked carries the material as a person could know it and the words a piece can carry, never a number', () => {
    const ask = MaterialDoing.askOf(silver(), FIRST_THEME_PACK) as any;
    expect(ask.material.name).toBe(silver().name);
    expect(ask.stats).toEqual(PASSIVE_STATS.map(statWord));
    expect(ask.bands).toEqual([...STAT_BANDS]);
    expect(JSON.stringify(ask)).not.toMatch(/materialProps|HARDNESS|DENSITY/);
  });

  it('the door has a kind of its own, on the quick model', () => {
    expect(MODEL_FOR.doing).toMatch(/haiku/);
    const req = buildDoingRequest({ material: { name: 'x' } });
    expect(req.kind).toBe('doing');
    expect(req.schema).toBe(DOING_SCHEMA);
  });
});

describe('ML21: written the first time it is needed, and never again', () => {
  it('not yet known until needed; then the door writes it, the law judges it, and it is kept', async () => {
    expect(DoingBook.of(iron().id)).toBeNull();
    const seen: unknown[] = [];
    const doing = await MaterialDoingWriter.need(iron(), answering(GOOD, seen));
    expect(seen.length).toBe(1);
    expect(doing).toMatchObject({ material: iron().id, stat: 'defense', band: 'moderate', by: 'model' });
    expect(DoingBook.of(iron().id)).toEqual(doing);
    expect(await DoingStore.load(iron().id)).toEqual(doing);
  });

  it('what is written stands: asked again, from any world, the door is not asked and the same is read', async () => {
    const first = await MaterialDoingWriter.need(iron(), answering(GOOD));
    const seen: unknown[] = [];
    const other = { ...GOOD, stat: statWord('max_health'), line: 'Something else entirely.' };
    expect(await MaterialDoingWriter.need(iron(), answering(other, seen))).toEqual(first);
    // A later world, after the book in memory is gone: read from what was stored
    DoingBook.forget();
    expect(await MaterialDoingWriter.need(iron(), answering(other, seen))).toEqual(first);
    expect(seen.length).toBe(0);
  });

  it('two needs at once write it once', async () => {
    const seen: unknown[] = [];
    const [a, b] = await Promise.all([MaterialDoingWriter.need(iron(), answering(GOOD, seen)), MaterialDoingWriter.need(iron(), answering(GOOD, seen))]);
    expect(a).toEqual(b);
    expect(seen.length).toBe(1);
  });

  it('a refused answer is asked once more, told why; refused twice, it falls back as if no key', async () => {
    const asks: any[] = [];
    const door: Door = async ask => { asks.push(ask); return { status: 'OK', data: { ...GOOD, stat: 'flight' } }; };
    const doing = await MaterialDoingWriter.need(silver(), door);
    const ofSilver = asks.filter(a => a.material.name === silver().name);
    expect(ofSilver.length).toBe(2);
    expect(ofSilver[1].refused).toBeTruthy();
    expect(doing.by).not.toBe('model');
  });
});

describe('ML21: with no key, a variant is its base\'s doing; a base reads its own', () => {
  it('a base with nothing above it reads what it does from what it is made of, the same every time', async () => {
    const doing = await MaterialDoingWriter.need(iron(), offline);
    expect(doing.by).toBe('own');
    expect(PASSIVE_STATS).toContain(doing.stat);
    expect(MaterialDoing.fromOwn(iron())).toMatchObject({ stat: doing.stat, band: doing.band, line: doing.line });
  });

  it('a variant with no key takes its base\'s doing, and the base\'s is written with it', async () => {
    const doing = await MaterialDoingWriter.need(silver(), offline);
    const base = DoingBook.of(iron().id)!;
    expect(base).toBeTruthy();
    expect(doing).toMatchObject({ by: 'base', from: iron().id, stat: base.stat, band: base.band, line: base.line });
    const grain = await MaterialDoingWriter.need(reed(), offline);
    expect(grain.from).toBe(wheat().id);
  });

  it('a key arriving later does not replace what was written without one', async () => {
    const before = await MaterialDoingWriter.need(silver(), offline);
    const seen: unknown[] = [];
    expect(await MaterialDoingWriter.need(silver(), answering(GOOD, seen))).toEqual(before);
    expect(seen.length).toBe(0);
  });
});

describe('ML21: it is needed when a place is studied or a material is put into something', () => {
  const SRC = (p: string) => readFileSync(p, 'utf8');
  it('a sitting that lands well on a place, or on a piece of a material, asks for it; so does setting one material on another', () => {
    expect(SRC('src/logic/systems/StudyDoor.ts')).toMatch(/MaterialDoingWriter\.need\(/);
    expect(SRC('src/entities/player/store.ts')).toMatch(/MaterialDoingWriter\.need\(/);
  });
});

describe('ML21: a person reads it on the card, in the game\'s voice', () => {
  const player = () => usePlayerStore.getState().player;
  const knowing = (level: number) => usePlayerStore.setState(s => ({ player: { ...s.player, materialMastery: { [iron().id]: { resourceId: iron().id, knowledgeLevel: level, discoveredAffixes: [] } } } }));
  const place = { id: 'ent_0_0_r0', type: EntityType.RESOURCE, definitionId: iron().id, position: { x: 0, y: 0 }, rank: UniversalRank.F, rarity: Rarity.COMMON, isHostile: false, usesRemaining: 4 } as never;
  const does = (rows: [string, string][]) => rows.find(([k]) => k === 'Does')?.[1];

  it('known by name and not yet written: "not yet known"; unknown, nothing is said of it', async () => {
    knowing(1);
    expect(does(inspectEntity(place, { player: player(), dist: 1, level: () => 1 }).rows)).toBe('Not yet known');
    knowing(0);
    expect(does(inspectEntity(place, { player: player(), dist: 1, level: () => 0 }).rows)).toBeUndefined();
  });

  it('once written, the place\'s card and a piece\'s card say its line', async () => {
    const doing = await MaterialDoingWriter.need(iron(), answering(GOOD));
    knowing(1);
    expect(does(inspectEntity(place, { player: player(), dist: 1, level: () => 1 }).rows)).toBe(doing.line);
    const piece = ItemFactory.createResourceItem(iron(), Rng.fromKey('piece'));
    expect(does(inspectItem(piece, player()).rows)).toBe(doing.line);
  });

  it('every line a base can read of its own is the game\'s voice', () => {
    for (const def of ContentRegistry.contextFor(FIRST_THEME_PACK.themeId, UniversalRank.F).resourceDefinitions as ResourceDef[]) {
      if (!def.habitat) continue;
      const own = MaterialDoing.fromOwn(def);
      for (const { word } of BUILDERS_WORDS) expect(own.line).not.toMatch(word);
      expect(own.line).not.toMatch(/\d|_/);
    }
  });
});
