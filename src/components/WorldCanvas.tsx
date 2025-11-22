import React, { useEffect, useRef, useState } from 'react';
import { IActiveSession } from '../../types'; 
import { useWorldStore } from '../entities/world/store';
import { EntityType, IWorldEntity, ScanLevel, IChunk } from '../entities/world/types';
import { BIOME_DEFINITIONS } from '../entities/world/definitions'; 
import { MobSize } from '../entities/mob/types';
import { SpriteGenerator } from '../entities/mob/utils/SpriteGenerator';
import { Center, Loader, Button, Stack, Group, Tooltip, Badge, SimpleGrid, Paper, Text } from '@mantine/core';

// ... (Keep MeleeArc, SpriteGenerator constants) ...

// ... (MobAvatar and MapChunk components remain exactly as before) ...
const CHUNK_PIXEL_SIZE = 20;
const MobAvatar = ({ entity }: { entity: any }) => { /* ... same ... */ return <div/>; };
const MapChunk = ({ chunk, isSelected, onClick, onHover }: any) => { /* ... same ... */ return <div/>; };

// --- VISUAL HELPERS ---
// Renders a melee swing arc
const MeleeArc = ({ x, y, angle, range, color }: any) => {
    const startAngle = angle - 0.75; // 45 deg left
    const endAngle = angle + 0.75; // 45 deg right
    
    // SVG Arc Path Logic
    // For simplicity in this DOM renderer, we use a rotated div or canvas
    // Here we use a simplified CSS trick: A wedge
    return (
        <div style={{
            position: 'absolute',
            left: x * CHUNK_PIXEL_SIZE,
            top: y * CHUNK_PIXEL_SIZE,
            width: range * CHUNK_PIXEL_SIZE * 2,
            height: range * CHUNK_PIXEL_SIZE * 2,
            borderRadius: '50%',
            background: `conic-gradient(from ${angle - 0.75 + 1.57}rad, transparent 0deg, ${color} 0deg, ${color} 90deg, transparent 90deg)`, 
            // +1.57rad (90deg) to align conic start with North
            transform: 'translate(-50%, -50%)',
            opacity: 0.5,
            pointerEvents: 'none',
            zIndex: 5
        }} />
    );
}

// --- 1. TACTICAL ENTITY (THE LIVE RENDERER) ---
// Only used when we are actually "in" the simulation
const TacticalEntity = ({ entity, onClick }: { entity: IWorldEntity, onClick: (e: any) => void }) => {
    // ... (Same logic as before: Renders sprite, health bar) ...
    return <div />; // Placeholder for brevity, use previous code
};

export const WorldCanvas: React.FC<{ session: IActiveSession }> = ({ session }) => {
  const { currentMap, initiateRecon, reconMode, fetchChunkData, selectChunk, confirmDrop, selectedDropZone } = useWorldStore();
  
  // --- STATE SPLIT ---
  // RECON STATE: Static Data
  const [hoverChunk, setHoverChunk] = useState<IChunk | null>(null);

  // TACTICAL STATE: Live Simulation
  const [liveEntities, setLiveEntities] = useState<IWorldEntity[]>([]);
  const requestRef = useRef<number>();

  // --- INITIALIZATION ---
  useEffect(() => {
    if (!currentMap) initiateRecon(session.sessionId);
  }, [session.sessionId, currentMap, initiateRecon]);

  // --- THE GAME LOOP (ONLY RUNS IN TACTICAL) ---
  const animate = (time: number) => {
    if (!reconMode) {
        // 1. Hydrate Entities (Move them)
        // 2. Handle Projectiles
        // 3. Collision Detection
        // updateAI(); <--- The AI only wakes up here
    }
    requestRef.current = requestAnimationFrame(animate);
  };

  useEffect(() => {
    if (!reconMode) {
        // START ENGINE
        requestRef.current = requestAnimationFrame(animate);
    } else {
        // STOP ENGINE (Save CPU)
        if (requestRef.current) cancelAnimationFrame(requestRef.current);
    }
    return () => cancelAnimationFrame(requestRef.current!);
  }, [reconMode]); // Only re-run when mode switches

  // --- RECON INTERACTION ---
  const handleReconClick = (chunk: IChunk) => {
      if (chunk.scanLevel === ScanLevel.UNKNOWN) {
          // "Downloading..."
          fetchChunkData(chunk.x, chunk.y); 
      } else {
          selectChunk(chunk.x, chunk.y);
      }
  };

  if (!currentMap) return <Center h="100%"><Loader color="emerald" type="dots" /></Center>;

  // ========================================================================
  // MODE A: RECON (STATIC DATABASE VIEWER)
  // No physics. No AI. Just JSON rendering.
  // ========================================================================
  if (reconMode) {
      return (
          <Center h="100%" bg="dark.9" style={{ position: 'relative' }}>
              
              {/* SQUAD INTEL OVERLAY */}
              <Paper pos="absolute" top={20} left={20} p="md" w={320} style={{ borderLeft: '4px solid var(--mantine-color-emerald-6)' }}>
                  <Text size="sm" fw={700} c="dimmed">OPERATION: WORLD SEED</Text>
                  <Text size="xs" c="dimmed">PHASE: <span style={{ color: '#fff' }}>RECONNAISSANCE</span></Text>
                  <Text size="xs" c="dimmed">DB_STATUS: <span style={{ color: '#22c55e' }}>CONNECTED</span></Text>
                  
                  <Stack mt="md" gap={4}>
                      <Text size="xs">CHUNK_MANIFEST: {Object.keys(currentMap.chunks).length} SECTORS</Text>
                      <Text size="xs">DOWNLOADED: {Object.values(currentMap.chunks).filter(c => c.scanLevel > 0).length} / {Object.keys(currentMap.chunks).length}</Text>
                  </Stack>
              </Paper>

              {/* THE STATIC GRID */}
              <SimpleGrid cols={currentMap.width} spacing={1}>
                  {Object.values(currentMap.chunks).map((chunk) => {
                      const isUnknown = chunk.scanLevel === ScanLevel.UNKNOWN;
                      const isSelected = selectedDropZone?.x === chunk.x && selectedDropZone?.y === chunk.y;
                      
                      // Use Unknown Color vs Biome Color
                      const cellColor = isUnknown ? '#111' : (BIOME_DEFINITIONS[chunk.biome]?.color || '#333');
                      
                      return (
                          <Tooltip 
                              key={chunk.id}
                              label={isUnknown ? "ENCRYPTED DATA" : `${chunk.biome} [${chunk.difficulty}]`}
                              color="dark"
                              transitionProps={{ duration: 0 }}
                          >
                              <div
                                  onClick={() => handleReconClick(chunk)}
                                  style={{
                                      width: 20, height: 20,
                                      backgroundColor: isSelected ? 'var(--mantine-color-gold-5)' : cellColor,
                                      opacity: isUnknown ? 0.3 : 1,
                                      border: isSelected ? '2px solid white' : '1px solid rgba(255,255,255,0.05)',
                                      cursor: 'pointer',
                                      display: 'flex', alignItems: 'center', justifyContent: 'center'
                                  }}
                              >
                                  {/* Render Static Icons based on JSON data (Not live entities) */}
                                  {chunk.scanLevel >= ScanLevel.DETAILED && (
                                      <div style={{ fontSize: 8 }}>
                                          {chunk.entities.filter(e => e.type === EntityType.MOB).length > 0 && '🔴'}
                                      </div>
                                  )}
                              </div>
                          </Tooltip>
                      );
                  })}
              </SimpleGrid>

              {/* DROP BUTTON */}
              {selectedDropZone && (
                  <Button 
                      pos="absolute" bottom={40} 
                      color="red" size="lg" 
                      className="animate-pulse"
                      onClick={confirmDrop}
                  >
                      INITIATE DIVE SEQUENCE
                  </Button>
              )}
          </Center>
      );
  }

  // ========================================================================
  // MODE B: TACTICAL (HYDRATED SIMULATION)
  // This is where the "Oven" opens and the game actually starts.
  // ========================================================================

  // --- TACTICAL VIEW ---
  const pX = Math.round(session.position.x);
  const pY = Math.round(session.position.z);
  const tacticalGrid = []; 
  // ... (Grid logic same) ...

  return (
    <Center 
        h="100%" 
        bg="black" 
        onMouseDown={handleCombatInput}
        onContextMenu={(e) => e.preventDefault()}
        style={{ cursor: 'crosshair' }}
    >
       <Stack pos="absolute" top={20} left={20} style={{ pointerEvents: 'none' }}>
          <Text c="orange" ff="monospace">TACTICAL LINK_</Text>
          <Text c="dimmed" size="xs">POS: {pX}, {pY}</Text>
          <Text c="dimmed" size="xs">PROJECTILES: {renderBullets.length}</Text>
       </Stack>
       
       <div style={{ position: 'relative', transform: 'scale(1.5)' }}>
           {tacticalGrid}
           
           {/* BULLETS */}
           {renderBullets.map((b, i) => (
               <div 
                 key={i}
                 style={{
                     position: 'absolute',
                     left: b.x * CHUNK_PIXEL_SIZE, 
                     top: b.y * CHUNK_PIXEL_SIZE,
                     width: 6, height: 6,
                     backgroundColor: b.color,
                     borderRadius: '50%',
                     transform: 'translate(-50%, -50%)',
                     boxShadow: `0 0 4px ${b.color}`,
                     pointerEvents: 'none'
                 }}
               />
           ))}

           {/* MELEE SWINGS */}
           {activeSwings.map((s, i) => (
               <MeleeArc 
                 key={`s_${i}`}
                 x={s.origin.x}
                 y={s.origin.y} // Fixed Z -> Y mapping
                 angle={s.angle}
                 range={s.range}
                 color="rgba(255, 255, 255, 0.5)"
               />
           ))}
           
           {/* PLAYER */}
           <div style={{
               position: 'absolute',
               left: '50%', top: '50%',
               width: 10, height: 10,
               background: 'white', borderRadius: '50%',
               transform: 'translate(-50%, -50%)',
               zIndex: 10
           }} />
       </div>
    </Center>
  );
};