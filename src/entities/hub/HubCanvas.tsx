/**
 * HubCanvas - The City View (Wave 9: the windows moved onto the kit)
 * Players walk a fixed city, talk to its keepers, and reach every service.
 * NO COMBAT. This is the safe zone, and the only warm place.
 */

import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { HubGenerator, IPOI, POIType, HUB_NPCS, INPCDefinition } from './HubGenerator';
import { usePlayerStore } from '../player/store';
import { useHubStore } from './store';
import { useWorldStore } from '../world/store';
import { HUB_TILE_PX, HUB_VIEW_TILES } from './HubCanvas.constants';
import { HUB_GENRE, composeHub, LotState } from '../../render/atoms/hub';
import { Archetype, Facing, WALK_PHASES, castPortrait, figure } from '../../render/atoms/people';
import { ATOM_PX, Sprite, buildPalette } from '../../render/atoms/atoms';
import { DialogueEffect, repairCost, repairItem, runDialogueAction, quickDeployTargetId } from './dialogue';
import { deployToWorld } from '../../logic/systems/Deploy';
import { Button, CardView, Chip, ItemSprite, Kbd, Modal, Panel, SpriteView } from '../../components/ui/kit';
import { useAppView, useFeed } from '../../components/ui/stores';
import { inspectItem } from '../../render/atoms/inspect';
import { LORE_FRAGMENTS } from '../lore/LoreBible';
import { ItemType } from '../../../types';

const TILE_SIZE = HUB_TILE_PX;
const VIEWPORT_TILES = HUB_VIEW_TILES;

function spriteToCanvas(s: Sprite, table: Uint8Array): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = s.w; c.height = s.h;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(s.w, s.h);
  for (let i = 0; i < s.data.length; i++) {
    const v = s.data[i], j = i * 4;
    if (!v) continue;
    img.data[j] = table[v * 3]; img.data[j + 1] = table[v * 3 + 1]; img.data[j + 2] = table[v * 3 + 2]; img.data[j + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/** Cast portraits keep the city's warm ramp — the hub is the only warm place. */
const CastPortrait: React.FC<{ npcId: string }> = ({ npcId }) => {
  const sprite = useMemo(() => castPortrait(npcId), [npcId]);
  const palette = useMemo(() => buildPalette(HUB_GENRE), []);
  return <SpriteView sprite={sprite} palette={palette} scale={2} />;
};

const HUB_WALK_TILES_PER_S = 3.0; // one world, one pace: the same speed as the field

type HubPanel =
  | { kind: 'shop'; category: 'weapon' | 'armor' | 'consumable' }
  | { kind: 'sell' } | { kind: 'repair' } | { kind: 'lore' } | { kind: 'missions' };

export const HubCanvas: React.FC = () => {
  const layout = useMemo(() => HubGenerator.generate(), []);

  const posRef = useRef({ x: (layout.spawnPoint.x + 0.5) * TILE_SIZE, y: (layout.spawnPoint.y + 0.5) * TILE_SIZE });
  const [playerTile, setPlayerTile] = useState(layout.spawnPoint);
  const [nearbyPOI, setNearbyPOI] = useState<IPOI | null>(null);
  const [activeNPC, setActiveNPC] = useState<INPCDefinition | null>(null);
  const [npcReply, setNpcReply] = useState<string | null>(null);
  const [panel, setPanel] = useState<HubPanel | null>(null);

  const { player } = usePlayerStore();
  const { lots } = useHubStore();
  const { refreshWorlds } = useWorldStore();
  const { setView } = useAppView();
  const pushFeed = useFeed(s => s.push);

  const cityRef = useRef<HTMLCanvasElement>(null);
  const keysRef = useRef<Set<string>>(new Set());
  const facingRef = useRef<Facing>('down');
  const stepRef = useRef({ step: 0, at: 0 });
  const movingRef = useRef(false);
  const lastTickRef = useRef(0);
  const nearbyRef = useRef<IPOI | null>(null);
  const busyRef = useRef(false); // a window is open: keys belong to it
  const reducedMotion = useMemo(
    () => typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    []
  );
  nearbyRef.current = nearbyPOI;
  busyRef.current = !!(activeNPC || panel);

  // =========================================================================
  // MOVEMENT: held keys, per-axis sliding against the navmesh
  // =========================================================================

  const blockedAt = useCallback((x: number, y: number) => {
    const tx = Math.floor(x / TILE_SIZE), ty = Math.floor(y / TILE_SIZE);
    return tx < 0 || ty < 0 || tx >= layout.width || ty >= layout.height || !layout.navMesh[ty][tx];
  }, [layout]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (busyRef.current) return; // dialogue and panels take the keyboard
      const key = e.key.toLowerCase();
      if (key === 'e' || key === 'enter') {
        if (nearbyRef.current?.interactable) handleInteract(nearbyRef.current);
        return;
      }
      keysRef.current.add(key);
    };
    const handleKeyUp = (e: KeyboardEvent) => keysRef.current.delete(e.key.toLowerCase());
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // =========================================================================
  // PROXIMITY DETECTION (within 3 tiles of an interactable's center)
  // =========================================================================

  useEffect(() => {
    let closest: IPOI | null = null;
    let closestDist = Infinity;
    for (const zone of layout.zones) {
      for (const poi of zone.pois) {
        if (!poi.interactable) continue;
        const poiCenterX = poi.position.x + poi.size.width / 2;
        const poiCenterY = poi.position.y + poi.size.height / 2;
        const dist = Math.sqrt(
          Math.pow(playerTile.x + 0.5 - poiCenterX, 2) +
          Math.pow(playerTile.y + 0.5 - poiCenterY, 2)
        );
        if (dist < 3 && dist < closestDist) {
          closest = poi;
          closestDist = dist;
        }
      }
    }
    setNearbyPOI(closest);
  }, [playerTile, layout]);

  // =========================================================================
  // INTERACTION
  // =========================================================================

  const handleInteract = (poi: IPOI) => {
    if (poi.npcId && HUB_NPCS[poi.npcId]) {
      keysRef.current.clear();
      setNpcReply(null);
      setActiveNPC(HUB_NPCS[poi.npcId]);
    } else if (poi.type === POIType.PLAYER_LOT) {
      // Until Wave 10 opens the door, the lot points at its working screen.
      setView('HOLDINGS');
    }
  };

  const applyEffect = async (effect: DialogueEffect) => {
    switch (effect.kind) {
      case 'close':
        setActiveNPC(null); setNpcReply(null);
        return;
      case 'reply':
        setNpcReply(effect.text);
        return;
      case 'navigate':
        setActiveNPC(null); setNpcReply(null);
        setView(effect.view);
        return;
      case 'open':
        setActiveNPC(null); setNpcReply(null);
        if (effect.panel === 'shop') setPanel({ kind: 'shop', category: effect.category });
        else if (effect.panel === 'ledger') setView('BANK', 'ledger');
        else if (effect.panel === 'missions') { refreshWorlds(); setPanel({ kind: 'missions' }); }
        else setPanel({ kind: effect.panel });
        return;
      case 'deploy': {
        setActiveNPC(null); setNpcReply(null);
        const target = quickDeployTargetId();
        if (!target) { pushFeed('No walkable reality on the registry.', 'loss'); return; }
        const res = await deployToWorld(target);
        if (!res.ok && res.reason) pushFeed(res.reason, 'loss');
        return;
      }
    }
  };

  // =========================================================================
  // RENDER HELPERS (unchanged from 8B: the city draws itself from real state)
  // =========================================================================

  const currentZone = useMemo(() =>
    HubGenerator.getZoneAtPosition(layout, playerTile.x, playerTile.y),
    [layout, playerTile]
  );

  const lotStates = useMemo(() => {
    const states: Partial<Record<number, LotState>> = {};
    lots.forEach(l => {
      states[l.lotIndex] = !l.ownerId ? 'FOR_SALE' : l.structureType === 'EMPTY' ? 'OWNED_EMPTY' : l.structureType;
    });
    return states;
  }, [lots]);

  const cityBitmaps = useMemo(() => {
    const palette = buildPalette(HUB_GENRE);
    return [0, 1].map(frame => spriteToCanvas(composeHub(layout, { frame, lots: lotStates }), palette));
  }, [layout, lotStates]);

  const cameraOffset = useCallback(() => {
    const viewPx = VIEWPORT_TILES * TILE_SIZE;
    return {
      x: Math.max(0, Math.min(layout.width * TILE_SIZE - viewPx, posRef.current.x - viewPx / 2)),
      y: Math.max(0, Math.min(layout.height * TILE_SIZE - viewPx, posRef.current.y - viewPx / 2))
    };
  }, [layout]);

  // THE WALK LOOP: held keys move the player every frame, the same as the field.
  useEffect(() => {
    const canvas = cityRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const palette = buildPalette(HUB_GENRE);
    const bodies = new Map<string, HTMLCanvasElement>();
    const bodyFor = (facing: Facing, step: number, moving: boolean) => {
      const key = `${facing}:${moving ? step : 'stand'}`;
      let c = bodies.get(key);
      if (!c) {
        c = spriteToCanvas(figure({
          uid: player.id, archetype: (player.archetype || 'OPERATOR') as Archetype, facing, step, moving
        }), palette);
        bodies.set(key, c);
      }
      return c;
    };

    let raf = 0;
    lastTickRef.current = performance.now();
    const loop = (time: number) => {
      const dt = Math.min((time - lastTickRef.current) / 1000, 0.1);
      lastTickRef.current = time;

      const keys = keysRef.current;
      let dx = 0, dy = 0;
      if (keys.has('w') || keys.has('arrowup')) dy -= 1;
      if (keys.has('s') || keys.has('arrowdown')) dy += 1;
      if (keys.has('a') || keys.has('arrowleft')) dx -= 1;
      if (keys.has('d') || keys.has('arrowright')) dx += 1;

      const p = posRef.current;
      if (dx !== 0 || dy !== 0) {
        const len = Math.hypot(dx, dy);
        const step = HUB_WALK_TILES_PER_S * TILE_SIZE * dt;
        const mx = (dx / len) * step, my = (dy / len) * step;
        let nx = p.x + mx;
        if (blockedAt(nx, p.y) && !blockedAt(p.x, p.y)) nx = p.x;
        let ny = p.y + my;
        if (blockedAt(nx, ny) && !blockedAt(nx, p.y)) ny = p.y;
        p.x = nx; p.y = ny;
        facingRef.current = Math.abs(mx) > Math.abs(my) ? (mx > 0 ? 'right' : 'left') : (my > 0 ? 'down' : 'up');
        movingRef.current = true;
        if (time - stepRef.current.at > 560 / WALK_PHASES) {
          stepRef.current = { step: (stepRef.current.step + 1) % WALK_PHASES, at: time };
        }
        const tile = { x: Math.floor(p.x / TILE_SIZE), y: Math.floor(p.y / TILE_SIZE) };
        setPlayerTile(prev => (prev.x === tile.x && prev.y === tile.y ? prev : tile));
      } else if (movingRef.current) {
        movingRef.current = false;
        stepRef.current = { step: 0, at: 0 };
      }

      ctx.imageSmoothingEnabled = false;
      const cam = cameraOffset();
      const ox = Math.round(cam.x / 2) * 2, oy = Math.round(cam.y / 2) * 2; // snap to the atom grid
      ctx.fillStyle = '#050505';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      const frame = reducedMotion ? 0 : Math.floor(time / 500) % 2;
      const city = cityBitmaps[frame];
      ctx.drawImage(city, -ox, -oy, city.width * ATOM_PX, city.height * ATOM_PX);
      const body = bodyFor(facingRef.current, stepRef.current.step, movingRef.current);
      const w = body.width * ATOM_PX, h = body.height * ATOM_PX;
      ctx.drawImage(body, Math.round((p.x - w / 2 - ox) / 2) * 2, Math.round((p.y - h / 2 - oy) / 2) * 2, w, h);
      const poi = nearbyRef.current;
      if (poi) {
        ctx.strokeStyle = '#fafafa';
        ctx.lineWidth = 2;
        ctx.strokeRect(poi.position.x * TILE_SIZE - ox - 1, poi.position.y * TILE_SIZE - oy - 1, poi.size.width * TILE_SIZE + 2, poi.size.height * TILE_SIZE + 2);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [cityBitmaps, player.id, player.archetype, blockedAt, cameraOffset, reducedMotion]);

  const handleCityClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const cam = cameraOffset();
    const tx = Math.floor((e.clientX - box.left + cam.x) / TILE_SIZE);
    const ty = Math.floor((e.clientY - box.top + cam.y) / TILE_SIZE);
    const poi = HubGenerator.getPOIAtPosition(layout, tx, ty);
    if (poi?.interactable) handleInteract(poi);
  };

  // =========================================================================
  // RENDER
  // =========================================================================

  return (
    <div className="ws-ui" style={{ position: 'relative', width: '100%', height: '100%', background: 'var(--ws-void-1)', overflow: 'hidden' }}>

      {/* HUD - Top Left */}
      <div style={{ position: 'absolute', top: 12, left: 12, zIndex: 100, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ display: 'flex', gap: 6 }}>
          <Chip tone="proof">{player.bank.gold.toLocaleString()} G</Chip>
          <Chip tone="signal">{player.username}</Chip>
        </div>
        {currentZone && <span className="ws-dim ws-small">{currentZone.name}</span>}
        <span className="ws-dim ws-small" style={{ fontFamily: 'var(--ws-mono)' }}>{playerTile.x}, {playerTile.y}</span>
      </div>

      {/* Interaction Prompt */}
      {nearbyPOI && !activeNPC && !panel && (
        <div style={{ position: 'absolute', bottom: 90, left: '50%', transform: 'translateX(-50%)', zIndex: 100 }}>
          <Chip tone="signal"><b>{nearbyPOI.name}</b> <Kbd>E</Kbd> INTERACT</Chip>
        </div>
      )}

      {/* Controls Hint */}
      <div style={{ position: 'absolute', bottom: 12, right: 12, zIndex: 100 }} className="ws-dim ws-small">
        <Kbd>WASD</Kbd> move · <Kbd>E</Kbd> interact · <Kbd>~</Kbd> console
      </div>

      {/* THE CITY */}
      <canvas
        ref={cityRef}
        width={VIEWPORT_TILES * TILE_SIZE}
        height={VIEWPORT_TILES * TILE_SIZE}
        onClick={handleCityClick}
        style={{
          position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)',
          border: '1px solid var(--ws-void-4)', imageRendering: 'pixelated', cursor: nearbyPOI ? 'pointer' : 'default'
        }}
      />

      {/* NPC Dialogue */}
      {activeNPC && (
        <Modal title={`${activeNPC.name} — ${activeNPC.title}`} onClose={() => { setActiveNPC(null); setNpcReply(null); }} width={520}>
          <div className="ws-dialogue">
            <div className="ws-dialogue__head">
              <CastPortrait npcId={activeNPC.id} />
              <div className="ws-dialogue__speech">"{npcReply ?? activeNPC.dialogue.greeting}"</div>
            </div>
            <div className="ws-dialogue__options">
              {activeNPC.dialogue.options.map((opt, i) => (
                <Button
                  key={i}
                  tone={opt.action === 'CLOSE' ? 'quiet' : 'signal'}
                  autoFocus={i === 0}
                  onClick={() => void applyEffect(runDialogueAction(opt.action, opt.payload))}
                >
                  {opt.label}
                </Button>
              ))}
            </div>
          </div>
        </Modal>
      )}

      {panel?.kind === 'shop' && <ShopModal category={panel.category} onClose={() => setPanel(null)} />}
      {panel?.kind === 'sell' && <SellModal onClose={() => setPanel(null)} />}
      {panel?.kind === 'repair' && <RepairModal onClose={() => setPanel(null)} />}
      {panel?.kind === 'lore' && <LoreModal onClose={() => setPanel(null)} />}
      {panel?.kind === 'missions' && <MissionsModal onClose={() => setPanel(null)} />}
    </div>
  );
};

// =============================================================================
// SERVICE WINDOWS (Wave 9.7: each one is a working thing, or it is not here)
// =============================================================================

const ShopModal: React.FC<{ category: 'weapon' | 'armor' | 'consumable'; onClose: () => void }> = ({ category, onClose }) => {
  const { weaponShop, armorShop, consumableShop, purchaseFromShop } = useHubStore();
  const { player } = usePlayerStore();
  const pushFeed = useFeed(s => s.push);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const listings = category === 'weapon' ? weaponShop : category === 'armor' ? armorShop : consumableShop;
  const selected = listings.find(l => l.id === selectedId);
  const titles = { weapon: 'IRONFIST ARMS', armor: 'STEELWEAVE PROTECTION', consumable: "THE ALCHEMIST'S CORNER" };

  return (
    <Modal title={titles[category]} onClose={onClose} width={640}>
      <div className="ws-dim ws-small" style={{ marginBottom: 8 }}>Your gold: <span className="ws-proof">{player.bank.gold.toLocaleString()} G</span> · stock turns at midnight</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 240px', gap: 10, alignItems: 'start' }}>
        <div className="ws-list">
          {listings.map(listing => (
            <div key={listing.id} className="ws-row" style={selectedId === listing.id ? { background: 'var(--ws-void-2)' } : undefined}>
              <button
                type="button" className="ws-ui"
                onClick={() => setSelectedId(listing.id)}
                style={{ display: 'flex', gap: 8, alignItems: 'center', flex: 1, minWidth: 0, textAlign: 'left', background: 'transparent', border: 'none', color: 'inherit', cursor: 'pointer', fontFamily: 'var(--ws-mono)', padding: 2 }}
              >
                <ItemSprite item={listing.item} cellPx={16} />
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{listing.item.name}</span>
                  <span className="ws-dim ws-small">stock {listing.stock}</span>
                </span>
              </button>
              <Button
                tone="proof"
                disabled={listing.stock <= 0 || player.bank.gold < listing.price}
                onClick={() => {
                  const item = purchaseFromShop(listing.id, category);
                  if (item) pushFeed(`Bought ${item.name} for ${Math.ceil(listing.price)} G. It is in your stash.`, 'proof');
                }}
              >
                BUY {Math.ceil(listing.price)}G
              </Button>
            </div>
          ))}
        </div>
        {selected
          ? <CardView card={inspectItem(selected.item)} />
          : <Panel title="INSPECT"><span className="ws-dim ws-small">Select a listing to read it.</span></Panel>}
      </div>
    </Modal>
  );
};

const SellModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { player } = usePlayerStore();
  const { sellToVendor } = useHubStore();
  const pushFeed = useFeed(s => s.push);
  const stash = player.bank.stashTabs[0]?.items || [];

  return (
    <Modal title="SELL TO THE COUNTER" onClose={onClose} width={520}>
      <div className="ws-dim ws-small" style={{ marginBottom: 8 }}>
        The counter pays 60% of value, from the hub treasury. A hub with no funds cannot buy.
      </div>
      {stash.length === 0 && <div className="ws-dim ws-small">Your stash is empty.</div>}
      <div className="ws-list">
        {stash.map(item => {
          const offer = Math.max(1, Math.floor((item.value || 1) * 0.6));
          return (
            <div key={item.id} className="ws-row">
              <span style={{ display: 'flex', gap: 8, alignItems: 'center', minWidth: 0 }}>
                <ItemSprite item={item} cellPx={16} />
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</span>
                  <span className="ws-dim ws-small">{item.value}G listed value</span>
                </span>
              </span>
              <Button
                tone="proof"
                onClick={async () => {
                  const paid = await sellToVendor(item.id);
                  if (paid) pushFeed(`Sold ${item.name} for ${paid} G.`, 'proof');
                  else pushFeed('The treasury cannot cover that. Nothing moves.', 'loss');
                }}
              >
                SELL {offer}G
              </Button>
            </div>
          );
        })}
      </div>
    </Modal>
  );
};

const RepairModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { player } = usePlayerStore();
  const pushFeed = useFeed(s => s.push);
  const stash = player.bank.stashTabs[0]?.items || [];
  const worn = stash.filter(i => i.stats?.maxDurability && (i.stats.durability ?? 0) < i.stats.maxDurability);

  return (
    <Modal title="REPAIR — STEELWEAVE" onClose={onClose} width={520}>
      <div className="ws-dim ws-small" style={{ marginBottom: 8 }}>
        A quarter of the item's worth, scaled by the damage. The frame remembers its shape.
      </div>
      {worn.length === 0 && <div className="ws-dim ws-small">Nothing in your stash needs work.</div>}
      <div className="ws-list">
        {worn.map(item => {
          const cost = repairCost(item as any);
          return (
            <div key={item.id} className="ws-row">
              <span style={{ display: 'flex', gap: 8, alignItems: 'center', minWidth: 0 }}>
                <ItemSprite item={item} cellPx={16} />
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</span>
                  <span className="ws-dim ws-small">{item.stats.durability}/{item.stats.maxDurability} durability</span>
                </span>
              </span>
              <Button
                tone="signal"
                disabled={player.bank.gold < cost}
                onClick={() => {
                  const res = repairItem(item.id);
                  pushFeed(res.text, res.ok ? 'signal' : 'loss');
                }}
              >
                REPAIR {cost}G
              </Button>
            </div>
          );
        })}
      </div>
    </Modal>
  );
};

const LoreModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { player } = usePlayerStore();
  const stash = player.bank.stashTabs[0]?.items || [];
  const fragments = stash.filter(i => i.type === ItemType.LORE && i.description);
  const topics = Object.values(player.bank.lore || {});

  return (
    <Modal title="THE STUDY — WHAT THE RUINS SAID" onClose={onClose} width={560}>
      {fragments.length === 0 && topics.length === 0 && (
        <div className="ws-dim ws-small">
          You hold no fragments. They wait in chests in the field, and the best of them read like this:
          <div style={{ fontStyle: 'italic', marginTop: 6, color: 'var(--ws-text-body)' }}>"{LORE_FRAGMENTS[0]}"</div>
        </div>
      )}
      {fragments.map(f => (
        <Panel key={f.id} title={f.name.toUpperCase()} tone="proof" style={{ marginBottom: 8 }}>
          <div className="ws-small" style={{ fontStyle: 'italic' }}>{f.description}</div>
        </Panel>
      ))}
      {topics.length > 0 && (
        <div className="ws-list">
          {topics.map(t => (
            <div key={t.topic} className="ws-row">
              <span>{t.topic}</span>
              <span className="ws-dim ws-small">level {t.level} · studied {new Date(t.dateDiscovered).toLocaleDateString()}</span>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
};

const MissionsModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { availableWorlds } = useWorldStore();
  const pushFeed = useFeed(s => s.push);

  return (
    <Modal title="EXTRACTION ZONES — THE CONDUIT" onClose={onClose} width={560}>
      <div className="ws-list">
        {availableWorlds.map(world => (
          <div key={world.id} className="ws-row">
            <span style={{ minWidth: 0 }}>
              <span style={{ display: 'block' }} className="ws-bright">{world.name.toUpperCase()}</span>
              <span className="ws-dim ws-small">{world.size}×{world.size} sectors · {world.playerCount} agents · difficulty {world.difficulty}</span>
            </span>
            <Button
              tone={world.isDebug ? 'quiet' : 'signal'}
              disabled={world.retired}
              title={world.retired ? 'Surveyed on an older grid. Its record stands, but it can no longer be walked.' : undefined}
              onClick={async () => {
                const res = await deployToWorld(world.id);
                if (!res.ok && res.reason) pushFeed(res.reason, 'loss');
                else onClose();
              }}
            >
              DEPLOY
            </Button>
          </div>
        ))}
      </div>
    </Modal>
  );
};

export default HubCanvas;
