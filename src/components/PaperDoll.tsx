/**
 * THE PAPER-DOLL (Wave 10C): the slot tree drawn as a body, from the same
 * atoms as everything else. Position IS the code: the head column runs down
 * the middle, hands flank it, jewelry sits right, tools stand apart — and a
 * cognitive frame reads apart from gear by its hollow diamond, never by hue.
 * Keyboard-complete: Tab/arrows walk the slots, Enter opens the fitting list,
 * U unequips, F seats a frame on a budget position. Refusals speak in voice.
 */

import React, { useMemo, useRef, useState } from 'react';
import { usePlayerStore } from '../entities/player/store';
import {
  EquipSlotId, HeadPositionId, HEAD_BUDGET_POSITIONS, IItem, SlotType
} from '../../types';
import { LoadoutSystem, paperDollLayout } from '../entities/player/systems/LoadoutSystem';
import { COGNITIVE_FRAMES } from '../entities/player/data/cognitiveFrames';
import { frameMark } from '../render/atoms/items';
import { inspectItem } from '../render/atoms/inspect';
import { Button, CardView, Chip, ItemSprite, Kbd, Modal, Panel, SpriteView } from './ui/kit';

const UNIT = 42; // px per layout grid unit

// Short labels for empty cells (position is the code; the word is a courtesy)
const SLOT_SHORT: Partial<Record<string, string>> = {
  RIGHT_HAND: 'R HAND', LEFT_HAND: 'L HAND', SHOULDER: 'SHLDR',
  NECKLACE: 'NECK', EARRING: 'EAR', RING_1: 'RING', RING_2: 'RING',
  QUIVER: 'QUIV', TOOL_1: 'TOOL', TOOL_2: 'TOOL', TOOL_3: 'TOOL',
  POUCH_1: 'PCH', POUCH_2: 'PCH', POUCH_3: 'PCH', POUCH_4: 'PCH'
};

const isHeadPosition = (slot: EquipSlotId): slot is HeadPositionId =>
  (HEAD_BUDGET_POSITIONS as string[]).includes(slot);

export const PaperDoll: React.FC = () => {
  const { player, equipToSlot, unequipFromSlot, setFrame, markSlotProtected, clearSlotProtection } = usePlayerStore();
  const equipment = player.equipment ?? LoadoutSystem.emptyEquipment();
  const layout = useMemo(() => paperDollLayout(), []);
  const [focusSlot, setFocusSlot] = useState<EquipSlotId | null>(null);
  const [pickerSlot, setPickerSlot] = useState<EquipSlotId | null>(null);
  const [lastWord, setLastWord] = useState<string | null>(null);
  const cellRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const stash = player.bank.stashTabs[0]?.items || [];
  const pouchSlots = LoadoutSystem.availableSlots(equipment).filter(s => s.startsWith('POUCH_'));

  // Pouch cells join the doll under the belt when a belt is worn
  const cells = useMemo(() => {
    const base = [...layout];
    pouchSlots.forEach((slot, i) => base.push({ slot: slot as EquipSlotId, x: 0 + i, y: 10, w: 1, h: 1 }));
    return base;
  }, [layout, pouchSlots.join(',')]);

  const say = (word: string) => setLastWord(word);

  const moveFocus = (from: EquipSlotId, dx: number, dy: number) => {
    const idx = cells.findIndex(c => c.slot === from);
    if (idx === -1) return;
    let target: typeof cells[number] | undefined;
    if (dx !== 0) {
      target = cells[(idx + dx + cells.length) % cells.length];
    } else {
      const cur = cells[idx];
      const others = cells.filter(c => c !== cur && Math.sign(c.y - cur.y) === Math.sign(dy));
      others.sort((a, b) =>
        (Math.abs(a.y - cur.y) * 10 + Math.abs(a.x - cur.x)) - (Math.abs(b.y - cur.y) * 10 + Math.abs(b.x - cur.x)));
      target = others[0];
    }
    if (target) cellRefs.current[target.slot]?.focus();
  };

  const onCellKey = (e: React.KeyboardEvent, slot: EquipSlotId) => {
    const key = e.key;
    if (key === 'ArrowLeft') { e.preventDefault(); moveFocus(slot, -1, 0); }
    else if (key === 'ArrowRight') { e.preventDefault(); moveFocus(slot, 1, 0); }
    else if (key === 'ArrowUp') { e.preventDefault(); moveFocus(slot, 0, -1); }
    else if (key === 'ArrowDown') { e.preventDefault(); moveFocus(slot, 0, 1); }
    else if (key.toLowerCase() === 'u') {
      e.preventDefault();
      const v = unequipFromSlot(slot);
      if (!v.ok && v.reason) say(v.reason);
    }
    else if (key.toLowerCase() === 'f' && isHeadPosition(slot)) {
      e.preventDefault();
      setPickerSlot(slot);
    }
    else if (key.toLowerCase() === 'p' && import.meta.env.DEV) {
      // D21 dev hook: the charm items are 10E's; until then this is the magic
      e.preventDefault();
      const marked = equipment.protected?.some(p => p.slot === slot);
      if (marked) clearSlotProtection(slot);
      else markSlotProtected(slot, 'Dev Ward (console)');
    }
  };

  const frameAt = (slot: EquipSlotId) => isHeadPosition(slot) ? LoadoutSystem.frameAt(equipment, slot) : undefined;

  const gridW = Math.max(...cells.map(c => c.x + c.w));
  const gridH = Math.max(...cells.map(c => c.y + c.h));

  return (
    <Panel
      title="THE BODY"
      right={<span className="ws-dim ws-small">harness {LoadoutSystem.harnessWeight(equipment).toFixed(1)} kg — weighs nothing against the limit</span>}
    >
      <div className="ws-dim ws-small" style={{ marginBottom: 6 }}>
        <Kbd>←→↑↓</Kbd> walk the body · <Kbd>ENTER</Kbd> fit the slot · <Kbd>U</Kbd> unequip · <Kbd>F</Kbd> seat a frame{import.meta.env.DEV ? <> · <Kbd>P</Kbd> dev-protect</> : null}
      </div>
      <div style={{ position: 'relative', width: gridW * UNIT, height: gridH * UNIT }}>
        {cells.map(cell => {
          const itemHere = LoadoutSystem.itemIn(equipment, cell.slot);
          const frameHere = frameAt(cell.slot);
          const protectedBy = equipment.protected?.find(p => p.slot === cell.slot);
          return (
            <button
              key={cell.slot}
              ref={el => { cellRefs.current[cell.slot] = el; }}
              type="button"
              className="ws-ui"
              onFocus={() => setFocusSlot(cell.slot)}
              onKeyDown={e => onCellKey(e, cell.slot)}
              onClick={() => setPickerSlot(cell.slot)}
              title={
                frameHere ? `${cell.slot}: ${frameHere.name} (cognitive frame)` :
                itemHere ? `${cell.slot}: ${itemHere.name}` : `${cell.slot}: empty`
              }
              style={{
                position: 'absolute',
                left: cell.x * UNIT, top: cell.y * UNIT,
                width: cell.w * UNIT - 4, height: cell.h * UNIT - 4,
                background: 'var(--ws-void-1)',
                // the budget positions carry a notched (dashed) border: mind may sit here
                border: frameHere ? '1px dashed var(--ws-signal-3)'
                  : isHeadPosition(cell.slot) ? '1px dashed var(--ws-void-4)'
                  : '1px solid var(--ws-void-4)',
                outline: focusSlot === cell.slot ? '2px solid var(--ws-signal-3)' : undefined,
                padding: 2, cursor: 'pointer',
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2,
                overflow: 'hidden'
              }}
            >
              {frameHere
                ? <SpriteView sprite={frameMark(frameHere)} scale={2} title={frameHere.name} />
                : itemHere
                  ? <ItemSprite item={itemHere} cellPx={Math.min(cell.w, cell.h) * UNIT - 14} />
                  : <span className="ws-dim ws-small" style={{ letterSpacing: '0.04em' }}>{SLOT_SHORT[cell.slot] ?? cell.slot}</span>}
              {protectedBy && (
                <span className="ws-proof ws-small" title={`Protected by ${protectedBy.by}`}>⌐W¬</span>
              )}
            </button>
          );
        })}
      </div>
      {lastWord && <div className="ws-loss ws-small" style={{ marginTop: 6 }}>{lastWord}</div>}

      {pickerSlot && (
        <SlotPicker
          slot={pickerSlot}
          stash={stash}
          onClose={() => setPickerSlot(null)}
          onWord={say}
        />
      )}
    </Panel>
  );
};

/** The fitting list: everything in the vault, the eligible first — and the
 *  refusals SAID, item by item, in the bank's voice (line 47 played here). */
const SlotPicker: React.FC<{
  slot: EquipSlotId;
  stash: IItem[];
  onClose: () => void;
  onWord: (w: string) => void;
}> = ({ slot, stash, onClose, onWord }) => {
  const { player, equipToSlot, unequipFromSlot, setFrame } = usePlayerStore();
  const [hovered, setHovered] = React.useState<IItem | null>(null);
  const equipment = player.equipment ?? LoadoutSystem.emptyEquipment();
  const worn = LoadoutSystem.itemIn(equipment, slot);
  const frameHere = (HEAD_BUDGET_POSITIONS as string[]).includes(slot)
    ? LoadoutSystem.frameAt(equipment, slot as HeadPositionId)
    : undefined;

  const candidates = stash
    .filter(i => i.slot !== SlotType.NONE || i.tags?.includes('tool'))
    .map(item => ({ item, verdict: LoadoutSystem.canEquip(player, item, slot) }))
    .sort((a, b) => Number(b.verdict.ok) - Number(a.verdict.ok));

  return (
    <Modal title={`FIT ${slot.replace('_', ' ')}`} onClose={onClose} width={480}>
      {worn && (
        <div
          className="ws-row ws-row--live" style={{ marginBottom: 6 }}
          onMouseEnter={() => setHovered(worn)} onMouseLeave={() => setHovered(h => (h === worn ? null : h))}
        >
          <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <ItemSprite item={worn} cellPx={18} />
            <span>{worn.name} <span className="ws-dim ws-small">— worn now</span></span>
          </span>
          <Button tone="quiet" onClick={() => { const v = unequipFromSlot(slot); if (!v.ok && v.reason) onWord(v.reason); else onClose(); }}>UNEQUIP</Button>
        </div>
      )}
      {frameHere && (
        <div className="ws-row" style={{ marginBottom: 6 }}>
          <span className="ws-signal">{frameHere.name} <span className="ws-dim ws-small">— a frame holds this position</span></span>
          <Button tone="quiet" onClick={() => { setFrame(slot as HeadPositionId, null); onClose(); }}>CLEAR</Button>
        </div>
      )}

      {(HEAD_BUDGET_POSITIONS as string[]).includes(slot) && !frameHere && (
        <>
          <div className="ws-dim ws-small" style={{ margin: '6px 0 2px' }}>COGNITIVE FRAMES — mind in place of matter ({LoadoutSystem.frameCount(equipment)} of 3 seated)</div>
          <div className="ws-list">
            {Object.values(COGNITIVE_FRAMES).map(f => {
              const v = LoadoutSystem.canSlotFrame(equipment, slot as HeadPositionId, f.id);
              return (
                <div
                  key={f.id} className="ws-row ws-row--live" role="button" tabIndex={0}
                  onClick={() => {
                    if (!v.ok) { if (v.reason) onWord(v.reason); return; }
                    const r = usePlayerStore.getState().setFrame(slot as HeadPositionId, f.id);
                    if (!r.ok && r.reason) onWord(r.reason); else onClose();
                  }}
                  onKeyDown={e => { if (e.key === 'Enter') (e.currentTarget as HTMLElement).click(); }}
                >
                  <span style={{ display: 'flex', gap: 8, alignItems: 'center', minWidth: 0 }}>
                    <SpriteView sprite={frameMark(f)} scale={1} title={f.type} />
                    <span style={{ minWidth: 0 }}>
                      <span className="t" style={{ display: 'block' }}>{f.name}</span>
                      <span className="s">{Object.entries(f.modifiers).map(([k, mv]) => `${(mv as number) > 0 ? '+' : ''}${mv} ${k.slice(0, 4)}`).join(' · ')}</span>
                    </span>
                  </span>
                  {v.ok
                    ? <Button tone="signal" onClick={e => { e.stopPropagation(); const r = usePlayerStore.getState().setFrame(slot as HeadPositionId, f.id); if (!r.ok && r.reason) onWord(r.reason); else onClose(); }}>SEAT</Button>
                    : <span className="ws-loss ws-small" style={{ maxWidth: 200, textAlign: 'right' }}>{v.reason}</span>}
                </div>
              );
            })}
          </div>
          <div style={{ borderTop: '1px solid var(--ws-void-3)', margin: '8px 0' }} />
        </>
      )}

      <div className="ws-dim ws-small" style={{ marginBottom: 2 }}>FROM THE VAULT</div>
      <div className="ws-list" style={{ maxHeight: 280, overflow: 'auto' }}>
        {candidates.length === 0 && <div className="ws-dim ws-small">Nothing stored would ever sit here.</div>}
        {candidates.map(({ item, verdict }) => (
          <div
            key={item.id} className="ws-row ws-row--live" role="button" tabIndex={0}
            onMouseEnter={() => setHovered(item)} onMouseLeave={() => setHovered(h => (h === item ? null : h))}
            onClick={() => {
              if (!verdict.ok) { if (verdict.reason) onWord(verdict.reason); return; }
              const r = usePlayerStore.getState().equipToSlot(item.id, slot);
              if (!r.ok && r.reason) onWord(r.reason); else onClose();
            }}
            onKeyDown={e => { if (e.key === 'Enter') (e.currentTarget as HTMLElement).click(); }}
          >
            <span style={{ display: 'flex', gap: 8, alignItems: 'center', minWidth: 0 }}>
              <ItemSprite item={item} cellPx={16} />
              <span style={{ minWidth: 0 }}>
                <span className="t" style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</span>
                <span className="s">{item.weight}kg · {item.rank}</span>
              </span>
            </span>
            {verdict.ok
              ? <Button tone="proof" onClick={e => { e.stopPropagation(); const r = usePlayerStore.getState().equipToSlot(item.id, slot); if (!r.ok && r.reason) onWord(r.reason); else onClose(); }}>EQUIP</Button>
              : <span className="ws-loss ws-small" style={{ maxWidth: 220, textAlign: 'right' }}>{verdict.reason}</span>}
          </div>
        ))}
      </div>
      {hovered && (
        <div style={{ marginTop: 8 }}>
          <CardView card={inspectItem(hovered, usePlayerStore.getState().player)} />
        </div>
      )}
    </Modal>
  );
};
