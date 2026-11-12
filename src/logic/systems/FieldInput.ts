/**
 * FIELD INPUT (the usability pass): the laws behind the controls, pure so a bar
 * can run them. Firing is a held button at the weapon's own rate; interacting is
 * one key everywhere and has its own input; the hotbar reads the harness.
 */

import { EquipSlotId, IEquipmentState, IInteractionOption, IItem, IPlayer, InteractionType, SlotType, TOOL_SLOT_COUNT, toolSlotIds } from '../../../shared/types';
import { EntityType, IMap, IWorldEntity, ScanLevel } from '../../../shared/entities/world/types';
import { InteractionEngine } from '../../entities/interaction/InteractionEngine';
import { CombatMath } from '../../entities/combat/CombatMath';
import { LoadoutSystem } from '../../../shared/entities/player/systems/LoadoutSystem';
import { isThrowable } from '../../../shared/entities/item/Throwable';
import { TILE_PX } from '../../../shared/entities/world/grid';
import { DRAW_PACE, SWING_PACE, abilityNumbers, drawMs, swingWindupMs } from '../../../shared/logic/theme/ThemeFormula';
import type { ThemeRank } from '../../../shared/logic/theme/ThemeTypes';
import type { Facing } from '../../../shared/render/atoms/people';
import { UNARMED_SHOTS_PER_SEC } from '../../../shared/logic/systems/FightNumbers';

// ---------------------------------------------------------------------------
// HOLD TO FIRE
// ---------------------------------------------------------------------------

export type FireMode = 'MELEE' | 'FOCUS' | 'SHOT';
export type FireGate = 'FIRE' | 'WAIT' | 'IDLE' | 'NO_ENERGY';

export const FOCUS_ENERGY_COST = 10;

/** How what is in the hand fires. A tool swings. Everything else is the weapon's own word. */
export function fireMode(item: IItem | undefined): FireMode {
  if (item && CombatMath.isUsable(item) && (item.tags || []).includes('tool')) return 'MELEE';
  if (CombatMath.isMelee(item)) return 'MELEE';
  if (CombatMath.isFocus(item)) return 'FOCUS';
  return 'SHOT';
}

/** One question each frame: does this frame fire? A click is simply a very short hold. */
export function fireGate(s: { held: boolean; now: number; lastShot: number; cooldownMs: number; mode: FireMode; energy: number }): FireGate {
  if (!s.held) return 'IDLE';
  if (s.now - s.lastShot < s.cooldownMs) return 'WAIT';
  if (s.mode === 'FOCUS' && s.energy < FOCUS_ENERGY_COST) return 'NO_ENERGY';
  return 'FIRE';
}

/**
 * The fight's rebalance, part 2: a person's blow winds up before it lands (BALANCE_RUN 2.13, call 6). A shot, a
 * throw and a focus's own burst are drawn standing for six tenths of the hand's own cycle; a working cast from a
 * focus is drawn standing for its own telegraph; a swing begins at half pace for a time its shape gives. All of it
 * from the formula, and none of it shortened by a faster hand, which shortens only what comes after.
 */
export interface IWindup { ms: number; pace: number; kind: 'draw' | 'swing' }
export function windupOf(item: IItem | undefined, _equipment?: IEquipmentState, _attributes?: unknown, cast?: { cost: Parameters<typeof abilityNumbers>[0]; rank: ThemeRank }): IWindup {
  const mode = fireMode(item);
  if (mode === 'MELEE') return { ms: swingWindupMs(CombatMath.strikeOf(item)), pace: SWING_PACE, kind: 'swing' };
  if (mode === 'FOCUS' && cast) return { ms: abilityNumbers(cast.cost, cast.rank).telegraphMs, pace: DRAW_PACE, kind: 'draw' };
  const own = CombatMath.isUsable(item) ? item!.stats?.attack_speed || 1.0 : UNARMED_SHOTS_PER_SEC;
  return { ms: drawMs(own), pace: DRAW_PACE, kind: 'draw' };
}

/** What began a blow: a press on the ground, or the attack key. */
export type AimedBy = 'pointer' | 'key';
const FACING_ANGLE: Record<Facing, number> = { right: 0, down: Math.PI / 2, left: Math.PI, up: -Math.PI / 2 };

/**
 * SH2, found by shooting as Pedro did after his run on 854bcce ("EITHER there's a HUGE bug on the shooting or
 * accuracy is a bitch"): where a wound-up blow lets go. One begun by the pointer flies at the pointer as it stands
 * when the blow lets go, whether its button is still held or not, since a click is let go long before a draw ends.
 * One begun by the attack key flies at what the inspect card holds (`held`, its offset from the person), or the
 * way its holder faces. A pointer never moved over the field aims as the key does. `centre` is where the person
 * stands on the screen, which the camera keeps at the middle of the window.
 * SH8, the coordinator's call after strafing as Pedro did: the attack key, too, flies at the pointer while the pointer
 * rests over the field (`onField`), as the inspect card already follows it there; off the field, at the card or the facing.
 */
export function aimAt(s: { by: AimedBy; pointer?: { x: number; y: number }; onField?: boolean; centre: { x: number; y: number }; held?: { dx: number; dy: number }; facing: Facing }): number {
  if ((s.by === 'pointer' || s.onField) && s.pointer) return Math.atan2(s.pointer.y - s.centre.y, s.pointer.x - s.centre.x);
  if (s.held) return Math.atan2(s.held.dy, s.held.dx);
  return FACING_ANGLE[s.facing];
}

/**
 * SH7, found by strafing and shooting as Pedro did ("I think it's direction, I was strafing and shooting"): the way a
 * person faces is the way the movement keys point (`dx`, `dz` from the keys, before anything scales the step), the
 * larger of the two deciding as the step did. A frame with no key keeps the facing it had. Read from the step after
 * the draw's pace (0) had scaled it, every facing came out as up while a key was held during a draw.
 */
export function walkFacing(dx: number, dz: number, was: Facing): Facing {
  if (dx === 0 && dz === 0) return was;
  return Math.abs(dx) > Math.abs(dz) ? (dx > 0 ? 'right' : 'left') : (dz > 0 ? 'down' : 'up');
}

/** From one blow's start to the next's: the hand's rate, and never shorter than the wind-up. */
export function cycleMs(item: IItem | undefined, equipment?: IEquipmentState, attributes?: Parameters<typeof CombatMath.fireCooldownMs>[2]): number {
  return Math.max(CombatMath.fireCooldownMs(item, equipment, attributes), windupOf(item, equipment, attributes).ms);
}

/** Can this be taken in the hand and fired? Null means yes. Bare hands are always there. */
export function wieldRefusal(item: IItem | undefined): string | null {
  if (!item) return null;
  if (item.slot === SlotType.MAIN_HAND) return null;
  if (item.slot === SlotType.TOOL || (item.tags || []).includes('tool')) return null;
  if (isThrowable(item)) return null; // C14: a stone in the hand is thrown
  return `${LoadoutSystem.shownName(item)} guards. It does not swing.`;
}

/**
 * C14: how many throws a hand has: the stone held and every one carried, since the next comes to the
 * hand by itself. An empty hand that is the one firing counts every stone carried, because it will
 * reach for them (`reachFor`), so the number is on the hand before the first throw and falls by one
 * with each (Pedro, 2026-11-10: "you should have -1 (if you have 7x then 6)"). A hand holding
 * anything else counts none, and so does an empty hand with nothing to reach for.
 */
export function throwsLeft(held: IItem | undefined, carried: IItem[], firing = false): number | undefined {
  const behind = carried.filter(isThrowable).length;
  if (isThrowable(held)) return 1 + behind;
  return !held && firing && behind > 0 ? behind : undefined;
}

/**
 * Pedro's own run, 2026-11-10: "the pebbles don't lose ammo". A stone carried is what an empty hand
 * throws: firing with nothing in the hand takes the first stone carried into it, so the shot that
 * flies is one of them, lands as one, and is spent. A hand holding anything is left alone, and with
 * no stone carried the bare hand does what it always did (C25, still Pedro's call).
 */
export function reachFor(held: IItem | undefined, carried: IItem[]): IItem | undefined {
  return held ? undefined : carried.find(isThrowable);
}

// ---------------------------------------------------------------------------
// ONE INTERACT KEY
// ---------------------------------------------------------------------------

export const isInteractKey = (key: string): boolean => {
  const k = key.toLowerCase();
  return k === 'e' || k === 'enter';
};

/** A key meant for an input or a control must never also move the game. */
export const isTypingTarget = (target: EventTarget | null): boolean => {
  const el = target as HTMLElement | null;
  const tag = el?.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
};

export const INTERACT_REACH_TILES = 4;

export interface InteractPick {
  entity: IWorldEntity;
  dist: number;
  options: IInteractionOption[];
  /** What the key does at once. Absent means there is more than one answer, and the menu asks. */
  primary?: IInteractionOption;
}

/**
 * The nearest thing within reach that can be acted on. A study option is never
 * the key's first answer, because it hangs off anything once a mind is sharp.
 */
export function pickInteract(player: IPlayer, entities: IWorldEntity[], pos: { x: number; z: number }): InteractPick | null {
  let best: InteractPick | null = null;
  for (const entity of entities) {
    // A body in reach answers the key only for someone holding a snare (D65)
    if (entity.type === EntityType.MOB && !player.currentSession?.inventory.some(i => i.tags?.includes('snare'))) continue;
    const dist = Math.hypot(entity.position.x - pos.x, entity.position.y - pos.z) / TILE_PX;
    if (dist >= INTERACT_REACH_TILES || (best && dist >= best.dist)) continue;
    const options = InteractionEngine.getAvailableInteractions(player, entity, dist);
    if (options.length === 0) continue;
    const acts = options.filter(o => o.type !== InteractionType.STUDY);
    if (acts.length === 0) continue;
    best = { entity, dist, options, ...(acts.length === 1 ? { primary: acts[0] } : {}) };
  }
  return best;
}

// ---------------------------------------------------------------------------
// THE HOTBAR: hands, then tools, then the belt. Digits reach as far as digits go.
// ---------------------------------------------------------------------------

export type HotbarGroup = 'HAND' | 'TOOL' | 'BELT';
export interface HotbarCell { slot: EquipSlotId; digit: string | null; group: HotbarGroup }

const DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];

export function hotbarCells(equipment?: IEquipmentState): HotbarCell[] {
  const groups: [EquipSlotId, HotbarGroup][] = [
    ['RIGHT_HAND', 'HAND'],
    ['LEFT_HAND', 'HAND'],
    ...toolSlotIds(TOOL_SLOT_COUNT).map(s => [s, 'TOOL'] as [EquipSlotId, HotbarGroup]),
    ...LoadoutSystem.availableSlots(equipment).filter(s => s.startsWith('POUCH_')).map(s => [s, 'BELT'] as [EquipSlotId, HotbarGroup])
  ];
  return groups.map(([slot, group], i) => ({ slot, group, digit: DIGITS[i] ?? null }));
}

export function hotbarSlotForDigit(equipment: IEquipmentState | undefined, digit: string): EquipSlotId | null {
  return hotbarCells(equipment).find(c => c.digit === digit)?.slot ?? null;
}

// ---------------------------------------------------------------------------
// THE CITY'S CAMERA: follows and clamps; a window bigger than the city centers it
// ---------------------------------------------------------------------------

export function cityCamera(view: { w: number; h: number }, map: { w: number; h: number }, pos: { x: number; y: number }): { x: number; y: number } {
  const axis = (viewLen: number, mapLen: number, at: number) =>
    mapLen <= viewLen
      ? -Math.floor((viewLen - mapLen) / 2)
      : Math.max(0, Math.min(mapLen - viewLen, at - viewLen / 2));
  return { x: axis(view.w, map.w, pos.x), y: axis(view.h, map.h, pos.y) };
}

// ---------------------------------------------------------------------------
// RECON: where to start, from what the drone has recorded and nothing else
// ---------------------------------------------------------------------------

const RANK_ORDER = ['F', 'E', 'D', 'C', 'B', 'A', 'S', 'SS', 'SSS'];

export interface StartAdvice { kind: 'SCAN' | 'DROP'; x: number; y: number; why: string }

export function suggestStart(map: Pick<IMap, 'width' | 'height' | 'sectors'>): StartAdvice {
  const known = Object.values(map.sectors).filter(s => s.scanLevel >= ScanLevel.BASIC);
  if (known.length === 0) {
    return {
      kind: 'SCAN',
      x: Math.floor(map.width / 2), y: Math.floor(map.height / 2),
      why: 'Nothing recorded yet. Start in the middle: scan a sector, and scan again to read it deeper.'
    };
  }
  const best = [...known].sort((a, b) =>
    Number(b.hasExtraction) - Number(a.hasExtraction) ||
    RANK_ORDER.indexOf(String(a.difficulty)) - RANK_ORDER.indexOf(String(b.difficulty)) ||
    a.y - b.y || a.x - b.x)[0];
  return {
    kind: 'DROP',
    x: best.x, y: best.y,
    why: best.hasExtraction
      // L7: a sector is wide, and the drop lands anywhere in it. The beacon is in the sector, not at the feet
      ? `Threat ${best.difficulty}, with a beacon somewhere in it: a way out without leaving the sector.`
      : `Threat ${best.difficulty}, the lowest on record. No beacon recorded here yet; scan around it for one.`
  };
}

export const shouldSkipHubStop = (hubs: unknown[]): boolean => hubs.length === 1;

// ---------------------------------------------------------------------------
// A HEAVY FLOW: the backdrop never closes it, and a dirty one asks first
// ---------------------------------------------------------------------------

export type DraftDismissal = 'IGNORE' | 'ASK' | 'CLOSE';

export function draftDismissal(dirty: boolean, via: 'BACKDROP' | 'ESCAPE' | 'CLOSE'): DraftDismissal {
  if (via === 'BACKDROP') return 'IGNORE';
  return dirty ? 'ASK' : 'CLOSE';
}
