/**
 * THE TALK, AS IT IS HAPPENING (D113, D114, D116). One talk at a time, in a person's own hands:
 * who they are talking to, what has been said, and the round that is out.
 *
 * A round goes: what it costs, the keyed roll, what is required, in a city the goal if it needs
 * setting (D116: before the answer), the door, the law, the sums, the meter, the record. The law
 * is TalkLaw's and the reaching out is TalkDoor's. This file only walks the steps and keeps what
 * came of them.
 *
 * Where the meter lives: a person or monster in the field keeps it on their entity, as
 * `npc.disposition`, where following has always read it. A person in the city keeps it in a
 * record of their own beside the hub, so it survives a reload and nothing bloats the hub's doc.
 */

import { create } from 'zustand';
import { IAttributes, UniversalRank } from '../../../types';
import { VectorNamespace, VectorStore } from '../data/VectorStore';
import { HUB_NPCS } from '../hub/HubGenerator';
import { readSheet } from '../hub/guild';
import { useHubStore, worldDay } from '../hub/store';
import { MOB_DEFINITIONS } from '../mob/data/mobDefinitions';
import { MobAI } from '../mob/ai/MobAI';
import { usePlayerStore } from '../player/store';
import { useWorldStore } from '../world/store';
import { INpcSheet, IWorldEntity } from '../world/types';
import { WebBank } from '../../logic/content/WebBank';
import { SessionJournal } from '../../logic/journal/SessionJournal';
import { Rng } from '../../logic/rng/DeterministicRNG';
import { IDoorUsage } from '../../logic/intelligence/IntelligenceClient';
import { ILadderFacts, INpcAgenda, LADDER, NpcAgenda } from '../../logic/systems/NpcAgenda';
import { NpcSheet } from '../../logic/systems/NpcSheet';
import { MonsterMind, Stance } from '../../logic/systems/MonsterMind';
import { StatSystem } from '../../logic/systems/StatSystem';
import { WebSystem } from '../../logic/systems/WebSystem';
import { TalkDoor } from '../../logic/systems/TalkDoor';
import { TALK_ENERGY, TalkLaw } from '../../logic/systems/TalkLaw';
import { IGoalAsk, ILogLine, IRoundAsk, ITalkSurface, JudgeBand, TALK_MESSAGE_LIMIT } from '../../logic/systems/TalkTypes';
import { useFeed } from '../../components/ui/stores';

export type TalkSubject =
  | { kind: 'FIELD_PERSON'; entityId: string }
  | { kind: 'MONSTER'; entityId: string }
  | { kind: 'CITY'; npcId: string };

/** One round, as it stood when it was settled. The window reads this and the journal holds it. */
export interface IRoundRecord {
  said: string;
  roll: number;
  required: number;
  band: JudgeBand;
  bonus: number;
  total: number;
  landed: boolean;
  delta: number;
  disposition: number;
  gated?: boolean;
  by: 'DOOR' | 'FLOOR';
  reply: string;
}

export interface ITalkGoal {
  need: string;
  text: string;
  by: 'DOOR' | 'FLOOR';
  setAt: number;
  /** Nothing has answered yet and nothing was paid for: it asks again next round, in case something does. */
  unanswered?: boolean;
}

/** A city person's record, beside the hub. The whole log stays here: only its tail goes out. */
interface ICityTalkRecord {
  npcId: string;
  disposition: number;
  attempts: number;
  agenda: INpcAgenda;
  goal: ITalkGoal | null;
  log: ILogLine[];
}

interface ITalkState {
  subject: TalkSubject | null;
  /** What the window calls them. A monster's stays masked (D60). */
  title: string;
  ready: boolean;
  busy: boolean;
  log: ILogLine[];
  rounds: IRoundRecord[];
  meter: number;
  /** What the door last said about why no model answered, in plain words. */
  note: string;
  /** Dollars this talk has spent, on what came back. */
  spentUsd: number;
  goal: ITalkGoal | null;
  stance: Stance | null;
  wants: string | null;

  open: (subject: TalkSubject) => Promise<void>;
  close: () => void;
  say: (text: string) => Promise<void>;
  /** A gift, offered inside the talk. */
  give: () => void;
  /** The meter reached the line, and they come. */
  bring: () => void;
}

const EMPTY = {
  subject: null, title: '', ready: false, busy: false, log: [], rounds: [], meter: 0, note: '', spentUsd: 0, goal: null, stance: null, wants: null
};

/** What the door's answer means to someone standing there. */
const SAID_WHEN_SILENT: Record<string, string> = {
  NO_KEY: 'No voice on this server: rounds still roll, on the words alone.',
  OFFLINE: 'The door cannot be reached: rounds still roll, on the words alone.',
  OVER_LIMIT: 'This talk has spent what a talk may spend: rounds still roll, on the words alone.',
  BUSY: 'They are slow to answer just now: the round rolled without it.',
  REFUSED: 'That got no answer: the round rolled without it.'
};

/** A person's log in the field lasts as long as the world's own memory of them: this session. */
const fieldLogs = new Map<string, ILogLine[]>();

const cityRecordId = (hubId: string, npcId: string) => `talk_${hubId}_${npcId}`;

const liveEntity = (id: string): IWorldEntity | undefined =>
  Object.values(useWorldStore.getState().currentMap?.chunks ?? {}).flatMap(c => c.entities).find(e => e.id === id);

const worldFacts = () => {
  const world = useWorldStore.getState();
  return {
    seed: world.currentMap?.seed ?? '',
    webVersion: world.availableWorlds?.find(w => w.id === world.activeWorldId)?.webVersion
  };
};

const playerAttributes = (): IAttributes | undefined => usePlayerStore.getState().player.attributes;

const spendEnergy = (cost: number): boolean => {
  const session = usePlayerStore.getState().player.currentSession;
  if (!session || session.energy < cost) return false;
  usePlayerStore.setState(s => s.player.currentSession ? ({ player: { ...s.player, currentSession: { ...s.player.currentSession, energy: s.player.currentSession.energy - cost } } }) : s);
  return true;
};

const monsterKind = (entity: IWorldEntity) => MOB_DEFINITIONS[entity.definitionId] as (typeof MOB_DEFINITIONS)[string] & { description?: string };

/** A monster's sheet comes into being the first time someone talks to it, keyed like everything else. */
function monsterSheet(seed: string, entity: IWorldEntity): INpcSheet {
  const rng = Rng.fromKey(`${seed}:npc:${entity.id}:nature`);
  const kind = monsterKind(entity);
  return {
    name: entity.displayName ?? 'Unknown Contact',
    temperament: rng.pick(['AGGRESSIVE', 'COWARD', 'TERRITORIAL', 'PASSIVE', 'OPPORTUNIST']),
    objective: rng.pick(['SURVIVE', 'HOARD', 'WITNESS', 'PROTECT_ASSET']),
    want: rng.pick(['GOLD', 'GIFT', 'RESPECT']),
    disposition: MonsterMind.startingMeter(kind, playerAttributes()),
    attempts: 0
  };
}

function monsterSurface(seed: string, entity: IWorldEntity, webVersion: number | undefined): ITalkSurface {
  const kind = monsterKind(entity);
  const sheet = NpcSheet.read(seed, entity, webVersion);
  const mind = MonsterMind.read(seed, entity, kind, webVersion);
  const surface = NpcSheet.surface({ ...sheet, stats: mind.stats, skills: undefined, name: entity.displayName || 'Unknown Contact' }, entity.rank);
  const blurb = kind.description && !kind.description.toLowerCase().includes(kind.name.toLowerCase()) ? kind.description : undefined;
  return { ...surface, body: { tags: kind.tags, behavior: String(kind.behavior), size: String(kind.size), blurb } };
}

/** Who a city person is, wherever they come from. */
function cityPerson(npcId: string): { sheet: INpcSheet; rank: UniversalRank; facts: ILadderFacts; agenda?: INpcAgenda; keeper?: boolean } | null {
  const hub = useHubStore.getState();
  const resident = hub.guild.residents.find(r => r.id === npcId);
  if (resident) return { sheet: readSheet(resident), rank: resident.bond.rank as UniversalRank, facts: { house: !!resident.homeAt } };
  const keeper = HUB_NPCS[npcId];
  if (!keeper) return null;
  const rank = keeper.teaches?.rank ?? UniversalRank.D;
  // A keeper's shop is where they live. Money and family are not known of anyone yet: C3's wallets and D105's people's half will say.
  return { sheet: NpcSheet.keeper(hub.activeHubId ?? 'hub_unknown', npcId, rank, keeper.name), rank, facts: { house: true }, agenda: hub.vendors[npcId]?.agenda, keeper: true };
}

const addUsage = (spent: number, usage?: IDoorUsage) => spent + (usage?.usd ?? 0);

/** A person as a model reads them. A keeper of the center speaks for the hub's whole web, read fresh each time. */
function citySurface(person: NonNullable<ReturnType<typeof cityPerson>>): ITalkSurface {
  const surface = NpcSheet.surface(person.sheet, person.rank);
  if (!person.keeper) return surface;
  const reach = useHubStore.getState().centerReach();
  return { ...surface, city: { knows: reach.skills.map(id => WebSystem.nameOf(id)), opens: reach.stations.map(s => s.name) } };
}

export const useTalk = create<ITalkState>((set, get) => {
  /** What a city person keeps, between one reload and the next. */
  const saveCity = async (npcId: string, agenda: INpcAgenda, attempts: number) => {
    const hubId = useHubStore.getState().activeHubId ?? 'hub_unknown';
    const { meter, goal, log } = get();
    const now = Date.now();
    const data: ICityTalkRecord = { npcId, disposition: meter, attempts, agenda, goal, log };
    await VectorStore.put({ id: cityRecordId(hubId, npcId), namespace: VectorNamespace.TERRITORIES, data, metadata: { createdAt: now, updatedAt: now, ownerCertUid: hubId, version: 1 } });
  };

  const loadCity = async (npcId: string, person: NonNullable<ReturnType<typeof cityPerson>>): Promise<ICityTalkRecord> => {
    const hubId = useHubStore.getState().activeHubId ?? 'hub_unknown';
    const kept = await VectorStore.get<ICityTalkRecord>(VectorNamespace.TERRITORIES, cityRecordId(hubId, npcId));
    if (kept?.data) return kept.data;
    return { npcId, disposition: person.sheet.disposition, attempts: person.sheet.attempts, agenda: NpcAgenda.fresh(worldDay()), goal: null, log: [] };
  };

  /** D116: their goal, set from the log and the sheet, and only when the rung they stand on has moved. */
  const setCityGoal = async (npcId: string, person: NonNullable<ReturnType<typeof cityPerson>>, agenda: INpcAgenda, talkId: string) => {
    const facts = person.facts;
    const rung = NpcAgenda.rung(agenda, facts);
    const standing = get().goal;
    if (standing && standing.need === rung.need && !standing.unanswered) return;
    const hub = useHubStore.getState();
    const ask: IGoalAsk = {
      binding: 'LADDER',
      who: citySurface(person),
      log: get().log,
      need: rung.need,
      rungs: LADDER.map(r => ({ need: r.need, says: r.says, met: NpcAgenda.met(agenda, r, facts) })),
      buildings: hub.buildingWords(),
      questTags: WebBank.current().tags.map(t => t.tag),
      mayPost: !hub.guild.quests.some(q => q.residentId === npcId && q.state === 'OPEN'),
      mayAsk: !hub.openBuildingAsks().some(a => a.askerId === npcId)
    };
    const answer = await TalkDoor.goal(talkId, ask);
    set(s => ({ goal: { need: answer.words.need, text: answer.words.goal, by: answer.by, setAt: worldDay(), unanswered: answer.by === 'FLOOR' && !answer.usage }, spentUsd: addUsage(s.spentUsd, answer.usage) }));
    if (answer.words.quest) await hub.postTalkQuest(npcId, person.sheet.name, person.rank, person.sheet.want, answer.words.quest);
    if (answer.words.building) await hub.askForBuilding(npcId, person.sheet.name, answer.words.building, answer.words.goal, answer.words.need);
  };

  return {
    ...EMPTY,

    open: async (subject) => {
      if (subject.kind === 'CITY') {
        const person = cityPerson(subject.npcId);
        if (!person) return;
        set({ ...EMPTY, subject, title: person.sheet.name, busy: true });
        const record = await loadCity(subject.npcId, person);
        set({ meter: record.disposition, goal: record.goal, log: record.log, busy: false, ready: true });
        return;
      }
      const entity = liveEntity(subject.entityId);
      if (!entity) return;
      const { seed } = worldFacts();
      if (subject.kind === 'FIELD_PERSON') {
        set({ ...EMPTY, subject, title: entity.npc?.name ?? 'Unknown Figure', meter: entity.npc?.disposition ?? 0, log: fieldLogs.get(`${seed}:${entity.id}`) ?? [], ready: true });
        return;
      }
      const npc = entity.npc ?? monsterSheet(seed, entity);
      const stance = MonsterMind.stance(npc.disposition, playerAttributes());
      useWorldStore.getState().updateEntity(entity.id, { npc, bargain: { ...entity.bargain, stance, holding: true } });
      set({
        ...EMPTY, subject, title: entity.displayName || 'Unknown Contact', meter: npc.disposition, stance,
        wants: MonsterMind.wantOf(entity), log: fieldLogs.get(`${seed}:${entity.id}`) ?? [], ready: true
      });
    },

    close: () => {
      const { subject } = get();
      if (subject?.kind === 'MONSTER') {
        const entity = liveEntity(subject.entityId);
        if (entity?.bargain) useWorldStore.getState().updateEntity(subject.entityId, { bargain: { ...entity.bargain, holding: false } });
      }
      set({ ...EMPTY });
    },

    say: async (raw) => {
      const said = raw.trim();
      const { subject, busy, ready } = get();
      if (!subject || !said || busy || !ready) return;
      if (said.length > TALK_MESSAGE_LIMIT) { set({ note: `That is more than anyone can say at once: ${TALK_MESSAGE_LIMIT} characters.` }); return; }
      // Someone can walk off mid-round. What they said is out, and the window is no longer theirs to write in.
      const stillHere = () => get().subject === subject;

      if (subject.kind === 'MONSTER' && MobAI.isProvoked(subject.entityId)) {
        set({ note: 'It is done talking. You hurt it.' });
        return;
      }

      const attrs = playerAttributes();
      const prior = get().log;

      if (subject.kind !== 'CITY') {
        const entity = liveEntity(subject.entityId);
        if (!entity?.npc) { set({ note: 'There is nobody there now.' }); return; }
        if (!spendEnergy(TALK_ENERGY)) {
          set({ note: `A round takes ${TALK_ENERGY} energy. You are out of it.` });
          return;
        }
        set({ busy: true, note: '', log: [...prior, { who: 'THEM', text: said }] });

        const isMonster = subject.kind === 'MONSTER';
        const { seed, webVersion } = worldFacts();
        const attempt = entity.npc.attempts + 1;
        const rollKey = SessionJournal.rollKey('social', `${entity.id}:${attempt}`);
        const roll = TalkLaw.rollOf(rollKey);
        const kind = isMonster ? monsterKind(entity) : undefined;
        const stats = kind ? MonsterMind.read(seed, entity, kind, webVersion).stats : NpcSheet.statsOf(seed, entity);
        const required = TalkLaw.required(entity.npc.want, attrs, entity.rank, stats);
        const who = isMonster ? monsterSurface(seed, entity, webVersion) : NpcSheet.surface(NpcSheet.read(seed, entity, webVersion), entity.rank);
        const startStance = isMonster ? MonsterMind.stance(entity.npc.disposition, attrs) : undefined;
        const ask: IRoundAsk = {
          who, log: prior, said, roll, required, bonuses: TalkLaw.bonuses(), meter: entity.npc.disposition,
          ...(isMonster ? { stance: startStance, mayTellWant: startStance === 'FRIENDLY' } : {})
        };
        const answer = await TalkDoor.round(`${SessionJournal.rollKey('talk', entity.id)}`, ask, { alignment: isMonster ? undefined : who.alignment, hidden: kind ? [kind.name] : [] });

        const now = liveEntity(entity.id);
        if (!now?.npc) { if (stillHere()) set({ busy: false, note: 'There is nobody there now.' }); return; }
        const sums = TalkLaw.settle({ roll, required, band: answer.band, disposition: now.npc.disposition });
        const reply = answer.reply || TalkLaw.floorReply(sums.landed, isMonster ? undefined : now.npc.name);
        const stance = isMonster ? MonsterMind.stance(sums.disposition, attrs) : null;
        // Once it has said what it wants in its own words, that stands. Until then its sheet says, and its words can still replace that.
        const wantsHeard = !!now.bargain?.wantsHeard || (stance === 'FRIENDLY' && !!answer.wants);
        const wants = stance === 'FRIENDLY'
          ? (now.bargain?.wantsHeard ? now.bargain.wants! : answer.wants || now.bargain?.wants || MonsterMind.floorWant(now.npc))
          : now.bargain?.wants ?? null;

        useWorldStore.getState().updateEntity(entity.id, {
          npc: { ...now.npc, disposition: sums.disposition, attempts: attempt },
          ...(isMonster ? { bargain: { ...now.bargain, stance: stance!, holding: stillHere(), wantsHeard, ...(wants ? { wants } : {}) } } : {})
        });
        SessionJournal.record('INTERACT', { kind: isMonster ? 'BARGAIN' : 'TALK', targetId: entity.id, rollKey, roll, required, band: answer.band, bonus: sums.bonus, landed: sums.landed, by: answer.by, disposition: sums.disposition });
        usePlayerStore.getState().processAction({ tags: ['social', 'charisma'], magnitude: sums.landed ? 15 : 5 });
        useFeed.getState().push(`${get().title} ${sums.landed ? 'warms to you' : 'is unconvinced'} (${sums.disposition}/100).`, sums.landed ? 'signal' : 'plain');

        // With no model nobody spoke, so the floor's line is narration, never their words.
        const log: ILogLine[] = [...(stillHere() ? get().log : [...prior, { who: 'THEM' as const, text: said }]), { who: answer.by === 'DOOR' ? 'NPC' : 'NOTE', text: reply }];
        fieldLogs.set(`${seed}:${entity.id}`, log);
        if (!stillHere()) return;
        set(s => ({
          busy: false, log, meter: sums.disposition, stance, wants,
          note: answer.by === 'FLOOR' ? (SAID_WHEN_SILENT[answer.status ?? ''] ?? 'That got no answer: the round rolled without it.') : (answer.gated ? 'They will not do that, whatever you say.' : ''),
          spentUsd: addUsage(s.spentUsd, answer.usage),
          rounds: [...s.rounds, { said, roll, required, band: answer.band, gated: answer.gated, by: answer.by, reply, ...sums }]
        }));
        return;
      }

      // ------ In the city: the goal first, then the answer (D116) ------
      const person = cityPerson(subject.npcId);
      if (!person) return;
      const hubId = useHubStore.getState().activeHubId ?? 'hub_unknown';
      const kept = await loadCity(subject.npcId, person);
      const talkId = `${hubId}:${subject.npcId}:${worldDay()}`;
      const agenda = person.agenda ?? NpcAgenda.fold(kept.agenda, worldDay());
      set({ busy: true, note: '', log: [...prior, { who: 'THEM', text: said, name: usePlayerStore.getState().player.username }] });
      await setCityGoal(subject.npcId, person, agenda, talkId);
      if (!stillHere()) return;

      const attempt = kept.attempts + 1;
      const rollKey = `${hubId}:social:${subject.npcId}:${attempt}`;
      const roll = TalkLaw.rollOf(rollKey);
      const required = TalkLaw.required(person.sheet.want, attrs, person.rank, person.sheet.stats);
      const who = citySurface(person);
      const ask: IRoundAsk = { who, log: prior, said, roll, required, bonuses: TalkLaw.bonuses(), meter: get().meter, goal: get().goal?.text };
      const answer = await TalkDoor.round(talkId, ask, { alignment: who.alignment, hidden: [] });
      // Gone mid-round in the city: it never happened. Nothing is on the record, and the same roll waits for the next try.
      if (!stillHere()) return;
      const sums = TalkLaw.settle({ roll, required, band: answer.band, disposition: get().meter });
      const reply = answer.reply || TalkLaw.floorReply(sums.landed, person.sheet.name);
      set(s => ({
        busy: false, meter: sums.disposition, log: [...s.log, { who: answer.by === 'DOOR' ? 'NPC' : 'NOTE', text: reply }],
        note: answer.by === 'FLOOR' ? (SAID_WHEN_SILENT[answer.status ?? ''] ?? 'That got no answer: the round rolled without it.') : (answer.gated ? 'They will not do that, whatever you say.' : ''),
        spentUsd: addUsage(s.spentUsd, answer.usage),
        rounds: [...s.rounds, { said, roll, required, band: answer.band, gated: answer.gated, by: answer.by, reply, ...sums }]
      }));
      await saveCity(subject.npcId, agenda, attempt);
    },

    give: () => {
      const { subject } = get();
      if (!subject || subject.kind === 'CITY') return;
      const before = usePlayerStore.getState().player.currentSession?.inventory ?? [];
      usePlayerStore.getState().performInteraction(`int_gift_${subject.entityId}`, subject.entityId);
      const after = usePlayerStore.getState().player.currentSession?.inventory ?? [];
      const gone = before.find(item => !after.some(i => i.id === item.id));
      const entity = liveEntity(subject.entityId);
      if (!gone || !entity?.npc) return;
      const { seed } = worldFacts();
      const log: ILogLine[] = [...get().log, { who: 'NOTE', text: `You give them ${gone.name}.` }];
      fieldLogs.set(`${seed}:${entity.id}`, log);
      const stance = subject.kind === 'MONSTER' ? MonsterMind.stance(entity.npc.disposition, playerAttributes()) : null;
      if (stance) useWorldStore.getState().updateEntity(entity.id, { bargain: { ...entity.bargain, stance, holding: true } });
      set({ log, meter: entity.npc.disposition, stance });
    },

    bring: () => {
      const { subject } = get();
      if (subject?.kind !== 'FIELD_PERSON') return;
      usePlayerStore.getState().performInteraction(`int_recruit_${subject.entityId}`, subject.entityId);
      if (!liveEntity(subject.entityId)) set({ ...EMPTY });
    }
  };
});

/** Does the meter open what it opens? The window asks this and the store's own door checks it again. */
export const meterOpensFollowing = (meter: number): boolean => meter >= StatSystem.recruitDisposition(playerAttributes());
