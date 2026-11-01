/**
 * What the door says to a model. The system text is frozen, so a provider can cache
 * it: the bank's voice, the grammar and the registry first, volatile data after.
 *
 * Nothing here is trusted on the way back. Whatever returns stands before the law.
 */
import type { IDoorMessage, IDoorRequest } from './door';
import { THEME_SCHEMA, BIOMES, EFFECTS, DELIVERIES, GEAR_KINDS, SKILL_GRANTS, TRIGGERS } from '../../src/logic/theme/ThemeTypes';
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
- Goods are made from materials or other goods in this pack, never from themselves. A station key, or empty for any workshop bench. Goods tagged paper and ink let people draft plans, so give the world some.
- Affix stats come only from: ${Object.keys(STAT_SCALE).join(', ')}. Mind stats (focus, intelligence, perception, charisma and the like) only with allowedTags exactly ["frame"]. An affix's allowedTags are gear tags, or "resource", "mob", "cart". A downside is honest: give good things a cost.
- Ability effects: ${EFFECTS.join(', ')}. Deliveries: ${DELIVERIES.join(', ')}. A creature's innate abilities are keys in this pack. Trigger words for gear: ${TRIGGERS.join(', ')}.
- Gear kinds: ${GEAR_KINDS.join(', ')}.

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

For each queued skill, give it a name and a line of flavor, and say what it lets the holder do; grants come from this list and may be empty (${SKILL_GRANTS.join(', ')}). A skill can grant "rest" if practice has earned that, and only then: nothing is pre-made, and a person who has slept rough for long enough may simply be able to. For each queued weave, name it. In "growth" you may add a few new creatures, materials, affixes, abilities and lines of lore that the world would have grown into, in the same shapes as a pack; they will only reach worlds signed later, and a world already signed never changes. Leave growth empty if nothing grew.

${GRAMMAR}`;

const str = { type: 'string' };
const themeProperty = (key: string) => (THEME_SCHEMA.properties as Record<string, unknown>)[key];

export const REST_SCHEMA: Record<string, unknown> = {
  type: 'object', additionalProperties: false, required: ['skills', 'weaves', 'growth'],
  properties: {
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

export function buildRestRequest(queue: unknown, theme: unknown): IDoorRequest {
  return {
    kind: 'rest', system: REST_SYSTEM, schema: REST_SCHEMA, maxTokens: 12000,
    messages: [{ role: 'user', content: `The world:\n${JSON.stringify(theme)}\n\nWhat was queued:\n${JSON.stringify(queue)}` }]
  };
}
