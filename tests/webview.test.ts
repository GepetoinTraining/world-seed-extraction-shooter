/**
 * THE VIEW OF THE TECH WEB (the design pass, part 1). Registered before the build.
 *
 * Pedro, 2026-11-11: "The specialize in lore would be better if we designed the (design as in the view) of the tech web,
 * what's unlocking what, where do things sit, so people could minimally plan their lore."
 *
 * What these bars hold, each read from a ruling or made by plain sense and marked in the ledger (W1):
 *  - the web is drawn as what unlocks what: a thing is worked by a skill, a skill opens a station, a station makes a thing;
 *    where a thing sits is how far it stands from the ground (its column);
 *  - what this character knows is drawn by name; what the hub has reached is drawn by the hub's name (D27: the web is the
 *    hub's); what neither knows is drawn only one step out from what is known, as unknown, and never named;
 *  - a skill the hub holds silently is never told (D125);
 *  - a thing the character knows says what a sitting on it would ask (`studyAsk`, with the tree's share taken off); a skill
 *    not held says what learning it would ask in lore (`learnPrice`), beside the lore held by category and in general;
 *  - the view only reads, and holds a web of any size by moving and folding, never by a limit on what it draws.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { IHubWeb, IPlayer, ISkillState } from '../shared/types';
import { WebSystem } from '../shared/logic/systems/WebSystem';
import { WebBank } from '../shared/logic/content/WebBank';
import { TagLaw } from '../shared/logic/content/TagLaw';
import { RESOURCE_DEFINITIONS } from '../shared/entities/item/data/resourceDefinitions';
import { StudySystem } from '../src/logic/systems/StudySystem';
import { LoreSystem } from '../src/logic/systems/LoreSystem';
import { WebMap, IMapNode } from '../src/logic/systems/WebMap';

const SRC = (p: string) => readFileSync(p, 'utf8');

const known = (tool: string[] | null, worked: string[], xp = 0): ISkillState => {
  const pair = WebSystem.mint(tool, worked);
  return WebSystem.withCumulativeXp(WebSystem.freshSkill(pair.id, pair.tags, 0), xp);
};

/** Someone at the attribute floor, holding these skills and knowing these materials by name. */
const person = (skills: ISkillState[], materials: string[] = [], extra: Partial<IPlayer> = {}): IPlayer => ({
  id: 'p_web', attributes: undefined, equipment: undefined, currentSession: undefined, skillProgress: {},
  materialMastery: Object.fromEntries(materials.map(id => [id, { resourceId: id, knowledgeLevel: 1, discoveredAffixes: [] }])),
  bank: { universalSkills: Object.fromEntries(skills.map(s => [s.id, s])), stashTabs: [], loreHeld: 0 },
  ...extra
} as unknown as IPlayer);

const pack = () => WebBank.current();
const EMPTY: IHubWeb = { nodes: {} };
const node = (map: { nodes: IMapNode[] }, id: string) => map.nodes.find(n => n.id === id);

const AXE_ON_LOG = known(['axe'], ['flora', 'wood'], 0);
const newcomer = person([AXE_ON_LOG], ['res_tree_log']);
/** Holds every skill the web can mint, and knows every material it works. */
const master = () => person(
  WebBank.connections(pack()).map(c => WebSystem.withCumulativeXp(WebSystem.freshSkill(c.skillId, TagLaw.parseSkillId(c.skillId)!, 0), 4000)),
  WebBank.workableMaterials(pack()).map(m => m.id)
);

describe('the web is drawn as what unlocks what, and where each thing sits', () => {
  it('a thing is worked by a skill, the skill opens a station, the station makes a thing', () => {
    const map = WebMap.of(newcomer, { web: EMPTY });
    const log = `thing:res_tree_log`;
    const skill = `skill:${AXE_ON_LOG.id}`;
    expect(map.edges).toContainEqual({ from: log, to: skill, why: 'works' });
    expect(map.edges).toContainEqual({ from: skill, to: 'station:stn_sawpit', why: 'opens' });
    expect(map.edges).toContainEqual({ from: 'station:stn_sawpit', to: 'thing:crf_fine_board', why: 'makes' });
  });

  it('where it sits is how far from the ground: the station stands past the skill, the skill past the thing', () => {
    const map = WebMap.of(newcomer, { web: EMPTY });
    const depth = (id: string) => node(map, id)!.depth;
    expect(depth(`skill:${AXE_ON_LOG.id}`)).toBeGreaterThan(depth('thing:res_tree_log'));
    expect(depth('station:stn_sawpit')).toBeGreaterThan(depth(`skill:${AXE_ON_LOG.id}`));
    expect(depth('thing:crf_fine_board')).toBeGreaterThan(depth('station:stn_sawpit'));
  });
});

describe('a character who knows little sees what they know, and one step past it as unknown', () => {
  const map = WebMap.of(newcomer, { web: EMPTY });

  it('what they know is drawn by name', () => {
    expect(node(map, 'thing:res_tree_log')).toMatchObject({ state: 'yours', name: RESOURCE_DEFINITIONS.res_tree_log.name });
    expect(node(map, `skill:${AXE_ON_LOG.id}`)).toMatchObject({ state: 'yours' });
    expect(node(map, `skill:${AXE_ON_LOG.id}`)!.name).toBeTruthy();
    // The axe on wood opens the sawpit: their own hands open it
    expect(node(map, 'station:stn_sawpit')).toMatchObject({ state: 'yours' });
  });

  it('a step past what they know is drawn as unknown, and never named', () => {
    const saw = node(map, `skill:${WebSystem.mint(['saw'], ['flora', 'wood']).id}`);
    const board = node(map, 'thing:crf_fine_board');
    for (const n of [saw, board]) {
      expect(n).toBeDefined();
      expect(n!.state).toBe('unknown');
      expect(n!.name).toBeUndefined();
    }
  });

  it('nothing further than one step from what they know is drawn at all', () => {
    // Stone: no skill of theirs and no material they know touches it
    const stone = map.nodes.filter(n => n.id === 'station:stn_masons_yard' || n.id.includes('stone'));
    expect(stone).toEqual([]);
    for (const n of map.nodes.filter(m => m.state === 'unknown')) {
      const touches = map.edges.some(e => (e.from === n.id || e.to === n.id) && map.nodes.some(m => m.state !== 'unknown' && (m.id === e.from || m.id === e.to)));
      expect(touches, n.id).toBe(true);
    }
  });
});

describe('a character who knows much sees much, by name', () => {
  it('every skill they hold and every material they know is drawn and named', () => {
    const who = master();
    const map = WebMap.of(who, { web: EMPTY });
    for (const id of Object.keys(who.bank.universalSkills)) expect(node(map, `skill:${id}`)?.name, id).toBeTruthy();
    for (const id of Object.keys(who.materialMastery)) expect(node(map, `thing:${id}`)?.state, id).toBe('yours');
    expect(map.nodes.filter(n => n.state === 'yours').length).toBeGreaterThan(WebMap.of(newcomer, { web: EMPTY }).nodes.filter(n => n.state === 'yours').length);
  });
});

describe('the hub\'s web: reached is told, silent never is (D27, D125)', () => {
  const stoneSkill = WebBank.connections(pack()).find(c => c.skillId.includes('stone') && c.tool === 'pickaxe')!.skillId;
  const oreSkill = WebBank.connections(pack()).find(c => c.skillId.includes('ore'))!.skillId;
  const credit = { uid: 'u_first', name: 'First', at: 1 };
  const web: IHubWeb = {
    nodes: { [stoneSkill]: { id: stoneSkill, tags: TagLaw.parseSkillId(stoneSkill)!, rank: 0, firstBy: credit, rungRecord: { ...credit, rung: 0 }, name: 'Quarrying' } },
    silent: { [oreSkill]: { id: oreSkill, tags: TagLaw.parseSkillId(oreSkill)!, rank: 0, by: credit, rung: 0 } }
  };
  const map = WebMap.of(newcomer, { web });

  it('a skill the hub has reached is drawn under the hub\'s own name', () => {
    expect(node(map, `skill:${stoneSkill}`)).toMatchObject({ state: 'hub', name: 'Quarrying' });
  });

  it('a skill held silently is neither named nor drawn for being held', () => {
    expect(node(map, `skill:${oreSkill}`)).toBeUndefined();
    expect(map.nodes.some(n => n.name === WebSystem.nameOf(oreSkill))).toBe(false);
  });
});

describe('what a sitting would ask, and what learning would ask, beside the lore held', () => {
  const woodsman = person([AXE_ON_LOG, known(['saw'], ['flora', 'wood'], 4000), known(null, ['flora', 'fiber'], 4000)], ['res_tree_log']);

  it('a thing they know says what a sitting on it asks, the same figure study asks, tree and all', () => {
    for (const who of [newcomer, woodsman]) {
      const def = RESOURCE_DEFINITIONS.res_tree_log;
      const target = StudySystem.targetOfThing({ id: def.id, name: def.name, tags: def.tags, rank: def.rank });
      expect(node(WebMap.of(who, { web: EMPTY }), 'thing:res_tree_log')!.study).toEqual(StudySystem.studyAsk(who, target));
    }
    expect(node(WebMap.of(woodsman, { web: EMPTY }), 'thing:res_tree_log')!.study!.cost)
      .toBeLessThan(node(WebMap.of(newcomer, { web: EMPTY }), 'thing:res_tree_log')!.study!.cost);
  });

  it('what they do not know says nothing of a sitting', () => {
    for (const n of WebMap.of(newcomer, { web: EMPTY }).nodes.filter(m => m.state === 'unknown')) expect(n.study).toBeUndefined();
  });

  it('a skill they do not hold says what learning it would ask in lore, by the law\'s own price', () => {
    const map = WebMap.of(newcomer, { web: EMPTY });
    const notHeld = map.nodes.filter(n => n.kind === 'skill' && n.state !== 'yours');
    expect(notHeld.length).toBeGreaterThan(0);
    for (const n of notHeld) expect(n.price).toBe(WebSystem.learnPrice(n.rank!));
    expect(node(map, `skill:${AXE_ON_LOG.id}`)!.price).toBeUndefined();
  });

  it('the lore held is told beside it, by category and in general, as the sheet tells it', () => {
    const rich = person([AXE_ON_LOG], ['res_tree_log'], {
      bank: { ...newcomer.bank, loreHeld: 37, loreKinds: { 'family:flora': { key: 'family:flora', name: 'flora', held: 20, misread: 0 } } }
    } as Partial<IPlayer>);
    expect(WebMap.purse(rich)).toEqual({ general: 37, kinds: LoreSystem.shownKinds(rich) });
  });
});

describe('the view only reads, and holds a web of any size by moving and folding', () => {
  it('drawing changes nothing about the character', () => {
    const who = master();
    const before = JSON.stringify(who);
    WebMap.of(who, { web: EMPTY });
    expect(JSON.stringify(who)).toBe(before);
  });

  it('every node drawn has a place of its own, and the places grow with the web: no grid, no limit', () => {
    const big = WebMap.of(master(), { web: EMPTY });
    const small = WebMap.of(newcomer, { web: EMPTY });
    const places = WebMap.layout(big, new Set());
    expect(Object.keys(places.at).length).toBe(big.nodes.length);
    expect(new Set(Object.values(places.at).map(p => `${p.x},${p.y}`)).size).toBe(big.nodes.length);
    expect(places.height).toBeGreaterThan(WebMap.layout(small, new Set()).height);
  });

  it('a group folds to one mark and opens again, and nothing in it is lost', () => {
    const map = WebMap.of(master(), { web: EMPTY });
    const open = WebMap.layout(map, new Set());
    const group = map.nodes[0].group;
    const inside = map.nodes.filter(n => n.group === group).map(n => n.id);
    const folded = WebMap.layout(map, new Set([group]));
    for (const id of inside) expect(folded.at[id]).toBeUndefined();
    expect(folded.folds.find(f => f.group === group)?.count).toBe(inside.length);
    expect(WebMap.layout(map, new Set()).at).toEqual(open.at);
  });
});

describe('it is opened at home, from the large sheet and from the study panel', () => {
  it('the large sheet, the study panel and the home tabs each open the view', () => {
    expect(SRC('src/components/LargeSheet.tsx')).toMatch(/useWebView/);
    expect(SRC('src/components/StudyPanel.tsx')).toMatch(/useWebView/);
    expect(SRC('src/components/PlayerHub.tsx')).toMatch(/TechWebView/);
  });
});
