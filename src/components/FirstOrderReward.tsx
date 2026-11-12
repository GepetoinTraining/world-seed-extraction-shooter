/**
 * THE FIRST ORDER'S REWARD, AT HOME (TQ, calls 7 and 8). Pedro: "once the 5 are done allow the player to place a free
 * point and ask the voice for a gift, they get a tweet, one short tweet, to get themselves a gift".
 *
 * Shown at home only, once the five are done, until the ask is answered: the free point waiting on the sheet, and a box
 * for one short message to the voice. With no voice answering, the box keeps the message and says so; nothing is spent.
 * Once answered, what the voice said and the gift stand here until the page is left.
 */

import React, { useState } from 'react';
import { ISkillGift } from '../../shared/types';
import { usePlayerStore, playerPort } from '../entities/player/store';
import { ASK_CHARACTERS, VoiceGift } from '../logic/systems/VoiceGift';
import { VoiceGiftDoor } from '../logic/systems/VoiceGiftDoor';
import { said } from '../logic/systems/SheetWords';
import { statWord } from '../logic/systems/StatWords';
import { SkillNames } from '../logic/systems/SkillNames';
import { Button, Panel } from './ui/kit';

/** What a gift is, in the sheet's words: a share as a share, a figure as a figure. */
const giftWords = (gift: ISkillGift): string => {
  if (gift.kind === 'passive') {
    const v = gift.value ?? 0;
    const shown = Math.abs(v) < 1 && !Number.isInteger(v) ? `${said(v * 100)}%` : said(v);
    return `${statWord(gift.stat ?? '')} +${shown}, always`;
  }
  return `${gift.effect ?? ''}, by ${gift.delivery ?? ''}`;
};

export const FirstOrderReward: React.FC = () => {
  const mayAsk = usePlayerStore(s => VoiceGift.mayAsk(s.player));
  const pointWaiting = usePlayerStore(s => (s.player.attributePoints ?? 0) > 0);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [note, setNote] = useState('');
  const [answer, setAnswer] = useState<{ line: string; gift?: ISkillGift; skill?: string } | null>(null);

  if (!mayAsk && !answer) return null;

  const send = async () => {
    setSending(true);
    setNote('');
    const out = await VoiceGiftDoor.ask(text, playerPort);
    setSending(false);
    if (!out.ok) { setNote(out.reason ?? 'Your ask waits.'); return; }
    const skill = usePlayerStore.getState().player.firstOrder?.ask?.skillId;
    setAnswer({ line: out.line ?? '', gift: out.gift, skill: skill ? SkillNames.nameOf(skill) : undefined });
  };

  return (
    <div style={{ padding: '8px 16px 0', maxWidth: 1100, margin: '0 auto', width: '100%', boxSizing: 'border-box' }}>
      <Panel title="FIRST ORDER DONE" tone="proof">
        {answer ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span>{answer.line}</span>
            {answer.gift && (
              <span className="ws-small">
                <b>{answer.gift.name}</b>{answer.skill ? `, on ${answer.skill}` : ''}: {giftWords(answer.gift)}. {answer.gift.blurb}
              </span>
            )}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {pointWaiting && <span className="ws-small">A free point waits: place it on any attribute from your sheet (TAB).</span>}
            <span className="ws-small">The voice will hear one ask of you, once. Say what you would have, in one short message.</span>
            <textarea
              className="ws-input" rows={3} maxLength={ASK_CHARACTERS}
              aria-label="Your ask of the voice"
              value={text}
              disabled={sending}
              onChange={e => setText(e.target.value)}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <span className="ws-dim ws-small">{text.length} of {ASK_CHARACTERS}</span>
              <Button tone="proof" primary disabled={sending || !text.trim()} onClick={() => void send()}>{sending ? 'THE VOICE IS READING' : 'SEND YOUR ASK'}</Button>
            </div>
            {note && <span className="ws-small ws-loss">{note}</span>}
          </div>
        )}
      </Panel>
    </div>
  );
};
