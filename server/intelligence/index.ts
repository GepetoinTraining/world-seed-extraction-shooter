/**
 * Which provider stands behind the door on this server. `WS_LLM_PROVIDER=none`
 * turns intelligence off; every door still answers, and the game goes on.
 */
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

export const openDoor = () => new IntelligenceDoor(chooseProvider());

export { createIntelligenceHandler } from './http';
