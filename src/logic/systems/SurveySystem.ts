/**
 * WHAT A CHARACTER HAS SCANNED (D68, D81): theirs, wherever they go, and it decays.
 *
 * The land keeps. Who stands on it holds only for the regeneration it was read in,
 * so a person comes back during a world's boot to learn how things changed. What was
 * seen is remembered plainly, as counts, and never as the truth of what stands there now.
 */

import { IPlayer } from '../../../types';
import { IWorldEntity, EntityType, ScanLevel } from '../../entities/world/types';

export type ISurveyEntry = NonNullable<IPlayer['survey']>[string][string];

const contactsOf = (entities: IWorldEntity[]) => {
  const contacts: Record<string, number> = {};
  for (const e of entities) contacts[e.type] = (contacts[e.type] ?? 0) + 1;
  return contacts;
};

export interface IManifestLine {
  key: string;
  label: string;
  rank: string;
  hostile: boolean;
  count: number;
}

const RANK_ORDER = ['F', 'E', 'D', 'C', 'B', 'A', 'S', 'SS', 'SSS'];

export const SurveySystem = {
  /** What a scan read. Bodies the Director changed are counted, since that is what a boot shows. */
  entry(level: number, generation: number, entities: IWorldEntity[], before?: ISurveyEntry): ISurveyEntry {
    const prior = before && before.generation < generation
      ? { contacts: before.contacts, changed: before.changed, generation: before.generation }
      : before?.prior;
    return {
      level, generation,
      contacts: contactsOf(entities),
      changed: entities.filter(e => (e.learned?.length ?? 0) > 0).length,
      ...(prior ? { prior } : {})
    };
  },

  levelNow(entry: ISurveyEntry | undefined, generation: number): number {
    if (!entry) return ScanLevel.UNKNOWN;
    return entry.generation === generation ? entry.level : Math.min(entry.level, ScanLevel.BASIC);
  },

  staleBy(entry: ISurveyEntry, generation: number): number {
    return Math.max(0, generation - entry.generation);
  },

  record(player: IPlayer, worldId: string, sectorKey: string, entry: ISurveyEntry): IPlayer {
    const survey = player.survey ?? {};
    return { ...player, survey: { ...survey, [worldId]: { ...survey[worldId], [sectorKey]: entry } } };
  },

  /** A deep scan's list, led by the danger. D60: a creature gives only the name it has earned. */
  manifest(entities: IWorldEntity[]): IManifestLine[] {
    const lines = new Map<string, IManifestLine>();
    for (const e of entities) {
      const label = e.type === EntityType.MOB ? (e.displayName ?? 'Unknown contact') : e.definitionId;
      const key = `${label}:${e.rank}`;
      const line = lines.get(key);
      if (line) line.count++;
      else lines.set(key, { key, label, rank: String(e.rank), hostile: !!e.isHostile, count: 1 });
    }
    return [...lines.values()]
      .sort((a, b) => Number(b.hostile) - Number(a.hostile) || RANK_ORDER.indexOf(b.rank) - RANK_ORDER.indexOf(a.rank) || b.count - a.count)
      .slice(0, 10);
  }
};
