/**
 * Composes the atoms into a view of a real world: same seed and same things as the
 * game, painted into a byte buffer with no canvas involved.
 */

import { fnv1a } from '../../logic/rng/DeterministicRNG';
import { WorldGenerator, IGenerationContext } from '../../entities/world/WorldGenerator';
import { TerrainSystem, TerrainType } from '../../entities/world/TerrainSystem';
import { CHUNK_TILES, SECTOR_PX, sectorOf } from '../../entities/world/grid';
import { GenreType } from '../../entities/world/definitions';
import { BiomeType, EntityType, IMap, IWorldEntity } from '../../entities/world/types';
import { MOB_DEFINITIONS } from '../../entities/mob/data/mobDefinitions';
import { RESOURCE_DEFINITIONS } from '../../entities/item/data/resourceDefinitions';
import {
  ATOM_PX, CreatureFacing, GenreLook, KNOWN, TILE_ATOMS, Genre, Ink, Material, Role, Sprite, TRI, chest, creature, exitBeacon, grain, hash2, material,
  npcFigure, px, rankMark, ruin, spent, stamp, worldForm
} from './atoms';
import { figure } from './people';

/** Four colors, a name and a chosen look are all an invented genre has to supply. */
export const GENRES: Genre[] = [
  { name: 'Fantasy', palette: ['#3d5a2a', '#b89a5a', '#6fbf4a', '#d9503f'], look: { structure: 'dunes', key: 2 } },
  { name: 'Eldritch', palette: ['#2a1d3d', '#7d6a9c', '#3fa08a', '#d14ae0'], look: { structure: 'lattice', key: 0 } },
  { name: 'Biopunk Wasteland', palette: ['#4a3d1f', '#a8b070', '#d06a8a', '#e8d020'], look: { structure: 'strata', key: 1 } }
];

/** The game's own genres. Each look is assigned, so no two can collide by accident. */
export const GENRE_LOOKS: Record<GenreType, Genre> = {
  [GenreType.FANTASY]: GENRES[0],
  [GenreType.ELDRITCH]: GENRES[1],
  [GenreType.SCIFI]: { name: 'Sci-Fi', palette: ['#1d2a3d', '#8a9cb0', '#4ad0d9', '#e0603a'], look: { structure: 'lattice', key: 1 } },
  [GenreType.POST_APOC]: { name: 'Post-Apoc', palette: ['#4a3a2a', '#a89878', '#8fa84a', '#d9743f'], look: { structure: 'blotches', key: 1 } },
  [GenreType.RETRO]: { name: 'Retro', palette: ['#2a2a4a', '#a8a8c8', '#50d080', '#e04070'], look: { structure: 'strata', key: 0 } }
};

const GENRE_ORDER = [GenreType.FANTASY, GenreType.SCIFI, GenreType.POST_APOC, GenreType.ELDRITCH, GenreType.RETRO];

/** A world keeps one palette, so the same machine draws all of it the same way. */
export const genreForWorld = (seed: string): Genre => GENRE_LOOKS[GENRE_ORDER[fnv1a(`world:genre:v1:${seed}`) % GENRE_ORDER.length]];

export const STATIC_CONTEXT: IGenerationContext = {
  mobDefinitions: Object.values(MOB_DEFINITIONS),
  resourceDefinitions: Object.values(RESOURCE_DEFINITIONS)
};

/** A view whose terrain is near the world's average: mostly open ground, with some mud. */
const isTypicalView = (seed: string, x: number, y: number) => {
  let mud = 0, total = 0;
  for (let ty = -7; ty <= 7; ty++) for (let tx = -12; tx <= 12; tx++) {
    total++;
    if (TerrainSystem.typeAt(seed, Math.floor(x / 20) + tx, Math.floor(y / 20) + ty) === TerrainType.MUD) mud++;
  }
  return mud / total >= 0.05 && mud / total <= 0.2;
};

/** The proof map: a real world, centered on an exit with a typical mix of terrain in view. */
export function proofView() {
  const map = WorldGenerator.generate('atoms-proof', 32, STATIC_CONTEXT);
  let spot = { x: 16.5 * SECTOR_PX, y: 16.5 * SECTOR_PX };
  search: for (let sy = 15; sy <= 18; sy++) for (let sx = 15; sx <= 18; sx++) {
    if (!map.sectors[`${sx},${sy}`]) continue;
    for (const e of WorldGenerator.exitsInSector(map, sx, sy)) {
      if (isTypicalView(map.seed, e.x, e.y)) { spot = e; break search; }
    }
  }
  WorldGenerator.loadAround(map, spot.x, spot.y, 900, STATIC_CONTEXT);
  return { map, center: { x: spot.x, y: spot.y } };
}

const BIOME_MATERIAL: Record<BiomeType, Partial<Material>> = {
  [BiomeType.WASTELAND]: { density: 15, toxicity: 8 },
  [BiomeType.OVERGROWTH]: { density: 35, elasticity: 45 },
  [BiomeType.RUINS]: { density: 20, hardness: 55 },
  [BiomeType.INDUSTRIAL]: { density: 25, conductivity: 28 },
  [BiomeType.CYBER_CITY]: { density: 25, conductivity: 55, resonance: 20 }
};

const signature = (genre: Genre) => fnv1a(`genre:v1:${genre.name}`);
const STRUCTURES: GenreLook['structure'][] = ['strata', 'blotches', 'lattice', 'dunes'];

const lookOf = (genre: Genre, sig: number): GenreLook =>
  genre.look ?? { structure: STRUCTURES[sig % 4], key: (sig >>> 4) % 3 };

/** A genre's own structure on open ground, large enough to see at play scale, so worlds differ in form and not only in hue. */
function genreStructure(look: GenreLook, sig: number, x: number, y: number): number {
  const ax = x + 4096, ay = y + 4096;
  switch (look.structure) {
    case 'strata':
      return Math.floor((ay + TRI[(ax >> 3) % 12] * 2) / 12) % 3 === 0 ? 1 : 0;
    case 'blotches':
      return hash2(sig, ax >> 4, ay >> 4) % 3 === 0 ? 1 : 0;
    case 'lattice':
      return ax % 20 < 2 || ay % 20 < 2 ? 2 : 0;
    default:
      return ((ax + ay * 2) >> 4) % 3 === 0 ? 1 : 0;
  }
}

const GROUND_TERRAIN: Record<string, Partial<Material>> = {
  [TerrainType.WATER]: { resonance: 45 },
  [TerrainType.ROCK]: { density: 40, hardness: 90 }
};

/** What open ground would be at this atom, whatever terrain is really there. */
export function openGround(map: IMap, genre: Genre, ax: number, ay: number): number {
  const sig = signature(genre);
  const look = lookOf(genre, sig);
  const chunkAtoms = CHUNK_TILES * TILE_ATOMS;
  const m = material(BIOME_MATERIAL[WorldGenerator.biomeAt(map.seed, Math.floor(ax / chunkAtoms), Math.floor(ay / chunkAtoms))]);
  return px(Role.GROUND, Math.min(4, look.key + Math.min(1, grain(m, ax, ay, fnv1a(map.seed))) + genreStructure(look, sig, ax, ay)));
}

export function terrainBuffer(map: IMap, genre: Genre, ox: number, oy: number, w: number, h: number): Uint8Array {
  const data = new Uint8Array(w * h);
  const seedHash = fnv1a(map.seed);
  const sig = signature(genre);
  const look = lookOf(genre, sig);
  const chunkAtoms = CHUNK_TILES * TILE_ATOMS;
  const sectorAtoms = SECTOR_PX / ATOM_PX;

  const tileCache = new Map<string, TerrainType>();
  const tileAt = (tx: number, ty: number) => {
    const key = `${tx},${ty}`;
    let t = tileCache.get(key);
    if (!t) { t = TerrainSystem.typeAt(map.seed, tx, ty); tileCache.set(key, t); }
    return t;
  };
  const biomes = new Map<string, Material>();
  const biomeMaterial = (cx: number, cy: number) => {
    const key = `${cx},${cy}`;
    let m = biomes.get(key);
    if (!m) { m = material(BIOME_MATERIAL[WorldGenerator.biomeAt(map.seed, cx, cy)]); biomes.set(key, m); }
    return m;
  };

  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const ax = ox + x, ay = oy + y;
    if (!map.sectors[`${Math.floor(ax / sectorAtoms)},${Math.floor(ay / sectorAtoms)}`]) { data[y * w + x] = px(Role.VOID, 1); continue; }

    const tx = Math.floor(ax / TILE_ATOMS), ty = Math.floor(ay / TILE_ATOMS);
    const lx = ax - tx * TILE_ATOMS, ly = ay - ty * TILE_ATOMS;
    const type = tileAt(tx, ty);

    let value: number;
    if (type === TerrainType.GROUND) {
      const m = biomeMaterial(Math.floor(ax / chunkAtoms), Math.floor(ay / chunkAtoms));
      value = px(Role.GROUND, Math.min(4, look.key + Math.min(1, grain(m, ax, ay, seedHash)) + genreStructure(look, sig, ax, ay)));
    } else if (type === TerrainType.MUD) {
      // Darkest and brightest steps only, so it reads against any genre's ground key.
      value = px(Role.GROUND, (ay + 4096 + TRI[((ax + 4096) >> 1) % 12]) % 3 === 0 ? 4 : 0);
    } else if (type === TerrainType.WATER) {
      // A dark body crossed by long broken crest lines, so it reads as water and
      // not as hollow squares. Crests stay at step 2: water is darker than mud's ripple.
      const crest = (ay + 4096 + TRI[((ax + 4096) >> 2) % 12]) % 6 === 0;
      const open = hash2(seedHash + 7, (ax + 4096) >> 3, ay + 4096) % 4 === 0;
      value = px(Role.GROUND, crest && !open ? 2 : (ax + ay) % 2 === 0 ? 0 : grain(material(GROUND_TERRAIN[type]), ax, ay, seedHash) ? 1 : 0);
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

/** A pack left on the ground: still its owner's, so it is drawn in proof. */
const groundCache = () => {
  const k = new Ink().rect(12, 14, 36, 44).rect(16, 6, 32, 14).rect(20, 10, 28, 14, 0).rect(12, 24, 36, 27, 0);
  return stamp(k, 12, material({ density: 40 }), fnv1a('sprite:v1:cache'), { role: Role.PROOF, edgeStep: 3, minFill: 1, maxFill: 2 });
};

// Wave 10C (D16): the cart — a bed on two wheels, read by shape. The bed shows
// PROOF atoms when loaded (cargo is value), and the owner's seal plank marks
// the front corner so a sealed cart is never mistaken for a free one.
const cartBody = () => {
  const k = new Ink()
    .rect(6, 18, 57, 40)          // the bed
    .rect(10, 22, 53, 36, 0)      // hollow interior
    .rect(4, 14, 59, 18)          // the rail
    .disc(18, 48, 7).disc(45, 48, 7)   // wheels
    .disc(18, 48, 2, 0).disc(45, 48, 2, 0) // hubs
    .line(57, 28, 63, 20, 1);     // tow bar
  return stamp(k, 26, material({ density: 70, hardness: 55 }), fnv1a('sprite:v1:cart'), { role: Role.MATTER, edgeStep: 4, minFill: 1, maxFill: 2 }, 22);
};

const cartSprite = (loaded: boolean) => {
  const base = cartBody();
  const data = new Uint8Array(base.data);
  // the seal plank: a proof mark riding the rail's left end — ownership reads without words
  for (let y = 6; y <= 8; y++) for (let x = 3; x <= 7; x++) data[y * base.w + x] = px(Role.PROOF, 3);
  if (loaded) {
    // cargo in the bed: proof atoms where the hollow was
    for (let y = 10; y <= 14; y++) for (let x = 7; x <= 21; x++) {
      if ((x + y) % 2 === 0) data[y * base.w + x] = px(Role.PROOF, 1 + ((x * 7 + y * 13) % 2));
    }
  }
  return { w: base.w, h: base.h, data };
};

export interface EntityPose { facing?: CreatureFacing; frame?: number }

type SpriteEntity = Pick<IWorldEntity, 'id' | 'type' | 'definitionId' | 'usesRemaining' | 'container' | 'cart'>;

export function entitySprite(e: SpriteEntity, level = KNOWN, pose: EntityPose = {}): Sprite | null {
  switch (e.type) {
    case EntityType.MOB: {
      const def = MOB_DEFINITIONS[e.definitionId];
      if (!def) return null;
      const facing = pose.facing ?? 'down';
      const frame = (pose.frame ?? 0) % 2;
      return cached(`${e.definitionId}:${facing}:${frame}`, () => creature(def as any, undefined, { facing, frame }));
    }
    case EntityType.RESOURCE: {
      const def = RESOURCE_DEFINITIONS[e.definitionId];
      if (!def) return null;
      const uses = e.usesRemaining ?? def.uses ?? 1;
      return cached(`${e.definitionId}:${uses}:${level}`, () => worldForm(def, { uses, level }));
    }
    case EntityType.STRUCTURE: return cached('ruin', ruin);
    case EntityType.CONTAINER:
      if (e.definitionId === 'ground_cache') return cached('cache', groundCache);
      return e.container?.looted ? cached('chest:looted', () => spent(chest(), false)) : cached('chest', chest);
    case EntityType.NPC: return cached('npc', () => npcFigure('npc'));
    case EntityType.EXTRACTION: return cached('exit', exitBeacon);
    case EntityType.CART: {
      const loaded = (e.cart?.items.length ?? 0) > 0;
      return cached(`cart:${loaded ? 'loaded' : 'empty'}`, () => cartSprite(loaded));
    }
    default: return null;
  }
}

export const LAYER: Partial<Record<EntityType, number>> = {
  [EntityType.STRUCTURE]: 0, [EntityType.RESOURCE]: 1, [EntityType.CONTAINER]: 2,
  [EntityType.CART]: 2, [EntityType.NPC]: 3, [EntityType.EXTRACTION]: 4, [EntityType.MOB]: 5
};

/** A tree that still stands. It is drawn upright and its trunk tile blocks (D3). */
export const isStandingTree = (e: SpriteEntity): boolean => {
  if (e.type !== EntityType.RESOURCE) return false;
  const def = RESOURCE_DEFINITIONS[e.definitionId];
  const tags: string[] = (def as any)?.tags || [];
  if (!tags.includes('wood') || tags.includes('seed')) return false;
  return (e.usesRemaining ?? (def as any)?.uses ?? 1) > 0;
};

/** D1: anything with a height stands upright, sorts by its feet, and can be walked behind. */
export const standsUpright = (e: SpriteEntity): boolean =>
  e.type === EntityType.MOB || e.type === EntityType.NPC || isStandingTree(e);

/**
 * Where a sprite's feet land, in px below the entity's position. Centered things
 * put their baseline at their own bottom; a standing tree is rooted on its tile.
 */
export const baselinePx = (e: SpriteEntity, sprite: Sprite): number =>
  isStandingTree(e) ? TILE_ATOMS * ATOM_PX / 2 : (sprite.h * ATOM_PX) / 2;

/** Paints a full view: terrain, then everything in the window, then the player. */
export function composeView(map: IMap, genre: Genre, centerPx: { x: number; y: number }, w: number, h: number) {
  const ox = Math.floor(centerPx.x / ATOM_PX) - Math.floor(w / 2);
  const oy = Math.floor(centerPx.y / ATOM_PX) - Math.floor(h / 2);
  const data = terrainBuffer(map, genre, ox, oy, w, h);

  const reach = (Math.max(w, h) * ATOM_PX) / 2 + 80;
  const entities = WorldGenerator.chunkKeysInBox(centerPx.x, centerPx.y, reach)
    .flatMap(key => {
      const [cx, cy] = key.split(',').map(Number);
      return WorldGenerator.chunkAt(map, cx, cy, STATIC_CONTEXT)?.entities ?? [];
    })
    .filter(e => {
      const ex = e.position.x / ATOM_PX - ox, ey = e.position.y / ATOM_PX - oy;
      return ex > -40 && ey > -40 && ex < w + 40 && ey < h + 40;
    });

  // Flat things draw by layer; standing things draw by their feet, the player among them.
  const flats = entities.filter(e => !standsUpright(e))
    .sort((a, b) => (LAYER[a.type] ?? 9) - (LAYER[b.type] ?? 9) || (a.id < b.id ? -1 : 1));
  const standing: { e: IWorldEntity | null; sprite: Sprite; feet: number; x: number }[] = [];
  for (const e of entities) {
    if (!standsUpright(e)) continue;
    const sprite = entitySprite(e);
    if (sprite) standing.push({ e, sprite, feet: e.position.y + baselinePx(e, sprite), x: e.position.x });
  }
  const player = cached('player', () => figure({ uid: 'ws_proof', archetype: 'NOMAD' }));
  standing.push({ e: null, sprite: player, feet: centerPx.y + (player.h * ATOM_PX) / 2, x: centerPx.x });
  standing.sort((a, b) => a.feet - b.feet || (a.e && b.e ? (a.e.id < b.e.id ? -1 : 1) : a.e ? -1 : 1));

  let count = 0;
  for (const e of flats) {
    const sprite = entitySprite(e);
    if (!sprite) continue;
    blit(data, w, h, sprite, e.position.x / ATOM_PX - ox, e.position.y / ATOM_PX - oy);
    count++;
  }
  for (const s of standing) {
    const ex = s.x / ATOM_PX - ox, ey = s.feet / ATOM_PX - s.sprite.h / 2 - oy;
    blit(data, w, h, s.sprite, ex, ey);
    if (s.e?.type === EntityType.MOB) blit(data, w, h, rankMark(s.e.rank), ex + s.sprite.w / 2, ey + s.sprite.h / 2);
    if (s.e) count++;
  }
  return { data, w, h, entities: count };
}

export const sectorKeyAt = (px: number, py: number) => `${sectorOf(px)},${sectorOf(py)}`;
