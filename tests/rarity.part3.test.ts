/**
 * THE RARITY RESCALE, part 3: what is left of the law, and how it is said (BALANCE_RUN 1.4, 2.13 call 17),
 * with the coordinator's four calls on part 2 (2026-11-12). Pedro: legendary and artifact are "whose the
 * piece was"; the stat keys cleaned; the card says the step in words and by shape and position.
 */

import { describe, it, expect } from 'vitest';
import { IAttributes, IEquipmentState, IItem, Rarity, UniversalRank, MENTAL_ATTRIBUTES, PHYSICAL_ATTRIBUTES } from '../shared/types';
import { ItemFactory } from '../shared/entities/item/ItemFactory';
import { ItemDefinition } from '../shared/entities/item/data/itemDefinitions';
import { PieceLaw } from '../shared/logic/theme/PieceLaw';
import { GEAR_SHAPES } from '../shared/logic/theme/ThemeFormula';
import { GearKind } from '../shared/logic/theme/ThemeTypes';
import { FIRST_THEME } from '../shared/entities/generation/packs/firstTheme';
import { installShippedThemes } from '../shared/logic/theme/boot';
import { ThemeLaw } from '../shared/logic/theme/ThemeLaw';
import { WebBank } from '../shared/logic/content/WebBank';
import { THEME_GRAMMAR } from '../shared/intelligence/prompts';
import { LoadoutSystem } from '../shared/entities/player/systems/LoadoutSystem';
import { StatSystem } from '../shared/logic/systems/StatSystem';
import { ItemLaw } from '../shared/logic/content/ItemLaw';
import { RARITIES, itemArt, gearMaterial } from '../shared/render/atoms/atoms';
import { CombatMath } from '../src/entities/combat/CombatMath';
import { LootTable } from '../src/entities/world/LootTable';
import { inspectItem } from '../src/render/atoms/inspect';
import { IMobDefinition } from '../shared/entities/mob/types';
import { Rng } from '../shared/logic/rng/DeterministicRNG';

installShippedThemes();

const templateOf = (kind: GearKind): ItemDefinition => {
  const shape = GEAR_SHAPES[kind];
  return { id: `p3_${kind}`, universal_name: kind, rank: UniversalRank.F, base_ip: 0, kind, slot: shape.slot, tags: [...shape.tags], implicits: shape.implicits(0) };
};
const bare = (kind: GearKind, rank: UniversalRank, key: string, quality = 0) =>
  ItemFactory.createFromTemplate(templateOf(kind), true, Rng.fromKey(key), { prefixes: [], suffixes: [] }, rank, { depth: 0, quality });
const floor = (step: number): IAttributes => Object.fromEntries([...PHYSICAL_ATTRIBUTES, ...MENTAL_ATTRIBUTES].map(a => [a, 1 + step])) as unknown as IAttributes;
const wearing = (...items: [string, IItem][]): IEquipmentState =>
  ({ slots: Object.fromEntries(items.map(([slot, i]) => [slot, i.id])), items: items.map(([, i]) => i), frames: {}, protected: [] }) as IEquipmentState;
const affixDef = (id: string, type: 'PREFIX' | 'SUFFIX', stat: string) =>
  ({ id, nameTemplate: id, type, allowedTags: ['armor', 'jewelry', 'melee', 'ranged'], tier: 1, statModifiers: { [stat]: [1, 2] }, gives: [{ stat, band: 'moderate', downside: false }] });

describe('the coordinator\'s calls on part 2', () => {
  it('a plain body in plain boots walks what it walked on main: the boots\' own pace line, 0.03 to 0.06 at its middle, no rank', () => {
    for (const rank of [UniversalRank.F, UniversalRank.C, UniversalRank.S]) {
      const feet = bare('feet', rank, `walk:${rank}`);
      expect(feet.stats.movement_speed).toBeCloseTo(0.045, 12);
      // On pace's curve since the fight's part 3: 4 x (1 + 0.045 / 1.045)
      expect(LoadoutSystem.walkTilesPerSecond(wearing(['BOOTS', feet]), floor(0))).toBeCloseTo(4 * (1 + 0.045 / 1.045), 9);
    }
    // Pace as a property still sizes from the solved ruler
    const words = PieceLaw.wordsOf({ gives: [{ stat: 'movement_speed', band: 'moderate', downside: false }] })!;
    expect(PieceLaw.affixStats(words, 'C', 0).movement_speed).toBeCloseTo(PieceLaw.ruler('movement_speed', 'C') / 6, 12);
  });

  it('a land whose words cannot fill a step stops at the deepest step they fill', () => {
    const thin = {
      prefixes: [affixDef('a_health', 'PREFIX', 'max_health'), affixDef('a_damage', 'PREFIX', 'damage')],
      suffixes: [affixDef('r_def', 'SUFFIX', 'defense'), affixDef('r_eva', 'SUFFIX', 'evasion_rating'), affixDef('r_crit', 'SUFFIX', 'crit_chance'), affixDef('r_block', 'SUFFIX', 'block_chance')]
    };
    for (let i = 0; i < 10; i++) {
      const piece = ItemFactory.createFromTemplate(templateOf('chest'), true, Rng.fromKey(`thin:${i}`), thin as never, UniversalRank.C, { depth: 4, pairsOpen: true });
      expect(piece.affixes.filter(a => a.type === 'PREFIX')).toHaveLength(2);
      expect(piece.affixes.filter(a => a.type === 'SUFFIX')).toHaveLength(2);
      expect(piece.rarity).toBe(Rarity.RARE);
    }
  });

  it('a theme written from now on holds at least three amounts and three ratings among its gear affixes; the pinned pack stands', () => {
    const registered = (tag: string) => WebBank.current().tags.some(t => t.tag === tag);
    expect(ThemeLaw.validate(JSON.parse(JSON.stringify(FIRST_THEME)), registered).ok).toBe(true);
    const thin = JSON.parse(JSON.stringify(FIRST_THEME));
    thin.affixes = thin.affixes.filter((a: { gives: { stat: string }[] }) => !['poison_damage', 'carry_capacity'].includes(a.gives[0].stat));
    const verdict = ThemeLaw.validate(thin, registered);
    expect(verdict.ok).toBe(false);
    expect(ThemeLaw.validate(thin, registered, 4).ok).toBe(true);
    expect(THEME_GRAMMAR).toMatch(/three/);
  });
});

describe('legendary and artifact: whose the piece was', () => {
  const body = (tags: string[], rank = UniversalRank.C) => ({ id: `mob_${tags.join('_')}`, name: 'Ledger Wyrm', tags: ['biological', ...tags], rank, baseHealth: 100, baseDamage: 10 }) as unknown as IMobDefinition;

  it('a boss\'s own piece carries its name and its traits, says legendary, and keeps its count beneath', () => {
    let own: IItem | undefined;
    for (let i = 0; i < 60 && !own; i++) {
      const loot = LootTable.generateLoot(body(['boss']), 1, undefined, `boss:${i}`, 'Auditor Vane', PieceLaw.FROM_GROUND, 0, { bonusHealth: 40 });
      own = loot.find(item => item.whose);
    }
    expect(own).toBeDefined();
    expect(own!.whose).toMatchObject({ name: 'Auditor Vane', kind: 'boss', traits: ['max_health'] });
    expect(own!.name.startsWith('Auditor Vane\'s ')).toBe(true);
    expect(own!.rarity).toBe(Rarity.LEGENDARY);
    expect(own!.rank).toBe(UniversalRank.C);
    expect(own!.stats.max_health).toBeGreaterThan(0);
    expect(PieceLaw.wordOf(own!)).toBe(Rarity.LEGENDARY);
  });

  it('a titan\'s or a god\'s own piece says artifact, at the body\'s own rank', () => {
    const loot = LootTable.generateLoot(body(['titan'], UniversalRank.A), 1, undefined, 'titan:1', 'The Assessor', PieceLaw.FROM_GROUND, 0);
    const own = loot.find(item => item.whose);
    expect(own?.whose?.kind).toBe('titan');
    expect(own?.rarity).toBe(Rarity.ARTIFACT);
    expect(own?.rank).toBe(UniversalRank.A);
    expect(own?.name.startsWith('The Assessor\'s ')).toBe(true);
  });

  it('the hub reads the word from whose it was, and corrects a forged one', () => {
    const piece = { ...bare('blade', UniversalRank.D, 'whose:law'), whose: { name: 'Vane', kind: 'boss' as const, traits: [] } };
    piece.rarity = Rarity.ARTIFACT;
    const defs = { base: () => templateOf('blade'), resource: () => undefined, step: () => undefined };
    const verdict = ItemLaw.correct(piece, defs);
    const changes = verdict.ok ? verdict.changes : [];
    expect(changes.find(c => c.field === 'rarity')?.value).toBe(Rarity.LEGENDARY);
  });
});

describe('the stat keys, cleaned', () => {
  it('protection is one rating: head, chest and legs carry guard as one ruler, and no top', () => {
    for (const kind of ['head', 'chest', 'legs'] as GearKind[]) {
      const piece = bare(kind, UniversalRank.C, `guard:${kind}`);
      expect(piece.stats.physical_reduction).toBeUndefined();
      expect(piece.stats.defense).toBeCloseTo(PieceLaw.ruler('defense', 'C'), 9);
    }
    const heavy = { id: 'heavy', stats: { defense: 1000, durability: 100, maxDurability: 100 } } as unknown as IItem;
    const m = CombatMath.mitigationOf(wearing(['CHEST', heavy]));
    expect(m).toBeGreaterThan(0.6);
    expect(m).toBeLessThan(1);
    // A piece of the old law's straight share reads as the same rating: two of 0.3 stop 46%, not 60%
    const old = (id: string) => ({ id, stats: { physical_reduction: 0.3, durability: 100, maxDurability: 100 } }) as unknown as IItem;
    expect(CombatMath.mitigationOf(wearing(['HEAD', old('a')]))).toBeCloseTo(0.3, 9);
    const each = 100 * 0.3 / 0.7;
    expect(CombatMath.mitigationOf(wearing(['HEAD', old('a')], ['LEGS', old('b')]))).toBeCloseTo(2 * each / (2 * each + 100), 9);
  });

  it('carrying is one key: a bag carries carry_capacity, counted once', () => {
    const bag = bare('bag', UniversalRank.F, 'carry:bag');
    expect(bag.stats.carry_bonus_kg).toBeUndefined();
    expect(bag.stats.carry_capacity).toBeCloseTo(PieceLaw.ruler('carry_capacity', 'F'), 9);
    const eq = wearing(['BAG', bag]);
    expect(LoadoutSystem.carryLimit(1, eq)).toBeCloseTo(LoadoutSystem.carryLimit(1) + bag.stats.carry_capacity, 9);
    expect(LoadoutSystem.bagCapacityBonus(eq)).toBeCloseTo(bag.stats.carry_capacity, 9);
  });

  it('a weapon\'s own rate is its kind\'s and never an affix; haste is what the rest of the body adds', () => {
    const blade = bare('blade', UniversalRank.F, 'rate:blade');
    expect(blade.stats.attack_speed).toBeCloseTo(1.2, 12);
    const quiver = bare('quiver', UniversalRank.F, 'rate:quiver');
    expect(quiver.stats.attack_speed).toBeUndefined();
    expect(quiver.stats.haste).toBeCloseTo(PieceLaw.ruler('haste', 'F'), 9);
    expect(PieceLaw.wordsOf({ gives: [{ stat: 'attack_speed', band: 'moderate', downside: false }] })!.gift.stat).toBe('haste');
    expect(StatSystem.isRead('haste')).toBe(true);
    const eq = wearing(['RIGHT_HAND', blade], ['QUIVER', quiver]);
    expect(CombatMath.fireCooldownMs(blade, eq, floor(0))).toBe(Math.round(1000 / (1.2 + quiver.stats.haste)));
  });
});

describe('the card says the step', () => {
  it('in words, with how many stand before the name and after it', () => {
    const pool = { prefixes: [affixDef('a_health', 'PREFIX', 'max_health')], suffixes: [affixDef('r_def', 'SUFFIX', 'defense')] };
    const magical = ItemFactory.createFromTemplate(templateOf('ring'), true, Rng.fromKey('card:magical'), pool as never, UniversalRank.C, { depth: 2, pairsOpen: true });
    const step = inspectItem(magical).rows.find(([k]) => k === 'Step');
    expect(step?.[1]).toBe('Magical: one before its name, one after');
    const plain = inspectItem(bare('ring', UniversalRank.C, 'card:common')).rows.find(([k]) => k === 'Step');
    expect(plain?.[1]).toBe('Common: nothing above normal');
    const own = { ...magical, whose: { name: 'Auditor Vane', kind: 'boss' as const, traits: ['max_health'] }, rarity: Rarity.LEGENDARY };
    expect(inspectItem(own).rows.find(([k]) => k === 'Step')?.[1]).toBe('Legendary: Auditor Vane\'s own, a boss\'s; one before its name, one after');
  });

  it('by the frame\'s shape, a magical piece with a frame of its own', () => {
    expect(RARITIES).toContain('MAGICAL');
    const base = { wCells: 1, hCells: 1, tags: ['melee', 'blade'], material: gearMaterial(['melee', 'blade']), rank: 'C', quality: 0, seed: 7 };
    const of = (rarity: string) => Array.from(itemArt({ ...base, rarity }).data).join(',');
    for (const other of ['COMMON', 'UNCOMMON', 'RARE', 'EPIC']) expect(of('MAGICAL')).not.toBe(of(other));
  });

  it('shows a number as a person reads it, never a long tail', () => {
    const piece = bare('necklace', UniversalRank.C, 'card:numbers', 0.137);
    const row = inspectItem(piece).rows.find(([k]) => k === 'max health');
    expect(row?.[1]).toMatch(/^-?\d+(\.\d{1,2})?$/);
  });
});

describe('the writer\'s prompt', () => {
  it('says what a size word means for a cart, asks no tier, and asks three amounts and three ratings', () => {
    expect(THEME_GRAMMAR).toMatch(/cart/i);
    expect(THEME_GRAMMAR).toMatch(/bed/);
    expect(THEME_GRAMMAR).not.toMatch(/\btier\b/);
  });
});
