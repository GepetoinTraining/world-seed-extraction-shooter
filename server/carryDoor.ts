/**
 * The carry tool, run from the vault's button. Still a person's act and still once: the
 * tool is the same one a person runs by hand, in its own process, with its own refusals,
 * and it takes only the two paths the store itself named. Nothing here takes a path from
 * a request.
 */
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

let carrying: Promise<{ ok: boolean; lines: string[] }> | null = null;

export function carryOldSave(oldFile: string, folder: string): Promise<{ ok: boolean; lines: string[] }> {
  carrying ??= new Promise<{ ok: boolean; lines: string[] }>(done => {
    const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', '--import', 'tsx', resolve(root, 'scripts/carry-save.ts'), oldFile, folder], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', chunk => { out += chunk; });
    child.stderr.on('data', chunk => { out += chunk; });
    const finish = () => {
      const lines = out.split(/\r?\n/).filter(Boolean);
      done({ ok: lines.some(l => l.startsWith('CARRIED: ')), lines });
    };
    child.on('close', finish);
    child.on('error', e => { out += `\nNOT CARRIED: ${e.message}`; finish(); });
  }).finally(() => { carrying = null; });
  return carrying;
}
