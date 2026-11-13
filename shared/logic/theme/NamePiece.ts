/**
 * A PIECE A WORLD'S NAMES ARE MADE OF, AS CODE KEEPS IT (C17, C21; one rule since CP29, 2026-11-13).
 *
 * The ground pass and the names pass keep a piece by this rule (`WorldWriter.piecesOf`), and the theme law holds a
 * sealed pack's pieces to it (`ThemeLaw.validate`), so what the writer keeps the law always takes. A piece is never a
 * code word: one with a digit or an underscore is dropped. A stray mark at either end is shed ("Gray-" is "Gray").
 * What is inside stands: an apostrophe, a hyphen, an accented letter or a space ("Kar'eth", "Vel-ar", "Mãe",
 * "Ael ith"), as the well has always named places from them.
 *
 * Words only: no imports, so the pass and the law read the very same rule.
 */

/** The piece as code keeps it, or null when it is dropped. */
export function namePiece(x: unknown): string | null {
  if (typeof x !== 'string') return null;
  const t = x.trim();
  if (!t || /\d/.test(t) || /_/.test(t)) return null;
  const kept = t.replace(/^[^A-Za-z]+|[^A-Za-z]+$/g, '');
  return kept || null;
}

/** Every piece kept from a list, in order, each once. */
export const namePieces = (xs: unknown[] | undefined): string[] =>
  [...new Set((xs ?? []).map(namePiece).filter((p): p is string => p !== null))];

/** A piece stands exactly as the rule leaves it: kept, and unchanged by keeping it again. */
export const isNamePiece = (x: unknown): boolean => typeof x === 'string' && namePiece(x) === x;
