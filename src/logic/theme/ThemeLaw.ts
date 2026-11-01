/**
 * THE THEME LAW: nothing a model says reaches the game unjudged (D43, D55).
 *
 * Refused whole, as every batch is. The law does not know or care who wrote a pack:
 * our Claude, a person's own key or a local model all stand before the same bench.
 * Beyond spelling and references it asks the one question that matters to a player:
 * can this world be played? A pack with no way to hurt anything, or nothing to
 * chop with, is refused, because a world minted from it would be a trap.
 */

import { IThemeBody, ILineWords, BIOMES, RANKS, SIZES, BEHAVIORS, BUILDS, THREATS, PACES, MATERIAL_FORMS, HARVEST_VERBS, WEIGHTS, WORTHS, GEAR_KINDS, CONSUMABLE_KINDS, MATERIAL_RESTORES, STAT_BANDS, DELIVERIES, EFFECTS, COST_BANDS, TRIGGERS, REQUIRED_TREES, LINE_FEATURES, TREES_FROM_FORMULA, LEADERS_FROM_FORMULA, THEME_FORMULA_VERSION } from './ThemeTypes';
import { FORCED_EXIT_FLOOR_RANK, rankStep, STAT_SCALE } from './ThemeFormula';
import { TagLaw } from '../content/TagLaw';
import { StatSystem } from '../systems/StatSystem';
import { EffectSystem } from '../systems/EffectSystem';
import { MENTAL_ATTRIBUTES } from '../../../types';

export interface IThemeVerdict { ok: boolean; reason?: string }

const MENTAL = new Set<string>(MENTAL_ATTRIBUTES as readonly string[]);

/** A world needs at least this much to be played: the gear that takes a person out and back. */
const WEAPON_KINDS = new Set(['blade', 'bludgeon', 'bow', 'focus']);
const ARMOR_KINDS = new Set(['head', 'chest', 'legs', 'feet', 'shoulder']);

/** Tags a pack may use that are grammar rather than registry words: what an affix may land on. */
const SCOPE_WORDS = new Set(['resource', 'mob', 'frame', 'cart', 'charm', 'scroll']);

/**
 * A line inherits these or it does not. Titan and god are one of a kind; elite and boss
 * are leaders (Pedro, 2026-11-01), and who comes to lead is decided by code, never by a
 * model's word for itself.
 */
const INHERITED_ONLY = new Set(['elite', 'boss', 'titan', 'god']);
/** What a plain elite is not (Pedro, 2026-11-01): one of a kind stands alone, and leads nothing. */
const ONE_OF_A_KIND = ['boss', 'titan', 'god'];
const isPlainElite = (c: { tags: string[] }) => c.tags.includes('elite') && !c.tags.some(t => ONE_OF_A_KIND.includes(t));

const has = (values: readonly string[], v: string) => values.includes(v);

export class ThemeLaw {

  /**
   * @param registered is this tag in the registry? The caller holds the registry.
   * @param formula the version a sealed pack was written under. A pack banked before
   * trees stays lawful, or every world pinned to it would be lost at the door.
   */
  static validate(pack: IThemeBody, registered: (tag: string) => boolean, formula = THEME_FORMULA_VERSION): IThemeVerdict {
    const no = (why: string): IThemeVerdict => ({ ok: false, reason: `Theme refused whole: ${why}` });
    if (!pack || typeof pack !== 'object') return no('that is not a pack.');
    if (!pack.name?.trim()) return no('it has no name.');
    if (!pack.premise?.trim()) return no('it has no premise.');
    for (const field of ['regions', 'tags', 'creatures', 'materials', 'stations', 'goods', 'gear', 'consumables', 'affixes', 'abilities', 'lore'] as const) {
      if (!Array.isArray(pack[field])) return no(`${field} is missing.`);
    }

    // D57: no digits from the model. The formula writes the numbers; only small counts are words.
    const stray = this.strayNumber(pack);
    if (stray) return no(`it writes a number at ${stray}. The formula writes the numbers (D57).`);

    const ownTags = new Set(pack.tags.map(t => t.tag));
    const known = (tag: string) => ownTags.has(tag) || registered(tag);
    const unknownTag = (tags: string[]) => tags.find(t => !known(t));

    const keys = new Set<string>();
    const claim = (key: string) => {
      if (!key || !TagLaw.isCanonicalSpelling(key) || keys.has(key)) return false;
      keys.add(key);
      return true;
    };

    for (const region of pack.regions) {
      if (!has(BIOMES, region.biome)) return no(`${region.biome} is not a kind of ground.`);
      if (!region.name?.trim()) return no(`the ${region.biome} region has no name.`);
    }
    for (const biome of BIOMES) {
      if (!pack.regions.some(r => r.biome === biome)) return no(`nothing says what the ${biome} ground is called in this world.`);
    }

    const abilityKeys = new Set(pack.abilities.map(a => a.key));
    const wayOut = new Set(pack.abilities.filter(a => a.effect === 'forced_exit').map(a => a.key));
    for (const a of pack.abilities) {
      if (!claim(a.key)) return no(`ability "${a.key}" needs its own plain key.`);
      if (!a.name?.trim()) return no(`ability ${a.key} has no name.`);
      if (!has(DELIVERIES, a.delivery)) return no(`${a.key}: "${a.delivery}" is not a delivery.`);
      if (!has(EFFECTS, a.effect)) return no(`${a.key}: "${a.effect}" is not an effect.`);
      if (!has(COST_BANDS, a.cost)) return no(`${a.key}: "${a.cost}" is not a cost band.`);
      const exit = EffectSystem.exitRefusal(a);
      if (exit) return no(`${a.key} ${exit}`);
      const t = unknownTag(a.elements);
      if (t) return no(`${a.key} names the element "${t}", which is not registered.`);
    }

    for (const c of pack.creatures) {
      if (!claim(c.key)) return no(`creature "${c.key}" needs its own plain key.`);
      if (!c.name?.trim()) return no(`creature ${c.key} has no name.`);
      const opens = c.innate.find(k => wayOut.has(k));
      if (opens) return no(`${c.key} is born knowing "${opens}", and a way out is never learned by defeating something.`);
      if (!has(RANKS, c.rank)) return no(`${c.key}: "${c.rank}" is not a rank.`);
      if (!has(SIZES, c.size)) return no(`${c.key}: "${c.size}" is not a size.`);
      if (!has(BEHAVIORS, c.behavior)) return no(`${c.key}: "${c.behavior}" is not a behavior.`);
      if (!has(BUILDS, c.build) || !has(THREATS, c.threat) || !has(PACES, c.pace)) return no(`${c.key} is outside the bands.`);
      if (c.habitat.length === 0 || !c.habitat.every(b => has(BIOMES, b))) return no(`${c.key} lives nowhere the world has.`);
      const missing = c.innate.find(k => !abilityKeys.has(k));
      if (missing) return no(`${c.key} is born knowing "${missing}", which this pack never defines.`);
      const t = unknownTag(c.tags);
      if (t) return no(`${c.key} is tagged "${t}", which is not registered.`);
      if (formula >= TREES_FROM_FORMULA && !(c.tree && TagLaw.isCanonicalSpelling(c.tree))) return no(`${c.key} names no tree it belongs to.`);
    }
    if (formula >= TREES_FROM_FORMULA) {
      for (const tree of REQUIRED_TREES) {
        if (!pack.creatures.some(c => c.tree === tree)) return no(`it has no ${tree} tree. Every world holds its animals and its monsters (D63).`);
      }
    }
    if (formula >= LEADERS_FROM_FORMULA) {
      const creatureKeys = new Map(pack.creatures.map(c => [c.key, c]));
      for (const c of pack.creatures) {
        if (typeof c.social !== 'boolean' || typeof c.builds !== 'boolean') return no(`${c.key} must say whether it is social and whether it builds.`);
        if (c.builds && c.tree === 'animal') return no(`${c.key} is an animal, and an animal builds nothing (D93).`);
        // A titan is earned by what it has brought down (D93)
        if (c.tags.includes('titan')) return no(`${c.key} claims "titan". A titan is earned, never written.`);
        if (c.leads && !isPlainElite(c)) return no(`${c.key} leads a pack, and only a plain elite does.`);
        if (isPlainElite(c) && c.social) {
          const led = creatureKeys.get(c.leads ?? '');
          if (!led) return no(`${c.key} is a social elite and names no kind in this pack that it leads.`);
          if (!led.social) return no(`${c.key} leads ${led.key}, which is not social. A pride needs lions (D93).`);
        }
        if (isPlainElite(c) && !c.social && c.leads) return no(`${c.key} is solitary and leads a pack. Only a social species leads (D93).`);
      }
      if (!pack.creatures.some(c => isPlainElite(c) && c.social)) return no('nothing there leads a pack. Elites are what a world rolls at its mint (D93).');
    }

    const materialKeys = new Set(pack.materials.map(m => m.key));
    for (const m of pack.materials) {
      if (!claim(m.key)) return no(`material "${m.key}" needs its own plain key.`);
      if (!m.name?.trim()) return no(`material ${m.key} has no name.`);
      if (!has(RANKS, m.rank)) return no(`${m.key}: "${m.rank}" is not a rank.`);
      if (!has(MATERIAL_FORMS, m.form) || !has(HARVEST_VERBS, m.verb)) return no(`${m.key} is outside the forms.`);
      if (!has(WEIGHTS, m.weight) || !has(WORTHS, m.worth)) return no(`${m.key} is outside the bands.`);
      if (m.habitat.length === 0 || !m.habitat.every(b => has(BIOMES, b))) return no(`${m.key} lies nowhere the world has.`);
      if (m.restores !== undefined && !has(MATERIAL_RESTORES, m.restores)) return no(`${m.key}: "${m.restores}" is not a thing a material restores.`);
      if (m.restores === 'energy' && (m.verb !== 'hands' || m.worth !== 'rare' || m.onShelf)) return no(`${m.key} refills energy, so it is gathered by hand, rare, and on no shelf.`);
      const t = unknownTag(m.tags);
      if (t) return no(`${m.key} is tagged "${t}", which is not registered.`);
    }

    const stationKeys = new Set(pack.stations.map(s => s.key));
    for (const s of pack.stations) {
      if (!claim(s.key)) return no(`station "${s.key}" needs its own plain key.`);
      const t = unknownTag([...s.tool, ...s.material, ...s.bill.map(b => b.tag)]);
      if (t) return no(`${s.key} names "${t}", which is not registered.`);
    }

    const goodKeys = new Set(pack.goods.map(g => g.key));
    for (const g of pack.goods) {
      if (!claim(g.key)) return no(`good "${g.key}" needs its own plain key.`);
      if (!has(RANKS, g.rank)) return no(`${g.key}: "${g.rank}" is not a rank.`);
      if (!has(WEIGHTS, g.weight)) return no(`${g.key} is outside the bands.`);
      if (!known(g.trade)) return no(`${g.key} grows the trade "${g.trade}", which is not registered.`);
      if (g.station && !stationKeys.has(g.station)) return no(`${g.key} stands at "${g.station}", which nobody raised.`);
      if (g.from.length === 0) return no(`${g.key} is made from nothing.`);
      const orphan = g.from.find(f => !materialKeys.has(f.key) && !goodKeys.has(f.key));
      if (orphan) return no(`${g.key} is made from "${orphan.key}", which this pack never defines.`);
      const t = unknownTag(g.tags);
      if (t) return no(`${g.key} is tagged "${t}", which is not registered.`);
    }
    const cycle = this.findCycle(pack);
    if (cycle) return no(`${cycle} can only be made from itself.`);

    for (const g of pack.gear) {
      if (!claim(g.key)) return no(`gear "${g.key}" needs its own plain key.`);
      if (!has(RANKS, g.rank)) return no(`${g.key}: "${g.rank}" is not a rank.`);
      if (!has(GEAR_KINDS, g.kind)) return no(`${g.key}: "${g.kind}" is not a kind of gear, so no slot would take it.`);
      if (g.carries && !abilityKeys.has(g.carries)) return no(`${g.key} carries "${g.carries}", which this pack never defines.`);
      if (wayOut.has(g.carries)) return no(`${g.key} carries "${g.carries}", and a trigger would open a way out for nothing.`);
      if (g.carries && !(TRIGGERS as readonly string[]).includes(g.trigger)) return no(`${g.key} fires on "${g.trigger}", and nothing in the game fires on that.`);
      const t = unknownTag([...g.tags, ...g.works]);
      if (t) return no(`${g.key} names "${t}", which is not registered.`);
      if (g.craftAt !== 'none' && g.from.length === 0) return no(`${g.key} can be made, from nothing.`);
      const orphan = g.from.find(f => !materialKeys.has(f.key) && !goodKeys.has(f.key));
      if (orphan) return no(`${g.key} is made from "${orphan.key}", which this pack never defines.`);
    }

    if (formula >= LEADERS_FROM_FORMULA) {
      if (!Array.isArray(pack.junk)) return no('junk is missing.');
      for (const j of pack.junk) {
        if (!claim(j.key)) return no(`junk "${j.key}" needs its own plain key.`);
        if (!j.name?.trim()) return no(`junk ${j.key} has no name.`);
        if (!has(RANKS, j.rank)) return no(`${j.key}: "${j.rank}" is not a rank.`);
        if (!has(WEIGHTS, j.weight) || !has(WORTHS, j.worth)) return no(`${j.key} is outside the bands.`);
        if (!Array.isArray(j.from) || j.from.length === 0) return no(`${j.key} comes from nothing.`);
        const t = unknownTag([...j.tags, ...j.from]);
        if (t) return no(`${j.key} names "${t}", which is not registered.`);
      }
      const bare = pack.creatures.find(c => !pack.junk!.some(j => j.from.some(tag => c.tags.includes(tag))));
      if (bare) return no(`${bare.key} leaves nothing behind. Every creature has some junk (D99).`);
    }

    for (const c of pack.consumables) {
      if (!claim(c.key)) return no(`consumable "${c.key}" needs its own plain key.`);
      if (!has(RANKS, c.rank) || !has(CONSUMABLE_KINDS, c.kind)) return no(`${c.key} is outside the bands.`);
      if (c.kind === 'energy' && c.onShelf) return no(`${c.key} refills energy, and that is on no shelf.`);
      if (c.kind === 'scroll' && !abilityKeys.has(c.casts)) return no(`${c.key} is a scroll that casts nothing.`);
      if (wayOut.has(c.casts) && c.kind !== 'scroll') return no(`${c.key} casts "${c.casts}", and only a scroll may.`);
      if (wayOut.has(c.casts) && rankStep(c.rank) < rankStep(FORCED_EXIT_FLOOR_RANK)) return no(`${c.key} opens a way out, so it is rank ${FORCED_EXIT_FLOOR_RANK} or above.`);
      const t = unknownTag(c.tags);
      if (t) return no(`${c.key} is tagged "${t}", which is not registered.`);
    }

    for (const a of pack.affixes) {
      if (!claim(a.key)) return no(`affix "${a.key}" needs its own plain key.`);
      if (!a.name?.trim()) return no(`affix ${a.key} has no name.`);
      if (a.type !== 'PREFIX' && a.type !== 'SUFFIX') return no(`${a.key} must be a prefix or a suffix.`);
      if (a.allowedTags.length === 0) return no(`${a.key} may land on nothing.`);
      if (a.biome && !has(BIOMES, a.biome)) return no(`${a.key} dreams in "${a.biome}", which the world does not have.`);
      if (a.gives.length === 0) return no(`${a.key} does nothing.`);
      for (const g of a.gives) {
        // Line 77: a stat nothing reads is a lie on a card
        if (!StatSystem.isRead(g.stat) || !(g.stat in STAT_SCALE)) return no(`${a.key} gives ${g.stat}, and nothing in the game reads ${g.stat}.`);
        if (!has(STAT_BANDS, g.band)) return no(`${a.key}: "${g.band}" is not a band.`);
        // D22: the partition
        if (MENTAL.has(g.stat) && !(a.allowedTags.length === 1 && a.allowedTags[0] === 'frame')) {
          return no(`${a.key} promises ${g.stat.toUpperCase()} on physical gear. A mind's stat rides a frame (D22).`);
        }
      }
      const t = a.allowedTags.find(tag => !SCOPE_WORDS.has(tag) && !known(tag));
      if (t) return no(`${a.key} may land on "${t}", which is not registered.`);
    }

    // D119: optional, so a pack written before there was such a thing stands as it was.
    for (const p of pack.professions ?? []) {
      if (!claim(p.key)) return no(`profession "${p.key}" needs its own plain key.`);
      if (!p.name?.trim()) return no(`profession ${p.key} has no name.`);
      if (!has(RANKS, p.rank)) return no(`${p.key}: "${p.rank}" is not a rank.`);
      if (!p.concept || !TagLaw.isCanonicalSpelling(p.concept)) return no(`${p.key} knows nothing a chain could be written back from.`);
      if (!p.knows?.trim() || !p.workshop?.trim()) return no(`${p.key} has to say what they know and where they would do it.`);
      if (p.tool.length === 0 || p.material.length === 0) return no(`${p.key} connects no tool or no material (D25).`);
      const t = unknownTag([...p.tool, ...p.material]);
      if (t) return no(`${p.key} names "${t}", which is not registered.`);
    }

    // CAN IT BE PLAYED? Line 45's question, asked of a world before it exists.
    if (pack.creatures.length === 0) return no('nothing lives there.');
    if (!pack.creatures.some(c => c.rank === 'F' || c.rank === 'E')) return no('nothing there is small enough to start on.');
    if (!pack.gear.some(g => WEAPON_KINDS.has(g.kind) && g.rank === 'F')) return no('no weapon a beginner could hold.');
    if (!pack.gear.some(g => ARMOR_KINDS.has(g.kind) && g.rank === 'F')) return no('nothing a beginner could wear.');
    if (!pack.gear.some(g => g.kind === 'feet' && g.rank === 'F')) return no('no boots on the shelf (D34).');
    for (const verb of ['chop', 'mine'] as const) {
      if (pack.materials.some(m => m.verb === verb) && !pack.gear.some(g => g.kind === `${verb}_tool`)) {
        return no(`something must be taken with a ${verb} tool, and no such tool exists.`);
      }
    }
    if (!pack.materials.some(m => m.tags.includes('building'))) return no('nothing there can raise a wall.');
    for (const biome of BIOMES) {
      if (!pack.materials.some(m => m.habitat.includes(biome) && m.restores !== 'energy')) return no(`nothing can be gathered on the ${biome} ground.`);
      if (!pack.creatures.some(c => c.habitat.includes(biome))) return no(`nothing lives on the ${biome} ground.`);
    }
    if (pack.lore.length === 0) return no('it has no lore to find.');

    return { ok: true };
  }

  /**
   * What a model wrote for a line that changed (D60). Refused whole, and the order waits.
   * @param elders the names this world already knows: a different monster needs its own.
   */
  static validateLine(words: ILineWords, pack: IThemeBody, elders: string[], registered: (tag: string) => boolean): IThemeVerdict {
    const no = (why: string): IThemeVerdict => ({ ok: false, reason: `Line refused whole: ${why}` });
    if (!words || typeof words !== 'object') return no('those are not words.');
    const stray = this.strayNumber(words, 'the line');
    if (stray) return no(`it writes a number at ${stray}. The formula writes the numbers (D57).`);
    if (typeof words.name !== 'string' || !words.name.trim()) return no('it has no name.');
    if (typeof words.blurb !== 'string' || !words.blurb.trim()) return no('it has no description.');
    const name = words.name.trim().toLowerCase();
    if (elders.some(e => e.trim().toLowerCase() === name)) return no(`"${words.name}" is already a kind here. A different creature needs its own name.`);
    if (!Array.isArray(words.tags) || !Array.isArray(words.features) || !Array.isArray(words.innate)) return no('it is missing a field.');
    const unknown = words.tags.find(t => !registered(t));
    if (unknown) return no(`it is tagged "${unknown}", which is not registered.`);
    const claimed = words.tags.find(t => INHERITED_ONLY.has(t));
    if (claimed) return no(`it claims "${claimed}". That is inherited, never written.`);
    if (words.features.length === 0) return no('nothing about its body changed, so nobody could tell it apart.');
    const shape = words.features.find(f => !has(LINE_FEATURES, f));
    if (shape) return no(`"${shape}" is not a shape the art draws.`);
    const missing = words.innate.find(k => !pack.abilities.some(a => a.key === k));
    if (missing) return no(`it is born knowing "${missing}", which this world never defined.`);
    const opens = words.innate.find(k => pack.abilities.find(a => a.key === k)?.effect === 'forced_exit');
    if (opens) return no(`it is born knowing "${opens}", and a way out is never learned by defeating something.`);
    return { ok: true };
  }

  /** Only `count`, `makes` and `tier` may be numbers. Everything else is a word. */
  static strayNumber(node: unknown, path = 'the pack'): string | null {
    if (typeof node === 'number') return path;
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) {
        const found = this.strayNumber(node[i], `${path}[${i}]`);
        if (found) return found;
      }
      return null;
    }
    if (node && typeof node === 'object') {
      for (const [key, value] of Object.entries(node)) {
        if (key === 'count' || key === 'makes' || key === 'tier') {
          if (!Number.isInteger(value) || (value as number) < 1) return `${path}.${key}`;
          continue;
        }
        const found = this.strayNumber(value, `${path}.${key}`);
        if (found) return found;
      }
    }
    return null;
  }

  static findCycle(pack: Pick<IThemeBody, 'goods'>): string | null {
    const goods = new Map(pack.goods.map(g => [g.key, g]));
    const walking = new Set<string>();
    const done = new Set<string>();
    const walk = (key: string): string | null => {
      if (done.has(key)) return null;
      if (walking.has(key)) return key;
      walking.add(key);
      for (const line of goods.get(key)?.from ?? []) {
        const found = walk(line.key);
        if (found) return found;
      }
      walking.delete(key);
      done.add(key);
      return null;
    };
    for (const key of goods.keys()) {
      const found = walk(key);
      if (found) return found;
    }
    return null;
  }
}
