/**
 * WHAT A WORLD GROWS (D64, D69): new words that stand in that world's own record.
 *
 * Signing takes a world out of its minter's hands, and it goes on living. Its pinned
 * pack never changes: what grows stands beside it, as a descendant does, under ids of
 * its own, so no other world on that pack can read it and nothing here moves a pin.
 *
 * Pure. The record and the tables meet in `CreatureLines` and `ContentRegistry`.
 */

import type { ILineRecord } from './CreatureLines';
import { compileTheme, ICompiledTheme, keyIdsOf } from './ThemeCompiler';
import { IThemeBody, IThemePack } from './ThemeTypes';

export interface IThemeGrowth {
  creatures: IThemeBody['creatures'];
  materials: IThemeBody['materials'];
  affixes: IThemeBody['affixes'];
  abilities: IThemeBody['abilities'];
  tags: IThemeBody['tags'];
  lore: string[];
}

/** One answer's worth of growth, and the scope its ids hang from. */
export interface IGrownBatch {
  scope: string;
  order: string;
  /** The regeneration it came in at. On the record, and not in its hash. */
  bornAt: number;
  growth: IThemeGrowth;
}

/** What a model hears of a world when it writes about it. */
export interface IWorldSummary {
  name: string;
  premise: string;
  tags: IThemeBody['tags'];
  regions: IThemeBody['regions'];
  abilities: { key: string; name: string; blurb: string }[];
  creatures: { key: string; name: string }[];
  materials: { key: string; name: string }[];
  affixes: { key: string; name: string }[];
}

const grownOf = (lines: ILineRecord | undefined): IGrownBatch[] => lines?.grown ?? [];

export class WorldGrowth {

  static isEmpty(growth: IThemeGrowth | undefined): boolean {
    if (!growth) return true;
    return growth.creatures.length + growth.materials.length + growth.affixes.length + growth.abilities.length + growth.lore.length === 0;
  }

  /** A pack and what grew, read together: what the law judges, and what a model is told stands. */
  static grownBody<T extends IThemeBody>(theme: T, growth: IThemeGrowth): T {
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

  /** The pack as this world's record reads it. The pinned pack itself is not touched. */
  static packWith(pack: IThemePack, lines: ILineRecord | undefined): IThemePack {
    return grownOf(lines).reduce((at, batch) => this.grownBody(at, batch.growth), pack);
  }

  static summary(pack: IThemePack): IWorldSummary {
    const named = (list: { key: string; name: string }[]) => list.map(({ key, name }) => ({ key, name }));
    return {
      name: pack.name, premise: pack.premise, tags: pack.tags, regions: pack.regions,
      abilities: pack.abilities.map(({ key, name, blurb }) => ({ key, name, blurb })),
      creatures: named(pack.creatures), materials: named(pack.materials), affixes: named(pack.affixes)
    };
  }

  /**
   * Each batch's own definitions, under its own scope. A key it did not write reads the
   * id it already has, so a grown creature that knows a pinned ability knows that one.
   */
  static compile(pack: IThemePack, lines: ILineRecord | undefined): ICompiledTheme[] {
    let known = keyIdsOf(pack);
    return grownOf(lines).map(batch => {
      const own: IThemePack = {
        ...pack, themeId: batch.scope,
        tags: [], regions: [], stations: [], goods: [], gear: [], consumables: [],
        creatures: batch.growth.creatures, materials: batch.growth.materials, affixes: batch.growth.affixes,
        abilities: batch.growth.abilities, lore: batch.growth.lore
      };
      const compiled = compileTheme(own, known);
      known = new Map([...known, ...keyIdsOf(own)]);
      return compiled;
    });
  }
}
