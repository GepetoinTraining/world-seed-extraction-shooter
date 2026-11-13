// @vitest-environment node
/**
 * THE HUB'S FUNCTION, AS THE HOST LOADS IT (DEPLOY.md). The first deployment (2026-11-13) answered
 * every address under /api/hub with the host's own 500 and never the hub's own word: Node could not
 * find `server/hub/app`. The host compiles each file alone and runs the result as plain Node, and
 * every import in `server/` and `shared/` is written without an extension, which only a bundler or
 * tsx resolves. Every bar the hub had ran under tsx, so none of them could see it.
 *
 * So the function is built into one file before the host looks at it (`scripts/build-hub.ts`), and
 * these bars run it the way the host does: plain `node`, nothing imported beforehand.
 *
 *   - the file the host runs names only what plain Node can find;
 *   - built, it loads, and with no settings it gives the hub's own refusal, naming what is missing;
 *   - with a store it answers, which also proves it finds its migrations from where it is built to;
 *   - with Turso's two names and no Postgres named, its store is on Turso alone, through the network
 *     driver, and it finds that store's own migrations too (Pedro, 2026-11-13: "Yes, Turso only");
 *   - a key the host mangled is said as a problem, never a death at load.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startDouble, type IDouble } from './fixtures/turso-double';
import { spawnSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { hubConfigFrom } from '../server/hub/function';

const root = resolve(import.meta.dirname, '..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');
const pem = () => generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

/** What a function host runs: the entry, under plain Node, asked over real HTTP. Prints what each address answered. */
const ASK = `
import server from './api/hub.js';
server.listen(0, '127.0.0.1', async () => {
  const origin = 'http://127.0.0.1:' + server.address().port;
  const out = [];
  for (const path of ['/api/hub/health', '/api/hub?__path=health']) {
    const res = await fetch(origin + path);
    out.push({ path, status: res.status, body: await res.json() });
  }
  console.log('ANSWERS ' + JSON.stringify(out));
  process.exit(0);
});
`;

/** The settings a process is given, with everything of the hub's, every name a host's integration writes, and every loader taken out. */
function hostEnv(extra: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (/^(WS_|CLERK_|TURSO_|CRON_SECRET|DATABASE_URL|VERCEL|NEXT_PUBLIC_|NODE_OPTIONS|VITEST|VITE_)/.test(name)) continue;
    env[name] = value;
  }
  return { ...env, ...extra };
}

function ask(extra: Record<string, string>): { status: number | null; stdout: string; stderr: string; answers: { path: string; status: number; body: any }[] } {
  const ran = spawnSync(process.execPath, ['--input-type=module', '-e', ASK], { cwd: root, env: hostEnv(extra), encoding: 'utf8', timeout: 90_000 });
  const line = ran.stdout.split('\n').find(l => l.startsWith('ANSWERS '));
  return { status: ran.status, stdout: ran.stdout, stderr: ran.stderr, answers: line ? JSON.parse(line.slice('ANSWERS '.length)) : [] };
}

describe('the hub\'s function as the host loads it', () => {
  beforeAll(() => {
    const built = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/build-hub.ts'], { cwd: root, encoding: 'utf8', timeout: 120_000 });
    expect(built.status, built.stderr).toBe(0);
  }, 150_000);

  it('hands the host one file, and that file names only what plain Node can find', () => {
    // One function: the host makes one of every source file it finds under api/
    expect(readdirSync(resolve(root, 'api'))).toEqual(['hub.js']);
    const entry = read('api/hub.js');
    const named = [...entry.matchAll(/from\s+'([^']+)'/g)].map(m => m[1]);
    expect(named.length).toBeGreaterThan(0);
    for (const name of named) {
      // Plain Node resolves a relative address only when it is written whole
      if (name.startsWith('.')) expect(name, `${name} has no extension`).toMatch(/\.(mjs|js|json)$/);
    }
    const host = JSON.parse(read('vercel.json'));
    expect(Object.keys(host.functions)).toEqual(['api/hub.js']);
    expect(host.functions['api/hub.js'].includeFiles).toBe('drizzle/**');
    expect(existsSync(resolve(root, 'dist-hub', 'hub.mjs'))).toBe(true);
  });

  it('loads under plain Node and, with no settings, gives the hub\'s own refusal', () => {
    const ran = ask({});
    expect(ran.status, ran.stderr).toBe(0);
    expect(ran.stderr).not.toMatch(/ERR_MODULE_NOT_FOUND/);
    expect(ran.answers).toHaveLength(2);
    for (const answer of ran.answers) {
      expect(answer.status).toBe(503);
      expect(answer.body).toMatchObject({ ok: false });
      // Every setting it lacks, at once: one look at /health is the whole list of what is left to do
      expect(answer.body.reason).toMatch(/WS_HUB_DATABASE_URL is not set/);
      expect(answer.body.reason).toMatch(/WS_HUB_KEY is not set/);
      expect(answer.body.reason).toMatch(/WS_PUBLIC_URL is not set/);
      expect(answer.body.settings).toEqual({ missing: ['WS_HUB_DATABASE_URL', 'WS_HUB_KEY', 'WS_PUBLIC_URL'], unreadable: [] });
    }
  }, 120_000);

  it('reads the names the host\'s integrations write, and says in its log which it read, never a value', () => {
    const key = pem();
    const ran = ask({ DATABASE_URL: 'pglite://memory', VERCEL_PROJECT_PRODUCTION_URL: 'hub.test', WS_HUB_KEY: key });
    expect(ran.status, ran.stderr).toBe(0);
    for (const answer of ran.answers) {
      expect(answer.status, JSON.stringify(answer.body)).toBe(200);
      expect(answer.body).toMatchObject({ ok: true, hub: { url: 'https://hub.test' } });
    }
    const said = ran.stdout.split('\n').find(l => l.startsWith('[HUB] Settings'));
    expect(said).toMatch(/WS_HUB_DATABASE_URL \(from DATABASE_URL\)/);
    expect(said).toMatch(/WS_PUBLIC_URL \(from VERCEL_PROJECT_PRODUCTION_URL\)/);
    expect(ran.stdout + ran.stderr).not.toContain(key.trim().split('\n')[1]);
    expect(said).not.toContain('pglite://memory');
  }, 120_000);

  it('answers with a store, finding its migrations from where it is built to', () => {
    const ran = ask({ WS_HUB_DATABASE_URL: 'pglite://memory', WS_HUB_KEY: pem(), WS_PUBLIC_URL: 'https://hub.test' });
    expect(ran.status, ran.stderr).toBe(0);
    expect(ran.answers).toHaveLength(2);
    for (const answer of ran.answers) {
      expect(answer.status, JSON.stringify(answer.body)).toBe(200);
      expect(answer.body).toMatchObject({ ok: true, service: 'worldseed-hub', hub: { url: 'https://hub.test', accounts: 'builtin' } });
    }
  }, 120_000);

  describe('its store on Turso alone, as the host is set up today', () => {
    const TOKEN = 'a-token-the-stand-in-asks-for-0123456789';
    let turso: IDouble;
    beforeAll(async () => { turso = await startDouble({ token: TOKEN }); }, 30_000);
    afterAll(async () => { await turso?.stop(); });

    it('opens with Turso\'s two names, the key and the address, with no Postgres named, and finds its own migrations from where it is built to', () => {
      const key = pem();
      const ran = ask({ TURSO_DATABASE_URL: turso.url, TURSO_AUTH_TOKEN: TOKEN, WS_HUB_KEY: key, VERCEL_PROJECT_PRODUCTION_URL: 'hub.test' });
      expect(ran.status, ran.stderr).toBe(0);
      for (const answer of ran.answers) {
        expect(answer.status, JSON.stringify(answer.body)).toBe(200);
        expect(answer.body).toMatchObject({ ok: true, service: 'worldseed-hub', hub: { url: 'https://hub.test' } });
      }
      const said = ran.stdout.split('\n').find(l => l.startsWith('[HUB] Settings'));
      expect(said).toMatch(/WS_HUB_DATABASE_URL \(from TURSO_DATABASE_URL\)/);
      // Never a value: not the address, not the token, not the key
      for (const value of [turso.url, TOKEN, key.trim().split('\n')[1]]) expect(ran.stdout + ran.stderr).not.toContain(value);
    }, 120_000);

    it('made its own tables on Turso, under names the record never uses', async () => {
      const tables = (await turso.sql(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`)).map(r => String(r[0]));
      expect(tables).toEqual(expect.arrayContaining(['store_commits', 'store_documents', 'store_ledger_rows', 'store_migrations', 'store_treasuries']));
      expect(tables.filter(t => !t.startsWith('store_'))).toEqual([]);
    });

    it('with Turso\'s address and no token, says the token is what is missing', () => {
      const ran = ask({ TURSO_DATABASE_URL: turso.url, WS_HUB_KEY: pem(), WS_PUBLIC_URL: 'https://hub.test' });
      expect(ran.status, ran.stderr).toBe(0);
      expect(ran.answers[0]?.status).toBe(503);
      expect(ran.answers[0]?.body.settings).toEqual({ missing: ['TURSO_AUTH_TOKEN'], unreadable: [] });
      expect(ran.answers[0]?.body.reason).toMatch(/TURSO_AUTH_TOKEN is not set/);
    }, 120_000);
  });

  it('says a key the host mangled as a problem, and reads one whose line ends were flattened', () => {
    const settings = { WS_HUB_DATABASE_URL: 'pglite://memory', WS_PUBLIC_URL: 'https://hub.test' };
    const broken = hubConfigFrom({ ...settings, WS_HUB_KEY: 'not a key at all' });
    expect('problem' in broken && broken.problem).toMatch(/WS_HUB_KEY cannot be read as a key/);
    // A secret store that keeps one line: the line ends arrive as the two characters \ and n
    const flattened = hubConfigFrom({ ...settings, WS_HUB_KEY: pem().trim().replace(/\n/g, '\\n') });
    expect('problem' in flattened).toBe(false);
    // And the function itself says it instead of dying where the host would answer for it
    const ran = ask({ ...settings, WS_HUB_KEY: 'not a key at all' });
    expect(ran.status, ran.stderr).toBe(0);
    expect(ran.answers[0]?.status).toBe(503);
    expect(ran.answers[0]?.body.reason).toMatch(/WS_HUB_KEY cannot be read as a key/);
  }, 120_000);
});
