/**
 * OTHER PLAYERS, WHERE THEY ARE (Pedro, 2026-11-05: "perfect", to this). Each browser is the only
 * word on where its own player stands, so a player's own walk is never corrected and never waits.
 * Everyone else is drawn a little behind, from what their browsers said:
 *
 *   - a browser says where its player is about ten times a second over the live socket (SAY_EVERY_MS);
 *     the room passes it to everyone in the same place, and keeps none of it;
 *   - a player is drawn BEHIND_MS in their own past, sliding between the two things said around that
 *     moment, so one late message never makes them jump;
 *   - when nothing newer has come, they keep walking the way they went for KEEP_WALKING_MS, then stand
 *     where that left them and wait;
 *   - one who has said nothing for GONE_AFTER_MS, or whose socket closed, is no longer drawn.
 *
 * Clocks differ between machines, so each said thing carries its sender's time, and the gap between
 * that and this machine's is learned per player as the smallest one seen (the message that came
 * fastest), so a slow message is never mistaken for a moved clock.
 */
import type { Archetype, ArmorClass, Facing, WeaponClass } from '../../render/atoms/people';

export const SAY_EVERY_MS = 100;
/** Said again with nothing new, so one standing still is known to be there. */
export const SAY_AGAIN_MS = 1_000;
export const BEHIND_MS = 100;
export const KEEP_WALKING_MS = 250;
export const GONE_AFTER_MS = 5_000;

const FACINGS: readonly Facing[] = ['up', 'down', 'left', 'right'];

/** What a browser says of its own player. `t` is the sender's clock. */
export interface IWhere {
  place: string;
  x: number; z: number;
  facing: Facing; moving: boolean;
  t: number;
  name: string; archetype: Archetype;
  weapon?: WeaponClass; armor?: ArmorClass;
}

/** One said thing as it came, with who said it (the room puts the uid on). */
export interface IHeard extends IWhere { uid: string }

/** Another player as drawn at a moment. */
export interface IOther {
  uid: string; name: string; archetype: Archetype;
  x: number; z: number; facing: Facing; moving: boolean;
  weapon?: WeaponClass; armor?: ArmorClass;
}

/** Is this the shape of a thing said? Anything else is dropped where it lands. */
export function isWhere(w: any): w is IWhere {
  return !!w && typeof w === 'object'
    && typeof w.place === 'string' && w.place.length > 0
    && Number.isFinite(w.x) && Number.isFinite(w.z) && Number.isFinite(w.t)
    && FACINGS.includes(w.facing) && typeof w.moving === 'boolean'
    && typeof w.name === 'string' && typeof w.archetype === 'string'
    && (w.weapon === undefined || typeof w.weapon === 'string')
    && (w.armor === undefined || typeof w.armor === 'string');
}

/** Only what a thing said carries, so nothing else rides along to other players. */
export function whereOf(w: IWhere): IWhere {
  return {
    place: w.place, x: w.x, z: w.z, facing: w.facing, moving: w.moving, t: w.t, name: w.name, archetype: w.archetype,
    ...(w.weapon !== undefined ? { weapon: w.weapon } : {}), ...(w.armor !== undefined ? { armor: w.armor } : {})
  };
}

/**
 * Where a player stands at sender time `at`, from what they said in order. Between two said
 * things: the straight line between them. Past the last: on along its last heading for
 * KEEP_WALKING_MS, then still. Before the first: the first.
 */
export function placeAt(said: readonly IWhere[], at: number): { x: number; z: number; facing: Facing; moving: boolean } | null {
  if (said.length === 0) return null;
  const first = said[0];
  if (at <= first.t) return { x: first.x, z: first.z, facing: first.facing, moving: false };
  for (let i = 1; i < said.length; i++) {
    const a = said[i - 1], b = said[i];
    if (at <= b.t) {
      const k = b.t > a.t ? (at - a.t) / (b.t - a.t) : 1;
      return { x: a.x + (b.x - a.x) * k, z: a.z + (b.z - a.z) * k, facing: a.facing, moving: a.moving || b.moving };
    }
  }
  const last = said[said.length - 1];
  const before = said.length > 1 ? said[said.length - 2] : null;
  if (!last.moving || !before || last.t <= before.t) return { x: last.x, z: last.z, facing: last.facing, moving: false };
  const ahead = Math.min(at - last.t, KEEP_WALKING_MS);
  const vx = (last.x - before.x) / (last.t - before.t), vz = (last.z - before.z) / (last.t - before.t);
  return { x: last.x + vx * ahead, z: last.z + vz * ahead, facing: last.facing, moving: at - last.t < KEEP_WALKING_MS };
}

interface IHeld { said: IWhere[]; gap: number; heardAt: number }

/**
 * Everyone else this browser has heard, by uid. Kept per instance so tests hold their own; the
 * game uses the one in `presence`.
 */
export class PresenceBook {
  private held = new Map<string, IHeld>();

  /** A thing another player said, heard at this machine's `now`. */
  hear(h: IHeard, now: number) {
    if (!isWhere(h) || typeof h.uid !== 'string') return;
    const was = this.held.get(h.uid);
    // Somewhere else now: what was said there is no guide to where they are here
    const fresh = !was || was.said[was.said.length - 1].place !== h.place;
    const one = whereOf(h);
    const held: IHeld = fresh ? { said: [], gap: now - h.t, heardAt: now } : was!;
    held.gap = Math.min(held.gap, now - h.t);
    held.heardAt = now;
    // In order by their clock; a message overtaken by a later one is placed where it belongs
    const at = held.said.findIndex(s => s.t >= one.t);
    if (at === -1) held.said.push(one);
    else if (held.said[at].t !== one.t) held.said.splice(at, 0, one);
    // What is long past the drawing moment is let go: two said things before it are all a line needs
    const drawAt = one.t - BEHIND_MS;
    while (held.said.length > 2 && held.said[1].t < drawAt - SAY_AGAIN_MS) held.said.shift();
    this.held.set(h.uid, held);
  }

  gone(uid: string) { this.held.delete(uid); }

  clear() { this.held.clear(); }

  /** Everyone heard in `place`, drawn BEHIND_MS in their own past at this machine's `now`. */
  at(place: string, now: number): IOther[] {
    const out: IOther[] = [];
    for (const [uid, held] of this.held) {
      if (now - held.heardAt > GONE_AFTER_MS) { this.held.delete(uid); continue; }
      const last = held.said[held.said.length - 1];
      if (last.place !== place) continue;
      const spot = placeAt(held.said, now - held.gap - BEHIND_MS);
      if (!spot) continue;
      out.push({ uid, name: last.name, archetype: last.archetype, ...spot, ...(last.weapon ? { weapon: last.weapon } : {}), ...(last.armor ? { armor: last.armor } : {}) });
    }
    return out;
  }

  size() { return this.held.size; }
}

/** The game's own book of everyone else (LiveClient fills it, WorldCanvas draws from it). */
export const presence = new PresenceBook();

/**
 * When to say where this player is: SAY_EVERY_MS apart at most, and only when something changed,
 * or SAY_AGAIN_MS has passed so a still player is known to be there.
 */
export function shouldSay(last: IWhere | null, next: IWhere, now: number, lastAt: number): boolean {
  if (!last || last.place !== next.place) return true;
  if (now - lastAt < SAY_EVERY_MS) return false;
  if (now - lastAt >= SAY_AGAIN_MS) return true;
  return last.x !== next.x || last.z !== next.z || last.facing !== next.facing || last.moving !== next.moving
    || last.weapon !== next.weapon || last.armor !== next.armor;
}
