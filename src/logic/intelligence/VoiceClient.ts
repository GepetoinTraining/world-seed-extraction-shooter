/**
 * The browser's side of choosing a voice: the check on this machine, the local model, and a key
 * for a free option. A key is sent to this machine's server door once and never kept here: not in
 * storage, not in a store, not in a log. Only the local model's name is remembered, because it is
 * the person's setting and no secret.
 */
import type { IMachineReading, ITried } from '../../../server/intelligence/machine';
import type { IKeyedOption, IDoorOptions } from '../../../server/intelligence/options';
import type { IDoorSettingStatus } from '../../../server/intelligence/setting';

export type { IMachineReading, ITried, IKeyedOption, IDoorSettingStatus };

const MOUNT = '/api/intelligence';
const LOCAL_CHOICE = 'worldseed_voice_local_model';

async function call<T>(path: string, body?: unknown): Promise<T | null> {
  try {
    const res = await fetch(`${MOUNT}${path}`, body === undefined ? undefined : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return await res.json() as T;
  } catch {
    return null;
  }
}

const remembered = (): string | null => {
  try { return localStorage.getItem(LOCAL_CHOICE); } catch { return null; }
};

export const VoiceClient = {
  status: () => call<IDoorSettingStatus>('/status'),
  machine: () => call<IMachineReading>('/machine'),
  options: () => call<Pick<IDoorOptions, 'keyed' | 'local'>>('/options'),
  tryModel: (model: string) => call<ITried>('/machine/try', { model }),
  pull: (model: string) => call<{ ok: boolean; reason?: string }>('/local/pull', { model }),

  /** The person's local mode, on the model they picked. Remembered here, as their setting. */
  async useLocal(model: string) {
    try { localStorage.setItem(LOCAL_CHOICE, model); } catch { /* a private window keeps nothing */ }
    return call<{ status: IDoorSettingStatus; machine: IMachineReading }>('/local/choose', { model });
  },

  /** The key goes to the server door and is let go of here at once. What comes back never holds it. */
  useKey: (optionId: string, key: string) => call<{ ok: boolean; reason?: string; status?: IDoorSettingStatus }>('/key', { optionId, key }),

  /** Back to the server's own way: its key while it has one, else the local model. */
  async useAuto() {
    try { localStorage.removeItem(LOCAL_CHOICE); } catch { /* nothing kept */ }
    return call<IDoorSettingStatus>('/auto', {});
  },

  /** A server forgets the choice when it restarts; the browser says it again. */
  async restore(): Promise<void> {
    const model = remembered();
    if (model) await call('/local/choose', { model });
  },

  remembered
};
