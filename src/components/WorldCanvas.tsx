import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { IActiveSession, IItem } from '../../types';
import { useWorldStore } from '../entities/world/store';
import { usePlayerStore } from '../entities/player/store';
import { BIOME_DEFINITIONS } from '../entities/world/definitions';
import { MOB_DEFINITIONS } from '../entities/mob/data/mobDefinitions';
import { SpriteGenerator } from '../entities/mob/utils/SpriteGenerator';
import { ProjectileSystem, PatternType, IProjectile } from '../entities/combat/projectileSystem';
import { CombatSystem, ICombatEvent } from '../entities/combat/CombatSystems';
import { MobAI } from '../entities/mob/ai/MobAI';
import { Box, Text, Center, Loader, Button, Stack, Group, Badge, SimpleGrid, Paper, Progress } from '@mantine/core';
import { IWorldEntity, ScanLevel, IChunk, EntityType } from '../entities/world/types';

const CHUNK_PIXEL_SIZE = 20;
const TACTICAL_SCALE = 40;
const PLAYER_SPEED = 5.0;

// ============================================================================
// SUB-COMPONENTS
// ============================================================================

const MeleeArc = ({ x, y, angle, range, color }: any) => (
  <div style={{
    position: 'absolute',
    left: x * TACTICAL_SCALE,
    top: y * TACTICAL_SCALE,
    width: range * TACTICAL_SCALE * 2,
    height: range * TACTICAL_SCALE * 2,
    borderRadius: '50%',
    background: `conic-gradient(from ${angle - 0.75 + 1.57}rad, transparent 0deg, ${color} 0deg, ${color} 90deg, transparent 90deg)`,
    transform: 'translate(-50%, -50%)',
    opacity: 0.5,
    pointerEvents: 'none',
    zIndex: 5
  }} />
);

const MobAvatar = ({ entity, isHit }: { entity: IWorldEntity; isHit: boolean }) => {
  const def = MOB_DEFINITIONS[entity.definitionId];
  const spriteUrl = useMemo(() => {
    if (!def) return '';
    return SpriteGenerator.generateBlobSprite(def.colorHex, def.size);
  }, [def]);

  if (!def) return <div style={{ width: 8, height: 8, background: 'red', borderRadius: '50%' }} />;

  return (
    <div style={{
      width: '100%',
      height: '100%',
      backgroundImage: `url(${spriteUrl})`,
      backgroundSize: '800% 100%',
      backgroundPosition: '0 0',
      imageRendering: 'pixelated',
      filter: isHit ? 'brightness(3)' : 'none',
      transition: 'filter 0.1s'
    }} />
  );
};

const LootDrop = ({ items, onClick }: { items: IItem[]; onClick: () => void }) => (
  <div
    onClick={onClick}
    style={{
      width: 20,
      height: 20,
      background: 'gold',
      borderRadius: '50%',
      cursor: 'pointer',
      boxShadow: '0 0 10px gold',
      animation: 'pulse 1s infinite',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontSize: 10
    }}
  >
    {items.length}
  </div>
);

const DamageNumber = ({ damage, x, y }: { damage: number; x: number; y: number }) => (
  <div style={{
    position: 'absolute',
    left: x,
    top: y,
    color: 'red',
    fontWeight: 'bold',
    fontSize: 14,
    pointerEvents: 'none',
    animation: 'floatUp 0.5s forwards',
    textShadow: '0 0 4px black'
  }}>
    -{damage}
  </div>
);

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export const WorldCanvas: React.FC<{ session: IActiveSession }> = ({ session }) => {
  const { currentMap, reconMode, scanChunk, selectChunk, confirmDrop, selectedDropZone, initiateRecon, fetchChunkData, exitWorld } = useWorldStore();
  const { movePlayer, openLootContainer } = usePlayerStore();

  // Combat State
  const [playerPatterns, setPlayerPatterns] = useState<any[]>([]);
  const [enemyPatterns, setEnemyPatterns] = useState<any[]>([]);
  const [activeSwings, setActiveSwings] = useState<any[]>([]);
  const [renderBullets, setRenderBullets] = useState<IProjectile[]>([]);
  const [lootDrops, setLootDrops] = useState<{ id: string; position: { x: number; y: number }; items: IItem[] }[]>([]);
  const [hitMobs, setHitMobs] = useState<Set<string>>(new Set());
  const [damageNumbers, setDamageNumbers] = useState<{ id: string; damage: number; x: number; y: number }[]>([]);
  const [playerDamageFlash, setPlayerDamageFlash] = useState(false);

  // Refs
  const requestRef = useRef<number>();
  const lastTickRef = useRef<number>(Date.now());
  const keysPressed = useRef<Set<string>>(new Set());

  // Derived
  const isDev = currentMap?.seed.startsWith('dev') || false;
  const PLAYER_RECON_EFFICIENCY = isDev ? 99.0 : 3.5;
  const [hoverChunk, setHoverChunk] = useState<IChunk | null>(null);

  // ============================================================================
  // INIT
  // ============================================================================

  useEffect(() => {
    if (session.sessionId && (!currentMap || currentMap.seed !== session.sessionId)) {
      initiateRecon(session.sessionId);
    }
  }, [session.sessionId, currentMap, initiateRecon]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      MobAI.reset();
    };
  }, []);

  // ============================================================================
  // INPUT HANDLING
  // ============================================================================

  useEffect(() => {
    if (reconMode) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      keysPressed.current.add(e.key.toLowerCase());
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      keysPressed.current.delete(e.key.toLowerCase());
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [reconMode]);

  // ============================================================================
  // GAME LOOP
  // ============================================================================

  useEffect(() => {
    if (reconMode || !currentMap) return;

    const gameLoop = (time: number) => {
      const now = Date.now();
      const deltaTime = (now - lastTickRef.current) / 1000;
      lastTickRef.current = now;

      // 1. PLAYER MOVEMENT
      const keys = keysPressed.current;
      let dx = 0, dz = 0;
      if (keys.has('w')) dz -= PLAYER_SPEED * deltaTime * 60;
      if (keys.has('s')) dz += PLAYER_SPEED * deltaTime * 60;
      if (keys.has('a')) dx -= PLAYER_SPEED * deltaTime * 60;
      if (keys.has('d')) dx += PLAYER_SPEED * deltaTime * 60;

      if (dx !== 0 || dz !== 0) {
        // Direct position update for smoother movement
        usePlayerStore.setState(state => {
          if (!state.player.currentSession) return state;
          return {
            player: {
              ...state.player,
              currentSession: {
                ...state.player.currentSession,
                position: {
                  x: state.player.currentSession.position.x + dx,
                  y: state.player.currentSession.position.y,
                  z: state.player.currentSession.position.z + dz
                }
              }
            }
          };
        });
      }

      // Get current player position
      const playerPos = usePlayerStore.getState().player.currentSession?.position;
      if (!playerPos) return;

      // 2. GET VISIBLE CHUNKS
      const pChunkX = Math.floor(playerPos.x / 100);
      const pChunkY = Math.floor(playerPos.z / 100);
      const visibleChunks: Record<string, IChunk> = {};

      for (let y = pChunkY - 2; y <= pChunkY + 2; y++) {
        for (let x = pChunkX - 2; x <= pChunkX + 2; x++) {
          const key = `${x},${y}`;
          if (currentMap.chunks[key]) {
            visibleChunks[key] = currentMap.chunks[key];
          }
        }
      }

      // 3. MOB AI
      const aiResult = MobAI.tick(
        visibleChunks,
        { x: playerPos.x, y: playerPos.z },
        deltaTime
      );

      // Add enemy patterns
      if (aiResult.spawnedPatterns.length > 0) {
        setEnemyPatterns(prev => [...prev, ...aiResult.spawnedPatterns]);
      }

      // 4. UPDATE PROJECTILES
      const allPatterns = [...playerPatterns, ...enemyPatterns];
      const allBullets: IProjectile[] = [];

      const livePatterns = allPatterns.filter(p => (now - p.startTime) < 2000);

      livePatterns.forEach(p => {
        let bullets = ProjectileSystem.getProjectilesAtTime(p.type, p.origin, p.startTime, now, p.angle);

        // Deflection check
        const liveSwings = activeSwings.filter(s => (now - s.startTime) < 200);
        bullets = bullets.filter(b => {
          const isDeflected = liveSwings.some(s =>
            ProjectileSystem.checkDeflection(b, s.origin, s.angle)
          );
          return !isDeflected;
        });

        allBullets.push(...bullets);
      });

      // Cleanup old patterns
      setPlayerPatterns(prev => prev.filter(p => (now - p.startTime) < 2000));
      setEnemyPatterns(prev => prev.filter(p => (now - p.startTime) < 2000));
      setActiveSwings(prev => prev.filter(s => (now - s.startTime) < 200));

      // 5. COMBAT RESOLUTION
      const combatResult = CombatSystem.tick(
        allBullets,
        aiResult.updatedChunks,
        playerPos,
        session.health,
        activeSwings
      );

      // Process events
      const newHitMobs = new Set<string>();
      const newDamageNumbers: typeof damageNumbers = [];

      combatResult.events.forEach(event => {
        if (event.type === 'HIT' && event.entityId) {
          newHitMobs.add(event.entityId);
          if (event.position && event.damage) {
            newDamageNumbers.push({
              id: crypto.randomUUID(),
              damage: event.damage,
              x: event.position.x,
              y: event.position.y
            });
          }
        }
        if (event.type === 'KILL' && event.entityId) {
          MobAI.clearMob(event.entityId);
        }
        if (event.type === 'PLAYER_DAMAGE') {
          setPlayerDamageFlash(true);
          setTimeout(() => setPlayerDamageFlash(false), 100);

          // Reduce player health
          usePlayerStore.setState(state => {
            if (!state.player.currentSession) return state;
            return {
              player: {
                ...state.player,
                currentSession: {
                  ...state.player.currentSession,
                  health: Math.max(0, state.player.currentSession.health - (event.damage || 0))
                }
              }
            };
          });
        }
      });

      setHitMobs(newHitMobs);
      if (newDamageNumbers.length > 0) {
        setDamageNumbers(prev => [...prev.slice(-20), ...newDamageNumbers]);
      }

      // 6. SPAWN LOOT
      if (combatResult.spawnedLoot.length > 0) {
        const newDrops = combatResult.spawnedLoot.map(l => ({
          id: crypto.randomUUID(),
          position: l.position,
          items: l.items
        }));
        setLootDrops(prev => [...prev, ...newDrops]);
      }

      // 7. AUTO-PICKUP LOOT
      const pickupResult = CombatSystem.checkLootPickup(playerPos, lootDrops, 2.0);
      if (pickupResult.pickedUp.length > 0) {
        usePlayerStore.setState(state => {
          if (!state.player.currentSession) return state;
          return {
            player: {
              ...state.player,
              currentSession: {
                ...state.player.currentSession,
                inventory: [...state.player.currentSession.inventory, ...pickupResult.pickedUp]
              }
            }
          };
        });
        setLootDrops(pickupResult.remainingDrops);
      }

      // 8. UPDATE WORLD STATE
      useWorldStore.setState(state => ({
        currentMap: state.currentMap ? {
          ...state.currentMap,
          chunks: { ...state.currentMap.chunks, ...combatResult.updatedChunks }
        } : null
      }));

      setRenderBullets(combatResult.survivingBullets);

      // Cleanup old damage numbers
      setTimeout(() => {
        setDamageNumbers(prev => prev.filter(d => !newDamageNumbers.includes(d)));
      }, 500);

      requestRef.current = requestAnimationFrame(gameLoop);
    };

    requestRef.current = requestAnimationFrame(gameLoop);
    return () => {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
  }, [reconMode, currentMap, playerPatterns, enemyPatterns, activeSwings, lootDrops, session.health]);

  // ============================================================================
  // COMBAT INPUT
  // ============================================================================

  const handleCombatInput = useCallback((e: React.MouseEvent) => {
    if (reconMode) return;
    e.preventDefault();

    const rect = e.currentTarget.getBoundingClientRect();
    const mouseX = e.clientX - rect.left - rect.width / 2;
    const mouseY = e.clientY - rect.top - rect.height / 2;
    const angle = Math.atan2(mouseY, mouseX);

    const playerPos = usePlayerStore.getState().player.currentSession?.position;
    if (!playerPos) return;

    if (e.button === 0) {
      // Left Click: Melee
      setActiveSwings(prev => [...prev, {
        origin: { x: playerPos.x, y: playerPos.z },
        angle,
        startTime: Date.now(),
        range: 2.0
      }]);
    } else if (e.button === 2) {
      // Right Click: Shoot
      setPlayerPatterns(prev => [...prev, {
        type: PatternType.SHOTGUN,
        origin: { x: playerPos.x, y: playerPos.z },
        startTime: Date.now(),
        angle
      }]);
    }
  }, [reconMode]);

  // ============================================================================
  // RECON HANDLERS
  // ============================================================================

  const handleReconClick = useCallback((chunk: IChunk) => {
    if (chunk.scanLevel === ScanLevel.UNKNOWN) {
      fetchChunkData(chunk.x, chunk.y);
    } else if (chunk.scanLevel < ScanLevel.COMPLETE) {
      scanChunk(chunk.x, chunk.y, PLAYER_RECON_EFFICIENCY);
    } else {
      selectChunk(chunk.x, chunk.y);
    }
  }, [fetchChunkData, scanChunk, selectChunk, PLAYER_RECON_EFFICIENCY]);

  // ============================================================================
  // LOADING
  // ============================================================================

  if (!currentMap) {
    return <Center h="100%"><Loader color="emerald" /></Center>;
  }

  // ============================================================================
  // RECON MODE RENDER
  // ============================================================================

  if (reconMode) {
    const gridSize = currentMap.width;
    const chunks = Object.values(currentMap.chunks);

    let scanText = "UNKNOWN SECTOR";
    let scanColor = "dimmed";
    let scanDetails = null;

    if (hoverChunk) {
      if (hoverChunk.scanLevel === ScanLevel.UNKNOWN) {
        scanText = "UNSCANNED TERRITORY";
      } else if (hoverChunk.scanLevel === ScanLevel.BASIC) {
        scanText = `${hoverChunk.biome} [BASIC INTEL]`;
        scanColor = "emerald.4";
      } else if (hoverChunk.scanLevel === ScanLevel.DETAILED) {
        scanText = `${hoverChunk.biome} [DETAILED]`;
        scanColor = "blue.4";
        scanDetails = <Text size="xs">Danger: {hoverChunk.difficulty}</Text>;
      } else if (hoverChunk.scanLevel === ScanLevel.COMPLETE) {
        scanText = `${hoverChunk.biome} [COMPLETE]`;
        scanColor = "orange.4";
        const mobCount = hoverChunk.entities.filter(e => e.type === EntityType.MOB).length;
        scanDetails = <Text size="xs">Hostiles: {mobCount}</Text>;
      }
    }

    return (
      <Center h="100%" bg="dark.9" style={{ position: 'relative' }}>
        <Paper pos="absolute" top={20} left={20} p="md" w={300} style={{ zIndex: 10, borderLeft: `4px solid ${isDev ? 'cyan' : 'var(--mantine-color-blue-6)'}` }}>
          <Group justify="space-between">
            <Text size="xs" fw={700} c={isDev ? 'cyan' : 'dimmed'}>{isDev ? 'DEV OVERRIDE' : 'ORBITAL SCANNER'}</Text>
            <Button variant="subtle" size="xs" color="gray" onClick={exitWorld}>ABORT</Button>
          </Group>
          <Stack mt="md" gap="xs">
            <Text size="sm" fw={700} c={scanColor}>{scanText}</Text>
            {scanDetails}
            <Progress value={(hoverChunk?.scanLevel || 0) * 33} color={hoverChunk?.scanLevel === 3 ? 'orange' : 'blue'} size="xs" mt="xs" />
          </Stack>
        </Paper>

        <Box p="xl">
          <SimpleGrid cols={gridSize} spacing={1}>
            {chunks.map((chunk) => {
              const level = chunk.scanLevel;
              const isSelected = selectedDropZone?.x === chunk.x && selectedDropZone?.y === chunk.y;
              let bg = '#111';
              let opacity = 0.2;
              let border = '1px solid rgba(255,255,255,0.05)';

              if (level >= ScanLevel.BASIC) { bg = BIOME_DEFINITIONS[chunk.biome]?.color || '#333'; opacity = 0.6; }
              if (level >= ScanLevel.DETAILED) { opacity = 0.8; border = '1px solid rgba(255,255,255,0.2)'; }
              if (level >= ScanLevel.COMPLETE) { opacity = 1.0; border = '1px solid rgba(255,255,255,0.5)'; }
              if (isSelected) { border = '2px solid var(--mantine-color-gold-5)'; opacity = 1; }

              return (
                <div
                  key={chunk.id}
                  onMouseEnter={() => setHoverChunk(chunk)}
                  onClick={() => handleReconClick(chunk)}
                  style={{ width: CHUNK_PIXEL_SIZE, height: CHUNK_PIXEL_SIZE, backgroundColor: bg, opacity, border, cursor: 'crosshair', position: 'relative' }}
                >
                  {chunk.hasExtraction && level >= ScanLevel.DETAILED && (
                    <div style={{ position: 'absolute', inset: 4, borderRadius: '50%', background: 'cyan' }} />
                  )}
                </div>
              );
            })}
          </SimpleGrid>
        </Box>

        {selectedDropZone && (
          <Button pos="absolute" bottom={40} color="red" size="lg" onClick={confirmDrop}>
            DEPLOY TO SECTOR {selectedDropZone.x},{selectedDropZone.y}
          </Button>
        )}
      </Center>
    );
  }

  // ============================================================================
  // TACTICAL MODE RENDER
  // ============================================================================

  const playerPos = session.position;
  const pChunkX = Math.floor(playerPos.x / 100);
  const pChunkY = Math.floor(playerPos.z / 100);
  const renderRadius = 2;
  const tacticalElements: JSX.Element[] = [];

  // Render chunks and entities
  for (let y = pChunkY - renderRadius; y <= pChunkY + renderRadius; y++) {
    for (let x = pChunkX - renderRadius; x <= pChunkX + renderRadius; x++) {
      const chunkKey = `${x},${y}`;
      const chunk = currentMap.chunks[chunkKey];

      if (chunk) {
        const def = BIOME_DEFINITIONS[chunk.biome];
        const chunkWorldX = x * 100;
        const chunkWorldY = y * 100;
        const relX = chunkWorldX - playerPos.x;
        const relY = chunkWorldY - playerPos.z;

        // Floor
        tacticalElements.push(
          <div key={`floor_${chunkKey}`} style={{
            position: 'absolute',
            left: `calc(50% + ${relX * TACTICAL_SCALE}px)`,
            top: `calc(50% + ${relY * TACTICAL_SCALE}px)`,
            width: 100 * TACTICAL_SCALE,
            height: 100 * TACTICAL_SCALE,
            backgroundColor: def?.color || '#222',
            border: '1px solid rgba(255,255,255,0.1)',
            backgroundImage: 'radial-gradient(rgba(255,255,255,0.05) 1px, transparent 1px)',
            backgroundSize: `${TACTICAL_SCALE}px ${TACTICAL_SCALE}px`,
            zIndex: 0
          }} />
        );

        // Mobs
        chunk.entities.forEach(ent => {
          if (ent.type !== EntityType.MOB || !ent.health || ent.health <= 0) return;

          const entRelX = ent.position.x - playerPos.x;
          const entRelY = ent.position.y - playerPos.z;

          tacticalElements.push(
            <div key={ent.id} style={{
              position: 'absolute',
              left: `calc(50% + ${entRelX * TACTICAL_SCALE}px)`,
              top: `calc(50% + ${entRelY * TACTICAL_SCALE}px)`,
              width: 32,
              height: 32,
              transform: 'translate(-50%, -50%)',
              zIndex: 2
            }}>
              <MobAvatar entity={ent} isHit={hitMobs.has(ent.id)} />
              {/* Health bar */}
              <div style={{
                position: 'absolute',
                bottom: -6,
                left: 0,
                right: 0,
                height: 3,
                background: '#333'
              }}>
                <div style={{
                  height: '100%',
                  width: `${((ent.health || 0) / (MOB_DEFINITIONS[ent.definitionId]?.baseHealth || 100)) * 100}%`,
                  background: 'red'
                }} />
              </div>
            </div>
          );
        });
      }
    }
  }

  // Render loot drops
  lootDrops.forEach(drop => {
    const relX = drop.position.x - playerPos.x;
    const relY = drop.position.y - playerPos.z;

    tacticalElements.push(
      <div key={drop.id} style={{
        position: 'absolute',
        left: `calc(50% + ${relX * TACTICAL_SCALE}px)`,
        top: `calc(50% + ${relY * TACTICAL_SCALE}px)`,
        transform: 'translate(-50%, -50%)',
        zIndex: 3
      }}>
        <LootDrop items={drop.items} onClick={() => openLootContainer(drop.id, drop.items)} />
      </div>
    );
  });

  return (
    <Center
      h="100%"
      bg="black"
      onMouseDown={handleCombatInput}
      onContextMenu={(e) => e.preventDefault()}
      style={{ cursor: 'crosshair', overflow: 'hidden', position: 'relative' }}
    >
      {/* HUD */}
      <Stack pos="absolute" top={20} left={20} style={{ pointerEvents: 'none', zIndex: 20 }}>
        <Text c="orange" ff="monospace" fw={700}>TACTICAL LINK {isDev ? '[DEV]' : ''}</Text>
        <Group gap="xs">
          <Badge color="gray" radius="xs">POS: {Math.round(playerPos.x)}, {Math.round(playerPos.z)}</Badge>
          <Badge color="red" radius="xs">HP: {session.health}/{session.maxHealth}</Badge>
          <Badge color="blue" radius="xs">LOOT: {session.inventory.length}</Badge>
        </Group>
        <Text size="xs" c="dimmed">WASD Move | LMB Melee | RMB Shoot</Text>
      </Stack>

      {/* Extract Button */}
      <Button pos="absolute" top={20} right={20} color="gold" onClick={() => usePlayerStore.getState().emergencyJackOut()}>
        EXTRACT
      </Button>

      {/* Game World */}
      <div style={{ position: 'absolute', inset: 0 }}>
        {tacticalElements}

        {/* Bullets */}
        {renderBullets.map((b, i) => {
          const relX = b.x - playerPos.x;
          const relY = b.y - playerPos.z;
          return (
            <div key={`b_${i}`} style={{
              position: 'absolute',
              left: `calc(50% + ${relX * TACTICAL_SCALE}px)`,
              top: `calc(50% + ${relY * TACTICAL_SCALE}px)`,
              width: 8,
              height: 8,
              backgroundColor: b.color,
              borderRadius: '50%',
              transform: 'translate(-50%, -50%)',
              boxShadow: `0 0 8px ${b.color}`,
              pointerEvents: 'none',
              zIndex: 4
            }} />
          );
        })}

        {/* Melee Arcs */}
        {activeSwings.map((s, i) => {
          const relX = s.origin.x - playerPos.x;
          const relY = s.origin.y - playerPos.z;
          return (
            <div key={`s_${i}`} style={{
              position: 'absolute',
              left: `calc(50% + ${relX * TACTICAL_SCALE}px)`,
              top: `calc(50% + ${relY * TACTICAL_SCALE}px)`
            }}>
              <MeleeArc x={0} y={0} angle={s.angle} range={s.range} color="rgba(255,255,255,0.8)" />
            </div>
          );
        })}

        {/* Player */}
        <div style={{
          position: 'absolute',
          left: '50%',
          top: '50%',
          width: 20,
          height: 20,
          background: playerDamageFlash ? 'red' : 'white',
          borderRadius: '50%',
          transform: 'translate(-50%, -50%)',
          zIndex: 10,
          boxShadow: '0 0 15px white',
          transition: 'background 0.1s'
        }} />

        {/* Damage Numbers */}
        {damageNumbers.map(dn => {
          const relX = dn.x - playerPos.x;
          const relY = dn.y - playerPos.z;
          return (
            <DamageNumber
              key={dn.id}
              damage={dn.damage}
              x={`calc(50% + ${relX * TACTICAL_SCALE}px)`}
              y={`calc(50% + ${relY * TACTICAL_SCALE}px - 20px)`}
            />
          );
        })}
      </div>

      {/* CSS Animations */}
      <style>{`
        @keyframes pulse {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.2); }
        }
        @keyframes floatUp {
          0% { opacity: 1; transform: translateY(0); }
          100% { opacity: 0; transform: translateY(-30px); }
        }
      `}</style>
    </Center>
  );
};