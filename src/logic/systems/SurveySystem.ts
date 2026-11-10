/**
 * WHAT A CHARACTER HAS SCANNED (D68, D81): theirs, wherever they go, and it decays.
 *
 * The land keeps. Who stands on it holds only for the regeneration it was read in,
 * so a person comes back during a world's boot to learn how things changed. What was
 * seen is remembered plainly, as counts, and never as the truth of what stands there now.
 */

import { IPlayer } from '../../../shared/types';
import { IWorldEntity, EntityType, ScanLevel } from '../../../shared/entities/world/types';
import { chunkOf } from '../../../shared/entities/world/grid';
import { Leaders } from '../../../shared/entities/world/Leaders';
import { ContactNames } from './ContactNames';

export type ISurveyEntry = NonNullable<IPlayer['survey']>[string][string];
/** One world's sectors, on a character or on paper (D85). */
export type ISurveySheet = Record<string, ISurveyEntry>;

/** D93: what a reading shows of a territory: the ground, what stood on it, and when. No creature's name (D60). */
const holdingsFrom = (entities: IWorldEntity[], generation: number): NonNullable<ISurveyEntry['holdings']> => {
  const bySeat = new Map<string, NonNullable<ISurveyEntry['holdings']>[number]>();
  for (const e of entities) {
    if (!e.holding) continue;
    let held = bySeat.get(e.holding.seat);
    if (!held) {
      held = { generation, seat: e.holding.seat, chunks: [...e.holding.chunks], anchors: e.holding.anchors, marks: [] };
      bySeat.set(e.holding.seat, held);
    }
    if (!e.structure) continue;
    const mark = { fn: e.structure.fn, ground: `${chunkOf(e.position.x)},${chunkOf(e.position.y)}`, built: e.structure.built };
    if (!held.marks.some(m => m.fn === mark.fn && m.ground === mark.ground && m.built === mark.built)) held.marks.push(mark);
  }
  return [...bySeat.values()].sort((a, b) => (a.seat < b.seat ? -1 : 1));
};

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
  /** How many bodies the line stands for. A leader's line is the leader alone. */
  count: number;
  /** Q44: a leader, a pack that walks together, or bodies on their own. */
  mark: 'leader' | 'pack' | 'single';
  /** A leader's: how many walk behind it. */
  pack?: number;
  /** C7: how many leaders or packs that read exactly like this one the line stands for. One for bodies on their own. */
  times: number;
}

/** How well a reader knows a definition. With nobody asking, a thing reads by its plain name. */
type KnowledgeReader = (definitionId: string) => number;
const PLAINLY_KNOWN: KnowledgeReader = () => 1;

const MARK_ORDER: IManifestLine['mark'][] = ['leader', 'pack', 'single'];
const highest = (bodies: IWorldEntity[]) => bodies.reduce((top, e) => (RANK_ORDER.indexOf(String(e.rank)) > RANK_ORDER.indexOf(top) ? String(e.rank) : top), String(bodies[0].rank));
const commonest = (labels: string[]) => {
  const n = new Map<string, number>();
  for (const l of labels) n.set(l, (n.get(l) ?? 0) + 1);
  return [...n.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0][0];
};

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
    // A shallow scan says nothing of who holds what, so what was read before stands, as old as it was
    const holdings = level >= ScanLevel.DETAILED ? holdingsFrom(entities, generation) : before?.holdings ?? [];
    return {
      level, generation,
      contacts: contactsOf(entities),
      changed: entities.filter(e => (e.learned?.length ?? 0) > 0).length,
      ...(prior ? { prior } : {}),
      ...(holdings.length > 0 ? { holdings } : {})
    };
  },

  /**
   * D93: a walk reads what is in sight. It adds to the record of that sector and leaves what a scan
   * said about the rest alone. Nothing changes if this has already been read this cycle.
   */
  sawHolding(player: IPlayer, worldId: string, sectorKey: string, entity: IWorldEntity, generation: number): IPlayer {
    if (!entity.holding) return player;
    const before = player.survey?.[worldId]?.[sectorKey];
    const [read] = holdingsFrom([entity], generation);
    const kept = before?.holdings ?? [];
    const had = kept.find(h => h.seat === read.seat && h.generation === generation);
    const fresh = read.marks.filter(m => !had?.marks.some(o => o.fn === m.fn && o.ground === m.ground && o.built === m.built));
    if (had && fresh.length === 0) return player;
    const holding = had ? { ...had, marks: [...had.marks, ...fresh] } : read;
    const holdings = [...kept.filter(h => h.seat !== read.seat), holding].sort((a, b) => (a.seat < b.seat ? -1 : 1));
    return this.record(player, worldId, sectorKey, { ...(before ?? { level: ScanLevel.UNKNOWN, generation, contacts: {}, changed: 0 }), holdings });
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
    for (const [key, { level, generation, contacts, changed, prior, holdings }] of Object.entries(sectors)) {
      sheet[key] = {
        level, generation, changed, contacts: { ...contacts },
        ...(prior ? { prior: { contacts: { ...prior.contacts }, changed: prior.changed, generation: prior.generation } } : {}),
        ...(holdings ? {
          holdings: holdings.map(h => ({
            generation: h.generation, seat: h.seat, chunks: [...h.chunks], anchors: h.anchors,
            marks: h.marks.map(({ fn, ground, built }) => ({ fn, ground, built })),
            ...(h.named ? { named: h.named } : {})
          }))
        } : {})
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

  /**
   * A deep scan's list, led by the danger. D60: a creature gives only the name it has earned, and
   * N10: everything else reads by the name its card would give this reader, never by an id.
   * Q44: what a scan sees shows, all of it. A leader is marked with the pack behind it, and a pack
   * that walks together is one line; nothing is cut off the end. C7: leaders or packs that read
   * exactly alike share a line that says how many, so every body is still counted.
   */
  manifest(entities: IWorldEntity[], level: KnowledgeReader = PLAINLY_KNOWN): IManifestLine[] {
    const labelOf = (e: IWorldEntity) => ContactNames.fromAbove(e, level);
    const herds = new Map<string, IWorldEntity[]>();
    const singles: IWorldEntity[] = [];
    for (const e of entities) {
      const herd = e.type === EntityType.MOB ? Leaders.herdOf(e.id) : undefined;
      if (!herd) { singles.push(e); continue; }
      herds.set(herd, [...(herds.get(herd) ?? []), e]);
    }
    const herded = new Map<string, IManifestLine>();
    const fold = (line: Omit<IManifestLine, 'key' | 'times'>) => {
      const key = `${line.mark}:${line.label}:${line.rank}:${line.hostile ? 'danger' : 'calm'}:${line.mark === 'leader' ? line.pack : line.count}`;
      const same = herded.get(key);
      if (same) same.times++;
      else herded.set(key, { ...line, key, times: 1 });
    };
    for (const members of herds.values()) {
      const leader = members.find(m => Leaders.isLeader(m.id));
      if (leader) {
        fold({ label: labelOf(leader), rank: String(leader.rank), hostile: !!leader.isHostile, count: 1, mark: 'leader', pack: members.length - 1 });
      } else if (members.length >= 2) {
        fold({ label: commonest(members.map(labelOf)), rank: highest(members), hostile: members.some(m => !!m.isHostile), count: members.length, mark: 'pack' });
      } else singles.push(...members);
    }
    const byLabel = new Map<string, IManifestLine>();
    for (const e of singles) {
      const label = labelOf(e);
      const key = `${label}:${e.rank}`;
      const line = byLabel.get(key);
      if (line) line.count++;
      else byLabel.set(key, { key, label, rank: String(e.rank), hostile: !!e.isHostile, count: 1, mark: 'single', times: 1 });
    }
    return [...herded.values(), ...byLabel.values()].sort((a, b) =>
      Number(b.hostile) - Number(a.hostile) || MARK_ORDER.indexOf(a.mark) - MARK_ORDER.indexOf(b.mark)
      || RANK_ORDER.indexOf(b.rank) - RANK_ORDER.indexOf(a.rank) || (b.pack ?? 0) - (a.pack ?? 0) || b.count - a.count
      || (a.key < b.key ? -1 : 1));
  },

  /**
   * Q44: one line, said so it reads without colour. A leader leads with a triangle and the pack
   * behind it, a pack with its bars, and danger with a bang ahead of everything. C7: a line that
   * stands for several says how many, ahead of its mark.
   */
  say(line: IManifestLine): string {
    const danger = line.hostile ? '! ' : '';
    const several = line.times > 1 ? `${line.times}× ` : '';
    if (line.mark === 'leader') return `${danger}${several}▲ LEADER [${line.rank}] ${line.label}${line.pack ? `, ${line.pack} behind ${line.times > 1 ? 'each' : 'it'}` : ''}`;
    if (line.mark === 'pack') return `${danger}${several}≡ PACK OF ${line.count} [${line.rank}] ${line.label}`;
    return `${danger}${line.count}× [${line.rank}] ${line.label}`;
  },

  /** N10: how many of one kind a scan counted, in plain words. */
  counted(type: string, count: number): string {
    return ContactNames.counted(type, count);
  },

  /** Q44: the leaders and packs a scan saw, from the depth that sees them (D93's `seen`). */
  packs(entities: IWorldEntity[]): IManifestLine[] {
    return this.manifest(entities).filter(l => l.mark !== 'single');
  }
};
