/**
 * What a hub layout is made of. Apart from HubGenerator so the manifest can name
 * these kinds without the generator and the manifest loading each other.
 */

export enum POIType {
  // Core Services
  BANK = 'BANK',
  PORTAL = 'PORTAL',
  IDENTIFIER = 'IDENTIFIER',
  GUILD_HALL = 'GUILD_HALL',

  // Commerce
  VENDOR_WEAPONS = 'VENDOR_WEAPONS',
  VENDOR_ARMOR = 'VENDOR_ARMOR',
  VENDOR_CONSUMABLES = 'VENDOR_CONSUMABLES',
  AUCTION_HOUSE = 'AUCTION_HOUSE',

  // Social
  TAVERN = 'TAVERN',
  ARENA = 'ARENA',

  // Player-Owned
  PLAYER_LOT = 'PLAYER_LOT',

  // Decorative
  FOUNTAIN = 'FOUNTAIN',
  STATUE = 'STATUE',
  LAMP_POST = 'LAMP_POST'
}

export enum ZoneType {
  PLAZA = 'PLAZA',
  MARKET = 'MARKET',
  RESIDENTIAL = 'RESIDENTIAL',
  INDUSTRIAL = 'INDUSTRIAL',
  GARDEN = 'GARDEN'
}

export interface IPOI {
  id: string;
  type: POIType;
  name: string;
  position: { x: number; y: number };
  size: { width: number; height: number };
  interactable: boolean;
  npcId?: string;
  ownerId?: string; // For player lots
  metadata: Record<string, any>;
}

export interface IHubZone {
  id: string;
  name: string;
  type: ZoneType;
  bounds: { x: number; y: number; width: number; height: number };
  pois: IPOI[];
  ambientColor: string;
  floorTexture: string;
}

/** A raised chunk: where it stands on the ground, and at which tile of this layout. */
export interface IPlacedChunk {
  cx: number;
  cy: number;
  kind: string;
  x: number;
  y: number;
}

export interface IHubLayout {
  id: string;
  name: string;
  version: string;
  width: number;
  height: number;
  zones: IHubZone[];
  spawnPoint: { x: number; y: number };
  navMesh: boolean[][]; // true = walkable
  /** Every chunk raised, in the order they rose. The first is the middle one. */
  chunks: IPlacedChunk[];
  /** The tile the first chunk starts at. It moves when a chunk rises north or west. */
  origin: { x: number; y: number };
}
