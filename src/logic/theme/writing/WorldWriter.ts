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

import { ITagEntry } from '../../../../shared/types';
import { fnv1a, Rng, SeededRNG } from '../../../../shared/logic/rng/DeterministicRNG';
import { TagLaw } from '../../../../shared/logic/content/TagLaw';
import { cosineSimilarity } from '../../../../shared/entities/data/similarity';
import { EmbeddingService, IEmbedder } from '../../../../shared/services/EmbeddingService';
import { ThemeLaw } from '../../../../shared/logic/theme/ThemeLaw';
import {
  BEHAVIORS, BIOMES, BUILDS, IThemeAbility, IThemeAnchor, IThemeBody, IThemeConsumable, IThemeCreature, IThemeGear, IThemeGood,
  IThemeJunk, IThemeMaterial, IThemePack, IThemeProfession, IThemeStation, IThemeTerrain, PACES, RANKS, SIZES, ThemeRank, THREATS,
  WEIGHTS, WORTHS, MATERIAL_FORMS, HARVEST_VERBS
} from '../../../../shared/logic/theme/ThemeTypes';
import { FLORA_FORMS, IPoolEntry, IPull, MeaningOf, MINERAL_FORMS, PoolList, ruledOut, standsOnRuledOut } from '../../../../shared/logic/theme/writing/WorldPool';
import {
  IDressingAnswer, IFaunaAnswer, IFloraAnswer, IGroundAnswer, IHoldsAnswer, IKnownAnswer, ILack, ILackAnswer, IMadeAnswer, INamePieces,
  INamesAnswer, IPassAnswers, IPeopleAnswer, ITerrainAnswer, IWord, PASS_PULLS, WORD_KINDS, WORLD_PASSES, WorldPassId
} from '../../../../shared/logic/theme/writing/WorldPasses';

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
  /** C16: what the world still lacks that the pool could not give, when that is what is asked. */
  lack?: ILack;
  /** C21: the pieces the world's names are made of, when every name they make is taken and more are asked. */
  names?: INamePieces;
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
  /** What a registered word means: an exclusion is read through it (C18), so a world without moving water has no river. */
  meaningOf?: MeaningOf;
  /** The name the person gave the world. Their own words stand; only when it is empty is one drawn from the lists. */
  name?: string;
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

/**
 * Fauna is one field (Pedro, 2026-11-04): a monster is fauna that is aggressive, and some animals
 * are. Aggression is rolled, so it follows the rolled threat: a deadly creature attacks, a sharp
 * one holds its ground, a meek one keeps away. Which tree it stands in follows from that (D63).
 */
export function temperOf(threat: typeof THREATS[number]): { behavior: IThemeCreature['behavior']; tree: 'animal' | 'monster' } {
  if (threat === 'deadly') return { behavior: 'AGGRESSIVE', tree: 'monster' };
  if (threat === 'sharp') return { behavior: 'NEUTRAL', tree: 'animal' };
  return { behavior: 'PASSIVE', tree: 'animal' };
}
/** What the hands need, from what a thing is. A form is a shape; the verb follows from it. */
const VERB_OF_FORM: Record<string, typeof HARVEST_VERBS[number]> = { tree: 'chop', vein: 'mine' };

type Refusal = { refused: string };
const refuse = (why: string): Refusal => ({ refused: why });

/** Every name the lists make is taken: the world writes more pieces, and what was being named is named again (C21). */
class WellDry {
  constructor(readonly pieces: INamePieces) {}
}

/** A piece a name is made of, as code keeps it: letters only, a stray hyphen shed, never a code word (C17). */
const piecesOf = (xs: string[]) => [...new Set((xs ?? [])
  .map(x => (x ?? '').trim())
  .filter(x => x && !/\d/.test(x) && !/_/.test(x))
  .map(x => x.replace(/^[^A-Za-z]+|[^A-Za-z]+$/g, ''))
  .filter(Boolean))];

/** A name from the world's own lists: never the model's word for one thing. Unique in the world. */
class NameWell {
  private taken = new Set<string>();
  constructor(private prefixes: string[], private suffixes: string[], private seed: string) {}

  take(name: string) { this.taken.add(name.trim().toLowerCase()); }

  pieces(): INamePieces { return { prefixes: [...this.prefixes], suffixes: [...this.suffixes] }; }

  /** New pieces join the lists; one the world has, in any case, is not new. Returns the pieces that were new. */
  grow(more: INamePieces): INamePieces {
    const fresh = (have: string[], add: string[]) => {
      const seen = new Set(have.map(p => p.toLowerCase()));
      return piecesOf(add).filter(p => {
        if (seen.has(p.toLowerCase())) return false;
        seen.add(p.toLowerCase());
        return true;
      });
    };
    const added = { prefixes: fresh(this.prefixes, more.prefixes), suffixes: fresh(this.suffixes, more.suffixes) };
    this.prefixes.push(...added.prefixes);
    this.suffixes.push(...added.suffixes);
    return added;
  }

  save() { return { prefixes: this.prefixes, suffixes: this.suffixes, seed: this.seed, taken: [...this.taken] }; }

  static load(saved: ReturnType<NameWell['save']>): NameWell {
    const well = new NameWell(saved.prefixes, saved.suffixes, saved.seed);
    for (const t of saved.taken) well.taken.add(t);
    return well;
  }

  /** A piece reads as a word: its first letter a capital, whatever case it came in. */
  private word(piece: string) { return piece.charAt(0).toUpperCase() + piece.slice(1); }

  /** A suffix in lowercase grows onto the prefix; one in capitals stands as its own word. */
  private join(prefix: string, suffix: string) {
    return /^[a-z]/.test(suffix) ? `${this.word(prefix)}${suffix}` : `${this.word(prefix)} ${suffix}`;
  }

  /**
   * A name is one prefix and one suffix, as the ground ask tells the model, and never a number (C17) or a piece
   * said twice (C21: "Orcho Glint Orcho Glint Orcho Felt" is gibberish, Pedro 2026-11-09). When every name the
   * lists make is taken, the well is dry: the world is asked for more pieces, never made to stack the ones it has.
   */
  draw(key: string): string {
    if (this.prefixes.length === 0 || this.suffixes.length === 0) return key;
    const at = fnv1a(`${this.seed}:name:${key}`);
    const names = this.prefixes.flatMap(p => this.suffixes.map(s => this.join(p, s)));
    for (let i = 0; i < names.length; i++) {
      const name = names[(at + i) % names.length];
      if (!this.taken.has(name.toLowerCase())) { this.take(name); return name; }
    }
    throw new WellDry(this.pieces());
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
  /** Every word this world has registered, new or already on the books: what a later pass is told it may use (C1). */
  private spoken = new Set<string>();
  added = 0;
  picked = 0;
  takenFromPool = 0;

  constructor(private o: IWriteOptions) {
    this.packs = new Map(o.packs.map(p => [p.themeId, p]));
  }

  known(tag: string) { return this.ownWords.has(tag) || this.o.registered(tag); }

  /** What a word means: as this world registered it, else as the registry has it. */
  meaning: MeaningOf = word => this.body.tags.find(t => t.tag === word)?.meaning ?? this.o.meaningOf?.(word);

  /** This text says something the world is without, by its own words or by what they mean (C18). */
  rulesOut(text: string): boolean { return ruledOut({ text }, this.without, this.meaning); }

  /** Picking this would bring in something the world is without: its name, or null. */
  bringsRuledOut(e: IPoolEntry): string | null {
    if (ruledOut(e, this.without, this.meaning)) return String(e.entry.name ?? e.key);
    const pack = this.packs.get(e.themeId);
    return pack ? standsOnRuledOut(pack, e.packList, e.key, this.without, this.meaning) : null;
  }

  /** Everything a pass may change, so a refused answer leaves nothing behind. */
  save(): string {
    return JSON.stringify({
      body: this.body, without: this.without, names: this.names.save(), keys: [...this.keys], brought: [...this.brought],
      ownWords: [...this.ownWords], spoken: [...this.spoken], added: this.added, picked: this.picked, takenFromPool: this.takenFromPool
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
    this.spoken = new Set(s.spoken);
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
      this.spoken.add(w.tag);
      // A word already registered keeps its first meaning: using it is free, redefining it is not done
      if (this.known(w.tag)) continue;
      this.ownWords.add(w.tag);
      this.body.tags.push({ tag: w.tag, kind: w.kind, meaning: w.meaning } as ITagEntry);
    }
    return null;
  }

  /** The words this world has registered so far, as a pass's ask names them. */
  words(): string[] { return [...new Set([...this.body.tags.map(t => t.tag), ...this.spoken])]; }

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
/** C17: what a person reads of a thing is plain words. A code word is refused, and the model says it again. */
const codeWord = (text: string | undefined) => /_/.test(text ?? '');

/** The words of what a thing is, its article set aside: "a growth" says what "growth" says. */
const wordsOf = (text: string) => {
  const words = (text ?? '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  return ['a', 'an', 'the'].includes(words[0]) ? words.slice(1) : words;
};
/**
 * C19: what a new thing is says something its siblings do not. A line whose every word one of
 * them already says is thin ("growth", three times), whatever its length: the sibling it repeats, or null.
 */
const echoed = (is: string, siblings: string[]): string | null => {
  const own = new Set(wordsOf(is));
  return siblings.find(s => { const theirs = new Set(wordsOf(s)); return [...own].every(w => theirs.has(w)); }) ?? null;
};

export async function writeWorld(said: string, o: IWriteOptions): Promise<IWriteResult> {
  const d = new Draft(o);
  const embedder = o.embedder ?? EmbeddingService.current();
  let usage = { model: '', inputTokens: 0, outputTokens: 0, usd: 0 };
  const passes: IPassRecord[] = [];
  const query = () => [said, d.body.premise, ...d.body.regions.map(r => `${r.name} ${r.blurb}`), ...(d.body.terrain ?? []).map(t => t.ground)].join(' ');

  // ---------------------------------------------------------------- the folds
  const offeredIds = new Map<string, IPoolEntry>();
  /** Every piece the names ask added, kept past a refused answer: the ground pass's own lists are read again with them. */
  const more: INamePieces = { prefixes: [], suffixes: [] };

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
    if (d.rulesOut(is)) return refuse(`"${is}" is something this world is without.`);
    const same = await o.pull.same(list, is);
    if (!same) return false;
    const banned = d.bringsRuledOut(same);
    if (banned) return refuse(`"${is}" is ${String(same.entry.name ?? same.key)}, which this world is without (${banned}).`);
    d.bring(same, regions);
    d.takenFromPool++;
    return true;
  };

  /** C19: a new thing that repeats one of its siblings is refused, the sibling named, and the pass asked again. */
  const thin = (is: string, siblings: { blurb: string }[]): Refusal | null => {
    const s = echoed(is, siblings.map(x => x.blurb));
    return s === null ? null : refuse(`"${is.trim()}" says nothing that "${s}" does not: say what sets it apart from the rest of this world.`);
  };
  const formed = (forms: readonly string[]) => d.body.materials.filter(m => forms.includes(m.form));

  const folds: { [P in WorldPassId]: (a: IPassAnswers[P], pass: P) => Promise<Refusal | null> } = {
    ground: async (a: IGroundAnswer) => {
      if (!a?.premise?.trim()) return refuse('the world needs a premise.');
      const regions = BIOMES.map(b => (a.regions ?? []).find(r => r.biome === b));
      const missing = BIOMES.find((b, i) => !regions[i]?.blurb?.trim());
      if (missing) return refuse(`nothing says what the ${missing} ground is like in this world.`);
      const clean = (xs: string[]) => [...new Set((xs ?? []).map(x => (x ?? '').trim()).filter(x => x && !/\d/.test(x)))];
      // A piece a name is made of is a sound of this world, never a code word (C17)
      const prefixes = piecesOf(a.prefixes), suffixes = piecesOf(a.suffixes);
      if (prefixes.length === 0 || suffixes.length === 0) return refuse('names come from the world\'s prefixes and suffixes, each a sound in plain letters, and a list is empty.');
      const w = d.addWords(a.words);
      if (w) return w;
      d.body.premise = a.premise.trim();
      d.without = clean(a.without);
      d.names = new NameWell(prefixes, suffixes, o.seed);
      // Pieces the world wrote when this answer ran its names dry (C21)
      d.names.grow(more);
      // C17: the model names nothing, the world and its grounds included: every name is drawn from its own lists.
      // The person's own name for the world outranks anything drawn, and nothing else is drawn to it
      const typed = (o.name ?? '').trim();
      if (typed) d.names.take(typed);
      d.body.name = typed || d.names.draw('world');
      d.body.regions = regions.map(r => ({ biome: r!.biome as IThemeBody['regions'][number]['biome'], name: d.names.draw(`region:${r!.biome}`), blurb: r!.blurb.trim() }));
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
        if (codeWord(ans.ground)) return refuse(`say what the ${role} ground is in plain words: "${ans.ground}" reads as a code word.`);
        // C17: the skilled crossing may come with its meaning, and is registered with it when it is new
        const said = ans.crossing as string | IWord | undefined;
        if (role === 'skilled' && said && typeof said === 'object') {
          const w = d.addWords([said]);
          if (w) return w;
        }
        const crossing = role === 'skilled' ? (typeof said === 'object' ? said?.tag ?? '' : said ?? '').trim() : '';
        if (role === 'skilled' && !(TagLaw.isCanonicalSpelling(crossing) && d.known(crossing))) {
          return refuse(`the ${ans.ground} is crossed with a skill, and "${crossing}" is not a registered word. Register it in "words".`);
        }
        const dressed: IThemeTerrain = { role, ground: ans.ground.trim(), blurb: (ans.blurb ?? '').trim(), crossing };
        d.body.terrain = [...(d.body.terrain ?? []).filter(t => t.role !== role), dressed];
        d.added++;
      }
      return null;
    },

    // C15: what grows, then what lives, each its own ask
    flora: async (a: IFloraAnswer) => {
      const w = d.addWords(a?.words ?? []);
      if (w) return w;
      const p = pickAll(a?.picked ?? [], ['flora']);
      if (p) return p;
      for (const f of a?.flora ?? []) {
        const bad = plantRefused(f);
        if (bad) return bad;
        { const r = await fromPool('flora', f.is, f.regions); if (typeof r === 'object') return r; if (r) continue; }
        { const t = thin(f.is, formed(FLORA_FORMS)); if (t) return t; }
        addMaterial(f.is, f.form, f.tags, f.regions, 'flora');
      }
      return null;
    },

    // Fauna is one field: what is dangerous is rolled, never written
    fauna: async (a: IFaunaAnswer) => {
      const w = d.addWords(a?.words ?? []);
      if (w) return w;
      const p = pickAll(a?.picked ?? [], ['fauna']);
      if (p) return p;
      for (const f of a?.fauna ?? []) {
        const bad = creatureRefused(f);
        if (bad) return bad;
        { const r = await fromPool('fauna', f.is, f.regions); if (typeof r === 'object') return r; if (r) continue; }
        { const t = thin(f.is, d.body.creatures); if (t) return t; }
        addCreature(f.is, f.tags, !!f.social, !!f.builds, f.regions, 'fauna');
      }
      return null;
    },

    people: async (a: IPeopleAnswer) => {
      const w = d.addWords(a?.words ?? []);
      if (w) return w;
      const p = pickAll((a?.picked ?? []).map(id => ({ id })), ['professions']);
      if (p) return p;
      for (const pr of a?.professions ?? []) {
        if (!pr.is?.trim() || !pr.workshop?.trim() || !TagLaw.isCanonicalSpelling(pr.concept ?? '')) return refuse('a trade needs what it is, its concept as one lower_snake_case word, and its workshop.');
        if (codeWord(pr.is) || codeWord(pr.workshop)) return refuse(`say what "${pr.is}" is and where it works in plain words, not code words.`);
        if (!pr.tool?.length || !pr.material?.length) return refuse(`${pr.is} connects no tool or no material (D25).`);
        const t = d.unknown([...pr.tool, ...pr.material]);
        if (t) return refuse(`"${t}" is not a registered word. Register it in "words".`);
        { const r = await fromPool('professions', pr.is); if (typeof r === 'object') return r; if (r) continue; }
        { const t = thin(pr.is, d.body.professions ?? []); if (t) return t; }
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
        if (codeWord(m.is)) return refuse(`say what "${m.is}" is in plain words, not a code word.`);
        const t = d.unknown(m.tags);
        if (t) return refuse(`"${t}" is not a registered word. Register it in "words".`);
        { const r = await fromPool('minerals', m.is, m.regions); if (typeof r === 'object') return r; if (r) continue; }
        { const t = thin(m.is, formed(MINERAL_FORMS)); if (t) return t; }
        addMaterial(m.is, m.form, m.tags, m.regions, 'holds');
      }
      for (const j of a?.junk ?? []) {
        if (!j.is?.trim() || !j.from?.length) return refuse('junk needs what it is and the creature words it comes from.');
        if (codeWord(j.is)) return refuse(`say what "${j.is}" is in plain words, not a code word.`);
        const t = d.unknown([...j.tags, ...j.from]);
        if (t) return refuse(`"${t}" is not a registered word. Register it in "words".`);
        { const r = await fromPool('junk', j.is); if (typeof r === 'object') return r; if (r) continue; }
        { const t = thin(j.is, d.body.junk ?? []); if (t) return t; }
        addJunk(j.is, j.tags, j.from, 'holds');
      }
      for (const an of a?.anchors ?? []) {
        if (!an.is?.trim() || !regionsOk(an.regions)) return refuse('a thing of worth needs what it is and where it is found.');
        if (codeWord(an.is)) return refuse(`say what "${an.is}" is in plain words, not a code word.`);
        const t = d.unknown(an.tags);
        if (t) return refuse(`"${t}" is not a registered word. Register it in "words".`);
        { const r = await fromPool('anchors', an.is, an.regions); if (typeof r === 'object') return r; if (r) continue; }
        { const t = thin(an.is, d.body.anchors ?? []); if (t) return t; }
        addAnchor(an.is, an.tags, an.regions, 'anchor');
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
    },

    // C16: what the law asks and the pool could not give, the model adds; the need decides what it is for
    lack: async (a: ILackAnswer) => {
      const lack = asked!;
      const w = d.addWords(a?.words ?? []);
      if (w) return w;
      const where = (regions: string[]) => [...new Set([...(regions ?? []), ...(lack.regions ?? [])])];
      const items = (a?.[lack.list] ?? []) as unknown[];
      if (items.length === 0) return refuse(`this world still lacks something to ${lack.need}, and nothing was added in "${lack.list}".`);
      if (lack.list === 'fauna') {
        for (const f of items as IFaunaAnswer['fauna']) {
          const bad = creatureRefused({ ...f, regions: where(f.regions) }) ?? thin(f.is, d.body.creatures);
          if (bad) return bad;
          const c = addCreature(f.is, f.tags, lack.role === 'lead' || !!f.social, !!f.builds, where(f.regions), 'lack');
          if (lack.role === 'monster' || lack.role === 'animal') {
            const threat = lack.role === 'monster' ? 'deadly' : 'meek';
            Object.assign(c, { threat, ...temperOf(threat) });
            if (c.tree === 'animal') c.builds = false;
          }
          if (lack.role === 'start') c.rank = 'F';
        }
      }
      if (lack.list === 'materials') {
        for (const m of items as ILackAnswer['materials']) {
          const forms = [...FLORA_FORMS, ...MINERAL_FORMS] as readonly string[];
          if (!m.is?.trim() || !forms.includes(m.form) || !regionsOk(where(m.regions))) return refuse('a new material needs what it is, the form it takes, and where.');
          if (codeWord(m.is)) return refuse(`say what "${m.is}" is in plain words, not a code word.`);
          if (d.rulesOut(m.is)) return refuse(`"${m.is}" is something this world is without.`);
          const t = d.unknown(m.tags);
          if (t) return refuse(`"${t}" is not a registered word. Register it in "words".`);
          { const e = thin(m.is, d.body.materials); if (e) return e; }
          const tags = lack.role === 'building' ? [...new Set([...(m.tags ?? []), 'building'])] : m.tags;
          addMaterial(m.is, m.form, tags, where(m.regions), 'lack');
        }
      }
      if (lack.list === 'anchors') {
        for (const an of items as ILackAnswer['anchors']) {
          if (!an.is?.trim() || !regionsOk(where(an.regions))) return refuse('a thing of worth needs what it is and where it is found.');
          if (codeWord(an.is)) return refuse(`say what "${an.is}" is in plain words, not a code word.`);
          const t = d.unknown(an.tags);
          if (t) return refuse(`"${t}" is not a registered word. Register it in "words".`);
          { const e = thin(an.is, d.body.anchors ?? []); if (e) return e; }
          addAnchor(an.is, an.tags, where(an.regions), 'lack');
        }
      }
      if (lack.list === 'gear') {
        for (const g of items as ILackAnswer['gear']) {
          if (!g.is?.trim() || codeWord(g.is)) return refuse('a new piece needs what it is, in plain words.');
          if (lack.kinds?.length && !lack.kinds.includes(g.kind)) return refuse(`"${g.kind}" does not ${lack.need}: it is one of ${lack.kinds.join(', ')}.`);
          if (d.rulesOut(g.is)) return refuse(`"${g.is}" is something this world is without.`);
          { const e = thin(g.is, d.body.gear); if (e) return e; }
          addGear(g.is, g.kind);
        }
      }
      return null;
    },

    // C21: more pieces for a world whose names ran out. Only a piece it does not have yet counts
    names: async (a: INamesAnswer) => {
      const added = d.names.grow({ prefixes: a?.prefixes ?? [], suffixes: a?.suffixes ?? [] });
      if (added.prefixes.length === 0 && added.suffixes.length === 0) {
        return refuse('every piece written is one this world already has: write new ones, in plain letters.');
      }
      more.prefixes.push(...added.prefixes);
      more.suffixes.push(...added.suffixes);
      return null;
    }
  } as never;

  const plantRefused = (f: IFloraAnswer['flora'][number]): Refusal | null => {
    if (!f.is?.trim() || !(FLORA_FORMS as readonly string[]).includes(f.form) || !regionsOk(f.regions)) return refuse('a new plant needs what it is, a form that grows, and where it lives.');
    if (codeWord(f.is)) return refuse(`say what "${f.is}" is in plain words, not a code word.`);
    const t = d.unknown(f.tags);
    return t ? refuse(`"${t}" is not a registered word. Register it in "words".`) : null;
  };

  const creatureRefused = (f: IFaunaAnswer['fauna'][number]): Refusal | null => {
    if (!f.is?.trim() || !regionsOk(f.regions)) return refuse('a new creature needs what it is and where it lives.');
    if (codeWord(f.is)) return refuse(`say what "${f.is}" is in plain words, not a code word.`);
    if (!f.tags?.length) return refuse('a new creature carries at least one word, so it leaves something when it falls.');
    const t = d.unknown(f.tags);
    if (t) return refuse(`"${t}" is not a registered word. Register it in "words".`);
    if (f.tags.some(x => ['elite', 'boss', 'titan', 'god'].includes(x))) return refuse('who leads, and who is one of a kind, is decided by code, never written.');
    return null;
  };

  const addMaterial = (is: string, form: string, tags: string[], regions: string[], pass: string) => {
    const { name, key } = d.fresh('material');
    const rng = d.rng(pass, d.added);
    d.body.materials.push({
      key, name, blurb: is.trim(), tags: tags ?? [], rank: d.rank(rng), form: form as typeof MATERIAL_FORMS[number], verb: VERB_OF_FORM[form] ?? 'hands',
      weight: rng.pick([...WEIGHTS]), worth: rng.pick([...WORTHS]), habitat: [...new Set(regions)] as IThemeMaterial['habitat'],
      onShelf: rng.next() < 0.5, restores: 'none'
    });
  };

  const addCreature = (is: string, tags: string[], social: boolean, builds: boolean, regions: string[], pass: string) => {
    const { name, key } = d.fresh('creature');
    const rng = d.rng(pass, d.added);
    const threat = rng.pick([...THREATS]);
    const { behavior, tree } = temperOf(threat);
    const c: IThemeCreature = {
      key, name, blurb: is.trim(), tags, rank: d.rank(rng), size: rng.pick([...SIZES]), behavior,
      build: rng.pick([...BUILDS]), threat, pace: rng.pick([...PACES]),
      habitat: [...new Set(regions)] as IThemeCreature['habitat'], innate: [], tree, social, builds: tree === 'animal' ? false : builds, leads: ''
    };
    d.body.creatures.push(c);
    return c;
  };

  const addAnchor = (is: string, tags: string[], regions: string[], pass: string) => {
    const { name, key } = d.fresh('anchor');
    const rng = d.rng(pass, d.added);
    d.body.anchors!.push({ key, name, blurb: is.trim(), tags: tags ?? [], rank: d.rank(rng), weight: rng.pick([...WEIGHTS]), worth: rng.pick([...WORTHS]), foundIn: [...new Set(regions)] as IThemeAnchor['foundIn'] });
  };

  /** A piece the pool could not give: found, never made here, rank F, a beginner's. A tool answers what its verb works here. */
  const addGear = (is: string, kind: string) => {
    const { name, key } = d.fresh('gear');
    const verb = kind.endsWith('_tool') ? kind.slice(0, -'_tool'.length) : '';
    const works = verb ? [...new Set(d.body.materials.filter(m => m.verb === verb).flatMap(m => m.tags))] : [];
    d.body.gear.push({ key, name, blurb: is.trim(), kind: kind as IThemeGear['kind'], rank: 'F', tags: [], works, carries: '', trigger: '', from: [], craftAt: 'none' });
  };

  const addJunk = (is: string, tags: string[], from: string[], pass: string): string => {
    const { name, key } = d.fresh('junk');
    const rng = d.rng(pass, d.added);
    d.body.junk!.push({ key, name, blurb: is.trim(), tags, rank: d.rank(rng), weight: rng.pick([...WEIGHTS]), worth: rng.pick([...WORTHS]), from });
    return key;
  };

  // ---------------------------------------------------------------- the passes
  /** The need a lack ask is out for (C16). */
  let asked: ILack | undefined;

  /** One pass, asked again once if refused. The failure, or null when it stood. */
  const runPass = async (pass: WorldPassId, i: number, lack?: ILack, names?: INamePieces): Promise<IWriteResult | null> => {
    o.onPass?.(pass, i);
    const offered: IPassAsk['offered'] = {};
    for (const list of PASS_PULLS[pass]) {
      // Nothing is offered that the fold would refuse to bring: what it stands on is ruled out too (C1)
      const near = (await o.pull.offer(list, query(), d.without)).filter(e => !d.bringsRuledOut(e));
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
      const out = await o.door(pass, { pass, said, world: worldSoFar(d), offered, words: d.words(), ...(lack ? { lack } : {}), ...(names ? { names } : {}), ...(refused ? { refused } : {}) });
      usage = sum(usage, out.usage);
      spent += out.usage?.usd ?? 0;
      if (out.status !== 'OK' || !out.data) {
        passes.push({ pass, tries, picked: 0, added: 0, takenFromPool: 0, usd: spent });
        return { ok: false, pass, status: out.status, reason: out.reason ?? `The Seed did not answer (${out.status}).`, usage, passes };
      }
      // A refused answer leaves nothing behind: the draft is rebuilt from what stood before it
      let snapshot = d.save();
      let verdict: Refusal | null;
      for (;;) {
        try {
          asked = lack;
          verdict = await folds[pass](out.data as never, pass as never);
          break;
        } catch (e) {
          if (!(e instanceof WellDry)) throw e;
          // C21: the answer ran the names dry. The world writes more pieces, and the same answer is read again
          d.restore(snapshot);
          // The ground pass makes its well as it folds, so the restored draft may not hold the pieces yet
          d.names.grow(e.pieces);
          const failed = await runPass('names', WORLD_PASSES.length, undefined, e.pieces);
          if (failed) return failed;
          snapshot = d.save();
        }
      }
      if (verdict) {
        d.restore(snapshot);
        refused = verdict.refused;
        continue;
      }
      done = true;
    }
    passes.push({ pass, tries, picked: d.picked - before.picked, added: d.added - before.added, takenFromPool: d.takenFromPool - before.pool, usd: spent });
    if (!done) return { ok: false, pass, reason: `Refused twice: ${refused}`, usage, passes };
    return null;
  };

  for (let i = 0; i < WORLD_PASSES.length; i++) {
    const failed = await runPass(WORLD_PASSES[i], i);
    if (failed) return failed;
  }

  // ---------------------------------------------------------------- the floors
  // C16: what the pool cannot give is never a refusal: the model adds it, one need an ask, and the floors are read again.
  // A need met stays met (the fold makes what is added meet it), so this ends when the floors are whole
  for (let lack = await floors(d, o, query(), embedder, addJunk), last = ''; lack; lack = await floors(d, o, query(), embedder, addJunk)) {
    const key = JSON.stringify(lack);
    if (key === last) return { ok: false, pass: 'lack', reason: `the world still lacks something to ${lack.need}.`, usage, passes };
    last = key;
    const failed = await runPass('lack', WORLD_PASSES.length, lack);
    if (failed) return failed;
  }

  const verdict = ThemeLaw.validate(d.body, tag => d.known(tag));
  if (!verdict.ok) return { ok: false, reason: verdict.reason ?? 'The law refused it.', usage, passes };
  return { ok: true, body: d.body, usage, passes };
}

/**
 * What the law asks of every world, filled by code from the pool, nearest to the theme first.
 * Who leads is code's to decide (D93), and so is every band. Returns the first thing the pool
 * could not give, for the model to add (C16), or null when the floors are whole.
 */
async function floors(d: Draft, o: IWriteOptions, query: string, embedder: IEmbedder, addJunk: (is: string, tags: string[], from: string[], pass: string) => string): Promise<ILack | null> {
  const b = d.body;
  const nearest = async (list: PoolList, ok: (e: IPoolEntry) => boolean) => {
    const all = await o.pull.near(list, query, d.without);
    return all.find(e => ok(e) && !d.bringsRuledOut(e));
  };
  const bringNearest = async (list: PoolList, ok: (e: IPoolEntry) => boolean, lack: ILack): Promise<ILack | null> => {
    const e = await nearest(list, ok);
    if (!e) return lack;
    d.bring(e);
    return null;
  };
  const entry = <T>(e: IPoolEntry) => e.entry as unknown as T;

  // D63: a world holds its animals and its monsters. Aggression is code's roll, so where one tree is
  // empty the first new kind of the other is rolled again into it; with none new, the pool lends one
  const added = (c: IThemeCreature) => c.innate.length === 0 && !c.leads && !poolNames.has(c.name);
  const poolNames = new Set(o.packs.flatMap(p => p.creatures.map(c => c.name)));
  for (const [tree, threat] of [['monster', 'deadly'], ['animal', 'meek']] as const) {
    if (b.creatures.some(c => c.tree === tree)) continue;
    const other = b.creatures.filter(c => added(c) && b.creatures.filter(x => x.tree === c.tree).length > 1)[0];
    if (other) Object.assign(other, { threat, ...temperOf(threat), builds: tree === 'animal' ? false : other.builds });
    else {
      const why = await bringNearest('fauna', e => entry<IThemeCreature>(e).tree === tree, { need: `give it ${tree === 'monster' ? 'something dangerous' : 'something harmless'}`, list: 'fauna', role: tree });
      if (why) return why;
    }
  }

  // Something small enough to start on: the roll is code's, so the gentlest new kind starts at F
  if (!b.creatures.some(c => c.rank === 'F' || c.rank === 'E')) {
    const own = b.creatures.find(c => c.innate.length === 0 && c.tree === 'animal') ?? b.creatures[0];
    if (own) own.rank = 'F';
    else {
      const why = await bringNearest('fauna', e => ['F', 'E'].includes(entry<IThemeCreature>(e).rank), { need: 'give it something to start on', list: 'fauna', role: 'start' });
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
      const why = await bringNearest('fauna', e => isPlainElite(entry<IThemeCreature>(e)) && !!entry<IThemeCreature>(e).social, { need: 'lead a pack, living in a group', list: 'fauna', role: 'lead' });
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
  const gearNeeds: [string, string[]][] = [
    ['arm a beginner', WEAPON_KINDS],
    ['dress a beginner', ARMOR_KINDS],
    ['shoe a beginner', ['feet']]
  ];
  for (const [need, kinds] of gearNeeds) {
    const ok = (g: IThemeGear) => kinds.includes(g.kind) && g.rank === 'F';
    if (b.gear.some(ok)) continue;
    const no = await bringNearest('gear', e => ok(entry<IThemeGear>(e)), { need, list: 'gear', kinds });
    if (no) return no;
  }

  if (!b.materials.some(m => m.tags.includes('building'))) {
    const near = await nearest('minerals', e => entry<IThemeMaterial>(e).tags.includes('building'))
      ?? await nearest('flora', e => entry<IThemeMaterial>(e).tags.includes('building'));
    if (!near) return { need: 'raise a wall', list: 'materials', role: 'building' };
    d.bring(near);
  }
  if (b.anchors!.length === 0) {
    const no = await bringNearest('anchors', () => true, { need: 'hold value', list: 'anchors' });
    if (no) return no;
  }

  // Last, as whatever came before may stand on wood or ore: a tool for every verb the ground asks
  for (const verb of ['chop', 'mine'] as const) {
    if (!b.materials.some(m => m.verb === verb) || b.gear.some(g => g.kind === `${verb}_tool`)) continue;
    const no = await bringNearest('gear', e => entry<IThemeGear>(e).kind === `${verb}_tool`, { need: `${verb} what the ground holds`, list: 'gear', kinds: [`${verb}_tool`] });
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
      if (!m) return { need: `grow or lie on the ${region.biome} ground`, list: 'materials', regions: [region.biome] };
      m.habitat = [...m.habitat, region.biome];
    }
    if (!b.creatures.some(c => c.habitat.includes(region.biome))) {
      const c = await closest(b.creatures);
      if (!c) return { need: `live on the ${region.biome} ground`, list: 'fauna', regions: [region.biome] };
      c.habitat = [...c.habitat, region.biome];
    }
  }
  return null;
}

export type { IThemeAbility, IThemeStation };
