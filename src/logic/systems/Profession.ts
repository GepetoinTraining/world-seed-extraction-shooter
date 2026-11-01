/**
 * THE PROFESSION (D119): what a person is on their sheet, and what they know. Pedro: "the
 * professions come from the shared pool the theme carries". Dealt by a keyed roll at read
 * time, as a sheet's stats and skills are, so a generated person's stored bytes never move.
 *
 * A world whose theme carries no pool still has working people: their profession is read
 * from their own hands, a station their skills open, and it asks no model anything.
 */

import { ISkillState, IWebPack, IWebStation } from '../../../types';
import { ProgressionSystem } from '../../entities/player/systems/ProgressionSystem';
import { Rng } from '../rng/DeterministicRNG';
import { WebBank } from '../content/WebBank';
import { ContentRegistry } from '../theme/ContentRegistry';
import { rankStep } from '../theme/ThemeFormula';
import { IThemeProfession, RANKS, ThemeRank } from '../theme/ThemeTypes';
import { WebSystem } from './WebSystem';

export interface IProfession {
  name: string;
  blurb: string;
  /** What a chain is written back from. */
  concept: string;
  knows: string;
  workshop: string;
  tool: string[];
  material: string[];
  rank: ThemeRank;
  /** Their world's own pool, or read from their hands when it had none. */
  from: 'THEME' | 'HANDS';
  /** The station their hands open. A theme's profession may have none anywhere yet. */
  stationId?: string;
}

const best = (skills: ISkillState[]) =>
  [...skills].sort((a, b) => WebSystem.cumulativeXp(b) - WebSystem.cumulativeXp(a) || a.id.localeCompare(b.id));

export const Profession = {
  /** The pool's own entry for this person: anyone of a rank to hold it, by a keyed roll. */
  dealt(pool: IThemeProfession[], worldSeed: string, entityId: string, rank: string): IThemeProfession | null {
    const step = ProgressionSystem.rankIndex(rank as never);
    const fits = pool.filter(p => rankStep(p.rank) <= step);
    const from = fits.length > 0 ? fits : pool;
    if (from.length === 0) return null;
    return from[Rng.fromKey(`${worldSeed}:npc:${entityId}:profession`).int(0, from.length)];
  },

  /** The first station these hands open, the best-worked hand first. */
  stationOf(skills: Record<string, ISkillState>, pack: IWebPack = WebBank.current()): { skill: ISkillState; station: IWebStation } | null {
    for (const skill of best(WebSystem.heldSkills(skills))) {
      const id = WebSystem.benchesOf(skill.tags, pack)[0];
      const station = id ? pack.stations.find(s => s.id === id) : undefined;
      if (station) return { skill, station };
    }
    return null;
  },

  /** No pool: their hands say what they are. Null means no station anyone could give them. */
  fromHands(skills: Record<string, ISkillState>, rank: string, pack: IWebPack = WebBank.current()): IProfession | null {
    const held = this.stationOf(skills, pack);
    if (!held) return null;
    const { skill, station } = held;
    const known = WebSystem.nameOf(skill.id, pack);
    return {
      name: `${station.name} hand`, blurb: `Knows ${known}, and little else worth saying.`,
      concept: skill.id, knows: known, workshop: `a ${station.name}`,
      tool: skill.tags.filter(t => WebBank.hasKind(pack, t, ['tool', 'trade', 'action'])),
      material: WebSystem.materialIdentity(skill.tags, pack),
      rank: RANKS[Math.min(RANKS.length - 1, ProgressionSystem.rankIndex(rank as never))],
      from: 'HANDS', stationId: station.id
    };
  },

  /** The whole read: their world's pool first. */
  of(person: { worldSeed: string; entityId: string; rank: string; themeId?: string; skills: Record<string, ISkillState> }, pack: IWebPack = WebBank.current()): IProfession | null {
    const pool = ContentRegistry.get(person.themeId)?.professions ?? [];
    const entry = this.dealt(pool, person.worldSeed, person.entityId, person.rank);
    if (!entry) return this.fromHands(person.skills, person.rank, pack);
    const opens = pack.stations.find(s => s.connection.tool.some(t => entry.tool.includes(t)) && s.connection.material.every(t => entry.material.includes(t)));
    return {
      name: entry.name, blurb: entry.blurb, concept: entry.concept, knows: entry.knows, workshop: entry.workshop,
      tool: entry.tool, material: entry.material, rank: entry.rank, from: 'THEME', ...(opens ? { stationId: opens.id } : {})
    };
  }
};
