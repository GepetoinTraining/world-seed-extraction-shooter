/**
 * The hub, for a host that runs a file under api/ (Vercel's layout). It hands the host a Node
 * server, so the same function answers plain requests and takes the socket's upgrade. Everything it
 * does is in app.ts; `npm run hub` and `npm run hosted` run the same thing locally.
 *
 * The host does not run this file as it is written. It compiles each file alone and runs the result
 * as plain Node, which finds an import only when its address is written whole, and nothing under
 * `server/` or `shared/` writes one that way. So this file and all it reaches are built into ONE
 * file first (`scripts/build-hub.ts`, to `dist-hub/hub.mjs`), and `api/hub.js` hands that to the
 * host. Every address under /api/hub reaches it (vercel.json).
 */
import { createServer } from 'node:http';
import { createHubApp, hubAppConfigFrom } from './app';

const app = createHubApp(hubAppConfigFrom(process.env));

const server = createServer((req, res) => void app.handle(req, res));
server.on('upgrade', (req, raw) => app.upgrade(req, raw));

export default server;
