/**
 * THE CARD (UXC, 2026-11-12), bars set before the build. Pedro aimed a UX pass at the games "with crazy ammounts of stats
 * that have high learning curves and don't expose, they let the players figure it out", and answered three targets for
 * the card.
 *
 * Part 1, the card in two layers. Pedro: "yup". A first layer that is short, and a second added beneath it while ALT is
 * held, in place: it never reorders, replaces or hides a row of the first. The published game this comes from admits two
 * faults in its own version, that nothing on screen names the key and that its detailed view rearranges the lines; the
 * card names the key in its corner whenever a second layer exists, and only appends. CTRL+C copies the card as plain
 * text, both layers, in one order. Layers are told apart by position, a rule line and a word, never by hue.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../shared/entities/data/VectorStore', () => ({
  VectorNamespace: { CHARACTERS: 'characters', ITEMS: 'items', WORLDS: 'worlds', TRANSACTIONS: 'transactions', CONTENT: 'content', TERRITORIES: 'territories' },
  VectorStore: { get: async () => null, put: async () => true, query: async () => [], saveContent: async () => true, searchContent: async () => [] }
}));

import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot, Root } from 'react-dom/client';
import { IItem, IPlayer, ItemType, Rarity, SlotType, UniversalRank } from '../shared/types';
import { EntityType } from '../shared/entities/world/types';
import { MOB_DEFINITIONS } from '../shared/entities/mob/data/mobDefinitions';
import { RESOURCE_DEFINITIONS } from '../shared/entities/item/data/resourceDefinitions';
import { ItemFactory } from '../shared/entities/item/ItemFactory';
import { Rng } from '../shared/logic/rng/DeterministicRNG';
import { installShippedThemes } from '../shared/logic/theme/boot';
import { Card, cardText, firstLayer, inspectEntity, inspectItem, secondLayer } from '../src/render/atoms/inspect';
import { usePlayerStore } from '../src/entities/player/store';
import { CardView } from '../src/components/ui/kit';
import { HoverLayer } from '../src/components/ui/HoverLayer';
import { useHover } from '../src/components/ui/stores';
import { useCardKeys } from '../src/components/ui/cardKeys';

installShippedThemes();
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SRC = (p: string) => readFileSync(p, 'utf8');

/** A worked blade: one affix studied, one not, and the chain that made it. */
const blade = (over: Partial<IItem> = {}): IItem => ({
  id: 'uxc_blade', universalDefinitionId: 'gear_uxc', name: 'TEST EDGE', description: '', type: ItemType.GEAR, slot: SlotType.MAIN_HAND,
  rank: UniversalRank.F, rarity: Rarity.COMMON, quality: 0.12, level: 1, value: 40, itemPower: 40, tags: ['melee', 'weapon'],
  affixes: [
    { id: 'affix_uxc_seen', name: 'Keen', type: 'PREFIX', stats: { crit_chance: 0.02 }, tier: 1 },
    { id: 'affix_uxc_blind', name: 'Searing', type: 'SUFFIX', stats: { damage: 3 }, tier: 1 }
  ],
  dimensions: { width: 1, height: 2 }, weight: 1.5, stats: { attack_speed: 1.2, durability: 40, maxDurability: 50 },
  visuals: { modelId: 'm', colorHex: '#fff' }, icon: 'i', history: { dropDate: 0, killCount: 0 }, isIdentified: true,
  composition: {
    version: 1, depth: 2, laborSeconds: 90, batchYield: 1,
    materials: [{ defId: 'res_iron_vein', name: 'Iron Ore', count: 2, origin: 'HARVEST' }],
    steps: [{ recipeId: 'r1', name: 'Smelt', laborSeconds: 30, facility: 'forge' }, { recipeId: 'r2', name: 'Forge', laborSeconds: 60, facility: null }]
  },
  ...over
}) as IItem;

const player = (): IPlayer => {
  const p = usePlayerStore.getState().player;
  return { ...p, materialMastery: { res_iron_vein: { resourceId: 'res_iron_vein', knowledgeLevel: 2, discoveredAffixes: ['affix_uxc_seen'], graded: true } } };
};
const keys = (rows: [string, string][]) => rows.map(([k]) => k);

const PROPERTY_WORDS = ['Density', 'Hardness', 'Conductivity', 'Resonance', 'Luminosity', 'Toxicity', 'Elasticity'];

describe('UXC part 1: what stands on the first layer and what waits beneath', () => {
  it('a piece says what it is and what is read at a glance; where it came from waits beneath', () => {
    const card = inspectItem(blade(), player());
    const first = keys(firstLayer(card)), second = keys(secondLayer(card));
    for (const k of ['Damage', 'Rarity', 'Rank', 'Quality', 'Durability', 'Weight', 'Worth', 'Affix']) expect(first, k).toContain(k);
    for (const k of ['Made of', 'Chain', 'Labor']) {
      expect(second, k).toContain(k);
      expect(first, k).not.toContain(k);
    }
    // One list, the first layer then the second: what a copy reads, and what the card draws when the key is held
    expect(card.rows).toEqual([...firstLayer(card), ...secondLayer(card)]);
    expect(card.glance).toBe(firstLayer(card).length);
  });

  it('a piece of a material: what it does and what it is worth up top; what its matter is and what it becomes beneath', () => {
    const ore = ItemFactory.createResourceItem(RESOURCE_DEFINITIONS['res_iron_vein'] as never, Rng.fromKey('uxc:ore'));
    const card = inspectItem(ore, player());
    const first = keys(firstLayer(card)), second = keys(secondLayer(card));
    expect(first).toContain('Worth');
    expect(first).toContain('Weight');
    expect(second.some(k => PROPERTY_WORDS.includes(k)), 'its properties, read by a handled hand').toBe(true);
    for (const k of [...PROPERTY_WORDS, 'Becomes', 'Origin', 'Made of']) expect(first, k).not.toContain(k);
  });

  it('an affix not studied says so in a few words up top, and what that means waits beneath', () => {
    const card = inspectItem(blade(), player());
    const blind = firstLayer(card).find(([k, v]) => k === 'Affix' && v.startsWith('Searing'))!;
    expect(blind[1]).toBe('Searing: not studied');
    // A studied one keeps its whole line up top, as it was
    expect(firstLayer(card).find(([k, v]) => k === 'Affix' && v.startsWith('Keen'))![1]).toMatch(/^Keen — \+/);
    expect(secondLayer(card)).toContainEqual(['Not studied', 'It works on the piece, and you do not know how.']);
    // Said once, however many are blind
    const two = inspectItem(blade({ affixes: [...blade().affixes, { id: 'affix_uxc_blind2', name: 'Heavy', type: 'PREFIX', stats: { weight: 1 }, tier: 1 }] }), player());
    expect(secondLayer(two).filter(([k]) => k === 'Not studied')).toHaveLength(1);
  });

  it('a creature, a place and a person have two layers where a second helps, and none where it would be empty', () => {
    const level = () => 2;
    const ctx = { player: player(), dist: 1, level };
    const def = (Object.values(MOB_DEFINITIONS) as { id: string; size?: unknown; behavior?: unknown }[]).find(d => d.size && d.behavior)!;
    const mob = inspectEntity({ id: 'm', type: EntityType.MOB, definitionId: def.id, position: { x: 0, y: 0 }, rank: 'F', rarity: 'COMMON', health: 1 } as never, ctx);
    expect(keys(firstLayer(mob))).toEqual(expect.arrayContaining(['Rank', 'Health', 'Behavior']));
    expect(keys(secondLayer(mob))).toContain('Size');

    const place = inspectEntity({ id: 'n', type: EntityType.RESOURCE, definitionId: 'res_iron_vein', position: { x: 0, y: 0 }, rank: 'F', rarity: 'COMMON', quality: 0.1 } as never, ctx);
    expect(keys(firstLayer(place))).toEqual(expect.arrayContaining(['Rank', 'Cost']));
    expect(keys(secondLayer(place)).some(k => PROPERTY_WORDS.includes(k))).toBe(true);
    expect(keys(secondLayer(place))).toContain('Quality');

    const person = inspectEntity({ id: 'p', type: EntityType.NPC, definitionId: 'npc', position: { x: 0, y: 0 }, rank: 'F', rarity: 'COMMON', npc: { name: 'Mara Quill', disposition: 40, want: 'bread', attempts: 0 } } as never, ctx);
    expect(keys(firstLayer(person))).toEqual(['Regard', 'Wants']);
    expect(secondLayer(person)).toEqual([]);
  });
});

describe('UXC part 1: CTRL+C reads the card as plain text', () => {
  it('its title, the first layer, a rule, the second, then what it needs; the same text every time', () => {
    const card = inspectItem(blade(), player());
    const text = cardText(card);
    const lines = text.split('\n');
    expect(lines[0]).toBe(card.title);
    const rule = lines.indexOf('--');
    expect(rule).toBe(1 + firstLayer(card).length);
    expect(lines.slice(1, rule)).toEqual(firstLayer(card).map(([k, v]) => `${k}: ${v}`));
    expect(lines.slice(rule + 1, rule + 1 + secondLayer(card).length)).toEqual(secondLayer(card).map(([k, v]) => `${k}: ${v}`));
    expect(cardText(inspectItem(blade(), player()))).toBe(text);
  });

  it('a card with nothing beneath has no rule, and says what it needs last', () => {
    const card: Card = { title: 'Chest', rows: [['Rank', 'F']], needs: ['Move closer'], canAct: false, compact: 'Chest' };
    expect(cardText(card)).toBe('Chest\nRank: F\nMove closer');
  });
});

describe('UXC part 1: the held key, on the card itself', () => {
  let host: HTMLDivElement;
  let root: Root;
  const press = async (type: 'keydown' | 'keyup', init: KeyboardEventInit) => {
    let event!: KeyboardEvent;
    await act(async () => { event = new KeyboardEvent(type, { bubbles: true, cancelable: true, ...init }); window.dispatchEvent(event); });
    return event;
  };
  const rowsShown = () => [...host.querySelectorAll('.ws-card__row')].map(r => r.textContent);
  const mount = async (card: Card) => { await act(async () => { root.render(createElement(CardView, { card })); }); };

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    useCardKeys.setState({ deep: false });
  });
  afterEach(async () => {
    await act(async () => { root.unmount(); });
    host.remove();
    vi.restoreAllMocks();
  });

  it('the card names the key in its corner while it has a second layer, and not when it has none', async () => {
    await mount(inspectItem(blade(), player()));
    expect(host.querySelector('.ws-card__title')!.textContent).toMatch(/ALT/);
    await mount({ title: 'Chest', rows: [['Rank', 'F']], needs: [], canAct: false, compact: 'Chest' });
    expect(host.querySelector('.ws-card__title')!.textContent).not.toMatch(/ALT/);
  });

  it('holding ALT adds the second layer beneath, in place: every first row stays where it was, in its order', async () => {
    const card = inspectItem(blade(), player());
    await mount(card);
    const before = rowsShown();
    expect(before).toHaveLength(firstLayer(card).length);
    expect(host.querySelector('.ws-card__more')).toBeNull();

    const down = await press('keydown', { key: 'Alt', altKey: true });
    // The browser's own menu does not take the key while a card is up
    expect(down.defaultPrevented).toBe(true);
    const after = rowsShown();
    expect(after).toHaveLength(card.rows.length);
    expect(after.slice(0, before.length)).toEqual(before);
    // The rule sits after the last first row and before the first second row
    const rule = host.querySelector('.ws-card__more')!;
    const shown = host.querySelectorAll('.ws-card__row');
    expect(shown[before.length - 1].compareDocumentPosition(rule) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(rule.compareDocumentPosition(shown[before.length]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // It says the copy key, in words
    expect(rule.textContent).toMatch(/CTRL\+C/);

    await press('keyup', { key: 'Alt' });
    expect(rowsShown()).toEqual(before);
  });

  it('a window that loses focus lets go of the key', async () => {
    await mount(inspectItem(blade(), player()));
    await press('keydown', { key: 'Alt', altKey: true });
    expect(host.querySelector('.ws-card__more')).not.toBeNull();
    await act(async () => { window.dispatchEvent(new Event('blur')); });
    expect(host.querySelector('.ws-card__more')).toBeNull();
  });

  it('the layers are told apart by a rule line and a word, never by a hue alone', () => {
    const css = SRC('src/components/ui/kit.css');
    const rule = css.match(/\.ws-card__more\s*\{[^}]*\}/)?.[0] ?? '';
    expect(rule).toMatch(/border-top:\s*\d+px\s+(solid|dashed|double)/);
  });

  it('hover and the keyboard share it: a card opened by focus through the hover layer opens beneath on the same key', async () => {
    const button = document.createElement('button');
    document.body.appendChild(button);
    await act(async () => { root.render(createElement(HoverLayer)); });
    await act(async () => { useHover.getState().show(blade(), button); });
    expect(host.querySelector('.ws-card')).not.toBeNull();
    expect(host.querySelector('.ws-card__more')).toBeNull();
    await press('keydown', { key: 'Alt', altKey: true });
    expect(host.querySelector('.ws-card__more')).not.toBeNull();
    await press('keyup', { key: 'Alt' });
    await act(async () => { useHover.getState().clear(); });
    button.remove();
  });

  describe('CTRL+C', () => {
    let written: string[];
    beforeEach(() => {
      written = [];
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (t: string) => { written.push(t); } } });
    });

    it('copies the card that is up, as its text', async () => {
      const card = inspectItem(blade(), player());
      await mount(card);
      const e = await press('keydown', { key: 'c', code: 'KeyC', ctrlKey: true });
      expect(e.defaultPrevented).toBe(true);
      expect(written).toEqual([cardText(card)]);
    });

    it('is the card\'s only while nothing is selected and nothing is being typed in', async () => {
      await mount(inspectItem(blade(), player()));
      const input = document.createElement('input');
      document.body.appendChild(input);
      input.focus();
      const typing = new KeyboardEvent('keydown', { key: 'c', code: 'KeyC', ctrlKey: true, bubbles: true, cancelable: true });
      await act(async () => { input.dispatchEvent(typing); });
      expect(written).toEqual([]);
      expect(typing.defaultPrevented).toBe(false);
      input.remove();

      const words = document.createElement('p');
      words.textContent = 'some words a person selected';
      document.body.appendChild(words);
      const range = document.createRange();
      range.selectNodeContents(words);
      window.getSelection()!.removeAllRanges();
      window.getSelection()!.addRange(range);
      const selecting = await press('keydown', { key: 'c', code: 'KeyC', ctrlKey: true });
      expect(written).toEqual([]);
      expect(selecting.defaultPrevented).toBe(false);
      window.getSelection()!.removeAllRanges();
      words.remove();
    });

    it('with two cards up, the one that came up last is copied', async () => {
      const second = document.createElement('div');
      document.body.appendChild(second);
      const other = createRoot(second);
      const first = inspectItem(blade(), player());
      const later: Card = { title: 'Chest', rows: [['Rank', 'F']], needs: [], canAct: false, compact: 'Chest' };
      await mount(first);
      await act(async () => { other.render(createElement(CardView, { card: later })); });
      await press('keydown', { key: 'c', code: 'KeyC', ctrlKey: true });
      expect(written).toEqual([cardText(later)]);
      await act(async () => { other.unmount(); });
      second.remove();
      // Gone, the one beneath it is the card that is up
      await press('keydown', { key: 'c', code: 'KeyC', ctrlKey: true });
      expect(written[1]).toBe(cardText(first));
    });

    it('with no card up, CTRL+C is left to the page', async () => {
      const e = await press('keydown', { key: 'c', code: 'KeyC', ctrlKey: true });
      expect(written).toEqual([]);
      expect(e.defaultPrevented).toBe(false);
    });
  });
});
