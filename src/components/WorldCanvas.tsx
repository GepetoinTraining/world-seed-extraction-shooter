import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { EquipSlotId, IActiveSession, ItemType } from '../../types';
import { StudySystem } from '../logic/systems/StudySystem';
import { DreamingSystem } from '../entities/world/Dreaming';
import { useWorldStore } from '../entities/world/store';
import { usePlayerStore } from '../entities/player/store';
import { useHubStore } from '../entities/hub/store';
import { WebSystem } from '../logic/systems/WebSystem';
import { ProjectileSystem, PatternType, IProjectile, PROJECTILE_RANGE_PX, SIM_MARGIN_PX } from '../entities/combat/projectileSystem';
import { CombatSystem } from '../entities/combat/CombatSystems';
import { applyKillRewards } from '../entities/combat/killRewards';
import { MobAI } from '../entities/mob/ai/MobAI';
import { InteractionEngine } from '../entities/interaction/InteractionEngine';
import { EntityType, IChunk, ISector, ScanLevel, IWorldEntity } from '../entities/world/types';
import { SessionJournal } from '../logic/journal/SessionJournal';
import { PlayerPersistence } from '../logic/persistence/PlayerPersistence';
import { WorldGenerator } from '../entities/world/WorldGenerator';
import { TILE_PX, quadrantOf } from '../entities/world/grid';
import { FieldRenderer, FieldScene, FieldEffect, MobPose, DEATH_BURST_MS } from '../render/FieldRenderer';
import { genreForWorld, entitySprite, baselinePx } from '../render/atoms/world';
import { ATOM_PX, SIZE_ATOMS, Sprite } from '../render/atoms/atoms';
import { hitTest, targetsFrom, cycleTarget, inspectEntity, inspectItem, Card } from '../render/atoms/inspect';
import { reconCell, RECON_CELL_ATOMS } from '../render/atoms/recon';
import { Archetype, Facing, WALK_PHASES, armorClass, weaponClass } from '../render/atoms/people';
import { MOB_DEFINITIONS } from '../entities/mob/data/mobDefinitions';
import { InventorySystem, GRID_W, GRID_H } from '../entities/player/systems/InventorySystem';
import { LoadoutSystem } from '../entities/player/systems/LoadoutSystem';
import { CartSystem } from '../entities/world/CartSystem';
import { CartOverlay } from '../entities/world/CartOverlay';
import { ItemFactory } from '../entities/item/ItemFactory';
import { Rng } from '../logic/rng/DeterministicRNG';
import { CombatMath } from '../entities/combat/CombatMath';
import { RESOURCE_DEFINITIONS } from '../entities/item/data/resourceDefinitions';
import { GEAR_RECIPES } from '../entities/economy/data/recipeDefinitions';
import { ExitLevy } from '../logic/economy/ExitLevy';
import { ProgressionSystem } from '../entities/player/systems/ProgressionSystem';
import { Bar, Button, CardView, Chip, ItemSprite, Kbd, Panel, RankMark, TERMINAL_PALETTE } from './ui/kit';
import { useFeed, useRankMoment, useReceipt } from './ui/stores';

// --- CONSTANTS ---
const TILE_SIZE = 20; // 1 Unit = 20 Pixels
const PLAYER_SPEED = 3.0; // Tiles per second (a quadrant takes about 5s to cross, a chunk about 21s)
const LOAD_RADIUS_PX = 1000; // Chunks exist this far out, so nothing is built in view
const MAX_DELTA = 0.1; // Clamp frame delta (seconds) so tab-switches don't teleport the player

const feed = (text: string, tone: 'plain' | 'signal' | 'proof' | 'loss' = 'plain') => useFeed.getState().push(text, tone);

/**
 * PACK GRID (Wave 9.4): the 8x6 spatial inventory, drawn in the items' real
 * art at their real footprints. Selection shows the one inspect card.
 */
const CELL = 36;
const PackGrid = ({ session }: { session: IActiveSession }) => {
  const { dropItem, rotateItem, consumeItem, currentWeight, maxWeight, player } = usePlayerStore();
  const [selected, setSelected] = useState<string | null>(null);
  // Wave 10E (D19): the field identify runs on a real clock
  const [identifying, setIdentifying] = useState<{ id: string; until: number } | null>(null);
  // Wave 10E (D21): a chosen charm asks which slot it holds
  const [invoking, setInvoking] = useState<string | null>(null);

  const layout = session.inventoryLayout || {};
  const items = session.inventory;
  const ratio = maxWeight > 0 ? currentWeight / maxWeight : 0;
  const selectedItem = items.find(i => i.id === selected);
  // Wave 10C: equipped items ride the harness, not the pack — nothing here is equipped
  const equippedIds: string[] = [];
  const pouchSlots = player.equipment
    ? LoadoutSystem.availableSlots(player.equipment).filter(s => s.startsWith('POUCH_') && player.equipment!.slots[s])
    : [];

  return (
    <Panel
      title={`PACK — ${InventorySystem.usedCells(items, layout)}/${GRID_W * GRID_H} CELLS`}
      right={
        <span className={ratio > 0.8 ? 'ws-loss' : 'ws-dim'}>
          {currentWeight.toFixed(1)}/{maxWeight}kg{ratio > 0.8 ? ' · SLOWED' : ''}
        </span>
      }
      style={{ pointerEvents: 'auto' }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{ position: 'relative', width: GRID_W * CELL, height: GRID_H * CELL, background: 'var(--ws-void-0)' }}
      >
        {Array.from({ length: GRID_W * GRID_H }, (_, i) => (
          <div key={i} style={{
            position: 'absolute',
            left: (i % GRID_W) * CELL, top: Math.floor(i / GRID_W) * CELL,
            width: CELL, height: CELL,
            border: '1px solid var(--ws-void-3)'
          }} />
        ))}
        {items.map(item => {
          const place = layout[item.id];
          if (!place) return null;
          const { w, h } = InventorySystem.footprint(item, place.rotated);
          const isSel = item.id === selected;
          const isEquipped = equippedIds.includes(item.id);
          return (
            <button
              key={item.id}
              type="button"
              onClick={e => { e.stopPropagation(); setSelected(isSel ? null : item.id); }}
              title={item.isIdentified === false ? 'Unidentified signal' : item.name}
              className="ws-ui"
              style={{
                position: 'absolute',
                left: place.x * CELL + 1, top: place.y * CELL + 1,
                width: w * CELL - 2, height: h * CELL - 2,
                background: 'transparent',
                border: isEquipped ? '2px solid var(--ws-proof-3)' : isSel ? '2px solid var(--ws-signal-3)' : '1px solid transparent',
                padding: 0, cursor: 'pointer', overflow: 'hidden',
                display: 'flex', alignItems: 'center', justifyContent: 'center'
              }}
            >
              <ItemSprite
                item={place.rotated ? { ...item, dimensions: { width: h, height: w } } : item}
                cellPx={CELL - 4}
                style={place.rotated ? { transform: 'rotate(90deg)' } : undefined}
              />
            </button>
          );
        })}
      </div>

      {selectedItem && (
        <div onClick={e => e.stopPropagation()} style={{ marginTop: 8, display: 'flex', gap: 8, alignItems: 'flex-start' }}>
          <div style={{ flex: 1 }}>
            <CardView card={inspectItem(selectedItem, player)} right={<RankMark rank={String(selectedItem.rank)} scale={2} />} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {selectedItem.type === ItemType.CONSUMABLE && !selectedItem.charmData && !selectedItem.scrollData && (
              <Button tone="signal" onClick={() => { consumeItem(selectedItem.id); setSelected(null); }}>USE</Button>
            )}
            {/* Wave 10E (D21): insurance is spent, not eaten — the magic names what it keeps */}
            {(selectedItem.charmData || selectedItem.scrollData) && (
              (selectedItem.charmData ?? selectedItem.scrollData)!.chosen ? (
                invoking === selectedItem.id ? (
                  Object.keys(player.equipment?.slots ?? {}).filter(s => player.equipment!.slots[s as EquipSlotId]).map(slot => (
                    <Button key={slot} tone="proof" onClick={() => {
                      const v = usePlayerStore.getState().useProtection(selectedItem.id, slot as EquipSlotId);
                      setInvoking(null);
                      if (v.ok) setSelected(null);
                    }}>
                      KEEP · {slot.replace('_', ' ')}
                    </Button>
                  ))
                ) : (
                  <Button tone="signal" onClick={() => setInvoking(selectedItem.id)}>INVOKE · CHOOSE A SLOT</Button>
                )
              ) : (
                <Button tone="signal" onClick={() => {
                  const v = usePlayerStore.getState().useProtection(selectedItem.id);
                  if (v.ok) setSelected(null);
                }}>INVOKE</Button>
              )
            )}
            {/* Wave 10E (D19): identify in the field — scoped, ALWAYS timed, faster with skill */}
            {StudySystem.identifyScopeOf(selectedItem) &&
              (selectedItem.isIdentified === false || selectedItem.affixes.some(a => !LoadoutSystem.isAffixStudied(player, a.id))) && (
              identifying?.id === selectedItem.id ? (
                <Button tone="quiet" disabled>IDENTIFYING…</Button>
              ) : (
                <Button tone="signal" onClick={() => {
                  const ask = usePlayerStore.getState().fieldIdentify(selectedItem.id);
                  if (!ask.ok) return;
                  feed(`Identifying ${selectedItem.isIdentified === false ? 'the signal' : selectedItem.name} — ${ask.seconds}s. The eye does the work.`, 'signal');
                  setIdentifying({ id: selectedItem.id, until: Date.now() + ask.seconds! * 1000 });
                  window.setTimeout(() => {
                    usePlayerStore.getState().completeFieldIdentify(selectedItem.id);
                    setIdentifying(cur => (cur?.id === selectedItem.id ? null : cur));
                  }, ask.seconds! * 1000);
                }}>
                  IDENTIFY · {StudySystem.identifySeconds(StudySystem.identifyLevel(player, selectedItem))}s
                </Button>
              )
            )}
            {selectedItem.type === ItemType.LORE && selectedItem.description && (
              <Button tone="proof" onClick={() => feed(`"${selectedItem.description}"`, 'proof')}>READ</Button>
            )}
            {(selectedItem.slot !== 'NONE' || selectedItem.tags?.includes('tool')) && selectedItem.type !== ItemType.CONSUMABLE && !selectedItem.cartData && (
              <Button
                tone="proof"
                onClick={() => {
                  const v = usePlayerStore.getState().equipToSlot(selectedItem.id);
                  if (v.ok) setSelected(null);
                }}
              >
                EQUIP
              </Button>
            )}
            {selectedItem.cartData && (
              <Button tone="proof" onClick={() => { void usePlayerStore.getState().deployCart(selectedItem.id); setSelected(null); }}>
                UNFOLD CART
              </Button>
            )}
            {pouchSlots.map(slot => {
              const pouch = LoadoutSystem.itemIn(player.equipment!, slot)!;
              return (
                <Button
                  key={slot}
                  tone="quiet"
                  title={`${pouch.name}: stacks ${pouch.pouchData?.accepts.join(', ')}`}
                  onClick={() => {
                    const v = usePlayerStore.getState().stowInPouch(slot, selectedItem.id);
                    if (v.ok) setSelected(null);
                  }}
                >
                  STOW · {pouch.name.toUpperCase()}
                </Button>
              );
            })}
            <Button onClick={() => rotateItem(selectedItem.id)}>ROTATE</Button>
            <Button tone="loss" onClick={() => { dropItem(selectedItem.id); setSelected(null); }}>LEAVE BEHIND</Button>
          </div>
        </div>
      )}
      {/* Wave 10D (10D.2): the floor — improvised crafting, right here, no bench */}
      {Object.values(GEAR_RECIPES).filter(r => r.requiredFacility === null).map(recipe => {
        const canPay = recipe.inputs.every(req =>
          items.filter(i => i.universalDefinitionId === req.itemId).length >= req.quantity);
        if (!canPay) return null;
        return (
          <div key={recipe.id} onClick={e => e.stopPropagation()} style={{ marginTop: 6 }}>
            <Button
              tone="quiet"
              title={recipe.description}
              onClick={() => { usePlayerStore.getState().improviseInField(recipe.id); setSelected(null); }}
            >
              IMPROVISE · {recipe.name.toUpperCase()}
            </Button>
          </div>
        );
      })}
      <div className="ws-dim ws-small" style={{ marginTop: 4 }}><Kbd>TAB</Kbd> close</div>
    </Panel>
  );
};

// =============================================================================
// THE CART WINDOW (Wave 10C, D16): the bed's grid, the seal, the theft log
// =============================================================================

const CART_CELL = 24;
const CartWindow: React.FC = () => {
  const { cartWindowId, closeCartWindow, player, loadCart, unloadCart } = usePlayerStore();
  const { currentMap } = useWorldStore();
  const [selected, setSelected] = useState<string | null>(null);
  if (!cartWindowId) return null;
  const entity = Object.values(currentMap?.chunks || {}).flatMap(c => c.entities).find(e => e.id === cartWindowId);
  const cart = entity?.cart;
  if (!cart) return null;
  const session = player.currentSession;
  const mine = cart.ownerId === player.id;
  const lastTheft = cart.theftLog[cart.theftLog.length - 1];

  return (
    <div className="ws-ui ws-overlay" style={{ background: 'rgba(3,3,3,0.7)', zIndex: 500 }} onClick={closeCartWindow}>
      <div onClick={e => e.stopPropagation()}>
        <Panel
          title={`CART BED — ${cart.gridW}×${cart.gridH}`}
          right={<span className={mine ? 'ws-proof' : 'ws-loss'}>{mine ? 'YOUR SEAL' : `${cart.ownerName}'S SEAL`}</span>}
          style={{ width: cart.gridW * CART_CELL + 300, maxWidth: '92vw' }}
        >
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
            <div>
              <div style={{ position: 'relative', width: cart.gridW * CART_CELL, height: cart.gridH * CART_CELL, background: 'var(--ws-void-0)' }}>
                {Array.from({ length: cart.gridW * cart.gridH }, (_, i) => (
                  <div key={i} style={{
                    position: 'absolute',
                    left: (i % cart.gridW) * CART_CELL, top: Math.floor(i / cart.gridW) * CART_CELL,
                    width: CART_CELL, height: CART_CELL,
                    border: '1px solid var(--ws-void-3)'
                  }} />
                ))}
                {cart.items.map(item => {
                  const place = cart.layout[item.id];
                  if (!place) return null;
                  const { w, h } = InventorySystem.footprint(item, place.rotated);
                  return (
                    <button
                      key={item.id}
                      type="button"
                      className="ws-ui"
                      title={item.name}
                      onClick={() => setSelected(item.id === selected ? null : item.id)}
                      style={{
                        position: 'absolute',
                        left: place.x * CART_CELL + 1, top: place.y * CART_CELL + 1,
                        width: w * CART_CELL - 2, height: h * CART_CELL - 2,
                        background: 'transparent',
                        border: item.id === selected ? '2px solid var(--ws-signal-3)' : '1px solid transparent',
                        padding: 0, cursor: 'pointer', overflow: 'hidden',
                        display: 'flex', alignItems: 'center', justifyContent: 'center'
                      }}
                    >
                      <ItemSprite item={item} cellPx={CART_CELL - 4} />
                    </button>
                  );
                })}
              </div>
              <div className="ws-dim ws-small" style={{ marginTop: 4 }}>
                {CartSystem.cartWeight(cart).toFixed(1)} kg aboard · tow pace ×{CartSystem.towSpeedModifier(CartSystem.cartWeight(cart)).toFixed(2)}
              </div>
            </div>

            <div style={{ width: 260, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {selected && (
                <Button tone="signal" onClick={() => { unloadCart(cartWindowId, selected); setSelected(null); }}>
                  TAKE INTO THE PACK
                </Button>
              )}
              <div className="ws-dim ws-small">PACK — click to load the bed</div>
              <div className="ws-list" style={{ maxHeight: 220, overflow: 'auto' }}>
                {(session?.inventory ?? []).map(item => (
                  <div key={item.id} className="ws-row">
                    <span style={{ display: 'flex', gap: 6, alignItems: 'center', minWidth: 0 }}>
                      <ItemSprite item={item} cellPx={14} />
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</span>
                    </span>
                    <Button tone="quiet" onClick={() => loadCart(cartWindowId, item.id)}>LOAD</Button>
                  </div>
                ))}
                {(session?.inventory ?? []).length === 0 && <div className="ws-dim ws-small">The pack is empty.</div>}
              </div>
              {lastTheft && (
                <div className="ws-loss ws-small">
                  THEFT ON RECORD: towed away by {lastTheft.byName}, {new Date(lastTheft.at).toLocaleString()}{lastTheft.signature ? ' — signed' : ''}.
                </div>
              )}
              <div className="ws-dim ws-small">
                The cart stays in the world when you die or extract without it. Anyone may tow it; the act is signed.
              </div>
              <Button onClick={closeCartWindow}>CLOSE</Button>
            </div>
          </div>
        </Panel>
      </div>
    </div>
  );
};

// =============================================================================
// DRONE RECON (Wave 9: the survey is drawn from the atoms, not five hues)
// =============================================================================

const RECON_SCALE = 2;

const ReconOverlay: React.FC<{ onDrop: (x: number, y: number) => void }> = ({ onDrop }) => {
  const { currentMap, scanSector, selectSector, selectedDropZone } = useWorldStore();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const deskRef = useRef<HTMLDivElement>(null);

  const cellPx = RECON_CELL_ATOMS * RECON_SCALE;

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
        seed: currentMap.seed, sx, sy
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
  }, [currentMap, currentMap?.sectors]);

  if (!currentMap) return null;

  const selectedKey = selectedDropZone ? `${selectedDropZone.x},${selectedDropZone.y}` : null;
  const selected = selectedKey ? currentMap.sectors[selectedKey] : null;

  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const sx = Math.floor((e.clientX - box.left) / cellPx);
    const sy = Math.floor((e.clientY - box.top) / cellPx);
    const sector = currentMap.sectors[`${sx},${sy}`];
    if (!sector) return;
    selectSector(sx, sy);
    // Wave 10C (D22): mental stats drive the recon phase — intelligence,
    // perception and focus (framed or raw) deepen each scan. The analyst
    // build earns its keep before the drop.
    const depth = LoadoutSystem.reconEfficiency(usePlayerStore.getState().player.attributes);
    scanSector(sx, sy, depth);
  };

  // Wave 9: recon can be left without dropping — the survey was free, the drop is not.
  const withdraw = () => {
    const st = usePlayerStore.getState();
    st.emergencyJackOut(); // nothing was risked yet; the kit banks back untouched
    useWorldStore.getState().exitWorld();
    void useHubStore.getState().restAndCredit('WITHDREW'); // D30: back at the hub, a rest all the same
    void SessionJournal.abort(PlayerPersistence.persistableJson(usePlayerStore.getState().player));
  };

  // At this scale a list of things is hundreds long, so it groups them and leads with the danger.
  const manifest = (sector: ISector) => {
    const order = ['F', 'E', 'D', 'C', 'B', 'A', 'S', 'SS', 'SSS'];
    const lines = new Map<string, { id: string; rank: string; hostile: boolean; count: number }>();
    sector.entities.forEach(e => {
      const line = lines.get(e.definitionId);
      if (line) line.count++;
      else lines.set(e.definitionId, { id: e.definitionId, rank: e.rank, hostile: !!e.isHostile, count: 1 });
    });
    return [...lines.values()]
      .sort((a, b) => Number(b.hostile) - Number(a.hostile) || order.indexOf(b.rank) - order.indexOf(a.rank) || b.count - a.count)
      .slice(0, 10);
  };

  const entityCounts = (sector: ISector) => {
    const counts: Record<string, number> = {};
    sector.entities.forEach(e => { counts[e.type] = (counts[e.type] || 0) + 1; });
    return counts;
  };

  return (
    <div className="ws-ui" style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 20, background: 'var(--ws-void-0)' }}>
      {/* The survey: true-size cells on a pannable desk */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <Chip tone="signal">DRONE RECON — SELECT DROP ZONE</Chip>
        <div
          ref={deskRef}
          style={{
            border: '1px solid var(--ws-void-4)', lineHeight: 0,
            width: 'min(640px, 62vw)', height: 'min(560px, 66vh)', overflow: 'auto'
          }}
        >
          <div style={{ position: 'relative', width: currentMap.width * cellPx, height: currentMap.height * cellPx }}>
            <canvas
              ref={canvasRef}
              width={currentMap.width * RECON_CELL_ATOMS}
              height={currentMap.height * RECON_CELL_ATOMS}
              onClick={handleClick}
              style={{
                width: currentMap.width * cellPx,
                height: currentMap.height * cellPx,
                imageRendering: 'pixelated',
                cursor: 'pointer',
                display: 'block'
              }}
            />
            {selectedDropZone && (
              <div style={{
                position: 'absolute',
                left: selectedDropZone.x * cellPx - 1,
                top: selectedDropZone.y * cellPx - 1,
                width: cellPx, height: cellPx,
                outline: '2px solid var(--ws-text-bright)',
                pointerEvents: 'none'
              }} />
            )}
          </div>
        </div>
        <span className="ws-dim ws-small">
          Drag the desk to pan the survey. Click a sector to scan it; click again for deeper intel.<br />
          Static is unscanned. The lozenge is an exit; ticks along an edge are contacts.
        </span>
      </div>

      {/* Intel Panel */}
      <Panel title="SECTOR INTEL" right={<Button tone="quiet" onClick={withdraw}>WITHDRAW</Button>} style={{ width: 290 }}>
        {!selected && <span className="ws-dim ws-small">No sector selected. The survey renders only what the drone has recorded.</span>}
        {selected && (
          <div className="ws-list ws-small">
            <div className="ws-row"><span className="ws-dim">COORDS</span><span>{selected.x}, {selected.y}</span></div>
            {selected.scanLevel >= ScanLevel.BASIC && (
              <>
                <div className="ws-row"><span className="ws-dim">BIOME</span><span>{selected.biome}</span></div>
                <div className="ws-row">
                  <span className="ws-dim">THREAT</span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><RankMark rank={String(selected.difficulty)} scale={2} />{selected.difficulty}</span>
                </div>
                {selected.hasExtraction && <div className="ws-row"><span className="ws-dim">EXIT</span><span className="ws-signal">BEACON PRESENT</span></div>}
              </>
            )}
            {selected.scanLevel >= ScanLevel.DETAILED && (
              <>
                <div className="ws-row"><span className="ws-dim">CONTACTS</span><span /></div>
                {Object.entries(entityCounts(selected)).map(([type, count]) => (
                  <div key={type} className="ws-row"><span>{count}× {type}</span><span /></div>
                ))}
                {selected.entities.length === 0 && <div className="ws-row"><span className="ws-dim">Sector clear.</span><span /></div>}
              </>
            )}
            {selected.scanLevel >= ScanLevel.COMPLETE && selected.entities.length > 0 && (
              <>
                <div className="ws-row"><span className="ws-dim">MANIFEST</span><span /></div>
                {manifest(selected).map(line => (
                  <div key={line.id} className="ws-row">
                    <span className={line.hostile ? 'ws-loss' : undefined}>{line.count}× [{line.rank}] {line.id}</span><span />
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
            <div style={{ marginTop: 10 }}>
              <Button tone="signal" primary style={{ width: '100%', textAlign: 'center' }} onClick={() => onDrop(selected.x, selected.y)}>
                CONFIRM DROP
              </Button>
            </div>
          </div>
        )}
      </Panel>
    </div>
  );
};

// =============================================================================
// THE RANK MOMENT (Wave 9.5): a rank-up holds the corner of the screen
// =============================================================================

const RankMomentView: React.FC = () => {
  const { moment, clear } = useRankMoment();
  useEffect(() => {
    if (!moment) return;
    const t = setTimeout(clear, 6000);
    return () => clearTimeout(t);
  }, [moment, clear]);
  if (!moment) return null;
  return (
    <div className="ws-ui ws-overlay" style={{ background: 'rgba(3,3,3,0.6)', zIndex: 900 }} onClick={clear}>
      <Panel tone="signal" style={{ width: 380, textAlign: 'center' }}>
        <div style={{ display: 'flex', justifyContent: 'center', margin: '8px 0' }}>
          <RankMark rank={moment.to} scale={10} />
        </div>
        <div className="ws-signal" style={{ fontSize: 'var(--ws-font-display)', letterSpacing: '0.3em', fontWeight: 700 }}>
          RANK {moment.to}
        </div>
        <div className="ws-dim ws-small" style={{ margin: '4px 0 8px' }}>
          The rank is not a measure of power. It is a measure of how much the world believes in you.
        </div>
        <Chip tone="signal">+{moment.points} ATTRIBUTE POINTS — SPEND THEM IN THE BANK</Chip>
        <div style={{ marginTop: 10 }}>
          <Button tone="quiet" onClick={clear} autoFocus>CONTINUE</Button>
        </div>
      </Panel>
    </div>
  );
};

// =============================================================================
// WORLD CANVAS
// =============================================================================

const OCTANTS = ['E', 'SE', 'S', 'SW', 'W', 'NW', 'N', 'NE'];

export const WorldCanvas: React.FC<{ session: IActiveSession }> = ({ session }) => {
  // Store Hooks
  const { currentMap, reconMode, confirmDrop } = useWorldStore();
  const { performInteraction, processAction, player } = usePlayerStore();

  // Local State
  const [playerPatterns, setPlayerPatterns] = useState<any[]>([]);
  const [enemyPatterns, setEnemyPatterns] = useState<any[]>([]);
  const [activeSwings, setActiveSwings] = useState<any[]>([]);
  const [lootDrops, setLootDrops] = useState<any[]>([]);

  // Interaction Menu State
  const [menuPosition, setMenuPosition] = useState<{ x: number; y: number } | null>(null);
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);
  const [interactionOptions, setInteractionOptions] = useState<any[]>([]);

  // Inspect card (line 29): one target list answers the cursor and the keyboard
  const [inspected, setInspected] = useState<{ id: string; card: Card; x: number; y: number } | null>(null);
  const mouseRef = useRef<{ x: number; y: number } | null>(null);
  const inspectedIdRef = useRef<string | null>(null);
  inspectedIdRef.current = inspected?.id ?? null;
  const lastInspectAt = useRef(0);

  // Refs for Game Loop
  const requestRef = useRef<number>();
  const lastTickRef = useRef<number>(Date.now());
  const keysPressed = useRef<Set<string>>(new Set());
  const canvasRef = useRef<HTMLDivElement>(null);
  const fieldRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<{ seed: string; renderer: FieldRenderer } | null>(null);
  const facingRef = useRef<Facing>('down');
  const stepRef = useRef({ step: 0, at: 0 });
  const movingRef = useRef(false);
  const loadedQuadrantRef = useRef('');

  // Wave 8B: hit flashes, death bursts and the hurt edge; reduced motion holds them still
  const effectsRef = useRef<FieldEffect[]>([]);
  const hurtAtRef = useRef(0);
  const reducedMotionRef = useRef(
    typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );

  // Wave 3.1: pack grid visibility
  const [showPack, setShowPack] = useState(false);

  // Wave 4.1: fire-rate limiter
  const lastShotRef = useRef<number>(0);
  const spentShots = useRef<Map<string, number>>(new Map());

  // Equipped gear resolvers (Wave 10C: the harness is the truth — the three
  // buckets map onto the slot tree for every old caller)
  const getEquipped = (slot: 'mainHand' | 'armor' | 'accessory') => {
    const eq = usePlayerStore.getState().player.equipment;
    if (!eq) return undefined;
    const slotId = slot === 'mainHand' ? 'RIGHT_HAND' : slot === 'armor' ? 'CHEST' : 'TOOL_1';
    return LoadoutSystem.itemIn(eq, slotId);
  };

  // Wave 2.5: extraction channel + regrow sweep timing
  const [channeling, setChanneling] = useState(false);
  const channelRef = useRef<number | null>(null);
  const lastRegrowSweep = useRef<number>(0);
  // Wave 10C (D16): towed-cart follow cadence
  const lastCartSync = useRef<number>(0);

  const CHANNEL_MS = 5000;
  const BEACON_RANGE = 60; // px

  // Completes the extraction: tax, journal seal, banking, save — and the SEAL moment
  const completeExtraction = useCallback(() => {
    const st = usePlayerStore.getState();
    const session = st.player.currentSession;
    if (!session) return;

    const world = useWorldStore.getState();
    const card = world.availableWorlds.find(w => w.id === world.activeWorldId);
    const worldCertUid = world.activeWorldId;
    let haul = session.inventory.filter(i => !session.kitItemIds?.includes(i.id));

    // Wave 10C (D16): towing the cart INTO the beacon banks its bed. The kit
    // folds back to the stash; the cart leaves the world with you, exactly once.
    const towedId = session.towingCartId;
    const towed = towedId
      ? Object.values(world.currentMap?.chunks || {}).flatMap(c => c.entities).find(e => e.id === towedId)
      : undefined;
    let cartHaul: typeof haul = [];
    if (towed?.cart) {
      cartHaul = towed.cart.items;
      const kitBack = {
        ...ItemFactory.createResourceItem({
          id: 'cart_field_t1', name: 'Field Cart (Packed)', weight: 15,
          dimensions: { width: 2, height: 3 }, tags: ['cart', 'heavy']
        } as any, Rng.fromKey(`cartfold:${towed.cart.cartItemId}`)),
        id: towed.cart.cartItemId, // the same cart, folded — never a second one
        type: ItemType.GEAR,
        cartData: { gridW: towed.cart.gridW, gridH: towed.cart.gridH }
      };
      usePlayerStore.setState(s => ({
        player: {
          ...s.player,
          bank: {
            ...s.player.bank,
            stashTabs: s.player.bank.stashTabs.map((tab, idx) => idx === 0 ? { ...tab, items: [...tab.items, kitBack] } : tab)
          }
        }
      }));
      world.removeEntity(towedId!);
      feed(`The cart comes home: ${cartHaul.length} item${cartHaul.length === 1 ? '' : 's'} off its bed, banked with the haul.`, 'proof');
    }

    // Wave 10C: gear equipped FROM the field is haul too — the harness dodges no levy
    const equipment = st.player.equipment;
    const wornNewcomers = (equipment?.items ?? []).filter(i => !session.kitItemIds?.includes(i.id));
    haul = [...haul, ...cartHaul, ...wornNewcomers];

    const haulValue = haul.reduce((s, i) => s + (i.value || 0), 0);
    const rate = card?.extractionTaxRate ?? 0.05;
    const tax = Math.floor(haulValue * rate);
    const startedAt = Date.now();

    SessionJournal.record('EXTRACT', { loot: haul.map(i => i.id), haulValue, rate, tax, cartItemIds: cartHaul.map(i => i.id) });
    // the cart's bed banks straight into the stash (it never fit a pack — that is its point)
    if (cartHaul.length > 0) {
      usePlayerStore.setState(s => ({
        player: {
          ...s.player,
          bank: {
            ...s.player.bank,
            stashTabs: s.player.bank.stashTabs.map((tab, idx) =>
              idx === 0 ? { ...tab, items: [...tab.items, ...cartHaul.map(i => ({ ...i, isIdentified: true }))] } : tab)
          }
        }
      }));
    }
    // every OTHER cart stays in the world, on record
    void usePlayerStore.getState().persistCarts();
    st.emergencyJackOut();
    world.exitWorld();

    // The vault door starts closing now; the signature lands on it when sealed.
    useReceipt.getState().show({
      outcome: 'EXTRACTED', haul, haulValue, tax,
      worldName: card?.name ?? 'UNKNOWN', durationMs: 0, actionCount: 0
    });

    void (async () => {
      // D30: the sealed session is the rest. What was worked at may settle, and the receipt says so.
      const settled = await useHubStore.getState().restAndCredit('SEALED');
      const charged = await ExitLevy.charge(worldCertUid || 'unknown', haulValue, rate);
      if (charged > 0) console.log(`[TAX] Hub levied ${charged}G (${(rate * 100).toFixed(0)}% of ${haulValue}G haul).`);
      // Wave 6.2: everything that made it home gets its story signed
      const { Provenance } = await import('../logic/sovereignty/Provenance');
      await Provenance.recordMany(haul, 'MINT', { origin: 'EXTRACTION', sessionId: session.sessionId, worldCertUid });

      const after = PlayerPersistence.persistableJson(usePlayerStore.getState().player);
      const signed = await SessionJournal.finish('EXTRACTED', after);
      await PlayerPersistence.flush('extract');
      if (useReceipt.getState().receipt?.outcome === 'EXTRACTED') {
        useReceipt.getState().show({
          outcome: 'EXTRACTED', haul, haulValue, tax,
          settled: settled.map(s => WebSystem.nameOf(s.id)),
          worldName: card?.name ?? 'UNKNOWN',
          durationMs: signed?.payload.durationMs ?? (Date.now() - startedAt),
          actionCount: signed?.payload.actionCount ?? 0,
          signature: signed?.signature,
          receipt: signed?.payload
        });
      }
    })();
  }, []);

  // 1. Drop Confirmation: place the agent at the chosen sector, then go live
  const handleConfirmDrop = useCallback((sectorX: number, sectorY: number) => {
    const map = useWorldStore.getState().currentMap;
    if (!map) return;
    // Never into water, rock or on an island with no way out
    const target = WorldGenerator.dropPoint(map, sectorX, sectorY);
    usePlayerStore.setState(state => {
      if (!state.player.currentSession) return state;
      return {
        player: {
          ...state.player,
          currentSession: {
            ...state.player.currentSession,
            position: { x: target.x, y: 0, z: target.z }
          }
        }
      };
    });
    lastTickRef.current = Date.now(); // Fresh delta so the first frame doesn't jump
    SessionJournal.record('DROP', { sectorX, sectorY });
    useWorldStore.getState().loadAround(target.x, target.z, LOAD_RADIUS_PX);
    confirmDrop();

    // Wave 10C (D16): what was left on wheels is still here. The overlay stands
    // the carts back up, building their chunks first if the drop was far away.
    const worldUid = useWorldStore.getState().activeWorldId;
    if (worldUid) {
      void CartOverlay.load(worldUid).then(placed => {
        if (useWorldStore.getState().activeWorldId !== worldUid) return;
        for (const p of placed) {
          useWorldStore.getState().loadAround(p.position.x, p.position.y, 64);
          const fresh = useWorldStore.getState().currentMap;
          if (!fresh) return;
          const exists = Object.values(fresh.chunks).flatMap(c => c.entities).some(e => e.id === p.id);
          if (!exists) {
            useWorldStore.getState().addEntity({
              id: p.id,
              type: EntityType.CART,
              definitionId: 'cart_field',
              position: { ...p.position },
              rank: 'F' as any,
              rarity: 'COMMON' as any,
              isHostile: false,
              cart: { ...p.cart, towedBy: undefined }
            });
          }
        }
        if (placed.length > 0) feed(`${placed.length} cart${placed.length === 1 ? '' : 's'} on record in this world. What was left on wheels is where it was left.`, 'plain');
      });
    }
  }, [confirmDrop]);

  // A world that skips recon still has to set you down somewhere
  const placedRef = useRef(false);
  useEffect(() => {
    const { reconMode: recon, selectedDropZone } = useWorldStore.getState();
    if (!recon && selectedDropZone && !placedRef.current) {
      placedRef.current = true;
      handleConfirmDrop(selectedDropZone.x, selectedDropZone.y);
    }
  }, [handleConfirmDrop]);

  // Shared target list: everything near a point, shaped for the hit test (line 29)
  const targetsNear = useCallback((cx: number, cz: number, reach = 220) => {
    const map = useWorldStore.getState().currentMap;
    if (!map) return { targets: [], near: [] as IWorldEntity[] };
    const near = WorldGenerator.chunkKeysInBox(cx, cz, reach).flatMap(key => map.chunks[key]?.entities ?? []);
    const things = near.map(n => {
      const s = entitySprite(n);
      const h = (s?.h ?? 12) * ATOM_PX;
      // Upright things hang above their feet, so their hit box does too
      const cy = s ? n.position.y + baselinePx(n, s) - h / 2 : n.position.y;
      return { id: n.id, type: n.type, x: n.position.x, y: cy, w: (s?.w ?? 12) * ATOM_PX, h };
    });
    return { targets: targetsFrom(things), near };
  }, []);

  const inspectById = useCallback((id: string | null, near: IWorldEntity[]) => {
    if (!id) { setInspected(cur => (cur ? null : cur)); return; }
    const entity = near.find(n => n.id === id);
    const liveSession = usePlayerStore.getState().player.currentSession;
    if (!entity || !liveSession) { setInspected(cur => (cur ? null : cur)); return; }
    const dist = Math.hypot(entity.position.x - liveSession.position.x, entity.position.y - liveSession.position.z) / TILE_SIZE;
    const card = inspectEntity(entity, {
      player: usePlayerStore.getState().player,
      dist,
      level: WebSystem.knowledgeReader(usePlayerStore.getState().player),
      worldSeed: useWorldStore.getState().currentMap?.seed,
      webVersion: useWorldStore.getState().availableWorlds.find(w => w.id === useWorldStore.getState().activeWorldId)?.webVersion
    });
    const screenX = entity.position.x - liveSession.position.x + window.innerWidth / 2;
    const screenY = entity.position.y - liveSession.position.z + window.innerHeight / 2;
    setInspected({ id, card, x: screenX, y: screenY });
  }, []);

  // 2. Input Handling
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Tab') {
        e.preventDefault();
        setShowPack(prev => !prev);
        return;
      }
      // Q cycles the inspect card through what is near, nearest first (line 29)
      if (e.key.toLowerCase() === 'q') {
        const liveSession = usePlayerStore.getState().player.currentSession;
        if (!liveSession) return;
        const { targets, near } = targetsNear(liveSession.position.x, liveSession.position.z);
        const next = cycleTarget(targets, { x: liveSession.position.x, y: liveSession.position.z }, inspectedIdRef.current, 220);
        inspectById(next, near);
        return;
      }
      if (e.key === 'Escape') setInspected(null);
      // Wave 10C (D17): quick-use — the digits reach the belt, no pack-opening
      if (/^[1-4]$/.test(e.key)) {
        usePlayerStore.getState().quickUse(`POUCH_${e.key}` as any);
        return;
      }
      keysPressed.current.add(e.key.toLowerCase());
    };
    const handleKeyUp = (e: KeyboardEvent) => keysPressed.current.delete(e.key.toLowerCase());
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [targetsNear, inspectById]);

  // 3. THE GAME LOOP
  useEffect(() => {
    if (reconMode || !currentMap) return;

    const gameLoop = (time: number) => {
      const now = Date.now();
      // --- PHYSICS FIX: DELTA TIME (Seconds, clamped) ---
      const prevTick = lastTickRef.current;
      const dt = Math.min((now - prevTick) / 1000, MAX_DELTA);
      lastTickRef.current = now;

      // A. Movement Logic (Time-Based)
      const keys = keysPressed.current;
      let dx = 0, dz = 0;

      if (keys.has('w')) dz -= 1;
      if (keys.has('s')) dz += 1;
      if (keys.has('a')) dx -= 1;
      if (keys.has('d')) dx += 1;

      if (dx !== 0 || dz !== 0) {
        // Normalize so diagonals aren't faster, then scale to pixels
        const len = Math.sqrt(dx * dx + dz * dz);
        const moveStep = PLAYER_SPEED * dt * TILE_SIZE;
        dx = (dx / len) * moveStep;
        dz = (dz / len) * moveStep;

        // Wave 3.2: encumbrance — a heavy pack slows you before the mud does
        const { currentWeight, maxWeight } = usePlayerStore.getState();
        const loadMod = InventorySystem.speedModifier(currentWeight, maxWeight);
        dx *= loadMod;
        dz *= loadMod;

        // Wave 10C (D16): the tow bar costs — the cart's whole load, at your heels
        const towId = usePlayerStore.getState().player.currentSession?.towingCartId;
        if (towId) {
          const towed = Object.values(useWorldStore.getState().currentMap?.chunks || {})
            .flatMap(c => c.entities).find(e => e.id === towId);
          if (towed?.cart) {
            const towMod = CartSystem.towSpeedModifier(CartSystem.cartWeight(towed.cart));
            dx *= towMod;
            dz *= towMod;
          }
        }

        facingRef.current = Math.abs(dx) > Math.abs(dz) ? (dx > 0 ? 'right' : 'left') : (dz > 0 ? 'down' : 'up');
        movingRef.current = true;
        // A full stride is ~560ms whatever the cycle: 4 phases step quicker than 2
        if (now - stepRef.current.at > 560 / WALK_PHASES) {
          stepRef.current = { step: (stepRef.current.step + 1) % WALK_PHASES, at: now };
        }

        // The ground has a say (water and rock block, mud slows), and the world has an edge
        const map = useWorldStore.getState().currentMap;
        usePlayerStore.setState(state => {
          if (!state.player.currentSession) return state;
          const pos = state.player.currentSession.position;
          const next = map
            ? WorldGenerator.resolveMove(map, pos.x, pos.z, dx, dz)
            : { x: pos.x + dx, z: pos.z + dz };
          return {
            player: {
              ...state.player,
              currentSession: {
                ...state.player.currentSession,
                position: { x: next.x, y: 0, z: next.z }
              }
            }
          };
        });
      } else if (movingRef.current) {
        // Stopping returns to the standing frame, cleanly
        movingRef.current = false;
        stepRef.current = { step: 0, at: 0 };
      }

      // Wave 10C (D16): the towed cart follows at your heels — moved a few
      // times a second, never per frame, and across chunk lines for real
      {
        const towedId = usePlayerStore.getState().player.currentSession?.towingCartId;
        if (towedId && now - lastCartSync.current > 250) {
          const pos = usePlayerStore.getState().player.currentSession?.position;
          const map = useWorldStore.getState().currentMap;
          const towed = pos && map
            ? Object.values(map.chunks).flatMap(c => c.entities).find(e => e.id === towedId)
            : undefined;
          if (pos && towed) {
            const trail = { x: pos.x - 28, y: pos.z + 16 };
            if (Math.hypot(towed.position.x - trail.x, towed.position.y - trail.y) > 12) {
              useWorldStore.getState().moveEntity(towedId, trail.x, trail.y);
            }
            lastCartSync.current = now;
          } else if (pos && !towed) {
            // the cart is gone from the world (should not happen): drop the bar
            usePlayerStore.getState().releaseCart();
          }
        }
      }

      // B. Entity & Combat Logic
      const liveSession = usePlayerStore.getState().player.currentSession;
      const liveMap = useWorldStore.getState().currentMap;
      const playerPos = liveSession?.position;
      if (!playerPos || !liveMap) {
        requestRef.current = requestAnimationFrame(gameLoop);
        return;
      }

      // Chunks are built ahead of you, once per quadrant walked
      const walked = `${quadrantOf(playerPos.x)},${quadrantOf(playerPos.z)}`;
      if (walked !== loadedQuadrantRef.current) {
        loadedQuadrantRef.current = walked;
        useWorldStore.getState().loadAround(playerPos.x, playerPos.z, LOAD_RADIUS_PX);
      }

      // Simulate every chunk a projectile fired from here can reach
      const visibleChunks: Record<string, IChunk> = {};
      WorldGenerator.chunkKeysInBox(playerPos.x, playerPos.z, PROJECTILE_RANGE_PX + SIM_MARGIN_PX).forEach(key => {
        if (liveMap.chunks[key]) visibleChunks[key] = liveMap.chunks[key];
      });

      let incomingDamage = 0;
      const isAlive = (p: any) => (now - p.startTime) < 2000;

      // Wave 2.2: REGROW SWEEP (every 2s) — depleted flora comes back
      if (now - lastRegrowSweep.current > 2000) {
        lastRegrowSweep.current = now;
        Object.values(liveMap.chunks).forEach(chunk => {
          chunk.entities.forEach(e => {
            if (e.regrowAt && e.regrowAt <= now && (e.usesRemaining ?? 0) <= 0) {
              const def = RESOURCE_DEFINITIONS[e.definitionId];
              useWorldStore.getState().updateEntity(e.id, { usesRemaining: def?.uses ?? 1, regrowAt: undefined });
              console.log(`[WORLD] ${def?.name || e.definitionId} regrew.`);
            }
          });
        });
      }

      // AI Tick — the map goes along so terrain can refuse an enemy's step
      const aiResult = MobAI.tick(visibleChunks, { x: playerPos.x, y: playerPos.z }, dt, liveMap);
      if (aiResult.spawnedPatterns.length > 0) {
        // MELEE strikes resolve instantly; ranged patterns become projectiles
        aiResult.spawnedPatterns.forEach(p => {
          if (p.type === 'MELEE') {
            const d = Math.hypot(p.origin.x - playerPos.x, p.origin.y - playerPos.z);
            if (d < 50) incomingDamage += p.damage ?? 10; // Wave 4.3: definition damage
          }
        });
        const ranged = aiResult.spawnedPatterns.filter(p => p.type !== 'MELEE');
        if (ranged.length > 0) setEnemyPatterns(prev => [...prev.filter(isAlive), ...ranged]);
      }

      // Projectile positions are recomputed from time every frame, so a shot
      // that has landed must be remembered or it would land again next frame.
      spentShots.current.forEach((firedAt, id) => {
        if (now - firedAt > 2500) spentShots.current.delete(id);
      });

      const playerBullets: IProjectile[] = playerPatterns.filter(isAlive).flatMap(p =>
        ProjectileSystem.liveShots(p, id => `pl_${p.startTime}_${id}`, now, prevTick, spentShots.current));

      const enemyBullets: IProjectile[] = enemyPatterns.filter(isAlive).flatMap(p =>
        ProjectileSystem.liveShots(p, id => `e_${p.shooterId}_${p.startTime}_${id}`, now, prevTick, spentShots.current)
          .map(b => ({ ...b, color: '#ef4444' })));

      const survivingEnemyBullets = enemyBullets.filter(b => {
        if (ProjectileSystem.sweptDistance(b, playerPos.x, playerPos.z) < 15) {
          incomingDamage += b.damage ?? 8; // Wave 4.3: definition damage
          spentShots.current.set(b.id, now);
          return false;
        }
        return true;
      });

      // Collision-check ALL visible chunks (AI only returns the modified ones)
      const combatResult = CombatSystem.tick(playerBullets, { ...visibleChunks, ...aiResult.updatedChunks }, playerPos, liveSession.health, activeSwings);
      const survivingIds = new Set(combatResult.survivingBullets.map(b => b.id));
      playerBullets.forEach(b => {
        if (!survivingIds.has(b.id)) spentShots.current.set(b.id, now);
      });

      // Process Events (Wave 8B effects; Wave 9.5 finally APPLIES the kill XP)
      combatResult.events.forEach(event => {
        if (event.type === 'ACTION_LOG' && event.actionContext) {
            processAction(event.actionContext);
        } else if ((event.type === 'HIT' || event.type === 'KILL') && event.position) {
          const def = event.definitionId ? MOB_DEFINITIONS[event.definitionId] : undefined;
          const size = (SIZE_ATOMS[def?.size || 'MEDIUM'] ?? 14) * ATOM_PX;
          effectsRef.current.push({
            kind: event.type === 'HIT' ? 'hit' : 'death',
            x: event.position.x, y: event.position.y, at: now, size
          });
          if (event.type === 'HIT' && event.entityId) MobAI.provoke(event.entityId); // what ignored you stops ignoring you
          if (event.type === 'KILL' && event.xpReward) {
            feed(`${def?.name ?? 'Contact'} down. +${event.xpReward.amount} XP`, 'signal');
          }
        }
      });
      const rewards = applyKillRewards(combatResult.events);
      if (rewards.rankUp) {
        useRankMoment.getState().show({ from: rewards.rankUp.from, to: rewards.rankUp.to, points: rewards.rankUp.points, at: now });
      }
      if (effectsRef.current.length > 0) {
        effectsRef.current = effectsRef.current.filter(f => now - f.at < DEATH_BURST_MS + 100);
      }

      // Persist mob movement/deaths back into the world
      const chunkUpdates = { ...aiResult.updatedChunks, ...combatResult.updatedChunks };
      if (Object.keys(chunkUpdates).length > 0) {
        useWorldStore.setState(state => state.currentMap
          ? { currentMap: { ...state.currentMap, chunks: { ...state.currentMap.chunks, ...chunkUpdates } } }
          : state);
      }

      // Loot: spawn new drops, then auto-pickup anything within reach
      let drops = lootDrops;
      if (combatResult.spawnedLoot.length > 0) {
          drops = [...drops, ...combatResult.spawnedLoot.map(l => ({ id: crypto.randomUUID(), position: l.position, items: l.items }))];
      }
      if (drops.length > 0) {
        // Wave 3.2: pickup passes through the caps; what doesn't fit stays on
        // the ground (cooldown so it isn't retried every frame)
        const eligible = drops.filter((d: any) => !d.blockedUntil || d.blockedUntil <= now);
        const blocked = drops.filter((d: any) => d.blockedUntil && d.blockedUntil > now);
        const { pickedUp, remainingDrops } = CombatSystem.checkLootPickup(playerPos, eligible, 30);
        let finalDrops = [...blocked, ...remainingDrops];

        if (pickedUp.length > 0) {
          const { added, rejected } = usePlayerStore.getState().tryAddItems(pickedUp);
          if (added.length > 0) {
            feed(`Recovered ${added.length === 1 ? added[0].name : `${added.length} items`}.`, 'proof');
            SessionJournal.record('LOOT', { itemIds: added.map((i: any) => i.id) });
          }
          if (rejected.length > 0) {
            feed(`The pack refuses ${rejected.length} item${rejected.length === 1 ? '' : 's'} — space or weight.`, 'loss');
            finalDrops = [...finalDrops, {
              id: crypto.randomUUID(),
              position: { x: playerPos.x, y: playerPos.z },
              items: rejected,
              blockedUntil: now + 4000
            }];
          }
        }
        if (pickedUp.length > 0 || drops !== lootDrops) setLootDrops(finalDrops);
      }

      // Apply damage to the agent (Wave 4.1: armor mitigates, and wears)
      const rawDamage = incomingDamage + combatResult.playerDamage;
      const armor = getEquipped('armor');
      const totalDamage = rawDamage > 0 ? CombatMath.applyMitigation(rawDamage, armor) : 0;
      if (totalDamage > 0) {
        if (armor) usePlayerStore.getState().wearEquipment('armor', 1);
        const newHealth = Math.max(0, liveSession.health - totalDamage);
        usePlayerStore.setState(state => state.player.currentSession
          ? { player: { ...state.player, currentSession: { ...state.player.currentSession, health: newHealth } } }
          : state);

        SessionJournal.record('DAMAGE', { amount: totalDamage, health: newHealth });
        hurtAtRef.current = now; // the screen edge answers the blow

        // Wave 2.5: taking damage interrupts the extraction channel
        if (channelRef.current) {
          channelRef.current = null;
          setChanneling(false);
          feed('CHANNEL BROKEN. The exit does not argue with damage.', 'loss');
        }

        if (newHealth <= 0) {
          // FLATLINED: the world cert's death penalty applies (Wave 4.4)
          const w = useWorldStore.getState();
          const card = w.availableWorlds.find(c => c.id === w.activeWorldId);
          const penalty = card?.deathPenalty ?? 'INVENTORY_LOSS';
          console.warn(`[SESSION] Agent flatlined. Penalty: ${penalty}.`);
          SessionJournal.record('DEATH', { penalty });

          // Wave 10C (D16): the cart stays in the world, standing where it was
          void usePlayerStore.getState().persistCarts();

          // The DIED receipt (Wave 9.6 + D21): what fell is lost — and the
          // death keeps EXACTLY the slots the magic named, said on the receipt
          const outcome = usePlayerStore.getState().emergencyJackOut(penalty);
          const lost = outcome.lost;
          const lostValue = lost.reduce((s, i) => s + (i.value || 0), 0);

          useWorldStore.getState().exitWorld();
          void useHubStore.getState().restAndCredit('DIED'); // D30: the return to the hub
          useReceipt.getState().show({
            outcome: 'DIED', haul: lost, haulValue: lostValue, tax: 0, kept: outcome.kept,
            worldName: card?.name ?? 'UNKNOWN', durationMs: 0, actionCount: 0
          });
          // Seal the journal and the bank (async; loop is already stopped)
          const after = PlayerPersistence.persistableJson(usePlayerStore.getState().player);
          void SessionJournal.finish('DIED', after).then(signed => {
            if (useReceipt.getState().receipt?.outcome === 'DIED') {
              useReceipt.getState().show({
                outcome: 'DIED', haul: lost, haulValue: lostValue, tax: 0, kept: outcome.kept,
                worldName: card?.name ?? 'UNKNOWN',
                durationMs: signed?.payload.durationMs ?? 0,
                actionCount: signed?.payload.actionCount ?? 0,
                signature: signed?.signature,
                receipt: signed?.payload
              });
            }
            return PlayerPersistence.flush('death');
          });
          return; // Stop the loop; component unmounts
        }
      }

      // Wave 2.5: channel completion
      if (channelRef.current && now - channelRef.current >= CHANNEL_MS) {
        channelRef.current = null;
        setChanneling(false);
        completeExtraction();
        return; // Extraction unmounts the canvas
      }

      // The inspect card follows the cursor (line 29), re-tested a few times a second;
      // a card pinned by Q keeps tracking its target and clears when it is gone.
      if (now - lastInspectAt.current > 120 && !menuPosition) {
        lastInspectAt.current = now;
        if (mouseRef.current) {
          const worldX = playerPos.x + (mouseRef.current.x - window.innerWidth / 2);
          const worldZ = playerPos.z + (mouseRef.current.y - window.innerHeight / 2);
          const { targets, near } = targetsNear(worldX, worldZ, 160);
          const hit = hitTest(targets, worldX, worldZ, inspectedIdRef.current);
          inspectById(hit, near);
        } else if (inspectedIdRef.current) {
          const { near } = targetsNear(playerPos.x, playerPos.z, 300);
          inspectById(near.some(n => n.id === inspectedIdRef.current) ? inspectedIdRef.current : null, near);
        }
      }

      const canvas = fieldRef.current;
      const ctx = canvas?.getContext('2d');
      if (canvas && ctx) {
        if (canvas.width !== window.innerWidth || canvas.height !== window.innerHeight) {
          canvas.width = window.innerWidth;
          canvas.height = window.innerHeight;
        }
        if (rendererRef.current?.seed !== liveMap.seed) {
          rendererRef.current = { seed: liveMap.seed, renderer: new FieldRenderer(liveMap, genreForWorld(liveMap.seed)) };
        }
        const me = usePlayerStore.getState().player;
        const held = getEquipped('mainHand');
        const worn = getEquipped('armor');
        const sceneChunks = WorldGenerator.chunkKeysInBox(playerPos.x, playerPos.z, Math.max(canvas.width, canvas.height) / 2 + 100)
          .map(key => liveMap.chunks[key]).filter(Boolean);
        // Each enemy in view carries its AI's facing and a two-frame step
        const mobPoses: Record<string, MobPose> = {};
        const mobFrame = reducedMotionRef.current ? 0 : Math.floor(now / 240) % 2;
        sceneChunks.forEach(chunk => chunk.entities.forEach(e => {
          if (e.type !== EntityType.MOB) return;
          const pose = MobAI.pose(e.id);
          if (pose) mobPoses[e.id] = { facing: pose.facing, frame: pose.moving ? mobFrame : 0 };
        }));
        const scene: FieldScene = {
          camera: { x: playerPos.x, z: playerPos.z },
          player: {
            uid: me.id, archetype: (me.archetype || 'OPERATOR') as Archetype, facing: facingRef.current,
            step: stepRef.current.step, moving: movingRef.current,
            weapon: held ? weaponClass(held.tags || []) : undefined,
            armor: worn ? armorClass(worn.tags || []) : undefined
          },
          chunks: sceneChunks,
          mobPoses,
          effects: effectsRef.current,
          hurtAt: hurtAtRef.current,
          now,
          reducedMotion: reducedMotionRef.current,
          bullets: [
            ...combatResult.survivingBullets.map(b => ({ x: b.x, y: b.y, hostile: false })),
            ...survivingEnemyBullets.map(b => ({ x: b.x, y: b.y, hostile: true }))
          ],
          drops: drops.map((d: any) => d.position),
          swings: activeSwings.filter(s => now - s.startTime < 200).map(s => ({ x: s.origin.x, y: s.origin.y, angle: s.angle, range: s.range }))
        };
        rendererRef.current.renderer.draw(ctx, canvas.width, canvas.height, scene);
        rendererRef.current.renderer.prewarm(playerPos.x, playerPos.z, Math.max(canvas.width, canvas.height) / 2 + 320);
      }

      requestRef.current = requestAnimationFrame(gameLoop);
    };

    requestRef.current = requestAnimationFrame(gameLoop);
    return () => { if (requestRef.current) cancelAnimationFrame(requestRef.current); };
  }, [reconMode, currentMap, playerPatterns, enemyPatterns, activeSwings, lootDrops, completeExtraction, menuPosition, targetsNear, inspectById]);

  // 4. Interaction Handler
  const handleEntityClick = (e: React.MouseEvent, entity: IWorldEntity) => {
    e.stopPropagation();
    e.preventDefault();

    // Clicking an enemy aims at it, same as clicking the ground beside it
    if (entity.type === EntityType.MOB) {
      handleCanvasClick(e);
      return;
    }

    const playerPos = usePlayerStore.getState().player.currentSession?.position;
    if (!playerPos) return;

    // Calculate Distance
    const dx = entity.position.x - playerPos.x;
    const dy = entity.position.y - playerPos.z;
    const dist = Math.sqrt(dx*dx + dy*dy) / 20; // Convert to meters approx

    // Ask Interaction Engine
    const options = InteractionEngine.getAvailableInteractions(player, entity, dist);

    if (options.length > 0) {
      setInteractionOptions(options);
      setSelectedEntityId(entity.id);
      setMenuPosition({ x: e.clientX, y: e.clientY });
    } else {
      // The refusal is explained, not swallowed (Wave 9.6): the card says why
      const { near } = targetsNear(entity.position.x, entity.position.y, 60);
      inspectById(entity.id, near.length ? near : [entity]);
      const card = inspectEntity(entity, {
        player: usePlayerStore.getState().player, dist,
        level: WebSystem.knowledgeReader(usePlayerStore.getState().player),
      worldSeed: useWorldStore.getState().currentMap?.seed,
      webVersion: useWorldStore.getState().availableWorlds.find(w => w.id === useWorldStore.getState().activeWorldId)?.webVersion
      });
      feed(card.needs[0] ? `${card.title}: ${card.needs[0]}` : `${card.title}: nothing to be done here.`, 'loss');
    }
  };

  const handleActionSelect = (option: any) => {
    if (selectedEntityId) {
      performInteraction(option.id, selectedEntityId);
    }
    setMenuPosition(null);
  };

  // Click a thing to act on it; click anywhere else to ATTACK toward the cursor (the weapon decides how)
  const handleCanvasClick = (e: React.MouseEvent) => {
    if (menuPosition) {
      setMenuPosition(null); // First click just closes the menu
      return;
    }
    const st = usePlayerStore.getState();
    const playerPos = st.player.currentSession?.position;
    if (!playerPos) return;

    const map = useWorldStore.getState().currentMap;
    if (map && e.target === fieldRef.current) {
      const clickX = playerPos.x + (e.clientX - window.innerWidth / 2);
      const clickZ = playerPos.z + (e.clientY - window.innerHeight / 2);
      const { targets, near } = targetsNear(clickX, clickZ, 60);
      const hit = hitTest(targets, clickX, clickZ);
      const entity = hit ? near.find(n => n.id === hit) : undefined;
      if (entity && entity.type !== EntityType.MOB) {
        handleEntityClick(e, entity);
        return;
      }
    }

    const weapon = getEquipped('mainHand');
    const now = Date.now();

    // Fire-rate from attack_speed
    if (now - lastShotRef.current < CombatMath.fireCooldownMs(weapon)) return;

    // Screen -> World: the viewport keeps the player centered
    const worldX = playerPos.x + (e.clientX - window.innerWidth / 2);
    const worldZ = playerPos.z + (e.clientY - window.innerHeight / 2);
    const angle = Math.atan2(worldZ - playerPos.z, worldX - playerPos.x);
    const damage = CombatMath.weaponDamage(weapon);

    if (CombatMath.isMelee(weapon)) {
      // Swing: a short arc resolved by CombatSystem
      setActiveSwings(prev => [
        ...prev.filter(s => now - s.startTime < 300),
        { origin: { x: playerPos.x, y: playerPos.z }, angle, range: 60, startTime: now, damage }
      ]);
    } else if (CombatMath.isFocus(weapon)) {
      // Focus: a NOVA burst, paid in energy
      const energyCost = 10;
      if ((st.player.currentSession?.energy || 0) < energyCost) {
        feed('Not enough energy to cast. The focus hums and refuses.', 'loss');
        return;
      }
      usePlayerStore.setState(s => s.player.currentSession ? ({
        player: { ...s.player, currentSession: { ...s.player.currentSession, energy: s.player.currentSession.energy - energyCost } }
      }) : s);
      setPlayerPatterns(prev => [
        ...prev.filter(p => now - p.startTime < 2000),
        { type: PatternType.NOVA, origin: { x: playerPos.x, y: playerPos.z }, startTime: now, angle, damage }
      ]);
    } else {
      // Ranged (or unarmed): a single shot
      setPlayerPatterns(prev => [
        ...prev.filter(p => now - p.startTime < 2000),
        { type: PatternType.SINGLE, origin: { x: playerPos.x, y: playerPos.z }, startTime: now, angle, damage }
      ]);
    }

    lastShotRef.current = now;
    if (weapon) st.wearEquipment('mainHand', 1); // durability: every use costs
  };

  // 5. Render
  if (!currentMap) {
    return (
      <div className="ws-ui" style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span className="ws-dim">Rendering the survey…</span>
      </div>
    );
  }

  // RECON MODE: satellite view for drop zone selection
  if (reconMode) {
    return <ReconOverlay onDrop={handleConfirmDrop} />;
  }

  const playerPos = session.position;

  // Wave 2.5 + 9.6: distance AND direction to the nearest extraction beacon
  const exit = WorldGenerator.nearestExit(currentMap, playerPos.x, playerPos.z);
  const beaconDist = exit?.distance ?? Infinity;
  const nearBeacon = beaconDist < BEACON_RANGE;
  const exitAngle = exit ? Math.atan2(exit.y - playerPos.z, exit.x - playerPos.x) : 0;
  const exitOctant = exit ? OCTANTS[((Math.round(exitAngle / (Math.PI / 4)) % 8) + 8) % 8] : '';

  const rank = ProgressionSystem.rankFromXp(usePlayerStore.getState().player.rankXp ?? 0);
  const loadRatio = usePlayerStore.getState().maxWeight > 0
    ? usePlayerStore.getState().currentWeight / usePlayerStore.getState().maxWeight : 0;

  return (
    <div
      ref={canvasRef}
      className="full-size ws-ui"
      style={{ overflow: 'hidden', background: 'var(--ws-void-1)', position: 'relative', cursor: 'crosshair' }}
      onContextMenu={(e) => { e.preventDefault(); setMenuPosition(null); }}
      onClick={handleCanvasClick}
      onMouseMove={e => { mouseRef.current = { x: e.clientX, y: e.clientY }; }}
      onMouseLeave={() => { mouseRef.current = null; }}
    >
      {/* The whole field, drawn each frame by the game loop */}
      <canvas ref={fieldRef} style={{ position: 'absolute', top: 0, left: 0, imageRendering: 'pixelated' }} />

      {/* Extraction Control (Wave 2.5): the beacon is a place, not a button */}
      <div style={{ position: 'absolute', top: 16, right: 16, zIndex: 100 }} onClick={e => e.stopPropagation()}>
        {channeling ? (
          <Panel tone="signal" style={{ pointerEvents: 'auto' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span className="ws-signal">CHANNELING… HOLD POSITION</span>
              <Button tone="loss" onClick={() => { channelRef.current = null; setChanneling(false); }}>ABORT</Button>
            </div>
            <div className="ws-dim ws-small" style={{ marginTop: 4 }}>Damage breaks the channel. Five seconds of stillness buy the way home.</div>
          </Panel>
        ) : nearBeacon ? (
          <Button
            tone="proof" primary
            onClick={() => {
              channelRef.current = Date.now();
              setChanneling(true);
              feed('Channel opened. Five seconds. Don\'t get hit.', 'signal');
            }}
          >
            EXTRACT (5s)
          </Button>
        ) : (
          <Chip title="Distance and heading to the nearest exit beacon">
            {beaconDist === Infinity ? 'BEACON: NONE RECORDED' : (
              <>
                <span
                  aria-hidden
                  style={{ display: 'inline-block', transform: `rotate(${Math.round((exitAngle * 180) / Math.PI) + 90}deg)`, color: 'var(--ws-signal-3)' }}
                >
                  ▲
                </span>
                BEACON {Math.round(beaconDist / TILE_PX)}m {exitOctant}
              </>
            )}
          </Chip>
        )}
      </div>

      {/* Vitals HUD (Wave 9.2: bars, rank and load — the exposure is the point) */}
      <div style={{ position: 'absolute', top: 16, left: 16, zIndex: 100, width: 240, pointerEvents: 'none', display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <Chip tone="signal">ACTIVE AGENT</Chip>
          <Chip title={`Rank ${rank}`}><RankMark rank={rank} scale={2} />{rank}</Chip>
        </div>
        <Bar label="VITALS" value={session.health} max={session.maxHealth} tone={session.health / session.maxHealth > 0.3 ? 'signal' : 'loss'} />
        <Bar label="ENERGY" value={session.energy} max={50 + (player.attributes.endurance * 5)} tone="proof" text={`${Math.floor(session.energy)}`} />
        <Bar label="LOAD" value={Math.round(loadRatio * 100)} max={100} tone={loadRatio > 0.8 ? 'loss' : 'signal'} text={loadRatio > 0.8 ? 'SLOWED' : `${Math.round(loadRatio * 100)}%`} />
        <span className="ws-dim ws-small">
          POS {Math.floor(playerPos.x)}, {Math.floor(playerPos.z)} · PACK {session.inventory.length} · <Kbd>TAB</Kbd> pack · <Kbd>Q</Kbd> inspect · click to fire
        </span>
        {session.towingCartId && (
          <Chip tone="proof" title="The tow bar is in your hand; your pace pays for the load">TOWING</Chip>
        )}
        {/* Wave 10C (D17): the belt — what rides it, quick to use, keys 1–4 */}
        {(() => {
          const eq = usePlayerStore.getState().player.equipment;
          if (!eq) return null;
          const worn = LoadoutSystem.availableSlots(eq)
            .filter(s => s.startsWith('POUCH_') && eq.slots[s])
            .map(s => ({ slot: s, pouch: LoadoutSystem.itemIn(eq, s)! }));
          if (worn.length === 0) return null;
          return (
            <div style={{ display: 'flex', gap: 4, pointerEvents: 'auto' }}>
              {worn.map(({ slot, pouch }) => (
                <Button
                  key={slot}
                  tone="quiet"
                  title={`${pouch.name} — stacks ${pouch.pouchData?.accepts.join(', ')} · press ${slot.split('_')[1]}`}
                  onClick={e => { e.stopPropagation(); usePlayerStore.getState().quickUse(slot as any); }}
                >
                  <Kbd>{slot.split('_')[1]}</Kbd> {pouch.name.toUpperCase()} ×{pouch.pouchData?.contents.length ?? 0}
                </Button>
              ))}
            </div>
          );
        })()}
      </div>

      {/* Pack Grid (Wave 3.1 / 9.4) */}
      {showPack && (
        <div style={{ position: 'absolute', bottom: 20, left: 20, zIndex: 150 }} onClick={e => e.stopPropagation()}>
          <PackGrid session={session} />
        </div>
      )}

      {/* The one inspect card (line 29): hover, or Q to cycle */}
      {inspected && !menuPosition && (
        <div
          style={{
            position: 'absolute',
            left: Math.min(window.innerWidth - 320, Math.max(8, inspected.x + 18)),
            top: Math.min(window.innerHeight - 200, Math.max(8, inspected.y - 10)),
            zIndex: 180, pointerEvents: 'none'
          }}
        >
          <CardView card={inspected.card} />
        </div>
      )}

      {/* Interaction Menu — words, not icons (Wave 9.7) */}
      {menuPosition && (
        <div
          onClick={e => e.stopPropagation()}
          style={{ position: 'absolute', left: menuPosition.x, top: menuPosition.y, zIndex: 200 }}
        >
          <Panel style={{ pointerEvents: 'auto' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {interactionOptions.map((opt) => (
                <Button
                  key={opt.id}
                  tone="signal"
                  onClick={(e) => { e.stopPropagation(); handleActionSelect(opt); }}
                >
                  {opt.label} · {opt.energyCost > 0 ? `${opt.energyCost} energy` : 'free'}{opt.timeCostSeconds ? ` · ${opt.timeCostSeconds}s` : ''}
                </Button>
              ))}
            </div>
          </Panel>
        </div>
      )}

      <CartWindow />
      <RankMomentView />
    </div>
  );
};
