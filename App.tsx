/**
 * App.tsx - Main Application Entry
 * 
 * Routes between:
 * 1. HUB - Safe zone, NPC interactions, player lots
 * 2. MISSIONS - World selection (extraction zones)
 * 3. SESSION - Active gameplay (WorldCanvas)
 * 4. ADMIN - Content generation tools (dev only)
 */

import React, { useState } from 'react';
import { usePlayerStore } from './src/entities/player/store';
import { useWorldStore } from './src/entities/world/store';
import { WorldCanvas } from './src/components/WorldCanvas';
import { HubCanvas } from './src/entities/hub/HubCanvas';
import { MissionControl } from './src/components/MissionControl';
import { PlayerHub } from './src/components/PlayerHub';
import { GenreCreator } from './src/components/admin/GenreCreator';
import { 
  Box, Text, Center, Button, Stack, Group, Tabs, Paper, Badge,
  AppShell, NavLink, Divider
} from '@mantine/core';

// =============================================================================
// VIEW TYPES
// =============================================================================

type AppView = 'HUB' | 'MISSIONS' | 'SESSION' | 'BANK' | 'ADMIN';

// =============================================================================
// MAIN APP
// =============================================================================

const App: React.FC = () => {
  const { player, diveIntoLayer, emergencyJackOut } = usePlayerStore();
  const { currentMap, reconMode, exitWorld } = useWorldStore();
  const session = player.currentSession;
  
  // Current view state
  const [view, setView] = useState<AppView>('HUB');
  
  // Dev mode toggle
  const [devMode, setDevMode] = useState(false);

  
// Inside App.tsx, add this component and state to switch to it
const AwakeningSequence = ({ onComplete }: { onComplete: () => void }) => {
  return (
    <Center h="100vh">
      <Stack align="center">
        <Text size="xl" fw={900}>INITIATING...</Text>
        <Button onClick={onComplete} color="emerald">WAKE UP</Button>
      </Stack>
    </Center>
  );
};

  // =========================================================================
  // VIEW ROUTING
  // =========================================================================
  
  // If player is in an active session, show the game world
  if (session && currentMap) {
    return (
      <Box h="100vh" bg="dark.9">
        <WorldCanvas session={session} />
        
        {/* Extract Button Overlay */}
        <Button 
          pos="absolute" 
          top={20} 
          right={20} 
          color="gold"
          onClick={() => {
            emergencyJackOut();
            exitWorld();
            setView('HUB');
          }}
          style={{ zIndex: 1000 }}
        >
          EXTRACT
        </Button>
      </Box>
    );
  }
  
  // =========================================================================
  // MAIN NAVIGATION SHELL
  // =========================================================================
  
  return (
    <AppShell
      header={{ height: 60 }}
      navbar={{ width: 220, breakpoint: 'sm' }}
      padding="md"
      bg="dark.9"
    >
      {/* HEADER */}
      <AppShell.Header p="md" bg="dark.7" style={{ borderBottom: '1px solid var(--mantine-color-dark-4)' }}>
        <Group justify="space-between" h="100%">
          <Group gap="md">
            <div style={{ width: 12, height: 12, borderRadius: '50%', background: 'var(--mantine-color-gold-5)' }} />
            <Text fw={700} size="lg" style={{ letterSpacing: '0.1em' }}>WORLD SEED</Text>
            <Badge variant="outline" color="emerald" size="sm">GENESIS</Badge>
          </Group>
          
          <Group gap="md">
            <Badge color="gold">{player.bank.gold.toLocaleString()} G</Badge>
            <Text size="sm" c="dimmed">{player.username}</Text>
            <Button 
              variant="subtle" 
              size="xs" 
              color="gray"
              onClick={() => setDevMode(!devMode)}
            >
              {devMode ? '🔧 DEV' : '👤 USER'}
            </Button>
          </Group>
        </Group>
      </AppShell.Header>
      
      {/* NAVBAR */}
      <AppShell.Navbar p="md" bg="dark.7" style={{ borderRight: '1px solid var(--mantine-color-dark-4)' }}>
        <Stack gap="xs">
          <Text size="xs" c="dimmed" fw={700} tt="uppercase">Navigation</Text>
          
          <NavLink
            label="City Hub"
            description="Walk around, meet NPCs"
            leftSection={<Text>🏠</Text>}
            active={view === 'HUB'}
            onClick={() => setView('HUB')}
          />
          
          <NavLink
            label="Mission Control"
            description="Select extraction zone"
            leftSection={<Text>🎯</Text>}
            active={view === 'MISSIONS'}
            onClick={() => setView('MISSIONS')}
          />
          
          <NavLink
            label="Bank / Stash"
            description="Manage your items"
            leftSection={<Text>🏦</Text>}
            active={view === 'BANK'}
            onClick={() => setView('BANK')}
          />
          
          {devMode && (
            <>
              <Divider my="sm" />
              <Text size="xs" c="dimmed" fw={700} tt="uppercase">Admin Tools</Text>
              
              <NavLink
                label="Genre Creator"
                description="Generate content"
                leftSection={<Text>🎭</Text>}
                active={view === 'ADMIN'}
                onClick={() => setView('ADMIN')}
                color="cyan"
              />
            </>
          )}
        </Stack>
        
        {/* Quick Stats */}
        <Paper mt="auto" p="sm" bg="dark.8" withBorder>
          <Stack gap={4}>
            <Group justify="space-between">
              <Text size="xs" c="dimmed">Session</Text>
              <Badge size="xs" color={session ? 'emerald' : 'gray'}>
                {session ? 'ACTIVE' : 'IDLE'}
              </Badge>
            </Group>
            <Group justify="space-between">
              <Text size="xs" c="dimmed">Stash Items</Text>
              <Text size="xs">{player.bank.stashTabs[0]?.items.length || 0}</Text>
            </Group>
          </Stack>
        </Paper>
      </AppShell.Navbar>
      
      {/* MAIN CONTENT */}
      <AppShell.Main>
        <Box h="calc(100vh - 60px - 32px)">
          {view === 'HUB' && <HubCanvas />}
          {view === 'MISSIONS' && <MissionControl />}
          {view === 'BANK' && <PlayerHub />}
          {view === 'ADMIN' && <GenreCreator />}
        </Box>
      </AppShell.Main>
    </AppShell>
  );
};

export default App;