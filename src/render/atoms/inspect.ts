/**
 * One inspect card for everything: what it is, what you know of it, what you would
 * need to act on it. What can be done is asked of the game's own InteractionEngine;
 * the card only explains the answer. Hover and keyboard share one target list.
 */

import { bodyLawOf } from '../../../shared/entities/mob/BodyLaw';
import { PieceLaw } from '../../../shared/logic/theme/PieceLaw';
import { EquipSlotId, IItem, IPlayer, InteractionType, ItemType, MENTAL_ATTRIBUTES, NoteKind } from '../../../shared/types';
import { NoteKeys, PlayerNote } from '../../logic/systems/PlayerNote';
import { InteractionEngine } from '../../entities/interaction/InteractionEngine';
import { MOB_DEFINITIONS } from '../../../shared/entities/mob/data/mobDefinitions';
import { RESOURCE_DEFINITIONS } from '../../../shared/entities/item/data/resourceDefinitions';
import { Spread, SpreadBook, formOf } from '../../../shared/entities/world/Spread';
import { DoingBook } from '../../../shared/logic/systems/MaterialDoing';
import { KnownWorth } from '../../../shared/logic/economy/KnownWorth';
import { ExtractLaw } from '../../../shared/logic/systems/ExtractLaw';
import { isLooseStone, isThrowable } from '../../../shared/entities/item/Throwable';
import { TILE_PX } from '../../../shared/entities/world/grid';
import { PROJECTILE_RANGE_PX } from '../../../shared/entities/combat/projectileSystem';
import { EffectSystem, IEffectAbility } from '../../../shared/logic/systems/EffectSystem';
import { StatSystem } from '../../../shared/logic/systems/StatSystem';
import { ProgressionSystem } from '../../../shared/entities/player/systems/ProgressionSystem';
import { ContentRegistry } from '../../../shared/logic/theme/ContentRegistry';
import { volleyShots } from '../../../shared/logic/theme/ThemeFormula';
import { blowWear } from '../../../shared/logic/theme/WearLaw';
import { WeaveSystem } from '../../logic/systems/WeaveSystem';
import { CIRCLES_FOR_A_GIFT, CircleSystem } from '../../logic/systems/CircleSystem';
import { cycleMs, fireMode, reachFor, throwsLeft, wieldRefusal, windupOf } from '../../logic/systems/FieldInput';
import { CRAFTED_DEFINITIONS } from '../../../shared/entities/economy/data/recipeDefinitions';
import { EntityType, IWorldEntity } from '../../../shared/entities/world/types';
import { QUALITY_NAMES, qualityBand } from '../../../shared/render/atoms/atoms';
import { Escort } from '../../logic/systems/Escort';
import { LAYER } from './world';
import { LoadoutSystem } from '../../../shared/entities/player/systems/LoadoutSystem';
import { CombatMath } from '../../entities/combat/CombatMath';
import { setBonusText } from '../../../shared/entities/hub/template';
import { IRoomState, roomAdditions } from '../../../shared/entities/hub/room';
import { MASTERY_RUNGS, WebSystem } from '../../../shared/logic/systems/WebSystem';
import { NpcSheet } from '../../../shared/logic/systems/NpcSheet';
import { SurveySystem } from '../../logic/systems/SurveySystem';
import { ContactNames } from '../../logic/systems/ContactNames';
import { WorldDeed } from '../../logic/systems/WorldDeed';
import { WorldClock } from '../../entities/world/WorldClock';
import { SkillNames, listed } from '../../logic/systems/SkillNames';
import { statAmount, statWord } from '../../logic/systems/StatWords';
import { said as sayNumber } from '../../logic/systems/SheetWords';
import { GameClock } from '../../logic/time/GameClock';

/**
 * UXC, part 1 (Pedro: "yup"): a card reads in two layers. The first is short, what the thing is and what is read at a
 * glance; the second is added beneath it while ALT is held, and never reorders, replaces or hides a row of the first.
 * `rows` holds both, the first then the second, in the one order the card is drawn and copied in; `glance` says where
 * the first ends. Absent, every row stands on the first layer.
 */
export interface Card {
  title: string;
  rows: [string, string][];
  /** How many of `rows` stand on the first layer. The rest are the second, beneath. Absent: all of them. */
  glance?: number;
  needs: string[];
  canAct: boolean;
  compact: string;
  /** UXC, part 3: what on this card the player does not know, each of which they may speak a note on. */
  unknowns?: ICardUnknown[];
}

/** UXC, part 3: an unknown a card offers a note on: where the note is kept, what kind of thing, a name for the button, and whether a note is spoken. */
export interface ICardUnknown { key: string; kind: NoteKind; about: string; noted: boolean }

type Line = [string, string];

/**
 * UXC, part 3 (Pedro: "button + voice"): a player's note on an unknown. Up top, right under the unknown it is about,
 * as their own words: by its place, the word "Your note" and quotation marks, never a hue. Once what is true replaces
 * it, it is kept one step behind as what they guessed, so the guess can be set against the truth.
 */
export const NOTE_ROWS = { note: 'Your note', guess: 'You guessed' } as const;
const yourNote = (note: string): Line => [NOTE_ROWS.note, `"${note}"`];
const yourGuess = (note: string, of?: string): Line => [NOTE_ROWS.guess, of ? `${of}: "${note}"` : `"${note}"`];
const unknown = (player: Pick<IPlayer, 'notes'> | undefined, key: string, kind: NoteKind, about: string): ICardUnknown =>
  ({ key, kind, about, noted: !!PlayerNote.of(player, key) });

/** The rows a card shows before the key is held. */
export const firstLayer = (card: Card): Line[] => card.rows.slice(0, card.glance ?? card.rows.length);
/** The rows added beneath while the key is held. */
export const secondLayer = (card: Card): Line[] => card.rows.slice(card.glance ?? card.rows.length);

/** One card from its two layers: the first, then the second, and where one ends. */
const layered = (first: Line[], second: Line[]): Pick<Card, 'rows' | 'glance'> => ({ rows: [...first, ...second], glance: first.length });

/**
 * UXC, part 1: the card as plain text, for CTRL+C. Its title, the first layer, a rule, the second, then what it needs:
 * the order the card is drawn in, so the same card always copies the same.
 */
export function cardText(card: Card): string {
  const said = ([k, v]: Line) => `${k}: ${v}`;
  const deep = secondLayer(card);
  const ready = card.canAct && card.needs.length === 0 ? ['Ready'] : [];
  return [card.title, ...firstLayer(card).map(said), ...(deep.length > 0 ? ['--', ...deep.map(said)] : []), ...card.needs, ...ready].join('\n');
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

  // UXC: up top, what it is and what a try asks; beneath, how fine this one is and what its matter is
  const rows: Line[] = [];
  const deep: Line[] = [];
  // ML: a variant's marks are plain to see, known or not, and said in words as well as drawn
  const spread = SpreadBook.of(e.definitionId);
  if (spread.base && spread.marks.length > 0) rows.push(['Looks', `Like any ${formOf(def) ?? 'other of its kind'}, but with ${Spread.said(spread.marks)}`]);
  // UXC, part 3: a material not known, or whose doing is not, takes the player's note under where it says so
  const noteKey = NoteKeys.material(e.definitionId);
  const note = PlayerNote.of(ctx.player, noteKey);
  const unknowns: ICardUnknown[] = [];
  const unknownHere = () => { if (note) rows.push(yourNote(note)); unknowns.push(unknown(ctx.player, noteKey, 'material', 'this material')); };
  if (level <= 0) {
    rows.push(['Known', 'Nothing yet. Study it to learn']);
    unknownHere();
  } else {
    rows.push(['Rank', String(def.rank)]);
    // ML21: what it does, once someone has needed it; until then it is not yet known
    if (formOf(def)) {
      const doing = DoingBook.of(def.id)?.line;
      rows.push(['Does', doing ?? 'Not yet known']);
      if (!doing) unknownHere();
      else if (note) deep.push(yourGuess(note));
    }
    // RG: a place that came back may hold more than its kind's own
    if (def.uses) rows.push(['Left', uses > def.uses ? `${uses}, more than most` : `${Math.max(0, uses)} of ${def.uses}`]);
    // RG: a place that came back was rolled anew, and says what it came back as
    if (e.quality !== undefined && Math.abs(e.quality) <= 1) deep.push(['Quality', `${QUALITY_NAMES[qualityBand(e.quality)]} ${e.quality >= 0 ? '+' : ''}${Math.round(e.quality * 100)}%`]);
    if (config) {
      // D27: working without the skill costs more, and the card says so
      const { cost, winging } = WebSystem.energyFor(ctx.player, WebSystem.pairOfHarvest(ctx.player, def), config.energyCost);
      rows.push(['Cost', `${cost} energy, ${config.baseTimeSeconds}s${winging ? ', winging it' : ''}`]);
      // ML: how often this hand takes it, once the person knows what it is
      const hand = isLooseStone(def) ? null : ExtractLaw.hand(ctx.player, def);
      // GV41: in plain steps, never the number (D32)
      if (hand) rows.push(['Odds', `${hand.tool ? `The ${LoadoutSystem.shownName(hand.tool)} takes` : 'Your hands take'} it ${ExtractLaw.oddsSaid(ExtractLaw.oddsOf(hand, def))}`]);
    }
  }
  if (level >= 2) {
    Object.entries(def.materialProps || {}).forEach(([k, v]) => deep.push([PROPERTY_NAMES[k] || k, String(v)]));
  }

  const title = ContactNames.of(e, ctx.level, ctx.player);
  const lacksTool = needs.some(n => n.startsWith('Needs'));
  const tail = canAct ? 'ready' : uses <= 0 ? (e.returning ? 'comes back' : 'spent') : lacksTool ? (needs[0].includes('ower') ? 'weak tool' : 'needs tool') : 'too far';
  return { title, ...layered(rows, deep), needs, canAct, compact: compact(title, tail), ...(unknowns.length > 0 ? { unknowns } : {}) };
}

function inspectMob(e: IWorldEntity, player?: IPlayer): Card {
  const def = MOB_DEFINITIONS[e.definitionId] as any;
  const title = ContactNames.of(e, () => 0); // D60: def.name is never shown
  const max = bodyLawOf(def, e).baseHealth + (e.bonusHealth ?? 0);
  const health = e.health ?? max;
  // UXC, part 3: a creature that has earned no name is unknown, and the player's note on its kind stands first
  const noteKey = NoteKeys.creature(e.definitionId);
  const note = PlayerNote.of(player, noteKey);
  const named = !!e.displayName;
  // UXC: up top, how strong, how hurt, what it will do and whether blows land; beneath, its size and the ground it holds
  const rows: Line[] = [...(!named && note ? [yourNote(note)] : []), ['Rank', String(e.rank)], ['Health', `${health} of ${max}`]];
  const deep: Line[] = named && note ? [yourGuess(note)] : [];
  if (def?.size) deep.push(['Size', String(def.size)]);
  if (def?.behavior) rows.push(['Behavior', String(def.behavior)]);
  if (e.bargain) rows.push(['Stance', e.bargain.stance.toLowerCase()]);
  // D93: what a person can tell from looking. Its ground, and that blows are landing on nothing
  if (e.ward) {
    rows.push(['Warded', e.warded ? `by ${e.ward.slots.length} anchors` : 'no longer']);
    deep.push(['Holds', `${e.holding?.chunks.length ?? 0} chunks`]);
  } else if (e.heldBy) deep.push(['Answers to', 'whoever holds this ground']);
  const unknowns = named ? [] : [unknown(player, noteKey, 'creature', 'this creature')];
  return { title, ...layered(rows, deep), needs: [], canAct: false, compact: compact(title, `${e.rank} ${health}/${max}`), ...(unknowns.length > 0 ? { unknowns } : {}) };
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
      // UXC, part 3: a person whose name was never told is unknown, and the player's note on them stands first
      const noteKey = NoteKeys.person(e);
      const note = PlayerNote.of(ctx.player, noteKey);
      const nameless = !!npc?.name && !ContactNames.knowsName(ctx.player, e);
      // UXC: up top, how they regard you and what they want; beneath, what talking has taught of them
      const rows: Line[] = [...(nameless && note ? [yourNote(note)] : []), ...(npc ? [['Regard', `${npc.disposition} of 100`], ['Wants', String(npc.want)]] as Line[] : [])];
      const deep: Line[] = !nameless && note ? [yourGuess(note)] : [];
      const unknowns = nameless ? [unknown(ctx.player, noteKey, 'person', 'this person')] : [];
      // D27: you learn what someone is good at by talking to them
      if (npc && npc.attempts > 0 && ctx.worldSeed) {
        const sheet = NpcSheet.read(ctx.worldSeed, e, ctx.webVersion);
        const names = Object.keys(sheet.skills ?? {}).map(id => SkillNames.nameOf(id));
        if (names.length > 0) deep.push(['Hands', names.join(', ')]);
        if (sheet.alignment) deep.push(['Alignment', sheet.alignment]);
      }
      return { title, ...layered(rows, deep), needs: canAct ? [] : ['Move closer'], canAct, compact: compact(title, canAct ? 'talk' : 'too far'), ...(unknowns.length > 0 ? { unknowns } : {}) };
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
  if (e.type === EntityType.MOB) return inspectMob(e, ctx.player);
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
      const said = Object.entries(affix.stats).map(([k, v]) => `${v >= 0 ? '+' : ''}${statAmount(k, sayNumber(v))} ${statWord(k)}`).join(', ');
      rows.push(['Worked in', `${affix.name} — ${said || 'what it does is not yet known'}`]);
    } else {
      blind++;
    }
  }
  if (blind > 0) rows.push(['Worked in', `${blind} you have not studied: ${blind === 1 ? 'it works' : 'they work'} on the piece, and you do not know how.`]);
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

/**
 * PR, call 7: what a thing is worth, said as a fact, and where what is known of it raised it, why. Never the sum behind
 * it. Known is what it is made of having been known when it was taken, or a read piece's lines.
 */
export const worthSaid = (item: IItem): string => {
  const lines = item.type === ItemType.GEAR && (item.pieceLaw ?? 0) >= 2 && item.isIdentified !== false && PieceLaw.linesShare(item) > 0;
  const rose = lines || KnownWorth.inComposition(item.composition);
  return `${sayNumber(item.value)} G${rose ? ', more now that it is known what it does' : ''}`;
};

/** The title is the name said aloud (`LoadoutSystem.shownName`), so a card and a counter agree. */
export function inspectItem(item: IItem, player?: IPlayer): Card {
  if ((item as any).templateData) return inspectTemplate(item);
  if (item.mapData) return inspectMap(item);
  if (item.worldDeedData) return inspectWorldDeed(item);
  // UXC, part 3: a piece not read takes the player's note on this very piece
  const pieceKey = NoteKeys.piece(item.id);
  const pieceNote = PlayerNote.of(player, pieceKey);
  if (item.isIdentified === false) {
    return {
      title: 'Unidentified Signal', rows: [['Known', 'Nothing yet'], ...(pieceNote ? [yourNote(pieceNote)] : [])], needs: [], canAct: false, compact: 'Unidentified Signal',
      unknowns: [unknown(player, pieceKey, 'piece', 'this piece')]
    };
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
  // UXC, part 1: up top, what it is and what is read at a glance (what it deals, its step and rank, its roll and wear, what
  // it weighs and is worth, what it does, every line and affix, what it keeps and asks); beneath, what its matter is,
  // what it becomes, and where it came from. The calls are the coordinator's and stand as open rows (UXC1).
  const rows: Line[] = [...(fired ? [['Damage', CombatMath.damageSaid(item, String(item.rank), visible.damage ?? 0)] as Line] : []), item.type === ItemType.GEAR && item.pieceLaw !== undefined ? ['Step', stepWords(item)] : ['Rarity', String(item.rarity)], ['Rank', String(item.rank)]];
  const deep: Line[] = [];
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
  // PR: what it is worth, and why it is worth more where it is (Q17: a person is not goods)
  if (!Escort.isPerson(item)) rows.push(['Worth', worthSaid(item)]);
  const unknowns: ICardUnknown[] = [];
  // ML21: a piece of a material of the ground says what the material does, once someone has needed it
  const groundDef = RESOURCE_DEFINITIONS[item.universalDefinitionId];
  if (groundDef && formOf(groundDef) && item.type !== ItemType.GEAR) {
    const doing = DoingBook.of(groundDef.id)?.line;
    const materialKey = NoteKeys.material(groundDef.id);
    const materialNote = PlayerNote.of(player, materialKey);
    rows.push(['Does', doing ?? 'Not yet known']);
    // UXC, part 3: the same note as on the place it came from
    if (!doing) {
      if (materialNote) rows.push(yourNote(materialNote));
      unknowns.push(unknown(player, materialKey, 'material', 'this material'));
    } else if (materialNote) deep.push(yourGuess(materialNote));
  }
  // D27: a handled hand reads what a material plainly is
  const knowledge = player?.materialMastery[item.universalDefinitionId];
  if ((knowledge?.knowledgeLevel ?? 0) >= 2) {
    const def = (CRAFTED_DEFINITIONS[item.universalDefinitionId] ?? RESOURCE_DEFINITIONS[item.universalDefinitionId]) as any;
    Object.entries(def?.materialProps ?? {}).forEach(([k, v]) => deep.push([PROPERTY_NAMES[k] || k, String(v)]));
  }
  // D27: a graded hand reads what a material can become
  if (player?.materialMastery[item.universalDefinitionId]?.graded) {
    const into = WebSystem.becomes(item.universalDefinitionId);
    if (into.length > 0) deep.push(['Becomes', into.join(', ')]);
  }
  // D19: the sheet is BLIND to unstudied affixes — their numbers never show,
  // while the item acts with them regardless. 10E made study real: a studied
  // affix shows exactly its banked record, negative offsets included.
  const mental = new Set<string>(MENTAL_ATTRIBUTES as readonly string[]);
  Object.entries(visible).forEach(([k, v]) => {
    if (['durability', 'maxDurability', 'weight'].includes(k)) return;
    if (fired && k === 'damage') return; // folded into the first line
    // D22: a mental stat on gear is a dead line — it never reaches the mind
    // GV42: every stat by its own word, with its percent sign where it is counted in hundredths
    if (mental.has(k)) rows.push([statWord(k), `${v} — asleep. Gear doesn't think.`]);
    else rows.push([statWord(k), statAmount(k, shown(v))]);
  });
  let blind = false;
  (item.affixes || []).forEach(a => {
    const affixKey = NoteKeys.affix(a.id);
    const affixNote = PlayerNote.of(player, affixKey);
    if (player && LoadoutSystem.isAffixStudied(player, a.id)) {
      const said = Object.entries(a.stats)
        .map(([k, v]) => `${v >= 0 ? '+' : ''}${statAmount(k, shown(v))} ${statWord(k)}`).join(', ');
      rows.push(['Affix', `${a.name} — ${said || 'what it does is not yet known'}`]);
      if (affixNote) deep.push(yourGuess(affixNote, a.name));
    } else {
      // UXC: the few words up top, and what they mean said once beneath
      rows.push(['Affix', `${a.name}: not studied`]);
      blind = true;
      // UXC, part 3: the player's note on this affix, wherever it is met
      if (affixNote) rows.push(yourNote(affixNote));
      if (!unknowns.some(u => u.key === affixKey)) unknowns.push(unknown(player, affixKey, 'affix', a.name));
    }
  });
  // UXC, part 3: a piece once unread keeps what was guessed of it, behind what is now read
  if (pieceNote) deep.push(yourGuess(pieceNote));
  if (blind) deep.push(['Not studied', 'It works on the piece, and you do not know how.']);
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
    const fmtCount = (n: number) => sayNumber(n);
    deep.push(['Made of', comp.materials.map(m => `${fmtCount(m.count)} ${m.name}`).join(', ')]);
    deep.push(['Chain', comp.steps.map(s => `${s.name}${s.facility === null ? ' (no bench)' : ''}`).join(' → ')]);
    deep.push(['Labor', `${Math.round(comp.laborSeconds)} s of work`]);
  } else if (comp && comp.materials[0]) {
    const origin = comp.materials[0].origin;
    const said = origin === 'HARVEST' ? 'Taken from the world'
      : origin === 'PURCHASE' ? 'Bought over a counter'
      : origin === 'SALVAGE' ? 'Torn back out of a wall'
      : origin === 'CONSTRUCTION' ? 'Minted by a finished shell'
      : origin === 'IMPROVISATION' ? 'Lashed together in the field'
      : 'Made by the world itself';
    deep.push(['Origin', said]);
  }
  return { title, ...layered(rows, deep), needs: [], canAct: false, compact: compact(title, String(item.rank)), ...(unknowns.length > 0 ? { unknowns } : {}) };
}

// ---------------------------------------------------------------------------
// A SKILL'S OWN NUMBERS (UXC, part 2). Pedro: "yes". His earlier words on the sheet: "the way the skills come into
// play don't tell anyone anything". In the game this comes from, attack numbers left the sheet and each skill shows
// its own. A hand in use and a held skill each have a card: what the blow or the act comes to now with what is held
// and worn, what it costs, its reach or shape, and what grows it. Every number is the rules' own answer, asked as the
// field asks it; numbers stand up top, and what they mean is said beneath in sentences.
// ---------------------------------------------------------------------------

const pctSaid = (share: number) => `${Math.round(share * 100)}%`;
const tilesSaid = (px: number) => sayNumber(px / TILE_PX);
const degreesOf = (halfAngle: number) => Math.round((halfAngle * 2 * 180) / Math.PI);
const countSaid = (n: number, one: string, many: string) => (n === 1 ? `one ${one}` : `${n} ${many}`);
const capitalized = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** What the focus is set to cast, read as the field reads it when it lets a cast go (`castFromFocus`). */
function castOf(player: IPlayer): IEffectAbility | undefined {
  const cast = player.activeCast;
  if (!cast) return undefined;
  if (cast.kind === 'weave') return cast.elements.length > 0 ? WeaveSystem.weave(cast.elements) : undefined;
  if (cast.kind === 'gift') return CircleSystem.abilityOf(player, cast.id);
  return ContentRegistry.ability(cast.id);
}

/**
 * UXC, part 2: the card of a hand in use, the hotbar's own. What it deals now, a blow and a second at the pace the field
 * fires it (`cycleMs`), before armour; how often a hit crits or glances; how long it winds up; how far and how wide it
 * reaches, or how many shots leave it and how far they fly; what a blow costs; the skill that reads on it. An empty hand
 * that carries a stone throws one, as the field has it reach for it (`reachFor`). A piece not read, or one that only
 * guards, answers with its own card: what it would deal would say what it is (D19, D32).
 * After the join with the sheet's branch, the second layer is where the law of when a description may open would be
 * asked (ledger UXC13); a hand's own card is always the skill's own, so today it always opens.
 */
export function inspectHand(player: IPlayer, slot: EquipSlotId): Card {
  const eq = player.equipment;
  const held = eq ? LoadoutSystem.itemIn(eq, slot) : undefined;
  if (held && (held.isIdentified === false || wieldRefusal(held))) return inspectItem(held, player);
  const carried = player.currentSession?.inventory ?? [];
  const reached = reachFor(held, carried);
  const hand = held ?? reached;
  const at = player.attributes;
  const rank = ProgressionSystem.rankOf(player);
  const mode = fireMode(hand);
  const cast = mode === 'FOCUS' ? castOf(player) : undefined;
  const title = held ? LoadoutSystem.shownName(held) : 'Bare hand';
  const rows: Line[] = [];
  const deep: Line[] = [];

  if (cast) {
    // The focus lets its working go instead of a blow: what the working comes to, as `EffectSystem.resolve` rolls it
    const caster = { rank, power: StatSystem.castPower(at) };
    const [low, high] = EffectSystem.magnitudeRange(cast, caster);
    const reach = EffectSystem.resolve(cast, caster, 'card').reachPx;
    rows.push(['Casts', cast.name], ['Does', `${low} to ${high}`]);
    rows.push(['Wind-up', `${sayNumber(windupOf(hand, eq, at, { cost: cast.cost, rank: rank as never }).ms / 1000)} s`]);
    // Where it lands, as the field lets it go (`applyPlayerReceipt`): a shot, a reach, or a ring of shots
    rows.push(['Reach', cast.delivery === 'ranged' ? `one shot, ${tilesSaid(PROJECTILE_RANGE_PX)} tiles`
      : cast.delivery === 'melee' || cast.delivery === 'touch' ? `${tilesSaid(reach)} tiles`
      : `${countSaid(volleyShots('ring').length, 'shot', 'shots')} all around, ${tilesSaid(PROJECTILE_RANGE_PX)} tiles`]);
    rows.push(['Cost', `${WeaveSystem.aetherPerElement(cast, rank)} aether of each: ${cast.elements.join(', ')}`]);
    deep.push(['Working', `${capitalized(cast.effect.replace(/_/g, ' '))}, delivered ${cast.delivery}, drawn from what you hold of each element.`]);
  } else {
    const hit = CombatMath.baseHit(hand, eq, at, WebSystem.handPower(player, hand), rank);
    const perSecond = 1000 / cycleMs(hand, eq, at);
    const poison = StatSystem.total(eq, 'poison_damage');
    rows.push(['Blow', `${sayNumber(hit)} a blow, ${sayNumber(hit * perSecond)} a second, before armour`]);
    if (poison > 0) rows.push(['Poison', `${sayNumber(poison)} a hit`]);
    rows.push(['Crit', `${pctSaid(StatSystem.critChance(eq, at))} of hits, ×${sayNumber(CombatMath.critMultiplier(eq))}`]);
    rows.push(['Glance', `${pctSaid(CombatMath.glanceChance(eq, at, rank))} of hits, for ${pctSaid(CombatMath.glanceFactor())}`]);
    const windup = windupOf(hand, eq, at);
    rows.push(['Wind-up', `${sayNumber(windup.ms / 1000)} s`]);
    if (mode === 'MELEE') {
      const shape = CombatMath.strikeOf(hand);
      rows.push(['Reach', `${tilesSaid(shape.reachPx)} tiles, ${degreesOf(shape.halfAngle)}° wide${shape.innerPx > 0 ? `, nothing within ${tilesSaid(shape.innerPx)} tiles` : ''}`]);
    } else {
      const throwing = !hand || isThrowable(hand);
      const shots = volleyShots(CombatMath.volleyOf(hand)).length;
      rows.push(['Reach', `${throwing ? countSaid(shots, 'throw', 'throws') : countSaid(shots, 'shot', 'shots')}, ${tilesSaid(CombatMath.shotRangePx(hand) ?? PROJECTILE_RANGE_PX)} tiles`]);
    }
    // EN5: a blow takes none of the day's energy; a stone thrown is spent, and a piece wears by the blow (`WearLaw`)
    if (isThrowable(held)) rows.push(['Cost', `the stone itself, ${throwsLeft(held, carried)} to throw`]);
    else if (reached) rows.push(['Cost', `a stone carried, ${throwsLeft(undefined, carried, true)} to throw`]);
    else rows.push(['Cost', 'none of the day\'s energy']);
    if (held && held.stats?.maxDurability) rows.push(['Wear', `${sayNumber(blowWear(held.stats.maxDurability, CombatMath.ownRate(held), String(held.rank)))} a blow`]);
    if (held && toolPower(held) > 0) rows.push(['Works', `power ${sayNumber(toolPower(held))}`]);

    deep.push(['Blow', 'What lands before a crit, a glance or the armour it meets. Every blow does at least 1.']);
    deep.push(['Wind-up', windup.kind === 'swing' ? 'Swung at half pace before the blow lands; a quicker hand shortens only what comes after.' : 'Drawn standing before it lets go; a quicker hand shortens only what comes after.']);
    deep.push(['Cost', isThrowable(hand) ? 'A stone thrown is spent, and the next one carried comes to the hand.' : 'A blow takes none of the day\'s energy; the day is for work.']);
    if (held && toolPower(held) > 0) deep.push(['Works', 'What a try costs and how often it takes is on the place\'s own card.']);
  }

  // What grows it: the strongest skill the hand answers to, the one the fight reads (`WebSystem.handSkill`)
  const skill = WebSystem.handSkill(player, hand);
  rows.push(['Grows', skill ? `${SkillNames.nameOf(skill.id)}, level ${skill.level}: +${Math.round(WebSystem.skillPower(skill) * 100)}%` : 'no skill you hold reads on it']);
  deep.push(['Grows', skill ? 'Only the strongest skill the hand answers to adds to its blow, and it grows as you use it.' : 'A skill reads on a hand only when every word of it is on the piece.']);
  return { title, ...layered(rows, deep), needs: [], canAct: false, compact: compact(title, 'in hand') };
}

/**
 * UXC, part 2: the card of a held skill. Its level and rank, its step, what it adds to a blow with a weapon it fits (or
 * the hand's, when the hand fits), what it takes off a try against untrained where it gathers, its circles and gifts;
 * beneath, what grows it and what it lets you do. Null when the skill is not held. A sheet calls it with the skill's id
 * and the hand in use (ledger UXC12).
 */
export function inspectSkill(player: IPlayer, skillId: string, hand?: IItem): Card | null {
  const skill = player.bank?.universalSkills?.[skillId];
  if (!skill) return null;
  const tags = skill.tags ?? [];
  const title = SkillNames.nameOf(skillId);
  const row = WebSystem.earnedSheet(player).earned.find(r => r.id === skillId);
  const mastery = WebSystem.masteryOf(skill);
  const rows: Line[] = [['Level', `${skill.level}, rank ${ProgressionSystem.skillRankOf(skill)}`], ['Step', `${capitalized(mastery.rungName)}, ${mastery.rung + 1} of ${MASTERY_RUNGS.length}`]];
  const deep: Line[] = [];
  // The fight reads a skill only when every word of it is on the weapon (`WebSystem.handPower`)
  const power = Math.round(WebSystem.skillPower(skill) * 100);
  const fits = !!hand && tags.length > 0 && tags.every(t => (hand.tags ?? []).includes(t));
  const worked = WebSystem.materialIdentity(tags);
  if (fits) rows.push(['On blows', `+${power}%, ${LoadoutSystem.shownName(hand!)}`]);
  else if (worked.length === 0) rows.push(['On blows', `+${power}% with a weapon it fits`]);
  // Only what is gathered asks a skill's price in energy and time: the work's own price, asked with it and without it
  if (WebSystem.materialsOf(tags).length > 0) {
    const pair = { id: skillId, tags };
    const untrained = { ...player, bank: { ...player.bank, universalSkills: {} } };
    const energy = 1 - WebSystem.energyFor(player, pair, 100).cost / WebSystem.energyFor(untrained, pair, 100).cost;
    const time = 1 - WebSystem.clockFactor(player, pair) / WebSystem.clockFactor(untrained, pair);
    rows.push(['Work', `${Math.round(energy * 100)}% less energy, ${Math.round(time * 100)}% less time than untrained`]);
  }
  const circles = CircleSystem.circlesOf(skill);
  let nextGiftAt = CircleSystem.firstAsks(player, skillId);
  while (nextGiftAt <= circles) nextGiftAt += CIRCLES_FOR_A_GIFT;
  rows.push(['Circles', `${circles}, a gift at ${nextGiftAt}`]);
  const gifts = CircleSystem.giftsOf(player, skillId).map(g => g.name);
  if (gifts.length > 0) rows.push(['Gifts', gifts.join(', ')]);

  deep.push(['Grows', `With use: ${SkillNames.whatItIs(tags).toLowerCase()}.`]);
  if (row && row.verbs.length > 0) deep.push(['Lets you', `${capitalized(listed(row.verbs))}.`]);
  if (row && row.opens.length > 0) deep.push(['Opens', `Your hub can raise ${listed(row.opens)}.`]);
  if (row?.flavor) deep.push(['Said of it', row.flavor.trim().replace(/([^.!?])$/, '$1.')]);
  return { title, ...layered(rows, deep), needs: [], canAct: false, compact: compact(title, `level ${skill.level}`) };
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
      stat: statWord(k),
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
