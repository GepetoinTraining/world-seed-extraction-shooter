import { IAffixBatch } from '../../../types';


export const TEST_AFFIX_BATCHES: IAffixBatch[] = [
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
  },
  // THE RAW MATERIALS LEG (D23, D26): what a transformation step adds. Banked
  // under the same law as everything above, in the same two runs: names first,
  // then effects. Their theme is PROCESS, which no biome, GLOBAL or CART pool
  // reads, so they can never reach a drop, a chest, a harvest, a survey or the
  // shelf, and a world pinned before them compiles without them. allowedTags
  // names the trade; tier is the pool, opened by rank and rarity (ProcessSystem).
  {
    runId: 'run_003_the_working_named',
    kind: 'NAMES',
    model: 'claude-opus-5-5 (dev batch, raw materials leg)',
    ranAt: 1793404800002,
    names: [
      // CARPENTRY: wood worked until it remembers being asked
      { id: 'prc_car_seasoned', name: 'Seasoned', type: 'PREFIX', theme: 'PROCESS', allowedTags: ['process_carpentry'], tier: 1 },
      { id: 'prc_car_greencut', name: 'Green-Cut', type: 'PREFIX', theme: 'PROCESS', allowedTags: ['process_carpentry'], tier: 1 },
      { id: 'prc_car_truegrain', name: 'of the True Grain', type: 'SUFFIX', theme: 'PROCESS', allowedTags: ['process_carpentry'], tier: 1 },
      { id: 'prc_car_heartwood', name: 'Heartwood', type: 'PREFIX', theme: 'PROCESS', allowedTags: ['process_carpentry'], tier: 2 },
      { id: 'prc_car_longplane', name: 'of the Long Plane', type: 'SUFFIX', theme: 'PROCESS', allowedTags: ['process_carpentry'], tier: 2 },
      { id: 'prc_car_ironbark', name: 'Ironbark', type: 'PREFIX', theme: 'PROCESS', allowedTags: ['process_carpentry'], tier: 3 },
      { id: 'prc_car_quietjoint', name: 'of the Quiet Joint', type: 'SUFFIX', theme: 'PROCESS', allowedTags: ['process_carpentry'], tier: 3 },
      { id: 'prc_car_oldgrowth', name: 'Old-Growth', type: 'PREFIX', theme: 'PROCESS', allowedTags: ['process_carpentry'], tier: 4 },
      // SMELTING: ore burned clean, the first honest fire
      { id: 'prc_sme_cleanpoured', name: 'Clean-Poured', type: 'PREFIX', theme: 'PROCESS', allowedTags: ['process_smelting'], tier: 1 },
      { id: 'prc_sme_slagshot', name: 'Slag-Shot', type: 'PREFIX', theme: 'PROCESS', allowedTags: ['process_smelting'], tier: 1 },
      { id: 'prc_sme_firstheat', name: 'of the First Heat', type: 'SUFFIX', theme: 'PROCESS', allowedTags: ['process_smelting'], tier: 1 },
      { id: 'prc_sme_bloomforged', name: 'Bloom-Forged', type: 'PREFIX', theme: 'PROCESS', allowedTags: ['process_smelting'], tier: 2 },
      { id: 'prc_sme_slowcooling', name: 'of the Slow Cooling', type: 'SUFFIX', theme: 'PROCESS', allowedTags: ['process_smelting'], tier: 2 },
      { id: 'prc_sme_whitehot', name: 'White-Hot', type: 'PREFIX', theme: 'PROCESS', allowedTags: ['process_smelting'], tier: 3 },
      { id: 'prc_sme_heldedge', name: 'of the Held Edge', type: 'SUFFIX', theme: 'PROCESS', allowedTags: ['process_smelting'], tier: 3 },
      { id: 'prc_sme_starpoured', name: 'Star-Poured', type: 'PREFIX', theme: 'PROCESS', allowedTags: ['process_smelting'], tier: 4 },
      // WEAVING: fibre taught to hold its own shape
      { id: 'prc_wea_closewoven', name: 'Close-Woven', type: 'PREFIX', theme: 'PROCESS', allowedTags: ['process_weaving'], tier: 1 },
      { id: 'prc_wea_looselaid', name: 'Loose-Laid', type: 'PREFIX', theme: 'PROCESS', allowedTags: ['process_weaving'], tier: 1 },
      { id: 'prc_wea_evenwarp', name: 'of the Even Warp', type: 'SUFFIX', theme: 'PROCESS', allowedTags: ['process_weaving'], tier: 1 },
      { id: 'prc_wea_doubletwill', name: 'Double-Twill', type: 'PREFIX', theme: 'PROCESS', allowedTags: ['process_weaving'], tier: 2 },
      { id: 'prc_wea_patientloom', name: 'of the Patient Loom', type: 'SUFFIX', theme: 'PROCESS', allowedTags: ['process_weaving'], tier: 2 },
      { id: 'prc_wea_spidertaut', name: 'Spider-Taut', type: 'PREFIX', theme: 'PROCESS', allowedTags: ['process_weaving'], tier: 3 },
      { id: 'prc_wea_lostpattern', name: 'of the Lost Pattern', type: 'SUFFIX', theme: 'PROCESS', allowedTags: ['process_weaving'], tier: 3 },
      { id: 'prc_wea_bankthread', name: 'Bank-Thread', type: 'PREFIX', theme: 'PROCESS', allowedTags: ['process_weaving'], tier: 4 },
      // GLASSBLOWING: sand, breath, and a long cooling
      { id: 'prc_gla_clearblown', name: 'Clear-Blown', type: 'PREFIX', theme: 'PROCESS', allowedTags: ['process_glassblowing'], tier: 1 },
      { id: 'prc_gla_seeded', name: 'Seeded', type: 'PREFIX', theme: 'PROCESS', allowedTags: ['process_glassblowing'], tier: 1 },
      { id: 'prc_gla_steadybreath', name: 'of the Steady Breath', type: 'SUFFIX', theme: 'PROCESS', allowedTags: ['process_glassblowing'], tier: 1 },
      { id: 'prc_gla_annealed', name: 'Annealed', type: 'PREFIX', theme: 'PROCESS', allowedTags: ['process_glassblowing'], tier: 2 },
      { id: 'prc_gla_noonlight', name: 'of the Noon Light', type: 'SUFFIX', theme: 'PROCESS', allowedTags: ['process_glassblowing'], tier: 2 },
      { id: 'prc_gla_leaded', name: 'Leaded', type: 'PREFIX', theme: 'PROCESS', allowedTags: ['process_glassblowing'], tier: 3 },
      { id: 'prc_gla_truelens', name: 'of the True Lens', type: 'SUFFIX', theme: 'PROCESS', allowedTags: ['process_glassblowing'], tier: 3 },
      { id: 'prc_gla_seedglass', name: 'Seed-Glass', type: 'PREFIX', theme: 'PROCESS', allowedTags: ['process_glassblowing'], tier: 4 },
      // ALCHEMY: what the boil leaves behind
      { id: 'prc_alc_boiledblack', name: 'Boiled-Black', type: 'PREFIX', theme: 'PROCESS', allowedTags: ['process_alchemy'], tier: 1 },
      { id: 'prc_alc_bitter', name: 'Bitter', type: 'PREFIX', theme: 'PROCESS', allowedTags: ['process_alchemy'], tier: 1 },
      { id: 'prc_alc_slowsimmer', name: 'of the Slow Simmer', type: 'SUFFIX', theme: 'PROCESS', allowedTags: ['process_alchemy'], tier: 1 },
      { id: 'prc_alc_tannic', name: 'Tannic', type: 'PREFIX', theme: 'PROCESS', allowedTags: ['process_alchemy'], tier: 2 },
      { id: 'prc_alc_signedhand', name: 'of the Signed Hand', type: 'SUFFIX', theme: 'PROCESS', allowedTags: ['process_alchemy'], tier: 2 },
      { id: 'prc_alc_errorcoded', name: 'Error-Coded', type: 'PREFIX', theme: 'PROCESS', allowedTags: ['process_alchemy'], tier: 3 },
      { id: 'prc_alc_quietreagent', name: 'of the Quiet Reagent', type: 'SUFFIX', theme: 'PROCESS', allowedTags: ['process_alchemy'], tier: 3 },
      { id: 'prc_alc_ledgerblack', name: 'Ledger-Black', type: 'PREFIX', theme: 'PROCESS', allowedTags: ['process_alchemy'], tier: 4 },
      // MASONRY: stone asked to stop being a rock
      { id: 'prc_mas_squared', name: 'Squared', type: 'PREFIX', theme: 'PROCESS', allowedTags: ['process_masonry'], tier: 1 },
      { id: 'prc_mas_quickdressed', name: 'Quick-Dressed', type: 'PREFIX', theme: 'PROCESS', allowedTags: ['process_masonry'], tier: 1 },
      { id: 'prc_mas_truecourse', name: 'of the True Course', type: 'SUFFIX', theme: 'PROCESS', allowedTags: ['process_masonry'], tier: 1 },
      { id: 'prc_mas_bedded', name: 'Bedded', type: 'PREFIX', theme: 'PROCESS', allowedTags: ['process_masonry'], tier: 2 },
      { id: 'prc_mas_plumbline', name: 'of the Plumb Line', type: 'SUFFIX', theme: 'PROCESS', allowedTags: ['process_masonry'], tier: 2 },
      { id: 'prc_mas_keyed', name: 'Keyed', type: 'PREFIX', theme: 'PROCESS', allowedTags: ['process_masonry'], tier: 3 },
      { id: 'prc_mas_firstwall', name: 'of the First Wall', type: 'SUFFIX', theme: 'PROCESS', allowedTags: ['process_masonry'], tier: 3 },
      { id: 'prc_mas_foundationcut', name: 'Foundation-Cut', type: 'PREFIX', theme: 'PROCESS', allowedTags: ['process_masonry'], tier: 4 },
      // SMITHING: iron given a purpose, and a price
      { id: 'prc_smi_hammertrue', name: 'Hammer-True', type: 'PREFIX', theme: 'PROCESS', allowedTags: ['process_smithing'], tier: 1 },
      { id: 'prc_smi_overdrawn', name: 'Overdrawn', type: 'PREFIX', theme: 'PROCESS', allowedTags: ['process_smithing'], tier: 1 },
      { id: 'prc_smi_coldfinish', name: 'of the Cold Finish', type: 'SUFFIX', theme: 'PROCESS', allowedTags: ['process_smithing'], tier: 1 },
      { id: 'prc_smi_balanced', name: 'Balanced', type: 'PREFIX', theme: 'PROCESS', allowedTags: ['process_smithing'], tier: 2 },
      { id: 'prc_smi_secondquench', name: 'of the Second Quench', type: 'SUFFIX', theme: 'PROCESS', allowedTags: ['process_smithing'], tier: 2 },
      { id: 'prc_smi_patternwelded', name: 'Pattern-Welded', type: 'PREFIX', theme: 'PROCESS', allowedTags: ['process_smithing'], tier: 3 },
      { id: 'prc_smi_unpaidhour', name: 'of the Unpaid Hour', type: 'SUFFIX', theme: 'PROCESS', allowedTags: ['process_smithing'], tier: 3 },
      { id: 'prc_smi_bankproved', name: 'Bank-Proved', type: 'PREFIX', theme: 'PROCESS', allowedTags: ['process_smithing'], tier: 4 }
    ]
  },
  {
    runId: 'run_004_given_hands',
    kind: 'EFFECTS',
    model: 'claude-opus-5-5 (dev batch, raw materials leg)',
    ranAt: 1793404800003,
    effects: [
      // Every entry has a gear half and a room half (ROOM_ACTING_STATS): the same
      // addition acts as a sword's edge in a sword and as a wall's keep in a wall.
      // carpentry
      { id: 'prc_car_seasoned', statModifiers: { defense: [1, 3], upkeep_discount_pct: [2, 4] } },
      { id: 'prc_car_greencut', statModifiers: { damage: [1, 3], craft_speed_pct: [3, 6], upkeep_discount_pct: [-3, -1] } },
      { id: 'prc_car_truegrain', statModifiers: { accuracy_rating: [3, 8], craft_speed_pct: [1, 3] } },
      { id: 'prc_car_heartwood', statModifiers: { defense: [3, 6], max_health: [3, 8], upkeep_discount_pct: [3, 6] } },
      { id: 'prc_car_longplane', statModifiers: { attack_speed: [0.02, 0.05], craft_speed_pct: [3, 6] } },
      { id: 'prc_car_ironbark', statModifiers: { defense: [6, 12], attack_speed: [-0.06, -0.03], upkeep_discount_pct: [5, 9] } },
      { id: 'prc_car_quietjoint', statModifiers: { noise_reduction: [2, 4], craft_speed_pct: [4, 8] } },
      { id: 'prc_car_oldgrowth', statModifiers: { defense: [10, 18], max_health: [10, 20], upkeep_discount_pct: [7, 12], craft_speed_pct: [4, 8] } },
      // smelting
      { id: 'prc_sme_cleanpoured', statModifiers: { damage: [1, 3], craft_speed_pct: [2, 4] } },
      { id: 'prc_sme_slagshot', statModifiers: { damage: [2, 5], accuracy_rating: [-6, -2], upkeep_discount_pct: [1, 3] } },
      { id: 'prc_sme_firstheat', statModifiers: { defense: [1, 3], upkeep_discount_pct: [1, 3] } },
      { id: 'prc_sme_bloomforged', statModifiers: { damage: [3, 7], craft_speed_pct: [3, 6] } },
      { id: 'prc_sme_slowcooling', statModifiers: { defense: [3, 7], upkeep_discount_pct: [3, 5] } },
      { id: 'prc_sme_whitehot', statModifiers: { damage: [6, 12], max_health: [-10, -4], craft_speed_pct: [6, 10] } },
      { id: 'prc_sme_heldedge', statModifiers: { accuracy_rating: [10, 20], upkeep_discount_pct: [4, 8] } },
      { id: 'prc_sme_starpoured', statModifiers: { damage: [10, 20], defense: [8, 14], craft_speed_pct: [6, 12], upkeep_discount_pct: [5, 9] } },
      // weaving
      { id: 'prc_wea_closewoven', statModifiers: { defense: [1, 2], upkeep_discount_pct: [1, 3] } },
      { id: 'prc_wea_looselaid', statModifiers: { evasion_rating: [3, 8], defense: [-2, -1], craft_speed_pct: [2, 4] } },
      { id: 'prc_wea_evenwarp', statModifiers: { max_health: [2, 5], craft_speed_pct: [1, 3] } },
      { id: 'prc_wea_doubletwill', statModifiers: { defense: [2, 5], carry_capacity: [1, 2], upkeep_discount_pct: [2, 5] } },
      { id: 'prc_wea_patientloom', statModifiers: { evasion_rating: [6, 12], craft_speed_pct: [3, 6] } },
      { id: 'prc_wea_spidertaut', statModifiers: { evasion_rating: [10, 18], max_health: [-8, -3], craft_speed_pct: [5, 9] } },
      { id: 'prc_wea_lostpattern', statModifiers: { noise_reduction: [2, 4], upkeep_discount_pct: [4, 7] } },
      { id: 'prc_wea_bankthread', statModifiers: { defense: [6, 12], evasion_rating: [10, 20], upkeep_discount_pct: [6, 10], craft_speed_pct: [4, 8] } },
      // glassblowing
      { id: 'prc_gla_clearblown', statModifiers: { accuracy_rating: [3, 6], upkeep_discount_pct: [1, 3] } },
      { id: 'prc_gla_seeded', statModifiers: { light_radius: [1, 1], defense: [-2, -1], craft_speed_pct: [2, 5] } },
      { id: 'prc_gla_steadybreath', statModifiers: { accuracy_rating: [2, 5], craft_speed_pct: [1, 3] } },
      { id: 'prc_gla_annealed', statModifiers: { defense: [2, 5], upkeep_discount_pct: [3, 5] } },
      { id: 'prc_gla_noonlight', statModifiers: { light_radius: [1, 2], craft_speed_pct: [3, 6] } },
      { id: 'prc_gla_leaded', statModifiers: { defense: [5, 10], attack_speed: [-0.05, -0.02], upkeep_discount_pct: [4, 8] } },
      { id: 'prc_gla_truelens', statModifiers: { accuracy_rating: [10, 18], craft_speed_pct: [5, 8] } },
      { id: 'prc_gla_seedglass', statModifiers: { light_radius: [2, 3], accuracy_rating: [12, 22], craft_speed_pct: [6, 12], upkeep_discount_pct: [4, 8] } },
      // alchemy
      { id: 'prc_alc_boiledblack', statModifiers: { poison_damage: [1, 2], upkeep_discount_pct: [1, 3] } },
      { id: 'prc_alc_bitter', statModifiers: { poison_damage: [1, 3], max_health: [-4, -1], craft_speed_pct: [3, 5] } },
      { id: 'prc_alc_slowsimmer', statModifiers: { max_health: [2, 4], craft_speed_pct: [1, 3] } },
      { id: 'prc_alc_tannic', statModifiers: { defense: [2, 4], poison_damage: [1, 3], upkeep_discount_pct: [2, 5] } },
      { id: 'prc_alc_signedhand', statModifiers: { accuracy_rating: [5, 10], craft_speed_pct: [3, 6] } },
      { id: 'prc_alc_errorcoded', statModifiers: { poison_damage: [3, 6], noise_reduction: [-3, -1], craft_speed_pct: [5, 9] } },
      { id: 'prc_alc_quietreagent', statModifiers: { max_health: [6, 12], upkeep_discount_pct: [4, 7] } },
      { id: 'prc_alc_ledgerblack', statModifiers: { poison_damage: [5, 9], accuracy_rating: [10, 18], craft_speed_pct: [5, 10], upkeep_discount_pct: [5, 9] } },
      // masonry
      { id: 'prc_mas_squared', statModifiers: { defense: [1, 3], upkeep_discount_pct: [2, 4] } },
      { id: 'prc_mas_quickdressed', statModifiers: { damage: [1, 2], craft_speed_pct: [2, 5], upkeep_discount_pct: [-2, -1] } },
      { id: 'prc_mas_truecourse', statModifiers: { defense: [1, 2], upkeep_discount_pct: [1, 3] } },
      { id: 'prc_mas_bedded', statModifiers: { defense: [3, 7], upkeep_discount_pct: [3, 6] } },
      { id: 'prc_mas_plumbline', statModifiers: { accuracy_rating: [4, 9], craft_speed_pct: [2, 5] } },
      { id: 'prc_mas_keyed', statModifiers: { defense: [7, 13], attack_speed: [-0.05, -0.02], upkeep_discount_pct: [5, 9] } },
      { id: 'prc_mas_firstwall', statModifiers: { max_health: [6, 14], upkeep_discount_pct: [4, 8] } },
      { id: 'prc_mas_foundationcut', statModifiers: { defense: [12, 20], max_health: [10, 18], upkeep_discount_pct: [8, 12], craft_speed_pct: [3, 6] } },
      // smithing
      { id: 'prc_smi_hammertrue', statModifiers: { damage: [1, 3], craft_speed_pct: [1, 2] } },
      { id: 'prc_smi_overdrawn', statModifiers: { damage: [2, 4], attack_speed: [-0.04, -0.02], upkeep_discount_pct: [1, 2] } },
      { id: 'prc_smi_coldfinish', statModifiers: { defense: [1, 2], craft_speed_pct: [1, 2] } },
      { id: 'prc_smi_balanced', statModifiers: { attack_speed: [0.02, 0.05], craft_speed_pct: [2, 4] } },
      { id: 'prc_smi_secondquench', statModifiers: { damage: [3, 6], upkeep_discount_pct: [2, 4] } },
      { id: 'prc_smi_patternwelded', statModifiers: { damage: [6, 12], accuracy_rating: [6, 12], craft_speed_pct: [3, 6] } },
      { id: 'prc_smi_unpaidhour', statModifiers: { damage: [8, 14], max_health: [-10, -4], upkeep_discount_pct: [3, 6] } },
      { id: 'prc_smi_bankproved', statModifiers: { damage: [12, 22], attack_speed: [0.04, 0.08], craft_speed_pct: [5, 9], upkeep_discount_pct: [4, 8] } }
    ]
  }
];
