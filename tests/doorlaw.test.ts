/**
 * What the door asks and what the law takes, as Pedro's leg 1 answers left them (Q47, Q48, Q49).
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { CreationSystem, ICreationAsk, ICreationWords } from '../src/logic/systems/CreationSystem';
import { KamiPersona } from '../src/logic/systems/KamiPersona';
import { WebSystem } from '../shared/logic/systems/WebSystem';
import { WebBank } from '../shared/logic/content/WebBank';
import { TagLaw } from '../shared/logic/content/TagLaw';
import { buildCreationRequest, buildKamiPersonaRequest, buildKamiSetRequest, buildNpcTalkRequest, CREATION_SCHEMA, KAMI_SCHEMA } from '../shared/intelligence/prompts';

const SRC = (path: string) => readFileSync(path, 'utf8');

describe('a skill named by its tag list (Q47)', () => {
  // The shipped bank names every skill; a theme's own connections come unnamed, as "Fiber, Flora, Grain" did.
  // So two names are held back here, the way a theme's skill stands.
  const real = WebBank.current();
  const heldBack = new Set(real.names.slice(0, 2).map(n => TagLaw.canonical(n.tags).join('+')));
  beforeAll(() => { vi.spyOn(WebBank, 'current').mockReturnValue({ ...real, names: real.names.filter(n => !heldBack.has(TagLaw.canonical(n.tags).join('+'))) }); });
  afterAll(() => { vi.restoreAllMocks(); });

  let ask: ReturnType<typeof CreationSystem.kamiAsk>;
  let unnamed: typeof ask.candidates;
  let named: typeof ask.candidates;
  let asCreation: ICreationAsk;
  beforeAll(() => {
    ask = CreationSystem.kamiAsk();
    unnamed = ask.candidates.filter(c => !WebSystem.bankNameOf(c.id));
    named = ask.candidates.filter(c => !!WebSystem.bankNameOf(c.id));
    asCreation = { candidates: ask.candidates, count: ask.count } as ICreationAsk;
  });
  const wordsWith = (first: { id: string; name: string }): ICreationWords => ({
    line: 'The bank honors it.',
    skills: [first, ...ask.candidates.filter(c => c.id !== first.id).slice(0, ask.count - 1).map(c => ({ id: c.id, name: 'Quiet Hands', flavor: '', grants: [] }))]
      .map(s => ({ flavor: '', grants: [], ...s }))
  });

  it('the bank holds both kinds, so the bars below read something', () => {
    expect(unnamed.length).toBeGreaterThan(0);
    expect(named.length).toBeGreaterThan(0);
  });

  it('the ask leaves an unnamed candidate nameless, and a named one keeps the bank\'s name', () => {
    for (const c of unnamed) expect(c.name, c.id).toBeUndefined();
    for (const c of named) expect(c.name, c.id).toBe(WebSystem.bankNameOf(c.id));
  });

  it('the law refuses a name that is the tag list, however it is spelled', () => {
    const c = unnamed[0];
    const tags = WebSystem.tagWordsOf(c.id);
    for (const name of [WebSystem.nameOf(c.id), tags.join(', '), [...tags].reverse().join(' and ').toUpperCase()]) {
      const verdict = CreationSystem.judge(wordsWith({ id: c.id, name }), asCreation);
      expect(verdict.ok, name).toBe(false);
      expect(verdict.reason, name).toMatch(/tag/);
    }
  });

  it('a name of its own stands, and so does the bank\'s own name', () => {
    expect(CreationSystem.judge(wordsWith({ id: unnamed[0].id, name: 'Slow Gleaning' }), asCreation)).toEqual({ ok: true });
    expect(CreationSystem.judge(wordsWith({ id: named[0].id, name: WebSystem.bankNameOf(named[0].id)! }), asCreation)).toEqual({ ok: true });
  });

  it('the asks tell the model a nameless candidate is its to name, never by its tags', () => {
    expect(buildCreationRequest({}).system).toMatch(/no name/i);
    expect(buildKamiSetRequest([], {}).system).toMatch(/no name/i);
  });
});

describe('the keeper ask says where the person stands (Q48)', () => {
  it('a keeper\'s round carries where the person is, and the voice is told not to call them over', () => {
    const talk = SRC('src/entities/interaction/talkStore.ts');
    expect(talk).toMatch(/where: AT_THE_COUNTER/);
    expect(SRC('shared/logic/systems/TalkTypes.ts')).toMatch(/where\?: string/);
    const system = buildNpcTalkRequest({ who: { name: 'A', rank: 'D', temperament: '', objective: '', want: '', alignment: '', mind: {}, hands: [] }, memory: [], said: '', roll: 1, required: 1, bonuses: {}, meter: 1 }).system;
    expect(system).toMatch(/"where"/);
    expect(system).toMatch(/never tell them to come/i);
  });
});

describe('Kami\'s persona law (Q49)', () => {
  it('refuses "player" and "game", as the talk prompts already do', () => {
    expect(KamiPersona.judge('This one has grown weary of players who ask him to explain his luck.').ok).toBe(false);
    expect(KamiPersona.judge('This one treats every hour as a game he has already won.').ok).toBe(false);
    expect(KamiPersona.judge('This one taps three times before a throw, and plays gamely.').ok).toBe(true);
  });

  it('the persona ask tells the model so, so a reading is not wasted', () => {
    expect(buildKamiPersonaRequest('abc').system).toMatch(/"player"/);
    expect(buildKamiPersonaRequest('abc').system).toMatch(/"game"/);
  });
});

describe('a schema tightened to the ask, for a model held to every word of it', () => {
  const skillsOf = (schema: unknown) => (schema as { properties: { skills: Record<string, any> } }).properties.skills;
  const ask = { count: 3, candidates: [{ id: 'skill_a' }, { id: 'skill_b' }, { id: 'skill_c' }, { id: 'skill_d' }], kits: [{ id: 'kit_x' }] };

  it("a creation and Kami's set carry exactly the count and only the offered ids, and Kami's kit from his kits", () => {
    for (const request of [buildCreationRequest(ask), buildKamiSetRequest([], ask)]) {
      expect(skillsOf(request.tight)).toMatchObject({ minItems: 3, maxItems: 3 });
      expect(skillsOf(request.tight).items.properties.id.enum).toEqual(['skill_a', 'skill_b', 'skill_c', 'skill_d']);
    }
    expect((buildKamiSetRequest([], ask).tight as any).properties.kit.enum).toEqual(['kit_x']);
  });

  it('the frozen schema stays as it was, for a provider that caches it', () => {
    expect(buildCreationRequest(ask).schema).toBe(CREATION_SCHEMA);
    expect(buildKamiSetRequest([], ask).schema).toBe(KAMI_SCHEMA);
    expect(buildCreationRequest({}).tight).toBeUndefined();
  });
});
