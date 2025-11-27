import React, { useState } from 'react';
import { useIdentityStore } from '../entities/identity/store';
import { WorldCertificateSystem, WorldType, AccessMode, IWorldRules } from '../entities/world/WorldCertificate';
import { UniversalRank } from '../../types';
import {
  Modal, Stack, TextInput, Textarea, Select, NumberInput,
  Switch, Button, Group, Text, Paper, Slider, Badge,
  Stepper, Alert, Divider, SimpleGrid
} from '@mantine/core';

interface WorldCreatorProps {
  opened: boolean;
  onClose: () => void;
  onCreated: (worldUid: string) => void;
}

export const WorldCreator: React.FC<WorldCreatorProps> = ({ opened, onClose, onCreated }) => {
  const { certificate } = useIdentityStore();
  const [step, setStep] = useState(0);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [worldName, setWorldName] = useState('');
  const [worldDescription, setWorldDescription] = useState('');
  const [worldType, setWorldType] = useState<WorldType>(WorldType.EXTRACTION);
  const [size, setSize] = useState(32);
  
  // Rules
  const [accessMode, setAccessMode] = useState<AccessMode>(AccessMode.PUBLIC);
  const [entryFee, setEntryFee] = useState(0);
  const [extractionTax, setExtractionTax] = useState(5);
  const [creatorShare, setCreatorShare] = useState(3);
  const [pvpEnabled, setPvpEnabled] = useState(false);
  const [difficulty, setDifficulty] = useState<UniversalRank>(UniversalRank.D);
  const [sessionDuration, setSessionDuration] = useState(15);

  const handleCreate = async () => {
    if (!certificate) return;
    
    setCreating(true);
    setError(null);

    try {
      const rules: Partial<IWorldRules> = {
        accessMode,
        entryFeeGold: entryFee,
        extractionTaxRate: extractionTax / 100,
        creatorRevenueShare: creatorShare / 100,
        pvpEnabled,
        difficulty,
        sessionDurationMinutes: worldType === WorldType.EXTRACTION ? sessionDuration : undefined,
      };

      const worldCert = await WorldCertificateSystem.mintWorld(
        certificate,
        worldName,
        worldDescription,
        worldType,
        size,
        rules
      );

      if (worldCert) {
        onCreated(worldCert.data.worldUid);
        resetForm();
        onClose();
      } else {
        setError('Failed to sign World Certificate.');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error during signing.');
    }

    setCreating(false);
  };

  const resetForm = () => {
    setStep(0);
    setWorldName('');
    setWorldDescription('');
    setWorldType(WorldType.EXTRACTION);
    setSize(32);
    setAccessMode(AccessMode.PUBLIC);
    setEntryFee(0);
    setExtractionTax(5);
    setCreatorShare(3);
    setPvpEnabled(false);
    setDifficulty(UniversalRank.D);
    setSessionDuration(15);
  };

  const estimatedDailyRevenue = Math.floor(
    (size === 16 ? 10 : 50) * 500 * (creatorShare / 100)
  );

  return (
    <Modal 
      opened={opened} 
      onClose={onClose} 
      title={<Text fw={700} size="lg" c="gold">MINT NEW REALITY</Text>}
      size="lg"
      styles={{ header: { background: '#1a1a1a' }, body: { background: '#1a1a1a' } }}
    >
      <Stepper active={step} onStepClick={setStep} size="sm" mb="xl" color="gold">
        <Stepper.Step label="Concept" description="Define Reality" />
        <Stepper.Step label="Laws" description="Physics & Rules" />
        <Stepper.Step label="Economy" description="Taxes & Profit" />
        <Stepper.Step label="Sign" description="Cryptographic Proof" />
      </Stepper>

      {/* STEP 0: Identity */}
      {step === 0 && (
        <Stack gap="md">
          <TextInput
            label="World Name"
            placeholder="e.g. Sector 7 Slums"
            value={worldName}
            onChange={(e) => setWorldName(e.target.value)}
            maxLength={32}
          />
          <Textarea
            label="Lore Description"
            placeholder="A forgotten industrial sector reclaimed by neon flora..."
            value={worldDescription}
            onChange={(e) => setWorldDescription(e.target.value)}
            maxLength={500}
            rows={3}
          />
          <Select
            label="World Type"
            value={worldType}
            onChange={(v) => setWorldType(v as WorldType)}
            data={[
              { value: WorldType.EXTRACTION, label: '⚔️ Extraction (High Risk)' },
              { value: WorldType.HUB, label: '🏙️ Social Hub (Safe)' },
              { value: WorldType.ARENA, label: '🏟️ Arena (PvP)' }
            ]}
          />
          <Select
            label="Grid Size"
            value={size.toString()}
            onChange={(v) => setSize(parseInt(v || '32'))}
            data={[
              { value: '16', label: '16x16 (Skirmish)' },
              { value: '32', label: '32x32 (Standard)' },
              { value: '64', label: '64x64 (Expedition)' }
            ]}
          />
          <Group justify="flex-end" mt="md">
            <Button onClick={() => setStep(1)} disabled={!worldName} color="gray">Next: Laws →</Button>
          </Group>
        </Stack>
      )}

      {/* STEP 1: Rules */}
      {step === 1 && (
        <Stack gap="md">
          <Select
            label="Access Protocol"
            value={accessMode}
            onChange={(v) => setAccessMode(v as AccessMode)}
            data={[
              { value: AccessMode.PUBLIC, label: 'Open Access' },
              { value: AccessMode.TICKET, label: 'Ticket Required' },
              { value: AccessMode.GUILD, label: 'Guild Only' }
            ]}
          />
          <Select
            label="Danger Level (Rank)"
            value={difficulty}
            onChange={(v) => setDifficulty(v as UniversalRank)}
            data={Object.values(UniversalRank).map(r => ({ value: r, label: `Rank ${r}` }))}
          />
          <Switch
            label="Enable Hostile Player Action (PvP)"
            checked={pvpEnabled}
            onChange={(e) => setPvpEnabled(e.currentTarget.checked)}
            color="red"
          />
          {worldType === WorldType.EXTRACTION && (
            <NumberInput
              label="Collapse Timer (Minutes)"
              value={sessionDuration}
              onChange={(v) => setSessionDuration(typeof v === 'number' ? v : 15)}
              min={5}
              max={60}
            />
          )}
          <Group justify="space-between" mt="md">
            <Button variant="subtle" onClick={() => setStep(0)}>← Back</Button>
            <Button onClick={() => setStep(2)} color="gray">Next: Economy →</Button>
          </Group>
        </Stack>
      )}

      {/* STEP 2: Economy */}
      {step === 2 && (
        <Stack gap="md">
          <NumberInput
            label="Gate Fee (Gold)"
            value={entryFee}
            onChange={(v) => setEntryFee(typeof v === 'number' ? v : 0)}
            min={0}
            max={1000}
          />
          <Text size="sm">Extraction Tax: {extractionTax}%</Text>
          <Slider value={extractionTax} onChange={setExtractionTax} min={0} max={30} color="emerald" />
          
          <Text size="sm">Creator Revenue Share: {creatorShare}%</Text>
          <Slider value={creatorShare} onChange={setCreatorShare} min={0} max={10} color="gold" />

          <Paper p="md" bg="dark.8" withBorder>
            <Group justify="space-between">
              <Text size="xs" c="dimmed">Est. Daily Revenue</Text>
              <Text fw={700} c="gold">{estimatedDailyRevenue} G</Text>
            </Group>
          </Paper>

          <Group justify="space-between" mt="md">
            <Button variant="subtle" onClick={() => setStep(1)}>← Back</Button>
            <Button onClick={() => setStep(3)} color="gray">Next: Sign →</Button>
          </Group>
        </Stack>
      )}

      {/* STEP 3: Confirm */}
      {step === 3 && (
        <Stack gap="md">
          <Alert color="gold" title="Immutable Action">
            Minting this World Certificate will generate a cryptographic signature using your Identity Key. 
            This action creates a permanent asset on the ledger.
          </Alert>

          {error && <Alert color="red">{error}</Alert>}

          <Group justify="space-between" mt="md">
            <Button variant="subtle" onClick={() => setStep(2)}>← Back</Button>
            <Button 
              color="gold" 
              size="lg"
              loading={creating}
              onClick={handleCreate}
              className="animate-pulse"
            >
              SIGN & MINT WORLD
            </Button>
          </Group>
        </Stack>
      )}
    </Modal>
  );
};