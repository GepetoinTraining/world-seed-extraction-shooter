import React from 'react';
import { usePlayerStore } from '../entities/player/store';
import { InventoryGrid } from '../entities/player/ui/InventoryGrid';
import { Grid, Paper, Text, Stack, Group, Progress, Tabs, RingProgress, Center, Badge } from '@mantine/core';
import { BASE_SIMULATION_STATS } from '../entities/player/types';

export const PlayerHub = () => {
  const { player, transferItem, trashItem, identifyItem, studyItem } = usePlayerStore();
  const stash = player.bank.stashTabs[0].items;

  return (
    <Grid h="100%">
      {/* LEFT: OPERATOR STATS */}
      <Grid.Col span={4}>
        <Paper h="100%" p="md" bg="dark.8" withBorder>
            <Stack align="center" mb="xl">
                <div style={{ width: 100, height: 100, borderRadius: '50%', border: '2px solid var(--mantine-color-emerald-6)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Text size="2rem">👾</Text>
                </div>
                <Text fw={700} size="xl">{player.username}</Text>
                <Badge color="gold">RANK 12 OPERATOR</Badge>
            </Stack>

            <Tabs defaultValue="attributes">
                <Tabs.List grow>
                    <Tabs.Tab value="attributes">ATTRIBUTES</Tabs.Tab>
                    <Tabs.Tab value="sim">SIMULATION</Tabs.Tab>
                </Tabs.List>

                <Tabs.Panel value="attributes" pt="md">
                    <Stack gap="xs">
                        {/* Mock Attribute Display */}
                        {['Strength', 'Agility', 'Intelligence', 'Engineering'].map(attr => (
                            <Group key={attr} justify="space-between">
                                <Text size="sm">{attr}</Text>
                                <Group gap="xs">
                                    <Progress value={40} w={100} color="emerald" />
                                    <Text size="xs" ff="monospace">12</Text>
                                </Group>
                            </Group>
                        ))}
                    </Stack>
                </Tabs.Panel>

                <Tabs.Panel value="sim" pt="md">
                    <Stack gap="xs">
                        {/* Displaying specific Simulation Stats */}
                        <Group justify="space-between">
                            <Text size="xs" c="dimmed">RECON EFFICIENCY</Text>
                            <Text size="sm" c="blue.4">{BASE_SIMULATION_STATS.recon_efficiency.toFixed(1)}x</Text>
                        </Group>
                        <Group justify="space-between">
                            <Text size="xs" c="dimmed">PICKUP RADIUS</Text>
                            <Text size="sm" c="orange.4">{BASE_SIMULATION_STATS.pickup_radius}m</Text>
                        </Group>
                        <Group justify="space-between">
                            <Text size="xs" c="dimmed">NOISE FOOTPRINT</Text>
                            <Text size="sm" c="red.4">{BASE_SIMULATION_STATS.noise_radius}m</Text>
                        </Group>
                    </Stack>
                </Tabs.Panel>
            </Tabs>
        </Paper>
      </Grid.Col>

      {/* RIGHT: LOGISTICS (BANK) */}
      <Grid.Col span={8}>
        <Stack h="100%">
            <Paper p="md" bg="dark.8" withBorder>
                <Group justify="space-between" mb="md">
                    <Text fw={700}>SECURE STORAGE</Text>
                    <Text c="gold.4" fw={700}>{player.bank.gold.toLocaleString()} GOLD</Text>
                </Group>
                <InventoryGrid 
                    title="MAIN STASH" 
                    items={stash} 
                    capacity={50}
                    onItemAction={(act, item) => {
                        if (act === 'TRASH') trashItem(item.id, 'INVENTORY'); // Logic needs update for Stash trash
                    }}
                />
            </Paper>
            
            {/* Placeholder for Crafting / Market */}
            <Paper p="md" flex={1} bg="dark.9" withBorder style={{ borderStyle: 'dashed', opacity: 0.5 }}>
                <Center h="100%">
                    <Text c="dimmed">MARKET LINK OFFLINE</Text>
                </Center>
            </Paper>
        </Stack>
      </Grid.Col>
    </Grid>
  );
};