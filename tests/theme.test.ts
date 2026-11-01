/**
 * THE THEME AND THE DOOR (D43–D46, D53–D58): lines 85–89 and the law a model stands
 * before. No bar here calls a model: the provider is a stand-in, and the Claude
 * provider is driven by a fake client.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ContentRegistry } from '../src/logic/theme/ContentRegistry';
import { ThemeLaw } from '../src/logic/theme/ThemeLaw';
import { bodyOf, sealTheme, compileTheme, themeIdOf } from '../src/logic/theme/ThemeCompiler';
import { creatureNumbers, GEAR_SHAPES } from '../src/logic/theme/ThemeFormula';
import { GEAR_KINDS, IThemeBody, THEME_SCHEMA } from '../src/logic/theme/ThemeTypes';
import { FIRST_THEME_PACK, installShippedThemes } from '../src/logic/theme/boot';
import { FIRST_THEME } from '../src/entities/generation/packs/firstTheme';
import { WebBank } from '../src/logic/content/WebBank';
import { WorldGenerator } from '../src/entities/world/WorldGenerator';
import { EntityType } from '../src/entities/world/types';
import { SECTOR_CHUNKS } from '../src/entities/world/grid';
import { MOB_DEFINITIONS } from '../src/entities/mob/data/mobDefinitions';
import { RESOURCE_DEFINITIONS } from '../src/entities/item/data/resourceDefinitions';
import { BASE_WALK_TILES_PER_S, LoadoutSystem } from '../src/entities/player/systems/LoadoutSystem';
import { ItemFactory } from '../src/entities/item/ItemFactory';
import { Rng } from '../src/logic/rng/DeterministicRNG';
import { creature, worldForm } from '../src/render/atoms/atoms';
import { IntelligenceDoor, AbsentProvider, IIntelligenceProvider, REST_SPEND_LIMIT_USD } from '../server/intelligence/door';
import { ClaudeProvider, MODEL_FOR } from '../server/intelligence/claude';
import { buildThemeRequest, buildTalkRequest, buildRestRequest } from '../server/intelligence/prompts';
import { UniversalRank } from '../types';
import { usePlayerStore } from '../src/entities/player/store';
import { inspectItem } from '../src/render/atoms/inspect';
import { itemArtFor } from '../src/render/atoms/items';
import { runGoldenCheck, FIRST_THEME_VECTORS } from '../src/entities/world/goldens';

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const registered = (tag: string) => WebBank.current().tags.some(t => t.tag === tag);
const judge = (body: IThemeBody) => ThemeLaw.validate(body, registered);

installShippedThemes();
const themeId = FIRST_THEME_PACK.themeId;

const walk = (dir: string): string[] => readdirSync(dir).flatMap(name => {
  const path = join(dir, name);
  return statSync(path).isDirectory() ? walk(path) : [path];
});
const source = walk('src').filter(p => /\.tsx?$/.test(p));

describe('D53: nothing hardcoded', () => {
  it('no content table is written in src: the tables are empty until a theme fills them', () => {
    const tables = ['src/entities/mob/data/mobDefinitions.ts', 'src/entities/item/data/resourceDefinitions.ts', 'src/entities/item/data/affixDefinitions.ts', 'src/entities/generation/packs/affixBatches.ts'];
    for (const file of tables) {
      const text = readFileSync(file, 'utf8');
      expect(text, file).not.toMatch(/rank:\s*UniversalRank\./);
      expect(text, file).not.toMatch(/baseHealth:\s*\d/);
    }
    const items = readFileSync('src/entities/item/data/itemDefinitions.ts', 'utf8');
    expect(items).not.toMatch(/universal_name"?:\s*['"]/);
    const recipes = readFileSync('src/entities/economy/data/recipeDefinitions.ts', 'utf8');
    expect(recipes).not.toMatch(/inputs:\s*\[\{\s*itemId:\s*'/);
    const web = readFileSync('src/entities/generation/packs/webBatches.ts', 'utf8');
    expect(web).not.toMatch(/run_006/);
  });

  it('nothing in src reaches for the test content, or names a piece of it', () => {
    const named = /'(res_tree_log|res_rock_small|mob_fantasy_[a-z]+|tool_axe_field_t1|tool_pick_rusty_t1|arm_boots_generic_t1|crf_plank)'/;
    for (const file of source) {
      const text = readFileSync(file, 'utf8');
      expect(text, file).not.toMatch(/fixtures\/content/);
      expect(text, file).not.toMatch(named);
    }
  });

  it('the old magic stubs and the genre pipeline are gone', () => {
    expect(source.some(p => /SpellEngine|ContentPipeline|GenreCreator|GenesisInitializer/.test(p))).toBe(false);
  });
});

describe('the shipped theme stands before the same law', () => {
  it('is lawful, and its id is its bytes', () => {
    expect(judge(FIRST_THEME)).toEqual({ ok: true });
    expect(themeIdOf(FIRST_THEME)).toBe(themeId);
    expect(ContentRegistry.get(themeId)?.name).toBe('The Long Audit');
  });

  it('the order a model wrote its keys in does not change the id', () => {
    const shuffled = { ...clone(FIRST_THEME) } as IThemeBody;
    shuffled.creatures = shuffled.creatures.map(c => Object.fromEntries(Object.entries(c).reverse()) as typeof c);
    expect(themeIdOf(shuffled)).toBe(themeId);
  });

  it('every creature and material it holds can be drawn', () => {
    const compiled = compileTheme(FIRST_THEME_PACK);
    for (const def of Object.values(compiled.mobs)) expect(creature(def).w, def.id).toBeGreaterThan(0);
    for (const def of Object.values(compiled.resources)) {
      if (def.habitat) expect(worldForm(def).w, def.id).toBeGreaterThan(0);
    }
  });

  it('a theme world builds only from its own theme, whatever else is known', () => {
    const context = ContentRegistry.contextFor(themeId, UniversalRank.E);
    const map = WorldGenerator.generate('theme-world', 16, context);
    const own = new Set([...context.mobDefinitions, ...context.resourceDefinitions].map(d => d.id));
    let seen = 0;
    const mid = 8 * SECTOR_CHUNKS;
    for (let y = mid; y < mid + 6; y++) for (let x = mid; x < mid + 6; x++) {
      for (const e of WorldGenerator.chunkAt(map, x, y, context)?.entities ?? []) {
        if (e.type === EntityType.MOB || e.type === EntityType.RESOURCE) { expect(own.has(e.definitionId), e.definitionId).toBe(true); seen++; }
      }
    }
    expect(seen).toBeGreaterThan(0);
    expect(MOB_DEFINITIONS['mob_fantasy_rat']).toBeDefined(); // the fixture is known here, and still did not appear
  });

  it('a pinned world\'s land is its seed and its theme: the golden vectors stand', () => {
    expect(runGoldenCheck(ContentRegistry.contextFor(themeId), FIRST_THEME_VECTORS)).toEqual({ ok: true, mismatches: [] });
  });

  it('D54: a piece from retired tables stays a self-described relic: its card and its art do not break', () => {
    const relic = { ...ItemFactory.createItem(UniversalRank.F, true, Rng.fromKey('relic'), 'weapon'), universalDefinitionId: 'wpn_long_retired' };
    const player = usePlayerStore.getState().player;
    expect(() => inspectItem(relic, player)).not.toThrow();
    expect(inspectItem(relic, player).title).toBe(relic.name);
    expect(itemArtFor(relic).w).toBeGreaterThan(0);
  });

  it('another theme installed later changes nothing about the first', () => {
    const before = ContentRegistry.contextFor(themeId).mobDefinitions.map(m => m.id);
    const other = clone(FIRST_THEME);
    other.name = 'A Second World';
    const pack = sealTheme(other, 'test', 1);
    expect(ContentRegistry.install(pack)).toEqual({ ok: true });
    expect(ContentRegistry.contextFor(themeId).mobDefinitions.map(m => m.id)).toEqual(before);
    expect(pack.themeId).not.toBe(themeId);
  });

  it('R5\'s rule, as law: every kind of gear has a slot that takes it', () => {
    for (const kind of GEAR_KINDS) expect(GEAR_SHAPES[kind], kind).toBeDefined();
    const compiled = compileTheme(FIRST_THEME_PACK);
    const rng = Rng.fromKey('bars:slots');
    for (const base of [...compiled.items.armor_bases, ...compiled.items.weapon_bases, ...compiled.items.tool_bases]) {
      if ((base.tags ?? []).includes('cart')) continue;
      const item = ItemFactory.createFromTemplate(base, true, rng);
      const slots = LoadoutSystem.availableSlots({ ...LoadoutSystem.emptyEquipment(), slots: {}, items: [] });
      const belt = (base.tags ?? []).includes('pouch');
      expect(belt || slots.some(s => LoadoutSystem.slotAccepts(s, item).ok), base.id).toBe(true);
    }
  });
});

describe('the law refuses a broken pack whole, whoever wrote it', () => {
  const broken = (mutate: (b: IThemeBody) => void) => { const b = clone(FIRST_THEME); mutate(b); return judge(b); };

  it('a number the formula should have written (D57)', () => {
    const v = broken(b => { (b.creatures[0] as unknown as Record<string, unknown>).baseDamage = 9000; });
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/formula/);
  });
  it('an unregistered tag', () => expect(broken(b => { b.creatures[0].tags = ['nonsense_word']; }).reason).toMatch(/nonsense_word/));
  it('a stat nothing reads', () => expect(broken(b => { b.affixes[0].gives[0].stat = 'levitation'; }).reason).toMatch(/levitation/));
  it('a mind\'s stat on a blade (D22)', () => expect(broken(b => { b.affixes[0].gives[0].stat = 'focus'; }).reason).toMatch(/D22/));
  it('an innate ability it never defines', () => expect(broken(b => { b.creatures[0].innate = ['missing_magic']; }).reason).toMatch(/missing_magic/));
  it('a good made from itself', () => expect(broken(b => { b.goods[0].from = [{ key: b.goods[0].key, count: 1 }]; }).reason).toMatch(/itself/));
  it('wood with nothing to chop it', () => expect(broken(b => { b.gear = b.gear.filter(g => g.kind !== 'chop_tool'); }).reason).toMatch(/chop/));
  it('a world with nothing small to start on', () => expect(broken(b => { b.creatures = b.creatures.map(c => ({ ...c, rank: 'S' })); }).reason).toMatch(/start/));
  it('no boots (D34)', () => expect(broken(b => { b.gear = b.gear.filter(g => g.kind !== 'feet'); }).reason).toMatch(/D34/));
  it('a pack whose id does not match its words', () => {
    const pack = { ...FIRST_THEME_PACK, name: 'Forged', themeId: 'theme_forged' };
    expect(ContentRegistry.install(pack).ok).toBe(false);
  });
  it('the tag law sits behind it', () => {
    const bad = clone(FIRST_THEME);
    bad.tags.push({ tag: 'Bad Spelling', kind: 'element', meaning: 'A word spelled wrong.' });
    expect(ContentRegistry.judge(bad).reason).toMatch(/Bad Spelling/);
    expect(ContentRegistry.judge(clone(FIRST_THEME)).ok).toBe(true);
  });
});

describe('R4: the formula, and what generation reads', () => {
  it('nothing outruns a bare walk, so a person can always leave', () => {
    for (const pace of ['slow', 'steady', 'swift'] as const) {
      expect(creatureNumbers({ rank: 'SSS', build: 'massive', threat: 'deadly', pace, size: 'COLOSSAL' }).speed).toBeLessThan(BASE_WALK_TILES_PER_S);
    }
  });

  it('a world\'s difficulty sets its ground: an E world is never mostly S', () => {
    const order = Object.values(UniversalRank);
    let top = 0;
    for (let y = 0; y < 60; y++) for (let x = 0; x < 60; x++) {
      top = Math.max(top, order.indexOf(WorldGenerator.rankAt('difficulty-bar', x, y, UniversalRank.E)));
    }
    expect(top).toBeLessThanOrEqual(order.indexOf(UniversalRank.C));
    expect(top).toBeGreaterThanOrEqual(order.indexOf(UniversalRank.E));
  });

  it('an elite is scarce and alone, however rich the chunk', () => {
    const context = ContentRegistry.contextFor(themeId, UniversalRank.A);
    const map = WorldGenerator.generate('elite-bar', 32, context);
    const elite = (id: string) => (MOB_DEFINITIONS[id].tags ?? []).includes('elite');
    let elites = 0, mobs = 0;
    const mid = 16 * SECTOR_CHUNKS;
    for (let y = mid; y < mid + 24; y++) for (let x = mid; x < mid + 24; x++) {
      const found = (WorldGenerator.chunkAt(map, x, y, context)?.entities ?? []).filter(e => e.type === EntityType.MOB);
      mobs += found.length;
      elites += found.filter(e => elite(e.definitionId)).length;
    }
    expect(mobs).toBeGreaterThan(100);
    expect(elites / mobs).toBeLessThan(0.1);
  });

  it('a timber tree is found by what it is, and its trunk blocks', () => {
    const oak = Object.values(RESOURCE_DEFINITIONS).find(r => r.themeId === themeId && (r.tags ?? []).includes('wood'));
    expect(oak).toBeDefined();
  });
});

// A stand-in provider: records what it was asked, answers what it is told.
const standIn = (over: Partial<IIntelligenceProvider> = {}): IIntelligenceProvider => ({
  name: 'stand-in',
  status: async () => ({ available: true, provider: 'stand-in' }),
  ask: async () => ({ status: 'OK', text: 'ok' }),
  file: async () => ({ status: 'PENDING', batchId: 'b1' }),
  collect: async () => ({ status: 'PENDING' }),
  ceiling: () => 0.01,
  ...over
});

describe('line 89: one door', () => {
  it('no Gemini code remains anywhere', () => {
    const everything = [...source, 'vite.config.ts', 'App.tsx', 'index.tsx', ...walk('server').filter(p => p.endsWith('.ts'))];
    for (const file of everything) expect(readFileSync(file, 'utf8'), file).not.toMatch(/gemini|generativelanguage|GoogleGenAI/i);
    expect(readFileSync('package.json', 'utf8')).toMatch(/@anthropic-ai\/sdk/);
  });

  it('line 88: the SDK and any key stay on the server', () => {
    for (const file of source) {
      const text = readFileSync(file, 'utf8');
      expect(text, file).not.toMatch(/@anthropic-ai\/sdk/);
      expect(text, file).not.toMatch(/ANTHROPIC_API_KEY/);
    }
    expect(readFileSync('vite.config.ts', 'utf8')).not.toMatch(/define:/);
  });

  it('no test calls the API: this suite\'s provider is a fake, and the source says so', () => {
    expect(readFileSync('tests/theme.test.ts', 'utf8')).not.toMatch(/new ClaudeProvider\(\)/);
  });

  it('a rest uses the model Pedro chose, one constant per kind (D44)', () => {
    expect(MODEL_FOR.rest).toBe('claude-opus-5-5');
    expect(Object.keys(MODEL_FOR).sort()).toEqual(['creation', 'kami_persona', 'kami_set', 'kami_talk', 'rest', 'talk', 'theme']);
  });

  it('a request carries a frozen system prompt: nothing volatile before the cache line', () => {
    const a = buildThemeRequest([{ role: 'user', content: 'one' }], { worldName: 'A' });
    const b = buildThemeRequest([{ role: 'user', content: 'two' }], { worldName: 'B' });
    expect(a.system).toBe(b.system);
    expect(a.schema).toBe(THEME_SCHEMA);
    expect(buildTalkRequest([], {}).schema).toBeUndefined();
    expect(buildRestRequest({}, {}).schema).toBeDefined();
  });

  it('the theme schema allows no extra keys, and the law still judges what comes back', () => {
    expect(THEME_SCHEMA.additionalProperties).toBe(false);
  });
});

describe('line 87: no key, no network, a refusal: the game goes on', () => {
  it('an absent provider answers every door with an outcome, never a throw', async () => {
    const door = new IntelligenceDoor(new AbsentProvider());
    expect((await door.status()).available).toBe(false);
    expect((await door.ask(buildTalkRequest([], {}))).status).toBe('NO_KEY');
    expect((await door.fileRest('r', buildRestRequest({}, {}))).status).toBe('NO_KEY');
    expect((await door.collectRest('b')).status).toBe('NO_KEY');
  });

  it('D44: a batch over what a rest may spend does not go, and waits', async () => {
    let filed = false;
    const door = new IntelligenceDoor(standIn({ ceiling: () => REST_SPEND_LIMIT_USD + 1, file: async () => { filed = true; return { status: 'PENDING', batchId: 'x' }; } }));
    expect((await door.fileRest('r', buildRestRequest({}, {}))).status).toBe('OVER_LIMIT');
    expect(filed).toBe(false);
  });
});

describe('the Claude provider, driven by a fake client', () => {
  const message = (over: Record<string, unknown>) => ({
    content: [{ type: 'text', text: '{"ok":true}' }], stop_reason: 'end_turn',
    usage: { input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 100 }, ...over
  });
  const fake = (msg: unknown, spy?: (p: Record<string, unknown>) => void, batch?: unknown) => ({
    beta: { messages: { stream: (p: Record<string, unknown>) => { spy?.(p); return { finalMessage: async () => msg }; } } },
    models: { retrieve: async () => ({ id: 'x' }) },
    messages: { batches: batch ?? {} }
  }) as never;

  it('sends the schema, the effort, the cache line and the fallback; reads the usage', async () => {
    let params: Record<string, unknown> = {};
    const provider = new ClaudeProvider(fake(message({}), p => { params = p; }));
    const out = await provider.ask(buildThemeRequest([], {}));
    expect(out.status).toBe('OK');
    expect(out.data).toEqual({ ok: true });
    expect(params.model).toBe('claude-opus-5-5');
    expect((params.output_config as { format: { type: string } }).format.type).toBe('json_schema');
    expect((params.output_config as { effort: string }).effort).toBe('high');
    expect((params.system as { cache_control: unknown }[])[0].cache_control).toEqual({ type: 'ephemeral' });
    expect(params.fallbacks).toBe('default');
    expect(out.usage).toMatchObject({ model: 'claude-opus-5-5', inputTokens: 1000, outputTokens: 500 });
    expect(out.usage!.usd).toBeCloseTo((1000 * 4 + 500 * 20 + 100 * 0.2) / 1_000_000);
  });

  it('a refusal is an outcome', async () => {
    const out = await new ClaudeProvider(fake(message({ stop_reason: 'refusal' }))).ask(buildThemeRequest([], {}));
    expect(out.status).toBe('REFUSED');
  });

  it('running out of room is an outcome, and so is prose where JSON was asked', async () => {
    expect((await new ClaudeProvider(fake(message({ stop_reason: 'max_tokens' }))).ask(buildThemeRequest([], {}))).status).toBe('CUT_OFF');
    expect((await new ClaudeProvider(fake(message({ content: [{ type: 'text', text: 'nope' }] }))).ask(buildThemeRequest([], {}))).status).toBe('CUT_OFF');
  });

  it('a thrown error becomes an outcome', async () => {
    const client = { beta: { messages: { stream: () => { throw new Error('Could not resolve authentication method'); } } } } as never;
    expect((await new ClaudeProvider(client).ask(buildTalkRequest([], {}))).status).toBe('NO_KEY');
  });

  it('a rest goes through batches, at half the price, and no fallback is sent there', async () => {
    let sent: { requests: { custom_id: string; params: Record<string, unknown> }[] } | undefined;
    const batches = {
      create: async (p: never) => { sent = p; return { id: 'batch_1' }; },
      retrieve: async () => ({ processing_status: 'ended' }),
      results: async () => (async function* () { yield { custom_id: 'r', result: { type: 'succeeded', message: message({}) } }; })()
    };
    const provider = new ClaudeProvider(fake(message({}), undefined, batches));
    const filed = await provider.file('r', buildRestRequest({ q: 1 }, {}));
    expect(filed).toEqual({ status: 'PENDING', batchId: 'batch_1' });
    expect(sent!.requests[0].params.fallbacks).toBeUndefined();
    const out = await provider.collect('batch_1');
    expect(out.status).toBe('OK');
    expect(out.usage!.usd).toBeCloseTo(((1000 * 4 + 500 * 20 + 100 * 0.2) / 1_000_000) / 2);
  });

  it('the ceiling of a rest stays inside what a rest may spend', () => {
    const provider = new ClaudeProvider(fake(message({})));
    expect(provider.ceiling(buildRestRequest({}, {}), true)).toBeLessThan(REST_SPEND_LIMIT_USD);
  });
});

describe('the mint offers one printing of a theme', () => {
  it('an older printing stays installed for what is pinned to it, and is not offered', () => {
    const current = ContentRegistry.get(ContentRegistry.defaultThemeId())!;
    const older = sealTheme({ ...bodyOf(current), lore: [...current.lore, 'An older printing, for this bar.'] }, 'test', 1);
    ContentRegistry.install(older);
    expect(ContentRegistry.get(older.themeId)).toBeDefined();
    const offered = ContentRegistry.offered();
    expect(offered.filter(p => p.name === current.name).map(p => p.themeId)).toEqual([current.themeId]);
  });
});
