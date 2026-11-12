/**
 * THE SPREAD OF MATERIALS (ML). Pedro, 2026-11-12: "we need to add the spread of materials inside every world,
 * basically you change ever so slightly the sprite".
 *
 * Every world holds its materials spread over its land: its pack's and what its minting added. A material is a
 * variant of a base place (a tree, a rock, a plant): it stands where the base would, rolled from the world's seed
 * and its land, and it is drawn as the base's own picture changed slightly, by a rule read from the material
 * itself, told apart by shape and never by hue. Worlds that stand keep their ground; from ground 7 on, a world
 * lays its spread, and a variant taken comes back by the same rule, rolled anew.
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('../shared/entities/data/VectorStore', () => ({
  VectorNamespace: { CHARACTERS: 'characters', ITEMS: 'items', WORLDS: 'worlds', TRANSACTIONS: 'transactions', CONTENT: 'content', TERRITORIES: 'territories' },
  VectorStore: { get: async () => null, put: async () => true, query: async () => [], saveContent: async () => true, searchContent: async () => [] }
}));

import { Rarity, UniversalRank } from '../shared/types';
import { EntityType, IChunk } from '../shared/entities/world/types';
import { SECTOR_CHUNKS } from '../shared/entities/world/grid';
import { GROUND_VERSION, IGenerationContext, WorldGenerator, isTimber } from '../shared/entities/world/WorldGenerator';
import { BIOME_RESOURCES, RESOURCE_DEFINITIONS, ResourceDef } from '../shared/entities/item/data/resourceDefinitions';
import { ContentRegistry } from '../shared/logic/theme/ContentRegistry';
import { FIRST_THEME_PACK, installShippedThemes } from '../shared/logic/theme/boot';
import { RANKED_FROM_GROUND, spreadWeight } from '../shared/logic/theme/ThemeFormula';
import { MINT_ADDITIONS_FROM_GROUND } from '../shared/logic/theme/writing/MintAdditions';
import { GroundReturn } from '../shared/entities/world/GroundReturn';
import { SPREAD_FROM_GROUND, Spread, SpreadBook, formOf } from '../shared/entities/world/Spread';
import { maskDifference, maskOf, worldForm } from '../shared/render/atoms/atoms';
import { inspectEntity } from '../src/render/atoms/inspect';
import { usePlayerStore } from '../src/entities/player/store';

installShippedThemes();

const SEED = 'spread-a';
const pack = () => ContentRegistry.contextFor(FIRST_THEME_PACK.themeId, UniversalRank.F);
const ctxAt = (groundVersion: number, difficulty = UniversalRank.F, extra: ResourceDef[] = []): IGenerationContext => {
  const base = ContentRegistry.contextFor(FIRST_THEME_PACK.themeId, difficulty);
  return { ...base, groundVersion, resourceDefinitions: [...base.resourceDefinitions, ...extra] };
};
const keyOf = (id: string) => id.replace(/^res_[0-9a-f]+_/, '');
const byKey = (key: string) => Object.values(RESOURCE_DEFINITIONS).find(d => keyOf(d.id) === key && d.themeId === FIRST_THEME_PACK.themeId)!;

/** A material added beside the pack, as a minting adds one: its own id, name and scope, a form and a land. */
const added = (key: string, like: string, over: Partial<ResourceDef> = {}): ResourceDef => {
  const def: ResourceDef = { ...byKey(like), id: `res_test_${key}`, name: key.replace(/_/g, ' '), themeId: 'theme_test_scope', ...over };
  RESOURCE_DEFINITIONS[def.id] = def;
  for (const biome of def.habitat ?? []) {
    const table = (BIOME_RESOURCES[biome] ??= []);
    if (!table.includes(def.id)) table.push(def.id);
  }
  return def;
};

/** Built chunks: a few from each of many sectors, so every kind of ground is met. */
const chunksOf = (ctx: IGenerationContext, seed = SEED, sectorsTaken = 60): IChunk[] => {
  const map = WorldGenerator.generate(seed, 32, ctx);
  const out: IChunk[] = [];
  for (const s of Object.keys(map.sectors).sort().slice(0, sectorsTaken)) {
    const [sx, sy] = s.split(',').map(Number);
    const exits = WorldGenerator.exitsInSector(map, sx, sy);
    for (const [dx, dy] of [[1, 1], [4, 5], [6, 2]]) out.push(WorldGenerator.buildChunk(seed, exits, sx * SECTOR_CHUNKS + dx, sy * SECTOR_CHUNKS + dy, ctx));
  }
  return out;
};
const materialPlaces = (chunks: IChunk[]) => chunks.flatMap(c => c.entities.filter(e => e.type === EntityType.RESOURCE && (GroundReturn.roleOf(e.id) === 'tree' || GroundReturn.roleOf(e.id) === 'scatter')).map(e => ({ e, c })));
const count = (places: { e: { definitionId: string } }[], id: string) => places.filter(p => p.e.definitionId === id).length;

describe('ML: the spread is pinned by its ground, and a world that stands keeps its own', () => {
  it('the ground moved to 7 for the spread; the scaling and the minting stay at 6', () => {
    expect(SPREAD_FROM_GROUND).toBe(7);
    expect(GROUND_VERSION).toBeGreaterThanOrEqual(SPREAD_FROM_GROUND);
    expect(RANKED_FROM_GROUND).toBe(6);
    expect(MINT_ADDITIONS_FROM_GROUND).toBe(6);
    expect(Spread.spreads(6)).toBe(false);
    expect(Spread.spreads(7)).toBe(true);
    expect(Spread.spreads(undefined)).toBe(false);
  });

  it('a world laid at ground 6 lays exactly as it did: every tree its land\'s first timber, every place where it stood', () => {
    const second = added('ledger_birch', 'compound_oak', { habitat: ['OVERGROWTH'] });
    const old = chunksOf(ctxAt(6, UniversalRank.F, [second]), SEED, 20);
    const now = chunksOf(ctxAt(7, UniversalRank.F, [second]), SEED, 20);
    // Same places, same positions, in the same order: only what stands at each may differ, and only from 7
    expect(now.map(c => c.entities.map(e => `${e.id}@${e.position.x},${e.position.y}`))).toEqual(old.map(c => c.entities.map(e => `${e.id}@${e.position.x},${e.position.y}`)));
    const oldTrees = materialPlaces(old).filter(p => GroundReturn.roleOf(p.e.id) === 'tree');
    expect(oldTrees.length).toBeGreaterThan(0);
    expect(oldTrees.every(p => p.e.definitionId !== second.id)).toBe(true);
    delete RESOURCE_DEFINITIONS[second.id];
    BIOME_RESOURCES.OVERGROWTH = BIOME_RESOURCES.OVERGROWTH.filter(id => id !== second.id);
  });
});

describe('ML: a material stands where its base would, rolled from the world\'s seed and its land', () => {
  it('the form of a material is read from what it is: the pack\'s two grains are one form, its two veins another', () => {
    expect(formOf(byKey('chaffwheat'))).toBe('grain');
    expect(formOf(byKey('tellers_reed'))).toBe('grain');
    expect(formOf(byKey('collateral_iron'))).toBe('vein');
    expect(formOf(byKey('sovereign_silver'))).toBe('vein');
    expect(formOf(byKey('compound_oak'))).toBe('tree');
  });

  it('at ground 7 both grains stand where grain stands, on the same land, and nothing stands outside its form', () => {
    const places = materialPlaces(chunksOf(ctxAt(7)));
    const wheat = byKey('chaffwheat'), reed = byKey('tellers_reed');
    expect(count(places, wheat.id)).toBeGreaterThan(10);
    expect(count(places, reed.id)).toBeGreaterThan(10);
    // A tree place stands as a tree, a scatter place as anything its land holds
    for (const { e } of places.filter(p => GroundReturn.roleOf(p.e.id) === 'tree')) expect(isTimber(RESOURCE_DEFINITIONS[e.definitionId])).toBe(true);
    for (const { e, c } of places) expect(BIOME_RESOURCES[c.biome]).toContain(e.definitionId);
  });

  it('where a variant stands is the same for the same seed and place, and moves with the seed', () => {
    const a = materialPlaces(chunksOf(ctxAt(7), SEED, 20)).map(p => `${p.e.id}:${p.e.definitionId}`);
    const b = materialPlaces(chunksOf(ctxAt(7), SEED, 20)).map(p => `${p.e.id}:${p.e.definitionId}`);
    expect(a).toEqual(b);
    const vein = [byKey('collateral_iron'), byKey('sovereign_silver')];
    const land = vein;
    const once = Array.from({ length: 200 }, (_, i) => Spread.pick('s1', `ent_${i}_0_r0`, vein[0], land, UniversalRank.D).id);
    expect(Array.from({ length: 200 }, (_, i) => Spread.pick('s1', `ent_${i}_0_r0`, vein[0], land, UniversalRank.D).id)).toEqual(once);
    expect(Array.from({ length: 200 }, (_, i) => Spread.pick('s2', `ent_${i}_0_r0`, vein[0], land, UniversalRank.D).id)).not.toEqual(once);
    // Whichever of the form the land laid there, the roll is the place's: the laid kind only names the form
    expect(Array.from({ length: 200 }, (_, i) => Spread.pick('s1', `ent_${i}_0_r0`, vein[1], land, UniversalRank.D).id)).toEqual(once);
  });

  it('the formula weighs them: what is rarer and further from the land\'s rank stands less often', () => {
    const iron = byKey('collateral_iron'), silver = byKey('sovereign_silver');
    expect(spreadWeight(UniversalRank.F, Rarity.COMMON, UniversalRank.F)).toBe(1);
    expect(spreadWeight(UniversalRank.D, Rarity.RARE, UniversalRank.F)).toBeLessThan(spreadWeight(UniversalRank.F, Rarity.COMMON, UniversalRank.F) / 100);
    expect(spreadWeight(UniversalRank.F, Rarity.UNCOMMON, UniversalRank.F)).toBeLessThan(1);
    // On rank-F ground the common iron far outnumbers the rare silver; on rank-D ground silver stands too
    const onF = Array.from({ length: 4000 }, (_, i) => Spread.pick(SEED, `ent_${i}_1_r0`, iron, [iron, silver], UniversalRank.F).id);
    expect(onF.filter(id => id === iron.id).length).toBeGreaterThan(onF.filter(id => id === silver.id).length * 50);
    const onD = Array.from({ length: 4000 }, (_, i) => Spread.pick(SEED, `ent_${i}_2_r0`, iron, [iron, silver], UniversalRank.D).id);
    expect(onD.filter(id => id === silver.id).length).toBeGreaterThan(1000);
  });

  it('how many kinds a land holds has no ceiling: twelve rocks a minting added all stand beside the pack\'s', () => {
    const rocks = Array.from({ length: 12 }, (_, i) => added(`spread_rock_${i}`, 'vault_stone', { habitat: ['WASTELAND'] }));
    const places = materialPlaces(chunksOf(ctxAt(7, UniversalRank.F, rocks), 'spread-rocks', 120));
    const onWaste = places.filter(p => p.c.biome === 'WASTELAND');
    for (const r of [byKey('vault_stone'), ...rocks]) expect(count(onWaste, r.id)).toBeGreaterThan(0);
  });

  it('a minted tree joins its land\'s forest: the forest draws every timber the land holds', () => {
    const birch = added('ledger_birch_two', 'compound_oak', { habitat: ['OVERGROWTH'] });
    const trees = materialPlaces(chunksOf(ctxAt(7, UniversalRank.F, [birch]), 'spread-forest', 80)).filter(p => GroundReturn.roleOf(p.e.id) === 'tree' && p.c.biome === 'OVERGROWTH');
    expect(count(trees, birch.id)).toBeGreaterThan(20);
    expect(count(trees, byKey('compound_oak').id)).toBeGreaterThan(20);
  });
});

describe('ML: a variant taken comes back by the same rule, rolled anew', () => {
  it('from ground 7 a place that comes back is its role\'s pick, then the spread\'s, keyed by the turn', () => {
    const iron = byKey('collateral_iron'), silver = byKey('sovereign_silver');
    const context = ctxAt(7, UniversalRank.D);
    const kinds = new Set<string>();
    for (let turn = 1; turn <= 400; turn++) kinds.add(GroundReturn.rolled(SEED, 'ent_9_9_r0', 'INDUSTRIAL', turn, context, iron.id, UniversalRank.D).kind);
    expect(kinds.has(iron.id)).toBe(true);
    expect(kinds.has(silver.id)).toBe(true);
    // The same turn gives the same, on any machine
    expect(GroundReturn.rolled(SEED, 'ent_9_9_r0', 'INDUSTRIAL', 17, context, iron.id, UniversalRank.D)).toEqual(GroundReturn.rolled(SEED, 'ent_9_9_r0', 'INDUSTRIAL', 17, context, iron.id, UniversalRank.D));
  });

  it('before ground 7 it comes back as RG laid it: evenly from its role, no spread', () => {
    const iron = byKey('collateral_iron');
    const six = ctxAt(6, UniversalRank.D);
    const pool = GroundReturn.poolOf('scatter', 'INDUSTRIAL', six);
    for (let turn = 1; turn <= 50; turn++) {
      const back = GroundReturn.rolled(SEED, 'ent_9_9_r0', 'INDUSTRIAL', turn, six, iron.id, UniversalRank.D);
      expect(pool.map(d => d.id)).toContain(back.kind);
    }
    expect(GroundReturn.rolled(SEED, 'ent_9_9_r0', 'INDUSTRIAL', 3, six, iron.id)).toEqual(GroundReturn.rolled(SEED, 'ent_9_9_r0', 'INDUSTRIAL', 3, { resourceDefinitions: six.resourceDefinitions }, iron.id));
  });
});

describe('ML: a variant is drawn as its base\'s own picture changed slightly, by shape', () => {
  SpreadBook.enter(pack().resourceDefinitions as ResourceDef[], FIRST_THEME_PACK.themeId);
  const drawn = (def: ResourceDef, level: number) => worldForm(def, { level, ...SpreadBook.drawOf(def.id) });

  it('the plain one of a form is its base and carries no mark; the others are its variants', () => {
    expect(SpreadBook.of(byKey('chaffwheat').id).marks).toEqual([]);
    expect(SpreadBook.of(byKey('collateral_iron').id).marks).toEqual([]);
    expect(SpreadBook.of(byKey('tellers_reed').id).base?.id).toBe(byKey('chaffwheat').id);
    expect(SpreadBook.of(byKey('sovereign_silver').id).base?.id).toBe(byKey('collateral_iron').id);
    expect(SpreadBook.of(byKey('tellers_reed').id).marks.length).toBeGreaterThan(0);
  });

  it('two of one form are told apart by their outline at every knowledge, the unknown included', () => {
    for (const [a, b] of [['chaffwheat', 'tellers_reed'], ['collateral_iron', 'sovereign_silver']]) {
      for (const level of [0, 1, 2]) {
        const diff = maskDifference(maskOf(drawn(byKey(a), level)), maskOf(drawn(byKey(b), level)));
        // Changed: the outline itself differs, so no colour is needed to tell them
        expect(diff).toBeGreaterThan(0.02);
        // Slightly: it is still the base's picture
        expect(diff).toBeLessThan(0.4);
      }
    }
  });

  it('two variants of one base are told apart from each other too, within a world', () => {
    const third = added('tally_copper', 'collateral_iron', { habitat: ['INDUSTRIAL'] });
    SpreadBook.enter([...(pack().resourceDefinitions as ResourceDef[]), third], FIRST_THEME_PACK.themeId);
    const silver = drawn(byKey('sovereign_silver'), 0), copper = drawn(third, 0);
    expect(SpreadBook.of(third.id).base?.id).toBe(byKey('collateral_iron').id);
    expect(maskDifference(maskOf(silver), maskOf(copper))).toBeGreaterThan(0.02);
    SpreadBook.enter(pack().resourceDefinitions as ResourceDef[], FIRST_THEME_PACK.themeId);
  });

  it('the change is made from the material by a rule: its words decide it, the same words the same marks', () => {
    const reed = byKey('tellers_reed');
    expect(Spread.marksOf(reed)).toEqual(Spread.marksOf({ ...reed }));
    expect(Spread.marksOf({ ...reed, name: 'Another Reed' })).not.toEqual(Spread.marksOf(reed));
    // More worth, more marks; a higher rank, larger ones
    expect(Spread.marksOf({ ...reed, rarity: Rarity.RARE }).length).toBeGreaterThan(Spread.marksOf(reed).length);
    expect(Math.max(...Spread.marksOf({ ...reed, rank: UniversalRank.B }).map(m => m.size))).toBeGreaterThan(Math.max(...Spread.marksOf(reed).map(m => m.size)));
  });

  it('the marks are said in words, and the card says them to whoever looks, known or not', () => {
    const said = Spread.said(SpreadBook.of(byKey('sovereign_silver').id).marks);
    expect(said).toMatch(/^(a|an|two|three) /);
    expect(said).toMatch(/notch|knob|spur/);
    const player = usePlayerStore.getState().player;
    const place = { id: 'ent_0_0_r0', type: EntityType.RESOURCE, definitionId: byKey('sovereign_silver').id, position: { x: 0, y: 0 }, rank: UniversalRank.D, rarity: Rarity.RARE, isHostile: false, usesRemaining: 3 };
    const card = inspectEntity(place as never, { player, dist: 1, level: () => 0 });
    expect(card.rows.find(([k]) => k === 'Looks')?.[1]).toContain(said);
    // Unknown, it is unnamed: the card names its form, never the material
    expect(card.title.toLowerCase()).not.toContain('silver');
  });
});
