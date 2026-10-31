/**
 * HOLDINGS (Wave 9): property, and only property. The stash moved into the
 * Bank where it belongs — this screen is lots, deeds, workshops and counters.
 */

import React, { useEffect, useState } from 'react';
import { IItem, ItemType, UniversalRank } from '../../types';
import { useHubStore, IPlayerLot } from '../entities/hub/store';
import { usePlayerStore } from '../entities/player/store';
import { DeedSystem, IDeedItem } from '../logic/systems/DeedSystem';
import { RECIPE_DEFINITIONS, STRUCTURE_COSTS } from '../entities/economy/data/recipeDefinitions';
import { SHELL_BILLS, SHELL_BUILD_SECONDS, billText, pickBill } from '../entities/hub/room';
import { Button, Chip, Input, ItemSprite, Panel } from './ui/kit';

const STRUCTURES = ['WORKSHOP', 'VENDOR', 'HOUSE'] as const;
const countOf = (items: IItem[], defId: string) => items.filter(i => i.universalDefinitionId === defId).length;

const LotCard: React.FC<{ lot: IPlayerLot; now: number }> = ({ lot, now }) => {
  const { player } = usePlayerStore();
  const hub = useHubStore();
  const stash = player.bank.stashTabs[0]?.items || [];
  const deeds = stash.filter(i => i.type === ItemType.DEED) as IDeedItem[];
  const mine = lot.ownerId === player.id;
  const [listId, setListId] = useState<string>('');
  const [listPrice, setListPrice] = useState('50');
  const jobs = hub.craftingJobs.filter(j => j.lotId === lot.id && !j.collected);
  const shellJob = hub.buildJobs.find(j => j.lotId === lot.id && !j.applied && j.kind === 'SHELL');

  const stateChip = !lot.ownerId
    ? <Chip tone="proof">{lot.price.toLocaleString()} G</Chip>
    : mine
      ? <Chip tone="signal">{lot.structureType}</Chip>
      : <Chip>{lot.ownerName}</Chip>;

  return (
    <Panel title={`LOT ${lot.lotIndex}`} right={stateChip} tone={mine ? 'signal' : 'none'} data-testid={`lot-${lot.lotIndex}`}>
      {!lot.ownerId && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <Button disabled={player.bank.gold < lot.price} onClick={() => hub.buyLot(lot.id)}>
            BUY LOT ({lot.price.toLocaleString()} G)
          </Button>
          {deeds.map(deed => (
            <Button
              key={deed.id} tone="proof"
              onClick={() => DeedSystem.redeemDeed(deed, lot.id, { id: player.id, name: player.username })}
            >
              REDEEM {deed.name.toUpperCase()}
            </Button>
          ))}
        </div>
      )}

      {/* Wave 10 (D8): the permit is gold, the walls are materials, and the
          building finishes on the clock. The shell job shows its countdown. */}
      {mine && shellJob && (
        <span className="ws-dim ws-small">
          {shellJob.structureType} under construction — {Math.max(0, Math.ceil((shellJob.finishesAt - now) / 1000))}s on the clock
        </span>
      )}
      {mine && !shellJob && lot.structureType === 'EMPTY' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {STRUCTURES.map(s => {
            const bill = pickBill(SHELL_BILLS[s], stash);
            const short = !bill.ok ? bill.missing : player.bank.gold < STRUCTURE_COSTS[s].build ? `${STRUCTURE_COSTS[s].build}G permit` : null;
            return (
              <Button
                key={s}
                disabled={!!short}
                title={short ? `Short: ${short}` : `${SHELL_BUILD_SECONDS[s]}s to raise`}
                onClick={() => hub.buildStructure(lot.id, s)}
              >
                BUILD {s} ({STRUCTURE_COSTS[s].build}G + {billText(SHELL_BILLS[s])})
              </Button>
            );
          })}
        </div>
      )}

      {mine && lot.structureType === 'WORKSHOP' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {Object.values(RECIPE_DEFINITIONS).map(recipe => {
            const ready = recipe.inputs.every(i => countOf(stash, i.itemId) >= i.quantity);
            return (
              <Button key={recipe.id} disabled={!ready} title={recipe.description} onClick={() => hub.queueCraft(lot.id, recipe.id)}>
                {recipe.name.toUpperCase()} ({recipe.laborTimeSeconds}s)
              </Button>
            );
          })}
          {jobs.map(job => {
            const left = Math.ceil((job.finishesAt - now) / 1000);
            return (
              <div key={job.id} className="ws-row">
                <span className="ws-small">{RECIPE_DEFINITIONS[job.recipeId]?.name}</span>
                {left > 0
                  ? <span className="ws-dim ws-small">{left}s on the bench</span>
                  : <Button tone="signal" onClick={() => hub.resolveCrafts()}>COLLECT</Button>}
              </div>
            );
          })}
        </div>
      )}

      {lot.structureType === 'VENDOR' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {mine && (lot.proceeds || 0) > 0 && (
            <Button tone="proof" onClick={() => hub.collectProceeds(lot.id)}>COLLECT {lot.proceeds}G</Button>
          )}
          {mine && (
            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
              <select className="ws-input" style={{ flex: 1 }} value={listId} onChange={e => setListId(e.target.value)}>
                <option value="">Item to list…</option>
                {stash.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
              </select>
              <Input type="number" min={1} value={listPrice} onChange={e => setListPrice(e.target.value)} style={{ width: 70 }} />
              <Button
                disabled={!listId || !Number(listPrice)}
                onClick={() => { if (listId) { hub.listItemForSale(lot.id, listId, Number(listPrice)); setListId(''); } }}
              >
                LIST
              </Button>
            </div>
          )}
          {(lot.shopListings || []).map(listing => (
            <div key={listing.item.id} className="ws-row">
              <span style={{ display: 'flex', gap: 6, alignItems: 'center', minWidth: 0 }}>
                <ItemSprite item={listing.item} cellPx={14} />
                <span className="ws-small" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{listing.item.name}</span>
              </span>
              <Button tone="proof" disabled={player.bank.gold < listing.price} onClick={() => hub.buyFromLot(lot.id, listing.item.id)}>
                BUY {listing.price}G
              </Button>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
};

export const HoldingsPanel: React.FC<{ devMode: boolean }> = ({ devMode }) => {
  const { lots } = useHubStore();
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
      // Wave 10: construction resolves when someone looks, like the crafts.
      const due = useHubStore.getState().buildJobs.some(j => !j.applied && j.finishesAt <= Date.now());
      if (due) void useHubStore.getState().resolveBuilds();
    }, 1000);
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
    <div className="ws-ui" style={{ padding: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <span className="ws-dim ws-small">
          Six lots. Upkeep is charged by the world-day; an unpaid lot reverts to the market with its goods returned.
        </span>
        {devMode && <Button tone="quiet" onClick={grantTestDeed}>DEV: GRANT DEED</Button>}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 10 }}>
        {lots.map(lot => <LotCard key={lot.id} lot={lot} now={now} />)}
      </div>
    </div>
  );
};
