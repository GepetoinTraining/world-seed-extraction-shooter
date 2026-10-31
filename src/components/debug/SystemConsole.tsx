/**
 * THE CONSOLE (kept in-world): the machine talking to itself. Slides up on `~`.
 * ("NerveGear" belonged to someone else's book — the terminal is the Seed's.)
 */

import React, { useEffect, useRef, useState } from 'react';
import { useLogStore } from './LogStore';
import { Button, Input } from '../ui/kit';

const LEVEL_CLASS: Record<string, string> = {
  info: 'ws-signal',
  warn: 'ws-proof',
  error: 'ws-loss',
  debug: 'ws-dim'
};

export const SystemConsole: React.FC = () => {
  const { logs, isOpen, toggle, clear } = useLogStore();
  const [filter, setFilter] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === '`' || e.key === '~') {
        e.preventDefault();
        toggle();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [toggle]);

  if (!isOpen) return null;

  const filteredLogs = logs.filter(l =>
    l.message.toLowerCase().includes(filter.toLowerCase()) ||
    l.tag.toLowerCase().includes(filter.toLowerCase())
  );

  return (
    <div
      className="ws-ui"
      style={{
        position: 'fixed', bottom: 0, left: 0, right: 0, height: '40vh', zIndex: 9999,
        borderTop: '2px solid var(--ws-signal-2)',
        background: 'rgba(3, 3, 3, 0.95)',
        display: 'flex', flexDirection: 'column'
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 10px', background: 'var(--ws-void-1)', borderBottom: '1px solid var(--ws-void-4)' }}>
        <b className="ws-signal" style={{ letterSpacing: '0.15em' }}>SEED CONSOLE</b>
        <span className="ws-dim ws-small">{logs.length} events — the machine talking to itself</span>
        <span style={{ flex: 1 }} />
        <Input placeholder="FILTER…" value={filter} onChange={e => setFilter(e.target.value)} style={{ width: 200 }} />
        <Button tone="quiet" onClick={clear} title="Clear the stream (the ledger keeps what matters)">CLEAR</Button>
        <Button tone="quiet" onClick={toggle} title="Close (~)">CLOSE</Button>
      </div>

      <div ref={scrollRef} style={{ flex: 1, overflow: 'auto', padding: '6px 10px' }}>
        {filteredLogs.map(log => (
          <div key={log.id} style={{ display: 'flex', gap: 10, alignItems: 'baseline' }} className="ws-small">
            <span className="ws-dim" style={{ minWidth: 62, fontFamily: 'var(--ws-mono)' }}>
              {new Date(log.timestamp).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
            <span className={LEVEL_CLASS[log.level] ?? 'ws-dim'} style={{ minWidth: 86, letterSpacing: '0.05em' }}>
              {log.tag}
            </span>
            <span style={{ wordBreak: 'break-all', color: log.level === 'error' ? 'var(--ws-loss-4)' : 'var(--ws-text-body)' }}>
              {log.message.replace(`[${log.tag}]`, '')}
            </span>
          </div>
        ))}
        {filteredLogs.length === 0 && (
          <div className="ws-dim ws-small" style={{ textAlign: 'center', marginTop: 14 }}>— NO SIGNALS DETECTED —</div>
        )}
      </div>
    </div>
  );
};
