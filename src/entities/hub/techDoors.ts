/**
 * The hub's doors for its buildings and its web (D91, D119). The law is in `hubTech.ts`; these
 * are the store actions over it, kept here so the store only has to add its doors.
 */

import { IHubWeb, IItem, IWebStation } from '../../../types';
import { HubGenerator } from './HubGenerator';
import { IChainStanding, ChainWeb, IChainRound } from '../../logic/theme/ChainWeb';
import { Ledger } from '../../logic/ledger/Ledger';
import { GoldCommit } from '../../logic/economy/GoldCommit';
import { IntelligenceClient } from '../../logic/intelligence/IntelligenceClient';
import { WebBank } from '../../logic/content/WebBank';
import { WebSystem } from '../../logic/systems/WebSystem';
import { IProfession, Profession } from '../../logic/systems/Profession';
import { absorbWebBatch, STRUCTURE_COSTS } from '../economy/data/recipeDefinitions';
import { usePlayerStore } from '../player/store';
import { useFeed } from '../../components/ui/stores';
import { IGuildState, IResident, readSheet } from './guild';
import {
  IHubPopulation, IHubTech, IWorkshop, IWorkshopOffer, WorkshopMode, addToLedger, admitSilently, billFor, foldReach, groundOf, hubPopulation, hubStations,
  offerFor, openedChainStations, routeFor, sizeVerdict, standingOf
} from './hubTech';
import { RoomVerdict, answersTag, tagDefaultMaterial, PIECE_BUILD_SECONDS, SHELL_BUILD_SECONDS } from './room';
import { ITemplate, ITemplateSheet, SYSTEM_TEMPLATES, defaultSheet } from './template';

/** What one pass may ask of the door for one person. It guards the bill and caps no content: what is over it waits. */
const CHAIN_ROUNDS_PER_PASS = 3;

export interface ITechDoors {
  /** Someone at home: what they are and what they want. Null: nothing anyone could give them. */
  workshopOffer: (residentId: string) => IWorkshopOffer | null;
  /** C2's door: a person says which building their goal needs. */
  askForBuilding: (residentId: string, stationId: string, words: string) => Promise<RoomVerdict>;
  /** Give someone a workshop on ground you hold: their own station, or a machine for their whole road. */
  provideWorkshop: (residentId: string, lotId: string, mode: WorkshopMode, stationId?: string) => Promise<RoomVerdict>;
  /** D8's pooled bill, from anyone. When it is met, the clock starts. */
  poolToWorkshop: (workshopId: string, tag: string, itemIds: string[]) => Promise<RoomVerdict>;
  /** Finished workshops stand, and whatever the web now reaches comes out. */
  settleWorkshops: () => Promise<void>;
  /** The chains people's knowledge is written back through. With no key it waits, unasked. */
  resolveChains: () => Promise<void>;
  population: () => IHubPopulation;
}

interface IStoreSide {
  activeHubId: string | null;
  guild: IGuildState;
  tech: IHubTech;
  web: IHubWeb;
  lots: { id: string; ownerId: string | null; structureType: string; lotIndex: number; ownerName: string | null }[];
  rooms: Record<string, any>;
  buildJobs: any[];
  craftsmen: unknown[];
  chunks: any;
  dismembered: any;
  hubDoc: () => any;
  saveHubState: () => Promise<void>;
}

interface IStoreHelpers {
  removeFromStash: (ids: string[]) => void;
  dominantDefId: (defIds: string[]) => string;
  signRecord: (payload: Record<string, any>) => Promise<string | undefined>;
}

const offerGround = () => groundOf();

let resolving = false;

export function techDoors(set: (partial: any) => void, get: () => IStoreSide & ITechDoors, helpers: IStoreHelpers): ITechDoors {
  const standingNow = (): IChainStanding => standingOf(get(), get().tech);
  const residentOf = (id: string) => get().guild.residents.find(r => r.id === id);

  const professionOf = (r: IResident): IProfession | null => get().tech.professions[r.id] ?? Profession.of({
    worldSeed: r.worldSeed, entityId: r.entityId, rank: r.bond.rank, themeId: r.bond.themeId, skills: readSheet(r).skills ?? {}
  });

  /** Whatever the web now reaches comes out, and this is the first anyone hears of it. */
  const reachNow = async () => {
    const hubId = get().activeHubId;
    const { web, tech, events } = foldReach(get().web, get().tech, offerGround(), standingNow(), Date.now());
    set({ web, tech });
    const opened = openedChainStations(tech);
    if (opened.length > 0) absorbWebBatch({ runId: 'chain', model: 'chain', ranAt: 0, stations: opened });
    for (const event of events) {
      const name = WebSystem.nameOf(event.skillId);
      await Ledger.append('TECH', { kind: 'FIRST', skillId: event.skillId, name, hubId, rung: 0, by: event.by });
      useFeed.getState().push(`The hub has reached ${name}, through ${event.by}.`, 'proof');
    }
  };

  return {
    workshopOffer: (residentId) => {
      const resident = residentOf(residentId);
      if (!resident?.homeAt) return null;
      const profession = professionOf(resident);
      return profession ? offerFor(resident.id, profession, get().tech, offerGround(), standingNow()) : null;
    },

    askForBuilding: async (residentId, stationId, words) => {
      if (!residentOf(residentId)) return { ok: false, reason: 'Nobody by that name lives here.' };
      if (!hubStations(get().tech).some((s: IWebStation) => s.id === stationId)) return { ok: false, reason: 'Nobody here could raise that.' };
      const tech = get().tech;
      set({ tech: { ...tech, asks: { ...tech.asks, [residentId]: { stationId, words, by: 'TALK' as const } } } });
      await get().saveHubState();
      return { ok: true };
    },

    provideWorkshop: async (residentId, lotId, mode, stationId) => {
      const resident = residentOf(residentId);
      const { activeHubId, tech, lots, buildJobs } = get();
      if (!activeHubId) return { ok: false, reason: 'The Hall is shut.' };
      if (!resident?.homeAt) return { ok: false, reason: 'They need a door of their own first.' };
      if (tech.workshops.some(w => w.residentId === residentId)) return { ok: false, reason: `${resident.name} already has a workshop.` };
      const offer = get().workshopOffer(residentId);
      const wanted = stationId ?? offer?.stationId;
      if (!wanted || !hubStations(tech).some(s => s.id === wanted)) return { ok: false, reason: `${resident.name} has no use for that.` };

      const p = usePlayerStore.getState().player;
      const lot = lots.find(l => l.id === lotId);
      if (!lot) return { ok: false, reason: 'There is no such ground.' };
      if (lot.ownerId !== p.id) return { ok: false, reason: 'It has to be ground you hold.' };
      if (lot.structureType !== 'EMPTY' || buildJobs.some(j => j.lotId === lotId && !j.applied)) return { ok: false, reason: 'Something stands on it already.' };

      if (stationId === undefined && offer?.coming) return { ok: false, reason: 'One is already being raised here for someone else.' };
      const profession = professionOf(resident);
      const route = profession ? routeFor(profession, tech, offerGround(), standingNow(), residentId) : { stations: [wanted] };
      const stations = mode === 'MACHINE' ? [...new Set([...(route.stations ?? []), wanted])] : [wanted];
      const poi = HubGenerator.findPOI(HubGenerator.generate({ chunks: get().chunks, dismembered: get().dismembered }), lotId);
      const footprint = poi ? { width: poi.size.width, height: poi.size.height } : { width: 4, height: 4 };
      const sized = sizeVerdict(stations, footprint, tech);
      if (!sized.ok) return sized;

      const permit = STRUCTURE_COSTS.WORKSHOP.build * stations.length;
      if (p.bank.gold < permit) return { ok: false, reason: `The permit is ${permit.toLocaleString()} G; you hold ${p.bank.gold.toLocaleString()} G.` };

      const shop: IWorkshop = {
        id: `shop_${resident.id}`, residentId, lotId, mode, stations,
        name: mode === 'MACHINE' ? `${resident.name}'s machine` : `${resident.name}'s ${hubStations(tech).find(s => s.id === wanted)!.name}`,
        bill: billFor(stations, tech), pool: {}
      };
      // From the check to its row there is no await: one press, one workshop.
      usePlayerStore.setState(s => ({ player: { ...s.player, bank: { ...s.player.bank, gold: s.player.bank.gold - permit } } }));
      set({ tech: { ...tech, workshops: [...tech.workshops, shop] } });
      await GoldCommit.commit({
        rows: [{ type: 'GOLD_DELTA', data: { reason: 'BUILD_PERMIT', lotId, structure: 'WORKSHOP', residentId, stations, amount: -permit, treasuryId: activeHubId, treasuryDelta: permit } }],
        treasury: { worldUid: activeHubId, delta: permit },
        hubDoc: get().hubDoc() ?? undefined
      });
      return { ok: true };
    },

    poolToWorkshop: async (workshopId, tag, itemIds) => {
      const { tech, lots } = get();
      const shop = tech.workshops.find(w => w.id === workshopId);
      if (!shop) return { ok: false, reason: 'There is no such workshop.' };
      if (shop.raised) return { ok: false, reason: 'It is already rising. It asks nothing more.' };
      const line = shop.bill.find(l => l.tag === tag);
      if (!line) return { ok: false, reason: `It does not ask for anything ${tag}.` };
      const short = line.count - (shop.pool[tag]?.count ?? 0);
      if (short <= 0) return { ok: false, reason: `It holds all the ${tag} it asks for.` };
      const stash = usePlayerStore.getState().player.bank.stashTabs[0]?.items || [];
      const items = itemIds.map(id => stash.find(i => i.id === id));
      if (items.some(i => !i)) return { ok: false, reason: 'That is not in your stash.' };
      const wrong = items.find(i => !answersTag(i!, tag));
      if (wrong) return { ok: false, reason: `${wrong.name} is not ${tag}. It will not take it.` };
      const given = (items as IItem[]).slice(0, short);
      if (given.length === 0) return { ok: false, reason: 'Nothing was given.' };

      const prior = shop.pool[tag];
      const pool = {
        ...shop.pool,
        [tag]: {
          count: (prior?.count ?? 0) + given.length,
          consumedIds: [...(prior?.consumedIds ?? []), ...given.map(i => i.id)],
          defIds: [...(prior?.defIds ?? []), ...given.map(i => i.universalDefinitionId)]
        }
      };
      const met = shop.bill.every(l => (pool[l.tag]?.count ?? 0) >= l.count);
      helpers.removeFromStash(given.map(i => i.id));
      set({ tech: { ...tech, workshops: tech.workshops.map(w => w.id === workshopId ? { ...w, pool, ...(met ? { raised: true } : {}) } : w) } });
      await Ledger.append('BUILD', { kind: 'WORKSHOP_POOLED', lotId: shop.lotId, workshopId, tag, consumedIds: given.map(i => i.id), consumedDefIds: given.map(i => i.universalDefinitionId) });

      if (met) {
        // The same jobs a plan raises, on the same clock. A machine takes as long as all it folded.
        const lot = lots.find(l => l.id === shop.lotId)!;
        const poi = HubGenerator.findPOI(HubGenerator.generate({ chunks: get().chunks, dismembered: get().dismembered }), shop.lotId);
        const footprint = poi ? { width: poi.size.width, height: poi.size.height } : { width: 4, height: 4 };
        // The hub's one workshop plan, at the size of the ground it was given
        const plan = SYSTEM_TEMPLATES.find(t => t.structureType === 'WORKSHOP')!;
        const tpl: ITemplate = { ...plan, name: shop.name, footprint };
        const base = defaultSheet(tpl);
        const sheet: ITemplateSheet = { ...base, WALL: pool.building ? helpers.dominantDefId(pool.building.defIds) : tagDefaultMaterial('building') };
        const now = Date.now();
        const shellFinish = now + SHELL_BUILD_SECONDS.WORKSHOP * 1000 * shop.stations.length;
        const owner = usePlayerStore.getState().player.id;
        const batch = shop.id;
        const jobs: any[] = [{
          id: `bld_${now.toString(36)}_${shop.id}`, lotId: lot.id, kind: 'SHELL', structureType: 'WORKSHOP', ownerCertUid: owner,
          queuedAt: now, finishesAt: shellFinish, applied: false, workshopId,
          consumedIds: pool.building?.consumedIds ?? [], consumedDefIds: [sheet.WALL], batch,
          template: { itemId: batch, data: tpl, sheet }
        }];
        let finish = shellFinish;
        tpl.pieces.forEach((piece, i) => {
          finish += PIECE_BUILD_SECONDS[piece.kind] * 1000;
          const materialDefId = piece.kind === 'WINDOW' ? sheet.WINDOW : piece.kind === 'DOOR' ? sheet.DOOR : sheet.WALL;
          jobs.push({
            id: `bld_${now.toString(36)}_${shop.id}_${i}`, lotId: lot.id, kind: 'PIECE',
            piece: { kind: piece.kind, x: piece.x, y: piece.y, materialDefId }, ownerCertUid: owner,
            queuedAt: now, finishesAt: finish, applied: false, consumedIds: [], consumedDefIds: [materialDefId], batch, workshopId
          });
        });
        for (const job of jobs) job.signature = await helpers.signRecord({ kind: 'WORKSHOP', lotId: lot.id, workshopId, piece: job.piece, at: now });
        set({ buildJobs: [...get().buildJobs, ...jobs] });
        await Ledger.append('BUILD', { kind: 'WORKSHOP_RISING', lotId: lot.id, workshopId, stations: shop.stations.length, jobs: jobs.length });
        useFeed.getState().push(`The bill is met. ${shop.name} is rising.`, 'proof');
      }
      await get().saveHubState();
      return { ok: true };
    },

    settleWorkshops: async () => {
      const { tech, buildJobs } = get();
      const due = tech.workshops.filter(w => w.raised && !w.standsAt && !buildJobs.some(j => j.lotId === w.lotId && !j.applied));
      const now = Date.now();
      if (due.length > 0) {
        set({ tech: { ...tech, workshops: tech.workshops.map(w => due.some(d => d.id === w.id) ? { ...w, standsAt: now } : w) } });
        for (const shop of due) {
          const resident = residentOf(shop.residentId);
          await Ledger.append('GUILD', { kind: 'WORKSHOP_STANDS', workshopId: shop.id, residentId: shop.residentId, lotId: shop.lotId, mode: shop.mode });
          useFeed.getState().push(`${resident?.name ?? 'Someone'} has their workshop.`, 'proof');
        }
      }
      await reachNow();
    },

    resolveChains: async () => {
      if (resolving) return;
      resolving = true;
      try {
        const registered = (tag: string) => WebBank.current().tags.some(t => t.tag === tag && !t.retired);
        const ground = offerGround();
        const groundLine = {
          things: ground.things.map(t => `${t.key} (${t.rank}): ${t.name}`),
          stations: ground.stations.map(s => `${s.key}: ${s.name}, ${s.tool.join('/')} on ${s.material.join('/')}`),
          tools: ground.tools
        };
        for (const resident of get().guild.residents) {
          if (!resident.homeAt) continue;
          const profession = professionOf(resident);
          // Read from their hands, there is nothing to write: the road is what the web already knows.
          if (!profession || profession.from !== 'THEME') continue;
          let state = get().tech.resolving[resident.id] ?? { closed: false, calls: 0 };
          if (state.closed) continue;
          for (let round = 0; round < CHAIN_ROUNDS_PER_PASS; round++) {
            const tech = get().tech;
            const open = ChainWeb.open(profession.concept, profession.rank, tech.chain, ground, resident.id);
            if (open.length === 0) { state = { ...state, closed: true, refused: undefined }; break; }
            const out = await IntelligenceClient.resolveChain<IChainRound>({
              person: { name: profession.name, knows: profession.knows, concept: profession.concept, rank: profession.rank, workshop: profession.workshop, tool: profession.tool, material: profession.material },
              ground: groundLine,
              written: {
                words: tech.chain.tags.map(t => t.tag),
                things: [...tech.chain.materials.map(m => `${m.key} (${m.rank})`), ...tech.chain.goods.map(g => `${g.key} (${g.rank})`), ...tech.chain.gear.map(g => `${g.key} (${g.rank})`)],
                stations: tech.chain.stations.map(s => s.key)
              },
              open, refused: state.refused
            });
            // No key, no network, a busy door: an outcome, and it waits for the next look.
            if (out.status !== 'OK' || !out.data) break;
            state = { ...state, calls: state.calls + 1 };
            const verdict = ChainWeb.judge(out.data, tech.chain, ground, open, registered);
            if (!verdict.ok) { state = { ...state, refused: verdict.reason }; continue; }
            state = { ...state, refused: undefined };
            set({ tech: addToLedger({ ...get().tech, chain: ChainWeb.merge(tech.chain, out.data, resident.id) }, out.data, resident.id, Date.now()) });
            if (ChainWeb.open(profession.concept, profession.rank, get().tech.chain, ground, resident.id).length === 0) { state = { ...state, closed: true }; break; }
          }
          set({ tech: { ...get().tech, resolving: { ...get().tech.resolving, [resident.id]: state } } });
        }
        await get().saveHubState();
      } finally {
        resolving = false;
      }
    },

    population: () => hubPopulation({ residents: get().guild.residents, craftsmen: get().craftsmen }, get().tech)
  };
}

/** A person comes home: what they know goes in unseen, and what they are is written down. */
export function settleSilently(web: IHubWeb, tech: IHubTech, resident: IResident, at: number): { web: IHubWeb; tech: IHubTech } {
  const skills = readSheet(resident).skills ?? {};
  const profession = tech.professions[resident.id] ?? Profession.of({
    worldSeed: resident.worldSeed, entityId: resident.entityId, rank: resident.bond.rank, themeId: resident.bond.themeId, skills
  });
  return {
    web: admitSilently(web, { uid: resident.id, name: resident.name }, skills, at),
    tech: profession ? { ...tech, professions: { ...tech.professions, [resident.id]: profession } } : tech
  };
}
