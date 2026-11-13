// @vitest-environment node
/**
 * THE HUB'S SETTINGS, WORKED OUT FROM WHAT THE HOST ALREADY GIVES (Pedro, 2026-11-13: "we need to set
 * up how to work these out right?"). The first deployment's host held two settings, both Turso's, and
 * the hub would have said only the first thing it lacked. So:
 *
 *   - what the host's own integrations write is read when the hub's own name is not set: the
 *     Postgres integration's two addresses, and the host's own name for the production address.
 *     The names were read on the providers' pages (PLAYTEST_LEDGER.md, HD rows);
 *   - every missing setting is said at once, by name, and never a value;
 *   - which name a setting was read from goes to the log, and never its value;
 *   - a signing key is made in the owner's own terminal (`npm run hub:key`), printed and nowhere written.
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { hubConfigFrom } from '../server/hub/function';
import { hubAppConfigFrom } from '../server/hub/app';
import { makeHubKey } from '../server/hub/keys';
import { settingsLine, settingsRead } from '../server/hub/settings';

const root = resolve(import.meta.dirname, '..');
const pem = () => generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const clerkPublic = () => generateKeyPairSync('rsa', { modulusLength: 2048 }).publicKey.export({ type: 'spki', format: 'pem' }).toString();
const PUBLISHABLE = `pk_test_${Buffer.from('clerk.hub.test$').toString('base64')}`;

/** What Neon's integration and the host itself would write, with values no bar could mistake for another's. */
const HOST = {
  DATABASE_URL: 'postgres://pooled-user:pooled-word-1234@pooled.host.test/hub',
  DATABASE_URL_UNPOOLED: 'postgres://direct-user:direct-word-5678@direct.host.test/hub',
  VERCEL_PROJECT_PRODUCTION_URL: 'world-seed.host.test'
};

describe('the settings, worked out from what the host already gives', () => {
  it('says every missing setting at once, by name, and never a value', () => {
    const out = hubConfigFrom({});
    expect('problem' in out).toBe(true);
    if (!('problem' in out)) return;
    expect(out.missing).toEqual(['WS_HUB_DATABASE_URL', 'WS_HUB_KEY', 'WS_PUBLIC_URL']);
    expect(out.problem).toMatch(/WS_HUB_DATABASE_URL is not set/);
    expect(out.problem).toMatch(/WS_HUB_KEY is not set/);
    expect(out.problem).toMatch(/WS_PUBLIC_URL is not set/);
    // It says where the host would have written each, so one look says what is left to do
    expect(out.problem).toMatch(/DATABASE_URL/);
    expect(out.problem).toMatch(/VERCEL_PROJECT_PRODUCTION_URL/);
    expect(out.problem).toMatch(/npm run hub:key/);

    // A key that does not read is said beside what is missing, and its text is never repeated
    const broken = hubConfigFrom({ WS_HUB_KEY: 'not-a-key-but-a-secret-all-the-same' });
    expect('problem' in broken && broken.missing).toEqual(['WS_HUB_DATABASE_URL', 'WS_PUBLIC_URL']);
    expect('problem' in broken && broken.unreadable).toEqual(['WS_HUB_KEY']);
    expect('problem' in broken && broken.problem).not.toContain('not-a-key-but-a-secret');
  });

  it('reads what the host\'s integrations write when the hub\'s own name is not set, and its own name wins', () => {
    const key = pem();
    const fromHost = hubAppConfigFrom({ ...HOST, WS_HUB_KEY: key });
    expect('problem' in fromHost).toBe(false);
    if ('problem' in fromHost) return;
    expect(fromHost.databaseUrl).toBe(HOST.DATABASE_URL);
    expect(fromHost.liveListenUrl).toBe(HOST.DATABASE_URL_UNPOOLED);
    // The host gives the address without its scheme
    expect(fromHost.publicUrl).toBe('https://world-seed.host.test');
    expect(fromHost.key.id).toBe(makeHubKey(key).id);

    const own = hubAppConfigFrom({ ...HOST, WS_HUB_KEY: key, WS_HUB_DATABASE_URL: 'pglite://memory', WS_PUBLIC_URL: 'https://chosen.test/', WS_LIVE_LISTEN_URL: 'postgres://own-listen.test/hub' });
    if ('problem' in own) throw new Error(own.problem);
    expect(own.databaseUrl).toBe('pglite://memory');
    expect(own.publicUrl).toBe('https://chosen.test');
    expect(own.liveListenUrl).toBe('postgres://own-listen.test/hub');
    // A name set to nothing but spaces is not set
    const blank = hubAppConfigFrom({ ...HOST, WS_HUB_KEY: key, WS_HUB_DATABASE_URL: '  ' });
    if ('problem' in blank) throw new Error(blank.problem);
    expect(blank.databaseUrl).toBe(HOST.DATABASE_URL);
  });

  it('reads the direct address for the word between instances only beside the store it came with', () => {
    const key = pem();
    // The store named by the hub's own name: the host's direct address may be another database's
    const elsewhere = hubAppConfigFrom({ ...HOST, WS_HUB_KEY: key, WS_HUB_DATABASE_URL: 'postgres://another.test/hub' });
    if ('problem' in elsewhere) throw new Error(elsewhere.problem);
    expect(elsewhere.liveListenUrl).toBeUndefined();
    // The world's documents kept apart: the word between instances is about that database, not this one
    const apart = hubAppConfigFrom({ ...HOST, WS_HUB_KEY: key, WS_LIVE_DATABASE_URL: 'postgres://live.test/world' });
    if ('problem' in apart) throw new Error(apart.problem);
    expect(apart.liveListenUrl).toBeUndefined();
    expect(apart.liveDatabaseUrl).toBe('postgres://live.test/world');
  });

  it('names where each setting was read from, for the log, and holds no value', () => {
    const key = pem();
    const env = { ...HOST, WS_HUB_KEY: key, TURSO_DATABASE_URL: 'libsql://record.test', TURSO_AUTH_TOKEN: 'turso-token-abcdef', CRON_SECRET: 'cron-word-0123456789' };
    const read = settingsRead(env);
    const of = (name: string) => read.find(s => s.name === name);
    expect(of('WS_HUB_DATABASE_URL')).toMatchObject({ set: true, from: 'DATABASE_URL' });
    expect(of('WS_LIVE_LISTEN_URL')).toMatchObject({ set: true, from: 'DATABASE_URL_UNPOOLED' });
    expect(of('WS_PUBLIC_URL')).toMatchObject({ set: true, from: 'VERCEL_PROJECT_PRODUCTION_URL' });
    expect(of('WS_HUB_KEY')).toMatchObject({ set: true, from: 'WS_HUB_KEY' });
    expect(of('CLERK_JWT_KEY')).toMatchObject({ set: false, from: null });
    expect(of('WS_DEV_ACCOUNTS')).toMatchObject({ set: false });
    for (const s of read) expect(Object.keys(s).sort()).toEqual(['from', 'name', 'needed', 'set', 'what']);

    const line = settingsLine(env);
    expect(line).toMatch(/WS_HUB_DATABASE_URL \(from DATABASE_URL\)/);
    expect(line).toMatch(/WS_PUBLIC_URL \(from VERCEL_PROJECT_PRODUCTION_URL\)/);
    expect(line).toMatch(/Not set: .*CLERK_JWT_KEY/);
    for (const value of [...Object.values(HOST), key.trim().split('\n')[1], 'turso-token-abcdef', 'cron-word-0123456789', 'libsql://record.test', 'world-seed.host.test']) {
      expect(line).not.toContain(value);
    }
  });

  it('Clerk named by half is said with the rest, and the publishable key Clerk\'s integration writes is read', () => {
    // Connecting Clerk's integration writes its publishable key; the public key that reads its tokens is pasted by hand
    const half = hubAppConfigFrom({ ...HOST, WS_HUB_KEY: pem(), NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: PUBLISHABLE });
    expect('problem' in half && half.missing).toEqual(['CLERK_JWT_KEY']);
    expect('problem' in half && half.problem).toMatch(/CLERK_JWT_KEY is not set/);
    // Said beside everything else the hub lacks
    const both = hubAppConfigFrom({ NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: PUBLISHABLE });
    expect('problem' in both && both.missing).toEqual(['WS_HUB_DATABASE_URL', 'WS_HUB_KEY', 'WS_PUBLIC_URL', 'CLERK_JWT_KEY']);
    const unreadable = hubAppConfigFrom({ ...HOST, WS_HUB_KEY: pem(), CLERK_JWT_KEY: 'not a public key', CLERK_PUBLISHABLE_KEY: PUBLISHABLE });
    expect('problem' in unreadable && unreadable.unreadable).toEqual(['CLERK_JWT_KEY']);

    const whole = hubAppConfigFrom({ ...HOST, WS_HUB_KEY: pem(), CLERK_JWT_KEY: clerkPublic(), NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: PUBLISHABLE });
    expect('problem' in whole).toBe(false);
    expect(settingsRead({ NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: PUBLISHABLE }).find(s => s.name === 'CLERK_PUBLISHABLE_KEY')).toMatchObject({ set: true, from: 'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY' });
  });
});

describe('a signing key made in the owner\'s own terminal', () => {
  const tsx = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href;
  const run = (cwd: string) => spawnSync(process.execPath, ['--import', tsx, resolve(root, 'scripts', 'hub-key.ts')], { cwd, encoding: 'utf8', timeout: 60_000 });

  it('is printed whole, reads as the key a hub signs with, is new each time, and is written nowhere', () => {
    expect(JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).scripts['hub:key']).toBe('node --import tsx scripts/hub-key.ts');
    const here = mkdtempSync(join(tmpdir(), 'ws-hub-key-'));
    try {
      const first = run(here);
      const second = run(here);
      expect(first.status, first.stderr).toBe(0);
      const pemOf = (out: string) => out.match(/-----BEGIN PRIVATE KEY-----[\s\S]+?-----END PRIVATE KEY-----/)?.[0] ?? '';
      const one = pemOf(first.stdout);
      expect(one).not.toBe('');
      const key = makeHubKey(one);
      // It says which hub this key makes, so the owner can see it took once deployed
      expect(first.stdout).toContain(key.id);
      expect(first.stdout).toMatch(/WS_HUB_KEY/);
      expect(pemOf(second.stdout)).not.toBe(one);
      // And a fresh text for the scheduled call's secret, fit for a header
      expect(first.stdout).toMatch(/CRON_SECRET/);
      expect(first.stdout).toMatch(/\b[0-9a-f]{64}\b/);
      expect(readdirSync(here)).toEqual([]);
    } finally {
      rmSync(here, { recursive: true, force: true });
    }
  }, 120_000);
});
