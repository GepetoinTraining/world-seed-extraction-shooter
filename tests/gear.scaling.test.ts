/**
 * THE SCALING A NEWCOMER MEETS (GS, after Pedro's "the scaling seems off, check my gear please"). His three rank-D
 * pieces came out of two tutorial chests on rank-D ground guarded by rank-E creatures, in a world said to be F. The
 * coordinator's four calls on it, each an open row he can strike:
 *   1. ground above a world's own rank: each further rank 0.4 as likely as the one below it, with no top (call 15);
 *   2. a chest holds one piece of gear, and goods (2.5);
 *   3. a body takes the rank of the ground it stands on, its kind chosen as the spawn pool chooses it;
 * All three hold from a new ground version; a world that stands keeps its ground. The fourth call, a tool swung never hitting
 * softer than the bare hand that holds it, is tests/gear.tool.test.ts.
 */

import { describe, it, expect } from 'vitest';
import { IItem, ItemType, UniversalRank } from '../shared/types';
import { installShippedThemes, FIRST_THEME_PACK } from '../shared/logic/theme/boot';
import { ContentRegistry } from '../shared/logic/theme/ContentRegistry';
import { WorldGenerator, GROUND_VERSION } from '../shared/entities/world/WorldGenerator';
import { EntityType, IWorldEntity } from '../shared/entities/world/types';
import { emptyDirectorRecord } from '../shared/entities/world/Director';
import { MOB_DEFINITIONS } from '../shared/entities/mob/data/mobDefinitions';
import { RESOURCE_DEFINITIONS } from '../shared/entities/item/data/resourceDefinitions';
import { bodyLawOf, laidKind } from '../shared/entities/mob/BodyLaw';
import { BODIES_FROM_GROUND, RANKED_FROM_GROUND, bodyScale } from '../shared/logic/theme/ThemeFormula';
import { uniformNoise, valueNoise, weightedUniformCdf } from '../shared/logic/rng/noise';
import { Rng } from '../shared/logic/rng/DeterministicRNG';
import { LootLaw, lootItemsOf } from '../shared/logic/theme/LootLaw';
import { CombatMath } from '../src/entities/combat/CombatMath';
import { LootTable } from '../src/entities/world/LootTable';
import { LootBook } from '../src/logic/theme/LootBook';
import { rerunDrops } from '../server/hub/rerun';
import { deathCostsNothing } from '../shared/logic/systems/DeathCost';
import { Tutorial } from '../src/logic/systems/Tutorial';

installShippedThemes();
const THEME = FIRST_THEME_PACK.themeId;
const RANKS = Object.values(UniversalRank) as string[];
const ctx = (ground: number, difficulty = UniversalRank.F) => ({ ...ContentRegistry.contextFor(THEME, difficulty, emptyDirectorRecord(), false), groundVersion: ground }) as any;
const mob = (key: string) => MOB_DEFINITIONS[`mob_${THEME.slice('theme_'.length, 'theme_'.length + 8)}_${key}`] ?? Object.values(MOB_DEFINITIONS).find(m => m.id.endsWith(`_${key}`))!;

describe('the noise read through its own spread is even (call 1\'s ground)', () => {
  it('the spread of a weighted sum of evens is its exact sum over corners', () => {
    const rng = Rng.fromKey('gs:cdf');
    for (const w of [[1, 0, 0, 0], [0.5, 0.5, 0, 0], [0.4, 0.3, 0.2, 0.1], [0.97, 0.014, 0.014, 0.0002]]) {
      const n = 40000;
      const sums = Array.from({ length: n }, () => w.reduce((s, x) => s + x * rng.next(), 0));
      for (const at of [0.2, 0.35, 0.5, 0.65, 0.8]) {
        const seen = sums.filter(s => s <= at).length / n;
        expect(Math.abs(weightedUniformCdf(w, at) - seen)).toBeLessThan(0.012);
      }
    }
  });

  it('read through it, value noise falls evenly: every tenth holds a tenth', () => {
    const counts = new Array(10).fill(0);
    let total = 0;
    for (let s = 0; s < 40; s++) for (let i = 0; i < 2500; i++) {
      const r = Rng.fromKey(`gs:even:${s}:${i}`);
      const u = uniformNoise(s * 7919 + 13, r.int(0, 4000), r.int(0, 4000), 14);
      counts[Math.min(9, Math.floor(u * 10))]++;
      total++;
    }
    for (const c of counts) expect(Math.abs(c / total - 0.1)).toBeLessThan(0.006);
  });

  it('it keeps the noise\'s order at a place: the high ground stays high', () => {
    for (let x = 0; x < 60; x++) {
      const a = valueNoise(99, x, 7, 14), b = valueNoise(99, x + 1, 7, 14);
      const ua = uniformNoise(99, x, 7, 14), ub = uniformNoise(99, x + 1, 7, 14);
      if (Math.abs(a - b) > 0.05) expect(Math.sign(ua - ub)).toBe(Math.sign(a - b));
    }
  });
});

describe('call 1: ground above a world\'s own rank, each further rank 0.4 as likely, with no top', () => {
  const shares = (ground: number, seeds: string[], span: number) => {
    const at: Record<string, number> = {};
    let n = 0;
    for (const seed of seeds) for (let cy = 0; cy < span; cy++) for (let cx = 0; cx < span; cx++) {
      const r = WorldGenerator.rankAt(seed, cx, cy, UniversalRank.F, ground);
      at[r] = (at[r] ?? 0) + 1; n++;
    }
    const atLeast = (d: number) => RANKS.slice(d).reduce((s, r) => s + (at[r] ?? 0), 0) / n;
    return { at, n, atLeast };
  };

  it('the ground moved to a new version', () => {
    expect(GROUND_VERSION).toBe(RANKED_FROM_GROUND);
    expect(RANKED_FROM_GROUND).toBeGreaterThan(BODIES_FROM_GROUND);
  });

  it('on the new ground, the share at least d ranks above is 0.4^d', () => {
    const seeds = Array.from({ length: 12 }, (_, i) => `gs-ground-${i}`);
    const s = shares(GROUND_VERSION, seeds, 160);
    expect(s.atLeast(1)).toBeGreaterThan(0.36); expect(s.atLeast(1)).toBeLessThan(0.44);
    expect(s.atLeast(2)).toBeGreaterThan(0.13); expect(s.atLeast(2)).toBeLessThan(0.19);
    expect(s.atLeast(3)).toBeGreaterThan(0.045); expect(s.atLeast(3)).toBeLessThan(0.085);
    // No top: ground three and four ranks over stands, each less likely than the one under it
    expect(s.at.C ?? 0).toBeGreaterThan(0);
    expect(s.at.B ?? 0).toBeGreaterThan(0);
    for (let d = 0; d < 4; d++) expect(s.at[RANKS[d]] ?? 0).toBeGreaterThan(s.at[RANKS[d + 1]] ?? 0);
  });

  it('the tutorial: E likelier than D, D than C', () => {
    const s = shares(GROUND_VERSION, ['dev-sandbox-v4'], 256);
    expect(s.at.E).toBeGreaterThan(s.at.D);
    expect(s.at.D).toBeGreaterThan(s.at.C ?? 0);
  });

  it('a world that stands keeps its ground: the old bands, stopping two over', () => {
    // Pedro's chests in the tutorial (GS1): the ground under them as it stood
    const old = (cx: number, cy: number) => WorldGenerator.rankAt('dev-sandbox-v4', cx, cy, UniversalRank.F, BODIES_FROM_GROUND);
    expect(old(156, 83)).toBe('D');
    expect(old(76, 100)).toBe('D');
    expect(old(124, 131)).toBe('E');
    expect(old(115, 132)).toBe('F');
    expect(WorldGenerator.rankAt('dev-sandbox-v4', 156, 83, UniversalRank.F)).toBe('D');
    const s = shares(BODIES_FROM_GROUND, ['dev-sandbox-v4'], 256);
    expect(s.at.C ?? 0).toBe(0);
  });

  it('the drone reads the new ground: a sector says its highest chunk by the world\'s ground', () => {
    const map = WorldGenerator.generate('dev-sandbox-v4', 32, ctx(GROUND_VERSION));
    const sector = map.sectors['19,10'];
    let top = 0;
    for (let y = 0; y < 8; y += 2) for (let x = 0; x < 8; x += 2) top = Math.max(top, RANKS.indexOf(WorldGenerator.rankAt('dev-sandbox-v4', 19 * 8 + x, 10 * 8 + y, UniversalRank.F, GROUND_VERSION)));
    expect(sector.difficulty).toBe(RANKS[top]);
  });
});

describe('call 3: a body takes the rank of the ground it stands on', () => {
  it('its numbers are its kind\'s, doubled a rank from the kind\'s to the ground\'s', () => {
    const rat = mob('tally_rat');
    expect(rat.rank).toBe('F');
    const laid = bodyLawOf(rat, { law: RANKED_FROM_GROUND, rank: 'D' });
    expect(laid.baseHealth).toBe(Math.round(rat.baseHealth * 4));
    expect(laid.baseDamage).toBe(Math.round(rat.baseDamage * 4));
    // Under an older ground the rank a body carries moves nothing
    expect(bodyLawOf(rat, { law: BODIES_FROM_GROUND, rank: 'D' })).toEqual({ baseHealth: rat.baseHealth, baseDamage: rat.baseDamage });
    // And a kind above its ground stands at the ground's
    const receiver = mob('receiver');
    expect(bodyLawOf(receiver, { law: RANKED_FROM_GROUND, rank: 'F' }).baseHealth).toBe(Math.round(receiver.baseHealth / 4));
    expect(CombatMath.mobDamage(rat, { law: RANKED_FROM_GROUND, rank: 'D' } as any)).toBe(Math.round(rat.baseDamage * 4));
  });

  it('a chunk lays every body at its own rank, health and all, the kinds as the pool chose them', () => {
    const c = ctx(GROUND_VERSION);
    const map = WorldGenerator.generate('dev-sandbox-v4', 32, c);
    const seen: { e: IWorldEntity; ground: string }[] = [];
    for (let cy = 70; cy < 110 && seen.length < 400; cy++) for (let cx = 60; cx < 100; cx++) {
      const chunk = WorldGenerator.chunkAt(map, cx, cy, c);
      for (const e of chunk?.entities ?? []) if (e.type === EntityType.MOB) seen.push({ e, ground: String(chunk!.difficulty) });
    }
    expect(seen.length).toBeGreaterThan(50);
    for (const { e, ground } of seen) {
      expect(e.rank).toBe(ground);
      expect(e.law).toBe(RANKED_FROM_GROUND);
      const def = MOB_DEFINITIONS[e.definitionId];
      expect(e.health).toBe(bodyLawOf(def, e).baseHealth + (e.bonusHealth ?? 0));
    }
    // Some stand above their kind's rank, which is what the ground does to them
    expect(seen.some(({ e }) => RANKS.indexOf(e.rank) > RANKS.indexOf(MOB_DEFINITIONS[e.definitionId].rank))).toBe(true);
  });

  it('a chest\'s guards stand at its rank, on every land', () => {
    const c = ctx(GROUND_VERSION);
    const map = WorldGenerator.generate('dev-sandbox-v4', 32, c);
    let checked = 0;
    for (let cy = 60; cy < 140 && checked < 40; cy++) for (let cx = 60; cx < 140 && checked < 40; cx++) {
      const chunk = WorldGenerator.chunkAt(map, cx, cy, c);
      for (const chest of (chunk?.entities ?? []).filter(e => e.type === EntityType.CONTAINER && e.id.endsWith('_chest'))) {
        const guards = chunk!.entities.filter(e => e.id.startsWith(chest.id.replace('_chest', '_guard')));
        for (const g of guards) expect(g.rank).toBe(chest.container!.lootRank);
        if (guards.length > 0) checked++;
      }
    }
    expect(checked).toBeGreaterThan(5);
  });

  it('under an older ground a body keeps its kind\'s rank', () => {
    const c = ctx(BODIES_FROM_GROUND);
    const map = WorldGenerator.generate('dev-sandbox-v4', 32, c);
    const chunk = WorldGenerator.chunkAt(map, 156, 83, c);
    const bodies = (chunk?.entities ?? []).filter(e => e.type === EntityType.MOB);
    expect(bodies.length).toBeGreaterThan(0);
    for (const e of bodies) expect(e.rank).toBe(MOB_DEFINITIONS[e.definitionId].rank);
  });

  it('what a body leaves is found at its rank, and the hub reruns its drop at the rank it stood at', () => {
    const rat = mob('tally_rat');
    const laid = laidKind(rat, { law: RANKED_FROM_GROUND, rank: 'D' });
    expect(laid.rank).toBe('D');
    expect(laidKind(rat, { law: BODIES_FROM_GROUND, rank: 'D' }).rank).toBe('F');
    LootBook.admitShipped();
    const roll = LootTable.creatureRoll(laid, 'gs:kill:1')!;
    expect(roll).not.toBeNull();
    expect(roll.rank).toBe('D');
    const table = LootBook.all().find(t => t.id === roll.table)!;
    const find = { table: (id: string) => LootBook.all().find(t => t.id === id), pack: (id: string) => ContentRegistry.get(id), mob: (_t: string, id: string) => MOB_DEFINITIONS[id] };
    const kill = (laidAt?: string) => [{ seq: 1, type: 'KILL', data: { defId: rat.id, rollKey: 'gs:kill:1', table: roll, ...(laidAt ? { laidAt } : {}) } }];
    expect(rerunDrops(kill('D'), find).wrong).toBeUndefined();
    expect(rerunDrops(kill('D'), find).rolls).toBe(1);
    // Named nowhere, the kind's rank is still the hub's
    expect(rerunDrops(kill(), find).wrong).toBeDefined();
    // And the table must have rolled at the rank it says the body stood at
    expect(rerunDrops([{ seq: 1, type: 'KILL', data: { defId: rat.id, rollKey: 'gs:kill:1', table: { ...roll, rank: 'C', lines: LootLaw.roll(table, 'C', 'gs:kill:1', lootItemsOf(ContentRegistry.get(THEME)!)) }, laidAt: 'D' } }], find).wrong).toBeDefined();
  });
});

describe('call 2: a chest holds one piece of gear, and goods', () => {
  const gear = (items: IItem[]) => items.filter(i => i.type === ItemType.GEAR);
  it('on the new ground, one piece, the rest the land\'s own materials at or under the chest\'s rank', () => {
    LootBook.enter(THEME);
    for (const rank of ['F', 'D', 'C'] as UniversalRank[]) for (let i = 0; i < 120; i++) {
      const items = LootTable.generateChestLoot(rank, 1, `gs:chest:${rank}:${i}`, 'OVERGROWTH' as any, GROUND_VERSION, 0);
      expect(gear(items).length).toBe(1);
      expect(RANKS.indexOf(gear(items)[0].rank)).toBeGreaterThanOrEqual(RANKS.indexOf(rank) - 1);
      const goods = items.filter(it => it.type !== ItemType.GEAR);
      expect(goods.length).toBeGreaterThanOrEqual(1);
      for (const g of goods) {
        const def = RESOURCE_DEFINITIONS[g.universalDefinitionId];
        expect(def).toBeDefined();
        expect(def.themeId).toBe(THEME);
        expect(def.junk || def.anchor).toBeFalsy();
        expect(RANKS.indexOf(String(def.rank ?? 'F'))).toBeLessThanOrEqual(RANKS.indexOf(rank));
      }
    }
  });

  it('a world that stands keeps its chests as they were', () => {
    LootBook.enter(THEME);
    let many = 0;
    for (let i = 0; i < 60; i++) if (gear(LootTable.generateChestLoot(UniversalRank.D, 1, `gs:chest:old:${i}`, 'OVERGROWTH' as any, BODIES_FROM_GROUND, 0)).length > 1) many++;
    expect(many).toBeGreaterThan(30);
  });
});

describe('the body law reads a body that names no law as before', () => {
  it('no law, no rank: the standing numbers', () => {
    const hound = mob('dun_hound');
    expect(bodyLawOf(hound, {})).toEqual(hound.standing);
    expect(bodyScale('D') / bodyScale('F')).toBe(4);
  });
});

describe('where a death costs nothing, the ground holds nothing above the world\'s own rank (GS19)', () => {
  const tally = (c: any, span = 256) => {
    const at: Record<string, number> = {};
    for (let cy = 0; cy < span; cy++) for (let cx = 0; cx < span; cx++) {
      const r = WorldGenerator.rankAt('dev-sandbox-v4', cx, cy, c.difficulty, c.groundVersion, c.deathPenalty);
      at[r] = (at[r] ?? 0) + 1;
    }
    return at;
  };
  const free = (difficulty = UniversalRank.F) => ({ ...ctx(GROUND_VERSION, difficulty), deathPenalty: 'NONE' });

  it('it is read from the world\'s own word for what a death costs, as the death itself is', () => {
    expect(deathCostsNothing('NONE')).toBe(true);
    for (const word of ['INVENTORY_LOSS', 'XP_LOSS', 'PERMADEATH', undefined]) expect(deathCostsNothing(word)).toBe(false);
    expect(deathCostsNothing(Tutorial.card(0).deathPenalty)).toBe(true);
  });

  it('a world where a death is free is all its own rank, at F and at E alike', () => {
    expect(Object.keys(tally(free()))).toEqual(['F']);
    expect(Object.keys(tally(free(UniversalRank.E), 128))).toEqual(['E']);
  });

  it('the tutorial, laid by its own card: every sector F to the drone, its chests and its bodies F', () => {
    const card = Tutorial.card(0);
    const c = { ...ContentRegistry.contextFor(THEME, card.difficulty, emptyDirectorRecord(), false), groundVersion: card.groundVersion, deathPenalty: card.deathPenalty } as any;
    const map = WorldGenerator.generate(card.seed, card.size, c);
    expect(new Set(Object.values(map.sectors).map(s => s.difficulty))).toEqual(new Set(['F']));
    let bodies = 0, chests = 0;
    for (let cy = 70; cy < 110; cy++) for (let cx = 60; cx < 100; cx++) {
      for (const e of WorldGenerator.chunkAt(map, cx, cy, c)?.entities ?? []) {
        if (e.type === EntityType.MOB) { bodies++; expect(e.rank).toBe('F'); }
        if (e.container) { chests++; expect(e.container.lootRank).toBe('F'); }
      }
    }
    expect(bodies).toBeGreaterThan(50);
    expect(chests).toBeGreaterThan(5);
  });

  it('a world where a death costs something keeps the falling law with no top', () => {
    const at = tally({ ...ctx(GROUND_VERSION), deathPenalty: 'INVENTORY_LOSS' });
    expect(at.E).toBeGreaterThan(at.D);
    expect(at.C ?? 0).toBeGreaterThan(0);
  });

  it('an older ground keeps its bands, whatever a death costs there', () => {
    expect(tally({ ...ctx(BODIES_FROM_GROUND), deathPenalty: 'NONE' }).D ?? 0).toBeGreaterThan(0);
  });
});
