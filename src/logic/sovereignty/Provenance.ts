/**
 * ITEM PROVENANCE (Wave 6.2)
 *
 * An item's story is its value. Every item that REACHES THE BANK (survives a
 * session, comes off the mill, is bought) gets a signed provenance event;
 * trades append TRANSFER events. The chain lives beside the item in the
 * ITEMS namespace and verifies end to end against the actors' certificates.
 *
 * Recording happens at banking/trade time, not at mint time — the world
 * mints thousands of items per session; the bank only remembers the ones
 * that made it home.
 */

import { IItem } from '../../../types';
import { CertificateSystem, IPlayerCertificate, ISignedPayload } from '../../entities/identity/certificateSystem';
import { VectorStore, VectorNamespace } from '../../entities/data/VectorStore';
import { useIdentityStore } from '../../entities/identity/store';

export interface IProvenanceEvent {
  type: 'MINT' | 'TRANSFER';
  itemId: string;
  defId: string;
  actorCertUid: string;
  context: Record<string, any>; // sessionId, rollKey, recipeId, lotId…
  at: number;
}

export interface IProvenanceRecord extends ISignedPayload<IProvenanceEvent> {
  signerKey: JsonWebKey;
}

export interface IProvenanceChain {
  itemId: string;
  events: IProvenanceRecord[];
}

export class Provenance {

  private static docId(itemId: string) { return `prov_${itemId}`; }

  /** Append one signed event to an item's chain. Fire-and-forget safe. */
  static async record(item: IItem, type: IProvenanceEvent['type'], context: Record<string, any>): Promise<boolean> {
    const cert = useIdentityStore.getState().certificate;
    if (!cert) return false;

    try {
      const event: IProvenanceEvent = {
        type,
        itemId: item.id,
        defId: item.universalDefinitionId,
        actorCertUid: cert.metadata.uid,
        context,
        at: Date.now()
      };
      const signed = await CertificateSystem.signPayload(cert.metadata.uid, event);

      const existing = await VectorStore.get<IProvenanceChain>(VectorNamespace.ITEMS, this.docId(item.id));
      const chain: IProvenanceChain = {
        itemId: item.id,
        events: [...(existing?.data?.events ?? []), { ...signed, signerKey: cert.publicKeyJWK }]
      };

      await VectorStore.put({
        id: this.docId(item.id),
        namespace: VectorNamespace.ITEMS,
        data: chain,
        metadata: { createdAt: Date.now(), updatedAt: Date.now(), ownerCertUid: cert.metadata.uid, signature: signed.signature, version: chain.events.length }
      });
      return true;
    } catch (e) {
      console.error('[PROV] Record failed:', e);
      return false;
    }
  }

  static async recordMany(items: IItem[], type: IProvenanceEvent['type'], context: Record<string, any>) {
    for (const item of items) await this.record(item, type, context);
  }

  /** Verify every signature in an item's chain (local certs only, for now). */
  /** Did this person themselves bring this thing out through a gate? Its signed record says. */
  static async cameThroughGate(itemId: string, uid: string): Promise<boolean> {
    const doc = await VectorStore.get<IProvenanceChain>(VectorNamespace.ITEMS, this.docId(itemId));
    return (doc?.data?.events ?? []).some(e => e.payload.type === 'MINT' && e.payload.context?.origin === 'EXTRACTION' && e.payload.actorCertUid === uid);
  }

  static async verify(itemId: string): Promise<{ ok: boolean; events: number; firstEvent?: string }> {
    const doc = await VectorStore.get<IProvenanceChain>(VectorNamespace.ITEMS, this.docId(itemId));
    if (!doc?.data) return { ok: false, events: 0 };

    // Each record carries its signer's public key, so items that changed hands
    // verify. This proves the chain is intact, not who a key belongs to.
    for (const record of doc.data.events) {
      const { signerKey, ...signed } = record;
      const valid = await CertificateSystem.verifyPayload(signed, { publicKeyJWK: signerKey } as IPlayerCertificate);
      if (!valid) return { ok: false, events: doc.data.events.length };
    }
    return {
      ok: true,
      events: doc.data.events.length,
      firstEvent: doc.data.events[0] ? `${doc.data.events[0].payload.type} @ ${new Date(doc.data.events[0].payload.at).toISOString()}` : undefined
    };
  }
}
