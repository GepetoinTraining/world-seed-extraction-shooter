/**
 * The Turso stand-in (record-double.ts) as a bar holds it: started on a free port, asked what it saw,
 * told how to misbehave, emptied between bars, and stopped. It speaks what sqld speaks over HTTP with
 * SQLite underneath, so it proves the driver path and the SQL, and nothing of Turso's own limits,
 * timing or rules.
 */
import { spawn, type ChildProcess } from 'node:child_process';

const ROOT = process.cwd();

export interface ISeen { pipelines: number; staged: number; crossings: number; statements: string[] }

export interface IDouble {
  url: string;
  /** A bar's own look at what is stored, past the door under test. Rows as plain values. */
  sql(text: string, args?: unknown[]): Promise<unknown[][]>;
  /** What it was sent since the last time it was asked. */
  seen(): Promise<ISeen>;
  fault(how: Record<string, unknown>): Promise<void>;
  /** A new, empty database in place of the old one. */
  reset(): Promise<void>;
  stop(): Promise<void>;
}

const value = (c: any) => (c.type === 'null' ? null : c.type === 'integer' ? Number(c.value) : c.value);
const arg = (v: unknown) => (v === null ? { type: 'null' } : typeof v === 'number' ? (Number.isInteger(v) ? { type: 'integer', value: String(v) } : { type: 'float', value: v }) : { type: 'text', value: String(v) });

export async function startDouble(options: { token?: string; file?: string } = {}): Promise<IDouble> {
  for (let tries = 0; ; tries++) {
    const port = 20000 + Math.floor(Math.random() * 20000);
    const child: ChildProcess = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', '--import', 'tsx', 'tests/fixtures/record-double.ts', options.file ?? ':memory:', String(port), ...(options.token ? [options.token] : [])], { cwd: ROOT, stdio: ['ignore', 'pipe', 'inherit'] });
    const ready = await new Promise<boolean>(resolve => {
      child.stdout!.on('data', b => { if (String(b).includes('READY')) resolve(true); });
      child.on('exit', () => resolve(false));
    });
    if (!ready) {
      if (tries < 3) continue;
      throw new Error('The Turso stand-in did not start.');
    }
    child.removeAllListeners('exit');
    const url = `http://127.0.0.1:${port}`;
    const post = async (path: string, body: unknown) => (await fetch(`${url}${path}`, { method: 'POST', body: JSON.stringify(body) })).json() as Promise<any>;
    return {
      url,
      sql: async (text, args = []) => (await post('/__sql', { sql: text, args: args.map(arg) })).rows.map((row: any[]) => row.map(value)),
      seen: () => post('/__seen', {}),
      fault: async how => { await post('/__fault', how); },
      reset: async () => { await post('/__reset', {}); },
      stop: () => new Promise<void>(resolve => {
        if (child.exitCode !== null) return resolve();
        child.on('exit', () => resolve());
        child.kill('SIGKILL');
      })
    };
  }
}
