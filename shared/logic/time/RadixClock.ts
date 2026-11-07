/**
 * THE RADIX-CHAIN CLOCK (D135), Pedro's: "A moment is a residue vector, not a number"
 * (lettersacrosssubstrate.dev/en/clock). Pure and integer-only, so the browser and a hub read one
 * moment the same way to the last digit.
 *
 *   day index N   days since machine zero, JDN 2451911 (a Monday, 2001-01-01), at the machine
 *                 meridian (Greenwich). The game's own day number is the Unix day, N + 11,323, so
 *                 nothing stored as a day changes
 *   phase layer   N mod 2⁶, 3³, 5², 7², 11², 13²: 43,286,443,200 days with no two alike
 *   inner count   the day read down the radix chain: 3 blocks of 8 hours, 3 segments of 20 minutes,
 *                 10 turns of 6 seconds
 *
 * Rendering for a person keeps the Gregorian shadow beside it; this file only does the arithmetic.
 */

export const MODULI = [64, 27, 25, 49, 121, 169] as const;
export const SPAN = 43_286_443_200;
export const DAY_MS = 86_400_000;
/** JDN 2451911 less the Unix epoch's JDN 2440588: the Unix day that is machine zero. */
export const MACHINE_ZERO_UNIX_DAY = 11_323;
/** The inner count's radices, read down: block, hour, segment, minute, turn, second. */
export const INNER = [3, 8, 3, 20, 10, 6] as const;

export type Residues = [number, number, number, number, number, number];
export type InnerCount = [number, number, number, number, number, number];
export interface IClockAddress { n: Residues; t: InnerCount }

const mod = (a: number, m: number) => ((a % m) + m) % m;

export const dayIndexOf = (ms: number): number => Math.floor(ms / DAY_MS) - MACHINE_ZERO_UNIX_DAY;
export const unixDayOf = (dayIndex: number): number => dayIndex + MACHINE_ZERO_UNIX_DAY;

export const residuesOf = (n: number): Residues => MODULI.map(m => mod(n, m)) as Residues;

/** The inverse of a residue's ring, found by counting: the moduli are small. */
function inverse(a: number, m: number): number {
  for (let x = 1; x < m; x++) if ((a * x) % m === 1) return x;
  return 0;
}

/** Each modulus's share of the whole, and its inverse, worked once. */
const CRT = MODULI.map(m => {
  const share = SPAN / m;
  return { m, share, inv: inverse(share % m, m) };
});

/** The day back from its residues (Chinese remainder), in [0, SPAN); null if they are not residues at all. */
export function dayIndexFrom(r: readonly number[]): number | null {
  if (!Array.isArray(r) || r.length !== MODULI.length) return null;
  let n = 0;
  for (let i = 0; i < MODULI.length; i++) {
    const v = r[i];
    if (!Number.isInteger(v) || v < 0 || v >= MODULI[i]) return null;
    const { m, share, inv } = CRT[i];
    // share × ((v × inv) mod m) stays under 2⁵³, and so does the running sum, taken mod SPAN each step
    n = (n + share * ((v * inv) % m)) % SPAN;
  }
  return n;
}

export function innerCountOf(ms: number): InnerCount {
  let s = Math.floor(mod(ms, DAY_MS) / 1000);
  const out: number[] = [];
  for (let i = INNER.length - 1; i >= 0; i--) {
    out[i] = s % INNER[i];
    s = Math.floor(s / INNER[i]);
  }
  return out as InnerCount;
}

/** Seconds into the day the inner count names; null if it is not one. */
export function secondOfDayFrom(t: readonly number[]): number | null {
  if (!Array.isArray(t) || t.length !== INNER.length) return null;
  let s = 0;
  for (let i = 0; i < INNER.length; i++) {
    if (!Number.isInteger(t[i]) || t[i] < 0 || t[i] >= INNER[i]) return null;
    s = s * INNER[i] + t[i];
  }
  return s;
}

export const addressOf = (ms: number): IClockAddress => ({ n: residuesOf(dayIndexOf(ms)), t: innerCountOf(ms) });

/** Does this address name the moment `ms`, to the second, within the span? */
export function addressMatches(address: { n?: readonly number[]; t?: readonly number[] } | undefined, ms: number): boolean {
  if (!address) return false;
  const n = dayIndexFrom(address.n ?? []);
  const s = secondOfDayFrom(address.t ?? []);
  return n !== null && s !== null && n === mod(dayIndexOf(ms), SPAN) && s === Math.floor(mod(ms, DAY_MS) / 1000);
}

/** "30.15.13.30.0.143 · 1·7:2·0:9·0", the page's own way of writing it. */
export const addressText = ({ n, t }: IClockAddress): string =>
  `${n.join('.')} · ${t[0]}·${t[1]}:${t[2]}·${t[3]}:${t[4]}·${t[5]}`;
