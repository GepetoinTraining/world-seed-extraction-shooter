/**
 * THE ROOM, DRAWN (Wave 10): an IRoomState turned into atoms, deterministically.
 *
 * The same build record gives the same bytes on every machine. The interior
 * keeps the hub's warm ramp; walls are drawn from the material that paid for
 * them (properties become pixels), windows are bright and spill brightness
 * onto the floor (light survives grayscale), and every placed item is blitted
 * from itemArtFor — the one rule for what an item looks like.
 */

import { IRoomPiece, IRoomState, placementFootprint, roomDoor } from '../../entities/hub/room';
import { ITemplate, defaultSheet, templateToRoom } from '../../entities/hub/template';
import { RESOURCE_DEFINITIONS } from '../../entities/item/data/resourceDefinitions';
import { CRAFTED_DEFINITIONS } from '../../entities/economy/data/recipeDefinitions';
import { fnv1a } from '../../logic/rng/DeterministicRNG';
import { Role, Sprite, grain, hash2, materialFromProps, px } from './atoms';
import { itemArtFor } from './items';

export const ROOM_TILE = 10; // atoms per 20px tile, same grid as the city

const defOf = (defId: string): any => (RESOURCE_DEFINITIONS as any)[defId] ?? (CRAFTED_DEFINITIONS as any)[defId];
const matOf = (defId: string) => materialFromProps(defOf(defId)?.materialProps);

const clampStep = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function rotateSprite(s: Sprite): Sprite {
  const out = new Uint8Array(s.w * s.h);
  for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) {
    // 90° clockwise: (x, y) -> (h - 1 - y, x)
    out[x * s.h + (s.h - 1 - y)] = s.data[y * s.w + x];
  }
  return { w: s.h, h: s.w, data: out };
}

/**
 * THE RAW LOOK (the raw materials leg): a raw material reads by SHAPE, in
 * grayscale, from a wall away. Logs are stacked in long unbroken courses; raw
 * stone is rubble, each lump its own tone between dark seams. Worked goods keep
 * their fine grain, so a stored room composes to the same bytes it always did.
 */
export type RawWallKind = 'LOG' | 'STONE';

export function rawWallKind(defId: string): RawWallKind | null {
  const tags: string[] = defOf(defId)?.tags ?? [];
  if (!tags.includes('building') || tags.includes('crafted')) return null;
  return tags.includes('wood') ? 'LOG' : tags.includes('stone') ? 'STONE' : null;
}

const LOG_COURSE = 5;
const STONE_COURSE = 4;
const STONE_WIDTH = 7;

/** One atom of a raw wall or floor, in the given ramp, by the kind's own shape. */
export function rawAtom(kind: RawWallKind, role: Role, ax: number, ay: number, seed: number): number {
  if (kind === 'LOG') {
    const row = ay % LOG_COURSE;
    if (row === 0) return px(role, 0);                       // the long dark seam between logs
    if (row === 1) return px(role, 3);                       // the round of the log catching light
    const log = Math.floor(ay / LOG_COURSE);
    return px(role, hash2(seed, Math.floor((ax + log * 11) / 9), log) % 5 === 0 ? 1 : 2); // bark
  }
  const course = Math.floor(ay / STONE_COURSE);
  const shifted = ax + hash2(seed, course, 7) % STONE_WIDTH;
  if (ay % STONE_COURSE === 0 || shifted % STONE_WIDTH === 0) return px(role, 0); // the dark joint
  return px(role, 1 + hash2(seed, Math.floor(shifted / STONE_WIDTH), course) % 3);  // each lump its own tone
}

/** The plank floor: ruled rows in the warm ground ramp, brightened by windows. */
function floorAtom(ax: number, ay: number): number {
  if (ay % 6 === 0) return px(Role.GROUND, 0);
  if ((ax + Math.floor(ay / 6) * 13) % 30 === 0) return px(Role.GROUND, 0);
  return px(Role.GROUND, 2);
}

/** A wall atom from its material: grain in the matter ramp between hard seams. */
function wallAtom(m: ReturnType<typeof materialFromProps>, ax: number, ay: number, seed: number, outerEdge: boolean, innerEdge: boolean): number {
  if (outerEdge) return px(Role.VOID, 0);         // the shell's hard seam
  if (innerEdge) return px(Role.MATTER, 0);        // the inner seam line
  return px(Role.MATTER, clampStep(1 + grain(m, ax, ay, seed), 1, 3));
}

export function composeRoom(room: IRoomState, _opts: { frame?: number } = {}): Sprite {
  const { w, h } = room.size;
  const W = w * ROOM_TILE, H = h * ROOM_TILE;
  const data = new Uint8Array(W * H);
  const door = roomDoor(room.size);
  const seed = fnv1a(`room:v1:${room.lotId}`);
  const shellMat = matOf(room.shellMaterialDefId);
  const shellRaw = rawWallKind(room.shellMaterialDefId);

  const pieceAt = new Map<number, IRoomPiece>();
  for (const p of room.pieces) pieceAt.set(p.y * w + p.x, p);

  // Wave 10B (D13): floor zones, each drawn from its own material, read by
  // grain and a hard seam at the zone's edge — position and shape, never hue.
  const zoneAt = new Map<number, number>(); // tile index -> zone index
  const zones = room.floorZones ?? [];
  zones.forEach((z, zi) => z.tiles.forEach(t => zoneAt.set(t.y * w + t.x, zi)));
  const zoneMats = zones.map(z => matOf(z.materialDefId));

  // Window light: brightness without color, at a fixed radius, like the lamps.
  const windows = room.pieces.filter(p => p.kind === 'WINDOW');
  const lightAt = (ax: number, ay: number): number => {
    let best = 0;
    for (const win of windows) {
      const cx = win.x * ROOM_TILE + 5, cy = win.y * ROOM_TILE + 5;
      const r = 2.5 * ROOM_TILE;
      const d2 = (ax - cx) * (ax - cx) + (ay - cy) * (ay - cy);
      if (d2 > r * r) continue;
      const level = d2 * 2 <= r * r ? 2 : (ax + ay) % 4 !== 0 ? 1 : 0;
      if (level > best) best = level;
    }
    return best;
  };

  const isPerimeter = (tx: number, ty: number) => tx === 0 || ty === 0 || tx === w - 1 || ty === h - 1;

  for (let ty = 0; ty < h; ty++) for (let tx = 0; tx < w; tx++) {
    const piece = pieceAt.get(ty * w + tx);
    const perimeter = isPerimeter(tx, ty);
    const isDoorGap = tx === door.x && ty === door.y;

    for (let y = 0; y < ROOM_TILE; y++) for (let x = 0; x < ROOM_TILE; x++) {
      const ax = tx * ROOM_TILE + x, ay = ty * ROOM_TILE + y;
      let v: number;

      if (isDoorGap) {
        // The way out: open floor between two thin posts.
        if (x < 1 || x >= ROOM_TILE - 1) v = px(Role.MATTER, 3);
        else if (ay === H - 1) v = px(Role.GROUND, 1); // the threshold
        else v = floorAtom(ax, ay);
      } else if (perimeter) {
        const outer = ax === 0 || ay === 0 || ax === W - 1 || ay === H - 1;
        const inner =
          (tx === 0 && x === ROOM_TILE - 1) || (tx === w - 1 && x === 0) ||
          (ty === 0 && y === ROOM_TILE - 1) || (ty === h - 1 && y === 0);
        if (piece?.kind === 'WINDOW' && x >= 2 && x < ROOM_TILE - 2 && y >= 2 && y < ROOM_TILE - 2) {
          // The pane: bright, latticed, unmistakably a different shape.
          v = (x === 5 || y === 5) ? px(Role.MATTER, 0) : px(Role.LIFE, (x + y) % 3 === 0 ? 3 : 4);
        } else {
          const m = piece?.kind === 'WINDOW' ? matOf(piece.materialDefId) : shellMat;
          if (shellRaw && !outer && !inner) v = rawAtom(shellRaw, Role.MATTER, ax, ay, seed);
          else v = wallAtom(m, ax, ay, seed, outer, inner);
        }
      } else if (piece?.kind === 'WALL') {
        const edge = x === 0 || y === 0 || x === ROOM_TILE - 1 || y === ROOM_TILE - 1;
        const raw = rawWallKind(piece.materialDefId);
        v = edge ? px(Role.MATTER, 0)
          : raw ? rawAtom(raw, Role.MATTER, ax, ay, seed)
          : px(Role.MATTER, clampStep(1 + grain(matOf(piece.materialDefId), ax, ay, seed), 1, 3));
      } else if (piece?.kind === 'DOOR') {
        // A walkable frame: posts both sides, floor between.
        if (x < 2 || x >= ROOM_TILE - 2) v = px(Role.MATTER, 3);
        else v = floorAtom(ax, ay);
      } else {
        const zi = zoneAt.get(ty * w + tx);
        if (zi !== undefined) {
          // The zone's own floor: its material's grain between seams at its edge.
          const seam =
            (x === 0 && zoneAt.get(ty * w + tx - 1) !== zi) ||
            (x === ROOM_TILE - 1 && zoneAt.get(ty * w + tx + 1) !== zi) ||
            (y === 0 && zoneAt.get((ty - 1) * w + tx) !== zi) ||
            (y === ROOM_TILE - 1 && zoneAt.get((ty + 1) * w + tx) !== zi);
          const raw = rawWallKind(zones[zi].materialDefId);
          v = seam ? px(Role.GROUND, 0)
            : raw ? rawAtom(raw, Role.GROUND, ax, ay, seed)
            : px(Role.GROUND, clampStep(1 + grain(zoneMats[zi], ax, ay, seed), 1, 3));
        } else {
          v = floorAtom(ax, ay);
        }
        const lit = lightAt(ax, ay);
        if (lit) v = px(Role.GROUND, clampStep((v - px(Role.GROUND, 0)) + lit, 0, 4));
      }
      data[ay * W + ax] = v;
    }
  }

  // Placements: the item itself, at its real art, centred on its footprint.
  // Art is clipped to the interior so nothing paints over the shell.
  const clipX0 = ROOM_TILE, clipY0 = ROOM_TILE, clipX1 = W - ROOM_TILE, clipY1 = H - ROOM_TILE;
  for (const place of room.placements) {
    let art = itemArtFor(place.item);
    if (place.rotated) art = rotateSprite(art);
    const f = placementFootprint(place);
    const x0 = place.x * ROOM_TILE + ((f.w * ROOM_TILE - art.w) >> 1);
    const y0 = place.y * ROOM_TILE + ((f.h * ROOM_TILE - art.h) >> 1);
    for (let y = 0; y < art.h; y++) for (let x = 0; x < art.w; x++) {
      const v = art.data[y * art.w + x];
      if (!v) continue;
      const dx = x0 + x, dy = y0 + y;
      if (dx < clipX0 || dy < clipY0 || dx >= clipX1 || dy >= clipY1) continue;
      data[dy * W + dx] = v;
    }
  }

  return { w: W, h: H, data };
}

/**
 * Wave 10B: a template's THUMBNAIL is the composed plan itself, downsampled —
 * real atoms, never an icon. Default (ghost) materials answer every tag, so
 * the thumbnail shows geometry, which is all the template fixes.
 */
export function templateThumb(tpl: ITemplate, cells: { width: number; height: number }): Sprite {
  const room = templateToRoom(tpl, defaultSheet(tpl), `thumb:${tpl.name}`);
  const full = composeRoom(room);
  const W = cells.width * 18, H = cells.height * 18; // the pack's cell, 18 atoms
  const data = new Uint8Array(W * H);
  // Fit the room inside the cell, letterboxed, nearest-neighbour.
  const scale = Math.min(W / full.w, H / full.h);
  const dw = Math.max(1, Math.floor(full.w * scale));
  const dh = Math.max(1, Math.floor(full.h * scale));
  const x0 = (W - dw) >> 1, y0 = (H - dh) >> 1;
  for (let y = 0; y < dh; y++) for (let x = 0; x < dw; x++) {
    const sx = Math.min(full.w - 1, Math.floor(x / scale));
    const sy = Math.min(full.h - 1, Math.floor(y / scale));
    data[(y0 + y) * W + x0 + x] = full.data[sy * full.w + sx];
  }
  return { w: W, h: H, data };
}
