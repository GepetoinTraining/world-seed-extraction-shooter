/**
 * STUDY (D118), on the sheet: what lore is held, what is waiting for a dream, and the door
 * itself. Pedro: "You can study anything and everything", "literally always available, but,
 * it costs energy". So it offers where you stand, whatever is near, and a line to name
 * anything else. It says only what a sitting asks of the person, and nothing of how it may land.
 */

import React, { useMemo, useState } from 'react';
import { create } from 'zustand';
import { IPlayer, IStudyTarget } from '../../shared/types';
import { usePlayerStore, playerPort } from '../entities/player/store';
import { useWorldStore } from '../entities/world/store';
import { WorldGenerator } from '../../shared/entities/world/WorldGenerator';
import { EntityType, IWorldEntity } from '../../shared/entities/world/types';
import { inspectEntity } from '../render/atoms/inspect';
import { LoreSystem } from '../logic/systems/LoreSystem';
import { RestSystem } from '../logic/systems/RestSystem';
import { StudySystem } from '../logic/systems/StudySystem';
import { StudyDoor } from '../logic/systems/StudyDoor';
import { ContactNames } from '../logic/systems/ContactNames';
import { StatSystem } from '../../shared/logic/systems/StatSystem';
import { Bar, Button, Input } from './ui/kit';
import { useWaits } from './ui/stores';
import { hubPort } from '../entities/hub/store';
import { hubTreeOf } from '../entities/hub/hubTech';

/** How far the eye reaches in the field: the inspect card's own reach. */
const FIELD_REACH_PX = 220;
const NEAR_SHOWN = 5;
const TOPICS_SHOWN = 6;

/** What the city says is in front of you. The city knows; the sheet only reads it. */
export const useStudyReach = create<{ near: IStudyTarget[]; set: (near: IStudyTarget[]) => void }>(set => ({
  near: [],
  set: near => set({ near })
}));

const living = (e: IWorldEntity) => (e.type === EntityType.MOB || e.npc ? 1 : 0);

const fieldTarget = (e: IWorldEntity, player: IPlayer): IStudyTarget => {
  if (e.type === EntityType.MOB) return StudySystem.targetOfCreature({ definitionId: e.definitionId, displayName: e.displayName, rank: e.rank });
  // A person has no name until it is asked, so one never asked is studied as an unknown figure
  if (e.npc) return StudySystem.targetOfPerson({ id: e.id, name: ContactNames.personName(e, player), rank: e.rank });
  // The inspect card's own title: what can be seen of it, and nothing more
  return StudySystem.targetOfThing({ id: e.id, name: inspectEntity(e, { player, dist: 0, level: () => 0 }).title, rank: e.rank });
};

export const StudyPanel: React.FC = () => {
  const player = usePlayerStore(s => s.player);
  const session = player.currentSession;
  const near = useStudyReach(s => s.near);
  const map = useWorldStore(s => s.currentMap);
  const waits = useWaits(s => s.waits);
  const [words, setWords] = useState('');

  const here = useMemo<IStudyTarget[]>(() => {
    if (!session || !map) return [StudySystem.targetOfPlace('The city around you'), ...near];
    const { x, z } = session.position;
    const entities = WorldGenerator.chunkKeysInBox(x, z, FIELD_REACH_PX)
      .flatMap(key => map.chunks[key]?.entities ?? [])
      .filter(e => Math.hypot(e.position.x - x, e.position.y - z) <= FIELD_REACH_PX)
      // Whoever is alive comes first, then the nearest: the rest of the world can be named on the line
      .sort((a, b) => living(b) - living(a) || Math.hypot(a.position.x - x, a.position.y - z) - Math.hypot(b.position.x - x, b.position.y - z))
      .slice(0, NEAR_SHOWN);
    const seen = new Set<string>();
    const targets = entities.map(e => fieldTarget(e, player)).filter(t => {
      const key = StudySystem.keyOf(t);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    const chunk = map.chunks[WorldGenerator.chunkKeysInBox(x, z, 0)[0]];
    return [StudySystem.targetOfPlace('The ground you stand on', [], chunk?.difficulty), ...targets];
    // Moved enough to matter: the tile, not the pixel
  }, [session && Math.round(session.position.x / 20), session && Math.round(session.position.z / 20), map, near]);

  const sitting = waits.some(w => w.id === 'study_sitting');
  const ask = StudySystem.studyAsk(player, here[0], hubTreeOf(hubPort.view().tech));
  const topics = LoreSystem.topicsOf(player).slice(0, TOPICS_SHOWN);
  const waiting = RestSystem.queueOf(player).sittings.length;

  return (
    <div data-study-panel>
      <div className="ws-dim ws-small" style={{ letterSpacing: '0.1em', marginBottom: 2 }}>STUDY</div>
      <div className="ws-row ws-small" style={{ padding: '2px 0' }}>
        <span>LORE <span className="ws-bright">{LoreSystem.held(player).toLocaleString()}</span></span>
        <span className="ws-dim">{waiting > 0 ? `${waiting} waiting on a dream` : 'nothing waiting'}</span>
      </div>
      {topics.length > 0 && (
        <div className="ws-dim ws-small" style={{ padding: '2px 0' }}>Known: {topics.map(t => t.topic.replace(/_/g, ' ')).join(', ')}</div>
      )}
      {/* Q26: what a sitting spends, beside what is held */}
      <Bar label="ENERGY" value={RestSystem.energyHeld(player)} max={StatSystem.maxEnergyOf(player)} tone="proof" text={`${Math.floor(RestSystem.energyHeld(player))} / ${Math.floor(StatSystem.maxEnergyOf(player))}`} />
      <div className="ws-dim ws-small" style={{ padding: '2px 0' }}>A sitting takes {ask.cost} energy and {ask.seconds}s. It can go badly.</div>
      <form
        style={{ display: 'flex', gap: 4, margin: '2px 0 4px' }}
        onSubmit={e => {
          e.preventDefault();
          if (StudyDoor.start(StudySystem.targetOfWords(words), playerPort, hubPort).ok) setWords('');
        }}
      >
        <Input aria-label="Study anything else" placeholder="Anything…" value={words} onChange={e => setWords(e.target.value)} style={{ flex: 1, minWidth: 0 }} />
        <Button tone="signal" type="submit" disabled={sitting || !words.trim()}>{sitting ? 'STUDYING…' : 'STUDY'}</Button>
      </form>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {here.map(target => (
          <Button
            key={StudySystem.keyOf(target)}
            tone="quiet"
            disabled={sitting}
            title={`Study ${target.name}`}
            onClick={() => StudyDoor.start(target, playerPort, hubPort)}
          >
            <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{target.name.toUpperCase()}</span>
          </Button>
        ))}
      </div>
    </div>
  );
};
