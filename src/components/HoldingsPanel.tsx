/**
 * HOLDINGS (Wave 9): property, and only property. The stash moved into the
 * Bank where it belongs — this screen is lots, deeds, workshops and counters.
 */

import { RestDoor } from '../logic/systems/RestDoor';
import React, { useEffect, useMemo, useState } from 'react';
import { IItem, ItemType, UniversalRank } from '../../types';
import { craftName, useHubStore, worldDay, IPlayerLot } from '../entities/hub/store';
import { HubGenerator, IPOI } from '../entities/hub/HubGenerator';
import { usePlayerStore } from '../entities/player/store';
import { DeedSystem, IDeedItem } from '../logic/systems/DeedSystem';
import { GEAR_RECIPES, RECIPE_DEFINITIONS, STRUCTURE_COSTS } from '../entities/economy/data/recipeDefinitions';
import { SHELL_BILLS, SHELL_BUILD_SECONDS, answersTag, billText, materialLabel, pickBill } from '../entities/hub/room';
import { Button, Chip, Input, ItemSprite, Panel, TimerBar } from './ui/kit';
import { lotConstruction } from '../entities/hub/template';
import { isTemplateItem } from '../logic/systems/TemplateSystem';
import { TemplateApplyModal } from './TemplateApplyModal';
import { TemplateStudio } from './TemplateStudio';

const STRUCTURES = ['WORKSHOP', 'VENDOR', 'HOUSE'] as const;
const DAY_MS = 86_400_000;
const countOf = (items: IItem[], defId: string) => items.filter(i => i.universalDefinitionId === defId).length;

const LotCard: React.FC<{ lot: IPlayerLot; poi: IPOI | null; now: number }> = ({ lot, poi, now }) => {
  const { player } = usePlayerStore();
  const hub = useHubStore();
  const stash = player.bank.stashTabs[0]?.items || [];
  const deeds = stash.filter(i => i.type === ItemType.DEED) as IDeedItem[];
  const mine = lot.ownerId === player.id;
  const [listId, setListId] = useState<string>('');
  const [listPrice, setListPrice] = useState('50');
  const [applyOpen, setApplyOpen] = useState(false);
  // D13: the walls are the builder's choice. Nobody chose: the stash pays in order.
  const [wallMaterial, setWallMaterial] = useState('');
  // D27: what a further bench is fitted as. A connection opened it; the list comes from the web.
  const [fitting, setFitting] = useState('');
  const openFittings = hub.openStationsNow();
  const wallOptions = [...new Set(stash.filter(i => answersTag(i, 'building')).map(i => i.universalDefinitionId))];
  const jobs = hub.craftingJobs.filter(j => j.lotId === lot.id && !j.collected);
  const shellJob = hub.buildJobs.find(j => j.lotId === lot.id && !j.applied && j.kind === 'SHELL');
  // Wave 10B: a rising template batch, counted step by step
  const construction = lotConstruction(hub.buildJobs, lot.id);
  const templatesHeld = stash.some(i => isTemplateItem(i));

  const stateChip = !lot.ownerId
    ? <Chip tone="proof">{lot.price.toLocaleString()} G</Chip>
    : mine
      ? <Chip tone="signal">{lot.structureType}</Chip>
      : <Chip>{lot.ownerName}</Chip>;

  return (
    <Panel title={`LOT ${lot.lotIndex}`} right={stateChip} tone={mine ? 'signal' : 'none'} data-testid={`lot-${lot.lotIndex}`}>
      {poi && (
        <div className="ws-dim ws-small" style={{ marginBottom: 4 }}>
          {poi.size.width}×{poi.size.height}, {poi.metadata.fromCentre} tiles from the centre
        </div>
      )}
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
        <div className="ws-small">
          <div className="ws-dim">{shellJob.template ? shellJob.template.data.name : shellJob.structureType} under construction</div>
          <TimerBar startedAt={shellJob.queuedAt} until={shellJob.finishesAt} />
        </div>
      )}
      {mine && !shellJob && construction && (
        <span className="ws-dim ws-small">
          UNDER CONSTRUCTION — {construction.applied} of {construction.total} steps stand
        </span>
      )}
      {mine && !shellJob && !construction && lot.structureType === 'EMPTY' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {templatesHeld && (
            <Button tone="signal" onClick={() => setApplyOpen(true)}>
              RAISE FROM A PLAN (template)
            </Button>
          )}
          {applyOpen && <TemplateApplyModal lot={lot} onClose={() => setApplyOpen(false)} />}
          {wallOptions.length > 0 && (
            <select className="ws-input" value={wallMaterial} onChange={e => setWallMaterial(e.target.value)} aria-label="Material for the walls">
              <option value="">Walls of whatever the stash holds first</option>
              {wallOptions.map(defId => (
                <option key={defId} value={defId}>
                  Walls of {materialLabel(defId)} — {countOf(stash, defId)} held
                </option>
              ))}
            </select>
          )}
          {/* D27: a further bench can be fitted as a station a connection has opened */}
          {openFittings.length > 0 && hub.shellBillNow('WORKSHOP').length >= SHELL_BILLS.WORKSHOP.length && (
            <select className="ws-input" value={fitting} onChange={e => setFitting(e.target.value)} aria-label="What the bench is fitted as">
              <option value="">Fitted as a plain Work Bench</option>
              {openFittings.map(station => (
                <option key={station.id} value={station.id}>
                  Fitted as {station.name} — needs {station.minArea} clear tiles
                </option>
              ))}
            </select>
          )}
          {STRUCTURES.map(s => {
            const askNow = hub.shellBillNow(s, s === 'WORKSHOP' && fitting ? fitting : undefined);
            const bill = pickBill(askNow, stash, wallMaterial || undefined);
            const short = !bill.ok ? bill.missing : player.bank.gold < STRUCTURE_COSTS[s].build ? `${STRUCTURE_COSTS[s].build}G permit` : null;
            return (
              <Button
                key={s}
                disabled={!!short}
                title={short ? `Short: ${short}` : `${SHELL_BUILD_SECONDS[s]}s to raise`}
                onClick={() => hub.buildStructure(lot.id, s, wallMaterial || undefined, s === 'WORKSHOP' && fitting ? fitting : undefined)}
              >
                BUILD {s} ({STRUCTURE_COSTS[s].build}G + {billText(askNow)})
              </Button>
            );
          })}
          {hub.shellBillNow('WORKSHOP').length < SHELL_BILLS.WORKSHOP.length && (
            <span className="ws-dim ws-small">Your first bench. Logs and stone will raise it; the metal line waits for the second.</span>
          )}
        </div>
      )}

      {mine && lot.structureType === 'HOUSE' && !construction && (
        <div style={{ marginTop: 6 }}>
          {/* D43: a bed gives a HOUSE its function. Your own costs nothing. */}
          <Button tone="signal" onClick={() => void RestDoor.sleep('BED')}>SLEEP HERE</Button>
        </div>
      )}

      {mine && lot.structureType === 'WORKSHOP' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {/* Wave 10D: gear recipes join the bench here too */}
          {[...Object.values(RECIPE_DEFINITIONS), ...Object.values(GEAR_RECIPES).filter(r => r.requiredFacility === 'WORKSHOP'), ...hub.stationRecipesOn(lot.id)].map(recipe => {
            const ready = recipe.inputs.every(i => countOf(stash, i.itemId) >= i.quantity);
            const refusal = hub.craftRefusal(lot.id, recipe.id);
            return (
              <Button key={recipe.id} disabled={!ready || !!refusal} title={refusal ?? recipe.description} onClick={() => hub.queueCraft(lot.id, recipe.id)}>
                {recipe.name.toUpperCase()} ({hub.craftSecondsNow(lot.id, recipe.id)}s)
              </Button>
            );
          })}
          {jobs.map(job => {
            const left = Math.ceil((job.finishesAt - now) / 1000);
            return (
              <div key={job.id} className="ws-row">
                <span className="ws-small">{craftName(job.recipeId)}</span>
                {left > 0
                  ? <span style={{ flex: 1, maxWidth: 160 }}><TimerBar startedAt={job.queuedAt} until={job.finishesAt} /></span>
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
  const { lots, chunks } = useHubStore();
  const layout = useMemo(() => HubGenerator.generate({ chunks }), [chunks]);
  const playerId = usePlayerStore(s => s.player.id);
  const [now, setNow] = useState(Date.now());
  // D12: dev mode opens the builder view free, for testing. The real door is the scribe's table.
  const [scribeOpen, setScribeOpen] = useState(false);

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
          {lots.length} lots. Upkeep is charged by the world-day; an unpaid lot reverts to the market with its goods returned.
          {lots.some(l => l.ownerId === playerId) && (
            <span style={{ display: 'block', width: 320, marginTop: 4 }}>
              <TimerBar label="THE DAY TURNS" startedAt={worldDay() * DAY_MS} until={(worldDay() + 1) * DAY_MS} />
            </span>
          )}
        </span>
        {devMode && (
          <span style={{ display: 'flex', gap: 4 }}>
            <Button tone="quiet" onClick={grantTestDeed}>DEV: GRANT DEED</Button>
            <Button tone="quiet" onClick={() => setScribeOpen(true)}>DEV: SCRIBE VIEW</Button>
          </span>
        )}
      </div>
      {scribeOpen && <TemplateStudio onClose={() => setScribeOpen(false)} />}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 10 }}>
        {lots.map(lot => <LotCard key={lot.id} lot={lot} poi={HubGenerator.findPOI(layout, lot.id)} now={now} />)}
      </div>
    </div>
  );
};
