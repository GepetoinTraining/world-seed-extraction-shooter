/**
 * THE GRID: one set of nested cells for every world.
 *
 *   tile     1 tile        20px     what terrain is decided on
 *   quadrant 16 tiles      320px    what things are placed in and art is cached by
 *   chunk    64 tiles      1280px   what is generated on demand and simulated
 *   sector   512 tiles     10240px  what you scan and drop into
 *
 * A world's size is counted in sectors. GRID_VERSION is stamped on every new world,
 * because a world built on an older grid cannot be walked on this one.
 */

export const GRID_VERSION = 2;

export const TILE_PX = 20;
export const QUADRANT_TILES = 16;
export const CHUNK_QUADRANTS = 4;
export const SECTOR_CHUNKS = 8;

export const CHUNK_TILES = QUADRANT_TILES * CHUNK_QUADRANTS;
export const SECTOR_TILES = CHUNK_TILES * SECTOR_CHUNKS;
export const QUADRANT_PX = QUADRANT_TILES * TILE_PX;
export const CHUNK_PX = CHUNK_TILES * TILE_PX;
export const SECTOR_PX = SECTOR_TILES * TILE_PX;

export const tileOf = (px: number) => Math.floor(px / TILE_PX);
export const quadrantOf = (px: number) => Math.floor(px / QUADRANT_PX);
export const chunkOf = (px: number) => Math.floor(px / CHUNK_PX);
export const sectorOf = (px: number) => Math.floor(px / SECTOR_PX);

/** The middle of a tile, in px: where anything placed on the grid stands. */
export const tileCenter = (tile: number) => tile * TILE_PX + TILE_PX / 2;
