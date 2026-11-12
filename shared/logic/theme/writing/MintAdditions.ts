/**
 * WHAT A MINTING ADDS (IB). Pedro, after he ended his run: "we need to adjust the item bases, right now they're
 * all weird, so it's best to make the function that calls up sonnet and asks it, according to the slot rolled and
 * the available bases, if the item rolled uses the base or a new base. every minted world should add a lot of item
 * bases, and several materials."
 *
 * At a world's minting its slots are rolled, and for each roll a model is offered the bases that slot already has
 * (its pack's own, and stored ones pulled by meaning near this world) and answers, by id, that the item uses one of
 * them, or writes a new one in words. It is also asked for several new materials. All of it in one ask, answered
 * twice at most. The theme's law judges every word, the formula sizes it, and nothing numeric is the model's. What a
 * refused, broken or absent answer leaves unanswered uses a base it was offered, so a world with no key still mints.
 *
 * What stands is the world's own, kept beside its pinned pack under a scope of its own (the pack is never touched),
 * and banked so a later world's minting can select it and add its own. A world laid before this ground
 * (`MINT_ADDITIONS_FROM_GROUND`) adds nothing and finds what it always found.
 *
 * Pure: no store, no door, no clock.
 */

import { ItemDefinition } from '../../../entities/item/data/itemDefinitions';
import { ResourceDef } from '../../../entities/item/data/resourceDefinitions';
import { fnv1a, Rng, SeededRNG } from '../../rng/DeterministicRNG';
import { ThemeLaw } from '../ThemeLaw';
import { bodyOf, compileTheme, keyIdsOf } from '../ThemeCompiler';
import { BIOMES, GEAR_KINDS, GearKind, HARVEST_VERBS, IThemeBody, IThemePack, MATERIAL_FORMS, RANKS, SIZES, WEIGHTS, WORTHS } from '../ThemeTypes';

/** From this ground a found piece rolls its slot, then its noun among its own world's bases of that slot. */
export const MINT_ADDITIONS_FROM_GROUND = 6;

/**
 * "A lot of item bases": every slot is rolled twice at a minting. Today 15 of the shipped pack's 21 kinds have one
 * noun (IB1); two rolls a slot let a world at least triple that noun's company where the model writes new ones, so
 * a found piece of a slot is the pack's old noun one time in three at most. A floor: more rolls are welcome.
 */
export const BASE_ROLLS_PER_KIND = 2;
/**
 * "Several materials": at least one for every kind of ground. The law already asks each ground to hold one thing to
 * gather; one more on each widens every land's table, which is where a return draws from (RG3). A floor.
 */
export const MATERIALS_PER_GROUND = 1;
/** An ask refused, broken or short is asked once more, told why, like a pass and a loot table. A guard on the bill. */
export const MINT_ASK_TRIES = 2;

/** A base a roll may use: the pack's own (`pack:<key>`) or a stored one (its pool id), with its words. */
export interface IOfferedBase { id: string; name: string; blurb: string; entry?: IThemeBody['gear'][number] }
export interface IBaseRoll { roll: number; slot: GearKind; offered: IOfferedBase[] }

export interface IMintAsk {
  world: { name: string; premise: string; regions: { biome: string; name: string }[] };
  rolls: IBaseRoll[];
  materials: { atLeast: number; grounds: string[]; standing: string[] };
  refused?: string;
}

/** What a model answers: words only. `use` is an offered id, or empty for a new base in the words beside it. */
export interface IMintAnswer {
  rolls: { roll: number; use: string; name: string; blurb: string; tags: string[]; size: string }[];
  materials: { name: string; blurb: string; tags: string[]; rank: string; form: string; verb: string; weight: string; worth: string; habitat: string[] }[];
}

/** What a minting added to one world, kept beside its pack. */
export interface IMintBatch {
  scope: string;
  /** New bases, and stored ones this world selected: its own, under its scope. */
  bases: IThemeBody['gear'];
  materials: IThemeBody['materials'];
  /** Which base each roll came to, by offered id or by its new key. */
  uses: { roll: number; slot: GearKind; base: string }[];
  /** How it was answered, and how many calls it took. */
  by: 'model' | 'fallback';
  calls: number;
}

const str = { type: 'string' };
const obj = (properties: Record<string, unknown>) => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties });
const list = (item: unknown) => ({ type: 'array', items: item });
const oneOf = (values: readonly string[]) => ({ type: 'string', enum: [...values] });

/** The answer's shape. Every field required, no unions, no numbers. */
export const MINT_SCHEMA = obj({
  rolls: list(obj({ roll: { type: 'integer' }, use: str, name: str, blurb: str, tags: list(str), size: oneOf(['', ...SIZES]) })),
  materials: list(obj({
    name: str, blurb: str, tags: list(str), rank: oneOf(RANKS), form: oneOf(MATERIAL_FORMS), verb: oneOf(HARVEST_VERBS),
    weight: oneOf(WEIGHTS), worth: oneOf(WORTHS), habitat: list(oneOf(BIOMES))
  }))
});

const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^(\d)/, 'n$1') || 'thing';
const named = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** The pack's own bases a slot has, found as well as made: what is offered before anything stored. */
export const packBasesOf = (pack: Pick<IThemeBody, 'gear'>, slot: GearKind): IOfferedBase[] =>
  pack.gear.filter(g => g.kind === slot).map(g => ({ id: `pack:${g.key}`, name: g.name, blurb: g.blurb }));

export class MintAdditions {

  /** A world's own scope: an id its definitions hang from, so no other world on its pack reads them. */
  static scopeOf(worldUid: string): string {
    return `theme_${(fnv1a(`mint:${worldUid}`) >>> 0).toString(16).padStart(8, '0')}`;
  }

  /** The slots a minting rolls: every kind, `BASE_ROLLS_PER_KIND` times, in an order its seed shuffles. */
  static rolledSlots(seed: string): GearKind[] {
    const slots = GEAR_KINDS.flatMap(k => Array.from({ length: BASE_ROLLS_PER_KIND }, () => k as GearKind));
    const rng = Rng.fromKey(`${seed}:mint:slots:v1`);
    for (let i = slots.length - 1; i > 0; i--) {
      const j = rng.int(0, i + 1);
      [slots[i], slots[j]] = [slots[j], slots[i]];
    }
    return slots;
  }

  static materialFloor(): number {
    return BIOMES.length * MATERIALS_PER_GROUND;
  }

  /**
   * The ask. `stored` is what a pull by meaning offered from other worlds, by slot. Only the rolls named in
   * `only` are asked again after a refusal.
   */
  static askOf(pack: IThemeBody, seed: string, stored: (slot: GearKind) => IOfferedBase[] = () => [], refused?: string, only?: Set<number>, materialsShort?: number): IMintAsk {
    const rolls = this.rolledSlots(seed).map((slot, roll) => ({ roll, slot, offered: [...packBasesOf(pack, slot), ...stored(slot)] }))
      .filter(r => !only || only.has(r.roll));
    return {
      world: { name: pack.name, premise: pack.premise, regions: pack.regions.map(r => ({ biome: r.biome, name: r.name })) },
      rolls,
      materials: { atLeast: materialsShort ?? this.materialFloor(), grounds: [...BIOMES], standing: pack.materials.map(m => m.name) },
      ...(refused ? { refused } : {})
    };
  }

  /**
   * The law over an answer. A roll that uses an offered base keeps it; one that writes a new base is judged as a piece
   * of the pack would be, and refused if it names a base that already stands. A material likewise. What does not
   * stand is said back, so the second ask can mend it.
   */
  static judge(pack: IThemeBody, ask: IMintAsk, data: unknown, registered: (tag: string) => boolean, held: { bases: IThemeBody['gear']; materials: IThemeBody['materials'] } = { bases: [], materials: [] }) {
    const answer = data as Partial<IMintAnswer> | undefined;
    const why: string[] = [];
    const uses: IMintBatch['uses'] = [];
    const bases: IThemeBody['gear'] = [...held.bases];
    const materials: IThemeBody['materials'] = [...held.materials];
    const answered = new Set<number>();
    const taken = new Set([...pack.gear.map(g => g.key), ...pack.materials.map(m => m.key), ...pack.creatures.map(c => c.key), ...pack.goods.map(g => g.key),
      ...pack.stations.map(s => s.key), ...pack.abilities.map(a => a.key), ...pack.consumables.map(c => c.key), ...pack.affixes.map(a => a.key),
      ...(pack.junk ?? []).map(j => j.key), ...(pack.anchors ?? []).map(a => a.key), ...(pack.professions ?? []).map(p => p.key), ...bases.map(b => b.key), ...materials.map(m => m.key)]);
    const keyFor = (name: string) => {
      let key = slug(name), n = 2;
      while (taken.has(key)) key = `${slug(name)}_${n++}`;
      taken.add(key);
      return key;
    };
    // The body alone: a sealed pack's own record (when it was written, by whom) is not words a model wrote
    const stands = (body: IThemeBody) => ThemeLaw.validate(bodyOf(body), registered, (pack as Partial<IThemePack>).formula);

    for (const r of Array.isArray(answer?.rolls) ? answer!.rolls : []) {
      const roll = ask.rolls.find(x => x.roll === r?.roll);
      if (!roll || answered.has(roll.roll)) continue;
      const offered = roll.offered.find(o => o.id === r.use);
      if (r.use) {
        if (!offered) { why.push(`roll ${roll.roll} uses "${r.use}", which was not offered for ${roll.slot}`); continue; }
        // A stored base this world selects is its own from now on, under its scope, word for word
        if (offered.entry && !bases.some(b => named(b.name, offered.entry!.name))) bases.push({ ...offered.entry, key: keyFor(offered.entry.name) });
        uses.push({ roll: roll.roll, slot: roll.slot, base: offered.entry ? bases.find(b => named(b.name, offered.entry!.name))!.key : offered.id });
        answered.add(roll.roll);
        continue;
      }
      const name = String(r.name ?? '').trim();
      if (!name) { why.push(`roll ${roll.roll} writes a new ${roll.slot} with no name`); continue; }
      const copy = [...roll.offered.map(o => o.name), ...pack.gear.map(g => g.name), ...bases.map(b => b.name)].find(n => named(n, name));
      if (copy) { why.push(`roll ${roll.roll}: "${name}" already stands; use it by its id, or write another`); continue; }
      const base: IThemeBody['gear'][number] = {
        key: keyFor(name), name, blurb: String(r.blurb ?? ''), kind: roll.slot, rank: 'F', tags: Array.isArray(r.tags) ? r.tags.map(String) : [],
        works: [], carries: '', trigger: '', from: [], craftAt: 'none', ...(r.size ? { size: r.size as never } : {})
      };
      const verdict = stands({ ...pack, gear: [...pack.gear, base] });
      if (!verdict.ok) { taken.delete(base.key); why.push(`roll ${roll.roll}: ${verdict.reason}`); continue; }
      bases.push(base);
      uses.push({ roll: roll.roll, slot: roll.slot, base: base.key });
      answered.add(roll.roll);
    }

    for (const m of Array.isArray(answer?.materials) ? answer!.materials : []) {
      const name = String(m?.name ?? '').trim();
      if (!name) { why.push('a material with no name'); continue; }
      if ([...pack.materials, ...materials].some(x => named(x.name, name))) { why.push(`"${name}" already lies in this world; write another`); continue; }
      const material: IThemeBody['materials'][number] = {
        key: keyFor(name), name, blurb: String(m.blurb ?? ''), tags: Array.isArray(m.tags) ? m.tags.map(String) : [], rank: m.rank as never,
        form: m.form as never, verb: m.verb as never, weight: m.weight as never, worth: m.worth as never,
        habitat: Array.isArray(m.habitat) ? m.habitat.map(String) as never : [], onShelf: false
      };
      const verdict = stands({ ...pack, materials: [...pack.materials, material] });
      if (!verdict.ok) { taken.delete(material.key); why.push(`${name}: ${verdict.reason}`); continue; }
      materials.push(material);
    }

    const unanswered = ask.rolls.filter(r => !answered.has(r.roll)).map(r => r.roll);
    const short = Math.max(0, this.materialFloor() - materials.length);
    if (unanswered.length > 0) why.push(`these rolls stand unanswered: ${unanswered.join(', ')}`);
    if (short > 0) why.push(`${short} more material${short === 1 ? '' : 's'} are wanted`);
    return { uses, bases, materials, unanswered, short, reason: why.length > 0 ? why.join('; ') : undefined };
  }

  /** What no answer leaves: each roll uses a base it was offered, picked by the world's seed. Nothing new. */
  static fallbackUses(seed: string, rolls: IBaseRoll[]): IMintBatch['uses'] {
    return rolls.filter(r => r.offered.length > 0).map(r => ({ roll: r.roll, slot: r.slot, base: Rng.fromKey(`${seed}:mint:fallback:${r.roll}`).pick(r.offered).id }));
  }

  /** The batch's own definitions, sized by the formula under its scope. Keys it did not write read the pack's ids. */
  static compile(pack: IThemePack, batch: Pick<IMintBatch, 'scope' | 'bases' | 'materials'>): { bases: ItemDefinition[]; resources: ResourceDef[] } {
    const own: IThemePack = {
      ...pack, themeId: batch.scope,
      tags: [], regions: [], stations: [], goods: [], consumables: [], creatures: [], affixes: [], abilities: [], lore: [],
      junk: undefined, anchors: undefined, professions: undefined, terrain: undefined,
      gear: batch.bases, materials: batch.materials
    };
    const compiled = compileTheme(own, keyIdsOf(pack));
    return {
      bases: [...compiled.items.weapon_bases, ...compiled.items.armor_bases, ...compiled.items.tool_bases],
      resources: Object.values(compiled.resources) as ResourceDef[]
    };
  }

  /** A world's found bases by slot: its pack's own, and what its minting added. */
  static basesBySlot(packBases: ItemDefinition[], added: ItemDefinition[] = []): Map<string, ItemDefinition[]> {
    const out = new Map<string, ItemDefinition[]>();
    for (const b of [...packBases, ...added]) {
      const kind = String(b.kind ?? '');
      if (!kind) continue;
      if (!out.has(kind)) out.set(kind, []);
      if (!out.get(kind)!.some(x => x.id === b.id)) out.get(kind)!.push(b);
    }
    return out;
  }

  /** "According to the slot rolled": a found piece rolls its slot evenly, then its noun evenly among that slot's bases. */
  static pick(bySlot: Map<string, ItemDefinition[]>, rng: SeededRNG): ItemDefinition | undefined {
    const slots = [...bySlot.keys()].filter(k => (bySlot.get(k)?.length ?? 0) > 0).sort();
    if (slots.length === 0) return undefined;
    const bases = [...bySlot.get(rng.pick(slots))!].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    return rng.pick(bases);
  }
}

/** The open world's found bases, for the loot that reads them. Empty means a world before this ground. */
let open: Map<string, ItemDefinition[]> | null = null;
export const WorldBases = {
  enter(bySlot: Map<string, ItemDefinition[]> | null) { open = bySlot; },
  active(): Map<string, ItemDefinition[]> | null { return open; }
};
