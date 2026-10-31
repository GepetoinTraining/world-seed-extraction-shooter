import { MOB_DEFINITIONS } from '../../src/entities/mob/data/mobDefinitions';
import { RESOURCE_DEFINITIONS } from '../../src/entities/item/data/resourceDefinitions';
import {
  ATOM_PX, Genre, Material, RANKS, RARITIES, Role, STEPS, Sprite, avatar, buildPalette, chest, creature, exitBeacon,
  grain, grayscale, hashBytes, itemSprite, material, npcFigure, playerFigure, px, rankMark, resource, ruin, seal
} from './atoms';
import { GENRES, composeView, entitySprite, proofView } from './world';

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

function render() {
  root.innerHTML = '';
  hashes = [];

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

  // 3. RESOURCES AND THINGS
  const res = section('EXTRACTABLES', 'Form from tags, fill from the real material numbers in the game.');
  (Object.values(RESOURCE_DEFINITIONS) as any[]).forEach(r => res.append(cell(spriteCanvas(resource(r), base, 4), r.name)));

  const things = section('WORLD THINGS');
  ([['Exit beacon', exitBeacon()], ['Chest', chest()], ['Ruin', ruin()], ['NPC', npcFigure('npc')], ['Player', playerFigure()]] as [string, Sprite][])
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

  const edges = section('EDGE: RARITY, ON A 1x2 ITEM FOOTPRINT');
  RARITIES.forEach(r => edges.append(cell(spriteCanvas(itemSprite(material({ density: 60, hardness: 60 }), 1, 2, r, 7), base, 4), r)));

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
}

grayButton.addEventListener('click', () => {
  useGray = !useGray;
  grayButton.setAttribute('aria-pressed', String(useGray));
  render();
});

render();
