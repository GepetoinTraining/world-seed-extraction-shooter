/**
 * THE ROOM (Wave 10): the inside of a building, as data.
 *
 * Pedro's D8: a room is neither generated nor free-form. Walls, doors, windows
 * and stairs are the only structural pieces; EVERYTHING else in a room is an
 * item. The shell comes with the structure; the inside is built tile by tile,
 * each piece paid in materials and finished on the clock. Every completed
 * step and every placement is a signed record.
 *
 * This file is pure logic over plain data: no store, no canvas, no clock.
 * The composer (src/render/atoms/room.ts) turns an IRoomState into pixels,
 * and the same bytes must come out of the same record on every machine.
 */

import { IItem } from '../../../types';

// ---------------------------------------------------------------------------
// THE CONTRACT
// ---------------------------------------------------------------------------

export type RoomPieceKind = 'WALL' | 'DOOR' | 'WINDOW' | 'STAIR';

/** A structural piece, applied. The signature is the owner's, over the record. */
export interface IRoomPiece {
  id: string;
  kind: RoomPieceKind;
  x: number;
  y: number;
  /** What it is made of. Properties become pixels: a plank wall and an ingot wall differ. */
  materialDefId: string;
  /** Wave 10D (additive): the quality of the material that paid the bill, on
   * the one scale. Salvage reads it to know how far the bite has gone. */
  materialQuality?: number;
  builtBy: string; // cert uid
  at: number;
  signature?: string;
}

/** An item standing in the room. The item itself lives here, out of the stash. */
export interface IRoomPlacement {
  id: string;
  item: IItem;
  x: number;
  y: number;
  rotated: boolean;
  placedBy: string; // cert uid
  at: number;
  signature?: string;
}

/** Wave 10B: a named floor zone, drawn from its own material (D13). */
export interface IRoomFloorZone {
  name: string;
  tiles: { x: number; y: number }[];
  materialDefId: string;
}

export interface IRoomState {
  lotId: string;
  version: 1;
  size: { w: number; h: number }; // interior, in 20px tiles, perimeter included
  /** Dominant material consumed by the shell build; the perimeter is drawn from it. */
  shellMaterialDefId: string;
  pieces: IRoomPiece[];
  placements: IRoomPlacement[];
  /** Wave 10B (additive): floor zones from a template's material sheet. */
  floorZones?: IRoomFloorZone[];
  /** Wave 10B (D14): the house remembers its architect, forever. */
  template?: { itemId: string; name: string; authorUid: string; authorName: string };
}

// ---------------------------------------------------------------------------
// SIZE AND THE DOOR
// ---------------------------------------------------------------------------

/** Interior size from the lot's city footprint. Lots grow as the hub grows (D8). */
export const interiorSize = (lot: { width: number; height: number }) => ({
  w: lot.width * 4,
  h: lot.height * 3
});

/** The gap in the bottom wall, aligned with the city door (bottom centre). */
export const roomDoor = (size: { w: number; h: number }) => ({ x: size.w >> 1, y: size.h - 1 });

/** The first floor tile inside the door: where you stand when you walk in. */
export const roomEntry = (size: { w: number; h: number }) => ({ x: size.w >> 1, y: size.h - 2 });

export function emptyRoom(lotId: string, lotFootprint: { width: number; height: number }, shellMaterialDefId: string): IRoomState {
  return { lotId, version: 1, size: interiorSize(lotFootprint), shellMaterialDefId, pieces: [], placements: [] };
}

// ---------------------------------------------------------------------------
// OCCUPANCY
// ---------------------------------------------------------------------------

const isPerimeter = (s: { w: number; h: number }, x: number, y: number) =>
  x === 0 || y === 0 || x === s.w - 1 || y === s.h - 1;

export const placementFootprint = (p: Pick<IRoomPlacement, 'item' | 'rotated'>) => {
  const d = p.item.dimensions || { width: 1, height: 1 };
  return p.rotated ? { w: d.height, h: d.width } : { w: d.width, h: d.height };
};

/** 1 = solid. Perimeter blocks except the door gap; WALL and WINDOW block; placements block their footprint. */
export function roomSolid(room: IRoomState): Uint8Array {
  const { w, h } = room.size;
  const door = roomDoor(room.size);
  const solid = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (isPerimeter(room.size, x, y) && !(x === door.x && y === door.y)) solid[y * w + x] = 1;
  }
  for (const piece of room.pieces) {
    if (piece.kind === 'WALL' || piece.kind === 'WINDOW') solid[piece.y * w + piece.x] = 1;
    // A DOOR is a walkable frame; a STAIR never applies at this tier.
  }
  for (const place of room.placements) {
    const f = placementFootprint(place);
    for (let dy = 0; dy < f.h; dy++) for (let dx = 0; dx < f.w; dx++) {
      const x = place.x + dx, y = place.y + dy;
      if (x >= 0 && y >= 0 && x < w && y < h) solid[y * w + x] = 1;
    }
  }
  return solid;
}

/** Every tile reachable on foot from the door's threshold. */
export function reachableFrom(room: IRoomState, solid = roomSolid(room)): Uint8Array {
  const { w, h } = room.size;
  const entry = roomEntry(room.size);
  const seen = new Uint8Array(w * h);
  if (solid[entry.y * w + entry.x]) return seen;
  const queue: number[] = [entry.y * w + entry.x];
  seen[queue[0]] = 1;
  while (queue.length > 0) {
    const i = queue.pop()!;
    const x = i % w, y = (i / w) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const j = ny * w + nx;
      if (seen[j] || solid[j]) continue;
      seen[j] = 1;
      queue.push(j);
    }
  }
  return seen;
}

/** True when every open tile can be walked to from the door. */
export function fullyWalkable(room: IRoomState): boolean {
  const { w, h } = room.size;
  const solid = roomSolid(room);
  const seen = reachableFrom(room, solid);
  const door = roomDoor(room.size);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    if (x === door.x && y === door.y) continue; // the threshold itself
    if (!solid[i] && !seen[i]) return false;
  }
  return true;
}

/** True when a placement can be worked at: at least one adjacent reachable tile. */
export function placementReachable(room: IRoomState, place: IRoomPlacement, seen = reachableFrom(room)): boolean {
  const { w, h } = room.size;
  const f = placementFootprint(place);
  for (let dy = -1; dy <= f.h; dy++) for (let dx = -1; dx <= f.w; dx++) {
    const edge = dy === -1 || dx === -1 || dy === f.h || dx === f.w;
    if (!edge) continue;
    const x = place.x + dx, y = place.y + dy;
    if (x < 0 || y < 0 || x >= w || y >= h) continue;
    if (seen[y * w + x]) return true;
  }
  return false;
}

/**
 * The connected floor region a placement opens onto, in tiles. The minimum-size
 * rule reads this. A DOOR divides rooms: it can be walked through, but the
 * region it leads to is another room, so the flood stops at it.
 */
export function regionAreaAround(room: IRoomState, place: IRoomPlacement): number {
  const seen = reachableFrom(room);
  const { w, h } = room.size;
  const f = placementFootprint(place);
  // Flood from one adjacent reachable tile, bounded by solids and doors.
  const solid = roomSolid(room);
  for (const piece of room.pieces) {
    if (piece.kind === 'DOOR') solid[piece.y * w + piece.x] = 1;
  }
  for (let dy = -1; dy <= f.h; dy++) for (let dx = -1; dx <= f.w; dx++) {
    const edge = dy === -1 || dx === -1 || dy === f.h || dx === f.w;
    if (!edge) continue;
    const x = place.x + dx, y = place.y + dy;
    if (x < 0 || y < 0 || x >= w || y >= h || !seen[y * w + x]) continue;
    // Count the region containing (x, y)
    const mark = new Uint8Array(w * h);
    const queue = [y * w + x];
    mark[queue[0]] = 1;
    let area = 0;
    while (queue.length > 0) {
      const i = queue.pop()!;
      area++;
      const ix = i % w, iy = (i / w) | 0;
      for (const [ddx, ddy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = ix + ddx, ny = iy + ddy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx;
        if (mark[j] || solid[j]) continue;
        mark[j] = 1;
        queue.push(j);
      }
    }
    return area;
  }
  return 0;
}

// ---------------------------------------------------------------------------
// BILLS, TIMERS AND THE MINIMUM-SIZE RULE
// ---------------------------------------------------------------------------

/**
 * What a piece costs, by material TAG, never by specific item (IBlueprint's law:
 * the bill asks for properties; which plank answers it is the builder's choice,
 * and the choice is what the wall will look like).
 */
export const PIECE_BILLS: Record<RoomPieceKind, { tag: string; count: number }> = {
  WALL: { tag: 'building', count: 1 },
  DOOR: { tag: 'wood', count: 1 },
  WINDOW: { tag: 'glass', count: 1 },
  STAIR: { tag: 'building', count: 2 }
};

export const PIECE_BUILD_SECONDS: Record<RoomPieceKind, number> = {
  WALL: 8, DOOR: 8, WINDOW: 10, STAIR: 15
};

/**
 * DEMOLISH-SALVAGE (Wave 10D.5 — the decision, taken this leg and enacted):
 * tearing a piece down returns its WHOLE bill, as real items of the material
 * that paid it — but every demolition bites the material's quality by 0.10,
 * floored at the scale's own floor (−0.20). Build-and-tear cycles grind the
 * material toward Crude; the gold permit and the shell bill never return.
 * Deterministic, signed as SALVAGED, and the one-quality law pays its rent.
 */
export const SALVAGE_QUALITY_BITE = 0.10;
export const QUALITY_FLOOR = -0.20;

export function salvageFor(piece: Pick<IRoomPiece, 'kind' | 'materialDefId' | 'materialQuality'>): {
  defId: string; count: number; quality: number;
} {
  const bill = PIECE_BILLS[piece.kind];
  const prior = typeof piece.materialQuality === 'number' && Math.abs(piece.materialQuality) <= 1
    ? piece.materialQuality : 0;
  return {
    defId: piece.materialDefId,
    count: bill.count,
    quality: Math.round(Math.max(QUALITY_FLOOR, prior - SALVAGE_QUALITY_BITE) * 1e6) / 1e6
  };
}

/** The shell's material bill, paid with the gold permit when construction is queued. */
export const SHELL_BILLS: Record<'HOUSE' | 'WORKSHOP' | 'VENDOR', { tag: string; count: number }[]> = {
  HOUSE: [{ tag: 'building', count: 4 }],
  WORKSHOP: [{ tag: 'building', count: 6 }, { tag: 'metal', count: 2 }],
  VENDOR: [{ tag: 'building', count: 6 }, { tag: 'glass', count: 1 }]
};

export const SHELL_BUILD_SECONDS: Record<'HOUSE' | 'WORKSHOP' | 'VENDOR', number> = {
  HOUSE: 30, WORKSHOP: 45, VENDOR: 60
};

/** The station each shell mints when its construction completes. */
export const SHELL_STATION: Partial<Record<'HOUSE' | 'WORKSHOP' | 'VENDOR', string>> = {
  WORKSHOP: 'stn_bench',
  VENDOR: 'stn_counter'
};

/**
 * Pedro's D8: room types have minimum sizes, and higher technology asks for
 * bigger rooms. A station refuses a region smaller than its number, in tiles.
 */
export const STATION_MIN_AREA: Record<string, number> = {
  stn_bench: 12,
  stn_counter: 9,
  stn_table: 4,
  stn_scribe: 6 // Wave 10B (D12): the scribe's table wants room to spread the plans
};

/** What a placed station opens when you work at it. */
export const STATION_FUNCTION: Record<string, 'WORKSHOP' | 'VENDOR' | 'SCRIBE'> = {
  stn_bench: 'WORKSHOP',
  stn_counter: 'VENDOR',
  stn_scribe: 'SCRIBE' // Wave 10B: the builder view opens here
};

export const isStation = (defId: string) => defId in STATION_MIN_AREA;

// ---------------------------------------------------------------------------
// VALIDATION: the builder refuses out loud, with the reason
// ---------------------------------------------------------------------------

export type RoomVerdict = { ok: boolean; reason?: string };

const occupiedByPiece = (room: IRoomState, x: number, y: number) =>
  room.pieces.some(p => p.x === x && p.y === y);

const occupiedByPlacement = (room: IRoomState, x: number, y: number) =>
  room.placements.some(p => {
    const f = placementFootprint(p);
    return x >= p.x && x < p.x + f.w && y >= p.y && y < p.y + f.h;
  });

/** Can this structural piece be built here? Checked against the room as it will be. */
export function canBuildPiece(room: IRoomState, kind: RoomPieceKind, x: number, y: number): RoomVerdict {
  const { w, h } = room.size;
  const door = roomDoor(room.size);
  if (kind === 'STAIR') return { ok: false, reason: 'The hub grants a single floor at this tier. The stairs can wait for the city to grow.' };
  if (x < 0 || y < 0 || x >= w || y >= h) return { ok: false, reason: 'Outside the room.' };
  if (x === door.x && y === door.y) return { ok: false, reason: 'That is the way out. The door stays.' };

  if (kind === 'WINDOW') {
    if (!isPerimeter(room.size, x, y)) return { ok: false, reason: 'A window needs an outside wall.' };
    const corner = (x === 0 || x === w - 1) && (y === 0 || y === h - 1);
    if (corner) return { ok: false, reason: 'The corner carries the roof. No window there.' };
    if (occupiedByPiece(room, x, y)) return { ok: false, reason: 'That wall already holds something.' };
    return { ok: true };
  }

  if (isPerimeter(room.size, x, y)) return { ok: false, reason: 'The outside wall is the shell. Build inward.' };
  if (occupiedByPiece(room, x, y)) return { ok: false, reason: 'Something is already built there.' };
  if (occupiedByPlacement(room, x, y)) return { ok: false, reason: 'Something is standing there. Reclaim it first.' };

  if (kind === 'WALL') {
    const after: IRoomState = {
      ...room,
      pieces: [...room.pieces, { id: 'preview', kind, x, y, materialDefId: '', builtBy: '', at: 0 }]
    };
    if (!fullyWalkable(after)) return { ok: false, reason: 'That wall would seal part of the room off from the door. Refused.' };
    const seenAfter = reachableFrom(after);
    for (const place of after.placements) {
      if (!placementReachable(after, place, seenAfter)) {
        return { ok: false, reason: `That wall would wall ${place.item.name} in. Refused.` };
      }
    }
  }
  return { ok: true };
}

/** Can this item stand here? Checked against the room as it will be. */
export function canPlaceItem(room: IRoomState, item: IItem, x: number, y: number, rotated: boolean): RoomVerdict {
  const { w, h } = room.size;
  const preview: IRoomPlacement = { id: 'preview', item, x, y, rotated, placedBy: '', at: 0 };
  const f = placementFootprint(preview);

  if (x < 1 || y < 1 || x + f.w > w - 1 || y + f.h > h - 1) return { ok: false, reason: 'It will not fit against the shell.' };
  for (let dy = 0; dy < f.h; dy++) for (let dx = 0; dx < f.w; dx++) {
    const tx = x + dx, ty = y + dy;
    if (occupiedByPiece(room, tx, ty)) return { ok: false, reason: 'Something is built there.' };
    if (occupiedByPlacement(room, tx, ty)) return { ok: false, reason: 'Something already stands there.' };
  }

  const after: IRoomState = { ...room, placements: [...room.placements, preview] };
  const entry = roomEntry(room.size);
  const solidAfter = roomSolid(after);
  if (solidAfter[entry.y * w + entry.x]) return { ok: false, reason: 'That blocks the doorway. The way out stays open.' };
  if (!fullyWalkable(after)) return { ok: false, reason: 'That would seal part of the room off from the door. Refused.' };
  const seenAfter = reachableFrom(after);
  for (const place of after.placements) {
    if (!placementReachable(after, place, seenAfter)) {
      return { ok: false, reason: `${place.item.name} could no longer be reached. Refused.` };
    }
  }

  const minArea = STATION_MIN_AREA[item.universalDefinitionId];
  if (minArea !== undefined) {
    const area = regionAreaAround(after, preview);
    if (area < minArea) {
      return { ok: false, reason: `${item.name} needs ${minArea} clear tiles to work; this room section holds ${area}.` };
    }
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// THE CITY SIDE: a built lot blocks, except its door tile (which lies outside
// the footprint, one row below — you stand on it to enter).
// ---------------------------------------------------------------------------

export function builtLotBlocksAt(
  poi: { position: { x: number; y: number }; size: { width: number; height: number } },
  built: boolean,
  tx: number,
  ty: number
): boolean {
  if (!built) return false;
  return tx >= poi.position.x && tx < poi.position.x + poi.size.width &&
         ty >= poi.position.y && ty < poi.position.y + poi.size.height;
}

// ---------------------------------------------------------------------------
// BILLS BY TAG (IBlueprint's law). The NPC presets moved to template.ts in
// Wave 10B: presets are SYSTEM TEMPLATES now — one contract, no second path.
// ---------------------------------------------------------------------------

/** Pick items answering a bill of tags, never the same item twice (IBlueprint's law). */
export function pickBill(bill: { tag: string; count: number }[], stash: IItem[]): { ok: boolean; items: IItem[]; missing?: string } {
  const picked: IItem[] = [];
  const taken = new Set<string>();
  for (const line of bill) {
    let need = line.count;
    for (const item of stash) {
      if (need === 0) break;
      if (taken.has(item.id)) continue;
      if ((item.tags || []).includes(line.tag)) { picked.push(item); taken.add(item.id); need--; }
    }
    if (need > 0) return { ok: false, items: [], missing: `${need} more ${line.tag}` };
  }
  return { ok: true, items: picked };
}

/** The bill, written for a button: "6 building, 2 metal". */
export const billText = (bill: { tag: string; count: number }[]) =>
  bill.map(line => `${line.count} ${line.tag}`).join(', ');

/** The material a tag defaults to when nobody chose (presets, previews). */
export const TAG_DEFAULT_MATERIAL: Record<string, string> = {
  building: 'crf_plank',
  wood: 'crf_plank',
  glass: 'crf_glass',
  metal: 'crf_iron_ingot'
};

// The NPC presets and their room composition live in template.ts (Wave 10B):
// IRoomPreset, ROOM_PRESETS, presetToRoom — each preset rides a SYSTEM TEMPLATE.
