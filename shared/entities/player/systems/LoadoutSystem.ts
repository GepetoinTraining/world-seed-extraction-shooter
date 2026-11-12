/**
 * LOADOUT SYSTEM (Wave 10C)
 *
 * The slot tree's pure law. Every function here is (state in, answer out);
 * the player store owns state, the paper-doll renders, this file decides.
 *
 * The laws it holds:
 *  - 10C.1  every slot holds what it should and refuses what it should not,
 *           with the reason, in the bank's voice
 *  - 10C.2  stat requirements against the fifteen attributes, refused with
 *           the numbers
 *  - D22    the head budget: HEAD, EYES, EARRING and NECKLACE each hold gear
 *           OR a cognitive frame, three frames at most — and the stat
 *           partition: mental stats come ONLY from frames, never from gear.
 *           Mental stats also drive the recon phase (reconEfficiency).
 *  - 10C.3  the weight law: the harness weighs nothing against the carry
 *           limit; bags extend capacity; the belt opens pouch slots
 *  - D19    the knowledge stub: the sheet is blind to unstudied affixes,
 *           while the affixes act. 10E replaces the stub with real study.
 */

import {
  IItem, IPlayer, IAttributes, ItemType, SlotType, UniversalRank,
  BODY_SLOT_IDS, BodySlotId, EquipSlotId, HeadPositionId, HEAD_BUDGET_POSITIONS,
  MAX_FRAMES, MENTAL_ATTRIBUTES, TOOL_SLOT_COUNT, toolSlotIds, pouchSlotIds,
  IEquipmentState, ICognitiveFrame
} from '../../../types';
import { COGNITIVE_FRAMES } from '../data/cognitiveFrames';
import { InventorySystem } from './InventorySystem';
import { isThrowable } from '../../item/Throwable';
import { StatSystem } from '../../../logic/systems/StatSystem';

export interface Verdict {
  ok: boolean;
  reason?: string;
}

const OK: Verdict = { ok: true };
const no = (reason: string): Verdict => ({ ok: false, reason });

const RANK_ORDER: UniversalRank[] = [
  UniversalRank.F, UniversalRank.E, UniversalRank.D, UniversalRank.C,
  UniversalRank.B, UniversalRank.A, UniversalRank.S, UniversalRank.SS, UniversalRank.SSS
];

const isTool = (item: IItem): boolean =>
  item.slot === SlotType.TOOL || !!item.toolData || (item.tags || []).includes('tool');

/** The pace in nothing at all, in tiles per second. Field and city walk alike. */
export const BASE_WALK_TILES_PER_S = 4.0;
/** Call 10: what each heavy piece worn takes from the walk, as a share: a heavy chest and a heavy weapon walk 3.6. A guess until played. */
export const HEAVY_PACE = 0.05;
/** However bad the gear, a person still walks. A floor, not a ceiling: nothing caps the top. */
const MIN_WALK_SCALE = 0.1;

/** Q13: the two words the item factory once wrote into a name, before the card's bands were the one scale. */
const LEGACY_QUALITY_WORD = /\b(?:Broken|Superior)\s+/g;

export class LoadoutSystem {

  /**
   * The pace what you wear gives you. `movement_speed` on any worn piece adds up
   * (0.10 is ten percent), an unstudied one acting like any other. Load, the tow
   * bar and the ground scale this afterward. Agility adds in the same way. Each tonic drunk since the
   * last rest takes a little more of it (Pedro, 2026-11-11: tonics "give debuffs as side effects").
   */
  /**
   * The fight's law (part 3): what pace is worn and trained for is read on a curve, b / (1 + b), approaching twice a
   * walk and never arriving, so nothing needs a top; what slows (a penalty, each heavy piece worn, by its word) is taken
   * straight. Tiles a second read no rank.
   */
  static walkTilesPerSecond(equipment?: IEquipmentState, attributes?: IAttributes, tonics = 0): number {
    const worn = new Set(Object.values(equipment?.slots ?? {}));
    let gain = StatSystem.paceBonus(attributes);
    let cost = 0;
    for (const item of equipment?.items ?? []) {
      if (!worn.has(item.id)) continue;
      const stats = item.stats ?? {};
      if (stats.maxDurability && stats.durability === 0) continue; // broken gear does nothing
      gain += stats.movement_speed ?? 0;
      cost += stats.movement_speed_penalty ?? 0;
      // Call 10: weight costs pace. A piece that says it is heavy costs its share of the walk
      if ((item.tags ?? []).includes('heavy')) cost -= HEAVY_PACE;
    }
    const curved = gain >= 0 ? gain / (1 + gain) : gain;
    return BASE_WALK_TILES_PER_S * Math.max(MIN_WALK_SCALE, 1 + curved + cost) * (1 - StatSystem.tonicSlow(tonics));
  }

  /** A person's own walk: what they wear, their agility, and the tonics they drank since they last rested. */
  static walkOf(person: { equipment?: IEquipmentState; attributes?: IAttributes; tonicsSinceRest?: number }): number {
    return this.walkTilesPerSecond(person.equipment, person.attributes, person.tonicsSinceRest);
  }

  /**
   * What a piece may be called aloud: until it is read, it has no name to say.
   * Q13: quality is the card's to say, on its five bands. A name stored before that rule may still carry
   * the factory's old word, so it is read without it. Zero durability says "Broken" on the card's own row.
   */
  static shownName(item: IItem): string {
    return item.isIdentified === false ? 'Unidentified Signal' : item.name.replace(LEGACY_QUALITY_WORD, '').trim();
  }

  /** The refusal for working what has not been read. It says nothing of what the thing is. */
  static unreadRefusal(item: IItem): Verdict {
    return item.isIdentified === false ? no(`This signal won't answer until it's read.`) : OK;
  }

  static emptyEquipment(): IEquipmentState {
    return { slots: {}, items: [], frames: {}, protected: [] };
  }

  // ---------------------------------------------------------------------
  // THE TREE: what each slot accepts
  // ---------------------------------------------------------------------

  /** Every slot that exists right now: the body, the tool slots, and the worn belt's pouch slots. */
  static availableSlots(equipment?: IEquipmentState): EquipSlotId[] {
    const slots: EquipSlotId[] = [...BODY_SLOT_IDS, ...toolSlotIds(TOOL_SLOT_COUNT)];
    const belt = equipment ? this.itemIn(equipment, 'BELT') : undefined;
    if (belt?.beltData) slots.push(...pouchSlotIds(belt.beltData.pouchSlots));
    return slots;
  }

  /** Does this slot take this item? The refusal names the slot and the reason. */
  static slotAccepts(slotId: EquipSlotId, item: IItem): Verdict {
    // C14: a stone to throw is cargo that a hand, either one, can also hold
    if (isThrowable(item)) {
      return slotId === 'RIGHT_HAND' || slotId === 'LEFT_HAND' ? OK
        : no(`${this.shownName(item)} is for a hand to throw. Nothing else on the body holds it.`);
    }
    if (item.slot === SlotType.NONE && !isTool(item)) {
      return no(`${this.shownName(item)} is cargo, not gear. No slot on the body takes it.`);
    }

    if (slotId.startsWith('TOOL_')) {
      return isTool(item) ? OK
        : no(`The tool loop holds tools. ${this.shownName(item)} isn't one.`);
    }
    if (slotId.startsWith('POUCH_')) {
      return item.pouchData ? OK
        : no(`A pouch knows what it stacks. ${this.shownName(item)} doesn't.`);
    }

    const body = slotId as BodySlotId;
    switch (body) {
      case 'HEAD': return item.slot === SlotType.HEAD ? OK : no(`The HEAD takes a helm. ${this.shownName(item)} won't stay on.`);
      case 'EYES': return item.slot === SlotType.EYES ? OK : no(`The EYES take lenses. ${this.shownName(item)} would only blind you.`);
      case 'RIGHT_HAND':
        return item.slot === SlotType.MAIN_HAND ? OK : no(`The right hand wants a weapon or focus. ${this.shownName(item)} is neither.`);
      case 'LEFT_HAND':
        if (item.slot === SlotType.OFF_HAND) return OK;
        if (item.slot === SlotType.MAIN_HAND && (item.tags || []).includes('one_hand')) return OK;
        if (item.slot === SlotType.MAIN_HAND) return no(`${this.shownName(item)} wants both hands. The left can't hold it alone.`);
        return no(`The left hand guards or balances. ${this.shownName(item)} does neither.`);
      case 'CHEST': return item.slot === SlotType.CHEST ? OK : no(`The CHEST wears armor. ${this.shownName(item)} wouldn't cover much.`);
      case 'LEGS': return item.slot === SlotType.LEGS ? OK : no(`The LEGS wear armor. ${this.shownName(item)} isn't cut for them.`);
      case 'BOOTS': return item.slot === SlotType.FEET ? OK : no(`BOOTS are for feet. ${this.shownName(item)} doesn't walk.`);
      case 'SHOULDER': return item.slot === SlotType.SHOULDER ? OK : no(`The SHOULDER carries a mantle. ${this.shownName(item)} would slide off.`);
      case 'BAG': return item.slot === SlotType.BAG && !item.pouchData ? OK
        : item.pouchData ? no(`A pouch rides the belt, not the back.`)
        : no(`The back takes a pack. ${this.shownName(item)} has no straps.`);
      case 'NECKLACE': return item.slot === SlotType.NECKLACE ? OK : no(`The NECKLACE hangs from the neck. ${this.shownName(item)} has no chain.`);
      case 'EARRING': return item.slot === SlotType.EARRING ? OK : no(`An EARRING hangs from the ear. ${this.shownName(item)} would tear it off.`);
      case 'RING_1':
      case 'RING_2': return item.slot === SlotType.RING ? OK : no(`A finger takes a ring. ${this.shownName(item)} doesn't fit around one.`);
      case 'QUIVER': return item.slot === SlotType.QUIVER ? OK : no(`The QUIVER rides the back and holds arrows. ${this.shownName(item)} holds none.`);
      case 'BELT': return item.slot === SlotType.BELT ? OK : no(`The BELT goes around the waist. ${this.shownName(item)} won't buckle.`);
    }
    return no(`No such slot: ${slotId}.`);
  }

  /** The default home for an item, honoring what is already worn (rings find the free finger). */
  static slotForItem(item: IItem, equipment?: IEquipmentState): EquipSlotId | null {
    // C14: a stone to throw takes whichever hand is free, the right first, so it can ride beside a blade
    if (isThrowable(item)) return equipment?.slots.RIGHT_HAND && !equipment.slots.LEFT_HAND ? 'LEFT_HAND' : 'RIGHT_HAND';
    if (isTool(item) && !item.pouchData) {
      for (const t of toolSlotIds(TOOL_SLOT_COUNT)) if (!equipment?.slots[t]) return t;
      return toolSlotIds(TOOL_SLOT_COUNT)[0];
    }
    if (item.pouchData) {
      const pouches = this.availableSlots(equipment).filter(s => s.startsWith('POUCH_'));
      for (const p of pouches) if (!equipment?.slots[p]) return p;
      return (pouches[0] as EquipSlotId) ?? null;
    }
    switch (item.slot) {
      case SlotType.HEAD: return 'HEAD';
      case SlotType.EYES: return 'EYES';
      case SlotType.MAIN_HAND: return 'RIGHT_HAND';
      case SlotType.OFF_HAND: return 'LEFT_HAND';
      case SlotType.CHEST: return 'CHEST';
      case SlotType.LEGS: return 'LEGS';
      case SlotType.FEET: return 'BOOTS';
      case SlotType.SHOULDER: return 'SHOULDER';
      case SlotType.BAG: return 'BAG';
      case SlotType.NECKLACE: return 'NECKLACE';
      case SlotType.EARRING: return 'EARRING';
      case SlotType.RING: return !equipment?.slots['RING_1'] ? 'RING_1' : 'RING_2';
      case SlotType.QUIVER: return 'QUIVER';
      case SlotType.BELT: return 'BELT';
      case SlotType.ACCESSORY: return null; // legacy non-tool accessory: no home; tools were caught above
      default: return null;
    }
  }

  static itemIn(equipment: IEquipmentState, slotId: EquipSlotId): IItem | undefined {
    const id = equipment.slots[slotId];
    return id ? equipment.items.find(i => i.id === id) : undefined;
  }

  // ---------------------------------------------------------------------
  // 10C.2 REQUIREMENTS: refused in voice, with the numbers
  // ---------------------------------------------------------------------

  /**
   * Requirements derive deterministically from rank and tags when the item
   * carries none of its own. F-rank gear asks 1 — a newborn answers it.
   */
  static requirementsFor(item: IItem): Partial<IAttributes> {
    if (item.requirements) return item.requirements;
    if (item.slot === SlotType.NONE && !isTool(item)) return {};
    const idx = Math.max(0, RANK_ORDER.indexOf(item.rank));
    const need = 1 + idx * 2;
    const tags = item.tags || [];
    const stat: keyof IAttributes =
      tags.includes('heavy') || tags.includes('two_hand') ? 'strength'
      : tags.includes('caster') || tags.includes('magic') || tags.includes('energy_shield') ? 'focus'
      : tags.includes('tech') ? 'engineering'
      : tags.includes('ranged') || tags.includes('projectile') ? 'dexterity'
      : tags.includes('one_hand') || tags.includes('blade') ? 'dexterity'
      : tags.includes('light') || tags.includes('evasion') ? 'agility'
      : isTool(item) ? 'strength'
      : item.slot === SlotType.CHEST || item.slot === SlotType.HEAD || item.slot === SlotType.LEGS ? 'constitution'
      : 'strength';
    return { [stat]: need };
  }

  /** The refusal carries the attribute and both numbers. That is the whole message. */
  static checkRequirements(attributes: IAttributes, item: IItem): Verdict {
    const reqs = this.requirementsFor(item);
    for (const [attr, need] of Object.entries(reqs)) {
      const have = (attributes as any)[attr] ?? 0;
      if (have < (need as number)) {
        return no(`Refused: ${this.shownName(item)} asks ${attr.toUpperCase()} ${need}; you hold ${have}.`);
      }
    }
    return OK;
  }

  // ---------------------------------------------------------------------
  // D22: THE STAT PARTITION — mental stats only ever ride a frame
  // ---------------------------------------------------------------------

  /**
   * The law 10E's banks inherit: a mental attribute on physical gear makes the
   * item invalid. Simulation stats (attack_speed, armor…) are not attributes
   * and pass freely; the partition guards the fifteen.
   */
  static validateStatPartition(item: IItem): Verdict {
    const mental = new Set<string>(MENTAL_ATTRIBUTES as readonly string[]);
    const carries = (stats: Record<string, number>) =>
      Object.keys(stats).find(k => mental.has(k));

    const inBase = carries(item.stats as any ?? {});
    if (inBase) return no(`${item.name} promises ${inBase.toUpperCase()}, and gear doesn't think. Thinking is frame-work.`);
    for (const affix of item.affixes || []) {
      const hit = carries(affix.stats || {});
      if (hit) return no(`"${affix.name}" promises ${hit.toUpperCase()}, and gear doesn't think. Thinking is frame-work.`);
    }
    return OK;
  }

  // ---------------------------------------------------------------------
  // D22: THE HEAD BUDGET
  // ---------------------------------------------------------------------

  static frameAt(equipment: IEquipmentState, position: HeadPositionId): ICognitiveFrame | undefined {
    const id = equipment.frames[position];
    return id ? COGNITIVE_FRAMES[id] : undefined;
  }

  static frameCount(equipment: IEquipmentState): number {
    return HEAD_BUDGET_POSITIONS.filter(p => equipment.frames[p]).length;
  }

  /** Can a frame take this position? Gear cancels it; three frames at most. */
  static canSlotFrame(equipment: IEquipmentState, position: HeadPositionId, frameId: string): Verdict {
    if (!COGNITIVE_FRAMES[frameId]) return no(`No such frame: ${frameId}.`);
    const gear = this.itemIn(equipment, position);
    if (gear) return no(`${position} holds ${this.shownName(gear)}. Mind or matter; not both in one place.`);
    const worn = this.frameCount(equipment);
    const replacing = !!equipment.frames[position];
    if (!replacing && worn >= MAX_FRAMES) {
      return no(`Three frames is all one mind can hold. The fourth position keeps its gear.`);
    }
    return OK;
  }

  // ---------------------------------------------------------------------
  // THE ONE DOOR: can this item go on this slot, all laws asked at once
  // ---------------------------------------------------------------------

  static canEquip(player: IPlayer, item: IItem, slotId: EquipSlotId): Verdict {
    const equipment = player.equipment ?? this.emptyEquipment();

    if (!this.availableSlots(equipment).includes(slotId)) {
      return no(slotId.startsWith('POUCH_')
        ? `No pouch slot ${slotId.split('_')[1]} — the belt decides how many there are.`
        : `No such slot: ${slotId}.`);
    }

    const fits = this.slotAccepts(slotId, item);
    if (!fits.ok) return fits;

    // D22: a frame-held position refuses gear
    if ((HEAD_BUDGET_POSITIONS as string[]).includes(slotId)) {
      const frame = this.frameAt(equipment, slotId as HeadPositionId);
      if (frame) return no(`${slotId} holds the ${frame.name} — a cognitive frame. Mind or matter; not both in one place.`);
    }

    // 10C.2: requirements with the numbers. The D22 partition is NOT asked
    // here: it is a stat law (attributes only ever come from frames — gear
    // has no pathway into the mind, see recalcAttributes) and a bank law
    // (validateStatPartition, which 10E's content validation inherits).
    // Contraband gear wears fine; its mental line is simply dead.
    return this.checkRequirements(player.attributes, item);
  }

  // ---------------------------------------------------------------------
  // 10C.3: THE WEIGHT LAW
  // ---------------------------------------------------------------------

  /** What the body carries. It does not count against the limit — that is the law. */
  static harnessWeight(equipment: IEquipmentState): number {
    return parseFloat(equipment.items.reduce((s, i) =>
      s + (i.weight || 0) + (i.pouchData?.contents.reduce((p, c) => p + (c.weight || 0), 0) ?? 0), 0).toFixed(1));
  }

  /** The one carry limit: what strength lifts, what the bag adds, and what worn gear adds (line 77, B1). */
  static carryLimit(strength: number, equipment?: IEquipmentState): number {
    // The rarity rescale: carrying is one key; an old bag's `carry_bonus_kg` is read as the same load
    return InventorySystem.maxCarryWeight(strength) + StatSystem.total(equipment, 'carry_bonus_kg') + StatSystem.total(equipment, 'carry_capacity');
  }

  /** Bags extend capacity: the worn BAG's carry bonus, in kg. */
  /** What a piece adds to a load, on the one key or an old bag's. */
  static carryOf(item: IItem): number {
    return (item.stats?.carry_bonus_kg ?? 0) + (item.stats?.carry_capacity ?? 0);
  }

  static bagCapacityBonus(equipment?: IEquipmentState): number {
    if (!equipment) return 0;
    const bag = this.itemIn(equipment, 'BAG');
    return bag ? this.carryOf(bag) : 0;
  }

  // ---------------------------------------------------------------------
  // D17: POUCHES — a pouch stacks only what its rule names
  // ---------------------------------------------------------------------

  static canStow(pouch: IItem, item: IItem): Verdict {
    if (!pouch.pouchData) return no(`${this.shownName(pouch)} has no stacking rule. It is not a pouch.`);
    const { accepts, capacity, contents } = pouch.pouchData;
    const tags = [item.type.toLowerCase(), ...(item.tags || [])];
    if (!accepts.some(a => tags.includes(a.toLowerCase()))) {
      return no(`${this.shownName(pouch)} stacks only ${accepts.join(', ')}. ${this.shownName(item)} is not that.`);
    }
    if (contents.length >= capacity) {
      return no(`${this.shownName(pouch)} holds ${capacity} and holds ${capacity} only. It is full.`);
    }
    return OK;
  }

  // ---------------------------------------------------------------------
  // D19: the sheet is blind to the unstudied; the item acts regardless
  // ---------------------------------------------------------------------

  /**
   * Has this player studied this affix? Wave 10E made the 10C stub real: a
   * studied affix is one filed in materialMastery's discoveredAffixes by the
   * study law (StudySystem.reveal — a workstation sitting or a timed field
   * identify). No player at hand means nothing is studied: the screen never
   * learned the bad habit of showing what was not.
   */
  static isAffixStudied(player: IPlayer | undefined, affixId: string): boolean {
    if (!player?.materialMastery) return false;
    for (const knowledge of Object.values(player.materialMastery)) {
      if (knowledge.discoveredAffixes?.includes(affixId)) return true;
    }
    return false;
  }

  /**
   * What the SHEET may show: the item's stats minus every unstudied affix's
   * contribution. The acting stats stay merged in item.stats — only the sheet
   * is blind. A wholly unidentified item shows nothing at all.
   */
  static visibleItemStats(item: IItem, player?: IPlayer): Record<string, number> {
    if (item.isIdentified === false) return {};
    const visible: Record<string, number> = {};
    for (const [k, v] of Object.entries(item.stats || {})) {
      if (typeof v === 'number') visible[k] = v;
    }
    for (const affix of item.affixes || []) {
      if (this.isAffixStudied(player, affix.id)) continue;
      for (const [k, v] of Object.entries(affix.stats || {})) {
        if (typeof visible[k] === 'number') {
          const stripped = parseFloat((visible[k] - v).toFixed(4));
          if (stripped === 0) delete visible[k];
          else visible[k] = stripped;
        }
      }
    }
    return visible;
  }

  // ---------------------------------------------------------------------
  // D22: MENTAL STATS DRIVE THE RECON PHASE
  // ---------------------------------------------------------------------

  /**
   * Scan depth per click. Intelligence, perception and focus — and ONLY they —
   * deepen the survey: the analyst build earns its keep before the drop.
   * Base attributes of 1 give 1; a framed analyst reaches 2 and beyond.
   */
  static reconEfficiency(attributes: IAttributes): number {
    const mentalReach = (attributes.intelligence ?? 1) + (attributes.perception ?? 1) + (attributes.focus ?? 1);
    return 1 + Math.max(0, Math.floor((mentalReach - 3) / 6));
  }

  // ---------------------------------------------------------------------
  // MIGRATION: Wave 4's three buckets come in, without loss, idempotently
  // ---------------------------------------------------------------------

  /**
   * Builds equipment from a legacy session's `equipped` buckets: the items
   * move from the pack grid to the harness (the weight law applies to them at
   * once). Also mirrors legacy floatMemory frames into head positions.
   * Pure: returns a new player; running it twice changes nothing.
   */
  static migrate(player: IPlayer): IPlayer {
    let equipment: IEquipmentState = player.equipment
      ? { slots: { ...player.equipment.slots }, items: [...player.equipment.items], frames: { ...player.equipment.frames }, protected: [...(player.equipment.protected ?? [])] }
      : this.emptyEquipment();
    let session = player.currentSession;

    // 1. The three buckets, if a legacy session still carries them
    if (session?.equipped) {
      const buckets = session.equipped;
      const inventory = [...session.inventory];
      const layout = { ...(session.inventoryLayout || {}) };
      const move = (itemId: string | undefined, prefer?: EquipSlotId) => {
        if (!itemId) return;
        const idx = inventory.findIndex(i => i.id === itemId);
        if (idx === -1) return;
        const item = inventory[idx];
        const slot = prefer ?? this.slotForItem(item, equipment);
        if (!slot || equipment.slots[slot]) return; // occupied or homeless: it stays in the pack
        inventory.splice(idx, 1);
        delete layout[itemId];
        equipment = {
          ...equipment,
          slots: { ...equipment.slots, [slot]: item.id },
          items: [...equipment.items, item]
        };
      };
      move(buckets.mainHand, 'RIGHT_HAND');
      const armorItem = session.inventory.find(i => i.id === buckets.armor);
      move(buckets.armor, armorItem ? (this.slotForItem(armorItem, equipment) ?? 'CHEST') : 'CHEST');
      move(buckets.accessory); // tools find the TOOL slot by their own nature
      session = { ...session, inventory, inventoryLayout: layout, equipped: undefined };
    }

    // 2. Legacy float memory frames flow into free head positions (first three)
    const hasPositions = HEAD_BUDGET_POSITIONS.some(p => equipment.frames[p]);
    if (!hasPositions && player.floatMemory?.some(Boolean)) {
      const frames: Partial<Record<HeadPositionId, string>> = {};
      const free = HEAD_BUDGET_POSITIONS.filter(p => !this.itemIn(equipment, p));
      let placed = 0;
      for (const frame of player.floatMemory) {
        if (!frame || placed >= MAX_FRAMES || placed >= free.length) continue;
        frames[free[placed]] = frame.id;
        placed++;
      }
      equipment = { ...equipment, frames };
    }

    return { ...player, equipment, currentSession: session };
  }

  // ---------------------------------------------------------------------
  // D16: towing costs speed (the cart system asks here so there is one law)
  // ---------------------------------------------------------------------

  /**
   * Towing always costs; more when loaded past what this cart bears; never below the floor, so a cart can
   * always move. The interface pass, 2026-11-11: each cart bears its own load (ears, from its size and
   * quality), where every cart once slowed on one line from its first kilo; a cart that names none still does.
   */
  static towSpeedModifier(cartWeightKg: number, bearsKg = 0): number {
    return Math.max(0.4, 0.75 - Math.max(0, cartWeightKg - bearsKg) / 400);
  }

  /** 10C.1: the SHOULDER piece is themed per genre — the same slot, a different coat. */
  static themedShoulderName(genreName: string): string {
    const THEMES: Record<string, string> = {
      FANTASY: 'Woven Cape',
      SCIFI: 'Pauldron Rig',
      POSTAPOC: 'Scrap Spaulder',
      ELDRITCH: 'Whispering Shroud',
      RETRO: 'Padded Letterman'
    };
    return THEMES[genreName.toUpperCase().replace(/[^A-Z]/g, '')] ?? 'Mantle';
  }
}

// -----------------------------------------------------------------------------
// THE PAPER-DOLL LAYOUT: position and shape, stable for the keyboard
// -----------------------------------------------------------------------------

export interface PaperDollCell {
  slot: EquipSlotId;
  x: number;  // grid columns (the component scales)
  y: number;
  w: number;
  h: number;
}

/**
 * Where each slot sits on the doll. Position IS the code (colourblind law):
 * the head column runs down the middle, hands flank it, jewelry sits right,
 * tools stand apart at the bottom left. Order is the keyboard traversal.
 */
export function paperDollLayout(toolCount: number = TOOL_SLOT_COUNT): PaperDollCell[] {
  const cells: PaperDollCell[] = [
    { slot: 'HEAD',      x: 3, y: 0, w: 2, h: 2 },
    { slot: 'EYES',      x: 3, y: 2, w: 2, h: 1 },
    { slot: 'EARRING',   x: 6, y: 0, w: 1, h: 1 },
    { slot: 'NECKLACE',  x: 6, y: 1, w: 1, h: 1 },
    { slot: 'SHOULDER',  x: 1, y: 1, w: 2, h: 1 },
    { slot: 'RIGHT_HAND', x: 0, y: 3, w: 2, h: 3 },
    { slot: 'CHEST',     x: 3, y: 3, w: 2, h: 3 },
    { slot: 'LEFT_HAND', x: 6, y: 3, w: 2, h: 3 },
    { slot: 'BAG',       x: 8, y: 1, w: 2, h: 2 },
    { slot: 'QUIVER',    x: 8, y: 4, w: 1, h: 2 },
    { slot: 'BELT',      x: 3, y: 6, w: 2, h: 1 },
    { slot: 'RING_1',    x: 0, y: 7, w: 1, h: 1 },
    { slot: 'RING_2',    x: 1, y: 7, w: 1, h: 1 },
    { slot: 'LEGS',      x: 3, y: 7, w: 2, h: 2 },
    { slot: 'BOOTS',     x: 3, y: 9, w: 2, h: 1 }
  ];
  for (let i = 0; i < toolCount; i++) {
    cells.push({ slot: `TOOL_${i + 1}` as EquipSlotId, x: 6 + i, y: 7, w: 1, h: 2 });
  }
  return cells;
}
