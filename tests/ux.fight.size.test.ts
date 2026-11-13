/**
 * HOW A BLOW READS ON THE FIELD, part 1: the rule that turns a blow into a drawn size (the UX pass, ux-fight). Bars set before the build.
 *
 * Put to Pedro, 2026-11-12: "A number over each blow, given and taken, and a fight log that stays."
 * His answer: "might be not fluid enough in our animation style, maybe the size of the proj?"
 *
 * Read as: no number over a blow. The drawn size of a shot says the blow it carries, as it was let go, before armour,
 * in steps that double; past the size that stays fair to dodge, a count of marks carries the rest, so no two blows a
 * doubling apart look the same. One scale for a person's shots and a creature's; a creature's shot told from the
 * person's by shape (whole against broken), never by hue alone (Pedro is colourblind). A swing's ground and a hit's
 * brackets weigh by the same steps, and the pips are checked for what they can tell. The rule is `src/render/BlowMarks.ts`.
 */

import { describe, it, expect } from 'vitest';
import {
  yardstick, blowStep, shotSide, shotBeyond, shotMarks, markWeight, swingFill, tickRing, trailDots, pipsLeft,
  SHOT_LEAST_ATOMS, SHOT_MOST_ATOMS, SHOT_PLAIN_ATOMS, PIPS, AtomRect
} from '../src/render/BlowMarks';
import { PLAIN_BLOW_PER_S, bodyScale, creatureNumbers } from '../shared/logic/theme/ThemeFormula';

/** Every atom a set of rects covers, as "x,y". */
const cells = (rects: AtomRect[]): Set<string> => {
  const out = new Set<string>();
  for (const r of rects) for (let i = 0; i < r.w; i++) for (const j of Array.from({ length: r.h }, (_, k) => k)) out.add(`${r.x + i},${r.y + j}`);
  return out;
};
const box = (rects: AtomRect[]) => ({
  x0: Math.min(...rects.map(r => r.x)), y0: Math.min(...rects.map(r => r.y)),
  x1: Math.max(...rects.map(r => r.x + r.w)), y1: Math.max(...rects.map(r => r.y + r.h))
});
const RANKS = ['F', 'E', 'D', 'C', 'B', 'A', 'S', 'SS', 'SSS'];

describe("a shot's drawn size says its blow, as it was let go, in steps that double", () => {
  it('a blow is measured against a plain blow at the rank of the person looking, and a plain blow is step 0 at every rank', () => {
    for (const rank of RANKS) {
      expect(yardstick(rank)).toBe(PLAIN_BLOW_PER_S * bodyScale(rank));
      expect(blowStep(yardstick(rank), rank)).toBe(0);
      expect(blowStep(yardstick(rank) * 2, rank)).toBe(1);
      expect(blowStep(yardstick(rank) * 2 - 0.01, rank)).toBe(0);
      expect(blowStep(yardstick(rank) / 2, rank)).toBe(-1);
    }
    // F: a bare hand (5), a plain weapon (10), a bow's blow (11), a crit off it (22), a gigantic leader's blow (74)
    expect([5, 10, 11, 22, 74].map(b => blowStep(b, 'F'))).toEqual([-1, 0, 0, 1, 2]);
  });

  it('each doubling is one step, every time, with no end either way; a blow under the least that lands reads as one', () => {
    for (let k = -3; k <= 30; k++) expect(blowStep(10 * Math.pow(2, k), 'F')).toBe(k);
    // Far under: a person of rank SSS (a plain blow of 2560) sees a blow of 1.25 eleven halvings down
    for (let k = -11; k <= 20; k++) expect(blowStep(2560 * Math.pow(2, k), 'SSS')).toBe(k);
    expect(blowStep(0, 'F')).toBe(blowStep(1, 'F'));
    expect(blowStep(-3, 'F')).toBe(blowStep(1, 'F'));
  });

  it('the size steps one atom a doubling, from the least to the most that stays fair to dodge', () => {
    expect([SHOT_LEAST_ATOMS, SHOT_PLAIN_ATOMS, SHOT_MOST_ATOMS]).toEqual([3, 4, 8]);
    for (let step = -1; step <= 4; step++) expect(shotSide(step)).toBe(SHOT_PLAIN_ATOMS + step);
    expect(shotSide(-9)).toBe(SHOT_LEAST_ATOMS);
    expect(shotSide(40)).toBe(SHOT_MOST_ATOMS);
    // The most is still under a person: 16 px against the 15 px a shot must pass within to land on one
    expect(SHOT_MOST_ATOMS * 2).toBeLessThanOrEqual(16);
  });

  it('past the most, each further doubling adds a tick around the shot; past the least, each further halving a dot behind it', () => {
    expect(shotBeyond(4)).toEqual({ over: 0, under: 0 });
    expect(shotBeyond(-1)).toEqual({ over: 0, under: 0 });
    for (let k = 1; k <= 30; k++) {
      expect(shotBeyond(4 + k)).toEqual({ over: k, under: 0 });
      expect(shotBeyond(-1 - k)).toEqual({ over: 0, under: k });
    }
  });

  it('no two steps draw the same shot, a person\'s or a creature\'s, from far below the least to far above the most', () => {
    for (const hostile of [false, true]) {
      const seen = new Map<string, number>();
      for (let step = -20; step <= 40; step++) {
        const key = [...cells(shotMarks(step, hostile, 0.7))].sort().join(' ');
        expect(seen.has(key), `step ${step} draws as step ${seen.get(key)}`).toBe(false);
        seen.set(key, step);
      }
    }
  });

  it('ticks ring the shot in rings of eight, each ring further out, and never touch it or each other', () => {
    for (let count = 1; count <= 40; count++) {
      const core = { lo: -2, hi: 1 };
      const ticks = tickRing(count, core);
      expect(ticks.length).toBe(count);
      const at = ticks.map(t => `${t.x},${t.y}`);
      expect(new Set(at).size).toBe(count);
      for (const t of ticks) expect(t.x < core.lo - 1 || t.x > core.hi + 1 || t.y < core.lo - 1 || t.y > core.hi + 1).toBe(true);
    }
    // The first four stand above, below, right and left: one tick reads as one
    expect(tickRing(4, { lo: -1, hi: 1 }).map(t => [Math.sign(t.x), Math.sign(t.y)])).toEqual([[0, -1], [0, 1], [1, 0], [-1, 0]]);
  });

  it('dots behind lie behind the shot along its flight, apart from it and from each other, whichever way it flies', () => {
    for (const angle of [0, 0.4, Math.PI / 4, 1.9, Math.PI, -2.6, -Math.PI / 2]) {
      for (const n of [3, 8]) {
        const lo = -Math.floor(n / 2), hi = lo + n - 1;
        const dots = trailDots(5, { lo, hi }, angle);
        expect(dots.length).toBe(5);
        expect(new Set(dots.map(d => `${d.x},${d.y}`)).size).toBe(5);
        const c = (lo + hi) / 2;
        for (const d of dots) {
          expect((d.x - c) * Math.cos(angle) + (d.y - c) * Math.sin(angle)).toBeLessThan(0);
          expect(d.x < lo || d.x > hi || d.y < lo || d.y > hi).toBe(true);
        }
      }
    }
  });
});

describe("one scale for a person's shots and a creature's, told apart by shape", () => {
  it('the same blow draws the same size whoever let it go', () => {
    for (let step = -6; step <= 12; step++) {
      const own = shotMarks(step, false, 1.1), theirs = shotMarks(step, true, 1.1);
      expect(box(theirs)).toEqual(box(own));
    }
  });

  it("a person's shot is whole; a creature's is broken, its corners and its middle empty, as its wind-up's edge is", () => {
    for (let step = -3; step <= 9; step++) {
      const n = shotSide(step);
      const lo = -Math.floor(n / 2), hi = lo + n - 1;
      const inCore = (s: string) => { const [x, y] = s.split(',').map(Number); return x >= lo && x <= hi && y >= lo && y <= hi; };
      const own = [...cells(shotMarks(step, false, 0))].filter(inCore);
      const theirs = [...cells(shotMarks(step, true, 0))].filter(inCore);
      expect(own.length).toBe(n * n);
      expect(theirs.length).toBe(4 * (n - 2));
      for (const corner of [`${lo},${lo}`, `${hi},${lo}`, `${lo},${hi}`, `${hi},${hi}`]) expect(theirs).not.toContain(corner);
      const mid = Math.round((lo + hi) / 2) + 0;
      expect(theirs).not.toContain(`${mid},${mid}`);
    }
  });

  it('the shot is drawn about where it is: its core spans the point on both sides', () => {
    for (let step = -2; step <= 6; step++) {
      const b = box(shotMarks(step, false, 0).slice(0, 1));
      expect(b.x0).toBeLessThan(0);
      expect(b.x1).toBeGreaterThan(0);
      expect(b.x1 + b.x0).toBeGreaterThanOrEqual(0);
      expect(b.x1 + b.x0).toBeLessThanOrEqual(1);
    }
  });

});

describe("a swing's ground and a hit's brackets weigh by the same steps", () => {
  it('heavier marks a step, from the least to the most; past the most a count of dots, past the least the ground thins', () => {
    expect(markWeight(-1)).toEqual({ atoms: 1, over: 0, under: 0 });
    expect(markWeight(0)).toEqual({ atoms: 2, over: 0, under: 0 });
    expect(markWeight(1)).toEqual({ atoms: 3, over: 0, under: 0 });
    expect(markWeight(2)).toEqual({ atoms: 4, over: 0, under: 0 });
    for (let k = 1; k <= 20; k++) {
      expect(markWeight(2 + k)).toEqual({ atoms: 4, over: k, under: 0 });
      expect(markWeight(-1 - k)).toEqual({ atoms: 1, over: 0, under: k });
    }
  });

  it('a swing\'s fill marks never run into each other, and a lighter blow keeps fewer of them', () => {
    for (let step = -6; step <= 8; step++) {
      const f = swingFill(step);
      expect(f.atoms * 2).toBeLessThan(f.spacingPx);
      expect(f.keepEvery).toBe(markWeight(step).under + 1);
    }
    expect(swingFill(-1).keepEvery).toBe(1);
    expect(swingFill(-3).keepEvery).toBe(3);
  });

});

describe('what landed is read on the body', () => {
  it('the pips are the field\'s own rule: five, stepped, never fewer than one while it stands', () => {
    expect(PIPS).toBe(5);
    expect(pipsLeft(25, 25)).toBeNull();
    expect(pipsLeft(0, 25)).toBeNull();
    expect(pipsLeft(1, 1000)).toBe(1);
    expect(pipsLeft(20, 25)).toBe(4);
  });

  it('on a body of the person\'s own size and rank the pips tell a small hit from a large one; on a gigantic one they cannot', () => {
    const plain = creatureNumbers({ rank: 'F', build: 'sturdy', threat: 'sharp', pace: 'steady', size: 'MEDIUM' }).baseHealth;
    const lost = (max: number, blow: number) => PIPS - (pipsLeft(max - blow, max) ?? 0);
    // A bare hand (5) and a plain blow (10) on a plain creature of rank F (25): one pip and two
    expect(lost(plain, 5)).toBeLessThan(lost(plain, 10));
    // A gigantic body of the same rank holds 200: a bare hand, a plain blow and one twice that take none
    const gigantic = creatureNumbers({ rank: 'F', build: 'sturdy', threat: 'sharp', pace: 'steady', size: 'GIGANTIC' }).baseHealth;
    expect([5, 10, 20].map(b => lost(gigantic, b))).toEqual([0, 0, 0]);
    // So the hit's own brackets carry it: each of those three weighs apart
    const weights = [5, 10, 20].map(b => markWeight(blowStep(b, 'F')).atoms);
    expect(new Set(weights).size).toBe(3);
  });
});
