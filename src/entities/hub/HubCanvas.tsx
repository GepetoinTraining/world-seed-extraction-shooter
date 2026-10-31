/**
 * HubCanvas - The City View
 * Players walk around a fixed city layout, interact with NPCs, access services.
 * NO COMBAT. This is the safe zone.
 */

import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { Box, Text, Paper, Stack, Group, Button, Badge, Modal, Divider } from '@mantine/core';
import { HubGenerator, IHubLayout, IPOI, POIType, HUB_NPCS, INPCDefinition, IHubZone } from './HubGenerator';
import { usePlayerStore } from '../player/store';
import { useHubStore } from './store';
import { useWorldStore } from '../world/store';
import { HUB_TILE_PX, HUB_VIEW_TILES } from './HubCanvas.constants';
import { HUB_GENRE, LotState, composeHub } from '../../render/atoms/hub';
import { Archetype, Facing, WALK_PHASES, castPortrait, figure } from '../../render/atoms/people';
import { ATOM_PX, Sprite, buildPalette } from '../../render/atoms/atoms';

// =============================================================================
// CONSTANTS
// =============================================================================

const TILE_SIZE = HUB_TILE_PX;
const VIEWPORT_TILES = HUB_VIEW_TILES;

// POI Colors for rendering
const POI_COLORS: Record<POIType, string> = {
  [POIType.BANK]: '#ffd700',
  [POIType.PORTAL]: '#06b6d4',
  [POIType.IDENTIFIER]: '#a855f7',
  [POIType.GUILD_HALL]: '#f59e0b',
  [POIType.VENDOR_WEAPONS]: '#ef4444',
  [POIType.VENDOR_ARMOR]: '#3b82f6',
  [POIType.VENDOR_CONSUMABLES]: '#22c55e',
  [POIType.AUCTION_HOUSE]: '#10b981',
  [POIType.TAVERN]: '#78716c',
  [POIType.ARENA]: '#dc2626',
  [POIType.PLAYER_LOT]: '#4b5563',
  [POIType.FOUNTAIN]: '#0ea5e9',
  [POIType.STATUE]: '#9ca3af',
  [POIType.LAMP_POST]: '#fbbf24'
};

// =============================================================================
// COMPONENT
// =============================================================================

function spriteToCanvas(s: Sprite, table: Uint8Array): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = s.w; c.height = s.h;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(s.w, s.h);
  for (let i = 0; i < s.data.length; i++) {
    const v = s.data[i], j = i * 4;
    if (!v) continue;
    img.data[j] = table[v * 3]; img.data[j + 1] = table[v * 3 + 1]; img.data[j + 2] = table[v * 3 + 2]; img.data[j + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

const CastPortrait: React.FC<{ npcId: string }> = ({ npcId }) => {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const art = spriteToCanvas(castPortrait(npcId), buildPalette(HUB_GENRE));
    ctx.drawImage(art, 0, 0, canvas.width, canvas.height);
  }, [npcId]);
  return <canvas ref={ref} width={68} height={68} style={{ imageRendering: 'pixelated', flexShrink: 0 }} />;
};

const HUB_WALK_TILES_PER_S = 3.0; // one world, one pace: the same speed as the field

export const HubCanvas: React.FC = () => {
  // Generate hub layout once
  const layout = useMemo(() => HubGenerator.generate(), []);

  // Player position in PIXELS (Wave 8B: the city walks like the field, smoothly)
  const posRef = useRef({ x: (layout.spawnPoint.x + 0.5) * TILE_SIZE, y: (layout.spawnPoint.y + 0.5) * TILE_SIZE });
  const [playerTile, setPlayerTile] = useState(layout.spawnPoint);
  const [nearbyPOI, setNearbyPOI] = useState<IPOI | null>(null);
  const [dialogueOpen, setDialogueOpen] = useState(false);
  const [activeNPC, setActiveNPC] = useState<INPCDefinition | null>(null);

  const { player } = usePlayerStore();
  const { weaponShop, armorShop, consumableShop, purchaseFromShop, lots } = useHubStore();
  const { refreshWorlds, availableWorlds, selectWorld } = useWorldStore();

  // Additional UI states
  const [shopOpen, setShopOpen] = useState(false);
  const [shopType, setShopType] = useState<'weapon' | 'armor' | 'consumable'>('weapon');
  const [missionOpen, setMissionOpen] = useState(false);
  const cityRef = useRef<HTMLCanvasElement>(null);

  const keysRef = useRef<Set<string>>(new Set());
  const facingRef = useRef<Facing>('down');
  const stepRef = useRef({ step: 0, at: 0 });
  const movingRef = useRef(false);
  const lastTickRef = useRef(0);
  const nearbyRef = useRef<IPOI | null>(null);
  const reducedMotion = useMemo(
    () => typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    []
  );
  nearbyRef.current = nearbyPOI;

  // =========================================================================
  // MOVEMENT: held keys, per-axis sliding against the navmesh
  // =========================================================================

  const blockedAt = useCallback((x: number, y: number) => {
    const tx = Math.floor(x / TILE_SIZE), ty = Math.floor(y / TILE_SIZE);
    return tx < 0 || ty < 0 || tx >= layout.width || ty >= layout.height || !layout.navMesh[ty][tx];
  }, [layout]);

  // Keyboard input
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (key === 'e' || key === 'enter') {
        if (nearbyRef.current?.interactable) handleInteract(nearbyRef.current);
        return;
      }
      keysRef.current.add(key);
    };
    const handleKeyUp = (e: KeyboardEvent) => keysRef.current.delete(e.key.toLowerCase());
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // =========================================================================
  // PROXIMITY DETECTION (within 3 tiles of an interactable's center)
  // =========================================================================

  useEffect(() => {
    let closest: IPOI | null = null;
    let closestDist = Infinity;

    for (const zone of layout.zones) {
      for (const poi of zone.pois) {
        if (!poi.interactable) continue;

        // Distance to POI center
        const poiCenterX = poi.position.x + poi.size.width / 2;
        const poiCenterY = poi.position.y + poi.size.height / 2;
        const dist = Math.sqrt(
          Math.pow(playerTile.x + 0.5 - poiCenterX, 2) +
          Math.pow(playerTile.y + 0.5 - poiCenterY, 2)
        );

        if (dist < 3 && dist < closestDist) {
          closest = poi;
          closestDist = dist;
        }
      }
    }

    setNearbyPOI(closest);
  }, [playerTile, layout]);
  
  // =========================================================================
  // INTERACTION
  // =========================================================================
  
  const handleInteract = (poi: IPOI) => {
    if (poi.npcId && HUB_NPCS[poi.npcId]) {
      setActiveNPC(HUB_NPCS[poi.npcId]);
      setDialogueOpen(true);
    } else if (poi.type === POIType.PLAYER_LOT) {
      // Handle lot purchase/view
      console.log('[HUB] Interacting with lot:', poi.id);
    }
  };
  
  const handleDialogueOption = (action: string, payload?: any) => {
    console.log('[HUB] Dialogue action:', action, payload);
    
    switch (action) {
      case 'CLOSE':
        setDialogueOpen(false);
        setActiveNPC(null);
        break;
      case 'OPEN_BANK':
        // Would navigate to bank view
        console.log('[HUB] Opening Bank...');
        setDialogueOpen(false);
        break;
      case 'OPEN_MISSIONS':
        refreshWorlds();
        setMissionOpen(true);
        setDialogueOpen(false);
        break;
      case 'OPEN_SHOP':
        if (payload?.category === 'weapons') {
          setShopType('weapon');
        } else if (payload?.category === 'armor') {
          setShopType('armor');
        } else if (payload?.category === 'consumables') {
          setShopType('consumable');
        }
        setShopOpen(true);
        setDialogueOpen(false);
        break;
      case 'IDENTIFY_ITEM':
        console.log('[HUB] Opening Identifier...');
        setDialogueOpen(false);
        break;
      case 'BUY_CONSUMABLE':
        console.log('[HUB] Buying consumable:', payload);
        setDialogueOpen(false);
        break;
      default:
        console.log('[HUB] Unhandled action:', action);
    }
  };
  
  // =========================================================================
  // RENDER HELPERS
  // =========================================================================
  
  const currentZone = useMemo(() =>
    HubGenerator.getZoneAtPosition(layout, playerTile.x, playerTile.y),
    [layout, playerTile]
  );
  
  // The city as the game really has it: its lots from the store, redrawn only when they change
  const lotStates = useMemo(() => {
    const states: Partial<Record<number, LotState>> = {};
    lots.forEach(l => {
      states[l.lotIndex] = !l.ownerId ? 'FOR_SALE' : l.structureType === 'EMPTY' ? 'OWNED_EMPTY' : l.structureType;
    });
    return states;
  }, [lots]);

  const cityBitmaps = useMemo(() => {
    const palette = buildPalette(HUB_GENRE);
    return [0, 1].map(frame => spriteToCanvas(composeHub(layout, { frame, lots: lotStates }), palette));
  }, [layout, lotStates]);

  // Where the camera sits, in px, clamped to the city's edge
  const cameraOffset = useCallback(() => {
    const viewPx = VIEWPORT_TILES * TILE_SIZE;
    return {
      x: Math.max(0, Math.min(layout.width * TILE_SIZE - viewPx, posRef.current.x - viewPx / 2)),
      y: Math.max(0, Math.min(layout.height * TILE_SIZE - viewPx, posRef.current.y - viewPx / 2))
    };
  }, [layout]);

  // THE WALK LOOP: held keys move the player every frame, the same as the field.
  useEffect(() => {
    const canvas = cityRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const palette = buildPalette(HUB_GENRE);
    const bodies = new Map<string, HTMLCanvasElement>();
    const bodyFor = (facing: Facing, step: number, moving: boolean) => {
      const key = `${facing}:${moving ? step : 'stand'}`;
      let c = bodies.get(key);
      if (!c) {
        c = spriteToCanvas(figure({
          uid: player.id, archetype: (player.archetype || 'OPERATOR') as Archetype, facing, step, moving
        }), palette);
        bodies.set(key, c);
      }
      return c;
    };

    let raf = 0;
    lastTickRef.current = performance.now();
    const loop = (time: number) => {
      const dt = Math.min((time - lastTickRef.current) / 1000, 0.1);
      lastTickRef.current = time;

      const keys = keysRef.current;
      let dx = 0, dy = 0;
      if (keys.has('w') || keys.has('arrowup')) dy -= 1;
      if (keys.has('s') || keys.has('arrowdown')) dy += 1;
      if (keys.has('a') || keys.has('arrowleft')) dx -= 1;
      if (keys.has('d') || keys.has('arrowright')) dx += 1;

      const p = posRef.current;
      if (dx !== 0 || dy !== 0) {
        const len = Math.hypot(dx, dy);
        const step = HUB_WALK_TILES_PER_S * TILE_SIZE * dt;
        const mx = (dx / len) * step, my = (dy / len) * step;
        // Per-axis sliding against the navmesh, same rule as the field's terrain
        let nx = p.x + mx;
        if (blockedAt(nx, p.y) && !blockedAt(p.x, p.y)) nx = p.x;
        let ny = p.y + my;
        if (blockedAt(nx, ny) && !blockedAt(nx, p.y)) ny = p.y;
        p.x = nx; p.y = ny;
        facingRef.current = Math.abs(mx) > Math.abs(my) ? (mx > 0 ? 'right' : 'left') : (my > 0 ? 'down' : 'up');
        movingRef.current = true;
        if (time - stepRef.current.at > 560 / WALK_PHASES) {
          stepRef.current = { step: (stepRef.current.step + 1) % WALK_PHASES, at: time };
        }
        const tile = { x: Math.floor(p.x / TILE_SIZE), y: Math.floor(p.y / TILE_SIZE) };
        setPlayerTile(prev => (prev.x === tile.x && prev.y === tile.y ? prev : tile));
      } else if (movingRef.current) {
        movingRef.current = false;
        stepRef.current = { step: 0, at: 0 };
      }

      ctx.imageSmoothingEnabled = false;
      const cam = cameraOffset();
      const ox = Math.round(cam.x / 2) * 2, oy = Math.round(cam.y / 2) * 2; // snap to the atom grid
      ctx.fillStyle = '#050505';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      const frame = reducedMotion ? 0 : Math.floor(time / 500) % 2;
      const city = cityBitmaps[frame];
      ctx.drawImage(city, -ox, -oy, city.width * ATOM_PX, city.height * ATOM_PX);
      const body = bodyFor(facingRef.current, stepRef.current.step, movingRef.current);
      const w = body.width * ATOM_PX, h = body.height * ATOM_PX;
      ctx.drawImage(body, Math.round((p.x - w / 2 - ox) / 2) * 2, Math.round((p.y - h / 2 - oy) / 2) * 2, w, h);
      const poi = nearbyRef.current;
      if (poi) {
        ctx.strokeStyle = '#fafafa';
        ctx.lineWidth = 2;
        ctx.strokeRect(poi.position.x * TILE_SIZE - ox - 1, poi.position.y * TILE_SIZE - oy - 1, poi.size.width * TILE_SIZE + 2, poi.size.height * TILE_SIZE + 2);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [cityBitmaps, player.id, player.archetype, blockedAt, cameraOffset, reducedMotion]);

  const handleCityClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const cam = cameraOffset();
    const tx = Math.floor((e.clientX - box.left + cam.x) / TILE_SIZE);
    const ty = Math.floor((e.clientY - box.top + cam.y) / TILE_SIZE);
    const poi = HubGenerator.getPOIAtPosition(layout, tx, ty);
    if (poi?.interactable) handleInteract(poi);
  };

  // =========================================================================
  // RENDER
  // =========================================================================
  
  return (
    <Box style={{ position: 'relative', width: '100%', height: '100%', background: '#0a0a0a', overflow: 'hidden' }}>
      
      {/* HUD - Top Left */}
      <Paper pos="absolute" top={16} left={16} p="sm" bg="dark.8" withBorder style={{ zIndex: 100 }}>
        <Stack gap={4}>
          <Group gap="xs">
            <Badge color="gold" size="sm">{player.bank.gold.toLocaleString()} G</Badge>
            <Badge color="emerald" size="sm">{player.username}</Badge>
          </Group>
          {currentZone && (
            <Text size="xs" c="dimmed">{currentZone.name}</Text>
          )}
          <Text size="xs" c="dimmed" ff="monospace">
            {playerTile.x}, {playerTile.y}
          </Text>
        </Stack>
      </Paper>
      
      {/* Interaction Prompt */}
      {nearbyPOI && (
        <Paper 
          pos="absolute" 
          bottom={100} 
          left="50%" 
          style={{ transform: 'translateX(-50%)', zIndex: 100 }}
          p="sm" 
          bg="dark.7"
          withBorder
        >
          <Group gap="sm">
            <Text size="sm" fw={600}>{nearbyPOI.name}</Text>
            <Badge color="emerald" size="xs">[E] Interact</Badge>
          </Group>
        </Paper>
      )}
      
      {/* Controls Hint */}
      <Paper pos="absolute" bottom={16} right={16} p="xs" bg="dark.8" withBorder style={{ zIndex: 100 }}>
        <Text size="xs" c="dimmed">WASD to move • E to interact</Text>
      </Paper>
      
      {/* THE CITY */}
      <canvas
        ref={cityRef}
        width={VIEWPORT_TILES * TILE_SIZE}
        height={VIEWPORT_TILES * TILE_SIZE}
        onClick={handleCityClick}
        style={{
          position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)',
          border: '1px solid #333', imageRendering: 'pixelated', cursor: nearbyPOI ? 'pointer' : 'default'
        }}
      />

      {/* NPC Dialogue Modal */}
      <Modal
        opened={dialogueOpen}
        onClose={() => setDialogueOpen(false)}
        title={activeNPC ? `${activeNPC.name} - ${activeNPC.title}` : 'Dialogue'}
        centered
        size="md"
        styles={{
          header: { backgroundColor: 'var(--mantine-color-dark-7)' },
          body: { backgroundColor: 'var(--mantine-color-dark-7)' }
        }}
      >
        {activeNPC && (
          <Stack>
            {/* NPC Portrait */}
            <Group>
              <CastPortrait npcId={activeNPC.id} />
              <Paper p="sm" bg="dark.6" flex={1}>
                <Text size="sm" fs="italic">"{activeNPC.dialogue.greeting}"</Text>
              </Paper>
            </Group>
            
            <Divider />
            
            {/* Options */}
            <Stack gap="xs">
              {activeNPC.dialogue.options.map((opt, i) => (
                <Button
                  key={i}
                  variant={opt.action === 'CLOSE' ? 'subtle' : 'outline'}
                  color={opt.action === 'CLOSE' ? 'gray' : 'emerald'}
                  onClick={() => handleDialogueOption(opt.action, opt.payload)}
                  fullWidth
                  justify="flex-start"
                >
                  {opt.label}
                </Button>
              ))}
            </Stack>
          </Stack>
        )}
      </Modal>
      
      {/* Shop Modal */}
      <Modal
        opened={shopOpen}
        onClose={() => setShopOpen(false)}
        title={`${shopType.charAt(0).toUpperCase() + shopType.slice(1)} Shop`}
        centered
        size="lg"
        styles={{
          header: { backgroundColor: 'var(--mantine-color-dark-7)' },
          body: { backgroundColor: 'var(--mantine-color-dark-7)' }
        }}
      >
        <Stack>
          <Text size="sm" c="dimmed">Your Gold: {player.bank.gold.toLocaleString()} G</Text>
          <Divider />
          {(shopType === 'weapon' ? weaponShop : shopType === 'armor' ? armorShop : consumableShop).map(listing => (
            <Paper key={listing.id} p="sm" bg="dark.6" withBorder>
              <Group justify="space-between">
                <div>
                  <Text fw={600}>{listing.item.name}</Text>
                  <Text size="xs" c="dimmed">Stock: {listing.stock}</Text>
                </div>
                <Group>
                  <Badge color="gold">{listing.price} G</Badge>
                  <Button 
                    size="xs" 
                    color="emerald"
                    disabled={listing.stock <= 0 || player.bank.gold < listing.price}
                    onClick={() => {
                      const item = purchaseFromShop(listing.id, shopType);
                      if (item) console.log('[HUB] Purchased:', item.name);
                    }}
                  >
                    Buy
                  </Button>
                </Group>
              </Group>
            </Paper>
          ))}
        </Stack>
      </Modal>
      
      {/* Mission Selection Modal */}
      <Modal
        opened={missionOpen}
        onClose={() => setMissionOpen(false)}
        title="Available Extraction Zones"
        centered
        size="xl"
        styles={{
          header: { backgroundColor: 'var(--mantine-color-dark-7)' },
          body: { backgroundColor: 'var(--mantine-color-dark-7)' }
        }}
      >
        <Stack>
          {availableWorlds.map(world => (
            <Paper key={world.id} p="md" bg="dark.6" withBorder>
              <Group justify="space-between">
                <div>
                  <Group gap="xs">
                    <Text fw={700}>{world.seed.toUpperCase()}</Text>
                    {world.isDebug && <Badge color="cyan" size="xs">DEV</Badge>}
                  </Group>
                  <Text size="xs" c="dimmed">{world.size}x{world.size} • {world.playerCount} agents</Text>
                </div>
                <Button 
                  color={world.isDebug ? 'cyan' : 'red'}
                  onClick={() => {
                    selectWorld(world.id);
                    setMissionOpen(false);
                  }}
                >
                  DEPLOY
                </Button>
              </Group>
            </Paper>
          ))}
        </Stack>
      </Modal>
    </Box>
  );
};

export default HubCanvas;