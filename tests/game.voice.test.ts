/**
 * THE GAME'S VOICE (GV), bars set before the build and seen red.
 *
 * Pedro, 2026-11-12, after a long run on main: "we need to AGAIN make a pass to remove the Opus speech from the game
 * everywhere, it's exposing everything, literally it called the loadout a harness". And: "the base stats, all of them are
 * cool, but right now the way the skills come into play don't tell anyone anything, the character sheet itself needs a
 * passover". The first time it was asked (D127, 2026-11-01: "it feels less game and more system's architecture teaching
 * economy"; PLAN.md's leg 4, "terminology needs to be earned, never thrusted out at the user") a bar that scans the
 * screens for system words was planned and never built, so every builder after wrote in their own voice again. This is
 * that bar. It renders a screen the way a player meets it and reads every word on it: the text, and every title and
 * aria-label a pointer or a reader would hear.
 *
 * A screen fails it when it shows:
 * - a word that is only the builders' (BUILDERS_WORDS below, gathered from the code and the notes);
 * - a raw name from the code: snake_case, SHOUTING_SNAKE, camelCase, an id;
 * - a skill read as its tag list ("projectile, ranged on beast, tech");
 * - a number to more than one place, which is a formula's working and not a figure.
 *
 * Part 1 renders the two character sheets. Part 2 adds every other screen to SCREENS.
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
import { TagLaw } from '../shared/logic/content/TagLaw';
import { useSheet } from '../src/components/ui/stores';
import { LargeSheet } from '../src/components/LargeSheet';
import { CharacterSheet } from '../src/components/CharacterSheet';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * Words that name the machinery, never the world. Each was found in the code or the builders' notes as their own
 * word for something the player meets under another, or for how a number is made. A word the game's world uses on
 * purpose (the Seed, a rank, a gift, a circle, lore, a working, the web, the vault) is not here. Strike one by taking it
 * out, with a ledger line.
 */
export const BUILDERS_WORDS: { word: RegExp; why: string }[] = [
  { word: /\bharness/i, why: 'what is worn; the loadout (Wave 10C notes, store refusals)' },
  { word: /\bengrams?\b/i, why: 'a skill (Wave 9\'s skills tab)' },
  { word: /\bhead budget\b/i, why: 'the head\'s four places (D22)' },
  { word: /\brungs?\b/i, why: 'how far a skill has grown (D27\'s mastery steps)' },
  { word: /\btags?\b/i, why: 'the registry\'s words a skill and a piece are built from (D28)' },
  { word: /\bformula\b/i, why: 'ThemeFormula, how numbers are made' },
  { word: /\bthe law\b|\blaw's\b/i, why: 'the judging code (PieceLaw, LoreLaw, the tag law)' },
  { word: /\bcurve\b/i, why: 'how a rating becomes a chance' },
  { word: /\bratings?\b/i, why: 'evasion and accuracy as the code holds them' },
  { word: /\bmultipl(?:ier|ies|y)\b/i, why: 'a formula\'s working' },
  { word: /\bfactor\b/i, why: 'a formula\'s working' },
  { word: /\bits floor\b|\bover (?:its|the) floor\b/i, why: 'a stat\'s starting point in the code' },
  { word: /\bfor each point\b|\bper point\b|\ba point of\b/i, why: 'how a number is computed' },
  { word: /\breaders?\b/i, why: 'a rules function (the builders\' log)' },
  { word: /\bdoor\b/i, why: 'the one way through to the model or a rule (StudyDoor, RestDoor)' },
  { word: /\bbatch(?:es)?\b/i, why: 'a dev run banked as content' },
  { word: /\bdreaming\b/i, why: 'how a world fills its drops (Wave 10E)' },
  { word: /\bemerge(?:s|nce)?\b/i, why: 'a forming skill\'s roll at a rest' },
  { word: /\bconcepts?\b/i, why: 'the hub web\'s hidden keys (D125)' },
  { word: /\bnodes?\b/i, why: 'a place on the tech web, as the code holds it' },
  { word: /\bderived\b|\bcomputed\b/i, why: 'how a number is made' },
  { word: /\bLLM\b|\bHaiku\b|\bSonnet\b|\bOpus\b|\bprompt\b/i, why: 'the model behind the voice' },
  { word: /\bgolden vector|\bground version\b|\bmigrat|\bhydrat|\bschema\b|\bstub\b/i, why: 'storage and testing' },
  { word: /\bspine\b|\bcoordinator\b|\bbuilders?\b|\bplaytest\b/i, why: 'the making of the game' }
];

const RAW_NAMES: { pattern: RegExp; why: string }[] = [
  { pattern: /\b[a-z0-9]+_[a-z0-9_]+\b/i, why: 'snake_case, as the code names a thing (fate_gambler, kit_bench, RIGHT_HAND)' },
  { pattern: /\b[a-z]+[A-Z][a-zA-Z]+\b/, why: 'camelCase, as a field is named' },
  { pattern: /\d+\.\d{2,}/, why: 'a number to more than one place, a formula\'s working' }
];

/** Every word a screen puts in front of a player: its text, and what a pointer or a reader hears. */
function wordsOn(root: HTMLElement): string[] {
  const out: string[] = [];
  const walk = (el: Element) => {
    for (const attr of ['title', 'aria-label', 'placeholder']) {
      const v = el.getAttribute(attr);
      if (v) out.push(v);
    }
    for (const child of Array.from(el.childNodes)) {
      if (child.nodeType === 3) { const t = child.textContent?.trim(); if (t) out.push(t); }
      else if (child.nodeType === 1) walk(child as Element);
    }
  };
  walk(root);
  return out;
}

function faultsIn(lines: string[], skillIds: string[]): string[] {
  const faults: string[] = [];
  for (const line of lines) {
    for (const { word, why } of BUILDERS_WORDS) if (word.test(line)) faults.push(`builders' word (${why}): "${line}"`);
    for (const { pattern, why } of RAW_NAMES) if (pattern.test(line)) faults.push(`raw (${why}): "${line}"`);
  }
  const all = lines.join('\n');
  for (const id of skillIds) {
    const list = WebSystem.tagWordsOf(id).join(', ');
    if (list.includes(',') && all.includes(list)) faults.push(`a skill read as its tag list: "${list}"`);
    // The stand-in name an unnamed skill falls back to ("Saw on flora, wood") is its tag list too (Q47)
    const standIn = WebSystem.nameOf(id);
    if (WebSystem.isTagListName(id, standIn) && standIn.includes(',') && all.includes(standIn)) faults.push(`a skill read as its tag list: "${standIn}"`);
  }
  return faults;
}

const UID = 'uid_voice';
const CERT = (uid: string) => ({ metadata: { uid, displayName: 'VOICE', createdAt: 0 }, publicKey: {} as any, publicKeyJWK: {} as any }) as any;

const piece = (id: string, slot: SlotType, stats: Record<string, number>, over: Partial<IItem> = {}): IItem => ({
  id, universalDefinitionId: `gear_${id}`, name: over.name ?? 'Steel-Rule Bow', description: '', type: ItemType.GEAR, slot,
  rank: UniversalRank.F, rarity: Rarity.COMMON, quality: 0, level: 1, value: 1, itemPower: 46, tags: over.tags ?? [], affixes: [],
  dimensions: { width: 1, height: 3 }, weight: 2, stats, visuals: { modelId: 'm', colorHex: '#fff' }, icon: 'i',
  history: { dropDate: 0, killCount: 0 }, isIdentified: true
}) as IItem;

/** Pedro's kind of character after a round: a fate gambler with the bench kit, a bow, skills held and many forming. */
const SKILLS = {
  held: [
    { tags: ['saw', 'flora', 'wood'], level: 4, circles: 2 },
    { tags: ['blunt', 'mineral', 'stone'], level: 2, circles: 0 },
    { tags: ['projectile', 'ranged'], level: 3, circles: 1 }
  ],
  forming: [
    { tags: ['projectile', 'ranged', 'beast', 'tech'], weight: 30 },
    { tags: ['identify_weapon'], weight: 12 },
    { tags: ['identify_armor'], weight: 25 },
    { tags: ['axe', 'flora', 'wood'], weight: 8 },
    { tags: ['berry', 'flora'], weight: 40 }
  ]
};
const idOf = (tags: string[]) => TagLaw.skillIdOf(TagLaw.canonical(tags));
const skillIds = [...SKILLS.held, ...SKILLS.forming].map(s => idOf(s.tags));

function seed() {
  localStorage.clear();
  useIdentityStore.setState({ certificate: CERT(UID) } as any);
  usePlayerStore.getState().initializeSession(CERT(UID), 'NOMAD');
  const bow = piece('bow', SlotType.MAIN_HAND, { damage: 4, attack_speed: 1.1 }, { tags: ['ranged', 'two_hand', 'physical', 'projectile'] });
  let eq = LoadoutSystem.emptyEquipment();
  eq = { ...eq, items: [bow], slots: { ...eq.slots, RIGHT_HAND: bow.id } };
  usePlayerStore.setState(s => {
    const universalSkills = { ...s.player.bank.universalSkills };
    for (const h of SKILLS.held) {
      const id = idOf(h.tags);
      universalSkills[id] = { ...WebSystem.freshSkill(id, TagLaw.canonical(h.tags), 0), level: h.level, circles: h.circles };
    }
    const skillProgress = Object.fromEntries(SKILLS.forming.map(f => {
      const id = idOf(f.tags);
      return [id, { id, tags: TagLaw.canonical(f.tags), rank: 0, attempts: 2, weight: f.weight }];
    }));
    return {
      player: {
        ...s.player,
        equipment: eq,
        levelsBanked: 7,
        creation: { origin: 'fate_gambler', main: 'perception', sub: 'intelligence', kit: 'kit_bench', className: 'Fate Gambler', answers: {}, line: '', by: 'FLOOR' },
        skillProgress,
        skillGifts: { [idOf(SKILLS.held[0].tags)]: [{ id: 'gift_steady', kind: 'passive', name: 'Steady Draw', blurb: 'The saw bites true.', stat: 'attack_speed', value: 0.05, first: true }] },
        bank: { ...s.player.bank, universalSkills, loreHeld: 12 }
      }
    };
  });
}

let host: HTMLDivElement;
let root: Root;

beforeAll(() => {
  // The sprites draw to a canvas jsdom does not have: a context that draws nothing
  const ctx = new Proxy({}, { get: (_t, k) => (k === 'canvas' ? document.createElement('canvas') : k === 'getImageData' || k === 'createImageData' ? () => ({ data: new Uint8ClampedArray(4) }) : k === 'measureText' ? () => ({ width: 0 }) : () => undefined), set: () => true });
  (HTMLCanvasElement.prototype as any).getContext = () => ctx;
});
beforeEach(() => { seed(); host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); });
afterEach(async () => { await act(async () => { root.unmount(); }); host.remove(); useSheet.setState({ open: false, large: false } as any); });

const SCREENS: { name: string; mount: () => void }[] = [
  { name: 'the large sheet, at home', mount: () => root.render(createElement(LargeSheet, {})) },
  { name: 'the small sheet, at home', mount: () => { useSheet.setState({ open: true } as any); root.render(createElement(CharacterSheet)); } }
];

describe('GV: a screen speaks as the game speaks to a player', () => {
  for (const screen of SCREENS) {
    it(`${screen.name}: no builders' word, no raw name, no tag list, no formula's working`, async () => {
      await act(async () => { screen.mount(); });
      const lines = wordsOn(host);
      expect(lines.length, 'the screen rendered').toBeGreaterThan(20);
      expect(faultsIn(lines, skillIds)).toEqual([]);
    });
  }
});

describe('GV: the sheet tells a player what each skill is and what it needs', () => {
  it('a forming skill says what it is in words, and the lore it asks against the lore held', async () => {
    await act(async () => { root.render(createElement(LargeSheet, {})); });
    const text = host.textContent ?? '';
    // Shooting beasts, as the registry's words say it: never "projectile, ranged on beast, tech"
    expect(text).toMatch(/Shooting beasts/);
    const price = WebSystem.learnPrice(0);
    expect(text).toMatch(new RegExp(`${price} lore`));
    expect(text).toMatch(/you hold 12/i);
  });

  it('a held skill says what it does when it comes into play and what makes it grow', async () => {
    await act(async () => { root.render(createElement(LargeSheet, {})); });
    const text = host.textContent ?? '';
    expect(text).toMatch(/less energy/i);
    expect(text).toMatch(/grows/i);
    // The bow fits the held shooting skill: its blows are said, as a share
    expect(text).toMatch(/blows? [^.]*\+\d+%/i);
  });

  it('a circle and a gift are said where they are spent', async () => {
    await act(async () => { root.render(createElement(LargeSheet, {})); });
    const text = host.textContent ?? '';
    expect(text).toMatch(/circle/i);
    expect(text).toMatch(/gift/i);
    expect(text).toMatch(/every third/i);
  });

  it('who the character is reads in words, never the creation record\'s ids', async () => {
    await act(async () => { root.render(createElement(LargeSheet, {})); });
    const text = host.textContent ?? '';
    expect(text).not.toMatch(/fate_gambler|kit_bench/);
    expect(text).toMatch(/WHAT A BENCH WANTS|What a bench wants/);
    expect(text).toMatch(/Perception/);
  });
});
