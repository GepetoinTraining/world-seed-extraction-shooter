/**
 * THE ENTRY VIEW (Pedro, 2026-11-10: "before I play, let's set up an entry point view"). Registered before
 * the build. What a person meets first: choose a character, online (work in progress), configuration,
 * accessibility, API keys, credits.
 *
 * The credits are a record, not a guess: a model is named with the version the record gives, and where
 * the record gives none the entry says so. Every model the game can speak through must be in them.
 */
import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { ENTRY_ITEMS, EntryView } from '../src/components/EntryView';
import { AccessibilityPanel, ConfigurationPanel } from '../src/components/SettingsPanels';
import { CreditsPanel } from '../src/components/CreditsPanel';
import { OnlinePanel } from '../src/components/OnlinePanel';
import { KeysPanel } from '../src/components/KeysPanel';
import { CREDITS } from '../src/logic/credits/Credits';
import { COLOUR_VISIONS } from '../src/logic/settings/Settings';

const draw = (element: React.ReactElement) => renderToStaticMarkup(element);
const read = (file: string) => readFileSync(file, 'utf8');

describe('the first screen', () => {
  const page = draw(React.createElement(EntryView, { onPlay: () => undefined }));

  it('offers the six things, in this order, each with its number', () => {
    expect(ENTRY_ITEMS.map(i => i.id)).toEqual(['play', 'online', 'configuration', 'accessibility', 'keys', 'credits']);
    let at = -1;
    ENTRY_ITEMS.forEach((item, i) => {
      const found = page.indexOf(item.label);
      expect(found, item.label).toBeGreaterThan(at);
      at = found;
      expect(page).toContain(`>${i + 1}<`);
    });
  });

  it('choosing a character is the first thing, and the one the keyboard starts on', () => {
    expect(ENTRY_ITEMS[0].label).toBe('CHOOSE CHARACTER');
    expect(page.indexOf('autofocus')).toBeGreaterThan(-1);
    expect(page.indexOf('autofocus')).toBeLessThan(page.indexOf(ENTRY_ITEMS[1].label));
  });

  it('online says in words that it is not finished', () => {
    expect(page).toMatch(/ONLINE[^<]*<[^>]*>[^<]*WORK IN PROGRESS|ONLINE \(WORK IN PROGRESS\)/);
    expect(draw(React.createElement(OnlinePanel))).toMatch(/WORK IN PROGRESS/);
  });

  it('comes before the character gate, and a person switching avatar is not sent through it again', () => {
    const app = read('App.tsx');
    expect(app).toContain('<EntryView');
    expect(app.indexOf('<EntryView')).toBeLessThan(app.indexOf('<IdentityGate'));
    expect(app).toMatch(/worldseed_force_select/);
    expect(read('index.tsx')).toMatch(/installSettings\(\)/);
  });

  it('the same settings are a step away inside the game', () => {
    expect(read('App.tsx')).toMatch(/ConfigurationPanel/);
    expect(read('App.tsx')).toMatch(/AccessibilityPanel/);
  });
});

describe('configuration', () => {
  const panel = draw(React.createElement(ConfigurationPanel));

  it('has the volume as a slider with its number beside it, a mute, and a way to hear it', () => {
    expect(panel).toMatch(/type="range"/);
    expect(panel).toMatch(/aria-label="Volume"/);
    expect(panel).toMatch(/\d+%/);
    expect(panel).toMatch(/MUTE/);
    expect(panel).toMatch(/TEST THE SOUND/);
  });

  it('says plainly that the game has no sound of its own yet', () => {
    expect(panel).toMatch(/no sound of its own yet/i);
  });
});

describe('accessibility', () => {
  const panel = draw(React.createElement(AccessibilityPanel));

  it('has the text size as a slider, with a line of text to judge it by', () => {
    expect(panel).toMatch(/aria-label="Text size"/);
    expect(panel).toMatch(/100%/);
  });

  it('offers every kind of colour vision in words, the chosen one marked by a mark and not a hue', () => {
    for (const c of COLOUR_VISIONS) expect(panel, c.id).toContain(c.name);
    expect(panel.match(/\[■\]/g)?.length).toBe(1);
    expect(panel.match(/\[ \]/g)?.length).toBe(COLOUR_VISIONS.length - 1);
    expect(panel).toMatch(/aria-label="Strength"/);
  });

  it('shows the three colours the interface speaks in, each with its own mark and word', () => {
    for (const word of ['SIGNAL', 'PROOF', 'LOSS']) expect(panel).toContain(word);
  });
});

describe('API keys', () => {
  it('opens on what is held and one way to add', () => {
    const panel = draw(React.createElement(KeysPanel));
    expect(panel).toMatch(/\+ ADD A KEY/);
  });

  it('keeps no key anywhere but the door: not in storage, not in a log', () => {
    const code = read('src/components/KeysPanel.tsx') + read('src/logic/intelligence/KeyForm.ts');
    expect(code).not.toMatch(/localStorage|sessionStorage|indexedDB|console\./);
    expect(read('src/components/KeysPanel.tsx')).toMatch(/type="password"/);
  });
});

describe('credits', () => {
  const entries = [...CREDITS.built, ...CREDITS.voices, ...CREDITS.earlier];

  it('every entry says who made it, what it did here, and where that is recorded', () => {
    expect(CREDITS.people.length).toBeGreaterThan(0);
    for (const e of entries) {
      for (const field of ['name', 'maker', 'did', 'record'] as const) expect(String(e[field] ?? '').length, `${e.name} ${field}`).toBeGreaterThan(2);
    }
  });

  it('the builders run from Gemini to the model that wrote this screen', () => {
    expect(CREDITS.built[0].maker).toBe('Google');
    expect(CREDITS.built[0].name).toMatch(/Gemini/);
    expect(CREDITS.built[CREDITS.built.length - 1].name).toMatch(/Fable 5\.2/);
    const whens = CREDITS.built.map(e => e.when);
    expect([...whens].sort()).toEqual(whens);
  });

  it('every model that signed a commit is among them', () => {
    const names = CREDITS.built.map(e => e.name);
    for (const signed of ['Claude Opus 5.5', 'Claude Fable 5']) expect(names).toContain(signed);
  });

  it('where the record gives no version, the entry gives none and says so', () => {
    const unversioned = CREDITS.built.filter(e => /not on record/.test(e.record));
    expect(unversioned.length).toBeGreaterThan(0);
    for (const e of unversioned) expect(e.name, e.name).not.toMatch(/\d/);
  });

  it('every model the game can speak through is named: the door\'s own, the offered keys, the local ones', () => {
    const ids = new Set(entries.map(e => e.id).filter(Boolean));
    const doors = [...read('shared/intelligence/claude.ts').matchAll(/'(claude-[a-z]+-[0-9-]+)'/g)].map(m => m[1]);
    const options = JSON.parse(read('shared/intelligence/door-options.json'));
    const offered = [...options.keyed.map((o: { model: string }) => o.model), ...options.local.suggestions.map((s: { model: string }) => s.model)];
    expect(doors.length).toBeGreaterThan(2);
    for (const id of [...doors, ...offered]) expect(ids.has(id), id).toBe(true);
  });

  it('the screen draws every one of them', () => {
    const panel = draw(React.createElement(CreditsPanel));
    for (const e of entries) expect(panel, e.name).toContain(e.name.replace(/&/g, '&amp;').replace(/'/g, '&#x27;'));
    for (const p of CREDITS.people) expect(panel).toContain(p.name);
  });
});
