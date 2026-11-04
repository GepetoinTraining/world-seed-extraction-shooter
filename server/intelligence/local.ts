/**
 * A MODEL ON THIS MACHINE, behind the door (Q24, Q37). Pedro: "local model". With no key the door
 * still speaks: a keeper answers, a rest dreams and lore comes. It is a mode a player can have,
 * the same voice with the same asks, and whatever comes back stands before the same law.
 *
 * Which runtime and which model is the server's choice (WS_LOCAL_URL, WS_LOCAL_MODEL). The runtime
 * sits behind `ILocalRuntime`, so another plugs in beside Ollama's. Nothing here downloads or
 * starts anything: a runtime that is not running, or holds no such model, is an outcome (OFFLINE),
 * and the game goes on as it does with no voice at all.
 *
 * A local model has no batches. A rest or a window is filed the same way (PENDING, then collected),
 * and is worked on at once in the background, so the browser's side does not change.
 */
import type { DoorStatus, IDoorOutcome, IDoorRequest, IIntelligenceProvider, IProviderStatus } from './door';

/** What a local runtime gave back. `length` means it ran out of room. */
export interface ILocalAnswer {
  text: string;
  stop: 'done' | 'length';
  inputTokens?: number;
  outputTokens?: number;
}

/** A model the runtime serves, as it describes it. */
export interface IServedModel {
  name: string;
  bytes: number;
  /** The runtime's own words for it, when it gives them: "4.7B", "Q4_0". */
  parameters?: string;
  quantization?: string;
}

/** A model in memory now, and how much of it sits on the graphics card. */
export interface ILoadedModel { name: string; bytes: number; cardBytes: number }

/** The seam a runtime plugs into. Ollama is the one built; any other plugs in beside it. */
export interface ILocalRuntime {
  /** Short and generic, for the status line: "ollama". */
  name: string;
  /** The person's choice, and changed by them (Pedro: "the choice should be the players"). */
  model: string;
  /** Where it answers, for the check to say. */
  url?: string;
  /** Every model it serves, so the person can pick. */
  list?(): Promise<IServedModel[]>;
  /** What is in memory now. */
  loaded?(): Promise<ILoadedModel[]>;
  /** Is it on this machine at all, running or not? */
  installed?(): Promise<boolean>;
  /** Fetch a model. Only when the person asks for it. */
  pull?(model: string): Promise<{ ok: boolean; reason?: string }>;
  /** Is it running, and does it hold the model? */
  probe(): Promise<{ ok: boolean; reason?: string }>;
  /** One answer. With a schema the text is that JSON. Throws `LocalUnreachable` when it is not there. */
  chat(request: IDoorRequest, onText?: (text: string) => void, signal?: AbortSignal, model?: string): Promise<ILocalAnswer>;
}

/** The runtime is not there to ask: not running, or without the model. */
export class LocalUnreachable extends Error {}

/** A small model may think aloud before it answers. Only the answer is read. */
const THINKING = /^\s*<think>[\s\S]*?<\/think>\s*/;

/** Filed work is named so the door can tell it from a Claude batch on the way back. */
const LOCAL_BATCH = 'local_';

export class LocalProvider implements IIntelligenceProvider {
  name = 'local';
  private filed = new Map<string, { outcome?: IDoorOutcome }>();
  private count = 0;

  constructor(readonly runtime: ILocalRuntime) {}

  static owns(batchId: string): boolean {
    return batchId.startsWith(LOCAL_BATCH);
  }

  private get model(): string {
    return `${this.runtime.name}:${this.runtime.model}`;
  }

  async status(): Promise<IProviderStatus> {
    const probe = await this.runtime.probe().catch(e => ({ ok: false, reason: e instanceof Error ? e.message : String(e) }));
    return probe.ok
      ? { available: true, provider: this.name, model: this.model }
      : { available: false, provider: this.name, model: this.model, reason: probe.reason, outcome: 'OFFLINE' };
  }

  /** Nothing is billed for a model on this machine, so no spend guard ever stands in its way. */
  ceiling(): number {
    return 0;
  }

  private read(answer: ILocalAnswer, request: IDoorRequest): IDoorOutcome {
    const usage = { model: this.model, inputTokens: answer.inputTokens ?? 0, outputTokens: answer.outputTokens ?? 0, cacheReadTokens: 0, usd: 0 };
    if (answer.stop === 'length') return { status: 'CUT_OFF', usage, reason: 'The answer ran past its room.' };
    const text = answer.text.replace(THINKING, '');
    if (!request.schema) return { status: 'OK', text, usage };
    try {
      return { status: 'OK', data: JSON.parse(text), usage };
    } catch {
      return { status: 'CUT_OFF', usage, reason: 'What came back did not parse.' };
    }
  }

  private failure(e: unknown): IDoorOutcome {
    if (e instanceof LocalUnreachable) return { status: 'OFFLINE', reason: e.message };
    if ((e as Error)?.name === 'AbortError') return { status: 'OUTAGE', reason: 'The answer was stopped.' };
    return { status: 'OUTAGE', reason: e instanceof Error ? e.message : String(e) };
  }

  /** `model` asks another served model this once, as the check's try does. */
  async ask(request: IDoorRequest, model?: string): Promise<IDoorOutcome> {
    try {
      return this.read(await this.runtime.chat(request, undefined, undefined, model), request);
    } catch (e) {
      return this.failure(e);
    }
  }

  async askStream(request: IDoorRequest, onText: (text: string) => void, signal?: AbortSignal): Promise<IDoorOutcome> {
    try {
      // A thinking block is held back from the person: once it closes, what follows streams.
      let held = '';
      let flowing = false;
      const pass = (piece: string) => {
        if (flowing) return onText(piece);
        held += piece;
        const lead = held.trimStart();
        // It could still become a thinking block: wait
        if ('<think>'.startsWith(lead)) return;
        if (lead.startsWith('<think>')) {
          const end = held.indexOf('</think>');
          if (end < 0) return;
          held = held.slice(end + '</think>'.length).trimStart();
        }
        flowing = true;
        if (held) onText(held);
      };
      const answer = await this.runtime.chat(request, pass, signal);
      if (!flowing && held.trim() && !held.trimStart().startsWith('<think>')) onText(held);
      return this.read(answer, request);
    } catch (e) {
      return this.failure(e);
    }
  }

  /** Filed as a batch is, worked at once. The same id is collected the same way. */
  async file(id: string, request: IDoorRequest): Promise<{ status: DoorStatus; batchId?: string; outcome?: IDoorOutcome; reason?: string }> {
    const probe = await this.runtime.probe().catch(e => ({ ok: false, reason: e instanceof Error ? e.message : String(e) }));
    if (!probe.ok) return { status: 'OFFLINE', reason: probe.reason };
    const batchId = `${LOCAL_BATCH}${id}_${++this.count}`;
    const entry: { outcome?: IDoorOutcome } = {};
    this.filed.set(batchId, entry);
    void this.ask(request).then(outcome => { entry.outcome = outcome; });
    return { status: 'PENDING', batchId };
  }

  async collect(batchId: string): Promise<IDoorOutcome> {
    const entry = this.filed.get(batchId);
    // Work is kept in memory: a restart forgets it, and what asked for it files again.
    if (!entry) return { status: 'OUTAGE', reason: 'The local model holds no such work. It stays queued.' };
    if (!entry.outcome) return { status: 'PENDING' };
    this.filed.delete(batchId);
    return entry.outcome;
  }
}

/**
 * Claude while there is a key, the local model while there is none. Whether there is a key is
 * learned from Claude's own answer (NO_KEY), so a key added and a profile signed in are found at
 * the next status read, which the browser asks for on its own.
 */
export class KeyOrLocalProvider implements IIntelligenceProvider {
  private keyless = false;
  private learned?: Promise<void>;

  constructor(private keyed: IIntelligenceProvider, private local: LocalProvider) {}

  /** Learned at the first need, once; nothing is asked of Claude when the door is only built. */
  private first(): Promise<void> {
    return (this.learned ??= this.learn().then(() => undefined, () => undefined));
  }

  get name(): string {
    return this.keyless ? this.local.name : this.keyed.name;
  }

  private async learn(): Promise<IProviderStatus> {
    const status = await this.keyed.status();
    this.keyless = !status.available && status.outcome === 'NO_KEY';
    return status;
  }

  /** The spend guards read the ceiling before a call: they wait until it is known whether there is a key. */
  ready(): Promise<void> {
    return this.first();
  }

  async status(): Promise<IProviderStatus> {
    const status = await this.learn();
    this.learned ??= Promise.resolve();
    return this.keyless ? this.local.status() : status;
  }

  ceiling(request: IDoorRequest, batched: boolean): number {
    return this.keyless ? this.local.ceiling() : this.keyed.ceiling(request, batched);
  }

  async ask(request: IDoorRequest): Promise<IDoorOutcome> {
    await this.first();
    if (this.keyless) return this.local.ask(request);
    const out = await this.keyed.ask(request);
    if (out.status !== 'NO_KEY') return out;
    this.keyless = true;
    return this.local.ask(request);
  }

  async askStream(request: IDoorRequest, onText: (text: string) => void, signal?: AbortSignal): Promise<IDoorOutcome> {
    await this.first();
    if (this.keyless) return this.local.askStream(request, onText, signal);
    // Nothing streams before a NO_KEY, so falling to the local model writes nothing twice
    const out = this.keyed.askStream ? await this.keyed.askStream(request, onText, signal) : await this.keyed.ask(request);
    if (out.status !== 'NO_KEY') {
      if (!this.keyed.askStream && out.status === 'OK' && out.text) onText(out.text);
      return out;
    }
    this.keyless = true;
    return this.local.askStream(request, onText, signal);
  }

  async file(id: string, request: IDoorRequest) {
    await this.first();
    if (this.keyless) return this.local.file(id, request);
    const out = await this.keyed.file(id, request);
    if (out.status !== 'NO_KEY') return out;
    this.keyless = true;
    return this.local.file(id, request);
  }

  collect(batchId: string): Promise<IDoorOutcome> {
    return LocalProvider.owns(batchId) ? this.local.collect(batchId) : this.keyed.collect(batchId);
  }
}

/**
 * OLLAMA's HTTP API (`/api/tags`, `/api/chat`), the first runtime. It takes a JSON schema as
 * `format`, which the door's shaped asks need. Thinking is turned off: an ask's room is for the answer.
 */
export class OllamaRuntime implements ILocalRuntime {
  name = 'ollama';
  private baseUrl: string;

  constructor(baseUrl: string, public model: string, private findInstalled: () => Promise<boolean> = ollamaOnDisk) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  get url(): string {
    return this.baseUrl;
  }

  installed(): Promise<boolean> {
    return this.findInstalled();
  }

  async list(): Promise<IServedModel[]> {
    const res = await this.reach('/api/tags');
    if (!res.ok) throw new Error(`The local model answered ${res.status}.`);
    const body = await res.json() as { models?: { name?: string; model?: string; size?: number; details?: { parameter_size?: string; quantization_level?: string } }[] };
    return (body.models ?? []).map(m => ({
      name: m.name ?? m.model ?? '', bytes: m.size ?? 0,
      ...(m.details?.parameter_size ? { parameters: m.details.parameter_size } : {}),
      ...(m.details?.quantization_level ? { quantization: m.details.quantization_level } : {})
    })).filter(m => m.name);
  }

  async loaded(): Promise<ILoadedModel[]> {
    const res = await this.reach('/api/ps');
    if (!res.ok) return [];
    const body = await res.json() as { models?: { name?: string; model?: string; size?: number; size_vram?: number }[] };
    return (body.models ?? []).map(m => ({ name: m.name ?? m.model ?? '', bytes: m.size ?? 0, cardBytes: m.size_vram ?? 0 }));
  }

  async pull(model: string): Promise<{ ok: boolean; reason?: string }> {
    let res: Response;
    try {
      res = await this.reach('/api/pull', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model, stream: false }) });
    } catch (e) {
      return { ok: false, reason: (e as Error).message };
    }
    const body = await res.json().catch(() => ({})) as { status?: string; error?: string };
    return res.ok && body.status === 'success' ? { ok: true } : { ok: false, reason: body.error ?? `The local model answered ${res.status}.` };
  }

  private notRunning(): LocalUnreachable {
    return new LocalUnreachable(`Nothing answers at ${this.baseUrl}: the local model is not running.`);
  }

  private async reach(path: string, init?: RequestInit): Promise<Response> {
    try {
      return await fetch(`${this.baseUrl}${path}`, init);
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') throw e;
      throw this.notRunning();
    }
  }

  private holds(names: string[]): boolean {
    const wanted = this.model.includes(':') ? this.model : `${this.model}:latest`;
    return names.some(n => n === this.model || n === wanted);
  }

  async probe(): Promise<{ ok: boolean; reason?: string }> {
    let res: Response;
    try {
      res = await this.reach('/api/tags');
    } catch (e) {
      return { ok: false, reason: (e as Error).message };
    }
    if (!res.ok) return { ok: false, reason: `The local model answered ${res.status}.` };
    const body = await res.json() as { models?: { name?: string; model?: string }[] };
    const names = (body.models ?? []).flatMap(m => [m.name, m.model].filter((n): n is string => !!n));
    if (!this.model) return { ok: false, reason: 'No local model is chosen yet.' };
    return this.holds(names) ? { ok: true } : { ok: false, reason: `The local runtime holds no model named ${this.model}.` };
  }

  async chat(request: IDoorRequest, onText?: (text: string) => void, signal?: AbortSignal, model = this.model): Promise<ILocalAnswer> {
    const res = await this.reach('/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal,
      body: JSON.stringify({
        model,
        // The frozen part first, as the door asks of every provider
        messages: [{ role: 'system', content: request.system }, ...request.messages],
        stream: !!onText,
        think: false,
        // A local grammar holds every word of a schema, so it takes the one tightened to this ask
        ...(request.schema ? { format: request.tight ?? request.schema } : {}),
        options: { num_predict: request.maxTokens }
      })
    });
    if (res.status === 404) throw new LocalUnreachable(`The local runtime holds no model named ${model}.`);
    if (!res.ok) throw new Error(`The local model answered ${res.status}.`);

    type Chunk = { message?: { content?: string }; done?: boolean; done_reason?: string; prompt_eval_count?: number; eval_count?: number; error?: string };
    const finish = (text: string, last: Chunk): ILocalAnswer => {
      if (last.error) throw new Error(last.error);
      return { text, stop: last.done_reason === 'length' ? 'length' : 'done', inputTokens: last.prompt_eval_count, outputTokens: last.eval_count };
    };

    if (!onText) {
      const body = await res.json() as Chunk;
      return finish(body.message?.content ?? '', body);
    }

    // A stream is one JSON object a line
    let text = '';
    let last: Chunk = {};
    let buffer = '';
    const decoder = new TextDecoder();
    const take = (line: string) => {
      if (!line.trim()) return;
      const chunk = JSON.parse(line) as Chunk;
      const piece = chunk.message?.content ?? '';
      if (piece) { text += piece; onText(piece); }
      last = chunk;
    };
    for await (const bytes of res.body as unknown as AsyncIterable<Uint8Array>) {
      buffer += decoder.decode(bytes, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      lines.forEach(take);
    }
    take(buffer + decoder.decode());
    return finish(text, last);
  }
}

/** Is Ollama on this machine, running or not? Its usual places, then the PATH. */
async function ollamaOnDisk(): Promise<boolean> {
  const { access } = await import('node:fs/promises');
  const { join, delimiter } = await import('node:path');
  const exe = process.platform === 'win32' ? 'ollama.exe' : 'ollama';
  const places = [
    ...(process.env.LOCALAPPDATA ? [join(process.env.LOCALAPPDATA, 'Programs', 'Ollama', exe)] : []),
    ...(process.platform === 'darwin' ? ['/Applications/Ollama.app'] : []),
    ...(process.env.PATH ?? '').split(delimiter).filter(Boolean).map(dir => join(dir, exe))
  ];
  for (const place of places) {
    try { await access(place); return true; } catch { /* not here */ }
  }
  return false;
}

/**
 * Where the local model is and which one. The model is the person's setting; until they pick,
 * it is the suggestion in the door's options (data, not code), or WS_LOCAL_MODEL.
 */
export function localRuntimeFrom(env: NodeJS.ProcessEnv = process.env, from?: { url?: string }): ILocalRuntime {
  return new OllamaRuntime(env.WS_LOCAL_URL?.trim() || from?.url || 'http://127.0.0.1:11434', env.WS_LOCAL_MODEL?.trim() || '');
}
