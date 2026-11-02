/**
 * MAINTENANCE, ON A PERSON'S OWN MACHINE (D103): "locally it warns the player they need to maintain
 * the DB, after the third warning (10 days) it's forced".
 *
 * A warning is a strip under the bar with a button. The third is the whole screen, and there is no way
 * past it but through. It only shows here, in the shell: nobody is pulled out of a world mid-run, and
 * the first thing they see on coming back is this.
 */

import React, { useEffect, useState } from 'react';
import { Button, useNow } from './ui/kit';
import { Maintenance, localRoom } from '../logic/systems/Maintenance';
import { useFeed } from './ui/stores';
import { WorldClock } from '../entities/world/WorldClock';

export const MaintenanceNotice: React.FC = () => {
  const [lastAt, setLastAt] = useState<number | null>(null);
  const [running, setRunning] = useState(false);
  const now = useNow(60_000);

  useEffect(() => {
    void localRoom.lastAt().then(at => {
      if (at !== null) { setLastAt(at); return; }
      // The clock starts the first time anyone looks. A new install has nothing to maintain yet
      const started = Date.now();
      void localRoom.mark(started);
      setLastAt(started);
    });
  }, []);

  const run = async () => {
    setRunning(true);
    const at = Date.now();
    const { line, tone } = Maintenance.say(await Maintenance.run(localRoom, at));
    setLastAt(at);
    setRunning(false);
    useFeed.getState().push(line, tone);
  };

  const state = lastAt === null ? null : Maintenance.stateAt(lastAt, now);
  const forced = !!state?.forced;
  useEffect(() => {
    if (forced && !running) void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [forced]);

  if (!state || state.warnings === 0) return null;
  if (forced || running) {
    return (
      <div className="ws-ui" style={{ position: 'fixed', inset: 0, zIndex: 200, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, background: 'var(--ws-void-1)' }}>
        <span>MAINTAINING THE DATABASE</span>
        <span className="ws-dim ws-small">Ten days since the last time. This is not asking. It takes as long as it takes, and everything stays where you left it.</span>
      </div>
    );
  }
  return (
    <div className="ws-row ws-small" style={{ padding: '4px 12px', borderBottom: '2px solid var(--ws-void-4, #27272a)' }}>
      <span>
        WARNING {state.warnings} OF 3: the database needs maintaining. It runs by itself in {WorldClock.say(state.forcedInMs)}, at a time you did not pick.
      </span>
      <Button onClick={() => void run()}>RUN NOW</Button>
    </div>
  );
};
