/**
 * THE TUTORIAL WORLD (Q2, Q14): a newcomer's first order.
 *
 * The debug world became this. It stands outside the clock, as the debug world did, and
 * nothing a person brings into it is lost there: a death costs nothing (the "500 G" of Q14).
 * Everywhere else the first death is as hard as it always was (Q11).
 *
 * It teaches in order: the drone scans one known block, and only that block; the drop goes
 * there; the field shows a contact and what to do about it; an arrow points the way out.
 * It stays open while a person's own world is being written.
 *
 * Nothing here points at a boss (Q46): the known block is chosen by threat and place alone.
 */

import { IPlayer, UniversalRank } from '../../../shared/types';
import { ContentRegistry } from '../../../shared/logic/theme/ContentRegistry';
import { GROUND_VERSION } from '../../../shared/entities/world/WorldGenerator';
import { IMap, ISector, ScanLevel } from '../../../shared/entities/world/types';
import type { IWorldCard } from '../../entities/world/worldView';

export const TUTORIAL_WORLD_ID = 'tutorial';
const TUTORIAL_SEED = 'dev-sandbox-v4';
const TUTORIAL_SIZE = 32;

/** The lessons, in order. Each is done before the next is taught. */
export type TutorialStep = 'SCAN' | 'DROP' | 'CONTACT' | 'EXTRACT' | 'SEALED';

export interface ITutorialProgress {
  /** The known block's survey reads deep enough to show who stands on it. */
  scanned: boolean;
  /** A session is open in the tutorial's field. */
  inField: boolean;
  /** A hostile body has come within sight of the person, at some time this run. */
  metContact: boolean;
  /** A hostile body is within sight now. */
  contactNear?: boolean;
  /** The first order was sealed: an extraction from the tutorial. */
  sealed: boolean;
}

/** What each lesson says. Game words: these are on the screen. */
export const LESSONS: Record<TutorialStep, { title: string; body: string }> = {
  SCAN: {
    title: 'FIRST ORDER — SCAN THE MARKED BLOCK',
    body: 'The drone reads a world from above before anyone drops. In the tutorial it reads one block: the one marked. Click it or press SPACE on it, and again to read deeper, until it shows who stands there.'
  },
  DROP: {
    title: 'FIRST ORDER — DROP ON IT',
    body: 'You know the ground now: its threat, its way out, its contacts. Press ENTER, or CONFIRM DROP, to go down on the block you read.'
  },
  CONTACT: {
    title: 'FIRST ORDER — THE CONTACTS',
    body: 'Bodies on this ground are hostile and come for you once they notice you. SPACE or the mouse fires where you aim; Q reads what is near. Walking away breaks a chase. Harm here costs nothing you carry.'
  },
  EXTRACT: {
    title: 'FIRST ORDER — THE WAY OUT',
    body: 'Follow the arrow to the beacon. Stand at it and press E: hold still while it channels, because harm breaks it. Anywhere but here, dying drops everything you carry into the world.'
  },
  SEALED: {
    title: 'FIRST ORDER — SEALED',
    body: 'You came out. Every other world keeps what falls with you. The tutorial stays open while your own world is written.'
  }
};

export class Tutorial {
  /** The tutorial's card on the zones list. No certificate: it is the hub's own, and outside the clock. */
  static card(now: number): IWorldCard {
    return {
      themeId: ContentRegistry.defaultThemeId(),
      id: TUTORIAL_WORLD_ID,
      seed: TUTORIAL_SEED,
      size: TUTORIAL_SIZE,
      createdAt: now,
      // Q41: no fixed count. It has no certificate to record a visit in.
      playerCount: 0,
      isDebug: true,
      isTutorial: true,
      name: 'THE TUTORIAL',
      difficulty: UniversalRank.F,
      creator: 'THE NEXUS',
      extractionTaxRate: 0.05,
      // Q14: nothing brought in is lost here
      deathPenalty: 'NONE',
      // C24: it has no certificate to pin a ground in, so it is laid by the ground of the day: a stone to throw lies near the drop
      groundVersion: GROUND_VERSION
    };
  }

  static isTutorial(card: Pick<IWorldCard, 'isTutorial'> | undefined | null): boolean {
    return !!card?.isTutorial;
  }

  /** The first order stands until the person has sealed a run out of the tutorial. */
  static firstOrderOpen(player: Pick<IPlayer, 'tutorialSealedAt'>): boolean {
    return !player.tutorialSealedAt;
  }

  /**
   * The known block: the lowest threat on the map, nearest its middle, then by place.
   * It reads only what every sector's summary holds, so it is the same for everyone.
   */
  static knownBlock(map: Pick<IMap, 'width' | 'height' | 'sectors'>): { x: number; y: number } {
    const order = Object.values(UniversalRank) as string[];
    const cx = Math.floor(map.width / 2), cy = Math.floor(map.height / 2);
    const best = [...Object.values(map.sectors)].sort((a, b) =>
      order.indexOf(String(a.difficulty)) - order.indexOf(String(b.difficulty))
      || Math.hypot(a.x - cx, a.y - cy) - Math.hypot(b.x - cx, b.y - cy)
      || a.y - b.y || a.x - b.x)[0];
    return best ? { x: best.x, y: best.y } : { x: cx, y: cy };
  }

  static isKnownBlock(map: Pick<IMap, 'width' | 'height' | 'sectors'>, x: number, y: number): boolean {
    const at = this.knownBlock(map);
    return at.x === x && at.y === y;
  }

  /** In the tutorial the drone reads the known block and nothing else. */
  static mayScan(map: Pick<IMap, 'width' | 'height' | 'sectors'>, x: number, y: number): { ok: boolean; reason?: string } {
    if (this.isKnownBlock(map, x, y)) return { ok: true };
    return { ok: false, reason: 'In the tutorial the drone reads one block: the marked one. In your own worlds it reads wherever you aim it.' };
  }

  /** The drop goes on the known block, once it has been read deep enough to show its contacts. */
  static mayDrop(map: Pick<IMap, 'width' | 'height' | 'sectors'>, x: number, y: number): { ok: boolean; reason?: string } {
    if (!this.isKnownBlock(map, x, y)) return { ok: false, reason: 'The tutorial drops on the marked block, the one you read.' };
    const sector: ISector | undefined = map.sectors[`${x},${y}`];
    if (!sector || sector.scanLevel < ScanLevel.DETAILED) return { ok: false, reason: 'Read the marked block deeper first: scan it again until it shows its contacts.' };
    return { ok: true };
  }

  /**
   * Which lesson stands now. In the field the contact lesson stands until one has been met
   * and none is near, so it is read while it matters; then the way out.
   */
  static step(p: ITutorialProgress): TutorialStep {
    if (p.sealed) return 'SEALED';
    if (!p.inField) return p.scanned ? 'DROP' : 'SCAN';
    return p.metContact && !p.contactNear ? 'EXTRACT' : 'CONTACT';
  }

  /** A lesson's title: the first order's while it stands, the tutorial's after. */
  static titleOf(step: TutorialStep, firstOrder: boolean): string {
    const title = LESSONS[step].title;
    return firstOrder ? title : title.replace(/^FIRST ORDER/, 'THE TUTORIAL');
  }

  /** How near a hostile body must come for the contact lesson, in px: about what the screen shows around you. */
  static readonly CONTACT_RANGE_PX = 360;
}
