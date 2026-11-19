/**
 * WHAT AN ANIMAL IS FOR, READ (AH, 2026-11-18). Pedro, of pigeons that never fight and keep out of reach: "the pigeons,
 * before you have a way to trap them, they're useless, the animal husbandry portion needs to be better defined thrtough
 * the right clieck inspect/study". So the animal is as it should be, and what was missing is the game saying, on the
 * card and through study, that it is for taking alive and what that takes.
 *
 * Capture is four ways (D120, Pedro: "All four: hunt, trap, tame, domesticate"), and all four are built: the fight, a
 * snare (`Capture.trap`), a hand on what is caged (`Capture.tame`), and days of feed on a farm plot at home (`Herd`).
 * This file invents none of it. It reads those laws for one body and one person and says, for each way, whether it is
 * open now, what is missing, and what it takes; the card (`inspectEntity`) only prints the answer.
 *
 * Which bodies: one whose nature does not come for a person (`Capture.mild`, the natures the snare's own law reads as
 * readier). No list of kinds, and no tag a world must remember to write.
 *
 * Who reads what (Pedro, 2026-11-10: "a player only knows WHAT they study or interact with"; 2026-11-12: "description
 * opens only if the skill to describe it is found"):
 *   - anyone sees how it behaves, by watching;
 *   - a way's row opens once the kind is known (a sitting that landed, or one of them taken), or for someone holding
 *     the trade that way practises, on any kind;
 *   - the kind known deeply (2) adds the figures: minutes beside a hand, fed days, cuts of meat.
 * What is known of a kind is kept on the person's own mark for it (`IStudyMark.known`), where its sittings already are.
 *
 * Pure: a body, its definition and a person in, words out. Nothing here rolls, spends or reads a clock.
 */

import { IPlayer, ISkillState } from '../../../shared/types';
import { bodyLawOf } from '../../../shared/entities/mob/BodyLaw';
import { IWorldEntity } from '../../../shared/entities/world/types';
import { Capture, CatchTrade } from '../../../shared/logic/systems/Capture';
import { ExtractLaw } from '../../../shared/logic/systems/ExtractLaw';
import { WebSystem } from '../../../shared/logic/systems/WebSystem';
import { Herd } from '../../entities/hub/herd';
import { StudySystem } from './StudySystem';

export type CatchWay = 'hunt' | CatchTrade;
/** Open now, open once something is had, or never for this body. */
export type CatchStanding = 'yes' | 'not_yet' | 'never';

export interface ICatchWay {
  way: CatchWay;
  /** The row's word on the card. */
  word: string;
  /** Whether this person can read the row at all. Closed, the card shows question marks. */
  open: boolean;
  standing: CatchStanding;
  /** What is not had, when it is not open yet. */
  missing?: string;
  /** What the way takes, and what comes of it. */
  takes: string;
}

export interface ICatchReading {
  /** How it behaves, as anyone watching sees. */
  manner: string;
  /** How well this person knows the kind: 0 not at all, 1 what it is for, 2 its figures. */
  known: number;
  ways: ICatchWay[];
  /** What a living one is good for. Null until the kind is known. */
  alive: string | null;
  /** What the snare is missing right now, in the card's own grammar of needs. Absent when nothing can be said or nothing is missing. */
  need?: string;
}

/** Whoever is looking: how far off they stand, and whether a farm plot at home is theirs (absent: not known here). */
export interface ICatchReader { player: IPlayer; dist: number; ownsPlot?: boolean }

type Def = { tags?: string[]; behavior?: unknown; rank?: unknown; size?: unknown; speed?: unknown; baseHealth?: number; baseDamage?: number } | undefined;

/** The kind known for what it is for, and known for its figures. */
export const KIND_KNOWN = 1;
export const KIND_FIGURED = 2;

const WORDS: Record<CatchWay, string> = { hunt: 'Hunt', trap: 'Trap', tame: 'Tame', keep: 'Keep' };
const MANNER: Record<string, string> = {
  PASSIVE: 'Keeps to itself. Runs when hurt',
  NEUTRAL: 'Leaves you be. Fights back when hurt'
};
const counted = (n: number, one: string, many: string) => (n === 1 ? `one ${one}` : `${n} ${many}`);
const markOf = (defId: string) => ({ kind: 'creature' as const, ref: defId });

export const Husbandry = {
  /** Whether this body's card speaks of taking it alive: its nature does not come for a person. */
  isStock(def: Def): boolean {
    return Capture.mild(def?.behavior);
  },

  /** How a mild body behaves, in words. Empty for one that is not. */
  manner(def: Def): string {
    return MANNER[String(def?.behavior)] ?? '';
  },

  /**
   * How well this person knows a kind of creature. Their mark for it, or the older record the field's analysis wrote
   * (`MaterialScience`), whichever stands higher.
   */
  known(player: Pick<IPlayer, 'studyMarks' | 'materialMastery'> | undefined, defId: string): number {
    if (!player) return 0;
    return Math.max(StudySystem.markOf(player as IPlayer, markOf(defId)).known ?? 0, player.materialMastery?.[defId]?.knowledgeLevel ?? 0);
  },

  /** The kind is known this well from here on. The same person back when it already was. */
  learn(player: IPlayer, defId: string, level: number): IPlayer {
    if (this.known(player, defId) >= level) return player;
    const key = StudySystem.keyOf(markOf(defId));
    return { ...player, studyMarks: { ...player.studyMarks, [key]: { ...StudySystem.markOf(player, markOf(defId)), known: level } } };
  },

  /** What a sitting that landed leaves known: what it is for, then, on a kind already known or a sitting that went deep, its figures. */
  levelAfter(before: number, deep: boolean): number {
    return Math.max(before, deep || before >= KIND_KNOWN ? KIND_FIGURED : KIND_KNOWN);
  },

  /** What is said at once when a sitting opens something on a mild body's card. Null when nothing new opened, or it is no such body. */
  learnedSaid(name: string, def: Def, before: number, after: number): string | null {
    if (!this.isStock(def) || after <= before) return null;
    return before < KIND_KNOWN
      ? `${name} is worth more alive than dead.${after >= KIND_FIGURED ? ' You know what taking and keeping one asks, to the day.' : ''}`
      : `${name}: you know now what taking and keeping one asks, to the day.`;
  },

  /** The trade a way practises, as this person holds it. Undefined when it is not held. */
  tradeOf(player: IPlayer, way: CatchTrade): ISkillState | undefined {
    const id = WebSystem.mint(Capture.tradeOf(way), []).id;
    return WebSystem.heldSkills(player.bank?.universalSkills ?? {}).find(s => s.id === id);
  },

  /** The four ways for this body and this person. Null for a body whose card does not speak of taking it alive. */
  read(e: Pick<IWorldEntity, 'id' | 'definitionId' | 'rank' | 'health' | 'bonusHealth' | 'law'>, def: Def, who: ICatchReader): ICatchReading | null {
    if (!def || !this.isStock(def)) return null;
    const known = this.known(who.player, e.definitionId);
    const figured = known >= KIND_FIGURED;
    const kindKnown = known >= KIND_KNOWN;
    const skill = (way: CatchTrade) => this.tradeOf(who.player, way);
    const opens = (way: CatchTrade) => kindKnown || !!skill(way);

    const hunt: ICatchWay = {
      way: 'hunt', word: WORDS.hunt, open: kindKnown, standing: 'yes',
      takes: `${String(def.behavior) === 'PASSIVE' ? 'It runs when hurt' : 'It fights back'}. Dead, it leaves what its kind leaves, once`
    };

    // The snare, as the field sets it (`FieldCapture.snare`): the body's rank, how worn it is, and the hand's trapping
    const carried = [...(who.player.currentSession?.inventory ?? []), ...(who.player.equipment?.items ?? [])].some(i => i.tags?.includes('snare'));
    const refusal = Capture.trapRefusal(e.id, def);
    const max = bodyLawOf(def as never, e).baseHealth + (e.bonusHealth ?? 0);
    const holds = ExtractLaw.oddsSaid(100 * Capture.trapOdds({
      rank: e.rank, behavior: def.behavior as string, healthShare: (e.health ?? max) / Math.max(1, max), skill: skill('trap')?.level ?? 0
    }));
    const snared = `It holds ${holds}${figured ? ', and more surely the more hurt it is. A miss goes unnoticed' : ''}`;
    const inReach = who.dist < Capture.REACH_TILES;
    const trap: ICatchWay = refusal
      ? { way: 'trap', word: WORDS.trap, open: opens('trap'), standing: 'never', takes: refusal.replace(/\.$/, '') }
      : !carried
        ? { way: 'trap', word: WORDS.trap, open: opens('trap'), standing: 'not_yet', missing: 'no snare carried',
            takes: `One is tied at a farm plot at home, from ${counted(Capture.snareParts(), 'fibrous thing', 'fibrous things')}, and is spent when set. ${snared}` }
        : !inReach
          ? { way: 'trap', word: WORDS.trap, open: opens('trap'), standing: 'not_yet', missing: 'out of reach', takes: `Stand beside it and right click. ${snared}` }
          : { way: 'trap', word: WORDS.trap, open: opens('trap'), standing: 'yes', takes: `Right click sets the snare, and it is spent either way. ${snared}` };

    // A hand on what is caged (`FieldCapture.tame`): the kind's own rank, and the hand's taming
    const tamer = skill('tame')?.level ?? 0;
    const won = ExtractLaw.oddsSaid(100 * Capture.tameOdds({ rank: def.rank as string, behavior: def.behavior as string, skill: tamer }));
    const beside = figured ? `for ${counted(Math.round(Capture.followMs(tamer) / 60_000), 'minute', 'minutes')}` : 'for a while';
    const tame: ICatchWay = {
      way: 'tame', word: WORDS.tame, open: opens('tame'), standing: 'not_yet', missing: 'not caged',
      takes: `Out of a cage, a hand wins it ${won}. Won, it walks beside you ${beside}, and out with you`
    };

    // Days of feed on a farm plot at home (`Herd`)
    const days = figured ? `${counted(Herd.daysToKeep(def), 'day', 'days')}` : 'for days';
    const keep: ICatchWay = {
      way: 'keep', word: WORDS.keep, open: opens('keep'), standing: 'not_yet', missing: who.ownsPlot === false ? 'no farm plot of yours' : 'not caged',
      takes: `Penned on a farm plot at home and fed ${days}, it settles, and breeds while there is plenty. It eats food, or anything that grows`
    };

    const alive = !kindKnown ? null
      : figured ? `Worth more kept than dead: young while fed, and a head gives ${counted(Herd.cutsOf(def), 'cut', 'cuts')} of meat and what its kind leaves`
      : 'Worth more kept than dead: young while fed, meat, and what its kind leaves';
    const need = !trap.open || trap.standing !== 'not_yet' ? undefined : carried ? 'Move closer' : 'Needs a snare';
    return { manner: this.manner(def), known, ways: [hunt, trap, tame, keep], alive, ...(need ? { need } : {}) };
  },

  /** A way's row as the card prints it: question marks when closed; else whether it is open, what is missing, and what it takes. */
  said(way: ICatchWay): string {
    if (!way.open) return '???';
    if (way.standing === 'yes') return `Yes. ${way.takes}`;
    if (way.standing === 'never') return `No. ${way.takes}`;
    return `Not yet: ${way.missing}. ${way.takes}`;
  }
};
