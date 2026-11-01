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
 */

import { IAttributes, IItem, ISkillState, IWebPack, MENTAL_ATTRIBUTES, PHYSICAL_ATTRIBUTES } from '../../../types';
import { INpcSheet, IWorldEntity } from '../../entities/world/types';
import { ProgressionSystem } from '../../entities/player/systems/ProgressionSystem';
import { Rng } from '../rng/DeterministicRNG';
import { TagLaw } from '../content/TagLaw';
import { WebBank } from '../content/WebBank';
import { RUNG_XP, WebSystem } from './WebSystem';

/** The shape of a nature. Every attribute gets one of these, by a keyed shuffle. */
const STAT_DEAL: readonly number[] = [4, 3, 3, 2, 2, 2, 1, 1, 1, 1, 0, 0, 0, 0, 0];
const ALL_ATTRIBUTES = [...PHYSICAL_ATTRIBUTES, ...MENTAL_ATTRIBUTES] as (keyof IAttributes)[];

type NpcEntity = Pick<IWorldEntity, 'id' | 'rank'> & { npc?: INpcSheet };

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
      skills: this.dealSkills(key, rank, pack)
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
