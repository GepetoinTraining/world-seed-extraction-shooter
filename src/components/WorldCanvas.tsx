import React, { useEffect, useRef, useState, useCallback } from 'react';
import { IActiveSession, IItem } from '../../types';
import { useWorldStore } from '../entities/world/store';
import { usePlayerStore } from '../entities/player/store';
import { ProjectileSystem, PatternType, IProjectile } from '../entities/combat/projectileSystem';
import { CombatSystem } from '../entities/combat/CombatSystems';
import { MobAI } from '../entities/mob/ai/MobAI';
import { InteractionEngine } from '../entities/interaction/InteractionEngine';
import { EntityType, IChunk, ScanLevel, IWorldEntity } from '../entities/world/types';
import { Center, Loader, Menu, Text, Badge, ActionIcon, Group, Paper } from '@mantine/core';

// --- CONSTANTS ---
const TILE_SIZE = 20; // 1 Unit = 20 Pixels
const PLAYER_SPEED = 10.0; // Units per second (Fixed Physics)

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
// WORLD CANVAS
// =============================================================================

export const WorldCanvas: React.FC<{ session: IActiveSession }> = ({ session }) => {
  // Store Hooks
  const { currentMap, reconMode, scanChunk, selectChunk, initiateRecon, fetchChunkData } = useWorldStore();
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

  // 1. Initialize Recon if needed
  useEffect(() => {
    if (session.sessionId && (!currentMap || currentMap.seed !== session.sessionId)) {
      initiateRecon(session.sessionId);
    }
  }, [session.sessionId, currentMap, initiateRecon]);

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
      // --- PHYSICS FIX: DELTA TIME (Seconds) ---
      const dt = (now - lastTickRef.current) / 1000; 
      lastTickRef.current = now;

      // A. Movement Logic (Time-Based)
      const keys = keysPressed.current;
      let dx = 0, dz = 0;
      
      // Speed * Time * Scale Factor (to match visual pixels)
      const moveStep = PLAYER_SPEED * dt * 20; 

      if (keys.has('w')) dz -= moveStep;
      if (keys.has('s')) dz += moveStep;
      if (keys.has('a')) dx -= moveStep;
      if (keys.has('d')) dx += moveStep;

      if (dx !== 0 || dz !== 0) {
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
      const playerPos = usePlayerStore.getState().player.currentSession?.position;
      if (!playerPos) return;

      // Filter visible chunks
      const visibleChunks: Record<string, IChunk> = {};
      const pChunkX = Math.floor(playerPos.x / 100);
      const pChunkY = Math.floor(playerPos.z / 100);
      
      for (let y = pChunkY - 1; y <= pChunkY + 1; y++) {
        for (let x = pChunkX - 1; x <= pChunkX + 1; x++) {
          const key = `${x},${y}`;
          if (currentMap.chunks[key]) visibleChunks[key] = currentMap.chunks[key];
        }
      }

      // AI Tick
      const aiResult = MobAI.tick(visibleChunks, { x: playerPos.x, y: playerPos.z }, dt);
      if (aiResult.spawnedPatterns.length > 0) {
        setEnemyPatterns(prev => [...prev, ...aiResult.spawnedPatterns]);
      }

      // Combat Tick
      const allBullets: IProjectile[] = [];
      [...playerPatterns, ...enemyPatterns].forEach(p => {
        if ((now - p.startTime) < 2000) {
          allBullets.push(...ProjectileSystem.getProjectilesAtTime(p.type, p.origin, p.startTime, now, p.angle));
        }
      });

      const combatResult = CombatSystem.tick(allBullets, aiResult.updatedChunks, playerPos, session.health, activeSwings);

      // Process Events
      combatResult.events.forEach(event => {
        if (event.type === 'ACTION_LOG' && event.actionContext) {
            processAction(event.actionContext);
        }
      });

      // Update State
      if (combatResult.spawnedLoot.length > 0) {
          setLootDrops(prev => [...prev, ...combatResult.spawnedLoot.map(l => ({ id: crypto.randomUUID(), position: l.position, items: l.items }))]);
      }
      setRenderBullets(combatResult.survivingBullets);

      requestRef.current = requestAnimationFrame(gameLoop);
    };

    requestRef.current = requestAnimationFrame(gameLoop);
    return () => { if (requestRef.current) cancelAnimationFrame(requestRef.current); };
  }, [reconMode, currentMap, playerPatterns, enemyPatterns, activeSwings]);

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

  // 5. Render
  if (!currentMap) return <Center h="100%"><Loader color="emerald" /></Center>;

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
      onClick={() => setMenuPosition(null)}
    >
      {/* UI Overlay */}
      <div style={{ position: 'absolute', top: 20, left: 20, zIndex: 100, pointerEvents: 'none' }}>
        <Badge color={reconMode ? 'blue' : 'emerald'} size="lg">
          {reconMode ? 'DRONE RECON' : 'ACTIVE AGENT'}
        </Badge>
        <Text c="dimmed" size="xs" mt={4}>
          POS: {Math.floor(playerPos.x)}, {Math.floor(playerPos.z)}
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