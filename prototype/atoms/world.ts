/**
 * Composes the atoms into a view of a real generated map: same seed and same
 * entities as the game, painted into a byte buffer with no canvas involved.
 */

import { fnv1a } from '../../src/logic/rng/DeterministicRNG';
import { WorldGenerator } from '../../src/entities/world/WorldGenerator';
import { TerrainSystem, TerrainType } from '../../src/entities/world/TerrainSystem';
import { IMap, EntityType, BiomeType } from '../../src/entities/world/types';
import { MOB_DEFINITIONS } from '../../src/entities/mob/data/mobDefinitions';
import { RESOURCE_DEFINITIONS } from '../../src/entities/item/data/resourceDefinitions';
import {
  ATOM_PX, TILE_ATOMS, Genre, Material, Role, Sprite, TRI, chest, creature, exitBeacon, grain, hash2, material,
  npcFigure, playerFigure, px, rankMark, resource, ruin
} from './atoms';

/** Four colors and a name are all an invented genre has to supply. */
export const GENRES: Genre[] = [
  { name: 'Fantasy', palette: ['#3d5a2a', '#b89a5a', '#6fbf4a', '#d9503f'] },
  { name: 'Eldritch', palette: ['#2a1d3d', '#7d6a9c', '#3fa08a', '#d14ae0'] },
  { name: 'Biopunk Wasteland', palette: ['#4a3d1f', '#a8b070', '#d06a8a', '#e8d020'] }
];

/** The proof map: a real generated world, centered on its most interior exit. */
export function proofView() {
  const map = WorldGenerator.generate('atoms-proof', 32, {
    mobDefinitions: Object.values(MOB_DEFINITIONS),
    resourceDefinitions: Object.values(RESOURCE_DEFINITIONS)
  });
  const mid = 16;
  const [ex, ey] = [...map.extractionPoints]
    .map(k => k.split(',').map(Number))
    .sort((a, b) => Math.hypot(a[0] - mid, a[1] - mid) - Math.hypot(b[0] - mid, b[1] - mid))[0];
  return { map, center: { x: ex * 100 + 50, y: ey * 100 + 50 } };
}

const BIOME_MATERIAL: Record<BiomeType, Partial<Material>> = {
  [BiomeType.WASTELAND]: { density: 15, toxicity: 8 },
  [BiomeType.OVERGROWTH]: { density: 35, elasticity: 45 },
  [BiomeType.RUINS]: { density: 20, hardness: 55 },
  [BiomeType.INDUSTRIAL]: { density: 25, conductivity: 28 },
  [BiomeType.CYBER_CITY]: { density: 25, conductivity: 55, resonance: 20 }
};

const signature = (genre: Genre) => fnv1a(`genre:v1:${genre.name}`);

/**
 * A genre's own structure on open ground, large enough to see at play scale, so
 * worlds differ in form and not only in hue. 4 structures x 3 keys = 12 looks.
 */
function genreStructure(sig: number, x: number, y: number): number {
  const ax = x + 4096, ay = y + 4096;
  switch (sig % 4) {
    case 0: // strata
      return Math.floor((ay + TRI[(ax >> 3) % 12] * 2) / 12) % 3 === 0 ? 1 : 0;
    case 1: // blotches
      return hash2(sig, ax >> 4, ay >> 4) % 3 === 0 ? 1 : 0;
    case 2: // lattice
      return ax % 20 < 2 || ay % 20 < 2 ? 2 : 0;
    default: // dunes
      return ((ax + ay * 2) >> 4) % 3 === 0 ? 1 : 0;
  }
}

const genreKey = (sig: number) => (sig >>> 4) % 3;

const GROUND_TERRAIN: Record<string, Partial<Material>> = {
  [TerrainType.WATER]: { resonance: 45 },
  [TerrainType.ROCK]: { density: 40, hardness: 90 }
};

/** What open ground would be at this atom, whatever terrain is really there. */
export function openGround(map: IMap, genre: Genre, ax: number, ay: number): number {
  const sig = signature(genre);
  const chunk = map.chunks[`${Math.floor(ax / 50)},${Math.floor(ay / 50)}`];
  const m = material(chunk ? BIOME_MATERIAL[chunk.biome] : {});
  return px(Role.GROUND, Math.min(4, genreKey(sig) + Math.min(1, grain(m, ax, ay, fnv1a(map.seed))) + genreStructure(sig, ax, ay)));
}

export function terrainBuffer(map: IMap, genre: Genre, ox: number, oy: number, w: number, h: number): Uint8Array {
  const data = new Uint8Array(w * h);
  const seedHash = fnv1a(map.seed);
  const tileCache = new Map<string, TerrainType>();
  const tileAt = (tx: number, ty: number) => {
    const key = `${tx},${ty}`;
    let t = tileCache.get(key);
    if (!t) {
      t = TerrainSystem.tileAt(map.seed, tx * 20 + 10, ty * 20 + 10).type;
      tileCache.set(key, t);
    }
    return t;
  };

  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const ax = ox + x, ay = oy + y;
    const chunk = map.chunks[`${Math.floor(ax / 50)},${Math.floor(ay / 50)}`];
    if (!chunk) { data[y * w + x] = px(Role.VOID, 1); continue; }

    const tx = Math.floor(ax / TILE_ATOMS), ty = Math.floor(ay / TILE_ATOMS);
    const lx = ax - tx * TILE_ATOMS, ly = ay - ty * TILE_ATOMS;
    const type = tileAt(tx, ty);

    let value: number;
    if (type === TerrainType.GROUND) {
      value = openGround(map, genre, ax, ay);
    } else if (type === TerrainType.MUD) {
      // Darkest and brightest steps only, so it reads against any genre's ground key.
      value = px(Role.GROUND, (ay + 4096 + TRI[((ax + 4096) >> 1) % 12]) % 3 === 0 ? 4 : 0);
    } else if (type === TerrainType.WATER) {
      value = px(Role.GROUND, Math.min(2, grain(material(GROUND_TERRAIN[type]), ax, ay, seedHash)));
    } else {
      value = px(Role.MATTER, Math.min(1, grain(material(GROUND_TERRAIN[type]), ax, ay, seedHash)));
    }

    // A hard seam wherever walkable ground meets something blocked.
    const blocked = type === TerrainType.WATER || type === TerrainType.ROCK;
    if (blocked) {
      const differs = (dx: number, dy: number) => tileAt(tx + dx, ty + dy) !== type;
      if ((lx === 0 && differs(-1, 0)) || (lx === TILE_ATOMS - 1 && differs(1, 0)) ||
          (ly === 0 && differs(0, -1)) || (ly === TILE_ATOMS - 1 && differs(0, 1))) {
        value = type === TerrainType.WATER ? px(Role.MATTER, 0) : px(Role.MATTER, 2);
      }
    }
    data[y * w + x] = value;
  }
  return data;
}

function blit(data: Uint8Array, w: number, h: number, s: Sprite, cx: number, cy: number) {
  const x0 = Math.round(cx) - Math.floor(s.w / 2), y0 = Math.round(cy) - Math.floor(s.h / 2);
  for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) {
    const v = s.data[y * s.w + x];
    if (!v) continue;
    const dx = x0 + x, dy = y0 + y;
    if (dx >= 0 && dy >= 0 && dx < w && dy < h) data[dy * w + dx] = v;
  }
}

const cache = new Map<string, Sprite>();
const cached = (key: string, make: () => Sprite) => {
  let s = cache.get(key);
  if (!s) { s = make(); cache.set(key, s); }
  return s;
};

export function entitySprite(e: { id: string; type: EntityType; definitionId: string }): Sprite | null {
  switch (e.type) {
    case EntityType.MOB: {
      const def = MOB_DEFINITIONS[e.definitionId];
      return def ? cached(e.definitionId, () => creature(def as any)) : null;
    }
    case EntityType.RESOURCE: {
      const def = RESOURCE_DEFINITIONS[e.definitionId];
      return def ? cached(e.definitionId, () => resource(def)) : null;
    }
    case EntityType.STRUCTURE: return cached('ruin', ruin);
    case EntityType.CONTAINER: return cached('chest', chest);
    case EntityType.NPC: return cached('npc', () => npcFigure('npc'));
    case EntityType.EXTRACTION: return cached('exit', exitBeacon);
    default: return null;
  }
}

const LAYER: Partial<Record<EntityType, number>> = {
  [EntityType.STRUCTURE]: 0, [EntityType.RESOURCE]: 1, [EntityType.CONTAINER]: 2,
  [EntityType.NPC]: 3, [EntityType.EXTRACTION]: 4, [EntityType.MOB]: 5
};

/** Paints a full view: terrain, then everything in the window, then the player. */
export function composeView(map: IMap, genre: Genre, centerPx: { x: number; y: number }, w: number, h: number) {
  const ox = Math.floor(centerPx.x / ATOM_PX) - Math.floor(w / 2);
  const oy = Math.floor(centerPx.y / ATOM_PX) - Math.floor(h / 2);
  const data = terrainBuffer(map, genre, ox, oy, w, h);

  const entities = Object.values(map.chunks).flatMap(c => c.entities)
    .filter(e => {
      const ex = e.position.x / ATOM_PX - ox, ey = e.position.y / ATOM_PX - oy;
      return ex > -40 && ey > -40 && ex < w + 40 && ey < h + 40;
    })
    .sort((a, b) => (LAYER[a.type] ?? 9) - (LAYER[b.type] ?? 9));

  let count = 0;
  for (const e of entities) {
    const sprite = entitySprite(e);
    if (!sprite) continue;
    const ex = e.position.x / ATOM_PX - ox, ey = e.position.y / ATOM_PX - oy;
    blit(data, w, h, sprite, ex, ey);
    if (e.type === EntityType.MOB) blit(data, w, h, rankMark(e.rank), ex + sprite.w / 2, ey + sprite.h / 2);
    count++;
  }
  blit(data, w, h, cached('player', playerFigure), w / 2, h / 2);
  return { data, w, h, entities: count };
}

/** Same pixels with terrain removed: what must not change between genres. */
export function entityLayer(map: IMap, centerPx: { x: number; y: number }, w: number, h: number): Uint8Array {
  const blank: Genre = { name: '', palette: ['#000000', '#000000', '#000000', '#000000'] };
  const a = composeView(map, blank, centerPx, w, h).data;
  const base = terrainBuffer(map, blank, Math.floor(centerPx.x / ATOM_PX) - Math.floor(w / 2), Math.floor(centerPx.y / ATOM_PX) - Math.floor(h / 2), w, h);
  return a.map((v, i) => (v === base[i] ? 0 : v));
}
