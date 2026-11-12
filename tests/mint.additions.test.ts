/**
 * WHAT A MINTING ADDS (IB). Pedro, after he ended his run: "we need to adjust the item bases, right now they're all
 * weird, so it's best to make the function that calls up sonnet and asks it, according to the slot rolled and the
 * available bases, if the item rolled uses the base or a new base. every minted world should add a lot of item bases,
 * and several materials."
 *
 * Every door here is a stub: no call leaves this machine. What a real answer looks like is for his own run.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';

const docs = new Map<string, any>();
vi.mock('../shared/entities/data/VectorStore', () => ({
  VectorNamespace: { CHARACTERS: 'characters', ITEMS: 'items', WORLDS: 'worlds', TRANSACTIONS: 'transactions', CONTENT: 'content', TERRITORIES: 'territories' },
  VectorStore: {
    get: async (_ns: string, id: string) => docs.get(id) ?? null,
    put: async (doc: any) => { docs.set(doc.id, doc); return true; },
    query: async () => [],
    saveContent: async (id: string, type: string, content: unknown) => { docs.set(id, { id, data: { type, content } }); return true; },
    searchContent: async (type: string) => [...docs.values()].filter(d => d.data?.type === type).map(d => d.data.content)
  }
}));

import { UniversalRank } from '../shared/types';
import { Rng } from '../shared/logic/rng/DeterministicRNG';
import { ContentRegistry } from '../shared/logic/theme/ContentRegistry';
import { FIRST_THEME_PACK, installShippedThemes } from '../shared/logic/theme/boot';
import { BIOMES, GEAR_KINDS, GearKind, IThemePack } from '../shared/logic/theme/ThemeTypes';
import { shortIdOf } from '../shared/logic/theme/ThemeCompiler';
import { GROUND_VERSION } from '../shared/entities/world/WorldGenerator';
import { IMintAnswer, IMintAsk, MINT_ADDITIONS_FROM_GROUND, MINT_ASK_TRIES, MintAdditions, WorldBases } from '../shared/logic/theme/writing/MintAdditions';
import { buildBasesRequest } from '../shared/intelligence/prompts';
import { MODEL_FOR, ceilingOf } from '../shared/intelligence/claude';
import { IntelligenceDoor, IDoorRequest } from '../shared/intelligence/door';
import { routeDoor } from '../shared/intelligence/routes';
import { MintAdditionsWriter, MintStore, storedOffer } from '../src/logic/theme/writing/MintAdditionsWriter';
import { LootTable } from '../src/entities/world/LootTable';

installShippedThemes();

const SRC = (p: string) => readFileSync(p, 'utf8');
const pack = (): IThemePack => ContentRegistry.get(FIRST_THEME_PACK.themeId)!;
const anyWord = () => true;
const words = (slot: string, roll: number) => `${slot.replace(/_/g, ' ')} of the vault ${'abcdefghijklmnopqrstuvwxyz'[roll % 26]}${'abcdefghijklmnopqrstuvwxyz'[Math.floor(roll / 26)]}`;
const NEW_MATERIALS: IMintAnswer['materials'] = BIOMES.map((biome, i) => ({
  name: ['Overdue Moss', 'Lapsed Fern', 'Escrow Clay', 'Margin Ore', 'Audit Quartz'][i], blurb: 'It grows where nobody pays.',
  tags: i < 2 ? ['flora'] : ['mineral', 'stone'], rank: 'F', form: i < 2 ? 'shrub' : 'rock', verb: 'hands', weight: 'light', worth: 'common', habitat: [biome]
}));
/** A model that writes a new base for every roll and the floor of materials. */
const fullAnswer = (ask: IMintAsk): IMintAnswer => ({
  rolls: ask.rolls.map(r => ({ roll: r.roll, use: '', name: words(r.slot, r.roll), blurb: 'Kept on the books.', tags: [], size: '' })),
  materials: NEW_MATERIALS.slice(0, ask.materials.atLeast)
});
const answering = (answer: (ask: IMintAsk) => unknown) => {
  const asks: IMintAsk[] = [];
  return { asks, door: async (ask: unknown) => { asks.push(ask as IMintAsk); return { status: 'OK', data: answer(ask as IMintAsk) }; } };
};

beforeEach(() => { docs.clear(); WorldBases.enter(null); });

describe('IB3: a minting rolls every slot twice, and asks for a material on every ground', () => {
  it('forty-two rolls, each kind twice, in an order the seed shuffles', () => {
    const slots = MintAdditions.rolledSlots('seed-a');
    expect(slots.length).toBe(GEAR_KINDS.length * 2);
    for (const k of GEAR_KINDS) expect(slots.filter(s => s === k).length).toBe(2);
    expect(MintAdditions.rolledSlots('seed-a')).toEqual(slots);
    expect(MintAdditions.rolledSlots('seed-b')).not.toEqual(slots);
    expect(MintAdditions.materialFloor()).toBe(BIOMES.length);
  });

  it('each roll is offered what its slot already has, by id', () => {
    const ask = MintAdditions.askOf(pack(), 'seed-a');
    const bludgeon = ask.rolls.find(r => r.slot === 'bludgeon')!;
    expect(bludgeon.offered.map(o => o.name).sort()).toEqual(['Oversized Gavel', 'Stone-Bound Club', 'The Repossessor']);
    expect(ask.rolls.find(r => r.slot === 'chest')!.offered.map(o => o.id)).toEqual(['pack:waistcoat']);
    expect(ask.materials.atLeast).toBe(5);
  });
});

describe('IB4: the law judges every word, and nothing stands that already does', () => {
  it('a full answer stands whole', () => {
    const ask = MintAdditions.askOf(pack(), 'seed-a');
    const v = MintAdditions.judge(pack(), ask, fullAnswer(ask), anyWord);
    expect(v.reason).toBeUndefined();
    expect(v.uses.length).toBe(42);
    expect(v.bases.length).toBe(42);
    expect(v.materials.length).toBe(5);
    for (const b of v.bases) expect(b.rank).toBe('F');
  });

  it('a new base that names one that stands is refused; using it by its id stands; an id not offered is refused', () => {
    const ask = MintAdditions.askOf(pack(), 'seed-a');
    const chest = ask.rolls.find(r => r.slot === 'chest')!, ring = ask.rolls.find(r => r.slot === 'ring')!;
    const v = MintAdditions.judge(pack(), ask, {
      rolls: [
        { roll: chest.roll, use: '', name: 'Reinforced Waistcoat', blurb: 'Again.', tags: [], size: '' },
        { roll: ring.roll, use: 'pack:waistcoat', name: '', blurb: '', tags: [], size: '' }
      ], materials: []
    }, anyWord);
    expect(v.reason).toMatch(/already stands/);
    expect(v.reason).toMatch(/not offered/);
    const w = MintAdditions.judge(pack(), ask, { rolls: [{ roll: chest.roll, use: 'pack:waistcoat', name: '', blurb: '', tags: [], size: '' }], materials: [] }, anyWord);
    expect(w.uses).toEqual([{ roll: chest.roll, slot: 'chest', base: 'pack:waistcoat' }]);
    expect(w.bases).toEqual([]);
  });

  it('a material that already lies there, or wears a word nobody registered, is refused', () => {
    const ask = MintAdditions.askOf(pack(), 'seed-a');
    const v = MintAdditions.judge(pack(), ask, {
      rolls: [], materials: [{ ...NEW_MATERIALS[0], name: 'Vault Stone' }, { ...NEW_MATERIALS[1], tags: ['nonsense_word'] }]
    }, t => t !== 'nonsense_word');
    expect(v.materials).toEqual([]);
    expect(v.reason).toMatch(/already lies/);
    expect(v.reason).toMatch(/nonsense_word/);
  });
});

describe('IB5: the writer asks once, mends once, and a world with no key still mints', () => {
  it('a full answer: one call, every roll its own new noun, five materials', async () => {
    const { door, asks } = answering(fullAnswer);
    const batch = await MintAdditionsWriter.write('w1', pack(), 'seed-a', door, { registered: anyWord });
    expect(asks.length).toBe(1);
    expect(batch).toMatchObject({ by: 'model', calls: 1 });
    expect(batch.bases.length).toBe(42);
    expect(batch.materials.length).toBe(5);
    expect(batch.uses.map(u => u.roll)).toEqual([...Array(42).keys()]);
  });

  it('a short answer is asked again for only what it left, told why', async () => {
    const { door, asks } = answering(ask => {
      const full = fullAnswer(ask);
      return asks.length === 1 ? { rolls: full.rolls.slice(0, 20), materials: NEW_MATERIALS.slice(0, 2) } : { rolls: full.rolls, materials: NEW_MATERIALS.slice(2) };
    });
    const batch = await MintAdditionsWriter.write('w1', pack(), 'seed-a', door, { registered: anyWord });
    expect(asks.length).toBe(2);
    expect(asks[1].rolls.length).toBe(22);
    expect(asks[1].materials.atLeast).toBe(3);
    expect(asks[1].refused).toMatch(/unanswered/);
    expect(batch.bases.length).toBe(42);
    expect(batch.materials.length).toBe(5);
  });

  it('no key, a thrown door or a broken answer: every roll uses a base it was offered, and nothing new', async () => {
    const offeredFor = (roll: number) => MintAdditions.askOf(pack(), 'seed-a').rolls[roll].offered.map(o => o.id);
    for (const door of [
      async () => ({ status: 'NO_KEY', reason: 'No key.' }),
      async () => { throw new Error('offline'); },
      async () => ({ status: 'OK', data: { nope: 1 } })
    ]) {
      const batch = await MintAdditionsWriter.write('w1', pack(), 'seed-a', door as never, { registered: anyWord });
      expect(batch.by).toBe('fallback');
      expect(batch.calls).toBeLessThanOrEqual(MINT_ASK_TRIES);
      expect(batch.bases).toEqual([]);
      expect(batch.materials).toEqual([]);
      expect(batch.uses.length).toBe(42);
      for (const u of batch.uses) expect(offeredFor(u.roll)).toContain(u.base);
    }
  });

  it('never more calls than the guard, whatever comes back', async () => {
    let calls = 0;
    await MintAdditionsWriter.write('w1', pack(), 'seed-a', async () => { calls++; return { status: 'OK', data: { rolls: [], materials: [] } }; }, { registered: anyWord });
    expect(calls).toBe(MINT_ASK_TRIES);
  });
});

describe('IB6: one kind of its own at the one door, on Sonnet, and what a world can cost', () => {
  it('goes through the door as `bases`, on Sonnet, with the answer held to its schema', async () => {
    const seen: IDoorRequest[] = [];
    const door = new IntelligenceDoor({ name: 'stub', status: async () => ({ available: true, provider: 'stub' }), ask: async (r: IDoorRequest) => { seen.push(r); return { status: 'OK', data: {} }; } } as never);
    const out = await routeDoor(door, 'POST', '/world/bases', { ask: MintAdditions.askOf(pack(), 'seed-a') });
    expect(out.status).toBe(200);
    expect(seen[0].kind).toBe('bases');
    expect(seen[0].schema).toBeDefined();
    expect(MODEL_FOR.bases).toBe('claude-sonnet-5-5');
  });

  it('a world costs two calls at most, and under forty cents by the door\'s own rates', () => {
    const request = buildBasesRequest(MintAdditions.askOf(pack(), 'seed-a'));
    const perCall = ceilingOf(request, false);
    expect(perCall).toBeGreaterThan(0);
    expect(perCall * MINT_ASK_TRIES).toBeLessThan(0.4);
  });
});

describe('IB7: what stands is sized by the formula, under the world\'s own scope; the pinned pack is untouched', () => {
  it('bases and materials compile under the scope, with numbers from the formula', async () => {
    const { door } = answering(fullAnswer);
    const batch = await MintAdditionsWriter.write('w1', pack(), 'seed-a', door, { registered: anyWord });
    const before = JSON.stringify(ContentRegistry.compiled(FIRST_THEME_PACK.themeId)!.items);
    const compiled = MintAdditions.compile(pack(), batch);
    expect(compiled.bases.length).toBe(42);
    for (const b of compiled.bases) {
      expect(b.id).toContain(shortIdOf(batch.scope));
      expect(b.base_ip).toBeGreaterThan(0);
      expect(b.slot).toBeDefined();
    }
    expect(compiled.resources.length).toBe(5);
    for (const r of compiled.resources) {
      expect(r.themeId).toBe(batch.scope);
      expect(r.harvestConfig).toBeDefined();
      expect((r.habitat ?? []).length).toBeGreaterThan(0);
    }
    expect(JSON.stringify(ContentRegistry.compiled(FIRST_THEME_PACK.themeId)!.items)).toBe(before);
    expect(MintAdditions.scopeOf('w1')).not.toBe(MintAdditions.scopeOf('w2'));
  });
});

describe('IB8: a found piece rolls its slot, then its noun among its world\'s own', () => {
  it('slots come evenly, and the nouns the minting added are found', async () => {
    const { door } = answering(fullAnswer);
    const batch = await MintAdditionsWriter.write('w1', pack(), 'seed-a', door, { registered: anyWord });
    const own = ContentRegistry.compiled(FIRST_THEME_PACK.themeId)!.items;
    WorldBases.enter(MintAdditions.basesBySlot([...own.weapon_bases, ...own.armor_bases, ...own.tool_bases], MintAdditions.compile(pack(), batch).bases));
    const n = 2100;
    const kinds: Record<string, number> = {};
    const names = new Set<string>();
    for (let i = 0; i < n; i++) {
      const item = LootTable.found(UniversalRank.F, Rng.fromKey(`found:${i}`), undefined, { groundVersion: GROUND_VERSION });
      kinds[String((item as any).kind ?? item.slot)] = (kinds[String((item as any).kind ?? item.slot)] ?? 0) + 1;
      names.add(item.name);
    }
    const minted = batch.bases.map(b => b.name);
    expect(minted.filter(m => [...names].some(x => x.includes(m))).length).toBeGreaterThan(30);
    // Every chest piece is no longer the one waistcoat
    expect([...names].filter(x => /waistcoat|chest of the vault/i.test(x)).length).toBeGreaterThan(1);
  });

  it('a world laid before this ground, or a line that names its piece, finds as it always did', async () => {
    const { door } = answering(fullAnswer);
    const batch = await MintAdditionsWriter.write('w1', pack(), 'seed-a', door, { registered: anyWord });
    WorldBases.enter(MintAdditions.basesBySlot([], MintAdditions.compile(pack(), batch).bases));
    const minted = new Set(batch.bases.map(b => b.name));
    for (let i = 0; i < 200; i++) {
      const old = LootTable.found(UniversalRank.F, Rng.fromKey(`old:${i}`), undefined, { groundVersion: MINT_ADDITIONS_FROM_GROUND - 1 });
      expect([...minted].some(m => old.name.includes(m))).toBe(false);
    }
    const signet = LootTable.found(UniversalRank.F, Rng.fromKey('line'), undefined, { groundVersion: GROUND_VERSION }, ContentRegistry.compiled(FIRST_THEME_PACK.themeId)!.items.armor_bases.find(b => b.universal_name === 'Second-Hand Signet')!.id);
    expect(signet.name).toContain('Signet');
  });
});

describe('IB9: pinned by the ground a world was laid on', () => {
  it('today\'s ground is the one that adds', () => {
    expect(GROUND_VERSION).toBeGreaterThanOrEqual(MINT_ADDITIONS_FROM_GROUND);
  });

  it('a world laid before adds nothing as it opens; one laid on it takes its own', async () => {
    const { door } = answering(fullAnswer);
    await MintAdditionsWriter.forWorld('w_new', FIRST_THEME_PACK.themeId, 'seed-a', door);
    expect(await MintAdditionsWriter.enter({ id: 'w_new', themeId: FIRST_THEME_PACK.themeId, groundVersion: MINT_ADDITIONS_FROM_GROUND - 1 })).toEqual([]);
    expect(WorldBases.active()).toBeNull();
    const laid = await MintAdditionsWriter.enter({ id: 'w_new', themeId: FIRST_THEME_PACK.themeId, groundVersion: MINT_ADDITIONS_FROM_GROUND });
    expect(laid.length).toBe(5);
    expect([...WorldBases.active()!.values()].flat().length).toBe(25 + 42);
  });
});

describe('IB10: kept with the world, and banked for later worlds to select, never copied whole', () => {
  it('a later world is offered what an earlier one added, near its own meaning, and may select it', async () => {
    const { door } = answering(fullAnswer);
    await MintAdditionsWriter.forWorld('w_first', FIRST_THEME_PACK.themeId, 'seed-a', door);
    const stored = await MintStore.all();
    expect(stored.length).toBe(1);
    const offer = await storedOffer(pack(), stored);
    const slot = GEAR_KINDS.find(k => offer(k as GearKind).length > 0) as GearKind;
    expect(slot).toBeDefined();
    const ask = MintAdditions.askOf(pack(), 'seed-b', offer);
    const roll = ask.rolls.find(r => r.slot === slot)!;
    const theirs = roll.offered.find(o => !o.id.startsWith('pack:'))!;
    const picked = MintAdditions.judge(pack(), ask, { rolls: [{ roll: roll.roll, use: theirs.id, name: '', blurb: '', tags: [], size: '' }], materials: [] }, anyWord);
    expect(picked.bases.length).toBe(1);
    expect(picked.bases[0].name).toBe(theirs.name);
    expect(picked.uses[0].base).toBe(picked.bases[0].key);
    const copied = MintAdditions.judge(pack(), ask, { rolls: [{ roll: roll.roll, use: '', name: theirs.name, blurb: 'Mine now.', tags: [], size: '' }], materials: [] }, anyWord);
    expect(copied.bases).toEqual([]);
    expect(copied.reason).toMatch(/already stands/);
  });
});

describe('IB11: wiring', () => {
  it('a minting asks before its world first opens, and an opening lays what it added', () => {
    expect(SRC('src/components/WorldCreator.tsx')).toMatch(/MintAdditionsWriter\.forWorld\(/);
    expect(SRC('src/entities/world/store.ts')).toMatch(/MintAdditionsWriter\.enter\(/);
  });
});
