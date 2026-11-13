/**
 * THE KIT (Wave 9.1, D4): DOM dressed in atom-built frames. Every player-facing
 * screen is assembled from these pieces; sprites are drawn by the same atoms as
 * the world, through the terminal's own cold palette. Everything interactive is
 * a native control, so the keyboard reaches all of it.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { IWorldCycle, WorldClock } from '../../entities/world/WorldClock';
import { SWEEP_CELLS, SWEEP_STEP_MS, WaitClock } from '../../logic/systems/WaitClock';
import { Sprite, buildPalette, grayscale as grayPalette, rankMark, seal } from '../../../shared/render/atoms/atoms';
import { Archetype, portrait } from '../../../shared/render/atoms/people';
import { itemArtFor } from '../../render/atoms/items';
import { IItem } from '../../../shared/types';
import { Card, ICardUnknown, ItemComparison, cardText, firstLayer, secondLayer } from '../../render/atoms/inspect';
import { hoverProps } from './stores';
import { canSpeakNotes, cardId, holdCardKeys, noteTarget, speakNote, useCardKeys } from './cardKeys';
import { Transcribers } from '../../logic/systems/Transcriber';
import { TERMINAL_GENRE, cssVariables } from './tokens';
import './kit.css';
import { said } from '../../logic/systems/SheetWords';

// The one theme reaches the DOM here, once.
const STYLE_ID = 'ws-tokens';
if (typeof document !== 'undefined' && !document.getElementById(STYLE_ID)) {
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = cssVariables();
  document.head.appendChild(style);
}

export const TERMINAL_PALETTE = buildPalette(TERMINAL_GENRE);
export const TERMINAL_PALETTE_GRAY = grayPalette(TERMINAL_PALETTE);

// ---------------------------------------------------------------------------
// SPRITES IN THE DOM
// ---------------------------------------------------------------------------

export function spriteDataUrl(s: Sprite, palette: Uint8Array = TERMINAL_PALETTE): string {
  const c = document.createElement('canvas');
  c.width = s.w; c.height = s.h;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(s.w, s.h);
  for (let i = 0; i < s.data.length; i++) {
    const v = s.data[i], j = i * 4;
    if (!v) continue;
    img.data[j] = palette[v * 3]; img.data[j + 1] = palette[v * 3 + 1]; img.data[j + 2] = palette[v * 3 + 2]; img.data[j + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c.toDataURL();
}

export const SpriteView: React.FC<{
  sprite: Sprite; scale?: number; palette?: Uint8Array; title?: string; style?: React.CSSProperties; className?: string;
} & React.CanvasHTMLAttributes<HTMLCanvasElement>> = ({ sprite, scale = 2, palette = TERMINAL_PALETTE, title, style, className, ...rest }) => {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const img = ctx.createImageData(sprite.w, sprite.h);
    for (let i = 0; i < sprite.data.length; i++) {
      const v = sprite.data[i], j = i * 4;
      if (!v) continue;
      img.data[j] = palette[v * 3]; img.data[j + 1] = palette[v * 3 + 1]; img.data[j + 2] = palette[v * 3 + 2]; img.data[j + 3] = 255;
    }
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.putImageData(img, 0, 0);
  }, [sprite, palette]);
  return (
    <canvas
      ref={ref} width={sprite.w} height={sprite.h} title={title} className={className} {...rest}
      style={{ width: sprite.w * scale, height: sprite.h * scale, imageRendering: 'pixelated', flexShrink: 0, ...style }}
    />
  );
};

/** Every item drawn anywhere answers the pointer with its card (line 73). Only a piece already in the hands opts out. */
export const ItemSprite: React.FC<{ item: IItem; cellPx?: number; title?: string; style?: React.CSSProperties; noHover?: boolean }> =
  ({ item, cellPx = 36, title, style, noHover }) => {
    const sprite = useMemo(() => itemArtFor(item), [
      item.id, item.isIdentified, item.stats?.durability, item.dimensions?.width, item.dimensions?.height
    ]);
    // ITEM_CELL(18) atoms per cell minus the shared 2-atom seam → scale to cellPx
    const scale = cellPx / 18;
    return <SpriteView sprite={sprite} scale={scale} title={title} style={style} {...(noHover ? {} : hoverProps(item))} />;
  };

export const PortraitView: React.FC<{ uid: string; archetype: Archetype; scale?: number }> = ({ uid, archetype, scale = 2 }) => {
  const sprite = useMemo(() => portrait({ uid, archetype }), [uid, archetype]);
  return <SpriteView sprite={sprite} scale={scale} />;
};

export const RankMark: React.FC<{ rank: string; scale?: number; title?: string }> = ({ rank, scale = 3, title }) => {
  const sprite = useMemo(() => rankMark(rank), [rank]);
  return <SpriteView sprite={sprite} scale={scale} title={title ?? `Rank ${rank}`} />;
};

export const SealView: React.FC<{ hash: string; scale?: number }> = ({ hash, scale = 3 }) => {
  const sprite = useMemo(() => seal(hash), [hash]);
  return <SpriteView sprite={sprite} scale={scale} title={`Seal ${hash.slice(0, 12)}`} />;
};

// ---------------------------------------------------------------------------
// FRAMES AND CONTROLS
// ---------------------------------------------------------------------------

type Tone = 'signal' | 'proof' | 'loss' | 'none';

export const Panel: React.FC<{
  title?: React.ReactNode; right?: React.ReactNode; tone?: Tone;
  style?: React.CSSProperties; className?: string; children?: React.ReactNode;
}> = ({ title, right, tone = 'none', style, className, children }) => (
  <section className={`ws-ui ws-panel${tone !== 'none' ? ` ws-panel--${tone}` : ''}${className ? ` ${className}` : ''}`} style={style}>
    {(title || right) && <header className="ws-panel__title"><b>{title}</b>{right && <span>{right}</span>}</header>}
    {children}
  </section>
);

export const Button: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement> & { tone?: Tone | 'quiet'; primary?: boolean }> =
  ({ tone = 'none', primary, className, children, type, ...rest }) => (
    <button
      type={type ?? 'button'}
      className={`ws-ui ws-btn${tone !== 'none' ? ` ws-btn--${tone}` : ''}${primary ? ' ws-btn--primary' : ''}${className ? ` ${className}` : ''}`}
      {...rest}
    >
      {children}
    </button>
  );

/**
 * A deliberate step (U14): the first press arms it and changes its shape, the
 * second acts. Leaving it, Escape, or a few seconds' pause disarm it.
 */
export const ArmedButton: React.FC<{
  onConfirm: () => void; confirmLabel: React.ReactNode; tone?: Tone | 'quiet'; title?: string; disabled?: boolean; children?: React.ReactNode;
}> = ({ onConfirm, confirmLabel, tone = 'proof', title, disabled, children }) => {
  const [armed, setArmed] = React.useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return (
    <Button
      tone={tone} title={title} disabled={disabled} primary={armed}
      aria-pressed={armed}
      onClick={() => {
        window.clearTimeout(timer.current);
        if (armed) { setArmed(false); onConfirm(); return; }
        setArmed(true);
        timer.current = window.setTimeout(() => setArmed(false), ARMED_MS);
      }}
      onBlur={() => setArmed(false)}
      onKeyDown={e => { if (e.key === 'Escape' && armed) { e.stopPropagation(); setArmed(false); } }}
    >
      {armed ? confirmLabel : children}
    </Button>
  );
};
const ARMED_MS = 4000;

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement> & { label?: string }>(
  ({ label, className, ...rest }, ref) => {
    const input = <input ref={ref} className={`ws-ui ws-input${className ? ` ${className}` : ''}`} {...rest} />;
    if (!label) return input;
    return <div className="ws-ui ws-field"><label>{label}{input}</label></div>;
  }
);
Input.displayName = 'Input';

export function Tabs<T extends string>({ tabs, active, onChange }: {
  tabs: { id: T; label: string }[]; active: T; onChange: (id: T) => void;
}) {
  return (
    <div className="ws-ui ws-tabs" role="tablist">
      {tabs.map(t => (
        <button
          key={t.id} role="tab" aria-selected={t.id === active} className="ws-tab"
          onClick={() => onChange(t.id)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

/** A stepped meter: the fill is quantized to twentieths — read, not eased. */
export const Bar: React.FC<{ label?: string; value: number; max: number; tone?: Exclude<Tone, 'none'>; text?: string }> =
  ({ label, value, max, tone = 'signal', text }) => {
    const ratio = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
    const stepped = Math.round(ratio * 20) * 5; // percent, in 5% steps
    return (
      <div className="ws-ui ws-bar">
        {label && <span className="ws-bar__label">{label}</span>}
        <span className="ws-bar__track" role="meter" aria-valuemin={0} aria-valuemax={max} aria-valuenow={Math.round(value)} aria-label={label}>
          <span className={`ws-bar__fill ws-bar__fill--${tone}`} style={{ width: `${stepped}%` }} />
          <span className="ws-bar__ticks" />
        </span>
        <span className="ws-bar__value">{text ?? `${Math.ceil(value)}/${said(max)}`}</span>
      </div>
    );
  };

/** A clock for one component, ticking only as often as it has something new to show. */
export function useNow(everyMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    const interval = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(interval);
  }, [everyMs]);
  return now;
}

const prefersStillness = () =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** A wait with a known end: the same stepped Bar, filling toward it, saying the time left. */
export const TimerBar: React.FC<{ label?: string; startedAt: number; until: number; tone?: Exclude<Tone, 'none'> }> =
  ({ label, startedAt, until, tone = 'signal' }) => {
    const now = useNow(WaitClock.tickMs(startedAt, until));
    const { leftMs } = WaitClock.read(startedAt, until, now);
    return <Bar label={label} value={Math.min(now, until) - startedAt} max={until - startedAt} tone={tone} text={WorldClock.say(leftMs)} />;
  };

/**
 * A wait nobody can put an end on: a block walking the same track, and how long it has
 * been. A block is not a fill, so the two read apart in grayscale. Reduced motion holds
 * the block still, and the count still moves, so it still doesn't read as frozen.
 */
export const Busy: React.FC<{ label?: string; startedAt?: number; quietForMs?: number; tone?: Exclude<Tone, 'none'> }> =
  ({ label, startedAt, quietForMs = 0, tone = 'signal' }) => {
    const [since] = useState(() => startedAt ?? Date.now());
    const now = useNow(SWEEP_STEP_MS);
    const elapsed = Math.max(0, now - since);
    if (elapsed < quietForMs) return null;
    const cell = prefersStillness() ? 0 : WaitClock.sweepAt(elapsed);
    return (
      <div className="ws-ui ws-bar" role="status" aria-label={label}>
        {label && <span className="ws-bar__label">{label}</span>}
        <span className="ws-bar__track">
          <span className={`ws-busy__block ws-busy__block--${tone}`} style={{ left: `${(cell * 100) / SWEEP_CELLS}%`, width: `${100 / SWEEP_CELLS}%` }} />
          <span className="ws-bar__ticks" />
        </span>
        <span className="ws-bar__value">{WorldClock.say(Math.floor(elapsed / 1000) * 1000)}</span>
      </div>
    );
  };

/** A world's whole cycle: its bands differ by grain and a hard seam, and a notch marks where it stands. */
export const CycleRibbon: React.FC<{ cycle: IWorldCycle }> = ({ cycle }) => (
  <div className="ws-ui ws-ribbon" role="img" aria-label={`Gate cycle, ${Math.round(cycle.at * 100)} percent through`}>
    {cycle.bands.map(band => <span key={band.phase} className={`ws-ribbon__band ws-ribbon__band--${band.phase}`} style={{ flexGrow: band.share }} />)}
    <span className="ws-ribbon__at" style={{ left: `${Math.round(cycle.at * 100)}%` }} />
  </div>
);

export const Chip: React.FC<{ tone?: Tone; title?: string; children?: React.ReactNode; style?: React.CSSProperties }> =
  ({ tone = 'none', title, children, style }) => (
    <span className={`ws-ui ws-chip${tone !== 'none' ? ` ws-chip--${tone}` : ''}`} title={title} style={style}>{children}</span>
  );

export const Kbd: React.FC<{ children?: React.ReactNode }> = ({ children }) => <kbd className="ws-ui ws-kbd">{children}</kbd>;

export const Row: React.FC<{ title: React.ReactNode; sub?: React.ReactNode; right?: React.ReactNode; left?: React.ReactNode }> =
  ({ title, sub, right, left }) => (
    <div className="ws-ui ws-row">
      {left}
      <div className="ws-row__main">
        <div className="t">{title}</div>
        {sub && <div className="s">{sub}</div>}
      </div>
      {right}
    </div>
  );

/** UXC, part 3: the rows that are the player's own words, set in their own shape (slanted), as well as by place and word. */
const MINE = new Set(['Your note', 'You guessed']);

const CardLine: React.FC<{ line: [string, string] }> = ({ line: [k, v] }) => (
  <div className={`ws-card__row${MINE.has(k) ? ' ws-card__mine' : ''}`}><span className="k">{k}</span><span className="v">{v}</span></div>
);

/**
 * UXC, part 3 (Pedro: "button + voice"): a button for each unknown on the card, and the key N on the one it would take.
 * Where nothing can hear (no recognizer in this browser, or the game's speaker not up), the button says so and waits.
 */
const NoteControls: React.FC<{ unknowns: ICardUnknown[] }> = ({ unknowns }) => {
  const underway = useCardKeys(s => s.note);
  const ready = Transcribers.current().ready();
  const reason = 'reason' in ready ? ready.reason : !canSpeakNotes() ? 'Notes are heard in the game itself.' : null;
  const target = noteTarget(unknowns);
  return (
    <div className="ws-card__notes">
      {unknowns.map(u => {
        const mine = underway?.key === u.key;
        const label = reason ?? (mine ? (underway!.phase === 'listening' ? 'LISTENING. SPEAK NOW' : 'WRITING YOUR NOTE')
          : `${u.noted ? 'SPEAK AGAIN' : 'SPEAK A NOTE'}${unknowns.length > 1 ? ` ON ${u.about.toUpperCase()}` : ''}`);
        return (
          <Button key={u.key} tone="quiet" disabled={!!reason || !!underway} aria-busy={mine} onClick={() => speakNote(u)}>
            {label}{!reason && !underway && u === target ? <> <Kbd>N</Kbd></> : null}
          </Button>
        );
      })}
    </div>
  );
};

/**
 * The one inspect card, rendered. Data comes from render/atoms/inspect. UXC, part 1 (Pedro: "yup"): the first layer
 * always; while ALT is held, a rule line and the second layer beneath it, so no row of the first ever moves. The corner
 * names the key whenever there is something beneath. Every card up answers CTRL+C (`cardKeys`).
 */
export const CardView: React.FC<{ card: Card; right?: React.ReactNode; children?: React.ReactNode }> = ({ card, right, children }) => {
  const deep = useCardKeys(s => s.deep);
  const id = useMemo(cardId, []);
  const text = cardText(card);
  const unknownKey = (card.unknowns ?? []).map(u => `${u.key}:${u.noted ? 1 : 0}`).join('|');
  useEffect(() => holdCardKeys(), []);
  useEffect(() => { useCardKeys.getState().raise({ id, text, unknowns: card.unknowns }); }, [id, text, unknownKey]);
  useEffect(() => () => useCardKeys.getState().drop(id), [id]);
  const first = firstLayer(card);
  const second = secondLayer(card);
  return (
    <div className="ws-ui ws-card">
      <div className="ws-card__title">
        <span>{card.title}</span>
        {(second.length > 0 || right) && (
          <span className="ws-card__corner">
            {second.length > 0 && <span className="ws-card__key"><Kbd>ALT</Kbd> {deep ? 'held' : 'more'}</span>}
            {right}
          </span>
        )}
      </div>
      {first.map((line, i) => <CardLine key={`a${i}`} line={line} />)}
      {deep && second.length > 0 && (
        <>
          <div className="ws-card__more" role="separator"><span>MORE</span><span><Kbd>CTRL+C</Kbd> copies this card</span></div>
          {second.map((line, i) => <CardLine key={`b${i}`} line={line} />)}
        </>
      )}
      {card.needs.map((n, i) => <div key={i} className="ws-card__need">{n}</div>)}
      {card.canAct && card.needs.length === 0 && <div className="ws-card__ready">Ready</div>}
      {(card.unknowns?.length ?? 0) > 0 && <NoteControls unknowns={card.unknowns!} />}
      {children}
    </div>
  );
};

/** The comparison reads by column and by mark. Up and down are shapes; no hue says better. */
export const CompareView: React.FC<{ compare: ItemComparison }> = ({ compare }) => (
  <div className="ws-card__compare">
    {!compare.against && <div className="ws-dim">{compare.slot.replace('_', ' ')} holds nothing.</div>}
    {compare.against && compare.result && (
      <>
        <div className="ws-card__against">AGAINST {compare.against.isIdentified === false ? 'UNIDENTIFIED SIGNAL' : compare.against.name.toUpperCase()}</div>
        {compare.result.rows.length === 0 && <div className="ws-dim">Nothing on the sheet to set against it.</div>}
        {compare.result.rows.map(r => (
          <div key={r.stat} className="ws-card__cmp">
            <span className="k">{r.stat}</span>
            <span className="n">{r.here}</span>
            <span className="n ws-dim">{r.there}</span>
            <span className="n">{r.mark} {r.mark === '=' ? '' : r.delta}</span>
          </div>
        ))}
        {(compare.result.blind.here > 0 || compare.result.blind.there > 0) && (
          <div className="ws-dim">The sheet can't see {compare.result.blind.here + compare.result.blind.there} unstudied. Neither side counts them.</div>
        )}
      </>
    )}
  </div>
);

export const Overlay: React.FC<{ onClose?: () => void; children?: React.ReactNode; labelledBy?: string }> = ({ onClose, children }) => (
  <div
    className="ws-ui ws-overlay"
    onClick={e => { if (e.target === e.currentTarget) onClose?.(); }}
    onKeyDown={e => { if (e.key === 'Escape') onClose?.(); }}
  >
    {children}
  </div>
);

/** `heavy`: a flow with work in it. A stray click on the backdrop does nothing at all. */
export const Modal: React.FC<{ title?: React.ReactNode; onClose: () => void; children?: React.ReactNode; width?: number; heavy?: boolean }> =
  ({ title, onClose, children, width, heavy }) => {
    useEffect(() => {
      const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
      window.addEventListener('keydown', onKey);
      return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);
    return (
      <Overlay onClose={heavy ? undefined : onClose}>
        <Panel
          title={title}
          right={<Button tone="quiet" onClick={onClose} aria-label="Close">CLOSE [ESC]</Button>}
          className="ws-modal"
          style={width ? { width } : undefined}
        >
          {children}
        </Panel>
      </Overlay>
    );
  };
