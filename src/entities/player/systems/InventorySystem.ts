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

import { IItem, IGridPlacement } from '../../../../types';

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

  /** First-fit placement: unrotated first, then rotated. Null = no room. */
  static autoPlace(items: IItem[], layout: Layout, item: IItem, gridW = GRID_W, gridH = GRID_H): IGridPlacement | null {
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

  /** Try rotating an item in place. Returns the new placement or null. */
  static tryRotate(items: IItem[], layout: Layout, itemId: string): IGridPlacement | null {
    const item = items.find(i => i.id === itemId);
    const place = layout[itemId];
    if (!item || !place) return null;
    const occ = this.buildOccupancy(items, layout);
    const { w, h } = this.footprint(item, !place.rotated);
    if (this.canPlaceAt(occ, w, h, place.x, place.y, itemId)) {
      return { ...place, rotated: !place.rotated };
    }
    return null;
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
