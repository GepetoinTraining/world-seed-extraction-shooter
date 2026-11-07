import { ITransformationRecipe, IIndustrialFacility } from '../../../shared/entities/economy/types';
import { IItem } from '../../../shared/types';
import { SeededRNG, Rng } from '../../../shared/logic/rng/DeterministicRNG';

export class TransformationEngine {
  
  /**
   * Validates if a facility has the necessary inputs for a recipe.
   */
  static canProcess(facility: IIndustrialFacility, recipe: ITransformationRecipe, inputItems: IItem[]): boolean {
    // 1. Check Facility Type
    // (In a real implementation, we'd check if structureId matches requiredFacility)
    
    // 2. Check Inputs
    for (const req of recipe.inputs) {
      const available = inputItems.filter(i => i.universalDefinitionId === req.itemId).length;
      if (available < req.quantity) return false;
    }
    
    return true;
  }

  /**
   * Executes a transformation cycle.
   * Consumes inputs, generates outputs.
   */
  static processCycle(recipe: ITransformationRecipe, inputs: IItem[], rng?: SeededRNG): {
    consumedIds: string[],
    generatedItems: { defId: string, count: number }[]
  } {
    // Wave 5.2: probabilistic outputs roll from a journaled key, never ambient
    if (!rng) {
      console.warn('[CRAFT] Unkeyed craft roll - not replayable.');
      rng = Rng.fromKey(`unkeyed:craft:${Date.now()}:${Math.random()}`);
    }
    const consumedIds: string[] = [];
    const generatedItems: { defId: string, count: number }[] = [];

    // 1. Consume Inputs
    recipe.inputs.forEach(req => {
      if (!req.consume) return;
      
      let needed = req.quantity;
      for (const item of inputs) {
        if (needed <= 0) break;
        if (item.universalDefinitionId === req.itemId && !consumedIds.includes(item.id)) {
          consumedIds.push(item.id);
          needed--;
        }
      }
    });

    // 2. Generate Outputs (Probabilistic)
    recipe.outputs.forEach(out => {
      if (rng!.next() <= out.probability) {
        generatedItems.push({ defId: out.itemId, count: out.quantity });
      }
    });

    return { consumedIds, generatedItems };
  }
}