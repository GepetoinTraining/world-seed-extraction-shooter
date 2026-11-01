/**
 * THE FIRST THEME: the one pack the game ships, so a person with no key still has
 * a world to walk (D56). It is ordinary data, written by a dev-time run on Claude
 * Opus 5.5 under the same law every other theme stands before (D20, D53). No code
 * reads it by name, and a shipped game with more themes reads them all alike.
 */

import { IThemeBody } from '../../../logic/theme/ThemeTypes';

const ALL: IThemeBody['creatures'][number]['habitat'] = ['WASTELAND', 'OVERGROWTH', 'RUINS', 'INDUSTRIAL', 'CYBER_CITY'];

export const FIRST_THEME: IThemeBody = {
  name: 'The Long Audit',
  premise: 'A bank outlived the world it served and kept the books anyway. Its branches still stand, still collecting, still honoring every debt to the letter, and the land between them has grown strange on what was written off.',
  regions: [
    { biome: 'WASTELAND', name: 'The Written-Off Flats', blurb: 'Ground the ledger gave up on. Nothing here is owed to anyone, and it shows.' },
    { biome: 'OVERGROWTH', name: 'The Compounding Wood', blurb: 'Trees that grow by a fixed percentage. Nobody has dared to calculate the current figure.' },
    { biome: 'RUINS', name: 'The First Branch', blurb: 'Teller windows open onto nothing. The queue ropes are still up.' },
    { biome: 'INDUSTRIAL', name: 'The Foreclosed Works', blurb: 'Seized machinery running on, in case the owner returns to pay.' },
    { biome: 'CYBER_CITY', name: 'The Clearing House', blurb: 'Every transaction ever made is still being reconciled here, out loud.' }
  ],
  tags: [
    { tag: 'debt', kind: 'element', meaning: 'What is owed, made to weigh on a body.' },
    { tag: 'interest', kind: 'element', meaning: 'What grows on its own while nobody looks.' },
    { tag: 'seal', kind: 'element', meaning: 'What has been signed and can no longer be argued with.' }
  ],
  abilities: [
    { key: 'small_print', name: 'Small Print', blurb: 'A line too fine to dodge, flung at whoever is reading.', elements: ['debt'], delivery: 'ranged', effect: 'damage', cost: 'low' },
    { key: 'lien', name: 'Lien', blurb: 'A claim settles on the legs, and walking starts to cost.', elements: ['debt'], delivery: 'ranged', effect: 'control', cost: 'medium' },
    { key: 'compounding_bite', name: 'Compounding Bite', blurb: 'The wound is worth more every second you leave it.', elements: ['interest'], delivery: 'melee', effect: 'debuff', cost: 'low' },
    { key: 'final_notice', name: 'Final Notice', blurb: 'Everything nearby is informed, at once, and at length.', elements: ['seal'], delivery: 'area', effect: 'damage', cost: 'high' },
    { key: 'foreclose', name: 'Foreclose', blurb: 'A blow that takes the ground out from under the argument.', elements: ['seal'], delivery: 'melee', effect: 'damage', cost: 'medium' },
    { key: 'countersign', name: 'Countersign', blurb: 'A second signature over your own, and the next blow finds it binding.', elements: ['seal'], delivery: 'self', effect: 'ward', cost: 'medium' },
    { key: 'grace_period', name: 'Grace Period', blurb: 'The body is told it may pay later, and believes it.', elements: ['interest'], delivery: 'self', effect: 'heal', cost: 'low' },
    { key: 'reconcile', name: 'Reconcile', blurb: 'The accounts of what stands nearby are read aloud.', elements: ['seal'], delivery: 'area', effect: 'reveal', cost: 'trivial' }
  ],
  creatures: [
    { key: 'tally_rat', name: 'Tally Rat', blurb: 'Counts everything it eats. Always comes up short.', tags: ['biological', 'grunt'], rank: 'F', size: 'TINY', behavior: 'SWARM', build: 'frail', threat: 'meek', pace: 'swift', habitat: ALL, innate: [] },
    { key: 'lien_moth', name: 'Lien Moth', blurb: 'Lands on what is owed. Ignores you, for now.', tags: ['biological', 'flying', 'grunt'], rank: 'F', size: 'TINY', behavior: 'PASSIVE', build: 'frail', threat: 'meek', pace: 'steady', habitat: ['OVERGROWTH', 'WASTELAND'], innate: [] },
    { key: 'dun_hound', name: 'Dun Hound', blurb: 'Bred to follow a debtor home. Very good at the first half.', tags: ['beast', 'grunt'], rank: 'E', size: 'MEDIUM', behavior: 'AGGRESSIVE', build: 'sturdy', threat: 'meek', pace: 'swift', habitat: ['WASTELAND', 'OVERGROWTH', 'RUINS'], innate: ['compounding_bite'] },
    { key: 'teller', name: 'Teller Still On Shift', blurb: 'Asks for two forms of identification, with a cudgel.', tags: ['humanoid', 'grunt'], rank: 'E', size: 'MEDIUM', behavior: 'AGGRESSIVE', build: 'frail', threat: 'sharp', pace: 'steady', habitat: ['RUINS', 'CYBER_CITY'], innate: [] },
    { key: 'receiver', name: 'Receiver', blurb: 'Here for the assets. You are listed among them.', tags: ['humanoid', 'grunt'], rank: 'D', size: 'MEDIUM', behavior: 'AGGRESSIVE', build: 'sturdy', threat: 'sharp', pace: 'steady', habitat: ['RUINS', 'INDUSTRIAL', 'CYBER_CITY'], innate: ['small_print'] },
    { key: 'ledger_sentry', name: 'Ledger Sentry', blurb: 'A bolted-down clerk with one question and a long reach.', tags: ['mechanical', 'grunt'], rank: 'D', size: 'MEDIUM', behavior: 'TURRET', build: 'sturdy', threat: 'sharp', pace: 'slow', habitat: ['INDUSTRIAL', 'CYBER_CITY'], innate: ['small_print'] },
    { key: 'compound_bear', name: 'Compound Bear', blurb: 'Grows a fixed percentage heavier every winter. It has seen a great many winters.', tags: ['beast'], rank: 'C', size: 'LARGE', behavior: 'NEUTRAL', build: 'massive', threat: 'sharp', pace: 'steady', habitat: ['OVERGROWTH'], innate: ['compounding_bite'] },
    { key: 'escheat_wraith', name: 'Escheat Wraith', blurb: 'What is left when an account is abandoned. It would like yours.', tags: ['horror'], rank: 'C', size: 'MEDIUM', behavior: 'AGGRESSIVE', build: 'frail', threat: 'deadly', pace: 'swift', habitat: ['RUINS', 'WASTELAND'], innate: ['lien'] },
    { key: 'foreclosure_engine', name: 'Foreclosure Engine', blurb: 'It has a warrant for the building, and it is already walking.', tags: ['mechanical', 'vehicle', 'armored'], rank: 'B', size: 'LARGE', behavior: 'SIEGE', build: 'massive', threat: 'deadly', pace: 'slow', habitat: ['INDUSTRIAL'], innate: ['foreclose'] },
    { key: 'collections_chorus', name: 'Collections Chorus', blurb: 'Many clerks, one voice, and they have your number.', tags: ['horror', 'grunt'], rank: 'A', size: 'LARGE', behavior: 'SWARM', build: 'sturdy', threat: 'sharp', pace: 'steady', habitat: ['CYBER_CITY'], innate: ['lien', 'small_print'] },
    { key: 'auditor_general', name: 'The Auditor General', blurb: 'Leaves you alone until the books say otherwise. They will.', tags: ['god', 'elite', 'flying'], rank: 'S', size: 'GIGANTIC', behavior: 'NEUTRAL', build: 'massive', threat: 'deadly', pace: 'swift', habitat: ['RUINS', 'CYBER_CITY'], innate: ['final_notice', 'lien'] }
  ],
  materials: [
    { key: 'chaffwheat', name: 'Chaffwheat', blurb: 'Grain that grew over a spilled tithe.', tags: ['flora', 'grain', 'food'], rank: 'F', form: 'grain', verb: 'hands', weight: 'light', worth: 'common', habitat: ['WASTELAND', 'OVERGROWTH'], onShelf: false },
    { key: 'accrual_berry', name: 'Accrual Berry', blurb: 'Sweeter the longer you leave it. Do not leave it.', tags: ['flora', 'berry', 'food'], rank: 'F', form: 'shrub', verb: 'hands', weight: 'light', worth: 'common', habitat: ['OVERGROWTH', 'RUINS'], onShelf: true },
    { key: 'gall_of_the_ledger', name: 'Ledger Gall', blurb: 'A bitter growth. Crushed, it writes in black.', tags: ['flora', 'fruit', 'food'], rank: 'F', form: 'fruit', verb: 'hands', weight: 'light', worth: 'common', habitat: ['OVERGROWTH', 'WASTELAND'], onShelf: true },
    { key: 'tellers_reed', name: "Teller's Reed", blurb: 'Fibrous, and it grows in neat rows no one planted.', tags: ['flora', 'fiber'], rank: 'F', form: 'grain', verb: 'hands', weight: 'light', worth: 'common', habitat: ['OVERGROWTH', 'RUINS', 'WASTELAND'], onShelf: false },
    { key: 'compound_oak', name: 'Compound Oak', blurb: 'Heavy, straight, and worth more every year it stands.', tags: ['flora', 'wood', 'building'], rank: 'F', form: 'tree', verb: 'chop', weight: 'heavy', worth: 'common', habitat: ['OVERGROWTH', 'RUINS', 'WASTELAND', 'CYBER_CITY', 'INDUSTRIAL'], onShelf: false },
    { key: 'vault_stone', name: 'Vault Stone', blurb: 'Fallen from a wall that was meant to stand forever.', tags: ['mineral', 'stone', 'building'], rank: 'F', form: 'rock', verb: 'hands', weight: 'heavy', worth: 'common', habitat: ['WASTELAND', 'RUINS', 'INDUSTRIAL', 'CYBER_CITY'], onShelf: false },
    { key: 'tally_pebble', name: 'Tally Pebble', blurb: 'Counted so many times the edges wore away.', tags: ['mineral', 'stone'], rank: 'F', form: 'pebble', verb: 'hands', weight: 'light', worth: 'common', habitat: ['WASTELAND', 'RUINS', 'OVERGROWTH'], onShelf: false },
    { key: 'counting_sand', name: 'Counting Sand', blurb: 'Fine enough to pour through any hourglass, and it remembers how long.', tags: ['mineral', 'sand'], rank: 'F', form: 'sand', verb: 'hands', weight: 'medium', worth: 'common', habitat: ['WASTELAND', 'CYBER_CITY'], onShelf: false },
    { key: 'collateral_iron', name: 'Collateral Iron', blurb: 'Ore pledged against a loan nobody remembers.', tags: ['mineral', 'ore', 'metal'], rank: 'F', form: 'vein', verb: 'mine', weight: 'heavy', worth: 'common', habitat: ['INDUSTRIAL', 'WASTELAND', 'RUINS'], onShelf: false },
    { key: 'sovereign_silver', name: 'Sovereign Silver', blurb: 'Still stamped, deep in the rock, with a face no one can name.', tags: ['mineral', 'ore', 'metal', 'rare'], rank: 'D', form: 'vein', verb: 'mine', weight: 'heavy', worth: 'rare', habitat: ['INDUSTRIAL', 'CYBER_CITY'], onShelf: false }
  ],
  stations: [
    { key: 'sawing_desk', name: 'Sawing Desk', blurb: 'A clerk\'s desk, repurposed. The drawers still lock.', tool: ['saw'], material: ['wood'], bill: [{ tag: 'wood', count: 4 }] },
    { key: 'assay_furnace', name: 'Assay Furnace', blurb: 'It tells you what the metal is really worth, and then melts it.', tool: ['blunt'], material: ['metal'], bill: [{ tag: 'stone', count: 6 }] }
  ],
  goods: [
    { key: 'ruled_plank', name: 'Ruled Plank', blurb: 'Cut straight and marked in columns.', tags: ['wood', 'building'], rank: 'F', weight: 'medium', trade: 'carpentry', station: '', from: [{ key: 'compound_oak', count: 1 }], makes: 2 },
    { key: 'dressed_block', name: 'Dressed Block', blurb: 'Vault stone squared by someone with time to kill.', tags: ['stone', 'building'], rank: 'F', weight: 'heavy', trade: 'masonry', station: '', from: [{ key: 'vault_stone', count: 2 }], makes: 1 },
    { key: 'pledged_ingot', name: 'Pledged Ingot', blurb: 'Stamped, weighed, and owed to somebody.', tags: ['metal', 'building'], rank: 'F', weight: 'medium', trade: 'smelting', station: '', from: [{ key: 'collateral_iron', count: 2 }], makes: 1 },
    { key: 'ledger_cloth', name: 'Ledger Cloth', blurb: 'Tightly woven, with a grid in the weave.', tags: ['fiber', 'cloth'], rank: 'F', weight: 'light', trade: 'weaving', station: '', from: [{ key: 'tellers_reed', count: 2 }], makes: 1 },
    { key: 'clear_pane', name: 'Clear Pane', blurb: 'Teller-window glass. Nothing gets through it but numbers.', tags: ['glass', 'building'], rank: 'F', weight: 'medium', trade: 'glassblowing', station: '', from: [{ key: 'counting_sand', count: 2 }], makes: 1 },
    { key: 'carbon_paper', name: 'Carbon Paper', blurb: 'Everything written on it is written twice.', tags: ['paper'], rank: 'F', weight: 'light', trade: 'weaving', station: '', from: [{ key: 'tellers_reed', count: 1 }], makes: 2 },
    { key: 'bookkeepers_ink', name: "Bookkeeper's Ink", blurb: 'Black, permanent, and slightly smug.', tags: ['ink'], rank: 'F', weight: 'light', trade: 'alchemy', station: '', from: [{ key: 'gall_of_the_ledger', count: 1 }], makes: 1 },
    { key: 'audit_board', name: 'Audit Board', blurb: 'Oak planed until the grain lines up with the columns.', tags: ['wood', 'building', 'heavy'], rank: 'E', weight: 'medium', trade: 'carpentry', station: 'sawing_desk', from: [{ key: 'ruled_plank', count: 2 }], makes: 1 },
    { key: 'assayed_bar', name: 'Assayed Bar', blurb: 'Tested, certified, and worth exactly what it says.', tags: ['metal', 'building', 'heavy'], rank: 'E', weight: 'heavy', trade: 'smelting', station: 'assay_furnace', from: [{ key: 'pledged_ingot', count: 2 }, { key: 'sovereign_silver', count: 1 }], makes: 1 }
  ],
  gear: [
    { key: 'letter_opener', name: 'Letter Opener', blurb: 'Opens most things.', kind: 'blade', rank: 'F', tags: [], works: [], carries: '', trigger: '', from: [], craftAt: 'none' },
    { key: 'gavel', name: 'Oversized Gavel', blurb: 'Order, by force.', kind: 'bludgeon', rank: 'F', tags: [], works: [], carries: '', trigger: '', from: [], craftAt: 'none' },
    { key: 'stonebound_club', name: 'Stone-Bound Club', blurb: 'A rock, a stick, and a grievance.', kind: 'bludgeon', rank: 'F', tags: ['improvised'], works: [], carries: '', trigger: '', from: [{ key: 'tally_pebble', count: 2 }, { key: 'tellers_reed', count: 1 }], craftAt: 'hands' },
    { key: 'ruler_bow', name: 'Steel-Rule Bow', blurb: 'Accurate to the millimeter, and proud of it.', kind: 'bow', rank: 'F', tags: [], works: [], carries: '', trigger: '', from: [], craftAt: 'none' },
    { key: 'clerks_focus', name: "Clerk's Abacus", blurb: 'Slide the beads and something, somewhere, comes due.', kind: 'focus', rank: 'F', tags: [], works: [], carries: '', trigger: '', from: [], craftAt: 'none' },
    { key: 'collectors_blade', name: "Collector's Blade", blurb: 'It has taken things from better people than you.', kind: 'blade', rank: 'E', tags: [], works: [], carries: 'compounding_bite', trigger: 'on_hit', from: [{ key: 'pledged_ingot', count: 2 }, { key: 'ruled_plank', count: 1 }], craftAt: 'bench' },
    { key: 'repossessor', name: 'The Repossessor', blurb: 'Heavy enough to count as an argument.', kind: 'bludgeon', rank: 'D', tags: [], works: [], carries: 'foreclose', trigger: 'on_defeat', from: [], craftAt: 'none' },
    { key: 'auditors_focus', name: "Auditor's Seal", blurb: 'Press it to the air, and the air complies.', kind: 'focus', rank: 'D', tags: [], works: [], carries: '', trigger: '', from: [], craftAt: 'none' },
    { key: 'visor', name: "Teller's Visor", blurb: 'Keeps the glare off the figures.', kind: 'head', rank: 'F', tags: [], works: [], carries: '', trigger: '', from: [], craftAt: 'none' },
    { key: 'waistcoat', name: 'Reinforced Waistcoat', blurb: 'Pockets on the inside; plates behind them.', kind: 'chest', rank: 'F', tags: [], works: [], carries: '', trigger: '', from: [], craftAt: 'none' },
    { key: 'pressed_trousers', name: 'Pressed Trousers', blurb: 'The crease could stop a blade. It has not been tested.', kind: 'legs', rank: 'F', tags: [], works: [], carries: '', trigger: '', from: [], craftAt: 'none' },
    { key: 'worn_oxfords', name: 'Worn Oxfords', blurb: 'They have walked out of every branch in the world.', kind: 'feet', rank: 'F', tags: [], works: [], carries: '', trigger: '', from: [], craftAt: 'none' },
    { key: 'sleeve_garters', name: 'Mantle of Sleeve Garters', blurb: 'Dignity, held up by elastic.', kind: 'shoulder', rank: 'F', tags: [], works: [], carries: '', trigger: '', from: [], craftAt: 'none' },
    { key: 'pince_nez', name: 'Pince-Nez', blurb: 'Reads the small print before it reads you.', kind: 'eyes', rank: 'F', tags: [], works: [], carries: '', trigger: '', from: [], craftAt: 'none' },
    { key: 'watch_chain', name: 'Watch Chain', blurb: 'No watch. Just the chain, and the habit of checking.', kind: 'necklace', rank: 'F', tags: [], works: [], carries: '', trigger: '', from: [], craftAt: 'none' },
    { key: 'whisper_stud', name: 'Whisper Stud', blurb: 'Lets you hear a balance change from the next room.', kind: 'earring', rank: 'F', tags: [], works: [], carries: '', trigger: '', from: [], craftAt: 'none' },
    { key: 'signet', name: 'Second-Hand Signet', blurb: 'Someone else\'s authority, slightly too large.', kind: 'ring', rank: 'F', tags: [], works: [], carries: '', trigger: '', from: [], craftAt: 'none' },
    { key: 'dart_case', name: 'Dart Case', blurb: 'Quick to the hand. It used to hold pens.', kind: 'quiver', rank: 'F', tags: [], works: [], carries: '', trigger: '', from: [], craftAt: 'none' },
    { key: 'satchel', name: "Courier's Satchel", blurb: 'Room for the whole file.', kind: 'bag', rank: 'F', tags: [], works: [], carries: '', trigger: '', from: [], craftAt: 'none' },
    { key: 'clip_belt', name: 'Clip Belt', blurb: 'Two clips, for things worth keeping close.', kind: 'belt', rank: 'F', tags: [], works: [], carries: '', trigger: '', from: [], craftAt: 'none' },
    { key: 'vial_case', name: 'Vial Case', blurb: 'Padded, numbered, and short one.', kind: 'pouch', rank: 'F', tags: [], works: [], carries: '', trigger: '', from: [], craftAt: 'none' },
    { key: 'filing_cart', name: 'Filing Cart (Folded)', blurb: 'Squeaks in one wheel. Everyone knows you are coming.', kind: 'cart', rank: 'F', tags: [], works: [], carries: '', trigger: '', from: [], craftAt: 'none' },
    { key: 'clerks_hatchet', name: "Clerk's Hatchet", blurb: 'For when the files have grown roots.', kind: 'chop_tool', rank: 'F', tags: [], works: ['wood'], carries: '', trigger: '', from: [], craftAt: 'none' },
    { key: 'claim_pick', name: 'Claim Pick', blurb: 'Stakes a claim, one blow at a time.', kind: 'mine_tool', rank: 'F', tags: [], works: ['ore', 'stone'], carries: '', trigger: '', from: [], craftAt: 'none' },
    { key: 'assayers_pick', name: "Assayer's Pick", blurb: 'Tempered for ore that does not wish to be valued.', kind: 'mine_tool', rank: 'D', tags: [], works: ['ore', 'stone'], carries: '', trigger: '', from: [], craftAt: 'none' },
    { key: 'ledger_saw', name: 'Ledger Saw', blurb: 'Teeth set to the exact width of a column.', kind: 'work_tool', rank: 'F', tags: ['saw'], works: ['wood'], carries: '', trigger: '', from: [], craftAt: 'none' },
    { key: 'stamping_hammer', name: 'Stamping Hammer', blurb: 'It has approved a great many things, none gently.', kind: 'work_tool', rank: 'F', tags: ['blunt'], works: ['metal', 'stone'], carries: '', trigger: '', from: [], craftAt: 'none' }
  ],
  consumables: [
    { key: 'interest_tonic', name: 'Interest Tonic', blurb: 'You feel better now. You will pay for it later, the label says, in a smaller font.', kind: 'heal', rank: 'F', tags: ['drink', 'consumable'], casts: '', onShelf: true },
    { key: 'grace_draught', name: 'Grace Draught', blurb: 'An extension, by the mouthful.', kind: 'heal', rank: 'D', tags: ['drink', 'consumable'], casts: '', onShelf: false },
    { key: 'writ_of_notice', name: 'Writ of Notice', blurb: 'Read it aloud and it serves itself on everyone in earshot.', kind: 'scroll', rank: 'E', tags: ['consumable'], casts: 'final_notice', onShelf: false }
  ],
  affixes: [
    { key: 'overdrawn', name: 'Overdrawn', type: 'PREFIX', allowedTags: ['melee', 'blade'], biome: 'WASTELAND', tier: 1, gives: [{ stat: 'damage', band: 'moderate', downside: false }, { stat: 'max_health', band: 'minor', downside: true }] },
    { key: 'of_the_last_payment', name: 'of the Last Payment', type: 'SUFFIX', allowedTags: ['armor', 'heavy'], biome: 'WASTELAND', tier: 1, gives: [{ stat: 'defense', band: 'moderate', downside: false }] },
    { key: 'compounding', name: 'Compounding', type: 'PREFIX', allowedTags: ['melee', 'ranged'], biome: 'OVERGROWTH', tier: 1, gives: [{ stat: 'poison_damage', band: 'moderate', downside: false }] },
    { key: 'of_the_low_canopy', name: 'of the Low Canopy', type: 'SUFFIX', allowedTags: ['armor', 'light'], biome: 'OVERGROWTH', tier: 1, gives: [{ stat: 'noise_reduction', band: 'moderate', downside: false }, { stat: 'light_radius', band: 'minor', downside: true }] },
    { key: 'countersigned', name: 'Countersigned', type: 'PREFIX', allowedTags: ['armor', 'heavy', 'light'], biome: 'RUINS', tier: 1, gives: [{ stat: 'max_health', band: 'moderate', downside: false }, { stat: 'movement_speed', band: 'minor', downside: true }] },
    { key: 'of_the_first_branch', name: 'of the First Branch', type: 'SUFFIX', allowedTags: ['melee', 'ranged', 'caster'], biome: 'RUINS', tier: 2, gives: [{ stat: 'crit_chance', band: 'moderate', downside: false }, { stat: 'crit_multiplier', band: 'minor', downside: false }] },
    { key: 'seized', name: 'Seized', type: 'PREFIX', allowedTags: ['melee', 'heavy'], biome: 'INDUSTRIAL', tier: 1, gives: [{ stat: 'damage', band: 'major', downside: false }, { stat: 'attack_speed', band: 'minor', downside: true }] },
    { key: 'of_the_night_audit', name: 'of the Night Audit', type: 'SUFFIX', allowedTags: ['jewelry', 'accessory'], biome: 'INDUSTRIAL', tier: 1, gives: [{ stat: 'field_analysis_speed', band: 'moderate', downside: false }] },
    { key: 'reconciled', name: 'Reconciled', type: 'PREFIX', allowedTags: ['ranged', 'caster'], biome: 'CYBER_CITY', tier: 1, gives: [{ stat: 'accuracy_rating', band: 'major', downside: false }] },
    { key: 'of_the_open_line', name: 'of the Open Line', type: 'SUFFIX', allowedTags: ['jewelry', 'armor'], biome: 'CYBER_CITY', tier: 1, gives: [{ stat: 'evasion_rating', band: 'moderate', downside: false }] },
    { key: 'honored', name: 'Honored', type: 'PREFIX', allowedTags: ['melee', 'ranged', 'caster', 'armor'], biome: '', tier: 1, gives: [{ stat: 'luck_find_rarity', band: 'minor', downside: false }] },
    { key: 'of_the_keeping', name: 'of the Keeping', type: 'SUFFIX', allowedTags: ['bag', 'belt'], biome: '', tier: 1, gives: [{ stat: 'carry_capacity', band: 'moderate', downside: false }] },
    { key: 'liquid', name: 'Liquid', type: 'PREFIX', allowedTags: ['boots', 'light', 'armor'], biome: '', tier: 2, gives: [{ stat: 'movement_speed', band: 'moderate', downside: false }, { stat: 'defense', band: 'minor', downside: true }] },
    { key: 'of_good_standing', name: 'of Good Standing', type: 'SUFFIX', allowedTags: ['resource'], biome: '', tier: 1, gives: [{ stat: 'upkeep_discount_pct', band: 'minor', downside: false }] },
    { key: 'vault_aged', name: 'Vault-Aged', type: 'PREFIX', allowedTags: ['resource'], biome: 'RUINS', tier: 1, gives: [{ stat: 'craft_speed_pct', band: 'minor', downside: false }] },
    { key: 'delinquent', name: 'Delinquent', type: 'PREFIX', allowedTags: ['mob'], biome: '', tier: 1, gives: [{ stat: 'damage', band: 'moderate', downside: false }] },
    { key: 'of_the_tax_year', name: 'of the Tax Year', type: 'SUFFIX', allowedTags: ['mob'], biome: '', tier: 1, gives: [{ stat: 'max_health', band: 'major', downside: false }] },
    { key: 'of_sound_mind', name: 'of Sound Mind', type: 'SUFFIX', allowedTags: ['frame'], biome: '', tier: 1, gives: [{ stat: 'focus', band: 'moderate', downside: false }] },
    { key: 'locked', name: 'Time-Locked', type: 'PREFIX', allowedTags: ['cart'], biome: '', tier: 1, gives: [{ stat: 'cart_lock', band: 'minor', downside: false }] }
  ],
  lore: [
    'Maintenance log, cycle 40,221: the branch is still open. We have stopped asking for whom.',
    'Ledger stub: 40,000 G transferred to "NULL". The bank honored it. The bank always honors it.',
    'Memo to all tellers: do not close the account of anyone currently inside the building.',
    'Notice of final notice. This is your final notice of the final notice.',
    'Field audit, page 9: the oak by the east window is now worth more than the east window.',
    'Internal, not for customers: the interest is not a metaphor. Keep the doors shut at night.',
    'Found in a queue rope: "It is my turn. It has been my turn for a very long time."',
    'Assay report: the silver remembers whose face it was stamped with. It will not say.'
  ]
};
