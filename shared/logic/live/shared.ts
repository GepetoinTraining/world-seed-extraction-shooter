/**
 * WHAT A WORLD PLAYED LIVE SHARES (server/live/room.ts, LiveClient.ts). Only these documents of our
 * hosted world live on our server: its chests, its carts, its population, its director. Everything
 * else stays in the player's browser, by name and not by accident: a personal chest inside an
 * owner's house is the browser's (Pedro, 2026-11-04: "personal chest inside an owner's house are
 * controlled by idb, we don't care what's in them because we know what generated them"), and what
 * comes out of one is checked when it is brought online (ItemLaw.ts), never what sits in it.
 */
export const SHARED_FAMILIES = ['world_chests_', 'world_carts_', 'world_population_', 'director_'] as const;

/** Is this document one of the world's shared ones? Its id is exactly a family and the world's uid. */
export const isShared = (worldUid: string, id: unknown): boolean =>
  typeof id === 'string' && SHARED_FAMILIES.some(f => id === `${f}${worldUid}`);

/**
 * A world's chests are claimed one at a time, never written whole (Pedro, 2026-11-04: "queue it,
 * the first or best lag gets the first spot, the write happens AFTER"). A claim says what its player
 * saw of the chest; the room takes claims in the order they reach it, and the first one that still
 * matches what stands wins. The write is the room's, after.
 */
export type ChestIntent =
  | { op: 'loot'; chestId: string; cycle: number; saw: number | null }
  | { op: 'fell'; guardId: string; cycle: number };
