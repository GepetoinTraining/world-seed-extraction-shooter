/**
 * HOW A BLOW READS ON THE FIELD, part 3: a record of the fight that stays (the UX pass, ux-fight). Bars set before the build.
 *
 * Put to Pedro, 2026-11-12: "A number over each blow, given and taken, and a fight log that stays."
 * His answer: "might be not fluid enough in our animation style, maybe the size of the proj?"
 *
 * Read as: nothing new on the field. What the fight said, each blow given and taken with its figure, saying in words
 * whether the figure is before or after armour (his standing ruling), is kept in a record the player opens on purpose,
 * by a key (L) and a button, scrolls, and copies as text. It lasts the dive and stays until the next one begins.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot, Root } from 'react-dom/client';
import { FightRecord, useFightRecord, FightEntry } from '../src/logic/systems/FightRecord';
import { FightRecordOverlay, FightRecordButton } from '../src/components/FightRecordView';
import { EntityType, IWorldEntity } from '../shared/entities/world/types';
import { Rarity } from '../shared/types';

const SRC = (p: string) => readFileSync(p, 'utf8');

describe('a record of the fight that stays', () => {
  const at = (s: number) => 1_000_000 + s * 1000;
  const begun = at(0);
  const given: FightEntry = { kind: 'given', at: at(42), target: 'an unknown contact', by: 'shot', figure: 11 };

  beforeEach(() => { useFightRecord.setState({ key: null }); useFightRecord.getState().begin('dive-1', 'The Ledger Flats', begun); });

  it('a blow given says its figure before armour, and that all of it landed, since a creature wears none', () => {
    const line = FightRecord.say(given);
    expect(line).toMatch(/11 before armour/);
    expect(line).toMatch(/all 11 landed/);
    expect(line).toMatch(/wears no armour/);
    expect(FightRecord.say({ ...given, glance: true, figure: 6 })).toMatch(/glanced/);
    expect(FightRecord.say({ ...given, beside: true })).toMatch(/^Someone beside you/);
    expect(FightRecord.line(given, begun)).toMatch(/^0:42 +GIVEN +You hit an unknown contact with a shot/);
  });

  it('a blow taken says its figure before armour and what got through after armour; dodged, blocked, a ward and a working say so', () => {
    const blow = { from: 'an unknown contact', by: 'blow' as const, figure: 6 };
    const taken: FightEntry = { kind: 'taken', at: at(44), blows: [blow], afterArmour: 4, dodged: false, blocked: false, working: 0, ward: 0, took: 4 };
    expect(FightRecord.say(taken)).toMatch(/6 before armour, 4 after armour/);
    expect(FightRecord.line(taken, begun)).toMatch(/^0:44 +TAKEN /);
    expect(FightRecord.say({ ...taken, dodged: true, afterArmour: 0, took: 0 })).toMatch(/6 before armour.*dodged.*nothing landed/);
    expect(FightRecord.say({ ...taken, blocked: true, afterArmour: 3, took: 3 })).toMatch(/blocked/);
    const two: FightEntry = { ...taken, blows: [blow, { from: 'Grimfang', by: 'shot', figure: 4 }], afterArmour: 7, took: 7 };
    expect(FightRecord.say(two)).toMatch(/\(6\).*Grimfang's shot \(4\).*10 before armour, 7 after armour/);
    const poisoned: FightEntry = { kind: 'taken', at: at(45), blows: [], afterArmour: 0, dodged: false, blocked: false, working: 2, ward: 0, took: 2 };
    expect(FightRecord.say(poisoned)).toMatch(/working on you took 2.*armour does not stop it/);
    expect(FightRecord.say({ ...taken, ward: 3, took: 1 })).toMatch(/Your ward took 3 of it, and 1 reached you/);
  });

  it('a body is named as its card names it, and a creature with no name of its own by the rank the field marks on it', () => {
    const mob = (rank: string, displayName?: string) => ({ id: 'x', type: EntityType.MOB, definitionId: 'd', position: { x: 0, y: 0 }, rank, rarity: Rarity.COMMON, ...(displayName ? { displayName } : {}) }) as IWorldEntity;
    expect(FightRecord.nameOf(mob('C'))).toBe('a rank C unknown contact');
    expect(FightRecord.nameOf(mob('F'))).toBe('a rank F unknown contact');
    expect(FightRecord.nameOf(mob('C', 'Grimfang the Late'))).toBe('Grimfang the Late');
    expect(FightRecord.nameOf(undefined)).toBe('something');
    expect(SRC('src/components/WorldCanvas.tsx')).toMatch(/FightRecord\.nameOf\(/);
  });

  it('what works on a creature, a blow held up by its ground, and a body falling are said', () => {
    expect(FightRecord.say({ kind: 'working', at: at(1), target: 'an unknown contact', figure: 3 })).toMatch(/took 3.*no armour/);
    expect(FightRecord.say({ kind: 'held', at: at(1), target: 'Grimfang', by: 'swing' })).toMatch(/landed on nothing/);
    expect(FightRecord.line({ kind: 'down', at: at(70), target: 'Grimfang' }, begun)).toMatch(/^1:10 +DOWN +Grimfang is down\./);
  });

  it('a run of bites from what works on a body is one line, with what it took in all and in how many bites; nothing else folds', () => {
    const bite = (s: number, n: number): FightEntry => ({ kind: 'taken', at: at(s), blows: [], afterArmour: 0, dodged: false, blocked: false, working: n, ward: 0, took: n });
    const { addAll } = useFightRecord.getState();
    addAll([bite(10, 1), bite(11, 2), bite(12, 1)]);
    addAll([{ kind: 'working', at: at(13), target: 'Grimfang', figure: 3 }, { kind: 'working', at: at(14), target: 'Grimfang', figure: 3 }, { kind: 'working', at: at(15), target: 'an unknown contact', figure: 3 }]);
    addAll([given, given, bite(20, 1)]);
    const lines = useFightRecord.getState().entries.map(e => FightRecord.say(e));
    expect(lines[0]).toMatch(/working on you took 4 over 3 bites; armour does not stop it/);
    expect(lines[1]).toMatch(/working on Grimfang took 6 over 2 bites/);
    expect(lines[2]).toMatch(/working on an unknown contact took 3;/);
    expect(lines.slice(3, 5)).toEqual([FightRecord.say(given), FightRecord.say(given)]);
    expect(lines[5]).toMatch(/working on you took 1;/);
    expect(lines.length).toBe(6);
    expect(FightRecord.line(useFightRecord.getState().entries[0], begun)).toMatch(/^0:10 /);
  });

  it('it lasts the dive, keeps every line in order, and a new dive begins it again', () => {
    const add = useFightRecord.getState().add;
    for (let i = 0; i < 10_000; i++) add({ ...given, at: at(i) });
    expect(useFightRecord.getState().entries.length).toBe(10_000);
    useFightRecord.getState().begin('dive-1', 'The Ledger Flats', at(5));
    expect(useFightRecord.getState().entries.length).toBe(10_000);
    useFightRecord.getState().begin('dive-2', 'Elsewhere', at(9));
    expect(useFightRecord.getState().entries.length).toBe(0);
    expect(useFightRecord.getState().title).toBe('Elsewhere');
  });

  it('copied as text: a title, what before and after armour mean, then every line in order', () => {
    const { add } = useFightRecord.getState();
    add({ ...given, at: at(3) });
    add({ kind: 'down', at: at(9), target: 'an unknown contact' });
    const text = FightRecord.text(useFightRecord.getState());
    const lines = text.split('\n');
    expect(lines[0]).toMatch(/THE FIGHT'S RECORD/);
    expect(lines[0]).toMatch(/The Ledger Flats/);
    expect(text).toMatch(/Before armour: the blow as it was let go/);
    expect(text).toMatch(/After armour: what reached the body/);
    const body = lines.filter(l => /^\d+:\d\d /.test(l));
    expect(body).toEqual([FightRecord.line({ ...given, at: at(3) }, begun), FightRecord.line({ kind: 'down', at: at(9), target: 'an unknown contact' }, begun)]);
  });
});

describe('the record is opened on purpose, by a key and a button, scrolled and copied', () => {
  let host: HTMLDivElement;
  let root: Root;
  const key = (k: string, target: EventTarget = window) => target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));

  beforeAll(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; });
  beforeEach(() => {
    host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
    useFightRecord.getState().begin('dive-v', 'The Ledger Flats', 0);
    useFightRecord.getState().add({ kind: 'given', at: 4000, target: 'an unknown contact', by: 'swing', figure: 17 });
    useFightRecord.setState({ open: false });
  });
  afterEach(async () => { await act(async () => { root.unmount(); }); host.remove(); });

  it('L opens it and L or Escape puts it away; L typed into a field does nothing', async () => {
    await act(async () => { root.render(createElement(FightRecordOverlay)); });
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    await act(async () => { key('l'); });
    const dialog = host.querySelector('[role="dialog"]') as HTMLElement;
    expect(dialog).not.toBeNull();
    expect(dialog.textContent).toMatch(/17 before armour/);
    await act(async () => { key('L'); });
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    await act(async () => { key('l'); });
    await act(async () => { key('Escape'); });
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    const input = document.createElement('input'); document.body.appendChild(input);
    await act(async () => { key('l', input); });
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    input.remove();
  });

  it('its lines scroll, and COPY AS TEXT hands the clipboard the record as text', async () => {
    const wrote = vi.fn(async (_: string) => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: wrote }, configurable: true });
    useFightRecord.setState({ open: true });
    await act(async () => { root.render(createElement(FightRecordOverlay)); });
    const list = host.querySelector('[data-fight-lines]') as HTMLElement;
    expect(list.style.overflowY).toBe('auto');
    const copy = [...host.querySelectorAll('button')].find(b => /COPY AS TEXT/.test(b.textContent ?? ''))!;
    await act(async () => { copy.click(); });
    expect(wrote).toHaveBeenCalledWith(FightRecord.text(useFightRecord.getState()));
  });

  it('a button opens it too, on the field beside the sheet and on the receipt, and the key help names L', async () => {
    await act(async () => { root.render(createElement(FightRecordButton)); });
    const button = host.querySelector('button')!;
    expect(button.textContent).toMatch(/L/);
    expect(button.textContent).toMatch(/RECORD/);
    await act(async () => { button.click(); });
    expect(useFightRecord.getState().open).toBe(true);
    const canvas = SRC('src/components/WorldCanvas.tsx');
    expect(canvas).toMatch(/<FightRecordButton/);
    expect(canvas).toMatch(/<Kbd>L<\/Kbd> record/);
    expect(SRC('src/components/ReceiptScreen.tsx')).toMatch(/<FightRecordButton/);
    expect(SRC('App.tsx').match(/<FightRecordOverlay \/>/g)?.length).toBe(2);
  });

  it('the field writes the record from what landed, given and taken', () => {
    const canvas = SRC('src/components/WorldCanvas.tsx');
    expect(canvas).toMatch(/useFightRecord\.getState\(\)\.begin\(/);
    expect(canvas).toMatch(/kind: 'given'/);
    expect(canvas).toMatch(/kind: 'taken'/);
    expect(canvas).toMatch(/kind: 'down'/);
  });
});
