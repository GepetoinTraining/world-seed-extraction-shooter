/**
 * ONE CONVERSATION AT A TIME (Pedro, 2026-11-07: "It's a queue, a person cannot talk to two at once
 * unless they're a party"). Test lines, stated plainly:
 *   - one turn is heard; everyone else waits, in the order they came
 *   - a party is one turn, and a party is mutual: naming whoever is heard does not let you in
 *   - a turn ends when its players leave; the next turn is heard
 *   - a silent turn is let go only while someone waits
 */
import { describe, it, expect } from 'vitest';
import { TalkLine, TURN_IDLE_MS, emptyLine, type ILine } from '../src/logic/live/TalkLine';

const asks = (line: ILine, ...who: [string, string[]?, number?][]) =>
  who.reduce((l, [uid, party = [], at = 0]) => TalkLine.ask(l, uid, party, at).line, line);

describe('one conversation at a time', () => {
  it('the first to ask is heard, the rest wait in the order they came, and asking again keeps your place', () => {
    const line = asks(emptyLine(), ['ana'], ['bo'], ['cy']);
    expect(TalkLine.view(line)).toEqual({ focus: ['ana'], waiting: [['bo'], ['cy']] });
    const again = TalkLine.ask(line, 'bo', [], 99);
    expect(again.place).toBe(1);
    expect(again.line).toBe(line);
    expect(TalkLine.placeOf(TalkLine.view(line), 'cy')).toBe(2);
    expect(TalkLine.placeOf(TalkLine.view(line), 'dee')).toBe(-1);
  });

  it('a party talks as one turn: its players join the turn they are in a party with, wherever it stands', () => {
    const line = asks(emptyLine(), ['ana', ['bo']], ['cy'], ['bo', ['ana']]);
    expect(TalkLine.view(line)).toEqual({ focus: ['ana', 'bo'], waiting: [['cy']] });
    // A party further back stays a party, and keeps that turn's place
    const later = asks(line, ['dee', ['eli']], ['eli', ['dee']]);
    expect(TalkLine.view(later).waiting).toEqual([['cy'], ['dee', 'eli']]);
  });

  it('naming whoever is heard is not a party: they must name you back', () => {
    const line = asks(emptyLine(), ['ana'], ['bo', ['ana']]);
    expect(TalkLine.view(line)).toEqual({ focus: ['ana'], waiting: [['bo']] });
    // In a party of three, every player of the turn must name the one joining
    const three = asks(emptyLine(), ['ana', ['bo', 'cy']], ['bo', ['ana']], ['cy', ['ana', 'bo']]);
    expect(TalkLine.view(three)).toEqual({ focus: ['ana', 'bo'], waiting: [['cy']] });
  });

  it('when the turn heard leaves, the next is heard; a party\'s turn lasts while any of it stays', () => {
    const line = asks(emptyLine(), ['ana', ['bo']], ['bo', ['ana']], ['cy']);
    const oneLeft = TalkLine.leave(line, 'ana');
    expect(TalkLine.view(oneLeft)).toEqual({ focus: ['bo'], waiting: [['cy']] });
    expect(TalkLine.view(TalkLine.leave(oneLeft, 'bo'))).toEqual({ focus: ['cy'], waiting: [] });
    // One waiting who walks off leaves the line, and nobody ahead of them moves
    expect(TalkLine.view(TalkLine.leave(line, 'cy'))).toEqual({ focus: ['ana', 'bo'], waiting: [] });
  });

  it('a turn silent for TURN_IDLE_MS is let go while someone waits, and never when nobody does', () => {
    const alone = asks(emptyLine(), ['ana', [], 0]);
    expect(TalkLine.idle(alone, TURN_IDLE_MS * 10).dropped).toEqual([]);
    expect(TalkLine.idleAt(alone)).toBeNull();

    const line = asks(emptyLine(), ['ana', [], 0], ['bo', [], 5]);
    expect(TalkLine.idleAt(line)).toBe(TURN_IDLE_MS);
    // Speaking keeps the turn: silence counts from the last thing said
    const spoke = TalkLine.said(line, 'ana', 40_000);
    expect(TalkLine.idle(spoke, TURN_IDLE_MS + 1).dropped).toEqual([]);
    // One waiting who says something does not move the clock of the turn heard
    expect(TalkLine.said(line, 'bo', 40_000)).toBe(line);
    const out = TalkLine.idle(spoke, 40_000 + TURN_IDLE_MS);
    expect(out.dropped).toEqual(['ana']);
    expect(TalkLine.view(out.line)).toEqual({ focus: ['bo'], waiting: [] });
    // The next turn's silence counts from when it was let speak, not from when it came
    expect(TalkLine.idleAt(asks(out.line, ['cy', [], 0]))).toBe(40_000 + TURN_IDLE_MS * 2);
  });
});
