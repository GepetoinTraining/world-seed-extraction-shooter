/**
 * THE REGISTRY (D53): the one way content reaches the game.
 *
 * A theme is judged by the law, compiled by the formula and merged into the shared
 * records every system already reads. A world reads only its own theme, by the id
 * pinned on its certificate, so a later theme can never move a standing world. An
 * item keeps working anywhere, because the definitions of every theme stay known
 * here and an item carries its own words (D55's common market).
 */

import { IContentPack, IBankedAffix, IWebBatch, UniversalRank } from '../../../types';
import { MOB_DEFINITIONS } from '../../entities/mob/data/mobDefinitions';
import { CRAFTED_GEAR_BASES, ITEM_DEFINITIONS } from '../../entities/item/data/itemDefinitions';
import { RESOURCE_DEFINITIONS, BIOME_RESOURCES } from '../../entities/item/data/resourceDefinitions';
import { AFFIX_BATCHES } from '../../entities/generation/packs/affixBatches';
import { WEB_BATCHES } from '../../entities/generation/packs/webBatches';
import { GEAR_RECIPES, RECIPE_DEFINITIONS, CRAFTED_DEFINITIONS, absorbWebBatch } from '../../entities/economy/data/recipeDefinitions';
import { registerCompositionDefs } from '../economy/CompositionSystem';
import { WebBank } from '../content/WebBank';
import { AffixBank } from '../content/AffixBank';
import type { IGenerationContext } from '../../entities/world/WorldGenerator';
import type { IDirectorRecord } from '../../entities/world/Director';
import { ICompiledTheme, IAbility, bodyOf, compileTheme, themeIdOf } from './ThemeCompiler';
import { IThemeBody, IThemePack } from './ThemeTypes';
import { IThemeVerdict, ThemeLaw } from './ThemeLaw';
import { SHELF } from './shelf';

const installed = new Map<string, { pack: IThemePack; compiled: ICompiledTheme }>();
const ABILITIES: Record<string, IAbility> = {};
let firstThemeId: string | undefined;

export class ContentRegistry {

  /** Is this word in the registry, or a word the law has retired? */
  private static registered(tag: string): boolean {
    return WebBank.current().tags.some(t => t.tag === tag && !t.retired);
  }

  /** A word already in the registry keeps its first meaning: a later theme uses it, and does not redefine it. */
  private static newWordsOnly(batch: IWebBatch): IWebBatch {
    return { ...batch, tags: (batch.tags ?? []).filter(t => !this.registered(t.tag)) };
  }

  /** The law alone: nothing changes. What a mint's preview asks. */
  static judge(body: IThemeBody): IThemeVerdict {
    if (installed.has(themeIdOf(body))) return { ok: true };
    const verdict = ThemeLaw.validate(bodyOf(body), tag => this.registered(tag), (body as Partial<IThemePack>).formula);
    if (!verdict.ok) return verdict;
    // The web's own law sits behind the theme's: the tag law, on what it adds
    const compiled = compileTheme({ ...bodyOf(body), themeId: themeIdOf(body), formula: 1, model: 'judging', writtenAt: 0 });
    // A theme's own goods and materials are not in the tables until it is installed
    const own = new Set([...Object.keys(compiled.resources), ...Object.keys(compiled.crafted)]);
    const webVerdict = WebBank.validateBatch(this.newWordsOnly(compiled.webBatch), WebBank.current(), own);
    return webVerdict.ok ? { ok: true } : { ok: false, reason: webVerdict.reason };
  }

  /** Install a pack: judged, compiled, merged. Idempotent, and refused whole when broken. */
  static install(pack: IThemePack): IThemeVerdict {
    if (installed.has(pack.themeId)) return { ok: true };
    if (themeIdOf(pack) !== pack.themeId) return { ok: false, reason: 'Theme refused whole: its id does not match its words.' };
    const verdict = this.judge(pack);
    if (!verdict.ok) return verdict;

    const compiled = compileTheme(pack);
    Object.assign(MOB_DEFINITIONS, compiled.mobs);
    Object.assign(RESOURCE_DEFINITIONS, compiled.resources);
    Object.assign(RECIPE_DEFINITIONS, compiled.recipes);
    Object.assign(CRAFTED_DEFINITIONS, compiled.crafted);
    ITEM_DEFINITIONS.weapon_bases.push(...compiled.items.weapon_bases);
    ITEM_DEFINITIONS.armor_bases.push(...compiled.items.armor_bases);
    ITEM_DEFINITIONS.tool_bases.push(...compiled.items.tool_bases);
    CRAFTED_GEAR_BASES.push(...compiled.craftedGear);
    Object.assign(GEAR_RECIPES, compiled.gearRecipes);
    for (const def of Object.values(compiled.resources)) {
      if (def.rareFind) continue;
      for (const biome of def.habitat ?? []) (BIOME_RESOURCES[biome] ??= []).push(def.id);
    }
    AFFIX_BATCHES.push(...compiled.affixBatches);
    const webBatch = this.newWordsOnly(compiled.webBatch);
    WEB_BATCHES.push(webBatch);
    absorbWebBatch(webBatch);
    registerCompositionDefs(compiled.crafted);
    registerCompositionDefs(compiled.resources);
    Object.assign(ABILITIES, compiled.abilities);
    SHELF.tools.push(...compiled.shelf.tools);
    SHELF.carrier.push(...compiled.shelf.carrier);
    SHELF.wardrobe.push(...compiled.shelf.wardrobe);
    SHELF.consumables.push(...compiled.shelf.consumables);
    SHELF.materials.push(...compiled.shelf.materials);
    installed.set(pack.themeId, { pack, compiled });
    firstThemeId ??= pack.themeId;
    return { ok: true };
  }

  static get(themeId: string | undefined): IThemePack | undefined {
    return themeId ? installed.get(themeId)?.pack : undefined;
  }

  static compiled(themeId: string | undefined): ICompiledTheme | undefined {
    return themeId ? installed.get(themeId)?.compiled : undefined;
  }

  static list(): IThemePack[] {
    return [...installed.values()].map(i => i.pack);
  }

  /** What the mint offers. An older printing of the current theme stays installed for the worlds pinned to it, and is not offered. */
  static offered(): IThemePack[] {
    const current = this.get(firstThemeId);
    return this.list().filter(p => !current || p.themeId === current.themeId || p.name !== current.name);
  }

  /** The theme a world with no talk behind it pins: the first the hub holds. */
  static defaultThemeId(): string | undefined {
    return firstThemeId;
  }

  static ability(id: string): IAbility | undefined {
    return ABILITIES[id];
  }

  /** What a world builds its chunks from: its own theme and nothing else, at its own difficulty. */
  static contextFor(themeId: string | undefined, difficulty?: UniversalRank | string, director?: IDirectorRecord, magicUnlocked = false): IGenerationContext {
    const own = <T extends { themeId?: string }>(defs: T[]) => defs.filter(d => d.themeId === themeId);
    const mobs = own(Object.values(MOB_DEFINITIONS) as { themeId?: string }[]);
    const resources = own(Object.values(RESOURCE_DEFINITIONS) as { themeId?: string }[]);
    const context: IGenerationContext = { mobDefinitions: mobs, resourceDefinitions: resources, difficulty: difficulty as UniversalRank | undefined, themeId };
    if (director && director.generation > 0) {
      context.director = director;
      const compiled = this.compiled(themeId);
      context.directorPool = {
        // D49: only once magic is unlocked do prefixes and suffixes reach a monster
        affixes: magicUnlocked ? this.affixEntries(themeId).filter(e => e.allowedTags.includes('mob')) : [],
        abilities: compiled ? Object.keys(compiled.abilities).sort() : []
      };
    }
    return context;
  }

  static lore(themeId: string | undefined): string[] {
    return this.get(themeId)?.lore ?? [];
  }

  static regionName(themeId: string | undefined, biome: string): string | undefined {
    return this.get(themeId)?.regions.find(r => r.biome === biome)?.name;
  }

  /** A theme's bank as a pack, for the dream: its own entries only, with effects folded in. */
  static dreamPack(themeId: string | undefined): IContentPack | null {
    const compiled = this.compiled(themeId);
    if (!compiled || compiled.affixBatches.length === 0) return null;
    const result = AffixBank.compile(compiled.affixBatches);
    return result.ok ? result.pack! : null;
  }

  static affixEntries(themeId: string | undefined): IBankedAffix[] {
    return this.dreamPack(themeId)?.entries ?? [];
  }
}
