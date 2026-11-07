/**
 * A person's workshop, on the Hall's THE PEOPLE (D91, D119): what they are, what they want,
 * and giving it to them, as one station or as a machine for their whole road. It never names
 * the road: a player learns the next link when a workshop has nothing to work with, and no more.
 */

import React, { useMemo } from 'react';
import { HubGenerator } from '../entities/hub/HubGenerator';
import { IResident } from '../entities/hub/guild';
import { IWorkshop, IWorkshopOffer, WorkshopMode, billFor, roomAreaOf } from '../entities/hub/hubTech';
import { answersTag, materialLabel } from '../../shared/entities/hub/room';
import { lotConstruction } from '../../shared/entities/hub/template';
import { useHubStore } from '../entities/hub/store';
import { usePlayerStore } from '../entities/player/store';
import { STRUCTURE_COSTS } from '../../shared/entities/economy/data/recipeDefinitions';
import { ArmedButton, Chip } from './ui/kit';
import { useFeed } from './ui/stores';

const billLine = (bill: { tag: string; count: number }[]) => bill.map(l => `${l.count} ${l.tag}`).join(', ');

/** Ground you hold with nothing on it: where a workshop can go. */
const useOwnGround = () => {
  const { lots, chunks, dismembered, buildJobs } = useHubStore();
  const player = usePlayerStore(s => s.player);
  const layout = useMemo(() => HubGenerator.generate({ chunks, dismembered }), [chunks, dismembered]);
  return lots
    .filter(l => l.ownerId === player.id && l.structureType === 'EMPTY' && !buildJobs.some(j => j.lotId === l.id && !j.applied))
    .map(lot => ({ lot, poi: HubGenerator.findPOI(layout, lot.id)! }))
    .filter(o => o.poi);
};

const GiveRow: React.FC<{ resident: IResident; offer: IWorkshopOffer; mode: WorkshopMode; stationId?: string; title: string; note: string; bill: { tag: string; count: number }[]; area: number; permits: number }> = ({ resident, offer, mode, stationId, title, note, bill, area, permits }) => {
  const { provideWorkshop } = useHubStore();
  const pushFeed = useFeed(s => s.push);
  const ground = useOwnGround();
  const permit = STRUCTURE_COSTS.WORKSHOP.build * permits;
  return (
    <div style={{ borderTop: '1px solid var(--ws-line, #444)', paddingTop: 4, marginTop: 4 }}>
      <div className="ws-small"><b>{title}</b></div>
      <div className="ws-dim ws-small">{note}</div>
      <div className="ws-dim ws-small">Asks {billLine(bill)}. A {permit.toLocaleString()} G permit. {area} tiles of floor.</div>
      {ground.length === 0 && <div className="ws-dim ws-small">You hold no empty ground. The Land Office sells it, and it has to be yours to give.</div>}
      {ground.map(({ lot, poi }) => {
        const holds = roomAreaOf({ width: poi.size.width, height: poi.size.height });
        const fits = holds >= area;
        return (
          <div key={lot.id} className="ws-row">
            <span className="ws-small" style={{ minWidth: 0 }}>{poi.name}, {poi.size.width}×{poi.size.height}: holds {holds}{fits ? '' : `, too small by ${area - holds}`}</span>
            <ArmedButton
              tone="quiet"
              disabled={!fits}
              title={fits ? undefined : `It needs ${area} tiles of floor.`}
              confirmLabel="GIVE THE GROUND: SURE?"
              onConfirm={async () => {
                const res = await provideWorkshop(resident.id, lot.id, mode, stationId ?? offer.stationId);
                if (!res.ok) pushFeed(res.reason ?? 'It would not go.', 'loss');
              }}
            >
              BUILD HERE
            </ArmedButton>
          </div>
        );
      })}
    </div>
  );
};

/** D8's pooled bill again: anything that answers the tag pays. */
const ShopBill: React.FC<{ shop: IWorkshop }> = ({ shop }) => {
  const { poolToWorkshop } = useHubStore();
  const stash = usePlayerStore(s => s.player).bank.stashTabs[0]?.items ?? [];
  const pushFeed = useFeed(s => s.push);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span className="ws-dim ws-small">What it asks, from anyone. A deposit does not come back.</span>
      {shop.bill.map(line => {
        const held = shop.pool[line.tag]?.count ?? 0;
        const short = Math.max(0, line.count - held);
        const answers = [...new Set(stash.filter(i => answersTag(i, line.tag)).map(i => i.universalDefinitionId))];
        return (
          <div key={line.tag} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <div className="ws-row"><span className="ws-small">{line.tag}</span><span className="ws-small">{held} of {line.count}</span></div>
            {short > 0 && answers.length === 0 && <span className="ws-dim ws-small">Nothing in the stash answers this.</span>}
            {short > 0 && answers.map(defId => {
              const count = stash.filter(i => i.universalDefinitionId === defId && answersTag(i, line.tag)).length;
              const giving = Math.min(count, short);
              return (
                <div key={defId} className="ws-row">
                  <span className="ws-small" style={{ minWidth: 0 }}>{materialLabel(defId)}, {count} held</span>
                  <ArmedButton tone="quiet" confirmLabel={`GIVE ${giving}: SURE?`} onConfirm={async () => {
                    const ids = stash.filter(i => i.universalDefinitionId === defId && answersTag(i, line.tag)).slice(0, giving).map(i => i.id);
                    const res = await poolToWorkshop(shop.id, line.tag, ids);
                    if (!res.ok) pushFeed(res.reason ?? 'It would not take it.', 'loss');
                  }}>DEPOSIT {giving}</ArmedButton>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
};

/** What someone with no workshop of their own could run for someone else: the wide road. */
const LinksTheyCouldRun: React.FC<{ resident: IResident; offer: IWorkshopOffer }> = ({ resident, offer }) => {
  const { guild, tech, workshopOffer, chunks } = useHubStore();
  void chunks;
  const links = new Map<string, NonNullable<IWorkshopOffer['next']>>();
  for (const other of guild.residents) {
    if (other.id === resident.id) continue;
    const next = tech.workshops.some(w => w.residentId === other.id) ? workshopOffer(other.id)?.next : null;
    if (next && next.id !== offer.stationId) links.set(next.id, next);
  }
  return (
    <>
      {[...links.values()].map(next => (
        <GiveRow key={next.id} resident={resident} offer={offer} mode="WORKSTATION" stationId={next.id}
          title={`RUN THE ${next.name.toUpperCase()}`} note="Someone else's workshop stands idle for want of it. They would run it instead of their own."
          bill={billFor([next.id], tech)} area={next.minArea} permits={1} />
      ))}
    </>
  );
};

export const WorkshopBlock: React.FC<{ resident: IResident }> = ({ resident }) => {
  const { tech, buildJobs, workshopOffer } = useHubStore();
  const offer = workshopOffer(resident.id);
  const shop = tech.workshops.find(w => w.residentId === resident.id);
  if (!offer && !shop) return <div className="ws-dim ws-small" style={{ marginTop: 4 }}>They have not said what they would need.</div>;
  const rising = shop ? lotConstruction(buildJobs, shop.lotId) : null;
  const ask = tech.asks[resident.id];

  return (
    <div style={{ marginTop: 6 }}>
      {offer && (
        <>
          <div className="ws-small"><b>{offer.profession.name}.</b> {offer.profession.blurb}</div>
          <div className="ws-small">{ask ? `"${ask.words}"` : `Says they need ${offer.profession.workshop}.`}</div>
        </>
      )}
      {shop && !shop.raised && <><div className="ws-small"><b>{shop.name}</b> <Chip>{shop.mode === 'MACHINE' ? 'ONE MACHINE' : 'WORKSTATION'}</Chip></div><ShopBill shop={shop} /></>}
      {shop?.raised && !shop.standsAt && rising && <div className="ws-small"><b>{shop.name}</b> is rising: {rising.applied} of {rising.total} steps stand.</div>}
      {shop?.standsAt && <div className="ws-small"><b>{shop.name}</b> <Chip tone="proof">STANDS</Chip></div>}
      {shop?.standsAt && offer?.next && <div className="ws-small">They have nothing to work with. Nobody here runs the {offer.next.name}.</div>}

      {!shop && offer?.coming && <div className="ws-dim ws-small">One is already being raised here for someone else.</div>}
      {!shop && offer && !offer.stands && !offer.coming && (
        <>
          <GiveRow resident={resident} offer={offer} mode="WORKSTATION" title="THEIR WORKSHOP" note={`Just what they asked for: ${offer.station.name}. It works when what it needs stands in the city.`}
            bill={offer.stationBill} area={offer.stationArea} permits={1} />
          {offer.route.length > 1 && (
            <GiveRow resident={resident} offer={offer} mode="MACHINE" title="ONE MACHINE" note="One person, one big lot, and every step still missing done under one roof. What already stands is not billed."
              bill={offer.machineBill} area={offer.machineArea} permits={offer.route.length} />
          )}
        </>
      )}
      {!shop && offer && <LinksTheyCouldRun resident={resident} offer={offer} />}
      {!shop && offer?.stands && <div className="ws-dim ws-small">What they asked for already stands here. It asks nothing more of anyone.</div>}
    </div>
  );
};

/** "it's pop count". Read, and nothing computed from it. */
export const PopulationLine: React.FC = () => {
  const { population } = useHubStore();
  const p = population();
  return (
    <div className="ws-dim ws-small">
      {p.people} {p.people === 1 ? 'person' : 'people'} in this city: {p.home} home, {p.lodging} lodging, {p.onTheRoad} at a bench. {p.working} working a workshop of their own, {p.machines} on {p.machines === 1 ? 'a machine' : 'machines'}.
    </div>
  );
};
