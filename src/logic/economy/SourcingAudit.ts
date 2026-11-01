/**
 * THE SOURCING AUDIT (test line 45, run in the raw materials leg)
 *
 * Every gameplay material can be sourced, refined and consumed. This reads the
 * live definitions, so a material added later with no way in or no way out
 * reopens the bar by itself.
 *
 * "Refined" means a process takes it. "Direct" means it is used as it comes and
 * has no process on purpose: only food, eaten. A waiver must name the wave that
 * closes it, and the bar holds the waiver list to exactly what it says.
 */

import { ItemType } from '../../../types';
import { RESOURCE_DEFINITIONS, BIOME_RESOURCES } from '../../entities/item/data/resourceDefinitions';
import { MOB_DEFINITIONS } from '../../entities/mob/data/mobDefinitions';
import { RECIPE_DEFINITIONS, CRAFTED_DEFINITIONS, GEAR_RECIPES } from '../../entities/economy/data/recipeDefinitions';
import { PIECE_BILLS, SHELL_BILLS, SHELL_STATION, isStation, shellBillFor } from '../../entities/hub/room';
import { WebBank } from '../content/WebBank';
import { TEMPLATE_MINT_BILL } from '../../entities/hub/template';

export interface ISourcingRow {
  defId: string;
  name: string;
  raw: boolean;
  /** Biomes it grows in, or the recipes and shells that make it. */
  sourced: string[];
  /** The processes that take it as an input. */
  refined: string[];
  /** Used as it comes, on purpose. */
  direct?: string;
  /** Every way it leaves the economy. */
  sinks: string[];
  waiver?: string;
  closed: boolean;
  problems: string[];
}

const WAIVERS: Record<string, string> = {};

const billLines = (): { tag: string; label: string }[] => [
  ...Object.entries(PIECE_BILLS).map(([kind, line]) => ({ tag: line.tag, label: `bill:${line.tag} (${kind})` })),
  ...Object.entries(SHELL_BILLS).flatMap(([kind, lines]) => lines.map(line => ({ tag: line.tag, label: `bill:${line.tag} (${kind} shell)` }))),
  ...TEMPLATE_MINT_BILL.map(line => ({ tag: line.tag, label: `bill:${line.tag} (the mint)` })),
  ...WebBank.current().stations.flatMap(s => s.bill.map(line => ({ tag: line.tag, label: `bill:${line.tag} (${s.name})` })))
];

export class SourcingAudit {

  /** What a world needs to generate: the same static context the golden check uses. */
  static worldContext() {
    return {
      mobDefinitions: Object.values(MOB_DEFINITIONS),
      resourceDefinitions: Object.values(RESOURCE_DEFINITIONS)
    };
  }

  /**
   * The cold start, walked: everything raw is in reach; a shell's station stands
   * if raw materials answer its bill (the first bench's, D25); then every recipe
   * whose inputs are in reach makes its outputs, until nothing new appears.
   */
  static reachableFromRaw(): Set<string> {
    const reach = new Set<string>(Object.keys(RESOURCE_DEFINITIONS));
    const answered = (lines: { tag: string }[]) => lines.every(line =>
      [...reach].some(id => (RESOURCE_DEFINITIONS[id] ?? CRAFTED_DEFINITIONS[id])?.tags?.includes(line.tag)));

    (['WORKSHOP', 'VENDOR', 'HOUSE'] as const).forEach(kind => {
      const station = SHELL_STATION[kind];
      if (station && answered(shellBillFor(kind, false))) reach.add(station);
    });
    const benchStands = reach.has('stn_bench');
    // D27: a shelf's material is in reach, and a further station stands once its bill can be answered.
    for (const material of WebBank.current().materials) if (material.shelfPrice) reach.add(material.id);
    let grew = true;
    while (grew) {
      grew = false;
      for (const station of WebBank.current().stations) {
        if (benchStands && !reach.has(station.id) && answered(station.bill) && answered(SHELL_BILLS.WORKSHOP)) {
          reach.add(station.id);
          grew = true;
        }
      }
      for (const recipe of WebBank.current().recipes) {
        if (!reach.has(recipe.requiredStation)) continue;
        if (!recipe.inputs.every(input => reach.has(input.itemId))) continue;
        for (const out of recipe.outputs) {
          if (!reach.has(out.itemId)) { reach.add(out.itemId); grew = true; }
        }
      }
      for (const recipe of Object.values(RECIPE_DEFINITIONS)) {
        if (recipe.requiredFacility === 'WORKSHOP' && !benchStands) continue;
        if (!recipe.inputs.every(input => reach.has(input.itemId))) continue;
        for (const out of recipe.outputs) {
          if (!reach.has(out.itemId)) { reach.add(out.itemId); grew = true; }
        }
      }
    }
    return reach;
  }

  static run(): ISourcingRow[] {
    const reach = this.reachableFromRaw();
    const bills = billLines();
    const inputsOf = [...Object.values(RECIPE_DEFINITIONS), ...Object.values(GEAR_RECIPES), ...WebBank.current().recipes];

    const row = (defId: string, def: any, raw: boolean): ISourcingRow => {
      // D99: it comes from what falls, and it leaves by being sold
      if (def.junk) return { defId, name: def.name, raw, sourced: ['a creature that falls'], refined: [], direct: 'sold', sinks: ['the vendor'], closed: true, problems: [] };
      // D115: it comes from a chest, and it leaves by being kept or taken in place of coin
      if (def.anchor) return { defId, name: def.name, raw, sourced: ['a chest'], refined: [], direct: 'sold', sinks: ['a counter', 'a shelf that asks for it'], closed: true, problems: [] };
      const sourced = raw
        ? Object.entries(BIOME_RESOURCES).filter(([, ids]) => ids.includes(defId)).map(([biome]) => biome)
        : [
            ...[...Object.values(RECIPE_DEFINITIONS), ...WebBank.current().recipes].filter(r => r.outputs.some(o => o.itemId === defId)).map(r => r.id),
            ...Object.entries(SHELL_STATION).filter(([, station]) => station === defId).map(([kind]) => `${kind} shell`),
            ...WebBank.current().stations.filter(s => s.id === defId).map(s => `a further bench, fitted as ${s.name}`),
            ...WebBank.current().materials.filter(m => m.id === defId && m.shelfPrice).map(() => 'the alchemist\'s shelf')
          ];
      const refined = inputsOf.filter(r => r.inputs.some(i => i.itemId === defId)).map(r => r.id);
      const eaten = def.type === ItemType.CONSUMABLE && (def.stats?.health_restore ?? 0) > 0;
      const stands = isStation(defId);
      // What grows can go in the ground, on farmland (line 36): Farm.plantVerdict's own reading
      const planted = raw && (def.tags ?? []).includes('flora') && !!def.regrowMs;
      const sinks = [
        ...refined.map(id => `recipe:${id}`),
        ...new Set(bills.filter(line => (def.tags ?? []).includes(line.tag)).map(line => line.label)),
        ...(eaten ? ['meal'] : []),
        ...(stands ? ['stands in a room'] : []),
        ...(planted ? ['a bed on farmland'] : [])
      ];
      const waiver = WAIVERS[defId];
      const direct = raw && eaten ? 'eaten' : planted && refined.length === 0 ? 'planted' : undefined;

      const problems: string[] = [];
      if (sourced.length === 0) problems.push('nothing sources it');
      if (!reach.has(defId)) problems.push('a fresh origin cannot reach it');
      if (!waiver) {
        if (sinks.length === 0) problems.push('nothing consumes it');
        if (raw && refined.length === 0 && !direct) problems.push('no process takes it, and it is not used directly');
      }
      return { defId, name: def.name, raw, sourced, refined, direct, sinks, waiver, closed: problems.length === 0, problems };
    };

    return [
      ...Object.entries(RESOURCE_DEFINITIONS).map(([id, def]) => row(id, def, true)),
      ...Object.entries(CRAFTED_DEFINITIONS).map(([id, def]) => row(id, def, false))
    ];
  }
}
