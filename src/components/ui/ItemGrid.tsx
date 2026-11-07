/**
 * THE ONE GRID (the usability pass): pack, stash, cart bed and cache are this
 * component with a different place behind it. Items are native buttons at their
 * real footprints. Click selects; press and move drags; Enter grabs; E or a
 * right-click does the obvious thing; arrows walk. The grid moves nothing itself.
 */

import React, { useRef } from 'react';
import { IGridPlacement, IItem } from '../../../shared/types';
import { Place } from '../../logic/systems/ItemHands';
import { stepGhost } from '../../logic/systems/ItemHands';
import { InventorySystem } from '../../../shared/entities/player/systems/InventorySystem';
import { DropZone, grabByKey, handsJustDropped, pressItem, useDropZone, useHands } from './hands';
import { ItemSprite } from './kit';
import { hoverProps } from './stores';

export type GridPlaceKind =
  | { kind: 'PACK' } | { kind: 'STASH' } | { kind: 'CART'; entityId: string } | { kind: 'CACHE'; entityId: string };

const placeAt = (grid: GridPlaceKind, x: number, y: number, rotated: boolean): Place | null => {
  if (grid.kind === 'CACHE') return null; // a cache only gives; the ground zone beside it takes
  return { ...grid, x, y, rotated } as Place;
};

export const ItemGrid: React.FC<{
  zoneId: string;
  place: GridPlaceKind;
  items: IItem[];
  layout: Record<string, IGridPlacement>;
  gridW: number;
  gridH: number;
  cellPx: number;
  selectedId?: string | null;
  onSelect?: (id: string | null) => void;
  /** E, a double-click or a right-click: what this item most plainly wants. */
  onPrimary?: (item: IItem) => void;
  onRotate?: (item: IItem) => void;
  dimmed?: (item: IItem) => boolean;
  badge?: (item: IItem) => React.ReactNode;
}> = ({ zoneId, place, items, layout, gridW, gridH, cellPx, selectedId, onSelect, onPrimary, onRotate, dimmed, badge }) => {
  const root = useRef<HTMLDivElement>(null);
  const heldId = useHands(s => s.held?.item.id);

  const zone: DropZone | null = place.kind === 'CACHE' ? null : {
    resolve: (x, y, held) => {
      const box = root.current?.getBoundingClientRect();
      if (!box) return null;
      const { w, h } = InventorySystem.footprint(held.item, held.rotated);
      const cx = Math.round((x - box.left) / cellPx - w / 2);
      const cy = Math.round((y - box.top) / cellPx - h / 2);
      const clamp = (v: number, max: number) => Math.max(0, Math.min(Math.max(0, max), v));
      return placeAt(place, clamp(cx, gridW - w), clamp(cy, gridH - h), held.rotated);
    },
    start: held => {
      const own = held.from.kind === place.kind ? layout[held.item.id] : undefined;
      return placeAt(place, own?.x ?? 0, own?.y ?? 0, held.rotated);
    },
    step: (at, dx, dy, held) => stepGhost(at, dx, dy, held.item, gridW, gridH),
    rect: (at, held) => {
      const box = root.current?.getBoundingClientRect();
      if (!box || (at.kind !== 'PACK' && at.kind !== 'STASH' && at.kind !== 'CART')) return null;
      const { w, h } = InventorySystem.footprint(held.item, held.rotated);
      return { left: box.left + (at.x ?? 0) * cellPx, top: box.top + (at.y ?? 0) * cellPx, width: w * cellPx, height: h * cellPx };
    }
  };
  useDropZone(zoneId, zone);

  const walk = (from: IItem, dx: number, dy: number) => {
    const p = layout[from.id];
    if (!p) return;
    let best: IItem | null = null;
    let bestScore = Infinity;
    for (const other of items) {
      const q = layout[other.id];
      if (!q || other.id === from.id) continue;
      const ox = q.x - p.x, oy = q.y - p.y;
      if ((dx !== 0 && Math.sign(ox) !== dx) || (dy !== 0 && Math.sign(oy) !== dy)) continue;
      const score = dx !== 0 ? Math.abs(ox) + Math.abs(oy) * 2 : Math.abs(oy) + Math.abs(ox) * 2;
      if (score < bestScore) { bestScore = score; best = other; }
    }
    if (best) (root.current?.querySelector(`[data-item-id="${best.id}"]`) as HTMLElement | null)?.focus();
  };

  const from = place as Place;

  return (
    <div
      ref={root}
      data-drop-zone={place.kind === 'CACHE' ? undefined : zoneId}
      onClick={e => e.stopPropagation()}
      style={{
        position: 'relative', width: gridW * cellPx, height: gridH * cellPx, flexShrink: 0,
        background: `
          repeating-linear-gradient(90deg, var(--ws-void-3) 0 1px, transparent 1px ${cellPx}px),
          repeating-linear-gradient(0deg, var(--ws-void-3) 0 1px, transparent 1px ${cellPx}px),
          var(--ws-void-0)`
      }}
    >
      {items.map(item => {
        const at = layout[item.id];
        if (!at) return null;
        const { w, h } = InventorySystem.footprint(item, at.rotated);
        const isSel = item.id === selectedId;
        const isHeld = item.id === heldId;
        const faded = dimmed?.(item) ?? false;
        return (
          <button
            key={item.id}
            type="button"
            className="ws-ui"
            data-item-id={item.id}
            {...hoverProps(item)}
            tabIndex={faded ? -1 : 0}
            aria-label={item.isIdentified === false ? 'Unidentified signal' : item.name}
            onPointerDown={e => { if (!faded) pressItem(e, { item, from, rotated: at.rotated }); }}
            onClick={e => {
              e.stopPropagation();
              if (handsJustDropped()) return;
              onSelect?.(isSel ? null : item.id);
            }}
            onDoubleClick={e => { e.stopPropagation(); onPrimary?.(item); }}
            onContextMenu={e => { e.preventDefault(); e.stopPropagation(); onPrimary?.(item); }}
            onKeyDown={e => {
              const key = e.key.toLowerCase();
              if (e.key === 'Enter' || key === 'g') { e.preventDefault(); e.stopPropagation(); grabByKey({ item, from, rotated: at.rotated }, zoneId); }
              else if (key === 'e') { e.preventDefault(); e.stopPropagation(); onPrimary?.(item); }
              else if (key === 'r' && onRotate) { e.preventDefault(); e.stopPropagation(); onRotate(item); }
              else if (e.key === 'ArrowLeft') { e.preventDefault(); e.stopPropagation(); walk(item, -1, 0); }
              else if (e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); walk(item, 1, 0); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); walk(item, 0, -1); }
              else if (e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); walk(item, 0, 1); }
            }}
            style={{
              position: 'absolute',
              left: at.x * cellPx + 1, top: at.y * cellPx + 1,
              width: w * cellPx - 2, height: h * cellPx - 2,
              background: 'transparent',
              outline: isSel ? '2px solid var(--ws-text-bright)' : isHeld ? '1px dashed var(--ws-text-bright)' : undefined,
              outlineOffset: -2,
              border: 'none',
              opacity: isHeld ? 0.35 : faded ? 0.18 : 1,
              padding: 0, cursor: 'grab', overflow: 'hidden', touchAction: 'none',
              display: 'flex', alignItems: 'center', justifyContent: 'center'
            }}
          >
            <ItemSprite
              item={at.rotated ? { ...item, dimensions: { width: h, height: w } } : item}
              cellPx={cellPx - 4}
              style={at.rotated ? { transform: 'rotate(90deg)' } : undefined}
            />
            {badge?.(item) && (
              <span className="ws-small ws-bright" style={{ position: 'absolute', right: 1, bottom: 0, lineHeight: 1, background: 'var(--ws-void-0)', padding: '0 2px', pointerEvents: 'none' }}>
                {badge(item)}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
};
