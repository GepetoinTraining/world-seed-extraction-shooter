/**
 * Where the game's clients reach the door: a server at /api/intelligence (development, a runner,
 * the world we host), or the page's own door (PageDoor.ts), when the game is played from the
 * domain. The clients above never learn which.
 */
import type { IPageDoor } from './PageDoor';
import type { KeyVault } from './KeyVault';

const MOUNT = '/api/intelligence';

let page: IPageDoor | null = null;
let vault: KeyVault | null = null;

export const DoorTransport = {
  usePage(door: IPageDoor, keys?: KeyVault) {
    page = door;
    vault = keys ?? null;
  },

  useServer() {
    page = null;
    vault = null;
  },

  isPage: () => page !== null,

  /** The player's sealed key, when the door is the page's (KeyVault.ts). */
  vault: () => vault,

  /** One answer as JSON. `body` undefined is a GET. Throws only where a fetch would. */
  async json<T>(path: string, body?: unknown): Promise<T> {
    if (page) {
      const answer = await page.answer(body === undefined ? 'GET' : 'POST', path, body ?? {});
      if (answer.stream) return JSON.parse(await answer.stream(() => undefined, new AbortController().signal)) as T;
      return answer.json as T;
    }
    const res = await fetch(`${MOUNT}${path}`, body === undefined ? undefined : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return await res.json() as T;
  },

  /** Lines as they are written, the last one saying how it ended. */
  async lines(path: string, body: unknown, onLine: (line: string) => void, signal?: AbortSignal): Promise<void> {
    if (page) {
      const answer = await page.answer('POST', path, body);
      if (!answer.stream) { onLine(JSON.stringify(answer.json)); return; }
      const last = await answer.stream(onLine, signal ?? new AbortController().signal);
      onLine(last);
      return;
    }
    const res = await fetch(`${MOUNT}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal });
    const reader = res.body?.getReader();
    if (!reader) { (await res.text()).split('\n').forEach(onLine); return; }
    const decoder = new TextDecoder();
    let held = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      held += decoder.decode(value, { stream: true });
      const parts = held.split('\n');
      held = parts.pop() ?? '';
      parts.forEach(onLine);
    }
    onLine(held);
  }
};
