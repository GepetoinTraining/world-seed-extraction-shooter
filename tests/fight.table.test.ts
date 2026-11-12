/**
 * THE FIGHT'S TABLE (the fight's rebalance, part 3), from the code's own readers. Every number a body brings is read
 * from the game: health (`StatSystem.maxHealth` at its rank), a blow (`CombatMath.baseHit`, its crits and glances),
 * what a blow leaves against the striker's rank (dodge, block, intimidation, protection), the hand's cycle and its
 * wind-up and the pace kept through it (`FieldInput`), the walk (`LoadoutSystem`), a shape's reach and hole, a shot's
 * flight, and a hit felt (`feltHit`). The field is one line, open both ways, the two starting fifteen tiles apart:
 * an approacher walks in and swings from its own reach; a shooter stands to draw and steps back between draws while
 * the other is within eight tiles; the second notices the first a quarter of a second late. It is a model of the field,
 * not the field: nobody sidesteps a shot on a line, and nobody tires. The table is printed for the builders' log; the bars hold only what the spine promises.
 */

import { describe, it, expect } from 'vitest';
import { IAttributes, IEquipmentState, IItem, MENTAL_ATTRIBUTES, PHYSICAL_ATTRIBUTES, UniversalRank } from '../shared/types';
import { FIRST_THEME_PACK, installShippedThemes } from '../shared/logic/theme/boot';
import { ContentRegistry } from '../shared/logic/theme/ContentRegistry';
import { ItemFactory } from '../shared/entities/item/ItemFactory';
import { Rng } from '../shared/logic/rng/DeterministicRNG';
import { StatSystem } from '../shared/logic/systems/StatSystem';
import { LoadoutSystem } from '../shared/entities/player/systems/LoadoutSystem';
import { CombatMath } from '../src/entities/combat/CombatMath';
import { cycleMs, windupOf } from '../src/logic/systems/FieldInput';
import {
  SHOT_SPEED_PX, SHOT_FLIGHT_S, SHOT_WEIGHT, blowWeight, bodyPoise, feltHit, creatureNumbers, CREATURE_COOLDOWN_MS, CREATURE_WINDUP_MS, leaderNumbers
} from '../shared/logic/theme/ThemeFormula';
import { TILE_PX } from '../shared/entities/world/grid';

installShippedThemes();
const compiled = ContentRegistry.compiled(FIRST_THEME_PACK.themeId)!;
const gearDef = (name: string) => [...Object.values(compiled.items).flat(), ...compiled.craftedGear].find((d: any) => d.universal_name === name) as any;
const STEP: Record<string, number> = { F: 0, C: 3, S: 6 };
const RANKS = ['F', 'C', 'S'];
const floor = (rank: string): IAttributes =>
  Object.fromEntries([...PHYSICAL_ATTRIBUTES, ...MENTAL_ATTRIBUTES].map(a => [a, 1 + STEP[rank]])) as unknown as IAttributes;
const piece = (name: string, rank: string, slot: string): [string, IItem] =>
  [slot, ItemFactory.createFromTemplate(gearDef(name), true, Rng.fromKey(`table:${name}:${rank}`), undefined, rank as UniversalRank, { quality: 0, depth: 0 })];
const wear = (pieces: [string, IItem][]): IEquipmentState =>
  ({ slots: Object.fromEntries(pieces.map(([slot, it]) => [slot, it.id])), items: pieces.map(p => p[1]), frames: {}, protected: [] }) as unknown as IEquipmentState;

type Hand = 'ranged' | 'melee' | 'speed';
/** Each hand's plain kit of its rank: what it holds, and what its side wears. */
const KITS: Record<Hand, (r: string) => [string, IItem][]> = {
  ranged: r => [piece('Steel-Rule Bow', r, 'RIGHT_HAND'), piece('Pressed Trousers', r, 'LEGS'), piece('Worn Oxfords', r, 'BOOTS')],
  melee: r => [piece('Oversized Gavel', r, 'RIGHT_HAND'), piece('Reinforced Waistcoat', r, 'CHEST'), piece('Pressed Trousers', r, 'LEGS')],
  speed: r => [piece('Letter Opener', r, 'RIGHT_HAND'), piece('Pressed Trousers', r, 'LEGS'), piece('Worn Oxfords', r, 'BOOTS')]
};

interface IFighter {
  name: string; rank: string; health: number; max: number; walk: number; x: number;
  hit: number; leaves: (rank: string) => number; cycle: number; windup: { ms: number; pace: number; kind: 'draw' | 'swing' };
  reach: number; inner: number; weight: number; shoots: boolean; poise: number;
  readyAt: number; winding?: { until: number }; staggerUntil: number; stagger: number;
}

const person = (hand: Hand, rank: string, x: number, bare = false): IFighter => {
  const attrs = floor(rank);
  const pieces = KITS[hand](rank).filter(([slot]) => !bare || slot === 'RIGHT_HAND');
  const eq = wear(pieces);
  const weapon = pieces[0][1];
  const base = CombatMath.baseHit(weapon, eq, attrs, 0, rank);
  const c = Math.min(1, StatSystem.critChance(eq, attrs)), g = CombatMath.glanceChance(eq, attrs, rank);
  const shape = CombatMath.strikeOf(weapon);
  const shoots = !CombatMath.isMelee(weapon);
  return {
    name: hand, rank, health: StatSystem.maxHealth(attrs, eq, rank), max: StatSystem.maxHealth(attrs, eq, rank),
    walk: LoadoutSystem.walkTilesPerSecond(eq, attrs) * TILE_PX, x,
    hit: c * base * CombatMath.critMultiplier(eq) + (1 - c) * (g * base * CombatMath.glanceFactor() + (1 - g) * base),
    leaves: (against: string) => (1 - CombatMath.dodgeChance(eq, attrs, against)) * (1 - CombatMath.blockChance(eq) * (1 - CombatMath.blockFactor()))
      * StatSystem.blowFactor(attrs) * (1 - CombatMath.mitigationOf(eq, against)),
    cycle: cycleMs(weapon, eq, attrs), windup: windupOf(weapon, eq, attrs),
    reach: shoots ? SHOT_SPEED_PX * SHOT_FLIGHT_S : shape.reachPx, inner: shoots ? 0 : shape.innerPx,
    weight: shoots ? SHOT_WEIGHT : blowWeight(shape), shoots, poise: bodyPoise('MEDIUM'),
    readyAt: 0, staggerUntil: 0, stagger: 0
  };
};

const BODY_PX = 10;
const DT = 10;

/** One fight on the line, to a fall or two minutes. */
const duel = (a: IFighter, b: IFighter) => {
  const shots: { from: IFighter; to: IFighter; x: number; dir: number; left: number }[] = [];
  const land = (from: IFighter, to: IFighter, t: number) => {
    to.health -= from.hit * to.leaves(from.rank);
    const f = feltHit(from.weight, to.poise);
    to.x += Math.sign(to.x - from.x || 1) * f.pushPx;
    to.stagger = f.share; to.staggerUntil = t + f.pause.durationMs;
    if (f.breaks && to.winding && to.windup.pace === 0) { to.winding = undefined; }
  };
  for (let t = 0; t < 120_000; t += DT) {
    for (const [me, foe] of [[a, b], [b, a]] as const) {
      const d = Math.abs(foe.x - me.x);
      const toward = Math.sign(foe.x - me.x);
      if (me.winding && t >= me.winding.until) {
        me.winding = undefined;
        if (me.shoots) shots.push({ from: me, to: foe, x: me.x, dir: toward, left: me.reach });
        else if (d - BODY_PX <= me.reach && d + BODY_PX >= me.inner) land(me, foe, t);
      }
      if (!me.winding && t >= me.readyAt && d - BODY_PX <= me.reach && (me.shoots || d + BODY_PX >= me.inner)) {
        me.winding = { until: t + me.windup.ms };
        me.readyAt = t + me.cycle;
      }
      const pace = (me.winding ? me.windup.pace : 1) * (t < me.staggerUntil ? 1 - me.stagger : 1) * me.walk * DT / 1000;
      if (me.shoots) {
        if (!me.winding && d < 8 * TILE_PX && !foe.shoots) me.x -= toward * pace;
        // Pushed out of its own reach, a shooter steps back in
        else if (!me.winding && d - BODY_PX > me.reach - TILE_PX) me.x += toward * pace;
      } else if (d > Math.max(me.inner + BODY_PX, me.reach * 0.8)) me.x += toward * pace;
      else if (d < me.inner) me.x -= toward * pace;
    }
    for (const s of [...shots]) {
      const step = SHOT_SPEED_PX * DT / 1000;
      s.x += s.dir * step; s.left -= step;
      if (Math.abs(s.to.x - s.x) <= BODY_PX + 5) { land(s.from, s.to, t); shots.splice(shots.indexOf(s), 1); }
      else if (s.left <= 0) shots.splice(shots.indexOf(s), 1);
    }
    if (a.health <= 0 || b.health <= 0) {
      const winner = a.health > 0 ? a : b.health > 0 ? b : null;
      return { winner: winner?.name ?? 'both', seconds: t / 1000, kept: winner ? Math.max(0, winner.health) / winner.max : 0 };
    }
  }
  if (process.env.TABLE_DEBUG) console.log(`[DEBUG] ${a.name} ${a.health.toFixed(0)} at ${a.x.toFixed(0)}; ${b.name} ${b.health.toFixed(0)} at ${b.x.toFixed(0)}; shots ${shots.length}`);
  return { winner: 'neither', seconds: 120, kept: 0 };
};

const pct = (x: number) => `${Math.round(x * 100)}%`;

describe('the fight\'s table, from the code\'s own readers', () => {
  const rows: string[] = [];
  const pairs: [Hand, Hand][] = [['ranged', 'melee'], ['speed', 'ranged'], ['melee', 'speed'], ['ranged', 'ranged'], ['melee', 'melee'], ['speed', 'speed']];
  const results: Record<string, ReturnType<typeof duel>> = {};
  for (const r of RANKS) for (const [x, y] of pairs) {
    // The second notices the first a quarter of a second late: who sees first is part of a meeting, and two equals in
    // lockstep would break each other's every draw for ever
    const res = duel(person(x, r, 0), { ...person(y, r, 15 * TILE_PX), name: x === y ? `${y} (second)` : y, readyAt: 250 });
    results[`${r}:${x}:${y}`] = res;
    rows.push(`| ${r} | ${x} against ${y} | ${res.winner} | ${res.seconds.toFixed(1)} s | ${pct(res.kept)} |`);
  }

  it('every meeting of equals ends, and two equals of one hand fall in about ten seconds', () => {
    for (const res of Object.values(results)) expect(res.winner).not.toBe('neither');
    for (const r of RANKS) for (const h of ['ranged', 'melee', 'speed'] as Hand[]) {
      const res = results[`${r}:${h}:${h}`];
      expect(res.seconds, `${r} ${h}`).toBeGreaterThan(4);
      expect(res.seconds, `${r} ${h}`).toBeLessThan(25);
    }
  });

  it('a person against a plain creature, a pack of three, and a boss up close, before armour and after', () => {
    const lines: string[] = [];
    for (const r of RANKS) {
      const plain = creatureNumbers({ rank: r as never, build: 'sturdy', threat: 'sharp', pace: 'steady', size: 'MEDIUM' });
      const boss = { health: plain.baseHealth + leaderNumbers({ ...plain, rank: r as never }, { constitution: 1 + STEP[r], strength: 1 + STEP[r] }).bonusHealth, blow: Math.round(plain.baseDamage * 1.5) };
      const cycleS = (CREATURE_COOLDOWN_MS + CREATURE_WINDUP_MS) / 1000;
      for (const bare of [true, false]) {
        const p = person('melee', r, 0, bare);
        const perSecond = p.hit * 1000 / p.cycle;
        const kill = (health: number) => Math.ceil(health / p.hit) * p.cycle / 1000;
        const taken = (blow: number) => blow * p.leaves(r) / cycleS;
        const one = kill(plain.baseHealth);
        // A pack of three met at once, felled one at a time: the first stands one kill, the second two, the third three
        const pack = one * 6 * taken(plain.baseDamage);
        const bossBlow = boss.blow * p.leaves(r) / p.max;
        lines.push(`| ${r} | ${bare ? 'before armour' : 'gavel, chest and legs'} | ${p.max} | ${perSecond.toFixed(0)} a second | ${one.toFixed(1)} s, ${pct(one * taken(plain.baseDamage) / p.max)} of you | ${(one * 3).toFixed(1)} s, ${pct(pack / p.max)} of you | ${pct(bossBlow)} of you a blow; ${(kill(boss.health)).toFixed(1)} s to fell, ${pct(kill(boss.health) * taken(boss.blow) / p.max)} of you |`);
        expect(pack).toBeGreaterThan(0);
      }
    }
    // A boss's blow up close, by the size of the body it is: what one blow takes of a person of its rank, before armour and after
    const sizes = ['MEDIUM', 'LARGE', 'GIGANTIC', 'COLOSSAL'] as const;
    const bossLines = RANKS.map(r => {
      const bare = person('melee', r, 0, true), dressed = person('melee', r, 0);
      const cells = sizes.map(size => {
        const blow = Math.round(creatureNumbers({ rank: r as never, build: 'sturdy', threat: 'sharp', pace: 'steady', size }).baseDamage * 1.5);
        return `${pct(blow * bare.leaves(r) / bare.max)} / ${pct(blow * dressed.leaves(r) / dressed.max)}`;
      });
      return `| ${r} | ${cells.join(' | ')} |`;
    });
    console.log(`[TABLE] a boss's blow, before armour / with the gavel's chest and legs\n| Rank | ${sizes.join(' | ')} |\n|---|---|---|---|---|\n${bossLines.join('\n')}`);
    console.log(`[TABLE] equals\n| Rank | Meeting | Wins | In | Kept |\n|---|---|---|---|---|\n${rows.join('\n')}`);
    console.log(`[TABLE] creatures\n| Rank | The person | Health | Deals | A plain creature | A pack of three | A boss up close |\n|---|---|---|---|---|---|---|\n${lines.join('\n')}`);
  });
});
