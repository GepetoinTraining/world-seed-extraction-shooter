/**
 * THE PERSON'S CHOICE OF VOICE, behind the one door (memory: intelligence goes through one server
 * door). It is the provider the door holds, and it routes to whichever the person chose:
 *
 *   auto    the server's own key while there is one, the local model while there is none (Q24)
 *   local   the local model, the person's mode, whichever served model they picked
 *   keyed   a free option on the person's own key (`door-options.json`)
 *   off     nothing: every door still answers, and the game goes on
 *
 * Work filed under one choice is collected from the same provider, whatever the person picked since.
 */
import type { DoorStatus, IDoorOutcome, IDoorRequest, IIntelligenceDoorLike, IIntelligenceProvider, IProviderStatus } from './door';
import { LocalProvider } from './local';
import { MachineCheck, type IHost } from './machine';
import { IDoorOptions, OpenAICompatibleProvider, providerFor } from './options';

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
  private keyed?: OpenAICompatibleProvider;

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

  /** A free option on the person's key. The key is kept here, in memory, and nowhere else. */
  async useKey(optionId: string, key: string): Promise<{ ok: boolean; reason?: string; status?: IDoorSettingStatus }> {
    const option = this.options.keyed.find(o => o.id === optionId);
    if (!option) return { ok: false, reason: 'No such option is offered.' };
    if (!key.trim()) return { ok: false, reason: 'That key is empty.' };
    const made = providerFor(option, key.trim());
    if (!(made instanceof OpenAICompatibleProvider)) return { ok: false, reason: made.reason };
    const status = await made.status();
    if (!status.available) return { ok: false, reason: status.reason };
    this.keyed = made;
    this.mode = 'keyed';
    return { ok: true, status: await this.status() };
  }

  /** Back to the server's own way. The key is dropped. */
  useAuto(): void {
    this.keyed = undefined;
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
    if (OpenAICompatibleProvider.owns(batchId)) return this.keyed?.collect(batchId) ?? Promise.resolve({ status: 'OUTAGE', reason: 'That key is no longer held. It stays queued.' });
    return this.auto.collect(batchId);
  }
}
