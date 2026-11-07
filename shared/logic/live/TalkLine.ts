/**
 * ONE CONVERSATION AT A TIME (Pedro, 2026-11-07: "It's a queue, a person cannot talk to two at once
 * unless they're a party"). Someone being talked to gives one turn their attention. Anyone else who
 * comes to talk waits in line, in the order they came, the same first-come rule a world's chests are
 * claimed by (shared.ts). A party is one turn: its members talk to them together.
 *
 * A party here is mutual: two players are one party only when each names the other. One player
 * naming another is not enough to step into their turn, so nobody cuts the line by naming whoever
 * is being heard.
 *
 * A turn ends when its players walk off, close the talk, or drop from the room. A turn nobody has
 * said anything in for TURN_IDLE_MS is let go, but only while someone waits: alone, a player may
 * stand there as long as they like.
 *
 * Pure: the live room holds one line for each person talked to, and nothing else keeps them.
 */

/**
 * How long a turn may sit silent while someone waits. A round with the model can take a while to
 * come back, and saying anything (a round sent or answered) counts as speaking.
 * Decided here, for Pedro to overrule.
 */
export const TURN_IDLE_MS = 60_000;

export interface ITurn {
  /** The players of this turn, in the order they joined it. */
  who: string[];
  /** Each player's own party, as they said it when they asked. */
  parties: Record<string, string[]>;
  /** When this turn came to the line. */
  since: number;
  /** When anyone of this turn last said something. */
  last: number;
}

/** One person's line: the first turn is the one they are talking with. */
export interface ILine { turns: ITurn[] }

/** What a player of a line is told: who is being heard, and who waits, in order. */
export interface ILineView { focus: string[]; waiting: string[][] }

export const emptyLine = (): ILine => ({ turns: [] });

const without = (line: ILine, uid: string): ILine => ({
  turns: line.turns
    .map(t => t.who.includes(uid) ? { ...t, who: t.who.filter(w => w !== uid), parties: Object.fromEntries(Object.entries(t.parties).filter(([w]) => w !== uid)) } : t)
    .filter(t => t.who.length > 0)
});

/** Every player of a turn names `uid`, and `uid` names every one of them. */
const partyOf = (turn: ITurn, uid: string, party: readonly string[]) =>
  turn.who.every(w => party.includes(w) && (turn.parties[w] ?? []).includes(uid));

export const TalkLine = {
  /**
   * A player asks to talk. Already in the line, they keep their place. One whose party a turn
   * already in line is joins that turn; anyone else goes to the end. Place 0 is being heard.
   */
  ask(line: ILine, uid: string, party: readonly string[], now: number): { line: ILine; place: number } {
    const kept = line.turns.findIndex(t => t.who.includes(uid));
    if (kept !== -1) return { line, place: kept };
    const own = party.filter(p => p !== uid);
    const joins = own.length > 0 ? line.turns.findIndex(t => partyOf(t, uid, own)) : -1;
    if (joins !== -1) {
      const turns = line.turns.map((t, i) => i === joins ? { ...t, who: [...t.who, uid], parties: { ...t.parties, [uid]: own } } : t);
      return { line: { turns }, place: joins };
    }
    const turn: ITurn = { who: [uid], parties: { [uid]: own }, since: now, last: now };
    return { line: { turns: [...line.turns, turn] }, place: line.turns.length };
  },

  /** Something was said in a turn: it is still talking. A waiting player saying something changes nothing. */
  said(line: ILine, uid: string, now: number): ILine {
    const first = line.turns[0];
    if (!first || !first.who.includes(uid)) return line;
    return { turns: [{ ...first, last: Math.max(first.last, now) }, ...line.turns.slice(1)] };
  },

  /** A player walked off, closed the talk, or dropped: out of the line, and the next turn is heard. */
  leave: (line: ILine, uid: string): ILine => without(line, uid),

  /** The turn being heard has said nothing for TURN_IDLE_MS while someone waits: it is let go. */
  idle(line: ILine, now: number): { line: ILine; dropped: string[] } {
    const first = line.turns[0];
    if (!first || line.turns.length < 2 || now - first.last < TURN_IDLE_MS) return { line, dropped: [] };
    // The next turn is heard from now: its silence counts from when it was let speak
    const [next, ...rest] = line.turns.slice(1);
    return { line: { turns: [{ ...next, last: Math.max(next.last, now) }, ...rest] }, dropped: first.who };
  },

  /** When the turn being heard is let go, if nothing is said before then. Null when nobody waits. */
  idleAt: (line: ILine): number | null => line.turns.length < 2 ? null : line.turns[0].last + TURN_IDLE_MS,

  view: (line: ILine): ILineView => ({ focus: line.turns[0]?.who ?? [], waiting: line.turns.slice(1).map(t => t.who) }),

  /** Where a player stands in a line: 0 heard, 1 next, and so on; -1 not in it. */
  placeOf: (view: ILineView, uid: string): number =>
    view.focus.includes(uid) ? 0 : (() => { const i = view.waiting.findIndex(w => w.includes(uid)); return i === -1 ? -1 : i + 1; })(),

  /** Everyone in a line. */
  everyone: (line: ILine): string[] => line.turns.flatMap(t => t.who)
};
