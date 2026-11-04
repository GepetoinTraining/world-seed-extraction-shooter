// @vitest-environment node
/**
 * SETTING UP A MODEL ON THE PLAYER'S MACHINE: the prompt for their own coding agent, and the plain
 * scripts. Nothing is installed or run here: the scripts are parsed by their own shells' parsers,
 * which read them without running a line.
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { originProblem, setupPrompt, systemOf, unixScript, windowsScript } from '../src/logic/intelligence/LocalSetup';

const ASK = { origin: 'https://play.example', model: 'gemma4:e4b-it-qat' };

describe('the origin Ollama is told to answer', () => {
  it('is one exact address: never a wildcard, a list, a path, or a public page over plain http', () => {
    expect(originProblem('https://play.example')).toBeNull();
    expect(originProblem('http://127.0.0.1:3950')).toBeNull();
    for (const bad of ['*', 'https://*', 'https://a.example,https://b.example', 'https://play.example/play/', 'http://play.example', 'not an origin', '']) {
      expect(originProblem(bad), bad).toBeTruthy();
    }
    expect(() => setupPrompt({ ...ASK, origin: '*' })).toThrow();
    expect(() => windowsScript({ ...ASK, model: 'gemma; rm -rf /' })).toThrow();
  });
});

describe('the prompt for the player\'s own coding agent', () => {
  it('names this game\'s origin exactly, the suggested model, and asks to be shown before anything runs', () => {
    const prompt = setupPrompt(ASK);
    expect(prompt).toContain('`https://play.example`');
    expect(prompt).toContain('ollama pull gemma4:e4b-it-qat');
    expect(prompt).toMatch(/never `\*`/);
    expect(prompt).toMatch(/show me each command before you run it/);
    expect(prompt).toMatch(/press TRY/);
    expect(prompt).toMatch(/Do not change anything else/);
  });
});

describe('the plain scripts', () => {
  it('carry the origin and the model, refuse a wildcard, and keep origins already set', () => {
    for (const script of [windowsScript(ASK), unixScript(ASK)]) {
      expect(script).toContain('https://play.example');
      expect(script).toContain('gemma4:e4b-it-qat');
      expect(script).toMatch(/never a wildcard/);
      expect(script).toMatch(/Read it before you run it/);
    }
    expect(windowsScript(ASK)).toMatch(/Where-Object \{ \$_ -and \$_ -ne '\*' \}/);
    expect(unixScript(ASK)).toMatch(/grep -v -e '\^\$' -e '\^\\\*\$'/);
  });

  it('read as their own shells read them, without running a line', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ws-setup-'));
    try {
      const sh = join(dir, 'local-model.sh');
      writeFileSync(sh, unixScript(ASK));
      execFileSync('sh', ['-n', sh]);
      const ps1 = join(dir, 'local-model.ps1');
      writeFileSync(ps1, windowsScript(ASK));
      const parse = `$e=$null; [void][System.Management.Automation.Language.Parser]::ParseFile('${ps1.replace(/'/g, "''")}', [ref]$null, [ref]$e); if ($e.Count) { $e | ForEach-Object { $_.Message }; exit 1 }`;
      execFileSync(process.platform === 'win32' ? 'powershell' : 'pwsh', ['-NoProfile', '-NonInteractive', '-Command', parse]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('the page offers the system the browser says it is on first', () => {
    expect(systemOf('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe('windows');
    expect(systemOf('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)')).toBe('macos');
    expect(systemOf('Mozilla/5.0 (X11; Linux x86_64)')).toBe('linux');
  });
});
