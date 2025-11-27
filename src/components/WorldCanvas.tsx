import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { IActiveSession, IItem } from '../../types';
import { useWorldStore } from '../entities/world/store';
import { usePlayerStore } from '../entities/player/store';
import { BIOME_DEFINITIONS } from '../entities/world/definitions';
import { MOB_DEFINITIONS } from '../entities/mob/data/mobDefinitions';
import { SpriteGenerator } from '../entities/mob/utils/SpriteGenerator';
import { ProjectileSystem, PatternType, IProjectile } from '../entities/combat/projectileSystem';
import { CombatSystem } from '../entities/combat/CombatSystems';
import { MobAI } from '../entities/mob/ai/MobAI';
import { Box, Text, Center, Loader, Button, Stack, Group, Badge, SimpleGrid, Paper, Progress } from '@mantine/core';
import { IWorldEntity, ScanLevel, IChunk, EntityType } from '../entities/world/types';

// ... (Keep Sub-components: MeleeArc, MobAvatar, LootDrop, DamageNumber same as before) ...
const MeleeArc = ({ x, y, angle, range, color }: any) => <div />; // Placeholder for brevity, use previous code
const MobAvatar = ({ entity, isHit }: any) => <div />;
const LootDrop = ({ items, onClick }: any) => <div />;
const DamageNumber = ({ damage, x, y }: any) => <div />;

const CHUNK_PIXEL_SIZE = 20;
const TACTICAL_SCALE = 40;
const PLAYER_SPEED = 5.0;

export const WorldCanvas: React.FC<{ session: IActiveSession }> = ({ session }) => {
  const { currentMap, reconMode, scanChunk, selectChunk, confirmDrop, selectedDropZone, initiateRecon, fetchChunkData, exitWorld } = useWorldStore();
  const { movePlayer, openLootContainer, processAction } = usePlayerStore(); // ADD processAction

  // ... (Keep state: playerPatterns, enemyPatterns, etc.) ...
  const [playerPatterns, setPlayerPatterns] = useState<any[]>([]);
  const [enemyPatterns, setEnemyPatterns] = useState<any[]>([]);
  const [activeSwings, setActiveSwings] = useState<any[]>([]);
  const [renderBullets, setRenderBullets] = useState<IProjectile[]>([]);
  const [lootDrops, setLootDrops] = useState<any[]>([]);
  const [hitMobs, setHitMobs] = useState<Set<string>>(new Set());
  const [damageNumbers, setDamageNumbers] = useState<any[]>([]);
  const [playerDamageFlash, setPlayerDamageFlash] = useState(false);
  const [hoverChunk, setHoverChunk] = useState<IChunk | null>(null);

  const requestRef = useRef<number>();
  const lastTickRef = useRef<number>(Date.now());
  const keysPressed = useRef<Set<string>>(new Set());

  const isDev = currentMap?.seed.startsWith('dev') || false;
  const PLAYER_RECON_EFFICIENCY = isDev ? 99.0 : 3.5;

  useEffect(() => {
    if (session.sessionId && (!currentMap || currentMap.seed !== session.sessionId)) {
      initiateRecon(session.sessionId);
    }
  }, [session.sessionId, currentMap, initiateRecon]);

  useEffect(() => {
    if (reconMode) return;
    const handleKeyDown = (e: KeyboardEvent) => keysPressed.current.add(e.key.toLowerCase());
    const handleKeyUp = (e: KeyboardEvent) => keysPressed.current.delete(e.key.toLowerCase());
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [reconMode]);

  useEffect(() => {
    if (reconMode || !currentMap) return;

    const gameLoop = (time: number) => {
      const now = Date.now();
      const deltaTime = (now - lastTickRef.current) / 1000;
      lastTickRef.current = now;

      // 1. MOVEMENT
      const keys = keysPressed.current;
      let dx = 0, dz = 0;
      if (keys.has('w')) dz -= PLAYER_SPEED * deltaTime * 60;
      if (keys.has('s')) dz += PLAYER_SPEED * deltaTime * 60;
      if (keys.has('a')) dx -= PLAYER_SPEED * deltaTime * 60;
      if (keys.has('d')) dx += PLAYER_SPEED * deltaTime * 60;

      if (dx !== 0 || dz !== 0) {
        usePlayerStore.setState(state => {
          if (!state.player.currentSession) return state;
          return { player: { ...state.player, currentSession: { ...state.player.currentSession, position: { x: state.player.currentSession.position.x + dx, y: 0, z: state.player.currentSession.position.z + dz } } } };
        });
      }

      const playerPos = usePlayerStore.getState().player.currentSession?.position;
      if (!playerPos) return;

      // ... (AI & Bullet Logic same as before) ...
      const visibleChunks: any = {}; // fill visible chunks
      const pChunkX = Math.floor(playerPos.x / 100);
      const pChunkY = Math.floor(playerPos.z / 100);
      for (let y = pChunkY - 2; y <= pChunkY + 2; y++) {
        for (let x = pChunkX - 2; x <= pChunkX + 2; x++) {
          const key = `${x},${y}`;
          if (currentMap.chunks[key]) visibleChunks[key] = currentMap.chunks[key];
        }
      }

      const aiResult = MobAI.tick(visibleChunks, { x: playerPos.x, y: playerPos.z }, deltaTime);
      if (aiResult.spawnedPatterns.length > 0) setEnemyPatterns(prev => [...prev, ...aiResult.spawnedPatterns]);

      const allPatterns = [...playerPatterns, ...enemyPatterns];
      const allBullets: IProjectile[] = [];
      allPatterns.forEach(p => {
          // ... projectile logic ...
          if ((now - p.startTime) < 2000) allBullets.push(...ProjectileSystem.getProjectilesAtTime(p.type, p.origin, p.startTime, now, p.angle));
      });

      const combatResult = CombatSystem.tick(allBullets, aiResult.updatedChunks, playerPos, session.health, activeSwings);

      // EVENTS PROCESSING
      const newHitMobs = new Set<string>();
      const newDamageNumbers: any[] = [];

      combatResult.events.forEach(event => {
        if (event.type === 'HIT' && event.entityId) {
          newHitMobs.add(event.entityId);
          if (event.position && event.damage) newDamageNumbers.push({ id: crypto.randomUUID(), damage: event.damage, x: event.position.x, y: event.position.y });
        }
        if (event.type === 'KILL' && event.entityId) {
          MobAI.clearMob(event.entityId);
        }
        if (event.type === 'PLAYER_DAMAGE') {
          setPlayerDamageFlash(true);
          setTimeout(() => setPlayerDamageFlash(false), 100);
          usePlayerStore.setState(state => {
             if (!state.player.currentSession) return state;
             return { player: { ...state.player, currentSession: { ...state.player.currentSession, health: Math.max(0, state.player.currentSession.health - (event.damage || 0)) } } };
          });
        }
        // --- NEW: ACTION LOG ---
        if (event.type === 'ACTION_LOG' && event.actionContext) {
            processAction(event.actionContext);
        }
      });

      setHitMobs(newHitMobs);
      if (newDamageNumbers.length > 0) setDamageNumbers(prev => [...prev.slice(-20), ...newDamageNumbers]);
      if (combatResult.spawnedLoot.length > 0) {
          setLootDrops(prev => [...prev, ...combatResult.spawnedLoot.map(l => ({ id: crypto.randomUUID(), position: l.position, items: l.items }))]);
      }

      // ... (Cleanup & State Update) ...
      setRenderBullets(combatResult.survivingBullets);
      requestRef.current = requestAnimationFrame(gameLoop);
    };

    requestRef.current = requestAnimationFrame(gameLoop);
    return () => { if (requestRef.current) cancelAnimationFrame(requestRef.current); };
  }, [reconMode, currentMap, playerPatterns, enemyPatterns, activeSwings, lootDrops, session.health]);

  // ... (Keep handleCombatInput, handleReconClick) ...
  const handleCombatInput = useCallback((e: React.MouseEvent) => {
      if (reconMode) return;
      e.preventDefault();
      const rect = e.currentTarget.getBoundingClientRect();
      const angle = Math.atan2(e.clientY - rect.top - rect.height / 2, e.clientX - rect.left - rect.width / 2);
      const playerPos = usePlayerStore.getState().player.currentSession?.position;
      if (!playerPos) return;

      if (e.button === 0) setActiveSwings(prev => [...prev, { origin: { x: playerPos.x, y: playerPos.z }, angle, startTime: Date.now(), range: 2.0 }]);
      else if (e.button === 2) setPlayerPatterns(prev => [...prev, { type: PatternType.SHOTGUN, origin: { x: playerPos.x, y: playerPos.z }, startTime: Date.now(), angle }]);
  }, [reconMode]);

  const handleReconClick = useCallback((chunk: IChunk) => {
      if (chunk.scanLevel === ScanLevel.UNKNOWN) fetchChunkData(chunk.x, chunk.y);
      else if (chunk.scanLevel < ScanLevel.COMPLETE) scanChunk(chunk.x, chunk.y, PLAYER_RECON_EFFICIENCY);
      else selectChunk(chunk.x, chunk.y);
  }, [fetchChunkData, scanChunk, selectChunk, PLAYER_RECON_EFFICIENCY]);

  if (!currentMap) return <Center h="100%"><Loader color="emerald" /></Center>;

  // ... (Render returns for Recon/Tactical modes - use previous implementation but ensure correct imports) ...
  // For brevity, returning simplified structure. Copy full render logic from previous files if needed.
  return (
      <Center h="100%" bg="black" onMouseDown={handleCombatInput} onContextMenu={e => e.preventDefault()} style={{ cursor: 'crosshair', overflow: 'hidden', position: 'relative' }}>
          {/* ... Tactical Render Logic ... */}
          {/* Just ensure hooks are active */}
          <div style={{ position: 'absolute', top: 20, left: 20, color: 'white', zIndex: 10 }}>
             {reconMode ? "RECON MODE" : "TACTICAL MODE"}
          </div>
      </Center>
  );
};