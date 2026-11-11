/**
 * ENERGY ON GEAR, AND TONICS (2026-11-11).
 *
 * Pedro: "energy management, gear needs to give energy stat (you get very little energy simply by
 * levelling), and, we need energy tonics that are limited usage per rest, and give debuffs as side
 * effects for using."
 *
 * The calls, made on his word by the coordinator: energy on gear reads no rank, natively or as a
 * property, and more kinds than the focus carry it, about as often as protection; a tonic gives three
 * tenths of the drinker's own day; one tonic a rest, and more with endurance; each tonic since the last
 * rest slows the walk a little more on the house curve, and nothing else is taken.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';

const db = new Map<string, any>();
vi.mock('../shared/entities/data/VectorStore', () => ({
  VectorNamespace: { CHARACTERS: 'characters', ITEMS: 'items', WORLDS: 'worlds', TRANSACTIONS: 'transactions', CONTENT: 'content', TERRITORIES: 'territories' },
  VectorStore: {
    get: async (_ns: string, id: string) => db.get(id) ?? null,
    put: async (doc: any) => { db.set(doc.id, doc); return true; },
    query: async () => [...db.values()],
    saveContent: async () => true,
    searchContent: async () => []
  }
}));
vi.mock('../src/entities/identity/certificateSystem', () => ({
  CertificateSystem: {
    signPayload: async (uid: string, payload: any) => ({ payload, signature: 'sig', certUid: uid, timestamp: 0 }),
    verifyPayload: async () => true,
    getPrivateKey: async () => null
  }
}));

import { IAttributes, IEquipmentState, IItem, IPlayer, ItemType, SlotType, UniversalRank } from '../shared/types';
import { DEFAULT_ATTRIBUTES } from '../src/entities/player/types';
import { usePlayerStore } from '../src/entities/player/store';
import { useIdentityStore } from '../src/entities/identity/store';
import { LoadoutSystem } from '../shared/entities/player/systems/LoadoutSystem';
import { ATTRIBUTE_READERS, StatSystem, TONIC_SLOW_POINTS, climb } from '../shared/logic/systems/StatSystem';
import { RestSystem } from '../src/logic/systems/RestSystem';
import { FieldWords } from '../src/logic/systems/FieldWords';
import { GEAR_SHAPES, TONIC_SHARE, affixRange, consumableNumbers } from '../shared/logic/theme/ThemeFormula';
import { RANKS } from '../shared/logic/theme/ThemeTypes';
import { ItemFactory } from '../shared/entities/item/ItemFactory';
import { ItemDefinition } from '../shared/entities/item/data/itemDefinitions';
import { SeededRNG } from '../shared/logic/rng/DeterministicRNG';
import { RANK_MULTIPLIERS, RANKLESS_STATS } from '../shared/constants';

const CERT = (uid: string, name = 'TESTER') => ({ metadata: { uid, displayName: name, createdAt: 0 }, publicKey: {} as any }) as any;
const store = () => usePlayerStore.getState();
const player = () => store().player;
const spread = (raised: Partial<IAttributes> = {}): IAttributes => ({ ...DEFAULT_ATTRIBUTES, ...raised });

/** The kinds that carry a day's energy natively, chosen by plain sense (see the ledger's row). */
const ENERGY_KINDS = ['focus', 'belt', 'necklace', 'ring'] as const;
/** Protection is one rating (call 1.5): what the armour kinds carry. */
const PROTECTION = ['physical_reduction', 'defense'];
const TOP = RANKS.indexOf('SSS');

/** In the field with this much energy left, nothing drunk since the last rest. */
const drop = (energy: number, attributes?: Partial<IAttributes>) => usePlayerStore.setState(s => {
  const sheet = attributes ? spread(attributes) : s.player.attributes;
  return {
    player: {
      ...s.player,
      attributes: sheet,
      tonicsSinceRest: undefined,
      rest: undefined,
      currentSession: { sessionId: 's', layerId: 'l', inventory: [], inventoryLayout: {}, health: 50, maxHealth: StatSystem.maxHealth(sheet, s.player.equipment), energy, position: { x: 0, y: 0, z: 0 }, statusEffects: [] } as any
    }
  };
});
const tonic = (id: string, stats: Record<string, number> = consumableNumbers('energy', 'F')): IItem =>
  ({ id, name: 'Day Moss', type: ItemType.CONSUMABLE, stats, tags: ['consumable'], isIdentified: true, weight: 0.2, dimensions: { width: 1, height: 1 }, affixes: [] }) as unknown as IItem;
const carry = (...items: IItem[]) => usePlayerStore.setState(s => ({ player: { ...s.player, currentSession: { ...s.player.currentSession!, inventory: items } } }));
const energy = () => player().currentSession!.energy;
const worn = (max_energy: number): IEquipmentState =>
  ({ slots: { NECKLACE: 'amulet' }, frames: {}, items: [{ id: 'amulet', stats: { max_energy } }] }) as unknown as IEquipmentState;
const restOnce = (place: 'FIELD' | 'BED' | 'INN' = 'FIELD') =>
  usePlayerStore.setState(s => ({ player: RestSystem.wake(RestSystem.beginRest(s.player, place, 0)) }));

beforeEach(() => {
  db.clear();
  localStorage.clear();
  useIdentityStore.setState({ certificate: CERT('uid_energy') });
  store().initializeSession(CERT('uid_energy'), 'NOMAD');
});

// =============================================================================
// GEAR GIVES ENERGY, AND NO RANK MOVES IT
// =============================================================================

describe('energy on gear reads no rank', () => {
  it('each kind chosen carries energy natively, the same at rank F and at rank SSS', () => {
    for (const kind of ENERGY_KINDS) {
      const atF = GEAR_SHAPES[kind].implicits(0).find(l => l.stat === 'max_energy');
      const atTop = GEAR_SHAPES[kind].implicits(TOP).find(l => l.stat === 'max_energy');
      expect(atF, kind).toBeDefined();
      expect(atF!.min, kind).toBeGreaterThan(0);
      expect(atTop, kind).toEqual(atF);
    }
  });

  it('energy turns up on as many kinds as protection does', () => {
    const carrying = (stats: string[]) => Object.values(GEAR_SHAPES).filter(s => s.implicits(0).some(l => stats.includes(l.stat))).length;
    expect(carrying(['max_energy'])).toBe(carrying(PROTECTION));
  });

  it('a property of energy is the same on a piece of rank F and of rank S, where the rank still moves health', () => {
    expect(RANKLESS_STATS).toContain('max_energy');
    expect(RANK_MULTIPLIERS[UniversalRank.S]).toBeGreaterThan(RANK_MULTIPLIERS[UniversalRank.F]);
    const base = (rank: UniversalRank) => ({ id: 'test_ring', universal_name: 'Test Ring', rank, base_ip: 50, slot: SlotType.RING, tags: ['ring', 'jewelry'], implicits: [] }) as unknown as ItemDefinition;
    const pool = {
      prefixes: [{ id: 'p_day', nameTemplate: 'Enduring', type: 'PREFIX', allowedTags: ['ring'], statModifiers: { max_energy: [8, 16] }, tier: 1 }],
      suffixes: [{ id: 's_life', nameTemplate: 'of Life', type: 'SUFFIX', allowedTags: ['ring'], statModifiers: { max_health: [10, 20] }, tier: 1 }]
    } as never;
    let seen = 0;
    for (let i = 0; i < 200 && seen < 3; i++) {
      const low = ItemFactory.createFromTemplate(base(UniversalRank.F), true, new SeededRNG(`day_${i}`), pool);
      const high = ItemFactory.createFromTemplate(base(UniversalRank.S), true, new SeededRNG(`day_${i}`), pool);
      if (!low.stats?.max_energy || !low.stats?.max_health) continue;
      seen++;
      expect(high.stats!.max_energy).toBe(low.stats.max_energy);
      expect(high.stats!.max_health).toBeGreaterThan(low.stats.max_health);
    }
    expect(seen).toBe(3);
  });

  it("a theme's band of energy is the same whatever tier its writer named, and other bands still grow", () => {
    expect(affixRange('max_energy', 'major', 5, false)).toEqual(affixRange('max_energy', 'major', 1, false));
    expect(affixRange('max_health', 'major', 5, false)[0]).toBeGreaterThan(affixRange('max_health', 'major', 1, false)[0]);
  });
});

// =============================================================================
// A TONIC IS A SHARE OF THE DRINKER'S OWN DAY
// =============================================================================

describe('a tonic gives three tenths of the drinker\'s day', () => {
  it('the formula gives every energy tonic the same share, at every rank', () => {
    expect(TONIC_SHARE).toBe(0.3);
    for (const rank of RANKS) expect(consumableNumbers('energy', rank)).toEqual({ energy_share: TONIC_SHARE });
    expect(StatSystem.isRead('energy_share')).toBe(true);
  });

  it('three tenths of a newcomer\'s day, and three tenths of a long one', () => {
    drop(0);
    carry(tonic('a'));
    store().consumeItem('a');
    const short = StatSystem.maxEnergyOf(player());
    expect(energy()).toBe(Math.round(short * TONIC_SHARE));

    usePlayerStore.setState(s => ({ player: { ...s.player, equipment: worn(250) } }));
    drop(0);
    carry(tonic('b'));
    store().consumeItem('b');
    const long = StatSystem.maxEnergyOf(player());
    expect(long).toBeGreaterThan(short * 4);
    expect(energy()).toBe(Math.round(long * TONIC_SHARE));
  });

  it('it lifts toward the top and no further', () => {
    const full = StatSystem.maxEnergyOf(player());
    drop(full - 3);
    carry(tonic('a'));
    store().consumeItem('a');
    expect(energy()).toBe(full);
  });
});

// =============================================================================
// TONICS A REST
// =============================================================================

describe('tonics a rest: one, and more with endurance', () => {
  it('one at the floor of endurance, and one more for each five points over it', () => {
    expect(StatSystem.tonicsPerRest(spread())).toBe(1);
    expect(StatSystem.tonicsPerRest(spread({ endurance: 5 }))).toBe(1);
    expect(StatSystem.tonicsPerRest(spread({ endurance: 6 }))).toBe(2);
    expect(StatSystem.tonicsPerRest(spread({ endurance: 11 }))).toBe(3);
    expect(StatSystem.tonicsPerRest(spread({ endurance: 101 }))).toBe(21);
    expect(ATTRIBUTE_READERS.endurance).toContain('StatSystem.tonicsPerRest');
  });

  it('at the limit the tonic is refused in words, and it is not used up', () => {
    drop(0, { endurance: 1 });
    carry(tonic('a'), tonic('b'));
    store().consumeItem('a');
    const lifted = energy();
    store().consumeItem('b');
    expect(player().currentSession!.inventory.map(i => i.id)).toEqual(['b']);
    expect(energy()).toBe(lifted);
    expect(player().tonicsSinceRest).toBe(1);
    const verdict = RestSystem.drinkTonic(player(), tonic('b'));
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toMatch(/rest/);
    expect(verdict.reason).toMatch(/Day Moss/);
  });

  it('a body with more endurance takes a second before it refuses', () => {
    drop(0, { endurance: 6 });
    carry(tonic('a'), tonic('b'), tonic('c'));
    store().consumeItem('a');
    store().consumeItem('b');
    store().consumeItem('c');
    expect(player().currentSession!.inventory.map(i => i.id)).toEqual(['c']);
    expect(player().tonicsSinceRest).toBe(2);
  });

  it('the count starts again at any rest', () => {
    for (const place of ['FIELD', 'BED', 'INN'] as const) {
      drop(0, { endurance: 1 });
      carry(tonic('a'), tonic('b'));
      store().consumeItem('a');
      restOnce(place);
      expect(RestSystem.tonicsDrunk(player()), place).toBe(0);
      usePlayerStore.setState(s => ({ player: { ...s.player, currentSession: { ...s.player.currentSession!, energy: 0 } } }));
      store().consumeItem('b');
      expect(player().currentSession!.inventory, place).toEqual([]);
      expect(player().tonicsSinceRest, place).toBe(1);
    }
  });

  it('a rest a hurt broke restored nothing, so it does not start the count again', () => {
    drop(0, { endurance: 1 });
    carry(tonic('a'));
    store().consumeItem('a');
    usePlayerStore.setState(s => ({ player: RestSystem.breakRest(RestSystem.beginRest(s.player, 'FIELD', 0)) }));
    expect(RestSystem.tonicsDrunk(player())).toBe(1);
  });
});

// =============================================================================
// THE SIDE EFFECT: A SLOWER WALK UNTIL THE NEXT REST, AND NOTHING ELSE
// =============================================================================

describe('each tonic slows the walk a little more, until the next rest', () => {
  it('on the house curve, and it never stops the walk', () => {
    const whole = LoadoutSystem.walkTilesPerSecond(undefined, spread());
    const paces = [0, 1, 2, 3].map(n => LoadoutSystem.walkTilesPerSecond(undefined, spread(), n));
    expect(paces[0]).toBe(whole);
    for (let n = 1; n < paces.length; n++) {
      expect(paces[n]).toBeLessThan(paces[n - 1]);
      expect(StatSystem.tonicSlow(n)).toBeCloseTo(climb(n * TONIC_SLOW_POINTS));
      expect(paces[n]).toBeCloseTo(whole * (1 - StatSystem.tonicSlow(n)));
    }
    expect(LoadoutSystem.walkTilesPerSecond(undefined, spread(), 10_000)).toBeGreaterThan(0);
  });

  it('a drinker walks slower with each tonic, and whole again after a rest', () => {
    const whole = LoadoutSystem.walkOf(player());
    drop(0, { endurance: 6 });
    carry(tonic('a'), tonic('b'));
    store().consumeItem('a');
    const once = LoadoutSystem.walkOf(player());
    store().consumeItem('b');
    const twice = LoadoutSystem.walkOf(player());
    expect(once).toBeLessThan(LoadoutSystem.walkTilesPerSecond(player().equipment, player().attributes));
    expect(twice).toBeLessThan(once);
    restOnce('BED');
    expect(LoadoutSystem.walkOf(player())).toBe(LoadoutSystem.walkTilesPerSecond(player().equipment, player().attributes));
    expect(whole).toBeGreaterThan(0);
  });

  it('it never takes lore, health or what is carried', () => {
    drop(0);
    const keep = { ...tonic('rock', {}), type: ItemType.RESOURCE } as IItem;
    carry(tonic('a'), keep);
    const strip = (p: IPlayer) => {
      const { tonicsSinceRest: _t, ...rest } = p;
      const { energy: _e, inventory, inventoryLayout: _l, ...session } = p.currentSession!;
      return { ...rest, currentSession: { ...session, inventory: inventory.filter(i => i.id !== 'a') } };
    };
    const before = strip(player());
    store().consumeItem('a');
    expect(strip(player())).toEqual(before);
    expect(player().currentSession!.health).toBe(50);
  });

  it('the canvases walk at the drinker\'s pace, and both doors drink through one', () => {
    for (const file of ['src/components/WorldCanvas.tsx', 'src/entities/hub/HubCanvas.tsx']) {
      const source = readFileSync(file, 'utf8');
      const calls = source.match(/walkTilesPerSecond\(.*$/gm) ?? [];
      expect(calls.length, file).toBeGreaterThan(0);
      for (const call of calls) expect(call, file).toMatch(/tonicsSinceRest/);
    }
    const doors = readFileSync('src/entities/player/store.ts', 'utf8').match(/RestSystem\.drinkTonic\(/g) ?? [];
    expect(doors.length).toBeGreaterThanOrEqual(2);
  });
});

// =============================================================================
// WHAT THE DRINKER IS TOLD, AND WHAT THE FIELD SHOWS
// =============================================================================

describe('the drinker is told what a tonic gave and what it cost', () => {
  it('in the plain voice of the rest', () => {
    const said = FieldWords.tonic({ name: 'Day Moss', gave: 15, slow: StatSystem.tonicSlow(1) });
    expect(said.text).toMatch(/^Day Moss: \+15 energy\./);
    expect(said.text).toMatch(/9% slower/);
    expect(said.text).toMatch(/until you rest/);
    expect(FieldWords.tonicRefused('Day Moss', 1)).toMatch(/Day Moss/);
  });

  it('a side effect that stands shows by a mark and a word, and none shows when none stands', () => {
    expect(FieldWords.tonicMark(0)).toBeNull();
    const mark = FieldWords.tonicMark(2)!;
    expect(mark.startsWith('▼')).toBe(true);
    expect(mark).toMatch(/TONIC/);
    expect(mark).toMatch(/17%/);
    expect(readFileSync('src/components/WaitStrip.tsx', 'utf8')).toMatch(/FieldWords\.tonicMark\(/);
  });
});

// =============================================================================
// A SAVE FROM BEFORE, AND THE SAME INPUTS
// =============================================================================

describe('a save from before, and a replay', () => {
  it('an old save loads: no count reads as none, and an old draught is a tonic like any other', () => {
    const old = JSON.parse(JSON.stringify(player())) as IPlayer;
    delete (old as Partial<IPlayer>).tonicsSinceRest;
    expect(RestSystem.tonicsDrunk(old)).toBe(0);
    expect(LoadoutSystem.walkOf(old)).toBe(LoadoutSystem.walkTilesPerSecond(old.equipment, old.attributes));
    usePlayerStore.setState({ player: old });
    drop(0);
    carry(tonic('old', { energy_restore: 25 }));
    store().consumeItem('old');
    expect(energy()).toBe(Math.round(StatSystem.maxEnergyOf(player()) * TONIC_SHARE));
    expect(player().tonicsSinceRest).toBe(1);
  });

  it('the same inputs replay the same', () => {
    drop(4, { endurance: 6 });
    const p = player();
    expect(RestSystem.drinkTonic(p, tonic('a'))).toEqual(RestSystem.drinkTonic(p, tonic('a')));
    const once = RestSystem.drinkTonic(p, tonic('a')).player;
    expect(RestSystem.drinkTonic(once, tonic('b'))).toEqual(RestSystem.drinkTonic(once, tonic('b')));
  });
});
