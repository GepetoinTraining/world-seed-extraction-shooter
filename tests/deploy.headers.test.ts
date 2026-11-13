// @vitest-environment node
/**
 * THE PAGE'S HEADERS ON THE HOST (PLAYTEST_LEDGER.md, HF4). The local stand-in gave the landing page
 * a content policy and a rule against framing; the built site on the host got neither, since
 * `vercel.json` named no headers. The policy needs Clerk's own address, which the publishable key
 * carries and which is known when the site is built, not when `vercel.json` is written. So:
 *
 *   - what never changes is in `vercel.json`, for every address: no framing, no sniffing, no referrer;
 *   - the content policy is written into each built page as a meta tag, from the same function the
 *     stand-in sends it with, so the two cannot drift. A meta tag cannot say who may frame a page;
 *     the header does;
 *   - the stand-in sends what the host sends, the game's pages included.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHubListener } from '../server/hub/server';
import { clerkHostOf, FIXED_PAGE_HEADERS, hostHeaders, pageHeaders, pagePolicy, writePolicies } from '../server/hub/pagePolicy';

const root = resolve(import.meta.dirname, '..');
const PUBLISHABLE = `pk_test_${Buffer.from('clerk.hub.test$').toString('base64')}`;
const metaOf = (html: string) => html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]*)">/)?.[1]?.replace(/&#39;/g, '\'').replace(/&amp;/g, '&') ?? null;

describe('the page\'s headers on the host', () => {
  let server: Server | undefined;
  const dirs: string[] = [];
  afterEach(async () => {
    await new Promise<void>(r => (server ? server.close(() => r()) : r()));
    server = undefined;
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  /** The landing pages as the build copies them, and a stand-in for the game beside them. */
  const site = () => {
    const dir = mkdtempSync(join(tmpdir(), 'ws-site-'));
    dirs.push(dir);
    cpSync(resolve(root, 'landing'), dir, { recursive: true });
    mkdirSync(join(dir, 'play'), { recursive: true });
    writeFileSync(join(dir, 'play', 'index.html'), '<!DOCTYPE html><html><head><meta charset="utf-8"><title>the game</title></head><body></body></html>');
    return dir;
  };

  const serve = async (dir: string, clerkHost: string | null) => {
    server = createServer(createHubListener({ api: async (_req, res) => { res.statusCode = 404; res.end('{}'); }, landingDir: dir, pages: ['/play/'], clerkHost }));
    await new Promise<void>(r => server!.listen(0, '127.0.0.1', () => r()));
    return `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
  };

  it('vercel.json gives every address what never changes: no framing, no sniffing, no referrer', () => {
    const host = JSON.parse(readFileSync(resolve(root, 'vercel.json'), 'utf8'));
    expect(host.headers).toHaveLength(1);
    expect(host.headers[0].source).toBe('/(.*)');
    const given = Object.fromEntries(host.headers[0].headers.map((h: { key: string; value: string }) => [h.key, h.value]));
    expect(given).toEqual(hostHeaders());
    expect(given).toMatchObject({ 'X-Frame-Options': 'DENY', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': 'frame-ancestors \'none\'' });
  });

  it('a built page carries the stand-in\'s own policy for the same key, before anything it loads', async () => {
    const dir = site();
    const clerkHost = clerkHostOf({ NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: PUBLISHABLE });
    expect(clerkHost).toBe('clerk.hub.test');
    const written = writePolicies(dir, clerkHost);
    // Every landing page, and never the game's: the game sets its own needs
    expect(written.map(p => p.replace(/\\/g, '/')).sort()).toEqual(readdirSync(resolve(root, 'landing'), { recursive: true }).map(String).map(p => p.replace(/\\/g, '/')).filter(p => p.endsWith('.html')).sort());
    expect(metaOf(readFileSync(join(dir, 'play', 'index.html'), 'utf8'))).toBeNull();

    const html = readFileSync(join(dir, 'index.html'), 'utf8');
    const meta = metaOf(html);
    expect(meta).toBe(pagePolicy(clerkHost));
    expect(meta).toContain('https://clerk.hub.test');
    // In the head, after the charset and before the first stylesheet or script
    const at = html.indexOf('http-equiv="Content-Security-Policy"');
    expect(at).toBeGreaterThan(html.indexOf('<meta charset'));
    expect(at).toBeLessThan(html.indexOf('<link rel="stylesheet"'));
    expect(at).toBeLessThan(html.indexOf('<script'));
    // A meta tag cannot carry who may frame the page: that is the header's
    expect(meta).not.toContain('frame-ancestors');

    const origin = await serve(dir, clerkHost);
    const page = await fetch(`${origin}/`);
    expect(metaOf(await page.text())).toBe(meta);
    expect(page.headers.get('content-security-policy')).toBe(`${meta}; frame-ancestors 'none'`);
    expect(pageHeaders(clerkHost)['Content-Security-Policy']).toBe(`${meta}; frame-ancestors 'none'`);
    for (const [name, value] of Object.entries(FIXED_PAGE_HEADERS)) expect(page.headers.get(name)).toBe(value);

    // The game's pages get what the host gives every address, and no policy of the landing page's
    const game = await fetch(`${origin}/play/somewhere`);
    for (const [name, value] of Object.entries(hostHeaders())) expect(game.headers.get(name)).toBe(value);

    // Written twice, a page still carries one policy
    writePolicies(dir, clerkHost);
    expect(readFileSync(join(dir, 'index.html'), 'utf8').match(/http-equiv="Content-Security-Policy"/g)).toHaveLength(1);
  });

  it('a page built with no Clerk key still gets a policy, the strict one', () => {
    const dir = site();
    expect(clerkHostOf({})).toBeNull();
    writePolicies(dir, null);
    const meta = metaOf(readFileSync(join(dir, 'index.html'), 'utf8'));
    expect(meta).toBe(pagePolicy(null));
    expect(meta).toContain('default-src \'self\'');
    expect(meta).toContain('script-src \'self\';');
    expect(meta).not.toContain('https://');
    expect(meta).not.toContain('unsafe-inline');
  });

  it('the source pages carry no policy of their own, and the build writes it from the key it is given', () => {
    for (const file of readdirSync(resolve(root, 'landing'), { recursive: true }).map(String).filter(p => p.endsWith('.html'))) {
      expect(metaOf(readFileSync(resolve(root, 'landing', file), 'utf8')), file).toBeNull();
    }
    const build = readFileSync(resolve(root, 'scripts', 'build-site.ts'), 'utf8');
    expect(build).toMatch(/writePolicies\(out, clerkHostOf\(process\.env\)\)/);
  });
});
