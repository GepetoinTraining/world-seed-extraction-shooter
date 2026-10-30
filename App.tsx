import React, { useState, useEffect } from 'react';
import { usePlayerStore } from './src/entities/player/store';
import { useWorldStore } from './src/entities/world/store';
import { useIdentityStore, IdentityState } from './src/entities/identity/store';
import { WorldCanvas } from './src/components/WorldCanvas';
import { HubCanvas } from './src/entities/hub/HubCanvas';
import { MissionControl } from './src/components/MissionControl';
import { PlayerHub } from './src/components/PlayerHub';
import { GenreCreator } from './src/components/admin/GenreCreator';
import { IdentityGate } from './src/components/IdentityGate'; 
import { HubSelector } from './src/components/HubSelector'; // NEW IMPORT
import { StartupSequence } from './src/logic/initialization/StartupSequence';
import { 
  Box, Text, Button, Stack, Group, Badge,
  AppShell, NavLink, Divider, Loader, Center, ActionIcon
} from '@mantine/core';

// Debug Console
import { SystemConsole } from './src/components/debug/SystemConsole';
import { installConsoleInterceptor, useLogStore } from './src/components/debug/LogStore';

installConsoleInterceptor();

type AppView = 'HUB' | 'MISSIONS' | 'SESSION' | 'BANK' | 'ADMIN';

const App: React.FC = () => {
  const { player, emergencyJackOut } = usePlayerStore();
  const { currentMap, exitWorld } = useWorldStore();
  const { state: identityState } = useIdentityStore();
  const toggleConsole = useLogStore(s => s.toggle);
  
  // UI State
  const [view, setView] = useState<AppView>('HUB');
  const [devMode, setDevMode] = useState(false);
  
  // Lifecycle State
  const [bootStatus, setBootStatus] = useState<'INIT' | 'BOOTING' | 'READY'>('INIT');
  const [hubSelected, setHubSelected] = useState(false); // Controls the Hub Selector

  const session = player.currentSession;

  // 1. BOOT SEQUENCE
  useEffect(() => {
    const boot = async () => {
      if (identityState === IdentityState.READY && bootStatus === 'INIT') {
        setBootStatus('BOOTING');
        // Execute Genesis / Hydration
        const result = await StartupSequence.execute();
        if (result.status === 'READY') {
          setBootStatus('READY');
        } else {
          console.error("Boot failed or waiting for identity.");
        }
      }
    };
    boot();
  }, [identityState, bootStatus]);

  // --- VIEW ROUTER ---

  // A. IDENTITY GATE
  if (identityState !== IdentityState.READY) {
    return (
      <>
        <IdentityGate onComplete={() => {/* Identity Store updates state automatically */}} />
        <SystemConsole />
      </>
    );
  }

  // B. BOOT LOADER
  if (bootStatus === 'BOOTING') {
    return (
      <Center h="100vh" bg="dark.9">
        <Stack align="center">
          <Loader color="gold" type="dots" />
          <Text c="gold" ff="monospace">INITIALIZING GENESIS PROTOCOL...</Text>
          <Button variant="subtle" size="xs" onClick={toggleConsole} mt="xl">Open Console (~)</Button>
        </Stack>
        <SystemConsole />
      </Center>
    );
  }

  // C. HUB SELECTOR (New Step)
  if (bootStatus === 'READY' && !hubSelected) {
    return (
      <>
        <HubSelector onSelect={(hubId) => {
          console.log(`[APP] Joining Hub: ${hubId}`);
          setHubSelected(true);
        }} />
        <SystemConsole />
      </>
    );
  }

  // D. ACTIVE GAME SESSION (Combat)
  // Only show WorldCanvas if we are actually in a "Session" (Mission)
  // AND the view isn't forcing something else (though usually session takes over)
  if (session && currentMap) {
    return (
      <Box h="100vh" bg="dark.9">
        {/* Wave 2.5: extraction now lives at the beacons, inside the canvas */}
        <WorldCanvas session={session} />
        <SystemConsole />
      </Box>
    );
  }

  // E. MAIN HUB SHELL
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
            <ActionIcon
              variant="transparent" color="gray" title="Export Avatar (sovereign backup)"
              onClick={async () => {
                const password = prompt('Passphrase to encrypt your private key:');
                if (!password) return;
                const { AvatarExport } = await import('./src/logic/sovereignty/AvatarExport');
                const result = await AvatarExport.exportAvatar(password);
                if (!result) { alert('Export failed — see console.'); return; }
                const url = URL.createObjectURL(result.blob);
                const a = document.createElement('a');
                a.href = url; a.download = result.filename; a.click();
                URL.revokeObjectURL(url);
              }}
            >
              💾
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
      
      <SystemConsole />
    </AppShell>
  );
};

export default App;