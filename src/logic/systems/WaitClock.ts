/**
 * THE WAIT CLOCK (line 124; Pedro, 2026-11-01: "many of the waiting mechanics feels like
 * the game froze"): what a wait reads as, whoever is drawing it.
 *
 * Pure: the time goes in, so every wait in the game reads the same way. A wait with a
 * known end has a share and a time left. A wait with no known end has only a block that
 * moves, and never a percentage it cannot know.
 */

/** The steps a bar fills in: read, not eased. The kit's Bar quantizes to the same twentieths. */
export const WAIT_STEPS = 20;
/** How many cells the block of an open-ended wait walks across, and how long it stands on each. */
export const SWEEP_CELLS = 5;
export const SWEEP_STEP_MS = 250;

const MIN_TICK_MS = 100;
const MAX_TICK_MS = 1000;

export interface IWaitReading {
  share: number;
  leftMs: number;
  done: boolean;
}

export interface IHubWait {
  id: string;
  label: string;
  startedAt: number;
  until: number;
}

interface ICraftLike { id: string; lotId: string; recipeId: string; ownerCertUid: string; queuedAt: number; finishesAt: number; collected: boolean }
interface IBuildLike { lotId: string; kind: string; structureType?: string; ownerCertUid: string; queuedAt: number; finishesAt: number; applied: boolean }

/** One row a lot, from its first start to its last finish, so a plan of a hundred steps is one line. */
function rowsByLot<T extends { lotId: string; queuedAt: number; finishesAt: number }>(jobs: T[], id: string, labelOf: (group: T[]) => string): IHubWait[] {
  const lots = new Map<string, T[]>();
  for (const job of jobs) lots.set(job.lotId, [...(lots.get(job.lotId) ?? []), job]);
  return [...lots.entries()].map(([lotId, group]) => ({
    id: `${id}_${lotId}`,
    label: labelOf(group),
    startedAt: Math.min(...group.map(j => j.queuedAt)),
    until: Math.max(...group.map(j => j.finishesAt))
  }));
}

export const WaitClock = {
  read(startedAt: number, until: number, now: number): IWaitReading {
    const span = until - startedAt;
    const share = span <= 0 ? 1 : Math.max(0, Math.min(1, (now - startedAt) / span));
    return { share, leftMs: Math.max(0, until - now), done: now >= until };
  },

  /** As often as a step moves, and at least once a second, because the number still counts. */
  tickMs(startedAt: number, until: number): number {
    return Math.max(MIN_TICK_MS, Math.min(MAX_TICK_MS, (until - startedAt) / WAIT_STEPS));
  },

  /** Where the block of an open-ended wait stands. It walks across and starts again. */
  sweepAt(elapsedMs: number): number {
    return Math.floor(Math.max(0, elapsedMs) / SWEEP_STEP_MS) % SWEEP_CELLS;
  },

  /** What this person has running in the city right now. */
  hubWaits(crafts: ICraftLike[], builds: IBuildLike[], ownerId: string, nameOf: (recipeId: string) => string, now: number): IHubWait[] {
    const running = <T extends { ownerCertUid: string; finishesAt: number }>(jobs: T[]) =>
      jobs.filter(j => j.ownerCertUid === ownerId && j.finishesAt > now);
    return [
      ...rowsByLot(running(crafts.filter(j => !j.collected)), 'bench', group =>
        group.length === 1 ? nameOf(group[0].recipeId).toUpperCase() : `${group.length} ON THE BENCH`),
      ...rowsByLot(running(builds.filter(j => !j.applied)), 'build', group => {
        const shell = group.find(j => j.kind === 'SHELL');
        return shell ? `RAISING A ${shell.structureType}` : `${group.length} STEP${group.length === 1 ? '' : 'S'} TO BUILD`;
      })
    ];
  },

  /** Jobs that have finished since last asked. Each is told once. */
  newlyReady<T extends ICraftLike>(crafts: T[], ownerId: string, told: Set<string>, now: number): T[] {
    const ready = crafts.filter(j => j.ownerCertUid === ownerId && !j.collected && j.finishesAt <= now && !told.has(j.id));
    for (const job of ready) told.add(job.id);
    return ready;
  }
};
