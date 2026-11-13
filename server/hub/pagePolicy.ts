/**
 * WHAT THE SITE'S PAGES MAY LOAD, AND WHO MAY FRAME THEM (PLAYTEST_LEDGER.md, HF4 and the HD rows).
 * One place for both ways a page is served, so they cannot drift:
 *
 *   on the host     what never changes is in vercel.json's `headers`, for every address (`hostHeaders`);
 *                   the landing pages' content policy is written into each built page as a meta tag
 *                   (`writePolicies`, by scripts/build-site.ts), since it needs Clerk's own address,
 *                   which is known when the site is built and not when vercel.json is written
 *   the stand-in    the same, as headers on each answer (server.ts, `pageHeaders`)
 *
 * A meta tag cannot say who may frame a page (`frame-ancestors` is a header's alone), so the framing
 * rule is a header on both. The landing pages load only their own files and post only to their own
 * hub; where the hub's accounts are Clerk's, they also load Clerk's script from that instance's own
 * address and talk to it, and Clerk's form brings its own styles, pictures and bot check. The game's
 * pages set their own needs (WebAssembly for its store) and get no policy of the landing page's.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { clerkFrontendHost } from './clerk';
import { publishableKeyOf } from './settings';

/** The same on every page, wherever it is served. */
export const FIXED_PAGE_HEADERS: Readonly<Record<string, string>> = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY'
};

/** Who may frame a page: nobody. Only a header can say it. */
export const FRAMING_RULE = 'frame-ancestors \'none\'';

/** The bot check Clerk's form shows. */
const BOT_CHECK = 'https://challenges.cloudflare.com';
/**
 * Clerk's abuse check, which its form loads as a script, opens in a frame and talks to. Clerk's own
 * page on content policies names it for all three (last updated 2026-11-10, read 2026-11-13), and says
 * it is talked to on ports other than 443, which a source with no port does not match. HH3: the first
 * policy left it out, and on the host the browser refused its script.
 */
const ABUSE_CHECK = 'https://*.protect.clerk.com';

/** The landing pages' content policy, every part a meta tag can carry. */
export function pagePolicy(clerkHost?: string | null): string {
  const clerk = clerkHost ? ` https://${clerkHost}` : '';
  return [
    'default-src \'self\'',
    `script-src 'self'${clerk}${clerk ? ` ${BOT_CHECK} ${ABUSE_CHECK}` : ''}`,
    `style-src 'self'${clerk ? ' \'unsafe-inline\'' : ''}`,
    `img-src 'self' data:${clerk ? ' https://img.clerk.com' : ''}`,
    `connect-src 'self'${clerk}${clerk ? ` ${ABUSE_CHECK}:*` : ''}`,
    ...(clerk ? [`frame-src ${BOT_CHECK} ${ABUSE_CHECK}`, 'worker-src \'self\' blob:'] : []),
    'base-uri \'none\'', 'form-action \'self\''
  ].join('; ');
}

/** What the stand-in sends with a landing page: the fixed headers, and the policy with the framing rule. */
export function pageHeaders(clerkHost?: string | null): Record<string, string> {
  return { ...FIXED_PAGE_HEADERS, 'Content-Security-Policy': `${pagePolicy(clerkHost)}; ${FRAMING_RULE}` };
}

/** What every address gets on the host (vercel.json), and the stand-in's game pages. */
export function hostHeaders(): Record<string, string> {
  return { ...FIXED_PAGE_HEADERS, 'Content-Security-Policy': FRAMING_RULE };
}

/** Clerk's own address, from the publishable key by either name it is kept under (settings.ts). */
export function clerkHostOf(env: NodeJS.ProcessEnv): string | null {
  const key = publishableKeyOf(env);
  return key ? clerkFrontendHost(key) : null;
}

const POLICY_TAG = /<meta http-equiv="Content-Security-Policy"[^>]*>\s*/gi;
/** Written inside double quotes, so a policy's own single quotes stand as they are. */
const attribute = (text: string) => text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/** A page with its policy written in: right after its charset, before anything it loads. One, however often it is written. */
export function withPolicy(html: string, clerkHost?: string | null): string {
  const tag = `<meta http-equiv="Content-Security-Policy" content="${attribute(pagePolicy(clerkHost))}">`;
  const clean = html.replace(POLICY_TAG, '');
  const charset = clean.match(/<meta charset[^>]*>/i);
  if (charset) return clean.replace(charset[0], `${charset[0]}\n  ${tag}`);
  const head = clean.match(/<head[^>]*>/i);
  if (head) return clean.replace(head[0], `${head[0]}\n  ${tag}`);
  throw new Error('A page with no head has nowhere to carry its policy.');
}

/** Every landing page under a built site, its policy written in. The game's folder is the game's. Returns the pages written, relative to the site. */
export function writePolicies(siteDir: string, clerkHost?: string | null, gameDir = 'play'): string[] {
  const written: string[] = [];
  for (const entry of readdirSync(siteDir, { recursive: true }).map(String)) {
    if (!entry.endsWith('.html')) continue;
    const parts = entry.split(/[\\/]/);
    if (parts[0] === gameDir) continue;
    const file = join(siteDir, entry);
    writeFileSync(file, withPolicy(readFileSync(file, 'utf8'), clerkHost));
    written.push(relative(siteDir, file));
  }
  return written;
}
