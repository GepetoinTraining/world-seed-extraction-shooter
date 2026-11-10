/**
 * CREDITS (Pedro, 2026-11-10: "the full list of models that touched this"). Drawn from `src/logic/credits/credits.json`, which is
 * the record: this screen adds no name of its own.
 */
import React from 'react';
import { Panel } from './ui/kit';
import { CREDITS, ICreditEntry } from '../logic/credits/Credits';

const Entry: React.FC<{ entry: ICreditEntry; dated?: boolean }> = ({ entry, dated }) => (
  <div style={{ padding: '5px 0', borderBottom: '1px dashed var(--ws-void-3)' }}>
    <div>
      <span className="ws-bright">{entry.name}</span>
      <span className="ws-dim ws-small"> · {entry.maker}{dated && entry.when ? ` · from ${entry.when}` : ''}</span>
    </div>
    <div className="ws-small">{entry.did}</div>
    <div className="ws-small ws-dim">On record: {entry.record}</div>
  </div>
);

const Group: React.FC<{ title: string; entries: ICreditEntry[]; dated?: boolean }> = ({ title, entries, dated }) => (
  <>
    <div className="ws-bright" style={{ marginTop: 14, letterSpacing: '0.12em' }}>{title}</div>
    {entries.map(e => <Entry key={`${title}:${e.name}`} entry={e} dated={dated} />)}
  </>
);

export const CreditsPanel: React.FC<{ style?: React.CSSProperties }> = ({ style }) => (
  <Panel title="CREDITS" right={<span className="ws-dim ws-small">AS THE RECORD SHOWS IT</span>} style={{ whiteSpace: 'normal', ...style }}>
    <div className="ws-bright" style={{ letterSpacing: '0.12em' }}>MADE BY</div>
    {CREDITS.people.map(p => (
      <div key={p.name} style={{ padding: '5px 0', borderBottom: '1px dashed var(--ws-void-3)' }}>
        <div className="ws-bright">{p.name}</div>
        <div className="ws-small">{p.did}</div>
      </div>
    ))}
    <Group title="BUILT WITH, OLDEST FIRST" entries={CREDITS.built} dated />
    <Group title="THE GAME SPEAKS THROUGH" entries={CREDITS.voices} />
    <Group title="IT SPOKE THROUGH BEFORE" entries={CREDITS.earlier} />
    <div className="ws-small ws-dim" style={{ marginTop: 10 }}>{CREDITS.about}</div>
  </Panel>
);
