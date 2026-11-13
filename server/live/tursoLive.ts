/**
 * THE LIVE ROOM WHERE THE STORE IS TURSO ALONE (HT3, HT4). There is no Postgres, so no LISTEN and no
 * NOTIFY: nothing to nudge another instance through. The beat becomes the word. Each instance holding
 * players reads, ONE request a beat, what the others left in the store's own tables, and tells its own
 * sockets what a nudge would have told them:
 *
 *   - an event: the world's head moved past what this instance last read;
 *   - where another instance's players stand, and who of them is gone;
 *   - a line of people waiting to talk that another instance changed.
 *
 * A PLACE IS NEVER A ROW PER MOVE (Pedro's plan gives 10 million rows written a month; a place said
 * each second and written each time is 2.6 million for one player online). Where this instance's
 * players stand is kept in its memory, and written as ONE row for the whole instance (its players
 * together, in `store_live_places`), and only while another instance is there to read it:
 *
 *   - once when it starts watching a world, so the others know it is there;
 *   - with another instance there: when a player comes or goes, at the next beat; when they move, at
 *     most once a pace; standing still, once a heartbeat, so the others know it is still there;
 *   - alone: never again. A newcomer's first row is what wakes it.
 *
 * The write rides inside the beat's own request. A row older than `staleMs` is an instance gone, and
 * its players are gone with it. The daily call clears what is left a day (tursoStore.ts, `maintain`).
 *
 * HOW LATE. An event or a line reaches a socket on another instance within a beat and one request. A
 * move, within a pace and a beat (a write a pace apart, read on the other's next beat). See TURSO_LIVE.
 *
 * A LINE IS CHANGED BY ITS VERSION. The line's law is the game's own (TalkLine.ts), run here in
 * JavaScript, so a change reads the line and then writes it only if its version is still the one read:
 * if another instance changed it in between, nothing is written and the change starts again from what
 * stands. The database decides. An emptied line stays a while, empty, so the others read that it
 * emptied; the daily call takes it.
 */
import { randomBytes } from 'node:crypto';
import { emptyLine, type ILine } from '../../shared/logic/live/TalkLine';
import type { ILineBook } from './lines';
import type { ILiveBus, ILiveRoomView } from './bus';
import { DB_NOW, type TursoStore } from '../tursoStore';

/**
 * What a host runs (HT4). A beat of one second: an event or a line reaches another instance within
 * about a second. A pace of two: a player walking on another instance is seen where they are at most
 * about three seconds late, and drawn between those points. A heartbeat of five, and an instance whose
 * row is fifteen seconds old is gone. Decided here, for Pedro to overrule.
 */
export const TURSO_LIVE = { beatMs: 1_000, paceMs: 2_000, aliveMs: 5_000, staleMs: 15_000 };
export type ITursoLiveTiming = typeof TURSO_LIVE;

/** How far back a beat reads the lines, past the newest it saw, so one written a moment before it is not missed. */
const LINES_MARGIN_MS = 1_000;
/** A line changed this often by others at once is not let go of; past this, something is wrong. */
const LINE_TRIES = 100;
/** Said again to this instance's sockets with nothing new, so a browser keeps drawing one standing still (Presence.ts). */
const SAY_AGAIN_MOST_MS = 1_000;

export const instanceId = () => randomBytes(6).toString('hex');

const parse = (text: unknown): ILine => {
  if (typeof text !== 'string' || text === '') return emptyLine();
  try {
    const line = JSON.parse(text);
    return Array.isArray(line?.turns) ? line : emptyLine();
  } catch {
    return emptyLine();
  }
};
const worldOfKey = (key: string) => (key.includes('|') ? key.slice(0, key.indexOf('|')) : key);
const npcOfKey = (key: string) => key.slice(key.lastIndexOf('|') + 1);

function pastPrefix(prefix: string): string | null {
  const points = [...prefix].map(c => c.codePointAt(0)!);
  while (points.length > 0 && points[points.length - 1] === 0x10ffff) points.pop();
  if (points.length === 0) return null;
  let last = points.pop()! + 1;
  if (last === 0xd800) last = 0xe000;
  return String.fromCodePoint(...points, last);
}

/** The room's lines in the store's own table, `by` this instance. */
export async function tursoLines(store: TursoStore, by: string = instanceId()): Promise<ILineBook> {
  await store.ready();
  return {
    async change(key, law) {
      for (let tries = 1; ; tries++) {
        const { rows } = await store.execute({ sql: 'SELECT line, v FROM store_live_lines WHERE key = ?', args: [key] });
        const row = rows[0];
        const wasText = row && String(row.line) !== '' ? String(row.line) : null;
        const was = parse(wasText);
        const next = law(was);
        let written: number;
        if (next.turns.length === 0) {
          if (wasText === null) return { was, next, changed: false };
          written = (await store.execute({ sql: `UPDATE store_live_lines SET line = '', v = v + 1, at = ${DB_NOW}, by = ? WHERE key = ? AND v = ?`, args: [by, key, Number(row.v)] })).rowsAffected;
        } else {
          const nextText = JSON.stringify(next);
          if (nextText === wasText) return { was, next, changed: false };
          written = row
            ? (await store.execute({ sql: `UPDATE store_live_lines SET line = ?, v = v + 1, at = ${DB_NOW}, by = ? WHERE key = ? AND v = ?`, args: [nextText, by, key, Number(row.v)] })).rowsAffected
            : (await store.execute({ sql: `INSERT INTO store_live_lines (key, world, line, v, at, by) VALUES (?, ?, ?, 1, ${DB_NOW}, ?) ON CONFLICT (key) DO NOTHING`, args: [key, worldOfKey(key), nextText, by] })).rowsAffected;
        }
        if (written === 1) return { was, next, changed: true };
        // Another instance changed it since it was read: nothing was written, and the law runs again on what stands
        if (tries >= LINE_TRIES) throw new Error(`The line ${key} kept changing under every try, and was not changed.`);
      }
    },
    async read(key) {
      const { rows } = await store.execute({ sql: 'SELECT line FROM store_live_lines WHERE key = ?', args: [key] });
      return parse(rows[0]?.line);
    },
    async under(prefix) {
      const past = pastPrefix(prefix);
      const { rows } = await store.execute({
        sql: `SELECT key, line FROM store_live_lines WHERE key >= ?${past === null ? '' : ' AND key < ?'} AND substr(key, 1, length(?)) = ? AND line <> '' ORDER BY key`,
        args: [prefix, ...(past === null ? [] : [past]), prefix, prefix]
      });
      return rows.map((r): [string, ILine] => [String(r.key), parse(r.line)]);
    }
  };
}

interface IShown { place: string; text: string; saidAt: number }
interface IWorldWatch {
  /** The head as this instance last read it. */
  head?: number;
  /** The newest time a line was changed that this instance has read, by the database's clock. */
  linesSince?: number;
  lineV: Map<string, number>;
  /** Whether another instance's row was live at the last read. */
  othersLive: boolean;
  /** What this instance last wrote of its own players: when (its own clock), who, and where without their own times. */
  wrote: { at: number; uids: string; shape: string } | null;
  /** Another instance's players, as this instance last told its sockets of them. */
  shown: Map<string, IShown>;
}

type Stmt = { sql: string; args: any[] };

/**
 * The word between instances, read from the store on a beat. `say` carries nothing: everything another
 * instance needs is read from where the room stands (`follow`), and from the store.
 */
export async function tursoBus(store: TursoStore, options: Partial<ITursoLiveTiming> & { id?: string; say?: (line: string) => void } = {}): Promise<ILiveBus> {
  await store.ready();
  const timing = { ...TURSO_LIVE, ...Object.fromEntries(Object.entries(options).filter(([k, v]) => k in TURSO_LIVE && typeof v === 'number')) } as ITursoLiveTiming;
  const id = options.id ?? instanceId();
  const tellLog = options.say ?? (line => console.warn(line));
  const fns = new Set<(word: any) => void>();
  const watches = new Map<string, IWorldWatch>();
  let view: ILiveRoomView | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let running = false;
  let closed = false;
  let failing = false;

  const tell = (word: unknown) => {
    for (const fn of fns) {
      try { fn(word); } catch (e) { console.error('[LIVE] A word between instances was not taken:', e); }
    }
  };
  /** Where a player stands, without their own clock's time: what has moved, and what is only said again. */
  const shapeOf = (where: Record<string, unknown>) => JSON.stringify({ ...where, t: undefined });

  const beat = async () => {
    if (running || closed || !view) return;
    running = true;
    try {
      const watched = new Set(view.watched());
      const now = Date.now();
      const statements: Stmt[] = [];
      const reads: { world: string; at: number; index: number; pending?: IWorldWatch['wrote'] }[] = [];
      let writing = false;

      // A world no longer watched: this instance's row there goes, so nobody reads its players as still there
      for (const [world, watch] of watches) {
        if (watched.has(world)) continue;
        if (watch.wrote) { statements.push({ sql: 'DELETE FROM store_live_places WHERE world = ? AND instance = ?', args: [world, id] }); writing = true; }
        watches.delete(world);
      }

      for (const world of watched) {
        const watch: IWorldWatch = watches.get(world) ?? { lineV: new Map(), othersLive: false, wrote: null, shown: new Map() };
        watches.set(world, watch);
        const standing = view.standing(world);
        const mine: Record<string, { place: string; where: Record<string, unknown> }> = {};
        for (const s of standing) mine[s.uid] = { place: s.place, where: s.where };
        const uids = Object.keys(mine).sort().join(',');
        const shape = JSON.stringify(Object.keys(mine).sort().map(uid => [uid, mine[uid].place, shapeOf(mine[uid].where)]));
        const since = watch.wrote ? now - watch.wrote.at : Infinity;
        const due = watch.wrote === null
          || (watch.othersLive && (uids !== watch.wrote.uids
            || (shape !== watch.wrote.shape && since >= timing.paceMs - timing.beatMs / 2)
            || since >= timing.aliveMs - timing.beatMs / 2));
        let pending: IWorldWatch['wrote'] | undefined;
        if (due) {
          statements.push({
            sql: `INSERT INTO store_live_places (world, instance, at, places) VALUES (?, ?, ${DB_NOW}, ?) ON CONFLICT (world, instance) DO UPDATE SET at = excluded.at, places = excluded.places`,
            args: [world, id, JSON.stringify(mine)]
          });
          writing = true;
          pending = { at: now, uids, shape };
        }
        const index = statements.length;
        statements.push({ sql: `SELECT json_extract(data, '$.seq') AS seq FROM store_documents WHERE id = ?`, args: [`live_head_${world}`] });
        statements.push({ sql: `SELECT instance, at, places FROM store_live_places WHERE world = ? AND at > ${DB_NOW} - ? AND instance <> ?`, args: [world, timing.staleMs, id] });
        statements.push({
          sql: `SELECT key, v, by, at FROM store_live_lines WHERE world = ? AND at > COALESCE(?, ${DB_NOW} - ?)`,
          args: [world, watch.linesSince === undefined ? null : watch.linesSince - LINES_MARGIN_MS, LINES_MARGIN_MS]
        });
        reads.push({ world, at: now, index, pending });
      }
      if (statements.length === 0) return;

      const results = await store.batch(statements, writing ? 'write' : 'deferred');
      if (failing) { failing = false; tellLog('[LIVE] The word between instances is read again.'); }
      for (const read of reads) {
        const watch = watches.get(read.world);
        const [head, places, lines] = [results[read.index], results[read.index + 1], results[read.index + 2]];
        if (!watch) continue;
        if (read.pending) watch.wrote = read.pending;

        // An event landed somewhere: the room reads it from the store by number
        const seq = Number(head.rows[0]?.seq ?? 0);
        if (watch.head === undefined || seq > watch.head) { if (seq > 0) tell({ e: read.world, seq }); watch.head = seq; }

        // Another instance's players: told when they move, said again now and then, and gone when they are
        watch.othersLive = places.rows.length > 0;
        // On a socket here: another instance's word of them is old. Held here, their socket closed: another's word is
        // that they came back there, which the room must hear to let go of them (room.ts, `back`)
        const here = view.standing(read.world);
        const local = new Set(here.filter(s => !s.held).map(s => s.uid));
        const anyHere = new Set(here.map(s => s.uid));
        const there = new Map<string, { place: string; where: Record<string, unknown>; at: number }>();
        for (const row of places.rows) {
          let held: Record<string, { place: string; where: Record<string, unknown> }>;
          try { held = JSON.parse(String(row.places)); } catch { continue; }
          for (const [uid, stood] of Object.entries(held)) {
            const was = there.get(uid);
            if (!was || Number(row.at) > was.at) there.set(uid, { ...stood, at: Number(row.at) });
          }
        }
        for (const [uid, stood] of there) {
          if (local.has(uid)) continue;
          const text = JSON.stringify(stood.where);
          const shown = watch.shown.get(uid);
          if (shown && shown.text === text && shown.place === stood.place && read.at - shown.saidAt < Math.min(SAY_AGAIN_MOST_MS, timing.aliveMs)) continue;
          watch.shown.set(uid, { place: stood.place, text, saidAt: read.at });
          tell({ p: { world: read.world, place: stood.place, where: { ...stood.where, uid } } });
        }
        for (const [uid, shown] of watch.shown) {
          if (there.has(uid) && !local.has(uid)) continue;
          watch.shown.delete(uid);
          if (!anyHere.has(uid)) tell({ g: { world: read.world, place: shown.place, uid } });
        }

        // A line another instance changed: the room reads it as it stands
        for (const row of lines.rows) {
          const key = String(row.key);
          const v = Number(row.v);
          watch.linesSince = Math.max(watch.linesSince ?? 0, Number(row.at));
          if (v <= (watch.lineV.get(key) ?? 0)) continue;
          watch.lineV.set(key, v);
          if (String(row.by) !== id) tell({ l: { world: read.world, key, npc: npcOfKey(key) } });
        }
      }
    } catch (e) {
      if (!failing && !closed) tellLog(`[LIVE] The word between instances cannot be read right now, and is tried again on the next beat: ${e instanceof Error ? e.message : String(e)}`);
      failing = true;
    } finally {
      running = false;
    }
  };

  return {
    id,
    say: () => undefined,
    hear(fn) { fns.add(fn); return () => { fns.delete(fn); }; },
    follow(room) {
      view = room;
      if (timer || timing.beatMs <= 0) return;
      timer = setInterval(() => void beat(), timing.beatMs);
      (timer as { unref?: () => void }).unref?.();
    },
    async close() {
      closed = true;
      if (timer) clearInterval(timer);
      timer = null;
      // Its rows go with it, so nobody reads its players as still there for a heartbeat and more
      if ([...watches.values()].some(w => w.wrote)) {
        await store.execute({ sql: 'DELETE FROM store_live_places WHERE instance = ?', args: [id] }).catch(() => undefined);
      }
      watches.clear();
    }
  };
}
