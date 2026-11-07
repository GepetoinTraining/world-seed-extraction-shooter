/**
 * WHAT A DEED LEAVES BEHIND: the slots code fills when something happens, the same on every
 * machine. A model writes only slot words in a talk (`remember`), never numbers or weights; every
 * other memory is written here from what the code already knows.
 *
 * People are slotted by entity id, never by name. A day is written as words, so it can fade.
 */

import { IRememberWords } from '../../../shared/logic/systems/TalkTypes';
import { LADDER } from '../systems/NpcAgenda';
import { IRemembering, LadderWeight } from './MemoryLaw';
import { IKoseki } from '../../../shared/entities/world/Koseki';

const person = (id: string) => ({ person: id });
export const dayWords = (day: number) => `day ${day}`;

/** Harm taken, or being caught, puts the body at risk: the bottom rung, whoever it is. */
const BODY = LadderWeight.ofRung(LADDER.findIndex(r => r.need === 'survival'));

export const Deeds = {
  /**
   * A round of talk, as the listener keeps it. What the model said they will remember goes in;
   * on the floor, or where it left a slot empty, the words said and how it landed stand in.
   */
  talkRound(o: { day: number; speaker: string; listener: string; said: string; landed: boolean; remember?: IRememberWords; where?: string }): IRemembering {
    const r = o.remember;
    return {
      day: o.day,
      slots: {
        who: person(o.speaker), did: r?.did || 'said', what: r?.what || o.said, toWhom: person(o.listener),
        when: dayWords(o.day), ...(o.where ? { where: o.where } : {}),
        how: r?.how || (o.landed ? 'and it sat well' : 'and it did not sit well'), ...(r?.why ? { why: r.why } : {})
      }
    };
  },

  /** Something given inside a talk. A gain, so it weighs nothing extra. */
  gift(o: { day: number; giver: string; taker: string; item: string }): IRemembering {
    return { day: o.day, slots: { who: person(o.giver), did: 'gave', what: o.item, toWhom: person(o.taker), when: dayWords(o.day) } };
  },

  /** A want let slip, kept by the one who let it slip: the ledger holds it. */
  secret(o: { day: number; owner: string; to: string; want: string }): IRemembering {
    return {
      day: o.day, ledger: { kind: 'secret', key: `secret_${o.owner}_${o.to}` },
      slots: { who: person(o.owner), did: 'let slip', what: o.want, toWhom: person(o.to), when: dayWords(o.day) }
    };
  },

  /** Harm taken. The ledger keeps it open, and repeats in one encounter are one entry. */
  hit(o: { day: number; by: string; owner: string }): IRemembering {
    return {
      day: o.day, fall: BODY, ledger: { kind: 'threat', key: `threat_${o.owner}_${o.by}` },
      slots: { who: person(o.by), did: 'hurt', toWhom: person(o.owner), when: dayWords(o.day) }
    };
  },

  /** Caught, or nearly. */
  caught(o: { day: number; by: string; owner: string; held: boolean }): IRemembering {
    return {
      day: o.day, fall: BODY, ledger: { kind: 'threat', key: `threat_${o.owner}_${o.by}` },
      slots: { who: person(o.by), did: o.held ? 'caught' : 'tried to catch', toWhom: person(o.owner), when: dayWords(o.day), how: 'in a snare' }
    };
  },

  /** A promise put up at the Hall: a quest. Open until it is brought. */
  promise(o: { day: number; owner: string; what: string; questId: string }): IRemembering {
    return {
      day: o.day, ledger: { kind: 'promise', key: o.questId },
      slots: { who: person(o.owner), did: 'asked at the hall for', what: o.what, when: dayWords(o.day), where: 'the hall' }
    };
  },

  /** A quest brought and paid for. What they paid can cost them a rung. */
  brought(o: { day: number; by: string; owner: string; what: string; fall: number }): IRemembering {
    return { day: o.day, fall: o.fall, slots: { who: person(o.by), did: 'brought', what: o.what, toWhom: person(o.owner), when: dayWords(o.day), how: 'and was paid for it' } };
  },

  /** A day's food, walked to and bought. Both remember it; on a day they could not pay, it weighs on the one unfed. */
  fed(o: { day: number; buyer: string; seller: string; paid: boolean }): IRemembering {
    return {
      day: o.day,
      slots: { who: person(o.buyer), did: o.paid ? 'bought food from' : 'could not pay for food from', toWhom: person(o.seller), when: dayWords(o.day) }
    };
  },

  /** Taken on at a bench. */
  apprenticed(o: { day: number; master: string; apprentice: string }): IRemembering {
    return { day: o.day, slots: { who: person(o.master), did: 'took on as an apprentice', toWhom: person(o.apprentice), when: dayWords(o.day), where: 'the bench' } };
  },

  /** A step up the road, under a master. */
  rose(o: { day: number; master: string; craftsman: string; to: string }): IRemembering {
    return { day: o.day, slots: { who: person(o.craftsman), did: `became a ${o.to.toLowerCase()} under`, toWhom: person(o.master), when: dayWords(o.day), where: 'the bench' } };
  },

  /** Finished at one bench and gone on to the next. */
  movedOn(o: { day: number; from: string; craftsman: string }): IRemembering {
    return { day: o.day, slots: { who: person(o.craftsman), did: 'finished at the bench of', toWhom: person(o.from), when: dayWords(o.day), where: 'the bench' } };
  },

  /** A master buying parts off a keeper's floor. */
  boughtParts(o: { day: number; buyer: string; seller: string }): IRemembering {
    return { day: o.day, slots: { who: person(o.buyer), did: 'bought parts from', toWhom: person(o.seller), when: dayWords(o.day) } };
  },

  /**
   * Every succession a register records: a body that fell, and a child of it entered the same
   * cycle. Read from the koseki, so whoever writes a line's memories can find who followed whom
   * without the fold that made it saying so. The register keeps cycles, not days: `at` is a cycle.
   */
  successionsIn(register: IKoseki): { heir: string; fallen: string; at: number }[] {
    const fell = register.entries.filter(e => e.exit === 'fell' && e.exitedAt !== undefined);
    return register.entries.flatMap(e => fell
      .filter(f => e.parents.includes(f.body) && e.enteredAt === f.exitedAt)
      .map(f => ({ heir: e.body, fallen: f.body, at: e.enteredAt })));
  },

  /**
   * Two people met and talked (MeetLaw): each keeps the other as who, themselves as to whom, and
   * the words the model gave their side. Where it gave none, what brought them stands in.
   */
  met(o: { day: number; owner: string; other: string; where: string; why: string; remember?: IRememberWords; fall?: number }): IRemembering {
    const r = o.remember;
    return {
      day: o.day, ...(o.fall ? { fall: o.fall } : {}),
      slots: {
        who: person(o.other), did: r?.did || 'talked with', what: r?.what || o.why, toWhom: person(o.owner),
        when: dayWords(o.day), where: o.where, ...(r?.how ? { how: r.how } : {}), ...(r?.why ? { why: r.why } : {})
      }
    };
  },

  /** A line's head fell and another took its place: the one who follows remembers the one before. */
  succeeded(o: { day: number; heir: string; fallen: string }): IRemembering {
    return { day: o.day, slots: { who: person(o.heir), did: 'took the place of', toWhom: person(o.fallen), when: dayWords(o.day) } };
  }
};
