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
import { usePlayerStore } from '../../entities/player/store';
import { useWorldStore } from '../../entities/world/store';

export type Place =
  | { kind: 'PACK'; x?: number; y?: number; rotated?: boolean }
  | { kind: 'STASH'; x?: number; y?: number; rotated?: boolean }
  | { kind: 'SLOT'; slot: EquipSlotId }
  | { kind: 'CART'; entityId: string; x?: number; y?: number; rotated?: boolean }
  | { kind: 'CACHE'; entityId: string }
  | { kind: 'GROUND' }
  | { kind: 'KIT' };

export interface Held { item: IItem; from: Place; rotated: boolean }

const OK: Verdict = { ok: true };
const no = (reason: string): Verdict => ({ ok: false, reason });
const ALREADY: Verdict = no('It is already there.');

const worldEntity = (id: string): IWorldEntity | undefined =>
  Object.values(useWorldStore.getState().currentMap?.chunks ?? {}).flatMap(c => c.entities).find(e => e.id === id);

const onGrid = (p: { x?: number; y?: number }): p is { x: number; y: number } => typeof p.x === 'number' && typeof p.y === 'number';

/** What the pack's own caps say about one more thing coming in. */
function packTakes(player: IPlayer, item: IItem, leaving?: IItem): Verdict {
  const session = player.currentSession;
  if (!session) return no('The pack is in the field.');
  const inv = session.inventory.filter(i => i.id !== leaving?.id);
  const weight = InventorySystem.totalWeight(inv) + InventorySystem.totalWeight([item]);
  const limit = LoadoutSystem.carryLimit(player.attributes.strength, player.equipment);
  if (weight > limit) return no(`The pack refuses the weight: ${weight.toFixed(1)} of ${limit} kg.`);
  const layout = { ...(session.inventoryLayout || {}) };
  if (leaving) delete layout[leaving.id];
  return InventorySystem.autoPlace(inv, layout, item)
    ? OK
    : no(`The pack refuses ${LoadoutSystem.shownName(item)}: no room in the grid.`);
}

function packCellTakes(player: IPlayer, item: IItem, x: number, y: number, rotated: boolean): Verdict {
  const session = player.currentSession;
  if (!session) return no('The pack is in the field.');
  const { w, h } = InventorySystem.footprint(item, rotated);
  const occ = InventorySystem.buildOccupancy(session.inventory, session.inventoryLayout || {});
  return InventorySystem.canPlaceAt(occ, w, h, x, y, item.id)
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
export function probeMove(player: IPlayer, held: Held, to: Place): Verdict {
  const { item, from } = held;
  const inField = !!player.currentSession;

  switch (to.kind) {
    case 'PACK': {
      if (!inField) return no('The pack is in the field.');
      if (from.kind !== 'PACK') {
        const whole = packTakes(player, item);
        if (!whole.ok) return whole;
      }
      if (onGrid(to)) return packCellTakes(player, item, to.x, to.y, !!to.rotated);
      return from.kind === 'PACK' ? ALREADY : OK;
    }
    case 'STASH': {
      if (inField) return no('The vault is at the hub.');
      if (!onGrid(to)) return from.kind === 'STASH' ? ALREADY : OK;
      const tab = player.bank.stashTabs[0];
      const layout = StashGrid.resolve(tab?.items ?? [], tab?.layout);
      const { w, h } = InventorySystem.footprint(item, !!to.rotated);
      return StashGrid.canPlace(tab?.items ?? [], layout, item.id, w, h, to.x, to.y)
        ? OK
        : no(`The vault has something there. ${LoadoutSystem.shownName(item)} stays where it was.`);
    }
    case 'SLOT':
      return slotTakes(player, item, to.slot);
    case 'GROUND':
      if (!inField) return no('There is no ground in the vault.');
      if (from.kind === 'SLOT') return packTakes(player, item);
      return from.kind === 'CACHE' ? ALREADY : OK;
    case 'CART': {
      const cart = worldEntity(to.entityId)?.cart;
      if (!cart) return no('No cart there.');
      if (from.kind === 'SLOT') {
        const whole = packTakes(player, item);
        if (!whole.ok) return whole;
      }
      if (onGrid(to)) {
        const { w, h } = InventorySystem.footprint(item, !!to.rotated);
        const occ = InventorySystem.buildOccupancy(cart.items, cart.layout, cart.gridW, cart.gridH);
        return InventorySystem.canPlaceAt(occ, w, h, to.x, to.y, item.id)
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
  }
}

/** Off the source and into the pack, whichever door that source has. */
function intoPack(held: Held): Verdict {
  const st = usePlayerStore.getState();
  switch (held.from.kind) {
    case 'SLOT': return st.unequipFromSlot(held.from.slot);
    case 'CART': return st.unloadCart(held.from.entityId, held.item.id);
    case 'CACHE': return st.takeFromCache(held.from.entityId, held.item.id);
    default: return OK;
  }
}

/** Through the store's doors. A refused move has moved nothing. */
export function commitMove(held: Held, to: Place): Verdict {
  const st = usePlayerStore.getState();
  const verdict = probeMove(st.player, held, to);
  if (!verdict.ok) return verdict;
  const { item } = held;

  switch (to.kind) {
    case 'PACK': {
      const came = intoPack(held);
      if (!came.ok) return came;
      return onGrid(to) ? usePlayerStore.getState().placeInPack(item.id, to.x, to.y, !!to.rotated) : OK;
    }
    case 'STASH': {
      if (held.from.kind === 'SLOT') {
        const off = st.unequipFromSlot(held.from.slot);
        if (!off.ok) return off;
      }
      return onGrid(to) ? usePlayerStore.getState().placeInStash(item.id, to.x, to.y, !!to.rotated) : OK;
    }
    case 'SLOT': {
      if (to.slot.startsWith('POUCH_') && !item.pouchData) {
        const came = intoPack(held);
        if (!came.ok) return came;
        return usePlayerStore.getState().stowInPouch(to.slot, item.id);
      }
      if (held.from.kind === 'CART' || held.from.kind === 'CACHE') {
        const came = intoPack(held);
        if (!came.ok) return came;
      }
      return usePlayerStore.getState().equipSwap(item.id, to.slot);
    }
    case 'GROUND': {
      const came = intoPack(held);
      if (!came.ok) return came;
      usePlayerStore.getState().dropItem(item.id);
      return OK;
    }
    case 'CART': {
      if (held.from.kind === 'CART') {
        return usePlayerStore.getState().placeOnCart(to.entityId, item.id, to.x!, to.y!, !!to.rotated);
      }
      const came = intoPack(held);
      if (!came.ok) return came;
      const loaded = usePlayerStore.getState().loadCart(to.entityId, item.id);
      if (!loaded.ok || !onGrid(to)) return loaded;
      return usePlayerStore.getState().placeOnCart(to.entityId, item.id, to.x, to.y, !!to.rotated);
    }
    case 'KIT':
      st.toggleCarry(item.id);
      return OK;
    case 'CACHE':
      return verdict;
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
