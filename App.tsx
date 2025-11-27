import React, { useState } from 'react';
import { usePlayerStore } from './src/entities/player/store';
import { useWorldStore } from './src/entities/world/store';
import { WorldCanvas } from './src/components/WorldCanvas';
import { HubCanvas } from './src/entities/hub/HubCanvas';
import { MissionControl } from './src/components/MissionControl';
import { PlayerHub } from './src/components/PlayerHub';
import { GenreCreator } from './src/components/admin/GenreCreator';
import { IdentityGate } from './src/components/IdentityGate'; // Ensure you created this file!
import { 
  Box, Text, Button, Stack, Group, Badge,
  AppShell, NavLink, Divider
} from '@mantine/core';

type AppView = 'HUB' | 'MISSIONS' | 'SESSION' | 'BANK' | 'ADMIN';

const App: React.FC = () => {
  const { player, emergencyJackOut } = usePlayerStore();
  const { currentMap, exitWorld } = useWorldStore();
  const session = player.currentSession;
  
  const [view, setView] = useState<AppView>('HUB');
  const [devMode, setDevMode] = useState(false);
  
  // Local state to track if gate is passed
  const [isGateOpen, setIsGateOpen] = useState(false);

  // 1. DIVE STATE: If in-game, bypass everything (Render the Simulation)
  if (session && currentMap) {
    return (
      <Box h="100vh" bg="dark.9">
        <WorldCanvas session={session} />
        <Button 
          pos="absolute" top={20} right={20} color="gold"
          onClick={() => { emergencyJackOut(); exitWorld(); setView('HUB'); }}
          style={{ zIndex: 1000 }}
        >
          EXTRACT
        </Button>
      </Box>
    );
  }

  // 2. GATE STATE: If not logged in, show Identity Gate
  // This effectively blocks the rest of the app until onComplete is called
  if (!isGateOpen) {
    return <IdentityGate onComplete={() => setIsGateOpen(true)} />;
  }

  // 3. SHELL STATE: Main App (Hub, Missions, etc.)
  return (
    <AppShell
      header={{ height: 60 }}
      navbar={{ width: 220, breakpoint: 'sm' }}
      padding="md"
      bg="dark.9"
    >
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
            <Button variant="subtle" size="xs" color="gray" onClick={() => setDevMode(!devMode)}>
              {devMode ? '🛑 DEV' : '🛠️ USER'}
            </Button>
          </Group>
        </Group>
      </AppShell.Header>
      
      <AppShell.Navbar p="md" bg="dark.7" style={{ borderRight: '1px solid var(--mantine-color-dark-4)' }}>
        <Stack gap="xs">
          <Text size="xs" c="dimmed" fw={700} tt="uppercase">Navigation</Text>
          
          <NavLink 
            label="City Hub" 
            leftSection={<Text>🏙️</Text>} 
            active={view === 'HUB'} 
            onClick={() => setView('HUB')} 
            color="emerald"
            variant="light"
          />
          
          <NavLink 
            label="Mission Control" 
            leftSection={<Text>🚀</Text>} 
            active={view === 'MISSIONS'} 
            onClick={() => setView('MISSIONS')} 
            color="emerald"
            variant="light"
          />
          
          <NavLink 
            label="Bank / Stash" 
            leftSection={<Text>📦</Text>} 
            active={view === 'BANK'} 
            onClick={() => setView('BANK')} 
            color="emerald"
            variant="light"
          />
          
          {devMode && (
            <>
              <Divider my="sm" />
              <Text size="xs" c="dimmed" fw={700} tt="uppercase">Admin Tools</Text>
              <NavLink 
                label="Genre Creator" 
                leftSection={<Text>🧬</Text>} 
                active={view === 'ADMIN'} 
                onClick={() => setView('ADMIN')} 
                color="cyan"
                variant="light"
              />
            </>
          )}
        </Stack>
      </AppShell.Navbar>
      
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