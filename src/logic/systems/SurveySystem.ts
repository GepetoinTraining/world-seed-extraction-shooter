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
/** One world's sectors, on a character or on paper (D85). */
export type ISurveySheet = Record<string, ISurveyEntry>;

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

/** What a map is worth before any reading: a guess until Wave 12, like the rest of the prices. */
const MAP_BASE_WORTH = 10, MAP_WORTH_PER_LEVEL = 5;

const held = (reader: ISurveyEntry | undefined, written: ISurveyEntry) =>
  !!reader && (reader.generation > written.generation || (reader.generation === written.generation && reader.level >= written.level));

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

  /** D85: what goes on paper. Named field by field, so nothing an entry later comes to hold can ride along (D60). */
  mapSheet(sectors: ISurveySheet): ISurveySheet {
    const sheet: ISurveySheet = {};
    for (const [key, { level, generation, contacts, changed, prior }] of Object.entries(sectors)) {
      sheet[key] = {
        level, generation, changed, contacts: { ...contacts },
        ...(prior ? { prior: { contacts: { ...prior.contacts }, changed: prior.changed, generation: prior.generation } } : {})
      };
    }
    return sheet;
  },

  mapSpread(sectors: ISurveySheet) {
    const generations = Object.values(sectors).map(e => e.generation);
    return { sectors: generations.length, oldest: Math.min(...generations), newest: Math.max(...generations) };
  },

  /** D85: a fresh map is worth more, and a deep one more than a shallow one. */
  mapWorth(sectors: ISurveySheet, generation: number): number {
    const read = Object.values(sectors).reduce((sum, e) => sum + e.level / (1 + this.staleBy(e, generation)), 0);
    return MAP_BASE_WORTH + Math.round(read * MAP_WORTH_PER_LEVEL);
  },

  /**
   * D85: reading a map. Each sector joins the reader's own record at the regeneration it was
   * scanned in, unless they hold it as fresh already. What they held before becomes the change
   * they can see, the same as if they had scanned it themselves.
   */
  readMap(player: IPlayer, worldId: string, sectors: ISurveySheet) {
    let next = player, taken = 0, kept = 0;
    for (const [key, written] of Object.entries(sectors)) {
      const reader = player.survey?.[worldId]?.[key];
      if (held(reader, written)) { kept++; continue; }
      const prior = reader && reader.generation < written.generation
        ? { contacts: reader.contacts, changed: reader.changed, generation: reader.generation }
        : reader?.prior ?? written.prior;
      next = this.record(next, worldId, key, { ...written, ...(prior ? { prior } : {}) });
      taken++;
    }
    return { player: next, taken, kept };
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
