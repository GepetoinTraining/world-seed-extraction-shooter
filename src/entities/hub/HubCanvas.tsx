/**
 * HubCanvas - The City View (Wave 9: the windows moved onto the kit)
 * Players walk a fixed city, talk to its keepers, and reach every service.
 * NO COMBAT. This is the safe zone, and the only warm place.
 */

import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { HubGenerator, IPOI, POIType, HUB_NPCS, INPCDefinition } from './HubGenerator';
import { usePlayerStore } from '../player/store';
import { craftName, priceOfListing, useHubStore, worldDay } from './store';
import { HUB_TILE_PX } from './HubCanvas.constants';
import { HUB_GENRE, IPlotShow, composeHub, LotState, RawFacade, distanceTo, doorOf, withinReach } from '../../render/atoms/hub';
import { composeRoom, rawWallKind } from '../../render/atoms/room';
import {
  IRoomState, RoomPieceKind, stationFunctionOf, PIECE_BILLS, PIECE_BUILD_SECONDS,
  answersTag, builtLotBlocksAt, materialLabel, roomAdditions, roomDoor, roomEntry, roomSolid
} from './room';
import { lotConstruction } from './template';
import { TemplateStudio } from '../../components/TemplateStudio';
import { CityPlan } from '../../components/CityPlan';
import { GuildHall } from '../../components/GuildHall';
import { TavernRoom } from '../../components/TavernRoom';
import { RankMomentView } from '../../components/WorldCanvas';
import { TalkWindow } from '../../components/TalkWindow';
import { useTalk } from '../interaction/talkStore';
import { ApprenticeWindow } from '../../components/ApprenticeWindow';
import { FarmWindow } from '../../components/FarmWindow';
import { Farm } from './farm';
import { FarmDoors } from './farmDoors';
import { VendorSystem } from '../../logic/systems/VendorSystem';
import { inspectBuiltRoom } from '../../render/atoms/inspect';
import { GEAR_RECIPES, RECIPE_DEFINITIONS } from '../economy/data/recipeDefinitions';
import { Archetype, Facing, WALK_PHASES, castPortrait, figure, residentFigure } from '../../render/atoms/people';
import { ResidentDay } from './residentDay';
import { MeetDoor } from '../../logic/systems/MeetDoor';
import { MeetLaw } from '../../logic/systems/MeetLaw';
import { IMeetLine } from '../../logic/systems/TalkTypes';
import { SAYING_SHOWS_MS, drawSaying } from '../../render/atoms/speech';
import { residentRung } from './guild';
import { residentFacts } from './money';
import { ATOM_PX, Role, Sprite, buildPalette, hash2, px } from '../../render/atoms/atoms';
import { DialogueEffect, repairCost, repairItem, repairable, runDialogueAction, quickDeployTargetId } from './dialogue';
import { deployToWorld } from '../../logic/systems/Deploy';
import { ArmedButton, Bar, Button, CardView, Chip, Input, ItemSprite, Kbd, Modal, Panel, SpriteView, TimerBar } from '../../components/ui/kit';
import { hoverProps, useAppView, useFeed } from '../../components/ui/stores';
import { AskFor, BuyListing, CollectHeld } from '../../components/ShelfAsk';
import { cityCamera, isInteractKey, isTypingTarget } from '../../logic/systems/FieldInput';
import { MinimapView } from '../../components/ui/MinimapView';
import { cityMinimap } from '../../render/atoms/minimap';
import { inspectItem } from '../../render/atoms/inspect';
import { StudySystem } from '../../logic/systems/StudySystem'; // Wave 10E (D19)
import { useStudyReach } from '../../components/StudyPanel'; // D118
import { ProcessSystem } from '../../logic/systems/ProcessSystem'; // The raw materials leg (D26)
import { LoadoutSystem } from '../player/systems/LoadoutSystem';
import { StatSystem } from '../../logic/systems/StatSystem';
import { RestSystem } from '../../logic/systems/RestSystem';
import { LORE_FRAGMENTS } from '../lore/LoreBible';
import { IItem, ItemType } from '../../../types';

/** How often the meetings nobody watched are sent and collected, while the city is open. A guess until Wave 12. */
const MEET_TICK_MS = 60_000;

const TILE_SIZE = HUB_TILE_PX;

/** What lies past the city's edge when the window is wider than the city: ground, not a black box. */
const OUTSKIRTS_ATOMS = 64;
function outskirtsCanvas(palette: Uint8Array): HTMLCanvasElement {
  const s = OUTSKIRTS_ATOMS;
  const data = new Uint8Array(s * s);
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
    data[y * s + x] = px(Role.GROUND, hash2(811, x >> 1, y >> 1) % 7 === 0 ? 1 : 0);
  }
  const small = spriteToCanvas({ w: s, h: s, data }, palette);
  const big = document.createElement('canvas');
  big.width = s * ATOM_PX; big.height = s * ATOM_PX;
  const ctx = big.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(small, 0, 0, big.width, big.height);
  return big;
}

function spriteToCanvas(s: Sprite, table: Uint8Array): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = s.w; c.height = s.h;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(s.w, s.h);
  for (let i = 0; i < s.data.length; i++) {
    const v = s.data[i], j = i * 4;
    if (!v) continue;
    img.data[j] = table[v * 3]; img.data[j + 1] = table[v * 3 + 1]; img.data[j + 2] = table[v * 3 + 2]; img.data[j + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/** Cast portraits keep the city's warm ramp — the hub is the only warm place. */
/** D118: anyone in town can be asked to sit for it, before the way out. */
const withStudy = (npc: INPCDefinition) => {
  const options = npc.dialogue.options;
  const study = { label: 'Study them', action: 'STUDY_PERSON', payload: { id: npc.id, name: npc.name, title: npc.title } };
  const leave = options.findIndex(o => o.action === 'CLOSE');
  return leave < 0 ? [...options, study] : [...options.slice(0, leave), study, ...options.slice(leave)];
};

const CastPortrait: React.FC<{ npcId: string }> = ({ npcId }) => {
  const sprite = useMemo(() => castPortrait(npcId), [npcId]);
  const palette = useMemo(() => buildPalette(HUB_GENRE), []);
  return <SpriteView sprite={sprite} palette={palette} scale={2} />;
};

// A keeper can lead to a screen of its own. Coming back, you stand where you stood.
// Kept from the first chunk's corner, since a chunk risen north or west moves every tile.
let streetPos: { x: number; y: number } | null = null;

type HubPanel =
  | { kind: 'shop'; category: 'weapon' | 'armor' | 'consumable' }
  | { kind: 'farm'; lotId: string }
  | { kind: 'sell'; npcId?: string } | { kind: 'repair' } | { kind: 'lore' } | { kind: 'plan' } | { kind: 'tavern' } | { kind: 'guild' } | { kind: 'apprentices'; npcId: string };

export const HubCanvas: React.FC = () => {
  const chunks = useHubStore(s => s.chunks);
  const dismembered = useHubStore(s => s.dismembered);
  const layout = useMemo(() => HubGenerator.generate({ chunks, dismembered }), [chunks, dismembered]);

  const posRef = useRef(streetPos
    ? { x: streetPos.x + layout.origin.x * TILE_SIZE, y: streetPos.y + layout.origin.y * TILE_SIZE }
    : { x: (layout.spawnPoint.x + 0.5) * TILE_SIZE, y: (layout.spawnPoint.y + 0.5) * TILE_SIZE });
  const [playerTile, setPlayerTile] = useState({ x: Math.floor(posRef.current.x / TILE_SIZE), y: Math.floor(posRef.current.y / TILE_SIZE) });
  const originRef = useRef(layout.origin);
  useEffect(() => () => {
    streetPos = { x: posRef.current.x - originRef.current.x * TILE_SIZE, y: posRef.current.y - originRef.current.y * TILE_SIZE };
  }, []);

  // A chunk rose to the north or the west, and every tile moved. You stay on your own ground.
  useEffect(() => {
    const from = originRef.current, to = layout.origin;
    if (from.x === to.x && from.y === to.y) return;
    originRef.current = to;
    posRef.current = { x: posRef.current.x + (to.x - from.x) * TILE_SIZE, y: posRef.current.y + (to.y - from.y) * TILE_SIZE };
    setPlayerTile({ x: Math.floor(posRef.current.x / TILE_SIZE), y: Math.floor(posRef.current.y / TILE_SIZE) });
  }, [layout]);
  const [nearbyPOI, setNearbyPOI] = useState<IPOI | null>(null);
  const [activeNPC, setActiveNPC] = useState<INPCDefinition | null>(null);
  const [npcReply, setNpcReply] = useState<string | null>(null);
  const [panel, setPanel] = useState<HubPanel | null>(null);

  // Wave 10: through the door. While insideLotId is set, the canvas draws the
  // room instead of the street; your place in the city is kept in posRef.
  const [insideLotId, setInsideLotId] = useState<string | null>(null);
  const [roomTile, setRoomTile] = useState({ x: 0, y: 0 });
  const [buildKind, setBuildKind] = useState<RoomPieceKind | null>(null);
  const [buildMatDef, setBuildMatDef] = useState('');
  const [placeSelId, setPlaceSelId] = useState<string>('');
  const [stationPanel, setStationPanel] = useState<'WORKSHOP' | 'VENDOR' | 'SCRIBE' | null>(null);
  const roomPosRef = useRef({ x: 0, y: 0 });
  const insideLotIdRef = useRef<string | null>(null);
  insideLotIdRef.current = insideLotId;
  const buildKindRef = useRef<RoomPieceKind | null>(null);
  buildKindRef.current = buildKind;

  const { player } = usePlayerStore();
  const { lots, rooms, buildJobs } = useHubStore();
  const { setView } = useAppView();
  const pushFeed = useFeed(s => s.push);

  const cityRef = useRef<HTMLCanvasElement>(null);
  const keysRef = useRef<Set<string>>(new Set());
  const facingRef = useRef<Facing>('down');
  const stepRef = useRef({ step: 0, at: 0 });
  const movingRef = useRef(false);
  const lastTickRef = useRef(0);
  const nearbyRef = useRef<IPOI | null>(null);
  const busyRef = useRef(false); // a window is open: keys belong to it
  const reducedMotion = useMemo(
    () => typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    []
  );
  nearbyRef.current = nearbyPOI;
  // Q18: someone who lives here, near enough to talk to where they stand. The walk loop sets it.
  const [nearPerson, setNearPerson] = useState<string | null>(null);
  const nearPersonRef = useRef<string | null>(null);
  // Two people who stood together today, and the lines of any talk somebody is watching
  const meetSeenRef = useRef(new Set<string>());
  const sayingRef = useRef(new Map<string, { a: string; b: string; lines: IMeetLine[]; at: number }>());
  const talking = useTalk(s => !!s.subject);
  busyRef.current = !!(activeNPC || panel || stationPanel || talking);

  // =========================================================================
  // MOVEMENT: held keys, per-axis sliding against the navmesh
  // =========================================================================

  // Wave 10.2: a built lot blocks its whole footprint — the door tile you stand
  // on to enter lies one row below it. What blocks is exactly what is drawn. The
  // one exception is a servidão: its tiles stay open whatever stands on them.
  const blockedLotTiles = useMemo(() => {
    const blocked = new Set<number>();
    const passageTiles = new Set(layout.passages.flatMap(q => q.tiles.map(t => t.y * layout.width + t.x)));
    for (const zone of layout.zones) for (const poi of zone.pois) {
      if (poi.type !== POIType.PLAYER_LOT) continue;
      const lot = lots.find(l => l.id === poi.id);
      // A plot is open ground: it has a door to work from, and nothing stands in anyone's way
      const built = !!lot && !!lot.ownerId && lot.structureType !== 'EMPTY' && lot.structureType !== 'FARM';
      // Wave 10B: an under-construction lot blocks like a built one — the
      // scaffold blocks exactly what it draws.
      const rising = !!lot && lotConstruction(buildJobs, poi.id) !== null;
      for (let ty = poi.position.y; ty < poi.position.y + poi.size.height; ty++) {
        for (let tx = poi.position.x; tx < poi.position.x + poi.size.width; tx++) {
          const at = ty * layout.width + tx;
          if (builtLotBlocksAt(poi, built || rising, tx, ty) && !passageTiles.has(at)) blocked.add(at);
        }
      }
    }
    return blocked;
  }, [layout, lots, buildJobs]);

  const blockedAt = useCallback((x: number, y: number) => {
    const tx = Math.floor(x / TILE_SIZE), ty = Math.floor(y / TILE_SIZE);
    if (tx < 0 || ty < 0 || tx >= layout.width || ty >= layout.height) return true;
    return !layout.navMesh[ty][tx] || blockedLotTiles.has(ty * layout.width + tx);
  }, [layout, blockedLotTiles]);

  // The room under your feet, pre-composed. The loop reads the ref every frame.
  const roomData: IRoomState | null = insideLotId ? rooms[insideLotId] ?? null : null;
  const roomRef = useRef<{ room: IRoomState; solid: Uint8Array; canvas: HTMLCanvasElement } | null>(null);
  useEffect(() => {
    if (!roomData) { roomRef.current = null; return; }
    roomRef.current = {
      room: roomData,
      solid: roomSolid(roomData),
      canvas: spriteToCanvas(composeRoom(roomData), buildPalette(HUB_GENRE))
    };
  }, [roomData]);

  const enterRoom = useCallback((poi: IPOI) => {
    const hub = useHubStore.getState();
    const lot = hub.lots.find(l => l.id === poi.id);
    const room = hub.rooms[poi.id];
    if (!lot || !room) return;
    const entry = roomEntry(room.size);
    roomPosRef.current = { x: (entry.x + 0.5) * TILE_SIZE, y: (entry.y + 0.5) * TILE_SIZE };
    setRoomTile(entry);
    keysRef.current.clear();
    facingRef.current = 'up';
    setInsideLotId(poi.id);
    pushFeed(`Through the door. ${poi.name.toUpperCase()} ${lot.structureType}, on record.`, 'signal');
  }, [pushFeed]);

  const exitRoom = useCallback(() => {
    const id = insideLotIdRef.current;
    if (id) {
      const poi = HubGenerator.findPOI(layout, id);
      if (poi) {
        const d = doorOf(poi);
        posRef.current = { x: (d.x + 0.5) * TILE_SIZE, y: (d.y + 0.5) * TILE_SIZE };
        setPlayerTile({ x: d.x, y: d.y });
      }
    }
    setInsideLotId(null);
    setBuildKind(null);
    setStationPanel(null);
    facingRef.current = 'down';
    pushFeed('Back on the street.', 'plain');
  }, [layout, pushFeed]);
  const exitRoomRef = useRef(exitRoom);
  exitRoomRef.current = exitRoom;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (busyRef.current || isTypingTarget(e.target)) return; // dialogue and panels take the keyboard
      const key = e.key.toLowerCase();
      // A focused control keeps its own Enter; the one interact key is everyone else's (line 72)
      if (e.key === 'Enter' && (e.target as HTMLElement)?.tagName === 'BUTTON') return;
      if (insideLotIdRef.current && interiorKeyRef.current(key)) return;
      if (isInteractKey(key)) {
        // A person is nearer than a building's door: their body takes the key first, on the street.
        if (!insideLotIdRef.current && nearPersonRef.current) {
          keysRef.current.clear();
          void useTalk.getState().open({ kind: 'CITY', npcId: nearPersonRef.current });
          return;
        }
        if (nearbyRef.current?.interactable) handleInteract(nearbyRef.current);
        return;
      }
      keysRef.current.add(key);
    };
    const handleKeyUp = (e: KeyboardEvent) => keysRef.current.delete(e.key.toLowerCase());
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // =========================================================================
  // PROXIMITY DETECTION (within 3 tiles of an interactable's center)
  // =========================================================================

  useEffect(() => {
    if (insideLotId) { setNearbyPOI(null); return; }
    let closest: IPOI | null = null;
    let closestDist = Infinity;
    for (const zone of layout.zones) {
      for (const poi of zone.pois) {
        if (!poi.interactable) continue;
        const dist = distanceTo(poi, playerTile);
        if (withinReach(poi, playerTile) && dist < closestDist) {
          closest = poi;
          closestDist = dist;
        }
      }
    }
    setNearbyPOI(closest);
  }, [playerTile, layout, insideLotId]);

  // D118: what the sheet can offer to study is whatever is in front of you.
  useEffect(() => {
    const npc = nearbyPOI?.npcId ? HUB_NPCS[nearbyPOI.npcId] : undefined;
    const lot = insideLotId ? layout.zones.flatMap(z => z.pois).find(p => p.id === insideLotId) : undefined;
    useStudyReach.getState().set([
      ...(lot ? [StudySystem.targetOfBuilding({ id: lot.id, name: lot.name })] : []),
      ...(npc ? [StudySystem.targetOfPerson({ id: npc.id, name: npc.name, title: npc.title })] : []),
      ...(nearbyPOI && !npc ? [StudySystem.targetOfBuilding({ id: nearbyPOI.id, name: nearbyPOI.name })] : [])
    ]);
    return () => useStudyReach.getState().set([]);
  }, [nearbyPOI, insideLotId, layout]);

  // Inside: the nearest placed thing you could work, within reach.
  const nearPlacement = useMemo(() => {
    if (!roomData) return null;
    let best: { placement: IRoomState['placements'][number]; d: number } | null = null;
    for (const pl of roomData.placements) {
      const d = pl.item.dimensions || { width: 1, height: 1 };
      const fw = pl.rotated ? d.height : d.width, fh = pl.rotated ? d.width : d.height;
      const cx = pl.x + fw / 2, cy = pl.y + fh / 2;
      const dist = Math.hypot(roomTile.x + 0.5 - cx, roomTile.y + 0.5 - cy);
      if (dist < 2.2 && (!best || dist < best.d)) best = { placement: pl, d: dist };
    }
    return best?.placement ?? null;
  }, [roomData, roomTile]);
  const nearPlacementRef = useRef(nearPlacement);
  nearPlacementRef.current = nearPlacement;

  // Accumulate-and-resolve: the clock is looked at wherever you stand — the
  // street too, so a rising house (Wave 10B) can be watched from outside.
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
      const due = useHubStore.getState().buildJobs.some(j => !j.applied && j.finishesAt <= Date.now());
      if (due) void useHubStore.getState().resolveBuilds();
      if (FarmDoors.isDue()) void FarmDoors.resolve();
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // =========================================================================
  // INTERACTION
  // =========================================================================

  const handleInteract = (poi: IPOI) => {
    if (poi.npcId && HUB_NPCS[poi.npcId]) {
      keysRef.current.clear();
      setNpcReply(null);
      setActiveNPC(HUB_NPCS[poi.npcId]);
    } else if (poi.type === POIType.PLAYER_LOT) {
      // Wave 10.2: a built lot has a real door. An unbuilt one points you to the
      // land manager: buying and raising go through him, and only him.
      const hub = useHubStore.getState();
      const lot = hub.lots.find(l => l.id === poi.id);
      if (lot && lot.ownerId && lot.structureType === 'FARM') { keysRef.current.clear(); setPanel({ kind: 'farm', lotId: lot.id }); }
      else if (lot && lot.ownerId && lot.structureType !== 'EMPTY' && hub.rooms[poi.id]) enterRoom(poi);
      else pushFeed(`${poi.name} is on the sheet at the Land Office, beside the Hall of Banners.`, 'plain');
    }
  };

  // -------------------------------------------------------------------------
  // WAVE 10.3/10.4: WORK IN THE ROOM — every action calls the one store
  // -------------------------------------------------------------------------

  const aheadTile = () => {
    const t = { x: Math.floor(roomPosRef.current.x / TILE_SIZE), y: Math.floor(roomPosRef.current.y / TILE_SIZE) };
    const f = facingRef.current;
    return f === 'up' ? { x: t.x, y: t.y - 1 } : f === 'down' ? { x: t.x, y: t.y + 1 } : f === 'left' ? { x: t.x - 1, y: t.y } : { x: t.x + 1, y: t.y };
  };

  const stashItems = player.bank.stashTabs[0]?.items || [];

  // D13: the builder's choice of material, falling back to the first thing that answers.
  const buildMaterialFor = (kind: RoomPieceKind) => {
    const answers = stashItems.filter(i => answersTag(i, PIECE_BILLS[kind].tag));
    return answers.find(i => i.universalDefinitionId === buildMatDef) ?? answers[0];
  };

  const buildAhead = async (kind: RoomPieceKind) => {
    const lotId = insideLotIdRef.current;
    if (!lotId) return;
    const bill = PIECE_BILLS[kind];
    const material = buildMaterialFor(kind);
    if (!material) { pushFeed(`The bill asks for something ${bill.tag}; the stash has none.`, 'loss'); return; }
    const t = aheadTile();
    const res = await useHubStore.getState().queuePiece(lotId, kind, t.x, t.y, material.id);
    if (res.ok) pushFeed(`${kind} queued from ${material.name} (${PIECE_BUILD_SECONDS[kind]}s).`, 'signal');
    else pushFeed(res.reason, 'loss');
  };

  const placeAhead = async () => {
    const lotId = insideLotIdRef.current;
    const item = stashItems.find(i => i.id === placeSelId);
    if (!lotId || !item) { pushFeed('Choose something from the stash to place.', 'loss'); return; }
    const t = aheadTile();
    const res = await useHubStore.getState().placeItem(lotId, item.id, t.x, t.y, false);
    if (res.ok) { pushFeed(`${item.name} placed, signed, on record.`, 'proof'); setPlaceSelId(''); }
    else pushFeed(res.reason, 'loss');
  };

  const reclaimNear = async () => {
    const lotId = insideLotIdRef.current;
    const near = nearPlacementRef.current;
    if (!lotId || !near) { pushFeed('Nothing in reach to reclaim.', 'loss'); return; }
    const ok = await useHubStore.getState().reclaimItem(lotId, near.id);
    pushFeed(ok ? `${near.item.name} reclaimed to the stash.` : 'The room would not give it up.', ok ? 'signal' : 'loss');
  };

  const demolishAhead = async () => {
    const lotId = insideLotIdRef.current;
    if (!lotId) return;
    const t = aheadTile();
    const room = useHubStore.getState().rooms[lotId];
    const piece = room?.pieces.find(pc => pc.x === t.x && pc.y === t.y);
    if (!piece) { pushFeed('Nothing built on the tile ahead.', 'loss'); return; }
    const ok = await useHubStore.getState().demolishPiece(lotId, piece.id);
    pushFeed(ok ? `${piece.kind} taken down. The bill comes back in your stash, worn by the work.` : 'It would not come down.', ok ? 'plain' : 'loss');
  };

  const workStation = () => {
    const near = nearPlacementRef.current;
    if (!near) return false;
    const fn = stationFunctionOf(near.item.universalDefinitionId);
    if (!fn) return false;
    keysRef.current.clear();
    setStationPanel(fn);
    return true;
  };

  // Interior keys: E works the station in reach; the door is left by walking it.
  const interiorKeyRef = useRef<(key: string) => boolean>(() => false);
  interiorKeyRef.current = (key: string) => {
    if (key === 'e' || key === 'enter') return workStation();
    return false;
  };

  const applyEffect = async (effect: DialogueEffect) => {
    switch (effect.kind) {
      case 'close':
        setActiveNPC(null); setNpcReply(null);
        return;
      case 'reply':
        setNpcReply(effect.text);
        return;
      case 'navigate':
        setActiveNPC(null); setNpcReply(null);
        setView(effect.view);
        return;
      case 'open':
        setActiveNPC(null); setNpcReply(null);
        if (effect.panel === 'shop') setPanel({ kind: 'shop', category: effect.category });
        else if (effect.panel === 'apprentices') setPanel({ kind: 'apprentices', npcId: effect.npcId });
        else if (effect.panel === 'sell') setPanel({ kind: 'sell', npcId: effect.npcId });
        else if (effect.panel === 'ledger') setView('BANK', 'ledger');
        else if (effect.panel === 'missions') setView('MISSIONS');
        else setPanel({ kind: effect.panel });
        return;
      case 'deploy': {
        setActiveNPC(null); setNpcReply(null);
        const target = quickDeployTargetId();
        if (!target) { pushFeed('No walkable reality on the registry.', 'loss'); return; }
        const res = await deployToWorld(target);
        if (!res.ok && res.reason) pushFeed(res.reason, 'loss');
        return;
      }
    }
  };

  // =========================================================================
  // RENDER HELPERS (unchanged from 8B: the city draws itself from real state)
  // =========================================================================

  const currentZone = useMemo(() =>
    HubGenerator.getZoneAtPosition(layout, playerTile.x, playerTile.y),
    [layout, playerTile]
  );

  // Wave 10B: a lot with pending construction shows the scaffold, its progress
  // read by shape. Progress only changes when a job applies, so the city only
  // recomposes when something really moved.
  const farmland = useHubStore(s => s.farmland);
  const nowMinute = Math.floor(now / 60_000);
  const lotStates = useMemo(() => {
    const states: Partial<Record<number, LotState>> = {};
    const construction: Partial<Record<number, number>> = {};
    // The raw materials leg: a raw-walled building reads as one from the street.
    const facades: Partial<Record<number, RawFacade>> = {};
    // What stands on farmland, read from the time. It changes by the minute, so it is looked at by the minute.
    const plots: Partial<Record<number, IPlotShow>> = {};
    lots.forEach(l => {
      if (l.structureType === 'FARM') {
        const size = HubGenerator.findPOI(layout, l.id)?.size;
        const farm = farmland.farms[l.id];
        if (size) plots[l.lotIndex] = {
          cols: Farm.gridOf(size).cols,
          beds: Object.entries(farm?.beds ?? {}).map(([at, p]) => ({ at: Number(at), growth: Farm.growth(p, nowMinute * 60_000), span: Farm.spanOf(p) }))
        };
      }
      const shell = rooms[l.id]?.shellMaterialDefId;
      const facade = shell ? rawWallKind(shell) : null;
      if (facade) facades[l.lotIndex] = facade;
      const con = lotConstruction(buildJobs, l.id);
      if (con) {
        states[l.lotIndex] = 'UNDER_CONSTRUCTION';
        construction[l.lotIndex] = con.progress;
      } else {
        states[l.lotIndex] = !l.ownerId ? 'FOR_SALE' : l.structureType === 'EMPTY' ? 'OWNED_EMPTY' : l.structureType;
      }
    });
    return { states, construction, facades, plots };
  }, [lots, buildJobs, rooms, farmland, nowMinute, layout]);

  const cityBitmaps = useMemo(() => {
    const palette = buildPalette(HUB_GENRE);
    return [0, 1].map(frame => spriteToCanvas(composeHub(layout, { frame, lots: lotStates.states, construction: lotStates.construction, facades: lotStates.facades, plots: lotStates.plots }), palette));
  }, [layout, lotStates]);

  const groundEdges = useMemo(() => HubGenerator.edges(layout), [layout]);

  // D75, Q20: the people the gate brought out, where their day has them. A lodger stands by the
  // tavern's door; someone home walks their round, out to whoever feeds them and on to where their
  // rung sends them, and home again (residentDay.ts). Where is the clock's, the same on every machine.
  const residents = useHubStore(s => s.guild.residents);
  const wallets = useHubStore(s => s.wallets);

  // Where two people stand, in words: by the nearest door the city has
  const whereNear = useCallback((at: { x: number; y: number }) => {
    const pois = layout.zones.flatMap(z => z.pois);
    let best: IPOI | null = null, bestD = Infinity;
    for (const poi of pois) {
      const d = Math.hypot(poi.position.x + poi.size.width / 2 - at.x, poi.position.y + poi.size.height / 2 - at.y);
      if (d < bestD) { best = poi; bestD = d; }
    }
    return best ? `by the ${best.name}` : 'in the street';
  }, [layout]);

  // What nobody watched goes out in a batch, and comes back on a later tick
  useEffect(() => {
    const hubId = useHubStore.getState().activeHubId;
    if (!hubId) return;
    void MeetDoor.tick(hubId);
    const timer = setInterval(() => void MeetDoor.tick(hubId), MEET_TICK_MS);
    return () => clearInterval(timer);
  }, []);
  const residentRoutes = useMemo(() => {
    const walkable = (x: number, y: number) => !!layout.navMesh[y]?.[x] && !blockedLotTiles.has(y * layout.width + x);
    const day = worldDay();
    let lodging = 0;
    return residents.map(r => {
      const home = r.homeAt && r.lotId ? r.lotId : null;
      const need = residentRung(r, residentFacts(r, wallets[r.id] ?? 0), day).need;
      return { id: r.id, uid: r.entityId, route: ResidentDay.route(layout, walkable, { homeLotId: home, need, lodging: home ? 0 : lodging++ }) };
    });
  }, [residents, wallets, layout, blockedLotTiles]);

  // U16: the city fills the window. The canvas is the window; the camera does the rest.
  const shellRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const shell = shellRef.current, canvas = cityRef.current;
    if (!shell || !canvas || typeof ResizeObserver === 'undefined') return;
    const fit = () => {
      canvas.width = Math.max(1, shell.clientWidth);
      canvas.height = Math.max(1, shell.clientHeight);
    };
    fit();
    const watcher = new ResizeObserver(fit);
    watcher.observe(shell);
    return () => watcher.disconnect();
  }, []);

  const cameraOffset = useCallback(() => {
    const canvas = cityRef.current;
    return cityCamera(
      { w: canvas?.width ?? 0, h: canvas?.height ?? 0 },
      { w: layout.width * TILE_SIZE, h: layout.height * TILE_SIZE },
      posRef.current
    );
  }, [layout]);

  // Line 75: the city is known ground, so its map is whole.
  const composeCityMap = () => insideLotIdRef.current ? null : cityMinimap(
    layout, lotStates.states as Partial<Record<number, string>>,
    { x: Math.floor(posRef.current.x / TILE_SIZE), y: Math.floor(posRef.current.y / TILE_SIZE) }
  );

  // THE WALK LOOP: held keys move the player every frame, the same as the field.
  useEffect(() => {
    const canvas = cityRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const palette = buildPalette(HUB_GENRE);
    const outskirts = ctx.createPattern(outskirtsCanvas(palette), 'repeat');
    const bodies = new Map<string, HTMLCanvasElement>();
    // Q22: a resident by shape, never by colour: no corner brackets, and a roof over the head.
    const people = new Map<string, HTMLCanvasElement>();
    const personFor = (uid: string, facing: Facing, step: number, moving: boolean) => {
      const key = `${uid}:${facing}:${moving ? step : 'stand'}`;
      let c = people.get(key);
      if (!c) {
        c = spriteToCanvas(residentFigure({ uid, facing, step, moving }), palette);
        people.set(key, c);
      }
      return c;
    };
    const bodyFor = (facing: Facing, step: number, moving: boolean) => {
      const key = `${facing}:${moving ? step : 'stand'}`;
      let c = bodies.get(key);
      if (!c) {
        c = spriteToCanvas(figure({
          uid: player.id, archetype: (player.archetype || 'OPERATOR') as Archetype, facing, step, moving
        }), palette);
        bodies.set(key, c);
      }
      return c;
    };

    let raf = 0;
    lastTickRef.current = performance.now();
    const loop = (time: number) => {
      const dt = Math.min((time - lastTickRef.current) / 1000, 0.1);
      lastTickRef.current = time;

      // ---------------- WAVE 10.2: INSIDE A ROOM ----------------
      const insideId = insideLotIdRef.current;
      const rm = roomRef.current;
      if (insideId && rm) {
        const { room, solid, canvas: roomCanvas } = rm;
        const keys = keysRef.current;
        let dx = 0, dy = 0;
        if (keys.has('w') || keys.has('arrowup')) dy -= 1;
        if (keys.has('s') || keys.has('arrowdown')) dy += 1;
        if (keys.has('a') || keys.has('arrowleft')) dx -= 1;
        if (keys.has('d') || keys.has('arrowright')) dx += 1;

        const roomBlocked = (x: number, y: number) => {
          const tx = Math.floor(x / TILE_SIZE), ty = Math.floor(y / TILE_SIZE);
          if (tx < 0 || ty < 0 || tx >= room.size.w || ty >= room.size.h) return true;
          return solid[ty * room.size.w + tx] === 1;
        };

        const p = roomPosRef.current;
        if (dx !== 0 || dy !== 0) {
          const len = Math.hypot(dx, dy);
          const step = LoadoutSystem.walkTilesPerSecond(usePlayerStore.getState().player.equipment, usePlayerStore.getState().player.attributes) * TILE_SIZE * dt;
          const mx = (dx / len) * step, my = (dy / len) * step;
          let nx = p.x + mx;
          if (roomBlocked(nx, p.y) && !roomBlocked(p.x, p.y)) nx = p.x;
          let ny = p.y + my;
          if (roomBlocked(nx, ny) && !roomBlocked(nx, p.y)) ny = p.y;
          p.x = nx; p.y = ny;
          facingRef.current = Math.abs(mx) > Math.abs(my) ? (mx > 0 ? 'right' : 'left') : (my > 0 ? 'down' : 'up');
          movingRef.current = true;
          if (time - stepRef.current.at > 560 / WALK_PHASES) {
            stepRef.current = { step: (stepRef.current.step + 1) % WALK_PHASES, at: time };
          }
          const tile = { x: Math.floor(p.x / TILE_SIZE), y: Math.floor(p.y / TILE_SIZE) };
          setRoomTile(prev => (prev.x === tile.x && prev.y === tile.y ? prev : tile));
          const d = roomDoor(room.size);
          if (tile.x === d.x && tile.y === d.y) {
            exitRoomRef.current();
            raf = requestAnimationFrame(loop);
            return;
          }
        } else if (movingRef.current) {
          movingRef.current = false;
          stepRef.current = { step: 0, at: 0 };
        }

        ctx.imageSmoothingEnabled = false;
        ctx.fillStyle = '#050505';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        const offX = Math.round((canvas.width - roomCanvas.width * ATOM_PX) / 2 / 2) * 2;
        const offY = Math.round((canvas.height - roomCanvas.height * ATOM_PX) / 2 / 2) * 2;
        ctx.drawImage(roomCanvas, offX, offY, roomCanvas.width * ATOM_PX, roomCanvas.height * ATOM_PX);

        // Construction underway: the queued pieces stand as outlines until the clock fills them.
        const pending = useHubStore.getState().buildJobs.filter(j => !j.applied && j.lotId === insideId && j.piece);
        ctx.strokeStyle = '#a1a1aa';
        ctx.lineWidth = 2;
        pending.forEach(j => {
          ctx.strokeRect(offX + j.piece!.x * TILE_SIZE + 3, offY + j.piece!.y * TILE_SIZE + 3, TILE_SIZE - 6, TILE_SIZE - 6);
        });

        // The thing in reach, marked; the tile ahead when the builder is out.
        const near = nearPlacementRef.current;
        if (near) {
          const d = near.item.dimensions || { width: 1, height: 1 };
          const fw = near.rotated ? d.height : d.width, fh = near.rotated ? d.width : d.height;
          ctx.strokeStyle = '#fafafa';
          ctx.strokeRect(offX + near.x * TILE_SIZE - 1, offY + near.y * TILE_SIZE - 1, fw * TILE_SIZE + 2, fh * TILE_SIZE + 2);
        }
        if (buildKindRef.current) {
          const t = aheadTile();
          ctx.strokeStyle = '#20de81';
          ctx.strokeRect(offX + t.x * TILE_SIZE + 1, offY + t.y * TILE_SIZE + 1, TILE_SIZE - 2, TILE_SIZE - 2);
        }

        const body = bodyFor(facingRef.current, stepRef.current.step, movingRef.current);
        const w = body.width * ATOM_PX, h = body.height * ATOM_PX;
        ctx.drawImage(body, Math.round((offX + p.x - w / 2) / 2) * 2, Math.round((offY + p.y - h / 2) / 2) * 2, w, h);
        raf = requestAnimationFrame(loop);
        return;
      }
      // ---------------- THE STREET ----------------

      const keys = keysRef.current;
      let dx = 0, dy = 0;
      if (keys.has('w') || keys.has('arrowup')) dy -= 1;
      if (keys.has('s') || keys.has('arrowdown')) dy += 1;
      if (keys.has('a') || keys.has('arrowleft')) dx -= 1;
      if (keys.has('d') || keys.has('arrowright')) dx += 1;

      const p = posRef.current;
      if (dx !== 0 || dy !== 0) {
        const len = Math.hypot(dx, dy);
        const step = LoadoutSystem.walkTilesPerSecond(usePlayerStore.getState().player.equipment, usePlayerStore.getState().player.attributes) * TILE_SIZE * dt;
        const mx = (dx / len) * step, my = (dy / len) * step;
        let nx = p.x + mx;
        if (blockedAt(nx, p.y) && !blockedAt(p.x, p.y)) nx = p.x;
        let ny = p.y + my;
        if (blockedAt(nx, ny) && !blockedAt(nx, p.y)) ny = p.y;
        p.x = nx; p.y = ny;
        facingRef.current = Math.abs(mx) > Math.abs(my) ? (mx > 0 ? 'right' : 'left') : (my > 0 ? 'down' : 'up');
        movingRef.current = true;
        if (time - stepRef.current.at > 560 / WALK_PHASES) {
          stepRef.current = { step: (stepRef.current.step + 1) % WALK_PHASES, at: time };
        }
        const tile = { x: Math.floor(p.x / TILE_SIZE), y: Math.floor(p.y / TILE_SIZE) };
        setPlayerTile(prev => (prev.x === tile.x && prev.y === tile.y ? prev : tile));
      } else if (movingRef.current) {
        movingRef.current = false;
        stepRef.current = { step: 0, at: 0 };
      }

      ctx.imageSmoothingEnabled = false;
      const cam = cameraOffset();
      const ox = Math.round(cam.x / 2) * 2, oy = Math.round(cam.y / 2) * 2; // snap to the atom grid
      ctx.fillStyle = outskirts ?? '#050505';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      const frame = reducedMotion ? 0 : Math.floor(time / 500) % 2;
      const city = cityBitmaps[frame];
      ctx.drawImage(city, -ox, -oy, city.width * ATOM_PX, city.height * ATOM_PX);
      // Where the ground ends, by a broken seam: past it looks much like the bare edge of a chunk.
      ctx.strokeStyle = '#a1a1aa';
      ctx.lineWidth = 4;
      ctx.setLineDash([8, 8]);
      ctx.beginPath();
      for (const e of groundEdges) {
        ctx.moveTo(e.x0 * TILE_SIZE - ox, e.y0 * TILE_SIZE - oy);
        ctx.lineTo(e.x1 * TILE_SIZE - ox, e.y1 * TILE_SIZE - oy);
      }
      ctx.stroke();
      ctx.setLineDash([]);
      const standing: { id: string; at: { x: number; y: number; moving: boolean } }[] = [];
      const clock = Date.now();
      for (const r of residentRoutes) {
        const at = ResidentDay.whereAt(r.route, clock, r.id);
        standing.push({ id: r.id, at });
        const person = personFor(r.uid, at.facing, at.step % WALK_PHASES, at.moving);
        const pw = person.width * ATOM_PX, ph = person.height * ATOM_PX;
        ctx.drawImage(person, Math.round((at.x * TILE_SIZE - pw / 2 - ox) / 2) * 2, Math.round((at.y * TILE_SIZE - ph / 2 - oy) / 2) * 2, pw, ph);
      }
      // Q18: whoever is within reach of you is who the interact key talks to.
      const near = ResidentDay.personInReach(standing, { x: Math.floor(p.x / TILE_SIZE), y: Math.floor(p.y / TILE_SIZE) });
      if (near !== nearPersonRef.current) { nearPersonRef.current = near; setNearPerson(near); }
      const body = bodyFor(facingRef.current, stepRef.current.step, movingRef.current);
      const w = body.width * ATOM_PX, h = body.height * ATOM_PX;
      ctx.drawImage(body, Math.round((p.x - w / 2 - ox) / 2) * 2, Math.round((p.y - h / 2 - oy) / 2) * 2, w, h);

      // Pedro: two people who meet talk. Watched, it is spoken now and seen in bubbles; unwatched, it waits for a batch.
      const hubId = useHubStore.getState().activeHubId;
      if (hubId) {
        const day = worldDay();
        const onScreen = (at: { x: number; y: number }) => {
          const sx = at.x * TILE_SIZE - ox, sy = at.y * TILE_SIZE - oy;
          return sx >= 0 && sy >= 0 && sx <= canvas.width && sy <= canvas.height;
        };
        for (const [a, b] of ResidentDay.meetings(standing)) {
          const key = MeetLaw.key(a, b, day);
          if (meetSeenRef.current.has(key)) continue;
          meetSeenRef.current.add(key);
          const atA = standing.find(s => s.id === a)!.at, atB = standing.find(s => s.id === b)!.at;
          const meeting = { a, b, day, where: whereNear(atA), why: 'waiting at the same door' };
          if (onScreen(atA) && onScreen(atB)) {
            void MeetDoor.live(hubId, meeting).then(lines => { if (lines && lines.length > 0) sayingRef.current.set(key, { a, b, lines, at: Date.now() }); });
          } else void MeetDoor.queue(hubId, [meeting]);
        }
      }
      for (const [key, said] of sayingRef.current) {
        const i = Math.floor((clock - said.at) / SAYING_SHOWS_MS);
        if (i >= said.lines.length) { sayingRef.current.delete(key); continue; }
        const line = said.lines[i];
        const speaker = standing.find(s => s.id === (line.by === 'a' ? said.a : said.b));
        if (speaker) drawSaying(ctx, line.text, speaker.at.x * TILE_SIZE - ox, speaker.at.y * TILE_SIZE - oy - TILE_SIZE);
      }
      const poi = nearbyRef.current;
      if (poi) {
        ctx.strokeStyle = '#fafafa';
        ctx.lineWidth = 2;
        ctx.strokeRect(poi.position.x * TILE_SIZE - ox - 1, poi.position.y * TILE_SIZE - oy - 1, poi.size.width * TILE_SIZE + 2, poi.size.height * TILE_SIZE + 2);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [cityBitmaps, groundEdges, residentRoutes, player.id, player.archetype, blockedAt, cameraOffset, reducedMotion, whereNear]);

  const handleCityClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const cam = cameraOffset();
    const tx = Math.floor((e.clientX - box.left + cam.x) / TILE_SIZE);
    const ty = Math.floor((e.clientY - box.top + cam.y) / TILE_SIZE);
    const poi = HubGenerator.getPOIAtPosition(layout, tx, ty);
    if (!poi?.interactable) return;
    if (withinReach(poi, playerTile)) handleInteract(poi);
    else pushFeed(`${poi.name} is too far off. Walk over.`, 'plain');
  };

  // =========================================================================
  // RENDER
  // =========================================================================

  const insideLot = insideLotId ? lots.find(l => l.id === insideLotId) ?? null : null;
  const mineInside = !!insideLot && insideLot.ownerId === player.id;
  // Wave 10B.5: the inspect card on a templated building, from the street and inside.
  const nearbyConstruction = nearbyPOI?.type === POIType.PLAYER_LOT ? lotConstruction(buildJobs, nearbyPOI.id) : null;
  const nearbyRoom = nearbyPOI?.type === POIType.PLAYER_LOT ? rooms[nearbyPOI.id] : undefined;
  const streetCard = nearbyRoom ? inspectBuiltRoom(nearbyRoom, player) : null;
  const insideCard = roomData ? inspectBuiltRoom(roomData, player) : null;
  const myPendingJobs = insideLotId ? buildJobs.filter(j => !j.applied && j.lotId === insideLotId) : [];
  const nearStationFn = nearPlacement ? stationFunctionOf(nearPlacement.item.universalDefinitionId) : undefined;

  return (
    <div ref={shellRef} className="ws-ui" style={{ position: 'relative', width: '100%', height: '100%', background: 'var(--ws-void-1)', overflow: 'hidden' }}>

      {/* HUD - Top Left */}
      <div style={{ position: 'absolute', top: 12, left: 12, zIndex: 100, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ display: 'flex', gap: 6 }}>
          <Chip tone="proof">{player.bank.gold.toLocaleString()} G</Chip>
          <Chip tone="signal">{player.username}</Chip>
        </div>
        {insideLot
          ? <span className="ws-dim ws-small">{HubGenerator.lotName(layout, insideLot).toUpperCase()} — {insideLot.structureType}{mineInside ? '' : ` · ${insideLot.ownerName}'s`}</span>
          : currentZone && <span className="ws-dim ws-small">{currentZone.name}</span>}
      </div>

      {/* Line 75: the minimap, on the street */}
      {!insideLot && (
        <div style={{ position: 'absolute', top: 12, right: 12, zIndex: 100 }}>
          <MinimapView compose={composeCityMap} scale={1} label="Map of the city" />
        </div>
      )}

      {/* Interaction Prompt */}
      {nearPerson && !activeNPC && !panel && !insideLot && !talking && (
        <div style={{ position: 'absolute', bottom: 90, left: '50%', transform: 'translateX(-50%)', zIndex: 100 }}>
          <Chip tone="signal"><b>{residents.find(r => r.id === nearPerson)?.name ?? 'Someone'}</b> <Kbd>E</Kbd> TALK</Chip>
        </div>
      )}
      {nearbyPOI && !nearPerson && !activeNPC && !panel && !insideLot && (
        <div style={{ position: 'absolute', bottom: 90, left: '50%', transform: 'translateX(-50%)', zIndex: 100, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
          {nearbyConstruction && (
            <Chip tone="proof">UNDER CONSTRUCTION — {nearbyConstruction.applied} of {nearbyConstruction.total} steps stand</Chip>
          )}
          <Chip tone="signal"><b>{nearbyPOI.name}</b> <Kbd>E</Kbd> {
            nearbyPOI.type === POIType.PLAYER_LOT &&
            lots.find(l => l.id === nearbyPOI.id && l.ownerId && l.structureType === 'FARM') ? 'WORK IT'
              : lots.find(l => l.id === nearbyPOI.id && l.ownerId && l.structureType !== 'EMPTY') ? 'ENTER' : 'INTERACT'
          }</Chip>
        </div>
      )}
      {/* Wave 10B.5: the house remembers its architect — the card from the street */}
      {streetCard && !activeNPC && !panel && !insideLot && (
        <div style={{ position: 'absolute', bottom: 90, left: 12, zIndex: 100, width: 230 }}>
          <CardView card={streetCard} />
        </div>
      )}
      {/* …and from inside: the house's own plaque */}
      {insideCard && insideLot && !stationPanel && (
        <div style={{ position: 'absolute', bottom: 90, left: 12, zIndex: 100, width: 230 }}>
          <CardView card={insideCard} />
        </div>
      )}
      {insideLot && nearPlacement && !stationPanel && (
        <div style={{ position: 'absolute', bottom: 90, left: '50%', transform: 'translateX(-50%)', zIndex: 100 }}>
          <Chip tone="signal">
            <b>{nearPlacement.item.name}</b>{nearStationFn ? <> <Kbd>E</Kbd> WORK</> : null}
          </Chip>
        </div>
      )}

      {/* Controls Hint */}
      <div style={{ position: 'absolute', bottom: 12, right: 12, zIndex: 100 }} className="ws-dim ws-small">
        {insideLot
          ? <><Kbd>WASD</Kbd> move · <Kbd>E</Kbd> work · <Kbd>TAB</Kbd> sheet · walk the doorway to leave</>
          : <><Kbd>WASD</Kbd> move · <Kbd>E</Kbd> interact · <Kbd>TAB</Kbd> sheet</>}
      </div>

      {/* WAVE 10.3: THE WORKS — building and placing, in the room, by the owner */}
      {insideLot && mineInside && !stationPanel && (
        <div style={{ position: 'absolute', top: 12, right: 12, zIndex: 100, width: 240 }}>
          <Panel title="THE WORKS">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span className="ws-dim ws-small">Structure, by the tile. The material pays the bill and sets the look.</span>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {(['WALL', 'DOOR', 'WINDOW'] as const).map(k => {
                  const mat = buildMaterialFor(k);
                  return (
                    <Button
                      key={k}
                      tone={buildKind === k ? 'signal' : 'quiet'}
                      title={mat ? `${PIECE_BILLS[k].count}x ${PIECE_BILLS[k].tag} — ${mat.name}` : `needs ${PIECE_BILLS[k].tag}`}
                      onClick={() => setBuildKind(buildKind === k ? null : k)}
                    >
                      {k}
                    </Button>
                  );
                })}
                <Button tone="quiet" disabled title="The hub grants a single floor at this tier.">STAIR</Button>
              </div>
              {buildKind && (
                <select className="ws-input" value={buildMaterialFor(buildKind)?.universalDefinitionId ?? ''} onChange={e => setBuildMatDef(e.target.value)} aria-label="Material for this piece">
                  {[...new Set(stashItems.filter(i => answersTag(i, PIECE_BILLS[buildKind].tag)).map(i => i.universalDefinitionId))].map(defId => (
                    <option key={defId} value={defId}>{materialLabel(defId)}</option>
                  ))}
                </select>
              )}
              <Button disabled={!buildKind} onClick={() => buildKind && void buildAhead(buildKind)}>
                BUILD ON THE TILE AHEAD
              </Button>
              <Button tone="quiet" onClick={() => void demolishAhead()}>TAKE DOWN THE TILE AHEAD</Button>

              <span className="ws-dim ws-small" style={{ marginTop: 4 }}>Placement. The item moves in; the record is signed.</span>
              <select className="ws-input" value={placeSelId} onChange={e => setPlaceSelId(e.target.value)} aria-label="Item to place">
                <option value="">Thing to place…</option>
                {stashItems.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
              </select>
              <Button disabled={!placeSelId} onClick={() => void placeAhead()}>PLACE ON THE TILE AHEAD</Button>
              <Button tone="quiet" disabled={!nearPlacement} onClick={() => void reclaimNear()}>
                RECLAIM {nearPlacement ? nearPlacement.item.name.toUpperCase() : 'IN REACH'}
              </Button>

              {myPendingJobs.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {myPendingJobs.map(j => (
                    <div key={j.id} className="ws-small">
                      <TimerBar label={String(j.kind === 'SHELL' ? j.structureType : j.piece?.kind)} startedAt={j.queuedAt} until={j.finishesAt} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Panel>
        </div>
      )}

      {/* THE CITY */}
      <canvas
        ref={cityRef}
        onClick={handleCityClick}
        style={{
          position: 'absolute', left: 0, top: 0, display: 'block',
          imageRendering: 'pixelated', cursor: nearbyPOI ? 'pointer' : 'default'
        }}
      />

      {/* NPC Dialogue */}
      {activeNPC && (
        <Modal title={`${activeNPC.name} — ${activeNPC.title}`} onClose={() => { setActiveNPC(null); setNpcReply(null); }} width={520}>
          <div className="ws-dialogue">
            <div className="ws-dialogue__head">
              <CastPortrait npcId={activeNPC.id} />
              <div className="ws-dialogue__speech">
                "{npcReply ?? activeNPC.dialogue.greeting}"
                {!npcReply && useHubStore.getState().vendors[activeNPC.id] && (
                  <div className="ws-dim ws-small" style={{ marginTop: 4 }}>"{VendorSystem.say(useHubStore.getState().vendors[activeNPC.id])}"</div>
                )}
              </div>
            </div>
            {/* Q26: a bed's length follows what was spent, so the inn shows what is held */}
            {activeNPC.dialogue.options.some(o => o.action === 'REST') && (
              <div style={{ margin: '6px 0' }}>
                <Bar label="ENERGY" value={RestSystem.energyHeld(usePlayerStore.getState().player)} max={StatSystem.maxEnergyOf(usePlayerStore.getState().player)} tone="proof" text={`${Math.floor(RestSystem.energyHeld(usePlayerStore.getState().player))} / ${Math.floor(StatSystem.maxEnergyOf(usePlayerStore.getState().player))}`} />
              </div>
            )}
            <div className="ws-dialogue__options">
              {/* D116: a keeper is a person too. Business stays below, and this is everything else. */}
              <Button tone="signal" onClick={() => { const npcId = activeNPC.id; setActiveNPC(null); setNpcReply(null); void useTalk.getState().open({ kind: 'CITY', npcId }); }}>
                Talk with them
              </Button>
              {withStudy(activeNPC).map((opt, i) => (
                <Button
                  key={i}
                  tone={opt.action === 'CLOSE' ? 'quiet' : 'signal'}
                  autoFocus={i === 0}
                  onClick={() => void applyEffect(runDialogueAction(opt.action, opt.payload))}
                >
                  {opt.label}
                </Button>
              ))}
            </div>
          </div>
        </Modal>
      )}

      {stationPanel === 'WORKSHOP' && insideLot && (
        <WorkshopStationModal lotId={insideLot.id} now={now} onClose={() => setStationPanel(null)} />
      )}
      {stationPanel === 'VENDOR' && insideLot && (
        <CounterStationModal lotId={insideLot.id} onClose={() => setStationPanel(null)} />
      )}
      {stationPanel === 'SCRIBE' && (
        <TemplateStudio onClose={() => setStationPanel(null)} />
      )}

      {panel?.kind === 'farm' && <FarmWindow lotId={panel.lotId} onClose={() => setPanel(null)} />}
      {panel?.kind === 'shop' && <ShopModal category={panel.category} onClose={() => setPanel(null)} />}
      {panel?.kind === 'sell' && <SellModal npcId={panel.npcId} onClose={() => setPanel(null)} />}
      {panel?.kind === 'repair' && <RepairModal onClose={() => setPanel(null)} />}
      {panel?.kind === 'lore' && <LoreModal onClose={() => setPanel(null)} />}
      {panel?.kind === 'plan' && <CityPlan onClose={() => setPanel(null)} />}
      {panel?.kind === 'tavern' && <TavernRoom onClose={() => setPanel(null)} />}
      {panel?.kind === 'guild' && <GuildHall onClose={() => setPanel(null)} />}
      <RankMomentView />
      <TalkWindow />
      {panel?.kind === 'apprentices' && <ApprenticeWindow npcId={panel.npcId} onClose={() => setPanel(null)} />}
    </div>
  );
};

// =============================================================================
// WAVE 10.3: STATION WINDOWS — the bench and the counter, in the room, calling
// the SAME store functions the Holdings panels call. No duplicate logic.
// =============================================================================

const WorkshopStationModal: React.FC<{ lotId: string; now: number; onClose: () => void }> = ({ lotId, now, onClose }) => {
  const hub = useHubStore();
  const { player } = usePlayerStore();
  const pushFeed = useFeed(s => s.push);
  const stash = player.bank.stashTabs[0]?.items || [];
  const countOf = (defId: string) => stash.filter(i => i.universalDefinitionId === defId).length;
  const jobs = hub.craftingJobs.filter(j => j.lotId === lotId && !j.collected);
  // Wave 10E (D6): a rank S+ making takes the maker's own name
  const [makerName, setMakerName] = useState('');
  // Wave 10E (D19): the identify eye trains here, sitting by sitting
  // The raw materials leg: a stash full of planks must not bury the piece still unread.
  const unread = (i: IItem) => i.isIdentified === false || (i.affixes || []).some(a => !LoadoutSystem.isAffixStudied(player, a.id));
  const withScope = stash.filter(i => StudySystem.identifyScopeOf(i) !== null);
  const studyable = [...withScope.filter(unread), ...withScope.filter(i => !unread(i))].slice(0, 6);
  // D26: what is worked into this room's walls, floors and furniture is read from here too.
  const thisRoom = hub.rooms[lotId];
  const roomUnread = thisRoom ? new Set(roomAdditions(thisRoom).filter(a => !LoadoutSystem.isAffixStudied(player, a.id)).map(a => a.id)).size : 0;

  return (
    <Modal title="THE BENCH" onClose={onClose} width={520}>
      <div className="ws-dim ws-small" style={{ marginBottom: 8 }}>
        Inputs leave the stash now; outputs mint when you look. The same bench the Holdings screen works.
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {/* Wave 10D: gear recipes (the chain is the power budget) join the bench */}
        {[...Object.values(RECIPE_DEFINITIONS), ...Object.values(GEAR_RECIPES).filter(r => r.requiredFacility === 'WORKSHOP'), ...hub.stationRecipesOn(lotId)].map(recipe => {
          const refusal = hub.craftRefusal(lotId, recipe.id);
          const seconds = hub.craftSecondsNow(lotId, recipe.id);
          const ready = !refusal && recipe.inputs.every(i => countOf(i.itemId) >= i.quantity);
          const mayName = hub.canNameCraft(recipe.id).ok;
          return (
            <div key={recipe.id} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {mayName && (
                <Input
                  value={makerName}
                  onChange={e => setMakerName(e.currentTarget.value)}
                  placeholder="Rank S work: write its name, and the bank signs it"
                />
              )}
              <Button
                disabled={!ready}
                title={refusal ?? recipe.description}
                onClick={async () => {
                  const ok = await hub.queueCraft(lotId, recipe.id, mayName ? makerName : undefined);
                  pushFeed(ok ? `${recipe.name} on the bench (${seconds}s).` : `${recipe.name}: the inputs are short.`, ok ? 'signal' : 'loss');
                }}
              >
                {recipe.name.toUpperCase()} ({seconds}s)
              </Button>
              {refusal && <span className="ws-dim ws-small">{refusal}</span>}
            </div>
          );
        })}
        {roomUnread > 0 && thisRoom && (
          <div className="ws-row" style={{ marginTop: 6 }}>
            <span className="ws-small">This room: {roomUnread} worked in, unread</span>
            <Button tone="quiet" onClick={() => {
              const v = usePlayerStore.getState().studyRoomAtStation(thisRoom);
              if (!v.ok && v.reason) pushFeed(v.reason, 'loss');
            }}>
              STUDY THE ROOM (furniture)
            </Button>
          </div>
        )}
        {/* Wave 10E (D19): STUDY — the scoped identify eye is earned here, time and again */}
        {studyable.length > 0 && (
          <>
            <div className="ws-row" style={{ marginTop: 6 }}>
              <span className="ws-dim ws-small">STUDY — the identify eye trains by the piece</span>
              <span className="ws-dim ws-small">
                {(['weapon', 'armor', 'tool', 'material', 'furniture'] as const)
                  .map(s => `${s} ${player.bank.universalSkills[StudySystem.scopeSkillId(s)]?.level ?? 0}`)
                  .join(' · ')}
              </span>
            </div>
            {studyable.map(item => (
              <div key={item.id} className="ws-row" {...hoverProps(item)}>
                <span className="ws-small" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 300 }}>
                  {item.isIdentified === false ? 'Unidentified signal' : item.name}
                </span>
                <Button tone="quiet" onClick={() => {
                  const v = usePlayerStore.getState().studyItemAtStation(item.id);
                  if (!v.ok && v.reason) pushFeed(v.reason, 'loss');
                }}>
                  STUDY ({StudySystem.identifyScopeOf(item)})
                </Button>
              </div>
            ))}
          </>
        )}
        {jobs.map(job => {
          const left = Math.ceil((job.finishesAt - now) / 1000);
          return (
            <div key={job.id} className="ws-row">
              <span className="ws-small">{craftName(job.recipeId)}</span>
              {left > 0
                ? <span style={{ flex: 1, maxWidth: 200 }}><TimerBar startedAt={job.queuedAt} until={job.finishesAt} /></span>
                : <Button tone="signal" onClick={() => void hub.resolveCrafts()}>COLLECT</Button>}
            </div>
          );
        })}
      </div>
    </Modal>
  );
};

const CounterStationModal: React.FC<{ lotId: string; onClose: () => void }> = ({ lotId, onClose }) => {
  const hub = useHubStore();
  const { player } = usePlayerStore();
  const pushFeed = useFeed(s => s.push);
  const stash = player.bank.stashTabs[0]?.items || [];
  const lot = hub.lots.find(l => l.id === lotId);
  const mine = lot?.ownerId === player.id;
  const [listId, setListId] = useState('');
  const [listPrice, setListPrice] = useState('50');
  const [askDefId, setAskDefId] = useState('');
  if (!lot) return null;

  return (
    <Modal title="THE COUNTER" onClose={onClose} width={560}>
      <div className="ws-dim ws-small" style={{ marginBottom: 8 }}>
        {mine
          ? 'Your shelf, served from the room. The hub keeps its cut of every sale.'
          : `${lot.ownerName}'s counter. What is listed is for sale.`}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {mine && (lot.proceeds || 0) > 0 && (
          <Button tone="proof" onClick={async () => {
            const got = await hub.collectProceeds(lotId);
            if (got > 0) pushFeed(`${got} G collected from the counter.`, 'proof');
          }}>
            COLLECT {lot.proceeds}G
          </Button>
        )}
        {mine && <CollectHeld lot={lot} />}
        {mine && (
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <select className="ws-input" style={{ flex: 1 }} value={listId} onChange={e => setListId(e.target.value)} aria-label="Item to list">
              <option value="">Item to list…</option>
              {stash.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
            </select>
            <AskFor value={askDefId} onChange={setAskDefId} />
            {!askDefId && <Input type="number" min={1} value={listPrice} onChange={e => setListPrice(e.target.value)} style={{ width: 70 }} aria-label="Price" />}
            <Button
              disabled={!listId || (!askDefId && !Number(listPrice))}
              onClick={async () => {
                if (!listId) return;
                const ok = await hub.listItemForSale(lotId, listId, askDefId ? 0 : Number(listPrice), askDefId || undefined);
                if (ok) { pushFeed('Listed. The shelf shows it.', 'signal'); setListId(''); }
              }}
            >
              LIST
            </Button>
          </div>
        )}
        {(lot.shopListings || []).length === 0 && <span className="ws-dim ws-small">The shelf is bare.</span>}
        {(lot.shopListings || []).map(listing => (
          <div key={listing.item.id} className="ws-row" {...hoverProps(listing.item)}>
            <span style={{ display: 'flex', gap: 6, alignItems: 'center', minWidth: 0 }}>
              <ItemSprite item={listing.item} cellPx={14} />
              <span className="ws-small" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{listing.item.name}</span>
            </span>
            <BuyListing lotId={lotId} listing={listing} />
          </div>
        ))}
      </div>
    </Modal>
  );
};

// =============================================================================
// SERVICE WINDOWS (Wave 9.7: each one is a working thing, or it is not here)
// =============================================================================

const ShopModal: React.FC<{ category: 'weapon' | 'armor' | 'consumable'; onClose: () => void }> = ({ category, onClose }) => {
  const { weaponShop, armorShop, consumableShop, purchaseFromShop } = useHubStore();
  const { player } = usePlayerStore();
  const pushFeed = useFeed(s => s.push);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const listings = category === 'weapon' ? weaponShop : category === 'armor' ? armorShop : consumableShop;
  const selected = listings.find(l => l.id === selectedId);
  const titles = { weapon: 'IRONFIST ARMS', armor: 'STEELWEAVE PROTECTION', consumable: "THE ALCHEMIST'S CORNER" };

  return (
    <Modal title={titles[category]} onClose={onClose} width={640}>
      <div className="ws-dim ws-small" style={{ marginBottom: 8 }}>Your gold: <span className="ws-proof">{player.bank.gold.toLocaleString()} G</span> · stock turns with the week</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 240px', gap: 10, alignItems: 'start' }}>
        <div className="ws-list">
          {listings.map(listing => (
            <div key={listing.id} className="ws-row" {...hoverProps(listing.item)} style={selectedId === listing.id ? { background: 'var(--ws-void-2)' } : undefined}>
              <button
                type="button" className="ws-ui"
                onClick={() => setSelectedId(listing.id)}
                style={{ display: 'flex', gap: 8, alignItems: 'center', flex: 1, minWidth: 0, textAlign: 'left', background: 'transparent', border: 'none', color: 'inherit', cursor: 'pointer', fontFamily: 'var(--ws-mono)', padding: 2 }}
              >
                <ItemSprite item={listing.item} cellPx={16} />
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{LoadoutSystem.shownName(listing.item)}</span>
                  <span className="ws-dim ws-small">{listing.deal ? `BARGAIN BIN: ${Math.max(0, listing.deal.until - worldDay())} days left${listing.stock > 1 ? ` · ${listing.stock} alike` : ''}` : `stock ${listing.stock}`}</span>
                </span>
              </button>
              <Button
                tone="proof"
                disabled={listing.stock <= 0 || player.bank.gold < priceOfListing(listing, player.attributes)}
                onClick={() => {
                  const item = purchaseFromShop(listing.id, category);
                  if (item) pushFeed(`Bought ${LoadoutSystem.shownName(item)} for ${priceOfListing(listing, player.attributes)} G. It is in your stash.`, 'proof');
                }}
              >
                BUY {priceOfListing(listing, player.attributes)}G
              </Button>
            </div>
          ))}
        </div>
        {selected
          ? <CardView card={inspectItem(selected.item, player)} />
          : <Panel title="INSPECT"><span className="ws-dim ws-small">Select a listing to read it.</span></Panel>}
      </div>
    </Modal>
  );
};

const SellModal: React.FC<{ npcId?: string; onClose: () => void }> = ({ npcId, onClose }) => {
  const { player } = usePlayerStore();
  const { sellToVendor, offerFor } = useHubStore();
  const pushFeed = useFeed(s => s.push);
  const stash = player.bank.stashTabs[0]?.items || [];

  return (
    <Modal title="SELL TO THE COUNTER" onClose={onClose} width={520}>
      <div className="ws-dim ws-small" style={{ marginBottom: 8 }}>
        The counter pays {StatSystem.vendorOffer(100, player.attributes)}% of value, from the hub treasury.
      </div>
      {stash.length === 0 && <div className="ws-dim ws-small">Your stash is empty.</div>}
      <div className="ws-list">
        {stash.map(item => {
          const offer = offerFor(item, npcId);
          return (
            <div key={item.id} className="ws-row" {...hoverProps(item)}>
              <span style={{ display: 'flex', gap: 8, alignItems: 'center', minWidth: 0 }}>
                <ItemSprite item={item} cellPx={16} />
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{LoadoutSystem.shownName(item)}</span>
                  <span className="ws-dim ws-small">{item.value}G listed value</span>
                </span>
              </span>
              {/* U14: a sale is a deliberate step */}
              <ArmedButton
                tone="proof"
                confirmLabel={`SELL FOR ${offer}G: SURE?`}
                onConfirm={async () => {
                  const paid = await sellToVendor(item.id, npcId);
                  if (paid) pushFeed(`Sold ${LoadoutSystem.shownName(item)} for ${paid} G.`, 'proof');
                  else pushFeed('The counter would not take that. Nothing moves.', 'loss');
                }}
              >
                SELL {offer}G
              </ArmedButton>
            </div>
          );
        })}
      </div>
    </Modal>
  );
};

const RepairModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { player } = usePlayerStore();
  const pushFeed = useFeed(s => s.push);
  const worn = repairable();

  return (
    <Modal title="REPAIR — STEELWEAVE" onClose={onClose} width={520}>
      <div className="ws-dim ws-small" style={{ marginBottom: 8 }}>
        A quarter of the item's worth, scaled by the damage. The frame remembers its shape.
      </div>
      {worn.length === 0 && <div className="ws-dim ws-small">Nothing you own needs work.</div>}
      <div className="ws-list">
        {worn.map(item => {
          const cost = repairCost(item as any);
          return (
            <div key={item.id} className="ws-row" {...hoverProps(item)}>
              <span style={{ display: 'flex', gap: 8, alignItems: 'center', minWidth: 0 }}>
                <ItemSprite item={item} cellPx={16} />
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</span>
                  <span className="ws-dim ws-small">{item.stats.durability}/{item.stats.maxDurability} durability</span>
                </span>
              </span>
              <Button
                tone="signal"
                disabled={player.bank.gold < cost}
                onClick={() => {
                  const res = repairItem(item.id);
                  pushFeed(res.text, res.ok ? 'signal' : 'loss');
                }}
              >
                REPAIR {cost}G
              </Button>
            </div>
          );
        })}
      </div>
    </Modal>
  );
};

const LoreModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { player } = usePlayerStore();
  const pushFeed = useFeed(s => s.push);
  const stash = player.bank.stashTabs[0]?.items || [];
  const fragments = stash.filter(i => i.type === ItemType.LORE && i.description);
  const topics = Object.values(player.bank.lore || {});

  return (
    <Modal title="THE STUDY — WHAT THE RUINS SAID" onClose={onClose} width={560}>
      {fragments.length === 0 && topics.length === 0 && (
        <div className="ws-dim ws-small">
          You hold no fragments. They wait in chests in the field, and the best of them read like this:
          <div style={{ fontStyle: 'italic', marginTop: 6, color: 'var(--ws-text-body)' }}>"{LORE_FRAGMENTS[0]}"</div>
        </div>
      )}
      {fragments.map(f => (
        <Panel key={f.id} title={f.name.toUpperCase()} tone="proof" style={{ marginBottom: 8 }}>
          <div className="ws-small" style={{ fontStyle: 'italic' }}>{f.description}</div>
          {/* D26: a trade's notes open what that trade leaves behind */}
          {f.loreData && !player.bank.lore[ProcessSystem.noteTopic(f.loreData.processFamily)] && (
            <Button style={{ marginTop: 6 }} onClick={() => {
              const v = usePlayerStore.getState().readLore(f.id);
              if (!v.ok && v.reason) pushFeed(v.reason, 'loss');
            }}>
              READ IT — {f.loreData.processFamily.toUpperCase()}
            </Button>
          )}
        </Panel>
      ))}
      {topics.length > 0 && (
        <div className="ws-list">
          {topics.map(t => (
            <div key={t.topic} className="ws-row">
              <span>{t.topic}</span>
              <span className="ws-dim ws-small">level {t.level} · studied {new Date(t.dateDiscovered).toLocaleDateString()}</span>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
};

export default HubCanvas;
