/**
 * WHICH LAW A BODY STANDS UNDER (the fight's rebalance, part 3). A world that stood before the fight's law keeps its
 * creatures as written; a world laid under its ground (`BODIES_FROM_GROUND`) lays them by it, and says so on each
 * body (`IWorldEntity.law`). Every reader of what a body holds or deals asks here, never the definition alone.
 */

import { BODIES_FROM_GROUND } from '../../logic/theme/ThemeFormula';

export interface IBodyNumbers { baseHealth: number; baseDamage: number }

export const bodyLawOf = (
  def: { baseHealth: number; baseDamage: number; standing?: IBodyNumbers } | undefined,
  body: { law?: number } | undefined
): IBodyNumbers => {
  if (!def) return { baseHealth: 0, baseDamage: 0 };
  if ((body?.law ?? 0) >= BODIES_FROM_GROUND || !def.standing) return { baseHealth: def.baseHealth, baseDamage: def.baseDamage };
  return { baseHealth: def.standing.baseHealth, baseDamage: def.standing.baseDamage };
};

/** Does a world of this ground lay its bodies by the fight's law? */
export const laysByLaw = (groundVersion?: number): boolean => (groundVersion ?? 1) >= BODIES_FROM_GROUND;
