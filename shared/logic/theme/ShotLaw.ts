/**
 * SHOTS READ OFF WHAT FIRES THEM. Pedro, 2026-11-18, after a dive played unarmed read as "standing and trading
 * blows": "the fighting needs the ... the ships... you know the old arcade game where each little thing you grab
 * changes the bullets slightly? OUR bullets need to be that granular, on a tensor, meaning we don't choose, slight
 * vairantions change them between the same weapon rolled twice".
 *
 * Read as (every reading here is the builder's, and his to strike; `BALANCE_RUN.md` 2.13 lists them):
 *
 *   A volley is a point in a space of ten small measures (`IShotShape`, in the formula). A kind keeps a middle
 *   there, the point its volley word names (`volleyShape`). What moves a piece off its kind's middle is the piece
 *   itself, and nothing else: each thing it carries is one push, a direction in that space times a size.
 *
 *     the kind's own words   each tag it is written with pushes a little, the same for every piece of the kind
 *     its one roll           quality turns every measure, each on a wave of its own length, so two rolls a hair
 *                            apart fly alike, two far apart do not, and no roll flies better than another
 *     each line it holds     every affix line pushes by its size in rulers: a minor line half of what a moderate
 *                            one pushes, a major line twice; a price pushes back; a body's own trait is a major line
 *
 *   Nobody writes which way a stat or a word pushes. A direction is drawn once from the word itself by the keyed
 *   generator every roll in the game comes from, so a stat pushes the same way on every piece in every world, a
 *   word a pack invents tomorrow already has its own, and no table lists a pattern for a weapon or a stat.
 *
 *   The pushes are summed and each measure answers the sum in its own unit (`STEP`). Then the shape pays for
 *   what it gained: shots, speed and reach are what a volley is worth, and their product, shots counting half,
 *   is held to the kind's own. More lanes or a longer train fly slower and shorter; a faster shot flies shorter.
 *   Fan, gap, twist, bend and swing are worth nothing either way. What one body takes from one volley is one
 *   blow, as it always was (`CombatSystem`), and how often a volley leaves is the piece's own rate, so what a
 *   piece deals in a second is what its numbers already said.
 *
 *   A rank moves none of it (BALANCE_RUN 1.2: tiles and seconds read no rank); a line is measured in rulers of
 *   its own rank, so a moderate line pushes the same at F and at SSS.
 *
 * A creature fires by the same rule, read off its kind: its volley word's middle, pushed by each word its kind is
 * written with. Every body of a kind fires alike, since a danger has to be learned to be stepped out of; a
 * creature holds no roll of its own to read.
 *
 * Pure: the same piece is the same point on any machine, with no clock and no dice.
 */

import { Rng } from '../rng/DeterministicRNG';
import { PieceLaw } from './PieceLaw';
import { IShotShape, volleyShape } from './ThemeFormula';
import { BAND_SHARE, Volley } from './ThemeTypes';

/** The measures a push moves, in the order a direction is drawn in. Adding one moves no direction already drawn for the others. */
export const SHOT_MEASURES = ['arms', 'fan', 'train', 'gapMs', 'twist', 'speedPx', 'reachPx', 'curve', 'swayPx', 'swayLenPx'] as const;
export type ShotMeasure = typeof SHOT_MEASURES[number];
export type ShotPush = Record<ShotMeasure, number>;

/**
 * What one whole push is, in each measure's own unit. A count, a width or a time is multiplied (e to the push times
 * this); a turn, a bend and a swing are added, in radians and pixels, since their middle is none. All guesses
 * until played.
 */
const STEP: ShotPush = { arms: 0.7, fan: 0.4, train: 0.7, gapMs: 0.6, twist: 0.3, speedPx: 0.4, reachPx: 0.4, curve: 0.25, swayPx: 8, swayLenPx: 0.6 };

/** How hard each thing pushes: one moderate line, one word of the kind, and the height of quality's wave in each measure. */
export const LINE_PUSH = 0.6;
export const WORD_PUSH = 0.4;
export const QUALITY_PUSH = 0.6;
/** The span quality's roll is drawn over either side of none (`ItemFactory`): the wave is measured in these. */
const QUALITY_SPAN = 0.2;
/** A quality wave turns between this many times and this many over one span, each measure its own. */
const WAVE_TURNS = [0.25, 1] as const;
/** What a doubling of shots is worth beside a doubling of speed or of reach: half. */
export const SHOTS_WORTH = 0.5;

const none = (): ShotPush => Object.fromEntries(SHOT_MEASURES.map(m => [m, 0])) as ShotPush;

const directions = new Map<string, ShotPush>();
/**
 * The way a word pushes: a direction of length one, drawn from the word alone. Each measure's part is drawn from
 * the word and that measure's own name, so a measure added later leaves every other part where it was.
 */
export function directionOf(word: string): ShotPush {
  const known = directions.get(word);
  if (known) return known;
  const raw = none();
  for (const m of SHOT_MEASURES) {
    const rng = Rng.fromKey(`shot:way:${word}:${m}`);
    rng.next();
    // Two draws make one bell-shaped part, so no measure is favoured and no part is ever past reach
    raw[m] = Math.sqrt(-2 * Math.log(1 - rng.next())) * Math.cos(2 * Math.PI * rng.next());
  }
  const length = Math.hypot(...SHOT_MEASURES.map(m => raw[m])) || 1;
  for (const m of SHOT_MEASURES) raw[m] /= length;
  directions.set(word, raw);
  return raw;
}

const waves = new Map<ShotMeasure, { turns: number; start: number }>();
const waveOf = (m: ShotMeasure) => {
  let w = waves.get(m);
  if (!w) {
    const rng = Rng.fromKey(`shot:quality:${m}`);
    rng.next();
    w = { turns: WAVE_TURNS[0] + (WAVE_TURNS[1] - WAVE_TURNS[0]) * rng.next(), start: rng.next() };
    waves.set(m, w);
  }
  return w;
};

/** What a piece's one roll pushes: every measure on its own wave over the roll. */
export function qualityPush(quality: number): ShotPush {
  const out = none();
  const spans = (Number.isFinite(quality) ? quality : 0) / QUALITY_SPAN;
  for (const m of SHOT_MEASURES) {
    const w = waveOf(m);
    out[m] = QUALITY_PUSH * Math.sin(2 * Math.PI * (w.turns * spans + w.start));
  }
  return out;
}

const add = (into: ShotPush, way: ShotPush, size: number) => { for (const m of SHOT_MEASURES) into[m] += way[m] * size; };

/** What a kind's own words push: each one a little, in its own direction. */
export function wordsPush(words: readonly string[]): ShotPush {
  const out = none();
  for (const word of new Set(words)) add(out, directionOf(word), WORD_PUSH);
  return out;
}

/** What is read off a piece: its rank, its roll, its lines, and a body's traits where it was a body's own. */
export interface IShotPiece {
  rank: string;
  quality?: number;
  tags?: readonly string[];
  affixes?: readonly { stats: Record<string, number> }[];
  whose?: { traits?: readonly string[] };
}

/** One line's size in moderate lines: its value in rulers of its stat at the piece's rank, with the roll taken out. */
const lineSize = (stat: string, value: number, piece: IShotPiece): number => {
  const ruler = PieceLaw.ruler(stat, piece.rank) * (1 + (piece.quality ?? 0));
  return Number.isFinite(ruler) && ruler > 0 ? value / ruler / BAND_SHARE.moderate : 0;
};

/** Everything a piece pushes its volley by, summed. */
export function piecePush(piece: IShotPiece): ShotPush {
  const out = wordsPush(piece.tags ?? []);
  add(out, qualityPush(piece.quality ?? 0), 1);
  for (const affix of piece.affixes ?? []) {
    for (const [stat, value] of Object.entries(affix.stats)) add(out, directionOf(stat), LINE_PUSH * lineSize(stat, value, piece));
  }
  for (const trait of piece.whose?.traits ?? []) add(out, directionOf(trait), LINE_PUSH * (BAND_SHARE.major / BAND_SHARE.moderate));
  return out;
}

/** What a volley is worth: shots, counting half, times how fast and how far they fly. */
export const shotWorth = (s: IShotShape): number =>
  Math.pow(Math.max(1, Math.round(s.arms)) * Math.max(1, Math.round(s.train)), SHOTS_WORTH) * s.speedPx * s.reachPx;

/**
 * A middle, pushed. Each measure answers in its own unit; then speed and reach together give back what the count
 * of shots gained and what they gained themselves, each paying half, so the shape is worth what its middle was.
 */
export function pushed(middle: IShotShape, push: ShotPush): IShotShape {
  const grown = (m: ShotMeasure) => middle[m] * Math.exp(STEP[m] * push[m]);
  const arms = Math.max(1, Math.round(grown('arms')));
  const train = Math.max(1, Math.round(grown('train')));
  const shots = Math.log((arms * train) / (Math.max(1, Math.round(middle.arms)) * Math.max(1, Math.round(middle.train))));
  const speed = STEP.speedPx * push.speedPx, reach = STEP.reachPx * push.reachPx;
  const over = (speed + reach + SHOTS_WORTH * shots) / 2;
  return {
    arms, train,
    fan: grown('fan'),
    gapMs: grown('gapMs'),
    twist: middle.twist + STEP.twist * push.twist,
    speedPx: middle.speedPx * Math.exp(speed - over),
    reachPx: middle.reachPx * Math.exp(reach - over),
    curve: middle.curve + STEP.curve * push.curve,
    swayPx: middle.swayPx + STEP.swayPx * Math.abs(push.swayPx),
    swayLenPx: grown('swayLenPx')
  };
}

/** A piece's own volley: its kind's middle (the word given), pushed by the piece. */
export const pieceShot = (piece: IShotPiece, volley: Volley): IShotShape => pushed(volleyShape(volley), piecePush(piece));

const kinds = new Map<string, IShotShape>();
/** A creature kind's volley: its word's middle, pushed by the words its kind is written with. The same for every body of the kind. */
export function creatureShot(kind: { id?: string; tags?: readonly string[] }, volley: Volley): IShotShape {
  const key = `${kind.id ?? ''}|${volley}|${(kind.tags ?? []).join(',')}`;
  let shape = kinds.get(key);
  if (!shape) { shape = pushed(volleyShape(volley), wordsPush(kind.tags ?? [])); kinds.set(key, shape); }
  return shape;
}

/** How far two shapes stand apart: the length of the push that would carry one's measures to the other's, in the measures' own units. */
export function shotDistance(a: IShotShape, b: IShotShape): number {
  const parts = SHOT_MEASURES.map(m => {
    const multiplied = m !== 'twist' && m !== 'curve' && m !== 'swayPx';
    return multiplied ? Math.log(a[m] / b[m]) / STEP[m] : (a[m] - b[m]) / STEP[m];
  });
  return Math.hypot(...parts);
}
