/**
 * THE PLAYER'S KEY, KEPT IN THEIR BROWSER (Pedro, 2026-11-04: "their IDB makes the call"). Played
 * from the domain, a player's own key lives with the player and goes only to its provider.
 *
 * At rest it is sealed: AES-GCM under a key made in this browser as not extractable, kept beside
 * it in IndexedDB. What sits in storage is ciphertext and a key that cannot be exported, so the key
 * as written is not in any storage a page script, a log or an extension reading storage could
 * copy out, and it never reaches our servers. A script running in this page's own origin can still
 * ask the browser to unseal it: no browser offers better to a page, and that is said plainly.
 * Forgetting takes the sealed key and its sealing key away together.
 */

export interface IKeyShelf {
  get(id: string): Promise<unknown>;
  put(id: string, value: unknown): Promise<void>;
  delete(id: string): Promise<void>;
}

interface ISealed { sealing: CryptoKey; iv: Uint8Array; sealed: Uint8Array }

const SHELF_ID = 'voice_key';

export function createKeyVault(shelf: IKeyShelf) {
  return {
    async keep(optionId: string, key: string): Promise<void> {
      const sealing = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, sealing, new TextEncoder().encode(JSON.stringify({ optionId, key }))));
      await shelf.put(SHELF_ID, { sealing, iv, sealed } satisfies ISealed);
    },

    async read(): Promise<{ optionId: string; key: string } | null> {
      const held = (await shelf.get(SHELF_ID)) as ISealed | undefined;
      if (!held?.sealing) return null;
      try {
        const open = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: held.iv as BufferSource }, held.sealing, held.sealed as BufferSource);
        const said = JSON.parse(new TextDecoder().decode(open));
        return typeof said?.optionId === 'string' && typeof said?.key === 'string' ? said : null;
      } catch {
        return null;
      }
    },

    async forget(): Promise<void> {
      await shelf.delete(SHELF_ID);
    }
  };
}

export type KeyVault = ReturnType<typeof createKeyVault>;

/** The browser's shelf: one IndexedDB store, apart from the game's save. */
export function indexedDbShelf(name = 'worldseed-voice'): IKeyShelf {
  const db = () => new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(name, 1);
    request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains('keys')) request.result.createObjectStore('keys'); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const run = async <T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
    const handle = await db();
    return new Promise<T>((resolve, reject) => {
      const tx = handle.transaction('keys', mode);
      const request = work(tx.objectStore('keys'));
      tx.oncomplete = () => { handle.close(); resolve(request.result); };
      tx.onerror = () => { handle.close(); reject(tx.error); };
    });
  };
  return {
    get: id => run('readonly', s => s.get(id)),
    put: async (id, value) => { await run('readwrite', s => s.put(value, id)); },
    delete: async id => { await run('readwrite', s => s.delete(id)); }
  };
}
