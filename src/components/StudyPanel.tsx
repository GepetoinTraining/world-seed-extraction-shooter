/**
 * STUDY (D118), on the sheet: what lore is held, what is waiting for a dream, and the door
 * itself. Pedro: "You can study anything and everything", "literally always available, but,
 * it costs energy". So it offers where you stand, whatever is near, and a line to name
 * anything else. It says only what a sitting asks of the person, and nothing of how it may land.
 */

import React, { useMemo, useState } from 'react';
import { create } from 'zustand';
import { IStudyTarget } from '../../shared/types';
import { usePlayerStore, playerPort } from '../entities/player/store';
import { useWorldStore } from '../entities/world/store';
import { WorldGenerator } from '../../shared/entities/world/WorldGenerator';
import { EntityType, IWorldEntity } from '../../shared/entities/world/types';
import { LoreSystem } from '../logic/systems/LoreSystem';
import { RestSystem } from '../logic/systems/RestSystem';
import { StudySystem } from '../logic/systems/StudySystem';
import { StudyDoor } from '../logic/systems/StudyDoor';
import { FieldStudy } from '../logic/systems/FieldStudy';
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

// What a field thing passes to study is what it shows this person (S1k): FieldStudy.target

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
    const targets = entities.map(e => FieldStudy.target(e, player)).filter(t => {
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
  // S1k: each entry says what a sitting on it asks, so the tree's discount shows on the thing that will be studied
  const hub = hubTreeOf(hubPort.view().tech);
  const typedAsk = StudySystem.studyAsk(player, StudySystem.targetOfWords(words), hub);
  const kinds = LoreSystem.shownKinds(player);
  const topics = LoreSystem.topicsOf(player).slice(0, TOPICS_SHOWN);
  const waiting = RestSystem.queueOf(player).sittings.length;

  return (
    <div data-study-panel>
      <div className="ws-dim ws-small" style={{ letterSpacing: '0.1em', marginBottom: 2 }}>STUDY</div>
      <div className="ws-row ws-small" style={{ padding: '2px 0' }}>
        <span>GENERAL LORE <span className="ws-bright">{LoreSystem.held(player).toLocaleString()}</span></span>
        <span className="ws-dim">{waiting > 0 ? `${waiting} waiting on a dream` : 'nothing waiting'}</span>
      </div>
      {/* S2h: lore of each category, one row each under the word the person may see for it; a misreading is in what it reads */}
      {kinds.map(k => (
        <div key={k.key} className="ws-row ws-small" style={{ padding: '0 0 0 8px' }}>
          <span>LORE OF {k.name.toUpperCase()}</span>
          <span className="ws-bright">{k.reads.toLocaleString()}</span>
        </div>
      ))}
      {topics.length > 0 && (
        <div className="ws-dim ws-small" style={{ padding: '2px 0' }}>Known: {topics.map(t => t.topic.replace(/_/g, ' ')).join(', ')}</div>
      )}
      {/* Q26: what a sitting spends, beside what is held */}
      <Bar label="ENERGY" value={RestSystem.energyHeld(player)} max={StatSystem.maxEnergyOf(player)} tone="proof" text={`${Math.floor(RestSystem.energyHeld(player))} / ${Math.floor(StatSystem.maxEnergyOf(player))}`} />
      <div className="ws-dim ws-small" style={{ padding: '2px 0' }}>A sitting can go badly. Typed words take {typedAsk.cost} energy and {typedAsk.seconds}s; each thing below says its own.</div>
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
        {here.map(target => {
          const ask = StudySystem.studyAsk(player, target, hub);
          return (
            <Button
              key={StudySystem.keyOf(target)}
              tone="quiet"
              disabled={sitting}
              title={`Study ${target.name}: ${ask.cost} energy, ${ask.seconds}s`}
              onClick={() => StudyDoor.start(target, playerPort, hubPort)}
            >
              <span style={{ display: 'flex', justifyContent: 'space-between', gap: 6, minWidth: 0 }}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{target.name.toUpperCase()}</span>
                <span style={{ flexShrink: 0 }}>{ask.cost} · {ask.seconds}S</span>
              </span>
            </Button>
          );
        })}
      </div>
    </div>
  );
};
