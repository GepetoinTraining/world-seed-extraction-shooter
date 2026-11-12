/**
 * WHICH LAW A BODY STANDS UNDER (the fight's rebalance, part 3). A world that stood before the fight's law keeps its
 * creatures as written; a world laid under its ground (`BODIES_FROM_GROUND`) lays them by it, and says so on each
 * body (`IWorldEntity.law`). Every reader of what a body holds or deals asks here, never the definition alone.
 *
 * From `RANKED_FROM_GROUND` a body takes the rank of the ground it stands on (GS3): its kind is a noun, chosen where it
 * stands as before, and what it holds and deals is its kind's, doubled a rank from the kind's to the body's own.
 */

import { BODIES_FROM_GROUND, RANKED_FROM_GROUND, bodyScale } from '../../logic/theme/ThemeFormula';

export interface IBodyNumbers { baseHealth: number; baseDamage: number }

export const bodyLawOf = (
  def: { baseHealth: number; baseDamage: number; standing?: IBodyNumbers; rank?: string } | undefined,
  body: { law?: number; rank?: string } | undefined
): IBodyNumbers => {
  if (!def) return { baseHealth: 0, baseDamage: 0 };
  if ((body?.law ?? 0) >= BODIES_FROM_GROUND || !def.standing) {
    if (!laidByRank(def, body)) return { baseHealth: def.baseHealth, baseDamage: def.baseDamage };
    // The body's numbers are its kind's, doubled once a rank from the kind's to the ground's (BALANCE_RUN 1.2, call 1)
    const by = bodyScale(body!.rank!) / bodyScale(def.rank!);
    return { baseHealth: Math.max(1, Math.round(def.baseHealth * by)), baseDamage: Math.max(1, Math.round(def.baseDamage * by)) };
  }
  return { baseHealth: def.standing.baseHealth, baseDamage: def.standing.baseDamage };
};

/** Does a world of this ground lay its bodies by the fight's law? */
export const laysByLaw = (groundVersion?: number): boolean => (groundVersion ?? 1) >= BODIES_FROM_GROUND;

/** Does a world of this ground give each body the rank of the ground it stands on? */
export const ranksByGround = (groundVersion?: number): boolean => (groundVersion ?? 1) >= RANKED_FROM_GROUND;

/** A body laid at a rank other than its kind's, under a ground that does so. */
const laidByRank = (def: { rank?: string }, body: { law?: number; rank?: string } | undefined): boolean =>
  (body?.law ?? 0) >= RANKED_FROM_GROUND && !!body?.rank && !!def.rank && body.rank !== def.rank;

/**
 * The kind as this body stands: its rank the body's own where its ground gave it one (GS3). What it leaves is found at
 * that rank and rolled on its table at that rank, as a piece takes the rank of where it came from.
 */
export const laidKind = <T extends { rank: any }>(def: T, body: { law?: number; rank?: string } | undefined): T =>
  laidByRank(def, body) ? { ...def, rank: body!.rank } : def;
