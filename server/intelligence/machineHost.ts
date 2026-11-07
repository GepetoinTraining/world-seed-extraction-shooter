/**
 * The machine itself, read on the machine (Node): the graphics card and the memory, the ways each
 * system allows. Apart from machine.ts so that a page, which runs the same check on what Ollama and
 * the browser report, never bundles it.
 */
import { execFile } from 'node:child_process';
import { freemem, platform, totalmem, arch } from 'node:os';
import type { IHost } from '../../shared/intelligence/machine';

const run = (file: string, args: string[]) => new Promise<string>(resolve => {
  execFile(file, args, { timeout: 4000, windowsHide: true }, (err, stdout) => resolve(err ? '' : String(stdout)));
});

/** The machine itself, read the ways each system allows. Whatever cannot be read stays unknown. */
export const HOST: IHost = {
  async cards() {
    // NVIDIA says exactly, on every system that has its tool
    const nvidia = await run('nvidia-smi', ['--query-gpu=name,memory.total', '--format=csv,noheader,nounits']);
    const exact = nvidia.split(/\r?\n/).map(l => l.split(',').map(p => p.trim())).filter(p => p[0] && Number(p[1]) > 0)
      .map(([name, mib]) => ({ name, bytes: Number(mib) * 1024 * 1024, measure: 'exact' as const }));
    if (exact.length > 0) return exact;
    if (platform() === 'darwin' && arch() === 'arm64') {
      // Apple's chips share one memory between the card and everything else
      return [{ name: 'Apple silicon', bytes: totalmem(), measure: 'shared' }];
    }
    if (platform() === 'win32') {
      const out = await run('powershell', ['-NoProfile', '-Command', 'Get-CimInstance Win32_VideoController | ForEach-Object { "$($_.Name)|$($_.AdapterRAM)" }']);
      // Windows reports at most 4 GB here, whatever the card holds
      return out.split(/\r?\n/).map(l => l.trim().split('|')).filter(p => p[0])
        .map(([name, ram]) => (Number(ram) > 0 ? { name, bytes: Number(ram), measure: 'at least' as const } : { name, measure: 'at least' as const }));
    }
    return [];
  },
  memory: () => ({ total: totalmem(), free: freemem() })
};

