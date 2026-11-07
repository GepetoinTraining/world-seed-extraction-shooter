/**
 * WHO KAMI IS IN THIS HUB. Pedro: "yup, the seed, each hub has their seed, and you send that
 * seed to a random ass haiku and ask for a personality based on vibes. since the seed is
 * always different the minute noise will produce a SLIGHTLY different version"
 *
 * Read once for a hub and kept beside it, so everyone in a hub meets the same god and nobody
 * pays for the reading twice. It belongs to the hub, never to a character (D81). It is words
 * and nothing reads a number from it. No key, no answer or a broken one leaves him as he
 * always is, keeps nothing, and the next person to sit down asks again (D35).
 */

import { VectorNamespace, VectorStore } from '../../../shared/entities/data/VectorStore';
import { WorldCertificateSystem } from '../../entities/world/WorldCertificate';
import { IDoorUsage, IntelligenceClient } from '../intelligence/IntelligenceClient';

/** A person is waiting on the first word. Longer than this and he speaks as he always is. */
const READING_PATIENCE_MS = 6_000;
/** Q49: what stays unsaid, and the words the talk prompts already keep out ("player", "game"). */
const HIDDEN = /archetype|trope|isekai|\bplayers?\b|\bgames?\b/i;

export interface IKamiReading { text: string; usage?: IDoorUsage }

export class KamiPersona {

  static docId(hubId: string): string {
    return `kami_persona_${hubId}`;
  }

  static judge(text: unknown): { ok: boolean; reason?: string } {
    if (typeof text !== 'string' || !text.trim()) return { ok: false, reason: 'It came back empty.' };
    if (HIDDEN.test(text)) return { ok: false, reason: 'It said what stays unsaid.' };
    return { ok: true };
  }

  /** `usage` is present only when this call paid for the reading. */
  static async ofHub(hubId: string, patienceMs = READING_PATIENCE_MS): Promise<IKamiReading | null> {
    if (!hubId) return null;
    const kept = await VectorStore.get<{ text: string }>(VectorNamespace.TERRITORIES, this.docId(hubId));
    if (kept?.data?.text) return { text: kept.data.text };

    const hub = (await WorldCertificateSystem.getPublicWorlds()).find(w => w.data.worldUid === hubId);
    if (!hub) return null;

    const out = await Promise.race([
      IntelligenceClient.writeKamiPersona(hub.data.seedHash),
      new Promise<{ status: 'OUTAGE'; text?: undefined; usage?: undefined }>(resolve => setTimeout(() => resolve({ status: 'OUTAGE' }), patienceMs))
    ]);
    if (out.status !== 'OK' || !this.judge(out.text).ok) return null;

    // Two people can sit down at once. The first reading stands, and both meet the same god.
    const now = Date.now();
    await VectorStore.put({
      id: this.docId(hubId),
      namespace: VectorNamespace.TERRITORIES,
      data: { text: out.text!.trim(), seed: hub.data.seedHash, model: out.usage?.model ?? 'unknown' },
      metadata: { createdAt: now, updatedAt: now, ownerCertUid: hub.data.creatorCertUid, version: 1 }
    }, false, { ifAbsent: true });
    const stood = await VectorStore.get<{ text: string }>(VectorNamespace.TERRITORIES, this.docId(hubId));
    return { text: stood?.data?.text ?? out.text!.trim(), usage: out.usage };
  }
}
