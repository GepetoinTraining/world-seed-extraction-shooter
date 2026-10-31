/**
 * THE PIPELINE HARNESS (Wave 10E.4 — D20), dev-time.
 *
 * Run it with:   npx vite-node scripts/run-affix-batch.ts
 * Or against a candidate batch file (a JSON IAffixBatch) before shipping it:
 *                npx vite-node scripts/run-affix-batch.ts path/to/batch.json
 *
 * What a batch run looks like end to end:
 *   1. an LLM agent run produces a batch — a NAMES run themed to the biomes,
 *      or an EFFECTS run defining names already banked (the shipped runs in
 *      src/entities/generation/packs/affixBatches.ts were authored exactly so)
 *   2. THIS harness validates it against the bank's accumulated entries —
 *      the same law the game runs (AffixBank.validateBatch): a names run banks
 *      names only, effects define banked names once, and D22's partition
 *      refuses the WHOLE batch if a mental stat touches anything but a frame
 *   3. a lawful batch is appended to AFFIX_BATCHES and shipped; the pack
 *      version rises by one; the game signs it into the CONTENT namespace at
 *      hub load; worlds minted from then on pin the new version
 *   4. worlds minted before it never see it — the determinism one-way door.
 *
 * The harness never edits files itself: it is the gate, not the pen.
 */

import { readFileSync } from 'node:fs';
import { AffixBank } from '../src/logic/content/AffixBank';
import { AFFIX_BATCHES } from '../src/entities/generation/packs/affixBatches';
import { fnv1a } from '../src/logic/economy/CompositionSystem';
import { IAffixBatch } from '../types';

const candidatePath = process.argv[2];

console.log('WORLD SEED // AFFIX BATCH HARNESS (D20)');
console.log('---------------------------------------');

// 1. The shipped batches must hold their own law, version by version.
let entries: ReturnType<typeof AffixBank.current>['entries'] = [];
for (let i = 0; i < AFFIX_BATCHES.length; i++) {
  const batch = AFFIX_BATCHES[i];
  const verdict = AffixBank.validateBatch(batch, entries);
  if (!verdict.ok) {
    console.error(`REFUSED  v${i + 1} ${batch.runId}: ${verdict.reason}`);
    process.exit(1);
  }
  const pack = AffixBank.packAt(i + 1)!;
  entries = pack.entries;
  const defined = entries.filter(e => e.statModifiers).length;
  console.log(`BANKED   v${pack.version} ${batch.runId} (${batch.kind}, ${batch.model}) — ${entries.length} entries, ${defined} defined, hash ${fnv1a(JSON.stringify(pack))}`);
}

// 2. A candidate batch, if one was offered, is judged against the full bank.
if (candidatePath) {
  const candidate = JSON.parse(readFileSync(candidatePath, 'utf-8')) as IAffixBatch;
  const verdict = AffixBank.validateBatch(candidate, AffixBank.current().entries);
  if (!verdict.ok) {
    console.error(`REFUSED  candidate ${candidate.runId}: ${verdict.reason}`);
    process.exit(1);
  }
  console.log(`LAWFUL   candidate ${candidate.runId} (${candidate.kind}) — append it to AFFIX_BATCHES to ship v${AffixBank.version() + 1}`);
} else {
  console.log(`CURRENT  pack "${AffixBank.current().name}" v${AffixBank.version()} — the next world minted pins it`);
  console.log(`PURGED   from the legacy pool (D22): ${AffixBank.purgedLegacyIds().join(', ') || 'nothing'}`);
}
