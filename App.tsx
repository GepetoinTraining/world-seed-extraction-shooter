import React, { useEffect, useRef, useState } from 'react';
import { IActiveSession } from './types'; 
import { useWorldStore } from './src/entities/world/store';
import { BiomeType, ScanLevel, IChunk } from './src/entities/world/types';
import { BIOME_DEFINITIONS } from './src/entities/world/definitions'; 
import { ProjectileSystem, PatternType, IProjectile } from './src/entities/combat/projectileSystem'; 
import { Box, Text, Center, Loader, Button, Stack, Group, Tooltip, Badge, SimpleGrid, Paper, RingProgress } from '@mantine/core';

// --- CONSTANTS ---
const CHUNK_PIXEL_SIZE = 20; // Size of grid cells in Recon Mode
const TACTICAL_SCALE = 40;   // Size of grid cells in Dive Mode

// --- HELPER: MELEE ARC VISUAL ---
const MeleeArc = ({ x, y, angle, range, color }: any) => {
    // Visualizing a swing arc using CSS conic gradients
    return (
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
};

export const WorldCanvas: React.FC<{ session: IActiveSession }> = ({ session }) => {
  const { currentMap, generateWorld, reconMode, scanChunk, selectChunk, confirmDrop, selectedDropZone } = useWorldStore();
  
  // --- COMBAT STATE (TACTICAL) ---
  const [activePatterns, setActivePatterns] = useState<any[]>([]);
  const [activeSwings, setActiveSwings] = useState<any[]>([]);
  const [renderBullets, setRenderBullets] = useState<IProjectile[]>([]);
  const requestRef = useRef<number>();

  // --- RECON STATE ---
  // In a real app, these would come from usePlayerStore -> stats -> recon_efficiency
  const PLAYER_RECON_EFFICIENCY = 2.5; 
  const PLAYER_SCAN_ENERGY = 100; // Mock energy

  // --- INITIALIZATION ---
  useEffect(() => {
    if (!currentMap) generateWorld(session.sessionId);
  }, [session.sessionId, currentMap, generateWorld]);

  // --- GAME LOOP (60 FPS) ---
  const animate = (time: number) => {
    if (!reconMode) {
        const now = Date.now();
        const allBullets: IProjectile[] = [];
        
        // 1. Update Projectiles
        const livePatterns = activePatterns.filter(p => (now - p.startTime) < 2000);
        if (livePatterns.length !== activePatterns.length) setActivePatterns(livePatterns);

        livePatterns.forEach(p => {
            let bullets = ProjectileSystem.getProjectilesAtTime(p.type, p.origin, p.startTime, now, p.angle);
            
            // 2. Deflection Logic (Melee vs Projectile)
            const liveSwings = activeSwings.filter(s => (now - s.startTime) < 200);
            bullets = bullets.filter(b => {
                const isDeflected = liveSwings.some(s => 
                    ProjectileSystem.checkDeflection ? ProjectileSystem.checkDeflection(b, s.origin, s.angle) : false
                );
                return !isDeflected; 
            });

            allBullets.push(...bullets);
        });
        
        // Cleanup Swings
        const liveSwings = activeSwings.filter(s => (now - s.startTime) < 200);
        if (liveSwings.length !== activeSwings.length) setActiveSwings(liveSwings);

        setRenderBullets(allBullets);
    }
    requestRef.current = requestAnimationFrame(animate);
  };

  useEffect(() => {
    requestRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(requestRef.current!);
  }, [activePatterns, activeSwings, reconMode]);

  // --- INPUT HANDLERS ---
  const handleCombatInput = (e: React.MouseEvent) => {
      if (reconMode) return;
      e.preventDefault();
      
      // Mock aiming angle (North)
      const angle = -Math.PI / 2; 
      
      if (e.button === 0) { // Left Click: Melee
          const newSwing = {
              origin: { ...session.position },
              angle: angle,
              startTime: Date.now(),
              range: 2.0
          };
          setActiveSwings(prev => [...prev, newSwing]);
      } else if (e.button === 2) { // Right Click: Shoot
          const newPattern = {
              type: PatternType.SHOTGUN,
              origin: { ...session.position },
              startTime: Date.now(),
              angle: angle
          };
          setActivePatterns(prev => [...prev, newPattern]);
      }
  };

  const handleReconClick = (chunk: IChunk) => {
      if (chunk.scanLevel < ScanLevel.COMPLETE) {
          // ACTION: SCAN
          // Here we would deduct 'Recon Energy' from the Squad/Guild bank
          scanChunk(chunk.x, chunk.y, PLAYER_RECON_EFFICIENCY);
      } else {
          // ACTION: SELECT DROP
          selectChunk(chunk.x, chunk.y);
      }
  };

  if (!currentMap) return <Center h="100%"><Loader color="emerald" /></Center>;

  // ========================================================================
  // 1. RECON VIEW (THE STRATEGY LAYER)
  // "This Recon phase is supposed to be a social thing, squads, guilds..."
  // ========================================================================
  if (reconMode) {
      const gridSize = currentMap.width;
      
      return (
          <Center h="100%" bg="dark.9" style={{ position: 'relative' }}>
              
              {/* --- SOCIAL / SQUAD OVERLAY --- */}
              <Paper 
                pos="absolute" top={20} left={20} p="md" w={300} 
                style={{ zIndex: 10, borderLeft: '4px solid var(--mantine-color-emerald-6)' }}
              >
                  <Text size="xs" fw={700} c="dimmed" tt="uppercase" mb="xs">Squad Uplink // [ALPHA-1]</Text>
                  <Stack gap="xs">
                      <Group justify="space-between">
                          <Group gap="xs">
                              <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#22c55e' }} />
                              <Text size="sm">Kirito_Zero</Text>
                          </Group>
                          <Badge size="xs" color="emerald">READY</Badge>
                      </Group>
                      {/* Mock Squad Members */}
                      <Group justify="space-between" style={{ opacity: 0.5 }}>
                          <Group gap="xs">
                              <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#eab308' }} />
                              <Text size="sm">Asuna_Yuuki</Text>
                          </Group>
                          <Text size="xs" c="dimmed">SCANNING...</Text>
                      </Group>
                      <Group justify="space-between" style={{ opacity: 0.3 }}>
                          <Group gap="xs">
                              <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#ef4444' }} />
                              <Text size="sm">Klein_R</Text>
                          </Group>
                          <Text size="xs" c="dimmed">OFFLINE</Text>
                      </Group>
                  </Stack>
                  
                  <Paper mt="md" p="xs" bg="dark.7">
                      <Group justify="space-between">
                          <Text size="xs">RECON ENERGY</Text>
                          <Text size="xs" c="emerald.4" fw={700}>{PLAYER_SCAN_ENERGY} / 100</Text>
                      </Group>
                      <Text size="xs" c="dimmed" mt={4}>
                          Efficiency: <Text span c="white">{PLAYER_RECON_EFFICIENCY.toFixed(1)}x</Text>
                      </Text>
                  </Paper>
              </Paper>

              {/* --- THE MAP GRID --- */}
              <Box p="xl">
                  <SimpleGrid cols={gridSize} spacing={1}>
                      {Object.values(currentMap.chunks).map((chunk) => {
                          // Visual Logic based on Scan Level
                          const isScanned = chunk.scanLevel > ScanLevel.UNKNOWN;
                          const isSelected = selectedDropZone?.x === chunk.x && selectedDropZone?.y === chunk.y;
                          const biomeColor = isScanned ? BIOME_DEFINITIONS[chunk.biome]?.color || '#444' : '#111';
                          
                          return (
                              <Tooltip 
                                  key={chunk.id}
                                  label={
                                      !isScanned ? "Uncharted Sector" : 
                                      <Stack gap={0}>
                                          <Text size="xs" fw={700} c="emerald.3">{chunk.biome}</Text>
                                          <Text size="xs">Danger: {chunk.difficulty}</Text>
                                          {chunk.scanLevel >= ScanLevel.DETAILED && (
                                              <Text size="xs" c="dimmed">{chunk.entities.length} Signals Detected</Text>
                                          )}
                                          {chunk.scanLevel >= ScanLevel.COMPLETE && (
                                              <Text size="xs" c="orange.4" mt={4}>
                                                  !!! ELITE PRESENCE !!!
                                              </Text>
                                          )}
                                      </Stack>
                                  }
                                  color="dark"
                                  transitionProps={{ duration: 0 }}
                              >
                                  <div
                                      onClick={() => handleReconClick(chunk)}
                                      style={{
                                          width: CHUNK_PIXEL_SIZE,
                                          height: CHUNK_PIXEL_SIZE,
                                          backgroundColor: isSelected ? 'var(--mantine-color-gold-5)' : biomeColor,
                                          opacity: isScanned ? 1 : 0.2,
                                          border: isSelected ? '2px solid white' : '1px solid rgba(255,255,255,0.05)',
                                          cursor: 'pointer',
                                          transition: 'all 0.1s',
                                          display: 'flex',
                                          alignItems: 'center',
                                          justifyContent: 'center',
                                          position: 'relative'
                                      }}
                                  >
                                      {/* Fog / Scan Indicators */}
                                      {chunk.scanLevel === ScanLevel.UNKNOWN && (
                                          <Text size="xs" c="dimmed" style={{ fontSize: 8 }}>?</Text>
                                      )}
                                      {/* Extraction Point Marker */}
                                      {chunk.hasExtraction && isScanned && (
                                          <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'cyan' }} />
                                      )}
                                  </div>
                              </Tooltip>
                          );
                      })}
                  </SimpleGrid>
              </Box>

              {/* --- DROP CONTROLS --- */}
              {selectedDropZone && (
                  <Paper pos="absolute" bottom={20} left="50%" style={{ transform: 'translateX(-50%)' }} p="md">
                      <Group>
                          <Stack gap={0}>
                              <Text size="xs" c="dimmed">DROP COORDINATES</Text>
                              <Text fw={700} ff="monospace">
                                  {selectedDropZone.x.toString().padStart(2, '0')} : {selectedDropZone.y.toString().padStart(2, '0')}
                              </Text>
                          </Stack>
                          <Button 
                            color="red" 
                            variant="filled" 
                            size="md"
                            onClick={confirmDrop}
                            className="animate-pulse"
                          >
                              INITIATE DIVE
                          </Button>
                      </Group>
                  </Paper>
              )}
          </Center>
      );
  }

  // ========================================================================
  // 2. TACTICAL VIEW (THE DIVE)
  // ========================================================================
  
  // Grid for rendering local terrain in dive mode
  const tacticalGrid = [];
  // This is a very simplified render loop for the 3D/2D tactical view
  // In a real implementation, we would optimize this to only render visible chunks
  
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
          <Text c="orange" ff="monospace" fw={700}>TACTICAL LINK_ESTABLISHED</Text>
          <Group>
              <Badge color="gray">POS: {Math.round(session.position.x)}, {Math.round(session.position.z)}</Badge>
              <Badge color="red">HOSTILES: ??</Badge>
          </Group>
       </Stack>
       
       {/* WORLD CONTAINER (SCALED) */}
       <div style={{ position: 'relative', transform: 'scale(1.0)' }}>
           
           {/* BULLETS */}
           {renderBullets.map((b, i) => (
               <div 
                 key={`b_${i}`}
                 style={{
                     position: 'absolute',
                     left: b.x * TACTICAL_SCALE, 
                     top: b.y * TACTICAL_SCALE,
                     width: 6, height: 6,
                     backgroundColor: b.color,
                     borderRadius: '50%',
                     transform: 'translate(-50%, -50%)',
                     boxShadow: `0 0 8px ${b.color}`,
                     pointerEvents: 'none'
                 }}
               />
           ))}

           {/* MELEE SWINGS */}
           {activeSwings.map((s, i) => (
               <MeleeArc 
                 key={`s_${i}`}
                 x={s.origin.x}
                 y={s.origin.y} // Using Y as Z for 2D rep
                 angle={s.angle}
                 range={s.range}
                 color="rgba(255, 255, 255, 0.8)"
               />
           ))}
           
           {/* PLAYER */}
           <div style={{
               position: 'absolute',
               left: session.position.x * TACTICAL_SCALE, 
               top: session.position.z * TACTICAL_SCALE, // Map Z to Screen Y
               width: 12, height: 12,
               background: 'white', 
               borderRadius: '50%',
               transform: 'translate(-50%, -50%)',
               zIndex: 10,
               boxShadow: '0 0 10px white'
           }} />
       </div>
    </Center>
  );
};