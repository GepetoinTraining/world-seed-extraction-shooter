import { describe, it, expect } from 'vitest';
import { WorldGenerator } from '../src/entities/world/WorldGenerator';
import { MOB_DEFINITIONS } from '../src/entities/mob/data/mobDefinitions';
import { RESOURCE_DEFINITIONS } from '../src/entities/item/data/resourceDefinitions';
import { GOLDEN_VECTORS, computeGolden, fingerprintMap } from '../src/entities/world/goldens';
import { EntityType } from '../src/entities/world/types';
import { UniversalRank } from '../types';

const context = {
  mobDefinitions: Object.values(MOB_DEFINITIONS),
  resourceDefinitions: Object.values(RESOURCE_DEFINITIONS)
};

describe('world generation', () => {
  it('produces the same map from the same seed', () => {
    const a = WorldGenerator.generate('seed-a', 16, context);
    const b = WorldGenerator.generate('seed-a', 16, context);
    expect(fingerprintMap(a)).toBe(fingerprintMap(b));
  });

  it('does not depend on the order definitions were loaded in', () => {
    const reversed = {
      mobDefinitions: [...context.mobDefinitions].reverse(),
      resourceDefinitions: [...context.resourceDefinitions].reverse()
    };
    const a = WorldGenerator.generate('seed-a', 16, context);
    const b = WorldGenerator.generate('seed-a', 16, reversed);
    expect(fingerprintMap(a)).toBe(fingerprintMap(b));
  });

  it('never places an enemy above its chunk rank unless the genre has nothing lower', () => {
    const order = Object.values(UniversalRank);
    const map = WorldGenerator.generate('seed-a', 32, context);
    for (const chunk of Object.values(map.chunks)) {
      for (const e of chunk.entities.filter(x => x.type === EntityType.MOB)) {
        const def: any = MOB_DEFINITIONS[e.definitionId];
        const isBoss = (def.tags || []).some((t: string) => ['boss', 'god', 'titan'].includes(t));
        if (isBoss) {
          expect(order.indexOf(def.rank), `${e.definitionId} in ${chunk.id} (${chunk.difficulty})`)
            .toBeLessThanOrEqual(order.indexOf(chunk.difficulty));
        }
      }
    }
  });

  it('matches the pinned reference hashes', () => {
    for (const g of GOLDEN_VECTORS) {
      expect(computeGolden(g.seed, g.size), `${g.seed}/${g.size}`).toBe(g.hash);
    }
  });
});
