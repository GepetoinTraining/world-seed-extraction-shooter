/**
 * BUILDINGS IN THE HUB'S TECH (D91, D119): the law of what stands, what it asks, and what the
 * web has reached. Pedro, 2026-11-01:
 *
 *   "tech web should come from NPC being provided the workshop they want (they know their
 *   recipes) and study"
 *   "the person's skill is added to the hub silently, the players cannot know, they need to
 *   make the web reach it"
 *   "tall means cornucopia machine here, or, you need to spread the workstations around. to
 *   make a car I can be toyota or ford or tesla... they all make cars"
 *   "an npc will never accrue the cost if the pieces already exist, that's player intelligence
 *   and organizing the order of the web"
 *   spreading wide: "more NPCs, stabler economy, it's pop count"
 *
 * So one road to a concept, two ways to walk it. TALL: one person's machine on one big lot does
 * every step still missing, at the whole of what those steps ask. WIDE: each step is a workshop
 * with its own person, so the city holds more people. Either way only what does not stand yet
 * is ever billed, so the order someone raises things in is the skill.
 *
 * Pure logic over plain data: no store, no clock, no gold. The doors are in the hub's store.
 * THE SEAMS: `hubStations` is the one list of what can be raised, so a station C7 or C8 adds to
 * a batch or a theme comes through here whole, and `IWebStation.after` holds a building that
 * stands on another though no recipe says so. `askFor` is what a person's talk writes (C2).
 */

import { IHubWeb, IWebNodeRecord, IWebPack, IWebStation } from '../../../shared/types';
import { ChainWeb, IChainGround, IChainMaterial, IChainRoute, IChainRound, IChainStanding, IChainWeb, emptyChain } from '../../../shared/logic/theme/ChainWeb';
import { stationNumbers } from '../../../shared/logic/theme/ThemeFormula';
import { RANKS, ThemeRank } from '../../../shared/logic/theme/ThemeTypes';
import { IProfession } from '../../logic/systems/Profession';
import { WebSystem } from '../../../shared/logic/systems/WebSystem';
import { TagLaw } from '../../../shared/logic/content/TagLaw';
import { WebBank } from '../../../shared/logic/content/WebBank';
import { RECIPE_DEFINITIONS, CRAFTED_DEFINITIONS } from '../../../shared/entities/economy/data/recipeDefinitions';
import { RESOURCE_DEFINITIONS } from '../../../shared/entities/item/data/resourceDefinitions';
import { IRoomState, SHELL_BILLS, interiorSize } from '../../../shared/entities/hub/room';

export type WorkshopMode = 'WORKSTATION' | 'MACHINE';

/** A building given to a person. Its bill is fixed when it is given and pooled like a house's. */
export interface IWorkshop {
  id: string;
  residentId: string;
  lotId: string;
  mode: WorkshopMode;
  /** The stations it stands for: one, or all a machine folded. */
  stations: string[];
  name: string;
  bill: { tag: string; count: number }[];
  pool: Record<string, { count: number; consumedIds: string[]; defIds: string[] }>;
  raised?: boolean;
  /** When it was finished. From here it counts in the reach. */
  standsAt?: number;
}

/** A person's own say in what they want. C2's talk writes one; until then their sheet says. */
export interface IBuildingAsk {
  stationId: string;
  words: string;
  by: 'SHEET' | 'TALK';
}

export interface IHubTech {
  /** Written backwards from what people know. Nothing a player can read until it is reached. */
  chain: IChainWeb;
  workshops: IWorkshop[];
  asks: Record<string, IBuildingAsk>;
  /** How a person's chain stands: written to the ground, or a round still owed. */
  resolving: Record<string, { closed: boolean; calls: number; refused?: string }>;
  /** Chain stations the reach has put in the hub's hands, by key. */
  reached: string[];
  /** What each person is, as read when they came home. A later theme does not change it. */
  professions: Record<string, IProfession>;
  /** D119: "a ledger of new things to be generated". What no world has yet, and who needed it. */
  ledger: IMaterialEntry[];
}

export interface IMaterialEntry {
  key: string;
  material: IChainMaterial;
  askedBy: string;
  at: number;
  /** Once a world holds it. It stays on the record. */
  generatedAt?: number;
}

export const emptyTech = (): IHubTech => ({ chain: emptyChain(), workshops: [], asks: {}, resolving: {}, reached: [], professions: {}, ledger: [] });

export const normalTech = (saved?: Partial<IHubTech>): IHubTech => ({ ...emptyTech(), ...saved });

/** Everything that can be raised here: the web's own, and what a chain has written. */
export function hubStations(tech: Pick<IHubTech, 'chain'>, pack: IWebPack = WebBank.current()): IWebStation[] {
  return [
    ...pack.stations,
    ...tech.chain.stations.map(s => ({
      id: s.key, name: s.name, description: s.blurb, connection: { tool: s.tool, material: s.material },
      bill: s.bill, ...stationNumbers(s.bill.length)
    }))
  ];
}

/** A round's new materials go on the ledger, each once, whoever else comes to need it. */
export function addToLedger(tech: IHubTech, round: Pick<IChainRound, 'materials'>, askedBy: string, at: number): IHubTech {
  const held = new Set(tech.ledger.map(e => e.key));
  const fresh = round.materials.filter(m => !held.has(m.key)).map(material => ({ key: material.key, material, askedBy, at }));
  return fresh.length > 0 ? { ...tech, ledger: [...tech.ledger, ...fresh] } : tech;
}

/** What a world's generation still has to take in. */
export const materialsToGenerate = (tech: Pick<IHubTech, 'ledger'>): IChainMaterial[] =>
  tech.ledger.filter(e => !e.generatedAt).map(e => e.material);

// ---------------------------------------------------------------------------
// THE GROUND: what a chain does not have to write
// ---------------------------------------------------------------------------

const RANK_WORDS = new Set<string>(RANKS);
const rankOf = (rank: unknown): ThemeRank => (RANK_WORDS.has(String(rank)) ? String(rank) as ThemeRank : 'F');

/** Everything the hub knows of, by the id a chain names it by. What has a recipe has makers. */
export function groundOf(pack: IWebPack = WebBank.current()): IChainGround {
  const makers = new Map<string, { station?: string; from: { key: string }[] }[]>();
  const add = (id: string, maker: { station?: string; from: { key: string }[] }) => makers.set(id, [...(makers.get(id) ?? []), maker]);
  for (const r of Object.values(RECIPE_DEFINITIONS)) {
    for (const out of r.outputs) add(out.itemId, { from: r.inputs.map(i => ({ key: i.itemId })) });
  }
  for (const r of pack.recipes) {
    for (const out of r.outputs) add(out.itemId, { station: r.requiredStation, from: r.inputs.map(i => ({ key: i.itemId })) });
  }
  const things = [...Object.values(RESOURCE_DEFINITIONS), ...Object.values(CRAFTED_DEFINITIONS)]
    .filter(d => !(d as { junk?: boolean }).junk && !(d.tags ?? []).includes('station'))
    .map(d => ({
      key: d.id, name: d.name, tags: d.tags ?? [], rank: rankOf(d.rank),
      ...(makers.has(d.id) ? { makers: makers.get(d.id) } : {})
    }));
  return {
    things,
    stations: pack.stations.map(s => ({ key: s.id, name: s.name, tool: s.connection.tool, material: s.connection.material })),
    tools: [...new Set(pack.tools.map(t => t.tag))]
  };
}

// ---------------------------------------------------------------------------
// WHAT STANDS
// ---------------------------------------------------------------------------

/** A bench anywhere, a station standing in any room, and whatever a person was given. */
export function standingOf(world: {
  lots: { id: string; structureType: string }[];
  rooms: Record<string, Pick<IRoomState, 'placements'>>;
}, tech: Pick<IHubTech, 'workshops'>): IChainStanding {
  const stations = new Set<string>();
  for (const room of Object.values(world.rooms)) for (const place of room.placements) stations.add(place.item.universalDefinitionId);
  for (const shop of tech.workshops) if (shop.standsAt) for (const s of shop.stations) stations.add(s);
  const bench = stations.has('stn_bench') || world.lots.some(l => l.structureType === 'WORKSHOP') || tech.workshops.some(w => !!w.standsAt);
  return { stations, bench };
}

/** A station whose `after` buildings do not stand counts for nothing yet. */
const passesAfter = (station: IWebStation | undefined, standing: IChainStanding) =>
  (station?.after ?? []).every(id => standing.stations.has(id));

/** What actually runs: stood up, with something it can work. A station no recipe uses runs when it stands. */
export function workingStations(tech: Pick<IHubTech, 'chain'>, ground: IChainGround, standing: IChainStanding, pack: IWebPack = WebBank.current()): Set<string> {
  const { things, stations } = ChainWeb.reached(tech.chain, ground, standing);
  const all = hubStations(tech, pack);
  const out = new Set<string>();
  for (const key of stations) {
    if (!passesAfter(all.find(s => s.id === key), standing)) continue;
    const makers = [
      ...tech.chain.goods.filter(g => g.station === key),
      ...ground.things.flatMap(t => (t.makers ?? []).filter(m => m.station === key))
    ];
    if (makers.length === 0 || makers.some(m => m.from.every(line => things.has(line.key)))) out.add(key);
  }
  return out;
}

// ---------------------------------------------------------------------------
// WHAT A PERSON WANTS, AND WHAT GIVING IT ASKS
// ---------------------------------------------------------------------------

/** The station a person's own road ends at: the last step of what they know. */
export function wantedStation(profession: IProfession, tech: Pick<IHubTech, 'chain'>, residentId: string, ask?: IBuildingAsk): string | null {
  if (ask) return ask.stationId;
  const way = tech.chain.goods.find(g => g.answers === profession.concept && g.by === residentId && g.station)
    ?? tech.chain.goods.find(g => g.answers === profession.concept && g.station);
  return way?.station ?? profession.stationId ?? null;
}

/** What it would still take to bring about what this person knows. */
export function routeFor(profession: IProfession, tech: Pick<IHubTech, 'chain'>, ground: IChainGround, standing: IChainStanding, residentId?: string): IChainRoute {
  // Their own way first: someone else's way to the same concept is not what they know
  const own = residentId ? tech.chain.goods.find(g => g.answers === profession.concept && g.by === residentId) : undefined;
  if (own) return ChainWeb.route(own.key, tech.chain, ground, standing);
  if (profession.from === 'THEME' && tech.chain.goods.some(g => g.answers === profession.concept)) return ChainWeb.route(profession.concept, tech.chain, ground, standing);
  // Read from their hands, or a chain not written yet: the road to their own station
  const key = profession.stationId;
  if (!key) return { stations: [], steps: [], broken: true };
  const made = ground.things.filter(t => t.makers?.some(m => m.station === key));
  const routes = made.map(t => ChainWeb.route(t.key, tech.chain, ground, standing)).filter(r => !r.broken)
    .sort((a, b) => a.stations.length - b.stations.length || a.steps.length - b.steps.length);
  if (routes[0]) return routes[0].stations.includes(key) || standing.stations.has(key) ? routes[0] : { ...routes[0], stations: [key, ...routes[0].stations] };
  return { stations: standing.stations.has(key) ? [] : [key], steps: [] };
}

/** One bill, lines by tag. Only what does not stand is on it: the order is the player's skill. */
export function billFor(stationIds: string[], tech: Pick<IHubTech, 'chain'>, pack: IWebPack = WebBank.current()): { tag: string; count: number }[] {
  const all = hubStations(tech, pack);
  const lines = new Map<string, number>();
  for (const line of SHELL_BILLS.WORKSHOP) lines.set(line.tag, line.count);
  for (const id of stationIds) {
    for (const line of all.find(s => s.id === id)?.bill ?? []) lines.set(line.tag, (lines.get(line.tag) ?? 0) + line.count);
  }
  return [...lines.entries()].map(([tag, count]) => ({ tag, count }));
}

/** What these stations ask of a room, added up. Higher technology asks for more room (D8). */
export function areaFor(stationIds: string[], tech: Pick<IHubTech, 'chain'>, pack: IWebPack = WebBank.current()): number {
  const all = hubStations(tech, pack);
  return stationIds.reduce((sum, id) => sum + (all.find(s => s.id === id)?.minArea ?? 0), 0);
}

/** The floor a lot's room really holds, inside its walls. */
export const roomAreaOf = (footprint: { width: number; height: number }) => {
  const { w, h } = interiorSize(footprint);
  return (w - 2) * (h - 2);
};

/** D91: "certain buildings will require minimum size". Refused with the numbers. */
export function sizeVerdict(stationIds: string[], footprint: { width: number; height: number }, tech: Pick<IHubTech, 'chain'>, pack: IWebPack = WebBank.current()): { ok: boolean; reason?: string } {
  const need = areaFor(stationIds, tech, pack);
  const holds = roomAreaOf(footprint);
  return need <= holds ? { ok: true } : { ok: false, reason: `That needs ${need} tiles of floor to work; a ${footprint.width}×${footprint.height} lot holds ${holds}.` };
}

// ---------------------------------------------------------------------------
// THE WEB: silent until it is reached
// ---------------------------------------------------------------------------

/** Into the web, unseen. The first keeps the claim; nothing in `nodes` moves, and no record says so. */
export function admitSilently(web: IHubWeb, who: { uid: string; name: string }, skills: Record<string, Parameters<typeof WebSystem.masteryOf>[0]>, at: number): IHubWeb {
  const silent = { ...web.silent };
  for (const skill of WebSystem.heldSkills(skills)) {
    if (web.nodes[skill.id] || silent[skill.id]) continue;
    silent[skill.id] = { id: skill.id, tags: skill.tags, rank: skill.rank ?? 0, rung: WebSystem.masteryOf(skill).rung, by: { uid: who.uid, name: who.name, at } };
  }
  return { ...web, silent };
}

const connects = (tags: string[], station: IWebStation) =>
  station.connection.tool.some(t => tags.includes(t)) && station.connection.material.every(t => tags.includes(t));

export interface IReachEvent {
  skillId: string;
  by: string;
  /** The station it came in by, if one. */
  station?: string;
}

/**
 * Whatever the web now reaches comes out of hiding. A skill that opens a station needs that
 * station working. One that opens nothing comes when its holder has their workshop.
 * A chain's own station joins as a node of whoever was given it.
 */
export function foldReach(web: IHubWeb, tech: IHubTech, ground: IChainGround, standing: IChainStanding, at: number, pack: IWebPack = WebBank.current()): { web: IHubWeb; tech: IHubTech; events: IReachEvent[] } {
  const working = workingStations(tech, ground, standing, pack);
  const all = hubStations(tech, pack);
  const given = new Set(tech.workshops.filter(w => w.standsAt).map(w => w.residentId));
  const nodes = { ...web.nodes };
  const silent = { ...web.silent };
  const events: IReachEvent[] = [];
  const place = (id: string, tags: string[], rank: number, rung: number, credit: { uid: string; name: string; at: number }, station?: string) => {
    const record: IWebNodeRecord = { id, tags, rank, firstBy: credit, rungRecord: { ...credit, rung } };
    nodes[id] = record;
    events.push({ skillId: id, by: credit.name, station });
  };

  for (const record of Object.values(silent)) {
    const stations = all.filter(s => connects(record.tags, s));
    const runs = stations.find(s => working.has(s.id));
    if (!runs && (stations.length > 0 || !given.has(record.by.uid))) continue;
    delete silent[record.id];
    if (!nodes[record.id]) place(record.id, record.tags, record.rank, record.rung, record.by, runs?.id);
  }

  // A chain's own stations are what its people know, and they join the same way
  const reached = new Set(tech.reached);
  for (const station of tech.chain.stations) {
    if (reached.has(station.key) || !working.has(station.key)) continue;
    reached.add(station.key);
    const shop = tech.workshops.find(w => w.standsAt && w.stations.includes(station.key));
    const tags = TagLaw.canonical([station.tool[0], ...station.material]);
    const id = TagLaw.skillIdOf(tags);
    if (!nodes[id] && shop) place(id, tags, 0, 0, { uid: shop.residentId, name: shop.name, at }, station.key);
  }

  return { web: { ...web, nodes, silent }, tech: { ...tech, reached: [...reached] }, events };
}

/** What the hub can raise and work today, with what a chain has brought into reach. */
export function openedChainStations(tech: IHubTech, pack: IWebPack = WebBank.current()): IWebStation[] {
  return hubStations(tech, pack).filter(s => tech.reached.includes(s.id));
}

// ---------------------------------------------------------------------------
// WHAT THE PLAYER MAY READ
// ---------------------------------------------------------------------------

/**
 * Only the next link, never the road. A workshop with nothing to work with says what it lacks,
 * the way a person would. Everything past that stays silent.
 */
export function nextLink(profession: IProfession, tech: Pick<IHubTech, 'chain'>, ground: IChainGround, standing: IChainStanding, pack: IWebPack = WebBank.current(), residentId?: string): IWebStation | null {
  const route = routeFor(profession, tech, ground, standing, residentId);
  if (route.broken) return null;
  const all = hubStations(tech, pack);
  const ordered = route.stations.map(id => all.find(s => s.id === id)).filter((s): s is IWebStation => !!s);
  return ordered[ordered.length - 1] ?? null;
}

/** What a player is told of someone at home: what they are and what they want, and no more. */
export interface IWorkshopOffer {
  residentId: string;
  profession: IProfession;
  stationId: string;
  station: IWebStation;
  /** Every station still missing on their road. Only ever read as a count by a player. */
  route: string[];
  stationBill: { tag: string; count: number }[];
  machineBill: { tag: string; count: number }[];
  stationArea: number;
  machineArea: number;
  /** What their own workshop is short of, when it stands and has nothing to work with. */
  next: IWebStation | null;
  /** Their own station is already standing, so nothing more is asked. */
  stands: boolean;
  /** Someone else's is already given and on its way: raising a second would be paying twice. */
  coming: boolean;
}

export function offerFor(residentId: string, profession: IProfession, tech: IHubTech, ground: IChainGround, standing: IChainStanding, pack: IWebPack = WebBank.current()): IWorkshopOffer | null {
  const stationId = wantedStation(profession, tech, residentId, tech.asks[residentId]);
  const station = stationId ? hubStations(tech, pack).find(s => s.id === stationId) : undefined;
  if (!stationId || !station) return null;
  const road = routeFor(profession, tech, ground, standing, residentId);
  const stands = standing.stations.has(stationId);
  const route = road.broken ? (stands ? [] : [stationId]) : road.stations;
  const machine = route.length > 0 ? route : stands ? [] : [stationId];
  return {
    residentId, profession, stationId, station, route,
    stationBill: billFor([stationId], tech, pack), machineBill: billFor(machine, tech, pack),
    stationArea: areaFor([stationId], tech, pack), machineArea: areaFor(machine, tech, pack),
    next: stands ? nextLink(profession, tech, ground, standing, pack, residentId) : null,
    stands,
    coming: !stands && tech.workshops.some(w => !w.standsAt && w.residentId !== residentId && w.stations.includes(stationId))
  };
}

/** "it's pop count": what a hub's spread comes to, read and never computed further. */
export interface IHubPopulation {
  people: number;
  home: number;
  lodging: number;
  onTheRoad: number;
  working: number;
  machines: number;
  stationsStanding: number;
}

export function hubPopulation(world: {
  residents: { homeAt?: number; lotId: string | null }[];
  craftsmen: unknown[];
}, tech: Pick<IHubTech, 'workshops'>): IHubPopulation {
  const standing = tech.workshops.filter(w => w.standsAt);
  return {
    people: world.residents.length + world.craftsmen.length,
    home: world.residents.filter(r => r.homeAt).length,
    lodging: world.residents.filter(r => !r.homeAt).length,
    onTheRoad: world.craftsmen.length,
    working: new Set(standing.map(w => w.residentId)).size,
    machines: standing.filter(w => w.mode === 'MACHINE').length,
    stationsStanding: new Set(standing.flatMap(w => w.stations)).size
  };
}

