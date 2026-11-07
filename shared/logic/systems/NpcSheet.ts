/**
 * THE NPC SHEET (D27, test line 66). Stats and skills dealt from the person's own
 * seed, the donor's law: "Derived at read time, never stored: store the seed,
 * deal the spread." A generated person's stored bytes do not change, so the golden
 * vectors do not move; the sheet comes back byte-identical from (world seed,
 * entity id, pinned web version), and no later batch can change someone in a
 * pinned world.
 *
 * Every nature of one rank totals the same and is shaped differently, and a higher
 * rank has more behind it. Skills are ordinary records read through the same web
 * as the player's, so WebSystem.hasVerb and openStations take them as they are.
 *
 * Wave 11 places residents. This file reads a person; it builds no resident.
 *
 * THE SURFACE (D113): Pedro wants sheets "generated correctly in the generation loop" so Haiku has
 * a surface. The law above already is that loop's half: everything a model needs is dealt from the
 * same keys every time, so the sheet is as fixed as if it were stored. Storing it would move
 * `GOLDEN_VECTORS` and line 66's bar on a person's stored bytes, for no fact a read cannot give.
 * Alignment joins under its own stream, so stats and skills deal exactly what they always did.
 */

import { IAttributes, IItem, ISkillState, IWebPack, MENTAL_ATTRIBUTES, PHYSICAL_ATTRIBUTES, UniversalRank } from '../../types';
import { INpcSheet, IWorldEntity } from '../../entities/world/types';
import { Alignment } from './Alignment';
import { ITalkSurface } from './TalkTypes';
import { ProgressionSystem } from '../../entities/player/systems/ProgressionSystem';
import { Rng } from '../rng/DeterministicRNG';
import { TagLaw } from '../content/TagLaw';
import { WebBank } from '../content/WebBank';
import { RUNG_XP, WebSystem } from './WebSystem';

/** The shape of a nature. Every attribute gets one of these, by a keyed shuffle. */
const STAT_DEAL: readonly number[] = [4, 3, 3, 2, 2, 2, 1, 1, 1, 1, 0, 0, 0, 0, 0];
const ALL_ATTRIBUTES = [...PHYSICAL_ATTRIBUTES, ...MENTAL_ATTRIBUTES] as (keyof IAttributes)[];

type NpcEntity = Pick<IWorldEntity, 'id' | 'rank'> & { npc?: INpcSheet };

const TEMPERAMENTS: INpcSheet['temperament'][] = ['AGGRESSIVE', 'COWARD', 'TERRITORIAL', 'PASSIVE', 'OPPORTUNIST'];
const OBJECTIVES: INpcSheet['objective'][] = ['SURVIVE', 'HOARD', 'WITNESS', 'PROTECT_ASSET'];
const WANTS: INpcSheet['want'][] = ['GOLD', 'GIFT', 'RESPECT'];
/** Guesses until Wave 12. Where a keeper's regard starts, and how far over the rank's floor reads as what. */
const KEEPER_REGARD = 40;
const MIND_FAIR = 1;
const MIND_HIGH = 3;

export class NpcSheet {

  /** A world from before the pin reads the first version of the web, forever. */
  static pinFor(webVersion: number | undefined): number {
    return webVersion ?? 1;
  }

  static read(worldSeed: string, entity: NpcEntity, webVersion: number | undefined): INpcSheet {
    const pack = WebBank.packAt(this.pinFor(webVersion)) ?? WebBank.current();
    return this.readWith(worldSeed, entity, pack);
  }

  static readWith(worldSeed: string, entity: NpcEntity, pack: IWebPack): INpcSheet {
    const key = `${worldSeed}:npc:${entity.id}`;
    const rank = ProgressionSystem.rankIndex(entity.rank);
    return {
      ...(entity.npc as INpcSheet),
      stats: this.dealStats(key, rank),
      skills: this.dealSkills(key, rank, pack),
      alignment: Alignment.deal(key)
    };
  }

  /** The city's keepers were written, not rolled. The rest of who they are is dealt the same way. */
  static keeper(hubSeed: string, npcId: string, rank: UniversalRank, name: string): INpcSheet {
    const rng = Rng.fromKey(`${hubSeed}:npc:${npcId}:nature`);
    return this.read(hubSeed, {
      id: npcId, rank,
      npc: { name, temperament: rng.pick(TEMPERAMENTS), objective: rng.pick(OBJECTIVES), want: rng.pick(WANTS), disposition: KEEPER_REGARD, attempts: 0 }
    }, undefined);
  }

  /** A person in words, for a model. It holds no raw stat: a mind is low, fair or high for their rank. */
  static surface(sheet: INpcSheet, rankOf: UniversalRank): ITalkSurface {
    const floor = 1 + ProgressionSystem.rankIndex(rankOf);
    const mind = Object.fromEntries(MENTAL_ATTRIBUTES.map(attr => {
      const over = (sheet.stats?.[attr] ?? floor) - floor;
      return [attr, over >= MIND_HIGH ? 'high' : over >= MIND_FAIR ? 'fair' : 'low'];
    })) as ITalkSurface['mind'];
    return {
      name: sheet.name, rank: String(rankOf), temperament: sheet.temperament, objective: sheet.objective, want: sheet.want,
      alignment: sheet.alignment ?? 'true neutral', mind,
      hands: Object.keys(sheet.skills ?? {}).map(id => WebSystem.nameOf(id))
    };
  }

  /** The stats alone, under the same key as `read`: they ask nothing of any web. */
  static statsOf(worldSeed: string, entity: Pick<IWorldEntity, 'id' | 'rank'>): IAttributes {
    return this.dealStats(`${worldSeed}:npc:${entity.id}`, ProgressionSystem.rankIndex(entity.rank));
  }

  /** Wave 11's seam: the bond names the person, and the sheet reads back from it. */
  static fromBond(bond: IItem): INpcSheet | null {
    const data = bond.bondData;
    if (!data) return null;
    return this.read(data.worldSeed, {
      id: data.entityId,
      rank: data.rank,
      npc: data.sheet as INpcSheet
    }, data.webVersion);
  }

  private static dealStats(key: string, rank: number): IAttributes {
    const rng = Rng.fromKey(`${key}:stats`);
    const pool = [...STAT_DEAL];
    for (let i = pool.length - 1; i > 0; i--) {
      const j = rng.int(0, i + 1);
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    return Object.fromEntries(ALL_ATTRIBUTES.map((attr, i) => [attr, 1 + rank + pool[i]])) as unknown as IAttributes;
  }

  /** One skill at rank F and one more per rank. No table: whatever this web can mint. */
  private static dealSkills(key: string, rank: number, pack: IWebPack): Record<string, ISkillState> {
    const rng = Rng.fromKey(`${key}:skills`);
    const pairs = WebBank.connections(pack).map(c => c.skillId);
    for (let i = pairs.length - 1; i > 0; i--) {
      const j = rng.int(0, i + 1);
      [pairs[i], pairs[j]] = [pairs[j], pairs[i]];
    }
    const out: Record<string, ISkillState> = {};
    for (const id of pairs.slice(0, rank + 1)) {
      const tags = TagLaw.parseSkillId(id)!;
      const rung = Math.min(RUNG_XP.length - 1, Math.floor(rank / 2));
      const xp = WebSystem.rungXp(rung, rank) + rng.int(0, 40);
      out[id] = WebSystem.withCumulativeXp(WebSystem.freshSkill(id, tags, rank), xp);
    }
    return out;
  }
}
