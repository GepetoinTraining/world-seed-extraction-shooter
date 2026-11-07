/**
 * THE TECHNOLOGY WEB AND AUTO SKILL BARS (D27) — registered before the build
 * (guardrail 1). Test lines 63 to 68, stated plainly:
 *   63 working with a tool on a material mints a skill from that pair, and the
 *      same pair always mints the same skill
 *   64 working without the skill accrues toward it, and it can emerge only at a
 *      rest, on a keyed roll that replays the same
 *   65 a further station opens through a skill's tool + material connection,
 *      not through a fixed list
 *   66 an NPC carries a stat sheet and skills derived from its seed, read
 *      through the same web as the player's
 *   67 the tag law holds: every tag is registered with one meaning, and a
 *      skill's identity is its canonical tag set and nothing else
 *   68 nothing caps the web: new tools, materials and batches grow it with no
 *      code change
 * Plus the one-way door: golden vectors and pinned packs do not move, and a
 * generated NPC's stored bytes stay exactly what they were.
 */

import { FieldEscort } from '../src/logic/systems/FieldEscort';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const db = new Map<string, any>();
vi.mock('../shared/entities/data/VectorStore', () => ({
  VectorNamespace: { CHARACTERS: 'characters', ITEMS: 'items', WORLDS: 'worlds', TRANSACTIONS: 'transactions', CONTENT: 'content', TERRITORIES: 'territories' },
  VectorStore: {
    get: async (_ns: string, id: string) => db.get(id) ?? null,
    put: async (doc: any) => { db.set(doc.id, doc); return true; },
    query: async () => [...db.values()].filter(d => d?.id),
    saveContent: async (id: string, _type: string, data: any) => { db.set(`content:${id}`, data); return true; },
    searchContent: async () => []
  }
}));
vi.mock('../src/entities/identity/certificateSystem', () => ({
  CertificateSystem: {
    signPayload: async (uid: string, payload: any) => ({ payload, signature: `sig_${uid}`, certUid: uid, timestamp: 0 }),
    verifyPayload: async () => true,
    getPrivateKey: async () => null
  }
}));

import { IItem, ISkillState, IWebBatch, IWebPack, TAG_KIND_IDENTITY, UniversalRank, Rarity, MENTAL_ATTRIBUTES, PHYSICAL_ATTRIBUTES } from '../shared/types';
import { TagLaw } from '../shared/logic/content/TagLaw';
import { WebBank } from '../shared/logic/content/WebBank';
import { bankAndSignWeb } from '../src/logic/content/BankSigning';
import { WEB_BATCHES } from '../shared/entities/generation/packs/webBatches';
import { WebSystem, MASTERY_RUNGS, RUNG_XP } from '../shared/logic/systems/WebSystem';
import { NpcSheet } from '../shared/logic/systems/NpcSheet';
import { SkillDiscovery } from '../src/entities/player/systems/SkillDiscovery';
import { ProgressionSystem } from '../shared/entities/player/systems/ProgressionSystem';
import { LoadoutSystem } from '../shared/entities/player/systems/LoadoutSystem';
import { RESOURCE_DEFINITIONS } from '../shared/entities/item/data/resourceDefinitions';
import { RECIPE_DEFINITIONS, CRAFTED_DEFINITIONS } from '../shared/entities/economy/data/recipeDefinitions';
import { ITEM_DEFINITIONS, CRAFTED_GEAR_BASES } from '../shared/entities/item/data/itemDefinitions';
import { AFFIX_BATCHES } from '../shared/entities/generation/packs/affixBatches';
import { AffixBank } from '../shared/logic/content/AffixBank';
import { ProcessSystem } from '../shared/logic/systems/ProcessSystem';
import { StudySystem } from '../src/logic/systems/StudySystem';
import { CompositionSystem, fnv1a } from '../shared/logic/economy/CompositionSystem';
import { GoldAudit } from '../src/logic/economy/GoldAudit';
import { SourcingAudit } from '../src/logic/economy/SourcingAudit';
import { Ledger } from '../src/logic/ledger/Ledger';
import { ItemFactory } from '../shared/entities/item/ItemFactory';
import { WorldGenerator } from '../shared/entities/world/WorldGenerator';
import { runGoldenCheck } from '../src/entities/world/goldens';
import { EntityType, IWorldEntity } from '../shared/entities/world/types';
import { shellBillFor, SHELL_BILLS, stationFunctionOf, stationMinAreaOf, isStation } from '../shared/entities/hub/room';
import { inspectEntity, inspectItem } from '../src/render/atoms/inspect';
import { useHubStore } from '../src/entities/hub/store';
import { usePlayerStore } from '../src/entities/player/store';
import { useWorldStore, worldPort } from '../src/entities/world/store';
import { useIdentityStore } from '../src/entities/identity/store';
import { Rng } from '../shared/logic/rng/DeterministicRNG';

// -----------------------------------------------------------------------------
// Bars, set before the build. Do not lower them to get a pass.
// -----------------------------------------------------------------------------
const PINNED_AFFIX_PACKS: Record<number, string> = { 1: 'da2b84b8', 2: '3f842e24', 3: '16cd7bfb', 4: '573c3434' };
const BREADTH_TOOLS_MIN = 10;        // floors on day one's real breadth. Floors, never ceilings.
const BREADTH_STATIONS_MIN = 8;
const BREADTH_CONNECTIONS_MIN = 40;
const BREADTH_NAMES_MIN = 30;
const SCALE_ENTRIES = 5000;          // a batch this big compiles and grows the web, untrimmed
const SCALE_MS = 4000;
const NPC_SEEDS = 60;

const CERT = (uid: string, name = 'TESTER') => ({
  metadata: { uid, displayName: name, createdAt: 0 },
  publicKey: {} as any,
  publicKeyJWK: {} as any
}) as any;

const defOf = (defId: string) => (RESOURCE_DEFINITIONS[defId] ?? CRAFTED_DEFINITIONS[defId]) as any;
const mint = (defId: string, key: string, opts?: any): IItem => ItemFactory.createResourceItem(defOf(defId), Rng.fromKey(key), opts);
const many = (defId: string, n: number, key: string) => Array.from({ length: n }, (_, i) => mint(defId, `${key}:${i}`));
const toolOf = (baseId: string, key: string) => ItemFactory.createItem(UniversalRank.F, true, Rng.fromKey(key), 'tool', baseId);

const hub = () => useHubStore.getState();
const store = () => usePlayerStore.getState();
const player = () => store().player;
const stash = () => player().bank.stashTabs[0].items;
const setStash = (items: IItem[], gold = 30_000) => usePlayerStore.setState(s => ({
  player: { ...s.player, bank: { ...s.player.bank, gold, stashTabs: [{ name: 'MAIN', items }] } }
}));
const finishBuilds = async () => {
  useHubStore.setState(s => ({ buildJobs: s.buildJobs.map(j => ({ ...j, finishesAt: 0 })) }));
  await hub().resolveBuilds();
};
const finishCrafts = async () => {
  useHubStore.setState(s => ({ craftingJobs: s.craftingJobs.map(j => ({ ...j, finishesAt: 0 })) }));
  await hub().resolveCrafts();
};

let uidCounter = 0;
const newAvatar = (name = 'TESTER') => {
  const uid = `uid_web_${++uidCounter}`;
  useIdentityStore.setState({ certificate: CERT(uid, name) } as any);
  store().initializeSession(CERT(uid, name), 'NOMAD');
  return uid;
};

let hubCounter = 0;
async function freshHub(): Promise<string[]> {
  useHubStore.setState({ activeHubId: null, lots: [], craftingJobs: [], rooms: {}, buildJobs: [], web: { nodes: {} } } as any);
  await hub().loadHub(`hub_web_${++hubCounter}`);
  return hub().lots.map(l => l.id);
}

/** A session in a one-chunk world holding one node, with these tools in the pack. */
function fieldWith(defId: string, tools: IItem[], energy = 100_000, uses = 100_000): string {
  const id = `ent_test_${defId}`;
  const entity: IWorldEntity = {
    id, type: EntityType.RESOURCE, definitionId: defId, position: { x: 0, y: 0 },
    rank: UniversalRank.F, rarity: Rarity.COMMON, usesRemaining: uses
  };
  useWorldStore.setState({
    currentMap: { seed: 'web_test_world', width: 1, height: 1, gridVersion: 2, sectors: {}, generatedAt: 0, chunks: { '0,0': { id: '0,0', x: 0, y: 0, entities: [entity] } } }
  } as any);
  usePlayerStore.setState(s => ({
    player: {
      ...s.player,
      currentSession: {
        sessionId: `sess_${uidCounter}`, layerId: 'l', inventory: [...tools], kitItemIds: tools.map(t => t.id),
        health: 100, maxHealth: 100, energy, position: { x: 0, y: 0, z: 0 }, statusEffects: []
      }
    }
  }));
  return id;
}
const harvest = (id: string, times = 1) => {
  for (let i = 0; i < times; i++) {
    usePlayerStore.setState(s => s.player.currentSession ? ({ player: { ...s.player, currentSession: { ...s.player.currentSession, inventory: s.player.currentSession.inventory.filter(it => it.tags?.includes('tool')) } } }) : s);
    store().performInteraction(`int_harvest_${id}`, id);
  }
};
const held = (id: string) => player().bank.universalSkills[id];
const FELLING = () => WebSystem.mint(['axe'], defOf('res_tree_log').tags).id;

const grantSkill = (tags: string[], xp = 0): ISkillState => {
  const id = TagLaw.skillIdOf(tags);
  const skill = WebSystem.freshSkill(id, tags, 0);
  const lifted = WebSystem.withCumulativeXp(skill, xp);
  usePlayerStore.setState(s => ({ player: { ...s.player, bank: { ...s.player.bank, universalSkills: { ...s.player.bank.universalSkills, [id]: lifted } } } }));
  return lifted;
};

/** A batch that adds a tool, a material and a station no code has ever heard of. */
const STRANGER = (runId = 'run_stranger', extra: Partial<IWebBatch> = {}): IWebBatch => ({
  runId,
  model: 'test',
  ranAt: 1,
  tags: [
    { tag: 'froe', kind: 'tool', meaning: 'A wedge blade driven with a mallet to split staves.' },
    { tag: 'bark', kind: 'material', meaning: 'The outer skin of a tree, stripped whole.' },
    { tag: 'strip', kind: 'verb', meaning: 'To peel a skin away from what it covers.' }
  ],
  tools: [{ id: 'tool_froe_t1', name: 'Froe', tag: 'froe', rank: UniversalRank.F, basePower: 10, powerStat: 'chopping_power', works: ['bark'], verbs: [{ verb: 'strip', rung: 0 }] }],
  materials: [{ id: 'mat_bark', name: 'Stripped Bark', tags: ['flora', 'bark'], rank: UniversalRank.F, rarity: Rarity.COMMON, weight: 0.5 }],
  stations: [{ id: 'stn_barkshed', name: 'Bark Shed', connection: { tool: ['froe'], material: ['bark'] }, bill: [{ tag: 'building', count: 2 }], minArea: 14, weight: 12, width: 2, height: 1 }],
  names: [{ tags: ['bark', 'flora', 'froe'], name: 'Bark-Stripping' }],
  ...extra
});
const withStranger = (): IWebPack => {
  const compiled = WebBank.compile([...WEB_BATCHES, STRANGER()]);
  expect(compiled.ok, compiled.reason).toBe(true);
  return compiled.pack!;
};

// Every source file, for the bars that read the code itself.
const sourceFiles = (() => {
  const out: { path: string; text: string }[] = [];
  const walk = (d: string) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.tsx?$/.test(f)) out.push({ path: p.replace(/\\/g, '/'), text: readFileSync(p, 'utf8') });
    }
  };
  walk('src');
  walk('shared');
  return out;
})();
const source = (suffix: string) => sourceFiles.find(f => f.path.endsWith(suffix))!.text;

beforeEach(() => {
  db.clear();
  newAvatar();
});

// =============================================================================
// LINE 67: THE TAG LAW, CLAUSE BY CLAUSE
// =============================================================================

describe('line 67, clause 1: one registry', () => {
  const pack = () => WebBank.current();
  const registered = () => new Set(pack().tags.map(e => e.tag));

  it('every tag has its kind and a one-line meaning', () => {
    for (const entry of pack().tags) {
      expect(entry.kind in TAG_KIND_IDENTITY, entry.tag).toBe(true);
      expect(entry.meaning.trim().length, entry.tag).toBeGreaterThan(5);
      expect(entry.meaning.includes('\n'), entry.tag).toBe(false);
    }
  });

  it('every tag in every definition and every batch is registered', () => {
    expect(WebBank.unregisteredTags(pack())).toEqual([]);
  });

  it('every tag written anywhere in the source is registered too', () => {
    const literal = /(?:\btags|allowedTags|accepts|requiredToolTags|toolTags|xpTags)"?\s*:\s*\[([^\]]*)\]/g;
    const reads = /(?:tags|Tags)\??\.includes\(\s*['"]([^'"]+)['"]/g;
    const stray: string[] = [];
    for (const file of sourceFiles) {
      if (file.path.endsWith('ContentPipeline.ts')) continue; // a prompt's placeholder text, never a tag: on the record
      if (file.path.endsWith('firstTheme.ts')) continue; // a theme registers its own words, under the theme law
      if (file.path.endsWith('webBatches.ts') || file.path.endsWith('WebSystem.ts')) continue; // the registry itself, and the closed legacy table
      for (const m of file.text.matchAll(literal)) {
        for (const t of m[1].matchAll(/['"]([^'"]+)['"]/g)) if (!registered().has(t[1])) stray.push(`${file.path}: ${t[1]}`);
      }
      for (const m of file.text.matchAll(reads)) if (!registered().has(m[1])) stray.push(`${file.path}: ${m[1]}`);
    }
    expect(stray).toEqual([]);
  });

  it('a tag not in the registry is refused, and the whole batch falls with it', () => {
    const batch = STRANGER('run_bad', { materials: [
      { id: 'mat_fine', name: 'Fine', tags: ['flora', 'bark'], rank: UniversalRank.F, rarity: Rarity.COMMON, weight: 1 },
      { id: 'mat_rogue', name: 'Rogue', tags: ['flora', 'never_registered'], rank: UniversalRank.F, rarity: Rarity.COMMON, weight: 1 }
    ] });
    const verdict = WebBank.validateBatch(batch, pack());
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toContain('never_registered');
    expect(WebBank.compile([...WEB_BATCHES, batch]).ok).toBe(false);
  });

  it('the registry is versioned: an older version compiles byte-identical when a batch is added', () => {
    const v = WebBank.version();
    const before = fnv1a(JSON.stringify(WebBank.packAt(v)));
    const after = WebBank.compile([...WEB_BATCHES, STRANGER()]);
    expect(after.pack!.version).toBe(v + 1);
    expect(fnv1a(JSON.stringify(WebBank.packAt(v)))).toBe(before);
    expect(WebBank.packAt(1)!.version).toBe(1);
  });
});

describe('line 67, clause 2: one meaning, one spelling, forever', () => {
  const tryTag = (tag: string, meaning = 'A brand new thing that means something else.') =>
    WebBank.validateBatch({ runId: 'run_var', model: 'test', ranAt: 1, tags: [{ tag, kind: 'material', meaning }] }, WebBank.current());

  it('an exact duplicate is refused', () => expect(tryTag('wood').ok).toBe(false));

  it('variants of case, plural and separator are refused', () => {
    for (const v of ['WOOD', 'Wood', 'woods', 'axes', 'AXE', 'berries', 'glasses', 'Laser-Cutter', 'laser cutter', 'lasercutter', 'LASER_CUTTER', 'cutter_laser', 'mining-lasers']) {
      expect(tryTag(v).ok, v).toBe(false);
    }
  });

  it('a spelling that is not the normal form is refused even when new', () => {
    for (const v of ['Fresh', 'fresh tag', 'fresh-tag', 'fresh+tag', ' fresh', '9fresh', '']) expect(tryTag(v).ok, JSON.stringify(v)).toBe(false);
    expect(tryTag('fresh_tag').ok).toBe(true);
  });

  it('the words a tag refuses cannot be registered as synonyms', () => {
    for (const v of ['timber', 'lumber', 'rock', 'boulder', 'pick']) expect(tryTag(v).ok, v).toBe(false);
  });

  it('a second tag cannot register a meaning already held, word for word', () => {
    const wood = WebBank.tagEntry(WebBank.current(), 'wood')!;
    expect(tryTag('fresh_tag', wood.meaning).ok).toBe(false);
  });

  it('no two registered tags are variants of each other', () => {
    const tags = WebBank.current().tags.map(e => e.tag);
    for (let i = 0; i < tags.length; i++) for (let j = i + 1; j < tags.length; j++) {
      expect(TagLaw.areVariants(tags[i], tags[j]), `${tags[i]} / ${tags[j]}`).toBe(false);
    }
  });

  it('a retired tag stays on the books and its spelling is never reused', () => {
    const retired = WebBank.current().tags.filter(e => e.retired);
    expect(retired.map(e => e.tag)).toEqual(expect.arrayContaining(['crafting', 'improvisation', 'science']));
    for (const entry of retired) expect(tryTag(entry.tag).ok, entry.tag).toBe(false);
  });

  it('no live definition or source line uses a retired tag', () => {
    const retired = new Set(WebBank.current().tags.filter(e => e.retired).map(e => e.tag));
    const stray: string[] = [];
    const defs = [...Object.values(RESOURCE_DEFINITIONS), ...Object.values(CRAFTED_DEFINITIONS), ...ITEM_DEFINITIONS.weapon_bases, ...ITEM_DEFINITIONS.armor_bases, ...ITEM_DEFINITIONS.tool_bases, ...CRAFTED_GEAR_BASES] as any[];
    for (const def of defs) for (const t of def.tags ?? []) if (retired.has(t)) stray.push(`${def.id}: ${t}`);
    for (const file of sourceFiles) {
      if (file.path.endsWith('webBatches.ts') || file.path.endsWith('WebSystem.ts')) continue;
      for (const t of retired) if (new RegExp(`(?:tags|xpTags):\\s*\\[[^\\]]*['"]${t}['"]`).test(file.text)) stray.push(`${file.path}: ${t}`);
    }
    expect(stray).toEqual([]);
  });

  it('the audit\'s finding is fixed: a trade name no longer sits on a good as if it were a material', () => {
    expect(defOf('crf_stone_block').tags).not.toContain('masonry');
    const trades = new Set(WebBank.current().tags.filter(e => e.kind === 'trade').map(e => e.tag));
    for (const def of [...Object.values(RESOURCE_DEFINITIONS), ...Object.values(CRAFTED_DEFINITIONS)] as any[]) {
      for (const t of def.tags ?? []) expect(trades.has(t), `${def.id}: ${t}`).toBe(false);
    }
  });
});

describe('line 67, clause 3: identity is the canonical set', () => {
  it('same set, same id, in any order of arrival, with any repeats', () => {
    const tags = ['axe', 'flora', 'wood'];
    const id = TagLaw.skillIdOf(tags);
    const rng = Rng.fromKey('shuffle');
    for (let i = 0; i < 500; i++) {
      const shuffled = [...tags, ...tags.slice(0, rng.int(0, 3))].sort(() => rng.next() - 0.5);
      expect(TagLaw.skillIdOf(shuffled)).toBe(id);
    }
  });

  it('the id reads back to exactly its tags, and the round trip is exact', () => {
    const id = TagLaw.skillIdOf(['wood', 'axe', 'flora']);
    expect(TagLaw.parseSkillId(id)).toEqual(['axe', 'flora', 'wood']);
    expect(TagLaw.skillIdOf(TagLaw.parseSkillId(id)!)).toBe(id);
  });

  it('what the older tracks were always called is what the law computes', () => {
    expect(TagLaw.skillIdOf(['carpentry'])).toBe('skill_carpentry');
    expect(TagLaw.skillIdOf(['identify_weapon'])).toBe('skill_identify_weapon');
    expect(ProcessSystem.familySkill('smithing')).toBe(TagLaw.skillIdOf(['smithing']));
    expect(StudySystem.scopeSkillId('furniture')).toBe(TagLaw.skillIdOf(['identify_furniture']));
  });

  it('an empty set has no identity at all', () => {
    expect(() => TagLaw.skillIdOf([])).toThrow();
    expect(TagLaw.parseSkillId('skill_')).toBeNull();
    expect(TagLaw.parseSkillId('itm_abc')).toBeNull();
  });
});

describe('line 67, clause 4: no throwaway identity', () => {
  it('a mint does not read the clock, a random value or a counter', () => {
    const random = vi.spyOn(Math, 'random');
    const now = vi.spyOn(Date, 'now');
    const first = WebSystem.mint(['axe'], defOf('res_tree_log').tags).id;
    random.mockReturnValue(0.123); now.mockReturnValue(999);
    const second = WebSystem.mint(['axe'], defOf('res_tree_log').tags).id;
    expect(second).toBe(first);
    expect(random).not.toHaveBeenCalled();
    expect(now).not.toHaveBeenCalled();
    random.mockRestore(); now.mockRestore();
  });

  it('insertion order of the registry changes no id', () => {
    const shuffled: IWebBatch[] = WEB_BATCHES.map(b => ({ ...b, tags: [...(b.tags ?? [])].reverse() }));
    const pack = WebBank.compile(shuffled);
    expect(pack.ok, pack.reason).toBe(true);
    expect(WebSystem.mint(['pickaxe'], defOf('res_iron_vein').tags, pack.pack!).id)
      .toBe(WebSystem.mint(['pickaxe'], defOf('res_iron_vein').tags).id);
  });

  it('the web\'s own law files hold no uuid, no Math.random and no counter behind an id', () => {
    for (const suffix of ['logic/content/TagLaw.ts', 'logic/content/WebBank.ts', 'logic/systems/WebSystem.ts', 'logic/systems/NpcSheet.ts', 'entities/player/systems/SkillDiscovery.ts']) {
      const text = source(suffix);
      expect(text, suffix).not.toMatch(/randomUUID|Math\.random|uuid\(|nanoid/);
    }
    const law = source('logic/content/TagLaw.ts');
    expect(law).not.toMatch(/Date\.now|performance\.now/);
  });

  it('every skill a store door creates has an id the law can read back', () => {
    store().practiceTrade('carpentry');
    store().gainSkillXp('skill_identify_tool', 5, ['study']);
    grantSkill(['axe', 'flora', 'wood']);
    for (const [id, skill] of Object.entries(player().bank.universalSkills)) {
      const tags = TagLaw.parseSkillId(id);
      expect(tags, id).not.toBeNull();
      expect(skill.tags).toEqual(tags);
      for (const tag of tags!) expect(WebBank.isIdentityTag(WebBank.current(), tag), tag).toBe(true);
    }
  });

  it('a door handed a made-up id refuses it and creates nothing', () => {
    store().gainSkillXp('skill_made_up_by_hand', 10, ['study']);
    store().gainSkillXp('8f14e45f-ceea-467d-a8e5-ffd3a2fb0d71', 10, ['study']);
    expect(Object.keys(player().bank.universalSkills)).toEqual([]);
  });
});

describe('line 67, clause 5: only identity tags identify', () => {
  it('each kind states whether it identifies, and the identity kinds are the ones the law names', () => {
    expect(TAG_KIND_IDENTITY.tool).toBe(true);
    expect(TAG_KIND_IDENTITY.material).toBe(true);
    expect(TAG_KIND_IDENTITY.family).toBe(true);
    expect(TAG_KIND_IDENTITY.trade).toBe(true);
    expect(TAG_KIND_IDENTITY.action).toBe(true);
    expect(TAG_KIND_IDENTITY.descriptive).toBe(false);
    expect(TAG_KIND_IDENTITY.magnitude).toBe(false);
    expect(TAG_KIND_IDENTITY.use).toBe(false);
    expect(TAG_KIND_IDENTITY.verb).toBe(false);
  });

  it('crafted, heavy, rare, salvage and their like are registered as not identifying', () => {
    for (const tag of ['crafted', 'heavy', 'light', 'rare', 'salvage', 'improvised', 'masterwork', 'generic', 'one_hand', 'two_hand', 'grunt', 'elite', 'boss', 'building', 'food', 'station', 'tool']) {
      expect(WebBank.isIdentityTag(WebBank.current(), tag), tag).toBe(false);
    }
  });

  it('a descriptive tag never splits a skill', () => {
    const base = WebSystem.mint(['pickaxe'], ['mineral', 'ore', 'metal']).id;
    expect(WebSystem.mint(['pickaxe'], ['mineral', 'ore', 'metal', 'rare']).id).toBe(base);
    expect(WebSystem.mint(['pickaxe', 'tool', 'mining'], ['mineral', 'ore', 'metal', 'crafted', 'heavy', 'salvage']).id).toBe(base);
  });

  it('rank rides beside the identity: iron and titanium are one skill, and the deeper rank is kept', () => {
    const iron = WebSystem.mint(['pickaxe'], defOf('res_iron_vein').tags);
    const titanium = WebSystem.mint(['pickaxe'], defOf('res_titanium_vein').tags);
    expect(titanium.id).toBe(iron.id);
    const id = fieldWith('res_titanium_vein', [toolOf('tool_pick_tempered_t3', 'tp')]);
    harvest(id);
    expect(player().skillProgress![iron.id].rank).toBe(ProgressionSystem.rankIndex(UniversalRank.C));
  });

  it('a tool\'s own class word does not count as its identity', () => {
    const axe = toolOf('tool_axe_field_t1', 'axe');
    expect(WebSystem.toolIdentity(axe.tags)).toEqual(['axe']);
  });
});

describe('line 67, clause 6: the word is not the identity', () => {
  const renamed = () => WebBank.compile([...WEB_BATCHES, { runId: 'run_rename', model: 'test', ranAt: 1, names: [{ tags: ['axe', 'flora', 'wood'], name: 'Timber-Dropping' }] }]);

  it('a later batch may rename a skill, and nothing about what it is changes', () => {
    const pack = renamed();
    expect(pack.ok, pack.reason).toBe(true);
    const id = FELLING();
    expect(WebSystem.nameOf(id, pack.pack!)).toBe('Timber-Dropping');
    expect(WebSystem.nameOf(id)).not.toBe('Timber-Dropping');
    expect(WebSystem.mint(['axe'], defOf('res_tree_log').tags, pack.pack!).id).toBe(id);
    expect(WebSystem.nodeOf(id, pack.pack!).tags).toEqual(WebSystem.nodeOf(id).tags);
  });

  it('a name\'s tags must all identify: a name cannot smuggle a descriptive tag into the set', () => {
    const bad: IWebBatch = { runId: 'run_badname', model: 'test', ranAt: 1, names: [{ tags: ['axe', 'heavy', 'wood'], name: 'Heavy Felling' }] };
    expect(WebBank.validateBatch(bad, WebBank.current()).ok).toBe(false);
  });

  it('an unnamed pair still reads as words, derived from its tags', () => {
    const word = WebSystem.nameOf(TagLaw.skillIdOf(['pickaxe', 'seed']));
    expect(word.toLowerCase()).toContain('pickaxe');
    expect(word.toLowerCase()).toContain('seed');
  });
});

describe('line 67, clause 7: existing saves migrate without loss', () => {
  const save = (skills: Record<string, Partial<ISkillState>>) => ({
    ...player(),
    bank: { ...player().bank, universalSkills: Object.fromEntries(Object.entries(skills).map(([id, s]) => [id, { id, level: 1, currentXp: 0, tags: [], scalingAttribute: 'intelligence', ...s }])) }
  }) as any;
  const total = (skills: Record<string, ISkillState>) =>
    Object.values(skills).reduce((n, s) => n + ProgressionSystem.getXpForLevel(s.level) + s.currentXp, 0);

  it('every id of the old fixed table arrives at a lawful id with its level and xp', () => {
    const old = ['skill_swordsmanship', 'skill_bludgeoning', 'skill_ballistics', 'skill_pyromancy', 'skill_pain_tolerance', 'skill_aegis', 'skill_athletics', 'skill_covert_ops', 'skill_archaeology', 'skill_reverse_engineering', 'skill_appraisal'];
    const before = save(Object.fromEntries(old.map((id, i) => [id, { level: i + 2, currentXp: 7 + i }])));
    const after = WebSystem.migrate(before).bank.universalSkills;
    expect(Object.keys(after).length).toBe(old.length);
    for (const id of Object.keys(after)) expect(TagLaw.parseSkillId(id), id).not.toBeNull();
    expect(total(after)).toBe(total(before.bank.universalSkills));
    for (const legacy of old) expect(after[legacy], legacy).toBeUndefined();
  });

  it('a harvest track from the old fallback lands on the identity its own record names', () => {
    const before = save({ skill_gathering_theory: { level: 3, currentXp: 40, tags: ['gathering', 'strength', 'flora', 'wood', 'building'], origin: { timestamp: 5, triggerAction: 'gathering + strength', location: 'Unknown', resonance: 10 } } });
    const after = WebSystem.migrate(before).bank.universalSkills;
    const id = TagLaw.skillIdOf(['flora', 'wood']);
    expect(after[id].level).toBe(3);
    expect(after[id].currentXp).toBe(40);
    expect(after[id].origin?.timestamp).toBe(5);
  });

  it('two old tracks landing on one identity lose nothing', () => {
    const before = save({
      skill_pain_tolerance: { level: 2, currentXp: 30 },
      skill_defense_theory: { level: 2, currentXp: 50, tags: ['defense'] }
    });
    const after = WebSystem.migrate(before).bank.universalSkills;
    expect(Object.keys(after)).toEqual([TagLaw.skillIdOf(['defense'])]);
    expect(total(after)).toBe(total(before.bank.universalSkills));
  });

  it('the tracks the law already computes are untouched, byte for byte', () => {
    const before = save({ skill_carpentry: { level: 4, currentXp: 11, tags: ['craft', 'carpentry'] }, skill_identify_weapon: { level: 2, currentXp: 3, tags: ['study', 'intel'] } });
    const after = WebSystem.migrate(before).bank.universalSkills;
    expect(after.skill_carpentry.level).toBe(4);
    expect(after.skill_carpentry.currentXp).toBe(11);
    expect(after.skill_identify_weapon.level).toBe(2);
  });

  it('a track nothing can read is kept whole under its old name, marked, and off the web', () => {
    const before = save({ skill_existence_theory: { level: 2, currentXp: 9, tags: [] } });
    const after = WebSystem.migrate(before).bank.universalSkills;
    expect(after.skill_existence_theory.level).toBe(2);
    expect(after.skill_existence_theory.currentXp).toBe(9);
    expect(after.skill_existence_theory.legacy).toBe(true);
    expect(WebSystem.heldSkills(after).map(s => s.id)).not.toContain('skill_existence_theory');
  });

  it('migration runs twice as once, and the boot and the import both run it', () => {
    const before = save({ skill_swordsmanship: { level: 3, currentXp: 12 }, skill_existence_theory: { level: 1, currentXp: 2 } });
    const once = WebSystem.migrate(before);
    expect(WebSystem.migrate(once)).toEqual(once);
    expect(source('logic/initialization/StartupSequence.ts')).toMatch(/WebSystem\.migrate/);
    // An imported doc keeps its signature bytes, then the app reloads: the boot's door is the import's door too.
    expect(source('components/IdentityGate.tsx')).toMatch(/importAvatar[\s\S]{0,120}window\.location\.reload/);
  });
});

// =============================================================================
// LINE 68: NOTHING CAPS THE WEB
// =============================================================================

describe('line 68: new tools, materials and batches grow the web with no code change', () => {
  it('a stranger\'s tool, material and station arrive as content, and the web grows', () => {
    const before = WebBank.current();
    const after = withStranger();
    expect(after.tools.length).toBe(before.tools.length + 1);
    expect(after.stations.length).toBe(before.stations.length + 1);
    expect(WebBank.connections(after).length).toBeGreaterThan(WebBank.connections(before).length);

    const skill = WebSystem.mint(['froe'], ['flora', 'bark'], after);
    expect(skill.id).toBe(TagLaw.skillIdOf(['bark', 'flora', 'froe']));
    expect(WebSystem.nameOf(skill.id, after)).toBe('Bark-Stripping');
    const node = WebSystem.nodeOf(skill.id, after);
    expect(node.verbs).toContain('strip');
    expect(node.benches).toContain('stn_barkshed');

    const holder = { [skill.id]: WebSystem.freshSkill(skill.id, skill.tags, 0) };
    expect(WebSystem.openStations(holder, after).map(s => s.id)).toContain('stn_barkshed');
    expect(WebSystem.openStations(holder, before).map(s => s.id)).not.toContain('stn_barkshed');
  });

  it('a tool that exists only in a batch mints as a real item', () => {
    const pack = withStranger();
    const item = WebBank.mintTool(pack, 'tool_froe_t1', Rng.fromKey('froe'));
    expect(item.universalDefinitionId).toBe('tool_froe_t1');
    expect(item.tags).toEqual(expect.arrayContaining(['tool', 'froe']));
    expect(WebSystem.toolIdentity(item.tags, pack)).toEqual(['froe']);
    expect(item.stats.chopping_power).toBeGreaterThan(0);
  });

  it('nothing limits a batch: thousands of tools, materials and stations compile and all of them connect', () => {
    const tags: NonNullable<IWebBatch['tags']> = [];
    const tools: NonNullable<IWebBatch['tools']> = [];
    const materials: NonNullable<IWebBatch['materials']> = [];
    const stations: NonNullable<IWebBatch['stations']> = [];
    const word = (n: number) => n.toString(26).split('').map(c => String.fromCharCode(97 + parseInt(c, 26))).join('');
    for (let i = 0; i < SCALE_ENTRIES; i++) {
      const t = `tl${word(i)}x`, m = `mt${word(i)}x`;
      tags.push({ tag: t, kind: 'tool', meaning: `Generated tool number ${i}.` }, { tag: m, kind: 'material', meaning: `Generated material number ${i}.` });
      tools.push({ id: `tool_${t}`, name: t, tag: t, rank: UniversalRank.F, basePower: 10, powerStat: 'chopping_power', works: [m], verbs: [] });
      materials.push({ id: `mat_${m}`, name: m, tags: [m], rank: UniversalRank.F, rarity: Rarity.COMMON, weight: 1 });
      stations.push({ id: `stn_${t}`, name: t, connection: { tool: [t], material: [m] }, bill: [{ tag: 'building', count: 1 }], minArea: 4, weight: 1, width: 1, height: 1 });
    }
    const t0 = Date.now();
    const result = WebBank.compile([...WEB_BATCHES, { runId: 'run_huge', model: 'test', ranAt: 1, tags, tools, materials, stations }]);
    expect(result.ok, result.reason).toBe(true);
    const connections = WebBank.connections(result.pack!);
    expect(connections.length).toBeGreaterThanOrEqual(SCALE_ENTRIES);
    expect(result.pack!.tools.length).toBeGreaterThanOrEqual(SCALE_ENTRIES);
    expect(Date.now() - t0).toBeLessThan(SCALE_MS);
  });

  it('no table of tools, materials or verbs hides in the law: its files name none of them', () => {
    const pack = WebBank.current();
    const content = new Set(pack.tags.filter(e => ['tool', 'material', 'verb', 'family'].includes(e.kind)).map(e => e.tag));
    for (const suffix of ['logic/systems/WebSystem.ts', 'logic/content/WebBank.ts', 'logic/content/TagLaw.ts', 'logic/systems/NpcSheet.ts', 'entities/player/systems/SkillDiscovery.ts']) {
      let text = source(suffix);
      // The one closed table: dead ids of the old fixed skill list, migration only, on the record.
      text = text.replace(/\/\/ <legacy-table>[\s\S]*?\/\/ <\/legacy-table>/, '');
      const named = [...content].filter(tag => new RegExp(`['"\`]${tag}['"\`]`).test(text));
      expect(named, suffix).toEqual([]);
    }
    expect(sourceFiles.some(f => /FACTOR_DOMAIN/.test(f.text))).toBe(false);
  });

  it('the old fixed table is gone from SkillDiscovery', () => {
    const text = source('entities/player/systems/SkillDiscovery.ts');
    for (const word of ['skill_swordsmanship', 'skill_bludgeoning', 'skill_pyromancy', 'skill_athletics', '_theory']) expect(text).not.toContain(word);
  });
});

describe('line 68: the batch law (D20)', () => {
  it('the shipped batches are lawful, version by version, and each names its model', () => {
    for (let v = 1; v <= WebBank.version(); v++) {
      expect(WebBank.packAt(v), `v${v}`).not.toBeNull();
      expect(WebBank.packAt(v)!.batches[v - 1].model.length).toBeGreaterThan(3);
    }
    expect(new Set(WEB_BATCHES.map(b => b.runId)).size).toBe(WEB_BATCHES.length);
  });

  it('an empty run, a repeated run and a repeated id are each refused whole', () => {
    const pack = WebBank.current();
    expect(WebBank.validateBatch({ runId: 'run_empty', model: 'm', ranAt: 1 }, pack).ok).toBe(false);
    expect(WebBank.validateBatch(STRANGER(WEB_BATCHES[0].runId), pack).ok).toBe(false);
    const dup = STRANGER('run_dup', { stations: [{ ...STRANGER().stations![0], id: pack.stations[0].id }] });
    expect(WebBank.validateBatch(dup, pack).ok).toBe(false);
  });

  it('a tool must be a tool, a material must identify, a station must connect a tool and a material', () => {
    const pack = WebBank.current();
    const notTool = STRANGER('run_a', { tools: [{ ...STRANGER().tools![0], tag: 'heavy' }] });
    expect(WebBank.validateBatch(notTool, pack).ok).toBe(false);
    const noIdentity = STRANGER('run_b', { materials: [{ ...STRANGER().materials![0], tags: ['heavy', 'crafted'] }] });
    expect(WebBank.validateBatch(noIdentity, pack).ok).toBe(false);
    const noTool = STRANGER('run_c', { stations: [{ ...STRANGER().stations![0], connection: { tool: [], material: ['bark'] } }] });
    expect(WebBank.validateBatch(noTool, pack).ok).toBe(false);
    const noMaterial = STRANGER('run_d', { stations: [{ ...STRANGER().stations![0], connection: { tool: ['froe'], material: [] } }] });
    expect(WebBank.validateBatch(noMaterial, pack).ok).toBe(false);
  });

  it('a recipe must stand on known ground: its station, its inputs and outputs, its trade', () => {
    const pack = WebBank.current();
    const recipe = pack.recipes[0];
    const orphan = STRANGER('run_e', { recipes: [{ ...recipe, id: 'recipe_orphan', requiredStation: 'stn_nowhere' }] });
    expect(WebBank.validateBatch(orphan, pack).ok).toBe(false);
    const stranger = STRANGER('run_f', { recipes: [{ ...recipe, id: 'recipe_strange', inputs: [{ itemId: 'nothing_at_all', quantity: 1, consume: true }] }] });
    expect(WebBank.validateBatch(stranger, pack).ok).toBe(false);
    const noTrade = STRANGER('run_g', { recipes: [{ ...recipe, id: 'recipe_notrade', trade: 'heavy' }] });
    expect(WebBank.validateBatch(noTrade, pack).ok).toBe(false);
  });

  it('the pipeline harness judges a web batch by the same law', () => {
    const script = readFileSync('scripts/run-affix-batch.ts', 'utf8');
    expect(script).toMatch(/WebBank\.validateBatch/);
    expect(script).toMatch(/WEB_BATCHES/);
  });

  it('the current pack signs into the content namespace', async () => {
    const doc = await bankAndSignWeb('uid_signer');
    expect(doc?.signature).toBeTruthy();
    expect(doc?.pack.version).toBe(WebBank.version());
    expect(db.get(`content:content_web_pack_v${WebBank.version()}`)).toBeTruthy();
  });

  it('day one has real breadth, and it is not a cap', () => {
    const pack = WebBank.current();
    expect(pack.tools.length).toBeGreaterThanOrEqual(BREADTH_TOOLS_MIN);
    expect(pack.stations.length).toBeGreaterThanOrEqual(BREADTH_STATIONS_MIN);
    expect(WebBank.connections(pack).length).toBeGreaterThanOrEqual(BREADTH_CONNECTIONS_MIN);
    expect(pack.names.length).toBeGreaterThanOrEqual(BREADTH_NAMES_MIN);
    const trades = new Set(pack.recipes.map(r => r.trade));
    expect(trades.size).toBeGreaterThanOrEqual(5);
  });

  it('every shipped station can really open: some tool and material in the web reach its connection', () => {
    const pack = WebBank.current();
    const skills = WebBank.connections(pack).map(c => c.skillId);
    for (const station of pack.stations) {
      const holder = Object.fromEntries(skills.map(id => [id, WebSystem.freshSkill(id, TagLaw.parseSkillId(id)!, 0)]));
      expect(WebSystem.openStations(holder, pack).map(s => s.id), station.id).toContain(station.id);
    }
  });

  it('every web recipe is value-positive, and the sourcing audit still closes over the new goods', () => {
    const pack = WebBank.current();
    for (const recipe of pack.recipes) {
      const inputs = recipe.inputs.flatMap(i => Array.from({ length: i.quantity }, () => CompositionSystem.root({ id: i.itemId, name: defOf(i.itemId)?.name ?? i.itemId }, 'HARVEST')));
      const made = recipe.outputs.reduce((n, o) => n + o.quantity, 0);
      const comp = CompositionSystem.compose({ recipeId: recipe.id, name: recipe.name, laborSeconds: recipe.laborTimeSeconds, facility: recipe.requiredFacility }, inputs, made);
      const worth = CompositionSystem.priceOf(comp) * made;
      const cost = inputs.reduce((n, c) => n + CompositionSystem.priceOf(c), 0);
      expect(worth, recipe.id).toBeGreaterThan(cost);
    }
    expect(SourcingAudit.run().filter(r => !r.closed).map(r => `${r.defId}: ${r.problems.join('; ')}`)).toEqual([]);
    const reach = SourcingAudit.reachableFromRaw();
    for (const goods of pack.goods) expect(reach.has(goods.id), goods.id).toBe(true);
    for (const station of pack.stations) expect(reach.has(station.id), station.id).toBe(true);
  });
});

// =============================================================================
// LINE 63: THE MINT
// =============================================================================

describe('line 63: a tool on a material mints a skill from that pair', () => {
  it('the same pair always mints the same skill', () => {
    const a = WebSystem.mint(['axe'], defOf('res_tree_log').tags);
    for (let i = 0; i < 50; i++) expect(WebSystem.mint(['axe'], defOf('res_tree_log').tags)).toEqual(a);
    expect(a.tags).toEqual(['axe', 'flora', 'wood']);
  });

  it('a different tool or a different material is a different skill', () => {
    const felling = WebSystem.mint(['axe'], defOf('res_tree_log').tags).id;
    expect(WebSystem.mint(['saw'], defOf('res_tree_log').tags).id).not.toBe(felling);
    expect(WebSystem.mint(['axe'], defOf('res_rock_small').tags).id).not.toBe(felling);
  });

  it('bare hands add nothing: the hand skill IS the material, and it sits under every tool skill', () => {
    const hand = WebSystem.mint(null, defOf('res_tree_log').tags);
    expect(WebSystem.mint([], defOf('res_tree_log').tags)).toEqual(hand);
    expect(hand.tags).toEqual(['flora', 'wood']);
    const tool = WebSystem.mint(['axe'], defOf('res_tree_log').tags);
    expect(hand.tags.every(t => tool.tags.includes(t))).toBe(true);
    const placed = WebSystem.placeInWeb(tool.id, [hand.id]);
    expect(placed.narrower).toContain(hand.id);
    expect(WebSystem.placeInWeb(hand.id, [tool.id]).broader).toContain(tool.id);
  });

  it('a harvest through the real door mints from the tool in hand and the node under it', () => {
    const id = fieldWith('res_tree_log', [toolOf('tool_axe_field_t1', 'axe')]);
    harvest(id);
    expect(Object.keys(player().skillProgress ?? {})).toEqual([FELLING()]);
  });

  it('a bare-handed harvest mints the hand skill', () => {
    const id = fieldWith('res_berry_bush', []);
    harvest(id);
    expect(Object.keys(player().skillProgress ?? {})).toEqual([TagLaw.skillIdOf(['berry', 'flora'])]);
  });

  it('a tool that works a hand-gathered material mints with that tool, by the tool\'s own data', () => {
    const pack = WebBank.current();
    const sickle = pack.tools.find(t => t.works.includes('grain'));
    expect(sickle).toBeTruthy();
    const id = fieldWith('res_grain_wild', [WebBank.mintTool(pack, sickle!.id, Rng.fromKey('sickle'))]);
    harvest(id);
    expect(Object.keys(player().skillProgress ?? {})).toEqual([TagLaw.skillIdOf([sickle!.tag, 'flora', 'grain'])]);
  });

  it('a bench job mints from its trade and what it consumed', async () => {
    const [lotId] = await freshHub();
    setStash(many('res_tree_log', 7, 'bench'));
    expect(await hub().buyLot(lotId)).toBe(true);
    expect(await hub().buildStructure(lotId, 'WORKSHOP')).toBe(true);
    await finishBuilds();
    await hub().queueCraft(lotId, 'recipe_plank');
    await finishCrafts();
    expect(Object.keys(player().skillProgress ?? {})).toContain(TagLaw.skillIdOf(['carpentry', 'flora', 'wood']));
  });

  it('the action contexts of combat and talk mint by the same law', () => {
    expect(SkillDiscovery.discoverSkill({ tags: ['melee', 'physical', 'violence', 'blade'], magnitude: 1 })).toBe(TagLaw.skillIdOf(['blade', 'melee']));
    expect(SkillDiscovery.discoverSkill({ tags: ['social', 'charisma'], magnitude: 1 })).toBe(TagLaw.skillIdOf(['social']));
    expect(SkillDiscovery.discoverSkill({ tags: ['melee', 'blade'], targetTags: ['grunt', 'mechanical', 'flying'], magnitude: 1 })).toBe(TagLaw.skillIdOf(['blade', 'mechanical', 'melee']));
  });

  it('an action context with nothing that identifies mints nothing', () => {
    expect(SkillDiscovery.discoverSkill({ tags: ['violence', 'strength'], magnitude: 1 })).toBeNull();
    const before = JSON.stringify(player().skillProgress ?? {});
    store().processAction({ tags: ['violence', 'strength'], magnitude: 10 });
    expect(JSON.stringify(player().skillProgress ?? {})).toBe(before);
  });

  it('D6 keeps working: use grows a held track, and three ranks over the task still opens it', () => {
    store().practiceTrade('carpentry');
    expect(held('skill_carpentry').level).toBe(1);
    store().gainSkillXp('skill_carpentry', 1000, ['craft']);
    expect(held('skill_carpentry').level).toBeGreaterThan(1);
    expect(ProgressionSystem.checkSkill(UniversalRank.SS, UniversalRank.B)).toEqual({ autoSuccess: true, gap: 3 });
    expect(ProgressionSystem.checkSkill(UniversalRank.C, UniversalRank.B).autoSuccess).toBe(false);
  });
});

// =============================================================================
// LINE 64: THE AUTO SKILL
// =============================================================================

describe('line 64: working without the skill accrues; it emerges only at a rest', () => {
  it('no skill appears in the field, however long you work', () => {
    const id = fieldWith('res_tree_log', [toolOf('tool_axe_field_t1', 'axe')]);
    harvest(id, 60);
    expect(held(FELLING())).toBeUndefined();
    expect(player().skillProgress![FELLING()].attempts).toBe(60);
    expect(Object.keys(player().bank.universalSkills)).toEqual([]);
  });

  it('winging it costs more than knowing it, and the card says so', () => {
    const axe = toolOf('tool_axe_field_t1', 'axe');
    const base = defOf('res_tree_log').harvestConfig.energyCost;
    const id = fieldWith('res_tree_log', [axe], 1000);
    harvest(id);
    const winged = 1000 - player().currentSession!.energy;
    expect(winged).toBeGreaterThan(base);

    grantSkill(WebSystem.mint(['axe'], defOf('res_tree_log').tags).tags);
    const id2 = fieldWith('res_tree_log', [axe], 1000);
    harvest(id2);
    expect(1000 - player().currentSession!.energy).toBe(base);

    const entity = useWorldStore.getState().currentMap!.chunks['0,0'].entities[0];
    const known = inspectEntity(entity, { player: player(), dist: 1, level: () => 2 });
    expect(known.rows.find(r => r[0] === 'Cost')![1]).toContain(`${base} energy`);
    usePlayerStore.setState(s => ({ player: { ...s.player, bank: { ...s.player.bank, universalSkills: {} } } }));
    const blind = inspectEntity(entity, { player: player(), dist: 1, level: () => 2 });
    expect(blind.rows.find(r => r[0] === 'Cost')![1]).toContain('winging');
  });

  it('a bench job winged takes longer than one known', async () => {
    const [lotId] = await freshHub();
    setStash(many('res_tree_log', 8, 'clock'));
    await hub().buyLot(lotId);
    await hub().buildStructure(lotId, 'WORKSHOP');
    await finishBuilds();
    const clock = async () => {
      const t0 = Date.now();
      await hub().queueCraft(lotId, 'recipe_plank');
      const job = hub().craftingJobs[hub().craftingJobs.length - 1];
      await finishCrafts();
      return Math.round((job.finishesAt - t0) / 1000);
    };
    const winged = await clock();
    grantSkill(['carpentry', 'flora', 'wood']);
    const known = await clock();
    expect(winged).toBeGreaterThan(known);
    expect(known).toBeLessThanOrEqual(RECIPE_DEFINITIONS.recipe_plank.laborTimeSeconds);
  });

  it('a rest with too little behind it emerges nothing, whatever the key', () => {
    for (let i = 0; i < 40; i++) {
      newAvatar();
      const id = fieldWith('res_titanium_vein', [toolOf('tool_pick_tempered_t3', `t${i}`)]);
      harvest(id, 1);
      const { emerged } = WebSystem.rest({ ...player(), skillProgress: { ...player().skillProgress, [WebSystem.mint(['pickaxe'], defOf('res_titanium_vein').tags).id]: { ...player().skillProgress![WebSystem.mint(['pickaxe'], defOf('res_titanium_vein').tags).id], weight: 1 } } });
      expect(emerged).toEqual([]);
    }
  });

  it('the roll is keyed: the same state replays the same, across clocks and restarts', () => {
    const id = fieldWith('res_tree_log', [toolOf('tool_axe_field_t1', 'axe')]);
    harvest(id, 8);
    const state = player();
    const first = WebSystem.rest(state);
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.999);
    const now = vi.spyOn(Date, 'now').mockReturnValue(123456);
    const second = WebSystem.rest(state);
    random.mockRestore(); now.mockRestore();
    expect(second.emerged.map(s => s.id)).toEqual(first.emerged.map(s => s.id));
  });

  it('emergence is probable, not certain: across many hands some rests bring it and some do not', () => {
    const outcomes: boolean[] = [];
    for (let i = 0; i < 80; i++) {
      newAvatar();
      const id = fieldWith('res_tree_log', [toolOf('tool_axe_field_t1', 'axe')]);
      harvest(id, 4);
      outcomes.push(WebSystem.rest(player()).emerged.length > 0);
    }
    expect(outcomes.some(Boolean)).toBe(true);
    expect(outcomes.some(o => !o)).toBe(true);
  });

  it('a failed rest cannot be re-rolled: only more work buys another roll', () => {
    let tries = 0;
    let found = false;
    while (!found && tries < 200) {
      newAvatar(); tries++;
      const id = fieldWith('res_tree_log', [toolOf('tool_axe_field_t1', 'axe')]);
      harvest(id, 3);
      const out = WebSystem.rest(player());
      if (out.emerged.length > 0) continue;
      found = true;
      for (let again = 0; again < 20; again++) expect(WebSystem.rest(out.player).emerged).toEqual([]);
      expect(out.player.skillProgress![FELLING()].attempts).toBe(3);
    }
    expect(found).toBe(true);
  });

  it('enough work always tells: the chance climbs with persistence', () => {
    let brought = 0;
    for (let i = 0; i < 30; i++) {
      newAvatar();
      const id = fieldWith('res_tree_log', [toolOf('tool_axe_field_t1', 'axe')]);
      harvest(id, 60);
      if (WebSystem.rest(player()).emerged.length > 0) brought++;
    }
    expect(brought).toBeGreaterThanOrEqual(20);
  });

  it('the emerged skill joins the holder, leaves the forming list, and then grows by use', () => {
    let uid = '';
    let emerged = false;
    for (let i = 0; i < 40 && !emerged; i++) {
      uid = newAvatar();
      const id = fieldWith('res_tree_log', [toolOf('tool_axe_field_t1', 'axe')]);
      harvest(id, 40);
      const out = WebSystem.rest(player());
      if (out.emerged.length > 0) {
        usePlayerStore.setState({ player: out.player });
        emerged = true;
        expect(held(FELLING()).level).toBe(1);
        expect(held(FELLING()).tags).toEqual(['axe', 'flora', 'wood']);
        expect(player().skillProgress?.[FELLING()]).toBeUndefined();
        const xp0 = WebSystem.cumulativeXp(held(FELLING()));
        harvest(id, 5);
        expect(WebSystem.cumulativeXp(held(FELLING()))).toBeGreaterThan(xp0);
        expect(player().skillProgress?.[FELLING()]).toBeUndefined();
      }
    }
    expect(emerged, uid).toBe(true);
  });

  it('D30: the seal, the death and the withdrawal are the rests, and nowhere else calls one', () => {
    const canvas = source('components/WorldCanvas.tsx') + source('components/ReconView.tsx');
    expect((canvas.match(/restAndCredit\(/g) ?? []).length).toBe(3);
    expect(canvas).toMatch(/restAndCredit\('SEALED'\)/);
    expect(canvas).toMatch(/restAndCredit\('DIED'\)/);
    expect(canvas).toMatch(/restAndCredit\('WITHDREW'\)/);
    // D43: every rest settles through one door, chosen or not
    const callers = sourceFiles.filter(f => /WebSystem\.rest\(/.test(f.text)).map(f => f.path);
    expect(callers.length).toBe(1);
    expect(callers[0]).toMatch(/RestSystem\.ts$/);
    expect(source('entities/hub/store.ts')).toMatch(/RestDoor\.settle\(\)/);
  });

  it('the forming list is a fill, never a number the player could read as the bar', () => {
    const id = fieldWith('res_tree_log', [toolOf('tool_axe_field_t1', 'axe')]);
    harvest(id, 2);
    const sheet = WebSystem.earnedSheet(player());
    expect(sheet.forming.length).toBe(1);
    const row = sheet.forming[0];
    expect(row.fill).toBeGreaterThan(0);
    expect(row.fill).toBeLessThanOrEqual(1);
    expect(Object.keys(row).sort()).toEqual(['fill', 'name', 'tool', 'worked'].sort());
  });
});

// =============================================================================
// MASTERY: rungs reveal more of the material, through the one ledger
// =============================================================================

describe('mastery: rungs join the reveal law', () => {
  const pair = () => WebSystem.mint(['axe'], defOf('res_tree_log').tags);
  const lift = (xp: number) => {
    grantSkill(pair().tags, xp);
    usePlayerStore.setState(s => ({ player: WebSystem.revealByMastery(s.player, pair().id) }));
  };
  const knowledge = () => player().materialMastery.res_tree_log;

  it('four rungs in order, by what the doing has added up to, and the deck only climbs', () => {
    expect(MASTERY_RUNGS).toEqual(['named', 'handled', 'graded', 'attuned']);
    expect(RUNG_XP[0]).toBe(0);
    let last = -1;
    for (let xp = 0; xp < RUNG_XP[3] + 7; xp += 7) {
      const rung = WebSystem.masteryOf(WebSystem.withCumulativeXp(WebSystem.freshSkill('skill_axe', ['axe'], 0), xp)).rung;
      expect(rung).toBeGreaterThanOrEqual(last);
      last = rung;
    }
    expect(last).toBe(3);
  });

  it('named knows the name, and nothing more: no properties on the card', () => {
    lift(0);
    expect(knowledge().knowledgeLevel).toBe(1);
    const entity: any = { id: 'n', type: EntityType.RESOURCE, definitionId: 'res_tree_log', position: { x: 0, y: 0 }, rank: 'F', rarity: 'COMMON' };
    const card = inspectEntity(entity, { player: player(), dist: 1, level: WebSystem.knowledgeReader(player()) });
    expect(card.title).toBe('Hardwood Log');
    expect(card.rows.some(r => r[0] === 'Density')).toBe(false);
  });

  it('handled reveals base properties', () => {
    lift(RUNG_XP[1]);
    expect(knowledge().knowledgeLevel).toBe(2);
    const entity: any = { id: 'n', type: EntityType.RESOURCE, definitionId: 'res_tree_log', position: { x: 0, y: 0 }, rank: 'F', rarity: 'COMMON' };
    const card = inspectEntity(entity, { player: player(), dist: 1, level: WebSystem.knowledgeReader(player()) });
    expect(card.rows.some(r => r[0] === 'Density')).toBe(true);
  });

  it('graded reads what the material can become, on the item\'s own card', () => {
    const log = mint('res_tree_log', 'gr');
    expect(inspectItem(log, player()).rows.some(r => r[0] === 'Becomes')).toBe(false);
    lift(RUNG_XP[2]);
    expect(knowledge().graded).toBe(true);
    const row = inspectItem(log, player()).rows.find(r => r[0] === 'Becomes');
    expect(row?.[1]).toContain('Cut Plank');
  });

  it('attuned opens the hidden record: exactly the pools that can land on this material', () => {
    lift(RUNG_XP[3]);
    expect(knowledge().knowledgeLevel).toBe(3);
    const pools = WebSystem.hiddenPoolOf('res_tree_log');
    expect(pools.length).toBeGreaterThan(0);
    expect([...knowledge().discoveredAffixes].sort()).toEqual([...pools].sort());
    for (const id of pools) expect(LoadoutSystem.isAffixStudied(player(), id), id).toBe(true);
  });

  it('nothing beyond it opens: another material\'s record stays blind', () => {
    lift(RUNG_XP[3]);
    const own = new Set(WebSystem.hiddenPoolOf('res_tree_log'));
    const other = WebSystem.hiddenPoolOf('res_sand').filter(id => !own.has(id));
    expect(other.length).toBeGreaterThan(0);
    for (const id of other) expect(LoadoutSystem.isAffixStudied(player(), id), id).toBe(false);
  });

  it('a trade pair\'s mastery opens tiers of that trade through the same door D26 built', () => {
    const tags = ['carpentry', 'flora', 'wood'];
    grantSkill(tags, RUNG_XP[2]);
    usePlayerStore.setState(s => ({ player: WebSystem.revealByMastery(s.player, TagLaw.skillIdOf(tags)) }));
    const known = player().materialMastery.process_carpentry?.discoveredAffixes ?? [];
    expect(known.length).toBeGreaterThan(0);
    const smelting = player().materialMastery.process_smelting?.discoveredAffixes ?? [];
    expect(smelting).toEqual([]);
  });

  it('the one ledger: no second knowledge store appears on the player', () => {
    const before = Object.keys(player()).sort();
    lift(RUNG_XP[3]);
    const after = Object.keys(player()).filter(k => !before.includes(k));
    expect(after).toEqual([]);
    expect(Object.keys(player().materialMastery)).toContain('res_tree_log');
  });

  it('a use that crosses a rung reveals on its own, through the store door', () => {
    grantSkill(pair().tags, RUNG_XP[1] - 1);
    const id = fieldWith('res_tree_log', [toolOf('tool_axe_field_t1', 'axe')]);
    harvest(id, 3);
    expect(knowledge().knowledgeLevel).toBeGreaterThanOrEqual(2);
  });

  it('a card on a material the holder never worked stays at the name: the default moved from 2 to 1', () => {
    const entity: any = { id: 'n', type: EntityType.RESOURCE, definitionId: 'res_iron_vein', position: { x: 0, y: 0 }, rank: 'E', rarity: 'COMMON' };
    const card = inspectEntity(entity, { player: player(), dist: 1, level: WebSystem.knowledgeReader(player()) });
    expect(card.title).toBe('Iron Ore');
    expect(card.rows.some(r => r[0] === 'Hardness')).toBe(false);
    expect(source('components/WorldCanvas.tsx')).not.toMatch(/knowledgeLevel \?\? 2/);
  });
});

// =============================================================================
// LINE 65: THE WEB
// =============================================================================

describe('line 65: a skill is a node, and its edges come from structure', () => {
  const pack = () => WebBank.current();

  it('a node carries verbs, tool, benches and links, all derived', () => {
    const node = WebSystem.nodeOf(FELLING());
    expect(node.id).toBe(FELLING());
    expect(node.tools).toEqual(['axe']);
    expect(node.materials).toEqual(['flora', 'wood']);
    expect(node.verbs.length).toBeGreaterThan(0);
    expect(node.benches.length).toBeGreaterThan(0);
  });

  it('siblings share a tool or a bench; kin share a material; broader and narrower are subset and superset', () => {
    const axeWood = WebSystem.mint(['axe'], defOf('res_tree_log').tags).id;
    const axeStone = WebSystem.mint(['axe'], defOf('res_rock_small').tags).id;
    const sawWood = WebSystem.mint(['saw'], defOf('res_tree_log').tags).id;
    const handWood = WebSystem.mint(null, defOf('res_tree_log').tags).id;
    const stranger = TagLaw.skillIdOf(['ink']);
    const placed = WebSystem.placeInWeb(axeWood, [axeStone, sawWood, handWood, stranger]);
    expect(placed.siblings).toContain(axeStone);
    expect(placed.kin).toContain(sawWood);
    expect(placed.narrower).toContain(handWood);
    expect([...placed.siblings, ...placed.kin, ...placed.narrower, ...placed.broader]).not.toContain(stranger);
    expect(placed.connected).toBe(true);
    expect(WebSystem.placeInWeb(stranger, [axeWood]).connected).toBe(false);
  });

  it('verbs come from the tool\'s data, and more of them with mastery', () => {
    const tool = pack().tools.find(t => t.verbs.some(v => v.rung > 0))!;
    expect(tool).toBeTruthy();
    const tags = [tool.tag, tool.works[0]];
    const low = WebSystem.verbsOf(tags, 0);
    const high = WebSystem.verbsOf(tags, 3);
    expect(high.length).toBeGreaterThan(low.length);
    for (const v of low) expect(high).toContain(v);
  });

  it('a verb is legal only when a held skill carries it, read off whoever holds it', () => {
    const tool = pack().tools.find(t => t.verbs.length > 0)!;
    const verb = tool.verbs[0].verb;
    expect(WebSystem.hasVerb({}, verb)).toBe(false);
    const id = TagLaw.skillIdOf([tool.tag, tool.works[0]]);
    const skill = WebSystem.freshSkill(id, TagLaw.parseSkillId(id)!, 0);
    expect(WebSystem.hasVerb({ [id]: skill }, verb)).toBe(true);
  });
});

describe('line 65: a further station opens through the connection, at the seam', () => {
  const station = () => WebBank.current().stations.find(s => s.connection.tool.includes('axe') && s.connection.material.includes('wood'))!;
  const openIt = () => grantSkill(WebSystem.mint(['axe'], defOf('res_tree_log').tags).tags);

  it('the first bench is still the first bench: D25 untouched', () => {
    expect(shellBillFor('WORKSHOP', false)).toEqual(SHELL_BILLS.WORKSHOP.filter(l => l.tag === 'building'));
    expect(shellBillFor('WORKSHOP', true)).toEqual(SHELL_BILLS.WORKSHOP);
    expect(shellBillFor('HOUSE', true)).toEqual(SHELL_BILLS.HOUSE);
  });

  it('a fitted bench asks the further bench\'s bill plus the fitting\'s own', () => {
    const s = station();
    expect(s).toBeTruthy();
    expect(shellBillFor('WORKSHOP', true, s)).toEqual([...SHELL_BILLS.WORKSHOP, ...s.bill]);
  });

  it('nothing is open to someone who holds nothing', () => {
    expect(WebSystem.openStations(player().bank.universalSkills)).toEqual([]);
  });

  it('holding the tool without the material, or the material without the tool, opens nothing', () => {
    const s = station();
    const toolOnly = TagLaw.skillIdOf(['axe', 'stone']);
    const materialOnly = TagLaw.skillIdOf(['flora', 'wood']);
    const holder = { [toolOnly]: WebSystem.freshSkill(toolOnly, ['axe', 'stone'], 0), [materialOnly]: WebSystem.freshSkill(materialOnly, ['flora', 'wood'], 0) };
    expect(WebSystem.openStations(holder).map(o => o.id)).not.toContain(s.id);
  });

  it('holding the pair opens it', () => {
    openIt();
    expect(WebSystem.openStations(player().bank.universalSkills).map(o => o.id)).toContain(station().id);
  });

  async function fitted(open: boolean) {
    const [first, second] = await freshHub();
    setStash([...many('res_tree_log', 6, 'f1'), ...many('crf_plank', 20, 'f2'), ...many('crf_iron_ingot', 6, 'f3'), ...many('crf_stone_block', 10, 'f4')], 100_000);
    await hub().buyLot(first);
    expect(await hub().buildStructure(first, 'WORKSHOP', 'res_tree_log')).toBe(true);
    await finishBuilds();
    const bench = stash().find(i => i.universalDefinitionId === 'stn_bench')!;
    expect((await hub().placeItem(first, bench.id, 6, 3, false)).ok).toBe(true);
    await hub().buyLot(second);
    if (open) openIt();
    return second;
  }

  it('the builder refuses a closed fitting, and spends nothing', async () => {
    const lot = await fitted(false);
    const before = stash().length;
    const gold = player().bank.gold;
    expect(await hub().buildStructure(lot, 'WORKSHOP', 'crf_plank', station().id)).toBe(false);
    expect(stash().length).toBe(before);
    expect(player().bank.gold).toBe(gold);
  });

  it('an open fitting raises, mints that station, and pays its bill exactly once', async () => {
    const lot = await fitted(true);
    const s = station();
    const held0 = stash().length;
    const billed = shellBillFor('WORKSHOP', true, s).reduce((n, l) => n + l.count, 0);
    expect(await hub().buildStructure(lot, 'WORKSHOP', 'crf_plank', s.id)).toBe(true);
    expect(stash().length).toBe(held0 - billed);
    await finishBuilds();
    expect(stash().filter(i => i.universalDefinitionId === s.id).length).toBe(1);
    expect(hub().lots.find(l => l.id === lot)!.structureType).toBe('WORKSHOP');
  });

  it('the station stands by its own numbers, and more technology asks for more room (D8)', () => {
    const s = station();
    expect(isStation(s.id)).toBe(true);
    expect(stationMinAreaOf(s.id)).toBe(s.minArea);
    expect(stationFunctionOf(s.id)).toBe('WORKSHOP');
    expect(stationMinAreaOf('stn_bench')).toBe(12);
    const areas = WebBank.current().stations.map(x => x.minArea);
    expect(Math.max(...areas)).toBeGreaterThan(stationMinAreaOf('stn_bench')!);
  });

  it('a recipe of that station refuses until the station stands in the room and a held skill carries its verb', async () => {
    const pack = WebBank.current();
    const s = station();
    const recipe = pack.recipes.find(r => r.requiredStation === s.id && r.requiresVerb)!;
    expect(recipe).toBeTruthy();
    const lot = await fitted(true);
    await hub().buildStructure(lot, 'WORKSHOP', 'crf_plank', s.id);
    await finishBuilds();
    const inputs = recipe.inputs.flatMap(i => many(i.itemId, i.quantity * 3, `in:${i.itemId}`));
    usePlayerStore.setState(st => ({ player: { ...st.player, bank: { ...st.player.bank, stashTabs: [{ name: 'MAIN', items: [...st.player.bank.stashTabs[0].items, ...inputs] }] } } }));

    expect(await hub().queueCraft(lot, recipe.id)).toBe(false); // the station is still in the stash
    const item = stash().find(i => i.universalDefinitionId === s.id)!;
    expect((await hub().placeItem(lot, item.id, 2, 2, false)).ok).toBe(true);

    usePlayerStore.setState(st => ({ player: { ...st.player, bank: { ...st.player.bank, universalSkills: {} } } }));
    expect(await hub().queueCraft(lot, recipe.id)).toBe(false); // no held skill carries the verb

    const carrier = WebSystem.skillsCarrying(recipe.requiresVerb!, pack)[0];
    grantSkill(TagLaw.parseSkillId(carrier)!, RUNG_XP[3]);
    expect(await hub().queueCraft(lot, recipe.id)).toBe(true);
    await finishCrafts();
    for (const out of recipe.outputs) expect(stash().some(i => i.universalDefinitionId === out.itemId), out.itemId).toBe(true);
    const made = stash().find(i => i.universalDefinitionId === recipe.outputs[0].itemId)!;
    expect(made.composition!.steps.some(st => st.recipeId === recipe.id)).toBe(true);
  });

  it('a job at a further station is done with whichever of its tools the hands know', () => {
    const recipe = WebBank.current().recipes.find(r => r.requiredStation === station().id)!;
    const inputs = recipe.inputs.map(i => i.itemId);
    const first = WebSystem.pairOfJob(recipe.id, inputs);
    const sawing = WebSystem.mint(['saw'], inputs.flatMap(i => defOf(i).tags));
    const knows = { [sawing.id]: WebSystem.freshSkill(sawing.id, sawing.tags, 0) };
    expect(first!.tags).toContain(station().connection.tool[0]);
    expect(WebSystem.pairOfJob(recipe.id, inputs, knows)!.id).toBe(sawing.id);
  });

  it('a station from a batch nobody coded opens the same way', () => {
    const pack = withStranger();
    const id = TagLaw.skillIdOf(['bark', 'flora', 'froe']);
    expect(WebSystem.openStations({ [id]: WebSystem.freshSkill(id, ['bark', 'flora', 'froe'], 0) }, pack).map(s => s.id)).toEqual(['stn_barkshed']);
  });

  it('the seam holds no list: room.ts names no web station', () => {
    const text = source('entities/hub/room.ts');
    for (const s of WebBank.current().stations) expect(text, s.id).not.toContain(s.id);
  });
});

describe('line 65: looted items teach, by reverse engineering', () => {
  const blade = () => ItemFactory.createItem(UniversalRank.F, true, Rng.fromKey('loot_blade'), 'weapon', 'wpn_sword_1h_t1');

  it('an item is read back into the skills it implies: its own node, and what its designs name', () => {
    const read = WebSystem.reverseEngineer(blade());
    expect(read.carried).toBe(TagLaw.skillIdOf(['blade', 'melee']));
    expect(read.designs.length).toBeGreaterThan(0);
    for (const d of read.designs) expect(TagLaw.parseSkillId(d.skillId)).not.toBeNull();
    expect(WebSystem.reverseEngineer(blade())).toEqual(read);
  });

  it('plain cargo teaches nothing', () => {
    expect(WebSystem.reverseEngineer(mint('res_sand', 'cargo')).designs).toEqual([]);
  });

  it('a sitting at the bench accrues toward what the piece implies, and emerges only at a rest', () => {
    setStash([blade()]);
    const item = stash()[0];
    const before = player().skillProgress ?? {};
    expect(store().studyItemAtStation(item.id).ok).toBe(true);
    const design = WebSystem.reverseEngineer(item).designs[0];
    expect((player().skillProgress ?? {})[design.skillId].attempts).toBe((before[design.skillId]?.attempts ?? 0) + 1);
    expect(held(design.skillId)).toBeUndefined();
  });

  it('what it teaches opens a station no other road gives', () => {
    const design = WebSystem.reverseEngineer(blade()).designs[0];
    const holder = { [design.skillId]: WebSystem.freshSkill(design.skillId, TagLaw.parseSkillId(design.skillId)!, 0) };
    expect(WebSystem.openStations(holder).length).toBeGreaterThan(0);
  });
});

describe('line 65: who found it first, signed', () => {
  async function restUntilFirst(): Promise<string> {
    await freshHub();
    for (let i = 0; i < 40; i++) {
      newAvatar('FIRST');
      const id = fieldWith('res_tree_log', [toolOf('tool_axe_field_t1', 'axe')]);
      harvest(id, 40);
      const out = await hub().restAndCredit('SEALED');
      if (out.length > 0) return player().id;
    }
    throw new Error('nothing emerged in forty tries');
  }

  it('the first to reach a tech is credited in the hub\'s web and in a signed ledger row', async () => {
    const uid = await restUntilFirst();
    const node = hub().web.nodes[FELLING()];
    expect(node.firstBy.uid).toBe(uid);
    expect(node.firstBy.name).toBe('FIRST');
    const rows = await Ledger.list(uid);
    const row = rows.find(r => r.payload.type === 'TECH' && r.payload.data.skillId === FELLING());
    expect(row).toBeTruthy();
    expect(row!.signature).toBe(`sig_${uid}`);
    expect(row!.payload.data.kind).toBe('FIRST');
  });

  it('the first keeps the claim: a later hand gets the skill and no credit', async () => {
    const uid = await restUntilFirst();
    let second = '';
    for (let i = 0; i < 40; i++) {
      second = newAvatar('SECOND');
      const id = fieldWith('res_tree_log', [toolOf('tool_axe_field_t1', 'axe')]);
      harvest(id, 40);
      const out = await hub().restAndCredit('SEALED');
      if (out.length > 0) break;
    }
    expect(held(FELLING())).toBeTruthy();
    expect(hub().web.nodes[FELLING()].firstBy.uid).toBe(uid);
    expect((await Ledger.list(second)).some(r => r.payload.type === 'TECH')).toBe(false);
  });

  it('a new rung record is a row of its own, credited to whoever reached it', async () => {
    const uid = await restUntilFirst();
    grantSkill(WebSystem.mint(['axe'], defOf('res_tree_log').tags).tags, RUNG_XP[1]);
    await hub().creditMastery(FELLING());
    expect(hub().web.nodes[FELLING()].rungRecord.rung).toBe(1);
    expect(hub().web.nodes[FELLING()].rungRecord.uid).toBe(uid);
    const rows = await Ledger.list(uid);
    expect(rows.some(r => r.payload.type === 'TECH' && r.payload.data.kind === 'RUNG' && r.payload.data.rung === 1)).toBe(true);
  });

  it('the credit reads as lore on the holder\'s record', async () => {
    await restUntilFirst();
    const topics = Object.keys(player().bank.lore);
    expect(topics.some(t => t.includes(WebSystem.nameOf(FELLING())))).toBe(true);
  });

  it('the row moves no gold: the audit still balances', async () => {
    const uid = await restUntilFirst();
    await Ledger.append('CHARACTER_GENESIS', { gold: player().bank.gold });
    const audit = await GoldAudit.run();
    expect(audit.expectedPlayerGold).toBe(audit.actualPlayerGold);
    expect((await Ledger.list(uid)).filter(r => r.payload.type === 'TECH').every(r => r.payload.data.amount === undefined)).toBe(true);
  });

  it('the web survives a reload of the hub', async () => {
    await restUntilFirst();
    const hubId = hub().activeHubId!;
    const before = hub().web;
    useHubStore.setState({ web: { nodes: {} } } as any);
    await hub().loadHub(hubId);
    expect(hub().web).toEqual(before);
  });

  it('the decision: the web is the hub\'s, the exp is the person\'s', async () => {
    const [, lot] = await freshHub();
    for (let i = 0; i < 40 && !hub().web.nodes[FELLING()]; i++) {
      newAvatar('FIRST');
      const id = fieldWith('res_tree_log', [toolOf('tool_axe_field_t1', 'axe')]);
      harvest(id, 40);
      await hub().restAndCredit('SEALED');
    }
    const firstHands = held(FELLING());
    expect(firstHands).toBeTruthy();

    newAvatar('NEIGHBOUR');
    expect(Object.keys(player().bank.universalSkills)).toEqual([]); // no exp came across
    const open = hub().openStationsNow().map(s => s.id);
    expect(open.length).toBeGreaterThan(0); // and yet the hub knows how
    setStash([...many('crf_plank', 20, 'n1'), ...many('crf_iron_ingot', 6, 'n2'), mint('stn_bench', 'n3'), ...many('crf_stone_block', 10, 'n4')], 100_000);
    expect(await hub().buyLot(lot)).toBe(true);
    expect(await hub().buildStructure(lot, 'WORKSHOP', 'crf_plank', open[0])).toBe(true);
  });

  it('a person can carry the web out of a hub that never met it: own hands open too', async () => {
    await freshHub();
    grantSkill(WebSystem.mint(['axe'], defOf('res_tree_log').tags).tags);
    expect(hub().openStationsNow().length).toBeGreaterThan(0);
  });

  it('a skill held before this hub existed enters its web when the hub next looks', async () => {
    grantSkill(WebSystem.mint(['axe'], defOf('res_tree_log').tags).tags);
    await freshHub();
    expect(hub().web.nodes[FELLING()]?.firstBy.uid).toBe(player().id);
  });
});

// =============================================================================
// LINE 66: NPC SHEETS
// =============================================================================

describe('line 66: an NPC carries stats and skills derived from its seed', () => {
  const npcEntity = (id: string, rank = UniversalRank.F): IWorldEntity => ({
    id, type: EntityType.NPC, definitionId: 'npc_survivor', position: { x: 0, y: 0 }, rank, rarity: Rarity.COMMON, isHostile: false,
    npc: { name: 'Mara Quill', temperament: 'PASSIVE', objective: 'SURVIVE', want: 'GIFT', disposition: 50, attempts: 0 }
  });

  it('same seed and entity, the same sheet, byte for byte', () => {
    const a = NpcSheet.read('seed_a', npcEntity('ent_1'), 1);
    const b = NpcSheet.read('seed_a', npcEntity('ent_1'), 1);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('another seed or another person reads differently', () => {
    const base = JSON.stringify(NpcSheet.read('seed_a', npcEntity('ent_1'), 1).stats);
    const sheets = Array.from({ length: NPC_SEEDS }, (_, i) => JSON.stringify(NpcSheet.read(`seed_${i}`, npcEntity(`ent_${i}`), 1).stats));
    expect(new Set(sheets).size).toBeGreaterThan(NPC_SEEDS / 2);
    expect(sheets).not.toEqual(Array(NPC_SEEDS).fill(base));
  });

  it('every attribute is on the sheet, and every nature of one rank totals the same', () => {
    const total = (s: Record<string, number>) => Object.values(s).reduce((n, v) => n + v, 0);
    const first = NpcSheet.read('s0', npcEntity('e0'), 1).stats!;
    for (const attr of [...PHYSICAL_ATTRIBUTES, ...MENTAL_ATTRIBUTES]) expect(typeof first[attr]).toBe('number');
    for (let i = 0; i < NPC_SEEDS; i++) {
      expect(total(NpcSheet.read(`s${i}`, npcEntity(`e${i}`), 1).stats as any)).toBe(total(first as any));
    }
  });

  it('rank shows: a higher-ranked person has more behind them, in stats and in skills', () => {
    const low = NpcSheet.read('s', npcEntity('e', UniversalRank.F), WebBank.version());
    const high = NpcSheet.read('s', npcEntity('e', UniversalRank.A), WebBank.version());
    const total = (s: any) => Object.values(s).reduce((n: number, v: any) => n + v, 0);
    expect(total(high.stats)).toBeGreaterThan(total(low.stats) as number);
    expect(Object.keys(high.skills!).length).toBeGreaterThan(Object.keys(low.skills!).length);
  });

  it('their skills are skills: lawful ids, the player\'s record shape, read through the same web', () => {
    const sheet = NpcSheet.read('s1', npcEntity('e1', UniversalRank.C), WebBank.version());
    const skills = sheet.skills!;
    expect(Object.keys(skills).length).toBeGreaterThan(0);
    for (const [id, skill] of Object.entries(skills)) {
      expect(TagLaw.parseSkillId(id)).toEqual(skill.tags);
      expect(WebSystem.nodeOf(id).id).toBe(id);
      expect(WebSystem.masteryOf(skill).rung).toBeGreaterThanOrEqual(0);
    }
    const open = WebSystem.openStations(skills);
    expect(Array.isArray(open)).toBe(true);
    const verbs = Object.values(skills).flatMap(s => WebSystem.verbsOf(s.tags, WebSystem.masteryOf(s).rung));
    for (const v of verbs) expect(WebSystem.hasVerb(skills, v)).toBe(true);
  });

  it('across many people, the web\'s breadth reaches them: many distinct skills and stations', () => {
    const ids = new Set<string>();
    const stations = new Set<string>();
    for (let i = 0; i < NPC_SEEDS * 3; i++) {
      const skills = NpcSheet.read(`w${i}`, npcEntity(`p${i}`, UniversalRank.B), WebBank.version()).skills!;
      Object.keys(skills).forEach(id => ids.add(id));
      WebSystem.openStations(skills).forEach(s => stations.add(s.id));
    }
    expect(ids.size).toBeGreaterThan(20);
    expect(stations.size).toBeGreaterThan(3);
  });

  it('the one-way door: a generated person\'s stored bytes hold no stats and no skills', () => {
    const context = SourcingAudit.worldContext();
    const map = WorldGenerator.generate('npc_scan', 16, context);
    const found: IWorldEntity[] = [];
    for (let cy = 0; cy < 256 && found.length === 0; cy += 1) for (let cx = 0; cx < 256 && found.length === 0; cx += 1) {
      const chunk = WorldGenerator.chunkAt(map, cx, cy, context);
      chunk?.entities.forEach(e => { if (e.type === EntityType.NPC) found.push(e); });
    }
    expect(found.length).toBeGreaterThan(0);
    expect(Object.keys(found[0].npc!).sort()).toEqual(['attempts', 'disposition', 'name', 'objective', 'temperament', 'want']);
    const sheet = NpcSheet.read('npc_scan', found[0], 1);
    expect(sheet.name).toBe(found[0].npc!.name);
    expect(sheet.stats).toBeTruthy();
  });

  it('the golden vectors have not moved, and neither has any pinned affix pack', () => {
    expect(runGoldenCheck().ok).toBe(true);
    for (const [v, hash] of Object.entries(PINNED_AFFIX_PACKS)) {
      expect(fnv1a(JSON.stringify(AffixBank.packAt(Number(v)))), `v${v}`).toBe(hash);
    }
    expect(AffixBank.version()).toBe(AFFIX_BATCHES.length);
  });

  it('a later batch cannot change a person in a pinned world', () => {
    const v = WebBank.version();
    const pinned = JSON.stringify(NpcSheet.read('s', npcEntity('e', UniversalRank.C), v));
    const later = withStranger();
    expect(later.version).toBe(v + 1);
    expect(JSON.stringify(NpcSheet.readWith('s', npcEntity('e', UniversalRank.C), WebBank.packAt(v)!))).toBe(pinned);
  });

  it('a world pins the web at mint; a world from before reads the first version forever', () => {
    expect(source('entities/world/WorldCertificate.ts')).toMatch(/webVersion:\s*WebBank\.version\(\)/);
    expect(NpcSheet.pinFor(undefined)).toBe(1);
    expect(NpcSheet.pinFor(3)).toBe(3);
    expect(JSON.stringify(NpcSheet.read('s', npcEntity('e'), undefined))).toBe(JSON.stringify(NpcSheet.read('s', npcEntity('e'), 1)));
  });

  it('the seam for Wave 11: a bond names the person, and the sheet reads back from it, the same', () => {
    const entity = npcEntity('ent_bond', UniversalRank.D);
    entity.npc = { ...entity.npc!, disposition: 90 };
    useWorldStore.setState({ currentMap: { seed: 'bond_world', width: 1, height: 1, gridVersion: 2, sectors: {}, generatedAt: 0, chunks: { '0,0': { id: '0,0', x: 0, y: 0, entities: [entity] } } } } as any);
    usePlayerStore.setState(s => ({ player: { ...s.player, currentSession: { sessionId: 'sess_bond', layerId: 'l', inventory: [], kitItemIds: [], health: 100, maxHealth: 100, energy: 100, position: { x: 0, y: 0, z: 0 }, statusEffects: [] } } }));
    store().performInteraction(`int_recruit_${entity.id}`, entity.id);
    // Q16: they walk beside you now, and the bond is written at the beacon
    FieldEscort.walkOut(worldPort);
    const bond = player().currentSession!.inventory.find(i => i.tags.includes('npc_contract'))!;
    expect(bond.bondData?.worldSeed).toBe('bond_world');
    expect(bond.bondData?.entityId).toBe('ent_bond');
    expect(JSON.stringify(NpcSheet.fromBond(bond))).toBe(JSON.stringify(NpcSheet.read('bond_world', entity, bond.bondData!.webVersion)));
  });

  it('the seam for Wave 11: a person brought home extends the hub\'s web, their exp stays theirs', () => {
    const sheet = NpcSheet.read('s2', npcEntity('e2', UniversalRank.B), WebBank.version());
    const { web, firsts } = WebSystem.admit({ nodes: {} }, { uid: 'npc:e2', name: sheet.name }, sheet.skills!, 77);
    expect(firsts.length).toBe(Object.keys(sheet.skills!).length);
    expect(Object.keys(web.nodes).sort()).toEqual(Object.keys(sheet.skills!).sort());
    expect(web.nodes[firsts[0]].firstBy.name).toBe('Mara Quill');
    expect(WebSystem.openStationsOf(web, {}).length).toBeGreaterThanOrEqual(WebSystem.openStations(sheet.skills!).length);
  });

  it('the field card says who they are good at being, only once you have spoken', () => {
    const entity = npcEntity('e3', UniversalRank.C);
    const ctx: any = { player: player(), dist: 1, level: () => 1, worldSeed: 'seed_card', webVersion: WebBank.version() };
    const silent = inspectEntity(entity, ctx);
    expect(silent.rows.some(r => r[0] === 'Hands')).toBe(false);
    entity.npc = { ...entity.npc!, attempts: 1 };
    const spoken = inspectEntity(entity, ctx);
    const row = spoken.rows.find(r => r[0] === 'Hands');
    expect(row).toBeTruthy();
    const sheet = NpcSheet.read('seed_card', entity, WebBank.version());
    const best = Object.keys(sheet.skills!).map(id => WebSystem.nameOf(id));
    expect(best.some(name => row![1].includes(name))).toBe(true);
  });
});

// =============================================================================
// THE PLAYER MUST SEE IT
// =============================================================================

describe('the Agent tab shows what has been earned, and hides what the law hides', () => {
  it('the sheet lists what is held, with rung, verbs and links, and the first\'s credit', () => {
    grantSkill(WebSystem.mint(['axe'], defOf('res_tree_log').tags).tags, RUNG_XP[1]);
    const web = { nodes: { [FELLING()]: { id: FELLING(), tags: ['axe', 'flora', 'wood'], rank: 0, firstBy: { uid: 'x', name: 'SOMEONE', at: 1 }, rungRecord: { rung: 1, uid: 'x', name: 'SOMEONE', at: 2 } } } };
    const sheet = WebSystem.earnedSheet(player(), WebBank.current(), web);
    expect(sheet.earned.length).toBe(1);
    const row = sheet.earned[0];
    expect(row.name).toBe(WebSystem.nameOf(FELLING()));
    expect(row.rung).toBe(1);
    expect(row.rungName).toBe('handled');
    expect(row.verbs.length).toBeGreaterThan(0);
    expect(row.firstBy).toBe('SOMEONE');
    expect(row.opens.length).toBeGreaterThan(0);
  });

  it('it never names what nobody holds: no closed station, no unearned pair', () => {
    const sheet = WebSystem.earnedSheet(player());
    expect(sheet.earned).toEqual([]);
    expect(sheet.forming).toEqual([]);
    expect(sheet.opens).toEqual([]);
  });

  it('it never carries a number from the knowledge law', () => {
    grantSkill(['carpentry', 'flora', 'wood'], RUNG_XP[3]);
    const text = JSON.stringify(WebSystem.earnedSheet(player()));
    const entries = AffixBank.current().entries.filter(e => e.statModifiers);
    for (const e of entries) expect(text).not.toContain(e.id);
    expect(text).not.toMatch(/emergenceDC|weight|statModifiers/);
  });

  it('the tab reads that sheet and shows rungs by shape, not hue', () => {
    const tab = source('components/PlayerHub.tsx');
    expect(tab).toMatch(/earnedSheet/);
    expect(tab).toMatch(/RungNotches/);
    expect(tab).not.toMatch(/emergenceDC/);
  });

  it('the skills tab reads names, not raw ids', () => {
    expect(source('components/PlayerHub.tsx')).toMatch(/WebSystem\.nameOf\(/);
  });
});
