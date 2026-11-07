/**
 * Which provider stands behind the door on this server. `WS_LLM_PROVIDER=none` turns intelligence
 * off; every door still answers, and the game goes on. `WS_LLM_PROVIDER=local` asks for the local
 * mode outright. Otherwise Claude answers while there is a key, and with none, a model on this
 * machine does (Pedro, Q24: "local model"). `WS_LOCAL_URL` and `WS_LOCAL_MODEL` say which.
 */
import { resolve } from 'node:path';
import { AbsentProvider, IntelligenceDoor, type IIntelligenceProvider } from './door';
import { ClaudeProvider } from './claude';
import { KeyOrLocalProvider, LocalProvider } from './local';
import { localRuntimeFrom } from './localDisk';
import { readDoorOptions } from './optionsFile';
import { HOST } from './machineHost';
import { DoorSetting, SETTINGS } from './setting';

export function chooseProvider(env: NodeJS.ProcessEnv = process.env, local = new LocalProvider(localRuntimeFrom(env))): IIntelligenceProvider {
  if (env.WS_LLM_PROVIDER === 'none') return new AbsentProvider('Intelligence is turned off on this server.');
  if (env.WS_LLM_PROVIDER === 'local') return local;
  try {
    return new KeyOrLocalProvider(new ClaudeProvider(), local);
  } catch {
    return local;
  }
}

/**
 * The key can live in `.env` at this checkout's root: on the server, never in a browser, and
 * git ignores it. A real environment variable wins over the file. One checkout, one file, on
 * purpose: nothing looks further up, so a test session's server never finds a person's key.
 */
export function loadLocalEnv(path = resolve(process.cwd(), '.env'), env: NodeJS.ProcessEnv = process.env): void {
  try {
    process.loadEnvFile(path);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') console.warn(`[DOOR] ${path} could not be read: ${(e as Error).message}`);
  }
  // Left blank it means nothing, and a blank key would hide an `ant auth login` profile.
  if (!env.ANTHROPIC_API_KEY?.trim()) delete env.ANTHROPIC_API_KEY;
}

export const openDoor = (env: NodeJS.ProcessEnv = process.env) => {
  if (env === process.env) loadLocalEnv();
  const options = readDoorOptions();
  // The model is the person's; until they pick, the setting takes the one suggested for this machine
  const local = new LocalProvider(localRuntimeFrom(env, { url: options.local?.url }));
  const setting = new DoorSetting(chooseProvider(env, local), local, options, HOST, env.WS_LLM_PROVIDER === 'none');
  if (env.WS_LLM_PROVIDER === 'local') setting.useLocal();
  const door = new IntelligenceDoor(setting);
  SETTINGS.set(door, setting);
  return door;
};

export { createIntelligenceHandler } from './http';
