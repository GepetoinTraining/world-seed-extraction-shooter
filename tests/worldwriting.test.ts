/**
 * Q1: a world is written in passes, in a world's own order, from what the pool holds:
 * pulled by meaning, selected by id, then added to. Every bar here runs with no key, on
 * a door that answers from a script, and nothing is spent.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { ContentRegistry } from '../src/logic/theme/ContentRegistry';
import { FIRST_THEME_PACK } from '../src/logic/theme/boot';
import { ThemeLaw } from '../src/logic/theme/ThemeLaw';
import { BIOMES, IThemeBody, THEME_SCHEMA } from '../src/logic/theme/ThemeTypes';
import { sealTheme } from '../src/logic/theme/ThemeCompiler';
import { WebBank } from '../src/logic/content/WebBank';
import { HASHED_EMBEDDER, IEmbedder } from '../src/services/EmbeddingService';
import { CountedPull, poolOf, ruledOut } from '../src/logic/theme/writing/WorldPool';
import { concentration, concentrationResiduals, CountedEmbedder, fieldAffinity, fieldCounts, logOddsZ } from '../src/logic/theme/writing/Counting';
import { cosineSimilarity } from '../src/entities/data/similarity';
import { PASS_SCHEMAS, SCHEMA_LIMITS, WORLD_PASSES, WorldPassId, schemaShape } from '../src/logic/theme/writing/WorldPasses';
import { IPassAsk, IPassOutcome, PassDoor, temperOf, writeWorld } from '../src/logic/theme/writing/WorldWriter';
import { TerrainSystem, TerrainType } from '../src/entities/world/TerrainSystem';
import { TerrainCrossing } from '../src/logic/theme/TerrainCrossing';
import { TagLaw } from '../src/logic/content/TagLaw';
import { CHAIN_PARTS, CHAIN_SCHEMA, buildChainRequest, buildWorldPassRequest } from '../server/intelligence/prompts';
import { askChainInParts } from '../server/intelligence/parts';
import type { IDoorRequest } from '../server/intelligence/door';

const registered = (tag: string) => WebBank.current().tags.some(t => t.tag === tag && !t.retired);

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
    const b = buildWorldPassRequest('life', { said: 'a moon', world: { name: 'X' } }, {});
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

/** What a model might answer for an airless moon, pass by pass. It picks from what was offered. */
function scriptedDoor(overrides: Partial<Record<WorldPassId, (ask: IPassAsk, n: number) => unknown>> = {}): { door: PassDoor; asks: IPassAsk[] } {
  const asks: IPassAsk[] = [];
  const counts: Record<string, number> = {};
  const answers: Record<WorldPassId, (ask: IPassAsk) => unknown> = {
    ground: () => ({
      name: 'The Quiet Moon', premise: 'A moon with no air, where a bank still keeps its hours.',
      regions: BIOMES.map(b => ({ biome: b, name: `The ${b.toLowerCase()} side`, blurb: 'Gray, and still.' })),
      without: ['trees'], prefixes: ['Gray', 'Hollow', 'Still', 'Pale'], suffixes: ['crawler', 'moth', 'glass', 'drift'],
      words: [{ tag: 'vacuum', kind: 'descriptive', meaning: 'No air at all.' }, { tag: 'climb', kind: 'action', meaning: 'Getting up and over sheer ground.' }]
    }),
    terrain: () => ({
      impassable: { pick: '', ground: 'tunnels', blurb: 'Old bores that drop into nothing.', crossing: '' },
      skilled: { pick: '', ground: 'a dark-side crater', blurb: 'Its rim is sheer and cold.', crossing: 'climb' },
      words: []
    }),
    life: ask => ({
      picked: [{ id: first(ask, 'fauna'), regions: ['RUINS'] }, { id: first(ask, 'flora'), regions: ['WASTELAND'] }].filter(p => p.id),
      flora: [{ is: 'a gray lichen that eats starlight', form: 'shrub', tags: [], regions: ['WASTELAND', 'OVERGROWTH'] }],
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
    known: () => ({ picked: [], lore: ['The moon kept the bank\'s hours long after the bank was gone.'] })
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
    const life = asks.find(a => a.pass === 'life')!;
    expect((life.world.terrain as string[]).join(' ')).toContain('dark-side crater');
    expect(life.words).toContain('vacuum');
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
    const pickedId = asks.find(a => a.pass === 'life')!.offered.fauna[0].id;
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
      life: (ask, n) => ({
        picked: [], fauna: [{ is: 'a pale moth that drinks static', tags: ['vacuum'], social: true, builds: false, regions: ALL }, { is: 'a glass hound that runs the rim', tags: ['vacuum'], social: true, builds: false, regions: ALL }],
        flora: n === 1 ? [{ is: 'a tall gray tree', form: 'tree', tags: [], regions: ALL }] : [{ is: 'a gray lichen that eats starlight', form: 'shrub', tags: [], regions: ALL }],
        words: []
      })
    });
    const out = await write(door);
    expect(out.ok).toBe(true);
    const lifeAsks = asks.filter(a => a.pass === 'life');
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
    for (const x of added) expect(x.name, x.name).toMatch(/^(Gray|Hollow|Still|Pale)( (Gray|Hollow|Still|Pale))?(crawler|moth|glass|drift)$/);
    expect(new Set(added.map(x => x.name)).size).toBe(added.length);
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
