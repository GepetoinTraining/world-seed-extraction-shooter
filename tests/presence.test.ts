/**
 * OTHER PLAYERS, DRAWN A LITTLE BEHIND (src/logic/live/Presence.ts). Each browser says where its
 * own player is; everyone else is drawn BEHIND_MS in their own past, sliding between what they
 * said, walking on for a moment when nothing newer came, then standing and waiting.
 */
import { describe, it, expect } from 'vitest';
import { BEHIND_MS, GONE_AFTER_MS, KEEP_WALKING_MS, PresenceBook, SAY_AGAIN_MS, SAY_EVERY_MS, isWhere, placeAt, shouldSay, type IHeard, type IWhere } from '../src/logic/live/Presence';

const said = (t: number, x: number, o: Partial<IWhere> = {}): IWhere => ({ place: 'world_a', x, z: 0, facing: 'right', moving: true, t, name: 'Alder', archetype: 'NOMAD', ...o });
const heard = (uid: string, t: number, x: number, o: Partial<IWhere> = {}): IHeard => ({ uid, ...said(t, x, o) });

describe('where another player is drawn', () => {
  it('between two things said, on the straight line between them', () => {
    const line = [said(1000, 0), said(1100, 10)];
    expect(placeAt(line, 1050)).toMatchObject({ x: 5, z: 0, moving: true });
    expect(placeAt(line, 1100)).toMatchObject({ x: 10 });
  });

  it('past the last, on along its heading for a moment, then still where that left them', () => {
    const line = [said(1000, 0), said(1100, 10)];
    expect(placeAt(line, 1200)).toMatchObject({ x: 20, moving: true });
    const after = placeAt(line, 1100 + KEEP_WALKING_MS * 4)!;
    expect(after.x).toBeCloseTo(10 + KEEP_WALKING_MS / 10);
    expect(after.moving).toBe(false);
    // One who said they stopped stays where they stopped
    expect(placeAt([said(1000, 0), said(1100, 10, { moving: false })], 1500)).toMatchObject({ x: 10, moving: false });
  });

  it('before the first thing said, at the first, standing', () => {
    expect(placeAt([said(1000, 7)], 900)).toMatchObject({ x: 7, moving: false });
    expect(placeAt([], 900)).toBeNull();
  });
});

describe('everyone else, as this browser heard them', () => {
  it('is drawn BEHIND_MS in their own past, whatever the gap between the two clocks', () => {
    const book = new PresenceBook();
    // Their clock runs 50 000 ms behind this one; each message takes 30 ms
    const skew = 50_000, trip = 30;
    for (let t = 0; t <= 500; t += SAY_EVERY_MS) book.hear(heard('ws_alder', t, t / 10), t + skew + trip);
    const [alder] = book.at('world_a', 500 + skew + trip);
    expect(alder.uid).toBe('ws_alder');
    expect(alder.x).toBeCloseTo((500 - BEHIND_MS) / 10);
  });

  it('a slow message does not move the clock: the fastest one seen sets the gap', () => {
    const book = new PresenceBook();
    book.hear(heard('ws_alder', 0, 0), 30);
    book.hear(heard('ws_alder', 100, 10), 400); // came late
    book.hear(heard('ws_alder', 200, 20), 230);
    // The gap stays 30: drawn at their 300 - BEHIND_MS = 200
    expect(book.at('world_a', 330)[0].x).toBeCloseTo(20);
  });

  it('a message overtaken by a later one is put where it belongs', () => {
    const book = new PresenceBook();
    book.hear(heard('ws_alder', 0, 0), 10);
    book.hear(heard('ws_alder', 200, 20), 210);
    book.hear(heard('ws_alder', 100, 50), 215); // it went round the long way
    expect(book.at('world_a', 160)[0].x).toBeCloseTo(25); // halfway from 0 to 50, at their 50
  });

  it('only those in the same place are drawn, and one who moved on starts afresh there', () => {
    const book = new PresenceBook();
    book.hear(heard('ws_alder', 0, 0), 10);
    book.hear(heard('ws_birch', 0, 5, { place: 'world_b' }), 10);
    expect(book.at('world_a', 200).map(o => o.uid)).toEqual(['ws_alder']);
    book.hear(heard('ws_alder', 300, 900, { place: 'world_b' }), 310);
    expect(book.at('world_a', 400)).toEqual([]);
    expect(book.at('world_b', 400).map(o => [o.uid, o.x])).toEqual(expect.arrayContaining([['ws_birch', 5], ['ws_alder', 900]]));
  });

  it('one gone, or silent past GONE_AFTER_MS, is no longer drawn; anything not the shape of a thing said is dropped', () => {
    const book = new PresenceBook();
    book.hear(heard('ws_alder', 0, 0), 10);
    book.hear(heard('ws_birch', 0, 0), 10);
    book.gone('ws_birch');
    expect(book.at('world_a', 100).map(o => o.uid)).toEqual(['ws_alder']);
    expect(book.at('world_a', 10 + GONE_AFTER_MS + 1)).toEqual([]);
    book.hear({ uid: 'ws_cedar', place: 'world_a', x: 'here' } as any, 20);
    book.hear({ ...heard('ws_cedar', 0, 0), facing: 'sideways' } as any, 20);
    expect(book.size()).toBe(0);
    expect(isWhere(said(0, 0))).toBe(true);
  });
});

describe('when this browser says where its player is', () => {
  it('at most every SAY_EVERY_MS, only on a change, and again after SAY_AGAIN_MS standing still', () => {
    const a = said(0, 0, { moving: false });
    expect(shouldSay(null, a, 0, 0)).toBe(true);
    expect(shouldSay(a, said(0, 1), SAY_EVERY_MS - 1, 0)).toBe(false);
    expect(shouldSay(a, said(0, 1), SAY_EVERY_MS, 0)).toBe(true);
    expect(shouldSay(a, a, SAY_EVERY_MS * 3, 0)).toBe(false);
    expect(shouldSay(a, a, SAY_AGAIN_MS, 0)).toBe(true);
    // Somewhere else is said at once
    expect(shouldSay(a, said(0, 0, { place: 'world_b', moving: false }), 1, 0)).toBe(true);
  });
});
