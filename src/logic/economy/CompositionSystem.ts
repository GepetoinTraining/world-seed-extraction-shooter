/**
 * THE ANATOMY OF ITEMS (Wave 10D.2 / 10D.4)
 *
 * Every item records the MATERIALS it came from and the TRANSFORMATION CHAIN
 * that made it, step by step with each step's labor. The chain is the power
 * budget — more chain, better item — and the price derives from the chain:
 * atoms + labor, scaled by the rarity of the route. The balance law, in
 * Pedro's words: you invest time in the chain.
 *
 * Pure integer-and-float work over plain records; deterministic; versioned.
 * The rules may grow — COMPOSITION_RULES_VERSION rides every composition, so
 * old items keep the law they were made under.
 */

import { IComposition, ICompositionStep, MaterialOrigin } from '../../../types';
import { RESOURCE_DEFINITIONS, ResourceDef } from '../../entities/item/data/resourceDefinitions';
import { MaterialPropertyType } from '../../entities/economy/types';

export const COMPOSITION_RULES_VERSION = 1;

/** One second of honest labor is worth one gold. The vendor pays 60% of it. */
export const LABOR_RATE_GOLD_PER_SECOND = 1;

/** Each step of depth past the first makes the route rarer, and dearer. */
export const ROUTE_RARITY_STEP = 0.25;

/** The def table a composition prices against: resources plus crafted goods.
 * Crafted defs register themselves here (recipeDefinitions) to avoid a cycle. */
const DEF_TABLE: Record<string, ResourceDef> = { ...RESOURCE_DEFINITIONS };
export function registerCompositionDefs(defs: Record<string, ResourceDef>): void {
  Object.assign(DEF_TABLE, defs);
}

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

export class CompositionSystem {

  /** The root of every chain: a raw thing, straight from its origin. */
  static root(def: { id: string; name: string }, origin: MaterialOrigin): IComposition {
    return {
      version: COMPOSITION_RULES_VERSION,
      materials: [{ defId: def.id, name: def.name, count: 1, origin }],
      steps: [],
      depth: 0,
      laborSeconds: 0,
      batchYield: 1
    };
  }

  /**
   * One transformation: the consumed items' compositions fold into the output.
   * Counts and labor are divided by the batch yield, so composition is always
   * PER ITEM and the same chain gives the same bytes on every machine.
   */
  static compose(step: ICompositionStep, inputs: IComposition[], batchYield: number): IComposition {
    const yieldCount = Math.max(1, batchYield);
    const merged = new Map<string, { defId: string; name: string; count: number; origin: MaterialOrigin }>();
    for (const input of inputs) {
      for (const m of input.materials) {
        const key = `${m.defId}|${m.origin}`;
        const prior = merged.get(key);
        if (prior) prior.count += m.count;
        else merged.set(key, { ...m });
      }
    }
    const materials = [...merged.values()]
      .map(m => ({ ...m, count: round6(m.count / yieldCount) }))
      .sort((a, b) => a.defId < b.defId ? -1 : a.defId > b.defId ? 1 : a.origin < b.origin ? -1 : 1);

    const steps: ICompositionStep[] = [];
    for (const input of inputs) {
      for (const s of input.steps) if (!steps.some(k => k.recipeId === s.recipeId)) steps.push(s);
    }
    steps.push({ recipeId: step.recipeId, name: step.name, laborSeconds: step.laborSeconds, facility: step.facility });

    const laborIn = inputs.reduce((sum, c) => sum + c.laborSeconds, 0);
    return {
      version: COMPOSITION_RULES_VERSION,
      materials,
      steps,
      depth: Math.max(0, ...inputs.map(c => c.depth)) + 1,
      laborSeconds: round6((laborIn + step.laborSeconds) / yieldCount),
      batchYield: yieldCount
    };
  }

  /**
   * The root value law, as the audit found it (kept): atoms are worth their
   * weight and their hardness. Quality now reaches it — one scale (10D.5):
   * a salvage-bitten plank is worth less than a fresh one.
   */
  static baseMaterialValue(def: ResourceDef | undefined, quality: number = 0): number {
    if (!def) return 1;
    const density = def.materialProps?.[MaterialPropertyType.DENSITY];
    const weight = density !== undefined ? density * 0.5 : (def.weight ?? 1.0);
    const hardness = def.materialProps?.[MaterialPropertyType.HARDNESS] ?? 0;
    const q = Math.abs(quality) <= 1 ? quality : 0;
    return Math.max(1, Math.round((weight * 4 + hardness) * (1 + q)));
  }

  /** How rare the route is: 1.0 for raw and single-step, +25% per depth past 1. */
  static routeMultiplier(depth: number): number {
    return 1 + ROUTE_RARITY_STEP * Math.max(0, depth - 1);
  }

  /**
   * THE PRICE LAW (10D.4, absorbing 11B): value = atoms + labor, scaled by
   * the rarity of the route. Monotonic in chain depth for fixed materials —
   * labor never destroys value again.
   */
  static priceOf(c: IComposition): number {
    const atoms = c.materials.reduce(
      (sum, m) => sum + this.baseMaterialValue(DEF_TABLE[m.defId]) * m.count, 0);
    const labor = c.laborSeconds * LABOR_RATE_GOLD_PER_SECOND * this.routeMultiplier(c.depth);
    return Math.max(1, Math.ceil(atoms + labor));
  }

  /**
   * THE POWER BUDGET (10D.2): the chain is the budget. Crafted gear's item
   * power derives from what it is made of and how far it was taken. A raw
   * improvisation (depth 1) is the deliberate floor; the long route pays.
   */
  static powerBudget(c: IComposition): number {
    let term = 0, count = 0;
    for (const m of c.materials) {
      const props = DEF_TABLE[m.defId]?.materialProps;
      const hardness = props?.[MaterialPropertyType.HARDNESS] ?? 0;
      const density = props?.[MaterialPropertyType.DENSITY] ?? 0;
      term += (hardness + density) * m.count;
      count += m.count;
    }
    const matTerm = count > 0 ? term / count : 0;
    return Math.max(1, Math.floor(matTerm * (0.55 + 0.45 * Math.max(1, c.depth))));
  }

  /** A stable hash of a composition — the signed MINT record carries it. */
  static compositionHash(c: IComposition): string {
    return fnv1a(JSON.stringify(c));
  }
}

/** FNV-1a over a string, as 8 hex chars. Deterministic everywhere. */
export function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}
