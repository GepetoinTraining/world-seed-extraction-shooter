/**
 * A POINT, SEEN BEFORE IT IS SPENT (UXS, 2026-11-12), bars set before the build and seen red.
 *
 * Put to Pedro: "+ first shows what the point would change, a second press spends." His answer: "yup".
 *
 * - The first press on + shows every number on the sheet that the point would move: what it is and what it would be, with
 *   a mark by shape for up or down. Nothing is spent.
 * - The second press spends. Moving away (the focus leaving the +) puts the preview away and spends nothing.
 * - The numbers are the rules' own: every line is read again on a copy of the character with the point spent, by the very
 *   functions the spend and the store use (`ProgressionSystem.spendPoint`, `withTotals`). No formula is typed in the view.
 * - Only what is on the sheet's first level is previewed: a number that lives only in a description stays behind it.
 */

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { createElement } from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot, Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';

vi.mock('../shared/entities/data/VectorStore', () => ({
  VectorNamespace: { CHARACTERS: 'characters', ITEMS: 'items', WORLDS: 'worlds', TRANSACTIONS: 'transactions', CONTENT: 'content', TERRITORIES: 'territories' },
  VectorStore: { get: async () => null, put: async () => true, query: async () => [], saveContent: async () => true, searchContent: async () => [] }
}));
vi.mock('../src/entities/identity/certificateSystem', () => ({
  CertificateSystem: { signPayload: async (uid: string, payload: any) => ({ payload, signature: `sig_${uid}`, certUid: uid, timestamp: 0 }), verifyPayload: async () => true, getPrivateKey: async () => null }
}));

import { IAttributes } from '../shared/types';
import { usePlayerStore } from '../src/entities/player/store';
import '../src/entities/hub/store';
import { useIdentityStore } from '../src/entities/identity/store';
import { LoadoutSystem } from '../shared/entities/player/systems/LoadoutSystem';
import { StatSystem } from '../shared/logic/systems/StatSystem';
import { SheetNumbers } from '../src/logic/systems/SheetNumbers';
import { said } from '../src/logic/systems/SheetWords';
import { useSheet } from '../src/components/ui/stores';
import { LargeSheet } from '../src/components/LargeSheet';
import { CharacterSheet } from '../src/components/CharacterSheet';
import { WAY_MARK } from '../src/components/SheetLine';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const UID = 'uid_preview';
const CERT = (uid: string) => ({ metadata: { uid, displayName: 'PREVIEW', createdAt: 0 }, publicKey: {} as any, publicKeyJWK: {} as any }) as any;
const player = () => usePlayerStore.getState().player;
/** The character with its base perception set, and its totals worked out by the store. */
const withPerception = (n: number) => {
  usePlayerStore.setState(s => ({ player: { ...s.player, baseAttributes: { ...s.player.baseAttributes, perception: n } } }));
  usePlayerStore.getState().recalcAttributes();
  return player();
};

function seed() {
  localStorage.clear();
  useIdentityStore.setState({ certificate: CERT(UID) } as any);
  usePlayerStore.getState().initializeSession(CERT(UID), 'NOMAD');
  usePlayerStore.setState(s => ({ player: { ...s.player, attributePoints: 2 } }));
}

let host: HTMLDivElement;
let root: Root;
const text = () => host.textContent ?? '';
const plus = (attr: keyof IAttributes): HTMLButtonElement => {
  const b = host.querySelector<HTMLButtonElement>(`button[data-plus="${attr}"]`);
  if (!b) throw new Error(`no + for ${attr}`);
  return b;
};
const press = async (b: HTMLButtonElement) => { await act(async () => { b.focus(); b.click(); }); };

beforeAll(() => {
  const ctx = new Proxy({}, { get: (_t, k) => (k === 'canvas' ? document.createElement('canvas') : k === 'getImageData' || k === 'createImageData' ? () => ({ data: new Uint8ClampedArray(4) }) : k === 'measureText' ? () => ({ width: 0 }) : () => undefined), set: () => true });
  (HTMLCanvasElement.prototype as any).getContext = () => ctx;
});
beforeEach(() => { seed(); host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); });
afterEach(async () => { await act(async () => { root.unmount(); }); host.remove(); useSheet.setState({ open: false, large: false } as any); });

describe('what a point would move, read by the rules on a copy', () => {
  it('strength: the attribute and the carry limit move up, to what the rules give a character with the point spent', () => {
    const p = player();
    const moved = SheetNumbers.ifSpent(p, 'strength');
    const attr = moved.find(m => m.key === 'attr:strength')!;
    expect(attr.now).toBe(String(p.attributes.strength));
    expect(attr.then).toBe(String(p.attributes.strength + 1));
    expect(attr.way).toBe('up');
    const carry = moved.find(m => m.key === 'carry')!;
    expect(carry.way).toBe('up');
    expect(carry.then).toContain(said(LoadoutSystem.carryLimit(p.attributes.strength + 1, p.equipment)));
  });

  it('constitution moves health; perception moves the crit and the sight; each is up', () => {
    const p = player();
    const health = SheetNumbers.ifSpent(p, 'constitution').find(m => m.key === 'health')!;
    expect(health.then).toContain(said(StatSystem.maxHealth({ ...p.attributes, constitution: p.attributes.constitution + 1 }, p.equipment)));
    expect(health.way).toBe('up');
    // Perception gives half a percent of crit and half a tile of sight a point, and the sheet shows whole ones: from an odd
    // perception the next point shows on both lines
    const odd = withPerception(3);
    const keys = SheetNumbers.ifSpent(odd, 'perception').map(m => m.key);
    expect(keys).toEqual(expect.arrayContaining(['attr:perception', 'crit', 'sight']));
  });

  it('a point that moves a number by less than the sheet shows is not shown moving: the sheet\'s own figures are read', () => {
    // From an even perception the next half step rounds to the figure already shown
    const even = withPerception(4);
    expect(SheetNumbers.ifSpent(even, 'perception').map(m => m.key)).toEqual(['attr:perception']);
  });

  it('a number that lives only in a description stays behind it: charisma moves nothing on the sheet but itself', () => {
    expect(SheetNumbers.ifSpent(player(), 'charisma').map(m => m.key)).toEqual(['attr:charisma']);
  });

  it('asks and changes nothing: the character is the same after', () => {
    const before = JSON.stringify(player());
    SheetNumbers.ifSpent(player(), 'agility');
    expect(JSON.stringify(player())).toBe(before);
  });

  it('with no point to spend there is nothing to show', () => {
    usePlayerStore.setState(s => ({ player: { ...s.player, attributePoints: 0, groupPoints: { body: 0, mind: 0, self: 0 } } }));
    expect(SheetNumbers.ifSpent(player(), 'strength')).toEqual([]);
  });

  it('the copy is made by the spend\'s own rule and the store\'s own totals, and the store reads the same totals', () => {
    const numbers = readFileSync('src/logic/systems/SheetNumbers.ts', 'utf8');
    expect(numbers).toMatch(/ProgressionSystem\.spendPoint\(/);
    expect(numbers).toMatch(/withTotals\(/);
    expect(readFileSync('src/entities/player/store.ts', 'utf8')).toMatch(/recalcAttributes: \(\) => \{\s*set\(state => \(\{ player: withTotals\(state\.player\) \}\)\)/);
  });
});

describe('the large sheet: the first press shows, the second spends', () => {
  it('the first press shows every moved number with what it would be and a mark by shape, and spends nothing', async () => {
    await act(async () => { root.render(createElement(LargeSheet, {})); });
    const before = player();
    await press(plus('strength'));
    expect(player().baseAttributes.strength).toBe(before.baseAttributes.strength);
    expect(player().attributePoints).toBe(2);
    const shown = host.querySelector('[data-preview]')!;
    expect(shown).not.toBeNull();
    for (const m of SheetNumbers.ifSpent(before, 'strength')) {
      expect(shown.textContent, m.word).toContain(m.word);
      expect(shown.textContent, m.word).toContain(m.then);
    }
    expect(shown.textContent).toContain(WAY_MARK.up);
    // The carry line itself shows where it would go
    expect(host.querySelector('[data-described="CARRY"] [data-moved]')?.textContent).toContain(WAY_MARK.up);
  });

  it('the second press spends the point, and the preview goes', async () => {
    await act(async () => { root.render(createElement(LargeSheet, {})); });
    const strength = player().baseAttributes.strength;
    await press(plus('strength'));
    await press(plus('strength'));
    expect(player().baseAttributes.strength).toBe(strength + 1);
    expect(player().attributePoints).toBe(1);
    expect(host.querySelector('[data-preview]')).toBeNull();
  });

  it('moving away puts it away and spends nothing', async () => {
    await act(async () => { root.render(createElement(LargeSheet, {})); });
    const strength = player().baseAttributes.strength;
    await press(plus('strength'));
    expect(host.querySelector('[data-preview]')).not.toBeNull();
    await act(async () => { plus('strength').blur(); });
    expect(host.querySelector('[data-preview]')).toBeNull();
    expect(player().baseAttributes.strength).toBe(strength);
  });

  it('pressing another + shows that one instead', async () => {
    await act(async () => { root.render(createElement(LargeSheet, {})); });
    await press(plus('strength'));
    await press(plus('constitution'));
    expect(host.querySelector('[data-preview]')!.getAttribute('data-preview')).toBe('constitution');
    expect(player().attributePoints).toBe(2);
  });
});

describe('the small sheet: the same two presses', () => {
  it('shows, then spends', async () => {
    useSheet.setState({ open: true } as any);
    await act(async () => { root.render(createElement(CharacterSheet)); });
    const agility = player().baseAttributes.agility;
    await press(plus('agility'));
    expect(host.querySelector('[data-preview]')?.textContent).toContain('WALK');
    expect(player().baseAttributes.agility).toBe(agility);
    await press(plus('agility'));
    expect(player().baseAttributes.agility).toBe(agility + 1);
  });
});
