export interface AffixDefinition {
  id: string;
  nameTemplate: string; 
  type: 'PREFIX' | 'SUFFIX';
  allowedTags: string[];
  statModifiers: Record<string, [number, number]>;
  // FIXED: Added tier property
  tier: number;
  /** The rarity rescale: the writer's words, when the bank has them (IBankedAffix.gives). */
  gives?: { stat: string; band: 'minor' | 'moderate' | 'major'; downside: boolean }[];
}

/** The old legacy pool, retired with everything hardcoded (D53, D54). Only the test fixture fills it. */
export const AFFIX_DEFINITIONS: { prefixes: AffixDefinition[], suffixes: AffixDefinition[] } = { prefixes: [], suffixes: [] };
