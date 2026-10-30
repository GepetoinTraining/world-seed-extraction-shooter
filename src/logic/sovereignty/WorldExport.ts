/**
 * WORLD CERT EXPORT / IMPORT (Wave 6.3)
 *
 * A world cert + its seed hash fully determines a world (deterministic
 * generation, pinned by goldens), so sharing a world = sharing its cert.
 * Digest-checked transport; the creator's signature travels inside the cert.
 *
 * DEBT (handover): verifying a FOREIGN creator's signature needs their
 * public key embedded or a cert registry — today the local player's own
 * certs verify, others import on digest integrity alone.
 */

import { VectorStore } from '../../entities/data/VectorStore';
import { IWorldCertificate } from '../../entities/world/WorldCertificate';
import { sha256Hex } from '../journal/SessionJournal';

const MAGIC = 'WSWC';
const VERSION = 1;

export interface IWorldExportFile {
  magic: typeof MAGIC;
  version: number;
  exportedAt: number;
  digest: string;
  cert: IWorldCertificate;
}

export class WorldExport {

  static async exportWorld(worldUid: string): Promise<{ blob: Blob; filename: string } | null> {
    const certs = await VectorStore.searchContent<IWorldCertificate>('world_certificate');
    const cert = certs.find(c => c.data.worldUid === worldUid);
    if (!cert) return null;

    const digest = await sha256Hex(JSON.stringify(cert));
    const file: IWorldExportFile = { magic: MAGIC, version: VERSION, exportedAt: Date.now(), digest, cert };
    console.log(`[WORLD] Exported "${cert.data.worldName}" (${digest.slice(0, 12)}…)`);
    return {
      blob: new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' }),
      filename: `wswc_${digest.slice(0, 16)}.json`
    };
  }

  static async importWorld(fileContent: string): Promise<{ ok: boolean; reason?: string; worldName?: string }> {
    let file: IWorldExportFile;
    try {
      file = JSON.parse(fileContent);
    } catch {
      return { ok: false, reason: 'not a valid file' };
    }
    if (file.magic !== MAGIC || file.version !== VERSION) return { ok: false, reason: 'wrong magic/version' };

    const digest = await sha256Hex(JSON.stringify(file.cert));
    if (digest !== file.digest) return { ok: false, reason: 'digest mismatch — file altered' };

    await VectorStore.saveContent(
      file.cert.data.worldUid,
      'world_certificate',
      file.cert,
      file.cert.data.worldType
    );
    console.log(`[WORLD] Imported "${file.cert.data.worldName}" — same seed, same world, everywhere.`);
    return { ok: true, worldName: file.cert.data.worldName };
  }
}
