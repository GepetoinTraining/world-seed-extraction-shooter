/**
 * THE SITE'S OWN MATTER (Pedro, 2026-11-12: "design pass, now for real, we need logo, textures...
 * the website needs to be a little less japanese or american circa 1996").
 *
 * The game's law is that nothing on screen is illustrated: every figure and wall is computed from
 * the atoms (DESIGN_ASK.md, "Start one step prior"). The site keeps that law. Its mark, its
 * textures and the cast it shows are computed here, from the same functions and the same machine
 * colors the game draws with, and written to landing/brand/ as plain files the page loads.
 *
 *   node --import tsx scripts/build-brand.ts          writes landing/brand/
 *   node --import tsx scripts/build-brand.ts <dir>    also writes large previews there, to look at
 *
 * What it writes is committed, so the site needs no step of its own to have them. Run it again
 * when the atoms or the machine colors change, and the site follows the game.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { resolve } from 'node:path';
import { Role, STEPS, buildPalette, creature, hash2, type Genre, type Sprite } from '../shared/render/atoms/atoms';
import { figure, portrait, type Archetype } from '../shared/render/atoms/people';

const root = resolve(import.meta.dirname, '..');
const out = resolve(root, 'landing', 'brand');
const previews = process.argv[2] ? resolve(process.argv[2]) : null;
mkdirSync(out, { recursive: true });
if (previews) mkdirSync(previews, { recursive: true });

// The bank terminal's own cold genre, as the game's screens use it (src/components/ui/tokens.ts)
const TERMINAL: Genre = { name: 'Terminal', palette: ['#23262b', '#aab2bf', '#58c08a', '#d9503f'], look: { structure: 'strata', key: 1 } };
const PALETTE = buildPalette(TERMINAL);
type RGB = [number, number, number];
const machine = (role: Role, step: number): RGB => { const i = (1 + role * STEPS + step) * 3; return [PALETTE[i], PALETTE[i + 1], PALETTE[i + 2]]; };
const hex = (c: RGB) => `#${c.map(v => v.toString(16).padStart(2, '0')).join('')}`;
const SIGNAL = [0, 1, 2, 3, 4].map(s => machine(Role.SIGNAL, s));
const PROOF = [0, 1, 2, 3, 4].map(s => machine(Role.PROOF, s));
const VOID = [0, 1, 2, 3, 4].map(s => machine(Role.VOID, s));
const BRIGHT: RGB = [0xf2, 0xf2, 0xee];
const BAYER = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]];

// ---------------------------------------------------------------------------
// PNG, by hand: eight bits a channel, with alpha. Nothing is installed for it.
// ---------------------------------------------------------------------------

const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (buf: Buffer) => { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function png(w: number, h: number, rgba: Uint8Array): Buffer {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const sum = Buffer.alloc(4); sum.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, sum]);
  };
  const head = Buffer.alloc(13);
  head.writeUInt32BE(w, 0); head.writeUInt32BE(h, 4); head[8] = 8; head[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', head), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

/** A grid of atoms: each is a color or nothing. */
class Grid {
  readonly cells: (RGB | null)[];
  constructor(readonly w: number, readonly h: number) { this.cells = new Array(w * h).fill(null); }
  set(x: number, y: number, c: RGB | null) { if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.cells[y * this.w + x] = c; }
  get(x: number, y: number): RGB | null { return x >= 0 && y >= 0 && x < this.w && y < this.h ? this.cells[y * this.w + x] : null; }
  /** Onto another grid, with its corner at (ox, oy). */
  onto(target: Grid, ox: number, oy: number, scale = 1) {
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
      const c = this.get(x, y);
      if (!c) continue;
      for (let sy = 0; sy < scale; sy++) for (let sx = 0; sx < scale; sx++) target.set(ox + x * scale + sx, oy + y * scale + sy, c);
    }
  }
  png(scale = 1, alpha?: (x: number, y: number) => number): Buffer {
    const W = this.w * scale, H = this.h * scale;
    const rgba = new Uint8Array(W * H * 4);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const gx = Math.floor(x / scale), gy = Math.floor(y / scale);
      const c = this.get(gx, gy);
      if (!c) continue;
      const i = (y * W + x) * 4;
      rgba[i] = c[0]; rgba[i + 1] = c[1]; rgba[i + 2] = c[2]; rgba[i + 3] = alpha ? alpha(gx, gy) : 255;
    }
    return png(W, H, rgba);
  }
  /** As SVG: one rect for each run of one color along a row, on the atom grid. */
  svg(title: string): string {
    const rects: string[] = [];
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w;) {
        const c = this.get(x, y);
        if (!c) { x++; continue; }
        let end = x + 1;
        while (end < this.w && this.get(end, y) && hex(this.get(end, y)!) === hex(c)) end++;
        rects.push(`<rect x="${x}" y="${y}" width="${end - x}" height="1" fill="${hex(c)}"/>`);
        x = end;
      }
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${this.w} ${this.h}" shape-rendering="crispEdges" role="img" aria-label="${title}"><title>${title}</title>${rects.join('')}</svg>\n`;
  }
}

const fromSprite = (s: Sprite): Grid => {
  const g = new Grid(s.w, s.h);
  for (let i = 0; i < s.data.length; i++) {
    const v = s.data[i];
    if (v) g.cells[i] = [PALETTE[v * 3], PALETTE[v * 3 + 1], PALETTE[v * 3 + 2]];
  }
  return g;
};

// ---------------------------------------------------------------------------
// THE MARK: a seed, cut open. Its hull, the layers of the world laid down inside it, and at the
// heart a kernel of proof. Signal is what lives and what you can act on; gold is value and proof
// (DESIGN_ASK). In gray each layer is a step lighter than the one around it and the kernel is the
// lightest thing there, so the mark reads by value and by place, never by hue.
// ---------------------------------------------------------------------------

/** Half the seed's width at a height t from its point (0) to its foot (1). */
function seedHalfWidth(t: number, most: number): number {
  const turn = 0.6;
  if (t <= 0 || t >= 1) return 0;
  return t < turn ? most * Math.pow(t / turn, 0.78) : most * Math.sqrt(Math.max(0, 1 - Math.pow((t - turn) / (1 - turn), 2)));
}

/** `thick` is how many atoms each layer is deep. */
function seed(w: number, h: number, thick: number): Grid {
  const g = new Grid(w, h);
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && Math.abs(x + 0.5 - w / 2) <= seedHalfWidth((y + 0.5) / h, w / 2 - 0.5);
  // How far in from the hull each atom lies: peeled a ring at a time, square and diamond by turns, which rounds the rings
  const left = new Set<number>();
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (inside(x, y)) left.add(y * w + x);
  const depth = new Map<number, number>();
  for (let level = 0; left.size > 0; level++) {
    const near: [number, number][] = level % 2 === 0 ? [[1, 0], [-1, 0], [0, 1], [0, -1]] : [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
    const peel = [...left].filter(i => near.some(([dx, dy]) => { const x = (i % w) + dx, y = Math.floor(i / w) + dy; return x < 0 || y < 0 || x >= w || y >= h || !left.has(y * w + x); }));
    for (const i of peel) { depth.set(i, level); left.delete(i); }
  }
  const deepest = Math.max(...depth.values());
  for (const [i, d] of depth) {
    const x = i % w, y = Math.floor(i / w);
    const layer = d === 0 ? 0 : 1 + Math.floor((d - 1) / thick);
    // Hull, three layers of the world, then the kernel; its very heart a step lighter
    const c = layer === 0 ? SIGNAL[0] : layer === 1 ? SIGNAL[1] : layer === 2 ? SIGNAL[2] : layer === 3 ? SIGNAL[3] : d === deepest ? PROOF[4] : PROOF[3];
    g.set(x, y, c);
  }
  // Light on the upper left shoulder, just inside the hull
  for (const [i, d] of depth) {
    const x = i % w, y = Math.floor(i / w);
    if (d === 1 && x < w / 2 - 1 && y > h * 0.14 && y < h * 0.5) g.set(x, y, SIGNAL[4]);
  }
  return g;
}

// ---------------------------------------------------------------------------
// THE WORDMARK: seven letters, each seven atoms by nine, one atom to a stroke. Drawn, not set, so
// the name is the same on every machine and is made of what the game is made of.
// ---------------------------------------------------------------------------

const GLYPHS: Record<string, string[]> = {
  W: ['X.....X', 'X.....X', 'X.....X', 'X.....X', 'X..X..X', 'X..X..X', 'X.X.X.X', 'XX...XX', 'X.....X'],
  O: ['.XXXXX.', 'X.....X', 'X.....X', 'X.....X', 'X.....X', 'X.....X', 'X.....X', 'X.....X', '.XXXXX.'],
  R: ['XXXXXX.', 'X.....X', 'X.....X', 'X.....X', 'XXXXXX.', 'X..X...', 'X...X..', 'X....X.', 'X.....X'],
  L: ['X......', 'X......', 'X......', 'X......', 'X......', 'X......', 'X......', 'X......', 'XXXXXXX'],
  D: ['XXXXX..', 'X....X.', 'X.....X', 'X.....X', 'X.....X', 'X.....X', 'X.....X', 'X....X.', 'XXXXX..'],
  S: ['.XXXXX.', 'X.....X', 'X......', 'X......', '.XXXXX.', '......X', '......X', 'X.....X', '.XXXXX.'],
  E: ['XXXXXXX', 'X......', 'X......', 'X......', 'XXXXX..', 'X......', 'X......', 'X......', 'XXXXXXX']
};
const GLYPH_W = 7, GLYPH_H = 9, GLYPH_GAP = 2;
const wordWidth = (text: string) => text.length * GLYPH_W + (text.length - 1) * GLYPH_GAP;

function word(text: string, color: RGB): Grid {
  const g = new Grid(wordWidth(text), GLYPH_H);
  [...text].forEach((ch, i) => GLYPHS[ch].forEach((row, y) => [...row].forEach((cell, x) => { if (cell === 'X') g.set(i * (GLYPH_W + GLYPH_GAP) + x, y, color); })));
  return g;
}

// ---------------------------------------------------------------------------
// THE GROUND UNDER THE PAGE: strata, as a survey would plot them (DESIGN_ASK: "closer to a
// topographic plot and a sonar return than a painted map"). It repeats sideways without a seam.
// ---------------------------------------------------------------------------

function strata(w: number, h: number): Grid {
  const g = new Grid(w, h);
  const TAU = Math.PI * 2;
  // Whole turns across the width, so the left edge meets the right
  const lie = (x: number, y: number) => y + 7 * Math.sin((x / w) * TAU * 2 + 0.4) + 3 * Math.sin((x / w) * TAU * 5 + 1.7) + 1.5 * Math.sin((x / w) * TAU * 11);
  const edges = [0, 16, 23, 41, 48, 66, 75, 96, 104, 126, 139, 160, h + 40];
  // Each layer a tone of the void, a little lifted so the ground can be seen at all
  const tones: RGB[] = [VOID[1], VOID[2], VOID[3], VOID[2], VOID[4], VOID[3], [0x1f, 0x1f, 0x23], VOID[3], VOID[4], VOID[2], [0x1f, 0x1f, 0x23], VOID[3]];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const d = lie(x, y);
    let band = 0;
    while (band < edges.length - 2 && d >= edges[band + 1]) band++;
    const left = edges[band + 1] - d;
    const next = Math.min(tones.length - 1, band + 1);
    // Three atoms of dither where one layer meets the next
    const pick = left < 3 && BAYER[y & 3][x & 3] < (1 - left / 3) * 16 ? next : band;
    let c = tones[pick];
    // The line of the survey: one atom along the top of some layers, in the machine's deepest signal
    if (left >= 0 && left < 1 && band % 3 === 1) c = SIGNAL[0];
    // A seam of proof in one layer, broken, as ore is
    if (band === 6 && left >= 3 && left < 4 && hash2(7, Math.floor(x / 9), 0) % 100 < 45) c = PROOF[0];
    // Grit: a few atoms a tone up
    if (hash2(11, x, y) % 100 < 3) c = [Math.min(255, c[0] + 10), Math.min(255, c[1] + 10), Math.min(255, c[2] + 12)];
    g.set(x, y, c);
  }
  return g;
}

/** What an old screen leaves behind: a faint, even noise, laid over everything. */
function residue(size: number): Buffer {
  const rgba = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const n = hash2(23, x, y) % 100;
    const i = (y * size + x) * 4;
    const light = n < 50;
    rgba[i] = rgba[i + 1] = rgba[i + 2] = light ? 255 : 0;
    rgba[i + 3] = light ? (n % 7) : (n % 9);
  }
  return png(size, size, rgba);
}

// ---------------------------------------------------------------------------
// WRITE
// ---------------------------------------------------------------------------

const write = (name: string, data: string | Buffer) => { writeFileSync(resolve(out, name), data); console.log(`[BRAND] ${name}  ${typeof data === 'string' ? Buffer.byteLength(data) : data.length} bytes`); };
const preview = (name: string, grid: Grid, scale: number) => { if (previews) writeFileSync(resolve(previews, name), grid.png(scale)); };

// The mark, large and small. The small one is drawn at its own size, not shrunk
const mark = seed(22, 28, 2);
const small = new Grid(16, 16);
seed(12, 15, 1).onto(small, 2, 0);
write('mark.svg', mark.svg('World Seed'));
write('favicon.svg', small.svg('World Seed'));
preview('mark.png', mark, 14);
preview('favicon.png', small, 14);

// The lockup: the mark, and the name in two lines beside it
const lockup = new Grid(22 + 6 + wordWidth('WORLD'), 28);
mark.onto(lockup, 0, 0);
word('WORLD', BRIGHT).onto(lockup, 28, 3);
word('SEED', BRIGHT).onto(lockup, 28, 16);
write('logo.svg', lockup.svg('World Seed'));
preview('logo.png', lockup, 8);

// The name alone, on one line
const line = new Grid(wordWidth('WORLD') + 6 + wordWidth('SEED'), GLYPH_H);
word('WORLD', BRIGHT).onto(line, 0, 0);
word('SEED', BRIGHT).onto(line, wordWidth('WORLD') + 6, 0);
write('wordmark.svg', line.svg('World Seed'));
preview('wordmark.png', line, 8);

// The ground and the residue
const ground = strata(256, 180);
write('strata.png', ground.png(1));
preview('strata.png', ground, 3);
write('residue.png', residue(128));

// The cast, as the game draws them: a body in the field, and a face
const CAST: Archetype[] = ['OPERATOR', 'STREET_SAMURAI', 'NOMAD', 'ARCANIST'];
for (const archetype of CAST) {
  const uid = `site_${archetype.toLowerCase()}`;
  const id = archetype.toLowerCase().replace(/_/g, '-');
  write(`figure-${id}.png`, fromSprite(figure({ uid, archetype })).png(1));
  write(`portrait-${id}.png`, fromSprite(portrait({ uid, archetype })).png(1));
  preview(`portrait-${id}.png`, fromSprite(portrait({ uid, archetype })), 8);
  preview(`figure-${id}.png`, fromSprite(figure({ uid, archetype })), 12);
}

// What walks the worlds: one body of each kind the atoms know how to build
const CREATURES: { id: string; tags: string[]; size: string }[] = [
  { id: 'site_hull', tags: ['mechanical'], size: 'LARGE' },
  { id: 'site_wings', tags: ['flying'], size: 'MEDIUM' },
  { id: 'site_tendril', tags: ['horror'], size: 'LARGE' },
  { id: 'site_titan', tags: ['titan'], size: 'GIGANTIC' },
  { id: 'site_grazer', tags: ['livestock'], size: 'MEDIUM' },
  { id: 'site_biped', tags: ['humanoid'], size: 'MEDIUM' }
];
for (const def of CREATURES) {
  const name = `creature-${def.id.slice('site_'.length)}.png`;
  write(name, fromSprite(creature(def)).png(1));
  preview(name, fromSprite(creature(def)), 10);
}
