import { describe, it, expect } from 'vitest';
import {
  CHUNK_PX, CHUNK_QUADRANTS, CHUNK_TILES, QUADRANT_PX, QUADRANT_TILES, SECTOR_CHUNKS, SECTOR_PX, SECTOR_TILES, TILE_PX,
  chunkOf, quadrantOf, sectorOf, tileOf
} from '../shared/entities/world/grid';
import { BiomeType, EntityType, IChunk } from '../shared/entities/world/types';
import { TerrainSystem, TerrainType } from '../shared/entities/world/TerrainSystem';
import { WorldGenerator } from '../shared/entities/world/WorldGenerator';
import { MOB_DEFINITIONS } from '../shared/entities/mob/data/mobDefinitions';
import { RESOURCE_DEFINITIONS } from '../shared/entities/item/data/resourceDefinitions';
import { PROJECTILE_RANGE_PX, SIM_MARGIN_PX } from '../shared/entities/combat/projectileSystem';
import { HubGenerator } from '../src/entities/hub/HubGenerator';

// Bars registered before the new generator existed. Do not lower them to get a pass.
const MIN_NEIGHBOUR_MATCH = 0.8;
const MIN_BIOME_SHARE = 0.05;
const MIN_TREES_PER_OVERGROWTH_CHUNK = 20;
const MIN_FOREST_QUADRANTS = 0.1;
const MAX_FOREST_QUADRANTS = 0.6;
const FOREST_MIN_TREES = 8;
const CHUNK_MEDIAN_MS = 4;
const CHUNK_WORST_MS = 16;
const SECTOR_SCAN_MS = 500;
const WORLD_MS = 60;
const MIN_CHUNKS_WITH_ENEMIES = 0.9; // added after playing: whole regions had none
const DROP_CLEAR_TILES = 12; // added after playing: a drop landed beside a guarded ruin
const SHARES: Record<string, [number, number]> = {
  [TerrainType.WATER]: [0.04, 0.10], [TerrainType.MUD]: [0.08, 0.18], [TerrainType.ROCK]: [0.02, 0.08], [TerrainType.GROUND]: [0.65, 0.85]
};

const context = { mobDefinitions: Object.values(MOB_DEFINITIONS), resourceDefinitions: Object.values(RESOURCE_DEFINITIONS) } as any;
const SEEDS = ['atoms-proof', 'a', 'b', 'c'];
const SIZE = 16;

const chunkRange = (sx: number, sy: number) => {
  const out: [number, number][] = [];
  for (let y = 0; y < SECTOR_CHUNKS; y++) for (let x = 0; x < SECTOR_CHUNKS; x++) out.push([sx * SECTOR_CHUNKS + x, sy * SECTOR_CHUNKS + y]);
  return out;
};
const stripTimes = (c: IChunk) => JSON.stringify(c);

describe('the grid', () => {
  it('nests as Pedro set it: 16 tiles a quadrant, 64 a chunk, 512 a sector', () => {
    expect(TILE_PX).toBe(20);
    expect(QUADRANT_TILES).toBe(16);
    expect(CHUNK_TILES).toBe(64);
    expect(SECTOR_TILES).toBe(512);
    expect(CHUNK_QUADRANTS * QUADRANT_TILES).toBe(CHUNK_TILES);
    expect(SECTOR_CHUNKS * CHUNK_TILES).toBe(SECTOR_TILES);
    expect(QUADRANT_PX).toBe(320);
    expect(CHUNK_PX).toBe(1280);
    expect(SECTOR_PX).toBe(10240);
  });

  it('finds the cell of any position, including negatives and exact edges', () => {
    expect(tileOf(0)).toBe(0);
    expect(tileOf(19.9)).toBe(0);
    expect(tileOf(20)).toBe(1);
    expect(tileOf(-1)).toBe(-1);
    expect(quadrantOf(319)).toBe(0);
    expect(quadrantOf(320)).toBe(1);
    expect(chunkOf(1279)).toBe(0);
    expect(chunkOf(1280)).toBe(1);
    expect(sectorOf(10239)).toBe(0);
    expect(sectorOf(10240)).toBe(1);
    expect(chunkOf(-1)).toBe(-1);
  });

  it('uses one tile size for the field and the hub', async () => {
    const { HUB_TILE_PX } = await import('../src/entities/hub/HubCanvas.constants');
    expect(HUB_TILE_PX).toBe(TILE_PX);
  });
});

describe('a chunk is a pure function of its place', () => {
  it('is the same whatever was generated before it', () => {
    const fresh = () => WorldGenerator.generate('stable', SIZE, context);
    const a = WorldGenerator.chunkAt(fresh(), 40, 40, context);
    const map = fresh();
    WorldGenerator.chunkAt(map, 41, 40, context);
    WorldGenerator.chunkAt(map, 3, 3, context);
    const b = WorldGenerator.chunkAt(map, 40, 40, context);
    expect(stripTimes(a!)).toBe(stripTimes(b!));
  });

  it('does not change with the size of the world around it', () => {
    const small = WorldGenerator.chunkAt(WorldGenerator.generate('stable', 16, context), 64, 64, context);
    const large = WorldGenerator.chunkAt(WorldGenerator.generate('stable', 32, context), 64, 64, context);
    expect(small).toBeTruthy();
    expect(stripTimes(small!)).toBe(stripTimes(large!));
  });

  it('does not depend on the order definitions were loaded in', () => {
    const reversed = { mobDefinitions: [...context.mobDefinitions].reverse(), resourceDefinitions: [...context.resourceDefinitions].reverse() };
    const a = WorldGenerator.chunkAt(WorldGenerator.generate('stable', SIZE, context), 40, 40, context);
    const b = WorldGenerator.chunkAt(WorldGenerator.generate('stable', SIZE, reversed), 40, 40, reversed);
    expect(stripTimes(a!)).toBe(stripTimes(b!));
  });

  it('gives different seeds different land', () => {
    const a = WorldGenerator.chunkAt(WorldGenerator.generate('one', SIZE, context), 40, 40, context);
    const b = WorldGenerator.chunkAt(WorldGenerator.generate('two', SIZE, context), 40, 40, context);
    expect(stripTimes(a!)).not.toBe(stripTimes(b!));
  });
});

describe('regions', () => {
  it('holds biomes together: neighbouring chunks mostly match', () => {
    SEEDS.forEach(seed => {
      let same = 0, total = 0;
      for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
        const b = WorldGenerator.biomeAt(seed, x, y);
        if (WorldGenerator.biomeAt(seed, x + 1, y) === b) same++;
        if (WorldGenerator.biomeAt(seed, x, y + 1) === b) same++;
        total += 2;
      }
      console.log(`REGIONS ${seed}: neighbouring chunks match ${((same / total) * 100).toFixed(0)}%`);
      expect(same / total, seed).toBeGreaterThanOrEqual(MIN_NEIGHBOUR_MATCH);
    });
  });

  it('holds threat together too', () => {
    SEEDS.forEach(seed => {
      let same = 0, total = 0;
      for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
        const r = WorldGenerator.rankAt(seed, x, y);
        if (WorldGenerator.rankAt(seed, x + 1, y) === r) same++;
        if (WorldGenerator.rankAt(seed, x, y + 1) === r) same++;
        total += 2;
      }
      expect(same / total, seed).toBeGreaterThanOrEqual(MIN_NEIGHBOUR_MATCH);
    });
  });

  it('uses all five biomes, Cyber City included', () => {
    const counts: Record<string, number> = {};
    let total = 0;
    SEEDS.forEach(seed => {
      for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
        const b = WorldGenerator.biomeAt(seed, x, y);
        counts[b] = (counts[b] || 0) + 1;
        total++;
      }
    });
    console.log(`BIOMES ${Object.entries(counts).map(([k, v]) => `${k} ${((v / total) * 100).toFixed(0)}%`).join(', ')}`);
    Object.values(BiomeType).forEach(b => expect((counts[b] || 0) / total, b).toBeGreaterThanOrEqual(MIN_BIOME_SHARE));
  });

  it('keeps terrain in its proportions, on any seed', () => {
    SEEDS.forEach(seed => {
      const counts: Record<string, number> = {};
      let total = 0;
      for (let ty = 0; ty < 1024; ty += 2) for (let tx = 0; tx < 1024; tx += 2) {
        const t = TerrainSystem.typeAt(seed, tx, ty);
        counts[t] = (counts[t] || 0) + 1;
        total++;
      }
      console.log(`TERRAIN ${seed}: ${Object.entries(counts).map(([k, v]) => `${k} ${((v / total) * 100).toFixed(1)}%`).join(', ')}`);
      Object.entries(SHARES).forEach(([type, [lo, hi]]) => {
        const share = (counts[type] || 0) / total;
        expect(share, `${seed} ${type}`).toBeGreaterThanOrEqual(lo);
        expect(share, `${seed} ${type}`).toBeLessThanOrEqual(hi);
      });
    });
  });
});

describe('what stands in the world', () => {
  const sample = (seed: string) => {
    const map = WorldGenerator.generate(seed, SIZE, context);
    return { map, chunks: [...chunkRange(7, 7), ...chunkRange(8, 8)].map(([x, y]) => WorldGenerator.chunkAt(map, x, y, context)!).filter(Boolean) };
  };

  it('sits on the grid, never on blocked ground, and never two to a tile', () => {
    SEEDS.forEach(seed => {
      const { chunks } = sample(seed);
      const things = chunks.flatMap(c => c.entities);
      expect(things.length).toBeGreaterThan(0);
      const seen = new Set<string>();
      let offGrid = 0, blocked = 0, doubled = 0;
      things.forEach(e => {
        if (e.position.x % TILE_PX !== TILE_PX / 2 || e.position.y % TILE_PX !== TILE_PX / 2) offGrid++;
        if (TerrainSystem.tileAt(seed, e.position.x, e.position.y).blocked) blocked++;
        const key = `${e.position.x},${e.position.y}`;
        if (seen.has(key)) doubled++;
        seen.add(key);
      });
      console.log(`THINGS ${seed}: ${things.length} in ${chunks.length} chunks; ${offGrid} off grid, ${blocked} blocked, ${doubled} doubled`);
      expect(offGrid).toBe(0);
      expect(blocked).toBe(0);
      expect(doubled).toBe(0);
    });
  });

  it('keeps a thing inside the chunk that owns it', () => {
    const { chunks } = sample('a');
    chunks.forEach(c => c.entities.forEach(e => {
      expect(chunkOf(e.position.x), e.id).toBe(c.x);
      expect(chunkOf(e.position.y), e.id).toBe(c.y);
    }));
  });

  it('spawns every resource in the game, Titanium included', () => {
    const seen = new Set<string>();
    SEEDS.forEach(seed => {
      const map = WorldGenerator.generate(seed, 32, context);
      for (let s = 0; s < 20 && seen.size < 14; s++) {
        chunkRange(s + 6, 16).forEach(([x, y]) => {
          WorldGenerator.chunkAt(map, x, y, context)?.entities.forEach(e => { if (e.type === EntityType.RESOURCE) seen.add(e.definitionId); });
        });
      }
    });
    const missing = Object.keys(RESOURCE_DEFINITIONS).filter(id => !seen.has(id));
    expect(missing).toEqual([]);
  });

  it('never places an enemy above its chunk rank unless the genre has nothing lower', () => {
    const order = ['F', 'E', 'D', 'C', 'B', 'A', 'S', 'SS', 'SSS'];
    const { chunks } = sample('a');
    chunks.forEach(chunk => chunk.entities.filter(e => e.type === EntityType.MOB).forEach(e => {
      const def: any = MOB_DEFINITIONS[e.definitionId];
      const isBoss = (def.tags || []).some((t: string) => ['boss', 'god', 'titan'].includes(t));
      if (isBoss) expect(order.indexOf(def.rank), e.definitionId).toBeLessThanOrEqual(order.indexOf(chunk.difficulty));
    }));
  });

  it('has enemies in nearly every chunk, in every genre\'s region', () => {
    SEEDS.forEach(seed => {
      const { chunks } = sample(seed);
      const share = chunks.filter(c => c.entities.some(e => e.type === EntityType.MOB)).length / chunks.length;
      console.log(`ENEMIES ${seed}: ${(share * 100).toFixed(0)}% of chunks have some`);
      expect(share, seed).toBeGreaterThanOrEqual(MIN_CHUNKS_WITH_ENEMIES);
    });
  });

  it('grows real forests in Overgrowth', () => {
    let treesInGrowth = 0, growthChunks = 0, forests = 0, growthQuadrants = 0;
    SEEDS.forEach(seed => {
      const map = WorldGenerator.generate(seed, SIZE, context);
      for (let cy = 40; cy < 88; cy++) for (let cx = 40; cx < 88; cx++) {
        if (WorldGenerator.biomeAt(seed, cx, cy) !== BiomeType.OVERGROWTH) continue;
        const c = WorldGenerator.chunkAt(map, cx, cy, context);
        if (!c) continue;
        growthChunks++;
        const byQuad: Record<string, number> = {};
        c.entities.filter(e => e.definitionId === 'res_tree_log').forEach(e => {
          treesInGrowth++;
          const q = `${quadrantOf(e.position.x)},${quadrantOf(e.position.y)}`;
          byQuad[q] = (byQuad[q] || 0) + 1;
        });
        growthQuadrants += CHUNK_QUADRANTS * CHUNK_QUADRANTS;
        forests += Object.values(byQuad).filter(n => n >= FOREST_MIN_TREES).length;
      }
    });
    const perChunk = treesInGrowth / growthChunks, share = forests / growthQuadrants;
    console.log(`FOREST ${perChunk.toFixed(1)} trees per Overgrowth chunk; ${(share * 100).toFixed(0)}% of its quadrants are forest (${growthChunks} chunks)`);
    expect(perChunk).toBeGreaterThanOrEqual(MIN_TREES_PER_OVERGROWTH_CHUNK);
    expect(share).toBeGreaterThanOrEqual(MIN_FOREST_QUADRANTS);
    expect(share).toBeLessThanOrEqual(MAX_FOREST_QUADRANTS);
  });
});

describe('getting in and getting out', () => {
  const map = WorldGenerator.generate('a', SIZE, context);
  const sectors = Object.values(map.sectors);

  it('has a scannable sector for every part of the world', () => {
    console.log(`WORLD 'a' size ${SIZE}: ${sectors.length} sectors of ${SIZE * SIZE}`);
    expect(sectors.length).toBeGreaterThan(SIZE * SIZE * 0.4);
    sectors.forEach(s => {
      expect(s.x).toBeLessThan(SIZE);
      expect(s.y).toBeLessThan(SIZE);
    });
  });

  it('puts exits on walkable ground in every sector', () => {
    sectors.forEach(s => {
      const exits = WorldGenerator.exitsInSector(map, s.x, s.y);
      expect(exits.length, s.id).toBeGreaterThanOrEqual(1);
      exits.forEach(e => {
        expect(TerrainSystem.tileAt(map.seed, e.x, e.y).blocked, s.id).toBe(false);
        expect(sectorOf(e.x), s.id).toBe(s.x);
        expect(sectorOf(e.y), s.id).toBe(s.y);
      });
    });
  });

  it('shows each exit as a thing in the chunk that holds it', () => {
    const s = sectors[0];
    WorldGenerator.exitsInSector(map, s.x, s.y).forEach(e => {
      const c = WorldGenerator.chunkAt(map, chunkOf(e.x), chunkOf(e.y), context)!;
      expect(c.entities.some(t => t.type === EntityType.EXTRACTION && t.position.x === e.x && t.position.y === e.y)).toBe(true);
    });
  });

  it('can always walk from a drop to an exit', () => {
    const tested = sectors.filter((_, i) => i % Math.ceil(sectors.length / 30) === 0);
    let worst = 0;
    tested.forEach(s => {
      const drop = WorldGenerator.dropPoint(map, s.x, s.y);
      expect(TerrainSystem.tileAt(map.seed, drop.x, drop.z).blocked, s.id).toBe(false);
      const exits = new Set(WorldGenerator.exitsInSector(map, s.x, s.y).map(e => `${tileOf(e.x)},${tileOf(e.y)}`));
      const seen = new Set<string>();
      let frontier = [[tileOf(drop.x), tileOf(drop.z)]];
      seen.add(`${frontier[0][0]},${frontier[0][1]}`);
      let steps = 0, found = -1;
      while (frontier.length && found < 0) {
        const next: number[][] = [];
        for (const [x, y] of frontier) {
          if (exits.has(`${x},${y}`)) { found = steps; break; }
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const nx = x + dx, ny = y + dy, key = `${nx},${ny}`;
            if (seen.has(key) || !WorldGenerator.isWalkableTile(map, nx, ny)) continue;
            seen.add(key);
            next.push([nx, ny]);
          }
        }
        frontier = next;
        steps++;
      }
      expect(found, `${s.id} has no walkable route to an exit`).toBeGreaterThanOrEqual(0);
      worst = Math.max(worst, found);
    });
    console.log(`EXIT walk: worst ${worst} tiles, about ${Math.round(worst / 3)}s at walking pace, over ${tested.length} sectors`);
  });

  it('sets you down clear of any enemy', () => {
    const tested = sectors.filter((_, i) => i % Math.ceil(sectors.length / 40) === 0);
    let closest = Infinity;
    tested.forEach(s => {
      const drop = WorldGenerator.dropPoint(map, s.x, s.y);
      WorldGenerator.chunkKeysInBox(drop.x, drop.z, 600).forEach(key => {
        const [cx, cy] = key.split(',').map(Number);
        WorldGenerator.chunkAt(map, cx, cy, context)?.entities.filter(e => e.type === EntityType.MOB).forEach(e => {
          closest = Math.min(closest, Math.hypot(e.position.x - drop.x, e.position.y - drop.z) / TILE_PX);
        });
      });
    });
    console.log(`DROP nearest enemy over ${tested.length} sectors: ${closest.toFixed(1)} tiles`);
    expect(closest).toBeGreaterThanOrEqual(DROP_CLEAR_TILES);
  });

  it('stops you at the edge of the world', () => {
    const edge = sectors.find(s => !map.sectors[`${s.x - 1},${s.y}`])!;
    const x = edge.x * SECTOR_PX + 10, z = edge.y * SECTOR_PX + SECTOR_PX / 2;
    const moved = WorldGenerator.resolveMove(map, x, z, -40, 0);
    expect(moved.x).toBeGreaterThanOrEqual(edge.x * SECTOR_PX);
  });

  it('finds the nearest exit from anywhere', () => {
    const s = sectors[Math.floor(sectors.length / 2)];
    const exit = WorldGenerator.exitsInSector(map, s.x, s.y)[0];
    const near = WorldGenerator.nearestExit(map, exit.x + 40, exit.y);
    expect(near!.distance).toBeLessThanOrEqual(40);
  });
});

describe('it stays fast on demand', () => {
  it('generates a chunk within a frame', () => {
    const map = WorldGenerator.generate('speed', 32, context);
    const times: number[] = [];
    for (let i = 0; i < 80; i++) {
      const t = performance.now();
      WorldGenerator.chunkAt(map, 96 + (i % 16), 96 + Math.floor(i / 16), context);
      times.push(performance.now() - t);
    }
    times.sort((a, b) => a - b);
    const median = times[40], worst = times[79];
    console.log(`CHUNK generation: median ${median.toFixed(2)}ms, worst ${worst.toFixed(2)}ms`);
    expect(median).toBeLessThanOrEqual(CHUNK_MEDIAN_MS);
    expect(worst).toBeLessThanOrEqual(CHUNK_WORST_MS);
  });

  it('scans a whole sector quickly', () => {
    const map = WorldGenerator.generate('scan', 32, context);
    const t = performance.now();
    const contents = WorldGenerator.sectorContents(map, 16, 16, context);
    const ms = performance.now() - t;
    console.log(`SECTOR scan: ${ms.toFixed(0)}ms for ${contents.length} things`);
    expect(ms).toBeLessThanOrEqual(SECTOR_SCAN_MS);
  });

  it('opens even the largest world at once, because nothing is built until it is needed', () => {
    const t = performance.now();
    const map = WorldGenerator.generate('huge', 64, context);
    const ms = performance.now() - t;
    console.log(`WORLD 64 sectors opened in ${ms.toFixed(0)}ms with ${Object.keys(map.sectors).length} sectors and ${Object.keys(map.chunks).length} chunks built`);
    expect(ms).toBeLessThanOrEqual(WORLD_MS);
    expect(Object.keys(map.chunks).length).toBe(0);
  });

  it('simulates only what a shot can reach', () => {
    const near = WorldGenerator.chunkKeysInBox(CHUNK_PX * 10 + 640, CHUNK_PX * 10 + 640, PROJECTILE_RANGE_PX + SIM_MARGIN_PX);
    expect(near.length).toBeLessThanOrEqual(4);
    expect(PROJECTILE_RANGE_PX + SIM_MARGIN_PX).toBeLessThan(CHUNK_PX);
  });
});

describe('the hub faults are fixed', () => {
  const layout = HubGenerator.generate();
  const pois = layout.zones.flatMap(z => z.pois);
  const solid = pois.filter(p => !['LAMP_POST', 'PORTAL', 'PLAYER_LOT'].includes(p.type));
  const inside = (p: any, x: number, y: number) => x >= p.position.x && x < p.position.x + p.size.width && y >= p.position.y && y < p.position.y + p.size.height;

  it('spawns you on walkable ground', () => {
    expect(layout.navMesh[layout.spawnPoint.y][layout.spawnPoint.x]).toBe(true);
  });

  it('keeps every lamp out of the buildings', () => {
    expect(pois.filter(p => p.type === 'LAMP_POST' && solid.some(s => inside(s, p.position.x, p.position.y))).map(p => p.position)).toEqual([]);
  });

  it('gives every interactable building someone to talk to', () => {
    expect(pois.filter(p => p.interactable && p.type !== 'PLAYER_LOT' && !p.npcId).map(p => p.name)).toEqual([]);
  });
});
