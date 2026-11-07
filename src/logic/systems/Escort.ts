/**
 * THE ESCORT (Q16, Pedro, 2026-11-04): "they should walk alongside, and try to fight their way out
 * if an enemy engages, yes. if they die you grab them as a corpse (needs to weight a lot) and they
 * revive on the other side of the dive (like we do) but you can't inspect the items and loot the corpse".
 *
 * This is the law, pure: what a person brought out has, what their blow does, what a blow does to
 * them, and what their body weighs. Every number is read from their own sheet through the doors a
 * player's numbers go through. `FieldEscort` is where it meets the stores.
 */

import { IAttributes, IEscort, IItem, ItemType, Rarity, SlotType, UniversalRank } from '../../../shared/types';
import { CombatMath } from '../../entities/combat/CombatMath';
import { InventorySystem } from '../../../shared/entities/player/systems/InventorySystem';
import { IWorldEntity } from '../../../shared/entities/world/types';
import { StatSystem } from '../../../shared/logic/systems/StatSystem';

/** The reach of a bare-handed swing: the same arc a person's own melee swing draws in the field. */
export const ESCORT_REACH_PX = 60;
/** A body takes up the room a towed kit does in the pack. A guess until Wave 12. */
const BODY_CELLS = { width: 2, height: 3 };
export const CORPSE_TAG = 'npc_corpse';

type Bond = IEscort['bond'];

export interface IEscortSwing {
  origin: { x: number; y: number };
  angle: number;
  range: number;
  startTime: number;
  damage: number;
}

export const Escort = {

  /** Who walks beside you now: whole, at the health their own constitution gives them. */
  join(entity: Pick<IWorldEntity, 'id' | 'npc'>, bond: Bond, stats: IAttributes): IEscort {
    const maxHealth = StatSystem.maxHealth(stats);
    return { entityId: entity.id, name: entity.npc?.name ?? bond.sheet.name, stats, health: maxHealth, maxHealth, lastStrikeAt: 0, strikes: 0, bond };
  },

  /** Their own pace between blows, bare-handed, as a person's own would be. */
  cooldownMs(stats: IAttributes): number {
    return CombatMath.fireCooldownMs(undefined, undefined, stats);
  },

  /**
   * "try to fight their way out if an enemy engages": a blow at the nearest enemy that has engaged
   * and stands in reach, when their pace allows. One that has not engaged is left alone.
   */
  strike(escort: IEscort, at: { x: number; y: number }, hostiles: { id: string; x: number; y: number; engaged: boolean }[], now: number): { escort: IEscort; swing?: IEscortSwing; target?: string } {
    if (escort.fallen || escort.health <= 0) return { escort };
    if (now - escort.lastStrikeAt < this.cooldownMs(escort.stats)) return { escort };
    let best: { id: string; x: number; y: number } | null = null;
    let bestPx = ESCORT_REACH_PX;
    for (const h of hostiles) {
      if (!h.engaged) continue;
      const d = Math.hypot(h.x - at.x, h.y - at.y);
      if (d <= bestPx) { best = h; bestPx = d; }
    }
    if (!best) return { escort };
    const hit = CombatMath.outgoing(undefined, undefined, `escort:${escort.entityId}:${escort.strikes}`, escort.stats);
    return {
      escort: { ...escort, lastStrikeAt: now, strikes: escort.strikes + 1 },
      swing: { origin: { ...at }, angle: Math.atan2(best.y - at.y, best.x - at.x), range: ESCORT_REACH_PX, startTime: now, damage: hit.damage },
      target: best.id
    };
  },

  /** Which of them a blow from here, with this reach, lands on: the nearest in reach, or nobody. */
  hitBy(origin: { x: number; y: number }, reachPx: number, bodies: { entityId: string; x: number; y: number }[]): string | null {
    let best: string | null = null;
    let bestPx = reachPx;
    for (const b of bodies) {
      const d = Math.hypot(b.x - origin.x, b.y - origin.y);
      if (d < bestPx) { best = b.entityId; bestPx = d; }
    }
    return best;
  },

  /** A blow arriving, through the same door a person's does: their own stats may turn it aside. */
  take(escort: IEscort, raw: number, key: string): { escort: IEscort; landed: number; fell: boolean } {
    if (escort.fallen) return { escort, landed: 0, fell: false };
    const { damage } = CombatMath.incoming(raw, undefined, key, escort.stats);
    const health = Math.max(0, escort.health - damage);
    const fell = health <= 0;
    return { escort: { ...escort, health, ...(fell ? { fallen: true } : {}) }, landed: damage, fell };
  },

  /** "needs to weigh a lot": a body weighs what that person could carry themselves. */
  corpseWeight(stats: IAttributes): number {
    return InventorySystem.maxCarryWeight(stats.strength);
  },

  isCorpse(item: IItem): boolean {
    return (item.tags ?? []).includes(CORPSE_TAG);
  },

  /** A person on paper or on your back. Neither is a haul. */
  isPerson(item: IItem): boolean {
    return !!item.bondData || (item.tags ?? []).includes('npc_contract') || (item.tags ?? []).includes(CORPSE_TAG);
  },

  /** What you carry when they fall: their weight, their name, and nothing of theirs to open. */
  corpseOf(escort: IEscort): IItem {
    return {
      id: `corpse_${escort.entityId}`,
      universalDefinitionId: CORPSE_TAG,
      name: escort.name,
      description: 'They will come back on the other side, if you get them there.',
      type: ItemType.COMMODITY,
      slot: SlotType.NONE,
      rank: escort.bond.rank ?? UniversalRank.F,
      rarity: Rarity.COMMON,
      level: 1,
      quality: 0,
      value: 0,
      itemPower: 0,
      tags: [CORPSE_TAG],
      affixes: [],
      dimensions: { ...BODY_CELLS },
      weight: this.corpseWeight(escort.stats),
      stats: {},
      visuals: { modelId: CORPSE_TAG, colorHex: '#000000' },
      icon: '',
      history: { dropDate: 0, killCount: 0 },
      isIdentified: true,
      bondData: escort.bond
    };
  },

  /** The bond that reaches Mags: the same paper the field has always written, whoever carried them there. */
  bondOf(bond: Bond, id: string, revived: boolean): IItem {
    const { name, temperament } = bond.sheet;
    return {
      id,
      universalDefinitionId: 'npc_contract',
      name: `Escort Bond: ${name}`,
      description: revived
        ? `${name} (${temperament.toLowerCase()}) fell on the way out and came back on the other side. Worth more than gold, redeemable for some anyway.`
        : `${name} (${temperament.toLowerCase()}) walked beside you to the beacon. Worth more than gold, redeemable for some anyway.`,
      type: ItemType.LORE,
      slot: SlotType.NONE,
      rank: bond.rank,
      rarity: Rarity.RARE,
      level: 1,
      quality: 0,
      value: 200,
      itemPower: 0,
      tags: ['npc_contract', 'social'],
      affixes: [],
      dimensions: { width: 1, height: 1 },
      weight: 0,
      stats: {},
      visuals: { modelId: 'npc_contract', colorHex: '#000000' },
      icon: '🤝',
      history: { dropDate: 0, killCount: 0 },
      isIdentified: true,
      bondData: bond
    };
  }
};
