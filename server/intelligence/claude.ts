/**
 * CLAUDE, behind the door (D46). Credentials come from the server's environment (ANTHROPIC_API_KEY,
 * which `.env` can set, or an `ant auth login` profile) and never reach a browser.
 *
 * One model constant per kind of content (D44). A rest and a world's window go through
 * Message Batches: half the price, and literally sleeping on it. A live call has the server-side
 * fallback on, so a classifier decline on one model does not end a person's mint;
 * batches do not accept that parameter, and a refused batch stays queued instead.
 */
import Anthropic from '@anthropic-ai/sdk';
import type { DoorKind, DoorStatus, IDoorOutcome, IDoorRequest, IDoorUsage, IIntelligenceProvider, IProviderStatus } from './door';

export const MODEL_FOR: Record<DoorKind, string> = {
  // Pedro: "hook up the rest to sonnet", "except for the large world generation, the medium one also doesn't need Opus"
  talk: 'claude-sonnet-5-5',
  theme: 'claude-sonnet-5-5',
  theme_large: 'claude-opus-5-5',
  rest: 'claude-sonnet-5-5',
  window: 'claude-sonnet-5-5',
  // Pedro's June design: skills "derived by haiku at the end of the character creation screen"
  creation: 'claude-haiku-5-5',
  // Pedro: fate gambler "calls up a stream style conversation with sonnet and you talk with kami itself"
  kami_talk: 'claude-sonnet-5-5',
  kami_set: 'claude-sonnet-5-5',
  // Pedro: "you send that seed to a random ass haiku and ask for a personality based on vibes"
  kami_persona: 'claude-haiku-5-5',
  // Pedro: "what we do is load up haiku and talk to it", and "ask haiku to give this npc it's goal"
  npc_talk: 'claude-haiku-5-5',
  npc_goal: 'claude-haiku-5-5',
  bargain: 'claude-haiku-5-5'
};

/** How hard each kind thinks. A talk answers quickly; a world is worth thinking about. */
const EFFORT_FOR: Record<DoorKind, 'low' | 'medium' | 'high'> = { talk: 'low', theme: 'high', theme_large: 'high', rest: 'medium', window: 'medium', creation: 'low', kami_talk: 'low', kami_set: 'medium', kami_persona: 'low', npc_talk: 'low', npc_goal: 'low', bargain: 'low' };

/** Dollars per million tokens. Batches are half. */
/** Writing to the cache costs a quarter more than plain input, for what it saves on every read after. */
const CACHE_WRITE_FACTOR = 1.25;

const RATES: Record<string, { input: number; output: number; cacheRead: number }> = {
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheRead: 0.01 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.2 }
};
/** Rough, and on the safe side: a ceiling, never a bill. */
const CHARS_PER_TOKEN = 3;

const FALLBACK_BETA = 'server-side-fallback-2026-07-01';
/** Haiku has no server-side fallback. A declined creation falls to the bank's floor instead, and a declined round still rolls. */
const NO_FALLBACK: readonly DoorKind[] = ['creation', 'kami_persona', 'npc_talk', 'npc_goal', 'bargain'];

const usageOf = (model: string, usage: Anthropic.Usage | undefined, batched: boolean): IDoorUsage | undefined => {
  if (!usage) return undefined;
  const rate = RATES[model];
  const factor = batched ? 0.5 : 1;
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const cacheWrite = usage.cache_creation_input_tokens ?? 0;
  const usd = rate
    ? ((usage.input_tokens * rate.input + usage.output_tokens * rate.output + cacheRead * rate.cacheRead + cacheWrite * rate.input * CACHE_WRITE_FACTOR) / 1_000_000) * factor
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

  private liveParams(request: IDoorRequest) {
    return {
      ...this.params(request),
      ...(NO_FALLBACK.includes(request.kind) ? {} : { betas: [FALLBACK_BETA], fallbacks: 'default' })
    } as unknown as Anthropic.Beta.Messages.MessageCreateParamsStreaming;
  }

  async askStream(request: IDoorRequest, onText: (text: string) => void, signal?: AbortSignal): Promise<IDoorOutcome> {
    try {
      const stream = this.client.beta.messages.stream(this.liveParams(request), signal ? { signal } : undefined);
      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') onText(event.delta.text);
      }
      const message = await stream.finalMessage();
      return this.read(message as unknown as Anthropic.Message, request, false);
    } catch (e) {
      return this.failure(e);
    }
  }

  async ask(request: IDoorRequest): Promise<IDoorOutcome> {
    try {
      const stream = this.client.beta.messages.stream(this.liveParams(request));
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
