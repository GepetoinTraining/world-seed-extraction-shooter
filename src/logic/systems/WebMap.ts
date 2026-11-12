/**
 * THE VIEW OF THE TECH WEB (the design pass, part 1). Pedro, 2026-11-11: "The specialize in lore would be better if we
 * designed the (design as in the view) of the tech web, what's unlocking what, where do things sit, so people could
 * minimally plan their lore."
 *
 * What unlocks what is the web's own law, read and never written here: a thing is worked by a skill (the mint law, D27:
 * a skill is the tool and the thing it worked), a skill opens a station (D25: the connection against the tags), a station
 * makes a thing (its recipes), and a thing feeds what is made of it. Where a thing sits is how far it stands from the
 * ground, counted over those same links, so its place does not move as a person learns.
 *
 * What a person is shown is what they know (D19, Pedro: "a player only knows WHAT they study or interact with"): their
 * own skills and the materials they know by name; what the hub has reached, which is the hub's and so everyone's there
 * (D27), under the hub's own name; and, one step out from either, what they do not know, as unknown and never named. A
 * skill a hub holds silently is never told by being held (D125). Pure: a player and a web in, a picture's data out.
 */

import { IHubWeb, IPlayer, IWebPack, IWebStation } from '../../../shared/types';
import { IHubTree, WebSystem } from '../../../shared/logic/systems/WebSystem';
import { WebBank } from '../../../shared/logic/content/WebBank';
import { TagLaw } from '../../../shared/logic/content/TagLaw';
import { RESOURCE_DEFINITIONS } from '../../../shared/entities/item/data/resourceDefinitions';
import { CRAFTED_DEFINITIONS } from '../../../shared/entities/economy/data/recipeDefinitions';
import { ProgressionSystem } from '../../../shared/entities/player/systems/ProgressionSystem';
import { StudySystem } from './StudySystem';
import { LoreSystem } from './LoreSystem';
import { IHubTech, hubStations, hubTreeOf } from '../../entities/hub/hubTech';
import { SkillNames } from './SkillNames';

export type MapKind = 'thing' | 'skill' | 'station';
/** Held by this person; still forming in their hands; reached by the hub; or not known at all. */
export type MapState = 'yours' | 'forming' | 'hub' | 'unknown';
export type MapLink = 'works' | 'opens' | 'makes' | 'feeds';

export interface IMapNode {
  id: string;
  kind: MapKind;
  /** The key the web knows it by. Never shown: a mark is kept by it. */
  ref: string;
  state: MapState;
  /** Only what is known has a name. */
  name?: string;
  /** How far from the ground it sits. */
  depth: number;
  /** The fold it sits in: its column, its kind, and the word of its family where it is known. */
  group: string;
  /** The word a fold says, where the group is known. */
  groupWord: string;
  /** A rank index, for a skill (what it is born at) and a thing. */
  rank?: number;
  /** What a sitting on it would ask this person: a thing they know. */
  study?: { cost: number; seconds: number };
  /** What learning it would ask in lore: a skill not held. */
  price?: number;
  /** The category its lore files under (WebSystem.categoryOf). The key is never shown; the word only where it may be. */
  category?: { key: string; word?: string };
  /** A skill's tags, for the law to read. Never shown. */
  tags?: string[];
  /** On the way to what the character has marked, and the mark itself (part 2). */
  onWay?: boolean;
  goal?: boolean;
}

/** One step of the way to a mark: a node, as the person may see it. */
export type IPlanStep = Omit<IMapNode, 'depth' | 'group' | 'groupWord' | 'onWay' | 'goal'>;

/** What the way asks in lore, by category and in general, against what is held: the law's own spend, a category first. */
export interface IPlanLore {
  asked: number;
  lines: { key: string; word?: string; asked: number; fromOwn: number; fromGeneral: number; short: number }[];
  general: { asked: number; held: number };
  met: boolean;
  short: number;
}

export interface IPlan { goal: string; steps: IPlanStep[]; broken: boolean; lore: IPlanLore }

export interface IMapEdge { from: string; to: string; why: MapLink }

export interface IWebMap { nodes: IMapNode[]; edges: IMapEdge[] }

export interface IMapContext {
  web: IHubWeb;
  tech?: Pick<IHubTech, 'chain' | 'reached'>;
  pack?: IWebPack;
}

export interface IMapLayout {
  at: Record<string, { x: number; y: number }>;
  heads: { group: string; word: string; x: number; y: number; count: number; folded: boolean }[];
  folds: { group: string; word: string; x: number; y: number; count: number }[];
  width: number;
  height: number;
}

/** The picture's own measures, in pixels: a column's width and a row's height. Nothing reads them as a limit. */
export const MAP_COLUMN = 220;
export const MAP_ROW = 36;
const HEAD_ROW = 24;
const GROUP_GAP = 10;

type Thing = { id: string; name: string; tags: string[]; rank: number };
type Skill = { id: string; tags: string[]; rank: number };

const STATE_ORDER: Record<MapState, number> = { yours: 0, forming: 1, hub: 2, unknown: 3 };
const connects = (tags: string[], station: Pick<IWebStation, 'connection'>) =>
  station.connection.tool.some(t => tags.includes(t)) && station.connection.material.every(t => tags.includes(t));

/** Every thing, skill and station the web holds, and how they link. The same for everyone: it is the web's law. */
function universe(pack: IWebPack, tech: IMapContext['tech'], extraSkills: Skill[]) {
  const things = new Map<string, Thing>();
  const defOf = (id: string) => RESOURCE_DEFINITIONS[id] ?? CRAFTED_DEFINITIONS[id];
  const webThing = (id: string) => [...pack.materials, ...pack.goods].find(m => m.id === id);
  const addThing = (id: string, tags?: string[], rank?: unknown) => {
    if (things.has(id)) return;
    const def = defOf(id);
    const own = webThing(id);
    things.set(id, {
      id, name: def?.name ?? own?.name ?? id.replace(/_/g, ' '),
      tags: tags ?? def?.tags ?? own?.tags ?? [], rank: ProgressionSystem.rankIndex((rank ?? def?.rank ?? own?.rank) as never)
    });
  };
  for (const m of WebBank.workableMaterials(pack)) addThing(m.id, m.tags, m.rank);
  for (const r of pack.recipes) for (const line of [...r.inputs, ...r.outputs]) addThing(line.itemId);

  const skills = new Map<string, Skill>();
  for (const c of WebBank.connections(pack)) {
    skills.set(c.skillId, { id: c.skillId, tags: TagLaw.parseSkillId(c.skillId) ?? [], rank: things.get(c.materialDefId)?.rank ?? 0 });
  }
  for (const s of extraSkills) if (!skills.has(s.id) && s.tags.length > 0) skills.set(s.id, s);

  // A chain's station is a thing nobody can read until the hub reaches it (D125): only those reached are on the web
  const reached = new Set(tech?.reached ?? []);
  const chainKeys = new Set((tech?.chain.stations ?? []).map(s => s.key));
  const stations = hubStations(tech ?? { chain: { tags: [], materials: [], stations: [], goods: [], gear: [] } }, pack)
    .filter(s => !chainKeys.has(s.id) || reached.has(s.id));

  const edges: IMapEdge[] = [];
  const seen = new Set<string>();
  const link = (from: string, to: string, why: MapLink) => {
    const key = `${from}>${to}>${why}`;
    if (seen.has(key)) return;
    seen.add(key);
    edges.push({ from, to, why });
  };
  const workable = WebBank.workableMaterials(pack);
  /** What makes a thing: a station's recipe, and all it asks for. */
  const makers = new Map<string, { station: string; inputs: string[] }[]>();
  for (const skill of skills.values()) {
    const worked = WebSystem.materialIdentity(skill.tags, pack);
    if (worked.length > 0) {
      for (const m of workable) if (worked.every(t => m.tags.includes(t))) link(`thing:${m.id}`, `skill:${skill.id}`, 'works');
    }
    for (const s of stations) if (connects(skill.tags, s)) link(`skill:${skill.id}`, `station:${s.id}`, 'opens');
  }
  for (const r of pack.recipes) {
    if (!stations.some(s => s.id === r.requiredStation)) continue;
    for (const out of r.outputs) {
      makers.set(out.itemId, [...(makers.get(out.itemId) ?? []), { station: r.requiredStation, inputs: r.inputs.map(i => i.itemId) }]);
      link(`station:${r.requiredStation}`, `thing:${out.itemId}`, 'makes');
      for (const input of r.inputs) link(`thing:${input.itemId}`, `thing:${out.itemId}`, 'feeds');
    }
  }
  return { things, skills, stations, edges, makers };
}

/** How far from the ground: counted from what nothing makes, over work, opening and making. */
function depths(ids: string[], edges: IMapEdge[]): Map<string, number> {
  const out = new Map<string, number>();
  const next = new Map<string, string[]>();
  const made = new Set<string>();
  for (const e of edges) {
    if (e.why === 'feeds') continue;
    next.set(e.from, [...(next.get(e.from) ?? []), e.to]);
    if (e.why === 'makes') made.add(e.to);
  }
  const queue = ids.filter(id => id.startsWith('thing:') && !made.has(id));
  for (const id of queue) out.set(id, 0);
  while (queue.length > 0) {
    const id = queue.shift()!;
    for (const to of next.get(id) ?? []) if (!out.has(to)) { out.set(to, out.get(id)! + 1); queue.push(to); }
  }
  // What the ground does not reach still has a place: past the kind it is
  const kindFloor = (id: string) => (id.startsWith('thing:') ? 0 : id.startsWith('skill:') ? 1 : 2);
  for (const id of ids) if (!out.has(id)) out.set(id, kindFloor(id));
  return out;
}

const familyWord = (tags: string[], pack: IWebPack): string => {
  const worked = WebSystem.materialIdentity(tags, pack);
  return (worked.find(t => WebBank.hasKind(pack, t, ['family'])) ?? worked[0] ?? '').replace(/_/g, ' ');
};

type Node = Omit<IMapNode, 'depth' | 'group' | 'groupWord'>;

/** Every node of the web with how this person knows it, and the web's links: what both the picture and a plan read. */
function read(player: IPlayer, ctx: IMapContext) {
    const pack = ctx.pack ?? WebBank.current();
    const held = WebSystem.heldSkills(player.bank.universalSkills ?? {});
    const forming = Object.values(player.skillProgress ?? {});
    const hubNodes = Object.values(ctx.web.nodes ?? {});
    const extra: Skill[] = [
      ...held.map(s => ({ id: s.id, tags: s.tags, rank: s.rank ?? 0 })),
      ...forming.map(p => ({ id: p.id, tags: p.tags, rank: p.rank })),
      ...hubNodes.map(n => ({ id: n.id, tags: n.tags, rank: n.rank }))
    ];
    const { things, skills, stations, edges, makers } = universe(pack, ctx.tech, extra);
    const hub: IHubTree | undefined = ctx.tech ? hubTreeOf(ctx.tech as IHubTech, pack) : undefined;
    const reader = WebSystem.knowledgeReader(player);
    const heldIds = new Set(held.map(s => s.id));
    const formingIds = new Set(forming.map(p => p.id));
    const hubIds = new Set(hubNodes.map(n => n.id));
    const heldTags = held.map(s => s.tags);
    const hubTags = hubNodes.map(n => n.tags);
    const reached = new Set(ctx.tech?.reached ?? []);

    const all: Node[] = [];
    for (const t of things.values()) {
      const yours = reader(t.id) >= 1;
      all.push({
        id: `thing:${t.id}`, kind: 'thing', ref: t.id, state: yours ? 'yours' : 'unknown', rank: t.rank,
        ...(yours ? {
          name: t.name,
          // The same figure study asks of this thing in front of them: what it shows, placed on the hub's web by its key
          study: StudySystem.studyAsk(player, StudySystem.targetOfThing({ id: t.id, name: t.name, tags: t.tags, rank: (RESOURCE_DEFINITIONS[t.id] ?? CRAFTED_DEFINITIONS[t.id])?.rank }), hub)
        } : {})
      });
    }
    for (const s of skills.values()) {
      const state: MapState = heldIds.has(s.id) ? 'yours' : formingIds.has(s.id) ? 'forming' : hubIds.has(s.id) ? 'hub' : 'unknown';
      const name = state === 'unknown' ? undefined
        : SkillNames.nameOf(s.id, player.skillWords?.[s.id]?.name ?? ctx.web.nodes[s.id]?.name, pack);
      const found = WebSystem.categoryOf(s.tags, hub, [], pack);
      all.push({
        id: `skill:${s.id}`, kind: 'skill', ref: s.id, state, rank: s.rank, tags: s.tags,
        ...(name ? { name } : {}),
        ...(state !== 'yours' ? { price: WebSystem.learnPrice(s.rank) } : {}),
        ...(found ? { category: { key: found.key, ...(found.word && state !== 'unknown' ? { word: found.word.replace(/_/g, ' ') } : {}) } } : {})
      });
    }
    for (const s of stations) {
      const state: MapState = heldTags.some(tags => connects(tags, s)) ? 'yours'
        : hubTags.some(tags => connects(tags, s)) || reached.has(s.id) ? 'hub' : 'unknown';
      all.push({ id: `station:${s.id}`, kind: 'station', ref: s.id, state, ...(state !== 'unknown' ? { name: s.name } : {}) });
    }
    return { pack, all, edges, makers, things, skills };
}

/** What a step asks: nothing, or what learning it asks. */
const priceOf = (n: Node) => (n.kind === 'skill' && n.state !== 'yours' ? n.price ?? 0 : 0);
/** Met already: a skill held, a thing known by name, a station the person's hands or the hub's web open (D27: what anyone here has reached opens for everyone here). */
const isMet = (n: Node) => n.state === 'yours' || (n.kind === 'station' && n.state === 'hub');

export const WebMap = {
  /**
   * The web as this person may see it. `tech` is the hub's own (its chain and what it has reached); with none, the web is
   * the shipped one and the hub has written nothing. A goal the character has marked draws its whole way.
   */
  of(player: IPlayer, ctx: IMapContext): IWebMap {
    const { pack, all, edges, things, skills } = read(player, ctx);
    const plan = player.webGoal ? this.pathTo(player, ctx, player.webGoal.ref) : null;
    const way = new Set(plan?.steps.map(s => s.id) ?? []);
    const goal = player.webGoal?.ref ?? null;

    // What is drawn: everything known, one step out from it, and the way to what is marked
    const knownIds = new Set(all.filter(n => n.state !== 'unknown').map(n => n.id));
    const near = new Set<string>();
    for (const e of edges) {
      if (knownIds.has(e.from)) near.add(e.to);
      if (knownIds.has(e.to)) near.add(e.from);
    }
    const drawn = all.filter(n => knownIds.has(n.id) || near.has(n.id) || way.has(n.id) || n.id === goal);
    const depth = depths(all.map(n => n.id), edges);
    const nodes: IMapNode[] = drawn.map(n => {
      const d = depth.get(n.id) ?? 0;
      const word = n.state === 'unknown' ? 'not known'
        : n.kind === 'station' ? 'stations'
        : familyWord(n.kind === 'thing' ? things.get(n.ref)!.tags : skills.get(n.ref)!.tags, pack) || (n.kind === 'thing' ? 'things' : 'skills');
      return {
        ...n, depth: d, group: `${d}:${n.kind}:${n.state === 'unknown' ? '?' : word}`, groupWord: word,
        ...(way.has(n.id) ? { onWay: true } : {}), ...(n.id === goal ? { goal: true } : {})
      };
    });
    const drawnIds = new Set(nodes.map(n => n.id));
    return { nodes, edges: edges.filter(e => drawnIds.has(e.from) && drawnIds.has(e.to)) };
  },

  /**
   * The way to a marked node from what this person knows (part 2): the one that asks least lore, then has fewest steps,
   * then comes first by key. A skill is met when held, a thing when known by name, a station when the person's hands or the
   * hub's web open it. A station is reached by any skill that opens it, a skill by any thing it works, a made thing by any
   * of its makers (its station and all it asks for), and a raw thing not known is a step to find it. Only a skill asks
   * lore: what learning it asks. Steps come in the order they are taken, the mark last.
   */
  pathTo(player: IPlayer, ctx: IMapContext, goal: string): IPlan {
    const { all, edges, makers } = read(player, ctx);
    const byId = new Map(all.map(n => [n.id, n]));
    const into = new Map<string, IMapEdge[]>();
    for (const e of edges) into.set(e.to, [...(into.get(e.to) ?? []), e]);
    type Way = { steps: string[]; lore: number };
    const memo = new Map<string, Way | null>();
    const walking = new Set<string>();
    const join = (ways: Way[], last?: string): Way => {
      const steps = [...new Set([...ways.flatMap(w => w.steps), ...(last ? [last] : [])])];
      return { steps, lore: steps.reduce((sum, id) => sum + priceOf(byId.get(id)!), 0) };
    };
    const better = (a: Way, b: Way) => a.lore - b.lore || a.steps.length - b.steps.length || (a.steps.join('|') < b.steps.join('|') ? -1 : 1);
    const best = (ways: (Way | null)[]) => ways.filter((w): w is Way => !!w).sort(better)[0] ?? null;
    const way = (id: string): Way | null => {
      const n = byId.get(id);
      if (!n) return null;
      if (isMet(n)) return { steps: [], lore: 0 };
      if (memo.has(id)) return memo.get(id)!;
      if (walking.has(id)) return null;
      walking.add(id);
      let out: Way | null = null;
      const from = (why: MapLink) => (into.get(id) ?? []).filter(e => e.why === why).map(e => e.from).sort();
      if (n.kind === 'skill' || n.kind === 'station') {
        const found = best(from(n.kind === 'skill' ? 'works' : 'opens').map(way));
        out = found ? join([found], id) : null;
      } else {
        const made = makers.get(n.ref) ?? [];
        if (made.length === 0) out = { steps: [id], lore: 0 };
        else {
          out = best(made.map(m => {
            const parts = [way(`station:${m.station}`), ...m.inputs.map(i => way(`thing:${i}`))];
            return parts.every(p => !!p) ? join(parts as Way[], id) : null;
          }));
        }
      }
      walking.delete(id);
      memo.set(id, out);
      return out;
    };
    const found = way(goal);
    const steps: IPlanStep[] = (found?.steps ?? []).map(id => byId.get(id)!);
    return { goal, steps, broken: !found, lore: this.loreOf(player, steps) };
  },

  /** What the steps ask in lore, spent as the law spends it: each skill's own category first, then general. */
  loreOf(player: IPlayer, steps: IPlanStep[]): IPlanLore {
    let purse = { loreHeld: player.bank.loreHeld ?? 0, loreKinds: player.bank.loreKinds };
    const held = purse.loreHeld;
    const lines = new Map<string, IPlanLore['lines'][number]>();
    for (const step of steps) {
      const price = priceOf(step);
      if (price <= 0) continue;
      const key = step.category?.key ?? 'general';
      const kind = purse.loreKinds?.[key];
      const own = kind && kind.misread <= 0 ? kind.held : 0;
      const fromOwn = Math.min(own, price);
      const fromGeneral = Math.min(purse.loreHeld, price - fromOwn);
      const short = price - fromOwn - fromGeneral;
      // The person may read the word of a category they hold lore of, or of a skill they know: never its key
      const word = player.bank.loreKinds?.[key]?.name ?? step.category?.word;
      const line = lines.get(key) ?? { key, ...(word ? { word } : {}), asked: 0, fromOwn: 0, fromGeneral: 0, short: 0 };
      lines.set(key, { ...line, asked: line.asked + price, fromOwn: line.fromOwn + fromOwn, fromGeneral: line.fromGeneral + fromGeneral, short: line.short + short });
      purse = {
        loreHeld: purse.loreHeld - fromGeneral,
        loreKinds: kind && fromOwn > 0 ? { ...purse.loreKinds, [key]: { ...kind, held: kind.held - fromOwn } } : purse.loreKinds
      };
    }
    const lines_ = [...lines.values()];
    const short = lines_.reduce((sum, l) => sum + l.short, 0);
    return {
      asked: lines_.reduce((sum, l) => sum + l.asked, 0), lines: lines_,
      general: { asked: lines_.reduce((sum, l) => sum + l.fromGeneral, 0), held }, met: short === 0, short
    };
  },

  /** The lore held, beside the web: general, and each category under the word the person may see for it. */
  purse(player: IPlayer): { general: number; kinds: { key: string; name: string; reads: number }[] } {
    return { general: LoreSystem.held(player), kinds: LoreSystem.shownKinds(player) };
  },

  /**
   * Where each node is drawn: a column for how far from the ground it sits, and down the column each fold under its word,
   * known first. A folded group is one mark with its count. The picture is as large as the web: it is moved, never cut.
   */
  layout(map: IWebMap, folded: Set<string>): IMapLayout {
    const columns = new Map<number, IMapNode[]>();
    for (const n of map.nodes) columns.set(n.depth, [...(columns.get(n.depth) ?? []), n]);
    const at: IMapLayout['at'] = {};
    const heads: IMapLayout['heads'] = [];
    const folds: IMapLayout['folds'] = [];
    let height = 0;
    const order = [...columns.keys()].sort((a, b) => a - b);
    order.forEach((depth, column) => {
      const x = column * MAP_COLUMN;
      const groups = new Map<string, IMapNode[]>();
      for (const n of columns.get(depth)!) groups.set(n.group, [...(groups.get(n.group) ?? []), n]);
      const best = (ns: IMapNode[]) => Math.min(...ns.map(n => STATE_ORDER[n.state]));
      const kindOrder = (g: string) => (g.includes(':thing:') ? 0 : g.includes(':skill:') ? 1 : 2);
      const sorted = [...groups.entries()].sort(([a, an], [b, bn]) => kindOrder(a) - kindOrder(b) || best(an) - best(bn) || (a < b ? -1 : a > b ? 1 : 0));
      let y = 0;
      for (const [group, ns] of sorted) {
        const isFolded = folded.has(group);
        heads.push({ group, word: ns[0].groupWord, x, y, count: ns.length, folded: isFolded });
        y += HEAD_ROW;
        if (isFolded) {
          folds.push({ group, word: ns[0].groupWord, x, y, count: ns.length });
          y += MAP_ROW;
        } else {
          const inOrder = [...ns].sort((a, b) => STATE_ORDER[a.state] - STATE_ORDER[b.state] || ((a.name ?? '~') < (b.name ?? '~') ? -1 : (a.name ?? '~') > (b.name ?? '~') ? 1 : a.id < b.id ? -1 : 1));
          for (const n of inOrder) { at[n.id] = { x, y }; y += MAP_ROW; }
        }
        y += GROUP_GAP;
      }
      height = Math.max(height, y);
    });
    return { at, heads, folds, width: order.length * MAP_COLUMN, height };
  }
};
