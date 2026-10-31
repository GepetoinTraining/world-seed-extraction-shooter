/**
 * THE KIT (Wave 9.1, D4): DOM dressed in atom-built frames. Every player-facing
 * screen is assembled from these pieces; sprites are drawn by the same atoms as
 * the world, through the terminal's own cold palette. Everything interactive is
 * a native control, so the keyboard reaches all of it.
 */

import React, { useEffect, useMemo, useRef } from 'react';
import { Sprite, buildPalette, grayscale as grayPalette, rankMark, seal } from '../../render/atoms/atoms';
import { Archetype, portrait } from '../../render/atoms/people';
import { itemArtFor } from '../../render/atoms/items';
import { IItem } from '../../../types';
import { Card } from '../../render/atoms/inspect';
import { TERMINAL_GENRE, cssVariables } from './tokens';
import './kit.css';

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
}> = ({ sprite, scale = 2, palette = TERMINAL_PALETTE, title, style, className }) => {
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
      ref={ref} width={sprite.w} height={sprite.h} title={title} className={className}
      style={{ width: sprite.w * scale, height: sprite.h * scale, imageRendering: 'pixelated', flexShrink: 0, ...style }}
    />
  );
};

export const ItemSprite: React.FC<{ item: IItem; cellPx?: number; title?: string; style?: React.CSSProperties }> =
  ({ item, cellPx = 36, title, style }) => {
    const sprite = useMemo(() => itemArtFor(item), [
      item.id, item.isIdentified, item.stats?.durability, item.dimensions?.width, item.dimensions?.height
    ]);
    // ITEM_CELL(18) atoms per cell minus the shared 2-atom seam → scale to cellPx
    const scale = cellPx / 18;
    return <SpriteView sprite={sprite} scale={scale} title={title} style={style} />;
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
        <span className="ws-bar__value">{text ?? `${Math.ceil(value)}/${max}`}</span>
      </div>
    );
  };

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

/** The one inspect card, rendered. Data comes from render/atoms/inspect. */
export const CardView: React.FC<{ card: Card; right?: React.ReactNode }> = ({ card, right }) => (
  <div className="ws-ui ws-card">
    <div className="ws-card__title"><span>{card.title}</span>{right}</div>
    {card.rows.map(([k, v], i) => (
      <div key={i} className="ws-card__row"><span className="k">{k}</span><span className="v">{v}</span></div>
    ))}
    {card.needs.map((n, i) => <div key={i} className="ws-card__need">{n}</div>)}
    {card.canAct && card.needs.length === 0 && <div className="ws-card__ready">Ready</div>}
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

export const Modal: React.FC<{ title?: React.ReactNode; onClose: () => void; children?: React.ReactNode; width?: number }> =
  ({ title, onClose, children, width }) => {
    useEffect(() => {
      const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
      window.addEventListener('keydown', onKey);
      return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);
    return (
      <Overlay onClose={onClose}>
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
