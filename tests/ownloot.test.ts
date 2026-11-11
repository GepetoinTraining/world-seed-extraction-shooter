/**
 * A CREATURE'S OWN LOOT (Pedro, of his own run, 2026-11-10: "getting too much money feels bad and
 * not getting any feels bad as well (the drops from the mobs are too consistent, and terrible, loot
 * table the mobs themselves, make the spread be better)").
 *
 * Before: a theme held a few tables matched by tags, so everything of a type dropped alike, and
 * with no table the old code gave a rat a piece of gear six kills in ten and a hound one junk.
 * Now a table can be one creature's own, it must hold a spread, a kind grown from a creature drops
 * as it does, the writer is asked for one table to a creature, and the shipped world ships its own.
 *
 * Registered before the build. No test calls a model.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

vi.mock('../shared/entities/data/VectorStore', () => ({
  VectorNamespace: { CHARACTERS: 'characters', ITEMS: 'items', WORLDS: 'worlds', TRANSACTIONS: 'transactions', CONTENT: 'content', TERRITORIES: 'territories' },
  VectorStore: { get: async () => null, put: async () => true, query: async () => [], saveContent: async () => true, searchContent: async () => [] }
}));

import { FIRST_THEME_PACK, installShippedThemes } from '../shared/logic/theme/boot';
import { LootLaw, lootAskOf, lootItemsOf, sealLoot, ILootWords, LOOT_SCHEMA } from '../shared/logic/theme/LootLaw';
import { LOOT_FORMULA_VERSION, LOOT_OWN_SPREAD } from '../shared/logic/theme/ThemeFormula';
import { creatureIdOf } from '../shared/logic/theme/ThemeCompiler';
import { MOB_DEFINITIONS } from '../shared/entities/mob/data/mobDefinitions';
import { FIRST_THEME_LOOT } from '../shared/entities/generation/packs/firstThemeLoot';
import { schemaProblem } from '../shared/logic/content/SchemaFit';
import { buildLootRequest } from '../shared/intelligence/prompts';
import { LootBook } from '../src/logic/theme/LootBook';
import { LootWriter } from '../src/logic/theme/LootWriter';
import { LootTable } from '../src/entities/world/LootTable';

installShippedThemes();

const SRC = (p: string) => readFileSync(p, 'utf8');
const pack = FIRST_THEME_PACK;
const mob = (key: string) => MOB_DEFINITIONS[creatureIdOf(pack.themeId, key)] as any;

/** One creature's own table, with a spread. */
const own = (creature: string, over: Partial<ILootWords> = {}): ILootWords => ({
  name: `What a ${creature} leaves`, source: 'creature', fits: [], creature,
  lines: [
    { what: 'junk', item: '', odds: 'often', count: 'one', rank: 'same' },
    { what: 'material', item: '', odds: 'sometimes', count: 'few', rank: 'same' },
    { what: 'gear', item: '', odds: 'rarely', count: 'one', rank: 'same' }
  ],
  ...over
});
const shared: ILootWords = {
  name: 'What a biological thing leaves', source: 'creature', fits: ['biological'], creature: '',
  lines: [{ what: 'junk', item: '', odds: 'always', count: 'one', rank: 'same' }]
};
const judged = (words: ILootWords) => LootLaw.correct(sealLoot(pack.themeId, words), pack);

beforeEach(() => {
  LootBook.clear();
  LootWriter.forget();
});

describe('a table can be one creature\'s own', () => {
  it('it names the creature by its key, and the law holds it to a creature its theme has', () => {
    expect(judged(own('tally_rat')).ok).toBe(true);
    expect(judged(own('dragon'))).toMatchObject({ ok: false });
    expect(judged(own('dragon')).reason).toMatch(/dragon/);
  });

  it('only a creature has one: a chest\'s table names none', () => {
    expect(judged({ ...own('tally_rat'), source: 'chest', fits: ['RUINS'] })).toMatchObject({ ok: false });
  });

  it('a table shared by tags still stands, for whatever has none of its own', () => {
    expect(judged(shared).ok).toBe(true);
  });

  it('its words are its id: the same lines for another creature are another table', () => {
    expect(sealLoot(pack.themeId, own('tally_rat')).id).not.toBe(sealLoot(pack.themeId, own('lien_moth', { name: 'What a tally_rat leaves' })).id);
  });

  it('the shape a model answers in fits its own schema, and the schema asks whose table it is', () => {
    expect(schemaProblem(LOOT_SCHEMA, { tables: [own('tally_rat'), shared] })).toBeNull();
    const { creature: _left, ...unsaid } = own('tally_rat');
    expect(schemaProblem(LOOT_SCHEMA, { tables: [unsaid] })).not.toBeNull();
  });
});

describe('a creature\'s own table holds a spread', () => {
  const lines = (...odds: ILootWords['lines'][number]['odds'][]) => odds.map(o => ({ what: 'junk' as const, item: '', odds: o, count: 'one' as const, rank: 'same' as const }));

  it(`fewer than ${3} different odds is refused, and the reason says what a spread is`, () => {
    expect(LOOT_OWN_SPREAD).toBe(3);
    const flat = judged(own('tally_rat', { lines: lines('often', 'often', 'often') }));
    expect(flat.ok).toBe(false);
    expect(flat.reason).toMatch(/different odds/);
    expect(judged(own('tally_rat', { lines: lines('often', 'seldom') })).ok).toBe(false);
    expect(judged(own('tally_rat', { lines: lines('always') })).ok).toBe(false);
  });

  it('three different odds stand, however many lines carry them', () => {
    expect(judged(own('tally_rat', { lines: lines('often', 'sometimes', 'rarely') })).ok).toBe(true);
    expect(judged(own('tally_rat', { lines: lines('always', 'often', 'often', 'seldom', 'seldom') })).ok).toBe(true);
  });

  it('a shared table is not held to it: it is only what stands in until a creature has its own', () => {
    expect(judged(shared).ok).toBe(true);
  });
});

describe('a creature rolls on its own table before any shared one', () => {
  const mine = sealLoot(pack.themeId, own('tally_rat'));
  const everyones = sealLoot(pack.themeId, shared);
  const source = (key: string, tags: string[], more: string[] = []) => ({ kind: 'creature' as const, tags, keys: [key, ...more] });

  it('its own beats one that fits its tags, whichever was written first', () => {
    expect(LootLaw.pick([everyones, mine], source('tally_rat', ['biological', 'grunt']))!.id).toBe(mine.id);
    expect(LootLaw.pick([mine, everyones], source('tally_rat', ['biological', 'grunt']))!.id).toBe(mine.id);
  });

  it('another creature never rolls on it', () => {
    expect(LootLaw.pick([mine], source('dividend_hen', ['biological', 'livestock']))).toBeUndefined();
    expect(LootLaw.pick([mine, everyones], source('dividend_hen', ['biological', 'livestock']))!.id).toBe(everyones.id);
  });

  it('a kind grown from it, with no table of its own, drops as what it grew from', () => {
    expect(LootLaw.pick([mine, everyones], source('line_child', ['biological', 'grunt'], ['tally_rat']))!.id).toBe(mine.id);
  });

  it('and one with a table of its own keeps to its own', () => {
    const comptroller = sealLoot(pack.themeId, own('rat_comptroller'));
    expect(LootLaw.pick([mine, comptroller], source('rat_comptroller', ['biological', 'elite'], ['tally_rat']))!.id).toBe(comptroller.id);
  });

  it('a kill asks by what the body is: its own kind first, then the kind it leads or grew from', () => {
    LootBook.admit(mine);
    LootBook.admit(everyones);
    expect(LootTable.creatureRoll(mob('tally_rat'), 'k1')!.table).toBe(mine.id);
    expect(LootTable.creatureRoll(mob('dividend_hen'), 'k1')!.table).toBe(everyones.id);
    // The comptroller leads tally rats and is drawn as one: with no table of its own it drops as they do
    expect(mob('rat_comptroller').line.root).toBe(mob('tally_rat').id);
    expect(LootTable.creatureRoll(mob('rat_comptroller'), 'k1')!.table).toBe(mine.id);
  });
});

describe('tables written before this are written again', () => {
  it('the law reads under a new formula, so an earlier table is refused at the door', () => {
    expect(LOOT_FORMULA_VERSION).toBe(2);
    const old = { ...sealLoot(pack.themeId, shared), formula: 1 };
    expect(LootLaw.correct(old, pack)).toMatchObject({ ok: false });
  });
});

describe('the writer is asked for one table to a creature', () => {
  const ok = (tables: ILootWords[]) => ({ status: 'OK', data: { tables } });

  it('the ask says so, and has room for a whole world of them', () => {
    const request = buildLootRequest(lootAskOf(pack));
    expect(request.system).toMatch(/one table for each creature/i);
    expect(request.system).toMatch(/different odds/i);
    expect(request.maxTokens).toBeGreaterThanOrEqual(8000);
  });

  it('creatures left without one are named in a second ask, and what stood is kept', async () => {
    const asks: any[] = [];
    const every = pack.creatures.map(c => own(c.key));
    const door = async (ask: any) => {
      asks.push(ask);
      return ok(asks.length === 1 ? every.slice(0, 5) : every.slice(5));
    };
    const out = await LootWriter.write(pack.themeId, door);
    expect(out.ok).toBe(true);
    expect(asks).toHaveLength(2);
    expect(asks[1].refused).toMatch(new RegExp(pack.creatures[5].key));
    expect(asks[1].refused).not.toMatch(new RegExp(`\\b${pack.creatures[0].key}\\b`));
    expect(out.banked).toBe(pack.creatures.length);
    for (const c of pack.creatures) expect(LootBook.tableFor(pack.themeId, 'creature', c.tags, [c.key])?.creature, c.key).toBe(c.key);
  });

  it('a whole answer is not asked again', async () => {
    let asked = 0;
    const out = await LootWriter.write(pack.themeId, async () => { asked++; return ok(pack.creatures.map(c => own(c.key))); });
    expect(out.ok).toBe(true);
    expect(asked).toBe(1);
  });

  it('a second answer that still leaves some out stands as far as it goes, and says who is left', async () => {
    const some = pack.creatures.slice(0, 3).map(c => own(c.key));
    const out = await LootWriter.write(pack.themeId, async () => ok(some));
    expect(out.ok).toBe(true);
    expect(out.banked).toBe(3);
    expect(out.reason).toMatch(new RegExp(pack.creatures[3].key));
  });
});

describe('the shipped world ships a table for every creature in it', () => {
  const tables = () => FIRST_THEME_LOOT.map(w => sealLoot(pack.themeId, w));

  it('one to a creature, none left out and none twice', () => {
    expect(FIRST_THEME_LOOT.map(w => w.creature).sort()).toEqual(pack.creatures.map(c => c.key).sort());
  });

  it('the law takes every one as it stands', () => {
    for (const t of tables()) {
      const verdict = LootLaw.correct(t, pack);
      expect(verdict.ok, `${t.name}: ${verdict.reason}`).toBe(true);
      expect(verdict.changes, t.name).toEqual([]);
    }
  });

  it('the game holds them from its start, before anything banked is read', () => {
    expect(LootBook.admitShipped()).toBe(pack.creatures.length);
    for (const c of pack.creatures) expect(LootBook.tableFor(pack.themeId, 'creature', c.tags, [c.key])?.creature, c.key).toBe(c.key);
    const boot = SRC('src/logic/initialization/StartupSequence.ts');
    expect(boot.indexOf('LootBook.admitShipped()')).toBeGreaterThan(0);
    expect(boot.indexOf('LootBook.admitShipped()')).toBeLessThan(boot.indexOf('LootBook.loadBanked()'));
  });

  it('so entering its world asks no model for them', () => {
    LootBook.admitShipped();
    let asked = 0;
    expect(LootWriter.ensure(pack.themeId, async () => { asked++; return { status: 'OK', data: { tables: [] } }; })).toBeUndefined();
    expect(asked).toBe(0);
  });

  it('what is not a leader and not a god gives gear seldom at most, and never always', () => {
    for (const w of FIRST_THEME_LOOT) {
      const c = pack.creatures.find(x => x.key === w.creature)!;
      if (c.tags.includes('elite') || c.tags.includes('god')) continue;
      for (const l of w.lines.filter(x => x.what === 'gear')) expect(['seldom', 'rarely'], `${w.creature}: gear ${l.odds}`).toContain(l.odds);
    }
  });

  it('a thousand of the commonest creature fall many ways: nothing, little, and now and then something kept', () => {
    LootBook.admitShipped();
    const rat = mob('tally_rat');
    const items = lootItemsOf(pack);
    const table = LootBook.tableFor(pack.themeId, 'creature', rat.tags, ['tally_rat'])!;
    const KILLS = 1000;
    const outcomes = new Map<string, number>();
    let gear = 0;
    for (let k = 0; k < KILLS; k++) {
      const drops = LootLaw.roll(table, rat.rank, `spread:${k}`, items);
      const said = drops.map(d => `${d.key}×${d.count}`).sort().join(' + ') || 'nothing';
      outcomes.set(said, (outcomes.get(said) ?? 0) + 1);
      if (drops.some(d => d.what === 'gear')) gear++;
    }
    const commonest = Math.max(...outcomes.values());
    console.log(`TALLY RAT, ${KILLS} kills: ${outcomes.size} different drops; commonest ${commonest}; nothing ${outcomes.get('nothing') ?? 0}; gear ${gear}`);
    // No one outcome is most of them, a kill that gives nothing is neither the rule nor unheard of, and gear is a rare day
    expect(outcomes.size).toBeGreaterThanOrEqual(8);
    expect(commonest).toBeLessThan(KILLS * 0.5);
    expect(outcomes.get('nothing') ?? 0).toBeGreaterThan(KILLS * 0.1);
    expect(outcomes.get('nothing') ?? 0).toBeLessThan(KILLS * 0.5);
    expect(gear).toBeLessThan(KILLS * 0.1);
  });

  it('under the old code that same creature gave a piece of gear more than half the time', () => {
    const rat = mob('tally_rat');
    let gear = 0;
    for (let k = 0; k < 400; k++) if (LootTable.generateLoot(rat, 1, undefined, `old:${k}`).some(i => !i.universalDefinitionId.startsWith('jnk_') && !i.universalDefinitionId.startsWith('res_'))) gear++;
    expect(gear).toBeGreaterThan(200);
  });
});
