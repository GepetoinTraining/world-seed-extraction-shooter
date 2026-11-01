import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { EquipSlotId, IActiveSession, IItem, ItemType, SlotType } from '../../types';
import { useWorldStore } from '../entities/world/store';
import { usePlayerStore } from '../entities/player/store';
import { useHubStore } from '../entities/hub/store';
import { WebSystem } from '../logic/systems/WebSystem';
import { ProjectileSystem, PatternType, IProjectile } from '../entities/combat/projectileSystem';
import { LootTable } from '../entities/world/LootTable';
import { Leaders } from '../entities/world/Leaders';
import { CombatSystem } from '../entities/combat/CombatSystems';
import { applyKillRewards } from '../entities/combat/killRewards';
import { MobAI } from '../entities/mob/ai/MobAI';
import { InteractionEngine } from '../entities/interaction/InteractionEngine';
import { EntityType, IChunk, IWorldEntity } from '../entities/world/types';
import { SessionJournal } from '../logic/journal/SessionJournal';
import { PlayerPersistence } from '../logic/persistence/PlayerPersistence';
import { WorldGenerator } from '../entities/world/WorldGenerator';
import { QUADRANT_PX, SECTOR_PX, TILE_PX, quadrantOf, sectorOf } from '../entities/world/grid';
import { FieldRenderer, FieldScene, FieldEffect, MobPose, DEATH_BURST_MS } from '../render/FieldRenderer';
import { genreForWorld, entitySprite, baselinePx } from '../render/atoms/world';
import { ATOM_PX, SIZE_ATOMS } from '../render/atoms/atoms';
import { hitTest, targetsFrom, cycleTarget, inspectEntity, inspectItem, Card } from '../render/atoms/inspect';
import { Archetype, Facing, WALK_PHASES, armorClass, weaponClass } from '../render/atoms/people';
import { MOB_DEFINITIONS } from '../entities/mob/data/mobDefinitions';
import { InventorySystem, GRID_W, GRID_H } from '../entities/player/systems/InventorySystem';
import { LoadoutSystem } from '../entities/player/systems/LoadoutSystem';
import { CartSystem } from '../entities/world/CartSystem';
import { CartOverlay } from '../entities/world/CartOverlay';
import { ItemFactory } from '../entities/item/ItemFactory';
import { Rng } from '../logic/rng/DeterministicRNG';
import { CombatMath } from '../entities/combat/CombatMath';
import { BASE_CHANNEL_MS, StatSystem } from '../logic/systems/StatSystem';
import { CircleSystem } from '../logic/systems/CircleSystem';
import { ChestSystem } from '../entities/world/ChestSystem';
import { EffectSystem, IEffectAbility, IEffectReceipt, IStatusPlan, StatusClock } from '../logic/systems/EffectSystem';
import { RestSystem } from '../logic/systems/RestSystem';
import { GateWarning, SkyState, WorldClock } from '../entities/world/WorldClock';
import type { IPlayer as IPlayerShape } from '../../types';
import { WeaveSystem } from '../logic/systems/WeaveSystem';
import { ContentRegistry } from '../logic/theme/ContentRegistry';
import { RESOURCE_DEFINITIONS } from '../entities/item/data/resourceDefinitions';
import { ExitLevy } from '../logic/economy/ExitLevy';
import { ProgressionSystem } from '../entities/player/systems/ProgressionSystem';
import { Bar, Busy, Button, CardView, Chip, Kbd, Panel, RankMark } from './ui/kit';
import { useFeed, useHotbar, useRankMoment, useReceipt, useSheet, useWaits } from './ui/stores';
import { BodyClocks } from './WaitStrip';
import { ReconView } from './ReconView';
import { FOCUS_ENERGY_COST, InteractPick, fireGate, fireMode, hotbarSlotForDigit, isInteractKey, isTypingTarget, pickInteract } from '../logic/systems/FieldInput';
import { ItemGrid } from './ui/ItemGrid';
import { useHands } from './ui/hands';
import { PlacedCard } from './ui/HoverLayer';
import { MinimapView } from './ui/MinimapView';
import { fieldMinimap } from '../render/atoms/minimap';
import { Hotbar, activateHotbar } from './Hotbar';

// --- CONSTANTS ---
const TILE_SIZE = 20; // 1 Unit = 20 Pixels
const LOAD_RADIUS_PX = 1000; // Chunks exist this far out, so nothing is built in view
const MAX_DELTA = 0.1; // Clamp frame delta (seconds) so tab-switches don't teleport the player

const feed = (text: string, tone: 'plain' | 'signal' | 'proof' | 'loss' = 'plain') => useFeed.getState().push(text, tone);

// =============================================================================
// THE CART WINDOW (Wave 10C, D16): the bed's grid, the seal, the theft log
// =============================================================================

const CART_CELL = 24;
const CartWindow: React.FC = () => {
  const { cartWindowId, closeCartWindow, player, loadCart, unloadCart, rotateItem } = usePlayerStore();
  const { currentMap } = useWorldStore();
  if (!cartWindowId) return null;
  const entity = Object.values(currentMap?.chunks || {}).flatMap(c => c.entities).find(e => e.id === cartWindowId);
  const cart = entity?.cart;
  if (!cart) return null;
  const session = player.currentSession;
  const mine = cart.ownerId === player.id;
  const lastTheft = cart.theftLog[cart.theftLog.length - 1];

  return (
    <div className="ws-ui ws-overlay" style={{ background: 'rgba(3,3,3,0.7)', zIndex: 500 }} onClick={closeCartWindow} onPointerDown={e => e.stopPropagation()}>
      <div onClick={e => e.stopPropagation()}>
        <Panel
          title={`CART BED — ${cart.gridW}×${cart.gridH}`}
          right={<span className={mine ? 'ws-proof' : 'ws-loss'}>{mine ? 'YOUR SEAL' : `${cart.ownerName}'S SEAL`}</span>}
          style={{ maxWidth: '96vw' }}
        >
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
            <div>
              <ItemGrid
                zoneId="cart"
                place={{ kind: 'CART', entityId: cartWindowId }}
                items={cart.items}
                layout={cart.layout}
                gridW={cart.gridW}
                gridH={cart.gridH}
                cellPx={CART_CELL}
                onPrimary={item => { unloadCart(cartWindowId, item.id); }}
              />
              <div className="ws-dim ws-small" style={{ marginTop: 4 }}>
                {CartSystem.cartWeight(cart).toFixed(1)} kg aboard · tow pace ×{CartSystem.towSpeedModifier(CartSystem.cartWeight(cart)).toFixed(2)}
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, width: GRID_W * CART_CELL + 8 }}>
              <div className="ws-dim ws-small">PACK · drag across, or right-click to send a piece over</div>
              <ItemGrid
                zoneId="cart_pack"
                place={{ kind: 'PACK' }}
                items={session?.inventory ?? []}
                layout={session?.inventoryLayout ?? {}}
                gridW={GRID_W}
                gridH={GRID_H}
                cellPx={CART_CELL}
                onPrimary={item => { loadCart(cartWindowId, item.id); }}
                onRotate={item => rotateItem(item.id)}
              />
              {lastTheft && (
                <div className="ws-loss ws-small">
                  THEFT ON RECORD: towed away by {lastTheft.byName}, {new Date(lastTheft.at).toLocaleString()}{lastTheft.signature ? ' — signed' : ''}.
                </div>
              )}
              <div className="ws-dim ws-small">
                The cart stays in the world when you die or extract without it. Anyone may tow it; the act is signed.
              </div>
              <Button onClick={closeCartWindow}>CLOSE <Kbd>ESC</Kbd></Button>
            </div>
          </div>
        </Panel>
      </div>
    </div>
  );
};

// =============================================================================
// THE RANK MOMENT (Wave 9.5): a rank-up holds the corner of the screen
// =============================================================================

const RankMomentView: React.FC = () => {
  const { moment, clear } = useRankMoment();
  useEffect(() => {
    if (!moment) return;
    const t = setTimeout(clear, 6000);
    return () => clearTimeout(t);
  }, [moment, clear]);
  if (!moment) return null;
  return (
    <div className="ws-ui ws-overlay" style={{ background: 'rgba(3,3,3,0.6)', zIndex: 900 }} onClick={clear}>
      <Panel tone="signal" style={{ width: 380, textAlign: 'center' }}>
        <div style={{ display: 'flex', justifyContent: 'center', margin: '8px 0' }}>
          <RankMark rank={moment.to} scale={10} />
        </div>
        <div className="ws-signal" style={{ fontSize: 'var(--ws-font-display)', letterSpacing: '0.3em', fontWeight: 700 }}>
          RANK {moment.to}
        </div>
        <div className="ws-dim ws-small" style={{ margin: '4px 0 8px' }}>
          The rank is not a measure of power. It is a measure of how much the world believes in you.
        </div>
        <Chip tone="signal">LEVELS BEGIN AGAIN. WHAT YOU BUILT STAYS.</Chip>
        <div style={{ marginTop: 10 }}>
          <Button tone="quiet" onClick={clear} autoFocus>CONTINUE</Button>
        </div>
      </Panel>
    </div>
  );
};

// =============================================================================
// WORLD CANVAS
// =============================================================================

const OCTANTS = ['E', 'SE', 'S', 'SW', 'W', 'NW', 'N', 'NE'];

/** What the interact key says it will do, one short line. */
const promptFor = (pick: InteractPick | 'EXIT'): string => {
  if (pick === 'EXIT') return `EXTRACT (${(StatSystem.channelMs(BASE_CHANNEL_MS, usePlayerStore.getState().player.attributes) / 1000).toFixed(1)}s)`;
  if (pick.primary) return `${pick.primary.label.toUpperCase()}${pick.primary.energyCost > 0 ? ` · ${pick.primary.energyCost} energy` : ''}`;
  return `${pick.options.length} WAYS TO ACT`;
};

const KeyHelp: React.FC = () => (
  <div className="ws-dim ws-small" style={{ position: 'absolute', bottom: 12, right: 16, zIndex: 100, pointerEvents: 'none', background: 'rgba(3,3,3,0.72)', padding: '2px 8px', maxWidth: '30vw', textAlign: 'right' }}>
    <Kbd>WASD</Kbd> move · <Kbd>HOLD CLICK</Kbd> or <Kbd>SPACE</Kbd> fire · <Kbd>E</Kbd> act · <Kbd>TAB</Kbd> sheet · <Kbd>Q</Kbd> read
  </div>
);

export const WorldCanvas: React.FC<{ session: IActiveSession }> = ({ session }) => {
  // Store Hooks
  const { currentMap, reconMode, confirmDrop } = useWorldStore();
  const { performInteraction, processAction, player } = usePlayerStore();

  // Local State
  const [playerPatterns, setPlayerPatterns] = useState<any[]>([]);
  const [enemyPatterns, setEnemyPatterns] = useState<any[]>([]);
  const [activeSwings, setActiveSwings] = useState<any[]>([]);
  const [lootDrops, setLootDrops] = useState<any[]>([]);

  // Interaction Menu State: reached by the interact key or a right-click, never by firing
  const [menuPosition, setMenuPosition] = useState<{ x: number; y: number } | null>(null);
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);
  const [interactionOptions, setInteractionOptions] = useState<any[]>([]);

  // Inspect card (line 29): one target list answers the cursor and the keyboard
  const [inspected, setInspected] = useState<{ id: string; card: Card; x: number; y: number } | null>(null);
  const mouseRef = useRef<{ x: number; y: number } | null>(null);
  const inspectedIdRef = useRef<string | null>(null);
  inspectedIdRef.current = inspected?.id ?? null;
  const lastInspectAt = useRef(0);
  // Line 72: what the interact key would do right now, said above the hotbar
  const [prompt, setPrompt] = useState<string | null>(null);
  const promptRef = useRef<string | null>(null);
  // The aim follows the pointer everywhere; the inspect card only over the ground
  const aimRef = useRef<{ x: number; y: number } | null>(null);
  // Line 72: held buttons; the loop asks the fire gate every frame
  const firingRef = useRef({ mouse: false, key: false });
  // D71, D77: read from the world's clock each frame, shown when the words change
  const lightRef = useRef(1);
  const gateShownRef = useRef('');
  const [gate, setGate] = useState<{ warning: GateWarning; left: string; sky: SkyState }>({ warning: 'NONE', left: '', sky: 'DAY' });
  const energyToldRef = useRef(false);
  // Line 75: quadrants this session has had in sight, and the exits of sectors it knows
  const seenRef = useRef<Set<string>>(new Set());
  const shotCountRef = useRef(0);
  const triggerReadyRef = useRef<Record<string, number>>({});
  const lastHurtByRef = useRef<string | null>(null);
  const hurtCountRef = useRef(0);
  const exitsRef = useRef<Map<string, { x: number; y: number }[]>>(new Map());

  // Refs for Game Loop
  const requestRef = useRef<number>();
  const lastTickRef = useRef<number>(Date.now());
  const keysPressed = useRef<Set<string>>(new Set());
  const canvasRef = useRef<HTMLDivElement>(null);
  const fieldRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<{ seed: string; renderer: FieldRenderer } | null>(null);
  const facingRef = useRef<Facing>('down');
  const stepRef = useRef({ step: 0, at: 0 });
  const movingRef = useRef(false);
  const loadedQuadrantRef = useRef('');

  // Wave 8B: hit flashes, death bursts and the hurt edge; reduced motion holds them still
  const effectsRef = useRef<FieldEffect[]>([]);
  const hurtAtRef = useRef(0);
  const reducedMotionRef = useRef(
    typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );

  // Wave 4.1: fire-rate limiter
  const lastShotRef = useRef<number>(0);
  const spentShots = useRef<Map<string, number>>(new Map());

  // Doors the keyboard effect and the loop reach through, always current
  const interactRef = useRef<() => void>(() => {});
  const escapeRef = useRef<() => void>(() => {});
  const interactPickRef = useRef<() => InteractPick | 'EXIT' | null>(() => null);
  const fireRef = useRef<(now: number) => void>(() => {});

  // What is in the hand: the hotbar's choice, read from the harness
  const activeWeapon = () => {
    const slot = useHotbar.getState().active;
    const eq = usePlayerStore.getState().player.equipment;
    return { slot, item: eq ? LoadoutSystem.itemIn(eq, slot) : undefined };
  };

  // Equipped gear resolvers (Wave 10C: the harness is the truth — the three
  // buckets map onto the slot tree for every old caller)
  const getEquipped = (slot: 'mainHand' | 'armor' | 'accessory') => {
    const eq = usePlayerStore.getState().player.equipment;
    if (!eq) return undefined;
    const slotId = slot === 'mainHand' ? 'RIGHT_HAND' : slot === 'armor' ? 'CHEST' : 'TOOL_1';
    return LoadoutSystem.itemIn(eq, slotId);
  };

  // The player's side of the one effect door: a weave, a known ability, a scroll or a piece's trigger.
  const applyPlayerReceipt = (receipt: IEffectReceipt, now: number, origin: { x: number; z: number }, angle: number) => {
    if (EffectSystem.landsOnCaster(receipt.effect, receipt.delivery)) {
      usePlayerStore.setState(s => {
        const session = s.player.currentSession;
        if (!session) return s;
        // Pedro: magic can refill the day's energy
        const refilled = receipt.effect === 'rest' ? RestSystem.refillEnergy(s.player, receipt.magnitude).currentSession! : session;
        return { player: { ...s.player, currentSession: {
          ...refilled,
          health: receipt.effect === 'heal' ? Math.min(session.maxHealth, session.health + receipt.magnitude) : session.health,
          activeEffects: receipt.status ? StatusClock.add(session.activeEffects, receipt.status, now) : session.activeEffects
        } } };
      });
      return;
    }
    const damage = receipt.effect === 'damage' ? receipt.magnitude : Math.round(receipt.magnitude / 4);
    if (receipt.delivery === 'ranged') {
      setPlayerPatterns(prev => [...prev.filter(p => now - p.startTime < 2000),
        { type: PatternType.SINGLE, origin: { x: origin.x, y: origin.z }, startTime: now, angle, damage, status: receipt.status }]);
    } else if (receipt.delivery === 'melee' || receipt.delivery === 'touch') {
      setActiveSwings(prev => [...prev.filter(s => now - s.startTime < 300),
        { origin: { x: origin.x, y: origin.z }, angle, range: receipt.reachPx, startTime: now, damage, status: receipt.status }]);
    } else {
      setPlayerPatterns(prev => [...prev.filter(p => now - p.startTime < 2000),
        { type: PatternType.NOVA, origin: { x: origin.x, y: origin.z }, startTime: now, angle, damage, status: receipt.status }]);
    }
  };

  const castFromFocus = (cast: NonNullable<IPlayerShape['activeCast']>, now: number, origin: { x: number; z: number }, angle: number) => {
    const player = usePlayerStore.getState().player;
    const rank = ProgressionSystem.rankOf(player);
    const ability: IEffectAbility | undefined = cast.kind === 'weave' ? WeaveSystem.weave(cast.elements)
      : cast.kind === 'gift' ? CircleSystem.abilityOf(player, cast.id) : ContentRegistry.ability(cast.id);
    if (!ability) return;
    const can = WeaveSystem.canCast(player, ability, rank);
    if (!can.ok) {
      if (!energyToldRef.current) feed(`Not enough ${can.short} held to work that. Gather more.`, 'loss');
      energyToldRef.current = true;
      return;
    }
    const receipt = EffectSystem.resolve(ability, { rank, power: StatSystem.castPower(player.attributes) }, SessionJournal.rollKey('cast', String(shotCountRef.current++)));
    usePlayerStore.setState(s => {
      let next = WeaveSystem.spend(s.player, ability, rank);
      if (cast.kind === 'weave') next = RestSystem.queueWeave(next, cast.elements);
      return { player: next };
    });
    applyPlayerReceipt(receipt, now, origin, angle);
  };

  // Line 72: one shot, if the gate says so. The weapon decides how; the hand decides which.
  fireRef.current = (now: number) => {
    const st = usePlayerStore.getState();
    const playerPos = st.player.currentSession?.position;
    if (!playerPos) return;
    const { slot, item: weapon } = activeWeapon();
    const mode = fireMode(weapon);
    const gate = fireGate({
      held: true, now, lastShot: lastShotRef.current,
      cooldownMs: CombatMath.fireCooldownMs(weapon, st.player.equipment, st.player.attributes), mode,
      energy: st.player.currentSession?.energy ?? 0
    });
    if (gate === 'NO_ENERGY') {
      if (!energyToldRef.current) feed('Not enough energy to cast. The focus hums and refuses.', 'loss');
      energyToldRef.current = true;
      return;
    }
    if (gate !== 'FIRE') return;
    useHotbar.getState().fired(slot, now, CombatMath.fireCooldownMs(weapon, st.player.equipment, st.player.attributes));

    // The pointer aims; the keyboard aims at what the inspect card holds, or the way you face.
    let angle: number;
    if (firingRef.current.mouse && aimRef.current) {
      angle = Math.atan2(aimRef.current.y - window.innerHeight / 2, aimRef.current.x - window.innerWidth / 2);
    } else {
      const { near } = inspectedIdRef.current ? targetsNear(playerPos.x, playerPos.z, 300) : { near: [] as IWorldEntity[] };
      const target = near.find(n => n.id === inspectedIdRef.current);
      angle = target
        ? Math.atan2(target.position.y - playerPos.z, target.position.x - playerPos.x)
        : { right: 0, down: Math.PI / 2, left: Math.PI, up: -Math.PI / 2 }[facingRef.current];
    }
    // Line 77: keyed by the session's own count of shots, so a run replays the same
    const { damage, poison } = CombatMath.outgoing(weapon, st.player.equipment, SessionJournal.rollKey('shot', String(shotCountRef.current++)), st.player.attributes, WebSystem.handPower(st.player, weapon));

    if (mode === 'MELEE') {
      // Swing: a short arc resolved by CombatSystem
      setActiveSwings(prev => [
        ...prev.filter(s => now - s.startTime < 300),
        { origin: { x: playerPos.x, y: playerPos.z }, angle, range: 60, startTime: now, damage, poison }
      ]);
    } else if (mode === 'FOCUS' && st.player.activeCast) {
      // Layer 4: what the focus was set to cast, through the one door
      castFromFocus(st.player.activeCast, now, playerPos, angle);
    } else if (mode === 'FOCUS') {
      // Focus: a NOVA burst, paid in energy
      usePlayerStore.setState(s => s.player.currentSession ? ({
        player: { ...s.player, currentSession: { ...s.player.currentSession, energy: s.player.currentSession.energy - FOCUS_ENERGY_COST } }
      }) : s);
      setPlayerPatterns(prev => [
        ...prev.filter(p => now - p.startTime < 2000),
        { type: PatternType.NOVA, origin: { x: playerPos.x, y: playerPos.z }, startTime: now, angle, damage, poison }
      ]);
    } else {
      // Ranged (or unarmed): a single shot
      setPlayerPatterns(prev => [
        ...prev.filter(p => now - p.startTime < 2000),
        { type: PatternType.SINGLE, origin: { x: playerPos.x, y: playerPos.z }, startTime: now, angle, damage, poison }
      ]);
    }

    lastShotRef.current = now;
    if (weapon) st.wearSlot(slot, 1); // durability: every use costs
  };

  // Wave 2.5: extraction channel + regrow sweep timing
  const [channeling, setChanneling] = useState(false);
  const channelRef = useRef<number | null>(null);
  const lastRegrowSweep = useRef<number>(0);
  // Wave 10C (D16): towed-cart follow cadence
  const lastCartSync = useRef<number>(0);

  const channelMs = () => StatSystem.channelMs(BASE_CHANNEL_MS, usePlayerStore.getState().player.attributes);
  // Line 124: however the channel ends, its bar ends with it
  useEffect(() => {
    if (!channeling || !channelRef.current) return;
    useWaits.getState().begin({ id: 'channel', label: 'CHANNEL', startedAt: channelRef.current, until: channelRef.current + channelMs() });
    return () => useWaits.getState().end('channel');
  }, [channeling]);
  const BEACON_RANGE = 60; // px

  // Completes the extraction: tax, journal seal, banking, save — and the SEAL moment
  const completeExtraction = useCallback(() => {
    const st = usePlayerStore.getState();
    const session = st.player.currentSession;
    if (!session) return;

    const world = useWorldStore.getState();
    const card = world.availableWorlds.find(w => w.id === world.activeWorldId);
    const worldCertUid = world.activeWorldId;
    let haul = session.inventory.filter(i => !session.kitItemIds?.includes(i.id));

    // Wave 10C (D16): towing the cart INTO the beacon banks its bed. The kit
    // folds back to the stash; the cart leaves the world with you, exactly once.
    const towedId = session.towingCartId;
    const towed = towedId
      ? Object.values(world.currentMap?.chunks || {}).flatMap(c => c.entities).find(e => e.id === towedId)
      : undefined;
    let cartHaul: typeof haul = [];
    if (towed?.cart) {
      cartHaul = towed.cart.items;
      const kitBack = {
        ...ItemFactory.createResourceItem({
          id: 'cart_field_t1', name: 'Field Cart (Packed)', weight: 15,
          dimensions: { width: 2, height: 3 }, tags: ['cart', 'heavy']
        } as any, Rng.fromKey(`cartfold:${towed.cart.cartItemId}`)),
        id: towed.cart.cartItemId, // the same cart, folded — never a second one
        type: ItemType.GEAR,
        cartData: { gridW: towed.cart.gridW, gridH: towed.cart.gridH }
      };
      usePlayerStore.setState(s => ({
        player: {
          ...s.player,
          bank: {
            ...s.player.bank,
            stashTabs: s.player.bank.stashTabs.map((tab, idx) => idx === 0 ? { ...tab, items: [...tab.items, kitBack] } : tab)
          }
        }
      }));
      world.removeEntity(towedId!);
      feed(`The cart comes home: ${cartHaul.length} item${cartHaul.length === 1 ? '' : 's'} off its bed, banked with the haul.`, 'proof');
    }

    // Wave 10C: gear equipped FROM the field is haul too — the harness dodges no levy
    const equipment = st.player.equipment;
    const wornNewcomers = (equipment?.items ?? []).filter(i => !session.kitItemIds?.includes(i.id));
    haul = [...haul, ...cartHaul, ...wornNewcomers];

    const haulValue = haul.reduce((s, i) => s + (i.value || 0), 0);
    const rate = StatSystem.levyRate(card?.extractionTaxRate ?? 0.05, st.player.attributes);
    const tax = Math.floor(haulValue * rate);
    const startedAt = Date.now();

    SessionJournal.record('EXTRACT', { loot: haul.map(i => i.id), haulValue, rate, tax, cartItemIds: cartHaul.map(i => i.id) });
    // the cart's bed banks straight into the stash (it never fit a pack — that is its point)
    if (cartHaul.length > 0) {
      usePlayerStore.setState(s => ({
        player: {
          ...s.player,
          bank: {
            ...s.player.bank,
            stashTabs: s.player.bank.stashTabs.map((tab, idx) =>
              idx === 0 ? { ...tab, items: [...tab.items, ...cartHaul.map(i => ({ ...i, isIdentified: true }))] } : tab)
          }
        }
      }));
    }
    // every OTHER cart stays in the world, on record
    void usePlayerStore.getState().persistCarts();
    st.emergencyJackOut();
    world.exitWorld();

    // The vault door starts closing now; the signature lands on it when sealed.
    useReceipt.getState().show({
      outcome: 'EXTRACTED', haul, haulValue, tax, sealing: true,
      worldName: card?.name ?? 'UNKNOWN', durationMs: 0, actionCount: 0
    });

    void (async () => {
      // D30: the sealed session is the rest. What was worked at may settle, and the receipt says so.
      const settled = await useHubStore.getState().restAndCredit('SEALED');
      const charged = await ExitLevy.charge(worldCertUid || 'unknown', haulValue, rate);
      if (charged > 0) console.log(`[TAX] Hub levied ${charged}G (${(rate * 100).toFixed(0)}% of ${haulValue}G haul).`);
      // Wave 6.2: everything that made it home gets its story signed
      const { Provenance } = await import('../logic/sovereignty/Provenance');
      await Provenance.recordMany(haul, 'MINT', { origin: 'EXTRACTION', sessionId: session.sessionId, worldCertUid });

      const after = PlayerPersistence.persistableJson(usePlayerStore.getState().player);
      const signed = await SessionJournal.finish('EXTRACTED', after);
      await PlayerPersistence.flush('extract');
      if (useReceipt.getState().receipt?.outcome === 'EXTRACTED') {
        useReceipt.getState().show({
          outcome: 'EXTRACTED', haul, haulValue, tax,
          settled: settled.map(s => WebSystem.nameOf(s.id)),
          worldName: card?.name ?? 'UNKNOWN',
          durationMs: signed?.payload.durationMs ?? (Date.now() - startedAt),
          actionCount: signed?.payload.actionCount ?? 0,
          signature: signed?.signature,
          receipt: signed?.payload
        });
      }
    })();
  }, []);

  // 1. Drop Confirmation: place the agent at the chosen sector, then go live
  const handleConfirmDrop = useCallback((sectorX: number, sectorY: number) => {
    const map = useWorldStore.getState().currentMap;
    if (!map) return;
    // Never into water, rock or on an island with no way out
    const target = WorldGenerator.dropPoint(map, sectorX, sectorY);
    usePlayerStore.setState(state => {
      if (!state.player.currentSession) return state;
      return {
        player: {
          ...state.player,
          currentSession: {
            ...state.player.currentSession,
            position: { x: target.x, y: 0, z: target.z }
          }
        }
      };
    });
    lastTickRef.current = Date.now(); // Fresh delta so the first frame doesn't jump
    SessionJournal.record('DROP', { sectorX, sectorY });
    useWorldStore.getState().loadAround(target.x, target.z, LOAD_RADIUS_PX);
    confirmDrop();

    // Wave 10C (D16): what was left on wheels is still here. The overlay stands
    // the carts back up, building their chunks first if the drop was far away.
    const worldUid = useWorldStore.getState().activeWorldId;
    if (worldUid) {
      void CartOverlay.load(worldUid).then(placed => {
        if (useWorldStore.getState().activeWorldId !== worldUid) return;
        for (const p of placed) {
          useWorldStore.getState().loadAround(p.position.x, p.position.y, 64);
          const fresh = useWorldStore.getState().currentMap;
          if (!fresh) return;
          const exists = Object.values(fresh.chunks).flatMap(c => c.entities).some(e => e.id === p.id);
          if (!exists) {
            useWorldStore.getState().addEntity({
              id: p.id,
              type: EntityType.CART,
              definitionId: 'cart_field',
              position: { ...p.position },
              rank: 'F' as any,
              rarity: 'COMMON' as any,
              isHostile: false,
              cart: { ...p.cart, towedBy: undefined }
            });
          }
        }
        if (placed.length > 0) feed(`${placed.length} cart${placed.length === 1 ? '' : 's'} on record in this world. What was left on wheels is where it was left.`, 'plain');
      });
    }
  }, [confirmDrop]);

  // Every drop starts with the right hand: a hand left empty last time should not surprise you
  useEffect(() => { useHotbar.getState().setActive('RIGHT_HAND'); }, []);

  // A world that skips recon still has to set you down somewhere
  const placedRef = useRef(false);
  useEffect(() => {
    const { reconMode: recon, selectedDropZone } = useWorldStore.getState();
    if (!recon && selectedDropZone && !placedRef.current) {
      placedRef.current = true;
      handleConfirmDrop(selectedDropZone.x, selectedDropZone.y);
    }
  }, [handleConfirmDrop]);

  // Shared target list: everything near a point, shaped for the hit test (line 29)
  const targetsNear = useCallback((cx: number, cz: number, reach = 220) => {
    const map = useWorldStore.getState().currentMap;
    if (!map) return { targets: [], near: [] as IWorldEntity[] };
    const near = WorldGenerator.chunkKeysInBox(cx, cz, reach).flatMap(key => map.chunks[key]?.entities ?? []);
    const things = near.map(n => {
      const s = entitySprite(n);
      const h = (s?.h ?? 12) * ATOM_PX;
      // Upright things hang above their feet, so their hit box does too
      const cy = s ? n.position.y + baselinePx(n, s) - h / 2 : n.position.y;
      return { id: n.id, type: n.type, x: n.position.x, y: cy, w: (s?.w ?? 12) * ATOM_PX, h };
    });
    return { targets: targetsFrom(things), near };
  }, []);

  const inspectById = useCallback((id: string | null, near: IWorldEntity[]) => {
    if (!id) { setInspected(cur => (cur ? null : cur)); return; }
    const entity = near.find(n => n.id === id);
    const liveSession = usePlayerStore.getState().player.currentSession;
    if (!entity || !liveSession) { setInspected(cur => (cur ? null : cur)); return; }
    const dist = Math.hypot(entity.position.x - liveSession.position.x, entity.position.y - liveSession.position.z) / TILE_SIZE;
    const card = inspectEntity(entity, {
      player: usePlayerStore.getState().player,
      dist,
      level: WebSystem.knowledgeReader(usePlayerStore.getState().player),
      worldSeed: useWorldStore.getState().currentMap?.seed,
      webVersion: useWorldStore.getState().availableWorlds.find(w => w.id === useWorldStore.getState().activeWorldId)?.webVersion
    });
    const screenX = entity.position.x - liveSession.position.x + window.innerWidth / 2;
    const screenY = entity.position.y - liveSession.position.z + window.innerHeight / 2;
    setInspected({ id, card, x: screenX, y: screenY });
  }, []);

  // 2. Input Handling
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (useWorldStore.getState().reconMode || isTypingTarget(e.target)) return;
      if (RestSystem.isResting(usePlayerStore.getState().player)) return; // D79: a character at rest does nothing
      const onControl = (e.target as HTMLElement)?.tagName === 'BUTTON';
      if (useHands.getState().held || e.key === 'Tab') return; // the hands and the sheet own these
      // Q cycles the inspect card through what is near, nearest first (line 29)
      if (e.key.toLowerCase() === 'q') {
        const liveSession = usePlayerStore.getState().player.currentSession;
        if (!liveSession) return;
        const { targets, near } = targetsNear(liveSession.position.x, liveSession.position.z);
        const next = cycleTarget(targets, { x: liveSession.position.x, y: liveSession.position.z }, inspectedIdRef.current, 220);
        inspectById(next, near);
        return;
      }
      if (e.key === 'Escape') {
        setInspected(null);
        setMenuPosition(null);
        escapeRef.current();
        return;
      }
      // Line 75: a digit reaches a hand, a tool or the belt, no pack-opening
      if (/^[0-9]$/.test(e.key)) {
        const slot = hotbarSlotForDigit(usePlayerStore.getState().player.equipment, e.key);
        if (slot) activateHotbar(slot);
        return;
      }
      // Line 72: one interact key, the city's own; a control keeps its own Enter
      if (isInteractKey(e.key) && !onControl) {
        e.preventDefault();
        if (!e.repeat) interactRef.current();
        return;
      }
      if (e.key === ' ' && !onControl) {
        e.preventDefault();
        firingRef.current.key = true;
        return;
      }
      keysPressed.current.add(e.key.toLowerCase());
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      keysPressed.current.delete(e.key.toLowerCase());
      if (e.key === ' ') { firingRef.current.key = false; energyToldRef.current = false; }
    };
    // Line 72: a button let go anywhere stops the firing, and so does losing the window
    const handlePointerUp = () => { firingRef.current.mouse = false; energyToldRef.current = false; };
    const handleBlur = () => { firingRef.current = { mouse: false, key: false }; keysPressed.current.clear(); };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('blur', handleBlur);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('blur', handleBlur);
    };
  }, [targetsNear, inspectById]);

  // 3. THE GAME LOOP
  useEffect(() => {
    if (reconMode || !currentMap) return;

    // The one way a run ends badly: by harm, or by the gate closing on it (D77).
    // The world's death penalty applies either way (Wave 4.4).
    const endRun = (cause: 'HURT' | 'GATE') => {
      const w = useWorldStore.getState();
      const card = w.availableWorlds.find(c => c.id === w.activeWorldId);
      const penalty = card?.deathPenalty ?? 'INVENTORY_LOSS';
      console.warn(`[SESSION] Agent flatlined by ${cause}. Penalty: ${penalty}.`);
      SessionJournal.record('DEATH', { penalty, cause });
      // Line 90: what brought a person down grows more common, after the next regeneration
      if (cause === 'HURT' && lastHurtByRef.current) {
        const killer = Object.values(w.currentMap?.chunks ?? {}).flatMap(c => c.entities).find(e => e.id === lastHurtByRef.current);
        if (killer) w.reportToDirector('FELLED_A_PERSON', killer.definitionId, { id: killer.id, rank: ProgressionSystem.rankOf(usePlayerStore.getState().player) });
      }

      // Wave 10C (D16): the cart stays in the world, standing where it was
      void usePlayerStore.getState().persistCarts();

      // The DIED receipt (Wave 9.6 + D21): what fell is lost — and the
      // death keeps EXACTLY the slots the magic named, said on the receipt
      const outcome = usePlayerStore.getState().emergencyJackOut(penalty);
      const lost = outcome.lost;
      const lostValue = lost.reduce((s, i) => s + (i.value || 0), 0);
      const told = { cause: cause === 'GATE' ? 'GATE' as const : undefined };

      useWorldStore.getState().exitWorld();
      void useHubStore.getState().restAndCredit('DIED'); // D30: the return to the hub
      useReceipt.getState().show({
        outcome: 'DIED', haul: lost, haulValue: lostValue, tax: 0, kept: outcome.kept, sealing: true,
        worldName: card?.name ?? 'UNKNOWN', durationMs: 0, actionCount: 0, ...told
      });
      // Seal the journal and the bank (async; loop is already stopped)
      const after = PlayerPersistence.persistableJson(usePlayerStore.getState().player);
      void SessionJournal.finish('DIED', after).then(signed => {
        if (useReceipt.getState().receipt?.outcome === 'DIED') {
          useReceipt.getState().show({
            outcome: 'DIED', haul: lost, haulValue: lostValue, tax: 0, kept: outcome.kept,
            worldName: card?.name ?? 'UNKNOWN',
            durationMs: signed?.payload.durationMs ?? 0,
            actionCount: signed?.payload.actionCount ?? 0,
            signature: signed?.signature,
            receipt: signed?.payload,
            ...told
          });
        }
        return PlayerPersistence.flush('death');
      });
    };

    const gameLoop = (time: number) => {
      const now = Date.now();
      // --- PHYSICS FIX: DELTA TIME (Seconds, clamped) ---
      const prevTick = lastTickRef.current;
      const dt = Math.min((now - prevTick) / 1000, MAX_DELTA);
      lastTickRef.current = now;

      // A. Movement Logic (Time-Based)
      const keys = keysPressed.current;
      let dx = 0, dz = 0;

      if (keys.has('w') || keys.has('arrowup')) dz -= 1;
      if (keys.has('s') || keys.has('arrowdown')) dz += 1;
      if (keys.has('a') || keys.has('arrowleft')) dx -= 1;
      if (keys.has('d') || keys.has('arrowright')) dx += 1;
      const atRest = RestSystem.isResting(usePlayerStore.getState().player, now);
      if (atRest) { dx = 0; dz = 0; } // D79: a character at rest stays where it lay down

      if (dx !== 0 || dz !== 0) {
        // Normalize so diagonals aren't faster, then scale to pixels
        const len = Math.sqrt(dx * dx + dz * dz);
        const walker = usePlayerStore.getState().player;
        const moveStep = LoadoutSystem.walkTilesPerSecond(walker.equipment, walker.attributes) * StatusClock.paceScale(walker.currentSession?.activeEffects) * dt * TILE_SIZE;
        dx = (dx / len) * moveStep;
        dz = (dz / len) * moveStep;

        // Wave 3.2: encumbrance — a heavy pack slows you before the mud does
        const { currentWeight, maxWeight } = usePlayerStore.getState();
        const loadMod = InventorySystem.speedModifier(currentWeight, maxWeight);
        dx *= loadMod;
        dz *= loadMod;

        // Wave 10C (D16): the tow bar costs — the cart's whole load, at your heels
        const towId = usePlayerStore.getState().player.currentSession?.towingCartId;
        if (towId) {
          const towed = Object.values(useWorldStore.getState().currentMap?.chunks || {})
            .flatMap(c => c.entities).find(e => e.id === towId);
          if (towed?.cart) {
            const towMod = CartSystem.towSpeedModifier(CartSystem.cartWeight(towed.cart));
            dx *= towMod;
            dz *= towMod;
          }
        }

        facingRef.current = Math.abs(dx) > Math.abs(dz) ? (dx > 0 ? 'right' : 'left') : (dz > 0 ? 'down' : 'up');
        movingRef.current = true;
        // A full stride is ~560ms whatever the cycle: 4 phases step quicker than 2
        if (now - stepRef.current.at > 560 / WALK_PHASES) {
          stepRef.current = { step: (stepRef.current.step + 1) % WALK_PHASES, at: now };
        }

        // The ground has a say (water and rock block, mud slows), and the world has an edge
        const map = useWorldStore.getState().currentMap;
        usePlayerStore.setState(state => {
          if (!state.player.currentSession) return state;
          const pos = state.player.currentSession.position;
          const next = map
            ? WorldGenerator.resolveMove(map, pos.x, pos.z, dx, dz)
            : { x: pos.x + dx, z: pos.z + dz };
          return {
            player: {
              ...state.player,
              currentSession: {
                ...state.player.currentSession,
                position: { x: next.x, y: 0, z: next.z }
              }
            }
          };
        });
      } else if (movingRef.current) {
        // Stopping returns to the standing frame, cleanly
        movingRef.current = false;
        stepRef.current = { step: 0, at: 0 };
      }

      // Wave 10C (D16): the towed cart follows at your heels — moved a few
      // times a second, never per frame, and across chunk lines for real
      {
        const towedId = usePlayerStore.getState().player.currentSession?.towingCartId;
        if (towedId && now - lastCartSync.current > 250) {
          const pos = usePlayerStore.getState().player.currentSession?.position;
          const map = useWorldStore.getState().currentMap;
          const towed = pos && map
            ? Object.values(map.chunks).flatMap(c => c.entities).find(e => e.id === towedId)
            : undefined;
          if (pos && towed) {
            const trail = { x: pos.x - 28, y: pos.z + 16 };
            if (Math.hypot(towed.position.x - trail.x, towed.position.y - trail.y) > 12) {
              useWorldStore.getState().moveEntity(towedId, trail.x, trail.y);
            }
            lastCartSync.current = now;
          } else if (pos && !towed) {
            // the cart is gone from the world (should not happen): drop the bar
            usePlayerStore.getState().releaseCart();
          }
        }
      }

      // B. Entity & Combat Logic
      const liveSession = usePlayerStore.getState().player.currentSession;
      const liveMap = useWorldStore.getState().currentMap;
      const playerPos = liveSession?.position;
      if (!playerPos || !liveMap) {
        requestRef.current = requestAnimationFrame(gameLoop);
        return;
      }

      // D67, D77: the gate runs on the world's clock, whoever is inside
      {
        const w = useWorldStore.getState();
        const gateCard = w.availableWorlds.find(c => c.id === w.activeWorldId);
        if (gateCard) {
          const moment = WorldClock.momentAt(gateCard, now);
          if (moment.phase !== 'UP') {
            endRun('GATE');
            return; // Stop the loop; component unmounts
          }
          // D71: what the sky is where you stand
          const sky = WorldClock.skyAt(gateCard, now, playerPos.x / (liveMap.width * SECTOR_PX));
          lightRef.current = sky.light;
          const left = moment.warning === 'NONE' ? '' : WorldClock.say(moment.msLeft);
          const shown = `${moment.warning}|${left}|${sky.state}`;
          if (shown !== gateShownRef.current) {
            if (moment.warning === 'CLOSING' && !gateShownRef.current.startsWith('CLOSING') && !gateShownRef.current.startsWith('FINAL')) {
              feed(`The gate closes in ${left}. Whoever stays is locked in.`, 'loss');
            }
            gateShownRef.current = shown;
            setGate({ warning: moment.warning, left, sky: sky.state });
          }
        }
      }

      // Chunks are built ahead of you, once per quadrant walked
      const walked = `${quadrantOf(playerPos.x)},${quadrantOf(playerPos.z)}`;
      if (walked !== loadedQuadrantRef.current) {
        loadedQuadrantRef.current = walked;
        useWorldStore.getState().loadAround(playerPos.x, playerPos.z, LOAD_RADIUS_PX);
      }

      // Simulate every chunk a projectile fired from here can reach
      const visibleChunks: Record<string, IChunk> = {};
      // N7: and every chunk a body that was hit stands in, wherever it has got to
      MobAI.simulatedKeys(liveMap, playerPos.x, playerPos.z).forEach(key => {
        if (liveMap.chunks[key]) visibleChunks[key] = liveMap.chunks[key];
      });

      let incomingDamage = 0;
      const landedStatuses: IStatusPlan[] = [];
      const isAlive = (p: any) => (now - p.startTime) < 2000;

      // Layer 3: a scroll, read. It casts through the same door, and asks nothing of the reserves.
      const scroll = usePlayerStore.getState().pendingCast;
      if (scroll) {
        usePlayerStore.setState({ pendingCast: null });
        const ability = ContentRegistry.ability(scroll);
        if (ability) {
          const facing = { right: 0, down: Math.PI / 2, left: Math.PI, up: -Math.PI / 2 }[facingRef.current];
          applyPlayerReceipt(EffectSystem.resolve(ability, { rank: ProgressionSystem.rankOf(usePlayerStore.getState().player) }, SessionJournal.rollKey('scroll', String(shotCountRef.current++))), now, { x: playerPos.x, z: playerPos.z }, facing);
          feed(`It reads itself aloud: ${ability.name}.`, 'signal');
        }
      }

      // Line 72: a held button fires at the weapon's own rate, whatever the weapon
      if ((firingRef.current.mouse || firingRef.current.key) && !useHands.getState().held && !atRest) fireRef.current(now);

      // Wave 2.2: REGROW SWEEP (every 2s) — depleted flora comes back
      if (now - lastRegrowSweep.current > 2000) {
        lastRegrowSweep.current = now;
        Object.values(liveMap.chunks).forEach(chunk => {
          chunk.entities.forEach(e => {
            if (e.regrowAt && e.regrowAt <= now && (e.usesRemaining ?? 0) <= 0) {
              const def = RESOURCE_DEFINITIONS[e.definitionId];
              useWorldStore.getState().updateEntity(e.id, { usesRemaining: def?.uses ?? 1, regrowAt: undefined });
              console.log(`[WORLD] ${def?.name || e.definitionId} regrew.`);
            }
          });
        });
      }

      // AI Tick — the map goes along so terrain can refuse an enemy's step
      const liveEquipment = usePlayerStore.getState().player.equipment;
      const liveAttributes = usePlayerStore.getState().player.attributes;
      const aiResult = MobAI.tick(visibleChunks, { x: playerPos.x, y: playerPos.z }, dt, liveMap, { noiseReduction: StatSystem.noiseReduction(liveEquipment, liveAttributes), light: lightRef.current });
      if (aiResult.spawnedPatterns.length > 0) {
        // MELEE strikes resolve instantly; ranged patterns become projectiles
        aiResult.spawnedPatterns.forEach(p => {
          if (p.type === 'MELEE' || p.type === 'AREA') {
            // A wind-up can be walked away from: what lands is measured when it lands
            const d = Math.hypot(p.origin.x - playerPos.x, p.origin.y - playerPos.z);
            if (d < (p.reachPx ?? 50)) {
              lastHurtByRef.current = p.shooterId ?? lastHurtByRef.current;
              incomingDamage += p.damage ?? 10; // Wave 4.3: definition damage
              if (p.status) landedStatuses.push(p.status);
            }
          }
        });
        const ranged = aiResult.spawnedPatterns.filter(p => p.type !== 'MELEE' && p.type !== 'AREA');
        if (ranged.length > 0) setEnemyPatterns(prev => [...prev.filter(isAlive), ...ranged]);
      }

      // Projectile positions are recomputed from time every frame, so a shot
      // that has landed must be remembered or it would land again next frame.
      spentShots.current.forEach((firedAt, id) => {
        if (now - firedAt > 2500) spentShots.current.delete(id);
      });

      const playerBullets: IProjectile[] = playerPatterns.filter(isAlive).flatMap(p =>
        ProjectileSystem.liveShots(p, id => `pl_${p.startTime}_${id}`, now, prevTick, spentShots.current));

      const enemyBullets: IProjectile[] = enemyPatterns.filter(isAlive).flatMap(p =>
        ProjectileSystem.liveShots(p, id => `e_${p.shooterId}_${p.startTime}_${id}`, now, prevTick, spentShots.current)
          .map(b => ({ ...b, color: '#ef4444' })));

      const survivingEnemyBullets = enemyBullets.filter(b => {
        if (ProjectileSystem.sweptDistance(b, playerPos.x, playerPos.z) < 15) {
          incomingDamage += b.damage ?? 8; // Wave 4.3: definition damage
          const firedBy = enemyPatterns.find(p => b.id.startsWith(`e_${p.shooterId}_${p.startTime}_`));
          if (firedBy) lastHurtByRef.current = firedBy.shooterId;
          if (firedBy?.status) landedStatuses.push(firedBy.status);
          spentShots.current.set(b.id, now);
          return false;
        }
        return true;
      });

      // Collision-check ALL visible chunks (AI only returns the modified ones)
      const combatResult = CombatSystem.tick(playerBullets, { ...visibleChunks, ...aiResult.updatedChunks }, playerPos, liveSession.health, activeSwings);
      const survivingIds = new Set(combatResult.survivingBullets.map(b => b.id));
      playerBullets.forEach(b => {
        if (!survivingIds.has(b.id)) spentShots.current.set(b.id, now);
      });

      // Process Events (Wave 8B effects; Wave 9.5 finally APPLIES the kill XP)
      combatResult.events.forEach(event => {
        if (event.type === 'ACTION_LOG' && event.actionContext) {
            processAction(event.actionContext);
        } else if ((event.type === 'HIT' || event.type === 'KILL') && event.position) {
          const def = event.definitionId ? MOB_DEFINITIONS[event.definitionId] : undefined;
          const size = (SIZE_ATOMS[def?.size || 'MEDIUM'] ?? 14) * ATOM_PX;
          effectsRef.current.push({
            kind: event.type === 'HIT' ? 'hit' : 'death',
            x: event.position.x, y: event.position.y, at: now, size
          });
          if (event.type === 'HIT' && event.entityId) MobAI.provoke(event.entityId); // what ignored you stops ignoring you
          if (event.type === 'KILL' && event.xpReward) {
            feed(`${event.displayName ?? 'Contact'} down. +${event.xpReward.amount} XP`, 'signal');
            // Line 80: defeating a thing teaches what it casts, at the next rest. Line 90: the Director hears.
            const innate = (def as { innate?: string[] } | undefined)?.innate ?? [];
            if (innate.length > 0) usePlayerStore.setState(s => ({ player: RestSystem.queueMet(s.player, innate) }));
            if (event.definitionId) useWorldStore.getState().reportToDirector('FELL', event.definitionId, event.entityId ? { id: event.entityId, rank: ProgressionSystem.rankOf(usePlayerStore.getState().player) } : undefined);
            if (event.entityId) useWorldStore.getState().reportFell(event.entityId, event.definitionId);
          }
        }
      });
      // Layer 3: what worn pieces fire. The trigger is a word from a pack, and it acts unstudied (D19).
      const fired = (trigger: string) => {
        const live = usePlayerStore.getState().player;
        for (const abilityId of EffectSystem.triggered(live.equipment as never, trigger)) {
          if ((triggerReadyRef.current[abilityId] ?? 0) > now) continue;
          const ability = ContentRegistry.ability(abilityId);
          if (!ability) continue;
          const receipt = EffectSystem.resolve(ability, { rank: ProgressionSystem.rankOf(live) }, SessionJournal.rollKey('trigger', String(shotCountRef.current++)));
          triggerReadyRef.current[abilityId] = now + receipt.cooldownMs;
          applyPlayerReceipt(receipt, now, { x: playerPos.x, z: playerPos.z }, 0);
        }
      };
      if (combatResult.events.some(e => e.type === 'HIT')) fired('on_hit');
      if (combatResult.events.some(e => e.type === 'KILL')) fired('on_defeat');
      const rewards = applyKillRewards(combatResult.events);
      if (rewards.levelUp) {
        feed(ProgressionSystem.levelUpLine(rewards.levelUp.to, rewards.levelUp.points), 'proof');
      }
      if (effectsRef.current.length > 0) {
        effectsRef.current = effectsRef.current.filter(f => now - f.at < DEATH_BURST_MS + 100);
      }

      // Persist mob movement/deaths back into the world
      const chunkUpdates = { ...aiResult.updatedChunks, ...combatResult.updatedChunks };
      if (Object.keys(chunkUpdates).length > 0) {
        useWorldStore.setState(state => state.currentMap
          ? { currentMap: { ...state.currentMap, chunks: { ...state.currentMap.chunks, ...chunkUpdates } } }
          : state);
      }

      // Loot: spawn new drops, then auto-pickup anything within reach
      let drops = lootDrops;
      if (combatResult.spawnedLoot.length > 0) {
          // D99: junk stays where it fell until someone wants it. Everything else the hands collect
          const collected = combatResult.spawnedLoot.map(l => {
            const { collect, leave } = LootTable.sortDrop(l.items);
            if (leave.length > 0) useWorldStore.getState().addEntity(LootTable.junkCache(leave, l.position, leave[0].id));
            return { id: crypto.randomUUID(), position: l.position, items: collect };
          }).filter(l => l.items.length > 0);
          drops = [...drops, ...collected];
      }
      if (drops.length > 0) {
        // Wave 3.2: pickup passes through the caps; what doesn't fit stays on
        // the ground (cooldown so it isn't retried every frame)
        const eligible = drops.filter((d: any) => !d.blockedUntil || d.blockedUntil <= now);
        const blocked = drops.filter((d: any) => d.blockedUntil && d.blockedUntil > now);
        const { pickedUp, remainingDrops } = CombatSystem.checkLootPickup(playerPos, eligible, StatSystem.pickupRadiusPx(liveEquipment));
        let finalDrops = [...blocked, ...remainingDrops];

        if (pickedUp.length > 0) {
          const { added, rejected } = usePlayerStore.getState().tryAddItems(pickedUp);
          if (added.length > 0) {
            feed(`Recovered ${added.length === 1 ? LoadoutSystem.shownName(added[0]) : `${added.length} items`}.`, 'proof');
            SessionJournal.record('LOOT', { itemIds: added.map((i: any) => i.id) });
          }
          if (rejected.length > 0) {
            feed(`The pack refuses ${rejected.length} item${rejected.length === 1 ? '' : 's'} — space or weight.`, 'loss');
            finalDrops = [...finalDrops, {
              id: crypto.randomUUID(),
              position: { x: playerPos.x, y: playerPos.z },
              items: rejected,
              blockedUntil: now + 4000
            }];
          }
        }
        if (pickedUp.length > 0 || drops !== lootDrops) setLootDrops(finalDrops);
      }

      // Apply damage to the agent (Wave 4.1: armor mitigates, and wears)
      const rawDamage = incomingDamage + combatResult.playerDamage;
      const armor = getEquipped('armor');
      // Layer 1: what is working on the body, what just landed, and any ward spending itself
      let effects = liveSession.activeEffects ?? [];
      const clock = StatusClock.tick(effects, now);
      effects = clock.statuses;
      landedStatuses.forEach(plan => { effects = StatusClock.add(effects, plan, now); });
      const hit = CombatMath.incoming(rawDamage, liveEquipment, SessionJournal.rollKey('hurt', String(hurtCountRef.current += rawDamage > 0 ? 1 : 0)), liveAttributes);
      const warded = StatusClock.absorb(effects, hit.damage + clock.damage);
      effects = warded.statuses;
      const totalDamage = warded.damage;
      if (effects !== liveSession.activeEffects && (effects.length > 0 || (liveSession.activeEffects?.length ?? 0) > 0)) {
        usePlayerStore.setState(state => state.player.currentSession
          ? { player: { ...state.player, currentSession: { ...state.player.currentSession, activeEffects: effects } } }
          : state);
      }
      if (totalDamage > 0) {
        if (armor) usePlayerStore.getState().wearEquipment('armor', 1);
        const newHealth = Math.max(0, liveSession.health - totalDamage);
        usePlayerStore.setState(state => state.player.currentSession
          ? { player: { ...state.player, currentSession: { ...state.player.currentSession, health: newHealth } } }
          : state);

        SessionJournal.record('DAMAGE', { amount: totalDamage, health: newHealth });
        if (atRest) {
          usePlayerStore.setState(state => ({ player: RestSystem.breakRest(state.player) }));
          feed('Something woke you. The rest did you no good.', 'loss');
        }
        fired('on_hurt');
        if (newHealth < liveSession.maxHealth * 0.25) fired('on_low_health');
        hurtAtRef.current = now; // the screen edge answers the blow

        // Wave 2.5: taking damage interrupts the extraction channel
        if (channelRef.current) {
          channelRef.current = null;
          setChanneling(false);
          feed('CHANNEL BROKEN. The exit does not argue with damage.', 'loss');
        }

        if (newHealth <= 0) {
          endRun('HURT');
          return; // Stop the loop; component unmounts
        }
      }

      // Wave 2.5: channel completion
      if (channelRef.current && now - channelRef.current >= channelMs()) {
        channelRef.current = null;
        setChanneling(false);
        completeExtraction();
        return; // Extraction unmounts the canvas
      }

      // The inspect card follows the cursor (line 29), re-tested a few times a second;
      // a card pinned by Q keeps tracking its target and clears when it is gone.
      if (now - lastInspectAt.current > 120 && !menuPosition) {
        lastInspectAt.current = now;
        // Line 72: what E would do from here, or that it would leave
        const pickNow = interactPickRef.current();
        const nextPrompt = channelRef.current ? null : pickNow ? promptFor(pickNow) : null;
        if (nextPrompt !== promptRef.current) {
          promptRef.current = nextPrompt;
          setPrompt(nextPrompt);
        }
        if (mouseRef.current) {
          const worldX = playerPos.x + (mouseRef.current.x - window.innerWidth / 2);
          const worldZ = playerPos.z + (mouseRef.current.y - window.innerHeight / 2);
          const { targets, near } = targetsNear(worldX, worldZ, 160);
          const hit = hitTest(targets, worldX, worldZ, inspectedIdRef.current);
          inspectById(hit, near);
        } else if (inspectedIdRef.current) {
          const { near } = targetsNear(playerPos.x, playerPos.z, 300);
          inspectById(near.some(n => n.id === inspectedIdRef.current) ? inspectedIdRef.current : null, near);
        }
      }

      const canvas = fieldRef.current;
      const ctx = canvas?.getContext('2d');
      if (canvas && ctx) {
        if (canvas.width !== window.innerWidth || canvas.height !== window.innerHeight) {
          canvas.width = window.innerWidth;
          canvas.height = window.innerHeight;
        }
        if (rendererRef.current?.seed !== liveMap.seed) {
          rendererRef.current = { seed: liveMap.seed, renderer: new FieldRenderer(liveMap, genreForWorld(liveMap.seed)) };
        }
        const me = usePlayerStore.getState().player;
        const held = activeWeapon().item;
        const worn = getEquipped('armor');
        const sceneChunks = WorldGenerator.chunkKeysInBox(playerPos.x, playerPos.z, Math.max(canvas.width, canvas.height) / 2 + 100)
          .map(key => liveMap.chunks[key]).filter(Boolean);
        // Each enemy in view carries its AI's facing and a two-frame step
        const mobPoses: Record<string, MobPose> = {};
        const mobFrame = reducedMotionRef.current ? 0 : Math.floor(now / 240) % 2;
        sceneChunks.forEach(chunk => chunk.entities.forEach(e => {
          if (e.type !== EntityType.MOB) return;
          const pose = MobAI.pose(e.id);
          if (pose) mobPoses[e.id] = { facing: pose.facing, frame: pose.moving ? mobFrame : 0 };
        }));
        const scene: FieldScene = {
          camera: { x: playerPos.x, z: playerPos.z },
          player: {
            uid: me.id, archetype: (me.archetype || 'OPERATOR') as Archetype, facing: facingRef.current,
            step: stepRef.current.step, moving: movingRef.current,
            weapon: held ? weaponClass(held.tags || []) : undefined,
            armor: worn ? armorClass(worn.tags || []) : undefined
          },
          chunks: sceneChunks,
          mobPoses,
          effects: effectsRef.current,
          hurtAt: hurtAtRef.current,
          now,
          reducedMotion: reducedMotionRef.current,
          darkness: 1 - lightRef.current,
          bullets: [
            ...combatResult.survivingBullets.map(b => ({ x: b.x, y: b.y, hostile: false })),
            ...survivingEnemyBullets.map(b => ({ x: b.x, y: b.y, hostile: true }))
          ],
          drops: drops.map((d: any) => d.position),
          swings: activeSwings.filter(s => now - s.startTime < 200).map(s => ({ x: s.origin.x, y: s.origin.y, angle: s.angle, range: s.range }))
        };
        rendererRef.current.renderer.draw(ctx, canvas.width, canvas.height, scene);
        rendererRef.current.renderer.prewarm(playerPos.x, playerPos.z, Math.max(canvas.width, canvas.height) / 2 + 320);
      }

      requestRef.current = requestAnimationFrame(gameLoop);
    };

    requestRef.current = requestAnimationFrame(gameLoop);
    return () => { if (requestRef.current) cancelAnimationFrame(requestRef.current); };
  }, [reconMode, currentMap, playerPatterns, enemyPatterns, activeSwings, lootDrops, completeExtraction, menuPosition, targetsNear, inspectById]);

  // 4. Interacting has its own input (line 72): one key, or a right-click on a thing
  const openMenu = (entity: IWorldEntity, options: any[], x: number, y: number) => {
    setInteractionOptions(options);
    setSelectedEntityId(entity.id);
    setMenuPosition({ x, y });
  };

  const handleActionSelect = (option: any) => {
    if (selectedEntityId) {
      performInteraction(option.id, selectedEntityId);
    }
    setMenuPosition(null);
  };

  const beginChannel = () => {
    channelRef.current = Date.now();
    setChanneling(true);
    feed('Channel opened. Five seconds. Don\'t get hit.', 'signal');
  };

  const entityScreen = (entity: IWorldEntity) => {
    const pos = usePlayerStore.getState().player.currentSession?.position;
    return {
      x: entity.position.x - (pos?.x ?? 0) + window.innerWidth / 2,
      y: entity.position.y - (pos?.z ?? 0) + window.innerHeight / 2
    };
  };

  // The nearest thing the key could act on; the beacon counts as a thing to act on.
  interactPickRef.current = () => {
    const st = usePlayerStore.getState();
    const pos = st.player.currentSession?.position;
    if (!pos) return null;
    const { near } = targetsNear(pos.x, pos.z, 100);
    const pick = pickInteract(st.player, near, pos);
    const map = useWorldStore.getState().currentMap;
    const exit = map ? WorldGenerator.nearestExit(map, pos.x, pos.z) : null;
    if (exit && exit.distance < BEACON_RANGE && (!pick || exit.distance / TILE_SIZE <= pick.dist)) return 'EXIT';
    return pick;
  };

  const explainNothing = (x: number, z: number) => {
    const st = usePlayerStore.getState();
    const { targets, near } = targetsNear(x, z, 100);
    const pos = st.player.currentSession?.position;
    const next = pos ? cycleTarget(targets, { x: pos.x, y: pos.z }, null, 80) : null;
    const entity = next ? near.find(n => n.id === next) : undefined;
    if (!entity || !pos) { feed('Nothing in reach to work.', 'plain'); return; }
    const dist = Math.hypot(entity.position.x - pos.x, entity.position.y - pos.z) / TILE_SIZE;
    const card = inspectEntity(entity, {
      player: st.player, dist,
      level: WebSystem.knowledgeReader(st.player),
      worldSeed: useWorldStore.getState().currentMap?.seed,
      webVersion: useWorldStore.getState().availableWorlds.find(w => w.id === useWorldStore.getState().activeWorldId)?.webVersion
    });
    // The refusal is explained, not swallowed (Wave 9.6): the card says why
    feed(card.needs[0] ? `${card.title}: ${card.needs[0]}` : `${card.title}: nothing to be done here.`, 'loss');
  };

  interactRef.current = () => {
    if (channelRef.current || usePlayerStore.getState().cartWindowId) return;
    const pos = usePlayerStore.getState().player.currentSession?.position;
    if (!pos) return;
    const pick = interactPickRef.current();
    if (pick === 'EXIT') { beginChannel(); return; }
    if (!pick) { explainNothing(pos.x, pos.z); return; }
    if (pick.primary) { performInteraction(pick.primary.id, pick.entity.id); return; }
    const at = entityScreen(pick.entity);
    openMenu(pick.entity, pick.options, at.x, at.y);
  };

  escapeRef.current = () => {
    if (channelRef.current) {
      channelRef.current = null;
      setChanneling(false);
      feed('Channel closed. The beacon can wait.', 'plain');
      return;
    }
    if (usePlayerStore.getState().cartWindowId) usePlayerStore.getState().closeCartWindow();
  };

  /** A right-click on a thing in reach asks it directly, study included. */
  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    if (e.target !== fieldRef.current) return;
    setMenuPosition(null);
    const st = usePlayerStore.getState();
    const pos = st.player.currentSession?.position;
    if (!pos) return;
    const clickX = pos.x + (e.clientX - window.innerWidth / 2);
    const clickZ = pos.z + (e.clientY - window.innerHeight / 2);
    const { targets, near } = targetsNear(clickX, clickZ, 60);
    const hit = hitTest(targets, clickX, clickZ);
    const entity = hit ? near.find(n => n.id === hit) : undefined;
    if (!entity || entity.type === EntityType.MOB) return;
    const dist = Math.hypot(entity.position.x - pos.x, entity.position.y - pos.z) / TILE_SIZE;
    const options = InteractionEngine.getAvailableInteractions(st.player, entity, dist);
    if (options.length > 0) openMenu(entity, options, e.clientX, e.clientY);
    else explainNothing(entity.position.x, entity.position.y);
  };

  // Firing: the button on the ground fires, held or tapped. It opens nothing.
  const handleFieldPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || e.target !== fieldRef.current) return;
    setMenuPosition(null);
    aimRef.current = { x: e.clientX, y: e.clientY };
    firingRef.current.mouse = true;
    fireRef.current(Date.now());
  };

  // Line 75: drawn a few times a second from what this session has seen, never with the frame
  const composeMinimap = () => {
    const map = useWorldStore.getState().currentMap;
    const pos = usePlayerStore.getState().player.currentSession?.position;
    if (!map || !pos) return null;
    const sight = StatSystem.sightPx(usePlayerStore.getState().player.equipment, usePlayerStore.getState().player.attributes);
    const halfW = Math.max(TILE_PX, window.innerWidth / 2 + sight), halfH = Math.max(TILE_PX, window.innerHeight / 2 + sight);
    const qMinX = quadrantOf(pos.x - halfW), qMaxX = quadrantOf(pos.x + halfW);
    const qMinY = quadrantOf(pos.z - halfH), qMaxY = quadrantOf(pos.z + halfH);
    for (let qy = qMinY; qy <= qMaxY; qy++) for (let qx = qMinX; qx <= qMaxX; qx++) seenRef.current.add(`${qx},${qy}`);

    // Only what is in sight right now is marked: the window is the sight.
    const things: { x: number; y: number; kind: 'HOSTILE' | 'THING' }[] = [];
    const worldId = useWorldStore.getState().activeWorldId;
    for (const key of WorldGenerator.chunkKeysInBox(pos.x, pos.z, Math.max(halfW, halfH))) {
      for (const e of map.chunks[key]?.entities ?? []) {
        if (Math.abs(e.position.x - pos.x) > halfW || Math.abs(e.position.y - pos.z) > halfH) continue;
        if (e.type === EntityType.EXTRACTION) continue;
        things.push({ x: e.position.x, y: e.position.y, kind: e.isHostile ? 'HOSTILE' : 'THING' });
        // D93: a leader in sight has been seen, and what it was doing is decided by what happens now
        if (Leaders.isLeader(e.id)) useWorldStore.getState().reportSeen([e.id]);
        // A chest in sight is known from now on, and how it looks is how it is remembered
        if (worldId && e.container && ChestSystem.isChest(e.id)) {
          const seen = usePlayerStore.getState().player;
          const marked = ChestSystem.mark(seen, worldId, e);
          if (marked !== seen) usePlayerStore.setState({ player: marked });
        }
      }
    }
    const exits: { x: number; y: number }[] = [];
    const sx = sectorOf(pos.x), sy = sectorOf(pos.z);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const key = `${sx + dx},${sy + dy}`;
      if (!map.sectors[key]) continue;
      let found = exitsRef.current.get(key);
      if (!found) {
        found = WorldGenerator.exitsInSector(map, sx + dx, sy + dy);
        exitsRef.current.set(key, found);
      }
      exits.push(...found);
    }
    const marks = worldId ? Object.values(usePlayerStore.getState().player.chestMarks?.[worldId] ?? {}) : [];
    return fieldMinimap({ map, center: { x: pos.x, z: pos.z }, seen: seenRef.current, things, exits, marks });
  };

  // 5. Render
  if (!currentMap) {
    return (
      <div className="ws-ui" style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ width: 360 }}><Busy label="RENDERING THE SURVEY" /></div>
      </div>
    );
  }

  // RECON MODE: satellite view for drop zone selection
  if (reconMode) {
    return <ReconView onDrop={handleConfirmDrop} />;
  }

  const playerPos = session.position;

  // Wave 2.5 + 9.6: distance AND direction to the nearest extraction beacon
  const exit = WorldGenerator.nearestExit(currentMap, playerPos.x, playerPos.z);
  const beaconDist = exit?.distance ?? Infinity;
  const nearBeacon = beaconDist < BEACON_RANGE;
  const exitAngle = exit ? Math.atan2(exit.y - playerPos.z, exit.x - playerPos.x) : 0;
  const exitOctant = exit ? OCTANTS[((Math.round(exitAngle / (Math.PI / 4)) % 8) + 8) % 8] : '';

  const rank = ProgressionSystem.rankOf(usePlayerStore.getState().player);
  const level = ProgressionSystem.levelOf(usePlayerStore.getState().player);
  const loadRatio = usePlayerStore.getState().maxWeight > 0
    ? usePlayerStore.getState().currentWeight / usePlayerStore.getState().maxWeight : 0;

  return (
    <div
      ref={canvasRef}
      className="full-size ws-ui"
      style={{ overflow: 'hidden', background: 'var(--ws-void-1)', position: 'relative', cursor: 'crosshair' }}
      onContextMenu={handleContextMenu}
      onPointerDown={handleFieldPointerDown}
      onMouseMove={e => {
        aimRef.current = { x: e.clientX, y: e.clientY };
        mouseRef.current = e.target === fieldRef.current ? { x: e.clientX, y: e.clientY } : null;
      }}
      onMouseLeave={() => { mouseRef.current = null; }}
    >
      {/* The whole field, drawn each frame by the game loop */}
      <canvas ref={fieldRef} style={{ position: 'absolute', top: 0, left: 0, imageRendering: 'pixelated' }} />

      {/* Extraction Control (Wave 2.5): the beacon is a place, not a button */}
      <div style={{ position: 'absolute', top: 16, right: 16, zIndex: 100, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }} onClick={e => e.stopPropagation()} onPointerDown={e => e.stopPropagation()}>
        <MinimapView compose={composeMinimap} label="Minimap of the ground you have seen" />
        {channeling ? (
          <Panel tone="signal" style={{ pointerEvents: 'auto' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span className="ws-signal">CHANNELING… HOLD POSITION</span>
              <Button tone="loss" onClick={() => { channelRef.current = null; setChanneling(false); }}><Kbd>ESC</Kbd> ABORT</Button>
            </div>
            <div className="ws-dim ws-small" style={{ marginTop: 4 }}>Damage breaks the channel. Five seconds of stillness buy the way home.</div>
          </Panel>
        ) : nearBeacon ? (
          <Button tone="proof" primary onClick={beginChannel}>
            <Kbd>E</Kbd> EXTRACT ({(StatSystem.channelMs(BASE_CHANNEL_MS, usePlayerStore.getState().player.attributes) / 1000).toFixed(1)}s)
          </Button>
        ) : (
          <Chip title="Distance and heading to the nearest exit beacon">
            {beaconDist === Infinity ? 'BEACON: NONE RECORDED' : (
              <>
                <span
                  aria-hidden
                  style={{ display: 'inline-block', transform: `rotate(${Math.round((exitAngle * 180) / Math.PI) + 90}deg)`, color: 'var(--ws-signal-3)' }}
                >
                  ▲
                </span>
                BEACON {Math.round(beaconDist / TILE_PX)}m {exitOctant}
              </>
            )}
          </Chip>
        )}
      </div>

      {/* D77: the gate closing is said by shape and position: a dashed band at the top,
          and in its last moments a dashed frame around the whole field */}
      {gate.warning !== 'NONE' && (
        <div
          role="alert"
          style={{
            position: 'absolute', top: 16, left: '50%', transform: 'translateX(-50%)', zIndex: 110, pointerEvents: 'none',
            padding: '6px 16px', textAlign: 'center', background: 'var(--ws-void-0)',
            border: `${gate.warning === 'FINAL' ? 4 : 2}px dashed var(--ws-text-bright)`
          }}
        >
          <div className="ws-bright" style={{ letterSpacing: '0.2em', fontWeight: 700 }}>THE GATE IS CLOSING — {gate.left}</div>
          <div className="ws-small">Reach a beacon. Whoever stays is locked in.</div>
        </div>
      )}
      {gate.warning === 'FINAL' && (
        <div aria-hidden style={{ position: 'absolute', inset: 6, zIndex: 105, pointerEvents: 'none', border: '6px dashed var(--ws-text-bright)' }} />
      )}

      {/* Vitals HUD (Wave 9.2: bars, rank and load — the exposure is the point) */}
      <div style={{ position: 'absolute', top: 16, left: 16, zIndex: 100, width: 240, pointerEvents: 'none', display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <Chip tone="signal">ACTIVE AGENT</Chip>
          <Chip title={`Rank ${rank}, from the guild`}><RankMark rank={rank} scale={2} />{rank}</Chip>
          <Chip title="Level, from experience. It begins again at each rank, and what you built stays.">LV {level}{(player.attributePoints ?? 0) > 0 ? ` · ${player.attributePoints} TO SPEND` : ''}{CircleSystem.free(player) > 0 ? ` · ${CircleSystem.free(player)} TO FILL` : ''}</Chip>
          <Chip title="The sky where you stand. In the dark, things notice you from further away.">{gate.sky}</Chip>
          <span style={{ pointerEvents: 'auto' }} onPointerDown={e => e.stopPropagation()}>
            <Button tone="quiet" style={{ padding: '1px 6px', whiteSpace: 'nowrap' }} onClick={e => { (e.currentTarget as HTMLButtonElement).blur(); useSheet.getState().toggle(); }}><Kbd>TAB</Kbd> SHEET</Button>
          </span>
        </div>
        <Bar label="VITALS" value={session.health} max={session.maxHealth} tone={session.health / session.maxHealth > 0.3 ? 'signal' : 'loss'} />
        <Bar label="ENERGY" value={session.energy} max={StatSystem.maxEnergyOf(player)} tone="proof" text={`${Math.floor(session.energy)}`} />
        <Bar label="LOAD" value={Math.round(loadRatio * 100)} max={100} tone={loadRatio > 0.8 ? 'loss' : 'signal'} text={loadRatio > 0.8 ? 'SLOWED' : `${Math.round(loadRatio * 100)}%`} />
        <BodyClocks />
        {session.towingCartId && (
          <Chip tone="proof" title="The tow bar is in your hand; your pace pays for the load">TOWING</Chip>
        )}
      </div>

      {/* The hotbar (line 75): hands, tools, the belt. What E would do sits just above it. */}
      <div style={{ position: 'absolute', bottom: 12, left: '50%', transform: 'translateX(-50%)', zIndex: 120, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, pointerEvents: 'none', maxWidth: '46vw' }}>
        {prompt && <Chip tone="signal"><Kbd>E</Kbd> {prompt}</Chip>}
        <Hotbar />
      </div>

      {/* The key help stands apart from the data (U21) */}
      <KeyHelp />

      {/* The one inspect card (line 29): hover, or Q to cycle */}
      {inspected && !menuPosition && (
        <PlacedCard
          anchor={{ left: inspected.x - 14, top: inspected.y - 14, width: 28, height: 28 }}
          layoutKey={`${inspected.id}:${inspected.card.rows.length}:${inspected.card.needs.length}`}
        >
          <CardView card={inspected.card} />
        </PlacedCard>
      )}

      {/* Interaction Menu — words, not icons (Wave 9.7) */}
      {menuPosition && (
        <div
          onClick={e => e.stopPropagation()}
          onPointerDown={e => e.stopPropagation()}
          onKeyDown={e => {
            // Up and down walk the answers; Enter is the control's own
            if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
            e.preventDefault();
            e.stopPropagation();
            const list = [...e.currentTarget.querySelectorAll('button')] as HTMLButtonElement[];
            const at = list.indexOf(document.activeElement as HTMLButtonElement);
            list[(at + (e.key === 'ArrowDown' ? 1 : list.length - 1)) % list.length]?.focus();
          }}
          style={{ position: 'absolute', left: Math.min(menuPosition.x, window.innerWidth - 340), top: Math.min(menuPosition.y, window.innerHeight - 220), zIndex: 200 }}
        >
          <Panel style={{ pointerEvents: 'auto' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {interactionOptions.map((opt, i) => (
                <Button
                  key={opt.id}
                  autoFocus={i === 0}
                  tone="signal"
                  onClick={(e) => { e.stopPropagation(); handleActionSelect(opt); }}
                >
                  {opt.label} · {opt.energyCost > 0 ? `${opt.energyCost} energy` : 'free'}{opt.timeCostSeconds ? ` · ${opt.timeCostSeconds}s` : ''}
                </Button>
              ))}
            </div>
          </Panel>
        </div>
      )}

      <CartWindow />
      <RankMomentView />
    </div>
  );
};
