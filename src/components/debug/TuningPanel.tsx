/**
 * THE TUNING PANEL (D84, line 127): the readout on screen, behind the dev switch.
 * It loads a world's record and shows it. Nothing here writes, and opening a world
 * is still the only thing that moves a record.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { UniversalRank } from '../../../shared/types';
import { RANK_ORDER } from '../../../shared/entities/player/systems/ProgressionSystem';
import { usePlayerStore } from '../../entities/player/store';
import { IDirectorRecord } from '../../../shared/entities/world/Director';
import { DirectorStore } from '../../entities/world/DirectorStore';
import { useWorldStore } from '../../entities/world/store';
import { WorldClock } from '../../entities/world/WorldClock';
import { ILevelRead, IRestRead, IRungRead, IWorldRead, TuningReadout } from '../../logic/systems/TuningReadout';
import { Bar, Busy, Button, Chip, Input, Panel } from '../ui/kit';

/** Which regenerations get a column, counted from now. Only a layout: the read takes any. */
const AHEADS = [0, 1, 2, 4, 8, 16, 32];
const LEVELS = [1, 2, 3, 5, 10, 20, 50, 100];
const REST_SHARES = [0, 0.25, 0.5, 0.75, 1];
const DEFAULT_PACE = 60;

const percent = (chance: number) => `${(chance * 100).toFixed(chance < 0.1 ? 1 : 0)}%`;
const cell: React.CSSProperties = { padding: '2px 8px', textAlign: 'right', whiteSpace: 'nowrap', borderBottom: '1px solid var(--ws-void-4)' };
const left: React.CSSProperties = { ...cell, textAlign: 'left' };
const past: React.CSSProperties = { ...cell, fontWeight: 700, borderLeft: '3px solid currentColor' };

const Table: React.FC<{ head: string[]; children?: React.ReactNode }> = ({ head, children }) => (
  <div style={{ overflowX: 'auto' }}>
    <table style={{ borderCollapse: 'collapse', width: '100%' }}>
      <thead><tr>{head.map((h, i) => <th key={h} style={i === 0 ? left : cell}>{h}</th>)}</tr></thead>
      <tbody>{children}</tbody>
    </table>
  </div>
);

const Assumption: React.FC<{ label: string; value: number; onChange?: (v: number) => void }> = ({ label, value, onChange }) => (
  <div style={{ maxWidth: 220, margin: '6px 0' }}>
    <Input
      label={label} type="number" min={1} value={value} readOnly={!onChange}
      onChange={e => { const v = Number(e.target.value); if (v > 0 && onChange) onChange(v); }}
    />
  </div>
);

/** Everything on the page, from what was read. Past certainty is said in words and drawn by a hard left seam. */
export const TuningView: React.FC<{
  name: string; read: IWorldRead; learnShare: number;
  rungs: IRungRead[]; levels: ILevelRead[]; rest: IRestRead[];
  jobsPerHour: number; killsPerHour: number;
  onJobsPerHour?: (v: number) => void; onKillsPerHour?: (v: number) => void;
}> = ({ name, read, learnShare, rungs, levels, rest, jobsPerHour, killsPerHour, onJobsPerHour, onKillsPerHour }) => {
  const heads = read.kinds[0]?.at.map(a => (a.ahead === 0 ? `NOW (${a.generation})` : `+${a.ahead}`)) ?? [];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <Panel
        title={`${name}: THE CHANCE OF A BODY CHANGING`}
        right={read.clocked ? `PHASE ${read.phase}` : 'OUTSIDE THE CLOCK'}
      >
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
          <Chip title="The clock's count of this world's regenerations">REGENERATION {read.generation}</Chip>
          {read.recordGeneration !== read.generation && (
            <Chip title="The record catches up when the world is next opened. This page reads it as if it had, and saves nothing.">
              SAVED RECORD AT {read.recordGeneration}
            </Chip>
          )}
          <Chip>{read.regenerationsPerDay.toFixed(read.regenerationsPerDay % 1 ? 2 : 0)} A DAY</Chip>
          {read.nextRegenerationMs !== null && <Chip>NEXT IN {WorldClock.say(read.nextRegenerationMs)}</Chip>}
          <Chip title="Measured through the Director's own roll, on 40,000 bodies, because the number is private to it">
            LEARNS AT {percent(learnShare)} OF THE TRAIT CHANCE (MEASURED)
          </Chip>
        </div>
        {read.kinds.length === 0 && <div className="ws-small">This world names no creature.</div>}
        {read.kinds.length > 0 && (
          <Table head={['KIND', 'WEIGHT', 'TOWARD 1', ...heads, 'LEARN NOW', 'PASSES 1']}>
            {read.kinds.map(kind => (
              <tr key={kind.id}>
                <td style={left}>{kind.name}</td>
                <td style={cell}>{kind.weight.toFixed(2)}</td>
                <td style={{ ...cell, minWidth: 90 }}><Bar value={Math.min(1, kind.at[0]?.chance ?? 0)} max={1} text="" /></td>
                {kind.at.map(a => (
                  <td key={a.ahead} style={a.chance >= 1 ? past : cell}>{a.chance >= 1 ? `PAST 1 (${percent(a.chance)})` : percent(a.chance)}</td>
                ))}
                <td style={cell}>{percent(kind.at[0]?.learn ?? 0)}</td>
                <td style={cell}>
                  {!read.clocked ? 'NEVER REGENERATES'
                    : !kind.certainAt ? 'NEVER AT THIS WEIGHT'
                    : kind.certainAt.msFromNow === 0 ? `ALREADY (${kind.certainAt.generation})`
                    : `IN ${WorldClock.say(kind.certainAt.msFromNow)} (${kind.certainAt.generation})`}
                </td>
              </tr>
            ))}
          </Table>
        )}
        <div className="ws-small" style={{ marginTop: 6 }}>Ahead, each weight is held where it stands: what the next fights do to it is not known.</div>
      </Panel>

      <Panel title="HOW LONG A SKILL RUNG TAKES">
        <Assumption label="JOBS AN HOUR: an assumption of this page, not a number in the game" value={jobsPerHour} onChange={onJobsPerHour} />
        <Table head={['RUNG', 'TOTAL XP', 'THIS RUNG', 'JOBS', 'AT THAT PACE']}>
          {rungs.map(r => (
            <tr key={r.name}>
              <td style={left}>{r.name.toUpperCase()}</td>
              <td style={cell}>{r.totalXp}</td>
              <td style={cell}>{r.xp}</td>
              <td style={cell}>{r.jobs}</td>
              <td style={cell}>{WorldClock.say(r.ms)}</td>
            </tr>
          ))}
        </Table>
      </Panel>

      <Panel title="HOW LONG A LEVEL TAKES">
        <Assumption label="KILLS AN HOUR: an assumption of this page, not a number in the game" value={killsPerHour} onChange={onKillsPerHour} />
        <Table head={['LEVEL', 'TO THE NEXT', 'TOTAL', 'KILLS', 'AT THAT PACE']}>
          {levels.map(l => (
            <tr key={l.level}>
              <td style={left}>{l.level}</td>
              <td style={cell}>{l.xp.toLocaleString()}</td>
              <td style={cell}>{l.totalXp.toLocaleString()}</td>
              <td style={cell}>{l.kills.toLocaleString()}</td>
              <td style={cell}>{WorldClock.say(l.ms)}</td>
            </tr>
          ))}
        </Table>
      </Panel>

      <Panel title="HOW LONG A REST TAKES, FOR THIS BODY">
        <Table head={['ENERGY SPENT', 'OF ITS MAXIMUM', 'THE REST']}>
          {rest.map(r => (
            <tr key={r.spent}>
              <td style={left}>{r.spent}</td>
              <td style={cell}>{Math.round(r.share * 100)}%</td>
              <td style={cell}>{WorldClock.say(r.ms)}</td>
            </tr>
          ))}
        </Table>
      </Panel>
    </div>
  );
};

export const TuningPanel: React.FC = () => {
  const { availableWorlds, refreshWorlds } = useWorldStore();
  const player = usePlayerStore(s => s.player);
  const [worldId, setWorldId] = useState<string | null>(null);
  const [record, setRecord] = useState<{ worldId: string; data: IDirectorRecord } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState(() => Date.now());
  const [jobsPerHour, setJobsPerHour] = useState(DEFAULT_PACE);
  const [killsPerHour, setKillsPerHour] = useState(DEFAULT_PACE);
  const [rank, setRank] = useState<UniversalRank>(UniversalRank.F);

  useEffect(() => {
    refreshWorlds().catch((e: unknown) => setFailed(e instanceof Error ? e.message : String(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const worlds = availableWorlds;
  // What is on a clock is what this page is for; a simulation is read only when asked for.
  const world = worlds.find(w => w.id === worldId) ?? worlds.find(w => !w.isDebug) ?? worlds[0];

  useEffect(() => {
    if (!world) return;
    let live = true;
    setFailed(null);
    setStartedAt(Date.now());
    DirectorStore.load(world.id).then(
      data => { if (live) setRecord({ worldId: world.id, data }); },
      (e: unknown) => { if (live) setFailed(e instanceof Error ? e.message : String(e)); }
    );
    return () => { live = false; };
  }, [world?.id]);

  const rungs = useMemo(() => TuningReadout.skillRungs(jobsPerHour), [jobsPerHour]);
  const levels = useMemo(() => TuningReadout.levels(LEVELS, killsPerHour, rank), [killsPerHour, rank]);
  const rest = useMemo(() => TuningReadout.restCurve(player, REST_SHARES), [player.attributes, player.equipment]);
  const ready = world && record?.worldId === world.id ? record.data : null;
  const read = useMemo(
    () => (world && ready ? TuningReadout.readWorld(world, ready, TuningReadout.kindsOf(world.themeId, ready), Date.now(), world.isDebug ? [0] : AHEADS) : null),
    [world, ready]
  );

  return (
    <div className="ws-ui" style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <Panel title="TUNING READOUT" right="READS ONLY. CHANGES NOTHING.">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {worlds.length === 0 && <span className="ws-small">No world on the registry to read.</span>}
          {worlds.map(w => (
            <Button key={w.id} tone={w.id === world?.id ? 'signal' : 'quiet'} aria-pressed={w.id === world?.id} onClick={() => setWorldId(w.id)}>
              {w.id === world?.id ? '▶ ' : ''}{w.name}
            </Button>
          ))}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 8, alignItems: 'center' }}>
          <span className="ws-small">KILLS OF RANK</span>
          {RANK_ORDER.map(r => (
            <Button key={r} tone={r === rank ? 'signal' : 'quiet'} aria-pressed={r === rank} onClick={() => setRank(r)}>{r === rank ? `▶ ${r}` : r}</Button>
          ))}
        </div>
      </Panel>
      {failed && <div className="ws-loss ws-small">THE RECORD WOULD NOT LOAD: {failed}</div>}
      {world && !read && !failed && <Busy label="READING THE WORLD'S RECORD" startedAt={startedAt} />}
      {world && read && (
        <TuningView
          name={world.name} read={read} learnShare={TuningReadout.learnShare()}
          rungs={rungs} levels={levels} rest={rest}
          jobsPerHour={jobsPerHour} killsPerHour={killsPerHour}
          onJobsPerHour={setJobsPerHour} onKillsPerHour={setKillsPerHour}
        />
      )}
    </div>
  );
};
