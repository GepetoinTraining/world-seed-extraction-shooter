/**
 * THE TREES (D60, D61, D63): lines 105, 106, 107, registered before the build.
 *
 * No bar here calls a model. The words a model would write are fed in directly, and
 * stand before the same law. Numbers pinned below were read from the commit before
 * this stream (b4f938d): they hold what must not have moved.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { ContentRegistry } from '../src/logic/theme/ContentRegistry';
import { ThemeLaw } from '../src/logic/theme/ThemeLaw';
import { compileTheme, creatureIdOf, sealTheme, themeIdOf } from '../src/logic/theme/ThemeCompiler';
import { creatureNumbers, descendantNumbers } from '../src/logic/theme/ThemeFormula';
import { BIOMES, IThemeBody, LINE_FEATURES, THEME_FORMULA_VERSION, THEME_SCHEMA } from '../src/logic/theme/ThemeTypes';
import { CreatureLines, ILineWords } from '../src/logic/theme/CreatureLines';
import { FIRST_THEME_PACK, installShippedThemes } from '../src/logic/theme/boot';
import { FIRST_THEME } from '../src/entities/generation/packs/firstTheme';
import { WebBank } from '../src/logic/content/WebBank';
import { Director, IDirectorRecord, emptyDirectorRecord } from '../src/entities/world/Director';
import { ISectorState, Population, emptyPopulationRecord } from '../src/entities/world/Population';
import { WorldGenerator } from '../src/entities/world/WorldGenerator';
import { EntityType, IWorldEntity } from '../src/entities/world/types';
import { SECTOR_CHUNKS } from '../src/entities/world/grid';
import { MOB_DEFINITIONS } from '../src/entities/mob/data/mobDefinitions';
import { computeGolden } from '../src/entities/world/goldens';
import { creature, maskDifference, maskOf, planFor, Plan, SIZE_ATOMS } from '../src/render/atoms/atoms';
import { fnv1a } from '../src/logic/rng/DeterministicRNG';
import { AbsentProvider, IntelligenceDoor } from '../server/intelligence/door';
import { buildLineRequest, buildThemeRequest } from '../server/intelligence/prompts';
import { UniversalRank } from '../types';

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const registered = (tag: string) => WebBank.current().tags.some(t => t.tag === tag);
const judge = (body: IThemeBody) => ThemeLaw.validate(body, registered);

installShippedThemes();
const themeId = FIRST_THEME_PACK.themeId;
const WORLD = { seed: 'trees-world', themeId };
const kindOf = (key: string) => creatureIdOf(themeId, key);

const words = (over: Partial<ILineWords> = {}): ILineWords => ({
  name: 'Arrears Hound', blurb: 'It has stopped following debtors home and started waiting there.',
  tags: [], features: ['horns'], innate: [], ...over
});

/** A kind wears people down, regeneration after regeneration, until its order is placed. */
async function pressed(record: IDirectorRecord, id: string, world = WORLD, side: 'FELLED_A_PERSON' | 'FELL' = 'FELLED_A_PERSON'): Promise<IDirectorRecord> {
  let at = record;
  for (let i = 0; i < 200; i++) {
    if (at.lines?.pending.some(o => o.parents.includes(id))) return at;
    const caught = Director.catchUp(Director.report(at, side, id), at.generation + 1);
    at = await CreatureLines.regenerate(caught, world);
  }
  throw new Error(`${id} never changed`);
}

/** One line carried one step: pressed, then the words stand before the law. */
async function descend(record: IDirectorRecord, id: string, over: Partial<ILineWords> = {}, world = WORLD) {
  const at = await pressed(record, id, world);
  const order = at.lines!.pending.find(o => o.parents.includes(id))!;
  const result = await CreatureLines.install(at, order.id, words(over), world);
  expect(result, result.reason).toMatchObject({ ok: true });
  return { record: result.record, id: result.id! };
}

const bodiesIn = (seed: string, record?: IDirectorRecord): IWorldEntity[] => {
  const context = ContentRegistry.contextFor(themeId, UniversalRank.E, record, true);
  const map = WorldGenerator.generate(seed, 16, context);
  const mid = 8 * SECTOR_CHUNKS;
  const bodies: IWorldEntity[] = [];
  for (let y = mid; y < mid + 6; y++) for (let x = mid; x < mid + 6; x++) {
    bodies.push(...(WorldGenerator.chunkAt(map, x, y, context)?.entities ?? []).filter(e => e.type === EntityType.MOB));
  }
  return bodies;
};

describe('line 106: at least two trees in every pack (D63)', () => {
  it('the first theme holds both, and neutral bodies sit in either', () => {
    const trees = new Set(FIRST_THEME.creatures.map(c => c.tree));
    expect(trees).toContain('animal');
    expect(trees).toContain('monster');
    const bear = FIRST_THEME.creatures.find(c => c.key === 'compound_bear')!;
    const auditor = FIRST_THEME.creatures.find(c => c.key === 'auditor_general')!;
    expect(bear.behavior).toBe(auditor.behavior); // a behaviour word cannot say which tree
    expect(bear.tree).toBe('animal');
    expect(auditor.tree).toBe('monster');
  });

  it('every kind of ground has its animals and its monsters', () => {
    for (const biome of BIOMES) for (const tree of ['animal', 'monster']) {
      expect(FIRST_THEME.creatures.some(c => c.tree === tree && c.habitat.includes(biome)), `${tree} on ${biome}`).toBe(true);
    }
  });

  it('it has livestock now, and no animal hunts a person on sight', () => {
    expect(FIRST_THEME.creatures.some(c => c.tags.includes('livestock'))).toBe(true);
    for (const c of FIRST_THEME.creatures.filter(c => c.tree === 'animal')) expect(['PASSIVE', 'NEUTRAL'], c.key).toContain(c.behavior);
  });

  it('where people begin, animals do not crowd out the monsters', () => {
    for (const difficulty of [UniversalRank.E, UniversalRank.D]) {
      const context = ContentRegistry.contextFor(themeId, difficulty);
      const map = WorldGenerator.generate('census', 16, context);
      const mid = 8 * SECTOR_CHUNKS;
      const tally: Record<string, [number, number]> = {};
      for (let y = mid - 16; y < mid + 16; y += 2) for (let x = mid - 16; x < mid + 16; x += 2) {
        const chunk = WorldGenerator.chunkAt(map, x, y, context);
        for (const e of chunk?.entities ?? []) {
          if (e.type !== EntityType.MOB) continue;
          const seen = (tally[chunk!.biome] ??= [0, 0]);
          seen[(MOB_DEFINITIONS[e.definitionId] as any).tree === 'animal' ? 0 : 1]++;
        }
      }
      for (const [biome, [animals, monsters]] of Object.entries(tally)) {
        expect(animals / (animals + monsters), `${biome} at ${difficulty}`).toBeLessThan(0.8);
      }
    }
  });

  it('the law refuses a pack with no animal tree, or no monster tree', () => {
    for (const tree of ['animal', 'monster']) {
      const pack = clone(FIRST_THEME);
      pack.creatures = pack.creatures.filter(c => c.tree !== tree);
      // The rest of the law still has living things to find on each ground
      for (const biome of BIOMES) pack.creatures[0].habitat.includes(biome) || pack.creatures[0].habitat.push(biome);
      const verdict = judge(pack);
      expect(verdict.ok, tree).toBe(false);
      expect(verdict.reason, tree).toMatch(new RegExp(tree));
    }
  });

  it('the law refuses a creature with no tree, or one misspelled', () => {
    const none = clone(FIRST_THEME) as any;
    delete none.creatures[0].tree;
    expect(judge(none).ok).toBe(false);
    const odd = clone(FIRST_THEME);
    odd.creatures[0].tree = 'Not A Word';
    expect(judge(odd).ok).toBe(false);
  });

  it('more trees are welcome', () => {
    const more = clone(FIRST_THEME);
    more.creatures[0].tree = 'vermin';
    more.creatures[1].tree = 'clockwork';
    expect(judge(more)).toEqual({ ok: true });
  });

  it('a compiled kind carries its tree, and a model is told to write one', () => {
    const compiled = compileTheme(FIRST_THEME_PACK);
    expect((compiled.mobs[kindOf('compound_bear')] as any).tree).toBe('animal');
    const properties = (THEME_SCHEMA.properties as any).creatures.items.properties;
    expect(properties.tree).toBeDefined();
    expect(buildThemeRequest([], {}).system).toMatch(/tree/);
  });

  it('old worlds stay pinned: the body they banked is what this one is, less what was added', () => {
    const banked = clone(FIRST_THEME) as IThemeBody;
    banked.creatures = banked.creatures.filter(c => !OLD_KEYS_ABSENT(c.key));
    banked.tags = banked.tags.filter(t => t.kind === 'element');
    delete banked.junk;
    delete banked.anchors;
    banked.abilities = banked.abilities.filter(a => a.effect !== 'forced_exit');
    banked.consumables = banked.consumables.filter(c => c.key !== 'writ_of_breach');
    for (const c of banked.creatures) {
      delete (c as Partial<typeof c>).tree;
      delete (c as Partial<typeof c>).social;
      delete (c as Partial<typeof c>).builds;
      delete (c as Partial<typeof c>).leads;
    }
    expect(themeIdOf(banked)).toBe('theme_f74938c0f7149af9');
    expect(themeIdOf(FIRST_THEME)).not.toBe('theme_f74938c0f7149af9');

    // A pack written before trees stands at the door under the law it was written under
    const old = { ...sealTheme(banked, 'claude-opus-5-5 (dev batch, D53)', 1793491200000), formula: 1 };
    expect(ContentRegistry.install(old)).toEqual({ ok: true });
    expect(ContentRegistry.compiled(old.themeId)).toBeDefined();
    // ...and its land has not moved a byte
    const context = ContentRegistry.contextFor(old.themeId);
    expect(computeGolden('golden-alpha', 16, context)).toBe(3036151310);
    expect(computeGolden('golden-beta', 32, context)).toBe(3482659051);
    expect(computeGolden('dev-sandbox-v4', 32, context)).toBe(772219746);

    // The same body offered anew stands before today's law, and is refused
    expect(judge(banked).ok).toBe(false);
    expect(ContentRegistry.judge(sealTheme({ ...banked, name: 'Written Today' }, 'test', 1)).ok).toBe(false);
  });

  it('a new pack is sealed under the formula that knows about depth', () => {
    expect(THEME_FORMULA_VERSION).toBeGreaterThan(1);
    expect(FIRST_THEME_PACK.formula).toBe(THEME_FORMULA_VERSION);
  });
});

/** What this stream added to the first theme, by key. Nothing else in it moved. */
const OLD_KEYS = ['tally_rat', 'lien_moth', 'dun_hound', 'teller', 'receiver', 'ledger_sentry', 'compound_bear', 'escheat_wraith', 'foreclosure_engine', 'collections_chorus', 'auditor_general'];
const OLD_KEYS_ABSENT = (key: string) => !OLD_KEYS.includes(key);

describe('line 105: a line is a hash graph (D61, D65)', () => {
  const change = { name: 'A', blurb: 'B', tags: [], features: ['horns' as const], innate: [], bands: {} };

  it('an id is a real hash, of the parents and of what changed', async () => {
    const id = await CreatureLines.childId(['mob_a'], change);
    expect(id).toMatch(/^mob_line_[0-9a-f]{64}$/);
    expect(await CreatureLines.childId(['mob_a'], change)).toBe(id);
    expect(await CreatureLines.childId(['mob_b'], change)).not.toBe(id);
    expect(await CreatureLines.childId(['mob_a'], { ...change, name: 'C' })).not.toBe(id);
    expect(await CreatureLines.childId(['mob_a'], { ...change, blurb: 'C' })).not.toBe(id);
    expect(await CreatureLines.childId(['mob_a'], { ...change, features: ['crest'] })).not.toBe(id);
    expect(await CreatureLines.childId(['mob_a'], { ...change, bands: { threat: 'deadly' } })).not.toBe(id);
  });

  it('the order a change was written in does not move its id', async () => {
    const shuffled = Object.fromEntries(Object.entries(change).reverse()) as typeof change;
    expect(await CreatureLines.childId(['mob_a'], shuffled)).toBe(await CreatureLines.childId(['mob_a'], change));
  });

  it('a child of two lines has two parents, and is reached from each', async () => {
    const two = await CreatureLines.childId(['mob_a', 'mob_b'], change);
    expect(two).not.toBe(await CreatureLines.childId(['mob_a'], change));
    expect(two).not.toBe(await CreatureLines.childId(['mob_b', 'mob_a'], change)); // the first parent gives the body

    const a = kindOf('dun_hound'), b = kindOf('tally_rat');
    const start = await pressed(emptyDirectorRecord(), a);
    const order = { ...start.lines!.pending[0], id: 'crossing', parents: [a, b] };
    const crossed: IDirectorRecord = { ...start, lines: { ...start.lines!, pending: [order] } };
    const result = await CreatureLines.install(crossed, 'crossing', words(), WORLD);
    expect(result.ok).toBe(true);
    const node = result.record.lines!.nodes[result.id!];
    expect(node.parents).toEqual([a, b]);
    await CreatureLines.define(result.record, themeId);
    const def = MOB_DEFINITIONS[result.id!] as any;
    expect(def.line.root).toBe(a);
    expect(def.habitat).toEqual(expect.arrayContaining(FIRST_THEME.creatures.find(c => c.key === 'tally_rat')!.habitat));

    const standing = (template: string) => bodiesFor(template, result.record);
    expect(standing(a)).toContain(result.id);
    expect(standing(b)).toContain(result.id);
  });

  /** What a chunk of a parent's own kind comes to stand as, once the record has folded a while. */
  const bodiesFor = (template: string, record: IDirectorRecord) => {
    const context = ContentRegistry.contextFor(themeId, UniversalRank.A, record);
    const ground = `${8 * SECTOR_CHUNKS + 2},${8 * SECTOR_CHUNKS + 2}`;
    let state: ISectorState = { generation: record.generation, ground: { [ground]: { [template]: 40 } }, leaders: {} };
    const ledger = { down: {}, seen: {} };
    for (let i = 0; i < 6; i++) state = Population.step('s', 8, 8, state, ledger, context);
    return new Set(Object.values(state.ground).flatMap(on => Object.keys(on)));
  };

  it('an elder never moves when a descendant appears', async () => {
    const hound = kindOf('dun_hound');
    const elderHash = Array.from(creature(MOB_DEFINITIONS[hound]).data).join();
    const first = await descend(emptyDirectorRecord(), hound);
    const firstNode = clone(first.record.lines!.nodes[first.id]);
    const second = await descend(first.record, first.id, { name: 'Arrears Hound, Second Notice', features: ['spines'] });
    expect(second.record.lines!.nodes[first.id]).toEqual(firstNode);
    expect(await CreatureLines.childId(firstNode.parents, firstNode.change)).toBe(first.id);
    await CreatureLines.define(second.record, themeId);
    expect(Array.from(creature(MOB_DEFINITIONS[hound]).data).join()).toBe(elderHash);
    expect(second.record.lines!.nodes[second.id].parents).toEqual([first.id]);
  });

  it('a first-generation kind keeps its id, and its sprite byte for byte', () => {
    expect(kindOf('dun_hound')).toMatch(/^mob_[0-9a-f]{8}_dun_hound$/);
    const pins: [string[], number][] = [
      [['god'], 1424937925], [['vehicle'], 38789609], [['titan'], 2419527561],
      [['mechanical', 'flying'], 3570596663], [['mechanical'], 991242439], [['flying'], 3931887437],
      [['horror'], 4137151033], [['humanoid'], 1610387853], [['biological'], 1897260635]
    ];
    for (const [tags, pin] of pins) {
      let bytes = '';
      for (const frame of [0, 1]) for (const facing of ['down', 'up', 'left', 'right'] as const) {
        bytes += Array.from(creature({ id: `pin_${tags.join('_')}`, tags, size: 'MEDIUM' }, undefined, { facing, frame }).data).join(',');
      }
      expect(fnv1a(bytes), tags.join('+')).toBe(pin);
    }
  });

  it('a node is a kind, never a body: it names no body and holds no count', async () => {
    const { record, id } = await descend(emptyDirectorRecord(), kindOf('dun_hound'));
    const node = record.lines!.nodes[id];
    expect(Object.keys(node).sort()).toEqual(['bornAt', 'change', 'id', 'parents']);
  });

  it('each regeneration signs a root, and two machines agree on it', async () => {
    const hound = kindOf('dun_hound');
    const a = await descend(emptyDirectorRecord(), hound);
    const b = await descend(clone(emptyDirectorRecord()), hound);
    const rootA = a.record.lines!.roots[a.record.lines!.roots.length - 1];
    const rootB = b.record.lines!.roots[b.record.lines!.roots.length - 1];
    expect(rootA.generation).toBe(a.record.generation);
    expect(rootA.root).toMatch(/^[0-9a-f]{64}$/);
    expect(rootA).toEqual(rootB);
  });

  it('the root moves with the living lines and the cycle, and with nothing else', async () => {
    const living = FIRST_THEME.creatures.map(c => kindOf(c.key));
    const root = await CreatureLines.rootOf('s', 3, living);
    expect(await CreatureLines.rootOf('s', 3, [...living].reverse())).toBe(root);
    expect(await CreatureLines.rootOf('s', 4, living)).not.toBe(root);
    expect(await CreatureLines.rootOf('t', 3, living)).not.toBe(root);
    expect(await CreatureLines.rootOf('s', 3, [...living, 'mob_line_x'])).not.toBe(root);
    expect(await CreatureLines.rootOf('s', 3, living.slice(1))).not.toBe(root);

    const { record, id } = await descend(emptyDirectorRecord(), kindOf('dun_hound'));
    const roots = record.lines!.roots;
    const beforeInstall = await CreatureLines.rootOf(WORLD.seed, record.generation, living);
    expect(roots[roots.length - 1].root).not.toBe(beforeInstall);
    expect(roots[roots.length - 1].root).toBe(await CreatureLines.rootOf(WORLD.seed, record.generation, [...living, id]));
  });

  it('a record altered by hand no longer proves itself', async () => {
    const { record, id } = await descend(emptyDirectorRecord(), kindOf('dun_hound'));
    expect(await CreatureLines.verify(record.lines!)).toEqual([]);
    const altered = clone(record.lines!);
    altered.nodes[id].change.name = 'Somebody Else';
    expect(await CreatureLines.verify(altered)).toEqual([id]);
  });

  it('it is computed at the regeneration and never while a chunk is built', () => {
    for (const file of ['src/entities/world/WorldGenerator.ts', 'src/entities/world/Director.ts']) {
      const text = readFileSync(file, 'utf8');
      expect(text, file).not.toMatch(/sha256|SessionJournal/);
    }
    expect(readFileSync('src/logic/theme/CreatureLines.ts', 'utf8')).toMatch(/sha256Hex/);
    expect(readFileSync('src/logic/theme/CreatureLines.ts', 'utf8')).not.toMatch(/fnv1a/);
  });

  it('with no record a world generates exactly as it did: the hound stays a hound', () => {
    expect(bodiesIn('quiet').map(b => b.definitionId)).toEqual(bodiesIn('quiet', emptyDirectorRecord()).map(b => b.definitionId));
  });
});

describe('line 107: a creature becomes a different monster (D60)', () => {
  describe('code decides when, from the fitness record', () => {
    it('nothing changes in a world where nothing happened', async () => {
      const quiet = await CreatureLines.regenerate(Director.catchUp(emptyDirectorRecord(), 40), WORLD);
      expect(quiet.lines?.pending ?? []).toEqual([]);
    });

    it('what wore people down grows more dangerous', async () => {
      const hound = FIRST_THEME.creatures.find(c => c.key === 'dun_hound')!;
      const at = await pressed(emptyDirectorRecord(), kindOf('dun_hound'));
      const order = at.lines!.pending[0];
      expect(order.pressure).toBe('thriving');
      expect(order.bands.threat).not.toBe(hound.threat);
      expect(order.parents).toEqual([kindOf('dun_hound')]);
    });

    it('what kept falling changes too, at length, and differently', async () => {
      const at = await pressed(emptyDirectorRecord(), kindOf('dun_hound'), WORLD, 'FELL');
      const order = at.lines!.pending[0];
      expect(order.pressure).toBe('hunted');
      expect(at.generation).toBeGreaterThan(3);
      expect(order.bands.threat).toBeUndefined();
    });

    it('the same record and seed decide the same on every machine', async () => {
      const at = Director.catchUp(Director.report(emptyDirectorRecord(), 'FELLED_A_PERSON', kindOf('receiver')), 5);
      expect(CreatureLines.decide(at, 's', FIRST_THEME_PACK)).toEqual(CreatureLines.decide(clone(at), 's', FIRST_THEME_PACK));
    });

    it('a kind does not ask twice for the same pressure', async () => {
      const id = kindOf('dun_hound');
      const at = await pressed(emptyDirectorRecord(), id);
      const again = await CreatureLines.regenerate(Director.catchUp(at, at.generation + 1), WORLD);
      expect(again.lines!.pending.filter(o => o.parents.includes(id))).toHaveLength(1);
    });

    it('a kind that has changed can branch again once the pressure has doubled', async () => {
      const id = kindOf('dun_hound');
      const first = await descend(emptyDirectorRecord(), id);
      const second = await descend(first.record, id, { name: 'Dun Hound, Reassigned', features: ['tail'] });
      expect(second.id).not.toBe(first.id);
      const children = Object.values(second.record.lines!.nodes).filter(n => n.parents.includes(id));
      expect(children).toHaveLength(2);
    });

    it('with no key the change waits: nothing blocks, nothing is lost, the world opens', async () => {
      const door = new IntelligenceDoor(new AbsentProvider());
      const at = await pressed(emptyDirectorRecord(), kindOf('dun_hound'));
      const asks = at.lines!.pending.map(o => CreatureLines.askFor(o, FIRST_THEME_PACK, at.lines!));
      const outcome = await door.fileRest('lines', buildLineRequest(asks, FIRST_THEME_PACK));
      expect(outcome.status).toBe('NO_KEY');
      const later = await CreatureLines.regenerate(Director.catchUp(at, at.generation + 1), WORLD);
      expect(later.lines!.pending.map(o => o.id)).toEqual(at.lines!.pending.map(o => o.id));
      expect(bodiesIn('waits', later).length).toBeGreaterThan(0);
      expect(bodiesIn('waits', later).every(b => !b.definitionId.startsWith('mob_line_'))).toBe(true);
    });
  });

  describe('the model writes only what changed, and the law judges it', () => {
    it('what it is asked for holds no numbers, and the schema has room for none', () => {
      const order = { id: 'o', parents: [kindOf('dun_hound')], pressure: 'thriving' as const, bands: { threat: 'sharp' as const }, generation: 3 };
      const request = buildLineRequest([CreatureLines.askFor(order, FIRST_THEME_PACK, CreatureLines.empty())], FIRST_THEME_PACK);
      expect(request.schema).toBeDefined();
      expect(request.system).toMatch(/never write numbers/i);
      const item = (request.schema as any).properties.lines.items.properties;
      expect(Object.keys(item).sort()).toEqual(['blurb', 'features', 'innate', 'name', 'order', 'tags']);
      for (const feature of LINE_FEATURES) expect(item.features.items.enum).toContain(feature);
      expect(request.messages[0].content).toMatch(/Dun Hound/);
    });

    it('the frozen part of the request holds nothing volatile, so a provider can cache it', () => {
      const asks = (generation: number) => [CreatureLines.askFor(
        { id: `o${generation}`, parents: [kindOf('receiver')], pressure: 'thriving', bands: {}, generation }, FIRST_THEME_PACK, CreatureLines.empty()
      )];
      expect(buildLineRequest(asks(2), FIRST_THEME_PACK).system).toBe(buildLineRequest(asks(9), FIRST_THEME_PACK).system);
    });

    const refused: [string, Partial<ILineWords>][] = [
      ['no name', { name: '  ' }],
      ['no blurb', { blurb: '' }],
      ['the name of what it was', { name: 'Dun Hound' }],
      ['the name of another kind', { name: 'tally rat' }],
      ['a number', { blurb: 5 as unknown as string }],
      ['a tag not in the registry', { tags: ['never_registered_word'] }],
      ['one of a kind, by its own say', { tags: ['god'] }],
      ['elite, by its own say', { tags: ['elite'] }],
      ['no feature to tell it by', { features: [] }],
      ['a shape the art does not draw', { features: ['wings_of_fire' as never] }],
      ['magic this world never wrote', { innate: ['not_an_ability'] }]
    ];
    for (const [what, over] of refused) {
      it(`refuses ${what}, and the order waits`, async () => {
        const at = await pressed(emptyDirectorRecord(), kindOf('dun_hound'));
        const order = at.lines!.pending[0];
        const result = await CreatureLines.install(at, order.id, words(over), WORLD);
        expect(result.ok).toBe(false);
        expect(result.reason).toBeTruthy();
        expect(result.record).toBe(at);
        expect(result.record.lines!.pending[0]).toEqual(order);
        expect(Object.keys(result.record.lines!.nodes)).toEqual([]);
      });
    }

    it('takes what was asked, and nothing that was not', async () => {
      const at = await pressed(emptyDirectorRecord(), kindOf('dun_hound'));
      const result = await CreatureLines.install(at, 'not_an_order', words(), WORLD);
      expect(result.ok).toBe(false);
      expect(result.record).toBe(at);
    });

    it('a batch settles what passes, and what is refused waits for the next window', async () => {
      const a = await pressed(emptyDirectorRecord(), kindOf('dun_hound'));
      const b = await pressed(a, kindOf('receiver'));
      const [oa, ob] = b.lines!.pending;
      const settled = await CreatureLines.settle(b, {
        lines: [{ order: oa.id, ...words() }, { order: ob.id, ...words({ name: '', features: ['crest'] }) }, { order: 'nobody', ...words({ name: 'Stray' }) }]
      }, WORLD);
      expect(settled.installed).toHaveLength(1);
      expect(settled.refused).toHaveLength(2);
      expect(settled.record.lines!.pending.map(o => o.id)).toEqual([ob.id]);
    });

    it('nothing malformed from a model throws', async () => {
      const at = await pressed(emptyDirectorRecord(), kindOf('dun_hound'));
      for (const junk of [undefined, null, 'words', {}, { lines: 'x' }, { lines: [null, 3] }]) {
        const settled = await CreatureLines.settle(at, junk, WORLD);
        expect(settled.installed).toEqual([]);
        expect(settled.record).toBe(at);
      }
    });
  });

  describe('it stands in the world, not in the pack', () => {
    it('numbers come from the formula: bands plus depth', async () => {
      const first = await descend(emptyDirectorRecord(), kindOf('dun_hound'));
      const second = await descend(first.record, first.id, { name: 'Arrears Hound, Second Notice', features: ['spines'] });
      await CreatureLines.define(second.record, themeId);
      const child = MOB_DEFINITIONS[first.id] as any;
      const grandchild = MOB_DEFINITIONS[second.id] as any;
      const hound = FIRST_THEME.creatures.find(c => c.key === 'dun_hound')!;
      expect(child.generation).toBe(2);
      expect(grandchild.generation).toBe(3);
      const order = second.record.lines!.nodes[first.id].change.bands;
      expect(child).toMatchObject(descendantNumbers({ ...hound, ...order }, 2));
      expect(grandchild.baseHealth).toBeGreaterThan(child.baseHealth);
      // The first generation reads the first formula, unchanged
      expect(descendantNumbers(hound, 1)).toEqual(creatureNumbers(hound));
      // R4's fourth fault: a person can always leave, however deep the line
      expect(descendantNumbers({ ...hound, pace: 'swift' }, 40).speed).toBe(creatureNumbers({ ...hound, pace: 'swift' }).speed);
    });

    it('it keeps its tree, and its behaviour', async () => {
      const bear = kindOf('compound_bear');
      const first = await descend(emptyDirectorRecord(), bear, { name: 'Bear In Arrears' });
      await CreatureLines.define(first.record, themeId);
      expect(MOB_DEFINITIONS[first.id]).toMatchObject({ tree: 'animal', behavior: MOB_DEFINITIONS[bear].behavior, rank: MOB_DEFINITIONS[bear].rank });
    });

    it('the pinned pack does not move, and no other world on it sees the change', async () => {
      const bytes = JSON.stringify(ContentRegistry.get(themeId));
      const pool = ContentRegistry.contextFor(themeId).mobDefinitions.map(m => m.id);
      const { record, id } = await descend(emptyDirectorRecord(), kindOf('dun_hound'));
      await CreatureLines.define(record, themeId);
      expect(MOB_DEFINITIONS[id]).toBeDefined();
      expect(JSON.stringify(ContentRegistry.get(themeId))).toBe(bytes);
      expect(ContentRegistry.contextFor(themeId).mobDefinitions.map(m => m.id)).toEqual(pool);
      expect(ContentRegistry.contextFor(undefined).mobDefinitions.map(m => m.id)).not.toContain(id);
      expect(bodiesIn('another-world').every(b => b.definitionId !== id)).toBe(true);
    });

    it('where its parents stand some of it stands, by the count, and the land does not move', async () => {
      // Moved on purpose by B2: Director.kindOf's stand-in sent half of a kind's bodies across at once.
      // A change of form is a share of the count now, cycle by cycle, from the population's record.
      const hound = kindOf('dun_hound');
      const { record, id } = await descend(emptyDirectorRecord(), hound);
      await CreatureLines.define(record, themeId);
      const context = ContentRegistry.contextFor(themeId, UniversalRank.E, record, true);
      const at = record.generation + 10;
      const stood = () => {
        const living = emptyPopulationRecord();
        const bodies: IWorldEntity[] = [];
        const land: IWorldEntity[] = [];
        const mid = 8 * SECTOR_CHUNKS;
        const exits = WorldGenerator.exitsInSector({ seed: 'hound-world' }, 8, 8);
        for (let y = mid; y < mid + SECTOR_CHUNKS; y++) for (let x = mid; x < mid + SECTOR_CHUNKS; x++) {
          const chunk = WorldGenerator.buildChunk('hound-world', exits, x, y, context);
          land.push(...chunk.entities.filter(e => e.type !== EntityType.MOB));
          Population.layOver('hound-world', chunk, living, at, context);
          bodies.push(...chunk.entities.filter(e => e.type === EntityType.MOB));
        }
        return { bodies, land };
      };
      const after = stood();
      expect(after.bodies.filter(b => b.definitionId === id).length).toBeGreaterThan(0);
      expect(after.bodies.filter(b => b.definitionId === hound).length).toBeGreaterThan(0);
      // The same reads the same, and the land under them never moved
      const again = stood();
      expect(again.bodies.map(b => b.definitionId)).toEqual(after.bodies.map(b => b.definitionId));
      expect(again.land).toEqual(after.land);
    });

    it('a regeneration keeps the lines, and the trait chance reads as it did', async () => {
      const { record, id } = await descend(emptyDirectorRecord(), kindOf('dun_hound'));
      const next = Director.catchUp(record, record.generation + 1);
      expect(next.lines!.nodes[id]).toBeDefined();
      const r: IDirectorRecord = { generation: 3, felled: {}, fell: {}, weights: { k: 2 } };
      expect(Director.traitChance(r, 'k')).toBeCloseTo((0.08 + 0.04 * 3) * 2);
      expect(Director.traitChance(r, 'other')).toBeCloseTo(0.08 + 0.04 * 3);
    });
  });

  describe('a name is earned (D60)', () => {
    const POOL = { affixes: [{ id: 'a', name: 'Delinquent', type: 'PREFIX' as const, statModifiers: { damage: [2, 4] as [number, number] } }], abilities: ['x'] };
    const certain: IDirectorRecord = { generation: 50, felled: {}, fell: {}, weights: { c: 100, f: 100 } };

    it('magic alone does not name a first-generation creature', () => {
      const v = Director.variantOf('s', 'b', 'f', 'Dun Hound', certain, POOL, [], 1);
      expect(v.traits.length).toBeGreaterThan(0);
      expect(v.displayName).toBeUndefined();
    });

    it('the change alone does not name it either', () => {
      const plain: IDirectorRecord = { generation: 1, felled: {}, fell: {}, weights: {} };
      const v = Director.variantOf('s', 'b', 'c', 'Arrears Hound', plain, { affixes: [], abilities: [] }, [], 2);
      expect(v.displayName).toBeUndefined();
    });

    it('the change and magic together do, in its own words', () => {
      const v = Director.variantOf('s', 'b', 'c', 'Arrears Hound', certain, POOL, [], 2);
      expect(v.displayName).toBe('Delinquent Arrears Hound');
    });

    it('one of a kind, once changed, is named without magic', async () => {
      const { record, id } = await descend(emptyDirectorRecord(), kindOf('auditor_general'), { name: 'The Auditor Emeritus' });
      await CreatureLines.define(record, themeId);
      const def = MOB_DEFINITIONS[id] as any;
      expect(def.tags).toContain('god');
      const v = Director.variantOf('s', 'b', id, def.name, record, { affixes: [], abilities: [] }, def.tags, def.generation);
      expect(v.displayName).toBe('The Auditor Emeritus');
    });
  });

  describe('the sprite inherits by shape', () => {
    const plans: [Plan, string[]][] = [
      ['ring', ['god']], ['tracks', ['vehicle']], ['spikes', ['titan']], ['rotor', ['mechanical', 'flying']], ['hull', ['mechanical']],
      ['wings', ['flying']], ['tendril', ['horror']], ['biped', ['humanoid']], ['swarm', ['biological']], ['grazer', ['livestock']]
    ];
    const child = (id: string, tags: string[], features: string[], extra: string[] = []) => ({
      id: `line_of_${id}`, tags: [...tags, ...extra], size: 'MEDIUM', line: { root: id, rootTags: tags, features }
    });
    const FACINGS = ['down', 'up', 'left', 'right'] as const;

    it('every plan has a tag that reads it', () => {
      for (const [plan, tags] of plans) expect(planFor(tags)).toBe(plan);
    });

    it('every feature is seen on every body, at every size a creature comes in, from every side', () => {
      for (const [plan, tags] of plans) for (const feature of LINE_FEATURES) {
        const parent = { id: `p_${plan}`, tags, size: 'MEDIUM' };
        for (const size of Object.values(SIZE_ATOMS)) for (const facing of FACINGS) {
          const a = maskOf(creature(parent, size, { facing }));
          const b = maskOf(creature(child(parent.id, tags, [feature]), size, { facing }));
          expect(maskDifference(a, b), `${plan} ${feature} ${size} ${facing}`).toBeGreaterThanOrEqual(0.04);
        }
      }
    });

    it('it stays its parent: the child is nearer its own parent than any other body', () => {
      for (const [plan, tags] of plans) {
        const parent = { id: `p_${plan}`, tags, size: 'MEDIUM' };
        const mask = maskOf(creature(child(parent.id, tags, ['horns', 'tail'])));
        const own = maskDifference(mask, maskOf(creature(parent)));
        for (const [other, otherTags] of plans) {
          if (other === plan) continue;
          const d = maskDifference(mask, maskOf(creature({ id: `p_${other}`, tags: otherTags, size: 'MEDIUM' })));
          expect(own, `${plan} against ${other}`).toBeLessThan(d);
        }
      }
    });

    it('a feature adds to the body and does not eat it: only the fullest bodies give up atoms for a seam', () => {
      // Found by eye: the first cut shredded thin bodies, and the bars above still passed
      const dense = new Set<Plan>(['tracks', 'spikes']);
      for (const [plan, tags] of plans) for (const feature of LINE_FEATURES) {
        const parent = maskOf(creature({ id: `p_${plan}`, tags, size: 'MEDIUM' }, 32));
        const changed = maskOf(creature(child(`p_${plan}`, tags, [feature]), 32));
        let on = 0, kept = 0;
        parent.forEach((v, i) => { if (v) { on++; if (changed[i]) kept++; } });
        expect(kept / on, `${plan} ${feature}`).toBeGreaterThanOrEqual(dense.has(plan) ? 0.5 : 0.75);
      }
    });

    it('a tag the change added does not change the body plan or the grain', () => {
      const a = creature(child('p', ['humanoid'], ['horns']));
      const b = creature(child('p', ['humanoid'], ['horns'], ['flying', 'horror']));
      expect(Array.from(b.data)).toEqual(Array.from(a.data));
    });

    it('features gather down a line: each step adds to the last', () => {
      const tags = ['biological'];
      const steps = [[], ['horns'], ['horns', 'tail'], ['horns', 'tail', 'spines'], ['horns', 'tail', 'spines', 'horns']];
      const masks = steps.map(f => maskOf(creature(f.length ? child('p', tags, f) : { id: 'p', tags, size: 'MEDIUM' })));
      for (let i = 1; i < masks.length; i++) expect(maskDifference(masks[i - 1], masks[i]), `${steps[i]}`).toBeGreaterThan(0);
    });

    it('it is shape, never hue: the child draws from the parent\'s own ink', () => {
      const parent = { id: 'p', tags: ['humanoid'], size: 'MEDIUM' };
      const palette = (s: { data: Uint8Array }) => new Set(s.data);
      const fromParent = palette(creature(parent, 32));
      for (const feature of LINE_FEATURES) {
        for (const value of palette(creature(child('p', ['humanoid'], [feature]), 32))) expect(fromParent, feature).toContain(value);
      }
    });

    it('a new plan moves like the others: a body has a front, a back, sides and a step', () => {
      const grazer = { id: 'g', tags: ['livestock'], size: 'MEDIUM' };
      const hashes = new Set(FACINGS.map(facing => fnv1a(Array.from(creature(grazer, undefined, { facing }).data).join())));
      expect(hashes.size).toBe(4);
      expect(maskDifference(maskOf(creature(grazer, undefined, { frame: 0 })), maskOf(creature(grazer, undefined, { frame: 1 })))).toBeGreaterThan(0.04);
    });

    it('the shipped animals draw, and nothing about them needs an image', () => {
      for (const c of FIRST_THEME.creatures.filter(c => c.tree === 'animal')) {
        expect(creature(MOB_DEFINITIONS[kindOf(c.key)]).w, c.key).toBeGreaterThan(0);
      }
    });
  });
});
