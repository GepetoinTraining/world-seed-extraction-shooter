/**
 * THE SCAN PASS (D69): what a world does with the time it boots in.
 *
 * Pedro: "First we always use the local or compute ... then what's NEW, as in, what
 * rolled a success or gained experience and needs to have a name, a spot, lore...
 * That's what gets batched to the LLM, the main reason for the time of recon is to
 * allow time to generate and not send one huge Json that can croak, it also allows us
 * fine control for load balancing the nexus on the online version."
 *
 * So one step of this pass does, in order: compute, bring back what was filed, install
 * what came back, and file what is due. It keeps nothing in memory. Everything it knows
 * is in the world's record and in the batches written beside it, so it can stop anywhere
 * and pick up, and it holds no reference to a browser: a server can drive these same
 * steps later (D70), with its own room and its own door.
 *
 * Two clients can run it at once. Compute is pure, so they agree. A batch and an answer
 * are each written once, and the first who touches one owns it (D93's rule). Installing
 * is a fold over those answers in a fixed order, so a record one client saved over
 * another's comes right at the next step.
 *
 * It acts only while a world boots: nobody is in the field then, so what stands in a
 * world never changes under someone walking it, and every machine reads the same record
 * for a whole gate.
 *
 * A further step joins COMPUTE_STEPS, and a further ask joins ASK_KINDS, with its prompt
 * beside it in `server/intelligence/prompts.ts`. Nothing else here changes for them.
 */

import { IDirectorRecord } from '../../entities/world/Director';
import { IClockedWorld, WorldClock } from '../../entities/world/WorldClock';
import { fnv1a } from '../rng/DeterministicRNG';
import { ContentRegistry } from '../theme/ContentRegistry';
import { CreatureLines, ILineWorld } from '../theme/CreatureLines';
import { IThemePack } from '../theme/ThemeTypes';
import { WorldGrowth } from '../theme/WorldGrowth';

export interface IScanWorld extends IClockedWorld, ILineWorld {
  id: string;
}

export type WindowOutcome = 'OK' | 'NO_KEY' | 'REFUSED' | 'BUSY' | 'OFFLINE' | 'OUTAGE' | 'CUT_OFF' | 'PENDING' | 'OVER_LIMIT';

export interface IWindowUsage { model: string; inputTokens: number; outputTokens: number; cacheReadTokens: number; usd: number }

/** One small batch. Written once by whoever claims it, and only its owner moves it on. */
export interface IWindowBatch {
  id: string;
  kind: string;
  asks: string[];
  /** The regeneration whose window it went out in. */
  window: number;
  claimedAt: number;
  status: 'CLAIMED' | 'FILED' | 'FAILED';
  batchId?: string;
  ceiling?: number;
  /** A model read it and said no, or ran past its room: it waits for the next window. */
  spoke?: boolean;
  over?: boolean;
  reason?: string;
}

/** What a batch brought back, unjudged. Written once, and the law reads it at every fold. */
export interface IWindowAnswer {
  batch: string;
  data: unknown;
  usage?: IWindowUsage;
}

/** Where a pass keeps its record and its papers. The browser's is `ScanRoom`. */
export interface IScanRoom {
  load(worldId: string): Promise<IDirectorRecord>;
  save(worldId: string, record: IDirectorRecord): Promise<void>;
  catchUp(worldId: string, generation: number, world: ILineWorld): Promise<IDirectorRecord>;
  define(record: IDirectorRecord, themeId?: string): Promise<void>;
  papers(worldId: string): Promise<{ batches: IWindowBatch[]; answers: IWindowAnswer[] }>;
  /** True only for the first who touches this id. */
  claim(worldId: string, batch: IWindowBatch): Promise<boolean>;
  update(worldId: string, batch: IWindowBatch): Promise<void>;
  /** True only for the first who brings this answer. */
  answer(worldId: string, answer: IWindowAnswer): Promise<boolean>;
}

export interface IFiled { status: WindowOutcome; batchId?: string; ceiling?: number; reason?: string }
export interface ICollected { status: WindowOutcome; data?: unknown; usage?: IWindowUsage; reason?: string }

/** The way to a model. A closed door is no error: the world simply goes on, on plain names. */
export interface IScanDoor {
  open(): Promise<boolean>;
  file(id: string, kind: string, asks: unknown[], theme: unknown, spent: number): Promise<IFiled>;
  collect(batchId: string): Promise<ICollected>;
}

export interface ISettled { record: IDirectorRecord; installed: string[]; refused: { order: string; reason: string }[] }

/** One kind of thing a window asks a model for. */
export interface IAskKind {
  kind: string;
  /** How many go in one batch. It keeps a batch small and caps nothing: the rest go in the next. */
  perBatch: number;
  waiting(record: IDirectorRecord): string[];
  /** What a model hears about these. Only what is new. */
  asks(ids: string[], record: IDirectorRecord, pack: IThemePack): unknown[];
  settle(record: IDirectorRecord, data: unknown, world: ILineWorld): Promise<ISettled>;
}

export interface IComputeContext {
  world: ILineWorld;
  /** The record as it stood before the regeneration folded its fights. */
  before: IDirectorRecord;
  /** Did this regeneration just happen, in this call? */
  regenerated: boolean;
}

/** One thing code decides when a world starts to boot. Same record in, same record out. */
export interface IComputeStep {
  name: string;
  run(record: IDirectorRecord, context: IComputeContext): Promise<IDirectorRecord>;
}

export const COMPUTE_STEPS: IComputeStep[] = [
  {
    name: 'growth',
    run: (record, { before, regenerated, world }) => (regenerated ? CreatureLines.orderGrowth(record, before, world, record.generation) : Promise.resolve(record))
  },
  { name: 'plain', run: (record, { world }) => CreatureLines.standPlain(record, world) }
];

export const ASK_KINDS: IAskKind[] = [
  {
    kind: 'line',
    perBatch: 4,
    waiting: record => (record.lines?.pending ?? []).map(o => o.id),
    asks: (ids, record, pack) => record.lines!.pending.filter(o => ids.includes(o.id)).map(o => CreatureLines.askFor(o, pack, record.lines!)),
    settle: (record, data, world) => CreatureLines.settle(record, data, world)
  },
  {
    kind: 'growth',
    perBatch: 1,
    waiting: record => (record.lines?.growing ?? []).map(o => o.id),
    asks: (ids, record, pack) => record.lines!.growing!.filter(o => ids.includes(o.id)).map(o => CreatureLines.askForGrowth(o, pack, record.lines!)),
    settle: (record, data, world) => CreatureLines.settleGrowth(record, data, world)
  }
];

/** How finely a window is cut. A batch that failed tries again at the next slot. A guess until Wave 12. */
export const SLOTS_PER_WINDOW = 60;

const isOutWith = (b: IWindowBatch, answered: Set<string>) => b.status === 'FILED' && !answered.has(b.id);

export interface IPlannedBatch { kind: IAskKind; ids: string[] }

export interface IScanReport {
  phase: 'UP' | 'OFF' | 'SCAN';
  generation: number;
  record?: IDirectorRecord;
  installed: string[];
  refused: { order: string; reason: string }[];
  /** What answers this client was first to bring cost, for its ledger. */
  used: IWindowUsage[];
}

export class ScanPass {

  /** Where in its window a world stands, in slots, on the world's own clock. */
  static slotAt(world: IClockedWorld, now: number): number {
    const moment = WorldClock.momentAt(world, now);
    const scanMs = (world.cadence ?? WorldClock.cadenceFor(world.size)).scanMs;
    return Math.min(SLOTS_PER_WINDOW - 1, Math.floor(((scanMs - moment.msLeft) / scanMs) * SLOTS_PER_WINDOW));
  }

  /**
   * How many batches should have gone by now, so they spread across the window rather
   * than all going at its start. Pure, and the one number a served Nexus would tune.
   */
  static dueCount(done: number, waiting: number, msLeft: number, scanMs: number): number {
    if (waiting === 0) return 0;
    const share = Math.min(1, Math.max(0, 1 - msLeft / scanMs));
    return Math.max(1, Math.ceil(share * (done + waiting)));
  }

  /** Compute, at a boot or on opening: what code decides, before anything reaches a door. */
  static async compute(room: Pick<IScanRoom, 'save' | 'define'>, worldId: string, before: IDirectorRecord, caught: IDirectorRecord, world: ILineWorld): Promise<IDirectorRecord> {
    const context: IComputeContext = { world, before, regenerated: caught.generation > before.generation };
    let next = caught;
    for (const step of COMPUTE_STEPS) next = await step.run(next, context);
    if (next !== caught) {
      await room.save(worldId, next);
      await room.define(next, world.themeId);
    }
    return next;
  }

  /** The batches still to go this window, in an order every client agrees on. */
  static plan(record: IDirectorRecord, batches: IWindowBatch[], answers: IWindowAnswer[], window: number, slot: number, kinds: IAskKind[]): IPlannedBatch[] {
    const answered = new Set(answers.map(a => a.batch));
    const covered = new Set<string>();
    for (const b of batches) {
      const here = b.window === window;
      const out = isOutWith(b, answered);
      const heardThisWindow = here && (answered.has(b.id) || (b.status === 'FAILED' && b.spoke));
      const justClaimed = here && b.status === 'CLAIMED' && b.id.includes(`_${window}_${slot}_`);
      if (out || heardThisWindow || justClaimed) b.asks.forEach(id => covered.add(id));
    }
    const planned: IPlannedBatch[] = [];
    for (const kind of kinds) {
      const waiting = kind.waiting(record).filter(id => !covered.has(id)).sort();
      for (let i = 0; i < waiting.length; i += kind.perBatch) planned.push({ kind, ids: waiting.slice(i, i + kind.perBatch) });
    }
    return planned;
  }

  /** The same batch in the same slot has the same id on every client, and fits the batches API's custom id. */
  private static batchId(kind: string, window: number, slot: number, ids: string[]): string {
    return `${kind}_${window}_${slot}_${fnv1a(ids.join(',')).toString(16)}`;
  }

  /** Bring back what was filed. What is not ready, and what a closed door cannot say, stays out. */
  private static async collect(worldId: string, room: IScanRoom, door: IScanDoor, batches: IWindowBatch[], answers: IWindowAnswer[], used: IWindowUsage[]): Promise<void> {
    const answered = new Set(answers.map(a => a.batch));
    for (const batch of batches.filter(b => isOutWith(b, answered) && b.batchId)) {
      const out = await door.collect(batch.batchId!);
      if (out.status === 'OK') {
        const answer: IWindowAnswer = { batch: batch.id, data: out.data ?? null, ...(out.usage ? { usage: out.usage } : {}) };
        if (await room.answer(worldId, answer) && out.usage) used.push(out.usage);
        answers.push(answer);
        answered.add(batch.id);
      } else if (out.status === 'REFUSED' || out.status === 'CUT_OFF' || out.status === 'OUTAGE') {
        // An outage came back with nothing read, so it tries again. The others were read, and wait for the next window
        const failed: IWindowBatch = { ...batch, status: 'FAILED', spoke: out.status !== 'OUTAGE', ...(out.reason ? { reason: out.reason } : {}) };
        await room.update(worldId, failed);
        batches[batches.indexOf(batch)] = failed;
      }
    }
  }

  /**
   * What came back, judged and installed. A fold in the order batches were claimed, so
   * every client reaches the same record, and a save that lost some of it recovers here.
   */
  private static async fold(record: IDirectorRecord, batches: IWindowBatch[], answers: IWindowAnswer[], world: ILineWorld, kinds: IAskKind[]): Promise<ISettled> {
    const byId = new Map(batches.map(b => [b.id, b]));
    const order = (b?: IWindowBatch) => b?.claimedAt ?? 0;
    const sorted = [...answers].sort((a, b) => order(byId.get(a.batch)) - order(byId.get(b.batch)) || (a.batch < b.batch ? -1 : 1));
    let at = record;
    const installed: string[] = [];
    const refused: ISettled['refused'] = [];
    for (const answer of sorted) {
      const batch = byId.get(answer.batch);
      const kind = kinds.find(k => k.kind === batch?.kind);
      if (!batch || !kind) continue;
      const waiting = new Set(kind.waiting(at));
      if (!batch.asks.some(id => waiting.has(id))) continue;
      const out = await kind.settle(at, answer.data, world);
      at = out.record;
      installed.push(...out.installed);
      // Words for an order this batch already settled are no refusal: they had their turn
      refused.push(...out.refused.filter(r => waiting.has(r.order)));
    }
    return { record: at, installed, refused };
  }

  /** File what is due now. One claim at a time: losing one just means another client has it. */
  private static async file(world: IScanWorld, record: IDirectorRecord, batches: IWindowBatch[], answers: IWindowAnswer[], now: number, room: IScanRoom, door: IScanDoor, kinds: IAskKind[]): Promise<void> {
    const moment = WorldClock.momentAt(world, now);
    const window = moment.generation;
    const scanMs = (world.cadence ?? WorldClock.cadenceFor(world.size)).scanMs;
    const slot = this.slotAt(world, now);
    const here = batches.filter(b => b.window === window);
    if (here.some(b => b.over)) return;
    const answered = new Set(answers.map(a => a.batch));
    const gone = () => batches.filter(b => b.window === window && (b.status === 'FILED' || answered.has(b.id) || b.spoke));
    const pack = WorldGrowth.packWith(ContentRegistry.get(world.themeId ?? ContentRegistry.defaultThemeId())!, record.lines);
    const theme = WorldGrowth.summary(pack);

    const planned = this.plan(record, batches, answers, window, slot, kinds);
    const due = this.dueCount(gone().length, planned.length, moment.msLeft, scanMs);
    for (const { kind, ids } of planned) {
      if (gone().length >= due) return;
      const batch: IWindowBatch = { id: this.batchId(kind.kind, window, slot, ids), kind: kind.kind, asks: ids, window, claimedAt: now, status: 'CLAIMED' };
      if (!(await room.claim(world.id, batch))) continue;
      batches.push(batch);
      const spent = gone().reduce((sum, b) => sum + (b.ceiling ?? 0), 0);
      const out = await door.file(batch.id, kind.kind, kind.asks(ids, record, pack), theme, spent);
      const filed: IWindowBatch = out.status === 'PENDING' && out.batchId
        ? { ...batch, status: 'FILED', batchId: out.batchId, ...(out.ceiling !== undefined ? { ceiling: out.ceiling } : {}) }
        : { ...batch, status: 'FAILED', ...(out.status === 'OVER_LIMIT' ? { over: true } : {}), ...(out.reason ? { reason: out.reason } : {}) };
      await room.update(world.id, filed);
      batches[batches.indexOf(batch)] = filed;
      if (filed.over) return;
    }
  }

  /**
   * One step of the pass, from wherever it stood. Outside a window, nothing. With a
   * closed door, compute still runs and nothing else is written.
   */
  static async step(world: IScanWorld, now: number, room: IScanRoom, door: IScanDoor, kinds: IAskKind[] = ASK_KINDS): Promise<IScanReport> {
    const moment = WorldClock.momentAt(world, now);
    const idle: IScanReport = { phase: moment.phase, generation: moment.generation, installed: [], refused: [], used: [] };
    if (world.isDebug || moment.phase !== 'SCAN' || !ContentRegistry.get(world.themeId ?? ContentRegistry.defaultThemeId())) return idle;

    const lineWorld: ILineWorld = { seed: world.seed, themeId: world.themeId };
    const before = await room.load(world.id);
    const caught = await room.catchUp(world.id, moment.generation, lineWorld);
    const computed = await this.compute(room, world.id, before, caught, lineWorld);
    if (!(await door.open())) return { ...idle, record: computed };

    const { batches, answers } = await room.papers(world.id);
    const used: IWindowUsage[] = [];
    await this.collect(world.id, room, door, batches, answers, used);

    const settled = await this.fold(computed, batches, answers, lineWorld, kinds);
    if (settled.record !== computed) {
      await room.save(world.id, settled.record);
      await room.define(settled.record, world.themeId);
    }
    await this.file(world, settled.record, batches, answers, now, room, door, kinds);
    return { ...idle, record: settled.record, installed: settled.installed, refused: settled.refused, used };
  }

  /**
   * What a person can be told about a world's window: how many, never who. A masked
   * name stays masked (D60), so this is counts.
   */
  static readout(record: IDirectorRecord | null | undefined): { words: number; plain: number; grown: number; writing: number } {
    const lines = record?.lines;
    const nodes = Object.values(lines?.nodes ?? {});
    const at = record?.generation;
    return {
      words: nodes.filter(n => !n.plain && n.bornAt === at).length,
      plain: nodes.filter(n => n.plain).length,
      grown: (lines?.grown ?? []).filter(b => b.bornAt === at).length,
      writing: lines?.growing?.length ?? 0
    };
  }
}
