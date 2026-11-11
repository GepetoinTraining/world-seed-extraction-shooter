/**
 * THE PLAYER, AS THE SYSTEMS SEE IT. The player store owns the player's state and is the one writer
 * of it. A system that reads the player takes the player as an argument; a system that changes it
 * takes a port and hands its changes back as data, which the store applies through its `apply`.
 * No system imports the store. The same shape as the world's (src/entities/world/worldView.ts),
 * after the TTRPG engine's schema: a container owns its state, every change goes through one door.
 *
 * Every change is plain data, so it can be stored, sent and checked again (a player's additions are
 * checked by the hub on reconnect). Where a change follows a law, it names the law and its inputs,
 * and the store runs it; `SET` carries a whole player a law has already worked out.
 * Where the store's own law answers back (an item refused, a verdict on a move), the port carries
 * that call by name, and the store stays the one that runs it.
 *
 * This file imports types only, so reaching it reaches nothing else of the game.
 */
import type { EquipSlotId, IEscort, IItem, IPlayer, UniversalRank } from '../../../shared/types';
import type { Verdict } from '../../../shared/entities/player/systems/LoadoutSystem';
import type { ISkillPair } from '../../../shared/logic/systems/WebSystem';
import type { ProcessFamily } from '../../../shared/logic/systems/ProcessSystem';
import type { IActionContext } from './systems/SkillDiscovery';

/** What a system may read of the player. */
export interface IPlayerView {
  player: IPlayer;
}

/** Every change a system may hand the player store. It applies them in order. */
export type PlayerChange =
  /** A whole player, worked out by a law from the one read: it replaces the one that stands. */
  | { kind: 'SET'; player: IPlayer }
  /** Gold in the bank, up or down. */
  | { kind: 'GOLD'; delta: number }
  /** Into the stash's first tab, and out of it. */
  | { kind: 'STASH_ADD'; items: IItem[] }
  | { kind: 'STASH_REMOVE'; ids: string[] }
  /** The bank's lore, as a law worked it out. */
  | { kind: 'LORE'; lore: IPlayer['bank']['lore'] }
  /** The field pack: in, out (its place on the grid with it), and one piece changed in place. */
  | { kind: 'PACK_ADD'; items: IItem[] }
  | { kind: 'PACK_REMOVE'; itemId: string }
  | { kind: 'PACK_REPLACE'; item: IItem }
  /** Mended to full, on the body and in the stash. */
  | { kind: 'REPAIR'; itemId: string }
  /** What follows the person in the field: the tamed (until when) and the escorts. */
  | { kind: 'TAMED_ADD'; tamed: { entityId: string; item: IItem; until: number } }
  | { kind: 'TAMED_EXPIRE'; now: number }
  | { kind: 'TAMED_CLEAR' }
  | { kind: 'ESCORTS'; escorts: IEscort[] }
  /** Laws the store runs by name: studies queued for the night, waking, a dream filed or cleared, a node accrued. */
  | { kind: 'QUEUE_STUDY'; ids: string[] }
  | { kind: 'WAKE' }
  | { kind: 'PENDING_DREAM'; dream?: IPlayer['pendingDream'] }
  | { kind: 'ACCRUE'; node: ISkillPair; rank: number }
  /** The store's own steps that answer nothing back. */
  | { kind: 'RECALC_WEIGHT' }
  | { kind: 'WORK_ON'; pair: ISkillPair; rank: number; xp: number; costly?: boolean }
  | { kind: 'PRACTICE_TRADE'; family: ProcessFamily }
  | { kind: 'GAIN_SKILL_XP'; skillId: string; amount: number; tags: string[]; context?: IActionContext }
  | { kind: 'DIVE'; layerId?: string }
  | { kind: 'DROP_ITEM'; itemId: string }
  | { kind: 'TOGGLE_CARRY'; itemId: string };

/** The store's own calls that answer back. Its law runs them; a system only asks. */
export interface IPlayerCalls {
  tryAddItems(items: IItem[]): { added: IItem[]; rejected: IItem[] };
  applyKillXp(amount: number): { leveledUp: boolean; from: number; to: number; pointsGranted: number };
  grantRank(to?: UniversalRank): { granted: boolean; from: UniversalRank; to: UniversalRank };
  placeInPack(itemId: string, x: number, y: number, rotated: boolean): Verdict;
  placeInStash(itemId: string, x: number, y: number, rotated: boolean): Verdict;
  stowInPouch(pouchSlot: EquipSlotId, itemId: string): Verdict;
  equipSwap(itemId: string, slotId?: EquipSlotId): Verdict;
  unequipFromSlot(slotId: EquipSlotId): Verdict;
  placeOnCart(entityId: string, itemId: string, x: number, y: number, rotated: boolean): Verdict;
  loadCart(entityId: string, itemId: string): Verdict;
  unloadCart(entityId: string, itemId: string): Verdict;
  takeFromCache(entityId: string, itemId: string): Verdict;
  /** One material set on another: both are used, and an unread thing comes of it (PairCraft). */
  combine(itemId: string, ontoId: string): Verdict;
}

/**
 * The player as a system takes it: a fresh view on each read, the one door its changes go through,
 * and the store's calls that answer back. The store hands its own (`playerPort`); a test can hand any.
 */
export interface IPlayerPort extends IPlayerCalls {
  view(): IPlayerView;
  apply(...changes: PlayerChange[]): void;
  /** Told each time the player changes, with the player before. Returns the way to stop. */
  watch(listener: (now: IPlayer, before: IPlayer) => void): () => void;
}
