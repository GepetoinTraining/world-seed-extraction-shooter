/**
 * A DRY RUN OF A KEY (Pedro, 2026-11-10: "skeleton of the start of each key type expected, dry run and
 * test, accept"). The pasted text is read where it was pasted and nothing is sent anywhere: this file
 * has no way to send. It says what a person would want to know before spending a real ask on it: that
 * it is empty, wrapped in quotes, broken by a space, too short, or another provider's key.
 *
 * How a provider's keys start is a fact about that provider, so it is a field of its row in the options
 * file (`keyStart`, `keyShape`), never a list here. A start is a hint: a provider may change how its keys
 * look, so a key that fails this can still be tested, and the provider's answer is the one that counts.
 */
import type { IKeyedOption } from './options';

export interface IKeyLook {
  /** True when nothing about the text looks wrong for this provider. */
  ok: boolean;
  /** What was found, in order. The key itself is never repeated in it. */
  says: string[];
}

/** No provider's key is shorter than this; most are several times longer. */
const SHORTEST_KEY = 16;

const NOTHING_SENT = 'Nothing was sent: this only read what was pasted.';

/** What a key from this provider looks like at its start, for a person to compare with what they hold. */
export function keySkeleton(option: IKeyedOption): string {
  if (option.keyShape?.trim()) return option.keyShape.trim();
  return option.keyStart?.trim() ? `${option.keyStart.trim()}…` : 'no fixed start';
}

export function dryRun(option: IKeyedOption, offered: IKeyedOption[], pasted: string): IKeyLook {
  const says: string[] = [];
  const done = (ok: boolean): IKeyLook => ({ ok, says: [...says, NOTHING_SENT] });

  let text = pasted;
  if (!text.trim()) {
    says.push('Nothing was pasted.');
    return done(false);
  }
  // A paste often brings a line break with it, and every door drops it
  text = text.trim();

  let ok = true;
  const quoted = /^(["'`])([\s\S]*)\1$/.exec(text);
  if (quoted) {
    says.push('It is wrapped in quotes. Paste the key alone.');
    text = quoted[2].trim();
    ok = false;
  }
  const worded = /^bearer\s+/i.exec(text);
  if (worded) {
    says.push('It starts with the word Bearer. Paste the key alone.');
    text = text.slice(worded[0].length);
    ok = false;
  }
  if (/\s/.test(text)) {
    says.push('It has a space or a line break inside it, which no key has.');
    ok = false;
  }
  if (text.length < SHORTEST_KEY) {
    says.push(`It is ${text.length} characters long, too short to be a key.`);
    ok = false;
  }

  // Whose key it starts like: the longest start that fits, so a longer one is never taken for a shorter
  const fits = offered
    .filter(o => o.keyStart && text.startsWith(o.keyStart))
    .sort((a, b) => b.keyStart!.length - a.keyStart!.length)[0];
  if (fits && fits.id !== option.id) {
    says.push(`It starts like a key from ${fits.name} (${keySkeleton(fits)}), not one from ${option.name}.`);
    ok = false;
  } else if (!fits && option.keyStart) {
    says.push(`It does not start the way keys from ${option.name} do (${keySkeleton(option)}). A test will tell.`);
    ok = false;
  }

  if (ok) says.push(`It looks like a key from ${option.name}.`);
  return done(ok);
}
