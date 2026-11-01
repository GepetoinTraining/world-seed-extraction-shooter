/**
 * PLAYER PERSISTENCE (Wave 1.1)
 *
 * The bank must not forget, and the bank must not lie.
 *
 * - Every save is the persistent half of the player (session stripped — the
 *   session lives in the SessionJournal), signed by the birth certificate.
 * - Hydration verifies the signature against the cert's public key. A doc
 *   that does not verify is REFUSED: the game boots a fresh template and says
 *   so loudly, rather than trusting tampered state.
 * - An autosave subscription debounces store changes; critical moments
 *   (jack-out, death, purchases, genesis) call flush() directly.
 */

import { IPlayer } from '../../../types';
import { CertificateSystem, IPlayerCertificate, ISignedPayload } from '../../entities/identity/certificateSystem';
import { VectorStore, VectorNamespace } from '../../entities/data/VectorStore';
import { StoreUnit } from '../../entities/data/StoreUnit';
import { usePlayerStore } from '../../entities/player/store';
import { useIdentityStore } from '../../entities/identity/store';
import { refusedAvatarId } from './BrowserImport';

const AUTOSAVE_DEBOUNCE_MS = 10_000;

export type HydrateResult =
  | { status: 'OK'; player: IPlayer }
  | { status: 'EMPTY' }
  | { status: 'TAMPERED' };

export class PlayerPersistence {

  private static timer: ReturnType<typeof setTimeout> | null = null;
  private static started = false;

  /** The persistent half of the player: the session never goes in the bank doc. */
  static persistable(player: IPlayer): IPlayer {
    return { ...player, currentSession: undefined };
  }

  static persistableJson(player: IPlayer): string {
    return JSON.stringify(this.persistable(player));
  }

  /** Begin watching the store. Call once, after hydration. */
  static start() {
    if (this.started) return;
    this.started = true;

    usePlayerStore.subscribe((state, prev) => {
      if (state.player !== prev.player) this.scheduleAutosave();
    });

    // Best-effort flush when the tab goes away
    window.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') void this.flush('visibility');
    });

    console.log('[PERSIST] Autosave armed.');
  }

  private static scheduleAutosave() {
    if (this.timer) return;
    this.timer = setTimeout(() => void this.flush('autosave'), AUTOSAVE_DEBOUNCE_MS);
  }

  /**
   * The bank doc as it stands right now, or null if there is nothing of ours to
   * save. Taken at the call, not at the write: a gold change's commit and every
   * save queue in order, so a save can never hold gold whose row comes after it.
   */
  static snapshot(): IPlayer | null {
    const cert = useIdentityStore.getState().certificate;
    const { player } = usePlayerStore.getState();

    if (!cert) return null;
    // Never persist the blank template over a real identity's slot
    if (player.id !== cert.metadata.uid) return null;

    return JSON.parse(JSON.stringify(this.persistable(player)));
  }

  /** Sign a snapshot into a unit: it lands with the rest of the unit, or not at all. */
  static async signInto(unit: StoreUnit, doc: IPlayer): Promise<void> {
    const cert = useIdentityStore.getState().certificate;
    if (!cert) return;
    const signed = await CertificateSystem.signPayload(cert.metadata.uid, doc);

    await VectorStore.put({
      id: cert.metadata.uid,
      namespace: VectorNamespace.CHARACTERS,
      data: signed,
      metadata: {
        createdAt: cert.metadata.createdAt,
        updatedAt: Date.now(),
        ownerCertUid: cert.metadata.uid,
        signature: signed.signature,
        version: 1
      }
    }, false, { unit });
  }

  /** Sign and write the player doc now. */
  static async flush(reason: string): Promise<boolean> {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }

    const doc = this.snapshot();
    if (!doc) return false;

    return StoreUnit.enqueue(async () => {
      try {
        const unit = new StoreUnit();
        await this.signInto(unit, doc);
        const result = await unit.commit();
        if (!result.ok) throw new Error(result.reason);
        console.log(`[PERSIST] Player doc sealed (${reason}).`);
        return true;
      } catch (e) {
        console.error('[PERSIST] Save failed:', e);
        return false;
      }
    });
  }

  /**
   * Load + verify. Refuses docs that fail signature verification.
   * Also accepts legacy unsigned docs ONCE (pre-Wave-1 saves), which become
   * signed on the next flush.
   */
  static async hydrate(cert: IPlayerCertificate): Promise<HydrateResult> {
    const doc = await VectorStore.get<ISignedPayload<IPlayer> | IPlayer>(
      VectorNamespace.CHARACTERS,
      cert.metadata.uid
    );

    if (!doc?.data) {
      // The one-time import refused this avatar: empty here does not mean new, and it must not be re-born.
      if (await VectorStore.get(VectorNamespace.TERRITORIES, refusedAvatarId(cert.metadata.uid))) {
        console.error('[PERSIST] ⛔ This avatar\'s browser save failed its proof at the import. REFUSING imprint.');
        return { status: 'TAMPERED' };
      }
      return { status: 'EMPTY' };
    }

    const data: any = doc.data;

    // Signed path (Wave 1+)
    if (data.signature && data.payload) {
      const valid = await CertificateSystem.verifyPayload(data as ISignedPayload<IPlayer>, cert);
      if (!valid) {
        console.error('[PERSIST] ⛔ TAMPER DETECTED — stored player doc fails signature verification. REFUSING imprint.');
        return { status: 'TAMPERED' };
      }
      console.log('[PERSIST] Player doc verified ✓');
      return { status: 'OK', player: (data as ISignedPayload<IPlayer>).payload };
    }

    // Legacy unsigned doc: accept once, it gets signed on next save
    if (data.id && data.bank) {
      console.warn('[PERSIST] Legacy unsigned player doc accepted; will be signed on next save.');
      return { status: 'OK', player: data as IPlayer };
    }

    return { status: 'EMPTY' };
  }
}
