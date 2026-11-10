/**
 * THE ENTRY VIEW'S SETTINGS (Pedro, 2026-11-10: "configuration (we'll have sound, believe me ... so we need
 * the volume), accessibility (font size, color blind type controls)"). Registered before the build.
 *
 * A setting is the person's on this device, not a character's: it is kept in this browser, read before the
 * first screen is drawn, and applied to the whole page. Text never goes below the floor the interface
 * already holds. A colour setting moves hues apart for one kind of colour vision and leaves greys alone;
 * meaning stays in marks and position, as everywhere in this game.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  COLOUR_VISIONS, DEFAULT_SETTINGS, TEXT_PERCENT, applyMatrix, colourMatrix, fontVariables, gainOf, parseSettings, simulate
} from '../src/logic/settings/Settings';
import { SETTINGS_KEY, applySettings, readSettings, textScale, useSettings } from '../src/logic/settings/store';
import { FONT_PX, MIN_READABLE_PX } from '../src/components/ui/tokens';

const apart = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

beforeEach(() => {
  localStorage.clear();
  useSettings.getState().reset();
  document.documentElement.removeAttribute('style');
});

describe('what a person can set', () => {
  it('starts with sound on, text at the size it was drawn for, and full colour', () => {
    expect(DEFAULT_SETTINGS).toMatchObject({ muted: false, textPercent: 100, colourVision: 'full' });
    expect(DEFAULT_SETTINGS.volume).toBeGreaterThan(0);
    expect(parseSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('not a setting')).toEqual(DEFAULT_SETTINGS);
  });

  it('holds what it is given inside its range, and takes nothing it does not know', () => {
    const s = parseSettings({ volume: 400, muted: 'yes', textPercent: 20, colourVision: 'infrared', colourStrength: -5, extra: 1 });
    expect(s.volume).toBe(100);
    expect(s.muted).toBe(DEFAULT_SETTINGS.muted);
    expect(s.textPercent).toBe(TEXT_PERCENT.min);
    expect(s.colourVision).toBe('full');
    expect(s.colourStrength).toBe(0);
    expect(Object.keys(s).sort()).toEqual(Object.keys(DEFAULT_SETTINGS).sort());
    expect(parseSettings({ textPercent: 137 }).textPercent % TEXT_PERCENT.step).toBe(0);
    expect(parseSettings({ textPercent: 999 }).textPercent).toBe(TEXT_PERCENT.max);
  });

  it('is kept in this browser, and read back as it was left', () => {
    useSettings.getState().change({ volume: 35, textPercent: 130, colourVision: 'deutan', colourStrength: 60 });
    expect(JSON.parse(localStorage.getItem(SETTINGS_KEY)!)).toMatchObject({ volume: 35, textPercent: 130, colourVision: 'deutan', colourStrength: 60 });
    expect(readSettings()).toMatchObject({ volume: 35, textPercent: 130, colourVision: 'deutan' });
  });

  it('a browser that keeps nothing still plays, on the defaults', () => {
    localStorage.setItem(SETTINGS_KEY, '{broken');
    expect(readSettings()).toEqual(DEFAULT_SETTINGS);
  });
});

describe('volume', () => {
  it('is a gain from nothing to full, and muting is nothing', () => {
    expect(gainOf({ ...DEFAULT_SETTINGS, volume: 0 })).toBe(0);
    expect(gainOf({ ...DEFAULT_SETTINGS, volume: 100 })).toBe(1);
    expect(gainOf({ ...DEFAULT_SETTINGS, volume: 50 })).toBeCloseTo(0.5);
    expect(gainOf({ ...DEFAULT_SETTINGS, volume: 100, muted: true })).toBe(0);
  });
});

describe('text size', () => {
  it('at its start, every size is the one the interface was drawn with', () => {
    const v = fontVariables(100);
    for (const [name, px] of Object.entries(FONT_PX)) expect(v[`--ws-font-${name}`]).toBe(`${px}px`);
  });

  it('grows every size together, and none ever goes under the floor', () => {
    const v = fontVariables(150);
    expect(v['--ws-font-small']).toBe(`${Math.round(FONT_PX.small * 1.5)}px`);
    expect(v['--ws-font-display']).toBe(`${Math.round(FONT_PX.display * 1.5)}px`);
    for (const percent of [10, 50, 100, 200]) {
      for (const value of Object.values(fontVariables(percent))) expect(parseInt(value, 10)).toBeGreaterThanOrEqual(MIN_READABLE_PX);
    }
  });

  it('reaches the page, and what is drawn on a canvas reads the same scale', () => {
    useSettings.getState().change({ textPercent: 140 });
    applySettings(useSettings.getState().settings);
    expect(document.documentElement.style.getPropertyValue('--ws-font-body')).toBe(`${Math.round(FONT_PX.body * 1.4)}px`);
    expect(textScale()).toBeCloseTo(1.4);
  });
});

describe('colour vision', () => {
  const kinds = COLOUR_VISIONS.map(c => c.id);

  it('offers full colour, the three kinds of colour blindness, and no colour at all, each said in words', () => {
    expect(kinds).toEqual(['full', 'protan', 'deutan', 'tritan', 'none']);
    for (const c of COLOUR_VISIONS) {
      expect(c.name.length, c.id).toBeGreaterThan(3);
      expect(c.says.length, c.id).toBeGreaterThan(10);
    }
  });

  it('full colour, or any kind at no strength, changes nothing', () => {
    const identity = [1, 0, 0, 0, 1, 0, 0, 0, 1];
    expect(colourMatrix('full', 100)).toEqual(identity);
    for (const kind of kinds) colourMatrix(kind, 0).forEach((n, i) => expect(n).toBeCloseTo(identity[i], 6));
  });

  it('leaves greys as they were, for every kind: only hue is moved', () => {
    for (const kind of kinds) {
      for (const g of [0, 0.2, 0.5, 1]) {
        const out = applyMatrix(colourMatrix(kind, 100), [g, g, g]);
        out.forEach(c => expect(c, `${kind} at ${g}`).toBeCloseTo(g, 5));
      }
    }
  });

  it('for someone who mixes red and green, the game\'s red and green end up further apart than they were', () => {
    const signal = [0.35, 0.75, 0.54];
    const loss = [0.85, 0.31, 0.25];
    for (const kind of ['protan', 'deutan'] as const) {
      const before = apart(simulate(kind, signal), simulate(kind, loss));
      const m = colourMatrix(kind, 100);
      const after = apart(simulate(kind, applyMatrix(m, signal)), simulate(kind, applyMatrix(m, loss)));
      expect(after, kind).toBeGreaterThan(before);
    }
  });

  it('for someone who mixes blue and yellow, a blue and a green end up further apart', () => {
    const blue = [0.2, 0.4, 0.9];
    const green = [0.2, 0.8, 0.5];
    const before = apart(simulate('tritan', blue), simulate('tritan', green));
    const m = colourMatrix('tritan', 100);
    expect(apart(simulate('tritan', applyMatrix(m, blue)), simulate('tritan', applyMatrix(m, green)))).toBeGreaterThan(before);
  });

  it('no colour is every pixel as bright as it was, with no hue left', () => {
    const [r, g, b] = applyMatrix(colourMatrix('none', 100), [0.9, 0.2, 0.1]);
    expect(r).toBeCloseTo(g, 6);
    expect(g).toBeCloseTo(b, 6);
    expect(r).toBeGreaterThan(0.1);
  });

  it('is put on the whole page, world and interface alike, and taken off again at full colour', () => {
    applySettings({ ...DEFAULT_SETTINGS, colourVision: 'deutan', colourStrength: 80 });
    expect(document.documentElement.style.filter).toContain('ws-colour-vision');
    const values = document.querySelector('#ws-colour-vision feColorMatrix')?.getAttribute('values')?.trim().split(/\s+/).map(Number) ?? [];
    expect(values).toHaveLength(20);
    const m = colourMatrix('deutan', 80);
    expect([values[0], values[1], values[2], values[5], values[6], values[7], values[10], values[11], values[12]].map(n => +n.toFixed(4))).toEqual(m.map(n => +n.toFixed(4)));
    expect(document.documentElement.dataset.wsColourVision).toBe('deutan');

    applySettings(DEFAULT_SETTINGS);
    expect(document.documentElement.style.filter).toBe('');
  });
});
