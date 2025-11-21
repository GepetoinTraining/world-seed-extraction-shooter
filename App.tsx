import React from 'react';
import { Layout } from './src/components/Layout';
import { WorldCanvas } from './src/components/WorldCanvas';
import { IItem, UniversalRank } from './types';
import { usePlayerStore } from './src/store/usePlayerStore';
import { 
  Stack, Group, Text, Button, Paper, SimpleGrid, Card, Badge, 
  Avatar, ScrollArea, Tooltip, ActionIcon 
} from '@mantine/core';

// --- RANK COLORS MAP (Mantine Colors) ---
const RANK_COLOR_MAP: Record<UniversalRank, string> = {
  [UniversalRank.F]: 'gray',
  [UniversalRank.E]: 'gray.5',
  [UniversalRank.D]: 'blue.3',
  [UniversalRank.C]: 'emerald.4',
  [UniversalRank.B]: 'blue.6',
  [UniversalRank.A]: 'grape.5',
  [UniversalRank.S]: 'orange.5',
  [UniversalRank.SS]: 'red.6',
  [UniversalRank.SSS]: 'white',
};

export default function App() {
  // Global State
  const { player, view, setView, diveIntoLayer, emergencyJackOut, simulateLootDrop } = usePlayerStore();

  // Derived Data
  const mainStashItems = player.bank.stashTabs[0].items;
  
  // Calculate Display Rank
  const playerDisplayRank = mainStashItems.reduce((highest, item) => {
    const ranks = Object.values(UniversalRank);
    return ranks.indexOf(item.rank) > ranks.indexOf(highest) ? item.rank : highest;
  }, UniversalRank.F);

  // --- COMPONENT: SIDEBAR (Player ID) ---
  const NavbarContent = (
    <Stack justify="space-between" h="100%">
      <Stack gap="md">
        {/* Player Card */}
        <Paper p="md" withBorder style={{ position: 'relative', overflow: 'hidden' }}>
          <Badge 
            variant="filled" 
            color={RANK_COLOR_MAP[playerDisplayRank]} 
            style={{ position: 'absolute', top: 0, right: 0, borderRadius: 0 }}
          >
            RANK {playerDisplayRank}
          </Badge>
          
          <Avatar size="xl" radius="0" color="dark" variant="outline" mb="md">
            👾
          </Avatar>
          
          <Text fw={700} size="lg">{player.username}</Text>
          <Text size="xs" c="dimmed" ff="monospace">ID: {player.id.substring(0,8)}</Text>

          <Stack gap="xs" mt="md">
             <Group justify="space-between">
                <Text size="xs" c="dimmed">GOLD</Text>
                <Text size="xs" c="gold.4">{player.bank.gold.toLocaleString()}</Text>
             </Group>
             <Group justify="space-between">
                <Text size="xs" c="dimmed">STASH</Text>
                <Text size="xs" c="blue.4">{mainStashItems.length} / 50</Text>
             </Group>
          </Stack>
        </Paper>

        {/* Navigation */}
        <Stack gap="xs">
          <Button 
            fullWidth 
            justify="flex-start"
            variant={view === 'BANK' ? 'filled' : 'subtle'} 
            color="gold"
            onClick={() => setView('BANK')}
            disabled={view === 'SESSION'}
          >
            [F1] BANK (COLD)
          </Button>
          <Button fullWidth justify="flex-start" variant="subtle" color="gray" disabled>
            [F2] MARKET (LOCKED)
          </Button>
        </Stack>
      </Stack>

      {/* Session Actions */}
      <Stack>
        {view === 'SESSION' && player.currentSession && (
           <Paper p="sm" withBorder bg="emerald.9" style={{ borderColor: 'var(--mantine-color-emerald-8)' }}>
              <Text size="xs" c="emerald.4" fw={700} mb="xs">SESSION METRICS</Text>
              <Group justify="space-between" mb={4}>
                <Text size="xs">INTEGRITY</Text>
                <Text size="xs" c="white">{player.currentSession.health}%</Text>
              </Group>
              <Group justify="space-between" mb="xs">
                <Text size="xs">MASS</Text>
                <Text size="xs" c="white">{player.currentSession.inventory.length} ITEMS</Text>
              </Group>
              <Button fullWidth variant="light" color="emerald" onClick={simulateLootDrop}>
                DEBUG: LOOT
              </Button>
           </Paper>
        )}

        <Button 
          fullWidth 
          h={50}
          color={view === 'SESSION' ? 'red' : 'emerald'}
          variant={view === 'SESSION' ? 'filled' : 'outline'}
          onClick={() => view === 'SESSION' ? emergencyJackOut() : diveIntoLayer()}
        >
          {view === 'SESSION' ? 'EMERGENCY JACK-OUT' : 'LINK START // DIVE'}
        </Button>
      </Stack>
    </Stack>
  );

  // --- COMPONENT: ASIDE (Logs) ---
  const AsideContent = (
    <Stack h="100%">
      <Text size="xs" fw={700} c="dimmed">SYSTEM LOG</Text>
      <ScrollArea flex={1} type="never">
        <Stack gap="xs">
          <Text size="xs" c="dimmed">
            <Text span c="blue.4">[SYSTEM]</Text> Gateway Connected.
          </Text>
          {view === 'SESSION' && (
            <Text size="xs" c="emerald.4" className="animate-pulse">
               [NET] Streaming Data...
            </Text>
          )}
          {player.currentSession?.inventory.map((item) => (
            <Text key={item.id} size="xs" c="dimmed">
              <Text span c="gold.4">[LOOT]</Text> Acquired {item.name}
            </Text>
          ))}
        </Stack>
      </ScrollArea>
    </Stack>
  );

  return (
    <Layout 
      title="DASHBOARD" 
      status={view === 'SESSION' ? 'DIVE_ACTIVE' : 'ONLINE'}
      navbar={NavbarContent}
      aside={AsideContent}
    >
      {view === 'BANK' ? (
        <Stack h="100%">
           <Group justify="space-between">
              <div>
                <Text size="xl" fw={300}>SECURE STORAGE</Text>
                <Text size="xs" c="dimmed" ff="monospace">Items persist across session collapse.</Text>
              </div>
           </Group>
           
           <ScrollArea h="100%">
             <SimpleGrid cols={{ base: 2, sm: 3, md: 4, lg: 5 }} spacing="xs">
                {mainStashItems.map(item => (
                  <ItemCard key={item.id} item={item} />
                ))}
                {/* Placeholders */}
                {Array.from({ length: Math.max(0, 15 - mainStashItems.length) }).map((_, i) => (
                   <Paper key={i} h={120} withBorder style={{ borderStyle: 'dashed', opacity: 0.2 }} />
                ))}
             </SimpleGrid>
           </ScrollArea>
        </Stack>
      ) : (
        <Paper h="100%" withBorder={false} radius={0} style={{ overflow: 'hidden' }}>
           {player.currentSession && <WorldCanvas session={player.currentSession} />}
        </Paper>
      )}
    </Layout>
  );
}

// --- COMPONENT: ITEM CARD ---
const ItemCard = ({ item }: { item: IItem }) => {
  const color = RANK_COLOR_MAP[item.rank];
  
  return (
    <Tooltip 
      label={
        <Stack gap={0} p={4}>
          <Text size="xs" fw={700} c={color}>{item.name}</Text>
          <Text size="xs" c="dimmed" fs="italic">{item.description}</Text>
          <Text size="xs" mt={4} td="underline">PROPERTIES</Text>
          {Object.entries(item.stats).map(([k,v]) => (
            <Group key={k} justify="space-between" gap="xl">
               <Text size="xs" tt="capitalize">{k.replace('_', ' ')}</Text>
               <Text size="xs" ff="monospace">{v}</Text>
            </Group>
          ))}
        </Stack>
      }
      color="dark.7"
      withArrow
      transitionProps={{ duration: 0 }}
    >
      <Card padding="xs" radius="0" style={{ borderColor: `var(--mantine-color-${color}-filled)` }}>
        <Group justify="space-between" mb="xs">
          <Badge size="xs" variant="outline" color={color} radius="xs">{item.rank}</Badge>
          <Text size="xs" c={item.quality > 0 ? 'green' : 'red'} ff="monospace">
            {item.quality > 0 ? '+' : ''}{(item.quality * 100).toFixed(0)}%
          </Text>
        </Group>
        
        <Stack align="center" py="sm" gap={0} style={{ opacity: 0.8 }}>
           <Text size="xl">{item.slot.includes('HAND') ? '⚔️' : '🛡️'}</Text>
        </Stack>

        <Stack gap={0} mt="xs">
           <Text size="xs" fw={700} truncate>{item.name}</Text>
           <Group justify="space-between">
             <Text size="xs" c="dimmed" tt="uppercase" style={{ fontSize: 9 }}>{item.slot.replace('_', ' ')}</Text>
             <Text size="xs" c="dimmed" ff="monospace">{item.itemPower} IP</Text>
           </Group>
        </Stack>
      </Card>
    </Tooltip>
  );
}