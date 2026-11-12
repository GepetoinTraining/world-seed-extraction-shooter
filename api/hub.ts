/**
 * The hub, for a host that runs a file under api/ (Vercel's layout). It hands the host a Node
 * server, so the same function answers plain requests and takes the socket's upgrade. Everything it
 * does is in server/hub/app.ts; `npm run hub` and `npm run hosted` run the same thing locally.
 * Every address under /api/hub reaches this file (vercel.json).
 */
import { createServer } from 'node:http';
import { createHubApp, hubAppConfigFrom } from '../server/hub/app';

const app = createHubApp(hubAppConfigFrom(process.env));

const server = createServer((req, res) => void app.handle(req, res));
server.on('upgrade', (req, raw) => app.upgrade(req, raw));

export default server;
