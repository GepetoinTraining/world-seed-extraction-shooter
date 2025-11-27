import React, { useEffect, useState } from 'react';
import { WorldCertificateSystem, IWorldCertificate, WorldType } from '../entities/world/WorldCertificate';
import { useHubStore } from '../entities/hub/store';
import { 
  Center, SimpleGrid, Card, Text, Button, Stack, TextInput, 
  Badge, Group, Loader, Container 
} from '@mantine/core';

interface HubSelectorProps {
  onSelect: (hubWorldUid: string) => void;
}

export const HubSelector: React.FC<HubSelectorProps> = ({ onSelect }) => {
  const [hubs, setHubs] = useState<IWorldCertificate[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const { loadHub } = useHubStore();

  useEffect(() => {
    const fetchHubs = async () => {
      setLoading(true);
      // Fetch public worlds and filter for HUB type
      const allWorlds = await WorldCertificateSystem.getPublicWorlds();
      const validHubs = allWorlds.filter(w => w.data.worldType === WorldType.HUB);
      setHubs(validHubs);
      setLoading(false);
    };
    fetchHubs();
  }, []);

  const handleEnter = async (hubUid: string) => {
    // Initialize the Hub Store with this Hub's ID
    await loadHub(hubUid);
    onSelect(hubUid);
  };

  const filteredHubs = hubs.filter(h => 
    h.data.worldName.toLowerCase().includes(search.toLowerCase())
  );

  if (loading) {
    return (
      <Center h="100vh" bg="dark.9">
        <Stack align="center">
          <Loader color="gold" variant="dots" />
          <Text c="dimmed">Scanning Sector Frequencies...</Text>
        </Stack>
      </Center>
    );
  }

  return (
    <Container size="xl" py={50} h="100vh" bg="dark.9">
      <Stack gap="xl">
        <Stack gap="xs">
          <Text size="3rem" fw={900} c="emerald" style={{ letterSpacing: 4, lineHeight: 1 }}>
            HUB SELECTION
          </Text>
          <Text c="dimmed">Choose a frequency to materialize your avatar.</Text>
        </Stack>

        <TextInput 
          placeholder="Search Hubs..." 
          size="md"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          styles={{ input: { background: '#111', borderColor: '#333' } }}
        />

        <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }}>
          {filteredHubs.map((hub) => (
            <Card key={hub.data.worldUid} padding="lg" radius="sm" withBorder bg="dark.8" style={{ borderColor: 'var(--mantine-color-emerald-8)' }}>
              <Group justify="space-between" mb="xs">
                <Badge color="gold" variant="outline">POP: {hub.data.stats.totalVisitors}</Badge>
                <Badge color="gray">{hub.data.rules.difficulty}</Badge>
              </Group>

              <Text fw={700} size="xl" mb="xs" tt="uppercase">{hub.data.worldName}</Text>
              <Text size="sm" c="dimmed" lineClamp={3} mb="xl" style={{ height: 60 }}>
                {hub.data.worldDescription}
              </Text>

              <Button 
                fullWidth 
                color="emerald" 
                onClick={() => handleEnter(hub.data.worldUid)}
                className="animate-pulse"
              >
                MATERIALIZE
              </Button>
            </Card>
          ))}
        </SimpleGrid>

        {filteredHubs.length === 0 && (
          <Center h={200}>
            <Text c="dimmed">No Hub Signals Detected. (Did the Genesis Protocol run?)</Text>
          </Center>
        )}
      </Stack>
    </Container>
  );
};