/**
 * THE LAW EACH KIND OF SHARED WORK STANDS BEFORE (pool.ts). The game's own producers of shared work
 * post it to the pool: a world written pass by pass (Q1), a hub's chain resolved backwards (D129),
 * a theme's loot tables. The poster hands in what the law needs (the pull a pass was offered, the
 * chain a round is judged against), so the hub judges a worker's answer against the poster's ground
 * and never trusts the worker. The poster's own client judges it again when it lands, as it would
 * judge its own door's answer.
 *
 * Pure: what is judged and what it is judged against come in.
 */
import { schemaProblem } from '../../shared/logic/content/SchemaFit';
import { LOOT_SCHEMA, LootLaw, sealLoot, type ILootTable, type ILootWords } from '../../shared/logic/theme/LootLaw';
import { PASS_SCHEMAS, WORLD_PASSES, type WorldPassId } from '../../shared/logic/theme/writing/WorldPasses';
import { ChainWeb } from '../../shared/logic/theme/ChainWeb';
import type { IThemeBody } from '../../shared/logic/theme/ThemeTypes';

export type Judged = { ok: true; reason?: undefined; result: unknown } | { ok: false; reason: string; result?: undefined };
const no = (reason: string): Judged => ({ ok: false, reason });

/** Every id a pass names as picked must be one it was offered. */
function picksOf(answer: any): string[] {
  const out: string[] = [];
  for (const p of Array.isArray(answer?.picked) ? answer.picked : []) out.push(typeof p === 'string' ? p : String(p?.id ?? ''));
  for (const role of ['impassable', 'skilled']) if (answer?.[role]?.pick) out.push(String(answer[role].pick));
  return out;
}

export function judgePass(body: any, data: unknown): Judged {
  const pass = body?.pass as WorldPassId;
  if (!WORLD_PASSES.includes(pass)) return no('A world is written in no such pass.');
  const shape = schemaProblem(PASS_SCHEMAS[pass], data);
  if (shape) return no(shape);
  const offered = new Set(Object.values((body?.ask?.offered ?? {}) as Record<string, { id: string }[]>).flatMap(list => (Array.isArray(list) ? list.map(e => e?.id) : [])));
  const stray = picksOf(data).find(id => !offered.has(id));
  if (stray) return no(`It picks "${stray}", which the pass did not offer.`);
  return { ok: true, result: data };
}

export function judgeChain(body: any, data: unknown): Judged {
  const check = body?.check;
  if (!check || typeof check !== 'object' || !check.chain || !check.ground || !Array.isArray(check.open)) return no('A round is judged against the chain it was asked from, and the poster sent none.');
  const registered = new Set<string>(Array.isArray(check.registered) ? check.registered : []);
  const verdict = ChainWeb.judge(data as any, check.chain, check.ground, check.open, tag => registered.has(tag));
  return verdict.ok ? { ok: true, result: data } : no(verdict.reason ?? 'The law refused it.');
}

/** Each table sealed and judged; the result is the tables the law stood up, numbers its own. */
export function judgeLoot(body: any, data: unknown, pack: (IThemeBody & { themeId: string }) | undefined): Judged {
  if (!pack) return no('Its theme is not one this hub holds.');
  const shape = schemaProblem(LOOT_SCHEMA, data);
  if (shape) return no(shape);
  const tables: ILootTable[] = [];
  const why: string[] = [];
  for (const words of (data as { tables: ILootWords[] }).tables) {
    const verdict = LootLaw.correct(sealLoot(pack.themeId, words), pack);
    if (verdict.ok) tables.push(verdict.table);
    else why.push(`${words.name}: ${verdict.reason}`);
  }
  if (tables.length === 0) return no(why.join('; ') || 'No table came back.');
  return { ok: true, result: { tables } };
}

export const themeOfLootJob = (body: any): string | undefined => (typeof body?.ask?.themeId === 'string' ? body.ask.themeId : undefined);
