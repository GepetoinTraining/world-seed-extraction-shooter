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
import { CombatMath } from '../src/entities/combat/CombatMath';
import { StatSystem } from '../shared/logic/systems/StatSystem';
import { WebSystem } from '../shared/logic/systems/WebSystem';
import { EffectSystem } from '../shared/logic/systems/EffectSystem';
import { WeaveSystem } from '../src/logic/systems/WeaveSystem';
import { ProgressionSystem } from '../shared/entities/player/systems/ProgressionSystem';
import { LoadoutSystem } from '../shared/entities/player/systems/LoadoutSystem';
import { ContentRegistry } from '../shared/logic/theme/ContentRegistry';
import { FIRST_THEME_PACK } from '../shared/logic/theme/boot';
import { cycleMs, fireMode, windupOf } from '../src/logic/systems/FieldInput';
import { isThrowable } from '../shared/entities/item/Throwable';
import { TILE_PX } from '../shared/entities/world/grid';
import { PROJECTILE_RANGE_PX } from '../shared/entities/combat/projectileSystem';
import { THROW_TILES, volleyShots } from '../shared/logic/theme/ThemeFormula';
import { SkillNames } from '../src/logic/systems/SkillNames';
import { said as sayNumber } from '../src/logic/systems/SheetWords';
import { inspectHand, inspectSkill } from '../src/render/atoms/inspect';
import { Hotbar } from '../src/components/Hotbar';
import { IEquipmentState, ISkillState } from '../shared/types';

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

// =============================================================================
// Part 2. Each skill answers with its own numbers. Pedro: "yes". His earlier words on the sheet: "the way the skills
// come into play don't tell anyone anything". In the game this comes from, attack numbers left the sheet and each
// skill shows its own. A card for a hand in use and for a held skill: what its blow or act comes to now with what is
// held and worn, what it costs, its reach or shape, what grows it. Every number read through the rules' own functions;
// numbers up top, any sentence beneath. The hotbar's slots answer with it.
// =============================================================================

const compiled = () => ContentRegistry.compiled(FIRST_THEME_PACK.themeId)!;
const allGear = () => [...Object.values(compiled().items).flat(), ...compiled().craftedGear] as any[];
const mintGear = (def: any, key: string): IItem => ItemFactory.createFromTemplate(def, true, Rng.fromKey(key));
/** The first piece of the pack that fires this way, minted. */
const pieceThat = (test: (i: IItem) => boolean, key: string): IItem => {
  for (const def of allGear()) {
    const i = mintGear(def, `${key}:${def.universal_name}`);
    if (i.isIdentified !== false && test(i)) return i;
  }
  throw new Error(`no piece for ${key}`);
};
const wearing = (pairs: [string, IItem][]): IEquipmentState => ({ slots: Object.fromEntries(pairs.map(([s, i]) => [s, i.id])), items: pairs.map(p => p[1]), frames: {}, protected: [] } as unknown as IEquipmentState);
const holding = (pairs: [string, IItem][], over: Partial<IPlayer> = {}): IPlayer => ({ ...usePlayerStore.getState().player, equipment: wearing(pairs), ...over });
const pctOf = (share: number) => `${Math.round(share * 100)}%`;
const row = (card: Card, k: string) => card.rows.find(([key]) => key === k)?.[1];
const swinging = (i: IItem) => fireMode(i) === 'MELEE' && !(i.tags ?? []).includes('tool');
const nameOf = (i: IItem) => LoadoutSystem.shownName(i);
const withSkills = (skills: Record<string, ISkillState>) => ({ bank: { ...usePlayerStore.getState().player.bank, universalSkills: skills } });

describe('UXC part 2: a hand in use answers with its own numbers', () => {
  it('its blow is the fight\'s own: the hit before crits and glances, at the hand\'s real pace, before armour', () => {
    const w = pieceThat(swinging, 'uxc:melee');
    const p = holding([['RIGHT_HAND', w]]);
    const rank = ProgressionSystem.rankOf(p);
    const hit = CombatMath.baseHit(w, p.equipment, p.attributes, WebSystem.handPower(p, w), rank);
    const perSecond = 1000 / cycleMs(w, p.equipment, p.attributes);
    const card = inspectHand(p, 'RIGHT_HAND');
    expect(card.title).toBe(nameOf(w));
    expect(row(card, 'Blow')).toBe(`${sayNumber(hit)} a blow, ${sayNumber(hit * perSecond)} a second, before armour`);
    expect(row(card, 'Crit')).toBe(`${pctOf(StatSystem.critChance(p.equipment, p.attributes))} of hits, ×${sayNumber(CombatMath.critMultiplier(p.equipment))}`);
    expect(row(card, 'Glance')).toBe(`${pctOf(CombatMath.glanceChance(p.equipment, p.attributes, rank))} of hits, for ${pctOf(CombatMath.glanceFactor())}`);
    expect(row(card, 'Wind-up')).toBe(`${sayNumber(windupOf(w, p.equipment, p.attributes).ms / 1000)} s`);
    expect(row(card, 'Cost')).toBe('none of the day\'s energy');
  });

  it('a swing says how far and how wide its kind strikes, and a haft says what it misses close', () => {
    const w = pieceThat(swinging, 'uxc:melee');
    const shape = CombatMath.strikeOf(w);
    const reach = row(inspectHand(holding([['RIGHT_HAND', w]]), 'RIGHT_HAND'), 'Reach')!;
    expect(reach).toContain(`${sayNumber(shape.reachPx / TILE_PX)} tiles`);
    expect(reach).toContain(`${Math.round((shape.halfAngle * 2 * 180) / Math.PI)}° wide`);
    // The pinned pack's hafted pieces are its tools, which swing as well
    const haft = pieceThat(i => fireMode(i) === 'MELEE' && CombatMath.strikeOf(i).innerPx > 0, 'uxc:haft');
    expect(row(inspectHand(holding([['RIGHT_HAND', haft]]), 'RIGHT_HAND'), 'Reach')).toContain(`nothing within ${sayNumber(CombatMath.strikeOf(haft).innerPx / TILE_PX)} tiles`);
  });

  it('a shot says how many leave the hand and how far they fly; a bare hand throws', () => {
    const bow = pieceThat(i => fireMode(i) === 'SHOT' && !isThrowable(i), 'uxc:shot');
    const shots = volleyShots(CombatMath.volleyOf(bow)).length;
    expect(row(inspectHand(holding([['RIGHT_HAND', bow]]), 'RIGHT_HAND'), 'Reach')).toBe(`${shots === 1 ? 'one shot' : `${shots} shots`}, ${sayNumber(PROJECTILE_RANGE_PX / TILE_PX)} tiles`);
    const bare = inspectHand(holding([]), 'RIGHT_HAND');
    expect(bare.title).toBe('Bare hand');
    expect(row(bare, 'Reach')).toBe(`one throw, ${THROW_TILES} tiles`);
  });

  it('a stone in the hand spends itself, and says how many are left to throw', () => {
    const def = Object.values(RESOURCE_DEFINITIONS).find(d => isThrowable(ItemFactory.createResourceItem(d as never, Rng.fromKey('uxc:try'))))!;
    const stone = ItemFactory.createResourceItem(def as never, Rng.fromKey('uxc:stone'));
    const carried = [ItemFactory.createResourceItem(def as never, Rng.fromKey('uxc:stone2'))];
    const p = holding([['RIGHT_HAND', stone]], { currentSession: { ...(usePlayerStore.getState().player.currentSession ?? {}), inventory: carried } as never });
    expect(row(inspectHand(p, 'RIGHT_HAND'), 'Cost')).toBe('the stone itself, 2 to throw');
  });

  it('the skill that reads on the hand says its level and its share of the blow; with none, it says none does', () => {
    const w = pieceThat(swinging, 'uxc:melee');
    const tag = (w.tags ?? []).find(t => t !== 'weapon' && t !== 'melee') ?? 'melee';
    const skill: ISkillState = { ...WebSystem.freshSkill(`skill_uxc_${tag}`, [tag], 0), level: 7 };
    const p = holding([['RIGHT_HAND', w]], withSkills({ [skill.id]: skill }));
    expect(row(inspectHand(p, 'RIGHT_HAND'), 'Grows')).toBe(`${SkillNames.nameOf(skill.id)}, level 7: +${Math.round(WebSystem.skillPower(skill) * 100)}%`);
    const none = holding([['RIGHT_HAND', w]], withSkills({}));
    expect(row(inspectHand(none, 'RIGHT_HAND'), 'Grows')).toBe('no skill you hold reads on it');
  });

  it('numbers stand up top; what they mean is said beneath, in sentences', () => {
    const w = pieceThat(swinging, 'uxc:melee');
    const card = inspectHand(holding([['RIGHT_HAND', w]]), 'RIGHT_HAND');
    for (const [k, v] of firstLayer(card)) expect(v, k).not.toMatch(/\.$/);
    expect(secondLayer(card).length).toBeGreaterThan(0);
    for (const [k, v] of secondLayer(card)) expect(v, k).toMatch(/\.$/);
  });

  it('a piece not read answers with its own card and gives away nothing', () => {
    const w = pieceThat(swinging, 'uxc:melee');
    const card = inspectHand(holding([['RIGHT_HAND', { ...w, isIdentified: false } as IItem]]), 'RIGHT_HAND');
    expect(card.title).toBe('Unidentified Signal');
    expect(card.rows.some(([k]) => k === 'Blow')).toBe(false);
  });

  it('a focus set to a working says what the working does, what it draws and how long it is drawn', () => {
    const focus = pieceThat(i => fireMode(i) === 'FOCUS', 'uxc:focus');
    const theme = ContentRegistry.get(FIRST_THEME_PACK.themeId)!;
    const elements = [...new Set(theme.abilities.flatMap(a => a.elements))].slice(0, 2);
    const p = holding([['RIGHT_HAND', focus]], { activeCast: { kind: 'weave', elements } });
    const rank = ProgressionSystem.rankOf(p);
    const ability = WeaveSystem.weave(elements);
    const card = inspectHand(p, 'RIGHT_HAND');
    const caster = { rank, power: StatSystem.castPower(p.attributes) };
    const [low, high] = EffectSystem.magnitudeRange(ability, caster);
    expect(row(card, 'Casts')).toBe(ability.name);
    expect(row(card, 'Does')).toBe(`${low} to ${high}`);
    expect(row(card, 'Cost')).toBe(`${WeaveSystem.aetherPerElement(ability, rank)} aether of each: ${ability.elements.join(', ')}`);
    // The range is the cast's own: every roll lands inside it
    for (let n = 0; n < 40; n++) {
      const m = EffectSystem.resolve(ability, caster, `uxc:${n}`).magnitude;
      expect(m).toBeGreaterThanOrEqual(low);
      expect(m).toBeLessThanOrEqual(high);
    }
  });
});

describe('UXC part 2: a held skill answers with its own numbers', () => {
  it('its level, its share of a blow with a weapon it fits, and its circles; what grows it beneath', () => {
    const w = pieceThat(swinging, 'uxc:melee');
    const tag = (w.tags ?? []).find(t => t !== 'weapon' && t !== 'melee') ?? 'melee';
    const skill: ISkillState = { ...WebSystem.freshSkill(`skill_uxc_${tag}`, [tag], 0), level: 4, circles: 2 };
    const p = holding([['RIGHT_HAND', w]], withSkills({ [skill.id]: skill }));
    const card = inspectSkill(p, skill.id, w)!;
    expect(card.title).toBe(SkillNames.nameOf(skill.id));
    expect(row(card, 'Level')).toBe(`4, rank ${ProgressionSystem.skillRankOf(skill)}`);
    expect(row(card, 'On blows')).toBe(`+${Math.round(WebSystem.skillPower(skill) * 100)}%, ${nameOf(w)}`);
    expect(row(card, 'Circles')).toMatch(/^2, a gift at \d+$/);
    expect(keys(secondLayer(card))).toContain('Grows');
    expect(inspectSkill(p, 'skill_not_held')).toBeNull();
  });

  it('a skill that gathers says what it takes off a try, against untrained', () => {
    const ore = RESOURCE_DEFINITIONS['res_iron_vein'] as any;
    const pair = WebSystem.mint(['mining', 'pickaxe', 'tool'], ore.tags ?? []);
    const skill: ISkillState = { ...WebSystem.freshSkill(pair.id, pair.tags, 0), level: 6 };
    const p = holding([], withSkills({ [skill.id]: skill }));
    const untrained = { ...p, bank: { ...p.bank, universalSkills: {} } };
    const energy = Math.round((1 - WebSystem.energyFor(p, pair, 100).cost / WebSystem.energyFor(untrained, pair, 100).cost) * 100);
    const time = Math.round((1 - WebSystem.clockFactor(p, pair) / WebSystem.clockFactor(untrained, pair)) * 100);
    expect(row(inspectSkill(p, skill.id)!, 'Work')).toBe(`${energy}% less energy, ${time}% less time than untrained`);
  });
});

describe('UXC part 2: the hotbar\'s slots answer with it', () => {
  let host: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(async () => {
    await act(async () => { root.unmount(); });
    host.remove();
    useHover.getState().clear();
  });

  it('a hand\'s slot, held or bare, opens the hand\'s card, by the pointer or the keyboard', async () => {
    const w = pieceThat(swinging, 'uxc:melee');
    const before = usePlayerStore.getState().player;
    usePlayerStore.setState(s => ({ player: { ...s.player, equipment: wearing([['RIGHT_HAND', w]]) } }));
    try {
      await act(async () => { root.render(createElement('div', null, createElement(Hotbar), createElement(HoverLayer))); });
      const cell = (slot: string) => host.querySelector(`[data-drop-slot="${slot}"]`) as HTMLButtonElement;
      const title = () => host.querySelector('.ws-card__title span')?.textContent;
      await act(async () => { cell('RIGHT_HAND').focus(); });
      expect(title()).toBe(nameOf(w));
      expect([...host.querySelectorAll('.ws-card__row .k')].map(k => k.textContent)).toContain('Blow');
      await act(async () => { cell('LEFT_HAND').focus(); });
      expect(title()).toBe('Bare hand');
    } finally {
      usePlayerStore.setState({ player: before });
    }
  });

  it('the hotbar reads the hand\'s card, and draws the piece inside it without a card of its own', () => {
    const bar = SRC('src/components/Hotbar.tsx');
    expect(bar).toMatch(/handHoverProps\(cell\.slot\)/);
    expect(bar).toMatch(/<ItemSprite[^>]*noHover/);
  });

  it('the sheets are left as they were: they are another session\'s', () => {
    for (const f of ['src/components/LargeSheet.tsx', 'src/components/CharacterSheet.tsx', 'src/components/PlayerHub.tsx']) expect(SRC(f)).not.toMatch(/inspectHand|inspectSkill/);
  });
});
