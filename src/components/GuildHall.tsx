/**
 * THE HALL OF BANNERS (D73, D75, D83, D93, D95): Vex's board. What the city's people want,
 * the ground the guild buys them and the house their bill raises, the trial a rank comes
 * through, and the maps handed in. Development of the city stays with the Land Office.
 */

import { useWorldStore } from '../entities/world/store';
import { WorldClock } from '../entities/world/WorldClock';
import React, { useEffect, useMemo, useState } from 'react';
import { IItem, ItemType } from '../../shared/types';
import {
  IResident, chainFromMap, chainFromMaps, guildHouseCost, houseBill, houseTemplateFor, houseTemplateNamed, mayHaveGround, questPay, residentStage,
  residentUpkeepPerDay, trialFor, trialTakes, wantMayTake
} from '../entities/hub/guild';
import { Farm } from '../entities/hub/farm';
import { HUB_NPCS, HubGenerator } from '../entities/hub/HubGenerator';
import { answersTag, materialLabel } from '../../shared/entities/hub/room';
import { lotConstruction } from '../../shared/entities/hub/template';
import { dayLines } from '../entities/hub/money';
import { buildingLabel, priceOfListing, useHubStore, worldDay } from '../entities/hub/store';
import { usePlayerStore } from '../entities/player/store';
import { LoadoutSystem } from '../../shared/entities/player/systems/LoadoutSystem';
import { ProgressionSystem } from '../../shared/entities/player/systems/ProgressionSystem';
import { StatSystem } from '../../shared/logic/systems/StatSystem';
import { Treasury } from '../logic/economy/Treasury';
import { ArmedButton, Button, Chip, Modal, Panel, Tabs } from './ui/kit';
import { hoverProps, useFeed } from './ui/stores';
import { Tutorial } from '../logic/systems/Tutorial';
import { ResidentFace, ResidentLines } from './TavernRoom';
import { PopulationLine, WorkshopBlock } from './WorkshopPanel';

type Tab = 'BOARD' | 'PEOPLE' | 'TRIAL' | 'MAPS';
const TABS: { id: Tab; label: string }[] = [
  { id: 'BOARD', label: 'THE BOARD' },
  { id: 'PEOPLE', label: 'THE PEOPLE' },
  { id: 'TRIAL', label: 'THE TRIAL' },
  { id: 'MAPS', label: 'MAPS' }
];

const useStash = () => usePlayerStore(s => s.player).bank.stashTabs[0]?.items ?? [];

/** Wants on the board, each with what in your stash answers it. */
const Board: React.FC = () => {
  const { guild, fulfilQuest, wallets } = useHubStore();
  const stash = useStash();
  const pushFeed = useFeed(s => s.push);
  const open = guild.quests.filter(q => q.state === 'OPEN');
  // D116: what people have asked to have built. C5's buildings are what answers these.
  const asks = (guild.asks ?? []).filter(a => a.state === 'OPEN');
  const done = guild.quests.filter(q => q.state === 'DONE').length;
  // Q2: a newcomer's first order is the tutorial, and the board says where it stands
  const firstOrder = usePlayerStore(s => Tutorial.firstOrderOpen(s.player));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {firstOrder && (
        <Panel title="YOUR FIRST ORDER" tone="signal">
          <span className="ws-small">Before anyone here can use you, go through THE TUTORIAL at the Nexus: scan the block it marks, drop on it, meet what lives there, and walk out by the beacon. Nothing you bring is lost there. Everywhere else, what you carry falls with you.</span>
        </Panel>
      )}
      {open.length === 0 && (
        <span className="ws-dim ws-small">
          Nothing on the board{guild.residents.length === 0 ? '. Nobody in this city wants anything from you yet: a person has to come through the gate first.' : ' today. People post what they want, a day apart, and they pay for it themselves.'}
        </span>
      )}
      {asks.length > 0 && (
        <Panel title="WHAT PEOPLE ARE ASKING FOR">
          {asks.map(ask => (
            <div key={ask.id} className="ws-small"><b>{ask.askerName}</b> is asking for a {buildingLabel(ask.building)}. {ask.goal}</div>
          ))}
        </Panel>
      )}
      {open.map(quest => {
        const askerName = guild.residents.find(r => r.id === quest.residentId)?.name ?? quest.askerName ?? 'Someone';
        // The cheapest that answer go first, and the window names them, so nothing dear goes by accident.
        const answers = stash.filter(i => i.isIdentified !== false && answersTag(i, quest.tag) && wantMayTake(i)).sort((a, b) => (a.value || 0) - (b.value || 0));
        const given = answers.slice(0, quest.count);
        const ready = given.length >= quest.count;
        const pay = questPay(given, quest.payShare);
        const holds = wallets[quest.residentId] ?? 0;
        const affordable = pay <= holds;
        return (
          <Panel key={quest.id} title={askerName.toUpperCase()} right={<Chip tone={ready ? 'proof' : 'none'}>{Math.min(answers.length, quest.count)} of {quest.count}</Chip>}>
            <div className="ws-small" style={{ marginBottom: 4 }}>{quest.text}</div>
            {ready && <div className="ws-dim ws-small" style={{ marginBottom: 4 }}>Goes: {given.map(i => LoadoutSystem.shownName(i)).join(', ')}.</div>}
            <div className="ws-row">
              <span className="ws-dim ws-small">
                {!ready
                  ? `Bring things that are ${quest.tag.replace(/_/g, ' ')}.`
                  : affordable
                    ? `${askerName} pays ${pay.toLocaleString()} G for these.`
                    : `These come to ${pay.toLocaleString()} G, and ${askerName} holds ${holds.toLocaleString()} G. It waits.`}
              </span>
              <ArmedButton
                tone="quiet"
                disabled={!ready || !affordable}
                confirmLabel={`GIVE ${quest.count}: SURE?`}
                onConfirm={async () => {
                  const res = await fulfilQuest(quest.id, given.map(i => i.id));
                  if (!res.ok) pushFeed(res.reason ?? 'It would not go.', 'loss');
                }}
              >
                HAND OVER
              </ArmedButton>
            </div>
          </Panel>
        );
      })}
      {done > 0 && <span className="ws-dim ws-small">{done} met, on record.</span>}
    </div>
  );
};

/** Someone at the tavern: the ground the Hall could buy them, cheapest first. */
const GroundFor: React.FC<{ resident: IResident }> = ({ resident }) => {
  const { lots, chunks, dismembered, guildBuyLot } = useHubStore();
  const pushFeed = useFeed(s => s.push);
  const layout = useMemo(() => HubGenerator.generate({ chunks, dismembered }), [chunks, dismembered]);
  const offers = Farm.groundForHouses(lots)
    .map(lot => ({ lot, poi: HubGenerator.findPOI(layout, lot.id)! }))
    .filter(o => o.poi && houseTemplateFor({ width: o.poi.size.width, height: o.poi.size.height }))
    .sort((a, b) => a.lot.price - b.lot.price);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 180, overflowY: 'auto' }}>
      {offers.length === 0 && <span className="ws-dim ws-small">No free ground in the city. The Land Office raises more.</span>}
      {offers.map(({ lot, poi }) => {
        const cost = guildHouseCost(lot.price);
        const tpl = houseTemplateFor({ width: poi.size.width, height: poi.size.height })!;
        return (
          <div key={lot.id} className="ws-row">
            <span className="ws-small" style={{ minWidth: 0 }}>
              {poi.name}, {poi.size.width}×{poi.size.height}{poi.metadata.dismemberedFrom ? ', a piece' : ''}: {tpl.name}, {cost.toLocaleString()} G
            </span>
            <ArmedButton
              tone="quiet"
              confirmLabel="ON THE TREASURY: SURE?"
              onConfirm={async () => {
                const res = await guildBuyLot(resident.id, lot.id);
                pushFeed(res.ok ? `The Hall bought ${poi.name} for ${resident.name}.` : res.reason ?? 'The Hall would not buy it.', res.ok ? 'proof' : 'loss');
              }}
            >
              BUY
            </ArmedButton>
          </div>
        );
      })}
    </div>
  );
};

/** D8: the pooled bill. Anything that answers the tag pays, from anyone. */
const HouseBill: React.FC<{ resident: IResident }> = ({ resident }) => {
  const { poolToHouse } = useHubStore();
  const stash = useStash();
  const pushFeed = useFeed(s => s.push);
  const tpl = houseTemplateNamed(resident.house!.templateName)!;
  const bill = houseBill(tpl);
  const give = async (tag: string, defId: string, count: number) => {
    const ids = stash.filter(i => i.universalDefinitionId === defId && answersTag(i, tag)).slice(0, count).map(i => i.id);
    const res = await poolToHouse(resident.id, tag, ids);
    if (!res.ok) pushFeed(res.reason ?? 'The house would not take it.', 'loss');
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span className="ws-dim ws-small">{tpl.name}. What it asks, from anyone. A deposit does not come back.</span>
      {bill.map(line => {
        const held = resident.house!.pool[line.tag]?.count ?? 0;
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
                  <ArmedButton tone="quiet" confirmLabel={`GIVE ${giving}: SURE?`} onConfirm={() => void give(line.tag, defId, giving)}>
                    DEPOSIT {giving}
                  </ArmedButton>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
};

/** A master's own shop (their house, once it stands). Whoever saw it through pays less. */
const MasterShop: React.FC<{ craftsmanId: string }> = ({ craftsmanId }) => {
  const { traderShelf, buyFromTrader, vendors } = useHubStore();
  const { player } = usePlayerStore();
  const pushFeed = useFeed(s => s.push);
  const record = vendors[craftsmanId];
  if (!record) return null;
  const shelf = traderShelf(craftsmanId);
  return (
    <div style={{ marginTop: 6 }}>
      <div className="ws-dim ws-small">THEIR SHOP{record.patrons.includes(player.id) ? ' · YOU SAW IT OPENED, AND YOU PAY LESS HERE' : ''}</div>
      {shelf.length === 0 && <div className="ws-dim ws-small">The shelf is bare. They work from what the keepers take apart.</div>}
      <div className="ws-list">
        {shelf.map(row => {
          const price = priceOfListing(row, player.attributes);
          return (
            <div key={row.id} className="ws-row ws-small" {...hoverProps(row.item)}>
              <span>{row.item.name} · {row.deal ? `BARGAIN BIN: ${Math.max(0, row.deal.until - worldDay())} days left` : `stock ${row.stock}`}</span>
              <Button tone="proof" disabled={player.bank.gold < price} onClick={() => { void buyFromTrader(craftsmanId, row.id).then(item => { if (item) pushFeed(`Bought ${item.name} for ${price} G. It is in your stash.`, 'proof'); }); }}>BUY {price}G</Button>
            </div>
          );
        })}
      </div>
    </div>
  );
};

/** D115: the books as they stand. Figures only: what they mean is for whoever reads them. */
const TheBooks: React.FC = () => {
  const { activeHubId, guild, wallets, runningBook } = useHubStore();
  const [held, setHeld] = useState(0);
  useEffect(() => { if (activeHubId) void Treasury.balance(activeHubId).then(setHeld); }, [activeHubId, guild.printed.total, guild.runningDay]);
  const book = runningBook();
  const { perDay, marketCap, tiles, techPerTile } = book;
  const among = Object.values(wallets).reduce((sum, n) => sum + n, 0);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div className="ws-dim ws-small">
        The treasury holds {held.toLocaleString()} G. The city runs on {perDay.toLocaleString()} G a day, so that is {perDay > 0 ? Math.floor(held / perDay) : 0} days. Printed {guild.printed.count === 1 ? 'once' : `${guild.printed.count} times`}, {guild.printed.total.toLocaleString()} G in all. People here hold {among.toLocaleString()} G of their own.
      </div>
      <div className="ws-dim ws-small">What the tech web produces is worth {marketCap.toLocaleString()} G, over the centre's {tiles.toLocaleString()} tiles: {techPerTile.toFixed(2)} a tile.</div>
      <div style={{ display: 'flex', flexDirection: 'column', maxHeight: 130, overflowY: 'auto' }}>
        {dayLines(book).map(line => (
          <div key={line.key} className="ws-row">
            <span className="ws-small" style={{ minWidth: 0 }}>{line.name}{line.tiles ? `, ${line.tiles} tiles` : ''}</span>
            <span className="ws-small">{line.amount.toLocaleString()} G a day</span>
          </div>
        ))}
      </div>
      {guild.lastWeek && (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div className="ws-dim ws-small">Last week, with {guild.lastWeek.tax.toLocaleString()} G of the general tax in:</div>
          {guild.lastWeek.shops.map(shop => (
            <div key={shop.npcId} className="ws-row">
              <span className="ws-small" style={{ minWidth: 0 }}>{HUB_NPCS[shop.npcId]?.name ?? shop.npcId}: took {shop.earned.toLocaleString()} G, paid out {shop.counter.toLocaleString()} G, wages {shop.pay.toLocaleString()} G, lost {shop.loss.toLocaleString()} G coming apart</span>
              <span className="ws-small">{shop.toKeeper > 0 ? `the Hall covered ${shop.toKeeper.toLocaleString()} G` : `${shop.toGuild.toLocaleString()} G over`}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const People: React.FC = () => {
  const { guild, buildJobs, lots, wallets } = useHubStore();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <TheBooks />
      <PopulationLine />
      {guild.residents.length === 0 && <span className="ws-dim ws-small">Nobody yet. An Escort Bond taken to Mags at the Rusty Anchor brings someone in.</span>}
      {guild.residents.map(r => {
        const stage = residentStage(r, { buildJobs });
        const lot = lots.find(l => l.id === r.lotId);
        const rising = r.lotId ? lotConstruction(buildJobs, r.lotId) : null;
        return (
          // Stage by position and words: the panel's right side always names where they are.
          <Panel key={r.id} title={r.name.toUpperCase()} right={<Chip tone={stage === 'HOME' ? 'proof' : 'none'}>{stage === 'TAVERN' ? 'AT THE TAVERN' : stage === 'POOLING' ? 'GROUND, NO HOUSE' : stage === 'RISING' ? 'RISING' : 'HOME'}</Chip>}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 6 }}>
              <ResidentFace entityId={r.entityId} />
              <div style={{ minWidth: 0 }}>
                <ResidentLines resident={r} />
                <div className="ws-dim ws-small">Brought out by {r.sponsorName}, who answers for their upkeep: {residentUpkeepPerDay(r.bond.rank)} G a day{stage === 'HOME' ? '' : ' once they are in'}.</div>
                <div className="ws-dim ws-small">Holds {(wallets[r.id] ?? 0).toLocaleString()} G of their own.</div>
                {stage === 'HOME' && lot && (lot.upkeepPaidThroughDay ?? 0) < worldDay() && (
                  <div className="ws-loss ws-small">Upkeep is behind. They post nothing until it is paid.</div>
                )}
              </div>
            </div>
            {r.craftsmanId && stage !== 'HOME' && <div className="ws-small" style={{ marginBottom: 4 }}>A master now, and in need of a shop of their own. Whoever sees it raised will pay less in it.</div>}
            {r.craftsmanId && stage === 'HOME' && <MasterShop craftsmanId={r.craftsmanId} />}
            {stage === 'TAVERN' && (mayHaveGround(r)
              ? <GroundFor resident={r} />
              : <div className="ws-small">No ground until someone has seen to them. What they want is on the board.</div>)}
            {stage === 'POOLING' && <HouseBill resident={r} />}
            {stage === 'RISING' && rising && <div className="ws-small">{rising.applied} of {rising.total} steps stand.</div>}
            {stage === 'HOME' && <WorkshopBlock resident={r} />}
          </Panel>
        );
      })}
    </div>
  );
};

/** D83: the one door a rank comes through. */
const Trial: React.FC<{ onPassed: () => void }> = ({ onPassed }) => {
  const { passTrial } = useHubStore();
  const stash = useStash();
  const player = usePlayerStore(s => s.player);
  const pushFeed = useFeed(s => s.push);
  const rank = ProgressionSystem.rankOf(player);
  const trial = trialFor(rank);
  const answers = trial ? stash.filter(i => trialTakes(i, rank)) : [];
  const [picked, setPicked] = useState<string[]>([]);
  const chosen = picked.filter(id => answers.some(i => i.id === id));

  if (!trial) return <span className="ws-dim ws-small">There is no rank above yours for the Hall to give.</span>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <Panel title={`RANK ${rank} TO RANK ${trial.to}`}>
        <div className="ws-small">
          Bring {trial.count} things out of a gate yourself, each from above where you stand, and hand them to the Hall. What you buy does not count, and neither does what someone else carried. The Hall keeps them. Your levels start again; what you built stays.
        </div>
      </Panel>
      {answers.length === 0 && <span className="ws-dim ws-small">Nothing in your stash stands above your rank. Anything still unread has to be read first.</span>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 200, overflowY: 'auto' }}>
        {answers.map((item: IItem) => {
          const on = chosen.includes(item.id);
          return (
            <div key={item.id} className="ws-row" {...hoverProps(item)}>
              <span className="ws-small" style={{ minWidth: 0 }}>{LoadoutSystem.shownName(item)} · {item.rank}</span>
              <Button tone="quiet" aria-pressed={on} onClick={() => setPicked(on ? chosen.filter(id => id !== item.id) : [...chosen, item.id])}>
                {on ? '[X] CHOSEN' : '[ ] CHOOSE'}
              </Button>
            </div>
          );
        })}
      </div>
      <ArmedButton
        disabled={chosen.length < trial.count}
        confirmLabel={`THE HALL KEEPS THEM: SURE?`}
        onConfirm={async () => {
          const res = await passTrial(chosen);
          // The moment is seen on the street: this window would stand in front of it.
          if (res.ok) { setPicked([]); onPassed(); }
          else pushFeed(res.reason ?? 'The Hall refuses.', 'loss');
        }}
      >
        HAND OVER {chosen.length} OF {trial.count}
      </ArmedButton>
    </div>
  );
};

/** D93: a map handed in. What it shows of held ground posts a chain, and anything less stays on record. */
const Maps: React.FC = () => {
  const { guild, handMapToGuild } = useHubStore();
  const stash = useStash();
  const pushFeed = useFeed(s => s.push);
  const held = stash.filter(i => i.type === ItemType.MAP && i.mapData);
  const worlds = useWorldStore(s => s.availableWorlds);
  const now = Date.now();
  // Each world's own clock says how old a reading is, so a chain is grouped by the world it is on
  const posted = [...new Set(guild.maps.map(m => m.item.mapData!.worldId))].flatMap(worldId => {
    const card = worlds.find(w => w.id === worldId);
    const generationNow = card ? WorldClock.momentAt(card, now).generation : 0;
    return chainFromMaps(guild.maps.filter(m => m.item.mapData!.worldId === worldId).map(m => m.item.mapData!), generationNow);
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div className="ws-dim ws-small">A map shared with the Hall stays with the Hall. When one shows ground someone holds, a quest chain posts from it. The Hall knows what its maps know, as old as they are.</div>
      {held.map(map => (
        <div key={map.id} className="ws-row" {...hoverProps(map)}>
          <span className="ws-small" style={{ minWidth: 0 }}>{map.name}, in {map.mapData!.scribeName}'s hand</span>
          <ArmedButton
            tone="quiet"
            confirmLabel="THE HALL KEEPS IT: SURE?"
            onConfirm={async () => {
              const res = await handMapToGuild(map.id);
              pushFeed(res.ok ? `The Hall has ${map.name}, on record.` : res.reason ?? 'The Hall would not take it.', res.ok ? 'proof' : 'loss');
            }}
          >
            HAND IT IN
          </ArmedButton>
        </div>
      ))}
      {guild.maps.length === 0 && held.length === 0 && <span className="ws-dim ws-small">No maps in your stash, and none in the Hall. A scribe's table writes one from what you have scanned.</span>}
      {posted.map(chain => (
        <Panel key={`${chain.worldId}:${chain.seat!.sector}`} title={`${chain.worldName}: ${chain.seat!.named ?? 'an unknown holding'}`} right={<Chip>POSTED</Chip>}>
          <div className="ws-dim ws-small">
            Sector {chain.seat!.sector}: {chain.seat!.chunks} chunks held, {chain.seat!.anchors} anchors. {chain.staleBy ? `Read ${chain.staleBy} regeneration(s) ago, and it will have moved.` : 'Read this regeneration.'}
          </div>
          {chain.steps.map((step, i) => (
            <div key={i} className="ws-row ws-small"><span style={{ minWidth: 0 }}>{i + 1}. {step.text}</span><span className="ws-dim">{step.people === 1 ? '1 person' : `${step.people} people`}</span></div>
          ))}
        </Panel>
      ))}
      {guild.maps.map(handed => {
        const chain = chainFromMap(handed.item.mapData!);
        return (
          <Panel key={handed.item.id} title={handed.item.name} right={<Chip>{chain.posted ? 'ON RECORD' : 'NOT POSTED'}</Chip>}>
            <div className="ws-dim ws-small">
              From {handed.handedByName}: {chain.sectors} sector{chain.sectors === 1 ? '' : 's'}, {chain.mobs} bodies counted, {chain.changed} changed.
            </div>
            {!chain.posted && <div className="ws-dim ws-small">It shows nobody holding ground, so it posts nothing.</div>}
          </Panel>
        );
      })}
    </div>
  );
};

export const GuildHall: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [tab, setTab] = useState<Tab>('BOARD');
  return (
    <Modal title="THE HALL OF BANNERS" onClose={onClose} width={640}>
      <Tabs<Tab> tabs={TABS} active={tab} onChange={setTab} />
      <div style={{ maxHeight: '60vh', overflowY: 'auto' }}>
        {tab === 'BOARD' && <Board />}
        {tab === 'PEOPLE' && <People />}
        {tab === 'TRIAL' && <Trial onPassed={onClose} />}
        {tab === 'MAPS' && <Maps />}
      </div>
    </Modal>
  );
};
