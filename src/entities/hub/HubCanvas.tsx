/**
 * HubCanvas - The City View
 * Players walk around a fixed city layout, interact with NPCs, access services.
 * NO COMBAT. This is the safe zone.
 */

import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { Box, Text, Paper, Stack, Group, Button, Badge, Modal, Divider } from '@mantine/core';
import { HubGenerator, IHubLayout, IPOI, POIType, HUB_NPCS, INPCDefinition, IHubZone } from './HubGenerator';
import { usePlayerStore } from '../player/store';
import { useHubStore } from './store';
import { useWorldStore } from '../world/store';

// =============================================================================
// CONSTANTS
// =============================================================================

const TILE_SIZE = 16; // Pixels per tile
const VIEWPORT_TILES = 30; // Tiles visible on screen

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

export const HubCanvas: React.FC = () => {
  // Generate hub layout once
  const layout = useMemo(() => HubGenerator.generate(), []);
  
  // Player position (tiles, not pixels)
  const [playerPos, setPlayerPos] = useState(layout.spawnPoint);
  const [nearbyPOI, setNearbyPOI] = useState<IPOI | null>(null);
  const [dialogueOpen, setDialogueOpen] = useState(false);
  const [activeNPC, setActiveNPC] = useState<INPCDefinition | null>(null);
  
  const { player } = usePlayerStore();
  const { lots, weaponShop, purchaseLot, purchaseFromShop } = useHubStore();
  const { refreshWorlds, availableWorlds, selectWorld } = useWorldStore();
  
  // Additional UI states
  const [shopOpen, setShopOpen] = useState(false);
  const [shopType, setShopType] = useState<'weapon' | 'armor' | 'consumable'>('weapon');
  const [missionOpen, setMissionOpen] = useState(false);
  
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
        case 'w': case 'arrowup': movePlayer(0, -1); break;
        case 's': case 'arrowdown': movePlayer(0, 1); break;
        case 'a': case 'arrowleft': movePlayer(-1, 0); break;
        case 'd': case 'arrowright': movePlayer(1, 0); break;
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
  
  // Calculate viewport offset (center on player)
  const viewportOffset = {
    x: Math.max(0, Math.min(layout.width - VIEWPORT_TILES, playerPos.x - VIEWPORT_TILES / 2)),
    y: Math.max(0, Math.min(layout.height - VIEWPORT_TILES, playerPos.y - VIEWPORT_TILES / 2))
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
      
      {/* THE WORLD RENDER */}
      <Box
        style={{
          position: 'absolute',
          left: '50%',
          top: '50%',
          transform: 'translate(-50%, -50%)',
          width: VIEWPORT_TILES * TILE_SIZE,
          height: VIEWPORT_TILES * TILE_SIZE,
          overflow: 'hidden',
          border: '1px solid #333'
        }}
      >
        {/* World Container (shifts based on player position) */}
        <div
          style={{
            position: 'absolute',
            left: -viewportOffset.x * TILE_SIZE,
            top: -viewportOffset.y * TILE_SIZE,
            width: layout.width * TILE_SIZE,
            height: layout.height * TILE_SIZE
          }}
        >
          {/* Zone Floors */}
          {layout.zones.map(zone => (
            <div
              key={zone.id}
              style={{
                position: 'absolute',
                left: zone.bounds.x * TILE_SIZE,
                top: zone.bounds.y * TILE_SIZE,
                width: zone.bounds.width * TILE_SIZE,
                height: zone.bounds.height * TILE_SIZE,
                backgroundColor: zone.ambientColor,
                border: '1px solid rgba(255,255,255,0.05)'
              }}
            />
          ))}
          
          {/* POIs */}
          {layout.zones.flatMap(zone => zone.pois).map(poi => (
            <div
              key={poi.id}
              onClick={() => poi.interactable && handleInteract(poi)}
              style={{
                position: 'absolute',
                left: poi.position.x * TILE_SIZE,
                top: poi.position.y * TILE_SIZE,
                width: poi.size.width * TILE_SIZE,
                height: poi.size.height * TILE_SIZE,
                backgroundColor: POI_COLORS[poi.type] || '#666',
                opacity: poi.interactable ? 0.9 : 0.5,
                cursor: poi.interactable ? 'pointer' : 'default',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                border: nearbyPOI?.id === poi.id ? '2px solid white' : '1px solid rgba(0,0,0,0.5)',
                boxShadow: poi.type === POIType.LAMP_POST 
                  ? '0 0 20px rgba(251,191,36,0.5)' 
                  : poi.type === POIType.FOUNTAIN 
                    ? '0 0 15px rgba(14,165,233,0.5)'
                    : 'none'
              }}
            >
              {poi.size.width >= 3 && poi.size.height >= 2 && (
                <Text size="xs" c="dark.9" fw={700} ta="center" style={{ fontSize: 8 }}>
                  {poi.name.split(' ')[0]}
                </Text>
              )}
            </div>
          ))}
          
          {/* Player */}
          <div
            style={{
              position: 'absolute',
              left: playerPos.x * TILE_SIZE - 4,
              top: playerPos.y * TILE_SIZE - 4,
              width: TILE_SIZE + 8,
              height: TILE_SIZE + 8,
              backgroundColor: 'white',
              borderRadius: '50%',
              boxShadow: '0 0 20px white',
              zIndex: 50
            }}
          />
          
          {/* NavMesh Debug (optional) */}
          {false && layout.navMesh.map((row, y) => 
            row.map((walkable, x) => !walkable && (
              <div
                key={`nav_${x}_${y}`}
                style={{
                  position: 'absolute',
                  left: x * TILE_SIZE,
                  top: y * TILE_SIZE,
                  width: TILE_SIZE,
                  height: TILE_SIZE,
                  backgroundColor: 'rgba(255,0,0,0.2)'
                }}
              />
            ))
          )}
        </div>
      </Box>
      
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
              <div
                style={{
                  width: 60,
                  height: 60,
                  borderRadius: '50%',
                  backgroundColor: activeNPC.spriteColor,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
              >
                <Text size="xl">👤</Text>
              </div>
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
          {(shopType === 'weapon' ? weaponShop : []).map(listing => (
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