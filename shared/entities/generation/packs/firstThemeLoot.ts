/**
 * THE SHIPPED WORLD'S LOOT: one table to each creature of the first theme (LootLaw.ts).
 *
 * Pedro, of his own run, 2026-11-10: "getting too much money feels bad and not getting any feels bad
 * as well (the drops from the mobs are too consistent, and terrible, loot table the mobs themselves,
 * make the spread be better)". Before this a rat gave a piece of gear six kills in ten, and a hound
 * the same one piece of junk.
 *
 * Words only, in the bands a model writes in, and written by one (Claude Fable 5.2, 2026-11-10): what
 * a creature's body or habits leave often, what it carries or was eating sometimes, something worth
 * keeping seldom, something to remember rarely. Every number comes from the formula when a table is
 * sealed, and the law judges each one as it judges any other, so nothing here is trusted for being
 * shipped. Every key is one the first theme holds. Only a leader or a god drops anything always, and
 * gear from anything else is seldom or rarely.
 *
 * A world the Seed writes gets its own tables the same way, asked of the door (LootWriter.ts).
 */

import type { ILootLineWords, ILootWords } from '../../../logic/theme/LootLaw';

type Odds = ILootLineWords['odds'];
type Count = ILootLineWords['count'];
type What = ILootLineWords['what'];

const line = (what: What, item: string, odds: Odds, count: Count = 'one', rank: ILootLineWords['rank'] = 'same'): ILootLineWords => ({ what, item, odds, count, rank });
const junk = (item: string, odds: Odds, count: Count = 'one') => line('junk', item, odds, count);
const material = (item: string, odds: Odds, count: Count = 'one') => line('material', item, odds, count);
const good = (item: string, odds: Odds, count: Count = 'one') => line('good', item, odds, count);
const consumable = (item: string, odds: Odds, count: Count = 'one') => line('consumable', item, odds, count);
const gear = (item: string, odds: Odds, count: Count = 'one') => line('gear', item, odds, count);
/** Any found piece at the creature's own rank, or the nearest under it. */
const anyGear = (odds: Odds, count: Count = 'one') => line('gear', '', odds, count);

const of = (creature: string, name: string, lines: ILootLineWords[]): ILootWords => ({ name, source: 'creature', fits: [], creature, lines });

export const FIRST_THEME_LOOT: ILootWords[] = [
  // What scurries, flutters and grazes
  of('tally_rat', 'What a Tally Rat Was Eating', [
    junk('gnawed_receipt', 'often'), material('chaffwheat', 'sometimes', 'few'), material('tally_pebble', 'seldom', 'few'),
    good('carbon_paper', 'seldom'), gear('signet', 'rarely')
  ]),
  of('lien_moth', 'What a Lien Moth Had Settled On', [
    junk('pinfeather_chit', 'often'), material('tellers_reed', 'sometimes'), good('ledger_cloth', 'seldom'), gear('whisper_stud', 'rarely')
  ]),
  of('dividend_hen', 'Under a Dividend Hen', [
    junk('pinfeather_chit', 'often', 'few'), material('chaffwheat', 'sometimes', 'few'), junk('gnawed_receipt', 'seldom'), consumable('interest_tonic', 'rarely')
  ]),
  of('queue_pigeon', 'Where a Queue Pigeon Stood', [
    junk('pinfeather_chit', 'often'), material('chaffwheat', 'sometimes'), good('carbon_paper', 'seldom'), gear('watch_chain', 'rarely')
  ]),
  of('collateral_goat', 'Inside a Collateral Goat', [
    good('carbon_paper', 'often', 'few'), material('tellers_reed', 'sometimes', 'few'), junk('gnawed_receipt', 'sometimes'),
    good('ledger_cloth', 'seldom'), gear('clip_belt', 'rarely')
  ]),
  of('pension_ox', 'Off a Pension Ox', [
    material('chaffwheat', 'often', 'several'), material('tellers_reed', 'sometimes', 'several'), junk('worn_collar_tag', 'sometimes'),
    good('ledger_cloth', 'seldom', 'few'), gear('satchel', 'rarely')
  ]),

  // What hunts, and what is hunted
  of('dun_hound', 'Off a Dun Hound', [
    junk('worn_collar_tag', 'often'), junk('gnawed_receipt', 'sometimes'), consumable('interest_tonic', 'seldom'), gear('clip_belt', 'rarely')
  ]),
  of('clearing_cat', 'What a Clearing Cat Kept', [
    junk('worn_collar_tag', 'often'), junk('pinfeather_chit', 'sometimes', 'few'), gear('whisper_stud', 'seldom'), gear('signet', 'rarely')
  ]),
  of('overdraft_boar', 'What an Overdraft Boar Rooted Up', [
    material('gall_of_the_ledger', 'often', 'few'), material('accrual_berry', 'sometimes', 'few'), material('tally_pebble', 'sometimes', 'few'),
    junk('worn_collar_tag', 'seldom'), material('sovereign_silver', 'rarely')
  ]),
  of('escrow_stag', 'Held in Trust by an Escrow Stag', [
    material('accrual_berry', 'often', 'few'), junk('worn_collar_tag', 'sometimes'), gear('watch_chain', 'seldom'), consumable('grace_draught', 'rarely')
  ]),
  of('compound_bear', 'Off a Compound Bear', [
    material('accrual_berry', 'often', 'several'), material('gall_of_the_ledger', 'sometimes', 'few'), junk('worn_collar_tag', 'sometimes'),
    consumable('grace_draught', 'seldom'), anyGear('rarely')
  ]),

  // The staff
  of('teller', "A Teller's Till", [
    junk('lapsed_lanyard', 'often'), good('carbon_paper', 'sometimes', 'few'), good('bookkeepers_ink', 'sometimes'),
    consumable('interest_tonic', 'seldom'), gear('gavel', 'seldom'), gear('visor', 'rarely')
  ]),
  of('receiver', 'What a Receiver Had Seized', [
    junk('lapsed_lanyard', 'often'), good('pledged_ingot', 'sometimes', 'few'), consumable('writ_of_notice', 'seldom'),
    line('gear', '', 'seldom', 'one', 'below'), gear('repossessor', 'rarely')
  ]),
  of('ledger_sentry', 'Out of a Ledger Sentry', [
    material('collateral_iron', 'often', 'few'), good('pledged_ingot', 'sometimes'), good('clear_pane', 'sometimes'),
    gear('pince_nez', 'seldom'), good('assayed_bar', 'rarely')
  ]),
  of('escheat_wraith', 'What an Escheat Wraith Was Holding', [
    good('carbon_paper', 'often', 'few'), junk('gnawed_receipt', 'sometimes'), material('sovereign_silver', 'seldom'),
    gear('signet', 'seldom'), consumable('writ_of_breach', 'rarely')
  ]),
  of('foreclosure_engine', 'The Wreck of a Foreclosure Engine', [
    material('collateral_iron', 'often', 'several'), good('pledged_ingot', 'often', 'few'), good('assayed_bar', 'sometimes', 'few'),
    gear('stamping_hammer', 'seldom'), gear('repossessor', 'seldom'), consumable('writ_of_breach', 'rarely')
  ]),
  of('collections_chorus', 'Off the Collections Chorus', [
    junk('lapsed_lanyard', 'often', 'few'), good('carbon_paper', 'often', 'several'), consumable('writ_of_notice', 'sometimes'),
    gear('auditors_focus', 'seldom'), consumable('writ_of_breach', 'rarely')
  ]),

  // Whoever the others answer to
  of('rat_comptroller', "The Rat Comptroller's Hoard", [
    junk('gnawed_receipt', 'always', 'few'), material('chaffwheat', 'often', 'several'), good('carbon_paper', 'sometimes', 'few'),
    consumable('interest_tonic', 'sometimes'), gear('signet', 'seldom'), anyGear('seldom')
  ]),
  of('lead_dun', 'Off the Lead Dun', [
    junk('worn_collar_tag', 'always'), consumable('interest_tonic', 'sometimes'), gear('clip_belt', 'seldom'), anyGear('seldom'), consumable('grace_draught', 'rarely')
  ]),
  of('hen_of_record', 'Under the Hen of Record', [
    junk('pinfeather_chit', 'always', 'few'), material('chaffwheat', 'often', 'several'), consumable('interest_tonic', 'sometimes'),
    gear('sleeve_garters', 'seldom'), anyGear('rarely')
  ]),
  of('old_sow', 'What the Old Sow Rooted Up', [
    material('gall_of_the_ledger', 'always', 'few'), material('accrual_berry', 'often', 'several'), material('sovereign_silver', 'seldom'),
    anyGear('seldom'), consumable('grace_draught', 'rarely')
  ]),
  of('trustee_stag', 'Held in Trust by the Trustee Stag', [
    material('accrual_berry', 'always', 'few'), junk('worn_collar_tag', 'often', 'few'), gear('watch_chain', 'sometimes'),
    consumable('grace_draught', 'seldom'), anyGear('seldom'), material('sovereign_silver', 'rarely', 'few')
  ]),
  of('branch_manager', "The Branch Manager's Desk", [
    junk('lapsed_lanyard', 'always'), good('bookkeepers_ink', 'often', 'few'), consumable('interest_tonic', 'often', 'few'),
    gear('waistcoat', 'sometimes'), consumable('writ_of_notice', 'sometimes'), gear('repossessor', 'seldom'), gear('auditors_focus', 'rarely')
  ]),
  of('senior_receiver', 'What the Senior Receiver Signed For', [
    junk('lapsed_lanyard', 'always'), good('pledged_ingot', 'often', 'several'), good('assayed_bar', 'sometimes', 'few'),
    consumable('grace_draught', 'sometimes'), gear('repossessor', 'seldom'), consumable('writ_of_breach', 'seldom'), anyGear('rarely', 'few')
  ]),
  of('toll_assessor', "The Toll Assessor's Takings", [
    junk('lapsed_lanyard', 'always'), good('pledged_ingot', 'often', 'few'), good('dressed_block', 'sometimes', 'few'),
    consumable('interest_tonic', 'sometimes', 'few'), gear('satchel', 'seldom'), gear('repossessor', 'seldom'), consumable('writ_of_breach', 'rarely')
  ]),
  of('cantor_of_arrears', 'What the Cantor of Arrears Kept', [
    consumable('writ_of_notice', 'always', 'few'), good('assayed_bar', 'often', 'several'), material('sovereign_silver', 'often', 'several'),
    gear('auditors_focus', 'sometimes'), consumable('writ_of_breach', 'sometimes', 'few'), anyGear('seldom', 'few')
  ]),
  of('auditor_general', "The Auditor General's Effects", [
    gear('auditors_focus', 'always'), good('assayed_bar', 'often', 'several'), material('sovereign_silver', 'often', 'several'),
    consumable('writ_of_breach', 'sometimes', 'few'), gear('repossessor', 'sometimes'), anyGear('seldom', 'few')
  ])
];
