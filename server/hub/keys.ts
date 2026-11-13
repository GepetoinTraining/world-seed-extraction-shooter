/**
 * THE HUB'S OWN KEY. What the hub states (a character registered, a receipt checked) it signs with
 * this, so anyone holding the hub's public key can check the statement later, without asking the hub.
 * Ed25519, through node:crypto.
 *
 * Where it lives: `WS_HUB_KEY` (the PEM text, from the host's secret store) or `WS_HUB_KEY_FILE`.
 * With neither, one is made for a local test and kept beside the hub's data, which git ignores. A
 * hub whose key changes can no longer stand behind what it signed before, so a deployed hub names one.
 */
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify, KeyObject } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export interface IHubKey {
  /** A short name for this hub, read from its public key. */
  id: string;
  publicKeyPem: string;
  sign(text: string): string;
}

export interface ISignedStatement {
  /** JSON text, exactly as signed. */
  text: string;
  /** Base64. */
  signature: string;
}

function fromPrivate(privateKey: KeyObject): IHubKey {
  const publicKeyPem = createPublicKey(privateKey).export({ type: 'spki', format: 'pem' }).toString();
  const id = `hub_${createHash('sha256').update(publicKeyPem).digest('hex').slice(0, 16)}`;
  return { id, publicKeyPem, sign: text => sign(null, Buffer.from(text, 'utf8'), privateKey).toString('base64') };
}

/**
 * A PEM as a host's settings may have left it. A key pasted into a one-line field loses its line ends: to
 * spaces, to nothing, to the two characters \ and n, or to Windows' own. When its two marker lines and
 * the base64 between them are all there, it is built again from those parts, whatever became of the white
 * space; anything else is handed on as it came, for Node to refuse, and the refusal names the setting,
 * never the text.
 */
export function pemOf(text: string): string {
  const flat = text.trim().replace(/\\r\\n|\\n|\\r/g, '\n');
  const found = /-----BEGIN ([A-Z0-9 ]+?)-----([\s\S]*?)-----END \1-----/.exec(flat);
  if (!found) return flat;
  const body = found[2].replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(body)) return flat;
  return `-----BEGIN ${found[1]}-----\n${body.match(/.{1,64}/g)!.join('\n')}\n-----END ${found[1]}-----\n`;
}

/** From a PKCS#8 PEM, in whatever shape a host's settings left it (`pemOf`), or a fresh one. */
export function makeHubKey(pem?: string): IHubKey {
  if (pem) return fromPrivate(createPrivateKey(pemOf(pem)));
  return fromPrivate(generateKeyPairSync('ed25519').privateKey);
}

/** The key a hub signs with, by the rule in the header. `say` hears where it came from. */
export function hubKeyFrom(env: NodeJS.ProcessEnv, localFile: string, say: (line: string) => void = () => undefined): IHubKey {
  if (env.WS_HUB_KEY?.trim()) return makeHubKey(env.WS_HUB_KEY.trim());
  const file = env.WS_HUB_KEY_FILE?.trim() || localFile;
  if (existsSync(file)) return makeHubKey(readFileSync(file, 'utf8'));
  if (env.WS_HUB_KEY_FILE?.trim()) throw new Error(`WS_HUB_KEY_FILE names ${file}, and there is nothing there.`);
  const { privateKey } = generateKeyPairSync('ed25519');
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(), { mode: 0o600 });
  say(`[HUB] No signing key was named, so one was made for this test at ${file}. A deployed hub sets WS_HUB_KEY.`);
  return fromPrivate(privateKey);
}

export const statementOf = (key: IHubKey, said: Record<string, unknown>): ISignedStatement => {
  const text = JSON.stringify(said);
  return { text, signature: key.sign(text) };
};

/** Anyone can do this with the hub's public key: no hub needed. */
export function verifyStatement(publicKeyPem: string, text: string, signature: string): boolean {
  try {
    return verify(null, Buffer.from(text, 'utf8'), createPublicKey(publicKeyPem), Buffer.from(signature, 'base64'));
  } catch {
    return false;
  }
}
