import React, { useEffect, useState } from 'react';
import { useWorldStore, IWorldCard } from '../entities/world/store';
import { usePlayerStore } from '../entities/player/store';
import { WorldCreator } from './WorldCreator';
import { SimpleGrid, Card, Text, Badge, Button, Group, Container, Stack } from '@mantine/core';

const WorldCard = ({ world, onDeploy }: { world: IWorldCard, onDeploy: () => void }) => {
    const [timeLeft, setTimeLeft] = useState(0);
    
    useEffect(() => {
        const tick = () => setTimeLeft(Math.max(0, Math.floor((world.collapseTime - Date.now()) / 1000)));
        tick();
        const interval = setInterval(tick, 1000);
        return () => clearInterval(interval);
    }, [world.collapseTime]);

    const minutes = Math.floor(timeLeft / 60);
    const seconds = timeLeft % 60;
    const isClosing = minutes < 2;
    const isDev = world.isDebug;

    const borderColor = isDev ? 'cyan' : (isClosing ? 'red' : 'var(--mantine-color-emerald-8)');
    const timerColor = isDev ? 'cyan' : (isClosing ? 'red' : 'white');

    return (
        <Card shadow="sm" padding="lg" radius="md" withBorder style={{ borderColor: borderColor, background: 'var(--mantine-color-dark-7)' }}>
            <Stack gap="xs" mb="md">
                <Group justify="space-between">
                    <Text fw={700} tt="uppercase" size="lg">{world.name}</Text>
                    <Badge color={world.difficulty === 'F' ? 'gray' : 'red'}>{world.difficulty}</Badge>
                </Group>
                <Group justify="space-between">
                    <Text size="xs" c="dimmed">SECTOR: {world.seed.substring(0, 6)}</Text>
                    <Text size="xs" c="dimmed">ARCHITECT: {world.creator}</Text>
                </Group>
            </Stack>
            
            <Text fw={900} size="3rem" ff="monospace" c={timerColor}>
                {isDev ? '∞' : `${minutes}:${seconds.toString().padStart(2, '0')}`}
            </Text>
            <Text size="xs" c="dimmed" tt="uppercase" mb="xl">
                {isDev ? 'STABLE SIMULATION' : 'Time Until Reality Collapse'}
            </Text>
            
            <Card.Section p="md" style={{ background: 'rgba(0,0,0,0.3)' }}>
                <Group justify="space-between">
                    <Text size="xs" c="dimmed">AGENTS: <Text span c="white">{world.playerCount}</Text></Text>
                    <Button 
                        color={isDev ? 'cyan' : 'emerald'} 
                        onClick={onDeploy} 
                        className={!isDev && isClosing ? 'animate-pulse' : ''}
                        variant={isDev ? 'outline' : 'filled'}
                        fullWidth={false}
                    >
                        DEPLOY
                    </Button>
                </Group>
            </Card.Section>
        </Card>
    );
};

export const MissionControl = () => {
    const { availableWorlds, refreshWorlds, selectWorld } = useWorldStore();
    const { diveIntoLayer } = usePlayerStore();
    const [creatorOpen, setCreatorOpen] = useState(false);

    useEffect(() => {
        refreshWorlds();
    }, []);

    const handleDeploy = (worldId: string, seed: string) => {
        selectWorld(worldId);
        diveIntoLayer(seed);
    };

    return (
        <Container size="xl" py="xl">
            <Group justify="space-between" mb="xl">
                <Text size="xl" fw={900} c="emerald" style={{ letterSpacing: 4 }}>
                    EXTRACTION ZONES
                </Text>
                <Button 
                    variant="outline" 
                    color="gold" 
                    onClick={() => setCreatorOpen(true)}
                >
                    + MINT NEW WORLD
                </Button>
            </Group>

            <SimpleGrid cols={{ base: 1, md: 3 }} spacing="lg">
                {availableWorlds.map(w => (
                    <WorldCard key={w.id} world={w} onDeploy={() => handleDeploy(w.id, w.seed)} />
                ))}
            </SimpleGrid>

            {availableWorlds.length === 0 && (
                <Text c="dimmed" ta="center" mt="xl">No stable realities found. Mint a new world to begin.</Text>
            )}

            <WorldCreator 
                opened={creatorOpen} 
                onClose={() => setCreatorOpen(false)}
                onCreated={() => refreshWorlds()} // Refresh list after minting
            />
        </Container>
    );
};