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
import { TILE_PX } from '../../../shared/entities/world/grid';

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

/** Can this be taken in the hand and fired? Null means yes. Bare hands are always there. */
export function wieldRefusal(item: IItem | undefined): string | null {
  if (!item) return null;
  if (item.slot === SlotType.MAIN_HAND) return null;
  if (item.slot === SlotType.TOOL || (item.tags || []).includes('tool')) return null;
  return `${LoadoutSystem.shownName(item)} guards. It does not swing.`;
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
