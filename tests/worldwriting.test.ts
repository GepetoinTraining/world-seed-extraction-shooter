/**
 * Q1: a world is written in passes, in a world's own order, from what the pool holds:
 * pulled by meaning, selected by id, then added to. Every bar here runs with no key, on
 * a door that answers from a script, and nothing is spent.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { ContentRegistry } from '../shared/logic/theme/ContentRegistry';
import { FIRST_THEME_PACK } from '../shared/logic/theme/boot';
import { ThemeLaw } from '../shared/logic/theme/ThemeLaw';
import { BIOMES, IThemeBody, THEME_SCHEMA } from '../shared/logic/theme/ThemeTypes';
import { sealTheme } from '../shared/logic/theme/ThemeCompiler';
import { WebBank } from '../shared/logic/content/WebBank';
import { HASHED_EMBEDDER, IEmbedder } from '../shared/services/EmbeddingService';
import { CountedPull, poolOf, ruledOut, standsOnRuledOut } from '../shared/logic/theme/writing/WorldPool';
import { concentration, concentrationResiduals, CountedEmbedder, fieldAffinity, fieldCounts, logOddsZ } from '../shared/logic/theme/writing/Counting';
import { cosineSimilarity } from '../shared/entities/data/similarity';
import { PASS_SCHEMAS, SCHEMA_LIMITS, WORLD_PASSES, WorldPassId, schemaShape } from '../shared/logic/theme/writing/WorldPasses';
import { IPassAsk, IPassOutcome, PassDoor, temperOf, writeWorld } from '../src/logic/theme/writing/WorldWriter';
import { TerrainSystem, TerrainType } from '../shared/entities/world/TerrainSystem';
import { TerrainCrossing } from '../src/logic/theme/TerrainCrossing';
import { TagLaw } from '../shared/logic/content/TagLaw';
import { CHAIN_PARTS, CHAIN_SCHEMA, buildChainRequest, buildWorldPassRequest } from '../shared/intelligence/prompts';
import { askChainInParts } from '../shared/intelligence/parts';
import type { IDoorRequest } from '../shared/intelligence/door';
import { WEB_BATCHES } from '../shared/entities/generation/packs/webBatches';

const registered = (tag: string) => WebBank.current().tags.some(t => t.tag === tag && !t.retired);
/** The registry as it ships, read before any test registers a world's words. */
const SHIPPED_WORDS = new Set(WEB_BATCHES.flatMap(b => (b.tags ?? []).filter(t => !t.retired).map(t => t.tag)));

beforeAll(() => {
  expect(ContentRegistry.install(FIRST_THEME_PACK).ok).toBe(true);
});

/** What the split trial got through: world, creatures and materials, asked as one part (Q1's entry). */
const TRIAL_PART_ONE = (() => {
  const p = THEME_SCHEMA.properties as Record<string, unknown>;
  const keys = ['name', 'premise', 'regions', 'tags', 'creatures', 'materials'];
  return { type: 'object', additionalProperties: false, required: keys, properties: Object.fromEntries(keys.map(k => [k, p[k]])) };
})();

describe('every ask compiles on its own', () => {
  const reference = schemaShape(TRIAL_PART_ONE).weight;

  it('the whole theme was over what compiled; the trial part one is the measure', () => {
    expect(schemaShape(THEME_SCHEMA).weight).toBeGreaterThan(reference);
  });

  it('each pass of a world is within the published limits and smaller than what compiled', () => {
    for (const pass of WORLD_PASSES) {
      const shape = schemaShape(PASS_SCHEMAS[pass]);
      expect(shape.optional, pass).toBe(0);
      expect(shape.unions, pass).toBe(0);
      expect(shape.optional).toBeLessThanOrEqual(SCHEMA_LIMITS.optionalParameters);
      expect(shape.weight, pass).toBeLessThan(reference);
    }
  });

  it('the mint asks a world in passes: no request carries the whole theme', () => {
    for (const pass of WORLD_PASSES) {
      const request = buildWorldPassRequest(pass, { pass }, { size: 16 });
      expect(request.schema).toBe(PASS_SCHEMAS[pass]);
      expect(request.schema).not.toBe(THEME_SCHEMA);
    }
  });

  it('a pass is told the earlier passes in its message, and the system text is one for all, so they share a cache', () => {
    const a = buildWorldPassRequest('ground', { said: 'a moon' }, {});
    const b = buildWorldPassRequest('fauna', { said: 'a moon', world: { name: 'X' } }, {});
    expect(a.system).toBe(b.system);
    expect(b.messages[0].content).toContain('"world"');
  });

  it('a chain round goes in two parts, each smaller than what compiled, that cover the whole round', () => {
    const ask = { person: {}, ground: {}, written: {}, open: [] };
    const parts = CHAIN_PARTS.map((_, i) => buildChainRequest(ask, i));
    for (const r of parts) {
      expect(r.schema).not.toBe(CHAIN_SCHEMA);
      expect(schemaShape(r.schema).weight).toBeLessThan(schemaShape(CHAIN_SCHEMA).weight);
      expect(schemaShape(r.schema).optional).toBe(0);
    }
    const covered = new Set(parts.flatMap(r => Object.keys((r.schema as { properties: object }).properties)));
    expect([...covered].sort()).toEqual(Object.keys(CHAIN_SCHEMA.properties as object).sort());
  });

  it('nothing a pass asks is a number: no integer or number field in any schema', () => {
    const numeric = (node: unknown): boolean => {
      if (!node || typeof node !== 'object') return false;
      const n = node as Record<string, unknown>;
      if (n.type === 'integer' || n.type === 'number') return true;
      return Object.values(n).some(v => (Array.isArray(v) ? v.some(numeric) : numeric(v)));
    };
    for (const pass of WORLD_PASSES) expect(numeric(PASS_SCHEMAS[pass]), pass).toBe(false);
  });
});

describe('the chain, joined from its parts', () => {
  it('two asks, the second told the first, joined into one round; a closed door is an outcome', async () => {
    const seen: IDoorRequest[] = [];
    const door = {
      ask: async (r: IDoorRequest) => {
        seen.push(r);
        return seen.length === 1
          ? { status: 'OK' as const, data: { tags: [{ tag: 'a' }], materials: [{ key: 'm' }], stations: [] }, usage: { model: 'x', inputTokens: 1, outputTokens: 2, cacheReadTokens: 0, usd: 0.01 } }
          : { status: 'OK' as const, data: { tags: [], goods: [{ key: 'g' }], gear: [] }, usage: { model: 'x', inputTokens: 1, outputTokens: 2, cacheReadTokens: 0, usd: 0.02 } };
      }
    };
    const out = await askChainInParts(door, { person: {}, ground: {}, written: {}, open: [] });
    expect(seen.length).toBe(2);
    expect(seen[1].messages[0].content).toContain('"key":"m"');
    expect(out.status).toBe('OK');
    expect(out.data).toEqual({ tags: [{ tag: 'a' }], materials: [{ key: 'm' }], stations: [], goods: [{ key: 'g' }], gear: [] });
    expect(out.usage!.usd).toBeCloseTo(0.03);

    const closed = await askChainInParts({ ask: async () => ({ status: 'NO_KEY' as const }) }, { person: {}, ground: {}, written: {}, open: [] });
    expect(closed.status).toBe('NO_KEY');
  });
});

describe('the pool', () => {
  it('holds every list a world is written from; a thing two worlds hold word for word is one entry, counted in both', () => {
    const copy = sealTheme({ ...FIRST_THEME_PACK, name: 'A later world' }, 'test', FIRST_THEME_PACK.writtenAt + 1);
    const once = poolOf([FIRST_THEME_PACK]);
    const twice = poolOf([FIRST_THEME_PACK, copy]);
    expect(twice.length).toBe(once.length);
    expect(twice.every(e => e.fields.length === 2)).toBe(true);
    const lists = new Set(once.map(e => e.list));
    for (const l of ['flora', 'fauna', 'professions', 'minerals', 'junk', 'anchors', 'gear', 'goods', 'stations', 'consumables', 'abilities', 'affixes']) {
      expect(lists.has(l as never), l).toBe(true);
    }
    expect(once.find(e => e.key === 'compound_oak')!.list).toBe('flora');
    expect(once.find(e => e.key === 'vault_stone')!.list).toBe('minerals');
  });

  it('fauna is one field: animals and monsters are one list, and one search returns both', async () => {
    const pool = poolOf([FIRST_THEME_PACK]);
    expect(pool.find(e => e.key === 'dividend_hen')!.list).toBe('fauna');
    expect(pool.find(e => e.key === 'tally_rat')!.list).toBe('fauna');
    const found = await new CountedPull(pool).near('fauna', 'a bank gone wild');
    const trees = new Set(found.map(e => (e.entry as { tree: string }).tree));
    expect(trees.has('animal') && trees.has('monster')).toBe(true);
  });

  it('the world rules things out: a world without trees is never offered a tree', async () => {
    const pull = new CountedPull(poolOf([FIRST_THEME_PACK]));
    const all = await pull.near('flora', 'a field of grain and an old oak');
    const without = await pull.near('flora', 'a field of grain and an old oak', ['trees']);
    expect(all.some(e => e.key === 'compound_oak')).toBe(true);
    expect(without.some(e => e.key === 'compound_oak')).toBe(false);
    expect(ruledOut({ text: 'Compound Oak tree wood' }, ['trees'])).toBe(true);
  });

  it('what is offered is what scores above its list\'s own mean, never a fixed count', async () => {
    const pull = new CountedPull(poolOf([FIRST_THEME_PACK]));
    const all = await pull.near('gear', 'a clerk with a blade and a visor');
    const offered = await pull.offer('gear', 'a clerk with a blade and a visor');
    expect(offered.length).toBeGreaterThan(0);
    expect(offered.length).toBeLessThan(all.length);
    expect(offered).toEqual(all.slice(0, offered.length));
  });

  it('the pull takes whatever embedder fills the seam', async () => {
    const sense: Record<string, number> = { hen: 1, egg: 1, eggs: 1, lays: 1 };
    const fake: IEmbedder = {
      id: 'fake-meaning:v1', dims: 2,
      embed: async texts => texts.map(t => {
        const v = [0, 0];
        for (const w of t.toLowerCase().split(/[^a-z]+/)) if (w in sense) v[sense[w]] += 1;
        return v;
      })
    };
    const byMeaning = await new CountedPull(poolOf([FIRST_THEME_PACK]), fake).near('fauna', 'something that lays eggs');
    expect(byMeaning[0].key).toBe('dividend_hen');
  });
});

describe('counting, not a model', () => {
  // The case Q1 named: "an airless moon" would not find "vacuum", because no word is shared
  const corpus = ['vacuum regolith crater cold', 'airless regolith crater dark', 'hen egg barn straw', 'cow barn straw milk'];

  it('two words that keep the same company are near, though they never meet; the bag of words reads them as strangers', async () => {
    const counted = CountedEmbedder.of(corpus);
    const [vacuum, airless, hen] = await counted.embed(['vacuum', 'airless', 'hen']);
    const [hv, ha] = await HASHED_EMBEDDER.embed(['vacuum', 'airless']);
    expect(cosineSimilarity(hv, ha)).toBe(0);
    // The two channels weigh alike: no shared word, so all of this is the counted half
    expect(cosineSimilarity(vacuum, airless)).toBeGreaterThan(0.1);
    expect(cosineSimilarity(vacuum, hen)).toBe(0);
  });

  it('the same pool counts the same; a pool that grows is a new space, by its id', async () => {
    const a = CountedEmbedder.of(corpus);
    const b = CountedEmbedder.of(corpus);
    const c = CountedEmbedder.of([...corpus, 'moth static dust']);
    expect(b.id).toBe(a.id);
    expect(await b.embed(['regolith crater'])).toEqual(await a.embed(['regolith crater']));
    expect(c.id).not.toBe(a.id);
  });

  it('log-odds with the Dirichlet prior is the export\'s formula, and a word locked to a field is distinctive', () => {
    // rig/export-data-v2.py, by hand: y1=8 of n1=100 in the field, y2=2 of n2=900 elsewhere, a0=0.01
    const aw = 0.01 * 10, A = 0.01 * 1000;
    const delta = Math.log((8 + aw) / (100 + A - 8 - aw)) - Math.log((2 + aw) / (900 + A - 2 - aw));
    expect(logOddsZ(8, 100, 2, 900, 10, 1000)).toBeCloseTo(delta / Math.sqrt(1 / (8 + aw) + 1 / (2 + aw)), 10);
    expect(logOddsZ(8, 100, 2, 900, 10, 1000)).toBeGreaterThan(0);
    expect(logOddsZ(1, 100, 81, 900, 82, 1000)).toBeLessThan(0);
  });

  it('a theme leans to the fields whose distinctive words it uses; with one field, nothing leans', () => {
    const fields = fieldCounts([
      { field: 'moon', texts: ['vacuum regolith crater', 'regolith dust crater'] },
      { field: 'farm', texts: ['hen egg barn', 'cow barn straw'] }
    ]);
    const lean = fieldAffinity('a crater full of regolith', fields);
    expect(lean.get('moon')!).toBeGreaterThan(lean.get('farm')!);
    expect(fieldAffinity('anything', fieldCounts([{ field: 'only', texts: ['a b'] }])).get('only')).toBe(1);
  });

  it('concentration is one where a thing is locked to one field, zero where it is everywhere, and read as its residual', () => {
    expect(concentration([3, 0, 0])).toBeCloseTo(1);
    expect(concentration([2, 2, 2])).toBeCloseTo(0);
    // Seen once, it is concentrated by rarity alone: the residual says nothing of it
    const r = concentrationResiduals([[1, 0, 0], [0, 1, 0], [2, 0, 0], [1, 1, 0]]);
    expect(r[0]).toBeCloseTo(0);
    expect(r[1]).toBeCloseTo(0);
    expect(r[2]).toBeGreaterThan(r[3]);
  });
});

// -------------------------------------------------------------------------
// A whole world, on a door that answers from a script
// -------------------------------------------------------------------------

const idOf = (ask: IPassAsk, list: string, key: string) => ask.offered[list]?.find(o => o.id.endsWith(`.${list}.${key}`))?.id;
const first = (ask: IPassAsk, list: string, skip = 0) => ask.offered[list]?.[skip]?.id;
const ALL = [...BIOMES];

const MORE_PREFIXES = ['Dusk', 'Ember', 'Frost', 'Lumen', 'Marrow', 'Nettle', 'Quill', 'Rust', 'Sable', 'Tallow', 'Umber', 'Vesper', 'Wick', 'Yarrow'];
const MORE_SUFFIXES = ['fall', 'reach', 'mere', 'hold', 'wane', 'spire', 'hollow', 'vale'];

/** What a model might answer for an airless moon, pass by pass. It picks from what was offered. */
function scriptedDoor(overrides: Partial<Record<WorldPassId, (ask: IPassAsk, n: number) => unknown>> = {}): { door: PassDoor; asks: IPassAsk[] } {
  const asks: IPassAsk[] = [];
  const counts: Record<string, number> = {};
  const answers: Record<WorldPassId, (ask: IPassAsk) => unknown> = {
    ground: () => ({
      premise: 'A moon with no air, where a bank still keeps its hours.',
      regions: BIOMES.map(b => ({ biome: b, blurb: `The ${b.toLowerCase()} side: gray, and still.` })),
      without: ['trees'], prefixes: ['Gray', 'Hollow', 'Still', 'Pale'], suffixes: ['crawler', 'moth', 'glass', 'drift'],
      words: [{ tag: 'vacuum', kind: 'descriptive', meaning: 'No air at all.' }, { tag: 'climb', kind: 'action', meaning: 'Getting up and over sheer ground.' }]
    }),
    terrain: () => ({
      impassable: { pick: '', ground: 'tunnels', blurb: 'Old bores that drop into nothing.', crossing: '' },
      skilled: { pick: '', ground: 'a dark-side crater', blurb: 'Its rim is sheer and cold.', crossing: { tag: 'climb', kind: 'action', meaning: 'Getting up and over sheer ground.' } },
      words: []
    }),
    flora: ask => ({
      picked: [{ id: first(ask, 'flora'), regions: ['WASTELAND'] }].filter(p => p.id),
      flora: [{ is: 'a gray lichen that eats starlight', form: 'shrub', tags: [], regions: ['WASTELAND', 'OVERGROWTH'] }],
      words: []
    }),
    fauna: ask => ({
      picked: [{ id: first(ask, 'fauna'), regions: ['RUINS'] }].filter(p => p.id),
      // A thing the pool holds, by its plain name: it is taken from the pool, never written again
      fauna: [
        { is: 'Pension Ox', tags: ['vacuum'], social: false, builds: false, regions: ['INDUSTRIAL'] },
        { is: 'a pale moth that drinks static', tags: ['vacuum'], social: true, builds: false, regions: ['WASTELAND', 'RUINS'] },
        { is: 'a hollow crawler that hunts by the shake of the ground', tags: ['vacuum'], social: true, builds: true, regions: ['CYBER_CITY', 'RUINS'] },
        { is: 'a glass hound that runs the rim', tags: ['vacuum'], social: true, builds: false, regions: ['INDUSTRIAL', 'OVERGROWTH'] }
      ],
      words: []
    }),
    people: ask => ({
      picked: [first(ask, 'professions')].filter(Boolean),
      professions: [{ is: 'can seal a breach in a suit before the air goes', concept: 'seal_breach', workshop: 'the patch bay', tool: ['blunt'], material: ['metal'] }],
      words: []
    }),
    holds: ask => ({
      picked: [{ id: first(ask, 'minerals'), regions: ['RUINS'] }, { id: first(ask, 'anchors'), regions: ['RUINS'] }].filter(p => p.id),
      minerals: [{ is: 'regolith that packs hard when wet with nothing', form: 'sand', tags: ['building'], regions: ['WASTELAND', 'CYBER_CITY'] }],
      junk: [{ is: 'a husk that crackles', tags: [], from: ['vacuum'] }],
      anchors: [],
      words: []
    }),
    made: ask => ({ picked: [first(ask, 'gear'), first(ask, 'gear', 1)].filter(Boolean) }),
    known: () => ({ picked: [], lore: ['The moon kept the bank\'s hours long after the bank was gone.'] }),
    // C16: what the pool could not give, added in the one list the need names
    lack: ask => ({
      fauna: ask.lack!.list === 'fauna' ? [{ is: 'a slow gray grazer', tags: ['vacuum'], social: true, builds: false, regions: ['RUINS'] }] : [],
      materials: ask.lack!.list === 'materials' ? [{ is: 'packed regolith blocks', form: 'rock', tags: [], regions: ['RUINS'] }] : [],
      anchors: ask.lack!.list === 'anchors' ? [{ is: 'a bank seal of old silver', tags: [], regions: ['RUINS'] }] : [],
      gear: ask.lack!.list === 'gear' ? [{ is: 'boots of wrapped suit cloth', kind: ask.lack!.kinds![0] }] : [],
      words: []
    }),
    // C21: the names ran out, and the world writes more pieces in its own sound, never ones it has
    names: ask => {
      const has = new Set([...ask.names!.prefixes, ...ask.names!.suffixes].map(p => p.toLowerCase()));
      const fresh = (xs: string[]) => xs.filter(x => !has.has(x.toLowerCase())).slice(0, 2);
      return { prefixes: fresh(MORE_PREFIXES), suffixes: fresh(MORE_SUFFIXES) };
    }
  };
  const door: PassDoor = async (pass, ask) => {
    asks.push(ask);
    counts[pass] = (counts[pass] ?? 0) + 1;
    const answer = overrides[pass] ? overrides[pass]!(ask, counts[pass]) : answers[pass](ask);
    return { status: 'OK', data: answer, usage: { model: 'fake', inputTokens: 10, outputTokens: 20, usd: 0.001 } } as IPassOutcome;
  };
  return { door, asks };
}

const write = (door: PassDoor, seed = 'moon') => writeWorld('An airless moon. The bank never closed.', {
  door, pull: new CountedPull(poolOf([FIRST_THEME_PACK])), packs: [FIRST_THEME_PACK], registered, seed, difficulty: 'D'
});

const sourceOf = (key: string) => [...FIRST_THEME_PACK.creatures, ...FIRST_THEME_PACK.materials].find(x => x.key === key)!;
const pooled = (id: string) => poolOf([FIRST_THEME_PACK]).find(e => e.id === id)!;

describe('a world, written in passes', () => {
  it('asks in a world\'s own order, each pass given what the earlier passes made', async () => {
    const { door, asks } = scriptedDoor();
    const out = await write(door);
    expect(asks.map(a => a.pass)).toEqual([...WORLD_PASSES]);
    expect(asks[0].offered).toEqual({});
    const fauna = asks.find(a => a.pass === 'fauna')!;
    expect((fauna.world.terrain as string[]).join(' ')).toContain('dark-side crater');
    expect(fauna.words).toContain('vacuum');
    expect(out.ok).toBe(true);
  });

  it('what comes out stands before the same law as any pack, and the registry takes it', async () => {
    const out = await write(scriptedDoor().door);
    if (!out.ok) throw new Error(out.reason);
    expect(ThemeLaw.validate(out.body, t => registered(t) || out.body.tags.some(w => w.tag === t))).toEqual({ ok: true });
    expect(ContentRegistry.judge(out.body)).toEqual({ ok: true });
  });

  it('a picked thing is the same thing, word for word: an oak is an oak', async () => {
    const { door, asks } = scriptedDoor();
    const out = await write(door);
    if (!out.ok) throw new Error(out.reason);
    const pickedId = asks.find(a => a.pass === 'fauna')!.offered.fauna[0].id;
    const source = pooled(pickedId).entry as unknown as IThemeBody['creatures'][number];
    const held = out.body.creatures.filter(c => c.name === source.name);
    expect(held.length).toBe(1);
    const { habitat: _h, key: _k, ...heldWords } = held[0];
    const { habitat: _s, key: _sk, ...sourceWords } = source;
    expect(heldWords).toEqual(sourceWords);
    expect(held[0].habitat).toEqual(['RUINS']);
  });

  it('a thing the model adds that the pool already holds is taken from the pool, not written again', async () => {
    const out = await write(scriptedDoor().door);
    if (!out.ok) throw new Error(out.reason);
    const oxen = out.body.creatures.filter(c => c.name === 'Pension Ox');
    expect(oxen.length).toBe(1);
    expect(oxen[0].blurb).toBe((sourceOf('pension_ox') as { blurb: string }).blurb);
  });

  it('the world rules things out: no tree is offered, and adding one is refused, then asked again', async () => {
    const { door, asks } = scriptedDoor({
      flora: (ask, n) => ({
        picked: [],
        flora: n === 1 ? [{ is: 'a tall gray tree', form: 'tree', tags: [], regions: ALL }] : [{ is: 'a gray lichen that eats starlight', form: 'shrub', tags: [], regions: ALL }],
        words: []
      })
    });
    const out = await write(door);
    expect(out.ok).toBe(true);
    const lifeAsks = asks.filter(a => a.pass === 'flora');
    expect(lifeAsks[0].offered.flora.some(o => o.id.endsWith('.compound_oak'))).toBe(false);
    expect(lifeAsks.length).toBe(2);
    expect(lifeAsks[1].refused).toContain('without');
    if (out.ok) expect(out.body.materials.some(m => m.form === 'tree')).toBe(false);
  });

  it('names come from the world\'s own prefixes and suffixes; the model names nothing', async () => {
    const out = await write(scriptedDoor().door);
    if (!out.ok) throw new Error(out.reason);
    const pool = new Set(poolOf([FIRST_THEME_PACK]).map(e => String(e.entry.name)));
    const added = [...out.body.creatures, ...out.body.materials, ...(out.body.professions ?? []), ...out.body.junk!].filter(x => !pool.has(x.name));
    expect(added.length).toBeGreaterThan(4);
    const own = /^(Gray|Hollow|Still|Pale)( (Gray|Hollow|Still|Pale))?(crawler|moth|glass|drift)$/;
    for (const x of added) expect(x.name, x.name).toMatch(own);
    // C17: the world and every kind of its ground are named from the same lists
    for (const name of [out.body.name, ...out.body.regions.map(r => r.name)]) expect(name, name).toMatch(own);
    const all = [...added.map(x => x.name), out.body.name, ...out.body.regions.map(r => r.name)];
    expect(new Set(all).size).toBe(all.length);
    expect(added.find(x => x.blurb === 'a hollow crawler that hunts by the shake of the ground')).toBeDefined();
  });

  it('every band is rolled by code from the seed: the same seed writes the same world, another seed rolls again', async () => {
    const a = await write(scriptedDoor().door, 'moon');
    const b = await write(scriptedDoor().door, 'moon');
    const c = await write(scriptedDoor().door, 'another moon');
    if (!a.ok || !b.ok || !c.ok) throw new Error('refused');
    expect(b.body).toEqual(a.body);
    const bands = (x: IThemeBody) => x.creatures.map(k => `${k.rank}${k.size}${k.build}${k.threat}${k.pace}${k.behavior}`).join('|');
    expect(bands(c.body)).not.toEqual(bands(a.body));
  });

  it('the terrain is two roles, dressed by the world, and a held climbing skill crosses the skilled one', async () => {
    const out = await write(scriptedDoor().door);
    if (!out.ok) throw new Error(out.reason);
    expect(out.body.terrain).toEqual([
      { role: 'impassable', ground: 'tunnels', blurb: 'Old bores that drop into nothing.', crossing: '' },
      { role: 'skilled', ground: 'a dark-side crater', blurb: 'Its rim is sheer and cold.', crossing: 'climb' }
    ]);
    const climber = { skillWords: { [TagLaw.skillIdOf(['climb', 'stone'])]: { name: 'Rimwalking', flavor: '', grants: [] } } };
    expect(TerrainCrossing.crossesSkilled(climber, out.body)).toBe(true);
    expect(TerrainCrossing.crossesSkilled({ skillWords: {} }, out.body)).toBe(false);
    expect(TerrainCrossing.crossesSkilled(climber, FIRST_THEME_PACK)).toBe(false);
  });

  it('fauna is one field: which new kind is a monster is its rolled aggression, never the model\'s word', async () => {
    const out = await write(scriptedDoor().door);
    if (!out.ok) throw new Error(out.reason);
    const pool = new Set(FIRST_THEME_PACK.creatures.map(c => c.name));
    const fresh = out.body.creatures.filter(c => !pool.has(c.name) && !c.leads);
    expect(fresh.length).toBeGreaterThan(1);
    for (const c of fresh) expect(c.tree, c.name).toBe(temperOf(c.threat).tree);
    expect(out.body.creatures.some(c => c.tree === 'animal') && out.body.creatures.some(c => c.tree === 'monster')).toBe(true);
    for (const c of out.body.creatures.filter(x => x.tree === 'animal')) expect(c.builds).toBe(false);
  });

  it('code decides who leads, and fills what the law asks of any world from the pool', async () => {
    const out = await write(scriptedDoor().door);
    if (!out.ok) throw new Error(out.reason);
    const leader = out.body.creatures.find(c => c.tags.includes('elite') && c.social && c.leads);
    expect(leader).toBeDefined();
    expect(out.body.creatures.find(c => c.key === leader!.leads)!.social).toBe(true);
    expect(out.body.gear.some(g => ['head', 'chest', 'legs', 'feet', 'shoulder'].includes(g.kind) && g.rank === 'F')).toBe(true);
    expect(out.body.gear.some(g => g.kind === 'feet' && g.rank === 'F')).toBe(true);
    for (const c of out.body.creatures) expect(out.body.junk!.some(j => j.from.some(t => c.tags.includes(t))), c.key).toBe(true);
  });

  it('a pick by an id that was never offered is refused, asked again, and leaves nothing behind', async () => {
    const { door, asks } = scriptedDoor({
      made: (ask, n) => ({ picked: n === 1 ? ['not.an.id', first(ask, 'gear')!] : [first(ask, 'gear')!] })
    });
    const out = await write(door);
    expect(out.ok).toBe(true);
    const made = asks.filter(a => a.pass === 'made');
    expect(made.length).toBe(2);
    expect(made[1].refused).toContain('not.an.id');
    const once = String(pooled(made[1].offered.gear[0].id).entry.name);
    if (out.ok) expect(out.body.gear.filter(g => g.name === once).length).toBe(1);
  });

  it('with no key nothing is written and nothing is spent: an outcome, never a throw', async () => {
    const out = await write(async () => ({ status: 'NO_KEY', reason: 'No key is held here.' }));
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.status).toBe('NO_KEY');
      expect(out.pass).toBe('ground');
    }
    expect(out.usage.usd).toBe(0);
  });

  it('bar 164, as Q1 changed it: a written world is whole at its first deploy, and the chunks it grows read it', async () => {
    const out = await write(scriptedDoor().door);
    if (!out.ok) throw new Error(out.reason);
    const pack = sealTheme(out.body, 'fake', 1);
    expect(ContentRegistry.install(pack)).toEqual({ ok: true });
    const context = ContentRegistry.contextFor(pack.themeId, 'D');
    expect(context.mobDefinitions.length).toBe(out.body.creatures.length);
    for (const biome of BIOMES) {
      expect(context.mobDefinitions.some((m: { habitat?: string[] }) => m.habitat?.includes(biome)), biome).toBe(true);
      expect(context.resourceDefinitions.some((r: { habitat?: string[] }) => r.habitat?.includes(biome)), biome).toBe(true);
    }
  });
});

describe('the skilled ground, in the field', () => {
  // Find a rock tile and a water tile on a fixed seed: the ground is a pure function of it
  const seed = 'q1-terrain';
  const find = (type: TerrainType) => {
    for (let x = 0; x < 400; x++) for (let y = 0; y < 400; y++) if (TerrainSystem.typeAt(seed, x, y) === type) return { x, y };
    throw new Error(`no ${type}`);
  };

  it('rock blocks a walker without the skill and lets one with it over, slowly; water blocks both', () => {
    const rock = find(TerrainType.ROCK);
    const water = find(TerrainType.WATER);
    expect(TerrainSystem.isBlockedTile(seed, rock.x, rock.y)).toBe(true);
    expect(TerrainSystem.isBlockedTile(seed, rock.x, rock.y, true)).toBe(false);
    expect(TerrainSystem.isBlockedTile(seed, water.x, water.y, true)).toBe(true);
  });
});

// -------------------------------------------------------------------------
// C1 (leg 2): with no key, the local model could not write a new world. Gemma's ground left a kind of
// ground unnamed, and its skilled ground was crossed with "climb", a word nobody had registered. A local
// grammar holds a model to every word of a schema, so each pass asks it in the schema tightened to that ask.
// -------------------------------------------------------------------------

/** Enough of JSON schema to read what the tight schemas say. A local grammar enforces the same. */
function fits(schema: any, value: unknown, at = '$'): string | null {
  if (schema.enum && !schema.enum.includes(value)) return `${at}: ${JSON.stringify(value)} is not one of the ${schema.enum.length} offered`;
  if (schema.type === 'string') {
    if (typeof value !== 'string') return `${at}: not a string`;
    if (schema.minLength !== undefined && value.length < schema.minLength) return `${at}: too short`;
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) return `${at}: "${value}" does not match ${schema.pattern}`;
    return null;
  }
  if (schema.type === 'boolean') return typeof value === 'boolean' ? null : `${at}: not a boolean`;
  if (schema.type === 'array') {
    if (!Array.isArray(value)) return `${at}: not an array`;
    if (schema.minItems !== undefined && value.length < schema.minItems) return `${at}: fewer than ${schema.minItems}`;
    if (schema.maxItems !== undefined && value.length > schema.maxItems) return `${at}: more than ${schema.maxItems}`;
    for (let i = 0; i < value.length; i++) {
      const item = schema.prefixItems?.[i] ?? schema.items;
      const bad = item ? fits(item, value[i], `${at}[${i}]`) : null;
      if (bad) return bad;
    }
    return null;
  }
  if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return `${at}: not an object`;
    const v = value as Record<string, unknown>;
    for (const key of schema.required ?? []) if (!(key in v)) return `${at}.${key}: missing`;
    for (const [key, child] of Object.entries(v)) {
      const sub = schema.properties?.[key];
      if (!sub) { if (schema.additionalProperties === false) return `${at}.${key}: not asked for`; continue; }
      const bad = fits(sub, child, `${at}.${key}`);
      if (bad) return bad;
    }
    return null;
  }
  return null;
}

describe('C1: a local model is asked each pass in the schema tightened to it', () => {
  const answered = async () => {
    const { door } = scriptedDoor();
    const seen: { pass: WorldPassId; ask: IPassAsk; data: unknown }[] = [];
    const out = await write(async (pass, ask) => {
      const outcome = await door(pass, ask);
      seen.push({ pass, ask, data: outcome.data });
      return outcome;
    });
    expect(out.ok, out.reason).toBe(true);
    return seen;
  };

  it('every pass carries a tight schema beside the frozen one, which stays as it was', async () => {
    for (const { pass, ask } of await answered()) {
      const request = buildWorldPassRequest(pass, ask as never, {});
      expect(request.schema, pass).toBe(PASS_SCHEMAS[pass]);
      expect(request.tight, pass).toBeTruthy();
      expect(request.tight, pass).not.toBe(request.schema);
    }
  });

  it('what the law takes, the tight schema takes: a whole world written in it is not held back', async () => {
    for (const { pass, ask, data } of await answered()) {
      expect(fits(buildWorldPassRequest(pass, ask as never, {}).tight, data), pass).toBeNull();
    }
  });

  it('what Gemma wrote in leg 2 cannot be written in it', async () => {
    const seen = await answered();
    const of = (pass: WorldPassId) => seen.find(s => s.pass === pass)!;
    const ground = of('ground');
    const tightGround = buildWorldPassRequest('ground', ground.ask as never, {}).tight;
    const named = ground.data as { regions: { biome: string }[] };
    // A kind of ground left unnamed: the frozen schema takes it, the tight one does not
    const short = { ...named, regions: named.regions.filter(r => r.biome !== 'OVERGROWTH') };
    expect(fits(PASS_SCHEMAS.ground, short)).toBeNull();
    expect(fits(tightGround, short)).not.toBeNull();
    expect(fits(tightGround, { ...named, regions: named.regions.map(r => (r.biome === 'OVERGROWTH' ? { ...r, blurb: '' } : r)) })).not.toBeNull();

    // A skilled ground crossed with a word nobody registered
    const terrain = of('terrain');
    const unregistered = { ...(terrain.data as object), skilled: { pick: '', ground: 'tangled mounds', blurb: '', crossing: 'clamber_over' } };
    expect(fits(PASS_SCHEMAS.terrain, unregistered)).toBeNull();
    expect(fits(buildWorldPassRequest('terrain', terrain.ask as never, {}).tight, unregistered)).not.toBeNull();

    // A creature tagged with a leader's word, a word nobody registered, or a pick nobody offered
    const life = of('fauna');
    const tightLife = buildWorldPassRequest('fauna', life.ask as never, {}).tight;
    const fauna = (tags: string[]) => ({ ...(life.data as object), fauna: [{ is: 'a moth', tags, social: false, builds: false, regions: ['RUINS'] }] });
    expect(fits(tightLife, fauna(['vacuum']))).toBeNull();
    expect(fits(tightLife, fauna(['boss']))).not.toBeNull();
    expect(fits(tightLife, fauna(['descriptive_glow']))).not.toBeNull();
    expect(fits(tightLife, { ...(life.data as object), picked: [{ id: 'nobody.offered.this', regions: ['RUINS'] }] })).not.toBeNull();
  });

  // Found on the real run: Gemma picked an Audit Board, offered, which stands on Compound Oak in a world without trees.
  // Held to what it is offered, a model can only pick what was offered; so nothing is offered that cannot be picked.
  it('nothing is offered that stands on what the world is without', async () => {
    const seen = await answered();
    const ground = seen.find(s => s.pass === 'ground')!;
    const without = (ground.data as { without: string[] }).without;
    expect(without).toContain('trees');
    const offered = seen.filter(s => s.pass !== 'ground').flatMap(s => Object.values(s.ask.offered).flat());
    expect(offered.length).toBeGreaterThan(0);
    for (const o of offered) {
      const e = pooled(o.id);
      expect(standsOnRuledOut(FIRST_THEME_PACK, e.packList, e.key, without), o.id).toBeNull();
    }
  });

  it('a word the world registered in an earlier pass is one a later pass may use', async () => {
    const seen = await answered();
    const fauna = seen.find(s => s.pass === 'fauna')!;
    expect(fauna.ask.words).toContain('vacuum');
    expect(fits(buildWorldPassRequest('fauna', fauna.ask as never, {}).tight, fauna.data)).toBeNull();
    const ground = seen.find(s => s.pass === 'ground')!;
    expect(fits(buildWorldPassRequest('fauna', ground.ask as never, {}).tight, fauna.data)).not.toBeNull();
  });
});

// -------------------------------------------------------------------------
// C15 to C17 (after leg 2's fixes): on the local model the life pass sometimes wrote on past its room; a world could
// still stop at a floor the pool could not fill; and what came back read like code, its climbing ground crossed with "cloth".
// -------------------------------------------------------------------------

/** The first pack, with what a test takes away from the pool. */
const without = (cut: (p: typeof FIRST_THEME_PACK) => Partial<typeof FIRST_THEME_PACK>) => ({ ...FIRST_THEME_PACK, ...cut(FIRST_THEME_PACK) });
const writeFrom = (door: PassDoor, pack: typeof FIRST_THEME_PACK) => writeWorld('An airless moon. The bank never closed.', {
  door, pull: new CountedPull(poolOf([pack])), packs: [pack], registered, seed: 'moon', difficulty: 'D'
});

describe('C15: what grows and what lives are asked apart, so no ask runs past its room', () => {
  it('flora, then fauna, each its own pass; the second is told what the first made', async () => {
    const { door, asks } = scriptedDoor();
    const out = await write(door);
    expect(out.ok, out.reason).toBe(true);
    const order = asks.map(a => a.pass);
    expect(order.indexOf('flora')).toBeGreaterThan(order.indexOf('terrain'));
    expect(order.indexOf('fauna')).toBe(order.indexOf('flora') + 1);
    const fauna = asks.find(a => a.pass === 'fauna')!;
    expect((fauna.world.grows as string[]).join(' ')).toContain('eats starlight');
    expect(Object.keys(fauna.offered)).toEqual(['fauna']);
  });

  it('no ask carries plants and creatures together, frozen or tight', async () => {
    const lists = (schema: any) => Object.keys(schema.properties ?? {});
    for (const pass of WORLD_PASSES) {
      const tight = buildWorldPassRequest(pass, { pass }, {}).tight;
      for (const schema of [PASS_SCHEMAS[pass], tight]) {
        expect(lists(schema).includes('flora') && lists(schema).includes('fauna'), pass).toBe(false);
      }
    }
  });
});

describe('C16: what the pool cannot give, the model adds; it is never a refusal', () => {
  it('nothing in the pool can raise a wall: the model is asked for it, and code makes it a building material', async () => {
    const pack = without(p => ({ materials: p.materials.map(m => ({ ...m, tags: m.tags.filter(t => t !== 'building') })) }));
    const { door, asks } = scriptedDoor({
      holds: ask => ({ picked: [], minerals: [{ is: 'regolith that packs hard', form: 'sand', tags: [], regions: ['RUINS'] }], junk: [], anchors: [], words: [] })
    });
    const out = await writeFrom(door, pack);
    expect(out.reason ?? '').not.toContain('nothing in the pool');
    expect(out.ok, out.reason).toBe(true);
    const lack = asks.find(a => a.pass === 'lack')!;
    expect(lack.lack).toMatchObject({ need: 'raise a wall', list: 'materials' });
    const wall = out.body!.materials.find(m => m.blurb === 'packed regolith blocks')!;
    expect(wall.tags).toContain('building');
    expect(wall.name).toMatch(/^(Gray|Hollow|Still|Pale)/);
  });

  it('nothing in the pool can shoe a beginner: the model adds boots of a kind the need names, at rank F', async () => {
    const pack = without(p => ({ gear: p.gear.filter(g => g.kind !== 'feet') }));
    const { door, asks } = scriptedDoor();
    const out = await writeFrom(door, pack);
    expect(out.ok, out.reason).toBe(true);
    const lack = asks.find(a => a.pass === 'lack' && a.lack?.list === 'gear')!;
    expect(lack.lack!.kinds).toEqual(['feet']);
    expect(out.body!.gear.find(g => g.kind === 'feet' && g.rank === 'F')?.blurb).toBe('boots of wrapped suit cloth');
    expect(ThemeLaw.validate(out.body!, t => registered(t) || out.body!.tags.some(w => w.tag === t))).toEqual({ ok: true });
  });

  it('a lack ask holds the model to the one list the need names, and to the kinds that answer it', () => {
    const tight = buildWorldPassRequest('lack', { lack: { need: 'shoe a beginner', list: 'gear', kinds: ['feet'] } }, {}).tight;
    const empty = { fauna: [], materials: [], anchors: [], gear: [], words: [] };
    expect(fits(tight, empty)).not.toBeNull();
    expect(fits(tight, { ...empty, gear: [{ is: 'rag boots', kind: 'feet' }] })).toBeNull();
    expect(fits(tight, { ...empty, gear: [{ is: 'a club', kind: 'bludgeon' }] })).not.toBeNull();
    expect(fits(tight, { ...empty, gear: [{ is: 'rag boots', kind: 'feet' }], fauna: [{ is: 'a moth', tags: ['vacuum'], social: false, builds: false, regions: ['RUINS'] }] })).not.toBeNull();
  });
});

describe('C17: what a person reads is plain words, and names come from the world\'s own lists', () => {
  it('the model is never asked for a name: not the world\'s, not a ground\'s', () => {
    const ground = PASS_SCHEMAS.ground as any;
    expect(Object.keys(ground.properties)).not.toContain('name');
    expect(Object.keys(ground.properties.regions.items.properties)).not.toContain('name');
  });

  it('a code word cannot be written where a person reads: in a name piece, in what a thing is, in a ground', async () => {
    const seen: { pass: WorldPassId; ask: IPassAsk; data: any }[] = [];
    const { door } = scriptedDoor();
    await write(async (pass, ask) => { const o = await door(pass, ask); seen.push({ pass, ask, data: o.data }); return o; });
    const tight = (pass: WorldPassId) => buildWorldPassRequest(pass, seen.find(s => s.pass === pass)!.ask as never, {}).tight;
    const data = (pass: WorldPassId) => seen.find(s => s.pass === pass)!.data;
    expect(fits(tight('ground'), { ...data('ground'), prefixes: ['drowned_flat'] })).not.toBeNull();
    expect(fits(tight('ground'), { ...data('ground'), prefixes: ['Drowned'] })).toBeNull();
    expect(fits(tight('ground'), { ...data('ground'), prefixes: ['drowned'] })).not.toBeNull();
    expect(fits(tight('fauna'), { ...data('fauna'), fauna: [{ is: 'line_pigeon', tags: ['vacuum'], social: true, builds: false, regions: ['RUINS'] }] })).not.toBeNull();
    expect(fits(tight('terrain'), { ...data('terrain'), skilled: { ...data('terrain').skilled, ground: 'rising_slope' } })).not.toBeNull();
  });

  it('a name drawn from pieces in lowercase still reads as a name: a capital first', async () => {
    const { door } = scriptedDoor({
      ground: () => ({
        premise: 'A moon with no air.', regions: BIOMES.map(b => ({ biome: b, blurb: 'Gray, and still.' })),
        without: ['trees'], prefixes: ['chron', 'ferri'], suffixes: ['gloom', 'basin', 'cog'], words: [{ tag: 'vacuum', kind: 'descriptive', meaning: 'No air at all.' }, { tag: 'climb', kind: 'action', meaning: 'Getting up and over sheer ground.' }]
      })
    });
    const out = await write(door);
    expect(out.ok, out.reason).toBe(true);
    for (const name of [out.body!.name, ...out.body!.regions.map(r => r.name)]) expect(name, name).toMatch(/^(Chron|Ferri)( (Chron|Ferri))*(gloom|basin|cog)$/);
  });

  // Found on the real run: pieces came with hyphens ("Orchard- Mire-scape"), and a well run dry numbered a name ("Stil Mech Orch 4"),
  // then stacked its pieces ("Orcho Glint Orcho Glint Orcho Felt", C21): gibberish, Pedro 2026-11-09
  it('a name is one prefix and one suffix, never a number or a piece said twice: a well that runs dry asks the world for more', async () => {
    const { door, asks } = scriptedDoor({
      ground: () => ({
        premise: 'A moon with no air.', regions: BIOMES.map(b => ({ biome: b, blurb: 'Gray, and still.' })),
        without: ['trees'], prefixes: ['Gray-'], suffixes: ['-moth'], words: [{ tag: 'vacuum', kind: 'descriptive', meaning: 'No air at all.' }, { tag: 'climb', kind: 'action', meaning: 'Getting up and over sheer ground.' }]
      })
    });
    const out = await write(door);
    expect(out.ok, out.reason).toBe(true);
    const pool = new Set(poolOf([FIRST_THEME_PACK]).map(e => String(e.entry.name)));
    const drawn = [out.body!.name, ...out.body!.regions.map(r => r.name), ...[...out.body!.creatures, ...out.body!.materials, ...out.body!.junk!].map(x => x.name).filter(n => !pool.has(n))];
    expect(drawn.length).toBeGreaterThan(10);
    expect(new Set(drawn).size).toBe(drawn.length);
    // The first ask for more carries the pieces the world had, the hyphens shed
    const more = asks.filter(a => a.pass === 'names');
    expect(more.length).toBeGreaterThan(0);
    expect(more[0].names).toEqual({ prefixes: ['Gray'], suffixes: ['moth'] });
    // Every name is exactly one prefix and one suffix the world wrote
    const prefixes = ['Gray', ...MORE_PREFIXES], suffixes = ['moth', ...MORE_SUFFIXES];
    const made = new Set(prefixes.flatMap(p => suffixes.map(s => `${p}${s}`)));
    for (const name of drawn) expect(made.has(name), name).toBe(true);
    const tight = buildWorldPassRequest('ground', { pass: 'ground' }, {}).tight as any;
    expect(fits(tight.properties.prefixes, ['Orchard-'])).not.toBeNull();
    expect(fits(tight.properties.suffixes, ['scape'])).toBeNull();
  });

  it('a code word that gets past a schema is refused, and the pass asked again', async () => {
    const { door, asks } = scriptedDoor({
      fauna: (ask, n) => ({
        picked: [],
        fauna: [
          { is: n === 1 ? 'line_pigeon' : 'a pigeon that flies in lines', tags: ['vacuum'], social: true, builds: false, regions: ALL },
          { is: 'a glass hound that runs the rim', tags: ['vacuum'], social: true, builds: false, regions: ALL }
        ],
        words: []
      })
    });
    const out = await write(door);
    expect(out.ok, out.reason).toBe(true);
    const fauna = asks.filter(a => a.pass === 'fauna');
    expect(fauna.length).toBe(2);
    expect(fauna[1].refused).toContain('line_pigeon');
    expect(out.body!.creatures.some(c => c.blurb.includes('_'))).toBe(false);
  });

  // The cause of "cloth": the crossing was held to the registered words, "climb" is not one, and a grammar that let
  // "cl" begin could only end it as "clip" or "cloth". The crossing is now the word, registered with it when new
  it('the skilled ground is crossed with the word the model means, registered with it when the registry lacks it', async () => {
    const shipped = SHIPPED_WORDS;
    expect(shipped.has('climb')).toBe(false);
    expect([...shipped].filter(w => w.startsWith('cl')).sort()).toEqual(['clip', 'cloth']);
    const seen: { pass: WorldPassId; ask: IPassAsk }[] = [];
    const { door } = scriptedDoor({
      ground: () => ({
        premise: 'A moon with no air.', regions: BIOMES.map(b => ({ biome: b, blurb: 'Gray, and still.' })),
        without: [], prefixes: ['Gray', 'Pale'], suffixes: ['moth', 'drift', 'glass'], words: [{ tag: 'vacuum', kind: 'descriptive', meaning: 'No air at all.' }]
      }),
      terrain: () => ({
        impassable: { pick: '', ground: 'tunnels', blurb: 'Old bores.', crossing: '' },
        skilled: { pick: '', ground: 'a sheer crater rim', blurb: 'Cold.', crossing: { tag: 'rimclimb', kind: 'action', meaning: 'Getting up a crater rim.' } },
        words: []
      })
    });
    const out = await write(async (pass, ask) => { seen.push({ pass, ask }); return door(pass, ask); });
    expect(out.ok, out.reason).toBe(true);
    const skilled = out.body!.terrain!.find(t => t.role === 'skilled')!;
    expect(skilled.crossing).toBe('rimclimb');
    expect(out.body!.tags.find(t => t.tag === 'rimclimb')?.meaning).toBe('Getting up a crater rim.');
    // The tight schema takes a word the registry lacks: it is no longer narrowed to the registered ones
    const terrainAsk = seen.find(s => s.pass === 'terrain')!.ask;
    const tight = buildWorldPassRequest('terrain', terrainAsk as never, {}).tight as any;
    expect(fits(tight.properties.skilled.properties.crossing, { tag: 'climb', kind: 'action', meaning: 'Getting up and over.' })).toBeNull();
    expect(tight.properties.skilled.properties.crossing.enum).toBeUndefined();
  });
});

const writeNamed = (door: PassDoor, name?: string) => writeWorld('An airless moon. The bank never closed.', {
  door, pull: new CountedPull(poolOf([FIRST_THEME_PACK])), packs: [FIRST_THEME_PACK], registered, seed: 'moon', difficulty: 'D', name
});
const DRAWN = /^(Gray|Hollow|Still|Pale)( (Gray|Hollow|Still|Pale))*(crawler|moth|glass|drift)$/;

describe('the typed name: a person\'s own name for the world outranks anything drawn', () => {
  it('a typed name survives the whole world pass, and nothing else is drawn to it', async () => {
    const out = await writeNamed(scriptedDoor().door, 'THE STILL ORCHARD');
    expect(out.ok, out.reason).toBe(true);
    expect(out.body!.name).toBe('THE STILL ORCHARD');
    // Everywhere else, names are still drawn from the world's lists (C17)
    for (const r of out.body!.regions) expect(r.name, r.name).toMatch(DRAWN);
    const pool = new Set(poolOf([FIRST_THEME_PACK]).map(e => String(e.entry.name)));
    const drawn = [...out.body!.creatures, ...out.body!.materials, ...out.body!.junk!].map(x => x.name).filter(n => !pool.has(n));
    expect(drawn.length).toBeGreaterThan(0);
    for (const n of drawn) expect(n.toLowerCase()).not.toBe('the still orchard');
  });

  it('an empty field gets a name drawn from the lists', async () => {
    for (const name of ['', '   ', undefined]) {
      const out = await writeNamed(scriptedDoor().door, name);
      expect(out.ok, out.reason).toBe(true);
      expect(out.body!.name, String(name)).toMatch(DRAWN);
    }
  });
});

/** Registered meanings, as the database keeps them: what a river is, said in other words. */
const WATER_MEANINGS: Record<string, string> = {
  river: 'A wide band of moving water.',
  stream: 'A narrow run of moving water, shallow enough to wade.',
  waterfall: 'Moving water dropping over an edge.',
  pond: 'Still water, with no moving water in it.',
  hew: 'To shape timber by the blow, without a mill.'
};
const meaningOf = (w: string) => WATER_MEANINGS[w];

describe('C18: an exclusion is the whole phrase it is, read by meaning, never word by word', () => {
  it('"water-bloom" passes "without moving water"; a river, a stream or a waterfall is still ruled out', () => {
    expect(ruledOut({ text: 'Water-bloom on the still pools' }, ['moving water'], meaningOf)).toBe(false);
    expect(ruledOut({ text: 'a water-bloom' }, ['moving water'])).toBe(false);
    // Said in its own words, and said by what a word means
    expect(ruledOut({ text: 'a slick of moving water' }, ['moving water'])).toBe(true);
    for (const text of ['a river', 'the rivers of the low ground', 'a cold stream', 'a waterfall']) {
      expect(ruledOut({ text }, ['moving water'], meaningOf), text).toBe(true);
    }
    // A meaning that denies the phrase does not say it
    expect(ruledOut({ text: 'a pond' }, ['moving water'], meaningOf)).toBe(false);
    expect(ruledOut({ text: 'hew' }, ['mill'], meaningOf)).toBe(false);
    expect(ruledOut({ text: 'a mill wheel' }, ['mill'], meaningOf)).toBe(true);
  });

  it('a one-word exclusion works as before', () => {
    for (const text of ['a fire pit', 'fires on the ridge', 'Fire-eater']) expect(ruledOut({ text }, ['fire']), text).toBe(true);
    expect(ruledOut({ text: 'a pit of ash' }, ['fire'])).toBe(false);
    expect(ruledOut({ text: 'Compound Oak tree wood' }, ['trees'])).toBe(true);
  });

  it('a world without moving water keeps its water-bloom, and a river the world registered is refused and asked again', async () => {
    const { door, asks } = scriptedDoor({
      ground: () => ({
        premise: 'An orchard where nothing flows.', regions: BIOMES.map(b => ({ biome: b, blurb: `The ${b.toLowerCase()} side: still.` })),
        without: ['moving water'], prefixes: ['Gray', 'Hollow', 'Still', 'Pale'], suffixes: ['crawler', 'moth', 'glass', 'drift'],
        words: [
          { tag: 'vacuum', kind: 'descriptive', meaning: 'No air at all.' }, { tag: 'climb', kind: 'action', meaning: 'Getting up and over sheer ground.' },
          { tag: 'river', kind: 'descriptive', meaning: 'A wide band of moving water.' }
        ]
      }),
      flora: () => ({ picked: [], flora: [{ is: 'a water-bloom on the still pools', form: 'shrub', tags: [], regions: ALL }], words: [] }),
      fauna: (ask, n) => ({
        picked: [],
        fauna: [
          { is: n === 1 ? 'an eel of the river' : 'an eel of the still pools', tags: ['vacuum'], social: true, builds: false, regions: ALL },
          { is: 'a glass hound that runs the rim', tags: ['vacuum'], social: true, builds: false, regions: ALL }
        ],
        words: []
      })
    });
    const out = await write(door);
    expect(out.ok, out.reason).toBe(true);
    expect(out.body!.materials.some(m => m.blurb === 'a water-bloom on the still pools')).toBe(true);
    const fauna = asks.filter(a => a.pass === 'fauna');
    expect(fauna.length).toBe(2);
    expect(fauna[1].refused).toContain('an eel of the river');
    expect(out.body!.creatures.some(c => c.blurb.includes('river'))).toBe(false);
  });
});

describe('C19: a copy is the pooled thing, and a thin line is asked again', () => {
  const lien = FIRST_THEME_PACK.creatures.find(c => c.key === 'lien_moth')!;

  it('a pooled thing\'s name said first, or its own words copied, is that thing', async () => {
    const pull = new CountedPull(poolOf([FIRST_THEME_PACK]));
    expect((await pull.same('fauna', 'Lien Moth, which settles on whatever is owed'))?.key).toBe('lien_moth');
    expect((await pull.same('fauna', lien.blurb))?.key).toBe('lien_moth');
    // A name that only begins a longer one is not that thing
    expect(await pull.same('fauna', 'Receiver crab that hoards bright shells')).toBeNull();
  });

  it('a copy the model writes as new is taken from the pool, never minted again under a drawn name', async () => {
    const { door } = scriptedDoor({
      fauna: () => ({
        picked: [],
        fauna: [
          { is: 'Lien Moth, which settles on whatever is owed', tags: ['vacuum'], social: true, builds: false, regions: ALL },
          { is: lien.blurb, tags: ['vacuum'], social: true, builds: false, regions: ALL },
          { is: 'a glass hound that runs the rim', tags: ['vacuum'], social: true, builds: false, regions: ALL }
        ],
        words: []
      })
    });
    const out = await write(door);
    expect(out.ok, out.reason).toBe(true);
    const moths = out.body!.creatures.filter(c => c.blurb === lien.blurb || c.blurb.startsWith('Lien Moth'));
    expect(moths.map(c => c.name)).toEqual(['Lien Moth']);
    expect(out.passes.find(p => p.pass === 'fauna')!.takenFromPool).toBe(2);
  });

  it('a line that repeats its siblings\' words is refused with the reason, however short the distinct ones are', async () => {
    const { door, asks } = scriptedDoor({
      flora: (ask, n) => ({
        picked: [],
        flora: (n === 1 ? ['growth', 'growth', 'a growth'] : ['moss', 'fern', 'reed']).map(is => ({ is, form: 'shrub', tags: [], regions: ALL })),
        words: []
      })
    });
    const out = await write(door);
    expect(out.ok, out.reason).toBe(true);
    const flora = asks.filter(a => a.pass === 'flora');
    expect(flora.length).toBe(2);
    expect(flora[1].refused).toContain('"growth" says nothing that "growth" does not');
    expect(out.body!.materials.filter(m => ['moss', 'fern', 'reed'].includes(m.blurb)).length).toBe(3);
    expect(out.body!.materials.some(m => m.blurb === 'growth')).toBe(false);
  });

  it('thin every time, the pass stops on it after its two tries', async () => {
    const { door } = scriptedDoor({
      flora: () => ({ picked: [], flora: ['growth', 'growth'].map(is => ({ is, form: 'shrub', tags: [], regions: ALL })), words: [] })
    });
    const out = await write(door);
    expect(out.ok).toBe(false);
    expect(out.pass).toBe('flora');
    expect(out.reason).toContain('sets it apart');
  });
});

describe('C21: a name reads as a name: one prefix and one suffix, and more pieces when they run out', () => {
  // The real run's lists: two prefixes and one suffix, and a world adding a dozen things
  const short = () => ({
    premise: 'A drowned orchard where clockwork bees still harvest.', regions: BIOMES.map(b => ({ biome: b, blurb: 'Wet, and ticking.' })),
    without: ['trees'], prefixes: ['Orcho', 'Glint'], suffixes: ['Felt'], words: [{ tag: 'vacuum', kind: 'descriptive', meaning: 'No air at all.' }, { tag: 'climb', kind: 'action', meaning: 'Getting up and over sheer ground.' }]
  });

  it('no name says a piece twice, and a pass whose names ran out is not asked again for it', async () => {
    const { door, asks } = scriptedDoor({ ground: short });
    const out = await write(door);
    expect(out.ok, out.reason).toBe(true);
    const pool = new Set(poolOf([FIRST_THEME_PACK]).map(e => String(e.entry.name)));
    const drawn = [out.body!.name, ...out.body!.regions.map(r => r.name), ...[...out.body!.creatures, ...out.body!.materials, ...out.body!.junk!, ...out.body!.professions!].map(x => x.name).filter(n => !pool.has(n))];
    for (const name of drawn) {
      const words = name.split(' ');
      expect(words.length, name).toBeLessThanOrEqual(2);
      expect(new Set(words).size, name).toBe(words.length);
      expect(name, name).not.toMatch(/Orcho.*Orcho|Glint.*Glint|Orcho.*Glint|Glint.*Orcho/);
    }
    expect(new Set(drawn).size).toBe(drawn.length);
    // The answer that ran the names dry stood once the world had more: the pass itself was asked once
    expect(asks.filter(a => a.pass === 'fauna').length).toBe(1);
    expect(asks.filter(a => a.pass === 'names').length).toBeGreaterThan(0);
    expect(out.passes.some(p => p.pass === 'names')).toBe(true);
  });

  it('more pieces are new ones: an answer with nothing new is refused, and asked again', async () => {
    const { door, asks } = scriptedDoor({
      ground: short,
      names: (ask, n) => (n === 1 ? { prefixes: ['orcho', 'Glint'], suffixes: ['Felt'] } : { prefixes: [`Ash${'ab'.repeat(n)}`, `Brine${'ab'.repeat(n)}`], suffixes: ['Mere', 'Wane'] })
    });
    const out = await write(door);
    expect(out.ok, out.reason).toBe(true);
    const more = asks.filter(a => a.pass === 'names');
    expect(more[1].refused).toContain('already');
    expect(more[1].names!.prefixes).toEqual(['Orcho', 'Glint']);
  });

  it('the ask for more pieces holds the model to letters, a prefix starting with a capital, and at least one prefix', () => {
    const tight = buildWorldPassRequest('names', { pass: 'names', names: { prefixes: ['Gray'], suffixes: ['moth'] } }, {}).tight as any;
    expect(fits(tight, { prefixes: ['Dusk'], suffixes: [] })).toBeNull();
    expect(fits(tight, { prefixes: [], suffixes: ['fall'] })).not.toBeNull();
    expect(fits(tight, { prefixes: ['dusk'], suffixes: [] })).not.toBeNull();
    expect(fits(tight, { prefixes: ['Dusk-'], suffixes: [] })).not.toBeNull();
    expect(fits(PASS_SCHEMAS.names, { prefixes: ['Dusk'], suffixes: ['fall'] })).toBeNull();
  });
});
