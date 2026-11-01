/**
 * THE HOME HUB (D31): which hub is whose, now that all hubs share one database.
 *
 * Each browser origin used to be its own little universe, with its own "New
 * Carleon" and its own lots. They arrive in one database as separate hubs, since
 * two owners on one lot cannot merge. So an avatar keeps a pin to its own hub and
 * does not see the hubs other avatars call home. A hub someone minted on purpose
 * is nobody's home and stays on every list.
 *
 * A new avatar has no home yet. It may not move into a hub the import brought in,
 * which belongs to that origin's avatars, but every new avatar finds the same
 * common hub, so a second identity still trades with the first.
 */

import { VectorStore, VectorNamespace } from '../../entities/data/VectorStore';

const PREFIX = 'home_hub_';

export class HomeHub {

  static docId(uid: string) { return `${PREFIX}${uid}`; }

  static async of(uid: string): Promise<string | null> {
    const doc = await VectorStore.get<{ hubWorldUid: string }>(VectorNamespace.TERRITORIES, this.docId(uid));
    return doc?.data?.hubWorldUid ?? null;
  }

  /** `importedFrom` marks a hub the one-time import brought in, with the origin it came from. */
  static async pin(uid: string, hubWorldUid: string, importedFrom?: string): Promise<void> {
    await VectorStore.put({
      id: this.docId(uid),
      namespace: VectorNamespace.TERRITORIES,
      data: { hubWorldUid, ...(importedFrom ? { importedFrom } : {}) },
      metadata: { createdAt: Date.now(), updatedAt: Date.now(), ownerCertUid: uid, version: 1 }
    });
  }

  /** The hubs this avatar should not be offered: everyone else's homes. */
  static async foreignTo(uid: string | null): Promise<Set<string>> {
    const docs = await VectorStore.query<{ hubWorldUid: string; importedFrom?: string }>({ namespace: VectorNamespace.TERRITORIES, idPrefix: PREFIX });
    const pins = docs.filter(d => d?.id?.startsWith?.(PREFIX) && d.data?.hubWorldUid);
    const own = uid ? pins.find(d => d.id === this.docId(uid))?.data.hubWorldUid : undefined;
    // Homeless: only the imported hubs are closed to it. The common hub stays open.
    const closed = own ? pins : pins.filter(d => d.data.importedFrom);
    return new Set(closed.map(d => d.data.hubWorldUid).filter(hub => hub !== own));
  }
}
