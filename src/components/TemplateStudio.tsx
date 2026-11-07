/**
 * THE SCRIBE'S TABLE (Wave 10B.2, Pedro's D12): the builder view. A design
 * surface at the room's own scale — pick a size class, draw structure and
 * floor zones with a tile cursor, hear every refusal in voice as you draw,
 * preview through composeRoom itself in color and grayscale, and MINT the
 * plan into a signed, tradable item. Copies are minted here too (D14), each
 * paid in paper and ink, each carrying the author's hand forever. A map is written
 * here too (D85), for the same bill, from what the character has scanned.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ItemType } from '../../shared/types';
import { interiorSize, RoomPieceKind } from '../../shared/entities/hub/room';
import {
  ITemplateDraft, SIZE_CLASSES, TEMPLATE_MINT_BILL, canAddPiece, defaultSheet,
  templateToRoom, zoneRegionArea
} from '../../shared/entities/hub/template';
import { ITemplateItem, TemplateSystem, isTemplateItem } from '../logic/systems/TemplateSystem';
import { usePlayerStore } from '../entities/player/store';
import { useFeed } from './ui/stores';
import { InsuranceSystem, SCROLL_DEFINITIONS } from '../logic/systems/InsuranceSystem'; // Wave 10E (D21)
import { MapSystem } from '../logic/systems/MapSystem';
import { SurveySystem } from '../logic/systems/SurveySystem';
import { useWorldStore } from '../entities/world/store';
import { WorldClock } from '../entities/world/WorldClock';
import { composeRoom } from '../render/atoms/room';
import { buildPalette, grayscale } from '../../shared/render/atoms/atoms';
import { HUB_GENRE } from '../render/atoms/hub';
import { billText } from '../../shared/entities/hub/room';
import { inspectItem } from '../render/atoms/inspect';
import { Button, CardView, Chip, Input, ItemSprite, Kbd, Modal, Tabs } from './ui/kit';

type Tool = 'WALL' | 'DOOR' | 'WINDOW' | 'ZONE' | 'ERASE';
const TOOLS: Tool[] = ['WALL', 'DOOR', 'WINDOW', 'ZONE', 'ERASE'];
const STRUCTURES = ['HOUSE', 'WORKSHOP', 'VENDOR'] as const;

interface DraftZone { name: string; tiles: { x: number; y: number }[] }

export const TemplateStudio: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [tab, setTab] = useState<'DRAW' | 'COPY' | 'SCROLLS' | 'MAPS'>('DRAW');
  const [footIdx, setFootIdx] = useState(1); // 4x4 by default: the lots the city has
  const [structureType, setStructureType] = useState<typeof STRUCTURES[number]>('HOUSE');
  const [pieces, setPieces] = useState<{ kind: RoomPieceKind; x: number; y: number }[]>([]);
  const [zones, setZones] = useState<DraftZone[]>([]);
  const [activeZone, setActiveZone] = useState(0);
  const [zoneName, setZoneName] = useState('');
  const [tool, setTool] = useState<Tool>('WALL');
  const [cursor, setCursor] = useState({ x: 2, y: 2 });
  const [gray, setGray] = useState(false);
  const [name, setName] = useState('');
  const [voice, setVoice] = useState('The pen is ready.');

  const pushFeed = useFeed(s => s.push);
  const { player } = usePlayerStore();
  const stash = player.bank.stashTabs[0]?.items || [];
  const templatesHeld = stash.filter(i => i.type === ItemType.TEMPLATE && isTemplateItem(i)) as ITemplateItem[];
  const [copySel, setCopySel] = useState<string>('');
  const worlds = useWorldStore(s => s.availableWorlds);
  useEffect(() => {
    if (tab === 'MAPS' && worlds.length === 0) void useWorldStore.getState().refreshWorlds();
  }, [tab, worlds.length]);

  const footprint = SIZE_CLASSES[footIdx];
  const size = interiorSize(footprint);

  const draft: ITemplateDraft = useMemo(() => ({
    name,
    structureType,
    footprint,
    pieces,
    zones: zones.map(z => ({ ...z, minArea: 0 }))
  }), [name, structureType, footprint, pieces, zones]);

  const previewRoom = useMemo(() => templateToRoom(
    { version: 1, authorUid: '', authorName: '', designedAt: 0, ...draft },
    defaultSheet(draft),
    'studio'
  ), [draft]);

  const sprite = useMemo(() => composeRoom(previewRoom), [previewRoom]);
  const palette = useMemo(() => gray ? grayscale(buildPalette(HUB_GENRE)) : buildPalette(HUB_GENRE), [gray]);

  const measuredZones = useMemo(() => zones.map(z => ({
    ...z,
    measured: zoneRegionArea(draft, { ...z, minArea: 0 })
  })), [zones, draft]);

  // ---------------------------------------------------------------------------
  // THE SURFACE: the composed preview, the cursor tile, the zones' outlines
  // ---------------------------------------------------------------------------

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const SCALE = 2;
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    ctx.imageSmoothingEnabled = false;
    const img = ctx.createImageData(sprite.w, sprite.h);
    for (let i = 0; i < sprite.data.length; i++) {
      const v = sprite.data[i], j = i * 4;
      img.data[j] = palette[v * 3]; img.data[j + 1] = palette[v * 3 + 1]; img.data[j + 2] = palette[v * 3 + 2]; img.data[j + 3] = 255;
    }
    const off = document.createElement('canvas');
    off.width = sprite.w; off.height = sprite.h;
    off.getContext('2d')!.putImageData(img, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(off, 0, 0, sprite.w * SCALE, sprite.h * SCALE);

    const T = 10 * SCALE; // one tile on screen
    // Zone outlines: shape and position, never hue alone.
    zones.forEach((z, zi) => {
      ctx.strokeStyle = zi === activeZone && tool === 'ZONE' ? '#fafafa' : '#a1a1aa';
      ctx.setLineDash([3, 3]);
      z.tiles.forEach(t => ctx.strokeRect(t.x * T + 1, t.y * T + 1, T - 2, T - 2));
      ctx.setLineDash([]);
    });
    // The cursor is a tile, not a pixel.
    ctx.strokeStyle = '#20de81';
    ctx.lineWidth = 2;
    ctx.strokeRect(cursor.x * T + 1, cursor.y * T + 1, T - 2, T - 2);
  }, [sprite, palette, cursor, zones, activeZone, tool]);

  // ---------------------------------------------------------------------------
  // DRAWING: every stroke passes the builder's own check, refusals in voice
  // ---------------------------------------------------------------------------

  const paintAt = useCallback((x: number, y: number) => {
    if (tool === 'ERASE') {
      if (pieces.some(p => p.x === x && p.y === y)) {
        setPieces(ps => ps.filter(p => !(p.x === x && p.y === y)));
        setVoice('Erased.');
      } else if (zones.some(z => z.tiles.some(t => t.x === x && t.y === y))) {
        setZones(zs => zs.map(z => ({ ...z, tiles: z.tiles.filter(t => !(t.x === x && t.y === y)) })));
        setVoice('The zone lets the tile go.');
      } else setVoice('Nothing drawn there.');
      return;
    }
    if (tool === 'ZONE') {
      const zone = zones[activeZone];
      if (!zone) { setVoice('Name a zone first. The floor takes no anonymous paint.'); return; }
      if (x <= 0 || y <= 0 || x >= size.w - 1 || y >= size.h - 1) { setVoice('Zones are floor. The shell is not floor.'); return; }
      if (pieces.some(p => p.x === x && p.y === y)) { setVoice('Something is drawn there. Zones are open floor.'); return; }
      const owner = zones.findIndex(z => z.tiles.some(t => t.x === x && t.y === y));
      if (owner === activeZone) {
        setZones(zs => zs.map((z, i) => i === activeZone ? { ...z, tiles: z.tiles.filter(t => !(t.x === x && t.y === y)) } : z));
        setVoice(`${zone.name} lets the tile go.`);
      } else if (owner !== -1) {
        setVoice(`That tile belongs to ${zones[owner].name}. Erase it there first.`);
      } else {
        setZones(zs => zs.map((z, i) => i === activeZone ? { ...z, tiles: [...z.tiles, { x, y }] } : z));
        setVoice(`${zone.name} grows by a tile.`);
      }
      return;
    }
    if (pieces.some(p => p.x === x && p.y === y)) { setVoice('Something is already drawn there. Erase it first.'); return; }
    const verdict = canAddPiece(draft, tool, x, y);
    if (!verdict.ok) { setVoice(verdict.reason!); return; }
    if (zones.some(z => z.tiles.some(t => t.x === x && t.y === y))) {
      setZones(zs => zs.map(z => ({ ...z, tiles: z.tiles.filter(t => !(t.x === x && t.y === y)) })));
    }
    setPieces(ps => [...ps, { kind: tool, x, y }]);
    setVoice(`${tool} drawn at ${x},${y}.`);
  }, [tool, pieces, zones, activeZone, draft, size]);

  // Keyboard-complete: the whole surface answers the keys.
  const onKeyDown = (e: React.KeyboardEvent) => {
    const el = e.target as HTMLElement;
    if (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA') return;
    const key = e.key.toLowerCase();
    const move = (dx: number, dy: number) => setCursor(c => ({
      x: Math.max(0, Math.min(size.w - 1, c.x + dx)),
      y: Math.max(0, Math.min(size.h - 1, c.y + dy))
    }));
    if (key === 'arrowup' || key === 'w') { move(0, -1); e.preventDefault(); }
    else if (key === 'arrowdown' || key === 's') { move(0, 1); e.preventDefault(); }
    else if (key === 'arrowleft' || key === 'a') { move(-1, 0); e.preventDefault(); }
    else if (key === 'arrowright' || key === 'd') { move(1, 0); e.preventDefault(); }
    else if (key === ' ' || key === 'enter') { paintAt(cursor.x, cursor.y); e.preventDefault(); }
    else if (key >= '1' && key <= '5') { setTool(TOOLS[Number(key) - 1]); e.preventDefault(); }
    else if (key === 'g') { setGray(v => !v); e.preventDefault(); }
  };

  const clickTile = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const x = Math.floor((e.clientX - box.left) / (10 * SCALE));
    const y = Math.floor((e.clientY - box.top) / (10 * SCALE));
    setCursor({ x, y });
    paintAt(x, y);
  };

  const changeFootprint = (idx: number) => {
    setFootIdx(idx);
    setPieces([]);
    setZones([]);
    setCursor({ x: 2, y: 2 });
    setVoice('A fresh sheet at the new size. The old strokes did not fit it.');
  };

  const addZone = () => {
    const trimmed = zoneName.trim().toUpperCase();
    if (!trimmed) { setVoice('A zone with no name cannot be promised.'); return; }
    if (zones.some(z => z.name === trimmed)) { setVoice(`${trimmed} already exists. Names are singular.`); return; }
    setZones(zs => [...zs, { name: trimmed, tiles: [] }]);
    setActiveZone(zones.length);
    setTool('ZONE');
    setZoneName('');
    setVoice(`${trimmed} opened. Paint its floor.`);
  };

  const mint = async () => {
    const final: ITemplateDraft = {
      ...draft,
      zones: measuredZones.map(z => ({ name: z.name, tiles: z.tiles, minArea: z.measured }))
    };
    const res = await TemplateSystem.mintTemplate(final);
    if (res.ok) {
      pushFeed(`${res.item.name} minted, signed, in the stash. The plan is yours to keep or sell.`, 'proof');
      setVoice(`${res.item.name} minted. The architect's name travels with it.`);
    } else {
      setVoice(res.reason);
      pushFeed(res.reason, 'loss');
    }
  };

  const mintCopy = async (id: string) => {
    const res = await TemplateSystem.mintCopy(id);
    if (res.ok) pushFeed(`${res.item.name} copied for ${billText(TEMPLATE_MINT_BILL)}. The original hand signs every copy.`, 'proof');
    else pushFeed(res.reason, 'loss');
  };

  const paperHeld = stash.filter(i => (i.tags || []).includes('paper')).length;
  const inkHeld = stash.filter(i => (i.tags || []).includes('ink')).length;
  const copySelected = templatesHeld.find(t => t.id === copySel);

  return (
    <Modal title="THE SCRIBE'S TABLE" onClose={onClose} width={840}>
      <Tabs
        tabs={[
          { id: 'DRAW' as const, label: 'DRAW A PLAN' },
          { id: 'COPY' as const, label: `COPY A PLAN (${templatesHeld.length})` },
          { id: 'SCROLLS' as const, label: 'WRITE A SCROLL' },
          { id: 'MAPS' as const, label: 'WRITE A MAP' }
        ]}
        active={tab}
        onChange={id => setTab(id as 'DRAW' | 'COPY' | 'SCROLLS' | 'MAPS')}
      />
      {tab === 'DRAW' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 260px', gap: 10, alignItems: 'start', marginTop: 8 }}>
          <div
            tabIndex={0}
            onKeyDown={onKeyDown}
            aria-label="Design surface. Arrow keys move the tile cursor, space draws, number keys pick a tool, G toggles grayscale."
            style={{ outline: 'none' }}
          >
            <div style={{ display: 'flex', gap: 6, marginBottom: 6, flexWrap: 'wrap' }}>
              <select className="ws-input" value={footIdx} onChange={e => changeFootprint(Number(e.target.value))} aria-label="Lot size class">
                {SIZE_CLASSES.map((c, i) => <option key={i} value={i}>{c.width}×{c.height} lot</option>)}
              </select>
              <select className="ws-input" value={structureType} onChange={e => setStructureType(e.target.value as any)} aria-label="Structure type">
                {STRUCTURES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              <Button tone="quiet" onClick={() => setGray(v => !v)}>{gray ? 'COLOR' : 'GRAYSCALE'} <Kbd>G</Kbd></Button>
            </div>
            <canvas
              ref={canvasRef}
              width={sprite.w * SCALE}
              height={sprite.h * SCALE}
              onClick={clickTile}
              style={{ border: '1px solid var(--ws-void-4)', imageRendering: 'pixelated', cursor: 'crosshair', display: 'block' }}
            />
            <div className="ws-small" style={{ marginTop: 6, minHeight: 18 }} role="status">{voice}</div>
            <div className="ws-dim ws-small">
              <Kbd>←↑↓→</Kbd> cursor · <Kbd>SPACE</Kbd> draw · <Kbd>1</Kbd>–<Kbd>5</Kbd> tool · the way out stays open
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span className="ws-dim ws-small">The tools. The plan fixes geometry; the buyer picks every material.</span>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {TOOLS.map((t, i) => (
                <Button key={t} tone={tool === t ? 'signal' : 'quiet'} onClick={() => setTool(t)} title={`Tool ${i + 1}`}>
                  {t}
                </Button>
              ))}
            </div>

            <span className="ws-dim ws-small" style={{ marginTop: 4 }}>Floor zones: named promises of open room.</span>
            <div style={{ display: 'flex', gap: 4 }}>
              <Input value={zoneName} onChange={e => setZoneName(e.target.value)} placeholder="Zone name…" aria-label="New zone name" style={{ flex: 1 }} />
              <Button onClick={addZone}>ADD</Button>
            </div>
            {measuredZones.map((z, i) => (
              <div key={z.name} className="ws-row">
                <Button tone={i === activeZone && tool === 'ZONE' ? 'signal' : 'quiet'} onClick={() => { setActiveZone(i); setTool('ZONE'); }}>
                  {z.name}
                </Button>
                <span className="ws-dim ws-small">{z.tiles.length} tiles · {z.measured} open</span>
              </div>
            ))}

            <span className="ws-dim ws-small" style={{ marginTop: 4 }}>
              The mint. Named like the lore names: function, failure or geology.
            </span>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="Name the plan…" aria-label="Template name" />
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <Chip tone={paperHeld > 0 && inkHeld > 0 ? 'proof' : 'loss'}>{billText(TEMPLATE_MINT_BILL)}</Chip>
              <span className="ws-dim ws-small">held: {paperHeld} paper, {inkHeld} ink</span>
            </div>
            <Button tone="signal" disabled={!name.trim()} onClick={() => void mint()}>MINT TEMPLATE</Button>
            <span className="ws-dim ws-small">
              An invalid plan cannot be minted: the same law that refuses the builder refuses the pen.
            </span>
          </div>
        </div>
      )}

      {tab === 'COPY' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 240px', gap: 10, alignItems: 'start', marginTop: 8 }}>
          <div className="ws-list">
            {templatesHeld.length === 0 && <span className="ws-dim ws-small">No plans in the stash. Draw one, or buy one.</span>}
            {templatesHeld.map(t => (
              <div key={t.id} className="ws-row" style={copySel === t.id ? { background: 'var(--ws-void-2)' } : undefined}>
                <button
                  type="button" className="ws-ui"
                  onClick={() => setCopySel(t.id)}
                  style={{ display: 'flex', gap: 8, alignItems: 'center', flex: 1, minWidth: 0, textAlign: 'left', background: 'transparent', border: 'none', color: 'inherit', cursor: 'pointer', fontFamily: 'var(--ws-mono)', padding: 2 }}
                >
                  <ItemSprite item={t} cellPx={16} />
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</span>
                    <span className="ws-dim ws-small">by {t.templateData.authorName}</span>
                  </span>
                </button>
                <Button
                  tone="proof"
                  disabled={paperHeld < 1 || inkHeld < 1}
                  title={paperHeld < 1 || inkHeld < 1 ? `needs ${billText(TEMPLATE_MINT_BILL)}` : undefined}
                  onClick={() => { setCopySel(t.id); void mintCopy(t.id); }}
                >
                  MINT COPY
                </Button>
              </div>
            ))}
          </div>
          {copySelected
            ? <CardView card={inspectItem(copySelected)} />
            : <span className="ws-dim ws-small">Select a plan to read it. Every copy keeps the original hand.</span>}
        </div>
      )}

      {/* Wave 10E (D21 + D14's hook, kept): scrolls for magic are WRITTEN here,
          paper and ink, like every plan — the table was always meant for this */}
      {tab === 'SCROLLS' && (
        <div className="ws-list" style={{ marginTop: 8 }}>
          {Object.values(SCROLL_DEFINITIONS).map(def => (
            <div key={def.id} className="ws-row">
              <span style={{ minWidth: 0 }}>
                <span style={{ display: 'block' }}>{def.name}</span>
                <span className="ws-dim ws-small">{def.description}</span>
              </span>
              <Button
                tone="proof"
                disabled={paperHeld < 1 || inkHeld < 1}
                title={paperHeld < 1 || inkHeld < 1 ? 'needs 1 paper, 1 ink' : undefined}
                onClick={async () => {
                  const result = await InsuranceSystem.mintScrollAtScribe(def.id);
                  pushFeed(result.ok ? `${def.name} written and signed. It is in your stash.` : result.reason!, result.ok ? 'proof' : 'loss');
                }}
              >
                WRITE (1 PAPER, 1 INK)
              </Button>
            </div>
          ))}
          <span className="ws-dim ws-small">
            A death keeps exactly what the magic names, for exactly as long as the ink holds. The bank honors it.
          </span>
        </div>
      )}

      {/* D85: what this character holds of a world, written down whole */}
      {tab === 'MAPS' && (
        <div className="ws-list" style={{ marginTop: 8 }}>
          {Object.entries(player.survey ?? {}).flatMap(([worldId, sectors]) => {
            const world = worlds.find(w => w.id === worldId);
            if (!world || Object.keys(sectors).length === 0) return [];
            const spread = SurveySystem.mapSpread(sectors);
            const behind = WorldClock.momentAt(world, Date.now()).generation - spread.newest;
            return [(
              <div key={worldId} className="ws-row">
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: 'block' }}>{world.name}</span>
                  <span className="ws-dim ws-small">
                    {spread.sectors} sector{spread.sectors === 1 ? '' : 's'} scanned · {behind > 0 ? `the freshest is ${behind} regeneration(s) old` : 'the freshest is from this regeneration'}
                  </span>
                </span>
                <Button
                  tone="proof"
                  disabled={paperHeld < 1 || inkHeld < 1}
                  title={paperHeld < 1 || inkHeld < 1 ? `needs ${billText(TEMPLATE_MINT_BILL)}` : undefined}
                  onClick={async () => {
                    const result = await MapSystem.write(worldId);
                    pushFeed(result.ok ? `${result.item!.name} written and signed. It is in your stash.` : result.reason!, result.ok ? 'proof' : 'loss');
                  }}
                >
                  WRITE (1 PAPER, 1 INK)
                </Button>
              </div>
            )];
          })}
          {Object.keys(player.survey ?? {}).length === 0 && <span className="ws-dim ws-small">Nothing scanned yet. A map is what you have read of a world, written down.</span>}
          <span className="ws-dim ws-small">
            It holds levels and counts, as old as they were when scanned. Whoever reads it knows what you knew, then.
          </span>
        </div>
      )}
    </Modal>
  );
};

export default TemplateStudio;
