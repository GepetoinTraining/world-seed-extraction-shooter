/**
 * THE HANDS, ON SCREEN (the usability pass): one drag for pack, stash, body,
 * belt, cart and ground. Press and move to grab, release to set down; or Enter
 * to grab, arrows to walk, Tab to change place, Enter to set down. R turns it
 * while held, Escape puts it back. A held item has not moved: nothing changes
 * until `commitMove`, so there is no moment in which it could be lost.
 */

import React, { useEffect, useRef } from 'react';
import { create } from 'zustand';
import { IItem } from '../../../shared/types';
import { Held, Place, commitMove, ghostStyle, probeMove, NO_GROUND_HOME, NO_GROUND_WINDOW } from '../../logic/systems/ItemHands';
import { InventorySystem } from '../../../shared/entities/player/systems/InventorySystem';
import { usePlayerStore, playerPort } from '../../entities/player/store';
import { ItemSprite, Kbd } from './kit';
import { useFeed } from './stores';
import { useWorldStore } from '../../entities/world/store';

const DRAG_START_PX = 4;

export interface Rect { left: number; top: number; width: number; height: number }

export interface DropZone {
  /** The place under this point, or null when the point asks for nothing. */
  resolve: (clientX: number, clientY: number, held: Held) => Place | null;
  /** The first place the keyboard lands on when it enters this zone. */
  start: (held: Held) => Place | null;
  /** The next place the keyboard reaches from here. */
  step: (at: Place, dx: number, dy: number, held: Held) => Place;
  /** Where the ghost draws for this place. */
  rect: (at: Place, held: Held) => Rect | null;
  /** The O key: the piece under this place, to set the held one on (H13d). Null when none is there. */
  onto?: (at: Place, held: Held) => Place | null;
}

/** The field behind every window: the one place a piece let go outside the grids is dropped (the interface pass). */
const FIELD_ZONE = 'field';
const FIELD_GHOST_CELL = 36;

/** Clear ground under this point: the field itself, and no window or panel over it. */
const groundUnder = (hit: Element | null): boolean =>
  !!hit?.closest?.('[data-field-ground]') && !hit.closest('.ws-overlay') && !!usePlayerStore.getState().player.currentSession;

/** Why a piece let go here, outside every grid, goes back; null when nothing need be said (a near miss on a panel). */
function noGround(hit: Element | null): string | null {
  if (!usePlayerStore.getState().player.currentSession) return NO_GROUND_HOME;
  if (hit?.closest?.('.ws-overlay')) return NO_GROUND_WINDOW;
  return null;
}

function fieldOver(x: number, y: number, held: Held): Over {
  const { w, h } = InventorySystem.footprint(held.item, held.rotated);
  const verdict = probeMove(usePlayerStore.getState().player, held, { kind: 'GROUND' }, useWorldStore.getState());
  return {
    zoneId: FIELD_ZONE, place: { kind: 'GROUND' }, ok: verdict.ok, reason: verdict.reason,
    rect: { left: x - (w * FIELD_GHOST_CELL) / 2, top: y - (h * FIELD_GHOST_CELL) / 2, width: w * FIELD_GHOST_CELL, height: h * FIELD_GHOST_CELL }
  };
}

/** The X key: what is in hand, or the piece chosen, dropped at the person's feet. A refusal says why. */
export function dropByKey(held: Held): boolean {
  const verdict = commitMove(held, { kind: 'GROUND' }, useWorldStore.getState(), playerPort);
  if (!verdict.ok) { feedRefusal(verdict.reason); return false; }
  return true;
}

const zones = new Map<string, DropZone>();

interface Over { zoneId: string; place: Place; rect: Rect; ok: boolean; reason?: string }
interface HandsState {
  held: Held | null;
  mode: 'pointer' | 'keyboard';
  over: Over | null;
}
export const useHands = create<HandsState>(() => ({ held: null, mode: 'pointer', over: null }));

let justDropped = false;
/** A release fires a click on what was pressed. That click is not a selection. */
export const handsJustDropped = () => justDropped;

const feedRefusal = (reason?: string) => {
  if (!reason) return;
  const lines = useFeed.getState().lines;
  if (lines[lines.length - 1]?.text === reason) return;
  useFeed.getState().push(reason, 'loss');
};

const withRotation = (place: Place, rotated: boolean): Place =>
  place.kind === 'PACK' || place.kind === 'STASH' || place.kind === 'CART' ? { ...place, rotated } : place;

function overFor(zoneId: string, place: Place, held: Held): Over | null {
  const zone = zones.get(zoneId);
  if (!zone) return null;
  const rect = zone.rect(place, held);
  if (!rect) return null;
  const verdict = probeMove(usePlayerStore.getState().player, held, place, useWorldStore.getState());
  return { zoneId, place, rect, ok: verdict.ok, reason: verdict.reason };
}

const sameOver = (a: Over | null, b: Over | null) =>
  a === b || (!!a && !!b && a.zoneId === b.zoneId && a.ok === b.ok && JSON.stringify(a.place) === JSON.stringify(b.place));

function grab(held: Held, mode: 'pointer' | 'keyboard') {
  useHands.setState({ held, mode, over: null });
}

function release() {
  useHands.setState({ held: null, over: null });
}

function focusItem(id: string) {
  requestAnimationFrame(() => {
    (document.querySelector(`[data-item-id="${id}"]`) as HTMLElement | null)?.focus();
  });
}

/** Set it down where the hands are. A refusal says why, and the item never moved. */
function setDown(): boolean {
  const { held, over } = useHands.getState();
  if (!held || !over) return false;
  const verdict = commitMove(held, over.place, useWorldStore.getState(), playerPort);
  if (!verdict.ok) {
    if (verdict.reason !== 'It is already there.') feedRefusal(verdict.reason);
    return false;
  }
  return true;
}

function pointAt(clientX: number, clientY: number) {
  const { held, over } = useHands.getState();
  if (!held) return;
  const hit = document.elementFromPoint?.(clientX, clientY);
  const zoneEl = hit ? (hit as HTMLElement).closest?.('[data-drop-zone]') : null;
  const zoneId = zoneEl?.getAttribute('data-drop-zone') ?? null;
  let next: Over | null = null;
  if (zoneId) {
    const place = zones.get(zoneId)?.resolve(clientX, clientY, held) ?? null;
    if (place) next = overFor(zoneId, withRotation(place, held.rotated), held);
  } else if (groundUnder(hit ?? null)) {
    // Outside every grid, over the field: let go and it is dropped at your feet
    next = fieldOver(clientX, clientY, held);
  }
  if (next?.zoneId === FIELD_ZONE && over?.zoneId === FIELD_ZONE) { useHands.setState({ over: next }); return; }
  if (!sameOver(over, next)) useHands.setState({ over: next });
}

/** The O key: set the held piece on the one under the hands, by pointer or by keys (H13d). */
function setOnto(): boolean {
  const st = useHands.getState();
  if (!st.held || !st.over) return false;
  const zone = zones.get(st.over.zoneId);
  const place = zone?.onto?.(st.over.place, st.held) ?? null;
  if (!place) { feedRefusal('There is no piece under it to set it on.'); return false; }
  const over = overFor(st.over.zoneId, place, st.held);
  if (!over) return false;
  useHands.setState({ over });
  return setDown();
}

/**
 * Press on anything that can be picked up. Past a few pixels it becomes a drag;
 * short of that it is left alone, and the click means what it always meant.
 */
export function pressItem(e: React.PointerEvent, held: Omit<Held, 'rotated'> & { rotated?: boolean }) {
  if (e.button !== 0) return;
  const startX = e.clientX, startY = e.clientY;
  let dragging = false;
  const start: Held = { rotated: false, ...held };
  const onMove = (m: PointerEvent) => {
    if (!dragging && Math.hypot(m.clientX - startX, m.clientY - startY) >= DRAG_START_PX) {
      dragging = true;
      grab(start, 'pointer');
    }
    if (dragging) {
      pointerNow.x = m.clientX; pointerNow.y = m.clientY;
      pointAt(m.clientX, m.clientY);
    }
  };
  const finish = (doDrop: boolean, at?: { x: number; y: number }) => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onCancel);
    if (!dragging) return;
    const { held: inHand, over } = useHands.getState();
    if (inHand) {
      if (doDrop && over) setDown();
      // Let go outside every grid with no ground under it: it goes back, and where there is no ground at all, a line says why
      else if (doDrop && at) {
        const why = noGround(document.elementFromPoint?.(at.x, at.y) ?? null);
        if (why) feedRefusal(why);
      }
      release();
    }
    justDropped = true;
    window.setTimeout(() => { justDropped = false; }, 0);
  };
  const onUp = (u: PointerEvent) => finish(true, { x: u.clientX, y: u.clientY });
  const onCancel = () => finish(false);
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onCancel);
}

/** The keyboard's grab: the hands start on the zone it was grabbed from. */
export function grabByKey(held: Omit<Held, 'rotated'> & { rotated?: boolean }, zoneId: string) {
  const start: Held = { rotated: false, ...held };
  grab(start, 'keyboard');
  enterZone(zoneId, start);
}

function enterZone(zoneId: string, held: Held) {
  const place = zones.get(zoneId)?.start(held);
  if (place) useHands.setState({ over: overFor(zoneId, withRotation(place, held.rotated), held) });
}

const pointerNow = { x: 0, y: 0 };

// ---------------------------------------------------------------------------
// ZONES
// ---------------------------------------------------------------------------

export function useDropZone(zoneId: string, zone: DropZone | null) {
  const latest = useRef(zone);
  latest.current = zone;
  useEffect(() => {
    if (!latest.current) return;
    const live: DropZone = {
      resolve: (x, y, h) => latest.current!.resolve(x, y, h),
      start: h => latest.current!.start(h),
      step: (a, dx, dy, h) => latest.current!.step(a, dx, dy, h),
      rect: (a, h) => latest.current!.rect(a, h),
      onto: (a, h) => latest.current?.onto?.(a, h) ?? null
    };
    zones.set(zoneId, live);
    return () => { zones.delete(zoneId); };
  }, [zoneId, !!zone]);
}

/** A zone of named slots: each child with data-drop-slot is one place. */
export function slotZone(root: React.RefObject<HTMLElement>): DropZone {
  const cells = () => [...(root.current?.querySelectorAll<HTMLElement>('[data-drop-slot]') ?? [])];
  const placeOf = (el: HTMLElement): Place => ({ kind: 'SLOT', slot: el.getAttribute('data-drop-slot') as any });
  const find = (at: Place) => at.kind === 'SLOT' ? cells().find(c => c.getAttribute('data-drop-slot') === at.slot) : undefined;
  return {
    resolve: (x, y) => {
      const hit = document.elementFromPoint?.(x, y) as HTMLElement | null;
      const cell = hit?.closest?.('[data-drop-slot]') as HTMLElement | null;
      return cell && root.current?.contains(cell) ? placeOf(cell) : null;
    },
    start: () => { const first = cells()[0]; return first ? placeOf(first) : null; },
    step: (at, dx, dy) => {
      const list = cells();
      if (list.length === 0) return at;
      const from = find(at) ?? list[0];
      const box = from.getBoundingClientRect();
      const cx = box.left + box.width / 2, cy = box.top + box.height / 2;
      let best: HTMLElement | null = null;
      let bestScore = Infinity;
      for (const c of list) {
        if (c === from) continue;
        const b = c.getBoundingClientRect();
        const ox = b.left + b.width / 2 - cx, oy = b.top + b.height / 2 - cy;
        if ((dx !== 0 && Math.sign(ox) !== Math.sign(dx)) || (dy !== 0 && Math.sign(oy) !== Math.sign(dy))) continue;
        const score = dx !== 0 ? Math.abs(ox) + Math.abs(oy) * 3 : Math.abs(oy) + Math.abs(ox) * 3;
        if (score < bestScore) { bestScore = score; best = c; }
      }
      return best ? placeOf(best) : at;
    },
    rect: at => {
      const el = find(at);
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return { left: b.left, top: b.top, width: b.width, height: b.height };
    }
  };
}

/** A zone that is one place, whatever the point: the ground, the kit. */
export function wholeZone(root: React.RefObject<HTMLElement>, place: Place): DropZone {
  return {
    resolve: () => place,
    start: () => place,
    step: at => at,
    rect: () => {
      const b = root.current?.getBoundingClientRect();
      return b ? { left: b.left, top: b.top, width: b.width, height: b.height } : null;
    }
  };
}

// ---------------------------------------------------------------------------
// THE LAYER: the keys while held, and the one ghost
// ---------------------------------------------------------------------------

const heldFootprint = (item: IItem, rotated: boolean) => InventorySystem.footprint(item, rotated);

export const HandsLayer: React.FC = () => {
  const held = useHands(s => s.held);
  const mode = useHands(s => s.mode);
  const over = useHands(s => s.over);
  const floater = useRef<HTMLDivElement>(null);

  // The floating piece follows the pointer without asking React each move.
  useEffect(() => {
    if (!held || mode !== 'pointer') return;
    const follow = (e: PointerEvent) => {
      if (floater.current) floater.current.style.transform = `translate(${e.clientX + 6}px, ${e.clientY + 6}px)`;
    };
    if (floater.current) floater.current.style.transform = `translate(${pointerNow.x + 6}px, ${pointerNow.y + 6}px)`;
    window.addEventListener('pointermove', follow);
    return () => window.removeEventListener('pointermove', follow);
  }, [held?.item.id, mode]);

  useEffect(() => {
    if (!held) return;
    const onKey = (e: KeyboardEvent) => {
      const st = useHands.getState();
      if (!st.held) return;
      const key = e.key;
      const stop = () => { e.preventDefault(); e.stopImmediatePropagation(); };

      if (key === 'Escape') {
        stop();
        const id = st.held.item.id;
        const keyboard = st.mode === 'keyboard';
        release();
        justDropped = true;
        window.setTimeout(() => { justDropped = false; }, 0);
        if (keyboard) focusItem(id);
        return;
      }
      if (key.toLowerCase() === 'r') {
        stop();
        const turned: Held = { ...st.held, rotated: !st.held.rotated };
        useHands.setState({ held: turned });
        if (st.mode === 'pointer') pointAt(pointerNow.x, pointerNow.y);
        else if (st.over) useHands.setState({ over: overFor(st.over.zoneId, withRotation(st.over.place, turned.rotated), turned) });
        return;
      }
      // X drops what is in hand at your feet, by either hand (the interface pass)
      if (key.toLowerCase() === 'x') {
        stop();
        const keyboard = st.mode === 'keyboard';
        const dropped = dropByKey(st.held);
        release();
        justDropped = true;
        window.setTimeout(() => { justDropped = false; }, 0);
        if (!dropped && keyboard) focusItem(st.held.item.id);
        return;
      }
      // O sets it on the piece under the hands, like or not (H13d: setting one on another had no key)
      if (key.toLowerCase() === 'o') {
        stop();
        const id = st.held.item.id;
        if (setOnto()) { release(); justDropped = true; window.setTimeout(() => { justDropped = false; }, 0); }
        else if (st.mode === 'keyboard') focusItem(id);
        return;
      }
      if (st.mode !== 'keyboard') return;

      if (key === 'Enter') {
        stop();
        const id = st.held.item.id;
        if (setDown()) { release(); focusItem(id); }
        else if (st.over) feedRefusal(st.over.reason);
        return;
      }
      if (key === 'Tab') {
        stop();
        const ids = [...zones.keys()];
        if (ids.length === 0) return;
        const at = st.over ? ids.indexOf(st.over.zoneId) : -1;
        const next = ids[(at + (e.shiftKey ? ids.length - 1 : 1)) % ids.length];
        enterZone(next, st.held);
        return;
      }
      const dir = key === 'ArrowLeft' ? [-1, 0] : key === 'ArrowRight' ? [1, 0] : key === 'ArrowUp' ? [0, -1] : key === 'ArrowDown' ? [0, 1] : null;
      if (dir && st.over) {
        stop();
        const zone = zones.get(st.over.zoneId);
        if (!zone) return;
        const next = zone.step(st.over.place, dir[0], dir[1], st.held);
        useHands.setState({ over: overFor(st.over.zoneId, withRotation(next, st.held.rotated), st.held) });
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [!!held]);

  if (!held) return null;
  const { w, h } = heldFootprint(held.item, held.rotated);
  const seam = ghostStyle(over?.ok ?? false);
  const showItem = held.rotated ? { ...held.item, dimensions: { width: h, height: w } } : held.item;
  const CELL = 36;

  return (
    <div className="ws-ui" style={{ position: 'fixed', inset: 0, zIndex: 3000, pointerEvents: 'none' }}>
      {over && (
        <div
          data-ghost={over.ok ? 'valid' : 'invalid'}
          style={{
            position: 'fixed', left: over.rect.left, top: over.rect.top, width: over.rect.width, height: over.rect.height,
            outlineStyle: seam.outlineStyle, outlineColor: seam.outlineColor, outlineWidth: seam.outlineWidth,
            outlineOffset: -2,
            background: over.ok
              ? 'rgba(214, 214, 207, 0.14)'
              : 'repeating-linear-gradient(45deg, rgba(214, 214, 207, 0.22) 0 2px, transparent 2px 7px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden'
          }}
        >
          {mode === 'keyboard' && over.ok && (
            <ItemSprite noHover item={showItem} cellPx={CELL - 4} style={held.rotated ? { transform: 'rotate(90deg)' } : undefined} />
          )}
        </div>
      )}
      {mode === 'pointer' && (
        <div ref={floater} style={{ position: 'fixed', left: 0, top: 0, opacity: 0.85 }}>
          <ItemSprite noHover item={showItem} cellPx={CELL - 4} style={held.rotated ? { transform: 'rotate(90deg)' } : undefined} />
        </div>
      )}
      {/* What is in the hands, said in one place, away from the data. */}
      <div style={{ position: 'fixed', left: '50%', top: 12, transform: 'translateX(-50%)', background: 'var(--ws-void-0)', border: '1px solid var(--ws-void-4)', padding: '3px 10px', maxWidth: '80vw' }}>
        <span className="ws-bright ws-small">{held.item.isIdentified === false ? 'Unidentified Signal' : held.item.name}{held.along?.length ? ` ×${held.along.length + 1}` : ''}</span>
        <span className="ws-dim ws-small"> · <Kbd>R</Kbd> turn · <Kbd>X</Kbd> drop at your feet · <Kbd>O</Kbd> set on the piece under it · <Kbd>ESC</Kbd> put back{mode === 'keyboard' ? <> · <Kbd>ARROWS</Kbd> walk · <Kbd>TAB</Kbd> next place · <Kbd>ENTER</Kbd> set down</> : <> · let go over open ground to drop it</>}</span>
        {over && !over.ok && over.reason && over.reason !== 'It is already there.' && (
          <div className="ws-bright ws-small">{over.reason}</div>
        )}
        {over && over.ok && over.zoneId === FIELD_ZONE && (
          <div className="ws-bright ws-small">LET GO TO DROP IT AT YOUR FEET{held.along?.length ? `: all ${held.along.length + 1}` : ''}. It makes a pile you can come back for.</div>
        )}
        {/* Set on another piece: said before the drop, because it cannot be taken back */}
        {over && over.ok && over.place.kind === 'ONTO' && (
          <div className="ws-bright ws-small">LET GO TO WORK THEM TOGETHER: both are used, and you will know what came of it after you rest.</div>
        )}
      </div>
    </div>
  );
};
