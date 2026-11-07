/**
 * THE PIPELINE HARNESS (Wave 10E.4 — D20; D27 added the web's batches), dev-time.
 *
 * Run it with:   npx vite-node scripts/run-affix-batch.ts
 * Or against a candidate batch file (a JSON IAffixBatch or IWebBatch) before
 * shipping it:   npx vite-node scripts/run-affix-batch.ts path/to/batch.json
 *
 * What a batch run looks like end to end:
 *   1. an LLM agent run produces a batch — a NAMES run themed to the biomes, an
 *      EFFECTS run defining names already banked, or a WEB run adding tags, tools,
 *      materials, stations, recipes, designs and names (the shipped runs in
 *      src/entities/generation/packs/ were authored exactly so)
 *   2. THIS harness validates it against the bank's accumulated entries — the
 *      same law the game runs: AffixBank.validateBatch (a names run banks names
 *      only, effects define banked names once, and D22's partition refuses the
 *      WHOLE batch if a mental stat touches anything but a frame) or
 *      WebBank.validateBatch (D28's tag law, the same: one bad entry and it falls)
 *   3. a lawful batch is appended to its list and shipped; the pack version rises
 *      by one; the game signs it into the CONTENT namespace at hub load; worlds
 *      minted from then on pin the new version
 *   4. worlds minted before it never see it — the determinism one-way door.
 *
 * The harness never edits files itself: it is the gate, not the pen.
 */

import { readFileSync } from 'node:fs';
import { AffixBank } from '../shared/logic/content/AffixBank';
import { WebBank } from '../shared/logic/content/WebBank';
import { AFFIX_BATCHES } from '../shared/entities/generation/packs/affixBatches';
import { WEB_BATCHES } from '../shared/entities/generation/packs/webBatches';
import { fnv1a } from '../shared/logic/economy/CompositionSystem';
import { IAffixBatch, IWebBatch } from '../shared/types';

const candidatePath = process.argv[2];

// D53: a candidate theme stands before the same law. Pass a JSON theme body to judge it.
if (candidatePath) {
  const candidate = JSON.parse(readFileSync(candidatePath, 'utf8'));
  if (Array.isArray(candidate.creatures)) {
    const { ThemeLaw } = await import('../shared/logic/theme/ThemeLaw');
    const verdict = ThemeLaw.validate(candidate, tag => WebBank.current().tags.some(t => t.tag === tag));
    console.log(verdict.ok ? `LAWFUL   theme ${candidate.name}` : verdict.reason);
    process.exit(verdict.ok ? 0 : 1);
  }
}

console.log('WORLD SEED // AFFIX AND WEB BATCH HARNESS (D20)');
console.log('-----------------------------------------------');

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

for (let i = 0; i < WEB_BATCHES.length; i++) {
  const batch = WEB_BATCHES[i];
  const prior = i === 0 ? WebBank.compile([]).pack! : WebBank.packAt(i)!;
  const verdict = WebBank.validateBatch(batch, prior);
  if (!verdict.ok) {
    console.error(`REFUSED  web v${i + 1} ${batch.runId}: ${verdict.reason}`);
    process.exit(1);
  }
  const pack = WebBank.packAt(i + 1)!;
  console.log(`BANKED   web v${pack.version} ${batch.runId} (${batch.model}) — ${pack.tags.length} tags, ${pack.tools.length} tools, ${pack.stations.length} stations, ${pack.recipes.length} recipes, ${WebBank.connections(pack).length} connections, hash ${fnv1a(JSON.stringify(pack))}`);
}

const stray = WebBank.unregisteredTags(WebBank.current());
if (stray.length > 0) {
  console.error(`REFUSED  the tag law: ${stray.length} tag(s) in the definitions are not registered:\n  ${stray.join('\n  ')}`);
  process.exit(1);
}

// 2. A candidate batch, if one was offered, is judged against the full bank.
if (candidatePath) {
  const candidate = JSON.parse(readFileSync(candidatePath, 'utf-8')) as IAffixBatch | IWebBatch;
  const isAffix = (candidate as IAffixBatch).kind === 'NAMES' || (candidate as IAffixBatch).kind === 'EFFECTS';
  const verdict = isAffix
    ? AffixBank.validateBatch(candidate as IAffixBatch, AffixBank.current().entries)
    : WebBank.validateBatch(candidate as IWebBatch, WebBank.current());
  if (!verdict.ok) {
    console.error(`REFUSED  candidate ${candidate.runId}: ${verdict.reason}`);
    process.exit(1);
  }
  console.log(isAffix
    ? `LAWFUL   candidate ${candidate.runId} (${(candidate as IAffixBatch).kind}) — append it to AFFIX_BATCHES to ship v${AffixBank.version() + 1}`
    : `LAWFUL   candidate ${candidate.runId} (WEB) — append it to WEB_BATCHES to ship web v${WebBank.version() + 1}`);
} else {
  console.log(`CURRENT  pack "${AffixBank.current().name}" v${AffixBank.version()}, web v${WebBank.version()} — the next world minted pins them`);
  console.log(`PURGED   from the legacy pool (D22): ${AffixBank.purgedLegacyIds().join(', ') || 'nothing'}`);
}
