/**
 * THE BANK OF WHO PEOPLE WERE. Batches validate or refuse whole, as every bank here does,
 * and growing it takes a batch, not code. The words it hides stay hidden by its own law:
 * a shown string that names them cannot be banked.
 */

import { IAttributes, MENTAL_ATTRIBUTES, PHYSICAL_ATTRIBUTES } from '../../../types';
import { IKit, IOrigin, IOriginBatch, IQuestion, KitSource, ORIGIN_BATCHES } from '../../entities/generation/packs/originBatches';
import { WebBank } from './WebBank';

export const SILHOUETTES = ['OPERATOR', 'STREET_SAMURAI', 'NOMAD', 'ARCANIST'] as const;
const KIT_SOURCES: readonly KitSource[] = ['weapon', 'armor', 'tool', 'carrier', 'wardrobe', 'consumable'];
const ATTRIBUTES = new Set<string>([...PHYSICAL_ATTRIBUTES, ...MENTAL_ATTRIBUTES] as (keyof IAttributes)[]);
const HIDDEN = /archetype|trope|isekai|reincarnat/i;

type Verdict = { ok: boolean; reason?: string };
const no = (reason: string): Verdict => ({ ok: false, reason });

let merged: { origins: IOrigin[]; kits: IKit[]; questions: IQuestion[]; closings: string[]; flavors: string[]; fateNames: string[]; fateLines: string[] } | null = null;

const all = () => {
  if (merged) return merged;
  merged = { origins: [], kits: [], questions: [], closings: [], flavors: [], fateNames: [], fateLines: [] };
  for (const batch of ORIGIN_BATCHES) {
    const verdict = OriginBank.validate(batch);
    if (!verdict.ok) {
      console.error(`[ORIGINS] Refused whole: ${batch.id}: ${verdict.reason}`);
      continue;
    }
    merged.origins.push(...batch.origins);
    merged.kits.push(...batch.kits);
    merged.questions.push(...batch.questions);
    merged.closings.push(...batch.closings);
    merged.flavors.push(...batch.flavors);
    merged.fateNames.push(...(batch.fateNames ?? []));
    merged.fateLines.push(...(batch.fateLines ?? []));
  }
  return merged;
};

export class OriginBank {

  static origins(): IOrigin[] { return all().origins; }
  static origin(id: string): IOrigin | undefined { return all().origins.find(o => o.id === id); }
  static kit(id: string): IKit | undefined { return all().kits.find(k => k.id === id); }
  static kits(): IKit[] { return all().kits; }
  static fateNames(): string[] { return all().fateNames; }
  static fateLines(): string[] { return all().fateLines; }
  static questions(): IQuestion[] { return all().questions; }
  static closings(): string[] { return all().closings; }
  static flavors(): string[] { return all().flavors; }

  /** Merged once and read many times. A batch added at run time calls this. */
  static reset(): void { merged = null; }

  static validate(batch: IOriginBatch): Verdict {
    const registered = (tag: string) => WebBank.current().tags.some(t => t.tag === tag);
    const kitIds = new Set([...ORIGIN_BATCHES.flatMap(b => b.kits), ...batch.kits].map(k => k.id));
    const shown: string[] = [...batch.closings, ...batch.flavors, ...(batch.fateNames ?? []), ...(batch.fateLines ?? [])];

    for (const o of batch.origins) {
      if (!o.id || !o.says?.trim() || !o.line?.trim()) return no(`${o.id || 'an origin'} has no words.`);
      if ((o.main === null) !== (o.sub === null)) return no(`${o.id} names one focus and not the other.`);
      if (o.main !== null && (!ATTRIBUTES.has(o.main) || !ATTRIBUTES.has(o.sub!))) return no(`${o.id} focuses on something that is not an attribute.`);
      if (o.main !== null && o.main === o.sub) return no(`${o.id} names the same focus twice.`);
      if (!(SILHOUETTES as readonly string[]).includes(o.silhouette)) return no(`${o.id} wears "${o.silhouette}", which is not one of the four.`);
      if (o.kits.length === 0) return no(`${o.id} carries nothing.`);
      const missing = o.kits.find(k => !kitIds.has(k));
      if (missing) return no(`${o.id} names a kit the bank does not hold: ${missing}.`);
      const stray = [...o.leans.main, ...o.leans.sub].find(t => !registered(t));
      if (stray) return no(`${o.id} leans on "${stray}", which is not registered.`);
      shown.push(o.says, o.line);
    }
    for (const k of batch.kits) {
      if (!k.id || !k.says?.trim() || !k.line?.trim()) return no(`${k.id || 'a kit'} has no words.`);
      if (k.pieces.length === 0) return no(`${k.id} holds nothing.`);
      for (const piece of k.pieces) {
        if (!KIT_SOURCES.includes(piece.from)) return no(`${k.id} asks for "${piece.from}".`);
        if (piece.tag && !registered(piece.tag)) return no(`${k.id} asks for "${piece.tag}", which is not registered.`);
      }
      shown.push(k.says, k.line);
    }
    for (const q of batch.questions) {
      if (!q.id || !q.asks?.trim()) return no(`${q.id || 'a question'} has no words.`);
      if (q.answers.length < 2) return no(`${q.id} leaves nothing to choose.`);
      for (const a of q.answers) {
        if (!a.id || !a.says?.trim()) return no(`An answer to ${q.id} has no words.`);
        const stray = a.leans.find(t => !registered(t));
        if (stray) return no(`${a.id} leans on "${stray}", which is not registered.`);
        shown.push(a.says);
      }
      shown.push(q.asks);
    }
    const told = shown.find(s => HIDDEN.test(s));
    if (told) return no(`"${told}" says what stays unsaid.`);
    return { ok: true };
  }
}
