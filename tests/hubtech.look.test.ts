/**
 * THE MATERIALS LEDGER AND THE LOOK (D119). Pedro, 2026-11-01: "Materials is a ledger of new
 * things to be generated, the sprite needs to be auto generated from a color, shape and size
 * tag from what this haiku would generate."
 *
 * Registered before the build. Meaning goes by shape, never hue alone: Pedro is colourblind.
 */
import { describe, expect, it } from 'vitest';
import { STEPS, buildPalette, grayscale, worldForm, worldSize, LOOK_INKS, LOOK_HUES, LOOK_ATOMS } from '../src/render/atoms/atoms';
import { HUB_GENRE } from '../src/render/atoms/hub';
import { LOOK_COLORS, LOOK_SHAPES, LOOK_SIZES } from '../src/logic/theme/ThemeTypes';
import { ChainWeb, IChainGround, IChainRound, emptyChain, lookOfOld } from '../src/logic/theme/ChainWeb';
import { addToLedger, materialsToGenerate } from '../src/entities/hub/hubTech';
import { emptyTech } from '../src/entities/hub/hubTech';
import { CHAIN_SCHEMA, buildChainRequest } from '../server/intelligence/prompts';

const LOOK = { color: 'ochre', shape: 'shard', size: 'medium' } as const;
const material = (key: string, look: unknown = LOOK): IChainRound['materials'][number] => ({
  key, name: key, blurb: 'x', tags: ['ore'], rank: 'F', form: 'vein', verb: 'mine', weight: 'light', worth: 'common', habitat: ['RUINS'], onShelf: false, restores: 'none', look
} as any);
const round = (over: Partial<IChainRound>): IChainRound => ({ tags: [], materials: [], stations: [], goods: [], gear: [], ...over });
const TRIBE: IChainGround = { things: [{ key: 'flint', name: 'Flint', tags: ['stone'], rank: 'F' }], stations: [{ key: 'fire_pit', name: 'Fire Pit', tool: ['tongs'], material: ['fire'] }], tools: ['tongs'] };
const def = (id: string, look: unknown) => ({ id, tags: ['ore'], look, materialProps: { DENSITY: 40, HARDNESS: 40 } });
const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);

describe('every word of the look has a reader', () => {
  it('each colour has a hue, each shape an ink, each size a measure', () => {
    expect(Object.keys(LOOK_HUES).sort()).toEqual([...LOOK_COLORS].sort());
    expect(Object.keys(LOOK_INKS).sort()).toEqual([...LOOK_SHAPES].sort());
    expect(Object.keys(LOOK_ATOMS).sort()).toEqual([...LOOK_SIZES].sort());
  });
});

describe('the sprite comes from the three words', () => {
  it('the same words give the same bytes, on every read', () => {
    expect(same(worldForm(def('a', LOOK)).data, worldForm(def('a', LOOK)).data)).toBe(true);
  });

  it('size is how big it is', () => {
    const small = worldForm(def('a', { ...LOOK, size: 'tiny' }));
    const large = worldForm(def('a', { ...LOOK, size: 'large' }));
    expect(large.w).toBeGreaterThan(small.w);
    expect(worldSize(def('a', { ...LOOK, size: 'large' }))).toBeGreaterThan(worldSize(def('a', { ...LOOK, size: 'tiny' })));
  });

  it('every shape is a different outline, so nothing needs its colour to be told apart', () => {
    const outline = (shape: string) => [...worldForm(def('a', { ...LOOK, shape })).data].map(v => (v ? 1 : 0)).join('');
    expect(new Set(LOOK_SHAPES.map(outline)).size).toBe(LOOK_SHAPES.length);
  });

  it('colour changes the hue and nothing else: same outline, same brightness in grayscale', () => {
    const palette = grayscale(buildPalette(HUB_GENRE));
    const gray = (color: string) => [...worldForm(def('a', { ...LOOK, color })).data].map(v => palette[v * 3]);
    const first = gray(LOOK_COLORS[0]);
    // Each ramp is set to the same brightness, and rounding a hue can move it by a step
    for (const color of LOOK_COLORS) gray(color).forEach((v, i) => expect(Math.abs(v - first[i])).toBeLessThanOrEqual(4));
  });

  it('colours really do differ when you can see them', () => {
    const palette = buildPalette(HUB_GENRE);
    const rgb = (color: string) => { const s = worldForm(def('a', { ...LOOK, color })); const v = Math.max(...s.data); return [palette[v * 3], palette[v * 3 + 1], palette[v * 3 + 2]].join(); };
    expect(new Set(LOOK_COLORS.map(rgb)).size).toBe(LOOK_COLORS.length);
  });

  it('every byte a look draws is in the palette, whichever world paints it', () => {
    const palette = buildPalette(HUB_GENRE);
    for (const color of LOOK_COLORS) for (const v of worldForm(def('a', { ...LOOK, color })).data) expect(v * 3 + 2).toBeLessThan(palette.length);
  });

  it('a thing with no look draws what it always did, byte for byte', () => {
    const plain = { id: 'b', tags: ['ore'], materialProps: { DENSITY: 40, HARDNESS: 40 } };
    const bytes = worldForm(plain).data;
    expect(bytes.every(v => v <= 1 + 8 * STEPS)).toBe(true);
    expect(same(worldForm({ ...plain, look: undefined }).data, bytes)).toBe(true);
  });

  it('a spent thing still comes up as a broken outline', () => {
    const s = worldForm({ ...def('a', LOOK), uses: 3 }, { uses: 0 });
    expect(s.data.filter(Boolean).length).toBeLessThan(worldForm({ ...def('a', LOOK), uses: 3 }).data.filter(Boolean).length);
  });
});

describe('Haiku writes the look, and the law judges it', () => {
  it('the schema asks for it on every new thing', () => {
    const props = CHAIN_SCHEMA.properties as any;
    for (const list of ['materials', 'goods', 'gear']) {
      expect(props[list].items.required).toContain('look');
      expect(props[list].items.properties.look.properties.color.enum).toEqual([...LOOK_COLORS]);
      expect(props[list].items.properties.look.properties.shape.enum).toEqual([...LOOK_SHAPES]);
      expect(props[list].items.properties.look.properties.size.enum).toEqual([...LOOK_SIZES]);
    }
  });

  it('the prompt tells it what the words are', () => {
    const system = buildChainRequest({ person: {}, ground: {}, written: {}, open: [] }).system;
    for (const word of [...LOOK_COLORS, ...LOOK_SHAPES, ...LOOK_SIZES]) expect(system).toContain(word);
  });

  it('a look outside the words is refused whole', () => {
    expect(ChainWeb.judge(round({ materials: [material('a', { ...LOOK, color: 'chartreuse' })] }), emptyChain(), TRIBE, [], () => true).ok).toBe(false);
    expect(ChainWeb.judge(round({ materials: [material('a', { ...LOOK, shape: 'dragon' })] }), emptyChain(), TRIBE, [], () => true).ok).toBe(false);
    expect(ChainWeb.judge(round({ materials: [material('a', { ...LOOK, size: 'huge' })] }), emptyChain(), TRIBE, [], () => true).ok).toBe(false);
    expect(ChainWeb.judge(round({ materials: [material('a', null)] }), emptyChain(), TRIBE, [], () => true).ok).toBe(false);
    expect(ChainWeb.judge(round({ materials: [material('a')] }), emptyChain(), TRIBE, [], () => true).ok).toBe(true);
  });

  it('a material written before the look was asked for still has one, the same every time', () => {
    const old = material('old', null);
    expect(lookOfOld(old)).toEqual(lookOfOld(old));
    expect(LOOK_COLORS).toContain(lookOfOld(old).color);
    expect(LOOK_SHAPES).toContain(lookOfOld(old).shape);
    expect(LOOK_SIZES).toContain(lookOfOld(old).size);
  });
});

describe('the ledger of what is to be generated', () => {
  it('a round\'s new materials go on it, with who asked', () => {
    const tech = addToLedger(emptyTech(), round({ materials: [material('skyglass'), material('wyrm_vent')] }), 'res_a', 5);
    expect(materialsToGenerate(tech).map(m => m.key)).toEqual(['skyglass', 'wyrm_vent']);
    expect(tech.ledger[0]).toMatchObject({ key: 'skyglass', askedBy: 'res_a', at: 5 });
    expect(tech.ledger[0].material.look).toEqual(LOOK);
  });

  it('a round with no new material adds nothing', () => {
    expect(addToLedger(emptyTech(), round({}), 'res_a', 5).ledger).toEqual([]);
  });

  it('a thing is on it once, whoever else comes to need it', () => {
    const first = addToLedger(emptyTech(), round({ materials: [material('skyglass')] }), 'res_a', 5);
    expect(addToLedger(first, round({ materials: [material('skyglass')] }), 'res_b', 6).ledger).toHaveLength(1);
  });

  it('what has been generated leaves the list and stays on the record', () => {
    const tech = addToLedger(emptyTech(), round({ materials: [material('skyglass')] }), 'res_a', 5);
    const done = { ...tech, ledger: tech.ledger.map(e => ({ ...e, generatedAt: 9 })) };
    expect(materialsToGenerate(done)).toEqual([]);
    expect(done.ledger).toHaveLength(1);
  });
});
