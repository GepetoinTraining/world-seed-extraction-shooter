/**
 * THE DOOR IN THE PAGE (Pedro, 2026-11-04: "their IDB makes the call, not our Turso or postgress").
 * Played from the domain, the game holds its own door: the server's door (server/intelligence),
 * the same routes and the same shapes, and the same law over what comes back. It asks a model on
 * the player's machine (Ollama at 127.0.0.1, once the player has allowed this origin), or a
 * provider on the player's own key, straight from the page. Our servers make no model call and
 * carry none.
 *
 * With no key and no local model it is the local mode's honest OFFLINE, and the game plays on.
 * The page cannot read the machine's card or memory; the check says what Ollama and the browser
 * report and leaves the rest unknown.
 */
import doorOptions from '../../../shared/intelligence/door-options.json';
import { IntelligenceDoor } from '../../../shared/intelligence/door';
import { LocalProvider, OllamaRuntime } from '../../../shared/intelligence/local';
import { parseDoorOptions, type IDoorOptions } from '../../../shared/intelligence/options';
import { DoorSetting, SETTINGS } from '../../../shared/intelligence/setting';
import { NO_HOST, type IHost } from '../../../shared/intelligence/machine';
import { routeDoor, type DoorAnswer } from '../../../shared/intelligence/routes';

/** What a browser can say about the machine: nothing a seat can be judged on (no card, and no free memory), so all of it stays unknown. */
export const BROWSER_HOST: IHost = NO_HOST;

export interface IPageDoorOptions {
  /** Where the local runtime answers; Ollama's own address by default. */
  localUrl?: string;
  /** The player's chosen model, until the check suggests one. */
  localModel?: string;
  /** The offer; the bundled `door-options.json` by default. */
  options?: Partial<IDoorOptions>;
  host?: IHost;
}

export interface IPageDoor {
  door: IntelligenceDoor;
  setting: DoorSetting;
  answer(method: string, path: string, body: unknown): Promise<DoorAnswer>;
}

export function openPageDoor(o: IPageDoorOptions = {}): IPageDoor {
  const options = parseDoorOptions((o.options ?? doorOptions) as Partial<IDoorOptions>);
  const runtime = new OllamaRuntime(o.localUrl ?? options.local?.url ?? 'http://127.0.0.1:11434', o.localModel ?? '', async () => false);
  const local = new LocalProvider(runtime);
  // No key of the game's own in a page: its own way is the player's machine
  const setting = new DoorSetting(local, local, options, o.host ?? BROWSER_HOST);
  const door = new IntelligenceDoor(setting);
  SETTINGS.set(door, setting);
  return { door, setting, answer: (method, path, body) => routeDoor(door, method, path, body ?? {}, setting) };
}
