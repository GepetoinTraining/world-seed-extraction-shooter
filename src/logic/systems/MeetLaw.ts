/**
 * TWO PEOPLE MEETING (Pedro, 2026-11-06): "when two npcs and no human is watching interact it gets
 * batched and sent to sonnet to define the outcomes of the conversation, when a human is walking by
 * and observing the conversation happens and bubble appear above the npcs heads".
 *
 * Everything is walked over (D109): only two people who stood in the same place meet. The model
 * writes words only, as in any talk: for each side, how the meeting sat (a band) and what they will
 * remember of it; and, where somebody is watching, the lines they said. Code turns the bands into
 * what changed: memory for both, and belonging, the rung people meet each other on.
 *
 * Pure: nothing here reaches a store or the door. MeetDoor does.
 */

import { INeedFill, NpcAgenda } from './NpcAgenda';
import { TalkLaw } from './TalkLaw';
import { IMeetAsk, IMeetLine, IMeetSideWords, IMeetWords, JUDGE_BANDS, JudgeBand, TALK_MESSAGE_LIMIT } from '../../../shared/logic/systems/TalkTypes';

export interface IMeetOutcome {
  id: string;
  a: IMeetSideWords;
  b: IMeetSideWords;
  lines: IMeetLine[];
}

const inBand = (value: unknown): value is JudgeBand => typeof value === 'string' && (JUDGE_BANDS as readonly string[]).includes(value);

export const MeetLaw = {
  /** A meeting's key: the pair in a fixed order, and the day. Two people meet once a day: the day is what memory keeps. My call; Pedro may overrule. */
  key(a: string, b: string, day: number): string {
    const [x, y] = a < b ? [a, b] : [b, a];
    return `meet|${x}|${y}|${day}`;
  },

  /**
   * One meeting's words, before the law. Both bands must be bands, the id must be the meeting's,
   * and what they remember is words only. A line that is not one of theirs, empty, or longer than
   * anyone can say at once is left out; the rest stand.
   */
  judge(words: Partial<IMeetWords> | null | undefined, ask: Pick<IMeetAsk, 'id'>): { ok: boolean; reason?: string; outcome?: IMeetOutcome } {
    if (!words || words.id !== ask.id) return { ok: false, reason: 'It answered some other meeting.' };
    if (!inBand(words.a?.band) || !inBand(words.b?.band)) return { ok: false, reason: 'It said no band the game knows.' };
    const lines = (Array.isArray(words.lines) ? words.lines : [])
      .filter((l): l is IMeetLine => !!l && (l.by === 'a' || l.by === 'b') && typeof l.text === 'string')
      .map(l => ({ by: l.by, text: l.text.trim() }))
      .filter(l => l.text.length > 0 && l.text.length <= TALK_MESSAGE_LIMIT);
    return {
      ok: true,
      outcome: {
        id: ask.id,
        a: { band: words.a!.band, remember: TalkLaw.rememberWords(words.a!.remember) },
        b: { band: words.b!.band, remember: TalkLaw.rememberWords(words.b!.remember) },
        lines
      }
    };
  },

  /** A batch's answer, meeting by meeting. What it got wrong is refused one meeting at a time. */
  judgeBatch(data: unknown, asks: Pick<IMeetAsk, 'id'>[]): { outcomes: IMeetOutcome[]; refused: { id: string; reason: string }[] } {
    const said = Array.isArray((data as { meetings?: unknown })?.meetings) ? (data as { meetings: Partial<IMeetWords>[] }).meetings : [];
    const outcomes: IMeetOutcome[] = [];
    const refused: { id: string; reason: string }[] = [];
    for (const ask of asks) {
      const words = said.find(w => w?.id === ask.id);
      const verdict = this.judge(words, ask);
      if (verdict.ok) outcomes.push({ ...verdict.outcome!, lines: [] });
      else refused.push({ id: ask.id, reason: words ? verdict.reason! : 'It said nothing of this meeting.' });
    }
    return { outcomes, refused };
  },

  /**
   * What a meeting does to belonging: each band above idle fills a day's fall of it, and each band
   * below takes one. The bands' own order gives the size. A guess until Wave 12; Pedro may overrule.
   */
  fillOf(band: JudgeBand): INeedFill {
    const steps = JUDGE_BANDS.indexOf(band) - JUDGE_BANDS.indexOf('idle');
    return steps === 0 ? {} : { belonging: steps * NpcAgenda.dailyFall('belonging') };
  },

  /** A meeting that sat badly took something from them; one that sat well took nothing. */
  isLoss(band: JudgeBand): boolean {
    return JUDGE_BANDS.indexOf(band) < JUDGE_BANDS.indexOf('idle');
  }
};
