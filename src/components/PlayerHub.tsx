import React, { useState, useMemo } from 'react';
import { usePlayerStore } from '../entities/player/store';
import { InventoryGrid } from '../entities/player/ui/InventoryGrid';
import { Grid, Paper, Text, Stack, Group, Progress, Tabs, Badge, TextInput, ScrollArea, Tooltip } from '@mantine/core';
import { BASE_SIMULATION_STATS } from '../entities/player/types';
import { ProgressionSystem } from '../entities/player/systems/ProgressionSystem';

const SkillMatrix = ({ skills }: { skills: Record<string, any> }) => {
  const [query, setQuery] = useState('');

  const filteredSkills = useMemo(() => {
    const q = query.toLowerCase();
    return Object.entries(skills)
      .filter(([name]) => name.toLowerCase().includes(q))
      .sort((a, b) => b[1].level - a[1].level);
  }, [skills, query]);

  return (
    <Stack h="100%" gap="xs">
      <TextInput 
        placeholder="SEARCH NEURAL DATABASE..." 
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        leftSection="🔍"
        styles={{ input: { fontFamily: 'monospace', textTransform: 'uppercase' } }}
      />
      
      <ScrollArea h={300} offsetScrollbars>
        {filteredSkills.length === 0 ? (
          <Text c="dimmed" size="sm" ta="center" mt="xl">NO MATCHING ENGRAMS FOUND</Text>
        ) : (
          <Stack gap={4}>
            {filteredSkills.map(([key, skill]) => {
              const xpNeeded = ProgressionSystem.getXpToNextLevel(skill.level);
              const progress = (skill.currentXp / xpNeeded) * 100;
              const rank = ProgressionSystem.getRankFromLevel(skill.level);

              return (
                <Group key={key} justify="space-between" p="xs" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                  <div style={{ flex: 1 }}>
                    <Group justify="space-between" mb={4}>
                      <Group gap="xs">
                        <Tooltip 
                            color="dark.9"
                            multiline
                            w={250}
                            label={
                              <Stack gap={4}>
                                <Text size="xs" c="gold" fw={700}>GENESIS MEMORY</Text>
                                {skill.origin ? (
                                  <>
                                    <Text size="xs" c="dimmed">"Manifested during {skill.origin.triggerAction}"</Text>
                                    <Text size="xs" c="dimmed">Location: {skill.origin.location}</Text>
                                    <Text size="xs" c="dimmed">Initial Resonance: {skill.origin.resonance.toFixed(1)}</Text>
                                  </>
                                ) : <Text size="xs" c="dimmed">Origin Unknown</Text>}
                              </Stack>
                            }
                        >
                            <Text size="sm" tt="uppercase" fw={700} style={{ cursor: 'help', textDecoration: 'underline dotted' }}>
                                {skill.id.replace('skill_', '').replace(/_/g, ' ')}
                            </Text>
                        </Tooltip>
                        {skill.tags.includes('meme') && <Badge color="pink" size="xs" variant="outline">MEME</Badge>}
                      </Group>
                      <Group gap={4}>
                         <Badge variant="filled" color="dark" size="sm">{rank}</Badge>
                         <Badge variant="outline" color={skill.level > 75 ? 'gold' : 'blue'}>LVL {skill.level}</Badge>
                      </Group>
                    </Group>
                    <Tooltip label={`${Math.floor(skill.currentXp)} / ${xpNeeded} XP`}>
                      <Progress 
                        value={progress} 
                        size="xs" 
                        color={skill.tags.includes('combat') ? 'red' : 'cyan'} 
                        animated={progress > 90}
                      />
                    </Tooltip>
                  </div>
                </Group>
              );
            })}
          </Stack>
        )}
      </ScrollArea>
    </Stack>
  );
};

export const PlayerHub = () => {
  const { player, trashItem } = usePlayerStore();
  const stash = player.bank.stashTabs[0].items;
  const attributes = player.attributes || {}; 

  return (
    <Grid h="100%">
      <Grid.Col span={4}>
        <Paper h="100%" p="md" bg="dark.8" withBorder display="flex" style={{ flexDirection: 'column' }}>
            <Stack align="center" mb="xl">
                <div style={{ width: 100, height: 100, borderRadius: '50%', border: '2px solid var(--mantine-color-emerald-6)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Text size="2rem">👾</Text>
                </div>
                <Stack gap={0} align="center">
                  <Text fw={700} size="xl">{player.username}</Text>
                  <Badge color="gold" variant="light">ID: {player.id.substring(0, 8)}</Badge>
                </Stack>
            </Stack>

            <Tabs defaultValue="skills" flex={1} style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                <Tabs.List grow>
                    <Tabs.Tab value="biometrics">BIOMETRICS</Tabs.Tab>
                    <Tabs.Tab value="skills">SKILLS</Tabs.Tab>
                    <Tabs.Tab value="sim">SIMULATION</Tabs.Tab>
                </Tabs.List>

                <Tabs.Panel value="biometrics" pt="md" style={{ overflow: 'auto' }}>
                    <Stack gap="xs">
                        <Text size="xs" c="dimmed" tt="uppercase" fw={700}>Hardware</Text>
                        {Object.entries(attributes).slice(0, 5).map(([attr, val]) => (
                            <Group key={attr} justify="space-between">
                                <Text size="sm" tt="capitalize">{attr}</Text>
                                <Group gap="xs">
                                    <Progress value={(val as number) * 5} w={80} color="blue" />
                                    <Text size="xs" ff="monospace">{(val as number)}</Text>
                                </Group>
                            </Group>
                        ))}
                    </Stack>
                </Tabs.Panel>

                <Tabs.Panel value="skills" pt="md" h="100%">
                    <SkillMatrix skills={player.bank.universalSkills || {}} />
                </Tabs.Panel>

                <Tabs.Panel value="sim" pt="md">
                    <Stack gap="xs">
                        <Group justify="space-between">
                            <Text size="xs" c="dimmed">RECON EFFICIENCY</Text>
                            <Text size="sm" c="blue.4">{BASE_SIMULATION_STATS.recon_efficiency.toFixed(1)}x</Text>
                        </Group>
                    </Stack>
                </Tabs.Panel>
            </Tabs>
        </Paper>
      </Grid.Col>

      <Grid.Col span={8}>
        <Stack h="100%">
            <Paper p="md" bg="dark.8" withBorder>
                <Group justify="space-between" mb="md">
                    <Text fw={700}>SECURE STORAGE</Text>
                    <Text c="gold.4" fw={700} ff="monospace">{player.bank.gold.toLocaleString()} G</Text>
                </Group>
                <InventoryGrid 
                    title="MAIN STASH" 
                    items={stash} 
                    capacity={50}
                    onItemAction={(act, item) => { if (act === 'TRASH') trashItem(item.id, 'INVENTORY'); }}
                />
            </Paper>
        </Stack>
      </Grid.Col>
    </Grid>
  );
};