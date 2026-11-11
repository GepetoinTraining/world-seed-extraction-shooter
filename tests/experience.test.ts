/**
 * THE ATTRIBUTES PASS (D52, D83, D84): bars registered before the build.
 * Test lines:
 *   94  every attribute changes how a character plays, so two characters of
 *       different spreads play differently
 *   128 (the level half) gaining a skill takes about 2.5 times as long as it did,
 *       levels and rank are separate, levels reset at each rank, and stats stay
 * And Pedro on seeing the first build: energy is an initial value, a fifth of
 * endurance and items, levels give none, and magic, potions and very rare plants
 * refill it. A rarer skill levels slowly, with a large impact per level.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

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

import { IAttributes, IEquipmentState, IItem, IPlayer, ISkillProgress, ItemType, Rarity, UniversalRank } from '../shared/types';
import {
  FREE_POINTS_PER_LEVEL, LEVEL_GROWTH, LEVEL_KILLS, POINTS_PER_LEVEL, ProgressionSystem, RANK_ORDER, RANK_XP_THRESHOLDS,
  SKILL_IMPACT_PER_LEVEL, SKILL_RANK_IMPACT_GROWTH, SKILL_RANK_TIME_GROWTH, SKILL_TIME_FACTOR, THREAT_RADIUS_TILES,
  XP_CONSTANTS, XP_SHARE_CHEST, XP_SHARE_HARVEST, XP_SHARE_THREAT
} from '../shared/entities/player/systems/ProgressionSystem';
import { DEFAULT_ATTRIBUTES } from '../src/entities/player/types';
import { ARCHETYPES, usePlayerStore, playerPort } from '../src/entities/player/store';
import { LoadoutSystem } from '../shared/entities/player/systems/LoadoutSystem';
import { useIdentityStore } from '../src/entities/identity/store';
import { applyKillRewards } from '../src/entities/combat/killRewards';
import { ICombatEvent } from '../src/entities/combat/CombatSystems';
import { CombatMath } from '../src/entities/combat/CombatMath';
import { ATTRIBUTE_READERS, BASE_ENERGY, ENERGY_PER_ENDURANCE, StatSystem } from '../shared/logic/systems/StatSystem';
import { RestSystem } from '../src/logic/systems/RestSystem';
import { StudySystem } from '../src/logic/systems/StudySystem';
import { WeaveSystem } from '../src/logic/systems/WeaveSystem';
import { MASTERY_RUNGS, RUNG_XP, WebSystem } from '../shared/logic/systems/WebSystem';
import { repairCost } from '../src/entities/hub/dialogue';
import { Rng } from '../shared/logic/rng/DeterministicRNG';
import { EffectSystem, IEffectAbility } from '../shared/logic/systems/EffectSystem';
import { NpcSheet } from '../shared/logic/systems/NpcSheet';
import { CIRCLES_FOR_A_GIFT, CircleSystem, IGiftWords } from '../src/logic/systems/CircleSystem';
import { PASSIVE_STATS } from '../shared/logic/theme/ThemeTypes';
import { STAT_SCALE, TONIC_SHARE } from '../shared/logic/theme/ThemeFormula';
import { ContentRegistry } from '../shared/logic/theme/ContentRegistry';
import { compileTheme, sealTheme } from '../shared/logic/theme/ThemeCompiler';
import { BIOMES, IThemeBody } from '../shared/logic/theme/ThemeTypes';
import { FIRST_THEME } from '../shared/entities/generation/packs/firstTheme';
import { BIOME_RESOURCES, RESOURCE_DEFINITIONS } from '../shared/entities/item/data/resourceDefinitions';
import { useWorldStore } from '../src/entities/world/store';
import { ChestStore, ChestSystem, IChestRecord, emptyChestRecord } from '../shared/entities/world/ChestSystem';
import { fieldMinimap } from '../src/render/atoms/minimap';
import { EntityType, IWorldEntity } from '../shared/entities/world/types';
import { RARE_FIND_CHANCE, WorldGenerator } from '../shared/entities/world/WorldGenerator';

const CERT = (uid: string, name = 'TESTER') => ({
  metadata: { uid, displayName: name, createdAt: 0 },
  publicKey: {} as any
}) as any;

const store = () => usePlayerStore.getState();
const player = () => store().player;

/** A person at the floor, with some attributes raised. */
const spread = (raised: Partial<IAttributes> = {}): IAttributes => ({ ...DEFAULT_ATTRIBUTES, ...raised });
const raised = (attr: keyof IAttributes, by = 9): IAttributes => spread({ [attr]: 1 + by });

const ALL_ATTRIBUTES = Object.keys(DEFAULT_ATTRIBUTES) as (keyof IAttributes)[];

const blade = { id: 'blade', stats: { attack_speed: 1 }, itemPower: 100, tags: ['melee'] } as unknown as IItem;
const rifle = { id: 'rifle', stats: { attack_speed: 2 }, itemPower: 100, tags: ['ranged'] } as unknown as IItem;

beforeEach(() => {
  db.clear();
  localStorage.clear();
  useIdentityStore.setState({ certificate: CERT('uid_experience') });
  store().initializeSession(CERT('uid_experience'), 'NOMAD');
});

// =============================================================================
// LINE 128: levels and rank are two things (D83)
// =============================================================================

describe('line 128: levels come from experience, rank does not', () => {
  it('a new character stands at rank F, level 1, with nothing banked', () => {
    expect(ProgressionSystem.rankOf(player())).toBe(UniversalRank.F);
    expect(ProgressionSystem.levelOf(player())).toBe(1);
  });

  it('no amount of experience moves the rank', () => {
    store().applyKillXp(5_000_000);
    expect(ProgressionSystem.rankOf(player())).toBe(UniversalRank.F);
    expect(player().rank).toBe(UniversalRank.F);
    expect(ProgressionSystem.levelOf(player())).toBeGreaterThan(1);
  });

  it('a level costs more than the one before it, with no top', () => {
    for (let level = 1; level < 200; level++) {
      expect(ProgressionSystem.levelCost(UniversalRank.F, level + 1)).toBeGreaterThan(ProgressionSystem.levelCost(UniversalRank.F, level));
    }
    const far = ProgressionSystem.levelFromXp(UniversalRank.F, 1e12);
    expect(far.level).toBeGreaterThan(100);
  });

  it('a level at a higher rank costs more, so a rank never makes levels free', () => {
    for (let i = 1; i < RANK_ORDER.length; i++) {
      expect(ProgressionSystem.levelCost(RANK_ORDER[i], 1)).toBeGreaterThan(ProgressionSystem.levelCost(RANK_ORDER[i - 1], 1));
    }
    // A first level asks LEVEL_KILLS common foes of the character's own rank, whatever the rank is
    for (const rank of RANK_ORDER) {
      const kill = ProgressionSystem.calculateKillXp(rank, Rarity.COMMON, 1);
      expect(ProgressionSystem.levelCost(rank, 1)).toBe(kill * LEVEL_KILLS);
    }
    expect(LEVEL_GROWTH).toBeGreaterThan(1);
  });

  it('a level grants points, and a point spent is real', () => {
    const cost = ProgressionSystem.levelCost(UniversalRank.F, 1);
    const below = store().applyKillXp(cost - 1);
    expect(below.leveledUp).toBe(false);
    expect(below.pointsGranted).toBe(0);
    const at = store().applyKillXp(1);
    expect(at.leveledUp).toBe(true);
    expect(at.from).toBe(1);
    expect(at.to).toBe(2);
    expect(at.pointsGranted).toBe(POINTS_PER_LEVEL);
    // 2026-11-11, BALANCE_RUN.md 2.13 (Pedro: "4 points per level, one free point and one for each of the buckets"): the level's four are one free and one for each group
    expect(ProgressionSystem.unspent(player()).total).toBe(POINTS_PER_LEVEL);
    expect(player().attributePoints).toBe(FREE_POINTS_PER_LEVEL);
    const before = player().baseAttributes.agility;
    expect(store().spendAttributePoint('agility')).toBe(true);
    expect(player().attributes.agility).toBe(before + 1);
  });

  it('a jump across several levels grants points for each', () => {
    const three = [1, 2, 3].reduce((sum, level) => sum + ProgressionSystem.levelCost(UniversalRank.F, level), 0);
    const res = store().applyKillXp(three);
    expect(res.to).toBe(4);
    expect(res.pointsGranted).toBe(3 * POINTS_PER_LEVEL);
  });

  it('what a fight pays reports a level, never a rank', () => {
    const cost = ProgressionSystem.levelCost(UniversalRank.F, 1);
    const events: ICombatEvent[] = [{ type: 'KILL', entityId: 'm1', xpReward: { amount: cost, sourceRank: UniversalRank.F, sourceRarity: Rarity.COMMON } }];
    const rewards = applyKillRewards(events, playerPort);
    expect(rewards.xpGained).toBe(cost);
    expect(rewards.levelUp).toEqual({ from: 1, to: 2, points: POINTS_PER_LEVEL });
    expect(rewards).not.toHaveProperty('rankUp');
  });
});

describe('line 128: the rank is granted, levels reset, and stats stay (D83)', () => {
  it('the guild is the one caller of the seam: nothing else in the game grants a rank (B4)', () => {
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.tsx?$/.test(name) && /grantRank\(/.test(readFileSync(path, 'utf8'))) hits.push(path.replace(/\\/g, '/'));
      }
    };
    walk('src');
    walk('shared');
    // The player's port declares the call (playerView.ts) and forwards it; the guild in the hub store is still its one caller
    expect(hits.sort()).toEqual(['shared/entities/player/systems/ProgressionSystem.ts', 'src/entities/hub/store.ts', 'src/entities/player/playerView.ts', 'src/entities/player/store.ts']);
  });

  it('a grant moves the rank up and resets the level', () => {
    store().applyKillXp(ProgressionSystem.levelCost(UniversalRank.F, 1) + ProgressionSystem.levelCost(UniversalRank.F, 2));
    expect(ProgressionSystem.levelOf(player())).toBe(3);
    const res = store().grantRank();
    expect(res).toEqual({ granted: true, from: UniversalRank.F, to: UniversalRank.E });
    expect(ProgressionSystem.rankOf(player())).toBe(UniversalRank.E);
    expect(ProgressionSystem.levelOf(player())).toBe(1);
  });

  it('a grant takes nothing: attributes, points, health and energy all stay', () => {
    store().applyKillXp(ProgressionSystem.levelCost(UniversalRank.F, 1) + ProgressionSystem.levelCost(UniversalRank.F, 2));
    store().spendAttributePoint('endurance');
    const before = player();
    const energy = StatSystem.maxEnergyOf(before);
    const health = StatSystem.maxHealth(before.attributes, before.equipment);
    store().grantRank();
    const after = player();
    expect(after.baseAttributes).toEqual(before.baseAttributes);
    expect(after.attributes).toEqual(before.attributes);
    expect(after.attributePoints).toBe(before.attributePoints);
    expect(after.rankXp).toBe(before.rankXp);
    expect(ProgressionSystem.levelsEarned(after)).toBe(ProgressionSystem.levelsEarned(before));
    expect(StatSystem.maxEnergyOf(after)).toBe(energy);
    expect(StatSystem.maxHealth(after.attributes, after.equipment)).toBe(health);
  });

  it('a grant can jump, never falls, and stops at the top', () => {
    expect(store().grantRank(UniversalRank.C).to).toBe(UniversalRank.C);
    expect(store().grantRank(UniversalRank.D)).toEqual({ granted: false, from: UniversalRank.C, to: UniversalRank.C });
    expect(store().grantRank(UniversalRank.C).granted).toBe(false);
    store().grantRank(UniversalRank.SSS);
    expect(store().grantRank().granted).toBe(false);
    expect(ProgressionSystem.rankOf(player())).toBe(UniversalRank.SSS);
  });

  it('levels climb again after a grant, on the new rank\'s own costs', () => {
    store().grantRank();
    const cost = ProgressionSystem.levelCost(UniversalRank.E, 1);
    expect(store().applyKillXp(cost - 1).leveledUp).toBe(false);
    expect(store().applyKillXp(1).to).toBe(2);
    expect(ProgressionSystem.rankOf(player())).toBe(UniversalRank.E);
  });
});

describe('line 128: an existing character keeps what its old experience earned, once', () => {
  const old = (rankXp: number, more: Partial<IPlayer> = {}): IPlayer => ({
    ...player(), rank: undefined, levelXp: undefined, levelsBanked: undefined, rankXp, attributePoints: 2, ...more
  });

  it('the rank its experience earned becomes a stored rank', () => {
    for (const rank of RANK_ORDER) {
      expect(ProgressionSystem.migrate(old(RANK_XP_THRESHOLDS[rank])).rank).toBe(rank);
    }
  });

  it('migrating twice changes nothing, and new experience cannot reach the old ladder', () => {
    const once = ProgressionSystem.migrate(old(1_500));
    expect(once.rank).toBe(UniversalRank.E);
    expect(ProgressionSystem.migrate(once)).toBe(once);
    const fed = ProgressionSystem.gainXp(once, 5_000_000).player;
    expect(fed.rank).toBe(UniversalRank.E);
  });

  it('experience past the old rank\'s floor becomes levels, and nothing already earned is taken', () => {
    const spare = ProgressionSystem.levelCost(UniversalRank.E, 1);
    const moved = ProgressionSystem.migrate(old(RANK_XP_THRESHOLDS[UniversalRank.E] + spare));
    expect(ProgressionSystem.levelOf(moved)).toBe(2);
    // 2026-11-11, BALANCE_RUN.md 2.13 (Pedro: "4 points per level, one free point and one for each of the buckets"): a save from before keeps the one free point a level it was paid, and nothing is migrated
    expect(moved.attributePoints).toBe(2 + FREE_POINTS_PER_LEVEL);
    expect(moved.rankXp).toBe(RANK_XP_THRESHOLDS[UniversalRank.E] + spare);
  });

  it('an unmigrated character reading its rank gets what it earned, and feeding it fixes that rank first', () => {
    const raw = old(1_500);
    expect(ProgressionSystem.rankOf(raw)).toBe(UniversalRank.E);
    const fed = ProgressionSystem.gainXp(raw, 5_000_000).player;
    expect(fed.rank).toBe(UniversalRank.E);
  });

  it('a held skill keeps its level and rung, and half-done work keeps its fill', () => {
    const skill = { id: 'skill_x', name: 'x', level: 2, currentXp: 40, tags: [], rank: 0 } as any;
    const low = { id: 'skill_y', name: 'y', level: 1, currentXp: 70, tags: [], rank: 0 } as any;
    const bank = { ...player().bank, universalSkills: { skill_x: skill, skill_y: low } };
    const progress: ISkillProgress = { id: 'skill_z', tags: [], rank: 0, attempts: 3, weight: 8 };
    const moved = ProgressionSystem.migrate(old(0, { bank, skillProgress: { skill_z: progress } }));
    expect(moved.bank.universalSkills.skill_x.level).toBe(2);
    expect(moved.bank.universalSkills.skill_x.currentXp).toBe(40 * SKILL_TIME_FACTOR);
    // 70 stood past the old first rung of 60, and it stands past the new one
    expect(WebSystem.masteryOf(moved.bank.universalSkills.skill_y).rung).toBe(1);
    expect(moved.skillProgress!.skill_z.weight).toBe(8 * SKILL_TIME_FACTOR);
    expect(WebSystem.emergenceFill(moved.skillProgress!.skill_z)).toBeCloseTo(8 / 10);
  });

  it('the ranks it walked count as levels climbed, as a new character\'s would', () => {
    const start = ProgressionSystem.migrate(old(0));
    const veteran = ProgressionSystem.migrate(old(RANK_XP_THRESHOLDS[UniversalRank.C]));
    expect(ProgressionSystem.levelsEarned(start)).toBe(0);
    expect(ProgressionSystem.levelsEarned(veteran)).toBeGreaterThan(0);
    expect(CircleSystem.free(veteran)).toBeGreaterThan(CircleSystem.free(start));
  });

  it('a rare skill keeps its level and rung too, against its own higher costs', () => {
    const rare = { id: 'skill_r', name: 'r', level: 3, currentXp: 40, tags: [], rank: 7 } as any;
    const bank = { ...player().bank, universalSkills: { skill_r: rare } };
    const moved = ProgressionSystem.migrate(old(0, { bank })).bank.universalSkills.skill_r;
    expect(moved.level).toBe(3);
    // Level 3 stood at the old top rung on the old table, whatever the rank
    expect(WebSystem.masteryOf(moved).rung).toBe(3);
  });

  it('a character born after this is never scaled', () => {
    const skill = { id: 'skill_x', name: 'x', level: 1, currentXp: 40, tags: [], rank: 0 } as any;
    const born = { ...player(), bank: { ...player().bank, universalSkills: { skill_x: skill } } };
    expect(born.rank).toBe(UniversalRank.F);
    expect(ProgressionSystem.migrate(born).bank.universalSkills.skill_x.currentXp).toBe(40);
  });

  it('boot runs the migration', () => {
    expect(readFileSync('src/logic/initialization/StartupSequence.ts', 'utf8')).toMatch(/ProgressionSystem\.migrate\(/);
  });
});

// =============================================================================
// LINE 128: skills take about 2.5 times as long (D84)
// =============================================================================

describe('line 128: gaining a skill takes about 2.5 times as long', () => {
  // What the game asked before D84, written out so the ratio is measured against something fixed
  const OLD_RUNGS = [0, 60, 180, 420];
  const OLD_DC = (rank: number) => 10 + rank * 10;
  const oldEmerges = (progress: ISkillProgress, who: string) => {
    const dc = OLD_DC(progress.rank);
    if (progress.weight < dc) return false;
    return Rng.fromKey(`${who}:${progress.id}:emerge:${progress.attempts}`).next() * 100 < Math.min(95, 20 + (progress.weight - dc));
  };
  /** How much work a person does before a skill settles, resting after every attempt. */
  const workToSettle = (who: string, id: string, rank: number, emerges: (p: ISkillProgress, who: string) => boolean): number => {
    let progress: ISkillProgress = { id, tags: [], rank, attempts: 0, weight: 0 };
    while (!emerges(progress, who)) progress = { ...progress, attempts: progress.attempts + 1, weight: progress.weight + 6 };
    return progress.attempts;
  };

  it('the factor is named, and it is 2.5', () => {
    expect(SKILL_TIME_FACTOR).toBe(2.5);
  });

  it('every rung asks 2.5 times the work it did', () => {
    expect(RUNG_XP.length).toBe(MASTERY_RUNGS.length);
    RUNG_XP.forEach((need, i) => expect(need).toBe(OLD_RUNGS[i] * SKILL_TIME_FACTOR));
  });

  it('every level of a skill asks 2.5 times the work it did', () => {
    expect(XP_CONSTANTS.BASE_LEVEL_XP).toBe(100 * SKILL_TIME_FACTOR);
    for (const level of [1, 2, 5, 12]) {
      expect(ProgressionSystem.getXpToNextLevel(level)).toBe(Math.floor(100 * SKILL_TIME_FACTOR * Math.pow(level, XP_CONSTANTS.EXPONENT)));
    }
  });

  it('an unheld skill takes about 2.5 times the attempts to settle, over many people', () => {
    for (const rank of [0, 1, 2, 4]) {
      expect(WebSystem.emergenceDC(rank)).toBe(OLD_DC(rank) * SKILL_TIME_FACTOR);
      let before = 0, after = 0;
      for (let i = 0; i < 400; i++) {
        before += workToSettle(`who_${i}`, `skill_${rank}`, rank, oldEmerges);
        after += workToSettle(`who_${i}`, `skill_${rank}`, rank, (p, who) => WebSystem.emerges(p, who));
      }
      const ratio = after / before;
      expect(ratio).toBeGreaterThan(2.1);
      expect(ratio).toBeLessThan(2.9);
    }
  });

  it('what intelligence buys is speed on this slower road: game knowledge makes it faster, never instant', () => {
    expect(StatSystem.learnRate(spread())).toBe(1);
    expect(StatSystem.learnRate(raised('intelligence'))).toBeGreaterThan(1);
    expect(StatSystem.learnRate(raised('intelligence'))).toBeLessThan(SKILL_TIME_FACTOR);
  });

  it('held work is paid through the learning rate', () => {
    const pair = WebSystem.mint(['axe'], ['wood']);
    usePlayerStore.setState(s => ({ player: { ...s.player, bank: { ...s.player.bank, universalSkills: { [pair.id]: { ...WebSystem.freshSkill(pair.id, pair.tags, 0), currentXp: 0 } } } } }));
    store().gainSkillXp(pair.id, 100, pair.tags);
    const plain = player().bank.universalSkills[pair.id].currentXp;
    expect(plain).toBe(100);
    usePlayerStore.setState(s => ({ player: { ...s.player, attributes: raised('intelligence'), bank: { ...s.player.bank, universalSkills: { [pair.id]: { ...WebSystem.freshSkill(pair.id, pair.tags, 0), currentXp: 0 } } } } }));
    store().gainSkillXp(pair.id, 100, pair.tags);
    expect(player().bank.universalSkills[pair.id].currentXp).toBeGreaterThan(plain);
  });
});

// =============================================================================
// Energy: tied to levels and a stat, and rest reads it (the clock leg, D79)
// =============================================================================

describe('energy: an initial value, a fifth of endurance, and items', () => {
  const worn = (stats: Record<string, number>): IEquipmentState =>
    ({ slots: { CHEST: 'piece' }, frames: {}, items: [{ id: 'piece', stats }] }) as unknown as IEquipmentState;

  it('it is the initial value and a fifth of endurance', () => {
    expect(ENERGY_PER_ENDURANCE).toBe(0.2);
    expect(StatSystem.maxEnergy(spread())).toBeCloseTo(BASE_ENERGY + 0.2);
    expect(StatSystem.maxEnergy(spread({ endurance: 30 }))).toBeCloseTo(BASE_ENERGY + 6);
  });

  it('what is worn adds to it', () => {
    expect(StatSystem.maxEnergy(spread(), worn({ max_energy: 100 }))).toBeCloseTo(BASE_ENERGY + 0.2 + 100);
  });

  it('levels give none of it, at any rank', () => {
    const before = StatSystem.maxEnergyOf(player());
    store().applyKillXp(5_000_000);
    expect(ProgressionSystem.levelOf(player())).toBeGreaterThan(10);
    expect(StatSystem.maxEnergyOf(player())).toBe(before);
    store().grantRank();
    expect(StatSystem.maxEnergyOf(player())).toBe(before);
  });

  it('a long day is still a long rest: 500 spent from what is worn is about 8 hours', () => {
    const long = { ...player(), equipment: worn({ max_energy: 600 }) };
    const full = StatSystem.maxEnergyOf(long);
    expect(full).toBeGreaterThan(500);
    const hours = RestSystem.restMs({ ...long, energyToday: full - 500 }) / 3_600_000;
    expect(hours).toBeCloseTo(8);
  });
});

describe('energy: magic, potions and very rare plants refill it', () => {
  const drop = () => {
    usePlayerStore.setState(s => ({ player: { ...s.player, currentSession: { sessionId: 's', layerId: 'l', inventory: [], inventoryLayout: {}, health: 50, maxHealth: 100, energy: 10, position: { x: 0, y: 0, z: 0 }, statusEffects: [] } as any } }));
  };
  const tonic = (id: string, stats: Record<string, number>): IItem =>
    ({ id, name: 'Day Moss', type: ItemType.CONSUMABLE, stats, tags: ['consumable'], isIdentified: true, weight: 0.2, dimensions: { width: 1, height: 1 }, affixes: [] }) as unknown as IItem;
  const clone = (b: IThemeBody): IThemeBody => JSON.parse(JSON.stringify(b));
  /** The first theme with a plant that refills energy on every kind of ground. */
  const withPlant = (over: Record<string, unknown> = {}): IThemeBody => {
    const b = clone(FIRST_THEME);
    const habitat = [...new Set(b.materials.flatMap(m => m.habitat))];
    b.materials.push({ ...b.materials[0], key: 'day_moss', name: 'Day Moss', habitat, verb: 'hands', worth: 'rare', onShelf: false, restores: 'energy', ...over } as never);
    return b;
  };

  it('the door lifts what is left, in the field and at home, and stops at the top', () => {
    drop();
    const inField = RestSystem.refillEnergy(player(), 20);
    expect(inField.currentSession!.energy).toBe(30);
    expect(RestSystem.refillEnergy(player(), 1_000_000).currentSession!.energy).toBe(StatSystem.maxEnergyOf(player()));
    const home = { ...player(), currentSession: undefined, energyToday: 5 };
    expect(RestSystem.refillEnergy(home, 20).energyToday).toBe(25);
  });

  it('it is not a rest: the day does not turn', () => {
    drop();
    const before = player().dayCount;
    expect(RestSystem.refillEnergy(player(), 20).dayCount).toBe(before);
  });

  it('what somebody already holds over the top is not taken', () => {
    const over = { ...player(), currentSession: undefined, energyToday: 500 };
    expect(RestSystem.refillEnergy(over, 20).energyToday).toBe(500);
  });

  it('a potion refills it from the pack, and the potion is gone', () => {
    drop();
    usePlayerStore.setState(s => ({ player: { ...s.player, currentSession: { ...s.player.currentSession!, inventory: [tonic('moss', { energy_restore: 25 })] } } }));
    store().consumeItem('moss');
    const s = player().currentSession!;
    // Changed on purpose 2026-11-11. Pedro: "we need energy tonics that are limited usage per rest, and give
    // debuffs as side effects for using." A potion is a tonic: three tenths of the drinker's day, not its old 25.
    expect(s.energy).toBe(10 + Math.round(StatSystem.maxEnergyOf(player()) * TONIC_SHARE));
    expect(s.health).toBe(50);
    expect(s.inventory).toEqual([]);
  });

  it('energy_restore has a reader, so a batch may roll it', () => {
    expect(StatSystem.isRead('energy_restore')).toBe(true);
  });

  it('a working with the rest effect lands on the caster and the field reads it as a refill', () => {
    const ability = { id: 'ab', effect: 'rest', delivery: 'self', cost: 'low', elements: ['debt'] } as unknown as IEffectAbility;
    const receipt = EffectSystem.resolve(ability, { rank: UniversalRank.F }, 'k');
    expect(EffectSystem.landsOnCaster(receipt.effect, receipt.delivery)).toBe(true);
    expect(receipt.magnitude).toBeGreaterThan(0);
    expect(readFileSync('src/components/WorldCanvas.tsx', 'utf8')).toMatch(/receipt\.effect === 'rest' \? RestSystem\.refillEnergy\(/);
  });

  it('the law keeps a refill potion off every shelf', () => {
    const b = clone(FIRST_THEME);
    b.consumables.push({ ...b.consumables[0], key: 'long_draught', kind: 'energy', casts: '', onShelf: true });
    expect(ContentRegistry.judge(b).ok).toBe(false);
    b.consumables[b.consumables.length - 1].onShelf = false;
    expect(ContentRegistry.judge(b).ok).toBe(true);
  });

  it('the law asks a refill plant to be gathered by hand, rare, and on no shelf', () => {
    expect(ContentRegistry.judge(withPlant()).ok).toBe(true);
    expect(ContentRegistry.judge(withPlant({ verb: 'chop' })).ok).toBe(false);
    expect(ContentRegistry.judge(withPlant({ worth: 'common' })).ok).toBe(false);
    expect(ContentRegistry.judge(withPlant({ onShelf: true })).ok).toBe(false);
    expect(ContentRegistry.judge(withPlant({ restores: 'gold' })).ok).toBe(false);
  });

  it('a refill plant is something to eat, and it stands outside the biome table', () => {
    const compiled = compileTheme(sealTheme(withPlant(), 'test', 0));
    const def = Object.values(compiled.resources).find(r => r.name === 'Day Moss')!;
    expect(def.type).toBe(ItemType.CONSUMABLE);
    // Changed on purpose 2026-11-11 (Pedro: "energy tonics that are limited usage per rest"): a share of the day, not an amount by rank
    expect(def.stats!.energy_share).toBe(TONIC_SHARE);
    expect(def.rareFind).toBe(true);
    expect(compiled.shelf.materials).not.toContain(def.id);
    const pack = sealTheme(withPlant(), 'test', 0);
    expect(ContentRegistry.install(pack)).toEqual({ ok: true });
    expect(Object.values(BIOME_RESOURCES).flat()).not.toContain(def.id);
  });

  it('it is very, very rare: about one quadrant in two thousand', () => {
    expect(RARE_FIND_CHANCE).toBeLessThanOrEqual(1 / 2000);
    let found = 0;
    const n = 200_000;
    for (let i = 0; i < n; i++) if (WorldGenerator.rareFindAt('rarity', i % 500, Math.floor(i / 500))) found++;
    expect(found / n).toBeGreaterThan(RARE_FIND_CHANCE / 2);
    expect(found / n).toBeLessThan(RARE_FIND_CHANCE * 2);
  });

  it('it grows only where the roll says, and a pack without one builds the same chunk as before', () => {
    const SEED = 'rarity';
    let cell: { cx: number; cy: number } | null = null;
    for (let cx = 0; cx < 400 && !cell; cx++) {
      for (let cy = 0; cy < 400 && !cell; cy++) {
        for (let q = 0; q < 16; q++) {
          if (WorldGenerator.rareFindAt(SEED, cx * 4 + (q % 4), cy * 4 + Math.floor(q / 4))) { cell = { cx, cy }; break; }
        }
      }
    }
    expect(cell).not.toBeNull();
    const plant = { id: 'res_day_moss', name: 'Day Moss', rareFind: true, habitat: [...BIOMES], uses: 1 };
    const without = { mobDefinitions: [], resourceDefinitions: [] } as any;
    const carrying = { mobDefinitions: [], resourceDefinitions: [plant] } as any;
    const a = WorldGenerator.buildChunk(SEED, [], cell!.cx, cell!.cy, without);
    const b = WorldGenerator.buildChunk(SEED, [], cell!.cx, cell!.cy, carrying);
    expect(a.entities.some(e => e.definitionId === plant.id)).toBe(false);
    expect(b.entities.filter(e => e.definitionId === plant.id).length).toBeGreaterThan(0);
    expect(b.entities.filter(e => e.definitionId !== plant.id)).toEqual(a.entities);
  });
});

describe('a rarer skill levels slowly, and each level does more', () => {
  const F = 0;
  const SS = RANK_ORDER.indexOf(UniversalRank.SS);
  const skill = (rank: number, level = 1, currentXp = 0) =>
    ({ id: 'skill_blade+melee', name: 'x', level, currentXp, tags: ['blade', 'melee'], rank, scalingAttribute: 'dexterity' }) as any;

  it('a level at rank SS asks far more than one at rank F, in step with the rank', () => {
    const ratio = ProgressionSystem.getXpToNextLevel(3, SS) / ProgressionSystem.getXpToNextLevel(3, F);
    expect(ratio).toBeCloseTo(Math.pow(SKILL_RANK_TIME_GROWTH, SS), 1);
    expect(ratio).toBeGreaterThan(10);
    for (let rank = 1; rank < RANK_ORDER.length; rank++) {
      expect(ProgressionSystem.getXpToNextLevel(1, rank)).toBeGreaterThan(ProgressionSystem.getXpToNextLevel(1, rank - 1));
    }
  });

  it('rank F still reads the 2.5 times road and nothing more', () => {
    expect(ProgressionSystem.getXpToNextLevel(4, F)).toBe(ProgressionSystem.getXpToNextLevel(4));
    expect(WebSystem.rungXp(2, F)).toBe(RUNG_XP[2]);
  });

  it('rungs ask more of a rarer skill in the same step, so a rung means the same climb', () => {
    expect(WebSystem.rungXp(1, SS)).toBeCloseTo(RUNG_XP[1] * Math.pow(SKILL_RANK_TIME_GROWTH, SS));
    expect(WebSystem.masteryOf(skill(SS, 1, 0)).rung).toBe(0);
    expect(WebSystem.masteryOf(WebSystem.withCumulativeXp(skill(SS), WebSystem.rungXp(1, SS))).rung).toBe(1);
    expect(WebSystem.masteryOf(WebSystem.withCumulativeXp(skill(SS), WebSystem.rungXp(1, SS) - 1)).rung).toBe(0);
  });

  it('the same work takes a rare skill less far', () => {
    const work = 5_000;
    expect(WebSystem.withCumulativeXp(skill(SS), work).level).toBeLessThan(WebSystem.withCumulativeXp(skill(F), work).level);
  });

  it('deeper work does not make a common skill rare: its pace and its weight stay what it settled at', () => {
    const pair = WebSystem.mint(['axe'], ['wood']);
    usePlayerStore.setState(s => ({ player: { ...s.player, bank: { ...s.player.bank, universalSkills: { [pair.id]: { ...WebSystem.freshSkill(pair.id, pair.tags, F), level: 5 } } } } }));
    const held = () => player().bank.universalSkills[pair.id];
    const power = WebSystem.skillPower(held());
    store().workOn(pair, SS, 5);
    expect(held().rank).toBe(SS);
    expect(held().bornRank).toBe(F);
    expect(WebSystem.skillPower(held())).toBe(power);
    expect(ProgressionSystem.skillRankOf(held())).toBe(UniversalRank.F);
    expect(WebSystem.freshSkill(pair.id, pair.tags, SS).bornRank).toBe(SS);
  });

  it('a skill from before this takes the rank it has as its rarity, once, and keeps it after', () => {
    const old = { id: 'skill_o', name: 'o', level: 2, currentXp: 10, tags: [], rank: 3 } as any;
    const bank = { ...player().bank, universalSkills: { skill_o: old } };
    const moved = ProgressionSystem.migrate({ ...player(), rank: undefined, levelXp: undefined, rankXp: 0, bank });
    expect(moved.bank.universalSkills.skill_o.bornRank).toBe(3);
  });

  it('a first level does nothing yet, and each level after does more the rarer the skill', () => {
    expect(WebSystem.skillPower(skill(SS, 1))).toBe(0);
    expect(WebSystem.skillPower(skill(F, 2))).toBeCloseTo(SKILL_IMPACT_PER_LEVEL);
    expect(WebSystem.skillPower(skill(SS, 2))).toBeCloseTo(SKILL_IMPACT_PER_LEVEL * Math.pow(SKILL_RANK_IMPACT_GROWTH, SS));
    expect(WebSystem.skillPower(skill(SS, 2)) / WebSystem.skillPower(skill(F, 2))).toBeGreaterThan(10);
  });

  it('for the same work, the rare skill ends up stronger', () => {
    const work = 20_000;
    const rare = WebSystem.withCumulativeXp(skill(SS), work);
    const common = WebSystem.withCumulativeXp(skill(F), work);
    expect(rare.level).toBeGreaterThan(1);
    expect(WebSystem.skillPower(rare)).toBeGreaterThan(WebSystem.skillPower(common));
  });

  it('a level makes the work cheaper and quicker', () => {
    const pair = WebSystem.mint(['axe'], ['wood']);
    const holding = (s: any) => ({ ...player(), bank: { ...player().bank, universalSkills: { [pair.id]: { ...s, id: pair.id, tags: pair.tags } } } });
    const fresh = holding(skill(SS, 1));
    const risen = holding(skill(SS, 3));
    expect(WebSystem.energyFor(risen, pair, 20).cost).toBeLessThan(WebSystem.energyFor(fresh, pair, 20).cost);
    expect(WebSystem.clockFactor(risen, pair)).toBeLessThan(WebSystem.clockFactor(fresh, pair));
    expect(WebSystem.energyFor(holding(skill(SS, 500)), pair, 20).cost).toBeGreaterThanOrEqual(1);
    expect(WebSystem.clockFactor(holding(skill(SS, 500)), pair)).toBeGreaterThan(0);
  });

  it('a skill the weapon answers to lands harder, by its rank and level', () => {
    const sword = { id: 'sword', stats: { attack_speed: 1 }, itemPower: 100, tags: ['blade', 'melee', 'one_hand'] } as unknown as IItem;
    const holding = (s: any) => ({ ...player(), bank: { ...player().bank, universalSkills: { [s.id]: s } } });
    expect(WebSystem.handPower(holding(skill(F, 1)), sword)).toBe(0);
    const common = WebSystem.handPower(holding(skill(F, 3)), sword);
    const rare = WebSystem.handPower(holding(skill(SS, 3)), sword);
    expect(rare).toBeGreaterThan(common);
    expect(common).toBeGreaterThan(0);
    expect(WebSystem.handPower(holding(skill(SS, 3)), rifle)).toBe(0);
    expect(WebSystem.handPower(holding(skill(SS, 3)), undefined)).toBe(0);
    const key = 'swing';
    expect(CombatMath.outgoing(sword, undefined, key, undefined, rare).damage).toBeGreaterThan(CombatMath.outgoing(sword, undefined, key).damage);
    expect(readFileSync('src/components/WorldCanvas.tsx', 'utf8')).toMatch(/WebSystem\.handPower\(st\.player, weapon\)/);
  });

  it('held work climbs by the skill\'s own rank', () => {
    const pair = WebSystem.mint(['axe'], ['wood']);
    const give = (rank: number) => usePlayerStore.setState(s => ({ player: { ...s.player, bank: { ...s.player.bank, universalSkills: { [pair.id]: { ...WebSystem.freshSkill(pair.id, pair.tags, rank), currentXp: 0 } } } } }));
    const need = ProgressionSystem.getXpToNextLevel(1, F);
    give(F);
    store().gainSkillXp(pair.id, need, pair.tags);
    expect(player().bank.universalSkills[pair.id].level).toBe(2);
    give(SS);
    store().gainSkillXp(pair.id, need, pair.tags);
    expect(player().bank.universalSkills[pair.id].level).toBe(1);
  });

  it('a person in a world keeps the rung their sheet rolled, whatever the rank', () => {
    expect(readFileSync('shared/logic/systems/NpcSheet.ts', 'utf8')).toMatch(/WebSystem\.rungXp\(rung, rank\)/);
    expect(typeof NpcSheet).toBe('function');
  });

  it('the sheet of what the hands know says each skill\'s rank and level', () => {
    const pair = WebSystem.mint(['axe'], ['wood']);
    const sheet = WebSystem.earnedSheet({ ...player(), bank: { ...player().bank, universalSkills: { [pair.id]: { ...WebSystem.freshSkill(pair.id, pair.tags, SS), level: 3 } } } });
    expect(sheet.earned[0].rank).toBe(UniversalRank.SS);
    expect(sheet.earned[0].level).toBe(3);
  });

  it('the screens show a skill\'s own rank, not one worked out from its level', () => {
    for (const path of ['src/components/CharacterSheet.tsx', 'src/components/PlayerHub.tsx']) {
      expect(readFileSync(path, 'utf8'), path).toMatch(/ProgressionSystem\.skillRankOf\(skill\)/);
    }
  });
});

// =============================================================================
// LINE 94: every attribute changes how a character plays
// =============================================================================

describe('line 94: every attribute does real work, through the one door', () => {
  it('all fifteen are named, each with something that reads it', () => {
    expect(Object.keys(ATTRIBUTE_READERS).sort()).toEqual([...ALL_ATTRIBUTES].sort());
    for (const attr of ALL_ATTRIBUTES) expect(ATTRIBUTE_READERS[attr].length).toBeGreaterThan(0);
  });

  it('every reader named has a caller in the game, so none is decoration', () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.tsx?$/.test(name) && !path.replace(/\\/g, '/').endsWith('logic/systems/StatSystem.ts')) files.push(readFileSync(path, 'utf8'));
      }
    };
    walk('src');
    walk('shared');
    const all = files.join('\n');
    for (const [attr, readers] of Object.entries(ATTRIBUTE_READERS)) {
      for (const reader of readers) {
        expect(all.includes(`${reader}(`), `${attr}: ${reader}`).toBe(true);
      }
    }
  });

  it('the sheet can say what each one does, and raising it changes what it says', () => {
    for (const attr of ALL_ATTRIBUTES) {
      const before = StatSystem.attributeWork(attr, spread());
      const after = StatSystem.attributeWork(attr, raised(attr));
      expect(before.length, attr).toBeGreaterThan(0);
      expect(after, attr).not.toBe(before);
    }
  });

  it('a person at the floor plays as the bare numbers', () => {
    const floor = spread();
    expect(CombatMath.fireCooldownMs(blade, undefined, floor)).toBe(CombatMath.fireCooldownMs(blade));
    expect(CombatMath.outgoing(blade, undefined, 'k', floor)).toEqual(CombatMath.outgoing(blade, undefined, 'k'));
    expect(CombatMath.incoming(100, undefined, 'k', floor)).toEqual(CombatMath.incoming(100, undefined, 'k'));
    expect(LoadoutSystem.walkTilesPerSecond(undefined, floor)).toBe(LoadoutSystem.walkTilesPerSecond());
    expect(StatSystem.sightPx(undefined, floor)).toBe(StatSystem.sightPx());
    expect(StatSystem.noiseReduction(undefined, floor)).toBe(0);
    expect(StatSystem.levyDodgeOdds(floor)).toBe(StatSystem.levyDodgeOdds());
    expect(StatSystem.vendorOffer(100, floor)).toBe(60);
    expect(StatSystem.shopPrice(150, floor)).toBe(150);
    expect(StatSystem.channelMs(5000, floor)).toBe(5000);
    expect(StatSystem.upkeepDiscountPct(floor)).toBe(0);
    expect(StatSystem.recruitDisposition(floor)).toBe(70);
  });

  /** Many keyed swings, so a chance shows as a rate. */
  const swings = (weapon: IItem, attributes: IAttributes, n = 4000) => {
    let damage = 0, crits = 0, glances = 0;
    for (let i = 0; i < n; i++) {
      const hit = CombatMath.outgoing(weapon, undefined, `swing:${i}`, attributes);
      damage += hit.damage;
      if (hit.crit) crits++;
      if (hit.glance) glances++;
    }
    return { damage: damage / n, crits: crits / n, glances: glances / n };
  };
  const blows = (attributes: IAttributes, n = 4000) => {
    let taken = 0, dodged = 0;
    for (let i = 0; i < n; i++) {
      const hit = CombatMath.incoming(100, undefined, `blow:${i}`, attributes);
      taken += hit.damage;
      if (hit.dodged) dodged++;
    }
    return { taken: taken / n, dodged: dodged / n };
  };

  it('strength: it carries more and a melee swing lands harder, and it does nothing for a rifle', () => {
    expect(LoadoutSystem.carryLimit(raised('strength').strength)).toBeGreaterThan(LoadoutSystem.carryLimit(1));
    expect(swings(blade, raised('strength')).damage).toBeGreaterThan(swings(blade, spread()).damage);
    expect(swings(rifle, raised('strength')).damage).toBe(swings(rifle, spread()).damage);
  });

  it('constitution: more health', () => {
    expect(StatSystem.maxHealth(raised('constitution'))).toBeGreaterThan(StatSystem.maxHealth(spread()));
  });

  it('agility: a faster walk, and more blows missed', () => {
    expect(LoadoutSystem.walkTilesPerSecond(undefined, raised('agility'))).toBeGreaterThan(LoadoutSystem.walkTilesPerSecond());
    expect(blows(raised('agility')).dodged).toBeGreaterThan(blows(spread()).dodged);
    expect(blows(spread()).dodged).toBe(0);
  });

  it('dexterity: a faster hand, and fewer glancing hits', () => {
    expect(CombatMath.fireCooldownMs(rifle, undefined, raised('dexterity'))).toBeLessThan(CombatMath.fireCooldownMs(rifle));
    expect(swings(rifle, raised('dexterity')).glances).toBeLessThan(swings(rifle, spread()).glances);
  });

  it('endurance: more energy', () => {
    expect(StatSystem.maxEnergy(raised('endurance'))).toBeGreaterThan(StatSystem.maxEnergy(spread()));
  });

  it('intelligence: deeper recon, and faster learning', () => {
    expect(LoadoutSystem.reconEfficiency(spread({ intelligence: 10 }))).toBeGreaterThan(LoadoutSystem.reconEfficiency(spread()));
    expect(StatSystem.learnRate(raised('intelligence'))).toBeGreaterThan(StatSystem.learnRate(spread()));
  });

  it('focus: larger reserves and stronger workings', () => {
    expect(WeaveSystem.capacity(raised('focus'))).toBeGreaterThan(WeaveSystem.capacity(spread()));
    expect(StatSystem.castPower(raised('focus'))).toBeGreaterThan(StatSystem.castPower(spread()));
  });

  it('engineering: repairs cost less, and benches run faster', () => {
    const worn = { value: 1000, stats: { durability: 10, maxDurability: 100 } };
    expect(repairCost(worn, raised('engineering'))).toBeLessThan(repairCost(worn, spread()));
    expect(StatSystem.craftClockFactor(raised('engineering'))).toBeLessThan(StatSystem.craftClockFactor(spread()));
    expect(StatSystem.craftClockFactor(spread())).toBe(1);
  });

  it('hacking: the beacon opens faster, and a signal gives up sooner, never instantly', () => {
    expect(StatSystem.channelMs(5000, raised('hacking'))).toBeLessThan(5000);
    expect(StatSystem.channelMs(5000, spread({ hacking: 1_000_000 }))).toBeGreaterThan(0);
    const unread = { id: 'sig', isIdentified: false, affixes: [], tags: [] } as unknown as IItem;
    const asks = (attributes: IAttributes) => StudySystem.identifyAsk({ ...player(), attributes }, unread).seconds;
    expect(asks(raised('hacking', 30))).toBeLessThan(asks(spread()));
    expect(asks(spread({ hacking: 1_000_000 }))).toBeGreaterThan(0);
  });

  it('perception: deeper recon, further sight, and more telling hits', () => {
    expect(LoadoutSystem.reconEfficiency(spread({ perception: 10 }))).toBeGreaterThan(LoadoutSystem.reconEfficiency(spread()));
    expect(StatSystem.sightPx(undefined, raised('perception'))).toBeGreaterThan(StatSystem.sightPx());
    expect(swings(blade, raised('perception')).crits).toBeGreaterThan(0);
    expect(swings(blade, spread()).crits).toBe(0);
  });

  it('charisma: a talk lands more often', () => {
    expect(StatSystem.talkOdds('COIN', raised('charisma'))).toBeGreaterThan(StatSystem.talkOdds('COIN', spread()));
  });

  it('intimidation: a blow lands softer, and a thing that wants respect gives it sooner', () => {
    expect(blows(raised('intimidation')).taken).toBeLessThan(blows(spread()).taken);
    expect(StatSystem.talkOdds('RESPECT', raised('intimidation'))).toBeGreaterThan(StatSystem.talkOdds('RESPECT', spread()));
    expect(StatSystem.talkOdds('COIN', raised('intimidation'))).toBe(StatSystem.talkOdds('COIN', spread()));
  });

  it('subterfuge: quieter in the field, and a dodge of the levy lands more often, never always', () => {
    expect(StatSystem.noiseReduction(undefined, raised('subterfuge'))).toBeGreaterThan(0);
    expect(StatSystem.levyDodgeOdds(raised('subterfuge'))).toBeGreaterThan(StatSystem.levyDodgeOdds(spread()));
    expect(StatSystem.levyDodgeOdds(spread({ subterfuge: 1_000_000 }))).toBeLessThan(1);
  });

  it('bartering: the counter pays more and asks less, and no amount of it mints gold', () => {
    expect(StatSystem.vendorOffer(100, raised('bartering'))).toBeGreaterThan(60);
    expect(StatSystem.shopPrice(150, raised('bartering'))).toBeLessThan(150);
    const master = spread({ bartering: 1_000_000 });
    // The shelf asks 1.5 of value: what you can sell back for must stay under what you paid
    for (const value of [1, 10, 100, 12345]) {
      expect(StatSystem.vendorOffer(value, master)).toBeLessThan(StatSystem.shopPrice(value * 1.5, master));
    }
  });

  it('leadership: people follow sooner, and what you own costs less to keep', () => {
    expect(StatSystem.recruitDisposition(raised('leadership'))).toBeLessThan(70);
    expect(StatSystem.recruitDisposition(spread({ leadership: 1_000_000 }))).toBeGreaterThanOrEqual(0);
    expect(StatSystem.upkeepDiscountPct(raised('leadership'))).toBeGreaterThan(0);
    expect(StatSystem.upkeepDiscountPct(spread({ leadership: 1_000_000 }))).toBeLessThan(100);
  });

  it('attribute gain is keyed like everything else: the same swing answers the same', () => {
    const attrs = spread({ strength: 7, dexterity: 7, perception: 7 });
    expect(CombatMath.outgoing(blade, undefined, 'same', attrs)).toEqual(CombatMath.outgoing(blade, undefined, 'same', attrs));
    expect(CombatMath.incoming(50, undefined, 'same', attrs)).toEqual(CombatMath.incoming(50, undefined, 'same', attrs));
  });
});

describe('line 94: two characters of different spreads play differently', () => {
  const of = (archetype: string): IAttributes => {
    const out = spread();
    Object.entries(ARCHETYPES[archetype]).forEach(([k, v]) => { (out as any)[k] += v; });
    return out;
  };
  /** What a character does in play, door by door. */
  const play = (a: IAttributes) => ({
    health: StatSystem.maxHealth(a),
    energy: StatSystem.maxEnergy(a),
    carry: LoadoutSystem.carryLimit(a.strength),
    pace: LoadoutSystem.walkTilesPerSecond(undefined, a),
    cooldown: CombatMath.fireCooldownMs(blade, undefined, a),
    swing: CombatMath.outgoing(blade, undefined, 'k', a).damage,
    blowsTaken: CombatMath.incoming(100, undefined, 'k', a).damage,
    sight: StatSystem.sightPx(undefined, a),
    noise: StatSystem.noiseReduction(undefined, a),
    learn: StatSystem.learnRate(a),
    channel: StatSystem.channelMs(5000, a),
    recon: LoadoutSystem.reconEfficiency(a),
    reserve: WeaveSystem.capacity(a),
    offer: StatSystem.vendorOffer(1000, a),
    craft: StatSystem.craftClockFactor(a),
    talk: StatSystem.talkOdds('COIN', a)
  });

  it('each of the four starts is unlike the others in several doors', () => {
    const names = Object.keys(ARCHETYPES);
    for (let i = 0; i < names.length; i++) {
      for (let j = i + 1; j < names.length; j++) {
        const a = play(of(names[i])) as Record<string, number>;
        const b = play(of(names[j])) as Record<string, number>;
        const differing = Object.keys(a).filter(k => a[k] !== b[k]);
        expect(differing.length, `${names[i]} vs ${names[j]}`).toBeGreaterThanOrEqual(4);
      }
    }
  });

  it('the fighter out-swings and out-paces, the operator exits and learns faster', () => {
    const samurai = play(of('STREET_SAMURAI'));
    const operator = play(of('OPERATOR'));
    expect(samurai.cooldown).toBeLessThan(operator.cooldown);
    expect(samurai.pace).toBeGreaterThan(operator.pace);
    expect(samurai.carry).toBeGreaterThan(operator.carry);
    expect(operator.channel).toBeLessThan(samurai.channel);
    expect(operator.learn).toBeGreaterThan(samurai.learn);
    expect(operator.craft).toBeLessThan(samurai.craft);
  });
});

// =============================================================================
// The circles: levels are banked and poured into skills, and three earn a call
// =============================================================================

describe('banked levels are circles to fill', () => {
  const pair = () => WebSystem.mint(['axe'], ['wood']);
  const hold = (...ids: string[]) => {
    const skills = Object.fromEntries(ids.map(id => [id, WebSystem.freshSkill(id, id.replace(/^skill_/, '').split('+'), 0)]));
    usePlayerStore.setState(s => ({ player: { ...s.player, bank: { ...s.player.bank, universalSkills: { ...s.player.bank.universalSkills, ...skills } } } }));
  };
  const levels = (n: number) => usePlayerStore.setState(s => ({ player: { ...s.player, levelsBanked: n } }));

  it('a new character has none, and every third level climbed is one', () => {
    // 2026-11-11, BALANCE_RUN.md 2.13 (Pedro: "the circles in skills, not at every level, one at every 3 levels")
    expect(CircleSystem.free(player())).toBe(0);
    store().applyKillXp(ProgressionSystem.levelCost(UniversalRank.F, 1));
    expect(CircleSystem.free(player())).toBe(0);
    store().applyKillXp(ProgressionSystem.levelCost(UniversalRank.F, 2) + ProgressionSystem.levelCost(UniversalRank.F, 3));
    expect(CircleSystem.free(player())).toBe(1);
  });

  it('a rank\'s reset takes none: what was free stays free, and what was filled stays filled', () => {
    hold(pair().id);
    // 2026-11-11, BALANCE_RUN.md 2.13 (Pedro: "the circles in skills, not at every level, one at every 3 levels"): three levels climbed make the circle to fill
    store().applyKillXp(ProgressionSystem.levelCost(UniversalRank.F, 1) + ProgressionSystem.levelCost(UniversalRank.F, 2) + ProgressionSystem.levelCost(UniversalRank.F, 3));
    store().fillCircle(pair().id);
    const free = CircleSystem.free(player());
    store().grantRank();
    expect(ProgressionSystem.levelOf(player())).toBe(1);
    expect(ProgressionSystem.levelsEarned(player())).toBe(3);
    expect(CircleSystem.free(player())).toBe(free);
    expect(player().bank.universalSkills[pair().id].circles).toBe(1);
  });

  it('levels still pay attribute points beside the circle', () => {
    // 2026-11-11, BALANCE_RUN.md 2.13 (Pedro: "the circles in skills, not at every level, one at every 3 levels"): every level pays its points, and the third pays the circle
    const res = store().applyKillXp(ProgressionSystem.levelCost(UniversalRank.F, 1) + ProgressionSystem.levelCost(UniversalRank.F, 2) + ProgressionSystem.levelCost(UniversalRank.F, 3));
    expect(res.pointsGranted).toBe(3 * POINTS_PER_LEVEL);
    expect(CircleSystem.free(player())).toBe(1);
  });

  it('filling spends one, and without one free the door refuses', () => {
    hold(pair().id);
    expect(store().fillCircle(pair().id)).toBe(false);
    // 2026-11-11, BALANCE_RUN.md 2.13 (Pedro: "the circles in skills, not at every level, one at every 3 levels")
    levels(3);
    expect(store().fillCircle(pair().id)).toBe(true);
    expect(CircleSystem.free(player())).toBe(0);
    expect(store().fillCircle(pair().id)).toBe(false);
    expect(player().bank.universalSkills[pair().id].circles).toBe(1);
  });

  it('only a skill the web can read takes a circle', () => {
    // 2026-11-11, BALANCE_RUN.md 2.13 (Pedro: "the circles in skills, not at every level, one at every 3 levels"): nine levels climbed make three circles
    levels(9);
    usePlayerStore.setState(s => ({ player: { ...s.player, bank: { ...s.player.bank, universalSkills: { old_track: { ...WebSystem.freshSkill('old_track', [], 0), legacy: true } } } } }));
    expect(store().fillCircle('old_track')).toBe(false);
    expect(store().fillCircle('skill_never_held')).toBe(false);
    expect(CircleSystem.free(player())).toBe(3);
  });

  it('no skill has a top, and each further three is owed another', () => {
    hold(pair().id);
    // 2026-11-11, BALANCE_RUN.md 2.13 (Pedro: "the circles in skills, not at every level, one at every 3 levels"): nine circles take twenty-seven levels climbed
    levels(27);
    for (let i = 0; i < 9; i++) expect(store().fillCircle(pair().id)).toBe(true);
    expect(CircleSystem.asks(player())[0].owed).toBe(3);
  });
});

describe('three circles ask the rest door for an active skill or a passive bonus', () => {
  const pair = () => WebSystem.mint(['axe'], ['wood']);
  // D118, Pedro: "Gifts also cost lore". These bars are about the words, so the purse is not what they test: tests/study.test.ts holds the price.
  const ready = (circles: number, rank = 0) => {
    usePlayerStore.setState(s => ({ player: { ...s.player, levelsBanked: circles, bank: { ...s.player.bank, loreHeld: 1_000_000, universalSkills: { [pair().id]: { ...WebSystem.freshSkill(pair().id, pair().tags, rank), circles } } } } }));
  };
  const asked = () => ({ skills: [], weaves: [], gifts: [pair().id] });
  const active = (over: Partial<IGiftWords> = {}): IGiftWords => ({ skill: pair().id, kind: 'active', name: 'Felling Word', blurb: 'It falls before you ask.', elements: ['debt'], delivery: 'melee', effect: 'damage', cost: 'low', stat: '', band: '', ...over });
  const passive = (over: Partial<IGiftWords> = {}): IGiftWords => ({ skill: pair().id, kind: 'passive', name: 'Long Grain', blurb: 'You read the wood.', elements: [], delivery: '', effect: '', cost: '', stat: 'carry_capacity', band: 'moderate', ...over });
  const result = (gifts: IGiftWords[]) => ({ skills: [], weaves: [], gifts });

  it('three is the number', () => {
    expect(CIRCLES_FOR_A_GIFT).toBe(3);
  });

  it('a character\'s very first gift asks one circle; once one is held, two circles ask nothing, and the third is owed', () => {
    // Changed on purpose 2026-11-11. Asked "A first gift now takes nine levels. Lower what a gift asks from three
    // circles to one?", Pedro answered "Lower to one", then: "how about first gift is one, first gift new skill is 3,
    // so the first first is one".
    ready(1);
    expect(CircleSystem.asks(player()).map(a => a.id)).toEqual([pair().id]);
    const held = { kind: 'passive', name: 'Old Grain', blurb: '', id: 'gift_other_0' } as never;
    usePlayerStore.setState(s => ({ player: { ...s.player, skillGifts: { skill_other: [held] } } }));
    ready(2);
    usePlayerStore.setState(s => ({ player: { ...s.player, skillGifts: { skill_other: [held] } } }));
    expect(CircleSystem.asks(player())).toEqual([]);
    ready(3);
    usePlayerStore.setState(s => ({ player: { ...s.player, skillGifts: { skill_other: [held] } } }));
    expect(CircleSystem.asks(player()).map(a => a.id)).toEqual([pair().id]);
  });

  it('the call goes in what the rest files: it says what the skill is, and no more', () => {
    ready(3);
    const q = RestSystem.dreamQueue(player(), []) as { gifts: { id: string; tags: string[]; circles: number; owed: number }[] };
    expect(q.gifts).toHaveLength(1);
    expect(q.gifts[0]).toMatchObject({ id: pair().id, tags: pair().tags, circles: 3, owed: 1, rank: UniversalRank.F });
    expect(JSON.stringify(q)).not.toContain(player().username);
  });

  it('what the door files goes out when only a gift is owed', () => {
    const src = readFileSync('src/logic/systems/RestDoor.ts', 'utf8');
    expect(src).toMatch(/skills\.length === 0 && weaves\.length === 0 && gifts\.length === 0/);
    expect(src).toMatch(/gifts: gifts\.map\(q => q\.id\)/);
  });

  it('the schema and the system prompt carry the ask', () => {
    const src = readFileSync('shared/intelligence/prompts.ts', 'utf8');
    expect(src).toMatch(/required: \['skills', 'weaves', 'gifts'/);
    expect(src).toMatch(/passive bonus/);
  });

  it('it never asks during play: only a rest files it', () => {
    const circles = readFileSync('src/logic/systems/CircleSystem.ts', 'utf8');
    expect(circles).not.toMatch(/IntelligenceClient/);
  });

  it('a gift nobody asked for, or outside the words, refuses the whole answer', () => {
    ready(3);
    expect(RestSystem.judgeDream(result([active()]), asked(), player()).ok).toBe(true);
    expect(RestSystem.judgeDream(result([passive()]), asked(), player()).ok).toBe(true);
    expect(RestSystem.judgeDream(result([active({ skill: 'skill_other' })]), asked(), player()).ok).toBe(false);
    expect(RestSystem.judgeDream(result([active({ name: ' ' })]), asked(), player()).ok).toBe(false);
    expect(RestSystem.judgeDream(result([active({ effect: 'summon' })]), asked(), player()).ok).toBe(false);
    expect(RestSystem.judgeDream(result([active({ delivery: 'psychic' })]), asked(), player()).ok).toBe(false);
    expect(RestSystem.judgeDream(result([active({ cost: 'free' })]), asked(), player()).ok).toBe(false);
    expect(RestSystem.judgeDream(result([active({ elements: [] })]), asked(), player()).ok).toBe(false);
    expect(RestSystem.judgeDream(result([passive({ stat: 'charisma' })]), asked(), player()).ok).toBe(false);
    expect(RestSystem.judgeDream(result([passive({ band: 'huge' })]), asked(), player()).ok).toBe(false);
    expect(RestSystem.judgeDream(result([active({ kind: 'nothing' as never })]), asked(), player()).ok).toBe(false);
  });

  it('a skill takes only what it is owed', () => {
    ready(3);
    expect(RestSystem.judgeDream(result([active(), passive()]), asked(), player()).ok).toBe(false);
  });

  it('a working drawn on an element this world does not hold is refused', () => {
    ready(3);
    expect(RestSystem.judgeDream(result([active()]), asked(), player(), ['interest']).ok).toBe(false);
    expect(RestSystem.judgeDream(result([active()]), asked(), player(), ['debt']).ok).toBe(true);
  });

  it('an old answer with no gifts still stands', () => {
    expect(RestSystem.judgeDream({ skills: [], weaves: [] }, { skills: [], weaves: [] }).ok).toBe(true);
    expect(RestSystem.applyDream(player(), { skills: [], weaves: [] }).skillGifts).toBeUndefined();
  });

  it('an active gift can be cast through the one door, and a rest effect refills', () => {
    ready(3);
    const after = RestSystem.applyDream(player(), result([active({ effect: 'rest', delivery: 'self' })]));
    const gift = after.skillGifts![pair().id][0];
    const ability = CircleSystem.abilityOf(after, gift.id)!;
    expect(ability.effect).toBe('rest');
    const receipt = EffectSystem.resolve(ability, { rank: UniversalRank.F }, 'k');
    expect(EffectSystem.landsOnCaster(receipt.effect, receipt.delivery)).toBe(true);
    expect(readFileSync('src/components/WorldCanvas.tsx', 'utf8')).toMatch(/cast\.kind === 'gift' \? CircleSystem\.abilityOf\(player, cast\.id\)/);
    expect(readFileSync('src/components/TheWorking.tsx', 'utf8')).toMatch(/kind: 'gift', id: g\.id/);
  });

  it('a passive gift acts wherever the stat is read, with a number no model wrote', () => {
    ready(3);
    const before = LoadoutSystem.carryLimit(player().attributes.strength, player().equipment);
    const after = RestSystem.applyDream(player(), result([passive()]));
    const gift = after.skillGifts![pair().id][0];
    expect(gift.value).toBeGreaterThan(0);
    expect(after.equipment!.passives).toEqual({ carry_capacity: gift.value });
    expect(LoadoutSystem.carryLimit(after.attributes.strength, after.equipment)).toBe(before + gift.value!);
    // The same person and skill roll the same number
    expect(RestSystem.applyDream(player(), result([passive()])).skillGifts![pair().id][0].value).toBe(gift.value);
  });

  it('a rarer skill\'s passive is worth more', () => {
    ready(3, 0);
    const common = RestSystem.applyDream(player(), result([passive()])).skillGifts![pair().id][0].value!;
    ready(3, RANK_ORDER.indexOf(UniversalRank.SS));
    const rare = RestSystem.applyDream(player(), result([passive()])).skillGifts![pair().id][0].value!;
    expect(rare).toBeGreaterThan(common);
  });

  it('every passive word has a typical size and a reader through the one door', () => {
    for (const stat of PASSIVE_STATS) {
      expect(STAT_SCALE[stat], stat).toBeGreaterThan(0);
      expect(StatSystem.total({ slots: {}, items: [], frames: {}, protected: [], passives: { [stat]: 2 } } as IEquipmentState, stat)).toBe(2);
    }
  });

  it('what is owed is paid: asking stops after the gift lands, and the next three ask again', () => {
    ready(3);
    const after = RestSystem.applyDream(player(), result([passive()]));
    expect(CircleSystem.asks(after)).toEqual([]);
    const more = { ...after, bank: { ...after.bank, universalSkills: { [pair().id]: { ...after.bank.universalSkills[pair().id], circles: 6 } } } };
    const next = CircleSystem.asks(more);
    expect(next[0].owed).toBe(1);
    expect(next[0].has).toEqual(['Long Grain']);
  });

  it('a batch that fails asks again: what is owed is read from the skill, not from a queue', () => {
    ready(3);
    const failed = { ...player(), pendingDream: undefined };
    expect(CircleSystem.asks(failed)).toHaveLength(1);
  });

  it('the passives come back with the attributes after a load', () => {
    ready(3);
    usePlayerStore.setState({ player: RestSystem.applyDream(player(), result([passive()])) });
    usePlayerStore.setState(s => ({ player: { ...s.player, equipment: { ...s.player.equipment!, passives: undefined } } }));
    store().recalcAttributes();
    expect(player().equipment!.passives!.carry_capacity).toBeGreaterThan(0);
  });

  it('the sheet shows circles by shape, in threes, with a way to fill them', () => {
    const src = readFileSync('src/components/PlayerHub.tsx', 'utf8');
    // Changed on purpose 2026-11-11. Pedro: "how about first gift is one, first gift new skill is 3, so the first first is one": the first group can be one
    expect(src).toMatch(/<Circles filled=\{row\.circles\} first=\{CircleSystem\.firstAsks\(player, row\.id\)\} \/>/);
    expect(src).toMatch(/background: i < filled \?/);
    expect(src).toMatch(/Fill a circle in/);
    // Q28: the field's chip and the city's bar read one line, which says what waits
    expect(readFileSync('src/components/WorldCanvas.tsx', 'utf8')).toMatch(/levelLine\(player\)/);
    expect(readFileSync('src/components/ui/levelLine.ts', 'utf8')).toMatch(/TO FILL/);
  });
});


// =============================================================================
// Taking things pays experience in the world, by the risk, and only once
// =============================================================================

describe('experience pays in the world, by the risk', () => {
  const F = { rank: UniversalRank.F, rarity: Rarity.COMMON };
  const D = { rank: UniversalRank.D, rarity: Rarity.COMMON };

  it('a chest pays far more than a pebble of the same rank', () => {
    const pebble = ProgressionSystem.worldXp(F, XP_SHARE_HARVEST);
    const chest = ProgressionSystem.worldXp(F, XP_SHARE_CHEST);
    expect(pebble).toBeGreaterThan(0);
    expect(chest).toBeGreaterThanOrEqual(pebble * 10);
    // A pebble is a small thing beside a fight of its own rank
    expect(pebble).toBeLessThan(ProgressionSystem.calculateKillXp(UniversalRank.F, Rarity.COMMON) / 10);
  });

  it('a higher rank and a rarer thing pay more', () => {
    expect(ProgressionSystem.worldXp(D, XP_SHARE_HARVEST)).toBeGreaterThan(ProgressionSystem.worldXp(F, XP_SHARE_HARVEST));
    expect(ProgressionSystem.worldXp({ ...F, rarity: Rarity.RARE }, XP_SHARE_HARVEST)).toBeGreaterThanOrEqual(ProgressionSystem.worldXp(F, XP_SHARE_HARVEST));
  });

  it('whatever still stands near it adds to it, by what it is', () => {
    const alone = ProgressionSystem.worldXp(F, XP_SHARE_CHEST);
    const guarded = ProgressionSystem.worldXp(F, XP_SHARE_CHEST, [F, F]);
    expect(guarded).toBeGreaterThan(alone);
    expect(guarded).toBe(Math.floor(50 * XP_SHARE_CHEST + 2 * 50 * XP_SHARE_THREAT));
    expect(ProgressionSystem.worldXp(F, XP_SHARE_CHEST, [D, D])).toBeGreaterThan(guarded);
  });

  it('nothing is worth less than one', () => {
    expect(ProgressionSystem.worldXp({ ...F, rarity: Rarity.SCRAP }, 0.0001)).toBe(1);
  });

  // A session standing in a one-chunk world
  const stand = (extra: IWorldEntity[]) => {
    useWorldStore.setState({ currentMap: { seed: 'risk_world', width: 1, height: 1, gridVersion: 2, sectors: {}, generatedAt: 0, chunks: { '0,0': { id: '0,0', x: 0, y: 0, entities: extra } } } } as never);
    usePlayerStore.setState(s => ({ player: { ...s.player, attributes: { ...s.player.attributes, strength: 500 }, currentSession: { sessionId: 's', layerId: 'l', inventory: [], inventoryLayout: {}, health: 100, maxHealth: 100, energy: 1000, position: { x: 0, y: 0, z: 0 }, statusEffects: [] } as never } }));
    store().recalcWeight();
  };
  const xp = () => player().rankXp ?? 0;
  const entity = (over: Record<string, unknown>) => ({ position: { x: 5, y: 0 }, rank: UniversalRank.F, rarity: Rarity.COMMON, isHostile: false, ...over }) as unknown as IWorldEntity;
  const chest = (over: Record<string, unknown> = {}) => entity({ id: 'chest_1', type: EntityType.CONTAINER, definitionId: 'chest_ruin', container: { lootRank: UniversalRank.F, looted: false, hasLore: false }, ...over });
  const mob = (id: string, x: number, over: Record<string, unknown> = {}) => entity({ id, type: EntityType.MOB, definitionId: 'mob_x', isHostile: true, health: 10, position: { x, y: 0 }, ...over });

  it('opening a chest pays once, and opening it again pays nothing', () => {
    stand([chest()]);
    store().performInteraction('int_open_chest_1', 'chest_1');
    const paid = xp();
    expect(paid).toBe(ProgressionSystem.worldXp({ rank: UniversalRank.F, rarity: Rarity.COMMON }, XP_SHARE_CHEST));
    store().performInteraction('int_open_chest_1', 'chest_1');
    expect(xp()).toBe(paid);
  });

  it('a chest pays more while its guards stand, and those near enough are the ones that count', () => {
    stand([chest(), mob('g1', 30), mob('g2', 60), mob('far', 5 + (THREAT_RADIUS_TILES + 2) * 20)]);
    store().performInteraction('int_open_chest_1', 'chest_1');
    expect(xp()).toBe(ProgressionSystem.worldXp({ rank: UniversalRank.F, rarity: Rarity.COMMON }, XP_SHARE_CHEST, [
      { rank: UniversalRank.F, rarity: Rarity.COMMON }, { rank: UniversalRank.F, rarity: Rarity.COMMON }
    ]));
  });

  it('a richer chunk gives richer loot and no more experience: the risk is the same', () => {
    stand([chest({ rarity: Rarity.LEGENDARY })]);
    store().performInteraction('int_open_chest_1', 'chest_1');
    expect(xp()).toBe(ProgressionSystem.worldXp({ rank: UniversalRank.F, rarity: Rarity.COMMON }, XP_SHARE_CHEST));
  });

  it('what lies dead, or means no harm, is no risk', () => {
    stand([chest(), mob('dead', 30, { health: 0 }), mob('calm', 40, { isHostile: false })]);
    store().performInteraction('int_open_chest_1', 'chest_1');
    expect(xp()).toBe(ProgressionSystem.worldXp({ rank: UniversalRank.F, rarity: Rarity.COMMON }, XP_SHARE_CHEST));
  });

  it('gathering pays for each use of the node, and takes the thing\'s own rank', () => {
    const def = Object.values(RESOURCE_DEFINITIONS).find(d => d.harvestConfig && (d.uses ?? 1) > 1)!;
    stand([entity({ id: 'node', type: EntityType.RESOURCE, definitionId: def.id, usesRemaining: 2 })]);
    store().performInteraction('int_harvest_node', 'node');
    const once = xp();
    expect(once).toBe(ProgressionSystem.worldXp({ rank: def.rank ?? UniversalRank.F, rarity: def.rarity }, XP_SHARE_HARVEST));
    store().performInteraction('int_harvest_node', 'node');
    expect(xp()).toBe(once * 2);
  });

  it('a harvest refused for want of energy pays nothing', () => {
    const def = Object.values(RESOURCE_DEFINITIONS).find(d => d.harvestConfig && d.harvestConfig.energyCost > 0)!;
    stand([entity({ id: 'node', type: EntityType.RESOURCE, definitionId: def.id, usesRemaining: 2 })]);
    usePlayerStore.setState(s => ({ player: { ...s.player, currentSession: { ...s.player.currentSession!, energy: 0 } } }));
    store().performInteraction('int_harvest_node', 'node');
    expect(xp()).toBe(0);
  });

  it('a level earned this way is said, and pays its point and its circle', () => {
    stand([chest({ container: { lootRank: UniversalRank.A, looted: false, hasLore: false } })]);
    store().performInteraction('int_open_chest_1', 'chest_1');
    expect(ProgressionSystem.levelOf(player())).toBeGreaterThan(1);
    // 2026-11-11, BALANCE_RUN.md 2.13 (Pedro: "4 points per level, one free point and one for each of the buckets"), and a circle only at every third level climbed
    expect(ProgressionSystem.unspent(player()).total).toBe((ProgressionSystem.levelOf(player()) - 1) * POINTS_PER_LEVEL);
    expect(CircleSystem.free(player())).toBe(ProgressionSystem.circlesEarned(player()));
  });

  it('no double dip: a cache of what was already yours pays nothing', () => {
    const rock = { id: 'rock', name: 'rock', weight: 1, dimensions: { width: 1, height: 1 }, affixes: [], stats: {}, tags: [], isIdentified: true } as unknown as IItem;
    stand([chest({ id: 'cache_1', definitionId: 'ground_cache', container: { lootRank: UniversalRank.A, looted: false, hasLore: false, items: [rock], cacheOwner: 'someone' } })]);
    store().performInteraction('int_open_cache_1', 'cache_1');
    expect(player().currentSession!.inventory.map(i => i.id)).toEqual(['rock']);
    expect(xp()).toBe(0);
  });

  it('no double dip: only a fight and the taking itself pay; picking up a drop and the beacon do not', () => {
    const world = readFileSync('src/components/WorldCanvas.tsx', 'utf8');
    expect(world).not.toMatch(/applyKillXp|worldXp/);
    const taken = readFileSync('src/entities/player/store.ts', 'utf8');
    expect(taken.split('payForRisk(').length - 1).toBe(2);
    const combat = readFileSync('src/entities/combat/killRewards.ts', 'utf8');
    expect(combat).toMatch(/applyKillXp/);
  });
});


// =============================================================================
// Chests restock when a cycle builds the world, by rank, rarity and their guards
// =============================================================================

describe('a chest stays taken through its cycle, and restocks by rank, rarity and a roll', () => {
  const SEED = 'chest_world';
  const rareInF = { id: 'ent_1_1_chest', rank: UniversalRank.F, rarity: Rarity.RARE };
  const commonInF = { id: 'ent_2_2_chest', rank: UniversalRank.F, rarity: Rarity.COMMON };
  const guardsD = [{ id: 'ent_1_1_guard0', rank: UniversalRank.D }, { id: 'ent_1_1_guard1', rank: UniversalRank.D }];
  const looted = (id: string, at: number): IChestRecord => ChestSystem.looted(emptyChestRecord(), id, at);

  it('nothing taken, nothing empty', () => {
    expect(ChestSystem.standsEmpty(SEED, emptyChestRecord(), rareInF, guardsD, 5)).toBe(false);
  });

  it('within the cycle it was emptied in, it never restocks', () => {
    for (let i = 0; i < 500; i++) {
      const chest = { ...commonInF, id: `ent_${i}_0_chest` };
      expect(ChestSystem.standsEmpty(SEED, looted(chest.id, 3), chest, [], 3)).toBe(true);
    }
  });

  it('the wait grows with rank and with rarity', () => {
    expect(ChestSystem.waitCycles(UniversalRank.F, Rarity.COMMON)).toBeGreaterThanOrEqual(1);
    expect(ChestSystem.waitCycles(UniversalRank.F, Rarity.RARE)).toBeGreaterThan(ChestSystem.waitCycles(UniversalRank.F, Rarity.COMMON));
    expect(ChestSystem.waitCycles(UniversalRank.B, Rarity.COMMON)).toBeGreaterThan(ChestSystem.waitCycles(UniversalRank.F, Rarity.COMMON));
  });

  it('before its wait is up no chest restocks, whatever the dice', () => {
    const wait = ChestSystem.waitCycles(rareInF.rank, rareInF.rarity);
    for (let i = 0; i < 500; i++) {
      const chest = { ...rareInF, id: `ent_${i}_1_chest` };
      expect(ChestSystem.standsEmpty(SEED, looted(chest.id, 0), chest, [], wait - 1)).toBe(true);
    }
  });

  /** How often a chest stands full, one roll after its wait. */
  const restockRate = (rank: UniversalRank, rarity: Rarity) => {
    let full = 0;
    const n = 4000;
    const wait = ChestSystem.waitCycles(rank, rarity);
    for (let i = 0; i < n; i++) {
      const chest = { id: `ent_${i}_9_chest`, rank, rarity };
      if (!ChestSystem.standsEmpty(SEED, looted(chest.id, 0), chest, [], wait)) full++;
    }
    return full / n;
  };

  it('a rarer chest has less chance on each cycle, and so does a higher rank', () => {
    const common = restockRate(UniversalRank.F, Rarity.COMMON);
    const rare = restockRate(UniversalRank.F, Rarity.RARE);
    const legendary = restockRate(UniversalRank.F, Rarity.LEGENDARY);
    expect(common).toBeGreaterThan(rare);
    expect(rare).toBeGreaterThan(legendary);
    expect(restockRate(UniversalRank.A, Rarity.RARE)).toBeLessThan(rare);
    // The rolls are the d20 they say they are
    expect(common).toBeCloseTo((21 - ChestSystem.restockDC(UniversalRank.F, Rarity.COMMON)) / 20, 1);
    expect(rare).toBeCloseTo((21 - ChestSystem.restockDC(UniversalRank.F, Rarity.RARE)) / 20, 1);
  });

  it('even the rarest can still come back: a natural 20 always restocks', () => {
    expect(ChestSystem.restockDC(UniversalRank.SSS, Rarity.ARTIFACT)).toBe(20);
    expect(restockRate(UniversalRank.SSS, Rarity.ARTIFACT)).toBeGreaterThan(0);
  });

  it('the roll is keyed: the same chest and cycle answer the same, for anyone, in any order', () => {
    const record = looted(rareInF.id, 0);
    const a = [8, 3, 5, 12, 4].map(c => ChestSystem.standsEmpty(SEED, record, rareInF, [], c));
    const b = [8, 3, 5, 12, 4].map(c => ChestSystem.standsEmpty(SEED, record, rareInF, [], c));
    expect(a).toEqual(b);
    expect(ChestSystem.rolled(SEED, rareInF.id, 4)).toBe(ChestSystem.rolled(SEED, rareInF.id, 4));
  });

  it('once it has restocked it stays full until somebody takes it again', () => {
    const record = looted(rareInF.id, 0);
    let first = -1;
    for (let c = 0; c < 200 && first < 0; c++) if (!ChestSystem.standsEmpty(SEED, record, rareInF, [], c)) first = c;
    expect(first).toBeGreaterThan(0);
    for (let c = first; c < first + 50; c++) expect(ChestSystem.standsEmpty(SEED, record, rareInF, [], c)).toBe(false);
    const again = ChestSystem.looted(record, rareInF.id, first + 50);
    expect(ChestSystem.standsEmpty(SEED, again, rareInF, [], first + 50)).toBe(true);
  });

  it('guards must be back before the chest can roll: Pedro\'s rare chest with two rank D guards', () => {
    // The guards fell where the chest was taken
    let record = looted(rareInF.id, 0);
    for (const g of guardsD) record = ChestSystem.fell(record, g.id, 0);
    const down = ChestSystem.guardCycles(UniversalRank.D);
    expect(down).toBeGreaterThan(ChestSystem.guardCycles(UniversalRank.F));
    for (let c = 0; c < down; c++) expect(ChestSystem.guardDown(record, guardsD[0], c)).toBe(true);
    expect(ChestSystem.guardDown(record, guardsD[0], down)).toBe(false);
    // A guard that falls late holds its chest from rolling until it is back
    const late = ChestSystem.fell(looted(rareInF.id, 0), guardsD[0].id, 6);
    for (let i = 0; i < 300; i++) {
      const chest = { ...rareInF, id: `ent_${i}_3_chest` };
      const held = { ...late, chests: { [chest.id]: { lootedAt: 6 } } };
      for (let c = 6; c < 6 + down; c++) expect(ChestSystem.standsEmpty(SEED, held, chest, guardsD, c)).toBe(true);
    }
  });

  it('a guard that falls after a chest has restocked cannot empty it again', () => {
    const record = looted(rareInF.id, 0);
    let first = -1;
    for (let c = 0; c < 200 && first < 0; c++) if (!ChestSystem.standsEmpty(SEED, record, rareInF, [], c)) first = c;
    const after = ChestSystem.fell(record, guardsD[0].id, first + 1);
    expect(ChestSystem.standsEmpty(SEED, after, rareInF, guardsD, first + 1)).toBe(false);
  });

  it('only a chest and its guards are written down', () => {
    expect(ChestSystem.isChest('ent_1_1_chest')).toBe(true);
    expect(ChestSystem.isChest('cache_ovf_x')).toBe(false);
    expect(ChestSystem.chestOfGuard('ent_1_1_guard1')).toBe('ent_1_1_chest');
    expect(ChestSystem.chestOfGuard('ent_1_1_m0')).toBeNull();
  });

  const body = (id: string, over: Record<string, unknown> = {}) => ({ id, type: EntityType.MOB, rank: UniversalRank.D, rarity: Rarity.COMMON, position: { x: 0, y: 0 }, isHostile: true, health: 10, definitionId: 'mob_x', ...over }) as unknown as IWorldEntity;
  const box = (id: string, over: Record<string, unknown> = {}) => ({ id, type: EntityType.CONTAINER, rank: UniversalRank.F, rarity: Rarity.RARE, position: { x: 0, y: 0 }, isHostile: false, definitionId: 'chest_ruin', container: { lootRank: UniversalRank.F, looted: false, hasLore: true }, ...over }) as unknown as IWorldEntity;

  it('the record lies over a built chunk: fallen guards are gone and an emptied chest reads empty', () => {
    const chunk = { id: 'c', x: 0, y: 0, entities: [box('ent_1_1_chest'), body('ent_1_1_guard0'), body('ent_1_1_guard1'), body('ent_1_1_m0')] } as any;
    let record = ChestSystem.looted(emptyChestRecord(), 'ent_1_1_chest', 2);
    record = ChestSystem.fell(record, 'ent_1_1_guard0', 2);
    ChestSystem.layOver(SEED, chunk, record, 2);
    const ids = chunk.entities.map((e: IWorldEntity) => e.id);
    expect(ids).toEqual(['ent_1_1_chest', 'ent_1_1_guard1', 'ent_1_1_m0']);
    expect(chunk.entities[0].container.looted).toBe(true);
  });

  it('with nothing taken the chunk comes out exactly as it went in, so no world moves', () => {
    const entities = [box('ent_1_1_chest'), body('ent_1_1_guard0')];
    const chunk = { id: 'c', x: 0, y: 0, entities: [...entities] } as any;
    ChestSystem.layOver(SEED, chunk, emptyChestRecord(), 7);
    expect(chunk.entities).toEqual(entities);
  });

  it('a chunk reached through the world reads the record; a build alone stays pure', () => {
    const context = { mobDefinitions: [], resourceDefinitions: [] } as any;
    const map = WorldGenerator.generate('lay_world', 1, context);
    const plain = WorldGenerator.buildChunk('lay_world', [], 0, 0, context);
    const seen: string[] = [];
    const chunk = WorldGenerator.chunkAt(map, 0, 0, { ...context, lay: (c: any) => seen.push(c.id) });
    expect(seen).toEqual([chunk!.id]);
    expect(WorldGenerator.buildChunk('lay_world', [], 0, 0, context)).toEqual(plain);
  });

  it('opening a chest writes it down at the world\'s cycle, and a guard falling writes it down', () => {
    useWorldStore.setState({ chestRecord: emptyChestRecord(), activeWorldId: 'w1', generation: 4 } as never);
    useWorldStore.getState().reportChestLooted('ent_1_1_chest');
    useWorldStore.getState().reportFell('ent_1_1_guard0');
    useWorldStore.getState().reportFell('ent_1_1_m0');
    useWorldStore.getState().reportChestLooted('cache_ovf_1');
    const record = useWorldStore.getState().chestRecord!;
    expect(record.chests).toEqual({ ent_1_1_chest: { lootedAt: 4 } });
    expect(record.guards).toEqual({ ent_1_1_guard0: { fellAt: 4 } });
  });

  it('the record survives leaving the world', async () => {
    const record = ChestSystem.fell(looted('ent_1_1_chest', 2), 'ent_1_1_guard0', 2);
    await ChestStore.save('w2', record);
    expect(await ChestStore.load('w2')).toEqual(record);
    expect(await ChestStore.load('never_opened')).toEqual(emptyChestRecord());
  });

  it('a world that never turns keeps no record', () => {
    useWorldStore.setState({ chestRecord: null, activeWorldId: 'dev', generation: 0 } as never);
    useWorldStore.getState().reportChestLooted('ent_1_1_chest');
    expect(useWorldStore.getState().chestRecord).toBeNull();
    // 2026-11-10: the tutorial turns now, so the question is whether a world turns, not whether it is outside the gate's clock
    const store = readFileSync('src/entities/world/store.ts', 'utf8');
    expect(store).toMatch(/const keeps = WorldClock\.turns\(worldCard\)/);
    expect(store).toMatch(/keeps \? await ChestStore\.load\(worldCard\.id\)/);
  });

  it('a chest seen is marked for that character, as it was seen, and only a change writes', () => {
    const chest = box('ent_1_1_chest', { position: { x: 100, y: 200 } });
    const seen = ChestSystem.mark(player(), 'w1', chest);
    expect(seen.chestMarks!.w1.ent_1_1_chest).toEqual({ x: 100, y: 200, empty: false });
    expect(ChestSystem.mark(seen, 'w1', chest)).toBe(seen);
    const emptied = ChestSystem.mark(seen, 'w1', box('ent_1_1_chest', { position: { x: 100, y: 200 }, container: { looted: true } }));
    expect(emptied.chestMarks!.w1.ent_1_1_chest.empty).toBe(true);
    // Coming back to find it full is learned too
    expect(ChestSystem.mark(emptied, 'w1', chest).chestMarks!.w1.ent_1_1_chest.empty).toBe(false);
  });

  it('the mark shows beyond sight, and full and empty differ in shape', () => {
    const map = { seed: 's', sectors: {} } as any;
    const center = { x: 1000, z: 1000 };
    const draw = (marks: { x: number; y: number; empty: boolean }[]) => fieldMinimap({ map, center, seen: new Set(), things: [], exits: [], marks }).data;
    const none = draw([]);
    const full = draw([{ x: 1100, y: 1000, empty: false }]);
    const empty = draw([{ x: 1100, y: 1000, empty: true }]);
    const changed = (a: Uint8Array, b: Uint8Array) => a.reduce((n, v, i) => n + (v !== b[i] ? 1 : 0), 0);
    expect(changed(none, full)).toBeGreaterThan(changed(none, empty));
    expect(changed(none, empty)).toBeGreaterThan(0);
  });

  it('the field writes it, and recon says what you know', () => {
    const field = readFileSync('src/components/WorldCanvas.tsx', 'utf8');
    expect(field).toMatch(/ChestSystem\.mark\(seen, worldId, e\)/);
    expect(field).toMatch(/reportFell\(event\.entityId, event\.definitionId\)/);
    expect(readFileSync('src/entities/player/store.ts', 'utf8')).toMatch(/kind: 'CHEST_LOOTED', chestId: entity\.id/);
    expect(readFileSync('src/components/ReconView.tsx', 'utf8')).toMatch(/CHESTS YOU KNOW/);
  });
});


// =============================================================================
// The screens: levels and rank apart, in shapes that read without colour
// =============================================================================

describe('line 128: the sheet and the HUD show level and rank as two things', () => {
  const read = (path: string) => readFileSync(path, 'utf8');

  it('nothing on a screen derives the rank from experience', () => {
    for (const path of ['src/components/CharacterSheet.tsx', 'src/components/PlayerHub.tsx', 'src/components/WorldCanvas.tsx', 'src/components/TheWorking.tsx', 'App.tsx']) {
      expect(read(path), path).not.toMatch(/rankFromXp/);
    }
  });

  it('the sheet, the bank, the field HUD and the top bar each say LV beside the rank mark', () => {
    for (const path of ['src/components/CharacterSheet.tsx', 'src/components/PlayerHub.tsx', 'src/components/WorldCanvas.tsx', 'App.tsx']) {
      const src = read(path);
      expect(src, path).toMatch(/RankMark/);
      // Q28: the field HUD and the top bar say it through one line, levelLine
      expect(src, path).toMatch(/ProgressionSystem\.(levelOf|levelProgress)\(|levelLine\(player\)/);
      expect(src, path).toMatch(/LV |levelLine\(player\)/);
    }
  });

  it('no screen says a price the counter would not charge', () => {
    for (const path of ['src/components/PlayerHub.tsx', 'src/entities/hub/HubCanvas.tsx', 'src/entities/hub/store.ts']) {
      expect(read(path), path).not.toMatch(/value \|\| 1\) \* 0\.6/);
    }
    expect(read('src/entities/hub/HubCanvas.tsx')).not.toMatch(/Math\.ceil\(listing\.price\)/);
  });

  it('the sheet says what each attribute does', () => {
    expect(read('src/components/CharacterSheet.tsx')).toMatch(/StatSystem\.attributeWork\(/);
  });
});
