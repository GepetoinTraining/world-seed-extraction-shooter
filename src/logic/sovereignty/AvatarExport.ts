/**
 * AVATAR EXPORT / IMPORT (Wave 6.1)
 *
 * "Own your avatar" made literal: one content-addressed file holds the whole
 * sovereign self —
 *   - the birth certificate (public),
 *   - the private key, encrypted under a passphrase (PBKDF2 + AES-GCM),
 *   - the signed player doc (the bank),
 *   - the signed ledger chain (the history).
 *
 * Primordial's .seed format shape: magic, version, digest over the canonical
 * body. Import recomputes the digest, decrypts the key, verifies the player
 * doc against the certificate, audits the ledger chain, and only then writes.
 * A file that fails any check is refused whole.
 */

import { IPlayer } from '../../../types';
import { CertificateSystem, IPlayerCertificate, ISignedPayload } from '../../entities/identity/certificateSystem';
import { VectorStore, VectorNamespace } from '../../entities/data/VectorStore';
import { Ledger, ILedgerRow } from '../ledger/Ledger';
import { sha256Hex } from '../journal/SessionJournal';

const MAGIC = 'WSAV';
const VERSION = 1;

interface IEncryptedKey { salt: number[]; iv: number[]; data: number[] }

export interface IAvatarExportFile {
  magic: typeof MAGIC;
  version: number;
  exportedAt: number;
  digest: string; // sha256 of JSON.stringify(body)
  body: {
    certificate: IPlayerCertificate;
    encryptedPrivateKey: IEncryptedKey;
    playerDoc: ISignedPayload<IPlayer> | null;
    ledger: ISignedPayload<ILedgerRow>[];
  };
}

async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: 100000, hash: 'SHA-256' },
    material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
  );
}

export class AvatarExport {

  /** Gather, encrypt, seal. Returns the file and its content-addressed name. */
  static async exportAvatar(password: string): Promise<{ blob: Blob; filename: string; digest: string } | null> {
    const stored = localStorage.getItem('worldseed_certificate');
    if (!stored) return null;
    const certificate = JSON.parse(stored) as IPlayerCertificate;
    const uid = certificate.metadata.uid;

    // The private key was generated extractable — pull and re-encrypt it
    const privateKey = await CertificateSystem.getPrivateKey(uid);
    if (!privateKey) {
      console.error('[EXPORT] Private key unavailable.');
      return null;
    }
    const jwk = await crypto.subtle.exportKey('jwk', privateKey);

    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const aes = await deriveKey(password, salt);
    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: iv as BufferSource }, aes, new TextEncoder().encode(JSON.stringify(jwk))
    );

    const playerDoc = await VectorStore.get<ISignedPayload<IPlayer>>(VectorNamespace.CHARACTERS, uid);
    const ledger = await Ledger.list(uid);

    const body: IAvatarExportFile['body'] = {
      certificate,
      encryptedPrivateKey: {
        salt: Array.from(salt),
        iv: Array.from(iv),
        data: Array.from(new Uint8Array(encrypted))
      },
      playerDoc: playerDoc?.data ?? null,
      ledger
    };

    const digest = await sha256Hex(JSON.stringify(body));
    const file: IAvatarExportFile = { magic: MAGIC, version: VERSION, exportedAt: Date.now(), digest, body };

    console.log(`[EXPORT] Avatar sealed: ${digest.slice(0, 16)}… (${ledger.length} ledger rows)`);
    return {
      blob: new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' }),
      filename: `wsav_${digest.slice(0, 16)}.json`,
      digest
    };
  }

  /**
   * Verify everything, then reconstruct the identity on this machine.
   * Refuses on: bad magic/version, digest mismatch, wrong passphrase,
   * player doc signature failure, or a broken ledger chain.
   */
  static async importAvatar(fileContent: string, password: string): Promise<{ ok: boolean; reason?: string; username?: string }> {
    let file: IAvatarExportFile;
    try {
      file = JSON.parse(fileContent);
    } catch {
      return { ok: false, reason: 'not a valid file' };
    }

    if (file.magic !== MAGIC || file.version !== VERSION) return { ok: false, reason: 'wrong magic/version' };

    // 1. Content address must hold
    const digest = await sha256Hex(JSON.stringify(file.body));
    if (digest !== file.digest) return { ok: false, reason: 'digest mismatch — file altered' };

    const { certificate, encryptedPrivateKey, playerDoc, ledger } = file.body;
    const uid = certificate.metadata.uid;

    // 2. Decrypt the private key under the passphrase
    let privateKey: CryptoKey;
    try {
      const aes = await deriveKey(password, new Uint8Array(encryptedPrivateKey.salt));
      const decrypted = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: new Uint8Array(encryptedPrivateKey.iv) as BufferSource },
        aes,
        new Uint8Array(encryptedPrivateKey.data)
      );
      const jwk = JSON.parse(new TextDecoder().decode(decrypted));
      privateKey = await crypto.subtle.importKey(
        'jwk', jwk,
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
        true, ['sign']
      );
    } catch {
      return { ok: false, reason: 'wrong passphrase' };
    }

    // 3. The player doc must verify against the certificate
    if (playerDoc) {
      const valid = await CertificateSystem.verifyPayload(playerDoc, certificate);
      if (!valid) return { ok: false, reason: 'player doc signature invalid' };
    }

    // 4. The ledger chain must be whole and signed
    let expectedSeq = 1;
    for (const row of ledger) {
      const valid = await CertificateSystem.verifyPayload(row, certificate);
      if (!valid || row.payload.seq !== expectedSeq) {
        return { ok: false, reason: `ledger chain broken at seq ${expectedSeq}` };
      }
      expectedSeq++;
    }

    // 5. Everything proved — write the sovereign self onto this machine
    await CertificateSystem.storePrivateKey(uid, privateKey);
    localStorage.setItem('worldseed_certificate', JSON.stringify(certificate));

    if (playerDoc) {
      await VectorStore.put({
        id: uid,
        namespace: VectorNamespace.CHARACTERS,
        data: playerDoc,
        metadata: { createdAt: certificate.metadata.createdAt, updatedAt: Date.now(), ownerCertUid: uid, signature: playerDoc.signature, version: 1 }
      });
    }
    for (const row of ledger) {
      await VectorStore.put({
        id: `ledger_${uid}_${row.payload.seq.toString().padStart(8, '0')}`,
        namespace: VectorNamespace.TRANSACTIONS,
        data: row,
        metadata: { createdAt: row.payload.ts, updatedAt: row.payload.ts, ownerCertUid: uid, signature: row.signature, version: 1 }
      });
    }
    if (ledger.length > 0) {
      await VectorStore.put({
        id: `ledger_head_${uid}`,
        namespace: VectorNamespace.TRANSACTIONS,
        data: { seq: ledger.length },
        metadata: { createdAt: Date.now(), updatedAt: Date.now(), ownerCertUid: uid, version: 1 }
      });
    }

    console.log(`[IMPORT] Avatar restored: ${certificate.metadata.displayName} (${ledger.length} ledger rows, all verified).`);
    return { ok: true, username: certificate.metadata.displayName };
  }
}
