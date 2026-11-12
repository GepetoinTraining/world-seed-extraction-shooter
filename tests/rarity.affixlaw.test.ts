/**
 * THE RARITY RESCALE, part 2: the affix law (BALANCE_RUN 1.4, 1.5; 2.13 calls 9, 13, 16). Pedro: "uncommon
 * is technological with 1 stat (prefix or suffix), then magical 2 stats (one suffix one affix), rare 4 epic
 * 6", "Any stat, any piece", and asked whether a full epic kit should be worth a whole rank over a plain
 * one: "Yes, a whole rank". The ruler, decided by the coordinator on that word: ruler(stat, rank) = the
 * stat's plain reference at that rank, through its own reader, times one factor solved so a full epic kit
 * is one rank (`tests/kit.measure.test.ts` holds that bar).
 */

import { describe, it, expect } from 'vitest';
import { IAffix, Rarity, UniversalRank } from '../shared/types';
import { ItemFactory } from '../shared/entities/item/ItemFactory';
import { ItemDefinition } from '../shared/entities/item/data/itemDefinitions';
import { PieceLaw } from '../shared/logic/theme/PieceLaw';
import { compileTheme } from '../shared/logic/theme/ThemeCompiler';
import { AffixBank } from '../shared/logic/content/AffixBank';
import { DreamingSystem, IAffixPool } from '../shared/entities/world/Dreaming';
import { FIRST_THEME_PACK, installShippedThemes } from '../shared/logic/theme/boot';
import { FIRST_THEME } from '../shared/entities/generation/packs/firstTheme';
import { GEAR_SHAPES } from '../shared/logic/theme/ThemeFormula';
import { THEME_SCHEMA, GearKind } from '../shared/logic/theme/ThemeTypes';
import { THEME_GRAMMAR } from '../shared/intelligence/prompts';
import { ThemeLaw } from '../shared/logic/theme/ThemeLaw';
import { WebBank } from '../shared/logic/content/WebBank';
import { STAT_READERS } from '../shared/logic/systems/StatSystem';
import { statSide } from '../shared/constants';
import { Rng } from '../shared/logic/rng/DeterministicRNG';

installShippedThemes();

const RANKS = [UniversalRank.F, UniversalRank.E, UniversalRank.D, UniversalRank.C, UniversalRank.B, UniversalRank.A, UniversalRank.S, UniversalRank.SS, UniversalRank.SSS];

/** Every affix the shipped theme banks, in the roll pool's shape, whatever land it dreams in. */
export const themePool = (): IAffixPool => {
  const pack = AffixBank.compile(compileTheme(FIRST_THEME_PACK).affixBatches).pack!;
  const all = pack.entries.map(e => DreamingSystem.toAffixDefinition(e));
  return { prefixes: all.filter(a => a.type === 'PREFIX'), suffixes: all.filter(a => a.type === 'SUFFIX') };
};
const templateOf = (kind: GearKind): ItemDefinition => {
  const shape = GEAR_SHAPES[kind];
  return { id: `bar_${kind}`, universal_name: kind, rank: UniversalRank.F, base_ip: 0, kind, slot: shape.slot, tags: [...shape.tags], implicits: shape.implicits(0) };
};
type MintOpts = NonNullable<Parameters<typeof ItemFactory.createFromTemplate>[5]>;
const at = (kind: GearKind, key: string, rank: UniversalRank, opts: MintOpts = {}) =>
  ItemFactory.createFromTemplate(templateOf(kind), true, Rng.fromKey(key), themePool(), rank, { pairsOpen: true, ...opts });
const giftOf = (a: IAffix) => Object.entries(a.stats).filter(([, v]) => v > 0).map(([k]) => k);

describe('part 2: the ladder', () => {
  it('uncommon is one property on either side; magical one pair; rare two; epic three, on any piece', () => {
    for (const kind of ['ring', 'blade', 'chest', 'bag'] as GearKind[]) {
      const sides = new Set<string>();
      for (let i = 0; i < 16; i++) {
        const one = at(kind, `ladder:1:${kind}:${i}`, UniversalRank.C, { depth: 1 });
        expect(one.affixes).toHaveLength(1);
        expect(one.rarity).toBe(Rarity.UNCOMMON);
        sides.add(one.affixes[0].type);
      }
      expect(sides.size).toBe(2);
      for (const [depth, pairs, step] of [[2, 1, Rarity.MAGICAL], [3, 2, Rarity.RARE], [4, 3, Rarity.EPIC]] as const) {
        const piece = at(kind, `ladder:${depth}:${kind}`, UniversalRank.C, { depth });
        expect(piece.affixes.filter(a => a.type === 'PREFIX')).toHaveLength(pairs);
        expect(piece.affixes.filter(a => a.type === 'SUFFIX')).toHaveLength(pairs);
        expect(piece.rarity).toBe(step);
      }
    }
  });
});

describe('part 2: one affix, one stat', () => {
  it('gives one stat, on the side its reader decides, with at most one price; and a stat sits once on a piece', () => {
    for (let i = 0; i < 60; i++) {
      const piece = at((['ring', 'blade', 'chest', 'feet', 'necklace'] as GearKind[])[i % 5], `one:${i}`, UniversalRank.B, { depth: 4 });
      const gifts = piece.affixes.map(giftOf);
      gifts.forEach((g, n) => {
        expect(g).toHaveLength(1);
        expect(piece.affixes[n].type).toBe(statSide(g[0]));
        expect(Object.values(piece.affixes[n].stats).filter(v => v < 0).length).toBeLessThanOrEqual(1);
      });
      const stats = gifts.map(g => g[0]);
      expect(new Set(stats).size).toBe(stats.length);
    }
  });

  it('is sized band x ruler(stat, the carrier\'s rank) x (1 + quality); a price is a smaller band taken and added to the gift', () => {
    const band = { minor: 1 / 12, moderate: 1 / 6, major: 1 / 3 };
    expect(PieceLaw.BANDS).toEqual(band);
    let seen = 0, priced = 0;
    for (let i = 0; i < 80; i++) {
      const rank = RANKS[i % RANKS.length];
      const piece = at('chest', `size:${i}`, rank, { depth: 4, band: 'moderate' });
      for (const a of piece.affixes) {
        const [gift] = giftOf(a);
        const price = Object.entries(a.stats).find(([, v]) => v < 0);
        const lift = price ? band.minor : 0;
        expect(a.stats[gift]).toBeCloseTo((band.moderate + lift) * PieceLaw.ruler(gift, rank) * (1 + piece.quality), 9);
        if (price) { priced++; expect(price[1]).toBeCloseTo(-band.minor * PieceLaw.ruler(price[0], rank) * (1 + piece.quality), 9); }
        seen++;
      }
    }
    expect(seen).toBeGreaterThan(200);
    expect(priced).toBeGreaterThan(0);
  });

  it('a ruler doubles a rank for an amount and reads no rank for a rating, and is one factor times its plain reference', () => {
    expect(PieceLaw.ruler('damage', UniversalRank.C) / PieceLaw.ruler('damage', UniversalRank.F)).toBeCloseTo(8, 9);
    expect(PieceLaw.ruler('evasion_rating', UniversalRank.S)).toBeCloseTo(PieceLaw.ruler('evasion_rating', UniversalRank.F), 9);
    for (const stat of ['damage', 'max_health', 'defense', 'crit_chance', 'movement_speed', 'luck_find_rarity']) {
      expect(PieceLaw.ruler(stat, UniversalRank.D)).toBeCloseTo(PieceLaw.RULER_FACTOR * PieceLaw.reference(stat, UniversalRank.D), 9);
    }
  });

  it('a kind\'s native line is one ruler of its stat at the piece\'s rank, and energy stays 1 to 2 on the focus and the belt', () => {
    for (const rank of [UniversalRank.F, UniversalRank.C, UniversalRank.S]) {
      // The boots' own pace stays as on main (the coordinator, 2026-11-12; tests/rarity.part3.test.ts)
      for (const [kind, stat] of [['necklace', 'max_health'], ['shoulder', 'defense'], ['ring', 'luck_find_rarity'], ['chest', 'defense']] as const) {
        const piece = at(kind, `native:${kind}:${rank}`, rank, { depth: 0 });
        expect(piece.stats[stat] / (1 + piece.quality)).toBeCloseTo(PieceLaw.ruler(stat, rank), 9);
      }
      for (const kind of ['focus', 'belt'] as const) {
        const piece = at(kind, `native:${kind}:${rank}`, rank, { depth: 0 });
        expect(piece.stats.max_energy / (1 + piece.quality)).toBeCloseTo(1.5, 9);
      }
    }
  });
});

describe('part 2: a name stays where its writer put it', () => {
  it('counts on the side its stat is read on, and stands in the name where it was written', () => {
    let seen = 0;
    for (let i = 0; i < 120 && seen < 3; i++) {
      const piece = at('belt', `name:${i}`, UniversalRank.D, { depth: 1 });
      const keeping = piece.affixes.find(a => a.name === 'of the Keeping');
      if (!keeping) continue;
      seen++;
      expect(keeping.type).toBe('PREFIX');
      expect(keeping.nameAt).toBe('SUFFIX');
      expect(piece.name.endsWith('of the Keeping')).toBe(true);
    }
    expect(seen).toBe(3);
  });
});

describe('part 2: how often, found', () => {
  it('the chance a find goes at least d steps deep is q^d, q = 0.4', () => {
    expect(PieceLaw.ODDS_Q).toBe(0.4);
    const n = 20000;
    const atLeast = [0, 0, 0, 0, 0];
    for (let i = 0; i < n; i++) {
      const d = PieceLaw.rollDepth(Rng.fromKey(`depth:${i}`), 1, true);
      for (let k = 0; k <= Math.min(d, 4); k++) atLeast[k]++;
    }
    for (let k = 1; k <= 4; k++) expect(Math.abs(atLeast[k] / n - Math.pow(0.4, k))).toBeLessThan(0.012);
  });

  it('the body it came from and the finder\'s luck move the odds, never the chance: it climbs and never arrives', () => {
    expect(PieceLaw.depthChance(1)).toBeCloseTo(0.4, 12);
    expect(PieceLaw.depthChance(2)).toBeGreaterThan(0.4);
    expect(PieceLaw.depthChance(1e6)).toBeLessThan(1);
    expect(PieceLaw.oddsOf({ luck: 0.5, tags: [] })).toBeCloseTo(1.5, 12);
    expect(PieceLaw.oddsOf({ luck: 0, tags: ['elite'] })).toBeGreaterThan(PieceLaw.oddsOf({ luck: 0, tags: [] }));
    expect(PieceLaw.oddsOf({ luck: 0, tags: ['boss'] })).toBeGreaterThan(PieceLaw.oddsOf({ luck: 0, tags: ['elite'] }));
    expect(STAT_READERS.luck_find_rarity).toBe('PieceLaw.oddsOf');
  });

  it('before a hub\'s magic unlock a find is uncommon at most, and uncommon is found; the unlock opens pairs', () => {
    let lone = 0;
    for (let i = 0; i < 2000; i++) {
      const d = PieceLaw.rollDepth(Rng.fromKey(`closed:${i}`), 1, false);
      expect(d).toBeLessThanOrEqual(1);
      lone += d;
    }
    expect(lone).toBeGreaterThan(600);
    const shut = at('ring', 'closed:piece', UniversalRank.F, { depth: 3, pairsOpen: false });
    expect(shut.affixes.length).toBeLessThanOrEqual(1);
    expect(shut.affixes.length).toBe(1);
  });
});

describe('part 2: the writer\'s tier is retired', () => {
  it('the writer is not asked for a tier, and a pack written without one stands', () => {
    const affixItems = ((THEME_SCHEMA as { properties: Record<string, { items: { required: string[] } }> }).properties.affixes.items);
    expect(affixItems.required).not.toContain('tier');
    expect(THEME_GRAMMAR).not.toMatch(/\btier\b/);
    const body = JSON.parse(JSON.stringify(FIRST_THEME));
    for (const a of body.affixes) delete a.tier;
    const verdict = ThemeLaw.validate(body, (tag: string) => WebBank.current().tags.some(t => t.tag === tag));
    expect(verdict.ok).toBe(true);
  });
});
