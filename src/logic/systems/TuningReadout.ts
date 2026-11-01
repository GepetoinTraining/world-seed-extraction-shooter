/**
 * THE TUNING READOUT (D84, line 127): "add this for us to check the chance of things
 * changing." Time is the real resource, so these numbers get looked at, not guessed.
 *
 * It reads and tunes nothing. Every number comes from the module that owns it, by name,
 * and nothing here is a copy: change a rate there and this says so. The one thing no
 * module owns is how fast a person goes, so that comes in as an argument, as what it is.
 */

import { UniversalRank, Rarity, IPlayer } from '../../../types';
import { Director, IDirectorRecord } from '../../entities/world/Director';
import { IClockedWorld, WorldClock, WorldPhase } from '../../entities/world/WorldClock';
import { ProgressionSystem } from '../../entities/player/systems/ProgressionSystem';
import { MOB_DEFINITIONS } from '../../entities/mob/data/mobDefinitions';
import { ContentRegistry } from '../theme/ContentRegistry';
import { PROCESS_SKILL_XP_PER_JOB } from './ProcessSystem';
import { REST_MARK_ENERGY, RestSystem } from './RestSystem';
import { StatSystem } from './StatSystem';
import { MASTERY_RUNGS, RUNG_XP } from './WebSystem';

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/** The learn chance is private to the Director, so it is measured through its one door. */
const LEARN_SAMPLES = 40_000;

export interface ICreatureKind { id: string; name: string }

export interface IChanceAt {
  /** How many regenerations from the one this world stands at. */
  ahead: number;
  generation: number;
  /** As the Director reads it. It can pass 1, and that is the thing to see. */
  chance: number;
  /** A body learning magic: what the Director's chance becomes after its learn share. */
  learn: number;
}

export interface IKindRead extends ICreatureKind {
  weight: number;
  at: IChanceAt[];
  /** The first generation whose chance reaches 1, or null if it never will at this weight. */
  certainAt: { generation: number; msFromNow: number } | null;
}

export interface IWorldRead {
  /** A simulation stands outside the clock, and never regenerates. */
  clocked: boolean;
  phase: WorldPhase;
  generation: number;
  /** What the saved record says, before the world is opened and it catches up. */
  recordGeneration: number;
  regenerationsPerDay: number;
  nextRegenerationMs: number | null;
  kinds: IKindRead[];
}

export interface IRungRead { name: string; totalXp: number; xp: number; jobs: number; ms: number }
export interface ILevelRead { level: number; xp: number; totalXp: number; kills: number; ms: number }
export interface IRestRead { spent: number; share: number; ms: number }

let learnShareRead: number | null = null;

export class TuningReadout {

  private static period(world: IClockedWorld): number {
    const c = world.cadence ?? WorldClock.cadenceFor(world.size);
    return c.upMs + c.offMs + c.scanMs;
  }

  static regenerationsPerDay(world: IClockedWorld): number {
    return world.isDebug ? 0 : DAY_MS / this.period(world);
  }

  /** When a generation begins: a world regenerates when it starts to boot, and alpha is its mint. */
  static whenGeneration(world: IClockedWorld, generation: number): number {
    if (generation <= 0) return world.createdAt;
    const c = world.cadence ?? WorldClock.cadenceFor(world.size);
    return world.createdAt + (generation - 1) * this.period(world) + c.upMs + c.offMs;
  }

  /** The record as opening the world would leave it: read here, and never saved. */
  static caughtUp(world: IClockedWorld, record: IDirectorRecord, now: number): IDirectorRecord {
    return Director.catchUp(record, WorldClock.momentAt(world, now).generation);
  }

  /** Measured through `variantOf`, once. A body whose trait chance reads exactly 1 learns at this share. */
  static learnShare(): number {
    if (learnShareRead !== null) return learnShareRead;
    const id = 'readout_probe';
    const unit = Director.traitChance({ generation: 1, felled: {}, fell: {}, weights: { [id]: 1 } }, id);
    const record: IDirectorRecord = { generation: 1, felled: {}, fell: {}, weights: { [id]: 1 / unit } };
    const pool = { affixes: [], abilities: ['readout_ability'] };
    let learned = 0;
    for (let i = 0; i < LEARN_SAMPLES; i++) {
      if (Director.variantOf('readout', `body_${i}`, id, id, record, pool).learned.length > 0) learned++;
    }
    learnShareRead = learned / LEARN_SAMPLES;
    return learnShareRead;
  }

  /** The first generation at which this kind's chance reaches 1, at the weight it holds now. */
  static firstCertain(record: IDirectorRecord, definitionId: string): number | null {
    const at = (generation: number) => Director.traitChance({ ...record, generation }, definitionId);
    if (at(record.generation) >= 1) return record.generation;
    let low = record.generation;
    let high = low + 1;
    while (at(high) < 1) {
      // Not rising means never, and that is an answer to show. There is no bound to run into.
      if (at(high) <= at(low) || !Number.isSafeInteger(high * 2)) return null;
      low = high;
      high = high * 2;
    }
    while (high - low > 1) {
      const mid = Math.floor((low + high) / 2);
      if (at(mid) >= 1) high = mid; else low = mid;
    }
    return high;
  }

  /** The kinds a world holds: its theme's, or the tables', and any its record still remembers. */
  static kindsOf(themeId: string | undefined, record?: IDirectorRecord): ICreatureKind[] {
    const defs = ContentRegistry.compiled(themeId)?.mobs ?? MOB_DEFINITIONS;
    const kinds = new Map<string, string>(Object.values(defs).map(d => [d.id, d.name]));
    for (const id of Object.keys(record?.weights ?? {})) if (!kinds.has(id)) kinds.set(id, id);
    return [...kinds].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * @param aheads which regenerations to read, counted from the one the world stands at.
   * A forecast holds each weight where it stands: what the fights will do to it is not known.
   */
  static readWorld(world: IClockedWorld, record: IDirectorRecord, kinds: ICreatureKind[], now: number, aheads: number[]): IWorldRead {
    const moment = WorldClock.momentAt(world, now);
    const caught = this.caughtUp(world, record, now);
    const share = this.learnShare();
    const clocked = !world.isDebug;

    return {
      clocked,
      phase: moment.phase,
      generation: moment.generation,
      recordGeneration: record.generation,
      regenerationsPerDay: this.regenerationsPerDay(world),
      nextRegenerationMs: clocked ? this.whenGeneration(world, moment.generation + 1) - now : null,
      kinds: kinds.map(kind => {
        const at = aheads.map(ahead => {
          const generation = moment.generation + ahead;
          const chance = Director.traitChance({ ...caught, generation }, kind.id);
          return { ahead, generation, chance, learn: Math.min(1, chance * share) };
        });
        const certain = clocked ? this.firstCertain(caught, kind.id) : null;
        return {
          ...kind,
          weight: caught.weights[kind.id] ?? 1,
          at,
          certainAt: certain === null ? null : { generation: certain, msFromNow: Math.max(0, this.whenGeneration(world, certain) - now) }
        };
      })
    };
  }

  /** @param jobsPerHour how fast a person works: the reader's assumption, never a number in the game. */
  static skillRungs(jobsPerHour: number): IRungRead[] {
    return MASTERY_RUNGS.map((name, i) => {
      const xp = i === 0 ? 0 : RUNG_XP[i] - RUNG_XP[i - 1];
      const jobs = Math.ceil(xp / PROCESS_SKILL_XP_PER_JOB);
      return { name, totalXp: RUNG_XP[i], xp, jobs, ms: (jobs / jobsPerHour) * HOUR_MS };
    });
  }

  /** @param killsPerHour how fast a person fells things of this rank: again the reader's assumption. */
  static levels(levels: number[], killsPerHour: number, rank: UniversalRank = UniversalRank.F): ILevelRead[] {
    const perKill = ProgressionSystem.calculateKillXp(rank, Rarity.COMMON);
    return levels.map(level => {
      const xp = ProgressionSystem.getXpToNextLevel(level);
      const kills = Math.ceil(xp / perKill);
      return { level, xp, totalXp: ProgressionSystem.getXpForLevel(level + 1), kills, ms: (kills / killsPerHour) * HOUR_MS };
    });
  }

  /** The rest curve for this body, at shares of what it can hold, and at the mark the curve is anchored on. */
  static restCurve(player: IPlayer, shares: number[]): IRestRead[] {
    const full = StatSystem.maxEnergy(player.attributes, player.equipment);
    const read = (spent: number): IRestRead => ({
      spent, share: full > 0 ? spent / full : 0,
      ms: RestSystem.restMs({ ...player, currentSession: undefined, energyToday: full - spent })
    });
    const spends = [...shares.map(s => Math.round(full * s)), REST_MARK_ENERGY];
    return [...new Set(spends)].sort((a, b) => a - b).map(read);
  }
}
