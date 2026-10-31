/**
 * CART SYSTEM (Wave 10C, D16)
 *
 * The extractor's tool, and the leg's heart. A cart is a towed WORLD ENTITY
 * with its own grid, bigger than any pack: load it, tow it at a real speed
 * cost, leave it, come back for it. It stays in the world when you die or
 * extract without it, your seal on record — and anyone may tow it away, the
 * theft a signed fact. Pure functions over ICartState; the stores own state.
 *
 * Pedro's addendum on record: the theft risk is on purpose — it opens the
 * security-affix family (locks, wards, alarms) for 10E's banks to grow into.
 */

import { IItem } from '../../../types';
import { ICartState, ICartTheft } from './types';
import { InventorySystem } from '../player/systems/InventorySystem';
import { LoadoutSystem, Verdict } from '../player/systems/LoadoutSystem';

const OK: Verdict = { ok: true };
const no = (reason: string): Verdict => ({ ok: false, reason });

export class CartSystem {

  /** Unfold a packed cart kit into a world cart under its owner's name. */
  static newCart(kitItem: IItem, ownerId: string, ownerName: string): ICartState {
    const grid = kitItem.cartData ?? { gridW: 10, gridH: 8 };
    const security = this.securityOf(kitItem);
    return {
      cartItemId: kitItem.id,
      ownerId,
      ownerName,
      gridW: grid.gridW,
      gridH: grid.gridH,
      items: [],
      layout: {},
      theftLog: [],
      // 10E (D16's addendum): the kit's security affixes stand on the unfolded cart
      ...(security.lockLevel > 0 || security.alarm
        ? { security: { ...security, by: kitItem.affixes.map(a => a.name).join(', ') } }
        : {})
    };
  }

  // ---------------------------------------------------------------------
  // 10E (D16's addendum): SECURITY AFFIXES — the banks grew the lock family
  // ---------------------------------------------------------------------

  /** What the kit's affixes ward: a lock level and an alarm, from the banked stats. */
  static securityOf(kitItem: IItem | undefined): { lockLevel: number; alarm: boolean } {
    let lockLevel = 0;
    let alarm = false;
    for (const affix of kitItem?.affixes ?? []) {
      lockLevel += affix.stats['cart_lock'] ?? 0;
      if ((affix.stats['cart_alarm'] ?? 0) > 0) alarm = true;
    }
    return { lockLevel: Math.max(0, Math.round(lockLevel)), alarm };
  }

  /** Breaking a lock is TIME, like every honest crime here. The owner pays none. */
  static towBreakSeconds(lockLevel: number): number {
    return Math.max(0, lockLevel) * 10;
  }

  /** Everything aboard, in kg. Towing pays for this; the carry limit never does. */
  static cartWeight(cart: ICartState): number {
    return parseFloat(cart.items.reduce((s, i) => s + (i.weight || 0), 0).toFixed(1));
  }

  /** One law for the cost of towing (shared with the movement loop). */
  static towSpeedModifier(cartWeightKg: number): number {
    return LoadoutSystem.towSpeedModifier(cartWeightKg);
  }

  static canLoad(cart: ICartState, item: IItem): Verdict {
    if (cart.items.some(i => i.id === item.id)) return no(`${item.name} is already aboard.`);
    const place = InventorySystem.autoPlace(cart.items, cart.layout, item, cart.gridW, cart.gridH);
    if (!place) return no(`The cart bed is full. ${item.name} does not fit the grid.`);
    return OK;
  }

  /** Load one item. Returns the new cart, or null when the grid refuses. */
  static load(cart: ICartState, item: IItem): ICartState | null {
    if (cart.items.some(i => i.id === item.id)) return null;
    const place = InventorySystem.autoPlace(cart.items, cart.layout, item, cart.gridW, cart.gridH);
    if (!place) return null;
    return {
      ...cart,
      items: [...cart.items, item],
      layout: { ...cart.layout, [item.id]: place }
    };
  }

  /** Unload one item by id. Returns the new cart, or null when it is not aboard. */
  static unload(cart: ICartState, itemId: string): ICartState | null {
    if (!cart.items.some(i => i.id === itemId)) return null;
    const layout = { ...cart.layout };
    delete layout[itemId];
    return {
      ...cart,
      items: cart.items.filter(i => i.id !== itemId),
      layout
    };
  }

  /**
   * D16: anyone may tow it away — and the theft is a signed fact. Towing your
   * own cart signs nothing. The owner's claim is never erased; the log grows.
   */
  static async recordTheft(cart: ICartState, towedBy: string, towedByName: string): Promise<ICartState> {
    if (towedBy === cart.ownerId) return cart;
    const theft: ICartTheft = { by: towedBy, byName: towedByName, at: Date.now() };
    // 10E (D16's addendum): a broken lock is part of the signed fact
    if ((cart.security?.lockLevel ?? 0) > 0) theft.brokeLock = cart.security!.lockLevel;
    try {
      const { CertificateSystem } = await import('../identity/certificateSystem');
      const signed = await CertificateSystem.signPayload(towedBy, {
        kind: 'CART_THEFT',
        cartItemId: cart.cartItemId,
        owner: cart.ownerId,
        thief: towedBy,
        at: theft.at
      });
      theft.signature = signed.signature;
    } catch {
      // No certificate at hand: the fact still stands, unsigned (the log says so)
    }
    return { ...cart, theftLog: [...cart.theftLog, theft] };
  }
}
