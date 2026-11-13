import '../../tests/fixtures/content/installOnLoad';
import { MOB_DEFINITIONS } from '../../shared/entities/mob/data/mobDefinitions';
import { RESOURCE_DEFINITIONS } from '../../shared/entities/item/data/resourceDefinitions';
import {
  ATOM_PX, Genre, Material, RANKS, RARITIES, Role, STEPS, Sprite, avatar, buildPalette, chest, creature, exitBeacon,
  ITEM_CELL, gearMaterial, grain, grayscale, hashBytes, itemArt, material, materialFromProps, npcFigure, px, rankMark, resource, ruin, seal, worldForm
} from '../../shared/render/atoms/atoms';
import { GENRES, STATIC_CONTEXT, composeView, entitySprite, proofView, terrainBuffer } from '../../src/render/atoms/world';
import { WorldGenerator } from '../../shared/entities/world/WorldGenerator';
import { TerrainSystem, TerrainType } from '../../shared/entities/world/TerrainSystem';
import { BiomeType } from '../../shared/entities/world/types';
import { CHUNK_PX, QUADRANT_PX, quadrantOf } from '../../shared/entities/world/grid';
import { Card, Target, cycleTarget, hitTest, inspectEntity, inspectItem, targetsFrom } from '../../src/render/atoms/inspect';
import { figure } from '../../shared/render/atoms/people';
import { ItemFactory } from '../../shared/entities/item/ItemFactory';
import { Rng } from '../../shared/logic/rng/DeterministicRNG';
import { EntityType } from '../../shared/entities/world/types';

const { map, center } = proofView();

const root = document.getElementById('root')!;
const grayButton = document.getElementById('gray')!;
let useGray = false;

const paletteFor = (g: Genre) => (useGray ? grayscale(buildPalette(g)) : buildPalette(g));

function toCanvas(data: Uint8Array, w: number, h: number, palette: Uint8Array, scale: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  c.style.width = `${w * scale}px`; c.style.height = `${h * scale}px`;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(w, h);
  for (let i = 0; i < data.length; i++) {
    const v = data[i], j = i * 4;
    if (v === 0) continue;
    img.data[j] = palette[v * 3]; img.data[j + 1] = palette[v * 3 + 1]; img.data[j + 2] = palette[v * 3 + 2]; img.data[j + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

const spriteCanvas = (s: Sprite, palette: Uint8Array, scale = ATOM_PX) => toCanvas(s.data, s.w, s.h, palette, scale);

// Stepped animation for the proof page: frames swap, nothing interpolates.
const animTimers: number[] = [];
function animated(framesList: Sprite[], palette: Uint8Array, scale: number, ms: number): HTMLElement {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex;align-items:flex-end';
  const canvases = framesList.map(s => spriteCanvas(s, palette, scale));
  canvases.forEach((c, i) => { c.style.display = i === 0 ? '' : 'none'; wrap.append(c); });
  let at = 0;
  animTimers.push(window.setInterval(() => {
    canvases[at].style.display = 'none';
    at = (at + 1) % canvases.length;
    canvases[at].style.display = '';
  }, ms));
  return wrap;
}

function cell(node: HTMLElement, label: string) {
  const d = document.createElement('div');
  d.className = 'cell';
  const l = document.createElement('div');
  l.className = 'label';
  l.textContent = label;
  d.append(node, l);
  return d;
}

function section(title: string, note?: string) {
  const h = document.createElement('h2');
  h.textContent = title;
  root.append(h);
  if (note) { const p = document.createElement('p'); p.textContent = note; root.append(p); }
  const row = document.createElement('div');
  row.className = 'row';
  root.append(row);
  return row;
}

function swatch(m: Material, role: Role, palette: Uint8Array, size = 40): HTMLCanvasElement {
  const data = new Uint8Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    data[y * size + x] = px(role, Math.min(STEPS - 1, 1 + grain(m, x, y, 12345)));
  }
  return toCanvas(data, size, size, palette, ATOM_PX);
}

let hashes: string[] = [];

const itemFor = (item: any): Sprite => itemArt({
  wCells: item.dimensions.width, hCells: item.dimensions.height, tags: item.tags,
  material: gearMaterial(item.tags), rarity: item.rarity, rank: item.rank, quality: item.quality,
  durability: item.stats?.durability, maxDurability: item.stats?.maxDurability,
  identified: item.isIdentified, seed: hashBytes(new TextEncoder().encode(item.id))
});

function cardNode(card: Card, title = card.title): HTMLElement {
  const box = document.createElement('div');
  box.className = 'card';
  const head = document.createElement('div');
  head.className = 'card-title';
  head.textContent = title;
  box.append(head);
  card.rows.forEach(([k, v]) => {
    const row = document.createElement('div');
    row.className = 'card-row';
    const a = document.createElement('span'); a.textContent = k;
    const b = document.createElement('span'); b.textContent = v;
    row.append(a, b);
    box.append(row);
  });
  card.needs.forEach(n => {
    const row = document.createElement('div');
    row.className = 'card-need';
    row.textContent = `× ${n}`;
    box.append(row);
  });
  if (card.canAct && card.needs.length === 0 && card.rows.length > 0) {
    const row = document.createElement('div');
    row.className = 'card-ready';
    row.textContent = '■ Ready';
    box.append(row);
  }
  return box;
}

let hoverLevel = 2;
let hoverRun = 0;

/** A live view: the cursor and Tab answer from one target list, and the game decides what is possible. */
function renderInspect(base: Uint8Array) {
  const run = ++hoverRun;
  const row = section('INSPECT: ONE CARD EVERYWHERE', 'Hover anything on this map, or click the map and press Tab to step through what is near. C switches to the compact form. The numbers below the map are this page, live.');
  const W = 240, H = 150;
  const view = composeView(map, GENRES[0], center, W, H);
  const ox = Math.floor(center.x / ATOM_PX) - Math.floor(W / 2);
  const oy = Math.floor(center.y / ATOM_PX) - Math.floor(H / 2);
  const entities = Object.values(map.chunks).flatMap((c: any) => c.entities)
    .filter((e: any) => {
      const ex = e.position.x / ATOM_PX - ox, ey = e.position.y / ATOM_PX - oy;
      return ex >= 0 && ey >= 0 && ex < W && ey < H;
    }) as any[];
  const byId = new Map(entities.map(e => [e.id, e]));
  const things = entities.map(e => {
    const s = entitySprite(e);
    return { id: e.id, type: e.type as EntityType, x: e.position.x / ATOM_PX - ox, y: e.position.y / ATOM_PX - oy, w: s?.w ?? 12, h: s?.h ?? 12 };
  });
  const targets: Target[] = targetsFrom(things);

  const wrap = document.createElement('div');
  wrap.style.cssText = 'position:relative;display:inline-block';
  const canvas = toCanvas(view.data, W, H, base, ATOM_PX);
  canvas.tabIndex = 0;
  canvas.id = 'hover-map';
  canvas.setAttribute('aria-label', 'Map. Hover or press Tab to inspect things.');
  const ring = document.createElement('div');
  ring.style.cssText = 'position:absolute;border:2px solid #fff;outline:2px solid #000;pointer-events:none;display:none';
  const tip = document.createElement('div');
  tip.id = 'hover-card';
  tip.style.cssText = 'position:absolute;pointer-events:none;display:none;z-index:5';
  wrap.append(canvas, ring, tip);

  const controls = document.createElement('div');
  controls.style.cssText = 'display:flex;flex-direction:column;gap:6px;max-width:260px';
  const levelLabel = document.createElement('div');
  const kit = { bare: [] as any[], pick: [ItemFactory.createItem(undefined, true, Rng.fromKey('atoms:tool:pick'), 'tool', 'tool_pick_rusty_t1')], axe: [ItemFactory.createItem(undefined, true, Rng.fromKey('atoms:tool:axe'), 'tool', 'tool_axe_field_t1')] };
  let kitName: keyof typeof kit = 'bare';
  let compactMode = false;
  let current: string | null = null;

  const show = (id: string | null) => {
    current = id;
    const t = id ? things.find(x => x.id === id) : null;
    if (!t) { ring.style.display = 'none'; tip.style.display = 'none'; return; }
    ring.style.cssText += `;display:block;left:${(t.x - t.w / 2) * ATOM_PX - 2}px;top:${(t.y - t.h / 2) * ATOM_PX - 2}px;width:${t.w * ATOM_PX}px;height:${t.h * ATOM_PX}px`;
    const dist = Math.hypot(t.x - W / 2, t.y - H / 2) * ATOM_PX / 20;
    const player = { currentSession: { inventory: kit[kitName] }, attributes: { intelligence: 0 } } as any;
    const card = inspectEntity(byId.get(id!), { player, dist, level: () => hoverLevel });
    tip.innerHTML = '';
    if (compactMode) {
      const line = document.createElement('div');
      line.className = 'card-compact';
      line.textContent = card.compact;
      tip.append(line);
    } else tip.append(cardNode(card));
    const left = (t.x + t.w / 2) * ATOM_PX + 6;
    tip.style.left = `${left > W * ATOM_PX - 200 ? (t.x - t.w / 2) * ATOM_PX - 206 : left}px`;
    tip.style.top = `${Math.max(0, (t.y - t.h / 2) * ATOM_PX)}px`;
    tip.style.display = 'block';
  };

  canvas.addEventListener('mousemove', ev => {
    const box = canvas.getBoundingClientRect();
    show(hitTest(targets, (ev.clientX - box.left) / ATOM_PX, (ev.clientY - box.top) / ATOM_PX, current));
  });
  canvas.addEventListener('mouseleave', () => show(null));
  canvas.addEventListener('keydown', ev => {
    if (ev.key === 'Tab') {
      ev.preventDefault();
      show(cycleTarget(targets, { x: W / 2, y: H / 2 }, current, 110));
    } else if (ev.key === 'c' || ev.key === 'C') {
      compactMode = !compactMode;
      show(current);
    }
  });

  const button = (label: string, act: () => void) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.addEventListener('click', () => { act(); show(current); });
    return b;
  };
  const refresh = () => { levelLabel.textContent = `Knowledge ${hoverLevel}. Carrying: ${kitName}.`; };
  refresh();
  controls.append(levelLabel,
    button('Knowledge -', () => { hoverLevel = Math.max(0, hoverLevel - 1); refresh(); }),
    button('Knowledge +', () => { hoverLevel = Math.min(3, hoverLevel + 1); refresh(); }),
    button('Carry: nothing', () => { kitName = 'bare'; refresh(); }),
    button('Carry: Rusty Pick', () => { kitName = 'pick'; refresh(); }),
    button('Carry: Field Axe', () => { kitName = 'axe'; refresh(); })
  );
  row.append(cell(wrap, `${entities.length} things in view`), controls);

  const items = section('INSPECT: THE SAME CARD ON ITEMS', 'Real factory items and a real harvested resource, with the card shown open. Hover is not wired up here; only the map above is live.');
  [['wpn_axe_2h_t1', 'weapon', 'atoms:card:1'], ['tool_pick_rusty_t1', 'tool', 'atoms:card:2'], ['arm_chest_heavy_t1', 'armor', 'atoms:card:3']].forEach(([id, cat, key]) => {
    const item = ItemFactory.createItem(undefined, true, Rng.fromKey(key), cat as any, id);
    const box = document.createElement('div');
    box.style.cssText = 'display:flex;gap:8px;align-items:flex-start';
    box.append(spriteCanvas(itemFor(item), base), cardNode(inspectItem(item)));
    items.append(box);
  });
  const ore = ItemFactory.createResourceItem(RESOURCE_DEFINITIONS['res_iron_vein'] as any, Rng.fromKey('atoms:card:ore'));
  const oreBox = document.createElement('div');
  oreBox.style.cssText = 'display:flex;gap:8px;align-items:flex-start';
  oreBox.append(spriteCanvas(itemArt({ wCells: 1, hCells: 1, tags: ore.tags ?? [], material: materialFromProps((RESOURCE_DEFINITIONS['res_iron_vein'] as any).materialProps), rarity: ore.rarity, rank: ore.rank, quality: (ore as any).quality, seed: 5 }), base), cardNode(inspectItem(ore)));
  items.append(oreBox);
  void run;
}

function render() {
  root.innerHTML = '';
  hashes = [];
  animTimers.forEach(t => clearInterval(t));
  animTimers.length = 0;

  // 1. THREE WORLDS
  const worlds = section(
    'THREE WORLDS, ONE MAP',
    `Seed "${map.seed}", real scale (1 atom = ${ATOM_PX}px). Same terrain, creatures, materials and exit in each. Only the name and four colors differ. Biopunk Wasteland stands in for a genre nobody has seen.`
  );
  GENRES.forEach(g => {
    const view = composeView(map, g, center, 240, 150);
    hashes.push(`${g.name}=${hashBytes(view.data)}`);
    worlds.append(cell(toCanvas(view.data, view.w, view.h, paletteFor(g), ATOM_PX), `${g.name}: ${g.palette.join(' ')}`));
  });

  const base = paletteFor(GENRES[0]);

  // 2. CREATURES
  const lineup = section('CREATURES AT REAL SIZE', 'Body plan comes from tags, size from the definition. Top right of each map creature is its rank.');
  (Object.values(MOB_DEFINITIONS) as any[]).forEach(c => lineup.append(cell(spriteCanvas(creature(c), base), `${c.name} (${c.tags.join(', ')})`)));

  const atSize = (title: string, size: number, scale: number) => {
    const row = section(title);
    (Object.values(MOB_DEFINITIONS) as any[]).forEach(c => row.append(cell(spriteCanvas(creature(c, size), base, scale), c.name)));
  };
  atSize('THE QUESTION: ALL NINE AT 10x10, SHOWN AT REAL 2px', 10, 2);
  atSize('ALL NINE AT 10x10, ENLARGED', 10, 6);
  atSize('TOO COARSE? ALL NINE AT 5x5, ENLARGED', 5, 12);

  // 2b. MOTION (Wave 8B)
  const prefersStill = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const motion = section(
    'CREATURES FACE AND STEP',
    'Four facings (front, right, back, left) and two stepped frames from every body plan, with no new art. ' +
    'Left is a mirror of right; the back loses its eyes and shows a dorsal line; a radial body has no front. ' +
    (prefersStill ? 'Reduced motion is on: frames are shown side by side only.' : 'The last cell steps at the game\'s own cadence.')
  );
  (Object.values(MOB_DEFINITIONS) as any[]).forEach(c => {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:4px;align-items:flex-end';
    (['down', 'right', 'up', 'left'] as const).forEach(facing => row.append(spriteCanvas(creature(c, 14, { facing }), base, 3)));
    [0, 1].forEach(frame => row.append(spriteCanvas(creature(c, 14, { facing: 'down', frame }), base, 3)));
    if (!prefersStill) row.append(animated([creature(c, 14, { frame: 0 }), creature(c, 14, { frame: 1 })], base, 3, 240));
    motion.append(cell(row, c.name));
  });

  // 3. RESOURCES AND THINGS
  const res = section('EXTRACTABLES', 'Form from tags, fill from the real material numbers in the game.');
  (Object.values(RESOURCE_DEFINITIONS) as any[]).forEach(r => res.append(cell(spriteCanvas(resource(r), base, 4), r.name)));

  const things = section('WORLD THINGS');
  ([['Exit beacon', exitBeacon()], ['Chest', chest()], ['Ruin', ruin()], ['NPC', npcFigure('npc')], ['Player', figure({ uid: 'ws_proof', archetype: 'NOMAD' })]] as [string, Sprite][])
    .forEach(([label, s]) => things.append(cell(spriteCanvas(s, base, 4), label)));

  // 4. ATOM SHEET
  const ramps = section('RAMP', 'World roles change hue but keep their values. Signal, proof, loss and void belong to the machine and never change.');
  GENRES.forEach(g => {
    const pal = paletteFor(g);
    const data = new Uint8Array(8 * STEPS);
    for (let role = 0; role < 8; role++) for (let step = 0; step < STEPS; step++) data[step * 8 + role] = px(role as Role, step);
    ramps.append(cell(toCanvas(data, 8, STEPS, pal, 14), g.name));
  });

  const props: [string, Partial<Material>][] = [
    ['Density', { density: 80 }], ['Hardness', { hardness: 90 }], ['Conductivity', { conductivity: 80 }],
    ['Resonance', { resonance: 80 }], ['Luminosity', { luminosity: 70, density: 30 }], ['Toxicity', { toxicity: 25 }], ['Elasticity', { elasticity: 80 }]
  ];
  const grains = section('GRAIN: PROPERTIES BECOME PIXELS', 'One property at a time, at a high value.');
  props.forEach(([label, m]) => grains.append(cell(swatch(material(m), Role.MATTER, base), label)));

  const marks = section('MARK: RANK F TO SSS');
  RANKS.forEach(r => marks.append(cell(spriteCanvas(rankMark(r), base, 6), r)));

  // 4b. TREES
  const logDef = RESOURCE_DEFINITIONS['res_tree_log'] as any;
  const berry = RESOURCE_DEFINITIONS['res_berry_bush'] as any;
  const sapling = RESOURCE_DEFINITIONS['res_tree_sapling'] as any;
  const trees = section('TREES', 'The tree stands upright now (D1): a crown in life over a trunk in matter. The trunk blocks its tile and you walk under the crown (D3). Each felling bites the crown; the last leaves a stump that blocks nothing. The same definition in the pack is a 1x3 log.');
  trees.append(cell(spriteCanvas(worldForm(berry), base), 'Berry, for scale'));
  trees.append(cell(spriteCanvas(worldForm(sapling), base), 'Sapling'));
  [3, 2, 1, 0].forEach(uses => trees.append(cell(spriteCanvas(worldForm(logDef, { uses }), base), `${uses} of 3 left`)));
  trees.append(cell(spriteCanvas(itemArt({ wCells: 1, hCells: 3, tags: logDef.tags, material: materialFromProps(logDef.materialProps), rarity: 'COMMON', rank: 'F', seed: 3 }), base), 'Carried log, 1x3'));

  const forests = section('A REAL FOREST', 'Grown by the generator in Overgrowth, in each genre, at real scale.');
  const forestSpot = (() => {
    for (let cy = 120; cy < 136; cy++) for (let cx = 120; cx < 136; cx++) {
      if (WorldGenerator.biomeAt(map.seed, cx, cy) !== BiomeType.OVERGROWTH) continue;
      const trees = WorldGenerator.chunkAt(map, cx, cy, STATIC_CONTEXT)?.entities.filter(e => e.definitionId === 'res_tree_log') ?? [];
      const counts = new Map<string, number>();
      trees.forEach(e => { const q = `${quadrantOf(e.position.x)},${quadrantOf(e.position.y)}`; counts.set(q, (counts.get(q) ?? 0) + 1); });
      const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
      if (best && best[1] >= 10) {
        const [qx, qy] = best[0].split(',').map(Number);
        return { x: (qx + 0.5) * QUADRANT_PX, y: (qy + 0.5) * QUADRANT_PX };
      }
    }
    return { x: 128 * CHUNK_PX, y: 128 * CHUNK_PX };
  })();
  GENRES.forEach(g => {
    const view = composeView(map, g, forestSpot, 240, 150);
    forests.append(cell(toCanvas(view.data, view.w, view.h, paletteFor(g), ATOM_PX), g.name));
  });

  const waterRow = section('WATER', 'Long broken crest lines over a dark body, inside hard seams: water, not hollow squares. The same lake in each genre, terrain only.');
  const lakeSpot = (() => {
    const mid = 16.5 * 512;
    for (let ty = mid - 400; ty < mid + 400; ty += 2) for (let tx = mid - 400; tx < mid + 400; tx += 2) {
      if (TerrainSystem.typeAt(map.seed, tx, ty) === TerrainType.WATER &&
          TerrainSystem.typeAt(map.seed, tx + 2, ty) === TerrainType.WATER &&
          TerrainSystem.typeAt(map.seed, tx, ty + 2) === TerrainType.WATER) {
        return { x: tx * 10, y: ty * 10 };
      }
    }
    return { x: Math.floor(center.x / ATOM_PX), y: Math.floor(center.y / ATOM_PX) };
  })();
  GENRES.forEach(g => {
    const W2 = 240, H2 = 150;
    const buf = terrainBuffer(map, g, lakeSpot.x - W2 / 2, lakeSpot.y - H2 / 2, W2, H2);
    waterRow.append(cell(toCanvas(buf, W2, H2, paletteFor(g), ATOM_PX), g.name));
  });

  const gone = section('SPENT: EVERY RESOURCE', 'Live, then spent. A broken outline means gone for good; a live center means it will return.');
  (Object.values(RESOURCE_DEFINITIONS) as any[]).forEach(r => {
    const pair = document.createElement('div');
    pair.style.cssText = 'display:flex;gap:6px;align-items:flex-end';
    pair.append(spriteCanvas(worldForm(r), base, 3), spriteCanvas(worldForm(r, { uses: 0 }), base, 3));
    gone.append(cell(pair, r.name));
  });

  // 4c. MATERIALS AND KNOWLEDGE
  const known = section('KNOWLEDGE: THE SAME THINGS AT EACH LEVEL', 'Unknown things of one form share every pixel. Naming reveals density. Study reveals the rest. Shown at real 2px and enlarged.');
  ['res_rock_small', 'res_iron_vein', 'res_titanium_vein', 'res_fruit_amber', 'res_fruit_gallpod'].forEach(id => {
    const def = RESOURCE_DEFINITIONS[id] as any;
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:6px;align-items:flex-end';
    [0, 1, 2].forEach(level => row.append(spriteCanvas(worldForm(def, { level }), base, 5)));
    known.append(cell(row, def.name));
  });

  // CP15, 2026-11-13: the panel of three material affixes is gone with them; the game never rolled one.

  // 4d. ITEM CHANNELS
  const blade = ['melee', 'one_hand', 'physical', 'blade'];
  const art = (over: Partial<Parameters<typeof itemArt>[0]> = {}) => itemArt({
    wCells: 1, hCells: 1, tags: blade, material: gearMaterial(blade), rarity: 'RARE', rank: 'C', quality: 0, durability: 100, maxDurability: 100, seed: 77, ...over
  });
  const channel = (title: string, note: string, list: [string, Sprite][]) => {
    const real = section(title, note);
    list.forEach(([label, s]) => real.append(cell(spriteCanvas(s, base), label)));
    const big = section('', undefined);
    list.forEach(([label, s]) => big.append(cell(spriteCanvas(s, base, 5), label)));
  };
  channel('RARITY: THE FRAME', 'One item, seven rarities, at the real 1x1 pack size (36px), then enlarged.', RARITIES.map(r => [r, art({ rarity: r })]));
  channel('QUALITY: THE FILL', 'The same item at -20%, -8%, 0, +8%, +20%. Nothing else changes.', [-0.2, -0.08, 0, 0.08, 0.2].map(q => [`${q > 0 ? '+' : ''}${Math.round(q * 100)}%`, art({ quality: q })]));
  channel('DURABILITY: BITES FROM THE FRAME', 'Rarity corners stay readable. At zero the item is struck through.', [100, 70, 40, 10, 0].map(d => [`${d}%`, art({ durability: d })]));
  channel('ALL FOUR AT ONCE', 'Constructed examples at the real 1x1 size. The first two differ only in quality and wear. Real factory items follow below.', [
    ['Worn Crude F', art({ rarity: 'COMMON', rank: 'F', quality: -0.18, durability: 30 })],
    ['Good Superior F', art({ rarity: 'COMMON', rank: 'F', quality: 0.18, durability: 100 })],
    ['Legendary S', art({ rarity: 'LEGENDARY', rank: 'S', quality: 0.1, durability: 70 })],
    ['Artifact SSS', art({ rarity: 'ARTIFACT', rank: 'SSS', quality: 0.2, durability: 100 })],
    ['Unidentified', art({ identified: false })]
  ]);

  const kinds = section('REAL FOOTPRINTS', 'Pack cells are 36px. Gear has no material data in the game, so its profile here is proposed from tags.');
  [['wpn_sword_1h_t1', 'weapon'], ['wpn_axe_2h_t1', 'weapon'], ['wpn_staff_t1', 'weapon'], ['wpn_bow_t1', 'weapon'], ['arm_chest_heavy_t1', 'armor'], ['tool_pick_rusty_t1', 'tool'], ['tool_scanner_t1', 'tool']].forEach(([id, cat], i) => {
    const item = ItemFactory.createItem(undefined, true, Rng.fromKey(`atoms:item:${i}`), cat as any, id);
    kinds.append(cell(spriteCanvas(itemFor(item), base), item.name));
  });

  renderInspect(base);

  // 5. IDENTITY
  const ids = section('IDENTITY: AVATARS FROM CERTIFICATES, SEALS FROM SIGNATURES', 'Different ids give different faces and seals. The same id always gives the same one.');
  ['ws_69e30a63_mvvj0dil_f4304a85', 'ws_159d4ad7_mvvmgerl_66446b7f', 'ws_b12f9531_mvvk2a01_0c9d1e22', 'ws_7a1100fe_mvvn9q11_a81b6677'].forEach(id => {
    ids.append(cell(spriteCanvas(avatar(id), base, 4), id.slice(0, 11)));
    ids.append(cell(spriteCanvas(seal(id), base, 4), 'seal'));
  });

  // 6. MEASURED
  const results = section('MEASURED IN THIS BROWSER');
  const table = document.createElement('table');
  table.id = 'measured';
  results.append(table);
  measure(table);
}

async function measure(table: HTMLTableElement) {
  const add = (name: string, value: string, pass: boolean | null) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${name}</td><td>${value}</td><td class="${pass === null ? '' : pass ? 'pass' : 'fail'}">${pass === null ? '' : pass ? 'PASS' : 'FAIL'}</td>`;
    table.append(tr);
  };
  hashes.forEach(h => add('Pixel hash', h, null));

  const t0 = performance.now();
  const view = composeView(map, GENRES[0], center, 240, 150);
  add('Compose one full view', `${(performance.now() - t0).toFixed(1)}ms, ${view.entities} things`, null);

  // Cached bitmaps blitted to a canvas, the way the game would draw them.
  const palette = buildPalette(GENRES[0]);
  const entities = Object.values(map.chunks).flatMap(c => c.entities);
  const bitmaps: HTMLCanvasElement[] = [];
  for (const e of entities) {
    const s = entitySprite(e);
    if (s) bitmaps.push(spriteCanvas(s, palette));
    if (bitmaps.length >= 300) break;
  }
  const stage = document.createElement('canvas');
  stage.width = 1024; stage.height = 768;
  const ctx = stage.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  const background = toCanvas(view.data, view.w, view.h, palette, 1);

  const samples: number[] = [];
  const frames: number[] = [];
  let last = performance.now();
  await new Promise<void>(done => {
    const tick = (now: number) => {
      frames.push(now - last); last = now;
      const start = performance.now();
      ctx.drawImage(background, 0, 0, stage.width, stage.height);
      bitmaps.forEach((b, i) => {
        const x = (i * 37 + Math.floor(now / 16) * ((i % 5) + 1)) % stage.width;
        const y = (i * 53 + Math.floor(now / 20) * ((i % 3) + 1)) % stage.height;
        ctx.drawImage(b, x, y, b.width * ATOM_PX, b.height * ATOM_PX);
      });
      samples.push(performance.now() - start);
      if (samples.length < 120) requestAnimationFrame(tick); else done();
    };
    requestAnimationFrame(tick);
  });
  const sorted = [...samples].sort((a, b) => a - b);
  const p95 = sorted[Math.floor(sorted.length * 0.95)];
  const avgFrame = frames.slice(1).reduce((a, b) => a + b, 0) / (frames.length - 1);
  add(`Draw ${bitmaps.length} moving sprites`, `median ${sorted[60].toFixed(2)}ms, p95 ${p95.toFixed(2)}ms`, p95 <= 16);
  add('Frame interval while drawing', `${avgFrame.toFixed(1)}ms`, null);

  const hits: number[] = [];
  for (let frame = 0; frame < 200; frame++) {
    const moving = Array.from({ length: 300 }, (_, i) => ({
      id: `t${i}`, type: i % 3 ? EntityType.MOB : EntityType.RESOURCE,
      x: (i * 37 + frame * ((i % 5) + 1)) % 512, y: (i * 53 + frame * ((i % 3) + 1)) % 384, w: 14, h: 14
    }));
    const start = performance.now();
    hitTest(targetsFrom(moving), (frame * 7) % 512, (frame * 3) % 384);
    hits.push(performance.now() - start);
  }
  hits.sort((a, b) => a - b);
  const hitP95 = hits[Math.floor(hits.length * 0.95)];
  add('Hit-test 300 moving things', `p95 ${hitP95.toFixed(3)}ms`, hitP95 <= 1);
}

grayButton.addEventListener('click', () => {
  useGray = !useGray;
  grayButton.setAttribute('aria-pressed', String(useGray));
  render();
});

render();
