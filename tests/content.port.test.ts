/**
 * THE CONTENT PORT, FAMILIES 1 AND 2 (CP, 2026-11-13). Registered before the build.
 *
 * Pedro: "finally, together with this, can you run a full "inlined" or "hardcoded" content and port it to
 * logic with how to operate over for the API calls?" `CONTENT_PORT.md` is the audit; these bars hold the
 * first two families of its port, the two that need no design call.
 *
 * Family 1 (CP8, entry A9): every world's people were named from the same 8 first names and 7 surnames,
 * whatever the world was about. A written world already makes its own name pieces (the ground pass's
 * prefixes and suffixes, `NameWell`), and dropped them once it was written. They are kept on its sealed
 * pack now, and from ground 8 a person is named from them. The 15 names are the floor for a pack with none
 * (the first theme, pinned by its bytes) and for a world laid before ground 8, which is never changed.
 *
 * Every bar here runs with no key and spends nothing.
 */
import { beforeAll, describe, expect, it } from 'vitest';

import { UniversalRank } from '../shared/types';
import { EntityType, IWorldEntity } from '../shared/entities/world/types';
import { SECTOR_CHUNKS } from '../shared/entities/world/grid';
import { GROUND_VERSION, IGenerationContext, WorldGenerator } from '../shared/entities/world/WorldGenerator';
import { NAMED_FROM_GROUND, PeopleNames } from '../shared/entities/world/PeopleNames';
import { ContentRegistry } from '../shared/logic/theme/ContentRegistry';
import { FIRST_THEME_PACK, installShippedThemes } from '../shared/logic/theme/boot';
import { bodyOf, sealTheme, themeIdOf } from '../shared/logic/theme/ThemeCompiler';
import { ThemeLaw } from '../shared/logic/theme/ThemeLaw';
import { WebBank } from '../shared/logic/content/WebBank';
import { computeGolden, FIRST_THEME_VECTORS } from '../src/entities/world/goldens';

installShippedThemes();

const registered = (tag: string) => WebBank.current().tags.some(t => t.tag === tag && !t.retired);

/** A world's own sounds, as a ground pass writes them: a prefix begins with a capital. */
const PIECES = { prefixes: ['Gray', 'Hollow', 'Still', 'Pale'], suffixes: ['crawler', 'moth', 'glass', 'drift'] };
const NAMED = sealTheme({ ...bodyOf(FIRST_THEME_PACK), name: 'A Named Moon', names: PIECES }, 'test', 1);

beforeAll(() => {
  expect(ContentRegistry.install(NAMED)).toEqual({ ok: true });
});

const ctxOf = (themeId: string, ground: number): IGenerationContext => ({ ...ContentRegistry.contextFor(themeId, UniversalRank.D), groundVersion: ground });

/** Everything the land lays in a world's first sectors, chunk by chunk, in order. */
const laid = (seed: string, ctx: IGenerationContext): IWorldEntity[] => {
  const map = WorldGenerator.generate(seed, 6, ctx);
  const out: IWorldEntity[] = [];
  for (const s of Object.values(map.sectors).slice(0, 2)) {
    for (let y = 0; y < SECTOR_CHUNKS / 2; y++) for (let x = 0; x < SECTOR_CHUNKS / 2; x++) {
      const chunk = WorldGenerator.chunkAt(map, s.x * SECTOR_CHUNKS + x, s.y * SECTOR_CHUNKS + y, ctx);
      if (chunk) out.push(...chunk.entities);
    }
  }
  return out;
};
const people = (things: IWorldEntity[]) => things.filter(e => e.type === EntityType.NPC && e.definitionId === 'npc_survivor');

/** A word grown from one of the world's prefixes and one of its suffixes. */
const grownFrom = (word: string, pieces = PIECES) =>
  pieces.prefixes.some(p => pieces.suffixes.some(s => word === `${p}${s.toLowerCase()}`));

describe('CP8: a world\'s people are named from its own name pieces', () => {
  it('the pieces are kept on the sealed pack, and they are part of its bytes', () => {
    expect(NAMED.names).toEqual(PIECES);
    expect(bodyOf(NAMED).names).toEqual(PIECES);
    const other = sealTheme({ ...bodyOf(FIRST_THEME_PACK), name: 'A Named Moon', names: { ...PIECES, suffixes: ['mere'] } }, 'test', 1);
    expect(other.themeId).not.toBe(NAMED.themeId);
    // A pack with none hashes as it always did: the first theme's id is its bytes, and it has no pieces
    expect(FIRST_THEME_PACK.names).toBeUndefined();
    expect(themeIdOf(bodyOf(FIRST_THEME_PACK))).toBe(FIRST_THEME_PACK.themeId);
  });

  it('the law holds the pieces as the ground pass does: letters only, neither list empty', () => {
    const body = (names: unknown) => ({ ...bodyOf(FIRST_THEME_PACK), names } as never);
    expect(ThemeLaw.validate(body(PIECES), registered).ok).toBe(true);
    expect(ThemeLaw.validate(body({ prefixes: [], suffixes: ['moth'] }), registered).ok).toBe(false);
    expect(ThemeLaw.validate(body({ prefixes: ['Gray'], suffixes: [] }), registered).ok).toBe(false);
    expect(ThemeLaw.validate(body({ prefixes: ['gray_moth'], suffixes: ['moth'] }), registered).ok).toBe(false);
    expect(ThemeLaw.validate(body({ prefixes: ['Gray'], suffixes: ['moth2'] }), registered).ok).toBe(false);
    expect(ThemeLaw.validate(body('Gray moth'), registered).ok).toBe(false);
  });

  it('a world\'s context carries its pack\'s pieces, and a pack with none carries none', () => {
    expect(ContentRegistry.contextFor(NAMED.themeId).names).toEqual(PIECES);
    expect(ContentRegistry.contextFor(FIRST_THEME_PACK.themeId).names).toBeUndefined();
  });

  it('from ground 8, a person the land lays is named from the pieces: a given name and a family name, each one prefix and one suffix', () => {
    expect(NAMED_FROM_GROUND).toBe(8);
    expect(GROUND_VERSION).toBeGreaterThanOrEqual(NAMED_FROM_GROUND);
    const found = people(laid('cp8-moon', ctxOf(NAMED.themeId, NAMED_FROM_GROUND)));
    expect(found.length).toBeGreaterThan(3);
    for (const p of found) {
      const words = p.npc!.name.split(' ');
      expect(words.length, p.npc!.name).toBe(2);
      expect(words.every(w => grownFrom(w)), p.npc!.name).toBe(true);
      expect(words[0], p.npc!.name).not.toBe(words[1]);
    }
    // Not one name for all: the pieces make sixteen words, and the people spread over them
    expect(new Set(found.map(p => p.npc!.name)).size).toBeGreaterThan(1);
  });

  it('only the names move: where everyone stands, and everything else laid, is as at ground 7', () => {
    const before = laid('cp8-moon', ctxOf(NAMED.themeId, NAMED_FROM_GROUND - 1));
    const after = laid('cp8-moon', ctxOf(NAMED.themeId, NAMED_FROM_GROUND));
    const plain = (xs: IWorldEntity[]) => xs.map(e => ({ ...e, npc: e.npc ? { ...e.npc, name: '' } : undefined }));
    expect(plain(after)).toEqual(plain(before));
    expect(people(after).map(p => p.npc!.name)).not.toEqual(people(before).map(p => p.npc!.name));
  });

  it('a world laid before ground 8 keeps the floor names, pieces or not', () => {
    const floor = PeopleNames.FLOOR;
    for (const p of people(laid('cp8-moon', ctxOf(NAMED.themeId, NAMED_FROM_GROUND - 1)))) {
      const [first, last] = p.npc!.name.split(' ');
      expect(floor.first).toContain(first);
      expect(floor.last).toContain(last);
    }
  });

  it('a pack with no pieces (the first theme) keeps the floor names at any ground, and its goldens hold', () => {
    const floor = PeopleNames.FLOOR;
    const found = people(laid('cp8-moon', ctxOf(FIRST_THEME_PACK.themeId, GROUND_VERSION)));
    expect(found.length).toBeGreaterThan(0);
    for (const p of found) {
      const [first, last] = p.npc!.name.split(' ');
      expect(floor.first).toContain(first);
      expect(floor.last).toContain(last);
    }
    for (const g of FIRST_THEME_VECTORS) expect(computeGolden(g.seed, g.size, ContentRegistry.contextFor(FIRST_THEME_PACK.themeId)), g.seed).toBe(g.hash);
  });

  it('a person named by who they are (the first order\'s) reads the same pieces from the same ground', () => {
    const own = WorldGenerator.personName('fo:someone', ctxOf(NAMED.themeId, GROUND_VERSION));
    expect(own.split(' ').every(w => grownFrom(w)), own).toBe(true);
    expect(WorldGenerator.personName('fo:someone', ctxOf(NAMED.themeId, GROUND_VERSION))).toBe(own);
    const floor = WorldGenerator.personName('fo:someone', ctxOf(FIRST_THEME_PACK.themeId, GROUND_VERSION)).split(' ');
    expect(PeopleNames.FLOOR.first).toContain(floor[0]);
    expect(PeopleNames.FLOOR.last).toContain(floor[1]);
    // Read as it was before the port, with no world: the floor, keyed as before
    expect(WorldGenerator.personName('fo:someone')).toBe(WorldGenerator.personName('fo:someone', ctxOf(FIRST_THEME_PACK.themeId, GROUND_VERSION)));
  });

  it('a world with one prefix and one suffix names its people with the one word they make', () => {
    const one = { prefixes: ['Gray'], suffixes: ['moth'] };
    expect(PeopleNames.draw('k', one)).toBe('Graymoth');
  });
});
