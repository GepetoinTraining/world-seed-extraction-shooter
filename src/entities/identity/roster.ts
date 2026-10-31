/**
 * AVATAR ROSTER (Wave 9.3, D5): several complete owners on one device.
 *
 * Private keys were always stored per identity (IndexedDB, keyed by uid); the
 * only single slot was the certificate in localStorage. The roster keeps every
 * minted or restored certificate beside its archetype, and the old single slot
 * stays as "the active avatar" so everything downstream keeps working.
 */

import { IPlayerCertificate } from './certificateSystem';

const ROSTER_KEY = 'worldseed_avatars';
const ACTIVE_KEY = 'worldseed_certificate'; // the legacy single slot = active avatar

export interface IRosterEntry {
  certificate: IPlayerCertificate;
  archetype: string; // known at mint; legacy entries may carry 'OPERATOR' until first login backfills
  addedAt: number;
}

function readRoster(): IRosterEntry[] {
  try {
    const raw = localStorage.getItem(ROSTER_KEY);
    if (!raw) return [];
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list.filter(e => e?.certificate?.metadata?.uid) : [];
  } catch {
    return [];
  }
}

function writeRoster(entries: IRosterEntry[]) {
  localStorage.setItem(ROSTER_KEY, JSON.stringify(entries));
}

export const AvatarRoster = {
  /** Every avatar on this device. Migrates the legacy single slot in on first read. */
  list(): IRosterEntry[] {
    const roster = readRoster();
    try {
      const legacy = localStorage.getItem(ACTIVE_KEY);
      if (legacy) {
        const cert = JSON.parse(legacy) as IPlayerCertificate;
        if (cert?.metadata?.uid && !roster.some(e => e.certificate.metadata.uid === cert.metadata.uid)) {
          roster.push({ certificate: cert, archetype: 'OPERATOR', addedAt: Date.now() });
          writeRoster(roster);
        }
      }
    } catch { /* an unreadable legacy slot is simply not migrated */ }
    return roster;
  },

  /** Add or update an avatar (minted, restored, or archetype backfilled). */
  remember(certificate: IPlayerCertificate, archetype: string) {
    const roster = readRoster();
    const uid = certificate.metadata.uid;
    const at = roster.findIndex(e => e.certificate.metadata.uid === uid);
    if (at === -1) roster.push({ certificate, archetype, addedAt: Date.now() });
    else roster[at] = { ...roster[at], certificate, archetype };
    writeRoster(roster);
  },

  /** The archetype this device knows for an identity. */
  archetypeOf(uid: string): string | null {
    return readRoster().find(e => e.certificate.metadata.uid === uid)?.archetype ?? null;
  },

  /** Make one avatar the active slot everything downstream reads. */
  setActive(certificate: IPlayerCertificate) {
    localStorage.setItem(ACTIVE_KEY, JSON.stringify(certificate));
  },

  activeUid(): string | null {
    try {
      const raw = localStorage.getItem(ACTIVE_KEY);
      return raw ? (JSON.parse(raw) as IPlayerCertificate).metadata.uid : null;
    } catch {
      return null;
    }
  },

  /** Remove one avatar from the roster (its signed records and keys remain). */
  forget(uid: string) {
    writeRoster(readRoster().filter(e => e.certificate.metadata.uid !== uid));
    if (this.activeUid() === uid) localStorage.removeItem(ACTIVE_KEY);
  }
};
