import React, { useState, useEffect } from 'react';
// ... existing imports ...
import { usePlayerStore } from './src/entities/player/store';
import { useWorldStore } from './src/entities/world/store';
import { useIdentityStore, IdentityState } from './src/entities/identity/store';
import { WorldCanvas } from './src/components/WorldCanvas';
import { HubCanvas } from './src/entities/hub/HubCanvas';
import { MissionControl } from './src/components/MissionControl';
import { PlayerHub } from './src/components/PlayerHub';
import { GenreCreator } from './src/components/admin/GenreCreator';
import { IdentityGate } from './src/components/IdentityGate'; 
import { StartupSequence } from './src/logic/initialization/StartupSequence';
import { 
  Box, Text, Button, Stack, Group, Badge,
  AppShell, NavLink, Divider, Loader, Center, ActionIcon
} from '@mantine/core';

// --- NEW IMPORTS ---
import { SystemConsole } from './src/components/debug/SystemConsole';
import { installConsoleInterceptor, useLogStore } from './src/components/debug/LogStore';

// INSTALL INTERCEPTOR IMMEDIATELY (Outside component to run ASAP)
installConsoleInterceptor();

type AppView = 'HUB' | 'MISSIONS' | 'SESSION' | 'BANK' | 'ADMIN';

const App: React.FC = () => {
  const { player, emergencyJackOut } = usePlayerStore();
  const { currentMap, exitWorld } = useWorldStore();
  const { state: identityState } = useIdentityStore();
  
  // Console Toggle Access
  const toggleConsole = useLogStore(s => s.toggle);
  
  const [view, setView] = useState<AppView>('HUB');
  const [devMode, setDevMode] = useState(false);
  const [bootStatus, setBootStatus] = useState<'INIT' | 'BOOTING' | 'READY'>('INIT');

  const session = player.currentSession;

  // 1. TRIGGER STARTUP SEQUENCE ON IDENTITY READY
  useEffect(() => {
    const boot = async () => {
      if (identityState === IdentityState.READY && bootStatus === 'INIT') {
        setBootStatus('BOOTING');
        await StartupSequence.execute();
        setBootStatus('READY');
      }
    };
    boot();
  }, [identityState, bootStatus]);

  // 2. IDENTITY GATE (Blocking)
  if (identityState !== IdentityState.READY) {
    return (
      <>
        <IdentityGate onComplete={() => {}} />
        <SystemConsole /> {/* Allow console during login to debug issues */}
      </>
    );
  }

  // 3. BOOT SCREEN
  if (bootStatus === 'BOOTING') {
    return (
      <Center h="100vh" bg="dark.9">
        <Stack align="center">
          <Loader color="gold" type="dots" />
          <Text c="gold" ff="monospace">INITIALIZING GENESIS PROTOCOL...</Text>
          <Text c="dimmed" size="xs">Minting Hub Certificates & Seeding Vector Database</Text>
          <Button variant="subtle" size="xs" onClick={toggleConsole} mt="xl">Open Console (~)</Button>
        </Stack>
        <SystemConsole />
      </Center>
    );
  }

  // 4. DIVE STATE (In-Game)
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
        {/* In-Game Console */}
        <SystemConsole />
      </Box>
    );
  }

  // 5. MAIN SHELL
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
            <Badge variant="outline" color="emerald" size="sm">ONLINE</Badge>
          </Group>
          
          <Group gap="md">
            <ActionIcon variant="transparent" color="gray" onClick={toggleConsole} title="Toggle Console (~)">
              📟
            </ActionIcon>
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
      
      {/* Console Overlay for Main Shell */}
      <SystemConsole />
    </AppShell>
  );
};

export default App;