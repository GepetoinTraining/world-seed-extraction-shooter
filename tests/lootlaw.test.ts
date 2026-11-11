/**
 * Loot as data (Pedro, 2026-11-04: items and loot "should be deterministic and only updated by
 * LLM, checked"). The law refuses what cannot stand and puts wrong numbers right; a roll is the
 * same on every machine for the same table, rank and key.
 */
import { describe, expect, it } from 'vitest';
import { FIRST_THEME_PACK } from '../shared/logic/theme/boot';
import { LootLaw, lootIdOf, lootItemsOf, sealLoot, ILootWords, LOOT_SCHEMA } from '../shared/logic/theme/LootLaw';
import { LOOT_PARTS } from '../shared/logic/theme/ThemeFormula';
import { schemaProblem } from '../shared/logic/content/SchemaFit';

const pack = FIRST_THEME_PACK;
const words: ILootWords = {
  name: 'What a biological thing leaves',
  source: 'creature',
  fits: ['biological'],
  // 2026-11-10: a table says whose it is. This one is nobody's in particular: it fits by tags
  creature: '',
  lines: [
    { what: 'material', item: '', odds: 'often', count: 'few', rank: 'same' },
    { what: 'gear', item: '', odds: 'seldom', count: 'one', rank: 'same' },
    { what: 'junk', item: '', odds: 'sometimes', count: 'one', rank: 'below' }
  ]
};

describe('the loot law', () => {
  it('seals a model\'s words into a table whose numbers are the formula\'s and whose id is its words\'', () => {
    const t = sealLoot(pack.themeId, words);
    expect(t.id).toBe(lootIdOf(pack.themeId, words));
    expect(t.lines[0]).toMatchObject({ chance: 600_000, low: 1, high: 3 });
    const verdict = LootLaw.correct(t, pack);
    expect(verdict.ok).toBe(true);
    expect(verdict.changes).toEqual([]);
  });

  it('puts a wrong number right, and lists it as a change', () => {
    const t = sealLoot(pack.themeId, words);
    const greedy = { ...t, lines: t.lines.map((l, i) => (i === 1 ? { ...l, chance: LOOT_PARTS, high: 9 } : l)) };
    const verdict = LootLaw.correct(greedy, pack);
    expect(verdict.ok).toBe(true);
    expect(verdict.changes).toEqual([{ line: 1, field: 'chance', value: 50_000 }, { line: 1, field: 'high', value: 1 }]);
    expect(verdict.table!.lines[1]).toMatchObject({ chance: 50_000, high: 1 });
  });

  it('refuses words that were changed without a new id, a thing its theme does not hold, and a table that fits nobody', () => {
    const t = sealLoot(pack.themeId, words);
    expect(LootLaw.correct({ ...t, lines: t.lines.map((l, i) => (i === 0 ? { ...l, odds: 'always' } : l)) }, pack)).toMatchObject({ ok: false, reason: 'Its id does not match its words.' });
    expect(LootLaw.correct(sealLoot(pack.themeId, { ...words, lines: [{ what: 'gear', item: 'golden_ticket', odds: 'rarely', count: 'one', rank: 'same' }] }), pack).ok).toBe(false);
    expect(LootLaw.correct(sealLoot(pack.themeId, { ...words, fits: ['dragon'] }), pack)).toMatchObject({ ok: false });
    expect(LootLaw.correct(sealLoot(pack.themeId, { ...words, source: 'chest', fits: ['NOWHERE'] }), pack)).toMatchObject({ ok: false });
    expect(LootLaw.correct(sealLoot(pack.themeId, { ...words, lines: [] }), pack)).toMatchObject({ ok: false });
    expect(LootLaw.correct({ ...sealLoot(pack.themeId, words), lines: [{ ...words.lines[0], what: 'deed' }] }, pack)).toMatchObject({ ok: false });
  });

  it('rolls the same drop for the same table, rank and key, and draws the same numbers whatever drops', () => {
    const t = sealLoot(pack.themeId, words);
    const items = lootItemsOf(pack);
    const a = LootLaw.roll(t, 'E', 'session:kill:1', items);
    expect(LootLaw.roll(t, 'E', 'session:kill:1', items)).toEqual(a);
    // Over many keys every line drops sometimes and the counts stay in their bands
    const seen = new Set<number>();
    for (let k = 0; k < 400; k++) {
      for (const d of LootLaw.roll(t, 'E', `k${k}`, items)) {
        seen.add(d.line);
        const l = t.lines[d.line];
        expect(d.count).toBeGreaterThanOrEqual(l.low);
        expect(d.count).toBeLessThanOrEqual(l.high);
        expect(items[d.what].some(x => x.id === d.id && x.key === d.key)).toBe(true);
      }
    }
    expect([...seen].sort()).toEqual([0, 1, 2]);
    // A line that always drops, added after, moves nothing before it
    const more = sealLoot(pack.themeId, { ...words, lines: [...words.lines, { what: 'material', item: '', odds: 'always', count: 'one', rank: 'same' }] });
    for (let k = 0; k < 50; k++) {
      const before = LootLaw.roll(t, 'D', `m${k}`, items);
      const after = LootLaw.roll({ ...more, id: t.id }, 'D', `m${k}`, items).filter(d => d.line < 3);
      expect(after).toEqual(before);
    }
  });

  it('picks the table that fits a source most, and none for a source nothing fits', () => {
    const plain = sealLoot(pack.themeId, { ...words, fits: [] });
    const bio = sealLoot(pack.themeId, words);
    const chest = sealLoot(pack.themeId, { ...words, source: 'chest', fits: ['RUINS'] });
    expect(LootLaw.pick([plain, bio, chest], { kind: 'creature', tags: ['biological', 'grunt'] })?.id).toBe(bio.id);
    expect(LootLaw.pick([plain, bio, chest], { kind: 'creature', tags: ['mechanical'] })?.id).toBe(plain.id);
    expect(LootLaw.pick([bio, chest], { kind: 'chest', tags: ['WASTELAND'] })).toBeUndefined();
    expect(LootLaw.pick([bio, chest], { kind: 'chest', tags: ['RUINS'] })?.id).toBe(chest.id);
  });

  it('the shape a model answers in fits its own schema', () => {
    expect(schemaProblem(LOOT_SCHEMA, { tables: [words] })).toBeNull();
    expect(schemaProblem(LOOT_SCHEMA, { tables: [{ ...words, lines: [{ ...words.lines[0], odds: 'often-ish' }] }] })).toMatch(/odds/);
    expect(schemaProblem(LOOT_SCHEMA, { tables: [{ ...words, extra: 1 }] })).toMatch(/extra/);
  });
});

describe('a held table drives the drop', () => {
  it('a creature whose theme holds a fitting table drops what the table rolls, minted from its own keys', async () => {
    const { installShippedThemes } = await import('../shared/logic/theme/boot');
    const { LootBook } = await import('../src/logic/theme/LootBook');
    const { LootTable } = await import('../src/entities/world/LootTable');
    const { compileTheme } = await import('../shared/logic/theme/ThemeCompiler');
    installShippedThemes();
    LootBook.clear();
    const table = sealLoot(pack.themeId, { name: 'Humanoid pockets', source: 'creature', fits: ['humanoid'], lines: [{ what: 'material', item: '', odds: 'always', count: 'few', rank: 'same' }] });
    expect(LootBook.admit(table).ok).toBe(true);
    const mobs = compileTheme(pack).mobs;
    const teller = Object.values(mobs).find(m => m.tags.includes('humanoid'))!;
    const roll = LootTable.creatureRoll(teller, 'k:teller:1')!;
    expect(roll).toMatchObject({ table: table.id, rank: teller.rank });
    const items = LootTable.generateLoot(teller, 1, undefined, 'k:teller:1');
    const fromTable = items.filter(i => roll.lines.some(l => l.id === i.universalDefinitionId));
    expect(fromTable.length).toBe(roll.lines.reduce((n, l) => n + l.count, 0));
    expect(LootTable.generateLoot(teller, 1, undefined, 'k:teller:1').map(i => i.id)).toEqual(items.map(i => i.id));
    // A creature no table fits drops as the old code did
    const rat = Object.values(mobs).find(m => !m.tags.includes('humanoid'))!;
    expect(LootTable.creatureRoll(rat, 'k:rat:1')).toBeNull();
    LootBook.clear();
  });
});
