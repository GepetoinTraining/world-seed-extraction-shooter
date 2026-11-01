/**
 * THE DIRECTOR (D48, line 90): monsters change between rests, and come to differ.
 *
 * What it remembers is plain data on a world's record: how each creature fared. At
 * a rest the generation rises, and each creature's chance of a trait follows its own
 * fitness: what wore people down grows more common, what fell at once grows less so.
 *
 * Which body gets which trait is keyed by (seed, generation, entity), so the same
 * record reads the same on every machine, and generation 0 changes nothing at all.
 * Traits come from the world's theme, as data: a banked affix scoped to `mob`, and
 * the theme's own magic. Nothing here names one, and nothing caps how many a theme holds.
 */

import { fnv1a, Rng } from '../../logic/rng/DeterministicRNG';

export interface IDirectorRecord {
  generation: number;
  /** Per creature: how many times it brought a person down, and how many times it fell. */
  felled: Record<string, number>;
  fell: Record<string, number>;
  /** Per creature: its trait chance, moved by fitness at each rest. */
  weights: Record<string, number>;
}

export const emptyDirectorRecord = (): IDirectorRecord => ({ generation: 0, felled: {}, fell: {}, weights: {} });

export interface IMobTrait {
  id: string;
  name: string;
  type: 'PREFIX' | 'SUFFIX';
  stats: Record<string, number>;
}

export interface IMobVariant {
  traits: IMobTrait[];
  /** Magic it has picked up beyond what it was born with. */
  learned: string[];
  /** D60: the name a person may read. Absent means it has not earned one. */
  displayName?: string;
  bonusHealth: number;
  bonusDamage: number;
}

/** The chance a body carries a trait, before its fitness. Guesses until Wave 12. */
const BASE_TRAIT_CHANCE = 0.08;
const PER_GENERATION = 0.04;
const MIN_WEIGHT = 0.1;
const LEARN_CHANCE = 0.15;

/**
 * D60: a creature's name is masked until it has earned one: it must be magical (a trait
 * or magic it learned) or one of a kind, and of the second generation or later. A
 * generation here is a creature's own line: the second has become a different monster.
 * Nothing makes that change yet, so every line is its first and nobody is named.
 */
const NAMED_FROM_GENERATION = 2;
const ONE_OF_A_KIND = ['boss', 'titan', 'god'];

export interface IDirectorPool {
  affixes: { id: string; name: string; type: 'PREFIX' | 'SUFFIX'; statModifiers?: Record<string, [number, number]> }[];
  abilities: string[];
}

const NONE: IMobVariant = { traits: [], learned: [], bonusHealth: 0, bonusDamage: 0 };

export class Director {

  static report(record: IDirectorRecord, kind: 'FELLED_A_PERSON' | 'FELL', definitionId: string): IDirectorRecord {
    if (kind === 'FELLED_A_PERSON') {
      return { ...record, felled: { ...record.felled, [definitionId]: (record.felled[definitionId] ?? 0) + 1 } };
    }
    return { ...record, fell: { ...record.fell, [definitionId]: (record.fell[definitionId] ?? 0) + 1 } };
  }

  /**
   * A rest passes: the generation rises, fitness moves each weight, the tallies reset.
   * Pure: the same record always gives the same next record.
   */
  static evolve(record: IDirectorRecord): IDirectorRecord {
    const weights = { ...record.weights };
    const seen = new Set([...Object.keys(record.felled), ...Object.keys(record.fell)]);
    for (const id of [...seen].sort()) {
      const felled = record.felled[id] ?? 0;
      const fell = record.fell[id] ?? 0;
      const fitness = 1 + (felled * 2 - fell * 0.1) / Math.max(1, felled + fell);
      weights[id] = Math.max(MIN_WEIGHT, Math.round((weights[id] ?? 1) * fitness * 1000) / 1000);
    }
    return { generation: record.generation + 1, felled: {}, fell: {}, weights };
  }

  /**
   * What this one body has become, this generation. Read at chunk build, so positions
   * and the land never move; only what stands on them differs.
   */
  static variantOf(
    seed: string, entityId: string, definitionId: string, name: string,
    record: IDirectorRecord | undefined, pool: IDirectorPool | undefined, tags: string[] = [], line = 1
  ): IMobVariant {
    if (!record || record.generation === 0) return NONE;
    const rng = Rng.fromKey(`director:${seed}:${record.generation}:${entityId}`);
    const weight = record.weights[definitionId] ?? 1;
    const chance = (BASE_TRAIT_CHANCE + PER_GENERATION * record.generation) * weight;

    const traits: IMobTrait[] = [];
    const affixes = [...(pool?.affixes ?? [])].sort((a, b) => fnv1a(a.id) - fnv1a(b.id));
    if (affixes.length > 0 && rng.next() < chance) {
      const entry = affixes[rng.int(0, affixes.length)];
      const stats: Record<string, number> = {};
      for (const [stat, [low, high]] of Object.entries(entry.statModifiers ?? {})) {
        stats[stat] = Math.round((low + rng.next() * (high - low)) * 100) / 100;
      }
      traits.push({ id: entry.id, name: entry.name, type: entry.type, stats });
    }

    const learned: string[] = [];
    const abilities = pool?.abilities ?? [];
    if (abilities.length > 0 && rng.next() < chance * LEARN_CHANCE) {
      learned.push(abilities[rng.int(0, abilities.length)]);
    }

    const prefix = traits.find(t => t.type === 'PREFIX')?.name;
    const suffix = traits.find(t => t.type === 'SUFFIX')?.name;
    const earned = line >= NAMED_FROM_GENERATION
      && (traits.length > 0 || learned.length > 0 || tags.some(t => ONE_OF_A_KIND.includes(t)));
    return {
      traits, learned,
      ...(earned ? { displayName: [prefix, name, suffix].filter(Boolean).join(' ') } : {}),
      bonusHealth: traits.reduce((sum, t) => sum + (t.stats.max_health ?? 0), 0),
      bonusDamage: traits.reduce((sum, t) => sum + (t.stats.damage ?? 0), 0)
    };
  }
}
