/**
 * THE RARITY RESCALE (BALANCE_RUN 1.4, 1.5, 2.13). Pedro, 2026-11-11: "uncommon is technological with
 * 1 stat (prefix or suffix), then magical 2 stats (one suffix one affix), rare 4 epic 6. the ranks are
 * tiers", and "Yes, rank is tier". On gear stopping at rank D: "because it needs to be generated, the
 * gear is a "noun", it has the slot it goes into".
 *
 * Part 1: a piece's three facts untangled. Rank comes from where the piece came from; a rank doubles
 * a piece once; quality is the one roll and moves every number on the piece together; the step is
 * read off the count of its properties and multiplies nothing.
 */

import { describe, it, expect } from 'vitest';
import { IItem, IAffix, Rarity, SlotType, UniversalRank } from '../shared/types';
import { ItemFactory } from '../shared/entities/item/ItemFactory';
import { ITEM_DEFINITIONS } from '../shared/entities/item/data/itemDefinitions';
import { PieceLaw } from '../shared/logic/theme/PieceLaw';
import { GROUND_VERSION } from '../shared/entities/world/WorldGenerator';
import { CombatMath } from '../src/entities/combat/CombatMath';
import { ItemLaw } from '../shared/logic/content/ItemLaw';
import { Rng } from '../shared/logic/rng/DeterministicRNG';
import { installShippedThemes } from '../shared/logic/theme/boot';

installShippedThemes();

const RANKS = [UniversalRank.F, UniversalRank.E, UniversalRank.D, UniversalRank.C, UniversalRank.B, UniversalRank.A, UniversalRank.S, UniversalRank.SS, UniversalRank.SSS];
const bases = () => [...ITEM_DEFINITIONS.weapon_bases, ...ITEM_DEFINITIONS.armor_bases, ...ITEM_DEFINITIONS.tool_bases];
const mint = (rank: UniversalRank | undefined, key: string, baseId?: string): IItem => ItemFactory.createItem(rank, true, Rng.fromKey(key), undefined, baseId);
const kindOf = (kind: string) => bases().find(b => b.kind === kind)!;
/** A piece with no property, so what is on it is its kind's own (part 2 lets a lone property come before the unlock). */
const bare = (rank: UniversalRank, key: string, baseId: string): IItem => ItemFactory.createItem(rank, true, Rng.fromKey(key), undefined, baseId, undefined, { depth: 0 });
const affix = (type: 'PREFIX' | 'SUFFIX', n: number): IAffix => ({ id: `a${type}${n}`, name: `${type} ${n}`, type, stats: {}, tier: 1 });

describe('part 1: rank comes from where the piece came from', () => {
  it('a found piece takes the rank asked of it, whatever rank its kind was written at', () => {
    for (const rank of [UniversalRank.C, UniversalRank.S, UniversalRank.SSS]) {
      for (let i = 0; i < 12; i++) expect(mint(rank, `from:${rank}:${i}`).rank).toBe(rank);
    }
  });

  it('the same noun exists at every rank', () => {
    const blade = kindOf('blade');
    for (const rank of RANKS) {
      const piece = mint(rank, `noun:${rank}`, blade.id);
      expect(piece.universalDefinitionId).toBe(blade.id);
      expect(piece.rank).toBe(rank);
    }
  });
});

describe('part 1: a rank doubles a piece, once', () => {
  it('power is 50 x 2^step x (1 + quality), a tool a third, and worth twice the power', () => {
    for (const rank of RANKS) {
      for (const b of bases()) {
        const piece = mint(rank, `power:${rank}:${b.id}`, b.id);
        const tool = b.tags.includes('tool');
        const expected = 50 * Math.pow(2, RANKS.indexOf(rank)) * (1 + piece.quality) / (tool ? 3 : 1);
        expect(piece.itemPower).toBeCloseTo(expected, 9);
        expect(piece.value).toBe(Math.max(1, Math.floor(expected * 2)));
      }
    }
  });

  it('an amount a kind carries natively follows its ruler: one plain body\'s worth of it at the piece\'s rank (part 2)', () => {
    // Part 1 had the necklace's health double a rank. Part 2's ruler (the coordinator's ruling) makes a native line one
    // ruler, and health's reference is what a plain body of the rank holds, which the code does not yet double
    const necklace = kindOf('necklace');
    const at = (rank: UniversalRank) => { const p = bare(rank, `amount:${rank}`, necklace.id); return p.stats.max_health / (1 + p.quality); };
    expect(at(UniversalRank.C) / at(UniversalRank.F)).toBeCloseTo(PieceLaw.reference('max_health', 'C') / PieceLaw.reference('max_health', 'F'), 9);
    expect(PieceLaw.ruler('damage', 'S') / PieceLaw.ruler('damage', 'F')).toBeCloseTo(64, 9);
  });

  it('a rating or a stat of tiles, seconds or kilograms reads no rank on the piece until its reader reads one', () => {
    const feet = kindOf('feet');
    const pace = (rank: UniversalRank) => { const p = mint(rank, `rating:${rank}`, feet.id); return p.stats.movement_speed / (1 + p.quality); };
    expect(pace(UniversalRank.S)).toBeCloseTo(pace(UniversalRank.F), 9);
    expect(PieceLaw.reading('damage')).toBe('amount');
    expect(PieceLaw.reading('max_health')).toBe('amount');
    expect(PieceLaw.reading('max_energy')).toBe('rankless');
    expect(PieceLaw.reading('movement_speed')).toBe('rating');
  });

  it('a weapon\'s blow is a fifth of its power, with no bare constant beside it', () => {
    const blade = kindOf('blade');
    for (const rank of [UniversalRank.F, UniversalRank.C, UniversalRank.SSS]) {
      const piece = mint(rank, `blow:${rank}`, blade.id);
      piece.affixes = []; piece.stats = { ...piece.stats, damage: 0 };
      expect(CombatMath.weaponDamage(piece)).toBe(Math.max(1, Math.round(piece.itemPower / 5)));
    }
  });
});

describe('part 1: quality is the one roll, and moves every number together', () => {
  it('every native number on a piece is the kind\'s number at its rank times (1 + quality), unrounded', () => {
    const blade = kindOf('blade');
    for (let i = 0; i < 20; i++) {
      const piece = bare(UniversalRank.F, `quality:${i}`, blade.id);
      const native = PieceLaw.nativeLines(blade.kind!, 0);
      for (const line of native) expect(piece.stats[line.stat]).toBeCloseTo(line.value * (1 + piece.quality), 12);
    }
    // A blade's rate of 1.2 is no longer rounded to 1 (STAT_TREES 9)
    const rate = mint(UniversalRank.F, 'quality:rate', blade.id);
    expect(rate.stats.attack_speed).toBeCloseTo(1.2 * (1 + rate.quality), 12);
  });
});

describe('part 1: the step is read off the count and multiplies nothing', () => {
  it('counts a lone property as uncommon, then pairs: one magical, two rare, three epic', () => {
    expect(PieceLaw.stepOf([])).toBe(Rarity.COMMON);
    expect(PieceLaw.stepOf([affix('PREFIX', 1)])).toBe(Rarity.UNCOMMON);
    expect(PieceLaw.stepOf([affix('SUFFIX', 1)])).toBe(Rarity.UNCOMMON);
    expect(PieceLaw.stepOf([affix('PREFIX', 1), affix('SUFFIX', 1)])).toBe(Rarity.MAGICAL);
    expect(PieceLaw.stepOf([affix('PREFIX', 1), affix('SUFFIX', 1), affix('PREFIX', 2), affix('SUFFIX', 2)])).toBe(Rarity.RARE);
    expect(PieceLaw.stepOf([1, 2, 3].flatMap(n => [affix('PREFIX', n), affix('SUFFIX', n)]))).toBe(Rarity.EPIC);
  });

  it('every minted piece says the step its count says, and its power does not read it', () => {
    for (let i = 0; i < 200; i++) {
      const piece = mint(UniversalRank.D, `step:${i}`);
      expect(piece.rarity).toBe(PieceLaw.stepOf(piece.affixes));
      expect(piece.itemPower).toBeCloseTo(PieceLaw.power(UniversalRank.D, piece.quality, piece.tags.includes('tool')), 9);
    }
  });
});

describe('part 1: a standing world gives what it gave', () => {
  it('the ground moved to a new version, and a world pinned before it mints by the old law', () => {
    expect(GROUND_VERSION).toBeGreaterThanOrEqual(PieceLaw.FROM_GROUND);
    const blade = bases().find(b => b.slot === SlotType.MAIN_HAND && b.rank === UniversalRank.F)!;
    const old = ItemFactory.createItem(UniversalRank.S, true, Rng.fromKey('standing:old'), undefined, blade.id, undefined, { groundVersion: PieceLaw.FROM_GROUND - 1 });
    expect(old.rank).toBe(UniversalRank.F);
    const fresh = ItemFactory.createItem(UniversalRank.S, true, Rng.fromKey('standing:new'), undefined, blade.id, undefined, { groundVersion: PieceLaw.FROM_GROUND });
    expect(fresh.rank).toBe(UniversalRank.S);
  });

  it('the hub checks a found piece by the law it was minted under, and corrects a forged power', () => {
    const defs = { base: (id: string) => bases().find(b => b.id === id), resource: () => undefined, step: () => undefined };
    const piece = mint(UniversalRank.B, 'law:honest');
    const honest = ItemLaw.correct(piece, defs);
    expect(honest.ok && honest.changes).toEqual([]);
    const forged = ItemLaw.correct({ ...piece, itemPower: piece.itemPower * 4, rank: UniversalRank.B }, defs);
    const changes = forged.ok ? forged.changes : [];
    expect(changes.find(c => c.field === 'itemPower')?.value as number).toBeCloseTo(piece.itemPower, 9);
  });
});
