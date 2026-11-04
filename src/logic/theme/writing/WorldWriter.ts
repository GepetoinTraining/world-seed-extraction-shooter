/**
 * WRITING A WORLD (Q1): pass by pass, in a world's own order, before its first deploy.
 *
 * Each pass: pull from the pool by meaning, near the theme; the model selects by id; only
 * then does it add what is missing, in words. A thing it adds that the pool already holds is
 * taken from the pool instead: an oak is an oak. What the model picks comes with what it
 * stands on (a creature's innate abilities, a piece's materials), word for word.
 *
 * Code decides everything rolled: every band, from a stream keyed on the world's seed. Code
 * names what is new, from the prefix and suffix lists the first pass wrote, and code fills
 * what the law asks of any world (a rank F weapon, a leader) from the pool, nearest first.
 * What comes out is a pack like any other, and the same law judges it.
 */

import { ITagEntry } from '../../../../types';
import { fnv1a, Rng, SeededRNG } from '../../rng/DeterministicRNG';
import { TagLaw } from '../../content/TagLaw';
import { cosineSimilarity } from '../../../entities/data/similarity';
import { EmbeddingService, IEmbedder } from '../../../services/EmbeddingService';
import { ThemeLaw } from '../ThemeLaw';
import {
  BEHAVIORS, BIOMES, BUILDS, IThemeAbility, IThemeAnchor, IThemeBody, IThemeConsumable, IThemeCreature, IThemeGear, IThemeGood,
  IThemeJunk, IThemeMaterial, IThemePack, IThemeProfession, IThemeStation, IThemeTerrain, PACES, RANKS, SIZES, ThemeRank, THREATS,
  WEIGHTS, WORTHS, MATERIAL_FORMS, HARVEST_VERBS
} from '../ThemeTypes';
import { FLORA_FORMS, IPoolEntry, IPull, MINERAL_FORMS, PoolList, ruledOut, standsOnRuledOut } from './WorldPool';
import {
  IBeingsAnswer, IDressingAnswer, IGroundAnswer, IHoldsAnswer, IKnownAnswer, ILifeAnswer, IMadeAnswer, IPassAnswers, ITerrainAnswer,
  IWord, PASS_PULLS, WORD_KINDS, WORLD_PASSES, WorldPassId
} from './WorldPasses';

/**
 * How much of the pull one ask carries, per list. A guard on the prompt, not on the world:
 * Pedro, "don't choke a model". What is not offered can still be added, and the floors
 * reach the whole pool. A guess until a real run reads how much a pass takes in.
 */
export const PULL_OFFERED = 24;
/** A pass refused once is asked once more, told why. A guard on the bill, like the chain's. */
export const PASS_TRIES = 2;

export interface IPassAsk {
  pass: WorldPassId;
  /** What the person said of the world, in their words. */
  said: string;
  /** What the earlier passes made, in words. */
  world: Record<string, unknown>;
  /** The pull, by list: what may be picked, by id. */
  offered: Record<string, { id: string; is: string }[]>;
  /** Words this world has registered so far. */
  words: string[];
  refused?: string;
}

export interface IPassOutcome { status: string; data?: unknown; usage?: { model?: string; inputTokens: number; outputTokens: number; usd: number }; reason?: string }
export type PassDoor = (pass: WorldPassId, ask: IPassAsk) => Promise<IPassOutcome>;

export interface IWriteOptions {
  door: PassDoor;
  pull: IPull;
  /** The packs the pool was read from, so a pick can bring what it stands on. */
  packs: IThemePack[];
  registered: (tag: string) => boolean;
  /** Keys every roll. The same talk and seed write the same world. */
  seed: string;
  /** The world's danger: what is added is rolled at or below it. */
  difficulty?: string;
  embedder?: IEmbedder;
  onPass?: (pass: WorldPassId, index: number) => void;
}

export interface IPassRecord { pass: WorldPassId; tries: number; picked: number; added: number; takenFromPool: number; usd: number }
/** One shape, ok or not: this project compiles without strict null checks, where a union on `ok` does not narrow. */
export interface IWriteResult {
  ok: boolean;
  /** The world, when it was written whole and passed the law. */
  body?: IThemeBody;
  /** Why not, when it was not. */
  reason?: string;
  /** The pass it stopped at. */
  pass?: WorldPassId;
  /** The door's own outcome, when the door did not answer. */
  status?: string;
  usage: { model: string; inputTokens: number; outputTokens: number; usd: number };
  passes: IPassRecord[];
}

const WEAPON_KINDS = ['blade', 'bludgeon', 'bow', 'focus'];
const ARMOR_KINDS = ['head', 'chest', 'legs', 'feet', 'shoulder'];
const ONE_OF_A_KIND = ['boss', 'titan', 'god'];
const isPlainElite = (c: IThemeCreature) => c.tags.includes('elite') && !c.tags.some(t => ONE_OF_A_KIND.includes(t));
/** What the hands need, from what a thing is. A form is a shape; the verb follows from it. */
const VERB_OF_FORM: Record<string, typeof HARVEST_VERBS[number]> = { tree: 'chop', vein: 'mine' };

type Refusal = { refused: string };
const refuse = (why: string): Refusal => ({ refused: why });

/** A name from the world's own lists: never the model's word for one thing. Unique in the world. */
class NameWell {
  private taken = new Set<string>();
  constructor(private prefixes: string[], private suffixes: string[], private seed: string) {}

  take(name: string) { this.taken.add(name.trim().toLowerCase()); }

  save() { return { prefixes: this.prefixes, suffixes: this.suffixes, seed: this.seed, taken: [...this.taken] }; }

  static load(saved: ReturnType<NameWell['save']>): NameWell {
    const well = new NameWell(saved.prefixes, saved.suffixes, saved.seed);
    for (const t of saved.taken) well.taken.add(t);
    return well;
  }

  private join(a: string, b: string) {
    return /^[a-z]/.test(b) ? `${a}${b}` : `${a} ${b}`;
  }

  draw(key: string): string {
    const combos: string[] = [];
    for (const p of this.prefixes) for (const s of this.suffixes) combos.push(this.join(p, s));
    // Exhausted, the lists still name: a second prefix before the first
    for (const p of this.prefixes) for (const q of this.prefixes) if (p !== q) for (const s of this.suffixes) combos.push(this.join(`${p} ${q}`, s));
    const start = combos.length ? fnv1a(`${this.seed}:name:${key}`) % combos.length : 0;
    for (let i = 0; i < combos.length; i++) {
      const name = combos[(start + i) % combos.length];
      if (!this.taken.has(name.toLowerCase())) { this.take(name); return name; }
    }
    let n = 2;
    const base = combos[start] ?? key;
    while (this.taken.has(`${base} ${n}`.toLowerCase())) n++;
    this.take(`${base} ${n}`);
    return `${base} ${n}`;
  }
}

const keyOf = (name: string, fallback: string) => {
  const k = name.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return TagLaw.isCanonicalSpelling(k) ? k : fallback;
};

const emptyBody = (): IThemeBody => ({
  name: '', premise: '', regions: [], tags: [], creatures: [], materials: [], stations: [], goods: [], gear: [], consumables: [],
  affixes: [], abilities: [], lore: [], junk: [], anchors: [], professions: [], terrain: []
});

const isBiome = (b: string) => (BIOMES as readonly string[]).includes(b);

/** The draft a write builds up. Every write starts empty; nothing here is kept between writes. */
class Draft {
  body = emptyBody();
  without: string[] = [];
  names = new NameWell([], [], '');
  private keys = new Set<string>();
  /** Where each picked entry went: `${themeId}|${packList}|${key}` to the key it holds here. */
  private brought = new Map<string, string>();
  private packs: Map<string, IThemePack>;
  private ownWords = new Set<string>();
  added = 0;
  picked = 0;
  takenFromPool = 0;

  constructor(private o: IWriteOptions) {
    this.packs = new Map(o.packs.map(p => [p.themeId, p]));
  }

  known(tag: string) { return this.ownWords.has(tag) || this.o.registered(tag); }

  /** Picking this would bring in something the world is without: its name, or null. */
  bringsRuledOut(e: IPoolEntry): string | null {
    if (ruledOut(e, this.without)) return String(e.entry.name ?? e.key);
    const pack = this.packs.get(e.themeId);
    return pack ? standsOnRuledOut(pack, e.packList, e.key, this.without) : null;
  }

  /** Everything a pass may change, so a refused answer leaves nothing behind. */
  save(): string {
    return JSON.stringify({
      body: this.body, without: this.without, names: this.names.save(), keys: [...this.keys], brought: [...this.brought],
      ownWords: [...this.ownWords], added: this.added, picked: this.picked, takenFromPool: this.takenFromPool
    });
  }

  restore(saved: string) {
    const s = JSON.parse(saved);
    this.body = s.body;
    this.without = s.without;
    this.names = NameWell.load(s.names);
    this.keys = new Set(s.keys);
    this.brought = new Map(s.brought);
    this.ownWords = new Set(s.ownWords);
    this.added = s.added;
    this.picked = s.picked;
    this.takenFromPool = s.takenFromPool;
  }

  rng(pass: string, n: number): SeededRNG { return Rng.fromKey(`${this.o.seed}:world:${pass}:${n}`); }

  rank(rng: SeededRNG): ThemeRank {
    const top = Math.max(0, RANKS.indexOf((this.o.difficulty ?? 'D') as ThemeRank));
    return RANKS[rng.int(0, top + 1)];
  }

  claim(key: string, from = ''): string {
    let k = key;
    if (this.keys.has(k) && from) k = `${key}_${from.slice('theme_'.length, 'theme_'.length + 6)}`;
    let n = 2;
    while (this.keys.has(k)) k = `${key}_${n++}`;
    this.keys.add(k);
    return k;
  }

  addWords(words: IWord[]): Refusal | null {
    for (const w of words ?? []) {
      if (!w || !TagLaw.isCanonicalSpelling(w.tag)) return refuse(`"${w?.tag}" is not a word: lower_snake_case, one spelling.`);
      if (!(WORD_KINDS as readonly string[]).includes(w.kind)) return refuse(`"${w.tag}" is of no kind the registry keeps.`);
      if (!w.meaning?.trim()) return refuse(`"${w.tag}" has no meaning.`);
      // A word already registered keeps its first meaning: using it is free, redefining it is not done
      if (this.known(w.tag)) continue;
      this.ownWords.add(w.tag);
      this.body.tags.push({ tag: w.tag, kind: w.kind, meaning: w.meaning } as ITagEntry);
    }
    return null;
  }

  unknown(tags: string[]): string | undefined { return (tags ?? []).find(t => !this.known(t)); }

  /** A picked entry, word for word, with what it stands on. Its own key where it can keep it. */
  bring(e: { themeId: string; packList: string; key: string }, regions?: string[]): string | null {
    const id = `${e.themeId}|${e.packList}|${e.key}`;
    const already = this.brought.get(id);
    const pack = this.packs.get(e.themeId);
    if (!pack) return null;
    if (already) {
      if (regions?.length) this.widen(e.packList, already, regions);
      return already;
    }
    const find = <T extends { key: string }>(list: T[] | undefined) => (list ?? []).find(x => x.key === e.key);
    const k = (key: string) => this.claim(key, e.themeId);
    const sub = (packList: string, key: string) => (key ? this.bring({ themeId: e.themeId, packList, key }) : '');
    const where = (habitat: string[]) => (regions?.length ? [...new Set(regions)] : habitat);
    this.picked++;

    switch (e.packList) {
      case 'creatures': {
        const c = find(pack.creatures);
        if (!c) return null;
        const key = k(c.key);
        this.brought.set(id, key);
        const innate = c.innate.map(a => sub('abilities', a)).filter(Boolean) as string[];
        const leads = c.leads ? sub('creatures', c.leads) ?? '' : '';
        this.body.creatures.push({ ...c, key, innate, leads, habitat: where(c.habitat) as IThemeCreature['habitat'] });
        this.names.take(c.name);
        return key;
      }
      case 'materials': {
        const m = find(pack.materials);
        if (!m) return null;
        const key = k(m.key);
        this.brought.set(id, key);
        this.body.materials.push({ ...m, key, habitat: where(m.habitat) as IThemeMaterial['habitat'] });
        this.names.take(m.name);
        return key;
      }
      case 'anchors': {
        const a = find(pack.anchors);
        if (!a) return null;
        const key = k(a.key);
        this.brought.set(id, key);
        this.body.anchors!.push({ ...a, key, foundIn: where(a.foundIn) as IThemeAnchor['foundIn'] });
        this.names.take(a.name);
        return key;
      }
      case 'abilities': case 'affixes': case 'junk': case 'professions': case 'stations': {
        const list = (pack as unknown as Record<string, { key: string; name?: string }[] | undefined>)[e.packList];
        const x = find(list);
        if (!x) return null;
        const key = k(x.key);
        this.brought.set(id, key);
        ((this.body as unknown as Record<string, unknown[]>)[e.packList]).push({ ...x, key });
        if (x.name) this.names.take(x.name);
        return key;
      }
      case 'goods': {
        const g = find(pack.goods);
        if (!g) return null;
        const key = k(g.key);
        this.brought.set(id, key);
        const from = g.from.map(f => ({ key: this.madeOf(e.themeId, f.key), count: f.count }));
        const station = g.station ? sub('stations', g.station) ?? '' : '';
        this.body.goods.push({ ...g, key, from, station } as IThemeGood);
        this.names.take(g.name);
        return key;
      }
      case 'gear': {
        const g = find(pack.gear);
        if (!g) return null;
        const key = k(g.key);
        this.brought.set(id, key);
        const from = g.from.map(f => ({ key: this.madeOf(e.themeId, f.key), count: f.count }));
        const carries = g.carries ? sub('abilities', g.carries) ?? '' : '';
        this.body.gear.push({ ...g, key, from, carries } as IThemeGear);
        this.names.take(g.name);
        return key;
      }
      case 'consumables': {
        const c = find(pack.consumables);
        if (!c) return null;
        const key = k(c.key);
        this.brought.set(id, key);
        const casts = c.casts ? sub('abilities', c.casts) ?? '' : '';
        this.body.consumables.push({ ...c, key, casts } as IThemeConsumable);
        this.names.take(c.name);
        return key;
      }
      case 'terrain': {
        const t = (pack.terrain ?? []).find(x => x.role === e.key);
        if (!t) return null;
        this.brought.set(id, t.role);
        this.body.terrain = [...(this.body.terrain ?? []).filter(x => x.role !== t.role), { ...t }];
        return t.role;
      }
      default:
        return null;
    }
  }

  /** What a piece is made from, in its own pack: a material or a good, brought with it. */
  private madeOf(themeId: string, key: string): string {
    const pack = this.packs.get(themeId)!;
    const list = pack.materials.some(m => m.key === key) ? 'materials' : 'goods';
    return this.bring({ themeId, packList: list, key }) ?? key;
  }

  private widen(packList: string, key: string, regions: string[]) {
    if (packList === 'creatures') { const c = this.body.creatures.find(x => x.key === key); if (c) c.habitat = [...new Set([...c.habitat, ...regions])] as IThemeCreature['habitat']; }
    if (packList === 'materials') { const m = this.body.materials.find(x => x.key === key); if (m) m.habitat = [...new Set([...m.habitat, ...regions])] as IThemeMaterial['habitat']; }
    if (packList === 'anchors') { const a = this.body.anchors!.find(x => x.key === key); if (a) a.foundIn = [...new Set([...a.foundIn, ...regions])] as IThemeAnchor['foundIn']; }
  }

  /** A new thing: its name drawn, its key claimed. */
  fresh(list: string): { name: string; key: string } {
    const name = this.names.draw(`${list}:${this.added}`);
    this.added++;
    return { name, key: this.claim(keyOf(name, `${list}_${this.added}`)) };
  }
}

const sum = (a: IWriteResult['usage'], u?: IPassOutcome['usage']) => (u
  ? { model: u.model ?? a.model, inputTokens: a.inputTokens + u.inputTokens, outputTokens: a.outputTokens + u.outputTokens, usd: a.usd + u.usd }
  : a);

/** The words of the world so far, for the next pass to read. */
function worldSoFar(d: Draft): Record<string, unknown> {
  const b = d.body;
  const say = (xs: { name: string; blurb?: string }[]) => xs.map(x => (x.blurb ? `${x.name}: ${x.blurb}` : x.name));
  return {
    name: b.name, premise: b.premise,
    regions: b.regions.map(r => `${r.biome}: ${r.name}, ${r.blurb}`),
    without: d.without,
    terrain: (b.terrain ?? []).map(t => `${t.role}: ${t.ground}, ${t.blurb}${t.crossing ? ` (crossed with ${t.crossing})` : ''}`),
    grows: say(b.materials.filter(m => (FLORA_FORMS as readonly string[]).includes(m.form))),
    lies: say(b.materials.filter(m => (MINERAL_FORMS as readonly string[]).includes(m.form))),
    lives: say(b.creatures),
    works: say(b.professions ?? [])
  };
}

const regionsOk = (regions: string[]) => Array.isArray(regions) && regions.length > 0 && regions.every(isBiome);

export async function writeWorld(said: string, o: IWriteOptions): Promise<IWriteResult> {
  const d = new Draft(o);
  const embedder = o.embedder ?? EmbeddingService.current();
  let usage = { model: '', inputTokens: 0, outputTokens: 0, usd: 0 };
  const passes: IPassRecord[] = [];
  const query = () => [said, d.body.premise, ...d.body.regions.map(r => `${r.name} ${r.blurb}`), ...(d.body.terrain ?? []).map(t => t.ground)].join(' ');

  // ---------------------------------------------------------------- the folds
  const offeredIds = new Map<string, IPoolEntry>();

  const pickAll = (picked: { id: string; regions?: string[] }[], lists: PoolList[]): Refusal | null => {
    for (const p of picked ?? []) {
      const e = offeredIds.get(p.id);
      if (!e || !lists.includes(e.list)) return refuse(`"${p.id}" was not offered here. Pick only by an id you were given.`);
      if (p.regions && !regionsOk(p.regions)) return refuse(`${p.id} is placed nowhere the world has.`);
      const banned = d.bringsRuledOut(e);
      if (banned) return refuse(`${p.id} stands on ${banned}, which this world is without.`);
      d.bring(e, p.regions);
    }
    return null;
  };

  /** A thing the pool already holds is picked, not written again (true). One the world is without is refused; false means it is new. */
  const fromPool = async (list: PoolList, is: string, regions?: string[]): Promise<boolean | Refusal> => {
    if (ruledOut({ text: is }, d.without)) return refuse(`"${is}" is something this world is without.`);
    const same = await o.pull.same(list, is);
    if (!same) return false;
    const banned = d.bringsRuledOut(same);
    if (banned) return refuse(`"${is}" is ${String(same.entry.name ?? same.key)}, which this world is without (${banned}).`);
    d.bring(same, regions);
    d.takenFromPool++;
    return true;
  };

  const folds: { [P in WorldPassId]: (a: IPassAnswers[P], pass: P) => Promise<Refusal | null> } = {
    ground: async (a: IGroundAnswer) => {
      if (!a?.name?.trim() || !a.premise?.trim()) return refuse('the world needs a name and a premise.');
      const regions = BIOMES.map(b => (a.regions ?? []).find(r => r.biome === b));
      const missing = BIOMES.find((b, i) => !regions[i]?.name?.trim());
      if (missing) return refuse(`nothing says what the ${missing} ground is called in this world.`);
      const clean = (xs: string[]) => [...new Set((xs ?? []).map(x => (x ?? '').trim()).filter(x => x && !/\d/.test(x)))];
      const prefixes = clean(a.prefixes), suffixes = clean(a.suffixes);
      if (prefixes.length === 0 || suffixes.length === 0) return refuse('names come from the world\'s prefixes and suffixes, and a list is empty.');
      const w = d.addWords(a.words);
      if (w) return w;
      d.body.name = a.name.trim();
      d.body.premise = a.premise.trim();
      d.body.regions = regions.map(r => ({ biome: r!.biome as IThemeBody['regions'][number]['biome'], name: r!.name.trim(), blurb: (r!.blurb ?? '').trim() }));
      d.without = clean(a.without);
      d.names = new NameWell(prefixes, suffixes, o.seed);
      return null;
    },

    terrain: async (a: ITerrainAnswer) => {
      const w = d.addWords(a?.words ?? []);
      if (w) return w;
      for (const role of ['impassable', 'skilled'] as const) {
        const ans: IDressingAnswer | undefined = a?.[role];
        if (!ans) return refuse(`the ${role} ground is not dressed.`);
        if (ans.pick) {
          const e = offeredIds.get(ans.pick);
          if (!e || e.list !== 'terrain' || e.key !== role) return refuse(`"${ans.pick}" is not a ${role} ground you were offered.`);
          d.bring(e);
          continue;
        }
        if (!ans.ground?.trim()) return refuse(`the ${role} ground is not called anything.`);
        const crossing = role === 'skilled' ? (ans.crossing ?? '').trim() : '';
        if (role === 'skilled' && !(TagLaw.isCanonicalSpelling(crossing) && d.known(crossing))) {
          return refuse(`the ${ans.ground} is crossed with a skill, and "${crossing}" is not a registered word. Register it in "words".`);
        }
        const dressed: IThemeTerrain = { role, ground: ans.ground.trim(), blurb: (ans.blurb ?? '').trim(), crossing };
        d.body.terrain = [...(d.body.terrain ?? []).filter(t => t.role !== role), dressed];
        d.added++;
      }
      return null;
    },

    life: async (a: ILifeAnswer) => {
      const w = d.addWords(a?.words ?? []);
      if (w) return w;
      const p = pickAll(a?.picked ?? [], ['flora', 'fauna']);
      if (p) return p;
      for (const f of a?.flora ?? []) {
        if (!f.is?.trim() || !(FLORA_FORMS as readonly string[]).includes(f.form) || !regionsOk(f.regions)) return refuse('a new plant needs what it is, a form that grows, and where it lives.');
        const t = d.unknown(f.tags);
        if (t) return refuse(`"${t}" is not a registered word. Register it in "words".`);
        { const r = await fromPool('flora', f.is, f.regions); if (typeof r === 'object') return r; if (r) continue; }
        addMaterial(f.is, f.form, f.tags, f.regions, 'life');
      }
      for (const f of a?.fauna ?? []) {
        if (!f.is?.trim() || !regionsOk(f.regions)) return refuse('a new animal needs what it is and where it lives.');
        if (!f.tags?.length) return refuse('a new animal carries at least one word, so it leaves something when it falls.');
        const t = d.unknown(f.tags);
        if (t) return refuse(`"${t}" is not a registered word. Register it in "words".`);
        { const r = await fromPool('fauna', f.is, f.regions); if (typeof r === 'object') return r; if (r) continue; }
        addCreature(f.is, f.tags, 'animal', !!f.social, false, f.regions, 'life');
      }
      return null;
    },

    beings: async (a: IBeingsAnswer) => {
      const w = d.addWords(a?.words ?? []);
      if (w) return w;
      const p = pickAll(a?.picked ?? [], ['monsters', 'professions']);
      if (p) return p;
      for (const m of a?.monsters ?? []) {
        if (!m.is?.trim() || !regionsOk(m.regions)) return refuse('a new creature needs what it is and where it lives.');
        if (!m.tags?.length) return refuse('a new creature carries at least one word, so it leaves something when it falls.');
        const t = d.unknown(m.tags);
        if (t) return refuse(`"${t}" is not a registered word. Register it in "words".`);
        if (m.tags.some(x => ['elite', 'boss', 'titan', 'god'].includes(x))) return refuse('who leads, and who is one of a kind, is decided by code, never written.');
        { const r = await fromPool('monsters', m.is, m.regions); if (typeof r === 'object') return r; if (r) continue; }
        addCreature(m.is, m.tags, 'monster', !!m.social, !!m.builds, m.regions, 'beings');
      }
      for (const pr of a?.professions ?? []) {
        if (!pr.is?.trim() || !pr.workshop?.trim() || !TagLaw.isCanonicalSpelling(pr.concept ?? '')) return refuse('a trade needs what it is, its concept as one lower_snake_case word, and its workshop.');
        if (!pr.tool?.length || !pr.material?.length) return refuse(`${pr.is} connects no tool or no material (D25).`);
        const t = d.unknown([...pr.tool, ...pr.material]);
        if (t) return refuse(`"${t}" is not a registered word. Register it in "words".`);
        { const r = await fromPool('professions', pr.is); if (typeof r === 'object') return r; if (r) continue; }
        const { name, key } = d.fresh('profession');
        const rng = d.rng('profession', d.added);
        d.body.professions!.push({ key, name, blurb: pr.is.trim(), rank: d.rank(rng), concept: pr.concept, knows: pr.is.trim(), workshop: pr.workshop.trim(), tool: pr.tool, material: pr.material } as IThemeProfession);
      }
      return null;
    },

    holds: async (a: IHoldsAnswer) => {
      const w = d.addWords(a?.words ?? []);
      if (w) return w;
      const p = pickAll(a?.picked ?? [], ['minerals', 'junk', 'anchors']);
      if (p) return p;
      for (const m of a?.minerals ?? []) {
        if (!m.is?.trim() || !(MINERAL_FORMS as readonly string[]).includes(m.form) || !regionsOk(m.regions)) return refuse('a new thing in the ground needs what it is, a form it lies in, and where.');
        const t = d.unknown(m.tags);
        if (t) return refuse(`"${t}" is not a registered word. Register it in "words".`);
        { const r = await fromPool('minerals', m.is, m.regions); if (typeof r === 'object') return r; if (r) continue; }
        addMaterial(m.is, m.form, m.tags, m.regions, 'holds');
      }
      for (const j of a?.junk ?? []) {
        if (!j.is?.trim() || !j.from?.length) return refuse('junk needs what it is and the creature words it comes from.');
        const t = d.unknown([...j.tags, ...j.from]);
        if (t) return refuse(`"${t}" is not a registered word. Register it in "words".`);
        { const r = await fromPool('junk', j.is); if (typeof r === 'object') return r; if (r) continue; }
        addJunk(j.is, j.tags, j.from, 'holds');
      }
      for (const an of a?.anchors ?? []) {
        if (!an.is?.trim() || !regionsOk(an.regions)) return refuse('a thing of worth needs what it is and where it is found.');
        const t = d.unknown(an.tags);
        if (t) return refuse(`"${t}" is not a registered word. Register it in "words".`);
        { const r = await fromPool('anchors', an.is, an.regions); if (typeof r === 'object') return r; if (r) continue; }
        const { name, key } = d.fresh('anchor');
        const rng = d.rng('anchor', d.added);
        d.body.anchors!.push({ key, name, blurb: an.is.trim(), tags: an.tags, rank: d.rank(rng), weight: rng.pick([...WEIGHTS]), worth: rng.pick([...WORTHS]), foundIn: [...new Set(an.regions)] as IThemeAnchor['foundIn'] });
      }
      return null;
    },

    made: async (a: IMadeAnswer) => pickAll((a?.picked ?? []).map(id => ({ id })), ['gear', 'goods', 'stations', 'consumables']),

    known: async (a: IKnownAnswer) => {
      const p = pickAll((a?.picked ?? []).map(id => ({ id })), ['abilities', 'affixes']);
      if (p) return p;
      const lore = (a?.lore ?? []).map(l => (l ?? '').trim()).filter(Boolean);
      if (lore.length === 0) return refuse('a world has lore to find, and none was written.');
      if (lore.some(l => /\d/.test(l))) return refuse('lore is words, and a line has a number in it.');
      d.body.lore = lore;
      return null;
    }
  } as never;

  const addMaterial = (is: string, form: string, tags: string[], regions: string[], pass: string) => {
    const { name, key } = d.fresh('material');
    const rng = d.rng(pass, d.added);
    d.body.materials.push({
      key, name, blurb: is.trim(), tags: tags ?? [], rank: d.rank(rng), form: form as typeof MATERIAL_FORMS[number], verb: VERB_OF_FORM[form] ?? 'hands',
      weight: rng.pick([...WEIGHTS]), worth: rng.pick([...WORTHS]), habitat: [...new Set(regions)] as IThemeMaterial['habitat'],
      onShelf: rng.next() < 0.5, restores: 'none'
    });
  };

  const addCreature = (is: string, tags: string[], tree: string, social: boolean, builds: boolean, regions: string[], pass: string) => {
    const { name, key } = d.fresh('creature');
    const rng = d.rng(pass, d.added);
    const behavior = tree === 'animal' ? rng.pick(['PASSIVE', 'NEUTRAL'] as const) : rng.pick(BEHAVIORS.filter(b => b !== 'PASSIVE'));
    d.body.creatures.push({
      key, name, blurb: is.trim(), tags, rank: d.rank(rng), size: rng.pick([...SIZES]), behavior,
      build: rng.pick([...BUILDS]), threat: rng.pick([...THREATS]), pace: rng.pick([...PACES]),
      habitat: [...new Set(regions)] as IThemeCreature['habitat'], innate: [], tree, social, builds: tree === 'animal' ? false : builds, leads: ''
    });
  };

  const addJunk = (is: string, tags: string[], from: string[], pass: string): string => {
    const { name, key } = d.fresh('junk');
    const rng = d.rng(pass, d.added);
    d.body.junk!.push({ key, name, blurb: is.trim(), tags, rank: d.rank(rng), weight: rng.pick([...WEIGHTS]), worth: rng.pick([...WORTHS]), from });
    return key;
  };

  // ---------------------------------------------------------------- the passes
  for (let i = 0; i < WORLD_PASSES.length; i++) {
    const pass = WORLD_PASSES[i];
    o.onPass?.(pass, i);
    const offered: IPassAsk['offered'] = {};
    for (const list of PASS_PULLS[pass]) {
      const near = await o.pull.near(list, query(), PULL_OFFERED, d.without);
      for (const e of near) offeredIds.set(e.id, e);
      offered[list] = near.map(e => ({ id: e.id, is: e.text }));
    }
    let refused: string | undefined;
    let tries = 0;
    let done = false;
    const before = { picked: d.picked, added: d.added, pool: d.takenFromPool };
    let spent = 0;
    while (!done && tries < PASS_TRIES) {
      tries++;
      const out = await o.door(pass, { pass, said, world: worldSoFar(d), offered, words: d.body.tags.map(t => t.tag), ...(refused ? { refused } : {}) });
      usage = sum(usage, out.usage);
      spent += out.usage?.usd ?? 0;
      if (out.status !== 'OK' || !out.data) {
        passes.push({ pass, tries, picked: 0, added: 0, takenFromPool: 0, usd: spent });
        return { ok: false, pass, status: out.status, reason: out.reason ?? `The Seed did not answer (${out.status}).`, usage, passes };
      }
      // A refused answer leaves nothing behind: the draft is rebuilt from what stood before it
      const snapshot = d.save();
      const verdict = await folds[pass](out.data as never, pass as never);
      if (verdict) {
        d.restore(snapshot);
        refused = verdict.refused;
        continue;
      }
      done = true;
    }
    passes.push({ pass, tries, picked: d.picked - before.picked, added: d.added - before.added, takenFromPool: d.takenFromPool - before.pool, usd: spent });
    if (!done) return { ok: false, pass, reason: `Refused twice: ${refused}`, usage, passes };
  }

  // ---------------------------------------------------------------- the floors
  const floor = await floors(d, o, query(), embedder, addJunk);
  if (floor) return { ok: false, reason: floor, usage, passes };

  const verdict = ThemeLaw.validate(d.body, tag => d.known(tag));
  if (!verdict.ok) return { ok: false, reason: verdict.reason ?? 'The law refused it.', usage, passes };
  return { ok: true, body: d.body, usage, passes };
}

/**
 * What the law asks of every world, filled by code from the pool, nearest to the theme first.
 * Who leads is code's to decide (D93), and so is every band. Returns why it could not, or null.
 */
async function floors(d: Draft, o: IWriteOptions, query: string, embedder: IEmbedder, addJunk: (is: string, tags: string[], from: string[], pass: string) => string): Promise<string | null> {
  const b = d.body;
  const nearest = async (list: PoolList, ok: (e: IPoolEntry) => boolean) => {
    const all = await o.pull.near(list, query, Number.MAX_SAFE_INTEGER, d.without);
    return all.find(e => ok(e) && !d.bringsRuledOut(e));
  };
  const bringNearest = async (list: PoolList, ok: (e: IPoolEntry) => boolean, why: string): Promise<string | null> => {
    const e = await nearest(list, ok);
    if (!e) return `nothing in the pool could ${why}.`;
    d.bring(e);
    return null;
  };
  const entry = <T>(e: IPoolEntry) => e.entry as unknown as T;

  // Something small enough to start on: the roll is code's, so the gentlest new kind starts at F
  if (!b.creatures.some(c => c.rank === 'F' || c.rank === 'E')) {
    const own = b.creatures.find(c => c.innate.length === 0 && c.tree === 'animal') ?? b.creatures[0];
    if (own) own.rank = 'F';
    else {
      const why = await bringNearest('fauna', e => ['F', 'E'].includes(entry<IThemeCreature>(e).rank), 'give it something to start on');
      if (why) return why;
    }
  }

  // D93: a world needs a social elite, and code decides who comes to lead
  if (!b.creatures.some(c => isPlainElite(c) && c.social)) {
    const led = b.creatures.find(c => c.social && c.tree !== 'animal') ?? b.creatures.find(c => c.social);
    if (led) {
      const { name, key } = d.fresh('leader');
      const step = Math.min(RANKS.length - 1, RANKS.indexOf(led.rank) + 1);
      b.creatures.push({ ...led, key, name, blurb: `What leads the ${led.name}.`, tags: [...led.tags, 'elite'], rank: RANKS[step], leads: led.key, build: 'massive' });
    } else {
      const why = await bringNearest('monsters', e => isPlainElite(entry<IThemeCreature>(e)) && !!entry<IThemeCreature>(e).social, 'lead a pack');
      if (why) return why;
    }
  }

  // D99: every body leaves something
  for (const c of [...b.creatures]) {
    if (b.junk!.some(j => j.from.some(t => c.tags.includes(t)))) continue;
    const pooled = await nearest('junk', e => entry<IThemeJunk>(e).from.some(t => c.tags.includes(t)));
    if (pooled) d.bring(pooled);
    else addJunk(`What is left of ${c.name}.`, [], [c.tags[0]], 'floor');
  }

  // The gear that takes a person out and back
  const gearNeeds: [string, (g: IThemeGear) => boolean][] = [
    ['arm a beginner', g => WEAPON_KINDS.includes(g.kind) && g.rank === 'F'],
    ['dress a beginner', g => ARMOR_KINDS.includes(g.kind) && g.rank === 'F'],
    ['shoe a beginner', g => g.kind === 'feet' && g.rank === 'F']
  ];
  for (const [why, ok] of gearNeeds) {
    if (b.gear.some(ok)) continue;
    const no = await bringNearest('gear', e => ok(entry<IThemeGear>(e)), why);
    if (no) return no;
  }

  if (!b.materials.some(m => m.tags.includes('building'))) {
    const near = await nearest('minerals', e => entry<IThemeMaterial>(e).tags.includes('building'))
      ?? await nearest('flora', e => entry<IThemeMaterial>(e).tags.includes('building'));
    if (!near) return 'nothing in the pool could raise a wall.';
    d.bring(near);
  }
  if (b.anchors!.length === 0) {
    const no = await bringNearest('anchors', () => true, 'hold value');
    if (no) return no;
  }

  // Last, as whatever came before may stand on wood or ore: a tool for every verb the ground asks
  for (const verb of ['chop', 'mine'] as const) {
    if (!b.materials.some(m => m.verb === verb) || b.gear.some(g => g.kind === `${verb}_tool`)) continue;
    const no = await bringNearest('gear', e => entry<IThemeGear>(e).kind === `${verb}_tool`, `${verb} what the ground holds`);
    if (no) return no;
  }

  // Every kind of ground grows something and holds something alive: the nearest by meaning widens to it
  const texts = async (xs: { name: string; blurb: string }[]) => embedder.embed(xs.map(x => `${x.name} ${x.blurb}`));
  for (const region of b.regions) {
    const [q] = await embedder.embed([`${region.name} ${region.blurb}`]);
    const closest = async <T extends { name: string; blurb: string }>(xs: T[]) => {
      const v = await texts(xs);
      return xs.map((x, i) => ({ x, s: cosineSimilarity(q ?? [], v[i] ?? []) })).sort((m, n) => n.s - m.s)[0]?.x;
    };
    const gatherable = b.materials.filter(m => m.restores !== 'energy');
    if (!gatherable.some(m => m.habitat.includes(region.biome))) {
      const m = await closest(gatherable);
      if (!m) return `nothing can be gathered on the ${region.biome} ground.`;
      m.habitat = [...m.habitat, region.biome];
    }
    if (!b.creatures.some(c => c.habitat.includes(region.biome))) {
      const c = await closest(b.creatures);
      if (!c) return `nothing lives on the ${region.biome} ground.`;
      c.habitat = [...c.habitat, region.biome];
    }
  }
  return null;
}

export type { IThemeAbility, IThemeStation };
