/**
 * THE CLOCK, on the runner (D135, DEPLOY.md): what time the game is, for the browser beside it.
 *
 * With a hub, it is the hub's time: read from the hub's signed statement, then counted forward on
 * this process's steady counter, which changing the machine's clock does not move, and read again
 * every so often. With no hub, or none answering, it is this machine's own time, and says so.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { hubUrlProblem } from './runner';

const REFRESH_MS = 10 * 60_000;
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

export interface IClockDoorOptions {
  hubUrl?: string;
  /** Milliseconds on a counter the wall clock does not move. A test seam. */
  monotonic?: () => number;
  allowRemote?: boolean;
}

const steady = () => Number(process.hrtime.bigint() / 1_000_000n);

export function createClockDoor(options: IClockDoorOptions) {
  const hubUrl = options.hubUrl?.trim().replace(/\/+$/, '') || undefined;
  const usable = hubUrl && !hubUrlProblem(hubUrl) ? hubUrl : undefined;
  const monotonic = options.monotonic ?? steady;
  let anchor: { at: number; mono: number; hub: string } | null = null;
  let reason = usable ? '' : 'No hub is set, so this is this machine\'s time.';

  const fromHub = async () => {
    if (!usable) return null;
    if (anchor && monotonic() - anchor.mono < REFRESH_MS) return anchor;
    try {
      const said: any = await (await fetch(`${usable}/api/hub/clock`, { signal: AbortSignal.timeout(5_000) })).json();
      const stated = JSON.parse(said?.statement?.text ?? 'null');
      if (said?.ok && Number.isFinite(stated?.at)) {
        anchor = { at: stated.at, mono: monotonic(), hub: String(stated.hub ?? '') };
        reason = '';
      }
    } catch (e) {
      reason = `The hub's clock cannot be read (${e instanceof Error ? e.message : String(e)}), so this is this machine's time.`;
    }
    return anchor;
  };

  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    if (!options.allowRemote && !LOOPBACK.has(req.socket.remoteAddress ?? '')) {
      res.statusCode = 403;
      res.end(JSON.stringify({ ok: false, reason: 'This game answers this machine only.' }));
      return;
    }
    const held = await fromHub();
    res.statusCode = 200;
    res.end(JSON.stringify(held
      ? { ok: true, now: held.at + (monotonic() - held.mono), source: 'hub', hub: held.hub }
      : { ok: true, now: Date.now(), source: 'machine', ...(reason ? { reason } : {}) }));
  };
}
