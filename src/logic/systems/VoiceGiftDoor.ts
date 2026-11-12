/**
 * THE FIRST ORDER'S ASK, CARRIED (TQ, call 8). The person's message goes to the voice through the one door, and what
 * comes back stands before `VoiceGift.judge`. An answer that does not stand is asked once more with why; still broken, or
 * no voice at all (no key and no model on this machine), and nothing is spent: the ask waits. A judged answer lands at
 * once, the ask is spent, and the character is saved.
 */

import type { ISkillGift } from '../../../shared/types';
import type { IPlayerPort } from '../../entities/player/playerView';
import { IntelligenceClient } from '../intelligence/IntelligenceClient';
import { PlayerPersistence } from '../persistence/PlayerPersistence';
import { IVoiceGiftWords, VoiceGift } from './VoiceGift';

/** One answer, and once more with why the first did not stand. */
const ASKS = 2;

export const VoiceGiftDoor = {
  async ask(text: string, pc: Pick<IPlayerPort, 'view' | 'apply'>, elements = VoiceGift.elementsOf()): Promise<{ ok: boolean; reason?: string; line?: string; gift?: ISkillGift }> {
    if (!VoiceGift.mayAsk(pc.view().player)) return { ok: false, reason: 'Your ask has been answered.' };
    const message = VoiceGift.message(text);
    if ('reason' in message) return { ok: false, reason: message.reason };
    let refused: string | undefined;
    for (let n = 0; n < ASKS; n++) {
      const ask = VoiceGift.askOf(pc.view().player, message.said, elements, refused);
      if (ask.skills.length === 0) return { ok: false, reason: 'You hold no skill for a gift to sit on yet. Your ask waits.' };
      const out = await IntelligenceClient.askGift<IVoiceGiftWords>(ask);
      if (out.status !== 'OK' || !out.data) return { ok: false, reason: `${out.reason ?? 'No voice answers on this machine now.'} Your ask waits.` };
      const verdict = VoiceGift.judge(out.data, ask);
      if (!verdict.ok) { refused = verdict.reason; continue; }
      // It may have been answered while this one was out
      const before = pc.view().player;
      if (!VoiceGift.mayAsk(before)) return { ok: false, reason: 'Your ask has been answered.' };
      const after = VoiceGift.give(before, out.data, message.said, Date.now());
      pc.apply({ kind: 'SET', player: after });
      void PlayerPersistence.flush('voice gift', pc.view().player);
      const gift = (after.skillGifts?.[out.data.skill] ?? []).find(g => g.id === after.firstOrder?.ask?.giftId);
      return { ok: true, line: after.firstOrder?.ask?.line, gift };
    }
    return { ok: false, reason: 'The answer could not stand. Your ask waits.' };
  }
};
