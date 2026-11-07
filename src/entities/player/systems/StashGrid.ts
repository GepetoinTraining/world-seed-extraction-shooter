/**
 * THE STASH GRID (the usability pass): the vault as a real grid. It takes
 * anything, so the rows grow and never refuse. The items list stays the truth;
 * a layout is only where things sit, and an item with no place gets the next
 * free one. Every word the filter reads is what the sheet may show (D19).
 */

import { IGridPlacement, IItem, IPlayer, ItemType, SlotType } from '../../../../shared/types';
import { InventorySystem, Layout } from '../../../../shared/entities/player/systems/InventorySystem';
import { LoadoutSystem } from '../../../../shared/entities/player/systems/LoadoutSystem';

export const STASH_COLS = 12;
const SPARE_ROWS = 3;
const MIN_ROWS = 8;

export type StashSortKey = 'NAME' | 'RANK' | 'VALUE' | 'WEIGHT' | 'TYPE';
export type StashKind = 'ALL' | 'GEAR' | 'TOOL' | 'MATERIAL' | 'USE' | 'UNREAD';
export interface StashFilter { text: string; kind: StashKind }

const RANK_ORDER = ['F', 'E', 'D', 'C', 'B', 'A', 'S', 'SS', 'SSS'];

const shownName = (item: IItem) => item.isIdentified === false ? 'Unidentified Signal' : item.name;

/** A free-standing occupancy that grows downward, so a tall stash costs only its own rows. */
class Rows {
  private cells = new Set<number>();
  constructor(private cols: number) {}
  private key(x: number, y: number) { return y * this.cols + x; }
  free(x: number, y: number, w: number, h: number): boolean {
    if (x < 0 || y < 0 || x + w > this.cols) return false;
    for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) {
      if (this.cells.has(this.key(x + dx, y + dy))) return false;
    }
    return true;
  }
  take(x: number, y: number, w: number, h: number) {
    for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) this.cells.add(this.key(x + dx, y + dy));
  }
  place(w: number, h: number, startRow: number): { x: number; y: number } {
    for (let y = startRow; ; y++) {
      for (let x = 0; x + w <= this.cols; x++) if (this.free(x, y, w, h)) return { x, y };
    }
  }
}

export class StashGrid {

  /** Keeps every place that still holds, and finds one for everything else. */
  static resolve(items: IItem[], layout?: Record<string, IGridPlacement>, cols = STASH_COLS): Layout {
    const out: Layout = {};
    const rows = new Rows(cols);
    const homeless: IItem[] = [];
    for (const item of items) {
      const p = layout?.[item.id];
      if (p) {
        const { w, h } = InventorySystem.footprint(item, p.rotated);
        if (rows.free(p.x, p.y, w, h)) {
          rows.take(p.x, p.y, w, h);
          out[item.id] = { x: p.x, y: p.y, rotated: p.rotated };
          continue;
        }
      }
      homeless.push(item);
    }
    let start = 0;
    for (const item of homeless) {
      const { w, h } = this.fitted(item, cols);
      const at = rows.place(w, h, start);
      rows.take(at.x, at.y, w, h);
      out[item.id] = { x: at.x, y: at.y, rotated: this.rotatedToFit(item, cols) };
      if (w === 1 && h === 1) start = at.y; // single cells walk forward; no quadratic rescan
    }
    return out;
  }

  private static rotatedToFit(item: IItem, cols: number): boolean {
    return InventorySystem.footprint(item, false).w > cols;
  }

  private static fitted(item: IItem, cols: number) {
    return InventorySystem.footprint(item, this.rotatedToFit(item, cols));
  }

  /** Rows to draw: everything, and a little room below it to set things down. */
  static rows(items: IItem[], layout: Layout): number {
    let bottom = 0;
    for (const item of items) {
      const p = layout[item.id];
      if (!p) continue;
      bottom = Math.max(bottom, p.y + InventorySystem.footprint(item, p.rotated).h);
    }
    return Math.max(MIN_ROWS, bottom + SPARE_ROWS);
  }

  /** Cells actually covered. Equal to the items' total area exactly when nothing overlaps. */
  static occupied(items: IItem[], layout: Layout, cols = STASH_COLS): number {
    const covered = new Set<number>();
    for (const item of items) {
      const p = layout[item.id];
      if (!p) continue;
      const { w, h } = InventorySystem.footprint(item, p.rotated);
      for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) covered.add((p.y + dy) * cols + p.x + dx);
    }
    return covered.size;
  }

  /** Can this footprint sit here, with only itself ignored? */
  static canPlace(items: IItem[], layout: Layout, itemId: string, w: number, h: number, x: number, y: number, cols = STASH_COLS): boolean {
    if (x < 0 || y < 0 || x + w > cols) return false;
    for (const other of items) {
      if (other.id === itemId) continue;
      const p = layout[other.id];
      if (!p) continue;
      const f = InventorySystem.footprint(other, p.rotated);
      if (x < p.x + f.w && x + w > p.x && y < p.y + f.h && y + h > p.y) return false;
    }
    return true;
  }

  /** Packed in the order asked: the highest number first, the first name first. */
  static arrange(items: IItem[], key: StashSortKey, cols = STASH_COLS): Layout {
    const sorted = [...items].sort((a, b) => this.compare(a, b, key));
    const out: Layout = {};
    const rows = new Rows(cols);
    for (const item of sorted) {
      const { w, h } = this.fitted(item, cols);
      const at = rows.place(w, h, 0);
      rows.take(at.x, at.y, w, h);
      out[item.id] = { x: at.x, y: at.y, rotated: this.rotatedToFit(item, cols) };
    }
    return out;
  }

  private static compare(a: IItem, b: IItem, key: StashSortKey): number {
    const byName = shownName(a).localeCompare(shownName(b)) || (a.id < b.id ? -1 : 1);
    switch (key) {
      case 'NAME': return byName;
      case 'RANK': return (RANK_ORDER.indexOf(String(b.rank)) - RANK_ORDER.indexOf(String(a.rank))) || byName;
      case 'VALUE': return ((b.value || 0) - (a.value || 0)) || byName;
      case 'WEIGHT': return ((b.weight || 0) - (a.weight || 0)) || byName;
      case 'TYPE': return String(a.type).localeCompare(String(b.type)) || byName;
    }
  }

  static matches(item: IItem, filter: StashFilter, player?: IPlayer): boolean {
    const text = filter.text.trim().toLowerCase();
    if (text && !shownName(item).toLowerCase().includes(text)) return false;
    const tool = item.slot === SlotType.TOOL || (item.tags || []).includes('tool');
    switch (filter.kind) {
      case 'ALL': return true;
      case 'TOOL': return tool;
      case 'GEAR': return !tool && item.slot !== SlotType.NONE;
      case 'USE': return item.type === ItemType.CONSUMABLE;
      case 'MATERIAL': return !tool && item.slot === SlotType.NONE && item.type !== ItemType.CONSUMABLE;
      case 'UNREAD': return item.isIdentified === false || (item.affixes || []).some(a => !LoadoutSystem.isAffixStudied(player, a.id));
    }
  }
}
