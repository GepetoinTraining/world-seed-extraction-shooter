/**
 * RECON (Wave 9, D85): its own view. A survey drawn from the atoms, not five hues.
 *
 * It opens two ways. From a Nexus card there is no session and nothing is risked: a person
 * reads a world while it boots or stands open, and an open world can lead on to a drop through
 * the one deploy door. Inside a session it is the field's own first step, where leaving is a
 * withdrawal. What a person learns here is theirs, wherever they go (D68, D81), and a map
 * in the stash reads into the same record (D85).
 */

import React, { useEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import { DreamingSystem } from '../entities/world/Dreaming';
import { useWorldStore } from '../entities/world/store';
import { usePlayerStore } from '../entities/player/store';
import { useHubStore } from '../entities/hub/store';
import { ISector, ScanLevel } from '../entities/world/types';
import { WorldClock } from '../entities/world/WorldClock';
import { SECTOR_CHUNKS, sectorOf } from '../entities/world/grid';
import { SessionJournal } from '../logic/journal/SessionJournal';
import { PlayerPersistence } from '../logic/persistence/PlayerPersistence';
import { Sprite } from '../render/atoms/atoms';
import { reconCell, RECON_CELL_ATOMS } from '../render/atoms/recon';
import { LoadoutSystem } from '../entities/player/systems/LoadoutSystem';
import { IManifestLine, ISurveyEntry, SurveySystem } from '../logic/systems/SurveySystem';
import { ScanPass } from '../logic/systems/ScanPass';
import { MapSystem, isMapItem } from '../logic/systems/MapSystem';
import { deployToWorld, OPENING_WORLD } from '../logic/systems/Deploy';
import { isTypingTarget, suggestStart } from '../logic/systems/FieldInput';
import { LESSONS, Tutorial } from '../logic/systems/Tutorial';
import { Button, Chip, Kbd, Panel, RankMark, TERMINAL_PALETTE, useNow } from './ui/kit';
import { useAppView, useFeed, useSheet, whileWaiting } from './ui/stores';

const RECON_SCALE = 2;

const feed = (text: string, tone: 'plain' | 'signal' | 'proof' | 'loss' = 'plain') => useFeed.getState().push(text, tone);

/** A drop chosen before there was a session. The field's recon carries it out when the door has opened. */
const useDropOrder = create<{ at: { x: number; y: number } | null }>(() => ({ at: null }));

/** Read a world from its card: no session, no field, nothing risked. */
export async function openRecon(worldId: string): Promise<void> {
  await whileWaiting(OPENING_WORLD, 'READING THE WORLD', () => useWorldStore.getState().selectWorld(worldId));
  if (useWorldStore.getState().activeWorldId !== worldId) {
    feed('That world would not open.', 'loss');
    return;
  }
  useWorldStore.getState().applySurvey(usePlayerStore.getState().player.survey?.[worldId]);
  useAppView.getState().setView('RECON');
}

/** Whichever way a person leaves the view, the world they held open is let go and what they read is saved. */
export function closeRecon(): void {
  useWorldStore.getState().exitWorld();
  void PlayerPersistence.flush('survey');
}

/** With onDrop it is the field's first step inside a session. Without it, it stands alone, from a card. */
/** D93: what a character holds of a sector's holdings, in chunks across that sector. */
const holdingCells = (entry: ISurveyEntry | undefined, sx: number, sy: number) => {
  const local = (ground: string): [number, number] => {
    const [cx, cy] = ground.split(',').map(Number);
    return [cx - sx * SECTOR_CHUNKS, cy - sy * SECTOR_CHUNKS];
  };
  return entry?.holdings?.map(held => ({
    chunks: held.chunks.map(local), seat: local(held.seat),
    marks: held.marks.map(m => ({ at: local(m.ground), fn: m.fn, built: m.built }))
  }));
};

/**
 * Q44: one manifest line, said so it reads without colour. A leader leads with a triangle and the
 * pack behind it, a pack with its bars, and danger with a bang ahead of the count.
 */
const manifestText = (line: IManifestLine): string => {
  const danger = line.hostile ? '! ' : '';
  if (line.mark === 'leader') return `${danger}▲ LEADER [${line.rank}] ${line.label}${line.pack ? `, ${line.pack} behind it` : ''}`;
  if (line.mark === 'pack') return `${danger}≡ PACK OF ${line.count} [${line.rank}] ${line.label}`;
  return `${danger}${line.count}× [${line.rank}] ${line.label}`;
};

export const ReconView: React.FC<{ onDrop?: (x: number, y: number) => void }> = ({ onDrop }) => {
  const free = !onDrop;
  const { currentMap, scanSector, selectSector, selectedDropZone, generation, activeWorldId, availableWorlds } = useWorldStore();
  const survey = usePlayerStore(s => (activeWorldId ? s.player.survey?.[activeWorldId] : undefined));
  // D67: outside a session the gate's time is the whole point, so it stays on screen
  const now = useNow(1000);
  const card = free ? availableWorlds.find(w => w.id === activeWorldId) : undefined;
  const moment = card ? WorldClock.momentAt(card, now) : undefined;
  const canDrop = !free || !!moment?.canDeploy;
  const canScan = !free || !!moment?.canSurvey;
  // Q14: the tutorial's recon reads one known block, and the drop goes there
  const tutorial = Tutorial.isTutorial(availableWorlds.find(w => w.id === activeWorldId));
  const player = usePlayerStore(s => s.player);
  // D67, D69: how the world changed since it last stood open. How many, never who (D60)
  const since = ScanPass.readout(useWorldStore(s => s.directorRecord));
  const maps = (player.bank.stashTabs[0]?.items ?? []).filter(isMapItem).filter(m => m.mapData.worldId === activeWorldId);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const deskRef = useRef<HTMLDivElement>(null);

  const cellPx = RECON_CELL_ATOMS * RECON_SCALE;
  const [cursor, setCursor] = useState(() => {
    // Q14: the tutorial's cursor starts on its marked block, so the first SPACE reads it
    const at = currentMap ? (tutorial ? Tutorial.knownBlock(currentMap) : suggestStart(currentMap)) : { x: 0, y: 0 };
    return { x: at.x, y: at.y };
  });
  const firstOrder = usePlayerStore(s => Tutorial.firstOrderOpen(s.player));
  const dragged = useRef(false);

  // The survey keeps its true cell size and the desk pans; it opens centered.
  useEffect(() => {
    const desk = deskRef.current;
    if (!desk || !currentMap) return;
    desk.scrollLeft = (currentMap.width * cellPx - desk.clientWidth) / 2;
    desk.scrollTop = (currentMap.height * cellPx - desk.clientHeight) / 2;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentMap?.seed]);

  // The survey bitmap: one composed buffer, repainted when a scan deepens it.
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx || !currentMap) return;
    const s = RECON_CELL_ATOMS;
    const w = currentMap.width * s, h = currentMap.height * s;
    const buffer = new Uint8Array(w * h);
    for (let sy = 0; sy < currentMap.height; sy++) for (let sx = 0; sx < currentMap.width; sx++) {
      const sector = currentMap.sectors[`${sx},${sy}`];
      if (!sector) continue;
      const cell: Sprite = reconCell({
        biome: sector.biome,
        scanLevel: sector.scanLevel,
        hasExit: sector.scanLevel > ScanLevel.UNKNOWN && sector.hasExtraction,
        hostiles: sector.scanLevel >= ScanLevel.DETAILED && sector.entities.some(e => e.isHostile),
        seed: currentMap.seed, sx, sy,
        holdings: holdingCells(survey?.[`${sx},${sy}`], sx, sy)
      });
      for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
        buffer[(sy * s + y) * w + sx * s + x] = cell.data[y * s + x];
      }
    }
    const img = ctx.createImageData(w, h);
    for (let i = 0; i < buffer.length; i++) {
      const v = buffer[i], j = i * 4;
      img.data[j] = TERMINAL_PALETTE[v * 3];
      img.data[j + 1] = TERMINAL_PALETTE[v * 3 + 1];
      img.data[j + 2] = TERMINAL_PALETTE[v * 3 + 2];
      img.data[j + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }, [currentMap, currentMap?.sectors, survey]);

  // Recon has its keys: walk a cursor, scan, drop, read, or leave.
  const reconKeys = useRef<(e: KeyboardEvent) => void>(() => {});
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => reconKeys.current(e);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // The field has mounted, and the door already chose where: carry it out, once.
  const order = useDropOrder(s => s.at);
  useEffect(() => {
    const at = useDropOrder.getState().at;
    if (!onDrop || !at) return;
    useDropOrder.setState({ at: null });
    useWorldStore.getState().selectSector(at.x, at.y); // the door reopened the world, and that cleared the choice
    onDrop(at.x, at.y);
  }, [order, onDrop]);

  // Q14: in the tutorial the marked block comes selected, so ENTER drops once it is read
  useEffect(() => {
    if (!tutorial || !currentMap || useWorldStore.getState().selectedDropZone) return;
    const at = Tutorial.knownBlock(currentMap);
    selectSector(at.x, at.y);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tutorial, currentMap?.seed]);

  // A regeneration under an open view: nothing read now may be saved against the world it was.
  const generationNow = moment?.generation;
  useEffect(() => {
    if (generationNow === undefined || generationNow === generation || !activeWorldId) return;
    void openRecon(activeWorldId).then(() => feed('The world regenerated. What you read of it is now old.', 'signal'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generationNow]);

  if (!currentMap) return null;

  const selectedKey = selectedDropZone ? `${selectedDropZone.x},${selectedDropZone.y}` : null;
  const selected = selectedKey ? currentMap.sectors[selectedKey] : null;

  const scanAt = (sx: number, sy: number) => {
    const sector = currentMap.sectors[`${sx},${sy}`];
    if (!sector) return;
    // D68: a first touch on what went stale shows what was known, and the next one scans
    const known = survey?.[`${sx},${sy}`];
    const held = selectedDropZone?.x === sx && selectedDropZone?.y === sy;
    selectSector(sx, sy);
    setCursor({ x: sx, y: sy });
    if (!canScan) { feed('The gate is down. Nothing reads until it boots.', 'loss'); return; }
    if (tutorial) {
      const may = Tutorial.mayScan(currentMap, sx, sy);
      if (!may.ok) { feed(may.reason!, 'signal'); return; }
    }
    if (known && SurveySystem.staleBy(known, generation) > 0 && !held) return;
    // Wave 10C (D22): mental stats drive the recon phase — intelligence,
    // perception and focus (framed or raw) deepen each scan. The analyst
    // build earns its keep before the drop.
    const depth = LoadoutSystem.reconEfficiency(usePlayerStore.getState().player.attributes);
    scanSector(sx, sy, depth);
    // D68: what was read is this character's, until the world regenerates under it
    const read = useWorldStore.getState().currentMap?.sectors[`${sx},${sy}`];
    if (read && activeWorldId) {
      usePlayerStore.setState(s => ({
        player: SurveySystem.record(s.player, activeWorldId, `${sx},${sy}`,
          SurveySystem.entry(read.scanLevel, generation, read.entities, s.player.survey?.[activeWorldId]?.[`${sx},${sy}`]))
      }));
    }
  };

  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (dragged.current) return;
    const box = e.currentTarget.getBoundingClientRect();
    scanAt(Math.floor((e.clientX - box.left) / cellPx), Math.floor((e.clientY - box.top) / cellPx));
  };

  // The desk pans by the pointer: a drag is a pan, and a press that stays put is a scan.
  const startPan = (e: React.PointerEvent) => {
    const desk = deskRef.current;
    if (!desk || e.button !== 0) return;
    const start = { x: e.clientX, y: e.clientY, left: desk.scrollLeft, top: desk.scrollTop };
    dragged.current = false;
    const move = (m: PointerEvent) => {
      if (Math.hypot(m.clientX - start.x, m.clientY - start.y) > 4) dragged.current = true;
      desk.scrollLeft = start.left - (m.clientX - start.x);
      desk.scrollTop = start.top - (m.clientY - start.y);
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  // Wave 9: recon can be left without dropping — the survey was free, the drop is not.
  const withdraw = () => {
    if (free) { useAppView.getState().setView('MISSIONS'); return; }
    const st = usePlayerStore.getState();
    st.emergencyJackOut(); // nothing was risked yet; the kit banks back untouched
    useWorldStore.getState().exitWorld();
    void useHubStore.getState().restAndCredit('WITHDREW'); // D30: back at the hub, a rest all the same
    void SessionJournal.abort(PlayerPersistence.persistableJson(usePlayerStore.getState().player));
  };

  // D85: from a card the drop goes through the one door, and refusing leaves the view open.
  const drop = async (x: number, y: number) => {
    if (tutorial) {
      const may = Tutorial.mayDrop(currentMap, x, y);
      if (!may.ok) { feed(may.reason!, 'signal'); return; }
    }
    if (onDrop) { onDrop(x, y); return; }
    if (!activeWorldId) return;
    const res = await deployToWorld(activeWorldId);
    if (!res.ok) { if (res.reason) feed(res.reason, 'loss'); return; }
    useDropOrder.setState({ at: { x, y } });
    useAppView.getState().setView('MISSIONS');
  };

  const newsIn = (map: typeof maps[number]) => SurveySystem.readMap(player, map.mapData.worldId, map.mapData.sectors).taken;
  const readMap = (map: typeof maps[number]) => {
    const res = MapSystem.read(map.id);
    if (!res.ok) { feed(res.reason!, 'loss'); return; }
    feed(`${map.name}: ${res.taken} sector${res.taken === 1 ? '' : 's'} added${res.kept ? `, and ${res.kept} kept, for you held as fresh` : ''}.`, 'proof');
  };

  reconKeys.current = (e: KeyboardEvent) => {
    if (isTypingTarget(e.target) || useSheet.getState().open || document.querySelector('.ws-overlay')) return;
    const onControl = (e.target as HTMLElement)?.tagName === 'BUTTON';
    const key = e.key.toLowerCase();
    const desk = deskRef.current;
    const PAN = cellPx;
    if (key === 'x') { e.preventDefault(); withdraw(); return; }
    if (key === 'r') {
      const next = maps.find(m => newsIn(m) > 0);
      if (next) readMap(next);
      return;
    }
    if (e.key === 'Enter' && !onControl && canDrop) {
      e.preventDefault();
      e.stopImmediatePropagation(); // this Enter is the drop; it must not also act in the field
      if (selected) void drop(selected.x, selected.y);
      else feed('No sector selected. A drop needs a place.', 'loss');
      return;
    }
    if (e.key === ' ' && !onControl) { e.preventDefault(); scanAt(cursor.x, cursor.y); return; }
    if (desk && key === 'w') { desk.scrollTop -= PAN; return; }
    if (desk && key === 's') { desk.scrollTop += PAN; return; }
    if (desk && key === 'a') { desk.scrollLeft -= PAN; return; }
    if (desk && key === 'd') { desk.scrollLeft += PAN; return; }
    const dir = e.key === 'ArrowLeft' ? [-1, 0] : e.key === 'ArrowRight' ? [1, 0] : e.key === 'ArrowUp' ? [0, -1] : e.key === 'ArrowDown' ? [0, 1] : null;
    if (dir) {
      e.preventDefault();
      const next = {
        x: Math.max(0, Math.min(currentMap.width - 1, cursor.x + dir[0])),
        y: Math.max(0, Math.min(currentMap.height - 1, cursor.y + dir[1]))
      };
      setCursor(next);
      if (desk) {
        desk.scrollLeft = next.x * cellPx - desk.clientWidth / 2;
        desk.scrollTop = next.y * cellPx - desk.clientHeight / 2;
      }
    }
  };

  const entityCounts = (sector: ISector) => {
    const counts: Record<string, number> = {};
    sector.entities.forEach(e => { counts[e.type] = (counts[e.type] || 0) + 1; });
    return counts;
  };

  const known = tutorial ? Tutorial.knownBlock(currentMap) : null;
  const knownRead = !!known && (currentMap.sectors[`${known.x},${known.y}`]?.scanLevel ?? 0) >= ScanLevel.DETAILED;
  const step = Tutorial.step({ scanned: knownRead, inField: false, metContact: false, sealed: false });
  const lesson = tutorial ? { title: Tutorial.titleOf(step, firstOrder), body: LESSONS[step].body } : null;
  const advice = known
    ? { kind: knownRead ? 'DROP' as const : 'SCAN' as const, x: known.x, y: known.y, why: lesson!.body }
    : suggestStart(currentMap);
  const bracket = (x: number, y: number, label: string, dashed: boolean, shown: boolean) => shown ? (
    <div style={{
      position: 'absolute', left: x * cellPx - 3, top: y * cellPx - 3,
      width: cellPx + 6, height: cellPx + 6, pointerEvents: 'none',
      outline: `2px ${dashed ? 'dashed' : 'solid'} var(--ws-text-bright)`
    }}>
      {label && <span className="ws-bright ws-small" style={{ position: 'absolute', left: 0, top: -19, background: 'var(--ws-void-0)', padding: '0 4px', lineHeight: '16px', whiteSpace: 'nowrap' }}>{label}</span>}
    </div>
  ) : null;

  return (
    <div className="ws-ui" style={{ position: 'relative', height: '100%', background: 'var(--ws-void-0)', overflow: 'hidden' }}>
      {/* The survey fills the window. Drag or the keys pan it; there is nothing to scroll. */}
      <div
        ref={deskRef}
        onPointerDown={startPan}
        style={{ position: 'absolute', inset: 0, overflow: 'hidden', display: 'flex', cursor: 'grab', lineHeight: 0, touchAction: 'none' }}
      >
        <div style={{ position: 'relative', flexShrink: 0, margin: 'auto', width: currentMap.width * cellPx, height: currentMap.height * cellPx }}>
          <canvas
            ref={canvasRef}
            width={currentMap.width * RECON_CELL_ATOMS}
            height={currentMap.height * RECON_CELL_ATOMS}
            onClick={handleClick}
            style={{
              width: currentMap.width * cellPx,
              height: currentMap.height * cellPx,
              imageRendering: 'pixelated',
              display: 'block'
            }}
          />
          {bracket(advice.x, advice.y, advice.kind === 'DROP' ? 'DROP HERE' : 'SCAN HERE', false, !(selectedDropZone && selectedDropZone.x === advice.x && selectedDropZone.y === advice.y))}
          {bracket(cursor.x, cursor.y, '', true, true)}
          {selectedDropZone && bracket(selectedDropZone.x, selectedDropZone.y, 'SELECTED', false, true)}
        </div>
      </div>

      <div style={{ position: 'absolute', top: 12, left: 12, display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-start', pointerEvents: 'none' }}>
        <Chip tone="signal">
          {!free ? 'DRONE RECON — CHOOSE WHERE TO DROP'
            : moment?.phase === 'SCAN' ? `BOOTING, RECON ONLY — THE GATE OPENS IN ${WorldClock.say(moment.msLeft)}`
            : moment?.phase === 'UP' ? `GATE OPEN — IT CLOSES IN ${WorldClock.say(moment.msLeft)} — CHOOSE WHERE TO DROP`
            : `THE GATE IS DOWN — IT BOOTS IN ${WorldClock.say(moment?.msLeft ?? 0)}`}
        </Chip>
        <Panel title={lesson ? lesson.title : 'WHERE TO START'} tone={lesson ? 'signal' : undefined} style={{ width: 320 }}>
          <span className="ws-small">{advice.why}</span>
        </Panel>
        {free && (moment?.phase === 'SCAN' || since.plain + since.writing > 0) && (
          <Panel title="SINCE IT LAST STOOD OPEN" style={{ width: 320 }}>
            <div className="ws-list ws-small">
              <div className="ws-row"><span>Kinds that changed, with their words</span><span>{since.words}</span></div>
              <div className="ws-row"><span>Kinds that changed, on plain names</span><span>{since.plain}</span></div>
              <div className="ws-row"><span>What it grew</span><span>{since.grown}</span></div>
              <div className="ws-row"><span>Still being written</span><span>{since.writing}</span></div>
            </div>
            <span className="ws-dim ws-small">What is not written by the time the gate opens stands as it is, and waits for the next boot.</span>
          </Panel>
        )}
        {/* D85: a map reads into the same record a scan writes, as old as it was when scanned */}
        {maps.length > 0 && (
          <Panel title="MAPS IN THE STASH" style={{ width: 320, pointerEvents: 'auto' }}>
            <div className="ws-list ws-small" style={{ maxHeight: 180, overflowY: 'auto' }}>
              {maps.map(map => {
                const { sectors, newest } = SurveySystem.mapSpread(map.mapData.sectors);
                const behind = generation - newest;
                const news = newsIn(map);
                return (
                  <div key={map.id} className="ws-row" style={{ gap: 8 }}>
                    <span style={{ minWidth: 0 }}>
                      <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{map.name}</span>
                      <span className="ws-dim">
                        by {map.mapData.scribeName} · {sectors} sector{sectors === 1 ? '' : 's'} · {behind > 0 ? `${behind} regeneration(s) old` : 'FRESH'}
                      </span>
                    </span>
                    <Button tone={news > 0 ? 'signal' : 'quiet'} disabled={news === 0} style={{ flexShrink: 0, whiteSpace: 'nowrap' }} onClick={() => readMap(map)}>
                      {news > 0 ? <><Kbd>R</Kbd> READ</> : 'NOTHING NEW'}
                    </Button>
                  </div>
                );
              })}
            </div>
          </Panel>
        )}
      </div>

      {/* Intel Panel */}
      <div style={{ position: 'absolute', top: 12, right: 12, width: 290, maxHeight: 'calc(100% - 60px)', overflowY: 'auto' }}>
      <Panel title="SECTOR INTEL">
        {!selected && <span className="ws-dim ws-small">No sector selected. The land shows from above: each kind of ground has its own pattern, faint through the static until scanned. A scan reads the rest: the threat, the way out (the lozenge), and who stands there (ticks along the top edge).</span>}
        {selected && (
          <div className="ws-list ws-small">
            <div className="ws-row"><span className="ws-dim">SECTOR</span><span>{selected.x}·{selected.y}</span></div>
            {/* Q14: the ground shows from above, before any scan */}
            <div className="ws-row"><span className="ws-dim">BIOME</span><span>{selected.biome}</span></div>
            {selected.scanLevel < ScanLevel.BASIC && <div className="ws-row ws-dim"><span>Not scanned: threat, exit and contacts unknown</span><span /></div>}
            {selected.scanLevel >= ScanLevel.BASIC && (
              <>
                <div className="ws-row">
                  <span className="ws-dim">THREAT</span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><RankMark rank={String(selected.difficulty)} scale={2} />{selected.difficulty}</span>
                </div>
                {selected.hasExtraction && <div className="ws-row"><span className="ws-dim">EXIT</span><span className="ws-signal">BEACON PRESENT</span></div>}
              </>
            )}
            {/* A chest found is known wherever you stand; whether it has filled again is not */}
            {(() => {
              const marks = Object.values((activeWorldId && player.chestMarks?.[activeWorldId]) || {})
                .filter(m => sectorOf(m.x) === selected.x && sectorOf(m.y) === selected.y);
              if (marks.length === 0) return null;
              const empty = marks.filter(m => m.empty).length;
              return (
                <div className="ws-row">
                  <span className="ws-dim">CHESTS YOU KNOW</span>
                  <span>{marks.length}{empty > 0 ? ` · ${empty} last seen empty` : ''}</span>
                </div>
              );
            })()}
            {/* D93: ground someone holds, as it was read, however old that is */}
            {(survey?.[`${selected.x},${selected.y}`]?.holdings ?? []).map(holding => {
              const old = Math.max(0, generation - holding.generation);
              return (
                <React.Fragment key={holding.seat}>
                  <div className="ws-row"><span className="ws-dim">HELD GROUND</span><span>{holding.named ?? 'UNKNOWN HOLDING'}</span></div>
                  <div className="ws-row"><span>Chunks · anchors in its ward</span><span>{holding.chunks.length} · {holding.anchors}</span></div>
                  <div className="ws-row ws-dim"><span>{old === 0 ? 'Read this regeneration' : `Read ${old} regeneration(s) ago`}</span><span>{old > 0 ? 'STALE' : 'FRESH'}</span></div>
                  {old > 0 && <div className="ws-dim ws-small">It has had time to grow. Its border may be anywhere past this.</div>}
                </React.Fragment>
              );
            })}
            {/* D68: what was read last time, plainly old, and never the truth of now */}
            {selected.scanLevel < ScanLevel.DETAILED && (() => {
              const entry = survey?.[`${selected.x},${selected.y}`];
              if (!entry || entry.level < ScanLevel.DETAILED) return null;
              return (
                <>
                  <div className="ws-row"><span className="ws-dim">LAST READ</span><span>{SurveySystem.staleBy(entry, generation)} regeneration(s) ago</span></div>
                  {Object.entries(entry.contacts).map(([type, count]) => (
                    <div key={type} className="ws-row ws-dim"><span>then: {count}× {type}</span><span /></div>
                  ))}
                  <div className="ws-dim ws-small">Stale. Scan again to learn what changed.</div>
                </>
              );
            })()}
            {selected.scanLevel >= ScanLevel.DETAILED && (() => {
              const prior = survey?.[`${selected.x},${selected.y}`]?.prior;
              const entry = survey?.[`${selected.x},${selected.y}`];
              if (!prior || !entry) return null;
              const total = (c: Record<string, number>) => Object.values(c).reduce((sum, n) => sum + n, 0);
              return (
                <>
                  <div className="ws-row"><span className="ws-dim">SINCE REGENERATION {prior.generation}</span><span /></div>
                  <div className="ws-row"><span>Contacts</span><span>{total(prior.contacts)} → {total(entry.contacts)}</span></div>
                  <div className="ws-row"><span>That have changed</span><span>{prior.changed} → {entry.changed}</span></div>
                </>
              );
            })()}
            {selected.scanLevel >= ScanLevel.DETAILED && (
              <>
                <div className="ws-row"><span className="ws-dim">CONTACTS</span><span /></div>
                {Object.entries(entityCounts(selected)).map(([type, count]) => (
                  <div key={type} className="ws-row"><span>{count}× {type}</span><span /></div>
                ))}
                {selected.entities.length === 0 && <div className="ws-row"><span className="ws-dim">Sector clear.</span><span /></div>}
                {/* Q44: this depth marks a leader seen (D93), so what it saw shows here, by shape */}
                {SurveySystem.packs(selected.entities).length > 0 && (
                  <>
                    <div className="ws-row"><span className="ws-dim">LEADERS AND PACKS</span><span /></div>
                    {SurveySystem.packs(selected.entities).map(line => (
                      <div key={line.key} className="ws-row">
                        <span className={line.hostile ? 'ws-loss' : undefined}>{manifestText(line)}</span><span />
                      </div>
                    ))}
                  </>
                )}
              </>
            )}
            {selected.scanLevel >= ScanLevel.COMPLETE && selected.entities.length > 0 && (
              <>
                <div className="ws-row"><span className="ws-dim">MANIFEST</span><span /></div>
                {SurveySystem.manifest(selected.entities).map(line => (
                  <div key={line.key} className="ws-row">
                    <span className={line.hostile ? 'ws-loss' : undefined}>{manifestText(line)}</span><span />
                  </div>
                ))}
              </>
            )}
            {/* Wave 10E (the Dreaming): the deep scan reads what the Seed dreamed
                into this sector — themed signatures, fixed at the world's mint */}
            {selected.scanLevel >= ScanLevel.COMPLETE && (() => {
              const dream = DreamingSystem.active();
              if (!dream) return null;
              const names = DreamingSystem.sectorDream(dream.seed, dream.pack, selected.biome, selected.x, selected.y);
              if (names.length === 0) return null;
              return (
                <>
                  <div className="ws-row"><span className="ws-dim">THE DREAM</span><span className="ws-dim">pack v{dream.pack.version}</span></div>
                  {names.map(name => (
                    <div key={name} className="ws-row"><span className="ws-signal">{name}</span><span /></div>
                  ))}
                  <div className="ws-dim ws-small">The Seed is still dreaming. These names run in this ground.</div>
                </>
              );
            })()}
            {canDrop && (!tutorial || Tutorial.mayDrop(currentMap, selected.x, selected.y).ok) && (
              <div style={{ marginTop: 10 }}>
                <Button tone="signal" primary style={{ width: '100%', textAlign: 'center' }} onClick={() => void drop(selected.x, selected.y)}>
                  <Kbd>ENTER</Kbd> CONFIRM DROP
                </Button>
              </div>
            )}
          </div>
        )}
        <div style={{ marginTop: 8 }}>
          {free
            ? <Button tone="quiet" onClick={withdraw}><Kbd>X</Kbd> LEAVE</Button>
            : <Button tone="quiet" onClick={withdraw}><Kbd>X</Kbd> WITHDRAW</Button>}
        </div>
      </Panel>
      </div>

      {/* The key help stands apart from the data */}
      <div className="ws-dim ws-small" style={{ position: 'absolute', bottom: 10, left: 12, background: 'rgba(3,3,3,0.75)', padding: '2px 8px' }}>
        <Kbd>WASD</Kbd> pan · <Kbd>ARROWS</Kbd> move the cursor · <Kbd>SPACE</Kbd> or click: scan, and again to read deeper
      </div>
    </div>
  );
};
