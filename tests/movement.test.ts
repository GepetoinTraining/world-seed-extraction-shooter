/**
 * MOVEMENT SPEED IS A STAT. Registered before the build. A base pace, scaled by
 * what you wear, then by load, tow and ground as before: boots make you faster.
 */
import { SHELF } from '../src/logic/theme/shelf';
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { LoadoutSystem, BASE_WALK_TILES_PER_S } from '../src/entities/player/systems/LoadoutSystem';

const ROOT = resolve(__dirname, '..');
const worn = (...stats: Record<string, number>[]) => {
  const equipment = LoadoutSystem.emptyEquipment();
  stats.forEach((s, i) => {
    const item = { id: `i${i}`, stats: s, tags: [] } as any;
    equipment.items.push(item);
    (equipment.slots as any)[`RING_${i + 1}`] = item.id;
  });
  return equipment;
};

describe('movement speed', () => {
  it('walks at the base pace in nothing, and with no equipment at all', () => {
    expect(LoadoutSystem.walkTilesPerSecond(LoadoutSystem.emptyEquipment())).toBe(BASE_WALK_TILES_PER_S);
    expect(LoadoutSystem.walkTilesPerSecond(undefined)).toBe(BASE_WALK_TILES_PER_S);
  });

  it('scales with what is worn, and pieces add up', () => {
    expect(LoadoutSystem.walkTilesPerSecond(worn({ movement_speed: 0.1 }))).toBeCloseTo(BASE_WALK_TILES_PER_S * 1.1);
    expect(LoadoutSystem.walkTilesPerSecond(worn({ movement_speed: 0.1 }, { movement_speed: 0.25 })))
      .toBeCloseTo(BASE_WALK_TILES_PER_S * 1.35);
  });

  it('has no ceiling: a huge roll is a huge pace', () => {
    expect(LoadoutSystem.walkTilesPerSecond(worn({ movement_speed: 9 }))).toBeCloseTo(BASE_WALK_TILES_PER_S * 10);
  });

  it('takes penalties, and can never stop you or turn you around', () => {
    expect(LoadoutSystem.walkTilesPerSecond(worn({ movement_speed_penalty: -0.05 })))
      .toBeCloseTo(BASE_WALK_TILES_PER_S * 0.95);
    expect(LoadoutSystem.walkTilesPerSecond(worn({ movement_speed: -50 }))).toBeGreaterThan(0);
  });

  it('stops counting a broken piece, as broken gear does everywhere', () => {
    expect(LoadoutSystem.walkTilesPerSecond(worn({ movement_speed: 0.5, durability: 0, maxDurability: 100 })))
      .toBe(BASE_WALK_TILES_PER_S);
  });

  it('counts only what is in a slot, not what a pouch holds', () => {
    const equipment = worn({ movement_speed: 0.5 });
    equipment.slots = {} as any;
    expect(LoadoutSystem.walkTilesPerSecond(equipment)).toBe(BASE_WALK_TILES_PER_S);
  });

  it('keeps boots on the armorer\'s shelf, every day', () => {
    // D53: the shelf is filled by what a theme holds, and the theme law requires boots
    expect(SHELF.wardrobe).toContain('arm_boots_generic_t1');
    expect(readFileSync(join(ROOT, 'src/entities/hub/store.ts'), 'utf8')).toMatch(/SHELF\.wardrobe/);
    expect(readFileSync(join(ROOT, 'src/logic/theme/ThemeLaw.ts'), 'utf8')).toMatch(/kind === 'feet'/);
  });

  it('is one pace, read by the field and by the city', () => {
    for (const file of ['src/components/WorldCanvas.tsx', 'src/entities/hub/HubCanvas.tsx']) {
      const source = readFileSync(join(ROOT, file), 'utf8');
      expect(source, file).toContain('walkTilesPerSecond');
      expect(source, file).not.toMatch(/const (PLAYER_SPEED|HUB_WALK_TILES_PER_S) =/);
    }
  });
});
