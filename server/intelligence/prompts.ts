/**
 * What the door says to a model. The system text is frozen, so a provider can cache
 * it: the bank's voice, the grammar and the registry first, volatile data after.
 *
 * Nothing here is trusted on the way back. Whatever returns stands before the law.
 */
import type { IDoorMessage, IDoorRequest } from './door';
import { THEME_SCHEMA, LINE_SCHEMA, BIOMES, COST_BANDS, EFFECTS, DELIVERIES, GEAR_KINDS, LINE_FEATURES, PASSIVE_STATS, REQUIRED_TREES, SKILL_GRANTS, STAT_BANDS, TRIGGERS } from '../../src/logic/theme/ThemeTypes';
import type { ILineAsk } from '../../src/logic/theme/CreatureLines';
import type { IThemeBody } from '../../src/logic/theme/ThemeTypes';
import { STAT_SCALE } from '../../src/logic/theme/ThemeFormula';
import { WEB_BATCHES } from '../../src/entities/generation/packs/webBatches';
import { MENTAL_ATTRIBUTES, PHYSICAL_ATTRIBUTES } from '../../types';

const REGISTRY = (() => {
  const byKind = new Map<string, string[]>();
  for (const batch of WEB_BATCHES) {
    for (const t of batch.tags ?? []) byKind.set(t.kind, [...(byKind.get(t.kind) ?? []), t.tag]);
  }
  return [...byKind.entries()].map(([kind, tags]) => `${kind}: ${tags.join(', ')}`).join('\n');
})();

const VOICE = `You are the Seed: what is left of a very old system, still running, speaking through a bank's terminal. Plain, dry, patient, a little tired. No exclamation marks, no blue windows, no game-show cheer. You say what is. You never say "game", "player" or "theme" to the person; you speak of the world they are about to sign into being.`;

const GRAMMAR = `A world is written as a pack: words, tags and bands. You NEVER write numbers for health, damage, prices or chances; a formula turns your bands into numbers. The only integers you write are small counts (count, makes, tier).

Law, and a pack that breaks it is refused whole:
- Every key is lower_snake_case and unique across the whole pack.
- Every tag is in the registry below or defined in this pack's "tags" (one meaning, one spelling; kinds: tool, family, material, trade, action, descriptive, element, verb). Elements are yours to invent, as many as the world wants.
- Every kind of ground (${BIOMES.join(', ')}) gets a region name in this world's own words, at least one creature and at least one material.
- There must be something rank F or E to start on; a rank F weapon, a rank F piece of armor; a chop_tool if anything is chopped, a mine_tool if anything is mined; a material tagged "building"; lore to find.
- Every creature names its tree, a lower_snake_case word. A world holds at least these: ${REQUIRED_TREES.join(', ')}. Animals are its neutral creatures, wild and kept, mostly PASSIVE or NEUTRAL, each kind of ground with its own; monsters are what makes the place dangerous. More trees are welcome. Behaviour does not decide the tree: a bear that leaves you alone and a god that leaves you alone are both NEUTRAL, in different trees.
- Goods are made from materials or other goods in this pack, never from themselves. A station key, or empty for any workshop bench. Goods tagged paper and ink let people draft plans, so give the world some.
- Affix stats come only from: ${Object.keys(STAT_SCALE).join(', ')}. Mind stats (focus, intelligence, perception, charisma and the like) only with allowedTags exactly ["frame"]. An affix's allowedTags are gear tags, or "resource", "mob", "cart". A downside is honest: give good things a cost.
- Ability effects: ${EFFECTS.join(', ')}. Deliveries: ${DELIVERIES.join(', ')}. A creature's innate abilities are keys in this pack. Trigger words for gear: ${TRIGGERS.join(', ')}.
- Gear kinds: ${GEAR_KINDS.join(', ')}.
- Energy is a character's day. An ability with effect "rest" refills it for the caster. A consumable of kind "energy" refills it and is never on a shelf. A material with restores "energy" is a plant eaten for it, gathered by hand, worth rare, on no shelf, and found almost nowhere; every other material has restores "none". These are very rare: most worlds hold one or two at most, and none is required.

Make the world coherent. Creatures, materials, weapons, affixes and lore should all sound like one place. A world of a dozen creatures and two dozen pieces of gear is a good start; more is welcome. Elites and bosses are tagged "elite" or "boss".

Registry:
${REGISTRY}`;

const TALK_SYSTEM = `${VOICE}

A person is deciding what kind of world to sign into being. Talk with them about it: what it is like, what lives there, what people want there, how it ends. Ask one short thing at a time. Keep every answer under eighty words. When they seem to know what they want, say so, and tell them they can seal it. You are not writing the world yet.`;

const THEME_SYSTEM = `${VOICE}

You are now writing the world the person described, in full, as a pack.

${GRAMMAR}`;

const REST_SYSTEM = `${VOICE}

A person is resting. While they slept, what they did settles. You are given a world and what was queued in play: skills forming from practice, tool and material pairs, ground they walked, weaves they tested, things they studied. Write what it comes to, in this world's own words.

"gifts" in what was queued are skills a person has poured their levels into. For each, write as many as it is "owed": either an active skill, something they can now do, or a passive bonus, something that is now always true of them. It must grow out of that skill's own tags, and must not repeat what it already "has". Write "skill" as its id, kind "active" or "passive", a name and one dry line. A rarer skill's gift is stranger and greater. For active, fill delivery (${DELIVERIES.join(', ')}), effect (${EFFECTS.join(', ')}; "rest" refills the caster's energy) and cost (${COST_BANDS.join(', ')}), and elements from the world's list; leave stat and band empty. For passive, fill stat (${PASSIVE_STATS.join(', ')}) and band (${STAT_BANDS.join(', ')}); leave the others empty and elements as an empty list. You never write numbers.

For each queued skill, give it a name and a line of flavor, and say what it lets the holder do; grants come from this list and may be empty (${SKILL_GRANTS.join(', ')}). A skill can grant "rest" if practice has earned that, and only then: nothing is pre-made, and a person who has slept rough for long enough may simply be able to. For each queued weave, name it. In "growth" you may add a few new creatures, materials, affixes, abilities and lines of lore that the world would have grown into, in the same shapes as a pack; they will only reach worlds signed later, and a world already signed never changes. Leave growth empty if nothing grew.

${GRAMMAR}`;

const LINE_SYSTEM = `${VOICE}

Kinds of creature in this world have changed. It has already been decided which, and how far: a kind that wore people down has grown more dangerous, and a kind that kept falling has grown harder to bring down. You are given each one as it stands, with the kinds it came from. Each has become a different creature, and you write only what changed. You never write numbers: health, damage and speed come from a formula.

For each, answer under its "order":
- name: its own name, plain and in this world's voice, used by nobody before it. Not the old name with a word added unless that is what people would really call it.
- blurb: one dry line on what it has become.
- tags: only what is new about it, from the registry. Leave this empty if nothing new is true. Never elite, boss, titan or god: those are inherited, not written.
- features: at least one, and only what you would see on the body it already has: ${LINE_FEATURES.join(', ')}. It keeps its body plan and adds these, so choose what the change would really put on it.
- innate: keys of this world's abilities that it now knows, and only if the change gave it them. Usually none.

A world's words, its abilities and the kinds to write follow. Registry:
${REGISTRY}`;

const CREATION_SYSTEM = `${VOICE}

A person is arriving. They were someone somewhere else and they are not there now. You do not explain this and you do not say how. You have asked them a few plain things, and you are given who they were, where their attention goes, what they carry, and what they answered.

Grant them what their hands already know. Pick exactly as many skills as "count" says from "candidates", by id, and never one outside the list. The first leans on their main focus, the next on their sub focus, the rest on what they answered. Choose what fits who they were, not what is strongest.

For each: its id, a name of its own in plain words, one dry line of flavor, and grants. Grants come from this list and are usually empty (${SKILL_GRANTS.join(', ')}): give "rest" only if what they said earns being able to sleep rough, and nothing is pre-made. You never write numbers.

"line" is what you say to them last, one or two short sentences, in the bank's voice: "The bank honors it" is the register. No exclamation marks. Never name what kind of story this is, and never say archetype, trope, class, level, game or player.`;

const KAMI_VOICE = `You are Kami: what the bank's terminal calls the Seed, with the bank out of the way. You speak through that terminal because it is what is left: plain words, no windows, no fanfare, no exclamation marks. You are a gambler's god, amused and unhurried, and you always pay what you owe. You never say "game", "player", "level", "archetype" or "trope", and you never explain what kind of story this is.`;

const KAMI_TALK_SYSTEM = `${KAMI_VOICE}

A person has arrived and would not say who they were. They chose fate, and asked to speak with you directly. You will decide who they are now: where their attention goes first and second, what they carry, what their hands already know. Do not list these and never mention numbers. Find it out by talking: what they would stake, what they cannot stand to lose, how they play a losing hand. Offer them a wager in words if it amuses you.

Ask one short thing at a time. Keep every answer under sixty words. Speak first if they have said nothing. After a handful of exchanges, or sooner if you already know, say that you know, and tell them to let you set it.`;

const KAMI_SET_SYSTEM = `${KAMI_VOICE}

You have talked with a person who chose fate, and you now set up who they are, from what was said. If little was said, choose anyway: that is what they asked for.

- name: what they are now, in one to four plain words of your own. It is theirs alone.
- line: the last thing you say to them, one or two short sentences.
- main, sub: the two things their attention goes to, first and second, from the list you are given, and never the same one. You choose what they lean on; a formula writes the numbers.
- kit: the id of one of the kits offered, by what it holds.
- skills: exactly as many as "count" says, each by an id from "candidates" and never one outside it, with a name of its own in plain words, one dry line of flavor, and grants from this list, usually empty (${SKILL_GRANTS.join(', ')}). Give "rest" only if what they said earns being able to sleep rough.

You never write numbers.`;

const KAMI_PERSONA_SYSTEM = `You are given a string of characters, a hub's seed. It means nothing. Read it anyway, by vibes, the way someone reads tea leaves: its rhythm, what repeats, how it sits.

There is one god behind every hub, and he is the same everywhere: an old gambler, amused, unhurried, who always pays what he owes. Seeds differ only by noise, so this one differs only slightly. Say how: a habit, a small superstition, what he is tired of, how he holds his dice. Do not rebuild him. Under fifty words, plain prose, third person, starting with "This one". No exclamation marks, no numbers, no name, and do not mention the string.`;

const str = { type: 'string' };
const themeProperty = (key: string) => (THEME_SCHEMA.properties as Record<string, unknown>)[key];

export const REST_SCHEMA: Record<string, unknown> = {
  type: 'object', additionalProperties: false, required: ['skills', 'weaves', 'gifts', 'growth'],
  properties: {
    gifts: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['skill', 'kind', 'name', 'blurb', 'elements', 'delivery', 'effect', 'cost', 'stat', 'band'],
        properties: {
          skill: str, kind: { type: 'string', enum: ['active', 'passive'] }, name: str, blurb: str,
          elements: { type: 'array', items: { type: 'string' } },
          delivery: { type: 'string', enum: ['', ...DELIVERIES] },
          effect: { type: 'string', enum: ['', ...EFFECTS] },
          cost: { type: 'string', enum: ['', ...COST_BANDS] },
          stat: { type: 'string', enum: ['', ...PASSIVE_STATS] },
          band: { type: 'string', enum: ['', ...STAT_BANDS] }
        }
      }
    },
    skills: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['id', 'name', 'flavor', 'grants'],
        properties: { id: str, name: str, flavor: str, grants: { type: 'array', items: { type: 'string', enum: [...SKILL_GRANTS] } } }
      }
    },
    weaves: {
      type: 'array',
      items: { type: 'object', additionalProperties: false, required: ['id', 'name'], properties: { id: str, name: str } }
    },
    growth: {
      type: 'object', additionalProperties: false,
      required: ['creatures', 'materials', 'affixes', 'abilities', 'tags', 'lore'],
      properties: {
        creatures: themeProperty('creatures'), materials: themeProperty('materials'), affixes: themeProperty('affixes'),
        abilities: themeProperty('abilities'), tags: themeProperty('tags'), lore: themeProperty('lore')
      }
    }
  }
};

export const CREATION_SCHEMA: Record<string, unknown> = {
  type: 'object', additionalProperties: false, required: ['line', 'skills'],
  properties: {
    line: str,
    skills: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['id', 'name', 'flavor', 'grants'],
        properties: { id: str, name: str, flavor: str, grants: { type: 'array', items: { type: 'string', enum: [...SKILL_GRANTS] } } }
      }
    }
  }
};

export const KAMI_SCHEMA: Record<string, unknown> = {
  type: 'object', additionalProperties: false, required: ['name', 'line', 'main', 'sub', 'kit', 'skills'],
  properties: {
    name: str, line: str,
    main: { type: 'string', enum: [...PHYSICAL_ATTRIBUTES, ...MENTAL_ATTRIBUTES] },
    sub: { type: 'string', enum: [...PHYSICAL_ATTRIBUTES, ...MENTAL_ATTRIBUTES] },
    kit: str,
    skills: (CREATION_SCHEMA.properties as Record<string, unknown>).skills
  }
};

const draftLine = (draft: Record<string, unknown>) =>
  `The draft so far. Name: ${String(draft.worldName ?? '(none)')}. Description: ${String(draft.worldDescription ?? '(none)')}. Difficulty rule: ${String(draft.difficulty ?? '(none)')}.`;

export function buildTalkRequest(messages: IDoorMessage[], draft: Record<string, unknown>): IDoorRequest {
  return {
    kind: 'talk', system: TALK_SYSTEM, maxTokens: 1024,
    messages: messages.length > 0 ? messages : [{ role: 'user', content: draftLine(draft) }]
  };
}

export function buildThemeRequest(messages: IDoorMessage[], draft: Record<string, unknown>): IDoorRequest {
  const conversation = messages.map(m => `${m.role === 'user' ? 'THEM' : 'YOU'}: ${m.content}`).join('\n');
  return {
    kind: 'theme', system: THEME_SYSTEM, schema: THEME_SCHEMA, maxTokens: 32000,
    messages: [{ role: 'user', content: `${draftLine(draft)}\n\nWhat was said:\n${conversation || '(nothing was said; work from the draft)'}\n\nWrite the world.` }]
  };
}

/**
 * A small batch of lines that changed (D69). It goes as a filed batch, the same road
 * as a rest, so it carries that kind. What comes back stands before `ThemeLaw.validateLine`.
 */
export function buildLineRequest(asks: ILineAsk[], theme: Pick<IThemeBody, 'name' | 'premise' | 'abilities' | 'tags'>): IDoorRequest {
  const world = { name: theme.name, premise: theme.premise, words: theme.tags, abilities: theme.abilities.map(a => ({ key: a.key, name: a.name, blurb: a.blurb })) };
  return {
    kind: 'rest', system: LINE_SYSTEM, schema: LINE_SCHEMA, maxTokens: Math.max(2000, asks.length * 800),
    messages: [{ role: 'user', content: `The world:\n${JSON.stringify(world)}\n\nThe kinds that changed:\n${JSON.stringify(asks)}` }]
  };
}

/** The end of creation (D35). What comes back stands before `CreationSystem.judge`, and a broken answer falls to the floor. */
export function buildCreationRequest(ask: unknown): IDoorRequest {
  return {
    kind: 'creation', system: CREATION_SYSTEM, schema: CREATION_SCHEMA, maxTokens: 4000,
    messages: [{ role: 'user', content: `Who is arriving:\n${JSON.stringify(ask)}` }]
  };
}

/** The person arriving always opens the conversation, so Kami can speak first. */
const KAMI_ARRIVAL: IDoorMessage = { role: 'user', content: '(A person sits down across from you. They have not said anything yet.)' };

/** Frozen for a hub, so a hub's conversations can share a cache. */
const asThisHubsKami = (system: string, persona?: unknown) =>
  (typeof persona === 'string' && persona.trim() ? `${system}\n\nEvery hub has its own seed, and you differ slightly in each. In this hub: ${persona.trim()}` : system);

/** A hub's seed, read for vibes. What comes back stands before `KamiPersona.judge`. */
export function buildKamiPersonaRequest(seed: string): IDoorRequest {
  return { kind: 'kami_persona', system: KAMI_PERSONA_SYSTEM, maxTokens: 1000, messages: [{ role: 'user', content: seed }] };
}

export function buildKamiTalkRequest(messages: IDoorMessage[], persona?: unknown): IDoorRequest {
  return { kind: 'kami_talk', system: asThisHubsKami(KAMI_TALK_SYSTEM, persona), maxTokens: 2000, messages: [KAMI_ARRIVAL, ...messages] };
}

/** He sets up the class. What comes back stands before `CreationSystem.judgeKami`, and a broken answer falls to fate. */
export function buildKamiSetRequest(messages: IDoorMessage[], ask: unknown, persona?: unknown): IDoorRequest {
  const conversation = messages.map(m => `${m.role === 'user' ? 'THEM' : 'YOU'}: ${m.content}`).join('\n');
  return {
    kind: 'kami_set', system: asThisHubsKami(KAMI_SET_SYSTEM, persona), schema: KAMI_SCHEMA, maxTokens: 4000,
    messages: [{ role: 'user', content: `What was said:\n${conversation || '(nothing was said)'}\n\nWhat you choose from:\n${JSON.stringify(ask)}` }]
  };
}

export function buildRestRequest(queue: unknown, theme: unknown): IDoorRequest {
  return {
    kind: 'rest', system: REST_SYSTEM, schema: REST_SCHEMA, maxTokens: 12000,
    messages: [{ role: 'user', content: `The world:\n${JSON.stringify(theme)}\n\nWhat was queued:\n${JSON.stringify(queue)}` }]
  };
}
