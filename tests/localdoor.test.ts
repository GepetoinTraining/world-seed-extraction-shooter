// @vitest-environment node
/**
 * The door with no key (Q24, Q37). Pedro: "local model". With no key the door answers through a
 * model on this machine, as a mode a player can have: the same voice, dream and lore. The runtime
 * sits behind an interface; these bars use a stand-in runtime, and a stub server that answers the
 * way Ollama's HTTP API does. No model is pulled or run here.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { createServer, IncomingMessage, Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { AbsentProvider, IntelligenceDoor, IDoorRequest, IDoorOutcome, IIntelligenceProvider, IProviderStatus, REST_SPEND_LIMIT_USD } from '../shared/intelligence/door';
import { chooseProvider } from '../server/intelligence/index';
import { ILocalRuntime, ILocalAnswer, KeyOrLocalProvider, LocalProvider, LocalUnreachable, OllamaRuntime } from '../shared/intelligence/local';
import { buildCreationRequest, buildNpcTalkRequest } from '../shared/intelligence/prompts';

const PROSE: IDoorRequest = { kind: 'npc_talk', system: 'You are a keeper.', messages: [{ role: 'user', content: 'Good evening.' }], maxTokens: 200 };
const SHAPED: IDoorRequest = { ...PROSE, kind: 'rest', schema: { type: 'object', properties: { studied: { type: 'string' } } } };

/** A stand-in for a model on this machine: it answers what it is told to, and keeps what it was asked. */
class StandIn implements ILocalRuntime {
  name = 'standin';
  model = 'standin:small';
  asked: IDoorRequest[] = [];
  constructor(private answer: (r: IDoorRequest) => ILocalAnswer | Promise<ILocalAnswer> = () => ({ text: 'Evening.', stop: 'done' }), private running = true) {}
  async probe() { return this.running ? { ok: true } : { ok: false, reason: 'Nothing answers: the local model is not running.' }; }
  async chat(request: IDoorRequest, onText?: (t: string) => void) {
    if (!this.running) throw new LocalUnreachable('Nothing answers: the local model is not running.');
    this.asked.push(request);
    const out = await this.answer(request);
    if (onText) for (const piece of out.text.match(/.{1,3}/gs) ?? []) onText(piece);
    return out;
  }
}

/** Claude as it stands with no credentials: every call says there is no key. */
class Keyless implements IIntelligenceProvider {
  name = 'claude';
  calls = 0;
  async status(): Promise<IProviderStatus> { this.calls++; return { available: false, provider: 'claude', reason: 'The server holds no key.', outcome: 'NO_KEY' }; }
  async ask(): Promise<IDoorOutcome> { this.calls++; return { status: 'NO_KEY', reason: 'The server holds no key.' }; }
  async file() { this.calls++; return { status: 'NO_KEY' as const, reason: 'The server holds no key.' }; }
  async collect(): Promise<IDoorOutcome> { this.calls++; return { status: 'NO_KEY' }; }
  ceiling(): number { return 1; }
}

/** Claude with a key that works. */
class Keyed extends Keyless {
  async status(): Promise<IProviderStatus> { return { available: true, provider: 'claude', model: 'claude-sonnet-5-5' }; }
  async ask(): Promise<IDoorOutcome> { this.calls++; return { status: 'OK', text: 'From Claude.' }; }
}

const settle = async (provider: IIntelligenceProvider, batchId: string) => {
  for (let i = 0; i < 50; i++) {
    const out = await provider.collect(batchId);
    if (out.status !== 'PENDING') return out;
    await new Promise(r => setTimeout(r, 5));
  }
  throw new Error('never settled');
};

describe('the local provider, on a stand-in runtime', () => {
  it('answers prose as prose, and costs nothing', async () => {
    const local = new LocalProvider(new StandIn());
    const out = await local.ask(PROSE);
    expect(out).toMatchObject({ status: 'OK', text: 'Evening.' });
    expect(out.usage?.usd).toBe(0);
    expect(out.usage?.model).toBe('standin:standin:small');
    expect(local.ceiling()).toBe(0);
    await expect(new IntelligenceDoor(local).fileWindow("w", SHAPED, 0.49)).resolves.toMatchObject({ ceiling: 0 });
  });

  it('parses what has a schema, and hands the law what it parsed', async () => {
    const local = new LocalProvider(new StandIn(() => ({ text: '{"studied":"how the ropes hang"}', stop: 'done' })));
    expect(await local.ask(SHAPED)).toMatchObject({ status: 'OK', data: { studied: 'how the ropes hang' } });
  });

  it('drops a thinking block a small model writes before its answer', async () => {
    const local = new LocalProvider(new StandIn(() => ({ text: '<think>\nhmm\n</think>\n{"studied":"x"}', stop: 'done' })));
    expect(await local.ask(SHAPED)).toMatchObject({ status: 'OK', data: { studied: 'x' } });
  });

  it('says so when what came back is cut off or does not parse', async () => {
    expect((await new LocalProvider(new StandIn(() => ({ text: '{"studied":"how th', stop: 'length' }))).ask(SHAPED)).status).toBe('CUT_OFF');
    expect((await new LocalProvider(new StandIn(() => ({ text: 'not json', stop: 'done' }))).ask(SHAPED)).status).toBe('CUT_OFF');
  });

  it('a runtime that is not running is an outcome, not an error: OFFLINE, and the reason says why', async () => {
    const local = new LocalProvider(new StandIn(undefined, false));
    const out = await local.ask(PROSE);
    expect(out.status).toBe('OFFLINE');
    expect(out.reason).toMatch(/not running/);
    expect(await local.status()).toMatchObject({ available: false, provider: 'local' });
    expect((await local.file('rest_1', SHAPED)).status).toBe('OFFLINE');
  });

  it('streams in pieces, and the pieces make the answer', async () => {
    const local = new LocalProvider(new StandIn(() => ({ text: 'The table is open.', stop: 'done' })));
    const pieces: string[] = [];
    const out = await local.askStream!(PROSE, t => pieces.push(t));
    expect(pieces.length).toBeGreaterThan(1);
    expect(pieces.join('')).toBe('The table is open.');
    expect(out.text).toBe('The table is open.');
  });

  it('files a rest the way a batch is filed: PENDING with an id, then collected once', async () => {
    let release!: () => void;
    const gate = new Promise<void>(r => { release = r; });
    const local = new LocalProvider(new StandIn(async () => { await gate; return { text: '{"studied":"the knots"}', stop: 'done' }; }));
    const filed = await local.file('rest_p1_3', SHAPED);
    expect(filed.status).toBe('PENDING');
    expect(filed.batchId).toMatch(/^local_/);
    expect((await local.collect(filed.batchId!)).status).toBe('PENDING');
    release();
    expect(await settle(local, filed.batchId!)).toMatchObject({ status: 'OK', data: { studied: 'the knots' } });
    // Collected, it is gone: a second read says so instead of paying twice
    expect((await local.collect(filed.batchId!)).status).toBe('OUTAGE');
  });
});

describe('with no key, the door runs on the local model (Q24)', () => {
  it('a call Claude cannot make for want of a key is made locally, and the person gets words', async () => {
    const claude = new Keyless();
    const runtime = new StandIn(() => ({ text: 'Evening. Mind the step.', stop: 'done' }));
    const door = new IntelligenceDoor(new KeyOrLocalProvider(claude, new LocalProvider(runtime)));
    const out = await door.ask(PROSE);
    expect(out).toMatchObject({ status: 'OK', text: 'Evening. Mind the step.' });
    expect(runtime.asked).toHaveLength(1);
    expect((await door.status())).toMatchObject({ available: true, provider: 'local' });
  });

  it('a key that works keeps Claude: the local model is never asked', async () => {
    const runtime = new StandIn();
    const door = new IntelligenceDoor(new KeyOrLocalProvider(new Keyed(), new LocalProvider(runtime)));
    expect(await door.ask(PROSE)).toMatchObject({ status: 'OK', text: 'From Claude.' });
    expect(runtime.asked).toHaveLength(0);
  });

  it('a rest with no key is filed locally and collected through the same door, with no spend guard in the way', async () => {
    const big: IDoorRequest = { ...SHAPED, system: 'x'.repeat(2_000_000), maxTokens: 64_000 };
    const runtime = new StandIn(() => ({ text: '{"studied":"the long count"}', stop: 'done' }));
    const door = new IntelligenceDoor(new KeyOrLocalProvider(new Keyless(), new LocalProvider(runtime)));
    const filed = await door.fileRest('rest_p1_4', big);
    expect(filed.status).toBe('PENDING');
    for (let i = 0; i < 50; i++) {
      const out = await door.collectRest(filed.batchId!);
      if (out.status === 'PENDING') { await new Promise(r => setTimeout(r, 5)); continue; }
      expect(out).toMatchObject({ status: 'OK', data: { studied: 'the long count' } });
      return;
    }
    throw new Error('never collected');
  });

  it('a window with no key is filed locally too, and says it cost nothing', async () => {
    const door = new IntelligenceDoor(new KeyOrLocalProvider(new Keyless(), new LocalProvider(new StandIn(() => ({ text: '{}', stop: 'done' })))));
    const filed = await door.fileWindow('window_1', SHAPED, 0.49);
    expect(filed).toMatchObject({ status: 'PENDING', ceiling: 0 });
    expect(REST_SPEND_LIMIT_USD).toBeGreaterThan(0);
  });

  it('no key and no local model: the game goes on as it did, OFFLINE with the reason', async () => {
    const door = new IntelligenceDoor(new KeyOrLocalProvider(new Keyless(), new LocalProvider(new StandIn(undefined, false))));
    const out = await door.ask(PROSE);
    expect(out.status).toBe('OFFLINE');
    expect((await door.status()).available).toBe(false);
  });

  it('the server chooses: none turns it off, local asks for the local mode, and otherwise the key decides', () => {
    expect(chooseProvider({ WS_LLM_PROVIDER: 'none' } as NodeJS.ProcessEnv)).toBeInstanceOf(AbsentProvider);
    expect(chooseProvider({ WS_LLM_PROVIDER: 'local' } as NodeJS.ProcessEnv)).toBeInstanceOf(LocalProvider);
    expect(chooseProvider({} as NodeJS.ProcessEnv)).toBeInstanceOf(KeyOrLocalProvider);
  });

  it('the real asks go through unchanged: a creation and a keeper\'s round reach the local model whole', async () => {
    const runtime = new StandIn(r => ({ text: r.schema ? '{}' : 'ok', stop: 'done' }));
    const door = new IntelligenceDoor(new KeyOrLocalProvider(new Keyless(), new LocalProvider(runtime)));
    const creation = buildCreationRequest({ count: 3, candidates: [] });
    await door.ask(creation);
    await door.askTalk('t1', buildNpcTalkRequest({ who: { name: 'A', rank: 'D', temperament: '', objective: '', want: '', alignment: '', mind: {}, hands: [] }, memory: [], said: 'hi', roll: 50, required: 50, bonuses: {}, meter: 50 }));
    expect(runtime.asked.map(r => r.kind)).toEqual(['creation', 'npc_talk']);
    expect(runtime.asked[0].schema).toEqual(creation.schema);
    expect(runtime.asked[0].system).toBe(creation.system);
  });
});

describe('Ollama, as the first runtime, against a stub of its HTTP API', () => {
  let server: Server | undefined;
  afterEach(async () => { await new Promise<void>(r => (server ? server.close(() => r()) : r())); server = undefined; });

  const bodyOf = (req: IncomingMessage) => new Promise<any>(resolve => {
    let raw = '';
    req.on('data', c => { raw += c; });
    req.on('end', () => resolve(raw ? JSON.parse(raw) : {}));
  });

  const stub = async (models: string[], seen: any[] = []) => {
    server = createServer(async (req, res) => {
      if (req.url === '/api/tags') { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ models: models.map(name => ({ name, model: name })) })); }
      if (req.url === '/api/chat') {
        const body = await bodyOf(req);
        seen.push(body);
        if (!models.includes(body.model)) { res.statusCode = 404; return res.end(JSON.stringify({ error: `model '${body.model}' not found` })); }
        const answer = body.format ? '{"studied":"tide"}' : 'Evening.';
        if (body.stream) {
          res.setHeader('content-type', 'application/x-ndjson');
          for (const piece of answer.match(/.{1,4}/g)!) res.write(`${JSON.stringify({ message: { role: 'assistant', content: piece }, done: false })}\n`);
          return res.end(`${JSON.stringify({ message: { role: 'assistant', content: '' }, done: true, done_reason: 'stop', prompt_eval_count: 12, eval_count: 4 })}\n`);
        }
        res.setHeader('content-type', 'application/json');
        return res.end(JSON.stringify({ message: { role: 'assistant', content: answer }, done: true, done_reason: 'stop', prompt_eval_count: 12, eval_count: 4 }));
      }
      res.statusCode = 404; res.end();
    });
    await new Promise<void>(r => server!.listen(0, '127.0.0.1', () => r()));
    return `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
  };

  it('sends the frozen system text first, the schema as the format, the room as num_predict, with thinking off', async () => {
    const seen: any[] = [];
    const url = await stub(['qwen3:8b'], seen);
    const local = new LocalProvider(new OllamaRuntime(url, 'qwen3:8b'));
    const out = await local.ask(SHAPED);
    expect(out).toMatchObject({ status: 'OK', data: { studied: 'tide' }, usage: { inputTokens: 12, outputTokens: 4, usd: 0 } });
    expect(seen[0]).toMatchObject({ model: 'qwen3:8b', stream: false, think: false, format: SHAPED.schema, options: { num_predict: SHAPED.maxTokens } });
    expect(seen[0].messages[0]).toEqual({ role: 'system', content: SHAPED.system });
    expect(seen[0].messages.slice(1)).toEqual(SHAPED.messages);
  });

  it('a schema tightened to the ask is what the local grammar is given', async () => {
    const seen: any[] = [];
    const url = await stub(['qwen3:8b'], seen);
    const tight = { type: 'object', properties: { studied: { type: 'string', enum: ['tide'] } } };
    await new LocalProvider(new OllamaRuntime(url, 'qwen3:8b')).ask({ ...SHAPED, tight });
    expect(seen[0].format).toEqual(tight);
  });

  it('prose has no format, and a stream comes in pieces', async () => {
    const seen: any[] = [];
    const url = await stub(['qwen3:8b'], seen);
    const local = new LocalProvider(new OllamaRuntime(url, 'qwen3:8b'));
    const pieces: string[] = [];
    const out = await local.askStream!(PROSE, t => pieces.push(t));
    expect(seen[0].format).toBeUndefined();
    expect(seen[0].stream).toBe(true);
    expect(pieces.length).toBeGreaterThan(1);
    expect(out).toMatchObject({ status: 'OK', text: 'Evening.' });
  });

  it('knows whether it holds the model it was told to use', async () => {
    const url = await stub(['qwen3:4b']);
    expect(await new LocalProvider(new OllamaRuntime(url, 'qwen3:4b')).status()).toMatchObject({ available: true, provider: 'local', model: 'ollama:qwen3:4b' });
    const missing = await new LocalProvider(new OllamaRuntime(url, 'qwen3:8b')).status();
    expect(missing.available).toBe(false);
    expect(missing.reason).toMatch(/qwen3:8b/);
    expect((await new LocalProvider(new OllamaRuntime(url, 'qwen3:8b')).ask(PROSE)).status).toBe('OFFLINE');
  });

  it('nothing listening is OFFLINE, said plainly', async () => {
    const url = await stub([]);
    await new Promise<void>(r => server!.close(() => r()));
    server = undefined;
    const local = new LocalProvider(new OllamaRuntime(url, 'qwen3:8b'));
    const out = await local.ask(PROSE);
    expect(out.status).toBe('OFFLINE');
    expect(out.reason).toMatch(/not running/);
  });
});
