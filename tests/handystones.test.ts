/**
 * A STONE TO THROW, NEAR AT HAND (C24). Registered before the build.
 *
 * Pedro, 2026-11-10, told that the nearest pebble in the tutorial lay 232 m from where a
 * newcomer lands: "Holy shit... 232m.... Nope... We need to seed some form of handy throw able
 * object".
 *
 * What a world writes in the pebble form is laid loose across its ground, on a roll of its own,
 * so that one is always a few seconds' walk away. A world pins the ground it is laid by, as it
 * pins its web and its bank: a world minted before this pins none and generates exactly what it
 * always did.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

import { UniversalRank } from '../shared/types';
import { IMap, IWorldEntity } from '../shared/entities/world/types';
import { TILE_PX, chunkOf, tileOf } from '../shared/entities/world/grid';
import { GROUND_VERSION, IGenerationContext, WorldGenerator } from '../shared/entities/world/WorldGenerator';
import { MOB_DEFINITIONS } from '../shared/entities/mob/data/mobDefinitions';
import { RESOURCE_DEFINITIONS } from '../shared/entities/item/data/resourceDefinitions';
import { isLooseStone } from '../shared/entities/item/Throwable';
import { ContentRegistry } from '../shared/logic/theme/ContentRegistry';
import { FIRST_THEME_PACK, installShippedThemes } from '../shared/logic/theme/boot';
import { computeGolden, FIRST_THEME_VECTORS, GOLDEN_VECTORS } from '../src/entities/world/goldens';
import { Tutorial } from '../src/logic/systems/Tutorial';

installShippedThemes();

const SRC = (p: string) => readFileSync(p, 'utf8');

/** How far a newcomer should have to walk for one, in tiles. A tile is a metre; a walk is four a second. */
const A_FEW_SECONDS = 24;
const NEVER_FURTHER = 48;

const themed = (over: Partial<IGenerationContext> = {}): IGenerationContext => ({ ...ContentRegistry.contextFor(FIRST_THEME_PACK.themeId), ...over });
const pinned = () => themed({ groundVersion: GROUND_VERSION });

const isStone = (e: IWorldEntity) => isLooseStone(RESOURCE_DEFINITIONS[e.definitionId] as never);
const laidLoose = (e: IWorldEntity) => /_loose\d*$/.test(e.id);

/** The nine chunks around a point, built, with everything on them. */
const around = (map: IMap, px: number, pz: number, ctx: IGenerationContext): IWorldEntity[] => {
  const out: IWorldEntity[] = [];
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const chunk = WorldGenerator.chunkAt(map, chunkOf(px) + dx, chunkOf(pz) + dy, ctx);
    if (chunk) out.push(...chunk.entities);
  }
  return out;
};
const nearestStone = (things: IWorldEntity[], px: number, pz: number) =>
  Math.min(...things.filter(isStone).map(e => Math.hypot(e.position.x - px, e.position.y - pz) / TILE_PX), Infinity);

const tutorialDrop = (laidBy: IGenerationContext) => {
  const card = Tutorial.card(0);
  // The tutorial is laid at its own danger, which moves what its table rolls: read it as the game does
  const ctx = { ...laidBy, difficulty: card.difficulty as UniversalRank };
  const map = WorldGenerator.generate(card.seed, card.size, ctx);
  const block = Tutorial.knownBlock(map);
  const drop = WorldGenerator.dropPoint(map, block.x, block.y);
  return { map, drop, things: around(map, drop.x, drop.z, ctx) };
};

describe('C24: a stone to throw lies a few seconds from where anyone lands', () => {
  it('in the tutorial, where the nearest was 232 m off', () => {
    const before = tutorialDrop(themed());
    expect(nearestStone(before.things, before.drop.x, before.drop.z), 'as it was: none in the nine chunks around the drop').toBe(Infinity);
    const { things, drop } = tutorialDrop(pinned());
    expect(nearestStone(things, drop.x, drop.z)).toBeLessThanOrEqual(A_FEW_SECONDS);
  });

  it('and from every drop of a whole small world: never far, and mostly a few steps', () => {
    const ctx = pinned();
    const map = WorldGenerator.generate('golden-alpha', 16, ctx);
    const walks = Object.values(map.sectors).map(s => {
      const drop = WorldGenerator.dropPoint(map, s.x, s.y);
      return nearestStone(around(map, drop.x, drop.z, ctx), drop.x, drop.z);
    }).sort((a, b) => a - b);
    expect(walks.length).toBeGreaterThan(100);
    console.log(`STONES from ${walks.length} drops: median ${walks[walks.length >> 1].toFixed(1)} tiles, worst ${walks[walks.length - 1].toFixed(1)}`);
    expect(walks[walks.length >> 1]).toBeLessThanOrEqual(A_FEW_SECONDS / 2);
    expect(walks[walks.length - 1]).toBeLessThanOrEqual(NEVER_FURTHER);
  });

  it('there are enough to fight with, and not a carpet, on ground whose own table lays none', () => {
    const ctx = pinned();
    const map = WorldGenerator.generate('golden-beta', 32, ctx);
    const drop = WorldGenerator.dropPoint(map, 16, 16);
    let stones = 0, chunks = 0;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const chunk = WorldGenerator.chunkAt(map, chunkOf(drop.x) + dx, chunkOf(drop.z) + dy, ctx);
      if (!chunk) continue;
      const laid = chunk.entities.filter(laidLoose).length;
      // Where the land's own table lays stones, none is added: the ground has them
      if (laid < chunk.entities.filter(isStone).length) { expect(laid, chunk.id).toBe(0); continue; }
      chunks++;
      stones += laid;
    }
    expect(chunks).toBeGreaterThan(5);
    console.log(`STONES laid loose: ${(stones / chunks).toFixed(1)} a chunk over ${chunks} chunks whose table lays none`);
    expect(stones / chunks).toBeGreaterThanOrEqual(6);
    expect(stones / chunks).toBeLessThanOrEqual(30);
  });
});

describe('C24: a world pins the ground it is laid by', () => {
  it('a world that pins none generates exactly what it always did', () => {
    const { things } = tutorialDrop(themed());
    expect(things.some(laidLoose)).toBe(false);
    for (const g of FIRST_THEME_VECTORS) expect(computeGolden(g.seed, g.size, themed()), g.seed).toBe(g.hash);
    // The fixture's land, read alone: it holds a pebble of its own, and with no pin none of them is laid
    const fixture = { mobDefinitions: Object.values(MOB_DEFINITIONS).filter((m: any) => !m.themeId), resourceDefinitions: Object.values(RESOURCE_DEFINITIONS).filter((r: any) => !r.themeId) };
    for (const g of GOLDEN_VECTORS) expect(computeGolden(g.seed, g.size, fixture as IGenerationContext), g.seed).toBe(g.hash);
  });

  it('a world that pins it keeps everything it had, each in its place, and only gains', () => {
    const plain = tutorialDrop(themed()).things;
    const laid = tutorialDrop(pinned()).things;
    expect(laid.filter(e => !laidLoose(e))).toEqual(plain);
    expect(laid.filter(laidLoose).length).toBeGreaterThan(0);
    expect(laid.filter(laidLoose).every(isStone)).toBe(true);
  });

  it('the same seed and place lay the same stones, in any order of asking', () => {
    const a = tutorialDrop(pinned()).things.filter(laidLoose);
    const b = tutorialDrop(pinned()).things.filter(laidLoose);
    expect(a).toEqual(b);
    const ctx = pinned();
    const card = Tutorial.card(0);
    ctx.difficulty = card.difficulty as UniversalRank;
    const map = WorldGenerator.generate(card.seed, card.size, ctx);
    const drop = WorldGenerator.dropPoint(map, Tutorial.knownBlock(map).x, Tutorial.knownBlock(map).y);
    const alone = WorldGenerator.chunkAt(map, chunkOf(drop.x), chunkOf(drop.z), ctx)!.entities.filter(laidLoose);
    expect(alone).toEqual(a.filter(e => chunkOf(e.position.x) === chunkOf(drop.x) && chunkOf(e.position.y) === chunkOf(drop.z)));
  });

  it('every id is its own, and no stone shares a tile with anything or lies where nobody can walk', () => {
    const { map, things } = tutorialDrop(pinned());
    expect(new Set(things.map(e => e.id)).size).toBe(things.length);
    const at = (e: IWorldEntity) => `${tileOf(e.position.x)},${tileOf(e.position.y)}`;
    const taken = new Map<string, number>();
    for (const e of things) taken.set(at(e), (taken.get(at(e)) ?? 0) + 1);
    for (const stone of things.filter(laidLoose)) {
      expect(taken.get(at(stone)), stone.id).toBe(1);
      expect(WorldGenerator.isWalkableTile(map, tileOf(stone.position.x), tileOf(stone.position.y)), stone.id).toBe(true);
    }
  });

  it('a world that wrote nothing to throw lays nothing', () => {
    const none = themed({ groundVersion: GROUND_VERSION });
    none.resourceDefinitions = none.resourceDefinitions.filter((r: any) => !isLooseStone(r));
    const { things } = tutorialDrop(none);
    expect(things.some(laidLoose)).toBe(false);
  });

  it('it is laid from what the world itself wrote, on a roll of its own', () => {
    const generator = SRC('shared/entities/world/WorldGenerator.ts');
    expect(generator).toMatch(/Rng\.fromKey\(`\$\{seed\}:loose:v1:\$\{qx\},\$\{qy\}`\)/);
    expect(generator).toMatch(/ctx\.resourceDefinitions\.filter\(isLooseStone\)/);
    // It is laid after everything else stands, so nothing that was there moves for it
    expect(generator).toMatch(/this\.standLeaders\(seed, chunk, context\);\s*this\.layLoose\(seed, chunk, ctx\);/);
    // No stone is named in the generator: a world with another loose thing lays that
    expect(generator).not.toMatch(/tally_pebble|Tally Pebble/);
  });

  it('the tutorial pins it, and so does every world minted from now on', () => {
    expect(Tutorial.card(0).groundVersion).toBe(GROUND_VERSION);
    const cert = SRC('src/entities/world/WorldCertificate.ts');
    expect(cert).toMatch(/groundVersion\?: number/);
    expect(cert).toMatch(/groundVersion: GROUND_VERSION,/);
  });

  it('the pin travels from the certificate to the card to the land, and through a turn of the record', () => {
    const store = SRC('src/entities/world/store.ts');
    expect(store).toMatch(/groundVersion: cert\.data\.rules\.groundVersion/);
    expect(store).toMatch(/groundVersion: worldCard\.groundVersion/);
    expect(store).toMatch(/groundVersion: generationContext\.groundVersion/);
    expect(SRC('src/entities/world/worldView.ts')).toMatch(/groundVersion\?: number/);
  });

  it('a chunk still builds inside a frame with stones on it', () => {
    const ctx = pinned();
    const map = WorldGenerator.generate('golden-beta', 32, ctx);
    const drop = WorldGenerator.dropPoint(map, 16, 16);
    const cx = chunkOf(drop.x), cy = chunkOf(drop.z);
    const times: number[] = [];
    for (let i = 0; i < 24; i++) {
      const t = performance.now();
      WorldGenerator.buildChunk(map.seed, WorldGenerator.exitsInSector(map, 16, 16), cx + (i % 6), cy + Math.floor(i / 6), ctx);
      times.push(performance.now() - t);
    }
    times.sort((a, b) => a - b);
    // The median, not the worst: the worst reads the machine's load (the builder's log, on `tests/grid.test.ts`)
    expect(times[times.length >> 1]).toBeLessThan(16);
  });
});
