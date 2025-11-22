import React, { useEffect, useRef, useState, useMemo } from 'react';
import { IActiveSession } from '../../types'; 
import { useWorldStore } from '../entities/world/store';
import { BIOME_DEFINITIONS } from '../entities/world/definitions'; 
import { MOB_DEFINITIONS } from '../entities/mob/data/mobDefinitions';
import { SpriteGenerator } from '../entities/mob/utils/SpriteGenerator';
import { ProjectileSystem, PatternType, IProjectile } from '../entities/combat/projectileSystem'; 
import { Box, Text, Center, Loader, Button, Stack, Group, Tooltip, Badge, SimpleGrid, Paper, Progress } from '@mantine/core';
import { IWorldEntity, ScanLevel, IChunk, EntityType } from '../entities/world/types';

const CHUNK_PIXEL_SIZE = 20;
const TACTICAL_SCALE = 40;

const MeleeArc = ({ x, y, angle, range, color }: any) => (
    <div style={{ position: 'absolute', left: x * TACTICAL_SCALE, top: y * TACTICAL_SCALE, width: range * TACTICAL_SCALE * 2, height: range * TACTICAL_SCALE * 2, borderRadius: '50%', background: `conic-gradient(from ${angle - 0.75 + 1.57}rad, transparent 0deg, ${color} 0deg, ${color} 90deg, transparent 90deg)`, transform: 'translate(-50%, -50%)', opacity: 0.5, pointerEvents: 'none', zIndex: 5 }} />
);

const MobAvatar = ({ entity }: { entity: IWorldEntity }) => {
    const def = MOB_DEFINITIONS[entity.definitionId];
    const spriteUrl = useMemo(() => { if (!def) return ''; return SpriteGenerator.generateBlobSprite(def.colorHex, def.size); }, [def]);
    if (!def) return <div style={{ width: 8, height: 8, background: 'red', borderRadius: '50%' }} />;
    return <div style={{ width: '100%', height: '100%', backgroundImage: `url(${spriteUrl})`, backgroundSize: '800% 100%', backgroundPosition: '0 0', imageRendering: 'pixelated' }} />;
};

export const WorldCanvas: React.FC<{ session: IActiveSession }> = ({ session }) => {
  const { currentMap, reconMode, scanChunk, selectChunk, confirmDrop, selectedDropZone, initiateRecon, fetchChunkData, exitWorld } = useWorldStore();
  
  const [activePatterns, setActivePatterns] = useState<any[]>([]);
  const [activeSwings, setActiveSwings] = useState<any[]>([]);
  const [renderBullets, setRenderBullets] = useState<IProjectile[]>([]);
  const requestRef = useRef<number>();
  
  const isDev = currentMap?.seed.startsWith('dev') || false;
  const PLAYER_RECON_EFFICIENCY = isDev ? 99.0 : 3.5; 
  const [hoverChunk, setHoverChunk] = useState<IChunk | null>(null);

  useEffect(() => {
    if (session.sessionId && (!currentMap || currentMap.seed !== session.sessionId)) {
        initiateRecon(session.sessionId);
    }
  }, [session.sessionId, currentMap, initiateRecon]);

  const animate = (time: number) => {
    if (!reconMode && currentMap) {
        const now = Date.now();
        const allBullets: IProjectile[] = [];
        const livePatterns = activePatterns.filter(p => (now - p.startTime) < 2000);
        if (livePatterns.length !== activePatterns.length) setActivePatterns(livePatterns);

        livePatterns.forEach(p => {
            let bullets = ProjectileSystem.getProjectilesAtTime(p.type, p.origin, p.startTime, now, p.angle);
            const liveSwings = activeSwings.filter(s => (now - s.startTime) < 200);
            bullets = bullets.filter(b => {
                const isDeflected = liveSwings.some(s => ProjectileSystem.checkDeflection(b, s.origin, s.angle));
                return !isDeflected; 
            });
            allBullets.push(...bullets);
        });
        const liveSwings = activeSwings.filter(s => (now - s.startTime) < 200);
        if (liveSwings.length !== activeSwings.length) setActiveSwings(liveSwings);
        setRenderBullets(allBullets);
    }
    requestRef.current = requestAnimationFrame(animate);
  };

  useEffect(() => {
    requestRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(requestRef.current!);
  }, [activePatterns, reconMode]);

  const handleCombatInput = (e: React.MouseEvent) => {
      if (reconMode) return;
      e.preventDefault();
      const angle = -Math.PI / 2; 
      if (e.button === 0) { 
          setActiveSwings(prev => [...prev, { origin: { ...session.position }, angle, startTime: Date.now(), range: 2.0 }]);
      } else if (e.button === 2) { 
          setActivePatterns(prev => [...prev, { type: PatternType.SHOTGUN, origin: { ...session.position }, startTime: Date.now(), angle }]);
      }
  };

  const handleReconClick = (chunk: IChunk) => {
      if (chunk.scanLevel === ScanLevel.UNKNOWN) {
          fetchChunkData(chunk.x, chunk.y);
      } else if (chunk.scanLevel < ScanLevel.COMPLETE) {
          scanChunk(chunk.x, chunk.y, PLAYER_RECON_EFFICIENCY);
      } else {
          selectChunk(chunk.x, chunk.y);
      }
  };

  if (!currentMap) return <Center h="100%"><Loader color="emerald" /></Center>;

  // --- MODE 1: RECON ---
  if (reconMode) {
      const gridSize = currentMap.width;
      const chunks = currentMap.chunks ? Object.values(currentMap.chunks) : [];
      
      let scanText = "UNKNOWN SECTOR";
      let scanColor = "dimmed";
      let scanDetails = null;

      if (hoverChunk) {
          if (hoverChunk.scanLevel === ScanLevel.UNKNOWN) {
              scanText = "UNSCANNED TERRITORY";
          } else if (hoverChunk.scanLevel === ScanLevel.BASIC) {
              scanText = `${hoverChunk.biome} [BASIC INTEL]`;
              scanColor = "emerald.4";
              scanDetails = <Text size="xs">Danger Rank: ???</Text>;
          } else if (hoverChunk.scanLevel === ScanLevel.DETAILED) {
              scanText = `${hoverChunk.biome} [DETAILED INTEL]`;
              scanColor = "blue.4";
              scanDetails = <Text size="xs">Danger: {hoverChunk.difficulty}</Text>;
          } else if (hoverChunk.scanLevel === ScanLevel.COMPLETE) {
              scanText = `${hoverChunk.biome} [COMPLETE INTEL]`;
              scanColor = "orange.4";
              const mobCount = hoverChunk.entities.filter(e => e.type === EntityType.MOB).length;
              scanDetails = <Text size="xs">Hostiles: {mobCount}</Text>;
          }
      }

      return (
          <Center h="100%" bg="dark.9" style={{ position: 'relative' }}>
              <Paper pos="absolute" top={20} left={20} p="md" w={300} style={{ zIndex: 10, borderLeft: `4px solid ${isDev ? 'cyan' : 'var(--mantine-color-blue-6)'}` }}>
                  <Group justify="space-between">
                      <Text size="xs" fw={700} c={isDev ? 'cyan' : 'dimmed'}>{isDev ? 'DEV_OVERRIDE ACTIVE' : 'ORBITAL SCANNER'}</Text>
                      {!session && <Button variant="subtle" size="xs" color="gray" onClick={exitWorld}>ABORT</Button>}
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
                                  {chunk.hasExtraction && level >= ScanLevel.DETAILED && <div style={{ position: 'absolute', inset: 4, borderRadius: '50%', background: 'cyan' }} />}
                              </div>
                          );
                      })}
                  </SimpleGrid>
              </Box>

              {selectedDropZone && (
                  <Button pos="absolute" bottom={40} color="red" size="lg" className="animate-pulse" onClick={confirmDrop}>
                      DEPLOY TO SECTOR {selectedDropZone.x},{selectedDropZone.y}
                  </Button>
              )}
          </Center>
      );
  }

  // --- MODE 2: TACTICAL ---
  const pChunkX = Math.floor(session.position.x / 100);
  const pChunkY = Math.floor(session.position.z / 100);
  const renderRadius = 2; 
  const tacticalChunks = [];

  for (let y = pChunkY - renderRadius; y <= pChunkY + renderRadius; y++) {
    for (let x = pChunkX - renderRadius; x <= pChunkX + renderRadius; x++) {
       const chunkKey = `${x},${y}`;
       const chunk = currentMap.chunks[chunkKey];
       if (chunk) {
           const def = BIOME_DEFINITIONS[chunk.biome];
           const chunkWorldX = x * 100;
           const chunkWorldY = y * 100;
           const relChunkX = (chunkWorldX - session.position.x);
           const relChunkY = (chunkWorldY - session.position.z);

           tacticalChunks.push(
               <div key={`floor_${chunkKey}`} style={{ position: 'absolute', left: `calc(50% + ${relChunkX * TACTICAL_SCALE}px)`, top: `calc(50% + ${relChunkY * TACTICAL_SCALE}px)`, width: 100 * TACTICAL_SCALE, height: 100 * TACTICAL_SCALE, backgroundColor: def?.color || '#222', border: '1px solid rgba(255,255,255,0.1)', backgroundImage: 'radial-gradient(rgba(255,255,255,0.1) 1px, transparent 1px)', backgroundSize: `${TACTICAL_SCALE}px ${TACTICAL_SCALE}px`, zIndex: 0 }} />
           );
           chunk.entities.forEach(ent => {
               const relX = (ent.position.x - session.position.x);
               const relY = (ent.position.y - session.position.z);
               tacticalChunks.push(<div key={ent.id} style={{ position: 'absolute', left: `calc(50% + ${relX * TACTICAL_SCALE}px)`, top: `calc(50% + ${relY * TACTICAL_SCALE}px)`, width: 24, height: 24, transform: 'translate(-50%, -50%)', zIndex: 2 }}>{ent.type === EntityType.MOB ? <MobAvatar entity={ent} /> : <div style={{ width: 12, height: 12, background: 'cyan', borderRadius: 2 }} />}</div>);
           });
       }
    }
  }

  return (
    <Center h="100%" bg="black" onMouseDown={handleCombatInput} onContextMenu={(e) => e.preventDefault()} style={{ cursor: 'crosshair', overflow: 'hidden', position: 'relative' }}>
       <Stack pos="absolute" top={20} left={20} style={{ pointerEvents: 'none', zIndex: 20 }}>
          <Text c="orange" ff="monospace" fw={700}>TACTICAL LINK_ESTABLISHED {isDev ? '[DEV]' : ''}</Text>
          <Group><Badge color="gray" radius="xs">POS: {Math.round(session.position.x)}, {Math.round(session.position.z)}</Badge><Badge color="red" radius="xs">PROJECTILES: {renderBullets.length}</Badge></Group>
       </Stack>
       <div style={{ position: 'absolute', inset: 0 }}>
           {tacticalChunks}
           {renderBullets.map((b, i) => { const relX = b.x - session.position.x; const relY = b.y - session.position.z; return <div key={`b_${i}`} style={{ position: 'absolute', left: `calc(50% + ${relX * TACTICAL_SCALE}px)`, top: `calc(50% + ${relY * TACTICAL_SCALE}px)`, width: 8, height: 8, backgroundColor: b.color, borderRadius: '50%', transform: 'translate(-50%, -50%)', boxShadow: `0 0 8px ${b.color}`, pointerEvents: 'none', zIndex: 4 }} /> })}
           {activeSwings.map((s, i) => { const relX = s.origin.x - session.position.x; const relY = s.origin.y - session.position.z; return <div key={`s_${i}`} style={{ position: 'absolute', left: `calc(50% + ${relX * TACTICAL_SCALE}px)`, top: `calc(50% + ${relY * TACTICAL_SCALE}px)` }}><MeleeArc x={0} y={0} angle={s.angle} range={s.range} color="rgba(255, 255, 255, 0.8)" /></div> })}
           <div style={{ position: 'absolute', left: '50%', top: '50%', width: 16, height: 16, background: 'white', borderRadius: '50%', transform: 'translate(-50%, -50%)', zIndex: 10, boxShadow: '0 0 15px white' }} />
       </div>
    </Center>
  );
};