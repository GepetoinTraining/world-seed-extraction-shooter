/**
 * THE TEMPLATE (Wave 10B): a building plan, as data. D8 said the economy lives
 * in this layer; the template makes it true for building itself. It separates
 * GEOMETRY — designed once, signed by its author, tradable as an item — from
 * MATERIALS, chosen per element class when a buyer raises the house (D13).
 *
 * One law above all: a template that would compose an invalid room CANNOT BE
 * MINTED. Minting runs the same validators the Wave 10 builder runs, and
 * refuses in voice. The NPC presets fold in here as SYSTEM TEMPLATES — one
 * contract, no second path.
 *
 * This file is pure logic over plain data: no store, no canvas, no clock.
 */

import { IItem } from '../../../types';
import {
  IRoomState, RoomPieceKind, RoomVerdict, PIECE_BILLS, SHELL_BILLS, TAG_DEFAULT_MATERIAL,
  canBuildPiece, emptyRoom, fullyWalkable, interiorSize, roomDoor, roomSolid, shellBillFor
} from './room';
import { CRAFTED_DEFINITIONS } from '../economy/data/recipeDefinitions';
import { RESOURCE_DEFINITIONS } from '../item/data/resourceDefinitions';
import { MaterialPropertyType } from '../economy/types';

// ---------------------------------------------------------------------------
// THE CONTRACT
// ---------------------------------------------------------------------------

/** A named floor zone: tiles painted by the designer, with a promised open area. */
export interface ITemplateZone {
  name: string;
  tiles: { x: number; y: number }[];
  /** The open region these tiles sit in holds at least this many tiles. Promised at design, proven at mint. */
  minArea: number;
}

export interface ITemplate {
  version: 1;
  name: string;
  structureType: 'HOUSE' | 'WORKSHOP' | 'VENDOR';
  /** The lot footprint class this plan requires (the SIZE NEEDS, with the zones). */
  footprint: { width: number; height: number };
  /** Geometry only: what stands where. The material is the buyer's, at apply time. */
  pieces: { kind: RoomPieceKind; x: number; y: number }[];
  zones: ITemplateZone[];
  /** D14: the architect. Fixed at design time; every copy carries it forever. */
  authorUid: string;
  authorName: string;
  designedAt: number;
}

/** What the designer draws before the mint signs it. */
export type ITemplateDraft = Omit<ITemplate, 'version' | 'authorUid' | 'authorName' | 'designedAt'>;

/** D13: one material per element class, chosen on the apply sheet, billed by TAG. */
export interface ITemplateSheet {
  WALL: string;   // shell and inner walls — tag 'building'
  DOOR: string;   // tag 'wood'
  WINDOW: string; // tag 'glass'
  zones: Record<string, string>; // per-zone floor — tag 'building'
}

/** The lot classes a plan can be drawn at. Lots grow as hubs grow (D8). */
export const SIZE_CLASSES: { width: number; height: number }[] = [
  { width: 3, height: 3 },
  { width: 4, height: 4 },
  { width: 6, height: 5 }
];

/** D14: every mint and every copy is paid in paper and ink, by tag. */
export const TEMPLATE_MINT_BILL: { tag: string; count: number }[] = [
  { tag: 'paper', count: 1 },
  { tag: 'ink', count: 1 }
];

export const ELEMENT_TAG: Record<'WALL' | 'DOOR' | 'WINDOW', string> = {
  WALL: PIECE_BILLS.WALL.tag,
  DOOR: PIECE_BILLS.DOOR.tag,
  WINDOW: PIECE_BILLS.WINDOW.tag
};

/** One zone's floor bill: a tile of material covers four tiles of floor. */
export const zoneFloorCount = (zone: ITemplateZone) => Math.max(1, Math.ceil(zone.tiles.length / 4));

/** The sheet nobody chose: each tag's default material (previews, presets). */
export function defaultSheet(tpl: Pick<ITemplate, 'zones'>): ITemplateSheet {
  const zones: Record<string, string> = {};
  for (const z of tpl.zones) zones[z.name] = TAG_DEFAULT_MATERIAL.building;
  return {
    WALL: TAG_DEFAULT_MATERIAL.building,
    DOOR: TAG_DEFAULT_MATERIAL.wood,
    WINDOW: TAG_DEFAULT_MATERIAL.glass,
    zones
  };
}

export const sheetMaterialFor = (kind: RoomPieceKind, sheet: ITemplateSheet): string =>
  kind === 'WINDOW' ? sheet.WINDOW : kind === 'DOOR' ? sheet.DOOR : sheet.WALL;

// ---------------------------------------------------------------------------
// THE ONE COMPOSITION PATH: template + sheet -> room
// ---------------------------------------------------------------------------

/**
 * The room a template composes, materials answered by the sheet. Piece ids are
 * positional, so the same plan gives the same record — and the same bytes.
 */
export function templateToRoom(
  tpl: ITemplate,
  sheet: ITemplateSheet,
  lotId: string,
  footprintOverride?: { width: number; height: number }
): IRoomState {
  const room = emptyRoom(lotId, footprintOverride ?? tpl.footprint, sheet.WALL);
  tpl.pieces.forEach((p, i) => {
    room.pieces.push({
      id: `${lotId}:tpl:${i}`,
      kind: p.kind,
      x: p.x,
      y: p.y,
      materialDefId: sheetMaterialFor(p.kind, sheet),
      builtBy: tpl.authorUid,
      at: 0
    });
  });
  if (tpl.zones.length > 0) {
    room.floorZones = tpl.zones.map(z => ({
      name: z.name,
      tiles: z.tiles.map(t => ({ ...t })),
      materialDefId: sheet.zones[z.name] ?? TAG_DEFAULT_MATERIAL.building
    }));
  }
  return room;
}

// ---------------------------------------------------------------------------
// VALIDATION — the mint runs the builder's own law and refuses in voice
// ---------------------------------------------------------------------------

/** The open region containing (x, y): floor bounded by solids, divided by doors. */
export function openRegionArea(room: IRoomState, x: number, y: number): number {
  const { w, h } = room.size;
  const solid = roomSolid(room);
  for (const piece of room.pieces) {
    if (piece.kind === 'DOOR') solid[piece.y * w + piece.x] = 1; // a door divides rooms
  }
  if (x < 0 || y < 0 || x >= w || y >= h || solid[y * w + x]) return 0;
  const seen = new Uint8Array(w * h);
  const queue = [y * w + x];
  seen[queue[0]] = 1;
  let area = 0;
  while (queue.length > 0) {
    const i = queue.pop()!;
    area++;
    const ix = i % w, iy = (i / w) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = ix + dx, ny = iy + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const j = ny * w + nx;
      if (seen[j] || solid[j]) continue;
      seen[j] = 1;
      queue.push(j);
    }
  }
  return area;
}

/** The open area a zone's tiles sit in, measured on the composed plan. */
export function zoneRegionArea(tpl: ITemplate | ITemplateDraft, zone: ITemplateZone): number {
  const full = { version: 1, authorUid: '', authorName: '', designedAt: 0, ...tpl } as ITemplate;
  const room = templateToRoom(full, defaultSheet(full), 'measure');
  const { w, h } = room.size;
  const solid = roomSolid(room);
  for (const t of zone.tiles) {
    if (t.x >= 0 && t.y >= 0 && t.x < w && t.y < h && !solid[t.y * w + t.x]) {
      return openRegionArea(room, t.x, t.y);
    }
  }
  return 0;
}

/**
 * Can this plan be minted? The same validators the builder runs: every piece
 * where the builder would allow it, the whole room walkable from its door,
 * and every zone's promised area really there. Refusals carry the voice.
 */
export function validateTemplate(tpl: ITemplate | ITemplateDraft): RoomVerdict {
  const full = { version: 1, authorUid: '', authorName: '', designedAt: 0, ...tpl } as ITemplate;
  if (!SIZE_CLASSES.some(c => c.width === full.footprint.width && c.height === full.footprint.height)) {
    return { ok: false, reason: `No lot class measures ${full.footprint.width}×${full.footprint.height}. Draw at a real size.` };
  }

  // Each piece, added to the plan so far, must pass the builder's own check.
  const sheet = defaultSheet(full);
  const sofar = templateToRoom({ ...full, pieces: [], zones: [] }, sheet, 'validate');
  for (let i = 0; i < full.pieces.length; i++) {
    const p = full.pieces[i];
    const dup = full.pieces.findIndex(q => q.x === p.x && q.y === p.y);
    if (dup !== i) return { ok: false, reason: `Two pieces claim tile ${p.x},${p.y}. One tile, one piece.` };
    const v = canBuildPieceLoose(sofar, p.kind, p.x, p.y);
    if (!v.ok) return v;
    sofar.pieces.push({ id: `v:${i}`, kind: p.kind, x: p.x, y: p.y, materialDefId: sheetMaterialFor(p.kind, sheet), builtBy: '', at: 0 });
  }

  // The finished plan must be walkable from its door — nothing sealed.
  if (!fullyWalkable(sofar)) {
    return { ok: false, reason: 'The plan seals part of the room off from the door. Refused.' };
  }

  // Every zone keeps its promise, with the numbers.
  const names = new Set<string>();
  for (const zone of full.zones) {
    if (!zone.name.trim()) return { ok: false, reason: 'A zone with no name cannot be promised.' };
    if (names.has(zone.name)) return { ok: false, reason: `Two zones answer to ${zone.name}. Names are singular.` };
    names.add(zone.name);
    if (zone.tiles.length === 0) return { ok: false, reason: `Zone ${zone.name} paints no tiles.` };
    const door = roomDoor(sofar.size);
    for (const t of zone.tiles) {
      if (t.x <= 0 || t.y <= 0 || t.x >= sofar.size.w - 1 || t.y >= sofar.size.h - 1) {
        if (!(t.x === door.x && t.y === door.y)) {
          return { ok: false, reason: `Zone ${zone.name} paints the shell at ${t.x},${t.y}. Zones are floor.` };
        }
      }
    }
    const area = zoneRegionArea(full, zone);
    if (area < zone.minArea) {
      return { ok: false, reason: `Zone ${zone.name} promises ${zone.minArea} open tiles; the plan holds ${area}.` };
    }
  }
  return { ok: true };
}

/**
 * The live check while drawing: would the builder allow this piece on the plan
 * as drawn so far? Used by the studio on every stroke, in voice.
 */
export function canAddPiece(tpl: ITemplateDraft, kind: RoomPieceKind, x: number, y: number): RoomVerdict {
  const full = { version: 1, authorUid: '', authorName: '', designedAt: 0, ...tpl } as ITemplate;
  const room = templateToRoom(full, defaultSheet(full), 'studio');
  return canBuildPieceLoose(room, kind, x, y);
}

/**
 * canBuildPiece, with one design-time allowance: while DRAWING, a wall may
 * temporarily strand a region — the final walkability law still gates the mint.
 * Everything else (the door, the shell, the corners, the stair) refuses as built.
 */
function canBuildPieceLoose(room: IRoomState, kind: RoomPieceKind, x: number, y: number): RoomVerdict {
  const v = canBuildPiece(room, kind, x, y);
  if (v.ok) return v;
  // The sealing refusal is deferred to the whole-plan check; everything else stands.
  if (kind === 'WALL' && v.reason && /seal/i.test(v.reason)) return { ok: true };
  return v;
}

// ---------------------------------------------------------------------------
// SIZE NEEDS AND THE BILL
// ---------------------------------------------------------------------------

/** Line 43: a plan refuses a lot that does not meet its size needs, with the numbers. */
export function sizeNeedsVerdict(tpl: ITemplate, lotFootprint: { width: number; height: number }): RoomVerdict {
  const need = tpl.footprint;
  if (lotFootprint.width < need.width || lotFootprint.height < need.height) {
    return {
      ok: false,
      reason: `${tpl.name} asks for a ${need.width}×${need.height} lot; this one measures ${lotFootprint.width}×${lotFootprint.height}.`
    };
  }
  return { ok: true };
}

export interface ITemplateBill {
  /** The chosen classes: what the sheet names, how many, and the tag it must carry. */
  choices: { cls: string; defId: string; tag: string; count: number }[];
  /** Shell lines beyond the walls (a workshop's metal, a vendor's glass): by tag, no choice. */
  tagLines: { tag: string; count: number }[];
}

/**
 * D13: the whole bill, one material per element class, counted from the plan.
 * D25: a plan raising its owner's first WORKSHOP drops the same line a plain
 * shell does (`firstBench`, read by the caller from the state of the world).
 */
export function templateBill(tpl: ITemplate, sheet: ITemplateSheet, firstBench = false): ITemplateBill {
  const count = (kind: RoomPieceKind) => tpl.pieces.filter(p => p.kind === kind).length;
  const shell = firstBench ? shellBillFor(tpl.structureType, false) : SHELL_BILLS[tpl.structureType];
  const wallCount = shell.filter(l => l.tag === 'building').reduce((n, l) => n + l.count, 0) + count('WALL');

  const choices: ITemplateBill['choices'] = [];
  if (wallCount > 0) choices.push({ cls: 'WALLS', defId: sheet.WALL, tag: ELEMENT_TAG.WALL, count: wallCount });
  if (count('DOOR') > 0) choices.push({ cls: 'DOORS', defId: sheet.DOOR, tag: ELEMENT_TAG.DOOR, count: count('DOOR') });
  if (count('WINDOW') > 0) choices.push({ cls: 'WINDOWS', defId: sheet.WINDOW, tag: ELEMENT_TAG.WINDOW, count: count('WINDOW') });
  for (const zone of tpl.zones) {
    choices.push({
      cls: `FLOOR: ${zone.name}`,
      defId: sheet.zones[zone.name] ?? TAG_DEFAULT_MATERIAL.building,
      tag: 'building',
      count: zoneFloorCount(zone)
    });
  }
  const tagLines = shell.filter(l => l.tag !== 'building').map(l => ({ ...l }));
  return { choices, tagLines };
}

// ---------------------------------------------------------------------------
// FINISHED MEANS EQUAL — and the mono-material house is known (D13)
// ---------------------------------------------------------------------------

/** Line 42: the finished room matches the template piece for piece. */
export function templateMatchesRoom(tpl: ITemplate, sheet: ITemplateSheet, room: IRoomState): boolean {
  const want = templateToRoom(tpl, sheet, room.lotId);
  if (room.size.w !== want.size.w || room.size.h !== want.size.h) return false;
  if (room.shellMaterialDefId !== want.shellMaterialDefId) return false;
  if (room.pieces.length !== want.pieces.length) return false;
  const key = (p: { kind: string; x: number; y: number; materialDefId: string }) => `${p.kind}:${p.x}:${p.y}:${p.materialDefId}`;
  const have = new Set(room.pieces.map(key));
  for (const p of want.pieces) if (!have.has(key(p))) return false;
  const wantZones = want.floorZones ?? [];
  const haveZones = room.floorZones ?? [];
  if (wantZones.length !== haveZones.length) return false;
  for (const z of wantZones) {
    const match = haveZones.find(h => h.name === z.name);
    if (!match || match.materialDefId !== z.materialDefId || match.tiles.length !== z.tiles.length) return false;
  }
  return true;
}

/**
 * D13 (Pedro): a house built FULLY of one material earns a set bonus. 10B
 * detects and records the state; the bonus's numbers land with the materials
 * pass (11B), where properties reach bonuses.
 */
export function monoMaterialOf(room: IRoomState): string | null {
  const materials = new Set<string>([room.shellMaterialDefId]);
  for (const p of room.pieces) materials.add(p.materialDefId);
  for (const z of room.floorZones ?? []) materials.add(z.materialDefId);
  return materials.size === 1 ? [...materials][0] : null;
}

/**
 * Wave 10D (D13's deferred numbers, with D9's property bonuses): the
 * mono-material set bonus is REAL now, and its numbers come from the
 * material's own properties — properties reach bonuses, the STAB law:
 *   hardness + density  -> the house stands cheaper (upkeep discount, %)
 *   conductivity        -> the bench runs faster (craft speed, %)
 *   luminosity          -> the rooms sit brighter (light radius bonus)
 * Versioned by the composition rules; recorded on the standing house's card.
 */
export interface ISetBonus {
  upkeepDiscountPct: number;
  craftSpeedPct: number;
  lightBonus: number;
}

export function setBonusFor(materialDefId: string): ISetBonus | null {
  const def = (CRAFTED_DEFINITIONS[materialDefId] ?? RESOURCE_DEFINITIONS[materialDefId]) as
    { materialProps?: Partial<Record<MaterialPropertyType, number>> } | undefined;
  const props = def?.materialProps;
  if (!props) return null;
  const hardness = props[MaterialPropertyType.HARDNESS] ?? 0;
  const density = props[MaterialPropertyType.DENSITY] ?? 0;
  const conductivity = props[MaterialPropertyType.CONDUCTIVITY] ?? 0;
  const luminosity = props[MaterialPropertyType.LUMINOSITY] ?? 0;
  return {
    upkeepDiscountPct: Math.min(40, Math.round((hardness + density) / 2)),
    craftSpeedPct: Math.min(30, Math.round(conductivity / 2)),
    lightBonus: Math.floor(luminosity / 5)
  };
}

/** The set bonus said in the bank's voice, numbers and all. */
export function setBonusText(materialDefId: string): string {
  const bonus = setBonusFor(materialDefId);
  if (!bonus) return 'The set bonus is on record.';
  const parts: string[] = [];
  if (bonus.upkeepDiscountPct > 0) parts.push(`upkeep −${bonus.upkeepDiscountPct}%`);
  if (bonus.craftSpeedPct > 0) parts.push(`crafts ${bonus.craftSpeedPct}% faster`);
  if (bonus.lightBonus > 0) parts.push(`light +${bonus.lightBonus}`);
  return parts.length > 0 ? `Set bonus: ${parts.join(', ')}.` : 'The set bonus is on record.';
}

// ---------------------------------------------------------------------------
// THE CITY SIDE — what UNDER CONSTRUCTION means, as data
// ---------------------------------------------------------------------------

interface IConstructionJobLike {
  lotId: string;
  kind: 'SHELL' | 'PIECE';
  applied: boolean;
  batch?: string;
}

/**
 * The construction standing on a lot, if any: a pending template batch or a
 * pending shell. Progress counts applied jobs over the batch and only grows,
 * because jobs only move applied false -> true.
 */
export function lotConstruction(jobs: IConstructionJobLike[], lotId: string): { total: number; applied: number; progress: number } | null {
  const pending = jobs.filter(j => j.lotId === lotId && !j.applied && (j.batch || j.kind === 'SHELL'));
  if (pending.length === 0) return null;
  const batches = new Set(pending.map(j => j.batch).filter(Boolean) as string[]);
  const group = jobs.filter(j =>
    j.lotId === lotId && ((j.batch && batches.has(j.batch)) || pending.includes(j))
  );
  const applied = group.filter(j => j.applied).length;
  return { total: group.length, applied, progress: group.length > 0 ? applied / group.length : 0 };
}

// ---------------------------------------------------------------------------
// SYSTEM TEMPLATES (D8: NPCs never design — they build from these. Wave 11's
// pooling pools materials against a template's bill, this one.)
// ---------------------------------------------------------------------------

const SYSTEM_AUTHOR = { authorUid: 'SYSTEM', authorName: 'THE HUB', designedAt: 0, version: 1 as const };

export const SYSTEM_TEMPLATES: ITemplate[] = [
  {
    ...SYSTEM_AUTHOR,
    name: "Keeper's House",
    structureType: 'HOUSE',
    footprint: { width: 4, height: 4 },
    pieces: [
      { kind: 'WALL', x: 10, y: 1 }, { kind: 'WALL', x: 10, y: 2 }, { kind: 'WALL', x: 10, y: 3 },
      { kind: 'DOOR', x: 10, y: 4 },
      { kind: 'WINDOW', x: 4, y: 0 }, { kind: 'WINDOW', x: 12, y: 0 }
    ],
    zones: []
  },
  {
    ...SYSTEM_AUTHOR,
    name: 'Carpenter Mill',
    structureType: 'WORKSHOP',
    footprint: { width: 4, height: 4 },
    pieces: [
      { kind: 'WINDOW', x: 5, y: 0 }, { kind: 'WINDOW', x: 10, y: 0 }
    ],
    zones: []
  },
  {
    ...SYSTEM_AUTHOR,
    name: 'Market Stall',
    structureType: 'VENDOR',
    footprint: { width: 4, height: 4 },
    pieces: [
      { kind: 'WINDOW', x: 3, y: 0 }, { kind: 'WINDOW', x: 8, y: 0 }, { kind: 'WINDOW', x: 12, y: 0 }
    ],
    zones: []
  }
];

export interface IRoomPreset {
  id: string;
  name: string;
  structureType: 'HOUSE' | 'WORKSHOP' | 'VENDOR';
  /** The geometry: a system template, under the one contract. */
  template: ITemplate;
  stations: { defId: string; x: number; y: number }[];
}

export const ROOM_PRESETS: IRoomPreset[] = [
  { id: 'preset_keeper_house', name: "Keeper's House", structureType: 'HOUSE', template: SYSTEM_TEMPLATES[0], stations: [{ defId: 'stn_table', x: 3, y: 3 }] },
  { id: 'preset_mill', name: 'Carpenter Mill', structureType: 'WORKSHOP', template: SYSTEM_TEMPLATES[1], stations: [{ defId: 'stn_bench', x: 6, y: 2 }] },
  { id: 'preset_stall', name: 'Market Stall', structureType: 'VENDOR', template: SYSTEM_TEMPLATES[2], stations: [{ defId: 'stn_counter', x: 6, y: 4 }, { defId: 'stn_table', x: 2, y: 7 }] }
];

/** A preset made concrete through the ONE path: its template, the default sheet. */
export function presetToRoom(
  preset: IRoomPreset,
  lotId: string,
  lotFootprint: { width: number; height: number },
  mintItem: (defId: string, key: string) => IItem
): IRoomState {
  const room = templateToRoom(preset.template, defaultSheet(preset.template), lotId, lotFootprint);
  preset.stations.forEach((s, i) => {
    room.placements.push({
      id: `${preset.id}:st:${i}`,
      item: mintItem(s.defId, `${preset.id}:st:${i}`),
      x: s.x,
      y: s.y,
      rotated: false,
      placedBy: 'PRESET',
      at: 0
    });
  });
  return room;
}
