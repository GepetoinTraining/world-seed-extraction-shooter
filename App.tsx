import React, { useEffect, useRef, useState } from 'react';
import { usePlayerStore } from './src/entities/player/store';
import { useWorldStore } from './src/entities/world/store';
import { BiomeType, ScanLevel, IChunk } from './src/entities/world/types';
import { BIOME_DEFINITIONS } from './src/entities/world/definitions'; 
import { ProjectileSystem, PatternType, IProjectile } from './src/entities/combat/projectileSystem'; 
import { Box, Text, Center, Loader, Button, Stack, Group, Tooltip, Badge, SimpleGrid, Paper } from '@mantine/core';

// --- CONSTANTS ---
const CHUNK_PIXEL_SIZE = 20;
const TACTICAL_SCALE = 40;

// --- MELEE ARC VISUAL ---
const MeleeArc = ({ x, y, angle, range, color }: { x: number, y: number, angle: number, range: number, color: string }) => (
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

// =============================================================================
// MAIN APP COMPONENT
// =============================================================================
const App: React.FC = () => {
  const { player, view, diveIntoLayer, emergencyJackOut } = usePlayerStore();
  const session = player.currentSession;

  // If no active session, show the BANK/HUB view
  if (!session) {
    return (
      <Center h="100vh" bg="dark.9">
        <Stack align="center" gap="lg">
          <Text size="xl" fw={700} c="gold.4">WORLD SEED // GENESIS</Text>
          <Text c="dimmed">No active session. You are in the Hub.</Text>
          <Button color="emerald" size="lg" onClick={() => diveIntoLayer('layer-01')}>
            INITIATE DIVE SEQUENCE
          </Button>
        </Stack>
      </Center>
    );
  }

  // Active session exists - render the game world
  return <WorldCanvas session={session} onExtract={emergencyJackOut} />;
};

// =============================================================================
// WORLD CANVAS - THE ACTUAL GAME
// =============================================================================
interface WorldCanvasProps {
  session: { sessionId: string; position: { x: number; y: number; z: number } };
  onExtract: () => void;
}

const WorldCanvas: React.FC<WorldCanvasProps> = ({ session, onExtract }) => {
  const { currentMap, initiateRecon, reconMode, fetchChunkData, selectChunk, confirmDrop, selectedDropZone } = useWorldStore();
  
  // Combat State
  const [activePatterns, setActivePatterns] = useState<any[]>([]);
  const [activeSwings, setActiveSwings] = useState<any[]>([]);
  const [renderBullets, setRenderBullets] = useState<IProjectile[]>([]);
  const [playerPos, setPlayerPos] = useState({ x: 5, y: 5 });
  const requestRef = useRef<number>();

  // Recon Stats (mock)
  const PLAYER_RECON_EFFICIENCY = 2.5; 
  const PLAYER_SCAN_ENERGY = 100;

  // Initialize world on mount
  useEffect(() => {
    if (!currentMap) initiateRecon(session.sessionId);
  }, [session.sessionId, currentMap, initiateRecon]);

  // Game Loop (60 FPS)
  useEffect(() => {
    const animate = () => {
      if (!reconMode) {
        const now = Date.now();
        const allBullets: IProjectile[] = [];
        
        // Update projectiles
        const livePatterns = activePatterns.filter(p => (now - p.startTime) < 2000);
        if (livePatterns.length !== activePatterns.length) setActivePatterns(livePatterns);

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
        
        // Cleanup swings
        const liveSwings = activeSwings.filter(s => (now - s.startTime) < 200);
        if (liveSwings.length !== activeSwings.length) setActiveSwings(liveSwings);

        setRenderBullets(allBullets);
      }
      requestRef.current = requestAnimationFrame(animate);
    };
    
    requestRef.current = requestAnimationFrame(animate);
    return () => { if (requestRef.current) cancelAnimationFrame(requestRef.current); };
  }, [activePatterns, activeSwings, reconMode]);

  // Keyboard movement
  useEffect(() => {
    if (reconMode) return;
    
    const handleKey = (e: KeyboardEvent) => {
      const speed = 0.5;
      setPlayerPos(p => {
        switch(e.key.toLowerCase()) {
          case 'w': return { ...p, y: p.y - speed };
          case 's': return { ...p, y: p.y + speed };
          case 'a': return { ...p, x: p.x - speed };
          case 'd': return { ...p, x: p.x + speed };
          default: return p;
        }
      });
    };
    
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [reconMode]);

  // Combat input handler
  const handleCombatInput = (e: React.MouseEvent) => {
    if (reconMode) return;
    e.preventDefault();
    
    // Calculate angle to mouse
    const rect = e.currentTarget.getBoundingClientRect();
    const mouseX = e.clientX - rect.left - rect.width / 2;
    const mouseY = e.clientY - rect.top - rect.height / 2;
    const angle = Math.atan2(mouseY, mouseX);
    
    if (e.button === 0) { // Left Click: Melee
      setActiveSwings(prev => [...prev, {
        origin: { ...playerPos },
        angle,
        startTime: Date.now(),
        range: 2.0
      }]);
    } else if (e.button === 2) { // Right Click: Shoot
      setActivePatterns(prev => [...prev, {
        type: PatternType.SHOTGUN,
        origin: { ...playerPos },
        startTime: Date.now(),
        angle
      }]);
    }
  };

  // Recon interaction
  const handleReconClick = (chunk: IChunk) => {
    if (chunk.scanLevel < ScanLevel.DETAILED) {
      fetchChunkData(chunk.x, chunk.y);
    } else {
      selectChunk(chunk.x, chunk.y);
    }
  };

  // Loading state
  if (!currentMap) {
    return <Center h="100vh" bg="dark.9"><Loader color="emerald" /></Center>;
  }

  // =========================================================================
  // RECON MODE (Strategy Layer)
  // =========================================================================
  if (reconMode) {
    const gridSize = currentMap.width;
    
    return (
      <Center h="100vh" bg="dark.9" style={{ position: 'relative' }}>
        
        {/* Squad Panel */}
        <Paper pos="absolute" top={20} left={20} p="md" w={300} 
          style={{ borderLeft: '4px solid var(--mantine-color-emerald-6)' }}>
          <Text size="xs" fw={700} c="dimmed" tt="uppercase" mb="xs">Squad Uplink // [ALPHA-1]</Text>
          <Stack gap="xs">
            <Group justify="space-between">
              <Group gap="xs">
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#22c55e' }} />
                <Text size="sm">You</Text>
              </Group>
              <Badge size="xs" color="emerald">READY</Badge>
            </Group>
          </Stack>
          
          <Paper mt="md" p="xs" bg="dark.7">
            <Group justify="space-between">
              <Text size="xs">RECON ENERGY</Text>
              <Text size="xs" c="emerald.4" fw={700}>{PLAYER_SCAN_ENERGY} / 100</Text>
            </Group>
          </Paper>
        </Paper>

        {/* Map Grid */}
        <Box p="xl">
          <SimpleGrid cols={gridSize} spacing={1}>
            {Object.values(currentMap.chunks).map((chunk) => {
              const isScanned = chunk.scanLevel > ScanLevel.UNKNOWN;
              const isSelected = selectedDropZone?.x === chunk.x && selectedDropZone?.y === chunk.y;
              const biomeColor = isScanned ? (BIOME_DEFINITIONS[chunk.biome]?.color || '#444') : '#111';
              
              return (
                <Tooltip 
                  key={chunk.id}
                  label={!isScanned ? "Uncharted" : `${chunk.biome} [${chunk.difficulty}]`}
                  color="dark"
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
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {chunk.scanLevel === ScanLevel.UNKNOWN && (
                      <Text size="xs" c="dimmed" style={{ fontSize: 8 }}>?</Text>
                    )}
                    {chunk.hasExtraction && isScanned && (
                      <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'cyan' }} />
                    )}
                  </div>
                </Tooltip>
              );
            })}
          </SimpleGrid>
        </Box>

        {/* Drop Button */}
        {selectedDropZone && (
          <Paper pos="absolute" bottom={20} left="50%" style={{ transform: 'translateX(-50%)' }} p="md">
            <Group>
              <Stack gap={0}>
                <Text size="xs" c="dimmed">DROP COORDINATES</Text>
                <Text fw={700} ff="monospace">
                  {selectedDropZone.x.toString().padStart(2, '0')} : {selectedDropZone.y.toString().padStart(2, '0')}
                </Text>
              </Stack>
              <Button color="red" variant="filled" size="md" onClick={confirmDrop}>
                INITIATE DIVE
              </Button>
            </Group>
          </Paper>
        )}
      </Center>
    );
  }

  // =========================================================================
  // TACTICAL MODE (The Actual Game)
  // =========================================================================
  return (
    <Center 
      h="100vh" 
      bg="black" 
      onMouseDown={handleCombatInput}
      onContextMenu={(e) => e.preventDefault()}
      style={{ cursor: 'crosshair', overflow: 'hidden', position: 'relative' }}
    >
      {/* HUD */}
      <Stack pos="absolute" top={20} left={20} style={{ pointerEvents: 'none', zIndex: 20 }}>
        <Text c="orange" ff="monospace" fw={700}>TACTICAL LINK // ESTABLISHED</Text>
        <Group gap="xs">
          <Badge color="gray">POS: {playerPos.x.toFixed(1)}, {playerPos.y.toFixed(1)}</Badge>
          <Badge color="red">BULLETS: {renderBullets.length}</Badge>
        </Group>
        <Text size="xs" c="dimmed">WASD to move | LMB: Melee | RMB: Shoot</Text>
      </Stack>
      
      {/* Extract Button */}
      <Button pos="absolute" top={20} right={20} color="gold" onClick={onExtract}>
        EXTRACT
      </Button>

      {/* Game World */}
      <div style={{ position: 'relative', width: 600, height: 600, background: '#111', border: '1px solid #333' }}>
        
        {/* Bullets */}
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

        {/* Melee Swings */}
        {activeSwings.map((s, i) => (
          <MeleeArc 
            key={`s_${i}`}
            x={s.origin.x}
            y={s.origin.y}
            angle={s.angle}
            range={s.range}
            color="rgba(255, 255, 255, 0.8)"
          />
        ))}
        
        {/* Player */}
        <div style={{
          position: 'absolute',
          left: playerPos.x * TACTICAL_SCALE, 
          top: playerPos.y * TACTICAL_SCALE,
          width: 16, height: 16,
          background: 'white', 
          borderRadius: '50%',
          transform: 'translate(-50%, -50%)',
          zIndex: 10,
          boxShadow: '0 0 15px white'
        }} />
      </div>
    </Center>
  );
};

export default App;