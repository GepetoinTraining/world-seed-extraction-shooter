import React, { useState, useEffect } from 'react';
import { useIdentityStore, IdentityState } from '../entities/identity/store';
import { usePlayerStore, ARCHETYPES } from '../entities/player/store';
import { 
  Center, Paper, Stack, TextInput, Button, Text, Loader, Alert, 
  SimpleGrid, Card, Badge, Group, Divider, ActionIcon, FileInput, PasswordInput
} from '@mantine/core';

export const IdentityGate = ({ onComplete }: { onComplete: () => void }) => {
  const { state, createIdentity, certificate, error, checkExistingIdentity, clearIdentity, exportIdentity } = useIdentityStore();
  const { initializeSession } = usePlayerStore();
  
  const [name, setName] = useState('');
  const [selectedArchetype, setSelectedArchetype] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [backupFile, setBackupFile] = useState<File | null>(null);
  const [backupPass, setBackupPass] = useState('');
  const [restoreError, setRestoreError] = useState<string | null>(null);

  useEffect(() => {
    checkExistingIdentity();
  }, []);

  const handleMint = async () => {
    if (!name || !selectedArchetype) return;
    setCreating(true);
    const success = await createIdentity(name);
    if (success) {
      const cert = useIdentityStore.getState().certificate;
      if (cert) {
        initializeSession(cert, selectedArchetype);
        onComplete();
      }
    }
    setCreating(false);
  };

  const handleRestore = async () => {
    if (!backupFile) return;
    setRestoreError(null);
    const { AvatarExport } = await import('../logic/sovereignty/AvatarExport');
    const result = await AvatarExport.importAvatar(await backupFile.text(), backupPass);
    if (result.ok) window.location.reload();
    else setRestoreError(result.reason || 'Unknown error');
  };

  const handleLogin = () => {
    if (certificate) {
      initializeSession(certificate, 'OPERATOR'); 
      onComplete();
    }
  };

  const handleExport = async () => {
    const password = prompt("Set encryption password for export:");
    if (!password) return;
    
    const blob = await exportIdentity(password);
    if (blob) {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `worldseed_identity_${certificate?.metadata.uid}.json`;
      a.click();
      URL.revokeObjectURL(url);
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
            fontSize: 60, 
            backgroundColor: '#050505', // FIX: backgroundColor
            color: '#fff'
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

          <Group>
            <Button variant="subtle" color="blue" size="xs" onClick={handleExport}>
              EXPORT CERTIFICATE
            </Button>
            <Button 
              variant="subtle" 
              color="red" 
              size="xs"
              onClick={() => {
                if (confirm('WIPE IDENTITY? This cannot be undone.')) {
                  clearIdentity();
                  window.location.reload();
                }
              }}
            >
              NUKE IDENTITY
            </Button>
          </Group>
        </Stack>
      </Center>
    );
  }

  // --- NEW CHARACTER CREATOR ---
  return (
    <Center h="100vh" bg="dark.9">
      <Paper 
        p="xl" 
        withBorder 
        style={{ 
            width: 800, 
            backgroundColor: '#0a0a0a', // FIX: backgroundColor
            borderColor: '#333' 
        }}
      >
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

          <Divider label="OR RESTORE A BACKUP" labelPosition="center" />
          <Group align="flex-end" grow>
            <FileInput label="Backup file" placeholder="wsav_....json" value={backupFile} onChange={setBackupFile} accept="application/json" />
            <PasswordInput label="Passphrase" value={backupPass} onChange={(e) => setBackupPass(e.target.value)} />
            <Button variant="outline" color="emerald" disabled={!backupFile || !backupPass} onClick={handleRestore}>
              RESTORE AVATAR
            </Button>
          </Group>
          {restoreError && <Alert color="red" title="Restore refused">{restoreError}</Alert>}
        </Stack>
      </Paper>
    </Center>
  );
};