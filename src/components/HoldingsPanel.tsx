import React, { useEffect, useState } from 'react';
import { Badge, Button, Group, NumberInput, Paper, ScrollArea, Select, SimpleGrid, Stack, Text } from '@mantine/core';
import { IItem, ItemType, UniversalRank } from '../../types';
import { useHubStore, IPlayerLot } from '../entities/hub/store';
import { usePlayerStore } from '../entities/player/store';
import { DeedSystem, IDeedItem } from '../logic/systems/DeedSystem';
import { RECIPE_DEFINITIONS, STRUCTURE_COSTS } from '../entities/economy/data/recipeDefinitions';

const STRUCTURES = ['WORKSHOP', 'VENDOR', 'HOUSE'] as const;

const countOf = (items: IItem[], defId: string) => items.filter(i => i.universalDefinitionId === defId).length;

const StashActions: React.FC = () => {
  const { player, toggleCarry } = usePlayerStore();
  const { sellToVendor } = useHubStore();
  const stash = player.bank.stashTabs[0]?.items || [];

  return (
    <Paper p="md" bg="dark.8" withBorder>
      <Group justify="space-between" mb="sm">
        <Text fw={700}>STASH</Text>
        <Badge color="gold">{player.bank.gold.toLocaleString()} G</Badge>
      </Group>
      <ScrollArea h={420} offsetScrollbars>
        <Stack gap={4}>
          {stash.length === 0 && <Text size="sm" c="dimmed">Nothing stored.</Text>}
          {stash.map(item => {
            const isTool = item.tags?.includes('tool');
            const carrying = isTool || player.bank.carryItemIds?.includes(item.id);
            return (
              <Group key={item.id} justify="space-between" wrap="nowrap" p={4} style={{ borderBottom: '1px solid #222' }}>
                <div style={{ minWidth: 0 }}>
                  <Text size="sm" truncate>{item.name}</Text>
                  <Text size="xs" c="dimmed">{item.weight}kg · value {item.value}G</Text>
                </div>
                <Group gap={4} wrap="nowrap">
                  <Button
                    size="compact-xs"
                    variant={carrying ? 'filled' : 'light'}
                    color="emerald"
                    disabled={isTool}
                    onClick={() => toggleCarry(item.id)}
                  >
                    {carrying ? 'Carrying' : 'Carry'}
                  </Button>
                  <Button size="compact-xs" variant="light" color="gold" onClick={() => sellToVendor(item.id)}>
                    Sell {Math.max(1, Math.floor((item.value || 1) * 0.6))}G
                  </Button>
                </Group>
              </Group>
            );
          })}
        </Stack>
      </ScrollArea>
    </Paper>
  );
};

const LotCard: React.FC<{ lot: IPlayerLot; now: number }> = ({ lot, now }) => {
  const { player } = usePlayerStore();
  const hub = useHubStore();
  const stash = player.bank.stashTabs[0]?.items || [];
  const deeds = stash.filter(i => i.type === ItemType.DEED) as IDeedItem[];
  const mine = lot.ownerId === player.id;
  const [listId, setListId] = useState<string | null>(null);
  const [listPrice, setListPrice] = useState<number | string>(50);
  const jobs = hub.craftingJobs.filter(j => j.lotId === lot.id && !j.collected);

  return (
    <Paper p="sm" bg="dark.7" withBorder data-testid={`lot-${lot.lotIndex}`}>
      <Group justify="space-between" mb={6}>
        <Text fw={700} size="sm">LOT {lot.lotIndex}</Text>
        <Badge size="sm" color={mine ? 'emerald' : lot.ownerId ? 'gray' : 'blue'}>
          {lot.ownerId ? (mine ? lot.structureType : `${lot.ownerName}`) : `${lot.price.toLocaleString()} G`}
        </Badge>
      </Group>

      {!lot.ownerId && (
        <Stack gap={4}>
          <Button size="compact-sm" variant="light" disabled={player.bank.gold < lot.price} onClick={() => hub.buyLot(lot.id)}>
            Buy lot
          </Button>
          {deeds.map(deed => (
            <Button
              key={deed.id}
              size="compact-sm"
              variant="light"
              color="gold"
              onClick={() => DeedSystem.redeemDeed(deed, lot.id, { id: player.id, name: player.username })}
            >
              Redeem {deed.name}
            </Button>
          ))}
        </Stack>
      )}

      {mine && (lot.structureType === 'EMPTY' || lot.structureType === 'HOUSE') && (
        <Group gap={4}>
          {STRUCTURES.filter(s => s !== lot.structureType).map(s => (
            <Button
              key={s}
              size="compact-xs"
              variant="light"
              disabled={player.bank.gold < STRUCTURE_COSTS[s].build}
              onClick={() => hub.buildStructure(lot.id, s)}
            >
              Build {s} ({STRUCTURE_COSTS[s].build}G)
            </Button>
          ))}
        </Group>
      )}

      {mine && lot.structureType === 'WORKSHOP' && (
        <Stack gap={4}>
          {Object.values(RECIPE_DEFINITIONS).map(recipe => {
            const ready = recipe.inputs.every(i => countOf(stash, i.itemId) >= i.quantity);
            return (
              <Button
                key={recipe.id}
                size="compact-xs"
                variant="light"
                disabled={!ready}
                title={recipe.description}
                onClick={() => hub.queueCraft(lot.id, recipe.id)}
              >
                {recipe.name} ({recipe.laborTimeSeconds}s)
              </Button>
            );
          })}
          {jobs.map(job => {
            const left = Math.ceil((job.finishesAt - now) / 1000);
            return (
              <Group key={job.id} justify="space-between">
                <Text size="xs">{RECIPE_DEFINITIONS[job.recipeId]?.name}</Text>
                {left > 0
                  ? <Text size="xs" c="dimmed" ff="monospace">{left}s</Text>
                  : <Button size="compact-xs" color="emerald" onClick={() => hub.resolveCrafts()}>Collect</Button>}
              </Group>
            );
          })}
        </Stack>
      )}

      {lot.structureType === 'VENDOR' && (
        <Stack gap={4}>
          {mine && (lot.proceeds || 0) > 0 && (
            <Button size="compact-xs" color="gold" onClick={() => hub.collectProceeds(lot.id)}>
              Collect {lot.proceeds}G
            </Button>
          )}
          {mine && (
            <Group gap={4} align="flex-end" wrap="nowrap">
              <Select
                size="xs"
                flex={1}
                placeholder="Item to list"
                data={stash.map(i => ({ value: i.id, label: i.name }))}
                value={listId}
                onChange={setListId}
                comboboxProps={{ withinPortal: true }}
              />
              <NumberInput size="xs" w={70} min={1} value={listPrice} onChange={setListPrice} />
              <Button
                size="xs"
                disabled={!listId || !Number(listPrice)}
                onClick={() => { if (listId) { hub.listItemForSale(lot.id, listId, Number(listPrice)); setListId(null); } }}
              >
                List
              </Button>
            </Group>
          )}
          {(lot.shopListings || []).map(listing => (
            <Group key={listing.item.id} justify="space-between" wrap="nowrap">
              <Text size="xs" truncate>{listing.item.name}</Text>
              <Button
                size="compact-xs"
                color="gold"
                disabled={player.bank.gold < listing.price}
                onClick={() => hub.buyFromLot(lot.id, listing.item.id)}
              >
                Buy {listing.price}G
              </Button>
            </Group>
          ))}
        </Stack>
      )}
    </Paper>
  );
};

export const HoldingsPanel: React.FC<{ devMode: boolean }> = ({ devMode }) => {
  const { lots } = useHubStore();
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Deeds are rare drops, so a test run needs a way to hold one on demand.
  const grantTestDeed = () => {
    const deed = DeedSystem.createDeed(0, 0, 'dev', 'RUINS', UniversalRank.B);
    usePlayerStore.setState(s => ({
      player: { ...s.player, bank: { ...s.player.bank, stashTabs: s.player.bank.stashTabs.map((tab, idx) =>
        idx === 0 ? { ...tab, items: [...tab.items, deed] } : tab
      ) } }
    }));
  };

  return (
    <SimpleGrid cols={2} h="100%">
      <StashActions />
      <Paper p="md" bg="dark.8" withBorder>
        <Group justify="space-between" mb="sm">
          <Text fw={700}>LOTS</Text>
          {devMode && <Button size="compact-xs" variant="outline" color="cyan" onClick={grantTestDeed}>DEV: grant deed</Button>}
        </Group>
        <ScrollArea h={420} offsetScrollbars>
          <Stack gap="xs">
            {lots.map(lot => <LotCard key={lot.id} lot={lot} now={now} />)}
          </Stack>
        </ScrollArea>
      </Paper>
    </SimpleGrid>
  );
};
