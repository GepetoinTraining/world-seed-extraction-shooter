/**
 * INSURANCE IS AN ITEM (Wave 10E.5 — D21, decided by Pedro)
 *
 * Protection from loss is never a rule — it is a MAGIC ITEM. Usage-limited
 * charms, and scrolls that hold for a time (the scribe's table's paper-and-ink
 * hook, D14), each naming HOW MANY slots it protects and whether they are
 * chosen or random. A death keeps exactly what the magic named; everything
 * else stays behind as ever. The slot-protection contract and the KEPT BY
 * MAGIC receipt landed in 10C; this file mints the items that use them.
 */

import { EquipSlotId, IItem, ItemType, Rarity, SlotType, UniversalRank } from '../../../types';
import { Rng, SeededRNG } from '../rng/DeterministicRNG';
import { Verdict } from '../../entities/player/systems/LoadoutSystem';

const ok = (slots: EquipSlotId[], until?: number) => ({ ok: true, slots, until });
const no = (reason: string) => ({ ok: false as const, reason });

export interface CharmDefinition {
  id: string;
  name: string;
  description: string;
  slots: number;
  chosen: boolean;
  uses: number;
  value: number;
}

export interface ScrollDefinition {
  id: string;
  name: string;
  description: string;
  slots: number;
  chosen: boolean;
  durationSeconds: number;
  value: number;
}

/** The charms. Variability huge, value player-determinable by what is protected. */
export const CHARM_DEFINITIONS: Record<string, CharmDefinition> = {
  'chm_clasp': {
    id: 'chm_clasp',
    name: 'Clasp of Keeping',
    description: 'One slot, your choosing, one death. The bank honors it once, and it honors it in full.',
    slots: 1,
    chosen: true,
    uses: 1,
    value: 180
  },
  'chm_knot': {
    id: 'chm_knot',
    name: "Gambler's Knot",
    description: 'Three slots, not your choosing, one death. The knot decides what it loved.',
    slots: 3,
    chosen: false,
    uses: 1,
    value: 240
  }
};

/** The scrolls — written on paper and ink at a scribe's table (D14's hook, kept). */
export const SCROLL_DEFINITIONS: Record<string, ScrollDefinition> = {
  'scr_keeping': {
    id: 'scr_keeping',
    name: 'Scroll of the Kept Hand',
    description: 'One chosen slot, held for an hour of the clock. When the ink dries, the magic goes with it.',
    slots: 1,
    chosen: true,
    durationSeconds: 3600,
    value: 90
  }
};

/** What writing one scroll costs, in the scribe's own goods. */
export const SCROLL_MINT_BILL: { defId: string; tag: string; quantity: number }[] = [
  { defId: 'crf_paper', tag: 'paper', quantity: 1 },
  { defId: 'crf_ink', tag: 'ink', quantity: 1 }
];

const itemId = (rng: SeededRNG) =>
  `itm_${rng.int(0, 0xffffffff).toString(16).padStart(8, '0')}${rng.int(0, 0xffffffff).toString(16).padStart(8, '0')}`;

export class InsuranceSystem {

  /** A charm, minted. The card says what it keeps and how often. */
  static mintCharm(defId: string, rng: SeededRNG): IItem {
    const def = CHARM_DEFINITIONS[defId];
    if (!def) throw new Error(`No such charm: ${defId}`);
    return {
      id: itemId(rng),
      universalDefinitionId: def.id,
      name: def.name,
      description: def.description,
      type: ItemType.CONSUMABLE,
      slot: SlotType.NONE,
      rank: UniversalRank.E,
      rarity: Rarity.UNCOMMON,
      quality: 0,
      level: 1,
      value: def.value,
      itemPower: 0,
      tags: ['charm', 'magic', 'consumable'],
      affixes: [],
      dimensions: { width: 1, height: 1 },
      weight: 0.1,
      stats: {},
      visuals: { modelId: 'charm', colorHex: '#ffd700' },
      icon: 'charm_icon',
      history: { dropDate: Date.now(), killCount: 0 },
      isIdentified: true,
      charmData: { slots: def.slots, chosen: def.chosen, uses: def.uses }
    };
  }

  /** A scroll, as an item. Minting it at the table is mintScrollAtScribe's work. */
  static mintScrollItem(defId: string, rng: SeededRNG): IItem {
    const def = SCROLL_DEFINITIONS[defId];
    if (!def) throw new Error(`No such scroll: ${defId}`);
    return {
      id: itemId(rng),
      universalDefinitionId: def.id,
      name: def.name,
      description: def.description,
      type: ItemType.CONSUMABLE,
      slot: SlotType.NONE,
      rank: UniversalRank.E,
      rarity: Rarity.UNCOMMON,
      quality: 0,
      level: 1,
      value: def.value,
      itemPower: 0,
      tags: ['scroll', 'magic', 'paper', 'consumable'],
      affixes: [],
      dimensions: { width: 1, height: 1 },
      weight: 0.1,
      stats: {},
      visuals: { modelId: 'scroll', colorHex: '#e7e5e4' },
      icon: 'scroll_icon',
      history: { dropDate: Date.now(), killCount: 0 },
      isIdentified: true,
      scrollData: { slots: def.slots, chosen: def.chosen, durationSeconds: def.durationSeconds }
    };
  }

  /**
   * D14's hook made real: a scroll is WRITTEN at the scribe's table, paper and
   * ink consumed exactly once, the writing signed into provenance. Refusals
   * name the shortfall.
   */
  static async mintScrollAtScribe(defId: string): Promise<{ ok: boolean; reason?: string; item?: IItem }> {
    const def = SCROLL_DEFINITIONS[defId];
    if (!def) return { ok: false, reason: 'The table knows no such writing.' };

    const { usePlayerStore } = await import('../../entities/player/store');
    const { useIdentityStore } = await import('../../entities/identity/store');
    const { pickBill } = await import('../../entities/hub/room');
    const cert = useIdentityStore.getState().certificate;
    if (!cert) return { ok: false, reason: 'No identity holds the pen. Jack in first.' };

    const stash = usePlayerStore.getState().player.bank.stashTabs[0]?.items || [];
    const bill = pickBill(SCROLL_MINT_BILL.map(l => ({ tag: l.tag, count: l.quantity })), stash);
    if (!bill.ok) {
      return { ok: false, reason: `The scribe's bill is short: ${bill.missing}. Paper and ink, nothing else writes.` };
    }

    const consumedIds = bill.items.map(i => i.id);
    const item = this.mintScrollItem(defId, Rng.fromKey(`scroll:${cert.metadata.uid}:${Date.now()}:${stash.length}`));

    usePlayerStore.setState(s => ({
      player: { ...s.player, bank: { ...s.player.bank, stashTabs: s.player.bank.stashTabs.map((tab, idx) =>
        idx === 0 ? { ...tab, items: [...tab.items.filter(i => !consumedIds.includes(i.id)), item] } : tab
      ) } }
    }));

    try {
      const { Provenance } = await import('../sovereignty/Provenance');
      await Provenance.record(item, 'MINT', { origin: 'SCROLL', writerUid: cert.metadata.uid, consumedIds });
      const { Ledger } = await import('../ledger/Ledger');
      await Ledger.append('DESIGN', { kind: 'SCROLL_WRITTEN', itemId: item.id, defId, writerUid: cert.metadata.uid, consumedIds });
    } catch { /* the stores may be absent under a bare test harness; the mint stands */ }

    return { ok: true, item };
  }

  /**
   * What this magic would protect, named before it is spent. Chosen magic
   * takes the named slot; random magic draws from what is worn, keyed by the
   * item's own id so the same charm always calls the same slots.
   */
  static plan(
    item: IItem,
    occupied: EquipSlotId[],
    opts: { chosenSlot?: EquipSlotId }
  ): { ok: boolean; reason?: string; slots?: EquipSlotId[]; until?: number } {
    const magic = item.charmData ?? item.scrollData;
    if (!magic) return no(`${item.name} holds no keeping magic.`);
    if (occupied.length === 0) return no('Nothing is worn. The magic has nothing to hold.');

    let slots: EquipSlotId[];
    if (magic.chosen) {
      if (!opts.chosenSlot) return no(`${item.name} keeps a CHOSEN slot. Name it.`);
      if (!occupied.includes(opts.chosenSlot)) return no(`${opts.chosenSlot} holds nothing. The magic refuses an empty promise.`);
      slots = [opts.chosenSlot];
    } else {
      const rng = Rng.fromKey(`protection:${item.id}:${item.charmData?.uses ?? 0}`);
      const pool = [...occupied].sort();
      slots = [];
      const count = Math.min(magic.slots, pool.length);
      for (let i = 0; i < count; i++) {
        const idx = rng.int(0, pool.length);
        slots.push(pool[idx]);
        pool.splice(idx, 1);
      }
    }

    const until = item.scrollData ? Date.now() + item.scrollData.durationSeconds * 1000 : undefined;
    return ok(slots, until);
  }
}
