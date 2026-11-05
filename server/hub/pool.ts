/**
 * THE POOL (Pedro, 2026-11-04: "the players in a server can rotate the one using their key, we
 * explain how it works, the more players in a hub the less it costs each one, distributed content
 * generation"). A hub's shared work (a world's passes, the chain, anything written for everyone)
 * rotates among the online players there who opted in, with a key or with a model on their own
 * machine. Each job runs on one player's client, through that client's own door: our side never
 * makes the call. What comes back passes the same law as any manifest (Hub.checkWorld): a theme
 * through ContentRegistry, a kind through CreatureLines, numbers put right as a diff, and what
 * cannot be put right is refused and the job goes back for another turn. So a bad or tampered
 * answer from a client is caught the way any is.
 *
 * Turns: a job goes to the online member who has done the fewest, so the cost goes round. A local
 * model costs its player no money and takes its turns the same; the law judges what comes back,
 * never who wrote it, so a weaker model costs turns (more refusals), never the world's rules.
 *
 * Everyone in the pool sees who is in it, with which voice, what each has done and what each has
 * spent, as their own client reported it: the hub cannot see a provider's bill, and says so.
 * Stateless, like the hub: every fact is in the store.
 */
import { randomBytes } from 'node:crypto';
import type { Hub } from './Hub';
import { refuse, type IRefusal } from './Hub';
import { ContentRegistry } from '../../src/logic/theme/ContentRegistry';
import { CreatureLines, type ILineProof } from '../../src/logic/theme/CreatureLines';
import { bodyOf } from '../../src/logic/theme/ThemeCompiler';
import type { IThemeBody } from '../../src/logic/theme/ThemeTypes';
import { judgeChain, judgeLoot, judgePass, themeOfLootJob } from './poolLaw';

export type PoolVoice = 'keyed' | 'local';
/**
 * The kinds of shared work this hub has a law for. Another kind joins with its own law. A world's
 * passes, the chain and loot tables are what the game's own producers post (poolLaw.ts).
 */
export type JobKind = 'theme' | 'kind' | 'pass' | 'chain' | 'loot';

const VOICES: PoolVoice[] = ['keyed', 'local'];
const KINDS: JobKind[] = ['theme', 'kind', 'pass', 'chain', 'loot'];
/** A member is online while it has been heard from within this long. */
const ONLINE_MS = 90_000;
/** A taken job not handed in within this long goes back for another turn. */
const LEASE_MS = 120_000;

interface IMember { type: 'hub_pool'; account: string; handle: string; voice: PoolVoice; since: number; lastSeen: number; jobsDone: number; spentUsd: number; left?: number }
interface IJob { type: 'hub_job'; id: string; kind: JobKind; path: string; body: unknown; postedBy: string; at: number; state: 'OPEN' | 'TAKEN' | 'DONE' | 'WITHDRAWN'; takenBy?: string; takenAt?: number; result?: unknown; doneBy?: string }

const memberId = (account: string) => `hub_pool_${account}`;

export class HubPool {
  constructor(private readonly hub: Hub) {}

  private async member(account: string) {
    return this.hub.read<IMember>(memberId(account));
  }

  private put(id: string, data: object, createdAt?: number) {
    return this.hub.commit([{ kind: 'put', doc: this.hub.doc(id, data as Record<string, unknown>, createdAt) }]);
  }

  private online(m: IMember) {
    return !m.left && this.hub.now() - m.lastSeen < ONLINE_MS;
  }

  private async all(): Promise<IMember[]> {
    const docs = await this.hub.store.query({ namespace: 'hub', filter: { 'data.type': 'hub_pool' } });
    return docs.map(d => JSON.parse(d.dataText) as IMember).sort((a, b) => a.since - b.since || (a.account < b.account ? -1 : 1));
  }

  /** Heard from: a beat, a take, a hand-in. */
  private async seen(m: { doc: { metadata: { createdAt: number } }; data: IMember }) {
    await this.put(memberId(m.data.account), { ...m.data, lastSeen: this.hub.now() }, m.doc.metadata.createdAt);
  }

  async join(token: unknown, voice: PoolVoice): Promise<{ ok: true; voice: PoolVoice } | IRefusal> {
    const account = await this.hub.who(token);
    if ('ok' in account) return account;
    if (!VOICES.includes(voice)) return refuse(400, 'A player joins with a key or with a model on their own machine.');
    const held = await this.member(account.key);
    const now = this.hub.now();
    const data: IMember = { type: 'hub_pool', account: account.key, handle: account.handle, voice, since: held && !held.data.left ? held.data.since : now, lastSeen: now, jobsDone: held?.data.jobsDone ?? 0, spentUsd: held?.data.spentUsd ?? 0 };
    await this.put(memberId(account.key), data, held?.doc.metadata.createdAt);
    return { ok: true, voice };
  }

  async leave(token: unknown): Promise<{ ok: true } | IRefusal> {
    const account = await this.hub.who(token);
    if ('ok' in account) return account;
    const held = await this.member(account.key);
    if (held && !held.data.left) await this.put(memberId(account.key), { ...held.data, left: this.hub.now() }, held.doc.metadata.createdAt);
    return { ok: true };
  }

  async beat(token: unknown): Promise<{ ok: true } | IRefusal> {
    const account = await this.hub.who(token);
    if ('ok' in account) return account;
    const held = await this.member(account.key);
    if (!held || held.data.left) return refuse(403, 'Join the pool first.');
    await this.seen(held);
    return { ok: true };
  }

  async members(token: unknown) {
    const account = await this.hub.who(token);
    if ('ok' in account) return account;
    const members = (await this.all()).filter(m => !m.left).map(m => ({ handle: m.handle, voice: m.voice, jobsDone: m.jobsDone, spentUsd: m.spentUsd, online: this.online(m), since: m.since }));
    return { ok: true as const, members, says: 'Spent is what each player\'s own client reported: the hub never sees a provider\'s bill.' };
  }

  /** Jobs posted in the same millisecond have no order between them. */
  async post(token: unknown, job: { kind: JobKind; path: string; body: unknown }): Promise<{ ok: true; reason?: undefined; jobId: string } | IRefusal> {
    const account = await this.hub.who(token);
    if ('ok' in account) return account;
    if (!KINDS.includes(job?.kind)) return refuse(400, `This hub has no law for that kind of work yet: it checks ${KINDS.join(' and ')}.`);
    if (typeof job.path !== 'string' || !job.path.startsWith('/')) return refuse(400, 'A job names the door it asks.');
    // A table is judged against its theme, so the hub must hold that theme before anyone spends a turn
    if (job.kind === 'loot' && !(await this.hub.knownTheme(themeOfLootJob(job.body) ?? ''))) return refuse(400, 'A loot job names a theme this hub holds.');
    const now = this.hub.now();
    const id = `hub_job_${String(now).padStart(15, '0')}_${randomBytes(6).toString('hex')}`;
    const data: IJob = { type: 'hub_job', id, kind: job.kind, path: job.path, body: job.body ?? {}, postedBy: account.key, at: now, state: 'OPEN' };
    await this.put(id, data);
    return { ok: true, jobId: id };
  }

  private async jobs(): Promise<IJob[]> {
    const docs = await this.hub.store.query({ namespace: 'hub', filter: { 'data.type': 'hub_job' } });
    return docs.map(d => JSON.parse(d.dataText) as IJob).sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : 1));
  }

  /** The oldest open job, if it is this member's turn: the online member who has done the fewest. */
  async take(token: unknown): Promise<{ ok: true; job: { id: string; kind: JobKind; path: string; body: unknown } | null; turn?: string } | IRefusal> {
    const account = await this.hub.who(token);
    if ('ok' in account) return account;
    const held = await this.member(account.key);
    if (!held || held.data.left) return refuse(403, 'Join the pool first.');
    await this.seen(held);

    const now = this.hub.now();
    const queue = (await this.all()).filter(m => this.online(m) || m.account === account.key).sort((a, b) => a.jobsDone - b.jobsDone || a.since - b.since || (a.account < b.account ? -1 : 1));
    if (queue[0]?.account !== account.key) return { ok: true, job: null, turn: `${queue[0]?.handle ?? 'another player'} is next.` };

    const open = (await this.jobs()).find(j => j.state === 'OPEN' || (j.state === 'TAKEN' && now - (j.takenAt ?? 0) >= LEASE_MS));
    if (!open) return { ok: true, job: null };
    const taken = await this.hub.read<IJob>(open.id);
    await this.put(open.id, { ...open, state: 'TAKEN', takenBy: account.key, takenAt: now }, taken?.doc.metadata.createdAt);
    return { ok: true, job: { id: open.id, kind: open.kind, path: open.path, body: open.body } };
  }

  /** What a member's door answered. Checked by the law of its kind; the member's spend is counted either way. */
  async done(token: unknown, jobId: string, outcome: { status?: string; data?: unknown; usage?: { usd?: number } }) {
    const account = await this.hub.who(token);
    if ('ok' in account) return account;
    const job = await this.hub.read<IJob>(String(jobId ?? ''));
    if (!job) return refuse(404, 'No such job.');
    if (job.data.state !== 'TAKEN' || job.data.takenBy !== account.key) return refuse(403, 'That job is not yours to hand in.');

    const member = await this.member(account.key);
    const usd = Number(outcome?.usage?.usd);
    const spent = Number.isFinite(usd) && usd > 0 ? usd : 0;
    const counted = (done: boolean) => member && this.put(memberId(account.key), { ...member.data, lastSeen: this.hub.now(), spentUsd: Math.round((member.data.spentUsd + spent) * 1e6) / 1e6, jobsDone: member.data.jobsDone + (done ? 1 : 0) }, member.doc.metadata.createdAt);
    const reopen = async (status: number, reason: string) => {
      await this.put(job.data.id, { ...job.data, state: 'OPEN', takenBy: undefined, takenAt: undefined }, job.doc.metadata.createdAt);
      await counted(false);
      return refuse(status, `${reason} It goes back for another turn.`);
    };

    if (outcome?.status !== 'OK' || outcome.data === undefined) return reopen(422, 'The door did not answer with something to check.');

    let result: unknown = outcome.data;
    let diff: { op: 'replace'; path: string; value: unknown }[] = [];
    if (job.data.kind === 'theme') {
      // The words a new theme may use are judged against what this hub holds, the shipped themes first
      await this.hub.knownTheme('');
      const verdict = ContentRegistry.judge(bodyOf(outcome.data as IThemeBody));
      if (!verdict.ok) return reopen(422, verdict.reason ?? 'The law refused it.');
    } else if (job.data.kind === 'pass' || job.data.kind === 'chain' || job.data.kind === 'loot') {
      const judged = job.data.kind === 'pass' ? judgePass(job.data.body, outcome.data)
        : job.data.kind === 'chain' ? judgeChain(job.data.body, outcome.data)
        : judgeLoot(job.data.body, outcome.data, (await this.hub.knownTheme(themeOfLootJob(job.data.body) ?? '')) ? ContentRegistry.get(themeOfLootJob(job.data.body)) : undefined);
      if (!judged.ok) return reopen(422, judged.reason);
      result = judged.result;
    } else {
      const proof = outcome.data as ILineProof;
      if (!proof || typeof proof !== 'object' || !Array.isArray(proof.nodes) || !Array.isArray(proof.roots) || typeof proof.def !== 'object') return reopen(422, 'That is not a kind\'s proof.');
      // Its numbers are checked against its theme, so the hub must hold that theme
      if (typeof proof.themeId !== 'string' || !(await this.hub.knownTheme(proof.themeId))) return reopen(422, 'Its theme is not one this hub holds.');
      const put = await CreatureLines.correctProof(proof);
      if (!put.ok) return reopen(422, put.reason);
      diff = put.changes.map(c => ({ op: 'replace' as const, path: `/def/${c.field}`, value: c.value }));
      result = { ...proof, def: put.def };
    }

    await this.put(job.data.id, { ...job.data, state: 'DONE', result, doneBy: account.key }, job.doc.metadata.createdAt);
    await counted(true);
    return { ok: true as const, state: 'DONE' as const, diff };
  }

  /** A poster that stopped waiting takes its job back, unless it is already done. */
  async withdraw(token: unknown, jobId: string): Promise<{ ok: true; reason?: undefined } | IRefusal> {
    const account = await this.hub.who(token);
    if ('ok' in account) return account;
    const job = await this.hub.read<IJob>(String(jobId ?? ''));
    if (!job) return refuse(404, 'No such job.');
    if (job.data.postedBy !== account.key) return refuse(403, 'Only the one who posted a job takes it back.');
    if (job.data.state === 'DONE') return refuse(409, 'That job is done; its result stands.');
    await this.put(job.data.id, { ...job.data, state: 'WITHDRAWN' }, job.doc.metadata.createdAt);
    return { ok: true };
  }

  async get(token: unknown, jobId: string) {
    const account = await this.hub.who(token);
    if ('ok' in account) return account;
    const job = await this.hub.read<IJob>(String(jobId ?? ''));
    if (!job) return refuse(404, 'No such job.');
    const { state, kind, result, at } = job.data;
    return { ok: true as const, job: { id: job.data.id, kind, state, at, ...(state === 'DONE' ? { result } : {}) } };
  }
}
