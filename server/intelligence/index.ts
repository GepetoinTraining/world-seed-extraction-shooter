/**
 * Which provider stands behind the door on this server. `WS_LLM_PROVIDER=none`
 * turns intelligence off; every door still answers, and the game goes on.
 */
import { resolve } from 'node:path';
import { AbsentProvider, IntelligenceDoor, type IIntelligenceProvider } from './door';
import { ClaudeProvider } from './claude';

export function chooseProvider(env: NodeJS.ProcessEnv = process.env): IIntelligenceProvider {
  if (env.WS_LLM_PROVIDER === 'none') return new AbsentProvider('Intelligence is turned off on this server.');
  try {
    return new ClaudeProvider();
  } catch (e) {
    return new AbsentProvider(e instanceof Error ? e.message : 'The provider did not start.');
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

export const openDoor = () => {
  loadLocalEnv();
  return new IntelligenceDoor(chooseProvider());
};

export { createIntelligenceHandler } from './http';
