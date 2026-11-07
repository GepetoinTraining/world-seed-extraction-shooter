import { describe, it, expect } from 'vitest';
import { RESOURCE_DEFINITIONS } from '../shared/entities/item/data/resourceDefinitions';
import { MOB_DEFINITIONS } from '../shared/entities/mob/data/mobDefinitions';
import { ITEM_DEFINITIONS } from '../shared/entities/item/data/itemDefinitions';
import { MATERIAL_AFFIXES } from '../src/entities/world/MaterialScience';
import { InteractionEngine } from '../src/entities/interaction/InteractionEngine';
import { ItemFactory } from '../shared/entities/item/ItemFactory';
import { Rng } from '../shared/logic/rng/DeterministicRNG';
import { EntityType } from '../shared/entities/world/types';
import { InteractionType } from '../shared/types';
import {
  RANKS, RARITIES, Role, STEPS, Sprite, buildPalette, gearMaterial, grayscale, hashBytes, itemArt, materialFromProps,
  maskDifference, maskOf, px, qualityBand, spent, worldForm
} from '../shared/render/atoms/atoms';
import { GENRES, proofView } from '../src/render/atoms/world';
import { cycleTarget, hitTest, inspectEntity, inspectItem, targetsFrom } from '../src/render/atoms/inspect';
import { LoadoutSystem } from '../shared/entities/player/systems/LoadoutSystem';
import { readFileSync } from 'node:fs';

// Bars registered before any of this art existed. Do not lower them to get a pass.
const TREE_MIN_AREA_RATIO = 3;
const TREE_STATE_MIN_DIFFERENCE = 0.2;
const STUMP_MAX_AREA_RATIO = 0.3;
const SPENT_MIN_DIFFERENCE = 0.25;
const SPENT_MAX_FILLED_RATIO = 0.6;
const SPENT_MIN_CONTRAST = 1.5;
const FOREST_MIN_COVER = 0.4;
const FOREST_MAX_COVER = 0.75; // added after the eye saw a 98% carpet with no ground to walk on
const FOREST_MIN_TRUNKS_VISIBLE = 0.9;
const MINERAL_MIN_DIFFERENCE = 0.25;
const KNOWLEDGE_MIN_STEP_DIFFERENCE = 0.05;
const HARDNESS_MIN_MASK_DIFFERENCE = 0.15;
const PROPERTY_MIN_ATOMS = 3;
const QUALITY_MIN_STEP_DIFFERENCE = 0.12;
const QUALITY_MIN_RANGE_DIFFERENCE = 0.3;
const RARITY_MIN_ATOMS = 6;
const COMPACT_MAX_CHARS = 36;
const HIT_TEST_MAX_MS = 1;
const GRAY_STEP = 20; // a difference smaller than this is not one the eye can use at 2px

const GRAY = grayscale(buildPalette(GENRES[0]));
const gray = (v: number) => GRAY[v * 3];

const resources = Object.values(RESOURCE_DEFINITIONS) as any[];
const res = (id: string) => RESOURCE_DEFINITIONS[id] as any;
const pairs = <T,>(list: T[]) => list.flatMap((a, i) => list.slice(i + 1).map(b => [a, b] as [T, T]));
const filled = (s: Sprite) => maskOf(s).reduce((n, v) => n + v, 0);

/** Fraction of atoms that are on in either sprite and differ by a usable step in grayscale. */
function visibleDifference(a: Sprite, b: Sprite): number {
  let union = 0, diff = 0;
  for (let i = 0; i < a.data.length; i++) {
    if (!a.data[i] && !b.data[i]) continue;
    union++;
    if (Math.abs(gray(a.data[i]) - gray(b.data[i])) >= GRAY_STEP) diff++;
  }
  return union === 0 ? 0 : diff / union;
}

const relLum = (v: number) => {
  const s = gray(v) / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
};
const contrast = (a: number, b: number) => (Math.max(relLum(a), relLum(b)) + 0.05) / (Math.min(relLum(a), relLum(b)) + 0.05);

describe('trees', () => {
  const tree = res('res_tree_log');

  it('stands large against what grows around it', () => {
    const ratio = filled(worldForm(tree)) / filled(worldForm(res('res_berry_bush')));
    console.log(`TREE area vs berry: ${ratio.toFixed(1)}x`);
    expect(ratio).toBeGreaterThanOrEqual(TREE_MIN_AREA_RATIO);
  });

  it('shows each felling as a different shape', () => {
    const states = [3, 2, 1, 0].map(uses => worldForm(tree, { uses, s: 22 }));
    pairs(states).forEach(([a, b]) => {
      expect(maskDifference(maskOf(a), maskOf(b))).toBeGreaterThanOrEqual(TREE_STATE_MIN_DIFFERENCE);
    });
    expect(filled(states[3]) / filled(states[0])).toBeLessThanOrEqual(STUMP_MAX_AREA_RATIO);
  });

  it('is a log when carried, not a small tree', () => {
    const log = itemArt({ wCells: 1, hCells: 3, tags: tree.tags, material: materialFromProps(tree.materialProps), rarity: 'COMMON', rank: 'F', seed: 1 });
    expect(log.h).toBe(52);
    expect(log.w).toBe(16);
    const standing = worldForm(tree, { s: 14 });
    const carried = itemArt({ wCells: 1, hCells: 1, tags: tree.tags, material: materialFromProps(tree.materialProps), rarity: 'COMMON', rank: 'F', seed: 1 });
    expect(maskDifference(maskOf(standing), maskOf(carried))).toBeGreaterThanOrEqual(0.25);
  });
});

describe('spent resources', () => {
  resources.filter(r => !(r.tags.includes('wood') && !r.tags.includes('seed'))).forEach(r => {
    it(`${r.id} has a state of its own`, () => {
      const live = worldForm(r);
      const gone = worldForm(r, { uses: 0 });
      expect(maskDifference(maskOf(live), maskOf(gone))).toBeGreaterThanOrEqual(SPENT_MIN_DIFFERENCE);
      expect(filled(gone) / filled(live)).toBeLessThanOrEqual(SPENT_MAX_FILLED_RATIO);
    });
  });

  it('stays visible on the brightest ground, in every state', () => {
    const lit = px(Role.GROUND, STEPS - 1);
    resources.forEach(r => {
      const gone = worldForm(r, { uses: 0 });
      gone.data.forEach(v => {
        if (v && v !== px(Role.VOID, 0)) expect(contrast(v, lit), r.id).toBeGreaterThanOrEqual(SPENT_MIN_CONTRAST);
      });
    });
  });

  it('tells what returns from what never will', () => {
    const live = worldForm(res('res_rock_small'));
    const returns = spent(live, true), never = spent(live, false);
    let visible = 0;
    for (let i = 0; i < returns.data.length; i++) if (Math.abs(gray(returns.data[i]) - gray(never.data[i])) >= GRAY_STEP) visible++;
    console.log(`SPENT returns vs never: ${visible} atoms differ`);
    expect(visible).toBeGreaterThanOrEqual(5);
  });
});

describe('materials', () => {
  it('tells Dense Stone, Iron and Titanium apart at real size', () => {
    const minerals = ['res_rock_small', 'res_iron_vein', 'res_titanium_vein'].map(id => ({ id, sprite: worldForm(res(id)) }));
    pairs(minerals).forEach(([a, b]) => {
      const d = visibleDifference(a.sprite, b.sprite);
      console.log(`MINERALS ${a.id} vs ${b.id}: ${(d * 100).toFixed(0)}%`);
      expect(d, `${a.id}/${b.id}`).toBeGreaterThanOrEqual(MINERAL_MIN_DIFFERENCE);
    });
  });

  it('reads hardness in the outline', () => {
    const lump = (hardness: number) => worldForm({ id: 'probe', tags: ['mineral'], materialProps: { HARDNESS: hardness } });
    const d = maskDifference(maskOf(lump(80)), maskOf(lump(20)));
    console.log(`HARDNESS 80 vs 20 outline: ${(d * 100).toFixed(0)}%`);
    expect(d).toBeGreaterThanOrEqual(HARDNESS_MIN_MASK_DIFFERENCE);
  });

  // A known failure, recorded and left in place: Silica Sand's Conductivity 2 and Rusted
  // Plate's Hardness 35 each reach only 2 atoms at real size. It.fails turns red if this ever
  // starts passing, so the note cannot go stale. Do not lower the bar to clear it.
  it.fails('shows every property a real material has', () => {
    const misses: string[] = [];
    resources.forEach(r => {
      Object.keys(r.materialProps || {}).forEach(prop => {
        const without = { ...r, materialProps: { ...r.materialProps, [prop]: 0 } };
        const a = worldForm(r).data, b = worldForm(without).data;
        const atoms = a.reduce((n: number, v: number, i: number) => n + (v !== b[i] ? 1 : 0), 0);
        if (atoms < PROPERTY_MIN_ATOMS) misses.push(`${r.id}.${prop} (${atoms})`);
      });
    });
    console.log(`PROPERTIES that reach no pixels: ${misses.join(', ') || 'none'}`);
    expect(misses).toEqual([]);
  });

  it('reports which properties no real material has', () => {
    const present = new Set(resources.flatMap(r => Object.keys(r.materialProps || {})));
    const absent = ['DENSITY', 'HARDNESS', 'CONDUCTIVITY', 'RESONANCE', 'LUMINOSITY', 'TOXICITY', 'ELASTICITY'].filter(p => !present.has(p));
    console.log(`PROPERTIES no real material has: ${absent.join(', ') || 'none'}`);
  });
});

describe('knowledge', () => {
  it('hides what a material is until it is known', () => {
    const unknown = (id: string) => hashBytes(worldForm(res(id), { level: 0 }).data);
    expect(unknown('res_rock_small')).toBe(unknown('res_iron_vein'));
    expect(unknown('res_iron_vein')).toBe(unknown('res_titanium_vein'));
    expect(unknown('res_fruit_amber')).toBe(unknown('res_fruit_gallpod'));
  });

  it('still shows what kind of thing it is', () => {
    const d = maskDifference(maskOf(worldForm(res('res_fruit_amber'), { level: 0 })), maskOf(worldForm(res('res_iron_vein'), { level: 0 })));
    expect(d).toBeGreaterThanOrEqual(0.25);
  });

  it('resolves further at each level', () => {
    ['res_iron_vein', 'res_titanium_vein'].forEach(id => {
      const levels = [0, 1, 2].map(level => worldForm(res(id), { level }));
      for (let i = 1; i < levels.length; i++) {
        const d = visibleDifference(levels[i - 1], levels[i]);
        console.log(`KNOWLEDGE ${id} level ${i - 1} to ${i}: ${(d * 100).toFixed(0)}%`);
        expect(d, `${id} ${i}`).toBeGreaterThanOrEqual(KNOWLEDGE_MIN_STEP_DIFFERENCE);
      }
    });
  });

  it('shows an affix only at its discovery level', () => {
    const iron = res('res_iron_vein');
    Object.values(MATERIAL_AFFIXES).forEach(a => {
      const below = worldForm(iron, { level: a.discoveryThreshold - 1 });
      const at = worldForm(iron, { level: a.discoveryThreshold, affixes: [a.id] });
      const hidden = worldForm(iron, { level: a.discoveryThreshold - 1, affixes: [a.id] });
      expect(hashBytes(hidden.data), a.id).toBe(hashBytes(below.data));
      expect(hashBytes(at.data), a.id).not.toBe(hashBytes(worldForm(iron, { level: a.discoveryThreshold }).data));
    });
    const marks = Object.keys(MATERIAL_AFFIXES).map(id => hashBytes(worldForm(iron, { level: 3, affixes: [id] }).data));
    expect(new Set(marks).size).toBe(Object.keys(MATERIAL_AFFIXES).length);
  });
});

describe('item channels', () => {
  const blade = ['melee', 'one_hand', 'physical', 'blade'];
  const base = { wCells: 1, hCells: 1, tags: blade, material: gearMaterial(blade), rarity: 'RARE', rank: 'C', quality: 0, durability: 100, maxDurability: 100, seed: 77 };
  const W = 16;
  const isFrame = (i: number) => {
    const x = i % W, y = Math.floor(i / W);
    return x < 2 || y < 2 || x >= W - 2 || y >= W - 2;
  };
  const isMark = (i: number) => {
    const x = i % W, y = Math.floor(i / W);
    return x >= W - 7 && x < W - 2 && y >= W - 7 && y < W - 2;
  };
  const isGlyph = (i: number) => !isFrame(i) && !isMark(i);
  const changedIn = (a: Sprite, b: Sprite, region: (i: number) => boolean) => {
    let n = 0;
    for (let i = 0; i < a.data.length; i++) if (region(i) && a.data[i] !== b.data[i]) n++;
    return n;
  };
  const bands = [-0.2, -0.08, 0, 0.08, 0.2];

  it('maps the real quality values, including the other scale', () => {
    expect(bands.map(qualityBand)).toEqual([0, 1, 2, 3, 4]);
    expect(qualityBand(100)).toBe(2);
    expect(qualityBand(undefined)).toBe(2);
  });

  it('shows quality in the fill and nowhere else', () => {
    const sprites = bands.map(quality => itemArt({ ...base, quality }));
    pairs(sprites).forEach(([a, b]) => {
      expect(changedIn(a, b, isFrame)).toBe(0);
      expect(changedIn(a, b, isMark)).toBe(0);
    });
  });

  it('makes quality readable on every kind of gear', () => {
    const kinds = [blade, ['melee', 'two_hand', 'physical', 'heavy'], ['caster', 'two_hand', 'magic', 'energy'], ['ranged', 'two_hand', 'projectile'],
      ['armor', 'heavy', 'defense'], ['armor', 'light', 'evasion'], ['tool', 'axe', 'chopping'], ['tool', 'tech', 'utility']];
    kinds.forEach(tags => {
      const sprites = bands.map(quality => itemArt({ ...base, tags, material: gearMaterial(tags), quality }));
      const worst = Math.min(...sprites.slice(1).map((s, i) => visibleDifference(sprites[i], s)));
      const range = visibleDifference(sprites[0], sprites[4]);
      console.log(`QUALITY ${tags[0]}/${tags[1]}: worst step ${(worst * 100).toFixed(0)}%, full range ${(range * 100).toFixed(0)}%`);
      expect(worst, tags.join()).toBeGreaterThanOrEqual(QUALITY_MIN_STEP_DIFFERENCE);
      expect(range, tags.join()).toBeGreaterThanOrEqual(QUALITY_MIN_RANGE_DIFFERENCE);
      const mean = (s: Sprite) => s.data.reduce((n, v, i) => n + (isGlyph(i) ? gray(v) : 0), 0);
      for (let i = 1; i < sprites.length; i++) expect(mean(sprites[i]), tags.join()).toBeGreaterThan(mean(sprites[i - 1]));
    });
  });

  it('shows rarity in the frame and nowhere else, all seven apart', () => {
    const sprites = RARITIES.map(rarity => itemArt({ ...base, rarity }));
    pairs(sprites).forEach(([a, b]) => {
      expect(changedIn(a, b, isGlyph)).toBe(0);
      expect(changedIn(a, b, isMark)).toBe(0);
    });
    pairs(RARITIES.map((r, i) => ({ r, s: sprites[i] }))).forEach(([a, b]) => {
      let visible = 0;
      for (let i = 0; i < a.s.data.length; i++) if (Math.abs(gray(a.s.data[i]) - gray(b.s.data[i])) >= GRAY_STEP) visible++;
      expect(visible, `${a.r}/${b.r}`).toBeGreaterThanOrEqual(RARITY_MIN_ATOMS);
    });
  });

  it('shows rank only in its mark', () => {
    const sprites = RANKS.map(rank => itemArt({ ...base, rank }));
    pairs(sprites).forEach(([a, b]) => {
      expect(changedIn(a, b, i => !isMark(i))).toBe(0);
    });
  });

  it('shows wear as bites that leave the rarity corners alone', () => {
    const levels = [100, 70, 40, 10, 0].map(durability => itemArt({ ...base, durability }));
    expect(new Set(levels.map(s => hashBytes(s.data))).size).toBe(5);
    const corner = (i: number) => {
      const x = i % W, y = Math.floor(i / W);
      return (x < 3 || x >= W - 3) && (y < 3 || y >= W - 3);
    };
    pairs(levels).forEach(([a, b]) => expect(changedIn(a, b, corner)).toBe(0));
    levels.slice(0, 4).forEach(s => expect(changedIn(levels[0], s, isGlyph)).toBe(0));
    expect(changedIn(levels[0], levels[4], isGlyph)).toBeGreaterThan(0);
  });

  it('gives every combination of the four its own pixels', () => {
    const seen = new Set<number>();
    let n = 0;
    RARITIES.forEach(rarity => RANKS.forEach(rank => bands.forEach(quality => [100, 70, 40, 10, 0].forEach(durability => {
      seen.add(hashBytes(itemArt({ ...base, rarity, rank, quality, durability }).data));
      n++;
    }))));
    console.log(`CHANNELS: ${seen.size} distinct of ${n}`);
    expect(seen.size).toBe(n);
  });

  it('hides everything on an unidentified item', () => {
    const a = itemArt({ ...base, identified: false, rarity: 'ARTIFACT', rank: 'SSS', quality: 0.2 });
    const b = itemArt({ ...base, identified: false, rarity: 'SCRAP', rank: 'F', quality: -0.2, tags: ['armor', 'heavy'], seed: 999 });
    expect(hashBytes(a.data)).toBe(hashBytes(b.data));
    expect(hashBytes(a.data)).not.toBe(hashBytes(itemArt(base).data));
  });
});

describe('inspect card', () => {
  const mint = (key: string, baseId: string, power?: number) => {
    const item = ItemFactory.createItem(undefined, true, Rng.fromKey(key), 'tool', baseId);
    if (power !== undefined) item.stats = { ...item.stats, mining_power: power, chopping_power: power };
    return item;
  };
  const kits: Record<string, any[]> = {
    bare: [],
    axe: [mint('a', 'tool_axe_field_t1', 20)],
    weakPick: [mint('b', 'tool_pick_rusty_t1', 5)],
    pick: [mint('c', 'tool_pick_rusty_t1', 20)],
    strongPick: [mint('d', 'tool_pick_rusty_t1', 60)],
    scanner: [mint('e', 'tool_scanner_t1')]
  };
  const player = (inventory: any[]) => ({ currentSession: { inventory }, attributes: { intelligence: 0 } }) as any;
  const node = (id: string, usesRemaining?: number) => ({
    id: `n_${id}`, type: EntityType.RESOURCE, definitionId: id, position: { x: 0, y: 0 }, rank: 'F', rarity: 'COMMON', usesRemaining
  }) as any;

  it('agrees with the game on what can be done, and says why not', () => {
    let cases = 0, canCount = 0;
    Object.entries(kits).forEach(([kit, inventory]) => {
      resources.forEach(r => [1, 5].forEach(dist => [undefined, 0].forEach(uses => {
        const entity = node(r.id, uses);
        const offered = InteractionEngine.getAvailableInteractions(player(inventory), entity, dist).some(o => o.type === InteractionType.HARVEST);
        const card = inspectEntity(entity, { player: player(inventory), dist, level: () => 2 });
        cases++;
        if (offered) canCount++;
        const label = `${kit}/${r.id}/${dist}/${uses}`;
        expect(card.canAct, label).toBe(offered);
        if (!offered) expect(card.needs.length, label).toBeGreaterThan(0);
        else expect(card.needs, label).toEqual([]);
      })));
    });
    console.log(`INSPECT matches the game on ${cases} cases, ${canCount} of them actionable`);
  });

  it('names the tool and the power that are missing', () => {
    const wrong = inspectEntity(node('res_titanium_vein'), { player: player(kits.weakPick), dist: 1, level: () => 2 });
    expect(wrong.needs.join(' ')).toMatch(/power 50/);
    const none = inspectEntity(node('res_tree_log'), { player: player([]), dist: 1, level: () => 2 });
    expect(none.needs.join(' ')).toMatch(/axe/);
    const far = inspectEntity(node('res_berry_bush'), { player: player([]), dist: 5, level: () => 2 });
    expect(far.needs.join(' ')).toMatch(/closer/i);
  });

  it('works for everything on a real map, with no broken text', () => {
    const { map } = proofView();
    const entities = (Object.values(map.chunks) as any[]).flatMap(c => c.entities);
    const types = new Set<string>();
    let longest = '';
    entities.forEach(e => {
      const card = inspectEntity(e, { player: player([]), dist: 1, level: () => 2 });
      types.add(e.type);
      const text = [card.title, card.compact, ...card.rows.flat(), ...card.needs].join(' | ');
      expect(text, e.id).not.toMatch(/undefined|NaN|\[object|null/);
      expect(card.title.length, e.id).toBeGreaterThan(0);
      if (card.compact.length > longest.length) longest = card.compact;
      expect(card.compact.length, card.compact).toBeLessThanOrEqual(COMPACT_MAX_CHARS);
    });
    console.log(`INSPECT covers ${entities.length} things of ${types.size} types; longest compact: "${longest}"`);
    expect(types.size).toBeGreaterThanOrEqual(4);
  });

  it('reveals only what the player knows', () => {
    const titanium = (level: number) => inspectEntity(node('res_titanium_vein'), { player: player([]), dist: 1, level: () => level });
    const zero = [titanium(0).title, titanium(0).compact, ...titanium(0).rows.flat(), ...titanium(0).needs].join(' ');
    expect(zero).not.toMatch(/Titanium|Hardness|Density|80/);
    expect(titanium(1).title).toMatch(/Titanium/);
    expect(titanium(1).rows.flat().join(' ')).not.toMatch(/Hardness/);
    expect(titanium(2).rows.flat().join(' ')).toMatch(/Hardness/);
  });

  it('keeps quality and zero durability as different words', () => {
    const worst = { ...mint('z', 'tool_axe_field_t1'), name: 'Broken Field Axe', quality: -0.2, stats: { durability: 100, maxDurability: 100 } };
    const card = inspectItem(worst as any);
    expect(card.title).not.toMatch(/Broken/);
    expect(card.rows.flat().join(' ')).toMatch(/Crude/);
    const snapped = inspectItem({ ...worst, quality: 0.1, name: 'Field Axe', stats: { durability: 0, maxDurability: 100 } } as any);
    expect(snapped.rows.flat().join(' ')).toMatch(/Broken/);
    const ore = inspectItem(ItemFactory.createResourceItem(res('res_iron_vein'), Rng.fromKey('o')));
    expect(ore.rows.flat().join(' ')).not.toMatch(/Quality|100%/);
  });

  // Leg 1, the field: a counter's row said "Broken The Repossessor" beside a card that said Crude, at 100 of 100.
  it('names a piece aloud as its card does, at the counter and on the shelf', () => {
    const worst = { ...mint('z', 'tool_axe_field_t1'), name: 'Broken Field Axe', quality: -0.2, stats: { durability: 100, maxDurability: 100 } } as any;
    expect(LoadoutSystem.shownName(worst)).toBe(inspectItem(worst).title);
    expect(LoadoutSystem.shownName(worst)).not.toMatch(/Broken/);
    expect(LoadoutSystem.shownName({ ...worst, isIdentified: false })).toBe('Unidentified Signal');
    const src = readFileSync('src/entities/hub/HubCanvas.tsx', 'utf8');
    for (const modal of ['const SellModal', 'const ShopModal']) {
      const start = src.indexOf(modal);
      expect(start).toBeGreaterThan(-1);
      const block = src.slice(start, src.indexOf('\nconst ', start + 1));
      expect(block).not.toMatch(/\bitem\.name\b/);
    }
  });

  it('hits what is under the cursor, threats first, and holds on while things move', () => {
    const things = [
      { id: 'rock', type: EntityType.RESOURCE, x: 100, y: 100, w: 14, h: 14 },
      { id: 'mob', type: EntityType.MOB, x: 104, y: 100, w: 14, h: 14 },
      { id: 'far', type: EntityType.RESOURCE, x: 300, y: 300, w: 14, h: 14 }
    ];
    const targets = targetsFrom(things as any);
    expect(hitTest(targets, 300, 300)).toBe('far');
    expect(hitTest(targets, 500, 500)).toBeNull();
    expect(hitTest(targets, 102, 100)).toBe('mob');
    expect(hitTest(targets, 102, 100, 'rock')).toBe('rock');
    expect(hitTest(targets, 300, 300, 'rock')).toBe('far');
  });

  it('reaches everything nearby by keyboard, nearest first', () => {
    const things = [{ id: 'c', x: 30, y: 0 }, { id: 'a', x: 10, y: 0 }, { id: 'b', x: 20, y: 0 }, { id: 'away', x: 900, y: 0 }]
      .map(t => ({ ...t, type: EntityType.RESOURCE, w: 12, h: 12 }));
    const targets = targetsFrom(things as any);
    const order: (string | null)[] = [];
    let current: string | null = null;
    for (let i = 0; i < 4; i++) { current = cycleTarget(targets, { x: 0, y: 0 }, current, 200); order.push(current); }
    expect(order).toEqual(['a', 'b', 'c', 'a']);
  });

  it('hit-tests 300 moving things inside the budget', () => {
    const samples: number[] = [];
    for (let frame = 0; frame < 200; frame++) {
      const things = Array.from({ length: 300 }, (_, i) => ({
        id: `t${i}`, type: i % 3 ? EntityType.MOB : EntityType.RESOURCE,
        x: (i * 37 + frame * ((i % 5) + 1)) % 512, y: (i * 53 + frame * ((i % 3) + 1)) % 384, w: 14, h: 14
      }));
      const start = performance.now();
      hitTest(targetsFrom(things as any), (frame * 7) % 512, (frame * 3) % 384);
      samples.push(performance.now() - start);
    }
    samples.sort((a, b) => a - b);
    const p95 = samples[Math.floor(samples.length * 0.95)];
    console.log(`HITTEST 300 things: p95 ${p95.toFixed(3)}ms`);
    expect(p95).toBeLessThanOrEqual(HIT_TEST_MAX_MS);
  });
});

describe('what the card exposed about the game', () => {
  it('reports resources no real tool can harvest', () => {
    const tools = [...ITEM_DEFINITIONS.tool_bases, ...ITEM_DEFINITIONS.weapon_bases, ...ITEM_DEFINITIONS.armor_bases];
    const MAX_QUALITY = 1.2;
    const blocked = resources.filter(r => {
      const config = r.harvestConfig;
      if (!config || config.requiredToolTags.length === 0) return false;
      const best = tools
        .filter(t => config.requiredToolTags.some((tag: string) => t.tags.includes(tag) || t.universal_name.toLowerCase().includes(tag)))
        .flatMap(t => t.implicits.filter(i => i.stat === 'mining_power' || i.stat === 'chopping_power').map(i => (i.max ?? i.value ?? 0) * MAX_QUALITY));
      return Math.max(0, ...best) < config.minToolPower;
    });
    console.log(`UNHARVESTABLE with any real tool at best quality: ${blocked.map(r => `${r.id} (needs ${r.harvestConfig.minToolPower})`).join(', ') || 'none'}`);
    expect(blocked.map(r => r.id)).toEqual([]);
  });
});

describe('mobs on the card', () => {
  it('shows health for every creature', () => {
    (Object.values(MOB_DEFINITIONS) as any[]).forEach(def => {
      const card = inspectEntity(
        { id: 'm', type: EntityType.MOB, definitionId: def.id, position: { x: 0, y: 0 }, rank: 'F', rarity: 'COMMON', health: 1 } as any,
        { player: { currentSession: { inventory: [] }, attributes: {} } as any, dist: 1, level: () => 2 }
      );
      expect(card.title, def.id).toBe('Unknown Contact'); // D60: masked until earned
      expect(card.rows.flat().join(' '), def.id).toMatch(/Health/);
    });
  });
});
