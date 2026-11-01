/**
 * CAPTURE (D65): hunt, trap, tame, domesticate. Pedro: "All four".
 *
 * The chain's shape is from `D:\-ttrpg-engine\engine\mf-fauna-predation.ts`, read and not
 * imported. Hunting is the fight a person already has. A snare takes one body out alive into a
 * cage, and a bad snare on prey is not a hit, so nothing feels it (N6). A caged body can be
 * tamed in the field for a while, and walks out beside the person. Domesticating is days at
 * home, in `Herd`.
 *
 * Pure and keyed by (body, attempt), so it reads the same on every machine and a replay
 * cannot try again. The numbers are guesses until Wave 12. Nothing here reads a clock.
 */

import { IItem, ItemType, Rarity, SlotType, UniversalRank } from '../../../types';
import { Leaders } from '../../entities/world/Leaders';
import { IKoseki, Koseki } from '../../entities/world/Koseki';
import { Population } from '../../entities/world/Population';
import { answersTag } from '../../entities/hub/room';
import { CompositionSystem } from '../economy/CompositionSystem';
import { Rng, fnv1a } from '../rng/DeterministicRNG';
import { bodyNumbers } from '../theme/ThemeFormula';
import type { ILineProof } from '../theme/CreatureLines';

/** A body in a cage, with all a new home would need to know of it. */
export interface ICaged {
  body: string;
  kind: string;
  def: Record<string, unknown>;
  /** The proof of its line. It goes where the body goes. */
  proof: ILineProof;
  gender: string;
  caughtAt: { worldUid: string; generation: number };
  by: string;
  /** How many tries at taming it has had, to key the next. */
  tameTries?: number;
}

const RANK_ORDER = Object.values(UniversalRank);
const ONE_OF_A_KIND = ['boss', 'titan', 'god'];
/** How readily a nature takes to a snare, and to a hand. */
const TEMPER: Record<string, number> = { PASSIVE: 2, NEUTRAL: 1.5 };
const TEMPER_ELSE = 1;

/** How many fibrous things a snare is tied from. */
const SNARE_PARTS = 2;
/** How long a tamed body stays with you, and how much more for each level of the skill. */
const FOLLOW_MS = 5 * 60_000;
const FOLLOW_PER_LEVEL = 0.1;
/** What a cage weighs, per what the body in it eats. */
const CAGE_KG_PER_APPETITE = 6;

/** Each level of a skill counts as this much of a body's nature. No top. */
const SKILL_SCALE = 10;

const oddsOf = (x: number, d: number) => x / (x + d);

export class Capture {

  /** What setting one takes out of a person. A guess until Wave 12. */
  static readonly SNARE_ENERGY = 3;

  /** Whether a snare could go on this body, from what this person carries. */
  static canSnare(carried: IItem[], bodyId: string, def: { tags?: string[] } | undefined): boolean {
    return carried.some(i => i.tags?.includes('snare')) && this.trapRefusal(bodyId, def) === null;
  }

  /** A person's register, filed at a hub, with the person at its head. What they catch is adopted onto it. */
  static registerOf(hubId: string, personId: string, at: number): IKoseki {
    return Koseki.found(hubId, personId, 'person', at);
  }

  /** Why this body will not go in a snare. Null means it will. A leader's follower will; the leader will not. */
  static trapRefusal(bodyId: string, def: { tags?: string[] } | undefined): string | null {
    if (Leaders.isLeader(bodyId)) return 'It leads. A pack would come for it, and a snare would not hold it.';
    if ((def?.tags ?? []).some(t => ONE_OF_A_KIND.includes(t))) return 'There is only one of it. No snare holds that.';
    return null;
  }

  /** The chance a snare holds: rises with a practised hand and a worn body, falls with rank. Under one, always. */
  static trapOdds(o: { rank: UniversalRank | string; behavior?: string; healthShare?: number; skill?: number }): number {
    const temper = TEMPER[o.behavior ?? ''] ?? TEMPER_ELSE;
    const worn = 2 - Math.max(0, Math.min(1, o.healthShare ?? 1));
    return oddsOf((1 + (o.skill ?? 0) / SKILL_SCALE) * worn * temper, 1 + Math.max(0, RANK_ORDER.indexOf(o.rank as UniversalRank)));
  }

  static trap(o: { seed: string; body: string; attempt: number; rank: UniversalRank | string; behavior?: string; healthShare?: number; skill?: number }): { held: boolean; noticed: boolean; odds: number } {
    const odds = this.trapOdds(o);
    const held = Rng.fromKey(`trap:${o.seed}:${o.body}:${o.attempt}`).next() < odds;
    // N6: a hit is always felt, and a bad snare is not a hit. What hunts knows what a snare is
    const noticed = !held && !(o.behavior === 'PASSIVE' || o.behavior === 'NEUTRAL');
    return { held, noticed, odds };
  }

  /** A snare, from fibrous things in reach. Pure: the caller moves the items and signs the record. */
  static tieSnare(items: IItem[], key: string): { ok: boolean; reason?: string; item?: IItem; consumedIds: string[] } {
    const parts = items.filter(i => answersTag(i, 'fiber')).slice(0, SNARE_PARTS);
    if (parts.length < SNARE_PARTS) return { ok: false, reason: `A snare takes ${SNARE_PARTS} of something fibrous.`, consumedIds: [] };
    const rng = Rng.fromKey(`snare:${key}`);
    const composition = CompositionSystem.compose(
      { recipeId: 'tie_snare', name: 'Tied into a snare', laborSeconds: 30, facility: null },
      parts.map(i => i.composition ?? CompositionSystem.root({ id: i.universalDefinitionId, name: i.name }, 'IMPROVISATION')),
      1
    );
    const item = {
      id: `itm_snare_${rng.int(0, 0xffffffff).toString(16).padStart(8, '0')}`, universalDefinitionId: 'itm_snare', name: 'Snare',
      description: 'Set in reach of something alive. It holds or it does not, and only what hunts will notice.',
      type: ItemType.RESOURCE, slot: SlotType.NONE, rank: UniversalRank.F, rarity: Rarity.COMMON, quality: 0, level: 1,
      value: CompositionSystem.priceOf(composition), itemPower: 0, tags: ['snare', 'fiber'], affixes: [],
      dimensions: { width: 1, height: 1 }, weight: 0.5, stats: {}, visuals: { modelId: 'resource', colorHex: '#9ca3af' }, icon: 'resource_icon',
      history: { dropDate: 0, killCount: 0 }, isIdentified: true, composition
    } as IItem;
    return { ok: true, item, consumedIds: parts.map(i => i.id) };
  }

  /** A body taken alive. Its gender is what the land says it is, keyed by (seed, body). */
  static cage(o: { body: string; kind: string; seed: string; generation: number; worldUid: string; by: string; proof: ILineProof }): ICaged {
    return {
      body: o.body, kind: o.kind, def: o.proof.def, proof: o.proof,
      gender: Population.genderOf(o.seed, o.body),
      caughtAt: { worldUid: o.worldUid, generation: o.generation },
      by: o.by
    };
  }

  /** The cage as a thing a pack carries: what is in it sets its weight and its footprint. Lost if its carrier falls. */
  static cageItem(caged: ICaged, key: string): IItem {
    const { appetite } = bodyNumbers(caged.def as { size?: string; speed?: number });
    const side = Math.max(1, Math.round(Math.log2(appetite)) + 2);
    const rank = (caged.def.rank as UniversalRank) ?? UniversalRank.F;
    return {
      id: `itm_cage_${fnv1a(`cage:${key}:${caged.body}`).toString(16).padStart(8, '0')}`, universalDefinitionId: 'itm_cage', name: 'Caged Contact',
      description: 'Something alive, and not pleased. Use it to try to tame it, or bring it home to a pen.',
      type: ItemType.CONSUMABLE, slot: SlotType.NONE, rank, rarity: Rarity.UNCOMMON, quality: 0, level: 1,
      value: 10 * (1 + Math.max(0, RANK_ORDER.indexOf(rank))), itemPower: 0, tags: ['cage'], affixes: [],
      dimensions: { width: side, height: side }, weight: Math.round(appetite * CAGE_KG_PER_APPETITE * 10) / 10, stats: {},
      visuals: { modelId: 'resource', colorHex: '#9ca3af' }, icon: 'resource_icon',
      history: { dropDate: 0, killCount: 0 }, isIdentified: true, creatureData: caged,
      composition: CompositionSystem.root({ id: 'itm_cage', name: 'Cage' }, 'WORLD')
    } as IItem;
  }

  static tameOdds(o: { rank: UniversalRank | string; behavior?: string; skill?: number }): number {
    const temper = TEMPER[o.behavior ?? ''] ?? TEMPER_ELSE;
    return oddsOf((1 + (o.skill ?? 0) / SKILL_SCALE) * temper, 1 + Math.max(0, RANK_ORDER.indexOf(o.rank as UniversalRank)));
  }

  /** A caged body, let out and answering to a hand, for a while. A miss keeps it caged. */
  static tame(o: { cage: ICaged; attempt: number; skill?: number }): { held: boolean; odds: number; followMs: number } {
    const odds = this.tameOdds({ rank: o.cage.def.rank as string, behavior: o.cage.def.behavior as string, skill: o.skill });
    const held = Rng.fromKey(`tame:${o.cage.body}:${o.attempt}`).next() < odds;
    return { held, odds, followMs: FOLLOW_MS * (1 + (o.skill ?? 0) * FOLLOW_PER_LEVEL) };
  }
}
