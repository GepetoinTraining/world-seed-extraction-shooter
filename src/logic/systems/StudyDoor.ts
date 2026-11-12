/**
 * Study, reaching out: the part of a sitting that touches stores, the ledger and the clock.
 * The rules are in StudySystem and LoreSystem and stay pure; this is where they meet the world.
 *
 * It pays when it begins, takes its time, and lands when the clock ends: the roll, the
 * damage, the row on the ledger. What it comes to waits for a dream (RestDoor).
 */

import { IItem, IStudyTarget, StudyOutcome } from '../../../shared/types';
import type { IPlayerPort } from '../../entities/player/playerView';
import { LoadoutSystem } from '../../../shared/entities/player/systems/LoadoutSystem';
import type { IHubPort } from '../../entities/hub/hubView';
import { ownerHasStationFor } from '../../../shared/entities/hub/room';
import { hubTreeOf } from '../../entities/hub/hubTech';
import { useFeed, useWaits } from '../../components/ui/stores';
import { Ledger } from '../ledger/Ledger';
import { GameClock } from '../time/GameClock';
import { SessionJournal } from '../journal/SessionJournal';
import { LoreSystem } from './LoreSystem';
import { RestSystem } from './RestSystem';
import { StudySystem } from './StudySystem';
import { Escort } from './Escort';
import { WebSystem, rankIndexOf } from '../../../shared/logic/systems/WebSystem';
import { EYE_XP_PER_SITTING, StudyLanding } from './StudyLanding';

const WAIT_ID = 'study_sitting';

/** What was paid for and has not landed. One at a time: a person looks at one thing. */
let paid: { target: IStudyTarget; cost: number } | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

const feed = (text: string, tone: 'plain' | 'signal' | 'proof' | 'loss' = 'plain') => useFeed.getState().push(text, tone);


/**
 * What a target asks that this person does not have, or nothing. The bench is at home, so the field has none.
 * Q27: nothing is read before town, so an unread piece waits for town though it asks for no bench (C6).
 */
const missingStation = (target: IStudyTarget, pc: IPlayerPort, hp: IHubPort): string | null => {
  const player = pc.view().player;
  if (target.kind === 'item' && target.hidden && player.currentSession) return `Nothing is read out here. It can wait for town.`;
  if (!target.station) return null;
  if (player.currentSession) return `That wants a workstation, and yours is not out here. It can wait for home.`;
  const { lots, rooms } = hp.view();
  const stash = player.bank.stashTabs.flatMap(t => t.items);
  return ownerHasStationFor(target.station, player.id, { lots, rooms, stash }) ? null : `You have no workstation for that. A bench of your own would do.`;
};

export const StudyDoor = {
  /** What is on the clock right now. */
  sitting: () => paid,

  /** Should this piece show the button at all? */
  offered: (item: IItem, pc: IPlayerPort, hp: IHubPort): boolean => !Escort.isCorpse(item) && missingStation(StudySystem.targetOfItem(item), pc, hp) === null,

  /** Paid up front. Nothing has been decided yet. */
  begin(target: IStudyTarget, pc: IPlayerPort, hp: IHubPort): { ok: boolean; reason?: string; cost?: number; seconds?: number } {
    if (paid) return { ok: false, reason: `You are already sitting with ${paid.target.name}.` };
    const held = target.kind === 'item' ? StudySystem.heldItem(pc.view().player, target.ref) : undefined;
    if (held && Escort.isCorpse(held)) return { ok: false, reason: `${held.name} is not yours to look through.` };
    const missing = missingStation(target, pc, hp);
    if (missing) return { ok: false, reason: missing };
    const player = pc.view().player;
    // What will not sit "for some days" counts them on the game's clock. The tree is the hub's web (S1a).
    const hub = hubTreeOf(hp.view().tech);
    const verdict = StudySystem.canStudy(player, target, GameClock.now(), hub);
    if (!verdict.ok) return verdict;
    const { cost, seconds } = StudySystem.studyAsk(player, target, hub);
    pc.apply({ kind: 'SET', player: StudySystem.pay(player, cost) });
    paid = { target, cost };
    return { ok: true, cost, seconds };
  },

  /** The sitting, on a real clock: what every button in the game calls. */
  start(target: IStudyTarget, pc: IPlayerPort, hp: IHubPort): { ok: boolean; reason?: string; cost?: number; seconds?: number } {
    const out = StudyDoor.begin(target, pc, hp);
    if (!out.ok) {
      feed(out.reason!, 'loss');
      return out;
    }
    const startedAt = Date.now();
    useWaits.getState().begin({ id: WAIT_ID, label: 'STUDYING', startedAt, until: startedAt + out.seconds! * 1000 });
    feed(`Sitting with ${target.name}. ${out.cost} energy, ${out.seconds}s.`, 'signal');
    timer = setTimeout(() => { void StudyDoor.finish(pc, hp); }, out.seconds! * 1000);
    return out;
  },

  /** The clock is up: the roll lands, and it goes on the log. */
  async finish(pc: IPlayerPort, hp: IHubPort): Promise<{ ok: boolean; reason?: string; outcome?: StudyOutcome }> {
    if (!paid) return { ok: false, reason: 'Nothing was paid for. Nobody has looked.' };
    const { target, cost } = paid;
    StudyDoor.reset();

    // One landing for a hand's sitting and a stacked one (StudyLanding): the roll, the wear, the spent document, the teaching
    const landed = StudyLanding.land(pc.view().player, target, cost, GameClock.now(), hubTreeOf(hp.view().tech));
    if (!landed) {
      feed(`${target.name} is not where you left it. What you paid is gone.`, 'loss');
      return { ok: false, reason: 'It is gone.' };
    }
    const { sitting, piece, spent } = landed;
    if (landed.unread) feed('You could not make out what it is. Your eye for this kind of thing is learning.', 'plain');
    pc.apply({ kind: 'SET', player: landed.player });

    // The eye grows either way: an unschooled one is winging it, and it settles at a rest.
    if (landed.eye?.kind === 'GAIN') pc.apply({ kind: 'GAIN_SKILL_XP', skillId: landed.eye.skillId, amount: EYE_XP_PER_SITTING, tags: ['study', 'intel'] });
    if (landed.eye?.kind === 'ACCRUE') pc.apply({ kind: 'ACCRUE', node: { id: landed.eye.skillId, tags: [landed.eye.tag] }, rank: 0 });

    SessionJournal.record('INTERACT', { kind: 'STUDY', target: StudySystem.keyOf(target), outcome: sitting.outcome });
    feed(StudySystem.saidOf(sitting.outcome, target), sitting.outcome === 'failure' || sitting.outcome === 'major_failure' ? 'loss' : 'proof');
    if (spent) feed(`${target.name} has given what it held. It is spent.`, 'plain');
    // The ledger is the person's own record, so it holds the key. Only what the screen showed goes to any door.
    await Ledger.append('TECH', {
      kind: 'STUDY', target: StudySystem.keyOf(target), name: target.name, outcome: sitting.outcome,
      energy: cost, hubId: hp.view().activeHubId, sitting: sitting.id,
      ...((sitting.outcome === 'major_failure' || spent) && piece ? { consumedIds: [piece.id] } : {})
    });
    return { ok: true, outcome: sitting.outcome };
  },

  /** Stops the clock and forgets what was paid. A closed page does the same. */
  reset(): void {
    if (timer) clearTimeout(timer);
    timer = null;
    paid = null;
    useWaits.getState().end(WAIT_ID);
  }
};
