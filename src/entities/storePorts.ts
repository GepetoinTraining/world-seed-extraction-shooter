/**
 * HOW THE STORES REACH EACH OTHER. Each store offers its own port when its module loads; a store that
 * needs another reads it through `portOf`, which forwards to whatever has been offered by then. So no
 * store imports another, and a store used before the one it needs has loaded says which one is missing.
 * The ports are the same ones every system takes (worldView.ts, playerView.ts, hubView.ts); each store
 * names the type it reads, so this file imports nothing at all.
 */

export type StoreName = 'world' | 'player' | 'hub';

const offered: Partial<Record<StoreName, object>> = {};

/** A store hands its port over, once, as its module loads. */
export function offerPort(name: StoreName, port: object): void {
  offered[name] = port;
}

/** The port of another store, read at each use; `by` names the store asking, for the error. */
export function portOf<T extends object>(name: StoreName, by: string): T {
  return new Proxy({} as T, {
    get(_, key) {
      const port = offered[name] as Record<PropertyKey, unknown> | undefined;
      if (!port) throw new Error(`The ${by} needs the ${name} store, which has not loaded (${String(key)}).`);
      const value = port[key];
      return typeof value === 'function' ? value.bind(port) : value;
    }
  });
}
