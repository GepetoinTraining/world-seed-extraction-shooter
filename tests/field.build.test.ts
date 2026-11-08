/**
 * THE FIELD, BUILT (Q12, Q13, Q16, Q17, Q27, Q44; Pedro, 2026-11-04). Registered before the build.
 *  - A person brought out walks beside you and fights back when engaged. Fallen, they are carried
 *    as a heavy body nobody may open, and they come back on the other side.
 *  - The levy does not count a person.
 *  - Identifying is a learned skill: nothing is read before town, and studying unread pieces teaches it.
 *  - The receipt does not show the worth of what nobody has read.
 *  - One quality scale: no quality word in a stored name, and never one before "The".
 *  - What a scan sees shows in the manifest, leaders and packs marked.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('../shared/entities/data/VectorStore', () => ({
  VectorNamespace: { CHARACTERS: 'characters', ITEMS: 'items', WORLDS: 'worlds', TRANSACTIONS: 'transactions', CONTENT: 'content', TERRITORIES: 'territories' },
  VectorStore: { get: async () => null, put: async () => true, query: async () => [], saveContent: async () => true, searchContent: async () => [] }
}));

import { IAttributes, IItem, ItemType, MENTAL_ATTRIBUTES, PHYSICAL_ATTRIBUTES, Rarity, SlotType, UniversalRank } from '../shared/types';
import { EntityType, IWorldEntity } from '../shared/entities/world/types';
import { useWorldStore, worldPort } from '../src/entities/world/store';
import { usePlayerStore, playerPort } from '../src/entities/player/store';
import { InteractionEngine } from '../src/entities/interaction/InteractionEngine';
import { MobAI } from '../src/entities/mob/ai/MobAI';
import { InventorySystem, HEAVY_LOAD_RATIO } from '../shared/entities/player/systems/InventorySystem';
import { LoadoutSystem } from '../shared/entities/player/systems/LoadoutSystem';
import { ItemFactory } from '../shared/entities/item/ItemFactory';
import { SalvageSystem } from '../src/logic/systems/SalvageSystem';
import { StatSystem } from '../shared/logic/systems/StatSystem';
import { StudySystem } from '../src/logic/systems/StudySystem';
import { StudyDoor } from '../src/logic/systems/StudyDoor';
import { RestSystem } from '../src/logic/systems/RestSystem';
import { SurveySystem } from '../src/logic/systems/SurveySystem';
import { Rng } from '../shared/logic/rng/DeterministicRNG';
import { inspectItem } from '../src/render/atoms/inspect';
import { ReceiptView } from '../src/components/ReceiptScreen';
import { Escort, ESCORT_REACH_PX } from '../src/logic/systems/Escort';
import { FieldEscort } from '../src/logic/systems/FieldEscort';
import { HaulReading } from '../src/logic/economy/HaulReading';
import { hubPort } from '../src/entities/hub/store';

const SRC = (p: string) => readFileSync(p, 'utf8');
const SEED = 'seed_field_build';
const UID = 'uid_field_build';
const player = () => usePlayerStore.getState().player;
const store = () => usePlayerStore.getState();

const spread = (over: Partial<IAttributes> = {}): IAttributes =>
  ({ ...Object.fromEntries([...PHYSICAL_ATTRIBUTES, ...MENTAL_ATTRIBUTES].map(a => [a, 2])), ...over }) as unknown as IAttributes;

const person = (id = 'ent_person', over: Partial<IWorldEntity> = {}): IWorldEntity => ({
  id, type: EntityType.NPC, definitionId: 'npc_survivor', position: { x: 40, y: 0 }, rank: UniversalRank.E, rarity: Rarity.COMMON, isHostile: false,
  npc: { name: 'Mara Quill', temperament: 'PASSIVE', objective: 'SURVIVE', want: 'GIFT', disposition: 99, attempts: 3 },
  ...over
});

const stage = (...entities: IWorldEntity[]) => {
  useWorldStore.setState({
    currentMap: { seed: SEED, width: 1, height: 1, gridVersion: 2, sectors: {}, generatedAt: 0, chunks: { '0,0': { id: '0,0', x: 0, y: 0, entities } } } as any,
    availableWorlds: [], activeWorldId: null
  } as any);
  usePlayerStore.setState(s => ({
    player: {
      ...s.player, id: UID, username: 'FIELDER', attributes: spread({ charisma: 6 }), baseAttributes: spread({ charisma: 6 }),
      currentSession: { sessionId: 'sess_field', layerId: 'l', inventory: [], kitItemIds: [], health: 100, maxHealth: 100, energy: 100, maxEnergy: 100, position: { x: 0, y: 0, z: 0 }, statusEffects: [] } as any
    }
  }));
};

const live = (id: string) => Object.values(useWorldStore.getState().currentMap!.chunks).flatMap(c => c.entities).find(e => e.id === id);

let minted = 0;
const thing = (over: Partial<IItem> = {}): IItem => ({
  id: `thing_${++minted}`, universalDefinitionId: 'res_tree_log', name: 'Oak Log', description: '', type: ItemType.RESOURCE, slot: SlotType.NONE,
  rank: UniversalRank.F, rarity: Rarity.COMMON, level: 1, quality: 0, value: 10, itemPower: 0, tags: ['wood'], affixes: [],
  dimensions: { width: 1, height: 1 }, weight: 1, stats: {}, visuals: { modelId: 'x', colorHex: '#000000' }, icon: 'x', history: { dropDate: 0, killCount: 0 }, isIdentified: true,
  ...over
});

const renderReceipt = (view: any): string => renderToStaticMarkup(createElement(ReceiptView, { receipt: view, clear: () => {} }));

const recruited = () => {
  stage(person());
  store().performInteraction('int_recruit_ent_person', 'ent_person');
  return player().currentSession!.escorts?.[0];
};

beforeEach(() => {
  MobAI.reset();
  minted = 0;
});

// ---------------------------------------------------------------------------
// Q16: THE ESCORT
// ---------------------------------------------------------------------------

describe('Q16: a person brought out walks beside you', () => {
  it('securing them keeps them in the world, at your side, and puts nothing in the pack', () => {
    const escort = recruited();
    expect(escort).toBeDefined();
    expect(escort!.name).toBe('Mara Quill');
    expect(player().currentSession!.inventory).toHaveLength(0);
    const body = live('ent_person');
    expect(body?.escort?.by).toBe(UID);
    expect(MobAI.isFollowing('ent_person')).toBe(true);
  });

  it('their health is their own, read from their own sheet', () => {
    const escort = recruited()!;
    expect(escort.maxHealth).toBe(StatSystem.maxHealth(escort.stats));
    expect(escort.health).toBe(escort.maxHealth);
  });

  it('they cannot be secured twice', () => {
    recruited();
    const options = InteractionEngine.getAvailableInteractions(player(), live('ent_person')!, 1);
    expect(options.some(o => o.id.startsWith('int_recruit_'))).toBe(false);
  });

  it('the field moves them toward you, at your pace', () => {
    recruited();
    useWorldStore.getState().updateEntity('ent_person', { position: { x: 400, y: 0 } });
    const map = useWorldStore.getState().currentMap!;
    const out = MobAI.tick(map.chunks, { x: 0, y: 0 }, 0.5, undefined, { walk: 4 });
    const moved = Object.values(out.updatedChunks).flatMap(c => c.entities).find(e => e.id === 'ent_person');
    expect(moved).toBeDefined();
    expect(moved!.position.x).toBeLessThan(400);
  });
});

describe('Q16: they fight back when engaged', () => {
  const base = () => Escort.join(person(), { worldSeed: SEED, entityId: 'ent_person', rank: UniversalRank.E, rarity: Rarity.COMMON, sheet: person().npc! } as any, spread());

  it('an engaged enemy in reach takes a blow', () => {
    const { swing, escort } = Escort.strike(base(), { x: 0, y: 0 }, [{ id: 'm1', x: ESCORT_REACH_PX - 5, y: 0, engaged: true }], 10_000);
    expect(swing).toBeDefined();
    expect(swing!.damage).toBeGreaterThan(0);
    expect(escort.strikes).toBe(1);
  });

  it('one that has not engaged is left alone, and so is one out of reach', () => {
    expect(Escort.strike(base(), { x: 0, y: 0 }, [{ id: 'm1', x: 10, y: 0, engaged: false }], 10_000).swing).toBeUndefined();
    expect(Escort.strike(base(), { x: 0, y: 0 }, [{ id: 'm1', x: ESCORT_REACH_PX * 3, y: 0, engaged: true }], 10_000).swing).toBeUndefined();
  });

  it('blows come at their own pace, from their own stats', () => {
    const first = Escort.strike(base(), { x: 0, y: 0 }, [{ id: 'm1', x: 10, y: 0, engaged: true }], 10_000).escort;
    expect(Escort.strike(first, { x: 0, y: 0 }, [{ id: 'm1', x: 10, y: 0, engaged: true }], 10_001).swing).toBeUndefined();
    expect(Escort.strike(first, { x: 0, y: 0 }, [{ id: 'm1', x: 10, y: 0, engaged: true }], 10_000 + Escort.cooldownMs(first.stats)).swing).toBeDefined();
  });

  it('a blow aimed their way lands on the nearest of them in its reach, and on nobody past it', () => {
    const bodies = [{ entityId: 'a', x: 100, y: 0 }, { entityId: 'b', x: 30, y: 0 }];
    expect(Escort.hitBy({ x: 0, y: 0 }, 50, bodies)).toBe('b');
    expect(Escort.hitBy({ x: 0, y: 0 }, 20, bodies)).toBeNull();
  });

  it('enough of them, and they fall', () => {
    const hurt = Escort.take(base(), 10, 'k1');
    expect(hurt.escort.health).toBeLessThanOrEqual(base().health);
    const down = Escort.take(base(), base().maxHealth * 100, 'k2');
    expect(down.fell).toBe(true);
    expect(down.escort.fallen).toBe(true);
    expect(down.escort.health).toBe(0);
  });
});

describe('Q16: fallen, they are carried as a heavy body nobody may open', () => {
  const fallen = () => {
    const e = recruited()!;
    FieldEscort.fall(e.entityId, worldPort, playerPort);
    return e;
  };

  it('a fallen person lies where they fell, and offers only to be carried', () => {
    fallen();
    const body = live('ent_person')!;
    expect(body.escort?.fallen).toBe(true);
    const options = InteractionEngine.getAvailableInteractions(player(), body, 1);
    expect(options.map(o => o.id)).toEqual(['int_carry_ent_person']);
  });

  it('the body weighs what they could carry themselves, enough to slow whoever carries them', () => {
    const e = fallen();
    const corpse = Escort.corpseOf(e);
    expect(corpse.weight).toBe(InventorySystem.maxCarryWeight(e.stats.strength));
    expect(corpse.weight).toBeGreaterThan(HEAVY_LOAD_RATIO * InventorySystem.maxCarryWeight(e.stats.strength));
  });

  it('carrying it takes it off the ground and into the pack', () => {
    usePlayerStore.setState(s => ({ player: { ...s.player, attributes: spread({ strength: 9, charisma: 6 }) } }));
    fallen();
    usePlayerStore.setState(s => ({ player: { ...s.player, attributes: spread({ strength: 9, charisma: 6 }) } }));
    store().performInteraction('int_carry_ent_person', 'ent_person');
    expect(live('ent_person')).toBeUndefined();
    const carried = player().currentSession!.inventory.find(Escort.isCorpse);
    expect(carried).toBeDefined();
  });

  it('too heavy for the pack, it stays where it lies', () => {
    fallen();
    usePlayerStore.setState(s => ({ player: { ...s.player, attributes: spread({ strength: 0, charisma: 6 }), currentSession: { ...s.player.currentSession!, inventory: [thing({ weight: 25 })] } } }));
    store().performInteraction('int_carry_ent_person', 'ent_person');
    expect(live('ent_person')).toBeDefined();
    expect(player().currentSession!.inventory.some(Escort.isCorpse)).toBe(false);
  });

  it('the body cannot be inspected or looted: no study, no salvage, no reading, nothing of theirs on its card', () => {
    const corpse = Escort.corpseOf(fallen());
    expect(Escort.isCorpse(corpse)).toBe(true);
    expect(StudyDoor.offered(corpse, playerPort, hubPort)).toBe(false);
    expect(SalvageSystem.components(corpse, 'k')).toBeNull();
    expect(StudySystem.identifyScopeOf(corpse)).toBeNull();
    const card = inspectItem(corpse, player());
    expect(JSON.stringify(card)).not.toMatch(/Regard|Hands|Wants|Alignment/);
    expect(SRC('src/components/CharacterSheet.tsx')).toMatch(/Escort\.isCorpse\(selectedItem\)/);
  });

  it('at the beacon the walking come home as a bond, and the carried come back on the other side', () => {
    usePlayerStore.setState(s => ({ player: { ...s.player, attributes: spread({ strength: 9, charisma: 6 }) } }));
    stage(person('ent_a'), person('ent_b', { npc: { ...person().npc!, name: 'Tam Reed' } }));
    usePlayerStore.setState(s => ({ player: { ...s.player, attributes: spread({ strength: 9, charisma: 6 }) } }));
    store().performInteraction('int_recruit_ent_a', 'ent_a');
    store().performInteraction('int_recruit_ent_b', 'ent_b');
    FieldEscort.fall('ent_b', worldPort, playerPort);
    store().performInteraction('int_carry_ent_b', 'ent_b');
    FieldEscort.walkOut(worldPort, playerPort);
    const inv = player().currentSession!.inventory;
    const bonds = inv.filter(i => i.bondData);
    expect(bonds.map(b => b.bondData!.entityId).sort()).toEqual(['ent_a', 'ent_b']);
    expect(inv.some(Escort.isCorpse)).toBe(false);
    expect(bonds.every(b => b.tags.includes('npc_contract'))).toBe(true);
    expect(live('ent_a')).toBeUndefined();
    expect(player().currentSession!.escorts ?? []).toHaveLength(0);
  });

  it('the field sends blows their way and hands theirs to the fight', () => {
    const canvas = SRC('src/components/WorldCanvas.tsx');
    expect(canvas).toMatch(/FieldEscort\.walkOut\(worldPort, playerPort\)/);
    expect(canvas).toMatch(/Escort\.hitBy\(/);
    expect(canvas).toMatch(/FieldEscort\.swings\(/);
  });

  // Found in play: the frame writes its own copy of the chunks back after the blows land
  it('what the frame writes back over them is put right from their own record', () => {
    recruited();
    const stale = JSON.parse(JSON.stringify(useWorldStore.getState().currentMap!.chunks));
    FieldEscort.hurt('ent_person', 10_000, 'k_stale', worldPort, playerPort);
    useWorldStore.setState(s => ({ currentMap: { ...s.currentMap!, chunks: stale } }));
    expect(live('ent_person')!.escort?.fallen).toBeFalsy();
    FieldEscort.settle(worldPort, playerPort);
    expect(live('ent_person')!.escort?.fallen).toBe(true);
    expect(live('ent_person')!.health).toBe(0);
    expect(SRC('src/components/WorldCanvas.tsx')).toMatch(/chunks: \{ \.\.\.state\.currentMap\.chunks, \.\.\.chunkUpdates \} \} \}\s*: state\);\s*\/\/[^\n]*\n\s*FieldEscort\.settle\(worldPort, playerPort\);/);
  });
});

// ---------------------------------------------------------------------------
// Q17 and Q12: THE LEVY AND THE RECEIPT
// ---------------------------------------------------------------------------

describe('Q17 and Q12: the levy and the receipt', () => {
  const bond = thing({ id: 'bond_1', name: 'Escort Bond: Mara Quill', type: ItemType.LORE, value: 200, tags: ['npc_contract', 'social'], bondData: { worldSeed: SEED, entityId: 'p', rank: UniversalRank.E, rarity: Rarity.COMMON, sheet: person().npc! } as any });
  const read = thing({ id: 'read_1', value: 30 });
  const unread = thing({ id: 'unread_1', value: 2803, isIdentified: false });

  it('the levy does not count a person; it counts what nobody has read, unseen', () => {
    const r = HaulReading.read([bond, read, unread]);
    expect(r.leviable).toBe(30 + 2803);
    expect(r.persons).toEqual(['Mara Quill']);
  });

  it('the receipt shows only what has been read, and how many have not', () => {
    const r = HaulReading.read([bond, read, unread]);
    expect(r.shownWorth).toBe(30);
    expect(r.unread).toBe(1);
  });

  it('the vault door says nothing of the unread worth, and only that a levy was taken', () => {
    const r = HaulReading.read([read, unread]);
    const html = renderReceipt({
      outcome: 'EXTRACTED', haul: [read, unread], haulValue: r.shownWorth, unread: r.unread, persons: r.persons, tax: 141,
      levy: { attempted: true, dodged: false }, worldName: 'W', durationMs: 1000, actionCount: 3
    });
    expect(html).not.toContain('2,803');
    expect(html).not.toContain('2,833');
    expect(html).not.toContain('141');
    expect(html).toMatch(/UNREAD/);
    expect(html).toMatch(/TAKEN/);
  });

  it('a person brought out is named on the receipt, and not priced', () => {
    const r = HaulReading.read([bond]);
    const html = renderReceipt({ outcome: 'EXTRACTED', haul: [bond], haulValue: r.shownWorth, unread: r.unread, persons: r.persons, tax: 0, worldName: 'W', durationMs: 1, actionCount: 1 });
    expect(html).toContain('Mara Quill');
    expect(html).not.toContain('200');
  });

  it('the field charges the levy on the haul as read by HaulReading', () => {
    const canvas = SRC('src/components/WorldCanvas.tsx');
    expect(canvas).toMatch(/HaulReading\.read\(haul\)/);
    expect(canvas).toMatch(/ExitLevy\.attemptNow\([^)]*leviable/);
    expect(canvas).toMatch(/ExitLevy\.charge\([^)]*leviable/);
  });
});

// ---------------------------------------------------------------------------
// Q27: IDENTIFYING IS A LEARNED SKILL
// ---------------------------------------------------------------------------

describe('Q27: identifying is a learned skill, and nothing is read before town', () => {
  const unreadWeapon = (key: string) => ItemFactory.createItem(UniversalRank.F, false, Rng.fromKey(`q27:${key}`), 'weapon');
  const reset = () => usePlayerStore.setState(s => ({
    player: { ...s.player, currentSession: undefined, energyToday: undefined, restQueue: undefined, bank: { ...s.player.bank, universalSkills: {}, stashTabs: [{ ...s.player.bank.stashTabs[0], items: [] }] } }
  }));
  beforeEach(reset);

  it('the field has no identify: the button and its doors are gone', () => {
    expect(SRC('src/components/CharacterSheet.tsx')).not.toMatch(/fieldIdentify|IDENTIFY ·/);
    expect((store() as any).fieldIdentify).toBeUndefined();
    expect((store() as any).completeFieldIdentify).toBeUndefined();
  });

  it('coming home reads nothing: an unread piece is banked unread', () => {
    const item = unreadWeapon('bank');
    store().diveIntoLayer('layer-q27');
    store().tryAddItems([item]);
    store().emergencyJackOut('NONE');
    const banked = player().bank.stashTabs.flatMap(t => t.items).find(i => i.id === item.id);
    expect(banked?.isIdentified).toBe(false);
  });

  it('without the eye, a piece cannot be read; with it, it can', () => {
    const item = unreadWeapon('eye');
    expect(StudySystem.canRead(player(), item)).toBe(false);
    store().gainSkillXp(StudySystem.scopeSkillId('weapon'), 1, ['study']);
    expect(StudySystem.canRead(player(), item)).toBe(true);
    expect(StudySystem.canRead(player(), { ...item, isIdentified: true })).toBe(true);
  });

  it('studying an unread piece at the bench with no eye teaches the eye, and reads nothing', () => {
    const item = unreadWeapon('bench');
    usePlayerStore.setState(s => ({ player: { ...s.player, bank: { ...s.player.bank, stashTabs: [{ ...s.player.bank.stashTabs[0], items: [item] }] } } }));
    expect(store().studyItemAtStation(item.id).ok).toBe(true);
    expect(RestSystem.isStudied(player(), item.id)).toBe(false);
    expect(StudySystem.identifyLevel(player(), item)).toBeGreaterThan(0);
    expect(store().studyItemAtStation(item.id).ok).toBe(true);
    expect(RestSystem.isStudied(player(), item.id)).toBe(true);
  });

  it('a sitting on an unread piece reads it only through the eye', () => {
    expect(SRC('src/logic/systems/StudyDoor.ts')).toMatch(/StudySystem\.canRead\(/);
  });
});

// ---------------------------------------------------------------------------
// Q13: ONE QUALITY SCALE
// ---------------------------------------------------------------------------

describe('Q13: one quality scale, and no quality word in a name', () => {
  it('no piece the factory makes carries a quality word in its name', () => {
    for (let i = 0; i < 300; i++) {
      const item = ItemFactory.createItem(UniversalRank.F, true, Rng.fromKey(`q13:${i}`), (['weapon', 'armor', 'tool'] as const)[i % 3]);
      expect(item.name).not.toMatch(/\b(Broken|Superior|Crude|Rough|Standard|Fine)\b/);
    }
  });

  it('what was stored with a word before reads without it, and never puts one before "The"', () => {
    const legacy = (name: string, quality: number) => thing({ name, quality, type: ItemType.GEAR, slot: SlotType.MAIN_HAND });
    expect(LoadoutSystem.shownName(legacy('Broken The Repossessor', -0.2))).toBe('The Repossessor');
    expect(LoadoutSystem.shownName(legacy("Superior Clerk's Abacus", 0.18))).toBe("Clerk's Abacus");
    expect(inspectItem(legacy('Broken The Repossessor', -0.2)).title).toBe('The Repossessor');
  });

  it('a prefix on a name that starts with "The" goes after it', () => {
    expect(ItemFactory.nameOf('The Repossessor', [{ id: 'p', name: 'Heavy', type: 'PREFIX', stats: {}, tier: 1 }])).toBe('The Heavy Repossessor');
    expect(ItemFactory.nameOf('Field Axe', [{ id: 'p', name: 'Heavy', type: 'PREFIX', stats: {}, tier: 1 }])).toBe('Heavy Field Axe');
  });
});

// ---------------------------------------------------------------------------
// Q44: WHAT A SCAN SEES SHOWS
// ---------------------------------------------------------------------------

describe('Q44: what a scan sees shows in the manifest, leaders and packs marked', () => {
  const body = (id: string, over: Partial<IWorldEntity> = {}): IWorldEntity => ({
    id, type: EntityType.MOB, definitionId: 'secret_kind', position: { x: 0, y: 0 }, rank: UniversalRank.E, rarity: Rarity.COMMON, isHostile: true, health: 10, ...over
  });

  it('nothing it saw is cut off', () => {
    const many = Array.from({ length: 15 }, (_, i) => body(`solo_${i}`, { displayName: `Kind ${i}` }));
    expect(SurveySystem.manifest(many)).toHaveLength(15);
  });

  it('a leader is marked, with the pack behind it', () => {
    const lines = SurveySystem.manifest([body('lead_1_2_0', { rank: UniversalRank.D }), body('lead_1_2_0_f0'), body('lead_1_2_0_f1'), body('lead_1_2_0_f2')]);
    const leader = lines.find(l => l.mark === 'leader')!;
    expect(leader).toBeDefined();
    expect(leader.rank).toBe('D');
    expect(leader.pack).toBe(3);
    expect(lines.filter(l => l.mark !== 'leader').reduce((n, l) => n + l.count, 0)).toBe(0);
  });

  it('a pack with no leader is marked as a pack', () => {
    const lines = SurveySystem.manifest([body('pop_3_4_rat_0'), body('pop_3_4_rat_1'), body('pop_3_4_rat_2'), body('solo')]);
    const pack = lines.find(l => l.mark === 'pack')!;
    expect(pack.count).toBe(3);
    expect(lines.find(l => l.mark === 'single')!.count).toBe(1);
  });

  it('it still gives away no name or kind', () => {
    const text = JSON.stringify(SurveySystem.manifest([body('lead_1_2_0'), body('lead_1_2_0_f0')]));
    expect(text).not.toContain('secret');
  });

  it('recon shows leaders and packs from the scan that sees them, and marks danger by shape', () => {
    const recon = SRC('src/components/ReconView.tsx');
    expect(recon).toMatch(/LEADERS AND PACKS/);
    expect(recon).toMatch(/SurveySystem\.packs\(/);
    expect(recon).not.toMatch(/className=\{line\.hostile \? 'ws-loss' : undefined\}>\{line\.count\}/);
  });
});
