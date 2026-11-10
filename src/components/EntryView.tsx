/**
 * THE ENTRY VIEW (Pedro, 2026-11-10: "before I play, let's set up an entry point view"). What a person
 * meets first, before any character: choose a character, online (not finished), configuration,
 * accessibility, API keys, credits.
 *
 * Choosing a character goes on to the gate that was already there (IdentityGate: pick, make, restore).
 * Everything else opens beside the list and changes nothing about a character or a world. Each row has a
 * number, which is also its key, so the list reads and works without colour and without a mouse.
 */
import React, { useEffect, useState } from 'react';
import { Button, Kbd } from './ui/kit';
import { isTypingTarget } from '../logic/systems/FieldInput';
import { AccessibilityPanel, ConfigurationPanel } from './SettingsPanels';
import { KeysPanel } from './KeysPanel';
import { OnlinePanel } from './OnlinePanel';
import { CreditsPanel } from './CreditsPanel';

export type EntryId = 'play' | 'online' | 'configuration' | 'accessibility' | 'keys' | 'credits';

export const ENTRY_ITEMS: { id: EntryId; label: string; note?: string; says: string }[] = [
  { id: 'play', label: 'CHOOSE CHARACTER', says: 'Pick one of yours, make a new one, or restore a backup.' },
  { id: 'online', label: 'ONLINE', note: '(WORK IN PROGRESS)', says: 'Where playing with others stands.' },
  { id: 'configuration', label: 'CONFIGURATION', says: 'Volume.' },
  { id: 'accessibility', label: 'ACCESSIBILITY', says: 'Text size and colour vision.' },
  { id: 'keys', label: 'API KEYS', says: 'Add a key for a provider: dry run, test, accept.' },
  { id: 'credits', label: 'CREDITS', says: 'Who and what made this.' }
];

export const EntryView: React.FC<{ onPlay: () => void }> = ({ onPlay }) => {
  const [open, setOpen] = useState<Exclude<EntryId, 'play'> | null>(null);

  const choose = (id: EntryId) => {
    if (id === 'play') onPlay();
    else setOpen(current => (current === id ? null : id));
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'Escape') { setOpen(null); return; }
      const item = ENTRY_ITEMS[Number(e.key) - 1];
      if (item) { e.preventDefault(); choose(item.id); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <div className="ws-ui" style={{ minHeight: '100vh', background: 'var(--ws-void-1)', display: 'flex', justifyContent: 'center', padding: '6vh 16px 24px', boxSizing: 'border-box' }}>
      <div style={{ width: '100%', maxWidth: 1080, display: 'flex', gap: 24, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <nav aria-label="Entry" style={{ flex: '0 0 27em', maxWidth: '100%' }}>
          <div className="ws-proof" style={{ fontSize: 'var(--ws-font-display)', letterSpacing: '0.18em', lineHeight: 1.1 }}>WORLD SEED</div>
          <div className="ws-dim" style={{ letterSpacing: '0.4em', marginBottom: 18 }}>GENESIS</div>

          {ENTRY_ITEMS.map((item, i) => {
            const shown = open === item.id;
            return (
              <Button
                key={item.id}
                tone={item.id === 'play' ? 'signal' : 'quiet'}
                primary={item.id === 'play'}
                autoFocus={i === 0}
                aria-current={shown ? 'true' : undefined}
                aria-expanded={item.id === 'play' ? undefined : shown}
                onClick={() => choose(item.id)}
                style={{ display: 'block', width: '100%', textAlign: 'left', whiteSpace: 'normal', height: 'auto', padding: '8px 10px', marginTop: 6, ...(shown ? { borderLeft: '3px solid currentColor' } : {}) }}
              >
                <Kbd>{i + 1}</Kbd>{' '}
                <span className={shown || item.id === 'play' ? 'ws-bright' : undefined}>{shown ? '► ' : ''}{item.label}{item.note ? ` ${item.note}` : ''}</span>
                <span className="ws-small ws-dim" style={{ display: 'block', marginTop: 2, textTransform: 'none', letterSpacing: 0 }}>{item.says}</span>
              </Button>
            );
          })}

          <div className="ws-small ws-dim" style={{ marginTop: 14 }}>
            Press a number, or move with <Kbd>TAB</Kbd> and <Kbd>ENTER</Kbd>. <Kbd>ESC</Kbd> closes what is open.
          </div>
        </nav>

        <main style={{ flex: '1 1 34em', minWidth: 0 }}>
          {open === 'online' && <OnlinePanel />}
          {open === 'configuration' && <ConfigurationPanel />}
          {open === 'accessibility' && <AccessibilityPanel />}
          {open === 'keys' && <KeysPanel />}
          {open === 'credits' && <CreditsPanel />}
          {!open && (
            <div className="ws-small ws-dim" style={{ marginTop: '6.5em' }}>
              What is set here is kept on this device, and changes nothing about a character or a world.
            </div>
          )}
        </main>
      </div>
    </div>
  );
};
