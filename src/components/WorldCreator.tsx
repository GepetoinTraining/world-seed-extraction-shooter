/**
 * WORLD CREATOR
 * Mint new World Seed certificates
 * 
 * This is where players become creators.
 */

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
  const [ipCap, setIpCap] = useState<UniversalRank | undefined>(undefined);

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
        ipCap
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
        setError('Failed to create world');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
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
    setIpCap(undefined);
  };

  // Estimated revenue calculation
  const estimatedDailyVisitors = size === 16 ? 10 : size === 32 ? 25 : size === 64 ? 50 : 100;
  const estimatedGoldPerVisitor = 500;
  const estimatedDailyRevenue = Math.floor(
    estimatedDailyVisitors * estimatedGoldPerVisitor * (creatorShare / 100)
  );

  return (
    <Modal 
      opened={opened} 
      onClose={onClose} 
      title={<Text fw={700} size="lg">MINT NEW WORLD</Text>}
      size="lg"
    >
      <Stepper active={step} onStepClick={setStep} size="sm" mb="xl">
        <Stepper.Step label="Identity" description="Name your world" />
        <Stepper.Step label="Rules" description="Set the laws" />
        <Stepper.Step label="Economy" description="Revenue model" />
        <Stepper.Step label="Confirm" description="Mint certificate" />
      </Stepper>

      {/* STEP 0: Identity */}
      {step === 0 && (
        <Stack gap="md">
          <TextInput
            label="World Name"
            placeholder="Enter a unique name"
            value={worldName}
            onChange={(e) => setWorldName(e.target.value)}
            maxLength={32}
          />
          
          <Textarea
            label="Description"
            placeholder="Describe your world..."
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
              { value: WorldType.EXTRACTION, label: '⚔️ Extraction - Timed loot runs' },
              { value: WorldType.HUB, label: '🏙️ Hub - Social & trading' },
              { value: WorldType.RAID, label: '👹 Raid - Large-scale PvE' },
              { value: WorldType.ARENA, label: '🏟️ Arena - PvP focused' },
              { value: WorldType.SANDBOX, label: '🎨 Sandbox - Creative freedom' }
            ]}
          />

          <Select
            label="World Size"
            value={size.toString()}
            onChange={(v) => setSize(parseInt(v || '32'))}
            data={[
              { value: '16', label: '16x16 - Small (Quick runs)' },
              { value: '32', label: '32x32 - Medium (Standard)' },
              { value: '64', label: '64x64 - Large (Extended)' },
              { value: '128', label: '128x128 - Massive (Raid scale)' }
            ]}
          />

          <Group justify="flex-end" mt="md">
            <Button onClick={() => setStep(1)} disabled={!worldName}>
              Next: Rules →
            </Button>
          </Group>
        </Stack>
      )}

      {/* STEP 1: Rules */}
      {step === 1 && (
        <Stack gap="md">
          <Select
            label="Access Mode"
            value={accessMode}
            onChange={(v) => setAccessMode(v as AccessMode)}
            data={[
              { value: AccessMode.PUBLIC, label: '🌐 Public - Anyone can enter' },
              { value: AccessMode.WHITELIST, label: '📋 Whitelist - Approved only' },
              { value: AccessMode.TICKET, label: '🎟️ Ticket - Requires item' },
              { value: AccessMode.GUILD, label: '🛡️ Guild - Members only' }
            ]}
          />

          <Select
            label="Difficulty"
            value={difficulty}
            onChange={(v) => setDifficulty(v as UniversalRank)}
            data={[
              { value: UniversalRank.F, label: 'F - Trivial' },
              { value: UniversalRank.E, label: 'E - Easy' },
              { value: UniversalRank.D, label: 'D - Normal' },
              { value: UniversalRank.C, label: 'C - Challenging' },
              { value: UniversalRank.B, label: 'B - Hard' },
              { value: UniversalRank.A, label: 'A - Very Hard' },
              { value: UniversalRank.S, label: 'S - Nightmare' }
            ]}
          />

          <Select
            label="Item Power Cap (Optional)"
            value={ipCap || ''}
            onChange={(v) => setIpCap(v as UniversalRank || undefined)}
            clearable
            data={[
              { value: UniversalRank.D, label: 'D - Newcomer friendly' },
              { value: UniversalRank.C, label: 'C - Intermediate' },
              { value: UniversalRank.B, label: 'B - Experienced' },
              { value: UniversalRank.A, label: 'A - Veterans' },
              { value: '', label: 'No cap - Bring everything' }
            ]}
          />

          <Switch
            label="Enable PvP"
            description="Players can attack each other"
            checked={pvpEnabled}
            onChange={(e) => setPvpEnabled(e.currentTarget.checked)}
          />

          {worldType === WorldType.EXTRACTION && (
            <NumberInput
              label="Session Duration (minutes)"
              value={sessionDuration}
              onChange={(v) => setSessionDuration(typeof v === 'number' ? v : 15)}
              min={5}
              max={60}
            />
          )}

          <Group justify="space-between" mt="md">
            <Button variant="subtle" onClick={() => setStep(0)}>← Back</Button>
            <Button onClick={() => setStep(2)}>Next: Economy →</Button>
          </Group>
        </Stack>
      )}

      {/* STEP 2: Economy */}
      {step === 2 && (
        <Stack gap="md">
          <NumberInput
            label="Entry Fee (Gold)"
            description="Players pay this to enter"
            value={entryFee}
            onChange={(v) => setEntryFee(typeof v === 'number' ? v : 0)}
            min={0}
            max={1000}
          />

          <div>
            <Text size="sm" fw={500} mb="xs">Extraction Tax: {extractionTax}%</Text>
            <Text size="xs" c="dimmed" mb="xs">
              Percentage of loot value taken on extraction (stays in world treasury)
            </Text>
            <Slider
              value={extractionTax}
              onChange={setExtractionTax}
              min={0}
              max={30}
              marks={[
                { value: 0, label: '0%' },
                { value: 15, label: '15%' },
                { value: 30, label: '30%' }
              ]}
            />
          </div>

          <div>
            <Text size="sm" fw={500} mb="xs">Creator Revenue Share: {creatorShare}%</Text>
            <Text size="xs" c="dimmed" mb="xs">
              Your cut of all gold generated (max 10%)
            </Text>
            <Slider
              value={creatorShare}
              onChange={setCreatorShare}
              min={0}
              max={10}
              marks={[
                { value: 0, label: '0%' },
                { value: 5, label: '5%' },
                { value: 10, label: '10%' }
              ]}
            />
          </div>

          <Paper p="md" bg="dark.8" withBorder>
            <Text size="sm" fw={700} c="emerald.4" mb="sm">ESTIMATED DAILY REVENUE</Text>
            <SimpleGrid cols={2}>
              <div>
                <Text size="xs" c="dimmed">Est. Daily Visitors</Text>
                <Text fw={700}>{estimatedDailyVisitors}</Text>
              </div>
              <div>
                <Text size="xs" c="dimmed">Est. Gold/Visitor</Text>
                <Text fw={700}>{estimatedGoldPerVisitor}</Text>
              </div>
              <div>
                <Text size="xs" c="dimmed">Your Share</Text>
                <Text fw={700}>{creatorShare}%</Text>
              </div>
              <div>
                <Text size="xs" c="dimmed">Daily Revenue</Text>
                <Text fw={700} c="gold.4">{estimatedDailyRevenue} gold</Text>
              </div>
            </SimpleGrid>
          </Paper>

          <Group justify="space-between" mt="md">
            <Button variant="subtle" onClick={() => setStep(1)}>← Back</Button>
            <Button onClick={() => setStep(3)}>Next: Confirm →</Button>
          </Group>
        </Stack>
      )}

      {/* STEP 3: Confirm */}
      {step === 3 && (
        <Stack gap="md">
          <Alert color="gold" title="You are about to mint a World Certificate">
            <Text size="sm">
              This creates a sovereign, tradeable digital asset. You will own this world 
              and can sell it on the marketplace.
            </Text>
          </Alert>

          <Paper p="md" bg="dark.8" withBorder>
            <Stack gap="xs">
              <Group justify="space-between">
                <Text size="sm" c="dimmed">World Name</Text>
                <Text size="sm" fw={700}>{worldName}</Text>
              </Group>
              <Group justify="space-between">
                <Text size="sm" c="dimmed">Type</Text>
                <Badge>{worldType}</Badge>
              </Group>
              <Group justify="space-between">
                <Text size="sm" c="dimmed">Size</Text>
                <Text size="sm">{size}x{size}</Text>
              </Group>
              <Group justify="space-between">
                <Text size="sm" c="dimmed">Difficulty</Text>
                <Badge color="red">{difficulty}</Badge>
              </Group>
              <Divider my="xs" />
              <Group justify="space-between">
                <Text size="sm" c="dimmed">Entry Fee</Text>
                <Text size="sm">{entryFee} gold</Text>
              </Group>
              <Group justify="space-between">
                <Text size="sm" c="dimmed">Extraction Tax</Text>
                <Text size="sm">{extractionTax}%</Text>
              </Group>
              <Group justify="space-between">
                <Text size="sm" c="dimmed">Your Revenue Share</Text>
                <Text size="sm" c="emerald.4" fw={700}>{creatorShare}%</Text>
              </Group>
            </Stack>
          </Paper>

          {error && <Alert color="red">{error}</Alert>}

          <Group justify="space-between" mt="md">
            <Button variant="subtle" onClick={() => setStep(2)}>← Back</Button>
            <Button 
              color="gold" 
              size="lg"
              loading={creating}
              onClick={handleCreate}
            >
              ⚡ MINT WORLD CERTIFICATE
            </Button>
          </Group>
        </Stack>
      )}
    </Modal>
  );
};