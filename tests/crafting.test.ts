/**
 * THE START OF THE CRAFTING LEG. Pedro, 2026-11-01, on what a vendor buys: "bought doesn't
 * mean goes to sale ... they'll sell components for the things that they see don't sell and
 * also craft." On the keepers: "they can teach \"crafting\", completing the three unlocks
 * crafting, not anything named, naming comes from the interaction of components and the
 * discovery of recipes." On masters: "when a new master comes in they'll need their own
 * shop, that's a questline wainting to be made that gives the player a discount at the shop."
 *
 * Registered before the build. No bar calls a model.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const db = new Map<string, any>();
vi.mock('../shared/entities/data/VectorStore', () => ({
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

import { IItem, ItemType, Rarity, UniversalRank } from '../shared/types';
import { IVendorRecipe, IVendorRecord, IWorkTools, VendorSystem } from '../src/logic/systems/VendorSystem';
import { SalvageSystem, vendorRecipes, workTools } from '../src/logic/systems/SalvageSystem';
import { ApprenticeRoad, CRAFT_TAG, ICraftsman, TERM_DAYS, generalKeepers } from '../src/logic/systems/ApprenticeRoad';
import { CompositionSystem } from '../shared/logic/economy/CompositionSystem';
import { WebBank } from '../shared/logic/content/WebBank';
import { WebSystem } from '../shared/logic/systems/WebSystem';
import { TagLaw } from '../shared/logic/content/TagLaw';
import { Rng } from '../shared/logic/rng/DeterministicRNG';
import { ItemFactory } from '../shared/entities/item/ItemFactory';
import { RESOURCE_DEFINITIONS } from '../shared/entities/item/data/resourceDefinitions';
import { CRAFTED_DEFINITIONS, GEAR_RECIPES, RECIPE_DEFINITIONS } from '../shared/entities/economy/data/recipeDefinitions';
import { HUB_NPCS } from '../src/entities/hub/HubGenerator';
import { emptyGuild, residentIdOf } from '../src/entities/hub/guild';
import { useHubStore } from '../src/entities/hub/store';
import { usePlayerStore } from '../src/entities/player/store';
import { readFileSync } from 'node:fs';

const DAY = 20_000;
const piece = (id: string, def = 'def_blade', over: Partial<IItem> = {}): IItem =>
  ({ id, name: def, universalDefinitionId: def, value: 40, isIdentified: true, tags: [], ...over } as IItem);
const vendor = (over: Partial<IVendorRecord> = {}): IVendorRecord => ({ ...VendorSystem.fresh('npc_weapon_vendor', 'GENERAL', DAY), ...over });
const noRecipes: IWorkTools = {
  recipes: [],
  salvage: item => [piece(`${item.id}_part`, 'def_part', { value: 10 })],
  make: () => []
};
const own = (v: IVendorRecord, day = DAY) => VendorSystem.shelf(v, [], day, 0);

describe('bought does not mean goes to sale', () => {
  it('what the counter takes in is not on the shelf that day', () => {
    const v = VendorSystem.receive(vendor(), piece('a'), DAY);
    expect(v.held.map(i => i.id)).toEqual(['a']);
    expect(own(v)).toEqual([]);
  });

  it('a kind that has been selling goes on the shelf, the same piece', () => {
    const sold = VendorSystem.recordSale(vendor(), 'line', DAY, 0.9, 'def_blade');
    const v = VendorSystem.work(VendorSystem.receive(sold, piece('a'), DAY), DAY + 1, 0, noRecipes).record;
    expect(v.held).toEqual([]);
    expect(own(v, DAY + 1).map(l => l.item.id)).toEqual(['a']);
    expect(v.parts).toEqual([]);
  });

  it('a kind that has not been selling is salvaged, and its components are what goes on sale', () => {
    const { record, events } = VendorSystem.work(VendorSystem.receive(vendor(), piece('a'), DAY), DAY + 1, 0, noRecipes);
    expect(record.held).toEqual([]);
    expect(record.listed).toEqual([]);
    expect(record.parts.map(i => i.id)).toEqual(['a_part']);
    expect(own(record, DAY + 1).map(l => l.item.id)).toEqual(['a_part']);
    expect(events.some(e => e.kind === 'SALVAGED' && e.itemId === 'a')).toBe(true);
  });

  it('demand fades: a kind that sold long ago no longer counts', () => {
    const sold = VendorSystem.recordSale(vendor(), 'line', DAY, 0.9, 'def_blade');
    const later = DAY + 100;
    const v = VendorSystem.work(VendorSystem.receive({ ...sold, worked: later - 1 }, piece('a'), later - 1), later, 0, noRecipes).record;
    expect(v.parts).toHaveLength(1);
  });

  it('a piece that went on the shelf and sits there is salvaged in the end', () => {
    const sold = VendorSystem.recordSale(vendor(), 'line', DAY, 0.9, 'def_blade');
    const listed = VendorSystem.work(VendorSystem.receive(sold, piece('a'), DAY), DAY + 1, 0, noRecipes).record;
    expect(listed.listed).toHaveLength(1);
    const later = VendorSystem.work(listed, DAY + 40, 0, noRecipes).record;
    expect(later.listed).toEqual([]);
    expect(later.parts.map(i => i.id)).toEqual(['a_part']);
  });

  it('a piece nobody has read never reaches a shelf by name: the vendor salvages it', () => {
    const sold = VendorSystem.recordSale(vendor(), 'line', DAY, 0.9, 'def_blade');
    const v = VendorSystem.work(VendorSystem.receive(sold, piece('a', 'def_blade', { isIdentified: false, name: 'A Secret' }), DAY), DAY + 1, 0, noRecipes).record;
    expect(JSON.stringify(own(v, DAY + 1))).not.toContain('A Secret');
    expect(v.parts).toHaveLength(1);
  });

  it('a thing that cannot be taken apart stays whole, and is sold whole', () => {
    const v = VendorSystem.work(VendorSystem.receive(vendor(), piece('a'), DAY), DAY + 1, 0, { ...noRecipes, salvage: () => null }).record;
    expect(v.listed.map(i => i.id)).toEqual(['a']);
  });

  it('a small thing can be lost in the taking apart: gone, with nothing to show', () => {
    const { record, events } = VendorSystem.work(VendorSystem.receive(vendor(), piece('a'), DAY), DAY + 1, 0, { ...noRecipes, salvage: () => [] });
    expect(record.held).toEqual([]);
    expect(record.listed).toEqual([]);
    expect(record.parts).toEqual([]);
    expect(events.find(e => e.kind === 'SALVAGED')).toMatchObject({ itemId: 'a', parts: [] });
  });

  it('components of a kind share one row, and buying one leaves the rest', () => {
    const parts = [piece('p1', 'def_part', { value: 10 }), piece('p2', 'def_part', { value: 10 }), piece('p3', 'def_other', { value: 12 })];
    const v = { ...vendor(), parts };
    const rows = own(v);
    expect(rows).toHaveLength(2);
    expect(rows.find(l => l.item.universalDefinitionId === 'def_part')!.stock).toBe(2);
    const after = VendorSystem.takeOwn(v, 'p1');
    expect(after.parts.map(i => i.id)).toEqual(['p2', 'p3']);
    expect(own(after).find(l => l.item.universalDefinitionId === 'def_part')!.stock).toBe(1);
  });

  it('a record saved before all this still reads', () => {
    const old = { npcId: 'npc_weapon_vendor', kind: 'GENERAL', agenda: vendor().agenda, sold: { day: DAY, lines: {} }, held: [piece('a')] } as unknown as IVendorRecord;
    expect(own(VendorSystem.normal(old))).toEqual([]);
    expect(VendorSystem.work(VendorSystem.normal(old), DAY + 1, 0, noRecipes).record.parts).toHaveLength(1);
  });
});

describe('a vendor discovers recipes when components meet, and crafts', () => {
  const plank: IVendorRecipe = { id: 'rec_plank', name: 'A Worked Plank', output: 'out_rec_plank', inputs: [{ itemId: 'def_log', quantity: 2 }] };
  const joint: IVendorRecipe = { id: 'rec_joint', name: 'A Joined Frame', output: 'out_rec_joint', inputs: [{ itemId: 'def_log', quantity: 1 }, { itemId: 'def_nail', quantity: 1 }] };
  const tools = (recipes: IVendorRecipe[]): IWorkTools => ({
    recipes,
    salvage: item => [item],
    make: (recipe, consumed, key) => [piece(`made_${key}`, `out_${recipe.id}`, { value: consumed.length * 20 })]
  });
  const logs = (n: number, from = 0) => Array.from({ length: n }, (_, i) => piece(`log${from + i}`, 'def_log'));

  it('nothing is known before the components have met', () => {
    expect(vendor().known).toEqual([]);
    const { record } = VendorSystem.work({ ...vendor(), parts: [piece('n', 'def_nail')] }, DAY + 1, 0, tools([joint]));
    expect(record.known).toEqual([]);
  });

  it('a recipe is discovered when every component in it has been held, and its name comes with that', () => {
    const { record, events } = VendorSystem.work({ ...vendor(), parts: logs(2) }, DAY + 1, 0, tools([plank]));
    expect(record.known).toEqual(['rec_plank']);
    expect(events.find(e => e.kind === 'DISCOVERED')).toMatchObject({ recipeId: 'rec_plank', name: 'A Worked Plank' });
  });

  it('components that met on different days still meet: the vendor remembers what it has seen', () => {
    const first = VendorSystem.work({ ...vendor(), parts: [piece('n', 'def_nail')] }, DAY + 1, 0, tools([joint])).record;
    const emptied = VendorSystem.takeOwn(first, 'n');
    expect(VendorSystem.work({ ...emptied, parts: logs(1) }, DAY + 2, 0, tools([joint])).record.known).toEqual(['rec_joint']);
  });

  it('a recipe is discovered once', () => {
    const one = VendorSystem.work({ ...vendor(), parts: logs(4) }, DAY + 1, 0, tools([plank]));
    const two = VendorSystem.work(one.record, DAY + 2, 0, tools([plank]));
    expect(one.events.filter(e => e.kind === 'DISCOVERED')).toHaveLength(1);
    expect(two.events.filter(e => e.kind === 'DISCOVERED')).toHaveLength(0);
  });

  it('crafting takes the components once, and what it makes goes on the shelf', () => {
    const { record } = VendorSystem.work({ ...vendor(), parts: logs(3) }, DAY + 1, 0, tools([plank]));
    expect(record.parts).toHaveLength(1);
    expect(record.listed.map(i => i.universalDefinitionId)).toEqual(['out_rec_plank']);
    expect(own(record, DAY + 1).some(l => l.item.universalDefinitionId === 'out_rec_plank')).toBe(true);
  });

  it('it makes one thing a day, and more for each person it raised', () => {
    const alone = VendorSystem.work({ ...vendor(), parts: logs(8) }, DAY + 1, 0, tools([plank])).record;
    const helped = VendorSystem.work({ ...vendor(), parts: logs(8) }, DAY + 1, 2, tools([plank])).record;
    expect(alone.listed).toHaveLength(1);
    expect(helped.listed).toHaveLength(3);
  });

  it('with several it could make, it makes what the shelf has least of', () => {
    const otherPlank: IVendorRecipe = { id: 'rec_board', name: 'A Board', output: 'out_rec_board', inputs: [{ itemId: 'def_log', quantity: 1 }] };
    const stocked = { ...vendor(), known: ['rec_plank', 'rec_board'], seen: ['def_log'], parts: logs(4), listed: [piece('x', 'out_rec_board')], since: { x: DAY + 1 } };
    const { record } = VendorSystem.work(stocked, DAY + 1, 0, tools([plank, otherPlank]));
    expect(record.listed.filter(i => i.universalDefinitionId === 'out_rec_plank')).toHaveLength(1);
  });

  it('being away folds to the same place as every day watched', () => {
    let stepped = { ...vendor(), parts: logs(6) };
    for (let d = 1; d <= 9; d++) stepped = VendorSystem.work(stepped, DAY + d, 0, tools([plank])).record;
    expect(VendorSystem.work({ ...vendor(), parts: logs(6) }, DAY + 9, 0, tools([plank])).record).toEqual(stepped);
  });

  it('the same day of work gives the same result', () => {
    const run = () => VendorSystem.work({ ...vendor(), parts: logs(4) }, DAY + 2, 0, tools([plank]));
    expect(run()).toEqual(run());
  });
});

describe('salvage: the real thing', () => {
  const rawDef = () => Object.values(RESOURCE_DEFINITIONS).find(r => r.tags?.includes('building'))!;
  const rolled = () => ItemFactory.createItem(UniversalRank.D, true, Rng.fromKey('salvage:rolled'), 'weapon');

  it('a raw material is already a component: the same piece comes back', () => {
    const log = ItemFactory.createResourceItem(rawDef(), Rng.fromKey('salvage:raw'));
    expect(SalvageSystem.components(log, 'k')).toEqual([log]);
  });

  it('a thing with a chain gives back some of what its chain says, marked as salvage and bitten', () => {
    const def = rawDef();
    const log = ItemFactory.createResourceItem(def, Rng.fromKey('salvage:raw'));
    const composition = CompositionSystem.compose({ recipeId: 'r', name: 'R', laborSeconds: 10, facility: null }, [log.composition!, log.composition!], 1);
    const made = { ...piece('made', 'def_made'), composition };
    const parts = SalvageSystem.components(made, 'k')!;
    expect(parts.length).toBeGreaterThan(0);
    expect(parts.length).toBeLessThanOrEqual(2);
    for (const part of parts) {
      expect(part.universalDefinitionId).toBe(def.id);
      expect(part.composition!.materials[0].origin).toBe('SALVAGE');
      expect(part.quality).toBeLessThan(0);
    }
  });

  it('a thing rolled with no chain still comes apart, into things the world holds, worth less than it was', () => {
    const blade = rolled();
    const parts = SalvageSystem.components(blade, 'k')!;
    expect(parts.length).toBeGreaterThan(0);
    for (const part of parts) expect(RESOURCE_DEFINITIONS[part.universalDefinitionId]).toBeDefined();
    expect(parts.reduce((sum, p) => sum + p.value, 0)).toBeLessThan(blade.value);
  });

  it('half a log is never a whole one: across many pieces, less comes back than went in', () => {
    const def = rawDef();
    const log = ItemFactory.createResourceItem(def, Rng.fromKey('salvage:raw'));
    const composition = CompositionSystem.compose({ recipeId: 'r', name: 'R', laborSeconds: 10, facility: null }, [log.composition!], 2);
    expect(composition.materials[0].count).toBe(0.5);
    const back = Array.from({ length: 400 }, (_, i) => SalvageSystem.components({ ...piece(`plank${i}`, 'def_plank'), composition }, 'k')!).flat();
    expect(back.length).toBeLessThan(200);
    expect(back.length).toBeGreaterThan(0);
  });

  it('making and salvaging in a circle can only shrink, however long nobody buys', () => {
    const recipe = vendorRecipes().find(r => RECIPE_DEFINITIONS[r.id]
      && r.inputs.length === 1 && RESOURCE_DEFINITIONS[r.inputs[0].itemId]
      && RECIPE_DEFINITIONS[r.id].outputs.reduce((n, o) => n + o.quantity, 0) > 1)!;
    expect(recipe).toBeDefined();
    const def = RESOURCE_DEFINITIONS[recipe.inputs[0].itemId];
    const start = recipe.inputs[0].quantity * 20;
    const parts = Array.from({ length: start }, (_, i) => ItemFactory.createResourceItem(def, Rng.fromKey(`circle:${i}`)));
    const atoms = (v: IVendorRecord) => v.parts.filter(p => p.universalDefinitionId === def.id).length
      + v.listed.reduce((sum, item) => sum + (item.composition?.materials.find(m => m.defId === def.id)?.count ?? 0), 0);
    let v: IVendorRecord = { ...VendorSystem.fresh('npc_weapon_vendor', 'GENERAL', DAY), parts };
    for (let d = 30; d <= 300; d += 30) {
      v = VendorSystem.work(v, DAY + d, 0, { ...workTools(), recipes: [recipe] }).record;
      expect(atoms(v), `day ${d}`).toBeLessThanOrEqual(start);
    }
    expect(atoms(v)).toBeLessThan(start);
  });

  it('the same piece always comes apart the same way', () => {
    // A mint stamps the moment it happened, and that is the only thing that may differ
    const read = () => SalvageSystem.components(rolled(), 'k')!.map(p => [p.id, p.universalDefinitionId, p.quality, p.value]);
    expect(read()).toEqual(read());
  });

  it('no two components share an id', () => {
    const parts = SalvageSystem.components(rolled(), 'k')!;
    expect(new Set(parts.map(p => p.id)).size).toBe(parts.length);
  });

  it('a recipe the game knows can be worked by a vendor, with its chain and its price', () => {
    const recipes = vendorRecipes();
    expect(recipes.length).toBeGreaterThan(0);
    expect(recipes.map(r => r.id)).toEqual([...new Set([...Object.keys(RECIPE_DEFINITIONS), ...Object.keys(GEAR_RECIPES)])].sort());
    const recipe = recipes.find(r => RECIPE_DEFINITIONS[r.id] && CRAFTED_DEFINITIONS[RECIPE_DEFINITIONS[r.id].outputs[0].itemId])!;
    const consumed = recipe.inputs.flatMap(input => Array.from({ length: input.quantity }, (_, i) => {
      const def = RESOURCE_DEFINITIONS[input.itemId] ?? CRAFTED_DEFINITIONS[input.itemId];
      return ItemFactory.createResourceItem(def as any, Rng.fromKey(`input:${input.itemId}:${i}`));
    }));
    const made = workTools().make(recipe, consumed, 'k');
    expect(made.length).toBeGreaterThan(0);
    expect(made[0].composition!.depth).toBeGreaterThan(0);
    expect(made[0].value).toBe(CompositionSystem.priceOf(made[0].composition!));
    // The same key makes the same thing. When it was dropped is the clock's, and two calls can fall a millisecond apart
    const made2 = workTools().make(recipe, consumed, 'k');
    const sansDate = (items: typeof made) => items.map(({ history, ...rest }) => rest);
    expect(sansDate(made2)).toEqual(sansDate(made));
  });
});

describe('the keepers teach crafting, and the three together unlock it', () => {
  const pack = () => WebBank.current();
  const bondOf = (id: string): IItem => ({
    id: `bond_${id}`, name: id, type: ItemType.LORE, value: 1, tags: [],
    bondData: { worldSeed: 'seed_craft', entityId: id, webVersion: pack().version, rank: UniversalRank.F, rarity: Rarity.COMMON, sheet: { name: id, temperament: 'PASSIVE', objective: 'SURVIVE', want: 'GOLD', disposition: 70, attempts: 0 } }
  } as unknown as IItem);
  const fit = () => Array.from({ length: 400 }, (_, i) => bondOf(`p${i}`)).find(b => ApprenticeRoad.unfit(b, pack()).ok)!;
  const keepers = generalKeepers();
  const begun = (): ICraftsman => ApprenticeRoad.begin(fit(), { id: keepers[0], room: 2, taken: 0 }, 's', 'Sponsor', DAY, pack()).craftsman!;

  it('there are three keepers, read from who teaches, not listed here', () => {
    expect(keepers).toEqual(Object.values(HUB_NPCS).filter(n => n.teaches).map(n => n.id));
    expect(keepers).toHaveLength(3);
  });

  it('no keeper names a trade', () => {
    for (const id of keepers) expect(JSON.stringify(HUB_NPCS[id].teaches)).not.toMatch(/smithing|weaving|alchemy|trade/);
  });

  it('what they teach is one word on the web, read aloud as crafting', () => {
    expect(WebBank.hasKind(pack(), CRAFT_TAG, ['trade'])).toBe(true);
    const id = TagLaw.skillIdOf([CRAFT_TAG]);
    expect(WebSystem.isLawfulId(id)).toBe(true);
    expect(WebSystem.nameOf(id).toLowerCase()).toBe('crafting');
    expect(begun().skill.id).toBe(id);
  });

  it('finishing one term moves them to the next keeper, still an apprentice', () => {
    const { craftsman, events } = ApprenticeRoad.resolve({ ...begun(), intModifier: 0 }, DAY + TERM_DAYS + 1, () => 1, keepers);
    expect(craftsman.rank).toBe('APPRENTICE');
    expect(craftsman.done).toEqual([keepers[0]]);
    expect(craftsman.masterId).toBe(keepers[1]);
    expect(events[0]).toMatchObject({ to: 'APPRENTICE', movedTo: keepers[1] });
  });

  it('someone saved before the three benches still reads', () => {
    const old = { ...begun() } as Partial<ICraftsman>;
    delete old.done;
    expect(ApprenticeRoad.normal(old as ICraftsman).done).toEqual([]);
  });

  it('crafting comes only with the third, and it is the same person throughout', () => {
    const two = ApprenticeRoad.resolve({ ...begun(), intModifier: 0 }, DAY + TERM_DAYS * 2 + 1, () => 1, keepers).craftsman;
    expect(two.rank).toBe('APPRENTICE');
    expect(ApprenticeRoad.canCraft(two)).toBe(false);
    const three = ApprenticeRoad.resolve({ ...begun(), intModifier: 0 }, DAY + TERM_DAYS * 3 + 3, () => 1, keepers).craftsman;
    expect(three.rank).toBe('JOURNEYMAN');
    expect(three.done).toEqual(keepers);
    expect(ApprenticeRoad.canCraft(three)).toBe(true);
  });

  it('starting at another keeper works the same, none of them twice', () => {
    const c = ApprenticeRoad.begin(fit(), { id: keepers[2], room: 2, taken: 0 }, 's', 'Sponsor', DAY, pack()).craftsman!;
    const done = ApprenticeRoad.resolve({ ...c, intModifier: 0 }, DAY + TERM_DAYS * 3 + 3, () => 1, keepers).craftsman;
    expect(new Set(done.done).size).toBe(3);
    expect(done.done[0]).toBe(keepers[2]);
  });

  it('the hours at each bench are that keeper\'s own', () => {
    const seen = new Set<string>();
    ApprenticeRoad.resolve({ ...begun(), intModifier: 0 }, DAY + TERM_DAYS * 3 + 3, master => { seen.add(master); return 1; }, keepers);
    expect([...seen]).toEqual(keepers);
  });
});

describe('the city\'s doors', () => {
  const hub = () => useHubStore.getState();
  const player = () => usePlayerStore.getState().player;
  const today = () => Math.floor(Date.now() / 86_400_000);
  const giveStash = (items: IItem[]) => usePlayerStore.setState(s => ({ player: { ...s.player, bank: { ...s.player.bank, stashTabs: s.player.bank.stashTabs.map((t, i) => i === 0 ? { ...t, items } : t) } } }));
  const bondOf = (id: string): IItem => ({
    id: `bond_${id}`, name: `Escort Bond: ${id}`, type: ItemType.LORE, value: 1, tags: [],
    bondData: { worldSeed: 'seed_door', entityId: id, webVersion: WebBank.current().version, rank: UniversalRank.F, rarity: Rarity.COMMON, sheet: { name: id, temperament: 'PASSIVE', objective: 'SURVIVE', want: 'GOLD', disposition: 70, attempts: 0 } }
  } as unknown as IItem);
  const fit = () => Array.from({ length: 400 }, (_, i) => bondOf(`p${i}`)).find(b => ApprenticeRoad.unfit(b, WebBank.current()).ok)!;

  /** A person the road has brought to master, by moving their days back. */
  const raiseOne = async () => {
    const bond = fit();
    giveStash([bond]);
    expect((await hub().redeemBond(bond.id)).ok).toBe(true);
    const resident = hub().guild.residents[0];
    expect((await hub().takeApprentice('npc_alchemist', resident.id)).ok).toBe(true);
    useHubStore.setState(s => ({ craftsmen: s.craftsmen.map(c => ({ ...c, day: today() - 400, startedDay: today() - 400, agenda: { ...c.agenda, day: today() - 400 } })) }));
    await hub().resolveVendors();
    return { resident, craftsman: hub().craftsmen[0] };
  };

  beforeEach(async () => {
    db.clear();
    usePlayerStore.setState(s => ({ player: { ...s.player, bank: { ...s.player.bank, gold: 100_000 } } }));
    giveStash([]);
    useHubStore.setState({ vendors: {}, craftsmen: [], guild: emptyGuild() });
    await hub().loadHub('hub_craft');
  });

  it('selling to the counter puts nothing on the shelf that day', async () => {
    const blade = ItemFactory.createItem(UniversalRank.F, true, Rng.fromKey('door:blade'), 'weapon');
    giveStash([blade]);
    expect(await hub().sellToVendor(blade.id)).toBeGreaterThan(0);
    expect(hub().vendors.npc_weapon_vendor.held.map(i => i.id)).toEqual([blade.id]);
    expect(hub().weaponShop.some(l => l.item.id === blade.id)).toBe(false);
  });

  it('the next day its components are on the shelf, and buying one takes one', async () => {
    const blade = ItemFactory.createItem(UniversalRank.F, true, Rng.fromKey('door:blade2'), 'weapon');
    giveStash([blade]);
    await hub().sellToVendor(blade.id);
    useHubStore.setState(s => ({ vendors: { ...s.vendors, npc_weapon_vendor: { ...s.vendors.npc_weapon_vendor, worked: today() - 1, since: { [blade.id]: today() - 1 } } } }));
    await hub().resolveVendors();
    const record = hub().vendors.npc_weapon_vendor;
    expect(record.held).toEqual([]);
    expect(record.parts.length + record.listed.length).toBeGreaterThan(0);
    const row = hub().weaponShop.find(l => l.held)!;
    const before = row.stock;
    const bought = hub().purchaseFromShop(row.id, 'weapon')!;
    expect(bought.id).toBe(row.item.id);
    expect(player().bank.stashTabs[0].items.some(i => i.id === bought.id)).toBe(true);
    const after = hub().weaponShop.find(l => l.id === row.id);
    expect(after ? after.stock : 0).toBe(before - 1);
  });

  it('every keeper has a counter of its own, and what it buys is its own', async () => {
    for (const id of generalKeepers()) expect(HUB_NPCS[id].dialogue.options.find(o => o.action === 'OPEN_SELL')?.payload.npcId, id).toBe(id);
    const blade = ItemFactory.createItem(UniversalRank.F, true, Rng.fromKey('door:io'), 'weapon');
    giveStash([blade]);
    await hub().sellToVendor(blade.id, 'npc_alchemist');
    expect(hub().vendors.npc_alchemist.held.map(i => i.id)).toEqual([blade.id]);
    expect(hub().vendors.npc_weapon_vendor.held).toEqual([]);
  });

  it('what sold is what a vendor comes to want', () => {
    const row = hub().weaponShop.find(l => l.stock >= 1)!;
    hub().purchaseFromShop(row.id, 'weapon');
    expect(hub().vendors.npc_weapon_vendor.demand[row.item.universalDefinitionId]).toBe(today());
  });

  it('crafting joins the hub\'s web only when the three are done', async () => {
    const bond = fit();
    giveStash([bond]);
    await hub().redeemBond(bond.id);
    await hub().takeApprentice('npc_alchemist', hub().guild.residents[0].id);
    const id = TagLaw.skillIdOf([CRAFT_TAG]);
    useHubStore.setState(s => ({ craftsmen: s.craftsmen.map(c => ({ ...c, day: today() - TERM_DAYS - 1 })) }));
    await hub().resolveVendors();
    expect(hub().craftsmen[0].rank).toBe('APPRENTICE');
    expect(Object.keys(hub().web.nodes)).not.toContain(id);
    useHubStore.setState(s => ({ craftsmen: s.craftsmen.map(c => ({ ...c, day: today() - TERM_DAYS * 4 })) }));
    await hub().resolveVendors();
    expect(hub().craftsmen[0].rank).not.toBe('APPRENTICE');
    expect(Object.keys(hub().web.nodes)).toContain(id);
  });

  it('someone a party brought out, with no person behind them, walks the same road', async () => {
    const bond = fit();
    giveStash([bond]);
    await hub().redeemBond(bond.id);
    useHubStore.setState(s => ({ guild: { ...s.guild, residents: s.guild.residents.map(r => ({ ...r, sponsorId: 'npc_party', sponsorName: 'A raiding party' })) } }));
    expect((await hub().takeApprentice('npc_armor_vendor', hub().guild.residents[0].id)).ok).toBe(true);
    expect(hub().craftsmen[0].sponsorId).toBe('npc_party');
  });

  it('a new master comes back through the tavern, needing ground', async () => {
    const { resident, craftsman } = await raiseOne();
    expect(craftsman.rank).toBe('MASTER');
    const back = hub().guild.residents.find(r => r.id === resident.id)!;
    expect(back.craftsmanId).toBe(craftsman.id);
    expect(back.lotId).toBeNull();
    expect(back.id).toBe(residentIdOf(craftsman.bond));
  });

  it('a master is not offered to a bench again', async () => {
    const { resident } = await raiseOne();
    const v = await hub().takeApprentice('npc_weapon_vendor', resident.id);
    expect(v.ok).toBe(false);
    expect(hub().craftsmen).toHaveLength(1);
    expect(readFileSync('src/components/ApprenticeWindow.tsx', 'utf8')).toContain('!r.craftsmanId');
  });

  it('a master only comes back once', async () => {
    await raiseOne();
    await hub().resolveVendors();
    expect(hub().guild.residents).toHaveLength(1);
  });

  /** The chain's last step, standing in for the ground and the pooled bill B4's bars already hold. */
  const openShop = async (residentId: string) => {
    useHubStore.setState(s => ({ guild: { ...s.guild, residents: s.guild.residents.map(r => r.id === residentId ? { ...r, lotId: 'lot_test', house: { pool: {}, raised: true, templateName: 'Keeper\'s Cottage' } } : r) } }));
    await hub().settleHomes();
  };

  it('once they are home they have a shop of their own, and remember who saw it through', async () => {
    const { resident, craftsman } = await raiseOne();
    expect(hub().vendors[craftsman.id]).toBeUndefined();
    await openShop(resident.id);
    const shop = hub().vendors[craftsman.id];
    expect(shop.kind).toBe('TRADER');
    expect(shop.patrons).toEqual([player().id]);
  });

  it('whoever saw it through pays less there, and nobody else does', () => {
    const v: IVendorRecord = { ...VendorSystem.fresh('crf', 'TRADER', DAY), patrons: ['me'], listed: [piece('a', 'def_a', { value: 100 })] };
    const asPatron = VendorSystem.shelf(v, [], DAY, 0, 'me')[0].price;
    const asStranger = VendorSystem.shelf(v, [], DAY, 0, 'someone')[0].price;
    expect(asPatron).toBeLessThan(asStranger);
    expect(VendorSystem.shelf(v, [], DAY, 0)[0].price).toBe(asStranger);
  });

  it('the shop stands on what a keeper took apart, whichever has most, and sells through the one gold door', async () => {
    const { resident, craftsman } = await raiseOne();
    await openShop(resident.id);
    const part = ItemFactory.createResourceItem(Object.values(RESOURCE_DEFINITIONS).find(r => r.tags?.includes('building'))!, Rng.fromKey('door:part'));
    useHubStore.setState(s => ({ vendors: {
      ...s.vendors,
      npc_weapon_vendor: { ...s.vendors.npc_weapon_vendor, parts: [part, { ...part, id: 'part2' }] },
      [craftsman.id]: { ...s.vendors[craftsman.id], worked: today() - 1 }
    } }));
    await hub().resolveVendors();
    const shelf = hub().traderShelf(craftsman.id);
    expect(shelf.length).toBeGreaterThan(0);
    const gold = player().bank.gold;
    const row = shelf[0];
    const bought = await hub().buyFromTrader(craftsman.id, row.id);
    expect(bought).not.toBeNull();
    expect(player().bank.gold).toBeLessThan(gold);
    expect(hub().vendors[craftsman.id].parts.length + hub().vendors[craftsman.id].listed.length).toBe(row.stock - 1 + shelf.slice(1).reduce((s, l) => s + l.stock, 0));
  });

  it('all of it survives a reload', async () => {
    const { resident, craftsman } = await raiseOne();
    await openShop(resident.id);
    await hub().saveHubState();
    await hub().loadHub('hub_craft');
    expect(hub().craftsmen[0].id).toBe(craftsman.id);
    expect(hub().vendors[craftsman.id].patrons).toEqual([player().id]);
    expect(hub().guild.residents.find(r => r.id === resident.id)?.craftsmanId).toBe(craftsman.id);
  });
});
