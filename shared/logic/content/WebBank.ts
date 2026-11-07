/**
 * THE WEB BANK (D27, under D20's batch law and D28's tag law)
 *
 * The technology web's content lives here as batched runs, each validated whole
 * against what the bank already holds: a broken entry refuses the whole batch,
 * clean siblings falling with it. A world pins the version at mint, so a later
 * batch never changes a person in an existing world.
 *
 * NO CAPS (D29). Nothing here limits tools, materials, tags, skills, verbs or
 * edges, and no table in this file names any of them. What connects to what
 * comes from each entry's own tags, so new connections arrive as content.
 * Validation stays linear on purpose: a run of thousands compiles like a run of ten.
 *
 * D20 keeps the runs at dev time. Nothing here calls a model at run time.
 */

import {
  IItem, ITagEntry, IWebBatch, IWebMaterial, IWebPack, IWebTool, SlotType,
  TAG_KIND_IDENTITY, TagKind, UniversalRank
} from '../../types';
import { WEB_BATCHES } from '../../entities/generation/packs/webBatches';
import { AFFIX_BATCHES } from '../../entities/generation/packs/affixBatches';
import { AFFIX_DEFINITIONS } from '../../entities/item/data/affixDefinitions';
import { ITEM_DEFINITIONS, CRAFTED_GEAR_BASES, ItemDefinition } from '../../entities/item/data/itemDefinitions';
import { RESOURCE_DEFINITIONS } from '../../entities/item/data/resourceDefinitions';
import { CRAFTED_DEFINITIONS } from '../../entities/economy/data/recipeDefinitions';
import { MOB_DEFINITIONS } from '../../entities/mob/data/mobDefinitions';
import { ItemFactory } from '../../entities/item/ItemFactory';
import { SeededRNG } from '../rng/DeterministicRNG';
import { TagLaw } from './TagLaw';

export interface WebVerdict {
  ok: boolean;
  reason?: string;
}

const OK: WebVerdict = { ok: true };
const no = (reason: string): WebVerdict => ({ ok: false, reason });

/** The kinds a tool line, or a connection's tool, may name. */
const WORKING_KINDS = new Set<TagKind>(['tool', 'trade', 'action']);
/** The kinds that say what was worked. */
const WORKED_KINDS = new Set<TagKind>(['family', 'material']);

/** Tag lookups, built once per pack: a registry of any size answers in constant time. */
interface PackIndex {
  byTag: Map<string, ITagEntry>;
  byVariant: Map<string, string>;
  refused: Map<string, string>;
  meanings: Set<string>;
}

const indexes = new WeakMap<IWebPack, PackIndex>();

function buildIndex(tags: ITagEntry[]): PackIndex {
  const index: PackIndex = { byTag: new Map(), byVariant: new Map(), refused: new Map(), meanings: new Set() };
  for (const entry of tags) addToIndex(index, entry);
  return index;
}

function addToIndex(index: PackIndex, entry: ITagEntry): void {
  index.byTag.set(entry.tag, entry);
  for (const key of TagLaw.variantKeys(entry.tag)) index.byVariant.set(key, entry.tag);
  for (const word of entry.refuses ?? []) index.refused.set(TagLaw.normalize(word), entry.tag);
  index.meanings.add(entry.meaning.trim().toLowerCase());
}

function indexOf(pack: IWebPack): PackIndex {
  let index = indexes.get(pack);
  if (!index) {
    index = buildIndex(pack.tags);
    indexes.set(pack, index);
  }
  return index;
}

const emptyPack = (): IWebPack => ({
  packId: 'pack_web_bank', version: 0, batches: [], tags: [], tools: [], materials: [], goods: [],
  stations: [], recipes: [], designs: [], verbLinks: [], names: []
});

const definitionTags = (def: { tags?: string[] }): string[] => def.tags ?? [];

export class WebBank {

  // ---------------------------------------------------------------------
  // THE LAW: one batch, judged whole against what the bank holds
  // ---------------------------------------------------------------------

  static validateBatch(batch: IWebBatch, prior: IWebPack, alsoKnown?: Set<string>): WebVerdict {
    return this.judge(batch, prior, indexOf(prior), alsoKnown);
  }

  private static judge(batch: IWebBatch, prior: IWebPack, priorIndex: PackIndex, alsoKnown?: Set<string>): WebVerdict {
    const refuse = (why: string) => no(`Batch ${batch.runId} refused whole: ${why}`);
    if (!batch.runId?.trim()) return no('A batch with no run id is not a run.');
    if (!batch.model?.trim()) return refuse('it names no model. Who ran it stays on the record.');
    if (prior.batches.some(b => b.runId === batch.runId)) return refuse('that run is already banked. The first keeps its claim.');

    const contentful = (batch.tags?.length ?? 0) + (batch.retire?.length ?? 0) + (batch.tools?.length ?? 0) + (batch.materials?.length ?? 0)
      + (batch.goods?.length ?? 0) + (batch.stations?.length ?? 0) + (batch.recipes?.length ?? 0) + (batch.designs?.length ?? 0)
      + (batch.verbLinks?.length ?? 0) + (batch.names?.length ?? 0);
    if (contentful === 0) return no(`Batch ${batch.runId} holds nothing. An empty run is not a run.`);

    // CLAUSES 1 AND 2: the registry grows by normal, unique, one-meaning entries
    const added = new Map<string, ITagEntry>();
    const addedVariants = new Map<string, string>();
    const addedMeanings = new Set<string>();
    const addedRefused = new Map<string, string>();
    for (const entry of batch.tags ?? []) {
      if (!TagLaw.isCanonicalSpelling(entry.tag)) return refuse(`"${entry.tag}" is not the normal spelling of a tag.`);
      if (!(entry.kind in TAG_KIND_IDENTITY)) return refuse(`${entry.tag} names no kind the law knows.`);
      const meaning = entry.meaning?.trim().toLowerCase();
      if (!meaning || meaning.includes('\n')) return refuse(`${entry.tag} needs a one-line meaning.`);
      if (priorIndex.meanings.has(meaning) || addedMeanings.has(meaning)) return refuse(`${entry.tag} claims a meaning another tag already holds.`);
      const saidBy = priorIndex.refused.get(entry.tag) ?? addedRefused.get(entry.tag);
      if (saidBy) return refuse(`"${entry.tag}" means ${saidBy}. It says so in the registry, and one thing has one tag.`);
      for (const key of TagLaw.variantKeys(entry.tag)) {
        const held = priorIndex.byVariant.get(key) ?? addedVariants.get(key);
        if (held) return refuse(`"${entry.tag}" is a variant of "${held}". A tag has one spelling, forever.`);
        addedVariants.set(key, entry.tag);
      }
      for (const word of entry.refuses ?? []) addedRefused.set(TagLaw.normalize(word), entry.tag);
      added.set(entry.tag, entry);
      addedMeanings.add(meaning);
    }

    const entryOf = (tag: string): ITagEntry | undefined => added.get(tag) ?? priorIndex.byTag.get(tag);
    const unregistered = (tags: string[]): string | undefined => tags.find(t => !entryOf(t));
    const kindIn = (tag: string, kinds: Set<TagKind>) => {
      const entry = entryOf(tag);
      return !!entry && kinds.has(entry.kind);
    };

    for (const retire of batch.retire ?? []) {
      if (!entryOf(retire.tag)) return refuse(`${retire.tag} cannot be retired: it was never registered.`);
      if (retire.replacedBy && !entryOf(retire.replacedBy)) return refuse(`${retire.tag} is replaced by a tag nobody registered.`);
    }

    // Everything must stand on known ground, in this batch or in the bank.
    const taken = new Set<string>([
      ...prior.tools.map(t => t.id), ...prior.materials.map(m => m.id), ...prior.goods.map(g => g.id),
      ...prior.stations.map(s => s.id), ...prior.recipes.map(r => r.id)
    ]);
    const claim = (id: string): boolean => {
      if (!id?.trim() || taken.has(id)) return false;
      taken.add(id);
      return true;
    };
    const known = new Set<string>([
      ...prior.materials.map(m => m.id), ...prior.goods.map(g => g.id), ...prior.stations.map(s => s.id),
      ...(batch.materials ?? []).map(m => m.id), ...(batch.goods ?? []).map(g => g.id), ...(batch.stations ?? []).map(s => s.id)
    ]);
    const exists = (id: string) => known.has(id) || !!alsoKnown?.has(id) || id in RESOURCE_DEFINITIONS || id in CRAFTED_DEFINITIONS;

    for (const tool of batch.tools ?? []) {
      if (!claim(tool.id)) return refuse(`${tool.id} is already in the web, or has no id.`);
      if (!kindIn(tool.tag, new Set<TagKind>(['tool']))) return refuse(`${tool.id}: ${tool.tag} is not a tool in the registry.`);
      const stray = unregistered(tool.works);
      if (stray) return refuse(`${tool.id} works "${stray}", which is not registered.`);
      if (!tool.works.every(t => kindIn(t, WORKED_KINDS))) return refuse(`${tool.id} must work materials.`);
      for (const { verb, rung } of tool.verbs) {
        if (!kindIn(verb, new Set<TagKind>(['verb']))) return refuse(`${tool.id}: "${verb}" is not a registered verb.`);
        if (!Number.isInteger(rung) || rung < 0) return refuse(`${tool.id}: "${verb}" opens at no rung.`);
      }
      if (!tool.existing && (!tool.powerStat || !tool.basePower)) return refuse(`${tool.id} is new and says nothing of its power.`);
    }

    for (const material of [...(batch.materials ?? []), ...(batch.goods ?? [])]) {
      if (!claim(material.id)) return refuse(`${material.id} is already in the web, or has no id.`);
      const stray = unregistered(material.tags);
      if (stray) return refuse(`${material.id} is tagged "${stray}", which is not registered.`);
      if (!material.tags.some(t => kindIn(t, WORKED_KINDS))) return refuse(`${material.id} has no tag that identifies it. Identity is the point.`);
    }

    for (const station of batch.stations ?? []) {
      if (!claim(station.id)) return refuse(`${station.id} is already in the web, or has no id.`);
      if (station.connection.tool.length === 0) return refuse(`${station.id} connects no tool. D25: tool + material, connected.`);
      if (station.connection.material.length === 0) return refuse(`${station.id} connects no material. D25: tool + material, connected.`);
      if (!station.connection.tool.every(t => kindIn(t, WORKING_KINDS))) return refuse(`${station.id}: its connection's tool is not a tool.`);
      if (!station.connection.material.every(t => kindIn(t, WORKED_KINDS))) return refuse(`${station.id}: its connection's material is not a material.`);
      const stray = unregistered(station.bill.map(line => line.tag));
      if (stray) return refuse(`${station.id} bills "${stray}", which is not registered.`);
      if (!(station.minArea > 0)) return refuse(`${station.id} needs a minimum area.`);
    }

    for (const recipe of batch.recipes ?? []) {
      if (!claim(recipe.id)) return refuse(`${recipe.id} is already in the web, or has no id.`);
      if (!known.has(recipe.requiredStation)) return refuse(`${recipe.id} stands at ${recipe.requiredStation}, which nobody raised.`);
      for (const line of [...recipe.inputs, ...recipe.outputs]) {
        if (!exists(line.itemId)) return refuse(`${recipe.id} names ${line.itemId}, which does not exist.`);
      }
      if (!kindIn(recipe.trade, new Set<TagKind>(['trade']))) return refuse(`${recipe.id}: ${recipe.trade} is not a trade.`);
      if (recipe.requiresVerb && !kindIn(recipe.requiresVerb, new Set<TagKind>(['verb']))) return refuse(`${recipe.id}: "${recipe.requiresVerb}" is not a registered verb.`);
    }

    for (const design of batch.designs ?? []) {
      const stray = unregistered([...design.matches, design.tool, ...design.material]);
      if (stray) return refuse(`a design names "${stray}", which is not registered.`);
      if (!kindIn(design.tool, WORKING_KINDS)) return refuse(`a design's tool "${design.tool}" is not a tool.`);
      if (!design.material.every(t => kindIn(t, WORKED_KINDS))) return refuse(`a design's material is not a material.`);
    }

    for (const link of batch.verbLinks ?? []) {
      const stray = unregistered([...link.tags, link.verb]);
      if (stray) return refuse(`a verb link names "${stray}", which is not registered.`);
      if (!kindIn(link.verb, new Set<TagKind>(['verb']))) return refuse(`"${link.verb}" is not a registered verb.`);
      if (!link.tags.every(t => TAG_KIND_IDENTITY[entryOf(t)!.kind])) return refuse(`a verb link on "${link.verb}" hangs on a tag that identifies nothing.`);
    }

    // Clause 6: the word attaches to an id, and every tag behind it must identify.
    for (const named of batch.names ?? []) {
      if (!named.name?.trim()) return refuse('a name with no word in it.');
      const stray = unregistered(named.tags);
      if (stray) return refuse(`the name "${named.name}" hangs on "${stray}", which is not registered.`);
      if (!named.tags.every(t => TAG_KIND_IDENTITY[entryOf(t)!.kind])) {
        return refuse(`the name "${named.name}" smuggles a tag that does not identify. Only identity tags identify.`);
      }
    }

    return OK;
  }

  // ---------------------------------------------------------------------
  // COMPILING: batches fold into versions; any broken batch refuses the pack
  // ---------------------------------------------------------------------

  static compile(batches: IWebBatch[]): { ok: boolean; reason?: string; pack?: IWebPack } {
    const pack = emptyPack();
    const index = buildIndex([]);
    const seenPrior: IWebPack = pack;
    for (const batch of batches) {
      const verdict = this.judge(batch, seenPrior, index);
      if (!verdict.ok) return { ok: false, reason: verdict.reason };
      for (const entry of batch.tags ?? []) {
        pack.tags.push({ ...entry });
        addToIndex(index, entry);
      }
      for (const retire of batch.retire ?? []) {
        const entry = pack.tags.find(e => e.tag === retire.tag)!;
        entry.retired = { runId: batch.runId, replacedBy: retire.replacedBy, why: retire.why };
      }
      for (const key of ['tools', 'materials', 'goods', 'stations', 'recipes', 'designs', 'verbLinks', 'names'] as const) {
        const entries = batch[key];
        if (entries) for (const entry of entries) (pack[key] as unknown[]).push(entry);
      }
      pack.batches.push({ runId: batch.runId, model: batch.model, ranAt: batch.ranAt });
      pack.version = pack.batches.length;
    }
    indexes.set(pack, index);
    return { ok: true, pack };
  }

  private static versions = new Map<number, IWebPack>();

  /** The web as of a version: the first `version` shipped batches, folded. */
  static packAt(version: number): IWebPack | null {
    if (version < 1 || version > WEB_BATCHES.length) return null;
    const held = this.versions.get(version);
    if (held) return held;
    const result = this.compile(WEB_BATCHES.slice(0, version));
    if (!result.ok) return null;
    this.versions.set(version, result.pack!);
    return result.pack!;
  }

  /** The latest web the shipped batches make. The shipped runs must be lawful. */
  static current(): IWebPack {
    const pack = this.packAt(WEB_BATCHES.length);
    if (!pack) throw new Error(`The shipped web batches break their own law: ${this.compile(WEB_BATCHES).reason}`);
    return pack;
  }

  static version(): number {
    return WEB_BATCHES.length;
  }

  // ---------------------------------------------------------------------
  // READING THE REGISTRY
  // ---------------------------------------------------------------------

  static tagEntry(pack: IWebPack, tag: string): ITagEntry | undefined {
    return indexOf(pack).byTag.get(tag);
  }

  /** Clause 5: each kind states whether it identifies. */
  static isIdentityTag(pack: IWebPack, tag: string): boolean {
    const entry = this.tagEntry(pack, TagLaw.normalize(tag));
    return !!entry && TAG_KIND_IDENTITY[entry.kind];
  }

  static hasKind(pack: IWebPack, tag: string, kinds: TagKind[]): boolean {
    const entry = this.tagEntry(pack, TagLaw.normalize(tag));
    return !!entry && kinds.includes(entry.kind);
  }

  /** Clause 7: every tag in every definition and every batch, against the registry. */
  static unregisteredTags(pack: IWebPack): string[] {
    const index = indexOf(pack);
    const stray = new Set<string>();
    const check = (where: string, tags: string[] | undefined) => {
      for (const tag of tags ?? []) if (!index.byTag.has(tag)) stray.add(`${where}: ${tag}`);
    };
    for (const def of [...Object.values(RESOURCE_DEFINITIONS), ...Object.values(CRAFTED_DEFINITIONS)]) {
      check(def.id, definitionTags(def));
      check(def.id, def.harvestConfig?.requiredToolTags);
    }
    const bases: ItemDefinition[] = [...ITEM_DEFINITIONS.weapon_bases, ...ITEM_DEFINITIONS.armor_bases, ...ITEM_DEFINITIONS.tool_bases, ...CRAFTED_GEAR_BASES];
    for (const base of bases) {
      check(base.id, base.tags);
      check(base.id, base.pouch?.accepts);
    }
    for (const mob of Object.values(MOB_DEFINITIONS) as { id: string; tags?: string[] }[]) check(mob.id, mob.tags);
    for (const affix of [...AFFIX_DEFINITIONS.prefixes, ...AFFIX_DEFINITIONS.suffixes] as { id: string; allowedTags?: string[] }[]) check(affix.id, affix.allowedTags);
    for (const batch of AFFIX_BATCHES) for (const entry of batch.names ?? []) check(entry.id, entry.allowedTags);
    for (const material of [...pack.materials, ...pack.goods]) check(material.id, material.tags);
    for (const tool of pack.tools) check(tool.id, [tool.tag, ...tool.works]);
    return [...stray].sort();
  }

  // ---------------------------------------------------------------------
  // WHAT CONNECTS TO WHAT, derived. Never a table.
  // ---------------------------------------------------------------------

  private static get allWebIds(): Set<string> {
    return new Set<string>(WEB_BATCHES.flatMap(b => [...(b.goods ?? []), ...(b.materials ?? []), ...(b.stations ?? [])].map(e => e.id)));
  }

  /** What can be worked, as of this pack: the standing definitions, plus what this pack added. */
  static workableMaterials(pack: IWebPack): { id: string; tags: string[]; requiredTools: string[]; rank: UniversalRank }[] {
    const standing = [...Object.values(RESOURCE_DEFINITIONS), ...Object.values(CRAFTED_DEFINITIONS)]
      .filter(def => !this.allWebIds.has(def.id) && def.type !== 'STRUCTURE');
    return [
      ...standing.map(def => ({ id: def.id, tags: definitionTags(def), requiredTools: def.harvestConfig?.requiredToolTags ?? [], rank: def.rank ?? UniversalRank.F })),
      ...[...pack.materials, ...pack.goods].map((m: IWebMaterial) => ({ id: m.id, tags: m.tags, requiredTools: [], rank: m.rank }))
    ].sort((a, b) => (a.id < b.id ? -1 : 1));
  }

  /** The identity tags of a material, by the registry and nothing else. */
  static workedTags(pack: IWebPack, tags: string[]): string[] {
    return TagLaw.canonical(tags).filter(t => this.hasKind(pack, t, [...WORKED_KINDS]));
  }

  /**
   * Every tool + material pair this web can mint. A pair connects when the
   * material names the tool in its own harvest config, or the tool's own `works`
   * names a tag the material carries, or the material is gathered by hand (the
   * hand adds nothing). Linear in the number of entries: indexed by tag.
   */
  static connections(pack: IWebPack): { tool: string | null; materialDefId: string; skillId: string }[] {
    const materials = this.workableMaterials(pack);
    const byTag = new Map<string, typeof materials>();
    for (const material of materials) {
      for (const tag of material.tags) {
        if (!byTag.has(tag)) byTag.set(tag, []);
        byTag.get(tag)!.push(material);
      }
    }
    const out = new Map<string, { tool: string | null; materialDefId: string; skillId: string }>();
    const add = (tool: string | null, material: typeof materials[number]) => {
      const worked = this.workedTags(pack, material.tags);
      if (worked.length === 0) return;
      const skillId = TagLaw.skillIdOf(tool ? [tool, ...worked] : worked);
      if (!out.has(skillId)) out.set(skillId, { tool, materialDefId: material.id, skillId });
    };
    for (const material of materials) {
      const required = material.requiredTools.filter(t => this.hasKind(pack, t, ['tool']));
      if (required.length > 0) required.forEach(tool => add(tool, material));
      else if (material.requiredTools.length === 0 && material.id in RESOURCE_DEFINITIONS) add(null, material);
    }
    for (const tool of pack.tools) {
      for (const tag of tool.works) for (const material of byTag.get(tag) ?? []) add(tool.tag, material);
    }
    return [...out.values()].sort((a, b) => (a.skillId < b.skillId ? -1 : 1));
  }

  // ---------------------------------------------------------------------
  // WHAT THE CONTENT MINTS
  // ---------------------------------------------------------------------

  static tool(pack: IWebPack, id: string): IWebTool | undefined {
    return pack.tools.find(t => t.id === id);
  }

  static recipe(id: string) {
    return this.current().recipes.find(r => r.id === id);
  }

  /** A tool only a batch has heard of, as a real item, through the factory's one door. */
  static mintTool(pack: IWebPack, id: string, rng: SeededRNG): IItem {
    const tool = this.tool(pack, id);
    if (!tool) throw new Error(`No tool ${id} in this web.`);
    if (tool.existing) return ItemFactory.createItem(tool.rank, true, rng, 'tool', id);
    const base = tool.basePower ?? 10;
    const template: ItemDefinition = {
      id: tool.id,
      universal_name: tool.name,
      rank: tool.rank,
      base_ip: 15,
      slot: SlotType.ACCESSORY,
      tags: ['tool', tool.tag],
      implicits: [{ stat: tool.powerStat ?? 'chopping_power', min: base, max: Math.ceil(base * 1.3) }]
    };
    return ItemFactory.createFromTemplate(template, true, rng);
  }
}
