/**
 * MISSION CONTROL (Wave 9): a card per world, the collapse clock, one deploy
 * door shared with the Conduit's quick deploy.
 */

import React, { useEffect, useState } from 'react';
import { useWorldStore, IWorldCard } from '../entities/world/store';
import { WorldCreator } from './WorldCreator';
import { deployToWorld } from '../logic/systems/Deploy';
import { Button, Chip, Panel } from './ui/kit';
import { useFeed } from './ui/stores';

const WorldCard = ({ world, onDeploy }: { world: IWorldCard; onDeploy: () => void }) => {
  const [timeLeft, setTimeLeft] = useState(0);

  useEffect(() => {
    const tick = () => setTimeLeft(Math.max(0, Math.floor((world.collapseTime - Date.now()) / 1000)));
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [world.collapseTime]);

  const minutes = Math.floor(timeLeft / 60);
  const seconds = timeLeft % 60;
  const isClosing = minutes < 2;
  const isDev = world.isDebug;

  return (
    <Panel
      title={world.name.toUpperCase()}
      right={<Chip tone={world.difficulty === 'F' ? 'none' : 'loss'}>{world.difficulty}</Chip>}
      tone={world.retired ? 'none' : isClosing && !isDev ? 'loss' : 'signal'}
    >
      <div className="ws-dim ws-small" style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span>SECTOR {world.seed.substring(0, 6).toUpperCase()}</span>
        <span>ARCHITECT {world.creator.toUpperCase()}</span>
      </div>
      {/* Wave 10E (D20): the pin is on the card — this world dreams this bank, forever */}
      <div className="ws-dim ws-small">
        {world.packVersion ? `DREAM PACK v${world.packVersion} — pinned at mint` : 'MINTED BEFORE THE BANKS — it dreams nothing new'}
      </div>

      <div
        className={isDev ? 'ws-dim' : isClosing ? 'ws-loss' : 'ws-bright'}
        style={{ fontSize: 'var(--ws-font-display)', fontWeight: 700, letterSpacing: '0.06em', margin: '6px 0 0' }}
      >
        {isDev ? 'STABLE' : `${minutes}:${seconds.toString().padStart(2, '0')}`}
      </div>
      <div className="ws-dim ws-small" style={{ letterSpacing: '0.1em', marginBottom: 10 }}>
        {isDev ? 'SIMULATION — IT DOES NOT COLLAPSE' : 'TIME UNTIL REALITY COLLAPSE'}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid var(--ws-void-3)', paddingTop: 8 }}>
        <span className="ws-dim ws-small">AGENTS <span className="ws-bright">{world.playerCount}</span></span>
        <Button
          tone="signal" primary={!isDev}
          onClick={onDeploy}
          disabled={world.retired}
          title={world.retired ? 'Surveyed on an older grid. Its record stands, but it can no longer be walked.' : undefined}
        >
          DEPLOY
        </Button>
      </div>
      {world.retired && <div className="ws-dim ws-small" style={{ marginTop: 6 }}>RETIRED — the record stands; the ground is gone.</div>}
    </Panel>
  );
};

export const MissionControl = () => {
  const { availableWorlds, refreshWorlds } = useWorldStore();
  const [creatorOpen, setCreatorOpen] = useState(false);
  const pushFeed = useFeed(s => s.push);

  useEffect(() => {
    refreshWorlds();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleDeploy = async (worldId: string) => {
    const res = await deployToWorld(worldId);
    if (!res.ok && res.reason) pushFeed(res.reason, 'loss');
  };

  return (
    <div className="ws-ui" style={{ padding: 16, maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <span className="ws-signal" style={{ fontSize: 'var(--ws-font-title)', letterSpacing: '0.25em', fontWeight: 700 }}>
          EXTRACTION ZONES
        </span>
        <Button tone="proof" onClick={() => setCreatorOpen(true)}>+ MINT NEW WORLD</Button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12 }}>
        {availableWorlds.map(w => (
          <WorldCard key={w.id} world={w} onDeploy={() => handleDeploy(w.id)} />
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
