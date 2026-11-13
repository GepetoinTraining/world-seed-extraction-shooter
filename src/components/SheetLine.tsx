/**
 * A LINE ON A SHEET (UXS, 2026-11-12). Put to Pedro: "The sheet with numbers first and each sentence one step behind".
 * His answer: "yup, and hover click opens description, description opens only if the skill to describe it is found
 * UAHUAHUA".
 *
 * A line is its word and its number, and nothing more until it is opened. Its description, the sentence that stood under
 * it, opens while the pointer rests on it and stays under it after a click, until a second click (ENTER or SPACE from the
 * keys). It opens only for a character holding the skill that describes it (`DescriptionLaw`); without it, the place of the
 * description says, by a mark and words, that this is not known, and never which skill would open it. Nothing here is told
 * by colour: the mark is a shape, and an opened line keeps its place by position.
 *
 * A point, seen before it is spent (Pedro's "yup" to "+ first shows what the point would change, a second press spends"):
 * the first press on + (`PointPlus`) shows every number on the sheet the point would move, in a list under it
 * (`PreviewList`) and on each line where it stands (`Moved`), what it is and what it would be, with a mark by shape for
 * which way it goes. The second press spends. The focus leaving the + puts it away, and so does ESC.
 */

import React, { createContext, useContext, useState } from 'react';
import { DescriptionLaw, DescriptionRoot } from '../../shared/logic/systems/DescriptionLaw';
import { usePlayerStore } from '../entities/player/store';
import type { IMoved } from '../logic/systems/SheetNumbers';
import { Button } from './ui/kit';

/** Which way a number would go, by shape: up, down, or some of its numbers each way. */
export const WAY_MARK: Record<IMoved['way'], string> = { up: '▲', down: '▼', both: '◆' };
const WAY_WORD: Record<IMoved['way'], string> = { up: 'rises', down: 'falls', both: 'changes' };

/** What a point waiting on a + would move, by the key of each line; none while no + waits. */
export const PointPreview = createContext<ReadonlyMap<string, IMoved> | null>(null);

/** Where a line's number would go, beside it, while a + waits. */
export const Moved: React.FC<{ k?: string }> = ({ k }) => {
  const m = useContext(PointPreview)?.get(k ?? '');
  if (!m) return null;
  return (
    <span data-moved className="ws-signal" style={{ marginLeft: 6, whiteSpace: 'nowrap' }}>
      <span role="img" aria-label={WAY_WORD[m.way]}>{WAY_MARK[m.way]}</span> {m.then}
    </span>
  );
};

/** Every number a point would move, in one place under its +: what it is, and what it would be. */
export const PreviewList: React.FC<{ attr: string; moved: readonly IMoved[] }> = ({ attr, moved }) => (
  <div data-preview={attr} className="ws-small" style={{ border: '1px dashed var(--ws-void-4)', padding: '2px 6px', margin: '2px 0 4px' }}>
    <div className="ws-dim" style={{ letterSpacing: '0.06em' }}>IF YOU SPEND IT</div>
    {moved.map(m => (
      <div key={m.key} className="ws-row" style={{ padding: 0, gap: 8 }}>
        <span className="ws-dim" style={{ flexShrink: 0 }}>{m.word}</span>
        <span style={{ textAlign: 'right', minWidth: 0 }}>{m.now} <span role="img" aria-label={WAY_WORD[m.way]}>{WAY_MARK[m.way]}</span> {m.then}</span>
      </div>
    ))}
  </div>
);

/**
 * A + in two presses. The first shows what the point would move (the parent lists it); the second spends. The focus leaving
 * it, or ESC, puts it away and spends nothing. `aria-label` says what it spends, as the plain + did.
 */
export const PointPlus: React.FC<{ attr: string; 'aria-label': string; armed: boolean; onArm: () => void; onDisarm: () => void; onSpend: () => void }> = props => {
  const { attr, armed, onArm, onDisarm, onSpend } = props;
  const said = armed ? `${props['aria-label']}: press again to spend it` : props['aria-label'];
  return (
    <Button
      tone="signal" primary={armed} aria-pressed={armed} data-plus={attr} aria-label={said} title={said} style={{ padding: '0 4px' }}
      onClick={e => { e.stopPropagation(); if (armed) onSpend(); else onArm(); }}
      onBlur={() => { if (armed) onDisarm(); }}
      onKeyDown={e => { if (e.key === 'Escape' && armed) { e.stopPropagation(); onDisarm(); } }}
    >
      {armed ? 'SPEND' : '+'}
    </Button>
  );
};

/** What the place of a description says to someone who has not found the skill that describes it. */
export const NOT_KNOWN = 'Not yet known to you.';

/** A description, or its place: the sentences when they are known, else the mark and the words. */
export const Told: React.FC<{ known: boolean; says: readonly string[] }> = ({ known, says }) => known ? (
  <div data-told="known" className="ws-small" style={{ padding: '2px 0 4px', whiteSpace: 'normal' }}>
    {says.map((line, i) => <div key={i}>{line}</div>)}
  </div>
) : (
  <div data-told="unknown" className="ws-dim ws-small" style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 0 4px' }}>
    <span data-mark aria-hidden="true" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 12, height: 12, border: '1px dashed var(--ws-text-dim)', fontSize: 9, lineHeight: 1, flexShrink: 0 }}>?</span>
    <span>{NOT_KNOWN}</span>
  </div>
);

/** Whether this character's skills open a line's description. */
export const useKnown = (root: DescriptionRoot | undefined): boolean => {
  const skills = usePlayerStore(s => s.player.bank.universalSkills);
  return DescriptionLaw.opens(skills, root ?? DescriptionLaw.GAP);
};

/**
 * Anything on a sheet that has a description: a line, a bar, a skill. With nothing to say it is only what it holds.
 * `word` names it for the keys and the bars; `mark` adds a data attribute of its own (a skill's id, say).
 */
export const Described: React.FC<{
  word: string; says?: string | readonly (string | undefined | false | null)[]; root?: DescriptionRoot;
  mark?: Record<string, string>; style?: React.CSSProperties; children: React.ReactNode;
}> = ({ word, says, root, mark, style, children }) => {
  const [kept, setKept] = useState(false);
  const [peek, setPeek] = useState(false);
  const known = useKnown(root);
  const lines = (Array.isArray(says) ? says : [says]).filter((s): s is string => typeof s === 'string' && s.length > 0);
  if (lines.length === 0) return <div style={style} {...mark}>{children}</div>;
  const toggle = () => { setKept(k => !k); setPeek(false); };
  return (
    <div
      data-described={word} {...mark} role="button" tabIndex={0} aria-expanded={kept || peek}
      style={{ position: 'relative', cursor: 'help', ...style }}
      onClick={e => { if ((e.target as HTMLElement).closest('button')) return; toggle(); }}
      onKeyDown={e => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); toggle(); } }}
      onMouseEnter={() => setPeek(true)}
      onMouseLeave={() => setPeek(false)}
    >
      {children}
      {kept && <Told known={known} says={lines} />}
      {!kept && peek && (
        <div style={{ position: 'absolute', left: 0, right: 0, top: '100%', zIndex: 30, padding: '2px 6px', background: 'var(--ws-void-0)', border: '1px solid var(--ws-void-4)' }}>
          <Told known={known} says={lines} />
        </div>
      )}
    </div>
  );
};

/** A number on a sheet: its word and its value on one row; its description behind it. `k`: its key for a point's preview. */
export const SheetLine: React.FC<{ word: string; value: React.ReactNode; says?: string | readonly (string | undefined | false | null)[]; root?: DescriptionRoot; k?: string }> = ({ word, value, says, root, k }) => (
  <Described word={word} says={says} root={root} style={{ borderBottom: '1px solid var(--ws-void-3)' }}>
    <div className="ws-row" style={{ padding: '2px 0', gap: 8 }}>
      <span className="ws-dim ws-small" style={{ letterSpacing: '0.06em', flexShrink: 0 }}>{word}</span>
      <span className="ws-bright" style={{ textAlign: 'right', minWidth: 0 }}>{value}<Moved k={k} /></span>
    </div>
  </Described>
);
