/**
 * THE LINES (D60, D61, D63, D65): how a kind becomes a different kind, in one world.
 *
 * A line is a hash graph. A child's id commits to its parents' ids and to what changed,
 * so an elder's id never moves when a descendant appears, and a child of two lines
 * simply has two parents. A node is a kind, never a body: a body is read from the land
 * and the record, keyed, the way a Director trait is.
 *
 * Code decides when, from the Director's fitness record at a regeneration. A model
 * writes the words and the law judges them; with no key an order waits and nothing
 * blocks. Numbers come from the formula: bands plus depth. A descendant stands in its
 * world's own record, never in the pack that world pinned.
 *
 * Everything hashed happens here, at the regeneration. A chunk only reads the record.
 */

import { MOB_DEFINITIONS } from '../../entities/mob/data/mobDefinitions';
import type { IDirectorRecord } from '../../entities/world/Director';
import { WebBank } from '../content/WebBank';
import { sha256Hex } from '../journal/SessionJournal';
import { Rng } from '../rng/DeterministicRNG';
import { ContentRegistry } from './ContentRegistry';
import { canonical, compileTheme, creatureIdOf, junkIdsFor } from './ThemeCompiler';
import { descendantNumbers } from './ThemeFormula';
import { ThemeLaw } from './ThemeLaw';
import { BUILDS, ILineBands, ILineChange, ILineWords, IThemePack, PACES, THREATS } from './ThemeTypes';

export type { ILineWords, ILineChange } from './ThemeTypes';

export interface ILineNode {
  id: string;
  /** The first parent gives the body. Two lines, two parents (D65). */
  parents: string[];
  change: ILineChange;
  /** The regeneration it came in at. On the record, and not in its hash. */
  bornAt: number;
}

export type LinePressure = 'thriving' | 'hunted';

/** A change code has decided on, waiting for its words. It waits as long as it must. */
export interface ILineOrder {
  id: string;
  parents: string[];
  pressure: LinePressure;
  bands: ILineBands;
  generation: number;
}

export interface ILineRecord {
  nodes: Record<string, ILineNode>;
  pending: ILineOrder[];
  /** Per kind: the pressure it last changed under. It changes again only when that has doubled. */
  spent: Record<string, number>;
  /** One per regeneration a machine saw. Two machines at one cycle compare these. */
  roots: { generation: number; root: string }[];
}

export interface ILineWorld { seed: string; themeId?: string }

export interface ILineInstall { ok: boolean; record: IDirectorRecord; id?: string; reason?: string }

/** What a model is told about one order: who this kind is, and what is already decided. */
export interface ILineAsk {
  order: string;
  pressure: LinePressure;
  bands: ILineBands;
  kind: { name: string; blurb: string; tree?: string; tags: string[]; features: string[]; lineage: string[] };
}

/** How far a kind's fitness must have moved since it last changed. Guess until Wave 12. */
const CHANGE_AT = 2;

/** What each pressure moves, in order: the first band that can still step. */
const MOVES: Record<LinePressure, (keyof ILineBands)[]> = {
  thriving: ['threat', 'build', 'pace'],
  hunted: ['build', 'pace', 'threat']
};
const LADDERS: Record<keyof ILineBands, readonly string[]> = { build: BUILDS, threat: THREATS, pace: PACES };

const registered = (tag: string) => WebBank.current().tags.some(t => t.tag === tag && !t.retired);

/** How far from where it began this kind's fitness has gone, in either direction. */
const pressureOf = (record: IDirectorRecord, id: string) => {
  const weight = record.weights[id] ?? 1;
  return weight >= 1 ? weight : 1 / weight;
};

interface IKindState {
  bands: Required<ILineBands>;
  rank: string; size: string; behavior: string; colorHex: string; tree?: string;
  tags: string[]; habitat: string[]; innate: string[];
  social?: boolean; builds?: boolean;
  name: string; blurb: string; generation: number;
  root: string; rootTags: string[]; features: string[]; lineage: string[];
}

const union = (...lists: string[][]) => [...new Set(lists.flat())];

export class CreatureLines {

  static empty(): ILineRecord {
    return { nodes: {}, pending: [], spent: {}, roots: [] };
  }

  /** The id of a kind that changed: its parents' ids and what changed, and nothing else. */
  static async childId(parents: string[], change: ILineChange): Promise<string> {
    return `mob_line_${await sha256Hex(`line:v1:${canonical({ parents, change })}`)}`;
  }

  /** The first generation and all that came after it. A count is read sector by sector, so no machine knows a kind has gone from a whole world: every line counts as living. */
  static living(pack: IThemePack, lines: ILineRecord): string[] {
    return [...pack.creatures.map(c => creatureIdOf(pack.themeId, c.key)), ...Object.keys(lines.nodes)].sort();
  }

  /** A Merkle root over a world's living lines, for one cycle: any order in, one root out. */
  static async rootOf(seed: string, generation: number, living: string[]): Promise<string> {
    let level = await Promise.all([...living].sort().map(id => sha256Hex(`leaf:${id}`)));
    while (level.length > 1) {
      const next: Promise<string>[] = [];
      for (let i = 0; i < level.length; i += 2) {
        next.push(i + 1 < level.length ? sha256Hex(`node:${level[i]}${level[i + 1]}`) : Promise.resolve(level[i]));
      }
      level = await Promise.all(next);
    }
    return sha256Hex(`root:${seed}:${generation}:${level[0] ?? ''}`);
  }

  private static async signed(lines: ILineRecord, generation: number, seed: string, pack: IThemePack): Promise<ILineRecord> {
    const root = await this.rootOf(seed, generation, this.living(pack, lines));
    return { ...lines, roots: [...lines.roots.filter(r => r.generation !== generation), { generation, root }] };
  }

  /** Which ids in a record no longer prove what they claim. */
  static async verify(lines: ILineRecord): Promise<string[]> {
    const nodes = Object.values(lines.nodes);
    const ids = await Promise.all(nodes.map(n => this.childId(n.parents, n.change)));
    return nodes.filter((n, i) => ids[i] !== n.id).map(n => n.id);
  }

  /** Who stands where, and how it was built, for every kind a pack and a record hold. */
  private static states(pack: IThemePack, lines: ILineRecord): Map<string, IKindState> {
    const compiled = ContentRegistry.compiled(pack.themeId) ?? compileTheme(pack);
    const states = new Map<string, IKindState>();
    for (const c of pack.creatures) {
      const id = creatureIdOf(pack.themeId, c.key);
      states.set(id, {
        bands: { build: c.build, threat: c.threat, pace: c.pace },
        rank: c.rank, size: c.size, behavior: c.behavior, colorHex: compiled.mobs[id].colorHex, tree: c.tree,
        tags: c.tags, habitat: c.habitat, innate: c.innate,
        social: c.social, builds: c.builds,
        name: c.name, blurb: c.blurb, generation: 1,
        root: id, rootTags: c.tags, features: [], lineage: [c.name]
      });
    }
    const resolve = (id: string): IKindState | undefined => {
      if (states.has(id)) return states.get(id);
      const node = lines.nodes[id];
      if (!node) return undefined;
      const parents = node.parents.map(resolve);
      if (parents.length === 0 || parents.some(p => !p)) return undefined;
      const known = parents as IKindState[];
      const first = known[0];
      const state: IKindState = {
        ...first,
        bands: { ...first.bands, ...node.change.bands },
        tags: union(...known.map(p => p.tags), node.change.tags),
        habitat: union(...known.map(p => p.habitat)),
        innate: union(...known.map(p => p.innate), node.change.innate),
        name: node.change.name, blurb: node.change.blurb,
        generation: 1 + Math.max(...known.map(p => p.generation)),
        features: [...first.features, ...node.change.features],
        lineage: [...first.lineage, node.change.name]
      };
      states.set(id, state);
      return state;
    };
    Object.keys(lines.nodes).forEach(resolve);
    return states;
  }

  /**
   * What fitness has earned at this regeneration. Pure: the same record and seed decide
   * the same on every machine. A kind's chance rises with how far it has moved, without
   * end, and the roll is its own so that nothing else in a world's streams shifts.
   */
  static decide(record: IDirectorRecord, seed: string, pack: IThemePack): ILineOrder[] {
    const lines = record.lines ?? this.empty();
    const states = this.states(pack, lines);
    const orders: ILineOrder[] = [];
    for (const id of this.living(pack, lines)) {
      if (record.weights[id] === undefined) continue;
      const moved = pressureOf(record, id) / (lines.spent[id] ?? 1);
      if (moved < CHANGE_AT) continue;
      if (Rng.fromKey(`lines:${seed}:${record.generation}:${id}`).next() >= 1 - 1 / moved) continue;
      const pressure: LinePressure = record.weights[id] >= 1 ? 'thriving' : 'hunted';
      const state = states.get(id);
      if (!state) continue;
      const bands: ILineBands = {};
      for (const band of MOVES[pressure]) {
        const ladder = LADDERS[band];
        const next = ladder[ladder.indexOf(state.bands[band]) + 1];
        if (next) {
          (bands as Record<string, string>)[band] = next;
          break;
        }
      }
      orders.push({ id: `order_${record.generation}_${id}`, parents: [id], pressure, bands, generation: record.generation });
    }
    return orders;
  }

  /**
   * A regeneration, after the Director has moved its weights: what changes is ordered,
   * and the living lines are signed. Worlds on a theme this machine lacks are left alone.
   */
  static async regenerate(record: IDirectorRecord, world: ILineWorld): Promise<IDirectorRecord> {
    const pack = ContentRegistry.get(world.themeId ?? ContentRegistry.defaultThemeId());
    if (!pack) return record;
    const lines = record.lines ?? this.empty();
    const orders = this.decide(record, world.seed, pack);
    const spent = { ...lines.spent };
    for (const order of orders) spent[order.parents[0]] = pressureOf(record, order.parents[0]);
    return { ...record, lines: await this.signed({ ...lines, pending: [...lines.pending, ...orders], spent }, record.generation, world.seed, pack) };
  }

  /** What a model hears about one order. It is told what is decided; it writes the rest. */
  static askFor(order: ILineOrder, pack: IThemePack, lines: ILineRecord): ILineAsk {
    const state = this.states(pack, lines).get(order.parents[0]);
    return {
      order: order.id, pressure: order.pressure, bands: order.bands,
      kind: {
        name: state?.name ?? '', blurb: state?.blurb ?? '', tree: state?.tree, tags: state?.tags ?? [],
        features: state?.features ?? [], lineage: state?.lineage ?? []
      }
    };
  }

  /**
   * Words for one order, before the law. Refused, nothing moves and the order waits.
   * Taken, the kind joins this world's record and the root is signed again.
   */
  static async install(record: IDirectorRecord, orderId: string, words: ILineWords, world: ILineWorld): Promise<ILineInstall> {
    const pack = ContentRegistry.get(world.themeId ?? ContentRegistry.defaultThemeId());
    const lines = record.lines;
    const order = lines?.pending.find(o => o.id === orderId);
    if (!pack || !lines || !order) return { ok: false, record, reason: 'Line refused whole: nothing is waiting under that order.' };
    const elders = [...pack.creatures.map(c => c.name), ...Object.values(lines.nodes).map(n => n.change.name)];
    const verdict = ThemeLaw.validateLine(words, pack, elders, registered);
    if (!verdict.ok) return { ok: false, record, reason: verdict.reason };

    const { name, blurb, tags, features, innate } = words;
    const change: ILineChange = { name: name.trim(), blurb: blurb.trim(), tags, features, innate, bands: order.bands };
    const id = await this.childId(order.parents, change);
    const next: ILineRecord = {
      ...lines,
      nodes: { ...lines.nodes, [id]: { id, parents: order.parents, change, bornAt: record.generation } },
      pending: lines.pending.filter(o => o.id !== orderId)
    };
    return { ok: true, id, record: { ...record, lines: await this.signed(next, record.generation, world.seed, pack) } };
  }

  /** A batch back from the door: what passes stands, and what does not waits for the next window (D69). */
  static async settle(record: IDirectorRecord, data: unknown, world: ILineWorld) {
    const installed: string[] = [];
    const refused: { order: string; reason: string }[] = [];
    let at = record;
    const entries = (data as { lines?: unknown } | null | undefined)?.lines;
    for (const entry of Array.isArray(entries) ? entries : []) {
      const words = entry as ILineWords & { order?: unknown };
      const result = await this.install(at, String(words?.order ?? ''), words, world);
      if (result.ok) {
        at = result.record;
        installed.push(result.id!);
      } else {
        refused.push({ order: String(words?.order ?? ''), reason: result.reason ?? '' });
      }
    }
    return { record: at, installed, refused };
  }

  /** The definitions a record's kinds read as. Pure, and only what can prove itself comes in. */
  static compile(pack: IThemePack, lines: ILineRecord): Record<string, unknown> {
    const compiled = ContentRegistry.compiled(pack.themeId) ?? compileTheme(pack);
    const abilityId = new Map(Object.values(compiled.abilities).map(a => [a.key, a.id]));
    const states = this.states(pack, lines);
    const defs: Record<string, unknown> = {};
    for (const id of Object.keys(lines.nodes)) {
      const s = states.get(id);
      if (!s) continue;
      defs[id] = {
        id, name: s.name,
        // Beside its theme and not in it: no world's spawn pool reads this kind, only its own world's record does
        themeId: `${pack.themeId}/lines`,
        tags: s.tags, rank: s.rank, size: s.size, behavior: s.behavior, colorHex: s.colorHex,
        habitat: s.habitat, innate: s.innate.map(k => abilityId.get(k)!),
        generation: s.generation,
        line: { root: s.root, rootTags: s.rootTags, features: s.features },
        ...(s.tree ? { tree: s.tree } : {}),
        // D93, D99: what it was, it still is: a herd stays a herd, and it leaves what its tags leave
        ...(s.social !== undefined ? { social: s.social } : {}),
        ...(s.builds !== undefined ? { builds: s.builds } : {}),
        ...(pack.junk ? { junk: junkIdsFor(pack, s.tags) } : {}),
        ...descendantNumbers({ rank: s.rank, size: s.size, ...s.bands } as Parameters<typeof descendantNumbers>[0], s.generation)
      };
    }
    return defs;
  }

  /** On opening a world: its kinds join the tables everything reads. A hash that fails stays out, with what hangs from it. */
  static async define(record: IDirectorRecord, themeId?: string): Promise<void> {
    const lines = record.lines;
    const pack = ContentRegistry.get(themeId ?? ContentRegistry.defaultThemeId());
    if (!lines || !pack || Object.keys(lines.nodes).length === 0) return;
    const bad = new Set(await this.verify(lines));
    if (bad.size > 0) console.warn(`[LINES] ${bad.size} kinds in this record do not prove themselves, and were left out.`);
    const nodes = Object.fromEntries(Object.entries(lines.nodes).filter(([id]) => !bad.has(id)));
    Object.assign(MOB_DEFINITIONS, this.compile(pack, { ...lines, nodes }));
  }
}
