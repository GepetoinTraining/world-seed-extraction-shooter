/**
 * THE AFFIX BANK (Wave 10E.1 / 10E.4 — D20, bound by D22)
 *
 * Per-biome, per-theme AFFIX and SUFFIX banks, grown by batched agent runs:
 * a run banks NAMES; a later run defines their EFFECTS; every batch folds into
 * a signed, versioned content pack. A world pins the pack version at mint, so
 * added content never changes an existing world (the determinism one-way door).
 *
 * The law, asked of every batch and refused WHOLE when broken:
 *  - a NAMES run banks names only — no entry in it carries stats
 *  - an EFFECTS run defines only names already banked, each at most once
 *  - D22, the partition: a mental stat rides ONLY an entry scoped exactly
 *    ['frame']; a batch that puts mental stats on physical gear is refused
 *    whole, clean entries falling with it — the bank does not bargain
 *
 * The same partition purges the legacy pool: the Owl-family mental-stat
 * affixes stop rolling the day this file loads. Gear already carrying them
 * keeps wearing; its mental line was already dead (10C, D22).
 */

import { IAffixBatch, IBankedAffix, IContentPack, MENTAL_ATTRIBUTES } from '../../types';
import { AFFIX_DEFINITIONS, AffixDefinition } from '../../entities/item/data/affixDefinitions';
import { AFFIX_BATCHES } from '../../entities/generation/packs/affixBatches';
import { StatSystem } from '../systems/StatSystem';

export interface BankVerdict {
  ok: boolean;
  reason?: string;
}

const OK: BankVerdict = { ok: true };
const no = (reason: string): BankVerdict => ({ ok: false, reason });

const MENTAL = new Set<string>(MENTAL_ATTRIBUTES as readonly string[]);

/** One name per version. A pinned world's pack keeps its name with its bytes. */
const PACK_NAMES = ['The First Naming', 'The Naming, Given Teeth', 'The Working, Named', 'The Working, Given Hands'];

const mentalIn = (mods: Record<string, [number, number]> | Record<string, number> | undefined): string | undefined =>
  Object.keys(mods ?? {}).find(k => MENTAL.has(k));

export class AffixBank {

  // ---------------------------------------------------------------------
  // THE LAW: one batch, validated against what the bank already holds
  // ---------------------------------------------------------------------

  static validateBatch(batch: IAffixBatch, prior: IBankedAffix[]): BankVerdict {
    if (batch.kind === 'NAMES') {
      const names = batch.names ?? [];
      if (names.length === 0) return no(`Batch ${batch.runId} banks nothing. An empty run is not a run.`);
      const seen = new Set(prior.map(e => e.id));
      for (const entry of names) {
        if (!entry.id || !entry.name?.trim()) return no(`Batch ${batch.runId}: an entry with no name cannot be banked.`);
        if ((entry as IBankedAffix).statModifiers) {
          return no(`Batch ${batch.runId} refused whole: ${entry.id} carries stats, and a names run banks names. Effects are a later run's work.`);
        }
        if (seen.has(entry.id)) return no(`Batch ${batch.runId} refused whole: ${entry.id} is already banked. The first keeps its claim.`);
        if (!entry.allowedTags || entry.allowedTags.length === 0) {
          return no(`Batch ${batch.runId} refused whole: ${entry.id} names nothing it may roll on.`);
        }
        seen.add(entry.id);
      }
      return OK;
    }

    // EFFECTS: defines banked names, each at most once, under the partition
    const effects = batch.effects ?? [];
    if (effects.length === 0) return no(`Batch ${batch.runId} defines nothing. An empty run is not a run.`);
    const bank = new Map(prior.map(e => [e.id, e]));
    const defined = new Set<string>();
    for (const effect of effects) {
      const entry = bank.get(effect.id);
      if (!entry) return no(`Batch ${batch.runId} refused whole: ${effect.id} was never banked. Effects define names, not strangers.`);
      if (defined.has(effect.id)) return no(`Batch ${batch.runId} refused whole: ${effect.id} is defined twice in one run.`);
      if (entry.statModifiers) return no(`Batch ${batch.runId} refused whole: "${entry.name}" already has its effect. The record stands.`);
      const mods = effect.statModifiers ?? {};
      if (Object.keys(mods).length === 0) return no(`Batch ${batch.runId} refused whole: ${effect.id} defines nothing.`);
      for (const [stat, range] of Object.entries(mods)) {
        if (!Array.isArray(range) || range.length !== 2 || range.some(v => typeof v !== 'number' || !Number.isFinite(v))) {
          return no(`Batch ${batch.runId} refused whole: ${effect.id}'s ${stat} is not a range.`);
        }
        if (range[0] > range[1]) return no(`Batch ${batch.runId} refused whole: ${effect.id}'s ${stat} runs backward.`);
        // Line 77: a stat nothing reads is a lie on a card
        if (!StatSystem.isRead(stat)) return no(`Batch ${batch.runId} refused whole: ${effect.id} rolls ${stat}, and nothing in the game reads ${stat}.`);
      }
      // D22 — THE PARTITION IS A BANK LAW
      const mental = mentalIn(mods);
      if (mental && !(entry.allowedTags.length === 1 && entry.allowedTags[0] === 'frame')) {
        return no(`Batch ${batch.runId} refused whole: "${entry.name}" promises ${mental.toUpperCase()} on ${entry.allowedTags.join(', ')}, and gear doesn't think. A mental affix only ever rolls on a frame.`);
      }
      defined.add(effect.id);
    }
    return OK;
  }

  // ---------------------------------------------------------------------
  // COMPILING: batches fold into versions; any broken batch refuses the pack
  // ---------------------------------------------------------------------

  static compile(batches: IAffixBatch[]): { ok: boolean; reason?: string; pack?: IContentPack } {
    let entries: IBankedAffix[] = [];
    const folded: IContentPack['batches'] = [];
    for (const batch of batches) {
      const verdict = this.validateBatch(batch, entries);
      if (!verdict.ok) return { ok: false, reason: verdict.reason };
      if (batch.kind === 'NAMES') {
        entries = [...entries, ...(batch.names ?? []).map(n => ({ ...n }))];
      } else {
        const byId = new Map((batch.effects ?? []).map(e => [e.id, e.statModifiers]));
        entries = entries.map(e => byId.has(e.id) ? { ...e, statModifiers: byId.get(e.id) } : e);
      }
      folded.push({ runId: batch.runId, kind: batch.kind, model: batch.model, ranAt: batch.ranAt });
    }
    return {
      ok: true,
      pack: {
        packId: 'pack_affix_bank',
        version: folded.length,
        name: PACK_NAMES[Math.min(folded.length, PACK_NAMES.length) - 1],
        batches: folded,
        entries
      }
    };
  }

  /** The bank as of a version: the first `version` shipped batches, folded. */
  static packAt(version: number): IContentPack | null {
    if (version < 1 || version > AFFIX_BATCHES.length) return null;
    const result = this.compile(AFFIX_BATCHES.slice(0, version));
    return result.ok ? result.pack! : null;
  }

  /** The latest bank the shipped batches make. The shipped runs must be lawful. */
  static current(): IContentPack {
    const result = this.compile(AFFIX_BATCHES);
    if (!result.ok) throw new Error(`The shipped batches break their own law: ${result.reason}`);
    return result.pack!;
  }

  static version(): number {
    return AFFIX_BATCHES.length;
  }

  // ---------------------------------------------------------------------
  // THE PURGE (D22): the legacy pool loses its mental-stat contraband
  // ---------------------------------------------------------------------

  private static purged: { prefixes: AffixDefinition[]; suffixes: AffixDefinition[]; dropped: string[] } | null = null;

  private static purge() {
    if (this.purged) return this.purged;
    const clean = (pool: AffixDefinition[], dropped: string[]) => pool.filter(a => {
      const mental = mentalIn(a.statModifiers);
      if (mental) { dropped.push(a.id); return false; }
      return true;
    });
    const dropped: string[] = [];
    this.purged = {
      prefixes: clean(AFFIX_DEFINITIONS.prefixes, dropped),
      suffixes: clean(AFFIX_DEFINITIONS.suffixes, dropped),
      dropped
    };
    return this.purged;
  }

  /** The legacy pool, purged: what unpinned worlds and old keys still roll from. */
  static legacyPool(): { prefixes: AffixDefinition[]; suffixes: AffixDefinition[] } {
    const { prefixes, suffixes } = this.purge();
    return { prefixes, suffixes };
  }

  /** What the purge removed, on the record (the Owl family). */
  static purgedLegacyIds(): string[] {
    return [...this.purge().dropped];
  }
}
