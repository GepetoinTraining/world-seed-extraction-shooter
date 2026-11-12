/**
 * THE FIGHT'S SHAPES (the fight's rebalance, part 1): a blow is a piece of ground, and what it hits is
 * exactly what that piece covers. One test here decides a hit, and the marks the field draws come from
 * the same shape, so what is seen landing is what lands.
 *
 * A shape is a ring cut to a wedge: from `innerPx` out to `reachPx`, `halfAngle` either side of its aim
 * (ThemeFormula.strikeNumbers). A body is covered when any part of it lies on that ground.
 */

import type { IStrikeShape } from '../../logic/theme/ThemeFormula';
import { ATOM_PX, SIZE_ATOMS } from '../../render/atoms/atoms';

export type { IStrikeShape };

/** A person's body, for what lands on it: half a tile either side of where they stand. */
export const PERSON_RADIUS_PX = 10;

/** How much ground a body takes, by its size word: half its drawn width. A body that names none is a middling one. */
export const bodyRadiusPx = (size?: string): number => ((SIZE_ATOMS[size ?? 'MEDIUM'] ?? SIZE_ATOMS.MEDIUM) * ATOM_PX) / 2;

const wrap = (a: number) => {
  let d = a % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  if (d < -Math.PI) d += 2 * Math.PI;
  return d;
};

/** Does this shape, from `origin` aimed along `aim`, cover any part of a body of `radius` standing at `at`? */
export function covers(shape: IStrikeShape, origin: { x: number; y: number }, aim: number, at: { x: number; y: number }, radius: number): boolean {
  const dx = at.x - origin.x, dy = at.y - origin.y;
  const d = Math.hypot(dx, dy);
  if (d - radius > shape.reachPx) return false;
  if (d + radius < shape.innerPx) return false;
  if (d <= radius) return true;
  // The wedge's side, widened by however much of the body's breadth reaches past it
  return Math.abs(wrap(Math.atan2(dy, dx) - aim)) <= shape.halfAngle + Math.asin(Math.min(1, radius / d));
}

/**
 * The marks the field draws for a shape: a grid of points on its ground, every one of them inside it, with its
 * far edge, its hole's edge and both its sides traced. Spacing in pixels.
 */
export function shapeMarks(shape: IStrikeShape, origin: { x: number; y: number }, aim: number, spacing: number): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  const at = (r: number, a: number) => out.push({ x: origin.x + Math.cos(aim + a) * r, y: origin.y + Math.sin(aim + a) * r });
  const inner = Math.max(shape.innerPx, spacing / 2);
  const outer = shape.reachPx;
  // Rings from the hole out, each stepped so neighbouring marks sit about `spacing` apart along it
  for (let r = inner; r <= outer + 0.001; r += spacing) {
    const span = 2 * shape.halfAngle * r;
    const n = Math.max(1, Math.round(span / spacing));
    for (let i = 0; i <= n; i++) at(r, -shape.halfAngle + (2 * shape.halfAngle * i) / n);
  }
  // The far edge itself, so the reach reads exactly
  const edge = Math.max(1, Math.round((2 * shape.halfAngle * outer) / (spacing / 2)));
  for (let i = 0; i <= edge; i++) at(outer, -shape.halfAngle + (2 * shape.halfAngle * i) / edge);
  return out;
}

/**
 * The shortest walk out of a shape for a body standing on its aim at `distance`: back past its reach, sideways
 * past its edge, or in under its haft. What a creature's wind-up has to leave time for.
 */
export function stepOutPx(shape: IStrikeShape, distance: number, radius: number): number {
  const back = shape.reachPx + radius - distance;
  // Square to the aim, until the body's edge clears the wedge's side
  const aside = shape.halfAngle < Math.PI / 2 ? (radius + distance * Math.sin(shape.halfAngle)) / Math.cos(shape.halfAngle) : Infinity;
  const under = shape.innerPx > 2 * radius ? distance + radius - shape.innerPx : Infinity;
  return Math.max(0, Math.min(back, aside, under));
}
