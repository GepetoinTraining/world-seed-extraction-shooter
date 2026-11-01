/**
 * THE GIBBERISH FACE. Pedro: "speech bubbles over their head on occasion shows that to the player,
 * use gibberish as the font face."
 *
 * A real font, built in memory from keyed strokes, with no file behind it, which is how this
 * game makes everything it draws (no image files, no hand-placed pixels). Every printable letter
 * has a glyph of its own, the same on every machine, and none of them can be read.
 *
 * The rest is TrueType's own bookkeeping. Glyphs are plain rectangles with no curves and no hints.
 */

import { Rng } from '../../logic/rng/DeterministicRNG';

export const GIBBERISH_FAMILY = 'WS Gibberish';

const FACE_VERSION = 'v1';
const UNITS_PER_EM = 1000;
const ASCENT = 800;
const DESCENT = -200;
const CELL = 110;
const STROKE = 90;
const GRID_W = 5;
const GRID_H = 7;
const ADVANCE = CELL * GRID_W + CELL;
const FIRST_CHAR = 0x20;
const LAST_CHAR = 0x7e;

class Bytes {
  private out: number[] = [];
  u8(v: number) { this.out.push(v & 0xff); return this; }
  u16(v: number) { return this.u8(v >> 8).u8(v); }
  i16(v: number) { return this.u16(v < 0 ? v + 0x10000 : v); }
  u32(v: number) { return this.u16(Math.floor(v / 0x10000)).u16(v % 0x10000); }
  raw(bytes: ArrayLike<number>) { for (let i = 0; i < bytes.length; i++) this.out.push(bytes[i]); return this; }
  ascii(text: string) { for (let i = 0; i < text.length; i++) this.u8(text.charCodeAt(i)); return this; }
  zeros(n: number) { for (let i = 0; i < n; i++) this.out.push(0); return this; }
  align(n: number) { while (this.out.length % n) this.out.push(0); return this; }
  get length() { return this.out.length; }
  done() { return Uint8Array.from(this.out); }
}

type Rect = [number, number, number, number];

/** A glyph is a few strokes on a small grid: a rune nobody has a name for. */
function strokesOf(code: number): Rect[] {
  if (code === 0x20) return [];
  const rng = Rng.fromKey(`gibberish:${FACE_VERSION}:${code}`);
  const count = 2 + rng.int(0, 3);
  const rects: Rect[] = [];
  for (let i = 0; i < count; i++) {
    const across = rng.next() < 0.5;
    const length = 2 + rng.int(0, across ? GRID_W - 2 : GRID_H - 2);
    const x = rng.int(0, GRID_W - (across ? length : 1) + 1);
    const y = rng.int(0, GRID_H - (across ? 1 : length) + 1);
    rects.push([x * CELL, y * CELL, x * CELL + (across ? length * CELL : STROKE), y * CELL + (across ? STROKE : length * CELL)]);
  }
  return rects;
}

function glyphBytes(rects: Rect[]): Uint8Array {
  if (rects.length === 0) return new Uint8Array(0);
  const b = new Bytes();
  b.i16(rects.length);
  b.i16(Math.min(...rects.map(r => r[0]))).i16(Math.min(...rects.map(r => r[1])));
  b.i16(Math.max(...rects.map(r => r[2]))).i16(Math.max(...rects.map(r => r[3])));
  rects.forEach((_, i) => b.u16(i * 4 + 3));
  b.u16(0);
  for (let i = 0; i < rects.length * 4; i++) b.u8(0x01);
  // Clockwise, as TrueType's outer contours run. Each coordinate is a delta from the last point.
  const points = rects.flatMap(([x0, y0, x1, y1]): [number, number][] => [[x0, y0], [x0, y1], [x1, y1], [x1, y0]]);
  let last = 0;
  for (const [x] of points) { b.i16(x - last); last = x; }
  last = 0;
  for (const [, y] of points) { b.i16(y - last); last = y; }
  return b.done();
}

function nameTable(): Uint8Array {
  const names: [number, string][] = [[1, GIBBERISH_FAMILY], [2, 'Regular'], [3, `${GIBBERISH_FAMILY} ${FACE_VERSION}`], [4, GIBBERISH_FAMILY], [5, 'Version 1.0'], [6, GIBBERISH_FAMILY.replace(/\s/g, '')]];
  const utf16 = (text: string) => { const b = new Bytes(); for (let i = 0; i < text.length; i++) b.u16(text.charCodeAt(i)); return b.done(); };
  const b = new Bytes();
  b.u16(0).u16(names.length).u16(6 + names.length * 12);
  let offset = 0;
  for (const [id, text] of names) {
    const length = text.length * 2;
    b.u16(3).u16(1).u16(0x409).u16(id).u16(length).u16(offset);
    offset += length;
  }
  for (const [, text] of names) b.raw(utf16(text));
  return b.done();
}

function cmapTable(): Uint8Array {
  const segCount = 2;
  const searchRange = 2 * Math.pow(2, Math.floor(Math.log2(segCount)));
  const b = new Bytes();
  b.u16(0).u16(1).u16(3).u16(1).u32(12);
  // Glyph 0 is .notdef, so a character's glyph is its place from the first character, plus one.
  b.u16(4).u16(16 + segCount * 8).u16(0).u16(segCount * 2).u16(searchRange).u16(Math.floor(Math.log2(segCount))).u16(segCount * 2 - searchRange);
  b.u16(LAST_CHAR).u16(0xffff).u16(0);
  b.u16(FIRST_CHAR).u16(0xffff);
  b.u16((1 - FIRST_CHAR + 0x10000) % 0x10000).u16(1);
  b.u16(0).u16(0);
  return b.done();
}

/** The whole file, the same bytes every time. */
export function buildGibberishFace(): Uint8Array {
  const codes = Array.from({ length: LAST_CHAR - FIRST_CHAR + 1 }, (_, i) => FIRST_CHAR + i);
  const strokes: Rect[][] = [[], ...codes.map(strokesOf)];
  const numGlyphs = strokes.length;

  const glyf = new Bytes();
  const loca = new Bytes();
  for (const rects of strokes) {
    loca.u32(glyf.length);
    glyf.raw(glyphBytes(rects)).align(4);
  }
  loca.u32(glyf.length);

  const hmtx = new Bytes();
  strokes.forEach((rects, gid) => hmtx.u16(gid === 0 ? 0 : ADVANCE).i16(rects.length ? Math.min(...rects.map(r => r[0])) : 0));

  const maxPoints = Math.max(...strokes.map(r => r.length * 4));
  const maxContours = Math.max(...strokes.map(r => r.length));
  const top = CELL * GRID_H;
  const right = CELL * GRID_W;

  const head = new Bytes().u32(0x00010000).u32(0x00010000).u32(0).u32(0x5f0f3cf5).u16(0x000b).u16(UNITS_PER_EM).zeros(16)
    .i16(0).i16(0).i16(right).i16(top).u16(0).u16(8).i16(2).i16(1).i16(0).done();
  const hhea = new Bytes().u32(0x00010000).i16(ASCENT).i16(DESCENT).i16(0).u16(ADVANCE).i16(0).i16(0).i16(right).i16(1).i16(0).i16(0).zeros(8).i16(0).u16(numGlyphs).done();
  const maxp = new Bytes().u32(0x00010000).u16(numGlyphs).u16(maxPoints).u16(maxContours).u16(0).u16(0).u16(2).zeros(16).done();
  const os2 = new Bytes().u16(3).i16(ADVANCE).u16(400).u16(5).u16(0).zeros(20).i16(0).zeros(10).zeros(16).ascii('WSGB').u16(0x40).u16(FIRST_CHAR).u16(LAST_CHAR)
    .i16(ASCENT).i16(DESCENT).i16(0).u16(ASCENT).u16(-DESCENT).zeros(8).i16(top - CELL).i16(top).u16(0).u16(0x20).u16(0).done();
  const post = new Bytes().u32(0x00030000).zeros(4).i16(-100).i16(50).zeros(20).done();

  const tables: [string, Uint8Array][] = ([
    ['OS/2', os2], ['cmap', cmapTable()], ['glyf', glyf.done()], ['head', head], ['hhea', hhea],
    ['hmtx', hmtx.done()], ['loca', loca.done()], ['maxp', maxp], ['name', nameTable()], ['post', post]
  ] as [string, Uint8Array][]);

  const checksum = (bytes: Uint8Array) => {
    const padded = new Bytes().raw(bytes).align(4).done();
    const view = new DataView(padded.buffer);
    let sum = 0;
    for (let i = 0; i < padded.length; i += 4) sum = (sum + view.getUint32(i)) >>> 0;
    return sum;
  };

  const searchRange = 16 * Math.pow(2, Math.floor(Math.log2(tables.length)));
  const directory = new Bytes().u32(0x00010000).u16(tables.length).u16(searchRange).u16(Math.floor(Math.log2(tables.length))).u16(tables.length * 16 - searchRange);
  const body = new Bytes();
  let offset = 12 + tables.length * 16;
  let headAt = 0;
  for (const [tag, bytes] of tables) {
    directory.ascii(tag).u32(checksum(bytes)).u32(offset).u32(bytes.length);
    if (tag === 'head') headAt = offset;
    body.raw(bytes).align(4);
    offset = 12 + tables.length * 16 + body.length;
  }
  const file = new Bytes().raw(directory.done()).raw(body.done()).done();
  // The whole file's checksum goes in the head table, and it is the one number not in the sums above.
  new DataView(file.buffer).setUint32(headAt + 8, (0xb1b0afba - checksum(file) + 0x100000000) % 0x100000000);
  return file;
}

let installed: Promise<boolean> | null = null;

/** Puts the face where a canvas and the page can both reach it. With no font door, the bubble just draws plain. */
export function installGibberishFace(): Promise<boolean> {
  if (installed) return installed;
  installed = (async () => {
    if (typeof FontFace === 'undefined' || typeof document === 'undefined') return false;
    try {
      const bytes = buildGibberishFace();
      const face = new FontFace(GIBBERISH_FAMILY, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
      await face.load();
      document.fonts.add(face);
      return true;
    } catch (e) {
      console.warn(`[SPEECH] The gibberish face did not load: ${(e as Error).message}`);
      return false;
    }
  })();
  return installed;
}
