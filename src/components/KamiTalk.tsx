/**
 * THE FIFTH CLASS'S CONVERSATION. Pedro: fate gambler "calls up a stream style conversation
 * with sonnet and you talk with kami itself, he'll set up the class."
 *
 * He speaks first, and his words arrive as they are written, in the same terminal as
 * everything else (D36). What was said lives in the draft, so a stray click costs nothing
 * and nobody pays for the same turn twice. Nothing waits on him (D35): a person can press on
 * while he is mid-sentence, and with no key or no answer fate deals what he would have set.
 */

import React, { useEffect, useRef, useState } from 'react';
import { CreationDoor } from '../logic/systems/CreationDoor';
import { CreationSystem } from '../logic/systems/CreationSystem';
import { IDoorMessage, IDoorUsage, IntelligenceClient } from '../logic/intelligence/IntelligenceClient';
import { useCreationDraft } from './ui/creationDraft';
import { Busy, Button } from './ui/kit';

const SAID_WHEN_CLOSED: Record<string, string> = {
  NO_KEY: 'Kami does not answer on this server. No key is held here. Fate does not need him.',
  OFFLINE: 'Kami cannot be reached from here. Fate does not need him.',
  BUSY: 'Kami is occupied. Say it again, or let it be thrown.',
  REFUSED: 'Kami declines to answer that. Say something else, or let it be thrown.',
  OUTAGE: 'Kami stopped speaking. Say it again, or let it be thrown.',
  CUT_OFF: 'Kami ran out of room. Say it again, or let it be thrown.'
};

const sumUsage = (a: IDoorUsage | null | undefined, b: IDoorUsage | null | undefined): IDoorUsage | null => {
  if (!a || !b) return a ?? b ?? null;
  return {
    model: b.model,
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    usd: a.usd + b.usd
  };
};

export const KamiTalk: React.FC = () => {
  const { draft, set } = useCreationDraft();
  const messages = draft.kami as IDoorMessage[];
  const [open, setOpen] = useState<boolean | null>(null);
  const [partial, setPartial] = useState('');
  const [speaking, setSpeaking] = useState(false);
  const [setting, setSetting] = useState(false);
  const [saying, setSaying] = useState('');
  const [note, setNote] = useState('');
  const talking = useRef<AbortController | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  const speak = async (history: IDoorMessage[]) => {
    const controller = new AbortController();
    talking.current = controller;
    setSpeaking(true);
    setPartial('');
    setNote('');
    let text = '';
    const out = await IntelligenceClient.talkKami(history, piece => {
      text += piece;
      if (!controller.signal.aborted) setPartial(text);
    }, controller.signal);
    if (controller.signal.aborted) return;
    setSpeaking(false);
    setPartial('');
    const spent = sumUsage(useCreationDraft.getState().draft.kamiUsage, out.usage);
    if (out.status === 'OK' && text) {
      set({ kami: [...history, { role: 'assistant', content: text }], kamiUsage: spent, grant: null });
      return;
    }
    set({ kamiUsage: spent });
    setNote(SAID_WHEN_CLOSED[out.status] ?? out.reason ?? 'Kami did not answer.');
    if (out.status === 'NO_KEY' || out.status === 'OFFLINE') setOpen(false);
  };

  // He speaks first. A conversation restored with a question unanswered picks up there.
  useEffect(() => {
    let live = true;
    void IntelligenceClient.status().then(s => {
      if (!live) return;
      setOpen(s.available);
      if (!s.available) { setNote(SAID_WHEN_CLOSED.NO_KEY); return; }
      const held = useCreationDraft.getState().draft.kami as IDoorMessage[];
      if (held.length === 0 || held[held.length - 1].role === 'user') void speak(held);
    });
    return () => {
      live = false;
      talking.current?.abort();
    };
  }, []);

  useEffect(() => { logRef.current?.scrollTo?.(0, logRef.current.scrollHeight); }, [messages.length, partial]);

  const say = () => {
    const text = saying.trim();
    if (!text || speaking || setting) return;
    const next: IDoorMessage[] = [...messages, { role: 'user', content: text }];
    set({ kami: next, grant: null });
    setSaying('');
    void speak(next);
  };

  /** Anything typed and not yet sent goes with it. Mid-sentence, he stops. */
  const settle = async () => {
    talking.current?.abort();
    setSpeaking(false);
    setPartial('');
    setSetting(true);
    const typed = saying.trim();
    const final: IDoorMessage[] = typed ? [...messages, { role: 'user', content: typed }] : messages;
    setSaying('');
    const out = await CreationDoor.seekKami(final);
    setSetting(false);
    // A person who stopped waiting has moved on, and what arrives late changes nothing
    if (useCreationDraft.getState().draft.step !== 3) return;
    const usage = sumUsage(useCreationDraft.getState().draft.kamiUsage, out.usage);
    set({ kami: final, kamiUsage: usage, grant: { words: out.words, by: out.by, usage }, step: 4 });
  };

  const stopWaiting = () => {
    setSetting(false);
    set({ grant: { words: CreationSystem.fateFloor(messages), by: 'FLOOR', usage: draft.kamiUsage }, step: 4 });
  };

  return (
    <div>
      <div ref={logRef} style={{ maxHeight: 280, overflowY: 'auto', marginBottom: 8 }} aria-label="What was said">
        {messages.map((m, i) => (m.role === 'assistant'
          ? <div key={i} className="ws-small" style={{ marginBottom: 6 }}>KAMI: {m.content}</div>
          : <div key={i} className="ws-small ws-bright" style={{ marginBottom: 6, paddingLeft: 12, borderLeft: '2px solid currentColor' }}>{m.content}</div>
        ))}
        {partial && <div className="ws-small" style={{ marginBottom: 6 }}>KAMI: {partial}</div>}
        {speaking && !partial && <Busy label="KAMI IS LOOKING AT YOU" />}
      </div>

      {note && <div className="ws-dim ws-small" style={{ marginBottom: 6 }}>{note}</div>}

      {setting ? (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <div style={{ flex: 1 }}><Busy label={open ? 'KAMI IS SETTING IT UP' : 'IT IS BEING THROWN'} /></div>
          <Button tone="quiet" onClick={stopWaiting}>DO NOT WAIT FOR HIM</Button>
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 6 }}>
          <input
            className="ws-input" style={{ flex: 1 }} value={saying} maxLength={500}
            placeholder={open === false ? 'Say what you stake, or nothing' : 'Say something'}
            aria-label="Say something to Kami" onChange={e => setSaying(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); say(); } }}
          />
          {open !== false && <Button tone="quiet" disabled={!saying.trim() || speaking || open === null} onClick={say}>SAY</Button>}
          <Button tone="signal" primary disabled={open === null} onClick={() => void settle()}>{open === false ? 'THROW IT' : 'LET HIM SET IT'}</Button>
        </div>
      )}
    </div>
  );
};
