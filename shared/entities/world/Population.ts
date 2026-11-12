/**
 * THE POPULATION (D64, D66): who stands on the land after alpha.
 *
 * A tree node is a kind, never a body. A birth changes a count, by kind and ground, and only a
 * change of form adds a node. The land's own food limits a count, and nothing else does.
 *
 * A world is far too large to hold a count for all of it, so a sector folds when someone first
 * reads it: from what the land stood at alpha, one cycle at a time, every roll keyed. Nothing
 * here depends on the order sectors are read in, so two machines reading the same record agree,
 * and folding N cycles at once is folding them one at a time, because that is what it does. The
 * record holds what has been folded and what happened in play. Sectors do not trade bodies, so
 * each one folds alone: a herd walks chunks, and stays inside its sector's sixty-four.
 *
 * Land and alpha stay what the vectors say. A chunk is built pure, then this lays over it, as
 * chests and carts do. A leader is the one body the record holds by itself (D93); a chest's
 * guards stand with their chest and are not counted here.
 */

import { fnv1a, Rng } from '../../logic/rng/DeterministicRNG';
import { hash2, layerSeed, valueNoise } from '../../logic/rng/noise';
import { GOAL_BANDS, GOAL_GREAT_BY, LAND_NUMBERS, bodyNumbers, foodFrom } from '../../logic/theme/ThemeFormula';
import { VectorNamespace, VectorStore } from '../data/VectorStore';
import { MOB_DEFINITIONS } from '../mob/data/mobDefinitions';
import { BIOME_RESOURCES } from '../item/data/resourceDefinitions';
import { CHUNK_QUADRANTS, SECTOR_CHUNKS } from './grid';
import { IKoseki, Koseki } from './Koseki';
import { Goal, ILeaderSeed, Leaders } from './Leaders';
import { ITerritory, Territory } from './Territory';
import { EntityType, IChunk } from './types';
import { IBodyToStand, IGenerationContext, WorldGenerator } from './WorldGenerator';
import { UniversalRank } from '../../types';

/** Keep the word open: a line that does not breed by pairs names its own genders here. Pairs is all the game reads today. */
const GENDERS: Record<string, readonly string[]> = { pairs: ['female', 'male'] };
const DEFAULT_BREEDING = 'pairs';

const ONE_OF_A_KIND = ['boss', 'titan', 'god'];
const FERTILITY_PERIOD = 3;
/** How much of a leader's history stays on the record. The rest has been acted on. */
const LOG_KEPT = 12;

/** One goal's cycle: seen means no roll, because what a person saw must stay true. */
export interface IGoalEntry {
  generation: number;
  goal: Goal;
  seen: boolean;
  /** The d20, when nobody saw it. */
  rolled?: number;
  outcome: 'done' | 'failed';
  great?: boolean;
}

/** The one body the record holds by itself: a leader, and how many walk behind it. */
export interface ILeaderState {
  id: string;
  kind: string;
  at: string;
  pack: number;
  goal: Goal;
  tenure: number;
  alive: boolean;
  log: IGoalEntry[];
  /** The ground a `settle` finished on. What it raises there is `territory`. */
  settledAt?: string;
  /** D93: the ground it holds. A leader with none holds no ground and has no map mark. */
  territory?: ITerritory;
  /** A band: the boss whose orders it follows, and whose anchor it is. */
  answersTo?: string;
  /** The register it files on, where it walked away from the one its id says. */
  register?: string;
  /** Who it lost a challenge to, or left. */
  walkedFrom?: string;
  /** What its last `waylay` took off whatever crossed its ground. */
  tollTaken?: number;
}

/** A sector at one cycle: counts by ground and kind, and the leaders on its roster. */
export interface ISectorState {
  generation: number;
  ground: Record<string, Record<string, number>>;
  leaders: Record<string, ILeaderState>;
  /** A line's register, by the roster place it began at. Written when a leader falls, and absent until one has. */
  koseki?: Record<string, IKoseki>;
}

export interface IPopulationRecord {
  /** What has been folded. Absent means nobody has read that sector since alpha. */
  sectors: Record<string, ISectorState>;
  /** Who fell, until the cycle they fell in has been folded. A kind stays a kind. */
  down: Record<string, { at: number; kind: string; sector: string; ground?: string }>;
  /** D93: which leaders someone saw, by the cycles they were seen in. */
  seen: Record<string, number[]>;
  /** D65: the registers bodies were taken alive from, by register id. Absent until one has been. */
  taken?: Record<string, IKoseki>;
  /** D65: bodies let go on this land, until the cycle they landed in has been folded. A foreign kind stays its own kind. */
  released?: { ground: string; kind: string; at: number }[];
  /** A week's plan for a leader, as the law let it stand (`LeaderPlan`). Absent means the code's own rule picks. */
  plans?: Record<string, { week: number; decisions: { verb: string; target: string; name: string; why: string }[] }>;
  /** What was carried out of a store, until the cycle it happened in has been folded. */
  carried?: Record<string, { at: number; n: number; sector: string }>;
  /**
   * People who walked or were carried out of this world, by the body the land deals them, and the
   * cycle they left in. Never folded away: they live in a city now, and nobody comes through twice.
   */
  left?: Record<string, { at: number }>;
}

export const emptyPopulationRecord = (): IPopulationRecord => ({ sectors: {}, down: {}, seen: {} });

interface IKindDef {
  id: string; rank: UniversalRank; size?: string; speed?: number; behavior?: string; tree?: string;
  tags?: string[]; habitat?: string[]; social?: boolean; leads?: string; name: string; generation?: number;
  baseHealth: number;
}

export interface ILandCell { key: string; cx: number; cy: number; biome: string; rank: number; food: number; beside: string[]; alpha: Record<string, number> }

const keyOfGround = (cx: number, cy: number) => `${cx},${cy}`;
const sectorKeyOf = (ground: string) => {
  const [cx, cy] = ground.split(',').map(Number);
  return `${Math.floor(cx / SECTOR_CHUNKS)},${Math.floor(cy / SECTOR_CHUNKS)}`;
};
const COUNTED = /^(?:pop_-?\d+_-?\d+_[a-z0-9]+_\d+|ent_-?\d+_-?\d+_m\d+)$/;
const defOf = (id: string) => MOB_DEFINITIONS[id] as unknown as IKindDef | undefined;
const oneOfAKind = (def: IKindDef) => (def.tags ?? []).some(t => ONE_OF_A_KIND.includes(t));

/** A share of a count, with what the floor drops carried by a keyed roll, so a herd of any size can lose or gain a head. */
const shareOf = (x: number, u: number) => Math.floor(x + u);

const RANK_ORDER = Object.values(UniversalRank);

/** Kept, because a fold far behind the clock asks these thousands of times. Each is pure, so keeping it changes nothing. */
const kindHashes = new Map<string, number>();
const kindHash = (kind: string) => {
  let h = kindHashes.get(kind);
  if (h === undefined) { h = fnv1a(kind); kindHashes.set(kind, h); }
  return h;
};
const pairsHeld = new Map<string, number>();
const numbersHeld = new Map<string, ReturnType<typeof bodyNumbers>>();
const numbersOf = (def: IKindDef) => {
  let n = numbersHeld.get(def.id);
  if (!n) { n = bodyNumbers(def); numbersHeld.set(def.id, n); }
  return n;
};

/** D69: a plain kind's id moves when its words come. What was counted under it goes with them. */
const wordsFor = (context: IGenerationContext): Map<string, string> => new Map(
  Object.values(context.director?.lines?.nodes ?? {}).flatMap(n => (n.was ? [[n.was, n.id] as const] : []))
);

const lands = new WeakMap<IGenerationContext, Map<string, Map<string, ILandCell>>>();
const biomeFood = new WeakMap<IGenerationContext, Map<string, number>>();

export class Population {

  // -------------------------------------------------------------------------
  // A BODY
  // -------------------------------------------------------------------------

  /** Keyed by (seed, body), so every machine agrees. Read when asked and stored nowhere. */
  static genderOf(seed: string, bodyId: string, breeding = DEFAULT_BREEDING): string {
    const genders = GENDERS[breeding] ?? GENDERS[DEFAULT_BREEDING];
    return genders[fnv1a(`${seed}:gender:${bodyId}`) % genders.length];
  }

  /** A body the count decides: an alpha pack's, or one the record stood. A guard or a leader's pack is not one. */
  static isCounted(entityId: string): boolean {
    return COUNTED.test(entityId);
  }

  static bodyId(ground: string, kind: string, index: number): string {
    return `pop_${ground.replace(',', '_')}_${kindHash(kind).toString(36)}_${index}`;
  }

  /** How many pairs a kind makes on a ground: the lesser of its two genders. */
  static pairsOf(seed: string, ground: string, kind: string, count: number): number {
    if (count < 2) return 0;
    const key = `${seed}|${ground}|${kind}|${count}`;
    const held = pairsHeld.get(key);
    if (held !== undefined) return held;
    let first = 0;
    const [one] = GENDERS[DEFAULT_BREEDING];
    for (let i = 0; i < count; i++) if (this.genderOf(seed, this.bodyId(ground, kind, i)) === one) first++;
    const pairs = Math.min(first, count - first);
    if (pairsHeld.size > 200_000) pairsHeld.clear();
    pairsHeld.set(key, pairs);
    return pairs;
  }

  // -------------------------------------------------------------------------
  // THE LAND'S FOOD
  // -------------------------------------------------------------------------

  /** What a chunk feeds in a cycle: what its materials yield, by the land's own noise. Never a fixed number. */
  static foodAt(seed: string, cx: number, cy: number, context: IGenerationContext): number {
    const biome = WorldGenerator.biomeAt(seed, cx, cy);
    let table = biomeFood.get(context);
    if (!table) { table = new Map(); biomeFood.set(context, table); }
    let base = table.get(biome);
    if (base === undefined) {
      const allowed = BIOME_RESOURCES[biome] ?? [];
      const pool = (context.resourceDefinitions as { id: string; tags?: string[]; uses?: number; yieldPerUse?: [number, number] }[]).filter(r => allowed.includes(r.id));
      base = pool.reduce((sum, r) => sum + foodFrom(r, pool.length), 0);
      table.set(biome, base);
    }
    const fertile = valueNoise(layerSeed(seed, 'food:v1'), cx, cy, FERTILITY_PERIOD);
    return base * (1 - LAND_NUMBERS.fertility + 2 * LAND_NUMBERS.fertility * fertile);
  }

  private static landOf(seed: string, sx: number, sy: number, context: IGenerationContext): Map<string, ILandCell> {
    let bySector = lands.get(context);
    if (!bySector) { bySector = new Map(); lands.set(context, bySector); }
    const key = `${seed}:${sx},${sy}`;
    const known = bySector.get(key);
    if (known) return known;
    const cells = new Map<string, ILandCell>();
    const x0 = sx * SECTOR_CHUNKS, y0 = sy * SECTOR_CHUNKS;
    const exits = WorldGenerator.exitsInSector({ seed }, sx, sy);
    for (let y = y0; y < y0 + SECTOR_CHUNKS; y++) for (let x = x0; x < x0 + SECTOR_CHUNKS; x++) {
      const beside: string[] = [];
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx >= x0 && ny >= y0 && nx < x0 + SECTOR_CHUNKS && ny < y0 + SECTOR_CHUNKS) beside.push(keyOfGround(nx, ny));
      }
      cells.set(keyOfGround(x, y), {
        key: keyOfGround(x, y), cx: x, cy: y, biome: WorldGenerator.biomeAt(seed, x, y),
        rank: RANK_ORDER.indexOf(WorldGenerator.rankAt(seed, x, y, context.difficulty, context.groundVersion, context.deathPenalty)),
        food: this.foodAt(seed, x, y, context), beside,
        alpha: WorldGenerator.censusChunk(seed, exits, x, y, context)
      });
    }
    bySector.set(key, cells);
    return cells;
  }

  /** Can this kind stand here? Its own habitat, and no higher than the ground's rank, so walking never breaks R4. */
  private static canStand(def: IKindDef, cell: ILandCell): boolean {
    if (def.habitat && !def.habitat.includes(cell.biome)) return false;
    return RANK_ORDER.indexOf(def.rank) <= cell.rank;
  }

  // -------------------------------------------------------------------------
  // ALPHA AND THE FOLD
  // -------------------------------------------------------------------------

  /** The sector as it was minted: the land's own counts, and its roster. */
  static alpha(seed: string, sx: number, sy: number, context: IGenerationContext): ISectorState {
    const ground: ISectorState['ground'] = {};
    for (const cell of this.landOf(seed, sx, sy, context).values()) {
      if (Object.keys(cell.alpha).length > 0) ground[cell.key] = { ...cell.alpha };
    }
    const leaders: ISectorState['leaders'] = {};
    for (const seedOf of Leaders.rosterOf(seed, sx, sy, context)) {
      leaders[seedOf.id] = {
        id: seedOf.id, kind: seedOf.kind, at: keyOfGround(seedOf.cx, seedOf.cy), pack: seedOf.pack,
        goal: Leaders.sheetOf(seed, seedOf, context).goal, tenure: 0, alive: true, log: []
      };
    }
    return { generation: 0, ground, leaders };
  }

  /**
   * One cycle passes on one sector. Pure: the same state, ledger and land give the same next state.
   * Keys are sorted wherever a sum is taken, so a state read back from a store folds to the same bytes.
   */
  static step(seed: string, sx: number, sy: number, state: ISectorState, record: Pick<IPopulationRecord, 'down' | 'seen' | 'released' | 'plans' | 'carried'>, context: IGenerationContext): ISectorState {
    const g = state.generation;
    const land = this.landOf(seed, sx, sy, context);
    const sectorKey = `${sx},${sy}`;
    const roll = (purpose: string) => {
      const layer = layerSeed(seed, `pop:${purpose}:${g}`);
      return (ground: ILandCell, kind: string) => hash2(layer, Math.imul(ground.cx, 8191) + ground.cy, kindHash(kind)) / 0x100000000;
    };
    const counts: ISectorState['ground'] = {};
    for (const [ground, on] of Object.entries(state.ground)) counts[ground] = { ...on };

    // Who fell in the cycle that is closing is one fewer, and a birth does not bring them back.
    const words = wordsFor(context);
    for (const entry of Object.values(record.down)) {
      if (entry.at !== g || entry.sector !== sectorKey || !entry.ground) continue;
      const on = counts[entry.ground];
      const fellAs = words.get(entry.kind) ?? entry.kind;
      if (on?.[fellAs]) on[fellAs] -= 1;
    }
    // Who was let go in the cycle that is closing is one more, and from here it is a count like any other
    for (const body of record.released ?? []) {
      if (body.at !== g || sectorKeyOf(body.ground) !== sectorKey) continue;
      const on = counts[body.ground] ?? (counts[body.ground] = {});
      on[body.kind] = (on[body.kind] ?? 0) + 1;
    }

    this.changeOfForm(counts, land, context, roll('form'), g);

    const leaders: ISectorState['leaders'] = {};
    let koseki = state.koseki;
    // What a leader's pack eats comes out of the same ground, under the kind it is
    const packMouths = new Map<string, Map<string, number>>();
    // Ground someone already holds is not ground another goes looking for
    const held = new Set(Object.values(state.leaders).flatMap(l => (l.alive && l.territory ? l.territory.chunks : [])));
    const vacant: { fallen: ILeaderState; territory: ITerritory }[] = [];
    for (const id of Object.keys(state.leaders).sort()) {
      let next = this.stepLeader(seed, sx, sy, state.leaders[id], counts, land, g, record, context, held);
      if (state.leaders[id].alive && !next.alive) {
        // It stays down. Its register says who comes next, if anyone is left behind it
        const after = this.succeed(seed, next, koseki, sectorKey, g, context);
        koseki = after.koseki;
        const { territory, ...down } = next;
        leaders[id] = { ...down, pack: 0 };
        if (territory) vacant.push({ fallen: next, territory });
        if (!after.heir) continue;
        next = after.heir;
        leaders[next.id] = next;
      } else {
        leaders[id] = next;
      }
      if (!next.alive) continue;
      const def = defOf(next.kind);
      if (!def) continue;
      const led = def.leads ? defOf(def.leads) : undefined;
      const mouths = packMouths.get(next.at) ?? new Map<string, number>();
      const as = def.leads ?? def.id;
      mouths.set(as, (mouths.get(as) ?? 0) + numbersOf(def).appetite + next.pack * (led ? numbersOf(led).appetite : 0));
      packMouths.set(next.at, mouths);
    }

    const out: ISectorState['ground'] = {};
    const put = (ground: string, kind: string, n: number) => {
      if (n <= 0) return;
      const on = out[ground] ?? (out[ground] = {});
      on[kind] = (on[kind] ?? 0) + n;
    };
    const hunted = roll('hunted'), born = roll('born'), starved = roll('starved'), hungry = roll('hungry'), roam = roll('roam'), toward = roll('toward'), returning = roll('returning');

    // What a ground has to spare, as the cycle opens: where a hungry body goes, so herds spread rather than pile
    const spare = new Map<string, number>();
    for (const cell of land.values()) {
      const on = counts[cell.key] ?? {};
      let need = [...(packMouths.get(cell.key)?.values() ?? [])].reduce((sum, n) => sum + n, 0);
      for (const kind of Object.keys(on)) {
        const def = defOf(kind);
        if (def && !oneOfAKind(def)) need += on[kind] * numbersOf(def).appetite;
      }
      spare.set(cell.key, cell.food - need);
    }
    const fedAt = new Map<string, Map<string, number>>();

    for (const key of Object.keys(counts).sort()) {
      const cell = land.get(key);
      const on = counts[key];
      if (!cell) { for (const [kind, n] of Object.entries(on)) put(key, kind, n); continue; }
      const kinds = Object.keys(on).filter(k => on[k] > 0).sort();
      const defs = new Map(kinds.map(k => [k, defOf(k)]));
      const eaters = kinds.filter(k => defs.get(k) && !oneOfAKind(defs.get(k)!));
      const isAnimal = (k: string) => defs.get(k)!.tree === 'animal';
      const appetite = (k: string) => numbersOf(defs.get(k)!).appetite;

      // The ground's food is shared among the kinds on it, what one leaves going to the next. So a
      // kind that breeds fast crowds itself first: it fills its share, and the others keep theirs.
      const needs = new Map<string, number>(eaters.map(k => [k, on[k] * appetite(k)]));
      for (const [k, n] of packMouths.get(key) ?? []) needs.set(k, (needs.get(k) ?? 0) + n);
      const share = new Map<string, number>();
      let food = cell.food;
      const hungriest = [...needs.entries()].sort((a, b) => a[1] - b[1] || (a[0] < b[0] ? -1 : 1));
      hungriest.forEach(([k, need], i) => {
        const allotted = Math.min(need, food / (hungriest.length - i));
        share.set(k, allotted);
        food -= allotted;
      });
      const hunters = eaters.filter(k => !isAnimal(k));

      const taken = new Map<string, number>();
      let caught = 0;
      for (const prey of eaters.filter(isAnimal)) {
        const preyRank = RANK_ORDER.indexOf(defs.get(prey)!.rank);
        // A hunter brings down what is no higher than its rank and no bigger than itself, and scarce prey is hard to find
        const pressure = hunters
          .filter(k => RANK_ORDER.indexOf(defs.get(k)!.rank) >= preyRank && appetite(k) >= appetite(prey))
          .reduce((sum, k) => sum + on[k] * appetite(k), 0);
        if (pressure <= 0) continue;
        const found = on[prey] / (on[prey] + LAND_NUMBERS.preyFound);
        const heads = Math.min(on[prey], shareOf((pressure * LAND_NUMBERS.huntShare * found) / (appetite(prey) * LAND_NUMBERS.preyYield), hunted(cell, prey)));
        if (heads > 0) { taken.set(prey, heads); caught += heads * appetite(prey) * LAND_NUMBERS.preyYield; }
      }
      // What hunters caught feeds them, split by how many mouths each kind has
      const hunterNeed = hunters.reduce((sum, k) => sum + (needs.get(k) ?? 0), 0);
      const fedOf = new Map<string, number>();
      for (const [k, need] of needs) {
        const meat = hunterNeed > 0 && hunters.includes(k) ? caught * (need / hunterNeed) : 0;
        fedOf.set(k, need > 0 ? Math.min(1, ((share.get(k) ?? 0) + meat) / need) : 1);
      }
      fedAt.set(key, fedOf);

      for (const kind of kinds) {
        const def = defs.get(kind);
        if (!def) { put(key, kind, on[kind]); continue; }
        const { birthRate, roam: wander } = numbersOf(def);
        const pinned = def.behavior === 'TURRET';
        const single = oneOfAKind(def);
        const fed = single ? 1 : fedOf.get(kind) ?? 1;
        let n = on[kind] - (taken.get(kind) ?? 0);
        if (!single) {
          const pairs = this.pairsOf(seed, key, kind, n);
          // A birth takes plenty. Short of it a kind holds, and then thins: the land's food is what stops a count
          n = n + (fed >= 1 ? shareOf(pairs * birthRate, born(cell, kind)) : 0) - Math.min(n, shareOf(n * (1 - fed) * LAND_NUMBERS.starve, starved(cell, kind)));
        }
        if (n <= 0) continue;

        // Hunger moves what the ground cannot feed, and a fed group walks on when it will. A social kind walks on together.
        let leaving = 0;
        if (!pinned) {
          const short = shareOf(n * (1 - fed), hungry(cell, kind));
          if (def.social) leaving = short > 0 ? short : roam(cell, kind) < wander ? n : 0;
          else leaving = Math.max(short, shareOf(n * wander, roam(cell, kind)));
          leaving = Math.min(n, leaving);
        }
        const dest = leaving > 0 ? this.walkTo(cell, def, land, spare, toward(cell, kind)) : undefined;
        if (dest) put(dest, kind, leaving);
        put(key, kind, dest ? n - leaving : n);
      }
    }

    // A pack answers to the ground like anyone: what cannot be fed thins it, and nothing else does
    for (const id of Object.keys(leaders).sort()) {
      const leader = leaders[id];
      const fed = fedAt.get(leader.at);
      const def = defOf(leader.kind);
      const cell = land.get(leader.at);
      if (!leader.alive || !fed || !def || !cell) continue;
      const short = 1 - (fed.get(def.leads ?? def.id) ?? 1);
      if (short > 0) leaders[id] = { ...leader, pack: leader.pack - Math.min(leader.pack, shareOf(leader.pack * short * LAND_NUMBERS.starve, starved(cell, id))) };
    }

    // What the land stood at alpha walks back in, a body at a time, once it has gone: sectors trade no bodies, so this is the world outside
    for (const cell of land.values()) {
      for (const kind of Object.keys(cell.alpha).sort()) {
        if ((out[cell.key]?.[kind] ?? 0) === 0 && returning(cell, kind) < LAND_NUMBERS.returns) put(cell.key, kind, 1);
      }
    }

    // D93: who holds what. Who takes an empty seat first, then what each place decides this cycle
    const registers = { ...koseki };
    const cycle = { seed, sx, sy, g, land, counts: out, leaders, koseki: registers, record, context };
    for (const { fallen, territory } of vacant) Territory.seatFallen(cycle, fallen, territory);
    Territory.cycle(cycle);
    const written = Object.keys(registers).length > 0 ? registers : undefined;

    return { generation: g + 1, ground: out, leaders, ...(written ? { koseki: written } : {}) };
  }

  /** A leader fell: into its register it goes, and the next of its pack takes the head. With no pack, the line ends. */
  private static succeed(
    seed: string, fallen: ILeaderState, koseki: ISectorState['koseki'], sectorKey: string, g: number, context: IGenerationContext
  ): { koseki: NonNullable<ISectorState['koseki']>; heir?: ILeaderState } {
    const slot = fallen.register ?? fallen.id.replace(/_h\d+$/, '');
    let register = koseki?.[slot] ?? Koseki.found(sectorKey, fallen.id, fallen.kind, 0);
    const heirId = fallen.pack > 0 ? `${slot}_h${register.entries.length}` : undefined;
    if (heirId) register = Koseki.bear(register, heirId, fallen.kind, [fallen.id], g);
    register = Koseki.exit(register, fallen.id, 'fell', g);
    const written = { ...koseki, [slot]: register };
    if (!heirId) return { koseki: written };
    const sheet = Leaders.sheetOf(seed, { id: heirId, kind: fallen.kind, cx: 0, cy: 0, pack: 0 }, context);
    return {
      koseki: written,
      // Behind a boss, the heir stands as a contender for its seat, as a band does
      heir: {
        id: heirId, kind: fallen.kind, at: fallen.at, pack: fallen.pack - 1, goal: sheet.goal, tenure: 0, alive: true, log: [],
        ...(fallen.answersTo || fallen.territory ? { answersTo: fallen.answersTo ?? fallen.id, goal: 'hold' as Goal } : {})
      }
    };
  }

  /** Bodies of a kind that has changed stand as what it became, a keyed share each cycle. A count moves, and no body is named. */
  private static changeOfForm(counts: ISectorState['ground'], land: Map<string, ILandCell>, context: IGenerationContext, u: (g: ILandCell, k: string) => number, g: number) {
    // Only what stood by the cycle this one closes into: a sector read late folds as one read early did
    const nodes = Object.values(context.director?.lines?.nodes ?? {}).filter(n => n.bornAt <= g + 1);
    if (nodes.length === 0) return;
    for (const key of Object.keys(counts).sort()) {
      const cell = land.get(key);
      const on = counts[key];
      if (!cell) continue;
      for (const kind of Object.keys(on).sort()) {
        const children = nodes.filter(n => n.parents.includes(kind) && defOf(n.id)).map(n => n.id).sort();
        if (children.length === 0 || on[kind] <= 0) continue;
        const changed = Math.min(on[kind], shareOf(on[kind] * LAND_NUMBERS.changeShare, u(cell, kind)));
        if (changed <= 0) continue;
        const child = children[Math.floor(u(cell, `${kind}:child`) * children.length)];
        on[kind] -= changed;
        on[child] = (on[child] ?? 0) + changed;
      }
    }
  }

  /** Bodies counted under a plain kind stand under the words that replaced it. The same bodies: only the name moved. */
  private static underTheirWords(state: ISectorState, context: IGenerationContext): ISectorState {
    const words = wordsFor(context);
    if (![...words.keys()].some(was => Object.values(state.ground).some(on => on[was]))) return state;
    const ground: ISectorState['ground'] = {};
    for (const [at, on] of Object.entries(state.ground)) {
      ground[at] = {};
      for (const [kind, n] of Object.entries(on)) {
        const named = words.get(kind) ?? kind;
        ground[at][named] = (ground[at][named] ?? 0) + n;
      }
    }
    return { ...state, ground };
  }

  /** Where a group walks: the next chunk it can stand on with the most to spare, keyed among those that have any. */
  private static walkTo(cell: ILandCell, def: IKindDef, land: Map<string, ILandCell>, spare: Map<string, number>, u: number): string | undefined {
    const open = cell.beside.map(k => land.get(k)!).filter(c => this.canStand(def, c));
    if (open.length === 0) return undefined;
    const room = open.filter(c => (spare.get(c.key) ?? 0) > 0);
    if (room.length > 0) return room[Math.floor(u * room.length)].key;
    return open.reduce((best, c) => ((spare.get(c.key) ?? 0) > (spare.get(best.key) ?? 0) ? c : best)).key;
  }

  /** A leader's cycle: what fell, the goal's outcome, what that does, and where it walks next. */
  private static stepLeader(
    seed: string, sx: number, sy: number, leader: ILeaderState, counts: ISectorState['ground'], land: Map<string, ILandCell>, g: number,
    record: Pick<IPopulationRecord, 'down' | 'seen'>, context: IGenerationContext, held: Set<string>
  ): ILeaderState {
    if (!leader.alive) return leader;
    const def = defOf(leader.kind);
    const leads = def?.leads;
    let lost = 0;
    for (let i = 0; i < leader.pack; i++) if (record.down[`${leader.id}_f${i}`]?.at === g) lost++;
    const pack = leader.pack - lost;
    // Brought down, it stays down. Who comes next is its register's to say (`succeed`)
    if (record.down[leader.id]?.at === g) return { ...leader, pack, alive: false };
    // A band holds the ground it was given. Its boss's cycle decides everything else
    if (leader.answersTo) return { ...leader, pack };

    const seedOf: ILeaderSeed = { id: leader.id, kind: leader.kind, cx: 0, cy: 0, pack: 0 };
    const sheet = Leaders.sheetOf(seed, seedOf, context);
    const rng = Rng.fromKey(`${seed}:goal:${leader.id}:${g}`);
    const seen = record.seen[leader.id]?.includes(g) ?? false;
    const band = GOAL_BANDS[leader.goal];
    let entry: IGoalEntry;
    if (seen) {
      // What a person saw must stay true: it stands if it keeps most of its pack, and they can really stop it
      entry = { generation: g, goal: leader.goal, seen: true, outcome: leader.pack === 0 || pack * 2 > leader.pack ? 'done' : 'failed' };
    } else {
      const rolled = rng.int(1, 21);
      const bonus = Math.floor(((sheet.stats as unknown as Record<string, number>)[band.stat] ?? 0) / 2);
      const by = rolled + bonus - band.dc;
      entry = { generation: g, goal: leader.goal, seen: false, rolled, outcome: by >= 0 ? 'done' : 'failed', ...(by >= GOAL_GREAT_BY ? { great: true } : {}) };
    }

    const next: ILeaderState = { ...leader, pack, log: [...leader.log, entry].slice(-LOG_KEPT) };
    const cell = land.get(leader.at);
    if (!cell) return next;
    const done = entry.outcome === 'done';
    // D62: it walks for the ground in this sector that best holds what its hands work, and nobody holds
    const workTowards = () => {
      const trade = Leaders.tradeOf(sheet, context);
      const target = Territory.bestGround(seed, sx, sy, trade, held, context);
      const standsHere = (c: ILandCell) => !def || this.canStand(def, c);
      if (target) return Territory.stepTowards(cell, target, land, standsHere);
      return cell.beside.map(k => land.get(k)!).find(standsHere)?.key;
    };

    if (done) {
      if (leader.goal === 'grow' && leads) next.pack += entry.great ? 2 : 1;
      if (leader.goal === 'hunt') {
        // It feeds the pack from what stands on its ground, and a head joins it
        const prey = Object.keys(counts[leader.at] ?? {}).sort().find(k => k !== leads && defOf(k)?.tree === 'animal' && counts[leader.at][k] > 0);
        if (prey) { counts[leader.at][prey] -= 1; if (leads) next.pack += 1; }
      }
      if (leader.goal === 'take') {
        // It holds its ground: what is not its own gives way
        for (const rival of Object.keys(counts[leader.at] ?? {}).sort()) {
          const rivalDef = defOf(rival);
          if (rival === leads || !rivalDef || oneOfAKind(rivalDef)) continue;
          counts[leader.at][rival] -= Math.min(counts[leader.at][rival], shareOf(counts[leader.at][rival] * LAND_NUMBERS.takeShare, rng.next()));
        }
      }
      if (leader.goal === 'settle' && !leader.territory && !held.has(leader.at) && Leaders.groundWorks(seed, cell.cx, cell.cy, sheet, context)) next.settledAt = leader.at;
      if (leader.goal === 'waylay') {
        // It stands in the way, and what crosses its ground pays or fights. No gold on this side: a kind has no purse
        let taken = 0;
        for (const crossing of Object.keys(counts[leader.at] ?? {}).sort()) {
          const crossingDef = defOf(crossing);
          if (!crossingDef || oneOfAKind(crossingDef)) continue;
          const pays = Math.min(counts[leader.at][crossing], shareOf(counts[leader.at][crossing] * LAND_NUMBERS.takeShare, rng.next()));
          counts[leader.at][crossing] -= pays;
          taken += pays;
        }
        next.tollTaken = taken;
      }
    }

    // A goal it means to keep walks it there. What is done takes the next from what it now is; what failed may try again, keyed.
    if (leader.goal === 'settle' && !next.settledAt && !leader.territory && (held.has(leader.at) || !Leaders.groundWorks(seed, cell.cx, cell.cy, sheet, context))) {
      const to = workTowards();
      if (to) next.at = to;
    } else if (def?.social && !next.settledAt && !leader.territory && leader.goal !== 'waylay' && rng.next() < numbersOf(def).roam) {
      const open = cell.beside.map(k => land.get(k)!).filter(c => this.canStand(def, c));
      if (open.length > 0) {
        // A hunting pack goes where the food is; otherwise its leader takes it where it will
        next.at = leader.goal === 'hunt' ? open.reduce((best, c) => (c.food > best.food ? c : best)).key : open[rng.int(0, open.length)].key;
      }
    }
    if (done) {
      next.tenure = leader.tenure + 1;
      next.goal = next.settledAt && leader.goal === 'settle' ? 'grow' : Leaders.dealGoal(`${seed}:leader:${leader.id}:goal:${next.tenure}`, def ?? {}, { skills: sheet.skills, drive: rng.next() < 0.5 ? sheet.drive : '' });
    } else if (rng.next() < 0.5) {
      next.goal = Leaders.dealGoal(`${seed}:leader:${leader.id}:retry:${g}`, def ?? {}, { skills: sheet.skills, drive: '' });
    }
    return next;
  }

  /**
   * This sector at this cycle, as the record has it, folded forward from what it last knew. The
   * record keeps the answer, and lets go of what fell or was seen in cycles it has now folded.
   */
  static sectorAt(record: IPopulationRecord, seed: string, sx: number, sy: number, generation: number, context: IGenerationContext): ISectorState {
    const key = `${sx},${sy}`;
    let state = record.sectors[key];
    if (!state) state = this.alpha(seed, sx, sy, context);
    state = this.underTheirWords(state, context);
    if (state.generation < generation) {
      while (state.generation < generation) state = this.step(seed, sx, sy, state, record, context);
      for (const [id, entry] of Object.entries(record.down)) if (entry.sector === key && entry.at < state.generation) delete record.down[id];
      if (record.released) {
        const done = state.generation;
        const left = record.released.filter(body => sectorKeyOf(body.ground) !== key || body.at >= done);
        if (left.length !== record.released.length) record.released = left;
      }
      for (const [id, entry] of Object.entries(record.carried ?? {})) if (entry.sector === key && entry.at < state.generation) delete record.carried![id];
      for (const id of Object.keys(state.leaders)) {
        const kept = record.seen[id]?.filter(at => at >= state.generation);
        if (kept) { if (kept.length > 0) record.seen[id] = kept; else delete record.seen[id]; }
      }
    }
    record.sectors[key] = state;
    return state;
  }

  // -------------------------------------------------------------------------
  // WHAT THE RECORD LAYS OVER A CHUNK
  // -------------------------------------------------------------------------

  /** Who stands on this chunk at this cycle. At alpha only what fell is taken away. */
  static layOver(seed: string, chunk: IChunk, record: IPopulationRecord, generation: number, context: IGenerationContext): void {
    const fellNow = (id: string) => record.down[id]?.at === generation;
    // Let go this cycle: it stands here now, and it is a count once the cycle closes
    const releasedHere = (): IBodyToStand[][] => (record.released ?? [])
      .filter(body => body.at === generation && body.ground === keyOfGround(chunk.x, chunk.y) && defOf(body.kind))
      .map((body, i) => [{ id: `rel_${chunk.x}_${chunk.y}_${i}`, def: defOf(body.kind)! }]);
    // Pedro's own run, 2026-11-10: "the NPC are extracted and respawn". Whoever left does not stand here again
    const gone = record.left;
    if (gone) chunk.entities = chunk.entities.filter(e => e.type !== EntityType.NPC || !gone[e.id]);
    if (generation <= 0) {
      chunk.entities = chunk.entities.filter(e => e.type !== EntityType.MOB || !fellNow(e.id));
      const lands = releasedHere();
      if (lands.length > 0) WorldGenerator.standBodies(seed, chunk, lands, context);
      return;
    }

    const sx = Math.floor(chunk.x / SECTOR_CHUNKS), sy = Math.floor(chunk.y / SECTOR_CHUNKS);
    const state = this.sectorAt(record, seed, sx, sy, generation, context);
    const ground = keyOfGround(chunk.x, chunk.y);
    chunk.entities = chunk.entities.filter(e => e.type !== EntityType.MOB || (!this.isCounted(e.id) && !Leaders.herdOf(e.id)));

    const groups: IBodyToStand[][] = [];
    const on = state.ground[ground] ?? {};
    for (const kind of Object.keys(on).sort()) {
      const def = defOf(kind);
      if (!def) continue;
      const bodies: IBodyToStand[] = [];
      for (let i = 0; i < on[kind]; i++) {
        const id = this.bodyId(ground, kind, i);
        if (!fellNow(id)) bodies.push({ id, def });
      }
      if (def.social) groups.push(bodies);
      else bodies.forEach(b => groups.push([b]));
    }
    for (const id of Object.keys(state.leaders).sort()) {
      const leader = state.leaders[id];
      if (!leader.alive || leader.at !== ground) continue;
      const def = defOf(leader.kind);
      if (!def) continue;
      const numbers = Leaders.numbers(seed, { id, kind: leader.kind, cx: 0, cy: 0, pack: 0 }, context);
      const bodies: IBodyToStand[] = [];
      if (!fellNow(id)) bodies.push({ id, def, ...numbers });
      const led = def.leads ? defOf(def.leads) : undefined;
      if (led) for (let i = 0; i < leader.pack; i++) if (!fellNow(`${id}_f${i}`)) bodies.push({ id: `${id}_f${i}`, def: led });
      groups.push(bodies);
    }
    groups.push(...releasedHere());
    WorldGenerator.standBodies(seed, chunk, groups, context);
    Territory.layOver(seed, chunk, state, record, generation);
  }

  /** A person brought out of this world, at this cycle. The same record back when they had already left. */
  static left(record: IPopulationRecord, personId: string, generation: number): IPopulationRecord {
    if (record.left?.[personId]) return record;
    return { ...record, left: { ...record.left, [personId]: { at: generation } } };
  }

  /** A body let go on this ground, at this cycle. Whether it may be is the person's and the map's to say. */
  static release(record: IPopulationRecord, ground: string, kind: string, generation: number): IPopulationRecord {
    return { ...record, released: [...(record.released ?? []), { ground, kind, at: generation }] };
  }

  /**
   * D65: a body taken alive. It comes off its count as if it had fallen, and it moves from
   * whatever register holds it onto the person's, through the one door a move has. A body of an
   * ordinary herd has no register until now, so one is written for it. One from a leader's pack
   * leaves that leader's.
   */
  static captured(record: IPopulationRecord, bodyId: string, kind: string, generation: number, to: IKoseki): { record: IPopulationRecord; to: IKoseki } {
    const herd = Leaders.herdOf(bodyId);
    const follower = herd && Leaders.isLeader(herd) && herd !== bodyId ? herd : undefined;
    const place = /^(?:pop|ent|lead)_(-?\d+)_(-?\d+)_/.exec(bodyId);
    const sector = place ? (bodyId.startsWith('lead_') ? `${place[1]},${place[2]}` : sectorKeyOf(this.groundOfBody(bodyId) ?? `${place[1]},${place[2]}`)) : 'field';
    const taken = record.taken ?? {};
    const founder = follower ?? bodyId;
    const registerId = Koseki.found(sector, founder, kind, generation).id;
    let from = taken[registerId] ?? Koseki.found(sector, founder, kind, generation);
    if (follower) from = Koseki.bear(from, bodyId, kind, [follower], generation);
    const moved = Koseki.adopt(from, to, bodyId, kind, generation);
    const fallen = this.fell(record, bodyId, kind, generation);
    return { record: { ...fallen, taken: { ...taken, [registerId]: moved.from } }, to: moved.to };
  }

  /** The ground a counted body's name says it stands on. */
  private static groundOfBody(bodyId: string): string | undefined {
    const place = /^(pop|ent)_(-?\d+)_(-?\d+)_/.exec(bodyId);
    if (!place) return undefined;
    const x = Number(place[2]), y = Number(place[3]);
    return place[1] === 'ent' ? keyOfGround(Math.floor(x / CHUNK_QUADRANTS), Math.floor(y / CHUNK_QUADRANTS)) : keyOfGround(x, y);
  }

  /** A body fell. A count falls by one when its cycle closes, and it stays down until then. */
  static fell(record: IPopulationRecord, bodyId: string, kind: string, generation: number): IPopulationRecord {
    const herd = Leaders.herdOf(bodyId);
    if (!herd) return record;
    const place = /^(pop|ent|lead)_(-?\d+)_(-?\d+)_/.exec(bodyId);
    if (!place) return record;
    const [, form, a, b] = place;
    const x = Number(a), y = Number(b);
    // An alpha body is named for its quadrant, a counted one for its chunk, and a leader's for its sector
    const ground = form === 'ent' ? keyOfGround(Math.floor(x / CHUNK_QUADRANTS), Math.floor(y / CHUNK_QUADRANTS)) : form === 'pop' ? keyOfGround(x, y) : undefined;
    const sector = ground ? sectorKeyOf(ground) : `${x},${y}`;
    return { ...record, down: { ...record.down, [bodyId]: { at: generation, kind, sector, ...(ground ? { ground } : {}) } } };
  }

  /** D93: a structure that stayed down when the world closed. A post that relit in play never reaches here. */
  static broke(record: IPopulationRecord, structureId: string, generation: number): IPopulationRecord {
    const place = /^lead_(-?\d+)_(-?\d+)_/.exec(structureId);
    if (!place || !Territory.isStructure(structureId)) return record;
    return { ...record, down: { ...record.down, [structureId]: { at: generation, kind: 'structure', sector: `${Number(place[1])},${Number(place[2])}` } } };
  }

  /** D93: what a person carried out of a store. The place is that much poorer when the cycle closes. */
  static robbed(record: IPopulationRecord, structureId: string, n: number, generation: number): IPopulationRecord {
    const place = /^lead_(-?\d+)_(-?\d+)_/.exec(structureId);
    if (!place || n <= 0) return record;
    const had = record.carried?.[structureId]?.at === generation ? record.carried[structureId].n : 0;
    return { ...record, carried: { ...record.carried, [structureId]: { at: generation, n: had + n, sector: `${Number(place[1])},${Number(place[2])}` } } };
  }

  /** D93: who was seen this cycle. Only a leader has a goal to be seen at. */
  static saw(record: IPopulationRecord, bodyIds: string[], generation: number): IPopulationRecord {
    let seen = record.seen;
    for (const id of bodyIds) {
      if (!Leaders.isLeader(id) || seen[id]?.includes(generation)) continue;
      seen = { ...seen, [id]: [...(seen[id] ?? []), generation] };
    }
    return seen === record.seen ? record : { ...record, seen };
  }
}

const docId = (worldUid: string) => `world_population_${worldUid}`;

export const PopulationStore = {
  async load(worldUid: string): Promise<IPopulationRecord> {
    const doc = await VectorStore.get<IPopulationRecord>(VectorNamespace.TERRITORIES, docId(worldUid));
    return doc?.data ?? emptyPopulationRecord();
  },

  async save(worldUid: string, record: IPopulationRecord): Promise<void> {
    await VectorStore.put({
      id: docId(worldUid), namespace: VectorNamespace.TERRITORIES, data: JSON.parse(JSON.stringify(record)) as IPopulationRecord,
      metadata: { createdAt: Date.now(), updatedAt: Date.now(), ownerCertUid: 'SYSTEM', version: 1 }
    });
  }
};
