/**
 * THE MINT'S CONVERSATION (D53, D56): talk with the Seed, see what it wrote, then sign.
 *
 * With no key or no network, nothing blocks: a person may pin a world already written,
 * and what they said stays in the draft. What comes back from the model stands before
 * the law here, and again when it is banked.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { IntelligenceClient, IDoorMessage, IDoorUsage } from '../logic/intelligence/IntelligenceClient';
import { ContentRegistry } from '../logic/theme/ContentRegistry';
import { IThemeBody } from '../logic/theme/ThemeTypes';
import { useWorldDraft } from './ui/stores';
import { Busy, Button, Panel } from './ui/kit';

const SAID_WHEN_CLOSED: Record<string, string> = {
  NO_KEY: 'The Seed is not answering on this server. No key is held here.',
  OFFLINE: 'The Seed cannot be reached from here.',
  BUSY: 'The Seed is occupied. It will answer later.',
  REFUSED: 'The Seed declines to write that.',
  OUTAGE: 'The Seed did not answer.',
  CUT_OFF: 'The Seed ran out of room before it finished.'
};

/** What a person sees of a written world before signing: its own words, and no numbers. */
export const ThemePreview: React.FC<{ theme: IThemeBody }> = ({ theme }) => (
  <div className="ws-small" style={{ marginTop: 6 }}>
    <div style={{ fontWeight: 700 }}>{theme.name}</div>
    <div className="ws-dim" style={{ marginBottom: 6 }}>{theme.premise}</div>
    <div>GROUND: {theme.regions.map(r => r.name).join(' · ')}</div>
    <div>WHAT LIVES THERE: {theme.creatures.length} kinds. They do not give their names.</div>
    <div>WHAT LIES THERE: {theme.materials.slice(0, 8).map(m => m.name).join(' · ')}{theme.materials.length > 8 ? ` and ${theme.materials.length - 8} more` : ''}</div>
    <div>WHAT IT KNOWS: {theme.abilities.slice(0, 6).map(a => a.name).join(' · ') || 'nothing yet'}</div>
    {theme.lore[0] && <div className="ws-dim" style={{ marginTop: 6, fontStyle: 'italic' }}>"{theme.lore[0]}"</div>}
  </div>
);

export const ThemeTalk: React.FC = () => {
  const { draft, set } = useWorldDraft();
  const messages = draft.talk as IDoorMessage[];
  const written = draft.writtenTheme as IThemeBody | null;
  const [open, setOpen] = useState<boolean | null>(null);
  const [closedWhy, setClosedWhy] = useState('');
  const [saying, setSaying] = useState('');
  const [busy, setBusy] = useState<'' | 'talk' | 'write'>('');
  const [refusal, setRefusal] = useState('');
  const logRef = useRef<HTMLDivElement>(null);
  const banked = useMemo(() => ContentRegistry.list(), []);

  useEffect(() => {
    let live = true;
    void IntelligenceClient.status().then(s => {
      if (!live) return;
      setOpen(s.available);
      setClosedWhy(s.available ? '' : 'The Seed is not answering on this server. You may pin a world already written.');
    });
    return () => { live = false; };
  }, []);

  useEffect(() => { logRef.current?.scrollTo?.(0, logRef.current.scrollHeight); }, [messages.length]);

  const shown = { worldName: draft.worldName, worldDescription: draft.worldDescription, difficulty: draft.difficulty };

  const say = async () => {
    const text = saying.trim();
    if (!text || busy) return;
    const next: IDoorMessage[] = [...messages, { role: 'user', content: text }];
    set({ talk: next });
    setSaying('');
    setBusy('talk');
    const out = await IntelligenceClient.talk(next, shown);
    setBusy('');
    if (out.status === 'OK' && out.text) set({ talk: [...next, { role: 'assistant', content: out.text }] });
    else {
      setOpen(out.status !== 'NO_KEY' && out.status !== 'OFFLINE' ? open : false);
      setClosedWhy(SAID_WHEN_CLOSED[out.status] ?? out.reason ?? 'The Seed did not answer.');
    }
  };

  const seal = async () => {
    if (busy) return;
    setBusy('write');
    setRefusal('');
    const out = await IntelligenceClient.writeTheme<IThemeBody>(messages, shown);
    setBusy('');
    if (out.status !== 'OK' || !out.data) {
      setRefusal(SAID_WHEN_CLOSED[out.status] ?? out.reason ?? 'The Seed did not answer.');
      return;
    }
    // The law judges what came back. A broken world is refused whole, and the talk stays.
    const verdict = ContentRegistry.judge(out.data);
    if (!verdict.ok) {
      setRefusal(`What it wrote did not pass: ${verdict.reason}`);
      return;
    }
    set({ writtenTheme: out.data, writtenUsage: out.usage ?? null, themeId: '' });
  };

  return (
    <Panel title="THE WORLD'S FACE">
      {open === null && <Busy label="ASKING" quietForMs={250} />}

      {open === false && closedWhy && <div className="ws-dim ws-small" style={{ marginBottom: 6 }}>{closedWhy}</div>}

      {open && (
        <>
          <div ref={logRef} style={{ maxHeight: 160, overflowY: 'auto', marginBottom: 6 }} aria-label="What was said">
            {messages.length === 0 && <div className="ws-dim ws-small">Tell the Seed what this world is. Everything in it will come from what is said here.</div>}
            {messages.map((m, i) => (
              <div key={i} className="ws-small" style={{ marginBottom: 4, paddingLeft: m.role === 'assistant' ? 0 : 12, borderLeft: m.role === 'assistant' ? 'none' : '2px solid currentColor' }}>
                {m.content}
              </div>
            ))}
            {busy === 'talk' && <Busy label="THE SEED IS CONSIDERING" />}
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              className="ws-input" style={{ flex: 1 }} value={saying} placeholder="Say something"
              aria-label="Say something to the Seed" onChange={e => setSaying(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); void say(); } }}
            />
            <Button tone="quiet" disabled={!saying.trim() || !!busy} onClick={() => void say()}>SAY</Button>
            <Button tone="signal" disabled={!!busy || (messages.length === 0 && !draft.worldDescription)} onClick={() => void seal()}>
              {busy === 'write' ? 'WRITING…' : 'WRITE IT'}
            </Button>
          </div>
        </>
      )}

      {busy === 'write' && <div style={{ marginTop: 6 }}><Busy label="THE SEED IS WRITING" /></div>}
      {refusal && <div className="ws-loss ws-small" style={{ marginTop: 6 }}>{refusal}</div>}

      {written && (
        <div style={{ marginTop: 8, borderTop: '1px solid currentColor', paddingTop: 6 }}>
          <div className="ws-small">WRITTEN FOR THIS WORLD</div>
          <ThemePreview theme={written} />
          <div style={{ marginTop: 6 }}>
            <Button tone="quiet" onClick={() => set({ writtenTheme: null, writtenUsage: null })}>DISCARD IT</Button>
          </div>
        </div>
      )}

      {!written && banked.length > 0 && (
        <div className="ws-field" style={{ marginTop: 8 }}>
          <label>
            OR A WORLD ALREADY WRITTEN
            <select
              className="ws-input" value={draft.themeId || banked[0].themeId}
              onChange={e => set({ themeId: e.target.value })}
            >
              {banked.map(t => <option key={t.themeId} value={t.themeId}>{t.name}</option>)}
            </select>
          </label>
          <ThemePreview theme={banked.find(t => t.themeId === draft.themeId) ?? banked[0]} />
        </div>
      )}
    </Panel>
  );
};

export type { IDoorUsage };
