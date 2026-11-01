/**
 * THE HALL OF BANNERS (D73, D75, D83, D93, D95): Vex's board. What the city's people want,
 * the ground the guild buys them and the house their bill raises, the trial a rank comes
 * through, and the maps handed in. Development of the city stays with the Land Office.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { IItem, ItemType } from '../../types';
import {
  IResident, chainFromMap, guildHouseCost, houseBill, houseTemplateFor, houseTemplateNamed, questPay, residentStage,
  residentUpkeepPerDay, trialFor, trialTakes, wantMayTake
} from '../entities/hub/guild';
import { Farm } from '../entities/hub/farm';
import { HubGenerator } from '../entities/hub/HubGenerator';
import { answersTag, materialLabel } from '../entities/hub/room';
import { lotConstruction } from '../entities/hub/template';
import { useHubStore, worldDay } from '../entities/hub/store';
import { usePlayerStore } from '../entities/player/store';
import { LoadoutSystem } from '../entities/player/systems/LoadoutSystem';
import { ProgressionSystem } from '../entities/player/systems/ProgressionSystem';
import { StatSystem } from '../logic/systems/StatSystem';
import { ArmedButton, Button, Chip, Modal, Panel, Tabs } from './ui/kit';
import { hoverProps, useFeed } from './ui/stores';
import { ResidentFace, ResidentLines } from './TavernRoom';

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
  const { guild, fulfilQuest } = useHubStore();
  const stash = useStash();
  const pushFeed = useFeed(s => s.push);
  const open = guild.quests.filter(q => q.state === 'OPEN');
  const done = guild.quests.filter(q => q.state === 'DONE').length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {open.length === 0 && (
        <span className="ws-dim ws-small">
          Nothing on the board{guild.residents.length === 0 ? '. Nobody in this city wants anything from you yet: a person has to come through the gate, and have a door of their own, first.' : ' today. People with a door of their own post what they want, a day apart.'}
        </span>
      )}
      {open.map(quest => {
        const resident = guild.residents.find(r => r.id === quest.residentId)!;
        // The cheapest that answer go first, and the window names them, so nothing dear goes by accident.
        const answers = stash.filter(i => i.isIdentified !== false && answersTag(i, quest.tag) && wantMayTake(i)).sort((a, b) => (a.value || 0) - (b.value || 0));
        const given = answers.slice(0, quest.count);
        const ready = given.length >= quest.count;
        return (
          <Panel key={quest.id} title={resident.name.toUpperCase()} right={<Chip tone={ready ? 'proof' : 'none'}>{Math.min(answers.length, quest.count)} of {quest.count}</Chip>}>
            <div className="ws-small" style={{ marginBottom: 4 }}>{quest.text}</div>
            {ready && <div className="ws-dim ws-small" style={{ marginBottom: 4 }}>Goes: {given.map(i => LoadoutSystem.shownName(i)).join(', ')}.</div>}
            <div className="ws-row">
              <span className="ws-dim ws-small">{ready ? `The hub pays ${questPay(given, quest.payShare).toLocaleString()} G for these.` : `Bring things that are ${quest.tag.replace(/_/g, ' ')}.`}</span>
              <ArmedButton
                tone="quiet"
                disabled={!ready}
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
const GroundFor: React.FC<{ resident: IResident; cover: number; onBought: () => void }> = ({ resident, cover, onBought }) => {
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
              disabled={cost > cover}
              title={cost > cover ? 'The treasury cannot cover it for the Hall.' : undefined}
              confirmLabel="ON THE TREASURY: SURE?"
              onConfirm={async () => {
                const res = await guildBuyLot(resident.id, lot.id);
                pushFeed(res.ok ? `The Hall bought ${poi.name} for ${resident.name}.` : res.reason ?? 'The Hall would not buy it.', res.ok ? 'proof' : 'loss');
                onBought();
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
          const price = Math.ceil(StatSystem.shopPrice(row.price, player.attributes));
          return (
            <div key={row.id} className="ws-row ws-small" {...hoverProps(row.item)}>
              <span>{row.item.name} · stock {row.stock}</span>
              <Button tone="proof" disabled={player.bank.gold < price} onClick={() => { void buyFromTrader(craftsmanId, row.id).then(item => { if (item) pushFeed(`Bought ${item.name} for ${price} G. It is in your stash.`, 'proof'); }); }}>BUY {price}G</Button>
            </div>
          );
        })}
      </div>
    </div>
  );
};

const People: React.FC = () => {
  const { guild, buildJobs, lots, guildCoverNow } = useHubStore();
  const [cover, setCover] = useState(0);
  const refresh = () => { void guildCoverNow().then(setCover); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(refresh, [guild.spent]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div className="ws-dim ws-small">The Hall spends the hub's treasury. It can cover {Math.max(0, cover).toLocaleString()} G more of ground.</div>
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
                {stage === 'HOME' && lot && (lot.upkeepPaidThroughDay ?? 0) < worldDay() && (
                  <div className="ws-loss ws-small">Upkeep is behind. They post nothing until it is paid.</div>
                )}
              </div>
            </div>
            {r.craftsmanId && stage !== 'HOME' && <div className="ws-small" style={{ marginBottom: 4 }}>A master now, and in need of a shop of their own. Whoever sees it raised will pay less in it.</div>}
            {r.craftsmanId && stage === 'HOME' && <MasterShop craftsmanId={r.craftsmanId} />}
            {stage === 'TAVERN' && <GroundFor resident={r} cover={cover} onBought={refresh} />}
            {stage === 'POOLING' && <HouseBill resident={r} />}
            {stage === 'RISING' && rising && <div className="ws-small">{rising.applied} of {rising.total} steps stand.</div>}
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

/** D93: a map handed in. The chain it would post waits for a seat a map can show. */
const Maps: React.FC = () => {
  const { guild, handMapToGuild } = useHubStore();
  const stash = useStash();
  const pushFeed = useFeed(s => s.push);
  const held = stash.filter(i => i.type === ItemType.MAP && i.mapData);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div className="ws-dim ws-small">A map shared with the Hall stays with the Hall. When one shows who holds a territory, a quest chain posts from it. Nothing on the land can show that yet, so the Hall records it and says what it would ask.</div>
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
      {guild.maps.map(handed => {
        const chain = chainFromMap(handed.item.mapData!);
        return (
          <Panel key={handed.item.id} title={handed.item.name} right={<Chip>NOT POSTED</Chip>}>
            <div className="ws-dim ws-small">
              From {handed.handedByName}: {chain.sectors} sector{chain.sectors === 1 ? '' : 's'}, {chain.mobs} bodies counted, {chain.changed} changed.
            </div>
            <div className="ws-small" style={{ marginTop: 4 }}>What it would post, once a seat stands on it:</div>
            {chain.steps.map((step, i) => <div key={i} className="ws-small">{i + 1}. {step}</div>)}
            {chain.steps.length === 0 && <div className="ws-dim ws-small">The map holds nothing to chain to.</div>}
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
