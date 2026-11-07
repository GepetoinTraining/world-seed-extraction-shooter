import { describe, it, expect, vi } from 'vitest';
import { MOB_DEFINITIONS } from '../shared/entities/mob/data/mobDefinitions';
import { RESOURCE_DEFINITIONS } from '../shared/entities/item/data/resourceDefinitions';
import { MobBehavior } from '../shared/entities/mob/types';
import { MobAI } from '../src/entities/mob/ai/MobAI';
import { TerrainSystem, TerrainType } from '../shared/entities/world/TerrainSystem';
import { WorldGenerator } from '../shared/entities/world/WorldGenerator';
import { EntityType, IChunk } from '../shared/entities/world/types';
import { TILE_PX, chunkOf, tileCenter, tileOf } from '../shared/entities/world/grid';
import {
  ATOM_PX, CreatureFacing, RADIAL_PLANS, Role, STEPS, Sprite, buildPalette, creature, exitBeacon, grayscale,
  hashBytes, maskDifference, maskOf, planFor, px, resource, treeSprite, worldForm
} from '../shared/render/atoms/atoms';
import { GENRES, STATIC_CONTEXT, baselinePx, entitySprite, isStandingTree, openGround, proofView, standsUpright, terrainBuffer } from '../src/render/atoms/world';
import { ARCHETYPE_IDS, WALK_PHASES, figure, portrait } from '../shared/render/atoms/people';

// Bars registered before the motion existed. Do not lower them to get a pass.
const CATEGORY_MIN_DIFFERENCE = 0.25;  // every frame and facing, not just frame 0
const PLAYER_STEP_MAX = 0.3;           // a walk frame changes only the moving parts
const CREATURE_STEP_MAX = 0.4;         // a wing may sweep, a body may not teleport
const WATER_MIN_DIFFERENCE = 0.25;     // same law as mud: gameplay terrain must read
const SPRITE_MEMORY_MAX_BYTES = 512 * 1024; // every creature, all facings and frames
const PORTRAIT_MIN_CLOSEST = 0.12;     // raised from 0.10: the faces grew features
const MIN_CONTRAST = 3;
const GRAY_STEP = 8;
const CHASE_TICKS = 2400;              // ~80 simulated seconds of pursuit

const FACINGS: CreatureFacing[] = ['down', 'up', 'left', 'right'];
const creatures = Object.values(MOB_DEFINITIONS) as any[];
const resources = Object.values(RESOURCE_DEFINITIONS) as any[];
const pairs = <T,>(list: T[]) => list.flatMap((a, i) => list.slice(i + 1).map(b => [a, b] as [T, T]));

/** Two sprites on one centered canvas, so different footprints compare fairly. */
function padMask(s: Sprite, w: number, h: number): Uint8Array {
  const mask = maskOf(s);
  const out = new Uint8Array(w * h);
  const x0 = (w - s.w) >> 1, y0 = (h - s.h) >> 1;
  for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) {
    const dx = x0 + x, dy = y0 + y;
    if (dx >= 0 && dy >= 0 && dx < w && dy < h) out[dy * w + dx] = mask[y * s.w + x];
  }
  return out;
}

const paddedDifference = (a: Sprite, b: Sprite) => {
  const w = Math.max(a.w, b.w), h = Math.max(a.h, b.h);
  return maskDifference(padMask(a, w, h), padMask(b, w, h));
};

describe('the player walk', () => {
  const uid = 'ws_69e30a63_mvvj0dil_f4304a85';

  it('stands in one defined frame whatever step it stopped on', () => {
    ARCHETYPE_IDS.forEach(archetype => (['down', 'up', 'left', 'right'] as const).forEach(facing => {
      const stand = hashBytes(figure({ uid, archetype, facing, moving: false }).data);
      [0, 1, 2, 3].forEach(step => {
        expect(hashBytes(figure({ uid, archetype, facing, step, moving: false }).data), `${archetype} ${facing} step ${step}`).toBe(stand);
      });
      expect(hashBytes(figure({ uid, archetype, facing }).data), `${archetype} ${facing} default`).toBe(stand);
    }));
  });

  ([2, 4] as const).forEach(phases => {
    it(`cycles ${phases} distinct frames, none of them the standing frame`, () => {
      ARCHETYPE_IDS.forEach(archetype => (['down', 'right'] as const).forEach(facing => {
        const stand = figure({ uid, archetype, facing, moving: false, phases });
        const steps = Array.from({ length: phases }, (_, i) => figure({ uid, archetype, facing, step: i, moving: true, phases }));
        const hashes = new Set([stand, ...steps].map(s => hashBytes(s.data)));
        expect(hashes.size, `${archetype} ${facing} x${phases}`).toBe(phases + 1);
        steps.forEach((s, i) => {
          const d = maskDifference(maskOf(stand), maskOf(s));
          expect(d, `${archetype} ${facing} phase ${i}`).toBeGreaterThan(0);
          expect(d, `${archetype} ${facing} phase ${i}`).toBeLessThanOrEqual(PLAYER_STEP_MAX);
        });
      }));
    });
  });

  it('mirrors left from right on every phase', () => {
    for (let step = 0; step < WALK_PHASES; step++) {
      const right = figure({ uid, archetype: 'OPERATOR', facing: 'right', step, moving: true });
      const left = figure({ uid, archetype: 'OPERATOR', facing: 'left', step, moving: true });
      const mirrored = new Uint8Array(right.data.length);
      for (let y = 0; y < right.h; y++) for (let x = 0; x < right.w; x++) {
        mirrored[y * right.w + x] = right.data[y * right.w + (right.w - 1 - x)];
      }
      expect(hashBytes(mirrored), `phase ${step}`).toBe(hashBytes(left.data));
    }
  });
});

describe('creature facings and frames', () => {
  it('is the same bytes from the same pose', () => {
    creatures.forEach(c => {
      expect(hashBytes(creature(c, undefined, { facing: 'right', frame: 1 }).data))
        .toBe(hashBytes(creature(c, undefined, { facing: 'right', frame: 1 }).data));
    });
  });

  it('faces four distinct ways, except bodies with no front', () => {
    creatures.forEach(c => {
      const radial = RADIAL_PLANS.includes(planFor(c.tags));
      const hashes = new Set(FACINGS.map(f => hashBytes(creature(c, undefined, { facing: f }).data)));
      if (radial) expect(hashes.size, c.id).toBe(1);
      else expect(hashes.size, c.id).toBe(4);
    });
  });

  it('mirrors left from right', () => {
    creatures.filter(c => !RADIAL_PLANS.includes(planFor(c.tags))).forEach(c => {
      const right = creature(c, undefined, { facing: 'right' });
      const left = creature(c, undefined, { facing: 'left' });
      const mirrored = new Uint8Array(right.data.length);
      for (let y = 0; y < right.h; y++) for (let x = 0; x < right.w; x++) {
        mirrored[y * right.w + x] = right.data[y * right.w + (right.w - 1 - x)];
      }
      expect(hashBytes(mirrored), c.id).toBe(hashBytes(left.data));
    });
  });

  it('steps on two frames that move only what that body would move', () => {
    creatures.forEach(c => FACINGS.forEach(facing => {
      const a = creature(c, undefined, { facing, frame: 0 });
      const b = creature(c, undefined, { facing, frame: 1 });
      expect(hashBytes(a.data), `${c.id} ${facing}`).not.toBe(hashBytes(b.data));
      const d = maskDifference(maskOf(a), maskOf(b));
      expect(d, `${c.id} ${facing}`).toBeLessThanOrEqual(CREATURE_STEP_MAX);
    }));
  });

  it('never lets any frame or facing be mistaken for a resource or the exit', () => {
    const size = 12;
    const things = resources.map(r => ({ id: r.id, sprite: resource(r, size) }));
    const beacon = exitBeacon();
    creatures.forEach(c => FACINGS.forEach(facing => [0, 1].forEach(frame => {
      const t = creature(c, size, { facing, frame });
      things.forEach(r => {
        expect(paddedDifference(t, r.sprite), `${c.id} ${facing} f${frame} vs ${r.id}`).toBeGreaterThanOrEqual(CATEGORY_MIN_DIFFERENCE);
      });
      expect(paddedDifference(creature(c, beacon.w - 2, { facing, frame }), beacon), `${c.id} ${facing} f${frame} vs exit`)
        .toBeGreaterThanOrEqual(CATEGORY_MIN_DIFFERENCE);
    })));
  });

  it('keeps every creature, all facings and frames, under the memory bound', () => {
    let bytes = 0;
    creatures.forEach(c => FACINGS.forEach(facing => [0, 1].forEach(frame => {
      const s = creature(c, undefined, { facing, frame });
      bytes += s.data.length;
    })));
    console.log(`SPRITE MEMORY: ${(bytes / 1024).toFixed(0)}KB for ${creatures.length} creatures x 4 facings x 2 frames`);
    expect(bytes).toBeLessThanOrEqual(SPRITE_MEMORY_MAX_BYTES);
  });

  it('renders still, facing front, when no pose is given (reduced motion holds)', () => {
    creatures.forEach(c => {
      const e = { id: 'x', type: EntityType.MOB, definitionId: c.id } as any;
      expect(hashBytes(entitySprite(e)!.data), c.id).toBe(hashBytes(creature(c, undefined, { facing: 'down', frame: 0 }).data));
    });
  });
});

describe('the tree stands upright', () => {
  const tree = RESOURCE_DEFINITIONS['res_tree_log'] as any;
  const inRole = (v: number, role: Role) => v >= px(role, 0) && v <= px(role, STEPS - 1);

  it('is taller than wide, with a crown in life and a trunk in matter', () => {
    const s = treeSprite(tree, 3, 3);
    expect(s.h).toBeGreaterThan(s.w);
    const values = [...s.data];
    expect(values.some(v => inRole(v, Role.LIFE))).toBe(true);
    expect(values.some(v => inRole(v, Role.MATTER))).toBe(true);
  });

  it('keeps no crown on the stump, and the stump neither stands nor blocks', () => {
    const stump = treeSprite(tree, 0, 3);
    expect([...stump.data].some(v => inRole(v, Role.LIFE))).toBe(false);
    const standing = { id: 't', type: EntityType.RESOURCE, definitionId: 'res_tree_log', usesRemaining: 3 } as any;
    const felled = { ...standing, usesRemaining: 0 };
    expect(isStandingTree(standing)).toBe(true);
    expect(isStandingTree(felled)).toBe(false);
    expect(standsUpright(standing)).toBe(true);
  });

  it('roots its feet on its tile, crown hanging above', () => {
    const e = { id: 't', type: EntityType.RESOURCE, definitionId: 'res_tree_log', usesRemaining: 3 } as any;
    const s = entitySprite(e)!;
    expect(baselinePx(e, s)).toBe(TILE_PX / 2);
    // The crown rises more than a tile above the trunk's own tile
    expect(s.h * ATOM_PX - TILE_PX).toBeGreaterThan(TILE_PX);
  });

  it('blocks its trunk tile while it stands, and stops blocking when felled', () => {
    const { map } = proofView();
    let found: any = null;
    search: for (let cy = 120; cy < 140; cy++) for (let cx = 120; cx < 140; cx++) {
      const chunk = WorldGenerator.chunkAt(map, cx, cy, STATIC_CONTEXT);
      const t = chunk?.entities.find(e => e.definitionId === 'res_tree_log' && (e.usesRemaining ?? 3) > 0);
      if (t) { found = t; break search; }
    }
    expect(found, 'a standing tree exists').toBeTruthy();
    expect(WorldGenerator.trunkAt(map, found.position.x, found.position.y)).toBe(true);
    // Walking into the trunk is refused; the walker slides and is never trapped
    const fromX = found.position.x - TILE_PX, fromZ = found.position.y;
    if (!TerrainSystem.isBlockedTile(map.seed, tileOf(fromX), tileOf(fromZ))) {
      const next = WorldGenerator.resolveMove(map, fromX, fromZ, TILE_PX, 0);
      expect(tileOf(next.x) === tileOf(found.position.x) && tileOf(next.z) === tileOf(found.position.y)).toBe(false);
    }
    const uses = found.usesRemaining;
    found.usesRemaining = 0;
    expect(WorldGenerator.trunkAt(map, found.position.x, found.position.y)).toBe(false);
    found.usesRemaining = uses;
  });

  it('found by playing: a body standing on a trunk tile can still walk off it', () => {
    // A drop's spot reads the ground only, so a person can land on a tree's own tile.
    const { map } = proofView();
    let found: any = null;
    search: for (let cy = 120; cy < 140; cy++) for (let cx = 120; cx < 140; cx++) {
      const chunk = WorldGenerator.chunkAt(map, cx, cy, STATIC_CONTEXT);
      const t = chunk?.entities.find(e => e.definitionId === 'res_tree_log' && (e.usesRemaining ?? 3) > 0);
      if (t) { found = t; break search; }
    }
    expect(found, 'a standing tree exists').toBeTruthy();
    const x = found.position.x, z = found.position.y;
    const ways = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([sx, sz]) => {
      let at = { x, z };
      for (let i = 0; i < 20; i++) at = WorldGenerator.resolveMove(map, at.x, at.z, sx * 4, sz * 4);
      return tileOf(at.x) !== tileOf(x) || tileOf(at.z) !== tileOf(z);
    });
    expect(ways.some(Boolean), 'some way off the trunk tile').toBe(true);
  });
});

describe('enemies against the world', () => {
  const mobAt = (def: any, x: number, y: number, id: string): any => ({
    id, type: EntityType.MOB, definitionId: def.id, position: { x, y },
    health: def.baseHealth, rank: def.rank, rarity: 'COMMON', isHostile: true
  });
  const chunkWith = (mobs: any[]): Record<string, IChunk> => ({
    '0,0': { id: 'c', x: 0, y: 0, biome: 'WASTELAND', entities: mobs } as any
  });
  const defOf = (behavior: MobBehavior) => creatures.find(c => c.behavior === behavior)!;

  it('holds its ground as a turret: it shoots, it does not chase', () => {
    MobAI.reset();
    const def = defOf(MobBehavior.TURRET);
    let chunks = chunkWith([mobAt(def, 0, 0, 'turret1')]);
    const player = { x: 6 * TILE_PX, y: 0 };
    let patterns = 0;
    // A blow winds up on the clock now (R4), so the clock has to run
    vi.useFakeTimers();
    for (let i = 0; i < 200; i++) {
      vi.advanceTimersByTime(50);
      const out = MobAI.tick(chunks, player, 0.05);
      patterns += out.spawnedPatterns.length;
      chunks = { ...chunks, ...out.updatedChunks };
    }
    vi.useRealTimers();
    const mob = chunks['0,0'].entities[0];
    expect(mob.position.x).toBe(0);
    expect(mob.position.y).toBe(0);
    expect(patterns).toBeGreaterThan(0);
  });

  it('surrounds as a swarm: eight of them do not stack on one side', () => {
    MobAI.reset();
    const def = defOf(MobBehavior.SWARM);
    const mobs = Array.from({ length: 8 }, (_, i) => mobAt(def, i * 4, -6 * TILE_PX, `swarm_${i}`));
    let chunks = chunkWith(mobs);
    const player = { x: 0, y: 0 };
    for (let i = 0; i < 600; i++) {
      const out = MobAI.tick(chunks, player, 0.05);
      chunks = { ...chunks, ...out.updatedChunks };
    }
    const quadrants = new Set(chunks['0,0'].entities.map(m => {
      const a = Math.atan2(m.position.y - player.y, m.position.x - player.x);
      return Math.floor(((a + Math.PI) / (Math.PI * 2)) * 4) % 4;
    }));
    chunks['0,0'].entities.forEach(m => {
      expect(Math.hypot(m.position.x, m.position.y), m.id).toBeLessThanOrEqual(3 * TILE_PX);
    });
    console.log(`SWARM holds ${quadrants.size} quadrants around the player`);
    expect(quadrants.size).toBeGreaterThanOrEqual(3);
  });

  it('plods as a siege: straight at you, never away', () => {
    MobAI.reset();
    const def = defOf(MobBehavior.SIEGE);
    let chunks = chunkWith([mobAt(def, 0, -10 * TILE_PX, 'siege1')]);
    const player = { x: 0, y: 0 };
    const start = 10 * TILE_PX;
    for (let i = 0; i < 100; i++) {
      const out = MobAI.tick(chunks, player, 0.05);
      chunks = { ...chunks, ...out.updatedChunks };
    }
    const mob = chunks['0,0'].entities[0];
    const dist = Math.hypot(mob.position.x, mob.position.y);
    expect(dist).toBeLessThan(start);
  });

  it('ignores you when passive — until hurt, and then it leaves', () => {
    MobAI.reset();
    const def = defOf(MobBehavior.PASSIVE);
    let chunks = chunkWith([mobAt(def, 0, -5 * TILE_PX, 'passive1')]);
    const player = { x: 0, y: 0 };
    let patterns = 0;
    for (let i = 0; i < 100; i++) {
      const out = MobAI.tick(chunks, player, 0.05);
      patterns += out.spawnedPatterns.length;
      chunks = { ...chunks, ...out.updatedChunks };
    }
    let mob = chunks['0,0'].entities[0];
    expect(mob.position.y).toBe(-5 * TILE_PX);
    expect(patterns).toBe(0);
    MobAI.provoke('passive1');
    for (let i = 0; i < 100; i++) {
      const out = MobAI.tick(chunks, player, 0.05);
      patterns += out.spawnedPatterns.length;
      chunks = { ...chunks, ...out.updatedChunks };
    }
    mob = chunks['0,0'].entities[0];
    // It leaves at its own speed — and the game's one passive thing has speed 0:
    // "It is everywhere." Provoked, it still never attacks, and never closes in.
    expect(patterns).toBe(0);
    const dist = Math.hypot(mob.position.x, mob.position.y);
    if ((def.speed ?? 0) > 0) expect(dist).toBeGreaterThan(5 * TILE_PX);
    else expect(dist).toBe(5 * TILE_PX);
  });

  it('stays neutral at a distance, and answers when provoked', () => {
    MobAI.reset();
    const def = defOf(MobBehavior.NEUTRAL);
    let chunks = chunkWith([mobAt(def, 0, -5 * TILE_PX, 'neutral1')]);
    const player = { x: 0, y: 0 };
    for (let i = 0; i < 100; i++) {
      const out = MobAI.tick(chunks, player, 0.05);
      chunks = { ...chunks, ...out.updatedChunks };
    }
    expect(chunks['0,0'].entities[0].position.y).toBe(-5 * TILE_PX);
    MobAI.provoke('neutral1');
    for (let i = 0; i < 60; i++) {
      const out = MobAI.tick(chunks, player, 0.05);
      chunks = { ...chunks, ...out.updatedChunks };
    }
    expect(Math.hypot(chunks['0,0'].entities[0].position.x, chunks['0,0'].entities[0].position.y)).toBeLessThan(5 * TILE_PX);
  });

  it('never ends a tick on water, rock or a trunk across a long chase', () => {
    MobAI.reset();
    const { map } = proofView();
    // Find a lake with ground around it, somewhere near the world's middle
    let lake: { x: number; y: number } | null = null;
    const center = 16.5 * 512;
    search: for (let ty = center - 400; ty < center + 400; ty += 4) {
      for (let tx = center - 400; tx < center + 400; tx += 4) {
        if (TerrainSystem.typeAt(map.seed, tx, ty) !== TerrainType.WATER) continue;
        if (TerrainSystem.typeAt(map.seed, tx + 3, ty) === TerrainType.WATER && TerrainSystem.typeAt(map.seed, tx - 3, ty) !== TerrainType.WATER) {
          lake = { x: tx, y: ty };
          break search;
        }
      }
    }
    expect(lake, 'a shoreline exists to chase around').toBeTruthy();
    const lakePx = { x: tileCenter(lake!.x), y: tileCenter(lake!.y) };
    WorldGenerator.loadAround(map, lakePx.x, lakePx.y, 700, STATIC_CONTEXT);

    const spotAt = (dx: number, dy: number) => {
      const p = TerrainSystem.nearestWalkable(map.seed, lakePx.x + dx, lakePx.y + dy, 14);
      return { x: p.x, y: p.z };
    };
    const def = creatures.find(c => c.behavior === MobBehavior.AGGRESSIVE)!;
    const start = spotAt(-7 * TILE_PX, 0);
    let mob = mobAt(def, start.x, start.y, 'chaser1');
    const waypoints = [spotAt(7 * TILE_PX, 0), spotAt(0, 7 * TILE_PX), spotAt(-9 * TILE_PX, 3 * TILE_PX), spotAt(0, -7 * TILE_PX)];

    let violations = 0;
    for (let i = 0; i < CHASE_TICKS; i++) {
      const player = waypoints[Math.floor(i / (CHASE_TICKS / 4)) % waypoints.length];
      const key = `${chunkOf(mob.position.x)},${chunkOf(mob.position.y)}`;
      const chunks: Record<string, IChunk> = { [key]: { id: key, x: chunkOf(mob.position.x), y: chunkOf(mob.position.y), biome: 'WASTELAND', entities: [mob] } as any };
      const out = MobAI.tick(chunks, player, 0.033, map);
      const updated = out.updatedChunks[key];
      if (updated) mob = updated.entities.find(e => e.id === 'chaser1')!;
      const tx = tileOf(mob.position.x), ty = tileOf(mob.position.y);
      if (TerrainSystem.isBlockedTile(map.seed, tx, ty) || WorldGenerator.trunkAt(map, mob.position.x, mob.position.y)) violations++;
    }
    console.log(`CHASE: ${CHASE_TICKS} ticks around the lake, ${violations} ticks ended on blocked ground`);
    expect(violations).toBe(0);
  });
});

describe('water reads as water', () => {
  it('differs from open ground in grayscale, in every genre, and stays darker than mud', () => {
    const { map } = proofView();
    // Find a patch of water to measure
    const center = 16.5 * 512;
    let spot: { x: number; y: number } | null = null;
    search: for (let ty = center - 400; ty < center + 400; ty += 2) {
      for (let tx = center - 400; tx < center + 400; tx += 2) {
        if (TerrainSystem.typeAt(map.seed, tx, ty) === TerrainType.WATER &&
            TerrainSystem.typeAt(map.seed, tx + 1, ty) === TerrainType.WATER &&
            TerrainSystem.typeAt(map.seed, tx, ty + 1) === TerrainType.WATER) { spot = { x: tx, y: ty }; break search; }
      }
    }
    expect(spot, 'water exists').toBeTruthy();
    GENRES.forEach(g => {
      const gray = grayscale(buildPalette(g));
      const gy = (v: number) => gray[v * 3];
      const W = 120, H = 80;
      const ox = spot!.x * 10 - W / 2, oy = spot!.y * 10 - H / 2;
      const data = terrainBuffer(map, g, ox, oy, W, H);
      let water = 0, differing = 0, brightest = 0;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const ax = ox + x, ay = oy + y;
        const tx = Math.floor(ax / 10), ty = Math.floor(ay / 10);
        if (TerrainSystem.typeAt(map.seed, tx, ty) !== TerrainType.WATER) continue;
        const lx = ax - tx * 10, ly = ay - ty * 10;
        if (lx === 0 || ly === 0 || lx === 9 || ly === 9) continue; // seams are their own law
        water++;
        const v = data[y * W + x];
        if (Math.abs(gy(v) - gy(openGround(map, g, ax, ay))) >= GRAY_STEP) differing++;
        if (v >= px(Role.GROUND, 0) && v <= px(Role.GROUND, STEPS - 1)) brightest = Math.max(brightest, v - px(Role.GROUND, 0));
      }
      const fraction = differing / water;
      console.log(`WATER ${g.name}: ${(fraction * 100).toFixed(0)}% of ${water} atoms differ from open ground, brightest step ${brightest}`);
      expect(water).toBeGreaterThan(200);
      expect(fraction, g.name).toBeGreaterThanOrEqual(WATER_MIN_DIFFERENCE);
      expect(brightest, `${g.name} stays darker than mud's ripple`).toBeLessThanOrEqual(2);
    });
  });
});

describe('feedback reads in grayscale', () => {
  it('keeps the hit flash, death burst and health pips readable without color', () => {
    GENRES.forEach(g => {
      const gray = grayscale(buildPalette(g));
      const relLum = (v: number) => {
        const s = gray[v * 3] / 255;
        return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
      };
      const contrast = (a: number, b: number) =>
        (Math.max(relLum(a), relLum(b)) + 0.05) / (Math.min(relLum(a), relLum(b)) + 0.05);
      // The flash and burst sit on the brightest ground; pips sit on their void plate
      expect(contrast(px(Role.LOSS, 4), px(Role.GROUND, STEPS - 1)), `${g.name} hit`).toBeGreaterThanOrEqual(MIN_CONTRAST);
      expect(contrast(px(Role.LOSS, 3), px(Role.GROUND, STEPS - 1)), `${g.name} burst`).toBeGreaterThanOrEqual(MIN_CONTRAST);
      expect(contrast(px(Role.THREAT, 4), px(Role.VOID, 4)), `${g.name} pips`).toBeGreaterThanOrEqual(MIN_CONTRAST);
    });
  });
});

describe('the faces', () => {
  const ids = (n: number) => Array.from({ length: n }, (_, i) => `ws_${(i * 2654435761 >>> 0).toString(16)}_cert_${i}`);
  const gray = grayscale(buildPalette(GENRES[0]));
  const gy = (v: number) => gray[v * 3];

  const visibleDifference = (a: Sprite, b: Sprite) => {
    let union = 0, diff = 0;
    for (let i = 0; i < a.data.length; i++) {
      if (!a.data[i] && !b.data[i]) continue;
      union++;
      if (Math.abs(gy(a.data[i]) - gy(b.data[i])) >= 20) diff++;
    }
    return union === 0 ? 0 : diff / union;
  };

  it('holds the raised portrait bar: no two faces nearly alike, hooded ones included', () => {
    ARCHETYPE_IDS.forEach(archetype => {
      const sprites = ids(40).map(id => portrait({ uid: id, archetype }));
      expect(new Set(sprites.map(s => hashBytes(s.data))).size, archetype).toBe(40);
      const closest = Math.min(...pairs(sprites).map(([a, b]) => visibleDifference(a, b)));
      console.log(`PORTRAIT ${archetype} closest pair: ${(closest * 100).toFixed(0)}%`);
      expect(closest, archetype).toBeGreaterThanOrEqual(PORTRAIT_MIN_CLOSEST);
    });
  });
});
