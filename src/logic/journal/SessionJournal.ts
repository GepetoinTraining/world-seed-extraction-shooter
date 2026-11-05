/**
 * SESSION JOURNAL (Wave 1.2)
 *
 * The append-only record of one extraction session. Primordial's claim/receipt
 * shape: the CLAIM states what the run was computed against (baseHash of the
 * pre-session player doc + world cert + seed), the RECEIPT states what came out
 * (outcome, action log, end hash). The whole thing is signed by the player's
 * birth certificate on finish and written to the TRANSACTIONS namespace.
 *
 * A future notary can replay: seed + journal -> same rolls -> same loot.
 */

import { CertificateSystem, ISignedPayload } from '../../entities/identity/certificateSystem';
import { VectorStore, VectorNamespace } from '../../entities/data/VectorStore';
import { StoreUnit } from '../../entities/data/StoreUnit';
import { useIdentityStore } from '../../entities/identity/store';
import { Ledger } from '../ledger/Ledger';
import { sha256Hex as sha256Sync } from '../ledger/sha256';

export type JournalActionType =
  | 'DROP'        // drop zone confirmed
  | 'KILL'        // mob killed (data: mobId, defId, rollKey)
  | 'LOOT'        // items entered inventory (data: itemIds)
  | 'DAMAGE'      // damage taken (data: amount)
  | 'HARVEST'     // resource harvested
  | 'INTERACT'    // interaction performed
  | 'DEATH'
  | 'EXTRACT';

export interface IJournalAction {
  seq: number;
  t: number; // ms since session start
  type: JournalActionType;
  data?: Record<string, any>;
}

export interface ISessionClaim {
  sessionId: string;
  worldCertUid: string;
  seed: string;
  baseHash: string;     // SHA-256 of the player doc this run started from
  certUid: string;
  startedAt: number;
}

export interface ISessionReceipt {
  claim: ISessionClaim;
  outcome: 'EXTRACTED' | 'DIED' | 'ABORTED';
  durationMs: number;
  actionCount: number;
  actions: IJournalAction[];
  endHash: string;      // SHA-256 of the player doc after banking
}

export async function sha256Hex(data: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export class SessionJournal {

  private static current: {
    claim: ISessionClaim;
    actions: IJournalAction[];
  } | null = null;

  static isActive(): boolean {
    return this.current !== null;
  }

  /** Roll-key factory: `${seed}:${sessionId}:${purpose}:${id}` */
  static rollKey(purpose: string, id: string): string {
    if (!this.current) return `nosession:${purpose}:${id}`;
    const { seed, sessionId } = this.current.claim;
    return `${seed}:${sessionId}:${purpose}:${id}`;
  }

  /** Open the journal. Call after diveIntoLayer + selectWorld, before the drop. */
  static async start(sessionId: string, worldCertUid: string, seed: string, playerDocJson: string) {
    const cert = useIdentityStore.getState().certificate;
    if (!cert) {
      console.warn('[JOURNAL] No identity; session will not be journaled.');
      return;
    }
    this.current = {
      claim: {
        sessionId,
        worldCertUid,
        seed,
        baseHash: await sha256Hex(playerDocJson),
        certUid: cert.metadata.uid,
        startedAt: Date.now()
      },
      actions: []
    };
    console.log(`[JOURNAL] Session opened: ${sessionId} (base ${this.current.claim.baseHash.slice(0, 12)}…)`);
  }

  static record(type: JournalActionType, data?: Record<string, any>) {
    if (!this.current) return;
    this.current.actions.push({
      seq: this.current.actions.length + 1,
      t: Date.now() - this.current.claim.startedAt,
      type,
      data
    });
  }

  /**
   * Close, sign, persist. Returns the signed receipt (or null if unjournaled).
   */
  static async finish(
    outcome: ISessionReceipt['outcome'],
    playerDocJsonAfter: string
  ): Promise<ISignedPayload<ISessionReceipt> | null> {
    if (!this.current) return null;
    const { claim, actions } = this.current;
    this.current = null;

    const receipt: ISessionReceipt = {
      claim,
      outcome,
      durationMs: Date.now() - claim.startedAt,
      actionCount: actions.length,
      actions,
      endHash: await sha256Hex(playerDocJsonAfter)
    };

    try {
      const signed = await CertificateSystem.signPayload(claim.certUid, receipt);

      // The receipt and the ledger's summary row (Wave 1.4) land as one.
      await StoreUnit.enqueue(async () => {
        for (;;) {
          const unit = new StoreUnit();
          await VectorStore.put({
            id: `session_${claim.sessionId}`,
            namespace: VectorNamespace.TRANSACTIONS,
            data: signed,
            metadata: {
              createdAt: claim.startedAt,
              updatedAt: Date.now(),
              ownerCertUid: claim.certUid,
              signature: signed.signature,
              version: 1
            }
          }, false, { unit });
          await Ledger.writeInto(unit, 'SESSION_RESULT', {
            sessionId: claim.sessionId,
            worldCertUid: claim.worldCertUid,
            outcome,
            actionCount: receipt.actionCount,
            endHash: receipt.endHash,
            // D134: the hub asks for the receipt this names, and rolls its drops again
            receiptHash: sha256Sync(signed.signature)
          });
          const result = await unit.commit();
          if (result.ok) return;
          if (!result.conflict) throw new Error(result.reason);
        }
      });

      console.log(`[JOURNAL] Session sealed: ${claim.sessionId} → ${outcome} (${receipt.actionCount} actions)`);
      return signed;
    } catch (e) {
      console.error('[JOURNAL] Failed to seal session:', e);
      return null;
    }
  }

  /** Abandoned session (world exit without extract/death). */
  static async abort(playerDocJson: string) {
    if (this.current) await this.finish('ABORTED', playerDocJson);
  }
}
