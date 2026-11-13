/**
 * A HUB'S SIGNING KEY, MADE IN ITS OWNER'S OWN TERMINAL (DEPLOY.md, "Putting it on Vercel"). Ed25519,
 * PKCS#8 PEM, printed here to be pasted into the host's secret store as WS_HUB_KEY. It is written to
 * no file: once this terminal is closed, the key is only where it was pasted.
 *
 *   npm run hub:key
 *
 * It also prints a fresh text for CRON_SECRET, the word the host's scheduled call carries, in
 * letters and digits only, as a header needs.
 */
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { makeHubKey } from '../server/hub/keys';

const pem = generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }).toString().trim();
const { id } = makeHubKey(pem);

console.log([
  '',
  'A new signing key for a hub. Paste all of it, the BEGIN and END lines included, into the host\'s',
  'setting WS_HUB_KEY, as a Secret. Nothing was written to any file.',
  '',
  pem,
  '',
  `Once it is in place and the site is deployed again, /api/hub/health names this hub ${id}.`,
  'Keep the key: a hub whose key changes can no longer stand behind what it signed before.',
  '',
  'If the scheduled call has no secret yet, here is a fresh one for CRON_SECRET:',
  '',
  randomBytes(32).toString('hex'),
  ''
].join('\n'));
