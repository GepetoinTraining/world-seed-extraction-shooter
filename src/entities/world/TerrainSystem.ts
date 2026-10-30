/**
 * TERRAIN SYSTEM (Wave 2.1)
 *
 * The ground is a pure function of the seed — primordial's coordinate-keyed
 * derivation. Nothing is stored: elevation is derived from keyed corner values
 * (`{seed}:elev:v1:{cx},{cy}`) and bilinearly interpolated per 20px tile, so
 * every client of a seed walks the same mud and drowns in the same water.
 *
 * Layer version: bump `v1` in ELEV_LAYER to re-roll terrain for NEW worlds
 * without silently changing old ones (goldens pin this).
 */

import { Rng } from '../../logic/rng/DeterministicRNG';
import { BiomeType } from './types';

export const TILE_PX = 20;        // 1 tile = 20px (the world-wide scale)
export const CHUNK_PX = 100;      // 5x5 tiles per chunk

const ELEV_LAYER = 'elev:v1';

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

  /** Keyed corner elevation in [0,1]. Pure; cheap enough to call raw. */
  private static corner(seed: string, cx: number, cy: number): number {
    return Rng.fromKey(`${seed}:${ELEV_LAYER}:${cx},${cy}`).next();
  }

  /** Smoothstep for less gradient-y interpolation. */
  private static smooth(t: number): number {
    return t * t * (3 - 2 * t);
  }

  /** Elevation at a world pixel position: bilinear over chunk corners. */
  static elevationAt(seed: string, px: number, pz: number): number {
    const cx = Math.floor(px / CHUNK_PX);
    const cy = Math.floor(pz / CHUNK_PX);
    const fx = this.smooth((px - cx * CHUNK_PX) / CHUNK_PX);
    const fy = this.smooth((pz - cy * CHUNK_PX) / CHUNK_PX);

    const e00 = this.corner(seed, cx, cy);
    const e10 = this.corner(seed, cx + 1, cy);
    const e01 = this.corner(seed, cx, cy + 1);
    const e11 = this.corner(seed, cx + 1, cy + 1);

    const top = e00 + (e10 - e00) * fx;
    const bot = e01 + (e11 - e01) * fx;
    return top + (bot - top) * fy;
  }

  /** The tile under a world pixel position. */
  static tileAt(seed: string, px: number, pz: number, biome?: BiomeType): ITerrainTile {
    // Snap to tile center so the whole tile reads the same
    const tx = Math.floor(px / TILE_PX) * TILE_PX + TILE_PX / 2;
    const tz = Math.floor(pz / TILE_PX) * TILE_PX + TILE_PX / 2;
    const e = this.elevationAt(seed, tx, tz);

    let type: TerrainType;
    if (e < 0.18) type = TerrainType.WATER;
    else if (e < 0.30) type = TerrainType.MUD;
    else if (e > 0.85) type = TerrainType.ROCK;
    else type = TerrainType.GROUND;

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
    biome?: BiomeType
  ): { x: number; z: number; speedMod: number } {
    const here = this.tileAt(seed, fromX, fromZ, biome);
    const speedMod = here.blocked ? 1.0 : here.speedMod;

    const stepX = dx * speedMod;
    const stepZ = dz * speedMod;

    // Already stuck? Let them out.
    if (here.blocked) {
      return { x: fromX + dx, z: fromZ + dz, speedMod: 1.0 };
    }

    let x = fromX;
    let z = fromZ;
    if (!this.tileAt(seed, fromX + stepX, fromZ, biome).blocked) x = fromX + stepX;
    if (!this.tileAt(seed, x, fromZ + stepZ, biome).blocked) z = fromZ + stepZ;

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
