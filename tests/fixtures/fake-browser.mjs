/**
 * Stands in for a Chromium browser in the bars (tests/database.window.test.ts). It takes the flags a real one
 * is given, asks the address for the game's store as a window's page would, writes down what it saw into its
 * profile folder, stays open for FAKE_BROWSER_STAYS_MS, and closes.
 *
 * Started as `node tests/fixtures/fake-browser.mjs --app=… --user-data-dir=…`: WS_BROWSER names node, and
 * WS_WINDOW_ARGS, whose flags come first, names this file.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const flag = name => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const address = flag('app');
const profile = flag('user-data-dir');
const stays = Number(process.env.FAKE_BROWSER_STAYS_MS ?? 0);
const opened = Date.now();

let health = null;
while (stays > 0 && Date.now() - opened < stays - 500) {
  try {
    health = (await fetch(`${address}/api/db/health`)).status;
    if (health === 200) break;
  } catch (e) {
    health = String(e?.cause?.code ?? e?.message ?? e);
  }
  await new Promise(r => setTimeout(r, 100));
}

mkdirSync(profile, { recursive: true });
writeFileSync(join(profile, 'fake-browser.json'), JSON.stringify({ address, profile, health, flags: process.argv.slice(2) }));
setTimeout(() => process.exit(0), Math.max(0, stays - (Date.now() - opened)));
