import { ITransformationRecipe, IIndustrialFacility } from './types';
import { IItem } from '../../../types';

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
  static processCycle(recipe: ITransformationRecipe, inputs: IItem[]): { 
    consumedIds: string[], 
    generatedItems: { defId: string, count: number }[] 
  } {
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
      if (Math.random() <= out.probability) {
        generatedItems.push({ defId: out.itemId, count: out.quantity });
      }
    });

    return { consumedIds, generatedItems };
  }
}