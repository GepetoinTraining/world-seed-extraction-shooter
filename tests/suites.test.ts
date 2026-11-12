/**
 * HOW THE SUITES RUN (the fight's rebalance, 2026-11-12). The grid's speed bars measure how long a chunk, a
 * sector scan and the largest world take; under a hundred files at once they measure the machine and not the
 * code (red at 19 to 24 ms against 16 in the full run, green alone at 11 ms). So, as the database files do, they
 * have a pass of their own, run alone, and their limits stay where they were registered.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const read = (p: string) => readFileSync(p, 'utf8');

describe('the speed bars run alone, with their limits as registered', () => {
  it('the test script keeps them out of the parallel run and runs them in a pass of their own', () => {
    const script: string = JSON.parse(read('package.json')).scripts.test;
    const passes = script.split('&&').map(p => p.trim());
    expect(passes[0]).toMatch(/--exclude "tests\/\{database,speed\}\*"/);
    expect(passes).toContain('vitest run tests/speed');
    expect(passes).toContain('vitest run tests/database');
  });

  it('the grid file holds no clock; the speed file holds the grid\'s clocks at their registered limits', () => {
    expect(read('tests/grid.test.ts')).not.toMatch(/performance\.now/);
    const speed = read('tests/speed.grid.test.ts');
    expect(speed).toMatch(/const CHUNK_MEDIAN_MS = 4;/);
    expect(speed).toMatch(/const CHUNK_WORST_MS = 16;/);
    expect(speed).toMatch(/const SECTOR_SCAN_MS = 500;/);
    expect(speed).toMatch(/const WORLD_MS = 60;/);
  });

  it('the notes say how to run each pass', () => {
    for (const note of ['README.md', 'HANDOVER.md']) expect(read(note), note).toMatch(/vitest run tests\/speed/);
  });
});
