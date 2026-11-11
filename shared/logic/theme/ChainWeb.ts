/**
 * THE CHAIN (D91, D119). Pedro, 2026-11-01: "if I know how to make flying vehicles in 500 BC
 * I'd need to generate the whole chain", and "the model writes the NPC, the web is resolved
 * backwards". And on what is resolved: "Fireball = magic, scroll, a special plant that
 * evolved, a monster you captured, a dragon, molotov cocktail, bazooka... fireball is a
 * concept (magic) how you make that effect happen is you paying the cost in whatever resource
 * you have and build".
 *
 * So what a person knows is a CONCEPT, and a chain is written backwards from it to the ground
 * this hub stands on, in the shapes a theme already uses: goods are the processes, stations the
 * workstations, gear the tools, materials what has to be added to a world. Each round closes
 * what the last left open, and what a hub already holds is never asked for twice.
 *
 * The result is an AND-OR web. A need is met by ANY way of meeting it; a way is open only when
 * ALL it asks for is met and its station stands. Nothing here reads who paid or how far anyone
 * has walked: that is the store's. Pure, and nothing a model says passes unjudged.
 */

import { TagLaw } from '../content/TagLaw';
import { ThemeLaw } from './ThemeLaw';
import {
  BIOMES, GEAR_KINDS, HARVEST_VERBS, IThemeBody, IThemeGear, IThemeGood, IThemeLook, IThemeMaterial, IThemeStation, LOOK_COLORS, LOOK_SHAPES, LOOK_SIZES, MATERIAL_FORMS, RANKS, ThemeRank, WEIGHTS, WORTHS
} from './ThemeTypes';
import { rankStep } from './ThemeFormula';
import { fnv1a } from '../rng/DeterministicRNG';
import { canonical } from './ThemeCompiler';

/**
 * The law's version. Raise it whenever `judge` reads a round differently: every refusal remembered under
 * the old law is a new ask under the new one (C5, leg 2).
 */
export const CHAIN_LAW_VERSION = 1;

const has = (values: readonly string[], v: string) => values.includes(v);

/** A process. `answers` says which concept it is one way of bringing about, or is empty. */
export type IChainGood = IThemeGood & { answers: string; /** Who this way came from, stamped on the way in. Two people with one concept each bring their own. */ by?: string };

/** D119: a new thing says what it looks like, and the art composes the sprite from that. */
export type IChainMaterial = IThemeMaterial & { look?: IThemeLook };

/** What a model writes in one round: the theme's own shapes, words and bands. */
export interface IChainRound {
  tags: IThemeBody['tags'];
  materials: IChainMaterial[];
  stations: IThemeStation[];
  goods: (IChainGood & { look?: IThemeLook })[];
  gear: (IThemeGear & { look?: IThemeLook })[];
}

export type IChainWeb = IChainRound;

export const emptyChain = (): IChainWeb => ({ tags: [], materials: [], stations: [], goods: [], gear: [] });

/** What stands in a hub right now, for the reach to read. */
export interface IChainStanding {
  stations: Set<string>;
  /** Any plain workshop at all: a good with no station of its own needs only that. */
  bench: boolean;
}

/** What it would still take: the stations to raise, and the steps that run at them. */
export interface IChainRoute {
  stations: string[];
  steps: string[];
  /** Nothing written so far reaches it. The next round has more to say. */
  broken?: boolean;
}

/** What a hub already stands on. A key here needs nothing written. */
export interface IChainGround {
  /**
   * Anything that can be gathered or is already made, by the key a chain names it by. With
   * no `makers` it can be gathered. With them, what stands decides whether it is met.
   */
  things: { key: string; name: string; tags: string[]; rank: ThemeRank; makers?: { station?: string; from: { key: string }[] }[] }[];
  stations: { key: string; name: string; tool: string[]; material: string[] }[];
  /** Tool words something already answers. */
  tools: string[];
}

/** What is still unmet. `by` is who is asking, for the words that go to a model. */
export interface IChainNeed {
  kind: 'thing' | 'station' | 'tool';
  key: string;
  by: string;
  /** The most it may be: a need never outranks what needs it, or a chain would never close. */
  rank: ThemeRank;
}

const lookRefusal = (key: string, look: IThemeLook | undefined): string | null => {
  if (!look) return `${key} says nothing of what it looks like.`;
  if (!has(LOOK_COLORS, look.color)) return `${key}: "${look.color}" is not a colour the art holds.`;
  if (!has(LOOK_SHAPES, look.shape)) return `${key}: "${look.shape}" is not a shape the art draws.`;
  if (!has(LOOK_SIZES, look.size)) return `${key}: "${look.size}" is not a size.`;
  return null;
};

/** A thing written before the look was asked for still gets one: from its key, the same every time. */
export function lookOfOld(thing: { key: string }): IThemeLook {
  const pick = <T>(words: readonly T[], salt: string) => words[fnv1a(`look:${salt}:${thing.key}`) % words.length];
  return { color: pick(LOOK_COLORS, 'color'), shape: pick(LOOK_SHAPES, 'shape'), size: pick(LOOK_SIZES, 'size') };
}

const conceptsOf = (chain: Pick<IChainWeb, 'goods'>) => new Set(chain.goods.map(g => g.answers).filter(Boolean));

const thingKeys = (chain: IChainWeb, ground: IChainGround) => new Set<string>([
  ...ground.things.map(t => t.key), ...chain.materials.map(m => m.key), ...chain.goods.map(g => g.key), ...chain.gear.map(g => g.key), ...conceptsOf(chain)
]);

export const ChainWeb = {
  /**
   * What was asked, as an id: computed from the ask's inputs, the words the law registers, the law's version and
   * the model, the way a theme's id comes from its words. The law's last answer is fed back to the model and is not
   * an input. The same ask refused once is not sent again until one of these changes (C5).
   */
  askIdOf(ask: { person: unknown; ground: unknown; written: unknown; open: unknown; refused?: string }, registered: readonly string[], model: string, law = CHAIN_LAW_VERSION): string {
    const bytes = canonical({ person: ask.person, ground: ask.ground, written: ask.written, open: ask.open, registered: [...registered].sort(), model, law });
    const a = fnv1a(`chain:a:${bytes}`).toString(16).padStart(8, '0');
    const b = fnv1a(`chain:b:${bytes}`).toString(16).padStart(8, '0');
    return `chain_${a}${b}`;
  },

  /** Two rounds' worth of writing, read as one. */
  merge(chain: IChainWeb, round: IChainRound, by?: string): IChainWeb {
    return {
      tags: [...chain.tags, ...round.tags],
      materials: [...chain.materials, ...round.materials],
      stations: [...chain.stations, ...round.stations],
      goods: [...chain.goods, ...round.goods.map(g => (by && g.answers ? { ...g, by } : g))],
      gear: [...chain.gear, ...round.gear]
    };
  },

  /** The tool words a chain's own gear answers. */
  toolsWritten(chain: Pick<IChainWeb, 'gear'>): string[] {
    return chain.gear.flatMap(g => g.tags.filter(t => t !== 'tool'));
  },

  /** What is unmet, walking back from a concept. Only what this concept reaches counts. */
  open(concept: string, conceptRank: ThemeRank, chain: IChainWeb, ground: IChainGround, by?: string): IChainNeed[] {
    const things = thingKeys(chain, ground);
    const stationKeys = new Set([...ground.stations.map(s => s.key), ...chain.stations.map(s => s.key)]);
    const tools = new Set([...ground.tools, ...this.toolsWritten(chain)]);
    const out = new Map<string, IChainNeed>();
    const add = (need: IChainNeed) => { const id = `${need.kind}:${need.key}`; if (!out.has(id)) out.set(id, need); };
    const seen = new Set<string>();

    const walkMaker = (m: { key: string; rank: ThemeRank; from: { key: string }[]; station?: string }) => {
      if (m.station && !stationKeys.has(m.station)) add({ kind: 'station', key: m.station, by: m.key, rank: m.rank });
      for (const line of m.from) {
        if (!things.has(line.key)) add({ kind: 'thing', key: line.key, by: m.key, rank: m.rank });
        else walkThing(line.key);
      }
      if (m.station) walkStation(m.station, m.rank);
    };
    const walkStation = (key: string, rank: ThemeRank) => {
      if (seen.has(`s:${key}`)) return;
      seen.add(`s:${key}`);
      const station = chain.stations.find(s => s.key === key);
      if (!station) return;
      // A workstation is worked with something, and one of its tools has to be makeable
      if (!station.tool.some(t => tools.has(t))) add({ kind: 'tool', key: station.tool[0], by: key, rank });
    };
    const walkThing = (key: string) => {
      if (seen.has(`t:${key}`)) return;
      seen.add(`t:${key}`);
      for (const good of chain.goods) if (good.key === key || good.answers === key) walkMaker(good);
      for (const gear of chain.gear) if (gear.key === key) walkMaker(gear);
    };

    // Their own way to it, even when someone else's already reaches the same concept.
    const own = !by || chain.goods.some(g => g.answers === concept && g.by === by);
    if (!things.has(concept) || !own) add({ kind: 'thing', key: concept, by: 'what they know', rank: conceptRank });
    if (things.has(concept)) walkThing(concept);
    for (const gear of chain.gear) if (out.has(`tool:${gear.tags.find(t => t !== 'tool')}`)) walkMaker(gear);
    // Each tool a reached station leans on is a thing to make too
    for (const station of chain.stations) {
      if (!seen.has(`s:${station.key}`)) continue;
      const tool = chain.gear.find(g => g.tags.some(t => station.tool.includes(t)));
      if (tool) walkThing(tool.key);
    }
    return [...out.values()];
  },

  /**
   * One round, judged whole against what stands. A broken round writes nothing and the ask
   * waits. `registered` holds the registry; a word this chain defined counts.
   */
  judge(round: IChainRound, chain: IChainWeb, ground: IChainGround, open: IChainNeed[], registered: (tag: string) => boolean): { ok: boolean; reason?: string } {
    const no = (why: string) => ({ ok: false, reason: `Round refused whole: ${why}` });
    if (!round || typeof round !== 'object') return no('that is not a round.');
    for (const field of ['tags', 'materials', 'stations', 'goods', 'gear'] as const) {
      if (!Array.isArray(round[field])) return no(`${field} is missing.`);
    }
    const stray = ThemeLaw.strayNumber(round);
    if (stray) return no(`it writes a number at ${stray}. The formula writes the numbers (D57).`);

    const ownTags = new Set([...chain.tags, ...round.tags].map(t => t.tag));
    const known = (tag: string) => ownTags.has(tag) || registered(tag);
    const unknown = (tags: string[]) => tags.find(t => !known(t));
    for (const t of round.tags) if (!TagLaw.isCanonicalSpelling(t.tag)) return no(`"${t.tag}" is not the normal spelling of a tag.`);

    const taken = new Set([...thingKeys(chain, ground), ...ground.stations.map(s => s.key), ...chain.stations.map(s => s.key)]);
    // A concept is a word many ways answer, so a way may share one. A key is its own.
    const claim = (key: string) => {
      if (!key || !TagLaw.isCanonicalSpelling(key) || taken.has(key)) return false;
      taken.add(key);
      return true;
    };

    for (const m of round.materials) {
      if (!claim(m.key)) return no(`material "${m.key}" needs its own plain key.`);
      if (!m.name?.trim()) return no(`material ${m.key} has no name.`);
      if (!has(RANKS, m.rank) || !has(MATERIAL_FORMS, m.form) || !has(HARVEST_VERBS, m.verb) || !has(WEIGHTS, m.weight) || !has(WORTHS, m.worth)) return no(`${m.key} is outside the bands.`);
      if (m.habitat.length === 0 || !m.habitat.every(b => has(BIOMES, b))) return no(`${m.key} lies nowhere a world has.`);
      const t = unknown(m.tags);
      if (t) return no(`${m.key} is tagged "${t}", which is not registered.`);
      const look = lookRefusal(m.key, m.look);
      if (look) return no(look);
    }
    for (const s of round.stations) {
      if (!claim(s.key)) return no(`station "${s.key}" needs its own plain key.`);
      if (!s.name?.trim()) return no(`station ${s.key} has no name.`);
      if (s.tool.length === 0 || s.material.length === 0) return no(`${s.key} connects no tool or no material (D25).`);
      const t = unknown([...s.tool, ...s.material, ...s.bill.map(b => b.tag)]);
      if (t) return no(`${s.key} names "${t}", which is not registered.`);
    }
    const stepsOf = new Map<string, number>();
    for (const item of [...ground.things, ...chain.materials, ...chain.goods, ...chain.gear, ...round.materials, ...round.goods, ...round.gear]) stepsOf.set(item.key, rankStep(item.rank));
    for (const g of round.goods) {
      if (!claim(g.key)) return no(`good "${g.key}" needs its own plain key.`);
      if (!g.name?.trim()) return no(`good ${g.key} has no name.`);
      if (!has(RANKS, g.rank) || !has(WEIGHTS, g.weight)) return no(`${g.key} is outside the bands.`);
      if (!known(g.trade)) return no(`${g.key} grows the trade "${g.trade}", which is not registered.`);
      if (g.from.length === 0) return no(`${g.key} is made from nothing.`);
      const t = unknown(g.tags);
      if (t) return no(`${g.key} is tagged "${t}", which is not registered.`);
      const look = lookRefusal(g.key, g.look);
      if (look) return no(look);
    }
    for (const g of round.gear) {
      if (!claim(g.key)) return no(`gear "${g.key}" needs its own plain key.`);
      if (!has(RANKS, g.rank) || !has(GEAR_KINDS, g.kind)) return no(`${g.key} is outside the bands.`);
      const t = unknown([...g.tags, ...g.works]);
      if (t) return no(`${g.key} names "${t}", which is not registered.`);
      if (g.craftAt !== 'none' && g.from.length === 0) return no(`${g.key} can be made, from nothing.`);
      const look = lookRefusal(g.key, g.look);
      if (look) return no(look);
    }
    // A need never outranks what needs it, so the walk has a floor and always ends.
    for (const maker of [...round.goods, ...round.gear]) {
      for (const line of maker.from) {
        const need = stepsOf.get(line.key);
        if (need !== undefined && need > rankStep(maker.rank)) return no(`${maker.key} is rank ${maker.rank} and asks for ${line.key}, which stands above it.`);
      }
      // Flying vehicles in 500 BC: the whole chain has to be there, so no step leaps a rank.
      // What it asks for that nothing has written yet is the next round's to place.
      const asked = maker.from.map(line => stepsOf.get(line.key));
      if (asked.every(step => step !== undefined) && rankStep(maker.rank) - Math.max(...(asked as number[])) > 1) {
        return no(`${maker.key} is rank ${maker.rank} and nothing it asks for stands within a rank of it. No step leaps.`);
      }
    }
    const merged = this.merge(chain, round);
    const cycle = ThemeLaw.findCycle({ goods: merged.goods });
    if (cycle) return no(`${cycle} can only be made from itself.`);

    if (open.length > 0) {
      const after = new Set(this.answered(round));
      if (!open.some(n => after.has(n.key))) return no('it answers nothing that was asked.');
    }
    return { ok: true };
  },

  /**
   * What the web has reached, given what stands: a fixed point over the AND-OR web. A way is
   * open when its station stands and all it asks for is met; a need is met by any open way.
   */
  reached(chain: IChainWeb, ground: IChainGround, standing: IChainStanding): { things: Set<string>; stations: Set<string> } {
    const things = new Set<string>(ground.things.filter(t => !t.makers?.length).map(t => t.key));
    for (const m of chain.materials) things.add(m.key);
    const tools = new Set(ground.tools);
    const stations = new Set<string>();
    const answered = (from: { key: string }[]) => from.every(line => things.has(line.key));
    const standsAt = (station: string | undefined) => (station ? stations.has(station) : standing.bench);

    for (let moved = true; moved;) {
      moved = false;
      const add = (set: Set<string>, key: string) => { if (!set.has(key)) { set.add(key); moved = true; } };
      for (const s of ground.stations) if (standing.stations.has(s.key)) add(stations, s.key);
      for (const s of chain.stations) if (standing.stations.has(s.key) && s.tool.some(t => tools.has(t))) add(stations, s.key);
      for (const t of ground.things) {
        if (t.makers?.some(m => standsAt(m.station) && answered(m.from))) add(things, t.key);
      }
      for (const g of chain.goods) {
        if (!standsAt(g.station) || !answered(g.from)) continue;
        add(things, g.key);
        if (g.answers) add(things, g.answers);
      }
      for (const g of chain.gear) {
        if (g.craftAt === 'bench' && !standing.bench) continue;
        if (g.craftAt === 'none' || !answered(g.from)) continue;
        add(things, g.key);
        for (const t of g.tags) if (t !== 'tool') add(tools, t);
      }
    }
    return { things, stations };
  },

  /**
   * The cheapest way back from a concept, in stations still to raise: what a machine would
   * have to fold. Pedro: "an npc will never accrue the cost if the pieces already exist,
   * that's player intelligence and organizing the order of the web". Ties go by key, so it
   * reads the same on every machine.
   */
  route(concept: string, chain: IChainWeb, ground: IChainGround, standing: IChainStanding): IChainRoute {
    const { things, stations } = this.reached(chain, ground, standing);
    const memo = new Map<string, IChainRoute | null>();
    const walking = new Set<string>();

    const stationCost = (key: string | undefined): IChainRoute | null => {
      if (!key || stations.has(key) || standing.stations.has(key)) return { stations: [], steps: [] };
      const station = chain.stations.find(s => s.key === key);
      if (!station && !ground.stations.some(s => s.key === key)) return null;
      const tool = station ? this.toolRoute(station, chain, ground, standing, thing) : { stations: [], steps: [] };
      return tool && { stations: [...new Set([key, ...tool.stations])], steps: tool.steps };
    };
    const makerCost = (maker: { key: string; station?: string; from: { key: string }[] }): IChainRoute | null => {
      let total = stationCost(maker.station);
      if (!total) return null;
      for (const line of maker.from) {
        const part = thing(line.key);
        if (!part) return null;
        total = { stations: [...new Set([...total.stations, ...part.stations])], steps: [...new Set([...total.steps, ...part.steps])] };
      }
      return { stations: total.stations, steps: [...new Set([...total.steps, maker.key])] };
    };
    function thing(key: string): IChainRoute | null {
      if (things.has(key)) return { stations: [], steps: [] };
      if (memo.has(key)) return memo.get(key)!;
      if (walking.has(key)) return null;
      walking.add(key);
      const makers = [
        ...chain.goods.filter(g => g.key === key || g.answers === key),
        ...chain.gear.filter(g => g.key === key),
        ...(ground.things.find(t => t.key === key)?.makers ?? []).map((m, i) => ({ key: `${key}#${i}`, ...m }))
      ].sort((a, b) => (a.key < b.key ? -1 : 1));
      const routes = makers.map(makerCost).filter((r): r is IChainRoute => !!r)
        .sort((a, b) => a.stations.length - b.stations.length || a.steps.length - b.steps.length);
      walking.delete(key);
      const best = routes[0] ?? null;
      memo.set(key, best);
      return best;
    }
    return thing(concept) ?? { stations: [], steps: [], broken: true };
  },

  /** A station leans on one of its tools. The cheapest that can be made, or one already held. */
  toolRoute(station: IThemeStation, chain: IChainWeb, ground: IChainGround, standing: IChainStanding, thing: (key: string) => IChainRoute | null): IChainRoute | null {
    if (station.tool.some(t => ground.tools.includes(t))) return { stations: [], steps: [] };
    const routes = chain.gear.filter(g => g.tags.some(t => station.tool.includes(t)))
      .map(g => thing(g.key)).filter((r): r is IChainRoute => !!r)
      .sort((a, b) => a.stations.length - b.stations.length);
    return routes[0] ?? null;
  },

  /**
   * A thing's tree in this web. Pedro, 2026-11-11, on what a tree of the tech web is: "this is a function of hubs,
   * there's a check we ran with haiku where I posited fireball could be a skill acquired by going tech and magic,
   * and it's the same thing, and they would connect". So: from whatever `isSeed` picks, up through everything that
   * asks for it to every concept it sits under; then down from each concept through every way to it and all that
   * way asks for. Two roads to one concept are one tree. Null when no concept stands above any seed: the web says
   * nothing of the thing. The tags are every tag on the tree, once each, in the order the web holds them.
   */
  treeAround(chain: IChainWeb, ground: IChainGround, isSeed: (key: string, tags: string[]) => boolean): { concepts: string[]; keys: string[]; tags: string[] } | null {
    const asks = new Map<string, Set<string>>();
    const tagsOf = new Map<string, string[]>();
    const ask = (key: string, ...needs: (string | undefined)[]) => {
      const set = asks.get(key) ?? new Set<string>();
      for (const need of needs) if (need) set.add(need);
      asks.set(key, set);
    };
    const tag = (key: string, tags: string[]) => tagsOf.set(key, [...(tagsOf.get(key) ?? []), ...tags]);
    const servers = (tools: string[]) => chain.gear.filter(g => g.tags.some(t => t !== 'tool' && tools.includes(t))).map(g => g.key);

    for (const g of chain.goods) {
      ask(g.key, ...g.from.map(l => l.key), g.station || undefined);
      tag(g.key, g.tags);
      if (g.answers) ask(g.answers, g.key);
    }
    for (const g of chain.gear) { ask(g.key, ...g.from.map(l => l.key)); tag(g.key, [...g.tags, ...g.works]); }
    for (const m of chain.materials) tag(m.key, m.tags);
    for (const s of [...ground.stations, ...chain.stations]) { ask(s.key, ...servers(s.tool)); tag(s.key, [...s.tool, ...s.material]); }
    for (const t of ground.things) {
      for (const m of t.makers ?? []) ask(t.key, ...m.from.map(l => l.key), m.station);
      tag(t.key, t.tags);
    }

    const concepts = conceptsOf(chain);
    const usedBy = new Map<string, string[]>();
    for (const [key, needs] of asks) for (const need of needs) usedBy.set(need, [...(usedBy.get(need) ?? []), key]);

    const walk = (from: string[], next: (key: string) => Iterable<string>): Set<string> => {
      const seen = new Set<string>(from);
      const queue = [...from];
      while (queue.length > 0) for (const k of next(queue.shift()!)) if (!seen.has(k)) { seen.add(k); queue.push(k); }
      return seen;
    };
    const seeds = [...new Set([...tagsOf.keys(), ...asks.keys()])].filter(key => isSeed(key, tagsOf.get(key) ?? []));
    const above = [...walk(seeds, key => usedBy.get(key) ?? [])].filter(key => concepts.has(key)).sort();
    if (above.length === 0) return null;
    const keys = [...walk(above, key => asks.get(key) ?? [])].sort();
    return { concepts: above, keys, tags: [...new Set(keys.flatMap(key => tagsOf.get(key) ?? []))] };
  },

  /** Every key and concept and tool word a round puts on the table. */
  answered(round: IChainRound): string[] {
    return [
      ...round.materials.map(m => m.key), ...round.stations.map(s => s.key), ...round.goods.map(g => g.key),
      ...round.goods.map(g => g.answers).filter(Boolean), ...round.gear.map(g => g.key), ...this.toolsWritten(round)
    ];
  },

  /** Nodes and edges: tools, workstations, requirements, materials, processes. */
  measure(chain: IChainWeb): { nodes: number; edges: number; tools: number; stations: number; materials: number; processes: number; ways: Record<string, number>; words: number } {
    const edges = chain.goods.reduce((n, g) => n + g.from.length + (g.station ? 1 : 0) + (g.answers ? 1 : 0), 0)
      + chain.gear.reduce((n, g) => n + g.from.length, 0)
      + chain.stations.reduce((n, s) => n + s.tool.length, 0);
    const ways: Record<string, number> = {};
    for (const g of chain.goods) if (g.answers) ways[g.answers] = (ways[g.answers] ?? 0) + 1;
    return {
      nodes: chain.goods.length + chain.gear.length + chain.stations.length + chain.materials.length,
      edges, tools: chain.gear.length, stations: chain.stations.length, materials: chain.materials.length, processes: chain.goods.length,
      ways, words: chain.tags.length
    };
  }
};
