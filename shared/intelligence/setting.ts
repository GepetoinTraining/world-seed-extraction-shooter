/**
 * THE PERSON'S CHOICE OF VOICE, behind the one door (memory: intelligence goes through one server
 * door). It is the provider the door holds, and it routes to whichever the person chose:
 *
 *   auto    the server's own key while there is one, the local model while there is none (Q24)
 *   local   the local model, the person's mode, whichever served model they picked
 *   keyed   an option on the person's own key (`door-options.json`). Several keys may be held, one in use
 *   off     nothing: every door still answers, and the game goes on
 *
 * Work filed under one choice is collected from the same provider, whatever the person picked since.
 */
import type { DoorStatus, IDoorOutcome, IDoorRequest, IIntelligenceDoorLike, IIntelligenceProvider, IProviderStatus } from './door';
import { LocalProvider } from './local';
import { MachineCheck, type IHost } from './machine';
import { IDoorOptions, KeyedProvider, OpenAICompatibleProvider, providerFor } from './options';

export type DoorMode = 'auto' | 'local' | 'keyed' | 'off';

/** The person's choice of voice, kept beside the door it routes, for the routes that change it. */
export const SETTINGS = new WeakMap<IIntelligenceDoorLike, DoorSetting>();

export interface IDoorSettingStatus extends IProviderStatus {
  mode: DoorMode;
  /** The keyed option in use, by its name. Never the key. */
  option?: string;
}

export class DoorSetting implements IIntelligenceProvider {
  readonly check: MachineCheck;
  private mode: DoorMode;
  private keyed?: KeyedProvider;
  /** Every key the person accepted, by its option. Held here, in memory, and nowhere else. */
  private held = new Map<string, KeyedProvider>();

  /** Until the person picks, the local model is the one suggested for this machine. */
  private picked: Promise<void>;

  constructor(private auto: IIntelligenceProvider, readonly local: LocalProvider, readonly options: IDoorOptions, host?: IHost, off = false) {
    this.check = new MachineCheck(local, host, options.local?.suggestions ?? [], options.local?.runtimePage);
    this.mode = off ? 'off' : 'auto';
    this.picked = local.runtime.model
      ? Promise.resolve()
      : this.check.suggest().then(s => { if (s && !local.runtime.model) local.runtime.model = s.model; }, () => undefined);
  }

  get name(): string {
    return this.current().name;
  }

  current(): IIntelligenceProvider {
    if (this.mode === 'local') return this.local;
    if (this.mode === 'keyed' && this.keyed) return this.keyed;
    return this.auto;
  }

  /** The person's local mode, on the model they picked. Any served model; the check says how it fares. */
  useLocal(model?: string): void {
    if (model?.trim()) this.check.choose(model);
    this.mode = 'local';
  }

  /** The provider this key would speak to, or why there is none. Nothing is asked of anyone yet. */
  private providerOf(optionId: string, key: string): KeyedProvider | { reason: string } {
    const option = this.options.keyed.find(o => o.id === optionId);
    if (!option) return { reason: 'No such option is offered.' };
    if (!key.trim()) return { reason: 'That key is empty.' };
    return providerFor(option, key.trim());
  }

  /** One question to the provider: does it take this key. Nothing is held and nothing changes, whatever it answers. */
  async testKey(optionId: string, key: string): Promise<{ ok: boolean; reason?: string }> {
    const made = this.providerOf(optionId, key);
    if ('reason' in made) return { ok: false, reason: made.reason };
    const status = await made.status();
    return status.available ? { ok: true } : { ok: false, reason: status.reason };
  }

  /** An option on the person's key, accepted: held and put in use. The key is kept here, in memory, and nowhere else. */
  async useKey(optionId: string, key: string): Promise<{ ok: boolean; reason?: string; status?: IDoorSettingStatus }> {
    const made = this.providerOf(optionId, key);
    if ('reason' in made) return { ok: false, reason: made.reason };
    const status = await made.status();
    if (!status.available) return { ok: false, reason: status.reason };
    this.held.set(optionId, made);
    this.keyed = made;
    this.mode = 'keyed';
    return { ok: true, status: await this.status() };
  }

  /** A key already held is put in use, without being typed again. */
  async useHeld(optionId: string): Promise<{ ok: boolean; reason?: string; status?: IDoorSettingStatus }> {
    const kept = this.held.get(optionId);
    if (!kept) return { ok: false, reason: 'No key is held for that one.' };
    this.keyed = kept;
    this.mode = 'keyed';
    return { ok: true, status: await this.status() };
  }

  /** One key is dropped. If it was the one in use, the voice goes back to the server's own way. */
  forgetKey(optionId: string): { ok: boolean; reason?: string } {
    const kept = this.held.get(optionId);
    if (!kept) return { ok: false, reason: 'No key is held for that one.' };
    this.held.delete(optionId);
    if (this.keyed === kept) {
      this.keyed = undefined;
      if (this.mode === 'keyed') this.mode = 'auto';
    }
    return { ok: true };
  }

  /** Whose keys are held, in the order they were accepted, and which is in use. Never a key. */
  keys(): { optionId: string; name: string; inUse: boolean }[] {
    return [...this.held].map(([optionId, provider]) => ({ optionId, name: provider.option.name, inUse: this.mode === 'keyed' && this.keyed === provider }));
  }

  /** Back to the server's own way. Every key is dropped. */
  useAuto(): void {
    this.keyed = undefined;
    this.held.clear();
    this.mode = 'auto';
  }

  async status(): Promise<IDoorSettingStatus> {
    await this.picked;
    if (this.mode === 'off') return { ...(await this.auto.status()), mode: 'off' };
    const status = await this.current().status();
    return { ...status, mode: this.mode, ...(this.mode === 'keyed' && this.keyed ? { option: this.keyed.option.name } : {}) };
  }

  async ready(): Promise<void> {
    await this.picked;
    await this.current().ready?.();
  }

  ceiling(request: IDoorRequest, batched: boolean): number {
    return this.current().ceiling(request, batched);
  }

  async ask(request: IDoorRequest): Promise<IDoorOutcome> {
    await this.picked;
    return this.current().ask(request);
  }

  async askStream(request: IDoorRequest, onText: (text: string) => void, signal?: AbortSignal): Promise<IDoorOutcome> {
    await this.picked;
    const provider = this.current();
    if (provider.askStream) return provider.askStream(request, onText, signal);
    return provider.ask(request).then(out => { if (out.status === 'OK' && out.text) onText(out.text); return out; });
  }

  async file(id: string, request: IDoorRequest): Promise<{ status: DoorStatus; batchId?: string; outcome?: IDoorOutcome; reason?: string }> {
    await this.picked;
    return this.current().file(id, request);
  }

  collect(batchId: string): Promise<IDoorOutcome> {
    if (LocalProvider.owns(batchId)) return this.local.collect(batchId);
    if (OpenAICompatibleProvider.owns(batchId)) {
      // Collected on the key it was filed on, whichever key is in use by now
      const filedOn = [...this.held.values()].find(p => p instanceof OpenAICompatibleProvider && p.holds(batchId)) ?? this.keyed;
      return filedOn?.collect(batchId) ?? Promise.resolve({ status: 'OUTAGE', reason: 'That key is no longer held. It stays queued.' });
    }
    // A batch filed on a person's Anthropic key is collected on that key
    if (this.keyed?.option.protocol === 'anthropic') return this.keyed.collect(batchId);
    return this.auto.collect(batchId);
  }
}
