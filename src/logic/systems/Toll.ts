/**
 * THE TOLL (D93): "think an ogre under a bridge asking for a toll."
 *
 * A solitary elite holds one spot, and whoever passes pays or fights. It stops you, it says what it
 * wants, and it waits a while. It will not chase anyone who turns back. Standing in front of it past
 * the wait is an answer, and so is a shot.
 *
 * The gold goes to whoever owns the world. Pedro, 2026-11-01: "if the hub is the owner the hub keeps
 * it, if the player minted a gate that NPCs use the player keeps it, he pays taxes on land afterall,
 * the upkeep". A person who owns the world they cross pays themselves, so nothing moves. A stranger
 * crossing a world someone minted pays into that world's treasury, because another person's signed
 * bank is not this client's to write (D81). What is in there reaches its minter when wallets do (C3).
 *
 * The law here is pure. `TollDoor` moves the gold, and the prompt lives in `TollPrompt`.
 */

import { create } from 'zustand';
import { UniversalRank } from '../../../types';
import { isRosterElite } from '../../entities/world/Leaders';
import { ISectorState } from '../../entities/world/Population';
import { TERRITORY_NUMBERS, tollOwed } from '../theme/ThemeFormula';

export type TollStatus = 'IDLE' | 'ASKING' | 'CLEAR' | 'FIGHT';

export interface ITollLive {
  askedAt: Record<string, number>;
  paid: Record<string, true>;
  refused: Record<string, true>;
}

/** Who owns a world, as far as a toll cares: signed at its mint. */
export interface ITollWorld {
  id: string;
  creatorUid?: string;
  mintedWithDeed?: string;
}

export interface ITollMove {
  playerDelta: number;
  treasury?: { worldUid: string; delta: number };
}

interface ITollPromptState {
  asking: { entityId: string; owed: number; until: number } | null;
}

/** What is being asked of this person, for the prompt to read. */
export const useTollPrompt = create<ITollPromptState>(() => ({ asking: null }));

export class Toll {
  static GRACE_MS = TERRITORY_NUMBERS.tollGraceMs;
  static REACH_TILES = TERRITORY_NUMBERS.tollReachTiles;

  private static current: ITollLive = this.fresh();

  static fresh(): ITollLive {
    return { askedAt: {}, paid: {}, refused: {} };
  }

  static live(): ITollLive {
    return this.current;
  }

  static reset(): void {
    this.current = this.fresh();
    useTollPrompt.setState({ asking: null });
  }

  /** Does this kind ask? A solitary elite does. Anything with a pack has better things to do. */
  static asks(def: unknown): boolean {
    const kind = def as { tags?: string[]; social?: boolean } | undefined;
    return !!kind && isRosterElite(kind) && !kind.social;
  }

  static owed(rank: UniversalRank | string, bartering: number): number {
    return tollOwed(rank as UniversalRank, bartering);
  }

  static canPay(gold: number, owed: number): boolean {
    return gold >= owed;
  }

  /** One look at a person this far away. It keeps what it has been told for as long as the world stands open. */
  static meet(live: ITollLive, id: string, distTiles: number, owed: number, now: number): TollStatus {
    if (live.refused[id]) return 'FIGHT';
    if (live.paid[id]) return 'CLEAR';
    if (distTiles >= this.REACH_TILES) return 'IDLE';
    if (live.askedAt[id] === undefined) live.askedAt[id] = now;
    if (now - live.askedAt[id] > this.GRACE_MS) return 'FIGHT';
    return owed >= 0 ? 'ASKING' : 'IDLE';
  }

  static settled(live: ITollLive, id: string): void {
    live.paid[id] = true;
  }

  static refused(live: ITollLive, id: string): void {
    live.refused[id] = true;
  }

  /** Whose gold this becomes. Only a world minted with a deed is someone's. */
  static ownerOf(world: ITollWorld, hubId: string | null | undefined): { to: 'HUB' | 'MINTER'; uid: string } {
    if (world.mintedWithDeed && world.creatorUid) return { to: 'MINTER', uid: world.creatorUid };
    return { to: 'HUB', uid: hubId ?? world.id };
  }

  /** What moves when this person pays this much. */
  static moves(world: ITollWorld, hubId: string | null | undefined, payerUid: string, owed: number): ITollMove {
    const owner = this.ownerOf(world, hubId);
    if (owner.to === 'MINTER') {
      if (owner.uid === payerUid) return { playerDelta: 0 };
      return { playerDelta: -owed, treasury: { worldUid: world.id, delta: owed } };
    }
    return { playerDelta: -owed, treasury: { worldUid: owner.uid, delta: owed } };
  }

  /** What the last `waylay` took off whatever crossed its ground. */
  static lastTaken(state: Pick<ISectorState, 'leaders'>, id: string): number {
    return state.leaders[id]?.tollTaken ?? 0;
  }
}
