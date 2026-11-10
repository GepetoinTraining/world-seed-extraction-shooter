/**
 * CHARACTER CREATION (Pedro's June design, D35-D37): "the player will archetype then choose
 * initial set of gear, then choose the face of the world they'll spawn into then they'll
 * talk with the god of reincarnaiton and be granted skills."
 *
 * Pure: this file reads the bank, the web and the content, and touches no store. A person
 * picks who they were, what they carry and which world's face they meet; the Seed asks a
 * few plain things, and what their hands already know comes back through the door (D35),
 * judged here, with a floor from the bank keyed by the answers, so nothing waits on a model.
 *
 * Stats deal from the certificate by NpcSheet's law, so people and NPCs read alike, and
 * focus only moves the top of that deal onto what was focused on. The face is the
 * certificate's too, and nothing here touches it.
 */

import { IAttributes, ICreationRecord, IItem, ISkillState, MENTAL_ATTRIBUTES, PHYSICAL_ATTRIBUTES, UniversalRank } from '../../../shared/types';
import type { IDoorMessage } from '../intelligence/IntelligenceClient';
import { ITEM_DEFINITIONS, ItemDefinition } from '../../../shared/entities/item/data/itemDefinitions';
import { RESOURCE_DEFINITIONS } from '../../../shared/entities/item/data/resourceDefinitions';
import { ItemFactory } from '../../../shared/entities/item/ItemFactory';
import { IKitAsk } from '../../entities/generation/packs/originBatches';
import { IDoorUsage } from '../intelligence/IntelligenceClient';
import { OriginBank } from '../content/OriginBank';
import { TagLaw } from '../../../shared/logic/content/TagLaw';
import { WebBank } from '../../../shared/logic/content/WebBank';
import { Rng } from '../../../shared/logic/rng/DeterministicRNG';
import { SHELF } from '../../../shared/logic/theme/shelf';
import { SKILL_GRANTS } from '../../../shared/logic/theme/ThemeTypes';
import { NpcSheet } from '../../../shared/logic/systems/NpcSheet';
import { WebSystem } from '../../../shared/logic/systems/WebSystem';

/** One for the main focus, one for the sub focus, one for what was said. */
export const GRANTED_SKILLS = 3;
/** How many plain things the Seed asks. Under a minute is the point (the plan's own rule). */
export const QUESTIONS_ASKED = 3;

/**
 * The fifth (Pedro): "right now we have 4 hardcoded classes, we're adding a 5th one, fate
 * gambler, that one calls up a stream style conversation with sonnet and you talk with kami
 * itself, he'll set up the class." No life is picked and no kit: Kami chooses them, the law
 * judges what he chose, and with no key or no answer, fate deals it from what was said.
 */
export const FATE_GAMBLER = 'FATE_GAMBLER';
export const FATE_ORIGIN = 'fate_gambler';

const ALL_ATTRIBUTES = [...PHYSICAL_ATTRIBUTES, ...MENTAL_ATTRIBUTES] as (keyof IAttributes)[];
const HIDDEN = /archetype|trope|isekai/i;

export interface ICreationDraftChoices {
  originId: string;
  kitId: string;
  silhouette: string;
  hubId: string;
  themeId: string;
  answers: Record<string, string>;
  said: string;
}

export interface ICreationSkillWords { id: string; name: string; flavor: string; grants: string[] }
export interface ICreationWords { line: string; skills: ICreationSkillWords[] }

/** One thing a person carries, as whoever grants their skills is shown it: what it is called and what it is. */
export interface ICarried { name: string; tags: string[] }
/**
 * A skill that could be granted. `name` is the bank's, and absent when nobody has named the skill
 * yet (Q47). `tool` is what it is worked with, in the web's own tool words, and absent for what bare
 * hands do (C9).
 */
export interface ICandidate { id: string; name?: string; tags: string[]; tool?: string[] }

/** What goes to the door. It carries who they were in plain words, and never the bank's id. */
export interface ICreationAsk {
  who: { was: string; line: string };
  focus: { main: string | null; sub: string | null };
  /** C9: by name and by tag, so what a skill is worked with can be checked against it. */
  carries: ICarried[];
  said: { asked: string; answered: string }[];
  alsoSaid: string;
  count: number;
  candidates: ICandidate[];
  /** Why the last grant was not taken, when this is the second asking. */
  refused?: string;
}

/** What Kami chooses from. Only the bank's kits and the web's skills: he sets a class, he does not mint things. */
export interface IKamiAsk {
  attributes: string[];
  kits: { id: string; says: string; line: string; carries: ICarried[] }[];
  count: number;
  candidates: ICandidate[];
}

/** What he sets up. */
export interface IKamiWords extends ICreationWords { name: string; main: string; sub: string; kit: string }

/** What the flow hands to the store at the mint. */
export interface ICreationSheet {
  silhouette: string;
  /** D81: where they arrive is a pin the gate writes, and nothing on the character says it. */
  hubId?: string;
  record: ICreationRecord;
  words: ICreationWords;
  usage?: IDoorUsage;
}

export interface IKitPiece { definitionId: string; name: string; tags: string[] }

const keyedShuffle = <T>(list: readonly T[], key: string): T[] => {
  const rng = Rng.fromKey(key);
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = rng.int(0, i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
};

const answersKey = (draft: Pick<ICreationDraftChoices, 'answers' | 'said'>): string =>
  `${Object.keys(draft.answers).sort().map(q => `${q}=${draft.answers[q]}`).join('&')}|${draft.said.trim()}`;

/** A template a kit can ask for, from what the content holds. A theme that has none simply gives less. */
function poolFor(ask: IKitAsk): ItemDefinition[] {
  const byId = (ids: string[]) => {
    const all = [...ITEM_DEFINITIONS.weapon_bases, ...ITEM_DEFINITIONS.armor_bases, ...ITEM_DEFINITIONS.tool_bases];
    return ids.map(id => all.find(b => b.id === id)).filter(Boolean) as ItemDefinition[];
  };
  const hasTag = (b: ItemDefinition) => !ask.tag || (b.tags ?? []).includes(ask.tag);
  const rankF = (b: ItemDefinition) => b.rank === UniversalRank.F;
  switch (ask.from) {
    case 'weapon': return ITEM_DEFINITIONS.weapon_bases.filter(rankF).filter(hasTag);
    case 'armor': return ITEM_DEFINITIONS.armor_bases.filter(rankF).filter(hasTag);
    case 'tool': return ITEM_DEFINITIONS.tool_bases.filter(rankF).filter(hasTag);
    case 'carrier': return byId(SHELF.carrier).filter(hasTag);
    case 'wardrobe': return byId(SHELF.wardrobe).filter(hasTag);
    default: return [];
  }
}

/** Each piece of a kit, chosen once by its own key, so the preview and the mint agree. */
function kitDefinitions(kitId: string): { ask: IKitAsk; template?: ItemDefinition; resourceId?: string }[] {
  const kit = OriginBank.kit(kitId);
  if (!kit) return [];
  const taken = new Set<string>();
  return kit.pieces.map((ask, i) => {
    const key = `creation:kit:${kitId}:${i}`;
    if (ask.from === 'consumable') {
      const fits = [...SHELF.consumables, ...SHELF.materials].filter(id => RESOURCE_DEFINITIONS[id] && (!ask.tag || (RESOURCE_DEFINITIONS[id].tags ?? []).includes(ask.tag)));
      const fresh = fits.filter(id => !taken.has(id));
      const pool = fresh.length > 0 ? fresh : fits;
      const resourceId = pool.length > 0 ? keyedShuffle(pool, key)[0] : undefined;
      if (resourceId) taken.add(resourceId);
      return { ask, resourceId };
    }
    const all = poolFor(ask);
    const fresh = all.filter(b => !taken.has(b.id));
    const pool = fresh.length > 0 ? fresh : all;
    const template = pool.length > 0 ? keyedShuffle(pool.map(b => b.id), key)[0] : undefined;
    if (template) taken.add(template);
    return { ask, template: all.find(b => b.id === template) };
  });
}

export class CreationSystem {

  // ---------------------------------------------------------------------------
  // WHO YOU WERE: focus shapes the spread, and the certificate deals it
  // ---------------------------------------------------------------------------

  /** Exactly what an NPC of rank F would be dealt from this certificate. */
  private static dealt(uid: string): IAttributes {
    return NpcSheet.read(uid, { id: uid, rank: UniversalRank.F }, undefined).stats as IAttributes;
  }

  /** The top of the deal moves onto what was focused on, and the rest stays as dealt. The total never moves. */
  static spread(uid: string, originId: string): IAttributes {
    const origin = OriginBank.origin(originId);
    return this.spreadOn(uid, origin?.main, origin?.sub);
  }

  /** The same deal, for a focus that came from anywhere. With none named it stays as dealt. */
  static spreadOn(uid: string, main: string | null | undefined, sub: string | null | undefined): IAttributes {
    const out = { ...this.dealt(uid) } as unknown as Record<string, number>;
    if (!main || !sub) return out as unknown as IAttributes;
    const swapTopOnto = (attr: string, keep: string[]) => {
      const top = ALL_ATTRIBUTES.filter(a => !keep.includes(a)).reduce((best, a) => (out[a] > out[best] ? a : best), attr as keyof IAttributes);
      [out[attr], out[top]] = [out[top], out[attr]];
    };
    swapTopOnto(main, []);
    swapTopOnto(sub, [main]);
    return out as unknown as IAttributes;
  }

  /** Read from what was signed, whoever chose it. An empty focus is the top of what the certificate dealt. */
  static focusOfRecord(record: Pick<ICreationRecord, 'origin' | 'main' | 'sub'>, uid: string): { main: string; sub: string } {
    return record.main && record.sub ? { main: record.main, sub: record.sub } : this.focusOf(record.origin, uid);
  }

  /** What a person focuses on. With none named, the top of what the certificate dealt. */
  static focusOf(originId: string, uid: string): { main: string; sub: string } {
    const origin = OriginBank.origin(originId);
    if (origin?.main && origin.sub) return { main: origin.main, sub: origin.sub };
    const spread = this.spread(uid, originId) as unknown as Record<string, number>;
    const sorted = [...ALL_ATTRIBUTES].sort((a, b) => spread[b] - spread[a]);
    return { main: sorted[0], sub: sorted[1] };
  }

  // ---------------------------------------------------------------------------
  // WHAT YOU CARRY
  // ---------------------------------------------------------------------------

  static kitPreview(kitId: string): IKitPiece[] {
    return kitDefinitions(kitId).flatMap(({ template, resourceId }) => {
      if (template) return [{ definitionId: template.id, name: template.universal_name, tags: template.tags ?? [] }];
      const res = resourceId ? RESOURCE_DEFINITIONS[resourceId] : undefined;
      return res ? [{ definitionId: res.id, name: res.name, tags: res.tags ?? [] }] : [];
    });
  }

  /** The kit, minted for one person. The same person gets the same rolls; another holds other items. */
  static mintKit(uid: string, kitId: string): IItem[] {
    return kitDefinitions(kitId).flatMap(({ template, resourceId }, i) => {
      const rng = Rng.fromKey(`${uid}:genesis:kit:${kitId}:${i}`);
      if (template) return [ItemFactory.createFromTemplate(template, true, rng)];
      const res = resourceId ? RESOURCE_DEFINITIONS[resourceId] : undefined;
      return res ? [ItemFactory.createResourceItem(res, rng, { origin: 'WORLD' })] : [];
    }).map(item => ({ ...item, isIdentified: true }));
  }

  // ---------------------------------------------------------------------------
  // THE CONVERSATION
  // ---------------------------------------------------------------------------

  static questionsFor(originId: string) {
    return keyedShuffle(OriginBank.questions(), `creation:questions:${originId}`).slice(0, QUESTIONS_ASKED);
  }

  // ---------------------------------------------------------------------------
  // C9: THE KIT AND THE SKILLS AGREE (Pedro, 2026-11-10: "api call haiku and make him check if
  // the kit makes sense... randomness shouldn't be allowed there"). A skill is worked with a
  // tool or by hand, and the web says which. Whoever grants (the Seed, Kami, or the floor) is
  // held to what the person carries, and nothing here is rolled.
  // ---------------------------------------------------------------------------

  /** What a skill is worked with: the web's tool words among its tags. None means bare hands. */
  static toolsOf(skillId: string): string[] {
    const tools = new Set(WebBank.current().tags.filter(t => t.kind === 'tool').map(t => t.tag));
    return (TagLaw.parseSkillId(skillId) ?? []).filter(t => tools.has(t));
  }

  /** A skill as it is offered: its bank name where it has one, its tags, and what it is worked with. */
  private static candidate(skillId: string): ICandidate {
    const tool = this.toolsOf(skillId);
    return { id: skillId, name: WebSystem.bankNameOf(skillId), tags: TagLaw.parseSkillId(skillId) ?? [], ...(tool.length > 0 ? { tool } : {}) };
  }

  /** What a kit holds, by name and tag. */
  static carried(kitId: string): ICarried[] {
    return this.kitPreview(kitId).map(p => ({ name: p.name, tags: p.tags }));
  }

  /** The candidates someone carrying these things can work: by hand, or with a tool they hold. */
  static workable<T extends { tool?: string[] }>(candidates: T[], carries: ICarried[]): T[] {
    const held = new Set(carries.flatMap(c => c.tags));
    return candidates.filter(c => (c.tool ?? []).every(t => held.has(t)));
  }

  /**
   * THE LAW ON IT: a grant makes sense when every skill in it can be worked with what the person
   * carries. Where the web holds too few such skills to fill a grant, all of them must be in it.
   */
  static sense(ids: string[], ask: Pick<ICreationAsk, 'carries' | 'candidates' | 'count'>): { ok: boolean; reason?: string } {
    const works = this.workable(ask.candidates, ask.carries);
    const can = new Set(works.map(c => c.id));
    const said = (c: ICandidate) => c.name ?? WebSystem.nameOf(c.id);
    if (works.length >= ask.count) {
      const stray = ask.candidates.find(c => ids.includes(c.id) && !can.has(c.id));
      return stray ? { ok: false, reason: `${said(stray)} is worked with a ${(stray.tool ?? []).join(' and a ')}, and they carry none.` } : { ok: true };
    }
    const passed = works.find(c => !ids.includes(c.id));
    return passed ? { ok: false, reason: `${said(passed)} is something they can work with what they carry, and it was passed over.` } : { ok: true };
  }

  /**
   * Every skill this web can mint, in an order anyone could work out: what the kit can work, then
   * what leans furthest toward these words, then what the bank has named, then by id. No dice.
   * `namedFirst` puts the bank's names ahead of the leaning, for the floor: it has no voice to name
   * a skill (Q47), so among what the kit can work it takes a named one before a nameless one.
   */
  private static ranked(leans: readonly string[], kitId: string, except: string[] = [], namedFirst = false): ICandidate[] {
    const lean = new Set(leans);
    const all = WebBank.connections(WebBank.current()).map(c => this.candidate(c.skillId)).filter(c => !except.includes(c.id));
    const can = new Set(this.workable(all, this.carried(kitId)).map(c => c.id));
    const score = (c: ICandidate) => c.tags.filter(t => lean.has(t)).length;
    const works = (a: ICandidate, b: ICandidate) => Number(can.has(b.id)) - Number(can.has(a.id));
    const leaning = (a: ICandidate, b: ICandidate) => score(b) - score(a);
    const named = (a: ICandidate, b: ICandidate) => Number(!!b.name) - Number(!!a.name);
    const byId = (a: ICandidate, b: ICandidate) => (a.id < b.id ? -1 : 1);
    return all.sort((a, b) => works(a, b) || (namedFirst ? named(a, b) || leaning(a, b) : leaning(a, b) || named(a, b)) || byId(a, b));
  }

  /**
   * Q47: the floor has no voice to name a skill, and a tag list is no name, so it grants what the
   * bank has named first, in the order the leans gave. Only a bank with no names at all falls back.
   */
  private static namedFirst<T extends { id: string }>(list: T[]): T[] {
    const named = list.filter(c => WebSystem.bankNameOf(c.id));
    return [...named, ...list.filter(c => !WebSystem.bankNameOf(c.id))];
  }

  private static answerLeans(draft: Pick<ICreationDraftChoices, 'answers'>): string[] {
    return OriginBank.questions().flatMap(q => {
      const picked = q.answers.find(a => a.id === draft.answers[q.id]);
      return picked ? picked.leans : [];
    });
  }

  /** What the door is asked. A person's skills come from the web's own list and no other. */
  static ask(draft: ICreationDraftChoices): ICreationAsk {
    const origin = OriginBank.origin(draft.originId);
    const candidates = this.ranked([...(origin?.leans.main ?? []), ...(origin?.leans.sub ?? []), ...this.answerLeans(draft)], draft.kitId);
    return {
      who: { was: origin?.says ?? '', line: origin?.line ?? '' },
      focus: { main: origin?.main ?? null, sub: origin?.sub ?? null },
      carries: this.carried(draft.kitId),
      said: OriginBank.questions().flatMap(q => {
        const picked = q.answers.find(a => a.id === draft.answers[q.id]);
        return picked ? [{ asked: q.asks, answered: picked.says }] : [];
      }),
      alsoSaid: draft.said.trim(),
      count: GRANTED_SKILLS,
      // Q47: a skill nobody has named goes nameless, for the model to name
      candidates
    };
  }

  /**
   * THE FLOOR (D35): with no key and no network, this is what the Seed says. It follows the
   * life, the answers and the kit and rolls nothing for a skill (C9), so the same choices grant
   * the same, and it stands before the same law. Only its closing words are picked by key.
   */
  static floor(draft: ICreationDraftChoices): ICreationWords {
    const origin = OriginBank.origin(draft.originId);
    const key = `creation:floor:${draft.originId}:${answersKey(draft)}`;
    const picked: string[] = [];
    const take = (leans: readonly string[]) => {
      const best = this.ranked(leans, draft.kitId, picked, true)[0];
      if (best) picked.push(best.id);
    };
    take(origin?.leans.main ?? []);
    take(origin?.leans.sub ?? []);
    take(this.answerLeans(draft));

    const rng = Rng.fromKey(`${key}:words`);
    const flavors = OriginBank.flavors();
    const closings = OriginBank.closings();
    return {
      line: closings.length > 0 ? rng.pick(closings) : 'The bank honors it.',
      skills: picked.map(id => ({
        id,
        name: WebSystem.nameOf(id),
        flavor: flavors.length > 0 ? rng.pick(flavors) : '',
        grants: []
      }))
    };
  }

  /** THE LAW (D35): what came back, refused whole if any of it is wrong. A refusal falls to the floor. */
  static judge(words: ICreationWords, ask: ICreationAsk): { ok: boolean; reason?: string } {
    const no = (reason: string) => ({ ok: false, reason });
    if (!words || typeof words.line !== 'string' || !Array.isArray(words.skills)) return no('That is not what a grant returns.');
    if (!words.line.trim()) return no('The Seed said nothing.');
    if (HIDDEN.test(words.line)) return no('It said what stays unsaid.');
    if (words.skills.length !== ask.count) return no(`It was asked for ${ask.count} skills and ${words.skills.length} came back.`);
    const allowed = new Set(ask.candidates.map(c => c.id));
    const seen = new Set<string>();
    for (const s of words.skills) {
      if (!allowed.has(s.id)) return no(`Nobody offered ${s.id}.`);
      if (seen.has(s.id)) return no(`${s.id} came back twice.`);
      seen.add(s.id);
      if (!s.name?.trim()) return no(`${s.id} came back with no name.`);
      // Q47: a name is the model's to write. Its tag list is not a name.
      if (WebSystem.isTagListName(s.id, s.name)) return no(`${s.id} came back named by its tag list, "${s.name}".`);
      if (HIDDEN.test(s.name) || HIDDEN.test(s.flavor ?? '')) return no(`${s.id} says what stays unsaid.`);
      const stray = (s.grants ?? []).find(g => !(SKILL_GRANTS as readonly string[]).includes(g));
      if (stray) return no(`${s.id} grants "${stray}", and the game has no such thing.`);
    }
    // C9: what was granted has to be workable with what they carry
    return Array.isArray(ask.carries) ? this.sense(words.skills.map(s => s.id), ask) : { ok: true };
  }

  // ---------------------------------------------------------------------------
  // THE FIFTH: Kami sets it up
  // ---------------------------------------------------------------------------

  static kamiAsk(): IKamiAsk {
    return {
      attributes: ALL_ATTRIBUTES.map(String),
      kits: OriginBank.kits().map(k => ({ id: k.id, says: k.says, line: k.line, carries: this.carried(k.id) })),
      count: GRANTED_SKILLS,
      candidates: WebBank.connections(WebBank.current()).map(c => this.candidate(c.skillId))
    };
  }

  /** What he chose, refused whole if any of it is wrong. The skills stand before the same law as anyone's. */
  static judgeKami(words: IKamiWords, ask: IKamiAsk): { ok: boolean; reason?: string } {
    const no = (reason: string) => ({ ok: false, reason });
    if (!words || typeof words.name !== 'string' || typeof words.line !== 'string') return no('That is not what he returns.');
    if (!words.name.trim()) return no('He gave it no name.');
    if (HIDDEN.test(words.name)) return no('He said what stays unsaid.');
    if (!ask.attributes.includes(words.main) || !ask.attributes.includes(words.sub)) return no(`"${words.main}" and "${words.sub}" are not both attributes.`);
    if (words.main === words.sub) return no('He named the same focus twice.');
    const kit = ask.kits.find(k => k.id === words.kit);
    if (!kit) return no(`He offered a kit the bank does not hold: ${words.kit}.`);
    // C9: the kit he chose is what the skills he granted are held against
    return this.judge(words, { candidates: ask.candidates, count: ask.count, carries: kit.carries } as ICreationAsk);
  }

  /**
   * With no key, no answer or a broken one: fate deals the whole of it, keyed by what was said.
   * Dealing is what this one is. It still deals the skills from what the kit it dealt can work (C9).
   */
  static fateFloor(messages: Pick<IDoorMessage, 'role' | 'content'>[]): IKamiWords {
    const key = `creation:fate:${messages.map(m => `${m.role}=${m.content}`).join('|')}`;
    const [main, sub] = keyedShuffle(ALL_ATTRIBUTES.map(String), `${key}:focus`);
    const rng = Rng.fromKey(`${key}:words`);
    const flavors = OriginBank.flavors();
    const names = OriginBank.fateNames();
    const lines = OriginBank.fateLines();
    const kit = keyedShuffle(OriginBank.kits().map(k => k.id), `${key}:kit`)[0];
    const all = WebBank.connections(WebBank.current()).map(c => this.candidate(c.skillId));
    const can = this.workable(all, this.carried(kit));
    const dealt = [...this.namedFirst(keyedShuffle(can, `${key}:skills`)), ...keyedShuffle(all.filter(c => !can.includes(c)), `${key}:rest`)];
    return {
      name: names.length > 0 ? rng.pick(names) : 'WHATEVER CAME UP',
      line: lines.length > 0 ? rng.pick(lines) : 'The bank honors it.',
      main, sub,
      kit,
      skills: dealt.slice(0, GRANTED_SKILLS).map(c => ({
        id: c.id, name: WebSystem.nameOf(c.id), flavor: flavors.length > 0 ? rng.pick(flavors) : '', grants: []
      }))
    };
  }

  static kamiSheet(draft: ICreationDraftChoices, words: IKamiWords, by: 'DOOR' | 'FLOOR' = 'FLOOR', usage?: IDoorUsage): ICreationSheet {
    return {
      silhouette: FATE_GAMBLER,
      ...(draft.hubId ? { hubId: draft.hubId } : {}),
      words,
      usage,
      record: {
        origin: FATE_ORIGIN,
        className: words.name,
        main: words.main,
        sub: words.sub,
        kit: words.kit,
        ...(draft.themeId ? { themeId: draft.themeId } : {}),
        answers: {},
        line: words.line,
        by
      }
    };
  }

  // ---------------------------------------------------------------------------
  // WHAT LANDS
  // ---------------------------------------------------------------------------

  static heldSkills(words: ICreationWords): Record<string, ISkillState> {
    return Object.fromEntries(words.skills.flatMap(s => {
      const tags = TagLaw.parseSkillId(s.id);
      return tags ? [[s.id, WebSystem.freshSkill(s.id, tags, 0)]] : [];
    }));
  }

  static skillWords(words: ICreationWords): Record<string, { name: string; flavor: string; grants: string[] }> {
    return Object.fromEntries(words.skills.map(s => [s.id, { name: s.name, flavor: s.flavor, grants: s.grants ?? [] }]));
  }

  /** Everything the store needs from the flow. `by` says who wrote the words. */
  static sheet(draft: ICreationDraftChoices, words: ICreationWords, by: 'DOOR' | 'FLOOR' = 'FLOOR', usage?: IDoorUsage): ICreationSheet {
    const origin = OriginBank.origin(draft.originId);
    return {
      silhouette: draft.silhouette,
      ...(draft.hubId ? { hubId: draft.hubId } : {}),
      words,
      usage,
      record: {
        origin: draft.originId,
        main: origin?.main ?? '',
        sub: origin?.sub ?? '',
        kit: draft.kitId,
        ...(draft.themeId ? { themeId: draft.themeId } : {}),
        answers: draft.answers,
        ...(draft.said.trim() ? { said: draft.said.trim() } : {}),
        line: words.line,
        by
      }
    };
  }
}
