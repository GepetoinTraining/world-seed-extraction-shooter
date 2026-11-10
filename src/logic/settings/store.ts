/**
 * THE PERSON'S SETTINGS, KEPT AND APPLIED (Settings.ts has the ranges and the arithmetic).
 *
 * Kept in this browser under one key, because they are this person's on this device. A browser that keeps
 * nothing still plays, on the defaults. They are read before the first screen is drawn (index.tsx), and a
 * change shows at once.
 *
 * Text size is written over the kit's own type variables on the page's root, so every screen that takes
 * its sizes from the kit grows together; what is drawn on a canvas asks `textScale()`.
 * A colour setting is one filter on the root of the page, so the world, the sprites and the interface are
 * all moved by the same rule.
 */
import { create } from 'zustand';
import { DEFAULT_SETTINGS, ISettings, colourMatrix, fontVariables, parseSettings } from './Settings';

export const SETTINGS_KEY = 'worldseed_settings';
const FILTER_ID = 'ws-colour-vision';
const SVG = 'http://www.w3.org/2000/svg';

export function readSettings(): ISettings {
  try {
    const kept = localStorage.getItem(SETTINGS_KEY);
    return kept ? parseSettings(JSON.parse(kept)) : { ...DEFAULT_SETTINGS };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function keep(settings: ISettings) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* a private window keeps nothing, and the setting holds for this sitting */ }
}

interface ISettingsStore {
  settings: ISettings;
  change(patch: Partial<ISettings>): void;
  reset(): void;
}

export const useSettings = create<ISettingsStore>((set, get) => ({
  settings: typeof localStorage === 'undefined' ? { ...DEFAULT_SETTINGS } : readSettings(),
  change: patch => {
    const settings = parseSettings({ ...get().settings, ...patch });
    keep(settings);
    set({ settings });
  },
  reset: () => {
    try { localStorage.removeItem(SETTINGS_KEY); } catch { /* nothing was kept */ }
    set({ settings: { ...DEFAULT_SETTINGS } });
  }
}));

/** How much larger than drawn the person asked text to be. Canvas text multiplies by this. */
export const textScale = (): number => useSettings.getState().settings.textPercent / 100;

/** The filter the page's root points at, made once and rewritten on each change. */
function filterMatrix(doc: Document): Element {
  const found = doc.querySelector(`#${FILTER_ID} feColorMatrix`);
  if (found) return found;
  const svg = doc.createElementNS(SVG, 'svg');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('width', '0');
  svg.setAttribute('height', '0');
  svg.setAttribute('style', 'position:absolute;width:0;height:0;pointer-events:none');
  const filter = doc.createElementNS(SVG, 'filter');
  filter.setAttribute('id', FILTER_ID);
  // Light is added as light, not as the numbers a screen stores
  filter.setAttribute('color-interpolation-filters', 'linearRGB');
  const matrix = doc.createElementNS(SVG, 'feColorMatrix');
  matrix.setAttribute('type', 'matrix');
  filter.appendChild(matrix);
  svg.appendChild(filter);
  (doc.body ?? doc.documentElement).appendChild(svg);
  return matrix;
}

export function applySettings(settings: ISettings, doc: Document = document): void {
  const root = doc.documentElement;
  for (const [name, value] of Object.entries(fontVariables(settings.textPercent))) root.style.setProperty(name, value);

  root.dataset.wsColourVision = settings.colourVision;
  const moved = settings.colourVision !== 'full' && settings.colourStrength > 0;
  if (!moved) {
    root.style.filter = '';
    return;
  }
  const m = colourMatrix(settings.colourVision, settings.colourStrength);
  const row = (i: number) => `${m[i * 3]} ${m[i * 3 + 1]} ${m[i * 3 + 2]} 0 0`;
  filterMatrix(doc).setAttribute('values', `${row(0)} ${row(1)} ${row(2)} 0 0 0 1 0`);
  root.style.filter = `url(#${FILTER_ID})`;
}

/** Read, apply, and keep applying. Called once, before the first screen. */
export function installSettings(): void {
  applySettings(useSettings.getState().settings);
  useSettings.subscribe(state => applySettings(state.settings));
}
