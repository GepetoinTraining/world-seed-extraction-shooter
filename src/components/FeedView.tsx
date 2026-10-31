/**
 * THE FEED (Wave 9.6): what just happened, said once, bottom-left, then gone.
 * Harvests, refusals, purchases, interruptions — the log's voice, on screen.
 */

import React, { useEffect } from 'react';
import { FEED_LINE_MS, useFeed } from './ui/stores';

export const FeedView: React.FC = () => {
  const { lines, sweep } = useFeed();

  useEffect(() => {
    if (lines.length === 0) return;
    const t = setInterval(() => sweep(Date.now()), 500);
    return () => clearInterval(t);
  }, [lines.length, sweep]);

  if (lines.length === 0) return null;
  return (
    <div className="ws-ui ws-feed" style={{ position: 'fixed', left: 14, bottom: 14, zIndex: 400 }} aria-live="polite">
      {[...lines].reverse().map(l => (
        <div key={l.id} className={`ws-feed__line${l.tone !== 'plain' ? ` ws-feed__line--${l.tone}` : ''}`}>
          {l.text}
        </div>
      ))}
    </div>
  );
};

/** Helper for non-React callers (game loop, stores). */
export const feed = (text: string, tone: 'plain' | 'signal' | 'proof' | 'loss' = 'plain') =>
  useFeed.getState().push(text, tone);

export { FEED_LINE_MS };
