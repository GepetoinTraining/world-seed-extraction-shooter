/**
 * The browser's side of choosing a voice: the check on this machine, the local model, and a key
 * for a free option. Under a server door, a key is sent to it once and never kept here: not in
 * storage, not in a store, not in a log. Played from the domain, the door is the page's own, and
 * the player's key lives with the player, sealed in this browser (KeyVault.ts), sent only to its
 * provider. The local model's name is remembered, because it is the person's setting and no secret.
 */
import { DoorTransport } from './DoorTransport';
import type { IMachineReading, ITried } from '../../../shared/intelligence/machine';
import type { IKeyedOption, IDoorOptions } from '../../../shared/intelligence/options';
import type { IDoorSettingStatus } from '../../../shared/intelligence/setting';

export type { IMachineReading, ITried, IKeyedOption, IDoorSettingStatus };

const LOCAL_CHOICE = 'worldseed_voice_local_model';

async function call<T>(path: string, body?: unknown): Promise<T | null> {
  try {
    return await DoorTransport.json<T>(path, body);
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

  /** The key goes to the door. Under a server it is let go of here at once; in the page it is kept sealed, for the player. */
  async useKey(optionId: string, key: string) {
    const out = await call<{ ok: boolean; reason?: string; status?: IDoorSettingStatus }>('/key', { optionId, key });
    if (out?.ok) await DoorTransport.vault()?.keep(optionId, key).catch(() => undefined);
    return out;
  },

  /** Back to the server's own way: its key while it has one, else the local model. */
  async useAuto() {
    try { localStorage.removeItem(LOCAL_CHOICE); } catch { /* nothing kept */ }
    await DoorTransport.vault()?.forget().catch(() => undefined);
    return call<IDoorSettingStatus>('/auto', {});
  },

  /** A server forgets the choice when it restarts; the browser says it again. */
  async restore(): Promise<void> {
    const model = remembered();
    if (model) await call('/local/choose', { model });
    // In the page, the player's sealed key is put back in the door
    const kept = await DoorTransport.vault()?.read().catch(() => null);
    if (kept) await call('/key', kept);
  },

  /** One question to the provider: does it take this key. The door holds nothing after it. */
  testKey: (optionId: string, key: string) => call<{ ok: boolean; reason?: string }>('/key/test', { optionId, key }),

  /**
   * Whose keys are held, and which is in use. Never a key. In the page, a key sealed in this browser
   * counts as held even before the door has taken it again.
   */
  async keys(): Promise<IHeldKey[]> {
    const held: IHeldKey[] = (await call<{ keys: IHeldKey[] }>('/keys'))?.keys ?? [];
    const sealed = await DoorTransport.vault()?.held().catch(() => [] as string[]) ?? [];
    const waiting = sealed.filter(id => !held.some(k => k.optionId === id));
    if (waiting.length === 0) return held;
    const offered = (await VoiceClient.options())?.keyed ?? [];
    return [...held, ...waiting.map(id => ({ optionId: id, name: offered.find(o => o.id === id)?.name ?? id, inUse: false }))];
  },

  /** A held key is put in use without being typed again. In the page, the door may need it from its seal first. */
  async useHeld(optionId: string) {
    type Out = { ok: boolean; reason?: string; status?: IDoorSettingStatus };
    let out = await call<Out>('/key/use', { optionId });
    if (!out?.ok) {
      const kept = await DoorTransport.vault()?.readOne(optionId).catch(() => null);
      if (kept) out = await call<Out>('/key', kept);
    }
    if (out?.ok) await DoorTransport.vault()?.use(optionId).catch(() => undefined);
    return out;
  },

  /** One key is dropped, from the door and from its seal. */
  async forgetKey(optionId: string) {
    await DoorTransport.vault()?.drop(optionId).catch(() => undefined);
    return call<{ ok: boolean; reason?: string }>('/key/forget', { optionId });
  },

  remembered
};

export interface IHeldKey { optionId: string; name: string; inUse: boolean }
