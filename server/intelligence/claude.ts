/**
 * CLAUDE, behind the door (D46). Credentials come from the server's environment
 * (ANTHROPIC_API_KEY, or an `ant auth login` profile) and never reach a browser.
 *
 * One model constant per kind of content (D44). A rest and a world's window go through
 * Message Batches: half the price, and literally sleeping on it. A live call has the server-side
 * fallback on, so a classifier decline on one model does not end a person's mint;
 * batches do not accept that parameter, and a refused batch stays queued instead.
 */
import Anthropic from '@anthropic-ai/sdk';
import type { DoorKind, DoorStatus, IDoorOutcome, IDoorRequest, IDoorUsage, IIntelligenceProvider, IProviderStatus } from './door';

export const MODEL_FOR: Record<DoorKind, string> = {
  talk: 'claude-opus-5-5',
  theme: 'claude-opus-5-5',
  rest: 'claude-opus-5-5',
  window: 'claude-opus-5-5'
};

/** How hard each kind thinks. A talk answers quickly; a world is worth thinking about. */
const EFFORT_FOR: Record<DoorKind, 'low' | 'medium' | 'high'> = { talk: 'low', theme: 'high', rest: 'medium', window: 'medium' };

/** Dollars per million tokens. Batches are half. */
const RATES: Record<string, { input: number; output: number; cacheRead: number }> = {
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2 }
};
/** Rough, and on the safe side: a ceiling, never a bill. */
const CHARS_PER_TOKEN = 3;

const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

const usageOf = (model: string, usage: Anthropic.Usage | undefined, batched: boolean): IDoorUsage | undefined => {
  if (!usage) return undefined;
  const rate = RATES[model];
  const factor = batched ? 0.5 : 1;
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const usd = rate
    ? ((usage.input_tokens * rate.input + usage.output_tokens * rate.output + cacheRead * rate.cacheRead) / 1_000_000) * factor
    : 0;
  return { model, inputTokens: usage.input_tokens, outputTokens: usage.output_tokens, cacheReadTokens: cacheRead, usd };
};

export class ClaudeProvider implements IIntelligenceProvider {
  name = 'claude';
  private client: Anthropic;

  constructor(client?: Anthropic) {
    this.client = client ?? new Anthropic();
  }

  async status(): Promise<IProviderStatus> {
    try {
      await this.client.models.retrieve(MODEL_FOR.rest);
      return { available: true, provider: this.name, model: MODEL_FOR.rest };
    } catch (e) {
      return { available: false, provider: this.name, reason: this.failure(e).reason };
    }
  }

  ceiling(request: IDoorRequest, batched: boolean): number {
    const rate = RATES[MODEL_FOR[request.kind]];
    if (!rate) return 0;
    const chars = request.system.length + request.messages.reduce((n, m) => n + m.content.length, 0);
    const usd = ((chars / CHARS_PER_TOKEN) * rate.input + request.maxTokens * rate.output) / 1_000_000;
    return batched ? usd / 2 : usd;
  }

  private params(request: IDoorRequest) {
    return {
      model: MODEL_FOR[request.kind],
      max_tokens: request.maxTokens,
      // The frozen part first and cached; the volatile part stays in messages.
      system: [{ type: 'text' as const, text: request.system, cache_control: { type: 'ephemeral' as const } }],
      messages: request.messages,
      output_config: {
        effort: EFFORT_FOR[request.kind],
        ...(request.schema ? { format: { type: 'json_schema' as const, schema: request.schema } } : {})
      }
    };
  }

  private read(message: Anthropic.Message, request: IDoorRequest, batched: boolean): IDoorOutcome {
    const usage = usageOf(MODEL_FOR[request.kind], message.usage, batched);
    if (message.stop_reason === 'refusal') return { status: 'REFUSED', usage, reason: 'The model declined this one.' };
    if (message.stop_reason === 'max_tokens') return { status: 'CUT_OFF', usage, reason: 'The answer ran past its room.' };
    const text = message.content.flatMap(b => (b.type === 'text' ? [b.text] : [])).join('');
    if (!request.schema) return { status: 'OK', text, usage };
    try {
      return { status: 'OK', data: JSON.parse(text), usage };
    } catch {
      return { status: 'CUT_OFF', usage, reason: 'What came back did not parse.' };
    }
  }

  private failure(e: unknown): { status: DoorStatus; reason: string } {
    if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
      return { status: 'NO_KEY', reason: 'The server holds no working key.' };
    }
    if (e instanceof Anthropic.RateLimitError) return { status: 'BUSY', reason: 'The model is rate limited. It waits.' };
    if (e instanceof Anthropic.APIConnectionError) return { status: 'OFFLINE', reason: 'The model cannot be reached.' };
    if (e instanceof Anthropic.APIError) return { status: 'OUTAGE', reason: `The model answered ${e.status ?? 'badly'}.` };
    // The SDK throws a plain Error when it can find no credentials at all
    const message = e instanceof Error ? e.message : String(e);
    if (/authentication|api key|apikey|credential/i.test(message)) return { status: 'NO_KEY', reason: 'The server holds no key.' };
    return { status: 'OUTAGE', reason: message };
  }

  async ask(request: IDoorRequest): Promise<IDoorOutcome> {
    try {
      const stream = this.client.beta.messages.stream({
        ...this.params(request),
        betas: [FALLBACK_BETA],
        fallbacks: 'default'
      } as unknown as Anthropic.Beta.Messages.MessageCreateParamsStreaming);
      const message = await stream.finalMessage();
      return this.read(message as unknown as Anthropic.Message, request, false);
    } catch (e) {
      return this.failure(e);
    }
  }

  async file(id: string, request: IDoorRequest) {
    try {
      const batch = await this.client.messages.batches.create({
        requests: [{ custom_id: id, params: this.params(request) as unknown as Anthropic.Messages.MessageCreateParamsNonStreaming }]
      });
      // The request's kind and schema travel on the batch's id, so collecting needs nothing kept here.
      this.filed.set(batch.id, request);
      return { status: 'PENDING' as DoorStatus, batchId: batch.id };
    } catch (e) {
      return this.failure(e);
    }
  }

  private filed = new Map<string, IDoorRequest>();

  async collect(batchId: string): Promise<IDoorOutcome> {
    try {
      const batch = await this.client.messages.batches.retrieve(batchId);
      if (batch.processing_status !== 'ended') return { status: 'PENDING' };
      // Only a rest or a window is filed, each on one model and always with a schema, so nothing need be kept between
      const request: IDoorRequest = { kind: 'rest', system: '', messages: [], schema: {}, maxTokens: 0 };
      for await (const result of await this.client.messages.batches.results(batchId)) {
        if (result.result.type === 'succeeded') return this.read(result.result.message, request, true);
        if (result.result.type === 'errored') return { status: 'OUTAGE', reason: 'The batch came back errored. It stays queued.' };
        return { status: 'OUTAGE', reason: `The batch ${result.result.type}. It stays queued.` };
      }
      return { status: 'OUTAGE', reason: 'The batch came back empty.' };
    } catch (e) {
      return this.failure(e);
    }
  }
}
