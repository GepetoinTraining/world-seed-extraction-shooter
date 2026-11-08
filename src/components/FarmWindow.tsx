/**
 * A PLOT'S WINDOW (D11, D65): at the plot's own door. The beds, what the plot holds, its stand,
 * its pen and its hearth. Whoever holds it works it; anyone who walks up can buy from its stand.
 * Every press goes through `FarmDoors`.
 *
 * Meaning goes by shape and seam: an empty bed is a broken outline, a growing one fills from the
 * bottom, and a ripe one is solid with a heavy edge.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { IItem } from '../../shared/types';
import { Farm } from '../entities/hub/farm';
import { FarmDoors, IFarmVerdict } from '../entities/hub/farmDoors';
import { Herd } from '../entities/hub/herd';
import { HubGenerator } from '../entities/hub/HubGenerator';
import { answersTag } from '../../shared/entities/hub/room';
import { useHubStore, hubPort } from '../entities/hub/store';
import { usePlayerStore, playerPort } from '../entities/player/store';
import { Cooking } from '../logic/systems/Cooking';
import { FieldCapture } from '../logic/systems/FieldCapture';
import { ArmedButton, Button, Chip, Input, ItemSprite, Modal, Panel, Tabs } from './ui/kit';
import { useFeed } from './ui/stores';

type FarmTab = 'BEDS' | 'STORE' | 'STAND' | 'PEN' | 'HEARTH';

const BED_PX = 42;

const clock = (ms: number) => {
  const left = Math.max(0, ms);
  const h = Math.floor(left / 3_600_000), m = Math.ceil((left % 3_600_000) / 60_000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
};

const Bed: React.FC<{ growth: number; name?: string; span: number; left?: number; onClick: () => void }> = ({ growth, name, span, left, onClick }) => {
  const ripe = name && growth >= 1;
  return (
    <button
      type="button"
      className="ws-ui ws-small"
      onClick={onClick}
      aria-label={!name ? 'Empty bed' : ripe ? `${name}, ripe` : `${name}, growing, ${clock(left ?? 0)} left`}
      title={!name ? 'Empty' : ripe ? `${name}: ripe` : `${name}: ${clock(left ?? 0)} left`}
      style={{
        position: 'relative', gridColumn: `span ${span}`, gridRow: `span ${span}`, padding: 0, cursor: 'pointer', overflow: 'hidden', color: 'inherit',
        minWidth: BED_PX, minHeight: BED_PX, background: 'transparent', fontFamily: 'var(--ws-mono)',
        border: !name ? '1px dashed var(--ws-text-dim)' : ripe ? '3px solid var(--ws-text-body)' : '1px solid var(--ws-text-body)'
      }}
    >
      {name && <span style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: `${Math.round(growth * 100)}%`, background: 'var(--ws-void-3)' }} />}
      <span style={{ position: 'relative' }}>{ripe ? 'RIPE' : name ? `${Math.round(growth * 100)}%` : ''}</span>
    </button>
  );
};

/** Each piece on its own, drawn at its real footprint, its own history under it. */
const Pieces: React.FC<{ items: IItem[]; action?: (item: IItem) => React.ReactNode }> = ({ items, action }) => {
  const [open, setOpen] = useState<string | null>(null);
  const groups = useMemo(() => Farm.byMaterial(items), [items]);
  const chosen = items.find(i => i.id === open);
  if (items.length === 0) return <span className="ws-dim ws-small">Nothing here yet.</span>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {groups.map(group => (
        <div key={group.defId}>
          <div className="ws-small">{group.name}, {group.pieces.length}</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {group.pieces.map(item => (
              <button
                key={item.id}
                type="button"
                aria-pressed={open === item.id}
                aria-label={`${group.name}, one piece`}
                onClick={() => setOpen(open === item.id ? null : item.id)}
                style={{ padding: 2, background: 'transparent', cursor: 'pointer', border: `${open === item.id ? 2 : 1}px ${open === item.id ? 'solid' : 'dashed'} var(--ws-text-body)` }}
              >
                <ItemSprite item={item} cellPx={22} />
              </button>
            ))}
          </div>
        </div>
      ))}
      {chosen && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, borderTop: '1px solid var(--ws-text-dim)', paddingTop: 6 }}>
          {Farm.historyOf(chosen).map(line => <span key={line} className="ws-dim ws-small">{line}</span>)}
          {action?.(chosen)}
        </div>
      )}
    </div>
  );
};

export const FarmWindow: React.FC<{ lotId: string; onClose: () => void }> = ({ lotId, onClose }) => {
  const { lots, farmland, chunks, dismembered, guild, buyFromLot, collectProceeds } = useHubStore();
  const { player } = usePlayerStore();
  const pushFeed = useFeed(s => s.push);
  const lot = lots.find(l => l.id === lotId);
  const poi = useMemo(() => HubGenerator.findPOI(HubGenerator.generate({ chunks, dismembered }), lotId), [chunks, dismembered, lotId]);
  const stash = player.bank.stashTabs[0]?.items ?? [];
  const mine = !!lot && lot.ownerId === player.id;
  const [tab, setTab] = useState<FarmTab>(mine ? 'BEDS' : 'STAND');
  const [seed, setSeed] = useState<string | null>(null);
  const [price, setPrice] = useState('10');
  const [pot, setPot] = useState<string[]>([]);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(timer);
  }, []);

  if (!lot || !poi) return null;
  const farm = farmland.farms[lotId] ?? Farm.empty(lotId);
  const { cols, rows } = Farm.gridOf(poi.size);
  const herds = Herd.heldBy(farmland.herds, { type: 'plot', id: lotId });

  const say = (res: IFarmVerdict, done: string) => pushFeed(res.ok ? done : res.reason ?? 'It would not go.', res.ok ? 'signal' : 'loss');

  const seeds = Farm.byMaterial(stash.filter(i => Farm.plantVerdict(i).ok));
  const food = stash.filter(i => answersTag(i, 'food'));
  const feedable = stash.filter(i => Herd.worthOf(i) > 0);
  const cages = stash.filter(i => i.creatureData);

  // What covers each bed: a planting's own number holds it, and what a tree spreads over takes no button of its own.
  const covered = new Set<number>();
  for (const [key, p] of Object.entries(farm.beds)) {
    const span = Farm.spanOf(p);
    for (let r = 0; r < span; r++) for (let c = 0; c < span; c++) if (r || c) covered.add(Number(key) + r * cols + c);
  }

  const pressBed = async (bed: number) => {
    const here = farm.beds[bed];
    if (here) { say(await FarmDoors.reap(lotId, bed, playerPort, hubPort), `${here.name}: taken into the store.`); return; }
    const pick = seed ? stash.find(i => i.universalDefinitionId === seed) : undefined;
    if (!pick) { pushFeed('Choose what to plant first.', 'plain'); return; }
    say(await FarmDoors.plant(lotId, pick.id, bed, playerPort, hubPort), `${pick.name} goes in the ground.`);
  };

  return (
    <Modal title={`${poi.name.toUpperCase()}${lot.ownerName ? `: ${lot.ownerName.toUpperCase()}` : ''}`} onClose={onClose} width={700}>
      {mine
        ? <Tabs<FarmTab> tabs={(['BEDS', 'STORE', 'STAND', 'PEN', 'HEARTH'] as FarmTab[]).map(id => ({ id, label: id }))} active={tab} onChange={setTab} />
        : <div className="ws-dim ws-small" style={{ marginBottom: 6 }}>{lot.ownerName ?? 'Nobody'} works this plot. What they sell stands here.</div>}

      {tab === 'BEDS' && mine && (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 10, alignItems: 'start' }}>
          <Panel title={`THE BEDS, ${cols * rows}`}>
            <div data-testid="farm-beds" style={{ display: 'grid', gap: 2, gridTemplateColumns: `repeat(${cols}, ${BED_PX}px)`, gridAutoRows: `${BED_PX}px` }}>
              {Array.from({ length: cols * rows }, (_, bed) => {
                if (covered.has(bed)) return null;
                const p = farm.beds[bed];
                return <Bed key={bed} growth={p ? Farm.growth(p, now) : 0} name={p?.name} span={p ? Farm.spanOf(p) : 1} left={p ? Farm.ripeAt(p) - now : 0} onClick={() => void pressBed(bed)} />;
              })}
            </div>
          </Panel>
          <Panel title="WHAT YOU COULD PLANT">
            {seeds.length === 0 && <span className="ws-dim ws-small">Nothing in the stash would grow. What you gather in a world will, as it was gathered.</span>}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {seeds.map(group => (
                <Button key={group.defId} tone={seed === group.defId ? 'signal' : 'quiet'} aria-pressed={seed === group.defId} onClick={() => setSeed(seed === group.defId ? null : group.defId)}>
                  {group.name}, {group.pieces.length}{Farm.spanOf({ defId: group.defId }) > 1 ? ', grove' : ''}
                </Button>
              ))}
            </div>
            <div className="ws-dim ws-small" style={{ marginTop: 8 }}>Choose one, then press an empty bed. A ripe bed comes into the store when you press it.</div>
            <div style={{ marginTop: 10 }}>
              <div className="ws-small">WHO RUNS IT</div>
              {farm.tender && <div className="ws-small">{guild.residents.find(r => r.id === farm.tender)?.name ?? 'Someone'} takes what is ripe, sets one back, and puts the rest on the stand.</div>}
              {farm.tender && <Button tone="quiet" onClick={async () => say(await FarmDoors.setTender(lotId, null, playerPort, hubPort), 'It is yours to work again.')}>TAKE IT BACK</Button>}
              {!farm.tender && guild.residents.length === 0 && <span className="ws-dim ws-small">Nobody in the city to ask yet.</span>}
              {!farm.tender && guild.residents.map(r => (
                <Button key={r.id} tone="quiet" onClick={async () => say(await FarmDoors.setTender(lotId, r.id, playerPort, hubPort), `${r.name} runs this plot from here on.`)}>ASK {r.name.toUpperCase()}</Button>
              ))}
            </div>
          </Panel>
        </div>
      )}

      {tab === 'STORE' && mine && (
        <Panel title="WHAT THE PLOT HOLDS, PIECE BY PIECE">
          <Pieces
            items={lot.inventory}
            action={item => (
              <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
                <Button tone="quiet" onClick={async () => say(await FarmDoors.takeFromStore(lotId, item.id, playerPort, hubPort), `${item.name}: into your stash.`)}>TO THE STASH</Button>
                <Input aria-label="Price" value={price} onChange={e => setPrice(e.target.value)} style={{ width: 70 }} />
                <Button tone="signal" onClick={async () => say(await FarmDoors.list(lotId, item.id, Number(price), playerPort, hubPort), `${item.name}: on the stand for ${price} G.`)}>ON THE STAND</Button>
              </div>
            )}
          />
        </Panel>
      )}

      {tab === 'STAND' && (
        <Panel title="THE STAND">
          {(lot.shopListings ?? []).length === 0 && <span className="ws-dim ws-small">Nothing for sale.</span>}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {(lot.shopListings ?? []).map(li => (
              <div key={li.item.id} className="ws-row">
                <span style={{ display: 'flex', gap: 6, alignItems: 'center', minWidth: 0 }}><ItemSprite item={li.item} cellPx={22} /><span className="ws-small">{li.item.name}</span></span>
                <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <Chip tone="proof">{li.price} G</Chip>
                  {mine
                    ? <Button tone="quiet" onClick={async () => say(await FarmDoors.unlist(lotId, li.item.id, playerPort, hubPort), `${li.item.name}: back in the store.`)}>TAKE DOWN</Button>
                    : <Button tone="signal" disabled={player.bank.gold < li.price} onClick={async () => pushFeed((await buyFromLot(lotId, li.item.id)) ? `${li.item.name}: bought.` : 'You cannot pay for that.', 'signal')}>BUY</Button>}
                </span>
              </div>
            ))}
          </div>
          {mine && (lot.proceeds ?? 0) > 0 && <div style={{ marginTop: 8 }}><Button tone="proof" onClick={() => void collectProceeds(lotId)}>COLLECT {lot.proceeds} G</Button></div>}
        </Panel>
      )}

      {tab === 'PEN' && mine && (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 10, alignItems: 'start' }}>
          <Panel title="WHO IS PENNED HERE">
            {herds.length === 0 && <span className="ws-dim ws-small">Nothing lives here yet.</span>}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {herds.map(h => (
                <div key={h.id} style={{ display: 'flex', flexDirection: 'column', gap: 4, borderBottom: '1px dashed var(--ws-text-dim)', paddingBottom: 6 }}>
                  <div className="ws-small"><b>{Number(h.def.generation ?? 1) >= 2 ? String(h.def.name) : 'Unknown contact'}</b>, {h.head} at home{h.keeping.length > 0 ? `, ${h.keeping.length} being kept` : ''}</div>
                  {h.keeping.map(k => <span key={k.body} className="ws-dim ws-small">One being kept: {k.fedDays} of {k.needs} fed days.</span>)}
                  <span className="ws-dim ws-small">{h.trough.length} things in the trough. {h.proof.nodes.length > 0 ? `${h.proof.nodes.length} changes in its line. ` : ''}{h.proof.nodes[h.proof.nodes.length - 1]?.parents.length === 2 ? 'Of two lines.' : ''}</span>
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {feedable.length > 0 && <Button tone="signal" onClick={async () => say(await FarmDoors.feed(lotId, h.id, feedable.map(i => i.id), playerPort, hubPort), `The trough takes ${feedable.length}.`)}>FEED ALL ({feedable.length})</Button>}
                    <Button tone="quiet" disabled={h.head <= 0} onClick={async () => say(await FarmDoors.cageOne(lotId, h.id, playerPort, hubPort), 'One goes back in a cage, into your stash.')}>CAGE ONE</Button>
                    <ArmedButton tone="quiet" disabled={h.head <= 0} confirmLabel="TAKE ONE: SURE?" onConfirm={async () => say(await FarmDoors.slaughter(lotId, h.id, playerPort, hubPort), 'What it gave is in the store.')}>TAKE ONE</ArmedButton>
                  </div>
                </div>
              ))}
              {herds.length >= 2 && herds[0].kind !== herds[1].kind && (
                <Button tone="quiet" onClick={async () => say(await FarmDoors.cross(lotId, herds[0].id, herds[1].id, playerPort, hubPort), 'Something new stands in the pen, of two lines.')}>TRY TO CROSS THE FIRST TWO</Button>
              )}
            </div>
          </Panel>
          <Panel title="BRING ONE HOME">
            {cages.length === 0 && <span className="ws-dim ws-small">No cages in the stash. A snare set in a world brings one back.</span>}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {cages.map(c => (
                <Button key={c.id} tone="signal" onClick={async () => say(await FarmDoors.admit(lotId, c.id, playerPort, hubPort), 'It goes in the pen. Feed it, and it will come to answer to home in days.')}>
                  PEN THE {String(c.creatureData!.gender).toUpperCase()}, RANK {c.rank}
                </Button>
              ))}
            </div>
            <div style={{ marginTop: 10 }}>
              <Button tone="quiet" onClick={async () => { const r = await FieldCapture.tieAtHome(playerPort); pushFeed(r.ok ? 'A snare, tied. Carry it into a world.' : r.reason ?? 'It would not tie.', r.ok ? 'signal' : 'loss'); }}>TIE A SNARE</Button>
            </div>
          </Panel>
        </div>
      )}

      {tab === 'HEARTH' && mine && (
        <Panel title="THE HEARTH">
          {!farm.hearth && (
            <Button tone="signal" onClick={async () => say(await FarmDoors.buildHearth(lotId, playerPort, hubPort), 'A hearth stands on the plot.')}>
              RAISE A HEARTH ({Cooking.HEARTH_BILL.count} {Cooking.HEARTH_BILL.tag})
            </Button>
          )}
          {farm.hearth && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div className="ws-dim ws-small">Choose two or more things that can be eaten. What is on the fire comes into the store when it is done.</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {food.map(i => (
                  <button key={i.id} type="button" aria-pressed={pot.includes(i.id)} aria-label={i.name} onClick={() => setPot(pot.includes(i.id) ? pot.filter(x => x !== i.id) : [...pot, i.id])}
                    style={{ padding: 2, background: 'transparent', cursor: 'pointer', border: `${pot.includes(i.id) ? 2 : 1}px ${pot.includes(i.id) ? 'solid' : 'dashed'} var(--ws-text-body)` }}>
                    <ItemSprite item={i} cellPx={22} />
                  </button>
                ))}
                {food.length === 0 && <span className="ws-dim ws-small">Nothing in the stash can be eaten.</span>}
              </div>
              <Button tone="signal" disabled={pot.length < 2} onClick={async () => { const r = await FarmDoors.cook(lotId, pot, playerPort, hubPort); say(r, 'It goes on the fire.'); if (r.ok) setPot([]); }}>COOK ({pot.length})</Button>
              {(farm.cooking ?? []).map(job => <span key={job.id} className="ws-small">On the fire: {job.items.length} things, {clock(job.finishesAt - now)} left.</span>)}
            </div>
          )}
        </Panel>
      )}
    </Modal>
  );
};
