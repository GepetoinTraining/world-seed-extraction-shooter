/**
 * THE ATTRIBUTES PASS (D52, D83, D84): bars registered before the build.
 * Test lines:
 *   94  every attribute changes how a character plays, so two characters of
 *       different spreads play differently
 *   128 (the level half) gaining a skill takes about 2.5 times as long as it did,
 *       levels and rank are separate, levels reset at each rank, and stats stay
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const db = new Map<string, any>();
vi.mock('../src/entities/data/VectorStore', () => ({
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

import { IAttributes, IEquipmentState, IItem, IPlayer, ISkillProgress, Rarity, UniversalRank } from '../types';
import {
  LEVEL_GROWTH, LEVEL_KILLS, POINTS_PER_LEVEL, ProgressionSystem, RANK_ORDER, RANK_XP_THRESHOLDS, SKILL_TIME_FACTOR, XP_CONSTANTS
} from '../src/entities/player/systems/ProgressionSystem';
import { DEFAULT_ATTRIBUTES } from '../src/entities/player/types';
import { ARCHETYPES, usePlayerStore } from '../src/entities/player/store';
import { LoadoutSystem } from '../src/entities/player/systems/LoadoutSystem';
import { useIdentityStore } from '../src/entities/identity/store';
import { applyKillRewards } from '../src/entities/combat/killRewards';
import { ICombatEvent } from '../src/entities/combat/CombatSystems';
import { CombatMath } from '../src/entities/combat/CombatMath';
import { ATTRIBUTE_READERS, StatSystem } from '../src/logic/systems/StatSystem';
import { RestSystem } from '../src/logic/systems/RestSystem';
import { StudySystem } from '../src/logic/systems/StudySystem';
import { WeaveSystem } from '../src/logic/systems/WeaveSystem';
import { MASTERY_RUNGS, RUNG_XP, WebSystem } from '../src/logic/systems/WebSystem';
import { repairCost } from '../src/entities/hub/dialogue';
import { Rng } from '../src/logic/rng/DeterministicRNG';

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
    expect(ProgressionSystem.levelsEarned(player())).toBe(0);
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
    expect(player().attributePoints).toBe(POINTS_PER_LEVEL);
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
    const rewards = applyKillRewards(events);
    expect(rewards.xpGained).toBe(cost);
    expect(rewards.levelUp).toEqual({ from: 1, to: 2, points: POINTS_PER_LEVEL });
    expect(rewards).not.toHaveProperty('rankUp');
  });
});

describe('line 128: the rank is granted, levels reset, and stats stay (D83)', () => {
  it('nothing in the game grants a rank yet: the seam has no caller but the store', () => {
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.tsx?$/.test(name) && /grantRank\(/.test(readFileSync(path, 'utf8'))) hits.push(path.replace(/\\/g, '/'));
      }
    };
    walk('src');
    expect(hits.sort()).toEqual(['src/entities/player/store.ts', 'src/entities/player/systems/ProgressionSystem.ts']);
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
    expect(energy).toBeGreaterThan(StatSystem.maxEnergy(before.attributes, before.equipment));
    store().grantRank();
    const after = player();
    expect(after.baseAttributes).toEqual(before.baseAttributes);
    expect(after.attributes).toEqual(before.attributes);
    expect(after.attributePoints).toBe(before.attributePoints);
    expect(after.rankXp).toBe(before.rankXp);
    expect(StatSystem.maxEnergyOf(after)).toBe(energy);
    expect(StatSystem.maxHealth(after.attributes, after.equipment)).toBe(health);
    expect(ProgressionSystem.levelsEarned(after)).toBe(ProgressionSystem.levelsEarned(before));
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
    expect(moved.attributePoints).toBe(2 + POINTS_PER_LEVEL);
    expect(moved.rankXp).toBe(RANK_XP_THRESHOLDS[UniversalRank.E] + spare);
  });

  it('the ranks it walked count toward energy, as a new character\'s would', () => {
    const start = ProgressionSystem.migrate(old(0));
    const veteran = ProgressionSystem.migrate(old(RANK_XP_THRESHOLDS[UniversalRank.C]));
    expect(ProgressionSystem.levelsEarned(start)).toBe(0);
    expect(ProgressionSystem.levelsEarned(veteran)).toBeGreaterThan(0);
    expect(StatSystem.maxEnergyOf(veteran)).toBeGreaterThan(StatSystem.maxEnergyOf(start));
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

describe('energy grows with level and a stat', () => {
  it('a new character reads what the game read before', () => {
    expect(StatSystem.maxEnergy(spread())).toBe(50 + 5);
    expect(StatSystem.maxEnergy(spread({ endurance: 4 }))).toBe(50 + 20);
  });

  it('levels alone raise it, endurance alone raises it, and together they raise it more than either', () => {
    const base = StatSystem.maxEnergy(spread());
    const leveled = StatSystem.maxEnergy(spread(), undefined, 30);
    const trained = StatSystem.maxEnergy(spread({ endurance: 30 }));
    const both = StatSystem.maxEnergy(spread({ endurance: 30 }), undefined, 30);
    expect(leveled).toBeGreaterThan(base);
    expect(trained).toBeGreaterThan(base);
    expect(both - base).toBeGreaterThan((leveled - base) + (trained - base));
  });

  it('a character trained for energy holds a long run, and rests the long rest it spent', () => {
    const trained = { ...player(), attributes: spread({ endurance: 30 }), levelsBanked: 30 };
    const full = StatSystem.maxEnergyOf(trained);
    expect(full).toBeGreaterThanOrEqual(500);
    const spent = { ...trained, energyToday: full - 500 };
    const hours = RestSystem.restMs(spent) / 3_600_000;
    expect(hours).toBeGreaterThan(7.5);
    expect(hours).toBeLessThan(8.5);
    // The same level and no training is a short day: a different character
    const unfocused = { ...trained, attributes: spread() };
    expect(StatSystem.maxEnergyOf(unfocused)).toBeLessThan(full / 3);
  });

  it('every reader of a character\'s energy goes through its levels', () => {
    const walk = (dir: string, out: string[] = []): string[] => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path, out);
        else if (/\.tsx?$/.test(name)) out.push(path);
      }
      return out;
    };
    const bare = walk('src').filter(path => !path.replace(/\\/g, '/').endsWith('logic/systems/StatSystem.ts') && /maxEnergy\(/.test(readFileSync(path, 'utf8')));
    expect(bare).toEqual([]);
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
    expect(StatSystem.levyRate(0.05, floor)).toBe(0.05);
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

  it('subterfuge: quieter in the field, and less of the haul is declared at the gate', () => {
    expect(StatSystem.noiseReduction(undefined, raised('subterfuge'))).toBeGreaterThan(0);
    expect(StatSystem.levyRate(0.05, raised('subterfuge'))).toBeLessThan(0.05);
    expect(StatSystem.levyRate(0.05, spread({ subterfuge: 1_000_000 }))).toBeGreaterThan(0);
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
      expect(src, path).toMatch(/ProgressionSystem\.(levelOf|levelProgress)\(/);
      expect(src, path).toMatch(/LV /);
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
