/**
 * MISSION CONTROL (Wave 9): a card per world, the state of its gate on the
 * world's own clock (D67), one deploy door shared with the Conduit's quick deploy,
 * and the way into recon, its own view (D85), while a world boots or stands open.
 */

import { ContentRegistry } from '../../shared/logic/theme/ContentRegistry';
import React, { useEffect, useState } from 'react';
import { useWorldStore, IWorldCard, worldPort } from '../entities/world/store';
import { SkyKind, WorldClock, WorldPhase } from '../entities/world/WorldClock';
import { openRecon } from './ReconView';
import { WorldCreator } from './WorldCreator';
import { ConnectWorld } from './ConnectWorld';
import { deployToWorld } from '../logic/systems/Deploy';
import { Button, Chip, CycleRibbon, Panel } from './ui/kit';
import { useFeed } from './ui/stores';
import { usePlayerStore, playerPort } from '../entities/player/store';
import { Tutorial } from '../logic/systems/Tutorial';
import { FirstOrder } from '../logic/systems/FirstOrder';
import { SHELF_STATE } from '../../shared/logic/theme/shelf';
import { hubPort } from '../entities/hub/store';

const GATE_WORDS: Record<WorldPhase, string> = {
  UP: 'GATE OPEN — IT CLOSES IN',
  OFF: 'GATE DOWN — IT BOOTS IN',
  SCAN: 'BOOTING, RECON ONLY — THE GATE OPENS IN'
};
const SKY_WORDS: Record<SkyKind, string> = { TURNING: 'IT TURNS', LOCKED: 'IT DOES NOT SPIN', NIGHT: 'ONLY NIGHT' };

export const WorldCard = ({ world, onDeploy, onSurvey }: { world: IWorldCard; onDeploy: () => void; onSurvey: () => void }) => {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  const isDev = world.isDebug;
  // Q2, Q14: the tutorial is a newcomer's first order, and says so until it is sealed
  const tutorial = Tutorial.isTutorial(world);
  const firstOrder = usePlayerStore(s => tutorial && Tutorial.firstOrderOpen(s.player));
  const moment = WorldClock.momentAt(world, now);
  const isClosing = moment.warning !== 'NONE';
  const dark = moment.phase === 'OFF';
  const cycle = WorldClock.cycleAt(world, now);

  return (
    <Panel
      title={world.name.toUpperCase()}
      right={<span style={{ display: 'flex', gap: 6 }}>{firstOrder && <Chip tone="signal">FIRST ORDER</Chip>}<Chip tone={world.difficulty === 'F' ? 'none' : 'loss'}>{world.difficulty}</Chip></span>}
      tone={dark ? 'none' : isClosing ? 'loss' : 'signal'}
    >
      <div className="ws-dim ws-small" style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span>SECTOR {world.seed.substring(0, 6).toUpperCase()}</span>
        <span>ARCHITECT {world.creator.toUpperCase()}</span>
      </div>
      {/* Wave 10E (D20): the pin is on the card — this world dreams this bank, forever */}
      <div className="ws-dim ws-small">
        {ContentRegistry.get(world.themeId) ? `${ContentRegistry.get(world.themeId)!.name.toUpperCase()} — pinned at mint${Tutorial.dreams(world, SHELF_STATE.magicUnlocked) ? ' · IT DREAMS' : ''}` : world.packVersion ? `DREAM PACK v${world.packVersion}${world.webVersion ? ` · WEB v${world.webVersion}` : ''} — pinned at mint` : 'MINTED BEFORE THE BANKS — it dreams nothing new'}
      </div>

      <div
        className={isDev || dark ? 'ws-dim' : isClosing ? 'ws-loss' : 'ws-bright'}
        style={{ fontSize: 'var(--ws-font-display)', fontWeight: 700, letterSpacing: '0.06em', margin: '6px 0 0' }}
      >
        {isDev ? 'STABLE' : WorldClock.say(moment.msLeft)}
      </div>
      <div className="ws-dim ws-small" style={{ letterSpacing: '0.1em' }}>
        {tutorial ? 'ALWAYS OPEN — NOTHING YOU BRING IS LOST HERE' : isDev ? 'OUTSIDE THE CLOCK' : GATE_WORDS[moment.phase]}
      </div>
      {tutorial && (
        <div className="ws-dim ws-small" style={{ marginTop: 4 }}>
          {firstOrder ? `Your first order: scan the marked block and drop on it, then ${FirstOrder.inOneLine()}. Once all five are done, it is behind you.` : 'Your first order is done.'}
        </div>
      )}
      {cycle && <CycleRibbon cycle={cycle} />}
      {!isDev && (
        <div className="ws-dim ws-small" style={{ letterSpacing: '0.1em', marginBottom: 10 }}>
          {moment.generation === 0 ? 'ALPHA, AS MINTED' : `REGENERATION ${moment.generation}`} · {SKY_WORDS[world.sky ?? 'TURNING']}
        </div>
      )}
      {/* The tutorial's gate never closes, and it turns all the same: what was taken comes back on its cycles */}
      {isDev && WorldClock.turns(world) && (
        <div className="ws-dim ws-small" style={{ letterSpacing: '0.1em', marginTop: 4 }}>
          {moment.generation === 0 ? 'AS IT FIRST STOOD' : `REGENERATION ${moment.generation}`}
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid var(--ws-void-3)', paddingTop: 8, marginTop: isDev ? 10 : 0 }}>
        {/* Q41: the tutorial has no certificate to count visits in, so it shows no count */}
        {tutorial ? <span /> : <span className="ws-dim ws-small">AGENTS <span className="ws-bright">{world.playerCount}</span></span>}
        {/* D85: recon always stands to the left of the drop, and neither risks anything until the drop itself */}
        <span style={{ display: 'flex', gap: 6 }}>
          {!isDev && (
            <Button
              tone="signal" primary={moment.phase === 'SCAN'}
              onClick={onSurvey}
              disabled={!moment.canSurvey}
              title={dark ? 'The gate is down. Nothing reads until it boots.' : undefined}
            >
              RECON
            </Button>
          )}
          {moment.phase !== 'SCAN' && (
            <Button
              tone="signal" primary={!isDev && !dark}
              onClick={onDeploy}
              disabled={dark}
              title={dark ? 'The gate is down.' : undefined}
            >
              DEPLOY
            </Button>
          )}
        </span>
      </div>
    </Panel>
  );
};

export const MissionControl = () => {
  const { availableWorlds: listed, refreshWorlds } = useWorldStore();
  // TQ (call 6): once the first order is done the tutorial is no longer offered here
  const sealedAt = usePlayerStore(s => s.player.tutorialSealedAt);
  const availableWorlds = Tutorial.offered(listed, { tutorialSealedAt: sealedAt });
  const [creatorOpen, setCreatorOpen] = useState(false);
  const pushFeed = useFeed(s => s.push);
  // The online world opens once the tutorial's first order is sealed (Pedro, 2026-11-04)
  const tutorialDone = usePlayerStore(s => !Tutorial.firstOrderOpen(s.player));

  useEffect(() => {
    refreshWorlds();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleDeploy = async (worldId: string) => {
    const res = await deployToWorld(worldId, worldPort, playerPort, hubPort);
    if (!res.ok && res.reason) pushFeed(res.reason, 'loss');
  };

  return (
    <div className="ws-ui" style={{ padding: 16, maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <span className="ws-signal" style={{ fontSize: 'var(--ws-font-title)', letterSpacing: '0.25em', fontWeight: 700 }}>
          EXTRACTION ZONES
        </span>
        <span style={{ display: 'flex', gap: 8 }}>
          {tutorialDone && <ConnectWorld onConnected={() => refreshWorlds()} />}
          <Button tone="proof" onClick={() => setCreatorOpen(true)}>+ MINT NEW WORLD</Button>
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12 }}>
        {availableWorlds.map(w => (
          <WorldCard key={w.id} world={w} onDeploy={() => handleDeploy(w.id)} onSurvey={() => void openRecon(w.id)} />
        ))}
      </div>

      {availableWorlds.length === 0 && (
        <div className="ws-dim" style={{ textAlign: 'center', marginTop: 40 }}>
          No stable realities on the registry. Mint a new world to begin.
        </div>
      )}

      <WorldCreator
        opened={creatorOpen}
        onClose={() => setCreatorOpen(false)}
        onCreated={() => refreshWorlds()}
      />
    </div>
  );
};
