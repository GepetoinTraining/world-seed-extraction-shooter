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

/**
 * The forming list as shown. D32: an identify skill forming on an unread piece is named only "the eye", so naming which
 * would say what the piece was; several such read alike, and are folded into one row showing the furthest of them.
 */
export const formingWords = (row: { tool: string; worked: string }): string =>
  /identify/.test(row.tool) ? 'the eye' : row.worked ? `${row.tool} on ${row.worked}` : row.tool;

export function foldForming(rows: { tool: string; worked: string; fill: number }[]): { said: string; fill: number }[] {
  const out: { said: string; fill: number }[] = [];
  for (const row of rows) {
    const words = formingWords(row);
    const same = out.find(r => r.said === words);
    if (same) same.fill = Math.max(same.fill, row.fill);
    else out.push({ said: words, fill: row.fill });
  }
  return out.sort((a, b) => b.fill - a.fill);
}
