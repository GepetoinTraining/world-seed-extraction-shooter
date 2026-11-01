/**
 * THE GROUND A LEADER HOLDS (D62, D93): what a seat, its bands and its buildings are on the record.
 *
 * A record over the land, read by a chunk the way it reads the Director. The land stays a pure
 * function of the seed, and a world nobody touched holds none of this. Every step is pure and keyed,
 * so two machines reading the same record agree, and cycles nobody watched fold one at a time.
 *
 * Two roads to a boss, through this one record. People keep falling to a social elite, and it takes
 * the ground it stands on, its pack its first band. Or an elite on `settle` finishes a base on
 * ground holding what its skill works. A seat by a challenge reads the register (`Koseki.nextHead`).
 *
 * What a model may write is a plan's words (`LeaderPlan`). Whether a thing is possible and what it
 * costs is here and in the formula, and with no plan the donor's rule picks, so nothing blocks.
 * A territory stops at its sector's edge for now, as herds do: Pedro, 2026-11-01, "herds can cross
 * sectors, but that comes with the unified sector mapping".
 */

import { IAttributes, UniversalRank } from '../../../types';
import { Rng } from '../../logic/rng/DeterministicRNG';
import { DecisionLayer, WEEK_MS } from '../../logic/systems/DecisionLayer';
import { TERRITORY_NUMBERS, anchorsFor, postHealth, rankStep, structureBill } from '../../logic/theme/ThemeFormula';
import { defaultSheet, SYSTEM_TEMPLATES, templateBill } from '../hub/template';
import { ItemFactory } from '../item/ItemFactory';
import { BIOME_RESOURCES, RESOURCE_DEFINITIONS } from '../item/data/resourceDefinitions';
import { MOB_DEFINITIONS } from '../mob/data/mobDefinitions';
import { CHUNK_TILES, tileCenter, CHUNK_PX, SECTOR_CHUNKS } from './grid';
import { IKoseki, Koseki } from './Koseki';
import { Goal, Leaders, isRosterElite } from './Leaders';
import type { ILandCell, ILeaderState, IPopulationRecord, ISectorState } from './Population';
import { TerrainSystem } from './TerrainSystem';
import { EntityType, IChunk, IEntityOrders, IHoldingOnEntity, IWorldEntity } from './types';
import { IWard, IWardSlot } from './Wards';
import { IGenerationContext, WorldGenerator } from './WorldGenerator';
import { Rarity } from '../../../types';

/** A word with a reader. A plan naming anything else is refused (`LeaderPlan`). */
export const VERBS = ['claim', 'raise', 'muster', 'hunt', 'raid', 'migrate'] as const;
export type Verb = typeof VERBS[number];

export type StructureFn = 'watch' | 'wall' | 'store' | 'works' | 'muster' | 'anchor' | 'seat';

export interface IStructure {
  id: string;
  fn: StructureFn;
  at: string;
  /** What paid for it, so a wall is drawn from it. */
  material?: string;
  paid: number;
  bill: number;
  startedAt: number;
  /** Absent while it is scaffolding. */
  builtAt?: number;
}

export interface IStandingOrders {
  posture: IEntityOrders['posture'];
  alarmCalls: boolean;
  /** Which ground each band holds. */
  bands: Record<string, string>;
}

export interface IDecisionEntry {
  generation: number;
  verb: Verb;
  grade: 'bad' | 'poor' | 'good' | 'great';
  /** The words a plan gave it. Absent when the code's own rule picked. */
  name?: string;
}

export interface ITerritory {
  seat: string;
  since: number;
  chunks: string[];
  structures: IStructure[];
  /** What the base has worked, by material. Food and stores limit a base, not a count. */
  stores: Record<string, number>;
  orders: IStandingOrders;
  /** Which structure comes next, so an id is never used twice. */
  raised: number;
  /** Set when it became a boss. An elite with a camp has ground and no ward. */
  bossAt?: number;
  log: IDecisionEntry[];
}

interface IKindDef { id: string; rank: UniversalRank; size?: string; habitat?: string[]; social?: boolean; builds?: boolean; leads?: string; tree?: string; tags?: string[]; behavior?: string }

const defOf = (id: string) => MOB_DEFINITIONS[id] as unknown as IKindDef | undefined;
const keyOf = (cx: number, cy: number) => `${cx},${cy}`;
const partsOf = (ground: string) => ground.split(',').map(Number) as [number, number];
const apart = (a: string, b: string) => {
  const [ax, ay] = partsOf(a), [bx, by] = partsOf(b);
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
};
const standingIds = /^(lead_-?\d+_-?\d+_\d+(?:_(?:h|w)\d+)*)_s\d+(?:_w\d+)?$/;
const LOG_KEPT = 12;
/** A wall's run, in tiles, with a way through at its middle. */
const WALL_RUN = 9;
/** What a cycle's length is read as, where a context does not say: a day, the shortest a test needs. */
const DEFAULT_CYCLE_MS = WEEK_MS / 7;
const POSTURE: Record<string, IEntityOrders['posture']> = {
  cruel: 'sortie', zealous: 'sortie', proud: 'sortie', patient: 'hold', greedy: 'hold', cautious: 'fall_back'
};

/** What raising a seat costs: the largest plan the hub has, read through the hub's own bill. */
let seatBase: number | undefined;
const seatBillBase = () => {
  if (seatBase === undefined) {
    seatBase = Math.max(...SYSTEM_TEMPLATES.map(plan => {
      const bill = templateBill(plan, defaultSheet(plan));
      return [...bill.choices, ...bill.tagLines].reduce((sum, line) => sum + line.count, 0);
    }));
  }
  return seatBase;
};

/** What one cycle of one sector has to work with. Its `leaders` is the working copy. */
export interface ICycle {
  seed: string;
  sx: number;
  sy: number;
  g: number;
  land: Map<string, ILandCell>;
  counts: ISectorState['ground'];
  leaders: ISectorState['leaders'];
  koseki: NonNullable<ISectorState['koseki']>;
  record: Pick<IPopulationRecord, 'down' | 'seen' | 'plans' | 'taken'>;
  context: IGenerationContext;
}

const registerOf = (leader: ILeaderState) => leader.register ?? leader.id.replace(/_h\d+$/, '');
const totalOf = (stores: Record<string, number>) => Object.values(stores).reduce((sum, n) => sum + n, 0);
const anchorPosts = (t: ITerritory) => t.structures.filter(s => s.fn === 'anchor' && s.builtAt !== undefined);
const bandsOf = (cycle: Pick<ICycle, 'leaders'>, id: string) =>
  Object.keys(cycle.leaders).sort().map(k => cycle.leaders[k]).filter(l => l.alive && l.answersTo === id);
const heldElsewhere = (leaders: ISectorState['leaders'], id?: string) => {
  const held = new Set<string>();
  for (const l of Object.values(leaders)) if (l.alive && l.id !== id && l.territory) l.territory.chunks.forEach(c => held.add(c));
  return held;
};

export class Territory {

  static isStructure(entityId: string): boolean {
    return standingIds.test(entityId);
  }

  /** A base begun: one chunk, nothing standing, and what it arrived with. */
  static camp(at: string, g: number, stores: Record<string, number> = {}): ITerritory {
    return { seat: at, since: g, chunks: [at], structures: [], stores: { ...stores }, orders: { posture: 'hold', alarmCalls: true, bands: {} }, raised: 0, log: [] };
  }

  // -------------------------------------------------------------------------
  // SETTLING BY TRADE (D62)
  // -------------------------------------------------------------------------

  /** What a ground yields of a trade: how many of its materials answer. Read from the land alone. */
  private static tradeYield(seed: string, cx: number, cy: number, trade: string[], context: IGenerationContext): number {
    const allowed = BIOME_RESOURCES[WorldGenerator.biomeAt(seed, cx, cy)] ?? [];
    return (context.resourceDefinitions as { id: string; tags?: string[] }[])
      .filter(r => allowed.includes(r.id) && (r.tags ?? []).some(t => trade.includes(t))).length;
  }

  /** The ground in this sector that best holds what a trade works, and is nobody else's. Keys settle a tie. */
  static bestGround(seed: string, sx: number, sy: number, trade: string[], taken: Set<string>, context: IGenerationContext): string | undefined {
    let best: string | undefined, most = 0;
    for (let y = 0; y < SECTOR_CHUNKS; y++) for (let x = 0; x < SECTOR_CHUNKS; x++) {
      const cx = sx * SECTOR_CHUNKS + x, cy = sy * SECTOR_CHUNKS + y, key = keyOf(cx, cy);
      if (taken.has(key)) continue;
      const yielded = this.tradeYield(seed, cx, cy, trade, context);
      if (yielded > most) { most = yielded; best = key; }
    }
    return best;
  }

  /** One step towards a ground, across what this kind can stand on. */
  static stepTowards(cell: ILandCell, target: string, land: Map<string, ILandCell>, canStand: (c: ILandCell) => boolean): string | undefined {
    const open = cell.beside.map(k => land.get(k)!).filter(canStand);
    if (open.length === 0) return undefined;
    return open.reduce((best, c) => (apart(c.key, target) < apart(best.key, target) ? c : best)).key;
  }

  // -------------------------------------------------------------------------
  // A BOSS
  // -------------------------------------------------------------------------

  private static fallsBy(context: IGenerationContext, id: string, g: number): number {
    return (context.director?.bodies?.[id]?.felledAt ?? []).filter(at => at <= g).length;
  }

  /** Where anchors stand: spread past a shot's reach of each other and the seat, on ground the kind can stand on first. */
  private static anchorGrounds(cycle: ICycle, seat: string, need: number, def: IKindDef, also: string[]): string[] {
    const elsewhere = heldElsewhere(cycle.leaders);
    const rng = Rng.fromKey(`${cycle.seed}:anchors:${seat}:${cycle.g}`);
    const cells = [...cycle.land.values()].sort((a, b) => (a.key < b.key ? -1 : 1));
    for (let i = cells.length - 1; i > 0; i--) {
      const j = rng.int(0, i + 1);
      [cells[i], cells[j]] = [cells[j], cells[i]];
    }
    const stands = (c: ILandCell) => (!def.habitat || def.habitat.includes(c.biome));
    const ordered = [...cells.filter(stands), ...cells.filter(c => !stands(c))];
    const chosen: string[] = [];
    for (const cell of ordered) {
      if (chosen.length >= need) break;
      if (elsewhere.has(cell.key) && !also.includes(cell.key)) continue;
      if ([seat, ...also, ...chosen].every(k => apart(k, cell.key) >= TERRITORY_NUMBERS.spreadChunks)) chosen.push(cell.key);
    }
    return chosen;
  }

  /** The chunks along a straight walk between two grounds, so a holding is one place. */
  private static walkBetween(from: string, to: string): string[] {
    const [ax, ay] = partsOf(from), [bx, by] = partsOf(to);
    const out: string[] = [];
    for (let x = ax; x !== bx; x += Math.sign(bx - ax)) out.push(keyOf(x, ay));
    for (let y = ay; y !== by; y += Math.sign(by - ay)) out.push(keyOf(bx, y));
    out.push(to);
    return out;
  }

  /** A band takes up its own ground, on the register, with a share of what walks behind the boss. */
  private static enlist(cycle: ICycle, boss: ILeaderState, ground: string, share: number): ILeaderState {
    const key = registerOf(boss);
    const sectorKey = `${cycle.sx},${cycle.sy}`;
    let register: IKoseki = cycle.koseki[key] ?? Koseki.found(sectorKey, boss.id, boss.kind, boss.territory?.since ?? cycle.g);
    const id = `${key}_h${register.entries.length}`;
    register = Koseki.bear(register, id, boss.kind, [boss.id], cycle.g);
    cycle.koseki[key] = register;
    const band: ILeaderState = { id, kind: boss.kind, at: ground, pack: share, goal: 'hold' as Goal, tenure: 0, alive: true, log: [], answersTo: boss.id };
    cycle.leaders[id] = band;
    return band;
  }

  /** How many stand as anchors now. */
  static anchorCount(cycle: Pick<ICycle, 'leaders'>, boss: ILeaderState): number {
    return (boss.territory ? anchorPosts(boss.territory).length : 0) + bandsOf(cycle, boss.id).length;
  }

  /** Bands come out of what walks behind it until it has what its rank asks. Nothing builds for an animal. */
  private static fillAnchors(cycle: ICycle, id: string, need: number, def: IKindDef): void {
    let boss = cycle.leaders[id];
    const t = boss.territory!;
    const short = need - this.anchorCount(cycle, boss);
    if (short <= 0 || boss.pack < short) return;
    const also = [...bandsOf(cycle, id).map(b => b.at), ...anchorPosts(t).map(s => s.at)];
    const grounds = this.anchorGrounds(cycle, t.seat, short, def, also);
    if (grounds.length === 0) return;
    const rest = boss.pack - grounds.length;
    const share = Math.floor(rest / (grounds.length + 1));
    const chunks = new Set(t.chunks);
    const elsewhere = heldElsewhere(cycle.leaders, id);
    for (const ground of grounds) {
      this.enlist(cycle, boss, ground, share);
      this.walkBetween(t.seat, ground).filter(c => !elsewhere.has(c)).forEach(c => chunks.add(c));
    }
    boss = { ...boss, pack: rest - share * grounds.length, territory: { ...t, chunks: [...chunks].sort() } };
    cycle.leaders[id] = boss;
  }

  /** The two roads, read off the record. Solitary bodies take neither: they stand in the way instead. */
  private static road(cycle: ICycle, id: string, def: IKindDef): void {
    const leader = cycle.leaders[id];
    if (leader.territory?.bossAt !== undefined || !isRosterElite(def) || !def.social) return;
    const need = anchorsFor(def.rank);
    const felledEnough = this.fallsBy(cycle.context, id, cycle.g) >= TERRITORY_NUMBERS.bossFalls;
    const base = leader.territory;
    const baseDone = !!def.builds && !!base && base.structures.some(s => s.fn === 'seat' && s.builtAt !== undefined) && anchorPosts(base).length >= need;
    const seeded = !def.builds && !!base;
    if (!felledEnough && !baseDone && !seeded) return;
    const t = base ?? this.camp(leader.at, cycle.g);
    if (!base) cycle.leaders[id] = { ...leader, territory: t };
    if (baseDone) {
      cycle.leaders[id] = { ...cycle.leaders[id], territory: { ...t, bossAt: cycle.g } };
      return;
    }
    // It keeps walking at the head of its pack until enough walk behind it to hold more than one place
    if (leader.pack < need - (base ? anchorPosts(base).length : 0)) {
      cycle.leaders[id] = { ...cycle.leaders[id], goal: 'grow' };
      return;
    }
    this.fillAnchors(cycle, id, need, def);
    const after = cycle.leaders[id];
    if (this.anchorCount(cycle, after) >= 2) cycle.leaders[id] = { ...after, territory: { ...after.territory!, bossAt: cycle.g } };
  }

  // -------------------------------------------------------------------------
  // WHAT A CYCLE DOES
  // -------------------------------------------------------------------------

  /** What happened to the place in play: what stays down, and what was carried out. */
  private static reckon(cycle: ICycle, t: ITerritory): ITerritory {
    const fell = (id: string) => cycle.record.down[id]?.at === cycle.g;
    const structures: IStructure[] = [];
    for (const s of t.structures) {
      if (!fell(s.id)) { structures.push(s); continue; }
      // A raid stops it mid-build. What had stood is scaffolding again, and half of it is worth keeping
      if (s.builtAt !== undefined) structures.push({ ...s, builtAt: undefined, paid: Math.floor(s.paid / 2) });
    }
    const stores = { ...t.stores };
    for (const s of t.structures) {
      const taken = cycle.record.taken?.[s.id];
      if (!taken || taken.at !== cycle.g) continue;
      let left = taken.n;
      for (const material of Object.keys(stores).sort()) {
        const out = Math.min(left, stores[material]);
        stores[material] -= out;
        left -= out;
      }
    }
    return { ...t, structures, stores };
  }

  /** A base's bodies work the ground it holds. Only what its trade answers, and a keyed share of a body. */
  private static work(cycle: ICycle, leader: ILeaderState, t: ITerritory, trade: string[]): ITerritory {
    if (trade.length === 0) return t;
    const stores = { ...t.stores };
    const hands = leader.pack + 1 + bandsOf(cycle, leader.id).reduce((sum, b) => sum + b.pack + 1, 0);
    const rng = Rng.fromKey(`${cycle.seed}:work:${leader.id}:${cycle.g}`);
    for (const ground of t.chunks) {
      const cell = cycle.land.get(ground);
      if (!cell) continue;
      const allowed = BIOME_RESOURCES[cell.biome] ?? [];
      const answers = (cycle.context.resourceDefinitions as { id: string; tags?: string[] }[])
        .filter(r => allowed.includes(r.id) && (r.tags ?? []).some(tag => trade.includes(tag)))
        .sort((a, b) => (a.id < b.id ? -1 : 1));
      if (answers.length === 0) continue;
      const worked = Math.floor((hands / t.chunks.length) * TERRITORY_NUMBERS.yieldPerBody * answers.length + rng.next());
      if (worked > 0) {
        const pick = answers[rng.int(0, answers.length)].id;
        stores[pick] = (stores[pick] ?? 0) + worked;
      }
    }
    return { ...t, stores };
  }

  /** What it would raise next. A seat, then its anchors, then what it lacks, and after that more of what holds it. */
  static nextRaise(t: ITerritory, need: number): StructureFn {
    const standing = (fn: StructureFn) => t.structures.filter(s => s.fn === fn).length;
    if (standing('seat') === 0) return 'seat';
    if (standing('anchor') < need) return 'anchor';
    for (const fn of ['watch', 'store', 'wall', 'works', 'muster'] as StructureFn[]) if (standing(fn) === 0) return fn;
    return standing('wall') <= standing('anchor') ? 'wall' : 'anchor';
  }

  /** The verbs its species can read at all. */
  static verbsFor(def: Pick<IKindDef, 'builds'>): Verb[] {
    return def.builds ? ['claim', 'raise', 'muster', 'hunt', 'raid'] : ['claim', 'muster', 'hunt', 'raid', 'migrate'];
  }

  /** The donor's rule, keyed: survival first, then growth. What picks when no plan is on the record. */
  private static ruleVerb(cycle: ICycle, leader: ILeaderState, def: IKindDef, need: number, rng: { int: (a: number, b: number) => number }): Verb {
    const t = leader.territory!;
    const cell = cycle.land.get(t.seat);
    const mouths = leader.pack + 1;
    if (cell && cell.food / mouths < 0.5) return 'hunt';
    const roll = rng.int(1, 21);
    if (def.builds && (totalOf(t.stores) > 0 || t.structures.some(s => s.builtAt === undefined)) && roll <= 15) return 'raise';
    if (this.anchorCount(cycle, leader) < need && roll <= 12) return 'muster';
    if (roll <= 9) return 'claim';
    if (roll <= 12) return 'muster';
    if (roll <= 15) return 'hunt';
    if (roll <= 18) return 'raid';
    return def.builds ? 'claim' : 'migrate';
  }

  /**
   * A decision's reader: what a verb does, as the grade allows. Words from a plan aim it (a target
   * that names a ground it could claim); the numbers stay here.
   */
  static READERS: Record<Verb, (cycle: ICycle, id: string, grade: IDecisionEntry['grade'], target: string | undefined, rng: { next: () => number; int: (a: number, b: number) => number }) => void> = {
    claim(cycle, id, grade, target) {
      if (grade === 'bad' || grade === 'poor') return;
      const leader = cycle.leaders[id];
      const t = leader.territory!;
      const taken = heldElsewhere(cycle.leaders, id);
      let chunks = t.chunks;
      const times = grade === 'great' ? 2 : 1;
      // Ground takes bodies to hold. So what it can feed is what it can keep, with no count of its own
      const hands = leader.pack + 1 + bandsOf(cycle, id).reduce((sum, b) => sum + b.pack + 1, 0);
      for (let i = 0; i < times && chunks.length < hands * TERRITORY_NUMBERS.chunksPerBody; i++) {
        const open = [...new Set(chunks.flatMap(k => cycle.land.get(k)?.beside ?? []))]
          .filter(k => !chunks.includes(k) && !taken.has(k)).sort();
        if (open.length === 0) return;
        const pick = target && open.includes(target) ? target
          : open.reduce((best, k) => ((cycle.land.get(k)?.food ?? 0) > (cycle.land.get(best)?.food ?? 0) ? k : best));
        chunks = [...chunks, pick].sort();
      }
      cycle.leaders[id] = { ...leader, territory: { ...t, chunks } };
    },
    raise(cycle, id, grade) {
      if (grade === 'bad') return;
      const leader = cycle.leaders[id];
      const def = defOf(leader.kind);
      if (!def) return;
      let t = leader.territory!;
      const need = anchorsFor(def.rank);
      const share = grade === 'great' ? 2 : grade === 'poor' ? 0.5 : 1;
      let budget = Math.ceil((leader.pack + 1) * TERRITORY_NUMBERS.payPerBody * share);
      const stores = { ...t.stores };
      const structures = t.structures.map(s => ({ ...s }));
      let building = structures.find(s => s.builtAt === undefined);
      if (!building) {
        const fn = Territory.nextRaise({ ...t, structures }, need);
        const standing = structures.filter(s => s.builtAt !== undefined).length;
        building = {
          id: `${registerOf(leader)}_s${t.raised}`, fn, at: Territory.groundFor(cycle, leader, fn, structures), paid: 0,
          bill: structureBill(fn as never, standing, seatBillBase()), startedAt: cycle.g
        };
        structures.push(building);
        t = { ...t, raised: t.raised + 1 };
      }
      // Paid from what it has most of, so what it is drawn from is what the place works
      const stocked = Object.keys(stores).filter(m => stores[m] > 0).sort((a, b) => stores[b] - stores[a] || (a < b ? -1 : 1));
      for (const material of stocked) {
        if (budget <= 0 || building.paid >= building.bill) break;
        const pay = Math.min(budget, stores[material], building.bill - building.paid);
        stores[material] -= pay;
        building.paid += pay;
        budget -= pay;
        building.material ??= material;
      }
      if (building.paid >= building.bill) building.builtAt = cycle.g;
      const chunks = new Set(t.chunks);
      const elsewhere = heldElsewhere(cycle.leaders, id);
      if (building.at !== t.seat) Territory.walkBetween(t.seat, building.at).filter(c => !elsewhere.has(c)).forEach(c => chunks.add(c));
      cycle.leaders[id] = { ...leader, territory: { ...t, structures, stores, chunks: [...chunks].sort() } };
    },
    muster(cycle, id, grade) {
      if (grade === 'bad' || grade === 'poor') return;
      const leader = cycle.leaders[id];
      const hall = leader.territory!.structures.some(s => s.fn === 'muster' && s.builtAt !== undefined) ? 1 : 0;
      cycle.leaders[id] = { ...leader, pack: leader.pack + 1 + hall + (grade === 'great' ? 1 : 0) };
    },
    hunt(cycle, id, grade) {
      if (grade === 'bad') return;
      const leader = cycle.leaders[id];
      const own = defOf(leader.kind)?.leads;
      for (const ground of leader.territory!.chunks) {
        const on = cycle.counts[ground];
        const prey = Object.keys(on ?? {}).sort().find(k => k !== own && defOf(k)?.tree === 'animal' && on[k] > 0);
        if (!prey) continue;
        on[prey] -= 1;
        if (own) cycle.leaders[id] = { ...leader, pack: leader.pack + 1 };
        return;
      }
    },
    raid(cycle, id, grade) {
      if (grade === 'bad' || grade === 'poor') return;
      const leader = cycle.leaders[id];
      const rival = Object.keys(cycle.leaders).sort().map(k => cycle.leaders[k])
        .find(l => l.alive && l.id !== id && !l.answersTo && registerOf(l) !== registerOf(leader));
      if (!rival) return;
      const theirs = rival.territory?.stores ?? {};
      const material = Object.keys(theirs).sort().find(m => theirs[m] > 0);
      if (material && rival.territory) {
        const out = Math.ceil(theirs[material] * 0.25);
        cycle.leaders[rival.id] = { ...rival, territory: { ...rival.territory, stores: { ...theirs, [material]: theirs[material] - out } } };
        const t = leader.territory!;
        cycle.leaders[id] = { ...leader, territory: { ...t, stores: { ...t.stores, [material]: (t.stores[material] ?? 0) + out } } };
      } else if (rival.pack > 0) {
        cycle.leaders[rival.id] = { ...rival, pack: rival.pack - 1 };
      }
    },
    migrate(cycle, id, grade) {
      if (grade === 'bad') return;
      const leader = cycle.leaders[id];
      const t = leader.territory!;
      const beside = cycle.land.get(t.seat)?.beside ?? [];
      const taken = heldElsewhere(cycle.leaders, id);
      const open = beside.filter(k => !taken.has(k)).sort();
      if (open.length === 0) return;
      const seat = open.reduce((best, k) => ((cycle.land.get(k)?.food ?? 0) > (cycle.land.get(best)?.food ?? 0) ? k : best));
      // It builds nothing, so where it stands is all it has: the herd goes where it goes
      cycle.leaders[id] = { ...leader, at: seat, territory: { ...t, seat, chunks: [...new Set([...t.chunks, seat])].sort() } };
    }
  };

  /** Where a thing goes: a seat at the seat, an anchor spread from the rest, and anything else on held ground, keyed. */
  private static groundFor(cycle: ICycle, leader: ILeaderState, fn: StructureFn, structures: IStructure[]): string {
    const t = leader.territory!;
    if (fn === 'seat') return t.seat;
    if (fn === 'anchor') {
      const def = defOf(leader.kind);
      const also = [...structures.filter(s => s.fn === 'anchor').map(s => s.at), ...bandsOf(cycle, leader.id).map(b => b.at)];
      const [ground] = def ? this.anchorGrounds(cycle, t.seat, 1, def, also) : [];
      return ground ?? t.seat;
    }
    const rng = Rng.fromKey(`${cycle.seed}:site:${leader.id}:${t.raised}`);
    return t.chunks[rng.int(0, t.chunks.length)];
  }

  /** A loser walks with its share, to other ground, and that ground is the start of its own. */
  private static walk(cycle: ICycle, loser: ILeaderState, from: string, stores: Record<string, number>, chunks?: string[]): void {
    const sectorKey = `${cycle.sx},${cycle.sy}`;
    const key = registerOf(cycle.leaders[from] ?? loser);
    if (cycle.koseki[key]) cycle.koseki[key] = Koseki.exit(cycle.koseki[key], loser.id, 'walked', cycle.g);
    const taken = heldElsewhere(cycle.leaders, loser.id);
    const open = [...cycle.land.values()].filter(c => !taken.has(c.key) && apart(c.key, loser.at) >= TERRITORY_NUMBERS.spreadChunks).map(c => c.key).sort();
    const seat = chunks?.[0] ?? (open.length > 0 ? open[Rng.fromKey(`${cycle.seed}:walks:${loser.id}:${cycle.g}`).int(0, open.length)] : loser.at);
    const register = `${loser.id}_w${cycle.g}`;
    cycle.koseki[register] = Koseki.found(sectorKey, loser.id, loser.kind, cycle.g);
    cycle.leaders[loser.id] = {
      ...loser, at: seat, answersTo: undefined, register, walkedFrom: from, goal: 'grow' as Goal, tenure: 0,
      territory: { ...this.camp(seat, cycle.g, stores), chunks: chunks ?? [seat] }
    };
  }

  /** A contender's roll: d20 and how well it leads, keyed by body and cycle. */
  private static contest(cycle: ICycle, leader: ILeaderState, purpose: string): number {
    const stats = Leaders.sheetOf(cycle.seed, { id: leader.id, kind: leader.kind, cx: 0, cy: 0, pack: 0 }, cycle.context).stats;
    return Rng.fromKey(`${cycle.seed}:challenge:${purpose}:${leader.id}:${cycle.g}`).int(1, 21) + Math.floor(stats.leadership / 2);
  }

  /**
   * A bad cycle opens a challenge: the next in its register against who sits. Whoever loses walks, and
   * seeds ground of its own. The seat, its buildings and most of its stores stay with the place.
   */
  private static challenge(cycle: ICycle, id: string): void {
    const boss = cycle.leaders[id];
    const t = boss.territory;
    const register = cycle.koseki[registerOf(boss)];
    const next = register && Koseki.nextHead(register);
    const challenger = next && cycle.leaders[next.body];
    if (!t || !challenger?.alive) return;
    const sitting = this.contest(cycle, boss, 'sits') + Math.floor(boss.tenure / 4);
    const coming = this.contest(cycle, challenger, 'comes');
    const carried = Object.fromEntries(Object.entries(t.stores).map(([m, n]) => [m, Math.floor(n / 4)]));
    const kept = Object.fromEntries(Object.entries(t.stores).map(([m, n]) => [m, n - Math.floor(n / 4)]));
    if (coming > sitting) {
      const seated: ILeaderState = { ...challenger, at: t.seat, answersTo: undefined, tenure: 0, territory: { ...t, stores: kept, since: cycle.g }, goal: boss.goal };
      cycle.leaders[challenger.id] = seated;
      for (const band of bandsOf(cycle, id)) if (band.id !== challenger.id) cycle.leaders[band.id] = { ...band, answersTo: challenger.id };
      this.walk(cycle, { ...boss, territory: undefined, pack: Math.floor(boss.pack / 2) }, id, carried);
      cycle.leaders[challenger.id] = { ...cycle.leaders[challenger.id], pack: seated.pack + Math.ceil(boss.pack / 2) };
    } else {
      cycle.leaders[id] = { ...boss, territory: { ...t, stores: kept } };
      this.walk(cycle, challenger, id, carried);
    }
  }

  /** The seat is empty: the bands and who stood behind it contest it, in register order, and it may split. */
  static seatFallen(cycle: ICycle, fallen: ILeaderState, territory: ITerritory): void {
    const contenders = bandsOf(cycle, fallen.id);
    if (contenders.length === 0) return;
    const rolled = contenders
      .map(band => ({ band, roll: this.contest(cycle, band, 'seat') }))
      .sort((a, b) => b.roll - a.roll || (a.band.id < b.band.id ? -1 : 1));
    const [first, second] = rolled;
    const key = registerOf(first.band);
    const seated: ILeaderState = { ...first.band, at: territory.seat, answersTo: undefined, tenure: 0, goal: 'grow', territory: { ...territory, since: cycle.g } };
    cycle.leaders[first.band.id] = seated;
    if (cycle.koseki[key]) cycle.koseki[key] = Koseki.crown(cycle.koseki[key], first.band.id);
    for (const { band } of rolled.slice(1)) cycle.leaders[band.id] = { ...band, answersTo: first.band.id };
    // Rolls this close and neither gives way: the ground splits, each side with what stands nearest it
    if (second && Math.abs(first.roll - second.roll) <= TERRITORY_NUMBERS.splitBy && territory.chunks.length >= 4) {
      const nearer = (k: string) => apart(k, second.band.at) < apart(k, territory.seat);
      const theirs = territory.chunks.filter(nearer);
      if (theirs.length > 0) {
        const carried = Object.fromEntries(Object.entries(territory.stores).map(([m, n]) => [m, Math.floor(n / 2)]));
        const left = Object.fromEntries(Object.entries(territory.stores).map(([m, n]) => [m, n - Math.floor(n / 2)]));
        cycle.leaders[first.band.id] = {
          ...seated,
          territory: {
            ...seated.territory!, stores: left, chunks: territory.chunks.filter(k => !nearer(k)),
            structures: territory.structures.filter(s => !nearer(s.at))
          }
        };
        this.walk(cycle, { ...second.band, answersTo: undefined }, first.band.id, carried, theirs);
      }
    }
  }

  /** Orders the bodies read. The leader's nature says its posture, and a plan may say otherwise. */
  private static orders(cycle: ICycle, leader: ILeaderState): IStandingOrders {
    const nature = Leaders.sheetOf(cycle.seed, { id: leader.id, kind: leader.kind, cx: 0, cy: 0, pack: 0 }, cycle.context).temperament;
    const bands: Record<string, string> = {};
    for (const band of bandsOf(cycle, leader.id)) bands[band.id] = band.at;
    return { posture: POSTURE[nature] ?? 'hold', alarmCalls: nature !== 'cautious', bands };
  }

  /** One cycle of everyone in a sector who holds ground, or could. Sorted, so it folds to the same bytes. */
  static cycle(cycle: ICycle): void {
    for (const id of Object.keys(cycle.leaders).sort()) {
      if (!cycle.leaders[id].alive || cycle.leaders[id].answersTo) continue;
      const def = defOf(cycle.leaders[id].kind);
      if (!def) continue;
      this.road(cycle, id, def);
      let leader = cycle.leaders[id];
      // A base begins on the ground `settle` finished on
      if (leader.settledAt && !leader.territory) {
        leader = { ...leader, territory: this.camp(leader.settledAt, cycle.g), at: leader.settledAt };
        cycle.leaders[id] = leader;
      }
      if (!leader.territory) continue;

      const seedOf = { id, kind: leader.kind, cx: 0, cy: 0, pack: 0 };
      const sheet = Leaders.sheetOf(cycle.seed, seedOf, cycle.context);
      const trade = def.builds ? Leaders.tradeOf(sheet, cycle.context) : [];
      let t = this.work(cycle, leader, this.reckon(cycle, leader.territory), trade);
      cycle.leaders[id] = { ...leader, territory: t };

      const need = anchorsFor(def.rank);
      const cycleMs = cycle.context.cycleMs ?? DEFAULT_CYCLE_MS;
      const due = DecisionLayer.dueAt(sheet.stats as IAttributes, cycle.g, cycleMs, id);
      const plan = cycle.record.plans?.[id];
      const week = DecisionLayer.weekOf(cycle.g, cycleMs);
      let opened = false;
      for (let i = 0; i < due; i++) {
        leader = cycle.leaders[id];
        const rng = Rng.fromKey(`${cycle.seed}:decide:${id}:${cycle.g}:${i}`);
        const used = leader.territory!.log.filter(e => e.name !== undefined && DecisionLayer.weekOf(e.generation, cycleMs) === week).length;
        const planned = plan && plan.week === week ? plan.decisions[used] : undefined;
        const allowed = this.verbsFor(def);
        const verb: Verb = planned && allowed.includes(planned.verb as Verb) ? planned.verb as Verb : this.ruleVerb(cycle, leader, def, need, rng);
        const by = rng.int(1, 21) + Math.max(0, rankStep(def.rank)) + Math.floor(leader.tenure / 4) - TERRITORY_NUMBERS.verbDc;
        const grade: IDecisionEntry['grade'] = by <= -TERRITORY_NUMBERS.badBy ? 'bad' : by < 0 ? 'poor' : by >= 6 ? 'great' : 'good';
        this.READERS[verb](cycle, id, grade, planned?.target, rng);
        leader = cycle.leaders[id];
        const entry: IDecisionEntry = { generation: cycle.g, verb, grade, ...(planned?.name ? { name: planned.name } : {}) };
        cycle.leaders[id] = { ...leader, territory: { ...leader.territory!, log: [...leader.territory!.log, entry].slice(-LOG_KEPT) } };
        if (grade === 'bad') opened = true;
      }

      leader = cycle.leaders[id];
      t = leader.territory!;
      if (t.bossAt !== undefined) {
        if (!def.builds || anchorPosts(t).length < need) this.fillAnchors(cycle, id, need, def);
        if (opened) this.challenge(cycle, id);
      }
      const after = cycle.leaders[id];
      if (after.alive && after.territory && !after.answersTo) {
        cycle.leaders[id] = { ...after, territory: { ...after.territory, orders: this.orders(cycle, after) } };
      }
    }
  }

  // -------------------------------------------------------------------------
  // WHAT A CHUNK SHOWS
  // -------------------------------------------------------------------------

  /** Where a structure stands: keyed, in the middle third of its chunk, on open ground. */
  static placeOf(seed: string, s: Pick<IStructure, 'id' | 'at'>): { x: number; y: number } {
    const [cx, cy] = partsOf(s.at);
    const rng = Rng.fromKey(`${seed}:post:${s.id}`);
    const third = Math.floor(CHUNK_TILES / 3);
    let tx = 0, ty = 0;
    for (let tries = 0; tries < 16; tries++) {
      tx = cx * CHUNK_TILES + third + rng.int(0, third);
      ty = cy * CHUNK_TILES + third + rng.int(0, third);
      if (!TerrainSystem.isBlockedTile(seed, tx, ty)) break;
    }
    return { x: tileCenter(tx), y: tileCenter(ty) };
  }

  /** The anchors as a chunk reads them: its built posts and its bands, each with where it stands. */
  static wardOf(seed: string, boss: ILeaderState, state: Pick<ISectorState, 'leaders'>): IWard {
    const slots: IWardSlot[] = [];
    for (const post of boss.territory ? anchorPosts(boss.territory) : []) {
      const at = this.placeOf(seed, post);
      slots.push({ id: post.id, kind: 'post', bodies: [post.id], ...at });
    }
    for (const band of bandsOf(state, boss.id)) {
      const [cx, cy] = partsOf(band.at);
      const bodies = [band.id, ...Array.from({ length: band.pack }, (_, i) => `${band.id}_f${i}`)];
      slots.push({ id: band.id, kind: 'body', bodies, x: (cx + 0.5) * CHUNK_PX, y: (cy + 0.5) * CHUNK_PX });
    }
    return { boss: boss.id, slots };
  }

  /** A store's contents, as what a person can carry out. Keyed by what it is, so a reload finds the same. */
  private static storeItems(seed: string, s: IStructure, stores: Record<string, number>) {
    const rng = Rng.fromKey(`${seed}:store:${s.id}`);
    return Object.keys(stores).sort().flatMap(material => {
      const def = RESOURCE_DEFINITIONS[material];
      if (!def) return [];
      return Array.from({ length: stores[material] }, () => ItemFactory.createResourceItem(def, rng));
    });
  }

  private static entityFor(seed: string, leader: ILeaderState, s: IStructure, holding: IHoldingOnEntity, rank: UniversalRank, orders: IStandingOrders, ward?: IWard): IWorldEntity[] {
    const at = this.placeOf(seed, s);
    const built = s.builtAt !== undefined;
    const maxHealth = postHealth(rank) * (built ? 1 : 0.5);
    const base = {
      rank, rarity: Rarity.COMMON, isHostile: false, heldBy: leader.id, holding, health: maxHealth,
      structure: {
        fn: s.fn, built, heldBy: leader.id, maxHealth, paid: s.paid, bill: s.bill,
        ...(s.material ? { material: s.material } : {}),
        ...(s.fn === 'watch' ? { alarm: orders.alarmCalls } : {})
      }
    };
    if (s.fn === 'store' && built) {
      return [{
        ...base, id: s.id, type: EntityType.CONTAINER, definitionId: 'struct_store', position: at,
        container: { lootRank: rank, looted: false, hasLore: false, items: this.storeItems(seed, s, leader.territory!.stores) }
      }];
    }
    if (s.fn === 'wall' && built) {
      // A run with a way through at its middle, along whichever line its key says
      const across = Rng.fromKey(`${seed}:wall:${s.id}`).next() < 0.5;
      const pieces: IWorldEntity[] = [];
      for (let i = 0; i < WALL_RUN; i++) {
        if (i === Math.floor(WALL_RUN / 2)) continue;
        const off = (i - Math.floor(WALL_RUN / 2)) * 20;
        pieces.push({ ...base, id: `${s.id}_w${i}`, type: EntityType.STRUCTURE, definitionId: 'struct_wall', position: across ? { x: at.x + off, y: at.y } : { x: at.x, y: at.y + off } });
      }
      return pieces;
    }
    return [{ ...base, id: s.id, type: EntityType.STRUCTURE, definitionId: `struct_${s.fn}`, position: at, ...(s.fn === 'anchor' && built && ward ? { ward } : {}) }];
  }

  /** Lays one sector's ground over one chunk: what stands, and what its bodies read. Pure of the land. */
  static layOver(seed: string, chunk: IChunk, state: ISectorState, record: Pick<IPopulationRecord, 'down'>, generation: number): void {
    const ground = keyOf(chunk.x, chunk.y);
    const bySeat = new Map<string, ILeaderState>();
    for (const l of Object.values(state.leaders)) if (l.alive && l.territory) bySeat.set(l.id, l);
    for (const leader of bySeat.values()) {
      const t = leader.territory!;
      const def = defOf(leader.kind);
      if (!def) continue;
      const ward = t.bossAt !== undefined ? this.wardOf(seed, leader, state) : undefined;
      const holding: IHoldingOnEntity = { seat: t.seat, chunks: t.chunks, anchors: ward?.slots.length ?? 0 };
      const [sx, sy] = partsOf(t.seat);
      const seatAt = t.structures.find(s => s.fn === 'seat');
      const orders: IEntityOrders = {
        posture: t.orders.posture, alarmCalls: t.orders.alarmCalls,
        seat: seatAt ? this.placeOf(seed, seatAt) : { x: (sx + 0.5) * CHUNK_PX, y: (sy + 0.5) * CHUNK_PX }
      };
      // Who answers to it, here
      const family = new Set<string>([leader.id, ...bandsOf(state, leader.id).map(b => b.id)]);
      for (const e of chunk.entities) {
        if (e.type !== EntityType.MOB) continue;
        const herd = Leaders.herdOf(e.id);
        if (!herd || !family.has(herd)) continue;
        e.heldBy = leader.id;
        e.orders = orders;
        e.holding = holding;
        if (e.id === leader.id && ward) { e.ward = ward; e.warded = ward.slots.length > 0; }
      }
      const works = t.structures.some(s => s.fn === 'works' && s.builtAt !== undefined);
      if (works) for (const e of chunk.entities) if (e.heldBy === leader.id && e.type === EntityType.MOB) e.bonusDamage = (e.bonusDamage ?? 0) + rankStep(def.rank) + 1;
      for (const s of t.structures) {
        if (s.at !== ground || record.down[s.id]?.at === generation) continue;
        chunk.entities.push(...this.entityFor(seed, leader, s, holding, def.rank, t.orders, ward));
      }
    }
  }
}
