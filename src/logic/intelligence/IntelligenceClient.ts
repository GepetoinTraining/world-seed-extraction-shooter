/**
 * The browser's side of the one door (D46). It holds no key and knows no model: it
 * asks the server, and every answer is an outcome, never a thrown error, so a closed
 * door or a dropped network leaves the game standing.
 */

export type DoorStatus = 'OK' | 'NO_KEY' | 'REFUSED' | 'BUSY' | 'OFFLINE' | 'OUTAGE' | 'CUT_OFF' | 'PENDING' | 'OVER_LIMIT';

export interface IDoorUsage { model: string; inputTokens: number; outputTokens: number; cacheReadTokens: number; usd: number }

export interface IDoorOutcome<T = unknown> {
  status: DoorStatus;
  text?: string;
  data?: T;
  usage?: IDoorUsage;
  reason?: string;
  batchId?: string;
  /** What this batch could cost, in dollars, when it was filed. */
  ceiling?: number;
}

export interface IDoorMessage { role: 'user' | 'assistant'; content: string }

const MOUNT = '/api/intelligence';

async function post<T>(path: string, body: unknown): Promise<IDoorOutcome<T>> {
  try {
    const res = await fetch(`${MOUNT}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return await res.json() as IDoorOutcome<T>;
  } catch {
    return { status: 'OFFLINE', reason: 'The door cannot be reached.' };
  }
}

export const IntelligenceClient = {
  async status(): Promise<{ available: boolean; provider?: string; model?: string; reason?: string }> {
    try {
      return await (await fetch(`${MOUNT}/status`)).json();
    } catch {
      return { available: false, reason: 'The door cannot be reached.' };
    }
  },
  talk: (messages: IDoorMessage[], draft: Record<string, unknown>) => post('/talk', { messages, draft }),
  writeTheme: <T>(messages: IDoorMessage[], draft: Record<string, unknown>) => post<T>('/theme', { messages, draft }),
  grantSkills: <T>(ask: unknown) => post<T>('/creation', { ask }),
  fileRest: (id: string, queue: unknown, theme: unknown) => post('/rest/file', { id, queue, theme }),
  collectRest: <T>(batchId: string) => post<T>('/rest/collect', { batchId }),
  fileWindow: (id: string, kind: string, asks: unknown[], theme: unknown, spent: number) => post('/window/file', { id, kind, asks, theme, spent }),
  collectWindow: <T>(batchId: string) => post<T>('/window/collect', { batchId })
};
