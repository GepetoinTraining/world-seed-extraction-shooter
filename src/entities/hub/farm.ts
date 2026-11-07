/**
 * THE FARM (D11, D63; lines 36, 37): plant what you harvested, leave, come back, and harvest it.
 *
 * Pedro: "farmland requires an exclusive chunk, you make the whole chunk farmland, we're not
 * animals, and then the hub portions it off as a perfect farmland that has equal spacing". So
 * the land is `hubManifest`'s chunk, and this is what happens on one plot of it.
 *
 * Pure logic over plain data: no store, no clock, no gold. Time is handed in, and a planting
 * holds only when it was set, so nothing runs while a person is away and every machine reads
 * the same stage. Farming mints items and never gold. The doors are in `farmDoors.ts`.
 *
 * What a person can read to buy from a farm, and what a person who runs one does, is here too,
 * for the walking stream: `sellers` and `tendOrder`. Nothing here walks.
 */

import { IItem, UniversalRank } from '../../../shared/types';
import { RESOURCE_DEFINITIONS, ResourceDef } from '../../../shared/entities/item/data/resourceDefinitions';
import { IKoseki } from '../../../shared/entities/world/Koseki';
import { Rng } from '../../../shared/logic/rng/DeterministicRNG';
import { LoadoutSystem } from '../../../shared/entities/player/systems/LoadoutSystem';
import { answersTag } from '../../../shared/entities/hub/room';
import type { IHomeHerd } from './herd';
import type { IPlayerLot } from './store';

/** A bed is two tiles a side, so a plot's beds stand as evenly as its chunk's plots do. */
export const BED_TILES = 2;

/** A world regrows on its own clock. A kept bed takes this many times as long as the wild does, read from the material. A guess until Wave 12. */
const PATIENCE = 40;
/** A grove bears again faster than it first took. A guess until Wave 12. */
const REBEAR_SHARE = 0.5;
/** What the skill adds to a yield, per level, as a keyed share. No top. A guess until Wave 12. */
const SKILL_PER_LEVEL = 0.05;

/** What is kept and bears again rather than sown each time: the forms that stand. */
const GROVE_TAGS = ['wood', 'berry', 'fruit'];

export interface IPlanting {
  defId: string;
  name: string;
  /** The piece that went into the ground. */
  seedItemId: string;
  /** How many plantings stand behind what this one yields. */
  plantings: number;
  /** Where its line first came from, in the seed's own words. */
  firstOrigin: string;
  plantedAt: number;
  readyAt: number;
  /** A grove stays where it stands, and goes on bearing. */
  grove: boolean;
  bears: number;
}

export interface ICookJob {
  id: string;
  queuedAt: number;
  finishesAt: number;
  /** What went in. The meal mints from these when someone looks. */
  items: IItem[];
  ownerCertUid: string;
}

export interface IFarm {
  lotId: string;
  /** By the bed's number, its top-left corner for what takes more than one. */
  beds: Record<number, IPlanting>;
  /** A person in the city who runs it. Their day comes later: what they do here is `tendOrder`. */
  tender?: string;
  hearth?: boolean;
  cooking?: ICookJob[];
}

export interface IFarmland {
  farms: Record<string, IFarm>;
  herds: IHomeHerd[];
  /** Whose body stands on whose register, by person. A person heads their own (D65). */
  registers: Record<string, IKoseki>;
  /** How many tries at crossing two kinds have been had here: it keys the next. */
  crossTries?: number;
}

export const emptyFarmland = (): IFarmland => ({ farms: {}, herds: [], registers: {} });

/** A farm's history, ridden by what it yields. A piece keeps it wherever it goes (line 37). */
export type FarmLine = NonNullable<IItem['farmLine']>;

const tagsOf = (def: ResourceDef) => def.tags ?? [];

export class Farm {

  static empty(lotId: string): IFarm {
    return { lotId, beds: {} };
  }

  /** The beds a plot this size holds. More ground holds more, and no number stops it. */
  static gridOf(size: { width: number; height: number }): { cols: number; rows: number } {
    return { cols: Math.floor(size.width / BED_TILES), rows: Math.floor(size.height / BED_TILES) };
  }

  /** Whether this piece will take root: a living thing, as it was gathered. */
  static plantVerdict(item: IItem): { ok: boolean; reason?: string } {
    const def = RESOURCE_DEFINITIONS[item.universalDefinitionId];
    const named = LoadoutSystem.shownName(item);
    if (!def || !tagsOf(def).includes('flora') || !def.regrowMs) return { ok: false, reason: `${named} will not grow. It stays what it is.` };
    if ((item.composition?.steps?.length ?? 0) > 0) return { ok: false, reason: `${named} has been worked, and it will not take root now.` };
    return { ok: true };
  }

  static isGrove(def: ResourceDef): boolean {
    return tagsOf(def).some(t => GROVE_TAGS.includes(t));
  }

  /** How long a material takes in the ground: what the land already says, kept patiently. */
  static growMs(def: ResourceDef): number {
    return (def.regrowMs ?? 0) * PATIENCE;
  }

  static planting(item: IItem, def: ResourceDef, now: number): IPlanting {
    return {
      defId: def.id,
      name: def.name,
      seedItemId: item.id,
      plantings: (item.farmLine?.plantings ?? 0) + 1,
      firstOrigin: item.farmLine?.firstOrigin ?? item.composition?.materials[0]?.origin ?? 'HARVEST',
      plantedAt: now,
      readyAt: now + this.growMs(def),
      grove: this.isGrove(def),
      bears: 0
    };
  }

  static ripeAt(p: IPlanting): number {
    return p.readyAt;
  }

  /** 0 when it went in, 1 when it can be taken. It reads the time, and only the time. */
  static growth(p: IPlanting, now: number): number {
    const span = p.readyAt - p.plantedAt;
    if (span <= 0) return 1;
    return Math.max(0, Math.min(1, (now - p.plantedAt) / span));
  }

  /** How many beds a side it takes. A tree stands wider than what is sown or a shrub. */
  static spanOf(p: Pick<IPlanting, 'defId'>): number {
    return tagsOf(RESOURCE_DEFINITIONS[p.defId] ?? ({} as ResourceDef)).includes('wood') ? 2 : 1;
  }

  /** The beds this planting takes, set at this one. */
  private static cellsOf(at: number, span: number, cols: number): number[] {
    const out: number[] = [];
    for (let r = 0; r < span; r++) for (let c = 0; c < span; c++) out.push(at + r * cols + c);
    return out;
  }

  static fitVerdict(farm: IFarm, size: { width: number; height: number }, p: Pick<IPlanting, 'defId'>, at: number): { ok: boolean; reason?: string } {
    const { cols, rows } = this.gridOf(size);
    const span = this.spanOf(p);
    const col = at % cols, row = Math.floor(at / cols);
    if (at < 0 || row >= rows) return { ok: false, reason: 'There is no such bed.' };
    if (col + span > cols || row + span > rows) return { ok: false, reason: 'It would not fit there. A tree wants more ground around it.' };
    const taken = new Set<number>();
    for (const [key, standing] of Object.entries(farm.beds)) this.cellsOf(Number(key), this.spanOf(standing), cols).forEach(c => taken.add(c));
    if (this.cellsOf(at, span, cols).some(c => taken.has(c))) return { ok: false, reason: 'Something is growing there already.' };
    return { ok: true };
  }

  /** What a bed gives when it is taken: what the wild gives for a whole node, by key, and more for a practised hand. */
  static yieldOf(p: IPlanting, def: ResourceDef, key: string, skillLevel = 0): number {
    const rng = Rng.fromKey(`farm:yield:${key}:${p.plantedAt}:${p.bears}`);
    const [low, high] = def.yieldPerUse ?? [1, 1];
    let count = 0;
    for (let i = 0; i < (def.uses ?? 1); i++) count += rng.int(low, high);
    const extra = count * skillLevel * SKILL_PER_LEVEL;
    return Math.max(1, count + Math.floor(extra + rng.next()));
  }

  /** What is left in the ground after taking: a grove goes on, and what was sown is gone. */
  static afterReap(p: IPlanting, def: ResourceDef, now: number): IPlanting | null {
    if (!p.grove) return null;
    return { ...p, plantedAt: now, readyAt: now + this.growMs(def) * REBEAR_SHARE, bears: p.bears + 1 };
  }

  static lineOf(p: IPlanting, lotId: string, bed: number, now: number, seedName: string): FarmLine {
    return { lotId, bed, seedItemId: p.seedItemId, seedName, plantings: p.plantings, firstOrigin: p.firstOrigin, plantedAt: p.plantedAt, reapedAt: now };
  }

  /** A piece's history, in words, from what it carries. */
  static historyOf(item: IItem): string[] {
    const line = item.farmLine;
    const lines: string[] = [];
    if (line) {
      // A plot's sign counts from one, and its id from nothing
      lines.push(`Off bed ${line.bed + 1} of plot ${Number(line.lotId.replace('poi_lot_', '')) + 1}.`);
      lines.push(`From ${line.seedName}, ${line.plantings === 1 ? 'the first planting' : `${line.plantings} plantings on`} from what was ${line.firstOrigin === 'HARVEST' ? 'gathered by hand' : line.firstOrigin.toLowerCase()}.`);
    }
    for (const m of item.composition?.materials ?? []) {
      if (!line) lines.push(`${m.count > 1 ? `${m.count} of ` : ''}${m.name}, ${m.origin.toLowerCase()}.`);
    }
    for (const step of item.composition?.steps ?? []) lines.push(`${step.name}${step.facility ? ` at ${step.facility.toLowerCase()}` : ''}.`);
    return lines;
  }

  /** What a store holds, by material, every piece kept apart: its real grain. */
  static byMaterial(items: IItem[]): { defId: string; name: string; pieces: IItem[] }[] {
    const groups = new Map<string, { defId: string; name: string; pieces: IItem[] }>();
    for (const item of items) {
      const group = groups.get(item.universalDefinitionId) ?? { defId: item.universalDefinitionId, name: LoadoutSystem.shownName(item), pieces: [] };
      group.pieces.push(item);
      groups.set(item.universalDefinitionId, group);
    }
    return [...groups.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  }

  // ---------------------------------------------------------------------------
  // WHAT A PERSON READS. The walking stream's door: a need looks here for who to walk to.
  // ---------------------------------------------------------------------------

  /** Who is selling something that answers this tag, off a farm's stand. Cheapest first. */
  static sellers(lots: IPlayerLot[], tag: string): { lotId: string; ownerName: string | null; listing: { item: IItem; price: number } }[] {
    return lots
      .filter(l => l.structureType === 'FARM' && l.ownerId)
      .flatMap(l => (l.shopListings ?? []).filter(li => answersTag(li.item, tag)).map(listing => ({ lotId: l.id, ownerName: l.ownerName, listing })))
      .sort((a, b) => a.listing.price - b.listing.price || (a.listing.item.id < b.listing.item.id ? -1 : 1));
  }

  /** Ground a house can stand on. A plot is not: farmland is exclusive. */
  static groundForHouses<T extends { ownerId: string | null; structureType: string }>(lots: T[]): T[] {
    return lots.filter(l => !l.ownerId && l.structureType === 'EMPTY');
  }

  /** What whoever runs a plot does when they next look: take what is ripe, and set the same thing back. */
  static tendOrder(farm: IFarm, now: number): number[] {
    return Object.entries(farm.beds)
      .filter(([, p]) => this.growth(p, now) >= 1)
      .map(([bed]) => Number(bed))
      .sort((a, b) => a - b);
  }

  /** The rank a bed's work is worth to a skill. */
  static rankOf(def: ResourceDef): UniversalRank {
    return (def.rank ?? UniversalRank.F) as UniversalRank;
  }

  /** The plot is gone: what grew on it goes with it. What had been brought to its hearth comes back. */
  static clear(farmland: IFarmland, lotId: string): { farmland: IFarmland; items: IItem[] } {
    const farm = farmland.farms[lotId];
    if (!farm) return { farmland, items: [] };
    const { [lotId]: _gone, ...farms } = farmland.farms;
    return { farmland: { ...farmland, farms }, items: (farm.cooking ?? []).flatMap(j => j.items) };
  }
}
