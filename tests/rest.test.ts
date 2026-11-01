/**
 * EFFECTS, MONSTERS, THE DIRECTOR, THE REST AND SPELLCRAFT: lines 78–83, 86–93.
 * No bar calls a model. Monsters and wind-ups run on a faked clock.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { IPlayer, Rarity, UniversalRank } from '../types';
import { EffectSystem, IEffectAbility, StatusClock } from '../src/logic/systems/EffectSystem';
import { WeaveSystem } from '../src/logic/systems/WeaveSystem';
import { RestSystem, IDreamResult, emptyQueue } from '../src/logic/systems/RestSystem';
import { Director, emptyDirectorRecord } from '../src/entities/world/Director';
import { ContentRegistry } from '../src/logic/theme/ContentRegistry';
import { FIRST_THEME_PACK, installShippedThemes } from '../src/logic/theme/boot';
import { FIRST_THEME } from '../src/entities/generation/packs/firstTheme';
import { sealTheme } from '../src/logic/theme/ThemeCompiler';
import { WorldGenerator } from '../src/entities/world/WorldGenerator';
import { MobAI } from '../src/entities/mob/ai/MobAI';
import { BiomeType, EntityType, IChunk, IWorldEntity, ScanLevel } from '../src/entities/world/types';
import { MOB_DEFINITIONS } from '../src/entities/mob/data/mobDefinitions';
import { SECTOR_CHUNKS } from '../src/entities/world/grid';
import { usePlayerStore } from '../src/entities/player/store';
import { StudySystem } from '../src/logic/systems/StudySystem';
import { ItemFactory } from '../src/entities/item/ItemFactory';
import { Rng } from '../src/logic/rng/DeterministicRNG';
import { StatSystem } from '../src/logic/systems/StatSystem';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { inspectEntity } from '../src/render/atoms/inspect';
import { CombatSystem } from '../src/entities/combat/CombatSystems';
import { LootTable } from '../src/entities/world/LootTable';
import { ThemePreview } from '../src/components/ThemeTalk';

installShippedThemes();
const themeId = FIRST_THEME_PACK.themeId;
const compiled = ContentRegistry.compiled(themeId)!;
const abilityByName = (name: string) => Object.values(compiled.abilities).find(a => a.name === name)!;
const mobByName = (name: string) => Object.values(compiled.mobs).find(m => m.name === name)!;

const chunkWith = (entities: IWorldEntity[]): Record<string, IChunk> => ({
  '0,0': {
    id: 'c', x: 0, y: 0, biome: BiomeType.RUINS, difficulty: UniversalRank.F, rarity: Rarity.COMMON,
    entities, scanLevel: ScanLevel.COMPLETE, isTraversable: true, hasExtraction: false
  } as IChunk
});
const body = (def: { id: string; rank: unknown; baseHealth: number }, id = 'body1', x = 0): IWorldEntity => ({
  id, type: EntityType.MOB, definitionId: def.id, position: { x, y: 0 },
  rank: def.rank as UniversalRank, rarity: Rarity.COMMON, isHostile: true, health: def.baseHealth
});

const run = (chunks: Record<string, IChunk>, player: { x: number; y: number }, ms: number, step = 50) => {
  const patterns: { type: string; damage?: number; abilityId?: string; reachPx?: number; status?: unknown }[] = [];
  const telegraphs: unknown[] = [];
  for (let t = 0; t < ms; t += step) {
    vi.advanceTimersByTime(step);
    const out = MobAI.tick(chunks, player, step / 1000);
    patterns.push(...out.spawnedPatterns);
    chunks = { ...chunks, ...out.updatedChunks };
    const seen = chunks['0,0'].entities[0];
    if (seen?.telegraph) telegraphs.push(seen.telegraph);
  }
  return { chunks, patterns, telegraphs };
};

describe('line 78: one effect door', () => {
  const ability = (over: Partial<IEffectAbility> = {}): IEffectAbility => ({ id: 'a', name: 'A', elements: ['debt'], delivery: 'ranged', effect: 'damage', cost: 'medium', ...over });

  it('the same key gives the same receipt, and another key may differ', () => {
    const a = EffectSystem.resolve(ability(), { rank: 'D' }, 'k1');
    expect(EffectSystem.resolve(ability(), { rank: 'D' }, 'k1')).toEqual(a);
    const rolled = new Set(Array.from({ length: 40 }, (_, i) => EffectSystem.resolve(ability(), { rank: 'D' }, `k${i}`).magnitude));
    expect(rolled.size).toBeGreaterThan(1);
  });

  it('rank and cost move the numbers, from the one formula', () => {
    const at = (rank: string, cost: IEffectAbility['cost']) => EffectSystem.resolve(ability({ cost }), { rank }, 'k').magnitude;
    expect(at('S', 'medium')).toBeGreaterThan(at('F', 'medium'));
    expect(at('D', 'high')).toBeGreaterThan(at('D', 'low'));
  });

  it('what an effect leaves is a clock: a slow, a burn, a ward, by shape of the effect', () => {
    expect(EffectSystem.resolve(ability({ effect: 'control' }), { rank: 'D' }, 'k').status?.kind).toBe('slow');
    expect(EffectSystem.resolve(ability({ effect: 'debuff' }), { rank: 'D' }, 'k').status?.kind).toBe('dot');
    expect(EffectSystem.resolve(ability({ effect: 'ward', delivery: 'self' }), { rank: 'D' }, 'k').status?.kind).toBe('ward');
  });

  it('statuses run on the clock, a ward spends itself, and a slow takes from pace', () => {
    let s = StatusClock.add([], { kind: 'dot', magnitude: 3, durationMs: 1000, tickMs: 500 }, 0);
    const mid = StatusClock.tick(s, 600);
    expect(mid.damage).toBe(3);
    s = mid.statuses;
    const end = StatusClock.tick(s, 1200);
    expect(end.damage).toBe(3);
    expect(end.statuses).toEqual([]);
    const warded = StatusClock.absorb([{ kind: 'ward', magnitude: 10, until: 99, nextAt: 99 }], 25);
    expect(warded.damage).toBe(15);
    expect(warded.statuses).toEqual([]);
    expect(StatusClock.paceScale([{ kind: 'slow', magnitude: 0.5, until: 99, nextAt: 99 }])).toBe(0.5);
  });
});

describe('line 79 and R4: a monster casts, and every blow winds up first', () => {
  beforeEach(() => { MobAI.reset(); vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('nothing lands the instant it wakes: there is always a telegraph first', () => {
    const hound = mobByName('Dun Hound');
    const { patterns, telegraphs } = run(chunkWith([body(hound)]), { x: 30, y: 0 }, 300);
    expect(patterns).toEqual([]);
    expect(telegraphs.length).toBeGreaterThan(0);
  });

  it('a neutral thing stays neutral beside you, however close, until harmed', () => {
    const god = mobByName('The Auditor General');
    const first = run(chunkWith([body(god)]), { x: 15, y: 0 }, 4000);
    expect(first.patterns).toEqual([]);
    MobAI.provoke('body1');
    const second = run(first.chunks, { x: 15, y: 0 }, 4000);
    expect(second.patterns.length).toBeGreaterThan(0);
  });

  it('it casts what it was born knowing, and the map does not move for it', () => {
    const sentry = mobByName('Ledger Sentry');
    const { patterns, chunks } = run(chunkWith([body(sentry)]), { x: 120, y: 0 }, 8000);
    const casts = patterns.filter(p => p.abilityId);
    expect(casts.length).toBeGreaterThan(0);
    expect(casts[0].abilityId).toBe(abilityByName('Small Print').id);
    expect(chunks['0,0'].entities[0].position).toEqual({ x: 0, y: 0 });
  });

  it('a stronger rank casting the same thing hits harder (scaled by rank)', () => {
    const weak = EffectSystem.resolve(abilityByName('Small Print'), { rank: 'D' }, 'k');
    const strong = EffectSystem.resolve(abilityByName('Small Print'), { rank: 'A' }, 'k');
    expect(strong.magnitude).toBeGreaterThan(weak.magnitude);
  });

  it('a wind-up is drawn by shape: the renderer reads delivery, never hue alone', async () => {
    const { readFileSync } = await vi.importActual<typeof import('node:fs')>('node:fs');
    const src = readFileSync('src/render/FieldRenderer.ts', 'utf8');
    expect(src).toMatch(/drawTelegraph/);
    expect(src).toMatch(/t\.delivery === 'area'/);
  });
});

describe('line 90: the Director', () => {
  const ctx = (record = emptyDirectorRecord(), unlocked = true) => ContentRegistry.contextFor(themeId, UniversalRank.D, record, unlocked);
  const land = (context: ReturnType<typeof ctx>) => {
    const map = WorldGenerator.generate('director-world', 32, context);
    const mid = 16 * SECTOR_CHUNKS;
    const out: IWorldEntity[] = [];
    for (let y = mid; y < mid + 24; y++) for (let x = mid; x < mid + 24; x++) {
      out.push(...(WorldGenerator.chunkAt(map, x, y, context)?.entities ?? []).filter(e => e.type === EntityType.MOB));
    }
    return out;
  };

  it('generation 0 changes nothing at all', () => {
    expect(land(ctx()).filter(m => m.displayName)).toEqual([]);
  });

  it('rests make monsters differ, where they stood, and the land does not move', () => {
    const before = land(ctx());
    let record = emptyDirectorRecord();
    for (let i = 0; i < 6; i++) record = Director.evolve(record);
    const after = land(ctx(record));
    expect(after.map(m => [m.id, m.definitionId, m.position])).toEqual(before.map(m => [m.id, m.definitionId, m.position]));
    const changed = after.filter(m => m.displayName);
    expect(changed.length).toBeGreaterThan(0);
    expect(changed.some(m => m.displayName !== MOB_DEFINITIONS[m.definitionId].name)).toBe(true);
  });

  it('same record, same monsters: deterministic for a pinned world', () => {
    let record = emptyDirectorRecord();
    for (let i = 0; i < 4; i++) record = Director.evolve(record);
    expect(land(ctx(record))).toEqual(land(ctx(record)));
  });

  it('what brings people down grows more common, and what falls at once less so', () => {
    let r = emptyDirectorRecord();
    r = Director.report(r, 'FELLED_A_PERSON', 'strong');
    for (let i = 0; i < 20; i++) r = Director.report(r, 'FELL', 'weak');
    const next = Director.evolve(r);
    expect(next.generation).toBe(1);
    expect(next.weights.strong).toBeGreaterThan(1);
    expect(next.weights.weak).toBeLessThan(next.weights.strong);
    expect(next.felled).toEqual({});
  });

  it('D49: before the hub is unlocked, no prefix reaches a monster', () => {
    let record = emptyDirectorRecord();
    for (let i = 0; i < 6; i++) record = Director.evolve(record);
    const locked = land(ctx(record, false));
    expect(locked.filter(m => m.displayName && m.displayName !== MOB_DEFINITIONS[m.definitionId].name)).toEqual([]);
  });
});

describe('D60: a creature gives its name only when it has earned it', () => {
  const after = (rests: number, weight: number) => {
    let record = emptyDirectorRecord();
    for (let i = 0; i < rests; i++) record = Director.evolve(record);
    return { ...record, weights: { kind: weight } };
  };
  const POOL = { affixes: [{ id: 'a', name: 'Honored', type: 'PREFIX' as const, statModifiers: { max_health: [1, 2] as [number, number] } }], abilities: [] };
  const nameOf = (rests: number, weight: number, tags: string[], pool: typeof POOL | { affixes: never[]; abilities: string[] } = POOL) =>
    Director.variantOf('seed', 'b', 'kind', 'Hound', after(rests, weight), pool, tags).displayName;

  it('the first generation is nameless, one of a kind included', () => {
    expect(nameOf(0, 100, [])).toBeUndefined();
    expect(nameOf(0, 100, ['boss'])).toBeUndefined();
  });

  it('a magical body of the second generation or later is named', () => {
    expect(nameOf(1, 100, [])).toBe('Honored Hound');
    expect(nameOf(5, 100, [])).toBe('Honored Hound');
  });

  it('magic it learned counts as much as a trait', () => {
    expect(nameOf(1, 100, [], { affixes: [], abilities: ['spell'] })).toBe('Hound');
  });

  it('one of a kind is named from the second generation, with no magic on it', () => {
    expect(nameOf(1, 0, ['boss'])).toBe('Hound');
  });

  it('an ordinary body never is, however many rests have passed, and neither is an elite', () => {
    expect(nameOf(8, 0, [])).toBeUndefined();
    expect(nameOf(8, 0, ['elite'])).toBeUndefined();
  });

  it('the card shows the earned name and masks the rest', () => {
    const def = Object.values(compiled.mobs)[0];
    const read = (e: IWorldEntity) => inspectEntity(e, { player: { currentSession: { inventory: [] }, attributes: {} } as IPlayer, dist: 1, level: () => 2 });
    const masked = read(body(def));
    expect(masked.title).toBe('Unknown Contact');
    expect(masked.compact).not.toContain(def.name);
    expect(read({ ...body(def), displayName: `Honored ${def.name}` }).title).toBe(`Honored ${def.name}`);
  });

  it('the kill line only knows the name the body earned', () => {
    const def = Object.values(compiled.mobs)[0];
    const shot = { id: 's', x: 200, y: 0, angle: 0, speed: 200, spawnTime: 0, lifespan: 2, color: 'x', damage: 1e6 };
    const kill = (e: IWorldEntity) => CombatSystem.tick([shot], chunkWith([e]), { x: 0, y: 0, z: 0 }, 100, []).events.find(ev => ev.type === 'KILL')!;
    expect(kill(body(def, 'b1', 200)).displayName).toBeUndefined();
    expect(kill({ ...body(def, 'b2', 200), displayName: 'Honored Thing' }).displayName).toBe('Honored Thing');
    expect(readFileSync('src/components/WorldCanvas.tsx', 'utf8')).not.toMatch(/def\?\.name \?\? 'Contact'/);
  });

  it('what a boss drops does not give away a name it has not earned', () => {
    const boss = { id: 'mob_t', name: 'Test Shambler', rank: UniversalRank.S, tags: ['boss', 'god'], baseHealth: 10 } as never;
    const ctx = { chunkX: 0, chunkY: 0, layerId: 'w', biome: BiomeType.RUINS, magicFind: 1, quantityBonus: 1 } as never;
    const words = (name?: string) => {
      const out: string[] = [];
      for (let i = 0; i < 60; i++) {
        for (const item of LootTable.generateLoot(boss, 1, ctx, `loot:name:${i}`, name)) out.push(item.name, item.description ?? '');
      }
      return out.join(' | ');
    };
    expect(words()).not.toContain('Test Shambler');
    expect(words()).toMatch(/Relic of/);
    expect(words('Honored Shambler')).toContain('Honored Shambler');
  });

  it('nor does the preview before signing', () => {
    const html = renderToStaticMarkup(createElement(ThemePreview, { theme: FIRST_THEME }));
    for (const creature of FIRST_THEME.creatures) expect(html, creature.name).not.toContain(creature.name);
    expect(html).toContain(`${FIRST_THEME.creatures.length} kinds`);
  });
});

describe('line 92: a thing can be studied, and known only after a rest (D50)', () => {
  const store = () => usePlayerStore.getState();
  const reset = () => usePlayerStore.setState(s => ({
    player: { ...s.player, currentSession: undefined, energyToday: undefined, restQueue: undefined, bank: { ...s.player.bank, stashTabs: [{ ...s.player.bank.stashTabs[0], items: [] }] } }
  }));
  const unread = (key: string) => ItemFactory.createItem(UniversalRank.F, false, Rng.fromKey(`study:${key}`), 'weapon');

  beforeEach(reset);

  it('in the field: paid, timed, and it tells you nothing yet', () => {
    const item = unread('a');
    store().diveIntoLayer('layer-test');
    store().tryAddItems([item]);
    const energy = store().player.currentSession!.energy;
    const ask = store().fieldIdentify(item.id);
    expect(ask.ok).toBe(true);
    expect(store().player.currentSession!.energy).toBe(energy - ask.cost!);
    expect(store().completeFieldIdentify(item.id).ok).toBe(true);
    const held = () => store().player.currentSession!.inventory.find(i => i.id === item.id)!;
    expect(held().isIdentified).toBe(false);
    expect(RestSystem.isStudied(store().player, item.id)).toBe(true);
    store().emergencyJackOut('NONE');
  });

  it('there is no roll: looking always gets there', () => {
    const src = StudySystem as unknown as Record<string, unknown>;
    expect(src.identifyChance).toBeUndefined();
    for (let i = 0; i < 25; i++) {
      const item = unread(`roll${i}`);
      let p = RestSystem.queueStudy(store().player, item.id);
      p = { ...p, bank: { ...p.bank, stashTabs: [{ ...p.bank.stashTabs[0], items: [item] }] } };
      const { read } = RestSystem.settle(p);
      expect(read.map(r => r.id)).toEqual([item.id]);
    }
  });

  it('at a bench too: it costs the day, and waits for the rest', () => {
    const item = unread('bench');
    usePlayerStore.setState(s => ({ player: { ...s.player, bank: { ...s.player.bank, stashTabs: [{ ...s.player.bank.stashTabs[0], items: [item] }] } } }));
    expect(store().studyItemAtStation(item.id).ok).toBe(true);
    expect(store().player.bank.stashTabs[0].items[0].isIdentified).toBe(false);
    expect(store().player.energyToday).toBeLessThan(StatSystem.maxEnergy(store().player.attributes));
    const { player: after, read } = RestSystem.settle(store().player);
    expect(read).toHaveLength(1);
    expect(after.bank.stashTabs[0].items[0].isIdentified).toBe(true);
    expect(RestSystem.queueOf(after).studies).toEqual([]);
  });

  it('with no energy left, you cannot sit: rest first', () => {
    const item = unread('tired');
    usePlayerStore.setState(s => ({ player: { ...s.player, energyToday: 0, bank: { ...s.player.bank, stashTabs: [{ ...s.player.bank.stashTabs[0], items: [item] }] } } }));
    expect(store().studyItemAtStation(item.id).ok).toBe(false);
  });

  it('it cannot be read early: nothing but a rest moves it', () => {
    const item = unread('early');
    let p = RestSystem.queueStudy(store().player, item.id);
    p = RestSystem.queueStudy(p, item.id);
    expect(RestSystem.queueOf(p).studies).toEqual([item.id]);
  });
});

describe('line 93 and D58: the rest door', () => {
  const player = (over: Partial<IPlayer> = {}): IPlayer => ({ ...usePlayerStore.getState().player, currentSession: undefined, ...over });

  it('a chosen rest restores the day; settling alone does not', () => {
    const tired = player({ energyToday: 3, dayCount: 4 });
    expect(RestSystem.settle(tired).player.energyToday).toBe(3);
    const slept = RestSystem.restoreEnergy(tired);
    expect(slept.energyToday).toBeUndefined();
    expect(slept.dayCount).toBe(5);
  });

  it('a rest in the field restores the energy in hand', () => {
    const inField = player({ currentSession: { energy: 1 } as never });
    expect(RestSystem.restoreEnergy(inField).currentSession!.energy).toBe(StatSystem.maxEnergy(inField.attributes, inField.equipment));
  });

  it('no skill in code lets you camp: the door opens only for a minted grant', () => {
    expect(RestSystem.canRest(player(), 'FIELD').ok).toBe(false);
    expect(JSON.stringify(FIRST_THEME)).not.toMatch(/camp/i);
    const camper = player({ skillWords: { skill_survival: { name: 'Sleeping Rough', flavor: 'x', grants: ['rest'] } } });
    expect(RestSystem.canRest(camper, 'FIELD').ok).toBe(true);
    const fighter = player({ skillWords: { skill_melee: { name: 'Swordplay', flavor: 'x', grants: ['damage'] } } });
    expect(RestSystem.canRest(fighter, 'FIELD').ok).toBe(false);
  });

  it('the inn costs and the bed does not', () => {
    const poor = player();
    const broke = { ...poor, bank: { ...poor.bank, gold: 0 } };
    expect(RestSystem.canRest(broke, 'INN').ok).toBe(false);
    expect(RestSystem.canRest(broke, 'BED').ok).toBe(true);
  });
});

describe('line 86: what a rest brings back stands before the law', () => {
  const asked = { skills: ['skill_a'], weaves: ['weave_debt'] };
  const growth = (over = {}) => ({ creatures: [], materials: [], affixes: [], abilities: [], tags: [], lore: [], ...over });
  const good: IDreamResult = { skills: [{ id: 'skill_a', name: 'A Thing', flavor: 'y', grants: ['rest'] }], weaves: [{ id: 'weave_debt', name: 'The Call' }] };

  it('a lawful dream applies, and a grant comes through', () => {
    expect(RestSystem.judgeDream(good, asked).ok).toBe(true);
    const applied = RestSystem.applyDream({ ...usePlayerStore.getState().player, restQueue: { ...emptyQueue(), weaves: [['debt']] } }, good);
    expect(applied.skillWords!.skill_a.grants).toEqual(['rest']);
    expect(applied.weaveNames!.weave_debt).toBe('The Call');
    expect(applied.restQueue!.weaves).toEqual([]);
    expect(RestSystem.grantsFieldRest(applied)).toBe(true);
  });

  it('a skill nobody asked about, or a grant the game does not have, is refused whole', () => {
    expect(RestSystem.judgeDream({ ...good, skills: [{ id: 'skill_z', name: 'Z', flavor: '', grants: [] }] }, asked).ok).toBe(false);
    expect(RestSystem.judgeDream({ ...good, skills: [{ id: 'skill_a', name: 'A', flavor: '', grants: ['fly_to_the_moon'] }] }, asked).ok).toBe(false);
    expect(RestSystem.judgeDream(null as never, asked).ok).toBe(false);
  });

  it('what the world grew is a new pack with a new id, judged; the old one and its worlds do not move', () => {
    const grown = RestSystem.grownTheme(FIRST_THEME, growth({ lore: ['A new note was found in a queue rope.'] }))!;
    expect(grown.lore).toHaveLength(FIRST_THEME.lore.length + 1);
    expect(ContentRegistry.judge(grown).ok).toBe(true);
    const pack = sealTheme(grown, 'test', 2);
    expect(pack.themeId).not.toBe(themeId);
    expect(ContentRegistry.install(pack).ok).toBe(true);
    expect(ContentRegistry.get(themeId)!.lore).toHaveLength(FIRST_THEME.lore.length);
    expect(RestSystem.grownTheme(FIRST_THEME, growth())).toBeNull();
    expect(RestSystem.grownTheme(FIRST_THEME, undefined)).toBeNull();
  });

  it('broken growth is refused whole', () => {
    const grown = RestSystem.grownTheme(FIRST_THEME, growth({ creatures: [{ ...FIRST_THEME.creatures[0], key: 'gone_wrong', tags: ['never_registered_word'] }] }))!;
    expect(ContentRegistry.judge(grown).ok).toBe(false);
  });

  it('line 87: settling needs no door at all', () => {
    const p = usePlayerStore.getState().player;
    expect(() => RestSystem.settle({ ...p, restQueue: { ...emptyQueue(), weaves: [['debt']] } })).not.toThrow();
  });

  it('what the model hears never includes a hidden name', () => {
    const q = RestSystem.dreamQueue({ ...usePlayerStore.getState().player, restQueue: { ...emptyQueue(), studies: ['itm_secret'] } }, []);
    expect(JSON.stringify(q)).not.toContain('itm_secret');
  });
});

describe('line 82 and 83: Spellcraft', () => {
  it('a set of elements does one fixed thing, in any order', () => {
    expect(WeaveSystem.weave(['seal', 'debt'])).toEqual(WeaveSystem.weave(['debt', 'seal']));
    expect(WeaveSystem.idOf(['seal', 'debt'])).toBe('weave_debt+seal');
    expect(() => WeaveSystem.weave([])).toThrow();
  });

  it('more elements cost more, with nothing capping how many', () => {
    const cost = (n: number) => WeaveSystem.weave(Array.from({ length: n }, (_, i) => `e${i}`)).cost;
    const order = ['trivial', 'low', 'medium', 'high', 'extreme'];
    expect(order.indexOf(cost(3))).toBeGreaterThan(order.indexOf(cost(1)));
    expect(() => WeaveSystem.weave(Array.from({ length: 200 }, (_, i) => `e${i}`))).not.toThrow();
  });

  it('it is paid from reserves, filled by what is gathered, and refused when short', () => {
    const base = usePlayerStore.getState().player;
    const weave = WeaveSystem.weave(['debt']);
    expect(WeaveSystem.canCast({ ...base, reserves: {} }, weave, 'F').ok).toBe(false);
    const full = { ...base, reserves: { debt: 100 } };
    expect(WeaveSystem.canCast(full, weave, 'F').ok).toBe(true);
    const spent = WeaveSystem.spend(full, weave, 'F');
    expect(spent.reserves!.debt).toBeLessThan(100);
    const gathered = WeaveSystem.gather({ ...base, reserves: {} }, 'debt');
    expect(gathered.reserves!.debt).toBeGreaterThan(0);
  });

  it('a mind\'s stat widens what can be held, so a mage pays with head gear', () => {
    const attrs = usePlayerStore.getState().player.attributes;
    const bare = WeaveSystem.capacity({ ...attrs, focus: 0 });
    expect(WeaveSystem.capacity({ ...attrs, focus: 4 })).toBeGreaterThan(bare);
  });

  it('what a material gives up is keyed and comes from its own world', () => {
    const els = ['debt', 'interest', 'seal'];
    expect(WeaveSystem.elementOf('res_x', els)).toBe(WeaveSystem.elementOf('res_x', [...els].reverse()));
    expect(els).toContain(WeaveSystem.elementOf('res_x', els));
    expect(WeaveSystem.elementOf('res_x', [])).toBeUndefined();
  });

  it('a tested weave waits for its word at a rest; the plain name stands until then', () => {
    let p: IPlayer = { ...usePlayerStore.getState().player, restQueue: emptyQueue(), weaveNames: {} };
    p = RestSystem.queueWeave(p, ['debt', 'seal']);
    p = RestSystem.queueWeave(p, ['seal', 'debt']);
    expect(RestSystem.queueOf(p).weaves).toHaveLength(1);
    const { player: after, floorNamed } = RestSystem.settle(p);
    expect(floorNamed).toEqual(['weave_debt+seal']);
    expect(after.weaveNames!['weave_debt+seal']).toMatch(/Unnamed/);
  });
});

describe('line 80: defeating a thing teaches what it casts', () => {
  it('it queues in the field, and settles at a rest', () => {
    const lien = abilityByName('Lien').id;
    let p: IPlayer = { ...usePlayerStore.getState().player, restQueue: emptyQueue(), knownAbilities: [] };
    p = RestSystem.queueMet(p, [lien]);
    p = RestSystem.queueMet(p, [lien]);
    expect(RestSystem.queueOf(p).met).toEqual([lien]);
    expect(p.knownAbilities).toEqual([]);
    const { player: after, learned } = RestSystem.settle(p);
    expect(learned).toEqual([lien]);
    expect(after.knownAbilities).toEqual([lien]);
    expect(RestSystem.queueMet(after, [lien])).toBe(after);
  });
});

describe('line 81: a piece can carry an ability, and it acts unstudied', () => {
  it('the trigger comes from the pack, and rides onto the minted piece', () => {
    const base = [...compiled.craftedGear, ...compiled.items.weapon_bases].find(b => b.carries)!;
    expect(base.carries!.trigger).toBeTruthy();
    const item = ItemFactory.createFromTemplate(base, false, Rng.fromKey('carry'));
    expect(item.carries).toEqual(base.carries);
    expect(item.isIdentified).toBe(false);
  });

  it('a pack may not promise a trigger or an effect nothing reads', () => {
    const b = JSON.parse(JSON.stringify(FIRST_THEME));
    b.gear.find((g: { carries: string }) => g.carries).trigger = 'on_full_moon';
    expect(ContentRegistry.judge(b).reason).toMatch(/on_full_moon/);
    const c = JSON.parse(JSON.stringify(FIRST_THEME));
    c.abilities[0].effect = 'summon';
    expect(ContentRegistry.judge(c).ok).toBe(false);
  });

  it('nothing in the code keeps a table of triggers', () => {
    const eq = usePlayerStore.getState().player.equipment;
    expect(EffectSystem.triggered(eq, 'on_hit')).toEqual([]);
    const item = { id: 'x', carries: { ability: 'abl', trigger: 'something_a_batch_invented' }, stats: {} };
    const worn = { slots: { CHEST: 'x' }, items: [item] } as never;
    expect(EffectSystem.triggered(worn, 'something_a_batch_invented')).toEqual(['abl']);
  });
});
