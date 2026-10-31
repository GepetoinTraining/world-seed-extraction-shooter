/**
 * THE TAG LAW (D28): the pure half, spelling and identity only.
 *
 * Pedro accepted tags instead of prime signatures on one condition: "make the
 * tagging rule iron clad so we don't use a uuid throwaway and think that's good
 * enough... the idea is to not have ambiguity". Primes cannot drift and tags can,
 * so this file carries what primes gave for free. A skill's id is computed only
 * from its normalized, sorted, deduplicated identity tags: same set, same id, on
 * every machine, in any order of arrival.
 *
 * The id reads `skill_` + the tags joined by `+`. A tag can never hold a `+`, so
 * the id reads back to exactly its tags. What the older tracks were always
 * called is what this computes: {carpentry} is skill_carpentry.
 *
 * Nothing here reads the clock, a random value, a counter or a display name.
 */

const SPELLING = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;
const ID_PREFIX = 'skill_';
const ID_JOIN = '+';

export class TagLaw {

  /** The one spelling: lower case, words joined by a single underscore. */
  static normalize(raw: string): string {
    return raw.trim().toLowerCase().replace(/[\s-]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
  }

  /** Is this already the normal form? A batch must write it so. */
  static isCanonicalSpelling(tag: string): boolean {
    return SPELLING.test(tag);
  }

  /** Every form a word could be the plural of, the word itself included. */
  private static singulars(word: string): string[] {
    const out = [word];
    if (word.endsWith('ies')) out.push(`${word.slice(0, -3)}y`);
    if (word.endsWith('es')) out.push(word.slice(0, -2), word.slice(0, -1));
    if (word.endsWith('s') && !word.endsWith('ss')) out.push(word.slice(0, -1));
    return out;
  }

  /**
   * The keys a spelling collapses to, across case, plural and separator, and the
   * order of its words. Two tags that share a key are one tag spelled twice.
   */
  static variantKeys(tag: string): string[] {
    const parts = tag.toLowerCase().trim().split(/[\s_-]+/).filter(Boolean);
    const joined = parts.join('');
    const sorted = [...parts].sort().join('');
    return [...new Set([...this.singulars(joined), ...this.singulars(sorted)])];
  }

  static areVariants(a: string, b: string): boolean {
    const keys = new Set(this.variantKeys(a));
    return this.variantKeys(b).some(key => keys.has(key));
  }

  /** Clause 3: normalized, sorted, deduplicated. */
  static canonical(tags: string[]): string[] {
    return [...new Set(tags.map(t => this.normalize(t)))].filter(Boolean).sort();
  }

  /** Clause 3: the id, computed from the set and nothing else. An empty set has no identity. */
  static skillIdOf(tags: string[]): string {
    const set = this.canonical(tags);
    if (set.length === 0) throw new Error('An empty set of tags has no identity.');
    return `${ID_PREFIX}${set.join(ID_JOIN)}`;
  }

  /** The tags an id was computed from, or null when it was not computed by this law. */
  static parseSkillId(id: string): string[] | null {
    if (!id.startsWith(ID_PREFIX)) return null;
    const tags = id.slice(ID_PREFIX.length).split(ID_JOIN);
    if (tags.length === 0 || !tags.every(t => this.isCanonicalSpelling(t))) return null;
    const canon = [...new Set(tags)].sort();
    return canon.length === tags.length && canon.every((t, i) => t === tags[i]) ? canon : null;
  }
}
