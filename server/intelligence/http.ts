/**
 * The door over HTTP, one handler for the dev server and the standalone server.
 *
 * Like the database door, it answers loopback only until a deploy puts real
 * authentication in front of it (D45): a public route here spends someone's money.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { IntelligenceDoor, type IDoorMessage } from './door';
import { buildCreationRequest, buildRestRequest, buildTalkRequest, buildThemeRequest, WINDOW_REQUESTS } from './prompts';

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

export interface IIntelligenceHandlerOptions { allowRemote?: boolean }

/** `path` is what follows the mount: /status, /talk, /theme, /creation, /rest/file, /rest/collect, /window/file, /window/collect. */
export function createIntelligenceHandler(door: IntelligenceDoor, options: IIntelligenceHandlerOptions = {}) {
  return async (req: IncomingMessage, res: ServerResponse, path: string): Promise<void> => {
    if (!options.allowRemote && !LOOPBACK.has(req.socket.remoteAddress ?? '')) {
      return send(res, 403, { status: 'REFUSED', reason: 'This door answers this machine only. It has no authentication yet.' });
    }
    if (path === '/status') return send(res, 200, await door.status());
    if (req.method !== 'POST') return send(res, 405, { error: 'POST only.' });

    let body: any;
    try {
      body = JSON.parse((await readBody(req)) || '{}');
    } catch {
      return send(res, 400, { status: 'REFUSED', reason: 'That was not JSON.' });
    }

    const conversation = (body.messages ?? []) as IDoorMessage[];
    switch (path) {
      case '/talk':
        return send(res, 200, await door.ask(buildTalkRequest(conversation, body.draft ?? {})));
      case '/theme':
        return send(res, 200, await door.ask(buildThemeRequest(conversation, body.draft ?? {})));
      case '/creation':
        return send(res, 200, await door.ask(buildCreationRequest(body.ask ?? {})));
      case '/rest/file':
        return send(res, 200, await door.fileRest(String(body.id ?? 'rest'), buildRestRequest(body.queue ?? {}, body.theme ?? {})));
      case '/rest/collect':
        return send(res, 200, await door.collectRest(String(body.batchId ?? '')));
      case '/window/file': {
        const build = WINDOW_REQUESTS[String(body.kind)];
        if (!build) return send(res, 200, { status: 'REFUSED', reason: 'A window carries no such ask.' });
        return send(res, 200, await door.fileWindow(String(body.id ?? 'window'), build(body.asks ?? [], body.theme ?? {}), Number(body.spent) || 0));
      }
      case '/window/collect':
        return send(res, 200, await door.collectRest(String(body.batchId ?? '')));
      default:
        return send(res, 404, { error: 'No such door.' });
    }
  };
}
