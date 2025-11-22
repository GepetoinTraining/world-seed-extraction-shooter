import React, { useEffect, useMemo, useState, useRef } from 'react';
import { IActiveSession, UniversalRank } from '../../types'; 
import { useWorldStore } from '../entities/world/store';
import { BiomeType, EntityType, ScanLevel } from '../entities/world/types';
import { BIOME_DEFINITIONS } from '../entities/world/definitions'; 
import { MOB_DEFINITIONS } from '../entities/mob/data/mobDefinitions'; 
import { SpriteGenerator } from '../entities/mob/utils/SpriteGenerator'; 
import { ProjectileSystem, PatternType, IProjectile } from '../entities/combat/projectileSystem'; 
import { Box, Text, Center, Loader, Button, Stack } from '@mantine/core';

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

// --- MAIN CANVAS ---

export const WorldCanvas: React.FC<{ session: IActiveSession }> = ({ session }) => {
  const { currentMap, generateWorld, reconMode, scanChunk, selectChunk, confirmDrop, selectedDropZone } = useWorldStore();
  const [hoverInfo, setHoverInfo] = useState<string>('');
  
  const [activePatterns, setActivePatterns] = useState<any[]>([]);
  // NEW: Active Melee Swings
  const [activeSwings, setActiveSwings] = useState<any[]>([]);
  
  const requestRef = useRef<number>();
  const [renderBullets, setRenderBullets] = useState<IProjectile[]>([]);

  useEffect(() => {
    if (!currentMap) generateWorld(session.sessionId);
  }, [session.sessionId, currentMap, generateWorld]);

  // --- GAME LOOP (60 FPS) ---
  const animate = (time: number) => {
    if (!reconMode) {
        const now = Date.now();
        const allBullets: IProjectile[] = [];
        
        // 1. Calculate Projectiles
        const livePatterns = activePatterns.filter(p => (now - p.startTime) < 2000);
        if (livePatterns.length !== activePatterns.length) setActivePatterns(livePatterns);

        livePatterns.forEach(p => {
            let bullets = ProjectileSystem.getProjectilesAtTime(p.type, p.origin, p.startTime, now, p.angle);
            
            // 2. DEFLECTION LOGIC
            // Check against all active swings
            const liveSwings = activeSwings.filter(s => (now - s.startTime) < 200); // Swings last 200ms
            
            // Mutate bullets array (remove deflected ones)
            bullets = bullets.filter(b => {
                const isDeflected = liveSwings.some(s => 
                    ProjectileSystem.checkDeflection(b, s.origin, s.angle)
                );
                return !isDeflected; 
            });

            allBullets.push(...bullets);
        });
        
        // Cleanup dead swings
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

  // --- INPUT HANDLER ---
  const handleCombatInput = (e: React.MouseEvent) => {
      if (reconMode) return;
      
      // Calculate angle (Using dummy North for now)
      const angle = -Math.PI / 2; 
      
      // LEFT CLICK = MELEE SWING
      if (e.button === 0) {
          const newSwing = {
              origin: { ...session.position },
              angle: angle,
              startTime: Date.now(),
              range: 2.0
          };
          setActiveSwings(prev => [...prev, newSwing]);
      }
      // RIGHT CLICK = SHOOT
      else if (e.button === 2) {
          const newPattern = {
              type: PatternType.SHOTGUN,
              origin: { ...session.position },
              startTime: Date.now(),
              angle: angle
          };
          setActivePatterns(prev => [...prev, newPattern]);
      }
  };

  if (!currentMap) return <Center h="100%"><Loader color="emerald" /></Center>;

  if (reconMode) {
      /* ... existing recon JSX ... */
      return <Center>RECON MODE</Center>; 
  }

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