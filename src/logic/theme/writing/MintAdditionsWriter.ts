/**
 * WHAT A MINTING ADDS, ASKED AND KEPT (IB). The rule is `MintAdditions`; this asks the door, keeps what stands with
 * the world, banks it so later worlds can select it, and lays it over a world as it opens.
 *
 * One ask for the whole minting, asked again once if part of it was refused (`MINT_ASK_TRIES`): a world costs two
 * calls at most. Whatever is still unanswered, or everything when the door does not answer (no key, no network), uses
 * a base it was offered, so a world with no key still mints. It is written before the world is first opened, so its
 * land is the same at every opening.
 */

import { VectorNamespace, VectorStore } from '../../../../shared/entities/data/VectorStore';
import { BIOME_RESOURCES, RESOURCE_DEFINITIONS, ResourceDef } from '../../../../shared/entities/item/data/resourceDefinitions';
import { ItemDefinition } from '../../../../shared/entities/item/data/itemDefinitions';
import { WebBank } from '../../../../shared/logic/content/WebBank';
import { schemaProblem } from '../../../../shared/logic/content/SchemaFit';
import { ContentRegistry } from '../../../../shared/logic/theme/ContentRegistry';
import { GearKind, IThemePack } from '../../../../shared/logic/theme/ThemeTypes';
import { CountedPull, poolOf } from '../../../../shared/logic/theme/writing/WorldPool';
import { IMintBatch, IOfferedBase, MINT_ADDITIONS_FROM_GROUND, MINT_ASK_TRIES, MINT_SCHEMA, MintAdditions, WorldBases } from '../../../../shared/logic/theme/writing/MintAdditions';
import { IntelligenceClient } from '../../intelligence/IntelligenceClient';

export interface IMintOutcome { status: string; data?: unknown; reason?: string }
export type BasesDoor = (ask: unknown) => Promise<IMintOutcome>;

/** What one world's minting added, as it is banked: the world, its pack, and when. */
export interface IStoredMint { worldUid: string; themeId: string; writtenAt: number; batch: IMintBatch }

export const MINT_CONTENT_TYPE = 'MINT_ADDITIONS';
const docId = (worldUid: string) => `mint_${worldUid}`;

export const MintStore = {
  async save(stored: IStoredMint): Promise<void> {
    await VectorStore.saveContent(docId(stored.worldUid), MINT_CONTENT_TYPE, JSON.parse(JSON.stringify(stored)), `${stored.themeId}`);
  },
  async load(worldUid: string): Promise<IStoredMint | null> {
    const doc = await VectorStore.get<{ content?: IStoredMint }>(VectorNamespace.CONTENT, docId(worldUid));
    return doc?.data?.content?.batch ? doc.data.content : null;
  },
  /** Every world's additions this hub holds: the stored content a later minting pulls from. */
  async all(): Promise<IStoredMint[]> {
    return (await VectorStore.searchContent<IStoredMint>(MINT_CONTENT_TYPE).catch(() => [])).filter(m => m?.batch);
  }
};

/** A world's additions read as a field of the pool, beside its pack. */
export function storedAsPack(stored: IStoredMint): IThemePack | null {
  const pack = ContentRegistry.get(stored.themeId);
  if (!pack) return null;
  return {
    ...pack, themeId: stored.batch.scope, writtenAt: stored.writtenAt,
    tags: [], creatures: [], stations: [], goods: [], consumables: [], affixes: [], abilities: [], lore: [],
    junk: undefined, anchors: undefined, professions: undefined, terrain: undefined,
    gear: stored.batch.bases, materials: stored.batch.materials
  };
}

/** What other worlds added, pulled by meaning near this world, by slot. Nothing stored offers nothing. */
export async function storedOffer(pack: IThemePack, stored: IStoredMint[]): Promise<(slot: GearKind) => IOfferedBase[]> {
  const packs = stored.map(storedAsPack).filter((p): p is IThemePack => !!p);
  if (packs.length === 0) return () => [];
  const offered = await new CountedPull(poolOf(packs)).offer('gear', `${pack.name}. ${pack.premise}`);
  const bySlot = new Map<string, IOfferedBase[]>();
  for (const e of offered) {
    const entry = e.entry as unknown as IThemePack['gear'][number];
    if (!entry?.kind) continue;
    bySlot.set(entry.kind, [...(bySlot.get(entry.kind) ?? []), { id: e.id, name: entry.name, blurb: entry.blurb, entry }]);
  }
  return slot => bySlot.get(slot) ?? [];
}

const registeredWord = (tag: string) => WebBank.current().tags.some(t => t.tag === tag && !t.retired);

export const MintAdditionsWriter = {
  /** Ask, judge, fall back. Never throws: a world mints whatever the door does. */
  async write(worldUid: string, pack: IThemePack, seed: string, door: BasesDoor,
    opts: { stored?: (slot: GearKind) => IOfferedBase[]; registered?: (tag: string) => boolean } = {}): Promise<IMintBatch> {
    const registered = opts.registered ?? registeredWord;
    const first = MintAdditions.askOf(pack, seed, opts.stored);
    let ask = first;
    let held: Pick<IMintBatch, 'bases' | 'materials'> = { bases: [], materials: [] };
    const uses: IMintBatch['uses'] = [];
    let calls = 0;
    for (let attempt = 0; attempt < MINT_ASK_TRIES; attempt++) {
      calls++;
      let out: IMintOutcome;
      try { out = await door(ask); } catch (e) { out = { status: 'OFFLINE', reason: e instanceof Error ? e.message : String(e) }; }
      if (out.status !== 'OK' || out.data === undefined) break;
      const shape = schemaProblem(MINT_SCHEMA, out.data);
      if (shape) {
        ask = MintAdditions.askOf(pack, seed, opts.stored, shape, new Set(ask.rolls.map(r => r.roll)), ask.materials.atLeast);
        continue;
      }
      const verdict = MintAdditions.judge(pack, ask, out.data, registered, held);
      held = { bases: verdict.bases, materials: verdict.materials };
      uses.push(...verdict.uses);
      if (!verdict.reason) break;
      ask = MintAdditions.askOf(pack, seed, opts.stored, verdict.reason, new Set(verdict.unanswered), verdict.short);
    }
    // What still stands unanswered uses a base it was offered
    const answered = new Set(uses.map(u => u.roll));
    uses.push(...MintAdditions.fallbackUses(seed, first.rolls.filter(r => !answered.has(r.roll))));
    uses.sort((a, b) => a.roll - b.roll);
    const added = held.bases.length + held.materials.length > 0;
    return { scope: MintAdditions.scopeOf(worldUid), bases: held.bases, materials: held.materials, uses, by: added ? 'model' : 'fallback', calls };
  },

  /** At a minting: asked through this player's door, kept with the world and banked for later worlds. */
  async forWorld(worldUid: string, themeId: string, seed: string, door: BasesDoor = ask => IntelligenceClient.writeBases(ask)): Promise<IMintBatch | null> {
    const pack = ContentRegistry.get(themeId);
    if (!pack) return null;
    const stored = await storedOffer(pack, await MintStore.all());
    const batch = await MintAdditionsWriter.write(worldUid, pack, seed, door, { stored });
    await MintStore.save({ worldUid, themeId, writtenAt: Date.now(), batch }).catch(e => console.error('[MINT] What the minting added did not land:', e));
    return batch;
  },

  /**
   * Opening a world: from its ground on, its found pieces roll a slot and take a noun among its pack's bases and what
   * its minting added, and its land holds the materials its minting added. A world laid before adds nothing.
   * Hands back the materials to lay, so the chunks are built from them.
   */
  async enter(card: { id: string; themeId?: string; groundVersion?: number }): Promise<ResourceDef[]> {
    const themeId = ContentRegistry.standing(card.themeId);
    const pack = ContentRegistry.get(themeId);
    if (!pack || (card.groundVersion ?? 1) < MINT_ADDITIONS_FROM_GROUND) { WorldBases.enter(null); return []; }
    const own = ContentRegistry.compiled(themeId)?.items;
    const packBases: ItemDefinition[] = own ? [...own.weapon_bases, ...own.armor_bases, ...own.tool_bases] : [];
    const stored = await MintStore.load(card.id).catch(() => null);
    const compiled = stored && stored.themeId === themeId ? MintAdditions.compile(pack, stored.batch) : { bases: [], resources: [] };
    // Its materials join the tables everything reads, under its scope, as what a world grows does; only this world lays them
    for (const def of compiled.resources) {
      RESOURCE_DEFINITIONS[def.id] = def;
      for (const biome of def.habitat ?? []) {
        const table = (BIOME_RESOURCES[biome] ??= []);
        if (!table.includes(def.id)) table.push(def.id);
      }
    }
    WorldBases.enter(MintAdditions.basesBySlot(packBases, compiled.bases));
    return compiled.resources;
  }
};
