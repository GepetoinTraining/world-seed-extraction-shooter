/**
 * Q1, at the mint: a world is written in full before its first deploy, pass by pass, from
 * everything this hub's database already holds. The person can leave the mint while it
 * writes (the tutorial world holds them); the draft keeps what comes back.
 */

import { IntelligenceClient } from '../../intelligence/IntelligenceClient';
import { SharedWork } from '../../hub/SharedWork';
import { WebBank } from '../../content/WebBank';
import { fnv1a } from '../../rng/DeterministicRNG';
import { ContentRegistry } from '../ContentRegistry';
import { CountedPull, poolOf } from './WorldPool';
import { CountedEmbedder } from './Counting';
import { IWriteResult, writeWorld } from './WorldWriter';
import type { WorldPassId } from './WorldPasses';

export interface IMintDraftLine { worldName: string; worldDescription: string; difficulty: string; size: number }

/** What the person said, as one text: the talk, or the draft's description when nothing was said. */
export function saidOf(talk: { role: string; content: string }[], draft: IMintDraftLine): string {
  const spoken = talk.filter(m => m.role === 'user').map(m => m.content).join('\n');
  return [draft.worldName, draft.worldDescription, spoken].filter(Boolean).join('\n');
}

export async function writeForMint(said: string, draft: IMintDraftLine, onPass?: (pass: WorldPassId, index: number) => void): Promise<IWriteResult> {
  const packs = ContentRegistry.list();
  const pool = poolOf(packs);
  // Counted from this hub's own worlds: no model, nothing installed (Pedro: "or none at all")
  const embedder = CountedEmbedder.of(pool.map(e => e.text));
  const registered = (tag: string) => WebBank.current().tags.some(t => t.tag === tag && !t.retired);
  return writeWorld(said, {
    // Shared work: a hub's pool writes it in turns when someone is there, this player's door when not
    door: (pass, ask) => SharedWork.ask('pass', '/world/pass', { pass, ask, draft: { ...draft } }, () => IntelligenceClient.writePass(pass, ask, { ...draft })),
    pull: new CountedPull(pool, embedder),
    embedder, packs, registered,
    seed: `mint:${fnv1a(said).toString(16)}`,
    difficulty: draft.difficulty,
    onPass
  });
}
