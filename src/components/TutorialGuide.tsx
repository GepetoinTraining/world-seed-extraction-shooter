/**
 * THE TUTORIAL IN THE FIELD (Q14): the lesson that stands now, and an arrow to the way out.
 *
 * It shows only in the tutorial world. The arrow is a shape at a fixed distance from the
 * person, pointing at the nearest beacon, so it reads without hue. The contact lesson gives
 * way to the way out once a hostile body has come within sight.
 */

import React, { useEffect } from 'react';
import { create } from 'zustand';
import { useWorldStore } from '../entities/world/store';
import { usePlayerStore } from '../entities/player/store';
import { EntityType } from '../../shared/entities/world/types';
import { LESSONS, Tutorial } from '../logic/systems/Tutorial';
import { Panel } from './ui/kit';

/** Which sessions have met a contact. A session's id keys it, so a new run starts the lesson again. */
const useMet = create<{ sessions: Record<string, true>; near: boolean }>(() => ({ sessions: {}, near: false }));

const ARROW_RADIUS_PX = 96;

export const TutorialGuide: React.FC<{ at: { x: number; z: number }; exit: { x: number; y: number; distance: number } | null }> = ({ at, exit }) => {
  const isTutorial = useWorldStore(s => Tutorial.isTutorial(s.availableWorlds.find(w => w.id === s.activeWorldId)));
  const sessionId = usePlayerStore(s => s.player.currentSession?.sessionId);
  const met = useMet(s => !!sessionId && !!s.sessions[sessionId]);
  const near = useMet(s => s.near);
  const firstOrder = usePlayerStore(s => Tutorial.firstOrderOpen(s.player));

  // The contact lesson: a hostile body within sight, read twice a second
  useEffect(() => {
    if (!isTutorial || !sessionId) return;
    const look = () => {
      const pos = usePlayerStore.getState().player.currentSession?.position;
      const map = useWorldStore.getState().currentMap;
      if (!pos || !map) return;
      const near = Object.values(map.chunks).some(c => c.entities.some(e =>
        e.type === EntityType.MOB && e.isHostile && Math.hypot(e.position.x - pos.x, e.position.y - pos.z) < Tutorial.CONTACT_RANGE_PX));
      if (near !== useMet.getState().near) useMet.setState({ near });
      if (near && !useMet.getState().sessions[sessionId]) useMet.setState(s => ({ sessions: { ...s.sessions, [sessionId]: true } }));
    };
    look();
    const timer = setInterval(look, 500);
    return () => clearInterval(timer);
  }, [isTutorial, sessionId]);

  if (!isTutorial) return null;
  const step = Tutorial.step({ scanned: true, inField: true, metContact: met, contactNear: near, sealed: false });
  const lesson = { title: Tutorial.titleOf(step, firstOrder), body: LESSONS[step].body };
  // Closer than the ring, the beacon itself is the mark
  const angle = exit && exit.distance > ARROW_RADIUS_PX ? Math.atan2(exit.y - at.z, exit.x - at.x) : null;

  return (
    <>
      <div style={{ position: 'absolute', top: 16, left: '50%', transform: 'translateX(-50%)', zIndex: 108, width: 420, maxWidth: '40vw', pointerEvents: 'none' }}>
        <Panel title={lesson.title} tone="signal">
          <span className="ws-small">{lesson.body}</span>
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
