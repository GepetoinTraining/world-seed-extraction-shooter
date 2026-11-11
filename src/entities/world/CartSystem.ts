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

import { IItem, ItemType } from '../../../shared/types';
import { ICartState, ICartTheft } from '../../../shared/entities/world/types';
import { InventorySystem } from '../../../shared/entities/player/systems/InventorySystem';
import { LoadoutSystem, Verdict } from '../../../shared/entities/player/systems/LoadoutSystem';
import { ItemFactory } from '../../../shared/entities/item/ItemFactory';
import { cartFolded, cartNumbers } from '../../../shared/logic/theme/ThemeFormula';
import { Rng } from '../../../shared/logic/rng/DeterministicRNG';

const OK: Verdict = { ok: true };
const no = (reason: string): Verdict => ({ ok: false, reason });

export class CartSystem {

  /** Unfold a packed cart kit into a world cart under its owner's name. */
  static newCart(kitItem: IItem, ownerId: string, ownerName: string): ICartState {
    // A kit with no bed of its own (one minted before) reads the formula's default, the first world's 10 by 8
    const grid = kitItem.cartData ?? cartNumbers({});
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
        : {}),
      // The interface pass: what it is, weighs and bears, and the kit itself, so it folds back the same
      ...(grid.size !== undefined ? { size: grid.size } : {}),
      ...(grid.weight !== undefined ? { weight: grid.weight } : {}),
      ...(grid.bears !== undefined ? { bears: grid.bears } : {}),
      kit: kitItem
    };
  }

  /**
   * Fold a cart back into its kit: the very piece that was unfolded, its name, rank, quality and
   * affixes with it, so unfolding it again gives the same cart (the interface pass; the fold once wrote
   * a weight and a footprint by hand and dropped the rest). A cart saved before it kept its kit is
   * rebuilt from what the cart still says, as it always was.
   */
  static fold(cart: ICartState): IItem {
    if (cart.kit) return { ...cart.kit, id: cart.cartItemId };
    const folded = cartFolded(cart.size);
    return {
      ...ItemFactory.createResourceItem({
        id: 'cart_field_t1', name: 'Field Cart (Packed)', weight: cart.weight ?? 15,
        dimensions: folded, tags: ['cart', 'heavy']
      } as never, Rng.fromKey(`cartfold:${cart.cartItemId}`)),
      id: cart.cartItemId,
      type: ItemType.GEAR,
      cartData: { gridW: cart.gridW, gridH: cart.gridH, ...(cart.size ? { size: cart.size } : {}), ...(cart.weight !== undefined ? { weight: cart.weight } : {}), ...(cart.bears !== undefined ? { bears: cart.bears } : {}) }
    };
  }

  /** This cart's tow pace: what is aboard, against what this cart bears. */
  static towOf(cart: ICartState): number {
    return LoadoutSystem.towSpeedModifier(this.cartWeight(cart), cart.bears ?? 0);
  }

  /** What the cart's window says of it, in words: the bed, its weight and load, the lock, the alarm. */
  static describe(cart: ICartState): { bed: string; weight: string; bears: string; lock: string; alarm: string } {
    const lock = cart.security?.lockLevel ?? 0;
    return {
      bed: `${cart.size ? `a ${cart.size.toLowerCase()} cart, ` : ''}its bed ${cart.gridW} by ${cart.gridH}`,
      weight: cart.weight !== undefined ? `weighs ${cart.weight} kg folded` : 'its own weight unknown, from before carts were weighed',
      bears: (cart.bears ?? 0) > 0 ? `bears ${cart.bears} kg aboard before the tow slows` : 'slows the tow from the first kilo aboard',
      lock: lock > 0
        ? `LOCK, level ${lock}: another hand spends ${this.towBreakSeconds(lock)}s breaking it before the bar gives`
        : 'NO LOCK: any hand may take the bar at once',
      alarm: cart.security?.alarm
        ? 'ALARM: it shrieks across the field when another hand takes the bar'
        : 'NO ALARM: a theft is silent, though always signed'
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
    if (cart.items.some(i => i.id === item.id)) return no(`${LoadoutSystem.shownName(item)} is already aboard.`);
    const place = InventorySystem.autoPlace(cart.items, cart.layout, item, cart.gridW, cart.gridH);
    if (!place) return no(`The cart bed is full. ${LoadoutSystem.shownName(item)} does not fit the grid.`);
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

  /** Set an item aboard down on a chosen cell. Null when the grid refuses, and nothing moved. */
  static placeAt(cart: ICartState, itemId: string, x: number, y: number, rotated: boolean, along: string[] = [itemId]): ICartState | null {
    const item = cart.items.find(i => i.id === itemId);
    if (!item) return null;
    // Like things stack (the interface pass): a stack in hand moves whole, onto its like if it lies there
    const moving = along.includes(itemId) ? along : [itemId, ...along];
    if (!InventorySystem.fitsAt(cart.items, cart.layout, item, x, y, rotated, cart.gridW, cart.gridH, moving)) return null;
    const layout = { ...cart.layout };
    for (const id of moving) if (cart.items.some(i => i.id === id)) layout[id] = { x, y, rotated };
    return { ...cart, layout };
  }

  /**
   * Turn a piece on the bed, and its stack with it: where it lies when the turned shape fits, else
   * at the nearest place it does (ledger H1b: the bed had no key and no button to turn a piece).
   */
  static rotate(cart: ICartState, itemId: string): ICartState | null {
    const stack = InventorySystem.stackOf(cart.items, cart.layout, itemId);
    const alone = cart.items.filter(i => i.id === itemId || !stack.includes(i.id));
    const turned = InventorySystem.tryRotate(alone, cart.layout, itemId, cart.gridW, cart.gridH);
    if (!turned) return null;
    const layout = { ...cart.layout };
    for (const id of stack) layout[id] = turned;
    return { ...cart, layout };
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
