/**
 * HubGenerator - Builds a city's layout from its manifest and its plan
 * Unlike WorldGenerator (procedural extraction zones), a Hub is FIXED: the same
 * manifest and the same plan give the same city, wherever it is planted.
 * Think Carleon from Albion, or Stormwind from WoW.
 */

import { UniversalRank } from '../../../types';
import { CHUNK_TILES } from '../world/grid';
import { IHubLayout, IHubZone, IPOI, IPassage, IPlacedChunk, IRoadCell, POIType, ZoneType } from './layoutTypes';
import {
  CELL_TILES, DISMEMBER_PIECE_MIN, EMPTY_MARK, FARMLAND_KIND, IChunkManifest, IHubManifest, IHubPlan, NEW_CARLEON, ROAD_MAIN,
  dismemberShape, doorTile, firstPlan, lotPrice, lotPriceShare, resolveChunk, tilesToCell
} from './hubManifest';

export { POIType, ZoneType };
export type { IHubLayout, IHubZone, IPOI, IPassage, IPlacedChunk, IRoadCell };

// =============================================================================
// NPC DEFINITIONS
// =============================================================================

export interface INPCDefinition {
  id: string;
  name: string;
  title: string;
  dialogue: {
    greeting: string;
    options: { label: string; action: string; payload?: any }[];
  };
  spriteColor: string;
  /** A general vendor: it trains people up, at the rank its own sheet is dealt. What it teaches has no name of its own. */
  teaches?: { rank: UniversalRank };
}

export const HUB_NPCS: Record<string, INPCDefinition> = {
  'npc_banker': {
    id: 'npc_banker',
    name: 'Marcus Goldweave',
    title: 'Vault Keeper',
    dialogue: {
      greeting: "Your assets are secure with the Consortium. What do you need?",
      options: [
        { label: 'Access Stash', action: 'OPEN_BANK' },
        { label: 'Check Balance', action: 'SHOW_BALANCE' },
        { label: 'Read the Ledger', action: 'OPEN_LEDGER' },
        { label: 'Leave', action: 'CLOSE' }
      ]
    },
    spriteColor: '#ffd700'
  },
  'npc_identifier': {
    id: 'npc_identifier',
    name: 'Sera Truthsight',
    title: 'Artifact Analyst',
    dialogue: {
      greeting: "Bring me your mysteries. I see what others cannot.",
      options: [
        { label: 'Identify Item (100g)', action: 'IDENTIFY_ITEM', payload: { cost: 100 } },
        { label: 'Bulk Identify (500g)', action: 'IDENTIFY_ALL', payload: { cost: 500 } },
        { label: 'Study Lore', action: 'OPEN_LORE' },
        { label: 'Leave', action: 'CLOSE' }
      ]
    },
    spriteColor: '#a855f7'
  },
  'npc_portal_master': {
    id: 'npc_portal_master',
    name: 'The Conduit',
    title: 'Reality Navigator',
    dialogue: {
      greeting: "The threads of reality await. Where shall I send you?",
      options: [
        { label: 'View Extraction Zones', action: 'OPEN_MISSIONS' },
        { label: 'Quick Deploy', action: 'QUICK_DEPLOY' },
        { label: 'Leave', action: 'CLOSE' }
      ]
    },
    spriteColor: '#06b6d4'
  },
  'npc_weapon_vendor': {
    id: 'npc_weapon_vendor',
    name: 'Bjorn Ironfist',
    title: 'Arms Dealer',
    dialogue: {
      greeting: "Need something that hits hard? You've come to the right place.",
      options: [
        { label: 'Browse Weapons', action: 'OPEN_SHOP', payload: { category: 'weapons' } },
        { label: 'Sell Items', action: 'OPEN_SELL', payload: { npcId: 'npc_weapon_vendor' } },
        { label: 'The Bench', action: 'OPEN_APPRENTICES', payload: { npcId: 'npc_weapon_vendor' } },
        { label: 'Leave', action: 'CLOSE' }
      ]
    },
    spriteColor: '#ef4444',
    teaches: { rank: UniversalRank.C }
  },
  'npc_armor_vendor': {
    id: 'npc_armor_vendor',
    name: 'Talia Steelweave',
    title: 'Protection Specialist',
    dialogue: {
      greeting: "Defense is the best offense... or something like that.",
      options: [
        { label: 'Browse Armor', action: 'OPEN_SHOP', payload: { category: 'armor' } },
        { label: 'Sell Items', action: 'OPEN_SELL', payload: { npcId: 'npc_armor_vendor' } },
        { label: 'Repair Gear', action: 'OPEN_REPAIR' },
        { label: 'The Bench', action: 'OPEN_APPRENTICES', payload: { npcId: 'npc_armor_vendor' } },
        { label: 'Leave', action: 'CLOSE' }
      ]
    },
    spriteColor: '#3b82f6',
    teaches: { rank: UniversalRank.C }
  },
  'npc_alchemist': {
    id: 'npc_alchemist',
    name: 'Io Mireforge',
    title: 'Keeper of the Corner',
    dialogue: {
      greeting: "Everything here cures something. Not always the thing you came in with.",
      options: [
        { label: 'Browse Remedies', action: 'OPEN_SHOP', payload: { category: 'consumables' } },
        { label: 'Sell Items', action: 'OPEN_SELL', payload: { npcId: 'npc_alchemist' } },
        { label: 'The Bench', action: 'OPEN_APPRENTICES', payload: { npcId: 'npc_alchemist' } },
        { label: 'Leave', action: 'CLOSE' }
      ]
    },
    spriteColor: '#22c55e',
    teaches: { rank: UniversalRank.C }
  },
  'npc_guild_master': {
    id: 'npc_guild_master',
    name: 'Grand Marshal Vex',
    title: 'Guild Registrar',
    dialogue: {
      greeting: "The Hall takes what this city's people want, and it takes proof. Which have you brought?",
      options: [
        { label: 'The Board', action: 'OPEN_HALL' },
        { label: 'Ask about the Hall', action: 'GUILD_LORE' },
        { label: 'Leave', action: 'CLOSE' }
      ]
    },
    spriteColor: '#f59e0b'
  },
  // Pedro: the guildhall is a town hall, and everything that develops the city goes through him.
  'npc_land_manager': {
    id: 'npc_land_manager',
    name: 'Aurelio Quint',
    title: 'Land Manager',
    dialogue: {
      greeting: "Every tile in this city is on my sheet. Tell me what you want to do with yours.",
      options: [
        { label: 'The Deeds', action: 'OPEN_DEEDS' },
        { label: 'Plan the City', action: 'OPEN_PLAN' },
        { label: 'Leave', action: 'CLOSE' }
      ]
    },
    spriteColor: '#a16207'
  },
  'npc_auctioneer': {
    id: 'npc_auctioneer',
    name: 'Quickfingers',
    title: 'Market Overseer',
    dialogue: {
      // Wave 9.7: the auction house is unbuilt; Quickfingers points at what works.
      greeting: "Buy low, sell high! Or you would, if the block weren't dark.",
      options: [
        { label: 'Ask about the Market', action: 'AUCTION_LORE' },
        { label: 'Leave', action: 'CLOSE' }
      ]
    },
    spriteColor: '#22c55e'
  },
  'npc_bartender': {
    id: 'npc_bartender',
    name: 'Old Mags',
    title: 'The Rusty Anchor',
    dialogue: {
      greeting: "What'll it be? We got drinks and rumors, both equally watered down.",
      options: [
        // D51: energy is a day's supply, and a rest is what restores it (D43: it sends what was queued, too)
        { label: 'Rest the night (20g)', action: 'REST' },
        { label: 'Who is staying here', action: 'OPEN_TAVERN' },
        { label: 'Buy Drink (10g)', action: 'BUY_CONSUMABLE', payload: { itemId: 'drink_ale', cost: 10 } },
        { label: 'Hear Rumors', action: 'GET_HINT' },
        { label: 'Leave', action: 'CLOSE' }
      ]
    },
    spriteColor: '#78716c'
  }
};

// =============================================================================
// THE GENERATOR
// =============================================================================

export class HubGenerator {

  /**
   * The city, from what has risen. Deterministic: this reads the manifest and the
   * plan and nothing else. Chunks are laid out so the northwest corner of the whole
   * hub is tile 0, so raising one north or west moves `origin` and everything with it.
   */
  static generate(plan: IHubPlan = firstPlan(), manifest: IHubManifest = NEW_CARLEON): IHubLayout {
    const minCx = Math.min(...plan.chunks.map(c => c.cx)), maxCx = Math.max(...plan.chunks.map(c => c.cx));
    const minCy = Math.min(...plan.chunks.map(c => c.cy)), maxCy = Math.max(...plan.chunks.map(c => c.cy));
    const width = (maxCx - minCx + 1) * CHUNK_TILES;
    const height = (maxCy - minCy + 1) * CHUNK_TILES;

    // What has not risen is not ground: nobody walks it.
    const navMesh: boolean[][] = Array(height).fill(null).map(() => Array(width).fill(false));

    const chunks: IPlacedChunk[] = plan.chunks.map(c => ({
      cx: c.cx, cy: c.cy, kind: c.kind,
      x: (c.cx - minCx) * CHUNK_TILES,
      y: (c.cy - minCy) * CHUNK_TILES
    }));

    const zones: IHubZone[] = [];
    const roads: IRoadCell[] = [];
    const passages: IPassage[] = [];
    const zonesRaised = new Map<string, number>();
    const seriesCount = new Map<string, number>();
    let spawnPoint = { x: chunks[0].x, y: chunks[0].y };
    const centre = { x: chunks[0].x + CHUNK_TILES / 2, y: chunks[0].y + CHUNK_TILES / 2 };

    const mainByChunk: IRoadCell[][] = [];

    // A lot split up after `count` chunks had risen. Its pieces are numbered then, in the
    // order it happened, so nothing that comes later moves them and they move nothing earlier.
    const dismemberAfter = (count: number) => {
      for (const { lotId, after } of plan.dismembered ?? []) {
        if (after !== count) continue;
        const zone = zones.find(z => z.pois.some(p => p.id === lotId));
        const old = zone?.pois.find(p => p.id === lotId);
        if (!zone || !old) continue;
        const home = chunks.findIndex(c => old.position.x >= c.x && old.position.x < c.x + CHUNK_TILES && old.position.y >= c.y && old.position.y < c.y + CHUNK_TILES);
        const mark = Object.values(manifest.marks).find(m => m.type === POIType.PLAYER_LOT)!;
        const series = mark.series ?? 'poi_lot';
        const shape = dismemberShape({ x: old.position.x, y: old.position.y, width: old.size.width, height: old.size.height });
        const door = doorTile(old);
        const onRoad = roads.some(r => tilesToCell(door, r) === 0);
        const wayOut = shape.way.filter(t => t.x === door.x && t.y > (old.position.y + (old.size.height >> 1)));
        zone.pois.splice(zone.pois.indexOf(old), 1);
        for (const piece of shape.pieces) {
          const n = seriesCount.get(series) ?? 0;
          seriesCount.set(series, n + 1);
          const poi: IPOI = {
            id: `${series}_${n}`,
            type: POIType.PLAYER_LOT,
            name: mark.name.replace('{n}', String(n + 1)),
            position: { x: piece.x, y: piece.y },
            size: { width: piece.width, height: piece.height },
            interactable: true,
            metadata: { ...mark.metadata, lotIndex: n, dismemberedFrom: lotId }
          };
          const own = doorTile(poi);
          const midY = old.position.y + (old.size.height >> 1);
          const locked = own.y === midY;
          if (locked) {
            // Along the crossbar to the way in, then down it to the old door.
            const tiles: { x: number; y: number }[] = [];
            const step = own.x <= door.x ? 1 : -1;
            for (let x = own.x; x !== door.x; x += step) tiles.push({ x, y: midY });
            tiles.push({ x: door.x, y: midY });
            wayOut.slice().sort((a, b) => a.y - b.y).forEach(t => tiles.push(t));
            if (!onRoad) tiles.push(door);
            passages.push({ lotId: poi.id, tiles, through: [] });
          }
          const fromCentre = Math.abs(own.x - centre.x) + Math.abs(own.y - centre.y);
          const fromRoad = Math.min(...mainByChunk[home].map(cell => tilesToCell(own, cell)));
          poi.metadata.fromCentre = fromCentre;
          poi.metadata.fromRoad = fromRoad;
          if (locked) poi.metadata.locked = true;
          poi.metadata.price = lotPrice(manifest, poi.size, { fromCentre, fromRoad, locked });
          zone.pois.push(poi);
        }
      }
    };

    const lay = (placed: IPlacedChunk, order: number) => {
      const chunk = manifest.chunks[placed.kind];
      if (!chunk) throw new Error(`The manifest holds no chunk called ${placed.kind}.`);

      for (let y = placed.y; y < placed.y + CHUNK_TILES; y++) navMesh[y].fill(true, placed.x, placed.x + CHUNK_TILES);

      const mainHere: IRoadCell[] = [];
      chunk.road.forEach((row, cy) => [...row].forEach((c, cx) => {
        if (c === EMPTY_MARK) return;
        const cell = { x: placed.x + cx * CELL_TILES, y: placed.y + cy * CELL_TILES, main: c === ROAD_MAIN };
        roads.push(cell);
        if (cell.main) mainHere.push(cell);
      }));

      mainByChunk[order] = mainHere;

      const byLetter = HubGenerator.zonesOf(chunk, placed, manifest, zonesRaised);
      byLetter.forEach(zone => zones.push(zone));

      const res = resolveChunk(manifest, chunk);
      if (order === 0 && res.spawn) spawnPoint = { x: placed.x + res.spawn.x, y: placed.y + res.spawn.y };

      // Who stands here, in reading order, each with its number in the hub.
      const standing = res.things.map(thing => {
        const def = manifest.marks[thing.mark];
        const n = def.series ? seriesCount.get(def.series) ?? 0 : 0;
        if (def.series) seriesCount.set(def.series, n + 1);
        const poi: IPOI = {
          id: def.id ?? `${def.series}_${n}`,
          type: def.type,
          name: def.name.replace('{n}', String(n + 1)),
          position: { x: placed.x + thing.x, y: placed.y + thing.y },
          size: { ...thing.size },
          interactable: def.interactable,
          metadata: { ...def.metadata, ...(def.type === POIType.PLAYER_LOT ? { lotIndex: n } : {}) }
        };
        if (def.npcId) poi.npcId = def.npcId;
        return { thing, def, poi };
      });

      // The servidão: who is locked out, and how much each neighbour carries.
      const carries = new Map<number, number>();
      const lockedOut = new Map<number, string[]>();
      res.passages.forEach(q => {
        const through = q.through.map(i => standing[i].poi.id);
        lockedOut.set(q.thing, through);
        passages.push({
          lotId: standing[q.thing].poi.id,
          tiles: q.tiles.map(p => ({ x: placed.x + p.x, y: placed.y + p.y })),
          through
        });
        q.tiles.forEach(p => q.through.forEach(i => {
          const on = standing[i].thing;
          if (p.x >= on.x && p.x < on.x + on.size.width && p.y >= on.y && p.y < on.y + on.size.height) carries.set(i, (carries.get(i) ?? 0) + 1);
        }));
      });

      standing.forEach(({ thing, def, poi }, i) => {
        if (def.type === POIType.PLAYER_LOT) {
          const door = doorTile(poi);
          const fromCentre = Math.abs(door.x - centre.x) + Math.abs(door.y - centre.y);
          const fromRoad = Math.min(...mainHere.map(cell => tilesToCell(door, cell)));
          const locked = lockedOut.has(i);
          const carried = carries.get(i) ?? 0;
          poi.metadata.fromCentre = fromCentre;
          poi.metadata.fromRoad = fromRoad;
          if (locked) poi.metadata.locked = true;
          if (carried) poi.metadata.carries = carried;
          poi.metadata.price = lotPrice(manifest, thing.size, { fromCentre, fromRoad, locked, carries: carried });
        }
        const letterCx = (poi.position.x - placed.x) / CELL_TILES, letterCy = (poi.position.y - placed.y) / CELL_TILES;
        const zone = byLetter.get(chunk.floor[Math.floor(letterCy)][Math.floor(letterCx)]);
        if (!zone) throw new Error(`${poi.id} has no floor under it.`);
        zone.pois.push(poi);
        if (def.solid) {
          for (let dy = 0; dy < thing.size.height; dy++) {
            for (let dx = 0; dx < thing.size.width; dx++) navMesh[poi.position.y + dy][poi.position.x + dx] = false;
          }
        }
      });

    };

    // A chunk made farmland whole after `count` had risen: what stood there goes, its numbers
    // stay spent, and the plots are numbered then, so nothing raised around it moves.
    const farmAfter = (count: number) => {
      plan.chunks.forEach((raised, order) => {
        if (raised.farmedAfter !== count) return;
        const placed = chunks[order];
        const inside = (x: number, y: number) => x >= placed.x && x < placed.x + CHUNK_TILES && y >= placed.y && y < placed.y + CHUNK_TILES;
        const gone = new Set<string>();
        for (let i = zones.length - 1; i >= 0; i--) {
          const zone = zones[i];
          zone.pois = zone.pois.filter(p => {
            if (!inside(p.position.x, p.position.y)) return true;
            gone.add(p.id);
            return false;
          });
          if (inside(zone.bounds.x, zone.bounds.y)) zones.splice(i, 1);
        }
        for (let i = roads.length - 1; i >= 0; i--) if (inside(roads[i].x, roads[i].y)) roads.splice(i, 1);
        for (let i = passages.length - 1; i >= 0; i--) if (gone.has(passages[i].lotId)) passages.splice(i, 1);
        placed.kind = FARMLAND_KIND;
        lay(placed, order);
      });
    };

    chunks.forEach((placed, order) => {
      lay(placed, order);
      dismemberAfter(order + 1);
      farmAfter(order + 1);
    });

    return {
      id: manifest.id,
      name: manifest.name,
      version: manifest.version,
      width,
      height,
      zones,
      spawnPoint,
      navMesh,
      roads,
      passages,
      chunks,
      origin: { x: chunks[0].x, y: chunks[0].y }
    };
  }

  /** One zone per floor letter in this chunk, bounded by the cells that letter fills. */
  private static zonesOf(chunk: IChunkManifest, placed: IPlacedChunk, manifest: IHubManifest, raised: Map<string, number>): Map<string, IHubZone> {
    const spans = new Map<string, { x0: number; y0: number; x1: number; y1: number }>();
    chunk.floor.forEach((row, cy) => [...row].forEach((letter, cx) => {
      if (letter === EMPTY_MARK) return;
      const s = spans.get(letter);
      if (!s) { spans.set(letter, { x0: cx, y0: cy, x1: cx, y1: cy }); return; }
      s.x0 = Math.min(s.x0, cx); s.y0 = Math.min(s.y0, cy); s.x1 = Math.max(s.x1, cx); s.y1 = Math.max(s.y1, cy);
    }));
    const zones = new Map<string, IHubZone>();
    spans.forEach((s, letter) => {
      const floor = manifest.floors[letter];
      if (!floor) throw new Error(`The manifest has no floor called ${letter}.`);
      const n = raised.get(floor.id) ?? 0;
      raised.set(floor.id, n + 1);
      zones.set(letter, {
        id: n === 0 ? floor.id : `${floor.id}_${n}`,
        name: floor.name,
        type: floor.type,
        bounds: {
          x: placed.x + s.x0 * CELL_TILES, y: placed.y + s.y0 * CELL_TILES,
          width: (s.x1 - s.x0 + 1) * CELL_TILES, height: (s.y1 - s.y0 + 1) * CELL_TILES
        },
        pois: [],
        ambientColor: floor.ambientColor,
        floorTexture: floor.floorTexture
      });
    });
    return zones;
  }

  /**
   * The records of a hub's lots against its layout. A stored record is handed back
   * untouched: where a lot stands is the manifest's and is never written on it, so
   * re-laying the city moves no owner. A record the layout no longer places is kept,
   * never dropped, and a lot with no record yet gets a fresh one.
   */
  static lotRecords<T extends { id: string }>(stored: T[], layout: IHubLayout, fresh: (poi: IPOI) => T): T[] {
    const have = new Set(stored.map(l => l.id));
    const added = layout.zones
      .flatMap(z => z.pois)
      .filter(p => p.type === POIType.PLAYER_LOT && !have.has(p.id))
      .sort((a, b) => a.metadata.lotIndex - b.metadata.lotIndex)
      .map(fresh);
    return added.length === 0 ? stored : [...stored, ...added];
  }

  /**
   * Whether this lot can be dismembered at all, what it would cost and how many it
   * would make. The land's half of the question: who owns it and what stands on it is
   * the hub's to ask.
   */
  static dismemberVerdict(layout: IHubLayout, lotId: string, manifest: IHubManifest = NEW_CARLEON): { ok: boolean; reason?: string; cost?: number; pieces?: number } {
    const lot = HubGenerator.findPOI(layout, lotId);
    if (!lot || lot.type !== POIType.PLAYER_LOT) return { ok: false, reason: 'There is no such lot.' };
    if (lot.metadata.farmland) return { ok: false, reason: 'The hub portioned this ground evenly, and it stays that way.' };
    if (lot.metadata.locked) return { ok: false, reason: 'It has no street at its door to trace a way from.' };
    if (lot.metadata.carries) return { ok: false, reason: 'A servidão already crosses it, and the way stays open.' };
    const shape = dismemberShape({ x: lot.position.x, y: lot.position.y, width: lot.size.width, height: lot.size.height });
    const tooSmall = shape.pieces.length === 0 || shape.pieces.some(p => p.width < DISMEMBER_PIECE_MIN || p.height < DISMEMBER_PIECE_MIN);
    if (tooSmall || shape.pieces.length < 3) {
      return { ok: false, reason: `At ${lot.size.width}×${lot.size.height} it is too small to split. Its pieces would be under ${DISMEMBER_PIECE_MIN} tiles a side.` };
    }
    return { ok: true, cost: lotPriceShare(manifest, lot.metadata.price), pieces: shape.pieces.length };
  }

  /** Where the ground ends: every side of a raised chunk with nothing raised beyond it, in tiles. */
  static edges(layout: IHubLayout): { x0: number; y0: number; x1: number; y1: number }[] {
    const raised = new Set(layout.chunks.map(c => `${c.cx},${c.cy}`));
    const out: { x0: number; y0: number; x1: number; y1: number }[] = [];
    for (const c of layout.chunks) {
      const x1 = c.x + CHUNK_TILES, y1 = c.y + CHUNK_TILES;
      if (!raised.has(`${c.cx},${c.cy - 1}`)) out.push({ x0: c.x, y0: c.y, x1, y1: c.y });
      if (!raised.has(`${c.cx},${c.cy + 1}`)) out.push({ x0: c.x, y0: y1, x1, y1 });
      if (!raised.has(`${c.cx - 1},${c.cy}`)) out.push({ x0: c.x, y0: c.y, x1: c.x, y1 });
      if (!raised.has(`${c.cx + 1},${c.cy}`)) out.push({ x0: x1, y0: c.y, x1, y1 });
    }
    return out;
  }

  /** A tile of this layout as a tile of the ground the hub stands on (D80). */
  static groundTile(layout: IHubLayout, x: number, y: number): { x: number; y: number } {
    const first = layout.chunks[0];
    return { x: first.cx * CHUNK_TILES + x - layout.origin.x, y: first.cy * CHUNK_TILES + y - layout.origin.y };
  }

  /**
   * Find a POI by ID across all zones
   */
  static findPOI(layout: IHubLayout, poiId: string): IPOI | null {
    for (const zone of layout.zones) {
      const poi = zone.pois.find(p => p.id === poiId);
      if (poi) return poi;
    }
    return null;
  }
  
  /**
   * Find POI at a given position
   */
  static getPOIAtPosition(layout: IHubLayout, x: number, y: number): IPOI | null {
    for (const zone of layout.zones) {
      for (const poi of zone.pois) {
        if (x >= poi.position.x && x < poi.position.x + poi.size.width &&
            y >= poi.position.y && y < poi.position.y + poi.size.height) {
          return poi;
        }
      }
    }
    return null;
  }
  
  /**
   * Get zone at position
   */
  static getZoneAtPosition(layout: IHubLayout, x: number, y: number): IHubZone | null {
    for (const zone of layout.zones) {
      if (x >= zone.bounds.x && x < zone.bounds.x + zone.bounds.width &&
          y >= zone.bounds.y && y < zone.bounds.y + zone.bounds.height) {
        return zone;
      }
    }
    return null;
  }
}