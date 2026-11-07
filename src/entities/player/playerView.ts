/**
 * THE PLAYER, AS THE SYSTEMS SEE IT. The player store owns the player's state and is the one writer
 * of it. A system that reads the player takes the player as an argument; a system that changes it
 * takes a port and hands its changes back as data, which the store applies through its `apply`.
 * No system imports the store. The same shape as the world's (src/entities/world/worldView.ts),
 * after the TTRPG engine's schema: a container owns its state, every change goes through one door.
 *
 * Most of a player's changes are bespoke, so one kind (`UPDATE`) carries a pure step over the
 * player, applied to the player as it stands when it lands. The common ones have kinds of their own.
 * Where the store's own law answers back (an item refused, a verdict on a move), the port carries
 * that call by name, and the store stays the one that runs it.
 *
 * This file imports types only, so reaching it reaches nothing else of the game.
 */
import type { EquipSlotId, IItem, IPlayer } from '../../../shared/types';
import type { Verdict } from '../../../shared/entities/player/systems/LoadoutSystem';
import type { ISkillPair } from '../../../shared/logic/systems/WebSystem';
import type { IActionContext } from './systems/SkillDiscovery';

/** What a system may read of the player. */
export interface IPlayerView {
  player: IPlayer;
}

/** Every change a system may hand the player store. It applies them in order. */
export type PlayerChange =
  /** A whole player, worked out by a law from the one read: it replaces the one that stands. */
  | { kind: 'SET'; player: IPlayer }
  /** A pure step over the player, applied to the player as it stands when it lands. */
  | { kind: 'UPDATE'; update: (player: IPlayer) => IPlayer }
  /** Gold in the bank, up or down. */
  | { kind: 'GOLD'; delta: number }
  /** Into the stash's first tab, and out of it. */
  | { kind: 'STASH_ADD'; items: IItem[] }
  | { kind: 'STASH_REMOVE'; ids: string[] }
  /** The store's own steps that answer nothing back. */
  | { kind: 'RECALC_WEIGHT' }
  | { kind: 'WORK_ON'; pair: ISkillPair; rank: number; xp: number }
  | { kind: 'GAIN_SKILL_XP'; skillId: string; amount: number; tags: string[]; context?: IActionContext }
  | { kind: 'DIVE'; layerId?: string }
  | { kind: 'DROP_ITEM'; itemId: string }
  | { kind: 'TOGGLE_CARRY'; itemId: string };

/** The store's own calls that answer back. Its law runs them; a system only asks. */
export interface IPlayerCalls {
  tryAddItems(items: IItem[]): { added: IItem[]; rejected: IItem[] };
  applyKillXp(amount: number): { leveledUp: boolean; from: number; to: number; pointsGranted: number };
  placeInPack(itemId: string, x: number, y: number, rotated: boolean): Verdict;
  placeInStash(itemId: string, x: number, y: number, rotated: boolean): Verdict;
  stowInPouch(pouchSlot: EquipSlotId, itemId: string): Verdict;
  equipSwap(itemId: string, slotId?: EquipSlotId): Verdict;
  unequipFromSlot(slotId: EquipSlotId): Verdict;
  placeOnCart(entityId: string, itemId: string, x: number, y: number, rotated: boolean): Verdict;
  loadCart(entityId: string, itemId: string): Verdict;
  unloadCart(entityId: string, itemId: string): Verdict;
  takeFromCache(entityId: string, itemId: string): Verdict;
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
