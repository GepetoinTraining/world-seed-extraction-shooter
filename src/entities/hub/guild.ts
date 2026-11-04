/**
 * THE GUILD (D73, D75, D83, D93, D95): the law of the Hall of Banners and the people it
 * houses. A bond brings a person out; they lodge at the tavern; the guild buys them a lot;
 * their house rises through the pooled bill; their wants become quests here.
 *
 * Pure logic over plain data: no store, no clock, no gold moved. The doors are in the hub's
 * store. Patterns read, not ported: the donor's npc-agenda (a need sets a goal, everything
 * after the choice is deterministic). A resident's day stays out of this record, so C2 can
 * give them one without anything here standing in the way.
 *
 * THE GUILD'S MONEY (D108, D115): it spends the hub's treasury, and when that falls short it
 * prints (`money.ts`). The seller of a free lot is that same treasury, so buying moves no gold,
 * and what limits it is how much ground there is, and who has been seen to. A want is paid out
 * of the person's own wallet: "they circulate money". What they cannot afford, they go without,
 * and nobody covers it: "that's the LITERAL MECHANISM OF MASLOW".
 */

import { IAffix, IItem, ISkillState, IWebPack, UniversalRank } from '../../../types';
import { INpcSheet } from '../world/types';
import { ProgressionSystem, RANK_ORDER } from '../player/systems/ProgressionSystem';
import { STRUCTURE_COSTS } from '../economy/data/recipeDefinitions';
import { Rng } from '../../logic/rng/DeterministicRNG';
import { NpcSheet } from '../../logic/systems/NpcSheet';
import { WebBank } from '../../logic/content/WebBank';
import { WebSystem } from '../../logic/systems/WebSystem';
import { ILadderFacts, INpcAgenda, INeedFill, NeedKind, NpcAgenda } from '../../logic/systems/NpcAgenda';
import { ITemplate, ITemplateSheet, SYSTEM_TEMPLATES, defaultSheet, sizeNeedsVerdict, templateBill } from './template';
import type { IClosedWeek } from '../../logic/economy/ShopWeek';

/** Who holds a lot the guild bought. It is nobody's to sell, split or lose. */
export const GUILD_OWNER_ID = 'GUILD';

/** D100: the trade of keeping part of a haul off a world's books. Registered in the web. */
export const TAX_EVASION_TAGS = ['tax_evasion'];

export type BondData = NonNullable<IItem['bondData']>;

export interface IHousePool {
  /** What each tag has been given, and what paid it. Items are gone once given (U14). */
  pool: Record<string, { count: number; consumedIds: string[]; defIds: string[]; inherited?: IAffix[] }>;
  /** The bill was met and the clock started. */
  raised?: boolean;
  /** What the pool paid with, as the plan's material sheet. Set when the bill is met. */
  sheet?: ITemplateSheet;
  templateName: string;
}

export interface IResident {
  id: string;
  /** The bond that brought them out. Its sheet reads back from this, and nothing else. */
  bondItemId: string;
  bond: BondData;
  worldSeed: string;
  entityId: string;
  name: string;
  /** Who brought them out, and who answers for their upkeep (D10). */
  sponsorId: string;
  sponsorName: string;
  arrivedAt: number;
  /** The lot the guild bought for them. Null: still at the tavern. */
  lotId: string | null;
  /** What people brought them before they had ground. It moves in with them. */
  belongings?: IItem[];
  house?: IHousePool;
  /** Someone the road made a master. Their house is the shop they came back for. */
  craftsmanId?: string;
  /** When their house was finished. */
  homeAt?: number;
  /** How many wants they have had met. It keys the next. */
  wantsMet: number;
  /** The world-day their next want can post. */
  nextWantDay?: number;
  /** Q19, Q20: where they stand on the needs ladder, folded by the days they have lived here. Unset: fresh from the day they came. */
  agenda?: INpcAgenda;
  /** The world-day their living is paid through. Unset: nothing owed from before this was kept. */
  livedDay?: number;
  /** Q19: the goal their last talk set. The board reads the rung it answers. */
  goal?: { need: string; text: string; setAt: number };
}

export interface IResidentQuest {
  id: string;
  /** Who wants it. A keeper's id here means no resident stands behind it, and `askerName` says who. */
  residentId: string;
  askerName?: string;
  /** Which of this person's wants this is. */
  n: number;
  tag: string;
  count: number;
  /** What the hub pays against the worth of what is brought. */
  payShare: number;
  text: string;
  state: 'OPEN' | 'DONE';
  postedDay: number;
  /** Q19: the rung of their ladder this want answers. Absent on a want posted before the board read it. */
  need?: string;
}

export interface IHandedMap {
  item: IItem;
  handedBy: string;
  handedByName: string;
  at: number;
}

/**
 * D116: a person asks for the building their goal needs. C5 reads `openBuildingAsks` from the hub's
 * store and answers with `meetBuildingAsk`: nothing here raises anything.
 */
export interface IBuildingAsk {
  id: string;
  askerId: string;
  askerName: string;
  /** A word from `buildingWords`: a station on the hub's web, or a house. */
  building: string;
  /** The goal it is for, in their words, and the rung that goal answers. */
  goal: string;
  need: string;
  day: number;
  state: 'OPEN' | 'MET';
  /** What answered it: a lot, or whatever C5 says. */
  metBy?: string;
}

export interface IGuildState {
  /** How many times this hub has printed, and what it came to. The rows are the record; this is the book. */
  printed: { count: number; total: number };
  /** The world-day the hub has paid its running through. Unset: nothing owed from before this was kept. */
  runningDay?: number;
  /** D115: the week its shelves are open on. Unset: nothing owed from before this was kept. */
  week?: number;
  /** Q33: the day this week's shelf went up: the day the hub opened, then each close. Unset on a hub from before: the week's first day. */
  weekFrom?: number;
  /** How the last week closed, for the Hall's books. */
  lastWeek?: IClosedWeek;
  residents: IResident[];
  quests: IResidentQuest[];
  maps: IHandedMap[];
  /** What was handed over to pass a trial. It stays on the hall's record, and no item is lost. */
  trophies: IItem[];
  /** D116. Absent on a hub saved before people could ask. */
  asks?: IBuildingAsk[];
}

export const emptyGuild = (): IGuildState => ({ printed: { count: 0, total: 0 }, residents: [], quests: [], maps: [], trophies: [] });

/** A saved guild, as it reads today. An older save's book of what it had taken against the treasury is dropped. */
export function guildFrom(saved: Partial<IGuildState> | undefined): IGuildState {
  const { spent: _retired, ...kept } = (saved ?? {}) as Partial<IGuildState> & { spent?: number };
  return { ...emptyGuild(), ...kept };
}

export type ResidentStage = 'TAVERN' | 'POOLING' | 'RISING' | 'HOME';

/** How many wants a human must meet before someone gets ground. A guess until Wave 12. */
const WANTS_BEFORE_GROUND = 1;

/**
 * D115: "they only get a their plot of land by human questing, because we need to provide their
 * needs". Someone the road made a master has been seen to already, and only needs their shop.
 */
export const mayHaveGround = (resident: Pick<IResident, 'wantsMet' | 'craftsmanId'>): boolean =>
  !!resident.craftsmanId || resident.wantsMet >= WANTS_BEFORE_GROUND;

export const residentIdOf = (bond: BondData) => `res_${bond.worldSeed}_${bond.entityId}`;

/** The person, as the world rolled them. Read through the door a bond reads through, every time. */
export function readSheet(resident: Pick<IResident, 'bond'>): INpcSheet {
  return NpcSheet.fromBond({ bondData: resident.bond } as IItem)!;
}

/** Their bond, as a door that reads a bond wants it. It was spent at the tavern, so this is only their paper. */
export function bondItemOf(resident: Pick<IResident, 'bond' | 'bondItemId'>): IItem {
  return { id: resident.bondItemId, bondData: resident.bond } as IItem;
}

export function residentStage(resident: IResident, world: { buildJobs: { lotId: string; applied: boolean }[] }): ResidentStage {
  if (!resident.lotId) return 'TAVERN';
  if (resident.homeAt) return 'HOME';
  return resident.house?.raised || world.buildJobs.some(j => j.lotId === resident.lotId && !j.applied) ? 'RISING' : 'POOLING';
}

// ---------------------------------------------------------------------------
// THE HOUSE (D8): NPCs do not design. A preset plan, a pooled bill.
// ---------------------------------------------------------------------------

/** The biggest house this ground can take, so a dismembered piece still holds one. */
export function houseTemplateFor(footprint: { width: number; height: number }): ITemplate | null {
  return SYSTEM_TEMPLATES
    .filter(t => t.structureType === 'HOUSE' && sizeNeedsVerdict(t, footprint).ok)
    .sort((a, b) => b.footprint.width * b.footprint.height - a.footprint.width * a.footprint.height)[0] ?? null;
}

export const houseTemplateNamed = (name: string): ITemplate | null =>
  SYSTEM_TEMPLATES.find(t => t.structureType === 'HOUSE' && t.name === name) ?? null;

/** The plan's own bill, by tag: anything that answers pays. The sheet is only what the pool gave. */
export function houseBill(tpl: ITemplate): { tag: string; count: number }[] {
  const bill = templateBill(tpl, defaultSheet(tpl));
  const lines = new Map<string, number>();
  for (const line of [...bill.choices, ...bill.tagLines]) lines.set(line.tag, (lines.get(line.tag) ?? 0) + line.count);
  return [...lines.entries()].map(([tag, count]) => ({ tag, count }));
}

/** What the lot and the house's permit come to, for the row and the window. */
export const guildHouseCost = (lotPrice: number) => lotPrice + STRUCTURE_COSTS.HOUSE.build;

// ---------------------------------------------------------------------------
// D10: UPKEEP
// ---------------------------------------------------------------------------

/** A guess until Wave 12: what a person adds to a house's upkeep, by their rank. */
const RESIDENT_UPKEEP_PER_RANK = 2;

export const residentUpkeepPerDay = (rank: UniversalRank | string): number =>
  STRUCTURE_COSTS.HOUSE.upkeepPerDay + RESIDENT_UPKEEP_PER_RANK * (ProgressionSystem.rankIndex(rank as UniversalRank) + 1);

// ---------------------------------------------------------------------------
// Q20: THEIR LIVING AND THEIR WORK. Pedro: the next rung after the house, walked to by goals,
// and "their wallet is paid for their work and pays for their living", through the economy chain.
// ---------------------------------------------------------------------------

/**
 * A day of their own living: what they eat, out of their own wallet, to whoever feeds them. It is
 * the person's part of what a person adds to a house; the house's own part stays the sponsor's (D10).
 */
export const livingPerDay = (rank: UniversalRank | string): number =>
  residentUpkeepPerDay(rank) - STRUCTURE_COSTS.HOUSE.upkeepPerDay;

/**
 * A day of their trade, paid into their wallet by the Hall on its daily books. The same law as an
 * apprentice's week at a bench (ShopWeek.apprenticePay), a day at a time.
 */
export const residentWagePerDay = (rank: UniversalRank | string): number => residentUpkeepPerDay(rank);

/** Someone with a trade, home in their own house, works it there and is paid for it. */
export const residentWorks = (resident: Pick<IResident, 'bond' | 'homeAt' | 'craftsmanId'>): boolean =>
  !!resident.homeAt && !resident.craftsmanId && !!jobOf(readSheet(resident));

const DAY_MS = 86_400_000;
export const arrivalDay = (resident: Pick<IResident, 'arrivedAt'>): number => Math.floor(resident.arrivedAt / DAY_MS);

/** Their ladder as it stands today. A day not yet paid for is a day they went without. */
export const agendaOf = (resident: Pick<IResident, 'agenda' | 'arrivedAt'>, today: number): INpcAgenda =>
  NpcAgenda.fold(resident.agenda ?? NpcAgenda.fresh(arrivalDay(resident)), today);

/** The rung they stand on: the one rung both the talk and the board read (Q19). */
export const residentRung = (resident: Pick<IResident, 'agenda' | 'arrivedAt'>, facts: ILadderFacts, today: number) =>
  NpcAgenda.rung(agendaOf(resident, today), facts);

/** A day whose living was paid: they were fed. */
export const FED: INeedFill = NpcAgenda.fed();

// ---------------------------------------------------------------------------
// THE JOB (line 35): what their hands know, and what the hub gets from it
// ---------------------------------------------------------------------------

export interface IResidentJob {
  skillId: string;
  name: string;
  /** The materials that skill works. */
  worked: string[];
}

const workedBy = (skill: ISkillState, pack: IWebPack) =>
  WebSystem.materialIdentity(skill.tags, pack).filter(t => WebBank.hasKind(pack, t, ['material']));

/** Their best skill: the one with the most work behind it, and the id settles a tie. */
export function jobOf(sheet: INpcSheet, pack: IWebPack = WebBank.current()): IResidentJob | null {
  const skills = Object.values(sheet.skills ?? {});
  if (skills.length === 0) return null;
  const best = [...skills].sort((a, b) => WebSystem.cumulativeXp(b) - WebSystem.cumulativeXp(a) || a.id.localeCompare(b.id))[0];
  return { skillId: best.id, name: WebSystem.nameOf(best.id, pack), worked: workedBy(best, pack) };
}

/** A guess until Wave 12: how much a bench gains from one person home who works its material. */
const BENCH_SHARE_PER_RESIDENT = 0.1;

/** A bench's clock, against the people home in this hub who work what it is working. */
export function benchFactor(residents: Pick<IResident, 'bond' | 'homeAt'>[], pair: { tags: string[] } | null): number {
  if (!pair) return 1;
  const helping = residents.filter(r => r.homeAt && (jobOf(readSheet(r))?.worked ?? []).some(t => pair.tags.includes(t))).length;
  return 1 / (1 + helping * BENCH_SHARE_PER_RESIDENT);
}

// ---------------------------------------------------------------------------
// WANTS (D73): read from the person, keyed, the same on every machine
// ---------------------------------------------------------------------------

/** A guess until Wave 12. Below what a shelf marks a thing up to, above what its counter pays. */
export const PAY_SHARE: Record<INpcSheet['want'], number> = { GOLD: 1, RESPECT: 1.2, GIFT: 1.4 };

const EDIBLE = ['berry', 'fruit', 'grain'];

/** What every house the guild can raise is made of, by tag: what "a house of their own" asks for. */
export function houseTags(): string[] {
  const tags = new Set<string>();
  for (const tpl of SYSTEM_TEMPLATES.filter(t => t.structureType === 'HOUSE')) for (const line of houseBill(tpl)) tags.add(line.tag);
  return [...tags].sort();
}

/**
 * Q19: what answers each rung. Fed is something to eat; a house is what houses are made of; more
 * money than they need is the material their hands work, to sell; a spouse and children, and a goal
 * of their own, are what their sheet says they care for. A guess until Wave 12; Pedro may overrule.
 */
function rungTags(need: NeedKind, worked: string[], byObjective: string): string[] {
  switch (need) {
    case 'survival': return EDIBLE;
    case 'safety': return houseTags();
    case 'esteem': return worked.length > 0 ? worked : [byObjective];
    case 'belonging': return [byObjective];
    case 'purpose': return [byObjective, ...worked.filter(t => t !== byObjective)];
  }
}

const VOICE: Record<INpcSheet['temperament'], (name: string, what: string) => string> = {
  AGGRESSIVE: (name, what) => `${name} wants ${what}, and is not asking twice.`,
  COWARD: (name, what) => `${name} wants ${what}, and would rather not go and get it.`,
  TERRITORIAL: (name, what) => `${name} wants ${what}, for the house and nobody else's.`,
  PASSIVE: (name, what) => `${name} could use ${what}, whenever someone is passing.`,
  OPPORTUNIST: (name, what) => `${name} wants ${what}, and has heard what it fetches.`
};

/**
 * What this person wants. Q19: with the rung they stand on, it answers that rung, so the board and
 * the talk name one want. Without one, as before: the objective on their sheet first, then what
 * their own hands work.
 */
export function wantFor(
  resident: Pick<IResident, 'id' | 'name' | 'bond'>, sheet: INpcSheet, hubId: string, n: number, need?: NeedKind
): { tag: string; count: number; payShare: number; text: string; need?: NeedKind } {
  const rng = Rng.fromKey(`${hubId}:${resident.id}:want:${n}`);
  const worked = jobOf(sheet)?.worked ?? [];
  const byObjective = sheet.objective === 'PROTECT_ASSET' ? 'building'
    : sheet.objective === 'WITNESS' ? 'document'
    : sheet.objective === 'SURVIVE' ? EDIBLE[rng.int(0, EDIBLE.length)]
    : worked[0] ?? 'building';
  // The first is the sheet's own. After that their hands' work comes into it too.
  const tags = need ? rungTags(need, worked, byObjective) : n === 0 ? [byObjective] : [byObjective, ...worked.filter(t => t !== byObjective)];
  const tag = tags[rng.int(0, tags.length)];
  const count = 1 + ProgressionSystem.rankIndex(resident.bond.rank) + rng.int(0, 2);
  const what = `${count} ${count === 1 ? 'thing' : 'things'} marked ${tag.replace(/_/g, ' ')}`;
  return { tag, count, payShare: PAY_SHARE[sheet.want] ?? 1, text: (VOICE[sheet.temperament] ?? VOICE.PASSIVE)(resident.name, what), ...(need ? { need } : {}) };
}

/**
 * A want is for what gets used up. A deed, a map or a plan answers "document" and is a
 * person's standing, so no want takes one, however cheap it reads.
 */
export const wantMayTake = (item: IItem): boolean => !(item.creatureData || item.worldDeedData || item.deedData || item.mapData || item.tags?.includes('template'));

/** What a want met pays: the worth of what was brought, by the person's own want. */
export const questPay = (items: IItem[], payShare: number): number =>
  Math.ceil(items.reduce((sum, i) => sum + Math.max(0, i.value || 0), 0) * payShare);

// ---------------------------------------------------------------------------
// THE TRIAL (D83): the hard quest
// ---------------------------------------------------------------------------

/** A guess until Wave 12: what the first trial asks, and what each rank above adds. */
const TRIAL_BASE_COUNT = 3;

/**
 * THE HARD QUEST: bring out of a gate, yourself, things of a rank above your own, and hand
 * them to the hall. Only ground above your rank gives those, and only you can carry them for
 * yourself. The item's signed record says who brought it through. Nothing else grants a rank.
 */
export function trialFor(rank: UniversalRank | string): { to: UniversalRank; count: number } | null {
  const index = ProgressionSystem.rankIndex(rank as UniversalRank);
  const to = RANK_ORDER[index + 1];
  return to ? { to, count: TRIAL_BASE_COUNT + index } : null;
}

/** Above this rank. An unread piece answers nothing, so this never says its rank aloud. */
export const trialTakes = (item: IItem, rank: UniversalRank | string): boolean =>
  item.isIdentified !== false && ProgressionSystem.rankIndex(item.rank) > ProgressionSystem.rankIndex(rank as UniversalRank);

// ---------------------------------------------------------------------------
// THE MAP'S DOOR (D93): known means a map showing it reached the Hall
// ---------------------------------------------------------------------------

/** One step of a chain, drawn from the holding. How many it takes is the place's own number. */
export interface IChainStep {
  text: string;
  people: number;
}

/** What the chain says it knows, from what the map says. Levels and counts, never a name (D60). */
export interface IChainSeat {
  sector: string;
  ground: string;
  chunks: number;
  anchors: number;
  /** The regeneration it was read in. */
  read: number;
  named?: string;
}

export interface IChainDraft {
  worldId?: string;
  worldName: string;
  sectors: number;
  /** Bodies counted, across what the map holds. */
  mobs: number;
  changed: number;
  /** The sector with the most bodies on it, where a chain would start. */
  hottest: string | null;
  /** What the map's scan regenerations run across. */
  oldest: number;
  newest: number;
  /** Who it is about. Null until a map shows someone holding ground, and only then does it post. */
  seat: IChainSeat | null;
  posted: boolean;
  steps: IChainStep[];
  /** How many regenerations old the reading is, when the Hall knows what regeneration it is. */
  staleBy?: number;
}

type SectorEntry = NonNullable<IItem['mapData']>['sectors'][string];
type HoldingEntry = NonNullable<SectorEntry['holdings']>[number];

const chainSteps = (sector: string, h: HoldingEntry): IChainStep[] => {
  const unfinished = h.marks.filter(m => !m.built).length;
  const outer = h.marks.filter(m => m.built && m.fn !== 'seat' && m.fn !== 'anchor').length;
  const works = outer > 0 ? `${outer} of its outer works` : 'the ground around it';
  return [
    { text: `Read sector ${sector} again, as it stands now. What holds ${h.chunks.length} chunk${h.chunks.length === 1 ? '' : 's'} will not have stood still.`, people: 1 },
    { text: `Take ${works}${unfinished > 0 ? `, and what is still going up` : ''}, and come back with what you learned of its bands.`, people: 1 },
    { text: `Put someone at each of its ${h.anchors} anchors at one moment. One person cannot be in ${h.anchors} places.`, people: Math.max(2, h.anchors) },
    { text: 'Bring down who sits there, and carry its stores out through everything still standing.', people: Math.max(2, h.anchors) }
  ];
};

/** Only a boss posts a chain. A camp still going up is on a person's map, and the Hall has nothing to ask of it yet. */
const postable = (e: SectorEntry): HoldingEntry[] => (e.holdings ?? []).filter(h => h.anchors > 0);

const seatFrom = (sector: string, h: HoldingEntry): IChainSeat => ({
  sector, ground: h.seat, chunks: h.chunks.length, anchors: h.anchors, read: h.generation, ...(h.named ? { named: h.named } : {})
});

/**
 * What the Hall holds, from every map handed to it: the newest reading of each sector, whichever came
 * in first (D93). A newer map updates it, one that shows the ground empty closes it, and an older
 * map never reopens it. Nothing else posts: seeing is not enough, and neither is saying so.
 */
export function chainFromMaps(maps: NonNullable<IItem['mapData']>[], generationNow: number): IChainDraft[] {
  const newest = new Map<string, { entry: SectorEntry; map: NonNullable<IItem['mapData']> }>();
  for (const map of maps) {
    for (const [sector, entry] of Object.entries(map.sectors)) {
      const key = `${map.worldId}:${sector}`;
      const had = newest.get(key);
      const readAt = (e: SectorEntry) => Math.max(e.generation, ...(e.holdings ?? []).map(h => h.generation));
      if (!had || readAt(entry) > readAt(had.entry)) newest.set(key, { entry, map });
    }
  }
  const chains: IChainDraft[] = [];
  for (const [key, { entry, map }] of [...newest.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const sector = key.slice(map.worldId.length + 1);
    for (const holding of postable(entry)) {
      chains.push({
        ...chainFromMap({ ...map, sectors: { [sector]: { ...entry, holdings: [holding] } } }),
        worldId: map.worldId,
        staleBy: Math.max(0, generationNow - holding.generation)
      });
    }
  }
  return chains;
}

/** What this map would post, read from what it holds: levels and counts, never a name (D60). */
export function chainFromMap(map: NonNullable<IItem['mapData']>): IChainDraft {
  const entries = Object.entries(map.sectors);
  const mobsIn = (e: typeof entries[number][1]) => e.contacts?.MOB ?? 0;
  const hottest = [...entries].sort((a, b) => mobsIn(b[1]) - mobsIn(a[1]) || a[0].localeCompare(b[0]))[0]?.[0] ?? null;
  const generations = entries.map(([, e]) => e.generation);
  const held = entries
    .flatMap(([sector, e]) => postable(e).map(h => ({ sector, h })))
    .sort((a, b) => b.h.chunks.length - a.h.chunks.length || a.sector.localeCompare(b.sector))[0];
  return {
    worldName: map.worldName,
    sectors: entries.length,
    mobs: entries.reduce((sum, [, e]) => sum + mobsIn(e), 0),
    changed: entries.reduce((sum, [, e]) => sum + (e.changed ?? 0), 0),
    hottest,
    oldest: generations.length > 0 ? Math.min(...generations) : 0,
    newest: generations.length > 0 ? Math.max(...generations) : 0,
    seat: held ? seatFrom(held.sector, held.h) : null,
    posted: !!held,
    steps: held ? chainSteps(held.sector, held.h) : []
  };
}
