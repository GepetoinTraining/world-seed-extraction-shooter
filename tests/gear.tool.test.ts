/**
 * A TOOL IN THE HAND (GS5, the coordinator's call after Pedro's "the scaling seems off, check my gear please"). The bench
 * kit gives two work tools; a tool holds a third of a piece's power and a blow is a fifth of power, so a rank-F tool swung
 * dealt 3 a blow, under the 5 of the bare hand holding it. A tool swung never hits softer than that hand.
 */

import { describe, it, expect } from 'vitest';
import { UniversalRank } from '../shared/types';
import { installShippedThemes } from '../shared/logic/theme/boot';
import { ITEM_DEFINITIONS } from '../shared/entities/item/data/itemDefinitions';
import { ItemFactory } from '../shared/entities/item/ItemFactory';
import { PieceLaw } from '../shared/logic/theme/PieceLaw';
import { Rng } from '../shared/logic/rng/DeterministicRNG';
import { CombatMath } from '../src/entities/combat/CombatMath';

installShippedThemes();

describe('call 4: a tool swung never hits softer than the bare hand that holds it', () => {
  const toolBase = () => [...ITEM_DEFINITIONS.tool_bases].find(b => b.kind === 'work_tool' || b.tags.includes('tool'))!;
  it('a rank-F tool in a rank-F hand lands a bare hand\'s blow', () => {
    const tool = ItemFactory.createFromTemplate(toolBase(), true, Rng.fromKey('gs:tool:F'), undefined, UniversalRank.F, { quality: 0, depth: 0 });
    expect(PieceLaw.blowOf(tool.itemPower)).toBeLessThan(CombatMath.ownBlow(undefined, 'F'));
    expect(CombatMath.ownBlow(tool, 'F')).toBe(CombatMath.ownBlow(undefined, 'F'));
    expect(CombatMath.ownBlow(tool, 'C')).toBe(CombatMath.ownBlow(undefined, 'C'));
  });

  it('a tool above its holder keeps its own, larger blow; a weapon is untouched', () => {
    const tool = ItemFactory.createFromTemplate(toolBase(), true, Rng.fromKey('gs:tool:S'), undefined, UniversalRank.S, { quality: 0, depth: 0 });
    const own = Math.round(PieceLaw.blowOf(tool.itemPower) / Math.max(0.1, tool.stats.attack_speed || 1));
    expect(own).toBeGreaterThan(CombatMath.ownBlow(undefined, 'F'));
    expect(CombatMath.ownBlow(tool, 'F')).toBe(own);
    const blade = ItemFactory.createFromTemplate([...ITEM_DEFINITIONS.weapon_bases].find(b => b.kind === 'blade')!, true, Rng.fromKey('gs:blade'), undefined, UniversalRank.F, { quality: 0, depth: 0 });
    expect(CombatMath.ownBlow(blade, 'S')).toBe(Math.round(PieceLaw.blowOf(blade.itemPower) / blade.stats.attack_speed));
  });

  it('the card says what lands', () => {
    const tool = ItemFactory.createFromTemplate(toolBase(), true, Rng.fromKey('gs:tool:F'), undefined, UniversalRank.F, { quality: 0, depth: 0 });
    expect(CombatMath.damageSaid(tool, 'F')).toMatch(/^5 a blow/);
  });
});
