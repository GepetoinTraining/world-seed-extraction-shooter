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
 */

import React, { useState } from 'react';
import { DescriptionLaw, DescriptionRoot } from '../../shared/logic/systems/DescriptionLaw';
import { usePlayerStore } from '../entities/player/store';

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

/** A number on a sheet: its word and its value on one row; its description behind it. */
export const SheetLine: React.FC<{ word: string; value: React.ReactNode; says?: string | readonly (string | undefined | false | null)[]; root?: DescriptionRoot }> = ({ word, value, says, root }) => (
  <Described word={word} says={says} root={root} style={{ borderBottom: '1px solid var(--ws-void-3)' }}>
    <div className="ws-row" style={{ padding: '2px 0', gap: 8 }}>
      <span className="ws-dim ws-small" style={{ letterSpacing: '0.06em', flexShrink: 0 }}>{word}</span>
      <span className="ws-bright" style={{ textAlign: 'right', minWidth: 0 }}>{value}</span>
    </div>
  </Described>
);
