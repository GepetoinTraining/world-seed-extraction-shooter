/**
 * THE ONE DOOR (D43, D44, D46): all intelligence goes through here, on the server.
 *
 * A browser asks this door and never holds a key. Behind the door is one provider
 * seam (the final shape, D55: our Claude, a person's own key, a local model), and
 * whatever comes back is judged by the bank law before it becomes anything, so
 * nothing here assumes which model wrote it.
 *
 * A refusal, a missing key, a rate limit or an outage is an OUTCOME, not an error:
 * the caller's work stays queued and the game goes on.
 */

export type DoorKind = 'talk' | 'theme' | 'rest' | 'creation' | 'kami_talk' | 'kami_set';

export interface IDoorUsage {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  /** What this call cost, in dollars, at the rates on the provider. */
  usd: number;
}

export type DoorStatus = 'OK' | 'NO_KEY' | 'REFUSED' | 'BUSY' | 'OFFLINE' | 'OUTAGE' | 'CUT_OFF' | 'PENDING' | 'OVER_LIMIT';

export interface IDoorOutcome {
  status: DoorStatus;
  /** Prose for a talk. */
  text?: string;
  /** Parsed data for anything with a schema. The law still judges it. */
  data?: unknown;
  usage?: IDoorUsage;
  reason?: string;
}

export interface IDoorMessage { role: 'user' | 'assistant'; content: string }

export interface IDoorRequest {
  kind: DoorKind;
  /** Frozen across calls, so a provider can cache it. Nothing volatile goes here. */
  system: string;
  messages: IDoorMessage[];
  /** JSON schema of what must come back. Absent means prose. */
  schema?: Record<string, unknown>;
  maxTokens: number;
}

export interface IProviderStatus { available: boolean; provider: string; model?: string; reason?: string }

/** The seam. Claude is the one shipped; a person's own key or a local model plugs in here. */
export interface IIntelligenceProvider {
  name: string;
  status(): Promise<IProviderStatus>;
  /** A person is waiting. */
  ask(request: IDoorRequest): Promise<IDoorOutcome>;
  /** A person is waiting and reading as it comes. A provider without it answers all at once. */
  askStream?(request: IDoorRequest, onText: (text: string) => void, signal?: AbortSignal): Promise<IDoorOutcome>;
  /** Nobody is waiting: file it, come back later. A provider with no batches answers at once. */
  file(id: string, request: IDoorRequest): Promise<{ status: DoorStatus; batchId?: string; outcome?: IDoorOutcome; reason?: string }>;
  collect(batchId: string): Promise<IDoorOutcome>;
  /** The most this request could cost, in dollars, before it is sent. */
  ceiling(request: IDoorRequest, batched: boolean): number;
}

/** D44: what one rest may spend. It guards the bill and caps no content: what is over it waits. */
export const REST_SPEND_LIMIT_USD = 0.5;

/** A provider that is not there: no key, no model. The game must still go on. */
export class AbsentProvider implements IIntelligenceProvider {
  name = 'none';
  constructor(private reason = 'No intelligence is configured on this server.') {}
  async status(): Promise<IProviderStatus> { return { available: false, provider: this.name, reason: this.reason }; }
  async ask(): Promise<IDoorOutcome> { return { status: 'NO_KEY', reason: this.reason }; }
  async file() { return { status: 'NO_KEY' as DoorStatus, reason: this.reason }; }
  async collect(): Promise<IDoorOutcome> { return { status: 'NO_KEY', reason: this.reason }; }
  ceiling(): number { return 0; }
}

export class IntelligenceDoor {
  constructor(private provider: IIntelligenceProvider) {}

  status(): Promise<IProviderStatus> { return this.provider.status(); }

  /** A live call: only where a person is waiting (D46). Never from the hot path. */
  ask(request: IDoorRequest): Promise<IDoorOutcome> { return this.provider.ask(request); }

  /** The same live call, in pieces as they are written. The outcome still says how it ended. */
  async askStream(request: IDoorRequest, onText: (text: string) => void, signal?: AbortSignal): Promise<IDoorOutcome> {
    if (this.provider.askStream) return this.provider.askStream(request, onText, signal);
    const out = await this.provider.ask(request);
    if (out.status === 'OK' && out.text) onText(out.text);
    return out;
  }

  /** A rest's batch, filed. Over the limit, it does not go: it waits for the next rest (D44). */
  async fileRest(id: string, request: IDoorRequest) {
    const ceiling = this.provider.ceiling(request, true);
    if (ceiling > REST_SPEND_LIMIT_USD) {
      return { status: 'OVER_LIMIT' as DoorStatus, reason: `This batch could cost $${ceiling.toFixed(2)}, over the $${REST_SPEND_LIMIT_USD.toFixed(2)} a rest may spend.` };
    }
    return this.provider.file(id, request);
  }

  collectRest(batchId: string): Promise<IDoorOutcome> { return this.provider.collect(batchId); }
}
