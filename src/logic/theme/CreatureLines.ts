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
 * blocks: the change stands at once on plain words (D69), and the words take its place
 * when they come. Numbers come from the formula: bands plus depth. A descendant stands
 * in its world's own record, never in the pack that world pinned, and so does what the
 * world grows (D64).
 *
 * Everything hashed happens here, at the regeneration. A chunk only reads the record.
 */

import { MOB_DEFINITIONS } from '../../entities/mob/data/mobDefinitions';
import type { IDirectorRecord } from '../../entities/world/Director';
import { WebBank } from '../content/WebBank';
import { sha256Hex } from '../journal/SessionJournal';
import { Rng } from '../rng/DeterministicRNG';
import { ContentRegistry } from './ContentRegistry';
import { canonical, compileTheme, creatureIdOf, junkIdsFor, keyIdsOf } from './ThemeCompiler';
import { creatureNumbers, descendantNumbers } from './ThemeFormula';
import { ThemeLaw } from './ThemeLaw';
import { BUILDS, ILineBands, ILineChange, ILineWords, IThemePack, LINE_FEATURES, PACES, THREATS } from './ThemeTypes';
import { IGrownBatch, IThemeGrowth, WorldGrowth } from './WorldGrowth';

export type { ILineWords, ILineChange } from './ThemeTypes';

export interface ILineNode {
  id: string;
  /** The first parent gives the body. Two lines, two parents (D65). */
  parents: string[];
  change: ILineChange;
  /** The regeneration it came in at. On the record, and not in its hash. */
  bornAt: number;
  /** D69: the order it stands in for until that order's words come. Not in its hash. */
  plain?: string;
  /** The plain kind these words took the place of, so bodies counted under it can follow. Not in its hash. */
  was?: string;
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
  /** D64: what this world has grown. Absent means nothing has. */
  grown?: IGrownBatch[];
  /** Growth code has rolled for, waiting for its words. */
  growing?: IGrowthOrder[];
  /** D65: what was brought in from other maps. It changes this map's root and never its pack. */
  foreign?: Record<string, IForeignBranch>;
}

/**
 * D55, D65: a kind, and everything that proves it. Each node's id is the hash of its parents and
 * what changed, so a changed word fails. The definition goes with it for a map that has never
 * heard of its theme. Where this machine holds the theme, the numbers are checked against it;
 * where it does not, only the digest stands behind them until something signs it (Wave 13).
 */
export interface ILineProof {
  kind: string;
  worldSeed: string;
  themeId: string;
  /** Every node behind this kind, parents before children. */
  nodes: ILineNode[];
  /** The first generations it comes from. */
  roots: string[];
  def: Record<string, unknown>;
  /** What sets its numbers, from the formula, for whatever comes from it next. */
  bands?: ILineBands;
  digest?: string;
}

/** A branch from another map, on this map's record. */
export interface IForeignBranch {
  id: string;
  kind: string;
  proof: ILineProof;
  arrivedAt: number;
  ground: string;
}

/** A regeneration people fought through has rolled to grow. What came of it is the model's to say. */
export interface IGrowthOrder {
  id: string;
  generation: number;
  /** Per kind: how it fared in that regeneration. */
  tally: { id: string; felled: number; fell: number }[];
}

/** What a model is told about one growth order. */
export interface IGrowthAsk {
  order: string;
  generation: number;
  happened: { kind: string; felled: number; fell: number }[];
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

  /** The first generation, what grew since, and all that came after them. A count is read sector by sector, so no machine knows a kind has gone from a whole world: every line counts as living. */
  static living(pack: IThemePack, lines: ILineRecord): string[] {
    const grown = (lines.grown ?? []).flatMap(b => b.growth.creatures.map(c => creatureIdOf(b.scope, c.key)));
    return [...pack.creatures.map(c => creatureIdOf(pack.themeId, c.key)), ...grown, ...Object.keys(lines.nodes), ...Object.keys(lines.foreign ?? {})].sort();
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

  /**
   * The scope a batch's ids hang from: its words and its world, so the same words in two
   * worlds stand apart. The "z" sorts it after every pinned id, because a chunk's pools
   * are read in id order and a world's first timber should stay its first.
   */
  static async scopeOf(seed: string, growth: IThemeGrowth): Promise<string> {
    return `theme_z${(await sha256Hex(`grown:v1:${seed}:${canonical(growth)}`)).slice(0, 23)}`;
  }

  /** Which grown batches no longer prove what they claim. */
  static async verifyGrown(lines: ILineRecord, seed: string): Promise<string[]> {
    const batches = lines.grown ?? [];
    const scopes = await Promise.all(batches.map(b => this.scopeOf(seed, b.growth)));
    return batches.filter((b, i) => scopes[i] !== b.scope).map(b => b.scope);
  }

  /** Who stands where, and how it was built, for every kind a pack and a record hold. */
  private static states(pack: IThemePack, lines: ILineRecord): Map<string, IKindState> {
    const compiled = ContentRegistry.compiled(pack.themeId) ?? compileTheme(pack);
    const states = new Map<string, IKindState>();
    const elder = (c: IThemePack['creatures'][number], id: string, colorHex: string) => states.set(id, {
      bands: { build: c.build, threat: c.threat, pace: c.pace },
      rank: c.rank, size: c.size, behavior: c.behavior, colorHex, tree: c.tree,
      tags: c.tags, habitat: c.habitat, innate: c.innate,
      social: c.social, builds: c.builds,
      name: c.name, blurb: c.blurb, generation: 1,
      root: id, rootTags: c.tags, features: [], lineage: [c.name]
    });
    for (const c of pack.creatures) {
      const id = creatureIdOf(pack.themeId, c.key);
      elder(c, id, compiled.mobs[id].colorHex);
    }
    // What a world grew is a first generation of its own, and can change like any other
    const grown = lines.grown ?? [];
    WorldGrowth.compile(pack, lines).forEach((batch, i) => {
      for (const c of grown[i].growth.creatures) {
        const id = creatureIdOf(grown[i].scope, c.key);
        elder(c, id, batch.mobs[id].colorHex);
      }
    });
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
      if (lines.nodes[id]?.plain) continue; // its id moves when its words come, so nothing may hang from it yet
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

  /**
   * D69: the change stands at once, on plain words, so a world with no key keeps growing.
   * Keyed and pure: every machine stands the same kind and signs the same root.
   */
  static async standPlain(record: IDirectorRecord, world: ILineWorld): Promise<IDirectorRecord> {
    const pack = ContentRegistry.get(world.themeId ?? ContentRegistry.defaultThemeId());
    const lines = record.lines;
    if (!pack || !lines) return record;
    const standing = new Set(Object.values(lines.nodes).map(n => n.plain));
    const bare = lines.pending.filter(o => !standing.has(o.id));
    if (bare.length === 0) return record;
    const states = this.states(pack, lines);
    const nodes = { ...lines.nodes };
    for (const order of bare) {
      const parent = states.get(order.parents[0]);
      if (!parent) continue;
      const change: ILineChange = {
        name: `${parent.name}, as of regeneration ${order.generation}`,
        blurb: `It changed at regeneration ${order.generation}. The words for it have not come.`,
        tags: [], innate: [], bands: order.bands,
        features: [Rng.fromKey(`plain:${world.seed}:${order.id}`).pick([...LINE_FEATURES])]
      };
      const id = await this.childId(order.parents, change);
      nodes[id] = { id, parents: order.parents, change, bornAt: order.generation, plain: order.id };
    }
    return { ...record, lines: await this.signed({ ...lines, nodes }, record.generation, world.seed, pack) };
  }

  /** The chance a regeneration grows something: how much happened in it, without end. */
  static rollGrowth(seed: string, generation: number, happened: number): boolean {
    return Rng.fromKey(`growth:${seed}:${generation}`).next() < 1 - 1 / (1 + happened);
  }

  /**
   * Compute's half of growth: what a regeneration's fights earned, read from the record
   * before they were folded. Nobody touched it, nothing grows. It waits for its words.
   */
  static async orderGrowth(record: IDirectorRecord, before: Pick<IDirectorRecord, 'felled' | 'fell'>, world: ILineWorld, generation: number): Promise<IDirectorRecord> {
    const lines = record.lines ?? this.empty();
    const id = `growth_${generation}`;
    if ((lines.growing ?? []).some(o => o.id === id) || (lines.grown ?? []).some(b => b.order === id)) return record;
    const seen = [...new Set([...Object.keys(before.felled), ...Object.keys(before.fell)])].sort();
    const tally = seen.map(kind => ({ id: kind, felled: before.felled[kind] ?? 0, fell: before.fell[kind] ?? 0 }));
    const happened = tally.reduce((sum, t) => sum + t.felled + t.fell, 0);
    if (happened === 0 || !this.rollGrowth(world.seed, generation, happened)) return record;
    return { ...record, lines: { ...lines, growing: [...(lines.growing ?? []), { id, generation, tally }] } };
  }

  /** What a model hears about one growth order: what happened there, under the names the world knows. */
  static askForGrowth(order: IGrowthOrder, pack: IThemePack, lines: ILineRecord): IGrowthAsk {
    const states = this.states(pack, lines);
    return {
      order: order.id, generation: order.generation,
      happened: order.tally.map(t => ({ kind: states.get(t.id)?.name ?? 'something unnamed', felled: t.felled, fell: t.fell }))
    };
  }

  /**
   * Words for a growth order, before the law. Refused whole and it waits; empty and
   * nothing grew, which is an answer. Never throws on junk.
   */
  static async settleGrowth(record: IDirectorRecord, data: unknown, world: ILineWorld) {
    const answer = (data ?? {}) as Partial<IThemeGrowth> & { order?: unknown };
    const orderId = String(answer.order ?? '');
    const pinned = ContentRegistry.get(world.themeId ?? ContentRegistry.defaultThemeId());
    const lines = record.lines;
    const order = lines?.growing?.find(o => o.id === orderId);
    const no = (reason: string) => ({ record, installed: [] as string[], refused: [{ order: orderId, reason }] });
    if (!pinned || !lines || !order) return no('Growth refused whole: nothing is waiting under that order.');
    const lists = ['creatures', 'materials', 'affixes', 'abilities', 'lore'] as const;
    if (lists.some(k => !Array.isArray(answer[k]))) return no('Growth refused whole: it is missing a list.');
    if (answer.tags !== undefined && (!Array.isArray(answer.tags) || answer.tags.length > 0)) {
      return no('Growth refused whole: it brings a word of its own. A world grows in the words the web already holds.');
    }
    const growth: IThemeGrowth = {
      creatures: answer.creatures!, materials: answer.materials!, affixes: answer.affixes!,
      abilities: answer.abilities!, lore: answer.lore!, tags: []
    };
    const waiting = lines.growing!.filter(o => o.id !== order.id);
    if (WorldGrowth.isEmpty(growth)) {
      return { record: { ...record, lines: { ...lines, growing: waiting } }, installed: [] as string[], refused: [] };
    }
    let verdict: { ok: boolean; reason?: string };
    try {
      verdict = ContentRegistry.judge(WorldGrowth.grownBody(WorldGrowth.packWith(pinned, lines), growth));
    } catch {
      return no('Growth refused whole: what came back is not in the shape of a pack.');
    }
    if (!verdict.ok) return no(verdict.reason ?? 'Growth refused whole.');
    const scope = await this.scopeOf(world.seed, growth);
    const next: ILineRecord = {
      ...lines, growing: waiting,
      grown: [...(lines.grown ?? []), { scope, order: order.id, bornAt: record.generation, growth }]
    };
    return { record: { ...record, lines: await this.signed(next, record.generation, world.seed, pinned) }, installed: [scope], refused: [] };
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
    const reads = WorldGrowth.packWith(pack, lines);
    const elders = [...reads.creatures.map(c => c.name), ...Object.values(lines.nodes).map(n => n.change.name)];
    const verdict = ThemeLaw.validateLine(words, reads, elders, registered);
    if (!verdict.ok) return { ok: false, record, reason: verdict.reason };

    const { name, blurb, tags, features, innate } = words;
    const change: ILineChange = { name: name.trim(), blurb: blurb.trim(), tags, features, innate, bands: order.bands };
    const id = await this.childId(order.parents, change);
    // The words take the plain kind's place, and what it earned while it stood comes with them
    const plain = Object.values(lines.nodes).find(n => n.plain === orderId);
    const nodes = { ...lines.nodes };
    if (plain) delete nodes[plain.id];
    const next: ILineRecord = {
      ...lines,
      nodes: { ...nodes, [id]: { id, parents: order.parents, change, bornAt: record.generation, ...(plain ? { was: plain.id } : {}) } },
      pending: lines.pending.filter(o => o.id !== orderId)
    };
    const moved = plain ? this.carried(record, plain.id, id) : record;
    return { ok: true, id, record: { ...moved, lines: await this.signed(next, record.generation, world.seed, pack) } };
  }

  /** A kind's standing, moved from one id to another. */
  private static carried(record: IDirectorRecord, from: string, to: string): IDirectorRecord {
    const shift = (table: Record<string, number>) => {
      if (table[from] === undefined) return table;
      const { [from]: value, ...rest } = table;
      return { ...rest, [to]: value };
    };
    return { ...record, felled: shift(record.felled), fell: shift(record.fell), weights: shift(record.weights) };
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

  // -------------------------------------------------------------------------
  // THE PROOF OF A LINE (D55, D65; line 117)
  // -------------------------------------------------------------------------

  /** A kind in a record, as what can leave this map and prove itself elsewhere. Undefined for what this machine cannot read. */
  static proofOf(record: IDirectorRecord | null, world: ILineWorld, kind: string): ILineProof | undefined {
    const lines = record?.lines ?? this.empty();
    // What came here from elsewhere goes on with the proof it came with
    const arrived = Object.values(lines.foreign ?? {}).find(b => b.kind === kind);
    if (arrived) return arrived.proof;
    const pack = ContentRegistry.get(world.themeId ?? ContentRegistry.defaultThemeId());
    const nodes: ILineNode[] = [];
    const roots = new Set<string>();
    const seen = new Set<string>();
    const walk = (id: string) => {
      if (seen.has(id)) return;
      seen.add(id);
      const node = lines.nodes[id];
      if (!node) { roots.add(id); return; }
      node.parents.forEach(walk);
      nodes.push(node);
    };
    walk(kind);
    const compiled = pack ? this.compile(pack, lines) : {};
    const def = (MOB_DEFINITIONS[kind] as unknown as Record<string, unknown> | undefined) ?? (compiled[kind] as Record<string, unknown> | undefined);
    if (!def) return undefined;
    const bands = pack ? this.states(pack, lines).get(kind)?.bands : undefined;
    return { kind, worldSeed: world.seed, themeId: pack?.themeId ?? world.themeId ?? '', nodes, roots: [...roots].sort(), def: JSON.parse(JSON.stringify(def)), ...(bands ? { bands } : {}) };
  }

  /** The proof with its definition's digest on it, for a map that cannot check the numbers itself. */
  static async sealProof(proof: ILineProof): Promise<ILineProof> {
    return { ...proof, digest: await sha256Hex(`def:v1:${canonical(proof.def)}`) };
  }

  /** The numbers a proof's line makes, where this machine holds its theme; undefined where it does not. */
  private static lineNumbers(proof: ILineProof): Record<string, unknown> | undefined {
    const pack = ContentRegistry.get(proof.themeId);
    if (!pack) return undefined;
    const nodes = Object.fromEntries(proof.nodes.map(n => [n.id, n]));
    const compiled = ContentRegistry.compiled(pack.themeId) ?? compileTheme(pack);
    const lines = { ...this.empty(), nodes };
    return (compiled.mobs[proof.kind] ?? this.compile(pack, lines)[proof.kind]) as Record<string, unknown> | undefined;
  }

  /** The fields the formula writes on a kind, which a proof can only carry, never choose. */
  static readonly FORMULA_FIELDS = ['baseHealth', 'baseDamage'] as const;

  /** Whether a proof's line, its definition and its digest hold, before its numbers are looked at. */
  private static async lineProblem(proof: ILineProof): Promise<string | null> {
    const known = new Set(proof.roots);
    for (const node of proof.nodes) {
      if (node.parents.some(p => !known.has(p))) return 'Its line has a gap in it.';
      if ((await this.childId(node.parents, node.change)) !== node.id) return 'Its line does not prove itself.';
      known.add(node.id);
    }
    if (!known.has(proof.kind) || proof.roots.length === 0) return 'Its line does not reach what it claims to be.';
    if (proof.def.id !== proof.kind) return 'Its definition is of something else.';
    if (proof.digest && proof.digest !== await sha256Hex(`def:v1:${canonical(proof.def)}`)) return 'Its definition has been changed.';
    return null;
  }

  /** Whether a proof proves what it claims. */
  static async verifyProof(proof: ILineProof): Promise<{ ok: boolean; reason?: string }> {
    const problem = await this.lineProblem(proof);
    if (problem) return { ok: false, reason: problem };
    // Where this machine holds the theme, the numbers come from the formula and nothing else
    const own = this.lineNumbers(proof);
    if (own && this.FORMULA_FIELDS.some(f => own[f] !== proof.def[f])) return { ok: false, reason: 'Its numbers are not what its line makes them.' };
    return { ok: true };
  }

  /**
   * A proof put right where it can be (Pedro, 2026-11-04: "we serve the corrected atom... the diff,
   * never the full load"). A line that does not prove itself cannot be put right and is refused;
   * numbers that are not what the line makes are replaced with the formula's, and each change is
   * named. A proof whose theme this machine does not hold is taken as it stands.
   */
  static async correctProof(proof: ILineProof): Promise<
    { ok: true; reason?: undefined; def: Record<string, unknown>; changes: { field: string; had: unknown; value: unknown }[] } | { ok: false; reason: string; def?: undefined; changes?: undefined }
  > {
    const problem = await this.lineProblem(proof);
    if (problem) return { ok: false, reason: problem };
    const own = this.lineNumbers(proof);
    const changes = own ? this.FORMULA_FIELDS.filter(f => own[f] !== proof.def[f]).map(f => ({ field: f as string, had: proof.def[f], value: own[f] })) : [];
    const def = changes.reduce<Record<string, unknown>>((d, c) => ({ ...d, [c.field]: c.value }), { ...proof.def });
    return { ok: true, def, changes };
  }

  /**
   * D65: a body from another map joins this one. Its branch goes on the record, which moves the
   * signed root and leaves the pack alone. A proof that fails changes nothing.
   */
  static async arrive(record: IDirectorRecord, world: ILineWorld, proof: ILineProof, ground: string): Promise<ILineInstall> {
    const pack = ContentRegistry.get(world.themeId ?? ContentRegistry.defaultThemeId());
    if (!pack) return { ok: false, record, reason: 'This machine cannot read this map\'s theme.' };
    const verdict = await this.verifyProof(proof);
    if (!verdict.ok) return { ok: false, record, reason: verdict.reason };
    const lines = record.lines ?? this.empty();
    const id = `mob_foreign_${(await sha256Hex(`foreign:v1:${canonical({ kind: proof.kind, from: proof.worldSeed, nodes: proof.nodes.map(n => n.id) })}`)).slice(0, 32)}`;
    const branch: IForeignBranch = { id, kind: proof.kind, proof, arrivedAt: record.generation, ground };
    return {
      ok: true, id,
      record: { ...record, lines: await this.signed({ ...lines, foreign: { ...lines.foreign, [id]: branch } }, record.generation, world.seed, pack) }
    };
  }

  /**
   * A child of two lines: two parents in its hash, and it proves both. The first parent gives the
   * body, as in any line, and its numbers come from the formula. A pen asks no model: it stands
   * on plain words, like any change whose words have not come.
   */
  static async crossed(a: ILineProof, b: ILineProof, key: string, bornAt: number): Promise<ILineProof> {
    const change: ILineChange = {
      name: 'Crossbred contact',
      blurb: 'Two lines in one pen, and this is what came of it. The words for it have not come.',
      tags: [], innate: [], bands: {},
      features: [Rng.fromKey(`cross:${key}`).pick([...LINE_FEATURES])]
    };
    const parents = [a.kind, b.kind];
    const id = await this.childId(parents, change);
    const child: ILineNode = { id, parents, change, bornAt };
    const seen = new Set<string>();
    const nodes = [...a.nodes, ...b.nodes].filter(n => !seen.has(n.id) && !!seen.add(n.id));
    const generation = 1 + Math.max(Number(a.def.generation ?? 1), Number(b.def.generation ?? 1));
    const bands = a.bands ?? { build: 'sturdy', threat: 'sharp', pace: 'steady' };
    const list = (d: Record<string, unknown>, field: string) => (Array.isArray(d[field]) ? d[field] as string[] : []);
    const line = a.def.line as { root?: string; rootTags?: string[]; features?: string[] } | undefined;
    const def: Record<string, unknown> = {
      ...a.def, id, name: change.name,
      tags: union(list(a.def, 'tags'), list(b.def, 'tags')),
      habitat: union(list(a.def, 'habitat'), list(b.def, 'habitat')),
      innate: union(list(a.def, 'innate'), list(b.def, 'innate')),
      generation,
      line: { root: line?.root ?? a.kind, rootTags: line?.rootTags ?? list(a.def, 'tags'), features: [...(line?.features ?? []), ...change.features] },
      ...descendantNumbers({ rank: a.def.rank, size: a.def.size, ...bands } as Parameters<typeof creatureNumbers>[0], generation)
    };
    return {
      kind: id, worldSeed: a.worldSeed, themeId: a.themeId,
      nodes: [...nodes, child], roots: [...new Set([...a.roots, ...b.roots])].sort(),
      def, bands
    };
  }

  /** The definitions a record's kinds read as. Pure, and only what can prove itself comes in. */
  static compile(pack: IThemePack, lines: ILineRecord): Record<string, unknown> {
    const scoped = (lines.grown ?? []).flatMap(b => [...keyIdsOf({ themeId: b.scope, materials: [], goods: [], stations: [], abilities: b.growth.abilities })]);
    const abilityId = new Map([...keyIdsOf(pack), ...scoped]);
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
    if (!lines || !pack) return;
    ContentRegistry.defineGrowth(pack, lines);
    if (Object.keys(lines.nodes).length > 0) {
      const bad = new Set(await this.verify(lines));
      if (bad.size > 0) console.warn(`[LINES] ${bad.size} kinds in this record do not prove themselves, and were left out.`);
      const nodes = Object.fromEntries(Object.entries(lines.nodes).filter(([id]) => !bad.has(id)));
      Object.assign(MOB_DEFINITIONS, this.compile(pack, { ...lines, nodes }));
    }
    // What was brought in stands by the proof it carries, and a proof that fails stays out
    for (const branch of Object.values(lines.foreign ?? {})) {
      if (MOB_DEFINITIONS[branch.kind]) continue;
      if ((await this.verifyProof(branch.proof)).ok) Object.assign(MOB_DEFINITIONS, { [branch.kind]: branch.proof.def });
    }
  }
}
