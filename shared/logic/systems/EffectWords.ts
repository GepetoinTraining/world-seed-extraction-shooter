/**
 * WHAT A WORKING DOES, AND HOW IT REACHES, IN A PLAYER'S WORDS (GV, 2026-11-12; one table since CP16, 2026-11-13).
 *
 * The closed grammar of a working (`EFFECTS`, `DELIVERIES` in ThemeTypes) said once: a gift's line (`SkillSay.gift`)
 * and The Working's preview read these, where each once kept its own copy. Every effect and every delivery has a word
 * (typed by the lists, so a new one fails the build until it does); anything else reads as plain words.
 */

import { DELIVERIES, EFFECTS } from '../theme/ThemeTypes';

const EFFECT_WORDS: Record<(typeof EFFECTS)[number], string> = {
  damage: 'hurts what it reaches', control: 'slows what it reaches', heal: 'mends you', buff: 'quickens you',
  debuff: 'keeps hurting what it reaches', ward: 'wards off the next blows', rest: 'rests you', forced_exit: 'pulls you out'
};

const DELIVERY_WORDS: Record<(typeof DELIVERIES)[number], string> = {
  self: 'on yourself', touch: 'by touch', melee: 'up close', ranged: 'from afar', area: 'all around a spot', aura: 'all around you'
};

const plain = (key: string | undefined) => (key ?? '').replace(/_/g, ' ');

/** What a working does, said: "hurts what it reaches". */
export const effectWord = (effect: string | undefined): string =>
  EFFECT_WORDS[effect as (typeof EFFECTS)[number]] ?? plain(effect);

/** How a working reaches, said: "from afar". */
export const deliveryWord = (delivery: string | undefined): string =>
  DELIVERY_WORDS[delivery as (typeof DELIVERIES)[number]] ?? plain(delivery);
