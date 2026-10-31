import React, { useEffect, useRef, useState, useCallback } from 'react';
import { IActiveSession, IItem } from '../../types';
import { useWorldStore } from '../entities/world/store';
import { usePlayerStore } from '../entities/player/store';
import { ProjectileSystem, PatternType, IProjectile, PROJECTILE_RANGE_PX, SIM_MARGIN_PX } from '../entities/combat/projectileSystem';
import { CombatSystem } from '../entities/combat/CombatSystems';
import { MobAI } from '../entities/mob/ai/MobAI';
import { InteractionEngine } from '../entities/interaction/InteractionEngine';
import { EntityType, IChunk, ISector, ScanLevel, IWorldEntity, BiomeType } from '../entities/world/types';
import { Center, Loader, Menu, Text, Badge, ActionIcon, Group, Paper, Button, Stack } from '@mantine/core';
import { SessionJournal } from '../logic/journal/SessionJournal';
import { PlayerPersistence } from '../logic/persistence/PlayerPersistence';
import { WorldGenerator } from '../entities/world/WorldGenerator';
import { TILE_PX, chunkOf, quadrantOf, sectorOf } from '../entities/world/grid';
import { FieldRenderer, FieldScene, FieldEffect, MobPose, DEATH_BURST_MS } from '../render/FieldRenderer';
import { genreForWorld, entitySprite, baselinePx } from '../render/atoms/world';
import { ATOM_PX, SIZE_ATOMS } from '../render/atoms/atoms';
import { hitTest, targetsFrom } from '../render/atoms/inspect';
import { Archetype, Facing, WALK_PHASES, armorClass, weaponClass } from '../render/atoms/people';
import { MOB_DEFINITIONS } from '../entities/mob/data/mobDefinitions';
import { InventorySystem, GRID_W, GRID_H } from '../entities/player/systems/InventorySystem';
import { CombatMath } from '../entities/combat/CombatMath';
import { RESOURCE_DEFINITIONS } from '../entities/item/data/resourceDefinitions';
import { ExitLevy } from '../logic/economy/ExitLevy';

// --- CONSTANTS ---
const TILE_SIZE = 20; // 1 Unit = 20 Pixels
const PLAYER_SPEED = 3.0; // Tiles per second (a quadrant takes about 5s to cross, a chunk about 21s)
const LOAD_RADIUS_PX = 1000; // Chunks exist this far out, so nothing is built in view
const MAX_DELTA = 0.1; // Clamp frame delta (seconds) so tab-switches don't teleport the player

/**
 * PACK GRID (Wave 3.1): the 8x6 spatial inventory. Pure render over the
 * store's layout; selection offers Rotate and Leave Behind.
 */
const CELL = 36;
const PackGrid = ({ session }: { session: IActiveSession }) => {
  const { dropItem, rotateItem, equipItem, consumeItem, currentWeight, maxWeight } = usePlayerStore();
  const [selected, setSelected] = useState<string | null>(null);

  const layout = session.inventoryLayout || {};
  const items = session.inventory;
  const ratio = maxWeight > 0 ? currentWeight / maxWeight : 0;
  const selectedItem = items.find(i => i.id === selected);
  const equippedIds = Object.values(session.equipped || {});

  return (
    <Paper
      p="sm" bg="dark.8"
      style={{ border: '1px solid var(--mantine-color-dark-4)', pointerEvents: 'auto' }}
      onClick={(e) => e.stopPropagation()}
    >
      <Group justify="space-between" mb={6}>
        <Text size="xs" fw={700} c="emerald">PACK ({InventorySystem.usedCells(items, layout)}/{GRID_W * GRID_H} cells)</Text>
        <Text size="xs" c={ratio > 0.8 ? 'red' : 'dimmed'} ff="monospace">
          {currentWeight.toFixed(1)}/{maxWeight}kg{ratio > 0.8 ? ' · SLOWED' : ''}
        </Text>
      </Group>

      <div style={{ position: 'relative', width: GRID_W * CELL, height: GRID_H * CELL, background: '#0a0a0a' }}>
        {/* cell lines */}
        {Array.from({ length: GRID_W * GRID_H }, (_, i) => (
          <div key={i} style={{
            position: 'absolute',
            left: (i % GRID_W) * CELL, top: Math.floor(i / GRID_W) * CELL,
            width: CELL, height: CELL,
            border: '1px solid #1f1f1f'
          }} />
        ))}
        {/* items */}
        {items.map(item => {
          const place = layout[item.id];
          if (!place) return null;
          const { w, h } = InventorySystem.footprint(item, place.rotated);
          const isSel = item.id === selected;
          const isEquipped = equippedIds.includes(item.id);
          const broken = item.stats?.durability === 0;
          return (
            <div
              key={item.id}
              onClick={() => setSelected(isSel ? null : item.id)}
              title={`${item.name} · ${item.weight}kg${isEquipped ? ' · EQUIPPED' : ''}${broken ? ' · BROKEN' : ''}`}
              style={{
                position: 'absolute',
                left: place.x * CELL + 2, top: place.y * CELL + 2,
                width: w * CELL - 4, height: h * CELL - 4,
                background: broken ? '#45151533' : item.visuals?.colorHex ? `${item.visuals.colorHex}33` : '#33415577',
                border: isEquipped ? '2px solid var(--mantine-color-gold-5)' : `1px solid ${isSel ? '#fff' : (item.visuals?.colorHex || '#64748b')}`,
                borderRadius: 3,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: Math.min(w, h) > 1 ? 20 : 14,
                cursor: 'pointer',
                overflow: 'hidden'
              }}
            >
              {RESOURCE_DEFINITIONS[item.universalDefinitionId]?.icon || (item.tags?.includes('tool') ? '🛠️' : item.type === 'LORE' ? '📜' : '⚔️')}
            </div>
          );
        })}
      </div>

      {selectedItem && (
        <Group gap="xs" mt={8}>
          <Text size="xs" style={{ flex: 1 }} truncate>
            {selectedItem.name}
            {selectedItem.stats?.durability !== undefined ? ` (${selectedItem.stats.durability}/${selectedItem.stats.maxDurability ?? 100})` : ''}
          </Text>
          {selectedItem.type === 'CONSUMABLE' && (
            <Button size="compact-xs" variant="light" color="emerald" onClick={() => { consumeItem(selectedItem.id); setSelected(null); }}>Use</Button>
          )}
          {selectedItem.slot !== 'NONE' && selectedItem.type !== 'CONSUMABLE' && (
            <Button size="compact-xs" variant="light" color="gold" onClick={() => equipItem(selectedItem.id)}>Equip</Button>
          )}
          <Button size="compact-xs" variant="light" onClick={() => rotateItem(selectedItem.id)}>Rotate</Button>
          <Button size="compact-xs" variant="light" color="red" onClick={() => { dropItem(selectedItem.id); setSelected(null); }}>
            Leave Behind
          </Button>
        </Group>
      )}
      <Text size="xs" c="dimmed" mt={4}>[TAB] close</Text>
    </Paper>
  );
};

// =============================================================================
// DRONE RECON (Pre-drop satellite view)
// =============================================================================

const BIOME_COLORS: Record<BiomeType, string> = {
  [BiomeType.WASTELAND]: '#8a7a4e',
  [BiomeType.OVERGROWTH]: '#1b7a52',
  [BiomeType.RUINS]: '#5d6b7a',
  [BiomeType.INDUSTRIAL]: '#8a5a2a',
  [BiomeType.CYBER_CITY]: '#4a4a8a'
};

const ReconOverlay: React.FC<{ onDrop: (x: number, y: number) => void }> = ({ onDrop }) => {
  const { currentMap, scanSector, selectSector, selectedDropZone } = useWorldStore();
  if (!currentMap) return null;

  const cellSize = Math.max(8, Math.min(20, Math.floor(560 / currentMap.width)));
  const selectedKey = selectedDropZone ? `${selectedDropZone.x},${selectedDropZone.y}` : null;
  const selected = selectedKey ? currentMap.sectors[selectedKey] : null;

  const handleSectorClick = (sector: ISector) => {
    selectSector(sector.x, sector.y);
    scanSector(sector.x, sector.y, 1); // Each click deepens the scan one level
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
    <Center h="100%" bg="#050505">
      <Group align="flex-start" gap="xl">
        {/* The Satellite Map */}
        <Stack gap="xs">
          <Badge color="blue" size="lg">DRONE RECON // SELECT DROP ZONE</Badge>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: `repeat(${currentMap.width}, ${cellSize}px)`,
              gap: 1,
              background: '#111',
              padding: 4,
              border: '1px solid #333'
            }}
          >
            {Array.from({ length: currentMap.height }, (_, y) =>
              Array.from({ length: currentMap.width }, (_, x) => {
                const key = `${x},${y}`;
                const sector = currentMap.sectors[key];
                if (!sector) return <div key={key} style={{ width: cellSize, height: cellSize }} />;
                const isSelected = key === selectedKey;
                const known = sector.scanLevel > ScanLevel.UNKNOWN;
                return (
                  <div
                    key={key}
                    onClick={() => handleSectorClick(sector)}
                    title={known ? `${sector.biome} [${sector.difficulty}]` : 'UNKNOWN'}
                    style={{
                      width: cellSize,
                      height: cellSize,
                      cursor: 'pointer',
                      background: known ? BIOME_COLORS[sector.biome] : '#1a1a1a',
                      outline: isSelected ? '2px solid #fff' : 'none',
                      boxShadow: sector.hasExtraction && known ? 'inset 0 0 0 2px #10b981' : 'none',
                      opacity: known ? 0.5 + sector.scanLevel * 0.17 : 1
                    }}
                  />
                );
              })
            )}
          </div>
          <Text size="xs" c="dimmed">Click a sector to scan it. Click again for deeper intel.</Text>
        </Stack>

        {/* Intel Panel */}
        <Paper p="md" w={280} bg="dark.8" style={{ border: '1px solid var(--mantine-color-dark-4)' }}>
          <Stack gap="sm">
            <Text fw={700} size="sm" c="blue">SECTOR INTEL</Text>
            {!selected && <Text size="xs" c="dimmed">No sector selected.</Text>}
            {selected && (
              <>
                <Group justify="space-between">
                  <Text size="xs" c="dimmed">COORDS</Text>
                  <Text size="xs" ff="monospace">{selected.x}, {selected.y}</Text>
                </Group>
                {selected.scanLevel >= ScanLevel.BASIC && (
                  <>
                    <Group justify="space-between">
                      <Text size="xs" c="dimmed">BIOME</Text>
                      <Badge size="xs" style={{ background: BIOME_COLORS[selected.biome] }}>{selected.biome}</Badge>
                    </Group>
                    <Group justify="space-between">
                      <Text size="xs" c="dimmed">THREAT</Text>
                      <Badge size="xs" color="red">{selected.difficulty}</Badge>
                    </Group>
                    {selected.hasExtraction && <Badge size="xs" color="emerald">EXTRACTION POINT</Badge>}
                  </>
                )}
                {selected.scanLevel >= ScanLevel.DETAILED && (
                  <Stack gap={4}>
                    <Text size="xs" c="dimmed">CONTACTS</Text>
                    {Object.entries(entityCounts(selected)).map(([type, count]) => (
                      <Text key={type} size="xs" ff="monospace">{count}x {type}</Text>
                    ))}
                    {selected.entities.length === 0 && <Text size="xs" ff="monospace" c="dimmed">Sector clear.</Text>}
                  </Stack>
                )}
                {selected.scanLevel >= ScanLevel.COMPLETE && selected.entities.length > 0 && (
                  <Stack gap={2}>
                    <Text size="xs" c="dimmed">MANIFEST</Text>
                    {manifest(selected).map(line => (
                      <Text key={line.id} size="xs" ff="monospace" c={line.hostile ? 'red' : 'gray'}>
                        {line.count}x [{line.rank}] {line.id}
                      </Text>
                    ))}
                  </Stack>
                )}
                <Button
                  color="emerald"
                  fullWidth
                  mt="sm"
                  onClick={() => onDrop(selected.x, selected.y)}
                >
                  CONFIRM DROP
                </Button>
              </>
            )}
          </Stack>
        </Paper>
      </Group>
    </Center>
  );
};

// =============================================================================
// WORLD CANVAS
// =============================================================================

export const WorldCanvas: React.FC<{ session: IActiveSession }> = ({ session }) => {
  // Store Hooks
  const { currentMap, reconMode, confirmDrop } = useWorldStore();
  const { movePlayer, performInteraction, processAction, player } = usePlayerStore();

  // Local State
  const [playerPatterns, setPlayerPatterns] = useState<any[]>([]);
  const [enemyPatterns, setEnemyPatterns] = useState<any[]>([]);
  const [activeSwings, setActiveSwings] = useState<any[]>([]);
  const [lootDrops, setLootDrops] = useState<any[]>([]);
  
  // Interaction Menu State
  const [menuPosition, setMenuPosition] = useState<{ x: number; y: number } | null>(null);
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);
  const [interactionOptions, setInteractionOptions] = useState<any[]>([]);

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

  // Equipped gear resolvers (ids -> live items)
  const getEquipped = (slot: 'mainHand' | 'armor' | 'accessory') => {
    const s = usePlayerStore.getState().player.currentSession;
    const id = s?.equipped?.[slot];
    return id ? s?.inventory.find(i => i.id === id) : undefined;
  };

  // Wave 2.5: extraction channel + regrow sweep timing
  const [channeling, setChanneling] = useState(false);
  const channelRef = useRef<number | null>(null);
  const lastRegrowSweep = useRef<number>(0);

  const CHANNEL_MS = 5000;
  const BEACON_RANGE = 60; // px

  // Completes the extraction: tax, journal seal, banking, save
  const completeExtraction = useCallback(() => {
    const st = usePlayerStore.getState();
    const session = st.player.currentSession;
    if (!session) return;

    const world = useWorldStore.getState();
    const card = world.availableWorlds.find(w => w.id === world.activeWorldId);
    const worldCertUid = world.activeWorldId;
    const haul = session.inventory.filter(i => !session.kitItemIds?.includes(i.id));
    const haulValue = haul.reduce((s, i) => s + (i.value || 0), 0);
    const rate = card?.extractionTaxRate ?? 0.05;
    const tax = Math.floor(haulValue * rate);

    SessionJournal.record('EXTRACT', { loot: haul.map(i => i.id), haulValue, rate, tax });
    st.emergencyJackOut();
    world.exitWorld();

    void (async () => {
      const charged = await ExitLevy.charge(worldCertUid || 'unknown', haulValue, rate);
      if (charged > 0) console.log(`[TAX] Hub levied ${charged}G (${(rate * 100).toFixed(0)}% of ${haulValue}G haul).`);
      // Wave 6.2: everything that made it home gets its story signed
      const { Provenance } = await import('../logic/sovereignty/Provenance');
      await Provenance.recordMany(haul, 'MINT', { origin: 'EXTRACTION', sessionId: session.sessionId, worldCertUid });

      const after = PlayerPersistence.persistableJson(usePlayerStore.getState().player);
      await SessionJournal.finish('EXTRACTED', after);
      await PlayerPersistence.flush('extract');
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

  // 2. Input Handling
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Tab') {
        e.preventDefault();
        setShowPack(prev => !prev);
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
  }, []);

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

      // Process Events (Wave 8B: the HIT/KILL hooks finally reach the screen)
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
        }
      });
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
            console.log(`[LOOT] Picked up ${added.length} item(s).`);
            SessionJournal.record('LOOT', { itemIds: added.map((i: any) => i.id) });
          }
          if (rejected.length > 0) {
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
          console.warn('[EXTRACT] Channel interrupted by damage!');
        }

        if (newHealth <= 0) {
          // FLATLINED: the world cert's death penalty applies (Wave 4.4)
          const w = useWorldStore.getState();
          const card = w.availableWorlds.find(c => c.id === w.activeWorldId);
          const penalty = card?.deathPenalty ?? 'INVENTORY_LOSS';
          console.warn(`[SESSION] Agent flatlined. Penalty: ${penalty}.`);
          SessionJournal.record('DEATH', { penalty });
          usePlayerStore.getState().emergencyJackOut(penalty);
          useWorldStore.getState().exitWorld();
          // Seal the journal and the bank (async; loop is already stopped)
          const after = PlayerPersistence.persistableJson(usePlayerStore.getState().player);
          void SessionJournal.finish('DIED', after).then(() => PlayerPersistence.flush('death'));
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
  }, [reconMode, currentMap, playerPatterns, enemyPatterns, activeSwings, lootDrops, completeExtraction]);

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
      console.log("No interactions available (too far or missing tools)");
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
      const near = WorldGenerator.chunkKeysInBox(clickX, clickZ, 60).flatMap(key => map.chunks[key]?.entities ?? []);
      const things = near.map(n => {
        const s = entitySprite(n);
        const h = (s?.h ?? 12) * ATOM_PX;
        // Upright things hang above their feet, so their hit box does too
        const cy = s ? n.position.y + baselinePx(n, s) - h / 2 : n.position.y;
        return { id: n.id, type: n.type, x: n.position.x, y: cy, w: (s?.w ?? 12) * ATOM_PX, h };
      });
      const hit = hitTest(targetsFrom(things), clickX, clickZ);
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
        console.log('[CAST] Not enough energy.');
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
  if (!currentMap) return <Center h="100%"><Loader color="emerald" /></Center>;

  // RECON MODE: satellite view for drop zone selection
  if (reconMode) {
    return <ReconOverlay onDrop={handleConfirmDrop} />;
  }

  const playerPos = session.position;

  // Wave 2.5: distance to the nearest extraction beacon
  const beaconDist = WorldGenerator.nearestExit(currentMap, playerPos.x, playerPos.z)?.distance ?? Infinity;
  const nearBeacon = beaconDist < BEACON_RANGE;

  return (
    <div 
      ref={canvasRef}
      className="full-size"
      style={{ overflow: 'hidden', background: '#050505', position: 'relative', cursor: 'crosshair' }}
      onContextMenu={(e) => { e.preventDefault(); setMenuPosition(null); }}
      onClick={handleCanvasClick}
    >
      {/* The whole field, drawn each frame by the game loop */}
      <canvas ref={fieldRef} style={{ position: 'absolute', top: 0, left: 0, imageRendering: 'pixelated' }} />

      {/* Extraction Control (Wave 2.5): the beacon is a place, not a button */}
      <div style={{ position: 'absolute', top: 20, right: 20, zIndex: 100 }}>
        {channeling ? (
          <Paper p="sm" bg="dark.8" style={{ border: '1px solid var(--mantine-color-emerald-6)' }}>
            <Group gap="sm">
              <Loader color="emerald" size="sm" />
              <Text size="sm" c="emerald" ff="monospace">CHANNELING… hold position</Text>
              <Button size="xs" variant="subtle" color="red" onClick={(e) => {
                e.stopPropagation();
                channelRef.current = null;
                setChanneling(false);
              }}>ABORT</Button>
            </Group>
          </Paper>
        ) : nearBeacon ? (
          <Button color="gold" onClick={(e) => {
            e.stopPropagation();
            channelRef.current = Date.now();
            setChanneling(true);
            console.log('[EXTRACT] Channel opened. 5 seconds. Don\'t get hit.');
          }}>
            EXTRACT (5s)
          </Button>
        ) : (
          <Badge color="gray" variant="outline" size="lg">
            BEACON: {Math.round(beaconDist / TILE_PX)}m {beaconDist === Infinity ? '— NONE' : '→ 🌀'}
          </Badge>
        )}
      </div>

      {/* UI Overlay */}
      <div style={{ position: 'absolute', top: 20, left: 20, zIndex: 100, pointerEvents: 'none' }}>
        <Badge color={reconMode ? 'blue' : 'emerald'} size="lg">
          {reconMode ? 'DRONE RECON' : 'ACTIVE AGENT'}
        </Badge>
        <Text c="dimmed" size="xs" mt={4}>
          POS: {Math.floor(playerPos.x)}, {Math.floor(playerPos.z)}
        </Text>
        {/* Vitals HUD */}
        <div style={{ width: 160, height: 8, background: '#2a0a0a', border: '1px solid #444', marginTop: 6 }}>
          <div style={{
            width: `${Math.max(0, (session.health / session.maxHealth) * 100)}%`,
            height: '100%',
            background: session.health / session.maxHealth > 0.3 ? '#10b981' : '#ef4444',
            transition: 'width 0.2s'
          }} />
        </div>
        <Text c="dimmed" size="xs" mt={2}>
          HP: {Math.ceil(session.health)}/{session.maxHealth} · PACK: {session.inventory.length} · [TAB] pack · Click to fire
        </Text>
      </div>

      {/* Pack Grid (Wave 3.1) */}
      {showPack && (
        <div style={{ position: 'absolute', bottom: 20, left: 20, zIndex: 150 }}>
          <PackGrid session={session} />
        </div>
      )}

      {/* Interaction Menu */}
      {menuPosition && (
        <Paper
          shadow="md"
          p="xs"
          style={{
            position: 'absolute',
            left: menuPosition.x,
            top: menuPosition.y,
            zIndex: 200,
            background: 'var(--mantine-color-dark-8)',
            border: '1px solid var(--mantine-color-dark-4)'
          }}
        >
          <Group gap="xs">
            {interactionOptions.map((opt) => (
              <ActionIcon 
                key={opt.id} 
                size="lg" 
                variant="filled" 
                color="emerald"
                onClick={(e) => { e.stopPropagation(); handleActionSelect(opt); }}
                title={`${opt.label} (${opt.timeCostSeconds}s)`}
              >
                {opt.icon}
              </ActionIcon>
            ))}
          </Group>
        </Paper>
      )}
    </div>
  );
};