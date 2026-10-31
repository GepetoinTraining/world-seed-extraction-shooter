/**
 * Draws the field on one canvas. Terrain is cached a quadrant at a time and things
 * as sprites, so a frame is only a handful of image copies however busy the world.
 */

import { CHUNK_PX, QUADRANT_PX, QUADRANT_TILES, quadrantOf } from '../entities/world/grid';
import { EntityType, IChunk, IMap } from '../entities/world/types';
import { ATOM_PX, Genre, Role, Sprite, TILE_ATOMS, buildPalette, px, rankMark } from './atoms/atoms';
import { LAYER, entitySprite, terrainBuffer } from './atoms/world';
import { Archetype, ArmorClass, Facing, WeaponClass, figure } from './atoms/people';

const QUADRANT_ATOMS = QUADRANT_TILES * TILE_ATOMS;
const MAX_QUADRANTS_PER_FRAME = 3;
const MAX_HELD_QUADRANTS = 96;

export interface FieldScene {
  camera: { x: number; z: number };
  player: { uid: string; archetype: Archetype; facing: Facing; step: number; weapon?: WeaponClass; armor?: ArmorClass };
  chunks: IChunk[];
  bullets: { x: number; y: number; hostile: boolean }[];
  drops: { x: number; y: number }[];
  swings: { x: number; y: number; angle: number; range: number }[];
}

export class FieldRenderer {
  private palette: Uint8Array;
  private quadrants = new Map<string, HTMLCanvasElement>();
  private sprites = new WeakMap<Sprite, HTMLCanvasElement>();
  private figures = new Map<string, HTMLCanvasElement>();
  private ranks = new Map<string, HTMLCanvasElement>();

  constructor(private map: IMap, private genre: Genre) {
    this.palette = buildPalette(genre);
  }

  private bitmap(data: Uint8Array, w: number, h: number): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d')!;
    const img = ctx.createImageData(w, h);
    const t = this.palette;
    for (let i = 0; i < data.length; i++) {
      const v = data[i], j = i * 4;
      if (!v) continue;
      img.data[j] = t[v * 3]; img.data[j + 1] = t[v * 3 + 1]; img.data[j + 2] = t[v * 3 + 2]; img.data[j + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return c;
  }

  private spriteBitmap(s: Sprite): HTMLCanvasElement {
    let c = this.sprites.get(s);
    if (!c) { c = this.bitmap(s.data, s.w, s.h); this.sprites.set(s, c); }
    return c;
  }

  private quadrant(qx: number, qy: number, mayBuild: boolean): HTMLCanvasElement | null {
    const key = `${qx},${qy}`;
    const held = this.quadrants.get(key);
    if (held) return held;
    if (!mayBuild) return null;
    const data = terrainBuffer(this.map, this.genre, qx * QUADRANT_ATOMS, qy * QUADRANT_ATOMS, QUADRANT_ATOMS, QUADRANT_ATOMS);
    const c = this.bitmap(data, QUADRANT_ATOMS, QUADRANT_ATOMS);
    if (this.quadrants.size >= MAX_HELD_QUADRANTS) {
      const oldest = this.quadrants.keys().next().value;
      if (oldest !== undefined) this.quadrants.delete(oldest);
    }
    this.quadrants.set(key, c);
    return c;
  }

  /** Builds what is about to come into view, a little at a time. */
  prewarm(x: number, z: number, radius: number, budget = 1) {
    let built = 0;
    for (let qy = quadrantOf(z - radius); qy <= quadrantOf(z + radius) && built < budget; qy++) {
      for (let qx = quadrantOf(x - radius); qx <= quadrantOf(x + radius) && built < budget; qx++) {
        if (!this.quadrants.has(`${qx},${qy}`)) { this.quadrant(qx, qy, true); built++; }
      }
    }
  }

  draw(ctx: CanvasRenderingContext2D, width: number, height: number, scene: FieldScene) {
    ctx.imageSmoothingEnabled = false;
    const ox = Math.round(scene.camera.x - width / 2), oz = Math.round(scene.camera.z - height / 2);
    ctx.fillStyle = '#050505';
    ctx.fillRect(0, 0, width, height);

    let builds = MAX_QUADRANTS_PER_FRAME;
    for (let qy = quadrantOf(oz); qy <= quadrantOf(oz + height); qy++) {
      for (let qx = quadrantOf(ox); qx <= quadrantOf(ox + width); qx++) {
        const held = this.quadrants.has(`${qx},${qy}`);
        const c = this.quadrant(qx, qy, builds > 0);
        if (!held && c) builds--;
        if (c) ctx.drawImage(c, qx * QUADRANT_PX - ox, qy * QUADRANT_PX - oz, QUADRANT_PX, QUADRANT_PX);
      }
    }

    const margin = 110;
    const visible = scene.chunks
      .filter(c => c.x * CHUNK_PX < ox + width + margin && (c.x + 1) * CHUNK_PX > ox - margin && c.y * CHUNK_PX < oz + height + margin && (c.y + 1) * CHUNK_PX > oz - margin)
      .flatMap(c => c.entities)
      .filter(e => e.position.x > ox - margin && e.position.x < ox + width + margin && e.position.y > oz - margin && e.position.y < oz + height + margin);
    visible.sort((a, b) => (LAYER[a.type] ?? 9) - (LAYER[b.type] ?? 9));

    for (const e of visible) {
      const sprite = entitySprite(e);
      if (!sprite) continue;
      const w = sprite.w * ATOM_PX, h = sprite.h * ATOM_PX;
      const x = Math.round(e.position.x - ox - w / 2), y = Math.round(e.position.y - oz - h / 2);
      ctx.drawImage(this.spriteBitmap(sprite), x, y, w, h);
      if (e.type === EntityType.MOB) {
        let mark = this.ranks.get(e.rank);
        if (!mark) { const r = rankMark(e.rank); mark = this.bitmap(r.data, r.w, r.h); this.ranks.set(e.rank, mark); }
        ctx.drawImage(mark, x + w - 4, y + h - 4, mark.width * ATOM_PX, mark.height * ATOM_PX);
      }
    }

    const color = (role: Role, step: number) => {
      const v = px(role, step), t = this.palette;
      return `rgb(${t[v * 3]},${t[v * 3 + 1]},${t[v * 3 + 2]})`;
    };

    ctx.fillStyle = color(Role.PROOF, 3);
    scene.drops.forEach(d => {
      const x = Math.round(d.x - ox), y = Math.round(d.y - oz);
      ctx.fillRect(x - 4, y - 2, 8, 4);
      ctx.fillRect(x - 2, y - 4, 4, 8);
    });

    scene.swings.forEach(s => {
      ctx.fillStyle = color(Role.SIGNAL, 4);
      for (let i = -2; i <= 2; i++) {
        const a = s.angle + i * 0.3;
        ctx.fillRect(Math.round(s.x + Math.cos(a) * s.range * 0.7 - ox), Math.round(s.y + Math.sin(a) * s.range * 0.7 - oz), 4, 4);
      }
    });

    scene.bullets.forEach(b => {
      ctx.fillStyle = b.hostile ? color(Role.LOSS, 3) : color(Role.SIGNAL, 4);
      ctx.fillRect(Math.round(b.x - ox) - 2, Math.round(b.y - oz) - 2, 4, 4);
    });

    const p = scene.player;
    const key = `${p.uid}:${p.archetype}:${p.facing}:${p.step}:${p.weapon ?? ''}:${p.armor ?? ''}`;
    let body = this.figures.get(key);
    if (!body) {
      const f = figure({ uid: p.uid, archetype: p.archetype, facing: p.facing, step: p.step, weapon: p.weapon, armor: p.armor });
      body = this.bitmap(f.data, f.w, f.h);
      this.figures.set(key, body);
    }
    ctx.drawImage(body, Math.round(scene.camera.x - ox - body.width), Math.round(scene.camera.z - oz - body.height), body.width * ATOM_PX, body.height * ATOM_PX);
  }
}
