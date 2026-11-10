// @vitest-environment node
/**
 * THE KEY FORM OF THE ENTRY VIEW (Pedro, 2026-11-10): "API keys with an input form that has: + (add),
 * provider (enum [the labs]), skeleton of the start of each key type expected, dry run and test, accept".
 * Registered before the build.
 *
 * The providers are the rows of the door's options file, never a list in code. Each row says how its keys
 * start. A DRY RUN reads the pasted text on this machine and sends nothing. A TEST asks the provider once
 * and changes nothing. ACCEPT is the only step that puts a key in use, and it is open only for the text
 * that passed the test. A key that was taken is never sent back.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { createServer, Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { readFileSync } from 'node:fs';
import { AbsentProvider, IntelligenceDoor } from '../shared/intelligence/door';
import { LocalProvider, ILocalRuntime } from '../shared/intelligence/local';
import { IKeyedOption, parseDoorOptions } from '../shared/intelligence/options';
import { DoorSetting, SETTINGS } from '../shared/intelligence/setting';
import { routeDoor } from '../shared/intelligence/routes';
import { dryRun, keySkeleton } from '../shared/intelligence/keyShape';
import { canAccept, canTest, emptyForm, tested, typed } from '../src/logic/intelligence/KeyForm';
import { createKeyVault, IKeyShelf } from '../src/logic/intelligence/KeyVault';

const OFFERED = parseDoorOptions(JSON.parse(readFileSync('shared/intelligence/door-options.json', 'utf8'))).keyed;
const row = (id: string) => OFFERED.find(o => o.id === id)!;

describe('the providers and how their keys start, as data', () => {
  it('every offered provider says what a key of its own looks like', () => {
    expect(OFFERED.length).toBeGreaterThan(0);
    for (const o of OFFERED) {
      expect(keySkeleton(o).length, o.id).toBeGreaterThan(3);
      if (o.keyStart) expect(keySkeleton(o).startsWith(o.keyStart), o.id).toBe(true);
    }
  });

  it('no two providers start their keys the same way', () => {
    const starts = OFFERED.map(o => o.keyStart).filter(Boolean);
    expect(new Set(starts).size).toBe(starts.length);
  });

  it('no list of providers is written in the code that reads them', () => {
    const code = readFileSync('shared/intelligence/keyShape.ts', 'utf8') + readFileSync('src/components/KeysPanel.tsx', 'utf8');
    for (const o of OFFERED) if (o.keyStart) expect(code, o.id).not.toContain(o.keyStart);
  });
});

describe('a dry run: the pasted text is read here, and nothing is sent', () => {
  const anthropic = row('anthropic');
  const good = `${anthropic.keyStart}api03-${'a1B2'.repeat(20)}`;

  it('a key that starts the way this provider\'s keys do looks right', () => {
    const look = dryRun(anthropic, OFFERED, good);
    expect(look.ok).toBe(true);
    expect(look.says.join(' ')).toMatch(/Nothing was sent/);
  });

  it('nothing pasted, quotes around it, a space inside it, or a word in front of it: each is said', () => {
    expect(dryRun(anthropic, OFFERED, '   ')).toMatchObject({ ok: false });
    expect(dryRun(anthropic, OFFERED, `"${good}"`).says.join(' ')).toMatch(/quotes/);
    expect(dryRun(anthropic, OFFERED, `${good.slice(0, 20)} ${good.slice(20)}`).says.join(' ')).toMatch(/space|line break/);
    expect(dryRun(anthropic, OFFERED, `Bearer ${good}`).ok).toBe(false);
    expect(dryRun(anthropic, OFFERED, `${anthropic.keyStart}abc`).says.join(' ')).toMatch(/short/);
  });

  it('a space or a line break at the ends is what a paste brings, and is not held against it', () => {
    expect(dryRun(anthropic, OFFERED, `  ${good}\n`).ok).toBe(true);
  });

  it('a key from another provider is named as that provider\'s', () => {
    const groq = row('groq');
    const look = dryRun(anthropic, OFFERED, `${groq.keyStart}${'x9'.repeat(24)}`);
    expect(look.ok).toBe(false);
    expect(look.says.join(' ')).toContain(groq.name);
  });

  it('the longest start that fits decides whose it is', () => {
    const openrouter = row('openrouter');
    const look = dryRun(openrouter, OFFERED, `${openrouter.keyStart}${'k4'.repeat(30)}`);
    expect(look.ok).toBe(true);
  });

  it('a provider whose keys have no fixed start is not held to one', () => {
    const free: IKeyedOption = { id: 'plain', name: 'Plain', protocol: 'openai', baseUrl: 'http://x', model: 'm' };
    expect(dryRun(free, [...OFFERED, free], 'Zq8'.repeat(11)).ok).toBe(true);
  });

  it('whatever it finds, the key itself is never written back', () => {
    for (const text of [good, `"${good}"`, `Bearer ${good}`]) expect(dryRun(anthropic, OFFERED, text).says.join(' ')).not.toContain(good.slice(12));
  });
});

describe('the form: dry run, test, accept, in that order', () => {
  it('a new form waits for a key: nothing to test, nothing to accept', () => {
    const form = emptyForm('groq');
    expect(canTest(form)).toBe(false);
    expect(canAccept(form)).toBe(false);
  });

  it('accept opens only for the very text the provider said yes to', () => {
    let form = typed(emptyForm('groq'), 'gsk_first');
    expect(canTest(form)).toBe(true);
    expect(canAccept(form)).toBe(false);
    form = tested(form, { ok: true });
    expect(canAccept(form)).toBe(true);
    form = typed(form, 'gsk_second');
    expect(canAccept(form)).toBe(false);
    expect(form.tested).toBeNull();
    expect(form.dry).toBeNull();
  });

  it('a refused test keeps accept closed, and keeps the reason', () => {
    const form = tested(typed(emptyForm('groq'), 'gsk_first'), { ok: false, reason: 'Groq refused the key.' });
    expect(canAccept(form)).toBe(false);
    expect(form.tested?.reason).toBe('Groq refused the key.');
  });
});

describe('the door, holding more than one key', () => {
  let server: Server | null = null;
  afterEach(async () => { await new Promise<void>(r => (server ? server.close(() => r()) : r())); server = null; });

  const stub = async (asked: string[] = []) => {
    server = createServer((req, res) => {
      asked.push(`${req.headers.authorization} ${req.url}`);
      res.setHeader('content-type', 'application/json');
      if (!String(req.headers.authorization).startsWith('Bearer good-')) { res.statusCode = 401; return res.end('{"error":"bad key"}'); }
      return res.end('{"data":[]}');
    });
    await new Promise<void>(r => server!.listen(0, '127.0.0.1', () => r()));
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
  };

  const runtime: ILocalRuntime = { name: 'none', url: 'http://127.0.0.1:0', model: '', probe: async () => ({ ok: false, reason: 'none' }), list: async () => { throw new Error('not running'); }, chat: async () => ({ text: '', stop: 'done' as const }) } as unknown as ILocalRuntime;
  const make = async () => {
    const asked: string[] = [];
    const base = await stub(asked);
    const options: IKeyedOption[] = [
      { id: 'one', name: 'Lab One', protocol: 'openai', baseUrl: base, model: 'm1', keyStart: 'good-one', keyShape: 'good-one-…' },
      { id: 'two', name: 'Lab Two', protocol: 'openai', baseUrl: base, model: 'm2' }
    ];
    const setting = new DoorSetting(new AbsentProvider(), new LocalProvider(runtime), { keyed: options }, { cards: async () => [], memory: () => ({ total: 8e9, free: 4e9 }) });
    const door = new IntelligenceDoor(setting);
    SETTINGS.set(door, setting);
    const post = async (path: string, body: unknown = {}) => (await routeDoor(door, 'POST', path, body)).json as any;
    const get = async (path: string) => (await routeDoor(door, 'GET', path, {})).json as any;
    return { setting, post, get, asked };
  };

  it('a test asks the provider and changes nothing: no key is held, and the voice is as it was', async () => {
    const { setting, post, get, asked } = await make();
    expect(await post('/key/test', { optionId: 'one', key: 'good-one-123' })).toMatchObject({ ok: true });
    expect(await post('/key/test', { optionId: 'one', key: 'bad-key' })).toMatchObject({ ok: false });
    expect(asked).toHaveLength(2);
    expect((await setting.status()).mode).toBe('auto');
    expect(await get('/keys')).toEqual({ keys: [] });
  });

  it('a test of nothing, or for a provider that is not offered, never leaves this machine', async () => {
    const { post, asked } = await make();
    expect(await post('/key/test', { optionId: 'one', key: '  ' })).toMatchObject({ ok: false });
    expect(await post('/key/test', { optionId: 'nobody', key: 'good-x' })).toMatchObject({ ok: false });
    expect(asked).toHaveLength(0);
  });

  it('accepting holds the key and puts it in use; the list says whose it is and never the key', async () => {
    const { post, get } = await make();
    const taken = await post('/key', { optionId: 'one', key: 'good-one-123' });
    expect(taken).toMatchObject({ ok: true, status: { mode: 'keyed', option: 'Lab One' } });
    await post('/key', { optionId: 'two', key: 'good-two-456' });
    const list = await get('/keys');
    expect(list.keys).toEqual([{ optionId: 'one', name: 'Lab One', inUse: false }, { optionId: 'two', name: 'Lab Two', inUse: true }]);
    expect(JSON.stringify(list)).not.toMatch(/good-/);
  });

  it('a held key is put back in use without being typed again', async () => {
    const { setting, post, get } = await make();
    await post('/key', { optionId: 'one', key: 'good-one-123' });
    await post('/key', { optionId: 'two', key: 'good-two-456' });
    expect(await post('/key/use', { optionId: 'one' })).toMatchObject({ ok: true, status: { mode: 'keyed', option: 'Lab One' } });
    expect((await get('/keys')).keys.find((k: any) => k.inUse).optionId).toBe('one');
    expect(await post('/key/use', { optionId: 'nobody' })).toMatchObject({ ok: false });
    expect((await setting.status()).option).toBe('Lab One');
  });

  it('forgetting the key in use goes back to the server\'s own way, and the others stay held', async () => {
    const { setting, post, get } = await make();
    await post('/key', { optionId: 'one', key: 'good-one-123' });
    await post('/key', { optionId: 'two', key: 'good-two-456' });
    expect(await post('/key/forget', { optionId: 'two' })).toMatchObject({ ok: true });
    expect((await setting.status()).mode).toBe('auto');
    expect((await get('/keys')).keys).toEqual([{ optionId: 'one', name: 'Lab One', inUse: false }]);
  });

  it('the server\'s own way drops every key, as it always dropped the one', async () => {
    const { post, get } = await make();
    await post('/key', { optionId: 'one', key: 'good-one-123' });
    await post('/key', { optionId: 'two', key: 'good-two-456' });
    await post('/auto');
    expect((await get('/keys')).keys).toEqual([]);
  });
});

describe('in the page, each accepted key is sealed in the player\'s browser', () => {
  const mapShelf = () => {
    const held = new Map<string, unknown>();
    const shelf: IKeyShelf = { get: async id => held.get(id), put: async (id, v) => { held.set(id, v); }, delete: async id => { held.delete(id); } };
    return { held, shelf };
  };
  const written = (held: Map<string, unknown>) => JSON.stringify([...held.entries()], (_k, v) => (v instanceof ArrayBuffer || ArrayBuffer.isView(v) ? Buffer.from(v as ArrayBuffer).toString('latin1') : v));

  it('keeps several, says whose they are, and never holds one as written', async () => {
    const { held, shelf } = mapShelf();
    const vault = createKeyVault(shelf);
    await vault.keep('groq', 'gsk_first_secret_000000000000');
    await vault.keep('mistral', 'mistralSecret1111111111111111');
    expect(await vault.held()).toEqual(['groq', 'mistral']);
    expect(written(held)).not.toMatch(/gsk_first_secret|mistralSecret/);
    // The last one kept is the one in use, as it always was
    expect(await vault.read()).toEqual({ optionId: 'mistral', key: 'mistralSecret1111111111111111' });
    expect(await vault.readOne('groq')).toEqual({ optionId: 'groq', key: 'gsk_first_secret_000000000000' });
  });

  it('puts another held key in use, drops one, and forgetting leaves the shelf bare', async () => {
    const { held, shelf } = mapShelf();
    const vault = createKeyVault(shelf);
    await vault.keep('groq', 'gsk_first_secret_000000000000');
    await vault.keep('mistral', 'mistralSecret1111111111111111');
    await vault.use('groq');
    expect((await vault.read())?.optionId).toBe('groq');
    await vault.drop('groq');
    expect(await vault.held()).toEqual(['mistral']);
    expect(await vault.read()).toBeNull();
    await vault.forget();
    expect(held.size).toBe(0);
  });
});
