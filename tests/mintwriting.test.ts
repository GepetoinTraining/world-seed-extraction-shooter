/**
 * The mint's door into writing a world: what it hands the writer. The writer is stood in for,
 * so nothing is asked and nothing is spent.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { ContentRegistry } from '../shared/logic/theme/ContentRegistry';
import { FIRST_THEME_PACK } from '../shared/logic/theme/boot';
import { WebBank } from '../shared/logic/content/WebBank';
import type { IWriteOptions } from '../src/logic/theme/writing/WorldWriter';

const seen = vi.hoisted(() => ({ options: [] as unknown[] }));
vi.mock('../src/logic/theme/writing/WorldWriter', () => ({
  writeWorld: async (_said: string, o: unknown) => { seen.options.push(o); return { ok: false, reason: 'stood in for', usage: { model: '', inputTokens: 0, outputTokens: 0, usd: 0 }, passes: [] }; }
}));

import { writeForMint } from '../src/logic/theme/writing/mintWriting';

beforeAll(() => {
  expect(ContentRegistry.install(FIRST_THEME_PACK).ok).toBe(true);
});

describe('the mint hands the writer the person\'s words', () => {
  it('the typed name goes to the writer as the world\'s name; an empty field goes as empty, for one to be drawn', async () => {
    await writeForMint('THE STILL ORCHARD', { worldName: 'THE STILL ORCHARD', worldDescription: 'An orchard where nothing flows.', difficulty: 'D', size: 1 });
    await writeForMint('An orchard', { worldName: '', worldDescription: 'An orchard where nothing flows.', difficulty: 'D', size: 1 });
    const [named, empty] = seen.options as IWriteOptions[];
    expect(named.name).toBe('THE STILL ORCHARD');
    expect(empty.name).toBe('');
  });

  it('what each registered word means goes with it, so an exclusion is read by meaning (C18)', () => {
    const o = seen.options[0] as IWriteOptions;
    const axe = WebBank.current().tags.find(t => t.tag === 'axe')!;
    expect(o.meaningOf!('axe')).toBe(axe.meaning);
    expect(o.meaningOf!('no_such_word_anywhere')).toBeUndefined();
  });
});
