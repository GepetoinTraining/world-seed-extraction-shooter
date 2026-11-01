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
  setKami: <T>(messages: IDoorMessage[], ask: unknown) => post<T>('/kami/set', { messages, ask }),

  /** A conversation as it is written. Every end is an outcome, and a stream that just stops did not finish. */
  async talkKami(messages: IDoorMessage[], onText: (text: string) => void, signal?: AbortSignal): Promise<IDoorOutcome> {
    let ended: IDoorOutcome | null = null;
    const readLine = (line: string) => {
      if (!line.trim()) return;
      const piece = JSON.parse(line) as { text?: string; done?: boolean } & IDoorOutcome;
      if (piece.done) ended = { status: piece.status, usage: piece.usage, reason: piece.reason };
      else if (piece.text) onText(piece.text);
    };
    try {
      const res = await fetch(`${MOUNT}/kami/talk`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages }), signal });
      const reader = res.body?.getReader();
      if (!reader) {
        (await res.text()).split('\n').forEach(readLine);
      } else {
        const decoder = new TextDecoder();
        let held = '';
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          held += decoder.decode(value, { stream: true });
          const lines = held.split('\n');
          held = lines.pop() ?? '';
          lines.forEach(readLine);
        }
        readLine(held);
      }
    } catch {
      return { status: 'OFFLINE', reason: 'The door cannot be reached.' };
    }
    return ended ?? { status: 'OUTAGE', reason: 'It stopped before it finished.' };
  },
  fileRest: (id: string, queue: unknown, theme: unknown) => post('/rest/file', { id, queue, theme }),
  collectRest: <T>(batchId: string) => post<T>('/rest/collect', { batchId })
};
