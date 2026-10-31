import { describe, it, expect } from 'vitest';
import { TerrainSystem, TerrainType } from '../src/entities/world/TerrainSystem';
import { InteractionEngine } from '../src/entities/interaction/InteractionEngine';
import { InteractionType, IPlayer } from '../types';
import { EntityType, IWorldEntity } from '../src/entities/world/types';
import { InventorySystem } from '../src/entities/player/systems/InventorySystem';

const SEED = 'terrain-test';
const T = 20;

const findTile = (type: TerrainType, east?: TerrainType) => {
  for (let tx = 0; tx < 400; tx++) {
    for (let tz = 0; tz < 400; tz++) {
      const x = tx * T + 10, z = tz * T + 10;
      if (TerrainSystem.tileAt(SEED, x, z).type !== type) continue;
      if (east && TerrainSystem.tileAt(SEED, x + T, z).type !== east) continue;
      return { x, z };
    }
  }
  throw new Error(`no ${type} tile found`);
};

describe('terrain', () => {
  it('refuses a step into water', () => {
    const { x, z } = findTile(TerrainType.GROUND, TerrainType.WATER);
    expect(TerrainSystem.resolveMove(SEED, x, z, T, 0).x).toBe(x);
  });

  it('halves speed in mud', () => {
    const { x, z } = findTile(TerrainType.MUD);
    expect(TerrainSystem.resolveMove(SEED, x, z, 2, 0).speedMod).toBe(0.5);
  });

  it('never traps someone already standing on a blocked tile', () => {
    const { x, z } = findTile(TerrainType.WATER);
    expect(TerrainSystem.resolveMove(SEED, x, z, 5, 0).x).toBe(x + 5);
  });
});

describe('harvest gating', () => {
  const player = (inventory: any[]): IPlayer =>
    ({ attributes: { intelligence: 1 }, currentSession: { inventory } } as unknown as IPlayer);
  const node = (definitionId: string): IWorldEntity =>
    ({ id: 'n', type: EntityType.RESOURCE, definitionId, position: { x: 0, y: 0 }, usesRemaining: 1 } as IWorldEntity);
  const harvests = (p: IPlayer, id: string) =>
    InteractionEngine.getAvailableInteractions(p, node(id), 1).filter(o => o.type === InteractionType.HARVEST);

  const pick = { name: 'Rusty Pick', tags: ['tool', 'pickaxe'], stats: { mining_power: 15 } };
  const axe = { name: 'Field Axe', tags: ['tool', 'axe'], stats: { chopping_power: 15 } };

  it('allows soft resources by hand', () => {
    expect(harvests(player([]), 'res_berry_bush')).toHaveLength(1);
  });

  it('refuses a rock without a pick and with the wrong tool', () => {
    expect(harvests(player([]), 'res_rock_small')).toHaveLength(0);
    expect(harvests(player([axe]), 'res_rock_small')).toHaveLength(0);
  });

  it('allows a rock with a pick', () => {
    expect(harvests(player([pick]), 'res_rock_small')).toHaveLength(1);
  });

  it('refuses a tool that is too weak', () => {
    const weak = { ...pick, stats: { mining_power: 1 } };
    expect(harvests(player([weak]), 'res_rock_small')).toHaveLength(0);
  });
});

describe('pack geometry', () => {
  it('passes its invariants', () => {
    expect(InventorySystem.selfTest()).toEqual([]);
  });
});
