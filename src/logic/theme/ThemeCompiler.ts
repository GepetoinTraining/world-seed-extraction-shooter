/**
 * THE COMPILER: a theme's words become the definitions the game already reads.
 *
 * Pure and deterministic: the same pack and formula version give the same bytes
 * on every machine. Nothing else turns a band into a number.
 */

import { IAffixBatch, IWebBatch, ItemType, Rarity, UniversalRank } from '../../../types';
import { IMobDefinition, MobBehavior, MobSize } from '../../entities/mob/types';
import { ItemDefinition } from '../../entities/item/data/itemDefinitions';
import { ResourceDef } from '../../entities/item/data/resourceDefinitions';
import { MaterialPropertyType, ITransformationRecipe } from '../../entities/economy/types';
import type { IGearRecipe } from '../../entities/economy/data/recipeDefinitions';
import { fnv1a } from '../rng/DeterministicRNG';
import { IThemeBody, IThemePack, IThemeAbility, LEADER_FEATURES, THEME_FORMULA_VERSION } from './ThemeTypes';
import {
  GEAR_SHAPES, affixRange, consumableNumbers, creatureNumbers, forcedExitWorth, gearBaseIp, goodNumbers,
  anchorNumbers, harvestNumbers, junkNumbers, materialNumbers, rankStep, stationNumbers
} from './ThemeFormula';

export interface IAbility extends IThemeAbility {
  id: string;
  themeId: string;
}

export interface ICompiledTheme {
  themeId: string;
  mobs: Record<string, IMobDefinition & { themeId: string; habitat: string[]; innate: string[]; tree?: string; social?: boolean; builds?: boolean; leads?: string; junk?: string[] }>;
  resources: Record<string, ResourceDef & { themeId: string; habitat?: string[] }>;
  crafted: Record<string, ResourceDef>;
  recipes: Record<string, ITransformationRecipe>;
  items: { weapon_bases: ItemDefinition[]; armor_bases: ItemDefinition[]; tool_bases: ItemDefinition[] };
  /** Gear that can be made: never in a random pool, its power comes from its chain. */
  craftedGear: ItemDefinition[];
  gearRecipes: Record<string, IGearRecipe>;
  affixBatches: IAffixBatch[];
  webBatch: IWebBatch;
  abilities: Record<string, IAbility>;
  /** The hub's shelves, by what a base IS. A shelf never names a thing. */
  shelf: { tools: string[]; carrier: string[]; wardrobe: string[]; consumables: string[]; materials: string[] };
}

/** Sorted keys, so the same pack always hashes the same whatever order it was written in. */
export const canonical = (value: unknown): string => JSON.stringify(value, (_k, v) => (
  v && typeof v === 'object' && !Array.isArray(v)
    ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
    : v
));

/** What a model wrote, without the record kept about writing it. */
export function bodyOf(pack: IThemeBody): IThemeBody {
  const { name, premise, regions, tags, creatures, materials, stations, goods, gear, consumables, affixes, abilities, lore, junk, anchors, professions } = pack;
  return { name, premise, regions, tags, creatures, materials, stations, goods, gear, consumables, affixes, abilities, lore, ...(junk ? { junk } : {}), ...(anchors ? { anchors } : {}), ...(professions ? { professions } : {}) };
}

/** Computed from the bytes that matter and nothing else. Two hashes, so a collision is not a worry. */
export function themeIdOf(body: IThemeBody): string {
  const bytes = canonical(bodyOf(body));
  const a = fnv1a(`theme:a:${bytes}`).toString(16).padStart(8, '0');
  const b = fnv1a(`theme:b:${bytes}`).toString(16).padStart(8, '0');
  return `theme_${a}${b}`;
}

/** A body becomes a pack by computing its id. The record of who wrote it does not change its id. */
export function sealTheme(body: IThemeBody, model: string, writtenAt: number, usage?: IThemePack['usage']): IThemePack {
  return { ...body, themeId: themeIdOf(body), formula: THEME_FORMULA_VERSION, model, writtenAt, ...(usage ? { usage } : {}) };
}

const shortIdOf = (themeId: string) => themeId.slice('theme_'.length, 'theme_'.length + 8);

/** A first-generation kind's id. Its sprite is keyed by it, so it does not change. */
export const creatureIdOf = (themeId: string, key: string) => `mob_${shortIdOf(themeId)}_${key}`;

/** D99: the junk a body with these tags can leave. A kind that changed inherits its tags, so it inherits this. */
export const junkIdsFor = (pack: Pick<IThemeBody, 'junk'> & { themeId: string }, tags: string[]): string[] =>
  (pack.junk ?? []).filter(j => j.from.some(t => tags.includes(t))).map(j => `jnk_${shortIdOf(pack.themeId)}_${j.key}`);

/** What the art reads to draw a thing's shape on the ground (`worldForm`, `resourceInk`). */
const FORM_TAGS: Record<string, string[]> = {
  grain: ['flora', 'grain'], shrub: ['flora', 'berry'], fruit: ['flora', 'fruit'], tree: ['flora', 'wood'],
  vein: ['mineral', 'ore'], sand: ['mineral', 'sand'], rock: ['mineral', 'stone'], pebble: ['mineral', 'stone']
};
const VERB_TOOLS: Record<string, string[]> = { hands: [], chop: ['axe'], mine: ['pickaxe'] };

const RARITY_OF: Record<string, Rarity> = { common: Rarity.COMMON, fine: Rarity.UNCOMMON, rare: Rarity.RARE };

const unique = (tags: string[]) => [...new Set(tags)];

/** No hue carries meaning (Pedro is colourblind); a thing's color only varies its look. */
const lookOf = (id: string) => `#${(fnv1a(`look:${id}`) & 0xffffff).toString(16).padStart(6, '0')}`;

/** The id each key a pack writes will have, for anything that names it by key. */
export function keyIdsOf(pack: Pick<IThemePack, 'themeId' | 'materials' | 'goods' | 'stations' | 'abilities'>): Map<string, string> {
  const sid = shortIdOf(pack.themeId);
  const idOf = (prefix: string, key: string) => `${prefix}_${sid}_${key}`;
  const ids = new Map<string, string>();
  for (const m of pack.materials) ids.set(m.key, idOf('res', m.key));
  for (const g of pack.goods) ids.set(g.key, idOf('crf', g.key));
  for (const s of pack.stations) ids.set(s.key, idOf('stn', s.key));
  for (const a of pack.abilities) ids.set(a.key, idOf('abl', a.key));
  return ids;
}

/** @param known the ids of keys this pack does not write itself: what a world grew from. */
export function compileTheme(pack: IThemePack, known?: Map<string, string>): ICompiledTheme {
  const sid = shortIdOf(pack.themeId);
  const idOf = (prefix: string, key: string) => `${prefix}_${sid}_${key}`;
  const ids = new Map([...(known ?? []), ...keyIdsOf(pack)]);

  const out: ICompiledTheme = {
    themeId: pack.themeId,
    mobs: {}, resources: {}, crafted: {}, recipes: {},
    items: { weapon_bases: [], armor_bases: [], tool_bases: [] },
    craftedGear: [],
    gearRecipes: {},
    affixBatches: [],
    webBatch: {
      runId: `theme_${sid}`, model: pack.model, ranAt: pack.writtenAt,
      tags: pack.tags, stations: [], recipes: [], tools: [], goods: []
    },
    abilities: {},
    shelf: { tools: [], carrier: [], wardrobe: [], consumables: [], materials: [] }
  };

  for (const a of pack.abilities) {
    const id = ids.get(a.key)!;
    out.abilities[id] = { ...a, id, themeId: pack.themeId };
  }

  for (const c of pack.creatures) {
    const id = creatureIdOf(pack.themeId, c.key);
    const led = c.leads ? pack.creatures.find(other => other.key === c.leads) : undefined;
    out.mobs[id] = {
      id, name: c.name, themeId: pack.themeId, genre: undefined as never,
      tags: unique(c.tags),
      rank: c.rank as UniversalRank,
      size: c.size as MobSize,
      behavior: c.behavior as MobBehavior,
      colorHex: lookOf(id),
      habitat: c.habitat,
      innate: c.innate.map(k => ids.get(k)!),
      ...(c.tree ? { tree: c.tree } : {}),
      // D93: only what was written, so a pack from before these words compiles to the same bytes
      ...(c.social !== undefined ? { social: c.social } : {}),
      ...(c.builds !== undefined ? { builds: c.builds } : {}),
      ...(c.leads ? { leads: creatureIdOf(pack.themeId, c.leads) } : {}),
      ...(pack.junk ? { junk: junkIdsFor(pack, c.tags) } : {}),
      // A leader draws as what it leads, with more to it: told by shape, never hue
      ...(led ? { line: { root: creatureIdOf(pack.themeId, led.key), rootTags: led.tags, features: LEADER_FEATURES } } : {}),
      ...creatureNumbers(c)
    } as ICompiledTheme['mobs'][string];
  }

  for (const m of pack.materials) {
    const id = ids.get(m.key)!;
    const n = materialNumbers(m);
    const h = harvestNumbers(m.verb, m.rank);
    out.resources[id] = {
      id, name: m.name, description: m.blurb, themeId: pack.themeId,
      type: m.restores === 'energy' ? ItemType.CONSUMABLE : ItemType.RESOURCE, rank: m.rank as UniversalRank, rarity: RARITY_OF[m.worth],
      ...(m.restores === 'energy' ? { stats: consumableNumbers('energy', m.rank), rareFind: true } : {}),
      weight: n.weight, dimensions: n.dimensions, value: n.value,
      icon: `${id}_icon`, visuals: { modelId: m.form, colorHex: lookOf(id) },
      materialProps: { [MaterialPropertyType.DENSITY]: n.density, [MaterialPropertyType.HARDNESS]: n.hardness },
      harvestConfig: { interactionType: 'HARVEST', requiredToolTags: VERB_TOOLS[m.verb], ...h },
      uses: n.uses, yieldPerUse: n.yieldPerUse,
      ...(n.regrowMs ? { regrowMs: n.regrowMs } : {}),
      tags: unique([...FORM_TAGS[m.form], ...m.tags]),
      habitat: m.habitat
    };
    if (m.onShelf) out.shelf.materials.push(id);
  }

  for (const j of pack.junk ?? []) {
    const id = idOf('jnk', j.key);
    const n = junkNumbers(j);
    out.resources[id] = {
      id, name: j.name, description: j.blurb, themeId: pack.themeId, junk: true,
      type: ItemType.RESOURCE, rank: j.rank as UniversalRank, rarity: RARITY_OF[j.worth],
      weight: n.weight, dimensions: n.dimensions, value: n.value,
      icon: `${id}_icon`, visuals: { modelId: j.key, colorHex: lookOf(id) },
      materialProps: { [MaterialPropertyType.DENSITY]: n.density, [MaterialPropertyType.HARDNESS]: n.hardness },
      tags: unique(j.tags)
    };
  }

  // D115: `foundIn`, not `habitat`, so nothing grows from the ground or joins a biome's table
  for (const a of pack.anchors ?? []) {
    const id = idOf('anc', a.key);
    const n = anchorNumbers(a);
    out.resources[id] = {
      id, name: a.name, description: a.blurb, themeId: pack.themeId, anchor: true, foundIn: a.foundIn, worth: n.value,
      type: ItemType.RESOURCE, rank: a.rank as UniversalRank, rarity: RARITY_OF[a.worth],
      weight: n.weight, dimensions: n.dimensions, value: n.value,
      icon: `${id}_icon`, visuals: { modelId: a.key, colorHex: lookOf(id) },
      materialProps: { [MaterialPropertyType.DENSITY]: n.density, [MaterialPropertyType.HARDNESS]: n.hardness },
      tags: unique(a.tags)
    };
  }

  for (const s of pack.stations) {
    const id = ids.get(s.key)!;
    out.webBatch.stations!.push({
      id, name: s.name, description: s.blurb,
      connection: { tool: s.tool, material: s.material },
      bill: s.bill,
      ...stationNumbers(s.bill.length)
    });
  }

  for (const g of pack.goods) {
    const id = ids.get(g.key)!;
    const n = goodNumbers(g);
    out.crafted[id] = {
      id, name: g.name, description: g.blurb, type: ItemType.RESOURCE,
      rank: g.rank as UniversalRank, rarity: Rarity.COMMON,
      weight: n.weight, dimensions: n.dimensions,
      icon: `${id}_icon`, visuals: { modelId: g.key, colorHex: lookOf(id) },
      materialProps: { [MaterialPropertyType.DENSITY]: n.weight * 2 },
      tags: unique(['crafted', ...g.tags])
    };
    const recipeId = idOf('recipe', g.key);
    const inputs = g.from.map(f => ({ itemId: ids.get(f.key)!, quantity: f.count, consume: true }));
    const outputs = [{ itemId: id, quantity: g.makes, probability: 1 }];
    if (g.station) {
      out.webBatch.recipes!.push({
        id: recipeId, name: g.name, description: g.blurb, inputs, outputs,
        energyCost: 0, laborTimeSeconds: n.laborTimeSeconds,
        requiredFacility: 'WORKSHOP', requiredStation: ids.get(g.station)!, trade: g.trade
      });
    } else {
      out.recipes[recipeId] = {
        id: recipeId, name: g.name, description: g.blurb, inputs, outputs,
        energyCost: 0, laborTimeSeconds: n.laborTimeSeconds,
        requiredFacility: 'WORKSHOP', requiredSkill: `skill_${g.trade}`, minSkillLevel: 0
      } as ITransformationRecipe;
    }
  }

  for (const g of pack.gear) {
    const shape = GEAR_SHAPES[g.kind];
    const step = rankStep(g.rank);
    const prefix = shape.bucket === 'weapon_bases' ? 'wpn' : shape.bucket === 'tool_bases' ? 'tool' : 'arm';
    const id = idOf(prefix, g.key);
    const base: ItemDefinition = {
      id, universal_name: g.name, rank: g.rank as UniversalRank, base_ip: gearBaseIp(g.rank, g.kind),
      slot: shape.slot, tags: unique([...shape.tags, ...g.tags]), implicits: shape.implicits(step),
      ...(shape.pouch ? { pouch: shape.pouch } : {}),
      ...(shape.belt ? { belt: shape.belt } : {}),
      ...(shape.cart ? { cart: shape.cart } : {})
    };
    if (g.carries) base.carries = { ability: ids.get(g.carries)!, trigger: g.trigger };
    if (g.craftAt === 'none') out.items[shape.bucket].push(base);
    else {
      out.craftedGear.push(base);
      const recipeId = idOf('gear', g.key);
      out.gearRecipes[recipeId] = {
        id: recipeId, name: g.name, description: g.blurb,
        inputs: g.from.map(f => ({ itemId: ids.get(f.key)!, quantity: f.count })),
        outputBase: id, laborTimeSeconds: 15 + step * 15,
        requiredFacility: g.craftAt === 'hands' ? null : 'WORKSHOP'
      };
    }

    if (shape.bucket === 'tool_bases') {
      const tag = g.tags.find(t => t !== 'tool') ?? shape.tags.find(t => t === 'axe' || t === 'pickaxe') ?? 'tool';
      const toolTag = shape.tags.includes('axe') ? 'axe' : shape.tags.includes('pickaxe') ? 'pickaxe' : tag;
      out.webBatch.tools!.push({ id, name: g.name, tag: toolTag, rank: g.rank as UniversalRank, existing: true, works: g.works, verbs: [] });
      out.shelf.tools.push(id);
    } else if (g.kind === 'cart' || g.kind === 'pouch') {
      out.shelf.carrier.push(id);
    } else if (shape.bucket === 'armor_bases') {
      out.shelf.wardrobe.push(id);
    }
  }

  for (const c of pack.consumables) {
    const id = idOf('con', c.key);
    out.resources[id] = {
      id, name: c.name, description: c.blurb, themeId: pack.themeId,
      type: ItemType.CONSUMABLE, rank: c.rank as UniversalRank, rarity: Rarity.COMMON,
      weight: 0.2, dimensions: { width: 1, height: 1 },
      icon: `${id}_icon`, visuals: { modelId: c.kind, colorHex: lookOf(id) },
      stats: consumableNumbers(c.kind, c.rank),
      materialProps: { [MaterialPropertyType.DENSITY]: 0.4 },
      tags: unique([...c.tags, c.kind === 'scroll' ? 'scroll' : 'food']),
      ...(c.casts ? { casts: ids.get(c.casts) } : {}),
      ...(pack.abilities.find(a => a.key === c.casts)?.effect === 'forced_exit' ? { worth: forcedExitWorth(c.rank) } : {})
    } as ResourceDef & { themeId: string };
    if (c.onShelf) out.shelf.consumables.push(id);
  }

  if (pack.affixes.length > 0) {
    const aid = (key: string) => idOf('aff', key);
    out.affixBatches = [
      {
        runId: `theme_${sid}_names`, kind: 'NAMES', model: pack.model, ranAt: pack.writtenAt,
        names: pack.affixes.map(a => ({
          id: aid(a.key), name: a.name, type: a.type, theme: a.biome || 'GLOBAL',
          allowedTags: a.allowedTags, tier: a.tier, themeId: pack.themeId
        }))
      },
      {
        runId: `theme_${sid}_effects`, kind: 'EFFECTS', model: pack.model, ranAt: pack.writtenAt,
        effects: pack.affixes.map(a => ({
          id: aid(a.key),
          statModifiers: Object.fromEntries(a.gives.map(g => [g.stat, affixRange(g.stat, g.band, a.tier, g.downside)]))
        }))
      }
    ];
  }

  return out;
}

