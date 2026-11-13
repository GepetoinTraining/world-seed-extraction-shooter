/**
 * HOW A BLOW IS DRAWN BY ITS WEIGHT (the UX pass, ux-fight). Pedro, 2026-11-12, asked whether a number over each
 * blow would do: "might be not fluid enough in our animation style, maybe the size of the proj?" So no number is
 * drawn over a blow. A shot is drawn as large as the blow it carries, as it was let go and before armour, and a
 * swing's ground and a hit's brackets are drawn as heavy.
 *
 * The rule, in one place:
 * - A blow is measured against a plain blow at the rank of the person looking: what a plain weapon deals in a blow
 *   at one blow a second (`yardstick`, 10 at F, doubled a rank). Its step is how many times it doubles that, or
 *   halves it (`blowStep`): stepped, never eased, as the house's meters are, so a step is read and not guessed.
 *   One scale for everyone: a creature's shot and a person's are measured against the same yardstick in the same
 *   frame, so the one can be weighed against the other by eye.
 * - A shot's side grows an atom a step, from 3 atoms (6 px, half a plain blow) through 4 (8 px, a plain blow) to
 *   8 (16 px, sixteen plain blows). 16 px is the most that stays fair to dodge: a person is struck by a shot that
 *   passes within 15 px of their middle, so a larger shot would be drawn over ground it does not strike.
 * - Past the most, each further doubling adds one tick around the shot: four (above, below, right, left), then
 *   the four corners, then a second ring of eight two atoms further out, and so on with no end. Past the least,
 *   each further halving adds one dot behind the shot along its flight. So no two blows a doubling apart are ever
 *   drawn alike, at either end.
 * - A person's shot is whole; a creature's is broken, its corners and its middle empty: the grammar of the
 *   wind-ups, where a person's own is whole and a creature's edge broken. The colour roles stay as a second cue.
 * - A swing's fill marks and a hit's brackets are 1 to 4 atoms heavy for steps -1 to 2 (`markWeight`); past 2 a
 *   count of dots, past -1 the swing's ground thins, one mark kept in two, then in three.
 *
 * Only the drawing reads this. What a shot or a swing strikes is decided where it always was (`CombatSystem`,
 * `WorldCanvas`), and nothing here is read by them.
 */

import { PLAIN_BLOW_PER_S, bodyScale } from '../../shared/logic/theme/ThemeFormula';

/** An area of whole atoms, from the point a thing is drawn at: x and y are atom indices, the atom at 0 lying just right of and below the point. */
export interface AtomRect { x: number; y: number; w: number; h: number }

/** A shot's side in atoms: the least, a plain blow's, and the most that stays fair to dodge. */
export const SHOT_LEAST_ATOMS = 3;
export const SHOT_PLAIN_ATOMS = 4;
export const SHOT_MOST_ATOMS = 8;
/** A hurt creature's row of pips. */
export const PIPS = 5;

/** What a blow is measured against: a plain weapon's blow at one blow a second, at the rank of the person looking. */
export const yardstick = (rank: string): number => PLAIN_BLOW_PER_S * bodyScale(rank);

/** How many times a blow doubles the yardstick (negative: halves it). A blow under 1, the least that ever lands, reads as 1. */
export const blowStep = (blow: number, rank: string): number => {
  const b = Number.isFinite(blow) && blow >= 1 ? blow : 1;
  // A hair over, so a blow of exactly twice the yardstick is a whole step and not one short of it
  return Math.floor(Math.log2(b / yardstick(rank)) + 1e-9);
};

/** A shot's side in atoms at a step. */
export const shotSide = (step: number): number =>
  Math.max(SHOT_LEAST_ATOMS, Math.min(SHOT_MOST_ATOMS, SHOT_PLAIN_ATOMS + step));

/** The steps a shot's size cannot show: past the most (ticks around it) and past the least (dots behind it). */
export const shotBeyond = (step: number): { over: number; under: number } => ({
  over: Math.max(0, step - (SHOT_MOST_ATOMS - SHOT_PLAIN_ATOMS)),
  under: Math.max(0, (SHOT_LEAST_ATOMS - SHOT_PLAIN_ATOMS) - step)
});

/** The span of a square core of `n` atoms about the point, in atom indices. */
const coreOf = (n: number) => { const lo = -Math.floor(n / 2); return { lo, hi: lo + n - 1 }; };
const one = (x: number, y: number): AtomRect => ({ x, y, w: 1, h: 1 });

/**
 * `count` ticks of one atom around a core, in rings of eight with a gap of one atom between the core and the first
 * ring and between rings: above, below, right, left, then the corners. Never touching the core or each other.
 */
export const tickRing = (count: number, core: { lo: number; hi: number }): AtomRect[] => {
  const out: AtomRect[] = [];
  const mid = Math.round((core.lo + core.hi) / 2) + 0;
  for (let ring = 0; out.length < count; ring++) {
    const near = core.lo - 2 - 2 * ring, far = core.hi + 2 + 2 * ring;
    const spots: [number, number][] = [[mid, near], [mid, far], [far, mid], [near, mid], [far, near], [near, far], [near, near], [far, far]];
    for (const [x, y] of spots) { if (out.length >= count) break; out.push(one(x, y)); }
  }
  return out;
};

/** `count` dots of one atom behind a core along a flight at `angle`, two atoms apart, the first two atoms clear of it. */
export const trailDots = (count: number, core: { lo: number; hi: number }, angle: number): AtomRect[] => {
  const c = (core.lo + core.hi) / 2, half = (core.hi - core.lo) / 2;
  const bx = -Math.cos(angle), by = -Math.sin(angle);
  // Stepped by the larger of the two axes, so every dot clears the square core whichever way it flies
  const norm = Math.max(Math.abs(bx), Math.abs(by)) || 1;
  const out: AtomRect[] = [];
  for (let k = 0; k < count; k++) {
    const d = (half + 2 + 2 * k) / norm;
    out.push(one(Math.round(c + bx * d) + 0, Math.round(c + by * d) + 0));
  }
  return out;
};

/**
 * A shot's marks, in atoms about its point. The core first: whole for a person's shot, broken for a creature's
 * (its edge with the corners knocked out, its middle empty); then any ticks or dots its step needs.
 */
export const shotMarks = (step: number, hostile: boolean, angle: number): AtomRect[] => {
  const n = shotSide(step);
  const core = coreOf(n);
  const { lo, hi } = core;
  const body: AtomRect[] = hostile
    ? [{ x: lo + 1, y: lo, w: n - 2, h: 1 }, { x: lo + 1, y: hi, w: n - 2, h: 1 }, { x: lo, y: lo + 1, w: 1, h: n - 2 }, { x: hi, y: lo + 1, w: 1, h: n - 2 }]
    : [{ x: lo, y: lo, w: n, h: n }];
  const { over, under } = shotBeyond(step);
  return [...body, ...tickRing(over, core), ...trailDots(under, core, angle)];
};

/** How heavy a swing's fill marks and a hit's brackets are at a step: 1 to 4 atoms, and what lies past either end. */
export const markWeight = (step: number): { atoms: number; over: number; under: number } => ({
  atoms: Math.max(1, Math.min(4, 2 + step)),
  over: Math.max(0, step - 2),
  under: Math.max(0, -1 - step)
});

/** A swing's fill: its marks' size, how far apart they stand (always clear of each other), and one kept in how many. */
export const SWING_FILL_SPACING_PX = 10;
export const swingFill = (step: number): { atoms: number; spacingPx: number; keepEvery: number } => {
  const w = markWeight(step);
  return { atoms: w.atoms, spacingPx: SWING_FILL_SPACING_PX, keepEvery: w.under + 1 };
};

/** A hurt creature's pips: how many of five are left, never fewer than one while it stands. None drawn at full or when it is down. */
export const pipsLeft = (health: number, max: number): number | null => {
  if (max <= 0 || health >= max || health <= 0) return null;
  return Math.max(1, Math.ceil((health / max) * PIPS));
};
