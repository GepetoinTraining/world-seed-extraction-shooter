/**
 * WHAT A PERSON SETS FOR THEMSELVES ON THIS DEVICE (Pedro, 2026-11-10: "configuration (we'll have sound,
 * believe me ... so we need the volume), accessibility (font size, color blind type controls)").
 *
 * A setting belongs to the person at this screen, not to a character and not to a world: it is kept in
 * this browser (store.ts) and nothing of the game's law reads it. This file is the part with no browser
 * in it: the range of each setting, and the arithmetic of a colour setting.
 *
 * COLOUR. Meaning in this game is carried by marks and position, never by hue alone, so nothing is lost
 * with the setting off. What it does is move hues apart for one kind of colour vision: the difference
 * that kind of eye cannot see is added onto an axis it can see. Greys are never touched. The standard
 * recipe (shift the simulated error into the other channels) was tried first and measured: it pulled this
 * game's own green and red closer together for the eyes it was meant to help, so it is not used.
 * The strengths below are a builder's guess until someone with that kind of vision has judged them.
 */
import { FONT_PX, MIN_READABLE_PX } from '../../components/ui/tokens';

export type ColourVision = 'full' | 'protan' | 'deutan' | 'tritan' | 'none';

export interface ISettings {
  /** 0 to 100. */
  volume: number;
  muted: boolean;
  /** Text size, as a percent of the size the interface was drawn for. Never under 100: that size is the floor. */
  textPercent: number;
  colourVision: ColourVision;
  /** 0 to 100: how far hues are moved. */
  colourStrength: number;
}

export const DEFAULT_SETTINGS: ISettings = { volume: 70, muted: false, textPercent: 100, colourVision: 'full', colourStrength: 100 };

export const TEXT_PERCENT = { min: 100, max: 200, step: 10 };

/** The kinds of colour vision, in a person's words first and the clinic's second. */
export const COLOUR_VISIONS: { id: ColourVision; name: string; says: string }[] = [
  { id: 'full', name: 'FULL COLOUR', says: 'Nothing is changed.' },
  { id: 'protan', name: 'RED LOOKS DARK, RED AND GREEN ALIKE', says: 'Protanopia and protanomaly. Greens are moved toward blue, away from reds and oranges.' },
  { id: 'deutan', name: 'RED AND GREEN LOOK ALIKE', says: 'Deuteranopia and deuteranomaly, the most common kind. Greens are moved toward blue, away from reds and oranges.' },
  { id: 'tritan', name: 'BLUE AND GREEN LOOK ALIKE', says: 'Tritanopia and tritanomaly. Blues are moved toward purple, away from greens.' },
  { id: 'none', name: 'NO COLOUR', says: 'Every colour becomes a grey as bright as it was.' }
];

const clamp = (n: number, low: number, high: number) => Math.min(high, Math.max(low, n));
const numberOr = (value: unknown, fallback: number) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);

/** Whatever was kept, as a whole setting: each part inside its range, and nothing that is not one. */
export function parseSettings(raw: unknown): ISettings {
  const given = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof ISettings, unknown>>;
  const text = clamp(numberOr(given.textPercent, DEFAULT_SETTINGS.textPercent), TEXT_PERCENT.min, TEXT_PERCENT.max);
  return {
    volume: Math.round(clamp(numberOr(given.volume, DEFAULT_SETTINGS.volume), 0, 100)),
    muted: typeof given.muted === 'boolean' ? given.muted : DEFAULT_SETTINGS.muted,
    textPercent: Math.round(text / TEXT_PERCENT.step) * TEXT_PERCENT.step,
    colourVision: COLOUR_VISIONS.some(c => c.id === given.colourVision) ? given.colourVision as ColourVision : DEFAULT_SETTINGS.colourVision,
    colourStrength: Math.round(clamp(numberOr(given.colourStrength, DEFAULT_SETTINGS.colourStrength), 0, 100))
  };
}

/** What every sound is multiplied by: nothing when muted. */
export function gainOf(settings: ISettings): number {
  return settings.muted ? 0 : clamp(settings.volume, 0, 100) / 100;
}

/** The interface's type sizes at this percent, as the CSS variables the kit reads. None goes under the floor. */
export function fontVariables(textPercent: number): Record<string, string> {
  const scale = Math.max(1, textPercent / 100);
  const out: Record<string, string> = {};
  for (const [name, px] of Object.entries(FONT_PX)) out[`--ws-font-${name}`] = `${Math.max(MIN_READABLE_PX, Math.round(px * scale))}px`;
  return out;
}

// --- colour ---

type Rgb = [number, number, number];
/** Nine numbers, row by row. Applied to linear light, which is what a filter on the page works in. */
export type Matrix3 = number[];

const IDENTITY: Matrix3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
/** How bright each channel is to the eye (Rec. 709). */
const BRIGHTNESS: Rgb = [0.2126, 0.7152, 0.0722];

/**
 * What each kind of dichromat sees, as fitted by Machado, Oliveira and Fernandes (2009) at full severity.
 * Every row sums to one, so a grey stays the grey it was.
 */
const SEEN: Record<'protan' | 'deutan' | 'tritan', Matrix3> = {
  protan: [0.152286, 1.052583, -0.204868, 0.114503, 0.786281, 0.099216, -0.003882, -0.048116, 1.051998],
  deutan: [0.367322, 0.860646, -0.227968, 0.280085, 0.672501, 0.047413, -0.011820, 0.042940, 0.968881],
  tritan: [1.255528, -0.076749, -0.178779, -0.078411, 0.930809, 0.147602, 0.004733, 0.691367, 0.303900]
};

/**
 * For each kind: which channel carries most of what is not seen, the axis it is added onto, and how hard.
 * Red-green eyes still see blue against yellow, so greens go bluer. Blue-green eyes still see red against
 * green, so blues go redder, more gently, or yellows would turn green.
 */
const MOVED: Record<'protan' | 'deutan' | 'tritan', { lostRow: number; onto: Rgb; push: number }> = {
  protan: { lostRow: 0, onto: [0, 0, -1], push: 1 },
  deutan: { lostRow: 0, onto: [0, 0, -1], push: 1 },
  tritan: { lostRow: 2, onto: [1, 0, 0], push: 0.5 }
};

export function applyMatrix(m: Matrix3, rgb: number[]): Rgb {
  const at = (row: number) => clamp(m[row * 3] * rgb[0] + m[row * 3 + 1] * rgb[1] + m[row * 3 + 2] * rgb[2], 0, 1);
  return [at(0), at(1), at(2)];
}

/** A colour as that kind of eye sees it. Used to measure a setting, never drawn. */
export function simulate(vision: ColourVision, rgb: number[]): Rgb {
  if (vision === 'full') return [rgb[0], rgb[1], rgb[2]];
  if (vision === 'none') {
    const grey = BRIGHTNESS[0] * rgb[0] + BRIGHTNESS[1] * rgb[1] + BRIGHTNESS[2] * rgb[2];
    return [grey, grey, grey];
  }
  return applyMatrix(SEEN[vision], rgb);
}

/** The change put on every pixel for this kind of vision, at this strength (0 to 100). */
export function colourMatrix(vision: ColourVision, strength: number): Matrix3 {
  const s = clamp(strength, 0, 100) / 100;
  if (vision === 'full' || s === 0) return [...IDENTITY];
  if (vision === 'none') return IDENTITY.map((n, i) => (1 - s) * n + s * BRIGHTNESS[i % 3]);

  const { lostRow, onto, push } = MOVED[vision];
  const seen = SEEN[vision];
  // What this eye does not see of a colour: the colour, less what it sees of it
  const lost = [0, 1, 2].map(col => (col === lostRow ? 1 : 0) - seen[lostRow * 3 + col]);
  return IDENTITY.map((n, i) => n + s * push * onto[Math.floor(i / 3)] * lost[i % 3]);
}
