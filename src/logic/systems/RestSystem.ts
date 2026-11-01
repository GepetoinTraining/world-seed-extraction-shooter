/**
 * THE REST (D43, D50, D51, D58, D79): what play queued settles, and a character's day turns over.
 *
 * Two things, on purpose. SETTLING happens at any rest, a return to the hub included
 * (D30): skills, and what was studied. SLEEPING is chosen and takes real time: what was
 * queued goes to the door when it begins, and energy returns on waking. That downtime
 * is the character's own loop, and the world's Director runs on the world's clock.
 *
 * The rest door asks what lets this person rest here (D58): a hub's places, and any
 * skill minted with the grant. No camp exists in code or in a shipped pack; a model
 * may simply have minted one for someone who has earned it.
 *
 * With no key, no network or a refused batch, a rest still settles and restores. The
 * batch waits for the next rest, and nothing ever blocks on a model (line 87).
 */

import { IItem, IPlayer } from '../../../types';
import { IThemeBody, SKILL_GRANTS } from '../theme/ThemeTypes';
import { WebSystem } from './WebSystem';
import { StudySystem } from './StudySystem';
import { StatSystem } from './StatSystem';
import { WeaveSystem } from './WeaveSystem';
import { CircleSystem, IGiftWords } from './CircleSystem';

export type RestPlace = 'INN' | 'BED' | 'FIELD';

/** What a night at the inn costs, in gold to the hub's treasury. A guess until Wave 12. */
export const INN_FEE = 20;

/**
 * D79: a rest takes real time, on a curve that starts quick and steepens: someone trained
 * for a long shift has a truly long rest, like a rig worker's rotation. Pedro's marks are
 * 500 energy, about 8 hours, and a new character's 50 at 3 to 4 minutes: "enough time to
 * send the LLM call for the very start". That power gives 20 about half a minute and 200
 * about an hour.
 */
export const REST_MARK_ENERGY = 500;
export const REST_MARK_MS = 8 * 60 * 60_000;
export const REST_CURVE_POWER = 2.14;

export interface IRestQueue {
  /** Items studied, waiting to be known. */
  studies: string[];
  /** Weaves tested, waiting for a word. */
  weaves: string[][];
  /** Abilities met in the field, by defeating what cast them or studying it. */
  met: string[];
  /** Kinds of ground walked since the last rest. */
  ground: string[];
}

export const emptyQueue = (): IRestQueue => ({ studies: [], weaves: [], met: [], ground: [] });

export interface ISkillWords {
  name: string;
  flavor: string;
  grants: string[];
}

export interface IThemeGrowth {
  creatures: IThemeBody['creatures'];
  materials: IThemeBody['materials'];
  affixes: IThemeBody['affixes'];
  abilities: IThemeBody['abilities'];
  tags: IThemeBody['tags'];
  lore: string[];
}

export interface IDreamResult {
  skills: { id: string; name: string; flavor: string; grants: string[] }[];
  weaves: { id: string; name: string }[];
  /** What a skill's third circle earned. */
  gifts?: IGiftWords[];
  growth?: IThemeGrowth;
}

const allInventories = (player: IPlayer): IItem[] => [
  ...(player.bank.stashTabs.flatMap(t => t.items)),
  ...(player.currentSession?.inventory ?? []),
  ...(player.equipment?.items ?? [])
];

const mapItems = (player: IPlayer, ids: Set<string>, change: (i: IItem) => IItem): IPlayer => {
  const on = (i: IItem) => (ids.has(i.id) ? change(i) : i);
  return {
    ...player,
    bank: { ...player.bank, stashTabs: player.bank.stashTabs.map(t => ({ ...t, items: t.items.map(on) })) },
    equipment: player.equipment ? { ...player.equipment, items: player.equipment.items.map(on) } : player.equipment,
    currentSession: player.currentSession ? { ...player.currentSession, inventory: player.currentSession.inventory.map(on) } : player.currentSession
  };
};

export class RestSystem {

  /** D58: what lets this person rest where they stand? A held skill with the grant. */
  static grantsFieldRest(player: IPlayer): boolean {
    return Object.values(player.skillWords ?? {}).some(w => w.grants.includes('rest'));
  }

  static canRest(player: IPlayer, place: RestPlace, now = Date.now()): { ok: boolean; reason?: string } {
    if (this.isResting(player, now)) return { ok: false, reason: 'This character is already at rest.' };
    if (place === 'FIELD' && !this.grantsFieldRest(player)) {
      return { ok: false, reason: 'You do not know how to rest out here. Not yet.' };
    }
    if (place !== 'FIELD' && player.currentSession) return { ok: false, reason: 'Nobody sleeps at the inn from out here.' };
    if (place === 'INN' && player.bank.gold < INN_FEE) return { ok: false, reason: `A night costs ${INN_FEE}G. You carry ${player.bank.gold}G.` };
    return { ok: true };
  }

  // -----------------------------------------------------------------------
  // QUEUEING: cheap, in play, with no call
  // -----------------------------------------------------------------------

  static queueOf(player: IPlayer): IRestQueue {
    return player.restQueue ?? emptyQueue();
  }

  static queueStudy(player: IPlayer, itemId: string): IPlayer {
    const q = this.queueOf(player);
    if (q.studies.includes(itemId)) return player;
    return { ...player, restQueue: { ...q, studies: [...q.studies, itemId] } };
  }

  static queueWeave(player: IPlayer, elements: string[]): IPlayer {
    const q = this.queueOf(player);
    const id = WeaveSystem.idOf(elements);
    if ((player.weaveNames ?? {})[id] || q.weaves.some(w => WeaveSystem.idOf(w) === id)) return player;
    return { ...player, restQueue: { ...q, weaves: [...q.weaves, [...elements]] } };
  }

  static queueMet(player: IPlayer, abilityIds: string[]): IPlayer {
    const q = this.queueOf(player);
    const known = new Set([...(player.knownAbilities ?? []), ...q.met]);
    const fresh = abilityIds.filter(id => !known.has(id));
    return fresh.length > 0 ? { ...player, restQueue: { ...q, met: [...q.met, ...fresh] } } : player;
  }

  static queueGround(player: IPlayer, biome: string): IPlayer {
    const q = this.queueOf(player);
    return q.ground.includes(biome) ? player : { ...player, restQueue: { ...q, ground: [...q.ground, biome] } };
  }

  /** Is this waiting to be known? Never by what it is: asked of the queue alone. */
  static isStudied(player: IPlayer, itemId: string): boolean {
    return this.queueOf(player).studies.includes(itemId);
  }

  // -----------------------------------------------------------------------
  // SETTLING: at any rest (D30, D50). Pure.
  // -----------------------------------------------------------------------

  static settle(player: IPlayer): { player: IPlayer; read: IItem[]; emerged: { id: string }[]; learned: string[]; floorNamed: string[] } {
    const { player: skilled, emerged } = WebSystem.rest(player);
    const q = this.queueOf(skilled);

    // D50: what was studied is known now, exactly as banked.
    const ids = new Set(q.studies);
    const read = allInventories(skilled).filter(i => ids.has(i.id));
    let next = read.reduce((p, item) => StudySystem.reveal(p, item), skilled);
    next = mapItems(next, ids, i => ({ ...i, isIdentified: true }));

    // Line 80: what was met in the field is known, and can be cast.
    const learned = q.met.filter(id => !(next.knownAbilities ?? []).includes(id));
    next = { ...next, knownAbilities: [...(next.knownAbilities ?? []), ...learned] };

    // A weave's word waits for the model; until then it has the plain name. It is still known.
    const floorNamed: string[] = [];
    const weaveNames = { ...(next.weaveNames ?? {}) };
    for (const elements of q.weaves) {
      const id = WeaveSystem.idOf(elements);
      if (!weaveNames[id]) {
        weaveNames[id] = WeaveSystem.floorName(elements);
        floorNamed.push(id);
      }
    }
    next = { ...next, weaveNames, restQueue: { ...emptyQueue(), ground: q.ground, weaves: q.weaves } };
    return { player: next, read, emerged, learned, floorNamed };
  }

  // -----------------------------------------------------------------------
  // SLEEPING: chosen. The day turns over (D51).
  // -----------------------------------------------------------------------

  /** How long this rest will take, from the energy this character spent. */
  static restMs(player: IPlayer): number {
    const full = StatSystem.maxEnergyOf(player);
    const left = player.currentSession?.energy ?? player.energyToday ?? full;
    return Math.round(REST_MARK_MS * (Math.max(0, full - left) / REST_MARK_ENERGY) ** REST_CURVE_POWER);
  }

  static isResting(player: IPlayer, now = Date.now()): boolean {
    return !!player.rest && now < player.rest.until;
  }

  static beginRest(player: IPlayer, place: RestPlace, now: number): IPlayer {
    return { ...player, rest: { until: now + this.restMs(player), place, startedAt: now } };
  }

  /** Energy comes back on waking, never on lying down. */
  static wake(player: IPlayer): IPlayer {
    return { ...this.restoreEnergy(player), rest: undefined };
  }

  /** A hurt in the field ends a rest, and it restored nothing. */
  static breakRest(player: IPlayer): IPlayer {
    return { ...player, rest: undefined };
  }

  /**
   * Pedro: "magic should be able to refill it, as should potions and plants (very very
   * rare)". The one door for all of them. It lifts what is left of today toward the top,
   * no further, and it is not a rest: the day does not turn, and nothing queued settles.
   */
  static refillEnergy(player: IPlayer, amount: number): IPlayer {
    const full = StatSystem.maxEnergyOf(player);
    const session = player.currentSession;
    const left = session?.energy ?? player.energyToday ?? full;
    const energy = Math.max(left, Math.min(full, left + Math.max(0, amount)));
    return session ? { ...player, currentSession: { ...session, energy } } : { ...player, energyToday: energy };
  }

  static restoreEnergy(player: IPlayer): IPlayer {
    const full = StatSystem.maxEnergyOf(player);
    return {
      ...player,
      energyToday: undefined,
      dayCount: (player.dayCount ?? 0) + 1,
      currentSession: player.currentSession ? { ...player.currentSession, energy: full } : player.currentSession
    };
  }

  /** What the model is told. It never hears a player's items or anything hidden on them. */
  static dreamQueue(player: IPlayer, emerged: { id: string }[]): Record<string, unknown> {
    const q = this.queueOf(player);
    return {
      skills: emerged.map(s => ({ id: s.id, tags: s.id.replace(/^skill_/, '').split('+') })),
      forming: Object.values(player.skillProgress ?? {}).slice(0, 40).map(p => ({ id: p.id, tags: p.tags, attempts: p.attempts })),
      weaves: q.weaves.map(elements => ({ id: WeaveSystem.idOf(elements), elements })),
      gifts: CircleSystem.asks(player),
      ground: q.ground
    };
  }

  /**
   * The law over what came back from a rest (D43). Refused whole when broken: a skill
   * it never asked about, or a grant outside the vocabulary, and nothing changes.
   */
  static judgeDream(result: IDreamResult, asked: { skills: string[]; weaves: string[]; gifts?: string[] }, player?: IPlayer, elements?: string[]): { ok: boolean; reason?: string } {
    if (!result || !Array.isArray(result.skills) || !Array.isArray(result.weaves)) return { ok: false, reason: 'That is not what a rest returns.' };
    for (const s of result.skills) {
      if (!asked.skills.includes(s.id)) return { ok: false, reason: `Nobody asked about ${s.id}.` };
      if (!s.name?.trim()) return { ok: false, reason: `${s.id} came back with no name.` };
      const stray = (s.grants ?? []).find(g => !(SKILL_GRANTS as readonly string[]).includes(g as never));
      if (stray) return { ok: false, reason: `${s.id} grants "${stray}", and the game has no such thing.` };
    }
    for (const w of result.weaves) {
      if (!asked.weaves.includes(w.id)) return { ok: false, reason: `Nobody tested ${w.id}.` };
      if (!w.name?.trim()) return { ok: false, reason: `${w.id} came back with no name.` };
    }
    const gifts = result.gifts ?? [];
    if (player) {
      const verdict = CircleSystem.judgeAll(gifts, player, asked.gifts ?? [], elements);
      if (!verdict.ok) return verdict;
    } else if (gifts.length > 0) {
      return { ok: false, reason: 'Nobody can say who these gifts are for.' };
    }
    return { ok: true };
  }

  /**
   * What a rest grew, as the next version of a world's theme: a new id, a new pack,
   * and the same law. It stands beside the old one; a world already signed never moves.
   */
  static grownTheme(theme: IThemeBody, growth: IThemeGrowth | undefined): IThemeBody | null {
    if (!growth) return null;
    const count = growth.creatures.length + growth.materials.length + growth.affixes.length + growth.abilities.length + growth.lore.length;
    if (count === 0) return null;
    return {
      ...theme,
      tags: [...theme.tags, ...growth.tags],
      creatures: [...theme.creatures, ...growth.creatures],
      materials: [...theme.materials, ...growth.materials],
      affixes: [...theme.affixes, ...growth.affixes],
      abilities: [...theme.abilities, ...growth.abilities],
      lore: [...theme.lore, ...growth.lore]
    };
  }

  /** What a judged dream does to this person: its words and its grants. */
  static applyDream(player: IPlayer, result: IDreamResult): IPlayer {
    const skillWords = { ...(player.skillWords ?? {}) };
    for (const s of result.skills) skillWords[s.id] = { name: s.name, flavor: s.flavor, grants: s.grants ?? [] };
    const weaveNames = { ...(player.weaveNames ?? {}) };
    for (const w of result.weaves) weaveNames[w.id] = w.name;
    const named = new Set(result.weaves.map(w => w.id));
    const q = this.queueOf(player);
    return CircleSystem.apply({
      ...player, skillWords, weaveNames,
      pendingDream: undefined,
      restQueue: { ...q, weaves: q.weaves.filter(e => !named.has(WeaveSystem.idOf(e))), ground: [] }
    }, result.gifts ?? []);
  }
}
