/**
 * THE TECHNOLOGY WEB AND THE AUTO SKILL (D27). The pattern is Primordial's
 * (skill-emergence, skill-mastery, craft-web, web, tech-lore), reimplemented on
 * tags under D28's law, with no number theory and no table of what connects.
 *
 * THE MINT LAW: a skill is the tool plus the object it worked. The bare hand adds
 * nothing, so a hand skill IS the material, and it sits under every tool skill
 * that works that material: the web is the lattice of tag sets, where Primordial's
 * was the lattice of divisors.
 *
 * THE AUTO SKILL: working without the skill wings it, at a cost, and accrues. The
 * work settles only at a rest (D30), on a roll keyed by who, what and how much,
 * so a failed rest cannot be re-rolled by reloading: only more work buys a new roll.
 *
 * THE RUNGS: a held skill climbs named, handled, graded, attuned, and each rung
 * files more of the material into materialMastery, the one knowledge ledger.
 *
 * THE WEB: a node carries verbs, tools and benches, and its links come from its
 * tags. A further station opens through a skill's tool + material connection.
 * The web is the hub's; the exp stays on each person.
 */

import {
  IHubWeb, IItem, IPlayer, ISkillProgress, ISkillState, IWebCredit, IWebPack, IWebStation, UniversalRank
} from '../../../types';
import { ProgressionSystem, SKILL_IMPACT_PER_LEVEL, SKILL_TIME_FACTOR } from '../../entities/player/systems/ProgressionSystem';
import { RESOURCE_DEFINITIONS, BIOME_RESOURCES, ResourceDef } from '../../entities/item/data/resourceDefinitions';
import { RECIPE_DEFINITIONS, CRAFTED_DEFINITIONS } from '../../entities/economy/data/recipeDefinitions';
import { AffixBank } from '../content/AffixBank';
import { DreamingSystem } from '../../entities/world/Dreaming';
import { Rng } from '../rng/DeterministicRNG';
import { TagLaw } from '../content/TagLaw';
import { WebBank } from '../content/WebBank';
import { ProcessFamily, ProcessSystem } from './ProcessSystem';

// ---------------------------------------------------------------------------
// TUNABLE, and Wave 12's to balance. Structure numbers that never render.
// ---------------------------------------------------------------------------

export { SKILL_TIME_FACTOR };

/** Donor's numbers, stretched by D84. Rising gaps, so later rungs cost more. */
export const MASTERY_RUNGS = ['named', 'handled', 'graded', 'attuned'] as const;
export type MasteryRung = typeof MASTERY_RUNGS[number];
export const RUNG_XP: readonly number[] = [0, 60, 180, 420].map(xp => xp * SKILL_TIME_FACTOR);

const WINGING_PENALTY = 5;
const WINGING_ENERGY_FACTOR = 1.5;
const WINGING_CLOCK_FACTOR = 1.25;
const RUNG_ENERGY_DISCOUNT = 0.1;
const RUNG_CLOCK_DISCOUNT = 0.05;
const STUDY_SITTING_MODIFIER = 2;

export interface ISkillPair {
  id: string;
  tags: string[];
}

export interface ISkillNode {
  id: string;
  tags: string[];
  name: string;
  /** What the work is done with: tools and trades. */
  tools: string[];
  actions: string[];
  materials: string[];
  verbs: string[];
  /** The stations this skill's connection opens. */
  benches: string[];
}

export interface IPlacement {
  /** Known skills this one contains: the hand under the tool. */
  narrower: string[];
  /** Known skills that contain this one. */
  broader: string[];
  /** Same tool, or same bench. */
  siblings: string[];
  /** Same material. */
  kin: string[];
  connected: boolean;
}

export interface IEarnedRow {
  /** A rarer skill climbs slowly, and each level counts for more. */
  rank: UniversalRank;
  /** Levels poured in. Each third one earns a gift. */
  circles: number;
  id: string;
  name: string;
  flavor?: string;
  rung: number;
  rungName: MasteryRung;
  into: number;
  level: number;
  tools: string[];
  materials: string[];
  verbs: string[];
  opens: string[];
  firstBy?: string;
}

export interface IFormingRow {
  name: string;
  tool: string;
  worked: string;
  fill: number;
}

export interface IEarnedSheet {
  earned: IEarnedRow[];
  forming: IFormingRow[];
  opens: { id: string; name: string; description?: string }[];
}

type Skills = Record<string, ISkillState>;

const current = () => WebBank.current();
const words = (tags: string[]) => tags.map(t => t.replace(/_/g, ' '));
const title = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);

export class WebSystem {

  // -------------------------------------------------------------------------
  // THE MINT
  // -------------------------------------------------------------------------

  /** What of these tags says what the work was done with. A tool's class word does not count. */
  static toolIdentity(tags: string[], pack: IWebPack = current()): string[] {
    return TagLaw.canonical(tags).filter(t => WebBank.hasKind(pack, t, ['tool', 'trade', 'action']));
  }

  /** What of these tags says what was worked. */
  static materialIdentity(tags: string[], pack: IWebPack = current()): string[] {
    return WebBank.workedTags(pack, tags);
  }

  /**
   * THE MINT LAW. Bare hands (null, or nothing) add nothing: the skill is the
   * material. Same pair, same skill, on every machine, in any order of arrival.
   */
  static mint(toolTags: string[] | null, materialTags: string[], pack: IWebPack = current()): ISkillPair {
    const tags = TagLaw.canonical([...this.toolIdentity(toolTags ?? [], pack), ...this.materialIdentity(materialTags, pack)]);
    return { id: TagLaw.skillIdOf(tags), tags };
  }

  /** What a harvest was done with: the tool the node asks for, or one that works it by its own data. */
  static toolForHarvest(player: IPlayer, def: ResourceDef, pack: IWebPack = current()): string | null {
    const carried: IItem[] = [...(player.currentSession?.inventory ?? []), ...(player.equipment?.items ?? [])];
    const required = def.harvestConfig?.requiredToolTags ?? [];
    if (required.length > 0) {
      const power = (i: IItem) => (i.stats?.mining_power as number) || (i.stats?.chopping_power as number) || 0;
      const best = [...carried].sort((a, b) => power(b) - power(a)).find(i =>
        required.some(t => i.toolData?.toolTags.includes(t) || (i.tags ?? []).includes(t) || i.name.toLowerCase().includes(t)));
      if (!best) return null;
      return required.find(t => best.toolData?.toolTags.includes(t) || (best.tags ?? []).includes(t)) ?? required.find(t => best.name.toLowerCase().includes(t)) ?? null;
    }
    const worked = this.materialIdentity(def.tags ?? [], pack);
    for (const item of carried) {
      for (const tag of this.toolIdentity(item.tags ?? [], pack)) {
        if (pack.tools.some(t => t.tag === tag && t.works.some(w => worked.includes(w)))) return tag;
      }
    }
    return null;
  }

  static pairOfHarvest(player: IPlayer, def: ResourceDef, pack: IWebPack = current()): ISkillPair | null {
    if (this.materialIdentity(def.tags ?? [], pack).length === 0) return null;
    const tool = this.toolForHarvest(player, def, pack);
    return this.mint(tool ? [tool] : null, def.tags ?? [], pack);
  }

  /**
   * A bench job: its trade, and everything it consumed. At a further station the
   * work is done with whichever of its tools these hands know, or its first.
   */
  static pairOfJob(recipeId: string, consumedDefIds: string[], skills: Skills = {}, pack: IWebPack = current()): ISkillPair | null {
    const webRecipe = pack.recipes.find(r => r.id === recipeId);
    const family = webRecipe?.trade ?? ProcessSystem.familyOfRecipe(recipeId);
    if (!family) return null;
    const station = webRecipe ? pack.stations.find(s => s.id === webRecipe.requiredStation) : undefined;
    const consumed = consumedDefIds.flatMap(id => (CRAFTED_DEFINITIONS[id] ?? RESOURCE_DEFINITIONS[id])?.tags ?? []);
    if (!station) return this.mint([family], consumed, pack);
    const held = station.connection.tool.map(tool => this.mint([tool], consumed, pack)).find(pair => skills[pair.id]);
    return held ?? this.mint([station.connection.tool[0]], consumed, pack);
  }

  /**
   * An action context's own tool tags are an assumption of the log's. When it is
   * a blow, the tool is what is actually held, and a bare hand adds nothing.
   */
  static withHeldTool<T extends { tags: string[] }>(context: T, heldTags: string[], pack: IWebPack = current()): T {
    const isAction = context.tags.some(t => WebBank.hasKind(pack, t, ['action']));
    const claimsTool = context.tags.some(t => WebBank.hasKind(pack, t, ['tool']));
    if (!isAction || !claimsTool) return context;
    const held = heldTags.filter(t => WebBank.hasKind(pack, t, ['tool']));
    return { ...context, tags: [...context.tags.filter(t => !WebBank.hasKind(pack, t, ['tool'])), ...held] };
  }

  static isLawfulId(id: string, pack: IWebPack = current()): boolean {
    const tags = TagLaw.parseSkillId(id);
    return !!tags && tags.every(t => WebBank.isIdentityTag(pack, t));
  }

  // -------------------------------------------------------------------------
  // THE RECORD: one shape, for a player's skill and an NPC's
  // -------------------------------------------------------------------------

  static freshSkill(id: string, tags: string[], rank: number): ISkillState {
    return { id, level: 1, currentXp: 0, tags, rank, bornRank: rank, scalingAttribute: this.scalingFor(tags) };
  }

  private static scalingFor(tags: string[], pack: IWebPack = current()): string {
    if (tags.some(t => WebBank.hasKind(pack, t, ['trade']))) return 'intelligence';
    if (tags.some(t => WebBank.hasKind(pack, t, ['tool']))) return 'dexterity';
    if (tags.some(t => WebBank.hasKind(pack, t, ['action']))) return 'agility';
    return 'perception';
  }

  static cumulativeXp(skill: ISkillState): number {
    return ProgressionSystem.getXpForLevel(skill.level, ProgressionSystem.skillRarity(skill)) + skill.currentXp;
  }

  static withCumulativeXp(skill: ISkillState, xp: number): ISkillState {
    let level = 1;
    let left = Math.max(0, xp);
    const rarity = ProgressionSystem.skillRarity(skill);
    while (left >= ProgressionSystem.getXpToNextLevel(level, rarity)) {
      left -= ProgressionSystem.getXpToNextLevel(level, rarity);
      level++;
    }
    return { ...skill, level, currentXp: left };
  }

  /** Only what the web can read. A legacy track is kept whole, but it is not a node. */
  static heldSkills(skills: Skills): ISkillState[] {
    return Object.values(skills ?? {}).filter(s => !s.legacy && TagLaw.parseSkillId(s.id));
  }

  // -------------------------------------------------------------------------
  // THE AUTO SKILL
  // -------------------------------------------------------------------------

  /** The weight it takes to mint: harder material, more work. Never shown; the fill is. */
  static emergenceDC(rank: number): number {
    return (10 + Math.max(0, rank) * 10) * SKILL_TIME_FACTOR;
  }

  private static attemptRoll(playerId: string, id: string, attempts: number): number {
    return Rng.fromKey(`${playerId}:${id}:attempt:${attempts}`).int(1, 21);
  }

  /** One more attempt, winged. A poor attempt still teaches a little. */
  static accrue(player: IPlayer, pair: ISkillPair, rank: number, modifier: number = -WINGING_PENALTY): IPlayer {
    const prior: ISkillProgress = player.skillProgress?.[pair.id] ?? { id: pair.id, tags: pair.tags, rank, attempts: 0, weight: 0 };
    const roll = this.attemptRoll(player.id, pair.id, prior.attempts);
    return {
      ...player,
      skillProgress: {
        ...player.skillProgress,
        [pair.id]: {
          ...prior,
          rank: Math.max(prior.rank, rank),
          attempts: prior.attempts + 1,
          weight: prior.weight + Math.max(1, roll + modifier)
        }
      }
    };
  }

  /** A sitting with a piece teaches better than swinging blind, and still only accrues. */
  static accrueFromStudy(player: IPlayer, pair: ISkillPair, rank: number): IPlayer {
    return this.accrue(player, pair, rank, STUDY_SITTING_MODIFIER);
  }

  static emergenceFill(progress: ISkillProgress): number {
    return Math.max(0, Math.min(1, progress.weight / this.emergenceDC(progress.rank)));
  }

  /**
   * Eligible, then probable, and the chance climbs with persistence. The key is
   * who, what and how many attempts: the same state always gets the same answer.
   */
  static emerges(progress: ISkillProgress, playerId: string): boolean {
    const dc = this.emergenceDC(progress.rank);
    if (progress.weight < dc) return false;
    // D84: stretched in time, so both the climb and each roll's chance read the factor
    const chance = Math.min(95, (20 + (progress.weight - dc) / SKILL_TIME_FACTOR) / SKILL_TIME_FACTOR);
    return Rng.fromKey(`${playerId}:${progress.id}:emerge:${progress.attempts}`).next() * 100 < chance;
  }

  /** D30: the batch is processed. Pure: same player in, same player out. */
  static rest(player: IPlayer): { player: IPlayer; emerged: ISkillState[] } {
    const progress = player.skillProgress ?? {};
    const held = { ...player.bank.universalSkills };
    const left: Record<string, ISkillProgress> = {};
    const emerged: ISkillState[] = [];
    for (const id of Object.keys(progress).sort()) {
      const entry = progress[id];
      if (held[id]) continue;
      if (this.emerges(entry, player.id)) {
        const skill = this.freshSkill(id, entry.tags, entry.rank);
        held[id] = skill;
        emerged.push(skill);
      } else {
        left[id] = entry;
      }
    }
    let rested: IPlayer = { ...player, skillProgress: left, bank: { ...player.bank, universalSkills: held } };
    for (const skill of emerged) rested = this.revealByMastery(rested, skill.id);
    return { player: rested, emerged };
  }

  /** Winging it costs half again; knowing it costs what it costs, and less as it climbs. */
  static energyFor(player: IPlayer, pair: ISkillPair | null, base: number): { cost: number; winging: boolean } {
    if (!pair || !player.bank) return { cost: base, winging: false };
    const skill = player.bank.universalSkills[pair.id];
    if (!skill) return { cost: Math.ceil(base * WINGING_ENERGY_FACTOR), winging: true };
    return { cost: Math.max(1, Math.round(base * (1 - this.masteryOf(skill).rung * RUNG_ENERGY_DISCOUNT) / (1 + this.skillPower(skill)))), winging: false };
  }

  static clockFactor(player: IPlayer, pair: ISkillPair | null): number {
    if (!pair) return 1;
    const skill = player.bank.universalSkills[pair.id];
    if (!skill) return WINGING_CLOCK_FACTOR;
    return (1 - this.masteryOf(skill).rung * RUNG_CLOCK_DISCOUNT) / (1 + this.skillPower(skill));
  }

  /** What a skill's levels add up to. A rare skill's level is worth far more than a common one's. */
  static skillPower(skill: Pick<ISkillState, 'level' | 'rank' | 'bornRank'>): number {
    return (skill.level - 1) * SKILL_IMPACT_PER_LEVEL * ProgressionSystem.skillImpactFactor(ProgressionSystem.skillRarity(skill));
  }

  /** The strongest held skill the weapon in the hand answers to: every tag of the skill is on the weapon. */
  static handPower(player: IPlayer, weapon: IItem | undefined): number {
    const tags = weapon?.tags ?? [];
    return this.heldSkills(player.bank.universalSkills).reduce((best, skill) =>
      skill.tags.length > 0 && skill.tags.every(t => tags.includes(t)) ? Math.max(best, this.skillPower(skill)) : best, 0);
  }

  // -------------------------------------------------------------------------
  // THE RUNGS, and the reveal they join
  // -------------------------------------------------------------------------

  /** What a rung asks of a skill of this rank. */
  static rungXp(rung: number, skillRank: number = 0): number {
    return RUNG_XP[rung] * ProgressionSystem.skillTimeFactor(skillRank);
  }

  static masteryOf(skill: ISkillState): { rung: number; rungName: MasteryRung; into: number; atMax: boolean } {
    const xp = this.cumulativeXp(skill);
    let rung = 0;
    const rarity = ProgressionSystem.skillRarity(skill);
    RUNG_XP.forEach((_need, i) => { if (xp >= this.rungXp(i, rarity)) rung = i; });
    const atMax = rung >= RUNG_XP.length - 1;
    const into = atMax ? 1 : Math.max(0, Math.min(1, (xp - this.rungXp(rung, rarity)) / (this.rungXp(rung + 1, rarity) - this.rungXp(rung, rarity))));
    return { rung, rungName: MASTERY_RUNGS[rung], into, atMax };
  }

  /** The materials a skill is about: every one carrying its worked tags. */
  static materialsOf(tags: string[], pack: IWebPack = current()): string[] {
    const worked = this.materialIdentity(tags, pack);
    if (worked.length === 0) return [];
    return WebBank.workableMaterials(pack)
      .filter(m => worked.every(t => m.tags.includes(t)))
      .map(m => m.id);
  }

  /** What can land on this material unseen: the dreams of everywhere it grows. Names only ever go to the ledger. */
  static hiddenPoolOf(defId: string): string[] {
    const pack = AffixBank.current();
    const biomes = Object.entries(BIOME_RESOURCES).filter(([, ids]) => ids.includes(defId)).map(([biome]) => biome);
    const ids = biomes.flatMap(biome => DreamingSystem.entriesFor(pack, biome)
      .filter(e => e.theme !== 'CART' && e.allowedTags.includes('resource'))
      .map(e => e.id));
    return [...new Set(ids)].sort();
  }

  /**
   * Each rung files more of the material into materialMastery, the one ledger.
   * named: the name. handled: base properties. graded: what it can become.
   * attuned: what can land on it unseen. A trade pair also opens tiers of that
   * trade through the same door D26 built. Same reference back when nothing is new.
   */
  static revealByMastery(player: IPlayer, id: string, pack: IWebPack = current()): IPlayer {
    const skill = player.bank.universalSkills[id];
    if (!skill) return player;
    const { rung } = this.masteryOf(skill);
    const level = rung >= 3 ? 3 : rung >= 1 ? 2 : 1;
    const mastery = { ...player.materialMastery };
    let changed = false;
    for (const defId of this.materialsOf(skill.tags, pack)) {
      const prior = mastery[defId] ?? { resourceId: defId, knowledgeLevel: 0, discoveredAffixes: [] };
      const next = {
        ...prior,
        knowledgeLevel: Math.max(prior.knowledgeLevel, level),
        discoveredAffixes: rung >= 3 ? [...new Set([...prior.discoveredAffixes, ...this.hiddenPoolOf(defId)])] : prior.discoveredAffixes,
        ...(rung >= 2 ? { graded: true } : {})
      };
      if (JSON.stringify(next) !== JSON.stringify(mastery[defId])) {
        mastery[defId] = next;
        changed = true;
      }
    }
    let out: IPlayer = changed ? { ...player, materialMastery: mastery } : player;
    if (rung >= 2 && this.materialIdentity(skill.tags, pack).length > 0) {
      for (const trade of skill.tags.filter(t => WebBank.hasKind(pack, t, ['trade']))) {
        out = ProcessSystem.revealTier(out, trade as ProcessFamily, rung - 1);
      }
    }
    return out;
  }

  /** The card's reader. Nothing filed reads as the name alone. */
  static knowledgeReader(player: IPlayer): (defId: string) => number {
    return defId => player.materialMastery[defId]?.knowledgeLevel ?? 1;
  }

  /** What a graded hand reads on a material: what it goes into. */
  static becomes(defId: string, pack: IWebPack = current()): string[] {
    const recipes = [...Object.values(RECIPE_DEFINITIONS), ...pack.recipes];
    const out = recipes
      .filter(r => r.inputs.some(i => i.itemId === defId))
      .flatMap(r => r.outputs.map(o => (CRAFTED_DEFINITIONS[o.itemId] ?? RESOURCE_DEFINITIONS[o.itemId])?.name ?? o.itemId));
    return [...new Set(out)];
  }

  // -------------------------------------------------------------------------
  // THE WEB: a node's edges fall out of its tags
  // -------------------------------------------------------------------------

  static verbsOf(tags: string[], rung: number, pack: IWebPack = current()): string[] {
    const verbs = new Set<string>();
    for (const tool of pack.tools) {
      if (!tags.includes(tool.tag)) continue;
      for (const { verb, rung: at } of tool.verbs) if (at <= rung) verbs.add(verb);
    }
    for (const link of pack.verbLinks) {
      if (link.rung <= rung && link.tags.every(t => tags.includes(t))) verbs.add(link.verb);
    }
    return [...verbs];
  }

  private static connects(tags: string[], station: IWebStation): boolean {
    return station.connection.tool.some(t => tags.includes(t)) && station.connection.material.every(t => tags.includes(t));
  }

  static benchesOf(tags: string[], pack: IWebPack = current()): string[] {
    return pack.stations.filter(s => this.connects(tags, s)).map(s => s.id);
  }

  static nodeOf(id: string, pack: IWebPack = current()): ISkillNode {
    const tags = TagLaw.parseSkillId(id) ?? [];
    return {
      id,
      tags,
      name: this.nameOf(id, pack),
      tools: tags.filter(t => WebBank.hasKind(pack, t, ['tool', 'trade'])),
      actions: tags.filter(t => WebBank.hasKind(pack, t, ['action'])),
      materials: this.materialIdentity(tags, pack),
      verbs: this.verbsOf(tags, MASTERY_RUNGS.length - 1, pack),
      benches: this.benchesOf(tags, pack)
    };
  }

  /** Clause 6: the word attaches to the id. An unnamed pair reads as what it is. */
  static nameOf(id: string, pack: IWebPack = current()): string {
    const tags = TagLaw.parseSkillId(id);
    if (!tags) return id.replace(/^skill_/, '').replace(/_/g, ' ');
    const named = [...pack.names].reverse().find(n => {
      const set = TagLaw.canonical(n.tags);
      return set.length === tags.length && set.every((t, i) => t === tags[i]);
    });
    if (named) return named.name;
    const working = tags.filter(t => WebBank.hasKind(pack, t, ['tool', 'trade', 'action']));
    const worked = this.materialIdentity(tags, pack);
    if (working.length > 0 && worked.length > 0) return `${words(working).map(title).join(', ')} on ${words(worked).join(', ')}`;
    return words(tags).map(title).join(', ');
  }

  static flavorOf(id: string, pack: IWebPack = current()): string | undefined {
    const tags = TagLaw.parseSkillId(id);
    if (!tags) return undefined;
    return [...pack.names].reverse().find(n => {
      const set = TagLaw.canonical(n.tags);
      return set.length === tags.length && set.every((t, i) => t === tags[i]);
    })?.flavor;
  }

  /** Where a skill connects among the ones already known. Finite, and computed: nothing enumerates the web. */
  static placeInWeb(id: string, known: string[], pack: IWebPack = current()): IPlacement {
    const tags = TagLaw.parseSkillId(id) ?? [];
    const out: IPlacement = { narrower: [], broader: [], siblings: [], kin: [], connected: false };
    const myWorking = this.toolIdentity(tags, pack);
    const myWorked = this.materialIdentity(tags, pack);
    const myBenches = this.benchesOf(tags, pack);
    for (const other of known) {
      if (other === id) continue;
      const theirs = TagLaw.parseSkillId(other) ?? [];
      if (theirs.length === 0) continue;
      if (theirs.every(t => tags.includes(t))) { out.narrower.push(other); continue; }
      if (tags.every(t => theirs.includes(t))) { out.broader.push(other); continue; }
      if (myWorking.some(t => theirs.includes(t)) || this.benchesOf(theirs, pack).some(b => myBenches.includes(b))) out.siblings.push(other);
      if (myWorked.some(t => theirs.includes(t))) out.kin.push(other);
    }
    out.connected = out.narrower.length + out.broader.length + out.siblings.length + out.kin.length > 0;
    return out;
  }

  /** The verb is connected to the container of the skill, never a hardcoded gate. */
  static hasVerb(skills: Skills, verb: string, pack: IWebPack = current()): boolean {
    return this.heldSkills(skills).some(s => this.verbsOf(s.tags, this.masteryOf(s).rung, pack).includes(verb));
  }

  /** Every pair in this web that could ever carry this verb. */
  static skillsCarrying(verb: string, pack: IWebPack = current()): string[] {
    const top = MASTERY_RUNGS.length - 1;
    return WebBank.connections(pack)
      .map(c => c.skillId)
      .filter(id => this.verbsOf(TagLaw.parseSkillId(id)!, top, pack).includes(verb));
  }

  /** D25: what these hands open. Never a list: the connection against the tags. */
  static openStations(skills: Skills, pack: IWebPack = current()): IWebStation[] {
    const tagSets = this.heldSkills(skills).map(s => s.tags);
    return pack.stations.filter(station => tagSets.some(tags => this.connects(tags, station)));
  }

  /** The decision on the record: the web is the hub's. What anyone there knows opens for everyone there. */
  static openStationsOf(web: IHubWeb, skills: Skills, pack: IWebPack = current()): IWebStation[] {
    const tagSets = [...Object.values(web.nodes).map(n => n.tags), ...this.heldSkills(skills).map(s => s.tags)];
    return pack.stations.filter(station => tagSets.some(tags => this.connects(tags, station)));
  }

  // -------------------------------------------------------------------------
  // LOOT TEACHES: reverse engineering
  // -------------------------------------------------------------------------

  /** A piece, read back: the node it carries, and the connections its designs imply. */
  static reverseEngineer(item: IItem, pack: IWebPack = current()): { carried: string | null; designs: { skillId: string; tags: string[] }[] } {
    const tags = item.tags ?? [];
    const identity = TagLaw.canonical([...this.toolIdentity(tags, pack), ...this.materialIdentity(tags, pack)]);
    const seen = new Set<string>();
    const designs: { skillId: string; tags: string[] }[] = [];
    for (const design of pack.designs) {
      if (!design.matches.every(m => tags.includes(m))) continue;
      const set = TagLaw.canonical([design.tool, ...design.material]);
      const skillId = TagLaw.skillIdOf(set);
      if (seen.has(skillId)) continue;
      seen.add(skillId);
      designs.push({ skillId, tags: set });
    }
    return { carried: identity.length > 0 ? TagLaw.skillIdOf(identity) : null, designs };
  }

  // -------------------------------------------------------------------------
  // THE HUB'S WEB: who found it first (the donor's tech-lore)
  // -------------------------------------------------------------------------

  /**
   * Bring skills into a hub's web. This is one door for a player's emergence and
   * for Wave 11's person coming home: their skills extend the web, and their exp
   * stays theirs. The first keeps the claim; a higher rung is a new record.
   */
  /** Q9: one skill, one name in this hub: the first one's, where they named it, and the bank's words otherwise. */
  static nameIn(id: string, web: IHubWeb | undefined, pack: IWebPack = current()): string {
    return web?.nodes[id]?.name ?? this.nameOf(id, pack);
  }

  static admit(web: IHubWeb, who: { uid: string; name: string }, skills: Skills, at: number, words?: Record<string, { name: string; flavor?: string; grants?: string[] }>): { web: IHubWeb; firsts: string[]; records: { id: string; rung: number }[] } {
    const nodes = { ...web.nodes };
    const firsts: string[] = [];
    const records: { id: string; rung: number }[] = [];
    for (const skill of this.heldSkills(skills)) {
      const { rung } = this.masteryOf(skill);
      const prior = nodes[skill.id];
      const credit: IWebCredit = { uid: who.uid, name: who.name, at };
      if (!prior) {
        const named = words?.[skill.id];
        nodes[skill.id] = {
          id: skill.id, tags: skill.tags, rank: skill.rank ?? 0, firstBy: credit, rungRecord: { ...credit, rung },
          ...(named?.name?.trim() ? { name: named.name, ...(named.flavor ? { flavor: named.flavor } : {}) } : {})
        };
        firsts.push(skill.id);
        if (rung > 0) records.push({ id: skill.id, rung });
      } else if (rung > prior.rungRecord.rung) {
        nodes[skill.id] = { ...prior, rungRecord: { ...credit, rung } };
        records.push({ id: skill.id, rung });
      }
    }
    return { web: { ...web, nodes }, firsts, records };
  }

  // -------------------------------------------------------------------------
  // WHAT THE AGENT TAB READS. It carries no affix and no bar a player could read.
  // -------------------------------------------------------------------------

  static earnedSheet(player: IPlayer, pack: IWebPack = current(), web: IHubWeb = { nodes: {} }): IEarnedSheet {
    const held = this.heldSkills(player.bank.universalSkills);
    const earned: IEarnedRow[] = held
      .map(skill => {
        const mastery = this.masteryOf(skill);
        const node = this.nodeOf(skill.id, pack);
        return {
          id: skill.id,
          rank: ProgressionSystem.skillRankOf(skill),
          circles: skill.circles ?? 0,
          // What a rest's model called it, if one has (D58, D118): the sheet says the same name the feed did
          name: player.skillWords?.[skill.id]?.name ?? web.nodes[skill.id]?.name ?? node.name,
          flavor: player.skillWords?.[skill.id]?.flavor ?? web.nodes[skill.id]?.flavor ?? this.flavorOf(skill.id, pack),
          rung: mastery.rung,
          rungName: mastery.rungName,
          into: mastery.into,
          level: skill.level,
          tools: words(node.tools),
          materials: words(node.materials),
          verbs: words(this.verbsOf(skill.tags, mastery.rung, pack)),
          opens: node.benches.map(id => pack.stations.find(s => s.id === id)!.name),
          firstBy: web.nodes[skill.id]?.firstBy.name
        };
      })
      .sort((a, b) => b.rung - a.rung || (a.name < b.name ? -1 : 1));
    const forming: IFormingRow[] = Object.values(player.skillProgress ?? {})
      .map(progress => {
        const working = this.toolIdentity(progress.tags, pack);
        const worked = this.materialIdentity(progress.tags, pack);
        return {
          name: this.nameOf(progress.id, pack),
          tool: working.length > 0 ? words(working).join(', ') : 'bare hands',
          worked: words(worked).join(', '),
          fill: this.emergenceFill(progress)
        };
      })
      .sort((a, b) => b.fill - a.fill || (a.name < b.name ? -1 : 1));
    const opens = this.openStationsOf(web, player.bank.universalSkills, pack)
      .map(s => ({ id: s.id, name: s.name, description: s.description }));
    return { earned, forming, opens };
  }

  // -------------------------------------------------------------------------
  // MIGRATION: existing saves arrive without loss, and only once
  // -------------------------------------------------------------------------

  /** Pure and idempotent. Old tracks land on the identity their own record names. */
  static migrate(player: IPlayer, pack: IWebPack = current()): IPlayer {
    const skills = player.bank.universalSkills ?? {};
    const out: Skills = {};
    let moved = false;
    for (const [oldId, skill] of Object.entries(skills)) {
      if (skill.legacy || this.isLawfulId(oldId, pack)) {
        if (out[oldId]) out[oldId] = this.merge(out[oldId], skill);
        else out[oldId] = skill;
        continue;
      }
      const tags = this.legacyIdentity(oldId, skill, pack);
      moved = true;
      if (tags.length === 0) {
        out[oldId] = { ...skill, legacy: true };
        continue;
      }
      const id = TagLaw.skillIdOf(tags);
      const landed: ISkillState = { ...skill, id, tags };
      out[id] = out[id] ? this.merge(out[id], landed) : landed;
    }
    return moved ? { ...player, bank: { ...player.bank, universalSkills: out } } : player;
  }

  /** Two old tracks on one identity lose nothing: the work adds, the first origin stays. */
  private static merge(a: ISkillState, b: ISkillState): ISkillState {
    const rank = Math.max(a.rank ?? 0, b.rank ?? 0);
    const bornRank = Math.max(ProgressionSystem.skillRarity(a), ProgressionSystem.skillRarity(b));
    return this.withCumulativeXp({ ...a, rank, bornRank }, this.cumulativeXp(a) + this.cumulativeXp(b));
  }

  private static legacyIdentity(oldId: string, skill: ISkillState, pack: IWebPack): string[] {
    const fixed = LEGACY_SKILLS[oldId];
    if (fixed) return TagLaw.canonical(fixed);
    const lifted = (tag: string) => WebBank.tagEntry(pack, tag)?.retired?.replacedBy ?? tag;
    const recorded = (skill.tags ?? []).map(lifted).filter(t => WebBank.isIdentityTag(pack, t));
    if (recorded.length > 0) return TagLaw.canonical(recorded);
    const theory = oldId.match(/^skill_(.+)_theory$/)?.[1];
    if (theory && WebBank.isIdentityTag(pack, lifted(theory))) return [lifted(theory)];
    return [];
  }
}

// The one closed table in the web's law: dead ids of the old fixed skill list, read
// by migration and nothing else. Nothing mints through it and it can never grow.
// <legacy-table>
const LEGACY_SKILLS: Record<string, string[]> = {
  skill_swordsmanship: ['blade', 'melee'],
  skill_bludgeoning: ['blunt', 'melee'],
  skill_ballistics: ['projectile', 'ranged', 'tech'],
  skill_pyromancy: ['fire', 'magic'],
  skill_pain_tolerance: ['defense'],
  skill_aegis: ['block', 'defense'],
  skill_athletics: ['sprint'],
  skill_covert_ops: ['stealth'],
  skill_archaeology: ['ancient', 'analysis'],
  skill_reverse_engineering: ['analysis', 'tech'],
  skill_appraisal: ['analysis']
};
// </legacy-table>

/** Rank index of a definition, for what a pair is working on. */
export const rankIndexOf = (rank: UniversalRank | string | undefined): number => ProgressionSystem.rankIndex(rank ?? UniversalRank.F);
