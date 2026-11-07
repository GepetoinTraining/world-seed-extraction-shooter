/**
 * THE MINIMAP, ON SCREEN (the usability pass): a composed buffer painted a few
 * times a second, never with the frame, so it costs the game loop nothing.
 */

import React, { useEffect, useRef } from 'react';
import { Sprite } from '../../../shared/render/atoms/atoms';
import { TERMINAL_PALETTE } from './kit';

const REPAINT_MS = 250;

export const MinimapView: React.FC<{ compose: () => Sprite | null; scale?: number; label: string }> = ({ compose, scale = 2, label }) => {
  const canvas = useRef<HTMLCanvasElement>(null);
  const latest = useRef(compose);
  latest.current = compose;

  useEffect(() => {
    const paint = () => {
      const c = canvas.current;
      const ctx = c?.getContext('2d');
      const sprite = latest.current();
      if (!c || !ctx || !sprite) return;
      if (c.width !== sprite.w || c.height !== sprite.h) {
        c.width = sprite.w;
        c.height = sprite.h;
        c.style.width = `${sprite.w * scale}px`;
        c.style.height = `${sprite.h * scale}px`;
      }
      const img = ctx.createImageData(sprite.w, sprite.h);
      for (let i = 0; i < sprite.data.length; i++) {
        const v = sprite.data[i], j = i * 4;
        img.data[j] = TERMINAL_PALETTE[v * 3];
        img.data[j + 1] = TERMINAL_PALETTE[v * 3 + 1];
        img.data[j + 2] = TERMINAL_PALETTE[v * 3 + 2];
        img.data[j + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
    };
    paint();
    const t = setInterval(paint, REPAINT_MS);
    return () => clearInterval(t);
  }, [scale]);

  return (
    <canvas
      ref={canvas}
      role="img"
      aria-label={label}
      style={{ display: 'block', imageRendering: 'pixelated', border: '1px solid var(--ws-void-4)', pointerEvents: 'none' }}
    />
  );
};
