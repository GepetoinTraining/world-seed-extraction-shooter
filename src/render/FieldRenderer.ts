/**
 * Draws the field on one canvas. Terrain is cached a quadrant at a time and things
 * as sprites, so a frame is only a handful of image copies however busy the world.
 *
 * Everything drawn snaps to the 2px atom grid (8B.1), so sprites and terrain can
 * never sit half an atom apart. Flat things draw by layer; standing things — mobs,
 * NPCs, trees and the player — draw by their feet, so you walk under a crown.
 */

import { CHUNK_PX, QUADRANT_PX, QUADRANT_TILES, quadrantOf } from '../../shared/entities/world/grid';
import { EntityType, IChunk, IMap, IWorldEntity } from '../../shared/entities/world/types';
import { MOB_DEFINITIONS } from '../../shared/entities/mob/data/mobDefinitions';
import { ATOM_PX, CreatureFacing, Genre, Role, Sprite, TILE_ATOMS, buildPalette, px, rankMark } from '../../shared/render/atoms/atoms';
import { LAYER, baselinePx, entitySprite, standsUpright, terrainBuffer } from './atoms/world';
import { Archetype, ArmorClass, Facing, WALK_PHASES, WeaponClass, figure } from '../../shared/render/atoms/people';
import type { IOther } from '../../shared/logic/live/Presence';
import { textScale } from '../logic/settings/store';
import { shapeMarks } from '../../shared/entities/combat/Shapes';
import { volleyShots } from '../../shared/logic/theme/ThemeFormula';
import type { Volley } from '../../shared/logic/theme/ThemeTypes';

const QUADRANT_ATOMS = QUADRANT_TILES * TILE_ATOMS;
const MAX_QUADRANTS_PER_FRAME = 3;
const MAX_HELD_QUADRANTS = 96;
const MAX_HELD_FIGURES = 64;

export const HIT_FLASH_MS = 140;
export const DEATH_BURST_MS = 450;
export const HURT_EDGE_MS = 220;

export interface MobPose { facing: CreatureFacing; frame: number }
/** A hit flash, a death burst, or (part 2) a hit felt: which way it pushed, and whether it broke a wind-up. */
export interface FieldEffect { kind: 'hit' | 'death' | 'stagger'; x: number; y: number; at: number; size: number; dx?: number; dy?: number; broke?: boolean }
/** Part 2: how long a hit felt stays marked. */
export const STAGGER_MARK_MS = 260;

export interface FieldScene {
  camera: { x: number; z: number };
  player: {
    uid: string; archetype: Archetype; facing: Facing; step: number; moving: boolean;
    weapon?: WeaponClass; armor?: ArmorClass;
  };
  chunks: IChunk[];
  /** Online play: everyone else in this place, already slid to where they are drawn (Presence.ts). */
  others?: IOther[];
  bullets: { x: number; y: number; hostile: boolean }[];
  drops: { x: number; y: number }[];
  /** The fight's shapes: a blow's ground as it lands; `inner` is its hole and `half` its half-width (none is the old arc). */
  swings: { x: number; y: number; angle: number; range: number; inner?: number; half?: number }[];
  /** Part 2: the blow you are winding up: a draw is a line out along the aim, a swing its shape's edge filling in. */
  windup?: { x: number; y: number; angle: number; fill: number; kind: 'draw' | 'swing'; shape?: { reachPx: number; innerPx: number; halfAngle: number } };
  /** Live facing and walk frame per mob id, from the AI. Missing means front, still. */
  mobPoses?: Record<string, MobPose>;
  /** Hit flashes and death bursts, pruned by the caller. */
  effects?: FieldEffect[];
  /** The moment the player last took damage; the screen edge answers it. */
  hurtAt?: number;
  now?: number;
  reducedMotion?: boolean;
  /** D71: how dark it is where the player stands, 0 to 1. */
  darkness?: number;
}

/** The dark closes in from the screen's edge, and the ground right around you stays readable. */
const DARK_CLEAR_PX = 120;
const DARK_NEAR = 0.2, DARK_FAR = 0.92;

const snap =(v: number) => Math.round(v / ATOM_PX) * ATOM_PX;

/** Another player's name plate: over the head, square, no tail, so it never reads as speech. */
const PLATE_FONT_PX = 11;
/** As drawn, times the text size the person asked for. */
const platePx = () => Math.round(PLATE_FONT_PX * textScale());
const PLATE_PAD = 3;
const PLATE_ABOVE_PX = 6;
/** A stride is ~560ms whatever the cycle (WorldCanvas): another player's legs keep the same time. */
const STRIDE_MS = 560;

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

  /**
   * Another player's body (Pedro is colourblind: told apart by shape). Their own figure from their
   * uid, without the corner brackets that mark you, ringed one atom wide so it never reads as a
   * resident (roofed) or as you.
   */
  private otherBitmap(o: IOther, step: number): HTMLCanvasElement {
    const key = `other:${o.uid}:${o.archetype}:${o.facing}:${o.moving ? step : 'stand'}:${o.weapon ?? ''}:${o.armor ?? ''}`;
    let held = this.figures.get(key);
    if (held) return held;
    const f = figure({ uid: o.uid, archetype: o.archetype, facing: o.facing, step, moving: o.moving, weapon: o.weapon, armor: o.armor, you: false });
    const body = this.bitmap(f.data, f.w, f.h);
    // The ring: the body's silhouette, filled light, stamped one atom out each way, under the body
    const ring = document.createElement('canvas');
    ring.width = f.w + 2; ring.height = f.h + 2;
    const r = ring.getContext('2d')!;
    for (const [dx, dy] of [[0, 1], [2, 1], [1, 0], [1, 2]]) r.drawImage(body, dx, dy);
    r.globalCompositeOperation = 'source-in';
    r.fillStyle = '#efefef';
    r.fillRect(0, 0, ring.width, ring.height);
    r.globalCompositeOperation = 'source-over';
    r.drawImage(body, 1, 1);
    held = ring;
    if (this.figures.size >= MAX_HELD_FIGURES) {
      const oldest = this.figures.keys().next().value;
      if (oldest !== undefined) this.figures.delete(oldest);
    }
    this.figures.set(key, held);
    return held;
  }

  /** A dark square plate with a light edge and the name in it, centred over the head. */
  private drawPlate(ctx: CanvasRenderingContext2D, name: string, x: number, headTop: number) {
    ctx.save();
    ctx.font = `${platePx()}px monospace`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    const w = Math.ceil(ctx.measureText(name).width) + PLATE_PAD * 2;
    const h = platePx() + PLATE_PAD * 2;
    const left = Math.round(x - w / 2), top = Math.round(headTop - PLATE_ABOVE_PX - h);
    ctx.fillStyle = '#030303';
    ctx.fillRect(left, top, w, h);
    ctx.strokeStyle = '#efefef';
    ctx.lineWidth = 1;
    ctx.strokeRect(left + 0.5, top + 0.5, w - 1, h - 1);
    ctx.fillStyle = '#efefef';
    ctx.fillText(name, x, top + h / 2 + 1);
    ctx.restore();
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
    // Everyone else: their own body with no corner brackets (those mark you alone), ringed by an outline
    const step = scene.reducedMotion ? 0 : Math.floor(now / (STRIDE_MS / WALK_PHASES)) % WALK_PHASES;
    const plates: { name: string; x: number; top: number }[] = [];
    for (const o of scene.others ?? []) {
      if (o.x < ox - margin || o.x > ox + width + margin || o.z < oz - margin || o.z > oz + height + margin) continue;
      const sprite = this.otherBitmap(o, step);
      standing.push({ e: null, sprite, feet: o.z, x: o.x });
      plates.push({ name: o.name, x: o.x, top: o.z - sprite.height * ATOM_PX });
    }
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

    plates.forEach(p => this.drawPlate(ctx, p.name, snap(p.x - ox), snap(p.top - oz)));

    ctx.fillStyle = this.color(Role.PROOF, 3);
    scene.drops.forEach(d => {
      const x = snap(d.x - ox), y = snap(d.y - oz);
      ctx.fillRect(x - 4, y - 2, 8, 4);
      ctx.fillRect(x - 2, y - 4, 4, 8);
    });

    // The fight's shapes: your blow's whole ground, solid, as it lands. What it covers is what it struck
    scene.swings.forEach(s => {
      ctx.fillStyle = this.color(Role.SIGNAL, 4);
      const shape = { reachPx: s.range, innerPx: s.inner ?? 0, halfAngle: s.half ?? 0.75 };
      for (const m of shapeMarks(shape, { x: s.x, y: s.y }, s.angle, 8)) ctx.fillRect(snap(m.x - ox) - 1, snap(m.y - oz) - 1, 2, 2);
      ctx.fillStyle = this.color(Role.SIGNAL, 3);
      for (const m of shapeMarks({ ...shape, innerPx: Math.max(shape.innerPx, shape.reachPx - 1) }, { x: s.x, y: s.y }, s.angle, 4)) ctx.fillRect(snap(m.x - ox) - 2, snap(m.y - oz) - 2, 4, 4);
    });

    if (scene.windup) this.drawWindup(ctx, scene.windup, ox, oz);

    scene.bullets.forEach(b => {
      ctx.fillStyle = b.hostile ? this.color(Role.LOSS, 3) : this.color(Role.SIGNAL, 4);
      ctx.fillRect(snap(b.x - ox) - 2, snap(b.y - oz) - 2, 4, 4);
    });

    visible.forEach(e => this.drawTelegraph(ctx, e, ox, oz, now));
    (scene.effects ?? []).forEach(f => this.drawEffect(ctx, f, now, ox, oz, !!scene.reducedMotion));
    if (scene.darkness) this.drawDark(ctx, width, height, scene.darkness);
    if (scene.hurtAt && now - scene.hurtAt < HURT_EDGE_MS) this.drawHurtEdge(ctx, width, height, now - scene.hurtAt, !!scene.reducedMotion);
  }

  /** Night is how far you can see, so it reads in grayscale. */
  private drawDark(ctx: CanvasRenderingContext2D, width: number, height: number, darkness: number) {
    const dark = ctx.createRadialGradient(width / 2, height / 2, DARK_CLEAR_PX, width / 2, height / 2, Math.max(width, height) * 0.55);
    dark.addColorStop(0, `rgba(0,0,0,${darkness * DARK_NEAR})`);
    dark.addColorStop(1, `rgba(0,0,0,${darkness * DARK_FAR})`);
    ctx.fillStyle = dark;
    ctx.fillRect(0, 0, width, height);
  }

  /**
   * A wind-up reads by shape and position, never hue: corner brackets for a blow,
   * a broken ring at its true reach for an area, a dashed line for a shot. The marks
   * close in as it comes due, so timing a dodge needs no number.
   */
  private drawTelegraph(ctx: CanvasRenderingContext2D, e: IWorldEntity, ox: number, oz: number, now: number) {
    const t = e.telegraph;
    if (!t) return;
    const left = Math.max(0, (t.until - now) / Math.max(1, t.until - t.startedAt));
    const x = snap(e.position.x - ox), y = snap(e.position.y - oz);
    ctx.fillStyle = this.color(Role.THREAT, 4);
    if (t.delivery === 'ranged') {
      // The fight's shapes: every lane its volley will fly, dashed, drawn out as it comes due
      for (const shot of volleyShots((t.volley ?? 'single') as Volley)) {
        const a = t.angle + shot.offset;
        for (let d = 24; d < 24 + 120 * (1 - left); d += 12) {
          ctx.fillRect(snap(x + Math.cos(a) * d) - 2, snap(y + Math.sin(a) * d) - 2, 4, 4);
        }
      }
      return;
    }
    if (t.delivery === 'area' || t.delivery === 'aura') {
      const marks = 16;
      for (let i = 0; i < marks; i++) {
        if (i % 2 === 1) continue;
        const a = (i / marks) * Math.PI * 2;
        ctx.fillRect(snap(x + Math.cos(a) * t.reachPx) - 3, snap(y + Math.sin(a) * t.reachPx) - 3, 6, 6);
      }
      const r = t.reachPx * (1 - left);
      for (let i = 0; i < marks; i++) {
        const a = (i / marks) * Math.PI * 2;
        ctx.fillRect(snap(x + Math.cos(a) * r) - 1, snap(y + Math.sin(a) * r) - 1, 2, 2);
      }
      return;
    }
    if (t.shape) {
      // The fight's shapes: the ground the blow will cover, its edge broken and its inside filling from the body
      // outward as it comes due: told from your own solid blow by the broken edge, never by hue alone
      const edge = shapeMarks({ ...t.shape, innerPx: Math.max(t.shape.innerPx, t.shape.reachPx - 1) }, e.position, t.angle, 6);
      edge.forEach((m, i) => { if (i % 2 === 0) ctx.fillRect(snap(m.x - ox) - 2, snap(m.y - oz) - 2, 4, 4); });
      const filled = t.shape.innerPx + (t.shape.reachPx - t.shape.innerPx) * (1 - left);
      for (const m of shapeMarks(t.shape, e.position, t.angle, 10)) {
        if (Math.hypot(m.x - e.position.x, m.y - e.position.y) <= filled) ctx.fillRect(snap(m.x - ox) - 1, snap(m.y - oz) - 1, 2, 2);
      }
    }
    const r = snap(16 + 24 * left);
    [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sy]) => {
      ctx.fillRect(x + sx * r - (sx > 0 ? 8 : 0), y + sy * r - (sy > 0 ? 2 : 0), 8, 2);
      ctx.fillRect(x + sx * r - (sx > 0 ? 2 : 0), y + sy * r - (sy > 0 ? 8 : 0), 2, 8);
    });
  }

  /**
   * Part 2: your own wind-up, solid like your blow, told from a creature's by being whole where theirs is broken.
   * A draw is a line out from you along your aim with a bar across its tip that steps out as it fills; a swing is
   * its shape's far edge, traced from one side to the other as it comes due.
   */
  private drawWindup(ctx: CanvasRenderingContext2D, w: NonNullable<FieldScene['windup']>, ox: number, oz: number) {
    ctx.fillStyle = this.color(Role.SIGNAL, 4);
    if (w.kind === 'draw') {
      const reach = 14 + 46 * w.fill;
      for (let d = 14; d <= reach; d += 4) ctx.fillRect(snap(w.x + Math.cos(w.angle) * d - ox) - 1, snap(w.y + Math.sin(w.angle) * d - oz) - 1, 2, 2);
      const tx = w.x + Math.cos(w.angle) * reach, ty = w.y + Math.sin(w.angle) * reach;
      for (const side of [-1, 1]) for (let k = 1; k <= 3; k++) {
        const a = w.angle + side * Math.PI / 2;
        ctx.fillRect(snap(tx + Math.cos(a) * k * 2 - ox) - 1, snap(ty + Math.sin(a) * k * 2 - oz) - 1, 2, 2);
      }
      return;
    }
    if (!w.shape) return;
    const edge = shapeMarks({ ...w.shape, innerPx: Math.max(w.shape.innerPx, w.shape.reachPx - 1) }, { x: w.x, y: w.y }, w.angle, 5);
    const shown = Math.ceil(edge.length * w.fill);
    for (let i = 0; i < shown; i++) ctx.fillRect(snap(edge[i].x - ox) - 1, snap(edge[i].y - oz) - 1, 2, 2);
  }

  /** Pips under a wounded enemy: count and position carry the reading, not hue. */
  private drawHealth(ctx: CanvasRenderingContext2D, e: IWorldEntity, x: number, y: number, w: number) {
    const max = (MOB_DEFINITIONS[e.definitionId]?.baseHealth ?? 0) + (e.bonusHealth ?? 0);
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
    if (f.kind === 'stagger') {
      // Part 2: a hit felt is a streak behind the body, back toward what struck it; a broken wind-up adds a cross
      if (age > STAGGER_MARK_MS) return;
      const len = Math.hypot(f.dx ?? 0, f.dy ?? 0) || 1;
      const ux = (f.dx ?? 0) / len, uy = (f.dy ?? 0) / len;
      ctx.fillStyle = this.color(Role.SIGNAL, 3);
      for (let k = 1; k <= 3; k++) ctx.fillRect(snap(x - ux * (8 + k * 5)) - 1, snap(y - uy * (8 + k * 5)) - 1, 2, 2);
      if (f.broke) {
        ctx.fillStyle = this.color(Role.LOSS, 4);
        for (let k = -2; k <= 2; k++) {
          ctx.fillRect(x + k * 2 - 1, y - 18 + k * 2 - 1, 2, 2);
          ctx.fillRect(x + k * 2 - 1, y - 18 - k * 2 - 1, 2, 2);
        }
      }
      return;
    }
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
