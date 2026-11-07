import { GoldCommit } from './GoldCommit';
import type { IPlayerPort } from '../../entities/player/playerView';
import { IAttributes, ISkillState } from '../../../shared/types';
import { ProgressionSystem } from '../../../shared/entities/player/systems/ProgressionSystem';
import { Rng } from '../../../shared/logic/rng/DeterministicRNG';
import { StatSystem } from '../../../shared/logic/systems/StatSystem';
import { WebSystem } from '../../../shared/logic/systems/WebSystem';
import { TAX_EVASION_TAGS } from '../../entities/hub/guild';

/** D100: one try at the gate. A failure pays in full and costs nothing more. */
export interface ILevyAttempt {
  attempted: boolean;
  dodged: boolean;
  /** What the world asks, and what this person's numbers gave them against it. */
  rateAsked: number;
  odds: number;
  ratePaid: number;
  /** What the world asked in gold, and what is owed after the roll. */
  full: number;
  owed: number;
}

export class ExitLevy {

  /**
   * D100: "roll, we keep it, it doesn't work 100% of the time". Keyed by who, where and which
   * session, so it reads the same on every machine and a replay cannot try again. Pure.
   */
  static assess(o: { playerId: string; worldUid: string; sessionId: string; haulValue: number; rateAsked: number; attributes?: IAttributes; skill?: Pick<ISkillState, 'level'> }): ILevyAttempt {
    const full = Math.floor(o.haulValue * o.rateAsked);
    const odds = StatSystem.levyDodgeOdds(o.attributes, o.skill);
    if (full <= 0) return { attempted: false, dodged: false, rateAsked: o.rateAsked, odds, ratePaid: o.rateAsked, full, owed: 0 };
    const dodged = Rng.fromKey(`levy:${o.playerId}:${o.worldUid}:${o.sessionId}`).next() < odds;
    return { attempted: true, dodged, rateAsked: o.rateAsked, odds, ratePaid: dodged ? 0 : o.rateAsked, full, owed: dodged ? 0 : full };
  }

  /** Every attempt is practice, landed or not, and it goes through the web like any other work. */
  static practise(attempt: ILevyAttempt, rank: number, pc: IPlayerPort): void {
    if (!attempt.attempted) return;
    const pair = WebSystem.mint(TAX_EVASION_TAGS, []);
    pc.apply({ kind: 'WORK_ON', pair, rank, xp: Math.max(1, Math.ceil(attempt.full * 0.5)) });
  }

  /** This person, at this gate, now. */
  static attemptNow(worldUid: string, sessionId: string, haulValue: number, rateAsked: number, pc: IPlayerPort): ILevyAttempt {
    const { player } = pc.view();
    const skill = player.bank.universalSkills[WebSystem.mint(TAX_EVASION_TAGS, []).id];
    const attempt = this.assess({ playerId: player.id, worldUid, sessionId, haulValue, rateAsked, attributes: player.attributes, skill });
    // The skill stands at the rank of who is doing it, not of what they happened to carry.
    this.practise(attempt, ProgressionSystem.rankIndex(ProgressionSystem.rankOf(player)), pc);
    return attempt;
  }

  /**
   * Charges the world's fee on a completed session. Returns the gold actually taken.
   * With an attempt, the row says what was asked and what the rate paid came to, dodged or not.
   */
  static async charge(pc: IPlayerPort, worldUid: string, haulValue: number, rate: number, attempt?: ILevyAttempt): Promise<number> {
    const owed = Math.floor(haulValue * rate);
    const charged = Math.min(owed, pc.view().player.bank.gold);
    const said = attempt?.attempted ? { rateAsked: attempt.rateAsked, dodged: attempt.dodged, odds: attempt.odds } : {};
    if (charged <= 0 && !attempt?.attempted) return 0;

    pc.apply({ kind: 'GOLD', delta: -charged });
    await GoldCommit.commit({
      player: pc.view().player,
      rows: [{ type: 'TAX', data: { worldCertUid: worldUid, haulValue, rate, owed, tax: charged, ...said } }],
      treasury: { worldUid, delta: charged }
    });
    return charged;
  }
}
