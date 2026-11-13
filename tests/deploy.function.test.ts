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
 *   - a key the host mangled is said as a problem, never a death at load.
 */
import { describe, it, expect, beforeAll } from 'vitest';
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

/** The settings a process is given, with everything of the hub's and every loader taken out. */
function hostEnv(extra: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (/^(WS_|CLERK_|TURSO_|CRON_SECRET|NODE_OPTIONS|VITEST|VITE_)/.test(name)) continue;
    env[name] = value;
  }
  return { ...env, ...extra };
}

function ask(extra: Record<string, string>): { status: number | null; stderr: string; answers: { path: string; status: number; body: any }[] } {
  const ran = spawnSync(process.execPath, ['--input-type=module', '-e', ASK], { cwd: root, env: hostEnv(extra), encoding: 'utf8', timeout: 90_000 });
  const line = ran.stdout.split('\n').find(l => l.startsWith('ANSWERS '));
  return { status: ran.status, stderr: ran.stderr, answers: line ? JSON.parse(line.slice('ANSWERS '.length)) : [] };
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
      expect(answer.body.reason).toMatch(/WS_HUB_DATABASE_URL is not set/);
    }
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
