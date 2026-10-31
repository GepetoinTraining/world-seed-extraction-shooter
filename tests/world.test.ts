import { describe, it, expect } from 'vitest';
import { WorldGenerator } from '../src/entities/world/WorldGenerator';
import { MOB_DEFINITIONS } from '../src/entities/mob/data/mobDefinitions';
import { RESOURCE_DEFINITIONS } from '../src/entities/item/data/resourceDefinitions';
import { GOLDEN_VECTORS, computeGolden, fingerprintMap } from '../src/entities/world/goldens';

const context = {
  mobDefinitions: Object.values(MOB_DEFINITIONS),
  resourceDefinitions: Object.values(RESOURCE_DEFINITIONS)
};

describe('world generation', () => {
  it('produces the same map from the same seed', () => {
    const open = () => {
      const map = WorldGenerator.generate('seed-a', 16, context);
      WorldGenerator.chunkAt(map, 64, 64, context);
      return map;
    };
    expect(fingerprintMap(open())).toBe(fingerprintMap(open()));
  });

  it('matches the pinned reference hashes', () => {
    for (const g of GOLDEN_VECTORS) {
      expect(computeGolden(g.seed, g.size), `${g.seed}/${g.size}`).toBe(g.hash);
    }
  });
});
