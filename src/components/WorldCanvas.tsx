import React, { useEffect, useRef, useState, useCallback } from 'react';
import { IActiveSession, IItem } from '../../types';
import { useWorldStore } from '../entities/world/store';
import { usePlayerStore } from '../entities/player/store';
import { ProjectileSystem, PatternType, IProjectile } from '../entities/combat/projectileSystem';
import { CombatSystem } from '../entities/combat/CombatSystems';
import { MobAI } from '../entities/mob/ai/MobAI';
import { InteractionEngine } from '../entities/interaction/InteractionEngine';
import { EntityType, IChunk, ScanLevel, IWorldEntity, BiomeType } from '../entities/world/types';
import { Center, Loader, Menu, Text, Badge, ActionIcon, Group, Paper, Button, Stack } from '@mantine/core';

// --- CONSTANTS ---
const TILE_SIZE = 20; // 1 Unit = 20 Pixels
const PLAYER_SPEED = 3.0; // Tiles per second (walking pace; a 100px chunk takes ~1.7s to cross)
const MAX_DELTA = 0.1; // Clamp frame delta (seconds) so tab-switches don't teleport the player

// --- SUB-COMPONENTS (Visuals) ---

const EntityAvatar = ({ entity, onClick }: { entity: IWorldEntity; onClick: (e: React.MouseEvent) => void }) => {
  let color = '#fff';
  let icon = '❓';
  let shape = '50%'; // Circle by default

  switch (entity.type) {
    case EntityType.MOB:
      color = entity.isHostile ? '#ef4444' : '#eab308';
      icon = '👾';
      break;
    case EntityType.RESOURCE:
      color = '#10b981';
      icon = '💎';
      shape = '4px'; // Box
      break;
    case EntityType.STRUCTURE:
      color = '#64748b';
      icon = '🏛️';
      shape = '0px'; // Square
      break;
    case EntityType.CONTAINER:
      color = '#f59e0b';
      icon = '📦';
      shape = '4px';
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
        zIndex: entity.type === EntityType.MOB ? 20 : 10
      }}
    >
      {icon}
    </div>
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

  // 1. Drop Confirmation: place the agent at the chosen sector, then go live
  const handleConfirmDrop = useCallback((chunkX: number, chunkY: number) => {
    usePlayerStore.setState(state => {
      if (!state.player.currentSession) return state;
      return {
        player: {
          ...state.player,
          currentSession: {
            ...state.player.currentSession,
            position: { x: chunkX * 100 + 50, y: 0, z: chunkY * 100 + 50 }
          }
        }
      };
    });
    lastTickRef.current = Date.now(); // Fresh delta so the first frame doesn't jump
    confirmDrop();
  }, [confirmDrop]);

  // 2. Input Handling
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => keysPressed.current.add(e.key.toLowerCase());
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
      const dt = Math.min((now - lastTickRef.current) / 1000, MAX_DELTA);
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
        usePlayerStore.setState(state => {
          if (!state.player.currentSession) return state;
          return { 
            player: { 
              ...state.player, 
              currentSession: { 
                ...state.player.currentSession, 
                position: { 
                  x: state.player.currentSession.position.x + dx, 
                  y: 0, 
                  z: state.player.currentSession.position.z + dz 
                } 
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

      // Filter visible chunks
      const visibleChunks: Record<string, IChunk> = {};
      const pChunkX = Math.floor(playerPos.x / 100);
      const pChunkY = Math.floor(playerPos.z / 100);

      for (let y = pChunkY - 1; y <= pChunkY + 1; y++) {
        for (let x = pChunkX - 1; x <= pChunkX + 1; x++) {
          const key = `${x},${y}`;
          if (liveMap.chunks[key]) visibleChunks[key] = liveMap.chunks[key];
        }
      }

      let incomingDamage = 0;
      const isAlive = (p: any) => (now - p.startTime) < 2000;

      // AI Tick
      const aiResult = MobAI.tick(visibleChunks, { x: playerPos.x, y: playerPos.z }, dt);
      if (aiResult.spawnedPatterns.length > 0) {
        // MELEE strikes resolve instantly; ranged patterns become projectiles
        aiResult.spawnedPatterns.forEach(p => {
          if (p.type === 'MELEE') {
            const d = Math.hypot(p.origin.x - playerPos.x, p.origin.y - playerPos.z);
            if (d < 50) incomingDamage += 10;
          }
        });
        const ranged = aiResult.spawnedPatterns.filter(p => p.type !== 'MELEE');
        if (ranged.length > 0) setEnemyPatterns(prev => [...prev.filter(isAlive), ...ranged]);
      }

      // Projectiles: player bullets hit mobs, enemy bullets hit the player
      const playerBullets: IProjectile[] = [];
      playerPatterns.filter(isAlive).forEach((p, pi) => {
        playerBullets.push(...ProjectileSystem.getProjectilesAtTime(p.type, p.origin, p.startTime, now, p.angle)
          .map(b => ({ ...b, id: `pl_${pi}_${p.startTime}_${b.id}` })));
      });

      const enemyBullets: IProjectile[] = [];
      enemyPatterns.filter(isAlive).forEach((p, pi) => {
        enemyBullets.push(...ProjectileSystem.getProjectilesAtTime(p.type, p.origin, p.startTime, now, p.angle)
          .map(b => ({ ...b, id: `e_${pi}_${p.startTime}_${b.id}`, color: '#ef4444' })));
      });

      const survivingEnemyBullets = enemyBullets.filter(b => {
        if (Math.hypot(b.x - playerPos.x, b.y - playerPos.z) < 15) {
          incomingDamage += 8;
          return false;
        }
        return true;
      });

      // Collision-check ALL visible chunks (AI only returns the modified ones)
      const combatResult = CombatSystem.tick(playerBullets, { ...visibleChunks, ...aiResult.updatedChunks }, playerPos, liveSession.health, activeSwings);

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
        const { pickedUp, remainingDrops } = CombatSystem.checkLootPickup(playerPos, drops, 30);
        if (pickedUp.length > 0) {
          console.log(`[LOOT] Picked up ${pickedUp.length} item(s).`);
          usePlayerStore.setState(state => state.player.currentSession
            ? { player: { ...state.player, currentSession: { ...state.player.currentSession, inventory: [...state.player.currentSession.inventory, ...pickedUp] } } }
            : state);
        }
        if (pickedUp.length > 0 || drops !== lootDrops) setLootDrops(remainingDrops);
      }
      setRenderBullets([...combatResult.survivingBullets, ...survivingEnemyBullets]);

      // Apply damage to the agent
      const totalDamage = incomingDamage + combatResult.playerDamage;
      if (totalDamage > 0) {
        const newHealth = Math.max(0, liveSession.health - totalDamage);
        usePlayerStore.setState(state => state.player.currentSession
          ? { player: { ...state.player, currentSession: { ...state.player.currentSession, health: newHealth } } }
          : state);

        if (newHealth <= 0) {
          // FLATLINED: forced jack-out (loot is banked by emergencyJackOut for now)
          console.warn('[SESSION] Agent flatlined. Emergency extraction triggered.');
          usePlayerStore.getState().emergencyJackOut();
          useWorldStore.getState().exitWorld();
          return; // Stop the loop; component unmounts
        }
      }

      requestRef.current = requestAnimationFrame(gameLoop);
    };

    requestRef.current = requestAnimationFrame(gameLoop);
    return () => { if (requestRef.current) cancelAnimationFrame(requestRef.current); };
  }, [reconMode, currentMap, playerPatterns, enemyPatterns, activeSwings, lootDrops]);

  // 4. Interaction Handler
  const handleEntityClick = (e: React.MouseEvent, entity: IWorldEntity) => {
    e.stopPropagation();
    e.preventDefault();

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

  // Click empty ground = FIRE toward the cursor
  const handleCanvasClick = (e: React.MouseEvent) => {
    if (menuPosition) {
      setMenuPosition(null); // First click just closes the menu
      return;
    }
    const playerPos = usePlayerStore.getState().player.currentSession?.position;
    if (!playerPos) return;

    // Screen -> World: the viewport keeps the player centered
    const worldX = playerPos.x + (e.clientX - window.innerWidth / 2);
    const worldZ = playerPos.z + (e.clientY - window.innerHeight / 2);
    const angle = Math.atan2(worldZ - playerPos.z, worldX - playerPos.x);

    setPlayerPatterns(prev => [
      ...prev.filter(p => Date.now() - p.startTime < 2000),
      {
        type: PatternType.SINGLE,
        origin: { x: playerPos.x, y: playerPos.z },
        startTime: Date.now(),
        angle
      }
    ]);
  };

  // 5. Render
  if (!currentMap) return <Center h="100%"><Loader color="emerald" /></Center>;

  // RECON MODE: satellite view for drop zone selection
  if (reconMode) {
    return <ReconOverlay onDrop={handleConfirmDrop} />;
  }

  const playerPos = session.position;
  
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
          HP: {Math.ceil(session.health)}/{session.maxHealth} · LOOT: {session.inventory.length} · Click to fire
        </Text>
      </div>

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