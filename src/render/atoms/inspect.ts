/**
 * One inspect card for everything: what it is, what you know of it, what you would
 * need to act on it. What can be done is asked of the game's own InteractionEngine;
 * the card only explains the answer. Hover and keyboard share one target list.
 */

import { bodyLawOf } from '../../../shared/entities/mob/BodyLaw';
import { PieceLaw } from '../../../shared/logic/theme/PieceLaw';
import { EquipSlotId, IItem, IPlayer, InteractionType, ItemType, MENTAL_ATTRIBUTES } from '../../../shared/types';
import { InteractionEngine } from '../../entities/interaction/InteractionEngine';
import { MOB_DEFINITIONS } from '../../../shared/entities/mob/data/mobDefinitions';
import { RESOURCE_DEFINITIONS } from '../../../shared/entities/item/data/resourceDefinitions';
import { Spread, SpreadBook, formOf } from '../../../shared/entities/world/Spread';
import { ExtractLaw } from '../../../shared/logic/systems/ExtractLaw';
import { isLooseStone } from '../../../shared/entities/item/Throwable';
import { CRAFTED_DEFINITIONS } from '../../../shared/entities/economy/data/recipeDefinitions';
import { EntityType, IWorldEntity } from '../../../shared/entities/world/types';
import { QUALITY_NAMES, qualityBand } from '../../../shared/render/atoms/atoms';
import { Escort } from '../../logic/systems/Escort';
import { LAYER } from './world';
import { LoadoutSystem } from '../../../shared/entities/player/systems/LoadoutSystem';
import { CombatMath } from '../../entities/combat/CombatMath';
import { setBonusText } from '../../../shared/entities/hub/template';
import { IRoomState, roomAdditions } from '../../../shared/entities/hub/room';
import { WebSystem } from '../../../shared/logic/systems/WebSystem';
import { NpcSheet } from '../../../shared/logic/systems/NpcSheet';
import { SurveySystem } from '../../logic/systems/SurveySystem';
import { ContactNames } from '../../logic/systems/ContactNames';
import { WorldDeed } from '../../logic/systems/WorldDeed';
import { WorldClock } from '../../entities/world/WorldClock';
import { GameClock } from '../../logic/time/GameClock';

export interface Card {
  title: string;
  rows: [string, string][];
  needs: string[];
  canAct: boolean;
  compact: string;
}

export interface InspectContext {
  player: IPlayer;
  dist: number;
  level: (definitionId: string) => number;
  /** D27: what it takes to read a person's sheet back. */
  worldSeed?: string;
  webVersion?: number;
  /** The game's clock, read when absent: what a place coming back says is how long until its turn. */
  now?: number;
}

/** RG: what a spent place says to whoever walks up to it, in words: that it comes back, and when. */
function returnsSaid(e: IWorldEntity, def: any, now: number): string {
  if (e.returning) {
    const left = e.returning.at !== undefined && Number.isFinite(e.returning.at) ? e.returning.at - now : NaN;
    return Number.isFinite(left) && left > 0 ? `Spent. Comes back when the gate turns, in ${WorldClock.say(left)}` : 'Spent. Comes back when the gate turns';
  }
  return def?.regrowMs ? 'Spent, will return' : 'Spent, never returns';
}

const COMPACT_MAX = 36;
const HARVEST_RANGE = 3;
const EXIT_RANGE = 3;
const PROPERTY_NAMES: Record<string, string> = {
  DENSITY: 'Density', HARDNESS: 'Hardness', CONDUCTIVITY: 'Conductivity', RESONANCE: 'Resonance',
  LUMINOSITY: 'Luminosity', TOXICITY: 'Toxicity', ELASTICITY: 'Elasticity'
};

const toolPower = (item: IItem) => item.stats['mining_power'] || item.stats['chopping_power'] || 0;
const words = (tags: string[]) => tags.map(t => t.replace(/_/g, ' ')).join(', ').replace(/, ([^,]*)$/, ' or $1');

function compact(title: string, tail: string): string {
  const room = COMPACT_MAX - tail.length - 3;
  return `${title.length > room ? `${title.slice(0, room - 1)}.` : title} · ${tail}`;
}

function inspectResource(e: IWorldEntity, ctx: InspectContext): Card {
  const def = RESOURCE_DEFINITIONS[e.definitionId] as any;
  const level = ctx.level(e.definitionId);
  const config = def?.harvestConfig;
  const uses = e.usesRemaining ?? def?.uses ?? 1;
  const canAct = InteractionEngine.getAvailableInteractions(ctx.player, e, ctx.dist).some(o => o.type === InteractionType.HARVEST);

  const needs: string[] = [];
  if (uses <= 0) needs.push(returnsSaid(e, def, ctx.now ?? GameClock.now()));
  else if (config) {
    const required: string[] = config.requiredToolTags;
    if (required.length > 0) {
      const tools = (ctx.player.currentSession?.inventory || []).filter(i =>
        required.some(t => i.toolData?.toolTags.includes(t) || (i.tags || []).includes(t) || i.name.toLowerCase().includes(t)));
      const best = tools.reduce((n, t) => Math.max(n, toolPower(t)), 0);
      if (tools.length === 0) needs.push(level >= 1 ? `Needs ${words(required)}` : 'Needs a tool');
      // ML: a weaker tool may still try a stone that is a pebble to pick up; anything else is the try's, and its odds say how it stands
      else if (best < config.minToolPower && isLooseStone(def)) needs.push(level >= 1 ? `Needs power ${config.minToolPower}, yours ${best}` : 'Needs a stronger tool');
    }
    if (ctx.dist >= HARVEST_RANGE) needs.push('Move closer');
  }

  const rows: [string, string][] = [];
  // ML: a variant's marks are plain to see, known or not, and said in words as well as drawn
  const spread = SpreadBook.of(e.definitionId);
  if (spread.base && spread.marks.length > 0) rows.push(['Looks', `Like any ${formOf(def) ?? 'other of its kind'}, but with ${Spread.said(spread.marks)}`]);
  if (level <= 0) rows.push(['Known', 'Nothing yet. Study it to learn']);
  else {
    rows.push(['Rank', String(def.rank)]);
    // RG: a place that came back may hold more than its kind's own
    if (def.uses) rows.push(['Left', uses > def.uses ? `${uses}, more than most` : `${Math.max(0, uses)} of ${def.uses}`]);
    // RG: a place that came back was rolled anew, and says what it came back as
    if (e.quality !== undefined && Math.abs(e.quality) <= 1) rows.push(['Quality', `${QUALITY_NAMES[qualityBand(e.quality)]} ${e.quality >= 0 ? '+' : ''}${Math.round(e.quality * 100)}%`]);
    if (config) {
      // D27: working without the skill costs more, and the card says so
      const { cost, winging } = WebSystem.energyFor(ctx.player, WebSystem.pairOfHarvest(ctx.player, def), config.energyCost);
      rows.push(['Cost', `${cost} energy, ${config.baseTimeSeconds}s${winging ? ', winging it' : ''}`]);
      // ML: how often this hand takes it, once the person knows what it is
      const hand = isLooseStone(def) ? null : ExtractLaw.hand(ctx.player, def);
      if (hand) rows.push(['Odds', `${hand.tool ? `The ${LoadoutSystem.shownName(hand.tool)}` : 'Your hands'} take it about ${ExtractLaw.oddsOf(hand, def)} times in 100`]);
    }
  }
  if (level >= 2) {
    Object.entries(def.materialProps || {}).forEach(([k, v]) => rows.push([PROPERTY_NAMES[k] || k, String(v)]));
  }

  const title = ContactNames.of(e, ctx.level, ctx.player);
  const lacksTool = needs.some(n => n.startsWith('Needs'));
  const tail = canAct ? 'ready' : uses <= 0 ? (e.returning ? 'comes back' : 'spent') : lacksTool ? (needs[0].includes('ower') ? 'weak tool' : 'needs tool') : 'too far';
  return { title, rows, needs, canAct, compact: compact(title, tail) };
}

function inspectMob(e: IWorldEntity): Card {
  const def = MOB_DEFINITIONS[e.definitionId] as any;
  const title = ContactNames.of(e, () => 0); // D60: def.name is never shown
  const max = bodyLawOf(def, e).baseHealth + (e.bonusHealth ?? 0);
  const health = e.health ?? max;
  const rows: [string, string][] = [['Rank', String(e.rank)], ['Health', `${health} of ${max}`]];
  if (def?.size) rows.push(['Size', String(def.size)]);
  if (def?.behavior) rows.push(['Behavior', String(def.behavior)]);
  if (e.bargain) rows.push(['Stance', e.bargain.stance.toLowerCase()]);
  // D93: what a person can tell from looking. Its ground, and that blows are landing on nothing
  if (e.ward) rows.push(['Holds', `${e.holding?.chunks.length ?? 0} chunks`], ['Warded', e.warded ? `by ${e.ward.slots.length} anchors` : 'no longer']);
  else if (e.heldBy) rows.push(['Answers to', 'whoever holds this ground']);
  return { title, rows, needs: [], canAct: false, compact: compact(title, `${e.rank} ${health}/${max}`) };
}

function inspectOther(e: IWorldEntity, ctx: InspectContext): Card {
  const canAct = InteractionEngine.getAvailableInteractions(ctx.player, e, ctx.dist).length > 0;
  switch (e.type) {
    case EntityType.NPC: {
      const npc = e.npc;
      const title = ContactNames.of(e, ctx.level, ctx.player);
      // Q16: fallen on the way out. Nothing of theirs is anyone's to read.
      if (e.escort?.fallen) {
        return { title, rows: [['Down', 'carried out, they come back on the other side']], needs: canAct ? [] : ['Move closer'], canAct, compact: compact(title, canAct ? 'carry' : 'too far') };
      }
      const rows: [string, string][] = npc ? [['Regard', `${npc.disposition} of 100`], ['Wants', String(npc.want)]] : [];
      // D27: you learn what someone is good at by talking to them
      if (npc && npc.attempts > 0 && ctx.worldSeed) {
        const sheet = NpcSheet.read(ctx.worldSeed, e, ctx.webVersion);
        const names = Object.keys(sheet.skills ?? {}).map(id => WebSystem.nameOf(id));
        if (names.length > 0) rows.push(['Hands', names.join(', ')]);
        if (sheet.alignment) rows.push(['Alignment', sheet.alignment]);
      }
      return { title, rows, needs: canAct ? [] : ['Move closer'], canAct, compact: compact(title, canAct ? 'talk' : 'too far') };
    }
    case EntityType.CONTAINER: {
      const looted = !!e.container?.looted;
      const title = ContactNames.of(e, ctx.level, ctx.player);
      const needs = looted ? ['Already emptied'] : canAct ? [] : ['Move closer'];
      return { title, rows: [['Rank', String(e.container?.lootRank ?? e.rank)]], needs, canAct, compact: compact(title, looted ? 'empty' : canAct ? 'ready' : 'too far') };
    }
    case EntityType.EXTRACTION: {
      const near = ctx.dist < EXIT_RANGE;
      return { title: 'Exit', rows: [['Channel', '5s, broken by damage']], needs: near ? [] : ['Move closer'], canAct: near, compact: compact('Exit', near ? 'channel 5s' : 'too far') };
    }
    case EntityType.STRUCTURE:
      if (e.structure) {
        const s = e.structure;
        const title = ContactNames.of(e, ctx.level, ctx.player);
        const state = s.brokenAt !== undefined ? 'down' : s.built ? `${e.health ?? s.maxHealth} of ${s.maxHealth}` : `${s.paid ?? 0} of ${s.bill ?? 0} paid`;
        const made = s.material ? (RESOURCE_DEFINITIONS[s.material]?.name ?? s.material) : undefined;
        return { title, rows: [['State', state], ...(made ? [['Drawn from', made] as [string, string]] : [])], needs: [], canAct: false, compact: compact(title, state) };
      }
      return { title: 'Ruin', rows: [['Rank', String(e.rank)]], needs: [], canAct: false, compact: compact('Ruin', String(e.rank)) };
    case EntityType.CART: {
      // Wave 10C (D16): the cart says whose it is and what it holds; a theft
      // reads on the card, because the record is the reward
      const cart = e.cart;
      if (!cart) return { title: 'Cart', rows: [], needs: [], canAct: false, compact: 'Cart' };
      const rows: [string, string][] = [
        ['Seal', `${cart.ownerName}${cart.sealSignature ? ', signed' : ''}`],
        ['Bed', `${cart.gridW}×${cart.gridH} — ${cart.items.length} aboard`]
      ];
      if (cart.towedBy) rows.push(['Towed', 'the bar is in someone\'s hand']);
      const lastTheft = cart.theftLog[cart.theftLog.length - 1];
      if (lastTheft) rows.push(['Theft on record', `${lastTheft.byName}${lastTheft.signature ? ', signed' : ''}`]);
      return {
        title: `${cart.ownerName}'s Cart`,
        rows,
        needs: canAct ? [] : ['Move closer'],
        canAct,
        compact: compact(`${cart.ownerName}'s Cart`, `${cart.items.length} aboard`)
      };
    }
    default:
      return { title: 'Unknown', rows: [], needs: [], canAct: false, compact: 'Unknown' };
  }
}

export function inspectEntity(e: IWorldEntity, ctx: InspectContext): Card {
  if (e.type === EntityType.RESOURCE) return inspectResource(e, ctx);
  if (e.type === EntityType.MOB) return inspectMob(e);
  return inspectOther(e, ctx);
}

/**
 * Wave 10B.3: the template's card — its size needs, its promised regions and
 * its AUTHOR. The thumbnail beside it is the composed plan (itemArtFor).
 */
function inspectTemplate(item: IItem): Card {
  const tpl = (item as any).templateData;
  const count = (kind: string) => tpl.pieces.filter((p: any) => p.kind === kind).length;
  const rows: [string, string][] = [
    ['Needs', `a ${tpl.footprint.width}×${tpl.footprint.height} lot, ${tpl.structureType.toLowerCase()} permit`],
    ['Pieces', `${count('WALL')} wall, ${count('DOOR')} door, ${count('WINDOW')} window`]
  ];
  for (const zone of tpl.zones) rows.push(['Zone', `${zone.name} — at least ${zone.minArea} open tiles`]);
  rows.push(['Architect', tpl.authorName]);
  rows.push(['Signed', new Date(tpl.designedAt).toLocaleDateString()]);
  return { title: item.name, rows, needs: [], canAct: false, compact: compact(item.name, tpl.authorName) };
}

/** D72, D80: a world deed's card says what it mints and how that runs. The sky waits for the mint. */
function inspectWorldDeed(item: IItem): Card {
  const { size, source } = item.worldDeedData!;
  const cadence = WorldClock.cadenceFor(size);
  const rows: [string, string][] = [
    ['Mints', WorldDeed.say(size)],
    ['Gate', `Up ${WorldClock.say(cadence.upMs)}, off ${WorldClock.say(cadence.offMs)}, boots ${WorldClock.say(cadence.scanMs)}`],
    ['From', source === 'FREE' ? 'Given to everyone, once' : 'Found'],
    ['Spent', 'At the signing. The sky is chosen then.']
  ];
  return { title: item.name, rows, needs: [], canAct: false, compact: compact(item.name, WorldDeed.say(size)) };
}

/** D85: a map's card says where, how much, how old and whose hand. It holds no name, so it can say none. */
function inspectMap(item: IItem): Card {
  const map = item.mapData!;
  const { sectors, oldest, newest } = SurveySystem.mapSpread(map.sectors);
  const rows: [string, string][] = [
    ['World', map.worldName],
    ['Sectors', String(sectors)],
    ['Scanned', oldest === newest ? `regeneration ${newest}` : `regeneration ${oldest} to ${newest}`],
    ['Scribe', map.scribeName],
    ['Signed', new Date(map.writtenAt).toLocaleDateString()]
  ];
  return { title: item.name, rows, needs: [], canAct: false, compact: compact(item.name, map.scribeName) };
}

/**
 * Wave 10B.5: the card on a STANDING templated building, inside or from the
 * street. The house remembers its architect; a mono-material house says so
 * (D13 — the set bonus's numbers land with the materials pass).
 */
export function inspectTemplateRoom(room: {
  template?: { name: string; authorName: string; authorUid: string };
  shellMaterialDefId: string;
  pieces: { materialDefId: string }[];
  floorZones?: { materialDefId: string }[];
}): Card | null {
  if (!room.template) return null;
  const materials = new Set<string>([room.shellMaterialDefId]);
  for (const p of room.pieces) materials.add(p.materialDefId);
  for (const z of room.floorZones ?? []) materials.add(z.materialDefId);
  const rows: [string, string][] = [['Architect', room.template.authorName]];
  if (materials.size === 1) {
    const only = [...materials][0];
    const def = (CRAFTED_DEFINITIONS[only] ?? RESOURCE_DEFINITIONS[only]) as any;
    // Wave 10D (D13's numbers): the bonus is real now, and the card says it.
    rows.push(['One material', `${def?.name ?? only}. ${setBonusText(only)}`]);
  }
  return {
    title: room.template.name,
    rows,
    needs: [],
    canAct: false,
    compact: compact(room.template.name, room.template.authorName)
  };
}

/**
 * The raw materials leg (D26): the card on ANY standing building. What it is
 * made of, raw or worked, and what is worked into it: blind until studied, like
 * every other sheet (D19). A templated house keeps its architect's lines first.
 */
export function inspectBuiltRoom(room: IRoomState, player?: IPlayer): Card | null {
  const planned = inspectTemplateRoom(room);
  const def = (CRAFTED_DEFINITIONS[room.shellMaterialDefId] ?? RESOURCE_DEFINITIONS[room.shellMaterialDefId]) as any;
  const name = def?.name ?? room.shellMaterialDefId;
  const raw = !(def?.tags ?? []).includes('crafted');
  const rows: [string, string][] = [...(planned?.rows ?? [])];
  rows.push(['Walls', raw ? `${name}, raw, as it came out of the ground` : name]);
  if (!planned) {
    const materials = new Set<string>([room.shellMaterialDefId]);
    for (const p of room.pieces) materials.add(p.materialDefId);
    for (const z of room.floorZones ?? []) materials.add(z.materialDefId);
    if (materials.size === 1) rows.push(['One material', setBonusText(room.shellMaterialDefId)]);
  }
  const seen = new Set<string>();
  let blind = 0;
  for (const affix of roomAdditions(room)) {
    if (seen.has(affix.id)) continue;
    seen.add(affix.id);
    if (player && LoadoutSystem.isAffixStudied(player, affix.id)) {
      const said = Object.entries(affix.stats).map(([k, v]) => `${v >= 0 ? '+' : ''}${v} ${k.replace(/_/g, ' ')}`).join(', ');
      rows.push(['Worked in', `${affix.name} — ${said || 'named by the bank; its effect is not yet written'}`]);
    } else {
      blind++;
    }
  }
  if (blind > 0) rows.push(['Worked in', `${blind} unstudied. ${blind === 1 ? 'It does its work' : 'They do their work'}; the sheet can't see ${blind === 1 ? 'it' : 'them'}.`]);
  const title = planned?.title ?? `${name} walls`;
  return { title, rows, needs: [], canAct: false, compact: planned?.compact ?? compact(title, raw ? 'raw' : 'worked') };
}

const COUNT_WORDS = ['nothing', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight'];
const countWord = (n: number) => COUNT_WORDS[n] ?? String(n);

/**
 * The rarity rescale: a found piece's step said in words, with how many of its properties stand before its name and
 * how many after (an amount before, a rating after), and whose it was when it was a body's own. The frame says the
 * same by its shape (`itemArt`). A count, never more than the name and the old rarity word already told.
 */
export function stepWords(item: IItem): string {
  const word = PieceLaw.wordOf({ affixes: item.affixes ?? [], whose: item.whose });
  const title = word.charAt(0) + word.slice(1).toLowerCase();
  const before = (item.affixes ?? []).filter(a => a.type === 'PREFIX').length;
  const after = (item.affixes ?? []).length - before;
  const held = before + after === 0 ? 'nothing above normal'
    : after === 0 ? `${countWord(before)} before its name`
    : before === 0 ? `${countWord(after)} after its name`
    : `${countWord(before)} before its name, ${countWord(after)} after`;
  return item.whose ? `${title}: ${item.whose.name}'s own, a ${item.whose.kind}'s; ${held}` : `${title}: ${held}`;
}

/** A number as a person reads it: a piece keeps its numbers whole, and the card shows two places at most. */
const shown = (v: number) => (Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100));

/** The title is the name said aloud (`LoadoutSystem.shownName`), so a card and a counter agree. */
export function inspectItem(item: IItem, player?: IPlayer): Card {
  if ((item as any).templateData) return inspectTemplate(item);
  if (item.mapData) return inspectMap(item);
  if (item.worldDeedData) return inspectWorldDeed(item);
  if (item.isIdentified === false) {
    return { title: 'Unidentified Signal', rows: [['Known', 'Nothing yet']], needs: [], canAct: false, compact: 'Unidentified Signal' };
  }
  // Q16: a person carried out. Their weight is all there is to read; what they carry is their own.
  if (Escort.isCorpse(item)) {
    return { title: item.name, rows: [['Weight', `${item.weight} kg`], ['Carried', 'they come back on the other side']], needs: [], canAct: false, compact: compact(item.name, `${item.weight} kg`) };
  }
  const title = LoadoutSystem.shownName(item);
  // D19: what the sheet may see of the piece's own lines
  const visible = LoadoutSystem.visibleItemStats(item, player);
  // What a hand fires says first what it deals: its blow with its own damage line folded in, one number (`CombatMath.ownBlow`)
  const fired = CombatMath.firedByHand(item);
  const rows: [string, string][] = [...(fired ? [['Damage', CombatMath.damageSaid(item, String(item.rank), visible.damage ?? 0)] as [string, string]] : []), item.type === ItemType.GEAR && item.pieceLaw !== undefined ? ['Step', stepWords(item)] : ['Rarity', String(item.rarity)], ['Rank', String(item.rank)]];
  const q = (item as any).quality as number | undefined;
  // Wave 10D (one quality law): everything sits on the gear scale now. Gear
  // always says its roll; a commodity at exactly 0 took no roll and says
  // nothing — but a salvage-bitten plank (−10%) shows its wear like anything.
  if (q !== undefined && Math.abs(q) <= 1 && (q !== 0 || item.type === ItemType.GEAR)) {
    rows.push(['Quality', `${QUALITY_NAMES[qualityBand(q)]} ${q >= 0 ? '+' : ''}${Math.round(q * 100)}%`]);
  }
  const { durability, maxDurability } = item.stats as Record<string, number>;
  // Wear is counted by the work done, so it keeps fractions; the card says whole points, and near breaking in its last third
  if (maxDurability) rows.push(['Durability', durability === 0 ? `Broken, 0 of ${maxDurability}` : `${Math.max(1, Math.round(durability))} of ${maxDurability}${durability * 3 < maxDurability ? ', near breaking' : ''}`]);
  rows.push(['Weight', `${item.weight} kg`]);
  // D27: a handled hand reads what a material plainly is
  const knowledge = player?.materialMastery[item.universalDefinitionId];
  if ((knowledge?.knowledgeLevel ?? 0) >= 2) {
    const def = (CRAFTED_DEFINITIONS[item.universalDefinitionId] ?? RESOURCE_DEFINITIONS[item.universalDefinitionId]) as any;
    Object.entries(def?.materialProps ?? {}).forEach(([k, v]) => rows.push([PROPERTY_NAMES[k] || k, String(v)]));
  }
  // D27: a graded hand reads what a material can become
  if (player?.materialMastery[item.universalDefinitionId]?.graded) {
    const into = WebSystem.becomes(item.universalDefinitionId);
    if (into.length > 0) rows.push(['Becomes', into.join(', ')]);
  }
  // D19: the sheet is BLIND to unstudied affixes — their numbers never show,
  // while the item acts with them regardless. 10E made study real: a studied
  // affix shows exactly its banked record, negative offsets included.
  const mental = new Set<string>(MENTAL_ATTRIBUTES as readonly string[]);
  Object.entries(visible).forEach(([k, v]) => {
    if (['durability', 'maxDurability', 'weight'].includes(k)) return;
    if (fired && k === 'damage') return; // folded into the first line
    // D22: a mental stat on gear is a dead line — it never reaches the mind
    if (mental.has(k)) rows.push([k.replace(/_/g, ' '), `${v} — asleep. Gear doesn't think.`]);
    else rows.push([k.replace(/_/g, ' '), shown(v)]);
  });
  (item.affixes || []).forEach(a => {
    if (player && LoadoutSystem.isAffixStudied(player, a.id)) {
      const said = Object.entries(a.stats)
        .map(([k, v]) => `${v >= 0 ? '+' : ''}${shown(v)} ${k.replace(/_/g, ' ')}`).join(', ');
      rows.push(['Affix', `${a.name} — ${said || 'named by the bank; its effect is not yet written'}`]);
    } else {
      rows.push(['Affix', `${a.name} — unstudied. It does its work; the sheet can't see it.`]);
    }
  });
  // Wave 10E (D21): the magic says what it keeps, plainly
  if (item.charmData) {
    rows.push(['Keeps', `${item.charmData.slots} slot${item.charmData.slots === 1 ? '' : 's'}, ${item.charmData.chosen ? 'your choosing' : 'not your choosing'} — ${item.charmData.uses} use${item.charmData.uses === 1 ? '' : 's'} left`]);
  }
  if (item.scrollData) {
    rows.push(['Keeps', `${item.scrollData.slots} chosen slot${item.scrollData.slots === 1 ? '' : 's'} for ${Math.round(item.scrollData.durationSeconds / 60)} minutes of the clock`]);
  }
  // Wave 10C (10C.2): the ask is part of the record
  const reqs = LoadoutSystem.requirementsFor(item);
  Object.entries(reqs).forEach(([attr, need]) => {
    if ((need as number) > 1) rows.push(['Asks', `${attr.toUpperCase()} ${need}`]);
  });
  if (item.pouchData) rows.push(['Stacks', `${item.pouchData.accepts.join(', ')} — ${item.pouchData.contents.length} of ${item.pouchData.capacity}`]);
  if (item.beltData) rows.push(['Belt', `${item.beltData.pouchSlots} pouch slots`]);
  if (item.cartData) rows.push(['Unfolds', `a ${item.cartData.gridW}×${item.cartData.gridH} cart bed`]);
  // Wave 10D (10D.2): the anatomy reaches the eye. An item knows what it is
  // made of — its atoms and its chain, labor and all — and the card says so.
  const comp = item.composition;
  if (comp && comp.steps.length > 0) {
    const fmtCount = (n: number) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100));
    rows.push(['Made of', comp.materials.map(m => `${fmtCount(m.count)} ${m.name}`).join(', ')]);
    rows.push(['Chain', comp.steps.map(s => `${s.name}${s.facility === null ? ' (no bench)' : ''}`).join(' → ')]);
    rows.push(['Labor', `${Math.round(comp.laborSeconds)}s on the record, depth ${comp.depth}`]);
  } else if (comp && comp.materials[0]) {
    const origin = comp.materials[0].origin;
    const said = origin === 'HARVEST' ? 'Taken from the world'
      : origin === 'PURCHASE' ? 'Bought over a counter'
      : origin === 'SALVAGE' ? 'Torn back out of a wall'
      : origin === 'CONSTRUCTION' ? 'Minted by a finished shell'
      : origin === 'IMPROVISATION' ? 'Lashed together in the field'
      : 'Rolled by the world itself';
    rows.push(['Origin', said]);
  }
  return { title, rows, needs: [], canAct: false, compact: compact(title, String(item.rank)) };
}

// ---------------------------------------------------------------------------
// THE COMPARISON (the usability pass): this piece against what it would replace.
// Both sides read through the sheet the player is allowed (D19, D22): nothing
// unstudied enters a number, so no difference can give one away. Position and a
// shape mark carry it; no hue does.
// ---------------------------------------------------------------------------

export interface CompareRow { stat: string; here: string; there: string; delta: string; mark: '▲' | '▼' | '=' }
export interface Comparison {
  rows: CompareRow[];
  /** How many affixes on each side the sheet cannot see. Their names are already on the card. */
  blind: { here: number; there: number };
}

const NOT_COMPARED = new Set(['durability', 'maxDurability', 'weight']);
const trimmed = (n: number) => String(Math.round(n * 100) / 100);

function sheetFor(item: IItem, player: IPlayer | undefined): Record<string, number> {
  const mental = new Set<string>(MENTAL_ATTRIBUTES as readonly string[]);
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(LoadoutSystem.visibleItemStats(item, player))) {
    if (!NOT_COMPARED.has(k) && !mental.has(k)) out[k] = v;
  }
  return out;
}

const blindCount = (item: IItem, player: IPlayer | undefined) =>
  item.isIdentified === false ? 0 : (item.affixes || []).filter(a => !LoadoutSystem.isAffixStudied(player, a.id)).length;

export function compareItems(item: IItem, against: IItem, player: IPlayer | undefined): Comparison {
  const blind = { here: blindCount(item, player), there: blindCount(against, player) };
  if (item.isIdentified === false) return { rows: [], blind };
  const here = sheetFor(item, player), there = sheetFor(against, player);
  const stats = [...new Set([...Object.keys(here), ...Object.keys(there)])].sort();
  const rows = stats.map((k): CompareRow => {
    const a = here[k], b = there[k];
    const diff = (a ?? 0) - (b ?? 0);
    return {
      stat: k.replace(/_/g, ' '),
      here: a === undefined ? '—' : trimmed(a),
      there: b === undefined ? '—' : trimmed(b),
      delta: diff === 0 ? '=' : `${diff > 0 ? '+' : '−'}${trimmed(Math.abs(diff))}`,
      mark: diff > 0 ? '▲' : diff < 0 ? '▼' : '='
    };
  });
  return { rows, blind };
}

export interface ItemComparison { against: IItem | null; slot: EquipSlotId; result: Comparison | null }

/**
 * What this piece would be measured against: what its slot holds now, or for a
 * tool, the worn tool of its own kind. Null when there is nothing to measure:
 * cargo, or the worn piece itself.
 */
export function comparisonFor(item: IItem, player: IPlayer | undefined): ItemComparison | null {
  const equipment = player?.equipment ?? LoadoutSystem.emptyEquipment();
  if (equipment.items.some(i => i.id === item.id)) return null;
  // What has not been read has no slot to name: saying what it would replace says what it is.
  if (item.isIdentified === false) return null;
  const home = LoadoutSystem.slotForItem(item, equipment);
  if (!home) return null;
  let slot: EquipSlotId = home;
  if (home.startsWith('TOOL_')) {
    const mine = item.toolData?.toolTags ?? item.tags ?? [];
    const kin = Object.entries(equipment.slots).find(([s, id]) => {
      if (!s.startsWith('TOOL_') || !id) return false;
      const worn = equipment.items.find(i => i.id === id);
      const theirs = worn?.toolData?.toolTags ?? worn?.tags ?? [];
      return mine.some(t => t !== 'tool' && theirs.includes(t));
    });
    if (kin) slot = kin[0] as EquipSlotId;
  }
  const against = LoadoutSystem.itemIn(equipment, slot) ?? null;
  return { against, slot, result: against ? compareItems(item, against, player) : null };
}

// ---------------------------------------------------------------------------
// WHERE A CARD SITS: beside the thing, inside the window, covering neither.
// ---------------------------------------------------------------------------

export interface AnchorRect { left: number; top: number; width: number; height: number }

export function placeCard(anchor: AnchorRect, card: { w: number; h: number }, view: { w: number; h: number }, gap = 8): { left: number; top: number } {
  const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(Math.max(min, max), v));
  const right = anchor.left + anchor.width + gap;
  const left = anchor.left - gap - card.w;
  const top = anchor.top + anchor.height + gap;
  const above = anchor.top - gap - card.h;
  const beside = clamp(anchor.top, 0, view.h - card.h);
  const across = clamp(anchor.left, 0, view.w - card.w);
  if (right + card.w <= view.w) return { left: right, top: beside };
  if (left >= 0) return { left, top: beside };
  if (top + card.h <= view.h) return { left: across, top };
  if (above >= 0) return { left: across, top: above };
  return { left: right, top: beside }; // a card larger than any free side: the window has spoken
}

// ---------------------------------------------------------------------------
// Targets: the same list answers the cursor and the keyboard.
// ---------------------------------------------------------------------------

export interface Target { id: string; x: number; y: number; hw: number; hh: number; layer: number }

export function targetsFrom(things: { id: string; type: EntityType; x: number; y: number; w: number; h: number }[]): Target[] {
  return things.map(t => ({ id: t.id, x: t.x, y: t.y, hw: t.w >> 1, hh: t.h >> 1, layer: LAYER[t.type] ?? 0 }));
}

const under = (t: Target, x: number, y: number) => Math.abs(t.x - x) <= t.hw && Math.abs(t.y - y) <= t.hh;
const dist2 = (t: Target, x: number, y: number) => (t.x - x) * (t.x - x) + (t.y - y) * (t.y - y);

/** Threats first, then the nearest center. A target still under the cursor is kept, so the card does not flicker as things move. */
export function hitTest(targets: Target[], x: number, y: number, current?: string | null): string | null {
  let best: Target | null = null;
  for (const t of targets) {
    if (!under(t, x, y)) continue;
    if (t.id === current) return t.id;
    if (!best || t.layer > best.layer || (t.layer === best.layer &&
      (dist2(t, x, y) < dist2(best, x, y) || (dist2(t, x, y) === dist2(best, x, y) && t.id < best.id)))) best = t;
  }
  return best ? best.id : null;
}

/** The next target by distance from the player, wrapping. */
export function cycleTarget(targets: Target[], from: { x: number; y: number }, current: string | null, radius: number): string | null {
  const near = targets
    .filter(t => dist2(t, from.x, from.y) <= radius * radius)
    .sort((a, b) => dist2(a, from.x, from.y) - dist2(b, from.x, from.y) || (a.id < b.id ? -1 : 1));
  if (near.length === 0) return null;
  const at = near.findIndex(t => t.id === current);
  return near[(at + 1) % near.length].id;
}
