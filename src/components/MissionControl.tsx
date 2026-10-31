import React, { useEffect, useState } from 'react';
import { useWorldStore, IWorldCard } from '../entities/world/store';
import { usePlayerStore } from '../entities/player/store';
import { WorldCreator } from './WorldCreator';
import { SessionJournal } from '../logic/journal/SessionJournal';
import { PlayerPersistence } from '../logic/persistence/PlayerPersistence';
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
                        onClick={onDeploy} disabled={world.retired} title={world.retired ? 'Surveyed on an older grid. Its record stands, but it can no longer be walked.' : undefined} 
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

    const handleDeploy = async (worldId: string, seed: string) => {
        // Wave 4.4: the world cert's power gates are enforced at the door
        const card = useWorldStore.getState().availableWorlds.find(w => w.id === worldId);
        if (card?.ipCap || card?.ipFloor) {
            const { RANK_MULTIPLIERS } = await import('../constants');
            const stash = usePlayerStore.getState().player.bank.stashTabs[0]?.items || [];
            const playerIP = stash.reduce((m, i) => Math.max(m, i.itemPower || 0), 0);
            const rankIP = (r: string) => (RANK_MULTIPLIERS as any)[r] * 100;
            if (card.ipCap && playerIP > rankIP(card.ipCap)) {
                console.warn(`[DEPLOY] REFUSED: your gear (${playerIP} IP) exceeds this world's cap (${card.ipCap}).`);
                return;
            }
            if (card.ipFloor && playerIP < rankIP(card.ipFloor)) {
                console.warn(`[DEPLOY] REFUSED: this world requires at least ${card.ipFloor}-grade gear.`);
                return;
            }
        }
        await selectWorld(worldId);
        diveIntoLayer(seed);

        // Wave 1.2: open the session journal with the claim's baseHash
        const { player } = usePlayerStore.getState();
        const session = player.currentSession;
        if (session) {
            await SessionJournal.start(
                session.sessionId, worldId, seed,
                PlayerPersistence.persistableJson(player)
            );
        }
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