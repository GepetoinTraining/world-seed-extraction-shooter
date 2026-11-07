import { describe, it, expect } from 'vitest';
import { MOB_DEFINITIONS } from '../shared/entities/mob/data/mobDefinitions';
import { ITEM_DEFINITIONS } from '../shared/entities/item/data/itemDefinitions';
import { HUB_NPCS, HubGenerator, POIType, ZoneType } from '../src/entities/hub/HubGenerator';
import {
  ATOM_PX, Role, STEPS, Sprite, buildPalette, creature, exitBeacon, grayscale, hashBytes, maskDifference, maskOf, px
} from '../shared/render/atoms/atoms';
import { GENRES, composeView, proofView } from '../src/render/atoms/world';
import { ARCHETYPE_IDS, castFigure, castPortrait, figure, portrait, weaponClass } from '../shared/render/atoms/people';
import { residentFigure } from '../shared/render/atoms/people';
import { readFileSync } from 'node:fs';
import {
  HUB_GENRE, HUB_TILE, LOT_STATES, composeHub, doorOf, emblem, floorAtom, glyph, hubGround, hubSigns, keeperSpot, lightAt, lotArt
} from '../src/render/atoms/hub';

// Bars registered before any of this art existed. Do not lower them to get a pass.
const ARCHETYPE_MIN_DIFFERENCE = 0.2;
const ARCHETYPE_MIN_CLASSIFIED = 0.9;
const IDENTITY_MIN_MEDIAN = 0.15;
const IDENTITY_MIN_UNIQUE = 195;
const PORTRAIT_MIN_DIFFERENCE = 0.1;
const STEP_MAX_CHANGE = 0.3;
const GEAR_MIN_DIFFERENCE = 0.08;
const CATEGORY_MIN_DIFFERENCE = 0.25;
const CAST_MIN_DIFFERENCE = 0.15;
const YOU_MIN_DIFFERENCE = 0.08;
const MIN_CONTRAST = 3;
const FLOOR_MIN_BLOCKS = 0.3;
const EMBLEM_MIN_DIFFERENCE = 0.25;
const LOT_MIN_DIFFERENCE = 0.25;
const LIT_MIN_GAIN = 8;
const LIT_MIN_COVER = 0.15;
const LIT_MAX_COVER = 0.5;
const COMPOSE_MAX_MS = 100;
const FRAME_MAX_CHANGE = 0.05;
const GRAY_STEP = 20;

const GRAY = grayscale(buildPalette(HUB_GENRE));
const gray = (v: number) => GRAY[v * 3];
const pairs = <T,>(list: T[]) => list.flatMap((a, i) => list.slice(i + 1).map(b => [a, b] as [T, T]));
const ids = (n: number) => Array.from({ length: n }, (_, i) => `ws_${(i * 2654435761 >>> 0).toString(16)}_cert_${i}`);
const filled = (s: Sprite) => maskOf(s).reduce((n, v) => n + v, 0);

function visibleDifference(a: Sprite, b: Sprite): number {
  let union = 0, diff = 0;
  for (let i = 0; i < a.data.length; i++) {
    if (!a.data[i] && !b.data[i]) continue;
    union++;
    if (Math.abs(gray(a.data[i]) - gray(b.data[i])) >= GRAY_STEP) diff++;
  }
  return union === 0 ? 0 : diff / union;
}

const relLum = (table: Uint8Array, v: number) => {
  const s = table[v * 3] / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
};
const contrast = (table: Uint8Array, a: number, b: number) =>
  (Math.max(relLum(table, a), relLum(table, b)) + 0.05) / (Math.min(relLum(table, a), relLum(table, b)) + 0.05);

describe('the character', () => {
  const uid = 'ws_69e30a63_mvvj0dil_f4304a85';

  it('is the same bytes from the same certificate', () => {
    expect(hashBytes(figure({ uid, archetype: 'NOMAD' }).data)).toBe(hashBytes(figure({ uid, archetype: 'NOMAD' }).data));
    expect(hashBytes(portrait({ uid, archetype: 'NOMAD' }).data)).toBe(hashBytes(portrait({ uid, archetype: 'NOMAD' }).data));
  });

  it('has archetypes that all differ in silhouette', () => {
    const sprites = ARCHETYPE_IDS.map(archetype => ({ archetype, mask: maskOf(figure({ uid, archetype })) }));
    pairs(sprites).forEach(([a, b]) => {
      const d = maskDifference(a.mask, b.mask);
      console.log(`ARCHETYPE ${a.archetype} vs ${b.archetype}: ${(d * 100).toFixed(0)}%`);
      expect(d, `${a.archetype}/${b.archetype}`).toBeGreaterThanOrEqual(ARCHETYPE_MIN_DIFFERENCE);
    });
  });

  it('keeps its archetype readable on any certificate, from silhouette alone', () => {
    const train = ids(100), test = ids(300).slice(100);
    const size = figure({ uid, archetype: 'NOMAD' }).data.length;
    const centroids = ARCHETYPE_IDS.map(archetype => {
      const sum = new Float64Array(size);
      train.forEach(id => maskOf(figure({ uid: id, archetype })).forEach((v, i) => { sum[i] += v; }));
      return { archetype, center: sum.map(v => v / train.length) };
    });
    let right = 0, total = 0;
    ARCHETYPE_IDS.forEach(archetype => test.forEach(id => {
      const mask = maskOf(figure({ uid: id, archetype }));
      const best = centroids.map(c => ({ a: c.archetype, d: c.center.reduce((n, v, i) => n + Math.abs(v - mask[i]), 0) })).sort((x, y) => x.d - y.d)[0];
      total++;
      if (best.a === archetype) right++;
    }));
    console.log(`ARCHETYPE read from silhouette: ${((right / total) * 100).toFixed(1)}% of ${total}`);
    expect(right / total).toBeGreaterThanOrEqual(ARCHETYPE_MIN_CLASSIFIED);
  });

  it('makes one certificate look like itself and not the next one', () => {
    ARCHETYPE_IDS.forEach(archetype => {
      const sprites = ids(200).map(id => figure({ uid: id, archetype }));
      const unique = new Set(sprites.map(s => hashBytes(s.data))).size;
      const diffs = pairs(sprites.slice(0, 40)).map(([a, b]) => visibleDifference(a, b)).sort((a, b) => a - b);
      const median = diffs[Math.floor(diffs.length / 2)];
      console.log(`IDENTITY ${archetype}: ${unique} unique of 200, median difference ${(median * 100).toFixed(0)}%, closest ${(diffs[0] * 100).toFixed(0)}%`);
      expect(unique).toBeGreaterThanOrEqual(IDENTITY_MIN_UNIQUE);
      expect(median).toBeGreaterThanOrEqual(IDENTITY_MIN_MEDIAN);
    });
  });

  it('gives every certificate a portrait of its own', () => {
    const sprites = ids(60).map(id => portrait({ uid: id, archetype: 'OPERATOR' }));
    expect(new Set(sprites.map(s => hashBytes(s.data))).size).toBe(60);
    const closest = Math.min(...pairs(sprites).map(([a, b]) => visibleDifference(a, b)));
    console.log(`PORTRAIT closest pair: ${(closest * 100).toFixed(0)}%`);
    expect(closest).toBeGreaterThanOrEqual(PORTRAIT_MIN_DIFFERENCE);
  });

  it('faces four ways, shows eyes only from the front, and mirrors left from right', () => {
    const at = (facing: any, step = 0) => figure({ uid, archetype: 'STREET_SAMURAI', facing, step });
    const facings = ['down', 'up', 'left', 'right'].map(f => at(f));
    expect(new Set(facings.map(s => hashBytes(s.data))).size).toBe(4);
    const eyes = (s: Sprite) => s.data.filter(v => v === px(Role.SIGNAL, 4)).length;
    expect(eyes(facings[0])).toBeGreaterThan(eyes(facings[1]));
    const { w, h, data } = facings[3];
    const mirrored = new Uint8Array(data.length);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) mirrored[y * w + x] = data[y * w + (w - 1 - x)];
    expect(hashBytes(mirrored)).toBe(hashBytes(facings[2].data));
  });

  it('steps with its legs, not its whole body', () => {
    ARCHETYPE_IDS.forEach(archetype => (['down', 'up', 'left', 'right'] as const).forEach(facing => {
      const a = maskOf(figure({ uid, archetype, facing, step: 0 })), b = maskOf(figure({ uid, archetype, facing, step: 1 }));
      const change = maskDifference(a, b);
      expect(change, `${archetype} ${facing}`).toBeGreaterThan(0);
      expect(change, `${archetype} ${facing}`).toBeLessThanOrEqual(STEP_MAX_CHANGE);
    }));
  });

  it('wears what it carries', () => {
    const weapons = ['blade', 'heavy', 'caster', 'ranged', 'tool'];
    const held = weapons.map(k => ({ k, mask: maskOf(figure({ uid, archetype: 'OPERATOR', weapon: k as any })) }));
    const bare = maskOf(figure({ uid, archetype: 'OPERATOR' }));
    held.forEach(h => expect(maskDifference(h.mask, bare), h.k).toBeGreaterThanOrEqual(GEAR_MIN_DIFFERENCE));
    pairs(held).forEach(([a, b]) => expect(maskDifference(a.mask, b.mask), `${a.k}/${b.k}`).toBeGreaterThanOrEqual(GEAR_MIN_DIFFERENCE));
    const worn = ['heavy', 'light', 'magic'].map(k => ({ k, mask: maskOf(figure({ uid, archetype: 'OPERATOR', armor: k as any })) }));
    pairs(worn).forEach(([a, b]) => expect(maskDifference(a.mask, b.mask), `${a.k}/${b.k}`).toBeGreaterThanOrEqual(GEAR_MIN_DIFFERENCE));
  });

  it('classifies every real weapon and tool, and draws each one', () => {
    [...ITEM_DEFINITIONS.weapon_bases, ...ITEM_DEFINITIONS.tool_bases].forEach(base => {
      const kind = weaponClass(base.tags);
      expect(kind, base.id).toBeTruthy();
      expect(figure({ uid, archetype: 'NOMAD', weapon: kind }).data.length).toBeGreaterThan(0);
    });
  });

  it('is never mistaken for a creature or the exit', () => {
    const creatures = Object.values(MOB_DEFINITIONS) as any[];
    const worst: { pair: string; d: number }[] = [];
    ARCHETYPE_IDS.forEach(archetype => ids(10).forEach(id => {
      const f = figure({ uid: id, archetype });
      const mask = maskOf(f);
      const inner = f.w - 2;
      creatures.forEach(c => worst.push({ pair: `${archetype}/${c.id}`, d: maskDifference(mask, maskOf(creature(c, inner))) }));
    }));
    worst.sort((a, b) => a.d - b.d);
    console.log(`PLAYER vs CREATURE closest: ${worst.slice(0, 3).map(w => `${w.pair} ${(w.d * 100).toFixed(0)}%`).join(', ')}`);
    expect(worst[0].d, worst[0].pair).toBeGreaterThanOrEqual(CATEGORY_MIN_DIFFERENCE);
    const f = figure({ uid, archetype: 'NOMAD' });
    const beacon = exitBeacon();
    const pad = new Uint8Array(f.w * f.h);
    for (let y = 0; y < beacon.h; y++) for (let x = 0; x < beacon.w; x++) pad[y * f.w + x] = beacon.data[y * beacon.w + x];
    expect(maskDifference(maskOf(f), maskOf({ w: f.w, h: f.h, data: pad }))).toBeGreaterThanOrEqual(CATEGORY_MIN_DIFFERENCE);
  });

  it('marks you by shape, so you are never just another figure', () => {
    const you = figure({ uid, archetype: 'NOMAD' });
    const same = figure({ uid, archetype: 'NOMAD', you: false });
    const d = maskDifference(maskOf(you), maskOf(same));
    console.log(`YOU mark changes ${(d * 100).toFixed(0)}% of the silhouette`);
    expect(d).toBeGreaterThanOrEqual(YOU_MIN_DIFFERENCE);
  });

  it('stands out from the brightest hub floor and field ground in grayscale', () => {
    const hub = grayscale(buildPalette(HUB_GENRE));
    expect(contrast(hub, px(Role.SIGNAL, 3), px(Role.GROUND, STEPS - 1))).toBeGreaterThanOrEqual(MIN_CONTRAST);
    expect(contrast(hub, px(Role.LIFE, 3), px(Role.GROUND, STEPS - 1))).toBeGreaterThanOrEqual(MIN_CONTRAST);
    GENRES.forEach(g => {
      const t = grayscale(buildPalette(g));
      expect(contrast(t, px(Role.SIGNAL, 3), px(Role.GROUND, STEPS - 1)), g.name).toBeGreaterThanOrEqual(MIN_CONTRAST);
    });
  });

  it('appears in the field in place of the old marker', () => {
    const { map, center } = proofView();
    const view = composeView(map, GENRES[0], center, 240, 150);
    const f = figure({ uid: 'ws_proof', archetype: 'NOMAD' });
    let match = 0, total = 0;
    const x0 = 120 - Math.floor(f.w / 2), y0 = 75 - Math.floor(f.h / 2);
    for (let y = 0; y < f.h; y++) for (let x = 0; x < f.w; x++) {
      if (!f.data[y * f.w + x]) continue;
      total++;
      if (view.data[(y0 + y) * 240 + x0 + x] === f.data[y * f.w + x]) match++;
    }
    expect(match).toBe(total);
  });
});

describe('the cast', () => {
  const npcs = Object.keys(HUB_NPCS);

  it('draws every named person in the game, all told apart', () => {
    const figures = npcs.map(id => ({ id, mask: maskOf(castFigure(id)) }));
    const scored = pairs(figures).map(([a, b]) => ({ pair: `${a.id}/${b.id}`, d: maskDifference(a.mask, b.mask) })).sort((a, b) => a.d - b.d);
    console.log(`CAST closest: ${scored.slice(0, 3).map(s => `${s.pair} ${(s.d * 100).toFixed(0)}%`).join(', ')}`);
    expect(scored[0].d, scored[0].pair).toBeGreaterThanOrEqual(CAST_MIN_DIFFERENCE);
    expect(new Set(npcs.map(id => hashBytes(castPortrait(id).data))).size).toBe(npcs.length);
  });

  it('shows no one as a player', () => {
    npcs.forEach(id => expect(castFigure(id).data.includes(px(Role.SIGNAL, 3)), id).toBe(false));
  });
});

describe('the hub', () => {
  const layout = HubGenerator.generate();
  const pois = layout.zones.flatMap(z => z.pois);
  const BUILDINGS = [POIType.BANK, POIType.GUILD_HALL, POIType.AUCTION_HOUSE, POIType.VENDOR_WEAPONS, POIType.VENDOR_ARMOR, POIType.VENDOR_CONSUMABLES, POIType.TAVERN, POIType.IDENTIFIER, POIType.LAND_OFFICE];
  const buildings = pois.filter(p => BUILDINGS.includes(p.type));
  const ground = hubGround(layout);
  const W = ground.w;
  const isFloor = (v: number) => v >= px(Role.GROUND, 0) && v <= px(Role.GROUND, STEPS - 1);

  it('is the same bytes every time', () => {
    expect(hashBytes(composeHub(layout).data)).toBe(hashBytes(composeHub(layout).data));
    console.log(`HUB_HASH ${hashBytes(composeHub(layout).data)}`);
  });

  it('composes inside its budget', () => {
    const times = Array.from({ length: 5 }, () => { const t = performance.now(); composeHub(layout); return performance.now() - t; }).sort((a, b) => a - b);
    console.log(`HUB compose median ${times[2].toFixed(1)}ms for ${W}x${ground.h} atoms`);
    expect(times[2]).toBeLessThanOrEqual(COMPOSE_MAX_MS);
  });

  it('draws what blocks you as solid and what does not as floor', () => {
    let solidBad = 0, floorBad = 0;
    const footprint = (x: number, y: number) => pois.some(p => x >= p.position.x && x < p.position.x + p.size.width && y >= p.position.y && y < p.position.y + p.size.height);
    for (let ty = 0; ty < layout.height; ty++) for (let tx = 0; tx < layout.width; tx++) {
      let floorAtoms = 0;
      for (let y = 0; y < HUB_TILE; y++) for (let x = 0; x < HUB_TILE; x++) {
        if (isFloor(ground.data[(ty * HUB_TILE + y) * W + tx * HUB_TILE + x])) floorAtoms++;
      }
      const share = floorAtoms / (HUB_TILE * HUB_TILE);
      const lamp = pois.some(p => p.type === POIType.LAMP_POST && p.position.x === tx && p.position.y === ty);
      if (!layout.navMesh[ty][tx] && !lamp && share > 0.1) solidBad++;
      if (layout.navMesh[ty][tx] && !footprint(tx, ty) && share < 0.95) floorBad++;
    }
    console.log(`HUB tiles drawn against their navmesh: ${solidBad} solid wrong, ${floorBad} floor wrong`);
    expect(solidBad).toBe(0);
    expect(floorBad).toBe(0);
  });

  it('puts a hard seam around every building', () => {
    buildings.forEach(p => {
      const x0 = p.position.x * HUB_TILE, y0 = p.position.y * HUB_TILE, w = p.size.width * HUB_TILE, h = p.size.height * HUB_TILE;
      for (let x = 0; x < w; x++) {
        expect(ground.data[y0 * W + x0 + x], `${p.id} top`).toBe(px(Role.VOID, 0));
        expect(ground.data[(y0 + h - 1) * W + x0 + x], `${p.id} bottom`).toBe(px(Role.VOID, 0));
      }
      for (let y = 0; y < h; y++) {
        expect(ground.data[(y0 + y) * W + x0], `${p.id} left`).toBe(px(Role.VOID, 0));
        expect(ground.data[(y0 + y) * W + x0 + w - 1], `${p.id} right`).toBe(px(Role.VOID, 0));
      }
    });
  });

  it('gives every building a door you can walk to and interact from', () => {
    const start = layout.spawnPoint;
    const seen = new Set([`${start.x},${start.y}`]);
    const queue = [start];
    while (queue.length) {
      const { x, y } = queue.shift()!;
      [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([dx, dy]) => {
        const nx = x + dx, ny = y + dy, key = `${nx},${ny}`;
        if (nx < 0 || ny < 0 || nx >= layout.width || ny >= layout.height || seen.has(key) || !layout.navMesh[ny][nx]) return;
        seen.add(key);
        queue.push({ x: nx, y: ny });
      });
    }
    buildings.forEach(p => {
      const door = doorOf(p);
      expect(layout.navMesh[door.y][door.x], `${p.id} door walkable`).toBe(true);
      expect(seen.has(`${door.x},${door.y}`), `${p.id} door reachable`).toBe(true);
      const dist = Math.hypot(door.x - (p.position.x + p.size.width / 2), door.y - (p.position.y + p.size.height / 2));
      expect(dist, `${p.id} door in the game's range`).toBeLessThan(3);
    });
  });

  // Added after the eye saw you standing on top of the keeper: a keeper must not block the way in.
  it('stands each keeper beside the door, on open ground, within reach', () => {
    pois.filter(p => p.npcId && p.type !== POIType.PORTAL).forEach(p => {
      const door = doorOf(p), spot = keeperSpot(layout, p);
      expect(spot, p.id).not.toEqual(door);
      expect(layout.navMesh[spot.y][spot.x], p.id).toBe(true);
    });
  });

  it('gives every kind of building its own emblem', () => {
    const marks = [...BUILDINGS, POIType.PORTAL].map(type => ({ type, mask: maskOf(emblem(type)) }));
    const scored = pairs(marks).map(([a, b]) => ({ pair: `${a.type}/${b.type}`, d: maskDifference(a.mask, b.mask) })).sort((a, b) => a.d - b.d);
    console.log(`EMBLEMS closest: ${scored.slice(0, 3).map(s => `${s.pair} ${(s.d * 100).toFixed(0)}%`).join(', ')}`);
    expect(scored[0].d, scored[0].pair).toBeGreaterThanOrEqual(EMBLEM_MIN_DIFFERENCE);
  });

  it('shows every name in full, and no sign covers another', () => {
    const signs = hubSigns(layout);
    pois.filter(p => p.interactable).forEach(p => {
      const sign = signs.find(s => s.poiId === p.id);
      expect(sign, p.id).toBeTruthy();
      expect(sign!.lines.join(' '), p.id).toBe(p.name.toUpperCase());
    });
    pairs(signs).forEach(([a, b]) => {
      const apart = a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;
      expect(apart, `${a.poiId}/${b.poiId}`).toBe(true);
    });
    signs.forEach(s => {
      expect(s.x, s.poiId).toBeGreaterThanOrEqual(0);
      expect(s.y, s.poiId).toBeGreaterThanOrEqual(0);
      expect(s.x + s.w, s.poiId).toBeLessThanOrEqual(W);
    });
  });

  it('has a typeface covering every name, with no two glyphs alike', () => {
    const chars = new Set([...pois.map(p => p.name), ...Object.values(HUB_NPCS).flatMap(n => [n.name, n.title])].join('').toUpperCase().replace(/ /g, ''));
    chars.forEach(c => expect(glyph(c), `glyph for ${c}`).toBeTruthy());
    const all = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'].map(c => glyph(c)!.join('|'));
    expect(new Set(all).size).toBe(all.length);
  });

  it('tells its districts apart by floor, at the scale you see them', () => {
    const zones: (ZoneType | null)[] = [ZoneType.PLAZA, ZoneType.MARKET, ZoneType.GARDEN, ZoneType.RESIDENTIAL, null];
    const blocks = (zone: ZoneType | null) => {
      const out: number[] = [];
      for (let by = 0; by < 10; by++) for (let bx = 0; bx < 10; bx++) {
        let sum = 0;
        for (let y = 0; y < 10; y++) for (let x = 0; x < 10; x++) sum += gray(floorAtom(zone, 1000 + bx * 10 + x, 1000 + by * 10 + y));
        out.push(sum / 100);
      }
      return out;
    };
    pairs(zones).forEach(([a, b]) => {
      const ba = blocks(a), bb = blocks(b);
      const differing = ba.filter((v, i) => Math.abs(v - bb[i]) >= 4).length / ba.length;
      console.log(`FLOOR ${a} vs ${b}: ${(differing * 100).toFixed(0)}% of blocks`);
      expect(differing, `${a}/${b}`).toBeGreaterThanOrEqual(FLOOR_MIN_BLOCKS);
    });
  });

  it('has lamplight you can see without color, on real lamps at their real radius', () => {
    const plaza = layout.zones.find(z => z.type === ZoneType.PLAZA)!.bounds;
    let lit = 0, total = 0, litSum = 0, darkSum = 0, darkCount = 0;
    for (let by = plaza.y; by < plaza.y + plaza.height; by++) for (let bx = plaza.x; bx < plaza.x + plaza.width; bx++) {
      if (!layout.navMesh[by][bx]) continue;
      let sum = 0, any = 0;
      for (let y = 0; y < HUB_TILE; y++) for (let x = 0; x < HUB_TILE; x++) {
        const ax = bx * HUB_TILE + x, ay = by * HUB_TILE + y;
        sum += gray(ground.data[ay * W + ax]);
        if (lightAt(layout, ax, ay) > 0) any++;
      }
      total++;
      if (any > 50) { lit++; litSum += sum / 100; } else if (any === 0) { darkSum += sum / 100; darkCount++; }
    }
    const cover = lit / total, gain = litSum / lit - darkSum / darkCount;
    console.log(`LAMPLIGHT covers ${(cover * 100).toFixed(0)}% of the plaza, ${gain.toFixed(1)} levels brighter`);
    expect(cover).toBeGreaterThanOrEqual(LIT_MIN_COVER);
    expect(cover).toBeLessThanOrEqual(LIT_MAX_COVER);
    expect(gain).toBeGreaterThanOrEqual(LIT_MIN_GAIN);
  });

  it('is warmer than the field in every genre', () => {
    const warmth = (data: Uint8Array, table: Uint8Array) => {
      let sum = 0;
      for (let i = 0; i < data.length; i++) sum += table[data[i] * 3] - table[data[i] * 3 + 2];
      return sum / data.length;
    };
    const hub = warmth(composeHub(layout).data, buildPalette(HUB_GENRE));
    const { map, center } = proofView();
    GENRES.forEach(g => {
      const field = warmth(composeView(map, g, center, 240, 150).data, buildPalette(g));
      console.log(`WARMTH hub ${hub.toFixed(1)} vs ${g.name} ${field.toFixed(1)}`);
      expect(hub, g.name).toBeGreaterThan(field);
    });
  });

  it('shows every lot state as its own shape', () => {
    // Wave 10: built lots are solid buildings (they block exactly what they
    // draw), so silhouette masks no longer tell them apart — the atoms do.
    // The measure moved from mask to atom difference; the bar stays 25%.
    const lots = LOT_STATES.map(state => ({ state, art: lotArt(state, 40, 40, 7) }));
    const atomDiff = (a: { data: Uint8Array }, b: { data: Uint8Array }) => {
      let n = 0, d = 0;
      for (let i = 0; i < a.data.length; i++) {
        if (!a.data[i] && !b.data[i]) continue;
        n++;
        if (a.data[i] !== b.data[i]) d++;
      }
      return n === 0 ? 0 : d / n;
    };
    const scored = pairs(lots).map(([a, b]) => ({ pair: `${a.state}/${b.state}`, d: atomDiff(a.art, b.art) })).sort((a, b) => a.d - b.d);
    console.log(`LOTS closest: ${scored.slice(0, 2).map(s => `${s.pair} ${(s.d * 100).toFixed(0)}%`).join(', ')}`);
    expect(scored[0].d, scored[0].pair).toBeGreaterThanOrEqual(LOT_MIN_DIFFERENCE);
  });

  it('animates cheaply: a new frame changes almost nothing', () => {
    const a = composeHub(layout, { frame: 0 }).data, b = composeHub(layout, { frame: 1 }).data;
    let changed = 0;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) changed++;
    console.log(`HUB frame change: ${((changed / a.length) * 100).toFixed(2)}% of atoms`);
    expect(changed).toBeGreaterThan(0);
    expect(changed / a.length).toBeLessThanOrEqual(FRAME_MAX_CHANGE);
  });

  it('fits a person at the real scale', () => {
    expect(HUB_TILE * ATOM_PX).toBe(20);
    expect(filled(figure({ uid: 'x', archetype: 'NOMAD' }))).toBeGreaterThan(0);
  });
});

describe('Q22: a resident is drawn apart from you by shape, not colour', () => {
  const uid = 'res_seed_person_1';
  const isSignal = (v: number) => v >= px(Role.SIGNAL, 0) && v <= px(Role.SIGNAL, STEPS - 1);

  it('no corner brackets and no signal: those are yours alone', () => {
    (['down', 'up', 'left', 'right'] as const).forEach(facing => {
      expect(residentFigure({ uid, facing }).data.some(isSignal), facing).toBe(false);
    });
    expect(figure({ uid, archetype: 'NOMAD' }).data.some(isSignal)).toBe(true);
  });

  it('a roof over the head: the same body without your marks is still another shape', () => {
    const you = figure({ uid, archetype: 'NOMAD' });
    const bare = figure({ uid, archetype: 'NOMAD', you: false });
    const them = residentFigure({ uid });
    const d = maskDifference(maskOf(you), maskOf(them));
    console.log(`RESIDENT differs from you by ${(d * 100).toFixed(0)}% of the silhouette`);
    expect(d).toBeGreaterThanOrEqual(YOU_MIN_DIFFERENCE);
    expect(maskDifference(maskOf(bare), maskOf(them))).toBeGreaterThanOrEqual(YOU_MIN_DIFFERENCE);
  });

  it('walks like anyone, at a person\'s size', () => {
    const still = residentFigure({ uid });
    const stepping = residentFigure({ uid, step: 1, moving: true });
    expect(still.w).toBe(figure({ uid, archetype: 'NOMAD' }).w);
    expect(hashBytes(still.data)).not.toBe(hashBytes(stepping.data));
  });

  it('the city draws residents with it', () => {
    const src = readFileSync('src/entities/hub/HubCanvas.tsx', 'utf8');
    expect(src).toMatch(/residentFigure\(/);
  });
});
