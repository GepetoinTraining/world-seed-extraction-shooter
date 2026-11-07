/**
 * THE CHECK ON THIS MACHINE. Pedro: "we'll need to build a CHECK on the person's computer, and be
 * honest with them, if they can't run a local model they need to insert a key".
 *
 * It reads what the door needs to know and nothing more: whether a local runtime is here and
 * running, the graphics card and its memory, the memory, what models the runtime serves, and,
 * when the person asks, whether a model answers and holds the door's shapes. The reading stays on
 * this machine: it is answered over loopback only, to the person's own browser.
 *
 * It says, never blocks (Pedro: "the choice should be the players"). Any model the runtime serves
 * can be chosen, however large; the check says how it would sit and how it fared.
 */
import type { ILocalRuntime, IServedModel } from './local';
import type { ISuggestion } from './options';
import { LocalProvider } from './local';

export interface ICard {
  name: string;
  /** Its own memory, in bytes. Absent when the machine would not say. */
  bytes?: number;
  /** `at least` when the only source caps what it reports; `shared` when the card uses the machine's memory. */
  measure: 'exact' | 'at least' | 'shared';
}

export interface IHost {
  cards(): Promise<ICard[]>;
  memory(): { total: number; free: number };
}

/** Where a model of this size would sit here. */
export type Seat = 'CARD' | 'CARD_AND_MEMORY' | 'MEMORY' | 'TOO_BIG' | 'UNKNOWN';

export interface ITried {
  model: string;
  answered: boolean;
  /** It came back in the shape asked for, as the door's shaped kinds need. */
  heldShape: boolean;
  ms: number;
  /** How much of it sat on the card while it answered, 0 to 1, when the runtime says. */
  onCard?: number;
  reason?: string;
  at: number;
}

export interface IMachineReading {
  runtime: { name: string; url?: string; state: 'RUNNING' | 'INSTALLED' | 'ABSENT'; page?: string };
  cards: ICard[];
  memory: { total: number; free: number };
  served: (IServedModel & { seat: Seat })[];
  chosen: string;
  suggested?: { model: string; bytes: number; seat: Seat; served: boolean; why?: string };
  tried: ITried[];
  verdict: 'READY' | 'CAN_RUN' | 'NEEDS_KEY';
  /** What the person is told, in order, plainly. */
  says: string[];
}

/** A model's size as its runtime gives it (decimal); a card's and the memory's as they are sold (binary). */
const size = (bytes: number) => `${(bytes / 1e9).toFixed(1)} GB`;
const hardware = (bytes: number) => `${(bytes / 2 ** 30).toFixed(1)} GB`;

/** A machine that says nothing about itself: a page, which cannot read the card or the memory. Everything stays unknown. */
export const NO_HOST: IHost = {
  async cards() { return []; },
  memory() { return { total: 0, free: 0 }; }
};

/** Where a model of `bytes` would sit, on what was read. A reading it cannot make is UNKNOWN, never a guess. */
export function seatOf(bytes: number, cards: ICard[], memory: { total: number; free: number }): Seat {
  if (!bytes) return 'UNKNOWN';
  const card = cards.reduce((most, c) => Math.max(most, c.bytes ?? 0), 0);
  const shared = cards.some(c => c.measure === 'shared');
  if (shared) return bytes < memory.free ? 'CARD' : bytes < memory.total ? 'CARD_AND_MEMORY' : 'TOO_BIG';
  const exact = cards.some(c => c.measure === 'exact');
  if (exact && bytes < card) return 'CARD';
  if (exact && bytes < card + memory.free) return 'CARD_AND_MEMORY';
  if (bytes < memory.free) return exact || cards.length === 0 ? 'MEMORY' : 'UNKNOWN';
  if (bytes < memory.total) return 'UNKNOWN';
  return 'TOO_BIG';
}

const SEAT_WORDS: Record<Seat, string> = {
  CARD: 'fits on the graphics card',
  CARD_AND_MEMORY: 'spills off the card into memory, and answers slower',
  MEMORY: 'runs from memory without the card, and answers slowly',
  TOO_BIG: 'is larger than this machine can hold',
  UNKNOWN: 'may or may not fit: this machine did not say enough to tell'
};

/** A small ask in a shape, so a try shows whether the model holds the door's shaped kinds. */
const TRY_SCHEMA = { type: 'object', properties: { word: { type: 'string' }, count: { type: 'integer' } }, required: ['word', 'count'], additionalProperties: false };

export class MachineCheck {
  private tries = new Map<string, ITried>();

  constructor(private local: LocalProvider, private host: IHost = NO_HOST, private suggestions: ISuggestion[] = [], private page?: string) {}

  /** The suggestion for this machine: the largest that fits on its card; off a card, the smallest, which answers fastest. */
  static pick(suggestions: ISuggestion[], cards: ICard[], memory: { total: number; free: number }): ISuggestion | undefined {
    if (suggestions.length === 0) return undefined;
    const bySize = [...suggestions].sort((a, b) => b.bytes - a.bytes);
    return bySize.find(s => seatOf(s.bytes, cards, memory) === 'CARD') ?? bySize[bySize.length - 1];
  }

  /** What this machine is suggested, read fresh. */
  async suggest(): Promise<ISuggestion | undefined> {
    return MachineCheck.pick(this.suggestions, await this.host.cards().catch(() => []), this.host.memory());
  }

  get runtime(): ILocalRuntime {
    return this.local.runtime;
  }

  /** The person's choice. Any served model, however large: the check says, and never refuses. */
  choose(model: string): void {
    this.runtime.model = model.trim();
  }

  /** Ask a model one small thing in a shape, and time it. Loading it may take a while the first time. */
  async tryModel(model: string): Promise<ITried> {
    const start = Date.now();
    {
      const out = await this.local.ask({
        kind: 'creation', system: 'Answer in the shape asked. Plain words.', maxTokens: 64,
        messages: [{ role: 'user', content: 'Name one colour in one word, and say how many letters it has.' }], schema: TRY_SCHEMA
      }, model);
      const data = out.data as { word?: unknown; count?: unknown } | undefined;
      const heldShape = out.status === 'OK' && typeof data?.word === 'string' && Number.isInteger(data?.count);
      const loaded = (await this.runtime.loaded?.().catch(() => [])) ?? [];
      const seat = loaded.find(l => l.name === model);
      const tried: ITried = {
        model, answered: out.status === 'OK', heldShape, ms: Date.now() - start, at: Date.now(),
        ...(seat && seat.bytes > 0 ? { onCard: seat.cardBytes / seat.bytes } : {}),
        ...(out.status === 'OK' ? (heldShape ? {} : { reason: 'It answered, but not in the shape asked.' }) : { reason: out.reason ?? out.status })
      };
      this.tries.set(model, tried);
      return tried;
    }
  }

  async read(): Promise<IMachineReading> {
    const [cards, served, installed] = await Promise.all([
      this.host.cards().catch(() => []),
      this.runtime.list ? this.runtime.list().then(list => ({ ok: true as const, list }), () => ({ ok: false as const, list: [] as IServedModel[] })) : Promise.resolve({ ok: false as const, list: [] as IServedModel[] }),
      this.runtime.installed ? this.runtime.installed().catch(() => false) : Promise.resolve(false)
    ]);
    const memory = this.host.memory();
    const state = served.ok ? 'RUNNING' : installed ? 'INSTALLED' : 'ABSENT';
    const seated = served.list.map(m => ({ ...m, seat: seatOf(m.bytes, cards, memory) }));
    const chosen = this.runtime.model;
    const pick = MachineCheck.pick(this.suggestions, cards, memory);
    const suggested = pick
      ? { model: pick.model, bytes: pick.bytes, seat: seatOf(pick.bytes, cards, memory), served: seated.some(m => m.name === pick.model), why: pick.why }
      : undefined;
    const tried = [...this.tries.values()];
    const chosenTry = this.tries.get(chosen);
    const chosenServed = seated.some(m => m.name === chosen);

    // Can this machine carry a local model at all? The suggestions' sizes are the measure, when there are any
    const carries = this.suggestions.length > 0
      ? this.suggestions.some(s => seatOf(s.bytes, cards, memory) !== 'TOO_BIG')
      : seated.some(m => m.seat !== 'TOO_BIG');
    const verdict: IMachineReading['verdict'] = state === 'RUNNING' && chosenServed && chosenTry?.answered && chosenTry.heldShape
      ? 'READY'
      : state !== 'ABSENT' && carries ? 'CAN_RUN' : 'NEEDS_KEY';

    const says: string[] = [];
    const card = cards.length === 0 ? 'No graphics card could be read.'
      : cards.map(c => `${c.name}${c.bytes ? `, ${c.measure === 'at least' ? 'at least ' : ''}${hardware(c.bytes)}${c.measure === 'shared' ? ' shared with the machine' : ''}` : ', its memory unknown'}.`).join(' ');
    says.push(`${card} Memory: ${hardware(memory.total)}, ${hardware(memory.free)} free.`);
    if (state === 'ABSENT') says.push(`No local runtime is on this machine. ${this.page ? `One can be installed from ${this.page}, or` : 'Without one,'} a key is needed.`);
    if (state === 'INSTALLED') says.push(`${this.runtime.name} is on this machine but is not running. Start it, and check again.`);
    if (state === 'RUNNING') {
      says.push(seated.length === 0
        ? `${this.runtime.name} is running and serves no model yet.`
        : `${this.runtime.name} is running and serves ${seated.length} model${seated.length === 1 ? '' : 's'}.`);
    }
    if (suggested) {
      says.push(`The suggestion for this machine, ${suggested.model} (${size(suggested.bytes)}), ${SEAT_WORDS[suggested.seat]}${suggested.served ? '' : ', and is not pulled yet'}.`);
    }
    if (chosen && state === 'RUNNING') {
      if (!chosenServed) says.push(`The chosen model, ${chosen}, is not served here.`);
      else if (!chosenTry) says.push(`The chosen model, ${chosen}, has not been tried yet.`);
      else if (!chosenTry.answered) says.push(`The chosen model, ${chosen}, did not answer: ${chosenTry.reason}`);
      else says.push(`The chosen model, ${chosen}, answered in ${(chosenTry.ms / 1000).toFixed(1)} s${chosenTry.heldShape ? ' and held the shape asked' : `, but ${chosenTry.reason?.toLowerCase()}`}${chosenTry.onCard !== undefined ? `, ${Math.round(chosenTry.onCard * 100)}% of it on the card` : ''}.`);
    }
    if (verdict === 'NEEDS_KEY') says.push('This machine cannot run a local model as it stands. To have a voice, insert a key: there are free ones to pick from.');
    if (verdict === 'READY') says.push('The voice runs on this machine.');

    return {
      runtime: { name: this.runtime.name, url: this.runtime.url, state, ...(this.page ? { page: this.page } : {}) },
      cards, memory, served: seated, chosen, ...(suggested ? { suggested } : {}), tried, verdict, says
    };
  }
}
