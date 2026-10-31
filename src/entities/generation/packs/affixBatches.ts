/**
 * THE SHIPPED BATCHES (Wave 10E — D20)
 *
 * Each batch is one LLM agent run, banked as data. Run 001 banked NAMES themed
 * to each biome — the bank held them inert, doing nothing, until run 002
 * defined their EFFECTS. That gap is the design: the game starts nearly empty
 * and grows because content is added, and a world minted between the runs
 * keeps the quieter bank it was pinned to, forever.
 *
 * The law these batches pass through is AffixBank.validateBatch — D22's
 * partition included: a mental stat rides only an entry scoped ['frame'].
 * Several effects are NEGATIVE on purpose (D19): downside pays for upside,
 * and what a Rustbitten blade is worth is for players to work out.
 *
 * Entries still name-only after run 002 (the bank remembering more than it
 * says): res_rui_vaultaged, res_ind_slagborn, res_cyb_fiberetched,
 * suf_crt_sevenlocks, suf_glb_keeping. Their effects are a later run's work.
 */

import { IAffixBatch } from '../../../../types';

export const AFFIX_BATCHES: IAffixBatch[] = [
  {
    runId: 'run_001_first_naming',
    kind: 'NAMES',
    model: 'claude-fable-5 (dev batch, Wave 10E)',
    ranAt: 1793404800000, // 2026-10-31
    names: [
      // WASTELAND — dust, salt, the sun as a slow enemy
      { id: 'pre_was_rustbitten', name: 'Rustbitten', type: 'PREFIX', theme: 'WASTELAND', allowedTags: ['melee', 'blade', 'heavy'], tier: 1 },
      { id: 'pre_was_sunflayed', name: 'Sun-Flayed', type: 'PREFIX', theme: 'WASTELAND', allowedTags: ['armor', 'light'], tier: 1 },
      { id: 'suf_was_saltwind', name: 'of the Salt Wind', type: 'SUFFIX', theme: 'WASTELAND', allowedTags: ['melee', 'ranged', 'blade'], tier: 1 },
      { id: 'suf_was_lastwell', name: 'of the Last Well', type: 'SUFFIX', theme: 'WASTELAND', allowedTags: ['armor', 'heavy', 'defense'], tier: 1 },
      { id: 'res_was_bleached', name: 'Bleached', type: 'PREFIX', theme: 'WASTELAND', allowedTags: ['resource'], tier: 1 },

      // OVERGROWTH — mire, spore, the roots that keep the books
      { id: 'pre_ovg_sporefed', name: 'Spore-Fed', type: 'PREFIX', theme: 'OVERGROWTH', allowedTags: ['melee', 'blade'], tier: 1 },
      { id: 'pre_ovg_rootbound', name: 'Rootbound', type: 'PREFIX', theme: 'OVERGROWTH', allowedTags: ['armor', 'heavy'], tier: 1 },
      { id: 'suf_ovg_mire', name: 'of the Mire', type: 'SUFFIX', theme: 'OVERGROWTH', allowedTags: ['armor', 'heavy', 'defense'], tier: 1 },
      { id: 'suf_ovg_canopy', name: 'of the Low Canopy', type: 'SUFFIX', theme: 'OVERGROWTH', allowedTags: ['light', 'evasion', 'armor'], tier: 1 },
      { id: 'res_ovg_mirecured', name: 'Mire-Cured', type: 'PREFIX', theme: 'OVERGROWTH', allowedTags: ['resource'], tier: 1 },

      // RUINS — the first bank, unpaid ledgers, echoes with interest
      { id: 'pre_rui_ledgerbound', name: 'Ledger-Bound', type: 'PREFIX', theme: 'RUINS', allowedTags: ['melee', 'ranged', 'armor'], tier: 1 },
      { id: 'pre_rui_unpaid', name: 'Unpaid', type: 'PREFIX', theme: 'RUINS', allowedTags: ['melee', 'blade', 'heavy'], tier: 2 },
      { id: 'suf_rui_firstbank', name: 'of the First Bank', type: 'SUFFIX', theme: 'RUINS', allowedTags: ['armor', 'heavy', 'defense'], tier: 1 },
      { id: 'suf_rui_echo', name: 'of the Echo', type: 'SUFFIX', theme: 'RUINS', allowedTags: ['melee', 'blade', 'light'], tier: 1 },
      { id: 'res_rui_vaultaged', name: 'Vault-Aged', type: 'PREFIX', theme: 'RUINS', allowedTags: ['resource'], tier: 1 },

      // INDUSTRIAL — slag, gantries, shifts nobody ended
      { id: 'pre_ind_slagcast', name: 'Slag-Cast', type: 'PREFIX', theme: 'INDUSTRIAL', allowedTags: ['melee', 'heavy'], tier: 1 },
      { id: 'pre_ind_gantry', name: 'Gantry-Sworn', type: 'PREFIX', theme: 'INDUSTRIAL', allowedTags: ['armor', 'heavy'], tier: 1 },
      { id: 'suf_ind_nightshift', name: 'of the Night Shift', type: 'SUFFIX', theme: 'INDUSTRIAL', allowedTags: ['melee', 'tool', 'light'], tier: 1 },
      { id: 'suf_ind_furnace', name: 'of the Cold Furnace', type: 'SUFFIX', theme: 'INDUSTRIAL', allowedTags: ['armor', 'defense'], tier: 1 },
      { id: 'res_ind_slagborn', name: 'Slag-Born', type: 'PREFIX', theme: 'INDUSTRIAL', allowedTags: ['resource'], tier: 1 },

      // CYBER CITY — dead channels, static, the last ping out
      { id: 'pre_cyb_staticlaced', name: 'Static-Laced', type: 'PREFIX', theme: 'CYBER_CITY', allowedTags: ['melee', 'ranged', 'tech', 'energy'], tier: 1 },
      { id: 'pre_cyb_gridworn', name: 'Grid-Worn', type: 'PREFIX', theme: 'CYBER_CITY', allowedTags: ['armor', 'tech'], tier: 1 },
      { id: 'suf_cyb_deadchannel', name: 'of the Dead Channel', type: 'SUFFIX', theme: 'CYBER_CITY', allowedTags: ['melee', 'ranged', 'tech', 'energy'], tier: 2 },
      { id: 'suf_cyb_lastping', name: 'of the Last Ping', type: 'SUFFIX', theme: 'CYBER_CITY', allowedTags: ['jewelry', 'tech'], tier: 1 },
      { id: 'res_cyb_fiberetched', name: 'Fiber-Etched', type: 'PREFIX', theme: 'CYBER_CITY', allowedTags: ['resource'], tier: 1 },

      // GLOBAL — the machine's own words, honored everywhere
      { id: 'pre_glb_honored', name: 'Bank-Honored', type: 'PREFIX', theme: 'GLOBAL', allowedTags: ['melee', 'ranged', 'caster', 'armor'], tier: 1 },
      { id: 'suf_glb_seeddream', name: 'of the Dreaming Seed', type: 'SUFFIX', theme: 'GLOBAL', allowedTags: ['melee', 'ranged', 'caster', 'armor', 'jewelry'], tier: 2 },
      // D22 held at the door: the one mental entry is scoped to frames ALONE
      { id: 'suf_glb_vigil', name: 'of the Long Vigil', type: 'SUFFIX', theme: 'GLOBAL', allowedTags: ['frame'], tier: 2 },
      { id: 'suf_glb_keeping', name: 'of the Keeping', type: 'SUFFIX', theme: 'GLOBAL', allowedTags: ['charm', 'scroll'], tier: 1 },

      // CART — D16's addendum: the theft risk opens the security family
      { id: 'pre_crt_warded', name: 'Warded', type: 'PREFIX', theme: 'CART', allowedTags: ['cart'], tier: 1 },
      { id: 'pre_crt_shrieking', name: 'Shrieking', type: 'PREFIX', theme: 'CART', allowedTags: ['cart'], tier: 1 },
      { id: 'suf_crt_sevenlocks', name: 'of Seven Locks', type: 'SUFFIX', theme: 'CART', allowedTags: ['cart'], tier: 3 }
    ]
  },
  {
    runId: 'run_002_given_teeth',
    kind: 'EFFECTS',
    model: 'claude-fable-5 (dev batch, Wave 10E)',
    ranAt: 1793404800001,
    effects: [
      // Downside pays for upside (D19). Negative ranges are the price tag.
      { id: 'pre_was_rustbitten', statModifiers: { damage: [6, 12], attack_speed: [-0.1, -0.05] } },
      { id: 'pre_was_sunflayed', statModifiers: { defense: [8, 16], max_health: [-15, -5] } },
      { id: 'suf_was_saltwind', statModifiers: { attack_speed: [0.08, 0.15], damage: [-3, -1] } },
      { id: 'suf_was_lastwell', statModifiers: { max_health: [20, 40], evasion_rating: [-20, -10] } },
      { id: 'res_was_bleached', statModifiers: { damage: [1, 3] } },

      { id: 'pre_ovg_sporefed', statModifiers: { damage: [5, 10], poison_damage: [2, 5] } },
      { id: 'pre_ovg_rootbound', statModifiers: { defense: [12, 20], attack_speed: [-0.12, -0.06] } },
      { id: 'suf_ovg_mire', statModifiers: { max_health: [25, 50], noise_reduction: [-4, -2] } },
      { id: 'suf_ovg_canopy', statModifiers: { evasion_rating: [25, 45], defense: [-8, -3] } },
      { id: 'res_ovg_mirecured', statModifiers: { max_health: [3, 8] } },

      { id: 'pre_rui_ledgerbound', statModifiers: { accuracy_rating: [20, 40], attack_speed: [-0.08, -0.04] } },
      { id: 'pre_rui_unpaid', statModifiers: { damage: [8, 16], max_health: [-20, -8] } },
      { id: 'suf_rui_firstbank', statModifiers: { defense: [10, 18], carry_capacity: [2, 5] } },
      { id: 'suf_rui_echo', statModifiers: { damage: [4, 8], noise_reduction: [2, 4] } },

      { id: 'pre_ind_slagcast', statModifiers: { damage: [7, 14], attack_speed: [-0.15, -0.08] } },
      { id: 'pre_ind_gantry', statModifiers: { defense: [14, 24], evasion_rating: [-25, -12] } },
      { id: 'suf_ind_nightshift', statModifiers: { attack_speed: [0.1, 0.18], light_radius: [-1, -1] } },
      { id: 'suf_ind_furnace', statModifiers: { defense: [8, 14], max_health: [10, 20] } },

      { id: 'pre_cyb_staticlaced', statModifiers: { damage: [6, 12], accuracy_rating: [-15, -8] } },
      { id: 'pre_cyb_gridworn', statModifiers: { defense: [10, 16], noise_reduction: [3, 6] } },
      { id: 'suf_cyb_deadchannel', statModifiers: { damage: [10, 18], light_radius: [-2, -1] } },
      { id: 'suf_cyb_lastping', statModifiers: { pickup_radius: [3, 6], accuracy_rating: [10, 20] } },

      { id: 'pre_glb_honored', statModifiers: { accuracy_rating: [15, 30] } },
      { id: 'suf_glb_seeddream', statModifiers: { damage: [5, 10], defense: [5, 10], max_health: [-10, -5] } },
      // The one mental record, frame-scoped by run 001 — the validator holds it to that
      { id: 'suf_glb_vigil', statModifiers: { intelligence: [2, 4], perception: [1, 3], charisma: [-2, -1] } },

      { id: 'pre_crt_warded', statModifiers: { cart_lock: [1, 3] } },
      { id: 'pre_crt_shrieking', statModifiers: { cart_alarm: [1, 1] } }
    ]
  }
];
