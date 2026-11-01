/**
 * THE FIRST THEME: the one pack the game ships, so a person with no key still has
 * a world to walk (D56). It is ordinary data, written by a dev-time run on Claude
 * Opus 5.5 under the same law every other theme stands before (D20, D53). No code
 * reads it by name, and a shipped game with more themes reads them all alike.
 *
 * Its animals (D63) were written afterwards, by hand and as data, in the voice of the
 * rest, with no model running. Adding them moved its bytes and its id on purpose: a world
 * pinned to the older bytes stays pinned to the banked pack.
 *
 * So were its elites, its `social` and `builds` words and its junk (D93, D99), by hand, the
 * same way, with the same result. And its anchors (D115), by hand again.
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
    { tag: 'seal', kind: 'element', meaning: 'What has been signed and can no longer be argued with.' },
    { tag: 'livestock', kind: 'descriptive', meaning: 'An animal people keep, or once did.' },
    { tag: 'junk', kind: 'descriptive', meaning: 'What a creature leaves that is only worth its sale.' },
    { tag: 'gem', kind: 'descriptive', meaning: 'A cut or uncut stone, kept for what it will fetch.' },
    { tag: 'art', kind: 'descriptive', meaning: 'A made thing kept for itself, and for what it will fetch.' },
    { tag: 'valuable', kind: 'descriptive', meaning: 'Something kept for what it will fetch, in any town.' }
  ],
  abilities: [
    { key: 'small_print', name: 'Small Print', blurb: 'A line too fine to dodge, flung at whoever is reading.', elements: ['debt'], delivery: 'ranged', effect: 'damage', cost: 'low' },
    { key: 'lien', name: 'Lien', blurb: 'A claim settles on the legs, and walking starts to cost.', elements: ['debt'], delivery: 'ranged', effect: 'control', cost: 'medium' },
    { key: 'compounding_bite', name: 'Compounding Bite', blurb: 'The wound is worth more every second you leave it.', elements: ['interest'], delivery: 'melee', effect: 'debuff', cost: 'low' },
    { key: 'final_notice', name: 'Final Notice', blurb: 'Everything nearby is informed, at once, and at length.', elements: ['seal'], delivery: 'area', effect: 'damage', cost: 'high' },
    { key: 'foreclose', name: 'Foreclose', blurb: 'A blow that takes the ground out from under the argument.', elements: ['seal'], delivery: 'melee', effect: 'damage', cost: 'medium' },
    { key: 'countersign', name: 'Countersign', blurb: 'A second signature over your own, and the next blow finds it binding.', elements: ['seal'], delivery: 'self', effect: 'ward', cost: 'medium' },
    { key: 'grace_period', name: 'Grace Period', blurb: 'The body is told it may pay later, and believes it.', elements: ['interest'], delivery: 'self', effect: 'heal', cost: 'low' },
    { key: 'breach_of_contract', name: 'Breach of Contract', blurb: 'Void where you stand, at a price.', elements: ['seal'], delivery: 'self', effect: 'forced_exit', cost: 'extreme' }
  ],
  creatures: [
    { key: 'tally_rat', name: 'Tally Rat', blurb: 'Counts everything it eats. Always comes up short.', tags: ['biological', 'grunt'], rank: 'F', size: 'TINY', behavior: 'SWARM', build: 'frail', threat: 'meek', pace: 'swift', habitat: ALL, innate: [], tree: 'monster', social: true, builds: false, leads: '' },
    { key: 'lien_moth', name: 'Lien Moth', blurb: 'Lands on what is owed. Ignores you, for now.', tags: ['biological', 'flying', 'grunt'], rank: 'F', size: 'TINY', behavior: 'PASSIVE', build: 'frail', threat: 'meek', pace: 'steady', habitat: ['OVERGROWTH', 'WASTELAND'], innate: [], tree: 'animal', social: true, builds: false, leads: '' },
    { key: 'dun_hound', name: 'Dun Hound', blurb: 'Bred to follow a debtor home. Very good at the first half.', tags: ['beast', 'grunt'], rank: 'E', size: 'MEDIUM', behavior: 'AGGRESSIVE', build: 'sturdy', threat: 'meek', pace: 'swift', habitat: ['WASTELAND', 'OVERGROWTH', 'RUINS'], innate: ['compounding_bite'], tree: 'monster', social: true, builds: false, leads: '' },
    { key: 'teller', name: 'Teller Still On Shift', blurb: 'Asks for two forms of identification, with a cudgel.', tags: ['humanoid', 'grunt'], rank: 'E', size: 'MEDIUM', behavior: 'AGGRESSIVE', build: 'frail', threat: 'sharp', pace: 'steady', habitat: ['RUINS', 'CYBER_CITY'], innate: [], tree: 'monster', social: true, builds: true, leads: '' },
    { key: 'receiver', name: 'Receiver', blurb: 'Here for the assets. You are listed among them.', tags: ['humanoid', 'grunt'], rank: 'D', size: 'MEDIUM', behavior: 'AGGRESSIVE', build: 'sturdy', threat: 'sharp', pace: 'steady', habitat: ['RUINS', 'INDUSTRIAL', 'CYBER_CITY'], innate: ['small_print'], tree: 'monster', social: true, builds: true, leads: '' },
    { key: 'ledger_sentry', name: 'Ledger Sentry', blurb: 'A bolted-down clerk with one question and a long reach.', tags: ['mechanical', 'grunt'], rank: 'D', size: 'MEDIUM', behavior: 'TURRET', build: 'sturdy', threat: 'sharp', pace: 'slow', habitat: ['INDUSTRIAL', 'CYBER_CITY'], innate: ['small_print'], tree: 'monster', social: false, builds: false, leads: '' },
    { key: 'compound_bear', name: 'Compound Bear', blurb: 'Grows a fixed percentage heavier every winter. It has seen a great many winters.', tags: ['beast'], rank: 'C', size: 'LARGE', behavior: 'NEUTRAL', build: 'massive', threat: 'sharp', pace: 'steady', habitat: ['OVERGROWTH'], innate: ['compounding_bite'], tree: 'animal', social: false, builds: false, leads: '' },
    { key: 'escheat_wraith', name: 'Escheat Wraith', blurb: 'What is left when an account is abandoned. It would like yours.', tags: ['horror'], rank: 'C', size: 'MEDIUM', behavior: 'AGGRESSIVE', build: 'frail', threat: 'deadly', pace: 'swift', habitat: ['RUINS', 'WASTELAND'], innate: ['lien'], tree: 'monster', social: false, builds: false, leads: '' },
    { key: 'foreclosure_engine', name: 'Foreclosure Engine', blurb: 'It has a warrant for the building, and it is already walking.', tags: ['mechanical', 'vehicle', 'armored'], rank: 'B', size: 'LARGE', behavior: 'SIEGE', build: 'massive', threat: 'deadly', pace: 'slow', habitat: ['INDUSTRIAL'], innate: ['foreclose'], tree: 'monster', social: false, builds: false, leads: '' },
    { key: 'collections_chorus', name: 'Collections Chorus', blurb: 'Many clerks, one voice, and they have your number.', tags: ['horror', 'grunt'], rank: 'A', size: 'LARGE', behavior: 'SWARM', build: 'sturdy', threat: 'sharp', pace: 'steady', habitat: ['CYBER_CITY'], innate: ['lien', 'small_print'], tree: 'monster', social: true, builds: true, leads: '' },
    { key: 'auditor_general', name: 'The Auditor General', blurb: 'Leaves you alone until the books say otherwise. They will.', tags: ['god', 'elite', 'flying'], rank: 'S', size: 'GIGANTIC', behavior: 'NEUTRAL', build: 'massive', threat: 'deadly', pace: 'swift', habitat: ['RUINS', 'CYBER_CITY'], innate: ['final_notice', 'lien'], tree: 'monster', social: false, builds: false, leads: '' },
    { key: 'dividend_hen', name: 'Dividend Hen', blurb: 'Lays on a fixed schedule and pays out in small brown instalments.', tags: ['biological', 'livestock'], rank: 'F', size: 'TINY', behavior: 'PASSIVE', build: 'frail', threat: 'meek', pace: 'steady', habitat: ['WASTELAND', 'RUINS'], innate: [], tree: 'animal', social: true, builds: false, leads: '' },
    { key: 'queue_pigeon', name: 'Queue Pigeon', blurb: 'Stands in line at windows that shut long ago. Moves up one place at dusk.', tags: ['biological', 'flying'], rank: 'F', size: 'TINY', behavior: 'PASSIVE', build: 'frail', threat: 'meek', pace: 'steady', habitat: ['RUINS', 'INDUSTRIAL', 'CYBER_CITY'], innate: [], tree: 'animal', social: true, builds: false, leads: '' },
    { key: 'collateral_goat', name: 'Collateral Goat', blurb: 'Pledged by nobody in particular. It has eaten the paperwork.', tags: ['biological', 'livestock'], rank: 'E', size: 'MEDIUM', behavior: 'PASSIVE', build: 'sturdy', threat: 'meek', pace: 'steady', habitat: ['WASTELAND'], innate: [], tree: 'animal', social: true, builds: false, leads: '' },
    { key: 'clearing_cat', name: 'Clearing Cat', blurb: 'Belongs to the building. Has never once been reconciled.', tags: ['beast'], rank: 'E', size: 'TINY', behavior: 'NEUTRAL', build: 'frail', threat: 'sharp', pace: 'swift', habitat: ['CYBER_CITY'], innate: [], tree: 'animal', social: false, builds: false, leads: '' },
    { key: 'overdraft_boar', name: 'Overdraft Boar', blurb: 'Roots up what it cannot afford. Leave it its ground and it leaves you yours.', tags: ['beast'], rank: 'E', size: 'MEDIUM', behavior: 'NEUTRAL', build: 'sturdy', threat: 'sharp', pace: 'steady', habitat: ['OVERGROWTH'], innate: [], tree: 'animal', social: true, builds: false, leads: '' },
    { key: 'pension_ox', name: 'Pension Ox', blurb: 'Retired from a plough that no longer exists. Still turns at the end of every row.', tags: ['biological', 'livestock'], rank: 'D', size: 'LARGE', behavior: 'NEUTRAL', build: 'massive', threat: 'meek', pace: 'slow', habitat: ['WASTELAND', 'INDUSTRIAL'], innate: [], tree: 'animal', social: true, builds: false, leads: '' },
    { key: 'escrow_stag', name: 'Escrow Stag', blurb: 'Holds its antlers in trust. They are released each spring, to no one.', tags: ['beast'], rank: 'D', size: 'LARGE', behavior: 'NEUTRAL', build: 'sturdy', threat: 'sharp', pace: 'swift', habitat: ['RUINS'], innate: [], tree: 'animal', social: true, builds: false, leads: '' },
    { key: 'rat_comptroller', name: 'Rat Comptroller', blurb: 'The one the others report to. It has found a discrepancy, and it is you.', tags: ['biological', 'elite'], rank: 'F', size: 'TINY', behavior: 'SWARM', build: 'sturdy', threat: 'sharp', pace: 'swift', habitat: ALL, innate: [], tree: 'monster', social: true, builds: false, leads: 'tally_rat' },
    { key: 'lead_dun', name: 'Lead Dun', blurb: 'Knows every debtor by their walk. The pack goes where it goes.', tags: ['beast', 'elite'], rank: 'E', size: 'MEDIUM', behavior: 'AGGRESSIVE', build: 'sturdy', threat: 'sharp', pace: 'swift', habitat: ['WASTELAND', 'OVERGROWTH', 'RUINS'], innate: ['compounding_bite'], tree: 'monster', social: true, builds: false, leads: 'dun_hound' },
    { key: 'branch_manager', name: 'Branch Manager', blurb: 'Will be with you shortly. Has been saying so for some time, with staff.', tags: ['humanoid', 'elite'], rank: 'D', size: 'MEDIUM', behavior: 'AGGRESSIVE', build: 'sturdy', threat: 'sharp', pace: 'steady', habitat: ['RUINS', 'CYBER_CITY'], innate: ['small_print'], tree: 'monster', social: true, builds: true, leads: 'teller' },
    { key: 'senior_receiver', name: 'Senior Receiver', blurb: 'Signs for the assets, and for whoever is standing on them.', tags: ['humanoid', 'elite'], rank: 'C', size: 'MEDIUM', behavior: 'AGGRESSIVE', build: 'massive', threat: 'sharp', pace: 'steady', habitat: ['RUINS', 'INDUSTRIAL', 'CYBER_CITY'], innate: ['small_print', 'countersign'], tree: 'monster', social: true, builds: true, leads: 'receiver' },
    { key: 'cantor_of_arrears', name: 'Cantor of Arrears', blurb: 'Gives the note. The others have never once come in late.', tags: ['horror', 'elite'], rank: 'S', size: 'LARGE', behavior: 'SWARM', build: 'massive', threat: 'sharp', pace: 'steady', habitat: ['CYBER_CITY'], innate: ['lien', 'final_notice'], tree: 'monster', social: true, builds: true, leads: 'collections_chorus' },
    { key: 'hen_of_record', name: 'Hen of Record', blurb: 'Every egg in the district is entered under her name.', tags: ['biological', 'livestock', 'elite'], rank: 'F', size: 'TINY', behavior: 'PASSIVE', build: 'sturdy', threat: 'meek', pace: 'steady', habitat: ['WASTELAND', 'RUINS'], innate: [], tree: 'animal', social: true, builds: false, leads: 'dividend_hen' },
    { key: 'old_sow', name: 'Old Sow', blurb: 'Rooted up the first overdraft. The rest are only following her credit.', tags: ['beast', 'elite'], rank: 'E', size: 'MEDIUM', behavior: 'NEUTRAL', build: 'massive', threat: 'sharp', pace: 'steady', habitat: ['OVERGROWTH'], innate: [], tree: 'animal', social: true, builds: false, leads: 'overdraft_boar' },
    { key: 'trustee_stag', name: 'Trustee Stag', blurb: 'Holds the antlers of the whole herd in trust. Nothing moves without its signature.', tags: ['beast', 'elite'], rank: 'C', size: 'LARGE', behavior: 'NEUTRAL', build: 'massive', threat: 'sharp', pace: 'swift', habitat: ['RUINS'], innate: [], tree: 'animal', social: true, builds: false, leads: 'escrow_stag' },
    { key: 'toll_assessor', name: 'Toll Assessor', blurb: 'Has a bridge, a rate, and all the time in the world. Works alone, by preference and by statute.', tags: ['humanoid', 'elite'], rank: 'D', size: 'LARGE', behavior: 'AGGRESSIVE', build: 'massive', threat: 'sharp', pace: 'slow', habitat: ['WASTELAND', 'INDUSTRIAL'], innate: [], tree: 'monster', social: false, builds: false, leads: '' }
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
    { key: 'writ_of_notice', name: 'Writ of Notice', blurb: 'Read it aloud and it serves itself on everyone in earshot.', kind: 'scroll', rank: 'E', tags: ['consumable'], casts: 'final_notice', onShelf: false },
    { key: 'writ_of_breach', name: 'Writ of Breach', blurb: 'Read it and leave. Keep the receipt.', kind: 'scroll', rank: 'C', tags: ['consumable'], casts: 'breach_of_contract', onShelf: true }
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
  ],
  junk: [
    { key: 'gnawed_receipt', name: 'Gnawed Receipt', blurb: 'The total has been eaten. The date is still good.', tags: ['junk'], rank: 'F', weight: 'light', worth: 'common', from: ['biological'] },
    { key: 'pinfeather_chit', name: 'Pinfeather Chit', blurb: 'A feather with a figure written down its spine. Someone was short of paper.', tags: ['junk'], rank: 'F', weight: 'light', worth: 'common', from: ['flying'] },
    { key: 'worn_collar_tag', name: 'Worn Collar Tag', blurb: 'Stamped with an account number and a very old address.', tags: ['junk'], rank: 'E', weight: 'light', worth: 'common', from: ['beast'] },
    { key: 'lapsed_lanyard', name: 'Lapsed Lanyard', blurb: 'Grants access to a floor nobody has been able to find.', tags: ['junk'], rank: 'E', weight: 'light', worth: 'common', from: ['humanoid'] },
    { key: 'stripped_cog', name: 'Stripped Cog', blurb: 'It kept time for a machine that kept accounts. Now it keeps neither.', tags: ['junk'], rank: 'D', weight: 'medium', worth: 'common', from: ['mechanical'] },
    { key: 'unsigned_residue', name: 'Unsigned Residue', blurb: 'What is left of a thing that was mostly a claim. It smells of toner.', tags: ['junk'], rank: 'D', weight: 'light', worth: 'fine', from: ['horror'] }
  ],
  anchors: [
    { key: 'gilt_passbook', name: 'Gilt Passbook', blurb: 'Worthless as an account. Worth a good deal as gilt.', tags: ['valuable'], rank: 'F', weight: 'light', worth: 'fine', foundIn: ALL },
    { key: 'reserve_garnet', name: 'Reserve Garnet', blurb: 'Held against a currency nobody remembers. The garnet outlived it.', tags: ['gem'], rank: 'E', weight: 'light', worth: 'rare', foundIn: ['RUINS', 'INDUSTRIAL', 'WASTELAND'] },
    { key: 'escrow_opal', name: 'Escrow Opal', blurb: 'Released to no one, and worth the same in every town that has heard of opals.', tags: ['gem'], rank: 'D', weight: 'light', worth: 'rare', foundIn: ['OVERGROWTH', 'WASTELAND', 'CYBER_CITY'] },
    { key: 'founders_portrait', name: "Founder's Portrait", blurb: 'Oil on board, the eyes following the money. Nobody has ever talked a collector down.', tags: ['art'], rank: 'D', weight: 'medium', worth: 'rare', foundIn: ['RUINS', 'CYBER_CITY'] },
    { key: 'first_depositor_bronze', name: 'Bronze of the First Depositor', blurb: 'Cast to honor a customer. It has been appraised more often than it has been dusted.', tags: ['art'], rank: 'C', weight: 'heavy', worth: 'rare', foundIn: ['RUINS', 'INDUSTRIAL'] }
  ],
  professions: [
    { key: 'lapsed_actuary', name: 'Lapsed Actuary', blurb: 'Still working out how long everyone has left, unasked.', rank: 'F', concept: 'reckoned_term', knows: 'How to say to the day when a debt, a roof or a person gives out.', workshop: 'a back room full of mortality tables', tool: ['saw'], material: ['wood'] },
    { key: 'repossession_rigger', name: 'Repossession Rigger', blurb: 'Takes machinery out of buildings that no longer agree they owe it.', rank: 'E', concept: 'seized_engine', knows: 'How to pull a running machine out of a foreclosed works and have it run again elsewhere.', workshop: 'a yard with a gantry and no questions', tool: ['blunt'], material: ['metal'] },
    { key: 'compound_forester', name: 'Compound Forester', blurb: 'Knows which trees have grown past what anyone can pay for.', rank: 'D', concept: 'felled_interest', knows: 'How to take a tree at the one moment its growth is worth more cut than standing.', workshop: 'a mill set where the wood compounds fastest', tool: ['axe'], material: ['wood'] },
    { key: 'lien_smith', name: 'Lien Smith', blurb: 'Forges a claim into a thing so it can never quite be sold clean.', rank: 'B', concept: 'binding_claim', knows: 'How to work a debt into metal, so whoever holds the piece owes what it owes.', workshop: 'a forge whose fire is on the books', tool: ['blunt'], material: ['metal'] },
    { key: 'last_auditor', name: 'Last Auditor of the First Branch', blurb: 'Reconciled everything once. Nobody has asked what it came to.', rank: 'S', concept: 'closed_books', knows: 'How to close a set of books for good, so that nothing in them can ever be owed again.', workshop: 'the vault under the queue ropes', tool: ['saw'], material: ['paper'] }
  ]
};
