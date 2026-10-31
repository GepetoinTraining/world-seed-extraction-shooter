import { describe, it, expect } from 'vitest';
import { TerrainSystem, TerrainType } from '../src/entities/world/TerrainSystem';
import { InteractionEngine } from '../src/entities/interaction/InteractionEngine';
import { InteractionType, IPlayer } from '../types';
import { EntityType, IWorldEntity } from '../src/entities/world/types';
import { InventorySystem } from '../src/entities/player/systems/InventorySystem';
import { ItemFactory } from '../src/entities/item/ItemFactory';
import { ITEM_DEFINITIONS } from '../src/entities/item/data/itemDefinitions';
import { RESOURCE_DEFINITIONS } from '../src/entities/item/data/resourceDefinitions';
import { Rng } from '../src/logic/rng/DeterministicRNG';
import { useHubStore } from '../src/entities/hub/store';
import { usePlayerStore } from '../src/entities/player/store';
import { PlayerPersistence } from '../src/logic/persistence/PlayerPersistence';

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
    const { x, z } = findTile(TerrainType.MUD, TerrainType.WATER);
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

describe('titanium', () => {
  const player = (inventory: any[]): IPlayer =>
    ({ attributes: { intelligence: 1 }, currentSession: { inventory } } as unknown as IPlayer);
  const node = { id: 'n', type: EntityType.RESOURCE, definitionId: 'res_titanium_vein', position: { x: 0, y: 0 }, usesRemaining: 1 } as IWorldEntity;
  const canHarvest = (item: any) =>
    InteractionEngine.getAvailableInteractions(player([item]), node, 1).some(o => o.type === InteractionType.HARVEST);
  const rolls = (baseId: string) => Array.from({ length: 300 }, (_, i) =>
    ItemFactory.createItem(undefined, true, Rng.fromKey(`titanium:${baseId}:${i}`), 'tool', baseId));

  it('stays out of reach of the Rusty Pick', () => {
    expect(rolls('tool_pick_rusty_t1').some(canHarvest)).toBe(false);
  });

  it('yields to the Tempered Pick at every quality', () => {
    const picks = rolls('tool_pick_tempered_t3');
    expect(picks.every(canHarvest)).toBe(true);
    const base = ITEM_DEFINITIONS.tool_bases.find(t => t.id === 'tool_pick_tempered_t3')!;
    expect(base.implicits[0].min! * 0.8).toBeGreaterThanOrEqual(RESOURCE_DEFINITIONS['res_titanium_vein'].harvestConfig!.minToolPower);
  });

  it('does not take over the gear pool of its rank', () => {
    const base = ITEM_DEFINITIONS.tool_bases.find(t => t.id === 'tool_pick_tempered_t3')!;
    const all = [...ITEM_DEFINITIONS.weapon_bases, ...ITEM_DEFINITIONS.armor_bases, ...ITEM_DEFINITIONS.tool_bases];
    expect(all.filter(b => b.rank === base.rank).length).toBeGreaterThanOrEqual(3);
  });

  it('is sold in the hub, with the two starter tools still on the shelf', () => {
    useHubStore.getState().generateDailyStock();
    const defs = useHubStore.getState().weaponShop.map(l => l.item.universalDefinitionId);
    expect(defs).toEqual(expect.arrayContaining(['tool_axe_field_t1', 'tool_pick_rusty_t1', 'tool_pick_tempered_t3']));
    const listing = useHubStore.getState().weaponShop.find(l => l.item.universalDefinitionId === 'tool_pick_tempered_t3')!;
    expect(listing.stock).toBeGreaterThan(0);
    console.log(`TEMPERED PICK today: ${listing.item.name}, ${Math.ceil(listing.price)}G, power ${listing.item.stats.mining_power}`);
  });
});

describe('the avatar', () => {
  it('keeps its archetype, in the save as well as in play', () => {
    const certificate = { metadata: { uid: 'ws_test_arch', displayName: 'Test' } } as any;
    usePlayerStore.getState().initializeSession(certificate, 'ARCANIST');
    const player = usePlayerStore.getState().player;
    expect(player.archetype).toBe('ARCANIST');
    expect(JSON.parse(PlayerPersistence.persistableJson(player)).archetype).toBe('ARCANIST');
  });
});

describe('pack geometry', () => {
  it('passes its invariants', () => {
    expect(InventorySystem.selfTest()).toEqual([]);
  });
});
