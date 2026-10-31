/**
 * One inspect card for everything: what it is, what you know of it, what you would
 * need to act on it. What can be done is asked of the game's own InteractionEngine;
 * the card only explains the answer. Hover and keyboard share one target list.
 */

import { IItem, IPlayer, InteractionType } from '../../../types';
import { InteractionEngine } from '../../entities/interaction/InteractionEngine';
import { MOB_DEFINITIONS } from '../../entities/mob/data/mobDefinitions';
import { RESOURCE_DEFINITIONS } from '../../entities/item/data/resourceDefinitions';
import { EntityType, IWorldEntity } from '../../entities/world/types';
import { QUALITY_NAMES, qualityBand } from './atoms';
import { LAYER } from './world';

export interface Card {
  title: string;
  rows: [string, string][];
  needs: string[];
  canAct: boolean;
  compact: string;
}

export interface InspectContext {
  player: IPlayer;
  dist: number;
  level: (definitionId: string) => number;
}

const COMPACT_MAX = 36;
const HARVEST_RANGE = 3;
const EXIT_RANGE = 3;
const PROPERTY_NAMES: Record<string, string> = {
  DENSITY: 'Density', HARDNESS: 'Hardness', CONDUCTIVITY: 'Conductivity', RESONANCE: 'Resonance',
  LUMINOSITY: 'Luminosity', TOXICITY: 'Toxicity', ELASTICITY: 'Elasticity'
};

const toolPower = (item: IItem) => item.stats['mining_power'] || item.stats['chopping_power'] || 0;
const words = (tags: string[]) => tags.map(t => t.replace(/_/g, ' ')).join(', ').replace(/, ([^,]*)$/, ' or $1');

function compact(title: string, tail: string): string {
  const room = COMPACT_MAX - tail.length - 3;
  return `${title.length > room ? `${title.slice(0, room - 1)}.` : title} · ${tail}`;
}

function inspectResource(e: IWorldEntity, ctx: InspectContext): Card {
  const def = RESOURCE_DEFINITIONS[e.definitionId] as any;
  const level = ctx.level(e.definitionId);
  const config = def?.harvestConfig;
  const uses = e.usesRemaining ?? def?.uses ?? 1;
  const canAct = InteractionEngine.getAvailableInteractions(ctx.player, e, ctx.dist).some(o => o.type === InteractionType.HARVEST);

  const needs: string[] = [];
  if (uses <= 0) needs.push(def?.regrowMs ? 'Spent, will return' : 'Spent, never returns');
  else if (config) {
    const required: string[] = config.requiredToolTags;
    if (required.length > 0) {
      const tools = (ctx.player.currentSession?.inventory || []).filter(i =>
        required.some(t => i.toolData?.toolTags.includes(t) || (i.tags || []).includes(t) || i.name.toLowerCase().includes(t)));
      const best = tools.reduce((n, t) => Math.max(n, toolPower(t)), 0);
      if (tools.length === 0) needs.push(level >= 1 ? `Needs ${words(required)}` : 'Needs a tool');
      else if (best < config.minToolPower) needs.push(level >= 1 ? `Needs power ${config.minToolPower}, yours ${best}` : 'Needs a stronger tool');
    }
    if (ctx.dist >= HARVEST_RANGE) needs.push('Move closer');
  }

  const rows: [string, string][] = [];
  if (level <= 0) rows.push(['Known', 'Nothing yet. Study it to learn']);
  else {
    rows.push(['Rank', String(def.rank)]);
    if (def.uses) rows.push(['Left', `${Math.max(0, uses)} of ${def.uses}`]);
    if (config) rows.push(['Cost', `${config.energyCost} energy, ${config.baseTimeSeconds}s`]);
  }
  if (level >= 2) {
    Object.entries(def.materialProps || {}).forEach(([k, v]) => rows.push([PROPERTY_NAMES[k] || k, String(v)]));
  }

  const title = level <= 0 ? 'Unknown Substance' : def.name;
  const lacksTool = needs.some(n => n.startsWith('Needs'));
  const tail = canAct ? 'ready' : uses <= 0 ? 'spent' : lacksTool ? (needs[0].includes('ower') ? 'weak tool' : 'needs tool') : 'too far';
  return { title, rows, needs, canAct, compact: compact(title, tail) };
}

function inspectMob(e: IWorldEntity): Card {
  const def = MOB_DEFINITIONS[e.definitionId] as any;
  const title = def?.name || 'Unknown Contact';
  const max = def?.baseHealth ?? 0;
  const health = e.health ?? max;
  const rows: [string, string][] = [['Rank', String(e.rank)], ['Health', `${health} of ${max}`]];
  if (def?.size) rows.push(['Size', String(def.size)]);
  if (def?.behavior) rows.push(['Behavior', String(def.behavior)]);
  return { title, rows, needs: [], canAct: false, compact: compact(title, `${e.rank} ${health}/${max}`) };
}

function inspectOther(e: IWorldEntity, ctx: InspectContext): Card {
  const canAct = InteractionEngine.getAvailableInteractions(ctx.player, e, ctx.dist).length > 0;
  switch (e.type) {
    case EntityType.NPC: {
      const npc = e.npc;
      const title = npc?.name || 'Unknown Figure';
      const rows: [string, string][] = npc ? [['Regard', `${npc.disposition} of 100`], ['Wants', String(npc.want)]] : [];
      return { title, rows, needs: canAct ? [] : ['Move closer'], canAct, compact: compact(title, canAct ? 'talk' : 'too far') };
    }
    case EntityType.CONTAINER: {
      const looted = !!e.container?.looted;
      const title = e.definitionId === 'ground_cache' ? 'Ground Cache' : 'Chest';
      const needs = looted ? ['Already emptied'] : canAct ? [] : ['Move closer'];
      return { title, rows: [['Rank', String(e.container?.lootRank ?? e.rank)]], needs, canAct, compact: compact(title, looted ? 'empty' : canAct ? 'ready' : 'too far') };
    }
    case EntityType.EXTRACTION: {
      const near = ctx.dist < EXIT_RANGE;
      return { title: 'Exit', rows: [['Channel', '5s, broken by damage']], needs: near ? [] : ['Move closer'], canAct: near, compact: compact('Exit', near ? 'channel 5s' : 'too far') };
    }
    case EntityType.STRUCTURE:
      return { title: 'Ruin', rows: [['Rank', String(e.rank)]], needs: [], canAct: false, compact: compact('Ruin', String(e.rank)) };
    default:
      return { title: 'Unknown', rows: [], needs: [], canAct: false, compact: 'Unknown' };
  }
}

export function inspectEntity(e: IWorldEntity, ctx: InspectContext): Card {
  if (e.type === EntityType.RESOURCE) return inspectResource(e, ctx);
  if (e.type === EntityType.MOB) return inspectMob(e);
  return inspectOther(e, ctx);
}

/** `Broken` names low quality in the factory and zero durability in the pack; only the second keeps the word. */
export function inspectItem(item: IItem): Card {
  if (item.isIdentified === false) {
    return { title: 'Unidentified Signal', rows: [['Known', 'Nothing yet']], needs: [], canAct: false, compact: 'Unidentified Signal' };
  }
  const title = item.name.replace(/\bBroken\b/, QUALITY_NAMES[0]);
  const rows: [string, string][] = [['Rarity', String(item.rarity)], ['Rank', String(item.rank)]];
  const q = (item as any).quality as number | undefined;
  if (q !== undefined && Math.abs(q) <= 1) {
    rows.push(['Quality', `${QUALITY_NAMES[qualityBand(q)]} ${q >= 0 ? '+' : ''}${Math.round(q * 100)}%`]);
  }
  const { durability, maxDurability } = item.stats as Record<string, number>;
  if (maxDurability) rows.push(['Durability', durability === 0 ? `Broken, 0 of ${maxDurability}` : `${durability} of ${maxDurability}`]);
  rows.push(['Weight', `${item.weight} kg`]);
  Object.entries(item.stats).forEach(([k, v]) => {
    if (!['durability', 'maxDurability', 'weight'].includes(k)) rows.push([k.replace(/_/g, ' '), String(v)]);
  });
  (item.affixes || []).forEach(a => rows.push(['Affix', a.name]));
  return { title, rows, needs: [], canAct: false, compact: compact(title, String(item.rank)) };
}

// ---------------------------------------------------------------------------
// Targets: the same list answers the cursor and the keyboard.
// ---------------------------------------------------------------------------

export interface Target { id: string; x: number; y: number; hw: number; hh: number; layer: number }

export function targetsFrom(things: { id: string; type: EntityType; x: number; y: number; w: number; h: number }[]): Target[] {
  return things.map(t => ({ id: t.id, x: t.x, y: t.y, hw: t.w >> 1, hh: t.h >> 1, layer: LAYER[t.type] ?? 0 }));
}

const under = (t: Target, x: number, y: number) => Math.abs(t.x - x) <= t.hw && Math.abs(t.y - y) <= t.hh;
const dist2 = (t: Target, x: number, y: number) => (t.x - x) * (t.x - x) + (t.y - y) * (t.y - y);

/** Threats first, then the nearest center. A target still under the cursor is kept, so the card does not flicker as things move. */
export function hitTest(targets: Target[], x: number, y: number, current?: string | null): string | null {
  let best: Target | null = null;
  for (const t of targets) {
    if (!under(t, x, y)) continue;
    if (t.id === current) return t.id;
    if (!best || t.layer > best.layer || (t.layer === best.layer &&
      (dist2(t, x, y) < dist2(best, x, y) || (dist2(t, x, y) === dist2(best, x, y) && t.id < best.id)))) best = t;
  }
  return best ? best.id : null;
}

/** The next target by distance from the player, wrapping. */
export function cycleTarget(targets: Target[], from: { x: number; y: number }, current: string | null, radius: number): string | null {
  const near = targets
    .filter(t => dist2(t, from.x, from.y) <= radius * radius)
    .sort((a, b) => dist2(a, from.x, from.y) - dist2(b, from.x, from.y) || (a.id < b.id ? -1 : 1));
  if (near.length === 0) return null;
  const at = near.findIndex(t => t.id === current);
  return near[(at + 1) % near.length].id;
}
