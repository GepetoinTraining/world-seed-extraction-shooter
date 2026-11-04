// @vitest-environment node
/**
 * THE DOOR IN THE PAGE (Pedro, 2026-11-04: "their IDB makes the call, not our Turso or postgress").
 * Played from the domain, the game holds its own door: the same routes and shapes as the server's,
 * asking a model on the player's machine, or a provider on the player's own key, from the page.
 * Our servers never make or carry a model call. These bars stand on stubs of Ollama's and
 * Anthropic's HTTP APIs; nothing is pulled, run or billed.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { createServer, IncomingMessage, Server, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { openPageDoor } from '../src/logic/intelligence/PageDoor';
import { createKeyVault, IKeyShelf } from '../src/logic/intelligence/KeyVault';
import { DoorTransport } from '../src/logic/intelligence/DoorTransport';
import { IntelligenceClient } from '../src/logic/intelligence/IntelligenceClient';
import { VoiceClient } from '../src/logic/intelligence/VoiceClient';

const open: Server[] = [];
afterEach(async () => {
  DoorTransport.useServer();
  await Promise.all(open.splice(0).map(s => new Promise<void>(r => s.close(() => r()))));
});

const listen = async (handler: (req: IncomingMessage, res: ServerResponse) => void) => {
  const server = createServer(handler);
  open.push(server);
  await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r()));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
};

const ollamaStub = (models: string[]) => listen(async (req, res) => {
  res.setHeader('content-type', 'application/json');
  if (req.url === '/api/tags') return res.end(JSON.stringify({ models: models.map(name => ({ name, model: name, size: 3_300_000_000 })) }));
  if (req.url === '/api/ps') return res.end(JSON.stringify({ models: [] }));
  if (req.url === '/api/chat') {
    let raw = '';
    for await (const c of req) raw += c;
    const body = JSON.parse(raw);
    if (body.stream) {
      res.setHeader('content-type', 'application/x-ndjson');
      for (const piece of ['The ', 'lamp ', 'is lit.']) res.write(`${JSON.stringify({ message: { role: 'assistant', content: piece }, done: false })}\n`);
      return res.end(`${JSON.stringify({ message: { role: 'assistant', content: '' }, done: true, done_reason: 'stop', prompt_eval_count: 9, eval_count: 5 })}\n`);
    }
    return res.end(JSON.stringify({ message: { role: 'assistant', content: 'The lamp is lit.' }, done: true, done_reason: 'stop', prompt_eval_count: 9, eval_count: 5 }));
  }
  res.statusCode = 404; res.end('{}');
});

/** A shelf the way a test holds one: a map, whose contents can be looked at. */
const mapShelf = () => {
  const held = new Map<string, unknown>();
  const shelf: IKeyShelf = { get: async id => held.get(id), put: async (id, v) => { held.set(id, v); }, delete: async id => { held.delete(id); } };
  return { held, shelf };
};

describe('the door in the page', () => {
  it('answers the same routes with no server: the local model, read and asked from the page', async () => {
    const ollama = await ollamaStub(['gemma4:e4b-it-qat']);
    const page = openPageDoor({ localUrl: ollama, localModel: 'gemma4:e4b-it-qat' });
    expect((await page.answer('GET', '/status', {})).json).toMatchObject({ available: true, provider: 'local', model: 'ollama:gemma4:e4b-it-qat' });
    const reading: any = (await page.answer('GET', '/machine', {})).json;
    expect(reading.served.map((m: any) => m.name)).toContain('gemma4:e4b-it-qat');

    const talk = await page.answer('POST', '/kami/talk', { messages: [{ role: 'user', content: 'Hello?' }] });
    const lines: string[] = [];
    const last = await talk.stream!(line => lines.push(line), new AbortController().signal);
    expect(lines.map(l => JSON.parse(l).text).join('')).toBe('The lamp is lit.');
    expect(JSON.parse(last)).toMatchObject({ done: true, status: 'OK', usage: { usd: 0 } });
  });

  it('the game\'s clients ask the page\'s door, and nothing goes to a server', async () => {
    const ollama = await ollamaStub(['gemma4:e4b-it-qat']);
    DoorTransport.usePage(openPageDoor({ localUrl: ollama, localModel: 'gemma4:e4b-it-qat' }));
    expect(await IntelligenceClient.status()).toMatchObject({ available: true, provider: 'local' });
    expect(await VoiceClient.status()).toMatchObject({ mode: 'auto', provider: 'local' });
    const pieces: string[] = [];
    const out = await IntelligenceClient.talkKami([{ role: 'user', content: 'Hello?' }], t => pieces.push(t));
    expect(pieces.join('')).toBe('The lamp is lit.');
    expect(out.status).toBe('OK');
  });

  it('a player\'s own Anthropic key is used from the page, straight to the provider, marked as a browser\'s call', async () => {
    const seen: { url?: string; headers: IncomingMessage['headers'] }[] = [];
    const anthropic = await listen((req, res) => {
      seen.push({ url: req.url, headers: req.headers });
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ id: 'claude-opus-5-5', type: 'model', display_name: 'stub', created_at: '2026-01-01T00:00:00Z' }));
    });
    const page = openPageDoor({ localUrl: 'http://127.0.0.1:1', options: { keyed: [{ id: 'anthropic', name: 'Anthropic, your own key', protocol: 'anthropic', baseUrl: anthropic, model: 'claude-opus-5-5' }] } });
    const out: any = (await page.answer('POST', '/key', { optionId: 'anthropic', key: 'sk-ant-player-test' })).json;
    expect(out).toMatchObject({ ok: true, status: { mode: 'keyed', option: 'Anthropic, your own key' } });
    expect(JSON.stringify(out)).not.toContain('sk-ant-player-test');
    // The SDK carries the key in its own header (this version: a bearer token); either way it goes to the provider
    const carried = seen[0].headers['x-api-key'] ?? String(seen[0].headers.authorization ?? '').replace(/^Bearer /, '');
    expect(carried).toBe('sk-ant-player-test');
    expect(seen[0].headers['anthropic-dangerous-direct-browser-access']).toBe('true');
  });
});

describe('the player\'s key, kept in their browser', () => {
  it('is kept sealed: what sits on the shelf never holds the key as written', async () => {
    const { held, shelf } = mapShelf();
    const vault = createKeyVault(shelf);
    await vault.keep('groq', 'gsk_player_secret_1234567890');
    const stored = JSON.stringify([...held.entries()], (_k, v) => (v instanceof ArrayBuffer || ArrayBuffer.isView(v) ? Buffer.from(v as ArrayBuffer).toString('latin1') : v));
    expect(stored).not.toContain('gsk_player_secret_1234567890');
    expect(await vault.read()).toEqual({ optionId: 'groq', key: 'gsk_player_secret_1234567890' });
  });

  it('the sealing key cannot be taken out of the browser, and forgetting takes both away', async () => {
    const { held, shelf } = mapShelf();
    const vault = createKeyVault(shelf);
    await vault.keep('groq', 'gsk_player_secret_1234567890');
    const sealing = [...held.values()].map((v: any) => v?.sealing).find(Boolean) as CryptoKey;
    expect(sealing.extractable).toBe(false);
    await expect(crypto.subtle.exportKey('raw', sealing)).rejects.toThrow();
    await vault.forget();
    expect(held.size).toBe(0);
    expect(await vault.read()).toBeNull();
  });
});
