/**
 * What the door says to a model. The system text is frozen, so a provider can cache
 * it: the bank's voice, the grammar and the registry first, volatile data after.
 *
 * Nothing here is trusted on the way back. Whatever returns stands before the law.
 */
import type { IDoorMessage, IDoorRequest } from './door';
import type { IWorldSummary } from '../../src/logic/theme/WorldGrowth';
import { THEME_SCHEMA, LINE_SCHEMA, BIOMES, COST_BANDS, EFFECTS, DELIVERIES, GEAR_KINDS, LINE_FEATURES, PASSIVE_STATS, REQUIRED_TREES, SKILL_GRANTS, STAT_BANDS, TRIGGERS } from '../../src/logic/theme/ThemeTypes';
import type { IGrowthAsk, ILineAsk } from '../../src/logic/theme/CreatureLines';
import { STAT_SCALE } from '../../src/logic/theme/ThemeFormula';
import { WEB_BATCHES } from '../../src/entities/generation/packs/webBatches';

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

For each queued skill, give it a name and a line of flavor, and say what it lets the holder do; grants come from this list and may be empty (${SKILL_GRANTS.join(', ')}). A skill can grant "rest" if practice has earned that, and only then: nothing is pre-made, and a person who has slept rough for long enough may simply be able to. For each queued weave, name it. What the world itself grows is not yours here: it has its own time. Write only about this person.

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

const GROWTH_SYSTEM = `${VOICE}

A world has regenerated, and people were in it. You are told what it holds and what happened there: which kinds wore people down, and which kept falling. Say what it grew into since, if anything: a few new creatures, materials, affixes, abilities and lines of lore, in the same shapes as a pack. What you write stands in this world from now on, beside what it was signed with, and people will meet it. Write under each list only what is new, and answer under "order". If nothing grew, leave every list empty: that is a fair answer.

You write no new tags: use the world's own words and the registry, and nothing else.

${GRAMMAR}`;

const str = { type: 'string' };
const themeProperty = (key: string) => (THEME_SCHEMA.properties as Record<string, unknown>)[key];

export const REST_SCHEMA: Record<string, unknown> = {
  type: 'object', additionalProperties: false, required: ['skills', 'weaves', 'gifts'],
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
    }
  }
};

export const GROWTH_SCHEMA: Record<string, unknown> = {
  type: 'object', additionalProperties: false,
  required: ['order', 'creatures', 'materials', 'affixes', 'abilities', 'lore'],
  properties: {
    order: str,
    creatures: themeProperty('creatures'), materials: themeProperty('materials'), affixes: themeProperty('affixes'),
    abilities: themeProperty('abilities'), lore: themeProperty('lore')
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

/** Thinking counts against this too, and it cannot be turned off on this model. A ceiling, never a bill. */
const LINE_TOKENS = 2000;
const LINE_TOKENS_FLOOR = 8000;
const GROWTH_TOKENS = 16000;

/**
 * A small batch of lines that changed (D69). It goes as a filed batch, the same road
 * as a rest. What comes back stands before `ThemeLaw.validateLine`.
 */
export function buildLineRequest(asks: ILineAsk[], theme: Pick<IWorldSummary, 'name' | 'premise' | 'abilities' | 'tags'>): IDoorRequest {
  const world = { name: theme.name, premise: theme.premise, words: theme.tags, abilities: theme.abilities.map(a => ({ key: a.key, name: a.name, blurb: a.blurb })) };
  return {
    kind: 'window', system: LINE_SYSTEM, schema: LINE_SCHEMA, maxTokens: Math.max(LINE_TOKENS_FLOOR, asks.length * LINE_TOKENS),
    messages: [{ role: 'user', content: `The world:\n${JSON.stringify(world)}\n\nThe kinds that changed:\n${JSON.stringify(asks)}` }]
  };
}

/** What a regeneration grew (D64). What comes back stands before the whole pack's law, read with it. */
export function buildGrowthRequest(asks: IGrowthAsk[], theme: IWorldSummary): IDoorRequest {
  return {
    kind: 'window', system: GROWTH_SYSTEM, schema: GROWTH_SCHEMA, maxTokens: GROWTH_TOKENS,
    messages: [{ role: 'user', content: `The world:\n${JSON.stringify(theme)}\n\nWhat happened there:\n${JSON.stringify(asks[0])}` }]
  };
}

/** Each kind of ask a window can carry. A further one (D93's plans) joins here, beside its kind in `ScanPass`. A goal's roll asks nothing: it is compute, on a sheet, under a player's rules. */
export const WINDOW_REQUESTS: Record<string, (asks: never[], theme: IWorldSummary) => IDoorRequest> = {
  line: buildLineRequest as never,
  growth: buildGrowthRequest as never
};

export function buildRestRequest(queue: unknown, theme: unknown): IDoorRequest {
  return {
    kind: 'rest', system: REST_SYSTEM, schema: REST_SCHEMA, maxTokens: 12000,
    messages: [{ role: 'user', content: `The world:\n${JSON.stringify(theme)}\n\nWhat was queued:\n${JSON.stringify(queue)}` }]
  };
}
