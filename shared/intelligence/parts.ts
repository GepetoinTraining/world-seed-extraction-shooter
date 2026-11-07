/**
 * Q1: an ask too large for one grammar goes in parts, each one compiling, each told what the
 * parts before it wrote. The parts join into the one answer the caller always read, and the
 * law judges the whole as before. A part that does not come back ends the ask as an outcome.
 */
import type { IDoorOutcome, IDoorUsage, IntelligenceDoor } from './door';
import { buildChainRequest, CHAIN_PARTS, type IChainAsk } from './prompts';

const addUsage = (a: IDoorUsage | undefined, b: IDoorUsage | undefined): IDoorUsage | undefined => {
  if (!a) return b;
  if (!b) return a;
  return { model: b.model, inputTokens: a.inputTokens + b.inputTokens, outputTokens: a.outputTokens + b.outputTokens, cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens, usd: a.usd + b.usd };
};

type Round = { tags?: unknown[]; materials?: unknown[]; stations?: unknown[]; goods?: unknown[]; gear?: unknown[] };

/** A round of a chain, in its two parts, joined. */
export async function askChainInParts(door: Pick<IntelligenceDoor, 'ask'>, ask: IChainAsk): Promise<IDoorOutcome> {
  let usage: IDoorUsage | undefined;
  let joined: Round = { tags: [], materials: [], stations: [], goods: [], gear: [] };
  for (let part = 0; part < CHAIN_PARTS.length; part++) {
    const out = await door.ask(buildChainRequest(ask, part, part > 0 ? joined : undefined));
    usage = addUsage(usage, out.usage);
    if (out.status !== 'OK' || !out.data) return { ...out, usage };
    const data = out.data as Round;
    joined = {
      tags: [...(joined.tags ?? []), ...(data.tags ?? [])],
      materials: [...(joined.materials ?? []), ...(data.materials ?? [])],
      stations: [...(joined.stations ?? []), ...(data.stations ?? [])],
      goods: [...(joined.goods ?? []), ...(data.goods ?? [])],
      gear: [...(joined.gear ?? []), ...(data.gear ?? [])]
    };
  }
  return { status: 'OK', data: joined, usage };
}
