/**
 * THE LOCAL MODEL ON THIS SERVER'S DISK. Node only: it reads the environment and looks for the
 * runtime's program where it is usually installed. The shared door (local.ts) takes it as a port.
 */
import { access } from 'node:fs/promises';
import { delimiter, join } from 'node:path';
import { OllamaRuntime, type ILocalRuntime } from '../../shared/intelligence/local';

/** Is Ollama on this machine, running or not? Its usual places, then the PATH. */
export async function ollamaOnDisk(): Promise<boolean> {
  const exe = process.platform === 'win32' ? 'ollama.exe' : 'ollama';
  const places = [
    ...(process.env.LOCALAPPDATA ? [join(process.env.LOCALAPPDATA, 'Programs', 'Ollama', exe)] : []),
    ...(process.platform === 'darwin' ? ['/Applications/Ollama.app'] : []),
    ...(process.env.PATH ?? '').split(delimiter).filter(Boolean).map(dir => join(dir, exe))
  ];
  for (const place of places) {
    try { await access(place); return true; } catch { /* not here */ }
  }
  return false;
}

/**
 * Where the local model is and which one. The model is the person's setting; until they pick,
 * it is the suggestion in the door's options (data, not code), or WS_LOCAL_MODEL.
 */
export function localRuntimeFrom(env: NodeJS.ProcessEnv = process.env, from?: { url?: string }): ILocalRuntime {
  return new OllamaRuntime(env.WS_LOCAL_URL?.trim() || from?.url || 'http://127.0.0.1:11434', env.WS_LOCAL_MODEL?.trim() || '', ollamaOnDisk);
}
