/**
 * SET UP A MODEL HERE: the three ways (LocalSetup.ts), for a player whose machine has no model
 * answering this page yet. The prompt for their own coding agent is shown whole before it is
 * copied; a script is shown whole before it is saved, and runs only if the player starts it.
 * Meaning is carried by marks and words, never hue.
 */
import React, { useMemo, useState } from 'react';
import { Button } from './ui/kit';
import agents from '../../server/intelligence/agents.json';
import { SetupSystem, setupPrompt, systemOf, unixScript, windowsScript } from '../logic/intelligence/LocalSetup';

/** This game's own origin: configuration when built for a domain, else where the page is. */
const gameOrigin = () => (import.meta.env.VITE_WS_ORIGIN as string | undefined)?.replace(/\/+$/, '') || window.location.origin;

const SYSTEMS: { id: SetupSystem; label: string; file: string }[] = [
  { id: 'windows', label: 'WINDOWS', file: 'world-seed-local-model.ps1' },
  { id: 'macos', label: 'MACOS', file: 'world-seed-local-model.sh' },
  { id: 'linux', label: 'LINUX', file: 'world-seed-local-model.sh' }
];

const save = (file: string, text: string) => {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  const a = document.createElement('a');
  a.href = url; a.download = file; a.click();
  URL.revokeObjectURL(url);
};

export const LocalSetupPanel: React.FC<{ model: string }> = ({ model }) => {
  const [way, setWay] = useState<'agent' | 'script' | 'agents' | null>(null);
  const [system, setSystem] = useState<SetupSystem>(() => systemOf(navigator.userAgent));
  const [note, setNote] = useState('');
  const ask = useMemo(() => ({ origin: gameOrigin(), model }), [model]);

  let prompt = '';
  let script = '';
  try {
    prompt = setupPrompt(ask);
    script = system === 'windows' ? windowsScript(ask) : unixScript(ask);
  } catch (e) {
    return <div className="ws-small">! {(e as Error).message}</div>;
  }
  const chosen = SYSTEMS.find(s => s.id === system)!;

  return (
    <div style={{ marginTop: 10, borderTop: '1px dashed var(--ws-void-3)', paddingTop: 8 }}>
      <div className="ws-bright ws-small" style={{ letterSpacing: '0.08em' }}>SET UP A MODEL HERE</div>
      <div className="ws-small">Three ways, the same steps: install Ollama, download {model}, let only this page ({ask.origin}) reach it, restart it, then press TRY above.</div>
      <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
        <Button tone="quiet" aria-pressed={way === 'agent'} onClick={() => setWay(way === 'agent' ? null : 'agent')}>{way === 'agent' ? '▾' : '▸'} WITH MY CODING AGENT</Button>
        <Button tone="quiet" aria-pressed={way === 'script'} onClick={() => setWay(way === 'script' ? null : 'script')}>{way === 'script' ? '▾' : '▸'} WITH A SCRIPT</Button>
        <Button tone="quiet" aria-pressed={way === 'agents'} onClick={() => setWay(way === 'agents' ? null : 'agents')}>{way === 'agents' ? '▾' : '▸'} I HAVE NO AGENT</Button>
      </div>

      {way === 'agent' && (
        <>
          <div className="ws-dim ws-small" style={{ marginTop: 6 }}>This is everything your agent will be asked. Read it, then copy it into Claude Code, Codex, Goose, Cursor or any other.</div>
          <pre className="ws-small" style={{ whiteSpace: 'pre-wrap', maxHeight: 220, overflow: 'auto', border: '1px solid var(--ws-void-4)', padding: 6 }}>{prompt}</pre>
          <Button tone="signal" onClick={async () => {
            try { await navigator.clipboard.writeText(prompt); setNote('Copied. Paste it into your agent.'); } catch { setNote('This browser would not copy. Select the text above instead.'); }
          }}>COPY THE PROMPT</Button>
        </>
      )}

      {way === 'script' && (
        <>
          <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
            {SYSTEMS.map(s => <Button key={s.id} tone="quiet" aria-pressed={system === s.id} onClick={() => setSystem(s.id)}>{system === s.id ? '► ' : ''}{s.label}</Button>)}
          </div>
          <div className="ws-dim ws-small" style={{ marginTop: 6 }}>The whole script. Nothing runs until you start it yourself{system === 'windows' ? ', in PowerShell' : ', in a terminal'}.</div>
          <pre className="ws-small" style={{ whiteSpace: 'pre-wrap', maxHeight: 220, overflow: 'auto', border: '1px solid var(--ws-void-4)', padding: 6 }}>{script}</pre>
          <Button tone="signal" onClick={() => { save(chosen.file, script); setNote(`Saved as ${chosen.file}. Run it with the line at its top.`); }}>SAVE THE SCRIPT</Button>
        </>
      )}

      {way === 'agents' && (
        <div className="ws-list" style={{ marginTop: 6 }}>
          <div className="ws-dim ws-small">Free agents that can do it for you, read on their own pages on {agents.checked}. Terms change; check before you sign up for any.</div>
          {agents.agents.map(a => (
            <div key={a.id} style={{ padding: '3px 0' }}>
              <div className="ws-small"><span className="ws-bright">{a.name}</span> · {a.free}</div>
              <div className="ws-dim ws-small">Account: {a.account} · A local model: {a.local} · <a href={a.source} target="_blank" rel="noreferrer noopener">source ↗</a></div>
            </div>
          ))}
          <div className="ws-dim ws-small" style={{ marginTop: 4 }}>Or skip the local model: use your own key, under OR USE A KEY above. On Safari and on iPhone and iPad, a key is the only way, because those browsers do not let a page reach this machine.</div>
        </div>
      )}

      {note && <div className="ws-small" style={{ marginTop: 6 }}>! {note}</div>}
    </div>
  );
};
