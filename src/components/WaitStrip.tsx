/**
 * THE WAIT STRIP (line 124): everything the game is making you wait for, in one place
 * above the hotbar, so no wait hides in a window that can close and none reads as a freeze.
 * It climbs over the sheet when the sheet is open, the way the feed does.
 */

import React from 'react';
import { usePlayerStore } from '../entities/player/store';
import { useHubStore, craftName } from '../entities/hub/store';
import { WorldClock } from '../entities/world/WorldClock';
import { WaitClock } from '../logic/systems/WaitClock';
import { ABOVE_THE_SHEET } from './FeedView';
import { Busy, Chip, TimerBar, useNow } from './ui/kit';
import { useSheet, useWaits } from './ui/stores';

const ABOVE_THE_HOTBAR = 96;

/** A rest from before its start was kept can only say what is left. */
export const RestBar: React.FC<{ rest: { until: number; startedAt?: number }; label?: string }> = ({ rest, label = 'AT REST' }) => {
  const now = useNow(1000);
  if (now >= rest.until) return null;
  return rest.startedAt
    ? <TimerBar label={label} startedAt={rest.startedAt} until={rest.until} />
    : <span className="ws-small">{label} {WorldClock.say(rest.until - now)}</span>;
};

const Row: React.FC<{ children: React.ReactNode }> = ({ children }) => <div className="ws-wait-strip__row">{children}</div>;

export const WaitStrip: React.FC = () => {
  const waits = useWaits(s => s.waits);
  const sheetOpen = useSheet(s => s.open);
  const session = usePlayerStore(s => s.player.currentSession);
  const rest = usePlayerStore(s => s.player.rest);
  const ownerId = usePlayerStore(s => s.player.id);
  const crafts = useHubStore(s => s.craftingJobs);
  const builds = useHubStore(s => s.buildJobs);
  const now = useNow(1000);

  const live = waits.filter(w => w.until === undefined || w.until > now);
  // The field is loud enough. What the city is working on shows at home.
  const atHome = session ? [] : WaitClock.hubWaits(crafts, builds, ownerId, craftName, now);
  const fieldRest = !!session && !!rest && rest.until > now;
  if (live.length === 0 && atHome.length === 0 && !fieldRest) return null;

  return (
    <div
      className="ws-ui ws-wait-strip"
      style={{ position: 'fixed', left: '50%', transform: 'translateX(-50%)', bottom: sheetOpen ? ABOVE_THE_SHEET : ABOVE_THE_HOTBAR, zIndex: 400 }}
    >
      {fieldRest && (
        <Row>
          <RestBar rest={rest!} />
          <div className="ws-dim ws-small">A hurt will break it.</div>
        </Row>
      )}
      {live.map(w => (
        w.until === undefined
          ? <Busy key={w.id} label={w.label} startedAt={w.startedAt} quietForMs={w.quietForMs} />
          : <Row key={w.id}><TimerBar label={w.label} startedAt={w.startedAt} until={w.until} /></Row>
      ))}
      {atHome.map(w => <Row key={w.id}><TimerBar label={w.label} startedAt={w.startedAt} until={w.until} /></Row>)}
    </div>
  );
};

const STATUS_WORDS: Record<string, string> = { slow: 'SLOW', dot: 'HURTING', ward: 'WARD', haste: 'HASTE', weaken: 'WEAK' };

/** What is working on your body and how long it has left, beside the vitals. Your own state is never hidden from you. */
export const BodyClocks: React.FC = () => {
  const effects = usePlayerStore(s => s.player.currentSession?.activeEffects);
  const marks = usePlayerStore(s => s.player.equipment?.protected);
  const now = useNow(500);
  const running = (effects ?? []).filter(e => e.until > now);
  // One scroll over three slots is one clock.
  const kept = [...new Map((marks ?? []).filter(m => m.until && m.until > now).map(m => [`${m.by}:${m.until}`, m])).values()];
  if (running.length === 0 && kept.length === 0) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'flex-start' }}>
      {running.map(e => (
        <Chip key={e.kind}>
          {e.startedAt
            ? <TimerBar label={STATUS_WORDS[e.kind] ?? e.kind.toUpperCase()} startedAt={e.startedAt} until={e.until} />
            : <>{STATUS_WORDS[e.kind] ?? e.kind.toUpperCase()} {WorldClock.say(e.until - now)}</>}
        </Chip>
      ))}
      {kept.map(m => (
        <Chip key={`${m.by}:${m.until}`} tone="proof">
          {m.startedAt
            ? <TimerBar label="KEPT" tone="proof" startedAt={m.startedAt} until={m.until!} />
            : <>KEPT {WorldClock.say(m.until! - now)}</>}
        </Chip>
      ))}
    </div>
  );
};
