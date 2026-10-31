/**
 * TERRAIN SYSTEM
 *
 * The ground is a pure function of the seed and the tile. Nothing is stored:
 * elevation comes from two scales of keyed noise, one for lakes and ridges and one
 * for their edges, so every client of a seed walks the same mud and drowns in the
 * same water, and land does not follow chunk lines.
 *
 * Layer version: bump ELEV_LAYER to re-roll terrain for new worlds (goldens pin this).
 */

import { layerSeed, valueNoise } from '../../logic/rng/noise';
import { TILE_PX, tileOf } from './grid';
import { BiomeType } from './types';

export { TILE_PX };

const ELEV_LAYER = 'elev:v2';
const BROAD_PERIOD = 40;
const FINE_PERIOD = 9;
const WATER_BELOW = 0.2528;
const MUD_BELOW = 0.3499;
const ROCK_ABOVE = 0.7846;

export enum TerrainType {
  WATER = 'WATER',   // blocked
  MUD = 'MUD',       // slow (0.5x)
  GROUND = 'GROUND', // normal
  ROCK = 'ROCK'      // blocked
}

export interface ITerrainTile {
  type: TerrainType;
  blocked: boolean;
  speedMod: number;  // multiplier on movement speed
  color: string;     // render tint (biome-aware)
}

const TILE_RULES: Record<TerrainType, { blocked: boolean; speedMod: number }> = {
  [TerrainType.WATER]:  { blocked: true,  speedMod: 0 },
  [TerrainType.ROCK]:   { blocked: true,  speedMod: 0 },
  [TerrainType.MUD]:    { blocked: false, speedMod: 0.5 },
  [TerrainType.GROUND]: { blocked: false, speedMod: 1.0 }
};

// Ground tint per biome; water/mud/rock keep global colors for readability
const BIOME_GROUND: Record<BiomeType, string> = {
  [BiomeType.WASTELAND]: '#1c1917',
  [BiomeType.OVERGROWTH]: '#0c1f17',
  [BiomeType.RUINS]: '#17181c',
  [BiomeType.INDUSTRIAL]: '#1c1614',
  [BiomeType.CYBER_CITY]: '#131325'
};

const COLORS: Record<TerrainType, string> = {
  [TerrainType.WATER]: '#0a1f33',
  [TerrainType.MUD]: '#2a2118',
  [TerrainType.ROCK]: '#3a3a40',
  [TerrainType.GROUND]: '#151515' // overridden by biome tint
};

export class TerrainSystem {

  /** Elevation of a tile. */
  static elevationOfTile(seed: string, tx: number, ty: number): number {
    const broad = valueNoise(layerSeed(seed, `${ELEV_LAYER}:broad`), tx, ty, BROAD_PERIOD);
    const fine = valueNoise(layerSeed(seed, `${ELEV_LAYER}:fine`), tx, ty, FINE_PERIOD);
    return broad * 0.72 + fine * 0.28;
  }

  /** What a tile is. The one place terrain is decided. */
  static typeAt(seed: string, tx: number, ty: number): TerrainType {
    const e = this.elevationOfTile(seed, tx, ty);
    if (e < WATER_BELOW) return TerrainType.WATER;
    if (e < MUD_BELOW) return TerrainType.MUD;
    if (e > ROCK_ABOVE) return TerrainType.ROCK;
    return TerrainType.GROUND;
  }

  static isBlockedTile(seed: string, tx: number, ty: number): boolean {
    return TILE_RULES[this.typeAt(seed, tx, ty)].blocked;
  }

  /** The tile under a world pixel position. */
  static tileAt(seed: string, px: number, pz: number, biome?: BiomeType): ITerrainTile {
    const type = this.typeAt(seed, tileOf(px), tileOf(pz));
    const rules = TILE_RULES[type];
    const color = type === TerrainType.GROUND && biome
      ? BIOME_GROUND[biome]
      : COLORS[type];

    return { type, blocked: rules.blocked, speedMod: rules.speedMod, color };
  }

  /**
   * Movement resolution: returns the allowed destination.
   * - Entering a blocked tile is refused per-axis (so you slide along walls).
   * - If you're ALREADY on a blocked tile (bad spawn), movement is free —
   *   you can always walk out, never be trapped.
   * - Speed modifier comes from the tile you STAND on.
   */
  static resolveMove(
    seed: string,
    fromX: number, fromZ: number,
    dx: number, dz: number,
    biome?: BiomeType,
    inBounds: (x: number, z: number) => boolean = () => true
  ): { x: number; z: number; speedMod: number } {
    const here = this.tileAt(seed, fromX, fromZ, biome);
    const speedMod = here.blocked ? 1.0 : here.speedMod;

    const stepX = dx * speedMod;
    const stepZ = dz * speedMod;

    // Already stuck? Let them out.
    if (here.blocked) {
      return { x: inBounds(fromX + dx, fromZ) ? fromX + dx : fromX, z: inBounds(fromX, fromZ + dz) ? fromZ + dz : fromZ, speedMod: 1.0 };
    }

    let x = fromX;
    let z = fromZ;
    if (inBounds(fromX + stepX, fromZ) && !this.tileAt(seed, fromX + stepX, fromZ, biome).blocked) x = fromX + stepX;
    if (inBounds(x, fromZ + stepZ) && !this.tileAt(seed, x, fromZ + stepZ, biome).blocked) z = fromZ + stepZ;

    return { x, z, speedMod };
  }

  /** Nearest walkable pixel to a target (spiral search) — for safe drops. */
  static nearestWalkable(seed: string, px: number, pz: number, maxRadiusTiles: number = 10): { x: number; z: number } {
    if (!this.tileAt(seed, px, pz).blocked) return { x: px, z: pz };
    for (let r = 1; r <= maxRadiusTiles; r++) {
      for (let a = 0; a < 16; a++) {
        const ang = (a / 16) * Math.PI * 2;
        const x = px + Math.cos(ang) * r * TILE_PX;
        const z = pz + Math.sin(ang) * r * TILE_PX;
        if (!this.tileAt(seed, x, z).blocked) return { x, z };
      }
    }
    return { x: px, z: pz }; // give up; resolveMove's escape rule covers it
  }
}
