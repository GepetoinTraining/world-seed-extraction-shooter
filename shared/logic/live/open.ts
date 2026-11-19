/**
 * WORLDS OPEN ON A HUB (server/hub/open.ts, src/logic/live/OpenWorlds.ts). Pedro, 2026-11-18: "we need
 * to make the multiplayer always on WHEN someone is in server... if there's a web socket we log people
 * into to it, unless they choose to host their own, then we tunnel theirs as an option like old
 * warcraft 3 used to do".
 *
 * The hub is the lobby. It lists every world open on it: the one its operator hosts, and each one a
 * player opened. Whoever is signed in has them among their zones with no step of their own, and
 * entering one is playing it live with everyone in it.
 *
 * A player's own world is opened by its maker. While it is open, what its players share is kept in the
 * hub's room, which is the tunnel: nobody reaches the host's machine. The host's game says it is still
 * there on a beat; a host that stops saying so is not listed, and is listed again when it comes back.
 */

/** How often a host's game says its open worlds are still open. */
export const OPEN_BEAT_MS = 60_000;
/** How long a host's last word keeps a world listed: three beats missed. */
export const OPEN_FOR_MS = 3 * OPEN_BEAT_MS;

export interface IOpenWorldRow {
  worldUid: string;
  name: string;
  themeId: string;
  /** Who keeps it open: the hub itself, or a player. */
  by: 'HUB' | 'PLAYER';
  /** The host's name as its character carries it. The hub's own world has none. */
  host: string | null;
  /** This account opened it. */
  mine: boolean;
  /** Its host said so within OPEN_FOR_MS. Only one's own are listed while this is false. */
  answering: boolean;
  openedAt: number;
}

/** What a world's maker sends to open it, and what the hub hands to whoever enters it. */
export interface IOpenManifest {
  world: { worldUid: string; name: string; creatorCertUid: string; themeId: string; [more: string]: unknown };
  /** The world's own certificate, which a game saves and lists as it lists any world. */
  certificate?: Record<string, any>;
  themes: any[];
  /** What its minting added (MintAdditionsWriter): the same land for everyone needs the same additions. */
  mint?: Record<string, any> | null;
  [more: string]: unknown;
}

/** The status a room answers a request on a world that is not open any more with. A game then plays on from its own copy. */
export const NOT_OPEN_STATUS = 410;
