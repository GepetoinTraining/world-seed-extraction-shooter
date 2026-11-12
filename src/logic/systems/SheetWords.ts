/**
 * WHAT THE SHEETS SAY (2026-11-12, from Pedro's pictures of his large sheet: "130 of 130.35213707168586").
 * Numbers are kept whole or not as their readers make them; what is shown is rounded here, by one rule, and nothing
 * kept is touched.
 */

/** A number as a person reads it: a whole number as it is, whole from ten up, a tenth below ten. */
export const said = (n: number): string => {
  if (!Number.isFinite(n)) return String(n);
  if (Number.isInteger(n)) return String(n);
  if (Math.abs(n) >= 10) return String(Math.round(n));
  return String(Math.round(n * 10) / 10);
};
