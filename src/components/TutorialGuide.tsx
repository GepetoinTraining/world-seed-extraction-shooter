/**
 * THE TUTORIAL IN THE FIELD (Q14, TQ): the first order's five tasks, and an arrow to the way out.
 *
 * It shows only in the tutorial world. The tasks stand in Pedro's order, the current one marked by a shape and the word
 * NOW with what to do about it beneath, done ones by a tick and the word DONE (call 1): by shape, position and words,
 * never by hue. The arrow is a shape at a fixed distance from the person, pointing at the nearest beacon. The tasks'
 * things stand along the way out (`FirstOrderLane`), so following it passes each of them in turn.
 */

import React from 'react';
import { useWorldStore } from '../entities/world/store';
import { usePlayerStore } from '../entities/player/store';
import { Tutorial } from '../logic/systems/Tutorial';
import { FirstOrder } from '../logic/systems/FirstOrder';
import { Panel } from './ui/kit';

const ARROW_RADIUS_PX = 96;

export const TutorialGuide: React.FC<{ at: { x: number; z: number }; exit: { x: number; y: number; distance: number } | null }> = ({ at, exit }) => {
  const isTutorial = useWorldStore(s => Tutorial.isTutorial(s.availableWorlds.find(w => w.id === s.activeWorldId)));
  const record = usePlayerStore(s => FirstOrder.of(s.player));
  const firstOrder = usePlayerStore(s => Tutorial.firstOrderOpen(s.player));

  if (!isTutorial) return null;
  const rows = FirstOrder.rows(record);
  const current = FirstOrder.current(record);
  // Closer than the ring, the beacon itself is the mark
  const angle = exit && exit.distance > ARROW_RADIUS_PX ? Math.atan2(exit.y - at.z, exit.x - at.x) : null;

  return (
    <>
      <div style={{ position: 'absolute', top: 16, left: '50%', transform: 'translateX(-50%)', zIndex: 108, width: 420, maxWidth: '40vw', pointerEvents: 'none' }}>
        <Panel title={firstOrder ? 'FIRST ORDER' : 'THE TUTORIAL'} tone="signal">
          <ol aria-label="The first order's tasks" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
            {rows.map(row => (
              <li key={row.task} aria-current={row.current ? 'step' : undefined} className={row.current ? 'ws-bright' : 'ws-dim'} style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                <span aria-hidden style={{ width: 14, textAlign: 'center', fontWeight: 700 }}>{row.mark}</span>
                <span className="ws-small" style={{ flex: 1, textDecoration: row.done ? 'line-through' : undefined }}>{row.title}</span>
                {row.word && <span className="ws-small" style={{ fontWeight: 700, letterSpacing: '0.1em' }}>{row.word}</span>}
              </li>
            ))}
          </ol>
          {current && <div className="ws-small" style={{ marginTop: 6 }}>{FirstOrder.hint(current)}</div>}
        </Panel>
      </div>
      {/* The arrow to the way out: a solid chevron on a ring around the person, by position and shape */}
      {angle !== null && (
        <div
          aria-label="The way out"
          style={{
            position: 'absolute', left: '50%', top: '50%', zIndex: 95, pointerEvents: 'none',
            transform: `translate(${Math.cos(angle) * ARROW_RADIUS_PX}px, ${Math.sin(angle) * ARROW_RADIUS_PX}px) translate(-50%, -50%) rotate(${angle + Math.PI / 2}rad)`
          }}
        >
          <div style={{ width: 0, height: 0, borderLeft: '14px solid transparent', borderRight: '14px solid transparent', borderBottom: '24px solid var(--ws-text-bright)' }} />
          <div style={{ width: 0, height: 0, margin: '-14px auto 0', borderLeft: '8px solid transparent', borderRight: '8px solid transparent', borderBottom: '12px solid var(--ws-void-0)' }} />
        </div>
      )}
    </>
  );
};
