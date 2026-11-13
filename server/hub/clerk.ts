/**
 * ACCOUNTS BY E-MAIL AND PASSWORD, THROUGH CLERK (Pedro, 2026-11-12: "we need to have account and
 * password for players to delete their data from our server", "we need e-mail + password (use
 * clerk)"). On the hub we launch, Clerk holds the e-mail and the password, sends the recovery
 * letter and proves who is at the door. This hub holds neither: it keeps the account's id at Clerk
 * and a handle, and nothing a person could be found by.
 *
 * Nothing is installed for it. What Clerk gives a signed-in page is a short-lived token it signed
 * with its own key (RS256); reading one is a signature check against that key's public half, which
 * this hub is given once (`CLERK_JWT_KEY`), so no request waits on Clerk. What Clerk sends when an
 * account is deleted is signed by its sender (Svix) with a secret both sides hold
 * (`CLERK_WEBHOOK_SECRET`). Both checks are node:crypto.
 *
 * A hub anyone else runs has no Clerk and keeps the handle and password this hub was built with
 * (Hub.createAccount): the choice is this file's `clerkConfigFrom`, by what the environment names.
 *
 *   CLERK_JWT_KEY             the instance's public key, PEM (Clerk dashboard, API keys, JWKS public key)
 *   CLERK_PUBLISHABLE_KEY     what the landing page loads Clerk with; public by design
 *   CLERK_AUTHORIZED_PARTIES  the origins a token may come from, comma-separated; this hub's own address when left out
 *   CLERK_WEBHOOK_SECRET      the signing secret of the endpoint at /api/hub/clerk (whsec_…)
 *   CLERK_SECRET_KEY          to delete the account at Clerk when its player asks this hub to
 */
import { createHmac, createPublicKey, timingSafeEqual, verify, type KeyObject } from 'node:crypto';
import { pemOf } from './keys';

export interface IClerkConfig {
  publicKey: KeyObject;
  publishableKey: string;
  parties: string[];
  webhookSecret?: Buffer;
  secretKey?: string;
  /** Where Clerk's own API is asked. Only a test names another. */
  api: string;
}

export interface IClerkWho {
  /** The account's id at Clerk. */
  userId: string;
  /** What the player is called here, if the token carries it (a `handle` claim of the session token). */
  handle?: string;
}

/** A token may be a few seconds early or late by the two clocks. */
const CLOCK_LEEWAY_S = 10;
/** A webhook older than this is not taken: it is someone sending an old one again. */
const WEBHOOK_WINDOW_S = 5 * 60;

/** Clerk's key as the host's settings left it: built again from its markers and base64, whatever became of its line ends (keys.ts). */
const pem = (text: string) => pemOf(text);

/** Clerk, if this hub's environment names it. A key that does not read is said, not passed over. */
export function clerkConfigFrom(env: NodeJS.ProcessEnv, publicUrl: string): IClerkConfig | { problem: string } | null {
  const key = env.CLERK_JWT_KEY?.trim();
  if (!key) return null;
  let publicKey: KeyObject;
  try {
    publicKey = createPublicKey(pem(key));
  } catch {
    return { problem: 'CLERK_JWT_KEY is not a public key this hub can read. It is the PEM text Clerk shows as its JWKS public key.' };
  }
  const publishableKey = env.CLERK_PUBLISHABLE_KEY?.trim();
  if (!publishableKey) return { problem: 'CLERK_PUBLISHABLE_KEY is not set, so the landing page has nothing to load Clerk with.' };
  const parties = (env.CLERK_AUTHORIZED_PARTIES?.trim() || publicUrl).split(',').map(p => p.trim().replace(/\/+$/, '')).filter(Boolean);
  const secret = env.CLERK_WEBHOOK_SECRET?.trim();
  return {
    publicKey,
    publishableKey,
    parties,
    ...(secret ? { webhookSecret: Buffer.from(secret.replace(/^whsec_/, ''), 'base64') } : {}),
    ...(env.CLERK_SECRET_KEY?.trim() ? { secretKey: env.CLERK_SECRET_KEY.trim() } : {}),
    api: 'https://api.clerk.com'
  };
}

const part = (text: string) => JSON.parse(Buffer.from(text, 'base64url').toString('utf8'));

/** Who a Clerk session token is, if Clerk signed it, it is in its time, and it came from this hub's own pages. */
export function readClerkToken(config: IClerkConfig, token: unknown, now: number): IClerkWho | { problem: string } {
  if (typeof token !== 'string') return { problem: 'No token came with that.' };
  const [head, body, signature, ...more] = token.split('.');
  if (!head || !body || !signature || more.length > 0) return { problem: 'That is not a session token.' };
  let header: any;
  let claims: any;
  try {
    header = part(head);
    claims = part(body);
  } catch {
    return { problem: 'That is not a session token.' };
  }
  // The algorithm is this hub's choice, never the token's: a token naming another is refused before any check
  if (header?.alg !== 'RS256') return { problem: 'That token is not signed the way this hub\'s accounts are.' };
  let signed = false;
  try {
    signed = verify('RSA-SHA256', Buffer.from(`${head}.${body}`), config.publicKey, Buffer.from(signature, 'base64url'));
  } catch {
    signed = false;
  }
  if (!signed) return { problem: 'That token was not signed by this hub\'s accounts.' };
  const at = Math.floor(now / 1000);
  if (typeof claims.exp !== 'number' || at > claims.exp + CLOCK_LEEWAY_S) return { problem: 'That sign-in has run out. Sign in again.' };
  if (typeof claims.nbf === 'number' && at < claims.nbf - CLOCK_LEEWAY_S) return { problem: 'That token is not good yet.' };
  // A token made for another site's page is not for this one
  if (typeof claims.azp !== 'string' || !config.parties.includes(claims.azp.replace(/\/+$/, ''))) return { problem: 'That token was not made for this hub\'s pages.' };
  if (typeof claims.sub !== 'string' || !/^[A-Za-z0-9_]+$/.test(claims.sub)) return { problem: 'That token names no account.' };
  const handle = typeof claims.handle === 'string' && claims.handle.trim() ? claims.handle.trim().slice(0, 64) : undefined;
  return { userId: claims.sub, ...(handle ? { handle } : {}) };
}

/** What Clerk sent, if its sender signed these very bytes within the window. */
export function readClerkWebhook(config: IClerkConfig, headers: Record<string, string | string[] | undefined>, raw: string, now: number): { type: string; data: any } | { problem: string } {
  if (!config.webhookSecret) return { problem: 'This hub was given no secret to check Clerk\'s word with.' };
  const one = (name: string) => { const v = headers[name]; return Array.isArray(v) ? v[0] : v; };
  const id = one('svix-id');
  const stamp = one('svix-timestamp');
  const signatures = one('svix-signature');
  if (!id || !stamp || !signatures) return { problem: 'That is not signed.' };
  const sentAt = Number(stamp);
  if (!Number.isFinite(sentAt) || Math.abs(Math.floor(now / 1000) - sentAt) > WEBHOOK_WINDOW_S) return { problem: 'That was signed too long ago.' };
  const mine = createHmac('sha256', config.webhookSecret).update(`${id}.${stamp}.${raw}`).digest();
  const matches = signatures.split(' ').some(entry => {
    const [version, value] = entry.split(',');
    if (version !== 'v1' || !value) return false;
    const theirs = Buffer.from(value, 'base64');
    return theirs.length === mine.length && timingSafeEqual(theirs, mine);
  });
  if (!matches) return { problem: 'That was not signed by this hub\'s accounts.' };
  try {
    const said = JSON.parse(raw);
    return typeof said?.type === 'string' ? { type: said.type, data: said.data ?? {} } : { problem: 'That says nothing this hub reads.' };
  } catch {
    return { problem: 'That is not JSON.' };
  }
}

/** The account at Clerk, deleted: its e-mail and password go with it. Gone already is done. */
export async function deleteClerkUser(config: IClerkConfig, userId: string): Promise<{ ok: boolean; reason?: string }> {
  if (!config.secretKey) return { ok: false, reason: 'This hub was given no key to delete the account at Clerk with (CLERK_SECRET_KEY).' };
  try {
    const res = await fetch(`${config.api}/v1/users/${encodeURIComponent(userId)}`, { method: 'DELETE', headers: { Authorization: `Bearer ${config.secretKey}` } });
    if (res.ok || res.status === 404) return { ok: true };
    return { ok: false, reason: `Clerk answered ${res.status}.` };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

/** Where a publishable key's instance answers its pages: the key is that address, encoded. */
export function clerkFrontendHost(publishableKey: string): string | null {
  const encoded = publishableKey.replace(/^pk_(test|live)_/, '');
  try {
    const host = Buffer.from(encoded, 'base64').toString('utf8').replace(/\$$/, '');
    return /^[a-z0-9.-]+$/i.test(host) ? host : null;
  } catch {
    return null;
  }
}
