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

/** From a PKCS#8 PEM, or a fresh one. */
export function makeHubKey(pem?: string): IHubKey {
  if (pem) return fromPrivate(createPrivateKey(pem));
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
