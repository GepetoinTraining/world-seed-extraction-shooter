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
import { Archetype, Facing, castPortrait, figure } from '../../render/atoms/people';
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

export const HubCanvas: React.FC = () => {
  // Generate hub layout once
  const layout = useMemo(() => HubGenerator.generate(), []);
  
  // Player position (tiles, not pixels)
  const [playerPos, setPlayerPos] = useState(layout.spawnPoint);
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
  const [facing, setFacing] = useState<Facing>('down');
  const cityRef = useRef<HTMLCanvasElement>(null);
  
  // =========================================================================
  // MOVEMENT
  // =========================================================================
  
  const movePlayer = useCallback((dx: number, dy: number) => {
    setPlayerPos(prev => {
      const newX = prev.x + dx;
      const newY = prev.y + dy;
      
      // Bounds check
      if (newX < 0 || newX >= layout.width || newY < 0 || newY >= layout.height) {
        return prev;
      }
      
      // Collision check (navmesh)
      if (!layout.navMesh[newY][newX]) {
        return prev;
      }
      
      return { x: newX, y: newY };
    });
  }, [layout]);
  
  // Keyboard input
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key.toLowerCase()) {
        case 'w': case 'arrowup': setFacing('up'); movePlayer(0, -1); break;
        case 's': case 'arrowdown': setFacing('down'); movePlayer(0, 1); break;
        case 'a': case 'arrowleft': setFacing('left'); movePlayer(-1, 0); break;
        case 'd': case 'arrowright': setFacing('right'); movePlayer(1, 0); break;
        case 'e': case 'enter': 
          if (nearbyPOI?.interactable) handleInteract(nearbyPOI);
          break;
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [movePlayer, nearbyPOI]);
  
  // =========================================================================
  // PROXIMITY DETECTION
  // =========================================================================
  
  useEffect(() => {
    // Check for nearby interactable POIs (within 2 tiles)
    let closest: IPOI | null = null;
    let closestDist = Infinity;
    
    for (const zone of layout.zones) {
      for (const poi of zone.pois) {
        if (!poi.interactable) continue;
        
        // Distance to POI center
        const poiCenterX = poi.position.x + poi.size.width / 2;
        const poiCenterY = poi.position.y + poi.size.height / 2;
        const dist = Math.sqrt(
          Math.pow(playerPos.x - poiCenterX, 2) + 
          Math.pow(playerPos.y - poiCenterY, 2)
        );
        
        if (dist < 3 && dist < closestDist) {
          closest = poi;
          closestDist = dist;
        }
      }
    }
    
    setNearbyPOI(closest);
  }, [playerPos, layout]);
  
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
    HubGenerator.getZoneAtPosition(layout, playerPos.x, playerPos.y),
    [layout, playerPos]
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

  // Calculate viewport offset (center on player)
  const viewportOffset = {
    x: Math.max(0, Math.min(layout.width - VIEWPORT_TILES, playerPos.x - VIEWPORT_TILES / 2)),
    y: Math.max(0, Math.min(layout.height - VIEWPORT_TILES, playerPos.y - VIEWPORT_TILES / 2))
  };
  
  useEffect(() => {
    const canvas = cityRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const palette = buildPalette(HUB_GENRE);
    const body = spriteToCanvas(figure({
      uid: player.id, archetype: (player.archetype || 'OPERATOR') as Archetype, facing, step: (playerPos.x + playerPos.y) % 2
    }), palette);
    const draw = (frame: number) => {
      ctx.imageSmoothingEnabled = false;
      const ox = viewportOffset.x * TILE_SIZE, oy = viewportOffset.y * TILE_SIZE;
      ctx.fillStyle = '#050505';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      const city = cityBitmaps[frame];
      ctx.drawImage(city, -ox, -oy, city.width * ATOM_PX, city.height * ATOM_PX);
      const w = body.width * ATOM_PX, h = body.height * ATOM_PX;
      ctx.drawImage(body, playerPos.x * TILE_SIZE + TILE_SIZE / 2 - w / 2 - ox, playerPos.y * TILE_SIZE + TILE_SIZE / 2 - h / 2 - oy, w, h);
      if (nearbyPOI) {
        ctx.strokeStyle = '#fafafa';
        ctx.lineWidth = 2;
        ctx.strokeRect(nearbyPOI.position.x * TILE_SIZE - ox - 1, nearbyPOI.position.y * TILE_SIZE - oy - 1, nearbyPOI.size.width * TILE_SIZE + 2, nearbyPOI.size.height * TILE_SIZE + 2);
      }
    };
    let frame = 0;
    draw(frame);
    const timer = window.setInterval(() => { frame = frame ? 0 : 1; draw(frame); }, 500);
    return () => window.clearInterval(timer);
  }, [cityBitmaps, playerPos, facing, nearbyPOI, viewportOffset.x, viewportOffset.y, player.id, player.archetype]);

  const handleCityClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const tx = Math.floor((e.clientX - box.left) / TILE_SIZE) + viewportOffset.x;
    const ty = Math.floor((e.clientY - box.top) / TILE_SIZE) + viewportOffset.y;
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
            {playerPos.x}, {playerPos.y}
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