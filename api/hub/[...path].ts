/**
 * The hub's one function, for a host that runs a file under api/ per request (Vercel's layout).
 * Everything it does is in server/hub/function.ts; `npm run hub` runs the same function locally.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createHubFunction, hubConfigFrom, hubPathOf } from '../../server/hub/function';

const hub = createHubFunction(hubConfigFrom(process.env));

export default function handler(req: IncomingMessage, res: ServerResponse) {
  return hub(req, res, hubPathOf(req.url));
}
