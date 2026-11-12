/**
 * THE LARGE CHARACTER SHEET (the interface pass, part 2), bars set before the build.
 *
 * Pedro, 2026-11-11: "right now we have the small character sheet and no big one". DESIGN_BACKLOG.md 1.1.
 * One large sheet, the same in a world and at home. Every derived number on it is the rules' own
 * function, never a second sum: the sheet's dodge is the dodge a blow rolls against, and so on.
 * It shows only what the person may know (D19, D32, S2a).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';

vi.mock('../shared/entities/data/VectorStore', () => ({
  VectorNamespace: { CHARACTERS: 'characters', ITEMS: 'items', WORLDS: 'worlds', TRANSACTIONS: 'transactions', CONTENT: 'content', TERRITORIES: 'territories' },
  VectorStore: { get: async () => null, put: async () => true, query: async () => [], saveContent: async () => true, searchContent: async () => [] }
}));
vi.mock('../src/entities/identity/certificateSystem', () => ({
  CertificateSystem: { signPayload: async (uid: string, payload: any) => ({ payload, signature: `sig_${uid}`, certUid: uid, timestamp: 0 }), verifyPayload: async () => true, getPrivateKey: async () => null }
}));

import { IItem, IPlayer, ItemType, Rarity, SlotType, UniversalRank } from '../shared/types';
import { usePlayerStore } from '../src/entities/player/store';
import '../src/entities/hub/store';
import { useIdentityStore } from '../src/entities/identity/store';
import { LoadoutSystem } from '../shared/entities/player/systems/LoadoutSystem';
import { StatSystem } from '../shared/logic/systems/StatSystem';
import { CombatMath } from '../src/entities/combat/CombatMath';
import { WeaveSystem } from '../src/logic/systems/WeaveSystem';
import { LoreSystem } from '../src/logic/systems/LoreSystem';
import { SheetNumbers } from '../src/logic/systems/SheetNumbers';
import { said } from '../src/logic/systems/SheetWords';

const SRC = (p: string) => readFileSync(p, 'utf8');
const UID = 'uid_largesheet';
const CERT = (uid: string) => ({ metadata: { uid, displayName: 'SHEET', createdAt: 0 }, publicKey: {} as any, publicKeyJWK: {} as any }) as any;

const gear = (id: string, slot: SlotType, stats: Record<string, number>, over: Partial<IItem> = {}): IItem => ({
  id, universalDefinitionId: `gear_${id}`, name: over.name ?? id.toUpperCase(), description: '', type: ItemType.GEAR, slot,
  rank: UniversalRank.F, rarity: Rarity.COMMON, quality: 0, level: 1, value: 1, itemPower: over.itemPower ?? 40, tags: over.tags ?? [], affixes: over.affixes ?? [],
  dimensions: { width: 1, height: 1 }, weight: 1, stats, visuals: { modelId: 'm', colorHex: '#fff' }, icon: 'i',
  history: { dropDate: 0, killCount: 0 }, isIdentified: over.isIdentified ?? true
}) as IItem;

const player = () => usePlayerStore.getState().player;
const wear = (items: { item: IItem; slot: string }[]) => {
  let eq = LoadoutSystem.emptyEquipment();
  eq = { ...eq, items: items.map(w => w.item), slots: { ...eq.slots, ...Object.fromEntries(items.map(w => [w.slot, w.item.id])) } };
  usePlayerStore.setState(s => ({ player: { ...s.player, equipment: eq } }));
};
const row = (rows: { key: string; value: string; says: string }[], key: string) => rows.find(r => r.key === key)!;

beforeEach(() => {
  localStorage.clear();
  useIdentityStore.setState({ certificate: CERT(UID) } as any);
  usePlayerStore.getState().initializeSession(CERT(UID), 'NOMAD');
});

describe('the numbers of a fight are the rules\' own, each with what it means for the player', () => {
  it('names every number the brief asks for, each with a line saying what it means (GV: never what feeds it)', () => {
    const rows = SheetNumbers.fight(player());
    for (const key of ['hit', 'often', 'protection', 'dodge', 'crit', 'glance', 'walk', 'sight', 'carry']) {
      expect(row(rows, key), key).toBeDefined();
      expect(row(rows, key).says.length, key).toBeGreaterThan(10);
    }
  });

  it('the hit, how often, the crit and the protection are the combat rules\' functions', () => {
    const sword = gear('sword', SlotType.MAIN_HAND, { damage: 3, attack_speed: 1.5, crit_chance: 0.1 }, { tags: ['melee', 'weapon'] });
    const coat = gear('coat', SlotType.CHEST, { physical_reduction: 0.2, defense: 10, evasion_rating: 30 });
    wear([{ item: sword, slot: 'RIGHT_HAND' }, { item: coat, slot: 'CHEST' }]);
    const p = player();
    const rows = SheetNumbers.fight(p);
    expect(row(rows, 'hit').value).toContain(String(CombatMath.baseHit(sword, p.equipment, p.attributes, 0)));
    expect(row(rows, 'often').value).toContain(said(1000 / CombatMath.fireCooldownMs(sword, p.equipment, p.attributes)));
    expect(row(rows, 'crit').value).toContain(`${Math.round(StatSystem.critChance(p.equipment, p.attributes) * 100)}%`);
    expect(row(rows, 'protection').value).toContain(`${Math.round(CombatMath.mitigationOf(p.equipment) * 100)}%`);
    expect(row(rows, 'dodge').value).toContain(`${Math.round(CombatMath.dodgeChance(p.equipment, p.attributes) * 100)}%`);
    expect(row(rows, 'glance').value).toContain(`${Math.round(CombatMath.glanceChance(p.equipment, p.attributes) * 100)}%`);
  });

  it('the dodge the sheet shows is the dodge a blow rolls against', () => {
    const coat = gear('coat', SlotType.CHEST, { evasion_rating: 60 });
    wear([{ item: coat, slot: 'CHEST' }]);
    const p = player();
    const n = 4000;
    let dodged = 0;
    for (let i = 0; i < n; i++) if (CombatMath.incoming(10, p.equipment, `sheet:dodge:${i}`, p.attributes).dodged) dodged++;
    expect(Math.abs(dodged / n - CombatMath.dodgeChance(p.equipment, p.attributes))).toBeLessThan(0.03);
  });

  it('the glance the sheet shows is the glance a hit that does not crit rolls against', () => {
    const p = player();
    let plain = 0, glanced = 0;
    for (let i = 0; i < 4000; i++) {
      const hit = CombatMath.outgoing(undefined, p.equipment, `sheet:glance:${i}`, p.attributes);
      if (hit.crit) continue;
      plain++;
      if (hit.glance) glanced++;
    }
    expect(Math.abs(glanced / plain - CombatMath.glanceChance(p.equipment, p.attributes))).toBeLessThan(0.03);
  });

  it('the carry limit is the one right function: the bag and what is worn both count', () => {
    const belt = gear('belt', SlotType.BELT, { carry_capacity: 7 });
    wear([{ item: belt, slot: 'BELT' }]);
    const p = player();
    const limit = LoadoutSystem.carryLimit(p.attributes.strength, p.equipment);
    expect(row(SheetNumbers.fight(p), 'carry').value).toContain(`${limit}`);
    expect(limit).toBeGreaterThan(30 + p.attributes.strength * 10);
  });

  it('the walk is the walk the rules give, tonics and all', () => {
    usePlayerStore.setState(s => ({ player: { ...s.player, tonicsSinceRest: 2 } }));
    const p = player();
    expect(row(SheetNumbers.fight(p), 'walk').value).toContain(LoadoutSystem.walkOf(p).toFixed(1));
  });
});

describe('health, energy and aether, with their maxima', () => {
  it('reads the maxima from the rules, and aether per element against its capacity', () => {
    usePlayerStore.setState(s => ({ player: { ...s.player, reserves: { flora: 6, stone: 2 } } }));
    const p = player();
    const v = SheetNumbers.vitals(p);
    expect(v.health.max).toBe(StatSystem.maxHealth(p.attributes, p.equipment));
    expect(v.energy.max).toBe(StatSystem.maxEnergyOf(p));
    expect(v.aether.map(a => a.element).sort()).toEqual(['flora', 'stone']);
    expect(v.aether[0].max).toBe(WeaveSystem.capacity(p.attributes, p.equipment));
  });
});

describe('only what the person may know', () => {
  it('an unread piece worn acts, is counted, and is never named or broken out on the sheet', () => {
    const ring = gear('ring', SlotType.RING, { crit_chance: 0.3 }, { name: 'RING OF SECRETS', isIdentified: false });
    wear([{ item: ring, slot: 'RING_1' }]);
    const p = player();
    expect(StatSystem.critChance(p.equipment, p.attributes)).toBeGreaterThan(0.29);
    expect(SheetNumbers.hiddenWorn(p)).toBe(1);
    const said = JSON.stringify(SheetNumbers.fight(p));
    expect(said).not.toMatch(/SECRETS/);
  });

  it('a category of lore shows the word the person is allowed, never a concept\'s own key', () => {
    const p = player();
    const kinds = SheetNumbers.lore(p);
    expect(kinds.general).toBe(LoreSystem.held(p));
    expect(kinds.byCategory).toEqual(LoreSystem.shownKinds(p).map(k => ({ name: k.name, reads: k.reads })));
  });

  it('who walks with them is named only when the name was asked', () => {
    const bond = { worldSeed: 'w', entityId: 'npc_1', rank: UniversalRank.F, rarity: Rarity.COMMON, sheet: { name: 'Mara', temperament: '', objective: '', want: '', disposition: 0, attempts: 0 } };
    const escort = { entityId: 'npc_1', name: 'Mara', stats: player().attributes, health: 10, maxHealth: 10, lastStrikeAt: 0, strikes: 0, bond };
    usePlayerStore.setState(s => ({ player: { ...s.player, currentSession: { sessionId: 's', layerId: 'l', inventory: [], health: 100, maxHealth: 100, energy: 50, position: { x: 0, y: 0, z: 0 }, statusEffects: [], escorts: [escort] } as any } }));
    expect(SheetNumbers.companions(player()).map(c => c.name)).not.toContain('Mara');
    usePlayerStore.setState(s => ({ player: { ...s.player, namesKnown: { 'npc_1:Mara': true } } }));
    expect(SheetNumbers.companions(player()).map(c => c.name)).toContain('Mara');
  });

  it('what waits at the next rest is counted, and what was made is not named before it', () => {
    usePlayerStore.setState(s => ({ player: { ...s.player, restQueue: { studies: ['a'], weaves: [], met: ['m1', 'm2'], ground: [], made: [{ id: 'x', outcome: 'MADE' } as any] } } }));
    const waits = SheetNumbers.atRest(player());
    expect(waits.find(w => w.key === 'made')!.count).toBe(1);
    expect(waits.find(w => w.key === 'met')!.count).toBe(2);
    expect(JSON.stringify(waits)).not.toMatch(/"x"/);
  });
});

describe('one sheet, the same in a world and at home', () => {
  it('a key and a control open it from the small sheet, and the hub\'s AGENT tab shows it', () => {
    const stores = SRC('src/components/ui/stores.ts');
    expect(stores).toMatch(/large: boolean/);
    const small = SRC('src/components/CharacterSheet.tsx');
    expect(small).toMatch(/toggleLarge\(/);
    expect(small).toMatch(/shiftKey/);
    expect(small).toMatch(/LargeSheetOverlay/);
    const hub = SRC('src/components/PlayerHub.tsx');
    expect(hub).toMatch(/<LargeSheet\b/);
    expect(hub).not.toMatch(/const AgentTab/);
  });

  it('the sheet reads its numbers from the rules\' door, and adds none of its own', () => {
    const sheet = SRC('src/components/LargeSheet.tsx');
    expect(sheet).toMatch(/SheetNumbers\.fight\(/);
    expect(sheet).not.toMatch(/maxCarryWeight/);
    expect(sheet).not.toMatch(/strength \* 10/);
  });
});
