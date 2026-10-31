import { describe, it, expect } from 'vitest';
import { MOB_DEFINITIONS } from '../src/entities/mob/data/mobDefinitions';
import { RESOURCE_DEFINITIONS } from '../src/entities/item/data/resourceDefinitions';
import {
  ATOM_PX, Role, STEPS, TILE_ATOMS, buildPalette, creature, exitBeacon, grayscale, hashBytes, maskDifference, maskOf, px, rankMark, RANKS, resource
} from '../src/render/atoms/atoms';
import { GENRES, composeView, openGround, proofView, terrainBuffer } from '../src/render/atoms/world';
import { TerrainSystem, TerrainType } from '../src/entities/world/TerrainSystem';

// Bars registered before the first run. Do not lower them to get a pass.
const CREATURE_MIN_DIFFERENCE = 0.2;
const CATEGORY_MIN_DIFFERENCE = 0.25;
const MIN_CONTRAST = 3;
const MUD_MIN_DIFFERENCE = 0.25;

const { map, center } = proofView();
const W = 240, H = 150;

const creatures = Object.values(MOB_DEFINITIONS) as any[];
const resources = Object.values(RESOURCE_DEFINITIONS) as any[];

const pairs = <T,>(list: T[]) => list.flatMap((a, i) => list.slice(i + 1).map(b => [a, b] as [T, T]));

const relLum = (t: Uint8Array, value: number) => {
  const i = value * 3;
  const f = (c: number) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(t[i]) + 0.7152 * f(t[i + 1]) + 0.0722 * f(t[i + 2]);
};
const contrast = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

describe('same machine', () => {
  it('produces byte-identical pixels from the same input', () => {
    const a = composeView(map, GENRES[0], center, W, H).data;
    const b = composeView(proofView().map, GENRES[0], center, W, H).data;
    expect(hashBytes(a)).toBe(hashBytes(b));
  });

  it('reports the hash for comparison with the browser', () => {
    console.log('ATOMS_HASH ' + GENRES.map(g => `${g.name}=${hashBytes(composeView(map, g, center, W, H).data)}`).join(' '));
  });
});

describe('three worlds', () => {
  it('keeps every thing in the world identical across genres', () => {
    // Only the ground's own texture may change between genres.
    const isGround = (v: number) => v >= px(Role.GROUND, 0) && v <= px(Role.GROUND, STEPS - 1);
    const views = GENRES.map(g => composeView(map, g, center, W, H));
    expect(views[0].entities).toBeGreaterThan(0);
    pairs(views).forEach(([a, b]) => {
      let mismatched = 0, nonGround = 0;
      for (let i = 0; i < a.data.length; i++) {
        if (isGround(a.data[i]) && isGround(b.data[i])) continue;
        nonGround++;
        if (a.data[i] !== b.data[i]) mismatched++;
      }
      expect(nonGround).toBeGreaterThan(0);
      expect(mismatched).toBe(0);
    });
  });

  it('looks different in every genre, even in grayscale', () => {
    const views = GENRES.map(g => ({ g, data: composeView(map, g, center, W, H).data, gray: grayscale(buildPalette(g)), color: buildPalette(g) }));
    pairs(views).forEach(([a, b]) => {
      let grayDiff = 0, colorDist = 0;
      for (let i = 0; i < a.data.length; i++) {
        const ai = a.data[i] * 3, bi = b.data[i] * 3;
        if (a.gray[ai] !== b.gray[bi]) grayDiff++;
        colorDist += Math.abs(a.color[ai] - b.color[bi]) + Math.abs(a.color[ai + 1] - b.color[bi + 1]) + Math.abs(a.color[ai + 2] - b.color[bi + 2]);
      }
      const grayFraction = grayDiff / a.data.length;
      console.log(`WORLDS ${a.g.name} vs ${b.g.name}: gray ${(grayFraction * 100).toFixed(1)}%, color ${(colorDist / a.data.length).toFixed(1)}`);
      expect(grayFraction, `${a.g.name} vs ${b.g.name} grayscale`).toBeGreaterThanOrEqual(0.05);
    });
  });
});

describe('worlds at viewing scale', () => {
  // Registered after the eye caught what the per-pixel check missed: grayscale
  // worlds looked alike. Compares mean brightness of 10x10 blocks.
  it('differ in grayscale at the scale a player actually sees', () => {
    const views = GENRES.map(g => ({ g, data: composeView(map, g, center, W, H).data, gray: grayscale(buildPalette(g)) }));
    const blocks = (v: typeof views[number]) => {
      const out: number[] = [];
      for (let by = 0; by + 10 <= H; by += 10) for (let bx = 0; bx + 10 <= W; bx += 10) {
        let sum = 0;
        for (let y = 0; y < 10; y++) for (let x = 0; x < 10; x++) sum += v.gray[v.data[(by + y) * W + bx + x] * 3];
        out.push(sum / 100);
      }
      return out;
    };
    pairs(views).forEach(([a, b]) => {
      const ba = blocks(a), bb = blocks(b);
      const differing = ba.filter((v, i) => Math.abs(v - bb[i]) >= 4).length / ba.length;
      console.log(`VIEWSCALE ${a.g.name} vs ${b.g.name}: ${(differing * 100).toFixed(0)}% of blocks`);
      expect(differing, `${a.g.name} vs ${b.g.name}`).toBeGreaterThanOrEqual(0.3);
    });
  });
});

describe('terrain stays readable', () => {
  // Registered after the eye caught mud vanishing into Eldritch's dark ground.
  // Mud slows the player, so it has to read in every genre, not only the bright ones.
  it('tells mud from open ground in every genre', () => {
    GENRES.forEach(g => {
      const gray = grayscale(buildPalette(g));
      const ox = Math.floor(center.x / ATOM_PX) - Math.floor(W / 2);
      const oy = Math.floor(center.y / ATOM_PX) - Math.floor(H / 2);
      const data = terrainBuffer(map, g, ox, oy, W, H);
      let mud = 0, differing = 0;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const ax = ox + x, ay = oy + y;
        const tile = TerrainSystem.tileAt(map.seed, Math.floor(ax / TILE_ATOMS) * 20 + 10, Math.floor(ay / TILE_ATOMS) * 20 + 10);
        if (tile.type !== TerrainType.MUD) continue;
        mud++;
        if (Math.abs(gray[data[y * W + x] * 3] - gray[openGround(map, g, ax, ay) * 3]) >= 8) differing++;
      }
      const fraction = differing / mud;
      console.log(`MUD ${g.name}: ${(fraction * 100).toFixed(0)}% of ${mud} atoms differ from open ground`);
      expect(mud).toBeGreaterThan(0);
      expect(fraction, g.name).toBeGreaterThanOrEqual(MUD_MIN_DIFFERENCE);
    });
  });
});

describe('creatures', () => {
  [10, 12, 5].forEach(size => {
    it(`are told apart at ${size}x${size}${size === 5 ? ' (reported only)' : ''}`, () => {
      const masks = creatures.map(c => ({ id: c.id, mask: maskOf(creature(c, size)) }));
      const scored = pairs(masks).map(([a, b]) => ({ pair: `${a.id}/${b.id}`, d: maskDifference(a.mask, b.mask) })).sort((a, b) => a.d - b.d);
      console.log(`CREATURES@${size} closest: ${scored.slice(0, 3).map(s => `${s.pair} ${(s.d * 100).toFixed(0)}%`).join(', ')}`);
      if (size !== 5) expect(scored[0].d, scored[0].pair).toBeGreaterThanOrEqual(CREATURE_MIN_DIFFERENCE);
    });
  });
});

describe('grayscale', () => {
  it('keeps threats and resources readable against the ground in every genre', () => {
    GENRES.forEach(g => {
      const gray = grayscale(buildPalette(g));
      const ground = relLum(gray, px(Role.GROUND, STEPS - 1));
      const threat = contrast(relLum(gray, px(Role.THREAT, 3)), ground);
      const matter = contrast(relLum(gray, px(Role.MATTER, 3)), ground);
      const life = contrast(relLum(gray, px(Role.LIFE, 3)), ground);
      console.log(`CONTRAST ${g.name}: threat ${threat.toFixed(1)}, matter ${matter.toFixed(1)}, life ${life.toFixed(1)}`);
      expect(threat, `${g.name} threat`).toBeGreaterThanOrEqual(MIN_CONTRAST);
      expect(matter, `${g.name} matter`).toBeGreaterThanOrEqual(MIN_CONTRAST);
      expect(life, `${g.name} life`).toBeGreaterThanOrEqual(MIN_CONTRAST);
    });
  });

  it('gives all nine ranks distinct marks', () => {
    expect(new Set(RANKS.map(r => hashBytes(rankMark(r).data))).size).toBe(9);
  });
});

describe('threat vs resource vs exit', () => {
  it('differ by shape alone', () => {
    const size = 12;
    const threats = creatures.map(c => ({ id: c.id, mask: maskOf(creature(c, size)) }));
    const things = resources.map(r => ({ id: r.id, mask: maskOf(resource(r, size)) }));
    const scored = threats.flatMap(t => things.map(r => ({ pair: `${t.id}/${r.id}`, d: maskDifference(t.mask, r.mask) }))).sort((a, b) => a.d - b.d);
    console.log(`CATEGORY closest: ${scored.slice(0, 5).map(s => `${s.pair} ${(s.d * 100).toFixed(0)}%`).join(', ')}`);
    console.log(`CATEGORY failing the bar: ${scored.filter(s => s.d < CATEGORY_MIN_DIFFERENCE).length} of ${scored.length}`);
    expect(scored[0].d, scored[0].pair).toBeGreaterThanOrEqual(CATEGORY_MIN_DIFFERENCE);
  });

  it('keeps the exit unlike any creature', () => {
    const beacon = exitBeacon();
    const mask = maskOf(beacon);
    const inner = beacon.w - 2;
    creatures.forEach(c => {
      expect(maskDifference(mask, maskOf(creature(c, inner))), c.id).toBeGreaterThanOrEqual(CATEGORY_MIN_DIFFERENCE);
    });
  });
});
