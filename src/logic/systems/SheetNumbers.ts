/**
 * WHAT THE LARGE SHEET SAYS (the interface pass, part 2, 2026-11-11). Pedro: "right now we have the
 * small character sheet and no big one". Every number here is a rules function's answer, never a
 * second sum: the dodge is `CombatMath.dodgeChance`, the very chance a blow rolls against, and the
 * carry limit is `LoadoutSystem.carryLimit`, the one of the three ways that counts the bag and what is
 * worn (STAT_TREES.md 9). Pure: a player in, words and numbers out.
 *
 * What the person may not know stays out (D19, D32, S2a): an unread piece worn acts, so the totals
 * hold it, but no line names it or breaks its part out; lore by category is the word the person is
 * allowed; a companion whose name was never asked is an unknown figure.
 */

import { ProgressionSystem } from '../../../shared/entities/player/systems/ProgressionSystem';
import { EquipSlotId, IItem, IPlayer } from '../../../shared/types';
import { CombatMath } from '../../entities/combat/CombatMath';
import { StatSystem } from '../../../shared/logic/systems/StatSystem';
import { LoadoutSystem } from '../../../shared/entities/player/systems/LoadoutSystem';
import { InventorySystem } from '../../../shared/entities/player/systems/InventorySystem';
import { WebSystem } from '../../../shared/logic/systems/WebSystem';
import { RESOURCE_DEFINITIONS } from '../../../shared/entities/item/data/resourceDefinitions';
import { CRAFTED_DEFINITIONS } from '../../../shared/entities/economy/data/recipeDefinitions';
import { WeaveSystem } from './WeaveSystem';
import { LoreSystem } from './LoreSystem';
import { ContactNames } from './ContactNames';
import { Escort } from './Escort';
import { said } from './SheetWords';

/** A number on the sheet: its word, its value, and what it means for the player (GV: never how it is made). */
export interface SheetRow { key: string; word: string; value: string; says: string }

/** A field tile, in the units the field draws in (`StatSystem`'s own sight is in these). */
const TILE_PX = 20;
const pct = (share: number) => `${Math.round(share * 100)}%`;

/** What the next drop would carry, at home: tools always, and whatever is marked to ride. */
const kitOf = (player: IPlayer): IItem[] =>
  (player.bank.stashTabs[0]?.items ?? []).filter(i => i.tags?.includes('tool') || player.bank.carryItemIds?.includes(i.id));

export const SheetNumbers = {
  /** The hand a hit is read from: the one the hotbar has active, as the field fires it; bare when it holds nothing. */
  hand(player: IPlayer, slot: EquipSlotId = 'RIGHT_HAND'): IItem | undefined {
    return player.equipment ? LoadoutSystem.itemIn(player.equipment, slot) : undefined;
  },

  /** The numbers of a fight, and the walk, sight and carry, each with what it means for the player. */
  fight(player: IPlayer, slot: EquipSlotId = 'RIGHT_HAND'): SheetRow[] {
    const eq = player.equipment;
    const at = player.attributes;
    const hand = this.hand(player, slot);
    const handName = hand ? LoadoutSystem.shownName(hand) : 'a bare hand';
    // SV3: the ratings are read against a blow of the person's own rank, as a fight of equals reads them
    const rank = ProgressionSystem.rankOf(player);
    const broken = !!hand && !CombatMath.isUsable(hand);
    const hit = CombatMath.baseHit(hand, eq, at, WebSystem.handPower(player, hand), rank);
    const poison = StatSystem.total(eq, 'poison_damage');
    const perSecond = 1000 / CombatMath.fireCooldownMs(hand, eq, at);
    const limit = LoadoutSystem.carryLimit(at.strength, eq);
    const load = player.currentSession ? InventorySystem.totalWeight(player.currentSession.inventory) : InventorySystem.totalWeight(kitOf(player));
    const walk = LoadoutSystem.walkOf(player);
    const slowedByLoad = player.currentSession ? InventorySystem.speedModifier(load, limit) : 1;
    const sightTiles = StatSystem.sightPx(eq, at) / TILE_PX;
    const blow = StatSystem.blowFactor(at);
    // GV: each line says what the number means for the player, never how it is made; numbers whole or to one place
    const lighter = Math.round((1 - blow) * 100);
    return [
      {
        key: 'hit', word: 'DAMAGE',
        value: `${hit} a blow, ${said(hit * perSecond)} a second${poison > 0 ? `, and ${said(poison)} poison` : ''}`,
        says: broken ? `${handName} is broken: you fight bare-handed until it is mended.` : `What ${handName === 'a bare hand' ? 'your bare hand' : `the ${handName}`} deals, before crits and glances.`
      },
      {
        key: 'often', word: 'ATTACKS',
        value: `${said(perSecond)} a second`,
        says: 'Dexterity and haste make you quicker. A draw or a wind-up still takes its time.'
      },
      {
        key: 'protection', word: 'PROTECTION',
        value: `${pct(CombatMath.mitigationOf(eq, rank))} off a blow of your rank${lighter > 0 ? `, and blows land ${lighter}% lighter` : lighter < 0 ? `, and blows land ${-lighter}% harder` : ''}`,
        says: 'From what you wear. A blow of a higher rank gets more through, and every blow does at least 1.'
      },
      {
        key: 'dodge', word: 'DODGE',
        value: pct(CombatMath.dodgeChance(eq, at, rank)),
        says: 'Blows of your rank that miss you outright. Agility and what you wear raise it; a higher rank lands more.'
      },
      {
        key: 'block', word: 'BLOCK',
        value: `${pct(CombatMath.blockChance(eq))}, letting ${pct(CombatMath.blockFactor())} through`,
        says: 'A blow you do not dodge may be blocked by what you wear.'
      },
      {
        key: 'crit', word: 'CRIT',
        value: `${pct(StatSystem.critChance(eq, at))} of hits, for ×${said(CombatMath.critMultiplier(eq))} damage`,
        says: 'Perception and what you wear raise both.'
      },
      {
        key: 'glance', word: 'GLANCE',
        value: `${pct(CombatMath.glanceChance(eq, at, rank))} of hits, for ${pct(CombatMath.glanceFactor())} damage`,
        says: 'A hit that only grazes. Dexterity and what you wear make it rarer.'
      },
      {
        key: 'walk', word: 'WALK',
        value: `${walk.toFixed(1)} tiles a second${slowedByLoad < 1 ? `, ${Math.round((1 - slowedByLoad) * 100)}% slower under this load` : ''}`,
        says: `Agility and light gear quicken it; heavy gear${(player.tonicsSinceRest ?? 0) > 0 ? ' and the tonics drunk since your rest' : ' and tonics'} slow it. A pack over 80% full slows you in the field.`
      },
      {
        key: 'sight', word: 'SIGHT',
        value: `${Math.round(sightTiles)} tile${Math.round(sightTiles) === 1 ? '' : 's'} past the screen's edge`,
        says: 'Perception and light raise it. What you have seen stays on the map.'
      },
      {
        key: 'carry', word: 'CARRY',
        value: `${said(load)} of ${said(limit)} kg${InventorySystem.loadWord(load, limit) ? `, ${InventorySystem.loadWord(load, limit)}` : ''}`,
        says: `Strength, your bag and what you wear raise it. What you wear does not count against it.${player.currentSession ? '' : ' At home: what you would take on the next drop.'}`
      }
    ];
  },

  /** Health, energy and aether, each against its maximum, and the tonics a body takes between rests. */
  vitals(player: IPlayer) {
    const maxHealth = StatSystem.maxHealth(player.attributes, player.equipment, ProgressionSystem.rankOf(player));
    const maxEnergy = StatSystem.maxEnergyOf(player);
    const cap = WeaveSystem.capacity(player.attributes, player.equipment);
    return {
      health: { now: Math.min(maxHealth, player.currentSession?.health ?? maxHealth), max: maxHealth },
      energy: { now: player.currentSession?.energy ?? player.energyToday ?? maxEnergy, max: maxEnergy },
      aether: Object.entries(player.reserves ?? {}).sort(([a], [b]) => (a < b ? -1 : 1)).map(([element, held]) => ({ element, held, max: cap })),
      tonics: { drunk: player.tonicsSinceRest ?? 0, perRest: StatSystem.tonicsPerRest(player.attributes), slow: StatSystem.tonicSlow(player.tonicsSinceRest ?? 0) }
    };
  },

  /** Worn pieces whose properties the person has not read: they act, and the sheet does not say how. */
  hiddenWorn(player: IPlayer): number {
    return StatSystem.worn(player.equipment).filter(i =>
      i.isIdentified === false || (i.affixes ?? []).some(a => !LoadoutSystem.isAffixStudied(player, a.id))).length;
  },

  /** Lore: the general purse, and each category by the word the person is allowed (S2a). */
  lore(player: IPlayer) {
    return { general: LoreSystem.held(player), byCategory: LoreSystem.shownKinds(player).map(k => ({ name: k.name, reads: k.reads })) };
  },

  /** What the hands know of each material handled: a name once known, and how far the knowing goes. */
  mastery(player: IPlayer) {
    const words = ['not yet its name', 'its name', 'its plain properties', 'what it can carry'];
    return Object.values(player.materialMastery ?? {}).map(k => {
      const def = (RESOURCE_DEFINITIONS[k.resourceId] ?? CRAFTED_DEFINITIONS[k.resourceId]) as { name?: string } | undefined;
      const level = Math.max(0, k.knowledgeLevel ?? 0);
      return {
        id: k.resourceId,
        name: level >= 1 && def?.name ? def.name : ContactNames.unknownMaterial(k.resourceId),
        level,
        knows: k.graded && level >= 2 ? `${words[Math.min(level, words.length - 1)]}, and what it can become` : words[Math.min(level, words.length - 1)] ?? words[words.length - 1]
      };
    }).sort((a, b) => b.level - a.level || (a.name < b.name ? -1 : 1));
  },

  /** Who walks with them, is carried, or follows for a while. A name is said only once it was asked. */
  companions(player: IPlayer): { name: string; how: string }[] {
    const s = player.currentSession;
    const person = (id: string, name: string) => ContactNames.personName({ id, npc: { name } as never }, player);
    return [
      ...(s?.escorts ?? []).map(e => ({ name: person(e.entityId, e.name), how: e.fallen ? 'fallen, to be carried' : `walks with you, ${Math.round(e.health)} of ${said(e.maxHealth)} health` })),
      ...(s?.inventory ?? []).filter(i => Escort.isCorpse(i)).map(i => ({ name: i.bondData ? person(i.bondData.entityId, i.bondData.sheet.name) : 'someone', how: 'carried to the beacon' })),
      ...(s?.tamed ?? []).map(t => ({ name: LoadoutSystem.shownName(t.item), how: 'tamed, following for a while' }))
    ];
  },

  /** What waits at the next rest, counted. What a making came to is nobody's to know before it. */
  atRest(player: IPlayer): { key: string; word: string; count: number }[] {
    const q = player.restQueue;
    return [
      { key: 'made', word: 'things made, read when you rest', count: q?.made?.length ?? 0 },
      { key: 'sittings', word: 'study sittings to settle', count: q?.sittings?.length ?? 0 },
      { key: 'studies', word: 'studies to settle', count: q?.studies?.length ?? 0 },
      { key: 'weaves', word: 'workings cast, to be named', count: q?.weaves?.length ?? 0 },
      { key: 'met', word: 'people met, to remember', count: q?.met?.length ?? 0 },
      { key: 'ground', word: 'ground walked, to remember', count: q?.ground?.length ?? 0 },
      { key: 'tonics', word: 'tonics drunk, cleared by the rest', count: player.tonicsSinceRest ?? 0 }
    ];
  },

  /** What is working on the body now, in words: statuses, effects on the clock, and a tonic's slow. */
  statuses(player: IPlayer, now = Date.now()): string[] {
    const s = player.currentSession;
    const slow = StatSystem.tonicSlow(player.tonicsSinceRest ?? 0);
    return [
      ...(s?.statusEffects ?? []).map(e => e.replace(/_/g, ' ').toLowerCase()),
      ...(s?.activeEffects ?? []).filter(e => e.until > now).map(e => `${e.kind.replace(/_/g, ' ').toLowerCase()}, ${Math.ceil((e.until - now) / 1000)}s left`),
      ...(slow > 0 ? [`tonics: ${pct(slow)} slower until you rest`] : [])
    ];
  }
};
