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
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';

import { ItemType, UniversalRank } from '../shared/types';
import { Rng } from '../shared/logic/rng/DeterministicRNG';
import { EFFECTS, PASSIVE_STATS } from '../shared/logic/theme/ThemeTypes';
import { statWord } from '../shared/logic/systems/StatWords';
import { deliveryWord, effectWord } from '../shared/logic/systems/EffectWords';
import { SkillSay } from '../src/logic/systems/SkillSay';
import { LootTable } from '../src/entities/world/LootTable';
import { FirstOrder } from '../src/logic/systems/FirstOrder';
import { CRAFTED_DEFINITIONS } from '../shared/entities/economy/data/recipeDefinitions';
import { BASE_STATIONS } from '../shared/entities/hub/baseStations';
import { SHELL_STATION, STATION_FUNCTION, STATION_MIN_AREA, stationDefOf } from '../shared/entities/hub/room';
import { ROOM_PRESETS } from '../shared/entities/hub/template';
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

// -----------------------------------------------------------------------------
// FAMILY 2: relics, copies and orphans. Plumbing only: what nothing read is gone, what was said twice is said once,
// and the four base stations the hub mints are the game's own, no longer only the bars' fixture.
// -----------------------------------------------------------------------------

const SRC = (p: string) => readFileSync(p, 'utf8');
/** Every file of the game's own source. */
const gameSource = (dir = 'src'): string[] => readdirSync(dir).flatMap(name => {
  const p = `${dir}/${name}`;
  return statSync(p).isDirectory() ? gameSource(p) : /\.tsx?$/.test(name) ? [p] : [];
});

describe('family 2: what nothing read is gone', () => {
  it('A15: the name generator that answered "Kael Steelweave", and the lore brief only it read', () => {
    expect(existsSync('src/entities/identity/IdentityGenerator.ts')).toBe(false);
    expect(SRC('src/entities/lore/LoreBible.ts')).not.toMatch(/LORE_CONTEXT|NAMING CONVENTION/);
  });

  it('A8: the three material affixes, the inspection nothing called and the marks only a bar drew; study, which is called, stays', () => {
    const science = SRC('src/entities/world/MaterialScience.ts');
    expect(science).not.toMatch(/MATERIAL_AFFIXES|inspectMaterial|Ley-Touched/);
    expect(science).toMatch(/static studyMaterial/);
    expect(SRC('shared/render/atoms/atoms.ts')).not.toMatch(/AFFIX_MARKS|AFFIX_THRESHOLD|aff_dense/);
  });

  it('A11: a shoulder piece\'s name per genre, which nothing read', () => {
    expect(SRC('shared/entities/player/systems/LoadoutSystem.ts')).not.toMatch(/themedShoulderName|Woven Cape/);
  });
});

describe('family 2: what was said twice is said once', () => {
  it('F1: a gift says its stat in the one table of stat words, as it did', () => {
    for (const stat of PASSIVE_STATS) {
      expect(SkillSay.gift({ kind: 'passive', name: 'Gift', stat, value: 2 } as never), stat).toBe(`Gift: ${statWord(stat)} +2`);
    }
    expect(SRC('src/logic/systems/SkillSay.ts')).not.toMatch(/STAT_SAY|max_health: 'health'/);
  });

  it('F2: an effect is said in one table, which a gift and The Working both read', () => {
    for (const effect of EFFECTS) {
      expect(SkillSay.gift({ kind: 'active', name: 'Gift', effect, delivery: 'aura' } as never), effect).toBe(`Gift: ${effectWord(effect)}, ${deliveryWord('aura')}`);
    }
    expect(effectWord('ward')).toBe('wards off the next blows');
    expect(deliveryWord('aura')).toBe('all around you');
    const working = SRC('src/components/TheWorking.tsx');
    expect(working).not.toMatch(/ACT_WORDS|hurts what it reaches/);
    expect(working).toMatch(/effectWord\(/);
    expect(SRC('src/logic/systems/SkillSay.ts')).not.toMatch(/hurts what it reaches/);
  });

  it('A10: the lore fragment is built in one place, and the hoard\'s and the chest\'s give what they gave', () => {
    const hoard = LootTable.loreFragment('cp:hoard', FIRST_THEME_PACK.themeId);
    expect({ id: hoard.id, name: hoard.name, type: hoard.type, value: hoard.value, tags: hoard.tags, description: hoard.description }).toEqual({
      id: 'itm_b549e52743658666', name: 'Lore Fragment', type: ItemType.LORE, value: 50, tags: ['lore', 'document'],
      description: 'Ledger stub: 40,000 G transferred to "NULL". The bank honored it. The bank always honors it.'
    });
    // A chest's: its words picked first on its own stream, then the piece, as the chest always drew it
    const rng = Rng.fromKey('cp:chest');
    const words = rng.pick(ContentRegistry.lore(FIRST_THEME_PACK.themeId, undefined));
    const chest = LootTable.writtenPiece(rng, () => words);
    expect({ id: chest.id, name: chest.name, type: chest.type, value: chest.value, tags: chest.tags, description: chest.description }).toEqual({
      id: 'itm_3841f2ba12c1c8dd', name: 'Lore Fragment', type: ItemType.LORE, value: 50, tags: ['lore', 'document'],
      description: 'Maintenance log, cycle 40,221: the branch is still open. We have stopped asking for whom.'
    });
    expect(gameSource().filter(f => SRC(f).includes('\'Lore Fragment\''))).toEqual(['src/entities/world/LootTable.ts']);
    expect(SRC('src/entities/player/store.ts')).toMatch(/LootTable\.writtenPiece\(/);
  });

  it('the tutorial\'s five tasks are written once, in the first order, and both screens read them', () => {
    expect(FirstOrder.inOneLine()).toBe('fell three creatures, open a chest, take material from the ground, bring one person out, and walk out by the beacon');
    for (const f of ['src/components/GuildHall.tsx', 'src/components/MissionControl.tsx']) {
      expect(SRC(f), f).not.toMatch(/open a chest/);
      expect(SRC(f), f).toMatch(/FirstOrder\.inOneLine\(\)/);
    }
  });
});

describe('CP14: the four base stations are the game\'s own', () => {
  const FOUR = ['stn_bench', 'stn_counter', 'stn_table', 'stn_scribe'] as const;

  it('defined in the game, and the bars\' fixture installs those very definitions', () => {
    for (const id of FOUR) {
      expect(BASE_STATIONS[id].id, id).toBe(id);
      expect(CRAFTED_DEFINITIONS[id], id).toBe(BASE_STATIONS[id]);
    }
    expect(SRC('tests/fixtures/content/recipes.ts')).not.toMatch(/id: 'stn_(bench|counter|table|scribe)'/);
  });

  it('every station the hub names by id has a definition, with no theme and no fixture behind it', () => {
    const named = new Set([
      ...Object.values(SHELL_STATION), ...Object.keys(STATION_MIN_AREA), ...Object.keys(STATION_FUNCTION),
      ...ROOM_PRESETS.flatMap(p => p.stations.map(s => s.defId))
    ]);
    const held = Object.fromEntries(FOUR.map(id => [id, CRAFTED_DEFINITIONS[id]]));
    for (const id of FOUR) delete CRAFTED_DEFINITIONS[id];
    try {
      for (const id of named) expect(stationDefOf(id as string), id as string).toBe(BASE_STATIONS[id as (typeof FOUR)[number]]);
    } finally {
      Object.assign(CRAFTED_DEFINITIONS, held);
    }
  });
});
