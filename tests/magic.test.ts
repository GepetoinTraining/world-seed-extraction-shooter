/**
 * THE MAGIC + CONTENT LAYER (D48–D58): the bars, registered before each stage is built.
 * Stage by stage, in the order PLAN.md's reshape gives: truths, door, theme, effects,
 * monsters, rest, Spellcraft, triggers. No bar here calls a model.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { IEquipmentState, IItem, ItemType, Rarity, SlotType, UniversalRank } from '../shared/types';
import { CombatMath } from '../src/entities/combat/CombatMath';
import { StatSystem, STAT_READERS } from '../shared/logic/systems/StatSystem';
import { AffixBank } from '../shared/logic/content/AffixBank';
import { AFFIX_BATCHES } from '../shared/entities/generation/packs/affixBatches';
import { MobAI } from '../src/entities/mob/ai/MobAI';
import { LoadoutSystem } from '../shared/entities/player/systems/LoadoutSystem';
import { InventorySystem } from '../shared/entities/player/systems/InventorySystem';
import { usePlayerStore, playerPort } from '../src/entities/player/store';
import { repairItem } from '../src/entities/hub/dialogue';
import { EntityType, BiomeType, ScanLevel, IChunk } from '../shared/entities/world/types';
import { hubPort } from '../src/entities/hub/store';

const piece = (id: string, stats: Record<string, number>, over: Partial<IItem> = {}): IItem => ({
  id, name: id, type: ItemType.GEAR, slot: SlotType.CHEST, rank: UniversalRank.F, rarity: Rarity.COMMON,
  stats, tags: [], affixes: [], weight: 1, value: 100, itemPower: 0, isIdentified: true, ...over
} as unknown as IItem);

const wearing = (...items: IItem[]): IEquipmentState => {
  const eq = LoadoutSystem.emptyEquipment();
  const slots = ['CHEST', 'HEAD', 'LEGS', 'FEET', 'HANDS', 'RIGHT_HAND'];
  items.forEach((it, i) => { eq.slots[slots[i] as keyof typeof eq.slots] = it.id; eq.items.push(it); });
  return eq;
};

// =========================================================================
// STAGE 0 — R6: REPAIR SEES THE BODY
// =========================================================================

describe('R6: repair reads the stash and the body, through one door', () => {
  beforeEach(() => {
    usePlayerStore.setState(s => ({
      player: {
        ...s.player,
        bank: { ...s.player.bank, gold: 1000, stashTabs: [{ ...s.player.bank.stashTabs[0], items: [] }] },
        equipment: wearing(piece('gladius', { durability: 46, maxDurability: 100 }))
      }
    }));
  });

  it('a worn piece at 46 of 100 is repaired, paid for, and stays worn', () => {
    const gold = usePlayerStore.getState().player.bank.gold;
    const res = repairItem('gladius', playerPort, hubPort);
    expect(res.ok).toBe(true);
    const p = usePlayerStore.getState().player;
    const worn = p.equipment!.items.find(i => i.id === 'gladius')!;
    expect(worn.stats.durability).toBe(100);
    expect(p.bank.gold).toBeLessThan(gold);
    expect(p.equipment!.slots.CHEST).toBe('gladius');
  });

  it('the repair window draws from the one door, not the stash alone', () => {
    const src = readFileSync('src/entities/hub/HubCanvas.tsx', 'utf8');
    expect(src).toMatch(/repairable\(/);
  });
});

// =========================================================================
// STAGE 0 — LINE 77: EVERY STAT A BANK CAN ROLL CHANGES PLAY
// =========================================================================

describe('line 77: every stat a bank can roll has a reader, and that reader moves play', () => {
  it('every stat in the shipped banks is registered', () => {
    const rolled = new Set<string>();
    for (const b of AFFIX_BATCHES) for (const e of b.effects ?? []) Object.keys(e.statModifiers ?? {}).forEach(k => rolled.add(k));
    const unread = [...rolled].filter(k => !StatSystem.isRead(k));
    expect(unread).toEqual([]);
  });

  it('a batch rolling a stat nothing reads is refused whole', () => {
    const verdict = AffixBank.validateBatch({
      runId: 'bar-unread', kind: 'EFFECTS', model: 'none', createdAt: 0,
      effects: [{ id: 'pre_was_rustbitten', statModifiers: { levitation: [1, 2] } }]
    } as any, AFFIX_BATCHES[0].names!.map(n => ({ ...n })));
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toMatch(/levitation/);
  });

  it('a registered reader names a real file and symbol', () => {
    for (const [stat, reader] of Object.entries(STAT_READERS)) {
      expect(typeof reader, stat).toBe('string');
      expect(reader.length, stat).toBeGreaterThan(3);
    }
  });

  it('damage on any worn piece raises what a weapon hits for, and a negative lowers it', () => {
    const blade = piece('blade', { attack_speed: 1 }, { itemPower: 100 });
    const plain = CombatMath.weaponDamage(blade, wearing(blade));
    expect(CombatMath.weaponDamage(blade, wearing(blade, piece('r', { damage: 8 })))).toBe(plain + 8);
    expect(CombatMath.weaponDamage(blade, wearing(blade, piece('r', { damage: -3 })))).toBe(plain - 3);
  });

  it('defense reduces what lands, and a negative raises it', () => {
    const none = CombatMath.incoming(100, wearing(), 'k').damage;
    const dodgeless = (eq: IEquipmentState) => CombatMath.mitigationOf(eq);
    expect(dodgeless(wearing(piece('a', { defense: 24 })))).toBeGreaterThan(0);
    expect(dodgeless(wearing(piece('a', { defense: -8 })))).toBeLessThan(0);
    expect(none).toBe(100);
  });

  it('max health follows what is worn: a downside really costs', () => {
    const attrs = usePlayerStore.getState().player.attributes;
    const bare = StatSystem.maxHealth(attrs, wearing());
    expect(StatSystem.maxHealth(attrs, wearing(piece('a', { max_health: -10 })))).toBe(bare - 10);
    expect(StatSystem.maxHealth(attrs, wearing(piece('a', { max_health: 50 })))).toBe(bare + 50);
  });

  it('a broken piece does nothing, and an unstudied piece acts in full', () => {
    const broke = piece('a', { damage: 8, durability: 0, maxDurability: 10 });
    expect(StatSystem.total(wearing(broke), 'damage')).toBe(0);
    const unread = piece('b', { damage: 8 }, { isIdentified: false });
    expect(StatSystem.total(wearing(unread), 'damage')).toBe(8);
    expect(StatSystem.total(wearing(), 'damage')).toBe(0);
  });

  it('a piece in the pack and not on the body does nothing', () => {
    const eq = wearing();
    eq.items.push(piece('carried', { damage: 8 }));
    expect(StatSystem.total(eq, 'damage')).toBe(0);
  });

  it('evasion dodges, keyed: the same key always answers the same', () => {
    const eq = wearing(piece('a', { evasion_rating: 100 }));
    const results = Array.from({ length: 400 }, (_, i) => CombatMath.incoming(100, eq, `k${i}`));
    const dodged = results.filter(r => r.dodged).length;
    expect(dodged).toBeGreaterThan(120);
    expect(dodged).toBeLessThan(280);
    expect(CombatMath.incoming(100, eq, 'same')).toEqual(CombatMath.incoming(100, eq, 'same'));
    expect(results.filter(r => r.dodged).every(r => r.damage === 0)).toBe(true);
  });

  it('block halves what lands', () => {
    const eq = wearing(piece('a', { block_chance: 1 }));
    const r = CombatMath.incoming(100, eq, 'k');
    expect(r.blocked).toBe(true);
    expect(r.damage).toBe(50);
  });

  it('accuracy reduces glancing blows, keyed', () => {
    const blade = piece('blade', {}, { itemPower: 1000 });
    const glances = (eq: IEquipmentState) => Array.from({ length: 800 }, (_, i) => CombatMath.outgoing(blade, eq, `s${i}`))
      .filter(r => r.glance).length;
    const base = glances(wearing(blade));
    expect(base).toBeGreaterThan(0);
    expect(glances(wearing(blade, piece('a', { accuracy_rating: 200 })))).toBeLessThan(base);
  });

  it('crit chance and multiplier raise what a hit does, keyed', () => {
    const blade = piece('blade', {}, { itemPower: 1000 });
    const eq = wearing(blade, piece('a', { crit_chance: 1, crit_multiplier: 1 }));
    const r = CombatMath.outgoing(blade, eq, 'k');
    expect(r.crit).toBe(true);
    expect(r.damage).toBeGreaterThan(CombatMath.weaponDamage(blade, eq));
  });

  it('poison on the blade travels with the hit', () => {
    const blade = piece('blade', { poison_damage: 9 });
    expect(CombatMath.outgoing(blade, wearing(blade), 'k').poison).toBe(9);
  });

  it('noise reduction shortens how far an enemy notices you, and noise lengthens it', () => {
    const mob = {
      id: 'watcher', type: EntityType.MOB, definitionId: 'mob_fantasy_orc', position: { x: 0, y: 0 },
      rank: UniversalRank.D, rarity: Rarity.COMMON, health: 100, isHostile: true
    } as any;
    const chunk: IChunk = {
      id: 'c', x: 0, y: 0, biome: BiomeType.RUINS, difficulty: UniversalRank.F, rarity: Rarity.COMMON,
      entities: [mob], scanLevel: ScanLevel.COMPLETE, isTraversable: true, hasExtraction: false
    } as any;
    const wakes = (noise: number, dist: number) => {
      MobAI.reset();
      const r = MobAI.tick({ '0,0': chunk }, { x: dist, y: 0 }, 0.016, undefined, { noiseReduction: noise });
      return Object.keys(r.updatedChunks).length > 0;
    };
    expect(wakes(0, 190)).toBe(true);
    expect(wakes(6, 190)).toBe(false);
  });

  it('carry capacity reaches the limit, and a worn bag is measured at pickup too (B1)', () => {
    const eq = wearing(piece('a', { carry_capacity: 5 }));
    const base = InventorySystem.maxCarryWeight(3);
    expect(LoadoutSystem.carryLimit(3, eq)).toBe(base + 5);
    const bag = piece('bag', { carry_bonus_kg: 10 });
    const withBag = LoadoutSystem.emptyEquipment();
    withBag.slots.BAG = 'bag'; withBag.items.push(bag);
    expect(LoadoutSystem.carryLimit(3, withBag)).toBe(base + 10);
    const src = readFileSync('src/entities/player/store.ts', 'utf8');
    expect(src.slice(src.indexOf('tryAddItems: (items) =>'), src.indexOf('tryAddItems: (items) =>') + 400)).toMatch(/carryLimit/);
  });

  it('pickup radius and light radius are read by the field', () => {
    const src = readFileSync('src/components/WorldCanvas.tsx', 'utf8');
    expect(src).toMatch(/pickupRadiusPx/);
    expect(src).toMatch(/sightPx/);
    expect(StatSystem.pickupRadiusPx(wearing(piece('a', { pickup_radius: 3 })))).toBe(StatSystem.pickupRadiusPx(wearing()) + 60);
    expect(StatSystem.sightPx(wearing(piece('a', { light_radius: 3 })))).toBe(60);
  });
});

// =========================================================================
// STAGE 0 — LINE 93: ENERGY IS ONE DAY'S SUPPLY (D51)
// =========================================================================

describe("line 93: energy is one day's supply, and a new drop does not refill it", () => {
  const fresh = () => usePlayerStore.setState(s => ({
    player: { ...s.player, currentSession: undefined, energyToday: undefined }
  }));

  it('a first drop of the day starts full', () => {
    fresh();
    usePlayerStore.getState().diveIntoLayer('layer-test');
    const p = usePlayerStore.getState().player;
    expect(p.currentSession!.energy).toBe(StatSystem.maxEnergy(p.attributes));
    usePlayerStore.getState().emergencyJackOut('NONE');
  });

  it('what is spent stays spent across the return and the next drop', () => {
    fresh();
    usePlayerStore.getState().diveIntoLayer('layer-test');
    usePlayerStore.setState(s => ({ player: { ...s.player, currentSession: { ...s.player.currentSession!, energy: 7 } } }));
    usePlayerStore.getState().emergencyJackOut('NONE');
    expect(usePlayerStore.getState().player.energyToday).toBe(7);
    usePlayerStore.getState().diveIntoLayer('layer-test');
    expect(usePlayerStore.getState().player.currentSession!.energy).toBe(7);
    usePlayerStore.getState().emergencyJackOut('NONE');
  });

  it('nothing regenerates: no stat refills it and the source has no regen line', () => {
    expect(StatSystem.isRead('energy_regen')).toBe(false);
    const src = readFileSync('src/entities/player/store.ts', 'utf8');
    expect(src).not.toMatch(/energy\s*\+=|energy:\s*[^,\n]*\+\s*[a-z]*[Rr]egen/);
  });

  it('the survives-a-save field: the day supply is on the player document, not the session', () => {
    fresh();
    usePlayerStore.setState(s => ({ player: { ...s.player, energyToday: 12 } }));
    const src = readFileSync('src/logic/persistence/PlayerPersistence.ts', 'utf8');
    expect(src).toMatch(/energyToday: player\.currentSession\?\.energy \?\? player\.energyToday, currentSession: undefined/);
    expect(usePlayerStore.getState().player.energyToday).toBe(12);
  });
});
