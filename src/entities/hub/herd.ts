/**
 * THE HERD AT HOME (D63, D64, D65; the herding half of line 152).
 *
 * A body brought home is kept until it is domesticated, which takes days of being fed (D84: time
 * is the real resource). After that it is a head in a count, and a birth changes that count
 * and writes no name, as on the land. What it eats is what is in its trough, so more food
 * carries more bodies and nothing else stops them.
 *
 * Who holds a herd is a word on it, `holder`, and nothing here reads what that holder is. A
 * plot holds one today. The monster rancher, when it stands, holds one by `moveTo`.
 *
 * Pure and keyed: a day is folded one at a time, so N days at once is N days apart. Nothing
 * here reads a clock.
 */

import { IItem } from '../../../types';
import { fnv1a } from '../../logic/rng/DeterministicRNG';
import { LAND_NUMBERS, bodyNumbers } from '../../logic/theme/ThemeFormula';
import { Capture, ICaged } from '../../logic/systems/Capture';
import { ILineProof } from '../../logic/theme/CreatureLines';
import { LootTable } from '../world/LootTable';
import { Population } from '../world/Population';
import { Rng } from '../../logic/rng/DeterministicRNG';
import { CompositionSystem } from '../../logic/economy/CompositionSystem';
import { ItemType, Rarity, SlotType, UniversalRank } from '../../../types';
import type { IFarmland } from './farm';

export interface IHerdHolder {
  type: 'plot' | 'building';
  id: string;
}

/** A body being kept: not yet a head, and it eats like one. */
export interface IKeptBody {
  body: string;
  gender: string;
  /** Fed days so far. A hungry day does not count. */
  fedDays: number;
  needs: number;
}

export interface IHomeHerd {
  id: string;
  kind: string;
  /** The definition as it stood when it was caught, so a herd needs no world open to be read. */
  def: Record<string, unknown>;
  /** The proof of its line (D55, D65). It goes with any head that leaves. */
  proof: ILineProof;
  holder: IHerdHolder;
  /** How many heads, domesticated. A count. */
  head: number;
  /** Bodies the register holds by name. Births add none. */
  bodies: string[];
  keeping: IKeptBody[];
  foldedDay: number;
  trough: IItem[];
  /** What is left of what it last began to eat. */
  opened: number;
  /** How many have left in a cage: it keys the next one's name. */
  caged: number;
}

/** How a day's rolls are keyed. A share of a count, with what the floor drops carried by a keyed roll, as on the land. */
const shareOf = (x: number, u: number) => Math.floor(x + u);
const rollFor = (seed: string, herd: string, day: number, purpose: string) => fnv1a(`herd:${seed}:${herd}:${day}:${purpose}`) / 0x100000000;

const RANK_ORDER = Object.values(UniversalRank);
/** How much harder a nature makes a body to keep, in days. A guess until Wave 12. */
const WARINESS: Record<string, number> = { PASSIVE: 2, NEUTRAL: 3 };
const WARINESS_ELSE = 6;

/** What one thing feeds, by what it is. The land reads food the same way (`foodFrom`). */
const FEED_FOOD = 4;
const FEED_FLORA = 2;

/** A birth takes plenty: the trough has to hold this many days for all of them, or nothing is born. A guess until Wave 12. */
const PLENTY_DAYS = 7;
/** What a body gives when it is taken, against what it eats. A guess until Wave 12. */
const MEAT_PER_APPETITE = 2;

export class Herd {

  static start(holder: IHerdHolder, cage: ICaged, today: number): IHomeHerd {
    const herd: IHomeHerd = {
      id: `herd_${holder.id}_${fnv1a(cage.kind).toString(36)}`,
      kind: cage.kind, def: cage.def, proof: cage.proof, holder,
      head: 0, bodies: [], keeping: [], foldedDay: today, trough: [], opened: 0, caged: 0
    };
    return this.admit(herd, cage);
  }

  /** A cage comes home. The body in it is kept from here, and is not yet a head. */
  static admit(herd: IHomeHerd, cage: ICaged): IHomeHerd {
    const kept: IKeptBody = { body: cage.body, gender: cage.gender, fedDays: 0, needs: this.daysToKeep(cage.def) };
    return { ...herd, keeping: [...herd.keeping, kept], bodies: [...herd.bodies, cage.body] };
  }

  /** Days of feeding before a body answers to home: by how wary it is, and how high it stands. */
  static daysToKeep(def: { behavior?: unknown; rank?: unknown }): number {
    const wary = WARINESS[String(def.behavior)] ?? WARINESS_ELSE;
    return wary + Math.max(0, RANK_ORDER.indexOf(def.rank as UniversalRank));
  }

  static worthOf(item: IItem): number {
    const tags = item.tags ?? [];
    return tags.includes('food') ? FEED_FOOD : tags.includes('flora') ? FEED_FLORA : 0;
  }

  static feed(herd: IHomeHerd, items: IItem[]): IHomeHerd {
    return { ...herd, trough: [...herd.trough, ...items.filter(i => this.worthOf(i) > 0)] };
  }

  /** How many pairs its heads make: the lesser of two genders, read by key. */
  static pairsOf(herd: Pick<IHomeHerd, 'id' | 'head'>, seed: string): number {
    if (herd.head < 2) return 0;
    let first = 0;
    for (let i = 0; i < herd.head; i++) if (Population.genderOf(`home:${seed}`, `${herd.id}_${i}`) === 'female') first++;
    return Math.min(first, herd.head - first);
  }

  /** One day passes. */
  private static step(herd: IHomeHerd, day: number, seed: string): IHomeHerd {
    const { appetite, birthRate } = bodyNumbers(herd.def as { size?: string; speed?: number });
    const mouths = (herd.head + herd.keeping.length) * appetite;
    if (mouths <= 0) return { ...herd, foldedDay: day };

    const trough = [...herd.trough];
    let opened = herd.opened;
    while (opened < mouths && trough.length > 0) opened += this.worthOf(trough.shift()!);
    const fed = Math.min(1, opened / mouths);
    opened = Math.max(0, opened - mouths * fed);

    const keeping: IKeptBody[] = [];
    let head = herd.head;
    for (const kept of herd.keeping) {
      const fedDays = kept.fedDays + (fed >= 1 ? 1 : 0);
      if (fedDays >= kept.needs) head++;
      else keeping.push({ ...kept, fedDays });
    }

    // A birth takes plenty. Short of it a herd holds, and then thins, as on the land.
    const pairs = this.pairsOf({ id: herd.id, head: herd.head }, seed);
    const laid = trough.reduce((sum, item) => sum + this.worthOf(item), opened);
    const plenty = fed >= 1 && laid >= mouths * PLENTY_DAYS;
    const born = plenty ? shareOf(pairs * birthRate, rollFor(seed, herd.id, day, 'born')) : 0;
    const starved = fed < 1 ? Math.min(herd.head, shareOf(herd.head * (1 - fed) * LAND_NUMBERS.starve, rollFor(seed, herd.id, day, 'starved'))) : 0;
    return { ...herd, head: head + born - starved, keeping, trough, opened, foldedDay: day };
  }

  /** Up to today, a day at a time, so it does not matter how often anyone looks. */
  static fold(herd: IHomeHerd, today: number, seed: string): IHomeHerd {
    let at = herd;
    for (let day = herd.foldedDay + 1; day <= today; day++) at = this.step(at, day, seed);
    return at;
  }

  // ---------------------------------------------------------------------------
  // WHO HOLDS IT. The building's door.
  // ---------------------------------------------------------------------------

  static moveTo(herd: IHomeHerd, holder: IHerdHolder): IHomeHerd {
    return { ...herd, holder };
  }

  static heldBy(herds: IHomeHerd[], holder: IHerdHolder): IHomeHerd[] {
    return herds.filter(h => h.holder.type === holder.type && h.holder.id === holder.id);
  }

  // ---------------------------------------------------------------------------
  // WHAT COMES OF A HEAD
  // ---------------------------------------------------------------------------

  /** A head taken for what it gives: meat by its size, and what a body of its kind leaves. No gold. */
  static slaughter(herd: IHomeHerd, mobDef: Parameters<typeof LootTable.generateLoot>[0], key: string): { herd: IHomeHerd; items: IItem[] } {
    if (herd.head <= 0) return { herd, items: [] };
    const { appetite } = bodyNumbers(herd.def as { size?: string; speed?: number });
    const rng = Rng.fromKey(`herd:meat:${key}`);
    const cuts = Math.max(1, Math.round(appetite * MEAT_PER_APPETITE));
    const meat = Array.from({ length: cuts }, () => this.cut(rng.int(0, 0xffffffff).toString(16).padStart(8, '0'), mobDef.rank as UniversalRank));
    const dropped = LootTable.generateLoot(mobDef, 1, undefined, `herd:loot:${key}`).filter(i => i.isIdentified !== false);
    return { herd: { ...herd, head: herd.head - 1 }, items: [...meat, ...dropped] };
  }

  /** Meat is meat, whatever it came from, so a masked kind stays masked. */
  private static cut(id: string, rank: UniversalRank): IItem {
    return {
      id: `itm_meat_${id}`, universalDefinitionId: 'res_meat', name: 'Meat', description: 'Fresh, and it will not improve.',
      type: ItemType.RESOURCE, slot: SlotType.NONE, rank, rarity: Rarity.COMMON, quality: 0, level: 1,
      value: 3 * (1 + Math.max(0, RANK_ORDER.indexOf(rank))), itemPower: 0, tags: ['food', 'meat'], affixes: [],
      dimensions: { width: 1, height: 1 }, weight: 0.5, stats: {}, visuals: { modelId: 'resource', colorHex: '#9ca3af' }, icon: 'resource_icon',
      history: { dropDate: 0, killCount: 0 }, isIdentified: true,
      composition: CompositionSystem.root({ id: 'res_meat', name: 'Meat' }, 'FARMED')
    } as IItem;
  }

  /** A head leaves in a cage, with the proof it came with. Its name is new, so a register can hold it. */
  static cageOne(herd: IHomeHerd, seed: string, by: string, generation: number, worldUid: string): { herd: IHomeHerd; cage: ICaged } | null {
    if (herd.head <= 0) return null;
    const body = `${herd.id}_c${herd.caged}`;
    return {
      herd: { ...herd, head: herd.head - 1, caged: herd.caged + 1 },
      cage: Capture.cage({ body, kind: herd.kind, seed: `home:${seed}`, generation, worldUid, by, proof: herd.proof })
    };
  }

  /** The ground is gone. Nothing alive is lost: every body comes away caged. */
  static clearHolder(cleared: { farmland: IFarmland; items: IItem[] }, holder: IHerdHolder): { farmland: IFarmland; items: IItem[] } {
    const held = this.heldBy(cleared.farmland.herds, holder);
    if (held.length === 0) return cleared;
    const items = [...cleared.items];
    for (const herd of held) {
      let at = herd;
      for (const kept of herd.keeping) {
        items.push(Capture.cageItem(Capture.cage({ body: kept.body, kind: herd.kind, seed: 'home', generation: 0, worldUid: 'home', by: 'home', proof: herd.proof }), `clear:${kept.body}`));
      }
      for (let next = this.cageOne(at, 'home', 'home', 0, 'home'); next; next = this.cageOne(at, 'home', 'home', 0, 'home')) {
        items.push(Capture.cageItem(next.cage, `clear:${next.cage.body}`));
        at = next.herd;
      }
      items.push(...herd.trough);
    }
    return { farmland: { ...cleared.farmland, herds: cleared.farmland.herds.filter(h => !held.includes(h)) }, items };
  }
}
