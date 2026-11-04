/**
 * The door over HTTP, one handler for the dev server and the standalone server.
 *
 * Like the database door, it answers loopback only until a deploy puts real
 * authentication in front of it (D45): a public route here spends someone's money.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { IntelligenceDoor } from './door';
import type { DoorSetting } from './setting';
import { routeDoor } from './routes';

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

function send(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

export interface IIntelligenceHandlerOptions {
  allowRemote?: boolean;
  /** The person's choice of voice. Without it, the routes that change it answer that nothing can be changed here. */
  setting?: DoorSetting;
}

/** `path` is what follows the mount: /status, /talk, /theme, /world/pass, /creation, /chain, /kami/persona, /kami/talk, /kami/set, /npc/talk, /npc/goal, /npc/bargain, /rest/file, /rest/collect, /window/file, /window/collect. */
export function createIntelligenceHandler(door: IntelligenceDoor, options: IIntelligenceHandlerOptions = {}) {
  return async (req: IncomingMessage, res: ServerResponse, path: string): Promise<void> => {
    if (!options.allowRemote && !LOOPBACK.has(req.socket.remoteAddress ?? '')) {
      return send(res, 403, { status: 'REFUSED', reason: 'This door answers this machine only. It has no authentication yet.' });
    }
    let body: any = {};
    if (req.method === 'POST') {
      try {
        body = JSON.parse((await readBody(req)) || '{}');
      } catch {
        return send(res, 400, { status: 'REFUSED', reason: 'That was not JSON.' });
      }
    }
    const answer = await routeDoor(door, req.method ?? 'GET', path, body, options.setting);
    if (!answer.stream) return send(res, answer.status, answer.json);
    res.statusCode = answer.status;
    res.setHeader('Content-Type', 'application/x-ndjson');
    res.setHeader('Cache-Control', 'no-store');
    const gone = new AbortController();
    res.on('close', () => gone.abort());
    res.end(await answer.stream(line => res.write(line), gone.signal));
  };
}
