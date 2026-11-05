/**
 * DOES AN ANSWER FIT ITS SHAPE? The schemas a model is asked to answer in (a world's passes, loot,
 * a theme) are a small part of JSON Schema: object, array, string, boolean, number, integer, enum,
 * required, additionalProperties. A keyed model is held to them by its provider; a local one, or a
 * client handing an answer in to the pool, is not. This is the check for those, and the hub's.
 *
 * Pure. The first problem found, in words, or null.
 */

type Schema = {
  type?: string;
  enum?: unknown[];
  properties?: Record<string, Schema>;
  required?: string[];
  additionalProperties?: boolean;
  items?: Schema;
};

export function schemaProblem(schema: unknown, value: unknown, at = 'the answer'): string | null {
  const s = (schema ?? {}) as Schema;
  if (s.enum && !s.enum.includes(value)) return `${at} is ${JSON.stringify(value)}, not one of ${s.enum.join(', ')}.`;
  switch (s.type) {
    case 'object': {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return `${at} is not an object.`;
      const v = value as Record<string, unknown>;
      for (const key of s.required ?? []) if (!(key in v)) return `${at} has no ${key}.`;
      for (const [key, inner] of Object.entries(v)) {
        const own = s.properties?.[key];
        if (!own) {
          if (s.additionalProperties === false) return `${at} carries ${key}, which its shape does not have.`;
          continue;
        }
        const problem = schemaProblem(own, inner, `${at}.${key}`);
        if (problem) return problem;
      }
      return null;
    }
    case 'array': {
      if (!Array.isArray(value)) return `${at} is not a list.`;
      for (let i = 0; i < value.length; i++) {
        const problem = schemaProblem(s.items, value[i], `${at}[${i}]`);
        if (problem) return problem;
      }
      return null;
    }
    case 'string': return typeof value === 'string' ? null : `${at} is not text.`;
    case 'boolean': return typeof value === 'boolean' ? null : `${at} is not true or false.`;
    case 'number': return typeof value === 'number' && Number.isFinite(value) ? null : `${at} is not a number.`;
    case 'integer': return Number.isInteger(value) ? null : `${at} is not a whole number.`;
    default: return null;
  }
}
