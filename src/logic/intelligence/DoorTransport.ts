/**
 * Where the game's clients reach the door: a server at /api/intelligence (development, a runner,
 * the world we host), or the page's own door (PageDoor.ts), when the game is played from the
 * domain. The clients above never learn which.
 *
 * Played from the domain there is a third: the hub's own voice (HostVoice.ts, server/hub/voice.ts),
 * which answers the door's asks on its operator's key for whoever is signed in. It is asked only
 * while the player has chosen nothing of their own: a key of theirs, or a model on their machine,
 * always wins, and the choice of voice, the machine's check and the keys are always the page's.
 */
import type { IPageDoor } from './PageDoor';
import type { KeyVault } from './KeyVault';
import type { IHostVoice } from './HostVoice';

const MOUNT = '/api/intelligence';
/** The hub's own voice, under the hub's mount so its session cookie rides along. */
const HOST_MOUNT = '/api/hub/voice';
/** What is always the page's own: the choice of voice, the machine's check, the keys. */
const OWN = /^\/(machine|options|keys|key|local|auto)(\/|$)/;

let page: IPageDoor | null = null;
let vault: KeyVault | null = null;
let host: IHostVoice | null = null;
/** The player's own choice being put back when the page opens: no ask is routed before it is known. */
let settled: Promise<unknown> = Promise.resolve();

const post = (body: unknown, signal?: AbortSignal): RequestInit =>
  ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), ...(signal ? { signal } : {}) });

/** Whether the hub offers a voice at all, while the player has chosen nothing of their own. */
async function hostWord() {
  if (!page || !host) return null;
  await settled;
  if (page.setting.chosen !== 'auto') return null;
  const said = await host.look().catch(() => null);
  return said?.offered ? said : null;
}

/** Whether this ask goes to the hub's own voice. */
async function throughHost(path: string): Promise<boolean> {
  if (OWN.test(path)) return false;
  return !!(await hostWord())?.signedIn;
}

async function readLines(res: Response, onLine: (line: string) => void): Promise<void> {
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

export const DoorTransport = {
  usePage(door: IPageDoor, keys?: KeyVault, hostVoice?: IHostVoice) {
    page = door;
    vault = keys ?? null;
    host = hostVoice ?? null;
    settled = Promise.resolve();
  },

  useServer() {
    page = null;
    vault = null;
    host = null;
    settled = Promise.resolve();
  },

  /** The player's own choice is being put back (VoiceClient.restore): asks wait for it before they are routed. */
  settleAfter(work: Promise<unknown>) {
    settled = work.then(() => undefined, () => undefined);
  },

  isPage: () => page !== null,

  /** The player's sealed key, when the door is the page's (KeyVault.ts). */
  vault: () => vault,

  /** One answer as JSON. `body` undefined is a GET. Throws only where a fetch would. */
  async json<T>(path: string, body?: unknown): Promise<T> {
    if (page) {
      if (await throughHost(path)) {
        const res = await fetch(`${HOST_MOUNT}${path}`, body === undefined ? { credentials: 'same-origin' } : { ...post(body), credentials: 'same-origin' });
        // The session ended since it was last looked at: the next ask learns it again
        if (res.status === 401) host?.forget();
        return await res.json() as T;
      }
      const answer = await page.answer(body === undefined ? 'GET' : 'POST', path, body ?? {});
      const said = answer.stream ? JSON.parse(await answer.stream(() => undefined, new AbortController().signal)) : answer.json;
      // The hub has a voice for whoever signs in, and nobody is: the status says so beside the page's own
      if (path === '/status' && said && typeof said === 'object' && await hostWord()) return { ...said, hostWaits: true } as T;
      return said as T;
    }
    const res = await fetch(`${MOUNT}${path}`, body === undefined ? undefined : post(body));
    return await res.json() as T;
  },

  /** Lines as they are written, the last one saying how it ended. */
  async lines(path: string, body: unknown, onLine: (line: string) => void, signal?: AbortSignal): Promise<void> {
    if (page) {
      if (await throughHost(path)) {
        const res = await fetch(`${HOST_MOUNT}${path}`, { ...post(body, signal), credentials: 'same-origin' });
        if (res.status === 401) host?.forget();
        // A refusal comes as one JSON answer, which says how it ended as a last line would
        if (!(res.headers.get('content-type') ?? '').includes('ndjson')) { onLine(JSON.stringify({ done: true, ...(await res.json()) })); return; }
        return readLines(res, onLine);
      }
      const answer = await page.answer('POST', path, body);
      if (!answer.stream) { onLine(JSON.stringify(answer.json)); return; }
      const last = await answer.stream(onLine, signal ?? new AbortController().signal);
      onLine(last);
      return;
    }
    return readLines(await fetch(`${MOUNT}${path}`, post(body, signal)), onLine);
  }
};
