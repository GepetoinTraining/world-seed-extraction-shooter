/**
 * Hub Store - Manages persistent hub state
 * REFACTORED: Removes mock data, loads from Vector/DB State
 */

import { create } from 'zustand';
import { IItem, UniversalRank } from '../../../types';
import { ItemFactory } from '../item/ItemFactory';
import { VectorStore, VectorNamespace } from '../data/VectorStore';
import { HubGenerator } from './HubGenerator';
import { Rng } from '../../logic/rng/DeterministicRNG';
import { usePlayerStore } from '../player/store';
import { Ledger } from '../../logic/ledger/Ledger';
import { Treasury } from '../../logic/economy/Treasury';
import { RECIPE_DEFINITIONS, CRAFTED_DEFINITIONS, STRUCTURE_COSTS, PLAYER_SHOP_TAX } from '../economy/data/recipeDefinitions';
import { TransformationEngine } from '../economy/TransformationEngine';
import { PlayerPersistence } from '../../logic/persistence/PlayerPersistence';

export const HUB_ENDOWMENT_GOLD = 100_000;

// =============================================================================
// TYPES
// =============================================================================

export interface IPlayerLot {
  id: string;
  lotIndex: number;
  ownerId: string | null;
  ownerName: string | null;
  purchaseDate: number | null;
  structureType: 'EMPTY' | 'VENDOR' | 'WORKSHOP' | 'HOUSE';
  inventory: IItem[];
  price: number;
  // Wave 5.3: a VENDOR lot's storefront
  shopListings?: { item: IItem; price: number }[];
  // Wave 5.4: upkeep is charged per world-day; unpaid lots revert to market
  upkeepPaidThroughDay?: number;
  // Sale money held on the lot until its owner collects it
  proceeds?: number;
}

// Wave 5.2: a queued transformation. Accumulate/resolve — the job is just
// timestamps; outputs mint when someone looks (resolveCrafts).
export interface ICraftJob {
  id: string;
  lotId: string;
  recipeId: string;
  ownerCertUid: string;
  queuedAt: number;
  finishesAt: number;
  collected: boolean;
}

/** Logical world-day (observed time, never stored clocks). */
export const worldDay = () => Math.floor(Date.now() / 86_400_000);

export interface IShopListing {
  id: string;
  item: IItem;
  price: number;
  vendorId: string;
  stock: number;
}

export interface IAuctionListing {
  id: string;
  item: IItem;
  sellerId: string;
  sellerName: string;
  startPrice: number;
  currentBid: number;
  currentBidderId: string | null;
  endTime: number;
  buyoutPrice?: number;
}

// =============================================================================
// STORE
// =============================================================================

interface HubState {
  activeHubId: string | null;
  lots: IPlayerLot[];
  craftingJobs: ICraftJob[];
  weaponShop: IShopListing[];
  armorShop: IShopListing[];
  consumableShop: IShopListing[];
  auctionListings: IAuctionListing[];
  isLoading: boolean;

  // Actions
  loadHub: (hubWorldUid: string) => Promise<void>;
  saveHubState: () => Promise<void>;

  purchaseLot: (lotId: string, playerId: string, playerName: string) => Promise<boolean>;
  setLotStructure: (lotId: string, structureType: IPlayerLot['structureType']) => Promise<void>;
  purchaseFromShop: (listingId: string, shop: 'weapon' | 'armor' | 'consumable') => IItem | null;

  // Wave 5: society
  buyLot: (lotId: string) => Promise<boolean>;
  buildStructure: (lotId: string, type: 'HOUSE' | 'WORKSHOP' | 'VENDOR') => Promise<boolean>;
  queueCraft: (lotId: string, recipeId: string) => Promise<boolean>;
  resolveCrafts: () => Promise<number>;
  sellToVendor: (itemId: string) => Promise<number | null>;
  listItemForSale: (lotId: string, itemId: string, price: number) => Promise<boolean>;
  buyFromLot: (lotId: string, itemId: string) => Promise<boolean>;
  collectProceeds: (lotId: string) => Promise<number>;
  resolveUpkeep: (simDay?: number) => Promise<void>;

  // Admin / Generator
  generateDailyStock: () => void;
}

export const useHubStore = create<HubState>((set, get) => ({
  activeHubId: null,
  lots: [],
  craftingJobs: [],
  weaponShop: [],
  armorShop: [],
  consumableShop: [],
  auctionListings: [],
  isLoading: false,
  
  loadHub: async (hubWorldUid: string) => {
    set({ isLoading: true, activeHubId: hubWorldUid });

    try {
      // 1. Try to fetch existing Hub State from DB
      const hubStateDoc = await VectorStore.get<{ lots: IPlayerLot[]; craftingJobs?: ICraftJob[] }>(
        VectorNamespace.TERRITORIES,
        `hub_state_${hubWorldUid}`
      );

      if (hubStateDoc) {
        // LOAD EXISTING
        console.log('[HUB] State loaded from persistence.');
        set({ lots: hubStateDoc.data.lots, craftingJobs: hubStateDoc.data.craftingJobs || [] });
      } else {
        // GENERATE FRESH (First time this Hub is visited)
        console.log('[HUB] No state found. Generating fresh layout...');
        
        // Use the HubGenerator to find lot positions
        const layout = HubGenerator.generate();
        const lotPOIs = layout.zones.flatMap(z => z.pois).filter(p => p.type === 'PLAYER_LOT');
        
        const freshLots: IPlayerLot[] = lotPOIs.map((poi, idx) => ({
          id: poi.id,
          lotIndex: idx,
          ownerId: null,
          ownerName: null,
          purchaseDate: null,
          structureType: 'EMPTY',
          inventory: [],
          price: 5000 // Base price from POI metadata
        }));

        set({ lots: freshLots });
        // Save immediately
        await get().saveHubState();
      }

      // 2. Generate/Load Shop Stock (Simulated Daily Refresh)
      // In a real app, this would be server-side. Here we simulate it.
      get().generateDailyStock();

      await Treasury.endow(hubWorldUid, HUB_ENDOWMENT_GOLD);

      // 3. Wave 5: resolve what time finished while nobody watched
      await get().resolveCrafts();
      await get().resolveUpkeep();

    } catch (e) {
      console.error('[HUB] Failed to load hub:', e);
    } finally {
      set({ isLoading: false });
    }
  },

  saveHubState: async () => {
    const { activeHubId, lots, craftingJobs } = get();
    if (!activeHubId) return;

    // Hub changes usually move gold or items, so the bank is saved with them
    void PlayerPersistence.flush('hub');

    await VectorStore.put({
      id: `hub_state_${activeHubId}`,
      namespace: VectorNamespace.TERRITORIES,
      data: { lots, craftingJobs },
      metadata: {
        createdAt: Date.now(),
        updatedAt: Date.now(),
        ownerCertUid: 'SYSTEM',
        version: 1
      }
    });
  },
  
  purchaseLot: async (lotId, playerId, playerName) => {
    const { lots, saveHubState } = get();
    const lot = lots.find(l => l.id === lotId);
    
    if (!lot || lot.ownerId) return false;
    
    const updatedLots = lots.map(l => 
      l.id === lotId 
        ? { 
            ...l, 
            ownerId: playerId, 
            ownerName: playerName, 
            purchaseDate: Date.now(),
            upkeepPaidThroughDay: worldDay()
          }
        : l
    );
    
    set({ lots: updatedLots });
    await saveHubState(); // Persist changes
    return true;
  },

  setLotStructure: async (lotId, structureType) => {
    const { lots, saveHubState } = get();
    const updatedLots = lots.map(l =>
      l.id === lotId ? { ...l, structureType } : l
    );
    set({ lots: updatedLots });
    await saveHubState();
  },

  // ==========================================================================
  // WAVE 5: SOCIETY
  // ==========================================================================

  /** Buy an unowned lot with gold. The price goes to the hub treasury. */
  buyLot: async (lotId) => {
    const { lots, activeHubId } = get();
    const lot = lots.find(l => l.id === lotId);
    const p = usePlayerStore.getState().player;
    if (!lot || lot.ownerId || !activeHubId) return false;
    if (p.bank.gold < lot.price) {
      console.log(`[LOT] Cannot afford lot ${lot.lotIndex} (${lot.price}G).`);
      return false;
    }

    usePlayerStore.setState(s => ({ player: { ...s.player, bank: { ...s.player.bank, gold: s.player.bank.gold - lot.price } } }));
    await Treasury.credit(activeHubId, lot.price);
    await Ledger.append('GOLD_DELTA', { reason: 'LOT_PURCHASE', lotId, amount: -lot.price, treasuryId: activeHubId, treasuryDelta: lot.price });

    const ok = await get().purchaseLot(lotId, p.id, p.username);
    if (ok) console.log(`[LOT] Lot ${lot.lotIndex} purchased for ${lot.price}G.`);
    return ok;
  },

  /** Raise a structure on a lot you own. Cost goes to the treasury. */
  buildStructure: async (lotId, type) => {
    const { lots, activeHubId, saveHubState } = get();
    const lot = lots.find(l => l.id === lotId);
    const p = usePlayerStore.getState().player;
    if (!lot || !activeHubId) return false;
    if (lot.ownerId !== p.id) {
      console.log('[BUILD] You do not own this lot.');
      return false;
    }
    const cost = STRUCTURE_COSTS[type].build;
    if (p.bank.gold < cost) {
      console.log(`[BUILD] ${type} costs ${cost}G; you have ${p.bank.gold}G.`);
      return false;
    }

    usePlayerStore.setState(s => ({ player: { ...s.player, bank: { ...s.player.bank, gold: s.player.bank.gold - cost } } }));
    await Treasury.credit(activeHubId, cost);
    await Ledger.append('GOLD_DELTA', { reason: 'BUILD', lotId, structure: type, amount: -cost, treasuryId: activeHubId, treasuryDelta: cost });

    set({ lots: get().lots.map(l => l.id === lotId ? { ...l, structureType: type, upkeepPaidThroughDay: worldDay() } : l) });
    await saveHubState();
    console.log(`[BUILD] ${type} raised on lot ${lot.lotIndex} for ${cost}G.`);
    return true;
  },

  /** Queue a transformation at a WORKSHOP you own. Inputs leave the stash now. */
  queueCraft: async (lotId, recipeId) => {
    const { lots, saveHubState } = get();
    const lot = lots.find(l => l.id === lotId);
    const recipe = RECIPE_DEFINITIONS[recipeId];
    const p = usePlayerStore.getState().player;
    if (!lot || !recipe) return false;
    if (lot.ownerId !== p.id || lot.structureType !== recipe.requiredFacility) {
      console.log(`[CRAFT] ${recipe.name} needs your own ${recipe.requiredFacility}.`);
      return false;
    }

    // Inputs come from the main stash
    const stash = p.bank.stashTabs[0]?.items || [];
    if (!TransformationEngine.canProcess({ } as any, recipe, stash)) {
      console.log(`[CRAFT] Missing inputs for ${recipe.name}.`);
      return false;
    }
    const jobId = `job_${Date.now().toString(36)}_${lot.lotIndex}`;
    const { consumedIds } = TransformationEngine.processCycle(recipe, stash, Rng.fromKey(`${jobId}:consume`));

    usePlayerStore.setState(s => ({
      player: { ...s.player, bank: { ...s.player.bank, stashTabs: s.player.bank.stashTabs.map((tab, idx) =>
        idx === 0 ? { ...tab, items: tab.items.filter(i => !consumedIds.includes(i.id)) } : tab
      ) } }
    }));

    const job: ICraftJob = {
      id: jobId,
      lotId,
      recipeId,
      ownerCertUid: p.id,
      queuedAt: Date.now(),
      finishesAt: Date.now() + recipe.laborTimeSeconds * 1000,
      collected: false
    };
    set({ craftingJobs: [...get().craftingJobs, job] });
    await Ledger.append('CRAFT', { kind: 'QUEUED', jobId, recipeId, lotId, consumedIds });
    await saveHubState();
    console.log(`[CRAFT] ${recipe.name} queued (${recipe.laborTimeSeconds}s).`);
    return true;
  },

  /** Collect every finished job: outputs mint from the job's key into the stash. */
  resolveCrafts: async () => {
    const now = Date.now();
    const { craftingJobs, saveHubState } = get();
    const due = craftingJobs.filter(j => !j.collected && j.finishesAt <= now);
    if (due.length === 0) return 0;

    let minted = 0;
    for (const job of due) {
      const recipe = RECIPE_DEFINITIONS[job.recipeId];
      if (!recipe) continue;
      const outputs: IItem[] = [];
      recipe.outputs.forEach((out, oi) => {
        const def = CRAFTED_DEFINITIONS[out.itemId];
        if (!def) return;
        const rng = Rng.fromKey(`${job.id}:out:${oi}`);
        if (rng.next() <= out.probability) {
          for (let q = 0; q < out.quantity; q++) outputs.push(ItemFactory.createResourceItem(def, rng));
        }
      });
      usePlayerStore.setState(s => ({
        player: { ...s.player, bank: { ...s.player.bank, stashTabs: s.player.bank.stashTabs.map((tab, idx) =>
          idx === 0 ? { ...tab, items: [...tab.items, ...outputs] } : tab
        ) } }
      }));
      minted += outputs.length;
      await Ledger.append('CRAFT', { kind: 'COLLECTED', jobId: job.id, outputIds: outputs.map(o => o.id) });
      // Wave 6.2: crafted goods carry their maker's signature from birth
      const { Provenance } = await import('../../logic/sovereignty/Provenance');
      await Provenance.recordMany(outputs, 'MINT', { origin: 'CRAFT', jobId: job.id, recipeId: job.recipeId, lotId: job.lotId });
      console.log(`[CRAFT] Collected ${outputs.length}x from ${recipe.name}.`);
    }

    set({ craftingJobs: get().craftingJobs.map(j => due.some(d => d.id === j.id) ? { ...j, collected: true } : j) });
    await saveHubState();
    return minted;
  },

  /**
   * Sell a stash item to the system vendor at 60% of its value. The gold comes
   * from the hub treasury, so a hub with no funds cannot buy.
   */
  sellToVendor: async (itemId) => {
    const { activeHubId } = get();
    const p = usePlayerStore.getState().player;
    if (!activeHubId) return null;
    const item = (p.bank.stashTabs[0]?.items || []).find(i => i.id === itemId);
    if (!item) return null;

    const offer = Math.max(1, Math.floor((item.value || 1) * 0.6));
    const treasuryGold = await Treasury.balance(activeHubId);
    if (treasuryGold < offer) {
      console.log(`[VENDOR] The hub treasury cannot cover ${offer}G. Nothing moves.`);
      return null;
    }

    usePlayerStore.setState(s => ({
      player: { ...s.player, bank: {
        ...s.player.bank,
        gold: s.player.bank.gold + offer,
        stashTabs: s.player.bank.stashTabs.map((tab, idx) =>
          idx === 0 ? { ...tab, items: tab.items.filter(i => i.id !== itemId) } : tab
        )
      } }
    }));
    await Treasury.credit(activeHubId, -offer);
    await Ledger.append('GOLD_DELTA', { reason: 'VENDOR_BUYBACK', itemId, defId: item.universalDefinitionId, amount: offer, treasuryId: activeHubId, treasuryDelta: -offer });
    void PlayerPersistence.flush('vendor');
    console.log(`[VENDOR] Sold ${item.name} for ${offer}G (treasury-funded).`);
    return offer;
  },

  /** Put a stash item on your VENDOR lot's shelf. */
  listItemForSale: async (lotId, itemId, price) => {
    const { lots, saveHubState } = get();
    const lot = lots.find(l => l.id === lotId);
    const p = usePlayerStore.getState().player;
    if (!lot || lot.ownerId !== p.id || lot.structureType !== 'VENDOR') {
      console.log('[SHOP] You need your own VENDOR lot to sell.');
      return false;
    }
    const item = (p.bank.stashTabs[0]?.items || []).find(i => i.id === itemId);
    if (!item || price <= 0) return false;

    usePlayerStore.setState(s => ({
      player: { ...s.player, bank: { ...s.player.bank, stashTabs: s.player.bank.stashTabs.map((tab, idx) =>
        idx === 0 ? { ...tab, items: tab.items.filter(i => i.id !== itemId) } : tab
      ) } }
    }));
    set({ lots: get().lots.map(l => l.id === lotId
      ? { ...l, shopListings: [...(l.shopListings || []), { item, price }] }
      : l) });
    await Ledger.append('TRADE', { kind: 'LISTED', lotId, itemId, price, playerDelta: 0, treasuryDelta: 0 });
    await saveHubState();
    console.log(`[SHOP] Listed ${item.name} for ${price}G.`);
    return true;
  },

  /** Buy from a player's VENDOR lot. Seller gets price minus the hub's cut. */
  buyFromLot: async (lotId, itemId) => {
    const { lots, activeHubId, saveHubState } = get();
    const lot = lots.find(l => l.id === lotId);
    const listing = lot?.shopListings?.find(li => li.item.id === itemId);
    const p = usePlayerStore.getState().player;
    if (!lot || !listing || !activeHubId) return false;
    if (p.bank.gold < listing.price) {
      console.log('[SHOP] Cannot afford that.');
      return false;
    }

    const fee = Math.max(1, Math.round(listing.price * PLAYER_SHOP_TAX));
    const net = listing.price - fee;
    const buyerIsOwner = lot.ownerId === p.id;
    // Local identity's total delta: buyer pays price; the owner (possibly the
    // same identity) receives the net. Either way the hub keeps its fee.
    const playerDelta = -listing.price + (buyerIsOwner ? net : 0);

    usePlayerStore.setState(s => ({
      player: { ...s.player, bank: {
        ...s.player.bank,
        gold: s.player.bank.gold + playerDelta,
        stashTabs: s.player.bank.stashTabs.map((tab, idx) =>
          idx === 0 ? { ...tab, items: [...tab.items, listing.item] } : tab
        )
      } }
    }));
    await Treasury.credit(activeHubId, fee);
    await Ledger.append('TRADE', { kind: 'SHOP_SALE', lotId, itemId, price: listing.price, fee, playerDelta, treasuryDelta: fee });
    // Wave 6.2: ownership change goes on the item's record
    const { Provenance } = await import('../../logic/sovereignty/Provenance');
    await Provenance.record(listing.item, 'TRANSFER', { via: 'PLAYER_SHOP', lotId, price: listing.price, fee });

    set({ lots: get().lots.map(l => l.id === lotId
      ? {
          ...l,
          shopListings: (l.shopListings || []).filter(li => li.item.id !== itemId),
          proceeds: (l.proceeds || 0) + (buyerIsOwner ? 0 : net)
        }
      : l) });
    await saveHubState();
    console.log(`[SHOP] Bought ${listing.item.name} for ${listing.price}G (hub kept ${fee}G).`);
    return true;
  },

  /** Move a lot's held sale money to its owner's bank. */
  collectProceeds: async (lotId) => {
    const { lots, saveHubState } = get();
    const lot = lots.find(l => l.id === lotId);
    const p = usePlayerStore.getState().player;
    const amount = lot?.proceeds || 0;
    if (!lot || lot.ownerId !== p.id || amount <= 0) return 0;

    set({ lots: get().lots.map(l => l.id === lotId ? { ...l, proceeds: 0 } : l) });
    usePlayerStore.setState(s => ({ player: { ...s.player, bank: { ...s.player.bank, gold: s.player.bank.gold + amount } } }));
    await Ledger.append('GOLD_DELTA', { reason: 'SHOP_PROCEEDS', lotId, amount });
    await saveHubState();
    return amount;
  },

  /** Charge upkeep per world-day on owned lots; unpaid lots revert to market. */
  resolveUpkeep: async (simDay) => {
    const day = simDay ?? worldDay();
    const { lots, activeHubId, saveHubState } = get();
    const p = usePlayerStore.getState().player;
    if (!activeHubId) return;
    let changed = false;

    for (const lot of lots) {
      if (!lot.ownerId) continue;
      const paidThrough = lot.upkeepPaidThroughDay ?? day;
      const owed = day - paidThrough;
      if (owed <= 0) continue;
      if (lot.ownerId === p.id) await get().collectProceeds(lot.id);
      changed = true;

      const rate = lot.structureType === 'EMPTY' ? 5 : STRUCTURE_COSTS[lot.structureType].upkeepPerDay;
      const cost = rate * owed;
      const isLocal = lot.ownerId === p.id;
      const canPay = isLocal && usePlayerStore.getState().player.bank.gold >= cost;

      if (canPay) {
        usePlayerStore.setState(s => ({ player: { ...s.player, bank: { ...s.player.bank, gold: s.player.bank.gold - cost } } }));
        await Treasury.credit(activeHubId, cost);
        await Ledger.append('UPKEEP', { lotId: lot.id, days: owed, amount: cost, treasuryId: activeHubId });
        set({ lots: get().lots.map(l => l.id === lot.id ? { ...l, upkeepPaidThroughDay: day } : l) });
        console.log(`[UPKEEP] Lot ${lot.lotIndex}: paid ${cost}G for ${owed} day(s).`);
      } else {
        // Reverted: listings and lot inventory return to the (local) owner
        if (isLocal) {
          const refund = [...(lot.shopListings || []).map(li => li.item), ...lot.inventory];
          if (refund.length > 0) {
            usePlayerStore.setState(s => ({
              player: { ...s.player, bank: { ...s.player.bank, stashTabs: s.player.bank.stashTabs.map((tab, idx) =>
                idx === 0 ? { ...tab, items: [...tab.items, ...refund] } : tab
              ) } }
            }));
          }
        }
        await Ledger.append('TRADE', { kind: 'LOT_REVERTED', lotId: lot.id, daysUnpaid: owed, playerDelta: 0, treasuryDelta: 0 });
        set({ lots: get().lots.map(l => l.id === lot.id
          ? { ...l, ownerId: null, ownerName: null, purchaseDate: null, structureType: 'EMPTY', shopListings: [], inventory: [], upkeepPaidThroughDay: undefined }
          : l) });
        console.warn(`[UPKEEP] Lot ${lot.lotIndex} REVERTED to market (${owed} day(s) unpaid).`);
      }
    }
    if (changed) await saveHubState();
  },


  generateDailyStock: () => {
    // Procedural Shop Generation — keyed by hub + UTC day, so stock is the
    // same for every client of this hub today, and rolls over at midnight.
    const hubId = get().activeHubId || 'hub_unknown';
    const dayIndex = Math.floor(Date.now() / 86_400_000);

    const generateStock = (rank: UniversalRank, count: number, type: 'weapon' | 'armor' | 'tool') => {
      return Array.from({ length: count }, (_, i) => {
        const rng = Rng.fromKey(`${hubId}:shop:${dayIndex}:${type}:${rank}:${i}`);
        // The first two tool slots are always the two harvesting tools
        const toolBase = type === 'tool' ? ['tool_axe_field_t1', 'tool_pick_rusty_t1'][i] : undefined;
        const item = ItemFactory.createItem(rank, true, rng, type, toolBase);
        return {
          id: `listing_${type}_${rank}_${i}`,
          item,
          price: item.value * 1.5, // 50% Markup
          vendorId: 'vendor_sys',
          stock: rng.int(1, 6)
        };
      });
    };

    set({
      weaponShop: [
        ...generateStock(UniversalRank.F, 5, 'weapon'),
        ...generateStock(UniversalRank.E, 2, 'weapon'),
        // Field tools ride in the weapon shop until lots get their own vendors (Wave 5)
        ...generateStock(UniversalRank.F, 3, 'tool')
      ],
      armorShop: [
        ...generateStock(UniversalRank.F, 5, 'armor'),
        ...generateStock(UniversalRank.E, 2, 'armor')
      ]
    });
  },

  purchaseFromShop: (listingId, shop) => {
    const state = get();
    const shopKey = `${shop}Shop` as 'weaponShop' | 'armorShop' | 'consumableShop';
    const listings = state[shopKey];

    const listing = listings.find(l => l.id === listingId);
    if (!listing || listing.stock <= 0) return null;

    // Wave 2 (Wave 5 plumbing, early): gold actually moves, item actually lands
    const playerStore = usePlayerStore.getState();
    const price = Math.ceil(listing.price);
    if (playerStore.player.bank.gold < price) return null;

    const purchasedItem = { ...listing.item, id: crypto.randomUUID() };

    usePlayerStore.setState(s => ({
      player: {
        ...s.player,
        bank: {
          ...s.player.bank,
          gold: s.player.bank.gold - price,
          stashTabs: s.player.bank.stashTabs.map((tab, idx) =>
            idx === 0 ? { ...tab, items: [...tab.items, purchasedItem] } : tab
          )
        }
      }
    }));
    // Wave 5.1: conservation — the system vendor's take belongs to the hub
    const hubId = get().activeHubId || 'hub_unknown';
    void Treasury.credit(hubId, price);
    void PlayerPersistence.flush('shop');
    void Ledger.append('GOLD_DELTA', { reason: 'SHOP_PURCHASE', itemId: purchasedItem.id, defId: purchasedItem.universalDefinitionId, amount: -price, treasuryId: hubId, treasuryDelta: price });

    const updatedListings = listings.map(l =>
      l.id === listingId ? { ...l, stock: l.stock - 1 } : l
    );

    set({ [shopKey]: updatedListings });
    return purchasedItem;
  }
}));