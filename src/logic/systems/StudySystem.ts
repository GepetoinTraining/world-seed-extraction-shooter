/**
 * THE STUDY LAW (Wave 10E.2 — D19, decided by Pedro)
 *
 * Equipping shows no visible change for what you have not studied — knowledge
 * gain IS the mechanic, and the unstudied affix acts regardless: equip at your
 * own peril. Identify is an acquirable SKILL, scoped by item type: study that
 * type, time and again, to earn it. Q27 (2026-11-04): the field try is gone, and
 * nothing is read before town. An unread piece is read only through the eye for
 * its kind (`canRead`); without it, studying the piece teaches the eye.
 *
 * This file ties into the machinery that already exists, never beside it:
 *  - the scoped skill is an ISkillState in bank.universalSkills (D6's track)
 *  - what an affix was banked as, once studied, lands in materialMastery's
 *    discoveredAffixes (the knowledge-level machinery)
 *  - a finished identify sets the item's own isIdentified flag
 * LoadoutSystem.isAffixStudied reads the same record, so the sheet and the
 * card agree by construction.
 *
 * STUDY FOR LORE (D118) is the wider action. Pedro: "You can study anything and everything",
 * "it's an interacrtion logged and resolved by LLM... meaning it's literally always
 * available, but, it costs energy", and "roll based, failure damages it, major failure
 * loses it, major win doubles the amount gained". So a sitting pays up front, rolls when it
 * ends, does its damage then, and goes on the log for a dream to resolve (LoreSystem).
 * The roll is the law's: a model is told how it went and never decides it.
 */

import { IItem, IPlayer, IStudyMark, IStudySitting, IStudyTarget, ItemType, SlotType, StudyOutcome, UniversalRank } from '../../../shared/types';
import { LoadoutSystem, Verdict } from '../../../shared/entities/player/systems/LoadoutSystem';
import { ProgressionSystem } from '../../../shared/entities/player/systems/ProgressionSystem';
import { RESOURCE_DEFINITIONS } from '../../../shared/entities/item/data/resourceDefinitions';
import { Rng } from '../../../shared/logic/rng/DeterministicRNG';
import { StatSystem } from '../../../shared/logic/systems/StatSystem';

/** The raw materials leg (D26) adds two: goods that carry a process, and furniture. */
export type IdentifyScope = 'weapon' | 'armor' | 'tool' | 'material' | 'furniture';

/** Workstation study: the time one sitting takes, on the record. */
export const STUDY_SECONDS = 20;
/** Field identify: the base clock at skill level 1. It NEVER reaches zero. */
export const IDENTIFY_BASE_SECONDS = 12;
export const IDENTIFY_FLOOR_SECONDS = 2;
/** D32: what a field attempt costs. A guess until Wave 12. Half again if no eye is schooled at all. */
export const IDENTIFY_ENERGY = 10;
const WINGING_FACTOR = 1.5;
const ok: Verdict = { ok: true };
const no = (reason: string): Verdict => ({ ok: false, reason });

/** D118: what is asked of a sitting on something at the person's own rank. Guesses until Wave 12, like all of these. */
export const STUDY_DC_BASE = 8;
/** Each rank the thing stands above the person. */
export const STUDY_DC_PER_RANK = 3;
/** Each failure it already carries. */
export const STUDY_DC_PER_HARM = 2;
/** How far from what was asked makes it major. */
export const STUDY_MAJOR_MARGIN = 10;
/** A failure takes this share of a piece's durability. */
export const STUDY_WEAR_SHARE = 0.25;
/** What has no durability loses this much quality, and this share of its worth. */
export const STUDY_QUALITY_BITE = 0.1;
export const STUDY_WORTH_BITE = 0.1;
/** Lost, for what cannot be taken away: how many days it will not sit for you. */
export const STUDY_LOST_DAYS = 7;

const OUTCOME_LADDER: StudyOutcome[] = ['major_failure', 'failure', 'success', 'major_win'];

/** What is raw until someone works it: everything else was made by somebody. */
const RAW_TYPES: ItemType[] = [ItemType.RESOURCE, ItemType.COMMODITY, ItemType.LORE, ItemType.DEED, ItemType.TEMPLATE];
/** What a piece asks when nothing says what made it: the general bench, which reads anything. */
const GENERAL_STATION = 'WORKSHOP';

export interface IStudyRoll { d20: number; total: number; dc: number; outcome: StudyOutcome }

export class StudySystem {

  /** The scope a piece belongs to. Cargo has no scope: nothing to identify. */
  static identifyScopeOf(item: IItem): IdentifyScope | null {
    const tags = item.tags || [];
    if (item.toolData || item.slot === SlotType.TOOL || tags.includes('tool')) return 'tool';
    // a cart kit is a working rig, not a coat: the tool eye reads it (found in play)
    if (item.cartData) return 'tool';
    if (item.type === ItemType.STRUCTURE) return 'furniture';
    // A material with something worked or dreamed into it holds a riddle. Plain cargo does not.
    if (item.type !== ItemType.GEAR) return (item.affixes?.length ?? 0) > 0 ? 'material' : null;
    if (item.slot === SlotType.MAIN_HAND || item.slot === SlotType.OFF_HAND || tags.includes('weapon')) return 'weapon';
    return 'armor';
  }

  static scopeSkillId(scope: IdentifyScope): string {
    return `skill_identify_${scope}`;
  }

  /** The trained level for this item's scope. 0 = the skill was never earned. */
  static identifyLevel(player: IPlayer, item: IItem): number {
    const scope = this.identifyScopeOf(item);
    if (!scope) return 0;
    return player.bank.universalSkills[this.scopeSkillId(scope)]?.level ?? 0;
  }

  /**
   * Q27 (Pedro, 2026-11-04): "identify is a SKILL ... things CANNOT be ided until town, study is what
   * gives you the ability, study unided items and you start to figure out how to identify". A piece
   * nobody has read can be read only by someone holding the eye for its kind. Studying is how the eye is had.
   */
  static canRead(player: IPlayer, item: IItem): boolean {
    return item.isIdentified !== false || this.identifyLevel(player, item) >= 1;
  }

  /** ALWAYS timed: the clock falls with skill and stops at the floor, never zero. */
  static identifySeconds(level: number): number {
    const l = Math.max(1, level);
    return Math.max(IDENTIFY_FLOOR_SECONDS, Math.round(IDENTIFY_BASE_SECONDS / (1 + 0.5 * (l - 1))));
  }

  /** D32: anyone may try on anything with a riddle in it. The roll is the refusal. */
  static canFieldIdentify(player: IPlayer, item: IItem): Verdict {
    const scope = this.identifyScopeOf(item);
    if (!scope) return no(`${LoadoutSystem.shownName(item)} holds no maker's riddle. There is nothing to identify.`);
    return ok;
  }

  /** The best eye this person has, in any scope. */
  private static bestEye(player: IPlayer): number {
    const scopes: IdentifyScope[] = ['weapon', 'armor', 'tool', 'material', 'furniture'];
    return Math.max(0, ...scopes.map(s => player.bank.universalSkills[this.scopeSkillId(s)]?.level ?? 0));
  }

  /**
   * D32: what an attempt costs and how long it takes. What has not been read gives
   * away nothing by its price: it is asked of the person's best eye, never of the
   * piece. A piece already read, with something unstudied on it, asks its own scope.
   */
  static identifyAsk(player: IPlayer, item: IItem): { cost: number; seconds: number } {
    return this.askAt(player, item.isIdentified === false ? this.bestEye(player) : this.identifyLevel(player, item));
  }

  private static askAt(player: IPlayer, level: number): { cost: number; seconds: number } {
    // Line 77: glasses shorten the clock. Skill and gear make it quick, never instant.
    const eyes = 1 + Math.max(0, StatSystem.total(player.equipment, 'field_analysis_speed') + StatSystem.signalEyes(player.attributes));
    return {
      cost: level < 1 ? Math.ceil(IDENTIFY_ENERGY * WINGING_FACTOR) : IDENTIFY_ENERGY,
      seconds: Math.max(IDENTIFY_FLOOR_SECONDS, Math.round(this.identifySeconds(level) / eyes))
    };
  }

  // -----------------------------------------------------------------------
  // STUDY FOR LORE (D118): what can be aimed at. Each says only what the screen shows.
  // -----------------------------------------------------------------------

  /** Was this made by somebody? A plank is, and a log is not. */
  static isFinished(item: IItem): boolean {
    return (item.composition?.depth ?? 0) > 0 || !RAW_TYPES.includes(item.type);
  }

  /**
   * Pedro: "Finished products should have the button to be studied IF you have a workstation
   * for it". What made it says which; improvised work had none, so it asks for none. An unread
   * piece asks for nothing, whatever it is, so the button tells nothing (D32), and a newcomer with
   * no bench can still begin learning the eye (C6, by the study ruling: always available, for energy).
   * Nothing is read before town all the same (Q27): StudyDoor keeps it out of the field.
   */
  static stationAsked(item: IItem): string | null {
    if (item.isIdentified === false) return null;
    if (!this.isFinished(item)) return null;
    const steps = item.composition?.steps ?? [];
    return steps.length > 0 ? steps[steps.length - 1].facility : GENERAL_STATION;
  }

  static targetOfItem(item: IItem): IStudyTarget {
    const hidden = item.isIdentified === false;
    const station = this.stationAsked(item);
    return {
      kind: 'item', ref: item.id, name: LoadoutSystem.shownName(item), tags: hidden ? [] : [...(item.tags ?? [])],
      rank: item.rank, hidden, ...(station ? { station } : {}),
      // C8 reads this: what studying junk opens is the black dungeon arc's, and is not decided here.
      junk: !!RESOURCE_DEFINITIONS[item.universalDefinitionId]?.junk || (item.tags ?? []).includes('junk')
    };
  }

  static targetOfPerson(person: { id: string; name: string; title?: string; tags?: string[]; rank?: UniversalRank }): IStudyTarget {
    return { kind: 'person', ref: person.id, name: person.title ? `${person.name}, ${person.title}` : person.name, tags: person.tags ?? [], rank: person.rank };
  }

  /** D60: `displayName` is what the screen said. A masked name stays masked, and the definition is only a key. */
  static targetOfCreature(creature: { definitionId: string; displayName?: string; rank?: UniversalRank; tags?: string[] }): IStudyTarget {
    return { kind: 'creature', ref: creature.definitionId, name: creature.displayName ?? 'Unknown Contact', tags: creature.tags ?? [], rank: creature.rank };
  }

  static targetOfBuilding(building: { id: string; name: string; tags?: string[] }): IStudyTarget {
    return { kind: 'building', ref: building.id, name: building.name, tags: building.tags ?? [] };
  }

  static targetOfPlace(name: string, tags: string[] = [], rank?: UniversalRank): IStudyTarget {
    return { kind: 'place', ref: name, name, tags, rank };
  }

  /** Something that stands beside you in the field: a chest, a seam, a plant. */
  static targetOfThing(thing: { id: string; name: string; tags?: string[]; rank?: UniversalRank }): IStudyTarget {
    return { kind: 'thing', ref: thing.id, name: thing.name, tags: thing.tags ?? [], rank: thing.rank };
  }

  /** Whatever a person typed: anything at all. With nothing in front of them it stands at the lowest rank. */
  static targetOfWords(words: string): IStudyTarget {
    const said = words.trim().replace(/\s+/g, ' ');
    return { kind: 'thing', ref: said.toLowerCase(), name: said, tags: [], rank: UniversalRank.F };
  }

  static keyOf(target: Pick<IStudyTarget, 'kind' | 'ref'>): string {
    return `${target.kind}:${target.ref}`;
  }

  static markOf(player: IPlayer, target: Pick<IStudyTarget, 'kind' | 'ref'>): IStudyMark {
    return player.studyMarks?.[this.keyOf(target)] ?? { sittings: 0, harm: 0 };
  }

  /** The door other streams read: how many times has this person sat with this? */
  static sittingsOn(player: IPlayer, target: Pick<IStudyTarget, 'kind' | 'ref'>): number {
    return this.markOf(player, target).sittings;
  }

  /** What is left of today, wherever this person stands. */
  static energyLeft(player: IPlayer): number {
    return player.currentSession?.energy ?? player.energyToday ?? StatSystem.maxEnergyOf(player);
  }

  static pay(player: IPlayer, cost: number): IPlayer {
    const session = player.currentSession;
    return session
      ? { ...player, currentSession: { ...session, energy: session.energy - cost } }
      : { ...player, energyToday: this.energyLeft(player) - cost };
  }

  /** D32's rule holds: what a sitting asks is the person's, never the thing's, so its price tells nothing. */
  static studyAsk(player: IPlayer, target: IStudyTarget): { cost: number; seconds: number } {
    const item = target.kind === 'item' && !target.hidden ? this.heldItem(player, target.ref) : undefined;
    const scope = item ? this.identifyScopeOf(item) : null;
    const level = scope ? player.bank.universalSkills[this.scopeSkillId(scope)]?.level ?? 0 : this.bestEye(player);
    return this.askAt(player, level);
  }

  /** Always available, for energy. Only a person at rest, or something lost to them for now, is refused. */
  static canStudy(player: IPlayer, target: IStudyTarget, now = Date.now()): Verdict {
    if (player.rest && now < player.rest.until) return no('This character is at rest.');
    if (!target.name.trim()) return no('Study what? Name it.');
    const lost = this.markOf(player, target).lostUntilDay;
    if (lost !== undefined && (player.dayCount ?? 0) < lost) return no(`${target.name} will not sit for you. Not yet.`);
    const { cost } = this.studyAsk(player, target);
    const left = this.energyLeft(player);
    if (left < cost) return no(`Refused: needs ${cost} energy, you hold ${Math.floor(left)}. Rest first.`);
    return ok;
  }

  /** How it landed. A twenty moves it one better and a one one worse. D6: three ranks above cannot fail. */
  static degree(d20: number, total: number, dc: number, autoSuccess = false): StudyOutcome {
    const margin = total - dc;
    let step = margin >= STUDY_MAJOR_MARGIN ? 3 : margin >= 0 ? 2 : margin > -STUDY_MAJOR_MARGIN ? 1 : 0;
    if (d20 === 20) step = Math.min(3, step + 1);
    if (d20 === 1) step = Math.max(0, step - 1);
    if (autoSuccess) step = Math.max(2, step);
    return OUTCOME_LADDER[step];
  }

  private static eyeFor(player: IPlayer, target: IStudyTarget): number {
    const item = target.kind === 'item' && !target.hidden ? this.heldItem(player, target.ref) : undefined;
    return item ? this.identifyLevel(player, item) : this.bestEye(player);
  }

  /** The roll is keyed by who, what and how many sittings they have taken, so a reload rolls nothing new. */
  static rollSitting(player: IPlayer, target: IStudyTarget): IStudyRoll {
    const own = ProgressionSystem.rankOf(player);
    const task = target.rank ?? own;
    const d20 = Rng.fromKey(`study:${player.id}:${this.keyOf(target)}:${player.studyCount ?? 0}`).int(1, 21);
    const mind = Math.max(0, (player.attributes?.intelligence ?? 1) - 1);
    const total = d20 + this.eyeFor(player, target) + mind;
    const dc = STUDY_DC_BASE
      + (ProgressionSystem.rankIndex(task) - ProgressionSystem.rankIndex(own)) * STUDY_DC_PER_RANK
      + this.markOf(player, target).harm * STUDY_DC_PER_HARM;
    return { d20, total, dc, outcome: this.degree(d20, total, dc, ProgressionSystem.checkSkill(own, task).autoSuccess) };
  }

  /** Is this piece anywhere this person holds it? */
  static heldItem(player: IPlayer, itemId: string): IItem | undefined {
    return [
      ...player.bank.stashTabs.flatMap(t => t.items),
      ...(player.currentSession?.inventory ?? []),
      ...(player.equipment?.items ?? [])
    ].find(i => i.id === itemId);
  }

  private static onItem(player: IPlayer, itemId: string, change: (item: IItem) => IItem): IPlayer {
    const on = (i: IItem) => (i.id === itemId ? change(i) : i);
    return {
      ...player,
      bank: { ...player.bank, stashTabs: player.bank.stashTabs.map(t => ({ ...t, items: t.items.map(on) })) },
      equipment: player.equipment ? { ...player.equipment, items: player.equipment.items.map(on) } : player.equipment,
      currentSession: player.currentSession ? { ...player.currentSession, inventory: player.currentSession.inventory.map(on) } : player.currentSession
    };
  }

  /** "failure damages it": what the repair counter already reads, or else its quality and worth. */
  static harmItem(player: IPlayer, itemId: string): IPlayer {
    return this.onItem(player, itemId, item => {
      const { durability, maxDurability } = item.stats ?? {};
      if (maxDurability) {
        return { ...item, stats: { ...item.stats, durability: Math.max(0, Math.round((durability ?? maxDurability) - maxDurability * STUDY_WEAR_SHARE)) } };
      }
      return {
        ...item,
        quality: Math.max(0, Math.round((item.quality - STUDY_QUALITY_BITE) * 100) / 100),
        value: Math.floor(item.value * (1 - STUDY_WORTH_BITE))
      };
    });
  }

  /** "major failure loses it": out of wherever it was, and out of every place that named it. */
  static loseItem(player: IPlayer, itemId: string): IPlayer {
    const without = <T extends object | undefined>(record: T): T => {
      if (!record || !(itemId in record)) return record;
      const { [itemId]: _gone, ...rest } = record as Record<string, unknown>;
      return rest as T;
    };
    const clearSlots = <T extends object>(slots: T): T =>
      Object.fromEntries(Object.entries(slots).filter(([, id]) => id !== itemId)) as T;
    const session = player.currentSession;
    const equipment = player.equipment;
    return {
      ...player,
      bank: {
        ...player.bank,
        carryItemIds: player.bank.carryItemIds?.filter(id => id !== itemId),
        stashTabs: player.bank.stashTabs.map(t => ({ ...t, items: t.items.filter(i => i.id !== itemId), layout: without(t.layout) }))
      },
      equipment: equipment ? { ...equipment, items: equipment.items.filter(i => i.id !== itemId), slots: clearSlots(equipment.slots) } : equipment,
      currentSession: session ? {
        ...session,
        inventory: session.inventory.filter(i => i.id !== itemId),
        inventoryLayout: without(session.inventoryLayout),
        equipped: session.equipped ? clearSlots(session.equipped) : session.equipped
      } : session
    };
  }

  /**
   * A sitting lands, pure. What it costs was paid when it began. A piece is really worn or
   * lost; what cannot be taken away (a person, a building, a creature, a thought) carries
   * the mark instead, which makes it harder, and when lost it will not sit for a while.
   */
  static sit(player: IPlayer, target: IStudyTarget, energy: number, now: number): { player: IPlayer; sitting: IStudySitting; roll: IStudyRoll } {
    const roll = this.rollSitting(player, target);
    const prior = this.markOf(player, target);
    const held = target.kind === 'item';
    const failed = roll.outcome === 'failure' || roll.outcome === 'major_failure';
    const mark: IStudyMark = {
      ...prior,
      sittings: prior.sittings + 1,
      harm: prior.harm + (failed && !held ? 1 : 0),
      ...(roll.outcome === 'major_failure' && !held ? { lostUntilDay: (player.dayCount ?? 0) + STUDY_LOST_DAYS } : {})
    };
    const count = player.studyCount ?? 0;
    let next: IPlayer = { ...player, studyCount: count + 1, studyMarks: { ...player.studyMarks, [this.keyOf(target)]: mark } };
    if (held && roll.outcome === 'failure') next = this.harmItem(next, target.ref);
    if (held && roll.outcome === 'major_failure') next = this.loseItem(next, target.ref);
    const own = ProgressionSystem.rankOf(player);
    const sitting: IStudySitting = {
      id: `sit_${count}`, target, outcome: roll.outcome,
      rankIndex: ProgressionSystem.rankIndex(target.rank ?? own), energy, at: now, before: prior.sittings
    };
    return { player: next, sitting, roll };
  }

  /** The knowledge scope key the mastery machinery files gear study under. */
  static masteryKeyOf(scope: IdentifyScope): string {
    return `gear_${scope}`;
  }

  /**
   * THE REVEAL, pure: everything this item's affixes were banked as becomes
   * known — filed in materialMastery's discoveredAffixes, the one knowledge
   * ledger. Study shows exactly what was banked; it never invents a number.
   */
  static reveal(player: IPlayer, item: IItem): IPlayer {
    return this.revealAffixes(player, this.identifyScopeOf(item) ?? 'armor', item.affixes || []);
  }

  /** The same reveal for whatever holds affixes: an item, or the walls of a room (D26). */
  static revealAffixes(player: IPlayer, scope: IdentifyScope, affixes: { id: string }[]): IPlayer {
    const key = this.masteryKeyOf(scope);
    const prior = player.materialMastery[key] ?? { resourceId: key, knowledgeLevel: 0, discoveredAffixes: [] };
    const discovered = new Set(prior.discoveredAffixes);
    for (const affix of affixes) discovered.add(affix.id);
    return {
      ...player,
      materialMastery: {
        ...player.materialMastery,
        [key]: {
          resourceId: key,
          knowledgeLevel: Math.max(prior.knowledgeLevel, 1),
          discoveredAffixes: [...discovered]
        }
      }
    };
  }
}
