/**
 * TWO PEOPLE MEETING, reaching out: the part of MeetLaw that touches stores and the door.
 *
 * A meeting nobody watched waits in the hub's queue (`meets_${hubId}`, beside the minds) and goes
 * out in a batch on the window's model; a later tick collects it. A meeting somebody watches goes
 * out at once, and its lines come back for the bubbles. Either way, what comes back is judged, and
 * what it changed is written: memory for both, and belonging.
 *
 * With no key, a refusal or a broken answer, the meeting still happened: the memory its deed
 * already wrote stands, and nothing more is added. Nothing waits on a model (D35).
 */

import { VectorNamespace, VectorStore } from '../../../shared/entities/data/VectorStore';
import { worldDay } from '../../entities/hub/worldDay';
import type { IHubPort } from '../../entities/hub/hubView';
import { readSheet, residentIdOf } from '../../entities/hub/guild';
import { residentFacts } from '../../entities/hub/money';
import { MemoryStore } from '../../entities/interaction/memoryStore';
import { cityNameOf, cityPerson, citySurface, cityWantOf } from '../../entities/interaction/talkStore';
import { IntelligenceClient } from '../intelligence/IntelligenceClient';
import { Deeds } from '../memory/Deeds';
import { LadderWeight } from '../memory/MemoryLaw';
import { INeedFill, NpcAgenda } from './NpcAgenda';
import { NpcSheet } from '../../../shared/logic/systems/NpcSheet';
import { IMeetOutcome, MeetLaw } from './MeetLaw';
import { HabitLaw, IStanding, IUsual } from './HabitLaw';
import { PersonLedger } from '../people/PersonLedger';
import { IMeetAsk, IMeetLine, IMeetSide, IMeetWords } from '../../../shared/logic/systems/TalkTypes';
import { UniversalRank } from '../../../shared/types';

/** A meeting as the city saw it: who, who, where, why, and the day. */
export type { IMeeting } from '../../entities/hub/hubView';
import type { IMeeting } from '../../entities/hub/hubView';

/** A meeting waiting or out: its key, and where each stood when it went out, for the habit it may form. */
type IQueued = IMeeting & { key: string; now?: Record<string, IStanding> };

interface IMeetQueue {
  pending: IQueued[];
  out: { id: string; batchId: string; meetings: IQueued[] }[];
  /** The last meeting a model wrote for each pair and routine (HabitLaw.key), to be said again as the usual. */
  habits?: Record<string, IUsual>;
  /** Meetings already talked through, by key, so one pair talks once a day. Days gone by are let go. */
  met: string[];
}

const queueId = (hubId: string) => `meets_${hubId}`;
const emptyQueue = (): IMeetQueue => ({ pending: [], out: [], met: [] });
const dayOfKey = (key: string) => Number(key.split('|')[3]);

async function loadQueue(hubId: string): Promise<IMeetQueue> {
  return (await VectorStore.get<IMeetQueue>(VectorNamespace.TERRITORIES, queueId(hubId)))?.data ?? emptyQueue();
}

async function saveQueue(hubId: string, queue: IMeetQueue): Promise<void> {
  const now = Date.now();
  const today = worldDay();
  // A day gone by cannot repeat, so its keys are let go
  const met = queue.met.filter(k => dayOfKey(k) >= today - 1);
  await VectorStore.put({ id: queueId(hubId), namespace: VectorNamespace.TERRITORIES, data: { ...queue, met }, metadata: { createdAt: now, updatedAt: now, ownerCertUid: hubId, version: 1 } });
}

let turn: Promise<unknown> = Promise.resolve();
/** One at a time: the queue is one record. */
function inTurn<T>(work: () => Promise<T>): Promise<T> {
  const next = turn.then(work, work);
  turn = next.catch(() => undefined);
  return next;
}

/** Who someone in the city is, as a model reads them: a resident, a keeper, or someone on the road at a bench. */
function surfaceOf(id: string, hp: IHubPort): Pick<IMeetSide, 'who' | 'goal' | 'wants'> | null {
  const person = cityPerson(id);
  if (person) {
    const resident = hp.view().guild.residents.find(r => r.id === id);
    const wants = cityWantOf(id, person);
    return { who: citySurface(person), ...(resident?.goal ? { goal: resident.goal.text } : {}), ...(wants ? { wants } : {}) };
  }
  const craftsman = hp.view().craftsmen.find(c => residentIdOf(c.bond) === id);
  if (!craftsman) return null;
  return { who: NpcSheet.surface(readSheet({ bond: craftsman.bond } as never), craftsman.bond.rank as UniversalRank) };
}

async function askOf(hubId: string, m: IMeeting & { key: string }, hp: IHubPort): Promise<IMeetAsk | null> {
  const a = surfaceOf(m.a, hp), b = surfaceOf(m.b, hp);
  if (!a || !b) return null;
  const place = { hubId };
  const ma = await MemoryStore.mount(place, m.a, m.b, m.day, m.why, cityNameOf);
  const mb = await MemoryStore.mount(place, m.b, m.a, m.day, m.why, cityNameOf);
  return { id: m.key, where: m.where, why: m.why, a: { id: m.a, ...a, ...ma }, b: { id: m.b, ...b, ...mb } };
}

/** What a person stands on: their agenda and what is known of them, for the weight of a loss. */
function standingOf(id: string, hp: IHubPort): { agenda: ReturnType<typeof NpcAgenda.fresh>; facts: { house?: boolean; money?: boolean } } | null {
  const hub = hp.view();
  const resident = hub.guild.residents.find(r => r.id === id);
  if (resident) return { agenda: resident.agenda ?? NpcAgenda.fresh(worldDay()), facts: residentFacts(resident, hub.wallets[id] ?? 0) };
  const vendor = hub.vendors[id];
  if (vendor) return { agenda: vendor.agenda, facts: { house: true } };
  return null;
}

/** Where someone stands now, as the usual compares it: their rung by index, and their goal. */
function standingNow(id: string, hp: IHubPort): IStanding | undefined {
  const s = standingOf(id, hp);
  if (!s) return undefined;
  const goal = hp.view().guild.residents.find(r => r.id === id)?.goal?.text;
  return { rung: LadderWeight.standing(s.agenda, s.facts), ...(goal ? { goal } : {}) };
}

function standingsOf(m: IMeeting, hp: IHubPort): Record<string, IStanding> {
  const out: Record<string, IStanding> = {};
  for (const id of [m.a, m.b]) { const s = standingNow(id, hp); if (s) out[id] = s; }
  return out;
}

const habitKey = (m: IMeeting) => HabitLaw.key(m.a, m.b, m.where, m.why);

/** Every meeting writes the routine for both: the other met them, here, over this. The φ law makes a habit of it. */
const writeRoutines = (hubId: string, meetings: IMeeting[]) => MemoryStore.write({ hubId }, meetings.flatMap(m => [
  { owner: m.a, what: HabitLaw.routine({ day: m.day, owner: m.a, other: m.b, where: m.where, why: m.why }) },
  { owner: m.b, what: HabitLaw.routine({ day: m.day, owner: m.b, other: m.a, where: m.where, why: m.why }) }
]));

/** Is this meeting the usual? Read from both minds as they stand today, against the meeting last written for the pair. */
async function usualOf(hubId: string, m: IMeeting, habits: Record<string, IUsual>, hp: IHubPort) {
  const place = { hubId };
  const minds = { [m.a]: await MemoryStore.mind(place, m.a, m.day), [m.b]: await MemoryStore.mind(place, m.b, m.day) };
  return HabitLaw.decide({ ...m, today: m.day, minds, book: await MemoryStore.book(place), now: standingsOf(m, hp), last: habits[habitKey(m)] });
}

/** What a model wrote for a pair, kept to say again. */
function keepHabit(q: IMeetQueue, m: IQueued, outcome: IMeetOutcome, hp: IHubPort): void {
  const habits = q.habits ?? (q.habits = {});
  habits[habitKey(m)] = HabitLaw.keep(outcome, m.a, m.b, m.now ?? standingsOf(m, hp), m.day, habits[habitKey(m)]);
}

/** What a meeting changed, written: belonging for both, and what each keeps of the other. */
async function settle(hubId: string, outcomes: { meeting: IMeeting; outcome: IMeetOutcome; usual?: boolean }[], hp: IHubPort): Promise<void> {
  if (outcomes.length === 0) return;
  const fills: Record<string, INeedFill> = {};
  const add = (id: string, fill: INeedFill) => { fills[id] = { belonging: (fills[id]?.belonging ?? 0) + (fill.belonging ?? 0) }; };
  for (const { meeting, outcome } of outcomes) {
    add(meeting.a, MeetLaw.fillOf(outcome.a.band));
    add(meeting.b, MeetLaw.fillOf(outcome.b.band));
  }
  await hp.fillAgendas(fills);
  const fallOf = (id: string, band: IMeetOutcome['a']['band']) => {
    const standing = standingOf(id, hp);
    return standing ? LadderWeight.of({ loss: MeetLaw.isLoss(band), after: standing }) : 0;
  };
  // On each one's own chain: whom they met, and whether it was the usual
  await PersonLedger.actMany(hubId, outcomes.flatMap(({ meeting, outcome, usual }) => [
    { npcId: meeting.a, act: { kind: 'MET' as const, with: meeting.b, where: meeting.where, why: meeting.why, band: outcome.a.band, usual: !!usual } },
    { npcId: meeting.b, act: { kind: 'MET' as const, with: meeting.a, where: meeting.where, why: meeting.why, band: outcome.b.band, usual: !!usual } }
  ]));
  await MemoryStore.write({ hubId }, outcomes.flatMap(({ meeting, outcome }) => [
    { owner: meeting.a, what: Deeds.met({ day: meeting.day, owner: meeting.a, other: meeting.b, where: meeting.where, why: meeting.why, remember: outcome.a.remember, fall: fallOf(meeting.a, outcome.a.band) }) },
    { owner: meeting.b, what: Deeds.met({ day: meeting.day, owner: meeting.b, other: meeting.a, where: meeting.where, why: meeting.why, remember: outcome.b.remember, fall: fallOf(meeting.b, outcome.b.band) }) }
  ]));
}

export const MeetDoor = {
  /** Meetings nobody watched, kept until a tick sends them. One pair, one talk a day. */
  queue(hubId: string, meetings: IMeeting[]): Promise<void> {
    if (meetings.length === 0) return Promise.resolve();
    return inTurn(async () => {
      const q = await loadQueue(hubId);
      const known = new Set([...q.met, ...q.pending.map(p => p.key), ...q.out.flatMap(o => o.meetings.map(m => m.key))]);
      const added: IMeeting[] = [];
      for (const m of meetings) {
        if (m.a === m.b) continue;
        const key = MeetLaw.key(m.a, m.b, m.day);
        if (known.has(key)) continue;
        known.add(key);
        q.pending.push({ ...m, key });
        added.push(m);
      }
      if (added.length === 0) return;
      await saveQueue(hubId, q);
    });
  },

  /** Has this pair talked today, or is it waiting to? */
  async talkedToday(hubId: string, a: string, b: string, day: number): Promise<boolean> {
    const key = MeetLaw.key(a, b, day);
    const q = await loadQueue(hubId);
    return q.met.includes(key) || q.pending.some(p => p.key === key) || q.out.some(o => o.meetings.some(m => m.key === key));
  },

  /**
   * Collect what came back, then send what waits, as one batch. A batch over what a window may
   * spend is halved until it fits; one meeting alone over it is let go. No key means no batch: what
   * waits is let go, and the deeds' own memories stand.
   */
  tick(hubId: string, hp: IHubPort): Promise<void> {
    return inTurn(async () => {
      const q = await loadQueue(hubId);
      const settled: { meeting: IMeeting; outcome: IMeetOutcome; usual?: boolean }[] = [];
      // Whatever leaves the queue happened: its routine is written once it is settled, so neither the
      // habit nor the context ever counts the meeting being decided
      const happened: IMeeting[] = [];
      const done = (ms: IQueued[]) => { q.met.push(...ms.map(m => m.key)); happened.push(...ms); };

      const stillOut: IMeetQueue['out'] = [];
      for (const batch of q.out) {
        const got = await IntelligenceClient.collectWindow<{ meetings: Partial<IMeetWords>[] }>(batch.batchId);
        if (got.status === 'OK') {
          const { outcomes } = MeetLaw.judgeBatch(got.data, batch.meetings.map(m => ({ id: m.key })));
          for (const outcome of outcomes) {
            const meeting = batch.meetings.find(m => m.key === outcome.id)!;
            settled.push({ meeting, outcome });
            keepHabit(q, meeting, outcome, hp);
          }
          done(batch.meetings);
        } else if (got.status === 'PENDING' || got.status === 'OUTAGE' || got.status === 'OFFLINE') {
          stillOut.push(batch);
        } else {
          done(batch.meetings);
        }
      }
      q.out = stillOut;

      // The usual first: a meeting that is one goes no further than this, and costs nothing
      let waiting: IQueued[] = [];
      for (const m of q.pending) {
        const verdict = await usualOf(hubId, m, q.habits ?? {}, hp);
        if (verdict.usual) {
          settled.push({ meeting: m, outcome: HabitLaw.replay(q.habits![habitKey(m)], m.key, m.a, m.b), usual: true });
          done([m]);
        } else waiting.push({ ...m, now: standingsOf(m, hp) });
      }
      q.pending = [];
      let size = waiting.length;
      while (waiting.length > 0) {
        const part = waiting.slice(0, size);
        const asks = (await Promise.all(part.map(m => askOf(hubId, m, hp)))).filter((a): a is IMeetAsk => !!a);
        const filedOnes = part.filter(m => asks.some(a => a.id === m.key));
        done(part.filter(m => !filedOnes.includes(m)));
        if (asks.length === 0) { waiting = waiting.slice(part.length); continue; }
        const id = `meet_${hubId}_${filedOnes[0].key}_${filedOnes.length}`;
        const filed = await IntelligenceClient.fileWindow(id, 'meet', asks, {}, 0) as { status: string; batchId?: string; data?: unknown };
        if (filed.status === 'OVER_LIMIT' && part.length > 1) { size = Math.ceil(part.length / 2); continue; }
        if (filed.status === 'PENDING' && filed.batchId) q.out.push({ id, batchId: filed.batchId, meetings: filedOnes });
        else if (filed.status === 'OK') {
          const { outcomes } = MeetLaw.judgeBatch(filed.data, asks);
          for (const outcome of outcomes) {
            const meeting = filedOnes.find(m => m.key === outcome.id)!;
            settled.push({ meeting, outcome });
            keepHabit(q, meeting, outcome, hp);
          }
          done(filedOnes);
        } else if (filed.status === 'OFFLINE' || filed.status === 'OUTAGE' || filed.status === 'BUSY') {
          // The door could not be reached: they wait for the next tick
          q.pending.push(...waiting);
          break;
        } else {
          done(filedOnes);
        }
        waiting = waiting.slice(part.length);
        size = waiting.length;
      }

      await saveQueue(hubId, q);
      await settle(hubId, settled, hp);
      await writeRoutines(hubId, happened);
    });
  },

  /**
   * A meeting somebody is watching: spoken now, and its lines handed back for the bubbles. Null
   * when this pair has talked today or nothing answered; the meeting still happened either way.
   */
  async live(hubId: string, meeting: IMeeting, hp: IHubPort): Promise<IMeetLine[] | null> {
    const key = MeetLaw.key(meeting.a, meeting.b, meeting.day);
    // Only the claim holds the queue: the talk itself runs beside it
    const claimed = await inTurn(async () => {
      const q = await loadQueue(hubId);
      if (q.met.includes(key) || q.pending.some(p => p.key === key) || q.out.some(o => o.meetings.some(m => m.key === key))) return false;
      q.met.push(key);
      await saveQueue(hubId, q);
      return true;
    });
    if (!claimed) return null;
    try {
      const habits = (await inTurn(() => loadQueue(hubId))).habits ?? {};
      // The usual is said again, and no model is asked
      if ((await usualOf(hubId, meeting, habits, hp)).usual) {
        const outcome = HabitLaw.replay(habits[habitKey(meeting)], key, meeting.a, meeting.b);
        await settle(hubId, [{ meeting, outcome, usual: true }], hp);
        return outcome.lines;
      }
      const now = standingsOf(meeting, hp);
      const ask = await askOf(hubId, { ...meeting, key }, hp);
      if (!ask) return null;
      const got = await IntelligenceClient.npcMeet<IMeetWords>(key, ask);
      if (got.status !== 'OK') return null;
      const verdict = MeetLaw.judge(got.data, ask);
      if (!verdict.ok) return null;
      await inTurn(async () => {
        const q = await loadQueue(hubId);
        keepHabit(q, { ...meeting, key, now }, verdict.outcome!, hp);
        await saveQueue(hubId, q);
      });
      await settle(hubId, [{ meeting, outcome: verdict.outcome! }], hp);
      return verdict.outcome!.lines;
    } finally {
      // It happened, answered or not: the routine is written once it is decided
      await writeRoutines(hubId, [meeting]);
    }
  }
};
