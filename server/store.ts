/**
 * WHAT THE HUB ASKS OF A STORE (HT0). Everything the hub's parts ask of the store they are given, and
 * nothing more, so either body answers it: `SqlStore` on Postgres (shared/SqlStore.ts), which the
 * browser and every local stand-in run, and `TursoStore` on Turso alone (tursoStore.ts), which a
 * function host runs with no Postgres anywhere (Pedro, 2026-11-13: "Yes, Turso only").
 *
 *   get, query           Hub (accounts, sessions, characters, rows, heads), HubPool, Eraser, LiveRoom
 *   commit               every write: one commit whole or not at all, applied once by its id, with its
 *                        guard; StoreConflict and StoreRefusal as the store's law says
 *   maintain, writeDown  the scheduled call, and a bar's write-down to the record
 *   health, search, close
 *
 * What the parts ask of the DATABASE under the store, around its law, is not here: taking a player's
 * data out (erase.ts, `IEraseHere`), the live room's lines (live/lines.ts, `ILineBook`) and the word
 * between instances (live/bus.ts, `ILiveBus`). Each body gives its own (hub/body.ts).
 */
import type { SqlStore } from '../shared/SqlStore';

export type IStore = Pick<SqlStore, 'health' | 'get' | 'query' | 'search' | 'commit' | 'maintain' | 'writeDown' | 'close'>;
