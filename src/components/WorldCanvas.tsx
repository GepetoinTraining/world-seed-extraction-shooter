import React, { useEffect, useRef, useState, useCallback } from 'react';
import { IActiveSession, IItem } from '../../types';
import { useWorldStore } from '../entities/world/store';
import { usePlayerStore } from '../entities/player/store';
import { ProjectileSystem, PatternType, IProjectile, SIM_RADIUS_CHUNKS } from '../entities/combat/projectileSystem';
import { CombatSystem } from '../entities/combat/CombatSystems';
import { MobAI } from '../entities/mob/ai/MobAI';
import { InteractionEngine } from '../entities/interaction/InteractionEngine';
import { EntityType, IChunk, ScanLevel, IWorldEntity, BiomeType } from '../entities/world/types';
import { Center, Loader, Menu, Text, Badge, ActionIcon, Group, Paper, Button, Stack } from '@mantine/core';
import { SessionJournal } from '../logic/journal/SessionJournal';
import { PlayerPersistence } from '../logic/persistence/PlayerPersistence';
import { TerrainSystem, TILE_PX } from '../entities/world/TerrainSystem';
import { InventorySystem, GRID_W, GRID_H } from '../entities/player/systems/InventorySystem';
import { CombatMath } from '../entities/combat/CombatMath';
import { RESOURCE_DEFINITIONS } from '../entities/item/data/resourceDefinitions';
import { ExitLevy } from '../logic/economy/ExitLevy';

// --- CONSTANTS ---
const TILE_SIZE = 20; // 1 Unit = 20 Pixels
const PLAYER_SPEED = 3.0; // Tiles per second (walking pace; a 100px chunk takes ~1.7s to cross)
const MAX_DELTA = 0.1; // Clamp frame delta (seconds) so tab-switches don't teleport the player

// --- SUB-COMPONENTS (Visuals) ---

const EntityAvatar = ({ entity, onClick }: { entity: IWorldEntity; onClick: (e: React.MouseEvent) => void }) => {
  let color = '#fff';
  let icon = '❓';
  let shape = '50%'; // Circle by default

  const depleted = entity.type === EntityType.RESOURCE && (entity.usesRemaining ?? 1) <= 0;

  switch (entity.type) {
    case EntityType.MOB:
      color = entity.isHostile ? '#ef4444' : '#eab308';
      icon = '👾';
      break;
    case EntityType.RESOURCE:
      color = depleted ? '#374151' : '#10b981';
      icon = RESOURCE_DEFINITIONS[entity.definitionId]?.icon || '💎';
      shape = '4px'; // Box
      break;
    case EntityType.STRUCTURE:
      color = '#64748b';
      icon = '🏛️';
      shape = '0px'; // Square
      break;
    case EntityType.CONTAINER:
      if (entity.definitionId === 'ground_cache') {
        color = '#8b5cf6';
        icon = '🎒'; // a cache someone left behind — still theirs
        shape = '6px';
      } else {
        color = entity.container?.looted ? '#44403c' : '#f59e0b';
        icon = entity.container?.looted ? '🫙' : '📦';
        shape = '4px';
      }
      break;
    case EntityType.NPC:
      color = '#38bdf8';
      icon = '🧑';
      break;
    case EntityType.EXTRACTION:
      color = '#10b981';
      icon = '🌀';
      break;
  }

  return (
    <div
      onClick={onClick}
      style={{
        position: 'absolute',
        left: entity.position.x, 
        top: entity.position.y,
        width: 24, height: 24,
        backgroundColor: color,
        borderRadius: shape,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 14,
        transform: 'translate(-50%, -50%)', // Center anchor
        cursor: 'pointer',
        boxShadow: '0 0 10px rgba(0,0,0,0.5)',
        zIndex: entity.type === EntityType.MOB ? 20 : 10,
        opacity: depleted ? 0.35 : 1
      }}
    >
      {icon}
    </div>
  );
};

/**
 * TERRAIN LAYER (Wave 2.1): one <canvas> painted from the pure terrain
 * function each frame. It sits behind the DOM entities, outside the
 * transformed container, and derives everything from (seed, playerPos).
 */
const TerrainCanvas = ({ seed, playerX, playerZ }: { seed: string; playerX: number; playerZ: number }) => {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width = window.innerWidth;
    const h = canvas.height = window.innerHeight;

    // Top-left of the viewport in world px (player is centered)
    const originX = playerX - w / 2;
    const originZ = playerZ - h / 2;

    const startTx = Math.floor(originX / TILE_PX);
    const startTz = Math.floor(originZ / TILE_PX);
    const tilesW = Math.ceil(w / TILE_PX) + 1;
    const tilesH = Math.ceil(h / TILE_PX) + 1;

    for (let ty = 0; ty <= tilesH; ty++) {
      for (let tx = 0; tx <= tilesW; tx++) {
        const worldX = (startTx + tx) * TILE_PX;
        const worldZ = (startTz + ty) * TILE_PX;
        const tile = TerrainSystem.tileAt(seed, worldX + TILE_PX / 2, worldZ + TILE_PX / 2);
        ctx.fillStyle = tile.color;
        ctx.fillRect(worldX - originX, worldZ - originZ, TILE_PX, TILE_PX);
      }
    }
  }, [seed, playerX, playerZ]);

  return (
    <canvas
      ref={ref}
      style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
    />
  );
};

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

const PlayerAvatar = ({ x, y }: { x: number, y: number }) => (
  <div
    style={{
      position: 'absolute',
      left: x, top: y,
      width: 20, height: 20,
      backgroundColor: '#fff',
      borderRadius: '50%',
      transform: 'translate(-50%, -50%)',
      zIndex: 50,
      boxShadow: '0 0 15px white'
    }}
  />
);

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
  const { currentMap, scanChunk, selectChunk, selectedDropZone } = useWorldStore();
  if (!currentMap) return null;

  const cellSize = Math.max(8, Math.min(20, Math.floor(560 / currentMap.width)));
  const selectedKey = selectedDropZone ? `${selectedDropZone.x},${selectedDropZone.y}` : null;
  const selectedChunk = selectedKey ? currentMap.chunks[selectedKey] : null;

  const handleChunkClick = (chunk: IChunk) => {
    selectChunk(chunk.x, chunk.y);
    scanChunk(chunk.x, chunk.y, 1); // Each click deepens the scan one level
  };

  const entityCounts = (chunk: IChunk) => {
    const counts: Record<string, number> = {};
    chunk.entities.forEach(e => { counts[e.type] = (counts[e.type] || 0) + 1; });
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
                const chunk = currentMap.chunks[key];
                if (!chunk) return <div key={key} style={{ width: cellSize, height: cellSize }} />;
                const isSelected = key === selectedKey;
                const known = chunk.scanLevel > ScanLevel.UNKNOWN;
                return (
                  <div
                    key={key}
                    onClick={() => handleChunkClick(chunk)}
                    title={known ? `${chunk.biome} [${chunk.difficulty}]` : 'UNKNOWN'}
                    style={{
                      width: cellSize,
                      height: cellSize,
                      cursor: 'pointer',
                      background: known ? BIOME_COLORS[chunk.biome] : '#1a1a1a',
                      outline: isSelected ? '2px solid #fff' : 'none',
                      boxShadow: chunk.hasExtraction && known ? 'inset 0 0 0 2px #10b981' : 'none',
                      opacity: known ? 0.5 + chunk.scanLevel * 0.17 : 1
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
            {!selectedChunk && <Text size="xs" c="dimmed">No sector selected.</Text>}
            {selectedChunk && (
              <>
                <Group justify="space-between">
                  <Text size="xs" c="dimmed">COORDS</Text>
                  <Text size="xs" ff="monospace">{selectedChunk.x}, {selectedChunk.y}</Text>
                </Group>
                {selectedChunk.scanLevel >= ScanLevel.BASIC && (
                  <>
                    <Group justify="space-between">
                      <Text size="xs" c="dimmed">BIOME</Text>
                      <Badge size="xs" style={{ background: BIOME_COLORS[selectedChunk.biome] }}>{selectedChunk.biome}</Badge>
                    </Group>
                    <Group justify="space-between">
                      <Text size="xs" c="dimmed">THREAT</Text>
                      <Badge size="xs" color="red">{selectedChunk.difficulty}</Badge>
                    </Group>
                    {selectedChunk.hasExtraction && <Badge size="xs" color="emerald">EXTRACTION POINT</Badge>}
                  </>
                )}
                {selectedChunk.scanLevel >= ScanLevel.DETAILED && (
                  <Stack gap={4}>
                    <Text size="xs" c="dimmed">CONTACTS</Text>
                    {Object.entries(entityCounts(selectedChunk)).map(([type, count]) => (
                      <Text key={type} size="xs" ff="monospace">{count}x {type}</Text>
                    ))}
                    {selectedChunk.entities.length === 0 && <Text size="xs" ff="monospace" c="dimmed">Sector clear.</Text>}
                  </Stack>
                )}
                {selectedChunk.scanLevel >= ScanLevel.COMPLETE && selectedChunk.entities.length > 0 && (
                  <Stack gap={2}>
                    <Text size="xs" c="dimmed">MANIFEST</Text>
                    {selectedChunk.entities.slice(0, 8).map(e => (
                      <Text key={e.id} size="xs" ff="monospace" c={e.isHostile ? 'red' : 'gray'}>
                        [{e.rank}] {e.definitionId}
                      </Text>
                    ))}
                  </Stack>
                )}
                <Button
                  color="emerald"
                  fullWidth
                  mt="sm"
                  onClick={() => onDrop(selectedChunk.x, selectedChunk.y)}
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
  const [renderBullets, setRenderBullets] = useState<IProjectile[]>([]);
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
  const handleConfirmDrop = useCallback((chunkX: number, chunkY: number) => {
    // Wave 2.1: never drop the agent into water/rock
    const seed = useWorldStore.getState().currentMap?.seed;
    const target = seed
      ? TerrainSystem.nearestWalkable(seed, chunkX * 100 + 50, chunkY * 100 + 50)
      : { x: chunkX * 100 + 50, z: chunkY * 100 + 50 };
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
    SessionJournal.record('DROP', { chunkX, chunkY });
    confirmDrop();
  }, [confirmDrop]);

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

        // Wave 2.1: the ground has a say — water/rock block, mud slows
        const seed = useWorldStore.getState().currentMap?.seed;
        usePlayerStore.setState(state => {
          if (!state.player.currentSession) return state;
          const pos = state.player.currentSession.position;
          const next = seed
            ? TerrainSystem.resolveMove(seed, pos.x, pos.z, dx, dz)
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
      }

      // B. Entity & Combat Logic
      const liveSession = usePlayerStore.getState().player.currentSession;
      const liveMap = useWorldStore.getState().currentMap;
      const playerPos = liveSession?.position;
      if (!playerPos || !liveMap) {
        requestRef.current = requestAnimationFrame(gameLoop);
        return;
      }

      // Simulate every chunk a projectile fired from here can reach
      const visibleChunks: Record<string, IChunk> = {};
      const pChunkX = Math.floor(playerPos.x / 100);
      const pChunkY = Math.floor(playerPos.z / 100);

      for (let y = pChunkY - SIM_RADIUS_CHUNKS; y <= pChunkY + SIM_RADIUS_CHUNKS; y++) {
        for (let x = pChunkX - SIM_RADIUS_CHUNKS; x <= pChunkX + SIM_RADIUS_CHUNKS; x++) {
          const key = `${x},${y}`;
          if (liveMap.chunks[key]) visibleChunks[key] = liveMap.chunks[key];
        }
      }

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

      // AI Tick
      const aiResult = MobAI.tick(visibleChunks, { x: playerPos.x, y: playerPos.z }, dt);
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

      // Process Events
      combatResult.events.forEach(event => {
        if (event.type === 'ACTION_LOG' && event.actionContext) {
            processAction(event.actionContext);
        }
      });

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
      setRenderBullets([...combatResult.survivingBullets, ...survivingEnemyBullets]);

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

  // Click empty ground = ATTACK toward the cursor (Wave 4: the weapon decides how)
  const handleCanvasClick = (e: React.MouseEvent) => {
    if (menuPosition) {
      setMenuPosition(null); // First click just closes the menu
      return;
    }
    const st = usePlayerStore.getState();
    const playerPos = st.player.currentSession?.position;
    if (!playerPos) return;

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
  let beaconDist = Infinity;
  currentMap.extractionPoints.forEach(key => {
    const [bx, by] = key.split(',').map(Number);
    const d = Math.hypot(playerPos.x - (bx * 100 + 50), playerPos.z - (by * 100 + 50));
    if (d < beaconDist) beaconDist = d;
  });
  const nearBeacon = beaconDist < BEACON_RANGE;

  // Calculate viewport
  const viewportStyle = {
    transform: `translate(${window.innerWidth/2 - playerPos.x}px, ${window.innerHeight/2 - playerPos.z}px)`,
    transition: 'transform 0.1s linear' // Smooth out the frame jumps
  };

  return (
    <div 
      ref={canvasRef}
      className="full-size"
      style={{ overflow: 'hidden', background: '#050505', position: 'relative', cursor: 'crosshair' }}
      onContextMenu={(e) => { e.preventDefault(); setMenuPosition(null); }}
      onClick={handleCanvasClick}
    >
      {/* The ground itself (Wave 2.1) */}
      <TerrainCanvas seed={currentMap.seed} playerX={playerPos.x} playerZ={playerPos.z} />

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

      {/* World Container */}
      <div style={{ width: '100%', height: '100%', ...viewportStyle }}>
        
        {/* Render Chunks & Entities */}
        {Object.values(currentMap.chunks).map(chunk => (
          <div key={chunk.id}>
            {/* Ground (Debug) */}
            <div 
              style={{
                position: 'absolute',
                left: chunk.x * 100, top: chunk.y * 100,
                width: 100, height: 100,
                border: '1px solid #222',
                opacity: 0.2
              }}
            />
            
            {/* Entities */}
            {chunk.entities.map(entity => (
              <EntityAvatar 
                key={entity.id} 
                entity={entity} 
                onClick={(e) => handleEntityClick(e, entity)}
              />
            ))}
          </div>
        ))}

        {/* Render Loot */}
        {lootDrops.map(drop => (
          <div 
            key={drop.id}
            style={{ position: 'absolute', left: drop.position.x, top: drop.position.y, fontSize: 20 }}
          >
            💰
          </div>
        ))}

        {/* Render Bullets */}
        {renderBullets.map(b => (
          <div 
            key={b.id}
            style={{
              position: 'absolute',
              left: b.x, top: b.y,
              width: 6, height: 6,
              background: b.color,
              borderRadius: '50%'
            }}
          />
        ))}

        {/* Player */}
        <PlayerAvatar x={playerPos.x} y={playerPos.z} />

      </div>

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