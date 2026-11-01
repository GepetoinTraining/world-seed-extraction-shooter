/**
 * The talk, reaching out: the door, with the law standing behind it. Nothing waits on a model
 * (D35). A refusal, no key, no network, a broken answer or a door that never answers all come
 * back as the floor, and the round rolls anyway.
 */

import { IDoorUsage, IntelligenceClient } from '../intelligence/IntelligenceClient';
import { TalkLaw } from './TalkLaw';
import { IGoalAsk, IGoalWords, IRoundAsk, IRoundWords, JudgeBand } from './TalkTypes';

/** How long a person is kept waiting before the round goes on without an answer. */
export const ROUND_PATIENCE_MS = 10_000;

export interface IRoundAnswer {
  by: 'DOOR' | 'FLOOR';
  band: JudgeBand;
  gated?: boolean;
  reply: string;
  wants: string;
  usage?: IDoorUsage;
  /** Why it fell to the floor, in the door's words. */
  reason?: string;
  status?: string;
}

async function within<T extends { status: string; reason?: string; usage?: IDoorUsage; data?: unknown }>(asked: Promise<T>, patienceMs: number): Promise<T | { status: 'OUTAGE'; reason: string; data?: undefined; usage?: undefined }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<{ status: 'OUTAGE'; reason: string }>(resolve => { timer = setTimeout(() => resolve({ status: 'OUTAGE', reason: 'It took too long.' }), patienceMs); });
  try {
    return await Promise.race([asked, late]);
  } finally {
    clearTimeout(timer);
  }
}

const floorRound = (reason: string | undefined, status: string | undefined, usage?: IDoorUsage): IRoundAnswer =>
  ({ by: 'FLOOR', band: 'idle', reply: '', wants: '', reason, status, usage });

export const TalkDoor = {
  /** One round's words. A person goes to their kind, and a monster, which has a stance, to its own. */
  async round(talkId: string, ask: IRoundAsk, ctx: { alignment?: string; hidden: string[] }, patienceMs = ROUND_PATIENCE_MS): Promise<IRoundAnswer> {
    const asked = ask.stance ? IntelligenceClient.bargain<IRoundWords>(talkId, ask) : IntelligenceClient.npcTalk<IRoundWords>(talkId, ask);
    const out = await within(asked, patienceMs);
    if (out.status !== 'OK' || !out.data) return floorRound(out.reason, out.status, out.usage);
    const verdict = TalkLaw.judgeRound(out.data as IRoundWords, ctx);
    if (!verdict.ok) {
      console.warn(`[TALK] What came back was refused whole: ${verdict.reason}`);
      return floorRound(verdict.reason, 'REFUSED', out.usage);
    }
    return { by: 'DOOR', band: verdict.band!, gated: verdict.gated, reply: verdict.reply!, wants: verdict.wants ?? '', usage: out.usage };
  },

  /** D116: asked before the answer, and whatever it comes back as, a person ends up with a goal. */
  async goal(talkId: string, ask: IGoalAsk, patienceMs = ROUND_PATIENCE_MS): Promise<{ by: 'DOOR' | 'FLOOR'; words: IGoalWords; usage?: IDoorUsage; reason?: string }> {
    const out = await within(IntelligenceClient.npcGoal<IGoalWords>(talkId, ask), patienceMs);
    if (out.status !== 'OK' || !out.data) return { by: 'FLOOR', words: TalkLaw.floorGoal(ask), reason: out.reason ?? out.status, usage: out.usage };
    const verdict = TalkLaw.judgeGoal(out.data as IGoalWords, ask);
    if (!verdict.ok) {
      console.warn(`[TALK] A goal was refused whole: ${verdict.reason}`);
      return { by: 'FLOOR', words: TalkLaw.floorGoal(ask), reason: verdict.reason, usage: out.usage };
    }
    return { by: 'DOOR', words: verdict.words!, usage: out.usage };
  }
};
