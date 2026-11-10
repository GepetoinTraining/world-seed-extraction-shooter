/**
 * SPEECH BUBBLES (D114). Pedro: "speech bubbles over their head on occasion shows that to the
 * player, use gibberish as the font face."
 *
 * This is how a person learns which monsters can be talked to: they have been seen talking. When
 * one speaks and what it says are keyed on the body and the hour of the clock, so it reads the same
 * on any machine and nothing here touches a game's state. A bubble's shape and its tail say what
 * it is: nothing here leans on hue.
 */

import { MOB_DEFINITIONS } from '../../../shared/entities/mob/data/mobDefinitions';
import { EntityType, IChunk } from '../../../shared/entities/world/types';
import { MonsterMind } from '../../logic/systems/MonsterMind';
import { Rng } from '../../../shared/logic/rng/DeterministicRNG';
import { GIBBERISH_FAMILY } from './gibberishFace';
import { textScale } from '../../logic/settings/store';

/** Guesses until Wave 12. How often a body might speak, how often it does, and for how long. */
const BUBBLE_EVERY_MS = 6000;
const BUBBLE_CHANCE = 0.35;
const BUBBLE_SHOWS_MS = 2600;
const BUBBLE_FONT_PX = 11;
/** As drawn, times the text size the person asked for. */
const bubblePx = () => Math.round(BUBBLE_FONT_PX * textScale());
const BUBBLE_PAD = 5;
const BUBBLE_ABOVE_PX = 26;
const BUBBLE_TAIL_PX = 6;

const CONSONANTS = 'bdfgklmnprstvz';
const VOWELS = 'aeiou';

/** Pronounceable, keyed, and only ever drawn in a face that cannot be read. */
export function gibberish(key: string): string {
  const rng = Rng.fromKey(`speech:${key}`);
  const words = 1 + rng.int(0, 3);
  return Array.from({ length: words }, () => {
    const syllables = 1 + rng.int(0, 3);
    return Array.from({ length: syllables }, () => CONSONANTS[rng.int(0, CONSONANTS.length)] + VOWELS[rng.int(0, VOWELS.length)]).join('');
  }).join(' ');
}

/** One rolled answer per body per slot of the clock, so a frame hashes almost nothing. */
const said = new Map<string, { slot: number; text: string | null; shift: number }>();

export function bubbleOf(entityId: string, now: number): string | null {
  const shift = said.get(entityId)?.shift ?? Rng.fromKey(`speech:shift:${entityId}`).int(0, BUBBLE_EVERY_MS);
  const slot = Math.floor((now + shift) / BUBBLE_EVERY_MS);
  let held = said.get(entityId);
  if (!held || held.slot !== slot) {
    const speaks = Rng.fromKey(`speech:${entityId}:${slot}`).next() < BUBBLE_CHANCE;
    if (said.size > 2000) said.clear();
    held = { slot, shift, text: speaks ? gibberish(`${entityId}:${slot}`) : null };
    said.set(entityId, held);
  }
  const into = (now + shift) % BUBBLE_EVERY_MS;
  return held.text && into < BUBBLE_SHOWS_MS ? held.text : null;
}

/** Every speaker in view that is saying something, over its head. The camera is the field's own. */
export function drawSpeech(ctx: CanvasRenderingContext2D, chunks: IChunk[], camera: { x: number; z: number }, width: number, height: number, now: number): void {
  ctx.save();
  ctx.font = `${bubblePx()}px "${GIBBERISH_FAMILY}", monospace`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  for (const chunk of chunks) {
    for (const entity of chunk.entities) {
      if (entity.type !== EntityType.MOB || (entity.health ?? 0) <= 0) continue;
      const x = entity.position.x - camera.x + width / 2;
      const y = entity.position.y - camera.z + height / 2;
      if (x < 0 || y < 0 || x > width || y > height) continue;
      if (!MonsterMind.speaks(MOB_DEFINITIONS[entity.definitionId])) continue;
      const text = bubbleOf(entity.id, now);
      if (!text) continue;
      const w = Math.ceil(ctx.measureText(text).width) + BUBBLE_PAD * 2;
      const h = bubblePx() + BUBBLE_PAD * 2;
      const left = Math.round(x - w / 2);
      const top = Math.round(y - BUBBLE_ABOVE_PX - h);
      ctx.fillStyle = '#efefef';
      ctx.fillRect(left, top, w, h);
      ctx.beginPath();
      ctx.moveTo(x - BUBBLE_TAIL_PX, top + h);
      ctx.lineTo(x, top + h + BUBBLE_TAIL_PX);
      ctx.lineTo(x + BUBBLE_TAIL_PX, top + h);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#030303';
      ctx.lineWidth = 2;
      ctx.strokeRect(left, top, w, h);
      ctx.fillStyle = '#030303';
      ctx.fillText(text, x, top + h / 2 + 1);
    }
  }
  ctx.restore();
}

/** A line a person says, readable, as long as they are saying it. A guess until Wave 12. */
export const SAYING_SHOWS_MS = 3200;
const SAYING_FONT_PX = 12;
const sayingPx = () => Math.round(SAYING_FONT_PX * textScale());
const SAYING_WIDTH_PX = 190;

/**
 * Two people talking where somebody can see (Pedro: "bubble appear above the npcs heads"). People
 * speak words, so the face is a plain one, wrapped to a width. Shape and tail mark it, never hue.
 */
export function drawSaying(ctx: CanvasRenderingContext2D, text: string, x: number, headY: number): void {
  ctx.save();
  ctx.font = `${sayingPx()}px monospace`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(next).width > SAYING_WIDTH_PX) { lines.push(line); line = word; } else line = next;
  }
  if (line) lines.push(line);
  const w = Math.ceil(Math.max(...lines.map(l => ctx.measureText(l).width))) + BUBBLE_PAD * 2;
  const lineH = sayingPx() + 3;
  const h = lines.length * lineH + BUBBLE_PAD * 2;
  const left = Math.round(x - w / 2);
  const top = Math.round(headY - BUBBLE_TAIL_PX - h);
  ctx.fillStyle = '#efefef';
  ctx.fillRect(left, top, w, h);
  ctx.beginPath();
  ctx.moveTo(x - BUBBLE_TAIL_PX, top + h);
  ctx.lineTo(x, top + h + BUBBLE_TAIL_PX);
  ctx.lineTo(x + BUBBLE_TAIL_PX, top + h);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#030303';
  ctx.lineWidth = 2;
  ctx.strokeRect(left, top, w, h);
  ctx.fillStyle = '#030303';
  lines.forEach((l, i) => ctx.fillText(l, x, top + BUBBLE_PAD + lineH * i + lineH / 2));
  ctx.restore();
}
