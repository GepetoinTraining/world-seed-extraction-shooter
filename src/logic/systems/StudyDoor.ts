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
import { useHubStore } from '../../entities/hub/store';
import { ownerHasStationFor } from '../../../shared/entities/hub/room';
import { useFeed, useWaits } from '../../components/ui/stores';
import { Ledger } from '../ledger/Ledger';
import { SessionJournal } from '../journal/SessionJournal';
import { LoreSystem } from './LoreSystem';
import { RestSystem } from './RestSystem';
import { StudySystem } from './StudySystem';
import { Escort } from './Escort';
import { WebSystem, rankIndexOf } from '../../../shared/logic/systems/WebSystem';

const WAIT_ID = 'study_sitting';

/** What was paid for and has not landed. One at a time: a person looks at one thing. */
let paid: { target: IStudyTarget; cost: number } | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

const feed = (text: string, tone: 'plain' | 'signal' | 'proof' | 'loss' = 'plain') => useFeed.getState().push(text, tone);

/** What a sitting says when it lands. A piece can be broken; anything else can only be closed to you. */
const said = (outcome: StudyOutcome, target: IStudyTarget): string => {
  const { name, kind } = target;
  if (outcome === 'major_win') return `${name} opened up further than it should have. You will know how far after you rest.`;
  if (outcome === 'success') return `You sat with ${name} for as long as it took. You will know what it came to after you rest.`;
  if (outcome === 'failure') {
    return kind === 'item'
      ? `You pressed too hard on ${name}. It is the worse for it, and you learned nothing you could keep.`
      : `You pressed too hard on ${name}. Nothing you could keep, and it will be harder next time.`;
  }
  return kind === 'item' ? `${name} is lost to you. Whatever was in it went with it.` : `${name} has closed to you. It will not sit for you for some days.`;
};

/** What a target asks that this person does not have, or nothing. The bench is at home, so the field has none. */
const missingStation = (target: IStudyTarget, pc: IPlayerPort): string | null => {
  if (!target.station) return null;
  const player = pc.view().player;
  if (player.currentSession) return `That wants a workstation, and yours is not out here. It can wait for home.`;
  const { lots, rooms } = useHubStore.getState();
  const stash = player.bank.stashTabs.flatMap(t => t.items);
  return ownerHasStationFor(target.station, player.id, { lots, rooms, stash }) ? null : `You have no workstation for that. A bench of your own would do.`;
};

export const StudyDoor = {
  /** What is on the clock right now. */
  sitting: () => paid,

  /** Should this piece show the button at all? */
  offered: (item: IItem, pc: IPlayerPort): boolean => !Escort.isCorpse(item) && missingStation(StudySystem.targetOfItem(item), pc) === null,

  /** Paid up front. Nothing has been decided yet. */
  begin(target: IStudyTarget, pc: IPlayerPort): { ok: boolean; reason?: string; cost?: number; seconds?: number } {
    if (paid) return { ok: false, reason: `You are already sitting with ${paid.target.name}.` };
    const held = target.kind === 'item' ? StudySystem.heldItem(pc.view().player, target.ref) : undefined;
    if (held && Escort.isCorpse(held)) return { ok: false, reason: `${held.name} is not yours to look through.` };
    const missing = missingStation(target, pc);
    if (missing) return { ok: false, reason: missing };
    const player = pc.view().player;
    const verdict = StudySystem.canStudy(player, target);
    if (!verdict.ok) return verdict;
    const { cost, seconds } = StudySystem.studyAsk(player, target);
    pc.apply({ kind: 'SET', player: StudySystem.pay(player, cost) });
    paid = { target, cost };
    return { ok: true, cost, seconds };
  },

  /** The sitting, on a real clock: what every button in the game calls. */
  start(target: IStudyTarget, pc: IPlayerPort): { ok: boolean; reason?: string; cost?: number; seconds?: number } {
    const out = StudyDoor.begin(target, pc);
    if (!out.ok) {
      feed(out.reason!, 'loss');
      return out;
    }
    const startedAt = Date.now();
    useWaits.getState().begin({ id: WAIT_ID, label: 'STUDYING', startedAt, until: startedAt + out.seconds! * 1000 });
    feed(`Sitting with ${target.name}. ${out.cost} energy, ${out.seconds}s.`, 'signal');
    timer = setTimeout(() => { void StudyDoor.finish(pc); }, out.seconds! * 1000);
    return out;
  },

  /** The clock is up: the roll lands, and it goes on the log. */
  async finish(pc: IPlayerPort): Promise<{ ok: boolean; reason?: string; outcome?: StudyOutcome }> {
    if (!paid) return { ok: false, reason: 'Nothing was paid for. Nobody has looked.' };
    const { target, cost } = paid;
    StudyDoor.reset();

    const before = pc.view().player;
    const piece = target.kind === 'item' ? StudySystem.heldItem(before, target.ref) : undefined;
    if (target.kind === 'item' && !piece) {
      feed(`${target.name} is not where you left it. What you paid is gone.`, 'loss');
      return { ok: false, reason: 'It is gone.' };
    }

    const { player, sitting } = StudySystem.sit(before, target, cost, Date.now());
    let next = player;
    if (LoreSystem.pays(sitting.outcome)) next = RestSystem.queueSitting(next, sitting);
    if (piece && sitting.outcome !== 'major_failure') {
      // D50 still holds: looking gets there. Q27: an unread piece gets there only through the eye for its kind.
      const reads = StudySystem.canRead(before, piece);
      if (reads && (piece.isIdentified === false || piece.affixes.some(a => !LoadoutSystem.isAffixStudied(next, a.id)))) next = RestSystem.queueStudy(next, piece.id);
      if (!reads) feed('You could not make out what it is. Your eye for this kind of thing is learning.', 'plain');
      // D27: loot teaches. What the piece implies accrues, and settles only at a rest.
      if (!target.hidden && LoreSystem.pays(sitting.outcome)) {
        for (const d of WebSystem.reverseEngineer(piece).designs) {
          if (!next.bank.universalSkills[d.skillId]) next = WebSystem.accrueFromStudy(next, { id: d.skillId, tags: d.tags }, rankIndexOf(piece.rank));
        }
      }
    }
    pc.apply({ kind: 'SET', player: next });

    // The eye grows either way: an unschooled one is winging it, and it settles at a rest.
    const scope = piece ? StudySystem.identifyScopeOf(piece) : null;
    if (scope) {
      const eye = StudySystem.scopeSkillId(scope);
      if (next.bank.universalSkills[eye]) pc.apply({ kind: 'GAIN_SKILL_XP', skillId: eye, amount: 15, tags: ['study', 'intel'] });
      else pc.apply({ kind: 'ACCRUE', node: { id: eye, tags: [`identify_${scope}`] }, rank: 0 });
    }

    SessionJournal.record('INTERACT', { kind: 'STUDY', target: StudySystem.keyOf(target), outcome: sitting.outcome });
    feed(said(sitting.outcome, target), sitting.outcome === 'failure' || sitting.outcome === 'major_failure' ? 'loss' : 'proof');
    // The ledger is the person's own record, so it holds the key. Only what the screen showed goes to any door.
    await Ledger.append('TECH', {
      kind: 'STUDY', target: StudySystem.keyOf(target), name: target.name, outcome: sitting.outcome,
      energy: cost, hubId: useHubStore.getState().activeHubId, sitting: sitting.id,
      ...(sitting.outcome === 'major_failure' && piece ? { consumedIds: [piece.id] } : {})
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
