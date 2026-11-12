/**
 * BUILDINGS IN THE HUB'S TECH (D91, D119; lines 136, 154).
 *
 * Pedro, 2026-11-01. On tall: "tall means cornucopia machine here, or, you need to spread the
 * workstations around". On wide: "more NPCs, stabler economy, it's pop count". On the web: "the
 * person's skill is added to the hub silently, the players cannot know, they need to make the
 * web reach it". On cost: "an npc will never accrue the cost if the pieces already exist".
 * On professions: "the professions come from the shared pool the theme carries". And: "the
 * model writes the NPC, the web is resolved backwards".
 */
import { describe, expect, it } from 'vitest';
import { IItem } from '../shared/types';
import { ChainWeb, IChainGround, IChainRound, IChainStanding, IChainWeb, emptyChain } from '../shared/logic/theme/ChainWeb';
import { IThemeBody, IThemeProfession, THEME_SCHEMA } from '../shared/logic/theme/ThemeTypes';
import { bodyOf, themeIdOf } from '../shared/logic/theme/ThemeCompiler';
import { Profession } from '../src/logic/systems/Profession';
import { WebSystem } from '../shared/logic/systems/WebSystem';
import { WebBank } from '../shared/logic/content/WebBank';
import { TagLaw } from '../shared/logic/content/TagLaw';
import { buildChainRequest, CHAIN_PARTS, CHAIN_SCHEMA } from '../shared/intelligence/prompts';
import { MODEL_FOR } from '../shared/intelligence/claude';
import {
  IHubTech, admitSilently, areaFor, billFor, emptyTech, foldReach, groundOf, hubPopulation, hubStations, nextLink, normalTech,
  roomAreaOf, routeFor, sizeVerdict, standingOf, wantedStation, workingStations
} from '../src/entities/hub/hubTech';

const good = (key: string, rank: any, station: string, from: string[], answers = ''): IChainRound['goods'][number] => ({
  key, name: key, blurb: 'x', tags: [], rank, weight: 'light', trade: 'smithing', station, from: from.map(k => ({ key: k, count: 1 })), makes: 1, answers, look: { color: 'ash', shape: 'lump', size: 'small' }
});
const station = (key: string, tool = ['hammer'], material = ['metal'], bill = [{ tag: 'metal', count: 2 }]): IChainRound['stations'][number] => ({ key, name: key, blurb: 'x', tool, material, bill });
const material = (key: string): IChainRound['materials'][number] => ({ key, name: key, blurb: 'x', tags: ['ore'], rank: 'F', form: 'vein', verb: 'mine', weight: 'light', worth: 'common', habitat: ['RUINS'], onShelf: false, restores: 'none', look: { color: 'ash', shape: 'lump', size: 'small' } });
const round = (over: Partial<IChainRound>): IChainRound => ({ tags: [], materials: [], stations: [], goods: [], gear: [], ...over });

const TRIBE: IChainGround = {
  things: [{ key: 'flint', name: 'Flint', tags: ['stone'], rank: 'F' }, { key: 'palm', name: 'Palm', tags: ['wood'], rank: 'F' }],
  stations: [{ key: 'fire_pit', name: 'Fire Pit', tool: ['tongs'], material: ['fire'] }],
  tools: ['hammer', 'tongs']
};
const registered = () => true;
const standing = (...stations: string[]): IChainStanding => ({ stations: new Set(['fire_pit', ...stations]), bench: true });

/** flint -> shard (E, at fire_pit) -> blade (D, at forge) -> engine (C, at works) */
const LADDER: IChainWeb = {
  ...emptyChain(),
  stations: [station('forge'), station('works', ['hammer'], ['metal'], [{ tag: 'metal', count: 3 }, { tag: 'glass', count: 1 }])],
  goods: [good('shard', 'E', 'fire_pit', ['flint']), good('blade', 'D', 'forge', ['shard']), good('engine', 'C', 'works', ['blade'], 'flight')]
};

const PROFESSION: IThemeProfession = {
  key: 'mcgyver', name: 'Scavenger Engineer', blurb: 'x', rank: 'C', concept: 'repair', knows: 'how to keep things running', workshop: 'a flooded garage',
  tool: ['hammer'], material: ['metal']
};

describe('the theme carries the professions', () => {
  const body = (professions?: IThemeProfession[]) => ({ professions } as unknown as IThemeBody);

  it('the schema asks a model for them, so a new theme has them', () => {
    expect((THEME_SCHEMA.properties as any).professions.items.required).toEqual(expect.arrayContaining(['concept', 'knows', 'workshop', 'tool', 'material', 'rank']));
  });

  it('a pack from before there was such a thing keeps its id', () => {
    const pack = { name: 'a', premise: 'b', regions: [], tags: [], creatures: [], materials: [], stations: [], goods: [], gear: [], consumables: [], affixes: [], abilities: [], lore: [] } as IThemeBody;
    expect(bodyOf(pack)).not.toHaveProperty('professions');
    expect(themeIdOf(pack)).not.toBe(themeIdOf({ ...pack, professions: [PROFESSION] }));
  });

  it('the same person is dealt the same profession on every read', () => {
    const pool = [PROFESSION, { ...PROFESSION, key: 'b', rank: 'F' as const }, { ...PROFESSION, key: 'c', rank: 'F' as const }];
    const a = Profession.dealt(pool, 'seed', 'e1', 'D');
    for (let i = 0; i < 5; i++) expect(Profession.dealt(pool, 'seed', 'e1', 'D')).toEqual(a);
    expect(new Set(Array.from({ length: 40 }, (_, i) => Profession.dealt(pool, 'seed', `e${i}`, 'S')!.key)).size).toBeGreaterThan(1);
  });

  it('nobody holds a profession above their rank while one at their rank exists', () => {
    const pool = [{ ...PROFESSION, key: 'high', rank: 'SSS' as const }, { ...PROFESSION, key: 'low', rank: 'F' as const }];
    for (let i = 0; i < 40; i++) expect(Profession.dealt(pool, 'seed', `e${i}`, 'F')!.key).toBe('low');
  });

  it('with no pool, their own hands say what they are, and that asks no model', () => {
    const pack = WebBank.current();
    const held = WebBank.connections(pack).map(c => c.skillId).find(id => WebSystem.benchesOf(TagLaw.parseSkillId(id)!, pack).length > 0)!;
    const skill = WebSystem.freshSkill(held, TagLaw.parseSkillId(held)!, 2);
    const p = Profession.fromHands({ [held]: skill }, 'D', pack)!;
    expect(p.from).toBe('HANDS');
    expect(p.stationId).toBe(WebSystem.benchesOf(skill.tags, pack)[0]);
    expect(p.workshop).toContain(pack.stations.find(s => s.id === p.stationId)!.name);
    expect(Profession.fromHands({}, 'D', pack)).toBeNull();
  });
});

describe('the door writes a chain, and the law judges it', () => {
  it('it goes through the one door, on Haiku', () => {
    const request = buildChainRequest({ person: { name: 'x' }, ground: {}, written: {}, open: [] });
    expect(request.kind).toBe('chain');
    // Q1: the whole round's grammar is refused as too large, so it is asked in parts that each compile
    expect(CHAIN_PARTS.map(part => part.schema)).toContain(request.schema);
    expect(Object.keys(CHAIN_SCHEMA.properties as object).every(k => CHAIN_PARTS.some(part => k in (part.schema.properties as object)))).toBe(true);
    expect(MODEL_FOR.chain).toContain('haiku');
    expect(request.system).toContain('concept');
  });

  it('a refused answer goes back with why', () => {
    expect(buildChainRequest({ person: {}, ground: {}, written: {}, open: [], refused: 'It leapt.' }).messages[0].content).toContain('It leapt.');
  });

  it('no digits from the model: the formula writes the numbers', () => {
    const v = ChainWeb.judge(round({ goods: [{ ...good('a', 'E', 'fire_pit', ['flint']), hp: 40 } as any] }), emptyChain(), TRIBE, [], registered);
    expect(v.ok).toBe(false);
    expect(v.reason).toContain('number');
  });

  it('a word nobody registered is refused', () => {
    const v = ChainWeb.judge(round({ stations: [station('s', ['nonsense'])] }), emptyChain(), TRIBE, [], tag => tag !== 'nonsense');
    expect(v.reason).toContain('nonsense');
  });

  // CT1: the live trial, 2026-11-12. A singer's round was refused three times running, each time for one more word
  // nobody had registered, because the refusal named only the first it met and the next answer mended only that one.
  it('a refusal for words nobody registered names every one of them at once, and what carries each', () => {
    const strange = ['hollow', 'piercing', 'woven', 'ringing'];
    const r = round({
      materials: [{ ...material('gourd'), tags: ['hollow', 'ore'] }],
      stations: [station('s', ['piercing'])],
      goods: [{ ...good('a', 'E', 'fire_pit', ['flint']), tags: ['woven', 'hollow'] }],
      gear: [{ key: 'drum', name: 'drum', blurb: 'x', tags: ['ringing'], works: [], rank: 'F', kind: 'tool', craftAt: 'none', from: [], look: { color: 'ash', shape: 'lump', size: 'small' } } as any]
    });
    const v = ChainWeb.judge(r, emptyChain(), TRIBE, [], tag => !strange.includes(tag));
    expect(v.ok).toBe(false);
    for (const word of strange) expect(v.reason).toContain(`"${word}"`);
    // each word once, with the things that carry it
    expect(v.reason!.split('"hollow"').length).toBe(2);
    expect(v.reason).toMatch(/"hollow" \(gourd, a\)/);
    expect(v.reason).toContain('not registered');
  });

  it('a round whose every word is registered is not refused for its words', () => {
    const r = round({ materials: [{ ...material('gourd'), tags: ['ore'] }] });
    expect(ChainWeb.judge(r, emptyChain(), TRIBE, [], registered).ok).toBe(true);
  });

  it('a key already on the ground is not written again', () => {
    expect(ChainWeb.judge(round({ materials: [material('flint')] }), emptyChain(), TRIBE, [], registered).ok).toBe(false);
  });

  it('nothing asks for what stands above it, so a chain always ends', () => {
    const v = ChainWeb.judge(round({ goods: [good('a', 'E', 'fire_pit', ['b']), good('b', 'D', 'fire_pit', ['flint'])] }), emptyChain(), TRIBE, [], registered);
    expect(v.ok).toBe(false);
  });

  it('no step leaps a rank: flying vehicles need the whole chain', () => {
    const v = ChainWeb.judge(round({ goods: [good('rocket', 'S', 'fire_pit', ['flint'])] }), emptyChain(), TRIBE, [], registered);
    expect(v.ok).toBe(false);
    expect(v.reason).toContain('leaps');
  });

  it('what is still to be written may be asked for, and left open for the next round', () => {
    const r = round({ goods: [good('rocket', 'S', 'fire_pit', ['thruster'], 'flight')] });
    expect(ChainWeb.judge(r, emptyChain(), TRIBE, [], registered).ok).toBe(true);
    const open = ChainWeb.open('flight', 'S', ChainWeb.merge(emptyChain(), r), TRIBE);
    expect(open.map(n => `${n.kind}:${n.key}`)).toEqual(['thing:thruster']);
  });

  it('a thing made from itself is refused', () => {
    const v = ChainWeb.judge(round({ goods: [good('a', 'E', 'fire_pit', ['b']), good('b', 'E', 'fire_pit', ['a'])] }), emptyChain(), TRIBE, [], registered);
    expect(v.reason).toContain('itself');
  });

  it('a round that answers nothing asked is refused', () => {
    const open = ChainWeb.open('flight', 'S', emptyChain(), TRIBE);
    const v = ChainWeb.judge(round({ goods: [good('other', 'E', 'fire_pit', ['flint'])] }), emptyChain(), TRIBE, open, registered);
    expect(v.reason).toContain('answers nothing');
  });

  it('it walks back through stations and tools it leans on', () => {
    const r = round({ stations: [station('forge', ['saw'])], goods: [good('blade', 'E', 'forge', ['flint'], 'flight')] });
    const open = ChainWeb.open('flight', 'E', ChainWeb.merge(emptyChain(), r), TRIBE);
    expect(open.map(n => `${n.kind}:${n.key}`)).toEqual(['tool:saw']);
  });

  it('a chain that lands on the ground has nothing open', () => {
    expect(ChainWeb.open('flight', 'C', LADDER, TRIBE)).toEqual([]);
  });

  it('a second person with the same concept brings their own way, and what stands is not rewritten', () => {
    const first = ChainWeb.merge(emptyChain(), round({ goods: [good('spit_plant', 'D', 'fire_pit', ['flint'], 'fireball')] }), 'shaman');
    expect(ChainWeb.open('fireball', 'D', first, TRIBE, 'shaman')).toEqual([]);
    expect(ChainWeb.open('fireball', 'B', first, TRIBE, 'smith').map(n => n.key)).toEqual(['fireball']);
    const second = ChainWeb.merge(first, round({ goods: [good('tube', 'E', 'fire_pit', ['flint'], 'fireball')] }), 'smith');
    expect(ChainWeb.open('fireball', 'B', second, TRIBE, 'smith')).toEqual([]);
    expect(ChainWeb.measure(second).ways.fireball).toBe(2);
  });

  it('it counts its nodes and edges', () => {
    const m = ChainWeb.measure(LADDER);
    expect(m.nodes).toBe(5);
    expect(m.edges).toBe(3 + 3 + 1 + 2);
  });
});

describe('the web is reached, and it is an AND-OR web', () => {
  it('a step needs its station standing and all it asks for', () => {
    expect(ChainWeb.reached(LADDER, TRIBE, standing()).things.has('shard')).toBe(true);
    expect(ChainWeb.reached(LADDER, TRIBE, standing()).things.has('blade')).toBe(false);
    expect(ChainWeb.reached(LADDER, TRIBE, standing('forge')).things.has('blade')).toBe(true);
    expect(ChainWeb.reached(LADDER, TRIBE, standing('works')).things.has('engine')).toBe(false);
    expect(ChainWeb.reached(LADDER, TRIBE, standing('forge', 'works')).things.has('flight')).toBe(true);
  });

  it('any one way reaches a concept: a fireball is a plant or a bazooka', () => {
    const chain = ChainWeb.merge(emptyChain(), round({
      stations: [station('glasshouse'), station('tube_shop')],
      goods: [good('spit_plant', 'E', 'glasshouse', ['palm'], 'fireball'), good('bazooka', 'E', 'tube_shop', ['flint'], 'fireball')]
    }));
    expect(ChainWeb.reached(chain, TRIBE, standing()).things.has('fireball')).toBe(false);
    expect(ChainWeb.reached(chain, TRIBE, standing('glasshouse')).things.has('fireball')).toBe(true);
    expect(ChainWeb.reached(chain, TRIBE, standing('tube_shop')).things.has('fireball')).toBe(true);
  });

  it('a station that leans on a tool nothing makes does not work', () => {
    const chain = ChainWeb.merge(emptyChain(), round({ stations: [station('s', ['laser'])], goods: [good('a', 'E', 's', ['flint'], 'c')] }));
    expect(ChainWeb.reached(chain, TRIBE, standing('s')).things.has('c')).toBe(false);
  });

  it('what must be found counts as met: it has been added to the world', () => {
    const chain = ChainWeb.merge(emptyChain(), round({ materials: [material('skyglass')], goods: [good('a', 'E', 'fire_pit', ['skyglass'], 'c')] }));
    expect(ChainWeb.reached(chain, TRIBE, standing()).things.has('c')).toBe(true);
  });
});

describe('tall or wide, and never paying for what stands', () => {
  it('the route is the stations still to raise', () => {
    expect(ChainWeb.route('flight', LADDER, TRIBE, standing()).stations.sort()).toEqual(['forge', 'works']);
  });

  it('an npc never accrues the cost of a piece that already stands', () => {
    expect(ChainWeb.route('flight', LADDER, TRIBE, standing('forge')).stations).toEqual(['works']);
    expect(ChainWeb.route('flight', LADDER, TRIBE, standing('forge', 'works')).stations).toEqual([]);
  });

  it('the cheapest way is the one a route takes, and ties read the same everywhere', () => {
    const chain = ChainWeb.merge(emptyChain(), round({
      stations: [station('a1'), station('a2'), station('b1')],
      goods: [good('x', 'E', 'a1', ['flint']), good('way_a', 'E', 'a2', ['x'], 'c'), good('way_b', 'E', 'b1', ['flint'], 'c')]
    }));
    expect(ChainWeb.route('c', chain, TRIBE, standing()).stations).toEqual(['b1']);
    expect(ChainWeb.route('c', chain, TRIBE, standing('a1', 'a2')).stations).toEqual([]);
  });

  it('a machine folds what is missing, and its bill is the sum of those and no more', () => {
    const tech: IHubTech = { ...emptyTech(), chain: LADDER };
    const all = billFor(['forge', 'works'], tech);
    const less = billFor(['works'], tech);
    const metal = (b: { tag: string; count: number }[]) => b.find(l => l.tag === 'metal')!.count;
    expect(metal(all)).toBe(metal(less) + 2);
    expect(all.find(l => l.tag === 'building')).toBeTruthy();
  });

  it('a building asks a minimum size, with the numbers, and a machine asks more than one station', () => {
    const tech: IHubTech = { ...emptyTech(), chain: LADDER };
    expect(areaFor(['forge', 'works'], tech)).toBeGreaterThan(areaFor(['works'], tech));
    expect(roomAreaOf({ width: 3, height: 3 })).toBe(70);
    expect(sizeVerdict(['forge'], { width: 3, height: 3 }, tech).ok).toBe(true);
    const crowded = Array.from({ length: 9 }, (_, i) => `s${i}`);
    const wide: IHubTech = { ...tech, chain: { ...LADDER, stations: crowded.map(k => station(k)) } };
    const small = sizeVerdict(crowded, { width: 3, height: 3 }, wide);
    expect(small.ok).toBe(false);
    expect(small.reason).toContain('70');
    expect(sizeVerdict(crowded, { width: 6, height: 5 }, wide).ok).toBe(true);
  });

  it('the hub\'s own stations all ask a minimum, whether a batch or a chain wrote them', () => {
    const tech: IHubTech = { ...emptyTech(), chain: LADDER };
    for (const s of hubStations(tech)) expect(s.minArea).toBeGreaterThan(0);
  });

  it('wide holds more people than tall for the same reach: it is pop count', () => {
    const residents = [{ homeAt: 1, lotId: 'a' }, { homeAt: 1, lotId: 'b' }, { lotId: null }];
    const shop = (residentId: string, mode: 'MACHINE' | 'WORKSTATION', stations: string[]) => ({ id: residentId, residentId, lotId: 'x', mode, stations, name: 'n', bill: [], pool: {}, standsAt: 1 });
    const tall = hubPopulation({ residents, craftsmen: [] }, { workshops: [shop('a', 'MACHINE', ['forge', 'works'])] });
    const wide = hubPopulation({ residents, craftsmen: [{}] }, { workshops: [shop('a', 'WORKSTATION', ['forge']), shop('b', 'WORKSTATION', ['works'])] });
    expect(tall.machines).toBe(1);
    expect(tall.working).toBe(1);
    expect(wide.working).toBe(2);
    expect(wide.people).toBe(4);
    expect(tall.stationsStanding).toBe(wide.stationsStanding);
  });
});

describe('silent until the web reaches it', () => {
  const pack = () => WebBank.current();
  const anvilSkill = () => {
    const id = WebBank.connections(pack()).map(c => c.skillId).find(x => WebSystem.benchesOf(TagLaw.parseSkillId(x)!, pack()).length > 0)!;
    return WebSystem.freshSkill(id, TagLaw.parseSkillId(id)!, 1);
  };
  const noSkills = {};

  it('a person\'s skill goes in unseen: nothing opens, and the visible web has not moved', () => {
    const skill = anvilSkill();
    const web = admitSilently({ nodes: {} }, { uid: 'r1', name: 'Ann' }, { [skill.id]: skill }, 1);
    expect(web.nodes).toEqual({});
    expect(web.silent![skill.id].by.name).toBe('Ann');
    expect(WebSystem.openStationsOf(web, noSkills).length).toBe(0);
  });

  it('admitting a player keeps what is hidden', () => {
    const skill = anvilSkill();
    const web = admitSilently({ nodes: {} }, { uid: 'r1', name: 'Ann' }, { [skill.id]: skill }, 1);
    expect(WebSystem.admit(web, { uid: 'p', name: 'P' }, {}, 2).web.silent![skill.id]).toBeTruthy();
  });

  it('it comes out when its station works, and the first to hold it keeps the claim', () => {
    const skill = anvilSkill();
    const web = admitSilently({ nodes: {} }, { uid: 'r1', name: 'Ann' }, { [skill.id]: skill }, 1);
    const stationId = WebSystem.benchesOf(skill.tags, pack())[0];
    const ground = groundOf(pack());
    const before = foldReach(web, emptyTech(), ground, { stations: new Set(), bench: false }, 2);
    expect(before.events).toEqual([]);
    expect(before.web.silent![skill.id]).toBeTruthy();
    const recipeInputsReady = { stations: new Set(pack().stations.map(s => s.id)), bench: true };
    const after = foldReach(web, emptyTech(), ground, recipeInputsReady, 2);
    expect(after.events.map(e => e.skillId)).toEqual([skill.id]);
    expect(after.web.nodes[skill.id].firstBy.name).toBe('Ann');
    expect(after.web.silent![skill.id]).toBeUndefined();
    expect(WebSystem.openStationsOf(after.web, noSkills).some(s => s.id === stationId)).toBe(true);
  });

  it('a skill that opens nothing comes with its holder\'s workshop', () => {
    const tags = ['wood'];
    const id = TagLaw.skillIdOf(tags);
    const skill = WebSystem.freshSkill(id, tags, 0);
    const web = admitSilently({ nodes: {} }, { uid: 'r1', name: 'Ann' }, { [id]: skill }, 1);
    const ground = groundOf(pack());
    expect(foldReach(web, emptyTech(), ground, { stations: new Set(), bench: false }, 2).events).toEqual([]);
    const tech: IHubTech = { ...emptyTech(), workshops: [{ id: 'w', residentId: 'r1', lotId: 'l', mode: 'WORKSTATION', stations: [], name: 'n', bill: [], pool: {}, standsAt: 1 }] };
    expect(foldReach(web, tech, ground, { stations: new Set(), bench: true }, 2).events.map(e => e.skillId)).toEqual([id]);
  });

  it('a chain station joins the web when it works, and only then', () => {
    const tech: IHubTech = { ...emptyTech(), chain: LADDER, workshops: [
      { id: 'w', residentId: 'r1', lotId: 'l', mode: 'WORKSTATION', stations: ['works'], name: 'Ann', bill: [], pool: {}, standsAt: 1 }
    ] };
    const idle = foldReach({ nodes: {} }, tech, TRIBE, standing('works'), 2, { ...pack(), stations: [] });
    expect(idle.tech.reached).toEqual([]);
    const running = foldReach({ nodes: {} }, tech, TRIBE, standing('works', 'forge'), 2, { ...pack(), stations: [] });
    expect(running.tech.reached).toEqual(expect.arrayContaining(['works']));
  });

  it('a stations\'s after-buildings have to stand: the seam a later building hangs on', () => {
    const base = { ...pack(), stations: [{ id: 'stn_rancher', name: 'Rancher', connection: { tool: ['hammer'], material: ['metal'] }, bill: [], minArea: 10, weight: 1, width: 1, height: 1, after: ['stn_plot'] }] };
    const noPlot = workingStations(emptyTech(), { ...TRIBE, stations: [{ key: 'stn_rancher', name: 'Rancher', tool: ['hammer'], material: ['metal'] }] }, { stations: new Set(['stn_rancher']), bench: true }, base);
    expect(noPlot.has('stn_rancher')).toBe(false);
    const plot = workingStations(emptyTech(), { ...TRIBE, stations: [{ key: 'stn_rancher', name: 'Rancher', tool: ['hammer'], material: ['metal'] }, { key: 'stn_plot', name: 'Plot', tool: ['hammer'], material: ['metal'] }] }, { stations: new Set(['stn_rancher', 'stn_plot']), bench: true }, base);
    expect(plot.has('stn_rancher')).toBe(true);
  });

  it('a save from before all this reads as nothing raised', () => {
    expect(normalTech()).toEqual(emptyTech());
    expect(normalTech({ reached: ['x'] }).reached).toEqual(['x']);
  });
});

describe('what stands, and what a person is told', () => {
  it('a station in any room counts, and so does what a person was given', () => {
    const item = (id: string) => ({ universalDefinitionId: id } as IItem);
    const s = standingOf(
      { lots: [{ id: 'a', structureType: 'EMPTY' }], rooms: { a: { placements: [{ id: 'p', item: item('stn_anvil'), x: 0, y: 0, rotated: false, placedBy: '', at: 0 }] } } },
      { workshops: [{ id: 'w', residentId: 'r', lotId: 'b', mode: 'MACHINE', stations: ['stn_loom', 'stn_still'], name: 'n', bill: [], pool: {}, standsAt: 1 }] }
    );
    expect([...s.stations].sort()).toEqual(['stn_anvil', 'stn_loom', 'stn_still']);
    expect(s.bench).toBe(true);
  });

  it('what is only rising does not stand', () => {
    const s = standingOf({ lots: [], rooms: {} }, { workshops: [{ id: 'w', residentId: 'r', lotId: 'b', mode: 'MACHINE', stations: ['stn_loom'], name: 'n', bill: [], pool: {} }] });
    expect(s.stations.size).toBe(0);
    expect(s.bench).toBe(false);
  });

  it('they want the station at the end of their road, and a talk can change it', () => {
    const profession = { ...PROFESSION, from: 'THEME' as const, concept: 'flight', stationId: 'stn_anvil' };
    const tech = { chain: LADDER };
    expect(wantedStation(profession, tech, 'r1')).toBe('works');
    expect(wantedStation(profession, tech, 'r1', { stationId: 'forge', words: 'I need a forge first.', by: 'TALK' })).toBe('forge');
    expect(wantedStation({ ...profession, concept: 'unwritten' }, tech, 'r1')).toBe('stn_anvil');
  });

  it('a player reads the next link only, never the road', () => {
    const profession = { ...PROFESSION, from: 'THEME' as const, concept: 'flight' };
    const pack = { ...WebBank.current(), stations: [] };
    const next = nextLink(profession, { chain: LADDER }, TRIBE, standing('works'), pack);
    expect(next?.id).toBe('forge');
    expect(nextLink(profession, { chain: LADDER }, TRIBE, standing('works', 'forge'), pack)).toBeNull();
  });

  it('their road is their own way, not the cheapest anyone has written to the same concept', () => {
    const chain = ChainWeb.merge(ChainWeb.merge(emptyChain(), round({ stations: [station('cheap')], goods: [good('quick', 'E', 'cheap', ['flint'], 'flight')] }), 'first'),
      round({ stations: [station('dear')], goods: [good('slow', 'E', 'dear', ['flint'], 'flight')] }), 'second');
    const profession = { ...PROFESSION, from: 'THEME' as const, concept: 'flight' };
    const seen = standing('cheap');
    expect(routeFor(profession, { chain }, TRIBE, seen, 'second').stations).toEqual(['dear']);
    expect(routeFor(profession, { chain }, TRIBE, seen).stations).toEqual([]);
  });

  it('with a chain unwritten, the road is what the web already knows', () => {
    const pack = WebBank.current();
    const ground = groundOf(pack);
    const held = pack.recipes[0];
    const profession = { ...PROFESSION, from: 'HANDS' as const, stationId: held.requiredStation };
    const route = routeFor(profession, emptyTech(), ground, { stations: new Set(), bench: true });
    expect(route.stations).toContain(held.requiredStation);
  });
});

