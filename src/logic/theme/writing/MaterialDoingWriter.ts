/**
 * WHAT A MATERIAL DOES, ASKED AND KEPT (ML21). The rule is `MaterialDoing`; this asks the door the first time anyone
 * needs it, keeps what stands, and stores it by the material, so every world that uses the material reads the same.
 *
 * Pedro, 2026-11-12: "once something exists it's determined". So a material asked again is never asked: what was written
 * is read, from memory or from the store. That holds for what was written with no key too: a key that arrives later does
 * not replace it. One ask, and once more told why if the law refused it; then, as with no key, the base's doing (written
 * first if it was not), or for a base its own, read from what it is made of.
 */

import { VectorNamespace, VectorStore } from '../../../../shared/entities/data/VectorStore';
import type { ResourceDef } from '../../../../shared/entities/item/data/resourceDefinitions';
import { SpreadBook } from '../../../../shared/entities/world/Spread';
import { ContentRegistry } from '../../../../shared/logic/theme/ContentRegistry';
import { DOING_ASK_TRIES, DoingBook, IMaterialDoing, MaterialDoing } from '../../../../shared/logic/systems/MaterialDoing';
import { schemaProblem } from '../../../../shared/logic/content/SchemaFit';
import { DOING_SCHEMA } from '../../../../shared/logic/systems/MaterialDoing';
import { IntelligenceClient } from '../../intelligence/IntelligenceClient';

export interface IDoingOutcome { status: string; data?: unknown; reason?: string }
export type DoingDoor = (ask: unknown) => Promise<IDoingOutcome>;

export const DOING_CONTENT_TYPE = 'MATERIAL_DOING';
const docId = (materialId: string) => `doing_${materialId}`;

export const DoingStore = {
  async save(doing: IMaterialDoing): Promise<void> {
    await VectorStore.saveContent(docId(doing.material), DOING_CONTENT_TYPE, JSON.parse(JSON.stringify(doing)), doing.material);
  },
  async load(materialId: string): Promise<IMaterialDoing | null> {
    const doc = await VectorStore.get<{ content?: IMaterialDoing }>(VectorNamespace.CONTENT, docId(materialId));
    return doc?.data?.content?.material === materialId ? doc.data.content : null;
  },
  async all(): Promise<IMaterialDoing[]> {
    return (await VectorStore.searchContent<IMaterialDoing>(DOING_CONTENT_TYPE).catch(() => [])).filter(d => d?.material && d.line);
  }
};

const defaultDoor: DoingDoor = ask => IntelligenceClient.writeDoing(ask);
/** A material being written right now: a second need waits for the first, so it is asked once. */
const pending = new Map<string, Promise<IMaterialDoing>>();

export const MaterialDoingWriter = {
  /** What a material does: what was written, or written now. Never throws, never rewrites. */
  need(def: ResourceDef, door: DoingDoor = defaultDoor): Promise<IMaterialDoing> {
    const held = DoingBook.of(def.id);
    if (held) return Promise.resolve(held);
    const already = pending.get(def.id);
    if (already) return already;
    const writing = (async () => {
      const stored = await DoingStore.load(def.id).catch(() => null);
      if (stored) return DoingBook.hold(stored);
      const written = await MaterialDoingWriter.write(def, door);
      // Stored only where nothing was stored meanwhile: the first written stands
      const meanwhile = await DoingStore.load(def.id).catch(() => null);
      if (meanwhile) return DoingBook.hold(meanwhile);
      const kept = DoingBook.hold(written);
      await DoingStore.save(kept).catch(e => console.error('[DOING] What a material does was not kept:', e));
      return kept;
    })();
    pending.set(def.id, writing);
    return writing.finally(() => pending.delete(def.id));
  },

  /** The ask, judged, once more if refused; then the base's, or its own. */
  async write(def: ResourceDef, door: DoingDoor): Promise<IMaterialDoing> {
    const pack = ContentRegistry.get(def.themeId) ?? ContentRegistry.get(ContentRegistry.defaultThemeId());
    let refused: string | undefined;
    for (let attempt = 0; attempt < DOING_ASK_TRIES; attempt++) {
      let out: IDoingOutcome;
      try { out = await door(MaterialDoing.askOf(def, pack, refused)); } catch (e) { out = { status: 'OFFLINE', reason: e instanceof Error ? e.message : String(e) }; }
      if (out.status !== 'OK' || out.data === undefined) break;
      const shape = schemaProblem(DOING_SCHEMA, out.data);
      if (shape) { refused = shape; continue; }
      const verdict = MaterialDoing.judge(out.data, def);
      if ('doing' in verdict) return verdict.doing;
      refused = verdict.reason;
    }
    const base = SpreadBook.of(def.id).base;
    if (base && base.id !== def.id) return MaterialDoing.fromBase(def, await MaterialDoingWriter.need(base, door));
    return MaterialDoing.fromOwn(def);
  },

  /** A world opening: what every material this game has met already does, read into the cards' book. */
  async enter(): Promise<void> {
    for (const doing of await DoingStore.all()) DoingBook.hold(doing);
  }
};
