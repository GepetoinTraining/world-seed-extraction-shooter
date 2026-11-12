/**
 * CRAFTING BY TWO (Pedro, 2026-11-10): "crafting needs to be material + material, one dragged on top
 * of another, and then Unidentified appears. there's a secret crafting roll that's done, and after
 * rest you see what you made".
 *
 * What two things make is read from their world's own chain, never from a table here. The roll is
 * the law's and nobody is told how it went until a rest. Registered before the build.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';

const db = new Map<string, any>();
vi.mock('../shared/entities/data/VectorStore', () => ({
  VectorNamespace: { CHARACTERS: 'characters', ITEMS: 'items', WORLDS: 'worlds', TRANSACTIONS: 'transactions', CONTENT: 'content', TERRITORIES: 'territories' },
  VectorStore: {
    get: async (_ns: string, id: string) => db.get(id) ?? null,
    put: async (doc: any) => { db.set(doc.id, JSON.parse(JSON.stringify(doc))); return true; },
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

import { IItem, ItemType, UniversalRank } from '../shared/types';
import { RESOURCE_DEFINITIONS } from '../shared/entities/item/data/resourceDefinitions';
import { CRAFTED_DEFINITIONS } from '../shared/entities/economy/data/recipeDefinitions';
import { ItemFactory } from '../shared/entities/item/ItemFactory';
import { LoadoutSystem } from '../shared/entities/player/systems/LoadoutSystem';
import { InventorySystem } from '../shared/entities/player/systems/InventorySystem';
import { Rng } from '../shared/logic/rng/DeterministicRNG';
import { FIRST_THEME_PACK, installShippedThemes } from '../shared/logic/theme/boot';
import { shortIdOf } from '../shared/logic/theme/ThemeCompiler';
import { IMaker, PairCraft } from '../shared/logic/systems/PairCraft';
import { WorkCost } from '../shared/logic/systems/WorkCost';
import { usePlayerStore, playerPort } from '../src/entities/player/store';
import { useWorldStore } from '../src/entities/world/store';
import { hubPort } from '../src/entities/hub/store';
import { useIdentityStore } from '../src/entities/identity/store';
import { commitMove, probeMove } from '../src/logic/systems/ItemHands';
import { RestDoor } from '../src/logic/systems/RestDoor';
import { RestSystem } from '../src/logic/systems/RestSystem';
import { useFeed } from '../src/components/ui/stores';

installShippedThemes();

const SRC = (p: string) => readFileSync(p, 'utf8');
const UID = 'uid_paircraft';
const CERT = (uid: string, name: string) => ({
  metadata: { uid, displayName: name, createdAt: 0 }, publicKey: {} as any, publicKeyJWK: {} as any
}) as any;
const sid = shortIdOf(FIRST_THEME_PACK.themeId);
const res = (key: string) => RESOURCE_DEFINITIONS[`res_${sid}_${key}`] as any;
const crafted = (key: string) => CRAFTED_DEFINITIONS[`crf_${sid}_${key}`] as any;

let minted = 0;
const mint = (def: any): IItem => ItemFactory.createResourceItem(def, Rng.fromKey(`pc:${++minted}`));
const pebble = () => mint(res('tally_pebble'));
const reed = () => mint(res('tellers_reed'));
const iron = () => mint(res('collateral_iron'));
const oak = () => mint(res('compound_oak'));

const player = () => usePlayerStore.getState().player;
const pack = () => player().currentSession!.inventory;
const stash = () => player().bank.stashTabs[0].items;
const fed = () => useFeed.getState().lines.map(l => l.text).join(' | ');

/** Somebody ordinary, with no bench anywhere. */
const maker = (over: Partial<IMaker> = {}): IMaker => ({ rank: UniversalRank.F, dexterity: 1, skillLevel: () => 0, hasBench: () => false, ...over });

const inField = (carried: IItem[], layout?: Record<string, { x: number; y: number; rotated: boolean }>) => {
  useWorldStore.setState({
    currentMap: { seed: 'seed_paircraft', width: 1, height: 1, gridVersion: 2, sectors: {}, generatedAt: 0, chunks: { '0,0': { id: '0,0', x: 0, y: 0, entities: [] } } } as any,
    availableWorlds: [], activeWorldId: null
  } as any);
  usePlayerStore.setState(s => ({
    player: {
      ...s.player,
      currentSession: {
        sessionId: 'sess_paircraft', layerId: 'l', inventory: carried, kitItemIds: [], health: 100, maxHealth: 100, energy: 100, maxEnergy: 100, position: { x: 0, y: 0, z: 0 }, statusEffects: [],
        inventoryLayout: layout ?? InventorySystem.placeAll(carried)
      } as any
    }
  }));
};
const inVault = (...items: IItem[]) => usePlayerStore.setState(s => ({
  player: { ...s.player, currentSession: undefined, energyToday: 100, bank: { ...s.player.bank, stashTabs: [{ ...s.player.bank.stashTabs[0], items, layout: undefined }] } }
}));

beforeEach(() => {
  db.clear();
  localStorage.clear();
  useFeed.setState({ lines: [] });
  useIdentityStore.setState({ certificate: CERT(UID, 'PEDRO') } as any);
  usePlayerStore.getState().initializeSession(CERT(UID, 'PEDRO'), 'NOMAD');
});

afterEach(() => {
  vi.restoreAllMocks();
});

// -----------------------------------------------------------------------------
// WHAT MAY BE SET ON WHAT
// -----------------------------------------------------------------------------

describe('one material is set on another', () => {
  it('two materials may be', () => {
    expect(PairCraft.mayCombine(pebble(), reed()).ok).toBe(true);
    expect(PairCraft.mayCombine(iron(), iron()).ok).toBe(true);
  });

  it('a thing made at a bench is a material too', () => {
    expect(PairCraft.mayCombine(mint(crafted('pledged_ingot')), mint(crafted('ruled_plank'))).ok).toBe(true);
  });

  it('gear is not, nor a document, nor a person on paper or on a back', () => {
    const blade = ItemFactory.createItem(UniversalRank.F, true, Rng.fromKey('blade'), 'weapon');
    expect(PairCraft.mayCombine(blade, reed()).ok).toBe(false);
    expect(PairCraft.mayCombine(reed(), blade).ok).toBe(false);
    expect(PairCraft.mayCombine({ ...reed(), type: ItemType.LORE }, reed()).ok).toBe(false);
    expect(PairCraft.mayCombine({ ...reed(), bondData: {} as any }, reed()).ok).toBe(false);
    expect(PairCraft.mayCombine({ ...reed(), type: ItemType.COMMODITY, tags: ['corpse'] }, reed()).ok).toBe(false);
  });

  it('a piece is not set on itself, and what has not been read is not worked', () => {
    const one = reed();
    expect(PairCraft.mayCombine(one, one).ok).toBe(false);
    const unread = PairCraft.mayCombine({ ...pebble(), isIdentified: false }, reed());
    expect(unread.ok).toBe(false);
    expect(unread.reason).toMatch(/do not know what/i);
  });
});

// -----------------------------------------------------------------------------
// WHAT TWO THINGS MAKE
// -----------------------------------------------------------------------------

describe('what two things make is read from their world\'s own chain', () => {
  it('a stone and a reed are the club a stone and a stick have always been, by hand', () => {
    const found = PairCraft.recipeFor(res('tally_pebble').id, res('tellers_reed').id)!;
    expect(found.name).toBe('Stone-Bound Club');
    expect(found.kind).toBe('gear');
    expect(found.asks).toBeNull();
  });

  it('which is set on which does not matter', () => {
    expect(PairCraft.recipeFor(res('tellers_reed').id, res('tally_pebble').id)!.id).toBe(PairCraft.recipeFor(res('tally_pebble').id, res('tellers_reed').id)!.id);
  });

  it('two of one ore are the ingot, which asks for a bench', () => {
    const found = PairCraft.recipeFor(res('collateral_iron').id, res('collateral_iron').id)!;
    expect(found.name).toBe('Pledged Ingot');
    expect(found.kind).toBe('good');
    expect(found.asks).toBe('WORKSHOP');
    expect(found.trade).toBe('smelting');
  });

  it('where two makings fit, the one whose bill is nearest the pair is it', () => {
    // Cloth takes two reeds and paper takes one: two reeds are cloth
    expect(PairCraft.recipeFor(res('tellers_reed').id, res('tellers_reed').id)!.name).toBe('Ledger Cloth');
  });

  it('a thing made at a station asks for that station', () => {
    const found = PairCraft.recipeFor(crafted('ruled_plank').id, crafted('ruled_plank').id)!;
    expect(found.name).toBe('Audit Board');
    expect(found.asks).not.toBeNull();
    expect(found.asks).not.toBe('WORKSHOP');
  });

  it('two things no making joins make nothing', () => {
    expect(PairCraft.recipeFor(res('compound_oak').id, res('tally_pebble').id)).toBeNull();
  });

  it('no list of makings is written in the law itself', () => {
    const law = SRC('shared/logic/systems/PairCraft.ts');
    expect(law).not.toMatch(/tally_pebble|stonebound|pledged_ingot|ledger_cloth/);
    expect(law).toMatch(/RECIPE_DEFINITIONS/);
    expect(law).toMatch(/GEAR_RECIPES/);
  });
});

// -----------------------------------------------------------------------------
// THE SECRET ROLL
// -----------------------------------------------------------------------------

describe('the making is rolled in secret', () => {
  const many = (a: () => IItem, b: () => IItem, who: IMaker, n = 400) => Array.from({ length: n }, (_, i) => PairCraft.make(a(), b(), who, `roll:${i}`));
  const count = (made: ReturnType<typeof many>, outcome: string) => made.filter(m => m.outcome === outcome).length;

  it('the same two, the same hand and the same key come to the same thing', () => {
    const [a, b] = [pebble(), reed()];
    const first = PairCraft.make(a, b, maker(), 'k1');
    const again = PairCraft.make(a, b, maker(), 'k1');
    expect(again.outcome).toBe(first.outcome);
    expect(again.item.id).toBe(first.item.id);
    expect(again.item.universalDefinitionId).toBe(first.item.universalDefinitionId);
  });

  it('whatever it came to, what appears has not been read', () => {
    for (const m of many(pebble, reed, maker(), 60)) {
      expect(m.item.isIdentified).toBe(false);
      expect(LoadoutSystem.shownName(m.item)).toBe('Unidentified Signal');
    }
  });

  it('it comes out four ways: lost, crude, as it should, and better than it should', () => {
    const made = many(pebble, reed, maker({ dexterity: 3 }), 1200);
    for (const outcome of ['major_failure', 'failure', 'success', 'major_win']) expect(count(made, outcome), outcome).toBeGreaterThan(0);
    const lost = made.find(m => m.outcome === 'major_failure')!;
    expect(lost.item.name).toBe('Spoiled Work');
    const crude = made.find(m => m.outcome === 'failure')!;
    const good = made.find(m => m.outcome === 'success')!;
    const fine = made.find(m => m.outcome === 'major_win')!;
    for (const m of [crude, good, fine]) expect(m.item.name).toContain('Stone-Bound Club');
    expect(crude.item.quality).toBeLessThan(fine.item.quality);
    expect(crude.item.quality).toBeLessThanOrEqual(good.item.quality);
    expect(good.item.quality).toBeLessThanOrEqual(fine.item.quality);
  });

  it('two things that make nothing are always spoiled, whoever sets them together', () => {
    const made = many(oak, pebble, maker({ dexterity: 20, skillLevel: () => 20 }), 80);
    expect(made.every(m => m.item.name === 'Spoiled Work' && m.outcome === 'major_failure')).toBe(true);
    expect(made[0].why).toBe('NOTHING');
  });

  it('a spoiled thing says, once it is read, what went wrong', () => {
    const nothing = PairCraft.make(oak(), pebble(), maker(), 'n');
    expect(nothing.item.description).toMatch(/do not go together/i);
  });

  it('a making that asks for a bench comes out worse without one, and can still come out', () => {
    const without = many(iron, iron, maker({ dexterity: 4 }));
    const withBench = many(iron, iron, maker({ dexterity: 4, hasBench: () => true }));
    const stood = (m: ReturnType<typeof many>) => count(m, 'success') + count(m, 'major_win');
    expect(stood(withBench)).toBeGreaterThan(stood(without));
    expect(stood(without)).toBeGreaterThan(0);
    // The same rolls: the bench moved the bar, not the dice
    expect(without.map(m => m.roll.d20)).toEqual(withBench.map(m => m.roll.d20));
  });

  it('a hand that knows the trade does better at it', () => {
    const green = many(iron, iron, maker({ hasBench: () => true }));
    const practised = many(iron, iron, maker({ hasBench: () => true, skillLevel: id => (id === 'skill_smelting' ? 8 : 0) }));
    const stood = (m: ReturnType<typeof many>) => count(m, 'success') + count(m, 'major_win');
    expect(stood(practised)).toBeGreaterThan(stood(green));
  });

  it('what is made keeps the record of what went into it', () => {
    const made = many(iron, iron, maker({ dexterity: 10, hasBench: () => true }), 40).find(m => m.outcome === 'success')!;
    expect(made.item.composition!.materials.some(m => m.defId === res('collateral_iron').id && m.count === 2)).toBe(true);
    expect(made.item.composition!.steps).toHaveLength(1);
  });
});

// -----------------------------------------------------------------------------
// THROUGH THE PACK AND THE VAULT
// -----------------------------------------------------------------------------

describe('set one on the other: both are used, and an unread thing lies where it was set', () => {
  it('in the pack', () => {
    const [a, b] = [pebble(), reed()];
    inField([a, b], { [a.id]: { x: 0, y: 0, rotated: false }, [b.id]: { x: 4, y: 2, rotated: false } });
    const before = player().currentSession!.energy;
    // Changed on purpose 2026-11-12 (EN, Pedro: "energy is bonkers"): a making costs what the day's one law asks
    const cost = WorkCost.make(player(), a, b);
    expect(usePlayerStore.getState().combine(a.id, b.id)).toEqual({ ok: true });
    expect(pack().some(i => i.id === a.id || i.id === b.id)).toBe(false);
    expect(pack()).toHaveLength(1);
    expect(pack()[0].isIdentified).toBe(false);
    expect(player().currentSession!.energy).toBeCloseTo(before - cost, 9);
    // Where the one it was set on lay, when what came of it fits there
    const at = player().currentSession!.inventoryLayout![pack()[0].id];
    const f = InventorySystem.footprint(pack()[0], at.rotated);
    if (f.w === 1 && f.h === 1) expect({ x: at.x, y: at.y }).toEqual({ x: 4, y: 2 });
    expect(at).toBeDefined();
  });

  it('in the vault, at home', () => {
    const [a, b] = [iron(), iron()];
    inVault(a, b);
    const cost = WorkCost.make(player(), a, b);
    expect(usePlayerStore.getState().combine(a.id, b.id)).toEqual({ ok: true });
    expect(stash()).toHaveLength(1);
    expect(stash()[0].isIdentified).toBe(false);
    expect(player().energyToday).toBeCloseTo(100 - cost, 9);
  });

  it('the feed says the same words whatever it came to, and names nothing made', () => {
    const said: string[] = [];
    for (let i = 0; i < 12; i++) {
      const [a, b] = [pebble(), reed()];
      inField([a, b]);
      useFeed.setState({ lines: [] });
      usePlayerStore.getState().combine(a.id, b.id);
      said.push(fed().replace(/Tally Pebble|Teller's Reed/g, '·'));
      expect(fed()).not.toMatch(/Club|Spoiled/);
    }
    expect(new Set(said).size).toBe(1);
    expect(said[0]).toMatch(/after you rest/i);
  });

  it('with no energy for it nothing is used', () => {
    const [a, b] = [pebble(), reed()];
    inField([a, b]);
    usePlayerStore.setState(s => ({ player: { ...s.player, currentSession: { ...s.player.currentSession!, energy: WorkCost.make(s.player, a, b) / 2 } } }));
    const out = usePlayerStore.getState().combine(a.id, b.id);
    expect(out.ok).toBe(false);
    expect(out.reason).toMatch(/energy/i);
    expect(pack().map(i => i.id).sort()).toEqual([a.id, b.id].sort());
  });

  it('what may not be combined is refused, and nothing is used', () => {
    const blade = ItemFactory.createItem(UniversalRank.F, true, Rng.fromKey('blade2'), 'weapon');
    const b = reed();
    inField([blade, b]);
    expect(usePlayerStore.getState().combine(blade.id, b.id).ok).toBe(false);
    expect(pack()).toHaveLength(2);
  });

  it('it is written down for the rest, and not what it came to where a person could read it', () => {
    const [a, b] = [pebble(), reed()];
    inField([a, b]);
    usePlayerStore.getState().combine(a.id, b.id);
    expect(RestSystem.queueOf(player()).made.map(m => m.id)).toEqual([pack()[0].id]);
  });
});

// -----------------------------------------------------------------------------
// AFTER A REST
// -----------------------------------------------------------------------------

describe('after a rest you see what you made', () => {
  const makeOne = () => {
    const [a, b] = [pebble(), reed()];
    inField([a, b]);
    usePlayerStore.getState().combine(a.id, b.id);
    return pack()[0];
  };

  it('settling reads it, and the queue lets it go', () => {
    const thing = makeOne();
    const { player: rested, made } = RestSystem.settle(player());
    expect(made.map(m => m.item.id)).toEqual([thing.id]);
    expect(rested.currentSession!.inventory[0].isIdentified).toBe(true);
    expect(RestSystem.queueOf(rested).made).toEqual([]);
  });

  it('the rest says what it was: the thing by its name, or that it came to nothing and why', () => {
    const outcomes = new Set<string>();
    for (let i = 0; i < 40 && outcomes.size < 2; i++) {
      const thing = makeOne();
      useFeed.setState({ lines: [] });
      const outcome = RestSystem.queueOf(player()).made[0].outcome;
      RestDoor.settle(playerPort, hubPort);
      const name = pack().find(p => p.id === thing.id)!.name;
      expect(fed()).toContain(name);
      if (outcome === 'major_failure') expect(fed()).toMatch(/came to nothing/i);
      else expect(fed()).toMatch(/What you made/i);
      outcomes.add(outcome === 'major_failure' ? 'lost' : 'stood');
    }
    expect(outcomes.size).toBe(2);
  });

  it('a made thing that is gone before the rest is simply not read', () => {
    makeOne();
    usePlayerStore.setState(s => ({ player: { ...s.player, currentSession: { ...s.player.currentSession!, inventory: [], inventoryLayout: {} } } }));
    const { made, player: rested } = RestSystem.settle(player());
    expect(made).toEqual([]);
    expect(RestSystem.queueOf(rested).made).toEqual([]);
  });
});

// -----------------------------------------------------------------------------
// THE HANDS
// -----------------------------------------------------------------------------

describe('the hands know a thing set on a thing from a thing set on a cell', () => {
  it('asked first, with nothing touched: two materials in one grid may be, gear may not', () => {
    const [a, b] = [pebble(), reed()];
    const blade = ItemFactory.createItem(UniversalRank.F, true, Rng.fromKey('blade3'), 'weapon');
    inField([a, b, blade]);
    const world = useWorldStore.getState();
    expect(probeMove(player(), { item: a, from: { kind: 'PACK' }, rotated: false }, { kind: 'ONTO', grid: 'PACK', targetId: b.id }, world).ok).toBe(true);
    expect(probeMove(player(), { item: blade, from: { kind: 'PACK' }, rotated: false }, { kind: 'ONTO', grid: 'PACK', targetId: b.id }, world).ok).toBe(false);
    expect(pack()).toHaveLength(3);
  });

  it('something from elsewhere is not worked into the pack in one move', () => {
    const [a, b] = [pebble(), reed()];
    inField([b]);
    const verdict = probeMove(player(), { item: a, from: { kind: 'GROUND' }, rotated: false }, { kind: 'ONTO', grid: 'PACK', targetId: b.id }, useWorldStore.getState());
    expect(verdict.ok).toBe(false);
  });

  it('set down on it, the making happens through the store\'s own door', () => {
    const [a, b] = [pebble(), reed()];
    inField([a, b]);
    expect(commitMove({ item: a, from: { kind: 'PACK' }, rotated: false }, { kind: 'ONTO', grid: 'PACK', targetId: b.id }, useWorldStore.getState(), playerPort).ok).toBe(true);
    expect(pack()).toHaveLength(1);
    expect(pack()[0].isIdentified).toBe(false);
  });

  it('the grid tells the hands when the pointer is over another piece, and the bar says what a drop will do', () => {
    const grid = SRC('src/components/ui/ItemGrid.tsx');
    expect(grid).toMatch(/kind: 'ONTO'/);
    expect(grid).toMatch(/data-item-id/);
    const hands = SRC('src/components/ui/hands.tsx');
    expect(hands).toMatch(/ONTO/);
    expect(hands).toMatch(/both are used/i);
  });
});
