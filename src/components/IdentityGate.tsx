import React, { useState, useEffect } from 'react';
import { useIdentityStore, IdentityState } from '../entities/identity/store';
import { usePlayerStore, ARCHETYPES } from '../entities/player/store';
import { 
  Center, Paper, Stack, TextInput, Button, Text, Loader, Alert, 
  SimpleGrid, Card, Badge, Group, Divider
} from '@mantine/core';

export const IdentityGate = ({ onComplete }: { onComplete: () => void }) => {
  const { state, createIdentity, certificate, error, checkExistingIdentity } = useIdentityStore();
  const { initializeSession } = usePlayerStore();
  
  const [name, setName] = useState('');
  const [selectedArchetype, setSelectedArchetype] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  // Check storage on mount
  useEffect(() => {
    checkExistingIdentity();
  }, []);

  const handleMint = async () => {
    if (!name || !selectedArchetype) return;
    setCreating(true);
    
    // 1. Generate Keys & Cert
    const success = await createIdentity(name);
    
    if (success) {
      // 2. We need the cert from the store now (it was just set)
      const cert = useIdentityStore.getState().certificate;
      if (cert) {
        // 3. Initialize Player Store
        initializeSession(cert, selectedArchetype);
        onComplete();
      }
    }
    setCreating(false);
  };

  const handleLogin = () => {
    if (certificate) {
      // For returning users, we default to OPERATOR or load from DB in future
      initializeSession(certificate, 'OPERATOR'); 
      onComplete();
    }
  };

  // --- LOADING STATE ---
  if (state === IdentityState.LOADING) {
    return (
      <Center h="100vh" bg="dark.9">
        <Stack align="center" gap="xs">
          <Loader color="emerald" size="lg" type="bars" />
          <Text c="emerald" size="xs" ff="monospace" className="animate-pulse">
            ESTABLISHING SECURE CONNECTION...
          </Text>
        </Stack>
      </Center>
    );
  }

  // --- RETURNING USER ---
  if (state === IdentityState.READY && certificate) {
    return (
      <Center h="100vh" bg="dark.9">
        <Stack align="center" gap="xl">
          <div style={{ 
            width: 120, height: 120, 
            borderRadius: '50%', 
            border: '2px solid var(--mantine-color-emerald-5)',
            boxShadow: '0 0 40px var(--mantine-color-emerald-9)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', 
            fontSize: 60, background: '#050505', color: '#fff'
          }}>
            👤
          </div>
          <Stack gap={0} align="center">
            <Text size="xl" fw={900} style={{ letterSpacing: 4 }} c="white">IDENTITY VERIFIED</Text>
            <Text c="emerald" fw={700} size="lg">{certificate.metadata.displayName.toUpperCase()}</Text>
            <Text c="dimmed" size="xs" ff="monospace">{certificate.metadata.uid}</Text>
          </Stack>
          <Button 
            size="xl" 
            color="emerald" 
            variant="outline"
            onClick={handleLogin} 
            className="animate-pulse"
            style={{ borderWidth: 2, letterSpacing: 2, marginTop: 20 }}
          >
            JACK IN
          </Button>
        </Stack>
      </Center>
    );
  }

  // --- NEW CHARACTER CREATOR ---
  return (
    <Center h="100vh" bg="dark.9">
      <Paper p="xl" withBorder style={{ width: 800, background: '#0a0a0a', borderColor: '#333' }}>
        <Stack gap="xl">
          <div>
            <Text size="xl" fw={900} c="emerald" style={{ letterSpacing: 2 }}>GENESIS PROTOCOL</Text>
            <Text size="sm" c="dimmed">Mint your Sovereign Identity to enter World Seed.</Text>
          </div>

          <Divider label="1. DESIGNATION" labelPosition="left" />
          
          <TextInput 
            placeholder="CODENAME / ALIAS"
            value={name}
            onChange={(e) => setName(e.target.value)}
            size="lg"
            styles={{ input: { fontFamily: 'monospace', textTransform: 'uppercase' } }}
          />

          <Divider label="2. NEURAL ARCHETYPE" labelPosition="left" />

          <SimpleGrid cols={2}>
            {Object.entries(ARCHETYPES).map(([key, stats]) => (
              <Card 
                key={key} 
                withBorder 
                padding="sm"
                style={{ 
                  cursor: 'pointer',
                  borderColor: selectedArchetype === key ? 'var(--mantine-color-emerald-5)' : '#333',
                  backgroundColor: selectedArchetype === key ? 'rgba(16, 185, 129, 0.1)' : 'transparent'
                }}
                onClick={() => setSelectedArchetype(key)}
              >
                <Group justify="space-between" mb="xs">
                  <Text fw={700} c={selectedArchetype === key ? 'emerald' : 'dimmed'}>{key}</Text>
                  {selectedArchetype === key && <Badge color="emerald">SELECTED</Badge>}
                </Group>
                <Stack gap={2}>
                  {Object.entries(stats).map(([stat, val]) => (
                    <Group key={stat} justify="space-between">
                      <Text size="xs" tt="capitalize" c="dimmed">{stat.replace('_', ' ')}</Text>
                      <Text size="xs" fw={700} c="white">+{val}</Text>
                    </Group>
                  ))}
                </Stack>
              </Card>
            ))}
          </SimpleGrid>
          
          {error && <Alert color="red" title="Generation Failed">{error}</Alert>}

          <Button 
            color="gold" 
            fullWidth 
            size="xl"
            onClick={handleMint} 
            loading={creating}
            disabled={!name || !selectedArchetype}
            style={{ marginTop: 20 }}
          >
            MINT IDENTITY CERTIFICATE
          </Button>
        </Stack>
      </Paper>
    </Center>
  );
};