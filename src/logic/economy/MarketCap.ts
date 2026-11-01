/**
 * THE WEB'S VALUE (D115). Pedro: "You can know how much by market cap over the items the skill
 * produces".
 *
 * A skill produces what its hands bring in, or what its trade makes on a bench. What the web
 * is worth is everything in the city that some skill in it produces, each at its own value, and
 * each piece once: two skills that can both bring in a log do not make the log worth two logs.
 * A skill nothing is made by here is worth nothing yet.
 *
 * A piece's own value is what it was minted at. Nothing here reads coin, so this is no price.
 * Pure over what it is handed: the live tables, and the items the city holds.
 */

import { IHubWeb, IItem, IWebPack } from '../../../types';
import { CRAFTED_DEFINITIONS, GEAR_RECIPES, RECIPE_DEFINITIONS } from '../../entities/economy/data/recipeDefinitions';
import { RESOURCE_DEFINITIONS } from '../../entities/item/data/resourceDefinitions';
import { WebBank } from '../content/WebBank';
import { ProcessSystem } from '../systems/ProcessSystem';
import { WebSystem } from '../systems/WebSystem';

interface IMaking {
  trade: string | undefined;
  station: string | undefined;
  inputs: string[];
  outputs: string[];
}

const tradeOfSkill = (skill: string | undefined) => skill?.replace(/^skill_/, '');
const tagsOfDef = (id: string) => (CRAFTED_DEFINITIONS[id] ?? RESOURCE_DEFINITIONS[id])?.tags ?? [];

/** Every way anything is made in this web, read from the live tables. */
const makings = (pack: IWebPack): IMaking[] => [
  ...Object.values(RECIPE_DEFINITIONS).map(r => ({
    trade: tradeOfSkill(r.requiredSkill), station: undefined, inputs: r.inputs.map(i => i.itemId), outputs: r.outputs.map(o => o.itemId)
  })),
  ...pack.recipes.map(r => ({
    trade: r.trade, station: r.requiredStation, inputs: r.inputs.map(i => i.itemId), outputs: r.outputs.map(o => o.itemId)
  })),
  // The game's own rule for gear: smithing at a bench, and nobody's trade by hand.
  ...Object.values(GEAR_RECIPES).map(r => ({
    trade: ProcessSystem.familyOfRecipe(r.id) ?? undefined, station: undefined, inputs: r.inputs.map(i => i.itemId), outputs: [r.outputBase]
  }))
];

export const MarketCap = {
  /** What a skill with these tags brings into being, by definition. */
  producedBy(tags: string[], pack: IWebPack = WebBank.current()): Set<string> {
    const trades = tags.filter(t => WebBank.hasKind(pack, t, ['trade']));
    const benches = WebSystem.benchesOf(tags, pack);
    const worked = WebSystem.materialIdentity(tags, pack);
    // Hands bring in what lies in the ground. What a bench makes is a trade's, whatever tag it shares.
    const out = new Set<string>(trades.length === 0 ? WebSystem.materialsOf(tags, pack).filter(id => !CRAFTED_DEFINITIONS[id]) : []);
    for (const making of makings(pack)) {
      const byHand = !!making.trade && trades.includes(making.trade);
      const atBench = !!making.station && benches.includes(making.station);
      if (!byHand && !atBench) continue;
      const fedBy = making.inputs.flatMap(tagsOfDef);
      if (worked.every(t => fedBy.includes(t))) making.outputs.forEach(id => out.add(id));
    }
    return out;
  },

  /** One skill's market cap, over what the city holds. */
  ofSkill(tags: string[], items: Pick<IItem, 'universalDefinitionId' | 'value'>[], pack: IWebPack = WebBank.current()): number {
    const produced = this.producedBy(tags, pack);
    return items.reduce((sum, item) => sum + (produced.has(item.universalDefinitionId) ? Math.max(0, item.value || 0) : 0), 0);
  },

  /** The web's: every piece any skill in it produces, once. */
  ofWeb(web: IHubWeb, items: Pick<IItem, 'universalDefinitionId' | 'value'>[], pack: IWebPack = WebBank.current()): number {
    const produced = new Set<string>();
    for (const node of Object.values(web.nodes)) this.producedBy(node.tags, pack).forEach(id => produced.add(id));
    return items.reduce((sum, item) => sum + (produced.has(item.universalDefinitionId) ? Math.max(0, item.value || 0) : 0), 0);
  }
};
