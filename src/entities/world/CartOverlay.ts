/**
 * CART OVERLAY (Wave 10C, D16)
 *
 * The one thing in a world that is not derived from its seed: carts stay where
 * they were left, across your death and across an extraction without them.
 * A world's chunks are a pure function of seed and place (the determinism
 * charter holds); the overlay is a signed-store document laid OVER that truth,
 * keyed by world uid, holding only what players left behind on wheels.
 */

import { VectorStore, VectorNamespace } from '../data/VectorStore';
import { ICartState } from './types';

export interface IPlacedCart {
  id: string;                          // the cart entity id, stable across sessions
  position: { x: number; y: number };  // world pixels
  cart: ICartState;
}

const docId = (worldUid: string) => `world_carts_${worldUid}`;

export class CartOverlay {

  static async load(worldUid: string): Promise<IPlacedCart[]> {
    const doc = await VectorStore.get<{ carts: IPlacedCart[] }>(VectorNamespace.TERRITORIES, docId(worldUid));
    return doc?.data?.carts ?? [];
  }

  static async save(worldUid: string, carts: IPlacedCart[]): Promise<void> {
    // Serialize through JSON on the way in: the stored bytes are the contract
    // (and RxDB freezes documents in dev — never hand it live store objects).
    await VectorStore.put({
      id: docId(worldUid),
      namespace: VectorNamespace.TERRITORIES,
      data: { carts: JSON.parse(JSON.stringify(carts)) as IPlacedCart[] },
      metadata: {
        createdAt: Date.now(),
        updatedAt: Date.now(),
        ownerCertUid: 'SYSTEM',
        version: 1
      }
    });
  }
}
