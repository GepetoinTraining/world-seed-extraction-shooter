export interface IActionContext {
  tags: string[];
  magnitude: number;
}

export class SkillDiscovery {
  static discoverSkill(context: IActionContext): string {
    // 1. COMBAT VECTORS
    if (context.tags.includes('melee') && context.tags.includes('blade')) return 'skill_swordsmanship';
    if (context.tags.includes('melee') && context.tags.includes('blunt')) return 'skill_bludgeoning';
    if (context.tags.includes('ranged') && context.tags.includes('tech')) return 'skill_ballistics';
    if (context.tags.includes('magic') && context.tags.includes('fire')) return 'skill_pyromancy';
    if (context.tags.includes('defense') && context.tags.includes('pain')) return 'skill_pain_tolerance';
    if (context.tags.includes('defense') && context.tags.includes('block')) return 'skill_aegis';
    
    // 2. MOVEMENT VECTORS
    if (context.tags.includes('movement') && context.tags.includes('sprint')) return 'skill_athletics';
    if (context.tags.includes('movement') && context.tags.includes('stealth')) return 'skill_covert_ops';
    
    // 3. ACADEMIC VECTORS
    if (context.tags.includes('intel') && context.tags.includes('ancient')) return 'skill_archaeology';
    if (context.tags.includes('intel') && context.tags.includes('tech')) return 'skill_reverse_engineering';
    if (context.tags.includes('analysis')) return 'skill_appraisal';

    // 4. FALLBACK
    const dominantTag = context.tags[0] || 'existence';
    return `skill_${dominantTag}_theory`;
  }
}