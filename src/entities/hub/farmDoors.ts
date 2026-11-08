/**
 * THE FARM'S DOORS: every press on a plot, a pen and a hearth comes here. The law is in
 * `farm.ts`, `herd.ts`, `Capture.ts` and `Cooking.ts`; this moves the items and signs the record.
 *
 * Farming mints items and never gold, so nothing here touches `GoldCommit`. Selling goes through
 * the shop door the city already has (`buyFromLot`), which pays and records as it always did.
 */

import { IItem, UniversalRank } from '../../../shared/types';
import { RESOURCE_DEFINITIONS } from '../../../shared/entities/item/data/resourceDefinitions';
import { ItemFactory } from '../../../shared/entities/item/ItemFactory';
import { MOB_DEFINITIONS } from '../../../shared/entities/mob/data/mobDefinitions';
import type { IPlayerPort } from '../player/playerView';
import { Koseki } from '../../../shared/entities/world/Koseki';
import { Ledger } from '../../logic/ledger/Ledger';
import { Rng, fnv1a } from '../../../shared/logic/rng/DeterministicRNG';
import { Provenance } from '../../logic/sovereignty/Provenance';
import { Capture } from '../../../shared/logic/systems/Capture';
import { Cooking } from '../../logic/systems/Cooking';
import { WebSystem } from '../../../shared/logic/systems/WebSystem';
import { CreatureLines } from '../../../shared/logic/theme/CreatureLines';
import { HubGenerator } from './HubGenerator';
import { Farm, IFarm, IFarmland, IPlanting } from './farm';
import { Herd, IHerdHolder, IHomeHerd } from './herd';
import { CHUNK_TILES } from '../../../shared/entities/world/grid';
import { HubSide, farmChunkPlan, isFarmland } from './hubManifest';
import { answersTag } from '../../../shared/entities/hub/room';
import { worldDay } from './worldDay';
import type { IHubPort } from './hubView';

export interface IFarmVerdict { ok: boolean; reason?: string }

/** What a tended stand asks over a thing's own worth. A guess until Wave 12. */
const TEND_MARKUP = 1.5;
/** How much a skill learns from a bed or a pot. */
const XP_PER_WORK = 5;

const hub = (hp: IHubPort) => hp.view();
const person = (pc: IPlayerPort) => pc.view().player;
const stash = (pc: IPlayerPort) => person(pc).bank.stashTabs[0]?.items ?? [];
const refuse = (reason: string): IFarmVerdict => ({ ok: false, reason });

const fromStash = (ids: string[], pc: IPlayerPort) => pc.apply({ kind: 'STASH_REMOVE', ids });
const toStash = (items: IItem[], pc: IPlayerPort) => pc.apply({ kind: 'STASH_ADD', items });

const setFarmland = (next: IFarmland, hp: IHubPort) => hp.apply({ kind: 'FARMLAND', farmland: next });
const farmOf = (land: IFarmland, lotId: string): IFarm => land.farms[lotId] ?? Farm.empty(lotId);
const withFarm = (land: IFarmland, farm: IFarm): IFarmland => ({ ...land, farms: { ...land.farms, [farm.lotId]: farm } });

const layoutNow = (hp: IHubPort) => HubGenerator.generate({ chunks: hub(hp).chunks, dismembered: hub(hp).dismembered });
const plotOf = (lotId: string, hp: IHubPort) => hub(hp).lots.find(l => l.id === lotId && l.structureType === 'FARM');
const sizeOf = (lotId: string, hp: IHubPort) => HubGenerator.findPOI(layoutNow(hp), lotId)?.size;

/** Yours to work, or a refusal in voice. */
const ownPlot = (lotId: string, pc: IPlayerPort, hp: IHubPort): { lot: ReturnType<typeof plotOf> } | { reason: string } => {
  const lot = plotOf(lotId, hp);
  if (!lot) return { reason: 'That is not farmland.' };
  if (lot.ownerId !== person(pc).id) return { reason: lot.ownerId ? 'It is someone else\'s to work.' : 'Nobody holds it yet. The Land Office has it on the sheet.' };
  return { lot };
};

const practise = (tags: string[], rank: UniversalRank, pc: IPlayerPort) => {
  const pair = WebSystem.mint(tags, []);
  pc.apply({ kind: 'WORK_ON', pair, rank: Math.max(0, Object.values(UniversalRank).indexOf(rank)), xp: XP_PER_WORK });
};
const skillLevel = (tags: string[], pc: IPlayerPort) => person(pc).bank.universalSkills?.[WebSystem.mint(tags, []).id]?.level ?? 0;

/** What a bed gives, minted piece by piece, each with its own line. */
const mintYield = (lotId: string, bed: number, p: IPlanting, seedName: string, now: number, skill: number, hp: IHubPort): IItem[] => {
  const def = RESOURCE_DEFINITIONS[p.defId];
  const key = `${hub(hp).activeHubId}:${lotId}:${bed}`;
  const count = Farm.yieldOf(p, def, key, skill);
  const rng = Rng.fromKey(`farm:mint:${key}:${p.plantedAt}:${p.bears}`);
  return Array.from({ length: count }, () => ({
    ...ItemFactory.createResourceItem(def, rng, { origin: 'FARMED' }),
    farmLine: Farm.lineOf(p, lotId, bed, now, seedName)
  }));
};

const recordAll = async (items: IItem[], context: Record<string, unknown>) => {
  for (const item of items) await Provenance.record(item, 'MINT', context);
};

const putInStore = (lotId: string, items: IItem[], hp: IHubPort) => hp.apply({ kind: 'LOT_STORE_ADD', lotId, items });

export const FarmDoors = {

  // ---------------------------------------------------------------------------
  // THE LAND
  // ---------------------------------------------------------------------------

  /** Pedro: "you make the whole chunk farmland". A chunk with nobody on it, whole, and the hub portions it. */
  async makeFarmland(at: { cx: number; cy: number }, hp: IHubPort): Promise<IFarmVerdict> {
    const { chunks, dismembered, lots, activeHubId, buildJobs } = hub(hp);
    if (!activeHubId) return refuse('There is no office open.');
    const before = HubGenerator.generate({ chunks, dismembered });
    const placed = before.chunks.find(c => c.cx === at.cx && c.cy === at.cy);
    if (!placed) return refuse('Nothing stands there to plough.');
    const onIt = before.zones.flatMap(z => z.pois).filter(p =>
      p.position.x >= placed.x && p.position.x < placed.x + CHUNK_TILES && p.position.y >= placed.y && p.position.y < placed.y + CHUNK_TILES);
    const ids = new Set(onIt.map(p => p.id));
    const held = lots.find(l => ids.has(l.id) && l.ownerId);
    if (held) return refuse(`${held.ownerName ?? 'Someone'} holds ground on it. Farmland takes the whole chunk.`);
    if (buildJobs.some(j => ids.has(j.lotId) && !j.applied)) return refuse('Something is being raised on it. Farmland takes the whole chunk.');
    const made = farmChunkPlan({ chunks, dismembered }, at);
    if (!made.ok) return made;

    hp.apply({ kind: 'LAND', chunks: made.plan.chunks, removedLotIds: [...ids] });
    hp.settleLots();
    await Ledger.append('FARM', { kind: 'CHUNK_FARMED', cx: at.cx, cy: at.cy, consumedIds: [] });
    await hp.saveHubState();
    return { ok: true };
  },

  /** Raise the next chunk as farmland: the plan's bill, the same as any. */
  raiseFarmland(side: HubSide, beside: { cx: number; cy: number } | undefined, hp: IHubPort) {
    return hp.planRaise(side, beside, 'farmland');
  },

  isFarmlandAt(cx: number, cy: number, hp: IHubPort): boolean {
    const chunk = hub(hp).chunks.find(c => c.cx === cx && c.cy === cy);
    return !!chunk && isFarmland(chunk);
  },

  // ---------------------------------------------------------------------------
  // BEDS (line 36)
  // ---------------------------------------------------------------------------

  async plant(lotId: string, itemId: string, bed: number, pc: IPlayerPort, hp: IHubPort): Promise<IFarmVerdict> {
    const own = ownPlot(lotId, pc, hp);
    if ('reason' in own) return refuse(own.reason);
    const size = sizeOf(lotId, hp);
    const item = stash(pc).find(i => i.id === itemId);
    if (!size || !item) return refuse('That is not in your stash.');
    const can = Farm.plantVerdict(item);
    if (!can.ok) return refuse(can.reason!);
    const def = RESOURCE_DEFINITIONS[item.universalDefinitionId];
    const now = Date.now();
    const planting = Farm.planting(item, def, now);
    const land = hub(hp).farmland;
    const farm = farmOf(land, lotId);
    const fits = Farm.fitVerdict(farm, size, planting, bed);
    if (!fits.ok) return refuse(fits.reason!);

    fromStash([item.id], pc);
    setFarmland(withFarm(land, { ...farm, beds: { ...farm.beds, [bed]: planting } }), hp);
    await Ledger.append('FARM', { kind: 'PLANTED', lotId, bed, defId: def.id, consumedIds: [item.id], consumedDefIds: [def.id] });
    await Provenance.record(item, 'TRANSFER', { via: 'PLANTED', lotId, bed });
    await hp.saveHubState();
    return { ok: true };
  },

  async reap(lotId: string, bed: number, pc: IPlayerPort, hp: IHubPort): Promise<IFarmVerdict> {
    const own = ownPlot(lotId, pc, hp);
    if ('reason' in own) return refuse(own.reason);
    const land = hub(hp).farmland;
    const farm = land.farms[lotId];
    const planting = farm?.beds[bed];
    if (!farm || !planting) return refuse('Nothing is growing there.');
    const now = Date.now();
    if (Farm.growth(planting, now) < 1) return refuse(`${planting.name} is not ready. It takes its time.`);
    const def = RESOURCE_DEFINITIONS[planting.defId];
    if (!def) return refuse('This machine has no record of what that is.');

    const tags = planting.grove ? ['grove_keeping'] : ['farming'];
    const pieces = mintYield(lotId, bed, planting, planting.name, now, skillLevel(tags, pc), hp);
    const after = Farm.afterReap(planting, def, now);
    const { [bed]: _taken, ...beds } = farm.beds;
    setFarmland(withFarm(land, { ...farm, beds: after ? { ...beds, [bed]: after } : beds }), hp);
    putInStore(lotId, pieces, hp);
    await Ledger.append('FARM', { kind: 'REAPED', lotId, bed, defId: def.id, itemIds: pieces.map(i => i.id), consumedIds: [] });
    await recordAll(pieces, { origin: 'FARM', lotId, bed, seedItemId: planting.seedItemId, plantings: planting.plantings });
    practise(tags, Farm.rankOf(def), pc);
    await hp.saveHubState();
    return { ok: true };
  },

  // ---------------------------------------------------------------------------
  // THE STORE AND THE STAND (line 37, and what a person buys from)
  // ---------------------------------------------------------------------------

  async takeFromStore(lotId: string, itemId: string, pc: IPlayerPort, hp: IHubPort): Promise<IFarmVerdict> {
    const own = ownPlot(lotId, pc, hp);
    if ('reason' in own) return refuse(own.reason);
    const item = own.lot!.inventory.find(i => i.id === itemId);
    if (!item) return refuse('That is not in the store.');
    hp.apply({ kind: 'LOT_STORE_REMOVE', lotId, itemId });
    toStash([item], pc);
    await hp.saveHubState();
    return { ok: true };
  },

  async putInStore(lotId: string, itemId: string, pc: IPlayerPort, hp: IHubPort): Promise<IFarmVerdict> {
    const own = ownPlot(lotId, pc, hp);
    if ('reason' in own) return refuse(own.reason);
    const item = stash(pc).find(i => i.id === itemId);
    if (!item) return refuse('That is not in your stash.');
    fromStash([itemId], pc);
    putInStore(lotId, [item], hp);
    await hp.saveHubState();
    return { ok: true };
  },

  /** On the stand, for anyone who walks up. A price is the owner's to name. */
  async list(lotId: string, itemId: string, price: number, pc: IPlayerPort, hp: IHubPort): Promise<IFarmVerdict> {
    const own = ownPlot(lotId, pc, hp);
    if ('reason' in own) return refuse(own.reason);
    const item = own.lot!.inventory.find(i => i.id === itemId);
    if (!item) return refuse('That is not in the store.');
    if (!(price > 0)) return refuse('Name a price.');
    hp.apply({ kind: 'LOT_LIST', lotId, itemId, price });
    await Ledger.append('TRADE', { kind: 'LISTED', lotId, itemId, price, playerDelta: 0, treasuryDelta: 0 });
    await hp.saveHubState();
    return { ok: true };
  },

  async unlist(lotId: string, itemId: string, pc: IPlayerPort, hp: IHubPort): Promise<IFarmVerdict> {
    const own = ownPlot(lotId, pc, hp);
    if ('reason' in own) return refuse(own.reason);
    const listing = own.lot!.shopListings?.find(li => li.item.id === itemId);
    if (!listing) return refuse('That is not on the stand.');
    hp.apply({ kind: 'LOT_UNLIST', lotId, itemId });
    await hp.saveHubState();
    return { ok: true };
  },

  /** Someone in the city runs it from here on. Null gives it back to the owner's hands. */
  async setTender(lotId: string, residentId: string | null, pc: IPlayerPort, hp: IHubPort): Promise<IFarmVerdict> {
    const own = ownPlot(lotId, pc, hp);
    if ('reason' in own) return refuse(own.reason);
    if (residentId && !hub(hp).guild.residents.some(r => r.id === residentId)) return refuse('There is nobody by that name in the city.');
    const land = hub(hp).farmland;
    const farm = farmOf(land, lotId);
    const others = Object.values(land.farms).some(f => f.lotId !== lotId && f.tender === residentId && residentId);
    if (others) return refuse('They already run a plot.');
    const { tender: _was, ...rest } = farm;
    setFarmland(withFarm(land, residentId ? { ...rest, tender: residentId } : rest), hp);
    await hp.saveHubState();
    return { ok: true };
  },

  /** The plot is gone. Used at foreclosure, through the same clearing law. */
  async forget(lotId: string, pc: IPlayerPort, hp: IHubPort): Promise<void> {
    const cleared = Herd.clearHolder(Farm.clear(hub(hp).farmland, lotId), { type: 'plot', id: lotId });
    setFarmland(cleared.farmland, hp);
    if (cleared.items.length > 0) toStash(cleared.items, pc);
    await hp.saveHubState();
  },

  // ---------------------------------------------------------------------------
  // THE PEN (the herding half of line 152)
  // ---------------------------------------------------------------------------

  /** A cage comes home, and this starts domesticating what is in it. It goes on the person's register. */
  async admit(lotId: string, itemId: string, pc: IPlayerPort, hp: IHubPort): Promise<IFarmVerdict> {
    const own = ownPlot(lotId, pc, hp);
    if ('reason' in own) return refuse(own.reason);
    const item = stash(pc).find(i => i.id === itemId);
    const cage = item?.creatureData;
    if (!item || !cage) return refuse('There is nothing alive in that.');
    const holder: IHerdHolder = { type: 'plot', id: lotId };
    const today = worldDay();
    const land = hub(hp).farmland;
    const standing = Herd.heldBy(land.herds, holder).find(h => h.kind === cage.kind);
    const herd = standing ? Herd.admit(Herd.fold(standing, today, hub(hp).activeHubId ?? ''), cage) : Herd.start(holder, cage, today);
    const herds = standing ? land.herds.map(h => (h === standing ? herd : h)) : [...land.herds, herd];

    const me = person(pc).id;
    let register = land.registers[me] ?? Capture.registerOf(hub(hp).activeHubId ?? 'hub', me, today);
    if (!register.entries.some(e => e.body === cage.body)) {
      // Whatever register it left from is the world's. Here it stands by the proof it carries
      const arrival = Koseki.found(cage.caughtAt.worldUid, cage.body, cage.kind, today);
      register = Koseki.adopt(arrival, register, cage.body, cage.kind, today).to;
    }
    fromStash([item.id], pc);
    setFarmland({ ...land, herds, registers: { ...land.registers, [me]: register } }, hp);
    await Ledger.append('FARM', { kind: 'PENNED', lotId, herdId: herd.id, body: cage.body, consumedIds: [item.id] });
    practise(['herding'], (cage.def.rank as UniversalRank) ?? UniversalRank.F, pc);
    await hp.saveHubState();
    return { ok: true };
  },

  async feed(lotId: string, herdId: string, itemIds: string[], pc: IPlayerPort, hp: IHubPort): Promise<IFarmVerdict> {
    const own = ownPlot(lotId, pc, hp);
    if ('reason' in own) return refuse(own.reason);
    const land = hub(hp).farmland;
    const herd = land.herds.find(h => h.id === herdId);
    if (!herd) return refuse('There is no such herd here.');
    const items = itemIds.map(id => stash(pc).find(i => i.id === id)).filter((i): i is IItem => !!i && Herd.worthOf(i) > 0);
    if (items.length === 0) return refuse('Nothing there would feed them.');
    fromStash(items.map(i => i.id), pc);
    setFarmland({ ...land, herds: land.herds.map(h => (h.id === herdId ? Herd.feed(h, items) : h)) }, hp);
    await Ledger.append('FARM', { kind: 'FED', lotId, herdId, consumedIds: items.map(i => i.id), consumedDefIds: items.map(i => i.universalDefinitionId) });
    await hp.saveHubState();
    return { ok: true };
  },

  async slaughter(lotId: string, herdId: string, pc: IPlayerPort, hp: IHubPort): Promise<IFarmVerdict> {
    const own = ownPlot(lotId, pc, hp);
    if ('reason' in own) return refuse(own.reason);
    const land = hub(hp).farmland;
    const herd = land.herds.find(h => h.id === herdId);
    if (!herd || herd.head <= 0) return refuse('There is nothing to take.');
    const mob = (MOB_DEFINITIONS[herd.kind] ?? herd.def) as Parameters<typeof Herd.slaughter>[1];
    const res = Herd.slaughter(herd, mob, `${herd.id}:${herd.head}:${herd.foldedDay}`);
    setFarmland({ ...land, herds: land.herds.map(h => (h.id === herdId ? res.herd : h)) }, hp);
    putInStore(lotId, res.items, hp);
    await Ledger.append('FARM', { kind: 'SLAUGHTERED', lotId, herdId, itemIds: res.items.map(i => i.id), consumedIds: [] });
    await recordAll(res.items, { origin: 'HERD', lotId, herdId });
    practise(['herding'], (herd.def.rank as UniversalRank) ?? UniversalRank.F, pc);
    await hp.saveHubState();
    return { ok: true };
  },

  /** A head goes back in a cage, to be carried to another map (line 117). It is named now, so the register holds it. */
  async cageOne(lotId: string, herdId: string, pc: IPlayerPort, hp: IHubPort): Promise<IFarmVerdict> {
    const own = ownPlot(lotId, pc, hp);
    if ('reason' in own) return refuse(own.reason);
    const land = hub(hp).farmland;
    const herd = land.herds.find(h => h.id === herdId);
    if (!herd) return refuse('There is no such herd here.');
    const me = person(pc).id;
    const out = Herd.cageOne(herd, hub(hp).activeHubId ?? '', me, worldDay(), hub(hp).activeHubId ?? '');
    if (!out) return refuse('There is no head here to cage.');
    const register = land.registers[me] ?? Capture.registerOf(hub(hp).activeHubId ?? 'hub', me, worldDay());
    const written = Koseki.bear(register, out.cage.body, herd.kind, herd.bodies.slice(0, 2), worldDay());
    const item = Capture.cageItem(out.cage, `home:${out.cage.body}`);
    setFarmland({ ...land, herds: land.herds.map(h => (h.id === herdId ? out.herd : h)), registers: { ...land.registers, [me]: written } }, hp);
    toStash([item], pc);
    await Ledger.append('FARM', { kind: 'CAGED', lotId, herdId, itemIds: [item.id], consumedIds: [] });
    await Provenance.record(item, 'MINT', { origin: 'HERD', lotId, herdId, body: out.cage.body });
    await hp.saveHubState();
    return { ok: true };
  },

  /**
   * Two kinds in one pen, and a try. A child of two lines has two parents in its hash (line 117).
   * A hit stands a herd of a new kind with one head; a miss costs the day's trouble, and it is keyed by how many tries have been had.
   */
  async cross(lotId: string, herdA: string, herdB: string, pc: IPlayerPort, hp: IHubPort): Promise<IFarmVerdict> {
    const own = ownPlot(lotId, pc, hp);
    if ('reason' in own) return refuse(own.reason);
    const land = hub(hp).farmland;
    const a = land.herds.find(h => h.id === herdA), b = land.herds.find(h => h.id === herdB);
    if (!a || !b || a.head <= 0 || b.head <= 0) return refuse('It takes a head of each, kept and at home.');
    if (a.kind === b.kind) return refuse('They are the one kind already.');
    const me = person(pc).id;
    const register = land.registers[me] ?? Capture.registerOf(hub(hp).activeHubId ?? 'hub', me, worldDay());
    const tries = register.entries.filter(e => e.word === 'child').length + (land.crossTries ?? 0);
    const key = `${hub(hp).activeHubId}:${a.kind}:${b.kind}:${tries}`;
    if (Rng.fromKey(`cross:${key}`).next() >= 0.25) {
      setFarmland({ ...land, crossTries: (land.crossTries ?? 0) + 1 }, hp);
      practise(['herding'], (a.def.rank as UniversalRank) ?? UniversalRank.F, pc);
      await hp.saveHubState();
      return refuse('Nothing came of it.');
    }
    const proof = await CreatureLines.crossed(a.proof, b.proof, key, worldDay());
    const body = `herd_child_${fnv1a(key).toString(36)}`;
    const holder: IHerdHolder = { type: 'plot', id: lotId };
    const parents = [a.bodies[0] ?? a.kind, b.bodies[0] ?? b.kind];
    const child: IHomeHerd = {
      id: `herd_${lotId}_${fnv1a(proof.kind).toString(36)}`, kind: proof.kind, def: proof.def, proof, holder,
      head: 1, bodies: [body], keeping: [], foldedDay: worldDay(), trough: [], opened: 0, caged: 0
    };
    const written = Koseki.bear(register, body, proof.kind, parents, worldDay());
    const withParents = parents.reduce((reg, parent) => (reg.entries.some(e => e.body === parent) ? reg : Koseki.bear(reg, parent, parent === parents[0] ? a.kind : b.kind, [], worldDay())), written);
    setFarmland({ ...land, herds: [...land.herds, child], registers: { ...land.registers, [me]: withParents }, crossTries: (land.crossTries ?? 0) + 1 }, hp);
    await Ledger.append('FARM', { kind: 'CROSSED', lotId, kindId: proof.kind, parents: [a.kind, b.kind], consumedIds: [] });
    await hp.saveHubState();
    return { ok: true };
  },

  // ---------------------------------------------------------------------------
  // THE HEARTH
  // ---------------------------------------------------------------------------

  async buildHearth(lotId: string, pc: IPlayerPort, hp: IHubPort): Promise<IFarmVerdict> {
    const own = ownPlot(lotId, pc, hp);
    if ('reason' in own) return refuse(own.reason);
    const land = hub(hp).farmland;
    const farm = farmOf(land, lotId);
    if (farm.hearth) return refuse('It has a hearth.');
    const { tag, count } = Cooking.HEARTH_BILL;
    const parts = stash(pc).filter(i => answersTag(i, tag)).slice(0, count);
    if (parts.length < count) return refuse(`A hearth takes ${count} ${tag}.`);
    fromStash(parts.map(i => i.id), pc);
    setFarmland(withFarm(land, { ...farm, hearth: true }), hp);
    await Ledger.append('FARM', { kind: 'HEARTH_RAISED', lotId, consumedIds: parts.map(i => i.id), consumedDefIds: parts.map(i => i.universalDefinitionId) });
    await hp.saveHubState();
    return { ok: true };
  },

  async cook(lotId: string, itemIds: string[], pc: IPlayerPort, hp: IHubPort): Promise<IFarmVerdict> {
    const own = ownPlot(lotId, pc, hp);
    if ('reason' in own) return refuse(own.reason);
    const land = hub(hp).farmland;
    const farm = farmOf(land, lotId);
    if (!farm.hearth) return refuse('There is no hearth here yet.');
    const items = itemIds.map(id => stash(pc).find(i => i.id === id)).filter((i): i is IItem => !!i);
    const can = Cooking.verdict(items);
    if (!can.ok) return refuse(can.reason!);
    const now = Date.now();
    const cooking = farm.cooking ?? [];
    const job = { id: `cook_${now.toString(36)}_${cooking.length}`, queuedAt: now, finishesAt: now + Cooking.cookMs(items), items, ownerCertUid: person(pc).id };
    fromStash(items.map(i => i.id), pc);
    setFarmland(withFarm(land, { ...farm, cooking: [...cooking, job] }), hp);
    await Ledger.append('FARM', { kind: 'COOKING', lotId, jobId: job.id, consumedIds: items.map(i => i.id), consumedDefIds: items.map(i => i.universalDefinitionId) });
    await hp.saveHubState();
    return { ok: true };
  },

  // ---------------------------------------------------------------------------
  // WHEN SOMEONE LOOKS: nothing runs while they are away
  // ---------------------------------------------------------------------------

  /** Is anything here waiting? Read each second, so the answer has to be cheap and write nothing. */
  isDue(hp: IHubPort, now = Date.now()): boolean {
    const { farmland } = hub(hp);
    const today = worldDay();
    return farmland.herds.some(h => h.foldedDay < today)
      || Object.values(farmland.farms).some(f => (f.cooking ?? []).some(j => j.finishesAt <= now) || (!!f.tender && Farm.tendOrder(f, now).length > 0));
  },

  async resolve(pc: IPlayerPort, hp: IHubPort): Promise<void> {
    if (!this.isDue(hp)) return;
    const now = Date.now();
    const today = worldDay();
    const seed = hub(hp).activeHubId ?? '';
    let land = hub(hp).farmland;
    land = { ...land, herds: land.herds.map(h => Herd.fold(h, today, seed)) };
    const minted: IItem[] = [];

    for (const start of Object.values(land.farms)) {
      let farm = start;
      const done = (farm.cooking ?? []).filter(j => j.finishesAt <= now);
      if (done.length > 0) {
        const meals = done.map(j => Cooking.meal(j.items, j.id, j.ownerCertUid === person(pc).id ? skillLevel(['cooking'], pc) : 0));
        farm = { ...farm, cooking: (farm.cooking ?? []).filter(j => j.finishesAt > now) };
        putInStore(farm.lotId, meals, hp);
        minted.push(...meals);
        await Ledger.append('FARM', { kind: 'COOKED', lotId: farm.lotId, itemIds: meals.map(i => i.id), consumedIds: [] });
        if (done.some(j => j.ownerCertUid === person(pc).id)) practise(['cooking'], meals[0].rank, pc);
      }

      // Whoever runs it takes what is ripe, sets one back, and puts the rest on the stand.
      if (farm.tender) {
        for (const bed of Farm.tendOrder(farm, now)) {
          const planting = farm.beds[bed];
          const def = RESOURCE_DEFINITIONS[planting.defId];
          if (!def) continue;
          const pieces = mintYield(farm.lotId, bed, planting, planting.name, now, 0, hp);
          const after = Farm.afterReap(planting, def, now);
          let selling = pieces;
          const beds = { ...farm.beds };
          delete beds[bed];
          if (after) beds[bed] = after;
          else {
            beds[bed] = Farm.planting(pieces[0], def, now);
            selling = pieces.slice(1);
          }
          farm = { ...farm, beds };
          hp.apply({ kind: 'LOT_SHELF_ADD', lotId: farm.lotId, listings: selling.map(item => ({ item, price: Math.max(1, Math.ceil((item.value ?? 1) * TEND_MARKUP)) })) });
          minted.push(...pieces);
          await Ledger.append('FARM', { kind: 'TENDED', lotId: farm.lotId, bed, tender: farm.tender, itemIds: pieces.map(i => i.id), consumedIds: [] });
        }
      }
      land = withFarm(land, farm);
    }
    setFarmland(land, hp);
    await recordAll(minted, { origin: 'FARM' });
    await hp.saveHubState();
  }
};
