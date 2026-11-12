/**
 * THE HANDS (the usability pass): one way to move any item from any place to any
 * other, by mouse and by keyboard. It decides nothing itself: `probeMove` asks
 * the same laws the store's doors ask, so the ghost knows the answer first, and
 * `commitMove` walks through those doors, so a refusal still speaks in voice.
 * A move that is two doors asks the laws first and is never half done.
 */

import { EquipSlotId, IItem, IPlayer } from '../../../shared/types';
import { InventorySystem, GRID_H, GRID_W } from '../../../shared/entities/player/systems/InventorySystem';
import { LoadoutSystem, Verdict } from '../../../shared/entities/player/systems/LoadoutSystem';
import { StashGrid } from '../../entities/player/systems/StashGrid';
import { CartSystem } from '../../entities/world/CartSystem';
import { IWorldEntity } from '../../../shared/entities/world/types';
import type { IPlayerPort } from '../../entities/player/playerView';
import { bodyOf, type IWorldView } from '../../entities/world/worldView';
import { PairCraft } from '../../../shared/logic/systems/PairCraft';
import { WorkCost } from '../../../shared/logic/systems/WorkCost';

export type Place =
  | { kind: 'PACK'; x?: number; y?: number; rotated?: boolean }
  | { kind: 'STASH'; x?: number; y?: number; rotated?: boolean }
  | { kind: 'SLOT'; slot: EquipSlotId }
  | { kind: 'CART'; entityId: string; x?: number; y?: number; rotated?: boolean }
  | { kind: 'CACHE'; entityId: string }
  | { kind: 'GROUND' }
  | { kind: 'KIT' }
  /** Set on another piece in the same grid, to be worked into it (PairCraft). Never a cell. On a cart's bed it names the cart (H13d). */
  | { kind: 'ONTO'; grid: 'PACK' | 'STASH' | 'CART'; targetId: string; entityId?: string }
  /** U23: what rides a pouch, taken out of it. Only ever a source: nothing is set down "in a pouch" by this name. */
  | { kind: 'POUCH'; slot: EquipSlotId };

/** `along`: the rest of a stack in hand, moving with `item` wherever it goes (the interface pass). */
export interface Held { item: IItem; from: Place; rotated: boolean; along?: IItem[] }

/**
 * How far from where a person stands the ground they can reach goes: the ground strip shows the pile
 * in this reach, and a drop within it joins the pile this person already made (the interface pass).
 */
export const GROUND_REACH = 3 * 20;

/** Why a piece let go outside every grid goes back, where there is no ground to drop it on. */
export const NO_GROUND_HOME = 'There is no ground here to drop it on: it goes back. Things are dropped out in a world.';
export const NO_GROUND_WINDOW = 'This window has no ground behind it: it goes back. Close it, or let go over the field.';

const OK: Verdict = { ok: true };
const no = (reason: string): Verdict => ({ ok: false, reason });
const ALREADY: Verdict = no('It is already there.');

const onGrid = (p: { x?: number; y?: number }): p is { x: number; y: number } => typeof p.x === 'number' && typeof p.y === 'number';
const inHand = (held: Held): IItem[] => [held.item, ...(held.along ?? [])];
const idsInHand = (held: Held): string[] => inHand(held).map(i => i.id);

/** What the pack's own caps say about these things coming in: their whole weight, and room for one footprint. */
function packTakes(player: IPlayer, item: IItem, leaving?: IItem, along: IItem[] = []): Verdict {
  const session = player.currentSession;
  if (!session) return no('The pack is in the field.');
  const inv = session.inventory.filter(i => i.id !== leaving?.id);
  const weight = InventorySystem.totalWeight(inv) + InventorySystem.totalWeight([item, ...along]);
  const limit = LoadoutSystem.carryLimit(player.attributes.strength, player.equipment);
  if (weight > limit) return no(`The pack refuses the weight: ${weight.toFixed(1)} of ${limit} kg.`);
  const layout = { ...(session.inventoryLayout || {}) };
  if (leaving) delete layout[leaving.id];
  return InventorySystem.autoPlace(inv, layout, item)
    ? OK
    : no(`The pack is full: no room in the grid for ${LoadoutSystem.shownName(item)}.`);
}

function packCellTakes(player: IPlayer, item: IItem, x: number, y: number, rotated: boolean, moving: string[]): Verdict {
  const session = player.currentSession;
  if (!session) return no('The pack is in the field.');
  return InventorySystem.fitsAt(session.inventory, session.inventoryLayout || {}, item, x, y, rotated, GRID_W, GRID_H, moving)
    ? OK
    : no(`The pack has no room there. ${LoadoutSystem.shownName(item)} stays where it was.`);
}

function slotTakes(player: IPlayer, item: IItem, slot: EquipSlotId): Verdict {
  const equipment = player.equipment ?? LoadoutSystem.emptyEquipment();
  // A worn pouch takes what its rule names; only a pouch can sit in the slot itself.
  if (slot.startsWith('POUCH_') && !item.pouchData) {
    const pouch = LoadoutSystem.itemIn(equipment, slot);
    if (!pouch) return LoadoutSystem.canEquip(player, item, slot);
    return LoadoutSystem.canStow(pouch, item);
  }
  const currentSlot = Object.entries(equipment.slots).find(([, id]) => id === item.id)?.[0] as EquipSlotId | undefined;
  const probe = {
    ...equipment,
    slots: Object.fromEntries(Object.entries(equipment.slots).filter(([k]) => k !== slot && k !== currentSlot))
  };
  return LoadoutSystem.canEquip({ ...player, equipment: probe }, item, slot);
}

/** The whole question, with no state touched. The ghost reads this every cell it crosses. */
export function probeMove(player: IPlayer, held: Held, to: Place, world: IWorldView): Verdict {
  const { item, from } = held;
  const inField = !!player.currentSession;
  const along = held.along ?? [];
  const moving = idsInHand(held);
  // A pouch or a slot gives into the pack first, and the pack has the say
  const throughPack = from.kind === 'SLOT' || from.kind === 'POUCH';

  switch (to.kind) {
    case 'PACK': {
      if (!inField) return no('The pack is in the field.');
      if (from.kind !== 'PACK') {
        const whole = packTakes(player, item, undefined, along);
        if (!whole.ok) return whole;
      }
      if (onGrid(to)) return packCellTakes(player, item, to.x, to.y, !!to.rotated, moving);
      return from.kind === 'PACK' ? ALREADY : OK;
    }
    case 'STASH': {
      if (inField) return no('The vault is at the hub.');
      if (!onGrid(to)) return from.kind === 'STASH' ? ALREADY : OK;
      const tab = player.bank.stashTabs[0];
      const items = tab?.items.some(i => i.id === item.id) ? tab.items : [...(tab?.items ?? []), item];
      const layout = StashGrid.resolve(tab?.items ?? [], tab?.layout);
      const { w, h } = InventorySystem.footprint(item, !!to.rotated);
      return StashGrid.canPlace(items, layout, item.id, w, h, to.x, to.y, undefined, moving)
        ? OK
        : no(`The vault has something there. ${LoadoutSystem.shownName(item)} stays where it was.`);
    }
    case 'SLOT':
      return slotTakes(player, item, to.slot);
    case 'GROUND':
      if (!inField) return no(NO_GROUND_HOME);
      if (throughPack) return packTakes(player, item, undefined, along);
      return from.kind === 'CACHE' ? ALREADY : OK;
    case 'POUCH':
      return no('Stow it by setting it on the pouch itself.');
    case 'CART': {
      const cart = bodyOf(world, to.entityId)?.cart;
      if (!cart) return no('No cart there.');
      if (throughPack) {
        const whole = packTakes(player, item, undefined, along);
        if (!whole.ok) return whole;
      }
      if (onGrid(to)) {
        const items = cart.items.some(i => i.id === item.id) ? cart.items : [...cart.items, item];
        return InventorySystem.fitsAt(items, cart.layout, item, to.x, to.y, !!to.rotated, cart.gridW, cart.gridH, moving)
          ? OK
          : no(`The cart bed has no room there. ${LoadoutSystem.shownName(item)} stays where it was.`);
      }
      if (from.kind === 'CART') return ALREADY;
      return CartSystem.canLoad(cart, item);
    }
    case 'KIT':
      if (inField) return no('The kit is packed at the hub.');
      if ((item.tags || []).includes('tool')) return no('Tools always ride.');
      return (player.bank.carryItemIds ?? []).includes(item.id) ? ALREADY : OK;
    case 'CACHE':
      return no('A cache takes what you leave on the ground. Drop it there.');
    case 'ONTO': {
      // Both lie in one grid: what is in a hand, a cart or a cache is set down first
      if (from.kind !== to.grid || (to.grid === 'CART' && (from.kind !== 'CART' || from.entityId !== to.entityId))) {
        return no('Set it down beside the other first. Two things are worked together where they both lie.');
      }
      const beside = to.grid === 'PACK' ? player.currentSession?.inventory ?? []
        : to.grid === 'CART' ? bodyOf(world, to.entityId ?? '')?.cart?.items ?? []
          : player.bank.stashTabs[0]?.items ?? [];
      const onto = beside.find(i => i.id === to.targetId);
      if (!onto) return no('There is nothing there to set it on.');
      const may = PairCraft.mayCombine(item, onto);
      if (!may.ok) return may;
      const left = player.currentSession?.energy ?? player.energyToday ?? Infinity;
      const cost = WorkCost.make(player, item, onto);
      return left < cost ? no(`Refused: needs ${cost} energy, you hold ${Math.floor(left)}. Rest first.`) : OK;
    }
  }
}

/** Off the source and into the pack, whichever door that source has. */
function intoPack(held: Held, pc: IPlayerPort): Verdict {
  switch (held.from.kind) {
    case 'SLOT': return pc.unequipFromSlot(held.from.slot);
    case 'CART': return pc.unloadCart(held.from.entityId, held.item.id);
    case 'CACHE': return pc.takeFromCache(held.from.entityId, held.item.id);
    case 'POUCH': return pc.takeFromPouch(held.from.slot);
    default: return OK;
  }
}

/**
 * A stack in hand (the interface pass): each piece walks the same doors one after another, so every
 * count, journal line and refusal still sees each thing, then the stack is laid down on its cell at once.
 * The laws were asked for the whole first, so it is never half done for want of weight or room.
 */
function commitStack(held: Held, to: Place, world: IWorldView, pc: IPlayerPort): Verdict {
  const pieces = inHand(held);
  const ids = pieces.map(i => i.id);
  const each = (piece: IItem): Held => ({ item: piece, from: held.from, rotated: held.rotated });
  switch (to.kind) {
    case 'PACK': {
      for (const piece of pieces) { const came = intoPack(each(piece), pc); if (!came.ok) return came; }
      return onGrid(to) ? pc.placeInPack(held.item.id, to.x, to.y, !!to.rotated, ids) : OK;
    }
    case 'STASH':
      return onGrid(to) ? pc.placeInStash(held.item.id, to.x, to.y, !!to.rotated, ids) : OK;
    case 'GROUND':
      for (const piece of pieces) {
        const came = intoPack(each(piece), pc);
        if (!came.ok) return came;
        // One line for the whole stack, said on its last piece
        const last = piece === pieces[pieces.length - 1];
        pc.apply({ kind: 'DROP_ITEM', itemId: piece.id, quiet: !last, count: last ? pieces.length : undefined });
      }
      return OK;
    case 'CART': {
      if (held.from.kind === 'CART') return onGrid(to) ? pc.placeOnCart(to.entityId, held.item.id, to.x, to.y, !!to.rotated, ids) : OK;
      for (const piece of pieces) {
        const came = intoPack(each(piece), pc);
        if (!came.ok) return came;
        const loaded = pc.loadCart(to.entityId, piece.id);
        if (!loaded.ok) return loaded;
      }
      return onGrid(to) ? pc.placeOnCart(to.entityId, held.item.id, to.x, to.y, !!to.rotated, ids) : OK;
    }
    case 'KIT': {
      const carried = pc.view().player.bank.carryItemIds ?? [];
      for (const piece of pieces) if (!carried.includes(piece.id)) pc.apply({ kind: 'TOGGLE_CARRY', itemId: piece.id });
      return OK;
    }
    // One piece at a time is worn, stowed, or worked into another: the rest of the stack stays where it lay
    default:
      return commitMove({ ...held, along: undefined }, to, world, pc);
  }
}

/** Through the store's doors. A refused move has moved nothing. */
export function commitMove(held: Held, to: Place, world: IWorldView, pc: IPlayerPort): Verdict {
  const verdict = probeMove(pc.view().player, held, to, world);
  if (!verdict.ok) return verdict;
  if ((held.along?.length ?? 0) > 0) return commitStack(held, to, world, pc);
  const { item } = held;

  switch (to.kind) {
    case 'PACK': {
      const came = intoPack(held, pc);
      if (!came.ok) return came;
      return onGrid(to) ? pc.placeInPack(item.id, to.x, to.y, !!to.rotated) : OK;
    }
    case 'STASH': {
      if (held.from.kind === 'SLOT') {
        const off = pc.unequipFromSlot(held.from.slot);
        if (!off.ok) return off;
      }
      if (held.from.kind === 'POUCH') {
        const off = pc.takeFromPouch(held.from.slot);
        if (!off.ok) return off;
      }
      return onGrid(to) ? pc.placeInStash(item.id, to.x, to.y, !!to.rotated) : OK;
    }
    case 'SLOT': {
      if (to.slot.startsWith('POUCH_') && !item.pouchData) {
        const came = intoPack(held, pc);
        if (!came.ok) return came;
        return pc.stowInPouch(to.slot, item.id);
      }
      if (held.from.kind === 'CART' || held.from.kind === 'CACHE' || held.from.kind === 'POUCH') {
        const came = intoPack(held, pc);
        if (!came.ok) return came;
      }
      return pc.equipSwap(item.id, to.slot);
    }
    case 'GROUND': {
      const came = intoPack(held, pc);
      if (!came.ok) return came;
      pc.apply({ kind: 'DROP_ITEM', itemId: item.id });
      return OK;
    }
    case 'CART': {
      if (held.from.kind === 'CART') {
        return pc.placeOnCart(to.entityId, item.id, to.x!, to.y!, !!to.rotated);
      }
      const came = intoPack(held, pc);
      if (!came.ok) return came;
      const loaded = pc.loadCart(to.entityId, item.id);
      if (!loaded.ok || !onGrid(to)) return loaded;
      return pc.placeOnCart(to.entityId, item.id, to.x, to.y, !!to.rotated);
    }
    case 'KIT':
      pc.apply({ kind: 'TOGGLE_CARRY', itemId: item.id });
      return OK;
    case 'CACHE':
    case 'POUCH':
      return verdict;
    case 'ONTO':
      return pc.combine(item.id, to.targetId, to.grid === 'CART' ? to.entityId : undefined);
  }
}

// ---------------------------------------------------------------------------
// THE GHOST: valid or invalid by shape and seam. One ink for both, never a hue.
// ---------------------------------------------------------------------------

export function ghostStyle(valid: boolean): { outlineStyle: 'solid' | 'dashed'; outlineColor: string; outlineWidth: number } {
  return { outlineStyle: valid ? 'solid' : 'dashed', outlineColor: 'var(--ws-text-bright)', outlineWidth: 2 };
}

/** The keyboard path: one step on the grid, held inside its edges by the footprint. */
export function stepGhost(at: Place, dx: number, dy: number, item: IItem, gridW = GRID_W, gridH = GRID_H): Place {
  if (at.kind !== 'PACK' && at.kind !== 'STASH' && at.kind !== 'CART') return at;
  const { w, h } = InventorySystem.footprint(item, !!at.rotated);
  const clamp = (v: number, max: number) => Math.max(0, Math.min(Math.max(0, max), v));
  return { ...at, x: clamp((at.x ?? 0) + dx, gridW - w), y: clamp((at.y ?? 0) + dy, gridH - h) };
}
