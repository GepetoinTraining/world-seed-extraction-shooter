/**
 * THE SHEET, NUMBERS FIRST (UXS, 2026-11-12), bars set before the build and seen red.
 *
 * Put to Pedro: "The sheet with numbers first and each sentence one step behind". His answer: "yup, and hover click opens
 * description, description opens only if the skill to describe it is found UAHUAHUA".
 *
 * - On both sheets a line is its word and its number; the sentence that stood under it is its description, moved and not
 *   rewritten, and is not on the screen until hover, focus or a click opens it.
 * - It opens only for a character holding the skill that describes it (`DescriptionLaw`). Without it, the place of the
 *   description says by a mark and words that this is not known, and never which skill would open it.
 */

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { createElement } from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot, Root } from 'react-dom/client';

vi.mock('../shared/entities/data/VectorStore', () => ({
  VectorNamespace: { CHARACTERS: 'characters', ITEMS: 'items', WORLDS: 'worlds', TRANSACTIONS: 'transactions', CONTENT: 'content', TERRITORIES: 'territories' },
  VectorStore: { get: async () => null, put: async () => true, query: async () => [], saveContent: async () => true, searchContent: async () => [] }
}));
vi.mock('../src/entities/identity/certificateSystem', () => ({
  CertificateSystem: { signPayload: async (uid: string, payload: any) => ({ payload, signature: `sig_${uid}`, certUid: uid, timestamp: 0 }), verifyPayload: async () => true, getPrivateKey: async () => null }
}));

import { IItem, ItemType, Rarity, SlotType, UniversalRank } from '../shared/types';
import { usePlayerStore } from '../src/entities/player/store';
import '../src/entities/hub/store';
import { useIdentityStore } from '../src/entities/identity/store';
import { LoadoutSystem } from '../shared/entities/player/systems/LoadoutSystem';
import { WebSystem } from '../shared/logic/systems/WebSystem';
import { StatSystem } from '../shared/logic/systems/StatSystem';
import { TagLaw } from '../shared/logic/content/TagLaw';
import { DescriptionLaw } from '../shared/logic/systems/DescriptionLaw';
import { SheetNumbers } from '../src/logic/systems/SheetNumbers';
import { useSheet } from '../src/components/ui/stores';
import { LargeSheet } from '../src/components/LargeSheet';
import { CharacterSheet } from '../src/components/CharacterSheet';
import { NOT_KNOWN } from '../src/components/SheetLine';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const UID = 'uid_numbers';
const CERT = (uid: string) => ({ metadata: { uid, displayName: 'NUMBERS', createdAt: 0 }, publicKey: {} as any, publicKeyJWK: {} as any }) as any;
const idOf = (tags: string[]) => TagLaw.skillIdOf(TagLaw.canonical(tags));
const BOW_TAGS = ['ranged', 'two_hand', 'physical', 'projectile'];

const bow = (): IItem => ({
  id: 'bow', universalDefinitionId: 'gear_bow', name: 'Steel-Rule Bow', description: '', type: ItemType.GEAR, slot: SlotType.MAIN_HAND,
  rank: UniversalRank.F, rarity: Rarity.COMMON, quality: 0, level: 1, value: 1, itemPower: 46, tags: BOW_TAGS, affixes: [],
  dimensions: { width: 1, height: 3 }, weight: 2, stats: { damage: 4, attack_speed: 1.1 }, visuals: { modelId: 'm', colorHex: '#fff' }, icon: 'i',
  history: { dropDate: 0, killCount: 0 }, isIdentified: true
}) as IItem;

/** A character with a bow, a skill that answers to it, a saw skill, one forming, and an eye only where a bar asks. */
function seed(opts: { eye?: boolean; shooting?: boolean } = {}) {
  localStorage.clear();
  useIdentityStore.setState({ certificate: CERT(UID) } as any);
  usePlayerStore.getState().initializeSession(CERT(UID), 'NOMAD');
  const held: string[][] = [['saw', 'flora', 'wood'], ...(opts.shooting === false ? [] : [['projectile', 'ranged']]), ...(opts.eye ? [['identify_armor']] : [])];
  let eq = LoadoutSystem.emptyEquipment();
  const b = bow();
  eq = { ...eq, items: [b], slots: { ...eq.slots, RIGHT_HAND: b.id } };
  usePlayerStore.setState(s => ({
    player: {
      ...s.player,
      equipment: eq,
      levelsBanked: 3,
      skillProgress: { [idOf(['berry', 'flora'])]: { id: idOf(['berry', 'flora']), tags: TagLaw.canonical(['berry', 'flora']), rank: 0, attempts: 2, weight: 20 } },
      bank: {
        ...s.player.bank,
        loreHeld: 12,
        universalSkills: Object.fromEntries(held.map(tags => [idOf(tags), { ...WebSystem.freshSkill(idOf(tags), TagLaw.canonical(tags), 0), level: 3 }]))
      }
    }
  }));
}

let host: HTMLDivElement;
let root: Root;
const player = () => usePlayerStore.getState().player;
const text = () => host.textContent ?? '';
/** A line on the sheet, found by its word. */
const line = (word: string): HTMLElement => {
  const found = Array.from(host.querySelectorAll<HTMLElement>('[data-described]')).find(el => el.getAttribute('data-described') === word);
  if (!found) throw new Error(`no described line "${word}" among: ${Array.from(host.querySelectorAll('[data-described]')).map(e => e.getAttribute('data-described')).join(', ')}`);
  return found;
};
const click = async (el: HTMLElement) => { await act(async () => { el.click(); }); };
const hover = async (el: HTMLElement, on: boolean) => { await act(async () => { el.dispatchEvent(new MouseEvent(on ? 'mouseover' : 'mouseout', { bubbles: true, relatedTarget: on ? null : document.body })); }); };

beforeAll(() => {
  const ctx = new Proxy({}, { get: (_t, k) => (k === 'canvas' ? document.createElement('canvas') : k === 'getImageData' || k === 'createImageData' ? () => ({ data: new Uint8ClampedArray(4) }) : k === 'measureText' ? () => ({ width: 0 }) : () => undefined), set: () => true });
  (HTMLCanvasElement.prototype as any).getContext = () => ctx;
});
beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); });
afterEach(async () => { await act(async () => { root.unmount(); }); host.remove(); useSheet.setState({ open: false, large: false } as any); });

describe('numbers first: a line is its word and its number, and its sentence waits behind it', () => {
  it('every fight line shows its word and number, and none of their sentences, until one is opened', async () => {
    seed({ eye: true });
    await act(async () => { root.render(createElement(LargeSheet, {})); });
    const rows = SheetNumbers.fight(player());
    for (const r of rows) {
      expect(text(), r.word).toContain(r.word);
      expect(text(), r.word).toContain(r.value);
      expect(text(), `${r.word} says nothing before it is opened`).not.toContain(r.says);
    }
    for (const attr of ['strength', 'agility', 'perception'] as const) expect(text()).not.toContain(StatSystem.attributeWork(attr, player().attributes));
  });

  it('a click keeps a description open under its line, and a second click puts it away', async () => {
    seed({ eye: true });
    await act(async () => { root.render(createElement(LargeSheet, {})); });
    const dodge = SheetNumbers.fight(player()).find(r => r.key === 'dodge')!;
    await click(line('DODGE'));
    expect(text()).toContain(dodge.says);
    expect(line('DODGE').getAttribute('aria-expanded')).toBe('true');
    await click(line('DODGE'));
    expect(text()).not.toContain(dodge.says);
  });

  it('hovering opens it for as long as the pointer stays', async () => {
    seed({ eye: true });
    await act(async () => { root.render(createElement(LargeSheet, {})); });
    const crit = SheetNumbers.fight(player()).find(r => r.key === 'crit')!;
    await hover(line('CRIT'), true);
    expect(text()).toContain(crit.says);
    await hover(line('CRIT'), false);
    expect(text()).not.toContain(crit.says);
  });
});

describe('a description opens only with the skill that describes it', () => {
  it('without it, the place says by a mark and words that it is not known, and names no skill', async () => {
    seed({ eye: false });
    await act(async () => { root.render(createElement(LargeSheet, {})); });
    const dodge = SheetNumbers.fight(player()).find(r => r.key === 'dodge')!;
    await click(line('DODGE'));
    const told = line('DODGE').querySelector('[data-told]')!;
    expect(told.getAttribute('data-told')).toBe('unknown');
    expect(told.textContent).toContain(NOT_KNOWN);
    expect(told.querySelector('[data-mark]')?.textContent).toBe('?');
    expect(text()).not.toContain(dodge.says);
    expect(told.textContent).not.toMatch(/eye|skill|study|learn/i);
  });

  it('the hand\'s lines open with a skill that answers to what is held, and not with an eye', async () => {
    seed({ eye: true, shooting: false });
    await act(async () => { root.render(createElement(LargeSheet, {})); });
    await click(line('DAMAGE'));
    expect(line('DAMAGE').querySelector('[data-told]')!.getAttribute('data-told')).toBe('unknown');
    await act(async () => { root.unmount(); });
    seed({ eye: false, shooting: true });
    root = createRoot(host);
    await act(async () => { root.render(createElement(LargeSheet, {})); });
    const hit = SheetNumbers.fight(player()).find(r => r.key === 'hit')!;
    await click(line('DAMAGE'));
    expect(line('DAMAGE').querySelector('[data-told]')!.getAttribute('data-told')).toBe('known');
    expect(text()).toContain(hit.says);
  });

  it('every row of a fight says what describes it, read by the one law', () => {
    seed({ shooting: true });
    const rows = SheetNumbers.fight(player());
    expect(DescriptionLaw.opens(player().bank.universalSkills, rows.find(r => r.key === 'hit')!.root)).toBe(true);
    expect(rows.find(r => r.key === 'dodge')!.root).toBe(DescriptionLaw.GAP);
    for (const r of rows) expect(r).toHaveProperty('root');
  });

  it('a held skill\'s own line opens what it does and what grows it; a forming one is not known yet', async () => {
    seed({ eye: false });
    await act(async () => { root.render(createElement(LargeSheet, {})); });
    expect(text()).not.toMatch(/less energy/i);
    const saw = host.querySelector<HTMLElement>(`[data-skill="${idOf(['saw', 'flora', 'wood'])}"]`)!;
    expect(saw).not.toBeNull();
    await click(saw);
    expect(text()).toMatch(/less energy/i);
    expect(text()).toMatch(/Grows with use/);
    const forming = host.querySelector<HTMLElement>('[data-forming]')!;
    await click(forming);
    expect(forming.querySelector('[data-told]')!.getAttribute('data-told')).toBe('unknown');
    expect(text()).not.toMatch(/Forms as you keep at it/);
  });
});

describe('the small sheet: the same lines, the same law', () => {
  it('an attribute\'s line opens what it does only with its skill, and no pointer\'s tip tells it before', async () => {
    seed({ eye: false });
    useSheet.setState({ open: true } as any);
    await act(async () => { root.render(createElement(CharacterSheet)); });
    const work = StatSystem.attributeWork('agility', player().attributes);
    expect(Array.from(host.querySelectorAll('[title]')).map(e => e.getAttribute('title')).join(' ')).not.toContain(work);
    await click(line('agility'));
    expect(text()).not.toContain(work);
    expect(text()).toContain(NOT_KNOWN);
  });

  it('with its skill, it opens', async () => {
    seed({ eye: true });
    useSheet.setState({ open: true } as any);
    await act(async () => { root.render(createElement(CharacterSheet)); });
    await click(line('agility'));
    expect(text()).toContain(StatSystem.attributeWork('agility', player().attributes));
  });
});
