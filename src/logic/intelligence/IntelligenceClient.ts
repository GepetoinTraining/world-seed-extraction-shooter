/**
 * The browser's side of the one door (D46). It knows no model: it asks the door, on a server or
 * in this page (DoorTransport.ts), and every answer is an outcome, never a thrown error, so a
 * closed door or a dropped network leaves the game standing.
 */
import { DoorTransport } from './DoorTransport';

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

async function post<T>(path: string, body: unknown): Promise<IDoorOutcome<T>> {
  try {
    return await DoorTransport.json<IDoorOutcome<T>>(path, body);
  } catch {
    return { status: 'OFFLINE', reason: 'The voice cannot be reached.' };
  }
}

export const IntelligenceClient = {
  async status(): Promise<{ available: boolean; provider?: string; model?: string; reason?: string }> {
    try {
      return await DoorTransport.json('/status');
    } catch {
      return { available: false, reason: 'The voice cannot be reached.' };
    }
  },
  talk: (messages: IDoorMessage[], draft: Record<string, unknown>) => post('/talk', { messages, draft }),
  writeTheme: <T>(messages: IDoorMessage[], draft: Record<string, unknown>) => post<T>('/theme', { messages, draft }),
  /** Q1: one pass of a world, in a world's own order. */
  writePass: <T>(pass: string, ask: unknown, draft: Record<string, unknown>) => post<T>('/world/pass', { pass, ask, draft }),
  grantSkills: <T>(ask: unknown) => post<T>('/creation', { ask }),
  setKami: <T>(messages: IDoorMessage[], ask: unknown, persona?: string) => post<T>('/kami/set', { messages, ask, persona }),
  writeKamiPersona: (seed: string) => post('/kami/persona', { seed }),
  resolveChain: <T>(ask: unknown) => post<T>('/chain', { ask }),
  writeLoot: <T>(ask: unknown) => post<T>('/loot', { ask }),

  // D113, D114, D116: a person waits on each of these. The id is what the door's spend limit counts against.
  npcTalk: <T>(talkId: string, ask: unknown) => post<T>('/npc/talk', { talkId, ask }),
  npcGoal: <T>(talkId: string, ask: unknown) => post<T>('/npc/goal', { talkId, ask }),
  bargain: <T>(talkId: string, ask: unknown) => post<T>('/npc/bargain', { talkId, ask }),
  /** Two people meeting while somebody watches: spoken live (MeetDoor). */
  npcMeet: <T>(talkId: string, ask: unknown) => post<T>('/npc/meet', { talkId, ask }),

  /** A conversation as it is written. Every end is an outcome, and a stream that just stops did not finish. */
  async talkKami(messages: IDoorMessage[], onText: (text: string) => void, signal?: AbortSignal, persona?: string): Promise<IDoorOutcome> {
    let ended: IDoorOutcome | null = null;
    const readLine = (line: string) => {
      if (!line.trim()) return;
      const piece = JSON.parse(line) as { text?: string; done?: boolean } & IDoorOutcome;
      if (piece.done) ended = { status: piece.status, usage: piece.usage, reason: piece.reason };
      else if (piece.text) onText(piece.text);
    };
    try {
      await DoorTransport.lines('/kami/talk', { messages, persona }, line => line.split('\n').forEach(readLine), signal);
    } catch {
      return { status: 'OFFLINE', reason: 'The voice cannot be reached.' };
    }
    return ended ?? { status: 'OUTAGE', reason: 'It stopped before it finished.' };
  },
  fileRest: (id: string, queue: unknown, theme: unknown) => post('/rest/file', { id, queue, theme }),
  collectRest: <T>(batchId: string) => post<T>('/rest/collect', { batchId }),
  fileWindow: (id: string, kind: string, asks: unknown[], theme: unknown, spent: number) => post('/window/file', { id, kind, asks, theme, spent }),
  collectWindow: <T>(batchId: string) => post<T>('/window/collect', { batchId })
};
