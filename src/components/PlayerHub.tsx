import React, { useState, useMemo } from 'react';
import { usePlayerStore } from '../entities/player/store';
import { COGNITIVE_FRAMES } from '../entities/player/data/cognitiveFrames'; // Import Data
import { InventoryGrid } from '../entities/player/ui/InventoryGrid';
import { Grid, Paper, Text, Stack, Group, Progress, Tabs, Badge, TextInput, ScrollArea, Tooltip, Divider, Menu, Button } from '@mantine/core';
import { BASE_SIMULATION_STATS } from '../entities/player/types';
import { ProgressionSystem } from '../entities/player/systems/ProgressionSystem';

const ATTRIBUTE_GROUPS = {
  HARDWARE: ['strength', 'constitution', 'agility', 'dexterity', 'endurance'],
  SOFTWARE: ['intelligence', 'focus', 'engineering', 'hacking', 'perception'],
  WETWARE:  ['charisma', 'intimidation', 'subterfuge', 'bartering', 'leadership']
};

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
        {filteredSkills.length === 0 ? <Text c="dimmed" size="sm" ta="center" mt="xl">NO MATCHING ENGRAMS FOUND</Text> : (
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
                        <Text size="sm" tt="uppercase" fw={700}>{skill.id.replace('skill_', '').replace(/_/g, ' ')}</Text>
                        {skill.tags.includes('meme') && <Badge color="pink" size="xs" variant="outline">MEME</Badge>}
                      </Group>
                      <Group gap={4}>
                         <Badge variant="filled" color="dark" size="sm">{rank}</Badge>
                         <Badge variant="outline" color={skill.level > 75 ? 'gold' : 'blue'}>LVL {skill.level}</Badge>
                      </Group>
                    </Group>
                    <Progress value={progress} size="xs" color={skill.tags.includes('combat') ? 'red' : 'cyan'} />
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
  const { player, trashItem, currentWeight, maxWeight, equipFrame, unequipFrame } = usePlayerStore();
  const stash = player.bank.stashTabs[0].items;
  const attributes = player.attributes || {}; 
  const weightPercent = (currentWeight / maxWeight) * 100;
  const weightColor = weightPercent > 90 ? 'red' : weightPercent > 75 ? 'yellow' : 'blue';

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

            <Tabs defaultValue="biometrics" flex={1} style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                <Tabs.List grow>
                    <Tabs.Tab value="biometrics">BIOMETRICS</Tabs.Tab>
                    <Tabs.Tab value="skills">SKILLS</Tabs.Tab>
                    <Tabs.Tab value="sim">SIMULATION</Tabs.Tab>
                </Tabs.List>

                <Tabs.Panel value="biometrics" pt="md" style={{ overflow: 'auto' }}>
                    <Stack gap="md">
                        {/* --- FLOAT MEMORY (NEW) --- */}
                        <div>
                            <Text size="xs" c="dimmed" tt="uppercase" fw={700} mb="xs">Float Memory (Cognitive Frames)</Text>
                            <Group grow>
                                {player.floatMemory.map((frame, idx) => (
                                    <Menu key={idx} shadow="md" width={200}>
                                        <Menu.Target>
                                            <Paper 
                                                p="xs" 
                                                withBorder 
                                                style={{ 
                                                    height: 60, 
                                                    cursor: 'pointer',
                                                    borderColor: frame ? frame.colorHex : '#333',
                                                    backgroundColor: frame ? `${frame.colorHex}22` : 'transparent',
                                                    display: 'flex', alignItems: 'center', justifyContent: 'center'
                                                }}
                                            >
                                                {frame ? (
                                                    <Stack gap={0} align="center">
                                                        <Text size="xs" fw={700} c={frame.colorHex}>{frame.name.split(' ')[0]}</Text>
                                                        <Text size="8px" c="dimmed">{frame.type}</Text>
                                                    </Stack>
                                                ) : <Text c="dimmed" size="xs">EMPTY</Text>}
                                            </Paper>
                                        </Menu.Target>
                                        <Menu.Dropdown>
                                            <Menu.Label>Available Frames</Menu.Label>
                                            {Object.values(COGNITIVE_FRAMES).map(f => (
                                                <Menu.Item 
                                                    key={f.id}
                                                    color={f.colorHex}
                                                    onClick={() => equipFrame(idx, f.id)}
                                                >
                                                    {f.name}
                                                </Menu.Item>
                                            ))}
                                            <Menu.Divider />
                                            <Menu.Item color="red" onClick={() => unequipFrame(idx)}>Unequip</Menu.Item>
                                        </Menu.Dropdown>
                                    </Menu>
                                ))}
                            </Group>
                        </div>

                        <Divider color="dark.4" />

                        {/* ATTRIBUTES */}
                        {['HARDWARE', 'SOFTWARE', 'WETWARE'].map(group => (
                            <div key={group}>
                                <Text size="xs" c="dimmed" tt="uppercase" fw={700} mb="xs">{group}</Text>
                                <Stack gap={6}>
                                    {(ATTRIBUTE_GROUPS as any)[group].map((attr: string) => {
                                        const val = (attributes as any)[attr] || 0;
                                        const base = (player.baseAttributes as any)[attr] || 0;
                                        const diff = val - base;
                                        return (
                                            <Group key={attr} justify="space-between">
                                                <Text size="sm" tt="capitalize" c="white">{attr}</Text>
                                                <Group gap="xs">
                                                    {diff !== 0 && (
                                                        <Text size="xs" c={diff > 0 ? 'emerald' : 'red'}>
                                                            {diff > 0 ? '+' : ''}{diff}
                                                        </Text>
                                                    )}
                                                    <Progress value={val * 10} w={60} color={group === 'HARDWARE' ? 'red' : group === 'SOFTWARE' ? 'cyan' : 'violet'} size="sm" />
                                                    <Text size="xs" ff="monospace" w={20} ta="right">{val}</Text>
                                                </Group>
                                            </Group>
                                        );
                                    })}
                                </Stack>
                            </div>
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
                        <Group justify="space-between">
                            <Text size="xs" c="dimmed">CARRY CAPACITY</Text>
                            <Group gap={4}>
                                <Text size="sm" c={weightColor} fw={700}>{currentWeight.toFixed(1)}</Text>
                                <Text size="sm" c="dimmed"> / {maxWeight} kg</Text>
                            </Group>
                        </Group>
                        <Progress value={weightPercent} color={weightColor} size="sm" />
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