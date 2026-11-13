/**
 * THE FIGHT'S RECORD, on screen (the UX pass, ux-fight). Opened on purpose: L, or its button beside the sheet's on
 * the field and on the receipt. It stands at the side so the field stays in view, scrolls, and copies as text.
 * Nothing of it is drawn on the field: Pedro kept numbers off the field ("might be not fluid enough in our animation
 * style"), so the field says a blow by its size and the figures live here.
 *
 * Given and taken are told apart by a word in their own column, never by hue (Pedro is colourblind).
 */

import React, { useEffect, useRef, useState } from 'react';
import { FightRecord, useFightRecord } from '../logic/systems/FightRecord';
import { isTypingTarget } from '../logic/systems/FieldInput';
import { Button, Kbd, Panel } from './ui/kit';

/** The record's key: L, for its lines. */
export const RECORD_KEY = 'l';

/** Opens and closes the record. On the field beside the sheet's button, and on the receipt. */
export const FightRecordButton: React.FC<{ style?: React.CSSProperties }> = ({ style }) => (
  <Button
    tone="quiet"
    style={{ padding: '1px 6px', whiteSpace: 'nowrap', ...style }}
    onClick={e => { (e.currentTarget as HTMLButtonElement).blur(); useFightRecord.getState().toggle(); }}
  >
    <Kbd>L</Kbd> RECORD
  </Button>
);

/** Mounted once wherever the game is: listens for L, and shows the record while it is open. */
export const FightRecordOverlay: React.FC = () => {
  const open = useFightRecord(s => s.open);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key.toLowerCase() === RECORD_KEY && !e.repeat) { useFightRecord.getState().toggle(); return; }
      if (e.key === 'Escape' && useFightRecord.getState().open) {
        e.preventDefault();
        e.stopImmediatePropagation();
        useFightRecord.getState().close();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);
  return open ? <RecordPanel /> : null;
};

const RecordPanel: React.FC = () => {
  const { title, beganAt, entries } = useFightRecord();
  const listRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState<'no' | 'yes' | 'refused'>('no');
  const atBottom = useRef(true);

  // Opened at the newest line; it follows new lines while the reader is at the bottom, and stays where they scrolled otherwise
  useEffect(() => {
    const list = listRef.current;
    if (list && atBottom.current) list.scrollTop = list.scrollHeight;
  }, [entries.length]);

  const copy = async () => {
    const text = FightRecord.text(useFightRecord.getState());
    try {
      if (!navigator.clipboard?.writeText) throw new Error('no clipboard');
      await navigator.clipboard.writeText(text);
      setCopied('yes');
    } catch {
      setCopied('refused');
    }
  };

  return (
    <div
      role="dialog"
      aria-label="The fight's record"
      onPointerDown={e => e.stopPropagation()}
      onClick={e => e.stopPropagation()}
      // Over everything, the receipt's cover (1000) included: it is opened on purpose, and the field stays in view beside it
      style={{ position: 'fixed', right: 16, top: 72, zIndex: 1010, width: 'min(620px, 48vw)', maxHeight: '64vh', display: 'flex', flexDirection: 'column' }}
    >
      <Panel
        title="THE FIGHT'S RECORD"
        right={<Button tone="quiet" onClick={() => useFightRecord.getState().close()} aria-label="Close"><Kbd>L</Kbd> CLOSE</Button>}
        style={{ display: 'flex', flexDirection: 'column', minHeight: 0, background: 'rgba(3,3,3,0.94)' }}
      >
        <div className="ws-small ws-dim" style={{ marginBottom: 6 }}>
          {title ? `${title}. ` : ''}Before armour: the blow as it was let go. After armour: what reached the body. A creature wears no armour.
        </div>
        <div
          data-fight-lines
          ref={listRef}
          onScroll={e => { const el = e.currentTarget; atBottom.current = el.scrollTop + el.clientHeight >= el.scrollHeight - 4; }}
          style={{ overflowY: 'auto', minHeight: 0, maxHeight: '44vh', fontFamily: 'monospace', userSelect: 'text', paddingRight: 4 }}
        >
          {entries.length === 0 && <div className="ws-dim">Nothing has been given or taken yet.</div>}
          {entries.map((e, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '5ch 6ch 1fr', columnGap: 8, padding: '1px 0' }}>
              <span className="ws-dim">{FightRecord.clock(e.at, beganAt)}</span>
              <b>{FightRecord.word(e)}</b>
              <span>{FightRecord.say(e)}</span>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
          <Button tone="signal" onClick={() => { void copy(); }}>COPY AS TEXT</Button>
          <span className="ws-small ws-dim">
            {copied === 'yes' ? `Copied: ${entries.length} line${entries.length === 1 ? '' : 's'}.`
              : copied === 'refused' ? 'This browser would not take it. Select the lines above and copy them with your keys.'
                : `${entries.length} line${entries.length === 1 ? '' : 's'}, kept until the next dive begins.`}
          </span>
        </div>
      </Panel>
    </div>
  );
};
