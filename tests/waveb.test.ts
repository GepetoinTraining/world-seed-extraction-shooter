/**
 * WHERE THE STREAMS MEET (fan-out Wave B). Each stream's bars passed on its own branch.
 * These hold what only exists once they stand together.
 *
 * No bar here calls a model.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';

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

import { ContentRegistry } from '../src/logic/theme/ContentRegistry';
import { creatureIdOf, compileTheme, junkIdsFor } from '../src/logic/theme/ThemeCompiler';
import { ILineWords, IThemeBody } from '../src/logic/theme/ThemeTypes';
import { FIRST_THEME } from '../src/entities/generation/packs/firstTheme';
import { ThemeLaw } from '../src/logic/theme/ThemeLaw';
import { FIRST_THEME_PACK, installShippedThemes } from '../src/logic/theme/boot';
import { CreatureLines, ILineRecord } from '../src/logic/theme/CreatureLines';
import { WorldGrowth, IThemeGrowth } from '../src/logic/theme/WorldGrowth';
import { Director, emptyDirectorRecord, IDirectorRecord } from '../src/entities/world/Director';
import { IPopulationRecord, ISectorState, Population, emptyPopulationRecord } from '../src/entities/world/Population';
import { SECTOR_CHUNKS } from '../src/entities/world/grid';
import { RESOURCE_DEFINITIONS } from '../src/entities/item/data/resourceDefinitions';
import { useHubStore } from '../src/entities/hub/store';
import { usePlayerStore } from '../src/entities/player/store';
import { emptyGuild, wantMayTake } from '../src/entities/hub/guild';
import { WorldDeed } from '../src/logic/systems/WorldDeed';
import { SalvageSystem } from '../src/logic/systems/SalvageSystem';
import { VendorSystem } from '../src/logic/systems/VendorSystem';
import { ApprenticeRoad } from '../src/logic/systems/ApprenticeRoad';
import { WebBank } from '../src/logic/content/WebBank';

const registered = (tag: string) => WebBank.current().tags.some(t => t.tag === tag);
import { EffectSystem } from '../src/logic/systems/EffectSystem';
import { IItem, ItemType, Rarity, UniversalRank } from '../types';

installShippedThemes();
const themeId = FIRST_THEME_PACK.themeId;
const pack = FIRST_THEME_PACK;
const SEED = 'where-they-meet';
const WORLD = { seed: SEED, themeId };
const HOUND = creatureIdOf(themeId, 'dun_hound');
const SX = 8, SY = 8;
const GROUND = `${SX * SECTOR_CHUNKS + 3},${SY * SECTOR_CHUNKS + 3}`;
const contextOf = (director?: IDirectorRecord) => ContentRegistry.contextFor(themeId, UniversalRank.D, director);
const onGround = (state: ISectorState, kind: string) => Object.values(state.ground).reduce((sum, on) => sum + (on[kind] ?? 0), 0);

/** A world where the hound's line has changed, standing on plain words. */
const plainWorld = async () => {
  let director: IDirectorRecord = emptyDirectorRecord();
  for (let i = 0; i < 200 && !director.lines?.pending.some(o => o.parents.includes(HOUND)); i++) {
    director = await CreatureLines.regenerate(Director.catchUp(Director.report(director, 'FELLED_A_PERSON', HOUND), director.generation + 1), WORLD);
  }
  const stood = await CreatureLines.standPlain(director, WORLD);
  const order = stood.lines!.pending.find(o => o.parents.includes(HOUND))!;
  const plain = Object.values(stood.lines!.nodes).find(n => n.plain === order.id)!;
  await CreatureLines.define(stood, themeId);
  return { stood, order, plain };
};
const wordsFor: ILineWords = { name: 'Arrears Hound', blurb: 'It waits at the door now.', tags: [], features: ['horns'], innate: [] };

describe('B1 and B2: a changed kind on plain words, in a world that counts its bodies', () => {
  it('a body stands as the plain kind, by the count', async () => {
    const { stood, plain } = await plainWorld();
    const state: ISectorState = { generation: stood.generation, ground: { [GROUND]: { [HOUND]: 200 } }, leaders: {} };
    const next = Population.step(SEED, SX, SY, state, { down: {}, seen: {} }, contextOf(stood));
    expect(onGround(next, plain.id)).toBeGreaterThan(0);
  });

  it('when the words come, the bodies counted under the plain name stand under them, none lost', async () => {
    const { stood, order, plain } = await plainWorld();
    const record: IPopulationRecord = {
      ...emptyPopulationRecord(),
      sectors: { [`${SX},${SY}`]: { generation: stood.generation, ground: { [GROUND]: { [plain.id]: 7, [HOUND]: 3 } }, leaders: {} } }
    };
    const out = await CreatureLines.install(stood, order.id, wordsFor, WORLD);
    expect(out.ok).toBe(true);
    await CreatureLines.define(out.record, themeId);
    const state = Population.sectorAt(record, SEED, SX, SY, stood.generation, contextOf(out.record));
    expect(onGround(state, plain.id)).toBe(0);
    expect(onGround(state, out.id!)).toBe(7);
    expect(onGround(state, HOUND)).toBe(3);
  });

  it('one who fell under the plain name is still one fewer once the words have come', async () => {
    const { stood, order, plain } = await plainWorld();
    const out = await CreatureLines.install(stood, order.id, wordsFor, WORLD);
    await CreatureLines.define(out.record, themeId);
    const g = stood.generation;
    const down = { body: { at: g, kind: plain.id, sector: `${SX},${SY}`, ground: GROUND } };
    const state: ISectorState = { generation: g, ground: { [GROUND]: { [out.id!]: 1 } }, leaders: {} };
    const next = Population.step(SEED, SX, SY, state, { down, seen: {} }, contextOf(out.record));
    expect(onGround(next, out.id!)).toBe(0);
  });

  it('a kind stands only from the cycle it was born in, so a sector read late folds as one read early', async () => {
    const { stood, plain } = await plainWorld();
    const early: ISectorState = { generation: plain.bornAt - 3, ground: { [GROUND]: { [HOUND]: 200 } }, leaders: {} };
    const next = Population.step(SEED, SX, SY, early, { down: {}, seen: {} }, contextOf(stood));
    expect(onGround(next, plain.id)).toBe(0);
  });

  it('the fights of a closed world land with the body a leader fell to (D69 over D93)', () => {
    const store = readFileSync('src/entities/world/store.ts', 'utf8');
    expect(store).toContain('reports.push({ kind, definitionId, body: named })');
    expect(store.match(/Director\.report\(at, r\.kind, r\.definitionId, r\.body\)/g)).toHaveLength(2);
  });

  it('an adopted record keeps the world\'s pinned web, and the land lays what it knows', () => {
    const store = readFileSync('src/entities/world/store.ts', 'utf8');
    expect(store).toMatch(/adoptRecord[\s\S]{0,500}webVersion: generationContext\.webVersion/);
    expect(store).toContain('generationContext ?? context');
  });
});

describe('B1 and B2: what a world grows, in a world where everything leaves junk', () => {
  const eliteOf = () => pack.creatures.find(c => c.leads)!;
  const growth = (over: Partial<IThemeGrowth> = {}): IThemeGrowth => {
    const elder = pack.creatures.find(c => c.key === 'dun_hound')!;
    return {
      creatures: [
        { ...elder, key: 'late_hound', name: 'Late Hound' },
        { ...eliteOf(), key: 'late_elite', name: 'Late Comptroller', leads: 'dun_hound' }
      ],
      materials: [], affixes: [], abilities: [], tags: [], lore: [],
      ...over
    };
  };
  const lines = (g: IThemeGrowth): ILineRecord => ({ ...CreatureLines.empty(), grown: [{ scope: 'theme_zgrown', order: 'growth_1', bornAt: 1, growth: g }] });

  it('a grown creature leaves the pinned pack\'s junk, and no second copy of it is made', () => {
    const [compiled] = WorldGrowth.compile(pack, lines(growth()));
    const mob = compiled.mobs[creatureIdOf('theme_zgrown', 'late_hound')];
    const tags = pack.creatures.find(c => c.key === 'dun_hound')!.tags;
    expect(mob.junk).toEqual(junkIdsFor(pack, tags));
    expect(mob.junk!.length).toBeGreaterThan(0);
    for (const id of mob.junk!) expect(RESOURCE_DEFINITIONS[id], id).toBeDefined();
    expect(Object.values(compiled.resources).filter(r => (r as { junk?: boolean }).junk)).toHaveLength(0);
  });

  it('a grown elite leads the pack\'s own kind, under that kind\'s id, and draws from it', () => {
    const [compiled] = WorldGrowth.compile(pack, lines(growth()));
    const mob = compiled.mobs[creatureIdOf('theme_zgrown', 'late_elite')] as unknown as { leads: string; line: { root: string; features: string[] } };
    expect(mob.leads).toBe(HOUND);
    expect(mob.line.root).toBe(HOUND);
    expect(mob.line.features.length).toBeGreaterThan(0);
  });

  it('a model writing growth hears what leaves junk, and the law holds it to that', () => {
    const summary = WorldGrowth.summary(pack);
    expect(summary.junk.length).toBe(pack.junk!.length);
    expect(summary.junk[0].from.length).toBeGreaterThan(0);
    expect(readFileSync('server/intelligence/prompts.ts', 'utf8')).toMatch(/A new creature wears at least one tag from a "from"/);
    const bare = { ...pack.creatures[0], key: 'bare', name: 'Bare', tags: ['nothing_leaves_this'] };
    const verdict = ThemeLaw.validate(WorldGrowth.grownBody(FIRST_THEME as IThemeBody, growth({ creatures: [bare] })), registered);
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toMatch(/junk|registered/);
  });
});

describe('B5 and B2: the forced exit stands in the first theme', () => {
  it('a writ is on the alchemist\'s shelf at the band\'s price, and the pack can teach it to nobody', () => {
    const writ = pack.consumables.find(c => c.key === 'writ_of_breach')!;
    expect(writ.onShelf).toBe(true);
    expect(pack.consumables[pack.consumables.length - 1].key).toBe('writ_of_breach');
    const ability = pack.abilities.find(a => a.key === writ.casts)!;
    expect(ability.effect).toBe('forced_exit');
    expect(pack.creatures.some(c => c.innate.includes(ability.key))).toBe(false);
    expect(EffectSystem.exitRefusal).toBeDefined();
    const compiled = compileTheme(pack);
    const def = Object.values(compiled.resources).find(r => r.name === 'Writ of Breach')! as unknown as { value: number; worth?: number };
    expect(def.worth ?? def.value).toBeGreaterThan(5);
  });

  it('the law passes the first theme with all of it standing together', () => {
    expect(ThemeLaw.validate(FIRST_THEME as IThemeBody, registered)).toEqual({ ok: true });
  });

  it('a kit stays rank F, so nobody starts life holding a way out', () => {
    const creation = readFileSync('src/logic/systems/CreationSystem.ts', 'utf8');
    expect(creation).toMatch(/rankF = \(b: ItemDefinition\) => b\.rank === UniversalRank\.F/);
  });
});

describe('B3, A3 and the salvage: a paper of record stays whole', () => {
  it('a world deed, a land deed, a map, a plan or a bond is never taken apart', () => {
    const deed = WorldDeed.free('someone');
    const papers: IItem[] = [
      deed,
      { ...deed, worldDeedData: undefined, deedData: {} as never },
      { ...deed, worldDeedData: undefined, mapData: {} as never },
      { ...deed, worldDeedData: undefined, bondData: {} as never },
      { ...deed, worldDeedData: undefined, tags: ['template', 'document'] }
    ];
    for (const paper of papers) expect(SalvageSystem.components(paper, 'k')).toBeNull();
  });

  it('a deed sold over a counter is still a deed on the shelf after the keeper looks it over', () => {
    const deed = WorldDeed.free('someone');
    const tools = { recipes: [], salvage: SalvageSystem.components, make: () => [] };
    const held = VendorSystem.receive(VendorSystem.fresh('npc_weapon_vendor', 'GENERAL', 100), deed, 100);
    const after = VendorSystem.work(held, 102, 0, tools).record;
    expect(after.listed.map(i => i.id)).toEqual([deed.id]);
    expect(after.parts).toHaveLength(0);
  });

  it('what two hubs make on one day shares no id, because what went into it differs', () => {
    const plank = (id: string) => ({ id, universalDefinitionId: 'in', isIdentified: true, value: 1 } as unknown as IItem);
    const keys: string[] = [];
    const tools = {
      recipes: [{ id: 'r', name: 'R', output: 'out', inputs: [{ itemId: 'in', quantity: 1 }] }],
      salvage: () => null,
      make: (_r: unknown, _c: unknown, key: string) => { keys.push(key); return [plank(key)]; }
    };
    for (const part of ['a', 'b']) {
      const start = { ...VendorSystem.fresh('npc_alchemist', 'GENERAL', 100), parts: [plank(part)], seen: ['in'], known: ['r'] };
      VendorSystem.work(start, 101, 0, tools);
    }
    expect(new Set(keys).size).toBe(2);
  });
});

describe('B4 and the vendors: everyone comes through the tavern', () => {
  const hub = () => useHubStore.getState();
  const stash = () => usePlayerStore.getState().player.bank.stashTabs[0].items;
  const bondOf = (id: string): IItem => ({
    id: `bond_${id}`, name: `Escort Bond: ${id}`, type: ItemType.RESOURCE, value: 1, tags: [],
    bondData: { worldSeed: 'seed_road', entityId: id, webVersion: WebBank.current().version, rank: UniversalRank.F, rarity: Rarity.COMMON, sheet: { name: id, temperament: 'PASSIVE', objective: 'SURVIVE', want: 'GOLD', disposition: 70, attempts: 0 } }
  } as unknown as IItem);
  const pick = (fit: boolean) => Array.from({ length: 400 }, (_, i) => bondOf(`p${i}`)).find(b => ApprenticeRoad.unfit(b, WebBank.current()).ok === fit)!;
  const hold = (...items: IItem[]) => usePlayerStore.setState(s => ({ player: { ...s.player, bank: { ...s.player.bank, stashTabs: s.player.bank.stashTabs.map((t, i) => i === 0 ? { ...t, items } : t) } } }));

  beforeEach(async () => {
    db.clear();
    useHubStore.setState({ vendors: {}, craftsmen: [], guild: emptyGuild() });
    hold();
    await hub().loadHub('hub_meet');
  });

  it('the bench takes someone lodged at the tavern, and they leave its list', async () => {
    const bond = pick(true);
    hold(bond);
    await hub().redeemBond(bond.id);
    const person = hub().guild.residents[0];
    expect(await hub().takeApprentice('npc_alchemist', person.id)).toEqual({ ok: true });
    expect(hub().guild.residents).toHaveLength(0);
    expect(hub().craftsmen).toHaveLength(1);
    expect(hub().craftsmen[0].bond.entityId).toBe(bond.bondData!.entityId);
  });

  it('a bond in hand is nobody the bench can see: the tavern comes first', async () => {
    const bond = pick(true);
    hold(bond);
    expect((await hub().takeApprentice('npc_alchemist', bond.id)).ok).toBe(false);
    expect(stash().some(i => i.id === bond.id)).toBe(true);
    expect(hub().craftsmen).toHaveLength(0);
  });

  it('someone with ground of their own is not the bench\'s to take', async () => {
    const bond = pick(true);
    hold(bond);
    await hub().redeemBond(bond.id);
    const person = hub().guild.residents[0];
    useHubStore.setState(s => ({ guild: { ...s.guild, residents: s.guild.residents.map(r => ({ ...r, lotId: 'lot_x' })) } }));
    expect((await hub().takeApprentice('npc_alchemist', person.id)).ok).toBe(false);
    expect(hub().guild.residents).toHaveLength(1);
  });

  it('a person at the bench cannot come through the tavern a second time', async () => {
    const bond = pick(true);
    hold(bond);
    await hub().redeemBond(bond.id);
    await hub().takeApprentice('npc_alchemist', hub().guild.residents[0].id);
    const again = { ...bondOf(bond.bondData!.entityId), id: 'bond_again' };
    hold(again);
    expect((await hub().redeemBond(again.id)).ok).toBe(false);
    expect(hub().guild.residents).toHaveLength(0);
    expect(stash().some(i => i.id === again.id)).toBe(true);
  });

  it('a strong person stays at the tavern, and the guild can still house them', async () => {
    const bond = pick(false);
    hold(bond);
    await hub().redeemBond(bond.id);
    const v = await hub().takeApprentice('npc_alchemist', hub().guild.residents[0].id);
    expect(v.ok).toBe(false);
    expect(hub().guild.residents).toHaveLength(1);
    expect(hub().craftsmen).toHaveLength(0);
  });

  it('a want for documents takes no world deed, land deed, map or plan, however cheap it reads', async () => {
    const quest = { id: 'q', residentId: 'r', n: 0, tag: 'document', count: 1, payShare: 1, text: '', state: 'OPEN' as const, postedDay: 0 };
    useHubStore.setState({ guild: { ...emptyGuild(), residents: [{ id: 'r', name: 'R', lotId: 'lot_x', wantsMet: 0 } as never], quests: [quest] } });
    const deed = WorldDeed.free('someone');
    const papers: IItem[] = [deed, { ...deed, id: 'a_map', worldDeedData: undefined, mapData: {} as never }, { ...deed, id: 'a_lot', worldDeedData: undefined, deedData: {} as never }];
    for (const paper of papers) {
      hold(paper);
      const v = await hub().fulfilQuest('q', [paper.id]);
      expect(v.ok, paper.id).toBe(false);
      expect(stash().some(i => i.id === paper.id)).toBe(true);
    }
    expect(wantMayTake({ ...deed, worldDeedData: undefined })).toBe(true);
    expect(readFileSync('src/components/GuildHall.tsx', 'utf8')).toContain('wantMayTake(i)');
  });

  it('the window reads the tavern, and asks for a second press', () => {
    const window = readFileSync('src/components/ApprenticeWindow.tsx', 'utf8');
    expect(window).toContain('guild.residents.filter(r => !r.lotId && !r.craftsmanId)');
    expect(window).toContain('ArmedButton');
    expect(window).not.toContain('stashTabs');
  });
});
