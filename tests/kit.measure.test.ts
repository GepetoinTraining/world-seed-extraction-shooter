/**
 * THE RULER, SOLVED AND HELD (the rarity rescale, part 2). Pedro, asked whether a full epic kit should be
 * worth a whole rank over a plain one: "Yes, a whole rank". One rank is what the spine says a rank is (1.2):
 * what a body holds doubles and what it deals doubles, so x 4 in holds times deals a second.
 *
 * The coordinator's ruling (2026-11-12): no ruler is hand-set. ruler(stat, rank) = the stat's plain reference
 * (PieceLaw.reference, through its own reader) x one shared factor, and the factor is solved here, not chosen:
 * every worn position epic, every affix moderate, stats falling as the shipped theme's roll lets them fall,
 * set against a plain kit of the same rank on the same body, through the fight's own readers. When the fight's
 * rebalance changes what bodies hold and deal, this bar goes red and the factor is solved again.
 */

import { describe, it, expect } from 'vitest';
import { IAttributes, IEquipmentState, IItem, MENTAL_ATTRIBUTES, PHYSICAL_ATTRIBUTES, UniversalRank } from '../shared/types';
import { ItemFactory } from '../shared/entities/item/ItemFactory';
import { ItemDefinition } from '../shared/entities/item/data/itemDefinitions';
import { PieceLaw } from '../shared/logic/theme/PieceLaw';
import { compileTheme } from '../shared/logic/theme/ThemeCompiler';
import { AffixBank } from '../shared/logic/content/AffixBank';
import { DreamingSystem, IAffixPool } from '../shared/entities/world/Dreaming';
import { FIRST_THEME_PACK, installShippedThemes } from '../shared/logic/theme/boot';
import { GEAR_SHAPES } from '../shared/logic/theme/ThemeFormula';
import { GearKind } from '../shared/logic/theme/ThemeTypes';
import { StatSystem } from '../shared/logic/systems/StatSystem';
import { POISON_MS, POISON_TICK_MS } from '../shared/logic/systems/FightNumbers';
import { CombatMath } from '../src/entities/combat/CombatMath';
import { Rng } from '../shared/logic/rng/DeterministicRNG';

installShippedThemes();

/** Every worn position, and the noun that fills it. */
const KIT: [string, GearKind][] = [
  ['RIGHT_HAND', 'blade'], ['HEAD', 'head'], ['EYES', 'eyes'], ['CHEST', 'chest'], ['LEGS', 'legs'], ['BOOTS', 'feet'],
  ['SHOULDER', 'shoulder'], ['BAG', 'bag'], ['NECKLACE', 'necklace'], ['EARRING', 'earring'], ['RING_1', 'ring'],
  ['RING_2', 'ring'], ['QUIVER', 'quiver'], ['BELT', 'belt'], ['TOOL_1', 'chop_tool']
];
const SAMPLES = 160;
const RANK_STEP: Record<string, number> = { F: 0, C: 3, S: 6 };

const themePool = (): IAffixPool => {
  const pack = AffixBank.compile(compileTheme(FIRST_THEME_PACK).affixBatches).pack!;
  const all = pack.entries.map(e => DreamingSystem.toAffixDefinition(e));
  return { prefixes: all.filter(a => a.type === 'PREFIX'), suffixes: all.filter(a => a.type === 'SUFFIX') };
};
const templateOf = (kind: GearKind): ItemDefinition => {
  const shape = GEAR_SHAPES[kind];
  return { id: `kit_${kind}`, universal_name: kind, rank: UniversalRank.F, base_ip: 0, kind, slot: shape.slot, tags: [...shape.tags], implicits: shape.implicits(0) };
};
const body = (rank: string): IAttributes =>
  Object.fromEntries([...PHYSICAL_ATTRIBUTES, ...MENTAL_ATTRIBUTES].map(a => [a, 1 + RANK_STEP[rank]])) as unknown as IAttributes;

/** A piece split into what the factor scales (rulers: native lines that are one, and every affix) and what it does not. */
interface IParts { item: IItem; fixed: Record<string, number>; scaled: Record<string, number> }
const add = (into: Record<string, number>, from: Record<string, number>, by = 1) => { for (const [k, v] of Object.entries(from)) into[k] = (into[k] ?? 0) + v * by; };

const partsOf = (kind: GearKind, rank: string, affixStats: Record<string, number>, item: IItem): IParts => {
  const fixed: Record<string, number> = {}, scaled: Record<string, number> = {};
  for (const line of PieceLaw.nativeLines(kind, RANK_STEP[rank])) {
    const isRuler = Math.abs(line.value - PieceLaw.ruler(line.stat, rank)) < 1e-9;
    add(isRuler ? scaled : fixed, { [line.stat]: line.value });
  }
  add(scaled, affixStats);
  return { item, fixed, scaled };
};

const mint = (kind: GearKind, rank: string, key: string, depth: number) =>
  ItemFactory.createFromTemplate(templateOf(kind), true, Rng.fromKey(key), themePool(), rank as UniversalRank, { depth, band: 'moderate', quality: 0, pairsOpen: true });

const plainKit = (rank: string): IParts[] => KIT.map(([slot, kind]) => partsOf(kind, rank, {}, mint(kind, rank, `kit:plain:${slot}:${rank}`, 0)));

/** The expected epic kit: each position's affixes averaged over many epic finds, as the roll lets them fall. */
const epicKit = (rank: string): IParts[] => KIT.map(([slot, kind]) => {
  const sum: Record<string, number> = {};
  let item: IItem | undefined;
  for (let i = 0; i < SAMPLES; i++) {
    const piece = mint(kind, rank, `kit:epic:${slot}:${rank}:${i}`, 4);
    item ??= piece;
    for (const a of piece.affixes) add(sum, a.stats, 1 / SAMPLES);
  }
  return partsOf(kind, rank, sum, item!);
});

/** A kit with every affix it can put into one side: three amounts and three ratings a piece, a stat once, moderate. */
const sidedKit = (rank: string, amounts: string[], ratings: string[]): IParts[] => KIT.map(([slot, kind]) => {
  const affixes: Record<string, number> = {};
  for (const stat of [...amounts.slice(0, 3), ...ratings.slice(0, 3)]) add(affixes, PieceLaw.affixStats({ gift: { stat, band: 'moderate' } }, rank, 0));
  return partsOf(kind, rank, affixes, mint(kind, rank, `kit:side:${slot}:${rank}`, 0));
});

/** The kit as worn, with the factor-scaled part moved from the factor it was minted at to `factor`. */
const wear = (kit: IParts[], factor: number): IEquipmentState => {
  const items = kit.map(({ item, fixed, scaled }, i) => {
    const stats: Record<string, number> = { durability: 100, maxDurability: 100 };
    add(stats, fixed);
    add(stats, scaled, factor / PieceLaw.RULER_FACTOR);
    return { ...item, id: `${item.id}_${i}`, stats } as IItem;
  });
  return { slots: Object.fromEntries(KIT.map(([slot], i) => [slot, items[i].id])), items, frames: {}, protected: [] } as IEquipmentState;
};

/** Holds times deals a second, through the fight's own readers. */
const power = (eq: IEquipmentState, attrs: IAttributes) => {
  const weapon = eq.items.find(i => i.id === eq.slots.RIGHT_HAND)!;
  // A chance past one is a certainty to its reader (rng.next() < it), so the measure reads it so
  const taken = (1 - Math.min(1, CombatMath.dodgeChance(eq, attrs))) * (1 - Math.min(1, CombatMath.blockChance(eq)) * (1 - CombatMath.blockFactor()))
    * StatSystem.blowFactor(attrs) * (1 - CombatMath.mitigationOf(eq));
  const holds = StatSystem.maxHealth(attrs, eq) / taken;
  const base = CombatMath.baseHit(weapon, eq, attrs);
  const c = Math.min(1, Math.max(0, StatSystem.critChance(eq, attrs)));
  const g = Math.min(1, Math.max(0, CombatMath.glanceChance(eq, attrs)));
  const hit = c * base * CombatMath.critMultiplier(eq) + (1 - c) * (g * base * CombatMath.glanceFactor() + (1 - g) * base)
    + StatSystem.total(eq, 'poison_damage') * (POISON_MS / POISON_TICK_MS);
  return holds * hit * (1000 / CombatMath.fireCooldownMs(weapon, eq, attrs));
};

const ratio = (kit: IParts[], plain: IParts[], rank: string, factor: number) => power(wear(kit, factor), body(rank)) / power(wear(plain, factor), body(rank));

const DEALING = { amounts: ['damage', 'poison_damage', 'carry_capacity'], ratings: ['crit_chance', 'crit_multiplier', 'attack_speed'] };
const HOLDING = { amounts: ['max_health', 'carry_capacity', 'pickup_radius'], ratings: ['defense', 'evasion_rating', 'block_chance'] };

describe('the ruler: one factor, solved so a full epic kit is one rank', () => {
  const ranks = ['F', 'C', 'S'];
  const kits = Object.fromEntries(ranks.map(r => [r, { plain: plainKit(r), epic: epicKit(r) }]));
  /** The factor at which the three ranks' figures meet one rank, x 4, on their geometric mean. */
  const solve = () => {
    const at = (k: number) => Math.exp(ranks.reduce((s, r) => s + Math.log(ratio(kits[r].epic, kits[r].plain, r, k)), 0) / ranks.length);
    let lo = 0.001, hi = 50;
    for (let i = 0; i < 80; i++) { const mid = Math.sqrt(lo * hi); if (at(mid) < 4) lo = mid; else hi = mid; }
    return Math.sqrt(lo * hi);
  };

  it('the factor in the law is the one the measured kit solves to', () => {
    const solved = solve();
    const rows = ranks.map(r => {
      const k = PieceLaw.RULER_FACTOR;
      return `${r}: expected epic x ${ratio(kits[r].epic, kits[r].plain, r, k).toFixed(2)}; all into dealing x ${ratio(sidedKit(r, DEALING.amounts, DEALING.ratings), kits[r].plain, r, k).toFixed(2)}; all into holding x ${ratio(sidedKit(r, HOLDING.amounts, HOLDING.ratings), kits[r].plain, r, k).toFixed(2)}`;
    });
    console.log(`[KIT] solved factor ${solved.toFixed(4)}, in the law ${PieceLaw.RULER_FACTOR}\n[KIT] ${rows.join('\n[KIT] ')}`);
    expect(Math.abs(PieceLaw.RULER_FACTOR / solved - 1)).toBeLessThan(0.01);
  });

  it('holds the expected epic kit at one rank, x 3.84 to x 4.33, at F, C and S', () => {
    for (const r of ranks) {
      const x = ratio(kits[r].epic, kits[r].plain, r, PieceLaw.RULER_FACTOR);
      expect(x).toBeGreaterThanOrEqual(3.84);
      expect(x).toBeLessThanOrEqual(4.33);
    }
  });
});

describe('the ruler: each reference is what its own reader needs for the same lift', () => {
  const attrs = body('F');
  const bare: IEquipmentState = { slots: {}, items: [], frames: {}, protected: [] };
  const wearing = (stat: string, value: number): IEquipmentState => {
    const item = { id: 'probe', stats: { [stat]: value, durability: 100, maxDurability: 100 } } as unknown as IItem;
    return { slots: { RING_1: 'probe' }, items: [item], frames: {}, protected: [] } as IEquipmentState;
  };
  const lift = (stat: string, read: (eq: IEquipmentState) => number, eps = 1e-4) => {
    return (read(wearing(stat, eps * PieceLaw.reference(stat, 'F'))) / read(bare) - 1) / eps;
  };
  it('a small share of a reference lifts its reader by that share', () => {
    expect(lift('max_health', eq => StatSystem.maxHealth(attrs, eq))).toBeCloseTo(1, 3);
    expect(lift('defense', eq => 1 / (1 - CombatMath.mitigationOf(eq)))).toBeCloseTo(1, 3);
    expect(lift('evasion_rating', eq => 1 / (1 - CombatMath.dodgeChance(eq, attrs)))).toBeCloseTo(1, 3);
    expect(lift('block_chance', eq => 1 / (1 - CombatMath.blockChance(eq) * (1 - CombatMath.blockFactor())))).toBeCloseTo(1, 3);
    expect(lift('crit_chance', eq => 1 + StatSystem.critChance(eq, attrs) * (CombatMath.critMultiplier(eq) - 1))).toBeCloseTo(1, 3);
    expect(lift('crit_multiplier', eq => CombatMath.critMultiplier(eq))).toBeCloseTo(1, 3);
    expect(lift('accuracy_rating', eq => 1 - CombatMath.glanceChance(eq, attrs) * (1 - CombatMath.glanceFactor()))).toBeCloseTo(1, 2);
    // The cooldown is whole milliseconds, so haste is probed with a whole reference: it doubles a bare hand's rate
    expect(lift('attack_speed', eq => 1000 / CombatMath.fireCooldownMs(undefined, eq, attrs), 1)).toBeCloseTo(1, 6);
    expect(lift('damage', eq => CombatMath.weaponDamage(undefined, eq) + PieceLaw.reference('damage', 'F') - 5)).toBeCloseTo(1, 3);
  });
});
