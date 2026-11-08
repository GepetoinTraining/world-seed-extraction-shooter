/**
 * THE TECH WEB, AS ITS OWN CONTAINER. Pedro, 2026-11-07: "This is the most important store actually,
 * because from it everything comes": every stat off the character sheet, every skill, every affix and
 * suffix, whatever study names, roots here (the human-tool dyad). It lives inside the hub store, but
 * its state, its changes and its door are its own, so a hub's tech web can be read, changed and later
 * compared with another (a player's local copy, started at tech web 0, against the online hub's).
 *
 * Its state is the web the hub has reached (`web`) and the hub's tech that reaches it (`tech`: the
 * chain, the workshops, the asks, the professions, the ledger). Every change to either goes through
 * the hub store's `applyTech`, and every change is plain data.
 *
 * This file imports types only.
 */
import type { IHubWeb } from '../../../shared/types';
import type { IChainRound } from '../../../shared/logic/theme/ChainWeb';
import type { IBuildingAsk, IHubTech, IWorkshop } from './hubTech';

/** What may be read of the tech web. */
export interface ITechWebView {
  web: IHubWeb;
  tech: IHubTech;
}

/** Every change to the tech web. The hub store applies them in order. */
export type TechWebChange =
  /** The whole web or the whole tech, as a law worked it out (a load, a reach, a person settled in silently). */
  | { kind: 'WEB'; web: IHubWeb }
  | { kind: 'TECH'; tech: IHubTech }
  /** What a person asked to have raised. */
  | { kind: 'ASK'; residentId: string; ask: IBuildingAsk }
  /** A workshop given, its bill pooled into (raised once met), and those finished standing from a moment. */
  | { kind: 'WORKSHOP_ADD'; workshop: IWorkshop }
  | { kind: 'WORKSHOP_POOL'; workshopId: string; pool: IWorkshop['pool']; raised: boolean }
  | { kind: 'WORKSHOPS_STAND'; ids: string[]; at: number }
  /** A round of a person's chain, judged sound: merged into the hub's chain and onto its ledger. */
  | { kind: 'CHAIN_ROUND'; round: IChainRound; residentId: string; at: number }
  /** Where a person's chain resolution stands. */
  | { kind: 'RESOLVING'; residentId: string; state: IHubTech['resolving'][string] };

/** The tech web as a system takes it. */
export interface ITechWebPort {
  view(): ITechWebView;
  apply(...changes: TechWebChange[]): void;
}
