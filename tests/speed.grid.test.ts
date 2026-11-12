/**
 * THE GRID'S SPEED BARS, run alone (`npm test`, its second pass; `npx vitest run tests/speed`). They time a chunk, a
 * sector's scan and the largest world, and under a hundred files at once they time the machine instead: moved
 * here from tests/grid.test.ts on 2026-11-12 with their limits as they were registered. Do not lower them to get a pass.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { WorldGenerator } from '../shared/entities/world/WorldGenerator';
import { MOB_DEFINITIONS } from '../shared/entities/mob/data/mobDefinitions';
import { RESOURCE_DEFINITIONS } from '../shared/entities/item/data/resourceDefinitions';

const CHUNK_MEDIAN_MS = 4;
const CHUNK_WORST_MS = 16;
const SECTOR_SCAN_MS = 500;
const WORLD_MS = 60;

const context = { mobDefinitions: Object.values(MOB_DEFINITIONS), resourceDefinitions: Object.values(RESOURCE_DEFINITIONS) } as any;

describe('it stays fast on demand', () => {
  // In tests/grid.test.ts these ran after the grid's other bars had worked the generator. Alone, a cold start's
  // first chunks are the engine compiling, not the code being slow: the same work, untimed, comes first.
  beforeAll(() => {
    const warm = WorldGenerator.generate('warm', 32, context);
    for (let i = 0; i < 160; i++) WorldGenerator.chunkAt(warm, 32 + (i % 16), 32 + Math.floor(i / 16), context);
    WorldGenerator.sectorContents(warm, 8, 8, context);
  });

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
});
