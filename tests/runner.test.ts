// @vitest-environment node
/**
 * THE RUNNER, on the person's machine (DEPLOY.md): it serves the game to their browser, holds their
 * store and the door to their model, and bridges to a hub. These bars stand on a stub that answers
 * the way Ollama's HTTP API does; no model is pulled or run.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { createServer, IncomingMessage, Server, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHubBridge, createRunnerListener, hubUrlProblem } from '../server/runner';
import { createIntelligenceHandler, openDoor } from '../server/intelligence';

const open: Server[] = [];
const folders: string[] = [];
afterEach(async () => {
  await Promise.all(open.splice(0).map(s => new Promise<void>(r => s.close(() => r()))));
  for (const f of folders.splice(0)) rmSync(f, { recursive: true, force: true });
});

const listen = async (handler: (req: IncomingMessage, res: ServerResponse) => void) => {
  const server = createServer(handler);
  open.push(server);
  await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r()));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
};

/** Ollama, as far as the door asks it: what it serves, and one chat at a time. */
const ollamaStub = (models: string[], seen: any[]) => listen(async (req, res) => {
  if (req.url === '/api/tags') { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ models: models.map(name => ({ name, model: name, size: 3_300_000_000 })) })); }
  if (req.url === '/api/ps') { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ models: [] })); }
  if (req.url === '/api/chat') {
    let raw = '';
    for await (const c of req) raw += c;
    const body = JSON.parse(raw);
    seen.push(body);
    const answer = 'The lamp is lit.';
    if (body.stream) {
      res.setHeader('content-type', 'application/x-ndjson');
      for (const piece of answer.match(/.{1,4}/g)!) res.write(`${JSON.stringify({ message: { role: 'assistant', content: piece }, done: false })}\n`);
      return res.end(`${JSON.stringify({ message: { role: 'assistant', content: '' }, done: true, done_reason: 'stop', prompt_eval_count: 9, eval_count: 5 })}\n`);
    }
    res.setHeader('content-type', 'application/json');
    return res.end(JSON.stringify({ message: { role: 'assistant', content: answer }, done: true, done_reason: 'stop', prompt_eval_count: 9, eval_count: 5 }));
  }
  res.statusCode = 404; res.end();
});

const nothing = async (_req: IncomingMessage, res: ServerResponse) => { res.statusCode = 404; res.end(); };

describe('the runner', () => {
  it('the model reaches the game through the runner: the page\'s own address asks the door, and the door asks the local model', async () => {
    const seen: any[] = [];
    const ollama = await ollamaStub(['gemma3:4b'], seen);
    const door = openDoor({ WS_LLM_PROVIDER: 'local', WS_LOCAL_URL: ollama, WS_LOCAL_MODEL: 'gemma3:4b' });
    const base = await listen(createRunnerListener({ db: nothing, intelligence: createIntelligenceHandler(door), hub: createHubBridge({}), noStatic: true }));

    expect(await (await fetch(`${base}/api/intelligence/status`)).json()).toMatchObject({ available: true, provider: 'local', model: 'ollama:gemma3:4b', mode: 'local' });

    const res = await fetch(`${base}/api/intelligence/kami/talk`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: [{ role: 'user', content: 'Hello?' }] }) });
    const lines = (await res.text()).trim().split('\n').map(l => JSON.parse(l));
    expect(lines.filter(l => l.text).map(l => l.text).join('')).toBe('The lamp is lit.');
    expect(lines.at(-1)).toMatchObject({ done: true, status: 'OK', usage: { usd: 0 } });
    expect(seen[0]).toMatchObject({ model: 'gemma3:4b', stream: true });
    expect(seen[0].messages.at(-1)).toEqual({ role: 'user', content: 'Hello?' });
  });

  it('the check on this machine is read through the same address', async () => {
    const ollama = await ollamaStub(['gemma3:4b'], []);
    const door = openDoor({ WS_LLM_PROVIDER: 'local', WS_LOCAL_URL: ollama, WS_LOCAL_MODEL: 'gemma3:4b' });
    const base = await listen(createRunnerListener({ db: nothing, intelligence: createIntelligenceHandler(door), hub: createHubBridge({}), noStatic: true }));
    const reading = await (await fetch(`${base}/api/intelligence/machine`)).json();
    expect(reading.served.map((m: { name: string }) => m.name)).toContain('gemma3:4b');
    expect(['READY', 'CAN_RUN', 'NEEDS_KEY']).toContain(reading.verdict);
  });

  it('serves the built game at its own address, and any path the game routes to is the game', async () => {
    const dist = mkdtempSync(join(tmpdir(), 'ws-dist-'));
    folders.push(dist);
    writeFileSync(join(dist, 'index.html'), '<!DOCTYPE html><title>World Seed</title><div id="root"></div>');
    writeFileSync(join(dist, 'app.js'), 'console.log(1)');
    const base = await listen(createRunnerListener({ db: nothing, intelligence: nothing, hub: createHubBridge({}), dist }));
    expect(await (await fetch(`${base}/`)).text()).toContain('id="root"');
    expect((await fetch(`${base}/app.js`)).headers.get('content-type')).toMatch(/javascript/);
    expect(await (await fetch(`${base}/somewhere/else`)).text()).toContain('id="root"');
  });

  it('with no hub set, the bridge says so, and the game plays on alone', async () => {
    const base = await listen(createRunnerListener({ db: nothing, intelligence: nothing, hub: createHubBridge({}), noStatic: true }));
    expect(await (await fetch(`${base}/api/hub/where`)).json()).toMatchObject({ configured: false, signedIn: null });
    const res = await fetch(`${base}/api/hub/sessions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    expect(await res.json()).toMatchObject({ ok: false, status: 'NO_HUB' });
  });

  it('a hub in plain http is refused unless it is on this machine, so a token never crosses a network unencrypted', () => {
    expect(hubUrlProblem('https://hub.example')).toBeNull();
    expect(hubUrlProblem('http://127.0.0.1:3950')).toBeNull();
    expect(hubUrlProblem('http://localhost:3950')).toBeNull();
    expect(hubUrlProblem('http://hub.example')).toMatch(/https/);
    expect(hubUrlProblem('ftp://hub.example')).toMatch(/https/);
    expect(hubUrlProblem('not a url')).toBeTruthy();
  });

  it('the bridge answers this machine only, and a POST to it is JSON only', async () => {
    const bridge = createHubBridge({ hubUrl: 'https://hub.example' });
    const sent: { status?: number; body?: string } = {};
    const res = { statusCode: 0, setHeader() {}, end(b: string) { sent.status = this.statusCode; sent.body = b; } } as unknown as ServerResponse;
    await bridge({ method: 'GET', headers: {}, socket: { remoteAddress: '10.0.0.5' } } as unknown as IncomingMessage, res, '/where');
    expect(sent.status).toBe(403);

    const base = await listen((req, r) => void bridge(req, r, (req.url ?? '/').replace('/api/hub', '') || '/'));
    const form = await fetch(`${base}/api/hub/sessions`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{}' });
    expect(form.status).toBe(415);
  });
});
