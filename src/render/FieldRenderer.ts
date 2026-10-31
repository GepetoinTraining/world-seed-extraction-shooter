/**
 * Draws the field on one canvas. Terrain is cached a quadrant at a time and things
 * as sprites, so a frame is only a handful of image copies however busy the world.
 *
 * Everything drawn snaps to the 2px atom grid (8B.1), so sprites and terrain can
 * never sit half an atom apart. Flat things draw by layer; standing things — mobs,
 * NPCs, trees and the player — draw by their feet, so you walk under a crown.
 */

import { CHUNK_PX, QUADRANT_PX, QUADRANT_TILES, quadrantOf } from '../entities/world/grid';
import { EntityType, IChunk, IMap, IWorldEntity } from '../entities/world/types';
import { MOB_DEFINITIONS } from '../entities/mob/data/mobDefinitions';
import { ATOM_PX, CreatureFacing, Genre, Role, Sprite, TILE_ATOMS, buildPalette, px, rankMark } from './atoms/atoms';
import { LAYER, baselinePx, entitySprite, standsUpright, terrainBuffer } from './atoms/world';
import { Archetype, ArmorClass, Facing, WeaponClass, figure } from './atoms/people';

const QUADRANT_ATOMS = QUADRANT_TILES * TILE_ATOMS;
const MAX_QUADRANTS_PER_FRAME = 3;
const MAX_HELD_QUADRANTS = 96;
const MAX_HELD_FIGURES = 64;

export const HIT_FLASH_MS = 140;
export const DEATH_BURST_MS = 450;
export const HURT_EDGE_MS = 220;

export interface MobPose { facing: CreatureFacing; frame: number }
export interface FieldEffect { kind: 'hit' | 'death'; x: number; y: number; at: number; size: number }

export interface FieldScene {
  camera: { x: number; z: number };
  player: {
    uid: string; archetype: Archetype; facing: Facing; step: number; moving: boolean;
    weapon?: WeaponClass; armor?: ArmorClass;
  };
  chunks: IChunk[];
  bullets: { x: number; y: number; hostile: boolean }[];
  drops: { x: number; y: number }[];
  swings: { x: number; y: number; angle: number; range: number }[];
  /** Live facing and walk frame per mob id, from the AI. Missing means front, still. */
  mobPoses?: Record<string, MobPose>;
  /** Hit flashes and death bursts, pruned by the caller. */
  effects?: FieldEffect[];
  /** The moment the player last took damage; the screen edge answers it. */
  hurtAt?: number;
  now?: number;
  reducedMotion?: boolean;
}

const snap = (v: number) => Math.round(v / ATOM_PX) * ATOM_PX;

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

  private color(role: Role, step: number): string {
    const v = px(role, step), t = this.palette;
    return `rgb(${t[v * 3]},${t[v * 3 + 1]},${t[v * 3 + 2]})`;
  }

  private rankBitmap(rank: string): HTMLCanvasElement {
    let mark = this.ranks.get(rank);
    if (!mark) { const r = rankMark(rank); mark = this.bitmap(r.data, r.w, r.h); this.ranks.set(rank, mark); }
    return mark;
  }

  private figureBitmap(p: FieldScene['player']): HTMLCanvasElement {
    const key = `${p.uid}:${p.archetype}:${p.facing}:${p.moving ? p.step : 'stand'}:${p.weapon ?? ''}:${p.armor ?? ''}`;
    let body = this.figures.get(key);
    if (!body) {
      const f = figure({ uid: p.uid, archetype: p.archetype, facing: p.facing, step: p.step, moving: p.moving, weapon: p.weapon, armor: p.armor });
      body = this.bitmap(f.data, f.w, f.h);
      if (this.figures.size >= MAX_HELD_FIGURES) {
        const oldest = this.figures.keys().next().value;
        if (oldest !== undefined) this.figures.delete(oldest);
      }
      this.figures.set(key, body);
    }
    return body;
  }

  draw(ctx: CanvasRenderingContext2D, width: number, height: number, scene: FieldScene) {
    ctx.imageSmoothingEnabled = false;
    const now = scene.now ?? Date.now();
    const ox = snap(scene.camera.x - width / 2), oz = snap(scene.camera.z - height / 2);
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

    // Flat things draw by layer.
    const flats = visible.filter(e => !standsUpright(e))
      .sort((a, b) => (LAYER[a.type] ?? 9) - (LAYER[b.type] ?? 9));
    for (const e of flats) {
      const sprite = entitySprite(e);
      if (!sprite) continue;
      const w = sprite.w * ATOM_PX, h = sprite.h * ATOM_PX;
      ctx.drawImage(this.spriteBitmap(sprite), snap(e.position.x - ox - w / 2), snap(e.position.y - oz - h / 2), w, h);
    }

    // Standing things draw by their feet, the player among them.
    const standing: { e: IWorldEntity | null; sprite: HTMLCanvasElement; feet: number; x: number; rank?: string }[] = [];
    for (const e of visible) {
      if (!standsUpright(e)) continue;
      const pose = e.type === EntityType.MOB ? scene.mobPoses?.[e.id] : undefined;
      const sprite = entitySprite(e, undefined, pose);
      if (!sprite) continue;
      standing.push({
        e, sprite: this.spriteBitmap(sprite), feet: e.position.y + baselinePx(e, sprite), x: e.position.x,
        rank: e.type === EntityType.MOB ? e.rank : undefined
      });
    }
    const body = this.figureBitmap(scene.player);
    standing.push({ e: null, sprite: body, feet: scene.camera.z, x: scene.camera.x });
    standing.sort((a, b) => a.feet - b.feet);

    for (const s of standing) {
      const w = s.sprite.width * ATOM_PX, h = s.sprite.height * ATOM_PX;
      const x = snap(s.x - ox - w / 2), y = snap(s.feet - oz - h);
      ctx.drawImage(s.sprite, x, y, w, h);
      if (s.e && s.rank) {
        // The rank is the status mark: drawn at double scale so it reads at play distance.
        const mark = this.rankBitmap(s.rank);
        ctx.drawImage(mark, x + w - 6, y + h - 6, mark.width * ATOM_PX * 2, mark.height * ATOM_PX * 2);
      }
      if (s.e && s.e.type === EntityType.MOB) this.drawHealth(ctx, s.e, x, y, w);
    }

    ctx.fillStyle = this.color(Role.PROOF, 3);
    scene.drops.forEach(d => {
      const x = snap(d.x - ox), y = snap(d.y - oz);
      ctx.fillRect(x - 4, y - 2, 8, 4);
      ctx.fillRect(x - 2, y - 4, 4, 8);
    });

    scene.swings.forEach(s => {
      ctx.fillStyle = this.color(Role.SIGNAL, 4);
      for (let i = -2; i <= 2; i++) {
        const a = s.angle + i * 0.3;
        ctx.fillRect(snap(s.x + Math.cos(a) * s.range * 0.7 - ox), snap(s.y + Math.sin(a) * s.range * 0.7 - oz), 4, 4);
      }
    });

    scene.bullets.forEach(b => {
      ctx.fillStyle = b.hostile ? this.color(Role.LOSS, 3) : this.color(Role.SIGNAL, 4);
      ctx.fillRect(snap(b.x - ox) - 2, snap(b.y - oz) - 2, 4, 4);
    });

    (scene.effects ?? []).forEach(f => this.drawEffect(ctx, f, now, ox, oz, !!scene.reducedMotion));
    if (scene.hurtAt && now - scene.hurtAt < HURT_EDGE_MS) this.drawHurtEdge(ctx, width, height, now - scene.hurtAt, !!scene.reducedMotion);
  }

  /** Pips under a wounded enemy: count and position carry the reading, not hue. */
  private drawHealth(ctx: CanvasRenderingContext2D, e: IWorldEntity, x: number, y: number, w: number) {
    const max = MOB_DEFINITIONS[e.definitionId]?.baseHealth ?? 0;
    const health = e.health ?? 0;
    if (max <= 0 || health >= max || health <= 0) return;
    const pips = 5;
    const left = Math.max(1, Math.ceil((health / max) * pips));
    const total = pips * 6 - 2;
    const x0 = snap(x + w / 2 - total / 2), y0 = y - 6;
    ctx.fillStyle = '#050505';
    ctx.fillRect(x0 - 2, y0 - 2, total + 4, 8);
    for (let i = 0; i < pips; i++) {
      ctx.fillStyle = i < left ? this.color(Role.THREAT, 4) : this.color(Role.VOID, 4);
      ctx.fillRect(x0 + i * 6, y0, 4, 4);
    }
  }

  /** A hit is four brackets closing on the target; a death is the machine striking the record through. */
  private drawEffect(ctx: CanvasRenderingContext2D, f: FieldEffect, now: number, ox: number, oz: number, reduced: boolean) {
    const age = now - f.at;
    const x = snap(f.x - ox), y = snap(f.y - oz);
    if (f.kind === 'hit') {
      if (age > HIT_FLASH_MS) return;
      const r = snap(f.size / 2 + (reduced ? 4 : age < HIT_FLASH_MS / 2 ? 6 : 2));
      ctx.fillStyle = this.color(Role.LOSS, 4);
      [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sy]) => {
        ctx.fillRect(x + sx * r - (sx > 0 ? 6 : 0), y + sy * r - (sy > 0 ? 2 : 0), 6, 2);
        ctx.fillRect(x + sx * r - (sx > 0 ? 2 : 0), y + sy * r - (sy > 0 ? 6 : 0), 2, 6);
      });
      return;
    }
    if (age > DEATH_BURST_MS) return;
    // Three stepped sizes, never smooth. Reduced motion holds the first step only.
    const step = reduced ? 0 : Math.min(2, Math.floor((age / DEATH_BURST_MS) * 3));
    const r = snap(f.size / 2 + 2 + step * 6);
    ctx.fillStyle = step === 2 ? this.color(Role.VOID, 4) : this.color(Role.LOSS, 3);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + 0.39;
      ctx.fillRect(snap(x + Math.cos(a) * r) - 2, snap(y + Math.sin(a) * r) - 2, 4, 4);
    }
    ctx.fillStyle = this.color(Role.LOSS, 2);
    ctx.fillRect(x - r, y - 1, r * 2, 2);
  }

  /** Taking damage marks the screen's own edge: loss, briefly, on all four sides. */
  private drawHurtEdge(ctx: CanvasRenderingContext2D, width: number, height: number, age: number, reduced: boolean) {
    const t = reduced ? 2 : age < HURT_EDGE_MS / 2 ? 8 : 4;
    ctx.fillStyle = this.color(Role.LOSS, 2);
    ctx.fillRect(0, 0, width, t);
    ctx.fillRect(0, height - t, width, t);
    ctx.fillRect(0, t, t, height - t * 2);
    ctx.fillRect(width - t, t, t, height - t * 2);
  }
}
