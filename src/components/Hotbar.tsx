/**
 * THE HOTBAR (the usability pass): hands, then tools, then the belt, read from
 * the harness and shown on the HUD. A digit takes a hand or a tool in hand, or
 * uses what rides a pouch. Position and seams tell the groups apart; the piece
 * in hand wears a solid frame and a mark, an empty cell a broken outline.
 */

import React, { useEffect, useRef, useState } from 'react';
import { EquipSlotId, IItem } from '../../shared/types';
import { usePlayerStore } from '../entities/player/store';
import { LoadoutSystem } from '../../shared/entities/player/systems/LoadoutSystem';
import { CombatMath } from '../entities/combat/CombatMath';
import { ProgressionSystem } from '../../shared/entities/player/systems/ProgressionSystem';
import { hotbarCells, throwsLeft, wieldRefusal } from '../logic/systems/FieldInput';
import { grabByKey, handsJustDropped, pressItem, slotZone, useDropZone } from './ui/hands';
import { ItemSprite, Kbd } from './ui/kit';
import { handHoverProps, hoverProps, useFeed, useHotbar, useSheet } from './ui/stores';

const CELL = 44;
const NOTHING_CARRIED: IItem[] = [];

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
  // What the hand deals by itself, the card's own line (`CombatMath.damageSaid`); a tool or a guard in a tool slot says only its name
  const rank = ProgressionSystem.rankOf(st.player);
  const deals = !item || (item.isIdentified !== false && CombatMath.firedByHand(item)) ? CombatMath.damageSaid(item, rank, item ? LoadoutSystem.visibleItemStats(item, st.player).damage ?? 0 : 0) : '';
  useFeed.getState().push(item ? `${LoadoutSystem.shownName(item)} in hand${deals ? `: ${deals}` : ''}.` : `Bare hands: ${deals}.`, 'plain');
}

/** The hand is busy: drains in steps, and with reduced motion simply stands until it is done. */
const CooldownShade: React.FC<{ ms: number }> = ({ ms }) => {
  const [over, setOver] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setOver(true), ms);
    return () => clearTimeout(t);
  }, [ms]);
  return over ? null : <span aria-hidden className="ws-cool" style={{ '--ws-cool-ms': `${ms}ms` } as React.CSSProperties} />;
};

export const Hotbar: React.FC = () => {
  const equipment = usePlayerStore(s => s.player.equipment);
  // C14: what is carried, for the count on a hand that throws
  const carried = usePlayerStore(s => s.player.currentSession?.inventory) ?? NOTHING_CARRIED;
  const active = useHotbar(s => s.active);
  const cooldown = useHotbar(s => s.cooldown);
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
        // What a pouch holds, or how many throws a hand has left: the one held and every one carried
        const count = item?.pouchData?.contents.length ?? throwsLeft(item, carried, isActive);
        return (
          <React.Fragment key={cell.slot}>
            {seam && <span aria-hidden style={{ width: 2, height: CELL, background: 'var(--ws-text-dim)', margin: '0 4px', flexShrink: 0 }} />}
            <button
              type="button"
              data-drop-slot={cell.slot}
              // UXC, part 2 (Pedro: "yes"): a hand answers with its own numbers, held or bare; a pouch with what rides it
              {...(cell.group === 'BELT' ? (item ? hoverProps(item) : {}) : handHoverProps(cell.slot))}
              aria-label={`${cell.slot.replace('_', ' ')}: ${item ? LoadoutSystem.shownName(item) : 'empty'}${item && item.isIdentified !== false && CombatMath.firedByHand(item) ? `, ${CombatMath.damageSaid(item, item.rank, LoadoutSystem.visibleItemStats(item).damage ?? 0)}` : ''}${cell.digit ? `, key ${cell.digit}` : ''}`}
              aria-pressed={cell.group === 'BELT' ? undefined : isActive}
              onPointerDown={e => {
                // U23: a pouch that holds something gives its last piece to the drag; an empty one drags itself
                const inside = item?.pouchData?.contents;
                if (inside && inside.length > 0) pressItem(e, { item: inside[inside.length - 1], from: { kind: 'POUCH', slot: cell.slot } });
                else if (item) pressItem(e, { item, from: { kind: 'SLOT', slot: cell.slot } });
              }}
              onKeyDown={e => {
                // The keyboard's way to the same: G takes the pouch's last piece in hand, with the sheet open to set it down
                const inside = item?.pouchData?.contents;
                if (e.key.toLowerCase() !== 'g' || !inside?.length) return;
                e.preventDefault(); e.stopPropagation();
                if (!useSheet.getState().open) useSheet.getState().toggle();
                requestAnimationFrame(() => grabByKey({ item: inside[inside.length - 1], from: { kind: 'POUCH', slot: cell.slot } }, 'pack'));
              }}
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
                ? <ItemSprite item={item} noHover cellPx={Math.floor((CELL - 8) / Math.max(item.dimensions?.width ?? 1, item.dimensions?.height ?? 1))} />
                : <span className="ws-dim" style={{ fontSize: 'var(--ws-font-small)', lineHeight: 1 }}>{shortOf(cell.slot)}</span>}
              {cell.digit && (
                <span style={{ position: 'absolute', left: 1, top: 1, lineHeight: 1 }}><Kbd>{cell.digit}</Kbd></span>
              )}
              {cooldown?.slot === cell.slot && <CooldownShade key={cooldown.startedAt} ms={cooldown.ms} />}
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
