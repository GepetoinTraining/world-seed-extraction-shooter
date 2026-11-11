/**
 * INVENTORY SYSTEM (Wave 3)
 *
 * The body is real: two independent caps, both enforced on every pickup.
 *   SPACE  — items occupy width x height cells of an 8x6 grid (rotatable)
 *   WEIGHT — capacity derives from strength; load changes movement speed
 *
 * Every function here is pure: (items, layout) in, answer out. The store
 * owns state, the canvas renders, this file only does geometry and arithmetic.
 * The donor engines had weight+volume caps but no spatial grid — the grid
 * is ours (ttrpg engine survey: "the tetris part is yours to design").
 */

import { IItem, IGridPlacement, ItemType } from '../../../types';

export const GRID_W = 8;
export const GRID_H = 6;

// Encumbrance thresholds (PLAN W3.2)
export const HEAVY_LOAD_RATIO = 0.8;  // above this: slowed
export const HEAVY_SPEED_MOD = 0.5;

export type Layout = Record<string, IGridPlacement>;

export class InventorySystem {

  /** Carry capacity in kg: a base plus strength. */
  static maxCarryWeight(strength: number): number {
    return 30 + strength * 10;
  }

  static totalWeight(items: IItem[]): number {
    // Wave 10C: a pouch in the pack weighs what it holds, too
    return parseFloat(items.reduce((s, i) =>
      s + (i.weight || 0) + (i.pouchData?.contents.reduce((p, c) => p + (c.weight || 0), 0) ?? 0), 0).toFixed(1));
  }

  /** Movement multiplier from load. At/over cap you can barely walk. */
  static speedModifier(currentWeight: number, maxWeight: number): number {
    if (maxWeight <= 0) return 1.0;
    const ratio = currentWeight / maxWeight;
    if (ratio > 1.0) return 0.3;          // should not happen (hard cap), but be safe
    if (ratio > HEAVY_LOAD_RATIO) return HEAVY_SPEED_MOD;
    return 1.0;
  }

  /** An item's grid footprint, honoring rotation. */
  static footprint(item: IItem, rotated: boolean): { w: number; h: number } {
    const d = item.dimensions || { width: 1, height: 1 };
    return rotated ? { w: d.height, h: d.width } : { w: d.width, h: d.height };
  }

  /**
   * Occupancy matrix: cell -> itemId | null. Items without placement are skipped.
   * Wave 10C: the grid size is a parameter so the cart's larger grid (D16)
   * runs through the same geometry; the pack's 8x6 stays the default.
   */
  static buildOccupancy(items: IItem[], layout: Layout, gridW = GRID_W, gridH = GRID_H): (string | null)[][] {
    const grid: (string | null)[][] = Array.from({ length: gridH }, () => Array(gridW).fill(null));
    for (const item of items) {
      const place = layout[item.id];
      if (!place) continue;
      const { w, h } = this.footprint(item, place.rotated);
      for (let dy = 0; dy < h; dy++) {
        for (let dx = 0; dx < w; dx++) {
          const gx = place.x + dx, gy = place.y + dy;
          if (gy >= 0 && gy < gridH && gx >= 0 && gx < gridW) grid[gy][gx] = item.id;
        }
      }
    }
    return grid;
  }

  /** Can a w x h footprint sit at (x, y), ignoring cells owned by ignoreId? */
  static canPlaceAt(occ: (string | null)[][], w: number, h: number, x: number, y: number, ignoreId?: string): boolean {
    const gridH = occ.length, gridW = occ[0]?.length ?? 0;
    if (x < 0 || y < 0 || x + w > gridW || y + h > gridH) return false;
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        const cell = occ[y + dy][x + dx];
        if (cell !== null && cell !== ignoreId) return false;
      }
    }
    return true;
  }

  // ---------------------------------------------------------------------------
  // LIKE THINGS STACK (the interface pass, 2026-11-11). Pedro: "an overall better inventory tetris
  // system would be good". Every piece stays its own thing in the list, so whatever counts, sells,
  // crafts, drops or throws still sees each one; a stack is only where things lie: like pieces share
  // one placement and one footprint. No count caps it. The weight does.
  // ---------------------------------------------------------------------------

  /**
   * What makes two pieces one stack: the same kind, rank and rarity, the same quality as the card
   * shows it (a whole percent), read or unread alike, the same size and weight, and nothing of their
   * own: no affix, no ability, no pouch, cage, charm, cart, bond, deed or map. Null: never stacks.
   */
  static stackKey(item: IItem): string | null {
    if (item.type !== ItemType.RESOURCE && item.type !== ItemType.CONSUMABLE) return null;
    if ((item.affixes ?? []).length > 0 || item.carries || item.pouchData || item.beltData || item.cartData || item.charmData ||
      item.scrollData || item.creatureData || item.bondData || item.deedData || item.worldDeedData || item.mapData ||
      item.farmLine || item.loreData || item.toolData || item.requirements) return null;
    if ((item.tags ?? []).some(t => t === 'corpse' || t === 'npc_contract' || t === 'tool')) return null;
    if ((item.stats as Record<string, number> | undefined)?.maxDurability) return null;
    const d = item.dimensions || { width: 1, height: 1 };
    return [
      item.universalDefinitionId, item.name, item.type, item.rank, item.rarity, Math.round((item.quality ?? 0) * 100),
      item.isIdentified === false ? 'unread' : 'read', `${d.width}x${d.height}`, item.weight ?? 0, item.casts ?? '',
      item.binPrice ?? '', JSON.stringify(item.composition ?? null)
    ].join('|');
  }

  /**
   * Can this piece lie at (x, y)? Free cells, or exactly on a stack of its like with the same shape.
   * `moving` are the pieces in hand: they are lifted, so where they lay blocks nothing.
   */
  static fitsAt(items: IItem[], layout: Layout, item: IItem, x: number, y: number, rotated: boolean,
    gridW = GRID_W, gridH = GRID_H, moving: string[] = [item.id]): boolean {
    const { w, h } = this.footprint(item, rotated);
    if (x < 0 || y < 0 || x + w > gridW || y + h > gridH) return false;
    const lifted = new Set(moving);
    const key = this.stackKey(item);
    for (const other of items) {
      if (lifted.has(other.id) || other.id === item.id) continue;
      const p = layout[other.id];
      if (!p) continue;
      const f = this.footprint(other, p.rotated);
      if (!(p.x < x + w && x < p.x + f.w && p.y < y + h && y < p.y + f.h)) continue;
      if (key !== null && p.x === x && p.y === y && f.w === w && f.h === h && this.stackKey(other) === key) continue;
      return false;
    }
    return true;
  }

  /** The pieces that lie as one stack with this one, itself among them, in the list's order. */
  static stackOf(items: IItem[], layout: Layout, itemId: string): string[] {
    const item = items.find(i => i.id === itemId);
    const at = layout[itemId];
    const key = item ? this.stackKey(item) : null;
    if (!item || !at || key === null) return item ? [itemId] : [];
    return items.filter(o => {
      const p = layout[o.id];
      return !!p && p.x === at.x && p.y === at.y && p.rotated === at.rotated && this.stackKey(o) === key;
    }).map(o => o.id);
  }

  /** One entry per footprint that holds something: its first piece, and every piece lying there. */
  static stacks(items: IItem[], layout: Layout): { head: IItem; ids: string[] }[] {
    const out: { head: IItem; ids: string[] }[] = [];
    const at = new Map<string, { head: IItem; ids: string[] }>();
    for (const item of items) {
      const p = layout[item.id];
      if (!p) continue;
      const key = this.stackKey(item);
      const spot = key === null ? `one:${item.id}` : `${p.x},${p.y},${p.rotated}|${key}`;
      const found = at.get(spot);
      if (found) { found.ids.push(item.id); continue; }
      const entry = { head: item, ids: [item.id] };
      at.set(spot, entry);
      out.push(entry);
    }
    return out;
  }

  /** Full: not one cell left free. */
  static isFull(items: IItem[], layout: Layout, gridW = GRID_W, gridH = GRID_H): boolean {
    return this.buildOccupancy(items, layout, gridW, gridH).every(row => row.every(c => c !== null));
  }

  /**
   * Lay pieces down in the order given, like ones joining their stack, each where it first fits.
   * Null when they cannot all lie: an arranging never leaves a piece without a place.
   */
  static packInOrder(order: IItem[], gridW = GRID_W, gridH = GRID_H): Layout | null {
    const layout: Layout = {};
    const placed: IItem[] = [];
    for (const item of order) {
      const p = this.autoPlace(placed, layout, item, gridW, gridH);
      if (!p) return null;
      layout[item.id] = p;
      placed.push(item);
    }
    return layout;
  }

  /** The load in words, so no tone has to say it alone. */
  static loadWord(weight: number, limit: number): string {
    if (limit > 0 && weight > limit) return 'OVER THE LIMIT';
    if (limit > 0 && weight / limit > HEAVY_LOAD_RATIO) return 'SLOWED';
    return '';
  }

  /** First-fit placement: onto a stack of its like first, then unrotated, then rotated. Null = no room. */
  static autoPlace(items: IItem[], layout: Layout, item: IItem, gridW = GRID_W, gridH = GRID_H): IGridPlacement | null {
    const key = this.stackKey(item);
    if (key !== null) {
      const like = items.find(o => o.id !== item.id && layout[o.id] && this.stackKey(o) === key);
      if (like) return { ...layout[like.id] };
    }
    const occ = this.buildOccupancy(items, layout, gridW, gridH);
    for (const rotated of [false, true]) {
      const { w, h } = this.footprint(item, rotated);
      if (rotated && w === h) continue; // square: rotation changes nothing
      for (let y = 0; y <= gridH - h; y++) {
        for (let x = 0; x <= gridW - w; x++) {
          if (this.canPlaceAt(occ, w, h, x, y)) return { x, y, rotated };
        }
      }
    }
    return null;
  }

  /** Greedy layout for a whole list (hydration / layout repair). Unplaceable items are omitted. */
  static placeAll(items: IItem[], gridW = GRID_W, gridH = GRID_H): Layout {
    const layout: Layout = {};
    const placed: IItem[] = [];
    // Big items first: greedy packs better
    const sorted = [...items].sort((a, b) => {
      const fa = this.footprint(a, false), fb = this.footprint(b, false);
      return (fb.w * fb.h) - (fa.w * fa.h);
    });
    for (const item of sorted) {
      const p = this.autoPlace(placed, layout, item, gridW, gridH);
      if (p) {
        layout[item.id] = p;
        placed.push(item);
      }
    }
    return layout;
  }

  /**
   * Turn an item: where it lies when the turned shape fits there, and otherwise at the nearest
   * place it does fit. Found by Pedro in his own run ("rotate needs to be fixed"): a pack is filled
   * first-fit, so a piece nearly always has a neighbour where its turned shape would lie, and a turn
   * that only ever tried in place did nothing, with nothing said. Null when the grid has no room for
   * it turned anywhere. `fits` lets a grid with its own geometry (the vault) answer for itself.
   */
  static tryRotate(
    items: IItem[], layout: Layout, itemId: string, gridW = GRID_W, gridH = GRID_H,
    fits?: (w: number, h: number, x: number, y: number) => boolean
  ): IGridPlacement | null {
    const item = items.find(i => i.id === itemId);
    const place = layout[itemId];
    if (!item || !place) return null;
    const { w, h } = this.footprint(item, !place.rotated);
    const occ = fits ? null : this.buildOccupancy(items, layout, gridW, gridH);
    const free = fits ?? ((fw: number, fh: number, x: number, y: number) => this.canPlaceAt(occ!, fw, fh, x, y, itemId));
    let best: IGridPlacement | null = null;
    let bestFar = Infinity;
    for (let y = 0; y <= gridH - h; y++) {
      for (let x = 0; x <= gridW - w; x++) {
        const far = Math.abs(x - place.x) + Math.abs(y - place.y);
        if (far < bestFar && free(w, h, x, y)) { best = { x, y, rotated: !place.rotated }; bestFar = far; }
      }
    }
    return best;
  }

  static usedCells(items: IItem[], layout: Layout): number {
    return this.buildOccupancy(items, layout).flat().filter(c => c !== null).length;
  }

  /**
   * SELF-TEST (dev boot, goldens-style — a real runner arrives with Wave 7).
   * Exercises the geometry invariants; returns failures.
   */
  static selfTest(): string[] {
    const fails: string[] = [];
    const mk = (id: string, w: number, h: number, weight = 1): IItem =>
      ({ id, dimensions: { width: w, height: h }, weight } as IItem);

    // 1. autoPlace fills a row left to right
    const a = mk('a', 2, 2), b = mk('b', 2, 2);
    const l1: Layout = {};
    const pa = this.autoPlace([], l1, a); if (pa) l1['a'] = pa;
    const pb = this.autoPlace([a], l1, b); if (pb) l1['b'] = pb;
    if (!pa || pa.x !== 0 || pa.y !== 0) fails.push('first item not at origin');
    if (!pb || pb.x !== 2 || pb.y !== 0) fails.push('second item not adjacent');

    // 2. a full grid refuses the next item (48 cells of 2x2 = 12 items)
    const twos = Array.from({ length: 12 }, (_, i) => mk(`t${i}`, 2, 2));
    const lFull = this.placeAll(twos);
    if (Object.keys(lFull).length !== 12) fails.push('12x 2x2 should fill 8x6 exactly');
    if (this.autoPlace(twos, lFull, mk('extra', 1, 1)) !== null) fails.push('full grid accepted an item');

    // 3. rotation lets a 1x3 fit a 3-wide gap
    const tall = mk('tall', 1, 3);
    const wide: Layout = {};
    // occupy all but the top row's last 3 cells
    const blocker = mk('blk', 8, 5);
    wide['blk'] = { x: 0, y: 1, rotated: false };
    const blocker2 = mk('blk2', 5, 1);
    wide['blk2'] = { x: 0, y: 0, rotated: false };
    const pTall = this.autoPlace([blocker, blocker2], wide, tall);
    if (!pTall || !pTall.rotated) fails.push('1x3 should fit rotated into a 3x1 gap');

    // 4. weight math
    if (this.maxCarryWeight(3) !== 60) fails.push('capacity(str 3) != 60');
    if (this.speedModifier(45, 60) !== 1.0) fails.push('light load should not slow'); // 75% < 80% threshold
    if (this.speedModifier(55, 60) !== HEAVY_SPEED_MOD) fails.push('heavy load should slow');

    return fails;
  }
}
