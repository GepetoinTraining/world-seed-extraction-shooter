/**
 * THE EFFECT DOOR (Layer 1, line 78): one function for monsters, players and items.
 *
 * Pure and keyed: the same ability, caster and key give the same receipt on every
 * machine (D38: fights stay real-time; adding a die means a rolled range, keyed, with
 * no turns). Numbers come only from the formula. Applying a receipt is the caller's
 * business; what a thing does is decided here and nowhere else.
 */

import { Rng } from '../rng/DeterministicRNG';
import { abilityNumbers, FORCED_EXIT_COST } from '../theme/ThemeFormula';
import { COST_BANDS, DELIVERIES, EFFECTS, ThemeRank } from '../theme/ThemeTypes';

export interface IEffectAbility {
  id: string;
  name: string;
  elements: string[];
  delivery: typeof DELIVERIES[number];
  effect: typeof EFFECTS[number];
  cost: typeof COST_BANDS[number];
}

export interface IEffectCaster {
  rank: ThemeRank | string;
  /** What the caster's own gear or mind adds, as a fraction: 0.2 is a fifth harder. */
  power?: number;
}

/** What one casting does. A receipt says it all, so a fight can be replayed and shown. */
export interface IEffectReceipt {
  abilityId: string;
  key: string;
  effect: IEffectAbility['effect'];
  delivery: IEffectAbility['delivery'];
  elements: string[];
  magnitude: number;
  durationMs: number;
  telegraphMs: number;
  cooldownMs: number;
  energy: number;
  aether: number;
  /** How far it reaches, in pixels. A read of the delivery, never a table per ability. */
  reachPx: number;
  /** The clock it leaves on what it hit, if any. */
  status?: IStatusPlan;
  /** The way out it opens where the caster stands, if it is a forced exit (D77). */
  exit?: IExitPlan;
}

export interface IStatusPlan {
  /** `stagger` is a hit felt (the fight's rebalance, part 2): that share of pace lost for that share of a second. */
  kind: 'dot' | 'slow' | 'stun' | 'ward' | 'haste' | 'weaken' | 'stagger';
  magnitude: number;
  durationMs: number;
  tickMs?: number;
}

/** The channel a forced way out asks, before the stat that shortens a beacon's reads it. */
export interface IExitPlan {
  channelMs: number;
}

const REACH_PX: Record<IEffectAbility['delivery'], number> = {
  self: 0, touch: 40, melee: 60, ranged: 400, area: 120, aura: 80
};

/** The roll a casting makes, either side of the formula's number. */
const ROLL_SPREAD = 0.15;
const DOT_TICK_MS = 500;

export class EffectSystem {

  static resolve(ability: IEffectAbility, caster: IEffectCaster, key: string): IEffectReceipt {
    const numbers = abilityNumbers(ability.cost, caster.rank as ThemeRank);
    const rng = Rng.fromKey(`effect:${ability.id}:${key}`);
    const roll = 1 - ROLL_SPREAD + rng.next() * ROLL_SPREAD * 2;
    const magnitude = Math.max(1, Math.round(numbers.magnitude * roll * (1 + (caster.power ?? 0))));
    const receipt: IEffectReceipt = {
      abilityId: ability.id, key,
      effect: ability.effect, delivery: ability.delivery, elements: ability.elements,
      magnitude,
      durationMs: numbers.durationMs,
      telegraphMs: numbers.telegraphMs,
      cooldownMs: numbers.cooldownMs,
      energy: numbers.energy,
      aether: numbers.aether,
      reachPx: REACH_PX[ability.delivery]
    };
    const status = this.statusOf(ability.effect, magnitude, numbers.durationMs);
    if (ability.effect === 'forced_exit') return { ...receipt, exit: { channelMs: numbers.durationMs + numbers.telegraphMs } };
    return status ? { ...receipt, status } : receipt;
  }

  private static statusOf(effect: IEffectAbility['effect'], magnitude: number, durationMs: number): IStatusPlan | undefined {
    switch (effect) {
      case 'control': return { kind: 'slow', magnitude: Math.min(0.7, 0.3 + magnitude / 200), durationMs };
      case 'debuff': return { kind: 'dot', magnitude: Math.max(1, Math.round(magnitude / 4)), durationMs, tickMs: DOT_TICK_MS };
      case 'ward': return { kind: 'ward', magnitude: magnitude * 2, durationMs: durationMs * 3 };
      case 'buff': return { kind: 'haste', magnitude: Math.min(0.5, 0.1 + magnitude / 300), durationMs };
      default: return undefined;
    }
  }

  static triggered(equipment: Parameters<typeof triggeredAbilities>[0] | undefined, trigger: string): string[] {
    return triggeredAbilities(equipment, trigger);
  }

  /** Does this effect land on what it was aimed at, or on the one casting it? */
  static landsOnCaster(effect: IEffectAbility['effect'], delivery: IEffectAbility['delivery']): boolean {
    return delivery === 'self' || effect === 'heal' || effect === 'ward' || effect === 'buff' || effect === 'rest' || effect === 'forced_exit';
  }

  /**
   * The law over the word, for a pack and a gift alike (D77): what opens a way out opens
   * it where you stand, at the top of the bands. Null if it may stand.
   */
  static exitRefusal(ability: { effect: string; delivery: string; cost: string }): string | null {
    if (ability.effect !== 'forced_exit') return null;
    if (ability.delivery !== 'self') return 'opens a way out where its caster stands, so its delivery is self.';
    if (ability.cost !== FORCED_EXIT_COST) return `opens a way out, and that is never cheaper than ${FORCED_EXIT_COST}.`;
    return null;
  }

  /** Does a gate in this phase take a run? Not one with a forced way out already open: that door is not the gate's. */
  static gateTakes(phase: string, forcedOpen: boolean): boolean {
    return phase !== 'UP' && !forcedOpen;
  }
}

/** What a worn piece fires on this happening. The trigger is a word from a pack, never a table here. */
export function triggeredAbilities(equipment: { slots: Record<string, string>; items: { id: string; carries?: { ability: string; trigger: string } }[] } | undefined, trigger: string): string[] {
  if (!equipment) return [];
  const on = new Set(Object.values(equipment.slots));
  return equipment.items.filter(i => on.has(i.id) && i.carries?.trigger === trigger).map(i => i.carries!.ability);
}

// -------------------------------------------------------------------------
// Statuses on the clock, for anything that carries them
// -------------------------------------------------------------------------

export interface IActiveStatus {
  kind: string;
  magnitude: number;
  until: number;
  nextAt: number;
  tickMs?: number;
  /** So the time left can be drawn as a share of the whole (line 124). */
  startedAt?: number;
}

export const StatusClock = {
  add(statuses: IActiveStatus[] | undefined, plan: IStatusPlan, now: number): IActiveStatus[] {
    return [
      ...(statuses ?? []).filter(s => s.kind !== plan.kind),
      { kind: plan.kind, magnitude: plan.magnitude, until: now + plan.durationMs, nextAt: now + (plan.tickMs ?? plan.durationMs), tickMs: plan.tickMs, startedAt: now }
    ];
  },

  /** What is due by now: damage over time to apply, and what is still running. */
  tick(statuses: IActiveStatus[] | undefined, now: number): { damage: number; statuses: IActiveStatus[] } {
    let damage = 0;
    const left: IActiveStatus[] = [];
    for (const s of statuses ?? []) {
      let next = s.nextAt;
      if (s.tickMs) {
        while (next <= now && next <= s.until) { damage += s.magnitude; next += s.tickMs; }
      }
      if (s.until > now) left.push({ ...s, nextAt: next });
    }
    return { damage, statuses: left };
  },

  /** A ward spends itself on what would have landed. */
  absorb(statuses: IActiveStatus[] | undefined, damage: number): { damage: number; statuses: IActiveStatus[] } {
    let left = damage;
    const out: IActiveStatus[] = [];
    for (const s of statuses ?? []) {
      if (s.kind === 'ward' && left > 0) {
        const taken = Math.min(s.magnitude, left);
        left -= taken;
        if (s.magnitude - taken > 0) out.push({ ...s, magnitude: s.magnitude - taken });
      } else out.push(s);
    }
    return { damage: left, statuses: out };
  },

  /** How much of its pace a body keeps: a slow takes from it, haste adds to it. */
  paceScale(statuses: IActiveStatus[] | undefined): number {
    let scale = 1;
    for (const s of statuses ?? []) {
      if (s.kind === 'slow' || s.kind === 'stagger') scale *= 1 - s.magnitude;
      if (s.kind === 'haste') scale *= 1 + s.magnitude;
    }
    return scale;
  }
};
