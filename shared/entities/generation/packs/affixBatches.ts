import { IAffixBatch } from '../../../types';

/**
 * The bank's batches: what the installed themes have run (D20, D53). A theme's
 * affixes join here at install, so the shelf can roll them. Empty until then.
 */
export const AFFIX_BATCHES: IAffixBatch[] = [];
