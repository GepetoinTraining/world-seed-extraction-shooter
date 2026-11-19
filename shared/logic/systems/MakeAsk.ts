/**
 * WHAT A PERSON WANTS TO MAKE (D119). Pedro, 2026-11-01: "we need the crafting interface (componet + component and input
 * to send to haiku what the person wants to make". And 2026-11-19, of a snare that code had written as a fixed thing with a
 * fixed bill: "i hate hard coded stuf... the concept of the snare is great. but we really do need to make that "what do you
 * want to study" and "what do you want to make" input work correctly. it takes input materials that the user adds, or, input
 * study things that they list, and sends them as a list with the skills for the next long sleep... and when they log back in
 * they receive the updates from the LLM that already have been settled as tech".
 *
 * So nothing that can be made is written here. A person lays what a thing is to be made of and says what they want it to
 * be. The components leave the vault and wait with the words. The next long sleep carries every such ask, with what their
 * hands know, to whoever answers a sleep; what comes back is words only (whether these components could be that, a name,
 * what it is, the registry's words for it, where and with what it is worked) and stands before `judge`. Every number is
 * this law's. A sound answer is a TECHNOLOGY in the base shape he gave it (2026-11-07: "{workstation, tool(s), material
 * types[inputs, outputs]}", the name apart): it is settled in the hub's tech, the thing is made of what was laid by the
 * roll every making takes, and from then on the same components make it with nobody asked ("once something exists it's
 * determined").
 *
 * WHAT IS MADE (Pedro, 2026-11-19: "Gear is 2 parts of a build: Tool -> what's needed to do an action, and yes it can be a
 * weapon. Gear -> something that's passive made by a took"). An answer says which the thing is, as a kind of the gear
 * grammar that already says what slot takes a piece and what every such piece gives (GEAR_SHAPES). A TOOL is a kind an
 * action is done with: what strikes, shoots or casts, what chops or mines, and any other tool, a snare among them. GEAR is
 * every other kind: worn or carried, and passive. Gear is made by a tool, so an answer that makes gear names the tool, and
 * the hand must hold one that answers; a tool may come out of bare hands, since the first one has to. A thing that is
 * neither is a material or a good, as before. A tool or gear comes back a piece, minted from its base like any made piece.
 *
 * WHERE IT LANDS (Pedro, 2026-11-19: "Just don't make it AUTO COME TO THE LOAD OUT... Please"). In the vault, always. A
 * made tool is never put in a hand and made gear is never put on, whether it was asked for at a sleep or made again at
 * once. What a character carries into a world is what the person chose to put on.
 *
 * MY CALLS, his to strike: an ask the answer says cannot be gives its components back (a "no" is not a roll, and costs the
 * night only); the product's rank is the highest among what went in, and it weighs what went in; an answer that cannot be
 * read leaves the ask waiting, and after `TRIES` of them the components come back; how many asks wait is focus's count,
 * as a stack's is; a tool an answer names and the person does not hold gives the components back, with the tool said; a tool
 * is held when anything in the vault, on the body or in the pack wears its word.
 *
 * Pure, but for the one registry every making reads (`absorbTechs`).
 */

import { IItem, IMakeAsk, IMakeWords, IPlayer, ITech, TagKind, UniversalRank } from '../../types';
import { absorbTechs, TECH_WAYS } from '../../entities/economy/data/recipeDefinitions';
import { GEAR_SHAPES } from '../theme/ThemeFormula';
import { GEAR_KINDS, GearKind } from '../theme/ThemeTypes';
import { ItemFactory } from '../../entities/item/ItemFactory';
import { RANK_ORDER } from '../../entities/player/systems/ProgressionSystem';
import { TagLaw } from '../content/TagLaw';
import { fnv1a } from '../rng/DeterministicRNG';
import { Downtime } from './Downtime';
import { IMade, IMaker, PairCraft } from './PairCraft';

/** How much a person may say of what they want. It guards the bill of a sleep, and says nothing of what can be made. */
export const ASK_WORDS = 200;
/** How many answers nobody could read an ask waits through before its components come back. */
export const TRIES = 2;
/** A name is a name: this many characters, and never a number. */
export const NAME_CHARACTERS = 60;
/** Words that would make the game read a made thing as something it is not. No answer may put them on one. */
const NOT_FOR_A_MADE_THING = ['station', 'npc_contract'];

/**
 * The two parts of a build, read off the grammar and never listed twice: a kind an action is done with is a TOOL (the
 * grammar files those with weapons and with tools), and every other kind is GEAR.
 */
export const isToolKind = (kind: string): boolean =>
  (GEAR_KINDS as readonly string[]).includes(kind) && GEAR_SHAPES[kind as GearKind].bucket !== 'armor_bases';
export const isGearKind = (kind: string): boolean =>
  (GEAR_KINDS as readonly string[]).includes(kind) && GEAR_SHAPES[kind as GearKind].bucket === 'armor_bases';
export const TOOL_KINDS = GEAR_KINDS.filter(isToolKind);
export const PASSIVE_KINDS = GEAR_KINDS.filter(isGearKind);

type Verdict = { ok: boolean; reason?: string };
const no = (reason: string): Verdict => ({ ok: false, reason });

const rankAt = (rank: UniversalRank | string) => Math.max(0, RANK_ORDER.indexOf(rank as UniversalRank));

/** What was laid, as a bill: each kind once, with how many. In the order of their ids, so two people's same bill is the same. */
const billOf = (parts: IItem[]): { itemId: string; quantity: number }[] => {
  const count = new Map<string, number>();
  for (const p of parts) count.set(p.universalDefinitionId, (count.get(p.universalDefinitionId) ?? 0) + 1);
  return [...count.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([itemId, quantity]) => ({ itemId, quantity }));
};

const sorted = (words: string[]) => [...new Set(words.map(w => w.trim()).filter(Boolean))].sort();

/** What an answer is read against: the registry's words, and the stations this hub could raise. */
export interface IMakeGround {
  kindOf: (tag: string) => TagKind | undefined;
  stations: { key: string; name: string }[];
}

export const MakeAsk = {
  /** How many asks wait at once: what focus holds, as a stack's count is. */
  holds(player: IPlayer): number {
    return Downtime.capacity(player.attributes);
  },

  said(words: string): string {
    return words.trim().replace(/\s+/g, ' ').slice(0, ASK_WORDS);
  },

  /** Laid at home: the components leave the vault and wait with the words. */
  lay(player: IPlayer, words: string, itemIds: string[], at: number): Verdict & { player?: IPlayer; ask?: IMakeAsk } {
    if (player.currentSession) return no('Nothing is laid out here. It is laid where you rest, at home.');
    const wants = this.said(words);
    if (!wants) return no('Say what you want it to be.');
    const ids = new Set(itemIds);
    const parts = player.bank.stashTabs.flatMap(t => t.items).filter(i => ids.has(i.id));
    if (parts.length === 0 || parts.length !== ids.size) return no('Put in what it is to be made of, from your vault.');
    for (const piece of parts) {
      if (piece.isIdentified === false) return no('You do not know what one of those is yet. Rest first, and then lay it.');
      if (!PairCraft.isMaterial(piece)) return no(`${piece.name} is not something to work into another thing.`);
    }
    const waiting = player.makeAsks ?? [];
    const holds = this.holds(player);
    if (waiting.length >= holds) return no(`Your focus holds ${holds} things laid for the night. Take one back first.`);
    const ask: IMakeAsk = { id: `ask_${fnv1a(`${player.id}:${at}:${[...ids].sort().join(',')}`).toString(16).padStart(8, '0')}`, words: wants, parts, at };
    return { ok: true, ask, player: { ...without(player, ids), makeAsks: [...waiting, ask] } };
  },

  /** Taken back, or given back: the components return to the vault and the ask is gone. */
  takeBack(player: IPlayer, askId: string): IPlayer {
    const ask = (player.makeAsks ?? []).find(a => a.id === askId);
    if (!ask) return player;
    return { ...withItems(player, ask.parts), makeAsks: (player.makeAsks ?? []).filter(a => a.id !== askId) };
  },

  /** An answer nobody could read: the ask waits for another sleep, and after `TRIES` of them it is given back. */
  unread(player: IPlayer, askId: string): { player: IPlayer; givenBack: boolean } {
    const ask = (player.makeAsks ?? []).find(a => a.id === askId);
    if (!ask) return { player, givenBack: false };
    const tries = (ask.tries ?? 0) + 1;
    if (tries >= TRIES) return { player: this.takeBack(player, askId), givenBack: true };
    return { player: { ...player, makeAsks: (player.makeAsks ?? []).map(a => (a.id === askId ? { ...a, tries } : a)) }, givenBack: false };
  },

  /**
   * What a sleep carries of this person's asks, or null with none. Each ask is its words and what it is made of, as a
   * person would say the components (name, the registry's words, rank, how many). With them go what their hands know
   * (every held skill, as its words and its level) and the stations this hub could raise, by the key an answer names one by.
   */
  request(player: IPlayer, ground: IMakeGround): Record<string, unknown> | null {
    const asks = player.makeAsks ?? [];
    if (asks.length === 0) return null;
    return {
      // The tools in their keeping, as the registry's tool words: gear is made by one of these or not at all
      holds: this.toolsHeld(player, ground.kindOf),
      asks: asks.map(a => ({
        id: a.id,
        wants: a.words,
        of: billOf(a.parts).map(line => {
          const piece = a.parts.find(p => p.universalDefinitionId === line.itemId)!;
          return { name: piece.name, tags: piece.tags ?? [], rank: piece.rank, count: line.quantity };
        })
      })),
      hands: Object.values(player.bank.universalSkills ?? {}).filter(s => !s.legacy).map(s => ({ tags: TagLaw.parseSkillId(s.id) ?? [], level: s.level })).filter(s => s.tags.length > 0),
      stations: ground.stations.map(s => ({ key: s.key, name: s.name }))
    };
  },

  /** The law over one answer. Nothing a model says passes unjudged, and a broken answer changes nothing. */
  judge(words: IMakeWords | undefined, ask: IMakeAsk, ground: IMakeGround): Verdict {
    if (!words || words.id !== ask.id) return no('Nothing came back for it.');
    if (typeof words.makes !== 'boolean') return no('It did not say whether it could be made.');
    if (!words.line?.trim()) return no('It came back with nothing said.');
    if (!words.makes) return { ok: true };
    const name = words.name?.trim() ?? '';
    if (!name) return no('It came back with no name.');
    if (name.length > NAME_CHARACTERS) return no('Its name is not a name.');
    if (/\d/.test(name) || /\d/.test(words.is ?? '')) return no('It wrote a number, and numbers are not its to write.');
    if (!words.is?.trim()) return no('It did not say what the thing is.');
    const tags = sorted(words.tags ?? []);
    if (tags.length === 0) return no('It gave the thing no words.');
    for (const tag of tags) {
      if (!ground.kindOf(tag)) return no(`"${tag}" is not a word the registry holds.`);
      if (NOT_FOR_A_MADE_THING.includes(tag)) return no(`A made thing is never "${tag}".`);
    }
    const kind = words.kind ?? '';
    if (kind && !(GEAR_KINDS as readonly string[]).includes(kind)) return no(`"${kind}" is not a kind of tool or of gear.`);
    // Gear is made by a tool: an answer that makes gear and names none has not said how
    if (isGearKind(kind) && (words.tools ?? []).filter(Boolean).length === 0) return no('Gear is made by a tool, and it named none.');
    if (words.trade && ground.kindOf(words.trade) !== 'trade') return no(`"${words.trade}" is not a trade.`);
    if (words.station && !ground.stations.some(s => s.key === words.station)) return no(`Nobody here could raise "${words.station}".`);
    for (const tool of words.tools ?? []) {
      if (ground.kindOf(tool) !== 'tool') return no(`"${tool}" is not a tool the registry holds.`);
    }
    return { ok: true };
  },

  /** Every piece in this person's keeping: the vault, what the body wears, and the pack when they are out. */
  keeping(player: IPlayer): IItem[] {
    return [...player.bank.stashTabs.flatMap(t => t.items), ...(player.equipment?.items ?? []), ...(player.currentSession?.inventory ?? [])];
  },

  /** The registry's tool words this person holds a tool for, in order. */
  toolsHeld(player: IPlayer, kindOf: IMakeGround['kindOf']): string[] {
    return sorted(this.keeping(player).flatMap(i => i.tags ?? []).filter(tag => kindOf(tag) === 'tool'));
  },

  /** Of the tools a making asks, the ones this person holds nothing for. */
  lacking(player: IPlayer, tools: string[] = []): string[] {
    const worn = new Set(this.keeping(player).flatMap(i => i.tags ?? []));
    return sorted(tools).filter(word => !worn.has(word));
  },

  /**
   * The technology an answer comes to, from what was laid. Its id is minted from its three parts alone (where it is
   * worked, with what, from what into what), so the name is apart and the first to come to it names it for everyone.
   */
  techOf(ask: IMakeAsk, words: IMakeWords, who: { by: string; at: number }): ITech {
    const inputs = billOf(ask.parts);
    const tags = sorted(words.tags ?? []);
    const tools = sorted(words.tools ?? []);
    const station = words.station ?? '';
    const kind = words.kind ?? '';
    // What it is made into is its kind and its words; a plain thing mints as it did before kinds were asked
    const mark = fnv1a(JSON.stringify([station, tools, inputs.map(i => [i.itemId, i.quantity]), kind ? [kind, ...tags] : tags])).toString(16).padStart(8, '0');
    const rank = ask.parts.reduce<UniversalRank>((best, p) => (rankAt(p.rank) > rankAt(best) ? p.rank : best), UniversalRank.F);
    const weight = Math.max(0.1, Math.round(ask.parts.reduce((sum, p) => sum + (p.weight ?? 0), 0) * 10) / 10);
    return {
      id: `tech_${mark}`, name: words.name.trim(), is: words.is.trim(), station, tools, inputs,
      output: { id: `made_${mark}`, tags, rank, weight },
      kind,
      trade: words.trade ?? '',
      // A good's own formula (ThemeFormula): ten seconds, and fifteen more a rank
      laborSeconds: 10 + rankAt(rank) * 15,
      wanted: ask.words, by: who.by, at: who.at
    };
  },

  /**
   * A sound answer that says it can be: the technology is settled (the one already standing, if somebody came to these
   * parts first), and the thing is made of what was laid by the roll every making takes. The product comes back read.
   */
  settle(ask: IMakeAsk, words: IMakeWords, maker: IMaker, who: { by: string; at: number }, standing: ITech[] = []): { tech: ITech; fresh: boolean; made: IMade } {
    const written = this.techOf(ask, words, who);
    const known = standing.find(t => t.id === written.id) ?? TECH_WAYS[written.id];
    const tech = known ?? written;
    absorbTechs([tech]);
    const made = PairCraft.makeOf(ask.parts, PairCraft.recipeOfTech(tech), maker, `make:${who.by}:${ask.id}`);
    return { tech, fresh: !known, made: { ...made, item: ItemFactory.read(made.item) } };
  },

  /** The technologies already standing that these components are exactly the bill of: the same kinds, as many of each. */
  knownFor(parts: IItem[], standing: ITech[] = Object.values(TECH_WAYS)): ITech[] {
    const bill = billOf(parts);
    if (bill.length === 0) return [];
    return standing.filter(t => t.inputs.length === bill.length && t.inputs.every((line, i) => line.itemId === bill[i].itemId && line.quantity === bill[i].quantity));
  },

  /** A technology already standing, made at once of what is put in: no sleep, and nobody asked. The components are used. */
  makeNow(player: IPlayer, techId: string, itemIds: string[], maker: IMaker, at: number, standing: ITech[] = Object.values(TECH_WAYS)): Verdict & { player?: IPlayer; made?: IMade; tech?: ITech } {
    if (player.currentSession) return no('That is made at home, from your vault.');
    const ids = new Set(itemIds);
    const parts = player.bank.stashTabs.flatMap(t => t.items).filter(i => ids.has(i.id));
    const tech = this.knownFor(parts, standing).find(t => t.id === techId);
    if (!tech || parts.length !== ids.size) return no('That is not what those make.');
    const lacks = this.lacking(player, tech.tools);
    if (lacks.length > 0) return no(`${tech.name} is made with ${lacks.join(' and ')}, and you hold none.`);
    absorbTechs([tech]);
    const made = PairCraft.makeOf(parts, PairCraft.recipeOfTech(tech), maker, `make:${player.id}:${techId}:${at}:${[...ids].sort().join(',')}`);
    return { ok: true, tech, made, player: withItems(without(player, ids), [made.item]) };
  }
};

/** The vault without these pieces, and without their places in it. */
function without(player: IPlayer, ids: Set<string>): IPlayer {
  return {
    ...player,
    bank: {
      ...player.bank,
      stashTabs: player.bank.stashTabs.map(t => {
        if (!t.items.some(i => ids.has(i.id))) return t;
        const layout = { ...(t.layout ?? {}) };
        for (const id of ids) delete layout[id];
        return { ...t, items: t.items.filter(i => !ids.has(i.id)), layout };
      })
    }
  };
}

/** These pieces in the vault's first tab, to be placed when it is next opened, as a thing written out is. */
function withItems(player: IPlayer, items: IItem[]): IPlayer {
  if (items.length === 0) return player;
  return { ...player, bank: { ...player.bank, stashTabs: player.bank.stashTabs.map((t, i) => (i === 0 ? { ...t, items: [...t.items, ...items] } : t)) } };
}
