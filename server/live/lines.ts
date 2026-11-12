/**
 * WHERE THE LIVE ROOM KEEPS ITS LINES (shared/logic/live/TalkLine.ts). One room in one process held
 * them in memory. A function host runs several instances, and two players waiting on the same
 * person may sit on two of them, so the line is kept where both can reach it: a working table of
 * the room's own in the Postgres it already has.
 *
 * It is working state, not the game's. The table is made here and not by the store's migrations,
 * so no browser carries it and the record never sees it; a line that empties is deleted.
 *
 * One change is whole: what stood is read, the law is applied, what stands is written, in one
 * transaction, and changes to the lines take turns (connection.ts).
 */
import { sql } from 'drizzle-orm';
import type { IDatabase } from '../../shared/dbShared';
import { emptyLine, type ILine } from '../../shared/logic/live/TalkLine';

export interface ILineBook {
  /** One change, whole. `next` is what stands after it. */
  change(key: string, law: (was: ILine) => ILine): Promise<{ was: ILine; next: ILine; changed: boolean }>;
  read(key: string): Promise<ILine>;
  /** Every line whose key starts so. */
  under(prefix: string): Promise<[string, ILine][]>;
}

/** One process and nobody else. */
export function memoryLines(): ILineBook {
  const lines = new Map<string, ILine>();
  return {
    async change(key, law) {
      const held = lines.get(key);
      const was = held ?? emptyLine();
      const next = law(was);
      if (next.turns.length === 0) {
        lines.delete(key);
        return { was, next, changed: held !== undefined };
      }
      // The law hands back a new line even when nothing moved, so it is what the line says that is compared
      const changed = JSON.stringify(next) !== JSON.stringify(was);
      if (changed) lines.set(key, next);
      return { was, next, changed };
    },
    async read(key) { return lines.get(key) ?? emptyLine(); },
    async under(prefix) { return [...lines].filter(([key]) => key.startsWith(prefix)); }
  };
}

/** In the room's own table, for as many instances as there are. */
export async function tableLines(database: IDatabase): Promise<ILineBook> {
  const { db } = database;
  await db.execute(sql`CREATE TABLE IF NOT EXISTS live_lines (key text COLLATE "C" PRIMARY KEY NOT NULL, line text NOT NULL, at bigint NOT NULL)`);
  const parse = (text: unknown): ILine => {
    try {
      const line = JSON.parse(String(text));
      return Array.isArray(line?.turns) ? line : emptyLine();
    } catch {
      return emptyLine();
    }
  };
  return {
    change(key, law) {
      return db.transaction(async (tx: any) => {
        const { rows } = await tx.execute(sql`SELECT line FROM live_lines WHERE key = ${key} FOR UPDATE`);
        const wasText = rows[0] ? String(rows[0].line) : null;
        const was = wasText === null ? emptyLine() : parse(wasText);
        const next = law(was);
        const nextText = JSON.stringify(next);
        if (next.turns.length === 0) {
          if (wasText !== null) await tx.execute(sql`DELETE FROM live_lines WHERE key = ${key}`);
          return { was, next, changed: wasText !== null };
        }
        if (nextText === wasText) return { was, next, changed: false };
        await tx.execute(sql`INSERT INTO live_lines (key, line, at) VALUES (${key}, ${nextText}, ${Date.now()}) ON CONFLICT (key) DO UPDATE SET line = EXCLUDED.line, at = EXCLUDED.at`);
        return { was, next, changed: true };
      });
    },
    async read(key) {
      const { rows } = await db.execute(sql`SELECT line FROM live_lines WHERE key = ${key}`);
      return rows[0] ? parse(rows[0].line) : emptyLine();
    },
    async under(prefix) {
      const { rows } = await db.execute(sql`SELECT key, line FROM live_lines WHERE substr(key, 1, ${prefix.length}) = ${prefix} ORDER BY key`);
      return rows.map((r: any): [string, ILine] => [String(r.key), parse(r.line)]);
    }
  };
}
