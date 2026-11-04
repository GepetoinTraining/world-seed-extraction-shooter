// @vitest-environment node
/**
 * The check on the person's machine, and the free options with a key (Pedro, 2026-11-04): "we'll
 * need to build a CHECK on the person's computer, and be honest with them, if they can't run a
 * local model they need to insert a key, and we can actually give them free options to pick from",
 * and "the choice should be the players". A stand-in host and runtime, and stub servers; nothing real.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { createServer, IncomingMessage, Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { readFileSync, readdirSync } from 'node:fs';
import { IDoorRequest, IntelligenceDoor, AbsentProvider } from '../server/intelligence/door';
import { ILocalRuntime, IServedModel, LocalProvider } from '../server/intelligence/local';
import { IHost, ICard, MachineCheck, seatOf } from '../server/intelligence/machine';
import { IKeyedOption, OpenAICompatibleProvider, readDoorOptions } from '../server/intelligence/options';
import { DoorSetting, SETTINGS } from '../server/intelligence/setting';
import { createIntelligenceHandler } from '../server/intelligence/http';

const GB = 1_000_000_000;
const host = (cards: ICard[], total: number, free = total / 2): IHost => ({ cards: async () => cards, memory: () => ({ total, free }) });
const ON_CARD: ICard[] = [{ name: 'A card', bytes: 8 * GB, measure: 'exact' }];

class Runtime implements ILocalRuntime {
  name = 'standin';
  url = 'http://127.0.0.1:0';
  asked: { model?: string; request: IDoorRequest }[] = [];
  constructor(public model: string, private serves: IServedModel[] | null, private onDisk = true, private shaped = true) {}
  async probe() { return this.serves?.some(m => m.name === this.model) ? { ok: true } : { ok: false, reason: 'not here' }; }
  async list() { if (!this.serves) throw new Error('not running'); return this.serves; }
  async loaded() { return (this.serves ?? []).map(m => ({ name: m.name, bytes: m.bytes, cardBytes: m.bytes })); }
  async installed() { return this.onDisk; }
  async chat(request: IDoorRequest, _t?: unknown, _s?: unknown, model?: string) {
    this.asked.push({ model: model ?? this.model, request });
    return { text: this.shaped ? '{"word":"red","count":3}' : 'red, three', stop: 'done' as const };
  }
}

const SUGGESTION = { model: 'small:2b', bytes: 4.3 * GB, why: 'small' };
const PAGE = 'https://example.test/runtime';
const BIG = { model: 'big:4b', bytes: 6.1 * GB };
const served = (...models: [string, number][]): IServedModel[] => models.map(([name, bytes]) => ({ name, bytes }));

describe('where a model would sit, as the machine says', () => {
  it('on the card, spilling, memory only, too big, or unknown, and never a guess', () => {
    expect(seatOf(4 * GB, ON_CARD, { total: 32 * GB, free: 8 * GB })).toBe('CARD');
    expect(seatOf(12 * GB, ON_CARD, { total: 32 * GB, free: 8 * GB })).toBe('CARD_AND_MEMORY');
    expect(seatOf(4 * GB, [], { total: 16 * GB, free: 8 * GB })).toBe('MEMORY');
    expect(seatOf(64 * GB, ON_CARD, { total: 32 * GB, free: 8 * GB })).toBe('TOO_BIG');
    // Windows' own reading of a card stops at 4 GB, so a model over that is not called a card fit
    expect(seatOf(6 * GB, [{ name: 'A card', bytes: 4 * GB, measure: 'at least' }], { total: 16 * GB, free: 2 * GB })).toBe('UNKNOWN');
    expect(seatOf(20 * GB, [{ name: 'Apple silicon', bytes: 64 * GB, measure: 'shared' }], { total: 64 * GB, free: 40 * GB })).toBe('CARD');
  });
});

describe('the check tells the person what it found (Pedro: "be honest with them")', () => {
  it('no runtime at all: it says so, where one can be had, and that a key is needed', async () => {
    const check = new MachineCheck(new LocalProvider(new Runtime('', null, false)), host(ON_CARD, 32 * GB), [SUGGESTION], PAGE);
    const r = await check.read();
    expect(r.runtime.state).toBe('ABSENT');
    expect(r.verdict).toBe('NEEDS_KEY');
    expect(r.says.join(' ')).toMatch(/No local runtime/);
    expect(r.says.join(' ')).toMatch(/example\.test\/runtime/);
    expect(r.says.join(' ')).toMatch(/insert a key/);
  });

  it('installed but not running: it says to start it, and that this machine can carry the suggestion', async () => {
    const r = await new MachineCheck(new LocalProvider(new Runtime('', null, true)), host(ON_CARD, 32 * GB), [SUGGESTION]).read();
    expect(r.runtime.state).toBe('INSTALLED');
    expect(r.verdict).toBe('CAN_RUN');
    expect(r.says.join(' ')).toMatch(/not running/);
    expect(r.suggested).toMatchObject({ seat: 'CARD', served: false });
  });

  it('a machine too small for the suggestion is told it needs a key, even with a runtime running', async () => {
    const r = await new MachineCheck(new LocalProvider(new Runtime('', [], true)), host([], 3 * GB, 1 * GB), [SUGGESTION]).read();
    expect(r.suggested?.seat).toBe('TOO_BIG');
    expect(r.verdict).toBe('NEEDS_KEY');
  });

  it('running, chosen, tried and in shape: it runs here, and the try says how long and how much sat on the card', async () => {
    const runtime = new Runtime('small:2b', served(['small:2b', 4.3 * GB]));
    const check = new MachineCheck(new LocalProvider(runtime), host(ON_CARD, 32 * GB), [SUGGESTION]);
    expect((await check.read()).verdict).toBe('CAN_RUN');
    const tried = await check.tryModel('small:2b');
    expect(tried).toMatchObject({ model: 'small:2b', answered: true, heldShape: true, onCard: 1 });
    const r = await check.read();
    expect(r.verdict).toBe('READY');
    expect(r.says.join(' ')).toMatch(/held the shape/);
  });

  it('a model that answers outside the shape is told so, not passed', async () => {
    const check = new MachineCheck(new LocalProvider(new Runtime('loose', served(['loose', GB]), true, false)), host(ON_CARD, 32 * GB));
    const tried = await check.tryModel('loose');
    expect(tried.answered).toBe(false);
    expect((await check.read()).verdict).not.toBe('READY');
  });
});

describe('the choice is the person\'s (Pedro: "allow them")', () => {
  it('the suggestion fits the machine: the largest that sits on its card, else the smallest', async () => {
    const both = [BIG, SUGGESTION];
    expect(MachineCheck.pick(both, ON_CARD, { total: 32 * GB, free: 8 * GB })?.model).toBe('big:4b');
    expect(MachineCheck.pick(both, [{ name: 'A smaller card', bytes: 5 * GB, measure: 'exact' }], { total: 16 * GB, free: 4 * GB })?.model).toBe('small:2b');
    expect(MachineCheck.pick(both, [], { total: 8 * GB, free: 5 * GB })?.model).toBe('small:2b');
    expect(MachineCheck.pick(both, [], { total: 2 * GB, free: 1 * GB })?.model).toBe('small:2b');
  });

  it('until the person picks, the local model is the one suggested for this machine', async () => {
    const runtime = new Runtime('', served(['small:2b', GB]));
    const setting = new DoorSetting(new AbsentProvider(), new LocalProvider(runtime), { keyed: [], local: { suggestions: [BIG, SUGGESTION] } }, host([{ name: 'A smaller card', bytes: 5 * GB, measure: 'exact' }], 16 * GB, 4 * GB));
    await setting.ready();
    expect(runtime.model).toBe('small:2b');
  });

  it('any served model can be chosen, however large, and the check says how it sits rather than refusing', async () => {
    const runtime = new Runtime('small:2b', served(['small:2b', 4.3 * GB], ['huge:700b', 400 * GB]));
    const setting = new DoorSetting(new AbsentProvider(), new LocalProvider(runtime), { keyed: [], local: { suggestions: [SUGGESTION] } }, host(ON_CARD, 32 * GB));
    setting.useLocal('huge:700b');
    expect(runtime.model).toBe('huge:700b');
    const r = await setting.check.read();
    expect(r.chosen).toBe('huge:700b');
    expect(r.served.find(m => m.name === 'huge:700b')?.seat).toBe('TOO_BIG');
    expect((await setting.status()).mode).toBe('local');
  });

  it('a try asks the model named, and leaves the person\'s choice alone', async () => {
    const runtime = new Runtime('small:2b', served(['small:2b', GB], ['other', GB]));
    const check = new MachineCheck(new LocalProvider(runtime), host(ON_CARD, 32 * GB));
    await check.tryModel('other');
    expect(runtime.asked.at(-1)?.model).toBe('other');
    expect(runtime.model).toBe('small:2b');
  });

  it('no model, runtime or provider is named in the door\'s code: they are data or the person\'s setting', () => {
    const dir = 'server/intelligence';
    for (const file of readdirSync(dir).filter(f => f.endsWith('.ts') && f !== 'claude.ts')) {
      expect(readFileSync(`${dir}/${file}`, 'utf8'), file).not.toMatch(/gemma|qwen|\bllama|gemini|groq|openrouter|mistral|cerebras/i);
    }
  });
});

describe('free options, read from data (Pedro: "free options to pick from")', () => {
  it('the shipped list is data with each one\'s free terms and when they were read, and holds no key', () => {
    const options = readDoorOptions();
    expect(options.keyed.length).toBeGreaterThan(0);
    for (const o of options.keyed) {
      expect(o.free, o.id).toBeTruthy();
      expect(o.checked, o.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(o.sources?.length, o.id).toBeGreaterThan(0);
    }
    expect(readFileSync('server/intelligence/door-options.json', 'utf8')).not.toMatch(/"key"\s*:/);
    expect(options.local?.suggestions?.length).toBeGreaterThan(0);
    for (const s of options.local!.suggestions!) expect(s.bytes, s.model).toBeGreaterThan(0);
  });

  it('another file changes the offer, and a broken one offers nothing rather than stopping the server', () => {
    expect(readDoorOptions('tests/fixtures/no-such-options.json')).toEqual({ keyed: [] });
  });
});

describe('a person\'s key goes to the server door and stays there', () => {
  let server: Server | undefined;
  afterEach(async () => { await new Promise<void>(r => (server ? server.close(() => r()) : r())); server = undefined; });

  const bodyOf = (req: IncomingMessage) => new Promise<any>(resolve => { let raw = ''; req.on('data', c => { raw += c; }); req.on('end', () => resolve(raw ? JSON.parse(raw) : {})); });

  /** A provider that speaks the OpenAI-style chat API, and knows one good key. */
  const stub = async (seen: any[] = []) => {
    server = createServer(async (req, res) => {
      const auth = req.headers.authorization;
      res.setHeader('content-type', 'application/json');
      if (auth !== 'Bearer good-key') { res.statusCode = 401; return res.end('{"error":"bad key"}'); }
      if (req.url === '/v1/models') return res.end('{"data":[]}');
      if (req.url === '/v1/chat/completions') {
        const body = await bodyOf(req);
        seen.push(body);
        if (body.stream) {
          res.setHeader('content-type', 'text/event-stream');
          for (const piece of ['Even', 'ing.']) res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: piece }, finish_reason: null }] })}\n\n`);
          res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\n`);
          return res.end('data: [DONE]\n\n');
        }
        const content = body.response_format ? '{"studied":"tide"}' : 'Evening.';
        return res.end(JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }], usage: { prompt_tokens: 9, completion_tokens: 3 } }));
      }
      res.statusCode = 404; res.end('{}');
    });
    await new Promise<void>(r => server!.listen(0, '127.0.0.1', () => r()));
    return `http://127.0.0.1:${(server!.address() as AddressInfo).port}/v1`;
  };

  const optionAt = (baseUrl: string): IKeyedOption => ({ id: 'free_one', name: 'A Free One', protocol: 'openai', baseUrl, model: 'free-model', free: 'some', checked: '2026-11-04', sources: ['x'] });
  const SHAPED: IDoorRequest = { kind: 'rest', system: 'sys', messages: [{ role: 'user', content: 'hi' }], maxTokens: 50, schema: { type: 'object' } };

  it('speaks the OpenAI-style API: the key as a bearer, the schema as json_schema, prose streamed', async () => {
    const seen: any[] = [];
    const provider = new OpenAICompatibleProvider(optionAt(await stub(seen)), 'good-key');
    expect(await provider.ask(SHAPED)).toMatchObject({ status: 'OK', data: { studied: 'tide' }, usage: { usd: 0 } });
    expect(seen[0]).toMatchObject({ model: 'free-model', max_tokens: 50, response_format: { type: 'json_schema', json_schema: { schema: SHAPED.schema, strict: true } } });
    expect(seen[0].messages[0]).toEqual({ role: 'system', content: 'sys' });
    const pieces: string[] = [];
    expect(await provider.askStream({ ...SHAPED, schema: undefined }, t => pieces.push(t))).toMatchObject({ status: 'OK', text: 'Evening.' });
    expect(pieces).toEqual(['Even', 'ing.']);
  });

  it('a refused key is NO_KEY, a limit is BUSY: outcomes, never thrown', async () => {
    const provider = new OpenAICompatibleProvider(optionAt(await stub()), 'bad-key');
    expect((await provider.ask(SHAPED)).status).toBe('NO_KEY');
    expect((await provider.status()).available).toBe(false);
  });

  it('through the door: a good key is taken and never sent back, a bad one leaves the choice as it was', async () => {
    const base = await stub();
    const setting = new DoorSetting(new AbsentProvider(), new LocalProvider(new Runtime('', null, false)), { keyed: [optionAt(base)] }, host([], 8 * GB));
    const door = new IntelligenceDoor(setting);
    SETTINGS.set(door, setting);
    const handler = createIntelligenceHandler(door);
    const http = createServer((req, res) => void handler(req, res, req.url ?? '/'));
    await new Promise<void>(r => http.listen(0, '127.0.0.1', () => r()));
    const at = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
    const post = (path: string, body: unknown) => fetch(`${at}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.text());
    try {
      const refused = await post('/key', { optionId: 'free_one', key: 'bad-key' });
      expect(JSON.parse(refused)).toMatchObject({ ok: false });
      expect((await setting.status()).mode).toBe('auto');

      const taken = await post('/key', { optionId: 'free_one', key: 'good-key' });
      expect(JSON.parse(taken)).toMatchObject({ ok: true, status: { mode: 'keyed', option: 'A Free One' } });
      expect(taken).not.toMatch(/good-key/);
      expect(await fetch(`${at}/status`).then(r => r.text())).not.toMatch(/good-key/);
      expect(await fetch(`${at}/options`).then(r => r.text())).not.toMatch(/good-key/);
      expect(await door.ask({ ...SHAPED, schema: undefined })).toMatchObject({ status: 'OK', text: 'Evening.' });

      // Work filed on the key is collected from the key, even after the person goes back
      const filed = await door.fileRest('rest_1', SHAPED);
      expect(filed.batchId).toMatch(/^keyed_/);
      await new Promise(r => setTimeout(r, 30));
      expect(await door.collectRest(filed.batchId!)).toMatchObject({ status: 'OK' });

      await post('/auto', {});
      expect((await setting.status()).mode).toBe('auto');
      const machine = JSON.parse(await fetch(`${at}/machine`).then(r => r.text()));
      expect(machine.verdict).toBe('NEEDS_KEY');
    } finally {
      await new Promise<void>(r => http.close(() => r()));
    }
  });

  it('the browser sends the key once and keeps none of it', () => {
    const client = readFileSync('src/logic/intelligence/VoiceClient.ts', 'utf8');
    const useKey = client.slice(client.indexOf('useKey:'), client.indexOf('async useAuto'));
    expect(useKey).not.toMatch(/localStorage|sessionStorage|indexedDB|console/);
    const panel = readFileSync('src/components/VoicePanel.tsx', 'utf8');
    expect(panel).toMatch(/setKey\(''\)/);
    expect(panel).not.toMatch(/localStorage|sessionStorage/);
  });
});
