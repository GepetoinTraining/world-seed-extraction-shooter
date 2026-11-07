/**
 * WAVE 10E BARS — registered before the banks exist (guardrail 1).
 * Test lines 52, 53, 55 and 56:
 *   52 affix banks grow by themed batches; an unstudied affix shows nothing on
 *      equip, and study reveals exactly what was banked
 *   53 a world populates from the banks during recon, deterministically for its
 *      seed and pinned pack version, and no later batch changes it
 *   55 identify is a skill: scoped by item type, trained at a workstation,
 *      usable in the field, always timed, faster with skill
 *   56 protection is an item: a death keeps exactly the slots the magic named,
 *      nothing more, and the receipt shows it
 * Plus the wave's own bars (PLAN 3B, Wave 10E): a bank batch loads, validates
 * and signs or is refused WHOLE (D20) — and the validation enforces D22's
 * partition (a mental affix only ever rolls on a cognitive frame; a batch that
 * puts mental stats on physical gear is refused whole, and the legacy pool is
 * purged of its Owl-family contraband); banks carry NEGATIVE offsets so peaks
 * run higher (D19); a bank entry starts as a NAME and does nothing until a
 * later batch defines its effect; two pack versions give measurably different
 * worlds and themed banks stay in theme measurably; insurance is a minted item
 * (D21) — charms with uses, scrolls on paper and ink with a clock — and cart
 * security affixes grow in the same banks (D16's addendum); D6's crafting
 * half: components carry their affixes onto the item they make, and a rank S+
 * craft lets the player name the thing.
 */

import { RestSystem } from '../src/logic/systems/RestSystem';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const db = new Map<string, any>();
vi.mock('../shared/entities/data/VectorStore', () => ({
  VectorNamespace: { CHARACTERS: 'characters', ITEMS: 'items', WORLDS: 'worlds', TRANSACTIONS: 'transactions', CONTENT: 'content', TERRITORIES: 'territories' },
  VectorStore: {
    get: async (_ns: string, id: string) => db.get(id) ?? null,
    put: async (doc: any) => { db.set(doc.id, doc); return true; },
    query: async () => [...db.values()],
    saveContent: async (id: string, type: string, content: any) => { db.set(id, { id, data: { type, content } }); return true; },
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

import { IAffixBatch, IBankedAffix, IItem, ItemType, MENTAL_ATTRIBUTES, Rarity, UniversalRank } from '../shared/types';
import { AffixBank } from '../shared/logic/content/AffixBank';
import { bankAndSignAffixes } from '../src/logic/content/BankSigning';
import { AFFIX_BATCHES } from '../shared/entities/generation/packs/affixBatches';
import { DreamingSystem } from '../shared/entities/world/Dreaming';
import { StudySystem } from '../src/logic/systems/StudySystem';
import {
  InsuranceSystem, CHARM_DEFINITIONS, SCROLL_DEFINITIONS, SCROLL_MINT_BILL
} from '../src/logic/systems/InsuranceSystem';
import { ItemFactory } from '../shared/entities/item/ItemFactory';
import { LootTable } from '../src/entities/world/LootTable';
import { LoadoutSystem } from '../shared/entities/player/systems/LoadoutSystem';
import { CartSystem } from '../src/entities/world/CartSystem';
import { MintRegistry } from '../shared/logic/economy/MintRegistry';
import { CompositionSystem } from '../shared/logic/economy/CompositionSystem';
import { AFFIX_DEFINITIONS } from '../shared/entities/item/data/affixDefinitions';
import { ITEM_DEFINITIONS, CRAFTED_GEAR_BASES } from '../shared/entities/item/data/itemDefinitions';
import { RESOURCE_DEFINITIONS } from '../shared/entities/item/data/resourceDefinitions';
import { GEAR_RECIPES, CRAFTED_DEFINITIONS } from '../shared/entities/economy/data/recipeDefinitions';
import { usePlayerStore } from '../src/entities/player/store';
import { useHubStore } from '../src/entities/hub/store';
import { useIdentityStore } from '../src/entities/identity/store';
import { BiomeType } from '../shared/entities/world/types';
import { Rng } from '../shared/logic/rng/DeterministicRNG';

// -----------------------------------------------------------------------------
// Bars, set before the build. Do not lower them to get a pass.
// -----------------------------------------------------------------------------
const THEME_PURITY = 1.0;          // every dreamed affix belongs to its biome's theme, GLOBAL or CART — no stray
const VERSION_DIFFERENCE_MIN = 0.3; // share of rolled items whose acting stats differ between pack v1 and v2
const IDENTIFY_FLOOR_SECONDS = 1;  // identify is ALWAYS timed: never below this, never zero
const MENTAL = new Set<string>(MENTAL_ATTRIBUTES as readonly string[]);

const CERT = (uid: string, name = 'TESTER') => ({
  metadata: { uid, displayName: name, createdAt: 0 },
  publicKey: {} as any,
  publicKeyJWK: {} as any
}) as any;

const grantStash = (items: IItem[]) => usePlayerStore.setState(s => ({
  player: { ...s.player, bank: { ...s.player.bank, stashTabs: s.player.bank.stashTabs.map((t, i) => i === 0 ? { ...t, items: [...t.items, ...items] } : t) } }
}));
const stash = () => usePlayerStore.getState().player.bank.stashTabs[0].items;
const mintRes = (defId: string, key: string): IItem =>
  ItemFactory.createResourceItem((RESOURCE_DEFINITIONS[defId] ?? CRAFTED_DEFINITIONS[defId]) as any, Rng.fromKey(key));

/** A rolled drop with at least one affix, minted from a dreamed pool. */
const rollAffixed = (pool: ReturnType<typeof DreamingSystem.poolFor>, key: string, tries = 64): IItem => {
  for (let i = 0; i < tries; i++) {
    const item = ItemFactory.createItem(UniversalRank.D, false, Rng.fromKey(`${key}:${i}`), 'weapon', undefined, pool);
    if (item.affixes.length > 0) return item;
  }
  throw new Error('no affixed roll in the budget — the pool or the rarity table broke');
};

beforeEach(() => {
  db.clear();
  localStorage.clear();
  MintRegistry.reset();
  DreamingSystem.deactivate();
  useIdentityStore.setState({ certificate: CERT('uid_10e') });
  usePlayerStore.getState().initializeSession(CERT('uid_10e'), 'NOMAD');
});

// -----------------------------------------------------------------------------
// 10E.1 / 10E.4 — THE BANK LAW (D20): batches validate, compile, sign — or are
// refused WHOLE. D22 binds the banks.
// -----------------------------------------------------------------------------

describe('the bank law: a batch loads, validates and signs, or is refused whole', () => {
  it('the shipped batches compile: a NAMES run then an EFFECTS run, each a version', () => {
    expect(AFFIX_BATCHES.length).toBeGreaterThanOrEqual(2);
    expect(AFFIX_BATCHES[0].kind).toBe('NAMES');
    expect(AFFIX_BATCHES[1].kind).toBe('EFFECTS');
    const result = AffixBank.compile(AFFIX_BATCHES);
    expect(result.ok).toBe(true);
    expect(result.pack!.version).toBe(AFFIX_BATCHES.length);
    expect(result.pack!.entries.length).toBeGreaterThanOrEqual(25);
    expect(AffixBank.version()).toBe(AFFIX_BATCHES.length);
  });

  it('every biome has its own themed entries, and GLOBAL and CART themes exist', () => {
    const pack = AffixBank.current();
    const themes = new Set(pack.entries.map(e => e.theme));
    for (const biome of ['WASTELAND', 'OVERGROWTH', 'RUINS', 'INDUSTRIAL', 'CYBER_CITY', 'GLOBAL', 'CART']) {
      expect(themes.has(biome), `theme ${biome} missing from the bank`).toBe(true);
    }
  });

  it('a names run banks names only: an entry with stats in a NAMES batch is refused whole', () => {
    const bad: IAffixBatch = {
      runId: 'run_bad_names', kind: 'NAMES', model: 'test', ranAt: 0,
      names: [
        { id: 'pre_t_clean', name: 'Clean', type: 'PREFIX', theme: 'GLOBAL', allowedTags: ['weapon'], tier: 1 },
        { id: 'pre_t_eager', name: 'Eager', type: 'PREFIX', theme: 'GLOBAL', allowedTags: ['weapon'], tier: 1, statModifiers: { damage: [1, 2] } } as any
      ]
    };
    const verdict = AffixBank.validateBatch(bad, []);
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toContain('pre_t_eager');
    expect(AffixBank.compile([bad]).ok).toBe(false);
  });

  it('D22 IS A BANK LAW: an effects run that puts a mental stat on gear is refused whole — the clean entries fall with it', () => {
    const names: IAffixBatch = {
      runId: 'run_t_names', kind: 'NAMES', model: 'test', ranAt: 0,
      names: [
        { id: 'suf_t_owl2', name: 'of the Owl Reborn', type: 'SUFFIX', theme: 'GLOBAL', allowedTags: ['armor'], tier: 1 },
        { id: 'pre_t_fine', name: 'Fine', type: 'PREFIX', theme: 'GLOBAL', allowedTags: ['weapon'], tier: 1 }
      ]
    };
    const effects: IAffixBatch = {
      runId: 'run_t_effects', kind: 'EFFECTS', model: 'test', ranAt: 1,
      effects: [
        { id: 'pre_t_fine', statModifiers: { damage: [2, 4] } },
        { id: 'suf_t_owl2', statModifiers: { intelligence: [2, 5] } }
      ]
    };
    const compiled = AffixBank.compile([names, effects]);
    expect(compiled.ok).toBe(false);
    expect(compiled.reason).toMatch(/owl reborn/i);
    expect(compiled.reason).toMatch(/frame/i);
    // the clean sibling landed nowhere: the refusal is of the WHOLE batch
    const namesOnly = AffixBank.compile([names]);
    expect(namesOnly.ok).toBe(true);
    expect(namesOnly.pack!.entries.find(e => e.id === 'pre_t_fine')!.statModifiers).toBeUndefined();
  });

  it('a mental affix may exist in the bank — scoped to frames alone (D22)', () => {
    const pack = AffixBank.current();
    const mentalEntries = pack.entries.filter(e =>
      Object.keys(e.statModifiers ?? {}).some(k => MENTAL.has(k)));
    expect(mentalEntries.length).toBeGreaterThanOrEqual(1);
    for (const e of mentalEntries) expect(e.allowedTags).toEqual(['frame']);
  });

  it('an effects run may only define banked names; duplicates and strangers refuse', () => {
    const stranger: IAffixBatch = {
      runId: 'run_t_stranger', kind: 'EFFECTS', model: 'test', ranAt: 0,
      effects: [{ id: 'pre_never_banked', statModifiers: { damage: [1, 2] } }]
    };
    expect(AffixBank.compile([stranger]).ok).toBe(false);
    const dupe: IAffixBatch = {
      runId: 'run_t_dupe', kind: 'NAMES', model: 'test', ranAt: 0,
      names: [
        { id: 'pre_t_two', name: 'Twice', type: 'PREFIX', theme: 'GLOBAL', allowedTags: ['weapon'], tier: 1 },
        { id: 'pre_t_two', name: 'Twice Again', type: 'PREFIX', theme: 'GLOBAL', allowedTags: ['weapon'], tier: 1 }
      ]
    };
    expect(AffixBank.compile([dupe]).ok).toBe(false);
  });

  it('a loaded pack is SIGNED into the CONTENT namespace, version and signature on the stored doc', async () => {
    const signed = await bankAndSignAffixes('uid_10e');
    expect(signed).toBeTruthy();
    expect(signed!.signature).toBe('sig_uid_10e');
    expect(signed!.pack.version).toBe(AffixBank.version());
    const storedId = `content_pack_v${AffixBank.version()}`;
    expect(db.has(storedId)).toBe(true);
  });

  it('the banks carry NEGATIVE offsets: downside pays for upside (D19)', () => {
    const pack = AffixBank.current();
    const withNegative = pack.entries.filter(e =>
      Object.values(e.statModifiers ?? {}).some(([lo]) => lo < 0));
    expect(withNegative.length).toBeGreaterThanOrEqual(5);
  });

  it('a bank entry starts as a NAME: name-only entries exist after the effects run, and roll with no effect', () => {
    const pack = AffixBank.current();
    const nameOnly = pack.entries.filter(e => !e.statModifiers);
    expect(nameOnly.length).toBeGreaterThanOrEqual(2);
    // a name-only entry converted for the roll acts as nothing
    const def = DreamingSystem.toAffixDefinition(nameOnly[0]);
    expect(Object.keys(def.statModifiers)).toHaveLength(0);
  });
});

// -----------------------------------------------------------------------------
// THE PURGE (D22): the legacy pool loses its Owl; no new mint carries a mental
// affix on gear; the standing contraband still wears, its mental line dead.
// -----------------------------------------------------------------------------

describe('the purge: the legacy pool holds no mental-stat affix', () => {
  it('the raw legacy table still holds the Owl — and the LIVE pool does not', () => {
    expect(AFFIX_DEFINITIONS.suffixes.some(s => s.id === 'suf_int')).toBe(true);
    const pool = AffixBank.legacyPool();
    const all = [...pool.prefixes, ...pool.suffixes];
    expect(all.some(a => a.id === 'suf_int')).toBe(false);
    for (const a of all) {
      for (const stat of Object.keys(a.statModifiers)) {
        expect(MENTAL.has(stat), `${a.id} still promises ${stat}`).toBe(false);
      }
    }
    expect(AffixBank.purgedLegacyIds()).toContain('suf_int');
  });

  it('500 keyed mints from the default pool carry no mental attribute in any affix', () => {
    for (let i = 0; i < 500; i++) {
      const item = ItemFactory.createItem(undefined, false, Rng.fromKey(`purge:${i}`));
      for (const affix of item.affixes) {
        for (const stat of Object.keys(affix.stats)) {
          expect(MENTAL.has(stat), `${item.name} rolled ${affix.name} with ${stat}`).toBe(false);
        }
      }
    }
  });

  it('standing contraband still wears, refused only by the bank: the partition names the affix', () => {
    const robe = ItemFactory.createItem(UniversalRank.F, true, Rng.fromKey('purge:robe'), 'armor');
    robe.affixes = [{ id: 'suf_int', name: 'of the Owl', type: 'SUFFIX', stats: { intelligence: 3 }, tier: 1 }];
    const verdict = LoadoutSystem.validateStatPartition(robe);
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toMatch(/owl/i);
  });
});

// -----------------------------------------------------------------------------
// LINE 53 — THE DREAMING: population from the banks, deterministic for
// (seed, pack version), pinned at mint, never altered by a later batch.
// -----------------------------------------------------------------------------

describe('the Dreaming: a world populates from the banks, deterministically', () => {
  it('a biome pool holds its own theme plus GLOBAL and CART, nothing else, and is deterministic', () => {
    const pack = AffixBank.current();
    const pool = DreamingSystem.poolFor(pack, BiomeType.OVERGROWTH);
    const all = [...pool.prefixes, ...pool.suffixes];
    expect(all.length).toBeGreaterThanOrEqual(4);
    for (const e of all) {
      expect(['OVERGROWTH', 'GLOBAL', 'CART'].includes(e.theme), `${e.id} strayed from theme`).toBe(true);
    }
    const again = DreamingSystem.poolFor(pack, BiomeType.OVERGROWTH);
    expect(all.map(e => e.id)).toEqual([...again.prefixes, ...again.suffixes].map(e => e.id));
  });

  it('same (seed, pack version), same rolls: byte-identical affix records across activations', () => {
    const pack = AffixBank.current();
    const roll = () => {
      MintRegistry.reset();
      DreamingSystem.activate('seed_dream_a', pack);
      const pool = DreamingSystem.poolFor(pack, BiomeType.RUINS);
      const items = Array.from({ length: 40 }, (_, i) =>
        ItemFactory.createItem(UniversalRank.C, false, Rng.fromKey(`dream:det:${i}`), 'weapon', undefined, pool));
      DreamingSystem.deactivate();
      return JSON.stringify(items.map(i => ({ n: i.name, a: i.affixes, s: i.stats })));
    };
    expect(roll()).toBe(roll());
  });

  it('two pack versions give measurably different worlds: the same keys roll different acting records', () => {
    const v1 = AffixBank.packAt(1)!;
    const v2 = AffixBank.packAt(2)!;
    expect(v1.version).toBe(1);
    expect(v2.version).toBe(2);
    const rollWith = (pack: typeof v1) => {
      MintRegistry.reset();
      const pool = DreamingSystem.poolFor(pack, BiomeType.WASTELAND);
      return Array.from({ length: 60 }, (_, i) =>
        ItemFactory.createItem(UniversalRank.C, false, Rng.fromKey(`dream:ver:${i}`), 'weapon', undefined, pool));
    };
    const a = rollWith(v1);
    const b = rollWith(v2);
    let differing = 0;
    for (let i = 0; i < a.length; i++) {
      if (JSON.stringify({ s: a[i].stats, x: a[i].affixes }) !== JSON.stringify({ s: b[i].stats, x: b[i].affixes })) differing++;
    }
    expect(differing / a.length).toBeGreaterThanOrEqual(VERSION_DIFFERENCE_MIN);
  });

  it('no later batch alters a world minted before it: a v1 world rolls the same while v2 stands compiled', () => {
    const v1 = AffixBank.packAt(1)!;
    // v1 affixes are names only — nothing acts, and nothing changes when v2 exists
    for (const e of v1.entries) expect(e.statModifiers).toBeUndefined();
    const rollV1 = () => {
      MintRegistry.reset();
      const pool = DreamingSystem.poolFor(v1, BiomeType.INDUSTRIAL);
      return JSON.stringify(Array.from({ length: 30 }, (_, i) =>
        ItemFactory.createItem(UniversalRank.D, false, Rng.fromKey(`dream:pin:${i}`), 'armor', undefined, pool))
        .map(i => ({ n: i.name, a: i.affixes, s: i.stats })));
    };
    const before = rollV1();
    expect(AffixBank.packAt(2)).toBeTruthy(); // v2 is compiled and loaded
    expect(rollV1()).toBe(before);
  });

  it('themed banks stay in theme measurably: every dreamed affix belongs to the biome, GLOBAL or CART', () => {
    const pack = AffixBank.current();
    const allowedByBiome: Record<string, Set<string>> = {};
    for (const biome of [BiomeType.OVERGROWTH, BiomeType.RUINS, BiomeType.CYBER_CITY]) {
      allowedByBiome[biome] = new Set(
        pack.entries.filter(e => [biome, 'GLOBAL', 'CART'].includes(e.theme)).map(e => e.id));
    }
    let rolledAffixes = 0;
    let inTheme = 0;
    for (const biome of [BiomeType.OVERGROWTH, BiomeType.RUINS, BiomeType.CYBER_CITY]) {
      MintRegistry.reset();
      const pool = DreamingSystem.poolFor(pack, biome);
      for (let i = 0; i < 60; i++) {
        const item = ItemFactory.createItem(UniversalRank.C, false, Rng.fromKey(`theme:${biome}:${i}`), 'weapon', undefined, pool);
        for (const a of item.affixes) {
          rolledAffixes++;
          if (allowedByBiome[biome].has(a.id)) inTheme++;
        }
      }
    }
    expect(rolledAffixes).toBeGreaterThan(20);
    expect(inTheme / rolledAffixes).toBeGreaterThanOrEqual(THEME_PURITY);
  });

  it('the recon survey says the dream: a sector names its themed signatures, deterministically, in theme', () => {
    const pack = AffixBank.current();
    const dream = DreamingSystem.sectorDream('seed_dream_b', pack, BiomeType.OVERGROWTH, 3, 4);
    expect(dream.length).toBeGreaterThanOrEqual(1);
    expect(dream).toEqual(DreamingSystem.sectorDream('seed_dream_b', pack, BiomeType.OVERGROWTH, 3, 4));
    const allowed = new Set(pack.entries.filter(e => ['OVERGROWTH', 'GLOBAL', 'CART'].includes(e.theme)).map(e => e.name));
    for (const name of dream) expect(allowed.has(name), `${name} is not Overgrowth's dream`).toBe(true);
    const other = DreamingSystem.sectorDream('seed_dream_b', pack, BiomeType.OVERGROWTH, 5, 1);
    expect(JSON.stringify(other)).not.toBe(JSON.stringify(dream));
  });

  it('materials dream too: a dreamed harvest can carry a banked affix, deterministically, and a legacy world cannot', () => {
    const pack = AffixBank.current();
    const find = () => {
      for (let i = 0; i < 400; i++) {
        const affix = DreamingSystem.materialAffixFor(pack, BiomeType.OVERGROWTH, 'res_tree_log', Rng.fromKey(`mat:${i}`));
        if (affix) return { affix, i };
      }
      return null;
    };
    const hit = find();
    expect(hit).toBeTruthy();
    const again = DreamingSystem.materialAffixFor(pack, BiomeType.OVERGROWTH, 'res_tree_log', Rng.fromKey(`mat:${hit!.i}`));
    expect(JSON.stringify(again)).toBe(JSON.stringify(hit!.affix));
    // the entry it rolled is a resource-scoped, in-theme entry
    const entry = pack.entries.find(e => e.id === hit!.affix.id)!;
    expect(entry.allowedTags).toContain('resource');
    expect(['OVERGROWTH', 'GLOBAL'].includes(entry.theme)).toBe(true);
  });

  it('loot in a dreamed world draws from the banks; the same drop without the dream draws from the purged legacy pool', () => {
    const pack = AffixBank.current();
    const bankIds = new Set(pack.entries.map(e => e.id));
    const mobDef = { id: 'mob_t', name: 'Test Shambler', rank: UniversalRank.S, tags: ['elite', 'biological'], baseHealth: 10 } as any;
    const ctx = { chunkX: 0, chunkY: 0, layerId: 'w', biome: BiomeType.OVERGROWTH, magicFind: 1, quantityBonus: 1 } as any;

    DreamingSystem.activate('seed_dream_c', pack);
    const dreamt: IItem[] = [];
    for (let i = 0; i < 40; i++) dreamt.push(...LootTable.generateLoot(mobDef, 1.0, ctx, `loot:dream:${i}`));
    DreamingSystem.deactivate();
    MintRegistry.reset();
    const legacy: IItem[] = [];
    for (let i = 0; i < 40; i++) legacy.push(...LootTable.generateLoot(mobDef, 1.0, ctx, `loot:dream:${i}`));

    const dreamtAffixes = dreamt.flatMap(i => i.affixes);
    const legacyAffixes = legacy.flatMap(i => i.affixes);
    expect(dreamtAffixes.length).toBeGreaterThan(0);
    expect(dreamtAffixes.every(a => bankIds.has(a.id))).toBe(true);
    expect(legacyAffixes.every(a => !bankIds.has(a.id))).toBe(true);
  });
});

// -----------------------------------------------------------------------------
// LINES 52 + 55 — THE KNOWLEDGE LAW (D19): the sheet is blind, the affix acts;
// study reveals exactly what was banked; identify is a scoped, trained, timed skill.
// -----------------------------------------------------------------------------

describe('the knowledge law: blind sheets, real study, scoped identify', () => {
  it('an unstudied affix moves nothing visible while its numbers act', () => {
    const pack = AffixBank.current();
    const pool = DreamingSystem.poolFor(pack, BiomeType.WASTELAND);
    const item = rollAffixed(pool, 'know:blind');
    item.isIdentified = true; // the ITEM is known; the AFFIX is not studied
    const player = usePlayerStore.getState().player;
    const visible = LoadoutSystem.visibleItemStats(item, player);
    for (const affix of item.affixes) {
      for (const [stat, v] of Object.entries(affix.stats)) {
        if (typeof v !== 'number' || v === 0) continue;
        const acting = item.stats[stat] ?? 0;
        const shown = visible[stat] ?? 0;
        expect(shown).not.toBe(acting); // the sheet is missing the affix's share
      }
    }
  });

  it('study reveals EXACTLY the banked record: the rolled numbers, negative offsets included', () => {
    const pack = AffixBank.current();
    const pool = DreamingSystem.poolFor(pack, BiomeType.WASTELAND);
    // find a roll whose affix carries a negative offset (the banks promise them)
    let item: IItem | null = null;
    for (let i = 0; i < 200 && !item; i++) {
      const roll = ItemFactory.createItem(UniversalRank.C, false, Rng.fromKey(`know:neg:${i}`), 'weapon', undefined, pool);
      if (roll.affixes.some(a => Object.values(a.stats).some(v => v < 0))) item = roll;
    }
    expect(item).toBeTruthy();
    item!.isIdentified = true;
    let player = usePlayerStore.getState().player;
    player = StudySystem.reveal(player, item!);
    const visible = LoadoutSystem.visibleItemStats(item!, player);
    // after study the sheet shows the full acting record — nothing hidden, nothing invented
    for (const [stat, v] of Object.entries(item!.stats)) {
      if (typeof v !== 'number' || ['durability', 'maxDurability', 'weight'].includes(stat)) continue;
      expect(visible[stat]).toBe(v);
    }
    const negative = item!.affixes.flatMap(a => Object.entries(a.stats)).find(([, v]) => v < 0)!;
    expect(negative[1]).toBeLessThan(0); // the downside is on the record, not sanded off
  });

  // Amended by D50, 2026-11-01: no roll. The scope is what the eye grows in, and what a schooled look costs.
  it('identify is SCOPED by item type: the eye grows in one scope and not the other', () => {
    const weapon = ItemFactory.createItem(UniversalRank.F, false, Rng.fromKey('scope:w'), 'weapon');
    const armor = ItemFactory.createItem(UniversalRank.F, false, Rng.fromKey('scope:a'), 'armor');
    expect(StudySystem.identifyScopeOf(weapon)).toBe('weapon');
    expect(StudySystem.identifyScopeOf(armor)).toBe('armor');
    let player = usePlayerStore.getState().player;
    // train the weapon eye at a workstation
    usePlayerStore.getState().gainSkillXp(StudySystem.scopeSkillId('weapon'), 1, ['study']);
    player = usePlayerStore.getState().player;
    expect(StudySystem.canFieldIdentify(player, weapon).ok).toBe(true);
    expect(StudySystem.canFieldIdentify(player, armor).ok).toBe(true);
    expect(StudySystem.identifyLevel(player, weapon)).toBeGreaterThan(StudySystem.identifyLevel(player, armor));
  });

  it('identify is ALWAYS timed, and faster with skill — never free', () => {
    const t1 = StudySystem.identifySeconds(1);
    const t3 = StudySystem.identifySeconds(3);
    const t9 = StudySystem.identifySeconds(9);
    expect(t1).toBeGreaterThan(t3);
    expect(t3).toBeGreaterThan(t9);
    expect(t9).toBeGreaterThanOrEqual(IDENTIFY_FLOOR_SECONDS);
    expect(StudySystem.identifySeconds(99)).toBeGreaterThanOrEqual(IDENTIFY_FLOOR_SECONDS);
  });

  it('training is work at a workstation, by use (D6): study raises the scoped skill', () => {
    const weapon = { ...ItemFactory.createItem(UniversalRank.F, false, Rng.fromKey('train:w'), 'weapon'), rank: UniversalRank.F, rarity: Rarity.COMMON };
    const fresh = usePlayerStore.getState().player;
    const untrained = StudySystem.identifyLevel(fresh, weapon);
    // study at the station: the store action trains; what it found waits for a rest (D50)
    grantStash([weapon]);
    const verdict = usePlayerStore.getState().studyItemAtStation(weapon.id);
    expect(verdict.ok).toBe(true);
    const trained = usePlayerStore.getState().player;
    expect(StudySystem.identifyLevel(trained, weapon)).toBeGreaterThan(untrained);
  });

  // Q27 (2026-11-04): the field identify is gone. The same reveal now happens at home, through the eye.
  it('a rest reveals what was looked at through the one door: isIdentified set, affixes studied, record exact', () => {
    const pack = AffixBank.current();
    const pool = DreamingSystem.poolFor(pack, BiomeType.RUINS);
    const item = rollAffixed(pool, 'field:ident');
    // train the scope first
    usePlayerStore.getState().gainSkillXp(StudySystem.scopeSkillId('weapon'), 1, ['study']);
    usePlayerStore.setState(s => ({ player: { ...s.player, currentSession: undefined, energyToday: 1000 } }));
    grantStash([item]);
    // D50: there is no roll. It costs, and a rest is what reveals.
    expect(usePlayerStore.getState().studyItemAtStation(item.id).ok).toBe(true);
    usePlayerStore.setState(s => ({ player: RestSystem.settle(s.player).player }));
    const after = usePlayerStore.getState().player;
    const held = after.bank.stashTabs.flatMap(t => t.items).find(i => i.id === item.id)!;
    expect(held.isIdentified).toBe(true);
    for (const a of item.affixes) {
      expect(LoadoutSystem.isAffixStudied(after, a.id)).toBe(true);
    }
  });

  it('knowledge ties into the one machinery: studied affixes live in materialMastery, not a parallel ledger', () => {
    const weapon = ItemFactory.createItem(UniversalRank.F, false, Rng.fromKey('mach:w'), 'weapon');
    weapon.affixes = [{ id: 'pre_t_known', name: 'Known', type: 'PREFIX', stats: { damage: 2 }, tier: 1 }];
    const before = usePlayerStore.getState().player;
    expect(LoadoutSystem.isAffixStudied(before, 'pre_t_known')).toBe(false);
    const after = StudySystem.reveal(before, weapon);
    const mastery = Object.values(after.materialMastery).flatMap(k => k.discoveredAffixes);
    expect(mastery).toContain('pre_t_known');
    expect(LoadoutSystem.isAffixStudied(after, 'pre_t_known')).toBe(true);
  });
});

// -----------------------------------------------------------------------------
// LINE 56 — INSURANCE IS AN ITEM (D21): charms with uses, scrolls on a clock,
// each naming what it protects; the death keeps exactly that.
// -----------------------------------------------------------------------------

describe('insurance is an item: the magic names what the death keeps', () => {
  const equipBlade = (key: string): IItem => {
    const blade = ItemFactory.createItem(UniversalRank.F, true, Rng.fromKey(key), 'weapon', 'wpn_sword_1h_t1');
    usePlayerStore.getState().tryAddItems([blade]);
    const v = usePlayerStore.getState().equipToSlot(blade.id, 'RIGHT_HAND');
    expect(v.ok).toBe(true);
    return blade;
  };

  it('a charm names its protection: slots, chosen or random, and its uses', () => {
    const charm = InsuranceSystem.mintCharm('chm_clasp', Rng.fromKey('chm:1'));
    expect(charm.charmData).toBeTruthy();
    expect(charm.charmData!.slots).toBe(1);
    expect(charm.charmData!.chosen).toBe(true);
    expect(charm.charmData!.uses).toBeGreaterThanOrEqual(1);
    expect(charm.name.length).toBeGreaterThan(0);
  });

  it('a chosen charm marks exactly the chosen slot; the death keeps it and the receipt names the charm', () => {
    usePlayerStore.getState().diveIntoLayer('w_ins');
    const blade = equipBlade('ins:blade');
    const charm = InsuranceSystem.mintCharm('chm_clasp', Rng.fromKey('chm:2'));
    usePlayerStore.getState().tryAddItems([charm]);
    const used = usePlayerStore.getState().useProtection(charm.id, 'RIGHT_HAND');
    expect(used.ok).toBe(true);
    const marks = usePlayerStore.getState().player.equipment!.protected;
    expect(marks).toHaveLength(1);
    expect(marks[0].slot).toBe('RIGHT_HAND');
    expect(marks[0].by).toBe(charm.name);
    const { lost, kept } = usePlayerStore.getState().emergencyJackOut('INVENTORY_LOSS');
    expect(kept).toHaveLength(1);
    expect(kept[0].item.id).toBe(blade.id);
    expect(kept[0].by).toBe(charm.name);
    expect(lost.some(i => i.id === blade.id)).toBe(false);
  });

  it('a use is a use: the charm spends one, and at zero it is consumed', () => {
    usePlayerStore.getState().diveIntoLayer('w_uses');
    equipBlade('ins:blade2');
    const charm = InsuranceSystem.mintCharm('chm_clasp', Rng.fromKey('chm:3'));
    expect(charm.charmData!.uses).toBe(1);
    usePlayerStore.getState().tryAddItems([charm]);
    const used = usePlayerStore.getState().useProtection(charm.id, 'RIGHT_HAND');
    expect(used.ok).toBe(true);
    const held = usePlayerStore.getState().player.currentSession!.inventory.find(i => i.id === charm.id);
    expect(held).toBeUndefined(); // single use, spent, gone
  });

  it('a random charm picks its slots from what is worn, deterministically from its key', () => {
    usePlayerStore.getState().diveIntoLayer('w_rand');
    equipBlade('ins:blade3');
    const charm = InsuranceSystem.mintCharm('chm_knot', Rng.fromKey('chm:4'));
    expect(charm.charmData!.chosen).toBe(false);
    const occupied: any[] = ['RIGHT_HAND'];
    const planA = InsuranceSystem.plan(charm, occupied, {});
    const planB = InsuranceSystem.plan(charm, occupied, {});
    expect(planA.ok).toBe(true);
    expect(planA.slots).toEqual(planB.slots);
    expect(planA.slots!.length).toBeLessThanOrEqual(charm.charmData!.slots);
  });

  it('a scroll protects on a clock: inside the hour it holds, after it the death takes everything', () => {
    usePlayerStore.getState().diveIntoLayer('w_scroll');
    const blade = equipBlade('ins:blade4');
    const scroll = InsuranceSystem.mintScrollItem('scr_keeping', Rng.fromKey('scr:1'));
    expect(scroll.scrollData!.durationSeconds).toBeGreaterThan(0);
    usePlayerStore.getState().tryAddItems([scroll]);
    const used = usePlayerStore.getState().useProtection(scroll.id, 'RIGHT_HAND');
    expect(used.ok).toBe(true);
    const mark = usePlayerStore.getState().player.equipment!.protected[0];
    expect(mark.until).toBeGreaterThan(Date.now());
    // run the clock out: the mark expires, the magic lapses
    usePlayerStore.setState(s => ({
      player: { ...s.player, equipment: { ...s.player.equipment!, protected: s.player.equipment!.protected.map(m => ({ ...m, until: Date.now() - 1000 })) } }
    }));
    const { kept, lost } = usePlayerStore.getState().emergencyJackOut('INVENTORY_LOSS');
    expect(kept).toHaveLength(0);
    expect(lost.some(i => i.id === blade.id)).toBe(true);
  });

  it('the scroll is written at the scribe\'s table on paper and ink, exactly once, or refused naming the shortfall', async () => {
    const refusal = await InsuranceSystem.mintScrollAtScribe('scr_keeping');
    expect(refusal.ok).toBe(false);
    expect(refusal.reason).toMatch(/paper|ink/i);
    const bill = SCROLL_MINT_BILL.flatMap(line =>
      Array.from({ length: line.quantity }, (_, i) => mintRes(line.defId, `scr:bill:${line.defId}:${i}`)));
    grantStash(bill);
    const before = stash().length;
    const minted = await InsuranceSystem.mintScrollAtScribe('scr_keeping');
    expect(minted.ok).toBe(true);
    expect(minted.item!.scrollData).toBeTruthy();
    // the bill left exactly once and the scroll landed: net = before - bill + 1
    expect(stash().length).toBe(before - bill.length + 1);
  });

  it('frames still ride free and unprotected slots still fall: the magic keeps EXACTLY what it named', () => {
    usePlayerStore.getState().diveIntoLayer('w_exact');
    const blade = equipBlade('ins:blade5');
    // a second piece, unprotected
    const helm = ItemFactory.createItem(UniversalRank.F, true, Rng.fromKey('ins:helm'), 'armor', 'arm_chest_heavy_t1');
    usePlayerStore.getState().tryAddItems([helm]);
    const equipped = usePlayerStore.getState().equipToSlot(helm.id, 'CHEST');
    expect(equipped.ok).toBe(true);
    const charm = InsuranceSystem.mintCharm('chm_clasp', Rng.fromKey('chm:5'));
    usePlayerStore.getState().tryAddItems([charm]);
    expect(usePlayerStore.getState().useProtection(charm.id, 'RIGHT_HAND').ok).toBe(true);
    const { kept, lost } = usePlayerStore.getState().emergencyJackOut('INVENTORY_LOSS');
    expect(kept.map(k => k.item.id)).toEqual([blade.id]);
    expect(lost.some(i => i.id === helm.id)).toBe(true);
  });
});

// -----------------------------------------------------------------------------
// D16's ADDENDUM — cart security affixes grow in the same banks
// -----------------------------------------------------------------------------

describe('cart security: the banks grow locks, and a lock costs the thief time', () => {
  it('the bank holds CART-theme security entries and they only fit a cart', () => {
    const pack = AffixBank.current();
    const cartEntries = pack.entries.filter(e => e.theme === 'CART');
    expect(cartEntries.length).toBeGreaterThanOrEqual(2);
    for (const e of cartEntries) expect(e.allowedTags).toContain('cart');
    const lock = cartEntries.find(e => Object.keys(e.statModifiers ?? {}).includes('cart_lock'));
    expect(lock).toBeTruthy();
  });

  it('a warded kit reaches the tow law: breaking takes time, the owner tows free', () => {
    const kit = ItemFactory.createItem(UniversalRank.F, true, Rng.fromKey('cart:kit'), 'tool', 'cart_field_t1');
    kit.affixes = [{ id: 'pre_crt_warded', name: 'Warded', type: 'PREFIX', stats: { cart_lock: 2 }, tier: 1 }];
    const security = CartSystem.securityOf(kit);
    expect(security.lockLevel).toBe(2);
    expect(CartSystem.towBreakSeconds(security.lockLevel)).toBeGreaterThan(0);
    expect(CartSystem.towBreakSeconds(0)).toBe(0);
    const cart = CartSystem.newCart(kit, 'owner_uid', 'OWNER');
    expect(cart.security?.lockLevel).toBe(2);
  });

  it('the broken lock is a fact in the theft log', async () => {
    const kit = ItemFactory.createItem(UniversalRank.F, true, Rng.fromKey('cart:kit2'), 'tool', 'cart_field_t1');
    kit.affixes = [{ id: 'pre_crt_warded', name: 'Warded', type: 'PREFIX', stats: { cart_lock: 1 }, tier: 1 }];
    const cart = CartSystem.newCart(kit, 'owner_uid', 'OWNER');
    const stolen = await CartSystem.recordTheft(cart, 'thief_uid', 'THIEF');
    const theft = stolen.theftLog[0];
    expect(theft.by).toBe('thief_uid');
    expect(theft.brokeLock).toBe(1);
  });
});

// -----------------------------------------------------------------------------
// D6's CRAFTING HALF — components carry their affixes onto the item they make;
// a rank S+ craft lets the player name the thing.
// -----------------------------------------------------------------------------

describe('the crafting half of D6: components carry, masters name', () => {
  it('a component\'s affix rides onto the crafted item, stats acting, record kept', () => {
    const log = mintRes('res_tree_log', 'craft:log');
    const stone = mintRes('res_rock_small', 'craft:stone');
    stone.affixes = [{ id: 'res_ovg_mirecured', name: 'Mire-Cured', type: 'PREFIX', stats: { max_health: 5 }, tier: 1 }];
    const result = usePlayerStore.getState();
    result.diveIntoLayer('w_craft');
    result.tryAddItems([log, stone]);
    const made = result.improviseInField('improv_club');
    expect(made.ok).toBe(true);
    const club = usePlayerStore.getState().player.currentSession!.inventory.find(i =>
      i.universalDefinitionId === 'wpn_improvised_club')!;
    expect(club.affixes.some(a => a.id === 'res_ovg_mirecured')).toBe(true);
    expect(club.stats.max_health).toBeGreaterThanOrEqual(5);
    expect(club.name).toMatch(/Mire-Cured/);
  });

  it('a mental-stat component affix never lands on gear: the partition holds the door', () => {
    const composition = CompositionSystem.root({ id: 'res_rock_small', name: 'Dense Stone' }, 'HARVEST');
    const item = ItemFactory.createComposedItem('wpn_improvised_club', composition, Rng.fromKey('craft:guard'), {
      inheritedAffixes: [
        { id: 'aff_mental_t', name: 'of the Borrowed Mind', type: 'SUFFIX', stats: { intelligence: 4 }, tier: 1 },
        { id: 'aff_clean_t', name: 'Heavy', type: 'PREFIX', stats: { damage: 3 }, tier: 1 }
      ]
    });
    expect(item).toBeTruthy();
    expect(item!.affixes.some(a => a.id === 'aff_mental_t')).toBe(false);
    expect(item!.affixes.some(a => a.id === 'aff_clean_t')).toBe(true);
    expect(LoadoutSystem.validateStatPartition(item!).ok).toBe(true);
  });

  it('rank S+ crafts take the maker\'s name; below S the bank keeps its pen', () => {
    const sBase = CRAFTED_GEAR_BASES.find(b => b.rank === UniversalRank.S);
    expect(sBase, 'an S-rank craftable base must exist for D6\'s naming law').toBeTruthy();
    const deep = CompositionSystem.compose(
      { recipeId: 'recipe_test', name: 'Test Step', laborSeconds: 10, facility: 'WORKSHOP' },
      [CompositionSystem.root({ id: 'crf_iron_ingot', name: 'Iron Ingot' }, 'PURCHASE')], 1);
    const named = ItemFactory.createComposedItem(sBase!.id, deep, Rng.fromKey('craft:name'), { customName: 'The Long Account' });
    expect(named!.name).toBe('The Long Account');
    const low = ItemFactory.createComposedItem('wpn_improvised_club', deep, Rng.fromKey('craft:name2'), { customName: 'My Special Club' });
    expect(low!.name).not.toBe('My Special Club');
  });

  it('the S-rank recipe exists with a real chain behind it, and the queue refuses a name below rank S in voice', () => {
    const sRecipe = Object.values(GEAR_RECIPES).find(r => {
      const base = CRAFTED_GEAR_BASES.find(b => b.id === r.outputBase);
      return base?.rank === UniversalRank.S;
    });
    expect(sRecipe, 'the masterwork recipe must exist').toBeTruthy();
    expect(sRecipe!.requiredFacility).toBe('WORKSHOP');
    expect(sRecipe!.inputs.length).toBeGreaterThanOrEqual(2);
    const verdict = useHubStore.getState().canNameCraft('improv_club');
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toMatch(/rank s/i);
    expect(useHubStore.getState().canNameCraft(sRecipe!.id).ok).toBe(true);
  });
});

// -----------------------------------------------------------------------------
// THE SHELF — charms are bought like anything, and the hub's shelf is on the
// bank's latest law (the dream pool reaches new stock through GLOBAL + CART)
// -----------------------------------------------------------------------------

describe('the shelf: insurance is sold, and hub stock rolls on the current law', () => {
  it('the consumable shelf stocks at least one charm and one scroll, data riding the listing', () => {
    useHubStore.setState({ activeHubId: 'hub_test' } as any);
    useHubStore.getState().generateDailyStock();
    const shelf = useHubStore.getState().consumableShop;
    const charms = shelf.filter(l => l.item.charmData);
    const scrolls = shelf.filter(l => l.item.scrollData);
    expect(charms.length).toBeGreaterThanOrEqual(1);
    expect(scrolls.length).toBeGreaterThanOrEqual(1);
    expect(charms[0].price).toBeGreaterThan(0);
  });

  it('a bought charm keeps its charmData through the purchase mint', () => {
    useHubStore.setState({ activeHubId: 'hub_test' } as any);
    useHubStore.getState().generateDailyStock();
    usePlayerStore.setState(s => ({ player: { ...s.player, bank: { ...s.player.bank, gold: 10_000 } } }));
    const listing = useHubStore.getState().consumableShop.find(l => l.item.charmData)!;
    const bought = useHubStore.getState().purchaseFromShop(listing.id, 'consumable');
    expect(bought).toBeTruthy();
    expect(bought!.charmData).toBeTruthy();
    expect(bought!.charmData!.uses).toBe(listing.item.charmData!.uses);
  });
});
