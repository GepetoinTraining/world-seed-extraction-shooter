/**
 * A PERSON'S MEMORY: what someone remembers, slot by slot, and how each slot fades.
 *
 * The law is the one in `D:\-ttrpg-engine\engine\memory-topology.ts`, ported (worlds share no
 * code): strength falls by a φ-life, gravity stretches the φ-life, below the noise floor a piece
 * dies, and a dying piece's strength splits by the identity φ⁻¹ + φ⁻² = 1, flow to its neighbours
 * and tax to the loss vector. The ledger never fades.
 *
 *   φ⁻² ≈ 0.382   the noise floor, the tax on a death, and what one rehearsal adds to gravity
 *   φ⁻¹ ≈ 0.618   the share of a dying slot that flows on, and the share of the mass recall sends
 *   φ   ≈ 1.618   (the donor's promotion bar: unused here, since the ledger is written on purpose)
 *   φ²  ≈ 2.618   the gravity cap, and the weight of a fall to the bottom rung
 *
 * What is ours (Pedro, 2026-11-06): a memory is a set of role slots (who, did, what, to whom, when,
 * where, how, why), each pointing at an atom in the world's book (AtomBook.ts), and each slot fades
 * on its own. A slot's gravity comes from how often its atoms recur in this person's own memories,
 * so the dedup turns repetition into rehearsal: a name met every day stays, and a one-off "how"
 * goes first. A forgotten slot reads as "?", as a sheet does without the skill to see it.
 *
 * "people don't forget debts... things that would place them downwards needs to be remembered more
 * strongly". So a memory weighs what the event would cost them on the needs ladder (NpcAgenda's
 * LADDER), read from their agenda that day: the lower the rung it leaves unmet, the heavier.
 *
 * Pure, as NpcAgenda is: a fold over days, nothing rolled, no model. Every number is a guess until
 * the tuning pass (Wave 12).
 */

import { ILadderFacts, INpcAgenda, LADDER, NpcAgenda } from '../systems/NpcAgenda';
import { AtomBook, IAtomBook } from './AtomBook';
import { sha256Hex } from '../ledger/sha256';

// ============================================================
// THE φ LADDER
// ============================================================

export const PHI = (1 + Math.sqrt(5)) / 2;
/** φ⁻¹: what flows on when a slot dies, and the share of the remembered mass recall sends. */
export const PHI_FLOW = 1 / PHI;
/** φ⁻²: the noise floor, the tax on a death, and one rehearsal's gravity. */
export const PHI_FLOOR = 1 / (PHI * PHI);
/** φ²: the most gravity a slot can carry. */
export const PHI_CAP = PHI * PHI;
/** Pedro: "Yup, 90 days is good." One φ-life untouched leaves ×φ⁻¹; two leave the floor. */
export const BASE_PHI_LIFE_DAYS = 90;

// ============================================================
// SHAPES
// ============================================================

export const ROLES = ['who', 'did', 'what', 'toWhom', 'when', 'where', 'how', 'why'] as const;
export type Role = typeof ROLES[number];

/**
 * The slots that carry a fall: who did what to whom. When, where and how still fade at their own
 * pace. My call; Pedro may overrule.
 */
export const FALL_ROLES: readonly Role[] = ['who', 'did', 'what', 'toWhom'];

/** What the ledger keeps: promises (quests), debts (gold), threats (harm taken), secrets (a want let slip). */
export type LedgerKind = 'promise' | 'debt' | 'threat' | 'secret';

export interface ISlot {
  /** The atom it points at: a clause, a word or a person. */
  atom: string;
  /** What can recur: the atom, and the runs and people inside it. */
  keys: string[];
  /** Vividness, as of `at`. */
  strength: number;
  /** The day `strength` was read at: decay runs from here. */
  at: number;
  /** Mass: stretches the φ-life by φ^gravity. */
  gravity: number;
}

export interface ILedgerMark {
  kind: LedgerKind;
  /** What settles it: a quest id, a debt's id. */
  key: string;
  open: boolean;
  settledAt?: number;
}

export interface IMemory {
  id: string;
  /** The day it formed. */
  day: number;
  /** Each role it holds. A slot that has died is null, and reads as "?". */
  slots: Partial<Record<Role, ISlot | null>>;
  /** The gravity its fall gave the slots that carry it, kept so a settled ledger entry fades at its rung's pace. */
  fall: number;
  ledger?: ILedgerMark;
}

export interface IMind {
  /** Whose memory this is. */
  owner: string;
  /** The day it was last folded to. */
  day: number;
  memories: IMemory[];
  /** One entry per fold that lost anything: the strength taxed away. Forgetting is counted, never silent. */
  loss: number[];
}

/** What is remembered, before it is written: slot words, people by id, and what it cost. */
export interface IRemembering {
  day: number;
  /** A person slot is `{ person: entityId }`; anything else is words. An empty string is left out. */
  slots: Partial<Record<Role, string | { person: string }>>;
  /** How far down the ladder it would leave them: `LadderWeight.of`. Absent is no fall. */
  fall?: number;
  ledger?: { kind: LedgerKind; key: string };
}

export const freshMind = (owner: string, day: number): IMind => ({ owner, day, memories: [], loss: [] });

// ============================================================
// THE NEEDS LADDER, TURNED OVER
// ============================================================

export const LadderWeight = {
  /**
   * The gravity of a rung left unmet. The ladder's own order gives it: the bottom rung (fed) weighs
   * φ², and each rung up weighs a rung's share less. A guess until the tuning pass.
   */
  ofRung(index: number): number {
    const rungs = LADDER.length;
    const depth = (rungs - Math.max(0, Math.min(rungs - 1, index))) / rungs;
    return depth * PHI_CAP;
  },

  /** Where a person stands on the ladder: the index of the first rung not met. */
  standing(agenda: INpcAgenda, facts: ILadderFacts = {}): number {
    const rung = NpcAgenda.rung(agenda, facts);
    return LADDER.indexOf(rung);
  },

  /**
   * What an event weighs, from where it leaves them. A loss weighs the rung they stand on after it:
   * the same 3 gold that leaves a rich vendor at the top is light, and the 3 gold that leaves someone
   * unfed is as heavy as anything gets. A gain adds nothing, so a loss always weighs more. My call;
   * Pedro may overrule.
   */
  of(o: { loss: boolean; after: { agenda: INpcAgenda; facts?: ILadderFacts } }): number {
    if (!o.loss) return 0;
    return this.ofRung(this.standing(o.after.agenda, o.after.facts));
  }
};

// ============================================================
// THE LAW
// ============================================================

const phiDecay = (strength: number, days: number, phiLife: number) =>
  days <= 0 || phiLife <= 0 ? strength : strength * Math.pow(PHI, -days / phiLife);

const phiLifeOf = (gravity: number) => BASE_PHI_LIFE_DAYS * Math.pow(PHI, gravity);

const living = (slot: ISlot | null | undefined): slot is ISlot => !!slot;

const shares = (a: ISlot, b: ISlot) => a.keys.some(k => b.keys.includes(k));

const memoryId = (owner: string, day: number, slots: Partial<Record<Role, string>>, ledgerKey = '') =>
  `m${sha256Hex(`${owner}|${day}|${ROLES.map(r => slots[r] ?? '').join('|')}|${ledgerKey}`).slice(0, 16)}`;

/** Two memories are the same happening when every slot but the day matches. */
const sameHappening = (m: IMemory, atoms: Partial<Record<Role, string>>) =>
  ROLES.every(r => r === 'when' || (m.slots[r]?.atom ?? undefined) === atoms[r]) &&
  ROLES.every(r => r === 'when' || (atoms[r] === undefined) === (m.slots[r] === undefined || m.slots[r] === null));

/** An open entry in the ledger does not fade. */
const holds = (m: IMemory) => !!m.ledger?.open;

export const MemoryLaw = {
  /**
   * Each day up to today, in turn: every slot fades by a day of its φ-life, and what falls under the
   * floor dies. Done a day at a time, so a mind nobody read catches up to the same place a watched
   * one reached.
   */
  fold(mind: IMind, today: number): IMind {
    if (today <= mind.day) return mind;
    let memories = mind.memories;
    const loss = [...mind.loss];
    for (let d = mind.day + 1; d <= today; d++) {
      memories = memories.map(m => holds(m) ? m : {
        ...m,
        slots: Object.fromEntries((Object.entries(m.slots) as [Role, ISlot | null][]).map(([role, slot]) => [role, living(slot)
          ? { ...slot, strength: phiDecay(slot.strength, d - slot.at, phiLifeOf(slot.gravity)), at: d }
          : slot])) as IMemory['slots']
      });
      const pruned = this.prune(memories);
      memories = pruned.memories;
      if (pruned.taxed > 0) loss.push(pruned.taxed);
    }
    // An open ledger entry's clock waits with it, so it starts to fade from the day it is settled
    memories = memories.map(m => !holds(m) ? m : {
      ...m, slots: Object.fromEntries((Object.entries(m.slots) as [Role, ISlot | null][]).map(([role, slot]) => [role, living(slot) ? { ...slot, at: today } : slot])) as IMemory['slots']
    });
    return { ...mind, day: today, memories, loss };
  },

  /**
   * Slots under the floor die. φ⁻¹ of what is left of each flows to the same atoms in this person's
   * other memories, split evenly, as gravity; φ⁻² is taxed. Flow with nowhere to go and gravity past
   * the cap join the tax. A memory with nothing left alive is gone.
   */
  prune(memories: IMemory[]): { memories: IMemory[]; taxed: number; flowed: number } {
    const dying: { m: number; role: Role; slot: ISlot }[] = [];
    memories.forEach((m, i) => {
      if (holds(m)) return;
      for (const role of ROLES) {
        const slot = m.slots[role];
        if (living(slot) && slot.strength < PHI_FLOOR) dying.push({ m: i, role, slot });
      }
    });
    if (dying.length === 0) return { memories, taxed: 0, flowed: 0 };

    const dead = new Set(dying.map(d => `${d.m}:${d.role}`));
    const gain = new Map<string, number>();
    let taxed = 0;
    let flowed = 0;
    for (const d of dying) {
      taxed += d.slot.strength * PHI_FLOOR;
      const flow = d.slot.strength * PHI_FLOW;
      const carriers: string[] = [];
      memories.forEach((m, i) => {
        if (i === d.m) return;
        for (const role of ROLES) {
          const slot = m.slots[role];
          if (living(slot) && !dead.has(`${i}:${role}`) && shares(slot, d.slot)) carriers.push(`${i}:${role}`);
        }
      });
      if (carriers.length === 0) { taxed += flow; continue; }
      for (const c of carriers) gain.set(c, (gain.get(c) ?? 0) + flow / carriers.length);
    }

    const next: IMemory[] = [];
    memories.forEach((m, i) => {
      const slots = { ...m.slots };
      for (const role of ROLES) {
        const slot = slots[role];
        if (!living(slot)) continue;
        if (dead.has(`${i}:${role}`)) { slots[role] = null; continue; }
        const g = gain.get(`${i}:${role}`);
        if (!g) continue;
        const lifted = slot.gravity + g;
        const capped = Math.min(lifted, PHI_CAP);
        taxed += lifted - capped;
        flowed += capped - slot.gravity;
        slots[role] = { ...slot, gravity: capped };
      }
      if (holds(m) || ROLES.some(r => living(slots[r]))) next.push({ ...m, slots });
    });
    return { memories: next, taxed, flowed };
  },

  /**
   * Write what happened into a mind, and its words into the book. A happening already remembered
   * (every slot the same but the day) is rehearsed instead of written twice. Every slot elsewhere in
   * this mind that holds the same atoms is rehearsed too: its clock starts again and it gains φ⁻² of
   * gravity. News of a day already folded past is written as of the mind's day.
   */
  remember(mind: IMind, book: IAtomBook, what: IRemembering): { mind: IMind; book: IAtomBook } {
    const day = Math.max(what.day, mind.day);
    let folded = this.fold(mind, day);
    let nextBook = book;
    const atoms: Partial<Record<Role, string>> = {};
    const keys: Partial<Record<Role, string[]>> = {};
    for (const role of ROLES) {
      const value = what.slots[role];
      if (value === undefined || value === '') continue;
      if (typeof value === 'string') {
        if (AtomBook.words(value).length === 0) continue;
        const written = AtomBook.write(nextBook, value);
        nextBook = written.book;
        atoms[role] = written.encoded.id;
      } else {
        const written = AtomBook.person(nextBook, value.person);
        nextBook = written.book;
        atoms[role] = written.id;
      }
      keys[role] = AtomBook.keysOf(nextBook, atoms[role]!);
    }

    const fall = Math.max(0, Math.min(PHI_CAP, what.fall ?? 0));
    // An open ledger entry under the same key is the same thing again: the same harm twice in one encounter
    const same = folded.memories.findIndex(m => what.ledger
      ? !!m.ledger?.open && m.ledger.key === what.ledger.key
      : !m.ledger && sameHappening(m, atoms));

    // Rehearsal: every living slot that shares an atom with what is written now
    const all = Object.values(keys).flat();
    let memories = folded.memories.map((m, i) => i === same ? m : {
      ...m,
      slots: Object.fromEntries((Object.entries(m.slots) as [Role, ISlot | null][]).map(([role, slot]) => [role, living(slot) && slot.keys.some(k => all.includes(k))
        ? { ...slot, at: day, gravity: Math.min(PHI_CAP, slot.gravity + PHI_FLOOR) }
        : slot])) as IMemory['slots']
    });

    if (same >= 0) {
      const m = memories[same];
      const slots = { ...m.slots };
      for (const role of ROLES) {
        const slot = slots[role];
        if (role === 'when' && atoms.when) {
          slots.when = { atom: atoms.when, keys: keys.when!, strength: 1, at: day, gravity: slot?.gravity ?? 0 };
          continue;
        }
        if (living(slot)) slots[role] = { ...slot, strength: 1, at: day, gravity: Math.min(PHI_CAP, Math.max(slot.gravity, FALL_ROLES.includes(role) ? fall : 0) + PHI_FLOOR) };
      }
      memories = memories.map((x, i) => i === same ? { ...m, slots, fall: Math.max(m.fall, fall) } : x);
      return { mind: { ...folded, memories }, book: nextBook };
    }

    // How often each atom already recurs here: one rehearsal's gravity for each slot that holds it
    const recurrence = (role: Role) => {
      let count = 0;
      for (const m of folded.memories) for (const r of ROLES) {
        const slot = m.slots[r];
        if (living(slot) && slot.keys.some(k => keys[role]!.includes(k))) count++;
      }
      return count * PHI_FLOOR;
    };
    const slots: IMemory['slots'] = {};
    for (const role of ROLES) {
      if (!atoms[role]) continue;
      const weight = FALL_ROLES.includes(role) ? fall : 0;
      slots[role] = { atom: atoms[role]!, keys: keys[role]!, strength: 1, at: day, gravity: Math.min(PHI_CAP, weight + recurrence(role)) };
    }
    const memory: IMemory = {
      id: memoryId(mind.owner, day, atoms, what.ledger?.key), day, slots, fall,
      ...(what.ledger ? { ledger: { kind: what.ledger.kind, key: what.ledger.key, open: true } } : {})
    };
    folded = { ...folded, memories: [...memories, memory] };
    return { mind: folded, book: nextBook };
  },

  /** A debt paid, a promise kept, a risk passed: the entry closes and starts to fade at its rung's pace. */
  settle(mind: IMind, key: string, day: number): IMind {
    const folded = this.fold(mind, day);
    if (!folded.memories.some(m => m.ledger?.open && m.ledger.key === key)) return folded;
    return {
      ...folded,
      memories: folded.memories.map(m => m.ledger?.open && m.ledger.key === key ? { ...m, ledger: { ...m.ledger, open: false, settledAt: day } } : m)
    };
  },

  /** How much one memory is held: each living slot's strength by (1 + gravity). */
  weight(m: IMemory): number {
    return ROLES.reduce((sum, r) => { const s = m.slots[r]; return living(s) ? sum + s.strength * (1 + s.gravity) : sum; }, 0);
  },

  /**
   * How heavily this person's memories weigh on another: every living slot that holds them, by its
   * strength and gravity. The koseki's people half reads this (who someone would court, who they
   * owe). Nothing remembered weighs 0.
   */
  regard(mind: IMind, otherEntityId: string, today: number): number {
    const folded = this.fold(mind, today);
    const atom = AtomBook.personId(otherEntityId);
    let sum = 0;
    for (const m of folded.memories) for (const r of ROLES) {
      const s = m.slots[r];
      if (living(s) && s.keys.includes(atom)) sum += s.strength * (1 + s.gravity);
    }
    return sum;
  },

  /**
   * What comes to mind, given what is in front of them (`about`: people's entity ids and words).
   * The strongest memories by strength × (1 + gravity), with relevance counted, until they hold φ⁻¹
   * of all this person remembers; then every open ledger entry the context touches. In the order
   * they happened. My call on the φ⁻¹ share; Pedro may overrule.
   */
  recall(mind: IMind, book: IAtomBook, today: number, about: { people?: string[]; words?: string[] } = {}): IMemory[] {
    const folded = this.fold(mind, today);
    const context = new Set<string>([
      ...(about.people ?? []).map(p => AtomBook.personId(p)),
      ...(about.words ?? []).flatMap(w => AtomBook.words(w)).map(w => AtomBook.wordId(w))
    ]);
    const touches = (m: IMemory) => ROLES.reduce((n, r) => {
      const s = m.slots[r];
      if (!living(s)) return n;
      const words = (book.runs[s.atom] ?? [s.atom]).flatMap(p => book.runs[p] ?? [p]);
      return n + (s.keys.some(k => context.has(k)) || words.some(w => context.has(w)) ? 1 : 0);
    }, 0);
    const scored = folded.memories.map(m => ({ m, score: (1 + touches(m)) * this.weight(m) }));
    const total = scored.reduce((sum, x) => sum + x.score, 0);
    const ranked = [...scored].sort((a, b) => b.score - a.score || a.m.day - b.m.day || (a.m.id < b.m.id ? -1 : 1));
    const chosen = new Set<IMemory>();
    let held = 0;
    for (const x of ranked) {
      if (total > 0 && held >= PHI_FLOW * total) break;
      chosen.add(x.m);
      held += x.score;
    }
    for (const m of folded.memories) if (m.ledger?.open && touches(m) > 0) chosen.add(m);
    return folded.memories.filter(m => chosen.has(m));
  },

  /** A memory in words. A dead slot is "?"; a role never held is left out. */
  words(m: IMemory, book: IAtomBook, name?: (entityId: string) => string | undefined): IRecalled {
    const out: IRecalled = { day: m.day };
    for (const role of ROLES) {
      if (!(role in m.slots)) continue;
      const slot = m.slots[role];
      out[role] = living(slot) ? AtomBook.read(book, slot.atom, name) : '?';
    }
    if (m.ledger) out.ledger = `${m.ledger.kind}, ${m.ledger.open ? 'open' : 'settled'}`;
    return out;
  }
};

/** A memory as words, as a model or a window reads it. */
export type IRecalled = { day: number; ledger?: string } & Partial<Record<Role, string>>;
