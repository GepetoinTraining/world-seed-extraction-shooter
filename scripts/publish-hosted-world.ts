/**
 * Publish a world as the world we host (server/hub/hosted.ts), from a game's own store: its
 * certificate and the theme it is pinned to, read as the game wrote them.
 *
 *   npm run hosted:publish -- <game database url> <worldUid>
 *
 * The hosted hub's store is WS_HUB_DATABASE_URL (default data/hosted-test). Stop the game's server
 * first: one process holds a database folder at a time, and the lock says so.
 */
import { join, resolve } from 'node:path';
import { openStore } from '../server/openStore';
import { folderUrl } from '../server/connection';
import { Hub } from '../server/hub/Hub';
import { HostedWorld } from '../server/hub/hosted';
import { hubKeyFrom } from '../server/hub/keys';

const [gameUrl, worldUid] = process.argv.slice(2);
if (!gameUrl || !worldUid) {
  console.error('Usage: npm run hosted:publish -- <game database url> <worldUid>');
  process.exit(1);
}
const root = resolve(import.meta.dirname, '..');
const game = await openStore(gameUrl);
try {
  const certDoc = await game.get(worldUid);
  const cert = certDoc && JSON.parse(certDoc.dataText).content;
  if (!cert?.data?.worldUid) throw new Error(`No world ${worldUid} in ${gameUrl}.`);
  const themeId = cert.data.rules?.themeId;
  const themeDoc = themeId ? await game.get(themeId) : null;
  const pack = themeDoc && JSON.parse(themeDoc.dataText).content;
  if (!pack?.themeId) throw new Error(`The theme ${themeId} that ${worldUid} is pinned to is not in ${gameUrl}.`);

  const hostedStore = await openStore(process.env.WS_HUB_DATABASE_URL ?? folderUrl(join(root, 'data', 'hosted-test')));
  try {
    const key = hubKeyFrom(process.env, join(root, 'data', 'hosted-key.pem'), line => console.log(line));
    const hub = new Hub(hostedStore, key, { publicUrl: process.env.WS_PUBLIC_URL ?? 'http://127.0.0.1:3960' });
    await new HostedWorld(hub).publish({ world: { worldUid, name: cert.data.worldName, creatorCertUid: cert.data.creatorCertUid, themeId }, certificate: cert, themes: [pack] });
    console.log(`[HOSTED] Published ${cert.data.worldName} (${worldUid}) on theme ${themeId}.`);
  } finally {
    await hostedStore.close();
  }
} finally {
  await game.close();
}
