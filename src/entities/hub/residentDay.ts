/**
 * A RESIDENT'S DAY (Q18, Q20): where a person who lives here is, walked over, from the clock.
 *
 * Pedro's rulings: everything is walked over and nobody talks across a distance; a need sets a goal,
 * the goal walks them to whoever supplies it, and the economy chain makes it deterministic. After the
 * house, the next rung of the ladder is walked to by goals.
 *
 * So a person home walks a round: out of their own door to whoever feeds them, on to the door their
 * rung sends them to, and home again, waiting a while at each. Where they are is a pure function of
 * the route and the clock, the same on every machine, so a city nobody watched has them where a
 * watched one would. A lodger stands by the tavern, where they live.
 *
 * Pure: no store, no canvas. HubCanvas draws what this says and talks to whoever it puts in reach.
 */

import { IHubLayout, IPOI, POIType } from './HubGenerator';
import { doorTile } from './hubManifest';
import { NeedKind } from '../../logic/systems/NpcAgenda';
import { fnv1a } from '../../logic/rng/DeterministicRNG';

export interface ITile { x: number; y: number }

export interface IResidentRoute {
  /** Every tile walked, in order, one step apart. A route that never leaves is one tile. */
  tiles: ITile[];
  /** The indices in `tiles` where they stop a while: each door on the round. */
  stops: number[];
}

/** One round of their day. A guess until Wave 12: short enough that a person playing sees them walk it. */
export const ERRAND_MS = 60 * 60 * 1000;
/** How fast a person walks the street, tiles a second. A guess until Wave 12, near a player's bare pace. */
export const RESIDENT_TILES_PER_S = 2;

/**
 * Where each rung sends them (Q20). Fed: whoever sells what is eaten. A house: their own, so they stay
 * by it. More money than they need: the vault. A spouse and children: the tavern, where people meet.
 * A goal of their own: the Hall, where goals are posted. A guess until Wave 12; Pedro may overrule.
 */
const PLACE: Record<NeedKind, POIType | 'HOME'> = {
  survival: POIType.VENDOR_CONSUMABLES,
  safety: 'HOME',
  esteem: POIType.BANK,
  belonging: POIType.TAVERN,
  purpose: POIType.GUILD_HALL
};

/** Who feeds someone who lives in their own house: the keeper whose shelf sells what is eaten. */
const FEEDER = POIType.VENDOR_CONSUMABLES;

const allPois = (layout: IHubLayout): IPOI[] => layout.zones.flatMap(z => z.pois);

/** How near a body is near enough to talk to, in tiles. */
const PERSON_REACH = 1.5;

/** Where someone waits at a door: a step or two to the side, close enough to be seen at it. */
const WAIT_OFFSETS: readonly [number, number][] = [[2, 0], [-2, 0], [0, 2], [2, 1], [-2, 1], [1, 2], [-1, 2], [2, 2], [-2, 2], [3, 0], [-3, 0], [0, 3]];

/**
 * Found by playing: a person waiting on a door's own tile takes the interact key from the door, so the
 * tavern would not open while they stood there. They wait beside it, out of reach of every door.
 */
function waitingSpot(layout: IHubLayout, walkable: (x: number, y: number) => boolean, door: ITile): ITile {
  const doors = allPois(layout).filter(p => p.interactable).map(doorTile);
  const clear = (t: ITile) => doors.every(d => Math.hypot(d.x - t.x, d.y - t.y) > PERSON_REACH);
  for (const [dx, dy] of WAIT_OFFSETS) {
    const spot = { x: door.x + dx, y: door.y + dy };
    if (walkable(spot.x, spot.y) && clear(spot) && walkBetween(walkable, door, spot, layout.width, layout.height)) return spot;
  }
  return door;
}
const firstOf = (layout: IHubLayout, type: POIType) => allPois(layout).find(p => p.type === type) ?? null;
const same = (a: ITile, b: ITile) => a.x === b.x && a.y === b.y;

/** The shortest walk from one tile to another, four ways, over what can be walked. Null: no way there. */
export function walkBetween(walkable: (x: number, y: number) => boolean, from: ITile, to: ITile, width: number, height: number): ITile[] | null {
  if (same(from, to)) return [from];
  const at = (t: ITile) => t.y * width + t.x;
  const came = new Map<number, number>([[at(from), -1]]);
  const queue: ITile[] = [from];
  for (let head = 0; head < queue.length; head++) {
    const here = queue[head];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const next = { x: here.x + dx, y: here.y + dy };
      if (next.x < 0 || next.y < 0 || next.x >= width || next.y >= height) continue;
      const key = at(next);
      if (came.has(key)) continue;
      if (!same(next, to) && !walkable(next.x, next.y)) continue;
      came.set(key, at(here));
      if (same(next, to)) {
        const path: ITile[] = [];
        for (let k: number = key; k !== -1; k = came.get(k)!) path.push({ x: k % width, y: Math.floor(k / width) });
        return path.reverse();
      }
      queue.push(next);
    }
  }
  return null;
}

export const ResidentDay = {
  ERRAND_MS,

  placeOf(need: NeedKind): POIType | 'HOME' {
    return PLACE[need];
  },

  /**
   * Their round for the rung they stand on. Home is their lot's door; a lodger (no lot, or a house not
   * yet standing) has none, and stands by the tavern. A door the city does not have is passed over.
   */
  route(layout: IHubLayout, walkable: (x: number, y: number) => boolean, who: { homeLotId: string | null; need: NeedKind; lodging?: number }): IResidentRoute {
    const home = who.homeLotId ? allPois(layout).find(p => p.id === who.homeLotId) ?? null : null;
    if (!home) {
      const tavern = firstOf(layout, POIType.TAVERN);
      const door = tavern ? doorTile(tavern) : { x: 0, y: 0 };
      const n = who.lodging ?? 0;
      return { tiles: [{ x: door.x + 2 + 2 * (n % 2), y: door.y + 1 + Math.floor(n / 2) }], stops: [0] };
    }
    const homeDoor = doorTile(home);
    const start = waitingSpot(layout, walkable, homeDoor);
    const place = PLACE[who.need];
    const doors = [FEEDER, ...(place === 'HOME' || place === FEEDER ? [] : [place])]
      .map(type => firstOf(layout, type))
      .filter((p): p is IPOI => !!p)
      .map(doorTile);
    const tiles: ITile[] = [start];
    const stops: number[] = [0];
    let here = start;
    // Each door on the round, walked up to, then the spot beside it where they wait; and home the same way.
    for (const door of [...doors, homeDoor]) {
      const spot = same(door, homeDoor) ? start : waitingSpot(layout, walkable, door);
      const toDoor = walkBetween(walkable, here, door, layout.width, layout.height);
      const toSpot = toDoor && walkBetween(walkable, door, spot, layout.width, layout.height);
      if (!toDoor || !toSpot) continue;
      tiles.push(...toDoor.slice(1), ...toSpot.slice(1));
      stops.push(tiles.length - 1);
      here = spot;
    }
    // The last stop is home again, the same spot as the first: one wait there, not two.
    if (stops.length > 1 && same(tiles[stops[stops.length - 1]], start)) stops.pop();
    return { tiles, stops };
  },

  /**
   * Where they are at this moment: a point in tiles, from the clock. Each round starts at its own
   * offset for each person, so a street of people does not move in step.
   */
  whereAt(route: IResidentRoute, nowMs: number, key: string): { x: number; y: number; moving: boolean; facing: 'down' | 'up' | 'left' | 'right'; step: number } {
    const centre = (t: ITile) => ({ x: t.x + 0.5, y: t.y + 0.5 });
    if (route.tiles.length <= 1) return { ...centre(route.tiles[0] ?? { x: 0, y: 0 }), moving: false, facing: 'down', step: 0 };
    const tileMs = 1000 / RESIDENT_TILES_PER_S;
    const walking = (route.tiles.length - 1) * tileMs;
    const waitMs = Math.max(0, ERRAND_MS - walking) / route.stops.length;
    let t = ((nowMs + fnv1a(`round:${key}`) % ERRAND_MS) % ERRAND_MS + ERRAND_MS) % ERRAND_MS;
    // Walk the round: wait at a stop, then walk to the next, and so round to the start.
    for (let s = 0; s < route.stops.length; s++) {
      const from = route.stops[s];
      const to = s + 1 < route.stops.length ? route.stops[s + 1] : route.tiles.length - 1;
      if (t < waitMs) return { ...centre(route.tiles[from]), moving: false, facing: 'down', step: 0 };
      t -= waitMs;
      const legMs = (to - from) * tileMs;
      if (t < legMs) {
        const along = t / tileMs;
        const i = from + Math.floor(along);
        const a = route.tiles[i], b = route.tiles[Math.min(i + 1, to)];
        const f = along - Math.floor(along);
        const facing = b.x > a.x ? 'right' : b.x < a.x ? 'left' : b.y < a.y ? 'up' : 'down';
        return { x: a.x + 0.5 + (b.x - a.x) * f, y: a.y + 0.5 + (b.y - a.y) * f, moving: true, facing, step: Math.floor(along * 2) };
      }
      t -= legMs;
    }
    return { ...centre(route.tiles[0]), moving: false, facing: 'down', step: 0 };
  },

  /** Who is near enough to talk to: the nearest person within a step and a half of where you stand. */
  personInReach(people: { id: string; at: { x: number; y: number } }[], tile: ITile, reach = PERSON_REACH): string | null {
    let best: string | null = null, bestD = Infinity;
    for (const p of people) {
      const d = Math.hypot(p.at.x - (tile.x + 0.5), p.at.y - (tile.y + 0.5));
      if (d <= reach && d < bestD) { best = p.id; bestD = d; }
    }
    return best;
  }
};
