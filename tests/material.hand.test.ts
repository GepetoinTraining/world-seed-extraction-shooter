/**
 * THE HAND ON A PLACE (ML). Pedro, 2026-11-12: "the right click studies or inspects or tries to use the tool, rank +
 * rarity give the roll, on success you can extract, but it's a different sprite from the base".
 *
 * A right click on a place offers what a person can do to it: study it, inspect it, or try the held tool on it. The try
 * is a roll of a hundred on a scale, against a bar the material's rank and rarity set; the hand brings its tool's rank
 * and quality, the skill of that tool on that material, and what the person knows of it. On a success the material
 * comes away, drawn as a piece and not as the place. His ruling for study, kept here: a failure damages, a major failure
 * loses; so a failure wears the tool and leaves the place, and a major failure spoils the place until it comes back.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../shared/entities/data/VectorStore', () => ({
  VectorNamespace: { CHARACTERS: 'characters', ITEMS: 'items', WORLDS: 'worlds', TRANSACTIONS: 'transactions', CONTENT: 'content', TERRITORIES: 'territories' },
  VectorStore: { get: async () => null, put: async () => true, query: async () => [], saveContent: async () => true, searchContent: async () => [] }
}));

import { IAttributes, IItem, InteractionType, MENTAL_ATTRIBUTES, PHYSICAL_ATTRIBUTES, Rarity, StudyOutcome, UniversalRank } from '../shared/types';
import { EntityType, IChunk, IWorldEntity } from '../shared/entities/world/types';
import { RESOURCE_DEFINITIONS, ResourceDef } from '../shared/entities/item/data/resourceDefinitions';
import { ItemFactory } from '../shared/entities/item/ItemFactory';
import { ContentRegistry } from '../shared/logic/theme/ContentRegistry';
import { FIRST_THEME_PACK, installShippedThemes } from '../shared/logic/theme/boot';
import { EXTRACT_BAR_PLAIN, EXTRACT_PER_RANK, EXTRACT_PER_WORTH, extractBar } from '../shared/logic/theme/ThemeFormula';
import { slipWear } from '../shared/logic/theme/WearLaw';
import { LORE_FAIR_LINE, LORE_ROLL_PER_POINT } from '../shared/logic/systems/LoreConstants';
import { LoreLaw } from '../shared/logic/systems/LoreLaw';
import { ExtractLaw } from '../shared/logic/systems/ExtractLaw';
import { WebSystem } from '../shared/logic/systems/WebSystem';
import { Rng } from '../shared/logic/rng/DeterministicRNG';
import { SpreadBook } from '../shared/entities/world/Spread';
import { emptyGroundRecord } from '../shared/entities/world/GroundReturn';
import { maskDifference, maskOf, pieceForm, worldForm } from '../shared/render/atoms/atoms';
import { InteractionEngine } from '../src/entities/interaction/InteractionEngine';
import { pickInteract } from '../src/logic/systems/FieldInput';
import { StudyDoor } from '../src/logic/systems/StudyDoor';
import { StudySystem } from '../src/logic/systems/StudySystem';
import { Tutorial } from '../src/logic/systems/Tutorial';
import { useFeed } from '../src/components/ui/stores';
import { useWorldStore } from '../src/entities/world/store';
import { playerPort, usePlayerStore } from '../src/entities/player/store';
import { hubPort } from '../src/entities/hub/store';

installShippedThemes();

const keyOf = (id: string) => id.replace(/^res_[0-9a-f]+_/, '');
const byKey = (key: string) => Object.values(RESOURCE_DEFINITIONS).find(d => keyOf(d.id) === key && d.themeId === FIRST_THEME_PACK.themeId)! as ResourceDef;
const iron = () => byKey('collateral_iron');
const silver = () => byKey('sovereign_silver');
const wheat = () => byKey('chaffwheat');
const pebble = () => byKey('tally_pebble');
const even = (): IAttributes => Object.fromEntries([...PHYSICAL_ATTRIBUTES, ...MENTAL_ATTRIBUTES].map(a => [a, 4])) as unknown as IAttributes;

/** A pick of this rank and quality, as the theme's own mine tool is made. */
const pickOf = (rank: UniversalRank, quality = 0, key = 'pick'): IItem => {
  const base = ContentRegistry.compiled(FIRST_THEME_PACK.themeId)!.items.tool_bases.find(d => JSON.stringify(d).includes('pickaxe'))!;
  const item = ItemFactory.createItem(rank, false, Rng.fromKey(key), undefined, base.id);
  return { ...item, rank, quality, stats: { ...item.stats, durability: 100, maxDurability: 100 } } as IItem;
};

const place = (def: ResourceDef, id = 'ent_0_0_r0'): IWorldEntity => ({
  id, type: EntityType.RESOURCE, definitionId: def.id, position: { x: 40, y: 40 }, rank: def.rank as UniversalRank,
  rarity: Rarity.COMMON, isHostile: false, usesRemaining: def.uses ?? 1
});

const tutorial = Tutorial.card(0, 0);
const stage = (entities: IWorldEntity[], carried: IItem[] = [], ground = true) => {
  const chunk: IChunk = { id: 'c', x: 0, y: 0, biome: 'INDUSTRIAL' as never, difficulty: UniversalRank.F, rarity: Rarity.COMMON, entities, scanLevel: 0 as never, isTraversable: true, hasExtraction: false } as IChunk;
  useWorldStore.setState({
    currentMap: { seed: tutorial.seed, width: 32, height: 32, gridVersion: 2, sectors: {}, generatedAt: 0, chunks: { '0,0': chunk } } as never,
    availableWorlds: [tutorial], activeWorldId: tutorial.id, groundRecord: ground ? emptyGroundRecord() : null
  } as never);
  usePlayerStore.setState(s => ({
    player: {
      ...s.player, id: 'uid_hand', username: 'HAND', attributes: even(), baseAttributes: even(), materialMastery: {},
      bank: { ...s.player.bank, universalSkills: {} },
      currentSession: { sessionId: 'sess_hand', layerId: 'l', inventory: carried, kitItemIds: [], health: 100, maxHealth: 100, energy: 1000, maxEnergy: 1000, position: { x: 40, y: 0, z: 40 }, statusEffects: [] } as never
    }
  }));
};
const player = () => usePlayerStore.getState().player;
const live = (id: string) => Object.values(useWorldStore.getState().currentMap!.chunks).flatMap(c => c.entities).find(e => e.id === id);
const pack = () => player().currentSession!.inventory;
const fed = () => useFeed.getState().lines.map(l => l.text).join('\n');

beforeEach(() => {
  useFeed.setState({ lines: [] } as never);
  SpreadBook.enter(ContentRegistry.contextFor(FIRST_THEME_PACK.themeId, UniversalRank.F).resourceDefinitions as ResourceDef[], FIRST_THEME_PACK.themeId);
});
afterEach(() => { vi.restoreAllMocks(); });

describe('ML: the bar comes from the material\'s rank and its rarity', () => {
  it('a common thing of the hand\'s own rank asks the plain bar; each rank above asks more, each step of worth more again', () => {
    expect(extractBar(UniversalRank.F, Rarity.COMMON, UniversalRank.F)).toBe(EXTRACT_BAR_PLAIN);
    // D stands two ranks above F; rare three steps of worth above common
    expect(extractBar(UniversalRank.D, Rarity.COMMON, UniversalRank.F)).toBe(EXTRACT_BAR_PLAIN + 2 * EXTRACT_PER_RANK);
    expect(extractBar(UniversalRank.D, Rarity.RARE, UniversalRank.F)).toBe(EXTRACT_BAR_PLAIN + 2 * EXTRACT_PER_RANK + 3 * EXTRACT_PER_WORTH);
    // A hand above the thing finds it easier
    expect(extractBar(UniversalRank.F, Rarity.COMMON, UniversalRank.D)).toBeLessThan(EXTRACT_BAR_PLAIN);
    expect(ExtractLaw.bar(silver(), UniversalRank.D)).toBe(extractBar(UniversalRank.D, Rarity.RARE, UniversalRank.D));
  });
});

describe('ML: what the hand brings: its tool\'s rank and quality, the skill, and the eye', () => {
  it('the tool is the one carried that fits the place, the best by rank; a hand alone where none is asked', () => {
    stage([], [pickOf(UniversalRank.F, 0, 'a'), pickOf(UniversalRank.D, 0, 'b')]);
    const hand = ExtractLaw.hand(player(), iron())!;
    expect(hand.tool?.rank).toBe(UniversalRank.D);
    expect(hand.rank).toBe(UniversalRank.D);
    stage([], []);
    expect(ExtractLaw.hand(player(), iron())).toBeNull();
    const bare = ExtractLaw.hand(player(), wheat())!;
    expect(bare.tool).toBeUndefined();
    expect(bare.rank).toBe(UniversalRank.F);
  });

  it('a better made tool, a skill held on that tool and that material, and a material known each move the roll five a point', () => {
    stage([], [pickOf(UniversalRank.F, 0.15, 'fine')]);
    const plain = ExtractLaw.hand(player(), iron())!;
    expect(plain.band).toBe(4);
    expect(ExtractLaw.points(plain)).toBe(2);
    const pair = WebSystem.pairOfHarvest(player(), iron())!;
    usePlayerStore.setState(s => ({ player: { ...s.player, bank: { ...s.player.bank, universalSkills: { [pair.id]: WebSystem.freshSkill(pair.id, pair.tags, 0) } }, materialMastery: { [iron().id]: { resourceId: iron().id, knowledgeLevel: 2, discoveredAffixes: [] } } } }));
    const skilled = ExtractLaw.hand(player(), iron())!;
    expect(skilled.skill).toBe(1);
    expect(skilled.eye).toBe(2);
    expect(ExtractLaw.points(skilled)).toBe(5);
    const roll = ExtractLaw.roll(player(), iron(), 'k1')!;
    expect(roll.total).toBe(roll.d100 + 5 * LORE_ROLL_PER_POINT);
    expect(roll.outcome).toBe(LoreLaw.outcomeOf(LoreLaw.stretchOf(roll.total - roll.bar + LORE_FAIR_LINE).stretch));
    expect(ExtractLaw.roll(player(), iron(), 'k1')).toEqual(roll);
  });

  it('on the scale: a common thing of one\'s own rank is mostly taken and never spoiled; a rare one two ranks up mostly spoils', () => {
    stage([], [pickOf(UniversalRank.F, 0, 'f')]);
    const tally = (def: ResourceDef) => {
      const out: Record<StudyOutcome, number> = { major_failure: 0, failure: 0, success: 0, major_win: 0 };
      for (let i = 0; i < 2000; i++) out[ExtractLaw.roll(player(), def, `t${i}`)!.outcome]++;
      return out;
    };
    const plain = tally(iron());
    expect(plain.major_failure).toBe(0);
    expect(plain.success + plain.major_win).toBeGreaterThan(1500);
    // Two ranks up and rare, with a rank-F pick: spoiled nearly half the time, taken about one time in five
    const far = tally(silver());
    expect(far.major_failure).toBeGreaterThan(800);
    expect(far.success + far.major_win).toBeLessThan(500);
  });
});

describe('ML: a right click on a place offers study, inspect, and the tool', () => {
  it('three choices, named as the person knows the place: an unknown one by its form', () => {
    stage([place(silver())], [pickOf(UniversalRank.F)]);
    const options = InteractionEngine.getAvailableInteractions(player(), place(silver()), 1);
    expect(options.map(o => o.id.replace(/_ent.*$/, ''))).toEqual(['int_try', 'int_inspect', 'int_studyplace']);
    for (const o of options) expect(o.label.toLowerCase()).not.toContain('silver');
    expect(options[0].label).toMatch(/^Try .* on Unknown Vein$/);
    expect(options[1].label).toBe('Inspect Unknown Vein');
    expect(options[2].label).toBe('Study Unknown Vein');
    expect(options[2].energyCost).toBeGreaterThan(0);
    expect(options[1].energyCost).toBe(0);
  });

  it('with no tool that fits, the try is not offered and the card says why; a hand tries where none is asked', () => {
    stage([place(iron())], []);
    const ids = InteractionEngine.getAvailableInteractions(player(), place(iron()), 1).map(o => o.id);
    expect(ids.some(id => id.startsWith('int_try_'))).toBe(false);
    expect(ids.some(id => id.startsWith('int_inspect_'))).toBe(true);
    const byHand = InteractionEngine.getAvailableInteractions(player(), place(wheat()), 1).find(o => o.id.startsWith('int_try_'))!;
    expect(byHand.label).toBe('Try your hands on Unknown Grain');
  });

  it('a loose stone is still only picked up, with no roll', () => {
    stage([place(pebble())], []);
    const ids = InteractionEngine.getAvailableInteractions(player(), place(pebble()), 1).map(o => o.id);
    expect(ids.some(id => id.startsWith('int_harvest_'))).toBe(true);
    expect(ids.some(id => id.startsWith('int_try_'))).toBe(false);
  });

  it('the interact key\'s first answer on a place is the try', () => {
    stage([place(iron())], [pickOf(UniversalRank.F)]);
    const pick = pickInteract(player(), [place(iron())], { x: 40, z: 40 })!;
    expect(pick.primary?.id.startsWith('int_try_')).toBe(true);
    expect(pick.primary?.type).toBe(InteractionType.HARVEST);
  });
});

describe('ML: the try, in the field', () => {
  const forced = (outcome: StudyOutcome) => vi.spyOn(ExtractLaw, 'roll').mockImplementation((p, def, key) => ({ d100: 50, total: 50, bar: 41, outcome, hand: ExtractLaw.hand(p, def)! }));

  it('a success takes the material away and names it; the place is that much poorer', () => {
    const e = place(iron());
    stage([e], [pickOf(UniversalRank.F)]);
    forced('success');
    usePlayerStore.getState().performInteraction(`int_try_${e.id}`, e.id);
    expect(pack().filter(i => i.universalDefinitionId === iron().id).length).toBeGreaterThan(0);
    expect(live(e.id)!.usesRemaining).toBe((e.usesRemaining ?? 1) - 1);
    expect(WebSystem.knowledgeReader(player())(iron().id)).toBeGreaterThanOrEqual(1);
    expect(player().currentSession!.energy).toBeLessThan(1000);
  });

  it('a major win takes twice what a success does', () => {
    const e = place(iron());
    stage([e], [pickOf(UniversalRank.F)]);
    forced('success');
    usePlayerStore.getState().performInteraction(`int_try_${e.id}`, e.id);
    const once = pack().filter(i => i.universalDefinitionId === iron().id).length;
    expect(once).toBeGreaterThan(0);
    stage([e], [pickOf(UniversalRank.F)]);
    forced('major_win');
    usePlayerStore.getState().performInteraction(`int_try_${e.id}`, e.id);
    expect(pack().filter(i => i.universalDefinitionId === iron().id).length).toBe(once * 2);
  });

  it('a failure wears the tool and leaves the place as it was', () => {
    const e = place(iron());
    const tool = pickOf(UniversalRank.F);
    stage([e], [tool]);
    forced('failure');
    usePlayerStore.getState().performInteraction(`int_try_${e.id}`, e.id);
    const after = pack().find(i => i.id === tool.id)!;
    expect(after.stats.durability).toBeCloseTo(100 - slipWear(100), 6);
    expect(live(e.id)!.usesRemaining).toBe(e.usesRemaining);
    expect(pack().some(i => i.universalDefinitionId === iron().id)).toBe(false);
    expect(fed()).toMatch(/wears/);
  });

  it('a major failure spoils the place until it comes back, and wears the tool', () => {
    const e = place(iron());
    const tool = pickOf(UniversalRank.F);
    stage([e], [tool]);
    forced('major_failure');
    usePlayerStore.getState().performInteraction(`int_try_${e.id}`, e.id);
    expect(useWorldStore.getState().groundRecord!.taken[e.id]).toMatchObject({ left: 0, kind: iron().id });
    expect(live(e.id)!.usesRemaining).toBe(0);
    expect(live(e.id)!.returning).toBeDefined();
    expect(pack().find(i => i.id === tool.id)!.stats.durability).toBeLessThan(100);
    expect(pack().some(i => i.universalDefinitionId === iron().id)).toBe(false);
    expect(fed()).toMatch(/spoil/i);
  });

  it('inspecting says what can be seen of it, in words, and costs nothing', () => {
    const e = place(silver());
    stage([e], [pickOf(UniversalRank.F)]);
    usePlayerStore.getState().performInteraction(`int_inspect_${e.id}`, e.id);
    expect(fed()).toMatch(/Unknown Vein/);
    expect(fed()).toMatch(/notch|knob|spur/);
    expect(fed().toLowerCase()).not.toContain('silver');
    expect(player().currentSession!.energy).toBe(1000);
  });

  it('studying sits with the place, and a sitting that lands well names the material', async () => {
    const e = place(silver());
    stage([e], []);
    StudyDoor.reset();
    usePlayerStore.getState().performInteraction(`int_studyplace_${e.id}`, e.id);
    expect(StudyDoor.sitting()?.target.ref).toBe(e.id);
    vi.spyOn(StudySystem, 'rollSitting').mockReturnValue({ d100: 70, total: 70, dc: 41, outcome: 'success', stretch: 'fair', times: 1 });
    await StudyDoor.finish(playerPort, hubPort);
    StudyDoor.reset();
    expect(WebSystem.knowledgeReader(player())(silver().id)).toBeGreaterThanOrEqual(1);
    expect(fed()).toContain(silver().name);
  });
});

describe('ML: what comes away is drawn as a piece, not as the place', () => {
  it('every form\'s piece has another outline than its place', () => {
    for (const key of ['chaffwheat', 'accrual_berry', 'gall_of_the_ledger', 'vault_stone', 'tally_pebble', 'counting_sand', 'collateral_iron']) {
      const def = byKey(key);
      expect(maskDifference(maskOf(pieceForm(def, 12)), maskOf(worldForm(def, { s: 12 })))).toBeGreaterThan(0.25);
    }
    // A tree stands taller than any piece: what comes away from it is a billet that fits a hand
    const oak = byKey('compound_oak');
    expect(pieceForm(oak, 12).h).toBeLessThan(worldForm(oak).h);
  });

  it('a variant\'s piece wears its marks, so silver taken is told from iron taken by shape', () => {
    const a = pieceForm(iron(), 12, SpreadBook.drawOf(iron().id).marks);
    const b = pieceForm(silver(), 12, SpreadBook.drawOf(silver().id).marks);
    expect(maskDifference(maskOf(a), maskOf(b))).toBeGreaterThan(0.02);
  });
});
