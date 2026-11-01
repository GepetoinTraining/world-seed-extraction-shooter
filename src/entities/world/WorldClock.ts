/**
 * THE WORLD CLOCK (D66, D67, D71, D77, D78): a world runs on its own clock, never a person's.
 *
 * A pure function of what its certificate signed and the time, so every machine agrees
 * and a world nobody watched is simply further along when it is opened. A cycle is
 * UP (the gate stands open), OFF (dark), SCAN (booting: recon only, and what regenerated
 * can be read). The gate opens at mint because alpha has nothing to generate. A world
 * regenerates when it starts to boot, so generation 0 is alpha as minted.
 *
 * Worlds minted at different moments stand at different phases, which is what makes a
 * person move between them. Nothing here is a ceiling on size.
 */

export type WorldPhase = 'UP' | 'OFF' | 'SCAN';
/** TURNING has days and nights. LOCKED does not spin. NIGHT never sees a day. */
export type SkyKind = 'TURNING' | 'LOCKED' | 'NIGHT';
export type SkyState = 'DAWN' | 'DAY' | 'DUSK' | 'NIGHT';
export type GateWarning = 'NONE' | 'CLOSING' | 'FINAL';

export interface ICadence {
  upMs: number;
  scanMs: number;
  offMs: number;
}

export interface IClockedWorld {
  createdAt: number;
  size: number;
  /** Signed at mint. A world minted before the clock reads its size. */
  cadence?: ICadence;
  sky?: SkyKind;
  /** The simulation stands outside the clock. */
  isDebug?: boolean;
}

export interface IWorldMoment {
  phase: WorldPhase;
  generation: number;
  msLeft: number;
  next: WorldPhase;
  warning: GateWarning;
  canDeploy: boolean;
  canSurvey: boolean;
}

const M = 60_000, H = 60 * M, D = 24 * H;

/** Pedro's cadences (D67, D78, D80). The biggest world's scan is the builder's reading: 2 of its 7 days on. */
const ANCHORS: { size: number; cadence: ICadence }[] = [
  { size: 16, cadence: { upMs: H, scanMs: 30 * M, offMs: 90 * M } },
  { size: 32, cadence: { upMs: 4 * H, scanMs: H, offMs: 5 * H } },
  { size: 64, cadence: { upMs: 12 * H, scanMs: 4 * H, offMs: 16 * H } },
  { size: 128, cadence: { upMs: 5 * D, scanMs: 2 * D, offMs: 7 * D } }
];

/** The warning runs over the last sixth of the up time, and its last tenth is louder. Guesses until Wave 12. */
const WARNING_SHARE = 1 / 6;
const FINAL_SHARE = 1 / 10;

/** Where a day stands, as a share of its length, from the gate's opening. */
const DAWN_ENDS = 0.1, DAY_ENDS = 0.5, DUSK_ENDS = 0.6;
const LIGHT: Record<SkyState, number> = { DAY: 1, DAWN: 0.55, DUSK: 0.55, NIGHT: 0.15 };
/** In a world that does not spin, the night side and the rim, as a share of its width. */
const NIGHT_SIDE_ENDS = 0.4, RIM_ENDS = 0.6;
/** How much further a thing notices you in full dark. A guess until Wave 12. */
const DARK_NOTICE = 0.5;

const curve = (a: number, b: number, t: number) => Math.round(a * Math.pow(b / a, t));

export class WorldClock {

  /** Pedro's numbers at his sizes, and the curve through them anywhere else. */
  static cadenceFor(size: number): ICadence {
    const exact = ANCHORS.find(a => a.size === size);
    if (exact) return { ...exact.cadence };
    const at = Math.log2(Math.max(1, size));
    let low = ANCHORS[0], high = ANCHORS[1];
    for (let i = 1; i < ANCHORS.length - 1; i++) {
      if (at > Math.log2(ANCHORS[i].size)) { low = ANCHORS[i]; high = ANCHORS[i + 1]; }
    }
    const t = (at - Math.log2(low.size)) / (Math.log2(high.size) - Math.log2(low.size));
    return {
      upMs: curve(low.cadence.upMs, high.cadence.upMs, t),
      scanMs: curve(low.cadence.scanMs, high.cadence.scanMs, t),
      offMs: curve(low.cadence.offMs, high.cadence.offMs, t)
    };
  }

  /** D78: half the up time, so a full visit sees exactly two days. */
  static dayMs(cadence: ICadence): number {
    return cadence.upMs / 2;
  }

  private static place(world: IClockedWorld, now: number) {
    const cadence = world.cadence ?? this.cadenceFor(world.size);
    const period = cadence.upMs + cadence.offMs + cadence.scanMs;
    const elapsed = Math.max(0, now - world.createdAt);
    return { cadence, cycle: Math.floor(elapsed / period), into: elapsed % period };
  }

  static momentAt(world: IClockedWorld, now: number): IWorldMoment {
    if (world.isDebug) {
      return { phase: 'UP', generation: 0, msLeft: Infinity, next: 'UP', warning: 'NONE', canDeploy: true, canSurvey: false };
    }
    const { cadence, cycle, into } = this.place(world, now);
    const { upMs, offMs, scanMs } = cadence;

    if (into < upMs) {
      const msLeft = upMs - into;
      const warnFor = upMs * WARNING_SHARE;
      const warning: GateWarning = msLeft > warnFor ? 'NONE' : msLeft > warnFor * FINAL_SHARE ? 'CLOSING' : 'FINAL';
      return { phase: 'UP', generation: cycle, msLeft, next: 'OFF', warning, canDeploy: true, canSurvey: false };
    }
    if (into < upMs + offMs) {
      return { phase: 'OFF', generation: cycle, msLeft: upMs + offMs - into, next: 'SCAN', warning: 'NONE', canDeploy: false, canSurvey: false };
    }
    return { phase: 'SCAN', generation: cycle + 1, msLeft: upMs + offMs + scanMs - into, next: 'UP', warning: 'NONE', canDeploy: false, canSurvey: true };
  }

  /** @param across where along the world's width, 0 to 1. Only a world that does not spin asks. */
  static skyAt(world: IClockedWorld, now: number, across = 0.5): { state: SkyState; light: number } {
    const read = (state: SkyState) => ({ state, light: LIGHT[state] });
    if (world.isDebug) return read('DAY');
    if (world.sky === 'NIGHT') return read('NIGHT');
    if (world.sky === 'LOCKED') return read(across < NIGHT_SIDE_ENDS ? 'NIGHT' : across < RIM_ENDS ? 'DUSK' : 'DAY');

    const { cadence, into } = this.place(world, now);
    const day = this.dayMs(cadence);
    const share = (into % day) / day;
    return read(share < DAWN_ENDS ? 'DAWN' : share < DAY_ENDS ? 'DAY' : share < DUSK_ENDS ? 'DUSK' : 'NIGHT');
  }

  static noticeFactor(light: number): number {
    return 1 + (1 - light) * DARK_NOTICE;
  }

  /** A length of time, the way a terminal says it. */
  static say(ms: number): string {
    const s = Math.max(0, Math.ceil(ms / 1000));
    const pad = (n: number) => n.toString().padStart(2, '0');
    const days = Math.floor(s / 86400), hours = Math.floor(s / 3600) % 24, minutes = Math.floor(s / 60) % 60;
    if (days > 0) return `${days}d ${pad(hours)}:${pad(minutes)}`;
    return hours > 0 ? `${hours}:${pad(minutes)}:${pad(s % 60)}` : `${minutes}:${pad(s % 60)}`;
  }
}
