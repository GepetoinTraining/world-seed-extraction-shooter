/**
 * WHAT THE DOOR OFFERS A PERSON WITH NO KEY, read from data (`door-options.json`, or the file
 * WS_DOOR_OPTIONS names). Pedro: "we can actually give them free options to pick from". Which ones
 * stay is his pick, so nothing here names a provider: an option is a row, and the protocol it speaks
 * says which provider behind the seam carries it.
 *
 * A person's key comes to this server door and stays in its memory. It never goes back to a
 * browser, never into a file, a log or the database. A restart forgets it, and the person enters it again.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DoorStatus, IDoorOutcome, IDoorRequest, IIntelligenceProvider, IProviderStatus } from './door';

export interface IKeyedOption {
  id: string;
  name: string;
  /** Which provider behind the seam speaks to it. Only `openai` (the OpenAI-style chat API) is built. */
  protocol: string;
  baseUrl: string;
  model: string;
  keyPage?: string;
  /** Its free terms, as read on its own pages, and when. */
  free?: string;
  card?: string;
  data?: string;
  checked?: string;
  sources?: string[];
}

export interface ISuggestion { model: string; bytes: number; why?: string }

export interface IDoorOptions {
  /** `suggestions` run largest first; the check suggests the first that fits this machine's card. */
  local?: { runtime?: string; url?: string; suggestions?: ISuggestion[]; runtimePage?: string };
  keyed: IKeyedOption[];
}

const HERE = dirname(fileURLToPath(import.meta.url));

/** Read at each start. A broken file offers nothing rather than stopping the server. */
export function readDoorOptions(path = process.env.WS_DOOR_OPTIONS?.trim() || resolve(HERE, 'door-options.json')): IDoorOptions {
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<IDoorOptions>;
    const keyed = (Array.isArray(raw.keyed) ? raw.keyed : []).filter((o): o is IKeyedOption =>
      !!o && typeof o.id === 'string' && typeof o.name === 'string' && typeof o.protocol === 'string' && typeof o.baseUrl === 'string' && typeof o.model === 'string');
    return { ...(raw.local ? { local: raw.local } : {}), keyed };
  } catch (e) {
    console.warn(`[DOOR] The door's options could not be read from ${path}: ${(e as Error).message}`);
    return { keyed: [] };
  }
}

/** Filed work is named so the door can tell whose it is on the way back. */
const KEYED_BATCH = 'keyed_';

/**
 * Any provider that speaks the OpenAI-style chat API, on a person's own key. It has no batches
 * here, so a rest or a window is worked at once, filed and collected the same way.
 */
export class OpenAICompatibleProvider implements IIntelligenceProvider {
  readonly name: string;
  private filed = new Map<string, { outcome?: IDoorOutcome }>();
  private count = 0;

  constructor(readonly option: IKeyedOption, private key: string, private reach: typeof fetch = fetch) {
    this.name = option.id;
  }

  static owns(batchId: string): boolean {
    return batchId.startsWith(KEYED_BATCH);
  }

  private get base(): string {
    return this.option.baseUrl.replace(/\/+$/, '');
  }

  private headers() {
    return { 'content-type': 'application/json', authorization: `Bearer ${this.key}` };
  }

  /** What a refusal over HTTP means to the door. */
  private statusFor(code: number): { status: DoorStatus; reason: string } {
    if (code === 401 || code === 403) return { status: 'NO_KEY', reason: `${this.option.name} refused the key.` };
    if (code === 429) return { status: 'BUSY', reason: `${this.option.name} is at its free limit for now. It waits.` };
    return { status: 'OUTAGE', reason: `${this.option.name} answered ${code}.` };
  }

  async status(): Promise<IProviderStatus> {
    try {
      const res = await this.reach(`${this.base}/models`, { headers: this.headers() });
      if (res.ok) return { available: true, provider: this.name, model: this.option.model };
      const failure = this.statusFor(res.status);
      return { available: false, provider: this.name, model: this.option.model, reason: failure.reason, outcome: failure.status };
    } catch {
      return { available: false, provider: this.name, reason: `${this.option.name} cannot be reached.`, outcome: 'OFFLINE' };
    }
  }

  /** A free option bills the person nothing in money; its limits are counted by the provider. */
  ceiling(): number {
    return 0;
  }

  private body(request: IDoorRequest, stream: boolean) {
    return JSON.stringify({
      model: this.option.model,
      messages: [{ role: 'system', content: request.system }, ...request.messages],
      max_tokens: request.maxTokens,
      stream,
      ...(request.schema ? { response_format: { type: 'json_schema', json_schema: { name: request.kind, schema: request.schema, strict: true } } } : {})
    });
  }

  private read(text: string, finish: string | undefined, request: IDoorRequest, usage?: { prompt_tokens?: number; completion_tokens?: number }): IDoorOutcome {
    const used = { model: `${this.name}:${this.option.model}`, inputTokens: usage?.prompt_tokens ?? 0, outputTokens: usage?.completion_tokens ?? 0, cacheReadTokens: 0, usd: 0 };
    if (finish === 'length') return { status: 'CUT_OFF', usage: used, reason: 'The answer ran past its room.' };
    if (finish === 'content_filter') return { status: 'REFUSED', usage: used, reason: 'The model declined this one.' };
    if (!request.schema) return { status: 'OK', text, usage: used };
    try {
      return { status: 'OK', data: JSON.parse(text), usage: used };
    } catch {
      return { status: 'CUT_OFF', usage: used, reason: 'What came back did not parse.' };
    }
  }

  async ask(request: IDoorRequest): Promise<IDoorOutcome> {
    let res: Response;
    try {
      res = await this.reach(`${this.base}/chat/completions`, { method: 'POST', headers: this.headers(), body: this.body(request, false) });
    } catch {
      return { status: 'OFFLINE', reason: `${this.option.name} cannot be reached.` };
    }
    if (!res.ok) return this.statusFor(res.status);
    const body = await res.json() as { choices?: { message?: { content?: string }; finish_reason?: string }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } };
    const choice = body.choices?.[0];
    return this.read(choice?.message?.content ?? '', choice?.finish_reason, request, body.usage);
  }

  async askStream(request: IDoorRequest, onText: (text: string) => void, signal?: AbortSignal): Promise<IDoorOutcome> {
    let res: Response;
    try {
      res = await this.reach(`${this.base}/chat/completions`, { method: 'POST', headers: this.headers(), body: this.body(request, true), signal });
    } catch {
      return { status: 'OFFLINE', reason: `${this.option.name} cannot be reached.` };
    }
    if (!res.ok) return this.statusFor(res.status);
    // Server-sent events: one `data:` line a piece, ending with [DONE]
    let text = '';
    let finish: string | undefined;
    let buffer = '';
    const decoder = new TextDecoder();
    const take = (line: string) => {
      const data = line.replace(/^data:\s*/, '').trim();
      if (!line.startsWith('data:') || !data || data === '[DONE]') return;
      const chunk = JSON.parse(data) as { choices?: { delta?: { content?: string }; finish_reason?: string | null }[] };
      const piece = chunk.choices?.[0]?.delta?.content ?? '';
      if (piece) { text += piece; onText(piece); }
      finish = chunk.choices?.[0]?.finish_reason ?? finish;
    };
    for await (const bytes of res.body as unknown as AsyncIterable<Uint8Array>) {
      buffer += decoder.decode(bytes, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      lines.forEach(take);
    }
    take(buffer + decoder.decode());
    return this.read(text, finish ?? undefined, request);
  }

  async file(id: string, request: IDoorRequest): Promise<{ status: DoorStatus; batchId?: string; reason?: string }> {
    const batchId = `${KEYED_BATCH}${id}_${++this.count}`;
    const entry: { outcome?: IDoorOutcome } = {};
    this.filed.set(batchId, entry);
    void this.ask(request).then(outcome => { entry.outcome = outcome; });
    return { status: 'PENDING', batchId };
  }

  async collect(batchId: string): Promise<IDoorOutcome> {
    const entry = this.filed.get(batchId);
    if (!entry) return { status: 'OUTAGE', reason: 'No such work is held here. It stays queued.' };
    if (!entry.outcome) return { status: 'PENDING' };
    this.filed.delete(batchId);
    return entry.outcome;
  }
}

/** The provider an option's protocol calls for, or why there is none. */
export function providerFor(option: IKeyedOption, key: string): OpenAICompatibleProvider | { reason: string } {
  if (option.protocol === 'openai') return new OpenAICompatibleProvider(option, key);
  return { reason: `${option.name} speaks "${option.protocol}", which this door does not speak yet.` };
}
