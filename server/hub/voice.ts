/**
 * THE HUB'S OWN VOICE (Pedro, 2026-11-18: "we need the anthropic key inside the pedro .env to be the
 * one deployed, and we need the web vercel deploy to be playable"). Until now a game played from the
 * domain asked a model only on the player's own key or the player's own machine (PageDoor.ts), and a
 * player with neither had no voice at all. With `ANTHROPIC_API_KEY` set on the host, the hub answers
 * the door's own asks itself, for whoever is signed in:
 *
 *   /api/hub/voice/status           whether it answers, and what this account has spent today
 *   /api/hub/voice/<a door's ask>   the same routes and shapes as every other door (shared/intelligence/routes.ts)
 *
 * WHAT IT IS NOT. It is no way to reach the model with words of one's own: the hub builds every
 * prompt from the game's own asks (prompts.ts), and takes none from the caller. The routes that
 * choose a voice, read a machine or take a key are not here at all; those stay the page's.
 *
 * WHOSE MONEY. Every call spends the operator's. So it answers a signed-in account only, and it
 * counts what each call really cost (the provider's own usage, at the door's rates) against two
 * limits a day, in dollars: one for the account, one for the whole hub. They guard the bill and cap
 * no content: what is over waits for the next day, and a player's own key or machine is never
 * counted. The count is kept in the store, so every instance reads the same; two calls landing
 * together can each miss the other's cost, which lets a day run a call or two over and is said here
 * rather than paid for with a lock. A batch is counted when it is filed, at the most it could cost.
 *
 *   ANTHROPIC_API_KEY            the key; without it this hub offers no voice and says so
 *   WS_VOICE_ACCOUNT_DAILY_USD   what one account may spend a day (5 when not set)
 *   WS_VOICE_DAILY_USD           what the whole hub may spend a day (25 when not set)
 */
import type { ServerResponse } from 'node:http';
import Anthropic from '@anthropic-ai/sdk';
import { IntelligenceDoor, type IIntelligenceProvider, type IProviderStatus } from '../../shared/intelligence/door';
import { ClaudeProvider } from '../../shared/intelligence/claude';
import { routeDoor } from '../../shared/intelligence/routes';
import { dayIndexOf } from '../../shared/logic/time/RadixClock';
import type { Hub, IAccount } from './Hub';

export interface IVoiceLimits {
  /** Dollars one account may spend in a day. */
  accountDailyUsd: number;
  /** Dollars every account together may spend in a day. */
  hubDailyUsd: number;
}

/** A first guess, the operator's to change by a setting: a new character and its world cost well under a dollar. */
export const VOICE_LIMITS: IVoiceLimits = { accountDailyUsd: 5, hubDailyUsd: 25 };

/** The door's asks this voice answers: content only. Anything else under the mount is an address that does not exist. */
const ASKS = new Set([
  '/talk', '/theme', '/creation', '/chain', '/loot', '/world/bases', '/material/doing', '/note', '/world/pass',
  '/kami/talk', '/kami/set', '/kami/gift', '/kami/persona',
  '/npc/talk', '/npc/bargain', '/npc/meet', '/npc/goal',
  '/rest/file', '/rest/collect', '/window/file', '/window/collect'
]);
/** Filed work is counted at its ceiling when it is filed, so collecting it is not counted again. */
const FILED = new Set(['/rest/file', '/window/file']);
const COLLECTED = new Set(['/rest/collect', '/window/collect']);
/** A talk's own limit is counted by its id (door.ts), which the hub ties to the account so no one can spend another's. */
const TALKS = new Set(['/npc/talk', '/npc/bargain', '/npc/meet', '/npc/goal']);
/** Written as lines; a refusal there is one line saying how it ended. */
const STREAMED = new Set(['/kami/talk']);

/** How long a good status is taken for, per instance: the provider is asked once, not on every look. */
const STATUS_MS = 60_000;

interface ISpent { day: number; usd: number; calls: number }

const dollars = (value: string | undefined, otherwise: number): number => {
  const n = Number(value?.trim());
  return value?.trim() && Number.isFinite(n) && n >= 0 ? n : otherwise;
};

export const voiceLimitsFrom = (env: NodeJS.ProcessEnv): IVoiceLimits => ({
  accountDailyUsd: dollars(env.WS_VOICE_ACCOUNT_DAILY_USD, VOICE_LIMITS.accountDailyUsd),
  hubDailyUsd: dollars(env.WS_VOICE_DAILY_USD, VOICE_LIMITS.hubDailyUsd)
});

/** The hub's voice on the host's key, or none when no key is set. The key is read here and handed to the provider alone. */
export function hubVoiceFrom(hub: Hub, env: NodeJS.ProcessEnv): HubVoice | null {
  const key = env.ANTHROPIC_API_KEY?.trim();
  if (!key) return null;
  return new HubVoice(hub, new ClaudeProvider(new Anthropic({ apiKey: key })), voiceLimitsFrom(env));
}

const sendJson = (res: ServerResponse, status: number, body: unknown) => {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(JSON.stringify(body));
};

export class HubVoice {
  private readonly door: IntelligenceDoor;
  private said: { at: number; status: IProviderStatus } | null = null;

  constructor(private readonly hub: Hub, provider: IIntelligenceProvider, readonly limits: IVoiceLimits = VOICE_LIMITS) {
    this.door = new IntelligenceDoor(provider);
  }

  private today(): number { return dayIndexOf(this.hub.now()); }

  private async spentOf(id: string): Promise<ISpent> {
    const kept = await this.hub.read<ISpent>(id);
    const day = this.today();
    return kept && kept.data.day === day ? kept.data : { day, usd: 0, calls: 0 };
  }

  private accountId(account: IAccount) { return `hub_voice_${account.key}`; }

  /** What stands between this account and a call, or nothing. */
  private async over(account: IAccount): Promise<string | null> {
    const [mine, all] = await Promise.all([this.spentOf(this.accountId(account)), this.spentOf('hub_voice_day')]);
    if (mine.usd >= this.limits.accountDailyUsd) {
      return `This account has spent $${mine.usd.toFixed(2)} of the $${this.limits.accountDailyUsd.toFixed(2)} a day this hub's own voice gives one account. It answers again tomorrow; a key of your own, or a model on your machine, is never counted.`;
    }
    if (all.usd >= this.limits.hubDailyUsd) {
      return `This hub's own voice has spent the $${this.limits.hubDailyUsd.toFixed(2)} it may in a day, for everyone. It answers again tomorrow; a key of your own, or a model on your machine, is never counted.`;
    }
    return null;
  }

  /** A call's cost, added to the account's day and the hub's. A count that cannot be written is said in the log and the call stands. */
  private async count(account: IAccount, usd: number): Promise<void> {
    if (!(usd > 0)) return;
    try {
      const [mine, all] = await Promise.all([this.spentOf(this.accountId(account)), this.spentOf('hub_voice_day')]);
      await this.hub.commit([
        { kind: 'put', doc: this.hub.doc(this.accountId(account), { type: 'hub_voice', account: account.key, day: mine.day, usd: mine.usd + usd, calls: mine.calls + 1 }) },
        { kind: 'put', doc: this.hub.doc('hub_voice_day', { type: 'hub_voice_day', day: all.day, usd: all.usd + usd, calls: all.calls + 1 }) }
      ]);
    } catch (e) {
      console.warn('[VOICE] A call\'s cost could not be counted:', e instanceof Error ? e.message : e);
    }
  }

  private async status(): Promise<IProviderStatus> {
    const now = this.hub.now();
    if (this.said && this.said.status.available && now - this.said.at < STATUS_MS) return this.said.status;
    const status = await this.door.status();
    this.said = { at: now, status };
    return status;
  }

  /** `path` is what follows /voice. `account` is who the hub's session says is asking, or nobody. */
  async handle(res: ServerResponse, method: string, path: string, body: any, account: IAccount | null): Promise<void> {
    const streamed = STREAMED.has(path);
    const refuse = (http: number, status: string, reason: string) =>
      streamed && http === 200
        ? (res.statusCode = 200, res.setHeader('Content-Type', 'application/x-ndjson'), res.setHeader('Cache-Control', 'no-store'), void res.end(`${JSON.stringify({ done: true, status, reason })}\n`))
        : sendJson(res, http, { status, reason });

    if (path !== '/status' && !ASKS.has(path)) return sendJson(res, 404, { ok: false, reason: 'No such route on this hub.' });
    if (!account) return refuse(401, 'NO_KEY', 'This hub\'s own voice answers whoever is signed in. Sign in on the site\'s first page, then come back.');

    if (path === '/status') {
      const [status, mine] = await Promise.all([this.status(), this.spentOf(this.accountId(account))]);
      return sendJson(res, 200, { ...status, mode: 'auto', host: true, spent: { usd: mine.usd, of: this.limits.accountDailyUsd } });
    }
    if (method !== 'POST') return sendJson(res, 405, { error: 'POST only.' });

    // Collecting what was filed costs nothing more: it was counted at its ceiling when it was filed
    if (!COLLECTED.has(path)) {
      const reason = await this.over(account);
      if (reason) return refuse(200, 'OVER_LIMIT', reason);
    }
    const asked = TALKS.has(path) ? { ...body, talkId: `${account.key}:${String(body?.talkId ?? 'talk')}` } : body ?? {};
    const answer = await routeDoor(this.door, 'POST', path, asked);

    if (!answer.stream) {
      const said = answer.json as { status?: string; usage?: { usd?: number }; ceiling?: number } | undefined;
      const filed = FILED.has(path) && said?.status === 'PENDING' ? Number(said.ceiling) || 0 : 0;
      const usd = FILED.has(path) ? filed : COLLECTED.has(path) ? 0 : Number(said?.usage?.usd) || 0;
      await this.count(account, usd);
      return sendJson(res, answer.status, answer.json);
    }
    res.statusCode = answer.status;
    res.setHeader('Content-Type', 'application/x-ndjson');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const gone = new AbortController();
    res.on('close', () => gone.abort());
    const last = await answer.stream(line => res.write(line), gone.signal);
    let usd = 0;
    try { usd = Number((JSON.parse(last) as { usage?: { usd?: number } }).usage?.usd) || 0; } catch { /* the last line says how it ended, or nothing */ }
    await this.count(account, usd);
    res.end(last);
  }
}
