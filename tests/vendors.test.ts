/**
 * VENDORS AND THE APPRENTICE ROAD. Pedro, 2026-11-01: "add a stock and goal function to
 * the vendors please, this will be the npc code as well, but the general vendors need to
 * be different, they will train up the NPCs that have no crafting skill and are weak."
 *
 * Registered before the build. The road's shape is the donor's, engine/craftsman.ts in
 * the ttrpg folder: untrained, apprentice, journeyman, master. No bar calls a model.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const db = new Map<string, any>();
vi.mock('../src/entities/data/VectorStore', () => ({
  VectorNamespace: { CHARACTERS: 'characters', ITEMS: 'items', WORLDS: 'worlds', TRANSACTIONS: 'transactions', CONTENT: 'content', TERRITORIES: 'territories', AVATARS: 'avatars' },
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

import { IAttributes, IItem, ISkillState, ItemType, PHYSICAL_ATTRIBUTES, Rarity, UniversalRank } from '../types';
import { NEEDS, NpcAgenda } from '../src/logic/systems/NpcAgenda';
import { IVendorRecord, VENDOR_GOALS, VendorSystem } from '../src/logic/systems/VendorSystem';
import { ApprenticeRoad, ICraftsman, TERM_DAYS, TRIAL_DC } from '../src/logic/systems/ApprenticeRoad';
import { NpcSheet } from '../src/logic/systems/NpcSheet';
import { WebBank } from '../src/logic/content/WebBank';
import { WebSystem } from '../src/logic/systems/WebSystem';
import { TagLaw } from '../src/logic/content/TagLaw';
import { HUB_NPCS } from '../src/entities/hub/HubGenerator';
import { DIALOGUE_HANDLERS, HANDLED_ACTIONS, runDialogueAction } from '../src/entities/hub/dialogue';
import { useHubStore } from '../src/entities/hub/store';
import { emptyGuild } from '../src/entities/hub/guild';
import { usePlayerStore } from '../src/entities/player/store';
import { ItemFactory } from '../src/entities/item/ItemFactory';
import { Rng } from '../src/logic/rng/DeterministicRNG';
import { readFileSync } from 'node:fs';

const DAY = 20_000;
const GENERAL = ['npc_weapon_vendor', 'npc_armor_vendor', 'npc_alchemist'];

const listing = (id: string, stock = 5, price = 100) => ({ id, item: { id: `item_${id}`, value: 50, isIdentified: true } as IItem, price, vendorId: 'vendor_sys', stock });
const vendor = (over: Partial<IVendorRecord> = {}): IVendorRecord => ({ ...VendorSystem.fresh('npc_weapon_vendor', 'GENERAL', DAY, 'smithing'), ...over });

/** Look through people until one answers to the test. Keyed, so the same one every run. */
const bondOf = (id: string, rank = UniversalRank.F): IItem => ({
  id: `bond_${id}`, name: `Escort Bond: ${id}`, type: ItemType.RESOURCE, value: 1, tags: [],
  // A real bond carries its world's pinned web: a sheet with none reads the first version, where nobody holds a craft
  bondData: { worldSeed: 'seed_road', entityId: id, webVersion: WebBank.current().version, rank, rarity: Rarity.COMMON, sheet: { name: id, temperament: 'PASSIVE', objective: 'SURVIVE', want: 'GOLD', disposition: 70, attempts: 0 } }
} as unknown as IItem);
const candidates = () => Array.from({ length: 400 }, (_, i) => bondOf(`p${i}`));
const pick = (want: boolean) => candidates().find(b => ApprenticeRoad.unfit(b, WebBank.current()).ok === want)!;
const master = (over = {}) => ({ id: 'npc_weapon_vendor', trade: 'smithing', room: 2, taken: 0, ...over });
const begun = (over = {}): ICraftsman => ApprenticeRoad.begin(pick(true), master(over), 'sponsor', DAY, WebBank.current()).craftsman!;

describe('the agenda: the one piece of npc code', () => {
  it('a new person starts with the donor\'s five needs, and the same person starts the same', () => {
    expect(Object.keys(NpcAgenda.fresh(DAY).needs).sort()).toEqual([...NEEDS].sort());
    expect(NpcAgenda.fresh(DAY)).toEqual(NpcAgenda.fresh(DAY));
  });

  it('needs fall with the days, and only with the days', () => {
    const a = NpcAgenda.fresh(DAY);
    expect(NpcAgenda.fold(a, DAY)).toEqual(a);
    expect(NpcAgenda.fold(a, DAY + 1).needs.survival).toBeLessThan(a.needs.survival);
    expect(NpcAgenda.fold(a, DAY - 3)).toEqual(a);
  });

  it('a long absence folds to the same place as a day at a time', () => {
    const fills = { survival: 1 };
    let stepped = NpcAgenda.fresh(DAY);
    for (let d = 1; d <= 9; d++) stepped = NpcAgenda.fold(stepped, DAY + d, fills);
    expect(NpcAgenda.fold(NpcAgenda.fresh(DAY), DAY + 9, fills)).toEqual(stepped);
  });

  it('no need leaves its range, however long or however much', () => {
    const low = NpcAgenda.fold(NpcAgenda.fresh(DAY), DAY + 10_000);
    for (const need of NEEDS) expect(low.needs[need]).toBeGreaterThanOrEqual(0);
    const high = NpcAgenda.fill(NpcAgenda.fresh(DAY), { purpose: 10_000 });
    expect(high.needs.purpose).toBeLessThanOrEqual(100);
  });

  it('the most pressing need is the lowest tier under half, as the donor has it', () => {
    const a = NpcAgenda.fresh(DAY);
    expect(NpcAgenda.pressing({ ...a, needs: { ...a.needs, survival: 40, purpose: 1 } })).toBe('survival');
    expect(NpcAgenda.pressing({ ...a, needs: { survival: 90, safety: 90, belonging: 90, esteem: 90, purpose: 60 } })).toBe('purpose');
    expect(NpcAgenda.pressing({ ...a, needs: { survival: 90, safety: 90, belonging: 49, esteem: 1, purpose: 1 } })).toBe('belonging');
  });
});

describe('a vendor is its own container: stock', () => {
  it('each general vendor names a trade the web has, and teaches it', () => {
    for (const id of GENERAL) {
      const trade = HUB_NPCS[id].teaches?.trade;
      expect(trade, id).toBeTruthy();
      expect(WebBank.hasKind(WebBank.current(), trade!, ['trade']), id).toBe(true);
      expect(WebSystem.isLawfulId(TagLaw.skillIdOf([trade!])), id).toBe(true);
    }
  });

  it('nobody else in the city is a general vendor', () => {
    for (const [id, npc] of Object.entries(HUB_NPCS)) expect(!!npc.teaches, id).toBe(GENERAL.includes(id));
  });

  it('the shelf carries the vendor\'s own name, never a shared one', () => {
    const shelf = VendorSystem.shelf(vendor(), [listing('a')], DAY, 0);
    expect(shelf[0].vendorId).toBe('npc_weapon_vendor');
  });

  it('what was sold today stays sold, and a new day stocks again', () => {
    const sold = VendorSystem.recordSale(vendor(), 'a', DAY, 0.8);
    expect(VendorSystem.shelf(sold, [listing('a', 5), listing('b', 5)], DAY, 0).map(l => l.stock)).toEqual([4, 5]);
    expect(VendorSystem.shelf(VendorSystem.fold(sold, DAY + 1), [listing('a', 5)], DAY + 1, 0)[0].stock).toBeGreaterThanOrEqual(5);
  });

  it('a shelf never reads below nothing', () => {
    let v = vendor();
    for (let i = 0; i < 9; i++) v = VendorSystem.recordSale(v, 'a', DAY, 0);
    expect(VendorSystem.shelf(v, [listing('a', 2)], DAY, 0)[0].stock).toBe(0);
  });

  it('what a vendor buys sits on its shelf, the same item, once', () => {
    const piece = { id: 'itm_sold', value: 40, isIdentified: true, name: 'Old Blade' } as IItem;
    const v = VendorSystem.receive(vendor(), piece);
    const row = VendorSystem.shelf(v, [listing('a')], DAY, 0).find(l => l.item.id === 'itm_sold')!;
    expect(row.stock).toBe(1);
    expect(row.price).toBeGreaterThan(piece.value);
    const after = VendorSystem.takeHeld(v, 'itm_sold');
    expect(VendorSystem.shelf(after, [listing('a')], DAY, 0).some(l => l.item.id === 'itm_sold')).toBe(false);
  });

  it('a piece nobody has read stays in the container, and off the shelf, so its name stays secret', () => {
    const v = VendorSystem.receive(vendor(), { id: 'itm_unread', value: 40, isIdentified: false, name: 'A Secret' } as IItem);
    expect(v.held).toHaveLength(1);
    expect(VendorSystem.shelf(v, [], DAY, 0)).toEqual([]);
  });

  it('a person the vendor raised adds to its stock', () => {
    const plain = VendorSystem.shelf(vendor(), [listing('a', 5)], DAY, 0)[0].stock;
    expect(VendorSystem.shelf(vendor(), [listing('a', 5)], DAY, 2)[0].stock).toBe(plain + 2);
  });

  it('the same record and the same day give the same shelf', () => {
    const v = VendorSystem.recordSale(vendor(), 'a', DAY, 0.5);
    expect(VendorSystem.shelf(v, [listing('a')], DAY, 1)).toEqual(VendorSystem.shelf(v, [listing('a')], DAY, 1));
  });
});

describe('a vendor has a goal, and every goal does something', () => {
  const needing = (need: string, value = 10): IVendorRecord => {
    const v = vendor();
    return { ...v, agenda: { ...v.agenda, needs: { survival: 90, safety: 90, belonging: 90, esteem: 90, purpose: 90, [need]: value } } };
  };

  it('the goal is read from the need, not stored', () => {
    for (const need of NEEDS) expect(VendorSystem.goalOf(needing(need))).toBe(VENDOR_GOALS[need].goal);
    expect(JSON.stringify(vendor())).not.toContain('"goal"');
  });

  it('every goal can be said, in words', () => {
    for (const need of NEEDS) expect(VendorSystem.say(needing(need)).length).toBeGreaterThan(10);
  });

  it('short of a living, it marks the shelf down', () => {
    expect(VendorSystem.shelf(needing('survival'), [listing('a', 5, 100)], DAY, 0)[0].price).toBeLessThan(100);
    expect(VendorSystem.shelf(needing('safety'), [listing('a', 5, 100)], DAY, 0)[0].price).toBe(100);
  });

  it('with a thin shelf, it stocks more the next day', () => {
    expect(VendorSystem.shelf(needing('safety'), [listing('a', 5)], DAY, 0)[0].stock).toBeGreaterThan(5);
    expect(VendorSystem.shelf(needing('survival'), [listing('a', 5)], DAY, 0)[0].stock).toBe(5);
  });

  it('with no one to raise, it says so', () => {
    expect(VendorSystem.say(needing('belonging'))).toMatch(/someone|apprentice/i);
  });

  it('wanting a name or a legacy, it works its apprentices harder, the donor\'s hours', () => {
    const base = VendorSystem.teachingHours(needing('survival'));
    expect(base).toBe(1);
    expect(VendorSystem.teachingHours(needing('esteem'))).toBeGreaterThan(base);
    expect(VendorSystem.teachingHours(needing('purpose'))).toBeGreaterThan(VendorSystem.teachingHours(needing('esteem')));
    expect(VendorSystem.teachingHours(needing('purpose'))).toBeLessThanOrEqual(1.5);
  });

  it('a sale feeds the living, and sets how thin the shelf reads', () => {
    const before = needing('survival');
    const after = VendorSystem.recordSale(before, 'a', DAY, 0.2);
    expect(after.agenda.needs.survival).toBeGreaterThan(before.agenda.needs.survival);
    expect(after.agenda.needs.safety).toBe(20);
  });

  it('a vendor left alone comes to want a sale', () => {
    const left = VendorSystem.fold(vendor(), DAY + 30);
    expect(VendorSystem.goalOf(left)).toBe(VENDOR_GOALS.survival.goal);
  });
});

describe('who the general vendors take: no crafting skill, and weak', () => {
  it('the people are read through the bond\'s own door', () => {
    const bond = pick(true);
    const sheet = NpcSheet.fromBond(bond)!;
    expect(ApprenticeRoad.unfit(bond, WebBank.current())).toEqual(ApprenticeRoad.unfit(bond, WebBank.current()));
    expect(sheet.stats).toBeDefined();
  });

  it('every person it takes has no crafting skill and a body under their own average', () => {
    const pack = WebBank.current();
    for (const bond of candidates().filter(b => ApprenticeRoad.unfit(b, pack).ok)) {
      const sheet = NpcSheet.fromBond(bond)!;
      const stats = sheet.stats as IAttributes;
      const values = Object.values(stats) as number[];
      const mean = values.reduce((s, v) => s + v, 0) / values.length;
      const body = PHYSICAL_ATTRIBUTES.reduce((s, a) => s + (stats as any)[a], 0) / PHYSICAL_ATTRIBUTES.length;
      expect(body).toBeLessThan(mean);
      for (const skill of Object.values(sheet.skills ?? {}) as ISkillState[]) {
        expect(skill.tags.some(t => WebBank.hasKind(pack, t, ['trade']))).toBe(false);
      }
      expect(WebSystem.openStations(sheet.skills ?? {}, pack)).toEqual([]);
    }
  });

  it('it takes some and leaves some: the badly dealt, and not the crowd', () => {
    const pack = WebBank.current();
    const taken = candidates().filter(b => ApprenticeRoad.unfit(b, pack).ok).length;
    expect(taken).toBeGreaterThan(0);
    expect(taken).toBeLessThan(400 / 2);
  });

  it('each half of the rule refuses people of its own: a craft, and a body', () => {
    const pack = WebBank.current();
    const sheets = candidates().map(b => NpcSheet.fromBond(b)!);
    expect(sheets.filter(s => ApprenticeRoad.hasCraft(s, pack)).length).toBeGreaterThan(0);
    expect(sheets.filter(s => !ApprenticeRoad.hasCraft(s, pack) && !ApprenticeRoad.isWeak(s.stats as IAttributes)).length).toBeGreaterThan(0);
  });

  it('the higher the rank, the less often someone is this badly off', () => {
    const pack = WebBank.current();
    const at = (rank: UniversalRank) => Array.from({ length: 400 }, (_, i) => bondOf(`p${i}`, rank)).filter(b => ApprenticeRoad.unfit(b, pack).ok).length;
    expect(at(UniversalRank.A)).toBeLessThan(at(UniversalRank.F));
  });

  it('a strong person is refused, and told why', () => {
    const v = ApprenticeRoad.unfit(pick(false), WebBank.current());
    expect(v.ok).toBe(false);
    expect(v.reason!.length).toBeGreaterThan(5);
  });

  it('a person who already holds a trade is refused for that', () => {
    const pack = WebBank.current();
    const bond = pick(true);
    const trained = { ...NpcSheet.fromBond(bond)!, skills: { skill_smithing: WebSystem.freshSkill(TagLaw.skillIdOf(['smithing']), ['smithing'], 0) } };
    expect(ApprenticeRoad.hasCraft(trained, pack)).toBe(true);
  });

  it('anything that is not a bond is refused', () => {
    const v = ApprenticeRoad.begin({ id: 'x', tags: [] } as unknown as IItem, master(), 's', DAY, WebBank.current());
    expect(v.ok).toBe(false);
  });
});

describe('the road: untrained, apprentice, journeyman, master', () => {
  it('beginning makes an apprentice of the master\'s trade, with the skill started', () => {
    const c = begun();
    expect(c.rank).toBe('APPRENTICE');
    expect(c.masterId).toBe('npc_weapon_vendor');
    expect(c.trade).toBe('smithing');
    expect(c.skill.id).toBe(TagLaw.skillIdOf(['smithing']));
    expect(c.progress).toBe(0);
  });

  it('a master\'s room comes from their own leadership, not a number here', () => {
    expect(ApprenticeRoad.roomFor({ leadership: 9 } as IAttributes)).toBeGreaterThan(ApprenticeRoad.roomFor({ leadership: 1 } as IAttributes));
    expect(ApprenticeRoad.roomFor({ leadership: 1 } as IAttributes)).toBeGreaterThanOrEqual(1);
    expect(ApprenticeRoad.roomFor({ leadership: 400 } as IAttributes)).toBeGreaterThan(100);
  });

  it('a master with no room says so', () => {
    const v = ApprenticeRoad.begin(pick(true), master({ taken: 2 }), 's', DAY, WebBank.current());
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/room/i);
  });

  it('progress comes with the days, on the world\'s clock, and only then', () => {
    const c = begun();
    expect(ApprenticeRoad.resolve(c, DAY, () => 1).craftsman.progress).toBe(0);
    expect(ApprenticeRoad.resolve(c, DAY + 1, () => 1).craftsman.progress).toBeGreaterThan(0);
  });

  it('a clever one learns faster, and more hours teach faster', () => {
    const slow = begun(); const quick = { ...begun(), intModifier: slow.intModifier + 2 };
    expect(ApprenticeRoad.resolve(quick, DAY + 1, () => 1).craftsman.progress).toBeGreaterThan(ApprenticeRoad.resolve(slow, DAY + 1, () => 1).craftsman.progress);
    expect(ApprenticeRoad.resolve(slow, DAY + 1, () => 1.5).craftsman.progress).toBeGreaterThan(ApprenticeRoad.resolve(slow, DAY + 1, () => 1).craftsman.progress);
  });

  it('the term ends at the exam: a journeyman, with the skill at least handled', () => {
    const { craftsman, events } = ApprenticeRoad.resolve({ ...begun(), intModifier: 0 }, DAY + TERM_DAYS + 1, () => 1);
    expect(craftsman.rank).toBe('JOURNEYMAN');
    expect(craftsman.progress).toBe(100);
    expect(WebSystem.masteryOf(craftsman.skill).rung).toBeGreaterThanOrEqual(1);
    expect(events.some(e => e.to === 'JOURNEYMAN')).toBe(true);
  });

  it('no apprentice is a journeyman the day before they could be', () => {
    const c = { ...begun(), intModifier: 3 };
    expect(ApprenticeRoad.resolve(c, DAY + 1, () => 1.5).craftsman.rank).toBe('APPRENTICE');
  });

  it('a journeyman attempts the masterwork, keyed, and the same run gives the same result', () => {
    const c = { ...begun(), rank: 'JOURNEYMAN' as const, progress: 100 };
    const a = ApprenticeRoad.resolve(c, DAY + 200, () => 1);
    expect(ApprenticeRoad.resolve(c, DAY + 200, () => 1)).toEqual(a);
    expect(a.craftsman.trials).toBeGreaterThan(0);
  });

  it('a long enough road ends at master, and a trial below the bar does not', () => {
    const c = { ...begun(), rank: 'JOURNEYMAN' as const, progress: 100, intModifier: 0 };
    const { craftsman, events } = ApprenticeRoad.resolve(c, DAY + 400, () => 1);
    expect(craftsman.rank).toBe('MASTER');
    expect(events.filter(e => e.to === 'MASTER')).toHaveLength(1);
    expect(ApprenticeRoad.trialTotal(1, 1, 0)).toBeLessThan(TRIAL_DC);
    expect(ApprenticeRoad.trialTotal(20, 3, 0)).toBeGreaterThanOrEqual(TRIAL_DC);
  });

  it('being away folds to the same person as watching every day', () => {
    let stepped = begun();
    for (let d = 1; d <= 40; d++) stepped = ApprenticeRoad.resolve(stepped, DAY + d, () => 1).craftsman;
    expect(ApprenticeRoad.resolve(begun(), DAY + 40, () => 1).craftsman).toEqual(stepped);
  });

  it('they work on the same agenda as anyone: housed and fed under a master', () => {
    const c = begun();
    const later = ApprenticeRoad.resolve(c, DAY + 3, () => 1).craftsman;
    expect(later.agenda.needs.survival).toBeGreaterThan(c.agenda.needs.survival);
  });

  it('a master can take apprentices of their own, and an apprentice cannot', () => {
    const raised = { ...begun(), rank: 'MASTER' as const };
    expect(ApprenticeRoad.canTeach(raised)).toBe(true);
    expect(ApprenticeRoad.canTeach(begun())).toBe(false);
    expect(ApprenticeRoad.canTeach({ ...begun(), rank: 'JOURNEYMAN' })).toBe(false);
  });

  it('what they add to a shelf grows with what they have become', () => {
    const on = (rank: ICraftsman['rank']) => ApprenticeRoad.labor([{ ...begun(), rank }], 'npc_weapon_vendor');
    expect(on('APPRENTICE')).toBe(0);
    expect(on('JOURNEYMAN')).toBeGreaterThan(0);
    expect(on('MASTER')).toBeGreaterThan(on('JOURNEYMAN'));
    expect(ApprenticeRoad.labor([{ ...begun(), rank: 'MASTER' }], 'npc_alchemist')).toBe(0);
  });
});

describe('the city\'s doors: real stores, real saves', () => {
  const hub = () => useHubStore.getState();
  const stash = () => usePlayerStore.getState().player.bank.stashTabs[0].items;
  /** Through the tavern, as everyone comes (D75). The bench reads who is lodged there. */
  const lodge = async (bond: IItem) => {
    usePlayerStore.setState(s => ({ player: { ...s.player, bank: { ...s.player.bank, stashTabs: s.player.bank.stashTabs.map((t, i) => i === 0 ? { ...t, items: [bond] } : t) } } }));
    expect((await hub().redeemBond(bond.id)).ok).toBe(true);
    return hub().guild.residents[hub().guild.residents.length - 1].id;
  };

  beforeEach(async () => {
    db.clear();
    usePlayerStore.setState(s => ({ player: { ...s.player, bank: { ...s.player.bank, gold: 100_000, stashTabs: s.player.bank.stashTabs.map((t, i) => i === 0 ? { ...t, items: [] } : t) } } }));
    useHubStore.setState({ vendors: {}, craftsmen: [], guild: emptyGuild() });
    await hub().loadHub('hub_vendors');
  });

  it('every shelf carries its own vendor', () => {
    expect(new Set(hub().weaponShop.map(l => l.vendorId))).toEqual(new Set(['npc_weapon_vendor']));
    expect(new Set(hub().armorShop.map(l => l.vendorId))).toEqual(new Set(['npc_armor_vendor']));
    expect(new Set(hub().consumableShop.map(l => l.vendorId))).toEqual(new Set(['npc_alchemist']));
  });

  it('buying and reloading does not bring back what was bought, or mint the same id twice', async () => {
    const row = hub().weaponShop.find(l => l.stock >= 2)!;
    const first = hub().purchaseFromShop(row.id, 'weapon')!;
    await hub().saveHubState();
    await hub().loadHub('hub_vendors');
    const again = hub().weaponShop.find(l => l.id === row.id)!;
    expect(again.stock).toBe(row.stock - 1);
    expect(hub().purchaseFromShop(row.id, 'weapon')!.id).not.toBe(first.id);
  });

  it('what the counter buys comes back on the shelf, the same id, and leaves it when bought', async () => {
    const piece = ItemFactory.createItem(UniversalRank.F, true, Rng.fromKey('vendor:piece'), 'weapon');
    usePlayerStore.setState(s => ({ player: { ...s.player, bank: { ...s.player.bank, stashTabs: s.player.bank.stashTabs.map((t, i) => i === 0 ? { ...t, items: [piece] } : t) } } }));
    expect(await hub().sellToVendor(piece.id)).toBeGreaterThan(0);
    expect(stash().some(i => i.id === piece.id)).toBe(false);
    const row = hub().weaponShop.find(l => l.item.id === piece.id)!;
    expect(row.stock).toBe(1);
    expect(row.vendorId).toBe('npc_weapon_vendor');
    const back = hub().purchaseFromShop(row.id, 'weapon')!;
    expect(back.id).toBe(piece.id);
    expect(hub().weaponShop.find(l => l.item.id === piece.id)).toBeUndefined();
    expect(hub().vendors.npc_weapon_vendor.held).toHaveLength(0);
  });

  it('a person is taken once, stands with the master, and survives a reload', async () => {
    const bond = pick(true);
    const person = await lodge(bond);
    expect(await hub().takeApprentice('npc_alchemist', person)).toEqual({ ok: true });
    expect(stash().some(i => i.id === bond.id)).toBe(false);
    expect(hub().craftsmen).toHaveLength(1);
    expect(hub().craftsmen[0].trade).toBe(HUB_NPCS.npc_alchemist.teaches!.trade);
    expect((await hub().takeApprentice('npc_alchemist', person)).ok).toBe(false);
    await hub().loadHub('hub_vendors');
    expect(hub().craftsmen).toHaveLength(1);
  });

  it('a strong person stays where they are, and the vendor says why', async () => {
    const person = await lodge(pick(false));
    const v = await hub().takeApprentice('npc_alchemist', person);
    expect(v.ok).toBe(false);
    expect(v.reason).toBeTruthy();
    expect(hub().guild.residents.some(r => r.id === person)).toBe(true);
    expect(hub().craftsmen).toHaveLength(0);
  });

  it('only a general vendor can be asked', async () => {
    expect((await hub().takeApprentice('npc_banker', await lodge(pick(true)))).ok).toBe(false);
  });

  it('a journeyman the time away made joins the hub\'s web, and adds to the shelf', async () => {
    await hub().takeApprentice('npc_weapon_vendor', await lodge(pick(true)));
    const before = hub().weaponShop.find(l => l.stock >= 1)!;
    const today = Math.floor(Date.now() / 86_400_000);
    useHubStore.setState(s => ({ craftsmen: s.craftsmen.map(c => ({ ...c, day: today - TERM_DAYS * 2, startedDay: today - TERM_DAYS * 2 })) }));
    await hub().resolveVendors();
    expect(hub().craftsmen[0].rank).not.toBe('APPRENTICE');
    expect(Object.keys(hub().web.nodes)).toContain(TagLaw.skillIdOf(['smithing']));
    expect(hub().weaponShop.find(l => l.id === before.id)!.stock).toBeGreaterThan(before.stock);
  });
});

describe('the words reach a person', () => {
  it('each general vendor offers the road, through the one registry', () => {
    expect(HANDLED_ACTIONS).toContain('OPEN_APPRENTICES');
    for (const id of GENERAL) {
      const option = HUB_NPCS[id].dialogue.options.find(o => o.action === 'OPEN_APPRENTICES');
      expect(option, id).toBeDefined();
      expect(option!.payload.npcId).toBe(id);
    }
    expect(DIALOGUE_HANDLERS.OPEN_APPRENTICES).toBeDefined();
  });

  it('the action opens the window for that vendor', () => {
    expect(runDialogueAction('OPEN_APPRENTICES', { npcId: 'npc_alchemist' })).toEqual({ kind: 'open', panel: 'apprentices', npcId: 'npc_alchemist' });
  });

  it('the window reads ranks in words and progress by the stepped bar, never hue alone', () => {
    const window = readFileSync('src/components/ApprenticeWindow.tsx', 'utf8');
    expect(window).toContain('<Bar');
    expect(window).toContain('RANK_WORDS');
    expect(window).toContain('person.name');
  });

  it('the store reads every shelf through the container of its own vendor', () => {
    expect(readFileSync('src/entities/hub/store.ts', 'utf8')).toContain('VendorSystem.shelf(');
  });
});
