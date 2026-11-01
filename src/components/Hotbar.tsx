/**
 * THE HOTBAR (the usability pass): hands, then tools, then the belt, read from
 * the harness and shown on the HUD. A digit takes a hand or a tool in hand, or
 * uses what rides a pouch. Position and seams tell the groups apart; the piece
 * in hand wears a solid frame and a mark, an empty cell a broken outline.
 */

import React, { useRef } from 'react';
import { EquipSlotId } from '../../types';
import { usePlayerStore } from '../entities/player/store';
import { LoadoutSystem } from '../entities/player/systems/LoadoutSystem';
import { hotbarCells, wieldRefusal } from '../logic/systems/FieldInput';
import { handsJustDropped, pressItem, slotZone, useDropZone } from './ui/hands';
import { ItemSprite, Kbd } from './ui/kit';
import { hoverProps, useFeed, useHotbar } from './ui/stores';

const CELL = 44;

const SHORT: Partial<Record<string, string>> = { RIGHT_HAND: 'RIGHT', LEFT_HAND: 'LEFT' };
const shortOf = (slot: string) => SHORT[slot] ?? (slot.startsWith('TOOL_') ? 'TOOL' : 'POUCH');

/** One door for a digit and a click alike. */
export function activateHotbar(slot: EquipSlotId) {
  const st = usePlayerStore.getState();
  if (slot.startsWith('POUCH_')) {
    const verdict = st.quickUse(slot);
    if (!verdict.ok && verdict.reason) useFeed.getState().push(verdict.reason, 'loss');
    return;
  }
  const item = st.player.equipment ? LoadoutSystem.itemIn(st.player.equipment, slot) : undefined;
  const refusal = wieldRefusal(item);
  if (refusal) {
    useFeed.getState().push(refusal, 'loss');
    return;
  }
  useHotbar.getState().setActive(slot);
  useFeed.getState().push(item ? `${item.name} in hand.` : 'Bare hands.', 'plain');
}

export const Hotbar: React.FC = () => {
  const equipment = usePlayerStore(s => s.player.equipment);
  const active = useHotbar(s => s.active);
  const root = useRef<HTMLDivElement>(null);
  useDropZone('hotbar', slotZone(root));

  const cells = hotbarCells(equipment);
  return (
    <div
      ref={root}
      data-drop-zone="hotbar"
      className="ws-ui"
      onClick={e => e.stopPropagation()}
      onPointerDown={e => e.stopPropagation()}
      style={{ display: 'flex', alignItems: 'flex-end', gap: 2, pointerEvents: 'auto', flexWrap: 'wrap', justifyContent: 'center' }}
    >
      {cells.map((cell, i) => {
        const item = equipment ? LoadoutSystem.itemIn(equipment, cell.slot) : undefined;
        const seam = i > 0 && cells[i - 1].group !== cell.group;
        const isActive = cell.slot === active;
        const count = item?.pouchData?.contents.length;
        return (
          <React.Fragment key={cell.slot}>
            {seam && <span aria-hidden style={{ width: 2, height: CELL, background: 'var(--ws-text-dim)', margin: '0 4px', flexShrink: 0 }} />}
            <button
              type="button"
              data-drop-slot={cell.slot}
              {...(item ? hoverProps(item) : {})}
              aria-label={`${cell.slot.replace('_', ' ')}: ${item?.name ?? 'empty'}${cell.digit ? `, key ${cell.digit}` : ''}`}
              aria-pressed={cell.group === 'BELT' ? undefined : isActive}
              onPointerDown={e => { if (item) pressItem(e, { item, from: { kind: 'SLOT', slot: cell.slot } }); }}
              onClick={e => {
                (e.currentTarget as HTMLButtonElement).blur();
                if (!handsJustDropped()) activateHotbar(cell.slot);
              }}
              onContextMenu={e => {
                e.preventDefault();
                // A pouch gives back what rides it; the pack and its caps have the say.
                if (cell.group === 'BELT' && count) {
                  const v = usePlayerStore.getState().takeFromPouch(cell.slot);
                  if (!v.ok && v.reason) useFeed.getState().push(v.reason, 'loss');
                }
              }}
              className="ws-ui"
              style={{
                position: 'relative', width: CELL, height: CELL, padding: 0, flexShrink: 0,
                background: item ? 'var(--ws-void-2)' : 'rgba(3, 3, 3, 0.55)',
                border: isActive
                  ? '2px solid var(--ws-text-bright)'
                  : item ? '1px solid var(--ws-void-4)' : '1px dashed var(--ws-void-4)',
                cursor: 'pointer', overflow: 'hidden', touchAction: 'none',
                display: 'flex', alignItems: 'center', justifyContent: 'center'
              }}
            >
              {item
                ? <ItemSprite item={item} cellPx={Math.floor((CELL - 8) / Math.max(item.dimensions?.width ?? 1, item.dimensions?.height ?? 1))} />
                : <span className="ws-dim" style={{ fontSize: 'var(--ws-font-small)', lineHeight: 1 }}>{shortOf(cell.slot)}</span>}
              {cell.digit && (
                <span style={{ position: 'absolute', left: 1, top: 1, lineHeight: 1 }}><Kbd>{cell.digit}</Kbd></span>
              )}
              {count !== undefined && (
                <span className="ws-bright" style={{ position: 'absolute', right: 2, bottom: 1, fontSize: 'var(--ws-font-small)', lineHeight: 1, background: 'var(--ws-void-0)' }}>×{count}</span>
              )}
              {isActive && (
                <span aria-hidden className="ws-bright" style={{ position: 'absolute', right: 2, top: 1, fontSize: 'var(--ws-font-small)', lineHeight: 1 }}>▼</span>
              )}
            </button>
          </React.Fragment>
        );
      })}
    </div>
  );
};
