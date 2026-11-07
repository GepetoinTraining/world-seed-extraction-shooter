/**
 * THE WORLD, AS THE SYSTEMS SEE IT. The world store owns the world's state and is the one writer
 * of it. A system that reads the world takes a view of it as an argument; a system that changes it
 * hands back what changed, as data, and the store applies it. No system imports the store.
 *
 * The shape is the TTRPG engine's (docs/db-schema.md, Ω): a container owns its domain state, and
 * every change to it goes through one typed action union. Here that union is `WorldChange`, and
 * the one door it goes through is the store's `apply`.
 *
 * This file holds types and three small readers, so reaching it reaches nothing else of the game.
 */
import type { IMap, IWorldEntity } from '../../../shared/entities/world/types';
import type { IPlayer, UniversalRank } from '../../../shared/types';
import type { IDirectorRecord } from '../../../shared/entities/world/Director';
import type { IPopulationRecord } from '../../../shared/entities/world/Population';
import type { IKoseki } from '../../../shared/entities/world/Koseki';
import type { IChestRecord } from '../../../shared/entities/world/ChestSystem';
import type { ICadence, IClockedWorld, SkyKind } from './WorldClock';

export interface IWorldCard extends IClockedWorld {
  id: string;
  seed: string;
  size: number;
  createdAt: number;
  cadence?: ICadence;
  sky?: SkyKind;
  playerCount: number;
  isDebug?: boolean;
  /** Q14: the tutorial world, a newcomer's first order. It stands outside the clock (`isDebug`). */
  isTutorial?: boolean;
  name: string;
  difficulty: string;
  creator: string;
  extractionTaxRate: number; // Wave 2.5: the hub's cut, from the world cert
  // Wave 4.4: enforced world rules
  deathPenalty: 'NONE' | 'INVENTORY_LOSS' | 'XP_LOSS' | 'PERMADEATH';
  ipCap?: UniversalRank;
  ipFloor?: UniversalRank;
  // Wave 10E (D20): the content-pack version pinned at mint. Absent = minted
  // before the banks; the world keeps the purged legacy pool, forever.
  packVersion?: number;
  // D27: the web this world's people are read through. Absent = the first version.
  webVersion?: number;
  /**
   * D53: the theme it reads. Pedro (Q43): a world never retires, so a world minted before themes,
   * or pinned to one this hub does not hold, reads the hub's own theme (`ContentRegistry.standing`).
   */
  themeId?: string;
  magicUnlocked?: boolean;
  /** Who minted it, whole, and the deed they spent. A toll's gold reads these (`Toll.ownerOf`). */
  creatorUid?: string;
  mintedWithDeed?: string;
}

/** One scanned sector of a person's survey of a world. */
export type ISurveyEntry = NonNullable<IPlayer['survey']>[string][string];

/** What a system may read of the world: the store's state, without its doors. */
export interface IWorldView {
  availableWorlds: IWorldCard[];
  activeWorldId: string | null;
  currentMap: IMap | null;
  generation: number;
  directorRecord: IDirectorRecord | null;
  populationRecord: IPopulationRecord | null;
  chestRecord: IChestRecord | null;
}

/** Every change a system may ask of the world. The store applies them in order. */
export type WorldChange =
  | { kind: 'ADD_BODY'; entity: IWorldEntity }
  | { kind: 'UPDATE_BODY'; entityId: string; patch: Partial<IWorldEntity> }
  | { kind: 'REMOVE_BODY'; entityId: string }
  /** A body caught: off its count and onto a register (`Population.captured`). */
  | { kind: 'CAPTURED'; entityId: string; definitionId: string; to: IKoseki }
  /** A body let go on a ground (`Population.release`). */
  | { kind: 'RELEASED'; ground: string; definitionId: string }
  /** A world's record, newly read or newly grown, taken if that world is the one open. */
  | { kind: 'ADOPT_RECORD'; worldId: string; record: IDirectorRecord }
  /** A person's survey of the open world, laid over its sectors. */
  | { kind: 'APPLY_SURVEY'; survey: Record<string, ISurveyEntry> | undefined }
  /** One more drop counted into a world (Q41). */
  | { kind: 'DROP_COUNTED'; worldId: string }
  /** A store robbed, and a chest opened, in the open world. */
  | { kind: 'STORE_TAKEN'; structureId: string; count: number }
  | { kind: 'CHEST_LOOTED'; chestId: string }
  /** The open world's chest record, as a live room holds it. */
  | { kind: 'CHEST_RECORD'; record: IChestRecord };

/**
 * The world as a system takes it: a fresh view each time it reads, and the one door its changes go
 * through. The store hands its own (`worldPort`); a test can hand any.
 */
export interface IWorldPort {
  view(): IWorldView;
  apply(...changes: WorldChange[]): void;
  /** Open a world: the store loads its records and lays its map. The one call that waits. */
  open(worldId: string): Promise<void>;
}

/** Every body on the loaded map. */
export const bodiesOf = (view: IWorldView): IWorldEntity[] =>
  Object.values(view.currentMap?.chunks ?? {}).flatMap(c => c.entities);

/** One body on the loaded map, by id. */
export const bodyOf = (view: IWorldView, id: string): IWorldEntity | undefined =>
  bodiesOf(view).find(e => e.id === id);

/** The card of the world that is open, if one is. */
export const openCard = (view: IWorldView): IWorldCard | undefined =>
  view.availableWorlds.find(w => w.id === view.activeWorldId);
