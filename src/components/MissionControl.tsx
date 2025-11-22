import React, { useEffect, useState } from 'react';
import { useWorldStore, IWorldCard } from '../entities/world/store';
import { usePlayerStore } from '../entities/player/store';
import { SimpleGrid, Card, Text, Badge, Button, Group, Container } from '@mantine/core';

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
            <Group justify="space-between" mb="xs">
                <Badge color={isDev ? 'cyan' : (isClosing ? 'red' : 'emerald')} variant="light">
                    {isDev ? 'DEV SANDBOX' : `SECTOR ${world.seed.toUpperCase()}`}
                </Badge>
                <Badge color="gray">{world.size}x{world.size}</Badge>
            </Group>
            
            <Text fw={900} size="3rem" mt="md" ff="monospace" c={timerColor}>
                {isDev ? '∞' : `${minutes}:${seconds.toString().padStart(2, '0')}`}
            </Text>
            <Text size="xs" c="dimmed" tt="uppercase" mb="xl">
                {isDev ? 'STABLE SIMULATION' : 'Time Until Reality Collapse'}
            </Text>
            
            <Card.Section p="md" style={{ background: 'rgba(0,0,0,0.3)' }}>
                <Group justify="space-between">
                    <Text size="xs" c="dimmed">ACTIVE AGENTS: <Text span c="white">{world.playerCount}</Text></Text>
                    <Button 
                        color={isDev ? 'cyan' : (isClosing ? 'red' : 'emerald')} 
                        onClick={onDeploy} 
                        className={!isDev && isClosing ? 'animate-pulse' : ''}
                        variant={isDev ? 'outline' : 'filled'}
                    >
                        {isDev ? 'DEBUG DIVE' : 'INITIATE DIVE'}
                    </Button>
                </Group>
            </Card.Section>
        </Card>
    );
};

export const MissionControl = () => {
    const { availableWorlds, refreshWorlds, selectWorld } = useWorldStore();
    const { diveIntoLayer } = usePlayerStore();

    useEffect(() => {
        refreshWorlds();
    }, []);

    const handleDeploy = (worldId: string, seed: string) => {
        selectWorld(worldId);
        diveIntoLayer(seed);
    };

    return (
        <Container size="xl" py="xl">
            <Text size="xl" fw={900} c="emerald" mb="xl" style={{ letterSpacing: 4, textAlign: 'center' }}>
                AVAILABLE EXTRACTION ZONES
            </Text>
            <SimpleGrid cols={{ base: 1, md: 3 }} spacing="lg">
                {availableWorlds.map(w => (
                    <WorldCard key={w.id} world={w} onDeploy={() => handleDeploy(w.id, w.seed)} />
                ))}
            </SimpleGrid>
        </Container>
    );
};