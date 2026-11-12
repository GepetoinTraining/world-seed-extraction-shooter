/**
 * DOWNTIME: THE ACTS (the design pass, part 5b). What a stack hands `Downtime.walk`: each act is the hand's own, through
 * the same functions a hand goes through, so it costs and gives exactly what it does by hand. A sitting asks what study asks
 * and lands through the one landing (StudyLanding); writing out is LorePiece's; a rest is the rest's own settle, lying down
 * and waking, and the night at the inn costs what the inn charges. Their words are the ones a hand reads. Pure.
 */

import { IHubWeb, IPlayer, IStudyTarget } from '../../../shared/types';
import { Downtime, DowntimePlace, IDowntimeAccount, IDowntimeAct, IDowntimeRules } from '../../../shared/logic/systems/Downtime';
import { IHubTree, WebSystem } from '../../../shared/logic/systems/WebSystem';
import { RESOURCE_DEFINITIONS } from '../../../shared/entities/item/data/resourceDefinitions';
import { CRAFTED_DEFINITIONS } from '../../../shared/entities/economy/data/recipeDefinitions';
import { StudySystem } from './StudySystem';
import { StudyLanding } from './StudyLanding';
import { LorePiece } from './LorePiece';
import { INN_FEE, RestSystem } from './RestSystem';
import { WebMap } from './WebMap';
import type { IHubTech } from '../../entities/hub/hubTech';
import { hubTreeOf } from '../../entities/hub/hubTech';
import { SkillNames } from './SkillNames';

export interface IActsContext {
  place: DowntimePlace;
  hub?: IHubTree;
  /** Who writes a piece out: the character, as the writing door names them. */
  who: (player: IPlayer) => { uid: string; name: string };
  /** What a target's workstation would refuse at home, as the study door asks it. Absent: nothing asks one. */
  stationMissing?: (target: IStudyTarget, player: IPlayer) => string | null;
}

const minutes = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** The target as it stands now: a piece held is read again, since a stack may have read or spent it. Null when it is gone. */
const current = (player: IPlayer, target: IStudyTarget): IStudyTarget | null => {
  if (target.kind !== 'item') return target;
  const held = StudySystem.heldItem(player, target.ref);
  return held ? StudySystem.targetOfItem(held) : null;
};

export const DowntimeActs = {
  rules(ctx: IActsContext): IDowntimeRules {
    return {
      ask(player, act, at) {
        switch (act.kind) {
          case 'STUDY': {
            const target = current(player, act.target);
            if (!target) return { ok: false, reason: `${act.target.name} is not in your vault any more.` };
            const missing = ctx.stationMissing?.(target, player);
            if (missing) return { ok: false, reason: missing };
            const verdict = StudySystem.canStudy(player, target, at, ctx.hub);
            if (!verdict.ok) return { ok: false, reason: verdict.reason ?? 'It will not sit for you.' };
            return { ok: true, ms: StudySystem.studyAsk(player, target, ctx.hub).seconds * 1000 };
          }
          case 'WRITE': {
            const verdict = LorePiece.canWrite(player, act.skillId, ctx.hub, at);
            if (!verdict.ok) return { ok: false, reason: verdict.reason ?? 'It cannot be written out.' };
            return { ok: true, ms: LorePiece.ask(player, LorePiece.heldSkill(player, act.skillId)!, ctx.hub).seconds * 1000 };
          }
          case 'REST': {
            const verdict = RestSystem.canRest(player, ctx.place, at);
            if (!verdict.ok) return { ok: false, reason: verdict.reason ?? 'You cannot rest here.' };
            return { ok: true, ms: RestSystem.restMs(player) };
          }
        }
      },

      take(player, act, start, end) {
        switch (act.kind) {
          case 'STUDY': {
            const target = current(player, act.target)!;
            const { cost, seconds } = StudySystem.studyAsk(player, target, ctx.hub);
            const landed = StudyLanding.land(StudySystem.pay(player, cost), target, cost, end, ctx.hub)!;
            const said = [
              `You sat with ${target.name} (${cost} energy, ${seconds}s). ${StudySystem.saidOf(landed.sitting.outcome, target)}`,
              landed.spent ? `${target.name} has given what it held. It is spent.` : '',
              landed.unread ? 'You could not make out what it is. Your eye for this kind of thing is learning.' : ''
            ].filter(Boolean).join(' ');
            return { player: StudyLanding.eyeGrown(landed.player, landed.eye), said };
          }
          case 'WRITE': {
            const out = LorePiece.write(player, act.skillId, ctx.who(player), end, ctx.hub);
            return { player: out.player, said: `You wrote out ${SkillNames.nameOf(act.skillId)} on a sheet of paper (${out.cost} energy). ${out.item.name} is in your vault; your hands still know it.` };
          }
          case 'REST': {
            const paid = ctx.place === 'INN' ? { ...player, bank: { ...player.bank, gold: player.bank.gold - INN_FEE } } : player;
            const settled = RestSystem.settle(paid, ctx.hub);
            const woke = RestSystem.wake(RestSystem.beginRest(settled.player, ctx.place, start));
            const where = ctx.place === 'INN' ? `at the inn (${INN_FEE} G)` : 'in your own bed';
            return { player: woke, said: [`You rested ${minutes(end - start)} ${where}, and woke rested.`, ...RestSystem.settledWords(settled.emerged, settled.wanting)].join(' ') };
          }
        }
      }
    };
  },

  /** An act, as a stack says it. */
  wordOf(act: IDowntimeAct): string {
    switch (act.kind) {
      case 'STUDY': return `sitting with ${act.target.name}`;
      case 'WRITE': return `writing out ${SkillNames.nameOf(act.skillId)}`;
      case 'REST': return 'a rest';
    }
  },

  /** The return, in plain words: what was done, what stopped and why, what is still stacked. */
  words(account: IDowntimeAccount, left: IDowntimeAct[]): string[] {
    return [
      ...account.done.map(d => d.said),
      ...(account.stopped ? [`It stopped at ${this.wordOf(account.stopped.act)}: ${account.stopped.reason}`] : []),
      left.length > 0 ? `Still stacked: ${left.map(a => this.wordOf(a)).join(', ')}.` : 'Nothing is left stacked.'
    ];
  },

  /**
   * "Work toward this": the studies on the way to the marked goal, in order, as far as the energy a rest gives back reaches and no more
   * than focus holds. A study on the way is a sitting with a thing the person knows that a skill on the way works; each such
   * skill takes its turn, again and again, so the lore of each category on the way grows together.
   */
  fromGoal(player: IPlayer, ctx: { web: IHubWeb; tech?: IHubTech }): IDowntimeAct[] {
    if (!player.webGoal) return [];
    const map = WebMap.of(player, { web: ctx.web, tech: ctx.tech });
    const plan = WebMap.pathTo(player, { web: ctx.web, tech: ctx.tech }, player.webGoal.ref);
    const hub = ctx.tech ? hubTreeOf(ctx.tech) : undefined;
    const byId = new Map(map.nodes.map(n => [n.id, n]));
    const rounds: IStudyTarget[][] = plan.steps.filter(s => s.kind === 'skill').map(step => map.edges
      .filter(e => e.to === step.id && e.why === 'works')
      .map(e => byId.get(e.from))
      .filter((n): n is NonNullable<typeof n> => !!n && n.state === 'yours')
      .map(n => {
        const def = RESOURCE_DEFINITIONS[n.ref] ?? CRAFTED_DEFINITIONS[n.ref];
        return StudySystem.targetOfThing({ id: n.ref, name: n.name ?? n.ref, tags: def?.tags ?? [], rank: def?.rank });
      }))
      .filter(list => list.length > 0);
    if (rounds.length === 0) return [];
    const holds = Downtime.capacity(player.attributes);
    // A stack begins after the rest it is laid with, so it reaches as far as the energy that rest gives back
    let energy = StudySystem.energyLeft(RestSystem.wake(player));
    const acts: IDowntimeAct[] = [];
    for (let i = 0; acts.length < holds; i++) {
      const target = rounds[i % rounds.length][Math.floor(i / rounds.length) % rounds[i % rounds.length].length];
      const cost = StudySystem.studyAsk(player, target, hub).cost;
      if (cost > energy) break;
      energy -= cost;
      acts.push({ kind: 'STUDY', target });
    }
    return acts;
  }
};
