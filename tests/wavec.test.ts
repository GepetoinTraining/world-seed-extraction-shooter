/**
 * WAVE C, FIRST PASS, AT THE JOIN. What six streams could not see from their own branches: the
 * places their work meets. Each of these was a fault or a gap on the join branch before its fix.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { UniversalRank } from '../shared/types';
import { WEB_BATCHES } from '../shared/entities/generation/packs/webBatches';
import { FIRST_THEME } from '../shared/entities/generation/packs/firstTheme';
import { keeperBrought, moreThanTheyNeed, walletBrought } from '../src/entities/hub/money';
import { residentUpkeepPerDay } from '../src/entities/hub/guild';
import { Koseki } from '../shared/entities/world/Koseki';
import { Population, emptyPopulationRecord } from '../shared/entities/world/Population';
import { computeGolden, FIRST_THEME_VECTORS } from '../src/entities/world/goldens';
import { ContentRegistry } from '../shared/logic/theme/ContentRegistry';
import { sealTheme, themeIdOf } from '../shared/logic/theme/ThemeCompiler';
import { IThemeBody, THEME_SCHEMA } from '../shared/logic/theme/ThemeTypes';
import { Profession } from '../src/logic/systems/Profession';

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const source = (path: string) => readFileSync(path, 'utf8');

describe('C1 and C4: one record, two things taken from it', () => {
  it('a body taken alive and goods carried out of a store are kept apart', () => {
    const person = Koseki.found('home', 'me', 'ox', 3);
    let record = Population.robbed(emptyPopulationRecord(), 'lead_5_8_1_store', 2, 3);
    const { record: after } = Population.captured(record, 'pop_5_8_0', 'ox', 3, person);
    record = Population.robbed(after, 'lead_5_8_1_store', 1, 3);
    expect(Object.keys(record.carried!)).toEqual(['lead_5_8_1_store']);
    expect(record.carried!.lead_5_8_1_store.n).toBe(3);
    expect(Object.keys(record.taken!)).toHaveLength(1);
    expect(Object.values(record.taken!)[0]).toHaveProperty('id');
  });
});

describe('C1 and C2: a right click on a body', () => {
  it('offers the snare as well as the bargain', () => {
    const canvas = source('src/components/WorldCanvas.tsx');
    expect(canvas).toMatch(/o\.id\.startsWith\('int_bargain_'\) \|\| o\.id\.startsWith\('int_snare_'\)/);
  });
});

describe('C1 and C2: two batches cut the same day', () => {
  it('every run has its own id, and the land came before the mind', () => {
    const ids = WEB_BATCHES.map(b => b.runId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.indexOf('run_010_a_mind_of_its_own')).toBe(ids.indexOf('run_009_the_land') + 1);
  });
});

describe('C2 and C3: the ladder reads a person\'s own coin', () => {
  const living = residentUpkeepPerDay(UniversalRank.D);
  it('a survivor arrives past the money rung, a keeper does not, and the line itself did not move', () => {
    for (let i = 0; i < 200; i++) {
      expect(moreThanTheyNeed(walletBrought(`p${i}`, UniversalRank.D), UniversalRank.D)).toBe(true);
      expect(moreThanTheyNeed(keeperBrought(`p${i}`, UniversalRank.D), UniversalRank.D)).toBe(false);
    }
    expect(moreThanTheyNeed(living * 57, UniversalRank.D)).toBe(true);
    expect(moreThanTheyNeed(living * 56, UniversalRank.D)).toBe(false);
  });
  it('a person in the city is asked about by what is in their wallet', () => {
    const talk = source('src/entities/interaction/talkStore.ts');
    expect(talk).toMatch(/money: moreThanTheyNeed\(hub\.wallets\[residentIdOf\(resident\.bond\)\]/);
    expect(talk).toMatch(/money: moreThanTheyNeed\(hub\.wallets\[npcId\]/);
  });
});

describe('C3 and C5: one theme, its anchors and its people', () => {
  it('the first theme stands with both, a written theme is asked for both, and its people are dealt', () => {
    expect(FIRST_THEME.anchors!.length).toBeGreaterThan(0);
    expect(FIRST_THEME.professions!.length).toBe(5);
    const props = (THEME_SCHEMA as { properties: Record<string, unknown>; required: string[] });
    expect(props.required).toEqual(expect.arrayContaining(['anchors', 'professions']));
    const dealt = Profession.dealt(FIRST_THEME.professions!, 'golden-alpha', 'ent_1', 'D');
    expect(FIRST_THEME.professions!.map(p => p.key)).toContain(dealt!.key);
  });

  it('only the people moved the vectors: without them a world folds to what C3 wrote', () => {
    const body = clone(FIRST_THEME) as IThemeBody;
    delete body.professions;
    expect(themeIdOf(body)).toBe('theme_5894219ce03c002b');
    const pack = { ...sealTheme(body, 'claude-opus-5-5 (dev batch, D53)', 1793491200000), formula: 4 };
    expect(ContentRegistry.install(pack)).toEqual({ ok: true });
    const ctx = ContentRegistry.contextFor(pack.themeId);
    expect(computeGolden('golden-alpha', 16, ctx)).toBe(3383833323);
    expect(computeGolden('golden-beta', 32, ctx)).toBe(2720242315);
    expect(computeGolden('dev-sandbox-v4', 32, ctx)).toBe(2133354407);
    expect(FIRST_THEME_VECTORS.map(v => v.hash)).not.toContain(3383833323);
  });
});

describe('C3 and C5: what the hub runs on', () => {
  it('what a person knows silently does not raise what the city costs', () => {
    expect(source('src/entities/hub/money.ts')).not.toMatch(/\.silent\b/);
    expect(source('src/logic/economy/MarketCap.ts')).not.toMatch(/\.silent\b/);
  });
});
