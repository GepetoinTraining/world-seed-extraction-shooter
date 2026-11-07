/**
 * THE ONE THEME (Wave 9.1). Every screen color and text size comes from here,
 * and the machine colors come from the SAME ramps the atoms are drawn with
 * (buildPalette), so a panel border and a sprite can never disagree.
 *
 * Roles, by law (DESIGN_ASK):
 *   void    — what has not been recorded
 *   signal  — living signal: you, what is active, what you can act on
 *   proof   — value and proof: currency, ownership, signatures
 *   loss    — loss, and almost nothing else
 */

import { Genre, Role, STEPS, buildPalette } from '../../../shared/render/atoms/atoms';

/** The bank terminal's own cold genre: UI sprites (items, seals, portraits in
 * panels) are stamped in this, while the city keeps its warm ramp. */
export const TERMINAL_GENRE: Genre = {
  name: 'Terminal',
  palette: ['#23262b', '#aab2bf', '#58c08a', '#d9503f'],
  look: { structure: 'strata', key: 1 }
};

const table = buildPalette(TERMINAL_GENRE);
const hex = (role: Role, step: number) => {
  const i = (1 + role * STEPS + step) * 3;
  return `#${[table[i], table[i + 1], table[i + 2]].map(c => c.toString(16).padStart(2, '0')).join('')}`;
};

const ramp = (role: Role) => [0, 1, 2, 3, 4].map(s => hex(role, s)) as [string, string, string, string, string];

export const MACHINE_COLORS = {
  void: ramp(Role.VOID),     // #030303 … #18181b
  signal: ramp(Role.SIGNAL), // deep emerald … pale signal
  proof: ramp(Role.PROOF),   // dark gold … pale proof
  loss: ramp(Role.LOSS)      // dark red … pale loss
};

/** Text on the void. The old "dimmed" grays fell below reading contrast. */
export const TEXT_COLORS = {
  bright: '#f2f2ee',
  body: '#d6d6cf',
  dim: '#9b9ba4',   // the floor: ~7:1 on void
  ghost: '#6b6b74'  // decorative only (rules, brackets), never for words
};

/** Type scale, px. SMALL IS THE FLOOR — the bar in tests/interface.test.ts. */
export const FONT_PX = {
  small: 12,
  body: 13,
  label: 13,
  head: 16,
  title: 20,
  display: 34
};

export const MIN_READABLE_PX = 12;

/** CSS custom properties, injected once by the kit. */
export function cssVariables(): string {
  const v: string[] = [];
  (Object.entries(MACHINE_COLORS) as [string, string[]][]).forEach(([name, steps]) =>
    steps.forEach((c, i) => v.push(`--ws-${name}-${i}: ${c};`))
  );
  Object.entries(TEXT_COLORS).forEach(([name, c]) => v.push(`--ws-text-${name}: ${c};`));
  Object.entries(FONT_PX).forEach(([name, n]) => v.push(`--ws-font-${name}: ${n}px;`));
  v.push(`--ws-mono: ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace;`);
  return `:root {\n  ${v.join('\n  ')}\n}`;
}
