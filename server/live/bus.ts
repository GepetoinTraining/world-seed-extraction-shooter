/**
 * THE WORD BETWEEN INSTANCES. A function host pins each socket to the instance that took it, and a
 * second player's socket may sit on another (DEPLOY.md). What one instance does, the others must
 * hear, to tell their own sockets. That word goes through the Postgres the room already keeps
 * (Pedro, 2026-11-04: "we serve a postgress we socket to join them"): LISTEN and NOTIFY, on one
 * connection of this instance's own.
 *
 * IT IS ONLY EVER A NUDGE. Nothing is kept here and nothing depends on a word arriving. An event is
 * in the store by number before anyone is told, and every instance looks at the numbers again on a
 * slow beat (room.ts), so a word lost to a dropped connection is caught up a moment later. Where a
 * player stands is said again every second by their own browser.
 *
 * A word is small. Postgres carries under 8,000 bytes in one, so a word names what changed (a
 * world and a number, a line's key) and whoever hears it reads the thing itself from the store.
 */
import { randomBytes } from 'node:crypto';

export interface ILiveBus {
  /** This instance's own name: it never hears itself. */
  readonly id: string;
  /** To every other instance. Never throws and never waits. */
  say(word: object): void;
  /** What the others say. `{ again: true }` after this instance could not hear for a while. */
  hear(fn: (word: any) => void): () => void;
  /**
   * A word that is a table read on a beat (live/tursoLive.ts, where there is no Postgres to nudge
   * through) does not carry what is said: it reads what the room stands on, each beat. The room hands
   * it this view once. A bus that carries words leaves this out.
   */
  follow?(room: ILiveRoomView): void;
  close(): Promise<void>;
}

/** One of this instance's own players, where they last said they stand. `held`: their socket closed a moment ago. */
export interface IStanding { uid: string; place: string; where: Record<string, unknown>; held?: boolean }

/** What a beat-read word asks of the room it serves. */
export interface ILiveRoomView {
  /** The worlds this instance has players in: listening, standing somewhere, or held a moment after their socket closed. */
  watched(): string[];
  /** Where this instance's own players stand in a world, those held after their socket closed among them. */
  standing(world: string): IStanding[];
}

const newId = () => randomBytes(6).toString('hex');

/** One instance and nobody else: the local stand-in, and every test of one room. */
export function soloBus(): ILiveBus {
  return { id: newId(), say: () => undefined, hear: () => () => undefined, close: async () => undefined };
}

/** Several rooms in one process, as several instances would be: what the bars stand two rooms on. */
export class LocalWire {
  private readonly ends = new Map<string, Set<(word: any) => void>>();

  join(): ILiveBus {
    const id = newId();
    const mine = new Set<(word: any) => void>();
    this.ends.set(id, mine);
    return {
      id,
      say: word => {
        const text = JSON.stringify(word);
        for (const [other, fns] of this.ends) {
          if (other === id) continue;
          // After this turn, as a network would: never inside the caller's own step
          for (const fn of fns) queueMicrotask(() => fn(JSON.parse(text)));
        }
      },
      hear: fn => { mine.add(fn); return () => { mine.delete(fn); }; },
      close: async () => { this.ends.delete(id); }
    };
  }
}

const CHANNEL = 'worldseed_live';
/** Under Postgres's own ceiling for one NOTIFY, with room for the sender's name. */
const WORD_BYTES = 7_000;
const FIRST_RETRY_MS = 500;
const MOST_RETRY_MS = 15_000;

/**
 * Through a served Postgres. `url` must be a direct connection: a pooler in transaction mode gives
 * each statement any connection, and LISTEN belongs to one.
 */
export async function postgresBus(url: string, say: (line: string) => void = line => console.warn(line)): Promise<ILiveBus> {
  const { Client } = (await import('pg')).default;
  const id = newId();
  const fns = new Set<(word: any) => void>();
  let client: InstanceType<typeof Client> | null = null;
  let closed = false;
  let retryMs = FIRST_RETRY_MS;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const tell = (word: any) => { for (const fn of fns) { try { fn(word); } catch (e) { console.error('[LIVE] A word between instances was not taken:', e); } } };

  const connect = async (again: boolean): Promise<void> => {
    if (closed) return;
    const next = new Client({ connectionString: url });
    const lost = () => {
      if (client !== next) return;
      client = null;
      next.removeAllListeners();
      next.end().catch(() => undefined);
      if (closed || timer) return;
      timer = setTimeout(() => { timer = null; void connect(true); }, retryMs);
      (timer as { unref?: () => void }).unref?.();
      retryMs = Math.min(retryMs * 2, MOST_RETRY_MS);
    };
    try {
      next.on('error', lost);
      next.on('end', lost);
      next.on('notification', (n: { channel: string; payload?: string }) => {
        if (n.channel !== CHANNEL || !n.payload) return;
        let said: { from?: string; word?: unknown };
        try { said = JSON.parse(n.payload); } catch { return; }
        if (said.from !== id) tell(said.word);
      });
      await next.connect();
      await next.query(`LISTEN ${CHANNEL}`);
      client = next;
      retryMs = FIRST_RETRY_MS;
      // What was said while this one could not hear is gone: whoever listens looks at the store again
      if (again) tell({ again: true });
    } catch (e) {
      say(`[LIVE] The word between instances cannot be heard right now, and is tried again: ${e instanceof Error ? e.message : String(e)}`);
      client = next;
      lost();
    }
  };
  await connect(false);

  return {
    id,
    say(word) {
      const text = JSON.stringify({ from: id, word });
      if (!client || Buffer.byteLength(text) > WORD_BYTES) return;
      client.query('SELECT pg_notify($1, $2)', [CHANNEL, text]).catch(() => undefined);
    },
    hear(fn) { fns.add(fn); return () => { fns.delete(fn); }; },
    async close() {
      closed = true;
      if (timer) clearTimeout(timer);
      const was = client;
      client = null;
      if (was) { was.removeAllListeners(); await was.end().catch(() => undefined); }
    }
  };
}
